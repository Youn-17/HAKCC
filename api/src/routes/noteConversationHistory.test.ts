import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 笔记 AI 助手的「历史对话」（2026-09-29）：
 *   - 「新建对话」真的新建一段：以前同一个模型下后端一律返回旧线程，历史里永远只有一条；
 *   - 手头已有空白对话时复用它，不攒空线程；
 *   - 列表里每段对话带「学生问的第一句」，空白的是 null；
 *   - 学生可以删自己的对话：只打标记，行和消息都留着（研究数据），产品里当它不存在；
 *   - 只有开这段对话的人能删，课程教职也不能替学生删。
 * 假库是有状态的：线程、参与者、消息各一张表，查询按条件真过滤，这样复用、删除、列表的行为才测得出来。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const db = {
    threads: [] as Row[],
    participants: [] as Row[],
    messages: [] as Row[],
    events: [] as Row[],
  };
  const state = {
    user: { id: 'student-a', role: 'student' } as { id: string; role: string },
    clock: 0,
    seq: 0,
  };
  // teacher-1 是课程创建者；其余是普通成员（student-a、student-b）
  const STANDING: Record<string, 'owner' | 'member'> = { 'teacher-1': 'owner' };
  const NOTE = {
    id: 'note-1', title: '我的笔记', content: '<p>正文</p>', space_id: 'space-1',
    spaces: { id: 'space-1', course_id: 'course-1' },
  };

  const tick = () => new Date(Date.UTC(2026, 8, 29, 8, 0, 0) + (state.clock += 1000)).toISOString();

  const tables = (name: string): Row[] => {
    switch (name) {
      case 'note_conversation_threads': return db.threads;
      case 'note_conversation_participants': return db.participants;
      case 'note_conversation_messages': return db.messages;
      case 'events': return db.events;
      default: return [];
    }
  };

  const from = (table: string) => {
    let action: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: any;
    const filters: Array<(row: Row) => boolean> = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let max = Infinity;
    let joinParticipants = false;

    const matching = () => {
      let rows = tables(table).filter(row => filters.every(f => f(row)));
      if (orderBy) {
        const { col, asc } = orderBy;
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      return rows.slice(0, max);
    };

    const withJoin = (row: Row) => (joinParticipants
      ? { ...row, note_conversation_participants: db.participants.filter(p => p.thread_id === row.id) }
      : { ...row });

    const run = (terminal: 'many' | 'single' | 'maybeSingle') => {
      if (table === 'notes') {
        return Promise.resolve({ data: terminal === 'many' ? [NOTE] : NOTE, error: null });
      }
      if (table === 'course_members') return Promise.resolve({ data: { course_id: 'course-1' }, error: null });
      if (action === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => {
          const now = tick();
          const row: Row = { id: `${table}-${(state.seq += 1)}`, created_at: now, updated_at: now, deleted_at: null, ...p };
          tables(table).push(row);
          if (table === 'note_conversation_messages') {
            // 库里的触发器：有新消息，线程的 updated_at 跟着变
            const thread = db.threads.find(t => t.id === row.thread_id);
            if (thread) thread.updated_at = now;
          }
          return row;
        });
        return Promise.resolve({ data: terminal === 'many' ? rows : rows[0], error: null });
      }
      if (action === 'upsert') {
        for (const p of (Array.isArray(payload) ? payload : [payload]) as Row[]) {
          const exists = tables(table).find(r => r.thread_id === p.thread_id && r.user_id === p.user_id);
          if (!exists) tables(table).push({ ...p });
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (action === 'update') {
        for (const row of matching()) Object.assign(row, payload);
        return Promise.resolve({ data: null, error: null });
      }
      const rows = matching().map(withJoin);
      if (terminal === 'many') return Promise.resolve({ data: rows, error: null });
      const found = rows[0] ?? null;
      return Promise.resolve({ data: found, error: found || terminal === 'maybeSingle' ? null : { message: 'not found' } });
    };

    const builder: Record<string, any> = {
      select: (cols?: string) => {
        if (action === 'select' && typeof cols === 'string' && cols.includes('note_conversation_participants')) joinParticipants = true;
        return builder;
      },
      insert: (p: unknown) => { action = 'insert'; payload = p; return builder; },
      upsert: (p: unknown) => { action = 'upsert'; payload = p; return builder; },
      update: (p: unknown) => { action = 'update'; payload = p; return builder; },
      eq: (col: string, value: unknown) => { filters.push(row => row[col] === value); return builder; },
      is: (col: string, value: unknown) => { filters.push(row => (row[col] ?? null) === value); return builder; },
      in: (col: string, values: unknown[]) => { filters.push(row => values.includes(row[col])); return builder; },
      lt: (col: string, value: string) => { filters.push(row => String(row[col]) < value); return builder; },
      order: (col: string, opts?: { ascending?: boolean }) => { orderBy = { col, asc: opts?.ascending !== false }; return builder; },
      limit: (n: number) => { max = n; return builder; },
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run('many').then(ok, fail),
    };
    return builder;
  };

  return {
    db, state, from, STANDING, tick,
    ensureSpaceAccess: vi.fn(async (_spaceId: string, user: { id: string }) => ({ standing: STANDING[user.id] ?? 'member' })),
    runAgentLoopStream: vi.fn(() => (async function* () { yield { type: 'done', result: { iterations: 1 } }; })()),
  };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from, storage: { from: () => ({}) } } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
}));
vi.mock('../services/accessControl', () => ({
  ensureSpaceAccess: h.ensureSpaceAccess,
  isCourseStaff: (standing: string | undefined) => standing === 'owner' || standing === 'manager',
}));
vi.mock('../services/aiGateway', () => ({ aiFetch: vi.fn() }));
vi.mock('../services/aiProviderConfig', () => ({
  decryptProviderApiKey: () => 'sk-test',
  listCourseAiConfigs: async () => [{ providerId: 'deepseek' }],
  normalizeDeepSeekModel: (model: string) => model,
  usesDeepSeekModelAliases: () => false,
  withDeepSeekOptions: (_provider: string, _model: string, body: unknown) => body,
  withFastChatOptions: (_provider: string, _model: string, body: unknown) => body,
}));
vi.mock('../services/agentLoop', () => ({ runAgentLoopStream: h.runAgentLoopStream }));
vi.mock('../services/agentContext', () => ({
  buildAgentContext: async () => ({ systemPrompt: '', messages: [], toolContext: {}, overrelianceDetected: false }),
  updateProfileAfterInteraction: async () => {},
}));
vi.mock('../services/agentTools', () => ({
  createDefaultRegistry: () => ({ getToolsForRole: () => [], executeTool: async () => ({ success: false, data: null }) }),
}));
vi.mock('../services/knowledgeBase', () => ({ searchKnowledgeBase: async () => [] }));
vi.mock('../services/embeddingService', () => ({ embedNote: async () => {} }));
vi.mock('../services/tavilySearch', () => ({
  callTavilySearch: async () => ({ results: [] }),
  formatTavilyResultsForPrompt: () => '',
}));
vi.mock('../services/noteImage', () => ({ generateNoteImage: async () => ({ ok: false, error: 'no image in this test' }) }));

