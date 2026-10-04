import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 课程设置页的「学习目标」「学习任务」和学生提交（表在迁移 068 建）。
 *
 * 路由挂在真实的 Express 上，accessControl 用真的，只替换数据库和鉴权。内存库照 PostgREST 的
 * 脾气来：不是 UUID 的 id 报 22P02，order 真的排序，users!xxx / task_submissions(...) 真的内联，
 * upsert 按 onConflict 合并。
 *
 * 身份：创建者、课程管理员可以改；受邀还没设管理员的教师、凭学生验证码入课的教师账号、学生
 * 都只能读；别的课的创建者连读都不行。
 */

const COURSE = '11111111-1111-4111-8111-111111111111';
const OTHER_COURSE = '22222222-2222-4222-8222-222222222222';

const U = {
  owner: '00000000-0000-4000-8000-000000000001',
  manager: '00000000-0000-4000-8000-000000000002',
  invited: '00000000-0000-4000-8000-000000000003',
  joinedTeacher: '00000000-0000-4000-8000-000000000004',
  studentA: '00000000-0000-4000-8000-000000000005',
  studentB: '00000000-0000-4000-8000-000000000006',
  otherOwner: '00000000-0000-4000-8000-000000000007',
  admin: '00000000-0000-4000-8000-000000000008',
} as const;

const ROLE: Record<string, 'teacher' | 'student' | 'admin'> = {
  [U.owner]: 'teacher', [U.manager]: 'teacher', [U.invited]: 'teacher', [U.joinedTeacher]: 'teacher',
  [U.studentA]: 'student', [U.studentB]: 'student', [U.otherOwner]: 'teacher', [U.admin]: 'admin',
};

const G = {
  lowOld: '00000000-0000-4000-9000-000000000001',
  high: '00000000-0000-4000-9000-000000000002',
  mid: '00000000-0000-4000-9000-000000000003',
  lowNew: '00000000-0000-4000-9000-000000000004',
  other: '00000000-0000-4000-9000-000000000005',
};

const T = {
  published: '00000000-0000-4000-a000-000000000001',
  draft: '00000000-0000-4000-a000-000000000002',
  closed: '00000000-0000-4000-a000-000000000003',
  other: '00000000-0000-4000-a000-000000000004',
};

