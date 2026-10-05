import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 反馈的触发和判断交给 Jev。整个路由挂在真实的 Express 上跑，
 * 只替换数据库、鉴权、实验条件、大模型网关和 Jev 的调用。
 *
 * - 模型明确说「不要」就是不要，关键词规则只在调用失败时兜底；
 * - shadow：大模型照常决定，Jev 的判断记进检查表和 trigger_context.jev；
 * - gate：Jev 说不要就不调大模型；说要，大模型按它定的类型写；Jev 出错退回大模型判断；
 * - 对照组不调 Jev；没 key 不调 Jev，检查照样记。
 */

const h = vi.hoisted(() => {
  const state = {
    user: { id: 'student-1', role: 'student' },
    triggerSettings: {} as Record<string, unknown>,
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    env: {} as Record<string, string>,
    /** 教师批量读的是库里存的正文 */
    noteContent: '',
  };

  const resultFor = (table: string, action: 'select' | 'insert', payload?: Record<string, unknown>) => {
    if (table === 'notes') {
      return {
        data: {
          id: 'note-1', title: '数据与结论', content: state.noteContent, space_id: 'space-1', author_id: 'student-1',
          spaces: { id: 'space-1', course_id: 'course-1', group_id: 'group-1' },
        },
        error: null,
      };
    }
    if (table === 'teacher_ai_configs') {
      return {
        data: [{ provider_id: 'deepseek', api_key_encrypted: 'enc', endpoint_url: null, enabled_models: [], configured_at: '2026-09-01T00:00:00Z', trigger_settings: state.triggerSettings }],
        error: null,
      };
    }
    if (table === 'note_ai_feedbacks' && action === 'insert') {
      return { data: { id: 'fb-new', created_at: '2026-10-05T00:00:00Z', status: 'new', ...payload }, error: null };
    }
    // 冷却查询、计数：都当没有
    return { data: null, error: null, count: 0 };
  };

  const from = (table: string) => {
    let action: 'select' | 'insert' = 'select';
    let payload: Record<string, unknown> | undefined;
    const run = () => Promise.resolve(resultFor(table, action, payload));
    const builder: Record<string, unknown> = {
      insert: (p: Record<string, unknown>) => {
        action = 'insert';
        payload = p;
        state.inserts.push({ table, payload: p });
        return builder;
      },
      single: run,
      maybeSingle: run,
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    };
    for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit', 'gte', 'in']) builder[m] = () => builder;
    return builder;
  };

  const llmJson = (need: 0 | 1, type: string) => JSON.stringify({
    need, type, rationale: 'r',
    feedback: need ? '你提出了清楚的结论。还缺一条支撑它的依据。能补一个具体的例子吗？' : '',
    scaffold: need ? '支持这一点的依据是' : '',
    title: need ? '数据量与结论的可靠性' : '',
  });

  return {
    state,
    from,
    llmJson,
    /** 返回大模型这一轮的原文；抛错 = 调用失败 */
    llm: vi.fn((): string => llmJson(1, 'T3')),
    aiFetch: vi.fn(),
    askJev: vi.fn(),
    resolveEffectiveCondition: vi.fn(async () => ({ condition: 'treatment', groupId: 'group-1', experimentMode: true })),
    logSuppressedIntervention: vi.fn(async () => {}),
  };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
}));
vi.mock('../services/experimentCondition', () => ({
  resolveEffectiveCondition: h.resolveEffectiveCondition,
  logSuppressedIntervention: h.logSuppressedIntervention,
}));
vi.mock('../services/aiGateway', () => ({ aiFetch: h.aiFetch }));
vi.mock('../services/aiProviderConfig', () => ({
  decryptProviderApiKey: () => 'sk-test',
  withFastChatOptions: (_provider: string, _model: string, body: unknown) => body,
}));
vi.mock('../services/modelRouter', () => ({
  isDmxProvider: () => false,
  pickModels: () => [],
  pickNativeModel: () => 'deepseek-chat',
  orderConfigsByHealth: (configs: unknown[]) => configs,
  reportModelFailure: () => {},
  reportModelSuccess: () => {},
  reportProviderFailure: () => {},
  reportProviderSuccess: () => {},
  classifyHttpFailure: () => 'other',
}));
vi.mock('../services/accessControl', () => ({
  ensureCourseInstructor: vi.fn(async () => {}),
  ensureSpaceAccess: vi.fn(async (_spaceId: string, user: { id: string }) => ({
    id: 'space-1', course_id: 'course-1', group_id: 'group-1', standing: user.id.startsWith('teacher') ? 'owner' : 'member',
  })),
  isCourseStaff: (standing: string | undefined) => standing === 'owner' || standing === 'manager',
}));
vi.mock('../config/jev', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/jev')>();
  return { ...actual, jevConfig: () => actual.readJevConfig(h.state.env as NodeJS.ProcessEnv) };
});
vi.mock('../services/jevClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/jevClient')>();
  return { ...actual, askJev: h.askJev };
});

