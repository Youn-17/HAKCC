import { jevConfig, type JevConfig } from '../config/jev';
import { askJev, JevError, type JevAnswer, type JevChoiceAnswer, type JevQuestion } from './jevClient';
import { detectDrawIntent, hasDataChartWords, mightRequestDrawing } from './drawIntent';
import { normalizeDiagram, type DiagramSpec } from './diagramRender';
import type { DrawPlan } from './drawPlanner';

/**
 * 画图的两个判断交给 Jev（2026-10-09 用户：jev 还有什么功能没有发挥，比如绘图判断，应该如何判断）。
 *
 * 以前要不要画全靠正则（drawIntent.ts）：说了「画一张……」才画。「能把这几个观点可视化一下吗」
 * 「用一张图理清它们的关系」认不出来；画完以后说「颜色淡一点」「再加上小李的观点」，也认不出是要改图，
 * 只能交给对话模型，而它画不了。现在分三层，便宜的在前：
 *
 *   1. 正则预筛（mightRequestDrawing）：句子里没有一个和图有关的字，上一轮也不是画图，就直接对话，不问 Jev。
 *   2. 要什么（routeDrawRequest）：Jev 一次请求判断这一句要的是新画一张、改刚才那张、数据图表、
 *      谈论画图还是文字回答，以及画的话画成哪种（画面、关系图、思维导图、时间线）。
 *      「要什么」的选项正序、倒序各问一遍取平均：官方说 jev-1.13 偏向排在前面的选项。
 *      正则说要画、Jev 很有把握说不是，才不画；正则没认出来、Jev 有把握说要画，就画。
 *   3. 画得对不对（checkDrawPlan）：规划好以后，Jev 核对规划的图是不是学生要的那一种、那个主题，
 *      点名要加、要改的有没有漏。不对就重新规划一次。
 *
 * Jev 没开、超时、出错，一律退回正则和原来的规划，和以前一样。Jev 只发这一句话和上一轮的一句说明，
 * 不带姓名；核对时只发要求和规划。阈值是看编的样例定的（scripts/jevDrawCheck.ts），真实数据记在
 * ai_metadata.drawing.route / check 里，攒够了再校准。
 */

export const DRAW_ACTS = ['new_drawing', 'edit_drawing', 'data_chart', 'about_drawing', 'text_answer'] as const;
export type DrawAct = typeof DRAW_ACTS[number];
export const DRAW_FORMS = ['picture', 'graph', 'tree', 'timeline'] as const;
export type DrawForm = typeof DRAW_FORMS[number];
export type ChoiceOrder = 'forward' | 'reverse';

/** 上一轮画的那张：判断「是不是要改它」、规划时照着改都要用 */
export interface PreviousDrawing {
  /** 学生当时的原话 */
  request: string;
  caption: string;
  kind: DrawPlan['kind'];
  /** 画面：当时交给生图模型的描述 */
  prompt?: string;
  /** 结构图：当时的结构 */
  diagram?: DiagramSpec;
}

const ACT_INSTRUCTIONS =
  'The state is the latest message a learner sent to an AI learning assistant in a course chat, and what the assistant did in the previous turn. '
  + 'What does the learner want the assistant to do in reply to this message? Judge what they ask for, not which words they use: '
  + '"visualize this", "show these ideas in one picture" or "map how they connect" ask for a drawing even without the word "draw"; '
  + '"how do I draw", "draw a conclusion" or "画重点" do not.';

const ACT_CRITERIA: Record<DrawAct, string> = {
  new_drawing: 'Make a new picture or diagram now: an illustration, poster, cartoon, scene, concept map, relationship map, mind map, flowchart, timeline or another visual summary',
  edit_drawing: 'Change the drawing the assistant just made: colours, style, size, wording, layout, adding or removing items, or redrawing it as another kind of diagram',
  data_chart: 'A chart or table built from numbers or statistics: a bar, pie, line or scatter chart, a statistics graph, or a table of data',
  about_drawing: 'Talk about pictures or diagrams instead of getting one: how to draw something, what a drawing or diagram means, or feedback on a picture the learner made or shared',
  text_answer: 'A text reply with no picture: an answer, explanation, summary, list, outline, comparison or advice',
};

const FORM_INSTRUCTIONS =
  'Suppose the assistant draws something for this message. Which form fits what the learner asked for? '
  + 'If the learner asks to change the previous drawing into another form, choose the new form; if they ask for other changes only, choose the form of the previous drawing.';

