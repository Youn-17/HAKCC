import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 附件进的是课程级知识库，检索原先只按课程过滤：绑定小组的空间里上传的附件，别组学生经
 * 笔记 AI 对话（系统提示里的课程材料段）和智能体工具 search_course_materials 都检索得到——
 * 整群随机实验的组间隔离漏在这里。现在按调用者进得去的空间检索：课程资料全课可见，
 * 附件跟着空间走，课程教职照旧看全部，不在课里的人什么都拿不到。
 *
 * accessControl、knowledgeBase、智能体工具和笔记对话路由都用真的，只替换数据库、鉴权、
 * 向量服务和模型调用。数据库里的检索函数按最新一版（067）的 SQL 语义模拟，末尾的静态约束把两边锁在一起。
 * 已删附件的那一半在 knowledgeBaseDeletedNotes.test.ts。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const TEXT = {
    material: '课程大纲：第三周讨论知识建构的十二条原则',
    shared: '全班共读：Scardamalia 与 Bereiter 1994 年的文章',
    groupA: '第一组整理的访谈记录',
    groupB: '第二组还没公开的实验方案',
    otherCourse: '另一门课的讲义',
  };
  const T = (day: number) => `2026-09-0${day}T00:00:00Z`;
  const seed = (): Record<string, Row[]> => ({
    courses: [
      { id: 'course-1', instructor_id: 'owner-1' },
      { id: 'course-2', instructor_id: 'owner-2' },
    ],
    spaces: [
      { id: 'space-shared', course_id: 'course-1', group_id: null, created_at: T(1) },
      { id: 'space-a', course_id: 'course-1', group_id: 'group-a', created_at: T(2) },
      { id: 'space-b', course_id: 'course-1', group_id: 'group-b', created_at: T(3) },
      { id: 'space-other', course_id: 'course-2', group_id: null, created_at: T(1) },
    ],
    course_members: [
      { course_id: 'course-1', user_id: 'owner-1', role: 'teacher' },
      { course_id: 'course-1', user_id: 'co-teacher', role: 'teacher' }, // 课程管理员
      { course_id: 'course-1', user_id: 'teacher-joined', role: 'student' }, // 教师账号凭学生验证码入课
      { course_id: 'course-1', user_id: 'teacher-invited', role: 'member' }, // 被邀请、还没设为管理员
      { course_id: 'course-1', user_id: 'student-a', role: 'student' },
      { course_id: 'course-1', user_id: 'student-b', role: 'student' },
      { course_id: 'course-1', user_id: 'student-forged', role: 'teacher' }, // 学生账号给自己写的管理员行
      { course_id: 'course-2', user_id: 'outsider', role: 'student' },
    ],
    group_members: [
      { group_id: 'group-a', user_id: 'student-a' },
      { group_id: 'group-a', user_id: 'teacher-joined' },
      { group_id: 'group-b', user_id: 'student-b' },
    ],
    kb_documents: [
      { id: 'doc-material', course_id: 'course-1', space_id: null, material_id: 'material-1', note_id: null, title: '课程大纲' },
      { id: 'doc-shared', course_id: 'course-1', space_id: 'space-shared', material_id: null, note_id: 'note-shared-file', title: '共读文章' },
      { id: 'doc-a', course_id: 'course-1', space_id: 'space-a', material_id: null, note_id: 'note-a-file', title: '第一组的附件' },
      { id: 'doc-b', course_id: 'course-1', space_id: 'space-b', material_id: null, note_id: 'note-b-file', title: '第二组的附件' },
      { id: 'doc-other', course_id: 'course-2', space_id: 'space-other', material_id: null, note_id: 'note-other-file', title: '另一门课的附件' },
    ],
    // score 代替向量距离：别组的附件和问题最相关，只按课程过滤时它排第一
    kb_chunks: [
      { id: 'chunk-material', document_id: 'doc-material', course_id: 'course-1', heading_path: null, content: TEXT.material, embedding: '[0.1]', score: 0.5 },
      { id: 'chunk-shared', document_id: 'doc-shared', course_id: 'course-1', heading_path: null, content: TEXT.shared, embedding: '[0.1]', score: 0.6 },
      { id: 'chunk-a', document_id: 'doc-a', course_id: 'course-1', heading_path: '访谈', content: TEXT.groupA, embedding: '[0.1]', score: 0.7 },
      { id: 'chunk-b', document_id: 'doc-b', course_id: 'course-1', heading_path: '方案', content: TEXT.groupB, embedding: '[0.1]', score: 0.9 },
      { id: 'chunk-other', document_id: 'doc-other', course_id: 'course-2', heading_path: null, content: TEXT.otherCourse, embedding: '[0.1]', score: 0.95 },
    ],
    // 笔记 AI 对话：组 A 空间里的一条笔记，学生甲在上面开了一条 AI 线程。
    // 其余是上面几份文档的附件笔记，都没删（检索函数只认没删的）
    notes: [
      { id: 'note-a', space_id: 'space-a', title: '第一组的笔记', content: '<p>我们打算先做访谈</p>', deleted_at: null },
      { id: 'note-shared-file', space_id: 'space-shared', title: '共读文章', deleted_at: null },
      { id: 'note-a-file', space_id: 'space-a', title: '第一组的附件', deleted_at: null },
      { id: 'note-b-file', space_id: 'space-b', title: '第二组的附件', deleted_at: null },
      { id: 'note-other-file', space_id: 'space-other', title: '另一门课的附件', deleted_at: null },
    ],
    note_conversation_threads: [
      { id: 'thread-a', note_id: 'note-a', space_id: 'space-a', course_id: 'course-1', target_type: 'ai', created_by: 'student-a' },
    ],
    note_conversation_participants: [{ thread_id: 'thread-a', user_id: 'student-a' }],
    note_conversation_messages: [],
    teacher_ai_configs: [
      { course_id: 'course-1', provider_id: 'deepseek', api_key_encrypted: 'enc', endpoint_url: null, is_verified: true, enabled_models: ['deepseek-chat'] },
    ],
  });

  const db = seed();
  const state = {
    user: { id: 'student-a', role: 'student' } as { id: string; role: string },
    rpcCalls: [] as Array<Record<string, any>>,
    /** 读这些表时报错，模拟数据库过载 */
    failing: new Set<string>(),
    /** 模拟数据库里的检索函数被改坏：不看 p_space_ids，全课返回 */
    ignoresScope: false,
    /** 模拟还是 050 那一版：只按课程过滤，也不返回 space_id / material_id */
    legacyColumns: false,
  };
  let nextId = 1;

  // 链式调用按条件在内存表里取行 / 写行；await、single、maybeSingle 时才执行
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let columns = '*';
    let payload: Row[] = [];
    let patch: Row = {};
    let limit: number | undefined;
    const rows = () => (db[table] ??= []);
    const view = (r: Row): Row => {
      const out: Row = { ...r };
      if (table === 'spaces' && columns.includes('courses')) {
        out.courses = { instructor_id: db.courses.find(c => c.id === r.course_id)?.instructor_id ?? null };
      }
      if (table === 'notes' && columns.includes('spaces')) {
        const space = db.spaces.find(s => s.id === r.space_id);
        out.spaces = space ? { id: space.id, course_id: space.course_id } : null;
      }
      return out;
    };
    const run = (terminal: 'single' | 'maybeSingle' | 'many') => {
      if (state.failing.has(table)) return { data: null, error: { message: 'connection reset' } };
      let found: Row[];
      if (op === 'insert') {
        found = payload.map(p => ({ id: `${table}-new-${nextId++}`, created_at: '2026-09-28T00:00:00Z', ...p }));
        rows().push(...found);
      } else {
        found = rows().filter(r => filters.every(f => f(r)));
        if (op === 'update') found.forEach(r => Object.assign(r, patch));
        else if (limit !== undefined) found = found.slice(0, limit);
      }
      const out = found.map(view);
      if (terminal === 'many') return { data: out, error: null };
      if (!out[0]) return { data: null, error: terminal === 'single' ? { message: 'no rows' } : null };
      return { data: out[0], error: null };
    };
    const builder: Record<string, unknown> = {
      select: (cols = '*') => { columns = cols; return builder; },
      insert: (p: Row | Row[]) => { op = 'insert'; payload = Array.isArray(p) ? p : [p]; return builder; },
      update: (p: Row) => { op = 'update'; patch = p; return builder; },
      eq: (col: string, value: unknown) => { filters.push(r => r[col] === value); return builder; },
      is: (col: string, value: unknown) => { filters.push(r => (r[col] ?? null) === value); return builder; },
      in: (col: string, values: unknown[]) => { filters.push(r => values.includes(r[col])); return builder; },
      order: () => builder,
      limit: (n: number) => { limit = n; return builder; },
      single: async () => run('single'),
      maybeSingle: async () => run('maybeSingle'),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve().then(() => run('many')).then(ok, fail),
    };
    return builder;
  };

  // 最新一版（065 定范围、067 排除已删笔记）的 match_kb_chunks：课程资料（不属于任何空间）全课可见，
  // 其余文档的空间要在 p_space_ids 里，来源笔记不能是删掉的；先过滤再按相关度取前 k 片。
  // p_space_ids 不传等于 NULL，`= any(NULL)` 不成立
  const rpc = async (fn: string, args: Record<string, any>) => {
    state.rpcCalls.push({ fn, ...args });
    if (fn !== 'match_kb_chunks') return { data: null, error: { message: `unknown function ${fn}` } };
    const allowed: unknown[] = Array.isArray(args.p_space_ids) ? args.p_space_ids : [];
    const liveNote = (noteId: unknown) => db.notes.some(n => n.id === noteId && n.deleted_at == null);
    const hits = db.kb_chunks
      .filter(c => c.course_id === args.p_course_id && c.embedding != null)
      .map(c => ({ c, d: db.kb_documents.find(d => d.id === c.document_id)! }))
      .filter(({ d }) => d.note_id == null || liveNote(d.note_id))
      .filter(({ d }) => state.ignoresScope || state.legacyColumns
        || (d.space_id == null && d.material_id != null) || allowed.includes(d.space_id))
      .sort((x, y) => Number(y.c.score) - Number(x.c.score))
      .slice(0, Math.max(1, Math.min(Number(args.p_match_count ?? 6), 20)));
    return {
      data: hits.map(({ c, d }) => ({
        chunk_id: c.id,
        document_id: d.id,
        title: d.title,
        heading_path: c.heading_path,
        content: c.content,
        similarity: c.score,
        ...(state.legacyColumns ? {} : { space_id: d.space_id, material_id: d.material_id }),
      })),
      error: null,
    };
  };

  const reset = () => {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, seed());
    state.user = { id: 'student-a', role: 'student' };
    state.rpcCalls.length = 0;
    state.failing.clear();
    state.ignoresScope = false;
    state.legacyColumns = false;
  };

  return {
    TEXT,
    db,
    state,
    from,
    rpc,
    reset,
    aiFetch: vi.fn(async (_url: string, _init?: { body?: string }) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'AI 的回复' } }] }),
      text: async () => '',
    })),
  };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user };
    next();
  },
}));
vi.mock('./embeddingService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./embeddingService')>()),
  resolveEmbeddingProvider: async () => ({ providerId: 'openai', apiKey: 'sk-test', model: 'text-embedding-3-small' }),
  generateEmbedding: async () => [0.1],
  embedNote: async () => {},
}));
vi.mock('./aiGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiGateway')>()),
  aiFetch: h.aiFetch,
}));
vi.mock('./aiProviderConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiProviderConfig')>()),
  decryptProviderApiKey: () => 'sk-test',
}));

