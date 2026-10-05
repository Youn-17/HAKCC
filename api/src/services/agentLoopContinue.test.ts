import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 回答写到 max_tokens 被截住：接着写，学生看到的是一段完整的回答（2026-10-05 用户：输出要完整，不要硬截断）。
 * 回答长度只写在提示词里，max_tokens 只防跑飞；真撞上了，厂商会说 finish_reason=length。
 */

const h = vi.hoisted(() => ({
  replies: [] as Array<{ content: string; finish_reason: string }>,
  bodies: [] as Array<Record<string, any>>,
}));

vi.mock('./aiGateway', () => ({
  aiFetch: vi.fn(async (_url: string, init: { body: string }) => {
    h.bodies.push(JSON.parse(init.body));
    const reply = h.replies.shift() ?? { content: '', finish_reason: 'stop' };
    return new Response(JSON.stringify({ choices: [{ message: { content: reply.content }, finish_reason: reply.finish_reason }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }),
  isAiBusy: () => false,
}));

import { CONTINUE_PROMPT, MAX_CONTINUATIONS, runAgentLoopStream, type AgentStreamEvent } from './agentLoop';

const params = () => ({
  providerId: 'zhipu',
  model: 'glm-4.5-air',
  apiKey: 'k',
  systemPrompt: '系统提示',
  messages: [{ role: 'user' as const, content: '为什么检索练习有效？' }],
  tools: [],
  executeToolFn: async () => ({ success: true }),
  maxTokens: 1200,
});

async function run() {
  const events: AgentStreamEvent[] = [];
  for await (const e of runAgentLoopStream(params() as any)) events.push(e);
  const text = events.filter(e => e.type === 'token').map(e => (e as { content: string }).content).join('');
  const done = events.find(e => e.type === 'done') as Extract<AgentStreamEvent, { type: 'done' }>;
  return { text, done };
}

beforeEach(() => {
  h.replies = [];
  h.bodies = [];
});

describe('回答被长度上限截住', () => {
  it('接着写一段，拼在后面；第二次请求带上已写的部分和「接着写」，不带工具', async () => {
    h.replies = [
      { content: '检索练习有效，是因为每次回想都', finish_reason: 'length' },
      { content: '让记忆痕迹更牢。', finish_reason: 'stop' },
    ];
    const { text, done } = await run();

    expect(text).toBe('检索练习有效，是因为每次回想都让记忆痕迹更牢。');
    expect(done.result.content).toBe(text);
    expect(done.result.continuations).toBe(1);
    expect(done.result.truncated).toBeUndefined();
    const second = h.bodies[1];
    expect(second.messages.slice(-2)).toEqual([
      { role: 'assistant', content: '检索练习有效，是因为每次回想都' },
      { role: 'user', content: CONTINUE_PROMPT },
    ]);
    expect(second.tools).toBeUndefined();
  });

  it('没被截住：不多发请求', async () => {
    h.replies = [{ content: '完整的回答。', finish_reason: 'stop' }];
    const { text, done } = await run();
    expect(text).toBe('完整的回答。');
    expect(h.bodies).toHaveLength(1);
    expect(done.result.continuations).toBeUndefined();
  });

  it(`最多接 ${MAX_CONTINUATIONS} 段，还没写完就标出来`, async () => {
    h.replies = Array.from({ length: MAX_CONTINUATIONS + 1 }, (_, i) => ({ content: `第${i + 1}段`, finish_reason: 'length' }));
    const { text, done } = await run();
    expect(text).toBe('第1段第2段第3段');
    expect(done.result.continuations).toBe(MAX_CONTINUATIONS);
    expect(done.result.truncated).toBe(true);
    expect(h.bodies).toHaveLength(MAX_CONTINUATIONS + 1);
  });

  it('接着写的那次什么也没给：照已有的结束，不报错', async () => {
    h.replies = [{ content: '前半段', finish_reason: 'length' }, { content: '', finish_reason: 'stop' }];
    const { text, done } = await run();
    expect(text).toBe('前半段');
    expect(done.result.finishReason).toBe('completed');
  });
});
