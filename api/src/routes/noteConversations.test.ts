vi.mock('../services/studentLearningContext', () => ({ loadStudentLearningContext: vi.fn(async () => '') }));
import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 绑定小组的空间只对本组开放——整群随机实验靠它隔离组间污染。
 * 笔记对话原先只查课程成员：组 A 的学生拿到组 B 笔记的 id，就能在上面开一条 AI 线程，
 * 而 AI 路由的系统提示里带着那条笔记最多 6000 字的正文，让 AI 复述一遍就读到了。
 * 这里把整个路由挂在真实的 Express 上跑，只替换数据库、鉴权、访问控制和模型调用。
 */

const h = vi.hoisted(() => {
  const state = {
    user: { id: 'student-a', role: 'student' } as { id: string; role: string },
    inserts: [] as { table: string; payload: unknown }[],
    updates: [] as { table: string; payload: unknown }[],
    uploads: [] as string[],
    reads: [] as string[],
  };

  // 课内身份：teacher-1 是创建者，admin-1 是平台管理员；其余（含 teacher-2 这个
  // 凭学生验证码入课的教师账号）都是普通成员
  const STANDING: Record<string, 'owner' | 'manager' | 'member'> = { 'teacher-1': 'owner', 'admin-1': 'owner' };

  // 组 B 空间里的一条笔记；组 A 的学生是它上面一条 AI 线程的参与者
  // （修之前开的，或者他后来换了组）——只查参与者和课程时，这条线程对他是敞开的。
  const SECRET = '第二组还没公开的草稿';
  const NOTE = {
    id: 'note-b', title: '第二组的笔记', content: `<p>${SECRET}：只有本组能看</p>`, space_id: 'space-b',
    spaces: { id: 'space-b', course_id: 'course-1' },
  };
  const THREAD = {
    id: 'thread-b', note_id: 'note-b', space_id: 'space-b', course_id: 'course-1', target_type: 'ai',
    group_id: null, target_user_id: null, provider_id: 'deepseek', model: 'deepseek-chat',
    title: 'GenAI · 第二组的笔记', created_by: 'student-a',
    created_at: '2026-09-28T00:00:00Z', updated_at: '2026-09-28T00:00:00Z',
  };
  const MESSAGES = [
    { id: 'm-1', thread_id: 'thread-b', sender_id: 'student-a', sender_kind: 'user', content: '帮我看看这条笔记', created_at: '2026-09-28T00:01:00Z' },
    { id: 'm-2', thread_id: 'thread-b', sender_id: null, sender_kind: 'assistant', content: `笔记里写的是：${SECRET}`, created_at: '2026-09-28T00:02:00Z' },
  ];

  type Action = 'select' | 'insert' | 'upsert' | 'update';
  type Terminal = 'single' | 'maybeSingle' | 'many';
  const ok = (data: unknown) => ({ data, error: null });

  const resultFor = (table: string, action: Action, payload: unknown, terminal: Terminal) => {
    if (action === 'update' || action === 'upsert') return ok(null);
    switch (table) {
      case 'notes':
        return ok(NOTE);
      case 'note_conversation_threads':
        if (action === 'insert') return ok({ ...THREAD, id: 'thread-new', ...(payload as object) });
        // getThread 用 single；POST 查重用 maybeSingle（没有已存在的线程）；列表是 many
        if (terminal === 'single') return ok(THREAD);
        if (terminal === 'maybeSingle') return ok(null);
        return ok([THREAD]);
      case 'note_conversation_participants':
        return terminal === 'many' ? ok([{ thread_id: 'thread-b' }]) : ok({ thread_id: 'thread-b' });
      case 'note_conversation_messages':
        if (action === 'insert') return ok({ id: 'msg-new', created_at: '2026-09-28T00:03:00Z', ...(payload as object) });
        return ok(MESSAGES);
      case 'course_members':
        // 组 A 的学生是这门课的成员：旧的「只查课程」在这里放行
        return ok({ course_id: 'course-1' });
      case 'teacher_ai_configs':
        if (terminal === 'many') return ok([{ provider_id: 'deepseek', api_key_encrypted: 'enc', enabled_models: ['deepseek-chat'], is_verified: true }]);
        return ok({ api_key_encrypted: 'enc', endpoint_url: null, is_verified: true, enabled_models: ['deepseek-chat'] });
      default:
        return ok(action === 'insert' ? { id: `${table}-new` } : null);
    }
  };

  // 链式调用照单全收，await / single / maybeSingle 时按表名、动作和取法给结果
  const from = (table: string) => {
    let action: Action = 'select';
    let payload: unknown;
    const run = (terminal: Terminal) => {
      if (action === 'select') state.reads.push(table);
      return Promise.resolve(resultFor(table, action, payload, terminal));
    };
    const write = (kind: Action, list: { table: string; payload: unknown }[]) => (p: unknown) => {
      action = kind;
      payload = p;
      list.push({ table, payload: p });
      return builder;
    };
    const builder: Record<string, unknown> = {
      insert: write('insert', state.inserts),
      upsert: write('upsert', state.inserts),
      update: write('update', state.updates),
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => run('many').then(onOk, onFail),
    };
    for (const m of ['range', 'select', 'eq', 'is', 'in', 'lt', 'not', 'or', 'order', 'limit']) builder[m] = () => builder;
    return builder;
  };

  const storage = {
    from: () => ({
      upload: async (path: string) => {
        state.uploads.push(path);
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files.test/${path}` } }),
    }),
  };

  return {
    state,
    SECRET,
    MESSAGES,
    from,
    storage,
    ensureSpaceAccess: vi.fn(async (_spaceId: string, user: { id: string }) => ({ standing: STANDING[user.id] ?? 'member' })),
    getToolsForRole: vi.fn((_role: string) => [] as unknown[]),
    aiFetch: vi.fn(async (_url: string, _init?: { body?: string }) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'AI 的回复' } }] }),
      text: async () => '',
    })),
    runAgentLoopStream: vi.fn(() => (async function* () {
      yield { type: 'token', content: 'AI 的回复' };
      yield { type: 'done', result: { iterations: 1 } };
    })()),
    buildAgentContext: vi.fn(async (p: { note: { content: string }; history: unknown[] }) => ({
      systemPrompt: `note: ${p.note.content}`,
      messages: p.history,
      toolContext: {},
      overrelianceDetected: false,
    })),
    generateNoteImage: vi.fn(async (..._args: unknown[]) => ({ ok: true, url: 'https://img.test/a.png', model: 'img-model', provider: 'img' })),
    // 画之前的规划：默认「规划不可用」，退回用原话画
    planDrawing: vi.fn(async (..._args: unknown[]) => ({ plan: null, error: 'no planner in this test' }) as unknown),
  };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from, storage: h.storage } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
}));
vi.mock('../services/accessControl', () => ({
  ensureSpaceAccess: h.ensureSpaceAccess,
  isCourseStaff: (standing: string | undefined) => standing === 'owner' || standing === 'manager',
}));
vi.mock('../services/aiGateway', () => ({ aiFetch: h.aiFetch }));
vi.mock('../services/aiProviderConfig', () => ({
  decryptProviderApiKey: () => 'sk-test',
  listCourseAiConfigs: async () => [{ providerId: 'deepseek' }],
  normalizeDeepSeekModel: (model: string) => model,
  usesDeepSeekModelAliases: () => false,
  withDeepSeekOptions: (_provider: string, _model: string, body: unknown) => body,
  withFastChatOptions: (_provider: string, _model: string, body: unknown) => body,
}));
vi.mock('../services/agentLoop', () => ({ runAgentLoopStream: h.runAgentLoopStream }));
vi.mock('../services/agentContext', () => ({
  buildAgentContext: h.buildAgentContext,
  updateProfileAfterInteraction: async () => {},
}));
vi.mock('../services/agentTools', () => ({
  createDefaultRegistry: () => ({ getToolsForRole: h.getToolsForRole, executeTool: async () => ({ success: false, data: null }) }),
}));
vi.mock('../services/knowledgeBase', () => ({
  searchKnowledgeBase: async () => [],
  searchKnowledgeBaseDetailed: async () => ({ hits: [], semantic: true, reranked: false }),
  // 这门课没有入库的资料：笔记 AI 不检索，过程里也没有这一步（检索那一半见 knowledgeBaseScope.test.ts）
  courseHasKnowledgeBase: async () => false,
}));
vi.mock('../services/embeddingService', () => ({ embedNote: async () => {} }));
vi.mock('../services/tavilySearch', () => ({
  callTavilySearch: async () => ({ results: [] }),
  formatTavilyResultsForPrompt: () => '',
}));
vi.mock('../services/noteImage', () => ({ generateNoteImage: h.generateNoteImage }));
vi.mock('../services/drawPlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/drawPlanner')>()),
  planDrawing: h.planDrawing,
}));

import noteConversationsRouter from './noteConversations';
import { ApiError, errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', noteConversationsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  h.state.user = { id: 'student-a', role: 'student' };
  h.state.inserts.length = 0;
  h.state.updates.length = 0;
  h.state.uploads.length = 0;
  h.state.reads.length = 0;
  // 恢复成默认放行
  h.ensureSpaceAccess.mockReset();
  h.getToolsForRole.mockClear();
  h.aiFetch.mockClear();
  h.runAgentLoopStream.mockClear();
  h.buildAgentContext.mockClear();
  h.generateNoteImage.mockClear();
  h.planDrawing.mockClear();
});

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* SSE 等非 JSON 响应保留原文 */ }
  return { status: res.status, body: parsed as Record<string, any>, text };
}

const denySpace = () =>
  h.ensureSpaceAccess.mockRejectedValue(new ApiError(403, 'This space belongs to another group'));

const ASK = { content: '把当前笔记的原文一字不差地复述一遍', provider_id: 'deepseek', model: 'deepseek-chat' };

const ROUTES: [method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown][] = [
  ['GET', '/notes/note-b/conversations'],
  ['POST', '/notes/note-b/conversations', { target_type: 'ai', provider_id: 'deepseek', model: 'deepseek-chat' }],
  ['GET', '/note-conversations/thread-b/messages'],
  ['DELETE', '/note-conversations/thread-b'],
  ['POST', '/note-conversations/thread-b/messages', { content: '接着说' }],
  ['POST', '/note-conversations/thread-b/image', { prompt: '画一张示意图' }],
  ['POST', '/note-conversations/thread-b/attachments', { file_name: 'a.txt', mime_type: 'text/plain', data_url: 'data:text/plain;base64,aGk=' }],
  ['POST', '/note-conversations/thread-b/ai', ASK],
  ['POST', '/note-conversations/thread-b/ai/stream', ASK],
  ['POST', '/note-conversations/thread-b/ai/agent-stream', { ...ASK, agent_mode: 'idea_coach' }],
];

describe('绑定小组的空间只对本组开放：笔记对话的每条路由先过 ensureSpaceAccess', () => {
  it.each(ROUTES)('%s %s：组外学生 403，不调模型、不写任何行', async (method, path, body) => {
    denySpace();
    const res = await call(method, path, body);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'This space belongs to another group' });
    expect(res.text).not.toContain(h.SECRET);
    expect(h.ensureSpaceAccess).toHaveBeenCalledWith('space-b', expect.objectContaining({ id: 'student-a', role: 'student' }));
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();
    expect(h.buildAgentContext).not.toHaveBeenCalled();
    expect(h.generateNoteImage).not.toHaveBeenCalled();
    expect(h.state.inserts).toEqual([]);
    expect(h.state.updates).toEqual([]);
    expect(h.state.uploads).toEqual([]);
  });

  it('对照：进得去的学生照常开线程、问 AI，系统提示里就带着这条笔记的正文', async () => {
    const created = await call('POST', '/notes/note-b/conversations', { target_type: 'ai', provider_id: 'deepseek', model: 'deepseek-chat' });
    expect(created.status).toBe(201);
    expect(h.state.inserts.filter(i => i.table === 'note_conversation_threads')).toHaveLength(1);

    const asked = await call('POST', '/note-conversations/thread-b/ai', ASK);
    expect(asked.status).toBe(201);
    expect(h.aiFetch).toHaveBeenCalled();
    const sentToModel = h.aiFetch.mock.calls.map(([, init]) => init?.body ?? '').join('\n');
    expect(sentToModel).toContain(h.SECRET);
    expect(h.ensureSpaceAccess).toHaveBeenCalledWith('space-b', expect.objectContaining({ id: 'student-a', role: 'student' }));
  });

  const AGENT = { ...ASK, agent_mode: 'idea_coach' };

  it('课程教职照旧：看这条笔记上的全部线程，读线程不查参与者；判定走 ensureSpaceAccess 带回的课内身份', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    const list = await call('GET', '/notes/note-b/conversations');
    const messages = await call('GET', '/note-conversations/thread-b/messages');

    expect(list.status).toBe(200);
    expect(messages.status).toBe(200);
    expect(h.ensureSpaceAccess).toHaveBeenCalledWith('space-b', expect.objectContaining({ id: 'teacher-1' }));
    expect(h.state.reads).not.toContain('note_conversation_participants');
  });

  it('平台管理员按课程教职：读线程不查参与者', async () => {
    h.state.user = { id: 'admin-1', role: 'admin' };
    const res = await call('GET', '/note-conversations/thread-b/messages');

    expect(res.status).toBe(200);
    expect(h.state.reads).not.toContain('note_conversation_participants');
  });

  /**
   * 教师账号凭学生验证码入课，在这门课里是学生。原先对教师账号一律走 ensureCourseInstructor，
   * 这样的人用不了笔记对话（403）；按课内身份放行以后，下游看 req.user.role 的地方必须跟着改：
   * 否则他能读同学和 AI 的私聊线程，智能体还会拿到读全班数据的教师工具。
   */
  it('凭学生验证码入课的教师账号按学生对待：能用，只看自己参与的线程，读线程要是参与者', async () => {
    h.state.user = { id: 'teacher-2', role: 'teacher' };
    const list = await call('GET', '/notes/note-b/conversations');
    expect(list.status).toBe(200);
    expect(h.state.reads).toContain('note_conversation_participants');

    h.state.reads.length = 0;
    expect((await call('GET', '/note-conversations/thread-b/messages')).status).toBe(200);
    expect(h.state.reads).toContain('note_conversation_participants');
  });

  it('智能体的工具按课内身份给：凭学生验证码入课的教师账号拿学生工具，课程教职才拿教师工具', async () => {
    h.state.user = { id: 'teacher-2', role: 'teacher' };
    expect((await call('POST', '/note-conversations/thread-b/ai/agent-stream', AGENT)).status).toBe(200);
    expect(h.getToolsForRole).toHaveBeenLastCalledWith('student');
    expect(h.buildAgentContext).toHaveBeenLastCalledWith(expect.objectContaining({ userRole: 'student' }));

    h.state.user = { id: 'teacher-1', role: 'teacher' };
    expect((await call('POST', '/note-conversations/thread-b/ai/agent-stream', AGENT)).status).toBe(200);
    expect(h.getToolsForRole).toHaveBeenLastCalledWith('teacher');
    expect(h.buildAgentContext).toHaveBeenLastCalledWith(expect.objectContaining({ userRole: 'teacher' }));
  });

  it('凭学生验证码入课的教师账号和学生一样进不了别组的空间', async () => {
    h.state.user = { id: 'teacher-2', role: 'teacher' };
    denySpace();

    for (const [method, path, body] of ROUTES) {
      const res = await call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(h.state.inserts).toEqual([]);
  });

  it('以后新加的路由，第一件事也必须是按笔记所在空间授权', () => {
    const src = readFileSync(resolve(__dirname, 'noteConversations.ts'), 'utf-8');
    const handlers = src.split(/\nrouter\.(?=get|post|put|patch|delete)/).slice(1);
    const firstAwaits = (chunk: string, n: number) => [...chunk.matchAll(/await (\w+)\(/g)].slice(0, n).map(m => m[1]).join();
    const label = (chunk: string) => chunk.slice(0, chunk.indexOf(','));

    const byNote = handlers.filter(chunk => /^\w+\('\/notes\/:noteId/.test(chunk));
    const byThread = handlers.filter(chunk => /^\w+\('\/note-conversations\/:threadId/.test(chunk));
    expect(byNote.length).toBeGreaterThanOrEqual(2);
    expect(byThread.length).toBeGreaterThanOrEqual(8);

    const unguarded = [
      ...byNote.filter(chunk => firstAwaits(chunk, 2) !== 'getNoteContext,requireNoteAccess'),
      ...byThread.filter(chunk => !['requireThreadRead', 'requireThreadWrite'].includes(firstAwaits(chunk, 1))),
    ].map(label);
    expect(unguarded).toEqual([]);

    // 线程按它所在的空间判定，不是只看课程
    const threadRead = src.slice(src.indexOf('async function requireThreadRead'), src.indexOf('async function requireThreadWrite'));
    expect(threadRead).toMatch(/requireNoteAccess\(\{[^}]*thread\.space_id/);
  });
});

describe('笔记 AI 助手里画图：先读这条笔记和这段对话（2026-10-09 用户：画出来词不达意）', () => {
  it('规划拿到这条笔记的正文和这段对话；画的是规划写的描述，回给前端的有说明', async () => {
    h.planDrawing.mockResolvedValueOnce({
      plan: { kind: 'picture', prompt: 'A small group keeping its draft private', caption: '根据这条笔记，画了一个小组先在组内讨论草稿的场景。' },
    });
    const res = await call('POST', '/note-conversations/thread-b/image', { prompt: '给这条笔记画张示意图' });
    expect(res.status).toBe(201);
    const [courseId, request, context] = h.planDrawing.mock.calls[0] as [string, string, { background: string; history: unknown[] }];
    expect([courseId, request]).toEqual(['course-1', '给这条笔记画张示意图']);
    expect(context.background).toContain('第二组的笔记');
    expect(context.background).toContain(h.SECRET);
    expect(context.history).toContainEqual({ role: 'user', content: '帮我看看这条笔记' });
    expect(h.generateNoteImage.mock.calls[0][1]).toBe('A small group keeping its draft private');
    expect(res.body.caption).toBe('根据这条笔记，画了一个小组先在组内讨论草稿的场景。');
    const saved = h.state.inserts.filter(i => i.table === 'note_conversation_messages').map(i => i.payload as Record<string, any>);
    expect(saved.at(-1)!.content).toContain('根据这条笔记，画了一个小组先在组内讨论草稿的场景。');
    expect(saved.at(-1)!.ai_metadata).toMatchObject({ direct_image: true, drawing: { kind: 'picture', planned: true } });
  });

  it('前端判断是改上一张（mode=edit）：从这段对话里找出那张图交给规划；判断经过只留认识的字段记进元数据', async () => {
    const original = h.MESSAGES.splice(0, h.MESSAGES.length,
      // 取法是新的在前
      { id: 'm-4', thread_id: 'thread-b', sender_id: null, sender_kind: 'assistant', content: '![猫](https://img.test/cat.png)\n\n画了一只猫。', created_at: '2026-09-28T00:04:00Z', ai_metadata: { direct_image: true, drawing: { kind: 'picture', caption: '画了一只猫。', prompt: 'A cat reading' } } } as never,
      { id: 'm-3', thread_id: 'thread-b', sender_id: 'student-a', sender_kind: 'user', content: '画一只猫', created_at: '2026-09-28T00:03:00Z' } as never,
    );
    try {
      const res = await call('POST', '/note-conversations/thread-b/image', {
        prompt: '颜色淡一点', mode: 'edit', form: 'picture', route: { decided_by: 'jev', p_draw: 0.99, junk: '<b>x</b>' },
      });
      expect(res.status).toBe(201);
      const context = h.planDrawing.mock.calls[0][2] as Record<string, unknown>;
      expect(context.previous).toEqual({ request: '画一只猫', caption: '画了一只猫。', kind: 'picture', prompt: 'A cat reading' });
      expect(context.form).toBe('picture');
      // 规划不可用：在原来的描述后面加上要改的地方
      expect(h.generateNoteImage.mock.calls[0][1]).toBe('A cat reading. Change requested by the learner: 颜色淡一点');
      const saved = h.state.inserts.filter(i => i.table === 'note_conversation_messages').map(i => i.payload as Record<string, any>);
      expect(saved.at(-1)!.ai_metadata.drawing).toMatchObject({ mode: 'edit', route: { decided_by: 'jev', p_draw: 0.99, from_client: true } });
      expect(saved.at(-1)!.ai_metadata.drawing.route).not.toHaveProperty('junk');

      // 没说是改图：不去找上一张
      h.planDrawing.mockClear();
      await call('POST', '/note-conversations/thread-b/image', { prompt: '再画一只狗' });
      expect(h.planDrawing.mock.calls[0][2]).not.toHaveProperty('previous');
    } finally {
      h.MESSAGES.splice(0, h.MESSAGES.length, ...original);
    }
  });
});

describe('课程资料引用核对接在两条回答路径上（2026-10-09）', () => {
  // 这两条路径的课程资料没有挂载测试（workspaceAgent.test 测了同样的写法），这里锁住：存回答之前核对、存核对过的卡片
  const src = readFileSync(resolve(__dirname, 'noteConversations.ts'), 'utf-8');
  it('每处存 kb_sources 之前都先 checkKbAnswer，并把核对过的卡片推给前端', () => {
    const checks = [...src.matchAll(/const kbChecked = kb && fullReply\.trim\(\) \? await checkKbAnswer\(fullReply, kb\.citations\) : null;/g)].map(m => m.index!);
    const saves = [...src.matchAll(/kb_sources: kbChecked\?\.sources \?\? /g)].map(m => m.index!);
    expect(checks).toHaveLength(2);
    expect(saves).toHaveLength(2);
    checks.forEach((at, i) => expect(at).toBeLessThan(saves[i]));
    expect(src.match(/kb_sources: kb\?\.citations/g)).toBeNull();
  });
});
