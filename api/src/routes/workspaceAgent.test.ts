import 'express-async-errors';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  type Message = { id?: string; conversation_id: string; role: string; content: string; created_at?: string; ai_metadata?: Record<string, unknown> };
  type Feedback = { id: string; note_id: string; space_id: string; user_id: string; trigger_type: string; status: string; rejection_tag: string | null; published_note_id: string | null; trigger_context?: Record<string, unknown> };
  type Insertion = { id: string; note_id: string; space_id: string; user_id: string; scaffold_id: string | null; reason_tag: string | null; feedback_id: string | null; source_message_id: string | null };

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
    feedbacks: [] as Feedback[],
    insertions: [] as Insertion[],
    scaffolds: [] as Array<{ id: string; title: string; metadata: unknown }>,
    profiles: [] as Array<{ id: string; full_name: string }>,
    failAiStats: false,
    failHistory: false,
    // 课里配了 key 的其余厂商（候选链）
    otherConfigs: [] as Array<{ provider_id: string; api_key_encrypted: string; endpoint_url: string | null; enabled_models: string[] }>,
    inserts: [] as { table: string; payload: unknown }[],
    updates: [] as { table: string; payload: unknown }[],
  };

  type Action = 'select' | 'insert' | 'update';
  type Terminal = 'single' | 'maybeSingle' | 'many';
  const ok = (data: unknown) => ({ data, error: null });
  const missing = { data: null, error: { message: 'not found' } };

  type Opts = { head: boolean; order: { col: string; asc: boolean } | null; limit: number | null; nulls: string[]; offset?: number };
  const ordered = <T extends Record<string, any>>(rows: T[], opts: Opts): T[] => {
    let out = [...rows];
    if (opts.order) {
      const { col, asc } = opts.order;
      out.sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (asc ? 1 : -1));
    }
    if (opts.limit != null) out = out.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit);
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
        if (state.failHistory) return { data: null, error: { message: 'database unavailable' } };
        return ok(ordered(state.messages.filter(m => m.conversation_id === eq.conversation_id), opts));
      case 'note_ai_feedbacks':
        return ok(state.feedbacks.filter(f => (!eq.space_id || f.space_id === eq.space_id) && (!inList.note_id || inList.note_id.includes(f.note_id))));
      case 'note_ai_insertions':
        return ok(state.insertions.filter(i => (!eq.space_id || i.space_id === eq.space_id) && (!inList.note_id || inList.note_id.includes(i.note_id))));
      case 'scaffolds':
        return ok(state.scaffolds.filter(sc => !inList.id || inList.id.includes(sc.id)));
      case 'profiles':
        return ok(state.profiles.filter(p => !inList.id || inList.id.includes(p.id)));
      case 'teacher_ai_configs':
        if (terminal === 'many') return ok(state.otherConfigs);
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
    const run = (terminal: Terminal) => ((table === 'relations' && state.failRelations) || (table === 'note_ai_feedbacks' && state.failAiStats)
      ? Promise.reject(new Error(`${table} down`))
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
      order: (col: string, o?: { ascending?: boolean }) => { if (!opts.order) opts.order = { col, asc: o?.ascending !== false }; return builder; },
      range: (start: number, end: number) => { opts.offset = start; opts.limit = end - start + 1; return builder; },
      limit: (n: number) => { opts.limit = n; return builder; },
      is: (col: string, value: unknown) => { if (value === null) opts.nulls.push(col); return builder; },
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => run('many').then(onOk, onFail),
    };
    for (const m of ['not', 'neq', 'or']) builder[m] = () => builder;
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
    executeTool: vi.fn(async (_name: string, _args: unknown, _context: unknown) => ({ success: false, data: null })),
    // 默认这门课没有资料；「课程资料」那一组用例自己给检索结果
    startKbRetrieval: vi.fn((_params: unknown) => ({ available: Promise.resolve(false), result: Promise.resolve(null) as Promise<unknown> })),
    collectGroupNotesForDigest: vi.fn(async () => [{ id: 'n-a1' }]),
    // 要不要画：默认用真的 routeDrawRequest（测试里 Jev 没开，按说法认）；Jev 那几条用例自己给判断
    routeDrawRequest: vi.fn(),
    realRouteDrawRequest: null as unknown as typeof import('../services/drawJudge').routeDrawRequest,
    streamDrawTurn: vi.fn(async (res: { write: (s: string) => void; end: () => void }) => {
      res.write('data: {"drawing":{}}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    }),
    runAgentLoopStream: vi.fn((_opts: { systemPrompt: string }) => (async function* () {
      yield { type: 'token', content: 'AI 的回复' };
      yield { type: 'done', result: { iterations: 1 } };
    })()),
    // 跟真的一样：发给模型的消息来自 history，userMessage 只拿去判断过度依赖。
    // 以前这里拿 userMessage 拼消息，「附件正文没进模型」就这样被盖住了
    buildAgentContext: vi.fn(async (p: { history: Array<{ role: string; content: string }> }) => ({
      systemPrompt: 'CTX',
      messages: p.history,
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
vi.mock('../services/drawJudge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/drawJudge')>();
  h.realRouteDrawRequest = actual.routeDrawRequest;
  return { ...actual, routeDrawRequest: h.routeDrawRequest };
});
vi.mock('../services/drawTurn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/drawTurn')>()),
  streamDrawTurn: h.streamDrawTurn,
}));
vi.mock('../services/studentLearningContext', () => ({ loadStudentLearningContext: vi.fn(async () => 'LEARNER-RECORDS') }));
vi.mock('../services/agentContext', () => ({
  buildAgentContext: h.buildAgentContext,
  stripHtml: (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  updateProfileAfterInteraction: async () => {},
}));
vi.mock('../services/agentTools', () => ({
  createDefaultRegistry: () => ({ getToolsForRole: h.getToolsForRole, executeTool: h.executeTool }),
}));
vi.mock('../services/kbSources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/kbSources')>()),
  startKbRetrieval: h.startKbRetrieval,
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
import { KbCitationRegistry } from '../services/kbSources';
import { IMAGE_TURN_RULES } from '../services/noteAgentCatalog';
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
  h.state.feedbacks = [];
  h.state.insertions = [];
  h.state.scaffolds = [];
  h.state.profiles = [];
  h.state.failAiStats = false;
  h.state.failHistory = false;
  h.state.otherConfigs = [];
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
  h.routeDrawRequest.mockReset();
  h.routeDrawRequest.mockImplementation((text: string, opts?: Parameters<typeof h.realRouteDrawRequest>[1]) => h.realRouteDrawRequest(text, opts));
  h.executeTool.mockClear();
  h.startKbRetrieval.mockClear();
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

  it('接着聊：保留较早的要求与最新追问，按旧到新提供完整历史', async () => {
    h.state.conversations = [conv('c1', 'space-a', '2026-10-03T00:00:00Z')];
    h.state.messages = Array.from({ length: 50 }, (_, i) => msg('c1', i + 1));
    const res = await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-a', conversation_id: 'c1' });

    expect(res.status).toBe(200);
    const history = (h.buildAgentContext.mock.calls[0][0] as unknown as { history: { content: string }[] }).history;
    expect(history).toHaveLength(51);
    expect(history[0].content).toBe('第 1 句');
    expect(history[49].content).toBe('第 50 句');
    expect(history[50].content).toBe(ASK.content);
  });

  it('接着聊带的是别门课的、或个人助手的对话 id：不写进那段、不读它的历史，新开一段这门课的', async () => {
    // 每人每分钟 20 次的限流：换一个同组的学生，不占 student-a 的额度
    h.state.user = { id: 'student-conv', role: 'student' };
    h.state.groupsOf['student-conv'] = ['group-a'];
    const cases: Array<[string, Record<string, unknown>]> = [
      ['other-course', { course_id: 'course-2' }],
      ['personal', { agent_type: 'personal' }],
    ];
    for (const [id, over] of cases) {
      h.state.conversations = [conv(id, 'space-a', '2026-10-03T00:00:00Z', { user_id: 'student-conv', ...over })];
      h.state.messages = [msg(id, 1, 'user')];
      h.state.inserts.length = 0;
      h.buildAgentContext.mockClear();
      const res = await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-a', conversation_id: id });

      expect(res.status).toBe(200);
      expect(conversationInserts().map(i => i.payload)).toEqual([expect.objectContaining({ agent_type: 'workspace', course_id: 'course-1' })]);
      const written = h.state.inserts.filter(i => i.table === 'agent_messages').map(i => (i.payload as { conversation_id: string }).conversation_id);
      expect(written.length).toBeGreaterThan(0);
      expect(written).not.toContain(id);
      const history = (h.buildAgentContext.mock.calls[0][0] as unknown as { history: { content: string }[] }).history;
      expect(history.map(m => m.content)).not.toContain('第 1 句');
    }
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

  it('画之前带上这段对话和它的记忆、空间里的笔记和 Build-on；学生还带上自己的记录（2026-10-09）', async () => {
    h.state.relations = [{ source_note_id: 'n-a2', target_note_id: 'n-a1', relation_type: 'question', space_id: 'space-a', created_at: '2026-09-21T00:00:00Z' }];
    h.state.conversations = [{ id: 'conv-mine', user_id: 'student-a', space_id: 'space-a', course_id: 'course-1', conversation_memory: { version: 1, summary: '在比较第一组的两个想法' } } as never];
    h.state.messages = [
      { conversation_id: 'conv-mine', role: 'user', content: '第一组都说了什么？', created_at: '2026-09-22T00:00:01Z' },
      { conversation_id: 'conv-mine', role: 'assistant', content: '想法一和想法二', created_at: '2026-09-22T00:00:02Z' },
    ];
    await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-a', conversation_id: 'conv-mine', content: '画一张这两个想法的关系图' });

    expect(h.streamDrawTurn).toHaveBeenCalledTimes(1);
    const opts = (h.streamDrawTurn.mock.calls[0] as unknown[])[1] as { prompt: string; context: { history: unknown[]; memory: string; background: string; learner: string } };
    expect(opts.prompt).toBe('画一张这两个想法的关系图');
    expect(opts.context.history).toEqual([
      { role: 'user', content: '第一组都说了什么？' },
      { role: 'assistant', content: '想法一和想法二' },
    ]);
    expect(opts.context.memory).toBe('在比较第一组的两个想法');
    expect(opts.context.background).toContain('第一组的想法一');
    expect(opts.context.background).toContain('builds on');
    // 别组的笔记照样进不来
    expect(opts.context.background).not.toContain(h.SECRET);
    expect(opts.context.learner).toBe('LEARNER-RECORDS');
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();
  });

  it('教职画图不带「学生自己的记录」', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-shared', content: '画一张思维导图总结这节课' });
    const opts = (h.streamDrawTurn.mock.calls[0] as unknown[])[1] as { context: { learner: string } };
    expect(opts.context.learner).toBe('');
  });

  it('没按按钮、也没说要画：照常对话', async () => {
    await call('POST', '/workspace-agent/course-1/stream', { ...ASK, content: '一棵知识之树' });
    expect(h.streamDrawTurn).not.toHaveBeenCalled();
    expect(h.runAgentLoopStream).toHaveBeenCalledTimes(1);
  });
});

