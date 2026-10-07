import 'express-async-errors';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 个人助手带 context_course_id 时，会把这门课最近 20 条笔记（标题 + 150 字摘录）写进系统提示，
 * 再把笔记最多的那个空间交给 search_notes 等工具。原先它只查「是不是课程成员」，然后取全课
 * 所有空间：组 A 的学生能读到组 B 的笔记，工具也会跑在组 B 的空间上。
 * 教师模式（备课 / 学情分析）原先按平台身份放行：教师账号拿学生验证码入课，就拿到全课的教师工具。
 * 改成按课内教职放行后，/configs 还把所有课一视同仁地列给前端，前端默认选中的课可能正是只听课的那门，
 * 第一句话就 403；所以 /configs 给每门课带上课内身份和 teacherModes，且必须和 /stream 的门逐课一致。
 *
 * 路由挂在真实的 Express 上跑，accessControl 用真的，只替换数据库、鉴权、模型循环和工具注册表。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const SECRET = '第二组还没公开的草稿';

  const seed = (): Record<string, Row[]> => ({
    courses: [
      { id: 'course-1', title: '知识建构', instructor_id: 'owner-1' },
      { id: 'course-2', title: '另一门课', instructor_id: 'owner-2' },
      { id: 'course-3', title: '早期建的课', instructor_id: 'owner-1' }, // course_members 里没有创建者那一行
    ],
    spaces: [
      { id: 'space-shared', course_id: 'course-1', group_id: null, created_at: '2026-09-01T00:00:00Z' },
      { id: 'space-a', course_id: 'course-1', group_id: 'group-a', created_at: '2026-09-02T00:00:00Z' },
      { id: 'space-b', course_id: 'course-1', group_id: 'group-b', created_at: '2026-09-03T00:00:00Z' },
      { id: 'space-2', course_id: 'course-2', group_id: null, created_at: '2026-09-04T00:00:00Z' },
    ],
    course_members: [
      { course_id: 'course-1', user_id: 'owner-1', role: 'teacher' },
      { course_id: 'course-1', user_id: 'co-teacher', role: 'teacher' }, // 课程管理员
      { course_id: 'course-1', user_id: 'teacher-joined', role: 'student' }, // 教师账号凭学生验证码入课
      { course_id: 'course-1', user_id: 'teacher-invited', role: 'member' }, // 被邀请、还没设为管理员
      { course_id: 'course-1', user_id: 'student-a', role: 'student' },
      { course_id: 'course-1', user_id: 'student-b', role: 'student' },
      { course_id: 'course-1', user_id: 'student-forged', role: 'teacher' }, // 学生账号直连数据库给自己写的管理员行
      { course_id: 'course-2', user_id: 'owner-2', role: 'teacher' },
      { course_id: 'course-2', user_id: 'co-teacher', role: 'student' }, // 在另一门课只是学生
    ],
    group_members: [
      { group_id: 'group-a', user_id: 'student-a' },
      { group_id: 'group-a', user_id: 'teacher-joined' },
      { group_id: 'group-b', user_id: 'student-b' },
    ],
    // 组 B 的笔记又新又多：先按 updated_at 取 20 条再过滤的话，组 A 的学生一条本组笔记都拿不到
    notes: [
      { id: 'n-shared', space_id: 'space-shared', title: '共享', content: '<p>全班共享的问题</p>', deleted_at: null, updated_at: '2026-09-10T00:00:00Z' },
      { id: 'n-a1', space_id: 'space-a', title: '一', content: '<p>第一组的想法一</p>', deleted_at: null, updated_at: '2026-09-11T00:00:00Z' },
      { id: 'n-a2', space_id: 'space-a', title: '二', content: '<p>第一组的想法二</p>', deleted_at: null, updated_at: '2026-09-12T00:00:00Z' },
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `n-b${i}`, space_id: 'space-b', title: `B${i}`, content: `<p>${SECRET}之${i}</p>`,
        deleted_at: null, updated_at: `2026-09-20T00:${String(i).padStart(2, '0')}:00Z`,
      })),
      { id: 'n-2', space_id: 'space-2', title: '另一门', content: '<p>另一门课的笔记</p>', deleted_at: null, updated_at: '2026-09-15T00:00:00Z' },
    ],
    teacher_ai_configs: ['course-1', 'course-2', 'course-3'].map(course_id => ({
      course_id, provider_id: 'deepseek', api_key_encrypted: 'enc', endpoint_url: null, is_verified: true, enabled_models: ['deepseek-chat'],
    })),
  });

  const db = seed();
  const state = {
    user: { id: 'student-a', role: 'student' } as { id: string; role: string },
    inserts: [] as { table: string; payload: unknown }[],
    updates: [] as { table: string; payload: unknown }[],
  };
  const failing = new Set<string>();
  let seq = 0;

  // 链式调用按条件在内存表里取行：eq / in / is / not 过滤，order / limit 照做，insert / update 记账
  const from = (table: string) => {
    let columns = '*';
    let action: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | null = null;
    const filters: ((r: Row) => boolean)[] = [];
    let sort: { col: string; asc: boolean } | null = null;
    let max = Infinity;

    const view = (r: Row) => (table === 'spaces' && columns.includes('courses')
      ? { ...r, courses: { instructor_id: db.courses.find(c => c.id === r.course_id)?.instructor_id ?? null } }
      : { ...r });
    const run = (terminal: 'single' | 'maybeSingle' | 'many') => {
      if (failing.has(table)) return { data: null, error: { message: 'connection reset' } };
      if (action === 'insert') {
        const row = { id: `${table}-${++seq}`, ...payload };
        (db[table] ??= []).push(row);
        return { data: terminal === 'many' ? [row] : row, error: null };
      }
      const matched = (db[table] ?? []).filter(r => filters.every(f => f(r)));
      if (action === 'update') {
        matched.forEach(r => Object.assign(r, payload));
        return { data: null, error: null };
      }
      const sorted = sort
        ? [...matched].sort((x, y) => {
          const [a, b] = [x[sort!.col] as string, y[sort!.col] as string];
          return (a > b ? 1 : a < b ? -1 : 0) * (sort!.asc ? 1 : -1);
        })
        : matched;
      const rows = sorted.slice(0, max).map(view);
      if (terminal === 'many') return { data: rows, error: null };
      if (!rows[0]) return { data: null, error: terminal === 'single' ? { message: 'no rows' } : null };
      return { data: rows[0], error: null };
    };

    const builder: Record<string, unknown> = {
      select: (cols = '*') => { columns = cols; return builder; },
      insert: (p: Row) => { action = 'insert'; payload = p; state.inserts.push({ table, payload: p }); return builder; },
      update: (p: Row) => { action = 'update'; payload = p; state.updates.push({ table, payload: p }); return builder; },
      eq: (col: string, value: unknown) => { filters.push(r => r[col] === value); return builder; },
      in: (col: string, values: unknown[]) => { filters.push(r => values.includes(r[col])); return builder; },
      is: (col: string, value: unknown) => { filters.push(r => (r[col] ?? null) === value); return builder; },
      not: (col: string, _op: string, value: unknown) => { filters.push(r => (r[col] ?? null) !== value); return builder; },
      or: () => builder,
      order: (col: string, opts?: { ascending?: boolean }) => { sort = { col, asc: opts?.ascending !== false }; return builder; },
      limit: (n: number) => { max = n; return builder; },
      single: async () => run('single'),
      maybeSingle: async () => run('maybeSingle'),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve(run('many')).then(onOk, onFail),
    };
    return builder;
  };

  const reset = () => {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, seed());
    state.user = { id: 'student-a', role: 'student' };
    state.inserts.length = 0;
    state.updates.length = 0;
    failing.clear();
  };

  // 注册表只按角色筛：'teacher' 的工具只给教师 / 管理员，'student' 的只给学生，口径同真的 ToolRegistry
  const TOOL_ACCESS: Record<string, 'all' | 'teacher' | 'student'> = {
    read_note: 'all', get_note_context: 'all', search_notes: 'all', analyze_argument: 'all', compare_notes: 'all',
    get_workspace_summary: 'all', save_reflection: 'all', generate_image: 'all', web_search: 'all', find_sources: 'student',
    lesson_scaffold: 'teacher', class_analytics: 'teacher', suggest_triggers: 'teacher', list_note_discussions: 'teacher',
    generate_summary_doc: 'teacher', export_notes: 'teacher', analyze_engagement: 'teacher', compare_periods: 'teacher',
    get_learner_insights: 'teacher', build_embeddings: 'teacher', save_teaching_insight: 'teacher',
  };
  const getToolsForRole = vi.fn((role: string) => Object.entries(TOOL_ACCESS)
    .filter(([, access]) => access === 'all' || (access === 'teacher' ? role !== 'student' : role === 'student'))
    .map(([name]) => ({ type: 'function', function: { name, description: '', parameters: {} } })));
  // search_notes 真的实现只读 context.spaceId 这一个空间
  const executeTool = vi.fn(async (_name: string, _args: unknown, ctx: { spaceId: string }) => ({
    success: true,
    data: (db.notes ?? []).filter(n => n.space_id === ctx.spaceId).map(n => n.content),
  }));

  type LoopOpts = {
    systemPrompt: string;
    messages: unknown[];
    tools: { function: { name: string } }[];
    executeToolFn: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
  };
  // 模型先调一次 search_notes，把工具结果当作它读到的东西写回来——工具读到什么，学生就看得到什么
  const runAgentLoopStream = vi.fn((opts: LoopOpts) => (async function* () {
    const found = await opts.executeToolFn('search_notes', { query: '别组在写什么' });
    yield { type: 'tool_call', toolCall: { id: 't1', function: { name: 'search_notes', arguments: '{}' } } };
    yield { type: 'tool_result', toolName: 'search_notes' };
    yield { type: 'token', content: `找到：${JSON.stringify(found.data)}` };
    yield { type: 'done', result: { iterations: 2 } };
  })());

  return {
    db, state, failing, from, reset, SECRET,
    getToolsForRole,
    executeTool,
    runAgentLoopStream,
    // 真的 buildAgentContext 把 note.content 写进系统提示（Current note content），工具上下文带 spaceId
    buildAgentContext: vi.fn(async (p: {
      note: { id: string; title: string; content: string };
      spaceId: string; courseId: string; userId: string; userRole: string; userMessage?: string;
    }) => ({
      systemPrompt: `Current note content: ${p.note.content}`,
      messages: [{ role: 'user', content: p.userMessage ?? '' }],
      toolContext: {
        noteId: p.note.id, spaceId: p.spaceId, courseId: p.courseId, userId: p.userId,
        userRole: p.userRole, noteTitle: p.note.title, noteContent: p.note.content,
      },
      learnerProfile: null,
      overrelianceDetected: false,
    })),
    getTeacherContext: vi.fn(async () => ''),
    startRun: vi.fn(async () => ({ id: 'run-1' })),
  };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
}));
vi.mock('../services/aiProviderConfig', () => ({
  decryptProviderApiKey: () => 'sk-test',
  // 和真的一样给驼峰字段：路由按 providerId / enabledModels 套课程的菜单名单
  providerConfigToApi: (config: Record<string, unknown>) => ({
    id: config.id,
    courseId: config.course_id,
    providerId: config.provider_id,
    enabledModels: config.enabled_models ?? [],
  }),
}));
vi.mock('../services/agentLoop', () => ({ runAgentLoopStream: h.runAgentLoopStream }));
const draw = vi.hoisted(() => ({
  generateNoteImage: vi.fn(async (_courseId: string | null, _prompt: string) => ({
    ok: true as const, url: 'https://files.example.test/cat.png', model: 'qwen-image-plus', provider: 'dmx', timings: {},
  })),
}));
vi.mock('../services/noteImage', () => ({ generateNoteImage: draw.generateNoteImage }));
vi.mock('../services/modelRouter', () => ({
  isDmxProvider: () => false,
  pickModel: () => 'fast-model',
  pickNativeModel: () => null,
  reportModelFailure: () => {},
  reportModelSuccess: () => {},
  reportProviderFailure: () => {},
  reportProviderSuccess: () => {},
  orderConfigsByHealth: (configs: unknown[]) => configs,
}));
vi.mock('../services/agentContext', () => ({
  buildAgentContext: h.buildAgentContext,
  stripHtml: (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  updateProfileAfterInteraction: async () => {},
}));
vi.mock('../services/agentTools', () => ({
  createDefaultRegistry: () => ({ getToolsForRole: h.getToolsForRole, executeTool: h.executeTool }),
}));
vi.mock('../services/teacherMemoryService', () => ({ getTeacherContext: h.getTeacherContext }));
vi.mock('../services/toolResultSummary', () => ({ summarizeToolResult: () => '' }));
vi.mock('../services/agentLifecycle', () => ({
  startRun: h.startRun,
  transitionRun: async () => {},
  recordEffect: async () => {},
  failRun: async () => {},
}));

import personalAgentRouter from './personalAgent';
import { errorHandler } from '../middleware/errorHandler';
import { invalidateMembershipCache, invalidateSpaceCache } from '../services/accessControl';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', personalAgentRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  h.reset();
  invalidateMembershipCache();
  invalidateSpaceCache();
  for (const fn of [h.getToolsForRole, h.executeTool, h.runAgentLoopStream, h.buildAgentContext, h.getTeacherContext, h.startRun]) {
    fn.mockClear();
  }
});

