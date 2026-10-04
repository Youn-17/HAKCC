import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * AI 反馈这条链在真实路由上的顺序：
 *   教师在课程 AI 设置里给「AI 反馈与支架建议」指定的模型先打；
 *   没指定时先 DeepSeek Flash（学生在等）；
 *   打不通就按原来的链往下换（智谱 → DeepSeek → DMX 快档），健康度排序照旧。
 * 学生在 AI 助手里选的模型不再决定反馈用哪个。
 */

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Record<string, unknown>[],
    failFor: new Set<string>(),
    calls: [] as { url: string; model: string }[],
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
  };
  const reply = JSON.stringify({ need: 1, type: 'T3', rationale: 'claim', feedback: '你给出了结论。还缺依据。能补一个例子吗？', scaffold: '支持这一点的依据是' });

  const resultFor = (table: string, action: 'select' | 'insert', payload?: Record<string, unknown>) => {
    if (table === 'notes') {
      return {
        data: { id: 'note-1', title: '数据与结论', content: '', space_id: 'space-1', author_id: 'student-1', spaces: { id: 'space-1', course_id: 'course-1', group_id: 'group-1' } },
        error: null,
        count: 2,
      };
    }
    if (table === 'teacher_ai_configs') return { data: state.rows, error: null };
    if (table === 'note_ai_feedbacks' && action === 'insert') return { data: { id: 'fb-1', created_at: '2026-09-29T00:00:00Z', ...payload }, error: null };
    return { data: null, error: null, count: 0 };
  };
  const from = (table: string) => {
    let action: 'select' | 'insert' = 'select';
    let payload: Record<string, unknown> | undefined;
    const run = () => Promise.resolve(resultFor(table, action, payload));
    const builder: Record<string, unknown> = {
      insert: (p: Record<string, unknown>) => { action = 'insert'; payload = p; state.inserts.push({ table, payload: p }); return builder; },
      single: run,
      maybeSingle: run,
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    };
    for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit', 'gte', 'in', 'update']) builder[m] = () => builder;
    return builder;
  };
  const aiFetch = vi.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { model: string };
    state.calls.push({ url, model: body.model });
    const key = `${new URL(url).hostname}|${body.model}`;
    if ([...state.failFor].some(f => key.includes(f))) {
      return { ok: false, status: 500, json: async () => ({}), text: async () => 'upstream error' };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: reply } }] }), text: async () => '' };
  });
  return { state, from, aiFetch };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'student-1', role: 'student' };
    next();
  },
}));
vi.mock('../services/experimentCondition', () => ({
  resolveEffectiveCondition: vi.fn(async () => ({ condition: 'treatment', groupId: 'group-1', experimentMode: false })),
  logSuppressedIntervention: vi.fn(async () => {}),
}));
vi.mock('../services/aiGateway', () => ({ aiFetch: h.aiFetch }));
vi.mock('../services/aiProviderConfig', () => ({
  decryptProviderApiKey: () => 'sk-test',
  withFastChatOptions: (_provider: string, _model: string, body: unknown) => body,
}));
vi.mock('../services/modelRouter', async () => {
  const { preferredNativeModel } = await import('../services/modelCatalog');
  return {
    isDmxProvider: (pid: string) => pid === 'dmx' || pid === 'dmxapi',
    pickModels: () => ['glm-5.3-flash', 'qwen3.8-flash'],
    pickNativeModel: preferredNativeModel,
    orderConfigsByHealth: (configs: unknown[]) => configs,
    reportModelFailure: () => {},
    reportModelSuccess: () => {},
    reportProviderFailure: () => {},
    reportProviderSuccess: () => {},
    classifyHttpFailure: () => 'server',
  };
});
vi.mock('../services/accessControl', () => ({
  ensureCourseInstructor: vi.fn(async () => {}),
  ensureSpaceAccess: vi.fn(async () => ({ id: 'space-1', course_id: 'course-1', group_id: 'group-1', standing: 'member' })),
  isCourseStaff: () => false,
}));

import noteAiFeedbackRouter from './noteAiFeedback';
import { errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', noteAiFeedbackRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

const cfg = (provider_id: string, enabled_models: string[], trigger_settings: unknown = null) => ({
  provider_id, api_key_encrypted: 'enc', endpoint_url: null, is_verified: true, enabled_models,
  configured_at: '2026-09-01T00:00:00Z', trigger_settings,
});

beforeEach(() => {
  h.state.calls.length = 0;
  h.state.inserts.length = 0;
  h.state.failFor.clear();
  h.state.rows = [
    cfg('dmx', ['glm-5.3', 'glm-5.3-flash']),
    cfg('zhipu', ['glm-5.3', 'glm-5.3-flash']),
    cfg('deepseek', ['deepseek-flash', 'deepseek-v4-pro']),
  ];
});

const DRAFT = '<p>我认为数据越多，模型得出的结论就一定越可靠，所以以后做任何判断只要把数据量堆上去就行了。</p>';

async function requestFeedback(body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/notes/note-1/ai-feedback/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: DRAFT, ...body }),
  });
  expect(res.status).toBe(201);
  const row = h.state.inserts.find(i => i.table === 'note_ai_feedbacks')!.payload;
  return { row, calls: h.state.calls.map(c => `${new URL(c.url).hostname} ${c.model}`) };
}

describe('AI 反馈用哪个模型', () => {
  it('没指定：先 DeepSeek Flash，学生在助手里选的 DMX 不再插队', async () => {
    const { row, calls } = await requestFeedback({ provider_id: 'dmx', model: 'gpt-5.5' });
    expect(calls).toEqual(['api.deepseek.com deepseek-flash']);
    expect(row).toMatchObject({ provider_id: 'deepseek', model: 'deepseek-flash' });
  });

  it('教师指定了智谱 GLM-5.3 Flash：先打它', async () => {
    h.state.rows[1] = cfg('zhipu', ['glm-5.3', 'glm-5.3-flash'], {
      cooldown_seconds: 120,
      ai_models: { features: { note_feedback: { provider_id: 'zhipu', model: 'glm-5.3-flash' } } },
    });
    const { row, calls } = await requestFeedback();
    expect(calls).toEqual(['open.bigmodel.cn glm-5.3-flash']);
    expect(row).toMatchObject({ provider_id: 'zhipu', model: 'glm-5.3-flash' });
  });

  it('指定的那家打不通：按原来的链换下一家（智谱 → DeepSeek → DMX）', async () => {
    h.state.rows[0] = cfg('dmx', ['glm-5.3', 'glm-5.3-flash'], {
      ai_models: { features: { note_feedback: { provider_id: 'moonshot', model: 'kimi-k2.6' } } },
    });
    h.state.rows.push(cfg('moonshot', ['kimi-k2.6']));
    h.state.failFor.add('kimi-k2.6');
    h.state.failFor.add('open.bigmodel.cn');
    const { row, calls } = await requestFeedback();
    expect(calls).toEqual([
      'api.moonshot.cn kimi-k2.6',
      'open.bigmodel.cn glm-5.3',
      'api.deepseek.com deepseek-flash',
    ]);
    expect(row).toMatchObject({ provider_id: 'deepseek', model: 'deepseek-flash' });
  });

  it('默认的 DeepSeek 打不通：换智谱，再到 DMX 快档', async () => {
    h.state.failFor.add('api.deepseek.com');
    h.state.failFor.add('open.bigmodel.cn');
    const { calls } = await requestFeedback();
    expect(calls).toEqual([
      'api.deepseek.com deepseek-flash',
      'open.bigmodel.cn glm-5.3',
      'www.dmxapi.cn glm-5.3-flash',
    ]);
  });
});
