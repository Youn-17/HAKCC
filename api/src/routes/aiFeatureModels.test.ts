import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 课程 AI 设置里「各功能用哪个模型」的读写接口。
 * 挂真的 ai 路由，只替换数据库、登录和课程身份：
 *   - 只有这门课的教职能读写，学生和别门课的教师都进不来；
 *   - 返回里没有任何密钥（连加密后的也没有）和接口地址；
 *   - 存在触发设置同一行的 JSON 里，不冲掉触发设置；
 *   - 删掉存着设置的那条服务商配置，设置搬到剩下的行上。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string; course_id: string; provider_id: string };
  const state = {
    user: { id: 'teacher-1', role: 'teacher' } as { id: string; role: string },
    rows: [] as Row[],
    updates: [] as { id: unknown; payload: Record<string, unknown> }[],
  };
  // course-1：teacher-1 创建，teacher-3 是课程管理员；teacher-2 是别门课的教师；student-1 是学生
  const STAFF: Record<string, string[]> = { 'course-1': ['teacher-1', 'teacher-3'] };
  const MEMBERS: Record<string, string[]> = { 'course-1': ['student-1'] };

  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    let action: 'select' | 'update' | 'delete' = 'select';
    let payload: Record<string, unknown> = {};
    const matching = () => state.rows.filter(r => Object.entries(eq).every(([k, v]) => r[k] === v));
    const run = (terminal: 'many' | 'single') => {
      if (table !== 'teacher_ai_configs') return Promise.resolve({ data: terminal === 'many' ? [] : null, error: null });
      if (action === 'update') {
        for (const r of matching()) Object.assign(r, payload);
        state.updates.push({ id: eq.id, payload });
        return Promise.resolve({ data: null, error: null });
      }
      if (action === 'delete') {
        const gone = new Set(matching());
        state.rows = state.rows.filter(r => !gone.has(r));
        return Promise.resolve({ data: null, error: null });
      }
      const found = matching().map(r => ({ ...r }));
      return Promise.resolve(terminal === 'many'
        ? { data: found, error: null }
        : { data: found[0] ?? null, error: found[0] ? null : { message: 'not found' } });
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, value: unknown) => { eq[col] = value; return builder; },
      order: () => builder,
      update: (p: Record<string, unknown>) => { action = 'update'; payload = p; return builder; },
      delete: () => { action = 'delete'; return builder; },
      single: () => run('single'),
      maybeSingle: () => run('single'),
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run('many').then(ok, fail),
    };
    return builder;
  };

  return { state, STAFF, MEMBERS, from };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
  requireRole: (...roles: string[]) => (req: { user?: { role: string } }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  },
}));
vi.mock('../services/accessControl', async () => {
  const { ApiError } = await import('../middleware/errorHandler');
  return {
    ensureCourseInstructor: async (courseId: string, user: { id: string; role: string }) => {
      if (user.role === 'admin' || (h.STAFF[courseId] ?? []).includes(user.id)) return;
      throw new ApiError(403, 'Only the course instructor can perform this action');
    },
    ensureCourseMember: async (courseId: string, user: { id: string }) => {
      if ((h.STAFF[courseId] ?? []).includes(user.id)) return 'owner';
      if ((h.MEMBERS[courseId] ?? []).includes(user.id)) return 'member';
      throw new ApiError(403, 'You are not a member of this course');
    },
  };
});
vi.mock('../services/experimentCondition', () => ({ invalidateConditionCache: () => {} }));

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

const SECRET_ENDPOINT = 'https://private-proxy.example.test/v1/chat/completions';
const KEY = 'enc:v1:c2VjcmV0:dGFn:Ym9keQ';

