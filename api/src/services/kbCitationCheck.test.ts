import { describe, expect, it, vi } from 'vitest';
import type { JevConfig } from '../config/jev';
import { JevError } from './jevClient';
import {
  CITATION_THRESHOLDS,
  cardVerdict,
  checkCitations,
  citedClaims,
  interpretRelation,
  relationQuestions,
  relationVerdict,
  type PassageForCheck,
} from './kbCitationCheck';

/**
 * 课程资料的引用核对（2026-10-09）。Jev 换成假的，看三件事：从回答里拆出哪几处引用、怎么读答案、怎么定卡片。
 * 题面和门槛的依据是 scripts/jevCitationCheck.ts 跑的 22 对句子和 10 对回答。
 */

const CONFIG: JevConfig = {
  apiKey: 'k', endpoint: 'https://jev.test', model: 'jev-1.13.0', timeoutMs: 4000, feedbackMode: 'shadow',
  needThreshold: 0.5, promisingThreshold: 0.7, answerLength: true, drawJudge: true, citationCheck: true, scaffoldRecommend: true,
};

const PASSAGES: PassageForCheck[] = [
  { n: 1, source: '学习科学导读.pdf · 第三章 · 第 42 页', text: '检索练习组一周后正确率 61%，重读组 40%。' },
  { n: 2, source: '课程大纲.docx · 考核方式', text: '讨论参与 30%，小组汇报 30%，期末反思 40%。' },
];

const relationAnswer = (p: { supports: number; contradicts: number; says_nothing: number }) => {
  const choice = (Object.entries(p).sort((a, b) => b[1] - a[1])[0][0]);
  const one = { type: 'choice' as const, choice, confidence: 0.9, probabilities: p };
  return { model: 'jev-1.13.0', latencyMs: 300, usage: { inputTokens: 400, outputTokens: 0 }, answers: { relation: one, relation_reverse: one } };
};

describe('citedClaims：回答里哪几处标了引用', () => {
  it('编号写在句号后面也算前一句；一句标两段就是两处；不认识的编号不管', () => {
    const answer = '检索练习比重读记得更牢。[1] 讨论参与占三成[2]。另外，期末反思占四成[2][9]！\n- **小组汇报**也占 30% [2]';
    expect(citedClaims(answer, new Set([1, 2]))).toEqual([
      { n: 1, claim: '检索练习比重读记得更牢。' },
      { n: 2, claim: '讨论参与占三成。' },
      { n: 2, claim: '另外，期末反思占四成！' },
      { n: 2, claim: '小组汇报也占 30%' },
    ]);
  });

  it('太多时先保证每个编号都核对一句，最多 8 处', () => {
    const answer = Array.from({ length: 12 }, (_, i) => `第${i}句说到资料一[1]。`).join('') + '最后一句说到资料二[2]。';
    const pairs = citedClaims(answer, new Set([1, 2]));
    expect(pairs).toHaveLength(8);
    expect(pairs.map(p => p.n).slice(0, 2)).toEqual([1, 2]);
  });

  it('没有引用、只剩编号的不算', () => {
    expect(citedClaims('没有引用的回答。', new Set([1]))).toEqual([]);
    expect(citedClaims('[1]', new Set([1]))).toEqual([]);
  });
});

