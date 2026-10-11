/**
 * 智能体的 harness（2026-10-11，hello-agents 第 6、7 章的生命周期回调；Claude Code 的 PreToolUse / Stop；
 * DeepSeek Harness 工具执行前后两道关卡、日志只追加）。笔记 AI 助手和知识空间智能体共用这一份：
 * 跑循环、推事件、换模型、写运行记录在这里，装上下文、选模型、存消息还在各自的路由里。
 *
 * 五个钩子：
 * - 学生提交问题时（onPromptSubmit）：enforceTurnQuota 查每日配额；analyzePrompt 看这一问是不是让 AI 代写、
 *   之前是不是接连代写，据此给提示词加说话规则和主体性引导。
 * - 调工具前（preToolUse）：createToolGuard 查这一轮能不能用这个工具、有没有超次数，超了就拦下，
 *   告诉模型够了（以前一轮读二十几条笔记，慢得要命）。
 * - 调工具后（postToolUse）：记用时、成没成；推给学生的统计摘要照旧（summarizeToolResult）。
 * - 回答结束时（onStop）：说话自然、主体性两道检查（answerChecks），能改的在学生看到之前改掉；
 *   再核对课程资料的引用（checkKbAnswer），把计划清单收尾。
 * - 出错时（onError）：一个字还没给学生之前出错，能换就换下一家（课程设置里这个功能允许换），
 *   不许换的（笔记 AI 助手，模型是学生自己选的）遇到超时、限流这类临时错误原样再试一次。
 *
 * 只负责记录的（postToolUse、运行记录）不改结果；能拦下动作的只有工具上限和配额两条规则。
 */
import { runAgentLoopStream, streamProviderFinalAnswer, type AgentLoopMessage, type AgentLoopParams, type AgentTokenUsage } from './agentLoop';
import { summarizeToolResult } from './toolResultSummary';
import { KB_STEP_NAME, checkKbAnswer, type KbRetrieval, type KbToolStep } from './kbSources';
import { settlePlan, type AgentTurnState } from './agentMaker';
import { AgentTrace, HARNESS_PROMPT_VERSION, promptHash, summarizeArgs } from './agentTrace';
import { assertDailyAiQuota } from './aiQuota';
import {
  FRICTION_MARKER,
  GHOSTWRITE_ESCALATION,
  GHOSTWRITE_GUIDANCE,
  NATURAL_SPEECH_RULES,
  POLISH_GUIDANCE,
  REWRITE_SPEECH,
  acceptRevision,
  buildRevisionPrompt,
  checkAgency,
  checkSpeech,
  classifyAgencyIntent,
  countGhostwriteRequests,
  unwrapRevision,
  type AgencyIntent,
  type AgencyIssue,
  type SpeechIssue,
} from './answerChecks';

export type HarnessSurface = 'note' | 'workspace';
export type HarnessRole = 'student' | 'teacher' | 'admin';

export interface TurnCandidate {
  providerId: string;
  model: string;
  apiKey: string;
  endpointUrl: string | null;
}

// ── 学生提交问题时（onPromptSubmit）──────────────────────────

/** 学生才数配额；在存下这句提问之前调用，超了直接回 429，不留一条没回答的提问 */
export async function enforceTurnQuota(userId: string, role: HarnessRole, zh: boolean): Promise<void> {
  if (role === 'student') await assertDailyAiQuota(userId, { zh });
}

export interface PromptCheck {
  intent: AgencyIntent;
  /** 这段对话之前几句（最近六句）里让 AI 代写的次数 */
  ghostwriteBefore: number;
  /** 接连代写（这一问又是，之前已有两次）：提示词里加一句更明确的引导 */
  escalated: boolean;
}

export function analyzePrompt(p: { question: string; earlierQuestions: readonly string[]; role: HarnessRole }): PromptCheck {
  const intent = classifyAgencyIntent(p.question);
  const ghostwriteBefore = countGhostwriteRequests(p.earlierQuestions.slice(-6));
  return { intent, ghostwriteBefore, escalated: p.role === 'student' && intent === 'ghostwrite' && ghostwriteBefore >= 2 };
}

