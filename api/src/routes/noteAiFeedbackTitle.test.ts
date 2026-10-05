import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 采纳 AI 反馈后自动发布的那条笔记的标题（2026-10-05 用户：自动发的帖子要 AI 总结一个标题）。
 *
 * 以前从反馈正文里截引导问题当标题，线上是「你认同或质疑其中哪一条？」这样：对着「你」说话，
 * 放到公共画布上同学看不懂，超过 22 字还被截断。现在：
 *   - 生成反馈的那次调用顺便给出标题，洗过后存进 suggested_title；
 *   - 贡献时确认需要关联笔记后直接用它；没有的现场让模型起一个，并回写；
 *   - 模型也起不出来，才退回原来的截句办法。
 */

const h = vi.hoisted(() => {
  const state = {
    llmReplies: [] as Array<string | null>,
    feedbackRow: {} as Record<string, unknown>,
    noteContent: '<p>草稿</p>',
    noteUpdatedAt: '2026-10-05T01:00:00Z',
    noteAuthorId: 'student-1',
    changeDuringReview: false,
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    updates: [] as { table: string; payload: Record<string, unknown> }[],
    prompts: [] as string[],
  };

  const NOTE = {
    id: 'note-1', title: '数据与结论', content: '<p>草稿</p>', space_id: 'space-1', author_id: 'student-1',
    x: 100, y: 200, views: [], spaces: { id: 'space-1', course_id: 'course-1', group_id: 'group-1' },
  };

  const resultFor = (table: string, action: 'select' | 'insert' | 'update', payload?: Record<string, unknown>) => {
    if (table === 'notes' && action === 'select') return { data: { ...NOTE, content: state.noteContent, updated_at: state.noteUpdatedAt, author_id: state.noteAuthorId }, error: null, count: 3 };
    if (table === 'notes' && action === 'insert') return { data: { id: 'note-published', ...payload }, error: null };
    if (table === 'teacher_ai_configs') {
      return {
        data: [{
          provider_id: 'deepseek', api_key_encrypted: 'enc', endpoint_url: null, enabled_models: [],
          configured_at: '2026-09-01T00:00:00Z', trigger_settings: {},
        }],
        error: null,
      };
    }
    if (table === 'note_ai_feedbacks' && action === 'insert') return { data: { id: 'fb-new', created_at: '2026-10-05T00:00:00Z', ...payload }, error: null };
    if (table === 'note_ai_feedbacks' && action === 'update') { state.feedbackRow = { ...state.feedbackRow, ...payload }; return { data: state.feedbackRow, error: null }; }
    if (table === 'note_ai_feedbacks' && action === 'select') return { data: [state.feedbackRow], error: null };
    if (table === 'note_conversation_threads' && action === 'insert') return { data: { id: 'thread-1' }, error: null };
    return { data: null, error: null, count: 0 };
  };

  const from = (table: string) => {
    let action: 'select' | 'insert' | 'update' = 'select';
    let payload: Record<string, unknown> | undefined;
    const run = () => Promise.resolve(resultFor(table, action, payload));
    const builder: Record<string, unknown> = {
      insert: (p: Record<string, unknown>) => { action = 'insert'; payload = p; state.inserts.push({ table, payload: p }); return builder; },
      update: (p: Record<string, unknown>) => { action = 'update'; payload = p; state.updates.push({ table, payload: p }); return builder; },
      single: run,
      maybeSingle: run,
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    };
    for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit', 'gte', 'in']) builder[m] = () => builder;
    return builder;
  };

  const aiFetch = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
    state.prompts.push(body.messages[0].content);
    if (state.changeDuringReview) state.noteContent += '<p>学生在审核期间又保存了新的解释。</p>';
    const next = state.llmReplies.length > 0 ? state.llmReplies.shift()! : null;
    if (next === null) return { ok: false, json: async () => ({}), text: async () => 'upstream down' };
    return { ok: true, json: async () => ({ choices: [{ message: { content: next } }] }), text: async () => '' };
  });

  return { state, from, aiFetch };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'student-1', role: 'student', name: '学生甲' };
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
vi.mock('../services/noteHtml', () => ({ sanitizeNoteHtml: async (html: string) => html }));
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
  ensureSpaceAccess: vi.fn(async () => ({ standing: { role: 'student' } })),
  isCourseStaff: () => false,
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
  h.state.noteContent = '<p>草稿</p>';
  h.state.noteUpdatedAt = '2026-10-05T01:00:00Z';
  h.state.noteAuthorId = 'student-1';
  h.state.changeDuringReview = false;
  h.state.llmReplies = [];
  h.state.inserts.length = 0;
  h.state.updates.length = 0;
  h.state.prompts.length = 0;
  h.aiFetch.mockClear();
});

