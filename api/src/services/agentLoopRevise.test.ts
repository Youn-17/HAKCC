import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * harness 的 onStop 接在循环里（2026-10-11）：整段回答在手里时，先过 reviseFinal 再推给学生，
 * 学生一个字也看不到改之前的版本；接着写的几段也一起过。各次非流式调用的 token 数加起来交出去。
 */

const h = vi.hoisted(() => ({
  replies: [] as Array<{ content: string; finish_reason: string; usage?: Record<string, number> }>,
}));

vi.mock('./aiGateway', () => ({
  aiFetch: vi.fn(async () => {
    const reply = h.replies.shift() ?? { content: '', finish_reason: 'stop' };
    return new Response(JSON.stringify({
      choices: [{ message: { content: reply.content }, finish_reason: reply.finish_reason }],
      ...(reply.usage ? { usage: reply.usage } : {}),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }),
  isAiBusy: () => false,
}));

import { runAgentLoopStream, type AgentStreamEvent } from './agentLoop';

async function run(reviseFinal?: (text: string) => Promise<string>) {
  const events: AgentStreamEvent[] = [];
  for await (const e of runAgentLoopStream({
    providerId: 'zhipu', model: 'glm-4.5-air', apiKey: 'k', systemPrompt: 's',
    messages: [{ role: 'user', content: '问' }], tools: [],
    executeToolFn: async () => ({ success: true, data: null }), maxTokens: 800,
    ...(reviseFinal ? { reviseFinal } : {}),
  })) events.push(e);
  const tokens = events.filter(e => e.type === 'token').map(e => (e as { content: string }).content);
  const done = events.find(e => e.type === 'done') as Extract<AgentStreamEvent, { type: 'done' }>;
  return { tokens, done };
}

beforeEach(() => { h.replies = []; });

describe('回答给学生看之前过 reviseFinal', () => {
  it('推出去的只有改过的版本，接着写的那段也一起过；token 数加起来', async () => {
    h.replies = [
      { content: '当然！分歧在', finish_reason: 'length', usage: { prompt_tokens: 100, completion_tokens: 20 } },
      { content: '第二栏。', finish_reason: 'stop', usage: { prompt_tokens: 130, completion_tokens: 5 } },
    ];
    const seen: string[] = [];
    const { tokens, done } = await run(async text => { seen.push(text); return text.replace('当然！', ''); });
    expect(seen).toEqual(['当然！分歧在第二栏。']);
    expect(tokens.join('')).toBe('分歧在第二栏。');
    expect(tokens.some(t => t.includes('当然'))).toBe(false);
    expect(done.result).toMatchObject({ content: '分歧在第二栏。', revised: true, continuations: 1, usage: { prompt: 230, completion: 25, calls: 2 } });
  });

  it('reviseFinal 出错或给空串：用原文', async () => {
    h.replies = [{ content: '原文。', finish_reason: 'stop' }];
    expect((await run(async () => { throw new Error('boom'); })).tokens.join('')).toBe('原文。');
    h.replies = [{ content: '原文。', finish_reason: 'stop' }];
    const empty = await run(async () => '  ');
    expect(empty.tokens.join('')).toBe('原文。');
    expect(empty.done.result.revised).toBeUndefined();
  });

  it('不给 reviseFinal：照旧边拿边推', async () => {
    h.replies = [{ content: '原样。', finish_reason: 'stop' }];
    const { tokens, done } = await run();
    expect(tokens.join('')).toBe('原样。');
    expect(done.result.usage).toBeUndefined();
  });
});
