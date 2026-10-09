import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JevConfig } from '../config/jev';
import { JevError } from './jevClient';
import {
  RECOMMEND_THRESHOLDS,
  chooseRecommendation,
  clearScaffoldRecommendCacheForTests,
  fitQuestions,
  rankQuestions,
  recommendScaffold,
  recommendState,
  shortlist,
  type ScaffoldOption,
} from './scaffoldRecommend';

/**
 * 写笔记时推荐支架（2026-10-09）。Jev 换成假的，看两步怎么问、怎么读、什么时候不推荐。
 * 题面和门槛的依据是 scripts/jevScaffoldCheck.ts 跑的 24 份草稿（181 条全局支架）。
 */

const CONFIG: JevConfig = {
  apiKey: 'k', endpoint: 'https://jev.test', model: 'jev-1.13.0', timeoutMs: 4000, feedbackMode: 'shadow',
  needThreshold: 0.5, promisingThreshold: 0.7, answerLength: true, drawJudge: true, citationCheck: true, scaffoldRecommend: true,
};

const OPTIONS: ScaffoldOption[] = [
  { id: 'a', title: 'My theory', titleEn: 'My theory', group: 'Theory Building' },
  { id: 'b', title: '我的想法/观点是', titleEn: 'My idea/viewpoint is', group: '表达与改进观点' },
  { id: 'c', title: '我不同意你的观点，理由是', titleEn: 'I disagree with your viewpoint; the reason is', group: '表达与改进观点' },
  { id: 'd', title: '我们可以对这个问题/任务进行一个分工', titleEn: 'We can divide this problem/task as follows', group: '团队组织与管理' },
];

const choice = (probabilities: Record<string, number>) => ({
  type: 'choice' as const,
  choice: Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0][0],
  confidence: 0.9,
  probabilities,
});
const reply = (answers: Record<string, unknown>) => ({ model: 'jev-1.13.0', latencyMs: 300, usage: { inputTokens: 10000, outputTokens: 0 }, answers });

beforeEach(() => clearScaffoldRecommendCacheForTests());

describe('第一步：全部支架排序', () => {
  it('每条支架一个选项（话头、英文、所在的组），正序倒序各一题，再问草稿有没有实在内容', () => {
    const q = rankQuestions(OPTIONS);
    expect(Object.keys(q)).toEqual(['pick', 'pick_reverse', 'substantive']);
    const forward = (q.pick as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(forward)).toEqual(['s1', 's2', 's3', 's4']);
    expect(forward.s2).toBe('「我的想法/观点是」（My idea/viewpoint is） — 表达与改进观点');
    // 英文和中文一样时不重复写
    expect(forward.s1).toBe('「My theory」 — Theory Building');
    expect(Object.keys((q.pick_reverse as { criteria: Record<string, string> }).criteria)).toEqual(['s4', 's3', 's2', 's1']);
  });

  it('前几名按正序倒序的平均概率排', () => {
    const top = shortlist({
      pick: choice({ s1: 0.5, s2: 0.3, s3: 0.2, s4: 0 }),
      pick_reverse: choice({ s1: 0.1, s2: 0.7, s3: 0.2, s4: 0 }),
    });
    expect(top.map(t => t.key)).toEqual(['s2', 's1', 's3']);
    expect(top[0].p).toBeCloseTo(0.5);
  });

  it('Build-on 时带上原笔记的开头；草稿截到 1500 字', () => {
    const state = recommendState({ title: 't', text: '很长'.repeat(1000), parent: { title: '原笔记', text: '原文' } }) as { draft: { text: string }; building_on: unknown };
    expect(state.draft.text.length).toBeLessThanOrEqual(1500);
    expect(state.building_on).toEqual({ title: '原笔记', text: '原文' });
    expect(recommendState({ title: 't', text: 'x' })).not.toHaveProperty('building_on');
  });
});

