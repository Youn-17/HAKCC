import { supabase } from '../config/supabase';
import { extractConceptsScored } from './conceptExtraction';

/**
 * 小组观点图谱（Idea graph）。
 *
 * 解决的问题：一个主题做三五周之后，组里几十上百条笔记堆在画布上，学生说不清
 * 「我们到底谈到哪了」。这不是搜索问题，是定位问题 —— 需要把已经发生的讨论
 * 组织成一眼能看懂的形状。
 *
 * 边界（重要）：这里只做**定位**，不做**综合**。
 * 图谱告诉学生哪些观点在场、哪些概念反复出现、谁的问题还没人答；
 * 那个「更高一层的新说法」仍然由学生自己写。把综合交给系统，
 * 学生就永远练不到知识建构里认知含量最高的那一步。
 *
 * 命名同理：叫「观点图谱」不叫「知识图谱」—— 图上是学生自己提出的观点，
 * 不是既有的知识体系。
 */

// 18 而不是 28：排在 20 名开外的词本来就弱（「哪里」「无法」「确实」这种），
// 而且 28 个圈挤在一屏里读不清。宁可少而准。
const CONCEPT_LIMIT = 18;
const MIN_NOTES_FOR_GRAPH = 3;
/** 图上最多画多少条共现连线。再多就糊成一团，读不出结构。 */
const MAX_CONCEPT_LINKS = 34;
/** 一期覆盖 7 天；不足 7 天不自动生成，除非教师手动触发。 */
export const IDEA_GRAPH_PERIOD_DAYS = 7;
/** 超过这个天数仍未被建构才列出来，避免刚发的笔记就被标成没人建构。 */
const UNANSWERED_AFTER_DAYS = 2;

type NoteRow = {
  id: string;
  title: string | null;
  content: string | null;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  type: string | null;
  is_ai_generated: boolean | null;
  epistemic_status: string | null;
  inquiry_question: string | null;
};

type RelationRow = {
  id?: string;
  source_note_id: string;
  target_note_id: string;
  relation_type: string;
  creator_id: string | null;
  created_at: string;
};

export type IdeaGraphConcept = {
  id: string;
  term: string;
  noteIds: string[];
  authorCount: number;
  score: number;
  /** 相比上一期增加的笔记数。首期、或该词上一期不在榜上时为 null */
  delta: number | null;
  /** 上一期榜上没有这个词。与 delta 分开：新出现 ≠ 增长了 N 条 */
  isNew: boolean;
};

export type IdeaGraphNote = {
  id: string;
  title: string;
  author: string;
  createdAt: string;
  conceptIds: string[];
  builtOnBy: number;
  buildsOn: number;
  isAiGenerated: boolean;
};

export type IdeaGraphPayload = {
  concepts: IdeaGraphConcept[];
  /** 概念共现：同一条笔记里一起出现过 */
  conceptLinks: Array<{ source: string; target: string; weight: number }>;
  notes: IdeaGraphNote[];
  progress: {
    /** 组里提出的探究问题 */
    questions: Array<{ noteId: string; title: string; author: string; answered: boolean }>;
    /** 发出去超过 UNANSWERED_AFTER_DAYS 天仍未被任何人建构的笔记 */
    unanswered: Array<{ noteId: string; title: string; author: string; daysOpen: number }>;
    /** 谈得比上期更多的概念（delta>0），以及这一期才上榜的（isNew） */
    growing: Array<{ term: string; delta: number; isNew: boolean }>;
    /** 最长的几条建构链 —— 讨论真正推进的地方 */
    chains: Array<{ rootId: string; rootTitle: string; depth: number; participants: number }>;
    /** 一句话概括，纯模板拼接，不调用 LLM */
    headline: string;
  };
  stats: {
    noteCount: number;
    newNoteCount: number;
    memberCount: number;
    activeMemberCount: number;
    /** 组内笔记被 Build-on 的次数（谁做的都算） */
    buildOnCount: number;
    /** 组员主动 Build-on 别人的次数 —— 与上面不是一回事，标签别混用 */
    buildOnByMembers: number;
    aiNoteCount: number;
  };
};

