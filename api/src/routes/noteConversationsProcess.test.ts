vi.mock('../services/studentLearningContext', () => ({ loadStudentLearningContext: vi.fn(async () => '') }));
import 'express-async-errors';
import { loadStudentLearningContext } from '../services/studentLearningContext';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 笔记页 AI 的回答长度和过程（2026-10-05）：
 *   - 学生选的档位和目标字数写进提示词，max_tokens 按目标留足余量；
 *   - 「自由提问」那条路写到上限被截住，接着写一段，学生收到的是完整的回答；
 *   - 智能体那条路每一步推结果摘要和用时，存进回答（tool_steps），回看时也能看到。
 */

(globalThis as any).__streams = [];
(globalThis as any).__aiBodies = [];

const h = vi.hoisted(() => {
  const state = {
    user: { id: 'student-a', role: 'student' } as { id: string; role: string },
    inserts: [] as { table: string; payload: unknown }[],
    updates: [] as { table: string; payload: unknown }[],
    uploads: [] as string[],
    reads: [] as string[],
    history: null as null | Array<{ sender_kind: string; content: string }>,
    failHistory: false,
  };

  // 课内身份：teacher-1 是创建者，admin-1 是平台管理员；其余（含 teacher-2 这个
  // 凭学生验证码入课的教师账号）都是普通成员
  const STANDING: Record<string, 'owner' | 'manager' | 'member'> = { 'teacher-1': 'owner', 'admin-1': 'owner' };

  // 组 B 空间里的一条笔记；组 A 的学生是它上面一条 AI 线程的参与者
  // （修之前开的，或者他后来换了组）——只查参与者和课程时，这条线程对他是敞开的。
  const SECRET = '第二组还没公开的草稿';
  const NOTE = {
    id: 'note-b', title: '第二组的笔记', content: `<p>${SECRET}：只有本组能看</p>`, space_id: 'space-b',
    spaces: { id: 'space-b', course_id: 'course-1' },
  };
  const THREAD = {
    id: 'thread-b', note_id: 'note-b', space_id: 'space-b', course_id: 'course-1', target_type: 'ai',
    group_id: null, target_user_id: null, provider_id: 'deepseek', model: 'deepseek-chat',
    title: 'GenAI · 第二组的笔记', created_by: 'student-a',
    created_at: '2026-09-28T00:00:00Z', updated_at: '2026-09-28T00:00:00Z',
  };
  const MESSAGES = [
    { id: 'm-1', thread_id: 'thread-b', sender_id: 'student-a', sender_kind: 'user', content: '帮我看看这条笔记', created_at: '2026-09-28T00:01:00Z' },
    { id: 'm-2', thread_id: 'thread-b', sender_id: null, sender_kind: 'assistant', content: `笔记里写的是：${SECRET}`, created_at: '2026-09-28T00:02:00Z' },
  ];

  type Action = 'select' | 'insert' | 'upsert' | 'update';
  type Terminal = 'single' | 'maybeSingle' | 'many';
  const ok = (data: unknown) => ({ data, error: null });

  const resultFor = (table: string, action: Action, payload: unknown, terminal: Terminal) => {
    if (action === 'update' || action === 'upsert') return ok(null);
    switch (table) {
      case 'notes':
        return ok(NOTE);
      case 'note_conversation_threads':
        if (action === 'insert') return ok({ ...THREAD, id: 'thread-new', ...(payload as object) });
        // getThread 用 single；POST 查重用 maybeSingle（没有已存在的线程）；列表是 many
        if (terminal === 'single') return ok(THREAD);
        if (terminal === 'maybeSingle') return ok(null);
        return ok([THREAD]);
      case 'note_conversation_participants':
        return terminal === 'many' ? ok([{ thread_id: 'thread-b' }]) : ok({ thread_id: 'thread-b' });
      case 'note_conversation_messages':
        if (action === 'insert') return ok({ id: 'msg-new', created_at: '2026-09-28T00:03:00Z', ...(payload as object) });
        return ok(MESSAGES);
      case 'course_members':
        // 组 A 的学生是这门课的成员：旧的「只查课程」在这里放行
        return ok({ course_id: 'course-1' });
      case 'teacher_ai_configs':
        if (terminal === 'many') return ok([{ provider_id: 'deepseek', api_key_encrypted: 'enc', enabled_models: ['deepseek-chat'], is_verified: true }]);
        return ok({ api_key_encrypted: 'enc', endpoint_url: null, is_verified: true, enabled_models: ['deepseek-chat'] });
      default:
        return ok(action === 'insert' ? { id: `${table}-new` } : null);
    }
  };

  // 链式调用照单全收，await / single / maybeSingle 时按表名、动作和取法给结果
  const from = (table: string) => {
    let action: Action = 'select';
    let payload: unknown;
    let historyLimit = Infinity;
    let historyOffset = 0;
    const run = (terminal: Terminal) => {
      if (action === 'select') state.reads.push(table);
      if (table === 'note_conversation_messages' && action === 'select' && state.history) {
        if (state.failHistory) return Promise.resolve({ data: null, error: { message: 'database unavailable' } });
        return Promise.resolve(ok([...state.history].reverse().slice(historyOffset, historyOffset + historyLimit)));
      }
      if (table === 'note_conversation_messages' && action === 'insert' && state.history) {
        state.history.push(payload as { sender_kind: string; content: string });
      }
      return Promise.resolve(resultFor(table, action, payload, terminal));
    };
    const write = (kind: Action, list: { table: string; payload: unknown }[]) => (p: unknown) => {
      action = kind;
      payload = p;
      list.push({ table, payload: p });
      return builder;
    };
    const builder: Record<string, unknown> = {
      insert: write('insert', state.inserts),
      upsert: write('upsert', state.inserts),
      update: write('update', state.updates),
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => run('many').then(onOk, onFail),
    };
    builder.range = (start: number, end: number) => { historyOffset = start; historyLimit = end - start + 1; return builder; };
    builder.limit = (n: number) => { historyLimit = n; return builder; };
    for (const m of ['select', 'eq', 'is', 'in', 'lt', 'not', 'or', 'order']) builder[m] = () => builder;
    return builder;
  };

  const storage = {
    from: () => ({
      upload: async (path: string) => {
        state.uploads.push(path);
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files.test/${path}` } }),
    }),
  };

  return {
    state,
    SECRET,
    from,
    storage,
    ensureSpaceAccess: vi.fn(async (_spaceId: string, user: { id: string }) => ({ standing: STANDING[user.id] ?? 'member' })),
    getToolsForRole: vi.fn((_role: string) => [] as unknown[]),
    /** 每次调模型返回下一段：一串 [文字, finish_reason]，按 OpenAI 流式格式吐出来 */
    streams: [] as Array<{ text: string; finish: string }>,
    aiBodies: [] as Array<Record<string, any>>,
    aiFetch: vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}');
      (globalThis as any).__aiBodies.push(body);
      const next = (globalThis as any).__streams.shift() ?? { text: '', finish: 'stop' };
      const lines = [
        ...Array.from(next.text as string).map((ch: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}`),
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: next.finish }] })}`,
        'data: [DONE]',
      ];
      return new Response(new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          for (const line of lines) controller.enqueue(enc.encode(`${line}\n\n`));
          controller.close();
        },
      }), { status: 200 });
    }),
    runAgentLoopStream: vi.fn((_opts: { systemPrompt: string; maxTokens: number }) => (async function* () {
      yield { type: 'tool_call', toolCall: { id: 'tc-1', type: 'function', function: { name: 'search_notes', arguments: '{}' } } };
      yield { type: 'tool_result', toolCallId: 'tc-1', toolName: 'search_notes', result: { success: true, data: { notes: [{}, {}, {}] } } };
      yield { type: 'token', content: 'AI 的回复' };
      yield { type: 'done', result: { content: 'AI 的回复', toolCalls: [], iterations: 1, finishReason: 'completed', continuations: 1 } };
    })()),
    buildAgentContext: vi.fn(async (p: { note: { content: string }; history: unknown[] }) => ({
      systemPrompt: `note: ${p.note.content}`,
      messages: p.history,
      toolContext: {},
      overrelianceDetected: false,
    })),
    generateNoteImage: vi.fn(async () => ({ ok: true, url: 'https://img.test/a.png', model: 'img-model', provider: 'img' })),
  };
});


vi.mock('../config/supabase', () => ({ supabase: { from: h.from, storage: h.storage } }));
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
vi.mock('../services/aiGateway', () => ({ aiFetch: h.aiFetch }));
vi.mock('../services/aiProviderConfig', () => ({
  decryptProviderApiKey: () => 'sk-test',
  listCourseAiConfigs: async () => [{ providerId: 'deepseek' }],
  normalizeDeepSeekModel: (model: string) => model,
  usesDeepSeekModelAliases: () => false,
  withDeepSeekOptions: (_provider: string, _model: string, body: unknown) => body,
  withFastChatOptions: (_provider: string, _model: string, body: unknown) => body,
}));
vi.mock('../services/agentLoop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/agentLoop')>()),
  runAgentLoopStream: h.runAgentLoopStream,
}));
vi.mock('../services/agentContext', () => ({
  buildAgentContext: h.buildAgentContext,
  updateProfileAfterInteraction: async () => {},
}));
vi.mock('../services/agentTools', () => ({
  createDefaultRegistry: () => ({ getToolsForRole: h.getToolsForRole, executeTool: async () => ({ success: false, data: null }) }),
}));
vi.mock('../services/knowledgeBase', () => ({
  searchKnowledgeBase: async () => [],
  searchKnowledgeBaseDetailed: async () => ({ hits: [], semantic: true, reranked: false }),
  // 这门课没有入库的资料：笔记 AI 不检索，过程里也没有这一步（检索那一半见 knowledgeBaseScope.test.ts）
  courseHasKnowledgeBase: async () => false,
}));
vi.mock('../services/embeddingService', () => ({ embedNote: async () => {} }));
vi.mock('../services/tavilySearch', () => ({
  callTavilySearch: async () => ({ results: [] }),
  formatTavilyResultsForPrompt: () => '',
}));
vi.mock('../services/noteImage', () => ({ generateNoteImage: h.generateNoteImage }));

import noteConversationsRouter from './noteConversations';
import { errorHandler } from '../middleware/errorHandler';
import { CONTINUE_PROMPT } from '../services/agentLoop';

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
  h.state.user = { id: 'student-a', role: 'student' };
  h.state.inserts.length = 0;
  h.state.history = null;
  h.state.failHistory = false;
  (globalThis as any).__streams = [];
  (globalThis as any).__aiBodies = [];
  h.ensureSpaceAccess.mockReset();
  h.aiFetch.mockClear();
  h.runAgentLoopStream.mockClear();
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

const ASK = { content: '比较一下重读和回想哪种更有效', provider_id: 'deepseek', model: 'deepseek-chat' };
const savedReply = () => h.state.inserts
  .filter(i => i.table === 'note_conversation_messages')
  .map(i => i.payload as Record<string, any>)
  .find(p => p.sender_kind === 'assistant')!;

describe('自由提问（ai/stream）', () => {
  it('写到上限被截住：接着写一段，拼成完整的回答；第二次请求带上已写的部分和「接着写」', async () => {
    (globalThis as any).__streams = [{ text: '回想更有效，因为', finish: 'length' }, { text: '每次回想都在加固记忆。', finish: 'stop' }];
    const res = await post('/note-conversations/thread-b/ai/stream', { ...ASK, agent_mode: 'free_ask', answer_length: 'short' });

    expect(res.status).toBe(200);
    const bodies = (globalThis as any).__aiBodies as Array<Record<string, any>>;
    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages.slice(-2)).toEqual([
      { role: 'assistant', content: '回想更有效，因为' },
      { role: 'user', content: CONTINUE_PROMPT },
    ]);
    // 档位写进提示词；DeepSeek 先思考，max_tokens 多留
    expect(bodies[0].messages[0].content).toContain('the student chose "brief"');
    expect(bodies[0].max_tokens).toBeGreaterThan(4000);

    const reply = savedReply();
    expect(reply.content).toBe('回想更有效，因为每次回想都在加固记忆。');
    expect(reply.ai_metadata.answer_length).toMatchObject({ preset: 'short', depth: 2, continuations: 1 });
    expect(reply.ai_metadata.tool_steps).toEqual([]);
    expect(typeof reply.ai_metadata.elapsed_ms).toBe('number');
  });

  it('没被截住：只发一次', async () => {
    (globalThis as any).__streams = [{ text: '一段完整的回答。', finish: 'stop' }];
    await post('/note-conversations/thread-b/ai/stream', { ...ASK, agent_mode: 'free_ask' });
    expect((globalThis as any).__aiBodies).toHaveLength(1);
    expect(savedReply().ai_metadata.answer_length).toMatchObject({ preset: 'medium' });
    expect(savedReply().ai_metadata.answer_length.continuations).toBeUndefined();
  });
});

describe('智能体（ai/agent-stream）', () => {
  it('每一步推结果摘要和用时，存进回答；长度写进提示词，max_tokens 按目标', async () => {
    const res = await post('/note-conversations/thread-b/ai/agent-stream', { ...ASK, agent_mode: 'idea_coach', answer_length: 'long' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('"toolSummary":"找到 3 条相关笔记"');
    const opts = h.runAgentLoopStream.mock.calls[0][0] as { systemPrompt: string; maxTokens: number };
    expect(opts.systemPrompt).toContain('the student chose "detailed"');
    expect(opts.maxTokens).toBeGreaterThan(4000);

    const reply = savedReply();
    expect(reply.ai_metadata.tool_steps).toEqual([expect.objectContaining({ name: 'search_notes', summary: '找到 3 条相关笔记' })]);
    expect(reply.ai_metadata.answer_length).toMatchObject({ preset: 'long', continuations: 1 });
  });
});


describe('同一 Note 的连续追问', () => {
  it.each(['ai/stream', 'ai/agent-stream'])('%s: 第八轮仍带上第一轮的完整要求', async endpoint => {
    h.state.history = [
      { sender_kind: 'user', content: '主题是蒸发。请面向七年级 7B 班，安排 35 分钟的课堂。' },
      { sender_kind: 'assistant', content: '可以比较盖住和敞开的水杯。' },
      ...Array.from({ length: 12 }, (_, i) => ({ sender_kind: i % 2 ? 'assistant' : 'user', content: `讨论 ${i}` })),
    ];
    (globalThis as any).__streams = [{ text: '沿用前面要求', finish: 'stop' }];
    const res = await post(`/note-conversations/thread-b/${endpoint}`, { ...ASK, content: '沿用上面的班级和时长', agent_mode: 'free_ask' });
    expect(res.status).toBe(200);
    const sent = endpoint === 'ai/stream'
      ? (globalThis as any).__aiBodies[0].messages
      : (h.runAgentLoopStream.mock.calls[0][0] as any).messages;
    expect(sent).toContainEqual({ role: 'user', content: '主题是蒸发。请面向七年级 7B 班，安排 35 分钟的课堂。' });
    expect(sent.at(-1)).toEqual({ role: 'user', content: '沿用上面的班级和时长' });
  });
  it.each(['ai/stream', 'ai/agent-stream'])('%s: 自由提问也接入当前学生的课程学习记录', async endpoint => {
    vi.mocked(loadStudentLearningContext).mockResolvedValueOnce('SOURCE my-own-note: 我正在比较蒸发实验');
    (globalThis as any).__streams = [{ text: '继续你的实验', finish: 'stop' }];
    const res = await post(`/note-conversations/thread-b/${endpoint}`, { ...ASK, agent_mode: 'free_ask' });
    expect(res.status).toBe(200);
    const prompt = endpoint === 'ai/stream' ? (globalThis as any).__aiBodies[0].messages[0].content : (h.runAgentLoopStream.mock.calls[0][0] as any).systemPrompt;
    expect(prompt).toContain('SOURCE my-own-note');
    expect(loadStudentLearningContext).toHaveBeenCalledWith({ userId: 'student-a', courseId: 'course-1', question: ASK.content });
  });
  it('读取历史失败时停止回答，避免把追问当新问题', async () => {
    h.state.history = [];
    h.state.failHistory = true;
    const res = await post('/note-conversations/thread-b/ai/stream', { ...ASK, agent_mode: 'free_ask' });
    expect(res.status).toBe(500);
    expect(h.aiFetch).not.toHaveBeenCalled();
  });
});
