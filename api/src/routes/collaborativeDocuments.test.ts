import 'express-async-errors';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const h = vi.hoisted(() => ({
  row: { id: 'doc-1', space_id: 'space-a', author_id: 'student-a', title: '共同探究', metadata: { collaborative_document: { version: 1 } } } as any,
  space: { id: 'space-a', course_id: 'course-1', group_id: 'group-a', standing: 'member' } as any,
  denied: false,
  experiment: false,
  serviceFails: false,
  validView: true,
  created: [] as any[],
  deleted: [] as any[],
  dropKb: vi.fn(),
}));
vi.mock('../config/supabase', () => ({ supabase: { from: (table: string) => {
  let payload: any; let action = 'read';
  const result = () => {
    if (action === 'insert' && table === 'notes') { const row = { id: 'new-document', ...payload }; h.created.push(row); return { data: row, error: null }; }
    if (action === 'update' && table === 'notes') { h.deleted.push(payload); return { data: null, error: null }; }
    if (table === 'views') return { data: h.validView ? { id: 'view-1' } : null, error: null };
    return { data: table === 'notes' ? h.row : null, error: null };
  };
  const builder: any = { maybeSingle: async () => result(), single: async () => result(),
    insert: (data: any) => { action = 'insert'; payload = data; return builder; },
    update: (data: any) => { action = 'update'; payload = data; return builder; },
    then: (ok: any, fail: any) => Promise.resolve(result()).then(ok, fail) };
  for (const method of ['select', 'eq', 'is']) builder[method] = () => builder;
  return builder;
} } }));
vi.mock('../middleware/auth', () => ({ verifyJWT: (req: any, _res: any, next: any) => { req.user = { id: 'student-a', role: 'student', name: 'Student A' }; next(); } }));
vi.mock('../services/accessControl', () => ({
  ensureSpaceAccess: async () => { if (h.denied) throw Object.assign(new Error('Group access denied'), { statusCode: 403 }); return h.space; },
  isCourseStaff: (standing: string) => ['owner', 'manager'].includes(standing),
}));
vi.mock('../services/experimentCondition', () => ({ fetchExperimentMode: async () => h.experiment }));
vi.mock('../services/kbIngest', () => ({ dropNoteFromKb: h.dropKb }));
import router, { documentAccess } from './collaborativeDocuments';
import { mergeClientMetadata } from '../services/noteMetadata';
import { errorHandler } from '../middleware/errorHandler';
const user: any = { id: 'student-a', role: 'student', name: 'Student A' };
const nativeFetch = globalThis.fetch;
let server: Server; let base = '';
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api', router); app.use(errorHandler);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  process.env.COLLAB_ENABLED = 'true'; process.env.COLLAB_INTERNAL_URL = 'http://localhost:4310';
  process.env.COLLAB_PUBLIC_WS_URL = 'ws://localhost:4310'; process.env.COLLAB_SECRET = 'test-secret-at-least-thirty-two-characters';
  h.row = { id: 'doc-1', space_id: 'space-a', metadata: { collaborative_document: { version: 1 } } };
  h.space = { course_id: 'course-1', group_id: 'group-a', standing: 'member' }; h.denied = false; h.experiment = false;
  h.serviceFails = false; h.validView = true; h.created = []; h.deleted = [];
  h.dropKb.mockReset(); h.dropKb.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
    if (String(url).startsWith('http://localhost:4310/internal/documents/')) {
      return new Response(JSON.stringify({ id: 'new-document' }), { status: h.serviceFails ? 503 : 201 });
    }
    return nativeFetch(url, options);
  });
});
describe('creating a document through the API', () => {
  const post = (input: any) => nativeFetch(`${base}/spaces/space-a/collaborative-documents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  it('creates a server-marked card in the current view', async () => {
    const response = await post({ title: '  共同探究  ', viewId: 'view-1', x: 40, y: 60 });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ title: '共同探究', views: ['view-1'], x: 40, y: 60, metadata: { collaborative_document: { version: 1 } } });
  });
  it('compensates the new card if body provisioning fails', async () => {
    h.serviceFails = true;
    expect((await post({ title: '失败试点' })).status).toBe(503);
    expect(h.deleted).toHaveLength(1); expect(h.deleted[0].deleted_at).toEqual(expect.any(String));
    expect(h.dropKb).toHaveBeenCalledWith('new-document');
  });
  it('rejects a view outside the space before creating any card', async () => {
    h.validView = false;
    expect((await post({ title: '探究', viewId: 'other-view' })).status).toBe(404);
    expect(h.created).toHaveLength(0);
  });
  it('rejects shared-space experiment participants before creating any card', async () => {
    h.space.group_id = null; h.experiment = true;
    expect((await post({ title: '探究' })).status).toBe(403); expect(h.created).toHaveLength(0);
  });
});
describe('collaboration access uses the existing course/group boundary', () => {
  it('allows a member of the same group to coedit', async () => { expect((await documentAccess('doc-1', user)).canEdit).toBe(true); });
  it('denies a different-group or removed member', async () => {
    h.denied = true; await expect(documentAccess('doc-1', user)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('makes shared-space participants read-only during experiments', async () => {
    h.space.group_id = null; h.experiment = true;
    expect((await documentAccess('doc-1', user)).canEdit).toBe(false);
    h.space.standing = 'manager'; expect((await documentAccess('doc-1', user)).canEdit).toBe(true);
  });
  it('rejects missing/deleted notes and ordinary attachments', async () => {
    h.row = null; await expect(documentAccess('doc-1', user)).rejects.toMatchObject({ statusCode: 404 });
    h.row = { metadata: {} }; await expect(documentAccess('doc-1', user)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('stays unavailable until explicitly enabled', async () => {
    process.env.COLLAB_ENABLED = 'false'; await expect(documentAccess('doc-1', user)).rejects.toMatchObject({ statusCode: 503 });
  });
  it('cannot forge, remove or replace the document-owner marker using generic Note metadata', () => {
    expect(mergeClientMetadata({}, { collaborative_document: { version: 1 } })).toEqual({});
    expect(mergeClientMetadata({ collaborative_document: { version: 1 } }, { collaborative_document: null, is_fixed: true }))
      .toEqual({ collaborative_document: { version: 1 }, is_fixed: true });
  });
});
