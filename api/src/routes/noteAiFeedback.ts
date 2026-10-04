import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { deriveAiNoteTitle } from '../services/aiNoteTitle';
import { ensureCourseInstructor, ensureSpaceAccess, isCourseStaff, type CourseStanding } from '../services/accessControl';
import { assertSafePublicUrl } from '../services/urlGuard';
import { resolveEffectiveCondition, logSuppressedIntervention } from '../services/experimentCondition';
import { trimAtSentence } from '../services/textTrim';
import { sanitizeNoteHtml } from '../services/noteHtml';
import { decryptProviderApiKey, withFastChatOptions } from '../services/aiProviderConfig';
import {
  isDmxProvider,
  pickModels,
  pickNativeModel,
  orderConfigsByHealth,
  reportModelFailure,
  reportModelSuccess,
  reportProviderFailure,
  reportProviderSuccess,
  classifyHttpFailure,
} from '../services/modelRouter';
import { aiFetch } from '../services/aiGateway';
import { CHAT_ENDPOINTS, MODELS_ENDPOINTS } from '../services/providerEndpoints';
import {
  choiceModelFor,
  featureChoice,
  getAiFeature,
  preferChoice,
  sortByOrder,
  type CourseAiRow,
} from '../services/aiFeatureModels';

const router = Router();

/**
 * 六类，和 T1–T6 一一对应。曾经还有 evidence_gap / uncertainty /
 * weak_synthesis / clarification_needed 四个，但 LLM 按 T1–T6 输出、映射表也只映
 * 到这六类，那四个模型根本产不出来。数据库约束保留了它们的宽度：生产库里还有
 * 早期版本写下的行，收窄约束会在校验现存行时直接失败，也会断掉研究数据的连续性。
 */
type FeedbackTriggerType =
  | 'undigested_ai' | 'no_reasoning' | 'no_evidence'
  | 'no_connection' | 'promising_seed' | 'unclear';
type FeedbackStatus = 'new' | 'accepted' | 'ignored' | 'followed_up' | 'inserted' | 'rejected';

type FeedbackRow = {
  id: string;
  note_id: string;
  space_id: string;
  course_id: string;
  user_id: string;
  provider_id: string | null;
  model: string | null;
  trigger_type: FeedbackTriggerType;
  trigger_context: Record<string, unknown>;
  draft_excerpt: string;
  feedback_text: string;
  status: FeedbackStatus;
  response_text?: string | null;
  created_at: string;
  responded_at?: string | null;
  /** 采纳后自动发布的那条笔记；为空表示尚未采纳。 */
  published_note_id?: string | null;
  /** status=rejected 时学生填的理由（可选补充）。 */
  rejection_reason?: string | null;
  /** status=rejected 时的归类，必填。 */
  rejection_tag?: string | null;
  suggested_scaffold?: string | null;
  suggested_scaffold_used_at?: string | null;
};

function paramString(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new ApiError(400, `${name} is required`);
  return value;
}

