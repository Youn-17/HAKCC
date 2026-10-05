import { describe, expect, it } from 'vitest';
import type { JevAnswer } from './jevClient';
import {
  answerLengthTarget,
  depthQuestions,
  feedbackQuestions,
  feedbackState,
  interpretDepth,
  interpretFeedback,
  TRIGGER_CODES,
} from './jevJudgments';

const T = { need: 0.6, promising: 0.6 };

const choice = (pick: string, probabilities: Record<string, number>): JevAnswer =>
  ({ type: 'choice', choice: pick, confidence: Math.max(...Object.values(probabilities)), probabilities });

describe('feedbackQuestions', () => {
  it('有没有问题、是不是好想法是两道是/否题，类型是 T1–T6 单选；默认只问正序', () => {
    const q = feedbackQuestions('en');
    expect(Object.keys(q)).toEqual(['need', 'promising', 'type']);
    expect(q.need.type).toBe('noul');
    expect(q.promising.type).toBe('noul');
    expect(q.type.type).toBe('choice');
    expect(Object.keys((q.type as { criteria: Record<string, unknown> }).criteria)).toEqual([...TRIGGER_CODES]);
  });

  it('正序倒序都问：倒序那题的选项顺序反过来，内容一样', () => {
    const q = feedbackQuestions('zh', ['forward', 'reverse']);
    const forward = (q.type as { criteria: Record<string, string> }).criteria;
    const reverse = (q.type_reverse as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(reverse)).toEqual([...TRIGGER_CODES].reverse());
    for (const code of TRIGGER_CODES) expect(reverse[code]).toBe(forward[code]);
  });

  it('中英两份题面都写了「默认没有」', () => {
    expect(feedbackQuestions('en').need.instructions).toContain('The default is no');
    expect(feedbackQuestions('zh').need.instructions).toContain('默认没有');
  });
});

describe('feedbackState', () => {
  it('只发标题和正文，正文截到 2000 字', () => {
    const state = feedbackState(' 标题 ', 'a'.repeat(2500));
    expect(Object.keys(state)).toEqual(['title', 'note']);
    expect(state.title).toBe('标题');
    expect(state.note).toHaveLength(2000);
  });
});

