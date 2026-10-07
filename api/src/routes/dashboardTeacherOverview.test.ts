import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 教师首页的课程列表带回「我在这门课里的身份」（2026-10-06）：「我的课程」每行的「课程管理」
 * 只给创建者和课程管理员。身份按 listCourseStandings 的口径：课程管理员要求是教师账号，
 * 凭学生验证码入课的教师账号是普通成员；平台管理员按创建者算。
 * 跑真的路由和真的身份判定，只替换数据库和鉴权。
 */

const h = vi.hoisted(() => {
  const state = {
    user: { id: 't1', role: 'teacher' } as { id: string; role: string },
    tables: {} as Record<string, Array<Record<string, unknown>>>,
    /** 让查课内身份那一次（course_members 带 role）失败 */
    failStandings: false,
  };
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const inList: Record<string, unknown[]> = {};
    let columns = '';
    let head = false;
    const rows = () => (state.tables[table] ?? []).filter(r =>
      Object.entries(eq).every(([k, v]) => r[k] === v) && Object.entries(inList).every(([k, vs]) => vs.includes(r[k])));
    const result = () => {
      // 只让 listCourseStandings 那一次失败（按调用者查、只要 course_id 和 role），别的统计照常
      if (state.failStandings && table === 'course_members' && columns === 'course_id, role' && 'user_id' in eq) {
        return { data: null, error: { message: 'down' }, count: null };
      }
      const data = rows();
      return { data: head ? null : data, error: null, count: data.length };
    };
    const proxy: unknown = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, fail);
        if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve({ ...result(), data: rows()[0] ?? null });
        if (prop === 'select') return (cols?: string, opts?: { head?: boolean }) => { columns = cols ?? ''; head = Boolean(opts?.head); return proxy; };
        if (prop === 'eq') return (col: string, value: unknown) => { eq[col] = value; return proxy; };
        if (prop === 'in') return (col: string, values: unknown[]) => { inList[col] = values; return proxy; };
        return () => proxy;
      },
    });
    return proxy;
  };
  return { state, from };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from, rpc: async () => ({ data: [], error: null }) } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { ...h.state.user }; next(); },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import dashboardRouter from './dashboard';
import { errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/dashboard', dashboardRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dashboard`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

const course = (id: string, instructor: string) => ({
  id, title: id, instructor_id: instructor, cover_image: null, tags: [], verification_code: 'ABCD', created_at: '2026-09-01T00:00:00Z',
});

beforeEach(() => {
  h.state.user = { id: 't1', role: 'teacher' };
  h.state.failStandings = false;
  h.state.tables = {
    courses: [course('c-own', 't1'), course('c-managed', 't9'), course('c-joined', 't9'), course('c-other', 't9')],
    course_members: [
      // 受邀并被设为课程管理员
      { course_id: 'c-managed', user_id: 't1', role: 'teacher' },
      // 凭学生验证码入课：在这门课里是普通成员
      { course_id: 'c-joined', user_id: 't1', role: 'student' },
    ],
  };
});

const standings = async () => {
  const res = await fetch(`${base}/teacher-overview`);
  expect(res.status).toBe(200);
  const body = await res.json() as { overview: { courses: Array<{ id: string; viewerStanding?: string }> } };
  return Object.fromEntries(body.overview.courses.map(c => [c.id, c.viewerStanding ?? null]));
};

describe('GET /dashboard/teacher-overview 带回课内身份', () => {
  it('自己建的是 owner，被设为课程管理员的是 manager，凭学生验证码进的是 member；不在的课不列', async () => {
    expect(await standings()).toEqual({ 'c-own': 'owner', 'c-managed': 'manager', 'c-joined': 'member' });
  });

  it('平台管理员按创建者算', async () => {
    h.state.user = { id: 'a1', role: 'admin' };
    h.state.tables.course_members.push({ course_id: 'c-joined', user_id: 'a1', role: 'student' });
    expect(await standings()).toEqual({ 'c-joined': 'owner' });
  });

  it('查课内身份失败：整页照常，自己建的课仍是 owner，其余不给身份（前端就不显示课程管理）', async () => {
    h.state.failStandings = true;
    expect(await standings()).toEqual({ 'c-own': 'owner', 'c-managed': null, 'c-joined': null });
  });
});
