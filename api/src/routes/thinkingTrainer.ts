/**
 * Thinking Trainer (思维训练场) — gamified critical-thinking practice.
 *
 * Three modes, none of which are chat:
 *  - fallacy: spot the logical fallacy in a generated argument (point & pick)
 *  - arena:   turn-based argumentation duel using KB discourse cards
 *  - ladder:  climb a Socratic questioning ladder, one deeper question per rung
 *
 * LLM usage is front-loaded (generation at session start, evaluation per move
 * for arena/ladder). Fallacy answers live server-side in session state, so
 * judging is instant and cheat-proof. Every mode has a non-LLM fallback so the
 * trainer works even when no course AI provider is configured.
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { assertSafePublicUrl } from '../services/urlGuard';
import { decryptProviderApiKey, withFastChatOptions } from '../services/aiProviderConfig';
import { getProviderEndpoint, providerTemperature } from '../services/agentLoop';
import { applyModelQuirks } from '../services/modelCatalog';
import { isDmxProvider, pickModels, pickNativeModel, reportModelSuccess, reportModelFailure, reportProviderFailure, reportProviderSuccess, orderConfigsByHealth, classifyHttpFailure, routerStats, type TaskKind } from '../services/modelRouter';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../middleware/rateLimitKey';
import { aiFetch } from '../services/aiGateway';
import {
  COURSE_AI_ROW_COLUMNS,
  choiceModelFor,
  featureCandidateRows,
  featureChoice,
  getAiFeature,
  loadCourseAiRows,
  modelsForRow,
  sortByOrder,
  type AiFeatureId,
  type CourseAiRow,
  type ModelRef,
} from '../services/aiFeatureModels';

const router = Router();

const startLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many new sessions, take a breath' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

const moveLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'Too many moves' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

type Mode = 'fallacy' | 'arena' | 'ladder';
const SKILLS = ['clarity', 'evidence', 'logic', 'questioning', 'perspective'] as const;

// ── LLM plumbing ───────────────────────────────────────────────

export interface ProviderConfig {
  providerId: string;
  apiKey: string;
  model: string;
  endpointUrl?: string | null;
  /** resolveProvider 顺手带上的其余候选：callJson / callChat 没传 fallbacks 时用它 */
  fallbacks?: ProviderConfig[];
}

function toProviderConfig(row: any, modelOverride?: string | null): ProviderConfig | null {
  if (!row) return null;
  const model = modelOverride
    ?? (isDmxProvider(row.provider_id)
      ? 'auto'
      : (pickNativeModel(row.provider_id, row.enabled_models) ?? 'deepseek-flash'));
  try {
    return {
      providerId: row.provider_id,
      apiKey: decryptProviderApiKey(row.api_key_encrypted),
      model,
      endpointUrl: row.endpoint_url,
    };
  } catch {
    return null;
  }
}

function toChain(ordered: CourseAiRow[], choice: ModelRef | null): ProviderConfig[] {
  const seen = new Set<string>();
  const out: ProviderConfig[] = [];
  for (const row of ordered) {
    if (seen.has(row.provider_id)) continue;
    seen.add(row.provider_id);
    const cfg = toProviderConfig(row, choiceModelFor(choice, row.provider_id));
    if (cfg) out.push(cfg);
  }
  return out;
}

const hasChatKey = (row: CourseAiRow) =>
  Boolean(row.api_key_encrypted) && row.provider_id !== 'tavily' && modelsForRow(row, 'chat').length > 0;

/** 训练场、编程练习只有用户、没有课程：用他所在各门课的 key。 */
async function userCourseIds(userId: string): Promise<string[]> {
  const [memberRes, instructedRes] = await Promise.all([
    supabase.from('course_members').select('course_id').eq('user_id', userId),
    supabase.from('courses').select('id').eq('instructor_id', userId),
  ]);
  return Array.from(new Set([
    ...(memberRes.data ?? []).map((m: any) => m.course_id as string),
    ...(instructedRes.data ?? []).map((c: any) => c.id as string),
  ]));
}

/**
 * 不属于某一门课的功能（思维练习、编程练习）的候选链：用户所在各门课的 key 合在一起排。
 *
 * 排第一的：第一门给这个功能指定了模型的课的选择（用那门课自己的 key）；都没指定就按默认规则
 * （有 DeepSeek 先用 DeepSeek Flash）。其余按原厂在前、DMX 溢出的原顺序，冷却中的沉底。
 *
 * 用途之二：原厂模型返回了 HTTP 200 却吐出不合法的 JSON 时（GLM 偶尔会），
 * 调用方可以立刻换下一家重试，而不是这一次就废掉 —— 见 callJson 的 fallbacks。
 */
