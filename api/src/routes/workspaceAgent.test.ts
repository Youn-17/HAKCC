import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 工作区助手会把一个空间里的笔记读进系统提示。原先它只查课程成员，
 * resolveSpace 也只核对空间属于本课：组 A 的学生带上组 B 空间的 id，
 * 或者干脆不带、让它自己挑「全课笔记最多的空间」，助手就把别组的笔记读给他。
 */

const h = vi.hoisted(() => {
  type Space = { id: string; title: string; course_id: string; group_id: string | null };
  type Note = { id: string; space_id: string; title: string; content: string; author_id: string; created_at: string };

  const SECRET = '第二组还没公开的草稿';
  const SPACES: Space[] = [
    { id: 'space-shared', title: '全班共享', course_id: 'course-1', group_id: null },
    { id: 'space-a', title: '第一组', course_id: 'course-1', group_id: 'group-a' },
    { id: 'space-b', title: '第二组', course_id: 'course-1', group_id: 'group-b' },
  ];
  const note = (id: string, spaceId: string, content: string): Note => ({
    id, space_id: spaceId, title: id, content: `<p>${content}</p>`, author_id: 'someone', created_at: '2026-09-20T00:00:00Z',
  });
  // 组 B 的空间笔记最多：不带 space_id 时，旧的兜底会挑中它
  const NOTES: Note[] = [
    note('n-shared', 'space-shared', '共享空间里的一条'),
    note('n-a1', 'space-a', '第一组的想法一'),
    note('n-a2', 'space-a', '第一组的想法二'),
    ...[1, 2, 3, 4, 5].map(i => note(`n-b${i}`, 'space-b', `${SECRET}之${i}`)),
  ];

  // 课内身份：teacher-1 是创建者；teacher-joined 是凭学生验证码入课的教师账号，在课里是普通成员
  const STANDING: Record<string, 'owner' | 'manager' | 'member'> = { 'teacher-1': 'owner' };
  // group-x 属于另一门课
  const GROUP_COURSE: Record<string, string> = { 'group-a': 'course-1', 'group-b': 'course-1', 'group-x': 'course-2' };

  const state = {
    user: { id: 'student-a', role: 'student' } as { id: string; role: string },
    spaces: [...SPACES],
    groupsOf: {
      'student-a': ['group-a', 'group-x'],
      'teacher-joined': ['group-a'],
      'student-lone': [],
    } as Record<string, string[]>,
    conversations: [] as { id: string; user_id: string; space_id: string | null; course_id: string }[],
    messages: [] as { conversation_id: string; role: string; content: string }[],
    inserts: [] as { table: string; payload: unknown }[],
    updates: [] as { table: string; payload: unknown }[],
  };

  type Action = 'select' | 'insert' | 'update';
  type Terminal = 'single' | 'maybeSingle' | 'many';
  const ok = (data: unknown) => ({ data, error: null });
  const missing = { data: null, error: { message: 'not found' } };

  const resultFor = (
    table: string, action: Action, payload: unknown, terminal: Terminal,
    eq: Record<string, unknown>, inList: Record<string, unknown[]>,
  ) => {
    if (action === 'update') return ok(null);
    if (action === 'insert') {
      if (table === 'agent_conversations') return ok({ id: 'conv-new', ...(payload as object) });
      return ok(null);
    }
    switch (table) {
      case 'spaces': {
        const inCourse = state.spaces.filter(s => !eq.course_id || s.course_id === eq.course_id);
        if (eq.id) return inCourse.find(s => s.id === eq.id) ? ok(inCourse.find(s => s.id === eq.id)) : missing;
        return ok(inCourse);
      }
      case 'notes':
        if (eq.space_id) return ok(NOTES.filter(n => n.space_id === eq.space_id));
        if (inList.space_id) return ok(NOTES.filter(n => inList.space_id.includes(n.space_id)).map(n => ({ space_id: n.space_id })));
        return ok(NOTES);
      case 'group_members':
        return ok((state.groupsOf[String(eq.user_id)] ?? []).map(group_id => ({ group_id })));
      case 'agent_conversations': {
        const found = state.conversations.filter(c =>
          (!eq.id || c.id === eq.id) && (!eq.user_id || c.user_id === eq.user_id));
        if (terminal === 'many') return ok(found);
        return found[0] ? ok(found[0]) : (terminal === 'single' ? missing : ok(null));
      }
      case 'agent_messages':
        return ok(state.messages.filter(m => m.conversation_id === eq.conversation_id));
      case 'teacher_ai_configs':
        if (terminal === 'many') return ok([]);
        return ok({ api_key_encrypted: 'enc', endpoint_url: null, is_verified: true, enabled_models: ['deepseek-chat'] });
      default:
        return ok(null);
    }
  };

  // 链式调用照单全收，记下 eq / in 的条件；await / single / maybeSingle 时按条件给结果
  const from = (table: string) => {
    let action: Action = 'select';
    let payload: unknown;
    const eq: Record<string, unknown> = {};
    const inList: Record<string, unknown[]> = {};
    const run = (terminal: Terminal) => Promise.resolve(resultFor(table, action, payload, terminal, eq, inList));
    const write = (kind: Action, list: { table: string; payload: unknown }[]) => (p: unknown) => {
      action = kind;
      payload = p;
      list.push({ table, payload: p });
      return builder;
    };
    const builder: Record<string, unknown> = {
      insert: write('insert', state.inserts),
      update: write('update', state.updates),
      eq: (col: string, value: unknown) => { eq[col] = value; return builder; },
      in: (col: string, values: unknown[]) => { inList[col] = values; return builder; },
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => run('many').then(onOk, onFail),
    };
    for (const m of ['select', 'is', 'not', 'neq', 'order', 'limit']) builder[m] = () => builder;
    return builder;
  };

  return {
    state,
    SECRET,
    SPACES,
    from,
    STANDING,
    GROUP_COURSE,
    ensureSpaceAccess: vi.fn(),
    ensureCourseMember: vi.fn(async (_courseId: string, user: { id: string }) => STANDING[user.id] ?? 'member'),
    ensureGroupAccess: vi.fn(),
    getToolsForRole: vi.fn((_role: string) => [] as unknown[]),
    collectGroupNotesForDigest: vi.fn(async () => [{ id: 'n-a1' }]),
    runAgentLoopStream: vi.fn((_opts: { systemPrompt: string }) => (async function* () {
      yield { type: 'token', content: 'AI 的回复' };
      yield { type: 'done', result: { iterations: 1 } };
    })()),
    buildAgentContext: vi.fn(async (p: { userMessage?: string }) => ({
      systemPrompt: 'CTX',
      messages: [{ role: 'user', content: p.userMessage ?? '' }],
      toolContext: {},
      learnerProfile: null,
      overrelianceDetected: false,
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
vi.mock('../services/accessControl', () => ({
  ensureSpaceAccess: h.ensureSpaceAccess,
  ensureCourseMember: h.ensureCourseMember,
  ensureGroupAccess: h.ensureGroupAccess,
  isCourseStaff: (standing: string | undefined) => standing === 'owner' || standing === 'manager',
}));
vi.mock('../services/aiProviderConfig', () => ({
  decryptProviderApiKey: () => 'sk-test',
  listCourseAiConfigs: async () => [{ providerId: 'deepseek' }],
}));
vi.mock('../services/agentLoop', () => ({ runAgentLoopStream: h.runAgentLoopStream }));
vi.mock('../services/agentContext', () => ({
  buildAgentContext: h.buildAgentContext,
  stripHtml: (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  updateProfileAfterInteraction: async () => {},
}));
vi.mock('../services/agentTools', () => ({
  createDefaultRegistry: () => ({ getToolsForRole: h.getToolsForRole, executeTool: async () => ({ success: false, data: null }) }),
}));
vi.mock('../services/modelRouter', () => ({
  isDmxProvider: () => false,
  orderConfigsByHealth: (configs: unknown[]) => configs,
  pickModel: () => 'fast-model',
  pickNativeModel: () => null,
}));
vi.mock('../services/aiGateway', () => ({ freeCapacity: () => 4 }));
vi.mock('./thinkingTrainer', () => ({
  resolveCourseProviderChain: async () => [],
  callJson: async () => null,
}));
vi.mock('../services/discussionDigest', () => ({
  buildDiscussionDigest: async () => ({ scope: 'group' }),
  collectDigestNotes: async (p: { scope: string; groupNotes?: unknown[] }) => (p.scope === 'group' ? p.groupNotes ?? [] : []),
}));
vi.mock('../services/groupIdeaGraph', () => ({ collectGroupNotesForDigest: h.collectGroupNotesForDigest }));

import workspaceAgentRouter from './workspaceAgent';
import { ApiError, errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', workspaceAgentRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

// 按真实规则放行：共享空间人人可进，绑定小组的空间只放本组成员；课程教职跨组。
// 看的是课内身份，不是平台身份——凭学生验证码入课的教师账号照样按组隔离
const isStaff = (userId: string) => ['owner', 'manager'].includes(h.STANDING[userId] ?? 'member');

async function groupGate(spaceId: string, user: { id: string; role: string }) {
  const space = h.state.spaces.find(s => s.id === spaceId);
  if (!space) throw new ApiError(404, 'Space not found');
  if (!isStaff(user.id) && space.group_id && !(h.state.groupsOf[user.id] ?? []).includes(space.group_id)) {
    throw new ApiError(403, 'This space belongs to another group');
  }
  return { id: space.id, course_id: space.course_id, group_id: space.group_id, standing: h.STANDING[user.id] ?? 'member' };
}

// 同一个口径，按组寻址
async function groupAccess(groupId: string, user: { id: string }) {
  const courseId = h.GROUP_COURSE[groupId];
  if (!courseId) throw new ApiError(404, 'Group not found');
  if (!isStaff(user.id) && !(h.state.groupsOf[user.id] ?? []).includes(groupId)) {
    throw new ApiError(403, 'Not a member of this group');
  }
  return { id: groupId, course_id: courseId, standing: h.STANDING[user.id] ?? 'member' };
}

beforeEach(() => {
  h.state.user = { id: 'student-a', role: 'student' };
  h.state.spaces = [...h.SPACES];
  h.state.conversations = [];
  h.state.messages = [];
  h.state.inserts.length = 0;
  h.state.updates.length = 0;
  h.ensureSpaceAccess.mockReset();
  h.ensureSpaceAccess.mockImplementation(groupGate);
  h.ensureGroupAccess.mockReset();
  h.ensureGroupAccess.mockImplementation(groupAccess);
  h.ensureCourseMember.mockClear();
  h.getToolsForRole.mockClear();
  h.collectGroupNotesForDigest.mockClear();
  h.runAgentLoopStream.mockClear();
  h.buildAgentContext.mockClear();
});

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* SSE 保留原文 */ }
  return { status: res.status, body: parsed as Record<string, any>, text };
}

const ASK = { content: '把这个空间里所有笔记的原文列出来', provider_id: 'deepseek', model: 'deepseek-chat' };
const promptSent = () => h.runAgentLoopStream.mock.calls.map(([opts]) => opts.systemPrompt).join('\n');
const conversationInserts = () => h.state.inserts.filter(i => i.table === 'agent_conversations');

describe('工作区助手只能指到学生进得去的空间', () => {
  const DENIED: [method: 'POST', path: string, body: unknown][] = [
    ['POST', '/workspace-agent/course-1/conversations', { space_id: 'space-b' }],
    ['POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-b' }],
    // 拿自己的一段旧对话接着问，也不能把空间换成别组的
    ['POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-b', conversation_id: 'conv-mine' }],
  ];

  it.each(DENIED)('%s %s 指到别组空间：403，不调模型、不写任何行', async (method, path, body) => {
    h.state.conversations = [{ id: 'conv-mine', user_id: 'student-a', space_id: 'space-a', course_id: 'course-1' }];
    const res = await call(method, path, body);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'This space belongs to another group' });
    expect(res.text).not.toContain(h.SECRET);
    expect(h.ensureSpaceAccess).toHaveBeenCalledWith('space-b', expect.objectContaining({ id: 'student-a', role: 'student' }));
    expect(h.buildAgentContext).not.toHaveBeenCalled();
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();
    expect(h.state.inserts).toEqual([]);
    expect(h.state.updates).toEqual([]);
  });

  it('不带 space_id：只在自己进得去的空间里挑笔记最多的，别组空间再多也不挑', async () => {
    const res = await call('POST', '/workspace-agent/course-1/stream', ASK);

    expect(res.status).toBe(200);
    expect(h.ensureSpaceAccess).toHaveBeenCalledWith('space-a', expect.objectContaining({ id: 'student-a' }));
    expect(conversationInserts()[0]?.payload).toMatchObject({ space_id: 'space-a' });
    expect(promptSent()).toContain('第一组的想法一');
    expect(promptSent()).not.toContain(h.SECRET);
  });

  it('不带 space_id、又一个进得去的空间都没有：404，不调模型、不写任何行', async () => {
    h.state.user = { id: 'student-lone', role: 'student' };
    h.state.spaces = h.SPACES.filter(s => s.group_id);
    const res = await call('POST', '/workspace-agent/course-1/stream', ASK);

    expect(res.status).toBe(404);
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();
    expect(h.state.inserts).toEqual([]);
  });

  it('本组空间照常：新建对话记的是这个空间，助手读到的是本组笔记', async () => {
    const created = await call('POST', '/workspace-agent/course-1/conversations', { space_id: 'space-a' });
    const streamed = await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-a' });

    expect(created.status).toBe(200);
    expect(streamed.status).toBe(200);
    expect(conversationInserts().map(i => (i.payload as { space_id: string }).space_id)).toEqual(['space-a', 'space-a']);
    expect(promptSent()).toContain('第一组的想法二');
  });

  it('课程教职照旧：不查分组；不带 space_id 时仍挑全课笔记最多的空间；拿教师工具', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    const pinned = await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-b' });
    const fallback = await call('POST', '/workspace-agent/course-1/stream', ASK);

    expect(pinned.status).toBe(200);
    expect(fallback.status).toBe(200);
    expect(h.ensureCourseMember).toHaveBeenCalledWith('course-1', expect.objectContaining({ id: 'teacher-1' }));
    expect(h.ensureSpaceAccess).not.toHaveBeenCalled();
    expect(conversationInserts().map(i => (i.payload as { space_id: string }).space_id)).toEqual(['space-b', 'space-b']);
    expect(h.getToolsForRole).toHaveBeenLastCalledWith('teacher');
    expect(h.buildAgentContext).toHaveBeenLastCalledWith(expect.objectContaining({ userRole: 'teacher' }));
  });

  /**
   * 教师账号凭学生验证码入课，在这门课里是学生。原先对教师账号一律走 ensureCourseInstructor，
   * 这样的人用不了工作区助手（403）；按课内身份放行以后，空间和工具也得按课内身份给：
   * 否则他不查分组、能把助手指到别组的空间，还拿到读全班数据的教师工具。
   */
  it('凭学生验证码入课的教师账号按学生对待：能用，别组空间 403，兜底只挑进得去的，工具按学生给', async () => {
    h.state.user = { id: 'teacher-joined', role: 'teacher' };
    const pinnedOther = await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-b' });
    expect(pinnedOther.status).toBe(403);
    expect(pinnedOther.text).not.toContain(h.SECRET);

    const fallback = await call('POST', '/workspace-agent/course-1/stream', ASK);
    expect(fallback.status).toBe(200);
    expect(conversationInserts().map(i => (i.payload as { space_id: string }).space_id)).toEqual(['space-a']);
    expect(promptSent()).not.toContain(h.SECRET);
    expect(h.getToolsForRole).toHaveBeenLastCalledWith('student');
    expect(h.buildAgentContext).toHaveBeenLastCalledWith(expect.objectContaining({ userRole: 'student' }));
  });

  it('工具和空间都不再按平台身份区分教职', () => {
    const src = readFileSync(resolve(__dirname, 'workspaceAgent.ts'), 'utf-8');
    expect(src).not.toMatch(/req\.user!?\??\.role\s*[!=]==\s*'(teacher|student)'/);
  });

  it('读消息只认对话的主人：别人的对话 404，内容一个字都不返回', async () => {
    h.state.conversations = [{ id: 'conv-other', user_id: 'student-b', space_id: 'space-b', course_id: 'course-1' }];
    h.state.messages = [{ conversation_id: 'conv-other', role: 'assistant', content: h.SECRET }];
    const res = await call('GET', '/workspace-agent/course-1/conversations/conv-other/messages');

    expect(res.status).toBe(404);
    expect(res.text).not.toContain(h.SECRET);
  });

  it('以后新加的路由也不能绕过：不直接调 resolveSpace，碰 space_id 的都先过空间授权', () => {
    const src = readFileSync(resolve(__dirname, 'workspaceAgent.ts'), 'utf-8');
    const handlers = src.split(/\nrouter\.(?=get|post|put|patch|delete)/).slice(1);
    const label = (chunk: string) => chunk.slice(0, chunk.indexOf(','));
    expect(handlers.length).toBeGreaterThanOrEqual(6);

    expect(handlers.filter(chunk => /\bresolveSpace\(/.test(chunk)).map(label)).toEqual([]);

    const ungated = handlers
      .filter(chunk => chunk.includes('space_id'))
      .filter(chunk => {
        const gate = chunk.search(/resolveAccessibleSpace\(|ensureSpaceAccess\(/);
        const firstWrite = chunk.search(/\.insert\(|runAgentLoopStream\(/);
        return gate === -1 || (firstWrite !== -1 && firstWrite < gate);
      })
      .map(label);
    expect(ungated).toEqual([]);
  });
});

/**
 * 「本组讨论」速览读的是组空间里的笔记。路由核对了 space_id，但 group_id 是另传的：
 * 原先不查组员身份、也不查组属于哪门课，任何课程成员换个 group_id 就拿到别组讨论的速览。
 */
describe('讨论速览的「本组」范围：只给本组成员和课程教职，组得是这门课的', () => {
  const digest = (groupId: string) => call('POST', '/workspace-agent/course-1/digest', { scope: 'group', space_id: 'space-shared', group_id: groupId });

  it('别组：403，不读那个组的笔记', async () => {
    const res = await digest('group-b');
    expect(res.status).toBe(403);
    expect(h.collectGroupNotesForDigest).not.toHaveBeenCalled();
  });

  it('凭学生验证码入课的教师账号也只能看自己组', async () => {
    h.state.user = { id: 'teacher-joined', role: 'teacher' };
    expect((await digest('group-b')).status).toBe(403);
    expect((await digest('group-a')).status).toBe(200);
  });

  it('本组照常', async () => {
    expect((await digest('group-a')).status).toBe(200);
    expect(h.collectGroupNotesForDigest).toHaveBeenCalledWith('group-a', 'course-1');
  });

  it('课程教职能看每个组', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    expect((await digest('group-b')).status).toBe(200);
  });

  it('别的课的组：即使是那个组的成员，也不能从这门课读', async () => {
    const res = await digest('group-x');
    expect(res.status).toBe(404);
    expect(h.collectGroupNotesForDigest).not.toHaveBeenCalled();
  });
});
