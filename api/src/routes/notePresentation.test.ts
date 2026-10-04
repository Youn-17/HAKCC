import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 右键「固定」和附件「在画布上显示图片 / 显示为条目」：共享画布的版式，空间成员都能存。
 *
 * 以前这两项走作者专用的 PUT /notes/:id，菜单却对所有人显示。同学点了只改了本地，
 * 403 被前端吞掉，刷新后又回到原样。现在走 PATCH /notes/:id/presentation，
 * 口径同 /position：进得了空间就能改，小组隔离照旧；只合并这两个键，不整块写 metadata。
 *
 * 路由挂在真实的 Express 上跑，accessControl 用真的，只替换数据库和鉴权。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const T0 = '2026-09-01T00:00:00Z';
  const seed = (): Record<string, Row[]> => ({
    courses: [{ id: 'course-1', instructor_id: 'owner-1' }],
    spaces: [
      { id: 'space-shared', course_id: 'course-1', group_id: null },
      { id: 'space-a', course_id: 'course-1', group_id: 'group-a' },
    ],
    course_members: [
      { course_id: 'course-1', user_id: 'owner-1', role: 'teacher' },
      { course_id: 'course-1', user_id: 'student-a', role: 'student' },
      { course_id: 'course-1', user_id: 'student-b', role: 'student' },
    ],
    group_members: [
      { group_id: 'group-a', user_id: 'student-a' },
      { group_id: 'group-b', user_id: 'student-b' },
    ],
    notes: [
      {
        id: 'note-a', space_id: 'space-shared', author_id: 'student-a', title: '学生甲的观点',
        content: '<p>原文</p>', metadata: {}, updated_at: T0, deleted_at: null,
      },
      {
        id: 'note-img', space_id: 'space-shared', author_id: 'student-a', title: '实验照片', content: '',
        metadata: { is_fixed: true, mdVersions: [{ url: 'https://storage.example/old.md' }] },
        updated_at: T0, deleted_at: null,
      },
      // 线上有 6 条 metadata 是 null 的老笔记
      { id: 'note-null', space_id: 'space-shared', author_id: 'student-a', title: '老笔记', content: '', metadata: null, updated_at: T0, deleted_at: null },
      { id: 'note-group-a', space_id: 'space-a', author_id: 'student-a', title: '第一组的观点', content: '', metadata: {}, updated_at: T0, deleted_at: null },
      { id: 'note-deleted', space_id: 'space-shared', author_id: 'student-a', title: '删掉的', content: '', metadata: {}, updated_at: T0, deleted_at: T0 },
    ],
  });

  const db: Record<string, Row[]> = seed();
  const state = { user: { id: 'student-b', role: 'student' } as { id: string; role: string } };
  const updates: Array<{ table: string; patch: Row }> = [];
  /** 在 notes 的写入真正落下之前跑一下，模拟「读和写之间别人改了这一行」 */
  const hooks = { beforeNotesUpdate: null as null | (() => void) };

  /** jsonb 的相等：不看键的顺序 */
  const sameJson = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a as Row);
    const kb = Object.keys(b as Row);
    return ka.length === kb.length && ka.every(k => sameJson((a as Row)[k], (b as Row)[k]));
  };

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' = 'select';
    let patch: Row = {};
    let columns = '*';
    const rows = () => (db[table] ??= []);
    const view = (r: Row): Row => {
      const out: Row = { ...r };
      if (table === 'spaces' && columns.includes('courses')) {
        out.courses = { instructor_id: db.courses.find(c => c.id === r.course_id)?.instructor_id ?? null };
      }
      return out;
    };
    const execute = (): Row[] => {
      if (op === 'update') {
        if (table === 'notes') hooks.beforeNotesUpdate?.();
        const hit = rows().filter(r => filters.every(f => f(r)));
        hit.forEach(r => Object.assign(r, structuredClone(patch)));
        updates.push({ table, patch });
        return hit;
      }
      return rows().filter(r => filters.every(f => f(r)));
    };
    const builder: Record<string, unknown> = {
      select: (cols = '*') => { columns = cols; return builder; },
      update: (p: Row) => { op = 'update'; patch = p; return builder; },
      // PostgREST 把过滤值当字面量交给 Postgres，jsonb 列按 jsonb 比
      eq: (col: string, value: unknown) => {
        filters.push(r => (r[col] !== null && typeof r[col] === 'object' && typeof value === 'string'
          ? sameJson(r[col], JSON.parse(value))
          : r[col] === value));
        return builder;
      },
      is: (col: string, value: unknown) => { filters.push(r => (r[col] ?? null) === value); return builder; },
      single: async () => {
        const found = execute().map(view);
        return found[0] ? { data: found[0], error: null } : { data: null, error: { message: 'no rows' } };
      },
      maybeSingle: async () => ({ data: execute().map(view)[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve().then(() => ({ data: execute().map(view), error: null })).then(ok, fail),
    };
    return builder;
  };

  const reset = () => {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, seed());
    state.user = { id: 'student-b', role: 'student' };
    updates.length = 0;
    hooks.beforeNotesUpdate = null;
  };

  return { db, state, updates, hooks, from, reset };
});

