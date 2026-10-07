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
 * 向量服务和模型调用。数据库里的检索函数按最新一版（080 的 match_kb_chunk_vectors）的 SQL 语义模拟，
 * 末尾的静态约束把两边锁在一起。
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
      { id: 'chunk-a', document_id: 'doc-a', course_id: 'course-1', heading_path: '访谈', content: TEXT.groupA, embedding: '[0.1]', score: 0.7, page_start: 3, page_end: 4 },
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
    /** 查询向量；null 表示这次没拿到（丢包），退到关键词 */
    queryVector: [0.1] as number[] | null,
    /** 重排打分；null 表示重排没拿到（超时），按向量的顺序给 */
    rerank: null as null | ((docs: string[]) => number[]),
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

  // 最新一版（范围同 065、已删笔记同 067，080 换成按模型取向量）的 match_kb_chunk_vectors：
  // 课程资料（不属于任何空间）全课可见，其余文档的空间要在 p_space_ids 里，来源笔记不能是删掉的；
  // 先过滤再按相关度取前 k 片。p_space_ids 不传等于 NULL，`= any(NULL)` 不成立。
  // 片段上的 embedding 代表「有当前模型的向量」
  // 085 的两个开关：课程资料可以单独关，画布附件整门课一起关（courses.kb_include_attachments）
  const materialOn = (materialId: unknown) => (db.course_materials ?? []).find(m => m.id === materialId)?.kb_enabled !== false;
  const attachmentsOn = (courseId: unknown) => db.courses.find(c => c.id === courseId)?.kb_include_attachments !== false;
  const switchedOn = (d: Row, courseId: unknown) =>
    (d.material_id == null || materialOn(d.material_id)) && (d.space_id == null || attachmentsOn(courseId));

  const rpc = async (fn: string, args: Record<string, any>) => {
    state.rpcCalls.push({ fn, ...args });
    if (fn === 'match_kb_chunks_keyword') return keywordRpc(args);
    if (fn === 'kb_course_searchable') {
      const live = (noteId: unknown) => db.notes.some(n => n.id === noteId && n.deleted_at == null);
      return {
        data: db.kb_chunks.some(c => {
          const d = db.kb_documents.find(doc => doc.id === c.document_id);
          if (!d || c.course_id !== args.p_course_id) return false;
          if (d.material_id != null) return materialOn(d.material_id);
          return d.note_id != null && live(d.note_id) && attachmentsOn(args.p_course_id);
        }),
        error: null,
      };
    }
    if (fn !== 'match_kb_chunk_vectors') return { data: null, error: { message: `unknown function ${fn}` } };
    if (args.p_model !== 'voyageai/voyage-4-lite@1024') return { data: [], error: null };
    const allowed: unknown[] = Array.isArray(args.p_space_ids) ? args.p_space_ids : [];
    const liveNote = (noteId: unknown) => db.notes.some(n => n.id === noteId && n.deleted_at == null);
    const hits = db.kb_chunks
      .filter(c => c.course_id === args.p_course_id && c.embedding != null)
      .map(c => ({ c, d: db.kb_documents.find(d => d.id === c.document_id)! }))
      .filter(({ d }) => d.note_id == null || liveNote(d.note_id))
      .filter(({ d }) => state.ignoresScope || state.legacyColumns
        || (d.space_id == null && d.material_id != null) || allowed.includes(d.space_id))
      .filter(({ d }) => state.legacyColumns || switchedOn(d, args.p_course_id))
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
        ...(state.legacyColumns ? {} : {
          space_id: d.space_id, material_id: d.material_id, note_id: d.note_id,
          page_start: c.page_start ?? null, page_end: c.page_end ?? null,
        }),
      })),
      error: null,
    };
  };

  // 082 的 match_kb_chunks_keyword：范围规则和向量检索一字不差，先过滤再按分数取前 k 片。
  // 这里用「检索词在正文里出现几个」代替 BM25 的分数
  const keywordRpc = async (args: Record<string, any>) => {
    const allowed: unknown[] = Array.isArray(args.p_space_ids) ? args.p_space_ids : [];
    const terms: string[] = (args.p_terms ?? []).map((t: string) => t.replace(/^#/, ''));
    const liveNote = (noteId: unknown) => db.notes.some(n => n.id === noteId && n.deleted_at == null);
    const hits = db.kb_chunks
      .filter(c => c.course_id === args.p_course_id)
      .map(c => ({ c, d: db.kb_documents.find(d => d.id === c.document_id)!, matched: terms.filter(t => String(c.content).includes(t)).length }))
      .filter(({ matched }) => matched > 0)
      .filter(({ d }) => d.note_id == null || liveNote(d.note_id))
      .filter(({ d }) => state.ignoresScope || (d.space_id == null && d.material_id != null) || allowed.includes(d.space_id))
      .filter(({ d }) => switchedOn(d, args.p_course_id))
      .sort((x, y) => y.matched - x.matched)
      .slice(0, Math.max(1, Math.min(Number(args.p_match_count ?? 6), 50)));
    return {
      data: hits.map(({ c, d, matched }) => ({
        chunk_id: c.id, document_id: d.id, title: d.title, heading_path: c.heading_path, content: c.content,
        score: matched, matched_terms: matched, space_id: d.space_id, material_id: d.material_id, note_id: d.note_id,
        page_start: c.page_start ?? null, page_end: c.page_end ?? null,
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
    state.queryVector = [0.1];
    state.rerank = null;
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
  embedNote: async () => {},
}));
vi.mock('./kbEmbedding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./kbEmbedding')>()),
  kbEmbeddingConfigured: () => true,
  embedKbQuery: async () => h.state.queryVector,
}));
vi.mock('./kbRerank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./kbRerank')>()),
  rerankKb: async (_query: string, docs: string[]) => (h.state.rerank ? h.state.rerank(docs) : null),
}));
vi.mock('./aiGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiGateway')>()),
  aiFetch: h.aiFetch,
}));
vi.mock('./aiProviderConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiProviderConfig')>()),
  decryptProviderApiKey: () => 'sk-test',
}));