/** 该组的笔记范围：组员写的 + 绑定该组的空间里的。与研究数据导出同一口径。 */
async function fetchGroupNotes(groupId: string, courseId: string) {
  const { data: memberRows, error: memberErr } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId);
  if (memberErr) throw new Error(`group_members: ${memberErr.message}`);
  const memberIds = (memberRows ?? []).map(r => r.user_id as string).filter(Boolean);

  const { data: spaceRows, error: spaceErr } = await supabase
    .from('spaces')
    .select('id')
    .eq('group_id', groupId);
  if (spaceErr) throw new Error(`spaces: ${spaceErr.message}`);
  const groupSpaceIds = (spaceRows ?? []).map(r => r.id as string);

  if (memberIds.length === 0 && groupSpaceIds.length === 0) {
    return { notes: [] as NoteRow[], memberIds, groupSpaceIds };
  }

  // 课程内所有空间，用来把「组员在共享空间写的笔记」也纳进来
  const { data: courseSpaces } = await supabase
    .from('spaces')
    .select('id')
    .eq('course_id', courseId);
  const courseSpaceIds = (courseSpaces ?? []).map(r => r.id as string);

  const cols =
    'id, title, content, author_id, author_name, created_at, type, is_ai_generated, epistemic_status, inquiry_question';

  const collected = new Map<string, NoteRow>();

  if (memberIds.length > 0 && courseSpaceIds.length > 0) {
    const { data, error } = await supabase
      .from('notes')
      .select(cols)
      .in('author_id', memberIds)
      .in('space_id', courseSpaceIds)
      .is('deleted_at', null);
    if (error) throw new Error(`notes(by author): ${error.message}`);
    for (const n of (data ?? []) as NoteRow[]) collected.set(n.id, n);
  }

  if (groupSpaceIds.length > 0) {
    const { data, error } = await supabase
      .from('notes')
      .select(cols)
      .in('space_id', groupSpaceIds)
      .is('deleted_at', null);
    if (error) throw new Error(`notes(by space): ${error.message}`);
    for (const n of (data ?? []) as NoteRow[]) collected.set(n.id, n);
  }

  return { notes: [...collected.values()], memberIds, groupSpaceIds };
}

/**
 * 抓与这批笔记相关的全部 Build-on 关系 —— **两个方向都要**。
 *
 * 原来只查 `target_note_id in 组内笔记`，于是「组员在组外笔记上做的 Build-on」
 * 整个漏掉。后果不只是少算一个数：measureChains 的父子图会缺边，链的深度和
 * 卷入人数都被低估，而那正是「讨论推进得最远的几条」的排序依据。
 */
