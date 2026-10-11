import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 智能体的 harness（2026-10-11）：五个钩子和运行记录。循环换成替身，按真实循环的约定吐事件、调 reviseFinal / executeToolFn。
 */

const h = vi.hoisted(() => ({
  loop: vi.fn(),
  inserts: [] as Array<{ table: string; payload: unknown }>,
  failInsert: null as string | null,
}));

vi.mock('./agentLoop', () => ({
  runAgentLoopStream: h.loop,
  streamProviderFinalAnswer: vi.fn(),
}));
vi.mock('../config/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: async (payload: unknown) => {
        h.inserts.push({ table, payload });
        return { error: h.failInsert === table ? { message: `${table} down` } : null };
      },
    }),
  },
}));

import {
  LIMIT_PREFIX,
  analyzePrompt,
  answerCheckMetadata,
  checkFinalAnswer,
  createToolGuard,
  decideOnError,
  harnessPromptSections,
  isTransientError,
  runAgentTurn,
  type AgentTurnOptions,
} from './agentHarness';
import { AgentTrace } from './agentTrace';
import { FRICTION_MARKER, GHOSTWRITE_ESCALATION, GHOSTWRITE_GUIDANCE, NATURAL_SPEECH_RULES, POLISH_GUIDANCE } from './answerChecks';

const newTrace = () => new AgentTrace({ userId: 'u1', courseId: 'c1', surface: 'workspace', conversationId: 'conv-1', title: '问题' });
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: '', parameters: {} } });

beforeEach(() => {
  h.loop.mockReset();
  h.inserts.length = 0;
  h.failInsert = null;
});

describe('调工具前 / 调工具后', () => {
  it('这一轮工具单上没有的不执行；读笔记最多 10 次，第 11 次告诉模型够了；每一步记进运行记录', async () => {
    const trace = newTrace();
    const run = vi.fn(async () => ({ success: true, data: { ok: 1 } }));
    const guard = createToolGuard({ allowed: new Set(['read_note']), trace });

    const denied = await guard('class_analytics', {}, run);
    expect(denied).toMatchObject({ success: false });
    expect(denied.error).toBe(`${LIMIT_PREFIX}The tool "class_analytics" is not available in this conversation.`);
    expect(run).not.toHaveBeenCalled();

    for (let i = 0; i < 10; i++) expect((await guard('read_note', { note_id: `n${i}` }, run)).success).toBe(true);
    const capped = await guard('read_note', { note_id: 'n10' }, run);
    expect(capped.success).toBe(false);
    expect(capped.error).toContain('already read 10 notes');
    expect(run).toHaveBeenCalledTimes(10);

    const types = trace.events.map(e => e.type);
    expect(types.filter(t => t === 'tool_called')).toHaveLength(10);
    expect(types.filter(t => t === 'tool_result')).toHaveLength(10);
    expect(trace.events.filter(e => e.type === 'tool_denied').map(e => e.payload.reason)).toEqual(['not_allowed', 'cap']);
    expect(trace.events.find(e => e.type === 'tool_called')!.payload).toEqual({ name: 'read_note', args: '{"note_id":"n0"}' });
  });

  it('一轮总共调用到上限：叫模型停下来作答', async () => {
    const guard = createToolGuard({ allowed: new Set(['search_notes']), caps: {}, maxCalls: 2, trace: newTrace() });
    const run = vi.fn(async () => ({ success: true, data: null }));
    await guard('search_notes', { q: 'a' }, run);
    await guard('search_notes', { q: 'b' }, run);
    expect((await guard('search_notes', { q: 'c' }, run)).error).toContain('Stop calling tools');
  });
});

describe('学生提交问题时', () => {
  it('谁都加说话规则；学生代写时加引导（buildAgentContext 已经加过就不重复），接连代写再升级', () => {
    const ghost = analyzePrompt({ question: '帮我写一段观点', earlierQuestions: ['帮我写一段反思', '直接告诉我答案'], role: 'student' });
    expect(ghost).toEqual({ intent: 'ghostwrite', ghostwriteBefore: 2, escalated: true });
    const sections = harnessPromptSections(ghost, { role: 'student', systemPrompt: 'CTX' });
    expect(sections.map(([name]) => name)).toEqual(['natural_speech', 'ghostwrite', 'ghostwrite_escalation']);
    expect(sections.map(([, text]) => text)).toEqual([NATURAL_SPEECH_RULES, GHOSTWRITE_GUIDANCE, GHOSTWRITE_ESCALATION]);

    expect(harnessPromptSections(ghost, { role: 'student', systemPrompt: `x\n${FRICTION_MARKER}: ...` }).map(([n]) => n))
      .toEqual(['natural_speech', 'ghostwrite_escalation']);
  });

  it('改自己写的：加分寸；老师问：只加说话规则', () => {
    const polish = analyzePrompt({ question: '帮我改一下我写的这段', earlierQuestions: [], role: 'student' });
    expect(harnessPromptSections(polish, { role: 'student', systemPrompt: '' }).map(([, t]) => t)).toEqual([NATURAL_SPEECH_RULES, POLISH_GUIDANCE]);
    const teacher = analyzePrompt({ question: '帮我写一段课堂总结', earlierQuestions: [], role: 'teacher' });
    expect(teacher.escalated).toBe(false);
    expect(harnessPromptSections(teacher, { role: 'teacher', systemPrompt: '' }).map(([n]) => n)).toEqual(['natural_speech']);
  });
});