import { __resetKbPresence, searchKnowledgeBase, searchKnowledgeBaseDetailed } from './knowledgeBase';
import { KbCitationRegistry } from './kbSources';
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
  __resetKbPresence();
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

    // 向量和关键词两路都带同样的范围
    const byFn = (fn: string) => h.state.rpcCalls.filter(call => call.fn === fn).map(call => call.p_space_ids);
    expect(byFn('match_kb_chunk_vectors')).toEqual([
      ['space-shared', 'space-a'],
      ['space-shared', 'space-a', 'space-b'],
    ]);
    expect(byFn('match_kb_chunks_keyword')).toEqual(byFn('match_kb_chunk_vectors'));
    // 向量前 20 段做重排的候选
    expect(h.state.rpcCalls[0]).toMatchObject({
      fn: 'match_kb_chunk_vectors', p_course_id: 'course-1', p_model: 'voyageai/voyage-4-lite@1024', p_match_count: 20,
    });
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

  it('重排开着：别组的附件根本进不了候选，重排之后照样没有', async () => {
    h.state.rerank = docs => docs.map(() => 0.9);
    const hits = await searchKnowledgeBase('course-1', student('student-a'), '实验方案和访谈记录', 20);

    expect(JSON.stringify(hits)).not.toContain(h.TEXT.groupB);
    expect(JSON.stringify(hits)).toContain(h.TEXT.groupA);
    expect(hits.every(hit => hit.relevance === 0.9)).toBe(true);
  });

  it('查询向量没拿到、退到关键词：组 A 的学生同样拿不到组 B 的附件，教职照旧全看', async () => {
    h.state.queryVector = null;

    const hits = await searchKnowledgeBase('course-1', student('student-a'), '实验方案和访谈记录');
    expect(h.state.rpcCalls.map(call => call.fn)).toEqual(['match_kb_chunks_keyword']);
    expect(h.state.rpcCalls[0].p_space_ids).toEqual(['space-shared', 'space-a']);
    expect(JSON.stringify(hits)).toContain(h.TEXT.groupA);
    expect(JSON.stringify(hits)).not.toContain(h.TEXT.groupB);
    expect(hits.every(hit => hit.matchedBy === 'keyword')).toBe(true);

    const staff = await searchKnowledgeBase('course-1', { id: 'co-teacher', role: 'teacher' }, '实验方案和访谈记录');
    expect(JSON.stringify(staff)).toContain(h.TEXT.groupB);
  });

  it('关键词那一路数据库函数漏了范围：API 这边照样筛掉别组的', async () => {
    h.state.queryVector = null;
    h.state.ignoresScope = true;
    const hits = await searchKnowledgeBase('course-1', student('student-a'), '实验方案和访谈记录');
    expect(JSON.stringify(hits)).not.toContain(h.TEXT.groupB);
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

  it('语义检索没连上、按关键词找到的：告诉模型可能不相关，不能据此断定资料里没有', async () => {
    h.state.queryVector = null;
    const result = await registry.executeTool('search_course_materials', { query: '访谈记录怎么整理', limit: 5 }, context({}));

    expect(JSON.stringify(result)).toContain(h.TEXT.groupA);
    expect((result.data as any).message).toContain('按关键词找到的');
    expect((result.data as any).results[0]).toMatchObject({ matched: 'keyword' });
  });

  it('语义检索没连上、关键词也没找到：不说「知识库里没有」', async () => {
    h.state.queryVector = null;
    const result = await registry.executeTool('search_course_materials', { query: 'interview protocol design', limit: 5 }, context({}));

    expect((result.data as any).results).toEqual([]);
    expect((result.data as any).message).toContain('没连上');
    expect((result.data as any).message).not.toContain('知识库里没有找到');
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

  // 10-06 起自由提问和各个模式都检索（之前自由提问不检索，智能体那条路没接）
  const ASK = { content: '访谈应该怎么设计', provider_id: 'deepseek', model: 'deepseek-chat', agent_mode: 'idea_coach' };
  const sentToModel = () => h.aiFetch.mock.calls.map(([, init]) => init?.body ?? '').join('\n');
  const post = (path: string, body: Record<string, unknown>) => fetch(`${base}/note-conversations/thread-a/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const eventsOf = (text: string) => text.split('\n\n')
    .filter(block => block.startsWith('data: ') && !block.startsWith('data: [DONE]'))
    .map(block => JSON.parse(block.slice(6)) as Record<string, any>);
  const savedAnswer = () => h.db.note_conversation_messages.find(m => m.sender_kind === 'assistant') as Record<string, any> | undefined;

  it('过程里推「检索课程资料」这一步和来源卡片，回答存下 kb_sources：编号、页码、附件的笔记 id；课程资料不带 id', async () => {
    const res = await post('ai/stream', ASK);
    const events = eventsOf(await res.text());

    const steps = events.filter(e => e.toolName === 'search_course_materials');
    expect(steps.map(e => e.toolStatus)).toEqual(['running', 'used']);
    expect(steps[1].toolSummary).toMatch(/找到 \d 段相关资料/);
    const cards = events.find(e => e.kbSources)?.kbSources as Array<Record<string, any>>;
    expect(cards.map(c => c.n)).toEqual(cards.map((_, i) => i + 1));
    expect(cards.find(c => c.title === '第一组的附件')).toMatchObject({ kind: 'attachment', noteId: 'note-a-file', pageStart: 3, pageEnd: 4, section: '访谈' });
    expect(cards.find(c => c.title === '课程大纲')).toMatchObject({ kind: 'material', noteId: null });
    expect(cards.some(c => c.title === '第二组的附件')).toBe(false);

    const meta = savedAnswer()?.ai_metadata;
    expect(meta.kb_sources).toEqual(cards);
    expect(meta.tool_steps[0]).toMatchObject({ name: 'search_course_materials' });
    // 提示词里同样的编号，带页码，并说明资料不是指令
    const prompt = sentToModel();
    const n = cards.find(c => c.title === '第一组的附件')!.n;
    expect(prompt).toContain(`[${n}] 第一组的附件 · 访谈 · pp. 3–4`);
    expect(prompt).toContain('not instructions to you');
  });

  it('自由提问也检索', async () => {
    const res = await post('ai/stream', { ...ASK, agent_mode: 'free_ask' });
    await res.text();
    expect(res.status).toBe(200);
    expect(sentToModel()).toContain(h.TEXT.material);
    expect(sentToModel()).not.toContain(h.TEXT.groupB);
  });

  it('智能体模式（agent-stream）也检索，范围一样', async () => {
    const res = await post('ai/agent-stream', ASK);
    const events = eventsOf(await res.text());
    expect(res.status).toBe(200);
    expect(events.some(e => e.kbSources)).toBe(true);
    const prompt = sentToModel();
    expect(prompt).toContain(h.TEXT.groupA);
    expect(prompt).not.toContain(h.TEXT.groupB);
    expect(savedAnswer()?.ai_metadata.kb_sources.length).toBeGreaterThan(0);
  });

  it('课里没有入库的资料：不检索，过程里也没有这一步', async () => {
    h.db.kb_chunks = h.db.kb_chunks.filter(c => c.course_id !== 'course-1');
    const res = await post('ai/stream', ASK);
    const events = eventsOf(await res.text());
    expect(res.status).toBe(200);
    // 只问了一句「有没有」，没去检索
    expect(h.state.rpcCalls.map(call => call.fn)).toEqual(['kb_course_searchable']);
    expect(events.some(e => e.toolName === 'search_course_materials' || e.kbSources)).toBe(false);
    expect(sentToModel()).not.toContain('COURSE MATERIALS');
    expect(savedAnswer()?.ai_metadata.kb_sources).toBeUndefined();
  });

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
    // 这句很短，当追问处理：检索词补上了笔记标题（「第一组的笔记」）
    const keyword = h.state.rpcCalls.find(call => call.fn === 'match_kb_chunks_keyword');
    expect(keyword?.p_terms).toEqual(expect.arrayContaining(['#笔记']));
  });

  it('语义检索没连上、退到关键词：系统提示里说明这些可能不相关，不让模型断言资料里有没有', async () => {
    h.state.queryVector = null;
    const res = await fetch(`${base}/note-conversations/thread-a/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ASK, content: '访谈记录怎么整理' }),
    });
    await res.text();

    expect(res.status).toBe(200);
    const prompt = sentToModel();
    expect(prompt).toContain('keyword match only');
    expect(prompt).toContain(h.TEXT.groupA);
    expect(prompt).not.toContain('say so instead of inventing');
  });

  it('重排了、一段都不够相关度门槛：不塞资料，系统提示里说检索过了没有相关段落', async () => {
    h.state.rerank = docs => docs.map(() => 0.1);
    const res = await fetch(`${base}/note-conversations/thread-a/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ASK),
    });
    await res.text();

    expect(res.status).toBe(200);
    const prompt = sentToModel();
    expect(prompt).toContain('no passage is relevant');
    expect(prompt).not.toContain(h.TEXT.groupA);
    expect(prompt).not.toContain(h.TEXT.material);
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

  it('整门课关掉画布附件：只剩课程资料；资料也关掉，笔记 AI 就不再检索、过程里也没有这一步', async () => {
    h.db.courses[0].kb_include_attachments = false;
    expect(docsOf(await searchKnowledgeBase('course-1', teacher('owner-1'), '课程', 10))).toEqual(['doc-material']);

    h.db.course_materials = [{ id: 'material-1', course_id: 'course-1', kb_enabled: false }];
    __resetKbPresence();
    h.state.rpcCalls.length = 0;
    const res = await fetch(`${base}/note-conversations/thread-a/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '访谈应该怎么设计', provider_id: 'deepseek', model: 'deepseek-chat' }),
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(h.state.rpcCalls.map(call => call.fn)).toEqual(['kb_course_searchable']);
    expect(text).not.toContain('search_course_materials');
  });
});

