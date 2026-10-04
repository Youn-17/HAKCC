import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 文档查看器里编辑 Markdown 附件后「保存」：POST /notes/:id/markdown-versions。
 *
 * 以前前端先传新文件，再拿打开阅读器时的整块 metadata 加上新的 mdVersions 经 PUT 写回：
 * 这期间同学固定了这张卡会被改回去，两个人各存一版会互相丢掉对方的历史记录。
 * 现在上传、换地址、记旧版本都在服务端做，metadata 以读到的旧值为条件写。
 * 旧客户端还会经 PUT 带整块 metadata 来，PUT 改成按键合并，mdVersions 只由服务端记。
 *
 * 路由挂在真实的 Express 上跑，accessControl 用真的，只替换数据库、存储和鉴权。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const T0 = '2026-09-01T00:00:00Z';
  const V1 = 'https://storage.example/note-chat-attachments/spaces/course-1/space-shared/1-v1.md';
  const markdownNote = (id: string, spaceId: string, extra: Row = {}): Row => ({
    id, space_id: spaceId, author_id: 'student-a', type: 'attachment', title: '实验记录', content: '',
    file_url: V1, file_name: '实验记录.md', mime_type: 'text/markdown',
    metadata: {}, updated_at: T0, deleted_at: null, ...extra,
  });
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
      markdownNote('note-md', 'space-shared'),
      markdownNote('note-md-group', 'space-a'),
      markdownNote('note-md-deleted', 'space-shared', { deleted_at: T0 }),
      markdownNote('note-pdf', 'space-shared', {
        file_url: 'https://storage.example/report.pdf', file_name: '报告.pdf', mime_type: 'application/pdf',
      }),
      {
        id: 'note-a', space_id: 'space-shared', author_id: 'student-a', type: 'note', title: '学生甲的观点',
        content: '<p>原文</p>', metadata: { is_fixed: true }, updated_at: T0, deleted_at: null,
      },
    ],
  });

  const db: Record<string, Row[]> = seed();
  const state = { user: { id: 'student-a', role: 'student' } as { id: string; role: string } };
  const updates: Array<{ table: string; patch: Row }> = [];
  /** 在 notes 的写入真正落下之前跑一下，模拟「读和写之间别人改了这一行」 */
  const hooks = { beforeNotesUpdate: null as null | (() => void) };
  const storage = {
    objects: new Map<string, { body: string; contentType?: string }>(),
    uploads: [] as string[],
    removed: [] as string[],
  };

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
    let op: 'select' | 'update' | 'insert' = 'select';
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
      if (op === 'insert') {
        rows().push(structuredClone(patch));
        return [patch];
      }
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
      insert: (p: Row) => { op = 'insert'; patch = p; return builder; },
      // PostgREST 把过滤值当字面量交给 Postgres，jsonb 列按 jsonb 比
      eq: (col: string, value: unknown) => {
        filters.push(r => (r[col] !== null && typeof r[col] === 'object' && typeof value === 'string'
          ? sameJson(r[col], JSON.parse(value))
          : r[col] === value));
        return builder;
      },
      is: (col: string, value: unknown) => { filters.push(r => (r[col] ?? null) === value); return builder; },
      in: (col: string, values: unknown[]) => { filters.push(r => values.includes(r[col])); return builder; },
      order: () => builder,
      limit: () => builder,
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

  const bucket = (name: string) => ({
    upload: async (path: string, body: Buffer, opts?: { contentType?: string }) => {
      storage.objects.set(path, { body: body.toString('utf8'), contentType: opts?.contentType });
      storage.uploads.push(path);
      return { data: { path }, error: null };
    },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${name}/${path}` } }),
    remove: async (paths: string[]) => {
      for (const path of paths) {
        storage.objects.delete(path);
        storage.removed.push(path);
      }
      return { data: [], error: null };
    },
  });

  const reset = () => {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, seed());
    state.user = { id: 'student-a', role: 'student' };
    updates.length = 0;
    hooks.beforeNotesUpdate = null;
    storage.objects.clear();
    storage.uploads.length = 0;
    storage.removed.length = 0;
  };

  return { db, state, updates, hooks, storage, from, bucket, reset, V1 };
});

vi.mock('../config/supabase', () => ({
  supabase: {
    from: h.from,
    rpc: async () => ({ data: null, error: null }),
    storage: { from: h.bucket },
  },
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
vi.mock('../services/kbIngest', () => ({
  scheduleKbIngest: () => {}, scheduleKbRefresh: async () => {}, ingestNoteIntoKb: async () => {},
}));
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

const V1 = h.V1;
const NEW_PREFIX = 'https://storage.example/note-chat-attachments/spaces/course-1/space-shared/';
const note = (id: string) => h.db.notes.find(n => n.id === id)!;
const as = (id: string, role = 'student') => { h.state.user = { id, role }; };
const markdown = (text: string) => `data:text/markdown;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
const send = (method: string, path: string, body: unknown) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const saveVersion = (id: string, body: unknown) => send('POST', `/notes/${id}/markdown-versions`, body);
const edit = (text: string, extra: Record<string, unknown> = {}) => ({
  data_url: markdown(text), file_name: '实验记录.md', base_file_url: V1, ...extra,
});
const noteWrites = () => h.updates.filter(u => u.table === 'notes');

describe('作者保存编辑后的 Markdown', () => {
  it('存成新文件，附件指过去，旧地址记进 mdVersions', async () => {
    as('student-a');
    const res = await saveVersion('note-md', edit('# 第二版\n\n加了一段结论。'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.file_url.startsWith(NEW_PREFIX)).toBe(true);
    expect(body).toMatchObject({ file_name: '实验记录.md', mime_type: 'text/markdown' });
    const path = body.file_url.replace('https://storage.example/note-chat-attachments/', '');
    expect(h.storage.objects.get(path)).toEqual({ body: '# 第二版\n\n加了一段结论。', contentType: 'text/markdown' });

    expect(note('note-md')).toMatchObject({ file_url: body.file_url, file_name: '实验记录.md', mime_type: 'text/markdown' });
    expect(note('note-md').metadata).toEqual({
      mdVersions: [{ url: V1, replacedAt: expect.any(String), by: 'student-a' }],
    });
    expect(body.metadata).toEqual(note('note-md').metadata);
    expect(h.storage.removed).toEqual([]);
  });

  it('阅读器开着的时候同学固定了这张卡：保存后还是固定的', async () => {
    as('student-a');
    note('note-md').metadata = { is_fixed: true };
    expect((await saveVersion('note-md', edit('改过的正文'))).status).toBe(200);
    expect(note('note-md').metadata).toEqual({
      is_fixed: true,
      mdVersions: [{ url: V1, replacedAt: expect.any(String), by: 'student-a' }],
    });
  });

  it('读和写之间同学正好点了「固定」：重读再写，两样都在', async () => {
    as('student-a');
    h.hooks.beforeNotesUpdate = () => {
      note('note-md').metadata = { is_fixed: true };
      h.hooks.beforeNotesUpdate = null;
    };
    expect((await saveVersion('note-md', edit('改过的正文'))).status).toBe(200);
    expect(note('note-md').metadata).toMatchObject({ is_fixed: true, mdVersions: [{ url: V1 }] });
    expect(noteWrites()).toHaveLength(2);
  });

  it('课程教师也能存', async () => {
    as('owner-1', 'teacher');
    expect((await saveVersion('note-md', edit('老师改过的正文'))).status).toBe(200);
    expect(note('note-md').metadata).toMatchObject({ mdVersions: [{ url: V1, by: 'owner-1' }] });
  });

  it('旧版本只留最近 20 条', async () => {
    as('student-a');
    note('note-md').metadata = {
      mdVersions: Array.from({ length: 20 }, (_, i) => ({ url: `https://storage.example/v0-${i}.md` })),
    };
    expect((await saveVersion('note-md', edit('第 22 版'))).status).toBe(200);
    const versions = (note('note-md').metadata as { mdVersions: Array<{ url: string }> }).mdVersions;
    expect(versions).toHaveLength(20);
    expect(versions[0].url).toBe('https://storage.example/v0-1.md');
    expect(versions[19].url).toBe(V1);
  });
});

describe('两个人同时改同一份', () => {
  it('从同一版开始改：先存的生效，后存的回 409，不上传，库里是先存的那版', async () => {
    as('student-a');
    const first = await (await saveVersion('note-md', edit('作者的版本'))).json();
    as('owner-1', 'teacher');
    const second = await saveVersion('note-md', edit('老师的版本'));
    expect(second.status).toBe(409);

    expect(h.storage.uploads).toHaveLength(1);
    expect(note('note-md').file_url).toBe(first.file_url);
    expect(note('note-md').metadata).toEqual({
      mdVersions: [{ url: V1, replacedAt: expect.any(String), by: 'student-a' }],
    });
  });

  it('读和写之间对方存好了：写的时候再比一次，回 409，刚传的文件删掉', async () => {
    as('student-a');
    const other = 'https://storage.example/note-chat-attachments/spaces/course-1/space-shared/2-other.md';
    h.hooks.beforeNotesUpdate = () => {
      Object.assign(note('note-md'), {
        file_url: other,
        metadata: { mdVersions: [{ url: V1, replacedAt: '2026-09-28T07:00:00Z', by: 'owner-1' }] },
      });
      h.hooks.beforeNotesUpdate = null;
    };
    const res = await saveVersion('note-md', edit('作者的版本'));
    expect(res.status).toBe(409);
    expect(note('note-md').file_url).toBe(other);
    expect(h.storage.uploads).toHaveLength(1);
    expect(h.storage.removed).toEqual(h.storage.uploads);
  });

  it('不带 base_file_url 时不比内容，但换下来的每一版都记着', async () => {
    as('student-a');
    const other = 'https://storage.example/note-chat-attachments/spaces/course-1/space-shared/2-other.md';
    h.hooks.beforeNotesUpdate = () => {
      Object.assign(note('note-md'), {
        file_url: other,
        metadata: { mdVersions: [{ url: V1, replacedAt: '2026-09-28T07:00:00Z', by: 'owner-1' }] },
      });
      h.hooks.beforeNotesUpdate = null;
    };
    const res = await saveVersion('note-md', edit('作者的版本', { base_file_url: undefined }));
    expect(res.status).toBe(200);
    const versions = (note('note-md').metadata as { mdVersions: Array<{ url: string }> }).mdVersions;
    expect(versions.map(v => v.url)).toEqual([V1, other]);
  });

  it('一直有人在改：试三次后 409，不硬写，刚传的文件删掉', async () => {
    as('student-a');
    let n = 0;
    h.hooks.beforeNotesUpdate = () => { note('note-md').metadata = { is_fixed: n++ % 2 === 0 }; };
    const res = await saveVersion('note-md', edit('作者的版本'));
    expect(res.status).toBe(409);
    expect(note('note-md').file_url).toBe(V1);
    expect(h.storage.removed).toEqual(h.storage.uploads);
  });
});

describe('谁能存', () => {
  it('同学（不是作者）：403，存储里什么也没留下', async () => {
    as('student-b');
    expect((await saveVersion('note-md', edit('同学的版本'))).status).toBe(403);
    expect(h.storage.uploads).toEqual([]);
    expect(note('note-md')).toMatchObject({ file_url: V1, metadata: {} });
  });

  it('不在这门课里的人：403', async () => {
    as('outsider');
    expect((await saveVersion('note-md', edit('外人的版本'))).status).toBe(403);
    expect(h.storage.uploads).toEqual([]);
  });

  it('别组的学生进不了绑组空间：403', async () => {
    as('student-b');
    expect((await saveVersion('note-md-group', edit('别组的版本'))).status).toBe(403);
    expect(h.storage.uploads).toEqual([]);
  });

  it('已删除的附件：404', async () => {
    as('student-a');
    expect((await saveVersion('note-md-deleted', edit('改过的正文'))).status).toBe(404);
    expect(h.storage.uploads).toEqual([]);
  });
});

describe('只收 Markdown 附件和合规的内容', () => {
  it.each([
    ['PDF 附件', 'note-pdf', edit('正文')],
    ['没有 data_url', 'note-md', { file_name: '实验记录.md', base_file_url: V1 }],
    ['base_file_url 不是字符串', 'note-md', edit('正文', { base_file_url: 42 })],
    ['内容是 HTML', 'note-md', edit('<!DOCTYPE html><html><script>alert(1)</script></html>')],
    ['内容是空的', 'note-md', { ...edit(''), data_url: 'data:text/markdown;base64,' }],
  ])('%s：400，不上传，库里不变', async (_label, id, body) => {
    as('student-a');
    expect((await saveVersion(id, body)).status).toBe(400);
    expect(h.storage.uploads).toEqual([]);
    expect(noteWrites()).toHaveLength(0);
  });
});

describe('旧客户端经 PUT 带整块 metadata 来', () => {
  it('旧版的 Markdown 保存：换下来的地址由服务端记，捎带的旧 metadata 不写回', async () => {
    as('student-a');
    const uploaded = `${NEW_PREFIX}3-v2.md`;
    note('note-md').metadata = { is_fixed: true, mdVersions: [{ url: 'https://storage.example/v0.md' }] };
    // 打开阅读器时还没固定；列表是它自己在旧快照上追加的
    const res = await send('PUT', '/notes/note-md', {
      file_url: uploaded,
      file_name: '实验记录.md',
      mime_type: 'text/markdown',
      metadata: { mdVersions: [{ url: V1, replacedAt: '2026-09-28T07:00:00Z', by: 'student-a' }] },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).note).toMatchObject({ id: 'note-md', file_url: uploaded });
    expect(note('note-md')).toMatchObject({ file_url: uploaded });
    expect(note('note-md').metadata).toEqual({
      is_fixed: true,
      mdVersions: [
        { url: 'https://storage.example/v0.md' },
        { url: V1, replacedAt: expect.any(String), by: 'student-a' },
      ],
    });
  });

  it('旧版的「固定」：按键合并，服务端记下的 mdVersions 不被冲掉', async () => {
    as('student-a');
    note('note-md').metadata = { mdVersions: [{ url: 'https://storage.example/v0.md' }] };
    const res = await send('PUT', '/notes/note-md', { metadata: { is_fixed: true, mdVersions: [] } });
    expect(res.status).toBe(200);
    expect(note('note-md').metadata).toEqual({
      mdVersions: [{ url: 'https://storage.example/v0.md' }],
      is_fixed: true,
    });
  });

  it('读和写之间同学改了显示方式：旧版的「固定」重读再合并，两样都在', async () => {
    as('student-a');
    h.hooks.beforeNotesUpdate = () => {
      note('note-md').metadata = { display_mode: 'card' };
      h.hooks.beforeNotesUpdate = null;
    };
    expect((await send('PUT', '/notes/note-md', { metadata: { is_fixed: true } })).status).toBe(200);
    expect(note('note-md').metadata).toEqual({ display_mode: 'card', is_fixed: true });
  });

  it('普通保存（标题、正文）照旧一次写完，不碰 metadata', async () => {
    as('student-a');
    const res = await send('PUT', '/notes/note-a', { title: '改过的标题', content: '<p>改过的正文</p>' });
    expect(res.status).toBe(200);
    const writes = noteWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].patch).not.toHaveProperty('metadata');
    expect(note('note-a')).toMatchObject({ title: '改过的标题', metadata: { is_fixed: true } });
  });

  it('PUT 仍然只有作者和课程教师能用：同学带 metadata 来也是 403，库里不变', async () => {
    as('student-b');
    expect((await send('PUT', '/notes/note-md', { metadata: { is_fixed: true } })).status).toBe(403);
    expect(note('note-md').metadata).toEqual({});
    expect(noteWrites()).toHaveLength(0);
  });
});