describe('第二步：前三名逐条问合不合适', () => {
  it('每条一题合不合适，再在这几条里单选（正序倒序）', () => {
    const q = fitQuestions(OPTIONS.slice(0, 3));
    expect(Object.keys(q)).toEqual(['fit_0', 'fit_1', 'fit_2', 'best', 'best_reverse']);
    expect((q.fit_1 as { instructions: string }).instructions).toContain('「我的想法/观点是」');
  });

  it('合适的里面挑单选概率最高的；都不到门槛就不推荐', () => {
    const answers = {
      fit_0: { type: 'noul' as const, noul: 0.56 },
      fit_1: { type: 'noul' as const, noul: 0.7 },
      fit_2: { type: 'noul' as const, noul: 0.2 },
      best: choice({ c0: 0.6, c1: 0.3, c2: 0.1 }),
      best_reverse: choice({ c0: 0.6, c1: 0.3, c2: 0.1 }),
    };
    expect(chooseRecommendation(OPTIONS.slice(0, 3), answers, [0.7, 0.2, 0.1]).pick?.id).toBe('a');
    const low = { ...answers, fit_0: { type: 'noul' as const, noul: 0.4 }, fit_1: { type: 'noul' as const, noul: 0.3 } };
    expect(chooseRecommendation(OPTIONS.slice(0, 3), low, [0.7, 0.2, 0.1]).pick).toBeNull();
    expect(RECOMMEND_THRESHOLDS.fit).toBe(0.5);
  });
});

describe('recommendScaffold', () => {
  it('两步问完，推荐合适的那条；同一份草稿第二次用缓存', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(reply({ pick: choice({ s1: 0.7, s2: 0.2, s3: 0.1, s4: 0 }), pick_reverse: choice({ s1: 0.6, s2: 0.3, s3: 0.1, s4: 0 }), substantive: { type: 'noul', noul: 0.96 } }))
      .mockResolvedValueOnce(reply({ fit_0: { type: 'noul', noul: 0.56 }, fit_1: { type: 'noul', noul: 0.7 }, fit_2: { type: 'noul', noul: 0.1 }, best: choice({ c0: 0.3, c1: 0.6, c2: 0.1 }), best_reverse: choice({ c0: 0.3, c1: 0.6, c2: 0.1 }) }));
    const draft = { title: 'AI 让人懒', text: '我觉得 AI 让人懒得动脑，因为直接给答案。' };
    const first = await recommendScaffold(draft, OPTIONS, { config: CONFIG, ask: ask as never });
    expect(first).toMatchObject({ scaffold: { id: 'b' }, fit: 0.7, substantive: 0.96, model: 'jev-1.13.0' });
    expect(ask).toHaveBeenCalledTimes(2);
    const again = await recommendScaffold(draft, OPTIONS, { config: CONFIG, ask: ask as never });
    expect(again).toMatchObject({ scaffold: { id: 'b' }, cached: true });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('草稿没有实在内容（通知、道谢）：只问第一步，不推荐', async () => {
    const ask = vi.fn().mockResolvedValueOnce(reply({ pick: choice({ s4: 0.4, s1: 0.3, s2: 0.2, s3: 0.1 }), pick_reverse: choice({ s4: 0.4, s1: 0.3, s2: 0.2, s3: 0.1 }), substantive: { type: 'noul', noul: 0.05 } }));
    const out = await recommendScaffold({ title: '地点', text: '下周三的讨论改到图书馆三楼。' }, OPTIONS, { config: CONFIG, ask: ask as never });
    expect(out).toMatchObject({ scaffold: null, substantive: 0.05 });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('出错不推荐，记下出错类型；没开 Jev、没有支架返回 null', async () => {
    const ask = vi.fn().mockRejectedValueOnce(new JevError('timeout', 'slow'));
    expect(await recommendScaffold({ title: '', text: '一段足够长的草稿内容，有观点也有理由。' }, OPTIONS, { config: CONFIG, ask: ask as never }))
      .toMatchObject({ scaffold: null, error: 'timeout' });
    expect(await recommendScaffold({ title: '', text: '草稿' }, OPTIONS, { config: { ...CONFIG, scaffoldRecommend: false } })).toBeNull();
    expect(await recommendScaffold({ title: '', text: '草稿' }, [], { config: CONFIG })).toBeNull();
  });
});