const FORM_CRITERIA: Record<DrawForm, string> = {
  picture: 'A picture: a scene, illustration, metaphor, poster, cartoon, character or object',
  graph: 'A relationship map: several ideas, views or factors and how they connect, support, question or lead to each other',
  tree: 'A mind map or hierarchy: one central topic with branches, categories or parts',
  timeline: 'A sequence: steps, a process, stages or events in order',
};

const actKey = (order: ChoiceOrder) => (order === 'forward' ? 'act' : 'act_reverse');

/** 一次请求问完：要什么（正序、倒序）和画成哪种。上一轮不是画图就不给「改刚才那张」这个选项 */
export function drawRouteQuestions(opts: { afterDrawing: boolean; orders?: readonly ChoiceOrder[] }): Record<string, JevQuestion> {
  const acts = DRAW_ACTS.filter(act => opts.afterDrawing || act !== 'edit_drawing');
  const questions: Record<string, JevQuestion> = {};
  for (const order of opts.orders ?? ['forward', 'reverse']) {
    const ordered = order === 'forward' ? acts : [...acts].reverse();
    questions[actKey(order)] = {
      type: 'choice',
      instructions: ACT_INSTRUCTIONS,
      criteria: Object.fromEntries(ordered.map(act => [act, ACT_CRITERIA[act]])),
    };
  }
  questions.form = {
    type: 'choice',
    instructions: FORM_INSTRUCTIONS,
    criteria: Object.fromEntries(DRAW_FORMS.map(form => [form, FORM_CRITERIA[form]])),
  };
  return questions;
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export function describeDrawing(previous: Pick<PreviousDrawing, 'kind' | 'diagram'>): string {
  if (previous.kind === 'picture') return 'a picture';
  const type = previous.diagram?.type;
  return type === 'tree' ? 'a mind map' : type === 'timeline' ? 'a timeline' : 'a relationship map';
}

/** 只发判断要用的：这一句，和上一轮做了什么（官方说 state 里无关内容越多越不准） */
export function drawRouteState(text: string, previous?: PreviousDrawing | null, lastReply?: string | null): Record<string, string> {
  const state: Record<string, string> = { learner_message: clip(text, 600) };
  if (previous) {
    state.previous_turn = `The assistant drew ${describeDrawing(previous)} for the request "${clip(previous.request, 200)}"`
      + (previous.caption ? `. Its note under the drawing: ${clip(previous.caption, 200)}` : '');
  } else if (lastReply?.trim()) {
    state.previous_turn = `The assistant replied in text: ${clip(lastReply, 300)}`;
  } else {
    state.previous_turn = 'Nothing yet: this is the first message';
  }
  return state;
}

export interface DrawJudgment {
  /** 各选项的平均概率；没给「改刚才那张」这个选项时它是 0 */
  acts: Record<DrawAct, number>;
  /** 要画（新画 + 改图）的概率 */
  drawProbability: number;
  act: DrawAct;
  forms: Record<DrawForm, number>;
  form: DrawForm;
  /** 官方的单选把握度：(最大概率 − 1/n) / (1 − 1/n) */
  formConfidence: number;
  /** 正序、倒序选的是不是同一个；只问一遍时为 null */
  orderAgreement: boolean | null;
}

/** 单选的把握度，官方公式（docs.typesafe.ai/confidence）：只看最大的那个概率 */
export function choiceConfidence(probabilities: number[]): number {
  const n = probabilities.length;
  if (n < 2) return 0;
  const top = Math.max(...probabilities);
  return Math.max(0, Math.min(1, (top - 1 / n) / (1 - 1 / n)));
}

const isChoice = (answer: JevAnswer | undefined): answer is JevChoiceAnswer => answer?.type === 'choice';

export function interpretDrawRoute(answers: Record<string, JevAnswer | undefined>): DrawJudgment | null {
  const actAnswers = (['forward', 'reverse'] as const).map(order => answers[actKey(order)]).filter(isChoice);
  const formAnswer = answers.form;
  if (actAnswers.length === 0 || !isChoice(formAnswer)) return null;

  const acts = Object.fromEntries(DRAW_ACTS.map(act => [
    act,
    actAnswers.reduce((sum, answer) => sum + (Number(answer.probabilities[act]) || 0), 0) / actAnswers.length,
  ])) as Record<DrawAct, number>;
  const act = [...DRAW_ACTS].sort((a, b) => acts[b] - acts[a])[0];
  const forms = Object.fromEntries(DRAW_FORMS.map(form => [form, Number(formAnswer.probabilities[form]) || 0])) as Record<DrawForm, number>;
  const form = [...DRAW_FORMS].sort((a, b) => forms[b] - forms[a])[0];
  return {
    acts,
    drawProbability: acts.new_drawing + acts.edit_drawing,
    act,
    forms,
    form,
    formConfidence: choiceConfidence(DRAW_FORMS.map(f => forms[f])),
    orderAgreement: actAnswers.length >= 2 ? actAnswers.every(answer => answer.choice === actAnswers[0].choice) : null,
  };
}

export interface DrawRouteThresholds {
  /** 正则没认出来：要画的概率到这个值才画（说法换了的画图要求、改图） */
  add: number;
  /** 正则认出来了：要画的概率低于这个值才不画（Jev 很有把握说不是） */
  veto: number;
  /** 句子里有柱状图、饼图这类词：要画的概率到这个值才画（画出来的数字会是编的，门槛高） */
  dataChart: number;
  /** 画成哪种：把握度到这个值才替规划定下来，否则由规划看上下文定 */
  form: number;
}

/**
 * 10-09 检验（68 句编的话，后加的 24 句定题面时没看过）：不该画的要画概率最高 0.08，该画的最低 0.54，
 * add 取 0.5 全对；veto 0.15–0.35 结果一样。种类把握度到 0.5 的 30 句全对，不到的交给规划。
 */
export const DRAW_ROUTE_THRESHOLDS: DrawRouteThresholds = { add: 0.5, veto: 0.25, dataChart: 0.85, form: 0.5 };

export type DrawDecider = 'rule' | 'jev' | 'forced';

export interface DrawDecision {
  draw: boolean;
  /** 改上一轮那张，还是新画一张 */
  mode: 'new' | 'edit';
  /** Jev 有把握时替规划定下画成哪种；null = 由规划定 */
  form: DrawForm | null;
  decidedBy: DrawDecider;
}

export function decideDrawRoute(input: {
  rule: boolean;
  dataChart: boolean;
  forced?: boolean;
  hasPrevious: boolean;
  judgment: DrawJudgment | null;
  thresholds?: DrawRouteThresholds;
}): DrawDecision {
  const t = input.thresholds ?? DRAW_ROUTE_THRESHOLDS;
  const j = input.judgment;
  const mode = input.hasPrevious && j && j.acts.edit_drawing > j.acts.new_drawing ? 'edit' : 'new';
  const form = j && j.formConfidence >= t.form ? j.form : null;
  if (input.forced) return { draw: true, mode, form, decidedBy: 'forced' };
  if (!j) return { draw: input.rule, mode: 'new', form: null, decidedBy: 'rule' };
  const draw = input.dataChart
    ? j.drawProbability >= t.dataChart && j.act !== 'data_chart'
    : input.rule ? j.drawProbability >= t.veto : j.drawProbability >= t.add;
  return { draw, mode, form, decidedBy: 'jev' };
}

export interface DrawRoute extends DrawDecision {
  /** 正则怎么说的 */
  rule: boolean;
  /** 问了 Jev 才有 */
  judgment?: DrawJudgment;
  jevModel?: string;
  latencyMs?: number;
  /** 问了但没拿到：JevError 的类型 */
  jevError?: string;
}

export interface RouteDrawOptions {
  previous?: PreviousDrawing | null;
  /** 上一轮是文字回答时的回答，帮 Jev 判断「把上面的画成图」 */
  lastReply?: string | null;
  /** 学生按了「画图」按钮：一定画，只问 Jev 是改图还是新画、画成哪种 */
  forced?: boolean;
  config?: JevConfig;
  ask?: typeof askJev;
  thresholds?: DrawRouteThresholds;
}

/** 卡在学生等待的路上：拿不到就按正则走，不重试 */
const ROUTE_TIMEOUT_MS = 1500;

export async function routeDrawRequest(text: string, opts: RouteDrawOptions = {}): Promise<DrawRoute> {
  const rule = Boolean(detectDrawIntent(text));
  const dataChart = hasDataChartWords(text);
  const hasPrevious = Boolean(opts.previous);
  const decide = (judgment: DrawJudgment | null) =>
    decideDrawRoute({ rule, dataChart, forced: opts.forced, hasPrevious, judgment, thresholds: opts.thresholds });

  const config = opts.config ?? jevConfig();
  const candidate = opts.forced || mightRequestDrawing(text, { afterDrawing: hasPrevious });
  if (!candidate || !config.drawJudge || !config.apiKey || !text.trim()) return { ...decide(null), rule };

  try {
    const result = await (opts.ask ?? askJev)(
      drawRouteState(text, opts.previous, opts.lastReply),
      drawRouteQuestions({ afterDrawing: hasPrevious }),
      { config, timeoutMs: ROUTE_TIMEOUT_MS, retry: false },
    );
    const judgment = interpretDrawRoute(result.answers);
    if (!judgment) return { ...decide(null), rule, jevError: 'bad_response' };
    return { ...decide(judgment), rule, judgment, jevModel: result.model, latencyMs: result.latencyMs };
  } catch (err) {
    return { ...decide(null), rule, jevError: err instanceof JevError ? err.kind : 'other' };
  }
}

/** 记进 ai_metadata.drawing.route：研究上看得出每次是谁定的、Jev 给了多少 */
export function drawRouteSummary(route: DrawRoute): Record<string, unknown> {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    draw: route.draw,
    mode: route.mode,
    form: route.form,
    decided_by: route.decidedBy,
    rule: route.rule,
    ...(route.judgment ? {
      p_draw: round(route.judgment.drawProbability),
      act: route.judgment.act,
      acts: Object.fromEntries(DRAW_ACTS.map(a => [a, round(route.judgment!.acts[a])])),
      form_guess: route.judgment.form,
      form_confidence: round(route.judgment.formConfidence),
      order_agreement: route.judgment.orderAgreement,
      jev_model: route.jevModel,
      latency_ms: route.latencyMs,
    } : {}),
    ...(route.jevError ? { jev_error: route.jevError } : {}),
  };
}

