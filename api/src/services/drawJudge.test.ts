import { describe, expect, it, vi } from 'vitest';
import type { JevConfig } from '../config/jev';
import { JevError } from './jevClient';
import {
  DRAW_ROUTE_THRESHOLDS,
  PLAN_CHECK_THRESHOLD,
  checkDrawPlan,
  choiceConfidence,
  decideDrawRoute,
  describePlan,
  drawRouteQuestions,
  drawRouteState,
  drawRouteSummary,
  interpretDrawRoute,
  parseDrawForm,
  parsePreviousDrawing,
  planCheckState,
  routeDrawRequest,
  sanitizeRouteSummary,
  type DrawJudgment,
  type PreviousDrawing,
} from './drawJudge';

/**
 * 画图的判断交给 Jev（2026-10-09）。Jev 换成假的，看三件事：问什么、怎么读答案、怎么和正则一起定。
 * 题面和阈值的依据是 scripts/jevDrawCheck.ts 跑的 68 句话、24 份规划。
 */

const CONFIG: JevConfig = {
  apiKey: 'k', endpoint: 'https://jev.test', model: 'jev-1.13.0', timeoutMs: 4000,
  feedbackMode: 'shadow', needThreshold: 0.5, promisingThreshold: 0.7, answerLength: true, drawJudge: true,
};

const PREVIOUS: PreviousDrawing = {
  request: '画一张我们讨论的观点关系图',
  caption: '画了五个看法之间的关系。',
  kind: 'diagram',
  diagram: { type: 'graph', nodes: [{ id: 'a', label: '观点一' }, { id: 'b', label: '观点二' }], edges: [{ from: 'a', to: 'b', label: '质疑' }] },
};

const choice = (probabilities: Record<string, number>) => {
  const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return { type: 'choice' as const, choice: top, confidence: 0.9, probabilities };
};

/** 一次判断的答案：正序、倒序给同样的概率 */
function answers(acts: Record<string, number>, forms: Record<string, number>) {
  return { act: choice(acts), act_reverse: choice(acts), form: choice(forms) };
}

const judged = (acts: Partial<DrawJudgment['acts']>, form: DrawJudgment['form'] = 'graph', formConfidence = 0.9): DrawJudgment => {
  const all = { new_drawing: 0, edit_drawing: 0, data_chart: 0, about_drawing: 0, text_answer: 0, ...acts };
  return {
    acts: all,
    drawProbability: all.new_drawing + all.edit_drawing,
    act: 'new_drawing',
    forms: { picture: 0, graph: 0, tree: 0, timeline: 0, [form]: 1 },
    form,
    formConfidence,
    orderAgreement: true,
  };
};

describe('drawRouteQuestions：问什么', () => {
  it('上一轮不是画图就不给「改刚才那张」；「要什么」正序倒序各问一遍，再问画成哪种', () => {
    const plain = drawRouteQuestions({ afterDrawing: false });
    expect(Object.keys(plain)).toEqual(['act', 'act_reverse', 'form']);
    const forward = plain.act as { criteria: Record<string, string> };
    const reverse = plain.act_reverse as { criteria: Record<string, string> };
    expect(Object.keys(forward.criteria)).toEqual(['new_drawing', 'data_chart', 'about_drawing', 'text_answer']);
    expect(Object.keys(reverse.criteria)).toEqual(['text_answer', 'about_drawing', 'data_chart', 'new_drawing']);
    expect(Object.keys((plain.form as { criteria: Record<string, string> }).criteria)).toEqual(['picture', 'graph', 'tree', 'timeline']);

    const after = drawRouteQuestions({ afterDrawing: true });
    expect(Object.keys((after.act as { criteria: Record<string, string> }).criteria)).toContain('edit_drawing');
  });

  it('state 只有这一句和上一轮做了什么，长句截断', () => {
    expect(drawRouteState('画一只猫')).toEqual({ learner_message: '画一只猫', previous_turn: 'Nothing yet: this is the first message' });
    const after = drawRouteState('颜色淡一点', PREVIOUS);
    expect(after.previous_turn).toContain('a relationship map');
    expect(after.previous_turn).toContain('画一张我们讨论的观点关系图');
    expect(drawRouteState('把上面的画成图', null, '检索练习分四步').previous_turn).toBe('The assistant replied in text: 检索练习分四步');
    expect(drawRouteState('很长'.repeat(400)).learner_message.length).toBeLessThanOrEqual(600);
  });
});