const S = {
  a: '00000000-0000-4000-b000-000000000001',
  b: '00000000-0000-4000-b000-000000000002',
};

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const UUID_COLUMNS = new Set(['id', 'course_id', 'task_id', 'student_id', 'created_by', 'user_id', 'instructor_id']);

  const db: Record<string, Row[]> = {};
  const state = { user: { id: '', role: 'student' } as { id: string; role: string } };
  let nextId = 1;
  let clock = Date.parse('2026-09-20T00:00:00Z');
  const now = () => new Date(clock += 1000).toISOString();

  const person = (id: unknown) => {
    const p = (db.profiles ?? []).find(r => r.id === id);
    return p ? { id: p.id, name: p.full_name, avatar: p.avatar_url ?? null } : null;
  };

  const from = (table: string) => {
    type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; ascending: boolean }> = [];
    let op: Op = 'select';
    let columns = '*';
    let payload: Row[] = [];
    let conflict: string[] = [];
    let patch: Row = {};
    let badId: string | null = null;

    const rows = () => (db[table] ??= []);
    const view = (r: Row): Row => {
      const out: Row = { ...r };
      if (columns.includes('users!created_by')) out.users = person(r.created_by);
      if (columns.includes('users!student_id')) out.users = person(r.student_id);
      if (columns.includes('task_submissions(')) {
        out.task_submissions = (db.task_submissions ?? []).filter(s => s.task_id === r.id).map(s => ({ ...s }));
      }
      return out;
    };
    const sorted = (list: Row[]) => [...list].sort((a, b) => {
      for (const { col, ascending } of orders) {
        const x = a[col] as string | number | null;
        const y = b[col] as string | number | null;
        if (x === y) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : 1) * (ascending ? 1 : -1);
      }
      return 0;
    });
    const execute = (): Row[] => {
      const hit = rows().filter(r => filters.every(f => f(r)));
      if (op === 'insert') {
        const created = payload.map(p => ({
          id: `00000000-0000-4000-c000-${String(nextId++).padStart(12, '0')}`,
          created_at: now(), updated_at: now(), ...p,
        }));
        rows().push(...created);
        return created;
      }
      if (op === 'upsert') {
        return payload.map(p => {
          const existing = rows().find(r => conflict.every(k => r[k] === p[k]));
          if (existing) return Object.assign(existing, p);
          const created = { id: `00000000-0000-4000-c000-${String(nextId++).padStart(12, '0')}`, ...p };
          rows().push(created);
          return created;
        });
      }
      if (op === 'update') {
        // 数据库里的触发器维护 updated_at
        hit.forEach(r => Object.assign(r, patch, 'updated_at' in r ? { updated_at: now() } : {}));
        return hit;
      }
      if (op === 'delete') {
        db[table] = rows().filter(r => !hit.includes(r));
        return hit;
      }
      return sorted(hit);
    };
    const run = (terminal: 'single' | 'maybeSingle' | 'many') => {
      if (badId !== null) {
        return { data: null, error: { code: '22P02', message: `invalid input syntax for type uuid: "${badId}"` } };
      }
      const found = execute().map(view);
      if (terminal === 'many') return { data: found, error: null };
      if (found.length === 0) {
        return { data: null, error: terminal === 'single' ? { code: 'PGRST116', message: 'no rows' } : null };
      }
      return { data: found[0], error: null };
    };
    const builder: Record<string, unknown> = {
      select: (cols = '*') => { columns = cols; return builder; },
      insert: (p: Row | Row[]) => { op = 'insert'; payload = Array.isArray(p) ? p : [p]; return builder; },
      upsert: (p: Row | Row[], opts?: { onConflict?: string }) => {
        op = 'upsert';
        payload = Array.isArray(p) ? p : [p];
        conflict = opts?.onConflict?.split(',') ?? ['id'];
        return builder;
      },
      update: (p: Row) => { op = 'update'; patch = p; return builder; },
      delete: () => { op = 'delete'; return builder; },
      eq: (col: string, value: unknown) => {
        if (UUID_COLUMNS.has(col) && typeof value === 'string' && !UUID.test(value)) badId = value;
        filters.push(r => r[col] === value);
        return builder;
      },
      neq: (col: string, value: unknown) => { filters.push(r => r[col] !== value); return builder; },
      in: (col: string, values: unknown[]) => { filters.push(r => values.includes(r[col])); return builder; },
      is: (col: string, value: unknown) => { filters.push(r => (r[col] ?? null) === value); return builder; },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orders.push({ col, ascending: opts?.ascending !== false });
        return builder;
      },
      limit: () => builder,
      single: async () => run('single'),
      maybeSingle: async () => run('maybeSingle'),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve().then(() => run('many')).then(ok, fail),
    };
    return builder;
  };

  const reset = (seed: Record<string, Row[]>) => {
    for (const key of Object.keys(db)) delete db[key];
    for (const [table, list] of Object.entries(seed)) db[table] = list.map(r => ({ ...r }));
    nextId = 1;
  };

  return { db, state, from, reset };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user, name: h.state.user.id, email: '', status: 'active' };
    next();
  },
  requireRole: (...roles: string[]) => (
    req: { user?: { role: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  },
}));
vi.mock('../services/experimentCondition', () => ({ invalidateConditionCache: () => {} }));

import courseSettingsRouter from './courseSettings';
import { errorHandler } from '../middleware/errorHandler';
import { invalidateMembershipCache } from '../services/accessControl';