// ── 前端带来的东西 ─────────────────────────────────────────────

export function parseDrawForm(raw: unknown): DrawForm | null {
  return typeof raw === 'string' && (DRAW_FORMS as readonly string[]).includes(raw) ? raw as DrawForm : null;
}

/**
 * 笔记 AI、对话式笔记、文档 AI 由前端先问 /ai/draw-route 再去画，画的时候把结果原样带回来记进元数据。
 * 只留认识的字段，概率夹在 0–1，并标上 from_client：研究数据里不混进别的东西。
 */
export function sanitizeRouteSummary(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const prob = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 1000) / 1000)) : undefined);
  const out: Record<string, unknown> = {};
  if (typeof r.draw === 'boolean') out.draw = r.draw;
  if (r.mode === 'new' || r.mode === 'edit') out.mode = r.mode;
  if (r.form === null || parseDrawForm(r.form)) out.form = parseDrawForm(r.form);
  if (r.decided_by === 'rule' || r.decided_by === 'jev' || r.decided_by === 'forced') out.decided_by = r.decided_by;
  if (typeof r.rule === 'boolean') out.rule = r.rule;
  if (prob(r.p_draw) != null) out.p_draw = prob(r.p_draw);
  if (typeof r.act === 'string' && (DRAW_ACTS as readonly string[]).includes(r.act)) out.act = r.act;
  if (r.acts && typeof r.acts === 'object') {
    const acts = r.acts as Record<string, unknown>;
    out.acts = Object.fromEntries(DRAW_ACTS.map(act => [act, prob(acts[act]) ?? 0]));
  }
  if (parseDrawForm(r.form_guess)) out.form_guess = r.form_guess;
  if (prob(r.form_confidence) != null) out.form_confidence = prob(r.form_confidence);
  if (typeof r.order_agreement === 'boolean') out.order_agreement = r.order_agreement;
  if (typeof r.jev_model === 'string') out.jev_model = r.jev_model.slice(0, 40);
  if (typeof r.latency_ms === 'number' && Number.isFinite(r.latency_ms)) out.latency_ms = Math.max(0, Math.round(r.latency_ms));
  if (typeof r.jev_error === 'string') out.jev_error = r.jev_error.slice(0, 40);
  return Object.keys(out).length ? { ...out, from_client: true } : null;
}