/** 2026-10-09：要不要画、改上一张还是新画、画成哪种，由 Jev 判断（drawJudge.routeDrawRequest） */
describe('Jev 判断要不要画', () => {
  const route = (over: Record<string, unknown>) => ({ draw: true, mode: 'new', form: null, decidedBy: 'jev', rule: false, ...over });
  // 换一个学生：路由按人限流（每分钟 20 次），这组用例别把后面用例的额度用掉
  beforeEach(() => {
    h.state.user = { id: 'student-j', role: 'student' };
    h.state.groupsOf['student-j'] = ['group-a'];
  });

  it('换了说法（没有「画」字）：Jev 判断要画、画成思维导图，种类和判断经过交给画图', async () => {
    h.routeDrawRequest.mockResolvedValueOnce(route({ form: 'tree' }));
    await call('POST', '/workspace-agent/course-1/stream', { ...ASK, content: '能把这节课的内容整理成一张图吗' });

    expect(h.routeDrawRequest).toHaveBeenCalledWith('能把这节课的内容整理成一张图吗', { previous: null, lastReply: null, forced: false });
    expect(h.streamDrawTurn).toHaveBeenCalledTimes(1);
    expect((h.streamDrawTurn.mock.calls[0] as unknown[])[1]).toMatchObject({
      prompt: '能把这节课的内容整理成一张图吗', form: 'tree', previous: null, route: { draw: true, decided_by: 'jev', form: 'tree' },
    });
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();
  });

  it('上一条是 AI 刚画的图：把它交给判断；判断是改图，就照着那张改', async () => {
    h.state.conversations = [{ id: 'conv-mine', user_id: 'student-j', space_id: 'space-a', course_id: 'course-1' } as never];
    const diagram = { type: 'graph', nodes: [{ id: 'a', label: '观点一' }, { id: 'b', label: '观点二' }], edges: [{ from: 'a', to: 'b', label: '质疑' }] };
    h.state.messages = [
      { conversation_id: 'conv-mine', role: 'user', content: '画一张这两个想法的关系图', created_at: '2026-10-09T00:00:01Z' },
      {
        conversation_id: 'conv-mine', role: 'assistant', content: '![关系图](u)\n\n画了两个想法的关系。', created_at: '2026-10-09T00:00:02Z',
        ai_metadata: { direct_image: true, drawing: { kind: 'diagram', caption: '画了两个想法的关系。', diagram } },
      },
    ];
    h.routeDrawRequest.mockResolvedValueOnce(route({ mode: 'edit', form: 'graph' }));
    await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-a', conversation_id: 'conv-mine', content: '把第二个框改成检索练习' });

    const previous = { request: '画一张这两个想法的关系图', caption: '画了两个想法的关系。', kind: 'diagram', diagram };
    expect(h.routeDrawRequest).toHaveBeenCalledWith('把第二个框改成检索练习', { previous, lastReply: null, forced: false });
    expect((h.streamDrawTurn.mock.calls[0] as unknown[])[1]).toMatchObject({ previous, form: 'graph', route: { mode: 'edit' } });
  });

  it('上一条是文字回答：回答交给判断（「把上面的画成图」）；判断是新画就不带上一张', async () => {
    h.state.conversations = [{ id: 'conv-mine', user_id: 'student-j', space_id: 'space-a', course_id: 'course-1' } as never];
    h.state.messages = [
      { conversation_id: 'conv-mine', role: 'user', content: '检索练习怎么做？', created_at: '2026-10-09T00:00:01Z' },
      { conversation_id: 'conv-mine', role: 'assistant', content: '分四步：合上材料、回想、对答案、找错。', created_at: '2026-10-09T00:00:02Z' },
    ];
    h.routeDrawRequest.mockResolvedValueOnce(route({ form: 'timeline' }));
    await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-a', conversation_id: 'conv-mine', content: '把上面的步骤用流程图表示出来' });
    expect(h.routeDrawRequest).toHaveBeenCalledWith('把上面的步骤用流程图表示出来', { previous: null, lastReply: '分四步：合上材料、回想、对答案、找错。', forced: false });
    expect((h.streamDrawTurn.mock.calls[0] as unknown[])[1]).toMatchObject({ previous: null, form: 'timeline' });
  });

  it('正则会误认的「画一张图需要注意什么」：Jev 判断不是要画，照常对话', async () => {
    h.routeDrawRequest.mockResolvedValueOnce(route({ draw: false, rule: true }));
    await call('POST', '/workspace-agent/course-1/stream', { ...ASK, content: '画一张图需要注意什么？' });
    expect(h.streamDrawTurn).not.toHaveBeenCalled();
    expect(h.runAgentLoopStream).toHaveBeenCalledTimes(1);
  });

  it('按了「画图」：一定画，判断只定改图还是新画', async () => {
    await call('POST', '/workspace-agent/course-1/stream', { ...ASK, content: '一棵知识之树', force_draw: true });
    expect(h.routeDrawRequest).toHaveBeenCalledWith('一棵知识之树', expect.objectContaining({ forced: true }));
    expect(h.streamDrawTurn).toHaveBeenCalledTimes(1);
  });

  it('带了附件：不问要不要画，照常对话', async () => {
    await call('POST', '/workspace-agent/course-1/stream', {
      ...ASK, content: '画一张这张图的示意图', attachments: [{ name: 'a.png', mime_type: 'image/png', data_url: 'data:image/png;base64,iVBORw0KGgo=' }],
    });
    expect(h.routeDrawRequest).not.toHaveBeenCalled();
  });
});

