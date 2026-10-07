import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 笔记是软删除：DELETE /notes/:id 只写 notes.deleted_at，kb_documents.note_id 上的级联从不触发。
 * 原先知识库里那份原样留着，检索（match_kb_chunks）也不看 deleted_at——学生删掉的附件，
 * 笔记 AI 对话和智能体工具 search_course_materials 照样念得出来；后台解析、启动续跑也不看，
 * 删掉的附件还会被重新写回知识库。
 *
 * 现在删除接口顺手清掉知识库里那份，后台入库前后都核一次，检索函数（067）只认没删的笔记。
 * 迁移和 API 分开上线，两种状态都要对：state.migration 为 '065' 时检索函数不看 deleted_at，
 * 只能靠 API 清干净；'067' 时数据库兜底（080 换成 match_kb_chunk_vectors 之后照旧兜底）。
 *
 * 路由、accessControl、kbIngest、knowledgeBase、智能体工具都用真的，只替换数据库、鉴权、
 * 解析、向量服务和模型调用。数据库按 SQL 语义模拟（含 kb_chunks 的外键和级联），
 * 末尾的静态约束把模拟和最新一版迁移锁在一起。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const TEXT = {
    material: '课程大纲：第三周讨论知识建构的十二条原则',
    paper: '学生甲上传后又删掉的访谈提纲：先问动机，再问经历',
    slides: '学生乙分享的课堂幻灯片：知识建构的六个阶段',
    upload: '刚上传就被删掉的实验方案：两组对照，各二十人',
    old: '很早以前删掉、知识库里还留着的旧讲义',
    waiting: '重启前还在解析的课程报告',
    gone: '重启前删掉、解析还挂着的草稿',
  };
  /** 解析出来的正文。知识库只收 80 字以上，标记放在段落里，切片后还在 */
  const body = (marker: string) => [
    `# ${marker}`,
    '',
    `${marker}。这一段是正文，写得足够长，入库时才不会因为太短被跳过；`
      + '切片按标题和长度来，这么短的一份只切出一片，片段里一定带着上面的标记。',
  ].join('\n');
  const T0 = '2026-09-01T00:00:00Z';
  const attachment = (id: string, author: string, title: string, extra: Row = {}): Row => ({
    id, space_id: 'space-shared', author_id: author, type: 'attachment', title, content: '',
    file_url: `https://storage.example/note-chat-attachments/${id}.pdf`, file_name: `${title}.pdf`,
    mime_type: 'application/pdf', created_at: T0, deleted_at: null, ...extra,
  });

  const seed = (): Record<string, Row[]> => ({
    courses: [{ id: 'course-1', instructor_id: 'owner-1' }],
    spaces: [{ id: 'space-shared', course_id: 'course-1', group_id: null, created_at: T0 }],
    course_members: [
      { course_id: 'course-1', user_id: 'owner-1', role: 'teacher' },
      { course_id: 'course-1', user_id: 'student-a', role: 'student' },
      { course_id: 'course-1', user_id: 'student-b', role: 'student' },
    ],
    group_members: [],
    notes: [
      attachment('note-paper', 'student-a', '访谈提纲'),
      attachment('note-slides', 'student-b', '课堂幻灯片'),
      attachment('note-upload', 'student-a', '实验方案'),
      // 学生乙在自己的笔记上和 AI 对话
      { id: 'note-idea', space_id: 'space-shared', author_id: 'student-b', type: 'note', title: '我的想法', content: '<p>访谈应该怎么设计</p>', created_at: T0, deleted_at: null },
    ],
    kb_documents: [
      { id: 'doc-material', course_id: 'course-1', space_id: null, note_id: null, material_id: 'material-1', source_type: 'material', title: '课程大纲', status: 'ready', content_hash: 'h-material' },
      { id: 'doc-paper', course_id: 'course-1', space_id: 'space-shared', note_id: 'note-paper', material_id: null, source_type: 'attachment', title: '访谈提纲', status: 'ready', content_hash: 'h-paper' },
      { id: 'doc-slides', course_id: 'course-1', space_id: 'space-shared', note_id: 'note-slides', material_id: null, source_type: 'attachment', title: '课堂幻灯片', status: 'ready', content_hash: 'h-slides' },
    ],
    // score 代替向量距离：要删的那份和问题最相关，没删干净的话它排第一
    kb_chunks: [
      { id: 'chunk-material', document_id: 'doc-material', course_id: 'course-1', heading_path: null, content: TEXT.material, embedding: '[0.1]', score: 0.6 },
      { id: 'chunk-paper', document_id: 'doc-paper', course_id: 'course-1', heading_path: '访谈', content: TEXT.paper, embedding: '[0.1]', score: 0.9 },
      { id: 'chunk-slides', document_id: 'doc-slides', course_id: 'course-1', heading_path: null, content: TEXT.slides, embedding: '[0.1]', score: 0.7 },
    ],
    document_renders: [],
    events: [],
    note_conversation_threads: [
      { id: 'thread-b', note_id: 'note-idea', space_id: 'space-shared', course_id: 'course-1', target_type: 'ai', created_by: 'student-b' },
    ],
    note_conversation_participants: [{ thread_id: 'thread-b', user_id: 'student-b' }],
    note_conversation_messages: [],
    teacher_ai_configs: [
      { course_id: 'course-1', provider_id: 'deepseek', api_key_encrypted: 'enc', endpoint_url: null, is_verified: true, enabled_models: ['deepseek-chat'] },
    ],
  });

  const db = seed();
  type Point = 'parse' | 'upsert' | 'chunks';
  const state = {
    user: { id: 'student-a', role: 'student' } as { id: string; role: string },
    /** 检索函数按哪一版迁移算：'065' 是现在线上那版，'067' 排除来源笔记已删的文档 */
    migration: '065' as '065' | '067',
    /** 「表:操作」在这里的，执行时报错 */
    failing: new Set<string>(),
    /** 每次写库记一笔「表:操作」 */
    writes: [] as string[],
    /** 后台入库走到这一步时插进来做一件事（删除请求），只做一次 */
    at: null as null | { point: Point; run: () => Promise<void> },
  };
  let seq = 0;

  const fire = async (point: Point) => {
    const at = state.at;
    if (at?.point !== point) return;
    state.at = null;
    await at.run();
  };

  // 链式调用按条件在内存表里取行 / 写行；await、single、maybeSingle 时才执行
  const from = (table: string) => {
    type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
    const filters: Array<(r: Row) => boolean> = [];
    let op: Op = 'select';
    let columns = '*';
    let payload: Row[] = [];
    let conflictKeys: string[] = [];
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
      if (columns.includes('notes!inner(')) out.notes = { id: r.note_id };
      return out;
    };
    // 点号过滤（notes.deleted_at）作用在关联的笔记上；PostgREST 只有写了 !inner 才据此筛掉父行
    const where = (col: string, test: (value: unknown) => boolean) => {
      filters.push(r => {
        if (!col.includes('.')) return test(r[col]);
        const [relation, field] = col.split('.');
        if (!columns.includes(`${relation}!inner(`)) return true;
        const joined = relation === 'notes' ? db.notes.find(n => n.id === r.note_id) : undefined;
        return joined !== undefined && test(joined[field]);
      });
      return builder;
    };
    const execute = async (): Promise<{ data: Row[] | null; error: { message: string } | null }> => {
      // 入库先按 course_id + note_id 查旧文档，紧接着 upsert：删除落在这两步之前
      if (table === 'kb_documents' && op === 'select') await fire('upsert');
      // 文档行已经写了、片段还没写：删除落在这里
      if (table === 'kb_chunks' && op === 'insert') await fire('chunks');
      if (state.failing.has(`${table}:${op}`)) return { data: null, error: { message: 'connection reset' } };
      if (op !== 'select') state.writes.push(`${table}:${op}`);
      if (op === 'insert') {
        // kb_chunks.document_id 外键：文档已经不在了，整条插入被拒
        if (table === 'kb_chunks' && payload.some(p => !db.kb_documents.some(d => d.id === p.document_id))) {
          return { data: null, error: { message: 'insert on table "kb_chunks" violates foreign key constraint "kb_chunks_document_id_fkey"' } };
        }
        const created = payload.map(p => ({ id: `${table}-${++seq}`, ...p }));
        rows().push(...created);
        return { data: created, error: null };
      }
      if (op === 'upsert') {
        return {
          data: payload.map(p => {
            const hit = rows().find(r => conflictKeys.every(k => r[k] === p[k]));
            if (hit) return Object.assign(hit, p);
            const created = { id: `${table}-${++seq}`, ...p };
            rows().push(created);
            return created;
          }),
          error: null,
        };
      }
      const hit = rows().filter(r => filters.every(f => f(r)));
      if (op === 'update') {
        hit.forEach(r => Object.assign(r, patch));
        return { data: hit, error: null };
      }
      if (op === 'delete') {
        db[table] = rows().filter(r => !hit.includes(r));
        // kb_chunks.document_id 外键 ON DELETE CASCADE
        if (table === 'kb_documents') {
          const gone = new Set(hit.map(r => r.id));
          db.kb_chunks = db.kb_chunks.filter(c => !gone.has(c.document_id));
        }
        return { data: hit, error: null };
      }
      return { data: limit === undefined ? hit : hit.slice(0, limit), error: null };
    };
    const run = async (terminal: 'single' | 'maybeSingle' | 'many') => {
      const { data, error } = await execute();
      if (error) return { data: null, error };
      const out = data!.map(view);
      if (terminal === 'many') return { data: out, error: null };
      if (!out[0]) return { data: null, error: terminal === 'single' ? { message: 'no rows' } : null };
      return { data: out[0], error: null };
    };
    const builder: Record<string, unknown> = {
      select: (cols = '*') => { columns = cols; return builder; },
      insert: (p: Row | Row[]) => { op = 'insert'; payload = Array.isArray(p) ? p : [p]; return builder; },
      upsert: (p: Row | Row[], opts?: { onConflict?: string }) => {
        op = 'upsert';
        payload = Array.isArray(p) ? p : [p];
        conflictKeys = opts?.onConflict?.split(',') ?? ['id'];
        return builder;
      },
      update: (p: Row) => { op = 'update'; patch = p; return builder; },
      delete: () => { op = 'delete'; return builder; },
      eq: (col: string, value: unknown) => where(col, v => v === value),
      neq: (col: string, value: unknown) => where(col, v => v !== value),
      is: (col: string, value: unknown) => where(col, v => (v ?? null) === value),
      in: (col: string, values: unknown[]) => where(col, v => values.includes(v)),
      order: () => builder,
      limit: (n: number) => { limit = n; return builder; },
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => run('many').then(ok, fail),
    };
    return builder;
  };

  // match_kb_chunk_vectors（080）：课程资料（不属于任何空间）全课可见，附件的空间要在 p_space_ids 里；
  // 067 起来源笔记还得没删。都是先过滤、再按相关度取前 k 片。片段上的 embedding 代表「有当前模型的向量」
  const rpc = async (fn: string, args: Record<string, any>) => {
    // 关键词那一路：这里的用例都走向量，关键词对不上任何片段
    if (fn === 'match_kb_chunks_keyword') return { data: [], error: null };
    // 085：这门课有没有检索得到的片段（这里没有开关，只看删没删）
    if (fn === 'kb_course_searchable') {
      const live = (noteId: unknown) => db.notes.some(n => n.id === noteId && n.deleted_at == null);
      return {
        data: db.kb_chunks.some(c => {
          const d = db.kb_documents.find(doc => doc.id === c.document_id);
          return c.course_id === args.p_course_id && !!d && (d.material_id != null || live(d.note_id));
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
      .filter(({ d }) => (d.space_id == null && d.material_id != null) || allowed.includes(d.space_id))
      .filter(({ d }) => state.migration === '065' || d.note_id == null || liveNote(d.note_id))
      .sort((x, y) => Number(y.c.score ?? 0.5) - Number(x.c.score ?? 0.5))
      .slice(0, Math.max(1, Math.min(Number(args.p_match_count ?? 6), 20)));
    return {
      data: hits.map(({ c, d }) => ({
        chunk_id: c.id, document_id: d.id, title: d.title, heading_path: c.heading_path, content: c.content,
        similarity: Number(c.score ?? 0.5), space_id: d.space_id, material_id: d.material_id,
      })),
      error: null,
    };
  };

  const textOf = (noteId: string) => {
    const marker = { 'note-paper': TEXT.paper, 'note-slides': TEXT.slides, 'note-upload': TEXT.upload,
      'note-old': TEXT.old, 'note-waiting': TEXT.waiting, 'note-gone': TEXT.gone }[noteId];
    return { text: marker ? body(marker) : '', source: 'pdf' as const, pending: false };
  };

  const reset = () => {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, seed());
    state.user = { id: 'student-a', role: 'student' };
    state.migration = '065';
    state.failing.clear();
    state.writes.length = 0;
    state.at = null;
  };

  return {
    TEXT,
    db,
    state,
    from,
    rpc,
    reset,
    attachment,
    // 上传后的解析（MinerU 那几轮）和换了文件后的重算
    resolveText: vi.fn(async (note: { id: string }) => {
      await fire('parse');
      return textOf(note.id);
    }),
    refreshText: vi.fn(async (note: { id: string }) => textOf(note.id)),
    /** 入库写完片段后叫后台补向量。这里当场补上：片段有了当前模型的向量，检索就找得到 */
    kick: vi.fn(() => {
      for (const c of db.kb_chunks) c.embedding ??= '[0.1]';
    }),
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
    req.user = { ...h.state.user, name: h.state.user.id };
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('./embeddingService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./embeddingService')>()),
  embedNote: async () => {},
}));
vi.mock('./kbEmbedding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./kbEmbedding')>()),
  kbEmbeddingConfigured: () => true,
  embedKbQuery: async () => [0.1],
}));
vi.mock('./kbVectorJob', () => ({ kickKbVectors: h.kick }));
// 重排没拿到：按向量的顺序给（这里测的是删除，不是排序）
vi.mock('./kbRerank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./kbRerank')>()),
  rerankKb: async () => null,
}));
vi.mock('./documentPipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./documentPipeline')>()),
  resolveDocumentText: h.resolveText,
  refreshDocumentText: h.refreshText,
}));
vi.mock('./metricsService', () => ({ updateHeatScore: async () => {}, getSpaceMetricsSummary: async () => ({}) }));
vi.mock('./aiGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiGateway')>()),
  aiFetch: h.aiFetch,
}));
vi.mock('./aiProviderConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiProviderConfig')>()),
  decryptProviderApiKey: () => 'sk-test',
}));

