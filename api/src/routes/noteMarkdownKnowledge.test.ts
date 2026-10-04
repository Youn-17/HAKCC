import 'express-async-errors';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Markdown 附件存了新版本之后，缓存的正文和课程知识库要跟着换。
 *
 * 以前两条保存路径（POST /notes/:id/markdown-versions，旧客户端经 PUT /notes/:id 换 file_url）
 * 都只把笔记指向新文件：document_renders 里还是按旧文件抽的 plain_text，知识库也只在上传时入过一次，
 * 空间 AI 检索到的一直是上传时那一版。
 *
 * 路由挂在真实的 Express 上，accessControl、kbIngest、documentPipeline、knowledgeBase 都用真的，
 * 只替换数据库、存储（连同下载文件的 fetch）、鉴权和向量接口。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const T0 = '2026-09-01T00:00:00Z';
  const BUCKET = 'https://storage.example/note-chat-attachments/';
  const V1_PATH = 'spaces/course-1/space-shared/1-v1.md';
  const V1 = `${BUCKET}${V1_PATH}`;

  /** 每一版都够长（知识库只收 80 字以上），各带一个版本标记，方便查片段是哪一版的 */
  const doc = (label: string, finding: string) => [
    '# 实验记录',
    '',
    `${label}的观察：把同样多的糖放进不同条件的水里，记录完全溶解所用的时间，每个条件重复三次。`
      + '水温分别是二十度、四十度和六十度，搅拌与不搅拌各做一组。',
    '',
    `${label}的结论：${finding}`,
  ].join('\n');
  const OLD_TEXT = doc('第一版', '温度是影响溶解速度的唯一因素。');

  const seed = (): Record<string, Row[]> => ({
    courses: [{ id: 'course-1', instructor_id: 'owner-1' }],
    spaces: [{ id: 'space-shared', course_id: 'course-1', group_id: null }],
    course_members: [
      { course_id: 'course-1', user_id: 'owner-1', role: 'teacher' },
      { course_id: 'course-1', user_id: 'student-a', role: 'student' },
      { course_id: 'course-1', user_id: 'student-b', role: 'student' },
    ],
    group_members: [],
    notes: [
      {
        id: 'note-md', space_id: 'space-shared', author_id: 'student-a', type: 'attachment', title: '实验记录',
        content: '', file_url: V1, file_name: '实验记录.md', mime_type: 'text/markdown',
        metadata: {}, updated_at: T0, deleted_at: null,
      },
      {
        id: 'note-pdf', space_id: 'space-shared', author_id: 'student-a', type: 'attachment', title: '报告',
        content: '', file_url: `${BUCKET}spaces/course-1/space-shared/2-report.pdf`, file_name: '报告.pdf',
        mime_type: 'application/pdf', metadata: {}, updated_at: T0, deleted_at: null,
      },
    ],
    // 上传时算好的缓存和入库结果，都是第一版
    document_renders: [{
      note_id: 'note-md', space_id: 'space-shared', renderer: 'mammoth-1',
      markdown: null, plain_text: OLD_TEXT, text_source: 'plain',
      mineru_task_id: null, mineru_state: null, mineru_error: null,
    }],
    kb_documents: [
      {
        id: 'kb-md', course_id: 'course-1', space_id: 'space-shared', note_id: 'note-md', source_type: 'attachment',
        title: '实验记录', content: OLD_TEXT, content_hash: 'hash-of-first-version', status: 'ready',
      },
      {
        id: 'kb-pdf', course_id: 'course-1', space_id: 'space-shared', note_id: 'note-pdf', source_type: 'attachment',
        title: '报告', content: '报告的正文', content_hash: 'hash-of-report', status: 'ready',
      },
    ],
    kb_chunks: [
      { id: 'chunk-md-old', document_id: 'kb-md', course_id: 'course-1', ordinal: 0, heading_path: '实验记录', content: OLD_TEXT },
      { id: 'chunk-pdf', document_id: 'kb-pdf', course_id: 'course-1', ordinal: 0, heading_path: null, content: '报告的正文' },
    ],
  });

  /** 没传 onConflict 的 upsert 按主键合并 */
  const PRIMARY_KEY: Record<string, string> = { document_renders: 'note_id' };

  const db: Record<string, Row[]> = seed();
  const state = { user: { id: 'student-a', role: 'student' } as { id: string; role: string } };
  let seq = 0;

  const storage = {
    objects: new Map<string, { body: string; contentType?: string }>(),
    fetched: [] as string[],
    failFetch: false,
  };
  const embedding = {
    provider: null as null | { model: string },
    calls: 0,
    gate: Promise.resolve() as Promise<void>,
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
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] = {};
    let conflictKeys: string[] = [];
    let columns = '*';
    const rows = () => (db[table] ??= []);
    const view = (r: Row): Row => {
      const out: Row = { ...r };
      if (table === 'spaces' && columns.includes('courses')) {
        out.courses = { instructor_id: db.courses.find(c => c.id === r.course_id)?.instructor_id ?? null };
      }
      return out;
    };
    const list = () => (Array.isArray(payload) ? payload : [payload]);
    const execute = (): Row[] => {
      if (op === 'insert') {
        const inserted = list().map(p => ({ id: p.id ?? `${table}-${++seq}`, ...structuredClone(p) }));
        rows().push(...inserted);
        return inserted;
      }
      if (op === 'upsert') {
        const keys = conflictKeys.length ? conflictKeys : [PRIMARY_KEY[table] ?? 'id'];
        return list().map(p => {
          const hit = rows().find(r => keys.every(k => r[k] === p[k]));
          if (hit) return Object.assign(hit, structuredClone(p));
          const row = { id: p.id ?? `${table}-${++seq}`, ...structuredClone(p) };
          rows().push(row);
          return row;
        });
      }
      const hit = rows().filter(r => filters.every(f => f(r)));
      if (op === 'update') hit.forEach(r => Object.assign(r, structuredClone(payload)));
      if (op === 'delete') {
        db[table] = rows().filter(r => !hit.includes(r));
        // kb_chunks.document_id 外键 ON DELETE CASCADE
        if (table === 'kb_documents') {
          const gone = new Set(hit.map(r => r.id));
          db.kb_chunks = (db.kb_chunks ?? []).filter(c => !gone.has(c.document_id));
        }
      }
      return hit;
    };
    const builder: Record<string, unknown> = {
      select: (cols = '*') => { columns = cols; return builder; },
      insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return builder; },
      upsert: (p: Row | Row[], opts?: { onConflict?: string }) => {
        op = 'upsert'; payload = p; conflictKeys = opts?.onConflict ? opts.onConflict.split(',') : [];
        return builder;
      },
      update: (p: Row) => { op = 'update'; payload = p; return builder; },
      delete: () => { op = 'delete'; return builder; },
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
      return { data: { path }, error: null };
    },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${name}/${path}` } }),
    remove: async (paths: string[]) => {
      for (const path of paths) storage.objects.delete(path);
      return { data: [], error: null };
    },
  });

  /** documentPipeline 用 fetch 按公开地址下载附件 */
  const serveStorage = (url: string): Response => {
    storage.fetched.push(url);
    if (storage.failFetch) return new Response('unavailable', { status: 503 });
    const object = storage.objects.get(url.slice(BUCKET.length));
    return object ? new Response(object.body) : new Response('not found', { status: 404 });
  };

  const reset = () => {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, seed());
    state.user = { id: 'student-a', role: 'student' };
    storage.objects.clear();
    storage.objects.set(V1_PATH, { body: OLD_TEXT, contentType: 'text/markdown' });
    storage.fetched.length = 0;
    storage.failFetch = false;
    embedding.provider = null;
    embedding.calls = 0;
    embedding.gate = Promise.resolve();
  };

  return { db, state, storage, embedding, from, bucket, serveStorage, reset, doc, BUCKET, V1, OLD_TEXT };
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
vi.mock('../services/embeddingService', () => ({
  embedNote: async () => {},
  resolveEmbeddingProvider: async () => h.embedding.provider,
  generateEmbedding: async () => {
    h.embedding.calls += 1;
    await h.embedding.gate;
    return [0.1, 0.2, 0.3];
  },
}));
vi.mock('../services/metricsService', () => ({ updateHeatScore: async () => {}, getSpaceMetricsSummary: async () => ({}) }));
// 真的 kbIngest，只把 scheduleKbRefresh 包一层，好拿到每一轮跑完的时刻
vi.mock('../services/kbIngest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/kbIngest')>();
  return { ...actual, scheduleKbRefresh: vi.fn(actual.scheduleKbRefresh) };
});

import notesRouter from './notes';
import { errorHandler } from '../middleware/errorHandler';
import { invalidateMembershipCache, invalidateSpaceCache } from '../services/accessControl';
import { scheduleKbRefresh } from '../services/kbIngest';

const realFetch = globalThis.fetch;
const refreshes = vi.mocked(scheduleKbRefresh);
/** 等这个用例里排过的刷新全部跑完 */
const settle = () => Promise.all(refreshes.mock.results.map(r => r.value));

let server: Server;
let base = '';

beforeAll(async () => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith(h.BUCKET) ? Promise.resolve(h.serveStorage(url)) : realFetch(input, init);
  });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', notesRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>(done => server.close(() => done()));
});

beforeEach(() => {
  h.reset();
  refreshes.mockClear();
  invalidateMembershipCache();
  invalidateSpaceCache();
});

afterEach(async () => {
  // 哪个用例中途失败留下了卡住的向量化，放行，别拖住下一个用例的队列
  h.embedding.gate = Promise.resolve();
  await settle();
  vi.restoreAllMocks();
});

const V1 = h.V1;
const OLD_TEXT = h.OLD_TEXT;
const V2_TEXT = h.doc('第二版', '温度和搅拌都会让糖溶解得更快。');
const V3_TEXT = h.doc('第三版', '搅拌的影响比温度小。');
const V4_TEXT = h.doc('第四版', '温度和搅拌的影响差不多大。');

const as = (id: string, role = 'student') => { h.state.user = { id, role }; };
const note = (id: string) => h.db.notes.find(n => n.id === id)!;
const render = (noteId: string) => h.db.document_renders.find(r => r.note_id === noteId);
const kbDoc = (noteId: string) => h.db.kb_documents.find(d => d.note_id === noteId);
const chunksOf = (noteId: string) => {
  const docId = kbDoc(noteId)?.id;
  return h.db.kb_chunks.filter(c => c.document_id === docId).map(c => String(c.content));
};
const markdown = (text: string) => `data:text/markdown;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
const send = (method: string, path: string, body: unknown) => realFetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
/** 文档查看器的「保存」。每一版文件名不同，存储路径就不会因为同一毫秒撞在一起 */
const saveVersion = async (id: string, text: string, baseFileUrl: string, fileName = '实验记录.md') => {
  const res = await send('POST', `/notes/${id}/markdown-versions`, {
    data_url: markdown(text), file_name: fileName, base_file_url: baseFileUrl,
  });
  return { status: res.status, body: await res.json() as { file_url: string } };
};