/** 文档 AI 侧栏没有服务端的会话记录，要改的上一张由前端带来：长度、种类、结构都要核过 */
export function parsePreviousDrawing(raw: unknown): PreviousDrawing | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const request = typeof r.request === 'string' ? r.request.trim().slice(0, 600) : '';
  const caption = typeof r.caption === 'string' ? r.caption.trim().slice(0, 300) : '';
  if (r.kind === 'diagram') {
    const diagram = normalizeDiagram(r.diagram);
    return diagram ? { request, caption, kind: 'diagram', diagram } : null;
  }
  if (r.kind === 'picture') {
    const prompt = typeof r.prompt === 'string' && r.prompt.trim() ? r.prompt.trim().slice(0, 1800) : request;
    return prompt ? { request, caption, kind: 'picture', prompt } : null;
  }
  return null;
}

// ── 画得对不对 ─────────────────────────────────────────────────

const PLAN_CHECK: JevQuestion = {
  type: 'noul',
  instructions:
    "The state holds a learner's request for a drawing and the plan an assistant wrote for it. "
    + 'Does the plan give the learner what they asked for: the kind of drawing they named (if they named one), the subject they asked about, '
    + 'and every specific item they asked to include or change? Judge against the request only; the plan may add reasonable detail. '
    + 'The platform draws a flowchart of steps or a process as a sequence of steps, and a concept map as a relationship map; these count as the kinds asked for.',
  criteria: {
    true: 'Matches: the right kind and subject, and nothing the learner named is missing or ignored',
    false: 'Does not match: a different kind or subject, or something the learner named is missing or ignored',
  },
};