export async function resolveProviderChain(userId: string, feature: AiFeatureId = 'practice'): Promise<ProviderConfig[]> {
  const courseIds = await userCourseIds(userId);
  if (courseIds.length === 0) return [];
  const { data: configs } = await supabase
    .from('teacher_ai_configs')
    .select(`course_id, ${COURSE_AI_ROW_COLUMNS}`)
    .in('course_id', courseIds)
    .order('is_verified', { ascending: false });
  const rows = (configs ?? []) as CourseAiRow[];

  let choice: ModelRef | null = null;
  let choiceCourse: string | null = null;
  for (const courseId of courseIds) {
    const picked = featureChoice(feature, rows.filter(r => r.course_id === courseId));
    if (picked?.source === 'teacher') {
      choice = picked;
      choiceCourse = courseId;
      break;
    }
  }
  // 没有哪门课指定：默认规则按所有课的 key 算（各门课各自的设置不混在一起）
  if (!choice) choice = featureChoice(feature, rows, { features: {}, partnerModels: null });

  const usable = sortByOrder(rows.filter(hasChatKey), getAiFeature(feature).order);
  const first = choice
    ? usable.findIndex(r => r.provider_id === choice!.providerId && (!choiceCourse || r.course_id === choiceCourse))
    : -1;
  const preferred = first >= 0 ? [usable[first], ...usable.filter((_, i) => i !== first)] : usable;
  return toChain(orderConfigsByHealth(preferred), choice);
}

export async function resolveProvider(userId: string, feature: AiFeatureId = 'practice'): Promise<ProviderConfig | null> {
  const [first, ...rest] = await resolveProviderChain(userId, feature);
  return first ? { ...first, fallbacks: rest } : null;
}

/**
 * 属于某一门课的功能（讨论速览、讨论室、计算思维工具）：只用这门课的 key，
 * 这门课给这个功能指定的模型排第一，其余按原顺序，冷却中的沉底。
 */
export async function resolveCourseProviderChain(courseId: string, feature: AiFeatureId): Promise<ProviderConfig[]> {
  const rows = await loadCourseAiRows(courseId).catch(() => [] as CourseAiRow[]);
  const { rows: candidates, choice } = featureCandidateRows(feature, rows);
  return toChain(orderConfigsByHealth(candidates), choice);
}

/** DMX 的候选：课程设置里给这个功能指定了 DMX 的某个模型就先试它，再走任务分档。 */
function dmxCandidates(cfg: ProviderConfig, taskKind: TaskKind): string[] {
  const tier = pickModels(taskKind);
  const pinned = cfg.model && cfg.model !== 'auto' ? cfg.model : null;
  return (pinned ? [pinned, ...tier.filter(m => m !== pinned)] : tier).slice(0, 3);
}

/** 低于这个预算的调用关掉思考，和 aiProviderConfig 的 DeepSeek 规则同一个数 */
const SMALL_BUDGET_TOKENS = 1500;

/**
 * OpenAI 兼容的请求体，套上各家的怪脾气，和 support、turingTestAi 同一套。
 *
 * 2026-10-05 以前这里一样都没套：画布顶上的讨论主题（900 token）每次都生成失败——
 * DeepSeek、智谱、DMX 的 GLM 和 DeepSeek 默认开思考，推理把 900 个 token 全用完，正文为空
 * （HTTP 200、finish_reason=length，一条日志都不留）；Kimi 只收 temperature=1，直接 400。
 * 预算小的调用（JSON 抽取、几句话的回复）关掉思考；预算大的照旧，不改原来的行为。
 */
export function openAiCompatibleBody(providerId: string, model: string, system: string, user: string, maxTokens: number, temperature: number): Record<string, unknown> {
  let body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature: providerTemperature(providerId, model, temperature),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  if (maxTokens < SMALL_BUDGET_TOKENS) {
    body = withFastChatOptions(providerId, model, body);
    // DMX 转发的 DeepSeek、GLM 不认 withFastChatOptions（那只按原厂判断），得显式关
    if (isDmxProvider(providerId) && /deepseek|glm/i.test(model)) body = { ...body, thinking: { type: 'disabled' } };
  }
  return applyModelQuirks(model, body);
}

/** HTTP 200 却没有能用的正文：以前不留日志，看起来像「没人回答」 */
function logEmptyAnswer(providerId: string, model: string, json: any): void {
  const choice = json?.choices?.[0];
  const reasoningTokens = json?.usage?.completion_tokens_details?.reasoning_tokens;
  console.warn(`[thinkingTrainer] ${providerId}/${model} 返回 200 但没有可用的正文（finish=${choice?.finish_reason ?? '?'}${reasoningTokens != null ? `，推理用了 ${reasoningTokens} token` : ''}）`);
}

/** One JSON-oriented completion against a specific model. */
async function callJsonOnce(cfg: ProviderConfig, model: string, system: string, user: string, maxTokens: number): Promise<{ parsed: Record<string, unknown> | null; status: number }> {
  const endpoint = cfg.endpointUrl?.trim() || getProviderEndpoint(cfg.providerId);
  if (cfg.endpointUrl?.trim()) await assertSafePublicUrl(cfg.endpointUrl.trim());
  const isAnthropic = cfg.providerId === 'anthropic';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: Record<string, unknown>;
  if (isAnthropic) {
    headers['x-api-key'] = cfg.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
  } else {
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    body = openAiCompatibleBody(cfg.providerId, model, system, user, maxTokens, 0.8);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const resp = await aiFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      console.error(`[thinkingTrainer] LLM ${cfg.providerId}/${model} HTTP ${resp.status}`);
      return { parsed: null, status: resp.status };
    }
    const json = await resp.json() as any;
    const text: string = isAnthropic
      ? (json?.content?.[0]?.text ?? '')
      : (json?.choices?.[0]?.message?.content ?? '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      logEmptyAnswer(cfg.providerId, model, json);
      return { parsed: null, status: 200 };
    }
    return { parsed: JSON.parse(text.slice(start, end + 1)), status: 200 };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    console.error(`[thinkingTrainer] LLM call failed (${model}):`, e instanceof Error ? e.message : e);
    return { parsed: null, status: timedOut ? 408 : 0 };
  }
}

