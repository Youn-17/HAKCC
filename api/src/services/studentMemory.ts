/**
 * 学生记忆（2026-10-11 第四步）。三类：
 *   这段对话：conversation_memory（conversationMemory.ts），跟着对话走，删对话就没了；
 *   关键时刻 episode：学生在选项卡上选了什么、把 AI 的东西导入了哪条笔记，系统自动记，60 天后过期；
 *   关于你的了解 profile：智能体用 save_reflection 记下的兴趣、还没弄懂的、进步、长处等。
 * 后两类在 agent_reflections（迁移 093 加了 memory_kind / source / last_used_at / updated_at）。
 *
 * 合并：记一条「了解」时，同一个学生、同一门课里意思差不多的（字对重合 ≥ 0.6）就改写那一条，不另起一条。
 * 遗忘：关键时刻 60 天过期；「了解」按重要程度 × 多久没用上（120 天减半）排，超过 30 条、或者淡到 0.1 以下就删；
 * 关键时刻最多留 50 条。都在读的时候顺手做，不用定时任务。
 * 学生能看、能删、能关（learner_profiles.memory_enabled）；关了以后不记新的，也不放进提示词。
 */
import { supabase } from '../config/supabase';

export const PROFILE_TYPES = ['insight', 'knowledge_gap', 'misconception', 'progress', 'interest', 'strength'] as const;
export const EPISODE_TYPES = ['choice', 'imported'] as const;
export type ProfileType = typeof PROFILE_TYPES[number];
export type EpisodeType = typeof EPISODE_TYPES[number];
export type MemoryKind = 'profile' | 'episode';

export const MEMORY_LIMITS = {
  profile: 30,
  episode: 50,
  promptProfile: 8,
  promptEpisodes: 4,
  episodeDays: 60,
  /** 「了解」多久没用上、没被重新确认，重要程度就减半 */
  halfLifeDays: 120,
  /** 淡到这个分数以下就忘掉 */
  forgetBelow: 0.1,
  mergeSimilarity: 0.6,
  contentChars: 200,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StudentMemory {
  id: string;
  kind: MemoryKind;
  type: string;
  content: string;
  keywords: string[];
  relevance: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  source: Record<string, unknown>;
}

type Row = {
  id: string;
  memory_kind?: string | null;
  reflection_type: string;
  content: string;
  topic_keywords?: string[] | null;
  relevance_score?: number | null;
  created_at: string;
  updated_at?: string | null;
  last_used_at?: string | null;
  expires_at?: string | null;
  source?: Record<string, unknown> | null;
};

const COLUMNS = 'id, memory_kind, reflection_type, content, topic_keywords, relevance_score, created_at, updated_at, last_used_at, expires_at, source';

function toMemory(r: Row): StudentMemory {
  return {
    id: r.id,
    kind: r.memory_kind === 'episode' ? 'episode' : 'profile',
    type: r.reflection_type,
    content: r.content,
    keywords: Array.isArray(r.topic_keywords) ? r.topic_keywords : [],
    relevance: typeof r.relevance_score === 'number' ? r.relevance_score : 0.5,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    lastUsedAt: r.last_used_at ?? null,
    source: r.source ?? {},
  };
}

// ── 相似度、打分（纯函数，测试直接用） ───────────────────────

function pairs(text: string): Set<string> {
  const s = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const out = new Set<string>();
  for (const word of s.split(' ')) {
    if (!word) continue;
    if (/^[\p{Script=Han}]+$/u.test(word)) {
      if (word.length === 1) out.add(word);
      for (let i = 0; i < word.length - 1; i++) out.add(word.slice(i, i + 2));
    } else if (word.length > 1) {
      out.add(word);
    }
  }
  return out;
}

/** 两句话的字对（中文）/ 词（英文）重合度 */
export function similarity(a: string, b: string): number {
  const x = pairs(a);
  const y = pairs(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const p of x) if (y.has(p)) both++;
  return both / (x.size + y.size - both);
}

/** 「了解」现在还有多重：重要程度 × 多久没用上、没被重新确认（半衰期 120 天） */
export function memoryWeight(m: Pick<StudentMemory, 'relevance' | 'updatedAt' | 'lastUsedAt'>, now = Date.now()): number {
  const touched = Math.max(Date.parse(m.updatedAt) || 0, m.lastUsedAt ? Date.parse(m.lastUsedAt) || 0 : 0);
  const days = touched ? Math.max(0, (now - touched) / DAY_MS) : 0;
  return m.relevance * Math.pow(0.5, days / MEMORY_LIMITS.halfLifeDays);
}

/** 这一问用哪几条：分量 + 和问题的相关程度 */
export function rankForQuestion(memories: StudentMemory[], question: string, limit: number, now = Date.now()): StudentMemory[] {
  const q = question.trim();
  return memories
    .map(m => ({ m, score: memoryWeight(m, now) + (q ? 0.6 * similarity(q, `${m.content} ${m.keywords.join(' ')}`) : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.m);
}

/** 该忘的：过期的关键时刻、淡到底的「了解」、超出条数的（「了解」去掉最轻的，关键时刻去掉最旧的） */
export function memoriesToForget(memories: Array<StudentMemory & { expiresAt?: string | null }>, now = Date.now()): string[] {
  const drop = new Set<string>();
  for (const m of memories) {
    if (m.expiresAt && Date.parse(m.expiresAt) <= now) drop.add(m.id);
    else if (m.kind === 'profile' && memoryWeight(m, now) < MEMORY_LIMITS.forgetBelow) drop.add(m.id);
  }
  const keep = memories.filter(m => !drop.has(m.id));
  const profile = keep.filter(m => m.kind === 'profile').sort((a, b) => memoryWeight(b, now) - memoryWeight(a, now));
  for (const m of profile.slice(MEMORY_LIMITS.profile)) drop.add(m.id);
  const episodes = keep.filter(m => m.kind === 'episode').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const m of episodes.slice(MEMORY_LIMITS.episode)) drop.add(m.id);
  return [...drop];
}

function clampRelevance(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0.05, n));
}

function cleanContent(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MEMORY_LIMITS.contentChars);
}

