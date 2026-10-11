/**
 * 做法卡（2026-10-11 第五步）：从学生和两个智能体的对话里看「怎样回答，学生更常接住」，生成候选，
 * 老师在「讨论分析 → 智能体做法」里同意后才放进提示词；也可以老师自己写一张。
 *
 * 接住 = 这条回答之后学生把它导入了笔记（note_ai_insertions）、把它做的网页挂到了笔记（ai_artifact_notes）、
 *        30 分钟内在同一段对话里接着问，或者回答了它给的选项卡。
 * 做法 = 回答本身看得出来的几件事（先给选项卡、列计划、做成网页、最后交回一个问题、给句子开头、短、点到笔记），
 *        按任务类型分开比「这样做」和「没这样做」的接住率。数字是算出来的，模型只负责把做法写成一句话。
 * 试用：采用时记下这类任务当时的接住率；之后放进提示词的回答用满 20 次，接住率没更高就自动撤回，写明原因。
 */
import { supabase } from '../config/supabase';
import { classifyAgencyIntent } from './answerChecks';
import { similarity } from './studentMemory';

export type TaskKind = 'ask' | 'make' | 'plan' | 'ghostwrite' | 'polish';
export const TASK_KINDS: TaskKind[] = ['ask', 'make', 'plan', 'ghostwrite', 'polish'];
export const TASK_KIND_ZH: Record<TaskKind, string> = { ask: '提问讨论', make: '做东西（网页、题目、表格）', plan: '规划写作', ghostwrite: '要 AI 代写', polish: '改自己写的' };

export type FeatureId = 'asked_choice' | 'made_plan' | 'made_page' | 'ends_with_question' | 'gave_starters' | 'short_answer' | 'cited_notes';
export const FEATURES: Record<FeatureId, { zh: string; practice: string }> = {
  asked_choice: { zh: '先用选项卡让学生定方向', practice: '先用选项卡给学生两三个具体方向，学生选了再动手' },
  made_plan: { zh: '先列计划', practice: '先列出三到五步的计划，再一步步做' },
  made_page: { zh: '做成网页', practice: '能做成可互动的网页时就做成网页，而不是只用文字讲' },
  ends_with_question: { zh: '最后交回一个问题', practice: '回答最后留一个具体的问题交回给学生' },
  gave_starters: { zh: '给句子开头或提纲', practice: '给两三个句子开头或一个提纲，让学生自己接着写' },
  short_answer: { zh: '回答在 400 字以内', practice: '回答控制在 400 字以内，先说最要紧的' },
  cited_notes: { zh: '点到两条以上具体笔记', practice: '点到两条以上具体的笔记标题和作者' },
};

export const PRACTICE_LIMITS = {
  windowDays: 28,
  minKindTurns: 20,
  minGroup: 5,
  minLift: 0.15,
  maxCandidates: 5,
  trialUses: 20,
  followUpMinutes: 30,
  perPrompt: 3,
};

export function taskKind(question: string): TaskKind {
  const intent = classifyAgencyIntent(question);
  if (intent !== 'ask') return intent;
  if (/(规划|计划|步骤|怎么开始写|写作思路|提纲|列个?大纲|\bplan\b|\boutline\b|\bsteps\b)/i.test(question)) return 'plan';
  return 'ask';
}

export function answerFeatures(reply: string, meta: Record<string, unknown> | null | undefined): FeatureId[] {
  const m = meta ?? {};
  const text = reply ?? '';
  const out: FeatureId[] = [];
  if (m.question && typeof m.question === 'object') out.push('asked_choice');
  const plan = m.plan as { steps?: unknown[] } | undefined;
  if (Array.isArray(plan?.steps) && plan!.steps.length > 0) out.push('made_plan');
  if (Array.isArray(m.artifacts) && m.artifacts.length > 0) out.push('made_page');
  if (/[？?]/.test(text.trim().slice(-60))) out.push('ends_with_question');
  if (/……|_{3,}|开头|提纲|\bstarters?\b|\boutline\b/i.test(text)) out.push('gave_starters');
  if (text.trim().length > 0 && text.trim().length <= 400) out.push('short_answer');
  const titles = (text.match(/《[^》\n]{2,120}》/g) ?? []).length + (text.match(/「[A-Z][^」\n]{4,120}」/g) ?? []).length;
  if (titles >= 2) out.push('cited_notes');
  return out;
}

