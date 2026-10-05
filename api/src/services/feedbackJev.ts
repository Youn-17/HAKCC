import { createHash } from 'node:crypto';
import { jevConfig, type JevConfig, type JevFeedbackMode } from '../config/jev';
import { askJev, JevError } from './jevClient';
import {
  feedbackQuestions,
  feedbackState,
  interpretFeedback,
  type FeedbackJudgment,
  type FeedbackThresholds,
  type TriggerCode,
} from './jevJudgments';

/**
 * AI 自动反馈中的可选 Jev 判断步骤。
 *
 * 一次请求问三题：有没有明显问题（T1–T4、T6）、是不是停在半路的好想法（T5）、哪一类。
 * 使用英文题面与正序选项。仅发送标题和正文前 2000 字，不附加用户姓名；正文仍可能含用户自行写入的信息。
 *
 * - shadow：大模型照常决定，Jev 陪跑，结果只记下来（feedback_trigger_checks、trigger_context.jev）；
 * - gate：Jev 决定要不要、哪一类，大模型只写正文；Jev 出错退回大模型判断。
 * 出错一律不抛：返回带 error 的结果，由调用方照原来的做法走。
 */

export type Sensitivity = 'conservative' | 'balanced' | 'aggressive';

const NEED_STEP = 0.15;
const PROMISING_STEP = 0.1;
const clampThreshold = (value: number) => Math.min(0.95, Math.max(0.05, Math.round(value * 100) / 100));

/**
 * 教师的「灵敏度」在基准阈值上调，和大模型那边的提示词同一个意思：
 * 保守（或这个学生多数反馈都忽略了）门槛高一档，积极低一档；两样都有就抵消。
 */
export function feedbackThresholds(base: FeedbackThresholds, sensitivity: Sensitivity, opts: { fatigued?: boolean } = {}): FeedbackThresholds {
  const shift = Math.max(-1, Math.min(1, (sensitivity === 'conservative' ? 1 : sensitivity === 'aggressive' ? -1 : 0) + (opts.fatigued ? 1 : 0)));
  return {
    need: clampThreshold(base.need + shift * NEED_STEP),
    promising: clampThreshold(base.promising + shift * PROMISING_STEP),
  };
}

export interface JevFeedbackCheck {
  mode: Exclude<JevFeedbackMode, 'off'>;
  thresholds: FeedbackThresholds;
  /** 出错时为 null */
  judgment: FeedbackJudgment | null;
  model?: string;
  latencyMs?: number;
  /** 用了缓存时不计 */
  inputTokens?: number;
  cached: boolean;
  /** JevError 的类型，或 bad_response / other */
  error?: string;
}

// ── 同一段文字 10 分钟内只问一次 ──────────────────────────────

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;
type Cached = { at: number; answers: Parameters<typeof interpretFeedback>[0]; model: string };
const cache = new Map<string, Cached>();

export function clearJevFeedbackCacheForTests(): void {
  cache.clear();
}

function remember(key: string, entry: Cached): void {
  cache.delete(key);
  cache.set(key, entry);
  // Map 按插入顺序迭代，最早的在前
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

export interface JudgeOptions {
  sensitivity?: Sensitivity;
  fatigued?: boolean;
  config?: JevConfig;
  /** gate 时 429 / 529 等一下再试一次；shadow 只是陪跑，不重试 */
  retry?: boolean;
  ask?: typeof askJev;
  now?: () => number;
}

/** 没开（没 key 或 JEV_FEEDBACK_MODE=off）返回 null，其余情况都返回一个结果 */
export async function judgeFeedbackWithJev(title: string, text: string, opts: JudgeOptions = {}): Promise<JevFeedbackCheck | null> {
  const config = opts.config ?? jevConfig();
  if (config.feedbackMode === 'off' || !config.apiKey) return null;
  const mode = config.feedbackMode;
  const now = opts.now ?? Date.now;
  const thresholds = feedbackThresholds(
    { need: config.needThreshold, promising: config.promisingThreshold },
    opts.sensitivity ?? 'balanced',
    { fatigued: opts.fatigued },
  );
  const state = feedbackState(title, text);
  const key = createHash('sha1').update(`${config.model}\n${state.title}\n${state.note}`).digest('hex');

  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS) {
    return { mode, thresholds, judgment: interpretFeedback(hit.answers, thresholds), model: hit.model, cached: true };
  }

  try {
    const result = await (opts.ask ?? askJev)(state, feedbackQuestions('en'), { config, retry: opts.retry ?? mode === 'gate' });
    const judgment = interpretFeedback(result.answers, thresholds);
    if (!judgment) return { mode, thresholds, judgment: null, cached: false, error: 'bad_response', model: result.model, latencyMs: result.latencyMs };
    remember(key, { at: now(), answers: result.answers, model: result.model });
    return {
      mode,
      thresholds,
      judgment,
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      cached: false,
    };
  } catch (err) {
    return { mode, thresholds, judgment: null, cached: false, error: err instanceof JevError ? err.kind : 'other' };
  }
}

const TYPE_LABEL: Record<TriggerCode, string> = {
  T1: 'Undigested AI',
  T2: 'No reasoning',
  T3: 'No evidence',
  T4: 'No connection',
  T5: 'Promising seed',
  T6: 'Unclear',
};

/** gate：要不要、哪一类已经定了，大模型只写这一类的正文、话头和标题 */
export function decidedTypeDirective(code: TriggerCode): string {
  return `\n\nDECISION ALREADY MADE: this note needs feedback of type ${code} (${TYPE_LABEL[code]}). `
    + `Return need=1 and type="${code}", and write the feedback, scaffold and title for that type.`;
}

/** 记进 note_ai_feedbacks.trigger_context.jev：研究导出直接带上，不用再去 join 检查表 */
export function jevContextSummary(jev: JevFeedbackCheck | null): Record<string, unknown> | undefined {
  if (!jev) return undefined;
  if (!jev.judgment) return { mode: jev.mode, error: jev.error ?? 'other' };
  return {
    mode: jev.mode,
    need: jev.judgment.need,
    reason: jev.judgment.reason,
    need_p: round3(jev.judgment.needProbability),
    promising_p: jev.judgment.promisingProbability == null ? null : round3(jev.judgment.promisingProbability),
    type: jev.judgment.type,
    type_p: round3(jev.judgment.typeConfidence),
    thresholds: jev.thresholds,
    model: jev.model,
    ...(jev.cached ? { cached: true } : { latency_ms: jev.latencyMs }),
  };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