import { searchKnowledgeBase } from './knowledgeBase';
import { scheduleKbIngest, scheduleKbRefresh, sweepPendingDocuments } from './kbIngest';
import { createDefaultRegistry } from './agentTools';
import { invalidateMembershipCache, invalidateSpaceCache } from './accessControl';
import notesRouter from '../routes/notes';
import noteConversationsRouter from '../routes/noteConversations';
import { errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', notesRouter);
  app.use('/api', noteConversationsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  h.reset();
  h.resolveText.mockClear();
  h.refreshText.mockClear();
  h.kick.mockClear();
  h.aiFetch.mockClear();
  invalidateMembershipCache();
  invalidateSpaceCache();
});

const as = (id: string) => { h.state.user = { id, role: id === 'owner-1' ? 'teacher' : 'student' }; };
const del = async (noteId: string) => {
  const res = await fetch(`${base}/notes/${noteId}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const note = (id: string) => h.db.notes.find(n => n.id === id)!;
const kbDoc = (noteId: string) => h.db.kb_documents.find(d => d.note_id === noteId);
const chunkTexts = () => h.db.kb_chunks.map(c => String(c.content)).join('\n');
const search = (userId = 'student-b', limit = 20) =>
  searchKnowledgeBase('course-1', { id: userId, role: 'student' }, '访谈提纲和实验方案', limit);
const found = async () => JSON.stringify(await search());
/**
 * 后台入库不给回调。同一条附件的解析和入库按顺序排队，在它后面再排一轮换文件后的重算：
 * 那一轮跑完，前面排的就都跑完了。已删的附件那一轮什么也不做；还在的，正文没变就跳过。
 */
const afterQueued = (noteId: string) => scheduleKbRefresh(noteId);

describe('删掉附件：知识库里那份跟着清掉，迁移 067 之前也检索不到', () => {
  it('学生删掉自己上传的附件：检索、智能体工具、笔记 AI 对话都拿不到它，课程资料和别人的附件照旧', async () => {
    // 删之前检索得到，下面的断言才不是空的
    expect(await found()).toContain(h.TEXT.paper);

    as('student-a');
    const res = await del('note-paper');

    expect(res.status).toBe(200);
    expect(note('note-paper').deleted_at).toBeTruthy();
    expect(kbDoc('note-paper')).toBeUndefined();
    expect(chunkTexts()).not.toContain(h.TEXT.paper);
    expect(h.db.kb_documents.map(d => d.id).sort()).toEqual(['doc-material', 'doc-slides']);

    const hits = await found();
    expect(hits).not.toContain(h.TEXT.paper);
    expect(hits).toContain(h.TEXT.slides);
    expect(hits).toContain(h.TEXT.material);

    const tool = await createDefaultRegistry().executeTool('search_course_materials', { query: '访谈提纲', limit: 10 }, {
      noteId: 'note-idea', spaceId: 'space-shared', courseId: 'course-1', userId: 'student-b', userRole: 'student',
      noteTitle: '', noteContent: '',
    });
    expect(tool.success).toBe(true);
    expect(JSON.stringify(tool)).not.toContain(h.TEXT.paper);
    expect(JSON.stringify(tool)).toContain(h.TEXT.slides);

    as('student-b');
    const chat = await fetch(`${base}/note-conversations/thread-b/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '访谈提纲怎么写', provider_id: 'deepseek', model: 'deepseek-chat', agent_mode: 'idea_coach' }),
    });
    await chat.text();
    expect(chat.status).toBe(200);
    const prompt = h.aiFetch.mock.calls.map(([, init]) => init?.body ?? '').join('\n');
    expect(prompt).toContain('COURSE MATERIALS');
    expect(prompt).toContain(h.TEXT.slides);
    expect(prompt).not.toContain(h.TEXT.paper);
  });

  it('没删成（403）、删的是普通笔记：知识库一行不动', async () => {
    as('student-b');
    expect((await del('note-paper')).status).toBe(403);
    expect((await del('note-idea')).status).toBe(200);

    expect(h.db.kb_documents.map(d => d.id).sort()).toEqual(['doc-material', 'doc-paper', 'doc-slides']);
    expect(h.db.kb_chunks).toHaveLength(3);
    expect(await found()).toContain(h.TEXT.paper);
  });

  it('知识库清理出错：删除照样成功（笔记已经删了），检索由 067 的数据库函数兜底', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.state.failing.add('kb_documents:delete');
    as('student-a');
    const res = await del('note-paper');
    quiet.mockRestore();

    expect(res.status).toBe(200);
    expect(note('note-paper').deleted_at).toBeTruthy();
    expect(kbDoc('note-paper')).toBeDefined();

    h.state.migration = '067';
    expect(await found()).not.toContain(h.TEXT.paper);
  });
});