const FEEDBACK_TEXT = '你把编码对象定成了高阶思维。但还没说清用什么标准区分高阶与低阶表达。你打算用哪几个指标？';
const reply = (extra: Record<string, unknown>) => JSON.stringify({
  need: 1, type: 'T2', rationale: 'no criteria', feedback: FEEDBACK_TEXT, scaffold: '我区分高阶表达的标准是', ...extra,
});

async function requestFeedback() {
  const res = await fetch(`${base}/notes/note-1/ai-feedback/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '我打算对讨论区的笔记做编码，看学生有没有体现高阶思维，这样可以评估课程效果。' }),
  });
  expect(res.status).toBe(201);
  return h.state.inserts.find(i => i.table === 'note_ai_feedbacks')!.payload;
}

async function accept(row: Record<string, unknown>) {
  h.state.feedbackRow = {
    id: 'fb-1', note_id: 'note-1', space_id: 'space-1', course_id: 'course-1', user_id: 'student-1',
    provider_id: 'deepseek', model: 'deepseek-chat', trigger_type: 'no_reasoning', trigger_context: { source_text: '草稿', source_complete: true },
    draft_excerpt: '', feedback_text: FEEDBACK_TEXT, status: 'accepted', published_note_id: null,
    created_at: '2026-10-01T00:00:00Z', ...row,
  };
  const res = await fetch(`${base}/notes/note-1/ai-feedback/fb-1/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  });
  expect(res.status).toBe(200);
  expect(h.state.inserts.some(i => i.table === 'notes')).toBe(false);
  const finalized = await fetch(`${base}/notes/note-1/ai-feedback/finalize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(finalized.status).toBe(200);
  const published = h.state.inserts.find(i => i.table === 'notes')?.payload;
  const writeBack = h.state.updates.filter(u => u.table === 'note_ai_feedbacks').at(-1)?.payload;
  const event = h.state.inserts.find(i => i.table === 'events' && i.payload.event_type === 'ai_feedback_published')?.payload;
  return { published, writeBack, event };
}

describe('生成反馈时顺便起标题', () => {
  it('提示词里要了 title；模型给的标题洗过存进 suggested_title', async () => {
    h.state.llmReplies = [reply({ title: '「高阶思维的编码标准」' })];
    const row = await requestFeedback();
    expect(h.state.prompts[0]).toContain('"title":"note title or empty"');
    expect(row.suggested_title).toBe('高阶思维的编码标准');
    expect(row.trigger_context).toMatchObject({ source_complete: true, source_text: '我打算对讨论区的笔记做编码，看学生有没有体现高阶思维，这样可以评估课程效果。' });
  });

  it('模型给的是问句、对着「你」说：不存（采纳时再现场起）', async () => {
    h.state.llmReplies = [reply({ title: '你打算用哪几个指标？' })];
    expect((await requestFeedback()).suggested_title).toBeNull();
  });

  it('模型没给 title：不存', async () => {
    h.state.llmReplies = [reply({})];
    expect((await requestFeedback()).suggested_title).toBeNull();
  });
});

describe('采纳：发布的笔记用 AI 标题', () => {
  it('有存好的标题：直接用，不再调模型', async () => {
    const { published, writeBack, event } = await accept({ suggested_title: '高阶思维的编码标准' });
    expect(published!.title).toBe('高阶思维的编码标准');
    expect(h.aiFetch).not.toHaveBeenCalled();
    expect(writeBack).toMatchObject({ published_note_id: published!.id });
    expect((event!.metadata_json as Record<string, unknown>).title_source).toBe('suggested');
  });

  it('老反馈没有标题：现场让模型起一个，发布并回写', async () => {
    h.state.llmReplies = ['{"title":"区分高阶与低阶表达的标准"}'];
    const { published, writeBack, event } = await accept({ suggested_title: null });
    expect(published!.title).toBe('区分高阶与低阶表达的标准');
    expect(h.state.prompts[0]).toContain('posted as its own note on a class discussion board');
    expect(writeBack).toMatchObject({ published_note_id: published!.id, suggested_title: '区分高阶与低阶表达的标准' });
    expect((event!.metadata_json as Record<string, unknown>).title_source).toBe('generated');
  });

  it('现场起的也不合格、模型也挂了：退回从正文截句，不回写', async () => {
    h.state.llmReplies = ['{"title":"你打算用哪几个指标？"}', null];
    const { published, writeBack, event } = await accept({ suggested_title: null });
    expect(published!.title).toBe('你打算用哪几个指标？');
    expect(writeBack).toMatchObject({ published_note_id: published!.id });
    expect((event!.metadata_json as Record<string, unknown>).title_source).toBe('derived');
  });

  it('对话线程的标题和笔记一致', async () => {
    await accept({ suggested_title: '高阶思维的编码标准' });
    expect(h.state.inserts.find(i => i.table === 'note_conversation_threads')!.payload.title).toBe('高阶思维的编码标准');
  });
});

describe('贡献后检查反馈是否已在原 Note 中回应', () => {
  it('没有晚于反馈的保存记录时，不依据旧正文自动发布', async () => {
    h.state.noteUpdatedAt = '2026-09-30T01:00:00Z';
    const result = await accept({ suggested_title: '编码标准' });
    expect(result.published).toBeUndefined();
    expect(h.state.feedbackRow.trigger_context).toMatchObject({ publication_review: { state: 'uncertain' } });
    expect(h.aiFetch).not.toHaveBeenCalled();
  });
  it('审核期间正文再次保存时，旧判断不能触发发布', async () => {
    h.state.noteContent = '<p>草稿</p><p>小组今天安排了集合时间，并重新检查了每位同学的课程报名信息。</p>';
    h.state.changeDuringReview = true;
    h.state.llmReplies = [JSON.stringify({ addressed: false, evidence: '', reason: 'Unrelated addition' })];
    const result = await accept({ suggested_title: '编码标准' });
    expect(result.published).toBeUndefined();
    expect(h.state.feedbackRow.trigger_context).toMatchObject({ publication_review: { state: 'pending' } });
  });
  it('其他作者的 Note 不能由当前用户触发反馈发布', async () => {
    h.state.noteAuthorId = 'another-student';
    const result = await fetch(`${base}/notes/note-1/ai-feedback/finalize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(result.status).toBe(403);
    expect(h.state.inserts).toEqual([]);
  });
  it('保留学生的新解释，不发布重复 Note；再次贡献不重复判断', async () => {
    const evidence = '我将把比较、推理和证据整合作为高阶表达的指标，并使用两个编码者核查。';
    h.state.noteContent = `<p>草稿</p><p>${evidence}</p>`;
    h.state.llmReplies = [JSON.stringify({ addressed: true, evidence, reason: 'Added coding criteria and verification' })];
    const result = await accept({ suggested_title: '编码标准' });
    expect(result.published).toBeUndefined();
    expect(h.state.feedbackRow.trigger_context).toMatchObject({ publication_review: { state: 'addressed', evidence } });
    const calls=h.aiFetch.mock.calls.length;
    const repeat=await fetch(`${base}/notes/note-1/ai-feedback/finalize`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    expect(repeat.status).toBe(200); expect(h.aiFetch.mock.calls.length).toBe(calls);
    expect(h.state.inserts.some(row=>row.table==='notes')).toBe(false);
  });
  it('与反馈无关的补充仍可生成关联 Note', async () => {
    h.state.noteContent = '<p>草稿</p><p>今天小组安排了集合时间，并重新检查了每位同学的课程报名信息。</p>';
    h.state.llmReplies = [JSON.stringify({addressed:false,evidence:'',reason:'Unrelated administrative addition'})];
    const result=await accept({suggested_title:'高阶表达的判断标准'});
    expect(result.published?.title).toBe('高阶表达的判断标准');
  });
  it('缺少完整触发快照或判断失败时保留待核查，不自动发布', async () => {
    const result=await accept({trigger_context:{},suggested_title:'编码标准'});
    expect(result.published).toBeUndefined();
    expect(h.state.feedbackRow.trigger_context).toMatchObject({publication_review:{state:'uncertain'}});
  });
  it('AI 原文复制不算学生完善，生成关联 Note', async () => {
    h.state.noteContent=`<p>草稿</p><div data-ai-source="genai"><div>${FEEDBACK_TEXT}</div></div>`;
    const result=await accept({suggested_title:'编码标准'});
    expect(result.published).toBeDefined(); expect(h.aiFetch).not.toHaveBeenCalled();
  });
});
