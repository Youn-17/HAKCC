/**
 * 检验画图判断（drawJudge.ts）：Jev 认不认得出要画、改图还是新画、画成哪种，核对规划准不准。
 *
 * 只发 jevDrawCheckSamples.ts 里编的样例，不读数据库，不发任何真实学生的内容。
 *
 * 在 api/ 下运行（key 放在 api/.env 的 JEV_API_KEY）：
 *   npx ts-node src/scripts/jevDrawCheck.ts [--json 输出文件]
 *
 * 「要什么」那题在同一次请求里正序、倒序各问一遍，对比只用正序和取平均的差别。
 */
import dotenv from 'dotenv';
import { writeFileSync } from 'node:fs';
import { jevConfig } from '../config/jev';
import { askJev, jevCostUsd, JevError, type JevAnswer } from '../services/jevClient';
import { detectDrawIntent, hasDataChartWords, mightRequestDrawing } from '../services/drawIntent';
import {
  DRAW_ROUTE_THRESHOLDS,
  PLAN_CHECK_THRESHOLD,
  decideDrawRoute,
  drawRouteQuestions,
  drawRouteState,
  interpretDrawRoute,
  planCheckQuestions,
  planCheckState,
  type DrawDecision,
  type DrawJudgment,
  type DrawRouteThresholds,
} from '../services/drawJudge';
import { PLAN_SAMPLES, ROUTE_SAMPLES, type PlanSample, type RouteSample } from './jevDrawCheckSamples';

dotenv.config();

const CONCURRENCY = 4;
const ADD_GRID = [0.5, 0.6, 0.7];
const VETO_GRID = [0.15, 0.25, 0.35];
const CHECK_GRID = [0.25, 0.35, 0.45, 0.55];

interface CallStat { latencyMs: number; inputTokens: number }

interface RouteRow {
  sample: RouteSample;
  rule: boolean;
  dataChart: boolean;
  cue: boolean;
  both: DrawJudgment | null;
  forward: DrawJudgment | null;
  forwardChoice?: string;
  reverseChoice?: string;
  error?: string;
  stat?: CallStat;
}

interface PlanRow { sample: PlanSample; p: number | null; error?: string; stat?: CallStat }

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function pool<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]);
    }
  }));
  return out;
}

const describeError = (err: unknown) => (err instanceof JevError ? `${err.kind}: ${err.message}` : String(err));
const pct = (n: number, d: number) => (d === 0 ? '—' : `${n}/${d}（${Math.round((n / d) * 100)}%）`);
const fixed = (n: number | null | undefined, digits = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits));

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function judgeRoute(sample: RouteSample): Promise<RouteRow> {
  const base = {
    sample,
    rule: Boolean(detectDrawIntent(sample.text)),
    dataChart: hasDataChartWords(sample.text),
    cue: mightRequestDrawing(sample.text, { afterDrawing: Boolean(sample.previous) }),
  };
  try {
    const result = await askJev(
      drawRouteState(sample.text, sample.previous, sample.lastReply),
      drawRouteQuestions({ afterDrawing: Boolean(sample.previous) }),
    );
    const answers = result.answers as Record<string, JevAnswer>;
    const pick = (key: string) => (answers[key]?.type === 'choice' ? (answers[key] as Extract<JevAnswer, { type: 'choice' }>).choice : undefined);
    return {
      ...base,
      both: interpretDrawRoute(answers),
      forward: interpretDrawRoute({ act: answers.act, form: answers.form }),
      forwardChoice: pick('act'),
      reverseChoice: pick('act_reverse'),
      stat: { latencyMs: result.latencyMs, inputTokens: result.usage.inputTokens },
    };
  } catch (err) {
    return { ...base, both: null, forward: null, error: describeError(err) };
  }
}

async function judgePlan(sample: PlanSample): Promise<PlanRow> {
  try {
    const result = await askJev(planCheckState(sample.request, sample.plan, sample.previous), planCheckQuestions());
    const answer = (result.answers as Record<string, JevAnswer>).matches;
    return { sample, p: answer?.type === 'noul' ? answer.noul : null, stat: { latencyMs: result.latencyMs, inputTokens: result.usage.inputTokens } };
  } catch (err) {
    return { sample, p: null, error: describeError(err) };
  }
}