describe('后台入库不把删掉的附件写回去', () => {
  const RACES: [label: string, point: 'parse' | 'upsert' | 'chunks'][] = [
    ['解析期间（还没开始写知识库）', 'parse'],
    ['查完没删、写知识库之前', 'upsert'],
    ['写片段之前（文档行已写、片段还没写）', 'chunks'],
  ];

  it.each(RACES)('上传后马上删，删除落在%s：跑完之后知识库里没有它', async (_label, point) => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    as('student-a');
    let deleted = 0;
    h.state.at = { point, run: async () => { deleted = (await del('note-upload')).status; } };

    scheduleKbIngest('note-upload');
    await afterQueued('note-upload');
    quiet.mockRestore();

    expect(deleted).toBe(200);
    expect(h.resolveText).toHaveBeenCalledTimes(1);
    expect(kbDoc('note-upload')).toBeUndefined();
    expect(chunkTexts()).not.toContain(h.TEXT.upload);
    expect(await found()).not.toContain(h.TEXT.upload);
    // 只清被删的那一份
    expect(h.db.kb_documents.map(d => d.id).sort()).toEqual(['doc-material', 'doc-paper', 'doc-slides']);
  });

  it('解析期间就删了：知识库一行不写，也不叫后台补向量', async () => {
    as('student-a');
    h.state.at = { point: 'parse', run: async () => { await del('note-upload'); } };

    scheduleKbIngest('note-upload');
    await afterQueued('note-upload');

    expect(h.state.at).toBeNull();
    expect(h.state.writes.filter(w => w === 'kb_documents:upsert' || w === 'kb_chunks:insert')).toEqual([]);
    expect(h.kick).not.toHaveBeenCalled();
  });

  it('对照：没人删的时候，同一条链路照常入库', async () => {
    scheduleKbIngest('note-upload');
    await afterQueued('note-upload');

    expect(kbDoc('note-upload')).toMatchObject({ status: 'ready', space_id: 'space-shared' });
    expect(await found()).toContain(h.TEXT.upload);
    // 关键词检索的词序列随片段一起写（082）
    const chunks = h.db.kb_chunks.filter(c => c.document_id === kbDoc('note-upload')!.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => typeof c.search_text === 'string' && Number(c.search_len) > 0)).toBe(true);
  });

  it('删掉之后 MinerU 轮询的下一轮：不再解析，也不再入库', async () => {
    as('student-a');
    expect((await del('note-paper')).status).toBe(200);

    scheduleKbIngest('note-paper');
    await afterQueued('note-paper');

    expect(h.resolveText).not.toHaveBeenCalled();
    expect(h.refreshText).not.toHaveBeenCalled();
    expect(kbDoc('note-paper')).toBeUndefined();
    expect(await found()).not.toContain(h.TEXT.paper);
  });

  it('启动续跑：删掉的附件不占名额，名额留给还在解析的', async () => {
    h.db.notes.push(
      h.attachment('note-gone', 'student-a', '草稿', { deleted_at: '2026-09-20T00:00:00Z' }),
      h.attachment('note-waiting', 'student-b', '课程报告'),
    );
    const pending = { mineru_state: 'running', markdown: null, space_id: 'space-shared' };
    h.db.document_renders.push({ note_id: 'note-gone', ...pending }, { note_id: 'note-waiting', ...pending });

    expect(await sweepPendingDocuments(1)).toBe(1);
    await Promise.all([afterQueued('note-gone'), afterQueued('note-waiting')]);

    expect(h.resolveText.mock.calls.map(([n]) => n.id)).toEqual(['note-waiting']);
    expect(kbDoc('note-gone')).toBeUndefined();
    expect(kbDoc('note-waiting')).toBeDefined();
    expect(await found()).not.toContain(h.TEXT.gone);
  });
});

