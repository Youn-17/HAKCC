import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 「强制使用支架」管学生，不管开课教师、课程管理员和平台管理员。
 * 豁免按课内身份（getCourseStanding）判，不看平台角色本身：以普通成员身份
 * 加入别人课程的教师账号照样受限。requireScaffold 仍是课程级开关原值 ——
 * 支架管理弹窗里的那个开关要显示它。
 *
 * 同一个课内身份也决定谁看得到这门课隐藏掉的支架；新建、隐藏、推荐这几条写接口
 * 和强制开关、改、删一样只放行课程教职（ensureCourseInstructor）。
 */

const COURSE_ID = '11111111-1111-4111-8111-111111111111';

const h = vi.hoisted(() => {
  const state = {
    user: { id: 'u-1', role: 'student' as string },
    requireScaffold: true,
    /** 发出去的写操作（表 + 方法），用来确认被拒的请求什么都没写 */
    writes: [] as Array<{ table: string; op: string }>,
  };
  const resultFor = (table: string) => {
    if (table === 'scaffolds') {
      return { data: [{ id: 's-1', title: '我的想法是', category: 'idea' }, { id: 's-2', title: '这门课停用的话头', category: 'idea' }], error: null };
    }
    if (table === 'course_scaffold_prefs') return { data: [{ scaffold_id: 's-2', hidden: true }], error: null };
    if (table === 'courses') return { data: { require_scaffold: state.requireScaffold }, error: null };
    return { data: null, error: null };
  };
  const from = (table: string) => {
    const run = () => Promise.resolve(resultFor(table));
    const builder: Record<string, unknown> = {
      maybeSingle: run,
      single: run,
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    };
    for (const m of ['select', 'eq', 'or', 'order', 'is', 'in']) builder[m] = () => builder;
    for (const op of ['insert', 'upsert', 'update', 'delete']) {
      builder[op] = () => {
        state.writes.push({ table, op });
        return builder;
      };
    }
    return builder;
  };
  return {
    state, from, getCourseStanding: vi.fn(), ensureCourseInstructor: vi.fn(),
    ensureCourseMember: vi.fn(), recommendScaffold: vi.fn(), logEvent: vi.fn(),
  };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/accessControl', () => ({
  ensureCourseInstructor: h.ensureCourseInstructor,
  ensureCourseMember: h.ensureCourseMember,
  getCourseStanding: h.getCourseStanding,
}));
vi.mock('../services/scaffoldRecommend', () => ({ recommendScaffold: h.recommendScaffold }));
vi.mock('../services/eventService', () => ({ logEvent: h.logEvent }));

import scaffoldsRouter from './scaffolds';
import { ApiError, errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', scaffoldsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  h.state.requireScaffold = true;
  h.state.writes = [];
  h.getCourseStanding.mockReset();
  h.ensureCourseInstructor.mockReset();
  h.ensureCourseInstructor.mockResolvedValue(undefined);
  h.ensureCourseMember.mockReset();
  h.ensureCourseMember.mockResolvedValue('member');
  h.recommendScaffold.mockReset();
  h.logEvent.mockReset();
});

async function listAs(role: string, standing?: string | Error) {
  h.state.user = { id: 'u-1', role };
  if (standing instanceof Error) h.getCourseStanding.mockRejectedValue(standing);
  else if (standing) h.getCourseStanding.mockResolvedValue(standing);
  const res = await fetch(`${base}/courses/${COURSE_ID}/scaffolds`);
  return {
    status: res.status,
    body: (await res.json()) as {
      requireScaffold: boolean;
      scaffoldExempt: boolean;
      scaffolds: Array<{ id: string; hidden: boolean }>;
    },
  };
}