describe('读答案、定结论', () => {
  it('正序倒序都问；概率取平均', () => {
    const q = relationQuestions();
    expect(Object.keys((q.relation as { criteria: object }).criteria)).toEqual(['supports', 'contradicts', 'says_nothing']);
    expect(Object.keys((q.relation_reverse as { criteria: object }).criteria)).toEqual(['says_nothing', 'contradicts', 'supports']);
    const p = interpretRelation({
      relation: { type: 'choice', choice: 'supports', confidence: 1, probabilities: { supports: 0.8, contradicts: 0, says_nothing: 0.2 } },
      relation_reverse: { type: 'choice', choice: 'supports', confidence: 1, probabilities: { supports: 0.6, contradicts: 0, says_nothing: 0.4 } },
    })!;
    expect(p.supports).toBeCloseTo(0.7);
    expect(p.says_nothing).toBeCloseTo(0.3);
  });

  it('一处引用：支持到门槛算核对上，否则看矛盾，再否则是资料没说到', () => {
    expect(relationVerdict({ supports: CITATION_THRESHOLDS.supports, contradicts: 0, says_nothing: 0.5 })).toBe('supported');
    expect(relationVerdict({ supports: 0.1, contradicts: 0.8, says_nothing: 0.1 })).toBe('contradicted');
    expect(relationVerdict({ supports: 0.3, contradicts: 0.3, says_nothing: 0.4 })).toBe('unsupported');
  });

  it('一张卡片被引用多次：有一句核对上就算核对上', () => {
    expect(cardVerdict(['unsupported', 'supported'])).toBe('supported');
    expect(cardVerdict(['unsupported', 'contradicted'])).toBe('contradicted');
    expect(cardVerdict(['unsupported'])).toBe('unsupported');
  });
});

describe('checkCitations', () => {
  it('标了引用：每处问一次，卡片按结论标；交给 Jev 的是那一句和那一段', async () => {
    const ask = vi.fn(async (state: { claim: string }) => relationAnswer(
      state.claim.includes('一半') ? { supports: 0.01, contradicts: 0.98, says_nothing: 0.01 } : { supports: 0.99, contradicts: 0, says_nothing: 0.01 },
    ));
    const result = await checkCitations('检索练习比重读记得更牢[1]。讨论参与占一半[2]。', PASSAGES, { config: CONFIG, ask: ask as never });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[0][0]).toEqual({ claim: '检索练习比重读记得更牢。', passage: { source: PASSAGES[0].source, text: PASSAGES[0].text } });
    expect(result!.cards.get(1)).toEqual({ check: 'supported', p: 0.99 });
    expect(result!.cards.get(2)).toEqual({ check: 'contradicted', p: 0.01 });
    expect(result!.summary).toMatchObject({ pairs: 2, passages: 0, errors: 0, cited: true, model: 'jev-1.13.0' });
  });

  it('一个引用都没标：每段资料问回答用没用上', async () => {
    const ask = vi.fn(async (state: { passage: { text: string } }) => ({
      model: 'jev-1.13.0', latencyMs: 200, usage: { inputTokens: 500, outputTokens: 0 },
      answers: { uses: { type: 'noul', noul: state.passage.text.includes('61%') ? 0.95 : 0.03 } },
    }));
    const result = await checkCitations('检索练习组一周后记得更多，大约多了两成。', PASSAGES, { config: CONFIG, ask: ask as never });
    expect(result!.cards.get(1)).toEqual({ check: 'used', p: 0.95 });
    expect(result!.cards.get(2)).toEqual({ check: 'unused', p: 0.03 });
    expect(result!.summary).toMatchObject({ pairs: 0, passages: 2, cited: false });
  });

  it('单个请求出错：那张卡片没有结论，记一次出错；没开 Jev、没有资料返回 null', async () => {
    const ask = vi.fn()
      .mockRejectedValueOnce(new JevError('timeout', 'slow'))
      .mockResolvedValueOnce(relationAnswer({ supports: 1, contradicts: 0, says_nothing: 0 }));
    const result = await checkCitations('第一句[1]。第二句[2]。', PASSAGES, { config: CONFIG, ask: ask as never });
    expect(result!.summary.errors).toBe(1);
    expect(result!.cards.size).toBe(1);
    expect(await checkCitations('第一句[1]。', PASSAGES, { config: { ...CONFIG, citationCheck: false } })).toBeNull();
    expect(await checkCitations('第一句[1]。', [], { config: CONFIG })).toBeNull();
  });
});