import noteAiFeedbackRouter from './noteAiFeedback';
import { errorHandler } from '../middleware/errorHandler';
import { JevError } from '../services/jevClient';
import { clearJevFeedbackCacheForTests } from '../services/feedbackJev';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', noteAiFeedbackRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

function jevAnswers(need: number, promising: number, type: string) {
  const probabilities = Object.fromEntries(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map(code => [code, code === type ? 0.8 : 0.04]));
  return {
    model: 'jev-1.13.0',
    answers: {
      need: { type: 'noul', noul: need },
      promising: { type: 'noul', noul: promising },
      type: { type: 'choice', choice: type, confidence: 0.8, probabilities },
    },
    usage: { inputTokens: 1400, outputTokens: 0 },
    latencyMs: 380,
  };
}

beforeEach(() => {
  h.state.user = { id: 'student-1', role: 'student' };
  h.state.triggerSettings = {};
  h.state.inserts.length = 0;
  h.state.env = {};
  h.state.noteContent = DRAFT;
  clearJevFeedbackCacheForTests();
  h.llm.mockReset();
  h.llm.mockImplementation(() => h.llmJson(1, 'T3'));
  h.aiFetch.mockReset();
  h.aiFetch.mockImplementation(async () => {
    try {
      const content = h.llm();
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }), text: async () => '' };
    } catch {
      return { ok: false, json: async () => ({}), text: async () => 'upstream 500' };
    }
  });
  h.askJev.mockReset();
  h.askJev.mockResolvedValue(jevAnswers(0.8, 0.1, 'T3'));
  h.resolveEffectiveCondition.mockResolvedValue({ condition: 'treatment', groupId: 'group-1', experimentMode: true });
});

// 够长、能过预筛；带「我觉得」——关键词规则看到它就判 T6
const DRAFT = '<p>我觉得数据越多，模型得出的结论就一定越可靠，所以以后做任何判断只要把数据量堆上去就行了，这个道理对所有问题都成立。</p>';

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};
const check = (content = DRAFT) => post('/notes/note-1/ai-feedback/check', { content });
const inserted = (table: string) => h.state.inserts.filter(i => i.table === table).map(i => i.payload);
const checkRows = () => inserted('feedback_trigger_checks');
const systemPrompt = (call = 0) => {
  const init = h.aiFetch.mock.calls[call]?.[1] as { body: string } | undefined;
  return init ? (JSON.parse(init.body).messages[0].content as string) : '';
};
const shadow = () => { h.state.env = { JEV_API_KEY: 'k', JEV_FEEDBACK_MODE: 'shadow' }; };
const gate = () => { h.state.env = { JEV_API_KEY: 'k', JEV_FEEDBACK_MODE: 'gate' }; };

describe('模型说「不要」就是不要（以前关键词规则会把它推翻）', () => {
  it('模型 need=0：不出反馈，哪怕笔记里有「我觉得」；检查记成 silent、由大模型决定', async () => {
    h.llm.mockImplementation(() => h.llmJson(0, ''));
    const { status, body } = await check();
    expect(status).toBe(200);
    expect(body).toEqual({ triggered: false, reason: 'no_trigger' });
    expect(inserted('note_ai_feedbacks')).toHaveLength(0);
    expect(checkRows()).toEqual([expect.objectContaining({ chain: 'editor_inline', outcome: 'silent', decided_by: 'llm', llm_need: false, jev_mode: 'off' })]);
  });

  it('模型全部调用失败：才用关键词规则兜底，检查记 regex_fallback', async () => {
    h.llm.mockImplementation(() => { throw new Error('500'); });
    const { status, body } = await check();
    expect(status).toBe(201);
    expect(body.feedback.triggerType).toBe('unclear');
    expect(body.feedback.triggerContext.detection_method).toBe('regex_fallback');
    expect(checkRows()).toEqual([expect.objectContaining({ outcome: 'triggered', decided_by: 'regex_fallback', llm_need: null, feedback_id: 'fb-new' })]);
  });

  it('调用失败、关键词也没命中：不出反馈，检查记 failed', async () => {
    h.llm.mockImplementation(() => { throw new Error('500'); });
    const { body } = await check('<p>数据量和结论可靠性之间的关系值得讨论，样本的代表性同样重要，两者缺一不可，需要放在一起考虑才行，这里先记下来。</p>');
    expect(body).toEqual({ triggered: false, reason: 'no_trigger' });
    expect(checkRows()).toEqual([expect.objectContaining({ outcome: 'failed', decided_by: 'none' })]);
  });
});