function seed() {
  const member = (course_id: string, user_id: string, role: string) => ({ course_id, user_id, role });
  const goal = (id: string, course_id: string, title: string, priority: number, created_at: string) => ({
    id, course_id, title, description: null, priority, created_by: U.owner, created_at, updated_at: created_at,
  });
  const task = (id: string, course_id: string, title: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, course_id, title, description: null, due_date: null, points: 100, status, created_by: U.owner,
    created_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:00:00.000Z', ...extra,
  });
  return {
    courses: [
      { id: COURSE, title: '知识建构', instructor_id: U.owner },
      { id: OTHER_COURSE, title: '另一门课', instructor_id: U.otherOwner },
    ],
    course_members: [
      member(COURSE, U.owner, 'teacher'),
      member(COURSE, U.manager, 'teacher'),
      member(COURSE, U.invited, 'member'),
      member(COURSE, U.joinedTeacher, 'student'),
      member(COURSE, U.studentA, 'student'),
      member(COURSE, U.studentB, 'student'),
      member(OTHER_COURSE, U.otherOwner, 'teacher'),
      member(OTHER_COURSE, U.studentA, 'student'),
    ],
    profiles: Object.entries(ROLE).map(([id, role]) => ({
      id, role, full_name: Object.entries(U).find(([, v]) => v === id)![0], avatar_url: null,
    })),
    course_goals: [
      goal(G.lowOld, COURSE, '会用证据支持观点', 0, '2026-09-01T00:00:00.000Z'),
      goal(G.high, COURSE, '能在别人的观点上建构', 2, '2026-09-03T00:00:00.000Z'),
      goal(G.mid, COURSE, '读懂论证结构', 1, '2026-09-02T00:00:00.000Z'),
      goal(G.lowNew, COURSE, '按时参与讨论', 0, '2026-09-04T00:00:00.000Z'),
      goal(G.other, OTHER_COURSE, '另一门课的目标', 2, '2026-09-01T00:00:00.000Z'),
    ],
    course_tasks: [
      task(T.published, COURSE, '读书报告', 'published', { due_date: '2026-10-01T15:59:00+00:00' }),
      task(T.draft, COURSE, '还没发布的任务', 'draft'),
      task(T.closed, COURSE, '已经截止的任务', 'closed'),
      task(T.other, OTHER_COURSE, '另一门课的任务', 'published'),
    ],
    task_submissions: [
      { id: S.a, task_id: T.published, student_id: U.studentA, content: '学生甲的报告', submission_type: 'text',
        status: 'submitted', submitted_at: '2026-09-21T00:00:00.000Z', graded_at: null, feedback: null, points_awarded: null },
      { id: S.b, task_id: T.published, student_id: U.studentB, content: '学生乙的报告', submission_type: 'text',
        status: 'graded', submitted_at: '2026-09-22T00:00:00.000Z', graded_at: '2026-09-23T00:00:00.000Z',
        feedback: '论证清楚', points_awarded: 90 },
    ],
  };
}

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', courseSettingsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  h.reset(seed());
  invalidateMembershipCache();
});

