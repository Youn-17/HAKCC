import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 改自己的名字（PATCH /auth/me，2026-10-10 用户：学生也可以改自己的名字，原来只开给教师和管理员）。
 * 改名要同步两处署名快照（notes.author_name、note_feedbacks.published_by_name），清掉鉴权缓存，
 * 并留一条旧名→新名的操作记录。数据库、鉴权和操作记录换成假的。
 */

const h = vi.hoisted(() => ({
  user: { id: 'stu-1', role: 'student', name: 'Chen Houdi' } as { id: string; role: string; name: string },
  updates: [] as Array<{ table: string; patch: Record<string, unknown>; eq: [string, unknown] }>,
  events: [] as Array<Record<string, unknown>>,
  invalidated: [] as string[],
}));

vi.mock('../config/supabase', () => {
  const from = (table: string) => {
    let patch: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      update: (p: Record<string, unknown>) => { patch = p; return builder; },
      eq: (col: string, value: unknown) => { h.updates.push({ table, patch, eq: [col, value] }); return builder; },
      select: () => builder,
      single: async () => ({ data: { id: h.user.id, full_name: patch.full_name ?? h.user.name, email: 'x@hakcc.com', role: h.user.role, status: 'active', avatar_url: null, school: null, age: null, bio: null }, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
    };
    return builder;
  };
  return { supabase: { from, storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: 'https://store.example/' } }) }) } }, supabaseAuth: {} };
});
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { ...h.user, email: 'x@hakcc.com', status: 'active' }; next(); },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  invalidateAuthCache: (token: string) => { h.invalidated.push(token); },
}));
vi.mock('../services/eventService', () => ({ logEvent: (e: Record<string, unknown>) => { h.events.push(e); } }));
vi.mock('../services/attachmentValidation', () => ({ validateUpload: vi.fn() }));

import authRouter from './auth';
import { errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => { const s = app.listen(0, '127.0.0.1', () => done(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`;
});
afterAll(() => new Promise<void>(done => server.close(() => done())));
beforeEach(() => {
  h.user = { id: 'stu-1', role: 'student', name: 'Chen Houdi' };
  h.updates.length = 0;
  h.events.length = 0;
  h.invalidated.length = 0;
});

const patch = (body: unknown) => fetch(`${base}/me`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-1' }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));

describe('改自己的名字', () => {
  it('学生可以改：存去掉首尾空格的名字，两处署名快照跟着改，清鉴权缓存，留旧名→新名记录', async () => {
    const res = await patch({ name: '  陈厚迪  ' });
    expect(res.status).toBe(200);
    expect(res.body.user.name ?? res.body.user.full_name).toBe('陈厚迪');
    expect(h.updates).toEqual(expect.arrayContaining([
      { table: 'profiles', patch: { full_name: '陈厚迪' }, eq: ['id', 'stu-1'] },
      { table: 'notes', patch: { author_name: '陈厚迪' }, eq: ['author_id', 'stu-1'] },
      { table: 'note_feedbacks', patch: { published_by_name: '陈厚迪' }, eq: ['published_by', 'stu-1'] },
    ]));
    expect(h.invalidated).toEqual(['tok-1']);
    expect(h.events).toEqual([expect.objectContaining({ event_type: 'profile_name_changed', object_id: 'stu-1', metadata_json: { from: 'Chen Houdi', to: '陈厚迪' } })]);
  });

  it('名字没变不留记录；教师照旧可以改', async () => {
    h.user = { id: 't-1', role: 'teacher', name: '刘老师' };
    expect((await patch({ name: '刘老师' })).status).toBe(200);
    expect(h.events).toEqual([]);
    expect((await patch({ name: '刘一' })).status).toBe(200);
    expect(h.events).toHaveLength(1);
  });

  it('空名字、超过 50 个字、不是字符串都拒绝，什么都不改', async () => {
    expect((await patch({ name: '   ' })).status).toBe(400);
    expect((await patch({ name: '名'.repeat(51) })).status).toBe(400);
    expect((await patch({ name: 42 })).status).toBe(400);
    expect(h.updates).toEqual([]);
  });
});
