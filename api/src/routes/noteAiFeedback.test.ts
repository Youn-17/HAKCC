import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 群随机实验的对照组既不能拿到 AI 反馈卡，也不能拿到随卡生成的 AI 支架。
 * /check 早有门控，编辑器「请求反馈」走的 /request 却直接调模型、写 note_ai_feedbacks，
 * 对照组学生点一下就拿到了卡和支架。这里把整个路由挂在真实的 Express 上跑，
 * 只替换数据库、鉴权、实验条件和模型网关。
 */

const h = vi.hoisted(() => {
  const state = {
    user: { id: 'student-1', role: 'student' },
    spaceGroupId: 'group-1' as string | null,
    noteContent: '',
    storedFeedback: [] as Record<string, unknown>[],
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    updates: [] as { table: string; payload: Record<string, unknown> }[],
    filters: [] as { table: string; col: string; value: unknown }[],
  };

  // 课内身份：teacher-1 是创建者，teacher-3 是课程管理员；其余（含 teacher-2 这个
  // 凭学生验证码入课的教师账号）都是普通成员
  const STANDING: Record<string, 'owner' | 'manager' | 'member'> = { 'teacher-1': 'owner', 'teacher-3': 'manager' };

  type Action = 'select' | 'insert' | 'update';
  const resultFor = (table: string, action: Action, payload?: Record<string, unknown>) => {
    if (table === 'notes') {
      return {
        data: {
          id: 'note-1', title: '数据与结论', content: state.noteContent, space_id: 'space-1', author_id: state.user.id,
          spaces: { id: 'space-1', course_id: 'course-1', group_id: state.spaceGroupId },
        },
        error: null,
        count: 4,
      };
    }
    if (table === 'relations') return { data: null, error: null, count: 0 };
    if (table === 'courses') return { data: { instructor_id: 'teacher-1' }, error: null };
    if (table === 'course_members') return { data: { course_id: 'course-1' }, error: null };
    if (table === 'teacher_ai_configs') {
      return {
        data: [{ provider_id: 'deepseek', api_key_encrypted: 'enc', endpoint_url: null, enabled_models: [], configured_at: '2026-09-01T00:00:00Z', trigger_settings: {} }],
        error: null,
      };
    }
    if (table === 'note_ai_feedbacks') {
      if (action === 'insert') return { data: { id: 'fb-new', created_at: '2026-09-28T00:00:00Z', ...payload }, error: null };
      if (action === 'update') return { data: { ...state.storedFeedback[0], ...payload }, error: null };
      return { data: state.storedFeedback, error: null, count: 0 };
    }
    return { data: null, error: null };
  };

  // 链式调用照单全收，await / single / maybeSingle 时按表名和动作给结果
  const from = (table: string) => {
    let action: Action = 'select';
    let payload: Record<string, unknown> | undefined;
    const run = () => Promise.resolve(resultFor(table, action, payload));
    const builder: Record<string, unknown> = {
      insert: (p: Record<string, unknown>) => {
        action = 'insert';
        payload = p;
        state.inserts.push({ table, payload: p });
        return builder;
      },
      update: (p: Record<string, unknown>) => {
        action = 'update';
        payload = p;
        state.updates.push({ table, payload: p });
        return builder;
      },
      eq: (col: string, value: unknown) => {
        state.filters.push({ table, col, value });
        return builder;
      },
      single: run,
      maybeSingle: run,
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    };
    for (const m of ['select', 'is', 'not', 'order', 'limit', 'gte', 'in']) builder[m] = () => builder;
    return builder;
  };

  const llmReply = JSON.stringify({
    need: 1,
    type: 'T3',
    rationale: 'claim without support',
    feedback: '你提出了清楚的结论。还缺一条支撑它的依据。能补一个具体的例子吗？',
    scaffold: '支持这一点的依据是',
  });

  return {
    state,
    from,
    aiFetch: vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: llmReply } }] }),
      text: async () => '',
    })),
    resolveEffectiveCondition: vi.fn(),
    logSuppressedIntervention: vi.fn(async () => {}),
    ensureCourseInstructor: vi.fn(async () => {}),
    ensureSpaceAccess: vi.fn(async (_spaceId: string, user: { id: string }) => ({
      id: 'space-1', course_id: 'course-1', group_id: state.spaceGroupId, instructor_id: 'teacher-1',
      standing: STANDING[user.id] ?? 'member',
    })),
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
  ensureCourseInstructor: h.ensureCourseInstructor,
  ensureSpaceAccess: h.ensureSpaceAccess,
  isCourseStaff: (standing: string | undefined) => standing === 'owner' || standing === 'manager',
}));