beforeEach(() => {
  h.state.user = { id: 'teacher-1', role: 'teacher' };
  h.state.updates = [];
  h.state.rows = [
    { id: 'r-dmx', course_id: 'course-1', provider_id: 'dmx', api_key_encrypted: KEY, endpoint_url: SECRET_ENDPOINT, is_verified: true,
      enabled_models: ['glm-5.3', 'glm-5.3-flash', 'gpt-5.5'], configured_at: '2026-09-03T00:00:00Z', trigger_settings: {} },
    { id: 'r-deepseek', course_id: 'course-1', provider_id: 'deepseek', api_key_encrypted: KEY, endpoint_url: null, is_verified: true,
      enabled_models: ['deepseek-flash', 'deepseek-v4-pro'], configured_at: '2026-09-01T00:00:00Z',
      trigger_settings: { cooldown_seconds: 90, response_language: 'zh' } },
    { id: 'r-zhipu', course_id: 'course-1', provider_id: 'zhipu', api_key_encrypted: KEY, endpoint_url: null, is_verified: true,
      enabled_models: ['glm-5.3', 'glm-5.3-flash'], configured_at: '2026-09-02T00:00:00Z', trigger_settings: null },
    { id: 'r-minimax', course_id: 'course-1', provider_id: 'minimax', api_key_encrypted: KEY, endpoint_url: null, is_verified: true,
      enabled_models: [], configured_at: '2026-08-30T00:00:00Z', trigger_settings: null },
    { id: 'r-tavily', course_id: 'course-1', provider_id: 'tavily', api_key_encrypted: KEY, endpoint_url: null, is_verified: true,
      enabled_models: [], configured_at: '2026-08-29T00:00:00Z', trigger_settings: null },
  ];
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

const feature = (payload: { features: Array<{ id: string }> }, id: string) =>
  payload.features.find(f => f.id === id) as Record<string, any>;

function expectNoSecrets(text: string) {
  expect(text).not.toContain('enc:v1');
  expect(text).not.toContain('api_key');
  expect(text).not.toContain(SECRET_ENDPOINT);
}

describe('GET /courses/:id/ai-feature-models', () => {
  it('课程教职能看到每个功能现在用哪个模型，没有任何密钥和接口地址', async () => {
    const res = await call('GET', '/courses/course-1/ai-feature-models');
    expect(res.status).toBe(200);
    expectNoSecrets(res.text);

    expect(feature(res.json, 'note_feedback').current).toEqual({ providerId: 'deepseek', model: 'deepseek-flash', source: 'default' });
    // 2026-09-29 起生成图片默认先用 DMX，MiniMax 放在后面；10-09 DMX 下架 qwen-image-plus，默认换成 Seedream 4.5
    expect(feature(res.json, 'note_image').current).toEqual({ providerId: 'dmx', model: 'doubao-seedream-4-5-251128', source: 'default' });
    expect(feature(res.json, 'web_search').current).toEqual({ providerId: 'tavily', model: 'tavily-search', source: 'fixed' });
    expect(res.json.options.chat.some((o: { providerId: string }) => o.providerId === 'tavily')).toBe(false);
    expect(res.json.partnerModels).toMatchObject({ allowed: null, restricted: false, defaultModel: { providerId: 'deepseek', model: 'deepseek-flash' } });
  });

  it('课程管理员也能读', async () => {
    h.state.user = { id: 'teacher-3', role: 'teacher' };
    expect((await call('GET', '/courses/course-1/ai-feature-models')).status).toBe(200);
  });

  it('学生、别门课的教师都读不到', async () => {
    h.state.user = { id: 'student-1', role: 'student' };
    expect((await call('GET', '/courses/course-1/ai-feature-models')).status).toBe(403);
    h.state.user = { id: 'teacher-2', role: 'teacher' };
    expect((await call('GET', '/courses/course-1/ai-feature-models')).status).toBe(403);
  });
});

describe('PUT /courses/:id/ai-feature-models', () => {
  it('存进触发设置那一行的 JSON，不冲掉触发设置', async () => {
    const res = await call('PUT', '/courses/course-1/ai-feature-models', {
      features: { note_feedback: { provider_id: 'zhipu', model: 'glm-5.3-flash' } },
      partner_models: [{ provider_id: 'deepseek', model: 'deepseek-flash' }, { provider_id: 'zhipu', model: 'glm-5.3' }],
    });
    expect(res.status).toBe(200);
    expectNoSecrets(res.text);

    // 触发设置在 deepseek 那一行（最新的非空设置行），就写那一行
    expect(h.state.updates).toHaveLength(1);
    expect(h.state.updates[0].id).toBe('r-deepseek');
    const saved = h.state.rows.find(r => r.id === 'r-deepseek')!.trigger_settings as Record<string, any>;
    expect(saved.cooldown_seconds).toBe(90);
    expect(saved.response_language).toBe('zh');
    expect(saved.ai_models.features.note_feedback).toEqual({ provider_id: 'zhipu', model: 'glm-5.3-flash' });

    expect(feature(res.json, 'note_feedback').current).toEqual({ providerId: 'zhipu', model: 'glm-5.3-flash', source: 'teacher' });
    expect(res.json.partnerModels.restricted).toBe(true);
    expect(res.json.partnerModels.allowed).toEqual([
      { providerId: 'deepseek', model: 'deepseek-flash' }, { providerId: 'zhipu', model: 'glm-5.3' },
    ]);

    // 再读一遍是同样的结果；触发设置接口看不到这份设置
    const again = await call('GET', '/courses/course-1/ai-feature-models');
    expect(feature(again.json, 'note_feedback').saved).toEqual({ providerId: 'zhipu', model: 'glm-5.3-flash' });
    const trigger = await call('GET', '/courses/course-1/trigger-settings');
    expect(trigger.json.settings.cooldown_seconds).toBe(90);
    expect(trigger.json.settings.ai_models).toBeUndefined();
  });

  it('改回「自动」：传 null', async () => {
    await call('PUT', '/courses/course-1/ai-feature-models', { features: { doc_ai: { provider_id: 'zhipu', model: 'glm-5.3' } } });
    const res = await call('PUT', '/courses/course-1/ai-feature-models', { features: { doc_ai: null } });
    expect(res.status).toBe(200);
    expect(feature(res.json, 'doc_ai').saved).toBeNull();
    expect(feature(res.json, 'doc_ai').current.source).toBe('default');
  });

  it('用不了的选择、不认识的功能、不能选的功能、空名单：400，什么都不写', async () => {
    const bad = [
      { features: { doc_ai: { provider_id: 'openai', model: 'gpt-5.5' } } },
      { features: { doc_ai: { provider_id: 'zhipu', model: 'glm-4.7' } } },
      { features: { nope: { provider_id: 'zhipu', model: 'glm-5.3' } } },
      { features: { embedding: { provider_id: 'dmx', model: 'glm-5.3' } } },
      { features: { doc_ai: { provider_id: 'zhipu' } } },
      { partner_models: [] },
      { partner_models: 'deepseek' },
    ];
    for (const body of bad) {
      const res = await call('PUT', '/courses/course-1/ai-feature-models', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(h.state.updates).toHaveLength(0);
  });

  it('这门课还没有任何服务商配置：404', async () => {
    h.state.rows = [];
    const res = await call('PUT', '/courses/course-1/ai-feature-models', { features: { doc_ai: null } });
    expect(res.status).toBe(404);
  });

  it('学生、别门课的教师都改不了', async () => {
    const body = { features: { note_feedback: { provider_id: 'zhipu', model: 'glm-5.3' } } };
    h.state.user = { id: 'student-1', role: 'student' };
    expect((await call('PUT', '/courses/course-1/ai-feature-models', body)).status).toBe(403);
    h.state.user = { id: 'teacher-2', role: 'teacher' };
    expect((await call('PUT', '/courses/course-1/ai-feature-models', body)).status).toBe(403);
    expect(h.state.updates).toHaveLength(0);
  });
});

describe('学生读得到的部分', () => {
  it('GET /courses/:id/ai-configs 带上学生可选模型和「默认」，仍然没有密钥', async () => {
    await call('PUT', '/courses/course-1/ai-feature-models', {
      partner_models: [{ provider_id: 'zhipu', model: 'glm-5.3-flash' }],
    });
    h.state.user = { id: 'student-1', role: 'student' };
    const res = await call('GET', '/courses/course-1/ai-configs');
    expect(res.status).toBe(200);
    expectNoSecrets(res.text);
    expect(res.json.partnerModels).toEqual({
      allowed: [{ providerId: 'zhipu', model: 'glm-5.3-flash' }],
      defaultModel: { providerId: 'zhipu', model: 'glm-5.3-flash' },
    });
  });
});

describe('删除服务商配置', () => {
  it('删掉存着设置的那一行，设置搬到剩下最新的一行', async () => {
    await call('PUT', '/courses/course-1/ai-feature-models', { features: { support: { provider_id: 'zhipu', model: 'glm-5.3-flash' } } });
    const res = await call('DELETE', '/courses/course-1/ai-configs/deepseek');
    expect(res.status).toBe(200);
    expect(h.state.rows.some(r => r.provider_id === 'deepseek')).toBe(false);
    const moved = h.state.rows.find(r => r.id === 'r-dmx')!.trigger_settings as Record<string, any>;
    expect(moved.cooldown_seconds).toBe(90);
    expect(moved.ai_models.features.support).toEqual({ provider_id: 'zhipu', model: 'glm-5.3-flash' });

    const after = await call('GET', '/courses/course-1/ai-feature-models');
    expect(feature(after.json, 'support').current).toEqual({ providerId: 'zhipu', model: 'glm-5.3-flash', source: 'teacher' });
  });

  it('删别的行不动设置', async () => {
    await call('DELETE', '/courses/course-1/ai-configs/zhipu');
    expect(h.state.updates).toHaveLength(0);
  });
});