function stripHtml(value?: string): string {
  return (value ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function feedbackToApi(row: FeedbackRow, opts: { hideScaffold?: boolean } = {}) {
  return {
    id: row.id,
    noteId: row.note_id,
    spaceId: row.space_id,
    courseId: row.course_id,
    userId: row.user_id,
    providerId: row.provider_id,
    model: row.model,
    triggerType: row.trigger_type,
    triggerContext: row.trigger_context ?? {},
    draftExcerpt: row.draft_excerpt,
    feedbackText: row.feedback_text,
    status: row.status,
    responseText: row.response_text,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    publishedNoteId: row.published_note_id ?? null,
    rejectionReason: row.rejection_reason ?? null,
    rejectionTag: row.rejection_tag ?? null,
    suggestedScaffold: opts.hideScaffold ? null : row.suggested_scaffold ?? null,
    suggestedScaffoldUsedAt: row.suggested_scaffold_used_at ?? null,
  };
}

async function getNoteContext(noteId: string) {
  const { data, error } = await supabase
    .from('notes')
    .select('id, title, content, space_id, author_id, spaces!inner(id, course_id, group_id)')
    .eq('id', noteId)
    .is('deleted_at', null)
    .single();

  if (error || !data) throw new ApiError(404, 'Note not found');
  const space = Array.isArray((data as any).spaces) ? (data as any).spaces[0] : (data as any).spaces;
  return {
    id: data.id as string,
    title: data.title as string,
    content: (data.content as string | null) ?? '',
    spaceId: data.space_id as string,
    spaceGroupId: (space.group_id as string | null) ?? null,
    authorId: data.author_id as string,
    courseId: space.course_id as string,
  };
}

/**
 * 按笔记所在的空间授权，返回调用者的课内身份。所有人都过 ensureSpaceAccess，
 * 不只是课程成员：绑定小组的空间只对本组开放，整群随机实验靠它隔离组间污染。
 * 只查课程的话，组 A 的学生拿到组 B 笔记的 id，就能让 /request 用那条笔记的
 * 存储正文生成反馈、带回草稿摘录，还能在别组的空间里写反馈行和插入记录。
 *
 * 教职按课内身份算，平台身份是教师不算数：凭学生验证码入课的教师账号在这门课里
 * 是被试，和学生一样用这些功能、一样只看自己的反馈、对照组一样抹支架。
 * 下游凡是区分「教职 / 其他人」的地方，都用这里返回的身份，不看 req.user.role。
 */
async function requireNoteAccess(note: { spaceId: string }, req: Request) {
  if (!req.user) throw new ApiError(401, 'Authentication required');
  return (await ensureSpaceAccess(note.spaceId, req.user)).standing;
}

/**
 * AI 支架受对照组门控，不只在生成那一刻：分组前（基线周）生成的反馈行里已经存着
 * suggested_scaffold，支架选择器会把 status='new' 那条的支架一直摆在最上面。
 * 所以对照组的被试从任何接口读到的反馈行都不带它；卡片本身已经送达，不收回。
 * 课程教职不是被试。
 */
async function hidesAiScaffold(courseId: string, standing: CourseStanding, req: Request): Promise<boolean> {
  if (isCourseStaff(standing)) return false;
  const { condition } = await resolveEffectiveCondition(courseId, req.user!.id);
  return condition === 'control';
}

async function logEvent(req: Request, eventType: string, objectId: string, spaceId: string, metadata: Record<string, unknown>) {
  await supabase.from('events').insert({
    actor_id: req.user?.id,
    actor_role: req.user?.role,
    event_type: eventType,
    object_type: 'note_ai_feedback',
    object_id: objectId,
    space_id: spaceId,
    metadata_json: metadata,
  });
}

interface TriggerSettings {
  enabled_triggers: string[];
  cooldown_seconds: number;
  auto_feedback_enabled: boolean;
  custom_context: string;
  sensitivity: 'conservative' | 'balanced' | 'aggressive';
  max_feedback_length: number;
  /** auto = 量规原文「与学生同语言」；zh / en = 教师指定，覆盖那一条 */
  response_language: 'auto' | 'zh' | 'en';
}

const DEFAULT_TRIGGER_SETTINGS: TriggerSettings = {
  enabled_triggers: ['undigested_ai', 'no_reasoning', 'no_evidence', 'no_connection', 'promising_seed', 'unclear'],
  cooldown_seconds: 120,
  auto_feedback_enabled: true,
  custom_context: '',
  sensitivity: 'balanced',
  max_feedback_length: 300,
  response_language: 'auto',
};

async function fetchTriggerSettings(courseId: string): Promise<TriggerSettings> {
  // Multiple provider rows may exist per course; pick the newest row that
  // actually has settings so reads are deterministic.
  const { data } = await supabase
    .from('teacher_ai_configs')
    .select('trigger_settings, configured_at')
    .eq('course_id', courseId)
    .order('configured_at', { ascending: false });
  const row = (data ?? []).find(
    (r: any) => r.trigger_settings && Object.keys(r.trigger_settings).length > 0,
  );
  return { ...DEFAULT_TRIGGER_SETTINGS, ...(row?.trigger_settings as Partial<TriggerSettings> ?? {}) };
}

interface ProviderCandidate {
  providerId: string;
  model: string;
  apiKey: string;
  endpointUrl: string | null;
}

/**
 * Ordered failover chain for the course: the model chosen for AI feedback in
 * the course AI settings goes first (the teacher's pick, else DeepSeek Flash
 * when the course has a DeepSeek key — see services/aiFeatureModels), then
 * native keys (zhipu → deepseek, newest models), then DMX (fast tier — the
 * gate is a JSON micro-task). Health ordering still sinks a provider that is
 * cooling down or has no free slot, so the choice never blocks fallback.
 *
 * 学生在 AI 助手里选的模型不再决定反馈用哪个：以前请求里带的 provider_id 会排到最前，
 * 教师在设置页就说不清反馈到底用哪个模型。现在按功能设置走，请求里那两个字段不再参与。
 */
async function resolveProviderCandidates(courseId: string): Promise<ProviderCandidate[]> {
  // 不在查询里滤掉没有 key 的行：功能设置可能存在任何一行上
  const { data, error } = await supabase
    .from('teacher_ai_configs')
    .select('provider_id, api_key_encrypted, endpoint_url, is_verified, enabled_models, configured_at, trigger_settings')
    .eq('course_id', courseId)
    .order('configured_at', { ascending: false });
  if (error) throw new ApiError(500, error.message);

  const rows = (data ?? []) as CourseAiRow[];
  const withKeys = rows.filter(c => c.api_key_encrypted && c.provider_id !== 'tavily');
  if (withKeys.length === 0) return [];

  const choice = featureChoice('note_feedback', rows);
  const ordered = orderConfigsByHealth(preferChoice(sortByOrder(withKeys, getAiFeature('note_feedback').order), choice));

  const candidates: ProviderCandidate[] = [];
  const seenProviders = new Set<string>();
  for (const config of ordered) {
    if (seenProviders.has(config.provider_id)) continue;
    seenProviders.add(config.provider_id);

    let apiKey: string;
    try {
      apiKey = decryptProviderApiKey(config.api_key_encrypted as string);
    } catch {
      continue;
    }

    const enabledModels = Array.isArray(config.enabled_models) ? config.enabled_models as string[] : [];
    const chosenModel = choiceModelFor(choice, config.provider_id);

    if (isDmxProvider(config.provider_id)) {
      const tier = pickModels('fast');
      const models = chosenModel ? [chosenModel, ...tier.filter(m => m !== chosenModel)] : tier;
      for (const model of models.slice(0, 2)) {
        candidates.push({
          providerId: config.provider_id,
          model,
          apiKey,
          endpointUrl: (config.endpoint_url as string | null) ?? null,
        });
      }
      continue;
    }

    const model = chosenModel ?? pickNativeModel(config.provider_id, enabledModels);
    if (!model) continue;
    candidates.push({
      providerId: config.provider_id,
      model,
      apiKey,
      endpointUrl: (config.endpoint_url as string | null) ?? null,
    });
  }
  return candidates;
}

async function resolveProvider(courseId: string) {
  const candidates = await resolveProviderCandidates(courseId);
  return candidates[0] ?? null;
}

// ── Structural pre-filter (cheap, no LLM call) ──────────────────────────────

function prefilterNote(text: string): boolean {
  // Chinese has no whitespace between words — whitespace splitting counted a
  // whole Chinese note as ~1 "word" and silently disabled auto feedback.
  // Count CJK chars as words, like the frontend word counter does.
  const cjkChars = (text.match(/[一-龥]/g) ?? []).length;
  const latinWords = (text.replace(/[一-龥]/g, ' ').match(/\b[\w']+\b/g) ?? []).length;
  const wordCount = cjkChars + latinWords;
  // The flat 100-char floor was tuned for English (~20 words). A CJK-dominant
  // note of ~40 chars carries the same substance; the flat floor silently
  // filtered out most real Chinese notes.
  const minLength = cjkChars >= wordCount / 2 ? 40 : 100;
  return wordCount >= 20 && text.length >= minLength;
}

// ── Contextual features for LLM prompt ───────────────────────────────────────

async function fetchBoardContext(spaceId: string, noteId: string) {
  const [boardSize, buildOnCount, aiMentionNotes] = await Promise.all([
    supabase.from('notes').select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId).is('deleted_at', null),
    supabase.from('relations').select('id', { count: 'exact', head: true })
      .eq('target_note_id', noteId),
    supabase.from('notes').select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId).is('deleted_at', null)
      .eq('is_ai_generated', true),
  ]);
  return {
    boardNoteCount: boardSize.count ?? 0,
    buildOnCount: buildOnCount.count ?? 0,
    aiBuildOnCount: aiMentionNotes.count ?? 0,
  };
}

function computeStructuralSignals(text: string) {
  return {
    charLength: text.length,
    questionMarkCount: (text.match(/[?？]/g) ?? []).length,
    listMarkerCount: (text.match(/(?:^|\n)\s*[-•*]\s|(?:^|\n)\s*\d+[.)]\s/g) ?? []).length,
    aiMentionCount: (text.match(/ChatGPT|GPT|AI助手|人工智能|大模型|语言模型|Copilot|Claude|Gemini/gi) ?? []).length,
    hasCode: /```|<code|<pre|function\s*\(|def |class |import /i.test(text),
  };
}

// ── T1-T6 Rubric for combined gate + type + feedback LLM call ────────────────

const TRIGGER_RUBRIC = `You are the trigger & feedback model for an AI facilitator in a Knowledge-Building platform.

## Task
For the given student note, decide (1) whether AI feedback is warranted, and (2) if so, generate feedback.

## T1-T6 Trigger Taxonomy

| Type | Label | Signal |
|------|-------|--------|
| T1 | Undigested AI | Long pasted AI/LLM output with ZERO student voice — no framing, selection, critique, or application |
| T2 | No reasoning | Opinion or plan stated without "why" or reasoning chain |
| T3 | No evidence | Strong factual claim without support, or factually incorrect |
| T4 | No connection | Lists points without connecting them; ignores related peer ideas |
| T5 | Promising seed | Promising insight that stops short; one push could deepen it (POSITIVE) |
| T6 | Unclear | Meaning unclear, or genuine question at risk of going unanswered |

## Decision Rules — DEFAULT = SILENCE (need=0)
- Student used own words to reason, even if imperfect → need=0
- Correct, complete algorithm/code → need=0
- Sincere reflection that reaches its own conclusion → need=0
- Short but on-point follow-up that advances discussion → need=0
- Social/logistics post → need=0
- If student frames AI output, curates, reacts, applies, or adds personal analysis → need=0 or T5

## Signals that DO warrant feedback (need=1) — do not stay silent on these
- Note ends STUCK: explicitly cannot articulate, distinguish, or decide
  (说不清 / 不知道 / 分不清 / 搞不懂 / 想不明白 / "not sure how/why") → T6.
  A student naming their confusion is asking for help, not reflecting idly.
- Absolute claim (肯定 / 必然 / 所有…都 / completely / always / never) whose only
  "support" is another unsupported assertion → T3.
- Hedged hunch with a live question the student clearly wants answered → T6,
  or T5 if the hunch itself is promising.

## Choosing among types
- Multiple issues? Pick the ONE with highest leverage.
- T1 vs T2: whose words? AI's (pasted) → T1. Student's own but no reasoning → T2.
- T2 vs T3: missing "why" → T2. Missing "evidence/facts" → T3.
- T5 is the ONLY positive trigger — idea is good but could go deeper.

## Feedback format (EFA three-part move, only if need=1)
1. **Progress**: One sentence acknowledging what the student did well — echo a phrase from THEIR note, never generic praise.
2. **Gap**: One sentence naming the specific discourse gap (tied to trigger type).
3. **Direction**: EXACTLY ONE guiding question or concrete next step.

HARD LIMITS: 3 sentences max, ~100 Chinese characters (or ~50 English words) TOTAL.
Plain text only — no headings, no lists, no emoji. This appears inline while the
student is writing: if it takes more than 10 seconds to read, it gets dismissed.
Use the same language as the student (Chinese or English). Do NOT rewrite the note.

## Adaptive scaffold (only if need=1)
Besides the feedback, write ONE half-sentence opener the student can continue writing from,
tailored to THIS note: name the specific concept, claim or classmate it points at.
It is a frame, not content: never state the answer, never finish the sentence.
<=20 Chinese characters (or <=12 English words), no trailing punctuation, same language as the student.
Examples by type — T2: "我认为X的原因是" ; T3: "支持这一点的依据是" ; T4: "这和同学Y的观点的关系是" ;
T5: "如果这个想法成立，那么" ; T6: "我说的X具体指的是" ; T1: "AI给出的这些内容，我自己的看法是".

## Output — return ONLY this JSON object, no other text:
{"need":0or1,"type":"T1"|"T2"|"T3"|"T4"|"T5"|"T6"|"","rationale":"<=20 words","feedback":"EFA feedback or empty if need=0","scaffold":"half-sentence opener or empty"}`;

// ── Fallback messages per trigger type ───────────────────────────────────────

const FALLBACK_FEEDBACK: Record<string, string> = {
  undigested_ai: '你引用了 AI 的回答——试试用自己的话提炼核心观点，加上你自己的理解或疑问。',
  no_reasoning: '你提出了一个观点。能否解释一下"为什么"？加上推理过程会让想法更有说服力。',
  no_evidence: '这个想法有一个知识主张。加入一个具体的例子、数据或来源来支撑它。',
  no_connection: '你列出了几个要点。试着加一句话说明它们之间是如何联系的。',
  promising_seed: '这个想法很有潜力！能否再深入一步——什么条件下它会不成立？或者它对其他同学的想法有什么启示？',
  unclear: '这段内容有些不太清楚。能否具体说明你指的是哪个概念或关系？',
};

// 与上表逐条对应。以前只有中文，英文笔记在模型失败时也会收到一条中文反馈。
const FALLBACK_FEEDBACK_EN: Record<string, string> = {
  undigested_ai: 'You quoted the AI\'s answer. Try restating its core point in your own words, and add your own understanding or question.',
  no_reasoning: 'You stated a view. Can you explain why? Adding your reasoning will make the idea more convincing.',
  no_evidence: 'This idea makes a knowledge claim. Add a concrete example, data, or source to support it.',
  no_connection: 'You listed several points. Try adding one sentence on how they connect to each other.',
  promising_seed: 'This idea has potential. Can you take it one step further: when would it not hold, or what does it suggest for your classmates\' ideas?',
  unclear: 'Part of this is unclear. Can you say specifically which concept or relationship you mean?',
};

type FeedbackLang = 'zh' | 'en';

/** 教师指定了就用指定的；auto 按学生写的语言，和量规原文一致。 */
function resolveFeedbackLang(setting: TriggerSettings['response_language'], sample: string): FeedbackLang {
  if (setting === 'zh' || setting === 'en') return setting;
  return hasCjk(sample) ? 'zh' : 'en';
}

function fallbackFeedback(type: string, lang: FeedbackLang): string {
  return (lang === 'zh' ? FALLBACK_FEEDBACK : FALLBACK_FEEDBACK_EN)[type] ?? '';
}

/**
 * 触发设置里的「AI 响应语言」。只覆盖量规里「与学生同语言」那一条：
 * EFA 三步、最多三句、JSON 输出这些约定一律不变。auto 时不追加任何内容，
 * 提示词与这项设置接入之前逐字相同。
 */
function languageDirective(setting: TriggerSettings['response_language']): string {
  if (setting === 'zh') {
    return '\n\nLANGUAGE (set by the teacher): write "feedback" and "scaffold" in Simplified Chinese, whatever language the note is written in. Every other rule above still applies.';
  }
  if (setting === 'en') {
    return '\n\nLANGUAGE (set by the teacher): write "feedback" and "scaffold" in English, whatever language the note is written in. Every other rule above still applies.';
  }
  return '';
}

/** LLM 没给出合格话头时的兜底。按学生用的语言选。 */
const FALLBACK_SCAFFOLD: Record<string, { zh: string; en: string }> = {
  undigested_ai: { zh: '对 AI 给出的内容，我自己的看法是', en: 'My own take on what the AI gave is' },
  no_reasoning: { zh: '我这样认为的原因是', en: 'The reason I think this is' },
  no_evidence: { zh: '支持这一点的依据是', en: 'The evidence for this is' },
  no_connection: { zh: '这和同学观点的关系是', en: 'How this relates to a classmate\'s idea is' },
  promising_seed: { zh: '如果这个想法成立，那么', en: 'If this idea holds, then' },
  unclear: { zh: '我具体指的是', en: 'What I mean specifically is' },
};
const hasCjk = (text: string) => /[\u4e00-\u9fff]/.test(text);
function pickScaffold(type: FeedbackTriggerType, sample: string, fromLlm?: string, lang?: FeedbackLang): string {
  const cleaned = (fromLlm ?? '').replace(/\s+/g, ' ').replace(/[。．.!！?？:：,，;；]+$/g, '').trim();
  // 太长的不是话头，是把答案写出来了；太短的没信息。都退回兜底。
  const okLen = hasCjk(cleaned) ? cleaned.length >= 3 && cleaned.length <= 24 : cleaned.split(' ').length >= 2 && cleaned.split(' ').length <= 14;
  // 教师指定了语言而模型没照做：话头会原样插进学生的笔记，换成对应语言的兜底
  const okLang = !lang || hasCjk(cleaned) === (lang === 'zh');
  if (cleaned && okLen && okLang) return cleaned;
  const fb = FALLBACK_SCAFFOLD[type];
  if (!fb) return '';
  return (lang ?? (hasCjk(sample) ? 'zh' : 'en')) === 'zh' ? fb.zh : fb.en;
}

const T_TYPE_TO_TRIGGER: Record<string, FeedbackTriggerType> = {
  T1: 'undigested_ai',
  T2: 'no_reasoning',
  T3: 'no_evidence',
  T4: 'no_connection',
  T5: 'promising_seed',
  T6: 'unclear',
};

// Must stay in sync with the note_ai_feedbacks_trigger_type_check constraint —
// an unlisted value makes the insert fail at the DB layer
const VALID_FEEDBACK_TRIGGER_TYPES = new Set<FeedbackTriggerType>([
  'undigested_ai', 'no_reasoning', 'no_evidence', 'no_connection', 'promising_seed', 'unclear',
]);

// ── Combined gate + type + feedback LLM call ─────────────────────────────────

interface TriggerResult {
  need: 0 | 1;
  type: FeedbackTriggerType;
  rationale: string;
  feedback: string;
  /** AI 自适应支架：按这条笔记具体化的半句话头 */
  scaffold: string;
  usedProviderId: string;
  usedModel: string;
}

const FEEDBACK_CALL_TIMEOUT_MS = 25_000;
const FEEDBACK_TOTAL_BUDGET_MS = 55_000;
const FEEDBACK_MAX_ATTEMPTS = 3;

/**
 * Walk the provider failover chain until one call produces a parseable gate
 * decision. Rate limits / server errors / timeouts feed the health scoreboard
 * so the next request skips the saturated provider entirely.
 */
async function detectAndGenerateFeedback(params: {
  candidates: ProviderCandidate[];
  noteTitle: string;
  draftText: string;
  boardContext: { boardNoteCount: number; buildOnCount: number; aiBuildOnCount: number };
  structural: ReturnType<typeof computeStructuralSignals>;
  extraSystemPrompt?: string;
  responseLanguage?: TriggerSettings['response_language'];
}): Promise<TriggerResult | null> {
  const setting = params.responseLanguage ?? 'auto';
  const forcedLang = setting === 'auto' ? undefined : setting;
  const contextLines = [
    `Note title: ${params.noteTitle}`,
    `Note content:\n${params.draftText.slice(0, 2000)}`,
    `\nContext: This discussion board has ${params.boardContext.boardNoteCount} notes total. ` +
    `This note has ${params.boardContext.buildOnCount} build-on replies. ` +
    `Board has ${params.boardContext.aiBuildOnCount} AI-generated notes.`,
    `Structural: ${params.structural.charLength} chars, ${params.structural.questionMarkCount} question marks, ` +
    `${params.structural.listMarkerCount} list items, ${params.structural.aiMentionCount} AI mentions, ` +
    `code: ${params.structural.hasCode}.`,
  ].join('\n\n');

  const systemPrompt = TRIGGER_RUBRIC + (params.extraSystemPrompt ?? '') + languageDirective(setting);
  const startedAll = Date.now();

  for (const cand of params.candidates.slice(0, FEEDBACK_MAX_ATTEMPTS)) {
    if (Date.now() - startedAll > FEEDBACK_TOTAL_BUDGET_MS) break;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEEDBACK_CALL_TIMEOUT_MS);
    const started = Date.now();

    let rawText: string;
    try {
      if (cand.providerId === 'anthropic') {
        rawText = await callAnthropic(cand.model, [{ role: 'user', content: contextLines }], systemPrompt, cand.apiKey, controller.signal);
      } else if (cand.providerId === 'google') {
        rawText = await callGoogle(cand.model, [{ role: 'user', content: contextLines }], systemPrompt, cand.apiKey, controller.signal);
      } else {
        rawText = await callOpenAICompatible(cand.providerId, cand.model, [{ role: 'user', content: contextLines }], systemPrompt, cand.apiKey, cand.endpointUrl, controller.signal);
      }
    } catch (err: any) {
      const failKind = err instanceof ApiError
        ? classifyHttpFailure(err.statusCode === 502 ? 502 : err.statusCode)
        : (err?.name === 'AbortError' ? 'timeout' as const : 'other' as const);
      // ApiError 502 wraps upstream errors — inspect message for rate limits
      const isRateLimit = /429|rate.?limit|too many/i.test(err?.message ?? '');
      const kind = isRateLimit ? 'rate_limit' : failKind;
      if (isDmxProvider(cand.providerId)) {
        reportModelFailure(cand.model, kind);
      } else {
        reportProviderFailure(cand.providerId, kind);
      }
      console.warn(`[NoteAIFeedback] ${cand.providerId}/${cand.model} failed (${kind}), trying next`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (isDmxProvider(cand.providerId)) {
      reportModelSuccess(cand.model, Date.now() - started);
    } else {
      reportProviderSuccess(cand.providerId);
    }

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue; // malformed output — try next model
      const parsed = JSON.parse(jsonMatch[0]) as { need?: number; type?: string; rationale?: string; feedback?: string; scaffold?: string };
      if (!parsed.need || parsed.need !== 1) return null; // definitive "no feedback needed"

      // Normalize the model's type label and validate against the DB
      // constraint whitelist — a hallucinated value must not reach the insert
      const rawType = (parsed.type ?? '').trim();
      const triggerType = T_TYPE_TO_TRIGGER[rawType.toUpperCase()]
        ?? (rawType.toLowerCase() as FeedbackTriggerType);
      if (!VALID_FEEDBACK_TRIGGER_TYPES.has(triggerType)) continue; // invalid label — try next model

      return {
        need: 1,
        type: triggerType,
        rationale: (parsed.rationale ?? '').slice(0, 100),
        feedback: (parsed.feedback ?? fallbackFeedback(triggerType, resolveFeedbackLang(setting, params.draftText))).trim(),
        scaffold: pickScaffold(triggerType, parsed.feedback ?? '', parsed.scaffold, forcedLang),
        usedProviderId: cand.providerId,
        usedModel: cand.model,
      };
    } catch {
      continue; // JSON parse failed — try next model
    }
  }
  return null;
}

// ── Legacy regex fallback (used only when LLM call fails) ────────────────────

function detectFeedbackTriggerRegex(text: string): { type: FeedbackTriggerType; reason: string } | null {
  if (/(maybe|not sure|i think|i guess|unclear|可能|也许|不确定|我觉得|我猜|不知道|说不清)/i.test(text)) {
    return { type: 'unclear', reason: 'The draft signals uncertainty.' };
  }
  const hasClaim = /(because|therefore|所以|因为|我认为|说明|证明)/i.test(text);
  const hasEvidence = /(evidence|data|source|study|数据|证据|研究|文献)/i.test(text);
  if (hasClaim && !hasEvidence) {
    return { type: 'no_evidence', reason: 'Claim without evidence.' };
  }
  return null;
}

router.get('/notes/:noteId/ai-feedback', verifyJWT, async (req: Request, res: Response) => {
  const note = await getNoteContext(paramString(req.params.noteId, 'noteId'));
  const standing = await requireNoteAccess(note, req);

  let query = supabase
    .from('note_ai_feedbacks')
    .select('*')
    .eq('note_id', note.id)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(req.query.limit) || 30, 100));

  // 课程教职看这条笔记上每个人收到的反馈，其他人只看自己的
  if (!isCourseStaff(standing)) query = query.eq('user_id', req.user!.id);

  const { data, error } = await query;
  if (error) throw new ApiError(500, error.message);
  const hideScaffold = await hidesAiScaffold(note.courseId, standing, req);
  res.json({ feedbacks: ((data ?? []) as FeedbackRow[]).map(row => feedbackToApi(row, { hideScaffold })) });
});

// POST /notes/:noteId/ai-feedback/request — student explicitly asks for AI feedback (A4)
router.post('/notes/:noteId/ai-feedback/request', verifyJWT, async (req: Request, res: Response) => {
  const note = await getNoteContext(paramString(req.params.noteId, 'noteId'));
  await requireNoteAccess(note, req);

  // 请求体里的 provider_id / model 仍然接受，但不再决定模型，见 resolveProviderCandidates
  const { content } = req.body as { content?: string };

  const draftText = stripHtml(content ?? note.content);
  if (draftText.length < 30) {
    return res.json({ triggered: false, reason: 'too_short' });
  }

  // 和 /check 同一道实验门控。按钮是学生点的，出来的却是同一张 T1–T6 反馈卡和
  // 同一个 AI 支架 —— 放行对照组，等于把被操纵的干预按需交还给对照组。
  // 对照组不调模型、不写反馈行，回应与「没触发」逐字相同。影子不做冷却去重：
  // 实验组这条路由每点一次就生成一张卡，对照组每点一次记一条，两组计数才可比。
  const { condition: expCondition, groupId, experimentMode } = await resolveEffectiveCondition(note.courseId, req.user!.id);
  if (experimentMode && !note.spaceGroupId) {
    return res.json({ triggered: false, reason: 'no_trigger' });
  }
  if (expCondition === 'control') {
    await logSuppressedIntervention({
      spaceId: note.spaceId,
      noteId: note.id,
      userId: req.user!.id,
      groupId,
      triggerType: 'requested_feedback',
      triggerContext: {
        detection_method: 'student_request',
        chain: 'editor_request',
        draft_length: draftText.length,
      },
    });
    return res.json({ triggered: false, reason: 'no_trigger' });
  }

  const candidates = await resolveProviderCandidates(note.courseId);
  if (candidates.length === 0) return res.json({ triggered: false, reason: 'no_provider' });
  const primary = candidates[0];

  const [boardContext, structural] = await Promise.all([
    fetchBoardContext(note.spaceId, note.id),
    Promise.resolve(computeStructuralSignals(draftText)),
  ]);

  const triggerSettings = await fetchTriggerSettings(note.courseId);
  const feedbackLang = resolveFeedbackLang(triggerSettings.response_language, draftText);
  const forcedLang = triggerSettings.response_language === 'auto' ? undefined : triggerSettings.response_language;
  const customCtx = triggerSettings.custom_context
    ? `\n\nCourse context from teacher: ${triggerSettings.custom_context}`
    : '';

  const llmResult = await detectAndGenerateFeedback({
    candidates,
    noteTitle: note.title,
    draftText,
    boardContext,
    structural,
    extraSystemPrompt: '\n\nIMPORTANT: The student has explicitly requested feedback. Always provide constructive guidance (need=1), even if the note looks acceptable. Pick the type that best fits where the note could improve most.' + customCtx,
    responseLanguage: triggerSettings.response_language,
  }).catch(() => null);

  let triggerType: FeedbackTriggerType;
  let feedbackText: string;
  let rationale: string;

  if (llmResult) {
    triggerType = llmResult.type;
    rationale = llmResult.rationale;
    feedbackText = llmResult.feedback || fallbackFeedback(triggerType, feedbackLang);
  } else {
    triggerType = 'promising_seed';
    rationale = 'Student requested feedback';
    feedbackText = fallbackFeedback('promising_seed', feedbackLang);
  }
  const usedProviderId = llmResult?.usedProviderId ?? primary.providerId;
  const usedModel = llmResult?.usedModel ?? primary.model;

  const wordCount = draftText.split(/\s+/).filter(Boolean).length;
  const { data: feedback, error } = await supabase
    .from('note_ai_feedbacks')
    .insert({
      note_id: note.id,
      space_id: note.spaceId,
      course_id: note.courseId,
      user_id: req.user!.id,
      provider_id: usedProviderId,
      model: usedModel,
      trigger_type: triggerType,
      trigger_context: {
        rationale,
        draft_length: draftText.length,
        word_count: wordCount,
        board_note_count: boardContext.boardNoteCount,
        detection_method: 'student_request',
      },
      draft_excerpt: draftText.slice(0, 600),
      feedback_text: trimAtSentence(feedbackText.trim(), triggerSettings.max_feedback_length),
      // AI 自适应支架随反馈一起生成；走同一道实验门控 —— 对照组到不了这里
      suggested_scaffold: llmResult?.scaffold || pickScaffold(triggerType, draftText, undefined, forcedLang),
      status: 'new',
    })
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  await logEvent(req, 'ai_feedback_requested', feedback.id, note.spaceId, {
    note_id: note.id, trigger_type: triggerType,
  });

  res.status(201).json({ triggered: true, feedback: feedbackToApi(feedback as FeedbackRow) });
});

router.post('/notes/:noteId/ai-feedback/check', verifyJWT, async (req: Request, res: Response) => {
  const note = await getNoteContext(paramString(req.params.noteId, 'noteId'));
  await requireNoteAccess(note, req);

  const { content, last_feedback_id } = req.body as {
    content?: string;
    last_feedback_id?: string;
  };

  const triggerSettings = await fetchTriggerSettings(note.courseId);
  if (!triggerSettings.auto_feedback_enabled) {
    return res.json({ triggered: false, reason: 'disabled_by_teacher' });
  }

  const draftText = stripHtml(content);
  if (!prefilterNote(draftText)) return res.json({ triggered: false, reason: 'no_trigger' });
  const feedbackLang = resolveFeedbackLang(triggerSettings.response_language, draftText);
  const forcedLang = triggerSettings.response_language === 'auto' ? undefined : triggerSettings.response_language;

  // Cluster-randomized experiment gate: control-group students receive no
  // proactive feedback. Rule-based detection still runs and is shadow-logged
  // (never the LLM — control detection must stay zero-cost); the client gets
  // a generic no_trigger so the student's condition stays blinded.
  const { condition: expCondition, groupId, experimentMode } = await resolveEffectiveCondition(note.courseId, req.user!.id);
  if (experimentMode && !note.spaceGroupId) {
    return res.json({ triggered: false, reason: 'no_trigger' });
  }
  if (expCondition === 'control') {
    const shadowHit = detectFeedbackTriggerRegex(draftText);
    if (shadowHit && triggerSettings.enabled_triggers.includes(shadowHit.type)) {
      const shadowCooldownMs = triggerSettings.cooldown_seconds * 1000;
      const { data: recentShadow } = await supabase
        .from('ai_interventions')
        .select('id')
        .eq('note_id', note.id)
        .eq('trigger_type', `auto_feedback_${shadowHit.type}`)
        .gte('created_at', new Date(Date.now() - shadowCooldownMs).toISOString())
        .limit(1)
        .maybeSingle();
      if (!recentShadow) {
        await logSuppressedIntervention({
          spaceId: note.spaceId,
          noteId: note.id,
          userId: req.user!.id,
          groupId,
          triggerType: `auto_feedback_${shadowHit.type}`,
          triggerContext: {
            rationale: shadowHit.reason,
            detection_method: 'regex_shadow',
            chain: 'editor_inline',
            draft_length: draftText.length,
          },
        });
      }
    }
    return res.json({ triggered: false, reason: 'no_trigger' });
  }

  // Cooldown dedup BEFORE the LLM call — a repeat check inside the window
  // must not burn a detection call. One feedback per note per window, with a
  // server-verified follow-up path: passing last_feedback_id only reopens the
  // window when the draft has actually changed since that feedback (blocks
  // replaying the same id for endless generations).
  const cooldownMs = triggerSettings.cooldown_seconds * 1000;
  const { data: recentFeedback } = await supabase
    .from('note_ai_feedbacks')
    .select('id, trigger_context, created_at')
    .eq('note_id', note.id)
    .eq('user_id', req.user!.id)
    .gte('created_at', new Date(Date.now() - cooldownMs).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentFeedback) {
    const prevLength = Number((recentFeedback.trigger_context as Record<string, unknown> | null)?.draft_length);
    const draftChanged = !Number.isFinite(prevLength) || Math.abs(draftText.length - prevLength) >= 40;
    if (recentFeedback.id !== last_feedback_id || !draftChanged) {
      return res.json({ triggered: false, reason: 'cooldown_duplicate' });
    }
  }

  const candidates = await resolveProviderCandidates(note.courseId);
  if (candidates.length === 0) return res.json({ triggered: false, reason: 'no_provider' });
  const primary = candidates[0];

  const [boardContext, structural] = await Promise.all([
    fetchBoardContext(note.spaceId, note.id),
    Promise.resolve(computeStructuralSignals(draftText)),
  ]);

  let triggerType: FeedbackTriggerType;
  let rationale: string;
  let feedbackText: string;

  const sensitivityHint = triggerSettings.sensitivity === 'conservative'
    ? '\n\nIMPORTANT: Be CONSERVATIVE — only trigger for very clear cases. Default to need=0 when unsure.'
    : triggerSettings.sensitivity === 'aggressive'
    ? '\n\nIMPORTANT: Be THOROUGH — trigger for any detectable gap, even borderline cases.'
    : '';
  const customCtx = triggerSettings.custom_context
    ? `\n\nCourse context from teacher: ${triggerSettings.custom_context}`
    : '';

  // A3: Student history — if student ignores >70% of feedback, be more conservative
  const { count: totalFb } = await supabase
    .from('note_ai_feedbacks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user!.id)
    .eq('course_id', note.courseId);
  const { count: ignoredFb } = await supabase
    .from('note_ai_feedbacks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user!.id)
    .eq('course_id', note.courseId)
    .eq('status', 'ignored');
  const studentHistoryHint = (totalFb ?? 0) >= 5 && (ignoredFb ?? 0) / (totalFb ?? 1) > 0.7
    ? '\n\nNote: This student has ignored most previous feedback. Only trigger for very strong signals to avoid feedback fatigue.'
    : '';

  const llmResult = await detectAndGenerateFeedback({
    candidates,
    noteTitle: note.title,
    draftText,
    boardContext,
    structural,
    extraSystemPrompt: sensitivityHint + customCtx + studentHistoryHint,
    responseLanguage: triggerSettings.response_language,
  }).catch(() => null);

  if (llmResult) {
    if (!triggerSettings.enabled_triggers.includes(llmResult.type)) {
      return res.json({ triggered: false, reason: 'trigger_type_disabled' });
    }
    triggerType = llmResult.type;
    rationale = llmResult.rationale;
    feedbackText = llmResult.feedback || fallbackFeedback(triggerType, feedbackLang);
  } else {
    const regexFallback = detectFeedbackTriggerRegex(draftText);
    if (!regexFallback) return res.json({ triggered: false, reason: 'no_trigger' });
    if (!triggerSettings.enabled_triggers.includes(regexFallback.type)) {
      return res.json({ triggered: false, reason: 'trigger_type_disabled' });
    }
    triggerType = regexFallback.type;
    rationale = regexFallback.reason;
    feedbackText = fallbackFeedback(triggerType, feedbackLang);
  }

  const wordCount = draftText.split(/\s+/).filter(Boolean).length;
  const { data: feedback, error } = await supabase
    .from('note_ai_feedbacks')
    .insert({
      note_id: note.id,
      space_id: note.spaceId,
      course_id: note.courseId,
      user_id: req.user!.id,
      provider_id: llmResult?.usedProviderId ?? primary.providerId,
      model: llmResult?.usedModel ?? primary.model,
      trigger_type: triggerType,
      trigger_context: {
        rationale,
        draft_length: draftText.length,
        word_count: wordCount,
        board_note_count: boardContext.boardNoteCount,
        build_on_count: boardContext.buildOnCount,
        structural,
        detection_method: llmResult ? 'llm_t1t6' : 'regex_fallback',
      },
      draft_excerpt: draftText.slice(0, 600),
      feedback_text: trimAtSentence(feedbackText.trim(), triggerSettings.max_feedback_length),
      // AI 自适应支架随反馈一起生成；走同一道实验门控 —— 对照组到不了这里
      suggested_scaffold: llmResult?.scaffold || pickScaffold(triggerType, draftText, undefined, forcedLang),
      status: 'new',
    })
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);

  const { error: interventionErr } = await supabase.from('ai_interventions').insert({
    space_id: note.spaceId,
    note_id: note.id,
    user_id: req.user!.id,
    group_id: groupId,
    trigger_type: `auto_feedback_${triggerType}`,
    trigger_context: { rationale, detection_method: llmResult ? 'llm_t1t6' : 'regex_fallback', chain: 'editor_inline' },
    provider_id: llmResult?.usedProviderId ?? primary.providerId,
    model_full_name: llmResult?.usedModel ?? primary.model,
    input_context_summary: draftText.slice(0, 200),
    response_text: feedbackText.slice(0, 500),
    visibility_scope: 'private',
  });
  if (interventionErr) {
    console.error('[NoteAIFeedback] Failed to log intervention:', interventionErr.message);
  }
  await logEvent(req, 'ai_feedback_triggered', feedback.id, note.spaceId, {
    note_id: note.id,
    trigger_type: triggerType,
    provider_id: llmResult?.usedProviderId ?? primary.providerId,
    model: llmResult?.usedModel ?? primary.model,
  });

  res.status(201).json({ triggered: true, feedback: feedbackToApi(feedback as FeedbackRow) });
});


/**
 * 学生采纳反馈后，把它发布成画布上的一条笔记，并连回原笔记。
 *
 * 采纳原本只改一个 status —— 反馈停在私有面板里，从没进入社区的公共讨论。
 * 而知识建构的整个前提是想法要成为**公共的、可被他人接续的对象**：
 * 采纳了却不公开，等于承认它有价值然后把它藏起来。
 *
 * 署名给 AI（is_ai_generated），不给学生：内容是 AI 写的，冒充学生的话会污染
 * 作者维度的研究数据。学生的动作记录在 relations.ai_accepted 和事件流里。
 */
async function publishAcceptedFeedback(params: {
  feedback: FeedbackRow;
  note: { id: string; spaceId: string; authorId: string };
  acceptedBy: string;
}): Promise<string | null> {
  const { feedback, note, acceptedBy } = params;

  const { data: origin } = await supabase
    .from('notes')
    .select('x, y, views')
    .eq('id', note.id)
    .single();

  const title = deriveAiNoteTitle(feedback.feedback_text, 'AI 反馈 | AI feedback');
  // 和下面写库失败一样，消毒失败只是不发布，不影响「采纳」本身
  const content = await sanitizeNoteHtml(feedback.feedback_text).catch((err: Error) => {
    console.error('[NoteAIFeedback] Failed to sanitize accepted feedback:', err.message);
    return null;
  });
  if (content === null) return null;

  const { data: created, error: noteErr } = await supabase
    .from('notes')
    .insert({
      space_id: note.spaceId,
      // DB 要求 author_id 指向真实用户；显示层按 is_ai_generated 统一渲染成 AI Partner
      author_id: note.authorId,
      // 对话式而非独白式：学生要能就着这条反馈继续追问，而不是收下一段文字
      type: 'ai_dialogue',
      title,
      content,
      x: (origin?.x ?? 0) + 240,
      y: (origin?.y ?? 0) + 60,
      is_ai_generated: true,
      ai_trigger_type: feedback.trigger_type,
      epistemic_status: 'standard',
      tags: ['ai-generated', 'accepted-feedback'],
      views: origin?.views ?? [],
    })
    .select('id')
    .single();

  if (noteErr || !created) {
    console.error('[NoteAIFeedback] Failed to publish accepted feedback:', noteErr?.message);
    return null;
  }

  const { error: relErr } = await supabase.from('relations').insert({
    source_note_id: created.id,
    target_note_id: note.id,
    relation_type: 'extend',
    creator_id: acceptedBy,
    space_id: note.spaceId,
    ai_suggested: true,
    ai_accepted: true,
  });
  if (relErr) {
    // 连线失败不回滚笔记：孤立的笔记仍然可读可编辑，删掉它反而丢内容
    console.error('[NoteAIFeedback] Failed to link published feedback:', relErr.message);
  }

  // 挂一条对话线程，并把这条反馈写成开场白。复用 note_conversation_* 而不是
  // 另起一套：追问、历史、研究导出都已经长在这两张表上。
  const { data: thread, error: threadErr } = await supabase
    .from('note_conversation_threads')
    .insert({
      note_id: created.id,
      space_id: note.spaceId,
      course_id: feedback.course_id,
      target_type: 'ai',
      provider_id: feedback.provider_id,
      model: feedback.model,
      title,
      created_by: acceptedBy,
    })
    .select('id')
    .single();

  if (threadErr || !thread) {
    // 线程建不起来，笔记仍然可读；下次打开时按需补建，不在这里回滚
    console.error('[NoteAIFeedback] Failed to create dialogue thread:', threadErr?.message);
    return created.id as string;
  }

  const { error: msgErr } = await supabase.from('note_conversation_messages').insert({
    thread_id: thread.id,
    sender_id: null,
    sender_kind: 'assistant',
    content: feedback.feedback_text,
    ai_metadata: {
      origin: 'accepted_feedback',
      feedback_id: feedback.id,
      trigger_type: feedback.trigger_type,
      source_note_id: note.id,
    },
  });
  if (msgErr) console.error('[NoteAIFeedback] Failed to seed dialogue message:', msgErr.message);

  return created.id as string;
}

router.post('/notes/:noteId/ai-feedback/:feedbackId/respond', verifyJWT, async (req: Request, res: Response) => {
  const note = await getNoteContext(paramString(req.params.noteId, 'noteId'));
  const standing = await requireNoteAccess(note, req);
  const feedbackId = paramString(req.params.feedbackId, 'feedbackId');
  const { status, response_text, rejection_reason, rejection_tag } = req.body as {
    status?: FeedbackStatus; response_text?: string; rejection_reason?: string; rejection_tag?: string;
  };
  if (!status || !['accepted', 'ignored', 'followed_up', 'inserted', 'rejected'].includes(status)) {
    throw new ApiError(400, 'status must be accepted, ignored, followed_up, inserted, or rejected');
  }

  // 不同意要留下判断的痕迹，且和状态同一次写入 —— Lerner & Tetlock (1999)：
  // 只有「决策前」要求说明才提升思维复杂度，事后补填会滑向为已做决定辩护。
  //
  // 但要求的形式是点一个标签，不是写一句话：同一套强制自由文本在插入那条路径上
  // 已经产生了近四成的「没有理由」式应付。标签点一下就完成，还更好编码；
  // 想展开的学生仍可以在 rejection_reason 里补。
  const trimmedReason = typeof rejection_reason === 'string' ? rejection_reason.trim() : '';
  const trimmedTag = typeof rejection_tag === 'string' ? rejection_tag.trim() : '';
  if (status === 'rejected' && !trimmedTag) {
    throw new ApiError(400, '请选择不采纳的原因');
  }

  // status and response_text record what the *recipient* did with the AI's
  // feedback — both are outcome variables in the study. Scope the write to the
  // caller's own row for every role: a teacher answering on a student's behalf
  // would silently fabricate that student's data point.
  const { data, error } = await supabase
    .from('note_ai_feedbacks')
    .update({
      status,
      response_text: response_text ?? null,
      rejection_tag: status === 'rejected' ? trimmedTag : null,
      rejection_reason: status === 'rejected' ? (trimmedReason || null) : null,
      responded_at: new Date().toISOString(),
    })
    .eq('id', feedbackId)
    .eq('note_id', note.id)
    .eq('user_id', req.user!.id)
    .select('*')
    .single();
  if (error || !data) throw new ApiError(404, 'Feedback not found');

  // 采纳即公开：把反馈发布成一条连回原笔记的 Build-on。
  // published_note_id 保证幂等 —— 重复点击或请求重试都不会多长出一张卡片。
  let publishedNoteId: string | null = (data as any).published_note_id ?? null;
  if (status === 'accepted' && !publishedNoteId) {
    publishedNoteId = await publishAcceptedFeedback({
      feedback: data as FeedbackRow,
      note: { id: note.id, spaceId: note.spaceId, authorId: note.authorId },
      acceptedBy: req.user!.id,
    });
    if (publishedNoteId) {
      await supabase
        .from('note_ai_feedbacks')
        .update({ published_note_id: publishedNoteId })
        .eq('id', feedbackId);
      await logEvent(req, 'ai_feedback_published', publishedNoteId, note.spaceId, {
        note_id: note.id,
        feedback_id: feedbackId,
        trigger_type: (data as FeedbackRow).trigger_type,
      });
    }
  }

  const eventByStatus: Record<string, string> = {
    accepted: 'ai_feedback_accepted',
    ignored: 'ai_feedback_ignored',
    followed_up: 'ai_feedback_followup_sent',
    inserted: 'ai_feedback_inserted',
    rejected: 'ai_feedback_rejected',
  };
  await logEvent(req, eventByStatus[status], feedbackId, note.spaceId, { note_id: note.id, status });

  // B2: Notify course instructor when a participant (not course staff) responds to AI feedback
  if (!isCourseStaff(standing) && (status === 'accepted' || status === 'inserted' || status === 'rejected')) {
    const { data: course } = await supabase
      .from('courses')
      .select('instructor_id')
      .eq('id', note.courseId)
      .single();
    if (course?.instructor_id && course.instructor_id !== req.user!.id) {
      const studentName = req.user!.name || 'A student';
      const triggerLabel = ((data as FeedbackRow).trigger_type ?? '').replace(/_/g, ' ');
      const actionLabel = status === 'accepted' ? 'accepted' : status === 'inserted' ? 'inserted' : 'disagreed with';
      void supabase.from('notifications').insert({
        user_id: course.instructor_id,
        type: 'ai_feedback_response',
        title: `${studentName} ${actionLabel} AI feedback`,
        message: `${studentName} ${actionLabel} a "${triggerLabel}" AI feedback on "${note.title}".`,
        metadata: { note_id: note.id, feedback_id: feedbackId, status, trigger_type: (data as FeedbackRow).trigger_type },
      });
    }
  }

  const hideScaffold = await hidesAiScaffold(note.courseId, standing, req);
  res.json({
    feedback: feedbackToApi({ ...(data as FeedbackRow), published_note_id: publishedNoteId }, { hideScaffold }),
    published_note_id: publishedNoteId,
  });
});

// POST /notes/:noteId/ai-feedback/:feedbackId/scaffold-used — 学生把反馈附带的 AI 支架插进了笔记
router.post('/notes/:noteId/ai-feedback/:feedbackId/scaffold-used', verifyJWT, async (req: Request, res: Response) => {
  const note = await getNoteContext(paramString(req.params.noteId, 'noteId'));
  const standing = await requireNoteAccess(note, req);
  const feedbackId = paramString(req.params.feedbackId, 'feedbackId');
  const { data, error } = await supabase
    .from('note_ai_feedbacks')
    .update({ suggested_scaffold_used_at: new Date().toISOString() })
    .eq('id', feedbackId)
    .eq('note_id', note.id)
    .eq('user_id', req.user!.id)
    .select('*')
    .single();
  if (error || !data) throw new ApiError(404, 'Feedback not found');
  await logEvent(req, 'ai_scaffold_used', feedbackId, note.spaceId, {
    note_id: note.id, trigger_type: (data as FeedbackRow).trigger_type, scaffold: (data as FeedbackRow).suggested_scaffold,
  });
  const hideScaffold = await hidesAiScaffold(note.courseId, standing, req);
  res.json({ feedback: feedbackToApi(data as FeedbackRow, { hideScaffold }) });
});

router.post('/notes/:noteId/ai-insertions', verifyJWT, async (req: Request, res: Response) => {
  const note = await getNoteContext(paramString(req.params.noteId, 'noteId'));
  await requireNoteAccess(note, req);
  const {
    source_message_id,
    feedback_id,
    provider_id,
    model,
    selected_text,
    inserted_html,
    acceptance_reason,
    student_revision_plan,
    scaffold_id,
    reason_tag,
    insertion_anchor = {},
  } = req.body as {
    source_message_id?: string;
    feedback_id?: string;
    provider_id?: string;
    model?: string;
    selected_text?: string;
    inserted_html?: string;
    acceptance_reason?: string;
    student_revision_plan?: string;
    scaffold_id?: string;
    reason_tag?: string;
    insertion_anchor?: Record<string, unknown>;
  };

  if (!selected_text?.trim() || !inserted_html?.trim()) throw new ApiError(400, 'selected_text and inserted_html are required');
  // 采纳理由不再要求写句子。生产数据里近四成是「没有」「没有理由」这类为通过校验
  // 而输入的内容 —— 强制自由文本换来的是规避行为，不是思考。
  // 现在只要求留下一个分类信号：选了 GenAI 支架（它本身就说明以什么方式采纳，
  // 且会进入笔记正文），或者选一个标签。自由文本降为可选补充。
  if (!scaffold_id && !reason_tag) {
    throw new ApiError(400, '请选择一个 GenAI 支架或采纳方式');
  }
  if (student_revision_plan !== undefined && typeof student_revision_plan !== 'string') {
    throw new ApiError(400, 'student_revision_plan must be a string');
  }

  const { data, error } = await supabase
    .from('note_ai_insertions')
    .insert({
      note_id: note.id,
      space_id: note.spaceId,
      course_id: note.courseId,
      user_id: req.user!.id,
      source_message_id: source_message_id ?? null,
      feedback_id: feedback_id ?? null,
      provider_id: provider_id ?? null,
      model: model ?? null,
      selected_text: selected_text.trim(),
      inserted_html,
      acceptance_reason: acceptance_reason?.trim() || null,
      student_revision_plan: student_revision_plan?.trim() || null,
      scaffold_id: scaffold_id?.trim() || null,
      reason_tag: reason_tag?.trim() || null,
      insertion_anchor,
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);

  if (feedback_id) {
    await supabase
      .from('note_ai_feedbacks')
      .update({ status: 'inserted', responded_at: new Date().toISOString() })
      .eq('id', feedback_id)
      .eq('user_id', req.user!.id);
  }
  await logEvent(req, 'ai_text_inserted_to_note', data.id, note.spaceId, {
    note_id: note.id,
    source_message_id: source_message_id ?? null,
    feedback_id: feedback_id ?? null,
    provider_id: provider_id ?? null,
    model: model ?? null,
    text_length: selected_text.trim().length,
    acceptance_reason: acceptance_reason?.trim() || null,
    reason_tag: reason_tag?.trim() || null,
    scaffold_id: scaffold_id?.trim() || null,
    has_revision_plan: !!student_revision_plan?.trim(),
  });

  res.status(201).json({ insertion: data });
});

async function callOpenAICompatible(
  providerId: string,
  model: string,
  messages: { role: string; content: string }[],
  systemContent: string,
  apiKey: string,
  endpointUrl: string | null,
  signal?: AbortSignal,
): Promise<string> {
  const endpoints: Record<string, string> = CHAT_ENDPOINTS;
  const url = endpointUrl ?? endpoints[providerId] ?? endpoints.openai;
  // Teacher-supplied endpoints reach this fetch with the provider key attached.
  if (endpointUrl) await assertSafePublicUrl(endpointUrl);
  const response = await aiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(withFastChatOptions(providerId, model, {
      model,
      messages: [{ role: 'system', content: systemContent }, ...messages],
      // JSON envelope + Chinese feedback easily exceeds 220 tokens — a
      // truncated JSON silently degrades to the weak regex fallback
      max_tokens: 420,
      temperature: 0.45,
    })),
    signal,
  });
  if (!response.ok) throw new ApiError(502, `AI provider error: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(model: string, messages: { role: string; content: string }[], systemContent: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const response = await aiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 420, system: systemContent, messages }),
    signal,
  });
  if (!response.ok) throw new ApiError(502, `AI provider error: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as any;
  return data.content?.[0]?.text ?? '';
}

async function callGoogle(model: string, messages: { role: string; content: string }[], systemContent: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const contents = messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
  const response = await aiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: systemContent }] }, contents, generationConfig: { maxOutputTokens: 420, temperature: 0.45 } }),
    signal,
  });
  if (!response.ok) throw new ApiError(502, `AI provider error: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// B3: Batch feedback generation — teacher generates feedback for multiple notes at once
router.post('/courses/:courseId/ai-feedback/batch', verifyJWT, async (req: Request, res: Response) => {
  if (!req.user || (req.user.role !== 'teacher' && req.user.role !== 'admin')) {
    throw new ApiError(403, 'Teacher or admin role required');
  }
  const courseId = String(req.params.courseId);
  // This runs generation against the course's own AI provider key, so an
  // unchecked courseId lets any teacher spend another course's quota.
  await ensureCourseInstructor(courseId, req.user);
  const { note_ids } = req.body as { note_ids?: string[] };
  if (!Array.isArray(note_ids) || note_ids.length === 0 || note_ids.length > 20) {
    throw new ApiError(400, 'note_ids must be an array of 1-20 note IDs');
  }

  const batchCandidates = await resolveProviderCandidates(courseId);
  if (batchCandidates.length === 0) throw new ApiError(404, 'No AI provider configured');

  const triggerSettings = await fetchTriggerSettings(courseId);
  const customCtx = triggerSettings.custom_context
    ? `\n\nCourse context from teacher: ${triggerSettings.custom_context}`
    : '';

  const results: { noteId: string; triggered: boolean; feedback?: ReturnType<typeof feedbackToApi>; skippedControl?: boolean }[] = [];

  for (const noteId of note_ids) {
    try {
      const note = await getNoteContext(noteId);
      if (note.courseId !== courseId) continue;

      // Experiment gate: control-group authors must not receive proactive
      // feedback even via teacher-initiated batch review, and in experiment
      // mode nothing is delivered into shared (non-group) spaces.
      const { condition: authorCondition, experimentMode } = await resolveEffectiveCondition(courseId, note.authorId);
      if (authorCondition === 'control' || (experimentMode && !note.spaceGroupId)) {
        results.push({ noteId, triggered: false, skippedControl: true });
        continue;
      }

      const draftText = stripHtml(note.content);
      if (draftText.length < 30) {
        results.push({ noteId, triggered: false });
        continue;
      }

      const [boardContext, structural] = await Promise.all([
        fetchBoardContext(note.spaceId, note.id),
        Promise.resolve(computeStructuralSignals(draftText)),
      ]);

      const llmResult = await detectAndGenerateFeedback({
        candidates: batchCandidates,
        noteTitle: note.title,
        draftText,
        boardContext,
        structural,
        extraSystemPrompt: '\n\nTeacher requested batch review. Provide feedback even for borderline cases.' + customCtx,
        responseLanguage: triggerSettings.response_language,
      }).catch(() => null);

      if (!llmResult) {
        results.push({ noteId, triggered: false });
        continue;
      }

      const { data: feedback, error } = await supabase
        .from('note_ai_feedbacks')
        .insert({
          note_id: note.id,
          space_id: note.spaceId,
          course_id: courseId,
          user_id: req.user!.id,
          provider_id: llmResult.usedProviderId,
          model: llmResult.usedModel,
          trigger_type: llmResult.type,
          trigger_context: { rationale: llmResult.rationale, detection_method: 'teacher_batch' },
          draft_excerpt: draftText.slice(0, 600),
          feedback_text: trimAtSentence((llmResult.feedback || fallbackFeedback(llmResult.type, resolveFeedbackLang(triggerSettings.response_language, draftText))).trim(), triggerSettings.max_feedback_length),
          status: 'new',
        })
        .select('*')
        .single();

      if (error || !feedback) {
        results.push({ noteId, triggered: false });
      } else {
        results.push({ noteId, triggered: true, feedback: feedbackToApi(feedback as FeedbackRow) });
      }
    } catch {
      results.push({ noteId, triggered: false });
    }
  }

  res.json({ results });
});

// B4: Student progress report — AI-generated summary
router.get('/courses/:courseId/students/:userId/progress-report', verifyJWT, async (req: Request, res: Response) => {
  if (!req.user || (req.user.role !== 'teacher' && req.user.role !== 'admin')) {
    throw new ApiError(403, 'Teacher or admin role required');
  }
  const courseId = String(req.params.courseId);
  const userId = String(req.params.userId);
  await ensureCourseInstructor(courseId, req.user);

  // The users lookup below is by id alone, so without this any teacher could
  // resolve an arbitrary UUID to a real name via a course they do teach.
  const { data: enrolment } = await supabase
    .from('course_members')
    .select('user_id')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!enrolment) throw new ApiError(404, 'Student not found in this course');

  const [notesRes, feedbackRes, userRes] = await Promise.all([
    supabase
      .from('notes')
      .select('id, title, content, created_at, updated_at, spaces!inner(id, course_id)')
      .eq('author_id', userId)
      .eq('spaces.course_id', courseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(50),
    supabase
      .from('note_ai_feedbacks')
      .select('trigger_type, status, created_at')
      .eq('user_id', userId)
      .eq('course_id', courseId)
      .order('created_at', { ascending: true }),
    supabase.from('users').select('name').eq('id', userId).single(),
  ]);

  const notes = notesRes.data ?? [];
  const feedbacks = feedbackRes.data ?? [];

  const triggerCounts: Record<string, number> = {};
  let accepted = 0, ignored = 0;
  for (const fb of feedbacks) {
    const t = fb.trigger_type as string;
    triggerCounts[t] = (triggerCounts[t] ?? 0) + 1;
    if (fb.status === 'accepted' || fb.status === 'inserted') accepted++;
    if (fb.status === 'ignored') ignored++;
  }

  const provider = await resolveProvider(courseId);
  let aiSummary = '';
  if (provider && notes.length > 0) {
    const noteSnippets = notes.slice(-10).map((n: any) => `- "${n.title}": ${stripHtml(n.content).slice(0, 100)}`).join('\n');
    const fbSummary = `Feedback received: ${feedbacks.length} total, ${accepted} accepted, ${ignored} ignored. Trigger types: ${JSON.stringify(triggerCounts)}.`;
    const prompt = `Summarize this student's KB journey in 3-4 sentences. Note evolution, strengths, and areas for growth.\n\nNotes (chronological):\n${noteSnippets}\n\n${fbSummary}`;

    try {
      const systemMsg = 'You are a teacher assistant summarizing student progress in a Knowledge Building course. Be encouraging but honest. Write in the same language as the notes.';
      if (provider.providerId === 'anthropic') {
        aiSummary = await callAnthropic(provider.model, [{ role: 'user', content: prompt }], systemMsg, provider.apiKey);
      } else if (provider.providerId === 'google') {
        aiSummary = await callGoogle(provider.model, [{ role: 'user', content: prompt }], systemMsg, provider.apiKey);
      } else {
        aiSummary = await callOpenAICompatible(provider.providerId, provider.model, [{ role: 'user', content: prompt }], systemMsg, provider.apiKey, provider.endpointUrl);
      }
    } catch {}
  }

  res.json({
    report: {
      studentId: userId,
      studentName: userRes.data?.name ?? 'Unknown',
      noteCount: notes.length,
      feedbackCount: feedbacks.length,
      acceptanceRate: feedbacks.length > 0 ? Math.round(accepted / feedbacks.length * 100) : 0,
      triggerDistribution: triggerCounts,
      aiSummary: aiSummary || null,
      firstNoteAt: notes[0]?.created_at ?? null,
      lastNoteAt: notes.at(-1)?.created_at ?? null,
    },
  });
});

export default router;