async function fetchRelations(noteIds: string[]): Promise<RelationRow[]> {
  if (noteIds.length === 0) return [];
  const byId = new Map<string, RelationRow>();
  const cols = 'id, source_note_id, target_note_id, relation_type, creator_id, created_at';
  for (let i = 0; i < noteIds.length; i += 200) {
    const slice = noteIds.slice(i, i + 200);
    for (const col of ['target_note_id', 'source_note_id'] as const) {
      const { data, error } = await supabase.from('relations').select(cols).in(col, slice);
      if (error) throw new Error(`relations(${col}): ${error.message}`);
      for (const r of (data ?? []) as (RelationRow & { id: string })[]) byId.set(r.id, r);
    }
  }
  return [...byId.values()];
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

/** 顺着 relations 往下走，量出每条根笔记带出的建构链有多深、卷入几个人。 */
function measureChains(notes: NoteRow[], relations: RelationRow[]) {
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const r of relations) {
    if (!children.has(r.source_note_id)) children.set(r.source_note_id, []);
    children.get(r.source_note_id)!.push(r.target_note_id);
    hasParent.add(r.target_note_id);
  }
  const byId = new Map(notes.map(n => [n.id, n]));
  // AI 延伸笔记不作为链根：它本身是对某条学生笔记的回应，只是那条回应关系没有被
  // 记进 relations，于是在图上看起来「没有父节点」。把它当讨论的起点会让
  // 「推进得最远的几条」列出一条以 AI 开头的线索，读起来像是 AI 起的头。
  // 它仍然可以出现在链的中间。
  const roots = notes.filter(n => !hasParent.has(n.id) && children.has(n.id) && !n.is_ai_generated);

  return roots
    .map(root => {
      const participants = new Set<string>();
      let depth = 0;
      const seen = new Set<string>();
      let layer = [root.id];
      while (layer.length > 0 && depth < 30) {
        const next: string[] = [];
        for (const id of layer) {
          if (seen.has(id)) continue;
          seen.add(id);
          const author = byId.get(id)?.author_id;
          if (author) participants.add(author);
          next.push(...(children.get(id) ?? []));
        }
        if (next.length === 0) break;
        depth++;
        layer = next;
      }
      return {
        rootId: root.id,
        rootTitle: root.title ?? '',
        depth,
        participants: participants.size,
      };
    })
    .filter(c => c.depth > 0)
    .sort((a, b) => b.depth - a.depth || b.participants - a.participants)
    .slice(0, 5);
}

/**
 * 组内提出的问题：学生写的、标题以问号结尾的笔记。
 *
 * 不看 inquiry_question：那是空间的共同问题，每条笔记新建时都抄了一份，
 * 按它算会把同一句空间问题列上十几遍。同一句问题只列一次，有人接过就算已被建构；
 * 新提的排前面。
 */