describe('查看器里存了新版本', () => {
  it('缓存的正文换成新版本，知识库里只剩新版本的片段', async () => {
    as('student-a');
    const saved = await saveVersion('note-md', V2_TEXT, V1);
    expect(saved.status).toBe(200);
    await settle();

    expect(refreshes).toHaveBeenCalledTimes(1);
    expect(h.storage.fetched).toEqual([saved.body.file_url]);
    expect(render('note-md')).toMatchObject({ plain_text: V2_TEXT, text_source: 'plain', markdown: null });
    expect(kbDoc('note-md')).toMatchObject({ id: 'kb-md', content: V2_TEXT, text_source: 'plain', status: 'ready' });
    const chunks = chunksOf('note-md');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.includes('第二版'))).toBe(true);
    expect(h.db.kb_chunks.some(c => c.id === 'chunk-md-old')).toBe(false);
  });

  it('旧文件留下的 markdown 列和 MinerU 任务一起清掉，不然下次解析还会先读到它们', async () => {
    as('student-a');
    Object.assign(render('note-md')!, {
      markdown: '# 旧的呈现层正文', text_source: 'edited',
      mineru_task_id: 'task-1', mineru_state: 'done', mineru_error: null,
    });
    expect((await saveVersion('note-md', V2_TEXT, V1)).status).toBe(200);
    await settle();

    expect(render('note-md')).toMatchObject({
      markdown: null, plain_text: V2_TEXT, text_source: 'plain',
      mineru_task_id: null, mineru_state: null, mineru_error: null,
    });
    expect(kbDoc('note-md')).toMatchObject({ content: V2_TEXT });
  });

  it('课程教师存的也一样', async () => {
    as('owner-1', 'teacher');
    expect((await saveVersion('note-md', V2_TEXT, V1)).status).toBe(200);
    await settle();
    expect(kbDoc('note-md')).toMatchObject({ content: V2_TEXT });
  });

  it('从没入过库的附件，存了新版本就入库', async () => {
    as('student-a');
    h.db.document_renders.length = 0;
    h.db.kb_documents = h.db.kb_documents.filter(d => d.note_id !== 'note-md');
    h.db.kb_chunks = h.db.kb_chunks.filter(c => c.document_id !== 'kb-md');
    expect((await saveVersion('note-md', V2_TEXT, V1)).status).toBe(200);
    await settle();

    expect(render('note-md')).toMatchObject({ plain_text: V2_TEXT, space_id: 'space-shared', source_mime: 'text/markdown' });
    expect(kbDoc('note-md')).toMatchObject({ course_id: 'course-1', space_id: 'space-shared', content: V2_TEXT, status: 'ready' });
    expect(chunksOf('note-md').every(c => c.includes('第二版'))).toBe(true);
  });
});

