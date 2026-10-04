import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * GET /courses/:courseId/members 对课里任何成员开放（学生打开小组管理要名字和头像），
 * 但邮箱和每个人的实验分组只给课程教职：分组是盲法要藏的（小组列表、迁移 063 同一口径）。
 * 原先两样都发给所有人，学生能看到全班邮箱，也能看到自己和同学在哪个实验组。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const seed = (): Record<string, Row[]> => ({
    courses: [
      { id: 'course-1', title: '知识建构', instructor_id: 'owner-1' },
      { id: 'course-2', title: '早期建的课', instructor_id: 'owner-2' },
    ],
    course_members: [
      { course_id: 'course-1', user_id: 'owner-1', role: 'teacher', joined_at: '2026-09-01', ai_feedback_condition: null },
      { course_id: 'course-1', user_id: 'co-teacher', role: 'teacher', joined_at: '2026-09-02', ai_feedback_condition: null },
      { course_id: 'course-1', user_id: 'teacher-joined', role: 'student', joined_at: '2026-09-03', ai_feedback_condition: 'treatment' },
      { course_id: 'course-1', user_id: 'student-a', role: 'student', joined_at: '2026-09-04', ai_feedback_condition: 'control' },
      { course_id: 'course-1', user_id: 'student-b', role: 'student', joined_at: '2026-09-05', ai_feedback_condition: 'treatment' },
      // 早期建的课：创建者不在成员表里，接口单独补一条
      { course_id: 'course-2', user_id: 'student-a', role: 'student', joined_at: '2026-09-06', ai_feedback_condition: null },
    ],
    profiles: [
      { id: 'owner-1', role: 'teacher', full_name: '王老师', email: 'owner1@example.edu', avatar_url: null },
      { id: 'owner-2', role: 'teacher', full_name: '李老师', email: 'owner2@example.edu', avatar_url: null },
      { id: 'co-teacher', role: 'teacher', full_name: '赵老师', email: 'co@example.edu', avatar_url: null },
      { id: 'teacher-joined', role: 'teacher', full_name: '钱老师', email: 'joined@example.edu', avatar_url: null },
      { id: 'student-a', role: 'student', full_name: '林晓', email: 'a@example.edu', avatar_url: null },
      { id: 'student-b', role: 'student', full_name: '周宁', email: 'b@example.edu', avatar_url: null },
    ],
  });

  const db = seed();
  const state = { user: { id: 'student-a', role: 'student' } as { id: string; role: string } };

  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const inList: Record<string, unknown[]> = {};
    const rows = () => (db[table] ?? []).filter(r =>
      Object.entries(eq).every(([k, v]) => r[k] === v)
      && Object.entries(inList).every(([k, vs]) => vs.includes(r[k])));
    const run = (terminal: 'single' | 'maybeSingle' | 'many') => {
      const found = rows().map(r => ({ ...r }));
      if (terminal === 'many') return { data: found, error: null };
      if (!found[0]) return { data: null, error: terminal === 'single' ? { message: 'no rows' } : null };
      return { data: found[0], error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, value: unknown) => { eq[col] = value; return builder; },
      in: (col: string, values: unknown[]) => { inList[col] = values; return builder; },
      single: async () => run('single'),
      maybeSingle: async () => run('maybeSingle'),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve(run('many')).then(onOk, onFail),
    };
    for (const m of ['order', 'limit', 'is', 'not']) builder[m] = () => builder;
    return builder;
  };

  const reset = () => {
    Object.assign(db, seed());
    state.user = { id: 'student-a', role: 'student' };
  };

  return { state, from, reset };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/experimentCondition', () => ({ invalidateConditionCache: () => {} }));

import courseSettingsRouter from './courseSettings';
import { errorHandler } from '../middleware/errorHandler';
import { invalidateMembershipCache } from '../services/accessControl';

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
  h.reset();
  invalidateMembershipCache();
});

const as = (id: string, role: string) => { h.state.user = { id, role }; };

type MemberRow = { userId: string; name: string; email?: string; aiFeedbackCondition: string | null };

async function listMembers(courseId: string) {
  const res = await fetch(`${base}/courses/${courseId}/members`);
  return { status: res.status, body: await res.json() as { members: MemberRow[]; viewerStanding: string } };
}

describe('GET /courses/:courseId/members', () => {
  it('学生拿到名字，拿不到邮箱和任何人的实验分组', async () => {
    as('student-a', 'student');
    const { status, body } = await listMembers('course-1');
    expect(status).toBe(200);
    expect(body.viewerStanding).toBe('member');
    expect(body.members.map(m => m.name)).toContain('周宁');
    expect(body.members.every(m => m.email === undefined)).toBe(true);
    expect(body.members.every(m => m.aiFeedbackCondition === null)).toBe(true);
  });

  it('凭学生验证码入课的教师账号在这门课里也是成员，同样拿不到', async () => {
    as('teacher-joined', 'teacher');
    const { body } = await listMembers('course-1');
    expect(body.viewerStanding).toBe('member');
    expect(body.members.every(m => m.email === undefined && m.aiFeedbackCondition === null)).toBe(true);
  });

  it('创建者和课程管理员拿到邮箱和实验分组', async () => {
    for (const [id, standing] of [['owner-1', 'owner'], ['co-teacher', 'manager']] as const) {
      as(id, 'teacher');
      const { body } = await listMembers('course-1');
      expect(body.viewerStanding).toBe(standing);
      const byId = new Map(body.members.map(m => [m.userId, m]));
      expect(byId.get('student-a')?.email).toBe('a@example.edu');
      expect(byId.get('student-a')?.aiFeedbackCondition).toBe('control');
      expect(byId.get('student-b')?.aiFeedbackCondition).toBe('treatment');
    }
  });

  it('单独补上的创建者那一条，也不给学生看邮箱', async () => {
    as('student-a', 'student');
    const { body } = await listMembers('course-2');
    const owner = body.members.find(m => m.userId === 'owner-2');
    expect(owner?.name).toBe('李老师');
    expect(owner?.email).toBeUndefined();
  });

  it('不在课里的人照旧 403', async () => {
    as('student-b', 'student');
    const { status } = await listMembers('course-2');
    expect(status).toBe(403);
  });
});