describe('shadow：大模型照常决定，Jev 陪跑只记录', () => {
  it('Jev 只拿到标题和正文；它的判断进 trigger_context.jev 和检查表', async () => {
    shadow();
    const { status, body } = await check();
    expect(status).toBe(201);
    const [state, questions] = h.askJev.mock.calls[0] as [Record<string, string>, Record<string, unknown>];
    expect(state).toEqual({ title: '数据与结论', note: expect.stringContaining('数据越多') });
    expect(Object.keys(questions)).toEqual(['need', 'promising', 'type']);

    expect(body.feedback.triggerContext.detection_method).toBe('llm_t1t6');
    expect(body.feedback.triggerContext.jev).toMatchObject({ mode: 'shadow', need: true, type: 'T3', need_p: 0.8 });
    expect(checkRows()).toEqual([expect.objectContaining({
      outcome: 'triggered', decided_by: 'llm', llm_need: true, llm_type: 'T3',
      jev_mode: 'shadow', jev_need: true, jev_type: 'T3', jev_latency_ms: 380, jev_input_tokens: 1400,
    })]);
    // 提示词和接 Jev 之前一样，没有「已经定了」那一段
    expect(systemPrompt()).not.toContain('DECISION ALREADY MADE');
  });

  it('Jev 说不要、大模型说要：照大模型的，出反馈', async () => {
    shadow();
    h.askJev.mockResolvedValue(jevAnswers(0.1, 0.2, 'T2'));
    const { status } = await check();
    expect(status).toBe(201);
    expect(checkRows()[0]).toMatchObject({ decided_by: 'llm', llm_need: true, jev_need: false });
  });

  it('Jev 出错：反馈照常，检查表记下错误', async () => {
    shadow();
    h.askJev.mockRejectedValue(new JevError('timeout', 'no answer'));
    const { status } = await check();
    expect(status).toBe(201);
    expect(checkRows()[0]).toMatchObject({ jev_mode: 'shadow', jev_error: 'timeout', jev_need: null, decided_by: 'llm' });
  });

  it('教师设了「保守」：记下来的阈值高一档', async () => {
    shadow();
    h.state.triggerSettings = { sensitivity: 'conservative' };
    await check();
    expect(checkRows()[0].jev_thresholds).toEqual({ need: 0.65, promising: 0.8 });
  });
});

describe('gate：Jev 决定要不要、哪一类，大模型只写正文', () => {
  it('Jev 说不要：不调大模型', async () => {
    gate();
    h.askJev.mockResolvedValue(jevAnswers(0.1, 0.2, 'T2'));
    const { body } = await check();
    expect(body).toEqual({ triggered: false, reason: 'no_trigger' });
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(checkRows()).toEqual([expect.objectContaining({ outcome: 'silent', decided_by: 'jev', jev_need: false, llm_need: null })]);
  });

  it('Jev 说要（T2）：大模型按 T2 写，detection_method=jev', async () => {
    gate();
    h.askJev.mockResolvedValue(jevAnswers(0.9, 0.1, 'T2'));
    h.llm.mockImplementation(() => h.llmJson(1, 'T2'));
    const { status, body } = await check();
    expect(status).toBe(201);
    expect(systemPrompt()).toContain('DECISION ALREADY MADE');
    expect(systemPrompt()).toContain('type="T2"');
    expect(body.feedback.triggerType).toBe('no_reasoning');
    expect(body.feedback.triggerContext.detection_method).toBe('jev');
    expect(inserted('ai_interventions')[0].trigger_context).toMatchObject({ detection_method: 'jev' });
    expect(checkRows()[0]).toMatchObject({ outcome: 'triggered', decided_by: 'jev', jev_type: 'T2' });
  });

  it('好想法的概率够高、没有问题：定成 T5', async () => {
    gate();
    h.askJev.mockResolvedValue(jevAnswers(0.2, 0.85, 'T2'));
    await check();
    expect(systemPrompt()).toContain('type="T5"');
  });

  it('Jev 定的这一类教师关掉了：不调大模型', async () => {
    gate();
    h.askJev.mockResolvedValue(jevAnswers(0.9, 0.1, 'T2'));
    h.state.triggerSettings = { enabled_triggers: ['no_evidence', 'unclear'] };
    const { body } = await check();
    expect(body).toEqual({ triggered: false, reason: 'trigger_type_disabled' });
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(checkRows()[0]).toMatchObject({ outcome: 'type_disabled', decided_by: 'jev' });
  });

  it('Jev 说要、大模型写正文时坚持不要：不出反馈，记 llm_declined', async () => {
    gate();
    h.llm.mockImplementation(() => h.llmJson(0, ''));
    const { body } = await check();
    expect(body).toEqual({ triggered: false, reason: 'no_trigger' });
    expect(checkRows()[0]).toMatchObject({ outcome: 'llm_declined', decided_by: 'jev', llm_need: false, jev_need: true });
  });

  it('Jev 说要（T4）、大模型全失败：用 T4 的通用反馈，不走关键词规则', async () => {
    gate();
    h.askJev.mockResolvedValue(jevAnswers(0.9, 0.1, 'T4'));
    h.llm.mockImplementation(() => { throw new Error('500'); });
    const { status, body } = await check();
    expect(status).toBe(201);
    expect(body.feedback.triggerType).toBe('no_connection');
    expect(body.feedback.triggerContext.detection_method).toBe('jev');
  });

  it('Jev 出错：退回大模型判断', async () => {
    gate();
    h.askJev.mockRejectedValue(new JevError('rate_limit', '429'));
    const { status, body } = await check();
    expect(status).toBe(201);
    expect(systemPrompt()).not.toContain('DECISION ALREADY MADE');
    expect(body.feedback.triggerContext.detection_method).toBe('llm_t1t6');
    expect(checkRows()[0]).toMatchObject({ decided_by: 'llm', jev_mode: 'gate', jev_error: 'rate_limit' });
  });
});

