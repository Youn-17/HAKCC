import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * POST /api/ai/image：文档 AI 侧栏里说「画一张……」时直接出图（2026-09-29）。
 * 挂真的 ai 路由，只替换数据库、登录、课程身份和出图本身：
 *   - 只有这门课的成员能画，出图用的是这门课的配置；
 *   - 和 /ai/chat 共用每天 100 次的上限，到了就不再出图；
 *   - 画成了记一条 ai_interventions（研究数据里能看到是在文档侧栏画的），画不成把原因告诉学生。
 */

const h = vi.hoisted(() => {
  const state = {
    user: { id: 'student-1', role: 'student' } as { id: string; role: string },
    todayUsage: 0,
    inserts: [] as { table: string; row: Record<string, unknown> }[],
  };
  const MEMBERS: Record<string, string[]> = { 'course-1': ['student-1', 'teacher-1'] };

  const from = (table: string) => {
    let counting = false;
    const builder: Record<string, unknown> = {
      select: (_cols?: string, opts?: { count?: string }) => { counting = Boolean(opts?.count); return builder; },
      eq: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (row: Record<string, unknown>) => {
        state.inserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () => Promise.resolve({ data: table === 'spaces' ? { id: 'space-1' } : null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
        Promise.resolve(counting ? { count: state.todayUsage, error: null } : { data: [], error: null }).then(ok, fail),
    };
    return builder;
  };

  const generateNoteImage = vi.fn();
  return { state, MEMBERS, from, generateNoteImage };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/accessControl', async () => {
  const { ApiError } = await import('../middleware/errorHandler');
  return {
    ensureCourseInstructor: async () => {},
    ensureCourseMember: async (courseId: string, user: { id: string }) => {
      if ((h.MEMBERS[courseId] ?? []).includes(user.id)) return 'member';
      throw new ApiError(403, 'You are not a member of this course');
    },
  };
});
vi.mock('../services/experimentCondition', () => ({ invalidateConditionCache: () => {} }));
vi.mock('../services/noteImage', () => ({ generateNoteImage: h.generateNoteImage }));

import aiRouter from './ai';
import { errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', aiRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

const IMAGE_URL = 'https://storage.example.test/generated/cat.png';

beforeEach(() => {
  h.state.user = { id: 'student-1', role: 'student' };
  h.state.todayUsage = 0;
  h.state.inserts = [];
  h.generateNoteImage.mockReset();
  h.generateNoteImage.mockResolvedValue({ ok: true, url: IMAGE_URL, model: 'qwen-image-plus', provider: 'dmx', timings: {} });
});

const draw = (body: Record<string, unknown>) => fetch(`${base}/ai/image`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('POST /ai/image', () => {
  it('课程成员说「画一张……」：用这门课的配置出图，回一段能直接显示的 markdown，并记下是在文档侧栏画的', async () => {
    const res = await draw({ course_id: 'course-1', prompt: '画一张[细胞分裂]的插画', feature: 'doc_ai' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(h.generateNoteImage).toHaveBeenCalledWith('course-1', '画一张[细胞分裂]的插画');
    // 方括号会截断 markdown 的图片描述，要去掉
    expect(body).toEqual({
      url: IMAGE_URL,
      markdown: `![画一张细胞分裂的插画](${IMAGE_URL})`,
      provider_id: 'dmx',
      model: 'qwen-image-plus',
    });
    const logged = h.state.inserts.filter(i => i.table === 'ai_interventions');
    expect(logged).toHaveLength(1);
    expect(logged[0].row).toMatchObject({
      space_id: 'space-1',
      user_id: 'student-1',
      trigger_type: 'doc_ai_direct_image',
      provider_id: 'dmx',
      model_name: 'qwen-image-plus',
      visibility_scope: 'private',
    });
  });

  it('不认识的 feature 记成通用的 chat_direct_image，不把任意字符串写进研究数据', async () => {
    const res = await draw({ course_id: 'course-1', prompt: '画一只猫', feature: 'anything; drop table' });
    expect(res.status).toBe(200);
    expect(h.state.inserts.find(i => i.table === 'ai_interventions')?.row.trigger_type).toBe('chat_direct_image');
  });

  it('不是这门课的成员：403，不出图', async () => {
    h.state.user = { id: 'outsider', role: 'student' };
    const res = await draw({ course_id: 'course-1', prompt: '画一只猫' });
    expect(res.status).toBe(403);
    expect(h.generateNoteImage).not.toHaveBeenCalled();
  });

  it('没写要画什么：400', async () => {
    const res = await draw({ course_id: 'course-1', prompt: '   ' });
    expect(res.status).toBe(400);
    expect(h.generateNoteImage).not.toHaveBeenCalled();
  });

  it('今天的 AI 次数用完了：429，不出图（和 /ai/chat 同一个上限）', async () => {
    h.state.todayUsage = 100;
    const res = await draw({ course_id: 'course-1', prompt: '画一只猫' });
    expect(res.status).toBe(429);
    expect(h.generateNoteImage).not.toHaveBeenCalled();
  });

  it('画不成：把原因告诉学生（比如这门课没配出图服务），不记成一次成功的出图', async () => {
    h.generateNoteImage.mockResolvedValue({ ok: false, error: '本课程未配置 MiniMax 或 DMX' });
    const res = await draw({ course_id: 'course-1', prompt: '画一只猫' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('未配置');
    expect(h.state.inserts.filter(i => i.table === 'ai_interventions')).toHaveLength(0);
  });
});
