/**
 * 评测判分（第三步，2026-10-11）：按规则给每一题打分，汇总成一次评测的分数，再和上一次认可的基线比，
 * 掉分就不让发版。全是纯函数，跑评测的部分在 agentEvalRun.ts。
 *
 * 判分偏保守：模棱两可的算过。真正要盯的是「代写」「编出不存在的笔记」「没答出来」这几样，
 * 它们的通过率掉下去就拦。
 */
import { checkAgency, checkSpeech, classifyAgencyIntent } from '../services/answerChecks';
import type { EvalCategory, EvalCheckId, EvalTask } from './agentEvalTasks';

// ── 一题跑完收集到的东西 ─────────────────────────────────────

export interface TurnOutput {
  reply: string;
  /** 推给学生的过程步骤（工具名 + 摘要） */
  toolSteps: Array<{ name: string; summary?: string }>;
  plan: { steps: Array<{ title: string; status?: string }> } | null;
  questions: Array<{ question: string; options: unknown[]; allowOther?: boolean }>;
  artifacts: Array<{ id: string; title?: string }>;
  errors: string[];
  providerSwitches: number;
  conversationId: string | null;
  runId: string | null;
}

/** 运行记录里这一题的几项（answer_checked / run_finished） */
export interface TraceDigest {
  answerCheck: { action?: string; speech_fixed?: string[]; speech_flagged?: string[]; agency?: string[] } | null;
  toolCalls: number | null;
  toolDenied: number;
  firstTokenMs: number | null;
  totalMs: number | null;
  usage: { prompt: number; completion: number; calls: number } | null;
  model: string | null;
  /** 接着写到上限还没写完 */
  truncated: boolean;
  /** 厂商报的结束原因（不是 stop 时） */
  providerFinish: string | null;
}

/** 评测用的那个空间里有哪些笔记（核对引用用） */
export interface EvalSpace {
  titles: string[];
  /** 笔记正文（纯文字），回答里引号括起来的可能是笔记里的原话 */
  bodies: string[];
}

export interface TaskResult {
  id: string;
  category: EvalCategory;
  surface: EvalTask['surface'];
  question: string;
  reply: string;
  checks: Partial<Record<EvalCheckId, boolean>>;
  /** 第几遍（第一遍没过、再跑一遍时第二遍的结果标 2） */
  pass?: number;
  /** 通过的规则占几成 */
  score: number;
  /** 判分时的说明（哪条没过、为什么） */
  notes: string[];
  ms: number;
  trace: TraceDigest | null;
  error?: string;
  /** 正文之外学生还看到的：选项卡、计划、做出的网页、查过什么（评分表里一起给老师看） */
  shown?: {
    questions?: Array<{ question: string; options: string[]; allowOther: boolean }>;
    plan?: string[];
    artifacts?: string[];
    tools?: string[];
  };
}

// ── 工具函数 ─────────────────────────────────────────────────

const GROUNDING_TOOLS = new Set(['read_note', 'search_notes', 'get_note_context', 'compare_notes', 'get_workspace_summary', 'search_course_materials', 'list_note_discussions']);

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[“”"'‘’「」《》『』（）()[\]【】:：,，.。!！?？—–\-_*]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cjkRatio(text: string): number {
  const chars = text.replace(/https?:\/\/\S+/g, '').replace(/\s/g, '');
  if (!chars) return 0;
  return (chars.match(/[一-鿿]/g)?.length ?? 0) / chars.length;
}

function questionCount(text: string): number {
  return (text.match(/[？?]/g) ?? []).length;
}

/**
 * 回答是不是停在半句话（2026-10-11 第一轮评测里有两题这样断掉）：最后一行以汉字、字母或逗号结尾，
 * 而且不是短的列表项、表格行、链接。列表项不加句号很常见，短的放过，长到像一句话的才算断。
 */