import noteConversationsRouter from './noteConversations';
import { ApiError, errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', noteConversationsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  h.db.threads.length = 0;
  h.db.participants.length = 0;
  h.db.messages.length = 0;
  h.db.events.length = 0;
  h.state.user = { id: 'student-a', role: 'student' };
  h.state.clock = 0;
  h.state.seq = 0;
});

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON 保留原文 */ }
  return { status: res.status, body: parsed as Record<string, any> };
}

const MODEL = { target_type: 'ai', provider_id: 'deepseek', model: 'deepseek-flash', title: 'GenAI · 我的笔记' };
const openChat = (extra: Record<string, unknown> = {}) => call('POST', '/notes/note-1/conversations', { ...MODEL, ...extra });
const listChats = async () => (await call('GET', '/notes/note-1/conversations')).body.conversations as Array<Record<string, any>>;

/** 学生在这段对话里问了一句、AI 答了一句（直接写库，不经模型） */
function ask(threadId: string, question: string, userId = 'student-a') {
  const asked = h.tick();
  const answered = h.tick();
  h.db.messages.push(
    { id: `q-${h.db.messages.length}`, thread_id: threadId, sender_id: userId, sender_kind: 'user', content: question, created_at: asked },
    { id: `a-${h.db.messages.length}`, thread_id: threadId, sender_id: null, sender_kind: 'assistant', content: '回答', created_at: answered },
  );
  // 库里的触发器：有新消息，线程的 updated_at 跟着变
  h.db.threads.find(t => t.id === threadId)!.updated_at = answered;
}

