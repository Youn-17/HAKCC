import { createHash } from 'node:crypto';
import { supabase } from '../config/supabase';
import { notePreviewText } from './noteText';

/**
 * 问题栏后面滚动的「这个 View 在聊什么」（2026-10-05 用户：滚动显示这个 view 主要讨论的问题主题，
 * 需要 AI 自动总结，可以实时更新）。
 *
 * 只做定位不做综合：主题写「在讨论什么」，不写结论、不评对错——综合（Rise Above）留给学生，
 * 和讨论速览、小组观点图谱同一个口径。
 *
 * 缓存：每次生成存一行（view_topic_summaries，076）。笔记的签名（id + 更新时间）没变就用存的；
 * 变了但离上次生成不到 3 分钟，先给旧的（stale）；同一个 View 同时只生成一次——五十个学生同时
 * 开着画布，不会叫五十次模型。存下来的每一行也让研究上能还原「学生当时看到的主题是什么」。
 */

export const WELCOME_VIEW_ID = 'view-welcome';
/** 笔记少于这个数不显示：三两条没什么「主题」可言 */
export const MIN_NOTES = 3;
export const REGENERATE_AFTER_MS = 3 * 60_000;
const MAX_NOTES = 80;
const MAX_TOPICS = 6;
const LABEL_MAX = 16;

export interface TopicNote {
  id: string;
  title: string | null;
  content: string | null;
  updated_at: string | null;
  views: string[] | null;
  type: string | null;
  is_ai_generated: boolean | null;
}

export interface ViewTopic {
  label: string;
  noteIds: string[];
  count: number;
}

/**
 * 这个 View 里有哪些笔记，规则和画布一致（Workspace.visibleNotes）：笔记的 views 里有它；
 * 欢迎页（主画布）还收没有归属、或归属的视图已经不存在的笔记。视图卡、AI 写的笔记不算——
 * 主题说的是学生在讨论什么。
 */
export function notesInView(notes: readonly TopicNote[], viewId: string, existingViewIds: ReadonlySet<string>): TopicNote[] {
  return notes
    .filter(n => n.type !== 'view' && !n.is_ai_generated)
    .filter(n => {
      const views = n.views ?? [];
      if (views.includes(viewId)) return true;
      if (viewId !== WELCOME_VIEW_ID) return false;
      return views.length === 0 || !views.some(v => existingViewIds.has(v));
    });
}

/** 笔记变了（新增、删除、改了内容）签名就变 */
export function topicSignature(notes: readonly Pick<TopicNote, 'id' | 'updated_at'>[]): string {
  const parts = notes.map(n => `${n.id}:${n.updated_at ?? ''}`).sort();
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}


const SYSTEM = `你在为一块知识建构讨论画布写一行滚动显示的「讨论主题」，学生扫一眼就知道这块画布在聊什么。

只做定位，不做综合：
- 主题写「在讨论什么」：一个问题、一个概念、一处分歧，用名词短语，每个不超过 14 个字；
- 不写结论，不评对错，不把几种说法合成一句新的表述，不写「综上」；
- 不出现「大家在讨论」「本画布」这类引导语，不用引号，不带句末标点；
- 3 到 6 个主题，按涉及的笔记多少排；每个主题列出它来自哪几条笔记的编号，不能凭空写。

只返回 JSON：{"topics":[{"label":"主题","noteIds":["n1","n4"]}]}`;

export function buildTopicPrompt(notes: readonly TopicNote[]): { system: string; user: string; idOf: Map<string, string> } {
  const idOf = new Map<string, string>();
  const lines = notes.slice(0, MAX_NOTES).map((n, i) => {
    const key = `n${i + 1}`;
    idOf.set(key, n.id);
    const body = notePreviewText(n.content).slice(0, 160);
    return `[${key}] ${(n.title ?? '').trim() || '（无标题）'}${body ? `：${body}` : ''}`;
  });
  return { system: SYSTEM, user: lines.join('\n'), idOf };
}

/** 首尾的引号、书名号、句末标点一起去，交替出现（「…」。）也去干净 */
const EDGE = /^["'“”‘’「」『』《》【】\s。．.!！;；,，、:：…?？]+|["'“”‘’「」『』《》【】\s。．.!！;；,，、:：…?？]+$/g;

function cleanLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = notePreviewText(raw).replace(EDGE, '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > LABEL_MAX + 4) return '';
  return text;
}

/** 模型给的 JSON → 主题。编号对不上的笔记丢掉，一条笔记都没有的主题不要，同名合并，按条数排 */
export function parseTopics(raw: unknown, idOf: ReadonlyMap<string, string>): ViewTopic[] {
  const list = (raw as { topics?: unknown } | null)?.topics;
  if (!Array.isArray(list)) return [];
  const byLabel = new Map<string, Set<string>>();
  for (const item of list) {
    const label = cleanLabel((item as { label?: unknown })?.label);
    const keys = (item as { noteIds?: unknown })?.noteIds;
    if (!label || !Array.isArray(keys)) continue;
    const ids = keys.map(k => idOf.get(String(k))).filter((id): id is string => Boolean(id));
    if (ids.length === 0) continue;
    const set = byLabel.get(label) ?? new Set<string>();
    ids.forEach(id => set.add(id));
    byLabel.set(label, set);
  }
  return [...byLabel]
    .map(([label, ids]) => ({ label, noteIds: [...ids], count: ids.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TOPICS);
}

// ── 读笔记、读缓存 ────────────────────────────────────────────

export async function fetchViewTopicNotes(spaceId: string, viewId: string): Promise<TopicNote[]> {
  const [notesRes, viewsRes] = await Promise.all([
    supabase
      .from('notes')
      .select('id, title, content, updated_at, views, type, is_ai_generated')
      .eq('space_id', spaceId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(400),
    viewId === WELCOME_VIEW_ID
      ? supabase.from('views').select('id').eq('space_id', spaceId)
      : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
  ]);
  if (notesRes.error) throw new Error(`notes: ${notesRes.error.message}`);
  const existing = new Set(((viewsRes.data ?? []) as Array<{ id: string }>).map(v => v.id));
  return notesInView((notesRes.data ?? []) as TopicNote[], viewId, existing);
}

export interface StoredTopics {
  signature: string;
  topics: ViewTopic[];
  created_at: string;
}

export async function latestStoredTopics(spaceId: string, viewId: string): Promise<StoredTopics | null> {
  const { data } = await supabase
    .from('view_topic_summaries')
    .select('signature, topics, created_at')
    .eq('space_id', spaceId)
    .eq('view_id', viewId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as StoredTopics | null) ?? null;
}

/** 现在要不要重新生成：签名没变不要；变了、但离上次不到 3 分钟也先不要 */
export function shouldRegenerate(stored: Pick<StoredTopics, 'signature' | 'created_at'> | null, signature: string, now = Date.now()): boolean {
  if (!stored) return true;
  if (stored.signature === signature) return false;
  return now - Date.parse(stored.created_at) >= REGENERATE_AFTER_MS;
}