export function planCheckQuestions(): Record<string, JevQuestion> {
  return { matches: PLAN_CHECK };
}

/**
 * 核对时怎么称呼规划的种类。平台的「时间线」也用来画流程、步骤，只写 a timeline 的话，
 * 学生要「流程图」时 Jev 会判成种类不对（10-09 上线后实测 0.1）。
 */
const PLAN_KIND: Record<'graph' | 'tree' | 'timeline', string> = {
  graph: 'a relationship map: boxes joined by labelled arrows (also used for concept maps)',
  tree: 'a mind map: one central topic with branches',
  timeline: 'a sequence of steps in order (used for flowcharts of steps, processes and timelines)',
};

/** 规划写成 Jev 读得懂的一段：结构图列出框和连线，画面给出描述 */
export function describePlan(plan: DrawPlan): Record<string, string> {
  if (plan.kind === 'picture') {
    return { kind: 'a picture', description: clip(plan.prompt, 900), note_to_learner: clip(plan.caption, 200) };
  }
  const d = plan.diagram;
  const labels = new Map(d.nodes.map(n => [n.id, n.label]));
  const boxes = d.nodes.map(n => (n.detail ? `${n.label}（${n.detail}）` : n.label)).join('；');
  const links = d.edges
    .map(e => `${labels.get(e.from) ?? e.from} → ${labels.get(e.to) ?? e.to}${e.label ? `（${e.label}）` : ''}`)
    .join('；');
  return {
    kind: PLAN_KIND[d.type],
    ...(d.title ? { title: d.title } : {}),
    boxes: clip(boxes, 900),
    ...(links ? { links: clip(links, 700) } : {}),
    note_to_learner: clip(plan.caption, 200),
  };
}

export function planCheckState(request: string, plan: DrawPlan, previous?: PreviousDrawing | null): Record<string, unknown> {
  return {
    learner_request: clip(request, 600),
    ...(previous ? { drawing_being_changed: `${describeDrawing(previous)}: ${clip(previous.caption || previous.request, 200)}` } : {}),
    plan: describePlan(plan),
  };
}

/**
 * 合要求的概率低于这个值就重新规划一次。10-09 检验 26 份规划：合要求的最低 0.69，漏点名内容的都在 0.2 以下；
 * 没抓到的两份是「要思维导图给了关系图」（交给代码比对种类）和「标题写成了英文」（0.84）。
 */
export const PLAN_CHECK_THRESHOLD = 0.5;

export interface PlanCheck {
  /** 规划合要求的概率；出错时为 null */
  matchProbability: number | null;
  passed: boolean;
  jevModel?: string;
  latencyMs?: number;
  jevError?: string;
}

const CHECK_TIMEOUT_MS = 2000;

/** 没开 Jev 返回 null（照常画）。出错算通过：核对只是把关，不能因为它画不成 */
export async function checkDrawPlan(
  request: string,
  plan: DrawPlan,
  opts: { previous?: PreviousDrawing | null; config?: JevConfig; ask?: typeof askJev; threshold?: number } = {},
): Promise<PlanCheck | null> {
  const config = opts.config ?? jevConfig();
  if (!config.drawJudge || !config.apiKey) return null;
  try {
    const result = await (opts.ask ?? askJev)(planCheckState(request, plan, opts.previous), planCheckQuestions(), {
      config, timeoutMs: CHECK_TIMEOUT_MS, retry: false,
    });
    const answer = result.answers.matches;
    const p = answer?.type === 'noul' ? answer.noul : null;
    if (p == null) return { matchProbability: null, passed: true, jevError: 'bad_response' };
    return { matchProbability: p, passed: p >= (opts.threshold ?? PLAN_CHECK_THRESHOLD), jevModel: result.model, latencyMs: result.latencyMs };
  } catch (err) {
    return { matchProbability: null, passed: true, jevError: err instanceof JevError ? err.kind : 'other' };
  }
}
