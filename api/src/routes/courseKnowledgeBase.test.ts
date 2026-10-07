import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 课程管理 → 课程资料里管知识库的几件事（courseKnowledgeBase.ts）：资料开关、重新解析、附件整门课的开关、
 * 知识库概况、检索测试。都只给创建者和课程管理员；检索测试不进检索记录。
 */

const COURSE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const db: Record<string, Row[]> = {};
  const seed = () => ({
    courses: [{ id: '11111111-1111-4111-8111-111111111111', kb_include_attachments: true }],
    course_materials: [
      { id: 'm-pdf', course_id: '11111111-1111-4111-8111-111111111111', kb_enabled: true, mime_type: 'application/pdf', file_name: 'a.pdf' },
      { id: 'm-img', course_id: '11111111-1111-4111-8111-111111111111', kb_enabled: true, mime_type: 'image/png', file_name: 'b.png' },
      { id: 'm-other', course_id: '22222222-2222-4222-8222-222222222222', kb_enabled: true, mime_type: 'application/pdf', file_name: 'c.pdf' },
    ],
    kb_documents: [
      { id: 'd-mat', course_id: '11111111-1111-4111-8111-111111111111', material_id: 'm-pdf', note_id: null, space_id: null, title: '大纲', status: 'ready', text_source: 'mineru', updated_at: '2026-10-06T10:00:00Z' },
      { id: 'd-att', course_id: '11111111-1111-4111-8111-111111111111', material_id: null, note_id: 'n-live', space_id: 's-1', title: '论文.pdf', status: 'ready', text_source: 'pdf', updated_at: '2026-10-06T12:00:00Z' },
      { id: 'd-gone', course_id: '11111111-1111-4111-8111-111111111111', material_id: null, note_id: 'n-gone', space_id: 's-1', title: '删了的', status: 'ready', text_source: 'pdf', updated_at: '2026-10-06T11:00:00Z' },
    ],
    notes: [
      { id: 'n-live', title: '论文.pdf', space_id: 's-1', deleted_at: null },
      { id: 'n-gone', title: '删了的', space_id: 's-1', deleted_at: '2026-10-05T00:00:00Z' },
    ],
    document_renders: [{ note_id: 'n-live', page_map: [[0, 1], [900, 2], [2000, 12]] }],
    spaces: [{ id: 's-1', title: '第一组' }],
    kb_retrieval_logs: [
      { course_id: '11111111-1111-4111-8111-111111111111', source: 'note_ai', created_at: new Date().toISOString() },
      { course_id: '11111111-1111-4111-8111-111111111111', source: 'workspace_ai', created_at: new Date().toISOString() },
      { course_id: '11111111-1111-4111-8111-111111111111', source: 'note_ai', created_at: '2026-01-01T00:00:00Z' },
    ],
  });
  const state = { updates: [] as Array<{ table: string; patch: Row }>, running: new Set<string>() };

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let limit: number | undefined;
    const run = (terminal: 'many' | 'maybeSingle') => {
      let rows = (db[table] ?? []).filter(r => filters.every(f => f(r)));
      if (patch) {
        rows.forEach(r => Object.assign(r, patch));
        state.updates.push({ table, patch });
      }
      if (limit !== undefined) rows = rows.slice(0, limit);
      const out = rows.map(r => ({ ...r }));
      return terminal === 'many' ? { data: out, error: null } : { data: out[0] ?? null, error: null };
    };
    const builder: Record<string, any> = {
      select: () => builder,
      update: (p: Row) => { patch = p; return builder; },
      eq: (col: string, v: unknown) => { filters.push(r => r[col] === v); return builder; },
      in: (col: string, vs: unknown[]) => { filters.push(r => vs.includes(r[col])); return builder; },
      gte: (col: string, v: string) => { filters.push(r => String(r[col]) >= v); return builder; },
      order: () => builder,
      limit: (n: number) => { limit = n; return builder; },
      maybeSingle: async () => run('maybeSingle'),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve().then(() => run('many')).then(ok, fail),
    };
    return builder;
  };
  const rpc = async (fn: string) => {
    if (fn === 'kb_document_vector_counts') {
      return { data: [
        { document_id: 'd-mat', chunks: 4, embedded: 4 },
        { document_id: 'd-att', chunks: 6, embedded: 5 },
        { document_id: 'd-gone', chunks: 3, embedded: 3 },
      ], error: null };
    }
    return { data: null, error: { message: `unknown function ${fn}` } };
  };
  return {
    db, seed, state, from, rpc,
    ensureCourseInstructor: vi.fn(async (_courseId: string, _user: unknown) => {}),
    search: vi.fn(async (..._args: unknown[]) => ({
      semantic: true,
      reranked: true,
      hits: [{
        chunkId: 'c1', documentId: 'd-att', title: '论文.pdf', headingPath: '方法', content: '## 方法\n\n**访谈**提纲分三部分',
        similarity: 0.61, relevance: 0.873, matchedBy: 'vector', pageStart: 3, pageEnd: 4, noteId: 'n-live', materialId: null,
      }],
    })),
    reparse: vi.fn(async (_id: string) => {}),
    invalidate: vi.fn(),
  };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'teacher-1', role: 'teacher' };
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/accessControl', () => ({ ensureCourseInstructor: h.ensureCourseInstructor }));
vi.mock('../services/kbIngest', () => ({
  isIngestRunning: (id: string) => h.state.running.has(id),
  reparseMaterial: h.reparse,
}));
vi.mock('../services/knowledgeBase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/knowledgeBase')>()),
  searchKnowledgeBaseDetailed: h.search,
  invalidateKbPresence: h.invalidate,
}));

