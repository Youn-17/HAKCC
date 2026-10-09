/** Optional server-side Jev judgments, including citation checks and draft scaffold suggestions.
 * Keep keys in the server environment; validate optional behavior on your own examples. */

export type JevFeedbackMode = 'off' | 'shadow' | 'gate';

export interface JevConfig {
  apiKey: string;
  endpoint: string;
  /** 固定版本号而不是 jev-latest：研究上要能说清每一次判断出自哪个版本 */
  model: string;
  timeoutMs: number;
  /**
   * off：不调 Jev。
   * shadow：Jev 跟着现在的大模型一起判断，只记录，决定仍由大模型做（先用这个比一致率）。
   * gate：Jev 决定要不要反馈、哪一类，大模型只写反馈正文。
   * 没有 key 时一律按 off。
   */
  feedbackMode: JevFeedbackMode;
  /** 「有明显问题」（T1–T4、T6）的概率到这个值才算要 */
  needThreshold: number;
  /** Separate threshold for promising unfinished ideas; calibrate before use. */
  promisingThreshold: number;
  /** 用 Jev 判断问题难度来定回答长度；没有 key 时为 false */
  answerLength: boolean;
  /** 用 Jev 判断要不要画、怎么画，并核对规划；没有 key 时为 false */
  drawJudge: boolean;
  /** 用 Jev 核对回答里的课程资料引用；没有 key 时为 false */
  citationCheck: boolean;
  /** 用 Jev 按草稿推荐支架；没有 key 时为 false */
  scaffoldRecommend: boolean;
}

export const JEV_DEFAULTS = {
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-1.13.0',
  timeoutMs: 4000,
  feedbackMode: 'shadow' as JevFeedbackMode,
  needThreshold: 0.5,
  promisingThreshold: 0.7,
} as const;

function readNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number((raw ?? '').trim());
  if (raw == null || raw.trim() === '' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readMode(raw: string | undefined): JevFeedbackMode {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'off' || value === 'shadow' || value === 'gate' ? value : JEV_DEFAULTS.feedbackMode;
}

export function readJevConfig(env: NodeJS.ProcessEnv): JevConfig {
  const apiKey = (env.JEV_API_KEY ?? '').trim();
  const hasKey = apiKey !== '';
  return {
    apiKey,
    endpoint: (env.JEV_ENDPOINT ?? '').trim() || JEV_DEFAULTS.endpoint,
    model: (env.JEV_MODEL ?? '').trim() || JEV_DEFAULTS.model,
    timeoutMs: readNumber(env.JEV_TIMEOUT_MS, JEV_DEFAULTS.timeoutMs, 500, 20_000),
    feedbackMode: hasKey ? readMode(env.JEV_FEEDBACK_MODE) : 'off',
    needThreshold: readNumber(env.JEV_NEED_THRESHOLD, JEV_DEFAULTS.needThreshold, 0.05, 0.95),
    promisingThreshold: readNumber(env.JEV_PROMISING_THRESHOLD, JEV_DEFAULTS.promisingThreshold, 0.05, 0.95),
    answerLength: hasKey && (env.JEV_ANSWER_LENGTH ?? '').trim().toLowerCase() !== 'off',
    drawJudge: hasKey && (env.JEV_DRAWING ?? '').trim().toLowerCase() !== 'off',
    citationCheck: hasKey && (env.JEV_CITATIONS ?? '').trim().toLowerCase() !== 'off',
    scaffoldRecommend: hasKey && (env.JEV_SCAFFOLDS ?? '').trim().toLowerCase() !== 'off',
  };
}

/** 每次用的时候读：改了 .env 重启进程就生效 */
export function jevConfig(): JevConfig {
  return readJevConfig(process.env);
}