describe('新建对话', () => {
  it('同一个模型下也真的开一段新的：历史里才会有不止一条', async () => {
    const first = await openChat();
    expect(first.status).toBe(201);
    const firstId = first.body.conversation.id;
    ask(firstId, '检索练习为什么有效？');

    const second = await openChat({ force_new: true });
    expect(second.status).toBe(201);
    expect(second.body.conversation.id).not.toBe(firstId);
    expect(second.body.conversation.preview).toBeNull();
    expect(h.db.threads).toHaveLength(2);
  });

  it('手头已有还没问过话的空白对话：直接用它，不再多开（连点两下也不会攒空线程）', async () => {
    const first = await openChat({ force_new: true });
    expect(first.status).toBe(201);

    const again = await openChat({ force_new: true });
    expect(again.status).toBe(200);
    expect(again.body.conversation.id).toBe(first.body.conversation.id);
    expect(again.body.conversation.preview).toBeNull();
    expect(h.db.threads).toHaveLength(1);
  });

  it('别人的空白对话不算：只看自己在这条笔记上开的', async () => {
    h.state.user = { id: 'student-b', role: 'student' };
    const theirs = await openChat({ force_new: true });
    h.state.user = { id: 'student-a', role: 'student' };
    const mine = await openChat({ force_new: true });

    expect(mine.status).toBe(201);
    expect(mine.body.conversation.id).not.toBe(theirs.body.conversation.id);
  });

  it('不带 force_new（第一次问 AI 时开线程）照旧：同一个人、同一个模型只有一条，问的话进同一段', async () => {
    const first = await openChat();
    const again = await openChat();

    expect(again.status).toBe(200);
    expect(again.body.conversation.id).toBe(first.body.conversation.id);
    expect(h.db.threads).toHaveLength(1);
  });

  it('删掉的对话不会被「第一次问 AI」的复用捡回来：会开一段新的', async () => {
    const first = await openChat();
    await call('DELETE', `/note-conversations/${first.body.conversation.id}`);

    const next = await openChat();
    expect(next.status).toBe(201);
    expect(next.body.conversation.id).not.toBe(first.body.conversation.id);
  });
});

