import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * GET /spaces/:spaceId/view-topics —— 问题栏后面滚动的讨论主题（2026-10-05）。
 * 笔记没变用存的；变了但不到 3 分钟先给旧的；同一时刻只生成一次；对照组、课程关掉时不显示。
 */

const h = vi.hoisted(() => {
  const state = {
    notes: [] as Array<Record<string, unknown>>,
    stored: null as null | { signature: string; topics: unknown[]; created_at: string },
    triggerSettings: {} as Record<string, unknown>,
    condition: 'treatment' as string,
    inserts: [] as Array<Record<string, unknown>>,
    gate: null as Promise<void> | null,
  };
  const from = (table: string) => {
    let action: 'select' | 'insert' = 'select';
    let payload: Record<string, unknown> = {};
    const result = () => {
      if (table === 'notes') return { data: state.notes, error: null };
      if (table === 'views') return { data: [{ id: 'v-1' }], error: null };
      if (table === 'teacher_ai_configs') return { data: [{ trigger_settings: state.triggerSettings, configured_at: '2026-10-01' }], error: null };
      if (table === 'view_topic_summaries' && action === 'insert') { state.inserts.push(payload); return { data: null, error: null }; }
      if (table === 'view_topic_summaries') return { data: state.stored, error: null };
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      insert: (p: Record<string, unknown>) => { action = 'insert'; payload = p; return Promise.resolve(result()); },
      maybeSingle: () => Promise.resolve(result()),
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, fail),
    };
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) builder[m] = () => builder;
    return builder;
  };
  const callJson = vi.fn(async () => {
    if (state.gate) await state.gate;
    return { topics: [{ label: '检索练习的边界', noteIds: ['n1', 'n2'] }, { label: '回想与重读', noteIds: ['n3'] }] };
  });
  return { state, from, callJson };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { id: 'student-1', role: 'student' }; next(); },
}));
vi.mock('../services/accessControl', () => ({
  ensureSpaceAccess: vi.fn(async () => ({ id: 'space-1', course_id: 'course-1', standing: 'member' })),
}));
vi.mock('../services/experimentCondition', () => ({
  resolveEffectiveCondition: vi.fn(async () => ({ condition: h.state.condition, groupId: null, experimentMode: false })),
}));
vi.mock('./thinkingTrainer', () => ({
  resolveCourseProviderChain: vi.fn(async () => [{ providerId: 'deepseek', model: 'deepseek-flash' }]),
  callJson: h.callJson,
}));

import viewTopicsRouter, { FAILURE_COOLDOWN_MS, resetViewTopicFailuresForTests } from './viewTopics';
import { errorHandler } from '../middleware/errorHandler';
import { topicSignature } from '../services/viewTopics';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use('/api', viewTopicsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

const note = (id: string) => ({ id, title: `笔记 ${id}`, content: '<p>正文</p>', updated_at: '2026-10-05T01:00:00Z', views: ['v-1'], type: 'note', is_ai_generated: false });

beforeEach(() => {
  h.state.notes = [note('a'), note('b'), note('c')];
  h.state.stored = null;
  h.state.triggerSettings = {};
  h.state.condition = 'treatment';
  h.state.inserts = [];
  h.state.gate = null;
  h.callJson.mockClear();
  resetViewTopicFailuresForTests();
});

const get = async (view = 'v-1') => {
  const res = await fetch(`${base}/spaces/space-1/view-topics?view_id=${view}`);
  return { status: res.status, body: await res.json() as Record<string, any> };
};

describe('生成与缓存', () => {
  it('第一次：生成，存一行（带签名），返回主题', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(h.callJson).toHaveBeenCalledTimes(1);
    expect(body.topics.map((t: { label: string }) => t.label)).toEqual(['检索练习的边界', '回想与重读']);
    expect(body.topics[0]).toMatchObject({ noteIds: ['a', 'b'], count: 2 });
    expect(h.state.inserts[0]).toMatchObject({ space_id: 'space-1', view_id: 'v-1', note_count: 3, signature: topicSignature(h.state.notes as any) });
  });

  it('笔记没变：直接用存的，不调模型', async () => {
    h.state.stored = { signature: topicSignature(h.state.notes as any), topics: [{ label: '存着的', noteIds: ['a'], count: 1 }], created_at: new Date().toISOString() };
    const { body } = await get();
    expect(h.callJson).not.toHaveBeenCalled();
    expect(body).toMatchObject({ topics: [{ label: '存着的' }], stale: false });
  });

  it('笔记变了、离上次不到 3 分钟：先给旧的（stale），不调模型', async () => {
    h.state.stored = { signature: 'old', topics: [{ label: '旧的', noteIds: ['a'], count: 1 }], created_at: new Date().toISOString() };
    const { body } = await get();
    expect(h.callJson).not.toHaveBeenCalled();
    expect(body).toMatchObject({ topics: [{ label: '旧的' }], stale: true });
  });

  it('同一时刻很多人打开：只生成一次', async () => {
    let release!: () => void;
    h.state.gate = new Promise<void>(r => { release = r; });
    const all = Promise.all([get(), get(), get()]);
    await new Promise(r => setTimeout(r, 50));
    release();
    const results = await all;
    expect(h.callJson).toHaveBeenCalledTimes(1);
    expect(results.every(r => r.body.topics.length === 2)).toBe(true);
  });
});