export interface AgentTurnRecord {
  id: string;
  surface: 'workspace' | 'note';
  conversationId: string;
  userId: string;
  question: string;
  reply: string;
  kind: TaskKind;
  features: FeatureId[];
  createdAt: string;
  adopted: boolean;
  engaged: boolean;
  /** 这条回答放进提示词的做法卡 */
  cards: string[];
}

export const takenUp = (t: Pick<AgentTurnRecord, 'adopted' | 'engaged'>) => t.adopted || t.engaged;

export interface RateCell { took: number; total: number; rate: number }
const cell = (turns: AgentTurnRecord[]): RateCell => {
  const took = turns.filter(takenUp).length;
  return { took, total: turns.length, rate: turns.length ? took / turns.length : 0 };
};

export function kindRates(turns: AgentTurnRecord[]): Record<TaskKind, RateCell> {
  return Object.fromEntries(TASK_KINDS.map(k => [k, cell(turns.filter(t => t.kind === k))])) as Record<TaskKind, RateCell>;
}

export interface FeatureStat { kind: TaskKind; feature: FeatureId; with: RateCell; without: RateCell; lift: number }

/** 每类任务里，每个做法「这样做 / 没这样做」的接住率；样本不够的不算 */
export function featureStats(turns: AgentTurnRecord[]): FeatureStat[] {
  const out: FeatureStat[] = [];
  for (const kind of TASK_KINDS) {
    const group = turns.filter(t => t.kind === kind);
    if (group.length < PRACTICE_LIMITS.minKindTurns) continue;
    for (const feature of Object.keys(FEATURES) as FeatureId[]) {
      const yes = group.filter(t => t.features.includes(feature));
      const no = group.filter(t => !t.features.includes(feature));
      if (yes.length < PRACTICE_LIMITS.minGroup || no.length < PRACTICE_LIMITS.minGroup) continue;
      const w = cell(yes);
      const wo = cell(no);
      out.push({ kind, feature, with: w, without: wo, lift: w.rate - wo.rate });
    }
  }
  return out.sort((a, b) => b.lift - a.lift);
}

