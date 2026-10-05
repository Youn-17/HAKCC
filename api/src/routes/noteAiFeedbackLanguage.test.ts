import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 教师触发设置里的「AI 响应语言」以前存下了却从没被反馈代码读过。
 * 现在它只覆盖量规里「与学生同语言」那一条：
 *   - auto 时提示词与接入之前逐字相同；
 *   - zh / en 时追加一条语言指令，反馈和话头都用这种语言；模型给的话头语言不对就换兜底；
 *   - 模型失败时的兜底反馈跟着语言走（以前只有中文）。
 * EFA 三步、字数上限、JSON 输出格式不受影响。
 */

const h = vi.hoisted(() => {
  const state = {
    triggerSettings: {} as Record<string, unknown>,
    llmReply: '' as string | null,
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    systemPrompts: [] as string[],
  };

  const resultFor = (table: string, action: 'select' | 'insert', payload?: Record<string, unknown>) => {
    if (table === 'notes') {
      return {
        data: {
          id: 'note-1', title: 'Data and conclusions', content: '', space_id: 'space-1', author_id: 'student-1',
          spaces: { id: 'space-1', course_id: 'course-1', group_id: 'group-1' },
        },
        error: null,
        count: 3,
      };
    }
    if (table === 'teacher_ai_configs') {
      return {
        data: [{
          provider_id: 'deepseek', api_key_encrypted: 'enc', endpoint_url: null, enabled_models: [],
          configured_at: '2026-09-01T00:00:00Z', trigger_settings: state.triggerSettings,
        }],
        error: null,
      };
    }
    if (table === 'note_ai_feedbacks' && action === 'insert') {
      return { data: { id: 'fb-new', created_at: '2026-09-28T00:00:00Z', ...payload }, error: null };
    }
    return { data: null, error: null, count: 0 };
  };

  const from = (table: string) => {
    let action: 'select' | 'insert' = 'select';
    let payload: Record<string, unknown> | undefined;
    const run = () => Promise.resolve(resultFor(table, action, payload));
    const builder: Record<string, unknown> = {
      insert: (p: Record<string, unknown>) => {
        action = 'insert';
        payload = p;
        state.inserts.push({ table, payload: p });
        return builder;
      },
      single: run,
      maybeSingle: run,
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    };
    for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit', 'gte', 'in', 'update']) builder[m] = () => builder;
    return builder;
  };

  const aiFetch = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
    state.systemPrompts.push(body.messages[0].content);
    if (state.llmReply === null) return { ok: false, json: async () => ({}), text: async () => 'upstream down' };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: state.llmReply } }] }),
      text: async () => '',
    };
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
vi.mock('../services/modelRouter', () => ({
  isDmxProvider: () => false,
  pickModels: () => [],
  pickNativeModel: () => 'deepseek-chat',
  orderConfigsByHealth: (configs: unknown[]) => configs,
  reportModelFailure: () => {},
  reportModelSuccess: () => {},
  reportProviderFailure: () => {},
  reportProviderSuccess: () => {},
  classifyHttpFailure: () => 'other',
}));
vi.mock('../services/accessControl', () => ({
  ensureCourseInstructor: vi.fn(async () => {}),
  ensureSpaceAccess: vi.fn(async () => ({ id: 'space-1', course_id: 'course-1', group_id: 'group-1' })),
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

beforeEach(() => {
  h.state.triggerSettings = {};
  h.state.inserts.length = 0;
  h.state.systemPrompts.length = 0;
  h.aiFetch.mockClear();
});

const ZH_DRAFT = '<p>我认为数据越多，模型得出的结论就一定越可靠，所以以后做任何判断只要把数据量堆上去就行了。</p>';
const EN_DRAFT = '<p>I think more data always makes a model more reliable, so every decision should just pile on more data.</p>';
const DIRECTIVE = 'LANGUAGE (set by the teacher)';

const reply = (feedback: string, scaffold: string) => JSON.stringify({ need: 1, type: 'T3', rationale: 'claim', feedback, scaffold });

async function request(content: string) {
  const res = await fetch(`${base}/notes/note-1/ai-feedback/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  expect(res.status).toBe(201);
  const row = h.state.inserts.find(i => i.table === 'note_ai_feedbacks')!.payload;
  return { row, prompt: h.state.systemPrompts[0] };
}

describe('AI 响应语言', () => {
  it('auto（默认）：不追加任何语言指令，提示词与接入之前相同', async () => {
    h.state.llmReply = reply('你给出了清楚的结论。还缺一条依据。能补一个例子吗？', '支持这一点的依据是');
    const { row, prompt } = await request(ZH_DRAFT);
    expect(prompt).not.toContain(DIRECTIVE);
    expect(prompt).toContain('Use the same language as the student');
    expect(row.suggested_scaffold).toBe('支持这一点的依据是');
  });

  it('en：追加英文指令，量规的其余约定原样保留', async () => {
    h.state.triggerSettings = { response_language: 'en' };
    h.state.llmReply = reply('You state a clear conclusion. It lacks support. Can you add one example?', 'The evidence for this is');
    const { row, prompt } = await request(ZH_DRAFT);
    expect(prompt).toContain(`${DIRECTIVE}: write "feedback", "scaffold" and "title" in English`);
    expect(prompt).toContain('HARD LIMITS: 3 sentences max');
    expect(prompt).toContain('return ONLY this JSON object');
    expect(row.feedback_text).toBe('You state a clear conclusion. It lacks support. Can you add one example?');
    expect(row.suggested_scaffold).toBe('The evidence for this is');
  });

  it('zh：追加中文指令', async () => {
    h.state.triggerSettings = { response_language: 'zh' };
    h.state.llmReply = reply('你给出了清楚的结论。还缺一条依据。能补一个例子吗？', '支持这一点的依据是');
    const { prompt } = await request(EN_DRAFT);
    expect(prompt).toContain(`${DIRECTIVE}: write "feedback", "scaffold" and "title" in Simplified Chinese`);
  });

  it('指定了 en 而模型给了中文话头：话头会插进学生的笔记，换成英文兜底', async () => {
    h.state.triggerSettings = { response_language: 'en' };
    h.state.llmReply = reply('You state a clear conclusion. It lacks support. Can you add one example?', '支持这一点的依据是');
    const { row } = await request(ZH_DRAFT);
    expect(row.suggested_scaffold).toBe('The evidence for this is');
  });

  it('模型失败时的兜底反馈跟着语言走：指定 en 就是英文', async () => {
    h.state.triggerSettings = { response_language: 'en' };
    h.state.llmReply = null;
    const { row } = await request(ZH_DRAFT);
    expect(row.feedback_text).toMatch(/^This idea has potential\./);
    expect(row.suggested_scaffold).toBe('If this idea holds, then');
  });

  it('auto 下兜底按学生的语言：中文笔记仍是原来的中文兜底，英文笔记不再收到中文', async () => {
    h.state.llmReply = null;
    const zh = await request(ZH_DRAFT);
    expect(zh.row.feedback_text).toMatch(/^这个想法很有潜力/);

    h.state.inserts.length = 0;
    h.state.systemPrompts.length = 0;
    const en = await request(EN_DRAFT);
    expect(en.row.feedback_text).toMatch(/^This idea has potential\./);
  });
});