import { searchKnowledgeBase } from './knowledgeBase';
import { createDefaultRegistry, type ToolContext } from './agentTools';
import { invalidateMembershipCache, invalidateSpaceCache } from './accessControl';
import noteConversationsRouter from '../routes/noteConversations';
import { errorHandler } from '../middleware/errorHandler';

type Viewer = { id: string; role: 'student' | 'teacher' | 'admin' };
const student = (id: string): Viewer => ({ id, role: 'student' });
const teacher = (id: string): Viewer => ({ id, role: 'teacher' });

const EVERYTHING = ['doc-material', 'doc-shared', 'doc-a', 'doc-b'];
const docsOf = (hits: { documentId: string }[]) => [...new Set(hits.map(hit => hit.documentId))].sort();

beforeEach(() => {
  h.reset();
  h.aiFetch.mockClear();
  invalidateMembershipCache();
  invalidateSpaceCache();
});

describe('searchKnowledgeBase：附件跟着空间走，课程资料全课可见', () => {
  const CASES: [label: string, viewer: Viewer, expected: string[]][] = [
    ['组 A 的学生：课程资料、共享空间和本组的附件', student('student-a'), ['doc-a', 'doc-material', 'doc-shared']],
    ['组 B 的学生：看不到组 A 的附件', student('student-b'), ['doc-b', 'doc-material', 'doc-shared']],
    ['教师账号凭学生验证码入课、在组 A：和组 A 学生一样', teacher('teacher-joined'), ['doc-a', 'doc-material', 'doc-shared']],
    ['被邀请、还没设为管理员的教师，不在任何组：只有课程资料和共享空间', teacher('teacher-invited'), ['doc-material', 'doc-shared']],
    ['学生账号带着自己写的管理员行：不算管理员', student('student-forged'), ['doc-material', 'doc-shared']],
    ['课程管理员：全部', teacher('co-teacher'), EVERYTHING],
    ['课程创建者：全部', teacher('owner-1'), EVERYTHING],
    ['平台管理员：全部', { id: 'platform-admin', role: 'admin' }, EVERYTHING],
  ];

  it.each(CASES)('%s', async (_label, viewer, expected) => {
    const hits = await searchKnowledgeBase('course-1', viewer, '访谈和实验怎么设计', 20);

    expect(docsOf(hits)).toEqual([...expected].sort());
    const text = JSON.stringify(hits);
    if (!expected.includes('doc-b')) expect(text).not.toContain(h.TEXT.groupB);
    if (!expected.includes('doc-a')) expect(text).not.toContain(h.TEXT.groupA);
    // 别的课的材料谁都拿不到
    expect(text).not.toContain(h.TEXT.otherCourse);
  });

  it('交给数据库的范围就是调用者进得去的空间，按建立先后', async () => {
    await searchKnowledgeBase('course-1', student('student-a'), '问题');
    await searchKnowledgeBase('course-1', teacher('co-teacher'), '问题');

    expect(h.state.rpcCalls.map(call => call.p_space_ids)).toEqual([
      ['space-shared', 'space-a'],
      ['space-shared', 'space-a', 'space-b'],
    ]);
    expect(h.state.rpcCalls[0]).toMatchObject({ fn: 'match_kb_chunks', p_course_id: 'course-1', p_match_count: 6 });
  });

  it('不在课里的人：课程资料也不给，根本不去检索', async () => {
    const hits = await searchKnowledgeBase('course-1', student('outsider'), '问题');

    expect(hits).toEqual([]);
    expect(h.state.rpcCalls).toEqual([]);
  });

  it('别组的材料再多，也挤不掉本组能看的：范围在取前 k 片之前过滤', async () => {
    for (let i = 0; i < 30; i += 1) {
      h.db.kb_chunks.push({ id: `chunk-b-${i}`, document_id: 'doc-b', course_id: 'course-1', heading_path: null, content: `${h.TEXT.groupB} 第 ${i} 段`, embedding: '[0.1]', score: 0.99 });
    }
    const hits = await searchKnowledgeBase('course-1', student('student-a'), '问题', 3);

    expect(hits).toHaveLength(3);
    expect(docsOf(hits)).toEqual(['doc-a', 'doc-material', 'doc-shared']);
  });

  it('数据库里的函数被改回只按课程过滤：API 照样不把别组的片段交出去', async () => {
    h.state.ignoresScope = true;
    const hits = await searchKnowledgeBase('course-1', student('student-a'), '问题', 20);

    expect(docsOf(hits)).toEqual(['doc-a', 'doc-material', 'doc-shared']);
    expect(JSON.stringify(hits)).not.toContain(h.TEXT.groupB);
  });

  it('函数不返回 space_id / material_id（050 那一版）：一片都不给，宁缺毋滥', async () => {
    h.state.legacyColumns = true;
    expect(await searchKnowledgeBase('course-1', student('student-a'), '问题', 20)).toEqual([]);
  });

  it('查组员出错：进不进得去说不准的空间一律不算，本组的这次也先不给', async () => {
    h.state.failing.add('group_members');
    const hits = await searchKnowledgeBase('course-1', student('student-a'), '问题', 20);

    expect(docsOf(hits)).toEqual(['doc-material', 'doc-shared']);
    expect(h.state.rpcCalls[0].p_space_ids).toEqual(['space-shared']);
  });

  it('查不到课内身份：报 503，不当成「不在课里」也不当成「全都能看」', async () => {
    h.state.failing.add('course_members');
    await expect(searchKnowledgeBase('course-1', student('student-a'), '问题')).rejects.toMatchObject({ statusCode: 503 });
    expect(h.state.rpcCalls).toEqual([]);
  });
});