/** 挑候选：明显更常被接住的做法，每类最多两条、一共最多五条；同类同做法已经有卡（含被拒、撤回的）就不再提 */
export function pickCandidates(stats: FeatureStat[], existing: Array<{ task_kind: string; evidence?: { feature?: string } | null }>): FeatureStat[] {
  const seen = new Set(existing.map(c => `${c.task_kind}:${c.evidence?.feature ?? ''}`));
  const perKind = new Map<TaskKind, number>();
  const out: FeatureStat[] = [];
  for (const s of stats) {
    if (s.lift < PRACTICE_LIMITS.minLift || seen.has(`${s.kind}:${s.feature}`)) continue;
    if ((perKind.get(s.kind) ?? 0) >= 2) continue;
    out.push(s);
    perKind.set(s.kind, (perKind.get(s.kind) ?? 0) + 1);
    if (out.length >= PRACTICE_LIMITS.maxCandidates) break;
  }
  return out;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

export function evidenceSentence(s: Pick<FeatureStat, 'kind' | 'feature' | 'with' | 'without'>): string {
  return `「${TASK_KIND_ZH[s.kind]}」这类问题里，${FEATURES[s.feature].zh}的回答 ${s.with.total} 次里 ${s.with.took} 次被接住（${pct(s.with.rate)}），没这样做的 ${s.without.total} 次里 ${s.without.took} 次（${pct(s.without.rate)}）。`;
}

/** 试用结果：用满 20 次后，接住率不比采用前高就撤回 */
export function trialVerdict(baseline: number | null, withCard: AgentTurnRecord[]): { uses: number; rate: number; verdict: 'trial' | 'keep' | 'retire'; reason?: string } {
  const c = cell(withCard);
  if (c.total < PRACTICE_LIMITS.trialUses || baseline === null) return { uses: c.total, rate: c.rate, verdict: 'trial' };
  if (c.rate <= baseline) {
    return { uses: c.total, rate: c.rate, verdict: 'retire', reason: `试用 ${c.total} 次，接住率 ${pct(c.rate)}，没比采用前（${pct(baseline)}）高` };
  }
  return { uses: c.total, rate: c.rate, verdict: 'keep' };
}

// ── 从库里读回答和学生接没接住 ───────────────────────────────

type Msg = { id: string; role: 'user' | 'assistant'; content: string; meta: Record<string, unknown>; createdAt: string };

function chunks<T>(list: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function studentIds(courseId: string): Promise<string[]> {
  const { data } = await supabase.from('course_members').select('user_id, role').eq('course_id', courseId);
  return ((data ?? []) as Array<{ user_id: string; role: string | null }>).filter(r => r.role !== 'teacher').map(r => r.user_id);
}

/** 按对话排好的消息 → 一条条回答（带问题、做法、接没接住） */
export function pairTurns(surface: 'workspace' | 'note', conversationId: string, userId: string, messages: Msg[], adoptedIds: Set<string>): AgentTurnRecord[] {
  const sorted = [...messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: AgentTurnRecord[] = [];
  let question = '';
  let kind: TaskKind = 'ask';
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.role === 'user') {
      // 回答选项卡（「选第一种」）还是原来那件事，任务类型接着用上一问的
      const answeringChoice = Boolean(m.meta?.choice) && question !== '';
      question = m.content;
      if (!answeringChoice) kind = taskKind(m.content);
      continue;
    }
    if (!question || !m.content.trim()) continue;
    const next = sorted.slice(i + 1).find(x => x.role === 'user');
    const withinFollowUp = next && Date.parse(next.createdAt) - Date.parse(m.createdAt) <= PRACTICE_LIMITS.followUpMinutes * 60_000;
    const answeredChoice = Boolean(next?.meta?.choice);
    const artifactIds = Array.isArray(m.meta.artifacts) ? (m.meta.artifacts as Array<{ id?: string }>).map(a => a.id).filter(Boolean) as string[] : [];
    out.push({
      id: m.id, surface, conversationId, userId, question, reply: m.content,
      kind,
      features: answerFeatures(m.content, m.meta),
      createdAt: m.createdAt,
      adopted: adoptedIds.has(m.id) || artifactIds.some(a => adoptedIds.has(a)),
      engaged: Boolean(withinFollowUp) || answeredChoice,
      cards: Array.isArray(m.meta.practice_cards) ? (m.meta.practice_cards as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    });
  }
  return out;
}

/** 这门课最近 28 天学生和两个智能体的回答（学生删掉的对话不算） */
export async function collectTurns(courseId: string, sinceIso = new Date(Date.now() - PRACTICE_LIMITS.windowDays * 86_400_000).toISOString()): Promise<AgentTurnRecord[]> {
  const students = await studentIds(courseId);
  if (students.length === 0) return [];
  const [{ data: convs }, { data: threads }] = await Promise.all([
    supabase.from('agent_conversations').select('id, user_id').eq('course_id', courseId).eq('agent_type', 'workspace').is('deleted_at', null).in('user_id', students).gte('updated_at', sinceIso).limit(800),
    supabase.from('note_conversation_threads').select('id, created_by').eq('course_id', courseId).eq('target_type', 'ai').is('deleted_at', null).in('created_by', students).gte('updated_at', sinceIso).limit(800),
  ]);
  const convOwner = new Map(((convs ?? []) as Array<{ id: string; user_id: string }>).map(c => [c.id, c.user_id]));
  const threadOwner = new Map(((threads ?? []) as Array<{ id: string; created_by: string }>).map(t => [t.id, t.created_by]));

  const byConv = new Map<string, Msg[]>();
  for (const ids of chunks([...convOwner.keys()])) {
    const { data } = await supabase.from('agent_messages').select('id, conversation_id, role, content, ai_metadata, created_at').in('conversation_id', ids).gte('created_at', sinceIso).limit(5000);
    for (const r of (data ?? []) as Array<{ id: string; conversation_id: string; role: string; content: string | null; ai_metadata: Record<string, unknown> | null; created_at: string }>) {
      if (r.role !== 'user' && r.role !== 'assistant') continue;
      const list = byConv.get(r.conversation_id) ?? [];
      list.push({ id: r.id, role: r.role, content: r.content ?? '', meta: r.ai_metadata ?? {}, createdAt: r.created_at });
      byConv.set(r.conversation_id, list);
    }
  }
  const byThread = new Map<string, Msg[]>();
  for (const ids of chunks([...threadOwner.keys()])) {
    const { data } = await supabase.from('note_conversation_messages').select('id, thread_id, sender_kind, content, ai_metadata, created_at').in('thread_id', ids).gte('created_at', sinceIso).limit(5000);
    for (const r of (data ?? []) as Array<{ id: string; thread_id: string; sender_kind: string; content: string | null; ai_metadata: Record<string, unknown> | null; created_at: string }>) {
      const role = r.sender_kind === 'assistant' ? 'assistant' : r.sender_kind === 'user' ? 'user' : null;
      if (!role) continue;
      const list = byThread.get(r.thread_id) ?? [];
      list.push({ id: r.id, role, content: r.content ?? '', meta: r.ai_metadata ?? {}, createdAt: r.created_at });
      byThread.set(r.thread_id, list);
    }
  }

  // 接住：导入笔记（按来源消息）、网页挂到笔记（按网页）
  const adopted = new Set<string>();
  const { data: inserts } = await supabase.from('note_ai_insertions').select('source_message_id, insertion_anchor').eq('course_id', courseId).gte('created_at', sinceIso).limit(5000);
  for (const r of (inserts ?? []) as Array<{ source_message_id: string | null; insertion_anchor: Record<string, unknown> | null }>) {
    if (r.source_message_id) adopted.add(r.source_message_id);
    const mid = r.insertion_anchor?.message_id;
    if (typeof mid === 'string') adopted.add(mid);
  }
  const { data: attached } = await supabase.from('ai_artifact_notes').select('artifact_id, ai_artifacts!inner(course_id)').eq('ai_artifacts.course_id', courseId).gte('created_at', sinceIso).limit(5000);
  for (const r of (attached ?? []) as Array<{ artifact_id: string }>) adopted.add(r.artifact_id);

  const turns: AgentTurnRecord[] = [];
  for (const [id, msgs] of byConv) turns.push(...pairTurns('workspace', id, convOwner.get(id)!, msgs, adopted));
  for (const [id, msgs] of byThread) turns.push(...pairTurns('note', id, threadOwner.get(id)!, msgs, adopted));
  return turns;
}

// ── 卡 ──────────────────────────────────────────────────────

export interface PracticeCard {
  id: string;
  course_id: string;
  task_kind: TaskKind;
  practice: string;
  rationale: string | null;
  evidence: Record<string, unknown> & { feature?: string };
  origin: 'induced' | 'teacher';
  status: 'candidate' | 'active' | 'rejected' | 'retired';
  baseline_rate: number | null;
  decided_at: string | null;
  retired_reason: string | null;
  created_at: string;
}

const CARD_COLUMNS = 'id, course_id, task_kind, practice, rationale, evidence, origin, status, baseline_rate, decided_at, retired_reason, created_at';

export async function loadCards(courseId: string): Promise<PracticeCard[]> {
  const { data, error } = await supabase.from('agent_practice_cards').select(CARD_COLUMNS).eq('course_id', courseId).order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as PracticeCard[];
}

/** 放进提示词的：只有老师同意了的；每门课缓存一分钟（每一轮都要查，库远） */
const activeCache = new Map<string, { at: number; cards: PracticeCard[] }>();
export function invalidatePracticeCache(courseId: string): void {
  activeCache.delete(courseId);
}

export async function activeCards(courseId: string): Promise<PracticeCard[]> {
  const hit = activeCache.get(courseId);
  if (hit && Date.now() - hit.at < 60_000) return hit.cards;
  const { data, error } = await supabase.from('agent_practice_cards').select(CARD_COLUMNS).eq('course_id', courseId).eq('status', 'active').order('decided_at', { ascending: false }).limit(30);
  if (error) {
    console.error('[AgentPractices] load active failed:', error.message);
    return hit?.cards ?? [];
  }
  const cards = (data ?? []) as PracticeCard[];
  activeCache.set(courseId, { at: Date.now(), cards });
  return cards;
}

export function cardsFor(cards: PracticeCard[], kind: TaskKind): PracticeCard[] {
  return cards.filter(c => c.task_kind === kind).slice(0, PRACTICE_LIMITS.perPrompt);
}

export function practiceSection(cards: PracticeCard[]): string {
  if (cards.length === 0) return '';
  return ['PRACTICES THAT WORKED IN THIS COURSE (approved by the teacher; follow them when they fit this request):', ...cards.map(c => `- ${c.practice}`)].join('\n');
}

/** 一张卡和已有的同类卡太像（字对重合 ≥ 0.6）就不再加 */
export function duplicateOf(practice: string, kind: TaskKind, cards: Array<Pick<PracticeCard, 'task_kind' | 'practice' | 'id'>>): string | null {
  return cards.find(c => c.task_kind === kind && similarity(c.practice, practice) >= 0.6)?.id ?? null;
}