import router from './courseKnowledgeBase';
import { ApiError, errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  for (const key of Object.keys(h.db)) delete h.db[key];
  Object.assign(h.db, h.seed());
  h.state.updates.length = 0;
  h.state.running.clear();
  h.ensureCourseInstructor.mockClear();
  h.search.mockClear();
  h.reparse.mockClear();
  h.invalidate.mockClear();
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

describe('只给创建者和课程管理员', () => {
  it.each([
    ['PATCH', `/courses/${COURSE}/materials/m-pdf/kb`, { enabled: false }],
    ['POST', `/courses/${COURSE}/materials/m-pdf/reparse`, undefined],
    ['PUT', `/courses/${COURSE}/kb/attachments`, { enabled: false }],
    ['GET', `/courses/${COURSE}/kb/overview`, undefined],
    ['POST', `/courses/${COURSE}/kb/search-test`, { query: '访谈' }],
  ])('%s %s：不是教职就 403，什么也不改', async (method, path, body) => {
    h.ensureCourseInstructor.mockRejectedValueOnce(new ApiError(403, 'Only the course instructor can perform this action'));
    const { status } = await call(method, path, body);
    expect(status).toBe(403);
    expect(h.state.updates).toHaveLength(0);
    expect(h.reparse).not.toHaveBeenCalled();
    expect(h.search).not.toHaveBeenCalled();
  });
});

describe('资料的「进入知识库」开关', () => {
  it('关掉：只改这门课的这份资料，清掉「有没有资料」的缓存', async () => {
    const { status, body } = await call('PATCH', `/courses/${COURSE}/materials/m-pdf/kb`, { enabled: false });
    expect(status).toBe(200);
    expect(body).toEqual({ kbEnabled: false });
    expect(h.db.course_materials.find(m => m.id === 'm-pdf')?.kb_enabled).toBe(false);
    expect(h.invalidate).toHaveBeenCalledWith(COURSE);
  });

  it('别的课的资料 id：404，不改', async () => {
    const { status } = await call('PATCH', `/courses/${COURSE}/materials/m-other/kb`, { enabled: false });
    expect(status).toBe(404);
    expect(h.db.course_materials.find(m => m.id === 'm-other')?.kb_enabled).toBe(true);
  });

  it('enabled 不是布尔值：400', async () => {
    expect((await call('PATCH', `/courses/${COURSE}/materials/m-pdf/kb`, { enabled: 'no' })).status).toBe(400);
  });
});

describe('重新解析', () => {
  it('PDF：清缓存、重新入库，回 202', async () => {
    const { status, body } = await call('POST', `/courses/${COURSE}/materials/m-pdf/reparse`);
    expect(status).toBe(202);
    expect(body).toEqual({ state: 'processing' });
    expect(h.reparse).toHaveBeenCalledWith('m-pdf');
  });

  it('上传后那几轮还在跑：409，不打断', async () => {
    h.state.running.add('m-pdf');
    expect((await call('POST', `/courses/${COURSE}/materials/m-pdf/reparse`)).status).toBe(409);
    expect(h.reparse).not.toHaveBeenCalled();
  });

  it('图片不进知识库：400；别的课的资料：404', async () => {
    expect((await call('POST', `/courses/${COURSE}/materials/m-img/reparse`)).status).toBe(400);
    expect((await call('POST', `/courses/${COURSE}/materials/m-other/reparse`)).status).toBe(404);
    expect(h.reparse).not.toHaveBeenCalled();
  });
});

describe('画布附件整门课的开关', () => {
  it('关掉：写进 courses，清缓存', async () => {
    const { status, body } = await call('PUT', `/courses/${COURSE}/kb/attachments`, { enabled: false });
    expect(status).toBe(200);
    expect(body).toEqual({ includeAttachments: false });
    expect(h.db.courses[0].kb_include_attachments).toBe(false);
    expect(h.invalidate).toHaveBeenCalledWith(COURSE);
  });
});

describe('知识库概况', () => {
  it('资料和附件分开数；删掉的附件不列；页数取对照表；近 7 天检索按来源数', async () => {
    const { status, body } = await call('GET', `/courses/${COURSE}/kb/overview`);
    expect(status).toBe(200);
    expect(body.includeAttachments).toBe(true);
    expect(body.materials).toEqual({ total: 2, enabled: 2, chunks: 4 });
    expect(body.attachments.items).toEqual([{
      noteId: 'n-live', title: '论文.pdf', spaceName: '第一组', status: 'ready', chunks: 6, embedded: 5, pages: 12,
      textSource: 'pdf', updatedAt: '2026-10-06T12:00:00Z',
    }]);
    expect(body.attachments.chunks).toBe(6);
    expect(body.searchable).toEqual({ chunks: 10, embedded: 9 });
    expect(body.retrievals).toMatchObject({ days: 7, total: 2, bySource: { note_ai: 1, workspace_ai: 1, agent_tool: 0 } });
  });

  it('关掉的资料和整门课关掉的附件，不算进 AI 检索得到的片段', async () => {
    h.db.course_materials[0].kb_enabled = false;
    h.db.courses[0].kb_include_attachments = false;
    const { body } = await call('GET', `/courses/${COURSE}/kb/overview`);
    expect(body.includeAttachments).toBe(false);
    expect(body.materials.enabled).toBe(1);
    expect(body.searchable).toEqual({ chunks: 0, embedded: 0 });
  });
});

describe('检索测试', () => {
  it('和 AI 同一套检索、取前 5 段，按老师的身份；不传 source，不进检索记录', async () => {
    const { status, body } = await call('POST', `/courses/${COURSE}/kb/search-test`, { query: '  访谈提纲怎么设计  ' });
    expect(status).toBe(200);
    expect(h.search).toHaveBeenCalledWith(COURSE, expect.objectContaining({ id: 'teacher-1' }), '访谈提纲怎么设计', 5);
    expect(h.search.mock.calls[0]).toHaveLength(4);
    expect(body).toMatchObject({ semantic: true, reranked: true });
    expect(body.hits[0]).toEqual({
      n: 1, title: '论文.pdf', section: '方法', pageStart: 3, pageEnd: 4, kind: 'attachment',
      relevance: 0.873, similarity: 0.61, matchedBy: 'vector', excerpt: '方法 访谈提纲分三部分',
    });
  });

  it('没写问题：400', async () => {
    expect((await call('POST', `/courses/${COURSE}/kb/search-test`, { query: '   ' })).status).toBe(400);
    expect(h.search).not.toHaveBeenCalled();
  });
});