describe('新版本短到不入库', () => {
  it.each([
    ['不到 80 字', '# 实验记录\n\n还没整理好，先占个位置。', 'plain'],
    ['只剩空白', '   \n\n   ', 'none'],
  ])('%s：知识库里这份的旧记录删掉，别的附件不动', async (_label, text, source) => {
    as('student-a');
    expect((await saveVersion('note-md', text, V1)).status).toBe(200);
    await settle();

    expect(kbDoc('note-md')).toBeUndefined();
    expect(h.db.kb_chunks.filter(c => c.document_id === 'kb-md')).toEqual([]);
    expect(kbDoc('note-pdf')).toMatchObject({ id: 'kb-pdf', content: '报告的正文' });
    expect(h.db.kb_chunks.map(c => c.id)).toEqual(['chunk-pdf']);
    expect(render('note-md')).toMatchObject({ plain_text: text.trim(), text_source: source });
  });
});

describe('连着存了几版', () => {
  it('上一轮还在向量化时又存了两版：等它跑完再按最新的文件跑一轮，库里只剩最后一版', async () => {
    as('student-a');
    h.embedding.provider = { model: 'test-embedding' };
    let release!: () => void;
    h.embedding.gate = new Promise<void>(done => { release = done; });

    const v2 = await saveVersion('note-md', V2_TEXT, V1, 'v2.md');
    expect(v2.status).toBe(200);
    // 第一轮已经删掉了旧片段，正卡在向量化上
    await vi.waitFor(() => expect(h.embedding.calls).toBe(1));

    const v3 = await saveVersion('note-md', V3_TEXT, v2.body.file_url, 'v3.md');
    const v4 = await saveVersion('note-md', V4_TEXT, v3.body.file_url, 'v4.md');
    expect([v3.status, v4.status]).toEqual([200, 200]);

    release();
    await settle();

    // 第三版在排队期间就被第四版换掉了，没有单独跑一轮
    expect(h.storage.fetched).toEqual([v2.body.file_url, v4.body.file_url]);
    expect(render('note-md')).toMatchObject({ plain_text: V4_TEXT });
    expect(kbDoc('note-md')).toMatchObject({ id: 'kb-md', content: V4_TEXT, status: 'ready' });
    const chunks = chunksOf('note-md');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.includes('第四版'))).toBe(true);
  });

  it('刚上传、上传后那一轮还没入完库就存了新版本：两轮排队，库里只有新版本', async () => {
    as('student-a');
    h.embedding.provider = { model: 'test-embedding' };
    let release!: () => void;
    h.embedding.gate = new Promise<void>(done => { release = done; });

    const upload = await send('POST', '/spaces/space-shared/attachments', {
      file_name: '新笔记.md', mime_type: 'text/markdown', data_url: markdown(OLD_TEXT),
    });
    const { attachment } = await upload.json() as { attachment: { file_url: string } };
    const created = await send('POST', '/spaces/space-shared/notes', {
      type: 'attachment', title: '新笔记', file_url: attachment.file_url, file_name: '新笔记.md', mime_type: 'text/markdown',
    });
    expect(created.status).toBe(201);
    const { note: fresh } = await created.json() as { note: { id: string } };
    await vi.waitFor(() => expect(h.embedding.calls).toBe(1));

    expect((await saveVersion(fresh.id, V2_TEXT, attachment.file_url, 'v2.md')).status).toBe(200);
    release();
    await settle();

    expect(kbDoc(fresh.id)).toMatchObject({ content: V2_TEXT, status: 'ready' });
    const chunks = chunksOf(fresh.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.includes('第二版'))).toBe(true);
    expect(render(fresh.id)).toMatchObject({ plain_text: V2_TEXT });
  });
});