export function collectGroupQuestions(
  notes: Array<Pick<NoteRow, 'id' | 'title' | 'author_name' | 'created_at'>>,
  inbound: Map<string, number>,
  limit = 12,
) {
  const byTitle = new Map<string, { noteId: string; title: string; author: string; answered: boolean }>();
  for (const n of [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const title = (n.title ?? '').replace(/\s+/g, ' ').trim();
    if (!/[?？]$/.test(title)) continue;
    const answered = (inbound.get(n.id) ?? 0) > 0;
    const seen = byTitle.get(title);
    if (seen) { seen.answered ||= answered; continue; }
    byTitle.set(title, { noteId: n.id, title, author: n.author_name ?? '', answered });
  }
  return [...byTitle.values()].slice(0, limit);
}

/**
 * 生成一期观点图谱。纯统计与图算法，不调用任何 LLM ——
 * 这样它既便宜又稳定，而且不会把「系统的说法」混进学生的讨论里。
 */
export async function buildGroupIdeaGraph(params: {
  groupId: string;
  courseId: string;
  windowStart: Date;
  windowEnd: Date;
  previous?: IdeaGraphPayload | null;
}): Promise<{ payload: IdeaGraphPayload; noteCount: number }> {
  const { groupId, courseId, windowStart, windowEnd, previous } = params;
  const { notes, memberIds } = await fetchGroupNotes(groupId, courseId);

  const visible = notes.filter(n => n.type !== 'view');
  const noteIds = visible.map(n => n.id);
  const noteIdSet = new Set(noteIds);
  const relations = await fetchRelations(noteIds);
  const inWindow = visible.filter(n => {
    const t = new Date(n.created_at);
    return t >= windowStart && t <= windowEnd;
  });

  // 概念只从**学生自己写的**笔记里抽。
  //
  // AI 延伸笔记会大段复述学生的说法，混进来既是重复计数，又会让 AI 关心的词
  // 盖过学生关心的词 —— 那就不是「他们的观点图谱」了。AI 笔记仍然出现在下面的
  // 笔记层里（带标记），学生看得到，只是不参与决定图的骨架。
  const humanNotes = visible.filter(n => !n.is_ai_generated);
  const conceptMap = extractConceptsScored(
    humanNotes.map(n => ({ id: n.id, title: n.title ?? '', text: stripHtml(n.content ?? '') })),
    CONCEPT_LIMIT,
    { discriminative: true },
  );

  const byId = new Map(visible.map(n => [n.id, n]));
  const prevConcepts = new Map((previous?.concepts ?? []).map(c => [c.term, c.noteIds.length]));

  const concepts: IdeaGraphConcept[] = [...conceptMap.entries()].map(([term, info], idx) => {
    const ids = [...info.docs];
    const authors = new Set(ids.map(id => byId.get(id)?.author_id).filter(Boolean) as string[]);
    const before = prevConcepts.get(term);
    // 上一期榜上没有这个词时，delta 不能算成 ids.length —— 那会把「因为别的词被过滤掉
    // 而浮上来」显示成「这期增长了 N 条」，读者会以为组里这周猛聊了它。
    const isNew = Boolean(previous) && before === undefined;
    return {
      id: `c${idx}`,
      term,
      noteIds: ids,
      authorCount: authors.size,
      score: Math.round(info.score * 1000) / 1000,
      delta: previous && before !== undefined ? ids.length - before : null,
      isNew,
    };
  });

  // 概念共现：同一条笔记里一起出现过就连一条边，权重是共同笔记数
  // 共现连线。原来要求「至少同现 2 篇」，小组刚开始笔记少的时候几乎连不出线，
  // 图看上去是一堆孤立的圈 —— 学生会以为这些观点之间没关系，其实只是数据还不够。
  // 改成：门槛降到 1 篇，再按权重取最强的若干条，这样任何语料规模下都既有结构
  // 又不会糊成一团。
  const allLinks: Array<{ source: string; target: string; weight: number }> = [];
  for (let i = 0; i < concepts.length; i++) {
    const a = new Set(concepts[i].noteIds);
    for (let j = i + 1; j < concepts.length; j++) {
      const shared = concepts[j].noteIds.filter(id => a.has(id)).length;
      if (shared >= 1) {
        allLinks.push({ source: concepts[i].id, target: concepts[j].id, weight: shared });
      }
    }
  }
  const conceptLinks = allLinks
    .sort((x, y) => y.weight - x.weight)
    .slice(0, MAX_CONCEPT_LINKS);

  const conceptsOfNote = new Map<string, string[]>();
  for (const c of concepts) {
    for (const id of c.noteIds) {
      if (!conceptsOfNote.has(id)) conceptsOfNote.set(id, []);
      conceptsOfNote.get(id)!.push(c.id);
    }
  }

  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const r of relations) {
    inbound.set(r.target_note_id, (inbound.get(r.target_note_id) ?? 0) + 1);
    outbound.set(r.source_note_id, (outbound.get(r.source_note_id) ?? 0) + 1);
  }

  const graphNotes: IdeaGraphNote[] = visible.map(n => ({
    id: n.id,
    title: n.title ?? '',
    author: n.author_name ?? '',
    createdAt: n.created_at,
    conceptIds: conceptsOfNote.get(n.id) ?? [],
    builtOnBy: inbound.get(n.id) ?? 0,
    buildsOn: outbound.get(n.id) ?? 0,
    isAiGenerated: Boolean(n.is_ai_generated),
  }));

  const questions = collectGroupQuestions(humanNotes, inbound);

  const unanswered = visible
    .filter(n => (inbound.get(n.id) ?? 0) === 0 && !n.is_ai_generated)
    .map(n => ({
      noteId: n.id,
      title: n.title ?? '',
      author: n.author_name ?? '',
      daysOpen: daysBetween(windowEnd, new Date(n.created_at)),
    }))
    .filter(n => n.daysOpen >= UNANSWERED_AFTER_DAYS)
    .sort((a, b) => b.daysOpen - a.daysOpen)
    .slice(0, 8);

  // 真正谈得更多的排前面；这一期才上榜的跟在后面，标成「新」而不是「+N」
  const growing = [
    ...concepts.filter(c => (c.delta ?? 0) > 0)
      .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
      .map(c => ({ term: c.term, delta: c.delta as number, isNew: false })),
    ...concepts.filter(c => c.isNew)
      .sort((a, b) => b.noteIds.length - a.noteIds.length)
      .map(c => ({ term: c.term, delta: 0, isNew: true })),
  ].slice(0, 6);

  const chains = measureChains(visible, relations);

  // 「本期参与」不能只看谁新建了笔记 —— 这一周只做了 Build-on 的人同样在参与讨论，
  // 漏掉他们会让参与度看起来比实际低，而这个数字学生是会当真的。
  const activeAuthors = new Set(inWindow.map(n => n.author_id).filter(Boolean) as string[]);
  const memberSet = new Set(memberIds);
  for (const r of relations) {
    const t = new Date(r.created_at);
    if (t >= windowStart && t <= windowEnd && r.creator_id && memberSet.has(r.creator_id)) {
      activeAuthors.add(r.creator_id);
    }
  }
  const buildOnByMembers = relations.filter(r => r.creator_id && memberSet.has(r.creator_id)).length;

  const headlineParts: string[] = [];
  if (inWindow.length > 0) headlineParts.push(`本期新增 ${inWindow.length} 条笔记`);
  if (activeAuthors.size > 0) headlineParts.push(`${activeAuthors.size} 人参与`);
  const grewMost = growing.find(g => !g.isNew);
  if (grewMost) headlineParts.push(`「${grewMost.term}」本期讨论增加`);
  if (unanswered.length > 0) headlineParts.push(`${unanswered.length} 条未有人建构`);

  return {
    noteCount: visible.length,
    payload: {
      concepts,
      conceptLinks,
      notes: graphNotes,
      progress: {
        questions,
        unanswered,
        growing,
        chains,
        headline: headlineParts.join(' · ') || '本期还没有新的讨论',
      },
      stats: {
        noteCount: visible.length,
        newNoteCount: inWindow.length,
        memberCount: memberIds.length,
        activeMemberCount: activeAuthors.size,
        buildOnCount: relations.filter(r => noteIdSet.has(r.target_note_id)).length,
        buildOnByMembers,
        aiNoteCount: visible.filter(n => n.is_ai_generated).length,
      },
    },
  };
}

