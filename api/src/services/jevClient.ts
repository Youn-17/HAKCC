import { jevConfig, type JevConfig } from '../config/jev';

/**
 * 调 Jev：发请求、等结果、把出错分清类。问什么由调用方定（jevJudgments.ts）。
 *
 * 出错一律抛 JevError，由调用方退回原来的做法。Jev 只是更快更省的判断，
 * 它挂了不能让反馈或回答整个失败。
 *
 * 接口（docs.typesafe.ai/api.md）：POST，Bearer key，请求 { model, state, questions }，
 * 返回 { model, answers, usage }。实测不带 key 时返回 403（文档写的是 401），两个都按 key 不对处理。
 */

export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface JevNoulAnswer { type: 'noul'; noul: number }
export interface JevChoiceAnswer { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
export interface JevScoreAnswer {
  type: 'score';
  /** 期望档位，从 0 起算，可以带小数 */
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend?: Record<string, string>;
}
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

type AnswerFor<Q extends JevQuestion> =
  Q extends { type: 'noul' } ? JevNoulAnswer : Q extends { type: 'choice' } ? JevChoiceAnswer : JevScoreAnswer;

export interface JevResult<Qs extends Record<string, JevQuestion>> {
  /** 实际作答的版本（别名会被解析成具体版本号） */
  model: string;
  answers: { [K in keyof Qs]: AnswerFor<Qs[K]> };
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export type JevErrorKind =
  | 'no_key' | 'auth' | 'invalid_request' | 'rate_limit' | 'overloaded'
  | 'timeout' | 'network' | 'bad_response' | 'http';

export class JevError extends Error {
  constructor(public readonly kind: JevErrorKind, message: string, public readonly status?: number) {
    super(message);
    this.name = 'JevError';
  }
}

/** 官方价目（2026-10）：每百万输入 token 0.042 美元，输出不收费 */
export const JEV_USD_PER_MILLION_INPUT = 0.042;

export function jevCostUsd(inputTokens: number): number {
  return (inputTokens * JEV_USD_PER_MILLION_INPUT) / 1_000_000;
}

export function classifyJevStatus(status: number): JevErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 422) return 'invalid_request';
  if (status === 429) return 'rate_limit';
  if (status === 503 || status === 529) return 'overloaded';
  return 'http';
}

const RETRY_DELAY_MIN_MS = 300;
const RETRY_DELAY_MAX_MS = 2000;
const RETRY_DELAY_DEFAULT_MS = 600;

function retryDelayMs(resp: Response): number {
  const seconds = Number(resp.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds <= 0) return RETRY_DELAY_DEFAULT_MS;
  return Math.min(RETRY_DELAY_MAX_MS, Math.max(RETRY_DELAY_MIN_MS, seconds * 1000));
}

/** 错误信息只取服务端说了什么，截短；请求头里的 key 不会出现在这里 */
async function readErrorDetail(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '');
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail;
    if (detail && typeof detail === 'object' && 'message' in detail) return String((detail as { message: unknown }).message).slice(0, 300);
    if (detail != null) return JSON.stringify(detail).slice(0, 300);
  } catch { /* 不是 JSON，用原文 */ }
  return text.slice(0, 300);
}

const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

function isProbabilityMap(value: unknown): value is Record<string, number> {
  return !!value && typeof value === 'object' && Object.values(value as Record<string, unknown>).every(isProbability);
}

/** 每个问题都要有答案、类型对得上、数值在范围内；单选的答案必须是给过的选项之一 */
function validateAnswers(questions: Record<string, JevQuestion>, answers: unknown): string | null {
  if (!answers || typeof answers !== 'object') return 'answers missing';
  const map = answers as Record<string, Record<string, unknown> | undefined>;
  for (const [key, question] of Object.entries(questions)) {
    const answer = map[key];
    if (!answer || answer.type !== question.type) return `answer for "${key}" missing or wrong type`;
    if (question.type === 'noul' && !isProbability(answer.noul)) return `answer for "${key}" has no probability`;
    if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !(answer.choice in question.criteria)) return `answer for "${key}" is not one of the options`;
      if (!isProbabilityMap(answer.probabilities)) return `answer for "${key}" has bad probabilities`;
    }
    if (question.type === 'score') {
      if (typeof answer.score !== 'number' || !Number.isFinite(answer.score)) return `answer for "${key}" has no score`;
      if (!isProbabilityMap(answer.probabilities)) return `answer for "${key}" has bad probabilities`;
    }
  }
  return null;
}

export interface AskJevOptions {
  config?: JevConfig;
  /** 不传用配置里的；给回答定长度这种卡在学生等待路径上的，传短一点 */
  timeoutMs?: number;
  /** 429 / 529 时等一下再试一次。默认试；在等待路径上的传 false */
  retry?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export async function askJev<Qs extends Record<string, JevQuestion>>(
  state: string | Record<string, unknown> | unknown[],
  questions: Qs,
  options: AskJevOptions = {},
): Promise<JevResult<Qs>> {
  const config = options.config ?? jevConfig();
  if (!config.apiKey) throw new JevError('no_key', 'JEV_API_KEY is not set');

  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const attempts = options.retry === false ? 1 : 2;
  const body = JSON.stringify({ model: config.model, state, questions });
  const started = Date.now();

  for (let attempt = 1; ; attempt += 1) {
    if (options.signal?.aborted) throw new JevError('timeout', 'aborted by caller');
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    options.signal?.addEventListener('abort', forwardAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let resp: Response;
    try {
      resp = await doFetch(config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = controller.signal.aborted;
      throw new JevError(aborted ? 'timeout' : 'network', aborted ? `no answer within ${timeoutMs} ms` : String((err as Error)?.message ?? err));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
    }

    if (resp.ok) {
      const json = await resp.json().catch(() => null) as { model?: unknown; answers?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null;
      const problem = json ? validateAnswers(questions, json.answers) : 'response is not JSON';
      if (problem) throw new JevError('bad_response', problem, resp.status);
      return {
        model: typeof json!.model === 'string' ? json!.model : config.model,
        answers: json!.answers as JevResult<Qs>['answers'],
        usage: {
          inputTokens: Number(json!.usage?.input_tokens) || 0,
          outputTokens: Number(json!.usage?.output_tokens) || 0,
        },
        latencyMs: Date.now() - started,
      };
    }

    const kind = classifyJevStatus(resp.status);
    if ((kind === 'rate_limit' || kind === 'overloaded') && attempt < attempts) {
      await resp.body?.cancel().catch(() => undefined);
      await sleep(retryDelayMs(resp));
      continue;
    }
    throw new JevError(kind, `Jev HTTP ${resp.status}: ${await readErrorDetail(resp)}`, resp.status);
  }
}