describe('智能体工具 search_course_materials 按调用者检索', () => {
  const registry = createDefaultRegistry();
  const context = (over: Partial<ToolContext>): ToolContext => ({
    noteId: 'note-a', spaceId: 'space-a', courseId: 'course-1', userId: 'student-a', userRole: 'student',
    noteTitle: '', noteContent: '', ...over,
  });
  const search = (ctx: ToolContext) =>
    registry.executeTool('search_course_materials', { query: '实验方案', limit: 10 }, ctx);

  it('组 A 的学生让智能体查课程材料：组 B 附件的文字一个字都拿不到', async () => {
    const result = await search(context({}));

    expect(result.success).toBe(true);
    const text = JSON.stringify(result);
    expect(text).toContain(h.TEXT.groupA);
    expect(text).toContain(h.TEXT.material);
    expect(text).not.toContain(h.TEXT.groupB);
  });

  it('凭学生验证码入课的教师账号拿的是学生工具角色，同样只看本组', async () => {
    const result = await search(context({ userId: 'teacher-joined', userRole: 'student' }));

    expect(JSON.stringify(result)).toContain(h.TEXT.groupA);
    expect(JSON.stringify(result)).not.toContain(h.TEXT.groupB);
  });

  it('课程管理员照旧能查到每个组的材料', async () => {
    const result = await search(context({ userId: 'co-teacher', userRole: 'teacher' }));

    expect(JSON.stringify(result)).toContain(h.TEXT.groupB);
  });
});