describe('回答结束时', () => {
  const ghostText = `你可以这样写：\n\n“我认为检索练习比重读更有效，因为每次回想都在加强提取路径。${'课堂经验也支持这一点，'.repeat(10)}”`;

  it('只有套话：删掉，不叫模型', async () => {
    const revise = vi.fn();
    const out = await checkFinalAnswer('当然！分歧在第二栏。\n\n希望对你有帮助！', { role: 'student', intent: 'ask', revise });
    expect(out.text).toBe('分歧在第二栏。');
    expect(out.record).toMatchObject({ action: 'cleaned', speech_fixed: ['opener', 'closer'], agency: [] });
    expect(revise).not.toHaveBeenCalled();
  });

  it('替学生写了成段的现成文字：叫模型改成提问，改得可信就用', async () => {
    const revise = vi.fn(async () => '这一段要你自己写。先想想：你最认同哪一条理由？它在你的课堂经验里怎么体现？');
    const out = await checkFinalAnswer(ghostText, { role: 'student', intent: 'ghostwrite', revise });
    expect(revise.mock.calls[0][0].user).toContain('sentence starters');
    expect(out.text).toContain('这一段要你自己写');
    expect(out.record).toMatchObject({ action: 'rewritten', agency: ['ready_text'] });
  });

  it('改写后再查一遍：还像代写就记下 agency_after（只记录，不再改第二遍）', async () => {
    const stillGhost = `这段可以参考。\n\n我认为检索练习比重读更有效，我主张多做自测。${'因为每次回想都在加强提取路径，课堂经验也支持这一点。'.repeat(5)}`;
    const out = await checkFinalAnswer(ghostText, { role: 'student', intent: 'ghostwrite', revise: async () => stillGhost });
    expect(out.record).toMatchObject({ action: 'rewritten', agency: ['ready_text'], agency_after: ['ghostwritten'] });
    expect(answerCheckMetadata(out.record)).toMatchObject({ agency_after: ['ghostwritten'] });
    const fixed = await checkFinalAnswer(ghostText, { role: 'student', intent: 'ghostwrite', revise: async () => '这一段要你自己写。先想想：你最认同哪一条理由？' });
    expect(fixed.record.agency_after).toBeUndefined();
  });

  it('改写不可信（凭空多出引用）：不用，退回删过套话的原文', async () => {
    const out = await checkFinalAnswer(ghostText, { role: 'student', intent: 'ghostwrite', revise: async () => '你先想想[9]。' });
    expect(out.text).toBe(ghostText);
    expect(out.record).toMatchObject({ action: 'rewrite_rejected', rejected: 'new_citation' });
  });

  it('边写边推的回答：只查不改；老师的回答不查主体性', async () => {
    expect((await checkFinalAnswer(ghostText, { role: 'student', intent: 'ghostwrite', revise: null })).record.action).toBe('live_unchecked');
    const teacher = await checkFinalAnswer(ghostText, { role: 'teacher', intent: 'ghostwrite', revise: vi.fn() });
    expect(teacher.record.agency).toEqual([]);
    expect(teacher.record.action).toBe('none');
  });

  it('「首先……其次……最后」只记下来不叫模型改（改一遍学生要多等好几秒）；「作为 AI」叫模型改', async () => {
    const revise = vi.fn(async () => '我没法替你判断，得看你掌握的证据。');
    const chain = await checkFinalAnswer('首先看证据，其次看推理，最后看结论。', { role: 'student', intent: 'ask', revise });
    expect(revise).not.toHaveBeenCalled();
    expect(chain.record).toMatchObject({ action: 'none', speech_flagged: ['template_chain'] });
    const ai = await checkFinalAnswer('作为一个AI助手，我没法替你判断，得看你掌握的证据。', { role: 'student', intent: 'ask', revise });
    expect(revise).toHaveBeenCalledTimes(1);
    expect(ai.record.action).toBe('rewritten');
  });

  it('存进回答的那一小段：没查出东西就不存', () => {
    expect(answerCheckMetadata({ action: 'none', speech_fixed: [], speech_flagged: [], agency: [], passage_chars: 0 })).toBeUndefined();
    expect(answerCheckMetadata({ action: 'cleaned', speech_fixed: ['opener'], speech_flagged: [], agency: [], passage_chars: 0 })).toEqual({ action: 'cleaned', speech_fixed: ['opener'] });
  });
});