import noteAiFeedbackRouter from './noteAiFeedback';
import { ApiError, errorHandler } from '../middleware/errorHandler';

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

beforeEach(() => {
  h.state.user = { id: 'student-1', role: 'student' };
  h.state.spaceGroupId = 'group-1';
  h.state.noteContent = '';
  h.state.storedFeedback = [];
  h.state.inserts.length = 0;
  h.state.updates.length = 0;
  h.state.filters.length = 0;
  h.aiFetch.mockClear();
  h.resolveEffectiveCondition.mockReset();
  h.logSuppressedIntervention.mockClear();
  // 恢复成默认放行
  h.ensureCourseInstructor.mockReset();
  h.ensureSpaceAccess.mockReset();
});

// 够长、能过 /check 预筛的中文草稿
const DRAFT = '<p>我认为数据越多，模型得出的结论就一定越可靠，所以以后做任何判断只要把数据量堆上去就行了，这个道理对所有问题都成立。</p>';
const NO_TRIGGER = { triggered: false, reason: 'no_trigger' };

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const requestFeedback = (content = DRAFT) => call('POST', '/notes/note-1/ai-feedback/request', { content });
const feedbackInserts = () => h.state.inserts.filter(i => i.table === 'note_ai_feedbacks');
const assign = (condition: 'treatment' | 'control' | null, experimentMode = true) =>
  h.resolveEffectiveCondition.mockResolvedValue({ condition, groupId: condition ? 'group-1' : null, experimentMode });

describe('POST /notes/:noteId/ai-feedback/request 的实验门控', () => {
  it('对照组：不调模型、不写反馈行、不给支架，只记一条影子', async () => {
    assign('control');
    const { status, body } = await requestFeedback();

    expect(status).toBe(200);
    expect(body).toEqual(NO_TRIGGER);
    expect(h.resolveEffectiveCondition).toHaveBeenCalledWith('course-1', 'student-1');
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(feedbackInserts()).toHaveLength(0);
    expect(h.logSuppressedIntervention).toHaveBeenCalledTimes(1);
    expect(h.logSuppressedIntervention).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: 'space-1',
      noteId: 'note-1',
      userId: 'student-1',
      groupId: 'group-1',
      triggerType: 'requested_feedback',
      triggerContext: expect.objectContaining({ chain: 'editor_request', detection_method: 'student_request' }),
    }));
  });

  it('对照组拿到的回应和 /check 对照组的回应逐字相同', async () => {
    assign('control');
    const viaRequest = await requestFeedback();
    const viaCheck = await call('POST', '/notes/note-1/ai-feedback/check', { content: DRAFT });
    expect(viaRequest).toEqual(viaCheck);
  });

  it('影子记录落库时是 suppressed=true、condition=control，且和自动链路 editor_inline 分得开', async () => {
    assign('control');
    await requestFeedback();
    const real = await vi.importActual<typeof import('../services/experimentCondition')>('../services/experimentCondition');
    await real.logSuppressedIntervention(h.logSuppressedIntervention.mock.calls[0][0]);

    const row = h.state.inserts.find(i => i.table === 'ai_interventions')?.payload;
    expect(row).toMatchObject({
      suppressed: true,
      group_id: 'group-1',
      trigger_type: 'requested_feedback',
      trigger_context: { condition: 'control', chain: 'editor_request', detection_method: 'student_request' },
    });
  });

  it.each([
    ['实验组', 'treatment' as const, true, 'group-1'],
    ['非实验课程的共享空间', null, false, null],
  ])('%s：行为不变，照常生成反馈卡和 AI 支架', async (_label, condition, experimentMode, spaceGroupId) => {
    h.state.spaceGroupId = spaceGroupId;
    assign(condition, experimentMode);
    const { status, body } = await requestFeedback();

    expect(status).toBe(201);
    expect(body.triggered).toBe(true);
    expect(body.feedback.suggestedScaffold).toBe('支持这一点的依据是');
    expect(body.feedback.triggerContext.detection_method).toBe('student_request');
    expect(feedbackInserts()).toHaveLength(1);
    expect(h.aiFetch).toHaveBeenCalledTimes(1);
    expect(h.logSuppressedIntervention).not.toHaveBeenCalled();
  });

  it('实验模式下未绑小组的空间谁都不投递，和 /check 一致，也不记影子', async () => {
    h.state.spaceGroupId = null;
    assign('treatment');
    const { status, body } = await requestFeedback();

    expect(status).toBe(200);
    expect(body).toEqual(NO_TRIGGER);
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(feedbackInserts()).toHaveLength(0);
    expect(h.logSuppressedIntervention).not.toHaveBeenCalled();
  });

  it('草稿太短时两组都是 too_short，不算一次被压下的请求', async () => {
    assign('control');
    const { body } = await requestFeedback('<p>还没想好</p>');
    expect(body).toEqual({ triggered: false, reason: 'too_short' });
    expect(h.logSuppressedIntervention).not.toHaveBeenCalled();
  });
});