/**
 * Non-streaming JSON-oriented completion. On DMX the model-router walks the
 * task's model tier with health-based failover (429/5xx/timeout → cooldown →
 * next model); other providers use their single configured model.
 */
/**
 * @param fallbacks 原厂模型返回 200 但 JSON 不合法时，依次换这些配置重试。
 *   原来这种情况直接返回 null —— 冷却只影响「下一次」，「这一次」就废了。
 *   GLM 偶尔会用自然语言开头再给 JSON，正好踩中。
 */
export async function callJson(cfg: ProviderConfig, system: string, user: string, maxTokens = 1500, taskKind: TaskKind = 'fast', fallbacks: ProviderConfig[] = cfg.fallbacks ?? []): Promise<Record<string, unknown> | null> {
  if (!isDmxProvider(cfg.providerId)) {
    const started = Date.now();
    const { parsed, status } = await callJsonOnce(cfg, cfg.model, system, user, maxTokens);
    if (parsed) {
      reportProviderSuccess(cfg.providerId);
    } else if (status !== 200) {
      // Native key saturated or erroring — cool the provider so the next
      // resolveProvider() call falls through to DMX immediately
      reportProviderFailure(cfg.providerId, status === 408 ? 'timeout' : classifyHttpFailure(status));
    }
    void started;
    if (parsed) return parsed;
    for (const alt of fallbacks) {
      if (alt.providerId === cfg.providerId) continue;
      const r = await callJson(alt, system, user, maxTokens, taskKind);
      if (r) return r;
    }
    return null;
  }

  for (const model of dmxCandidates(cfg, taskKind)) {
    const started = Date.now();
    const { parsed, status } = await callJsonOnce(cfg, model, system, user, maxTokens);
    if (parsed) {
      reportModelSuccess(model, Date.now() - started);
      return parsed;
    }
    if (status === 200) {
      // Model responded but JSON was malformed — don't punish its health
      continue;
    }
    reportModelFailure(model, status === 408 ? 'timeout' : classifyHttpFailure(status));
  }
  // DMX 排在前面（课程指定了 DMX，或原厂都在冷却）时，分档走完再换候选链上的下一家
  for (const alt of fallbacks) {
    if (alt.providerId === cfg.providerId) continue;
    const r = await callJson(alt, system, user, maxTokens, taskKind);
    if (r) return r;
  }
  return null;
}

/** 一次纯文本补全。与 callJsonOnce 同一条请求路径，只是不强求 JSON。 */
async function callChatOnce(cfg: ProviderConfig, model: string, system: string, user: string, maxTokens: number): Promise<{ text: string | null; status: number }> {
  const endpoint = cfg.endpointUrl?.trim() || getProviderEndpoint(cfg.providerId);
  if (cfg.endpointUrl?.trim()) await assertSafePublicUrl(cfg.endpointUrl.trim());
  const isAnthropic = cfg.providerId === 'anthropic';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: Record<string, unknown>;
  if (isAnthropic) {
    headers['x-api-key'] = cfg.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
  } else {
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    body = openAiCompatibleBody(cfg.providerId, model, system, user, maxTokens, 0.85);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const resp = await aiFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      console.error(`[chat] LLM ${cfg.providerId}/${model} HTTP ${resp.status}`);
      return { text: null, status: resp.status };
    }
    const json = await resp.json() as any;
    const text: string = isAnthropic
      ? (json?.content?.[0]?.text ?? '')
      : (json?.choices?.[0]?.message?.content ?? '');
    const trimmed = String(text).trim();
    if (!trimmed) logEmptyAnswer(cfg.providerId, model, json);
    return { text: trimmed || null, status: 200 };
  } catch {
    return { text: null, status: 408 };
  }
}

/**
 * 纯文本版的 callJson。AI 同学在讨论室里说的是人话，不是结构化数据，
 * 硬套 JSON 只会让它写得像填表。
 *
 * 与 callJson 一样带候选链兜底：原厂返回空或报错时依次换下一家。
 */
export async function callChat(cfg: ProviderConfig, system: string, user: string, maxTokens = 500, taskKind: TaskKind = 'chat', fallbacks: ProviderConfig[] = cfg.fallbacks ?? []): Promise<string | null> {
  if (!isDmxProvider(cfg.providerId)) {
    const { text, status } = await callChatOnce(cfg, cfg.model, system, user, maxTokens);
    if (text) { reportProviderSuccess(cfg.providerId); return text; }
    if (status !== 200) {
      reportProviderFailure(cfg.providerId, status === 408 ? 'timeout' : classifyHttpFailure(status));
    }
    for (const alt of fallbacks) {
      if (alt.providerId === cfg.providerId) continue;
      const r = await callChat(alt, system, user, maxTokens, taskKind);
      if (r) return r;
    }
    return null;
  }
  for (const model of dmxCandidates(cfg, taskKind)) {
    const started = Date.now();
    const { text, status } = await callChatOnce(cfg, model, system, user, maxTokens);
    if (text) { reportModelSuccess(model, Date.now() - started); return text; }
    if (status === 200) continue;
    reportModelFailure(model, status === 408 ? 'timeout' : classifyHttpFailure(status));
  }
  for (const alt of fallbacks) {
    if (alt.providerId === cfg.providerId) continue;
    const r = await callChat(alt, system, user, maxTokens, taskKind);
    if (r) return r;
  }
  return null;
}