describe('出错时', () => {
  it('能换就换下一家；不许换的只在临时错误时原样再试一次', () => {
    expect(isTransientError('AI service error (429)')).toBe(true);
    expect(isTransientError('Tool "x" timed out after 15000ms')).toBe(true);
    expect(isTransientError('AI service error (401)')).toBe(false);
    expect(decideOnError({ error: 'AI service error (401)', failover: true, candidateIndex: 0, candidates: 2, retriedSame: false })).toBe('next');
    expect(decideOnError({ error: 'x', failover: true, candidateIndex: 1, candidates: 2, retriedSame: false })).toBe('surface');
    expect(decideOnError({ error: 'AI service error (503)', failover: false, candidateIndex: 0, candidates: 1, retriedSame: false })).toBe('retry_same');
    expect(decideOnError({ error: 'AI service error (503)', failover: false, candidateIndex: 0, candidates: 1, retriedSame: true })).toBe('surface');
    expect(decideOnError({ error: 'AI service error (400)', failover: false, candidateIndex: 0, candidates: 1, retriedSame: false })).toBe('surface');
  });
});

describe('跑这一轮', () => {
  const cand = (providerId: string) => ({ providerId, model: `${providerId}-m`, apiKey: 'k', endpointUrl: null });
  const baseOpts = (over: Partial<AgentTurnOptions> = {}): AgentTurnOptions => ({
    surface: 'workspace',
    emit: () => undefined,
    trace: newTrace(),
    role: 'student',
    promptCheck: { intent: 'ask', ghostwriteBefore: 0, escalated: false },
    candidates: [cand('zhipu')],
    failover: true,
    messagesFor: () => [{ role: 'user', content: '问题' }],
    systemPrompt: 'CTX',
    tools: [tool('read_note')],
    executeTool: vi.fn(async () => ({ success: true, data: { title: 'n' } })),
    maxTokensFor: () => 1000,
    kb: null,
    turn: null,
    toolSteps: [],
    toolsUsed: new Set(),
    summaryLang: 'zh',
    ...over,
  });

  it('整段回答在手里时：学生看到之前先删掉套话；提示词带说话规则；运行记录从头记到尾', async () => {
    h.loop.mockImplementationOnce((opts: any) => (async function* () {
      const text = await opts.reviseFinal('好的，两种看法的分歧在复习时间。\n\n如有其他问题欢迎随时提问。');
      yield { type: 'token', content: text };
      yield { type: 'done', result: { iterations: 1, usage: { prompt: 900, completion: 60, calls: 1 } } };
    })());
    const events: Record<string, unknown>[] = [];
    const opts = baseOpts({ emit: e => events.push(e) });
    const out = await runAgentTurn(opts);

    expect(h.loop.mock.calls[0][0].systemPrompt).toBe(`CTX\n\n${NATURAL_SPEECH_RULES}`);
    expect(out.reply).toBe('两种看法的分歧在复习时间。');
    expect(events.filter(e => e.token).map(e => e.token)).toEqual(['两种看法的分歧在复习时间。']);
    expect(out.answerCheck).toMatchObject({ action: 'cleaned', speech_fixed: ['opener', 'closer'] });
    expect(out.usage).toEqual({ prompt: 900, completion: 60, calls: 1 });
    expect(opts.trace.events.map(e => e.type)).toEqual(['run_started', 'model_attempt', 'answer_checked', 'run_finished']);
    expect(opts.trace.events[0].payload).toMatchObject({ appended: ['natural_speech'], intent: 'ask', candidates: ['zhipu/zhipu-m'] });
  });

  it('工具走过关卡：工具单上没有的拦下；推给学生的那一步写「够了」', async () => {
    const executeTool = vi.fn(async () => ({ success: true, data: {} }));
    h.loop.mockImplementationOnce((opts: any) => (async function* () {
      const result = await opts.executeToolFn('class_analytics', {});
      yield { type: 'tool_call', toolCall: { id: 't1', function: { name: 'class_analytics', arguments: '{}' } } };
      yield { type: 'tool_result', toolCallId: 't1', toolName: 'class_analytics', result };
      yield { type: 'token', content: '答' };
      yield { type: 'done', result: { iterations: 2 } };
    })());
    const opts = baseOpts({ executeTool });
    await runAgentTurn(opts);
    expect(executeTool).not.toHaveBeenCalled();
    expect(opts.toolSteps).toEqual([expect.objectContaining({ name: 'class_analytics', summary: '这一轮查得够多了，没再调用' })]);
  });

  it('一个字没吐出来就出错：换候选链里的下一家，并告诉前端换了', async () => {
    h.loop
      .mockImplementationOnce(() => (async function* () {
        yield { type: 'error', error: 'AI service error (503)' };
        yield { type: 'done', result: { iterations: 0 } };
      })())
      .mockImplementationOnce(() => (async function* () {
        yield { type: 'token', content: '第二家答的' };
        yield { type: 'done', result: { iterations: 1 } };
      })());
    const events: Record<string, unknown>[] = [];
    const opts = baseOpts({ candidates: [cand('zhipu'), cand('deepseek')], emit: e => events.push(e) });
    const out = await runAgentTurn(opts);
    expect(out.reply).toBe('第二家答的');
    expect(out.used.providerId).toBe('deepseek');
    expect(events).toContainEqual({ providerSwitch: { from: 'zhipu', to: 'deepseek', model: 'deepseek-m' } });
    expect(events.some(e => e.error)).toBe(false);
    expect(opts.trace.events.map(e => e.type)).toContain('failover');
  });

  it('不许换的（笔记 AI 助手）：限流时原样再试一次；再失败或不是临时错误就把错误给学生', async () => {
    h.loop
      .mockImplementationOnce(() => (async function* () { yield { type: 'error', error: 'AI service error (429)' }; })())
      .mockImplementationOnce(() => (async function* () { yield { type: 'token', content: '重试成功' }; yield { type: 'done', result: { iterations: 1 } }; })());
    const retried = await runAgentTurn(baseOpts({ surface: 'note', failover: false }));
    expect(retried.reply).toBe('重试成功');
    expect(h.loop).toHaveBeenCalledTimes(2);

    h.loop.mockReset();
    h.loop.mockImplementationOnce(() => (async function* () { yield { type: 'error', error: 'AI service error (401)' }; })());
    const events: Record<string, unknown>[] = [];
    const failed = await runAgentTurn(baseOpts({ surface: 'note', failover: false, emit: e => events.push(e) }));
    expect(h.loop).toHaveBeenCalledTimes(1);
    expect(failed.error).toBe('AI service error (401)');
    expect(events).toContainEqual({ error: 'AI service error (401)' });
  });

  it('边写边推的回答没经过 reviseFinal：只查不改，结果照样记下', async () => {
    h.loop.mockImplementationOnce(() => (async function* () {
      yield { type: 'token', content: '当然！' };
      yield { type: 'token', content: '分歧在第二栏。' };
      yield { type: 'done', result: { iterations: 5 } };
    })());
    const out = await runAgentTurn(baseOpts());
    expect(out.reply).toBe('当然！分歧在第二栏。');
    expect(out.answerCheck).toMatchObject({ action: 'live_unchecked', speech_fixed: ['opener'] });
  });
});

