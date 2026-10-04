import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 求助的回答以学生版使用手册为依据，用课程里最快的那家模型答，一家失败换下一家。
 * 这里挂真的路由，数据库和模型接口是假的，看发出去的请求和存下来的那一行。
 */

const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const PUBLIC = 'https://storage.example.test/object/public/note-chat-attachments';

const h = vi.hoisted(() => {
  const state = {
    user: { id: 'student-1', role: 'student' as const },
    configs: [] as Record<string, unknown>[],
    inserted: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    existing: null as Record<string, unknown> | null,
    calls: [] as Array<{ url: string; body: Record<string, any>; opts: Record<string, unknown> }>,
    replies: [] as Array<{ status: number; content?: string }>,
  };

  const from = (table: string) => {
    let action: 'select' | 'insert' | 'update' = 'select';
    let payload: Record<string, unknown> = {};
    const result = (one = false) => {
      if (table === 'teacher_ai_configs') return { data: state.configs, error: null };
      if (table === 'courses') return { data: one ? { instructor_id: 'teacher-1' } : [{ id: 'course-other' }], error: null };
      if (table === 'support_questions' && action === 'insert') {
        const row = { id: `sq-${state.inserted.length + 1}`, created_at: '2026-09-29T01:00:00.000Z', updated_at: '2026-09-29T01:00:00.000Z', ...payload };
        state.inserted.push(row);
        return { data: row, error: null };
      }
      if (table === 'support_questions' && action === 'update') {
        state.updates.push(payload);
        return { data: { ...state.existing, ...payload }, error: null };
      }
      if (table === 'support_questions') return { data: one ? state.existing : [], error: null };
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      insert: (p: Record<string, unknown>) => { action = 'insert'; payload = p; return builder; },
      update: (p: Record<string, unknown>) => { action = 'update'; payload = p; return builder; },
      single: () => Promise.resolve(result(true)),
      maybeSingle: () => Promise.resolve(result(true)),
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, fail),
    };
    for (const m of ['select', 'eq', 'in', 'or', 'not', 'order', 'limit', 'is']) builder[m] = () => builder;
    return builder;
  };

  const storage = {
    from: () => ({
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.test/object/public/note-chat-attachments/${path}` } }),
      upload: async () => ({ data: null, error: null }),
    }),
  };

  const aiFetch = async (url: string, init: RequestInit, opts: Record<string, unknown>) => {
    state.calls.push({ url, body: JSON.parse(String(init.body)), opts });
    const reply = state.replies.shift() ?? { status: 500 };
    if (reply.status !== 200) return new Response('upstream says no', { status: reply.status });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply.content } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  return { state, supabase: { from, storage }, aiFetch };
});

vi.mock('../config/supabase', () => ({ supabase: h.supabase }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = h.state.user; next(); },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/accessControl', () => ({
  ensureCourseMember: vi.fn(async () => {}),
  ensureCourseInstructor: vi.fn(async () => {}),
}));
vi.mock('../services/aiGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/aiGateway')>()),
  aiFetch: h.aiFetch,
}));
vi.mock('../services/aiProviderConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/aiProviderConfig')>()),
  decryptProviderApiKey: (stored: string) => `plain-${stored}`,
}));

import supportRouter, { describeContext, supportModelFor } from './support';
import { errorHandler } from '../middleware/errorHandler';
import { CHAT_ENDPOINTS } from '../services/providerEndpoints';
import { STUDENT_MANUAL } from '../services/supportManualData';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', supportRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise(done => server.close(done));
});

beforeEach(() => {
  Object.assign(h.state, {
    user: { id: 'student-1', role: 'student' },
    configs: [],
    inserted: [],
    updates: [],
    existing: null,
    calls: [],
    replies: [],
  });
});

const config = (provider_id: string, enabled_models: string[]) => ({
  provider_id, enabled_models, api_key_encrypted: `enc-${provider_id}`, endpoint_url: null,
});

async function ask(body: Record<string, unknown>) {
  const res = await fetch(`${base}/support/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ course_id: COURSE_ID, ...body }),
  });
  return { status: res.status, json: await res.json() as { question: Record<string, any> } };
}