describe('AI 支架不会从其他反馈接口流到对照组学生手里', () => {
  // 分组前（基线周）生成、尚未处理的反馈：支架选择器会一直把它的支架摆在最上面
  const STORED = {
    id: 'fb-old', note_id: 'note-1', space_id: 'space-1', course_id: 'course-1', user_id: 'student-1',
    provider_id: 'deepseek', model: 'deepseek-chat', trigger_type: 'no_evidence', trigger_context: {},
    draft_excerpt: '', feedback_text: '分组前收到的反馈', status: 'new', created_at: '2026-09-15T00:00:00Z',
    suggested_scaffold: '支持这一点的依据是', suggested_scaffold_used_at: null,
  };

  beforeEach(() => {
    h.state.storedFeedback = [STORED];
  });

  it('GET：对照组学生读到的反馈没有 AI 支架，卡片本身照旧', async () => {
    assign('control');
    const { body } = await call('GET', '/notes/note-1/ai-feedback');
    expect(body.feedbacks).toHaveLength(1);
    expect(body.feedbacks[0].feedbackText).toBe('分组前收到的反馈');
    expect(body.feedbacks[0].suggestedScaffold).toBeNull();
  });

  it('GET：实验组学生照常看到支架', async () => {
    assign('treatment');
    const { body } = await call('GET', '/notes/note-1/ai-feedback');
    expect(body.feedbacks[0].suggestedScaffold).toBe('支持这一点的依据是');
  });

  it('GET：教师不是被试，按默认规则算作对照也照常看到', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    assign('control');
    const { body } = await call('GET', '/notes/note-1/ai-feedback');
    expect(body.feedbacks[0].suggestedScaffold).toBe('支持这一点的依据是');
  });

  it('respond 和 scaffold-used 返回给对照组学生的反馈行同样不带支架', async () => {
    assign('control');
    const responded = await call('POST', '/notes/note-1/ai-feedback/fb-old/respond', { status: 'ignored' });
    const used = await call('POST', '/notes/note-1/ai-feedback/fb-old/scaffold-used', {});
    expect(responded.status).toBe(200);
    expect(responded.body.feedback.suggestedScaffold).toBeNull();
    expect(used.status).toBe(200);
    expect(used.body.feedback.suggestedScaffold).toBeNull();
  });
});