vi.mock('../config/supabase', () => ({
  supabase: { from: h.from, rpc: async () => ({ data: null, error: null }) },
}));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user, name: h.state.user.id };
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/experimentCondition', () => ({
  fetchExperimentMode: async () => false,
  resolveEffectiveCondition: async () => ({ condition: null, groupId: null, experimentMode: false }),
  invalidateConditionCache: () => {},
}));
vi.mock('../services/kbIngest', () => ({ scheduleKbIngest: () => {}, ingestNoteIntoKb: async () => {} }));
vi.mock('../services/embeddingService', () => ({ embedNote: async () => {} }));
vi.mock('../services/metricsService', () => ({ updateHeatScore: async () => {}, getSpaceMetricsSummary: async () => ({}) }));

import notesRouter from './notes';
import { errorHandler } from '../middleware/errorHandler';
import { invalidateMembershipCache, invalidateSpaceCache } from '../services/accessControl';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', notesRouter);
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

const note = (id: string) => h.db.notes.find(n => n.id === id)!;
const as = (id: string, role = 'student') => { h.state.user = { id, role }; };
const present = (id: string, body: unknown) => fetch(`${base}/notes/${id}/presentation`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('空间成员都能存，不必是作者', () => {
  it('同学固定别人的卡：库里多了 is_fixed，正文和 updated_at 不动', async () => {
    as('student-b');
    const res = await present('note-a', { is_fixed: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ metadata: { is_fixed: true } });
    expect(note('note-a')).toMatchObject({
      metadata: { is_fixed: true },
      content: '<p>原文</p>',
      updated_at: '2026-09-01T00:00:00Z',
    });
    // 这条接口只写 metadata 一列
    expect(h.updates.filter(u => u.table === 'notes').map(u => Object.keys(u.patch))).toEqual([['metadata']]);
  });

  it('切附件的显示方式：只动 display_mode，已有的键原样保留', async () => {
    as('student-b');
    const res = await present('note-img', { display_mode: 'card' });
    expect(res.status).toBe(200);
    expect(note('note-img').metadata).toEqual({
      is_fixed: true,
      mdVersions: [{ url: 'https://storage.example/old.md' }],
      display_mode: 'card',
    });
  });

  it('取消固定也能存', async () => {
    as('student-b');
    expect((await present('note-img', { is_fixed: false })).status).toBe(200);
    expect(note('note-img').metadata).toMatchObject({ is_fixed: false });
  });

  it('metadata 是 null 的老笔记也能存', async () => {
    as('student-b');
    expect((await present('note-null', { is_fixed: true })).status).toBe(200);
    expect(note('note-null').metadata).toEqual({ is_fixed: true });
  });

  it('课程教师照常', async () => {
    as('owner-1', 'teacher');
    expect((await present('note-group-a', { is_fixed: true })).status).toBe(200);
    expect(note('note-group-a').metadata).toEqual({ is_fixed: true });
  });
});

describe('两个人同时改，谁的都不丢', () => {
  it('读和写之间有人改了另一个键：重读再合并，两个键都在', async () => {
    as('student-b');
    h.hooks.beforeNotesUpdate = () => {
      note('note-a').metadata = { display_mode: 'media' };
      h.hooks.beforeNotesUpdate = null;
    };
    const res = await present('note-a', { is_fixed: true });
    expect(res.status).toBe(200);
    expect(note('note-a').metadata).toEqual({ display_mode: 'media', is_fixed: true });
  });

  it('一直有人在改：试三次后报 409，不硬写', async () => {
    as('student-b');
    let n = 0;
    h.hooks.beforeNotesUpdate = () => { note('note-a').metadata = { display_mode: n++ % 2 ? 'media' : 'card' }; };
    const res = await present('note-a', { is_fixed: true });
    expect(res.status).toBe(409);
    expect(note('note-a').metadata).not.toHaveProperty('is_fixed');
  });
});

describe('进不了空间的人照样进不来', () => {
  it('别组的学生改不了绑组空间里的卡', async () => {
    as('student-b');
    expect((await present('note-group-a', { is_fixed: true })).status).toBe(403);
    expect(note('note-group-a').metadata).toEqual({});
  });

  it('不在这门课里的人改不了', async () => {
    as('outsider');
    expect((await present('note-a', { is_fixed: true })).status).toBe(403);
    expect(note('note-a').metadata).toEqual({});
  });

  it('已删除的笔记 404', async () => {
    as('student-a');
    expect((await present('note-deleted', { is_fixed: true })).status).toBe(404);
    expect(note('note-deleted').metadata).toEqual({});
  });
});

describe('只收这两个键', () => {
  it.each([
    ['is_fixed 不是布尔值', { is_fixed: 'true' }],
    ['display_mode 不认识', { display_mode: 'huge' }],
    ['带了别的键', { is_fixed: true, title: '改标题' }],
    ['整块 metadata 不收', { metadata: { is_fixed: true } }],
    ['什么都没传', {}],
  ])('%s：400，库里不变', async (_label, body) => {
    as('student-b');
    expect((await present('note-a', body)).status).toBe(400);
    expect(note('note-a')).toMatchObject({ metadata: {}, title: '学生甲的观点' });
    expect(h.updates).toHaveLength(0);
  });
});