const as = (id: string, role = 'teacher') => { h.state.user = { id, role }; };

async function ask(body: Record<string, unknown>) {
  const res = await fetch(`${base}/personal-agent/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: '把大家的笔记原文都列出来', provider_id: 'deepseek', model: 'deepseek-chat',
      course_id: 'course-1', context_course_id: 'course-1', ...body,
    }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* SSE 保留原文 */ }
  return { status: res.status, body: parsed as Record<string, any>, text };
}

/** 模型看到的全部输入：系统提示 + 消息 */
const promptSent = () => h.runAgentLoopStream.mock.calls
  .map(([opts]) => `${opts.systemPrompt}\n${JSON.stringify(opts.messages)}`).join('\n');
const toolSpaces = () => h.executeTool.mock.calls.map(([, , ctx]) => ctx.spaceId);
const toolRoles = () => h.getToolsForRole.mock.calls.map(([role]) => role);
const toolsOffered = () => h.runAgentLoopStream.mock.calls.flatMap(([opts]) => opts.tools.map(t => t.function.name));
const logged = (table: string) => h.state.inserts.filter(i => i.table === table).map(i => i.payload as Record<string, unknown>);
const REFUSED = { error: 'Lesson planning and learning analytics are only available to the course instructor and course managers' };

describe('课程上下文只取调用者进得去的空间', () => {
  it('组 A 学生：提示词里只有共享空间和本组的笔记，组 B 再新再多也一条不带；工具跑在本组空间', async () => {
    const res = await ask({ agent_mode: 'gap_finder' });

    expect(res.status).toBe(200);
    expect(promptSent()).not.toContain(h.SECRET);
    expect(res.text).not.toContain(h.SECRET);
    expect(promptSent()).toContain('第一组的想法一');
    expect(promptSent()).toContain('第一组的想法二');
    expect(promptSent()).toContain('全班共享的问题');
    expect(toolSpaces()).toEqual(['space-a']);
    expect(logged('ai_interventions')[0]).toMatchObject({ space_id: 'space-a' });
  });

  it('教师账号凭学生验证码入课（course_members.role=student）：和组 A 学生一样隔离，也按学生身份拿工具', async () => {
    as('teacher-joined');
    const res = await ask({ agent_mode: 'connection_scout' });

    expect(res.status).toBe(200);
    expect(promptSent()).not.toContain(h.SECRET);
    expect(res.text).not.toContain(h.SECRET);
    expect(promptSent()).toContain('第一组的想法一');
    expect(toolSpaces()).toEqual(['space-a']);
    expect(toolRoles()).toEqual(['student']);
    expect(h.getTeacherContext).not.toHaveBeenCalled();
  });

  it('被邀请、还没设为课程管理员的教师（role=member，不在任何组）：只有共享空间', async () => {
    as('teacher-invited');
    const res = await ask({ agent_mode: 'connection_scout' });

    expect(res.status).toBe(200);
    expect(promptSent()).not.toContain(h.SECRET);
    expect(promptSent()).not.toContain('第一组的想法');
    expect(promptSent()).toContain('全班共享的问题');
    expect(toolSpaces()).toEqual(['space-shared']);
  });

  it('上下文指到自己不在的课：那门课的笔记一条不带，工具也不落到那门课的空间上', async () => {
    const res = await ask({ agent_mode: 'gap_finder', context_course_id: 'course-2' });

    expect(res.status).toBe(200);
    expect(promptSent()).not.toContain('另一门课的笔记');
    expect(toolSpaces()).toEqual(['personal']);
    expect(logged('ai_interventions')[0]).toMatchObject({ space_id: null });
  });

  it('判定查询出错的空间一律跳过：宁可少带，不能带错', async () => {
    h.failing.add('group_members');
    const res = await ask({ agent_mode: 'gap_finder' });

    expect(res.status).toBe(200);
    expect(promptSent()).not.toContain(h.SECRET);
    expect(promptSent()).not.toContain('第一组的想法');
    expect(promptSent()).toContain('全班共享的问题');
    expect(toolSpaces()).toEqual(['space-shared']);
  });

  it.each([
    ['创建者', 'owner-1', 'teacher', 'teacher'],
    ['课程管理员', 'co-teacher', 'teacher', 'teacher'],
    ['平台管理员（不在课里）', 'platform-admin', 'admin', 'admin'],
  ])('%s照旧：每个组的笔记都在，主空间仍是笔记最多的那个，教师工具齐全', async (_label, userId, platformRole, toolRole) => {
    as(userId, platformRole);
    const res = await ask({ agent_mode: 'teaching_analyst' });

    expect(res.status).toBe(200);
    expect(promptSent()).toContain(h.SECRET);
    expect(toolSpaces()).toEqual(['space-b']);
    expect(toolRoles()).toEqual([toolRole]);
    expect(toolsOffered()).toEqual(expect.arrayContaining(['class_analytics', 'get_learner_insights', 'export_notes']));
    expect(h.getTeacherContext).toHaveBeenCalledWith(expect.objectContaining({ userId, courseId: 'course-1' }));
  });
});

describe('教师模式（备课 / 学情分析）按课内教职放行，不按平台身份', () => {
  it.each([
    ['教师账号凭学生验证码入课', 'teacher-joined', 'teacher', 'lesson_planner'],
    ['教师账号凭学生验证码入课', 'teacher-joined', 'teacher', 'teaching_analyst'],
    ['被邀请、还没设为课程管理员的教师', 'teacher-invited', 'teacher', 'lesson_planner'],
    ['学生', 'student-a', 'student', 'teaching_analyst'],
  ])('%s用 %s：403，不调模型、不写任何行', async (_label, userId, platformRole, mode) => {
    as(userId, platformRole);
    const res = await ask({ agent_mode: mode });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(REFUSED);
    expect(h.buildAgentContext).not.toHaveBeenCalled();
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();
    expect(h.startRun).not.toHaveBeenCalled();
    expect(h.state.inserts).toEqual([]);
    expect(h.state.updates).toEqual([]);
  });

  it('在 API key 那门课是管理员、在上下文那门课只是学生：403——空间级教师工具会跑在上下文那门课上', async () => {
    as('co-teacher');
    const res = await ask({ agent_mode: 'lesson_planner', context_course_id: 'course-2' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(REFUSED);
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();
    expect(h.state.inserts).toEqual([]);
  });

  it('课程管理员被撤销后立刻失去教师模式', async () => {
    as('co-teacher');
    expect((await ask({ agent_mode: 'lesson_planner' })).status).toBe(200);

    h.db.course_members.find(m => m.course_id === 'course-1' && m.user_id === 'co-teacher')!.role = 'member';
    invalidateMembershipCache();
    expect((await ask({ agent_mode: 'lesson_planner' })).status).toBe(403);
  });
});

describe('GET /personal-agent/configs：每门课带课内身份和 teacherModes，和 /stream 的门逐课一致', () => {
  type ListedCourse = { id: string; title: string; standing: string; teacherModes: boolean };

  async function listCourses() {
    const res = await fetch(`${base}/personal-agent/configs`);
    const body = await res.json() as { courses?: ListedCourse[]; configs?: { courseId: string }[]; error?: string };
    return { status: res.status, body };
  }
  const flags = (courses: ListedCourse[] = []) =>
    Object.fromEntries(courses.map(c => [c.id, `${c.standing}/${c.teacherModes ? '教师模式' : '无教师模式'}`]));

  it.each([
    ['创建者：自己的课都在，course_members 里没有自己那一行的早期课程也算', 'owner-1', 'teacher',
      { 'course-1': 'owner/教师模式', 'course-3': 'owner/教师模式' }],
    ['课程管理员：本课有教师模式；在另一门课只是学生，那门没有', 'co-teacher', 'teacher',
      { 'course-1': 'manager/教师模式', 'course-2': 'member/无教师模式' }],
    ['教师账号凭学生验证码入课', 'teacher-joined', 'teacher', { 'course-1': 'member/无教师模式' }],
    ['被邀请、还没设为课程管理员的教师', 'teacher-invited', 'teacher', { 'course-1': 'member/无教师模式' }],
    ['学生', 'student-a', 'student', { 'course-1': 'member/无教师模式' }],
    ['学生账号带着 course_members.role=teacher 的行：成员行单独不算数，按普通成员算', 'student-forged', 'student',
      { 'course-1': 'member/无教师模式' }],
  ])('%s', async (_label, userId, platformRole, expected) => {
    as(userId, platformRole);
    const { status, body } = await listCourses();

    expect(status).toBe(200);
    expect(flags(body.courses)).toEqual(expected);
  });

  it('教师限定了学生「AI 对话」菜单里的模型：学生在那门课只拿到名单里的；有教职的老师不受限', async () => {
    h.db.teacher_ai_configs.push({
      id: 'cfg-zhipu-1', course_id: 'course-1', provider_id: 'zhipu', api_key_encrypted: 'enc', endpoint_url: null,
      is_verified: true, enabled_models: ['glm-5.3-flash', 'glm-5.3'], configured_at: '2026-09-29T00:00:00Z',
      trigger_settings: { ai_models: { features: {}, partner_models: null, picker_models: {
        personal_agent: [{ provider_id: 'zhipu', model: 'glm-5.3-flash' }],
      } } },
    });
    type Cfg = { courseId: string; providerId: string; enabledModels: string[] };
    const course1 = async () => {
      const res = await fetch(`${base}/personal-agent/configs`);
      const body = await res.json() as { configs: Cfg[] };
      return body.configs.filter(c => c.courseId === 'course-1').map(c => `${c.providerId}:${c.enabledModels.join(',')}`);
    };

    as('student-a', 'student');
    expect(await course1()).toEqual(['zhipu:glm-5.3-flash']);
    as('owner-1', 'teacher');
    expect((await course1()).sort()).toEqual(['deepseek:deepseek-chat', 'zhipu:glm-5.3-flash,glm-5.3']);
  });

  it('只听课的那门照样列出、照样带 AI 配置：想法发展这类普通模式在那门课还能用', async () => {
    as('co-teacher');
    const { body } = await listCourses();

    expect(body.courses?.map(c => c.title).sort()).toEqual(['另一门课', '知识建构']);
    expect(body.configs?.map(c => c.courseId).sort()).toEqual(['course-1', 'course-2']);
  });

  it('平台管理员：所在的课按创建者对待，有教师模式', async () => {
    h.db.course_members.push({ course_id: 'course-2', user_id: 'platform-admin', role: 'student' });
    as('platform-admin', 'admin');
    const { body } = await listCourses();

    expect(flags(body.courses)).toEqual({ 'course-2': 'owner/教师模式' });
  });

  it('不在任何课里：空列表', async () => {
    as('outsider');
    const { status, body } = await listCourses();

    expect(status).toBe(200);
    expect(body).toEqual({ configs: [], courses: [] });
  });

  it('查课内身份出错：503，不拿半份课程列表当全部', async () => {
    as('co-teacher');
    h.failing.add('course_members');
    const { status } = await listCourses();

    expect(status).toBe(503);
  });

  it('每个人的每门课：teacherModes 为真，/stream 用备课就放行；为假，就是那条 403', async () => {
    h.db.course_members.push({ course_id: 'course-2', user_id: 'platform-admin', role: 'student' });
    const people: [string, string][] = [
      ['owner-1', 'teacher'], ['owner-2', 'teacher'], ['co-teacher', 'teacher'], ['teacher-joined', 'teacher'],
      ['teacher-invited', 'teacher'], ['student-a', 'student'], ['student-forged', 'student'], ['platform-admin', 'admin'],
    ];
    const verdicts: boolean[] = [];

    for (const [userId, platformRole] of people) {
      as(userId, platformRole);
      const { body } = await listCourses();
      for (const course of body.courses ?? []) {
        const res = await ask({ agent_mode: 'lesson_planner', course_id: course.id, context_course_id: course.id });
        const where = `${userId} @ ${course.id}`;
        if (course.teacherModes) expect(res.status, where).toBe(200);
        else expect(res.body, where).toEqual(REFUSED);
        verdicts.push(course.teacherModes);
      }
    }

    expect(verdicts.length).toBeGreaterThanOrEqual(10);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});

describe('对话：只认自己的个人助手对话，读消息取最近的', () => {
  const at = (i: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString();

  it('读消息：长对话返回最近的 100 条，按旧到新排好；知识空间助手的对话 404', async () => {
    as('student-a', 'student');
    h.db.agent_conversations = [
      { id: 'conv-p', user_id: 'student-a', agent_type: 'personal' },
      { id: 'conv-w', user_id: 'student-a', agent_type: 'workspace', course_id: 'course-1' },
    ];
    h.db.agent_messages = Array.from({ length: 130 }, (_, i) => ({
      id: `m${i}`, conversation_id: 'conv-p', role: i % 2 ? 'assistant' : 'user', content: `第 ${i} 条`, created_at: at(i),
    }));
    const read = (id: string) => fetch(`${base}/personal-agent/conversations/${id}/messages`).then(async r => ({ status: r.status, body: await r.json() }));

    const { status, body } = await read('conv-p');
    expect(status).toBe(200);
    expect(body.messages).toHaveLength(100);
    expect(body.messages[0].id).toBe('m30');
    expect(body.messages.at(-1).id).toBe('m129');
    expect((await read('conv-w')).status).toBe(404);
  });

  it('接着聊带的是知识空间助手的对话 id：不往那段里写，新开一段个人助手对话', async () => {
    as('student-a', 'student');
    h.db.agent_conversations = [{ id: 'conv-w', user_id: 'student-a', agent_type: 'workspace', course_id: 'course-1' }];
    const { status } = await ask({ conversation_id: 'conv-w' });
    expect(status).toBe(200);
    const created = h.state.inserts.filter(i => i.table === 'agent_conversations').map(i => i.payload as Record<string, unknown>);
    expect(created).toEqual([expect.objectContaining({ agent_type: 'personal', user_id: 'student-a' })]);
    const written = h.state.inserts.filter(i => i.table === 'agent_messages').map(i => (i.payload as { conversation_id: string }).conversation_id);
    expect(written.length).toBeGreaterThan(0);
    expect(written).not.toContain('conv-w');
  });
});

describe('画图指令：不经对话模型，直接出图（默认 DMX）', () => {
  const events = (text: string) => text.split('\n\n')
    .filter(chunk => chunk.startsWith('data: ') && !chunk.includes('[DONE]'))
    .map(chunk => JSON.parse(chunk.slice('data: '.length)) as Record<string, any>);

  it('学生说「画一只……」：先推绘图事件让前端放动画，再把图片推出去；两条消息都存下；对话模型没被调', async () => {
    as('student-a', 'student');
    draw.generateNoteImage.mockClear();
    const { status, text } = await ask({ content: '画一只在月球上看书的猫' });
    expect(status).toBe(200);

    const list = events(text);
    expect(list[0]).toEqual({ drawing: { prompt: '画一只在月球上看书的猫' } });
    expect(list.find(e => typeof e.token === 'string')?.token).toBe('![画一只在月球上看书的猫](https://files.example.test/cat.png)');
    expect(list.at(-1)).toMatchObject({ done: true, toolsUsed: ['generate_image'] });
    expect(draw.generateNoteImage).toHaveBeenCalledWith('course-1', '画一只在月球上看书的猫');
    expect(h.runAgentLoopStream).not.toHaveBeenCalled();

    const saved = h.state.inserts.filter(i => i.table === 'agent_messages').map(i => i.payload as Record<string, any>);
    expect(saved.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(saved[1].content).toContain('cat.png');
    expect(saved[1].ai_metadata).toMatchObject({ direct_image: true, provider_id: 'dmx' });
  });

  it('画失败：推一条说清楚的错误，也存一条失败的助手消息', async () => {
    as('student-a', 'student');
    draw.generateNoteImage.mockResolvedValueOnce({ ok: false, error: '本课程未配置 MiniMax 或 DMX，无法生成图像。' } as never);
    const { text } = await ask({ content: '帮我画个光合作用的示意图' });
    expect(events(text).find(e => typeof e.error === 'string')?.error).toContain('这张图没有画成');
    const saved = h.state.inserts.filter(i => i.table === 'agent_messages').map(i => i.payload as Record<string, any>);
    expect(saved.at(-1)).toMatchObject({ role: 'assistant', ai_metadata: { direct_image: true, failed: true } });
  });

  it('不是画图的照常对话', async () => {
    as('student-a', 'student');
    draw.generateNoteImage.mockClear();
    await ask({ content: '这块画布上讨论到哪了？' });
    expect(draw.generateNoteImage).not.toHaveBeenCalled();
    expect(h.runAgentLoopStream).toHaveBeenCalled();
  });
});

describe('顺序锁：以后改这个路由也不能绕过', () => {
  const src = readFileSync(resolve(__dirname, 'personalAgent.ts'), 'utf-8');
  const stream = src.slice(src.indexOf("router.post('/personal-agent/stream'"));

  it('教师模式判定在第一次写库、调模型之前', () => {
    const gate = stream.search(/if \(isTeacherAgentMode && !isCourseStaff\)/);
    expect(gate).toBeGreaterThan(-1);
    for (const effect of [/\.insert\(/, /runAgentLoopStream\(/, /startRun\(/, /buildAgentContext\(/]) {
      expect(stream.search(effect)).toBeGreaterThan(gate);
    }
  });

  it('课程空间只经 accessControl 的 enterableSpaceIds 列出，列出来先过 ensureSpaceAccess', () => {
    // 知识库检索也用它，规则只有这一份
    expect(src.match(/\.from\('spaces'\)/g)).toBeNull();
    expect(src).toContain('enterableSpaceIds(contextCourseId, req.user!)');
    const shared = readFileSync(resolve(__dirname, '../services/accessControl.ts'), 'utf-8');
    const helper = shared.slice(shared.indexOf('export async function enterableSpaceIds'));
    const body = helper.slice(0, helper.indexOf('\n}\n'));
    expect(body).toContain(".from('spaces')");
    expect(body).toContain('ensureSpaceAccess(');
  });
});

/**
 * 2026-10-06：系统提示开头写死「你有 generate_summary_doc、export_notes 能做真的 Word，
 * 有 analyze_engagement、compare_periods 能出 PNG 图表，必须调用，不许说做不了文件」，还点了 save_teaching_insight。
 * 这五个只注册给教师，也只挂在备课 / 学情分析两个模式上：学生的「AI 对话」和教师的其他模式都拿不到，
 * 模型照着提示词就可能自称做好了 Word、编出下载链接。
 * 这里换成真的工具注册表和真的 buildAgentContext，按身份和模式核对：发给模型的提示词里点名的每个工具，
 * 都在同一次调用的工具清单里；清单里的也都写进了提示词。
 */
describe('提示词里点名的工具，这个身份在这个模式下都真的拿得到', () => {
  type Tool = { type: string; function: { name: string; description: string; parameters: object } };
  type Role = 'student' | 'teacher' | 'admin';
  const STUDENT_MODES = ['idea_coach', 'gap_finder', 'connection_scout', 'evidence_broker', 'rise_above_coach'];
  const TEACHER_FILE_TOOLS = ['generate_summary_doc', 'export_notes', 'analyze_engagement', 'compare_periods', 'save_teaching_insight'];
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

  /** 问一句要 Word 和图表的话，取发给模型的完整提示词、同一次调用给的工具、提示词点名的工具 */
  async function sent(userId: string, platformRole: string, mode: string) {
    as(userId, platformRole);
    const res = await ask({ agent_mode: mode, content: '把这门课的讨论整理成 Word 报告，附一张参与度图表' });
    expect(res.status).toBe(200);
    const { systemPrompt, tools } = h.runAgentLoopStream.mock.lastCall![0];
    return {
      systemPrompt,
      offered: tools.map(t => t.function.name),
      named: everyToolName.filter(name => new RegExp(`\\b${name}\\b`).test(systemPrompt)),
    };
  }

  it.each([
    ...STUDENT_MODES.map(mode => ['学生', mode, 'student-a', 'student', 'student']),
    ['凭学生验证码入课的教师账号', 'idea_coach', 'teacher-joined', 'teacher', 'student'],
    ...[...STUDENT_MODES, 'lesson_planner', 'teaching_analyst'].map(mode => ['课程教师', mode, 'owner-1', 'teacher', 'teacher']),
    ['平台管理员', 'teaching_analyst', 'platform-admin', 'admin', 'admin'],
  ])('%s用 %s', async (_who, mode, userId, platformRole, role) => {
    const { offered, named } = await sent(userId, platformRole, mode);

    expect(h.getToolsForRole).toHaveBeenLastCalledWith(role);
    // 清单里的工具都写进了提示词：核对的是完整的提示词，不是一段假的
    expect(offered.length).toBeGreaterThan(0);
    expect(named).toEqual(expect.arrayContaining(offered));
    expect(named.filter(name => !offered.includes(name))).toEqual([]);
  });

  it('学生首页「AI 对话」：选了课才给「检索课程资料」，选「不关联课程」不给（不能去翻自动挑来取 key 的那门课）', async () => {
    as('student-a', 'student');
    await ask({ agent_mode: 'idea_coach' });
    expect(h.runAgentLoopStream.mock.lastCall![0].tools.map(t => t.function.name)).toContain('search_course_materials');
    await ask({ agent_mode: 'idea_coach', context_course_id: null });
    expect(h.runAgentLoopStream.mock.lastCall![0].tools.map(t => t.function.name)).not.toContain('search_course_materials');
  });

  it.each([
    ['学生', 'student-a', 'student'],
    ['课程教师', 'owner-1', 'teacher'],
  ])('%s用观点澄清：一个文件 / 图表工具都不给也不点，直说做不了，不许写没做出来的下载链接', async (_who, userId, platformRole) => {
    const { systemPrompt, offered } = await sent(userId, platformRole, 'idea_coach');

    expect(offered.filter(name => TEACHER_FILE_TOOLS.includes(name))).toEqual([]);
    expect(systemPrompt).toContain('You cannot create downloadable files here.');
    expect(systemPrompt).toContain('You cannot plot charts of real data here (generate_image draws pictures; it cannot plot data).');
    expect(systemPrompt).toContain('Never write a download link for a file that was not made.');
  });

  it.each(['lesson_planner', 'teaching_analyst'])('课程教师用 %s 照旧：五个工具都给、都点到、要 Word 就得调；图表不打包票，结果里有链接才放', async mode => {
    const { systemPrompt, offered, named } = await sent('owner-1', 'teacher', mode);

    expect(offered).toEqual(expect.arrayContaining(TEACHER_FILE_TOOLS));
    expect(named).toEqual(expect.arrayContaining(TEACHER_FILE_TOOLS));
    expect(systemPrompt).toContain('generate_summary_doc and export_notes create real downloadable Word (.docx) files.');
    expect(systemPrompt).toContain('you MUST call analyze_engagement or compare_periods.');
    expect(systemPrompt).toContain('a chart as ![description](chartUrl). If the URL is not in the result, that file or chart was not made');
    expect(systemPrompt).not.toMatch(/PNG|produce charts/i);
    expect(systemPrompt).not.toContain('You cannot create downloadable files');
  });
});
