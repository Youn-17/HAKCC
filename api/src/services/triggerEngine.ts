/**
 * Trigger Detection Engine — six draft-feedback categories.
 * Gate checks determine eligibility, then heuristics select the feedback type.
 * Delivery follows course configuration and access controls.
 * Response strategies are software settings, not validated research findings.
 */
import { supabase } from '../config/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TriggerTypeT = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';
export type CommunityTriggerType = 'C1_stagnation' | 'C2_participation_imbalance';
export type AllTriggerType = TriggerTypeT | CommunityTriggerType;

export type ResponseStrategy = 'auto' | 'triage' | 'teacher_review';

export const TRIGGER_LABELS: Record<AllTriggerType, { en: string; zh: string }> = {
  T1: { en: 'Undigested AI', zh: '未消化的AI内容' },
  T2: { en: 'No reasoning', zh: '缺少推理' },
  T3: { en: 'No evidence', zh: '缺少证据' },
  T4: { en: 'No connection', zh: '缺少连接' },
  T5: { en: 'Promising seed', zh: '有潜力的想法' },
  T6: { en: 'Unclear', zh: '表达不清' },
  C1_stagnation: { en: 'Stagnation', zh: '讨论停滞' },
  C2_participation_imbalance: { en: 'Participation imbalance', zh: '参与不均衡' },
};

export const RESPONSE_STRATEGY: Record<AllTriggerType, ResponseStrategy> = {
  T1: 'auto',
  T2: 'triage',
  T3: 'teacher_review',
  T4: 'teacher_review',
  T5: 'teacher_review',
  T6: 'triage',
  C1_stagnation: 'auto',
  C2_participation_imbalance: 'auto',
};

export interface AIContext {
  current_note: {
    id: string;
    title: string;
    content: string;
    type: string;
    epistemic_status: string;
    revision_count: number;
    created_at: string;
    updated_at: string;
  };
  adjacent_notes: Array<{
    id: string;
    title: string;
    content_snippet: string;
    relation_type: string;
    direction: 'in' | 'out';
  }>;
  network_context: {
    heat_score: number;
    in_degree: number;
    out_degree: number;
    is_isolated: boolean;
    has_unresolved_challenge: boolean;
  };
  temporal_context: {
    time_since_last_activity_hours: number;
    recent_events_count: number;
  };
}

export interface StructuralFeatures {
  charLength: number;
  logCharLength: number;
  questionMarkCount: number;
  listMarkerCount: number;
  aiMentionCount: number;
  hasCode: boolean;
  reasoningMarkerCount: number;
  evidenceMarkerCount: number;
  connectiveCount: number;
  studentVoiceMarkerCount: number;
  replyDepth: number;
  buildOnCount: number;
  timeSinceLastActivityHours: number;
}

export interface TriggerResult {
  trigger_type: AllTriggerType;
  label: { en: string; zh: string };
  severity: 'low' | 'medium' | 'high';
  response_strategy: ResponseStrategy;
  note_id: string;
  space_id: string;
  prompt: string;
  rationale: string;
  structural_features?: StructuralFeatures;
  context: AIContext;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGNATION_HOURS = 48;
const GINI_THRESHOLD = 0.6;
const CONTENT_SNIPPET_LENGTH = 120;
const RECENT_EVENTS_WINDOW_HOURS = 72;

const MIN_CHARS_FOR_GATE = 50;
const T1_LONG_THRESHOLD = 800;
const T1_AI_MENTION_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// Structural Feature Extraction (Paper Section 3.4)
// ---------------------------------------------------------------------------

const AI_PATTERNS = /ChatGPT|GPT-?[34o]|AI助手|人工智能|大模型|语言模型|Copilot|Claude|Gemini|DeepSeek|Kimi|文心|通义|豆包|智谱/gi;
const REASONING_PATTERNS = /because|therefore|since|thus|hence|so that|in order to|consequently|as a result|implies|suggests that|因为|所以|由于|因此|从而|导致|说明|可见|意味着|推断|既然/gi;
const EVIDENCE_PATTERNS = /evidence|data|study|research|experiment|survey|according to|source|reference|findings|例如|比如|研究表明|实验|数据|调查|根据|文献|案例|证据/gi;
const CONNECTIVE_PATTERNS = /however|but|although|while|in contrast|on the other hand|similarly|moreover|furthermore|in addition|related to|connects? to|builds? on|但是|然而|虽然|同时|此外|相比|类似|与此同时|另一方面|不过|相关|联系/gi;
const STUDENT_VOICE_PATTERNS = /I think|I believe|in my opinion|I wonder|I notice|my understanding|I disagree|I agree|let me|from my perspective|我认为|我觉得|我想|我注意到|我不同意|我同意|据我|我发现|我的理解|依我看/gi;
const LIST_MARKER_PATTERNS = /(?:^|\n)\s*[-•*]\s|(?:^|\n)\s*\d+[.)]\s|(?:^|\n)\s*[a-zA-Z][.)]\s/g;
const QUESTION_PATTERNS = /[?？]/g;