describe('GET /courses/:id/scaffolds 的 scaffoldExempt', () => {
  it('学生不豁免，也不必为此多查一次课内身份', async () => {
    const { status, body } = await listAs('student');
    expect(status).toBe(200);
    expect(body).toMatchObject({ requireScaffold: true, scaffoldExempt: false });
    expect(h.getCourseStanding).not.toHaveBeenCalled();
  });

  it('开课教师豁免', async () => {
    expect((await listAs('teacher', 'owner')).body.scaffoldExempt).toBe(true);
  });

  it('课程管理员豁免', async () => {
    expect((await listAs('teacher', 'manager')).body.scaffoldExempt).toBe(true);
  });

  it('平台管理员豁免（getCourseStanding 把管理员当创建者）', async () => {
    expect((await listAs('admin', 'owner')).body.scaffoldExempt).toBe(true);
  });

  it('教师账号在这门课里只是普通成员：不豁免', async () => {
    expect((await listAs('teacher', 'member')).body.scaffoldExempt).toBe(false);
  });

  it('查不到课程时按不豁免处理，接口本身照常返回', async () => {
    const { status, body } = await listAs('teacher', new Error('Course not found'));
    expect(status).toBe(200);
    expect(body.scaffoldExempt).toBe(false);
  });

  it('requireScaffold 始终是课程级开关的原值，不因豁免而变', async () => {
    expect((await listAs('teacher', 'owner')).body.requireScaffold).toBe(true);
    h.state.requireScaffold = false;
    expect((await listAs('student')).body.requireScaffold).toBe(false);
  });
});

describe('GET /courses/:id/scaffolds：这门课隐藏掉的支架谁看得到', () => {
  const ids = (body: { scaffolds: Array<{ id: string }> }) => body.scaffolds.map(s => s.id);

  it('学生看不到', async () => {
    expect(ids((await listAs('student')).body)).toEqual(['s-1']);
  });

  it('教师账号在这门课里只是普通成员：和学生一样看不到（编辑器里也就选不到）', async () => {
    expect(ids((await listAs('teacher', 'member')).body)).toEqual(['s-1']);
  });

  it('课程管理员、平台管理员看得到，带 hidden 标记（支架管理里要能恢复）', async () => {
    for (const [role, standing] of [['teacher', 'manager'], ['admin', 'owner']]) {
      const { body } = await listAs(role, standing);
      expect(ids(body)).toEqual(['s-1', 's-2']);
      expect(body.scaffolds.find(s => s.id === 's-2')?.hidden).toBe(true);
    }
  });
});

describe('新建、隐藏、推荐支架只放行课程教职', () => {
  const SCAFFOLD_ID = '22222222-2222-4222-8222-222222222222';
  const writesAs = async (method: string, path: string, body: unknown) => {
    h.state.user = { id: 'teacher-joined', role: 'teacher' };
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.status;
  };
  const cases: Array<[string, string, string, unknown]> = [
    ['新建', 'POST', `/courses/${COURSE_ID}/scaffolds`, { title: '我补充的是', category: '知识建构/观点' }],
    ['本课隐藏', 'PUT', `/courses/${COURSE_ID}/scaffolds/${SCAFFOLD_ID}/prefs`, { hidden: true }],
    ['批量隐藏', 'POST', `/courses/${COURSE_ID}/scaffolds/bulk`, { action: 'hide', scaffold_ids: [SCAFFOLD_ID] }],
    ['批量推荐', 'POST', `/courses/${COURSE_ID}/scaffolds/bulk`, { action: 'recommend', scaffold_ids: [SCAFFOLD_ID] }],
  ];

  for (const [label, method, path, body] of cases) {
    it(`${label}：教师账号在这门课里只是普通成员（或根本不在课里）→ 403，什么都没写`, async () => {
      h.ensureCourseInstructor.mockRejectedValue(new ApiError(403, 'Only the course instructor can perform this action'));
      expect(await writesAs(method, path, body)).toBe(403);
      expect(h.state.writes).toEqual([]);
      expect(h.ensureCourseInstructor).toHaveBeenCalledWith(COURSE_ID, expect.objectContaining({ id: 'teacher-joined' }));
    });

    it(`${label}：课程教职照常写`, async () => {
      const status = await writesAs(method, path, body);
      expect(status === 200 || status === 201).toBe(true);
      expect(h.state.writes.length).toBeGreaterThan(0);
      expect(h.ensureCourseInstructor).toHaveBeenCalledWith(COURSE_ID, expect.objectContaining({ id: 'teacher-joined' }));
    });
  }
});