describe('interpretFeedback', () => {
  it('概率到阈值才算要；正倒序取平均，选平均最高的类', () => {
    const judged = interpretFeedback({
      need: { type: 'noul', noul: 0.72 },
      type: choice('T2', { T1: 0.05, T2: 0.5, T3: 0.4, T4: 0.05, T5: 0, T6: 0 }),
      type_reverse: choice('T3', { T1: 0.05, T2: 0.3, T3: 0.6, T4: 0.05, T5: 0, T6: 0 }),
    }, T)!;

    expect(judged.need).toBe(true);
    expect(judged.needProbability).toBe(0.72);
    expect(judged.type).toBe('T3');
    expect(judged.typeProbabilities.T3).toBeCloseTo(0.5);
    expect(judged.typeConfidence).toBeCloseTo(0.5);
    expect(judged.orderAgreement).toBe(false);
  });

  it('低于阈值就不要；只问一遍时 orderAgreement 是 null', () => {
    const judged = interpretFeedback({
      need: { type: 'noul', noul: 0.59 },
      type: choice('T6', { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0.2, T6: 0.8 }),
    }, T)!;
    expect(judged.need).toBe(false);
    expect(judged.reason).toBeNull();
    expect(judged.promisingProbability).toBeNull();
    expect(judged.type).toBe('T6');
    expect(judged.orderAgreement).toBeNull();
  });

  it('没有问题、但好想法过了阈值：要，类型定为 T5', () => {
    const judged = interpretFeedback({
      need: { type: 'noul', noul: 0.2 },
      promising: { type: 'noul', noul: 0.8 },
      type: choice('T2', { T1: 0, T2: 0.6, T3: 0, T4: 0, T5: 0.4, T6: 0 }),
    }, T)!;
    expect(judged.need).toBe(true);
    expect(judged.reason).toBe('promising');
    expect(judged.type).toBe('T5');
    expect(judged.typeConfidence).toBeCloseTo(0.4);
  });

  it('有问题优先：两题都过阈值时按问题算，类型取类型题的', () => {
    const judged = interpretFeedback({
      need: { type: 'noul', noul: 0.9 },
      promising: { type: 'noul', noul: 0.9 },
      type: choice('T1', { T1: 0.9, T2: 0, T3: 0, T4: 0, T5: 0.1, T6: 0 }),
    }, T)!;
    expect(judged.reason).toBe('gap');
    expect(judged.type).toBe('T1');
  });

  it('两题都没过：不要', () => {
    const judged = interpretFeedback({
      need: { type: 'noul', noul: 0.1 },
      promising: { type: 'noul', noul: 0.3 },
      type: choice('T5', { T1: 0, T2: 0, T3: 0, T4: 0, T5: 1, T6: 0 }),
    }, T)!;
    expect(judged.need).toBe(false);
    expect(judged.reason).toBeNull();
  });

  it('两个阈值分开用：问题 0.54 过了 0.5；好想法 0.67 没过 0.7', () => {
    const split = { need: 0.5, promising: 0.7 };
    const pastedAi = interpretFeedback({
      need: { type: 'noul', noul: 0.54 },
      promising: { type: 'noul', noul: 0.12 },
      type: choice('T1', { T1: 0.9, T2: 0, T3: 0, T4: 0, T5: 0.1, T6: 0 }),
    }, split)!;
    const critiquesAi = interpretFeedback({
      need: { type: 'noul', noul: 0.11 },
      promising: { type: 'noul', noul: 0.67 },
      type: choice('T5', { T1: 0, T2: 0, T3: 0, T4: 0, T5: 1, T6: 0 }),
    }, split)!;
    expect(pastedAi).toMatchObject({ need: true, reason: 'gap', type: 'T1' });
    expect(critiquesAi).toMatchObject({ need: false, reason: null });
  });

  it('缺了要不要那题或类型题：读不出判断', () => {
    expect(interpretFeedback({ type: choice('T1', { T1: 1 }) }, T)).toBeNull();
    expect(interpretFeedback({ need: { type: 'noul', noul: 0.9 } }, T)).toBeNull();
  });
});

describe('回答长度', () => {
  it('深度题是三档分级', () => {
    const q = depthQuestions('zh').depth as { type: string; criteria: string[] };
    expect(q.type).toBe('score');
    expect(q.criteria).toHaveLength(3);
  });

  it('深度按各档概率算期望，不管档位从 0 还是从 1 编号', () => {
    const zeroBased: JevAnswer = { type: 'score', score: 1.2, confidence: 0.5, probabilities: { 0: 0.2, 1: 0.4, 2: 0.4 } };
    const oneBased: JevAnswer = { type: 'score', score: 2.2, confidence: 0.5, probabilities: { 1: 0.2, 2: 0.4, 3: 0.4 } };
    expect(interpretDepth(zeroBased)).toBeCloseTo(1.2);
    expect(interpretDepth(oneBased)).toBeCloseTo(1.2);
  });

  it('概率不全就用 score，夹在 0–2；不是分级题读不出来', () => {
    expect(interpretDepth({ type: 'score', score: 5, confidence: 1, probabilities: {} })).toBe(2);
    expect(interpretDepth({ type: 'noul', noul: 0.5 })).toBeNull();
    expect(interpretDepth(undefined)).toBeNull();
  });

  it('档位定比例：250 / 550 / 1000；没有深度判断就按档位', () => {
    expect(answerLengthTarget('short')).toBe(250);
    expect(answerLengthTarget('medium', null)).toBe(550);
    expect(answerLengthTarget('long', Number.NaN)).toBe(1000);
  });

  it('深浅微调：最浅七折，中等不变，最深 1.3 倍', () => {
    expect(answerLengthTarget('short', 0)).toBe(180);
    expect(answerLengthTarget('medium', 0)).toBe(390);
    expect(answerLengthTarget('medium', 0.5)).toBe(470);
    expect(answerLengthTarget('medium', 1)).toBe(550);
    expect(answerLengthTarget('long', 2)).toBe(1300);
    expect(answerLengthTarget('medium', 1.5)).toBe(630);
    expect(answerLengthTarget('medium', 9)).toBe(720);
  });
});
