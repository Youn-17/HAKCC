import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * callJson / callChat 这一族（讨论速览、讨论室、思维练习、编程练习、计算思维工具）的候选链：
 *   课程 AI 设置里给这个功能指定的模型排第一（用那门课自己的 key）；
 *   没指定时学生在等的功能先 DeepSeek Flash；
 *   第一个失败就顺着链换下一家，DMX 排在前面时分档走完也接着换。
 */

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Record<string, unknown>[],
    memberships: [] as string[],
    failHosts: new Set<string>(),
    calls: [] as string[],
  };
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const inList: Record<string, unknown[]> = {};
    const run = () => {
      if (table === 'course_members') return Promise.resolve({ data: state.memberships.map(course_id => ({ course_id })), error: null });
      if (table === 'courses') return Promise.resolve({ data: [], error: null });
      if (table === 'teacher_ai_configs') {
        const rows = state.rows.filter(r =>
          (!('course_id' in eq) || r.course_id === eq.course_id)
          && (!inList.course_id || inList.course_id.includes(r.course_id)));
        return Promise.resolve({ data: rows, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      not: () => builder,
      eq: (col: string, value: unknown) => { eq[col] = value; return builder; },
      in: (col: string, values: unknown[]) => { inList[col] = values; return builder; },
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    };
    return builder;
  };
  const aiFetch = vi.fn(async (url: string, init: { body: string }) => {
    const { model } = JSON.parse(init.body) as { model: string };
    const host = new URL(url).hostname;
    state.calls.push(`${host} ${model}`);
    if (state.failHosts.has(host)) return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }), text: async () => '' };
  });
  return { state, from, aiFetch };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../services/aiGateway', () => ({ aiFetch: h.aiFetch }));
vi.mock('../services/aiProviderConfig', () => ({ decryptProviderApiKey: (k: string) => `key:${k}` }));
vi.mock('../services/agentLoop', async () => {
  const { CHAT_ENDPOINTS } = await import('../services/providerEndpoints');
  return { getProviderEndpoint: (pid: string) => CHAT_ENDPOINTS[pid] ?? CHAT_ENDPOINTS.openai };
});
vi.mock('../services/modelRouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/modelRouter')>();
  // 这里只看顺序本身；冷却与空位排序由 modelRouter 自己的测试管
  return { ...actual, orderConfigsByHealth: <T,>(configs: T[]) => configs };
});

import { callJson, resolveCourseProviderChain, resolveProviderChain } from './thinkingTrainer';

const cfgRow = (course_id: string, provider_id: string, enabled_models: string[], trigger_settings: unknown = null) => ({
  course_id, id: `${course_id}-${provider_id}`, provider_id, api_key_encrypted: `${course_id}-${provider_id}`,
  endpoint_url: null, is_verified: true, enabled_models, configured_at: '2026-09-01T00:00:00Z', trigger_settings,
});
const choose = (feature: string, provider_id: string, model: string) => ({ ai_models: { features: { [feature]: { provider_id, model } } } });

beforeEach(() => {
  h.state.calls.length = 0;
  h.state.failHosts.clear();
  h.state.memberships = ['course-1', 'course-2'];
  h.state.rows = [
    cfgRow('course-1', 'zhipu', ['glm-5.3']),
    cfgRow('course-1', 'deepseek', ['deepseek-flash', 'deepseek-v4-pro']),
    cfgRow('course-2', 'moonshot', ['kimi-k2.6']),
  ];
});

describe('不属于某门课的练习工具（按用户取链）', () => {
  it('没有哪门课指定：默认 DeepSeek Flash 在前，其余按原来的顺序', async () => {
    const chain = await resolveProviderChain('student-1');
    expect(chain.map(c => `${c.providerId} ${c.model}`)).toEqual(['deepseek deepseek-flash', 'zhipu glm-5.3', 'moonshot kimi-k2.6']);
  });

  it('第一门指定了模型的课说了算，用那门课自己的 key', async () => {
    h.state.rows[2] = cfgRow('course-2', 'moonshot', ['kimi-k2.6'], choose('practice', 'moonshot', 'kimi-k2.6'));
    const [first] = await resolveProviderChain('student-1');
    expect(first).toMatchObject({ providerId: 'moonshot', model: 'kimi-k2.6', apiKey: 'key:course-2-moonshot' });
  });
});

describe('属于某门课的功能（讨论速览、讨论室、计算思维工具）', () => {
  it('只用这门课的 key', async () => {
    const chain = await resolveCourseProviderChain('course-1', 'discussion_digest');
    expect(chain.map(c => c.providerId)).toEqual(['deepseek', 'zhipu']);
  });

  it('指定的排第一；它失败了就顺着链换下一家', async () => {
    h.state.rows[0] = cfgRow('course-1', 'zhipu', ['glm-5.3'], choose('riseabove_room', 'zhipu', 'glm-5.3'));
    h.state.failHosts.add('open.bigmodel.cn');
    const chain = await resolveCourseProviderChain('course-1', 'riseabove_room');
    expect(chain.map(c => c.providerId)).toEqual(['zhipu', 'deepseek']);
    const out = await callJson(chain[0], 'system', 'user', 500, 'chat', chain.slice(1));
    expect(out).toEqual({ ok: true });
    expect(h.state.calls).toEqual(['open.bigmodel.cn glm-5.3', 'api.deepseek.com deepseek-flash']);
  });

  it('指定了 DMX 的某个模型：先打它，DMX 分档走完还不行就换下一家', async () => {
    h.state.rows = [
      cfgRow('course-1', 'dmx', ['glm-5.3', 'gpt-5.5'], choose('discussion_digest', 'dmx', 'gpt-5.5')),
      cfgRow('course-1', 'deepseek', ['deepseek-flash']),
    ];
    h.state.failHosts.add('www.dmxapi.cn');
    const chain = await resolveCourseProviderChain('course-1', 'discussion_digest');
    const out = await callJson(chain[0], 'system', 'user', 500, 'chat', chain.slice(1));
    expect(out).toEqual({ ok: true });
    expect(h.state.calls[0]).toBe('www.dmxapi.cn gpt-5.5');
    expect(h.state.calls.filter(c => c.startsWith('www.dmxapi.cn'))).toHaveLength(3);
    expect(h.state.calls.at(-1)).toBe('api.deepseek.com deepseek-flash');
  });
});