/** 上一期快照；没有就返回 null。 */
export async function fetchLatestIdeaGraph(groupId: string) {
  const { data, error } = await supabase
    .from('group_idea_graphs')
    .select('id, generated_at, window_start, window_end, note_count, payload, trigger')
    .eq('group_id', groupId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`group_idea_graphs: ${error.message}`);
  return data ?? null;
}

/**
 * 需要新生成一期吗？
 * 从没生成过 → 要（窗口从建组日起）；上一期结束满 7 天 → 要。
 * 数据太少（不足 3 条笔记）时不生成 —— 三条笔记的图谱没有信息量，
 * 反而让学生觉得这个功能没用。
 */
export function shouldRegenerate(latestWindowEnd: string | null, now = new Date()): boolean {
  if (!latestWindowEnd) return true;
  return daysBetween(now, new Date(latestWindowEnd)) >= IDEA_GRAPH_PERIOD_DAYS;
}

export { MIN_NOTES_FOR_GRAPH };


/** 讨论速览复用的入口：拿到与观点图谱完全同一批笔记，避免两个功能口径不一致。 */
export async function collectGroupNotesForDigest(groupId: string, courseId: string) {
  const { notes } = await fetchGroupNotes(groupId, courseId);
  return notes.filter(n => n.type !== 'view');
}
