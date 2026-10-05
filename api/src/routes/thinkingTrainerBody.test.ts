import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * callJson / callChat 的请求体（2026-10-05）。
 *
 * 画布顶上的讨论主题上线后在线上一次都没生成出来：DeepSeek、智谱、DMX 的 GLM 和 DeepSeek
 * 默认开思考，900 个 token 全给了推理，正文为空（HTTP 200、finish_reason=length）；
 * Kimi 只收 temperature=1，直接 400。这条路径以前没套各家的请求体规则。
 */

const h = vi.hoisted(() => ({
  bodies: [] as Array<{ url: string; body: Record<string, any> }>,
  reply: (_body: Record<string, any>) => ({ ok: true, content: '{"ok":true}' } as { ok: boolean; content: string; status?: number; reasoningTokens?: number }),
}));

vi.mock('../services/aiGateway', () => ({
  aiFetch: vi.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    h.bodies.push({ url, body });
    const r = h.reply(body);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      text: async () => '{"error":{"message":"bad"}}',
      json: async () => ({
        choices: [{ message: { content: r.content }, finish_reason: r.content ? 'stop' : 'length' }],
        usage: { completion_tokens_details: { reasoning_tokens: r.reasoningTokens ?? 0 } },
      }),
    };
  }),
}));

import { callChat, callJson, openAiCompatibleBody } from './thinkingTrainer';

const cfg = (providerId: string, model: string) => ({ providerId, model, apiKey: 'k', endpointUrl: null });

beforeEach(() => {
  h.bodies.length = 0;
  h.reply = () => ({ ok: true, content: '{"ok":true}' });
});

describe('openAiCompatibleBody', () => {
  it('Kimi 不管预算多少都按 temperature=1 传', () => {
    expect(openAiCompatibleBody('moonshot', 'kimi-k2.6', 's', 'u', 900, 0.8).temperature).toBe(1);
    expect(openAiCompatibleBody('moonshot', 'kimi-k3', 's', 'u', 2400, 0.85).temperature).toBe(1);
    expect(openAiCompatibleBody('deepseek', 'deepseek-flash', 's', 'u', 2400, 0.8).temperature).toBe(0.8);
  });

  it.each([
    ['deepseek', 'deepseek-flash'],
    ['zhipu', 'glm-5.3'],
    ['dmx', 'deepseek-v4-flash'],
    ['dmx', 'glm-5.3-flash'],
  ])('预算小于 1500：%s/%s 关掉思考', (providerId, model) => {
    expect(openAiCompatibleBody(providerId, model, 's', 'u', 900, 0.8).thinking).toEqual({ type: 'disabled' });
  });

  it('预算大的照旧，不加思考开关', () => {
    expect(openAiCompatibleBody('dmx', 'glm-5.3-flash', 's', 'u', 2400, 0.8).thinking).toBeUndefined();
    expect(openAiCompatibleBody('zhipu', 'glm-5.3', 's', 'u', 1500, 0.8).thinking).toBeUndefined();
  });

  it('DMX 上别的模型不加 thinking；千问非流式一律 enable_thinking:false', () => {
    expect(openAiCompatibleBody('dmx', 'gpt-5-mini', 's', 'u', 900, 0.8).thinking).toBeUndefined();
    expect(openAiCompatibleBody('dmx', 'qwen3.8-flash', 's', 'u', 2400, 0.8).enable_thinking).toBe(false);
  });

  it('消息照旧：system 在前、user 在后', () => {
    expect(openAiCompatibleBody('deepseek', 'deepseek-flash', '系统', '用户', 900, 0.8).messages).toEqual([
      { role: 'system', content: '系统' },
      { role: 'user', content: '用户' },
    ]);
  });
});

describe('callJson / callChat 真的用上了', () => {
  it('讨论主题那样的调用（900 token）：发给 DeepSeek 的请求关了思考', async () => {
    const out = await callJson(cfg('deepseek', 'deepseek-flash'), 's', 'u', 900, 'fast', []);
    expect(out).toEqual({ ok: true });
    expect(h.bodies[0].body).toMatchObject({ max_tokens: 900, thinking: { type: 'disabled' } });
  });

  it('Kimi 收到的是 temperature=1，不再 400', async () => {
    await callJson(cfg('moonshot', 'kimi-k2.6'), 's', 'u', 900, 'fast', []);
    expect(h.bodies[0].body.temperature).toBe(1);
  });

  it('200 却没有正文（推理用完预算）：记一条日志，换下一家', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.reply = body => (body.model === 'glm-5.3' ? { ok: true, content: '', reasoningTokens: 900 } : { ok: true, content: '{"from":"deepseek"}' });
    const out = await callJson(cfg('zhipu', 'glm-5.3'), 's', 'u', 2400, 'fast', [cfg('deepseek', 'deepseek-flash')]);
    expect(out).toEqual({ from: 'deepseek' });
    expect(warn.mock.calls.some(c => String(c[0]).includes('zhipu/glm-5.3') && String(c[0]).includes('900'))).toBe(true);
    warn.mockRestore();
  });

  it('纯文本的 callChat 一样：小预算关思考、Kimi 用 1', async () => {
    await callChat(cfg('deepseek', 'deepseek-flash'), 's', 'u', 500, 'chat', []);
    await callChat(cfg('moonshot', 'kimi-k2.6'), 's', 'u', 500, 'chat', []);
    expect(h.bodies[0].body.thinking).toEqual({ type: 'disabled' });
    expect(h.bodies[1].body.temperature).toBe(1);
  });
});
