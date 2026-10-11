import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * GET /artifacts/:id —— 智能体做的网页（2026-10-11）。本人和本课教职能看，别人一律 404（不透露有没有这个网页）；
 * 返回这一版的 HTML 和同一网页所有版本的编号。
 */

const OWNER = '11111111-1111-4111-8111-111111111111';
const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const V2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const h = vi.hoisted(() => {
  const state = {
    user: { id: '', role: 'student' },
    standing: 'member' as string,
    rows: [] as Array<Record<string, unknown>>,
    links: [] as Array<Record<string, unknown>>,
    upserts: [] as Array<Record<string, unknown>>,
    /** 每条笔记：作者、课程、谁能看（不在名单里 ensureNoteAccess 就抛 404） */
    notes: {} as Record<string, { author_id: string; course_id: string; standing: string; readers: string[] }>,
  };
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let asc = true;
    const source = () => (table === 'ai_artifact_notes' ? state.links : state.rows);
    const rows = () => source().filter(r => filters.every(([c, v]) => r[c] === v))
      .sort((a, b) => ((a.version as number) - (b.version as number)) * (asc ? 1 : -1));
    const builder: Record<string, unknown> = {
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      order: (_c: string, opts?: { ascending?: boolean }) => { asc = opts?.ascending !== false; return builder; },
      eq: (c: string, v: unknown) => { filters.push([c, v]); return builder; },
      limit: () => builder,
      select: () => builder,
      upsert: (row: Record<string, unknown>) => { state.upserts.push(row); return Promise.resolve({ error: null }); },
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok, fail),
    };
    return builder;
  };
  return { state, from };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = h.state.user; next(); },
}));
vi.mock('../services/accessControl', async () => {
  const { ApiError } = await import('../middleware/errorHandler');
  return {
    getCourseStanding: vi.fn(async () => h.state.standing),
    isCourseStaff: (standing: string) => standing === 'owner' || standing === 'teacher',
    ensureNoteAccess: vi.fn(async (noteId: string, user: { id: string }) => {
      const note = h.state.notes[noteId];
      if (!note || !note.readers.includes(user.id)) throw new ApiError(404, 'Note not found');
      return { id: noteId, author_id: note.author_id, course_id: note.course_id, standing: note.standing };
    }),
  };
});
vi.mock('../services/agentMaker', () => ({
  isUuid: (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v),
  ARTIFACT_CSP: "default-src 'none'; connect-src 'none'",
}));
process.env.ARTIFACT_VIEW_SECRET = 'test-secret';

import artifactsRouter from './artifacts';
import { signArtifactView } from '../services/artifactLinks';
import { errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', artifactsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

const row = (id: string, version: number) => ({
  id, group_id: GROUP, version, course_id: 'course-1', owner_id: OWNER, title: '光合作用概念图',
  html: `<!doctype html><html><body>第 ${version} 版</body></html>`, sources: [{ title: '光照是关键' }], surface: 'note', model: 'glm-5.3',
  created_at: `2026-10-11T0${version}:00:00Z`,
});

const NOTE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

beforeEach(() => {
  h.state.user = { id: OWNER, role: 'student' };
  h.state.standing = 'member';
  h.state.rows = [row(V2, 2), row(GROUP, 1)];
  h.state.links = [];
  h.state.upserts = [];
  h.state.notes = { [NOTE]: { author_id: OWNER, course_id: 'course-1', standing: 'member', readers: [OWNER, 'student-2'] } };
});

const get = async (id: string) => {
  const res = await fetch(`${base}/artifacts/${id}`);
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() as Record<string, any> };
};

