import 'express-async-errors';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 组长与教师发布的小组任务（2026-10-10，迁移 088）。
 *
 * 路由挂在真实的 Express 上，accessControl 用真的，只替换数据库、鉴权和操作记录。
 * 组长：教职随时能改；组员在没有组长时可以自己定，有了组长只有组长本人能移交或卸任。
 * 任务：只有教职能发布、改、撤回；学生只看得到发给自己组的；选了视图的只在那个空间里出现。
 */

const COURSE = '11111111-1111-4111-8111-111111111111';
const SPACE = '22222222-2222-4222-8222-222222222222';
const SPACE2 = '33333333-3333-4333-8333-333333333333';
const VIEW1 = '44444444-4444-4444-8444-444444444444';
const VIEW2 = '55555555-5555-4555-8555-555555555555';
const G1 = '66666666-6666-4666-8666-666666666661';
const G2 = '66666666-6666-4666-8666-666666666662';

const U = {
  owner: '00000000-0000-4000-8000-000000000001',
  a: '00000000-0000-4000-8000-000000000002',
  b: '00000000-0000-4000-8000-000000000003',
  c: '00000000-0000-4000-8000-000000000004',
  outsider: '00000000-0000-4000-8000-000000000005',
} as const;
const ROLE: Record<string, string> = { [U.owner]: 'teacher', [U.a]: 'student', [U.b]: 'student', [U.c]: 'student', [U.outsider]: 'student' };

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const UUID_COLUMNS = new Set(['id', 'course_id', 'group_id', 'user_id', 'space_id', 'assignment_id', 'created_by', 'instructor_id']);
  const db: Record<string, Row[]> = {};
  const state = { user: { id: '', role: 'student' } };
  const events: Row[] = [];
  let nextId = 1;
  let clock = Date.parse('2026-10-10T00:00:00Z');
  const now = () => new Date(clock += 1000).toISOString();

  const from = (table: string) => {
    type Op = 'select' | 'insert' | 'update' | 'delete';
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; ascending: boolean }> = [];
    let op: Op = 'select';
    let columns = '*';
    let payload: Row[] = [];
    let patch: Row = {};
    let badId: string | null = null;
    let limit = Infinity;
    const rows = () => (db[table] ??= []);
    const view = (r: Row): Row => {
      const out: Row = { ...r };
      if (columns.includes('courses!inner(instructor_id)')) {
        const course = (db.courses ?? []).find(c => c.id === r.course_id);
        out.courses = course ? { instructor_id: course.instructor_id } : null;
      }
      return out;
    };
    const execute = (): Row[] => {
      const hit = rows().filter(r => filters.every(f => f(r)));
      if (op === 'insert') {
        const created = payload.map(p => ({ id: `00000000-0000-4000-c000-${String(nextId++).padStart(12, '0')}`, created_at: now(), updated_at: now(), generated_at: now(), ...p }));
        rows().push(...created);
        return created;
      }
      if (op === 'update') { hit.forEach(r => Object.assign(r, patch)); return hit; }
      if (op === 'delete') { db[table] = rows().filter(r => !hit.includes(r)); return hit; }
      return [...hit].sort((x, y) => {
        for (const { col, ascending } of orders) {
          const a = x[col] as string; const b = y[col] as string;
          if (a === b) continue;
          return (a < b ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      }).slice(0, limit);
    };
    const run = (terminal: 'single' | 'maybeSingle' | 'many') => {
      if (badId !== null) return { data: null, error: { code: '22P02', message: `invalid input syntax for type uuid: "${badId}"` } };
      const found = execute().map(view);
      if (terminal === 'many') return { data: found, error: null };
      if (found.length === 0) return { data: null, error: terminal === 'single' ? { code: 'PGRST116', message: 'no rows' } : null };
      return { data: found[0], error: null };
    };
    const builder: Record<string, unknown> = {
      select: (cols = '*') => { columns = cols; return builder; },
      insert: (p: Row | Row[]) => { op = 'insert'; payload = Array.isArray(p) ? p : [p]; return builder; },
      update: (p: Row) => { op = 'update'; patch = p; return builder; },
      delete: () => { op = 'delete'; return builder; },
      eq: (col: string, value: unknown) => {
        if (UUID_COLUMNS.has(col) && typeof value === 'string' && !UUID.test(value)) badId = value;
        filters.push(r => r[col] === value);
        return builder;
      },
      in: (col: string, values: unknown[]) => { filters.push(r => values.includes(r[col])); return builder; },
      is: (col: string, value: unknown) => { filters.push(r => (r[col] ?? null) === value); return builder; },
      order: (col: string, opts?: { ascending?: boolean }) => { orders.push({ col, ascending: opts?.ascending !== false }); return builder; },
      limit: (n: number) => { limit = n; return builder; },
      single: async () => run('single'),
      maybeSingle: async () => run('maybeSingle'),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve().then(() => run('many')).then(ok, fail),
    };
    return builder;
  };
  const reset = (seed: Record<string, Row[]>) => {
    for (const key of Object.keys(db)) delete db[key];
    for (const [table, list] of Object.entries(seed)) db[table] = list.map(r => ({ ...r }));
    events.length = 0;
    nextId = 1;
  };
  const uploads: Array<{ path: string; bytes: number; contentType: string }> = [];
  const storage = {
    from: () => ({
      upload: async (path: string, buffer: Buffer, opts: { contentType: string }) => { uploads.push({ path, bytes: buffer.length, contentType: opts.contentType }); return { error: null }; },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://store.example/${path}` } }),
    }),
  };
  return { db, state, events, from, reset, uploads, storage };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from, storage: h.storage } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { ...h.state.user, name: h.state.user.id, email: '', status: 'active' }; next(); },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/eventService', () => ({ logEvent: (e: Record<string, unknown>) => { h.events.push(e); } }));