describe('数据库函数（067）：来源笔记删掉的文档一片都不给', () => {
  it('上线前删的、清理失败留下的残留检索不到；先过滤再取前 k 片，残留再多也挤不掉能看的', async () => {
    h.db.notes.push(h.attachment('note-old', 'student-a', '旧讲义', { deleted_at: '2026-09-20T00:00:00Z' }));
    h.db.kb_documents.push({ id: 'doc-old', course_id: 'course-1', space_id: 'space-shared', note_id: 'note-old', material_id: null, source_type: 'attachment', title: '旧讲义', status: 'ready' });
    for (let i = 0; i < 30; i += 1) {
      h.db.kb_chunks.push({ id: `chunk-old-${i}`, document_id: 'doc-old', course_id: 'course-1', heading_path: null, content: `${h.TEXT.old} 第 ${i} 段`, embedding: '[0.1]', score: 0.99 });
    }
    h.state.migration = '067';

    const hits = await search('student-b', 3);

    expect(hits.map(hit => hit.documentId).sort()).toEqual(['doc-material', 'doc-paper', 'doc-slides']);
    expect(JSON.stringify(hits)).not.toContain(h.TEXT.old);
  });
});

describe('防回归：检索函数和删除接口都认 deleted_at', () => {
  const migrationsDir = resolve(__dirname, '../../../supabase/migrations');
  const migrations = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const sql = (file: string) => readFileSync(resolve(migrationsDir, file), 'utf-8');
  const DEFINES = /create (or replace )?function public\.match_kb_chunk_vectors/i;
  const defining = migrations.filter(file => DEFINES.test(sql(file)));
  const latest = sql(defining[defining.length - 1]);
  const body = latest.slice(latest.search(DEFINES));

  it('最新一版 match_kb_chunk_vectors 在取前 k 片之前排除已删的来源笔记，课程资料照旧（上面模拟 067 的就是这个语义）', () => {
    expect(body).toContain('d.note_id is null');
    expect(body).toContain('where n.id = d.note_id and n.deleted_at is null');
    expect(body.indexOf('n.deleted_at is null')).toBeLessThan(body.indexOf('order by'));
    // 其余照 065：调用者身份执行、找得到 pgvector、只给 service_role
    expect(body).toMatch(/language sql stable security invoker\s+set search_path = public, extensions/);
    expect(body).toMatch(/revoke execute on function public\.match_kb_chunk_vectors\(uuid, text, extensions\.halfvec, integer, uuid\[\]\) from public, anon, authenticated/);
    expect(body).toMatch(/grant execute on function public\.match_kb_chunk_vectors\(uuid, text, extensions\.halfvec, integer, uuid\[\]\) to service_role/);
  });

  it('关键词兜底（082）同样在取前 k 片之前排除已删的来源笔记', () => {
    const KW = /create (or replace )?function public\.match_kb_chunks_keyword/i;
    const files = migrations.filter(file => KW.test(sql(file)));
    const text = sql(files[files.length - 1]);
    const kw = text.slice(text.search(KW));
    expect(kw).toContain('where n.id = d.note_id and n.deleted_at is null');
    expect(kw.indexOf('n.deleted_at is null')).toBeLessThan(kw.indexOf('order by'));
  });

  it('后台补向量的待办也跳过来源笔记已删的文档：不为马上要清掉的东西花钱', () => {
    const MISSING = /create (or replace )?function public\.kb_chunks_missing_vectors/i;
    const files = migrations.filter(file => MISSING.test(sql(file)));
    const text = sql(files[files.length - 1]);
    const missing = text.slice(text.search(MISSING));
    expect(missing).toContain('where n.id = d.note_id and n.deleted_at is null');
  });

  it('067 清掉了之前删掉的附件在知识库里的残留', () => {
    expect(sql('067_kb_exclude_deleted_notes.sql')).toMatch(/delete from public\.kb_documents d\s+using public\.notes n\s+where n\.id = d\.note_id\s+and n\.deleted_at is not null/);
  });

  it('API 里软删除笔记只有 DELETE /notes/:id 一处，它在写 deleted_at 之后清知识库', () => {
    const apiSrc = resolve(__dirname, '..');
    // 这几处也写 deleted_at，但删的不是笔记，不进知识库，不受这条约束：
    //   routes/noteConversations.ts —— 学生删自己的 AI 对话（071，DELETE /note-conversations/:id，行和消息留给研究导出）
    const NOT_NOTES = ['routes/noteConversations.ts'];
    const writers = (readdirSync(apiSrc, { recursive: true }) as string[])
      .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !NOT_NOTES.includes(file))
      .filter(file => /deleted_at:\s*new Date/.test(readFileSync(resolve(apiSrc, file), 'utf-8')));
    expect(writers).toEqual(['routes/notes.ts']);

    const src = readFileSync(resolve(apiSrc, 'routes/notes.ts'), 'utf-8');
    const handler = src.slice(src.indexOf("router.delete('/notes/:id'"));
    const route = handler.slice(0, handler.indexOf('\n});'));
    expect(route).toContain('dropNoteFromKb(noteId)');
    expect(route.indexOf('deleted_at: new Date')).toBeLessThan(route.indexOf('dropNoteFromKb(noteId)'));
  });
});