describe('看网页', () => {
  it('本人：拿到这一版的 HTML 和全部版本（按版本号排），不缓存', async () => {
    const { status, body, cache } = await get(V2);
    expect(status).toBe(200);
    expect(cache).toContain('no-store');
    expect(body.artifact).toMatchObject({ id: V2, groupId: GROUP, version: 2, title: '光合作用概念图', sources: [{ title: '光照是关键' }] });
    expect(body.artifact.html).toContain('第 2 版');
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
  });

  it('本课教职能看学生做的；别的学生看不到（404，不说有没有）', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    h.state.standing = 'teacher';
    expect((await get(GROUP)).status).toBe(200);

    h.state.user = { id: 'student-2', role: 'student' };
    h.state.standing = 'member';
    expect((await get(GROUP)).status).toBe(404);
  });

  it('返回里带「新窗口打开」的签名链接', async () => {
    const { body } = await get(V2);
    expect(body.artifact.viewPath).toMatch(new RegExp(`^/artifacts/${V2}/view\\?exp=\\d+&sig=`));
  });

  it('id 不对：400；没有这个网页：404', async () => {
    expect((await get('not-an-id')).status).toBe(400);
    expect((await get('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).status).toBe(404);
  });
});

describe('在新窗口打开', () => {
  const view = async (id: string, exp: number, sig: string) => {
    const res = await fetch(`${base}/artifacts/${id}/view?exp=${exp}&sig=${encodeURIComponent(sig)}`);
    return { status: res.status, csp: res.headers.get('content-security-policy') ?? '', type: res.headers.get('content-type') ?? '', coop: res.headers.get('cross-origin-opener-policy'), text: await res.text() };
  };

  it('签名对：不要登录就给 HTML，响应头把页面关进匿名源（sandbox 只给 allow-scripts），不能联网、不能被嵌', async () => {
    h.state.user = { id: '', role: 'student' };
    const exp = Math.floor(Date.now() / 1000) + 600;
    const out = await view(V2, exp, signArtifactView(V2, exp));
    expect(out.status).toBe(200);
    expect(out.type).toContain('text/html');
    expect(out.text).toContain('第 2 版');
    expect(out.csp).toMatch(/^sandbox allow-scripts;/);
    expect(out.csp).not.toMatch(/allow-same-origin|allow-popups|allow-forms|allow-top-navigation/);
    expect(out.csp).toContain("connect-src 'none'");
    expect(out.csp).toContain("frame-ancestors 'none'");
    expect(out.coop).toBe('same-origin');
  });

  it('签名不对：403；过期：410；网页不在了：404（都是纯文字说明）', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect((await view(V2, exp, 'nope')).status).toBe(403);
    const old = Math.floor(Date.now() / 1000) - 10;
    const expired = await view(V2, old, signArtifactView(V2, old));
    expect(expired.status).toBe(410);
    expect(expired.text).toContain('过期');
    const gone = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    expect((await view(gone, exp, signArtifactView(gone, exp))).status).toBe(404);
  });
});

describe('导入笔记以后', () => {
  const attach = async (id: string, noteId: string) => {
    const res = await fetch(`${base}/artifacts/${id}/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note_id: noteId }) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  it('网页主人挂到自己的笔记上：记下这个网页（按组）挂在哪条笔记', async () => {
    expect((await attach(V2, NOTE)).status).toBe(200);
    expect(h.state.upserts).toEqual([{ group_id: GROUP, note_id: NOTE, artifact_id: V2, added_by: OWNER }]);
  });

  it('不是网页主人：404；笔记不是自己的：403；笔记在别的课：400；看不到笔记：404', async () => {
    h.state.user = { id: 'student-2', role: 'student' };
    expect((await attach(V2, NOTE)).status).toBe(404);
    h.state.user = { id: OWNER, role: 'student' };
    h.state.notes[NOTE].author_id = 'student-2';
    expect((await attach(V2, NOTE)).status).toBe(403);
    h.state.notes[NOTE] = { author_id: OWNER, course_id: 'course-2', standing: 'member', readers: [OWNER] };
    expect((await attach(V2, NOTE)).status).toBe(400);
    h.state.notes[NOTE].readers = [];
    expect((await attach(V2, NOTE)).status).toBe(404);
    expect(h.state.upserts).toEqual([]);
  });

  it('挂上以后：看得到那条笔记的同学能打开（所有版本）；看不到的照样 404', async () => {
    h.state.links = [{ group_id: GROUP, note_id: NOTE, artifact_id: V2 }];
    h.state.user = { id: 'student-2', role: 'student' };
    const seen = await get(GROUP);
    expect(seen.status).toBe(200);
    expect(seen.body.versions).toHaveLength(2);
    h.state.user = { id: 'student-3', role: 'student' };
    expect((await get(GROUP)).status).toBe(404);
  });
});