/**
 * 2026-10-06 用户：总结时助手要读得到 AI 反馈——几条被采纳、插入 AI 内容时选没选 GenAI 支架。
 * 以前它只能说「属于平台后台埋点，工具未返回，需你从后台补入」。
 */
describe('总结时读得到 AI 反馈和 AI 内容插入', () => {
  const fb = (id: string, user: string, note: string, status: string, trigger: string, extra: Partial<{ rejection_tag: string; published_note_id: string; review: string }> = {}) => ({
    id, note_id: note, space_id: 'space-a', user_id: user, trigger_type: trigger, status,
    rejection_tag: extra.rejection_tag ?? null, published_note_id: extra.published_note_id ?? null,
    trigger_context: extra.review ? { rationale: 'r', publication_review: { state: extra.review } } : { rationale: 'r' },
  });
  const ins = (id: string, user: string, note: string, scaffold: string | null, from: { feedback?: string; message?: string }) => ({
    id, note_id: note, space_id: 'space-a', user_id: user, scaffold_id: scaffold, reason_tag: null,
    feedback_id: from.feedback ?? null, source_message_id: from.message ?? null,
  });
  const ask = (extra: Record<string, unknown> = {}) =>
    call('POST', '/workspace-agent/course-1/stream', { ...ASK, content: '总结一下这个空间的讨论', space_id: 'space-a', ...extra });
  const lineOf = (prompt: string, start: string) => prompt.split('\n').find(l => l.startsWith(start)) ?? '';

  beforeEach(() => {
    h.state.feedbacks = [
      fb('fb1', 'student-a', 'n-a1', 'accepted', 'no_evidence', { published_note_id: 'pub-1' }),
      fb('fb2', 'student-a', 'n-a1', 'accepted', 'no_evidence', { review: 'pending' }),
      fb('fb3', 'student-c', 'n-a2', 'rejected', 'no_reasoning', { rejection_tag: 'already_considered' }),
      fb('fb4', 'student-c', 'n-a2', 'new', 'unclear'),
    ];
    h.state.insertions = [
      ins('i1', 'student-a', 'n-a1', 'sc-explain', { feedback: 'fb1' }),
      ins('i2', 'student-c', 'n-a2', 'sc-differ', { message: 'm1' }),
      ins('i3', 'student-c', 'n-a2', 'sc-explain', { message: 'm2' }),
    ];
    h.state.scaffolds = [
      { id: 'sc-explain', title: 'GenAI对这个概念的解释是', metadata: { gai: true } },
      { id: 'sc-differ', title: 'GenAI和我看法不同的地方在于', metadata: { gai: true } },
    ];
    h.state.profiles = [{ id: 'student-a', full_name: '林晓' }, { id: 'student-c', full_name: '周子涵' }];
  });

  it('教师：反馈几条、采纳几条（发布了几条、还差几条）、不同意的理由、插入都选了 GenAI 支架、按人分', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    const res = await ask();

    expect(res.status).toBe(200);
    const prompt = promptSent();
    expect(prompt).toContain('never say these figures are unavailable');
    expect(prompt).toContain('AI feedback cards sent to students: 4 card(s); adopted 2 (1 posted on the canvas as their own notes, 1 still waiting for the student\'s revision)');
    expect(prompt).toContain('disagreed 1 (我已经考虑过了 1)');
    expect(prompt).toContain('not handled yet 1');
    expect(prompt).toContain('By type: 缺证据 2, 缺推理 1, 表意不清 1.');
    expect(prompt).toContain('AI content inserted into notes: 3 time(s), every one with a GenAI scaffold.');
    expect(prompt).toContain('Scaffolds chosen: 「GenAI对这个概念的解释是」 2, 「GenAI和我看法不同的地方在于」 1.');
    expect(prompt).toContain('Inserted from AI feedback cards 1, from AI conversations 2.');
    expect(prompt).toContain('林晓: 2 card(s) (adopted 2, put into the note 0, disagreed 0), 1 insertion(s) (GenAI scaffold 1)');
    expect(prompt).toContain('周子涵: 2 card(s) (adopted 0, put into the note 0, disagreed 1), 2 insertion(s) (GenAI scaffold 2)');
  });

  it('学生：只有自己的反馈和画布上公开的；看不到别人收到几条、不同意几条，也看不到名字', async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    const prompt = promptSent();
    expect(prompt).toContain('Your own AI feedback cards: 2 card(s); adopted 2 (1 posted on the canvas as their own notes');
    expect(prompt).toContain('Your own AI content insertions: 1 time(s), every one with a GenAI scaffold.');
    const visible = lineOf(prompt, '- Visible to everyone on the canvas:');
    expect(visible).toContain('1 adopted AI feedback card(s) posted as notes');
    expect(visible).toContain('3 time(s), every one with a GenAI scaffold');
    // 反馈卡是私人的：全班的插入不说哪几次来自反馈卡
    expect(visible).not.toContain('feedback cards 1');
    expect(prompt).not.toContain('周子涵');
    expect(prompt).not.toContain('林晓');
    expect(prompt).not.toContain('By person');
    expect(prompt).not.toContain('我已经考虑过了');
    expect(prompt).not.toContain('4 card(s)');
  });

  it('勾了笔记：只算这几条笔记上的', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    const res = await ask({ note_ids: ['n-a2'] });

    expect(res.status).toBe(200);
    const prompt = promptSent();
    expect(prompt).toContain('AI feedback and AI content on the 1 selected note(s)');
    expect(prompt).toContain('AI feedback cards sent to students: 2 card(s); adopted 0;');
    expect(prompt).toContain('AI content inserted into notes: 2 time(s), every one with a GenAI scaffold.');
    expect(prompt).not.toContain('林晓');
  });

  it('采纳后学生改了原笔记、判定已回应：算「在原笔记里回应了」，不算还在等', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    h.state.feedbacks = [fb('fb5', 'student-a', 'n-a1', 'accepted', 'no_evidence', { review: 'addressed' })];
    await ask();

    const prompt = promptSent();
    expect(prompt).toContain('adopted 1 (0 posted on the canvas as their own notes, 1 answered by the student\'s own revision of the original note, so no separate note)');
    expect(prompt).not.toContain('still waiting');
  });

  it('这个空间还没有反馈和插入：明说 none，不让模型说「没有数据」', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    h.state.feedbacks = [];
    h.state.insertions = [];
    await ask();

    const prompt = promptSent();
    expect(prompt).toContain('AI feedback cards sent to students: none');
    expect(prompt).toContain('AI content inserted into notes: none');
  });

  it('查记录出错：照常回答，只是提示里少了这一段', async () => {
    h.state.failAiStats = true;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await ask();
    errorLog.mockRestore();

    expect(res.status).toBe(200);
    expect(res.text).toContain('AI 的回复');
    expect(promptSent()).not.toContain('from the platform\'s own records (these are the real figures');
  });
});