describe('历史对话列表', () => {
  it('每段带学生问的第一句；空白的对话是 null；最近有动静的排最前', async () => {
    const older = (await openChat()).body.conversation.id;
    ask(older, '  检索练习\n为什么有效？  ');
    const newer = (await openChat({ force_new: true })).body.conversation.id;
    ask(newer, '再问一个问题');
    ask(newer, '第二问');
    const blank = (await openChat({ force_new: true })).body.conversation.id;

    const list = await listChats();
    expect(list.map(t => t.id)).toEqual([blank, newer, older]);
    expect(list.find(t => t.id === older)!.preview).toBe('检索练习 为什么有效？');
    expect(list.find(t => t.id === newer)!.preview).toBe('再问一个问题');
    expect(list.find(t => t.id === blank)!.preview).toBeNull();
  });

  it('预览只取学生的话，最多 80 个字', async () => {
    const id = (await openChat()).body.conversation.id;
    ask(id, '问'.repeat(200));

    const [thread] = await listChats();
    expect(thread.preview).toBe('问'.repeat(80));
  });

  it('删掉的对话不再列出', async () => {
    const keep = (await openChat()).body.conversation.id;
    ask(keep, '留着的');
    const drop = (await openChat({ force_new: true })).body.conversation.id;
    ask(drop, '要删的');

    await call('DELETE', `/note-conversations/${drop}`);
    expect((await listChats()).map(t => t.id)).toEqual([keep]);
  });

  it('普通成员只看到自己的；课程教职看到这条笔记上的全部（被删的除外）', async () => {
    const mine = (await openChat()).body.conversation.id;
    ask(mine, '我的问题');
    h.state.user = { id: 'student-b', role: 'student' };
    const theirs = (await openChat()).body.conversation.id;
    ask(theirs, '同学的问题', 'student-b');

    expect((await listChats()).map(t => t.id)).toEqual([theirs]);
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    expect((await listChats()).map(t => t.id).sort()).toEqual([mine, theirs].sort());

    h.state.user = { id: 'student-b', role: 'student' };
    await call('DELETE', `/note-conversations/${theirs}`);
    h.state.user = { id: 'teacher-1', role: 'teacher' };
    expect((await listChats()).map(t => t.id)).toEqual([mine]);
  });
});

describe('删除历史对话', () => {
  it('删自己的：只打标记，线程和消息都还在库里（研究数据），并留一条事件记录', async () => {
    const id = (await openChat()).body.conversation.id;
    ask(id, '问题');

    const res = await call('DELETE', `/note-conversations/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const row = h.db.threads.find(t => t.id === id)!;
    expect(row.deleted_at).toEqual(expect.any(String));
    expect(row.deleted_by).toBe('student-a');
    expect(h.db.threads).toHaveLength(1);
    expect(h.db.messages.filter(m => m.thread_id === id)).toHaveLength(2);
    expect(h.db.events.map(e => e.event_type)).toContain('note_conversation_deleted');
  });

  it('删掉以后这段对话对产品来说不存在：读消息、发消息、再删都是 404', async () => {
    const id = (await openChat()).body.conversation.id;
    ask(id, '问题');
    await call('DELETE', `/note-conversations/${id}`);

    expect((await call('GET', `/note-conversations/${id}/messages`)).status).toBe(404);
    expect((await call('POST', `/note-conversations/${id}/ai/stream`, { content: '接着问', provider_id: 'deepseek', model: 'deepseek-flash' })).status).toBe(404);
    expect((await call('DELETE', `/note-conversations/${id}`)).status).toBe(404);
  });

  it('别人的对话删不了：同学、课程教职都是 403，对话原样', async () => {
    const id = (await openChat()).body.conversation.id;
    ask(id, '问题');

    h.state.user = { id: 'student-b', role: 'student' };
    expect((await call('DELETE', `/note-conversations/${id}`)).status).toBe(403);

    h.state.user = { id: 'teacher-1', role: 'teacher' };
    expect((await call('DELETE', `/note-conversations/${id}`)).status).toBe(403);

    expect(h.db.threads.find(t => t.id === id)!.deleted_at).toBeNull();
  });

  it('不是这条笔记所在空间的成员：先被空间授权拦下，403，什么都没动', async () => {
    const id = (await openChat()).body.conversation.id;
    h.ensureSpaceAccess.mockRejectedValueOnce(new ApiError(403, 'This space belongs to another group'));

    const res = await call('DELETE', `/note-conversations/${id}`);
    expect(res.status).toBe(403);
    expect(h.db.threads.find(t => t.id === id)!.deleted_at).toBeNull();
  });
});