describe('智能体工具 search_course_materials 接着这一轮的资料编号', () => {
  it('给了 kbCitations：结果带 ref，接着自动检索的号往下编，已经有的沿用；提示模型标 [ref]', async () => {
    h.state.rerank = docs => docs.map(() => 0.9);
    const first = (await searchKnowledgeBaseDetailed('course-1', { id: 'student-a', role: 'student' }, '课程大纲', 1)).hits;
    const citations = new KbCitationRegistry(first);
    const result = await createDefaultRegistry().executeTool('search_course_materials', { query: '课程大纲 访谈', limit: 5 }, {
      noteId: 'note-a', spaceId: 'space-a', courseId: 'course-1', userId: 'student-a', userRole: 'student',
      noteTitle: '', noteContent: '', kbCitations: citations,
    } as ToolContext);
    const data = result.data as { results: Array<{ ref: number; source: string }>; message: string };
    expect(data.results.length).toBeGreaterThan(1);
    expect(data.results.map(r => r.ref)).toEqual(data.results.map(r => citations.sources.find(c => c.title === r.source)!.n));
    expect(Math.max(...data.results.map(r => r.ref))).toBe(citations.sources.length);
    expect(data.message).toContain('[6]');
  });
});

describe('知识库开关（085）：关掉的资料、整门课关掉的附件，AI 都检索不到', () => {
  it('老师关掉一份课程资料的「进入知识库」：这份检索不到，附件照旧', async () => {
    h.db.course_materials = [{ id: 'material-1', course_id: 'course-1', kb_enabled: false }];
    const hits = await searchKnowledgeBase('course-1', student('student-a'), '课程', 10);
    expect(docsOf(hits)).toEqual(['doc-a', 'doc-shared']);
  });

});