export function extractStructuralFeatures(
  text: string,
  replyDepth = 0,
  buildOnCount = 0,
  timeSinceLastActivityHours = 0,
): StructuralFeatures {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const charLength = plain.length;

  return {
    charLength,
    logCharLength: charLength > 0 ? Math.log(charLength) : 0,
    questionMarkCount: (plain.match(QUESTION_PATTERNS) ?? []).length,
    listMarkerCount: (plain.match(LIST_MARKER_PATTERNS) ?? []).length,
    aiMentionCount: (plain.match(AI_PATTERNS) ?? []).length,
    hasCode: /```|<code|<pre|function\s*\(|def |class |import |const |let |var /i.test(plain),
    reasoningMarkerCount: (plain.match(REASONING_PATTERNS) ?? []).length,
    evidenceMarkerCount: (plain.match(EVIDENCE_PATTERNS) ?? []).length,
    connectiveCount: (plain.match(CONNECTIVE_PATTERNS) ?? []).length,
    studentVoiceMarkerCount: (plain.match(STUDENT_VOICE_PATTERNS) ?? []).length,
    replyDepth,
    buildOnCount,
    timeSinceLastActivityHours,
  };
}

// ---------------------------------------------------------------------------
// Gate Decision (Stage 1) — Default = silence
// ---------------------------------------------------------------------------

export function gateDecision(f: StructuralFeatures): boolean {
  if (f.charLength < MIN_CHARS_FOR_GATE) return false;

  // T1 signal: long content + AI mentions + no student voice
  if (f.charLength > T1_LONG_THRESHOLD && f.aiMentionCount >= T1_AI_MENTION_THRESHOLD && f.studentVoiceMarkerCount === 0) {
    return true;
  }

  // T1 signal: very long content with no reasoning, no questions, no student voice
  if (f.charLength > 1200 && f.studentVoiceMarkerCount === 0 && f.questionMarkCount === 0 && f.reasoningMarkerCount === 0) {
    return true;
  }

  // T2 signal: medium+ content, no reasoning markers, no questions
  if (f.charLength >= 100 && f.reasoningMarkerCount === 0 && f.questionMarkCount === 0 && f.evidenceMarkerCount === 0) {
    return true;
  }

  // T3 signal: has claim-like patterns but no evidence markers
  if (f.charLength >= 100 && f.reasoningMarkerCount >= 1 && f.evidenceMarkerCount === 0) {
    return true;
  }

  // T4 signal: list-heavy content with no connectives
  if (f.listMarkerCount >= 3 && f.connectiveCount === 0) {
    return true;
  }

  // T5 signal: short-to-medium content with some good indicators but could go deeper
  if (f.charLength >= 80 && f.charLength <= 400 && f.studentVoiceMarkerCount >= 1 && f.reasoningMarkerCount === 0 && f.buildOnCount === 0) {
    return true;
  }

  // T6 signal: very short with question marks (unanswered question)
  if (f.charLength >= MIN_CHARS_FOR_GATE && f.charLength <= 200 && f.questionMarkCount >= 2 && f.reasoningMarkerCount === 0) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Type Classification (Stage 2) — Heuristic
// ---------------------------------------------------------------------------

export function classifyTriggerType(f: StructuralFeatures): { type: TriggerTypeT; confidence: number; rationale: string } {
  // T1: Undigested AI — highest priority check
  const t1Score = computeT1Score(f);
  if (t1Score > 0.6) {
    return { type: 'T1', confidence: t1Score, rationale: 'Long content with AI markers and no student voice' };
  }

  // T6: Unclear — check before T2/T3 since unclear notes need different handling
  if (f.charLength <= 200 && f.questionMarkCount >= 2 && f.reasoningMarkerCount === 0 && f.evidenceMarkerCount === 0) {
    return { type: 'T6', confidence: 0.5, rationale: 'Short content with multiple questions, no clear reasoning' };
  }

  // T4: No connection — list-heavy without connectives
  if (f.listMarkerCount >= 3 && f.connectiveCount === 0) {
    const conf = Math.min(0.7, 0.4 + f.listMarkerCount * 0.1);
    return { type: 'T4', confidence: conf, rationale: 'Multiple list items without connecting language' };
  }

  // T3: No evidence — has reasoning but no evidence
  if (f.reasoningMarkerCount >= 1 && f.evidenceMarkerCount === 0 && f.charLength >= 100) {
    return { type: 'T3', confidence: 0.45, rationale: 'Claims with reasoning but no supporting evidence' };
  }

  // T2: No reasoning — opinion without why
  if (f.reasoningMarkerCount === 0 && f.questionMarkCount === 0 && f.evidenceMarkerCount === 0 && f.charLength >= 100) {
    return { type: 'T2', confidence: 0.5, rationale: 'Opinion stated without reasoning chain' };
  }

  // T5: Promising seed — fallback for notes that have some quality but could go deeper
  if (f.studentVoiceMarkerCount >= 1 || f.questionMarkCount >= 1) {
    return { type: 'T5', confidence: 0.35, rationale: 'Shows student voice but could be developed further' };
  }

  // Default to T2 (most common type per paper: 26.1% of need=1 notes)
  return { type: 'T2', confidence: 0.3, rationale: 'General lack of reasoning depth' };
}

function computeT1Score(f: StructuralFeatures): number {
  let score = 0;

  // Length signals (paper: note length is #1 feature)
  if (f.charLength > 2000) score += 0.35;
  else if (f.charLength > T1_LONG_THRESHOLD) score += 0.2;

  // AI mention signals
  if (f.aiMentionCount >= 3) score += 0.25;
  else if (f.aiMentionCount >= T1_AI_MENTION_THRESHOLD) score += 0.15;

  // Absence of student voice is critical
  if (f.studentVoiceMarkerCount === 0) score += 0.25;

  // No questions asked (passive consumption)
  if (f.questionMarkCount === 0) score += 0.1;

  // Has code blocks (common in AI paste)
  if (f.hasCode && f.charLength > T1_LONG_THRESHOLD) score += 0.1;

  // List-heavy (AI tends to produce structured lists)
  if (f.listMarkerCount >= 5) score += 0.1;

  // Penalty for student engagement signals
  if (f.studentVoiceMarkerCount >= 2) score -= 0.3;
  if (f.questionMarkCount >= 2) score -= 0.15;
  if (f.reasoningMarkerCount >= 2) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

function computeSeverity(type: TriggerTypeT, f: StructuralFeatures): TriggerResult['severity'] {
  switch (type) {
    case 'T1':
      return f.charLength > 2000 && f.studentVoiceMarkerCount === 0 ? 'high' : 'medium';
    case 'T2':
      return f.charLength > 500 && f.reasoningMarkerCount === 0 ? 'high' : f.charLength > 200 ? 'medium' : 'low';
    case 'T3':
      return f.reasoningMarkerCount >= 2 && f.evidenceMarkerCount === 0 ? 'high' : 'medium';
    case 'T4':
      return f.listMarkerCount >= 5 && f.connectiveCount === 0 ? 'high' : 'medium';
    case 'T5':
      return 'low';
    case 'T6':
      return f.charLength < 100 ? 'high' : 'medium';
    default:
      return 'medium';
  }
}

// ---------------------------------------------------------------------------
// Prompt Generation — Theory-grounded, EFA format
// ---------------------------------------------------------------------------

export function generatePrompt(type: AllTriggerType, context: AIContext): string {
  const title = context.current_note.title;

  switch (type) {
    case 'T1':
      return (
        `"${title}"中包含大量AI生成的内容，但缺少你自己的声音。` +
        `试着用自己的话提炼其中最关键的一两个观点，加上你自己的理解、疑问或反思。` +
        `AI的输出是素材，不是终点——你的想法才是知识建构的核心。\n\n` +
        `"${title}" contains substantial AI-generated content without student framing. ` +
        `Try distilling the key insight in your own words and adding your interpretation, ` +
        `questions, or critique. AI output is raw material, not the finished idea.`
      );

    case 'T2':
      return (
        `"${title}"提出了一个观点，但还缺少推理过程。` +
        `能否解释一下"为什么"？加上你的推理链条——是什么让你这样认为？` +
        `有什么前提假设？这会让你的想法更有说服力，也更容易被同学们深入讨论。\n\n` +
        `"${title}" states a position without explaining why. ` +
        `Can you add your reasoning chain — what leads you to this conclusion? ` +
        `What assumptions are you making? This will make your idea more buildable.`
      );

    case 'T3':
      return (
        `"${title}"中有一些知识主张，但缺少支撑的证据。` +
        `能否加入一个具体的例子、数据、引用或亲身经历来支持你的论点？` +
        `即使是日常观察也比空洞的断言更有建设性。\n\n` +
        `"${title}" makes claims that lack supporting evidence. ` +
        `Can you add a concrete example, data point, citation, or personal observation ` +
        `to support your argument? Even everyday observations strengthen the discourse.`
      );

    case 'T4':
      return (
        `"${title}"列出了多个要点，但它们之间的联系还不清楚。` +
        `试着加一两句话说明这些想法之间的关系——是互补、矛盾、还是因果？` +
        `同时看看社区中有没有同学提出了相关的观点可以连接起来。\n\n` +
        `"${title}" lists several points without connecting them. ` +
        `Try adding a sentence explaining how these ideas relate — are they complementary, ` +
        `contradictory, or causal? Also check if peers have related ideas you could build on.`
      );

    case 'T5':
      return (
        `"${title}"有一个很好的想法种子！能否再深入一步？` +
        `比如：这个想法在什么条件下可能不成立？它和其他同学的观点有什么联系？` +
        `如果再推进一步，它意味着什么？\n\n` +
        `"${title}" contains a promising insight that could go deeper! ` +
        `Consider: Under what conditions might this not hold? How does it connect ` +
        `to peers' ideas? What would it imply if pushed one step further?`
      );

    case 'T6':
      return (
        `"${title}"中的一些表述还不太清楚，或者有一个问题可能还没有得到充分回应。` +
        `能否具体说明你指的是哪个概念或关系？清晰的表达会帮助同学们更好地参与讨论。\n\n` +
        `"${title}" has unclear meaning or a question that risks going unanswered. ` +
        `Can you specify the concept or relationship you're referring to? ` +
        `Clarity will help classmates engage productively.`
      );

    case 'C1_stagnation':
      return (
        `"${title}"的讨论已经有一段时间没有新的进展了。` +
        `是否有新的证据、视角或问题可以推动讨论继续深入？\n\n` +
        `The discussion around "${title}" has stalled. ` +
        `Are there new evidence, perspectives, or questions that could move it forward?`
      );

    case 'C2_participation_imbalance':
      return (
        `注意到社区的参与度不太均衡，讨论主要集中在少数参与者。` +
        `每个人的观点都很重要——欢迎更多同学分享自己的想法。\n\n` +
        `Participation is uneven — the discussion is dominated by a few contributors. ` +
        `Every perspective matters. We'd love to hear more voices.`
      );

    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

export function calculateGini(values: number[]): number {
  const n = values.length;
  if (n <= 1) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;

  let weightedSum = 0;
  for (let i = 0; i < n; i++) {
    weightedSum += (2 * (i + 1) - n - 1) * sorted[i];
  }

  return weightedSum / (n * sum);
}

function hoursSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function snippet(text: string | null | undefined, maxLen = CONTENT_SNIPPET_LENGTH): string {
  if (!text) return '';
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}...`;
}

// ---------------------------------------------------------------------------
// buildContext
// ---------------------------------------------------------------------------

export async function buildContext(noteId: string): Promise<AIContext> {
  const [noteRes, outRes, inRes, metricsRes, eventsRes] = await Promise.all([
    supabase
      .from('notes')
      .select('id, title, content, type, epistemic_status, created_at, updated_at')
      .eq('id', noteId)
      .single(),

    supabase
      .from('relations')
      .select('relation_type, target_note_id, notes!relations_target_note_id_fkey(id, title, content)')
      .eq('source_note_id', noteId),

    supabase
      .from('relations')
      .select('relation_type, source_note_id, notes!relations_source_note_id_fkey(id, title, content)')
      .eq('target_note_id', noteId),

    supabase
      .from('note_metrics_realtime')
      .select('heat_score, build_on_count, challenge_count, evidence_count, revision_count')
      .eq('note_id', noteId)
      .single(),

    supabase
      .from('events')
      .select('created_at')
      .eq('target_note_id', noteId)
      .gte('created_at', new Date(Date.now() - RECENT_EVENTS_WINDOW_HOURS * 3600_000).toISOString())
      .order('created_at', { ascending: false }),
  ]);

  if (noteRes.error || !noteRes.data) {
    throw new Error(`[TriggerEngine] Note ${noteId} not found: ${noteRes.error?.message}`);
  }

  const note = noteRes.data;

  const outgoing: AIContext['adjacent_notes'] = (outRes.data ?? []).map((r: any) => {
    const linked = r.notes;
    return {
      id: linked?.id ?? r.target_note_id,
      title: linked?.title ?? '',
      content_snippet: snippet(linked?.content),
      relation_type: r.relation_type,
      direction: 'out' as const,
    };
  });

  const incoming: AIContext['adjacent_notes'] = (inRes.data ?? []).map((r: any) => {
    const linked = r.notes;
    return {
      id: linked?.id ?? r.source_note_id,
      title: linked?.title ?? '',
      content_snippet: snippet(linked?.content),
      relation_type: r.relation_type,
      direction: 'in' as const,
    };
  });

  const adjacent_notes = [...outgoing, ...incoming];

  const inDegree = incoming.length;
  const outDegree = outgoing.length;
  const metrics = metricsRes.error ? null : metricsRes.data;
  const hasUnresolvedChallenge =
    incoming.some((a) => a.relation_type === 'challenge') &&
    (metrics?.evidence_count ?? 0) === 0;

  const network_context: AIContext['network_context'] = {
    heat_score: metrics?.heat_score ?? 0,
    in_degree: inDegree,
    out_degree: outDegree,
    is_isolated: inDegree === 0 && outDegree === 0,
    has_unresolved_challenge: hasUnresolvedChallenge,
  };

  const events = eventsRes.data ?? [];
  const lastEventTime = events.length > 0 ? events[0].created_at : note.updated_at;
  const temporal_context: AIContext['temporal_context'] = {
    time_since_last_activity_hours: hoursSince(lastEventTime),
    recent_events_count: events.length,
  };

  return {
    current_note: {
      id: note.id,
      title: note.title,
      content: note.content,
      type: note.type,
      epistemic_status: note.epistemic_status,
      revision_count: metrics?.revision_count ?? 0,
      created_at: note.created_at,
      updated_at: note.updated_at,
    },
    adjacent_notes,
    network_context,
    temporal_context,
  };
}

// ---------------------------------------------------------------------------
// detectTriggers — Main entry point
// ---------------------------------------------------------------------------

export async function detectTriggers(spaceId: string): Promise<TriggerResult[]> {
  const { data: notes, error: notesErr } = await supabase
    .from('notes')
    .select(`
      id, title, content, type, epistemic_status, author_id, created_at, updated_at,
      note_metrics_realtime (
        heat_score, build_on_count, challenge_count, evidence_count,
        synthesis_count, revision_count, unique_contributor_count
      )
    `)
    .eq('space_id', spaceId)
    .is('deleted_at', null);

  if (notesErr) {
    console.error('[TriggerEngine] Failed to fetch notes for space', spaceId, notesErr.message);
    return [];
  }

  if (!notes || notes.length === 0) return [];

  const noteIds = notes.map((n: any) => n.id);

  // Parallel fetches for context
  const [latestEventsRes, inRelsRes, outRelsRes, buildOnsByUserRes] = await Promise.all([
    supabase
      .from('events')
      .select('target_note_id, created_at')
      .in('target_note_id', noteIds)
      .order('created_at', { ascending: false }),

    supabase
      .from('relations')
      .select('target_note_id, relation_type')
      .in('target_note_id', noteIds),

    supabase
      .from('relations')
      .select('source_note_id')
      .in('source_note_id', noteIds),

    supabase
      .from('relations')
      .select('creator_id')
      .in('target_note_id', noteIds),
  ]);

  // Last activity per note
  const lastActivityMap = new Map<string, string>();
  for (const ev of latestEventsRes.data ?? []) {
    if (!lastActivityMap.has(ev.target_note_id)) {
      lastActivityMap.set(ev.target_note_id, ev.created_at);
    }
  }

  // In-degree and out-degree maps
  const inDegreeMap = new Map<string, number>();
  for (const r of inRelsRes.data ?? []) {
    inDegreeMap.set(r.target_note_id, (inDegreeMap.get(r.target_note_id) ?? 0) + 1);
  }

  const outDegreeMap = new Map<string, number>();
  for (const r of outRelsRes.data ?? []) {
    outDegreeMap.set(r.source_note_id, (outDegreeMap.get(r.source_note_id) ?? 0) + 1);
  }

  // Participation imbalance
  const userBuildOnCounts = new Map<string, number>();
  for (const r of buildOnsByUserRes.data ?? []) {
    if (r.creator_id) {
      userBuildOnCounts.set(r.creator_id, (userBuildOnCounts.get(r.creator_id) ?? 0) + 1);
    }
  }
  const gini = calculateGini(Array.from(userBuildOnCounts.values()));

  // ── Walk notes: gate → classify → generate ──
  const triggers: TriggerResult[] = [];

  for (const note of notes as any[]) {
    const metrics = Array.isArray(note.note_metrics_realtime)
      ? note.note_metrics_realtime[0]
      : note.note_metrics_realtime;

    const buildOnCount: number = metrics?.build_on_count ?? 0;
    const lastActivity = lastActivityMap.get(note.id) ?? note.updated_at;
    const hoursSinceActivity = hoursSince(lastActivity);
    const content = (note.content ?? '') as string;

    // Skip teacher-generated or view/riseabove type notes for T1-T6
    if (note.type === 'view') continue;

    // ── Stage 1: Structural gate ──
    const features = extractStructuralFeatures(
      content,
      0, // reply depth not easily available here
      buildOnCount,
      hoursSinceActivity,
    );

    if (gateDecision(features)) {
      // ── Stage 2: Type classification ──
      const { type, rationale } = classifyTriggerType(features);
      const severity = computeSeverity(type, features);

      const ctx = await buildContext(note.id);
      const label = TRIGGER_LABELS[type];
      const strategy = RESPONSE_STRATEGY[type];

      triggers.push({
        trigger_type: type,
        label,
        severity,
        response_strategy: strategy,
        note_id: note.id,
        space_id: spaceId,
        prompt: generatePrompt(type, ctx),
        rationale,
        structural_features: features,
        context: ctx,
      });
    }

    // ── Community trigger C1: Stagnation ──
    if (buildOnCount >= 3 && hoursSinceActivity >= STAGNATION_HOURS) {
      const ctx = await buildContext(note.id);
      triggers.push({
        trigger_type: 'C1_stagnation',
        label: TRIGGER_LABELS.C1_stagnation,
        severity: hoursSinceActivity >= STAGNATION_HOURS * 2 ? 'high' : 'medium',
        response_strategy: 'auto',
        note_id: note.id,
        space_id: spaceId,
        prompt: generatePrompt('C1_stagnation', ctx),
        rationale: `No activity for ${Math.round(hoursSinceActivity)}h on active discussion (${buildOnCount} build-ons)`,
        context: ctx,
      });
    }
  }

  // ── Community trigger C2: Participation imbalance ──
  if (gini > GINI_THRESHOLD && notes.length >= 5) {
    const hottest = (notes as any[]).reduce((best, n) => {
      const m = Array.isArray(n.note_metrics_realtime)
        ? n.note_metrics_realtime[0]
        : n.note_metrics_realtime;
      const score = m?.heat_score ?? 0;
      return score > (best.score ?? 0) ? { note: n, score } : best;
    }, { note: null as any, score: -1 });

    if (hottest.note) {
      const ctx = await buildContext(hottest.note.id);
      triggers.push({
        trigger_type: 'C2_participation_imbalance',
        label: TRIGGER_LABELS.C2_participation_imbalance,
        severity: gini > 0.8 ? 'high' : 'medium',
        response_strategy: 'auto',
        note_id: hottest.note.id,
        space_id: spaceId,
        prompt: generatePrompt('C2_participation_imbalance', ctx),
        rationale: `Gini coefficient ${gini.toFixed(2)} exceeds threshold ${GINI_THRESHOLD}`,
        context: ctx,
      });
    }
  }

  console.log(
    `[TriggerEngine] Detected ${triggers.length} trigger(s) in space ${spaceId}: ` +
    triggers.map((t) => `${t.trigger_type}(${t.severity})`).join(', '),
  );

  return triggers;
}
