import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const state = { memories: {} as Record<string, any>, rows: [] as Array<Record<string, any>>, writes: [] as string[], failRead: false, failSave: false };
  const from = (table: string) => {
    const conditions: Record<string, any> = {};
    let before = ''; let after = ''; let update: any;
    const run = () => {
      if (state.failRead) return Promise.resolve({ data: null, error: { message: 'read failed' } });
      if (table === 'agent_conversations' || table === 'note_conversation_threads') {
        if (update) {
          if (state.failSave) return Promise.resolve({ data: null, error: { message: 'write failed' } });
          if (conditions.conversation_memory !== JSON.stringify(state.memories[conditions.id] ?? {})) return Promise.resolve({ data: null, error: null });
          state.memories[conditions.id] = update.conversation_memory;
          state.writes.push(conditions.id);
        }
        return Promise.resolve({ data: { conversation_memory: state.memories[conditions.id] ?? {} }, error: null });
      }
      return Promise.resolve({ data: state.rows.filter(row => row[table === 'agent_messages' ? 'conversation_id' : 'thread_id'] === (conditions.conversation_id ?? conditions.thread_id) && (!before || row.created_at < before) && (!after || row.created_at > after)).slice(0, 100), error: null });
    };
    const builder: any = {
      select: () => builder, eq: (key: string, value: any) => { conditions[key] = value; return builder; },
      lt: (_key: string, value: string) => { before = value; return builder; }, gt: (_key: string, value: string) => { after = value; return builder; },
      order: () => builder, limit: () => builder, update: (value: any) => { update = value; return builder; },
      maybeSingle: run, then: (ok: any, fail: any) => run().then(ok, fail),
    }; return builder;
  };
  return { state, from, aiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '用户选定蒸发主题，7B 班，35 分钟；水杯实验仍需确认。' } }] }) })) };
});
vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('./aiGateway', () => ({ aiFetch: h.aiFetch }));
vi.mock('./urlGuard', () => ({ assertSafePublicUrl: vi.fn() }));
import { restoreConversationMemory, type MemoryMessage } from './conversationMemory';
const model = { providerId: 'openai', model: 'test-model', apiKey: 'fictional-key' };
const transcript = (id: string) => Array.from({ length: 102 }, (_, i) => ({
  id: `m-${i}`, conversation_id: id, thread_id: id, role: i % 2 ? 'assistant' : 'user', sender_kind: i % 2 ? 'assistant' : 'user',
  content: i === 0 ? '主题是蒸发。班级 7B，课堂 35 分钟。' : `讨论 ${i}`, created_at: new Date(Date.UTC(2026, 9, 7, 0, 0, i)).toISOString(),
}));
const normalized = (rows: ReturnType<typeof transcript>): MemoryMessage[] => rows.map(row => ({ id: row.id, role: row.role as MemoryMessage['role'], content: row.content, createdAt: row.created_at }));
beforeEach(() => { h.state.memories = {}; h.state.rows = []; h.state.writes = []; h.state.failRead = false; h.state.failSave = false; h.aiFetch.mockClear(); });

describe('persistent conversation memory', () => {
  it.each(['workspace', 'note'] as const)('%s: compacts earlier requirements, saves them, and reloads them when reopened or switching models', async kind => {
    const rows = transcript('own-thread');
    h.state.rows = rows;
    const history = normalized(rows).slice(-100);
    const first = await restoreConversationMemory({ kind, id: 'own-thread', history, model });
    expect(first.memoryLoaded).toBe(true);
    expect(h.state.writes).toEqual(['own-thread']);
    const body = JSON.parse(h.aiFetch.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('班级 7B，课堂 35 分钟');
    expect(body.messages[0].content).toContain('Later explicit corrections supersede');
    expect(first.messages[0].content).toContain('7B 班，35 分钟');
    expect(first.messages.at(-1)?.content).toBe('讨论 101');
    const reopened = await restoreConversationMemory({ kind, id: 'own-thread', history, model: { ...model, model: 'another-model' } });
    expect(reopened.messages).toEqual(first.messages);
    expect(h.aiFetch).toHaveBeenCalledTimes(1);
  });
  it('does not reserve more memory space than a smaller model window can afford', async () => {
    const rows = transcript('own-thread').slice(0,20).map(row => ({ ...row, content: '完整问题细节'.repeat(25) }));
    h.state.rows = rows;
    const history = normalized(rows);
    const result = await restoreConversationMemory({ kind: 'workspace', id: 'own-thread', history, model, budget: { contextTokens:32768, historyBytes:16576, verified:false } });
    expect(result.messages).toEqual(history.map(({role,content})=>({role,content})));
    expect(h.aiFetch).not.toHaveBeenCalled();
  });
  it('does not load another conversation’s memory or messages', async () => {
    h.state.memories['other-thread'] = { version: 1, summary: 'PRIVATE OTHER THREAD', through: '2026-10-07T00:00:00Z' };
    h.state.rows = transcript('other-thread');
    const result = await restoreConversationMemory({ kind: 'workspace', id: 'new-thread', history: [{ role: 'user', content: 'hello' }], model });
    expect(result.memoryLoaded).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(h.aiFetch).not.toHaveBeenCalled();
  });
  it('retains the existing checkpoint if summarization or saving fails', async () => {
    h.state.rows = transcript('own-thread');
    const previous = { version: 1, summary: '先前的确认要求', through: '2026-10-07T00:00:00.000Z' };
    h.state.memories['own-thread'] = previous;
    h.state.failSave = true;
    const result = await restoreConversationMemory({ kind: 'note', id: 'own-thread', history: normalized(h.state.rows as ReturnType<typeof transcript>).slice(-100), model });
    expect(h.state.memories['own-thread']).toEqual(previous);
    expect(result.messages[0].content).toContain(previous.summary);
  });
  it('advances the checkpoint past an oversized historical message without deleting its transcript', async () => {
    h.state.rows = transcript('own-thread');
    h.state.rows[0].content = 'x'.repeat(50000);
    await restoreConversationMemory({ kind: 'note', id: 'own-thread', history: normalized(h.state.rows as ReturnType<typeof transcript>).slice(-100), model });
    expect(h.state.memories['own-thread'].through).toBe(h.state.rows[0].created_at);
    expect(h.state.rows[0].content).toHaveLength(50000);
    expect(JSON.parse(h.aiFetch.mock.calls[0][1].body).messages[1].content).toContain('Middle omitted');
  });
  it('stops on a memory read failure instead of answering without the saved context', async () => {
    h.state.failRead = true;
    await expect(restoreConversationMemory({ kind: 'note', id: 'own-thread', history: [{ role: 'user', content: '继续' }], model })).rejects.toThrow('对话记忆加载失败');
    expect(h.aiFetch).not.toHaveBeenCalled();
  });
});