describe('防回归：范围由数据库函数执行，API 只经 searchKnowledgeBase 调它', () => {
  const migrationsDir = resolve(__dirname, '../../../supabase/migrations');
  const migrations = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const sql = (file: string) => readFileSync(resolve(migrationsDir, file), 'utf-8');
  const DEFINES = /create (or replace )?function public\.match_kb_chunk_vectors/i;

  it('最新一版 match_kb_chunk_vectors 先按 p_space_ids 过滤再取前 k 片，客户端不能直接调（上面模拟的就是这个语义）', () => {
    const defining = migrations.filter(file => DEFINES.test(sql(file)));
    const latest = sql(defining[defining.length - 1]);
    const body = latest.slice(latest.search(DEFINES));

    expect(body).toContain('(d.space_id is null and d.material_id is not null)');
    expect(body).toContain('d.space_id = any(p_space_ids)');
    expect(body.indexOf('any(p_space_ids)')).toBeLessThan(body.indexOf('order by'));
    // 067：来源笔记删掉的不给（上面的模拟同样排除，细节见 knowledgeBaseDeletedNotes.test.ts）
    expect(body).toContain('where n.id = d.note_id and n.deleted_at is null');
    expect(body).toMatch(/p_space_ids uuid\[\] default null/);
    // 课程硬过滤，只在同一个模型的向量里比
    expect(body).toContain('where v.course_id = p_course_id');
    expect(body).toContain('and v.model = p_model');
    expect(body).toMatch(/revoke execute on function public\.match_kb_chunk_vectors\(uuid, text, extensions\.halfvec, integer, uuid\[\]\) from public, anon, authenticated/);
    // 085：两个开关也在取前 k 片之前判断（上面的模拟同样判断）
    expect(body.indexOf('m.kb_enabled')).toBeGreaterThan(-1);
    expect(body.indexOf('m.kb_enabled')).toBeLessThan(body.indexOf('order by'));
    expect(body.indexOf('co.kb_include_attachments')).toBeGreaterThan(-1);
    expect(body.indexOf('co.kb_include_attachments')).toBeLessThan(body.indexOf('order by'));
  });

  it('最新一版 match_kb_chunks_keyword（关键词兜底）范围规则和向量检索一样，先过滤再取前 k 片，客户端不能直接调', () => {
    const KW = /create (or replace )?function public\.match_kb_chunks_keyword/i;
    const defining = migrations.filter(file => KW.test(sql(file)));
    const latest = sql(defining[defining.length - 1]);
    const body = latest.slice(latest.search(KW));

    expect(body).toContain('where c.course_id = p_course_id');
    expect(body).toContain('(d.space_id is null and d.material_id is not null)');
    expect(body).toContain('d.space_id = any(p_space_ids)');
    expect(body).toContain('where n.id = d.note_id and n.deleted_at is null');
    expect(body.indexOf('any(p_space_ids)')).toBeLessThan(body.indexOf('order by'));
    expect(body).toMatch(/p_space_ids uuid\[\] default null/);
    expect(body).toMatch(/revoke execute on function public\.match_kb_chunks_keyword\(uuid, text\[\], integer, uuid\[\]\) from public, anon, authenticated/);
    expect(body.indexOf('m.kb_enabled')).toBeGreaterThan(-1);
    expect(body.indexOf('co.kb_include_attachments')).toBeGreaterThan(-1);
    expect(body.indexOf('co.kb_include_attachments')).toBeLessThan(body.indexOf('order by'));
    const SET = /create (or replace )?function public\.kb_set_search_text/i;
    const setters = migrations.filter(file => SET.test(sql(file)));
    expect(sql(setters[setters.length - 1])).toMatch(/revoke execute on function public\.kb_set_search_text\(jsonb\) from public, anon, authenticated/);
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
    // 080 的向量表同样：打开 RLS、不建策略、收回客户端权限
    const created = texts.findIndex(text => /create table if not exists public\.kb_chunk_vectors/.test(text));
    expect(created).toBeGreaterThan(-1);
    expect(texts[created]).toContain('alter table public.kb_chunk_vectors enable row level security');
    expect(texts[created]).toMatch(/revoke all on table public\.kb_chunk_vectors from anon, authenticated/);
    for (const text of texts.slice(created)) {
      expect(text).not.toMatch(/create policy \w+ on public\.kb_chunk_vectors/i);
    }
    // 083 的检索记录同样只给后端
    const logs = texts.findIndex(text => /create table if not exists public\.kb_retrieval_logs/.test(text));
    expect(logs).toBeGreaterThan(-1);
    expect(texts[logs]).toContain('alter table public.kb_retrieval_logs enable row level security');
    expect(texts[logs]).toMatch(/revoke all on table public\.kb_retrieval_logs from anon, authenticated/);
    for (const text of texts.slice(logs)) {
      expect(text).not.toMatch(/create policy \w+ on public\.kb_retrieval_logs/i);
    }
  });

  it('只有 knowledgeBase.ts 调这个函数，每次都带上范围；旧的 match_kb_chunks 已经没人调', () => {
    const apiSrc = resolve(__dirname, '..');
    const sources = (readdirSync(apiSrc, { recursive: true }) as string[])
      .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    const callersOf = (fn: string) => sources.filter(file => readFileSync(resolve(apiSrc, file), 'utf-8').includes(`rpc('${fn}'`));
    expect(callersOf('match_kb_chunk_vectors')).toEqual(['services/knowledgeBase.ts']);
    expect(callersOf('match_kb_chunks_keyword')).toEqual(['services/knowledgeBase.ts']);
    expect(callersOf('match_kb_chunks')).toEqual([]);

    const src = readFileSync(resolve(__dirname, 'knowledgeBase.ts'), 'utf-8');
    for (const fn of ['match_kb_chunk_vectors', 'match_kb_chunks_keyword']) {
      const call = src.slice(src.indexOf(`rpc('${fn}'`));
      expect(call.slice(0, call.indexOf('});'))).toContain('p_space_ids: spaceIds');
    }
  });
});