describe('运行记录写库', () => {
  it('一行 run、effects 按顺序编号；写过一次就不再写；写失败只记日志不抛', async () => {
    const trace = newTrace();
    trace.record('run_started', { a: 1 });
    trace.record('run_finished', { b: 2 });
    expect(await trace.persist({ status: 'applied', output: { reply_chars: 3 }, metadata: { model: 'm' } })).toBe(true);
    expect(await trace.persist({ status: 'applied' })).toBe(false);
    const run = h.inserts.find(i => i.table === 'agent_runs')!.payload as Record<string, any>;
    expect(run).toMatchObject({ id: trace.runId, user_id: 'u1', course_id: 'c1', agent_type: 'chat', status: 'applied', title: '问题' });
    expect(run.metadata).toMatchObject({ surface: 'workspace', conversation_id: 'conv-1', model: 'm', harness: expect.any(String) });
    const effects = h.inserts.find(i => i.table === 'agent_effects')!.payload as Array<Record<string, unknown>>;
    expect(effects.map(e => [e.seq, e.effect_type, e.run_id])).toEqual([[1, 'run_started', trace.runId], [2, 'run_finished', trace.runId]]);

    h.failInsert = 'agent_runs';
    const broken = newTrace();
    broken.record('x');
    await expect(broken.persist({ status: 'failed' })).resolves.toBe(false);
  });
});
