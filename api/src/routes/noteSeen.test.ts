import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 画布卡片的「New」（070，按人算）：同学发的笔记，我还没打开过，就在我这里标 New。
 *   POST /notes/:id/seen —— 我第一次打开时记一行（笔记, 我），再打开不覆盖；作者自己的不记；
 *   GET /spaces/:id/notes —— 每条带 seen_by_me，只看调用者自己的记录；
 *     2026-09-15 以前发的一律当看过；查不到记录时也一律当看过（不能满屏 New）。
 *
 * 路由挂在真实的 Express 上跑，accessControl 用真的，只替换数据库和鉴权。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const T0 = '2026-09-28T14:00:00Z';
  const OLD = '2026-09-01T02:00:00Z';
  const profile = (id: string) => ({ id, full_name: id, email: `${id}@example.test`, avatar_url: null });
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
      { course_id: 'course-1', user_id: 'student-c', role: 'student' },
    ],
    group_members: [
      { group_id: 'group-a', user_id: 'student-a' },
      { group_id: 'group-b', user_id: 'student-b' },
    ],
    notes: [
      { id: 'note-new', space_id: 'space-shared', author_id: 'student-a', title: '刚发的', content: '', created_at: T0, updated_at: T0, deleted_at: null, author_profile: profile('student-a') },
      { id: 'note-read', space_id: 'space-shared', author_id: 'student-a', title: '有人看过', content: '', created_at: T0, updated_at: T0, deleted_at: null, author_profile: profile('student-a') },
      { id: 'note-group-a', space_id: 'space-a', author_id: 'student-a', title: '第一组的', content: '', created_at: T0, updated_at: T0, deleted_at: null, author_profile: profile('student-a') },
      { id: 'note-deleted', space_id: 'space-shared', author_id: 'student-a', title: '删掉的', content: '', created_at: T0, updated_at: T0, deleted_at: T0, author_profile: profile('student-a') },
      { id: 'note-old', space_id: 'space-shared', author_id: 'student-a', title: '九月初的', content: '', created_at: OLD, updated_at: OLD, deleted_at: null, author_profile: profile('student-a') },
      { id: 'note-mine', space_id: 'space-shared', author_id: 'student-b', title: '学生乙自己的', content: '', created_at: T0, updated_at: T0, deleted_at: null, author_profile: profile('student-b') },
    ],
    note_views: [
      { note_id: 'note-read', viewer_id: 'student-c', first_viewed_at: T0 },
    ],
  });

  const db: Record<string, Row[]> = seed();
  const state = {
    user: { id: 'student-b', role: 'student' } as { id: string; role: string },
    failViews: false,
    legacyRevisionTime: false,
  };

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'upsert' = 'select';
    let upsertRow: Row = {};
    let ignoreDuplicates = false;
    let columns = '*';
    const rows = () => (db[table] ??= []);
    const view = (r: Row): Row => {
      const out: Row = { ...r };
      if (table === 'spaces' && columns.includes('courses')) {
        out.courses = { instructor_id: db.courses.find(c => c.id === r.course_id)?.instructor_id ?? null };
      }
      if (table === 'note_revisions' && columns.includes('edited_at:created_at')) out.edited_at = r.created_at;
      return out;
    };
    const execute = (): { data: Row[] | null; error: { message: string } | null } => {
      if (table === 'note_views' && state.failViews) return { data: null, error: { message: 'relation does not exist' } };
      if (table === 'note_revisions' && state.legacyRevisionTime && columns.includes(' edited_at, ')) return { data: null, error: { message: 'column note_revisions.edited_at does not exist' } };
      if (op === 'upsert') {
        const existing = rows().find(r => r.note_id === upsertRow.note_id && r.viewer_id === upsertRow.viewer_id);
        if (existing && !ignoreDuplicates) Object.assign(existing, upsertRow);
        if (!existing) rows().push({ first_viewed_at: new Date().toISOString(), ...upsertRow });
        return { data: [], error: null };
      }
      return { data: rows().filter(r => filters.every(f => f(r))).map(view), error: null };
    };
    const builder: Record<string, unknown> = {
      select: (cols = '*') => { columns = cols; return builder; },
      upsert: (row: Row, opts?: { ignoreDuplicates?: boolean }) => {
        op = 'upsert'; upsertRow = row; ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
        return builder;
      },
      eq: (col: string, value: unknown) => {
        // 嵌入表上的过滤（notes!inner(space_id) + eq('notes.space_id')）：按 note_id 连到 notes 上比
        if (col.startsWith('notes.')) {
          const key = col.slice('notes.'.length);
          filters.push(r => db.notes.find(n => n.id === r.note_id)?.[key] === value);
        } else {
          filters.push(r => r[col] === value);
        }
        return builder;
      },
      is: (col: string, value: unknown) => { filters.push(r => (r[col] ?? null) === value); return builder; },
      in: (col: string, values: unknown[]) => { filters.push(r => values.includes(col.startsWith('notes.') ? db.notes.find(n => n.id === r.note_id)?.[col.slice(6)] : r[col])); return builder; },
      order: () => builder,
      range: () => builder,
      limit: () => builder,
      single: async () => {
        const { data } = execute();
        return data?.[0] ? { data: data[0], error: null } : { data: null, error: { message: 'no rows' } };
      },
      maybeSingle: async () => ({ data: execute().data?.[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve().then(() => {
          const result = execute();
          return { ...result, count: result.data?.length ?? null };
        }).then(ok, fail),
    };
    return builder;
  };

  const reset = () => {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, seed());
    state.user = { id: 'student-b', role: 'student' };
    state.failViews = false;
    state.legacyRevisionTime = false;
  };

  return { db, state, from, reset };
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

const as = (id: string, role = 'student') => { h.state.user = { id, role }; };
const markSeen = (id: string) => fetch(`${base}/notes/${id}/seen`, { method: 'POST' });
const viewsOf = (noteId: string) => h.db.note_views.filter(r => r.note_id === noteId);

describe('knowledge progression endpoint', () => {
  it('preserves group isolation before reading history', async () => {
    as('student-b');
    const response=await fetch(`${base}/spaces/space-a/timeline`);
    expect(response.status).toBe(403);
  });
  it('aggregates only enterable course spaces and keeps research controls course scoped', async () => {
    h.db.notes.push({id:'private-a',space_id:'space-a',author_id:'student-a',title:'仅组内',content:'',created_at:'2026-09-29T00:00:00Z',deleted_at:null});
    as('student-b');
    const student=await (await fetch(`${base}/spaces/space-shared/timeline?scope=course`)).json();
    expect(student.context.spaces.map((s:{id:string})=>s.id)).toEqual(['space-shared']);
    expect(student.structure.notes.some((n:{id:string})=>n.id==='private-a')).toBe(false);
    expect(student.context.canExport).toBe(false);
    as('student-b','teacher');
    const participant=await (await fetch(`${base}/spaces/space-shared/timeline?scope=course`)).json();
    expect(participant.context.canExport).toBe(false);
    expect(participant.structure.notes.some((n:{id:string})=>n.id==='private-a')).toBe(false);
    as('owner-1','teacher');
    const staff=await (await fetch(`${base}/spaces/space-shared/timeline?scope=course`)).json();
    expect(staff.structure.notes.find((n:{id:string})=>n.id==='private-a')).toMatchObject({spaceId:'space-a',groupId:'group-a'});
    expect(staff.context.canExport).toBe(true);
    expect(staff.context.participants.find((p:{id:string})=>p.id==='student-a').code).toMatch(/^P-/);
    expect((await fetch(`${base}/spaces/space-shared/timeline?scope=all`)).status).toBe(400);
  });
  it('includes real saved revisions and only own private AI activity', async () => {
    as('student-b');
    const note=h.db.notes.find(n=>n.id==='note-new')!;
    note.content='<p>加入证据后的解释</p>';
    h.db.note_revisions=[{id:'revision-1',note_id:'note-new',title:'原先的观点',content:'<p>原先的解释</p>',editor_id:'student-a',revision_number:1,edited_at:'2026-09-29T10:00:00Z'}];
    h.db.note_ai_feedbacks=[
      {id:'mine',note_id:'note-new',space_id:'space-shared',user_id:'student-b',created_at:'2026-09-29T11:00:00Z'},
      {id:'private-peer',note_id:'note-new',space_id:'space-shared',user_id:'student-a',created_at:'2026-09-29T11:00:00Z'},
    ];
    const response=await fetch(`${base}/spaces/space-shared/timeline`);
    expect(response.status).toBe(200);
    const history=await response.json();
    expect(history.items.find((i:{id:string})=>i.id==='revision:revision-1')).toMatchObject({kind:'revision',at:'2026-09-29T10:00:00Z',beforeExcerpt:'原先的解释',excerpt:'加入证据后的解释'});
    expect(history.items.filter((i:{kind:string})=>i.kind==='ai_feedback').map((i:{id:string})=>i.id)).toEqual(['fb:mine']);
    expect(history.structure.notes.some((n:{id:string})=>n.id==='note-deleted')).toBe(false);
    expect(history.coverage).toMatchObject({truncated:false,privateAiScope:'self'});
  });
  it('returns real revision timestamps with the legacy production schema', async () => {
    as('student-b');
    h.state.legacyRevisionTime = true;
    h.db.note_revisions = [{id:'legacy-1',note_id:'note-new',title:'原先的观点',content:'<p>最初解释</p>',editor_id:'student-a',revision_number:1,created_at:'2026-09-29T10:00:00Z'}];
    const response = await fetch(`${base}/spaces/space-shared/timeline?scope=course`);
    expect(response.status).toBe(200);
    const history = await response.json();
    expect(history.items.find((i:{id:string})=>i.id==='revision:legacy-1')).toMatchObject({at:'2026-09-29T10:00:00Z',actorId:'student-a',beforeExcerpt:'最初解释'});
    expect(history.coverage.revisionTimestampField).toBe('created_at');
  });
});
const listNotes = async (spaceId = 'space-shared') => {
  const res = await fetch(`${base}/spaces/${spaceId}/notes`);
  expect(res.status).toBe(200);
  const body = await res.json() as { notes: Array<{ id: string; seen_by_me: boolean }> };
  return Object.fromEntries(body.notes.map(n => [n.id, n.seen_by_me]));
};

describe('POST /notes/:id/seen', () => {
  it('同学第一次打开：记下（笔记, 这个人）', async () => {
    as('student-b');
    const res = await markSeen('note-new');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });
    expect(viewsOf('note-new')).toEqual([expect.objectContaining({ viewer_id: 'student-b' })]);
  });

  it('作者自己打开不记', async () => {
    as('student-a');
    const res = await markSeen('note-new');
    expect(await res.json()).toEqual({ recorded: false });
    expect(viewsOf('note-new')).toEqual([]);
  });

  it('每人各记一行；同一个人再打开不覆盖第一次的时间', async () => {
    as('student-b');
    await markSeen('note-read');
    expect(viewsOf('note-read').map(r => r.viewer_id).sort()).toEqual(['student-b', 'student-c']);
    as('student-c');
    await markSeen('note-read');
    expect(viewsOf('note-read').find(r => r.viewer_id === 'student-c')).toMatchObject({ first_viewed_at: '2026-09-28T14:00:00Z' });
    expect(viewsOf('note-read')).toHaveLength(2);
  });

  it('进不去的小组空间、删掉的笔记：不记', async () => {
    as('student-b');
    expect((await markSeen('note-group-a')).status).toBe(403);
    expect((await markSeen('note-deleted')).status).toBe(404);
    expect(viewsOf('note-group-a')).toEqual([]);
    expect(viewsOf('note-deleted')).toEqual([]);
  });
});

describe('GET /spaces/:id/notes 带 seen_by_me（按人）', () => {
  it('只看自己的记录：学生丙看过的，在学生乙这里仍是新的', async () => {
    as('student-b');
    expect(await listNotes()).toMatchObject({ 'note-new': false, 'note-read': false });
    as('student-c');
    expect(await listNotes()).toMatchObject({ 'note-new': false, 'note-read': true });
  });

  it('我打开之后只有我这里不再是新的', async () => {
    as('student-b');
    await markSeen('note-new');
    expect((await listNotes())['note-new']).toBe(true);
    as('student-c');
    expect((await listNotes())['note-new']).toBe(false);
  });

  it('自己的笔记、9 月 15 日以前的笔记都不算新', async () => {
    as('student-b');
    expect(await listNotes()).toMatchObject({ 'note-mine': true, 'note-old': true });
  });

  it('记录查不到（比如迁移还没跑）：一律当看过，画布照常出来', async () => {
    as('student-b');
    h.state.failViews = true;
    expect(await listNotes()).toEqual({ 'note-new': true, 'note-read': true, 'note-old': true, 'note-mine': true });
  });
});