/** 预筛没过的不问 Jev，直接对话 */
function decisionFor(row: RouteRow, judgment: DrawJudgment | null, thresholds: DrawRouteThresholds): DrawDecision {
  if (!row.cue) return { draw: false, mode: 'new', form: null, decidedBy: 'rule' };
  return decideDrawRoute({ rule: row.rule, dataChart: row.dataChart, hasPrevious: Boolean(row.sample.previous), judgment, thresholds });
}

function grade(row: RouteRow, d: DrawDecision): { draw: boolean; mode: boolean | null; form: boolean | null } {
  const s = row.sample;
  const draw = d.draw === s.expectDraw;
  if (!s.expectDraw || !d.draw) return { draw, mode: null, form: null };
  return {
    draw,
    mode: s.expectMode ? s.expectMode.includes(d.mode) : null,
    form: d.form && s.expectForm ? s.expectForm.includes(d.form) : null,
  };
}

function summarizeRoutes(label: string, rows: RouteRow[], pick: (row: RouteRow) => DrawJudgment | null, thresholds: DrawRouteThresholds) {
  const graded = rows.map(row => ({ row, g: grade(row, decisionFor(row, pick(row), thresholds)) }));
  const draws = graded.filter(x => x.g.draw).length;
  const falseAlarms = graded.filter(x => !x.g.draw && !x.row.sample.expectDraw).length;
  const misses = graded.filter(x => !x.g.draw && x.row.sample.expectDraw).length;
  const modes = graded.filter(x => x.g.mode !== null);
  const forms = graded.filter(x => x.g.form !== null);
  const formDecided = graded.filter(x => x.row.sample.expectDraw && x.g.draw).length;
  console.log(`${label}：要不要画对 ${pct(draws, rows.length)}（误画 ${falseAlarms}，漏画 ${misses}）；`
    + `改图/新画对 ${pct(modes.filter(x => x.g.mode).length, modes.length)}；`
    + `替规划定了种类 ${forms.length}/${formDecided}，其中对 ${pct(forms.filter(x => x.g.form).length, forms.length)}`
    + `（阈值 加 ${thresholds.add} / 否 ${thresholds.veto} / 种类 ${thresholds.form}）`);
}

function reportRoutes(rows: RouteRow[]) {
  const t = DRAW_ROUTE_THRESHOLDS;
  console.log(`\n── 要不要画（正序倒序取平均；阈值 加 ${t.add} / 否 ${t.veto} / 数据图 ${t.dataChart} / 种类 ${t.form}）──`);
  console.log('编号  期望      正则 预筛  要画概率  正/倒→结论        改/新   种类(把握)       判定      对否  测的是');
  for (const row of rows) {
    const s = row.sample;
    const expect = s.expectDraw ? `画${s.expectMode?.join('/') ?? ''}${s.expectForm ? `:${s.expectForm.join('/')}` : ''}` : '不画';
    if (!row.both) {
      console.log(`${s.id}  ${expect.padEnd(9)} 出错：${row.error}`);
      continue;
    }
    const j = row.both;
    const d = decisionFor(row, j, t);
    const g = grade(row, d);
    const ok = g.draw && g.mode !== false && g.form !== false ? '✓' : '✗';
    const decision = d.draw ? `画${d.mode}${d.form ? `:${d.form}` : ''}` : '不画';
    console.log(
      `${s.id}  ${expect.padEnd(9)} ${row.rule ? '是' : '否'}   ${row.cue ? '过' : '拦'}   ${fixed(j.drawProbability)}      `
      + `${(row.forwardChoice ?? '—').slice(0, 5)}/${(row.reverseChoice ?? '—').slice(0, 5)}→${j.act.slice(0, 8)}`.padEnd(18)
      + `  ${fixed(j.acts.edit_drawing)}/${fixed(j.acts.new_drawing)}  ${j.form}(${fixed(j.formConfidence)})`.padEnd(30)
      + `  ${decision.padEnd(16)}  ${ok}    ${s.about}`,
    );
  }

  const ok = rows.filter(r => r.both);
  console.log('');
  const ruleOnly = ok.filter(r => (r.cue && r.rule) === r.sample.expectDraw).length;
  const ruleEdits = ok.filter(r => r.sample.expectDraw && r.sample.expectMode?.includes('edit') && !r.sample.expectMode.includes('new'));
  console.log(`只用正则（以前的做法）：要不要画对 ${pct(ruleOnly, ok.length)}；改图的 ${ruleEdits.length} 条里认出 ${ruleEdits.filter(r => r.rule).length} 条（认出了也只会当新画）`);
  summarizeRoutes('只用正序', ok, r => r.forward, t);
  summarizeRoutes('正序倒序取平均', ok, r => r.both, t);
  summarizeRoutes('其中先写的', ok.filter(r => !r.sample.heldOut), r => r.both, t);
  summarizeRoutes('其中后加的', ok.filter(r => r.sample.heldOut), r => r.both, t);
  const heldOut = ok.filter(r => r.sample.heldOut);
  console.log(`后加的只用正则：要不要画对 ${pct(heldOut.filter(r => (r.cue && r.rule) === r.sample.expectDraw).length, heldOut.length)}`);
  for (const add of ADD_GRID) {
    const cells = VETO_GRID.map(veto => {
      const thresholds = { ...t, add, veto };
      const wrong = ok.filter(r => decisionFor(r, r.both, thresholds).draw !== r.sample.expectDraw);
      return `否 ${veto}：错 ${wrong.length}（${wrong.map(r => r.sample.id).join(',') || '无'}）`;
    });
    console.log(`  加 ${add} → ${cells.join('；')}`);
  }
  console.log(`正序倒序选同一个：${pct(ok.filter(r => r.both!.orderAgreement).length, ok.length)}`);
  if (rows.length > ok.length) console.log(`出错 ${rows.length - ok.length} 条`);
}