describe('不显示的情况', () => {
  it('整群实验的对照组：不调模型', async () => {
    h.state.condition = 'control';
    const { body } = await get();
    expect(body).toEqual({ topics: [], disabled: 'experiment' });
    expect(h.callJson).not.toHaveBeenCalled();
  });

  it('课程 AI 设置里关掉了', async () => {
    h.state.triggerSettings = { view_topics_enabled: false };
    const { body } = await get();
    expect(body).toEqual({ topics: [], disabled: 'course' });
  });

  it('笔记少于 3 条', async () => {
    h.state.notes = [note('a'), note('b')];
    const { body } = await get();
    expect(body).toEqual({ topics: [], noteCount: 2 });
    expect(h.callJson).not.toHaveBeenCalled();
  });

  it('没带 view_id：400', async () => {
    const res = await fetch(`${base}/spaces/space-1/view-topics`);
    expect(res.status).toBe(400);
  });
});

describe('没生成出来的时候（10-05 线上：每家模型都没给出正文）', () => {
  it('回一个空的、标上 failed，告诉前端两分钟后再问', async () => {
    h.callJson.mockResolvedValueOnce(null as never);
    const { body } = await get();
    expect(body).toMatchObject({ topics: [], failed: true, retryAfterMs: FAILURE_COOLDOWN_MS });
    expect(h.state.inserts).toHaveLength(0);
  });

  it('失败后两分钟内不再试：不调模型，直接回，并说还要等多久', async () => {
    h.callJson.mockResolvedValueOnce(null as never);
    await get();
    const { body } = await get();
    expect(h.callJson).toHaveBeenCalledTimes(1);
    expect(body.failed).toBe(true);
    expect(body.retryAfterMs).toBeGreaterThan(0);
    expect(body.retryAfterMs).toBeLessThanOrEqual(FAILURE_COOLDOWN_MS);
  });

  it('有旧的就先给旧的', async () => {
    h.state.stored = { signature: 'old', topics: [{ label: '旧的', noteIds: ['a'], count: 1 }], created_at: new Date(Date.now() - 10 * 60_000).toISOString() };
    h.callJson.mockResolvedValueOnce(null as never);
    const { body } = await get();
    expect(body).toMatchObject({ topics: [{ label: '旧的' }], stale: true, failed: true });
  });

  it('等过了冷却再试，成功了照常给', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      h.callJson.mockResolvedValueOnce(null as never);
      await get();
      vi.setSystemTime(Date.now() + FAILURE_COOLDOWN_MS + 1000);
      const { body } = await get();
      expect(h.callJson).toHaveBeenCalledTimes(2);
      expect(body).toMatchObject({ stale: false });
      expect(body.failed).toBeUndefined();
      expect(body.topics).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
