import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readJevConfig } from '../config/jev';
import { JevError, type JevResult } from './jevClient';
import {
  clearJevFeedbackCacheForTests,
  decidedTypeDirective,
  feedbackThresholds,
  jevContextSummary,
  judgeFeedbackWithJev,
} from './feedbackJev';
import type { feedbackQuestions } from './jevJudgments';

/**
 * 自动反馈里 Jev 那一步（2026-10-05）：阈值按教师灵敏度调、只问英文正序三题、
 * 同一段文字 10 分钟内只问一次、出错不抛。
 */

type Qs = ReturnType<typeof feedbackQuestions>;
const config = (mode: string, extra: Record<string, string> = {}) =>
  readJevConfig({ JEV_API_KEY: 'k', JEV_FEEDBACK_MODE: mode, ...extra } as NodeJS.ProcessEnv);

function answers(need: number, promising: number, type: string): JevResult<Qs> {
  const probabilities = Object.fromEntries(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map(code => [code, code === type ? 0.8 : 0.04]));
  return {
    model: 'jev-1.13.0',
    answers: {
      need: { type: 'noul', noul: need },
      promising: { type: 'noul', noul: promising },
      type: { type: 'choice', choice: type, confidence: 0.8, probabilities },
    } as unknown as JevResult<Qs>['answers'],
    usage: { inputTokens: 1400, outputTokens: 0 },
    latencyMs: 420,
  };
}

beforeEach(() => clearJevFeedbackCacheForTests());

describe('feedbackThresholds：教师的灵敏度在基准上调', () => {
  const base = { need: 0.5, promising: 0.7 };
  it.each([
    ['balanced', false, { need: 0.5, promising: 0.7 }],
    ['conservative', false, { need: 0.65, promising: 0.8 }],
    ['aggressive', false, { need: 0.35, promising: 0.6 }],
    ['balanced', true, { need: 0.65, promising: 0.8 }],
    ['conservative', true, { need: 0.65, promising: 0.8 }],
    ['aggressive', true, { need: 0.5, promising: 0.7 }],
  ] as const)('%s（学生多数反馈都忽略：%s）', (sensitivity, fatigued, expected) => {
    expect(feedbackThresholds(base, sensitivity, { fatigued })).toEqual(expected);
  });

  it('不超出 0.05–0.95', () => {
    expect(feedbackThresholds({ need: 0.9, promising: 0.9 }, 'conservative')).toEqual({ need: 0.95, promising: 0.95 });
    expect(feedbackThresholds({ need: 0.1, promising: 0.1 }, 'aggressive')).toEqual({ need: 0.05, promising: 0.05 });
  });
});