// ── Course concepts for topical grounding ──────────────────────

async function getCourseTopics(userId: string): Promise<string[]> {
  const { data: members } = await supabase.from('course_members').select('course_id').eq('user_id', userId);
  const courseIds = (members ?? []).map((m: any) => m.course_id);
  if (courseIds.length === 0) return [];
  const { data: spaces } = await supabase.from('spaces').select('id').in('course_id', courseIds);
  const spaceIds = (spaces ?? []).map((s: any) => s.id);
  if (spaceIds.length === 0) return [];
  const { data: notes } = await supabase
    .from('notes')
    .select('title')
    .in('space_id', spaceIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(30);
  return (notes ?? []).map((n: any) => String(n.title ?? '').trim()).filter(t => t.length >= 4).slice(0, 10);
}

// ── Built-in fallbacks (no-LLM mode) ───────────────────────────

const FALLACY_TYPES: Record<string, { zh: string; desc: string }> = {
  ad_hominem: { zh: '人身攻击', desc: '攻击提出观点的人，而不是观点本身' },
  slippery_slope: { zh: '滑坡谬误', desc: '认为一件小事必然引发一连串灾难性后果' },
  straw_man: { zh: '稻草人谬误', desc: '歪曲对方的观点，然后攻击这个歪曲版本' },
  appeal_to_authority: { zh: '诉诸权威', desc: '仅因为权威人士说过就认为正确，缺乏证据' },
  false_dilemma: { zh: '非黑即白', desc: '把复杂问题简化为只有两个极端选项' },
  circular_reasoning: { zh: '循环论证', desc: '用结论本身来证明结论' },
  hasty_generalization: { zh: '以偏概全', desc: '从个别案例草率得出普遍结论' },
  appeal_to_emotion: { zh: '诉诸情感', desc: '用煽动情绪代替讲道理' },
};

const BUILTIN_FALLACY_QUESTIONS = [
  {
    topic: '手机与学习',
    sentences: ['很多学校在讨论是否允许学生带手机。', '手机确实能帮助我们查资料和记笔记。', '但是如果允许带手机，学生就会玩游戏，成绩下降，最后没有人能考上大学。', '所以学校需要制定合理的手机使用规则。'],
    fallacyIndex: 2, fallacyType: 'slippery_slope',
    explanation: '第 3 句从"允许带手机"直接推出"没人能考上大学"，中间的每一步都不必然发生——这是典型的滑坡谬误。',
  },
  {
    topic: '环保行动',
    sentences: ['我们班在讨论要不要发起垃圾分类活动。', '小明反对这个提案的某些细节。', '小明连自己的桌子都收拾不干净，他的意见根本不值得听。', '其实大家可以先试行一个月再评估效果。'],
    fallacyIndex: 2, fallacyType: 'ad_hominem',
    explanation: '第 3 句攻击的是小明这个人（桌子不干净），而不是他对提案的具体意见——人身攻击谬误。',
  },
  {
    topic: '读书方法',
    sentences: ['关于如何高效阅读，同学们有不同看法。', '有人建议先看目录建立整体框架。', '一位著名教授说过快速翻页就是最好的方法，所以这一定是对的。', '也许不同的书需要不同的读法。'],
    fallacyIndex: 2, fallacyType: 'appeal_to_authority',
    explanation: '第 3 句仅凭"著名教授说过"就断定正确，没有给出任何证据或理由——诉诸权威谬误。',
  },
  {
    topic: '午餐选择',
    sentences: ['学校食堂在征集新菜单的意见。', '要么全部换成西餐，要么维持现状一点不变，没有别的选择。', '许多同学希望能增加几个新菜品试试。', '食堂表示会分批调整。'],
    fallacyIndex: 1, fallacyType: 'false_dilemma',
    explanation: '第 2 句把菜单调整说成只有"全换"或"不变"两个极端，忽略了部分调整等中间方案——非黑即白谬误。',
  },
  {
    topic: '运动与健康',
    sentences: ['体育课改革方案正在讨论中。', '我表弟不爱运动但身体很好，所以运动对健康根本没有作用。', '研究表明适量运动能改善心肺功能。', '学校计划增加运动项目的多样性。'],
    fallacyIndex: 1, fallacyType: 'hasty_generalization',
    explanation: '第 2 句只用"我表弟"一个例子就否定运动的普遍作用——以偏概全谬误。',
  },
  {
    topic: '科学课实验',
    sentences: ['科学课上我们讨论实验记录的重要性。', '认真记录很重要，因为记录是一件重要的事情。', '完整的数据能帮助我们发现实验中的规律。', '老师建议每人准备一本实验日志。'],
    fallacyIndex: 1, fallacyType: 'circular_reasoning',
    explanation: '第 2 句用"记录很重要"来证明"记录很重要"，理由和结论是同一句话——循环论证。',
  },
];

const BUILTIN_ARENA_TOPICS = [
  { topic: '学校应该用 AI 批改作文', aiStance: 'AI 批改高效、标准统一，还能即时反馈，学校应该全面采用。' },
  { topic: '小学生应该有自己的智能手机', aiStance: '智能手机让孩子能随时联系家长、查询资料，利大于弊。' },
  { topic: '课堂笔记应该全部电子化', aiStance: '电子笔记方便搜索、不会丢失、还能插入多媒体，纸质笔记已经过时。' },
  { topic: '学生的作业应该由同学互评', aiStance: '互评能让学生学会评价标准，比老师一个人批改更有学习价值。' },
  { topic: '游戏化学习比传统课堂更有效', aiStance: '游戏机制让学习充满动力，所有课程都应该游戏化。' },
  { topic: '取消期末考试，用平时项目代替', aiStance: '一次考试无法反映真实水平，项目制评价更全面、更真实。' },
];

const BUILTIN_LADDER_ASSERTIONS = [
  '人工智能迟早会取代大部分老师的工作。',
  '看视频学习比看书学习效果更好。',
  '班级里声音最大的人往往想法最多。',
  '把知识背下来就等于学会了。',
  '网络上的信息比课本更新，所以更可靠。',
  '小组讨论时人越多，产生的好想法就越多。',
];

const QUESTION_DEPTH_TYPES: Record<string, { zh: string; weight: number }> = {
  clarify_concept: { zh: '澄清概念', weight: 2 },
  probe_assumption: { zh: '质疑假设', weight: 4 },
  seek_evidence: { zh: '寻找证据', weight: 3 },
  explore_implication: { zh: '探究影响', weight: 4 },
  shift_perspective: { zh: '转换视角', weight: 5 },
};

// Heuristic ladder scoring when no LLM is available
function heuristicLadderEval(question: string): { depthType: string; depthScore: number; feedback: string } {
  const q = question.trim();
  if (/为什么|why/i.test(q)) return { depthType: 'probe_assumption', depthScore: 3, feedback: '「为什么」是挖掘假设的好起点，试着更具体地指出你怀疑的前提。' };
  if (/证据|数据|怎么知道|如何证明|evidence|how do (we|you) know/i.test(q)) return { depthType: 'seek_evidence', depthScore: 4, feedback: '很好，你在追问主张背后的证据基础。' };
  if (/如果|会怎样|后果|影响|what if|consequence/i.test(q)) return { depthType: 'explore_implication', depthScore: 4, feedback: '你在探究这个主张的推论和影响，这能检验它是否站得住脚。' };
  if (/谁|立场|角度|视角|换.*看|perspective/i.test(q)) return { depthType: 'shift_perspective', depthScore: 5, feedback: '出色！转换视角常常能发现被忽略的盲点。' };
  if (/什么意思|定义|指的是|mean|define/i.test(q)) return { depthType: 'clarify_concept', depthScore: 2, feedback: '先澄清概念是严谨思考的第一步，接下来试着质疑它的假设。' };
  return { depthType: 'clarify_concept', depthScore: 1, feedback: '这个问题还比较表面，试着问「这个说法预设了什么？」或「有什么证据？」' };
}

function heuristicArenaEval(cardType: string, text: string): { clarity: number; evidence: number; logic: number; relevance: number; rebuttal: string } {
  const len = text.trim().length;
  const base = len > 80 ? 3 : len > 40 ? 2 : 1;
  const cardBonus: Record<string, Partial<Record<'evidence' | 'logic' | 'clarity', number>>> = {
    evidence: { evidence: 2 }, challenge: { logic: 1 }, clarify: { clarity: 2 }, question: { logic: 1 }, extend: {},
  };
  const b = cardBonus[cardType] ?? {};
  return {
    clarity: Math.min(base + (b.clarity ?? 0), 5),
    evidence: Math.min(base + (b.evidence ?? 0) - (cardType === 'evidence' && len < 40 ? 1 : 0), 5),
    logic: Math.min(base + (b.logic ?? 0), 5),
    relevance: Math.min(base + 1, 5),
    rebuttal: '有意思的回应。不过你的论证还需要更具体的支撑——能给出一个真实的例子或数据吗？（离线陪练模式）',
  };
}

// ── Session helpers ────────────────────────────────────────────

async function loadSession(id: string, userId: string) {
  const { data, error } = await supabase
    .from('thinking_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Session not found');
  return data;
}

async function saveSession(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from('thinking_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new ApiError(500, error.message);
}

// ── POST /thinking-trainer/sessions — start a game ─────────────

router.post('/thinking-trainer/sessions', verifyJWT, startLimit, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { mode, difficulty = 1 } = req.body as { mode: Mode; difficulty?: number };
  if (!['fallacy', 'arena', 'ladder'].includes(mode)) throw new ApiError(400, 'Invalid mode');
  const diff = Math.min(Math.max(Number(difficulty) || 1, 1), 3);

  const cfg = await resolveProvider(userId);
  const topics = await getCourseTopics(userId);
  const topicHint = topics.length > 0
    ? `可选题材（来自学生课程讨论，优先结合）：${topics.slice(0, 6).join('；')}`
    : '题材使用贴近中学生/大学生生活的话题';

  let state: Record<string, unknown> = {};
  let clientPayload: Record<string, unknown> = {};
  let topic = '';

  if (mode === 'fallacy') {
    let questions: any[] | null = null;
    if (cfg) {
      const gen = await callJson(cfg,
        '你是逻辑思维训练题的出题人。只输出 JSON，不要输出其他内容。',
        `生成 3 道"找出逻辑谬误"题目。${topicHint}。难度 ${diff}/3（难度越高谬误越隐蔽）。
每道题是一段 4-5 句的简短论证（中文，每句一个数组元素，口语自然），其中恰好 1 句包含指定谬误。
谬误类型从这些键中选（每题不同）：${Object.keys(FALLACY_TYPES).join(', ')}。
输出格式：
{"questions":[{"topic":"话题","sentences":["句1","句2","句3","句4"],"fallacyIndex":2,"fallacyType":"slippery_slope","explanation":"为什么这句是该谬误（50字内）"}]}`,
        2000);
      const qs = (gen?.questions as any[]) ?? null;
      if (qs && qs.length >= 2 && qs.every(q =>
        Array.isArray(q.sentences) && q.sentences.length >= 3
        && Number.isInteger(q.fallacyIndex) && q.fallacyIndex >= 0 && q.fallacyIndex < q.sentences.length
        && FALLACY_TYPES[q.fallacyType])) {
        questions = qs.slice(0, 3);
      }
    }
    if (!questions) {
      questions = [...BUILTIN_FALLACY_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 3);
    }
    topic = questions.map(q => q.topic).join(' / ');
    state = { questions, current: 0, combo: 0, llm: !!cfg };
    clientPayload = {
      totalQuestions: questions.length,
      question: { topic: questions[0].topic, sentences: questions[0].sentences },
      fallacyOptions: Object.entries(FALLACY_TYPES).map(([k, v]) => ({ key: k, label: v.zh, desc: v.desc })),
    };
  }

  if (mode === 'arena') {
    let setup: { topic: string; aiStance: string } | null = null;
    if (cfg) {
      const gen = await callJson(cfg,
        '你是辩论陪练。只输出 JSON。',
        `生成一个适合学生辩论的争议话题和你（AI 方）的开场立论。${topicHint}。难度 ${diff}/3。
输出：{"topic":"话题（20字内）","aiStance":"AI 的开场立论（60字内，观点鲜明但留有可攻击的漏洞）"}`);
      if (gen?.topic && gen?.aiStance) setup = { topic: String(gen.topic), aiStance: String(gen.aiStance) };
    }
    if (!setup) setup = BUILTIN_ARENA_TOPICS[Math.floor(Math.random() * BUILTIN_ARENA_TOPICS.length)];
    topic = setup.topic;
    state = { ...setup, round: 0, maxRounds: 3, myHp: 100, aiHp: 100, history: [], llm: !!cfg };
    clientPayload = { topic: setup.topic, aiStance: setup.aiStance, maxRounds: 3, myHp: 100, aiHp: 100 };
  }

  if (mode === 'ladder') {
    let assertion: string | null = null;
    if (cfg) {
      const gen = await callJson(cfg,
        '你是苏格拉底式提问训练的出题人。只输出 JSON。',
        `生成一个学生日常会脱口而出、但经不起深究的断言（中文，30字内）。${topicHint}。
输出：{"assertion":"断言"}`);
      if (gen?.assertion) assertion = String(gen.assertion);
    }
    if (!assertion) assertion = BUILTIN_LADDER_ASSERTIONS[Math.floor(Math.random() * BUILTIN_LADDER_ASSERTIONS.length)];
    topic = assertion;
    state = { assertion, rungs: [], maxRungs: 5, llm: !!cfg };
    clientPayload = {
      assertion,
      maxRungs: 5,
      depthTypes: Object.entries(QUESTION_DEPTH_TYPES).map(([k, v]) => ({ key: k, label: v.zh, weight: v.weight })),
    };
  }

  const { data: session, error } = await supabase
    .from('thinking_sessions')
    .insert({ user_id: userId, mode, topic, difficulty: diff, state, status: 'active' })
    .select('id')
    .single();
  if (error) throw new ApiError(500, error.message);

  res.json({ sessionId: session.id, mode, difficulty: diff, aiPowered: !!cfg, ...clientPayload });
});

// ── POST /thinking-trainer/sessions/:id/move ───────────────────

router.post('/thinking-trainer/sessions/:id/move', verifyJWT, moveLimit, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const session = await loadSession(String(req.params.id), userId);
  if (session.status !== 'active') throw new ApiError(400, 'Session already finished');
  const state = session.state as any;

  // ── FALLACY: instant server-side judging ──
  if (session.mode === 'fallacy') {
    const { sentenceIndex, fallacyType } = req.body as { sentenceIndex: number; fallacyType: string };
    const q = state.questions[state.current];
    if (!q) throw new ApiError(400, 'No active question');

    const sentenceCorrect = Number(sentenceIndex) === q.fallacyIndex;
    const typeCorrect = fallacyType === q.fallacyType;
    let gained = 0;
    if (sentenceCorrect) gained += 50;
    if (typeCorrect) gained += 50;
    if (sentenceCorrect && typeCorrect) {
      state.combo = (state.combo ?? 0) + 1;
      gained += (state.combo - 1) * 20;
    } else {
      state.combo = 0;
    }

    state.current += 1;
    const nextQ = state.questions[state.current];
    const done = !nextQ;
    const newScore = session.score + gained;
    const deltas = session.skill_deltas as Record<string, number>;
    deltas.logic = (deltas.logic ?? 0) + (sentenceCorrect ? 2 : 0) + (typeCorrect ? 1 : 0);
    deltas.clarity = (deltas.clarity ?? 0) + (typeCorrect ? 1 : 0);

    await saveSession(session.id, {
      state, score: newScore, rounds_completed: state.current, skill_deltas: deltas,
      ...(done ? { status: 'completed', completed_at: new Date().toISOString() } : {}),
    });

    return res.json({
      result: {
        sentenceCorrect, typeCorrect, gained, combo: state.combo,
        correctIndex: q.fallacyIndex,
        correctType: q.fallacyType,
        correctTypeLabel: FALLACY_TYPES[q.fallacyType]?.zh ?? q.fallacyType,
        explanation: q.explanation,
      },
      score: newScore,
      done,
      next: done ? null : { topic: nextQ.topic, sentences: nextQ.sentences, index: state.current },
    });
  }

  // ── ARENA: card + text, LLM (or heuristic) evaluates ──
  if (session.mode === 'arena') {
    const { cardType, text } = req.body as { cardType: string; text: string };
    if (!['extend', 'clarify', 'question', 'challenge', 'evidence'].includes(cardType)) throw new ApiError(400, 'Invalid card');
    if (!text?.trim() || text.length > 600) throw new ApiError(400, 'Argument text required (≤600 chars)');

    const cfg = state.llm ? await resolveProvider(userId) : null;
    let evalResult = cfg ? await callJson(cfg,
      '你是辩论评委兼陪练 AI。只输出 JSON。',
      `辩题：${state.topic}
你的立场：${state.aiStance}
历史交锋：${JSON.stringify((state.history ?? []).slice(-4))}
学生本回合使用「${cardType}」话语卡，论述：「${text.trim()}」

请评分并给出你的反驳。评分 0-5 分：clarity(表达清晰), evidence(证据支撑), logic(逻辑严密), relevance(切题程度)。
反驳要犀利但友善，直指学生论证中最薄弱的一点，60字内，最后附一个追问。
输出：{"clarity":3,"evidence":2,"logic":4,"relevance":5,"rebuttal":"反驳内容","aiWeakness":"你这次反驳里自己暴露的一个小漏洞（给学生下回合抓，20字内）"}`) : null;

    const scores = evalResult ?? heuristicArenaEval(cardType, text);
    const clarity = Math.min(Math.max(Number(scores.clarity) || 0, 0), 5);
    const evidence = Math.min(Math.max(Number(scores.evidence) || 0, 0), 5);
    const logic = Math.min(Math.max(Number(scores.logic) || 0, 0), 5);
    const relevance = Math.min(Math.max(Number(scores.relevance) || 0, 0), 5);
    const myDamage = Math.round((clarity + evidence + logic + relevance) * 2.2); // 0-44
    const aiDamage = Math.max(8, 30 - Math.round((logic + evidence) * 2.5)); // weaker args → bigger hit back

    state.aiHp = Math.max(0, state.aiHp - myDamage);
    state.myHp = Math.max(0, state.myHp - aiDamage);
    state.round += 1;
    state.history = [...(state.history ?? []), { round: state.round, cardType, text: text.slice(0, 200), scores: { clarity, evidence, logic, relevance }, rebuttal: scores.rebuttal }];

    const done = state.round >= state.maxRounds || state.aiHp <= 0 || state.myHp <= 0;
    const gained = myDamage + (state.aiHp <= 0 ? 50 : 0);
    const newScore = session.score + gained;
    const deltas = session.skill_deltas as Record<string, number>;
    deltas.clarity = (deltas.clarity ?? 0) + clarity;
    deltas.evidence = (deltas.evidence ?? 0) + evidence;
    deltas.logic = (deltas.logic ?? 0) + logic;

    await saveSession(session.id, {
      state, score: newScore, rounds_completed: state.round, skill_deltas: deltas,
      ...(done ? { status: 'completed', completed_at: new Date().toISOString() } : {}),
    });

    return res.json({
      result: {
        scores: { clarity, evidence, logic, relevance },
        myDamage, aiDamage,
        rebuttal: String(scores.rebuttal ?? ''),
        aiWeakness: String((scores as any).aiWeakness ?? ''),
        gained,
      },
      myHp: state.myHp, aiHp: state.aiHp, round: state.round, maxRounds: state.maxRounds,
      score: newScore,
      done,
      won: state.aiHp <= 0 || (done && state.myHp > state.aiHp),
    });
  }

  // ── LADDER: question depth evaluation ──
  if (session.mode === 'ladder') {
    const { question } = req.body as { question: string };
    if (!question?.trim() || question.length > 300) throw new ApiError(400, 'Question required (≤300 chars)');

    const cfg = state.llm ? await resolveProvider(userId) : null;
    const prevQuestions = (state.rungs ?? []).map((r: any) => r.question);
    let evalResult = cfg ? await callJson(cfg,
      '你是苏格拉底式提问教练。只输出 JSON。',
      `断言：「${state.assertion}」
学生已提出的问题：${JSON.stringify(prevQuestions)}
学生新问题：「${question.trim()}」

评估这个问题：
- depthType 从中选一：clarify_concept(澄清概念) / probe_assumption(质疑假设) / seek_evidence(寻找证据) / explore_implication(探究影响) / shift_perspective(转换视角)
- depthScore 1-5（问题的深度与锋利程度；与已有问题重复则 ≤1）
- feedback：一句点评 + 一个把思考推得更深的提示（60字内）
输出：{"depthType":"probe_assumption","depthScore":4,"feedback":"..."}`) : null;

    const parsed = evalResult && QUESTION_DEPTH_TYPES[String(evalResult.depthType)]
      ? { depthType: String(evalResult.depthType), depthScore: Math.min(Math.max(Number(evalResult.depthScore) || 1, 1), 5), feedback: String(evalResult.feedback ?? '') }
      : heuristicLadderEval(question);

    const typeWeight = QUESTION_DEPTH_TYPES[parsed.depthType]?.weight ?? 2;
    const gained = parsed.depthScore * 10 + typeWeight * 5;
    state.rungs = [...(state.rungs ?? []), { question: question.slice(0, 300), ...parsed }];

    const done = state.rungs.length >= state.maxRungs;
    const newScore = session.score + gained;
    const deltas = session.skill_deltas as Record<string, number>;
    deltas.questioning = (deltas.questioning ?? 0) + parsed.depthScore;
    if (parsed.depthType === 'shift_perspective') deltas.perspective = (deltas.perspective ?? 0) + 3;
    if (parsed.depthType === 'seek_evidence') deltas.evidence = (deltas.evidence ?? 0) + 2;

    await saveSession(session.id, {
      state, score: newScore, rounds_completed: state.rungs.length, skill_deltas: deltas,
      ...(done ? { status: 'completed', completed_at: new Date().toISOString() } : {}),
    });

    return res.json({
      result: {
        depthType: parsed.depthType,
        depthLabel: QUESTION_DEPTH_TYPES[parsed.depthType]?.zh ?? parsed.depthType,
        depthScore: parsed.depthScore,
        feedback: parsed.feedback,
        gained,
      },
      rung: state.rungs.length, maxRungs: state.maxRungs,
      score: newScore,
      done,
    });
  }

  throw new ApiError(400, 'Unknown mode');
});

