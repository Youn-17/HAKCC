import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 小组空间的隔离靠两处：ensureSpaceAccess 这道总闸，和课程空间列表的过滤。
 * 两处原先都按平台身份放行教师账号，而任何教师账号拿到学生验证码都能自助入课
 * （course_members.role='student'），于是别组的小组空间既列得出来、也打得开。
 * 这里把 spaces 和 courseSettings 两个路由挂在真实的 Express 上跑，accessControl 用真的，
 * 只替换数据库和鉴权。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const seed = (): Record<string, Row[]> => ({
    courses: [
      { id: 'course-1', title: '知识建构', instructor_id: 'owner-1' },
      { id: 'course-2', title: '早期建的课', instructor_id: 'owner-2' },
    ],
    spaces: [
      { id: 'space-shared', course_id: 'course-1', group_id: null, title: '全班共享', created_by: 'owner-1' },
      { id: 'space-a', course_id: 'course-1', group_id: 'group-a', title: '第一组', created_by: 'owner-1' },
      { id: 'space-b', course_id: 'course-1', group_id: 'group-b', title: '第二组', created_by: 'owner-1' },
      { id: 'space-2a', course_id: 'course-2', group_id: 'group-2a', title: '甲组', created_by: 'owner-2' },
      { id: 'space-2b', course_id: 'course-2', group_id: 'group-2b', title: '乙组', created_by: 'owner-2' },
    ],
    course_members: [
      { course_id: 'course-1', user_id: 'owner-1', role: 'teacher' },
      { course_id: 'course-1', user_id: 'co-teacher', role: 'teacher' },
      { course_id: 'course-1', user_id: 'teacher-joined', role: 'student' },
      { course_id: 'course-1', user_id: 'teacher-invited', role: 'member' },
      { course_id: 'course-1', user_id: 'student-a', role: 'student' },
      { course_id: 'course-1', user_id: 'student-forged', role: 'teacher' }, // 学生账号直连数据库写的管理员行
    ],
    group_members: [
      { group_id: 'group-a', user_id: 'student-a' },
      { group_id: 'group-a', user_id: 'teacher-joined' },
    ],
    profiles: [
      { id: 'owner-1', role: 'teacher' },
      { id: 'owner-2', role: 'teacher' },
      { id: 'co-teacher', role: 'teacher' },
      { id: 'teacher-joined', role: 'teacher' },
      { id: 'teacher-invited', role: 'teacher' },
      { id: 'student-a', role: 'student' },
      { id: 'student-forged', role: 'student' },
    ],
  });

  const db = seed();
  const state = { user: { id: 'student-a', role: 'student' } as { id: string; role: string } };

  // 链式调用照单全收，按 eq 条件在内存表里取行；update 直接改行
  const from = (table: string) => {
    let columns = '*';
    let patch: Row | null = null;
    const eq: Record<string, unknown> = {};
    const rows = () => (db[table] ?? []).filter(r => Object.entries(eq).every(([k, v]) => r[k] === v));
    const view = (r: Row) => (table === 'spaces' && columns.includes('courses')
      ? { ...r, courses: { ...db.courses.find(c => c.id === r.course_id) } }
      : { ...r });
    const run = (terminal: 'single' | 'maybeSingle' | 'many') => {
      if (patch) rows().forEach(r => Object.assign(r, patch));
      const found = rows().map(view);
      if (terminal === 'many') return { data: found, error: null };
      if (!found[0]) return { data: null, error: terminal === 'single' ? { message: 'no rows' } : null };
      return { data: found[0], error: null };
    };
    const builder: Record<string, unknown> = {
      select: (cols = '*') => { columns = cols; return builder; },
      update: (p: Row) => { patch = p; return builder; },
      eq: (col: string, value: unknown) => { eq[col] = value; return builder; },
      single: async () => run('single'),
      maybeSingle: async () => run('maybeSingle'),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve(run('many')).then(onOk, onFail),
    };
    for (const m of ['order', 'limit', 'is', 'not', 'in']) builder[m] = () => builder;
    return builder;
  };

  const reset = () => {
    Object.assign(db, seed());
    state.user = { id: 'student-a', role: 'student' };
  };

  return { db, state, from, reset };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
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
vi.mock('../services/eventService', () => ({ logEvent: () => {} }));
vi.mock('../services/experimentCondition', () => ({ invalidateConditionCache: () => {} }));

