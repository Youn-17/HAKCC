import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AI 回答写多长：档位定比例，问题深浅由 Jev 判断（拿不到按关键词），字数只进提示词。
 */

const h = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  askJev: vi.fn(),
}));

vi.mock('../config/jev', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/jev')>();
  return { ...actual, jevConfig: () => actual.readJevConfig(h.env) };
});
vi.mock('./jevClient', () => ({ askJev: h.askJev }));

import { heuristicDepth, lengthInstruction, maxTokensFor, parseAnswerLength, planAnswerLength } from './answerLength';

const depthAnswer = (probabilities: Record<string, number>) => ({
  model: 'jev-1.13.0',
  latencyMs: 380,
  usage: { inputTokens: 120, outputTokens: 0 },
  answers: { depth: { type: 'score', score: 0, confidence: 1, probabilities } },
});

beforeEach(() => {
  h.env = { JEV_API_KEY: 'k' };
  h.askJev.mockReset();
});

describe('档位', () => {
  it('认不出来的都按适中', () => {
    expect(parseAnswerLength('short')).toBe('short');
    expect(parseAnswerLength('long')).toBe('long');
    expect(parseAnswerLength('huge')).toBe('medium');
    expect(parseAnswerLength(undefined)).toBe('medium');
  });
});

describe('没有 Jev 时的粗判', () => {
  it('比较、分析、设计算深；在哪、怎么点算浅；其余算中', () => {
    expect(heuristicDepth('比较一下知识建构和项目式学习的教师角色')).toBe(2);
    expect(heuristicDepth('如果要设计一个研究检验 AI 反馈，应该怎么设计？')).toBe(2);
    expect(heuristicDepth('Why does retrieval practice work?')).toBe(2);
    expect(heuristicDepth('Build-on 是什么意思？')).toBe(0);
    expect(heuristicDepth('怎么在笔记里插入图片？')).toBe(0);
    expect(heuristicDepth('能举个例子说说学习支架吗？')).toBe(1);
  });
});

describe('max_tokens 只防跑飞', () => {
  it('目标的 3 倍加 400，至少 1200；开思考的模型再加 4000', () => {
    expect(maxTokensFor(180)).toBe(1200);
    expect(maxTokensFor(550)).toBe(2050);
    expect(maxTokensFor(1300)).toBe(4300);
    expect(maxTokensFor(550, true)).toBe(6050);
  });
});

describe('planAnswerLength', () => {
  it('Jev 判深：适中档往长调，记下来源和版本', async () => {
    h.askJev.mockResolvedValue(depthAnswer({ 0: 0, 1: 0, 2: 1 }));
    const plan = await planAnswerLength('怎么设计一个研究？', 'medium');
    expect(plan).toMatchObject({ preset: 'medium', depth: 2, depthSource: 'jev', target: 720, jevModel: 'jev-1.13.0' });
    // 在学生等待的路径上：短超时、不重试
    expect(h.askJev.mock.calls[0][2]).toMatchObject({ timeoutMs: 2000, retry: false });
  });

  it('Jev 判浅：简短档往短调', async () => {
    h.askJev.mockResolvedValue(depthAnswer({ 0: 1, 1: 0, 2: 0 }));
    const plan = await planAnswerLength('怎么插入图片？', 'short');
    expect(plan).toMatchObject({ depth: 0, target: 180, depthSource: 'jev' });
  });

  it('Jev 超时或出错：按关键词粗判，照样给出目标', async () => {
    h.askJev.mockRejectedValue(new Error('timeout'));
    const plan = await planAnswerLength('比较两种评价方式的区别', 'long');
    expect(plan).toMatchObject({ depth: 2, depthSource: 'heuristic', target: 1300 });
    expect(plan.jevModel).toBeUndefined();
  });

  it('没配 Jev，或关了回答长度：不调 Jev', async () => {
    h.env = {};
    expect((await planAnswerLength('为什么？', 'medium')).depthSource).toBe('heuristic');
    h.env = { JEV_API_KEY: 'k', JEV_ANSWER_LENGTH: 'off' };
    await planAnswerLength('为什么？', 'medium');
    expect(h.askJev).not.toHaveBeenCalled();
  });
});

describe('提示词里怎么说', () => {
  it('写明档位和大约字数，强调写完整、不凑字数', () => {
    const text = lengthInstruction({ preset: 'medium', target: 550 });
    expect(text).toContain('about 550 Chinese characters');
    expect(text).toContain('适中');
    expect(text).toContain('never pad');
    expect(text).toContain('Always finish');
  });
});