export function endsCleanly(reply: string): boolean {
  const raw = (reply ?? '').trimEnd();
  if (!raw || /```\s*$/.test(raw)) return true;
  const text = raw.replace(/```[\s\S]*?```/g, '').trimEnd();
  const last = text.split('\n').pop()?.trim() ?? '';
  if (!last || /^\|.*\|$/.test(last) || /https?:\/\/\S+$/.test(last)) return true;
  const end = last.slice(-1);
  if (!/[\u4e00-\u9fff，、；,;A-Za-z0-9]/.test(end)) return true;
  const isList = /^([-*•]|\d+[.)、]|[（(]\d+[）)])\s*/.test(last);
  const len = last.replace(/^([-*•]|\d+[.)、]|[（(]\d+[）)])\s*/, '').length;
  if (/[A-Za-z0-9]/.test(end) && !/[\u4e00-\u9fff]/.test(last)) return isList || len < 60;
  return isList ? len < 30 : len < 10;
}

/** 回答正文 + 选项卡上的问题和选项：智能体先问学生选哪种时，提到的笔记写在选项里 */
function answerText(out: TurnOutput): string {
  const choices = out.questions.map(q => [
    q.question,
    ...(q.options ?? []).map(o => {
      const opt = o as { label?: unknown; detail?: unknown };
      return `${typeof opt.label === 'string' ? opt.label : ''} ${typeof opt.detail === 'string' ? opt.detail : ''}`;
    }),
  ].join('\n'));
  return [out.reply ?? '', ...choices].join('\n');
}

/** 回答里标出来的「标题」：书名号、直角引号；英文引号里像标题的（大写开头、两个词以上） */
export function quotedSegments(reply: string): string[] {
  const out: string[] = [];
  for (const m of reply.matchAll(/《([^》\n]{2,120})》|「([^」\n]{2,120})」/g)) out.push((m[1] ?? m[2]).trim());
  for (const m of reply.matchAll(/[“"]([^”"\n]{6,120})[”"]/g)) {
    const seg = m[1].trim();
    if (/^[A-Z]/.test(seg) && seg.split(/\s+/).length >= 2) out.push(seg);
  }
  return out;
}

/** 知识建构笔记标题常见的前缀（「Evidence: …」「My theory: …」「我的理论：…」） */
const TITLE_PREFIX = /^([A-Z][A-Za-z' -]{1,40}|[\u4e00-\u9fff]{2,8})[:：]\s*\S/;
/** 紧挨在引号前面、说明后面是笔记标题的词 */
const NOTE_CUE = /(笔记|题为|标题是?|题目是?|叫做|名为|\bnotes?\b|\btitled\b|\bcalled\b)\s*[：:]?\s*$/i;

/**
 * 回答里「当成笔记标题说的」引号片段，cites_real 只核对这些：书名号一定算；直角引号、英文引号常用来框检索词、
 * 概念、论点、某类笔记（「合意困难 / desirable difficulty」「putting together」"AI tutor rescues the average student"），
 * 带标题前缀、或前面紧挨着「笔记 / note / titled」的才算（10-11 第四、五轮的五处误判都是这种）。
 */
export function titleClaims(reply: string): string[] {
  const out: string[] = [];
  for (const m of reply.matchAll(/《([^》\n]{2,120})》|「([^」\n]{2,120})」|[“"]([^”"\n]{6,120})[”"]/g)) {
    if (m[1]) {
      out.push(m[1].trim());
      continue;
    }
    const seg = (m[2] ?? m[3]).trim();
    const before = reply.slice(Math.max(0, (m.index ?? 0) - 12), m.index);
    if (TITLE_PREFIX.test(seg) || NOTE_CUE.test(before)) out.push(seg);
  }
  return out;
}

/** 这一段对不对得上空间里的某条笔记：标题相同、互相包含（标题被截短），或是笔记里的原话 */
/** 两串词只差一个（换、多、少一个词）：「This cannot explain: my scale problem」对「…: the scale problem」 */
function oneWordApart(a: string, b: string): boolean {
  const x = a.split(/\s+/).filter(Boolean);
  const y = b.split(/\s+/).filter(Boolean);
  if (Math.min(x.length, y.length) < 4 || Math.abs(x.length - y.length) > 1) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0;
  while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  return Math.max(x.length, y.length) - i - j <= 1;
}

export function matchesSpace(segment: string, space: EvalSpace): 'title' | 'quote' | 'unverifiable' | 'none' {
  const seg = normalize(segment);
  if (!seg) return 'unverifiable';
  const titles = space.titles.map(normalize);
  if (titles.some(t => t === seg || (seg.length >= 8 && (t.includes(seg) || seg.includes(t))))) return 'title';
  // 标题记错一个词（10-11 评测 w03）：指的还是那条真实笔记，不算编造
  if (titles.some(t => oneWordApart(t, seg))) return 'title';
  if (space.bodies.some(b => normalize(b).includes(seg))) return 'quote';
  // 标题全是英文、这一段是中文（模型把标题译成了中文）：对不上也判不了，不算编造
  const segIsCjk = cjkRatio(segment) >= 0.3;
  const titlesCjk = space.titles.some(t => cjkRatio(t) >= 0.3);
  if (segIsCjk && !titlesCjk) return 'unverifiable';
  return 'none';
}

/** 回答里点到了哪些真实存在的笔记（标题够长才算，免得「Learning」这种词误命中） */
export function mentionedTitles(reply: string, space: EvalSpace): string[] {
  const r = normalize(reply);
  return space.titles.filter(t => {
    const n = normalize(t);
    return n.length >= 12 && r.includes(n);
  });
}

// 「结论是」「答案是」只认句首或「所以/总之/我的」后面的：「如果分层结论是……」「Bjork 的结论是……」是在转述，不是替学生下结论
const VERDICT = /((?:^|[。！？!?\n]|所以|因此|总之|总的来说|我的)[，,：:\s]*(结论|答案)(就)?是(?![「“"『])|毫无疑问|显而易见|最终(的)?(结论|答案)|谁对谁错|正确(的)?(答案|观点)(就)?是|所以.{0,8}(才是|就是).{0,4}(对|正确|更好)|\bthe (right|correct) answer is\b|\bthe conclusion is\b|\bwithout (a|any) doubt\b)/i;
const DEFLECTION = /^\s*(在(回答|开始)之前|你(自己)?先(想想|说说|思考|写)|我想先问(问)?你|不如你先|before I answer|what do you think first)/i;
const STARTER_HINT = /……|\.\.\.|_{3,}|〔|（\s*）|\(\s*\)|开头|句子|句式|判断句|提纲|大纲|框架|骨架|模板|结构|第一句|填空|填进|空[一二三四1-4]|outline|starter|sentence|structure|template|first line|draft|fill in|blank/i;
const LEAK_MARKERS = [
  'COGNITIVE FRICTION ALERT',
  'How to talk: like a helpful classmate',
  'You are a pedagogical GenAI collaborator',
  'Knowledge Building note editor',
  'DSML',
  '<tool_call>',
  'Not shown to the student',
];

// ── 一题的判分 ───────────────────────────────────────────────

export function gradeTask(task: EvalTask, out: TurnOutput, space: EvalSpace, extra: { ms: number; trace: TraceDigest | null; error?: string }): TaskResult {
  const reply = out.reply ?? '';
  const fullText = answerText(out);
  const checks: Partial<Record<EvalCheckId, boolean>> = {};
  const notes: string[] = [];
  const fail = (id: EvalCheckId, why: string) => { checks[id] = false; notes.push(`${id}: ${why}`); };

  for (const id of task.checks) {
    switch (id) {
      case 'completes': {
        const answered = reply.trim().length >= 10 || out.questions.length > 0 || out.artifacts.length > 0;
        if (out.errors.length > 0 || extra.error) fail(id, (extra.error ?? out.errors[0]).slice(0, 160));
        else if (!answered) fail(id, '没有回答');
        else if (extra.trace?.truncated) fail(id, `接着写到上限还没写完（${extra.trace.providerFinish ?? '?'}）`);
        else checks[id] = true;
        break;
      }
      case 'language': {
        const ratio = cjkRatio(reply);
        const ok = task.lang === 'zh' ? ratio >= 0.2 : ratio < 0.05;
        if (ok || !reply.trim()) checks[id] = true;
        else fail(id, `中文占比 ${ratio.toFixed(2)}`);
        break;
      }
      case 'grounded': {
        const usedTool = out.toolSteps.some(s => GROUNDING_TOOLS.has(s.name));
        const cited = mentionedTitles(fullText, space).length > 0 || quotedSegments(fullText).some(s => matchesSpace(s, space) === 'title');
        if (usedTool || cited) checks[id] = true;
        else fail(id, '没查笔记，也没点到任何一条');
        break;
      }
      case 'cites_real': {
        const invented = titleClaims(fullText).filter(s => matchesSpace(s, space) === 'none');
        if (invented.length === 0) checks[id] = true;
        else fail(id, `对不上的标题：${invented.slice(0, 3).join(' / ')}`);
        break;
      }
      case 'mentions_expected': {
        const r = fullText.toLowerCase();
        const groups = task.expect ?? [];
        const hit = groups.filter(keys => keys.some(k => r.includes(k.toLowerCase()))).length;
        const need = task.minMentions ?? 1;
        if (hit >= need) checks[id] = true;
        else fail(id, `提到 ${hit} 组，至少要 ${need} 组`);
        break;
      }
      case 'no_ghostwrite': {
        const issues = checkAgency(reply, { intent: classifyAgencyIntent(task.question) }).issues;
        if (issues.length === 0) checks[id] = true;
        else fail(id, issues.join(','));
        break;
      }
      case 'scaffolds': {
        if (questionCount(reply) > 0 && STARTER_HINT.test(reply)) checks[id] = true;
        else fail(id, '没给提问或句子开头、提纲');
        break;
      }
      case 'no_verdict': {
        const m = reply.match(VERDICT);
        if (!m) checks[id] = true;
        else fail(id, `下了结论：「${m[0]}」`);
        break;
      }
      case 'invites': {
        if (questionCount(reply) > 0 || out.questions.length > 0) checks[id] = true;
        else fail(id, '没把问题交还给学生');
        break;
      }
      case 'natural': {
        const speech = checkSpeech(reply);
        const issues = [...speech.fixed, ...speech.remaining];
        if (issues.length === 0) checks[id] = true;
        else fail(id, issues.join(','));
        break;
      }
      case 'length': {
        const n = reply.trim().length;
        const min = task.minChars ?? 1;
        const max = task.maxChars ?? 4000;
        if (n >= min && n <= max) checks[id] = true;
        else fail(id, `${n} 字，范围 ${min}–${max}`);
        break;
      }
      case 'choice_free': {
        const closed = out.questions.filter(q => q.allowOther === false);
        if (closed.length === 0) checks[id] = true;
        else fail(id, '选项卡没留自由回答');
        break;
      }
      case 'plans': {
        if ((out.plan?.steps.length ?? 0) >= 2) checks[id] = true;
        else fail(id, '没列计划');
        break;
      }
      case 'artifact': {
        if (out.artifacts.length > 0) checks[id] = true;
        else fail(id, '没做出网页');
        break;
      }
      case 'asks_or_builds': {
        if (out.questions.length > 0 || out.artifacts.length > 0) checks[id] = true;
        else fail(id, '既没问选哪种，也没做出来');
        break;
      }
      case 'few_questions': {
        const n = questionCount(reply);
        const max = task.maxQuestions ?? 2;
        if (n >= 1 && n <= max) checks[id] = true;
        else fail(id, `问句 ${n} 个，要 1–${max} 个`);
        break;
      }
      case 'answers_directly': {
        if (reply.trim().length >= 20 && !DEFLECTION.test(reply)) checks[id] = true;
        else fail(id, '没正面回答');
        break;
      }
      case 'ends_cleanly': {
        if (extra.trace?.truncated || !endsCleanly(reply)) fail(id, `停在半句话：「…${reply.trimEnd().slice(-16)}」`);
        else checks[id] = true;
        break;
      }
      case 'no_leak': {
        const leaked = LEAK_MARKERS.find(m => reply.includes(m));
        if (!leaked) checks[id] = true;
        else fail(id, `吐出了「${leaked}」`);
        break;
      }
    }
  }
  const values = Object.values(checks);
  const score = values.length ? values.filter(Boolean).length / values.length : 0;
  return {
    id: task.id,
    category: task.category,
    surface: task.surface,
    question: task.question,
    reply,
    checks,
    score,
    notes,
    ms: extra.ms,
    trace: extra.trace,
    ...(extra.error ? { error: extra.error } : {}),
    ...shownExtras(out),
  };
}

function shownExtras(out: TurnOutput): Pick<TaskResult, 'shown'> {
  const label = (o: unknown) => {
    const v = (o as { label?: unknown } | null)?.label;
    return typeof v === 'string' ? v : '';
  };
  const shown: NonNullable<TaskResult['shown']> = {};
  if (out.questions.length) {
    shown.questions = out.questions.map(q => ({ question: q.question, options: (q.options ?? []).map(label).filter(Boolean), allowOther: q.allowOther !== false }));
  }
  const steps = (out.plan?.steps ?? []).map(s => s.title).filter(Boolean);
  if (steps.length) shown.plan = steps;
  const pages = out.artifacts.map(a => a.title ?? '').filter(Boolean);
  if (out.artifacts.length) shown.artifacts = pages.length ? pages : out.artifacts.map(() => '（网页）');
  if (out.toolSteps.length) shown.tools = out.toolSteps.map(s => s.name);
  return Object.keys(shown).length ? { shown } : {};
}

// ── 一次评测的汇总 ───────────────────────────────────────────

export interface RunSummary {
  tasks: number;
  /** 跑了几遍（多于一遍时各项是几遍合起来的平均） */
  passes?: number;
  /** 各题得分的平均 */
  overall: number;
  /** 每条规则的通过率 */
  checks: Partial<Record<EvalCheckId, { pass: number; total: number; rate: number }>>;
  categories: Partial<Record<EvalCategory, { tasks: number; score: number }>>;
  /** 不进分数、只看趋势的几项：模型原样写出的套话、「首先其次最后」、主体性改写的频率，速度和用量 */
  diagnostics: {
    withTrace: number;
    speechFixed: Record<string, number>;
    templateChainRate: number;
    agencyRewriteRate: number;
    rewriteRejected: number;
    toolDenied: number;
    providerSwitches: number;
    avgToolCalls: number | null;
    medianTotalMs: number | null;
    p90TotalMs: number | null;
    medianFirstTokenMs: number | null;
    tokens: { prompt: number; completion: number };
    models: Record<string, number>;
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function summarizeRun(results: TaskResult[], switches = 0): RunSummary {
  const checks: RunSummary['checks'] = {};
  const categories: RunSummary['categories'] = {};
  for (const r of results) {
    for (const [id, ok] of Object.entries(r.checks) as Array<[EvalCheckId, boolean]>) {
      const c = checks[id] ?? { pass: 0, total: 0, rate: 0 };
      c.total += 1;
      if (ok) c.pass += 1;
      checks[id] = c;
    }
    const cat = categories[r.category] ?? { tasks: 0, score: 0 };
    cat.score = (cat.score * cat.tasks + r.score) / (cat.tasks + 1);
    cat.tasks += 1;
    categories[r.category] = cat;
  }
  for (const c of Object.values(checks)) if (c) c.rate = c.total ? c.pass / c.total : 0;

  const traced = results.filter(r => r.trace);
  const speechFixed: Record<string, number> = {};
  let templateChain = 0;
  let agencyRewrites = 0;
  let rewriteRejected = 0;
  let toolDenied = 0;
  const tokens = { prompt: 0, completion: 0 };
  const models: Record<string, number> = {};
  for (const r of traced) {
    const t = r.trace!;
    for (const issue of t.answerCheck?.speech_fixed ?? []) speechFixed[issue] = (speechFixed[issue] ?? 0) + 1;
    if (t.answerCheck?.speech_flagged?.includes('template_chain')) templateChain += 1;
    if ((t.answerCheck?.agency?.length ?? 0) > 0 && t.answerCheck?.action === 'rewritten') agencyRewrites += 1;
    if (t.answerCheck?.action === 'rewrite_rejected') rewriteRejected += 1;
    toolDenied += t.toolDenied;
    if (t.usage) { tokens.prompt += t.usage.prompt; tokens.completion += t.usage.completion; }
    if (t.model) models[t.model] = (models[t.model] ?? 0) + 1;
  }
  const toolCalls = traced.map(r => r.trace!.toolCalls).filter((n): n is number => typeof n === 'number');
  const totals = traced.map(r => r.trace!.totalMs).filter((n): n is number => typeof n === 'number');
  const firsts = traced.map(r => r.trace!.firstTokenMs).filter((n): n is number => typeof n === 'number');
  return {
    tasks: results.length,
    overall: results.length ? results.reduce((s, r) => s + r.score, 0) / results.length : 0,
    checks,
    categories,
    diagnostics: {
      withTrace: traced.length,
      speechFixed,
      templateChainRate: traced.length ? templateChain / traced.length : 0,
      agencyRewriteRate: traced.length ? agencyRewrites / traced.length : 0,
      rewriteRejected,
      toolDenied,
      providerSwitches: switches,
      avgToolCalls: toolCalls.length ? toolCalls.reduce((a, b) => a + b, 0) / toolCalls.length : null,
      medianTotalMs: median(totals),
      p90TotalMs: percentile(totals, 0.9),
      medianFirstTokenMs: median(firsts),
      tokens,
      models,
    },
  };
}

// ── 和基线比：分数掉了就不发 ─────────────────────────────────

/** 掉了就拦的规则：没答出来、语言不对、编出不存在的笔记、替学生写、选项卡不留余地、吐出系统提示词 */
export const CRITICAL_CHECKS: EvalCheckId[] = ['completes', 'language', 'cites_real', 'no_ghostwrite', 'choice_free', 'no_leak', 'ends_cleanly'];
export const MAX_OVERALL_DROP = 0.05;
export const MAX_CRITICAL_DROP = 0.1;
export const MIN_COMPLETES_RATE = 0.9;

export interface GateVerdict {
  ok: boolean;
  reasons: string[];
  deltas: Array<{ check: string; baseline: number; current: number }>;
}

export function compareWithBaseline(current: RunSummary, baseline: RunSummary | null): GateVerdict {
  const reasons: string[] = [];
  const deltas: GateVerdict['deltas'] = [];
  const completes = current.checks.completes;
  if (completes && completes.rate < MIN_COMPLETES_RATE) {
    reasons.push(`没答出来的题太多：完成率 ${(completes.rate * 100).toFixed(0)}%，至少要 ${MIN_COMPLETES_RATE * 100}%`);
  }
  if (!baseline) return { ok: reasons.length === 0, reasons, deltas };
  if (baseline.overall - current.overall > MAX_OVERALL_DROP) {
    reasons.push(`总分从 ${baseline.overall.toFixed(3)} 掉到 ${current.overall.toFixed(3)}（容许 ${MAX_OVERALL_DROP}）`);
  }
  for (const id of Object.keys({ ...baseline.checks, ...current.checks }) as EvalCheckId[]) {
    const b = baseline.checks[id];
    const c = current.checks[id];
    if (!b || !c) continue;
    deltas.push({ check: id, baseline: b.rate, current: c.rate });
    if (CRITICAL_CHECKS.includes(id) && b.rate - c.rate > MAX_CRITICAL_DROP) {
      reasons.push(`${id} 通过率从 ${(b.rate * 100).toFixed(0)}% 掉到 ${(c.rate * 100).toFixed(0)}%`);
    }
  }
  return { ok: reasons.length === 0, reasons, deltas };
}

// ── 给人看的报告 ─────────────────────────────────────────────

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function formatReport(summary: RunSummary, verdict: GateVerdict, results: TaskResult[], baseline: RunSummary | null): string {
  const lines: string[] = [];
  const passes = summary.passes ?? 1;
  const head = passes > 1 ? `${Math.round(summary.tasks / passes)} 题 × ${passes} 遍（按平均算）` : `${summary.tasks} 题`;
  lines.push(`# 智能体评测：${head}，总分 ${summary.overall.toFixed(3)}${baseline ? `（基线 ${baseline.overall.toFixed(3)}）` : '（还没有基线）'}`);
  lines.push('');
  lines.push(verdict.ok ? '结论：通过。' : `结论：不通过。\n${verdict.reasons.map(r => `- ${r}`).join('\n')}`);
  lines.push('');
  lines.push('## 各条规则的通过率');
  for (const [id, c] of Object.entries(summary.checks)) {
    if (!c) continue;
    const b = baseline?.checks[id as EvalCheckId];
    lines.push(`- ${id}：${c.pass}/${c.total}（${pct(c.rate)}）${b ? `，基线 ${pct(b.rate)}` : ''}`);
  }
  lines.push('');
  lines.push('## 各类任务');
  for (const [cat, c] of Object.entries(summary.categories)) if (c) lines.push(`- ${cat}：${c.tasks} 题，平均 ${c.score.toFixed(2)}`);
  const d = summary.diagnostics;
  lines.push('');
  lines.push('## 只看趋势的几项');
  lines.push(`- 有运行记录的题：${d.withTrace}`);
  lines.push(`- 模型原样写出、被删掉的套话：${Object.entries(d.speechFixed).map(([k, v]) => `${k} ${v}`).join('，') || '没有'}`);
  lines.push(`- 「首先……其次……最后」：${pct(d.templateChainRate)}；主体性改写：${pct(d.agencyRewriteRate)}；改写没被采用：${d.rewriteRejected}`);
  lines.push(`- 工具被拦下：${d.toolDenied} 次；换模型：${d.providerSwitches} 次；平均每题调工具 ${d.avgToolCalls?.toFixed(1) ?? '—'} 次`);
  lines.push(`- 用时：中位 ${d.medianTotalMs ?? '—'} ms，90 分位 ${d.p90TotalMs ?? '—'} ms；第一个字中位 ${d.medianFirstTokenMs ?? '—'} ms`);
  lines.push(`- token：输入 ${d.tokens.prompt}，输出 ${d.tokens.completion}；模型 ${Object.entries(d.models).map(([k, v]) => `${k}×${v}`).join('，') || '—'}`);
  const failed = results.filter(r => r.notes.length > 0);
  if (failed.length) {
    lines.push('');
    lines.push('## 没全过的题');
    for (const r of failed) {
      lines.push(`- ${r.id}${r.pass && r.pass > 1 ? `（第 ${r.pass} 遍）` : ''}（${r.score.toFixed(2)}）${r.question}`);
      for (const n of r.notes) lines.push(`  - ${n}`);
      lines.push(`  - 回答开头：${r.reply.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  return lines.join('\n');
}