describe('judgeFeedbackWithJev', () => {
  it('没开（没 key 或 off）：不问，返回 null', async () => {
    const ask = vi.fn();
    expect(await judgeFeedbackWithJev('t', '正文', { config: readJevConfig({} as NodeJS.ProcessEnv), ask })).toBeNull();
    expect(await judgeFeedbackWithJev('t', '正文', { config: config('off'), ask })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it('只发标题和正文；英文题面、三题、只问正序；shadow 不重试、gate 重试', async () => {
    const ask = vi.fn(async () => answers(0.8, 0.1, 'T3'));
    await judgeFeedbackWithJev('数据与结论', '我认为数据越多结论就一定越可靠。', { config: config('shadow'), ask });
    const [state, questions, options] = ask.mock.calls[0] as unknown as [Record<string, string>, Record<string, { instructions: string }>, { retry: boolean }];
    expect(state).toEqual({ title: '数据与结论', note: '我认为数据越多结论就一定越可靠。' });
    expect(Object.keys(questions)).toEqual(['need', 'promising', 'type']);
    expect(questions.need.instructions).toMatch(/^The state is a student's note/);
    expect(options.retry).toBe(false);

    await judgeFeedbackWithJev('数据与结论', '另一条笔记的正文。', { config: config('gate'), ask });
    expect((ask.mock.calls[1] as unknown as [unknown, unknown, { retry: boolean }])[2].retry).toBe(true);
  });

  it('读答案：有问题按类型题；没问题但好想法够高是 T5；都不够就不要', async () => {
    const run = (need: number, promising: number) =>
      judgeFeedbackWithJev('t', `正文 ${need} ${promising}`, { config: config('shadow'), ask: async () => answers(need, promising, 'T3') });
    expect((await run(0.8, 0.1))?.judgment).toMatchObject({ need: true, reason: 'gap', type: 'T3' });
    expect((await run(0.2, 0.75))?.judgment).toMatchObject({ need: true, reason: 'promising', type: 'T5' });
    expect((await run(0.2, 0.6))?.judgment).toMatchObject({ need: false, reason: null });
  });

  it('同一段文字 10 分钟内只问一次；缓存的答案按这次的阈值重新读', async () => {
    let now = 1_000_000;
    const ask = vi.fn(async () => answers(0.55, 0.1, 'T2'));
    const first = await judgeFeedbackWithJev('t', '同一段文字', { config: config('shadow'), ask, now: () => now });
    expect(first).toMatchObject({ cached: false, latencyMs: 420, inputTokens: 1400, judgment: { need: true } });

    now += 9 * 60_000;
    const again = await judgeFeedbackWithJev('t', '同一段文字', { config: config('shadow'), ask, now: () => now, sensitivity: 'conservative' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ cached: true, thresholds: { need: 0.65 }, judgment: { need: false } });
    expect(again?.inputTokens).toBeUndefined();

    now += 2 * 60_000;
    await judgeFeedbackWithJev('t', '同一段文字', { config: config('shadow'), ask, now: () => now });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('出错不抛：带上错误类型，不做判断', async () => {
    const timeout = await judgeFeedbackWithJev('t', '正文一', {
      config: config('gate'),
      ask: async () => { throw new JevError('timeout', 'no answer'); },
    });
    expect(timeout).toMatchObject({ mode: 'gate', judgment: null, error: 'timeout', cached: false });

    const other = await judgeFeedbackWithJev('t', '正文二', { config: config('gate'), ask: async () => { throw new Error('boom'); } });
    expect(other).toMatchObject({ judgment: null, error: 'other' });
  });

  it('出错的结果不进缓存：下一次照样去问', async () => {
    const ask = vi.fn()
      .mockRejectedValueOnce(new JevError('rate_limit', '429'))
      .mockResolvedValueOnce(answers(0.8, 0.1, 'T3'));
    await judgeFeedbackWithJev('t', '正文', { config: config('shadow'), ask });
    const second = await judgeFeedbackWithJev('t', '正文', { config: config('shadow'), ask });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ cached: false, judgment: { need: true } });
  });
});

describe('给大模型和研究记录的', () => {
  it('gate 时告诉大模型：已经定了要、定了哪一类', () => {
    const directive = decidedTypeDirective('T4');
    expect(directive).toContain('DECISION ALREADY MADE');
    expect(directive).toContain('type="T4"');
    expect(directive).toContain('need=1');
  });

  it('trigger_context.jev：出错只记错误；成功记概率、阈值、版本', async () => {
    expect(jevContextSummary(null)).toBeUndefined();
    const failed = await judgeFeedbackWithJev('t', 'x', { config: config('shadow'), ask: async () => { throw new JevError('auth', '403'); } });
    expect(jevContextSummary(failed)).toEqual({ mode: 'shadow', error: 'auth' });

    const ok = await judgeFeedbackWithJev('t', 'y', { config: config('shadow'), ask: async () => answers(0.8123, 0.1, 'T3') });
    expect(jevContextSummary(ok)).toMatchObject({
      mode: 'shadow', need: true, reason: 'gap', need_p: 0.812, type: 'T3', type_p: 0.8,
      thresholds: { need: 0.5, promising: 0.7 }, model: 'jev-1.13.0', latency_ms: 420,
    });
  });
});