vi.mock('../services/experimentCondition', () => ({ invalidateConditionCache: () => {} }));

import groupsRouter from './groups';
import viewsRouter from './views';
import { errorHandler } from '../middleware/errorHandler';
import { invalidateMembershipCache, invalidateSpaceCache } from '../services/accessControl';

const seed = () => ({
  courses: [{ id: COURSE, title: '知识建构', instructor_id: U.owner }],
  course_members: [U.a, U.b, U.c].map(user_id => ({ course_id: COURSE, user_id, role: 'student' })),
  profiles: Object.entries(U).map(([name, id]) => ({ id, full_name: name, role: ROLE[id] })),
  groups: [
    { id: G1, name: '第一组', course_id: COURSE, leader_id: null, created_at: '2026-10-01T00:00:00Z' },
    { id: G2, name: '第二组', course_id: COURSE, leader_id: U.c, created_at: '2026-10-02T00:00:00Z' },
  ],
  group_members: [{ group_id: G1, user_id: U.a }, { group_id: G1, user_id: U.b }, { group_id: G2, user_id: U.c }],
  spaces: [{ id: SPACE, course_id: COURSE, group_id: null }, { id: SPACE2, course_id: COURSE, group_id: null }],
  views: [{ id: VIEW1, space_id: SPACE, title: '第3周', group_id: null }, { id: VIEW2, space_id: SPACE2, title: '另一个空间的视图', group_id: null }],
  view_cards: [],
  group_assignments: [],
  group_assignment_targets: [],
  notifications: [],
  notes: [],
  relations: [],
  group_idea_graphs: [],
});

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', groupsRouter);
  app.use('/api', viewsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => { const s = app.listen(0, '127.0.0.1', () => done(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise<void>(done => server.close(() => done())));
beforeEach(() => {
  h.reset(seed());
  invalidateMembershipCache();
  invalidateSpaceCache();
});

const as = (id: string) => { h.state.user = { id, role: ROLE[id] }; };
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const leaderOf = (groupId: string) => h.db.groups.find(g => g.id === groupId)!.leader_id;
const flush = () => new Promise(r => setTimeout(r, 20));

describe('组长', () => {
  it('教师随时能指定，必须是组员', async () => {
    as(U.owner);
    expect((await call('PUT', `/groups/${G2}/leader`, { leader_id: U.c })).status).toBe(200);
    expect((await call('PUT', `/groups/${G1}/leader`, { leader_id: U.c })).status).toBe(400);
    expect((await call('PUT', `/groups/${G1}/leader`, { leader_id: U.b })).status).toBe(200);
    expect(leaderOf(G1)).toBe(U.b);
  });

  it('还没有组长：组员可以自己定；定了以后别的组员改不了，组长本人能移交、卸任', async () => {
    as(U.a);
    expect((await call('PUT', `/groups/${G1}/leader`, { leader_id: U.a })).body).toEqual({ group: { id: G1, leaderId: U.a } });
    as(U.b);
    expect((await call('PUT', `/groups/${G1}/leader`, { leader_id: U.b })).status).toBe(403);
    as(U.a);
    expect((await call('PUT', `/groups/${G1}/leader`, { leader_id: U.b })).status).toBe(200);
    as(U.b);
    expect((await call('PUT', `/groups/${G1}/leader`, { leader_id: null })).status).toBe(200);
    expect(leaderOf(G1)).toBeNull();
    expect(h.events.filter(e => e.event_type === 'group_leader_set')).toHaveLength(3);
  });

  it('别的组的学生改不了，课外的人也不行', async () => {
    as(U.c);
    expect((await call('PUT', `/groups/${G1}/leader`, { leader_id: U.a })).status).toBe(403);
    as(U.outsider);
    expect((await call('PUT', `/groups/${G1}/leader`, { leader_id: U.a })).status).toBe(403);
  });

  it('原组长已经不在组里：当作没有组长，组员可以重新定', async () => {
    h.db.groups.find(g => g.id === G1)!.leader_id = U.c;
    as(U.a);
    expect((await call('PUT', `/groups/${G1}/leader`, { leader_id: U.a })).status).toBe(200);
  });
});

describe('移出小组', () => {
  it('教师移出组长：组里没有他了，组长一并取消，留一条记录', async () => {
    as(U.owner);
    expect((await call('DELETE', `/groups/${G2}/members/${U.c}`)).status).toBe(200);
    expect(h.db.group_members.some(m => m.group_id === G2 && m.user_id === U.c)).toBe(false);
    expect(leaderOf(G2)).toBeNull();
    expect(h.events.find(e => e.event_type === 'group_member_removed')).toMatchObject({ object_id: G2, metadata_json: { user_id: U.c, was_leader: true } });
  });

  it('移出普通组员，组长不变；学生不能移出别人', async () => {
    h.db.groups.find(g => g.id === G1)!.leader_id = U.a;
    as(U.b);
    expect((await call('DELETE', `/groups/${G1}/members/${U.a}`)).status).toBe(403);
    as(U.owner);
    expect((await call('DELETE', `/groups/${G1}/members/${U.b}`)).status).toBe(200);
    expect(leaderOf(G1)).toBe(U.a);
    expect(h.db.group_members.filter(m => m.group_id === G1).map(m => m.user_id)).toEqual([U.a]);
    expect(h.events.at(-1)).toMatchObject({ event_type: 'group_member_removed', metadata_json: { user_id: U.b, was_leader: false } });
  });
});

describe('观点图谱：每周一期与往期（2026-10-11）', () => {
  const note = (id: string, author: string, created_at: string, title: string) =>
    ({ id, author_id: author, author_name: author, space_id: SPACE, type: 'note', is_ai_generated: false, title, content: `<p>${title}</p>`, created_at });
  const graphs = () => [...h.db.group_idea_graphs].sort((x, y) => String(x.window_end).localeCompare(String(y.window_end)));
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('隔了两周才打开：两周各补一期，每期按那一周结束时的笔记算；再打开不重复生成', async () => {
    h.db.notes.push(
      note('n1', U.a, '2026-10-02T08:00:00Z', '认知卸载会不会让人变懒'),
      note('n2', U.b, '2026-10-03T08:00:00Z', '认知卸载和提问引导'),
      note('n3', U.a, '2026-10-04T08:00:00Z', '提问引导的例子'),
      note('n4', U.b, '2026-10-09T08:00:00Z', '苏格拉底式提问'),
      note('n5', U.a, '2026-10-16T08:00:00Z', '还没满一周的笔记'),
    );
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    as(U.a);
    const res = await call('GET', `/groups/${G1}/idea-graph`);
    expect(res.status).toBe(200);
    expect(graphs().map(g => [g.window_start, g.window_end, g.note_count, g.trigger])).toEqual([
      ['2026-10-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z', 3, 'auto'],
      ['2026-10-08T00:00:00.000Z', '2026-10-15T00:00:00.000Z', 4, 'auto'],
    ]);
    expect(res.body.regenerated).toBe(true);
    expect(res.body.graph.window_end).toBe('2026-10-15T00:00:00.000Z');
    expect(res.body.history.map((x: { note_count: number }) => x.note_count)).toEqual([4, 3]);

    const again = await call('GET', `/groups/${G1}/idea-graph`);
    expect(again.body.regenerated).toBe(false);
    expect(h.db.group_idea_graphs).toHaveLength(2);
  });

  it('笔记不够的周并进下一期；一期都还没有时返回 pending', async () => {
    h.db.notes.push(note('m1', U.c, '2026-10-03T08:00:00Z', '只有一条'));
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
    as(U.c);
    const pending = await call('GET', `/groups/${G2}/idea-graph`);
    expect(pending.body).toMatchObject({ graph: null, pending: true, haveNotes: 1, history: [] });

    h.db.notes.push(
      note('m2', U.c, '2026-10-10T08:00:00Z', '第二条'),
      note('m3', U.c, '2026-10-11T08:00:00Z', '第三条'),
    );
    vi.setSystemTime(new Date('2026-10-17T00:00:00Z'));
    const res = await call('GET', `/groups/${G2}/idea-graph`);
    expect(graphs().map(g => [g.window_start, g.window_end, g.note_count])).toEqual([
      ['2026-10-02T00:00:00.000Z', '2026-10-16T00:00:00.000Z', 3],
    ]);
    expect(res.body.graph.note_count).toBe(3);
  });

  it('教师手动重算不挪每周的格子；往期按 id 取，别的组、组外的人取不到', async () => {
    h.db.notes.push(
      note('n1', U.a, '2026-10-02T08:00:00Z', '一'), note('n2', U.b, '2026-10-03T08:00:00Z', '二'),
      note('n3', U.a, '2026-10-04T08:00:00Z', '三'), note('n4', U.b, '2026-10-12T08:00:00Z', '四'),
    );
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
    as(U.owner);
    await call('GET', `/groups/${G1}/idea-graph`);
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    const manual = await call('POST', `/groups/${G1}/idea-graph/refresh`);
    expect(manual.body.graph).toMatchObject({ trigger: 'manual', window_start: '2026-10-08T00:00:00.000Z' });
    expect(manual.body.history).toHaveLength(2);
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    await call('GET', `/groups/${G1}/idea-graph`);
    const weekly = graphs().filter(g => g.trigger === 'auto');
    expect(weekly.map(g => [g.window_start, g.window_end])).toEqual([
      ['2026-10-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z'],
      ['2026-10-08T00:00:00.000Z', '2026-10-15T00:00:00.000Z'],
    ]);

    const first = weekly[0].id as string;
    const one = await call('GET', `/groups/${G1}/idea-graph/snapshots/${first}`);
    expect(one.status).toBe(200);
    expect(one.body.graph).toMatchObject({ id: first, note_count: 3 });
    expect(one.body.graph.payload.notes).toHaveLength(3);
    expect((await call('GET', `/groups/${G2}/idea-graph/snapshots/${first}`)).status).toBe(404);
    as(U.c);
    expect((await call('GET', `/groups/${G1}/idea-graph/snapshots/${first}`)).status).toBe(403);
  });
});

describe('小组 logo', () => {
  // 1×1 的 PNG
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const upload = (groupId: string, body: Record<string, unknown> = { file_name: '第一组.png', mime_type: 'image/png', data_url: PNG }) =>
    call('POST', `/groups/${groupId}/logo`, body);

  it('教师上传：存进 group-logos/，小组和这个组的视图都带上 logo，留一条记录；可以去掉', async () => {
    h.uploads.length = 0;
    h.db.views.push({ id: '77777777-7777-4777-8777-777777777771', space_id: SPACE, title: '第一组', group_id: G1, created_at: '2026-10-10T01:00:00Z' });
    as(U.owner);
    const res = await upload(G1);
    expect(res.status).toBe(200);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].path).toMatch(new RegExp(`^group-logos/${G1}-\\d+-`));
    const url = `https://store.example/${h.uploads[0].path}`;
    expect(res.body).toEqual({ group: { id: G1, logoUrl: url } });
    expect(h.db.groups.find(g => g.id === G1)!.logo_url).toBe(url);
    expect(h.events.find(e => e.event_type === 'group_logo_set')).toMatchObject({ object_id: G1, metadata_json: { cleared: false } });

    const list = await call('GET', `/courses/${COURSE}/groups`);
    expect(list.body.groups.find((g: { id: string }) => g.id === G1).logoUrl).toBe(url);
    expect(list.body.groups.find((g: { id: string }) => g.id === G2).logoUrl).toBeNull();
    const views = await call('GET', `/spaces/${SPACE}/views`);
    expect(views.status).toBe(200);
    const byId = Object.fromEntries(views.body.views.map((v: { id: string; groupLogoUrl: string | null }) => [v.id, v.groupLogoUrl]));
    expect(byId['77777777-7777-4777-8777-777777777771']).toBe(url);
    expect(byId[VIEW1]).toBeNull();

    expect((await call('DELETE', `/groups/${G1}/logo`)).body).toEqual({ group: { id: G1, logoUrl: null } });
    expect(h.db.groups.find(g => g.id === G1)!.logo_url).toBeNull();
    expect(h.events.filter(e => e.event_type === 'group_logo_set').at(-1)).toMatchObject({ metadata_json: { cleared: true } });
  });

  it('学生不能改；不是图片的、缺参数的都拒绝，什么都不存', async () => {
    h.uploads.length = 0;
    as(U.a);
    expect((await upload(G1)).status).toBe(403);
    expect((await call('DELETE', `/groups/${G1}/logo`)).status).toBe(403);
    as(U.owner);
    const text = `data:image/png;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')}`;
    expect((await upload(G1, { file_name: 'logo.png', mime_type: 'image/png', data_url: text })).status).toBe(400);
    expect((await upload(G1, { file_name: 'logo.png' })).status).toBe(400);
    expect(h.uploads).toHaveLength(0);
    expect(h.db.groups.find(g => g.id === G1)!.logo_url ?? null).toBeNull();
  });
});

describe('教师发布的小组任务', () => {
  const publish = (body: Record<string, unknown>) => call('POST', `/courses/${COURSE}/group-assignments`, body);

  it('学生不能发布；教师默认发给全部小组，组员收到通知（教师自己不收）', async () => {
    as(U.a);
    expect((await publish({ title: '读文献' })).status).toBe(403);
    as(U.owner);
    const res = await publish({ title: '读文献', content: '读第三章', requirements: '1. 写出两个观点\n- 至少回应一位同学\n\n', lang: 'zh' });
    expect(res.status).toBe(201);
    expect(res.body.assignment).toMatchObject({
      title: '读文献', content: '读第三章', requirements: ['写出两个观点', '至少回应一位同学'],
      groups: [{ id: G1, name: '第一组' }, { id: G2, name: '第二组' }], spaceId: null, viewId: null,
    });
    await flush();
    expect(h.db.notifications.map(n => n.user_id).sort()).toEqual([U.a, U.b, U.c].sort());
    expect(h.db.notifications[0]).toMatchObject({ type: 'group_assignment', title: '新的小组任务', link_type: 'group' });
    expect(h.events.find(e => e.event_type === 'group_assignment_published')).toBeTruthy();
  });

  it('可以只发给部分小组；不是这门课的组、空标题都拒绝', async () => {
    as(U.owner);
    expect((await publish({ title: '只给第二组', group_ids: [G2] })).body.assignment.groups).toEqual([{ id: G2, name: '第二组' }]);
    expect((await publish({ title: '错的组', group_ids: ['77777777-7777-4777-8777-777777777777'] })).status).toBe(400);
    expect((await publish({ title: '   ' })).status).toBe(400);
    expect((await publish({ title: '没选组', group_ids: [] })).status).toBe(400);
  });

  it('选视图：可以是主画布或这个空间里的视图；别的空间的视图、只给视图不给空间都拒绝', async () => {
    as(U.owner);
    expect((await publish({ title: '主画布', space_id: SPACE, view_id: 'view-welcome' })).body.assignment).toMatchObject({ spaceId: SPACE, viewId: 'view-welcome' });
    expect((await publish({ title: '第3周', space_id: SPACE, view_id: VIEW1 })).status).toBe(201);
    expect((await publish({ title: '张冠李戴', space_id: SPACE, view_id: VIEW2 })).status).toBe(400);
    expect((await publish({ title: '缺空间', view_id: VIEW1 })).status).toBe(400);
  });

  it('列表：教师看全部；学生只看发给自己组的，组也只列自己的', async () => {
    as(U.owner);
    await publish({ title: '全体' });
    await publish({ title: '只给第二组', group_ids: [G2] });
    expect((await call('GET', `/courses/${COURSE}/group-assignments`)).body.assignments.map((a: { title: string }) => a.title)).toEqual(['只给第二组', '全体']);
    as(U.a);
    const mine = (await call('GET', `/courses/${COURSE}/group-assignments`)).body.assignments;
    expect(mine.map((a: { title: string }) => a.title)).toEqual(['全体']);
    expect(mine[0].groups).toEqual([{ id: G1, name: '第一组' }]);
  });

  it('工作区：共享空间里学生看自己组的，教师看全部；指定了别的空间的任务不出现', async () => {
    as(U.owner);
    await publish({ title: '全体' });
    await publish({ title: '只给第二组', group_ids: [G2] });
    await publish({ title: '另一个空间', space_id: SPACE2 });
    await publish({ title: '本空间第3周', space_id: SPACE, view_id: VIEW1 });
    const titles = async () => (await call('GET', `/spaces/${SPACE}/group-assignments`)).body.assignments.map((a: { title: string }) => a.title).sort();
    expect(await titles()).toEqual(['全体', '只给第二组', '本空间第3周'].sort());
    as(U.a);
    expect(await titles()).toEqual(['全体', '本空间第3周'].sort());
    as(U.outsider);
    expect((await call('GET', `/spaces/${SPACE}/group-assignments`)).status).toBe(403);
  });

  it('绑定小组的空间：只显示发给这个组的', async () => {
    h.db.spaces.push({ id: '88888888-8888-4888-8888-888888888888', course_id: COURSE, group_id: G2 });
    as(U.owner);
    await publish({ title: '全体' });
    await publish({ title: '只给第一组', group_ids: [G1] });
    as(U.c);
    const res = await call('GET', '/spaces/88888888-8888-4888-8888-888888888888/group-assignments');
    expect(res.body.assignments.map((a: { title: string }) => a.title)).toEqual(['全体']);
  });

  it('修改：内容和发给哪些组都能改；撤回后两边都看不到；学生不能改也不能撤回', async () => {
    as(U.owner);
    const id = (await publish({ title: '初稿' })).body.assignment.id as string;
    as(U.a);
    expect((await call('PATCH', `/group-assignments/${id}`, { title: '学生改' })).status).toBe(403);
    expect((await call('DELETE', `/group-assignments/${id}`)).status).toBe(403);
    as(U.owner);
    const patched = await call('PATCH', `/group-assignments/${id}`, { title: '定稿', group_ids: [G1], due_at: '2026-10-20T08:00:00.000Z' });
    expect(patched.body.assignment).toMatchObject({ title: '定稿', groups: [{ id: G1, name: '第一组' }], dueAt: '2026-10-20T08:00:00.000Z' });
    as(U.c);
    expect((await call('GET', `/spaces/${SPACE}/group-assignments`)).body.assignments).toEqual([]);
    as(U.owner);
    expect((await call('DELETE', `/group-assignments/${id}`)).status).toBe(200);
    expect(h.db.group_assignments[0].deleted_at).toBeTruthy();
    as(U.a);
    expect((await call('GET', `/spaces/${SPACE}/group-assignments`)).body.assignments).toEqual([]);
  });
});

describe('为每组建视图', () => {
  it('教师：给每个组建一个视图（标题是组名、记上组），主画布上横排入口卡片；再点不会重复建', async () => {
    as(U.owner);
    const first = await call('POST', `/spaces/${SPACE}/group-views`, { origin_x: 0, origin_y: -300, gap: 300 });
    expect(first.status).toBe(201);
    expect(first.body.views.map((v: { title: string; groupId: string }) => [v.title, v.groupId])).toEqual([['第一组', G1], ['第二组', G2]]);
    expect(first.body.cards.map((c: { x: number; y: number; hostViewId: string }) => [c.x, c.y, c.hostViewId])).toEqual([[0, -300, 'view-welcome'], [300, -300, 'view-welcome']]);
    const again = await call('POST', `/spaces/${SPACE}/group-views`, {});
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ views: [], existing: 2 });
    // 学生读视图列表能看到这些视图和它们属于哪个组
    as(U.a);
    const list = await call('GET', `/spaces/${SPACE}/views`);
    expect(list.body.views.filter((v: { groupId: string | null }) => v.groupId).map((v: { title: string }) => v.title)).toEqual(['第一组', '第二组']);
  });

  it('学生不能建；绑定了小组的空间不能建', async () => {
    as(U.a);
    expect((await call('POST', `/spaces/${SPACE}/group-views`, {})).status).toBe(403);
    h.db.spaces.push({ id: '99999999-9999-4999-8999-999999999999', course_id: COURSE, group_id: G1 });
    as(U.owner);
    expect((await call('POST', '/spaces/99999999-9999-4999-8999-999999999999/group-views', {})).status).toBe(400);
  });

  it('任务发到「各组自己的视图」：要给空间；只给视图不给空间、view 没给视图都拒绝', async () => {
    as(U.owner);
    const ok = await call('POST', `/courses/${COURSE}/group-assignments`, { title: '各组讨论', placement: 'group_view', space_id: SPACE });
    expect(ok.status).toBe(201);
    expect(ok.body.assignment).toMatchObject({ placement: 'group_view', spaceId: SPACE, viewId: null });
    expect((await call('POST', `/courses/${COURSE}/group-assignments`, { title: 'x', placement: 'group_view' })).status).toBe(400);
    expect((await call('POST', `/courses/${COURSE}/group-assignments`, { title: 'x', placement: 'view', space_id: SPACE })).status).toBe(400);
    expect((await call('POST', `/courses/${COURSE}/group-assignments`, { title: 'x', placement: 'elsewhere' })).status).toBe(400);
    // 改成不限位置
    const id = ok.body.assignment.id as string;
    const patched = await call('PATCH', `/group-assignments/${id}`, { placement: 'any', space_id: null, view_id: null });
    expect(patched.body.assignment).toMatchObject({ placement: 'any', spaceId: null, viewId: null });
  });
});
