import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 图灵测试的列表和 /me 带回 host：调用者在这门课里是不是主持方。
 * 口径就是这些路由自己的 requireCourseMember：创建者、course_members.role 为 teacher/admin 的
 * 课程管理员、平台管理员是主持方；平台身份是教师不算数，凭学生验证码入课（role=student）或
 * 受邀还没设为管理员（role=member）的教师账号是参加测试的人。页面据此给「设置与主持」还是「进入活动」。
 */

const COURSE_ID = '33333333-3333-4333-8333-333333333333';
const ACTIVITY_ID = '44444444-4444-4444-8444-444444444444';

const h = vi.hoisted(() => {
  const state = {
    user: { id: 'u-1', role: 'teacher' as string },
    memberRole: null as string | null,
    isInstructor: false,
  };
  const activity = {
    id: '44444444-4444-4444-8444-444444444444',
    course_id: '33333333-3333-4333-8333-333333333333',
    created_by: 'owner-1', title: '第一轮图灵测试', topic: '什么算智能', instructions: null,
    status: 'open', chat_minutes: 5, room_size: 6, ai_per_room: 1, disclose_ai_count: true,
    ai_provider: 'deepseek', ai_model: 'deepseek-flash', config: null,
    started_at: null, ends_at: null, revealed_at: null, created_at: '2026-09-20T08:00:00Z', updated_at: '2026-09-20T08:00:00Z',
  };
  /** 单行查询（maybeSingle / single）的结果 */
  const one = (table: string) => {
    if (table === 'course_members') return { data: state.memberRole ? { role: state.memberRole } : null, error: null };
    if (table === 'courses') return { data: state.isInstructor ? { id: activity.course_id } : null, error: null };
    if (table === 'turing_test_activities') return { data: activity, error: null };
    return { data: null, error: null };
  };
  /** 列表查询（直接 await）的结果 */
  const many = (table: string) => {
    if (table === 'turing_test_activities') return { data: [activity], error: null };
    return { data: [], error: null };
  };
  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      maybeSingle: () => Promise.resolve(one(table)),
      single: () => Promise.resolve(one(table)),
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(many(table)).then(ok, fail),
    };
    for (const m of ['select', 'eq', 'in', 'order', 'not', 'lte', 'gt', 'limit']) builder[m] = () => builder;
    return builder;
  };
  return { state, from };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
}));

import turingTestRouter from './turingTest';
import { errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';
/** 路由里课内角色缓存 30 秒（按课程 + 用户），每个用例换一个用户 id */
let seq = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', turingTestRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  h.state.memberRole = null;
  h.state.isInstructor = false;
});

async function hostAs(account: { role: string; memberRole?: string; isInstructor?: boolean }) {
  h.state.user = { id: `user-${++seq}`, role: account.role };
  h.state.memberRole = account.memberRole ?? null;
  h.state.isInstructor = account.isInstructor ?? false;
  const list = await fetch(`${base}/turing-test/${COURSE_ID}`);
  const me = await fetch(`${base}/turing-test/${COURSE_ID}/${ACTIVITY_ID}/me`);
  expect(list.status).toBe(200);
  expect(me.status).toBe(200);
  const listBody = (await list.json()) as { host?: boolean; activities: unknown[] };
  const meBody = (await me.json()) as { host?: boolean };
  expect(listBody.activities).toHaveLength(1);
  // 两处口径一致
  expect(meBody.host).toBe(listBody.host);
  return listBody.host;
}

describe('图灵测试的 host：按课内身份，不按平台身份', () => {
  it('教师账号凭学生验证码入课（role=student）：参加测试的人', async () => {
    expect(await hostAs({ role: 'teacher', memberRole: 'student' })).toBe(false);
  });

  it('教师账号受邀、还没设为课程管理员（role=member）：参加测试的人', async () => {
    expect(await hostAs({ role: 'teacher', memberRole: 'member' })).toBe(false);
  });

  it('课程管理员：主持方', async () => {
    expect(await hostAs({ role: 'teacher', memberRole: 'teacher' })).toBe(true);
  });

  it('课程创建者：主持方', async () => {
    expect(await hostAs({ role: 'teacher', isInstructor: true })).toBe(true);
  });

  it('平台管理员：主持方', async () => {
    expect(await hostAs({ role: 'admin' })).toBe(true);
  });

  it('学生：参加测试的人', async () => {
    expect(await hostAs({ role: 'student', memberRole: 'student' })).toBe(false);
  });
});