/**
 * 2026-10-06：提示词写着「能生成 Word 和图表，一律调 generate_summary_doc 等工具」，
 * 可这个助手只拿 connection_scout 那几个工具，那四个又只给教师，谁也没拿到过。
 * 模型照着提示词就可能自称做好了文件、编出下载链接。
 * 这里换成真的工具注册表和真的 buildAgentContext，按身份核对：
 * 发给模型的提示词里点名的每个工具，都在同一次调用的工具清单里。
 */
describe('提示词里点名的工具，这个身份都真的拿得到', () => {
  type Tool = { function: { name: string } };
  type Role = 'student' | 'teacher' | 'admin';
  const fakeTools = h.getToolsForRole.getMockImplementation()!;
  const fakeContext = h.buildAgentContext.getMockImplementation()!;
  let toolsFor: (role: Role) => Tool[] = () => [];
  let realContext: typeof fakeContext = fakeContext;
  let everyToolName: string[] = [];

  beforeAll(async () => {
    const tools = await vi.importActual<typeof import('../services/agentTools')>('../services/agentTools');
    const registry = tools.createDefaultRegistry();
    toolsFor = role => registry.getToolsForRole(role) as Tool[];
    everyToolName = [...new Set((['student', 'teacher', 'admin'] as const).flatMap(r => toolsFor(r).map(t => t.function.name)))];
    const context = await vi.importActual<typeof import('../services/agentContext')>('../services/agentContext');
    realContext = context.buildAgentContext as unknown as typeof fakeContext;
  });

  beforeEach(() => {
    h.getToolsForRole.mockImplementation(role => toolsFor(role as Role));
    h.buildAgentContext.mockImplementation(realContext);
  });

  afterEach(() => {
    h.getToolsForRole.mockImplementation(fakeTools);
    h.buildAgentContext.mockImplementation(fakeContext);
  });

  it.each([
    ['学生', { id: 'student-a', role: 'student' }, 'student'],
    ['凭学生验证码入课的教师账号', { id: 'teacher-joined', role: 'teacher' }, 'student'],
    ['课程教师', { id: 'teacher-1', role: 'teacher' }, 'teacher'],
    ['管理员', { id: 'teacher-1', role: 'admin' }, 'admin'],
  ] as const)('%s', async (_who, user, role) => {
    h.state.user = { ...user };
    const res = await call('POST', '/workspace-agent/course-1/stream', {
      ...ASK, content: '把这个空间的讨论整理成 Word 报告，附一张参与度图表', space_id: 'space-a',
    });

    expect(res.status).toBe(200);
    expect(h.getToolsForRole).toHaveBeenLastCalledWith(role);
    const { systemPrompt, tools } = h.runAgentLoopStream.mock.calls[0][0] as unknown as { systemPrompt: string; tools: Tool[] };
    const offered = tools.map(t => t.function.name);
    const named = everyToolName.filter(name => new RegExp(`\\b${name}\\b`).test(systemPrompt));

    // 清单里的工具都写进了提示词：核对的是完整的提示词，不是一段假的
    expect(offered.length).toBeGreaterThan(0);
    expect(named).toEqual(expect.arrayContaining(offered));
    expect(named.filter(name => !offered.includes(name))).toEqual([]);
  });
});