function reportPlans(rows: PlanRow[]) {
  console.log(`\n── 核对规划（低于 ${PLAN_CHECK_THRESHOLD} 算不合要求）──`);
  console.log('编号  期望    合要求概率  判定    对否  测的是');
  for (const row of rows) {
    const s = row.sample;
    if (row.p == null) {
      console.log(`${s.id}  ${s.expectMatch ? '合' : '不合'}  出错：${row.error ?? '没有概率'}`);
      continue;
    }
    const passed = row.p >= PLAN_CHECK_THRESHOLD;
    console.log(`${s.id}  ${(s.expectMatch ? '合' : '不合').padEnd(4)}  ${fixed(row.p)}        ${(passed ? '合' : '不合').padEnd(4)}  ${passed === s.expectMatch ? '✓' : '✗'}    ${s.about}`);
  }
  const ok = rows.filter(r => r.p != null);
  for (const threshold of CHECK_GRID) {
    const wrongRejects = ok.filter(r => r.sample.expectMatch && r.p! < threshold).map(r => r.sample.id);
    const missed = ok.filter(r => !r.sample.expectMatch && r.p! >= threshold).map(r => r.sample.id);
    console.log(`  阈值 ${threshold}：错杀 ${wrongRejects.length}（${wrongRejects.join(',') || '无'}），放过 ${missed.length}（${missed.join(',') || '无'}）`);
  }
}

async function main() {
  const config = jevConfig();
  if (!config.apiKey) {
    console.log('还没有 key：在 api/.env 里加一行 JEV_API_KEY=你的key，保存后再运行。');
    process.exitCode = 1;
    return;
  }
  console.log(`画图判断检验：模型 ${config.model}，${ROUTE_SAMPLES.length} 句话、${PLAN_SAMPLES.length} 份规划`);

  const routeRows = await pool(ROUTE_SAMPLES, CONCURRENCY, judgeRoute);
  reportRoutes(routeRows);
  const planRows = await pool(PLAN_SAMPLES, CONCURRENCY, judgePlan);
  reportPlans(planRows);

  const stats = [...routeRows, ...planRows].map(r => r.stat).filter((s): s is CallStat => !!s);
  const tokens = stats.reduce((sum, s) => sum + s.inputTokens, 0);
  const latencies = stats.map(s => s.latencyMs);
  const routeTokens = routeRows.map(r => r.stat?.inputTokens ?? 0).filter(Boolean);
  const avgRoute = routeTokens.reduce((a, b) => a + b, 0) / Math.max(1, routeTokens.length);
  console.log(`\n── 用量 ──\n请求 ${stats.length} 次，用时中位数 ${percentile(latencies, 50)} ms，95% 在 ${percentile(latencies, 95)} ms 以内`);
  console.log(`输入共 ${tokens} token，约 ${jevCostUsd(tokens).toFixed(5)} 美元；判断一句平均 ${Math.round(avgRoute)} token，一千句约 ${jevCostUsd(avgRoute * 1000).toFixed(3)} 美元`);

  const jsonPath = argValue('--json');
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ model: config.model, routeRows, planRows }, null, 2));
    console.log(`明细已写入 ${jsonPath}`);
  }
}

if (/jevDrawCheck\.[jt]s$/.test(process.argv[1] ?? '')) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