describe('保存成功与否不受刷新影响', () => {
  it('读不到新文件：保存照样成功，缓存和知识库先不动，记一条错误；下次保存照常刷新', async () => {
    as('student-a');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.storage.failFetch = true;
    const first = await saveVersion('note-md', V2_TEXT, V1);
    expect(first.status).toBe(200);
    expect(note('note-md').file_url).toBe(first.body.file_url);
    await settle();

    expect(render('note-md')).toMatchObject({ plain_text: OLD_TEXT });
    expect(kbDoc('note-md')).toMatchObject({ content: OLD_TEXT });
    expect(errors).toHaveBeenCalledWith('[KB] refresh after file change failed:', 'note-md', expect.stringContaining('503'));

    h.storage.failFetch = false;
    expect((await saveVersion('note-md', V3_TEXT, first.body.file_url, 'v3.md')).status).toBe(200);
    await settle();
    expect(render('note-md')).toMatchObject({ plain_text: V3_TEXT });
    expect(kbDoc('note-md')).toMatchObject({ content: V3_TEXT });
  });

  it.each([
    ['编辑期间有人存过新版本（409）', 'student-a', 'https://storage.example/note-chat-attachments/spaces/course-1/space-shared/0-older.md', 409],
    ['同学不是作者（403）', 'student-b', V1, 403],
  ])('%s：没有换文件，也不刷新', async (_label, userId, baseUrl, status) => {
    as(userId);
    expect((await saveVersion('note-md', V2_TEXT, baseUrl)).status).toBe(status);
    await settle();
    expect(refreshes).not.toHaveBeenCalled();
    expect(note('note-md').file_url).toBe(V1);
    expect(render('note-md')).toMatchObject({ plain_text: OLD_TEXT });
    expect(kbDoc('note-md')).toMatchObject({ content: OLD_TEXT });
  });
});