/** 系统提示词最后加的几段；第二项是给运行记录看的名字 */
export function harnessPromptSections(check: PromptCheck, opts: { role: HarnessRole; systemPrompt: string }): Array<[string, string]> {
  const out: Array<[string, string]> = [['natural_speech', NATURAL_SPEECH_RULES]];
  if (opts.role !== 'student') return out;
  // buildAgentContext 判出代写时已经加过 friction 那段（自由提问不经过它，由这里补）
  if (check.intent === 'ghostwrite' && !opts.systemPrompt.includes(FRICTION_MARKER)) out.push(['ghostwrite', GHOSTWRITE_GUIDANCE]);
  if (check.escalated) out.push(['ghostwrite_escalation', GHOSTWRITE_ESCALATION]);
  if (check.intent === 'polish') out.push(['polish', POLISH_GUIDANCE]);
  return out;
}

// ── 调工具前 / 调工具后（preToolUse / postToolUse）───────────

/** 一轮里每个工具最多调几次。读笔记那条是 10-11 实测一轮读了 22 条、等了好久 */
export const DEFAULT_TOOL_CAPS: Readonly<Record<string, number>> = {
  read_note: 10,
  get_note_context: 6,
  search_notes: 6,
  compare_notes: 4,
  search_course_materials: 4,
  web_search: 3,
  find_sources: 3,
  generate_image: 2,
  save_reflection: 2,
};
export const MAX_TOOL_CALLS_PER_TURN = 30;
/** 被拦下的工具返回的错误以它开头：推给学生的那一步摘要据此写「够了」，而不是「没成功」 */
export const LIMIT_PREFIX = '[limit] ';

type ToolOutcome = Awaited<ReturnType<AgentLoopParams['executeToolFn']>>;

export function createToolGuard(p: {
  allowed: ReadonlySet<string>;
  caps?: Readonly<Record<string, number>>;
  maxCalls?: number;
  trace: AgentTrace;
}): (name: string, args: Record<string, unknown>, run: AgentLoopParams['executeToolFn']) => Promise<ToolOutcome> {
  const caps = p.caps ?? DEFAULT_TOOL_CAPS;
  const maxCalls = p.maxCalls ?? MAX_TOOL_CALLS_PER_TURN;
  const counts = new Map<string, number>();
  let total = 0;
  return async (name, args, run) => {
    const used = counts.get(name) ?? 0;
    const cap = caps[name];
    let denial: { reason: string; message: string } | null = null;
    if (!p.allowed.has(name)) {
      // 自由提问没有工具、模式里没给的工具：模型把调用写成文字也不执行
      denial = { reason: 'not_allowed', message: `The tool "${name}" is not available in this conversation.` };
    } else if (cap != null && used >= cap) {
      denial = {
        reason: 'cap',
        message: name === 'read_note'
          ? `You have already read ${cap} notes in full this turn. Answer from what you have read and the note summaries in your instructions, or use search_notes to find the few that matter most.`
          : `"${name}" has been used ${cap} times this turn, which is the limit. Work with the results you already have.`,
      };
    } else if (total >= maxCalls) {
      denial = { reason: 'total_cap', message: `You have made ${maxCalls} tool calls this turn. Stop calling tools and write your answer now.` };
    }
    if (denial) {
      p.trace.record('tool_denied', { name, reason: denial.reason, ...(cap != null ? { cap } : {}) });
      return { success: false, data: null, error: LIMIT_PREFIX + denial.message };
    }
    counts.set(name, used + 1);
    total += 1;
    p.trace.record('tool_called', { name, args: summarizeArgs(args) });
    const started = Date.now();
    const out = await run(name, args);
    p.trace.record('tool_result', {
      name,
      ok: out.success,
      ms: Date.now() - started,
      ...(out.success ? {} : { error: String(out.error ?? '').slice(0, 200) }),
      ...(out.endTurn ? { end_turn: true } : {}),
    });
    return out;
  };
}

function stepSummary(toolName: string, result: unknown, lang: 'zh' | 'en'): string | undefined {
  const error = (result as { error?: unknown } | null)?.error;
  if (typeof error === 'string' && error.startsWith(LIMIT_PREFIX)) {
    return lang === 'zh' ? '这一轮查得够多了，没再调用' : 'enough for this turn, skipped';
  }
  return summarizeToolResult(toolName, result, lang);
}

