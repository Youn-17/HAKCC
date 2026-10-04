import { supabase } from '../config/supabase';

/**
 * 讨论速览：把一批笔记压成一份「这里都有什么」的清单。
 *
 * 解决的是阅读量问题 —— 一个 View 或一个小组三五周下来几十条笔记，学生要参与
 * 讨论得先读完，读不完就只能凭印象接，讨论就散了。
 *
 * ══ 边界（这是整个设计的关键，改动前请先读完）══
 *
 * 它做**定位**，不做**综合**：
 *   ✓ 谈了哪些问题、有哪几种说法、谁说的、哪些还没被建构、分歧在哪
 *   ✗ 「所以结论是……」、把几种说法合成一句新的表述
 *
 * 为什么划这条线：那个「更高一层的新说法」正是知识建构里认知含量最高的一步，
 * 也是这门课要练的东西。系统替学生写出来，学生就永远练不到；而且课程的因变量
 * 就是学生的认知主体性，AI 代写会直接污染测量。
 *
 * 落实这条边界靠三件事：输出结构里根本没有「结论」这一栏；提示词明确禁止合并
 * 观点；每条要点都必须挂回具体笔记，无法凭空生成。
 */

export type DigestScope = 'view' | 'group' | 'selection';

type NoteLite = {
  id: string;
  title: string | null;
  content: string | null;
  author_name: string | null;
  author_id: string | null;
  created_at: string;
  is_ai_generated: boolean | null;
};

export type DiscussionDigest = {
  scope: DigestScope;
  scopeLabel: string;
  noteCount: number;
  authorCount: number;
  /** 组里正在争的问题，每条挂着提出它的笔记 */
  questions: Array<{ text: string; noteIds: string[] }>;
  /** 同一个问题上的不同说法。这里只**并列呈现**，不做合并 */
  positions: Array<{ topic: string; views: Array<{ summary: string; who: string; noteIds: string[] }> }>;
  /** 已经形成的共识（大家都这么说的，不是 AI 归纳出来的新说法） */
  agreements: Array<{ text: string; noteIds: string[] }>;
  /** 还没被任何人建构的笔记 */
  notBuiltOn: Array<{ noteId: string; title: string; author: string; daysOpen: number }>;
  /** 纯统计，不经模型 */
  stats: { notes: number; authors: number; buildOns: number; aiNotes: number };
  /** 模型没能返回结构化结果时的降级提示 */
  degraded?: string;
};

const MAX_NOTES = 60;
const MAX_CHARS_PER_NOTE = 700;

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

const SYSTEM = `你在帮一个知识建构课堂的学生快速了解「这一批笔记里都有什么」。

只做定位，不做综合。具体说：
- 要写：谈了哪些问题、同一个问题上有哪几种不同说法、分别是谁说的、哪些说法大家已经一致、哪些笔记还没有人建构
- 不要写：你自己的结论、把几种说法合并成一句新的表述、对谁更有道理的评价、任何形式的「综上所述」

把不同说法**并列**列出，即使它们互相矛盾 —— 矛盾本身就是学生要看到的东西。
每一条都必须标出它来自哪几条笔记的编号，不能凭空写。
用中文，简短，不要客套话，不要 emoji。

只返回 JSON：
{
  "questions": [{"text": "组里在争的一个问题", "noteIds": ["n3"]}],
  "positions": [{"topic": "争的是什么", "views": [{"summary": "一种说法", "who": "谁", "noteIds": ["n1"]}]}],
  "agreements": [{"text": "大家已经一致的一点", "noteIds": ["n2","n5"]}]
}`;

/** 取一个 View 里的笔记。views 是 notes 表上的数组列，不是外键。 */
async function fetchViewNotes(spaceId: string, viewId: string | null) {
  const { data, error } = await supabase
    .from('notes')
    .select('id, title, content, author_name, author_id, created_at, is_ai_generated, views, type')
    .eq('space_id', spaceId)
    .is('deleted_at', null);
  if (error) throw new Error(`notes(view): ${error.message}`);
  const rows = (data ?? []) as (NoteLite & { views: string[] | null; type: string | null })[];
  return rows
    .filter(n => n.type !== 'view')
    .filter(n => (viewId ? (n.views ?? []).includes(viewId) : true));
}

async function fetchSelectionNotes(noteIds: string[]) {
  if (noteIds.length === 0) return [];
  const { data, error } = await supabase
    .from('notes')
    .select('id, title, content, author_name, author_id, created_at, is_ai_generated, type')
    .in('id', noteIds.slice(0, MAX_NOTES))
    .is('deleted_at', null);
  if (error) throw new Error(`notes(selection): ${error.message}`);
  return ((data ?? []) as (NoteLite & { type: string | null })[]).filter(n => n.type !== 'view');
}