describe('课程资料：每轮自动检索，回答下面有来源卡片', () => {
  const hit = (id: string, title: string, page: number) => ({
    chunkId: id, documentId: `d-${id}`, title, headingPath: '方法', content: `${title}的正文`, similarity: 0.6, relevance: 0.8,
    matchedBy: 'vector' as const, pageStart: page, pageEnd: page, noteId: `note-${id}`, materialId: null,
  });
  const runWith = (registry: KbCitationRegistry) => ({
    available: Promise.resolve(true),
    result: Promise.resolve({
      section: 'COURSE MATERIALS — test section\n\n[1] 论文A',
      citations: registry,
      step: { name: 'search_course_materials', summary: '找到 1 段相关资料', ms: 12 },
    }) as Promise<unknown>,
  });
  const eventsOf = (text: string) => text.split('\n\n').filter(b => b.startsWith('data: {')).map(b => JSON.parse(b.slice(6)));
  const savedReply = () => h.state.inserts.find(i => i.table === 'agent_messages' && (i.payload as any).role === 'assistant')?.payload as any;
  // 每人每分钟 20 次的限流，前面的用例已经用掉了 student-a 的额度：这一组换同组的另一个学生
  beforeEach(() => {
    h.state.user = { id: 'student-kb', role: 'student' };
    h.state.groupsOf['student-kb'] = ['group-a'];
  });

  it('按提问的人检索、记作 workspace_ai，追问带上前一句；先推这一步和来源卡片，资料进提示词，回答存下 kb_sources', async () => {
    const registry = new KbCitationRegistry([hit('a', '论文A', 3)]);
    h.startKbRetrieval.mockReturnValueOnce(runWith(registry));
    const res = await call('POST', '/workspace-agent/course-1/stream', {
      ...ASK, content: '那第二点呢', history: [{ role: 'user', content: '知识建构有哪些原则' }, { role: 'assistant', content: '有十二条' }],
    });

    expect(res.status).toBe(200);
    expect(h.startKbRetrieval).toHaveBeenCalledWith(expect.objectContaining({
      courseId: 'course-1', source: 'workspace_ai', question: '那第二点呢', earlierQuestions: ['知识建构有哪些原则'],
      contextTitle: null, viewer: expect.objectContaining({ id: 'student-kb' }),
    }));
    const events = eventsOf(res.text);
    expect(events.filter(e => e.toolName === 'search_course_materials').map(e => e.toolStatus)).toEqual(['running', 'used']);
    expect(events.find(e => e.kbSources)?.kbSources).toEqual(registry.sources);
    const prompt = promptSent();
    expect(prompt).toContain('COURSE MATERIALS — test section');
    expect(prompt.indexOf('COURSE MATERIALS')).toBeLessThan(prompt.indexOf('the student chose'));
    expect(savedReply().ai_metadata.kb_sources).toEqual(registry.sources);
    expect(savedReply().ai_metadata.tool_steps[0]).toMatchObject({ name: 'search_course_materials', summary: '找到 1 段相关资料' });
  });

  it('助手这一轮又调工具查课程资料：工具拿到这一轮的编号，查到新段落就重发来源卡片', async () => {
    const registry = new KbCitationRegistry([hit('a', '论文A', 3)]);
    h.startKbRetrieval.mockReturnValueOnce(runWith(registry));
    h.runAgentLoopStream.mockImplementationOnce((opts: any) => (async function* () {
      await opts.executeToolFn('search_course_materials', { query: '访谈' });
      registry.add([hit('b', '论文B', 9)]);
      yield { type: 'tool_call', toolCall: { id: 't1', function: { name: 'search_course_materials', arguments: '{}' } } };
      yield { type: 'tool_result', toolName: 'search_course_materials', result: { success: true, data: { results: [{}] } } };
      yield { type: 'token', content: '见 [2]' };
      yield { type: 'done', result: { iterations: 2 } };
    })() as any);
    const res = await call('POST', '/workspace-agent/course-1/stream', ASK);

    expect(h.executeTool).toHaveBeenCalledWith('search_course_materials', { query: '访谈' }, expect.objectContaining({ kbCitations: registry }));
    expect(eventsOf(res.text).filter(e => e.kbSources).map(e => e.kbSources.length)).toEqual([1, 2]);
    expect(savedReply().ai_metadata.kb_sources.map((c: { n: number }) => c.n)).toEqual([1, 2]);
  });

  it('课里没有资料：不推这一步，提示词里没有资料段，回答不存 kb_sources', async () => {
    const res = await call('POST', '/workspace-agent/course-1/stream', ASK);
    const events = eventsOf(res.text);
    expect(events.some(e => e.toolName === 'search_course_materials' || e.kbSources)).toBe(false);
    expect(promptSent()).not.toContain('COURSE MATERIALS');
    expect(savedReply().ai_metadata.kb_sources).toBeUndefined();
  });
});