import spacesRouter from './spaces';
import courseSettingsRouter from './courseSettings';
import { errorHandler } from '../middleware/errorHandler';
import { invalidateMembershipCache, invalidateSpaceCache } from '../services/accessControl';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', spacesRouter);
  app.use('/api', courseSettingsRouter);
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
});

const as = (id: string, role = 'teacher') => { h.state.user = { id, role }; };

async function call(method: 'GET' | 'PATCH', path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, any> };
}

const listed = async (courseId: string) => {
  const res = await call('GET', `/courses/${courseId}/spaces`);
  expect(res.status).toBe(200);
  return (res.body.spaces as { id: string }[]).map(s => s.id).sort();
};

describe('教师账号凭学生验证码入课：在课里就是普通成员，别组的小组空间看不到也进不去', () => {
  it('打开别组的小组空间 403；共享空间和本组空间照常', async () => {
    as('teacher-joined');

    expect(await call('GET', '/spaces/space-b')).toEqual({ status: 403, body: { error: 'This space belongs to another group' } });
    expect((await call('GET', '/spaces/space-shared')).status).toBe(200);
    expect((await call('GET', '/spaces/space-a')).status).toBe(200);
  });

  it('课程空间列表里只有共享空间和本组空间', async () => {
    as('teacher-joined');
    expect(await listed('course-1')).toEqual(['space-a', 'space-shared']);
  });

  it('被邀请、还没设为课程管理员的教师（role=member）也一样', async () => {
    as('teacher-invited');

    expect(await listed('course-1')).toEqual(['space-shared']);
    expect((await call('GET', '/spaces/space-a')).status).toBe(403);
    expect((await call('GET', '/spaces/space-b')).status).toBe(403);
  });

  it('学生账号带着一条管理员成员行也不算管理员：成员行只由创建者授给教师账号', async () => {
    as('student-forged', 'student');

    expect(await listed('course-1')).toEqual(['space-shared']);
    expect((await call('GET', '/spaces/space-b')).status).toBe(403);
  });

  it('学生照旧：只看得到共享空间和本组空间', async () => {
    as('student-a', 'student');

    expect(await listed('course-1')).toEqual(['space-a', 'space-shared']);
    expect((await call('GET', '/spaces/space-b')).status).toBe(403);
  });
});

describe('创建者和课程管理员照旧：每个组的空间都列得出、打得开', () => {
  it.each(['owner-1', 'co-teacher'])('%s', async (userId) => {
    as(userId);

    expect(await listed('course-1')).toEqual(['space-a', 'space-b', 'space-shared']);
    for (const spaceId of ['space-shared', 'space-a', 'space-b']) {
      expect((await call('GET', `/spaces/${spaceId}`)).status).toBe(200);
    }
  });

  it('创建者不在 course_members 里（早期建的课）也一样', async () => {
    as('owner-2');

    expect(await listed('course-2')).toEqual(['space-2a', 'space-2b']);
    expect((await call('GET', '/spaces/space-2b')).status).toBe(200);
  });

  it('平台管理员照旧：不在课里也能打开任何小组空间', async () => {
    as('platform-admin', 'admin');

    expect((await call('GET', '/spaces/space-b')).status).toBe(200);
    expect((await call('GET', '/spaces/space-2b')).status).toBe(200);
  });
});

describe('授予 / 撤销课程管理员立刻生效：成员缓存里存着课内身份，改完就清', () => {
  it('撤销后，原管理员立刻进不了别组空间，列表里也没了', async () => {
    as('co-teacher');
    expect((await call('GET', '/spaces/space-b')).status).toBe(200);

    as('owner-1');
    expect(await call('PATCH', '/courses/course-1/members/co-teacher/role', { role: 'member' }))
      .toEqual({ status: 200, body: { userId: 'co-teacher', courseRole: 'member' } });

    as('co-teacher');
    expect((await call('GET', '/spaces/space-b')).status).toBe(403);
    expect(await listed('course-1')).toEqual(['space-shared']);
  });

  it('授予后，新管理员立刻能进每个组的空间', async () => {
    as('teacher-joined');
    expect((await call('GET', '/spaces/space-b')).status).toBe(403);

    as('owner-1');
    expect(await call('PATCH', '/courses/course-1/members/teacher-joined/role', { role: 'manager' }))
      .toEqual({ status: 200, body: { userId: 'teacher-joined', courseRole: 'manager' } });

    as('teacher-joined');
    expect((await call('GET', '/spaces/space-b')).status).toBe(200);
    expect(await listed('course-1')).toEqual(['space-a', 'space-b', 'space-shared']);
  });
});