function as(userId: string) {
  h.state.user = { id: userId, role: ROLE[userId] };
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const row = (table: string, id: string) => h.db[table]?.find(r => r.id === id);
const goalsPath = (courseId = COURSE) => `/courses/${courseId}/goals`;
const tasksPath = (courseId = COURSE) => `/courses/${courseId}/tasks`;
const subsPath = (taskId: string, courseId = COURSE) => `/courses/${courseId}/tasks/${taskId}/submissions`;

/** 课里、但不能改设置的人 */
const READ_ONLY = [U.invited, U.joinedTeacher, U.studentA];

describe('学习目标：读', () => {
  it('课程成员都能读，高优先级在前、同一档按添加先后，带回课内身份', async () => {
    for (const [userId, standing] of [[U.studentA, 'member'], [U.joinedTeacher, 'member'], [U.manager, 'manager'], [U.owner, 'owner']]) {
      as(userId);
      const { status, body } = await call('GET', goalsPath());
      expect(status, userId).toBe(200);
      expect(body.viewerStanding).toBe(standing);
      expect(body.goals.map((g: { id: string }) => g.id)).toEqual([G.high, G.mid, G.lowOld, G.lowNew]);
    }
    const first = (await call('GET', goalsPath())).body.goals[0];
    expect(first).toMatchObject({ courseId: COURSE, title: '能在别人的观点上建构', priority: 2, description: null });
    expect(first.createdBy).toMatchObject({ id: U.owner, name: 'owner' });
  });

  it('不在课里的人读不到', async () => {
    as(U.otherOwner);
    expect((await call('GET', goalsPath())).status).toBe(403);
  });
});

describe('学习目标：增删改只给课程教职', () => {
  it('创建者新建：去掉首尾空白，空描述存 null，返回的是和列表一样的驼峰形状', async () => {
    as(U.owner);
    const { status, body } = await call('POST', goalsPath(), { title: '  提出可检验的问题 ', description: '   ', priority: 1 });
    expect(status).toBe(201);
    expect(body.goal).toMatchObject({ courseId: COURSE, title: '提出可检验的问题', description: null, priority: 1 });
    expect(body.goal).not.toHaveProperty('course_id');
    expect(row('course_goals', body.goal.id)).toMatchObject({ course_id: COURSE, created_by: U.owner });
  });

  it('课程管理员改：只改传了的字段', async () => {
    as(U.manager);
    const { status, body } = await call('PUT', `${goalsPath()}/${G.mid}`, { priority: 2 });
    expect(status).toBe(200);
    expect(body.goal).toMatchObject({ id: G.mid, title: '读懂论证结构', priority: 2 });
    expect(row('course_goals', G.mid)).toMatchObject({ priority: 2, title: '读懂论证结构' });
  });

  it('创建者删：删掉的再删是 404，不再回「已删除」', async () => {
    as(U.owner);
    expect((await call('DELETE', `${goalsPath()}/${G.lowOld}`)).status).toBe(200);
    expect(row('course_goals', G.lowOld)).toBeUndefined();
    expect((await call('DELETE', `${goalsPath()}/${G.lowOld}`)).status).toBe(404);
  });

  it('平台管理员可以管任何一门课', async () => {
    as(U.admin);
    expect((await call('POST', goalsPath(), { title: '管理员加的目标' })).status).toBe(201);
  });

  it('受邀未设管理员的教师、凭学生验证码入课的教师、学生：都改不了', async () => {
    for (const userId of READ_ONLY) {
      as(userId);
      expect((await call('POST', goalsPath(), { title: '偷偷加的目标' })).status, userId).toBe(403);
      expect((await call('PUT', `${goalsPath()}/${G.high}`, { title: '被改了' })).status, userId).toBe(403);
      expect((await call('DELETE', `${goalsPath()}/${G.high}`)).status, userId).toBe(403);
    }
    expect(h.db.course_goals.filter(g => g.course_id === COURSE)).toHaveLength(4);
    expect(row('course_goals', G.high)?.title).toBe('能在别人的观点上建构');
  });

  it('另一门课的创建者：走自己的课也改不到这门课的目标', async () => {
    as(U.otherOwner);
    expect((await call('POST', goalsPath(), { title: '插进别人课里的目标' })).status).toBe(403);
    expect((await call('PUT', `${goalsPath(OTHER_COURSE)}/${G.high}`, { title: '被改了' })).status).toBe(404);
    expect((await call('DELETE', `${goalsPath(OTHER_COURSE)}/${G.high}`)).status).toBe(404);
    expect(row('course_goals', G.high)?.title).toBe('能在别人的观点上建构');
  });

  it('输入不对报中文的 400，什么都不写', async () => {
    as(U.owner);
    const bad = [
      { title: '   ' },
      { title: '字'.repeat(201) },
      { title: '好目标', priority: 3 },
      { title: '好目标', priority: '1' },
      { title: '好目标', description: 42 },
    ];
    for (const body of bad) {
      const res = await call('POST', goalsPath(), body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toMatch(/[一-龥]/);
    }
    expect((await call('PUT', `${goalsPath()}/${G.high}`, {})).status).toBe(400);
    expect((await call('PUT', `${goalsPath()}/${G.high}`, { title: '' })).status).toBe(400);
    expect(h.db.course_goals).toHaveLength(5);
  });

  it('不是 UUID 的目标 id 是 404，不是数据库报错的 500', async () => {
    as(U.owner);
    expect((await call('PUT', `${goalsPath()}/not-a-uuid`, { title: '新标题' })).status).toBe(404);
    expect((await call('DELETE', `${goalsPath()}/not-a-uuid`)).status).toBe(404);
  });
});

describe('学习任务：布置和改', () => {
  it('截止时间要带时区：datetime-local 的原样值会被当成 UTC 存，晚 8 小时，直接拒', async () => {
    as(U.owner);
    const naive = await call('POST', tasksPath(), { title: '小组汇报', due_date: '2026-10-08T23:59', points: 50 });
    expect(naive.status).toBe(400);
    expect(h.db.course_tasks).toHaveLength(4);

    const { status, body } = await call('POST', tasksPath(), { title: '小组汇报', due_date: '2026-10-08T15:59:00.000Z', points: 50 });
    expect(status).toBe(201);
    expect(body.task).toMatchObject({
      courseId: COURSE, title: '小组汇报', dueDate: '2026-10-08T15:59:00.000Z', points: 50, status: 'published',
      submissionStats: { total: 0, submitted: 0, graded: 0 },
    });
    expect(row('course_tasks', body.task.id)).toMatchObject({ created_by: U.owner, due_date: '2026-10-08T15:59:00.000Z' });
  });

  it('分值、状态、年份不对都是 400', async () => {
    as(U.owner);
    for (const body of [
      { title: '任务', points: -1 },
      { title: '任务', points: 2.5 },
      { title: '任务', points: 1001 },
      { title: '任务', status: 'archived' },
      { title: '任务', due_date: '0202-10-08T15:59:00Z' },
      { title: '' },
    ]) {
      expect((await call('POST', tasksPath(), body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(h.db.course_tasks).toHaveLength(4);
  });

  it('状态没变的编辑照常保存（原先改个标题也报 published → published 不合法）', async () => {
    as(U.owner);
    const { status, body } = await call('PUT', `${tasksPath()}/${T.published}`, { title: '读书报告（修订）', status: 'published' });
    expect(status).toBe(200);
    expect(body.task).toMatchObject({ title: '读书报告（修订）', status: 'published' });
  });

  it('状态只能按草稿 → 发布 → 关闭走', async () => {
    as(U.owner);
    const skip = await call('PUT', `${tasksPath()}/${T.draft}`, { status: 'closed' });
    expect(skip.status).toBe(400);
    expect(skip.body.error).toContain('草稿');
    expect(row('course_tasks', T.draft)?.status).toBe('draft');
    expect((await call('PUT', `${tasksPath()}/${T.draft}`, { status: 'published' })).status).toBe(200);
    expect((await call('PUT', `${tasksPath()}/${T.closed}`, { status: 'published' })).status).toBe(200);
  });

  it('due_date 传 null 去掉截止时间（原先前端发 undefined，清不掉）', async () => {
    as(U.manager);
    const { status, body } = await call('PUT', `${tasksPath()}/${T.published}`, { due_date: null });
    expect(status).toBe(200);
    expect(body.task.dueDate).toBeNull();
    expect(row('course_tasks', T.published)?.due_date).toBeNull();
  });

  it('课里不能改设置的人、另一门课的创建者：布置、改、删都不行', async () => {
    for (const userId of READ_ONLY) {
      as(userId);
      expect((await call('POST', tasksPath(), { title: '偷偷布置的任务' })).status, userId).toBe(403);
      expect((await call('PUT', `${tasksPath()}/${T.published}`, { title: '被改了' })).status, userId).toBe(403);
      expect((await call('DELETE', `${tasksPath()}/${T.published}`)).status, userId).toBe(403);
    }
    as(U.otherOwner);
    expect((await call('PUT', `${tasksPath(OTHER_COURSE)}/${T.published}`, { title: '被改了' })).status).toBe(404);
    expect((await call('DELETE', `${tasksPath(OTHER_COURSE)}/${T.published}`)).status).toBe(404);
    expect(row('course_tasks', T.published)?.title).toBe('读书报告');
  });

  it('删任务：再删是 404；id 不是 UUID 也是 404', async () => {
    as(U.owner);
    expect((await call('DELETE', `${tasksPath()}/${T.closed}`)).status).toBe(200);
    expect((await call('DELETE', `${tasksPath()}/${T.closed}`)).status).toBe(404);
    expect((await call('DELETE', `${tasksPath()}/not-a-uuid`)).status).toBe(404);
  });
});

describe('学习任务：列表', () => {
  const ids = (body: Record<string, any>) => (body.tasks as { id: string }[]).map(t => t.id).sort();

  it('课程教职看得到草稿和全班的提交统计', async () => {
    as(U.manager);
    const { body } = await call('GET', tasksPath());
    expect(body.viewerStanding).toBe('manager');
    expect(ids(body)).toEqual([T.published, T.draft, T.closed].sort());
    const report = body.tasks.find((t: { id: string }) => t.id === T.published);
    expect(report.submissionStats).toEqual({ total: 2, submitted: 2, graded: 1 });
    expect(report.dueDate).toBe('2026-10-01T15:59:00+00:00');
  });

  it('学生看不到草稿，统计只算自己那一份', async () => {
    as(U.studentA);
    const { body } = await call('GET', tasksPath());
    expect(body.viewerStanding).toBe('member');
    expect(ids(body)).toEqual([T.published, T.closed].sort());
    const report = body.tasks.find((t: { id: string }) => t.id === T.published);
    expect(report.submissionStats).toEqual({ total: 1, submitted: 1, graded: 0 });
  });

  it('不在课里的人拿不到', async () => {
    as(U.otherOwner);
    expect((await call('GET', tasksPath())).status).toBe(403);
  });
});

describe('提交：学生只看、只交、只改自己的', () => {
  it('提交列表：教职看全部，学生只看自己的；别人的那份单独取是 403', async () => {
    as(U.owner);
    expect(((await call('GET', subsPath(T.published))).body.submissions as { id: string }[]).map(s => s.id).sort())
      .toEqual([S.a, S.b].sort());
    as(U.studentA);
    const mine = await call('GET', subsPath(T.published));
    expect(mine.body.submissions.map((s: { id: string }) => s.id)).toEqual([S.a]);
    expect(mine.body.submissions[0]).toMatchObject({ studentId: U.studentA, content: '学生甲的报告', student: { name: 'studentA' } });
    expect((await call('GET', `${subsPath(T.published)}/${S.b}`)).status).toBe(403);
  });

  it('草稿对学生按不存在处理：看不了，也交不了', async () => {
    as(U.studentA);
    expect((await call('GET', subsPath(T.draft))).status).toBe(404);
    expect((await call('POST', subsPath(T.draft), { content: '抢先交' })).status).toBe(404);
  });

  it('交作业、重交改的是同一份；关闭的任务不收；空的不收', async () => {
    as(U.joinedTeacher);
    const first = await call('POST', subsPath(T.published), { content: '第一稿' });
    expect(first.status).toBe(201);
    expect(first.body.submission).toMatchObject({ studentId: U.joinedTeacher, status: 'submitted', content: '第一稿' });
    const again = await call('POST', subsPath(T.published), { content: '第二稿' });
    expect(again.status).toBe(200);
    expect(again.body.submission.id).toBe(first.body.submission.id);
    expect(h.db.task_submissions.filter(s => s.student_id === U.joinedTeacher)).toHaveLength(1);

    expect((await call('POST', subsPath(T.closed), { content: '晚交的' })).status).toBe(400);
    expect((await call('POST', subsPath(T.published), { content: '   ' })).status).toBe(400);
  });

  it('批改过的不能再交、再改（原先重交会把「已批改」冲回「已提交」，分数却留着）', async () => {
    as(U.studentB);
    expect((await call('POST', subsPath(T.published), { content: '改过的报告' })).status).toBe(400);
    expect((await call('PUT', `${subsPath(T.published)}/${S.b}`, { content: '改过的报告' })).status).toBe(400);
    expect(row('task_submissions', S.b)).toMatchObject({ status: 'graded', points_awarded: 90, content: '学生乙的报告' });
  });

  it('学生改自己的：提交时间跟着更新；任务关了就不能改；不能自己批改', async () => {
    as(U.studentA);
    const { status, body } = await call('PUT', `${subsPath(T.published)}/${S.a}`, { content: '补充了一段' });
    expect(status).toBe(200);
    expect(body.submission.content).toBe('补充了一段');
    expect(body.submission.submittedAt).not.toBe('2026-09-21T00:00:00.000Z');

    expect((await call('PUT', `${subsPath(T.published)}/${S.a}`, { points_awarded: 100 })).status).toBe(403);
    expect((await call('PUT', `${subsPath(T.published)}/${S.a}`, { status: 'graded' })).status).toBe(403);

    as(U.owner);
    expect((await call('PUT', `${tasksPath()}/${T.published}`, { status: 'closed' })).status).toBe(200);
    as(U.studentA);
    expect((await call('PUT', `${subsPath(T.published)}/${S.a}`, { content: '关了还想改' })).status).toBe(400);
    expect(row('task_submissions', S.a)?.content).toBe('补充了一段');
  });

  it('链接只收 http(s)', async () => {
    as(U.studentA);
    const res = await call('POST', subsPath(T.published), { content: '见附件', file_url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(row('task_submissions', S.a)?.content).toBe('学生甲的报告');
  });

  it('教职批改：得分不能超过分值；只能批改，不能改学生写的内容', async () => {
    as(U.manager);
    const over = await call('PUT', `${subsPath(T.published)}/${S.a}`, { points_awarded: 101, feedback: '很好' });
    expect(over.status).toBe(400);
    expect(over.body.error).toContain('100');
    expect((await call('PUT', `${subsPath(T.published)}/${S.a}`, { content: '老师替你改了' })).status).toBe(403);
    expect(row('task_submissions', S.a)).toMatchObject({ status: 'submitted', content: '学生甲的报告' });

    const { status, body } = await call('PUT', `${subsPath(T.published)}/${S.a}`, { points_awarded: 88, feedback: '证据再多一条', status: 'graded' });
    expect(status).toBe(200);
    expect(body.submission).toMatchObject({ status: 'graded', pointsAwarded: 88, feedback: '证据再多一条' });
    expect(body.submission.gradedAt).toBeTruthy();
  });

  it('课里的非教职批不了同学的，教职交不了作业', async () => {
    as(U.joinedTeacher);
    expect((await call('PUT', `${subsPath(T.published)}/${S.a}`, { points_awarded: 60 })).status).toBe(403);
    as(U.manager);
    expect((await call('POST', subsPath(T.published), { content: '老师也交一份' })).status).toBe(403);
    expect(row('task_submissions', S.a)?.points_awarded).toBeNull();
  });

  it('别的课的任务不能从这门课借道', async () => {
    as(U.owner);
    expect((await call('GET', subsPath(T.other))).status).toBe(404);
    expect((await call('GET', subsPath('not-a-uuid'))).status).toBe(404);
  });
});