describe('interpretDrawRoute：怎么读答案', () => {
  it('正序倒序的概率取平均；要画 = 新画 + 改图；种类给出官方的把握度', () => {
    const j = interpretDrawRoute({
      act: choice({ new_drawing: 0.2, edit_drawing: 0.7, data_chart: 0, about_drawing: 0.05, text_answer: 0.05 }),
      act_reverse: choice({ new_drawing: 0.4, edit_drawing: 0.5, data_chart: 0, about_drawing: 0.05, text_answer: 0.05 }),
      form: choice({ picture: 0.1, graph: 0.7, tree: 0.1, timeline: 0.1 }),
    })!;
    expect(j.acts.edit_drawing).toBeCloseTo(0.6);
    expect(j.acts.new_drawing).toBeCloseTo(0.3);
    expect(j.drawProbability).toBeCloseTo(0.9);
    expect(j.act).toBe('edit_drawing');
    expect(j.form).toBe('graph');
    expect(j.formConfidence).toBeCloseTo((0.7 - 0.25) / 0.75);
    expect(j.orderAgreement).toBe(true);
  });

  it('答案缺题就当没判断', () => {
    expect(interpretDrawRoute({ form: choice({ picture: 1, graph: 0, tree: 0, timeline: 0 }) })).toBeNull();
    expect(interpretDrawRoute({ act: choice({ new_drawing: 1 }) })).toBeNull();
  });

  it('把握度：全押一个是 1，平均分是 0', () => {
    expect(choiceConfidence([1, 0, 0, 0])).toBe(1);
    expect(choiceConfidence([0.25, 0.25, 0.25, 0.25])).toBe(0);
  });
});

describe('decideDrawRoute：和正则一起定', () => {
  const base = { rule: false, dataChart: false, hasPrevious: false };

  it('Jev 不可用：照正则，新画，种类由规划定', () => {
    expect(decideDrawRoute({ ...base, rule: true, judgment: null })).toEqual({ draw: true, mode: 'new', form: null, decidedBy: 'rule' });
    expect(decideDrawRoute({ ...base, judgment: null }).draw).toBe(false);
  });

  it('正则没认出来（换了说法）：要画的概率到 add 才画', () => {
    expect(decideDrawRoute({ ...base, judgment: judged({ new_drawing: DRAW_ROUTE_THRESHOLDS.add }) }).draw).toBe(true);
    expect(decideDrawRoute({ ...base, judgment: judged({ new_drawing: DRAW_ROUTE_THRESHOLDS.add - 0.01, text_answer: 0.5 }) }).draw).toBe(false);
  });

  it('正则认出来了：Jev 很有把握说不是（低于 veto）才不画', () => {
    expect(decideDrawRoute({ ...base, rule: true, judgment: judged({ new_drawing: 0.3, about_drawing: 0.7 }) }).draw).toBe(true);
    expect(decideDrawRoute({ ...base, rule: true, judgment: judged({ new_drawing: 0.06, about_drawing: 0.94 }) }))
      .toMatchObject({ draw: false, decidedBy: 'jev' });
  });

  it('句子里有柱状图、饼图这类词：门槛高，Jev 选的是数据图就不画', () => {
    expect(decideDrawRoute({ ...base, dataChart: true, judgment: judged({ new_drawing: 0.8, data_chart: 0.2 }) }).draw).toBe(false);
    expect(decideDrawRoute({ ...base, dataChart: true, judgment: judged({ new_drawing: 0.9, data_chart: 0.1 }) }).draw).toBe(true);
    expect(decideDrawRoute({ ...base, dataChart: true, judgment: { ...judged({ new_drawing: 0.9 }), act: 'data_chart' } }).draw).toBe(false);
  });

  it('上一轮是画图、改图的概率大于新画：改上一张；种类把握度够才替规划定', () => {
    const edit = decideDrawRoute({ ...base, hasPrevious: true, judgment: judged({ edit_drawing: 0.7, new_drawing: 0.3 }, 'timeline', 0.8) });
    expect(edit).toEqual({ draw: true, mode: 'edit', form: 'timeline', decidedBy: 'jev' });
    expect(decideDrawRoute({ ...base, hasPrevious: true, judgment: judged({ edit_drawing: 0.3, new_drawing: 0.7 }) }).mode).toBe('new');
    expect(decideDrawRoute({ ...base, judgment: judged({ new_drawing: 1 }, 'tree', DRAW_ROUTE_THRESHOLDS.form - 0.01) }).form).toBeNull();
  });

  it('按了「画图」：一定画，Jev 只定改图还是新画、画成哪种', () => {
    expect(decideDrawRoute({ ...base, forced: true, judgment: judged({ text_answer: 1 }, 'picture') }))
      .toEqual({ draw: true, mode: 'new', form: 'picture', decidedBy: 'forced' });
  });
});