describe('笔记 AI 对话：系统提示里的课程材料段不含别组附件', () => {
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

  // 自由提问不检索知识库，其余模式都检索
  const ASK = { content: '访谈应该怎么设计', provider_id: 'deepseek', model: 'deepseek-chat', agent_mode: 'idea_coach' };
  const sentToModel = () => h.aiFetch.mock.calls.map(([, init]) => init?.body ?? '').join('\n');

  it('组 A 的学生在本组笔记上问 AI：课程资料和本组附件在，组 B 的附件不在', async () => {
    const res = await fetch(`${base}/note-conversations/thread-a/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ASK),
    });
    await res.text();

    expect(res.status).toBe(200);
    expect(h.aiFetch).toHaveBeenCalled();
    const prompt = sentToModel();
    expect(prompt).toContain('COURSE MATERIALS');
    expect(prompt).toContain(h.TEXT.groupA);
    expect(prompt).toContain(h.TEXT.material);
    expect(prompt).not.toContain(h.TEXT.groupB);
    expect(h.state.rpcCalls.at(-1)?.p_space_ids).toEqual(['space-shared', 'space-a']);
  });

  it('课程创建者在同一条线程上问：每个组的材料都在', async () => {
    h.state.user = { id: 'owner-1', role: 'teacher' };
    const res = await fetch(`${base}/note-conversations/thread-a/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ASK),
    });
    await res.text();

    expect(res.status).toBe(200);
    expect(sentToModel()).toContain(h.TEXT.groupB);
  });
});