/** 已收集的笔记里，哪些被建构过 —— 用来算「尚无人建构」。 */
async function fetchInboundCounts(noteIds: string[]) {
  const counts = new Map<string, number>();
  if (noteIds.length === 0) return counts;
  for (let i = 0; i < noteIds.length; i += 200) {
    const { data } = await supabase
      .from('relations')
      .select('target_note_id')
      .in('target_note_id', noteIds.slice(i, i + 200));
    for (const r of (data ?? []) as { target_note_id: string }[]) {
      counts.set(r.target_note_id, (counts.get(r.target_note_id) ?? 0) + 1);
    }
  }
  return counts;
}

export async function collectDigestNotes(params: {
  scope: DigestScope;
  spaceId?: string | null;
  viewId?: string | null;
  noteIds?: string[];
  groupNotes?: NoteLite[];
}): Promise<NoteLite[]> {
  const { scope, spaceId, viewId, noteIds, groupNotes } = params;
  if (scope === 'selection') return fetchSelectionNotes(noteIds ?? []);
  if (scope === 'group') return (groupNotes ?? []).slice(0, MAX_NOTES);
  if (!spaceId) return [];
  return (await fetchViewNotes(spaceId, viewId ?? null)).slice(0, MAX_NOTES);
}

/**
 * 生成速览。模型只负责归类与转述，统计部分（多少条、谁没被接）全部由代码算 ——
 * 数字交给模型必然出错，而学生会当真。
 */
export async function buildDiscussionDigest(params: {
  scope: DigestScope;
  scopeLabel: string;
  notes: NoteLite[];
  callModel: (system: string, user: string) => Promise<Record<string, unknown> | null>;
}): Promise<DiscussionDigest> {
  const { scope, scopeLabel, notes, callModel } = params;

  const human = notes.filter(n => !n.is_ai_generated);
  const inbound = await fetchInboundCounts(notes.map(n => n.id));
  const now = new Date();

  const authors = new Set(human.map(n => n.author_id).filter(Boolean) as string[]);
  const stats = {
    notes: notes.length,
    authors: authors.size,
    buildOns: [...inbound.values()].reduce((a, b) => a + b, 0),
    aiNotes: notes.length - human.length,
  };

  const notBuiltOn = human
    .filter(n => (inbound.get(n.id) ?? 0) === 0)
    .map(n => ({
      noteId: n.id,
      title: n.title ?? '',
      author: n.author_name ?? '',
      daysOpen: daysBetween(now, new Date(n.created_at)),
    }))
    .sort((a, b) => b.daysOpen - a.daysOpen)
    .slice(0, 10);

  const base: DiscussionDigest = {
    scope, scopeLabel,
    noteCount: notes.length,
    authorCount: authors.size,
    questions: [], positions: [], agreements: [],
    notBuiltOn, stats,
  };

  if (human.length < 3) {
    return { ...base, degraded: '笔记太少，还看不出讨论的形状。' };
  }

  // 给模型的是编号而不是 UUID：短、省 token，而且模型引用编号比引用 UUID 稳。
  const idOf = new Map<string, string>();
  const backTo = new Map<string, string>();
  human.forEach((n, i) => { const k = `n${i + 1}`; idOf.set(n.id, k); backTo.set(k, n.id); });

  const corpus = human.map(n => {
    const body = stripHtml(n.content ?? '').slice(0, MAX_CHARS_PER_NOTE);
    return `[${idOf.get(n.id)}] ${n.author_name ?? '匿名'}：${n.title ?? ''}\n${body}`;
  }).join('\n\n');

  const parsed = await callModel(SYSTEM, `以下是${scopeLabel}的 ${human.length} 条笔记：\n\n${corpus}`);
  if (!parsed) {
    return { ...base, degraded: 'AI 这次没能返回结果，上面的统计仍然可用。' };
  }

  /** 把模型给的 n1/n2 还原成真实 note id；认不出的直接丢掉，不放假引用。 */
  const resolve = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(x => backTo.get(String(x))).filter(Boolean) as string[] : [];

  const arr = (v: unknown) => (Array.isArray(v) ? v : []);

  return {
    ...base,
    questions: arr(parsed.questions).slice(0, 8).map((q: any) => ({
      text: String(q?.text ?? '').slice(0, 160),
      noteIds: resolve(q?.noteIds),
    })).filter(q => q.text),
    positions: arr(parsed.positions).slice(0, 6).map((p: any) => ({
      topic: String(p?.topic ?? '').slice(0, 120),
      views: arr(p?.views).slice(0, 5).map((v: any) => ({
        summary: String(v?.summary ?? '').slice(0, 220),
        who: String(v?.who ?? '').slice(0, 40),
        noteIds: resolve(v?.noteIds),
      })).filter((v: any) => v.summary),
    })).filter(p => p.topic && p.views.length),
    agreements: arr(parsed.agreements).slice(0, 6).map((a: any) => ({
      text: String(a?.text ?? '').slice(0, 200),
      noteIds: resolve(a?.noteIds),
    })).filter(a => a.text),
  };
}