describe('routeDrawRequest', () => {
  it('和图不沾边、上一轮也不是画图：不问 Jev，直接对话', async () => {
    const ask = vi.fn();
    const route = await routeDrawRequest('总结一下我们刚才的讨论', { config: CONFIG, ask });
    expect(ask).not.toHaveBeenCalled();
    expect(route).toMatchObject({ draw: false, decidedBy: 'rule', rule: false });
  });

  it('换了说法的画图要求：问 Jev，按它的判断画，并记下判断经过', async () => {
    const ask = vi.fn(async () => ({
      model: 'jev-1.13.0', latencyMs: 300, usage: { inputTokens: 1100, outputTokens: 0 },
      answers: answers({ new_drawing: 0.98, data_chart: 0, about_drawing: 0.01, text_answer: 0.01 }, { picture: 0, graph: 0.95, tree: 0.05, timeline: 0 }),
    }));
    const route = await routeDrawRequest('能把刚才说的几个观点可视化一下吗？', { config: CONFIG, ask: ask as never });
    expect(ask).toHaveBeenCalledWith(
      { learner_message: '能把刚才说的几个观点可视化一下吗？', previous_turn: 'Nothing yet: this is the first message' },
      expect.objectContaining({ act: expect.anything(), act_reverse: expect.anything(), form: expect.anything() }),
      expect.objectContaining({ retry: false, timeoutMs: 1500 }),
    );
    expect(route).toMatchObject({ draw: true, mode: 'new', form: 'graph', decidedBy: 'jev', rule: false, jevModel: 'jev-1.13.0' });
    expect(drawRouteSummary(route)).toMatchObject({ draw: true, decided_by: 'jev', rule: false, p_draw: 0.98, act: 'new_drawing', form_guess: 'graph' });
  });

  it('上一轮刚画了图：「颜色淡一点」也问 Jev，判断为改图', async () => {
    const ask = vi.fn(async () => ({
      model: 'jev-1.13.0', latencyMs: 300, usage: { inputTokens: 1100, outputTokens: 0 },
      answers: answers({ new_drawing: 0.02, edit_drawing: 0.97, data_chart: 0, about_drawing: 0.005, text_answer: 0.005 }, { picture: 0, graph: 1, tree: 0, timeline: 0 }),
    }));
    const route = await routeDrawRequest('颜色淡一点', { config: CONFIG, ask: ask as never, previous: PREVIOUS });
    expect(route).toMatchObject({ draw: true, mode: 'edit', form: 'graph' });
  });

  it('Jev 出错、超时、没开：按正则走，记下出错的类型', async () => {
    const failing = vi.fn(async () => { throw new JevError('timeout', 'slow'); });
    expect(await routeDrawRequest('画一只猫', { config: CONFIG, ask: failing as never }))
      .toMatchObject({ draw: true, decidedBy: 'rule', jevError: 'timeout' });
    const ask = vi.fn();
    expect(await routeDrawRequest('画一只猫', { config: { ...CONFIG, drawJudge: false }, ask })).toMatchObject({ draw: true, decidedBy: 'rule' });
    expect(await routeDrawRequest('画一只猫', { config: { ...CONFIG, apiKey: '' }, ask })).toMatchObject({ draw: true, decidedBy: 'rule' });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('前端带来的东西要核过', () => {
  it('种类只认四种', () => {
    expect(parseDrawForm('tree')).toBe('tree');
    expect(parseDrawForm('pie')).toBeNull();
  });

  it('判断经过只留认识的字段，概率夹在 0–1，标上 from_client', () => {
    expect(sanitizeRouteSummary({ draw: true, mode: 'edit', p_draw: 1.7, act: 'edit_drawing', junk: '<script>', acts: { new_drawing: -1 } }))
      .toEqual({ draw: true, mode: 'edit', p_draw: 1, act: 'edit_drawing', acts: { new_drawing: 0, edit_drawing: 0, data_chart: 0, about_drawing: 0, text_answer: 0 }, from_client: true });
    expect(sanitizeRouteSummary('nope')).toBeNull();
    expect(sanitizeRouteSummary({ junk: 1 })).toBeNull();
  });

  it('上一张：结构图要过 normalizeDiagram，画面没描述就用当时的原话', () => {
    expect(parsePreviousDrawing({ request: '画猫', caption: 'c', kind: 'picture' })).toEqual({ request: '画猫', caption: 'c', kind: 'picture', prompt: '画猫' });
    expect(parsePreviousDrawing({ request: 'r', caption: '', kind: 'diagram', diagram: { type: 'graph', nodes: [] } })).toBeNull();
    expect(parsePreviousDrawing({ request: 'r', caption: '', kind: 'diagram', diagram: PREVIOUS.diagram })?.diagram?.nodes).toHaveLength(2);
    expect(parsePreviousDrawing({ kind: 'video' })).toBeNull();
  });
});

describe('checkDrawPlan：画得对不对', () => {
  const plan = { kind: 'diagram' as const, diagram: PREVIOUS.diagram!, caption: '画了两个观点的关系。' };

  it('交给 Jev 的是要求和规划：结构图列出框和连线', () => {
    const state = planCheckState('画一张关系图', plan) as { learner_request: string; plan: Record<string, string> };
    expect(state.learner_request).toBe('画一张关系图');
    expect(state.plan).toMatchObject({ boxes: '观点一；观点二', links: '观点一 → 观点二（质疑）' });
    expect(state.plan.kind).toMatch(/^a relationship map/);
    // 平台的时间线也用来画流程：写清楚，免得学生要「流程图」时被判成种类不对
    const steps = describePlan({ kind: 'diagram', caption: '', diagram: { type: 'timeline', nodes: [{ id: 's1', label: '回想' }], edges: [] } });
    expect(steps.kind).toContain('flowcharts');
    expect(describePlan({ kind: 'picture', prompt: 'A cat', caption: 'c' })).toEqual({ kind: 'a picture', description: 'A cat', note_to_learner: 'c' });
    expect(planCheckState('颜色淡一点', plan, PREVIOUS)).toHaveProperty('drawing_being_changed');
  });

  it('低于阈值算不合要求；出错算通过（核对只是把关，不能因为它画不成）；没开返回 null', async () => {
    const ask = (p: number) => vi.fn(async () => ({ model: 'jev-1.13.0', latencyMs: 200, usage: { inputTokens: 500, outputTokens: 0 }, answers: { matches: { type: 'noul', noul: p } } }));
    expect(await checkDrawPlan('r', plan, { config: CONFIG, ask: ask(PLAN_CHECK_THRESHOLD - 0.01) as never })).toMatchObject({ passed: false });
    expect(await checkDrawPlan('r', plan, { config: CONFIG, ask: ask(0.9) as never })).toMatchObject({ passed: true, matchProbability: 0.9 });
    const failing = vi.fn(async () => { throw new JevError('rate_limit', 'busy'); });
    expect(await checkDrawPlan('r', plan, { config: CONFIG, ask: failing as never })).toEqual({ matchProbability: null, passed: true, jevError: 'rate_limit' });
    expect(await checkDrawPlan('r', plan, { config: { ...CONFIG, drawJudge: false } })).toBeNull();
  });
});
