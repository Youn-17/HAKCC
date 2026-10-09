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
  // 画之前的规划（drawPlanner）：默认「规划不可用」，退回用原话画；规划那组用例自己给结果
  const planDrawing = vi.fn(async () => ({ plan: null, error: 'no planner in this test' }) as unknown);
  const loadStudentLearningContext = vi.fn(async () => '学生自己的记录');
  return { state, MEMBERS, from, generateNoteImage, planDrawing, loadStudentLearningContext };
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
      if ((h.MEMBERS[courseId] ?? []).includes(user.id)) return user.id.startsWith('teacher') ? 'manager' : 'member';
      throw new ApiError(403, 'You are not a member of this course');
    },
    isCourseStaff: (standing: string) => standing === 'owner' || standing === 'manager',
  };
});
vi.mock('../services/experimentCondition', () => ({ invalidateConditionCache: () => {} }));
vi.mock('../services/noteImage', () => ({ generateNoteImage: h.generateNoteImage }));
vi.mock('../services/drawPlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/drawPlanner')>()),
  planDrawing: h.planDrawing,
}));
vi.mock('../services/studentLearningContext', () => ({ loadStudentLearningContext: h.loadStudentLearningContext }));

import aiRouter, { clientDrawContext } from './ai';
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
  h.planDrawing.mockClear();
  h.loadStudentLearningContext.mockClear();
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
    // 规划不可用：用原话画（老做法）
    expect(h.generateNoteImage.mock.calls[0].slice(0, 2)).toEqual(['course-1', '画一张[细胞分裂]的插画']);
    // 方括号会截断 markdown 的图片描述，要去掉
    expect(body).toEqual({
      url: IMAGE_URL,
      markdown: `![画一张细胞分裂的插画](${IMAGE_URL})`,
      provider_id: 'dmx',
      model: 'qwen-image-plus',
      caption: '',
      kind: 'picture',
      // 留给前端：下一句要改这张时带回来
      drawing: { kind: 'picture', prompt: '画一张[细胞分裂]的插画' },
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

  it('先读侧栏带来的文档和对话、学生自己的记录，按规划画；图下面写着画的是什么（2026-10-09）', async () => {
    h.planDrawing.mockResolvedValueOnce({
      plan: { kind: 'picture', prompt: 'Two students comparing recalled answers with the textbook', caption: '根据这份阅读材料里检索练习的部分，画了先回想再对答案的场景。' },
    });
    const res = await draw({
      course_id: 'course-1',
      prompt: '把这一段画出来',
      feature: 'doc_ai',
      context: {
        title: '检索练习导读',
        text: '先自己回想，再看答案，记得更牢。',
        history: [{ role: 'user', content: '这一段讲什么？' }, { role: 'assistant', content: '讲检索练习' }, { role: 'system', content: 42 }],
      },
    });
    expect(res.status).toBe(200);
    const [courseId, request, context] = h.planDrawing.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect([courseId, request]).toEqual(['course-1', '把这一段画出来']);
    expect(context.background).toContain('检索练习导读');
    expect(context.background).toContain('先自己回想，再看答案');
    expect(context.history).toEqual([{ role: 'user', content: '这一段讲什么？' }, { role: 'assistant', content: '讲检索练习' }]);
    expect(context.learner).toBe('学生自己的记录');
    expect(h.generateNoteImage.mock.calls[0][1]).toBe('Two students comparing recalled answers with the textbook');
    const body = await res.json();
    expect(body.caption).toBe('根据这份阅读材料里检索练习的部分，画了先回想再对答案的场景。');
    expect(body.markdown).toContain('\n\n根据这份阅读材料里检索练习的部分');
  });

  it('教职画图不读「学生自己的记录」', async () => {
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    h.loadStudentLearningContext.mockClear();
    await draw({ course_id: 'course-1', prompt: '画一只猫' });
    expect(h.loadStudentLearningContext).not.toHaveBeenCalled();
    expect((h.planDrawing.mock.calls.at(-1) as unknown as [string, string, { learner: string }])[2].learner).toBe('');
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

describe('clientDrawContext：侧栏带来的上下文只截短了用', () => {
  it('不是对象就当没有；字段截短，对话只留最近十条、去掉不像话的', () => {
    expect(clientDrawContext(null)).toEqual({ background: '', history: [] });
    const long = 'x'.repeat(9000);
    const ctx = clientDrawContext({ title: 'T'.repeat(500), text: long, history: Array.from({ length: 15 }, (_, i) => ({ role: 'user', content: `问${i}` })) });
    expect(ctx.background.length).toBeLessThan(6400);
    expect(ctx.history).toHaveLength(10);
    expect(ctx.history[0].content).toBe('问5');
  });
});

describe('POST /ai/draw-route：前端发之前先问要不要画（2026-10-09）', () => {
  const route = (body: Record<string, unknown>) => fetch(`${base}/ai/draw-route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

  it('测试里 Jev 没开：按说法认；回的是能直接用的结果和判断经过', async () => {
    expect(await route({ text: '画一只在月球上看书的猫' })).toEqual({
      draw: true, mode: 'new', form: null, decided_by: 'rule', route: { draw: true, mode: 'new', form: null, decided_by: 'rule', rule: true },
    });
    expect(await route({ text: '图书馆几点关门？' })).toMatchObject({ draw: false, decided_by: 'rule' });
    // 「画图」按钮：一定画
    expect(await route({ text: '一棵知识之树', forced: true })).toMatchObject({ draw: true, decided_by: 'forced' });
  });

  it('前端带来的上一张要核过：结构不对的当没有', async () => {
    expect(await route({ text: '颜色淡一点', previous: { request: '画猫', caption: '', kind: 'diagram', diagram: { type: 'graph', nodes: [] } } }))
      .toMatchObject({ draw: false, mode: 'new' });
  });
});

describe('POST /ai/image 改上一张', () => {
  it('mode=edit：前端带来的上一张交给规划；定下的种类一起交过去', async () => {
    const res = await draw({
      course_id: 'course-1', prompt: '颜色淡一点', feature: 'doc_ai', mode: 'edit', form: 'picture',
      context: { title: '细胞分裂', text: '……', history: [], previous: { request: '画一只猫', caption: '画了猫。', kind: 'picture', prompt: 'A cat' } },
    });
    expect(res.status).toBe(200);
    const context = (h.planDrawing.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(context.previous).toEqual({ request: '画一只猫', caption: '画了猫。', kind: 'picture', prompt: 'A cat' });
    expect(context.form).toBe('picture');
    expect(h.generateNoteImage.mock.calls[0][1]).toBe('A cat. Change requested by the learner: 颜色淡一点');
  });

  it('没说是改图：前端带了上一张也不用', async () => {
    await draw({ course_id: 'course-1', prompt: '画一只狗', context: { previous: { request: '画一只猫', caption: '', kind: 'picture', prompt: 'A cat' } } });
    expect((h.planDrawing.mock.calls[0] as unknown[])[2]).not.toHaveProperty('previous');
  });
});
