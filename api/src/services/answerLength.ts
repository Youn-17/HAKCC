import { jevConfig } from '../config/jev';
import { askJev } from './jevClient';
import { answerLengthTarget, depthQuestions, interpretDepth, type AnswerLength } from './jevJudgments';

/**
 * AI 回答写多长（2026-10-05 用户：输出太多学生不想看；让学生选字数上限，但不是严格限制，
 * 按 250 / 550 / 1000 字的比例，再按问题难度自己判断；输出要完整，不要硬截断）。
 *
 * - 学生选档位：简短 / 适中 / 详细（默认适中）。
 * - 问题深浅由 Jev 判断（浅 / 中 / 深，约 0.4 秒，和读笔记同时跑，2 秒拿不到就不等），
 *   拿不到就按关键词粗判。深浅在档位上调：最浅七折，最深 1.3 倍（answerLengthTarget）。
 * - 字数只写进提示词。max_tokens 只防跑飞，按目标留足余量；真写到上限由调用方接着写一段，
 *   学生看到的始终是完整的回答。
 */

export type { AnswerLength } from './jevJudgments';
export const ANSWER_LENGTHS: readonly AnswerLength[] = ['short', 'medium', 'long'];

export function parseAnswerLength(raw: unknown): AnswerLength {
  return raw === 'short' || raw === 'long' ? raw : 'medium';
}

/** 没有 Jev 时的粗判：看问题要的是哪一类回答，不看问题本身多长 */
const DEEP = /为什么|比较|对比|区别|分析|评价|评估|论证|设计|方案|规划|权衡|利弊|优缺点|综合|怎样理解|如何理解|结合.{0,12}(笔记|资料|讨论|观点)|\b(why|compare|contrast|analy[sz]e|evaluate|design|trade-?offs?|synthesi[sz]e)\b|pros and cons/i;
const LIGHT = /(是什么|是啥|在哪|哪里|哪儿|能不能|可以吗|多少|几个|有没有|怎么.{0,8}(点|打开|找到?|上传|删除|保存|插入|设置|添加))|^(what is|where|how do i|can i|is there)\b/i;

export function heuristicDepth(question: string): number {
  const q = question.trim();
  if (DEEP.test(q)) return 2;
  if (LIGHT.test(q)) return 0;
  return 1;
}

/**
 * max_tokens 只防跑飞：中文一个字约 1–1.5 个 token，按目标字数的 3 倍再加 400，至少 1200。
 * 开思考的模型，思考也算在 max_tokens 里（DeepSeek 实测），再加 4000，否则回答会被挤空。
 */
export function maxTokensFor(targetChars: number, thinking = false): number {
  const base = Math.max(1200, Math.round(targetChars * 3 + 400));
  return Math.min(12_000, base + (thinking ? 4000 : 0));
}

export interface LengthPlan {
  preset: AnswerLength;
  /** 0 浅 – 2 深 */
  depth: number;
  depthSource: 'jev' | 'heuristic';
  /** 目标字数（中文字） */
  target: number;
  maxTokens: number;
  jevModel?: string;
  jevLatencyMs?: number;
}

const DEPTH_TIMEOUT_MS = 2000;

export async function planAnswerLength(
  question: string,
  preset: AnswerLength,
  opts: { thinking?: boolean; signal?: AbortSignal } = {},
): Promise<LengthPlan> {
  let depth: number | null = null;
  let jev: { model: string; latencyMs: number } | null = null;
  if (jevConfig().answerLength && question.trim()) {
    try {
      const result = await askJev(question.trim().slice(0, 1500), depthQuestions('en'), {
        timeoutMs: DEPTH_TIMEOUT_MS,
        retry: false,
        signal: opts.signal,
      });
      depth = interpretDepth(result.answers.depth);
      if (depth != null) jev = { model: result.model, latencyMs: result.latencyMs };
    } catch {
      // 拿不到就按关键词粗判，不让回答等它
    }
  }
  const finalDepth = depth ?? heuristicDepth(question);
  const target = answerLengthTarget(preset, finalDepth);
  return {
    preset,
    depth: Math.round(finalDepth * 100) / 100,
    depthSource: jev ? 'jev' : 'heuristic',
    target,
    maxTokens: maxTokensFor(target, opts.thinking),
    ...(jev ? { jevModel: jev.model, jevLatencyMs: jev.latencyMs } : {}),
  };
}

const LABEL: Record<AnswerLength, { zh: string; en: string }> = {
  short: { zh: '简短', en: 'brief' },
  medium: { zh: '适中', en: 'medium' },
  long: { zh: '详细', en: 'detailed' },
};

/** 追加在系统提示词最后 */
export function lengthInstruction(plan: Pick<LengthPlan, 'preset' | 'target'>): string {
  const words = Math.round((plan.target * 0.6) / 10) * 10;
  return [
    `Answer length: the student chose "${LABEL[plan.preset].en}" (${LABEL[plan.preset].zh}). Aim for about ${plan.target} Chinese characters (about ${words} English words if you answer in English).`,
    'This is a guide, not a limit: a simple question can take less, and never pad or repeat to reach it.',
    'Always finish: end with a complete sentence and a complete answer, never stop midway.',
  ].join(' ');
}

/**
 * 这一轮的模型会不会先思考。DeepSeek V4 默认开思考，思考用掉的 token 也算在 max_tokens 里
 * （aiProviderConfig 的 withDeepSeekOptions），预算要多留，否则正文被挤空。DMX 转发的 DeepSeek 一样按会思考算。
 */
export function thinkingLikely(providerId: string, model: string): boolean {
  return providerId === 'deepseek' || /deepseek/i.test(model);
}

/** 记进这条回答的 ai_metadata：研究上能看出学生选了哪档、问题判成多深、目标多少、实际写了多少、接没接着写 */
export function lengthPlanMetadata(
  plan: LengthPlan,
  reply: string,
  extra: { continuations?: number; truncated?: boolean } = {},
): Record<string, unknown> {
  return {
    preset: plan.preset,
    depth: plan.depth,
    depth_source: plan.depthSource,
    target: plan.target,
    max_tokens: plan.maxTokens,
    chars: reply.length,
    ...(extra.continuations ? { continuations: extra.continuations } : {}),
    ...(extra.truncated ? { truncated: true } : {}),
    ...(plan.jevModel ? { jev_model: plan.jevModel, jev_latency_ms: plan.jevLatencyMs } : {}),
  };
}