describe('防回归：范围由数据库函数执行，API 只经 searchKnowledgeBase 调它', () => {
  const migrationsDir = resolve(__dirname, '../../../supabase/migrations');
  const migrations = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const sql = (file: string) => readFileSync(resolve(migrationsDir, file), 'utf-8');
  const DEFINES = /create (or replace )?function public\.match_kb_chunks/i;

  it('最新一版 match_kb_chunks 先按 p_space_ids 过滤再取前 k 片，客户端不能直接调（上面模拟的就是这个语义）', () => {
    const defining = migrations.filter(file => DEFINES.test(sql(file)));
    const latest = sql(defining[defining.length - 1]);
    const body = latest.slice(latest.search(DEFINES));

    expect(body).toContain('(d.space_id is null and d.material_id is not null)');
    expect(body).toContain('d.space_id = any(p_space_ids)');
    expect(body.indexOf('any(p_space_ids)')).toBeLessThan(body.indexOf('order by'));
    // 067：来源笔记删掉的不给（上面的模拟同样排除，细节见 knowledgeBaseDeletedNotes.test.ts）
    expect(body).toContain('where n.id = d.note_id and n.deleted_at is null');
    expect(body).toMatch(/p_space_ids uuid\[\] default null/);
    expect(body).toMatch(/revoke execute on function public\.match_kb_chunks\(uuid, extensions\.vector, integer, uuid\[\]\) from public, anon, authenticated/);
  });

  it('kb_documents / kb_chunks 没有给客户端的读策略，之后的迁移也没有再建', () => {
    const texts = migrations.map(sql);
    const lastDrop = texts.findLastIndex(text => /drop policy if exists kb_chunks_select/.test(text) && !/create policy kb_chunks_select/.test(text));
    expect(lastDrop).toBeGreaterThan(-1);
    expect(texts[lastDrop]).toContain('drop policy if exists kb_documents_select');
    expect(texts[lastDrop]).toMatch(/revoke all on table public\.kb_documents, public\.kb_chunks from anon, authenticated/);
    for (const text of texts.slice(lastDrop)) {
      expect(text).not.toMatch(/create policy \w+ on public\.kb_(documents|chunks)/i);
    }
  });

  it('只有 knowledgeBase.ts 调这个函数，每次都带上范围', () => {
    const apiSrc = resolve(__dirname, '..');
    const callers = (readdirSync(apiSrc, { recursive: true }) as string[])
      .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter(file => readFileSync(resolve(apiSrc, file), 'utf-8').includes("rpc('match_kb_chunks'"));
    expect(callers).toEqual(['services/knowledgeBase.ts']);

    const src = readFileSync(resolve(__dirname, 'knowledgeBase.ts'), 'utf-8');
    const call = src.slice(src.indexOf("rpc('match_kb_chunks'"));
    expect(call.slice(0, call.indexOf('});'))).toContain('p_space_ids: spaceIds');
  });
});