describe('POST /support/questions', () => {
  it('用快速档模型、以整本学生手册为依据作答，来源行不给学生看', async () => {
    h.state.configs = [config('deepseek', ['deepseek-v4-pro', 'deepseek-flash'])];
    h.state.replies = [{ status: 200, content: '1. 写完点右下角「贡献」。\n2. 笔记页不会自动保存。\nSOURCES: 04, 15' }];

    const { status, json } = await ask({
      question: '写完的笔记怎么保存？',
      context: { path: `/workspace/${COURSE_ID}/note/n-1`, surface: 'note-editor', viewport: { w: 1440, h: 900 } },
    });

    expect(status).toBe(201);
    expect(json.question.aiAnswer).toBe('1. 写完点右下角「贡献」。\n2. 笔记页不会自动保存。');
    expect(json.question.status).toBe('ai_answered');

    const call = h.state.calls[0];
    expect(call.url).toBe(CHAT_ENDPOINTS.deepseek);
    expect(call.body.model).toBe('deepseek-flash');
    expect(call.body.thinking).toEqual({ type: 'disabled' });
    expect(call.opts.label).toBe('support');

    const system = call.body.messages[0].content as string;
    expect(system).toContain('Answer only from the student user manual');
    // 整本手册都在，包括和这个问题不相干的章节
    for (const chunk of [STUDENT_MANUAL[0], STUDENT_MANUAL[STUDENT_MANUAL.length - 1]]) {
      expect(system).toContain(chunk.text.zh);
    }
    expect(system).toContain('Page: the note page');
    expect(system).toContain('SOURCES:');
    expect(call.body.messages[1]).toEqual({ role: 'user', content: '写完的笔记怎么保存？' });

    const stored = h.state.inserted[0].context as Record<string, any>;
    expect(stored.grounding.manual).toEqual([
      { num: '04', title: '写一条笔记' },
      { num: '15', title: '常见问题' },
    ]);
    expect(stored.grounding.covered).toBe(true);
    expect(stored.path).toBe(`/workspace/${COURSE_ID}/note/n-1`);
  });

  it('手册没写到时照实说，仍然算 AI 答了，由学生决定要不要转老师', async () => {
    h.state.configs = [config('deepseek', ['deepseek-flash'])];
    h.state.replies = [{ status: 200, content: '使用手册里没有写到这个问题，可以点下面的「转给老师」。\nSOURCES: NONE' }];

    const { json } = await ask({ question: '能不能把画布导出成 PDF？' });

    expect(json.question.aiAnswer).toBe('使用手册里没有写到这个问题，可以点下面的「转给老师」。');
    expect(json.question.status).toBe('ai_answered');
    expect(json.question.context.grounding).toMatchObject({ manual: [], covered: false });
  });

  it('第一家失败就换下一家；Kimi 只收 temperature=1', async () => {
    h.state.configs = [config('zhipu', ['glm-5.3', 'glm-5.3-flash']), config('moonshot', ['kimi-k3', 'kimi-k2.6'])];
    h.state.replies = [{ status: 500 }, { status: 200, content: '点「建立于此」。\nSOURCES: 05' }];

    const { json } = await ask({ question: '怎么接着同学的笔记写？' });

    expect(h.state.calls.map(c => c.body.model)).toEqual(['glm-5.3-flash', 'kimi-k2.6']);
    expect(h.state.calls[1].body.temperature).toBe(1);
    expect(json.question.aiProvider).toBe('moonshot');
    expect(json.question.aiAnswer).toBe('点「建立于此」。');
  });

  it('全都答不上来就直接转老师，不存回答依据', async () => {
    h.state.configs = [config('alibaba', ['qwen3.8-flash'])];
    h.state.replies = [{ status: 503 }];

    const { json } = await ask({ question: '点了没反应', context: { grounding: { covered: true } } });

    expect(json.question.status).toBe('escalated');
    expect(json.question.aiAnswer).toBeNull();
    // 客户端伪造的 grounding 不会落库
    expect((h.state.inserted[0].context as Record<string, unknown>).grounding).toBeUndefined();
  });

  it('带截图时用看得见图的模型，图片跟着问题发过去', async () => {
    h.state.configs = [config('deepseek', ['deepseek-flash'])];
    h.state.replies = [{ status: 200, content: '截图里是笔记页的「撰写」页签。\nSOURCES: 04' }];
    const shot = { file_url: `${PUBLIC}/support/c/u/1-a.png`, file_name: 'a.png', mime_type: 'image/png' };

    await ask({ question: '这个按钮是干什么的？', attachments: [shot] });

    const user = h.state.calls[0].body.messages[1];
    expect(user.content).toEqual([
      { type: 'text', text: '这个按钮是干什么的？' },
      { type: 'image_url', image_url: { url: shot.file_url } },
    ]);
    expect(h.state.calls[0].body.messages[0].content).not.toContain('cannot see');
  });

  it('课程没配 AI 时不调模型，直接转老师', async () => {
    const { json } = await ask({ question: '怎么改密码？' });
    expect(h.state.calls).toHaveLength(0);
    expect(json.question.status).toBe('escalated');
  });
});

describe('PATCH /support/questions/:id —— 转给老师', () => {
  it('本人可以转，带上补充说明', async () => {
    h.state.existing = { id: 'sq-1', user_id: 'student-1', course_id: COURSE_ID, status: 'ai_answered' };
    const res = await fetch(`${base}/support/questions/sq-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escalate: true, note: '按了还是不行' }),
    });
    expect(res.status).toBe(200);
    expect(h.state.updates[0]).toMatchObject({ status: 'escalated', ai_resolved: false, escalation_note: '按了还是不行' });
  });

  it('别人的求助改不了', async () => {
    h.state.existing = { id: 'sq-1', user_id: 'someone-else', course_id: COURSE_ID, status: 'ai_answered' };
    const res = await fetch(`${base}/support/questions/sq-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escalate: true }),
    });
    expect(res.status).toBe(403);
    expect(h.state.updates).toHaveLength(0);
  });
});

describe('选模型与描述处境', () => {
  it('优先教师勾选里的快速档，旧名字先归一', () => {
    expect(supportModelFor('zhipu', ['glm-5.3', 'glm-5.3-flash'])).toBe('glm-5.3-flash');
    expect(supportModelFor('deepseek', ['deepseek-v4-pro', 'deepseek-v4-flash'])).toBe('deepseek-flash');
    expect(supportModelFor('zhipu', ['glm-5.3'])).toBe('glm-5.3');
    expect(supportModelFor('openai', ['gpt-5.5', 'gpt-5-mini'])).toBe('gpt-5-mini');
  });

  it('处境写成几行人话：页面、窗口宽度、提问前的报错', () => {
    const text = describeContext({
      surface: 'document',
      path: '/workspace/c/abc',
      viewport: { w: 390, h: 800 },
      userAgent: 'Mozilla/5.0',
      recentFailures: [{ at: 'x', kind: 'api', detail: 'PUT /notes/n-1 → 500 boom' }],
    });
    expect(text).toContain('Page: the document reading page');
    expect(text).toContain('Window width: 390px (phone)');
    expect(text).toContain('PUT /notes/n-1 → 500 boom');
    expect(text).not.toContain('Mozilla');
    expect(describeContext({ surface: '<script>' })).toBe('');
  });
});