// ── POST /thinking-trainer/sessions/:id/complete — settle XP ───

router.post('/thinking-trainer/sessions/:id/complete', verifyJWT, moveLimit, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const session = await loadSession(String(req.params.id), userId);

  if (session.status === 'active') {
    await saveSession(session.id, { status: 'abandoned' });
  }

  const { data: existing } = await supabase
    .from('thinking_skill_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  const xpGain = Math.round(session.score / 10);
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const lastKey = existing?.last_played_at ? String(existing.last_played_at).slice(0, 10) : null;
  const yesterdayKey = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const streak = lastKey === todayKey
    ? (existing?.streak_days ?? 1)
    : lastKey === yesterdayKey
      ? (existing?.streak_days ?? 0) + 1
      : 1;

  const skills: Record<string, number> = { ...(existing?.skills ?? {}) };
  for (const [k, v] of Object.entries((session.skill_deltas ?? {}) as Record<string, number>)) {
    if ((SKILLS as readonly string[]).includes(k)) skills[k] = (skills[k] ?? 0) + v;
  }
  const bestScores: Record<string, number> = { ...(existing?.best_scores ?? {}) };
  bestScores[session.mode] = Math.max(bestScores[session.mode] ?? 0, session.score);

  const totalXp = (existing?.total_xp ?? 0) + xpGain;
  const level = Math.floor(Math.sqrt(totalXp / 50)) + 1;

  const profile = {
    user_id: userId,
    total_xp: totalXp,
    level,
    skills,
    games_played: (existing?.games_played ?? 0) + 1,
    streak_days: streak,
    last_played_at: now.toISOString(),
    best_scores: bestScores,
    updated_at: now.toISOString(),
  };
  const { error } = await supabase.from('thinking_skill_profiles').upsert(profile);
  if (error) throw new ApiError(500, error.message);

  res.json({
    xpGain,
    totalXp,
    level,
    leveledUp: level > (existing?.level ?? 1),
    streak,
    skills,
    bestScore: bestScores[session.mode],
    isNewBest: session.score >= (bestScores[session.mode] ?? 0) && session.score > 0,
  });
});

// ── GET /thinking-trainer/profile ──────────────────────────────

router.get('/thinking-trainer/profile', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [profileRes, recentRes] = await Promise.all([
    supabase.from('thinking_skill_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('thinking_sessions')
      .select('id, mode, topic, score, status, rounds_completed, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);
  const p = profileRes.data;
  res.json({
    profile: {
      totalXp: p?.total_xp ?? 0,
      level: p?.level ?? 1,
      nextLevelXp: Math.pow(p?.level ?? 1, 2) * 50,
      skills: p?.skills ?? {},
      gamesPlayed: p?.games_played ?? 0,
      streakDays: p?.streak_days ?? 0,
      bestScores: p?.best_scores ?? {},
    },
    recentSessions: recentRes.data ?? [],
  });
});

// ── GET /model-router/stats — model health observability ──────

router.get('/model-router/stats', verifyJWT, async (req: Request, res: Response) => {
  if (req.user!.role !== 'teacher' && req.user!.role !== 'admin') {
    throw new ApiError(403, 'Teacher only');
  }
  res.json(routerStats());
});

export default router;