// ── 回答结束时（onStop）──────────────────────────────────────

export interface AnswerCheckRecord {
  /** none 没问题；cleaned 删了套话；rewritten 模型改过；rewrite_rejected 改写不可信、用了删过套话的原文；
   *  live_unchecked 回答是边写边推的，只查不改 */
  action: 'none' | 'cleaned' | 'rewritten' | 'rewrite_rejected' | 'live_unchecked';
  speech_fixed: SpeechIssue[];
  speech_flagged: SpeechIssue[];
  agency: AgencyIssue[];
  passage_chars: number;
  /** 改写之后再查一遍主体性还剩的问题（没有就不写） */
  agency_after?: AgencyIssue[];
  ms?: number;
  rejected?: string;
}

const REWRITE_TIMEOUT_MS = 25_000;

/** 让写这段回答的同一个模型改一遍：关掉思考、温度调低，超时或出错返回空串 */
async function reviseWithModel(cand: TurnCandidate, prompt: { system: string; user: string }, chars: number): Promise<string> {
  const run = (async () => {
    let out = '';
    for await (const chunk of streamProviderFinalAnswer({
      providerId: cand.providerId,
      model: cand.model,
      apiKey: cand.apiKey,
      endpointUrl: cand.endpointUrl,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      maxTokens: Math.min(2400, Math.max(600, chars * 2)),
      temperature: 0.3,
      disableThinking: true,
    })) {
      if (chunk.type === 'token') out += chunk.content;
    }
    return out;
  })();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<string>(resolve => { timer = setTimeout(() => resolve(''), REWRITE_TIMEOUT_MS); });
  try {
    return await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 回答给学生看之前的检查。主体性只查学生；说话自然谁都查。
 * revise 为 null 时只查不改（边写边推的回答，或测试里替身的循环）。
 */
export async function checkFinalAnswer(text: string, p: {
  role: HarnessRole;
  intent: AgencyIntent;
  revise: ((prompt: { system: string; user: string }, chars: number) => Promise<string>) | null;
}): Promise<{ text: string; record: AnswerCheckRecord }> {
  const started = Date.now();
  const speech = checkSpeech(text);
  const agency = p.role === 'student'
    ? checkAgency(speech.text, { intent: p.intent })
    : { issues: [] as AgencyIssue[], passageChars: 0 };
  if (!p.revise) {
    return {
      text,
      record: {
        action: 'live_unchecked',
        speech_fixed: speech.fixed,
        speech_flagged: speech.remaining,
        agency: agency.issues,
        passage_chars: agency.passageChars,
      },
    };
  }
  let out = speech.text;
  let action: AnswerCheckRecord['action'] = speech.fixed.length > 0 ? 'cleaned' : 'none';
  let rejected: string | undefined;
  let agencyAfter: AgencyIssue[] = [];
  const speechToRewrite = speech.remaining.filter(issue => REWRITE_SPEECH.has(issue));
  if (agency.issues.length > 0 || speechToRewrite.length > 0) {
    const prompt = buildRevisionPrompt({ text: out, speech: speechToRewrite, agency: agency.issues });
    let revised = '';
    try {
      revised = await p.revise(prompt, out.length);
    } catch {
      rejected = 'error';
    }
    const verdict = revised ? acceptRevision(out, revised, { agency: agency.issues.length > 0 }) : { ok: false, reason: rejected ?? 'empty' };
    if (verdict.ok) {
      out = checkSpeech(unwrapRevision(revised)).text;
      action = 'rewritten';
      if (p.role === 'student') agencyAfter = checkAgency(out, { intent: p.intent }).issues;
    } else {
      action = 'rewrite_rejected';
      rejected = verdict.reason;
    }
  }
  return {
    text: out,
    record: {
      action,
      speech_fixed: speech.fixed,
      speech_flagged: speech.remaining,
      agency: agency.issues,
      passage_chars: agency.passageChars,
      ...(agencyAfter.length ? { agency_after: agencyAfter } : {}),
      ms: Date.now() - started,
      ...(rejected ? { rejected } : {}),
    },
  };
}

// ── 出错时（onError）─────────────────────────────────────────

/** 超时、限流、网关 5xx、连接断开：再试一次可能就好了 */
export function isTransientError(message: string): boolean {
  return /\((429|5\d\d)\)|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up|network/i.test(message);
}

export function decideOnError(p: {
  error: string;
  failover: boolean;
  candidateIndex: number;
  candidates: number;
  retriedSame: boolean;
}): 'next' | 'retry_same' | 'surface' {
  if (p.failover && p.candidateIndex < p.candidates - 1) return 'next';
  if (!p.failover && !p.retriedSame && isTransientError(p.error)) return 'retry_same';
  return 'surface';
}

// ── 跑这一轮 ──────────────────────────────────────────────────

export interface AgentTurnOptions {
  surface: HarnessSurface;
  /** 往前端推一条 SSE 事件 */
  emit: (event: Record<string, unknown>) => void;
  trace: AgentTrace;
  role: HarnessRole;
  promptCheck: PromptCheck;
  /** 第一个是学生选的；后面的只在 failover 为真时用 */
  candidates: TurnCandidate[];
  /** 课程设置里这个功能允许换下一家（知识空间智能体可以；笔记 AI 助手不行，模型是学生选的） */
  failover: boolean;
  /** 每个候选模型各自的上下文窗口不同，消息按它装 */
  messagesFor: (cand: TurnCandidate) => Promise<AgentLoopMessage[]> | AgentLoopMessage[];
  systemPrompt: string;
  tools: AgentLoopParams['tools'];
  executeTool: AgentLoopParams['executeToolFn'];
  maxTokensFor: (cand: TurnCandidate) => number;
  maxIterations?: number;
  totalTimeoutMs?: number;
  kb: KbRetrieval | null;
  turn: AgentTurnState | null;
  /** 过程记录：路由已经放进课程资料检索那一步，这里接着往后记 */
  toolSteps: KbToolStep[];
  toolsUsed: Set<string>;
  summaryLang: 'zh' | 'en';
  toolCaps?: Readonly<Record<string, number>>;
}

export interface AgentTurnResult {
  reply: string;
  toolCalls: Array<{ id: string; name: string }>;
  iterations: number;
  continuations: number;
  truncated: boolean;
  endedByTool?: string;
  /** 最后真正回答的那个模型 */
  used: TurnCandidate;
  kbChecked: Awaited<ReturnType<typeof checkKbAnswer>>;
  finalPlan: ReturnType<typeof settlePlan> | null;
  answerCheck: AnswerCheckRecord | null;
  usage: AgentTokenUsage | null;
  /** 推给学生的最后一个错误（没答出来时） */
  error: string | null;
}

export async function runAgentTurn(o: AgentTurnOptions): Promise<AgentTurnResult> {
  const { trace, emit } = o;
  const sections = harnessPromptSections(o.promptCheck, { role: o.role, systemPrompt: o.systemPrompt });
  const systemPrompt = [o.systemPrompt, ...sections.map(([, text]) => text)].join('\n\n');
  trace.record('run_started', {
    surface: o.surface,
    prompt_version: HARNESS_PROMPT_VERSION,
    system_prompt_chars: systemPrompt.length,
    system_prompt_hash: promptHash(systemPrompt),
    appended: sections.map(([name]) => name),
    intent: o.promptCheck.intent,
    ghostwrite_before: o.promptCheck.ghostwriteBefore,
    escalated: o.promptCheck.escalated,
    tools: o.tools.map(t => t.function.name),
    candidates: o.candidates.map(c => `${c.providerId}/${c.model}`),
    failover: o.failover,
  });

  const guard = createToolGuard({ allowed: new Set(o.tools.map(t => t.function.name)), caps: o.toolCaps, trace });
  let reply = '';
  const toolCalls: Array<{ id: string; name: string }> = [];
  let iterations = 0;
  let continuations = 0;
  let truncated = false;
  let endedByTool: string | undefined;
  let usage: AgentTokenUsage | null = null;
  let providerFinish: string | undefined;
  let answerCheck: AnswerCheckRecord | null = null;
  let lastError: string | null = null;
  let firstTokenMs: number | null = null;
  let used = o.candidates[0];
  let sentSources = o.kb?.citations.sources.length ?? 0;

  let ci = 0;
  let retriedSame = false;
  while (ci < o.candidates.length) {
    const cand = o.candidates[ci];
    used = cand;
    trace.record('model_attempt', { provider: cand.providerId, model: cand.model, index: ci, ...(retriedSame ? { retry: true } : {}) });
    let emitted = false;
    let failedBeforeOutput: string | null = null;
    // 出错时还有没有退路：能换下一家，或者（不许换的）还没原样重试过。真出错了再按错误类型定（decideOnError）
    const hasFallback = () => (o.failover && ci < o.candidates.length - 1) || (!o.failover && !retriedSame);
    const toolStartedAt = new Map<string, number>();

    const stream = runAgentLoopStream({
      providerId: cand.providerId,
      model: cand.model,
      apiKey: cand.apiKey,
      endpointUrl: cand.endpointUrl,
      systemPrompt,
      messages: await o.messagesFor(cand),
      tools: o.tools,
      executeToolFn: (name, args) => guard(name, args, o.executeTool),
      maxTokens: o.maxTokensFor(cand),
      ...(o.maxIterations != null ? { maxIterations: o.maxIterations } : {}),
      ...(o.totalTimeoutMs != null ? { totalTimeoutMs: o.totalTimeoutMs } : {}),
      // 回答结束时（onStop）：整段回答在手里时，学生看到之前先过检查，必要时让同一个模型改一遍
      reviseFinal: async (text: string) => {
        const checked = await checkFinalAnswer(text, {
          role: o.role,
          intent: o.promptCheck.intent,
          revise: (prompt, chars) => reviseWithModel(cand, prompt, chars),
        });
        answerCheck = checked.record;
        trace.record('answer_checked', { ...checked.record, chars_before: text.length, chars_after: checked.text.length });
        return checked.text;
      },
    });

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'thinking':
            emit({ reasoningStatus: 'thinking', reasoningChunk: event.content });
            break;
          case 'tool_call':
            emitted = true;
            toolCalls.push({ id: event.toolCall.id, name: event.toolCall.function.name });
            o.toolsUsed.add(event.toolCall.function.name);
            toolStartedAt.set(event.toolCall.id, Date.now());
            emit({ toolStatus: 'running', toolName: event.toolCall.function.name });
            break;
          case 'tool_result': {
            const startedAt = toolStartedAt.get(event.toolCallId);
            const ms = startedAt ? Date.now() - startedAt : undefined;
            // 只推统计性摘要（几条、成没成），不复述内容
            const summary = stepSummary(event.toolName, event.result, o.summaryLang);
            o.toolSteps.push({ name: event.toolName, summary, ...(ms != null ? { ms } : {}) });
            emit({
              toolStatus: 'used',
              toolName: event.toolName,
              toolNames: Array.from(o.toolsUsed),
              toolSummary: summary,
              toolDurationMs: ms,
            });
            // 又查到新的课程资料：来源卡片整份重发（编号接着自动检索的往下）
            if (event.toolName === KB_STEP_NAME && o.kb && o.kb.citations.sources.length > sentSources) {
              sentSources = o.kb.citations.sources.length;
              emit({ kbSources: o.kb.citations.sources });
            }
            break;
          }
          case 'token':
            emitted = true;
            if (firstTokenMs == null) firstTokenMs = Date.now() - trace.startedAt;
            reply += event.content;
            emit({ token: event.content });
            break;
          case 'done':
            iterations = event.result.iterations;
            continuations = event.result.continuations ?? 0;
            truncated = event.result.truncated === true;
            endedByTool = event.result.endedByTool;
            usage = event.result.usage ?? null;
            providerFinish = event.result.providerFinish;
            break;
          case 'error':
            if (!emitted && hasFallback()) {
              failedBeforeOutput = event.error;
            } else {
              lastError = event.error;
              trace.record('error', { message: event.error.slice(0, 300), provider: cand.providerId, model: cand.model });
              emit({ error: event.error });
            }
            break;
        }
        if (failedBeforeOutput) break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (emitted || !hasFallback()) {
        trace.record('error', { message: message.slice(0, 300), provider: cand.providerId, model: cand.model });
        throw err;
      }
      failedBeforeOutput = message;
    }

    if (!failedBeforeOutput) break;
    const decision = decideOnError({ error: failedBeforeOutput, failover: o.failover, candidateIndex: ci, candidates: o.candidates.length, retriedSame });
    if (decision === 'retry_same') {
      retriedSame = true;
      trace.record('retry', { provider: cand.providerId, model: cand.model, error: failedBeforeOutput.slice(0, 200) });
      console.warn(`[harness] ${cand.providerId}/${cand.model} failed before output (${failedBeforeOutput.slice(0, 120)}), retrying once`);
      continue;
    }
    if (decision === 'next') {
      const next = o.candidates[ci + 1];
      trace.record('failover', { from: `${cand.providerId}/${cand.model}`, to: `${next.providerId}/${next.model}`, error: failedBeforeOutput.slice(0, 200) });
      console.warn(`[harness] ${cand.providerId}/${cand.model} failed before output (${failedBeforeOutput.slice(0, 120)}), switching to ${next.providerId}/${next.model}`);
      emit({ providerSwitch: { from: cand.providerId, to: next.providerId, model: next.model } });
      ci += 1;
      retriedSame = false;
      continue;
    }
    // 不能再试了：把错误交给学生
    lastError = failedBeforeOutput;
    trace.record('error', { message: failedBeforeOutput.slice(0, 300), provider: cand.providerId, model: cand.model });
    emit({ error: failedBeforeOutput });
    break;
  }

  // 边写边推的回答（达到步数上限、规划轮没给正文）没经过 reviseFinal：只查不改，结果记下来
  if (!answerCheck && reply.trim()) {
    const checked = await checkFinalAnswer(reply, { role: o.role, intent: o.promptCheck.intent, revise: null });
    answerCheck = checked.record;
    trace.record('answer_checked', { ...checked.record, chars_before: reply.length, chars_after: reply.length });
  }

  // 回答写完：Jev 核对课程资料的引用，来源卡片带上核对结果再推一次（kbCitationCheck.ts）
  const kbChecked = o.kb && reply.trim() ? await checkKbAnswer(reply, o.kb.citations) : null;
  if (kbChecked) emit({ kbSources: kbChecked.sources });
  // 这一轮做完了：还标着「正在做」的那一步算完成，清单最后推一次
  const finalPlan = o.turn ? settlePlan(o.turn) : null;
  if (finalPlan) emit({ agentPlan: finalPlan });

  trace.record('run_finished', {
    iterations,
    continuations,
    truncated,
    ...(endedByTool ? { ended_by: endedByTool } : {}),
    reply_chars: reply.length,
    tool_calls: toolCalls.length,
    first_token_ms: firstTokenMs,
    total_ms: Date.now() - trace.startedAt,
    provider: used.providerId,
    model: used.model,
    ...(usage ? { usage } : {}),
    ...(providerFinish ? { provider_finish: providerFinish } : {}),
    ...(kbChecked ? { kb_check: kbChecked.summary } : {}),
    ...(lastError ? { error: lastError.slice(0, 300) } : {}),
  });

  return {
    reply,
    toolCalls,
    iterations,
    continuations,
    truncated,
    endedByTool,
    used,
    kbChecked,
    finalPlan,
    answerCheck,
    usage,
    error: lastError,
  };
}

/** 存进回答 ai_metadata 的那一小段：研究编码看得到这一轮检查出了什么、改没改 */
export function answerCheckMetadata(record: AnswerCheckRecord | null): Record<string, unknown> | undefined {
  if (!record || (record.action === 'none' && record.agency.length === 0 && record.speech_flagged.length === 0)) return undefined;
  return {
    action: record.action,
    ...(record.speech_fixed.length ? { speech_fixed: record.speech_fixed } : {}),
    ...(record.speech_flagged.length ? { speech_flagged: record.speech_flagged } : {}),
    ...(record.agency.length ? { agency: record.agency } : {}),
    ...(record.agency_after?.length ? { agency_after: record.agency_after } : {}),
  };
}