/** 2026-10-09：写笔记时按草稿推荐一条支架（Jev，scaffoldRecommend.ts） */
describe('POST /courses/:id/scaffolds/recommend', () => {
  const NOTE_ID = '22222222-2222-4222-8222-222222222222';
  const SPACE_ID = '33333333-3333-4333-8333-333333333333';
  const recommend = (body: Record<string, unknown>) => fetch(`${base}/courses/${COURSE_ID}/scaffolds/recommend`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  it('不是这门课的人：403，什么都不问', async () => {
    h.ensureCourseMember.mockRejectedValueOnce(new ApiError(403, 'You are not a member of this course'));
    const res = await recommend({ title: 't', text: '一段足够长的草稿，写着我自己的观点和两条理由。' });
    expect(res.status).toBe(403);
    expect(h.recommendScaffold).not.toHaveBeenCalled();
  });

  it('草稿太短：不问 Jev', async () => {
    const res = await recommend({ title: 't', text: '我觉得' });
    expect(await res.json()).toEqual({ scaffold: null, fit: null, decided_by: 'too_short' });
    expect(h.recommendScaffold).not.toHaveBeenCalled();
  });

  it('只从学生看得到的支架里挑（这门课隐藏的不推荐）；推荐出来记一条 scaffold_recommended', async () => {
    h.recommendScaffold.mockResolvedValueOnce({
      scaffold: { id: 's-1', title: '我的想法是', titleEn: null, group: 'idea' }, fit: 0.8, substantive: 0.95,
      candidates: [{ id: 's-1', rank: 0.9, fit: 0.8, best: 0.9 }], model: 'jev-1.13.0', latencyMs: 900,
    });
    const res = await recommend({
      title: 'AI 让人懒', text: '我觉得 AI 让人懒得动脑，因为直接给答案。', parent: { title: '原笔记', text: '原文' },
      note_id: NOTE_ID, space_id: SPACE_ID,
    });
    expect(await res.json()).toEqual({ scaffold: { id: 's-1', title: '我的想法是', titleEn: null, group: 'idea' }, fit: 0.8, decided_by: 'jev' });
    const [draft, options] = h.recommendScaffold.mock.calls[0];
    expect(draft).toEqual({ title: 'AI 让人懒', text: '我觉得 AI 让人懒得动脑，因为直接给答案。', parent: { title: '原笔记', text: '原文' } });
    expect(options.map((o: { id: string }) => o.id)).toEqual(['s-1']);
    expect(h.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'scaffold_recommended', object_id: 's-1', space_id: SPACE_ID,
      metadata_json: expect.objectContaining({ note_id: NOTE_ID, course_id: COURSE_ID, fit: 0.8 }),
    }));
  });

  it('已经用在这条笔记里的不再推荐；Jev 没开时说明 off，不记事件', async () => {
    h.recommendScaffold.mockResolvedValueOnce(null);
    const res = await recommend({ title: '', text: '一段足够长的草稿，写着我自己的观点和两条理由。', used_ids: ['s-1', 'not-a-uuid'] });
    expect(await res.json()).toEqual({ scaffold: null, fit: null, decided_by: 'off' });
    // s-1 不是 uuid，used_ids 里只认 uuid：这里只看 s-2（隐藏）照样被排除
    expect(h.recommendScaffold.mock.calls[0][1].map((o: { id: string }) => o.id)).toEqual(['s-1']);
    expect(h.logEvent).not.toHaveBeenCalled();
  });
});
