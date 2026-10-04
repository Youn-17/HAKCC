import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 课程资料以前存的是浏览器的 blob: 地址（只在上传者那个标签页里有效），
 * 也从没进过知识库。现在：签发直传地址 → 浏览器直传存储 → 服务端回读字节校验、
 * 登记 → 后台解析入库；删除按课程限定，连存储里的文件一起删；列表带上每份资料
 * 在知识库里的实际状态。
 */

const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COURSE = '22222222-2222-4222-8222-222222222222';
const PUBLIC = 'https://storage.example.test/object/public/note-chat-attachments';

const h = vi.hoisted(() => {
  const state = {
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    deletes: [] as { table: string; filters: Record<string, unknown> }[],
    removed: [] as string[],
    signed: [] as string[],
    materialRows: [] as Record<string, unknown>[],
    chunkRows: [] as Record<string, unknown>[],
    storedMaterial: { id: 'mat-1', storage_path: `materials/x/1-a.pdf` } as Record<string, unknown> | null,
    head: { status: 206, body: Buffer.from('%PDF-1.7\n'), contentRange: 'bytes 0-8/2048' } as {
      status: number; body: Buffer; contentRange?: string;
    },
  };

  const from = (table: string) => {
    let action: 'select' | 'insert' | 'delete' = 'select';
    let payload: Record<string, unknown> | undefined;
    const filters: Record<string, unknown> = {};
    const result = () => {
      if (table === 'course_materials' && action === 'insert') return { data: { id: 'mat-new' }, error: null };
      if (table === 'course_materials' && action === 'delete') {
        state.deletes.push({ table, filters: { ...filters } });
        // 只有 course_id 对得上才删得到
        return { data: filters.course_id === COURSE_ID ? state.storedMaterial : null, error: null };
      }
      if (table === 'course_materials') return { data: state.materialRows, error: null };
      if (table === 'kb_chunks') return { data: state.chunkRows, error: null };
      return { data: null, error: null };
    };
    const run = () => Promise.resolve(result());
    const builder: Record<string, unknown> = {
      insert: (p: Record<string, unknown>) => { action = 'insert'; payload = p; state.inserts.push({ table, payload: p }); return builder; },
      delete: () => { action = 'delete'; return builder; },
      eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
      single: run,
      maybeSingle: run,
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    };
    for (const m of ['select', 'order', 'in', 'limit', 'is', 'not']) builder[m] = () => builder;
    void payload;
    return builder;
  };

  const storage = {
    from: (_bucket: string) => ({
      createSignedUploadUrl: async (path: string) => { state.signed.push(path); return { data: { path, token: 'tok' }, error: null }; },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.test/object/public/note-chat-attachments/${path}` } }),
      remove: async (paths: string[]) => { state.removed.push(...paths); return { data: null, error: null }; },
    }),
  };

  return {
    state,
    supabase: { from, storage },
    schedule: vi.fn(),
    ensureCourseInstructor: vi.fn(async () => {}),
  };
});

vi.mock('../config/supabase', () => ({ supabase: h.supabase }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'teacher-1', role: 'teacher' };
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/accessControl', () => ({
  ensureCourseInstructor: h.ensureCourseInstructor,
  ensureCourseMember: vi.fn(async () => {}),
  ensureCourseOwner: vi.fn(async () => {}),
  getCourseStanding: vi.fn(async () => 'owner'),
  invalidateMembershipCache: vi.fn(),
}));
vi.mock('../services/experimentCondition', () => ({ invalidateConditionCache: vi.fn() }));
vi.mock('../services/kbIngest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/kbIngest')>()),
  scheduleMaterialKbIngest: h.schedule,
}));

import courseSettingsRouter from './courseSettings';
import { errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', courseSettingsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  // 路由回读存储里的文件头用的也是全局 fetch：存储地址给假响应，其余照常
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(PUBLIC)) {
      const headers = new Headers();
      if (h.state.head.contentRange) headers.set('content-range', h.state.head.contentRange);
      return new Response(h.state.head.body, { status: h.state.head.status, headers });
    }
    return realFetch(input, init);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  return new Promise<void>(done => server.close(() => done()));
});

beforeEach(() => {
  h.state.inserts.length = 0;
  h.state.deletes.length = 0;
  h.state.removed.length = 0;
  h.state.signed.length = 0;
  h.state.materialRows = [];
  h.state.chunkRows = [];
  h.state.storedMaterial = { id: 'mat-1', storage_path: `materials/${COURSE_ID}/1-a.pdf` };
  h.state.head = { status: 206, body: Buffer.from('%PDF-1.7\n'), contentRange: 'bytes 0-8/2048' };
  h.schedule.mockClear();
  h.ensureCourseInstructor.mockReset();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const materialInserts = () => h.state.inserts.filter(i => i.table === 'course_materials');

describe('签发直传地址', () => {
  it('路径落在这门课的资料目录下，文件名清洗过', async () => {
    const { status, body } = await call('POST', `/courses/${COURSE_ID}/materials/sign`, {
      file_name: '第一周 阅读.pdf', mime_type: 'application/pdf', file_size: 2048,
    });
    expect(status).toBe(200);
    expect(body.path).toMatch(new RegExp(`^materials/${COURSE_ID}/\\d+-[A-Za-z0-9._-]+$`));
    expect(body.bucket).toBe('note-chat-attachments');
  });

  it('SVG / HTML 在签发阶段就拒，超过 50MB 也拒', async () => {
    expect((await call('POST', `/courses/${COURSE_ID}/materials/sign`, { file_name: 'x.svg', mime_type: 'image/svg+xml' })).status).toBe(400);
    expect((await call('POST', `/courses/${COURSE_ID}/materials/sign`, {
      file_name: 'big.pdf', mime_type: 'application/pdf', file_size: 51 * 1024 * 1024,
    })).status).toBe(413);
    expect(h.state.signed).toHaveLength(0);
  });

  it('不是这门课的教师：拿不到上传地址', async () => {
    h.ensureCourseInstructor.mockRejectedValueOnce(Object.assign(new Error('Only the course instructor can perform this action'), { statusCode: 403 }));
    const { status } = await call('POST', `/courses/${COURSE_ID}/materials/sign`, { file_name: 'a.pdf', mime_type: 'application/pdf' });
    expect(status).not.toBe(200);
    expect(h.state.signed).toHaveLength(0);
  });
});

describe('登记资料', () => {
  const register = (extra: Record<string, unknown> = {}) => call('POST', `/courses/${COURSE_ID}/materials`, {
    title: '第一周阅读', path: `materials/${COURSE_ID}/1-a.pdf`, file_name: 'a.pdf', mime_type: 'application/pdf', ...extra,
  });

  it('存的是存储桶的公开地址而不是 blob:，大小取文件真实大小，PDF 进后台入库', async () => {
    const { status, body } = await register();
    expect(status).toBe(201);
    expect(body.material.id).toBe('mat-new');
    const row = materialInserts()[0].payload;
    expect(row.file_url).toBe(`${PUBLIC}/materials/${COURSE_ID}/1-a.pdf`);
    expect(String(row.file_url)).not.toMatch(/^blob:/);
    expect(row.storage_path).toBe(`materials/${COURSE_ID}/1-a.pdf`);
    expect(row.file_size).toBe(2048);
    expect(row.course_id).toBe(COURSE_ID);
    expect(h.schedule).toHaveBeenCalledWith('mat-new');
  });

  it('客户端不能再直接给 file_url：路径不在这门课的资料目录下一律拒绝', async () => {
    expect((await register({ path: `materials/${OTHER_COURSE}/1-a.pdf` })).status).toBe(400);
    expect((await register({ path: `spaces/${COURSE_ID}/space-1/1-a.pdf` })).status).toBe(400);
    expect((await register({ path: `materials/${COURSE_ID}/../${OTHER_COURSE}/a.pdf` })).status).toBe(400);
    expect((await register({ path: undefined, file_url: 'blob:https://ideaweave.tech/abc' })).status).toBe(400);
    expect(materialInserts()).toHaveLength(0);
  });

  it('伪装成 PDF 的 HTML：拒绝并删掉已经传上去的文件', async () => {
    h.state.head = { status: 206, body: Buffer.from('<!DOCTYPE html><script>1</script>'), contentRange: 'bytes 0-30/31' };
    expect((await register()).status).toBe(400);
    expect(h.state.removed).toEqual([`materials/${COURSE_ID}/1-a.pdf`]);
    expect(materialInserts()).toHaveLength(0);
  });

  it('存储里找不到文件（没传成功）：不登记', async () => {
    h.state.head = { status: 404, body: Buffer.from('') };
    expect((await register()).status).toBe(400);
    expect(materialInserts()).toHaveLength(0);
  });

  it('图片只存文件，不排解析', async () => {
    h.state.head = { status: 206, body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), contentRange: 'bytes 0-11/500' };
    const { status } = await register({ path: `materials/${COURSE_ID}/1-a.png`, file_name: 'a.png', mime_type: 'image/png' });
    expect(status).toBe(201);
    expect(h.schedule).not.toHaveBeenCalled();
  });
});

describe('删除资料', () => {
  it('按课程限定：别的课的教师拿着资料 id 也删不到', async () => {
    const { status } = await call('DELETE', `/courses/${OTHER_COURSE}/materials/mat-1`);
    expect(status).toBe(404);
    expect(h.state.deletes[0].filters).toMatchObject({ id: 'mat-1', course_id: OTHER_COURSE });
    expect(h.state.removed).toHaveLength(0);
  });

  it('删掉登记，也删掉存储里的文件（知识库那份随外键级联）', async () => {
    const { status } = await call('DELETE', `/courses/${COURSE_ID}/materials/mat-1`);
    expect(status).toBe(200);
    expect(h.state.removed).toEqual([`materials/${COURSE_ID}/1-a.pdf`]);
  });
});

describe('资料列表说清楚每份资料去了哪', () => {
  it('按知识库里的实际情况给状态', async () => {
    const base = { course_id: COURSE_ID, description: null, file_size: 10, created_at: '2026-09-28T00:00:00Z', users: null };
    h.state.materialRows = [
      { ...base, id: 'ready', title: 'A', file_url: 'u', file_name: 'a.pdf', mime_type: 'application/pdf', text_updated_at: 't', mineru_state: 'done', kb_documents: [{ id: 'doc-ready', status: 'ready', char_count: 900 }] },
      { ...base, id: 'refining', title: 'B', file_url: 'u', file_name: 'b.pdf', mime_type: 'application/pdf', text_updated_at: 't', mineru_state: 'running', kb_documents: [{ id: 'doc-refining', status: 'ready', char_count: 300 }] },
      { ...base, id: 'no-vectors', title: 'C', file_url: 'u', file_name: 'c.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', text_updated_at: 't', mineru_state: null, kb_documents: [{ id: 'doc-novec', status: 'ready', char_count: 500 }] },
      { ...base, id: 'waiting', title: 'D', file_url: 'u', file_name: 'd.md', mime_type: 'text/markdown', text_updated_at: null, mineru_state: null, kb_documents: [] },
      { ...base, id: 'scanned', title: 'E', file_url: 'u', file_name: 'e.pdf', mime_type: 'application/pdf', text_updated_at: 't', mineru_state: 'failed', kb_documents: [] },
      { ...base, id: 'image', title: 'F', file_url: 'u', file_name: 'f.png', mime_type: 'image/png', text_updated_at: null, mineru_state: null, kb_documents: [] },
    ];
    h.state.chunkRows = [
      { document_id: 'doc-ready', embedding_model: 'text-embedding-3-small' },
      { document_id: 'doc-ready', embedding_model: 'text-embedding-3-small' },
      { document_id: 'doc-refining', embedding_model: 'text-embedding-3-small' },
      { document_id: 'doc-novec', embedding_model: null },
    ];

    const { status, body } = await call('GET', `/courses/${COURSE_ID}/materials`);
    expect(status).toBe(200);
    const kb = Object.fromEntries((body.materials as any[]).map(m => [m.id, m.knowledgeBase]));
    expect(kb.ready).toEqual({ state: 'ready', refining: false, chars: 900, chunks: 2 });
    expect(kb.refining).toMatchObject({ state: 'ready', refining: true });
    expect(kb['no-vectors'].state).toBe('unsearchable');
    expect(kb.waiting.state).toBe('processing');
    expect(kb.scanned.state).toBe('no_text');
    expect(kb.image.state).toBe('unsupported');
    // 旧字段（评论、批注）没有任何界面在用，不再返回
    expect(body.materials[0]).not.toHaveProperty('commentCount');
  });
});
