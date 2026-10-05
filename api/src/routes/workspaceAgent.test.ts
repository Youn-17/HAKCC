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
  type Note = { id: string; space_id: string; title: string; content: string; author_id: string; created_at: string; deleted_at?: string | null };
  type Relation = { source_note_id: string; target_note_id: string; relation_type: string; space_id: string; created_at: string };
  type Conversation = { id: string; user_id: string; space_id: string | null; course_id: string; agent_type?: string; title?: string; updated_at?: string };
  type Message = { id?: string; conversation_id: string; role: string; content: string; created_at?: string };

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
    notes: [] as Note[],
    relations: [] as Relation[],
    failRelations: false,
    conversations: [] as Conversation[],
    messages: [] as Message[],
    inserts: [] as { table: string; payload: unknown }[],
    updates: [] as { table: string; payload: unknown }[],
  };

  type Action = 'select' | 'insert' | 'update';
  type Terminal = 'single' | 'maybeSingle' | 'many';
  const ok = (data: unknown) => ({ data, error: null });
  const missing = { data: null, error: { message: 'not found' } };

  type Opts = { head: boolean; order: { col: string; asc: boolean } | null; limit: number | null; nulls: string[] };
  const ordered = <T extends Record<string, any>>(rows: T[], opts: Opts): T[] => {
    let out = [...rows];
    if (opts.order) {
      const { col, asc } = opts.order;
      out.sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (asc ? 1 : -1));
    }
    if (opts.limit != null) out = out.slice(0, opts.limit);
    return out;
  };

  const resultFor = (
    table: string, action: Action, payload: unknown, terminal: Terminal,
    eq: Record<string, unknown>, inList: Record<string, unknown[]>, opts: Opts,
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
      case 'notes': {
        const alive = (n: Note) => !opts.nulls.includes('deleted_at') || !n.deleted_at;
        if (opts.head) return { data: null, count: state.notes.filter(n => n.space_id === eq.space_id && alive(n)).length, error: null };
        if (inList.id) return ok(state.notes.filter(n => inList.id.includes(n.id) && (!eq.space_id || n.space_id === eq.space_id) && alive(n)));
        if (eq.space_id) return ok(ordered(state.notes.filter(n => n.space_id === eq.space_id && alive(n)), opts));
        if (inList.space_id) return ok(state.notes.filter(n => inList.space_id.includes(n.space_id)).map(n => ({ space_id: n.space_id })));
        return ok(state.notes);
      }
      case 'relations':
        return ok(ordered(state.relations.filter(r => !eq.space_id || r.space_id === eq.space_id), opts));
      case 'group_members':
        return ok((state.groupsOf[String(eq.user_id)] ?? []).map(group_id => ({ group_id })));
      case 'agent_conversations': {
        const found = ordered(state.conversations.filter(c =>
          (!eq.id || c.id === eq.id) && (!eq.user_id || c.user_id === eq.user_id)
          && (!eq.course_id || c.course_id === eq.course_id)
          && (!eq.space_id || c.space_id === eq.space_id)
          && (!eq.agent_type || (c.agent_type ?? 'workspace') === eq.agent_type)), opts);
        if (terminal === 'many') return ok(found);
        return found[0] ? ok(found[0]) : (terminal === 'single' ? missing : ok(null));
      }
      case 'agent_messages':
        return ok(ordered(state.messages.filter(m => m.conversation_id === eq.conversation_id), opts));
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
    const opts: Opts = { head: false, order: null, limit: null, nulls: [] };
    const run = (terminal: Terminal) => (table === 'relations' && state.failRelations
      ? Promise.reject(new Error('relations down'))
      : Promise.resolve(resultFor(table, action, payload, terminal, eq, inList, opts)));
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
      select: (_cols?: string, o?: { head?: boolean }) => { opts.head = Boolean(o?.head); return builder; },
      order: (col: string, o?: { ascending?: boolean }) => { opts.order = { col, asc: o?.ascending !== false }; return builder; },
      limit: (n: number) => { opts.limit = n; return builder; },
      is: (col: string, value: unknown) => { if (value === null) opts.nulls.push(col); return builder; },
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => run('many').then(onOk, onFail),
    };
    for (const m of ['not', 'neq']) builder[m] = () => builder;
    return builder;
  };

  return {
    state,
    NOTES,
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
    streamDrawTurn: vi.fn(async (res: { write: (s: string) => void; end: () => void }) => {
      res.write('data: {"drawing":{}}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    }),
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
vi.mock('../services/drawTurn', () => ({ streamDrawTurn: h.streamDrawTurn }));
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
  h.state.notes = h.NOTES.map(n => ({ ...n }));
  h.state.relations = [];
  h.state.failRelations = false;
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
  h.streamDrawTurn.mockClear();
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

/**
 * 助手「不能识别 Build-on 关系」的根子：它面对的是整个空间，当前笔记是一条合成的、id 就是空间 id 的笔记，
 * 只认当前笔记的 get_note_context 永远查不到关系；系统提示里又只有每条笔记的标题和摘要。
 */
describe('助手认得出 Build-on 关系', () => {
  const rel = (source: string, target: string, type: string, at: string, space = 'space-a') =>
    ({ source_note_id: source, target_note_id: target, relation_type: type, space_id: space, created_at: at });
  const addNotes = (spaceId: string, ids: string[]) => {
    for (const id of ids) {
      h.state.notes.push({ id, space_id: spaceId, title: id, content: `<p>${id} 的内容</p>`, author_id: 'someone', created_at: '2026-09-21T00:00:00Z' });
    }
  };
  const ask = (extra: Record<string, unknown> = {}) =>
    call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-a', ...extra });

  it('关系写进系统提示：谁 Build-on 谁（方向对）、被 Build-on 最多的、还没人理的', async () => {
    addNotes('space-a', ['n-a3']);
    h.state.relations = [
      rel('n-a2', 'n-a1', 'extend', '2026-10-03T00:00:00Z'),
      rel('n-a3', 'n-a1', 'challenge', '2026-10-04T00:00:00Z'),
    ];
    const res = await ask();

    expect(res.status).toBe(200);
    const prompt = promptSent();
    expect(prompt).toContain('#3 "n-a3" builds on #1 "n-a1" (challenge)');
    expect(prompt).toContain('#2 "n-a2" builds on #1 "n-a1" (extend)');
    expect(prompt).not.toContain('#1 "n-a1" builds on');
    expect(prompt).toContain('Built on most: #1 "n-a1" (2).');
    expect(prompt).toContain('Listed notes nobody has built on yet: #2, #3.');
    // 提示里说明了怎么用：不许说看不到关系，要读某条笔记就带 note_id
    expect(prompt).toContain('Never say you cannot see Build-on relations');
    expect(prompt).toContain('read_note or get_note_context with its note_id');
  });

  it('一条关系都没有：提示里明说没有，不让模型编', async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    expect(promptSent()).toContain('There are no Build-on links in this workspace yet');
  });

  it('别的空间的笔记、已删除的笔记，不进关系，也不泄露标题', async () => {
    h.state.notes.push({ id: 'n-a-gone', space_id: 'space-a', title: '已经删掉的想法', content: '<p>x</p>', author_id: 'someone', created_at: '2026-09-21T00:00:00Z', deleted_at: '2026-10-01T00:00:00Z' });
    h.state.relations = [
      rel('n-a2', 'n-a1', 'extend', '2026-10-01T00:00:00Z'),
      rel('n-a2', 'n-b1', 'evidence', '2026-10-02T00:00:00Z'),
      rel('n-a2', 'n-a-gone', 'question', '2026-10-03T00:00:00Z'),
    ];
    const res = await ask();

    expect(res.status).toBe(200);
    const prompt = promptSent();
    expect(prompt).toContain('#2 "n-a2" builds on #1 "n-a1" (extend)');
    expect(prompt).not.toContain('n-b1');
    expect(prompt).not.toContain(h.SECRET);
    expect(prompt).not.toContain('已经删掉的想法');
    expect(prompt).not.toContain('(evidence)');
    expect(prompt).not.toContain('(question)');
  });

  it('清单只放最近更新的 30 条，提示里如实说空间一共有几条；碰到老笔记的关系写标题和 id', async () => {
    addNotes('space-a', Array.from({ length: 35 }, (_, i) => `n-old-${i}`));
    // 空间有 37 条，清单只放前 30：最后一条在清单之外
    h.state.relations = [rel('n-a1', 'n-old-34', 'clarify', '2026-10-03T00:00:00Z')];
    const res = await ask();

    expect(res.status).toBe(200);
    const prompt = promptSent();
    expect(prompt).toContain('This workspace contains 37 notes. The 30 most recently updated are listed here');
    expect(prompt).toContain('#1 "n-a1" builds on "n-old-34" (id: n-old-34) (clarify)');
    expect(prompt).toContain('shows 30 of 37 notes');
  });

  it('学生勾选了笔记：只写碰到这几条的关系', async () => {
    addNotes('space-a', ['n-a3']);
    h.state.relations = [
      rel('n-a2', 'n-a1', 'extend', '2026-10-03T00:00:00Z'),
      rel('n-a3', 'n-a2', 'question', '2026-10-04T00:00:00Z'),
    ];
    const res = await ask({ note_ids: ['n-a1'] });

    expect(res.status).toBe(200);
    const prompt = promptSent();
    expect(prompt).toContain('1 link(s) touching the selected notes');
    expect(prompt).toContain('builds on #1 "n-a1" (extend)');
    expect(prompt).not.toContain('(question)');
  });

  it('查关系出错：照常回答，只是提示里少了这一段', async () => {
    h.state.failRelations = true;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await ask();
    errorLog.mockRestore();

    expect(res.status).toBe(200);
    expect(res.text).toContain('AI 的回复');
    expect(promptSent()).not.toContain('Build-on relations in this workspace');
    expect(promptSent()).toContain('第一组的想法一');
  });
});

/**
 * 历史「从来不保留」：后端一直在存（agent_conversations / agent_messages），面板没有读回来。
 * 读回来以后隔天接着聊成了常态，对话会变长——服务端喂给模型的历史必须是最近的，而不是最早的。
 */
describe('对话历史：能读回来，长对话取最近的', () => {
  const conv = (id: string, spaceId: string | null, updatedAt: string, over: Record<string, unknown> = {}) =>
    ({ id, user_id: 'student-a', space_id: spaceId, course_id: 'course-1', title: `对话 ${id}`, updated_at: updatedAt, ...over });
  const msg = (conversationId: string, i: number, role = i % 2 ? 'assistant' : 'user') =>
    ({ id: `m${i}`, conversation_id: conversationId, role, content: `第 ${i} 句`, created_at: String(i).padStart(4, '0') });

  it('列表：只列自己的、本课的；带 space_id 就只列那个空间的，新的在前', async () => {
    h.state.conversations = [
      conv('c1', 'space-a', '2026-10-03T00:00:00Z'),
      conv('c2', 'space-a', '2026-10-04T00:00:00Z'),
      conv('c3', 'space-shared', '2026-10-05T00:00:00Z'),
      conv('c4', 'space-a', '2026-10-06T00:00:00Z', { user_id: 'student-b' }),
      conv('c5', 'space-a', '2026-10-07T00:00:00Z', { course_id: 'course-2' }),
      conv('c6', 'space-a', '2026-10-08T00:00:00Z', { agent_type: 'personal' }),
    ];
    const inSpace = await call('GET', '/workspace-agent/course-1/conversations?space_id=space-a');
    const all = await call('GET', '/workspace-agent/course-1/conversations');

    expect(inSpace.status).toBe(200);
    expect(inSpace.body.conversations.map((c: { id: string }) => c.id)).toEqual(['c2', 'c1']);
    expect(inSpace.body.conversations[0]).toMatchObject({ space_id: 'space-a', title: '对话 c2' });
    expect(all.body.conversations.map((c: { id: string }) => c.id)).toEqual(['c3', 'c2', 'c1']);
  });

  it('列表带别组的空间 id：403，什么都不返回', async () => {
    h.state.conversations = [conv('c1', 'space-b', '2026-10-03T00:00:00Z')];
    const res = await call('GET', '/workspace-agent/course-1/conversations?space_id=space-b');

    expect(res.status).toBe(403);
    expect(res.text).not.toContain('c1');
  });

  it('读消息：长对话返回最近的 100 条，按旧到新排好', async () => {
    h.state.conversations = [conv('c1', 'space-a', '2026-10-03T00:00:00Z')];
    h.state.messages = Array.from({ length: 120 }, (_, i) => msg('c1', i + 1));
    const res = await call('GET', '/workspace-agent/course-1/conversations/c1/messages');

    expect(res.status).toBe(200);
    const ids = res.body.messages.map((m: { id: string }) => m.id);
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('m21');
    expect(ids[99]).toBe('m120');
  });

  it('读消息：对话得是这门课里的 workspace 对话，别课的、个人对话的一律 404', async () => {
    h.state.conversations = [
      conv('other-course', 'space-a', '2026-10-03T00:00:00Z', { course_id: 'course-2' }),
      conv('personal', 'space-a', '2026-10-03T00:00:00Z', { agent_type: 'personal' }),
    ];
    h.state.messages = [msg('other-course', 1), msg('personal', 1)];

    for (const id of ['other-course', 'personal']) {
      const res = await call('GET', `/workspace-agent/course-1/conversations/${id}/messages`);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('第 1 句');
    }
  });

  it('读消息：不是这门课的成员，先 403，不查对话', async () => {
    h.state.conversations = [conv('c1', 'space-a', '2026-10-03T00:00:00Z')];
    h.state.messages = [msg('c1', 1)];
    h.ensureCourseMember.mockRejectedValueOnce(new ApiError(403, 'Not a member of this course'));
    const res = await call('GET', '/workspace-agent/course-1/conversations/c1/messages');

    expect(res.status).toBe(403);
    expect(res.text).not.toContain('第 1 句');
  });

  it('接着聊：喂给模型的服务端历史是最近的 40 条（旧到新），不是最早的 40 条', async () => {
    h.state.conversations = [conv('c1', 'space-a', '2026-10-03T00:00:00Z')];
    h.state.messages = Array.from({ length: 50 }, (_, i) => msg('c1', i + 1));
    const res = await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-a', conversation_id: 'c1' });

    expect(res.status).toBe(200);
    const history = (h.buildAgentContext.mock.calls[0][0] as unknown as { history: { content: string }[] }).history;
    expect(history).toHaveLength(40);
    expect(history[0].content).toBe('第 11 句');
    expect(history[39].content).toBe('第 50 句');
  });
});

/**
 * 回答写多长（2026-10-05 用户：输出太多学生不想看，让学生选；不是硬限制，按问题难度调，要写完整）。
 */
describe('回答长度', () => {
  const loopOpts = () => h.runAgentLoopStream.mock.calls[0][0] as unknown as { systemPrompt: string; maxTokens: number };
  const savedReply = () => h.state.inserts.find(i => i.table === 'agent_messages' && i.payload.role === 'assistant')?.payload;

  it('学生选「简短」：档位和目标字数写进提示词，记进这条回答', async () => {
    const res = await call('POST', '/workspace-agent/course-1/stream', { ...ASK, content: '比较一下这两种观点的区别', answer_length: 'short' });

    expect(res.status).toBe(200);
    expect(loopOpts().systemPrompt).toContain('the student chose "brief"');
    // 比较类问题判成深：简短档的 250 往长调到约 330
    expect(loopOpts().systemPrompt).toContain('about 330 Chinese characters');
    expect(savedReply()?.ai_metadata).toMatchObject({
      answer_length: { preset: 'short', depth: 2, depth_source: 'heuristic', target: 330, chars: 'AI 的回复'.length },
    });
  });

  it('没选：按适中；max_tokens 按目标留足余量，至少原来的 2048，会先思考的 DeepSeek 再多留', async () => {
    await call('POST', '/workspace-agent/course-1/stream', ASK);
    expect(loopOpts().systemPrompt).toContain('the student chose "medium"');
    expect(loopOpts().maxTokens).toBeGreaterThanOrEqual(2048 + 4000);
  });
});

describe('「画图」按钮', () => {
  it('force_draw：不管怎么措辞都直接出图，不走对话模型', async () => {
    const res = await call('POST', '/workspace-agent/course-1/stream', { ...ASK, content: '一棵知识之树，枝条上挂着同学们的想法', force_draw: true });

    expect(res.status).toBe(200);
    expect(h.streamDrawTurn).toHaveBeenCalledTimes(1);
    expect((h.streamDrawTurn.mock.calls[0] as unknown[])[1]).toMatchObject({ prompt: '一棵知识之树，枝条上挂着同学们的想法' });
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();
  });

  it('没按按钮、也没说要画：照常对话', async () => {
    await call('POST', '/workspace-agent/course-1/stream', { ...ASK, content: '一棵知识之树' });
    expect(h.streamDrawTurn).not.toHaveBeenCalled();
    expect(h.runAgentLoopStream).toHaveBeenCalledTimes(1);
  });
});