describe('绑定小组的空间只对本组开放：按笔记寻址的路由先过 ensureSpaceAccess', () => {
  // 调用者是组 A 的学生，note-1 在组 B 的空间里。只查课程成员时，下面这些请求全部放行
  const denySpace = () =>
    h.ensureSpaceAccess.mockRejectedValue(new ApiError(403, 'This space belongs to another group'));

  beforeEach(() => {
    assign('treatment');
    h.state.noteContent = DRAFT;
    h.state.storedFeedback = [{
      id: 'fb-old', note_id: 'note-1', space_id: 'space-1', course_id: 'course-1', user_id: 'student-1',
      trigger_type: 'no_evidence', trigger_context: {}, draft_excerpt: '', feedback_text: '别组笔记上的反馈',
      status: 'new', created_at: '2026-09-28T00:00:00Z', suggested_scaffold: '支持这一点的依据是',
    }];
  });

  it('/request 不带 content 时读的是存储正文：组外学生拿不到摘录，不调模型，不写反馈行', async () => {
    denySpace();
    const { status, body } = await call('POST', '/notes/note-1/ai-feedback/request', {});

    expect([403, 404]).toContain(status);
    expect(JSON.stringify(body)).not.toContain('数据越多');
    expect(h.ensureSpaceAccess).toHaveBeenCalledWith('space-1', expect.objectContaining({ id: 'student-1', role: 'student' }));
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(feedbackInserts()).toHaveLength(0);
  });

  const NOTE_ROUTES: [method: 'GET' | 'POST', path: string, body?: unknown][] = [
    ['GET', '/notes/note-1/ai-feedback'],
    ['POST', '/notes/note-1/ai-feedback/request', { content: DRAFT }],
    ['POST', '/notes/note-1/ai-feedback/check', { content: DRAFT }],
    ['POST', '/notes/note-1/ai-feedback/fb-old/respond', { status: 'accepted' }],
    ['POST', '/notes/note-1/ai-feedback/fb-old/scaffold-used', {}],
    ['POST', '/notes/note-1/ai-insertions', { selected_text: '数据越多', inserted_html: '<p>数据越多</p>', reason_tag: 'agree' }],
  ];

  it.each(NOTE_ROUTES)('%s %s：403，不读不写、不调模型', async (method, path, body) => {
    denySpace();
    const res = await call(method, path, body);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'This space belongs to another group' });
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(h.state.inserts).toEqual([]);
    expect(h.state.updates).toEqual([]);
  });

  it('教师账号同样按空间判定：进不了别组的空间就是 403', async () => {
    h.state.user = { id: 'teacher-2', role: 'teacher' };
    denySpace();
    const { status } = await call('GET', '/notes/note-1/ai-feedback');

    expect(status).toBe(403);
    expect(h.ensureSpaceAccess).toHaveBeenCalledWith('space-1', expect.objectContaining({ id: 'teacher-2' }));
    expect(h.ensureCourseInstructor).not.toHaveBeenCalled();
  });

  it('以后新加的 /notes/:noteId 路由，取到笔记后的第一件事也必须是授权', () => {
    const src = readFileSync(resolve(__dirname, 'noteAiFeedback.ts'), 'utf-8');
    const handlers = src.split(/\nrouter\.(?=get|post|put|patch|delete)/).slice(1);
    const byNote = handlers.filter(chunk => /^\w+\('\/notes\/:noteId/.test(chunk));
    expect(byNote.length).toBeGreaterThanOrEqual(NOTE_ROUTES.length);

    const unguarded = byNote
      .filter(chunk => {
        const firstAwaits = [...chunk.matchAll(/await (\w+)\(/g)].slice(0, 2).map(m => m[1]);
        return firstAwaits.join() !== 'getNoteContext,requireNoteAccess';
      })
      .map(chunk => chunk.slice(0, chunk.indexOf(',')));
    expect(unguarded).toEqual([]);
  });
});

/**
 * 教师账号凭学生验证码入课，在这门课里是被试。原先这些路由对教师账号一律走
 * ensureCourseInstructor，这样的人用不了任何 AI 反馈（403）；改成按课内身份放行以后，
 * 下游原先看 req.user.role 的地方必须跟着改，否则他会看到全笔记的反馈、对照组也拿到支架。
 */
describe('按课内身份区分教职和被试，不看平台身份', () => {
  beforeEach(() => {
    h.state.storedFeedback = [{
      id: 'fb-old', note_id: 'note-1', space_id: 'space-1', course_id: 'course-1', user_id: 'student-1',
      trigger_type: 'no_evidence', trigger_context: {}, draft_excerpt: '', feedback_text: '同学收到的反馈',
      status: 'new', created_at: '2026-09-15T00:00:00Z', suggested_scaffold: '支持这一点的依据是',
    }];
  });

  const feedbackFilters = () => h.state.filters.filter(f => f.table === 'note_ai_feedbacks' && f.col === 'user_id');

  it('凭学生验证码入课的教师账号能用了，但只看自己的反馈，对照组照样没有支架', async () => {
    h.state.user = { id: 'teacher-2', role: 'teacher' };
    assign('control');
    const { status, body } = await call('GET', '/notes/note-1/ai-feedback');

    expect(status).toBe(200);
    expect(h.ensureCourseInstructor).not.toHaveBeenCalled();
    expect(feedbackFilters()).toEqual([{ table: 'note_ai_feedbacks', col: 'user_id', value: 'teacher-2' }]);
    expect(body.feedbacks[0].suggestedScaffold).toBeNull();
  });

  it('课程管理员看这条笔记上每个人的反馈，不是被试，支架照常', async () => {
    h.state.user = { id: 'teacher-3', role: 'teacher' };
    assign('control');
    const { body } = await call('GET', '/notes/note-1/ai-feedback');

    expect(feedbackFilters()).toEqual([]);
    expect(body.feedbacks[0].suggestedScaffold).toBe('支持这一点的依据是');
  });

  it('被试回应 AI 反馈会通知授课教师，课程教职回应不会', async () => {
    assign('treatment');
    const respond = () => call('POST', '/notes/note-1/ai-feedback/fb-old/respond', { status: 'rejected', rejection_tag: 'off_track' });
    const notified = () => h.state.inserts.filter(i => i.table === 'notifications');

    h.state.user = { id: 'teacher-2', role: 'teacher' };
    expect((await respond()).status).toBe(200);
    expect(notified()).toHaveLength(1);
    expect(notified()[0].payload).toMatchObject({ user_id: 'teacher-1', type: 'ai_feedback_response' });

    h.state.inserts.length = 0;
    h.state.user = { id: 'teacher-3', role: 'teacher' };
    expect((await respond()).status).toBe(200);
    expect(notified()).toHaveLength(0);
  });

  it('按笔记寻址的路由和支架门控，都不再按平台身份区分教职', () => {
    const src = readFileSync(resolve(__dirname, 'noteAiFeedback.ts'), 'utf-8');
    const noteRoutes = src.split(/\nrouter\.(?=get|post|put|patch|delete)/).slice(1)
      .filter(chunk => /^\w+\('\/notes\/:noteId/.test(chunk));
    const byPlatformRole = noteRoutes
      .filter(chunk => /req\.user!?\??\.role\s*[!=]==/.test(chunk))
      .map(chunk => chunk.slice(0, chunk.indexOf(',')));
    expect(byPlatformRole).toEqual([]);
    const scaffoldGate = src.slice(src.indexOf('async function hidesAiScaffold'), src.indexOf('async function logEvent'));
    expect(scaffoldGate).not.toMatch(/\.role\b/);
  });
});

describe('门控的结构约束', () => {
  it('每个会调用反馈模型的路由，都在调用之前解析实验条件', () => {
    const src = readFileSync(resolve(__dirname, 'noteAiFeedback.ts'), 'utf-8');
    const handlers = src.split(/\nrouter\.(?=get|post|put|patch|delete)/).slice(1);
    const callingModel = handlers.filter(chunk => chunk.includes('detectAndGenerateFeedback('));
    expect(callingModel.length).toBeGreaterThanOrEqual(3);

    const ungated = callingModel
      .filter(chunk => {
        const gate = chunk.indexOf('resolveEffectiveCondition(');
        return gate === -1 || gate > chunk.indexOf('detectAndGenerateFeedback(');
      })
      .map(chunk => chunk.slice(0, chunk.indexOf(',')));
    expect(ungated).toEqual([]);
  });
});