/**
 * 2026-10-07：阅读页「问知识空间助手」把抽出的正文当附件传过来，可正文只交给了 buildAgentContext 的
 * userMessage——那个参数只拿去判断过度依赖，发给模型的消息来自 history，模型从来没读到过附件；图片也没挂上。
 * 这一组用真的 buildAgentContext，核对的是真正发给模型的消息。
 */
describe('附件：正文和图片进这一轮的模型输入，不进库', () => {
  type LoopOpts = { providerId: string; model: string; systemPrompt: string; messages: Array<{ role: string; content: unknown }> };
  const fakeContext = h.buildAgentContext.getMockImplementation()!;
  let realContext: typeof fakeContext = fakeContext;
  const QUESTION = '这份讲义的第一条原则是什么意思？';
  const DOC_TEXT = '知识建构的十二条原则之一：真实的想法、真实的问题';
  const doc = (text?: string) => ({ file_url: 'https://files.test/handout.pdf', file_name: '讲义.pdf', mime_type: 'application/pdf', text });
  const image = { file_url: 'https://files.test/board.png', file_name: '白板.png', mime_type: 'image/png' };
  const ask = (extra: Record<string, unknown>) =>
    call('POST', '/workspace-agent/course-1/stream', { ...ASK, content: QUESTION, space_id: 'space-a', ...extra });
  const loopCalls = () => h.runAgentLoopStream.mock.calls.map(([opts]) => opts as unknown as LoopOpts);
  const sentMessages = () => loopCalls()[0].messages;
  const lastQuestion = () => [...sentMessages()].reverse().find(m => m.role === 'user')?.content;
  const storedRows = () => h.state.inserts.filter(i => i.table === 'agent_messages').map(i => i.payload);
  const eventsOf = (text: string) => text.split('\n\n').filter(b => b.startsWith('data: {')).map(b => JSON.parse(b.slice(6)));

  beforeAll(async () => {
    const context = await vi.importActual<typeof import('../services/agentContext')>('../services/agentContext');
    realContext = context.buildAgentContext as unknown as typeof fakeContext;
  });

  // 限流按人算，前面的用例用掉了 student-a 的额度
  beforeEach(() => {
    h.state.user = { id: 'student-files', role: 'student' };
    h.state.groupsOf['student-files'] = ['group-a'];
    h.buildAgentContext.mockImplementation(realContext);
  });

  afterEach(() => {
    h.buildAgentContext.mockImplementation(fakeContext);
  });

  it('文档正文接在这一轮的提问后面，模型读得到；前面的对话不动，库里只有提问本身', async () => {
    const res = await ask({
      attachments: [doc(DOC_TEXT)],
      history: [{ role: 'user', content: '上一问' }, { role: 'assistant', content: '上一答' }],
    });

    expect(res.status).toBe(200);
    expect(sentMessages().map(m => m.content)).toEqual([
      '上一问', '上一答', `${QUESTION}\n\n[附件 讲义.pdf 的内容]\n${DOC_TEXT}`,
    ]);
    // 只有文档：不换模型，不加读图规则
    expect(loopCalls()[0]).toMatchObject({ providerId: 'deepseek', model: 'deepseek-chat' });
    expect(loopCalls()[0].systemPrompt).not.toContain(IMAGE_TURN_RULES);
    // 过度依赖照旧按「提问 + 附件」判断
    expect(h.buildAgentContext).toHaveBeenCalledWith(expect.objectContaining({ userMessage: `${QUESTION}\n\n[附件 讲义.pdf 的内容]\n${DOC_TEXT}` }));
    expect(storedRows()).toEqual([
      expect.objectContaining({ role: 'user', content: QUESTION }),
      expect.objectContaining({ role: 'assistant', content: 'AI 的回复' }),
    ]);
    expect(JSON.stringify([h.state.inserts, h.state.updates])).not.toContain(DOC_TEXT);
  });

  it('接着库里的对话问：正文接在库里读回来的这一问上，前面几轮不带', async () => {
    h.state.conversations = [{ id: 'conv-doc', user_id: 'student-files', space_id: 'space-a', course_id: 'course-1' }];
    // 真库里这一问先存下、再读回来，是最后一条；假库的 insert 不回写，直接放进去
    h.state.messages = [
      { conversation_id: 'conv-doc', role: 'user', content: '上一问', created_at: '1' },
      { conversation_id: 'conv-doc', role: 'assistant', content: '上一答', created_at: '2' },
      { conversation_id: 'conv-doc', role: 'user', content: QUESTION, created_at: '3' },
    ];
    const res = await ask({ conversation_id: 'conv-doc', attachments: [doc(DOC_TEXT)] });

    expect(res.status).toBe(200);
    expect(sentMessages().map(m => m.content)).toEqual([
      '上一问', '上一答', `${QUESTION}\n\n[附件 讲义.pdf 的内容]\n${DOC_TEXT}`,
    ]);
    expect(storedRows()[0]).toEqual(expect.objectContaining({ role: 'user', content: QUESTION }));
    expect(JSON.stringify([h.state.inserts, h.state.updates])).not.toContain(DOC_TEXT);
  });

  it('正文抽不出来：明说读不到，不让模型猜', async () => {
    const res = await ask({ attachments: [doc()] });

    expect(res.status).toBe(200);
    const question = String(lastQuestion());
    expect(question.startsWith(QUESTION)).toBe(true);
    expect(question).toContain('[学生附上了文件 讲义.pdf，但它的文字内容抽不出来');
    expect(question).toContain('不要猜测内容');
  });

  it('图片挂成图片块，换成看得懂图的型号，加上读图规则；不走画图，库里只有提问', async () => {
    const res = await ask({ attachments: [image] });

    expect(res.status).toBe(200);
    expect(lastQuestion()).toEqual([
      { type: 'text', text: QUESTION },
      { type: 'image_url', image_url: { url: image.file_url, detail: 'high' } },
    ]);
    // ASK 选的 deepseek-chat 看不了图，同一家换成 deepseek-flash
    expect(loopCalls()[0]).toMatchObject({ providerId: 'deepseek', model: 'deepseek-flash' });
    expect(loopCalls()[0].systemPrompt).toContain(IMAGE_TURN_RULES);
    expect(eventsOf(res.text)).toContainEqual({ modelSwitched: 'deepseek-flash', providerId: 'deepseek', reason: 'vision' });
    expect(h.streamDrawTurn).not.toHaveBeenCalled();
    expect(storedRows()[0]).toEqual(expect.objectContaining({ role: 'user', content: QUESTION }));
  });

  it('选的那家一个能看图的型号都没有：先用课里能看图的那家，选的那家排后面兜底', async () => {
    h.state.otherConfigs = [{ provider_id: 'zhipu', api_key_encrypted: 'enc', endpoint_url: null, enabled_models: ['glm-5.3', 'glm-4.6v'] }];
    h.runAgentLoopStream.mockImplementationOnce(() => (async function* () {
      yield { type: 'error', error: 'zhipu busy' };
    })() as any);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await ask({ provider_id: 'moonshot', model: 'kimi-k2.6', attachments: [image] });
    warn.mockRestore();

    expect(res.status).toBe(200);
    expect(eventsOf(res.text)).toContainEqual({ modelSwitched: 'glm-4.6v', providerId: 'zhipu', reason: 'vision' });
    expect(loopCalls().map(o => `${o.providerId}/${o.model}`)).toEqual(['zhipu/glm-4.6v', 'moonshot/kimi-k2.6']);
    expect(res.text).toContain('AI 的回复');
  });
});


describe('知识空间对话历史读取故障', () => {
  it('历史读不到时停止调用模型，不将追问当成新对话', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    h.state.conversations = [{ id: 'history-read-fail', user_id: 'teacher-1', space_id: 'space-a', course_id: 'course-1', agent_type: 'workspace' }];
    h.state.failHistory = true;
    const res = await call('POST', '/workspace-agent/course-1/stream', { ...ASK, space_id: 'space-a', conversation_id: 'history-read-fail' });
    expect(res.status).toBe(500);
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();
  });
});