// ── 开关 ────────────────────────────────────────────────────

export async function isMemoryEnabled(userId: string, courseId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('learner_profiles').select('memory_enabled').eq('user_id', userId).eq('course_id', courseId).maybeSingle();
  if (error) {
    console.error('[StudentMemory] read setting failed:', error.message);
    return true;
  }
  return (data as { memory_enabled?: boolean } | null)?.memory_enabled !== false;
}

export async function setMemoryEnabled(userId: string, courseId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('learner_profiles')
    .upsert({ user_id: userId, course_id: courseId, memory_enabled: enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id,course_id' });
  if (error) throw new Error(error.message);
}

// ── 读 ──────────────────────────────────────────────────────

async function loadRows(userId: string, courseId: string): Promise<Array<StudentMemory & { expiresAt: string | null }>> {
  const { data, error } = await supabase
    .from('agent_reflections').select(COLUMNS).eq('user_id', userId).eq('course_id', courseId)
    .order('updated_at', { ascending: false }).limit(200);
  if (error) {
    console.error('[StudentMemory] load failed:', error.message);
    return [];
  }
  return ((data ?? []) as Row[]).map(r => ({ ...toMemory(r), expiresAt: r.expires_at ?? null }));
}

/** 读出来顺手忘掉该忘的（删行），返回还留着的 */
async function loadAndForget(userId: string, courseId: string): Promise<StudentMemory[]> {
  return forget(userId, await loadRows(userId, courseId));
}

async function forget(userId: string, rows: Array<StudentMemory & { expiresAt: string | null }>): Promise<StudentMemory[]> {
  const drop = memoriesToForget(rows);
  if (drop.length > 0) {
    const { error } = await supabase.from('agent_reflections').delete().eq('user_id', userId).in('id', drop);
    if (error) console.error('[StudentMemory] forget failed:', error.message);
  }
  const gone = new Set(drop);
  return rows.filter(r => !gone.has(r.id)).map(({ expiresAt: _e, ...m }) => m);
}

export async function listMemories(userId: string, courseId: string): Promise<{ profile: StudentMemory[]; episodes: StudentMemory[] }> {
  const all = await loadAndForget(userId, courseId);
  return {
    profile: all.filter(m => m.kind === 'profile').sort((a, b) => memoryWeight(b) - memoryWeight(a)),
    episodes: all.filter(m => m.kind === 'episode').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  };
}

/** 这一轮放进提示词的：关了就什么都不给；用上的记下 last_used_at（不等它写完） */
export async function memoriesForPrompt(userId: string, courseId: string, question: string): Promise<{ enabled: boolean; profile: StudentMemory[]; episodes: StudentMemory[] }> {
  // 开关和记忆一起读（库在爱尔兰、服务器在香港，每多一次先后查询就多等将近 0.3 秒）
  const [enabled, rows] = await Promise.all([isMemoryEnabled(userId, courseId), loadRows(userId, courseId)]);
  if (!enabled) return { enabled: false, profile: [], episodes: [] };
  const all = await forget(userId, rows);
  const profile = rankForQuestion(all.filter(m => m.kind === 'profile'), question, MEMORY_LIMITS.promptProfile);
  const episodes = all.filter(m => m.kind === 'episode')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MEMORY_LIMITS.promptEpisodes);
  const used = [...profile, ...episodes].map(m => m.id);
  if (used.length > 0) {
    void supabase.from('agent_reflections').update({ last_used_at: new Date().toISOString() }).eq('user_id', userId).in('id', used)
      .then(({ error }) => { if (error) console.error('[StudentMemory] mark used failed:', error.message); });
  }
  return { enabled: true, profile, episodes };
}

const PROFILE_LABEL: Record<string, string> = {
  insight: 'Noticed', knowledge_gap: 'Still working out', misconception: 'Mixed up before', progress: 'Progress', interest: 'Interested in', strength: 'Good at',
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}-${d.getDate()}`;
}

/** 提示词里的那一段。学生看得到、删得掉这些，所以别复述、别说「根据我的记忆」 */
export function buildMemoryContext(m: { enabled: boolean; profile: StudentMemory[]; episodes: StudentMemory[] }): string {
  if (!m.enabled) {
    return 'MEMORY: The student has turned memory off. Do not save observations about them (save_reflection), and do not refer to earlier conversations unless they bring them up.';
  }
  if (m.profile.length === 0 && m.episodes.length === 0) return '';
  const lines = ['WHAT YOU REMEMBER ABOUT THIS STUDENT (from earlier conversations in this course; the student can see and delete these under "AI 记得什么").',
    'Use them only to connect to what they already know, chose or are working on. Do not recite them, and do not say "according to my memory".'];
  if (m.profile.length > 0) {
    lines.push('About them:');
    for (const p of m.profile) lines.push(`- [${PROFILE_LABEL[p.type] ?? p.type}] ${p.content}`);
  }
  if (m.episodes.length > 0) {
    lines.push('Recent moments:');
    for (const e of m.episodes) lines.push(`- ${shortDate(e.createdAt)} ${e.content}`);
  }
  return lines.join('\n');
}

// ── 写 ──────────────────────────────────────────────────────

export type RememberResult = { saved: boolean; merged?: boolean; id?: string; reason?: 'off' | 'empty' | 'error' };

/** 记一条「了解」：关了不记；意思差不多的合并进原来那条 */
export async function rememberProfile(p: {
  userId: string;
  courseId: string;
  type: string;
  content: string;
  keywords?: string[];
  relevance?: unknown;
  source?: Record<string, unknown>;
  conversationId?: string | null;
}): Promise<RememberResult> {
  const content = cleanContent(p.content);
  if (!content) return { saved: false, reason: 'empty' };
  const [enabled, rows] = await Promise.all([isMemoryEnabled(p.userId, p.courseId), loadRows(p.userId, p.courseId)]);
  if (!enabled) return { saved: false, reason: 'off' };
  const type = (PROFILE_TYPES as readonly string[]).includes(p.type) ? p.type : 'insight';
  const relevance = clampRelevance(p.relevance);
  const keywords = [...new Set((p.keywords ?? []).map(k => String(k).trim()).filter(Boolean))].slice(0, 8);
  const now = new Date().toISOString();

  const existing = rows.filter(m => m.kind === 'profile');
  const twin = existing
    .map(m => ({ m, s: similarity(m.content, content) }))
    .filter(x => x.s >= MEMORY_LIMITS.mergeSimilarity)
    .sort((a, b) => b.s - a.s)[0]?.m;
  if (twin) {
    const { error } = await supabase.from('agent_reflections').update({
      content,
      reflection_type: type,
      topic_keywords: [...new Set([...twin.keywords, ...keywords])].slice(0, 8),
      relevance_score: Math.min(1, Math.max(twin.relevance, relevance) + 0.05),
      updated_at: now,
    }).eq('id', twin.id).eq('user_id', p.userId);
    if (error) {
      console.error('[StudentMemory] merge failed:', error.message);
      return { saved: false, reason: 'error' };
    }
    return { saved: true, merged: true, id: twin.id };
  }

  const { data, error } = await supabase.from('agent_reflections').insert({
    user_id: p.userId,
    course_id: p.courseId,
    conversation_id: p.conversationId ?? null,
    memory_kind: 'profile',
    reflection_type: type,
    content,
    topic_keywords: keywords,
    relevance_score: relevance,
    source: p.source ?? {},
    updated_at: now,
  }).select('id').single();
  if (error) {
    console.error('[StudentMemory] save failed:', error.message);
    return { saved: false, reason: 'error' };
  }
  void loadAndForget(p.userId, p.courseId).catch(() => {});
  return { saved: true, id: (data as { id: string }).id };
}

/** 记一个关键时刻（选了什么、导入了什么）：关了不记；十分钟内一模一样的不重复记 */
export async function recordEpisode(p: {
  userId: string;
  courseId: string;
  type: EpisodeType;
  content: string;
  source?: Record<string, unknown>;
}): Promise<void> {
  const content = cleanContent(p.content);
  if (!content) return;
  try {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const [enabled, { data: dup }] = await Promise.all([
      isMemoryEnabled(p.userId, p.courseId),
      supabase.from('agent_reflections').select('id')
        .eq('user_id', p.userId).eq('course_id', p.courseId).eq('memory_kind', 'episode').eq('content', content).gte('created_at', since).limit(1),
    ]);
    if (!enabled) return;
    if (dup && dup.length > 0) return;
    const now = Date.now();
    const { error } = await supabase.from('agent_reflections').insert({
      user_id: p.userId,
      course_id: p.courseId,
      memory_kind: 'episode',
      reflection_type: p.type,
      content,
      relevance_score: 0.5,
      source: p.source ?? {},
      expires_at: new Date(now + MEMORY_LIMITS.episodeDays * DAY_MS).toISOString(),
      updated_at: new Date(now).toISOString(),
    });
    if (error) console.error('[StudentMemory] episode failed:', error.message);
  } catch (err) {
    console.error('[StudentMemory] episode failed:', err instanceof Error ? err.message : err);
  }
}

export function choiceEpisodeText(choice: { label: string; other?: boolean }, question: string | null, zh: boolean): string {
  const label = choice.label.trim();
  if (zh) return question ? `在「${question.trim().slice(0, 60)}」里选了「${label}」` : `选了「${label}」`;
  return question ? `Chose "${label}" for "${question.trim().slice(0, 60)}"` : `Chose "${label}"`;
}

export function importEpisodeText(kind: 'answer' | 'page', noteTitle: string, zh: boolean): string {
  const title = noteTitle.trim().slice(0, 60) || (zh ? '一条笔记' : 'a note');
  if (zh) return kind === 'page' ? `把智能体做的网页放进了笔记《${title}》` : `把智能体的回答导入了笔记《${title}》`;
  return kind === 'page' ? `Added the agent's page to the note "${title}"` : `Imported the agent's answer into the note "${title}"`;
}

// ── 删 ──────────────────────────────────────────────────────

export async function deleteMemory(userId: string, id: string): Promise<{ deleted: boolean; kind?: MemoryKind; type?: string; courseId?: string }> {
  const { data, error } = await supabase.from('agent_reflections')
    .delete().eq('id', id).eq('user_id', userId).select('memory_kind, reflection_type, course_id');
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { memory_kind?: string; reflection_type?: string; course_id?: string } | undefined;
  if (!row) return { deleted: false };
  return { deleted: true, kind: row.memory_kind === 'episode' ? 'episode' : 'profile', type: row.reflection_type, courseId: row.course_id };
}

export async function clearMemories(userId: string, courseId: string, kind: MemoryKind | 'all'): Promise<number> {
  let q = supabase.from('agent_reflections').delete().eq('user_id', userId).eq('course_id', courseId);
  if (kind !== 'all') q = q.eq('memory_kind', kind);
  const { data, error } = await q.select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}
