import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 「使用帮助」教师也能用（2026-10-05 用户：教师端也要显示求助小球，一能看到学生的求助，二遇到技术问题能问 AI）。
 *
 *   - 教师（和管理员）问的：依据多了手册的「教师端」一章，规则换成教师版，存成 asker_role='teacher'；
 *     往届问答只看教师问过的，不分课程；
 *   - 教师问的不进课程的「学生求助」页，也只能由平台管理员回复；
 *   - 收件箱：调用者当教职的课里等回复的学生求助；管理员另外看到教师转来的。
 */

const COURSE_ID = '11111111-1111-4111-8111-111111111111';

type Filter = { op: string; col: string; val: unknown };
type Query = { table: string; action: string; filters: Filter[]; head: boolean };

const h = vi.hoisted(() => {
  const state = {
    user: { id: 'teacher-1', role: 'teacher' } as { id: string; role: string },
    configs: [] as Record<string, unknown>[],
    existing: null as Record<string, unknown> | null,
    standings: new Map<string, string>(),
    queries: [] as Query[],
    inserted: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    prompts: [] as string[],
    replies: [] as Array<{ status: number; content?: string }>,
    waiting: { student: [] as Record<string, unknown>[], teacher: [] as Record<string, unknown>[] },
  };

  const from = (table: string) => {
    const query: Query = { table, action: 'select', filters: [], head: false };
    let payload: Record<string, unknown> = {};
    const filterVal = (col: string) => query.filters.find(f => f.op === 'eq' && f.col === col)?.val;
    const result = (one = false) => {
      state.queries.push(query);
      if (table === 'teacher_ai_configs') return { data: state.configs, error: null };
      if (table === 'courses') return { data: one ? { instructor_id: 'teacher-1' } : [{ id: COURSE_ID }], error: null };
      if (table === 'support_questions' && query.action === 'insert') {
        const row = { id: `sq-${state.inserted.length + 1}`, created_at: '2026-10-05T01:00:00.000Z', ...payload };
        state.inserted.push(row);
        return { data: row, error: null };
      }
      if (table === 'support_questions' && query.action === 'update') {
        state.updates.push(payload);
        return { data: { ...state.existing, ...payload }, error: null };
      }
      if (table === 'support_questions' && filterVal('status') === 'escalated') {
        const rows = state.waiting[filterVal('asker_role') as 'student' | 'teacher'] ?? [];
        return { data: query.head ? null : rows, error: null, count: rows.length };
      }
      if (table === 'support_questions') return { data: one ? state.existing : [], error: null };
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      select: (_cols: string, opts?: { head?: boolean }) => { query.head = Boolean(opts?.head); return builder; },
      insert: (p: Record<string, unknown>) => { query.action = 'insert'; payload = p; return builder; },
      update: (p: Record<string, unknown>) => { query.action = 'update'; payload = p; return builder; },
      single: () => Promise.resolve(result(true)),
      maybeSingle: () => Promise.resolve(result(true)),
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, fail),
    };
    for (const op of ['eq', 'in', 'or', 'not', 'is']) {
      builder[op] = (col: string, val: unknown) => { query.filters.push({ op, col, val }); return builder; };
    }
    for (const m of ['order', 'limit']) builder[m] = () => builder;
    return builder;
  };

  const storage = {
    from: () => ({
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.test/object/public/note-chat-attachments/${path}` } }),
      upload: async () => ({ data: null, error: null }),
    }),
  };

  const aiFetch = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    state.prompts.push(body.messages[0].content);
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
  isCourseStaff: (standing: string | undefined) => standing === 'owner' || standing === 'manager',
  listCourseStandings: vi.fn(async () => h.state.standings),
}));
vi.mock('../services/aiGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/aiGateway')>()),
  aiFetch: h.aiFetch,
}));
vi.mock('../services/aiProviderConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/aiProviderConfig')>()),
  decryptProviderApiKey: (stored: string) => `plain-${stored}`,
}));

import supportRouter, { askerRoleOf } from './support';
import { errorHandler } from '../middleware/errorHandler';

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
    user: { id: 'teacher-1', role: 'teacher' },
    configs: [{ provider_id: 'deepseek', enabled_models: ['deepseek-v4-flash'], api_key_encrypted: 'enc', endpoint_url: null }],
    existing: null,
    standings: new Map<string, string>(),
    queries: [],
    inserted: [],
    updates: [],
    prompts: [],
    replies: [],
    waiting: { student: [], teacher: [] },
  });
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as Record<string, any> };
};

const ask = (question: string) => {
  h.state.replies = [{ status: 200, content: '在「AI 设置」里填。\nSOURCES: 14' }];
  return call('POST', '/support/questions', { course_id: COURSE_ID, question });
};

const precedentQuery = () => h.state.queries.find(q =>
  q.table === 'support_questions' && q.action === 'select' && q.filters.some(f => f.op === 'or'));
const hasFilter = (q: Query | undefined, op: string, col: string, val?: unknown) =>
  Boolean(q?.filters.some(f => f.op === op && f.col === col && (val === undefined || JSON.stringify(f.val) === JSON.stringify(val))));

describe('谁在问', () => {
  it('教师、管理员账号算教师；其余算学生', () => {
    expect(askerRoleOf('teacher')).toBe('teacher');
    expect(askerRoleOf('admin')).toBe('teacher');
    expect(askerRoleOf('student')).toBe('student');
    expect(askerRoleOf(undefined)).toBe('student');
  });
});

describe('POST /support/questions：教师问', () => {
  it('依据多了「教师端」一章，规则换成教师版；存成 asker_role=teacher', async () => {
    const { status, json } = await ask('API key 在哪里填？');

    expect(status).toBe(201);
    expect(h.state.inserted[0].asker_role).toBe('teacher');
    const prompt = h.state.prompts[0];
    expect(prompt).toContain('A teacher is asking');
    expect(prompt).toContain('转给平台管理员');
    expect(prompt).toMatch(/## 14 教师端/);
    // 来源行里的 14 是教师端那一章，教师问的时候认
    expect(json.question.context.grounding.manual.map((m: { num: string }) => m.num)).toEqual(['14']);
  });

  it('往届问答只看教师问过的，不按课程筛', async () => {
    await ask('怎么导出研究数据？');
    const q = precedentQuery();
    expect(hasFilter(q, 'eq', 'asker_role', 'teacher')).toBe(true);
    expect(hasFilter(q, 'in', 'course_id')).toBe(false);
  });
});

describe('POST /support/questions：学生问（照旧）', () => {
  it('学生版规则，手册里没有教师端；往届问答只看学生问过的、同一位老师的课', async () => {
    h.state.user = { id: 'student-1', role: 'student' };
    await ask('API key 在哪里填？');

    expect(h.state.inserted[0].asker_role).toBe('student');
    const prompt = h.state.prompts[0];
    expect(prompt).toContain('Students ask you how to use it');
    expect(prompt).not.toMatch(/## 14 教师端/);
    const q = precedentQuery();
    expect(hasFilter(q, 'eq', 'asker_role', 'student')).toBe(true);
    expect(hasFilter(q, 'in', 'course_id')).toBe(true);
  });
});

describe('课程的「学生求助」页不收教师问的', () => {
  it('列表和计数都只查 asker_role=student', async () => {
    const { status } = await call('GET', `/support/questions?course_id=${COURSE_ID}`);
    expect(status).toBe(200);
    const lists = h.state.queries.filter(q => q.table === 'support_questions' && q.action === 'select');
    expect(lists.length).toBe(2);
    for (const q of lists) expect(hasFilter(q, 'eq', 'asker_role', 'student')).toBe(true);
  });
});

describe('回复', () => {
  it('教师问的：别的老师不能回，平台管理员可以', async () => {
    h.state.existing = { id: 'sq-9', course_id: COURSE_ID, asker_role: 'teacher' };
    const asTeacher = await call('POST', '/support/questions/sq-9/answer', { answer: '在设置里' });
    expect(asTeacher.status).toBe(403);
    expect(h.state.updates).toHaveLength(0);

    h.state.user = { id: 'admin-1', role: 'admin' };
    const asAdmin = await call('POST', '/support/questions/sq-9/answer', { answer: '在设置里' });
    expect(asAdmin.status).toBe(200);
    expect(h.state.updates[0]).toMatchObject({ teacher_answer: '在设置里', status: 'teacher_answered' });
  });

  it('学生问的：课程老师照旧可以回', async () => {
    h.state.existing = { id: 'sq-8', course_id: COURSE_ID, asker_role: 'student' };
    const res = await call('POST', '/support/questions/sq-8/answer', { answer: '点右上角' });
    expect(res.status).toBe(200);
  });
});

describe('GET /support/inbox：小球里的「学生求助」', () => {
  const row = (id: string, course: string) => ({
    id, course_id: course, user_id: 'student-1', question: '笔记不见了', status: 'escalated', asker_role: 'student',
    profiles: { full_name: '林晓' }, courses: { id: course, title: '人工智能与学习' }, created_at: '2026-10-05T01:00:00.000Z',
  });

  it('只列我当教职的课里等回复的学生求助，带课程名和学生姓名', async () => {
    h.state.standings = new Map([['c-own', 'owner'], ['c-co', 'manager'], ['c-member', 'member']]);
    h.state.waiting.student = [row('sq-1', 'c-own')];
    const { status, json } = await call('GET', '/support/inbox');

    expect(status).toBe(200);
    expect(json.counts).toEqual({ student: 1, teacher: 0 });
    expect(json.student[0]).toMatchObject({ id: 'sq-1', courseTitle: '人工智能与学习', userName: '林晓', askerRole: 'student' });
    expect(json.teacher).toEqual([]);
    const studentQuery = h.state.queries.find(q => hasFilter(q, 'eq', 'asker_role', 'student') && !q.head)!;
    expect(hasFilter(studentQuery, 'in', 'course_id', ['c-own', 'c-co'])).toBe(true);
    // 普通教师看不到别的老师转给管理员的问题
    expect(h.state.queries.some(q => hasFilter(q, 'eq', 'asker_role', 'teacher'))).toBe(false);
  });

  it('平台管理员另外看到教师转来的问题', async () => {
    h.state.user = { id: 'admin-1', role: 'admin' };
    h.state.waiting.teacher = [{ ...row('sq-7', 'c-x'), asker_role: 'teacher' }];
    const { json } = await call('GET', '/support/inbox');
    expect(json.counts.teacher).toBe(1);
    expect(json.teacher[0]).toMatchObject({ id: 'sq-7', askerRole: 'teacher' });
  });

  it('一门课都不教：不查学生求助，返回空', async () => {
    const { json } = await call('GET', '/support/inbox');
    expect(json).toMatchObject({ student: [], counts: { student: 0 } });
    expect(h.state.queries.filter(q => q.table === 'support_questions')).toHaveLength(0);
  });

  it('学生账号：403', async () => {
    h.state.user = { id: 'student-1', role: 'student' };
    const { status } = await call('GET', '/support/inbox');
    expect(status).toBe(403);
  });
});