describe('旧客户端经 PUT 换文件', () => {
  it('先传文件、再 PUT 新地址：同样按新文件刷新缓存和知识库', async () => {
    as('student-a');
    const upload = await send('POST', '/spaces/space-shared/attachments', {
      file_name: '实验记录.md', mime_type: 'text/markdown', data_url: markdown(V2_TEXT),
    });
    const { attachment } = await upload.json() as { attachment: { file_url: string } };
    const res = await send('PUT', '/notes/note-md', {
      file_url: attachment.file_url, file_name: '实验记录.md', mime_type: 'text/markdown',
      metadata: { mdVersions: [{ url: V1, replacedAt: '2026-09-28T07:00:00Z', by: 'student-a' }] },
    });
    expect(res.status).toBe(200);
    await settle();

    expect(refreshes).toHaveBeenCalledTimes(1);
    expect(render('note-md')).toMatchObject({ plain_text: V2_TEXT, markdown: null });
    expect(kbDoc('note-md')).toMatchObject({ content: V2_TEXT });
    expect(chunksOf('note-md').every(c => c.includes('第二版'))).toBe(true);
  });

  it.each([
    ['只改「固定」', 'note-md', { metadata: { is_fixed: true } }],
    ['文件地址没变', 'note-md', { file_url: V1, file_name: '实验记录.md', mime_type: 'text/markdown' }],
    ['换的不是 Markdown', 'note-pdf', {
      file_url: 'https://storage.example/note-chat-attachments/spaces/course-1/space-shared/3-report.pdf',
      file_name: '报告.pdf', mime_type: 'application/pdf',
    }],
  ])('%s：不刷新', async (_label, id, body) => {
    as('student-a');
    expect((await send('PUT', `/notes/${id}`, body)).status).toBe(200);
    await settle();
    expect(refreshes).not.toHaveBeenCalled();
    expect(h.storage.fetched).toEqual([]);
    expect(render('note-md')).toMatchObject({ plain_text: OLD_TEXT });
    expect(kbDoc('note-md')).toMatchObject({ content: OLD_TEXT });
  });
});
