import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 模型在调工具的同一步里写的话不推给学生，但会留在对话里。之前原样留着，模型以为学生看到了，
 * 最后一句「上面那段可以照着写」，学生什么也没看到（2026-10-11 评测 n29）。现在留着但标明没给学生看。
 */

const h = vi.hoisted(() => ({
  replies: [] as Array<Record<string, unknown>>,
  bodies: [] as Array<{ messages: Array<{ role: string; content: unknown }> }>,
}));

vi.mock('./aiGateway', () => ({
  aiFetch: vi.fn(async (_url: string, init: { body: string }) => {
    h.bodies.push(JSON.parse(init.body));
    const message = h.replies.shift() ?? { content: '' };
    return new Response(JSON.stringify({
      choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }),
  isAiBusy: () => false,
}));

import { NOT_SHOWN_NOTE, runAgentLoopStream, toolStepContent, type AgentStreamEvent } from './agentLoop';

beforeEach(() => { h.replies = []; h.bodies = []; });

describe('调工具那一步顺手写的话', () => {
  it('没给学生看：推出去的只有最后的回答；对话里那段标明「没给学生看」', async () => {
    h.replies = [
      {
        content: '模板如下：个性化听起来中立，但〔填〕。',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'search_notes', arguments: '{"query":"Oliver"}' } }],
      },
      { content: '你先说说你最认同 Oliver 哪一句？' },
    ];
    const events: AgentStreamEvent[] = [];
    for await (const e of runAgentLoopStream({
      providerId: 'zhipu', model: 'glm-4.5-air', apiKey: 'k', systemPrompt: 's',
      messages: [{ role: 'user', content: '帮我写一段回应 Oliver 的笔记' }],
      tools: [{ type: 'function', function: { name: 'search_notes', description: '', parameters: { type: 'object', properties: {} } } }],
      executeToolFn: async () => ({ success: true, data: { results: [] } }), maxTokens: 800,
    })) events.push(e);

    const shown = events.filter(e => e.type === 'token').map(e => (e as { content: string }).content).join('');
    expect(shown).toBe('你先说说你最认同 Oliver 哪一句？');
    const history = h.bodies[1].messages.find(m => m.role === 'assistant');
    expect(String(history?.content)).toBe(`${NOT_SHOWN_NOTE}\n模板如下：个性化听起来中立，但〔填〕。`);
  });

  it('空的、只有空白的不加标记', () => {
    expect(toolStepContent(null)).toBeNull();
    expect(toolStepContent('')).toBe('');
    expect(toolStepContent('  ')).toBe('  ');
  });
});