describe('什么时候不调 Jev', () => {
  it('对照组：Jev 和大模型都不调，也不记检查', async () => {
    shadow();
    h.resolveEffectiveCondition.mockResolvedValue({ condition: 'control', groupId: 'group-1', experimentMode: true });
    const { body } = await check();
    expect(body).toEqual({ triggered: false, reason: 'no_trigger' });
    expect(h.askJev).not.toHaveBeenCalled();
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(checkRows()).toHaveLength(0);
  });

  it('没配 key：不调 Jev，检查照样记（jev_mode=off）', async () => {
    const { status } = await check();
    expect(status).toBe(201);
    expect(h.askJev).not.toHaveBeenCalled();
    expect(checkRows()[0]).toMatchObject({ jev_mode: 'off', decided_by: 'llm' });
  });
});

describe('学生主动要（/request）：一定给，Jev 只管类型', () => {
  const request = () => post('/notes/note-1/ai-feedback/request', { content: DRAFT });

  it('shadow：类型由大模型定，Jev 选的类型记下来', async () => {
    shadow();
    h.askJev.mockResolvedValue(jevAnswers(0.2, 0.3, 'T6'));
    const { status, body } = await request();
    expect(status).toBe(201);
    expect(body.feedback.triggerType).toBe('no_evidence');
    expect(body.feedback.triggerContext).toMatchObject({ detection_method: 'student_request', jev: { type: 'T6', need: false } });
    expect(checkRows()[0]).toMatchObject({ chain: 'editor_request', outcome: 'triggered', decided_by: 'llm', jev_type: 'T6' });
  });

  it('gate：Jev 定类型，哪怕它觉得没问题也照样给；大模型失败用这一类的通用反馈', async () => {
    gate();
    h.askJev.mockResolvedValue(jevAnswers(0.1, 0.2, 'T6'));
    h.llm.mockImplementation(() => { throw new Error('500'); });
    const { status, body } = await request();
    expect(status).toBe(201);
    expect(systemPrompt()).toContain('type="T6"');
    expect(systemPrompt()).not.toContain('Pick the type that best fits');
    expect(body.feedback.triggerType).toBe('unclear');
    expect(body.feedback.triggerContext.type_decided_by).toBe('jev');
    expect(checkRows()[0]).toMatchObject({ decided_by: 'jev' });
  });
});

describe('教师批量', () => {
  const batch = () => post('/courses/course-1/ai-feedback/batch', { note_ids: ['note-1'] });
  beforeEach(() => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
  });

  it('gate、Jev 说不要：这条跳过，不调大模型', async () => {
    gate();
    h.askJev.mockResolvedValue(jevAnswers(0.2, 0.3, 'T2'));
    const { body } = await batch();
    expect(body.results).toEqual([{ noteId: 'note-1', triggered: false }]);
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(checkRows()[0]).toMatchObject({ chain: 'teacher_batch', outcome: 'silent', decided_by: 'jev', user_id: 'teacher-1' });
  });

  it('shadow：按「积极」的门槛记 Jev 的判断，反馈照大模型的出', async () => {
    shadow();
    const { body } = await batch();
    expect(body.results[0].triggered).toBe(true);
    expect(checkRows()[0]).toMatchObject({ chain: 'teacher_batch', outcome: 'triggered', decided_by: 'llm', jev_thresholds: { need: 0.35, promising: 0.6 } });
    expect(inserted('note_ai_feedbacks')[0].trigger_context).toMatchObject({ detection_method: 'teacher_batch', jev: { mode: 'shadow' } });
  });
});
