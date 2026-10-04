import 'express-async-errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 进了空间之后的「教职」判断：改删别人的内容、教师才看的数据、实验模式的发帖限制。
 * 这些地方原先看平台身份（profiles.role），可任何教师账号拿学生验证码都能自助入课
 * （course_members.role='student'），被邀请、还没设为管理员的教师是 'member'——
 * 在课里都是普通成员，却能改删同学的笔记、看 AI 写给教师的评估、看对照组的影子记录、
 * 知道自己组是实验的哪一臂。现在一律按课内身份：平台管理员、创建者、课程管理员
 * （course_members.role 为 teacher/admin）。
 *
 * 路由挂在真实的 Express 上跑，accessControl 用真的，只替换数据库、鉴权和几个会调模型的服务。
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const T0 = '2026-09-01T00:00:00Z';
  const seed = (): Record<string, Row[]> => ({
    courses: [
      { id: 'course-1', title: '知识建构', instructor_id: 'owner-1' },
      { id: 'course-2', title: '另一门课', instructor_id: 'owner-2' },
    ],
    spaces: [
      { id: 'space-shared', course_id: 'course-1', group_id: null, title: '全班共享' },
      { id: 'space-a', course_id: 'course-1', group_id: 'group-a', title: '第一组' },
      { id: 'space-b', course_id: 'course-1', group_id: 'group-b', title: '第二组' },
      { id: 'space-other', course_id: 'course-2', group_id: null, title: '另一门课的空间' },
    ],
    course_members: [
      { course_id: 'course-1', user_id: 'owner-1', role: 'teacher' },
      { course_id: 'course-1', user_id: 'co-teacher', role: 'teacher' }, // 课程管理员
      { course_id: 'course-1', user_id: 'teacher-joined', role: 'student' }, // 教师账号凭学生验证码入课
      { course_id: 'course-1', user_id: 'teacher-invited', role: 'member' }, // 被邀请、还没设为管理员
      { course_id: 'course-1', user_id: 'student-a', role: 'student' },
      { course_id: 'course-1', user_id: 'student-b', role: 'student' },
      // 学生账号直连数据库给自己写的管理员行：成员行只由创建者授给教师账号，这种行不算数
      { course_id: 'course-1', user_id: 'student-forged', role: 'teacher' },
      { course_id: 'course-2', user_id: 'owner-2', role: 'teacher' },
      { course_id: 'course-2', user_id: 'student-a', role: 'student' },
    ],
    groups: [
      { id: 'group-a', course_id: 'course-1', name: '第一组', ai_feedback_condition: 'treatment', created_at: T0 },
      { id: 'group-b', course_id: 'course-1', name: '第二组', ai_feedback_condition: 'control', created_at: T0 },
      { id: 'group-other', course_id: 'course-2', name: '另一门课的组', ai_feedback_condition: null, created_at: T0 },
    ],
    group_members: [
      { group_id: 'group-a', user_id: 'student-a', joined_at: T0 },
      { group_id: 'group-a', user_id: 'teacher-joined', joined_at: T0 },
      { group_id: 'group-b', user_id: 'student-b', joined_at: T0 },
      // 已被移出 course-1：移出课程不删组员行
      { group_id: 'group-a', user_id: 'student-removed', joined_at: T0 },
    ],
    profiles: [
      { id: 'owner-1', role: 'teacher', full_name: '创建者' },
      { id: 'co-teacher', role: 'teacher', full_name: '课程管理员' },
      { id: 'teacher-joined', role: 'teacher', full_name: '入课的教师' },
      { id: 'teacher-invited', role: 'teacher', full_name: '被邀请的教师' },
      { id: 'student-a', role: 'student', full_name: '学生甲' },
      { id: 'student-b', role: 'student', full_name: '学生乙' },
      { id: 'platform-admin', role: 'admin', full_name: '平台管理员' },
      { id: 'student-forged', role: 'student', full_name: '学生丙' },
      { id: 'owner-2', role: 'teacher', full_name: '另一门课的创建者' },
      { id: 'student-removed', role: 'student', full_name: '已退课的学生' },
    ],
    notes: [
      { id: 'note-a', space_id: 'space-shared', author_id: 'student-a', type: 'note', title: '学生甲的观点', content: '<p>原文</p>', created_at: T0 },
      { id: 'note-b', space_id: 'space-shared', author_id: 'student-b', type: 'note', title: '学生乙的观点', content: '<p>原文</p>', created_at: T0 },
      {
        id: 'note-doc', space_id: 'space-shared', author_id: 'student-a', type: 'attachment', title: '阅读材料',
        file_url: 'https://storage.example/a.docx', file_name: 'a.docx', mime_type: 'application/msword', created_at: T0,
      },
    ],
    views: [{ id: 'view-1', space_id: 'space-shared', creator_id: 'student-a', title: '学生甲的视图', created_at: T0 }],
    view_cards: [{ id: 'card-1', space_id: 'space-shared', view_id: 'view-1', host_view_id: 'view-welcome', x: 0, y: 0, created_by: 'student-a' }],
    relations: [
      { id: 'rel-1', space_id: 'space-shared', source_note_id: 'note-a', target_note_id: 'note-b', relation_type: 'extend', creator_id: 'student-a' },
      // 早期的 Build-on 没有 space_id，权限走来源笔记
      { id: 'rel-legacy', space_id: null, source_note_id: 'note-a', target_note_id: 'note-b', relation_type: 'question', creator_id: 'student-a' },
      // 学生甲在另一门课里接的
      { id: 'rel-elsewhere', space_id: 'space-other', source_note_id: 'note-x', target_note_id: 'note-y', relation_type: 'evidence', creator_id: 'student-a' },
    ],
    space_shapes: [{ id: 'shape-1', space_id: 'space-shared', shape_type: 'rect', text: '分区', created_by: 'student-a' }],
    doc_annotations: [{ id: 'ann-1', note_id: 'note-doc', space_id: 'space-shared', author_id: 'student-a', body: '这里的论证跳了一步' }],
    note_conversation_threads: [
      { id: 'thread-a', note_id: 'note-doc', space_id: 'space-shared', course_id: 'course-1', target_type: 'ai', created_by: 'student-a', title: '学生甲问 AI', updated_at: T0 },
      { id: 'thread-b', note_id: 'note-doc', space_id: 'space-shared', course_id: 'course-1', target_type: 'ai', created_by: 'student-b', title: '学生乙问 AI', updated_at: T0 },
    ],
    note_conversation_messages: [
      { id: 'msg-a', thread_id: 'thread-a', sender_kind: 'user', content: '这段在说什么？', created_at: T0 },
      { id: 'msg-b', thread_id: 'thread-b', sender_kind: 'user', content: '作者的论据可靠吗？', created_at: T0 },
    ],
    riseabove_rooms: [{
      id: 'room-1', space_id: 'space-shared', course_id: 'course-1', group_id: null, created_by: 'student-a',
      source_note_ids: ['note-a', 'note-b'], title: '讨论室', status: 'open', published_note_id: null, card_x: 0, card_y: 0,
    }],
    note_feedbacks: [{
      id: 'fb-1', note_id: 'note-a', space_id: 'space-shared', is_published: true, is_read: false,
      ai_evaluation: '写给教师的评估：需要介入', student_summary: '写给学生的总结', created_at: T0,
    }],
    ai_interventions: [
      { id: 'iv-shown', space_id: 'space-shared', user_id: 'student-a', trigger_type: 'T1', suppressed: false, created_at: T0 },
      // 对照组的影子记录：学生看到它就知道自己在对照组
      { id: 'iv-shadow', space_id: 'space-shared', user_id: 'student-b', trigger_type: 'T3', suppressed: true, group_id: 'group-b', created_at: T0 },
    ],
    group_tasks: [
      { id: 'task-a', group_id: 'group-a', title: '整理资料', created_by_id: 'student-a', status: 'todo', ssrl_phase: 'planning' },
      { id: 'task-b', group_id: 'group-b', title: '写综述', created_by_id: 'student-b', status: 'done', ssrl_phase: 'evaluating' },
    ],
    group_idea_graphs: [
      { id: 'graph-a', group_id: 'group-a', generated_at: T0, window_start: T0, window_end: T0, note_count: 6, trigger: 'auto' },
      { id: 'graph-b', group_id: 'group-b', generated_at: T0, window_start: T0, window_end: T0, note_count: 7, trigger: 'auto' },
    ],
    course_tasks: [
      { id: 'ctask-1', course_id: 'course-1', title: '读书报告', status: 'published', created_at: T0 },
      { id: 'ctask-draft', course_id: 'course-1', title: '还没发布的任务', status: 'draft', created_at: T0 },
      { id: 'ctask-other', course_id: 'course-2', title: '另一门课的任务', status: 'published', created_at: T0 },
    ],
    task_submissions: [
      { id: 'sub-a', task_id: 'ctask-1', student_id: 'student-a', status: 'submitted', content: '学生甲的报告', submitted_at: T0 },
      { id: 'sub-b', task_id: 'ctask-1', student_id: 'student-b', status: 'submitted', content: '学生乙的报告', submitted_at: T0 },
      { id: 'sub-other', task_id: 'ctask-other', student_id: 'student-a', status: 'submitted', content: '另一门课的报告', submitted_at: T0 },
    ],
    document_renders: [],
    events: [],
  });

  const db = seed();
  const state = { user: { id: 'student-a', role: 'student' } as { id: string; role: string } };
  /** 每次读表记一笔：教职判断必须复用访问检查的结果，不能再多查一次库 */
  const reads: string[] = [];
  let nextId = 1;

  // upsert 不带 onConflict 时按主键冲突；document_renders 的主键是 note_id
  const PRIMARY_KEY: Record<string, string[]> = { document_renders: ['note_id'] };

  // 链式调用按条件在内存表里取行 / 写行；await、single、maybeSingle 时才执行
  const from = (table: string) => {
    type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
    const filters: Array<(r: Row) => boolean> = [];
    let op: Op = 'select';
    let columns = '*';
    let payload: Row[] = [];
    let conflictKeys: string[] = [];
    let patch: Row = {};
    let counting = false;
    let headOnly = false;
    let limit: number | undefined;
    const rows = () => (db[table] ??= []);
    const matching = () => rows().filter(r => filters.every(f => f(r)));
    const view = (r: Row): Row => {
      const out: Row = { ...r };
      if (table === 'spaces' && columns.includes('courses')) {
        out.courses = { instructor_id: db.courses.find(c => c.id === r.course_id)?.instructor_id ?? null };
      }
      if (table === 'groups' && columns.includes('group_members')) {
        out.group_members = db.group_members.filter(m => m.group_id === r.id).map(m => ({ ...m }));
      }
      return out;
    };
    const execute = (): Row[] => {
      if (op === 'insert') {
        const created = payload.map(p => ({ id: `${table}-new-${nextId++}`, ...p }));
        rows().push(...created);
        return created;
      }
      if (op === 'upsert') {
        return payload.map(p => {
          const existing = rows().find(r => conflictKeys.every(k => r[k] === p[k]));
          if (existing) return Object.assign(existing, p);
          rows().push({ ...p });
          return p;
        });
      }
      if (op === 'update') {
        const hit = matching();
        hit.forEach(r => Object.assign(r, patch));
        return hit;
      }
      if (op === 'delete') {
        const hit = matching();
        db[table] = rows().filter(r => !hit.includes(r));
        return hit;
      }
      reads.push(table);
      const found = matching();
      return limit === undefined ? found : found.slice(0, limit);
    };
    const run = (terminal: 'single' | 'maybeSingle' | 'many') => {
      const found = execute().map(view);
      if (terminal === 'many') return { data: headOnly ? null : found, error: null, count: counting ? found.length : null };
      if (!found[0]) return { data: null, error: terminal === 'single' ? { message: 'no rows' } : null };
      return { data: found[0], error: null };
    };
    const compare = (test: (a: string, b: string) => boolean) => (col: string, value: unknown) => {
      filters.push(r => r[col] != null && test(String(r[col]), String(value)));
      return builder;
    };
    const builder: Record<string, unknown> = {
      select: (cols = '*', opts?: { count?: string; head?: boolean }) => {
        columns = cols;
        counting = Boolean(opts?.count);
        headOnly = Boolean(opts?.head);
        return builder;
      },
      insert: (p: Row | Row[]) => { op = 'insert'; payload = Array.isArray(p) ? p : [p]; return builder; },
      upsert: (p: Row | Row[], opts?: { onConflict?: string }) => {
        op = 'upsert';
        payload = Array.isArray(p) ? p : [p];
        conflictKeys = opts?.onConflict?.split(',') ?? PRIMARY_KEY[table] ?? ['id'];
        return builder;
      },
      update: (p: Row) => { op = 'update'; patch = p; return builder; },
      delete: () => { op = 'delete'; return builder; },
      eq: (col: string, value: unknown) => { filters.push(r => r[col] === value); return builder; },
      neq: (col: string, value: unknown) => { filters.push(r => r[col] !== value); return builder; },
      in: (col: string, values: unknown[]) => { filters.push(r => values.includes(r[col])); return builder; },
      is: (col: string, value: unknown) => { filters.push(r => (r[col] ?? null) === value); return builder; },
      gt: compare((a, b) => a > b),
      gte: compare((a, b) => a >= b),
      lt: compare((a, b) => a < b),
      order: () => builder,
      range: () => builder,
      limit: (n: number) => { limit = n; return builder; },
      single: async () => run('single'),
      maybeSingle: async () => run('maybeSingle'),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve().then(() => run('many')).then(ok, fail),
    };
    return builder;
  };

  const reset = () => {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, seed());
    state.user = { id: 'student-a', role: 'student' };
    reads.length = 0;
  };

  return { db, state, reads, from, reset, fetchExperimentMode: vi.fn(async () => false) };
});

vi.mock('../config/supabase', () => ({
  supabase: { from: h.from, rpc: async () => ({ data: null, error: null }) },
}));
vi.mock('../middleware/auth', () => ({
  verifyJWT: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { ...h.state.user, name: h.state.user.id };
    next();
  },
  requireRole: (...roles: string[]) => (
    req: { user?: { role: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  },
}));
vi.mock('../services/experimentCondition', () => ({
  fetchExperimentMode: h.fetchExperimentMode,
  resolveEffectiveCondition: async () => ({ condition: null, groupId: null, experimentMode: false }),
  invalidateConditionCache: () => {},
}));
vi.mock('../services/kbIngest', () => ({ scheduleKbIngest: () => {}, ingestNoteIntoKb: async () => {}, dropNoteFromKb: async () => {} }));
vi.mock('../services/embeddingService', () => ({ embedNote: async () => {} }));
vi.mock('../services/metricsService', () => ({ updateHeatScore: async () => {}, getSpaceMetricsSummary: async () => ({}) }));
vi.mock('../services/documentPipeline', () => ({ resolveDocumentText: async () => ({ text: '', source: 'none', pending: false }) }));
vi.mock('../services/knowledgeBase', () => ({ knowledgeBaseStats: async () => ({}) }));
vi.mock('../services/aiGateway', () => ({ aiFetch: async () => { throw new Error('no model calls in this test'); } }));
vi.mock('../services/aiProviderConfig', () => ({
  decryptProviderApiKey: () => 'sk-test',
  withDeepSeekOptions: (_provider: string, _model: string, body: unknown) => body,
}));
vi.mock('./thinkingTrainer', () => ({
  resolveCourseProviderChain: async () => [],
  callJson: async () => null,
  callChat: async () => null,
}));
vi.mock('../services/groupIdeaGraph', () => ({
  buildGroupIdeaGraph: async () => ({ payload: {}, noteCount: 0 }),
  fetchLatestIdeaGraph: async () => null,
  shouldRegenerate: () => false,
  IDEA_GRAPH_PERIOD_DAYS: 7,
  MIN_NOTES_FOR_GRAPH: 5,
}));

import notesRouter from './notes';
import viewsRouter from './views';
import relationsRouter from './relations';
import shapesRouter from './shapes';
import documentsRouter from './documents';
import riseAboveRouter from './riseAbove';
import feedbackRouter from './feedback';
import metricsRouter from './metrics';
import researchRouter from './research';
import triggersRouter from './triggers';
import groupsRouter from './groups';
import courseSettingsRouter from './courseSettings';
import { errorHandler } from '../middleware/errorHandler';
import { invalidateMembershipCache, invalidateSpaceCache } from '../services/accessControl';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  for (const router of [
    notesRouter, viewsRouter, relationsRouter, shapesRouter, documentsRouter, riseAboveRouter,
    feedbackRouter, metricsRouter, researchRouter, triggersRouter, groupsRouter, courseSettingsRouter,
  ]) {
    app.use('/api', router);
  }
  app.use(errorHandler);
  server = await new Promise<Server>(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>(done => server.close(() => done())));

beforeEach(() => {
  h.reset();
  h.fetchExperimentMode.mockReset();
  h.fetchExperimentMode.mockResolvedValue(false);
  invalidateMembershipCache();
  invalidateSpaceCache();
});

const ROLE_OF: Record<string, string> = {
  'owner-1': 'teacher',
  'co-teacher': 'teacher',
  'platform-admin': 'admin',
  'teacher-joined': 'teacher',
  'teacher-invited': 'teacher',
  'student-a': 'student',
  'student-b': 'student',
  'student-forged': 'student',
  'owner-2': 'teacher',
  'student-removed': 'student',
};
const as = (id: string) => { h.state.user = { id, role: ROLE_OF[id] }; };

/** 课程教职：创建者、课程管理员、平台管理员（不在课里也算） */
const STAFF = ['owner-1', 'co-teacher', 'platform-admin'];
/** 课里的普通成员。前两个的平台身份是教师，正是这次要堵的人 */
const MEMBERS = ['teacher-joined', 'teacher-invited', 'student-b'];

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(method: Method, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, any> };
}

const row = (table: string, id: string) => h.db[table]?.find(r => r.id === id);
const gone = (table: string, id: string) => !row(table, id);

interface Edit {
  what: string;
  method: Method;
  path: string;
  body?: unknown;
  /** 这次改动是否真的落了库 */
  landed: () => boolean;
}

// 每一项都是学生甲（student-a）的东西，放在全班共享空间里：谁都进得来，只有作者和教职能动
const EDITS: Edit[] = [
  { what: '改笔记 PUT /notes/:id', method: 'PUT', path: '/notes/note-a', body: { content: '<p>被改掉了</p>' },
    landed: () => row('notes', 'note-a')?.content === '<p>被改掉了</p>' },
  { what: '删笔记 DELETE /notes/:id', method: 'DELETE', path: '/notes/note-a',
    landed: () => Boolean(row('notes', 'note-a')?.deleted_at) },
  { what: '改视图名 PUT /views/:id', method: 'PUT', path: '/views/view-1', body: { title: '改名' },
    landed: () => row('views', 'view-1')?.title === '改名' },
  { what: '删视图 DELETE /views/:id', method: 'DELETE', path: '/views/view-1', landed: () => gone('views', 'view-1') },
  { what: '移走视图卡片 DELETE /view-cards/:id', method: 'DELETE', path: '/view-cards/card-1', landed: () => gone('view_cards', 'card-1') },
  { what: '改 Build-on 类型 PUT /relations/:id/type', method: 'PUT', path: '/relations/rel-1/type', body: { relation_type: 'challenge' },
    landed: () => row('relations', 'rel-1')?.relation_type === 'challenge' },
  { what: '删 Build-on DELETE /relations/:id', method: 'DELETE', path: '/relations/rel-1', landed: () => gone('relations', 'rel-1') },
  { what: '删没有 space_id 的旧 Build-on（按来源笔记鉴权）', method: 'DELETE', path: '/relations/rel-legacy',
    landed: () => gone('relations', 'rel-legacy') },
  { what: '改图形 PATCH /shapes/:id', method: 'PATCH', path: '/shapes/shape-1', body: { text: '改了' },
    landed: () => row('space_shapes', 'shape-1')?.text === '改了' },
  { what: '删图形 DELETE /shapes/:id', method: 'DELETE', path: '/shapes/shape-1', landed: () => gone('space_shapes', 'shape-1') },
  { what: '删批注 DELETE /doc-annotations/:id', method: 'DELETE', path: '/doc-annotations/ann-1', landed: () => gone('doc_annotations', 'ann-1') },
  { what: '替人发布讨论室 POST /riseabove-rooms/:id/publish', method: 'POST', path: '/riseabove-rooms/room-1/publish',
    body: { title: '更高一层的说法', content: '把两条笔记放在一起看，分歧其实在于对证据的理解不同。' },
    landed: () => row('riseabove_rooms', 'room-1')?.status === 'published' },
  { what: '替人标记反馈已读 PATCH /notes/:noteId/feedback/:id/read', method: 'PATCH', path: '/notes/note-a/feedback/fb-1/read',
    landed: () => row('note_feedbacks', 'fb-1')?.is_read === true },
  { what: '删别人的小组任务 DELETE /groups/:id/tasks/:taskId', method: 'DELETE', path: '/groups/group-a/tasks/task-a',
    landed: () => gone('group_tasks', 'task-a') },
  // 编辑后的正文还会重新进知识库，AI 答全课的问题时读的就是这一版
  { what: '改别人上传的 Word 正文 PUT /notes/:noteId/document', method: 'PUT', path: '/notes/note-doc/document',
    body: { markdown: '# 被改掉了' },
    landed: () => h.db.document_renders.some(r => r.note_id === 'note-doc' && r.markdown === '# 被改掉了') },
];

describe.each(EDITS)('改删别人的东西按课内身份：$what', (edit) => {
  it.each(MEMBERS)('%s 是课里的普通成员 → 403，库里没变', async (userId) => {
    as(userId);
    const res = await call(edit.method, edit.path, edit.body);
    expect(res.status).toBe(403);
    expect(edit.landed()).toBe(false);
  });

  it.each(STAFF)('%s 是课程教职 → 照常', async (userId) => {
    as(userId);
    const res = await call(edit.method, edit.path, edit.body);
    expect(res.status).toBe(200);
    expect(edit.landed()).toBe(true);
  });

  it('作者本人照常', async () => {
    as('student-a');
    const res = await call(edit.method, edit.path, edit.body);
    expect(res.status).toBe(200);
    expect(edit.landed()).toBe(true);
  });
});

describe('实验模式：只有课程教职能在共享空间发笔记，受试者按课内身份认', () => {
  const EXPERIMENT_MODE = '实验模式:请在你的小组空间发布笔记 / Experiment mode: please post in your group space';
  const post = (spaceId: string) => call('POST', `/spaces/${spaceId}/notes`, { title: '新想法', content: '<p>内容</p>' });

  beforeEach(() => { h.fetchExperimentMode.mockResolvedValue(true); });

  it.each(MEMBERS)('%s 在共享空间发笔记 → 403', async (userId) => {
    as(userId);
    expect(await post('space-shared')).toEqual({ status: 403, body: { error: EXPERIMENT_MODE } });
    expect(h.db.notes).toHaveLength(3);
  });

  it.each(STAFF)('%s 在共享空间照常发', async (userId) => {
    as(userId);
    expect((await post('space-shared')).status).toBe(201);
  });

  it('凭学生验证码入课的教师账号，在本组空间照常发', async () => {
    as('teacher-joined');
    expect((await post('space-a')).status).toBe(201);
  });

  it('没开实验模式：普通成员也能在共享空间发', async () => {
    h.fetchExperimentMode.mockResolvedValue(false);
    as('teacher-joined');
    expect((await post('space-shared')).status).toBe(201);
  });

  it('AI 摘录发布成笔记走同一道门', async () => {
    const publish = () => call('POST', '/notes/note-a/ai-selections/publish-note', {});

    as('teacher-joined');
    expect(await publish()).toEqual({ status: 403, body: { error: EXPERIMENT_MODE } });

    // 课程管理员过了这道门，停在后面的参数校验上
    as('co-teacher');
    expect(await publish()).toEqual({ status: 400, body: { error: 'selected_text is required' } });
  });
});

describe('教师才看的数据按课内身份给', () => {
  it.each(STAFF)('AI 写给教师的评估（ai_evaluation）：%s 看得到', async (userId) => {
    as(userId);
    const res = await call('GET', '/notes/note-a/feedback');
    expect(res.status).toBe(200);
    expect(res.body.feedbacks[0]).toMatchObject({ aiEvaluation: '写给教师的评估：需要介入', studentSummary: '写给学生的总结' });
  });

  it('笔记作者：看得到写给自己的那份，看不到 ai_evaluation', async () => {
    as('student-a');
    const res = await call('GET', '/notes/note-a/feedback');
    expect(res.status).toBe(200);
    expect(res.body.feedbacks[0].studentSummary).toBe('写给学生的总结');
    expect(res.body.feedbacks[0]).not.toHaveProperty('aiEvaluation');
  });

  // 教师反馈是写给作者的，口径同 RLS note_feedbacks_student_select。
  // 原先谁能打开这条笔记谁就读得到 studentSummary 和 teacherNote。
  it.each(MEMBERS)('教师反馈：%s 不是作者也不是教职，一条都拿不到', async (userId) => {
    as(userId);
    const res = await call('GET', '/notes/note-a/feedback');
    expect(res).toEqual({ status: 200, body: { feedbacks: [] } });
  });

  it('文档 AI 对话：课程教职看全部，其他人只看自己的', async () => {
    const threads = async (userId: string) => {
      as(userId);
      const res = await call('GET', '/notes/note-doc/doc-chat');
      expect(res.status).toBe(200);
      return (res.body.threads as { id: string }[]).map(t => t.id).sort();
    };
    for (const userId of STAFF) expect(await threads(userId)).toEqual(['thread-a', 'thread-b']);
    expect(await threads('teacher-joined')).toEqual([]);
    expect(await threads('teacher-invited')).toEqual([]);
    expect(await threads('student-a')).toEqual(['thread-a']);
  });

  it('对照组的影子记录（suppressed）只给课程教职：受试者看到就破了盲', async () => {
    const history = async (userId: string) => {
      as(userId);
      const res = await call('GET', '/spaces/space-shared/triggers/history');
      expect(res.status).toBe(200);
      return (res.body.interventions as { id: string }[]).map(i => i.id).sort();
    };
    for (const userId of STAFF) expect(await history(userId)).toEqual(['iv-shadow', 'iv-shown']);
    for (const userId of MEMBERS) expect(await history(userId)).toEqual(['iv-shown']);
  });

  describe.each([
    '/spaces/space-shared/metrics/participation',
    '/spaces/space-shared/metrics/ai-summary',
    '/spaces/space-shared/metrics/student/student-a',
    '/spaces/space-shared/research/summary',
  ])('全员数据 %s', (path) => {
    it.each(STAFF)('%s → 200', async (userId) => {
      as(userId);
      expect((await call('GET', path)).status).toBe(200);
    });

    it.each(MEMBERS)('%s → 403', async (userId) => {
      as(userId);
      expect((await call('GET', path)).status).toBe(403);
    });
  });

  it('研究数据：进得了自己组的空间也不行，得是课程教职', async () => {
    as('teacher-joined');
    expect((await call('GET', '/spaces/space-a/research/summary')).status).toBe(403);
    expect((await call('GET', '/spaces/space-a/metrics/participation')).status).toBe(403);

    as('co-teacher');
    expect((await call('GET', '/spaces/space-b/research/summary')).status).toBe(200);
  });

  it('研究数据按课程 id 取（全课）照旧只给课程教职', async () => {
    as('teacher-joined');
    expect((await call('GET', '/spaces/course-1/research/summary')).status).toBe(403);
    as('co-teacher');
    expect((await call('GET', '/spaces/course-1/research/summary')).status).toBe(200);
  });
});

describe('小组的实验条件只给课程教职（盲法）', () => {
  const conditions = async (userId: string) => {
    as(userId);
    const list = await call('GET', '/courses/course-1/groups');
    const one = await call('GET', '/groups/group-a');
    expect(list.status).toBe(200);
    expect(one.status).toBe(200);
    return {
      list: (list.body.groups as { id: string; aiFeedbackCondition: string | null }[]).map(g => [g.id, g.aiFeedbackCondition]),
      one: one.body.group.aiFeedbackCondition,
    };
  };

  it.each(STAFF)('%s 看得到每组是哪一臂', async (userId) => {
    expect(await conditions(userId)).toEqual({
      list: [['group-a', 'treatment'], ['group-b', 'control']],
      one: 'treatment',
    });
  });

  it.each([...MEMBERS, 'student-a'])('%s 看不到', async (userId) => {
    expect(await conditions(userId)).toEqual({
      list: [['group-a', null], ['group-b', null]],
      one: null,
    });
  });
});

/**
 * 工作区按这个值决定显示哪些教职才有的操作（改删别人的笔记和批注、逐组看任务板、重算观点图谱）。
 * 前端原先按平台身份猜，凭学生验证码入课的教师账号看得到按钮、点下去是 403。
 */
describe('分组名单带回调用者的课内身份', () => {
  it.each([
    ['owner-1', 'owner'],
    ['co-teacher', 'manager'],
    ['platform-admin', 'owner'],
    ['teacher-joined', 'member'],
    ['teacher-invited', 'member'],
    ['student-b', 'member'],
    ['student-forged', 'member'],
  ])('%s → %s', async (userId, standing) => {
    as(userId);
    const res = await call('GET', '/courses/course-1/groups');
    expect(res.status).toBe(200);
    expect(res.body.viewerStanding).toBe(standing);
  });

  it('不在课里的人拿不到名单，也就拿不到身份', async () => {
    as('owner-2');
    const res = await call('GET', '/courses/course-1/groups');
    expect(res.status).toBe(403);
    expect(res.body.viewerStanding).toBeUndefined();
  });
});

describe('小组任务统计：课程教职看全课，其他人只看自己组', () => {
  const stats = async (userId: string) => {
    as(userId);
    const res = await call('GET', '/courses/course-1/group-task-stats');
    expect(res.status).toBe(200);
    return { scope: res.body.scope, groups: (res.body.groups as { groupId: string }[]).map(g => g.groupId) };
  };

  it('课程教职', async () => {
    for (const userId of STAFF) expect(await stats(userId)).toEqual({ scope: 'course', groups: ['group-a', 'group-b'] });
  });

  it('凭学生验证码入课的教师账号只看自己组；没分组的被邀请教师一个组都看不到', async () => {
    expect(await stats('teacher-joined')).toEqual({ scope: 'group', groups: ['group-a'] });
    expect(await stats('teacher-invited')).toEqual({ scope: 'group', groups: [] });
  });
});

describe('观点图谱：课程教职看每个组，其他人只看自己组', () => {
  const graph = async (userId: string, groupId: string) => {
    as(userId);
    return (await call('GET', `/groups/${groupId}/idea-graph/history`)).status;
  };

  it('课程教职两个组都能看', async () => {
    for (const userId of STAFF) {
      expect(await graph(userId, 'group-a')).toBe(200);
      expect(await graph(userId, 'group-b')).toBe(200);
    }
  });

  it('凭学生验证码入课的教师账号按组员对待：本组能看（原先走教师分支，连本组都 403），别组不行', async () => {
    expect(await graph('teacher-joined', 'group-a')).toBe(200);
    expect(await graph('teacher-joined', 'group-b')).toBe(403);
  });

  it('没分组的被邀请教师哪个组都看不了；学生照旧只看本组', async () => {
    expect(await graph('teacher-invited', 'group-a')).toBe(403);
    expect(await graph('teacher-invited', 'group-b')).toBe(403);
    expect(await graph('student-a', 'group-a')).toBe(200);
    expect(await graph('student-a', 'group-b')).toBe(403);
  });
});

describe('学生账号带着一条管理员成员行，也只是普通成员', () => {
  it('改删不了同学的东西，看不到 ai_evaluation 和影子记录', async () => {
    as('student-forged');
    expect((await call('DELETE', '/notes/note-b')).status).toBe(403);
    expect((await call('DELETE', '/relations/rel-1')).status).toBe(403);
    expect((await call('GET', '/notes/note-a/feedback')).body.feedbacks).toEqual([]);
    const history = await call('GET', '/spaces/space-shared/triggers/history');
    expect((history.body.interventions as { id: string }[]).map(i => i.id)).toEqual(['iv-shown']);
    expect((await call('GET', '/courses/course-1/groups')).body.groups.map((g: any) => g.aiFeedbackCondition)).toEqual([null, null]);
  });
});

describe('授予 / 撤销课程管理员立刻生效：成员缓存存着课内身份，PATCH …/role 会清', () => {
  it('撤销后，原管理员立刻不能改同学的笔记，也看不到 ai_evaluation', async () => {
    as('co-teacher');
    expect((await call('GET', '/notes/note-a/feedback')).body.feedbacks[0].aiEvaluation).toBeTruthy();

    as('owner-1');
    expect((await call('PATCH', '/courses/course-1/members/co-teacher/role', { role: 'member' })).status).toBe(200);

    as('co-teacher');
    expect((await call('GET', '/notes/note-a/feedback')).body.feedbacks).toEqual([]);
    expect((await call('PUT', '/notes/note-a', { content: '<p>被改掉了</p>' })).status).toBe(403);
  });

  it('授予后，新管理员立刻能删同学的笔记', async () => {
    as('teacher-joined');
    expect((await call('DELETE', '/notes/note-b')).status).toBe(403);

    as('owner-1');
    expect((await call('PATCH', '/courses/course-1/members/teacher-joined/role', { role: 'manager' })).status).toBe(200);

    as('teacher-joined');
    expect((await call('DELETE', '/notes/note-b')).status).toBe(200);
  });
});

describe('教职判断复用访问检查的结果，不多查一次库', () => {
  it('改删别人的笔记：只有 ensureNoteAccess 那几次读，第二次请求命中缓存', async () => {
    as('teacher-joined');
    expect((await call('DELETE', '/notes/note-b')).status).toBe(403);
    expect(h.reads).toEqual(['notes', 'spaces', 'course_members']);

    h.reads.length = 0;
    expect((await call('DELETE', '/notes/note-b')).status).toBe(403);
    expect(h.reads).toEqual(['notes']);
  });

  it('课程级的判断（分组列表）同样走成员缓存', async () => {
    as('teacher-joined');
    await call('GET', '/courses/course-1/groups');
    expect(h.reads.filter(t => t === 'course_members')).toHaveLength(1);

    h.reads.length = 0;
    await call('GET', '/courses/course-1/groups');
    expect(h.reads.filter(t => t === 'course_members')).toHaveLength(0);
  });
});

/**
 * 小组是整群随机实验的分配单位，组空间组间隔离；任务板原先只查课程成员，
 * 组 A 的学生换一个组 id 就能读、建、改组 B 的任务。现在和组空间同一个口径。
 */
describe('小组任务板：只给本组成员和课程教职', () => {
  const tasksOf = async (userId: string, groupId: string) => {
    as(userId);
    return call('GET', `/groups/${groupId}/tasks`);
  };

  it('别组的人读不到：学生、凭学生验证码入课的教师账号、没分组的被邀请教师', async () => {
    for (const userId of ['student-a', 'teacher-joined', 'teacher-invited']) {
      const res = await tasksOf(userId, 'group-b');
      expect(res.status, userId).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('写综述');
    }
  });

  it('别组的人建不了、改不了', async () => {
    as('student-a');
    expect((await call('POST', '/groups/group-b/tasks', { title: '插进别组的任务' })).status).toBe(403);
    expect((await call('PATCH', '/groups/group-b/tasks/task-b', { status: 'todo', title: '被改了' })).status).toBe(403);
    expect(h.db.group_tasks.filter(t => t.group_id === 'group-b').map(t => [t.id, t.title, t.status]))
      .toEqual([['task-b', '写综述', 'done']]);
  });

  it('本组成员照常读写', async () => {
    const list = await tasksOf('student-b', 'group-b');
    expect(list.status).toBe(200);
    expect(list.body.tasks.map((t: { id: string }) => t.id)).toEqual(['task-b']);

    expect((await call('POST', '/groups/group-b/tasks', { title: '补一条证据' })).status).toBe(201);
    expect((await call('PATCH', '/groups/group-b/tasks/task-b', { status: 'in_progress' })).status).toBe(200);
    expect(row('group_tasks', 'task-b')?.status).toBe('in_progress');

    // 凭学生验证码入课的教师账号在组 A，按组员对待
    expect((await tasksOf('teacher-joined', 'group-a')).status).toBe(200);
  });

  it.each(STAFF)('%s 是课程教职，每个组都能看', async (userId) => {
    expect((await tasksOf(userId, 'group-a')).status).toBe(200);
    expect((await tasksOf(userId, 'group-b')).status).toBe(200);
  });

  it('已被移出课程、组员行还在的学生：任务板和观点图谱都进不去', async () => {
    as('student-removed');
    expect((await call('GET', '/groups/group-a/tasks')).status).toBe(403);
    expect((await call('GET', '/groups/group-a/idea-graph/history')).status).toBe(403);
  });
});

describe('学生指标只算这个空间里的 Build-on', () => {
  it('学生在另一门课里接的不算进来', async () => {
    as('owner-1');
    const res = await call('GET', '/spaces/space-shared/metrics/student/student-a');
    expect(res.status).toBe(200);
    // 原先按 creator_id 取全平台：连另一门课的 evidence 一起算，这门课的教师也就看到了那门课的活动
    expect(res.body.studentMetrics.relationTypesGiven).not.toHaveProperty('evidence');
    expect(res.body.studentMetrics.buildOnsGiven).toBe(1);
  });
});

/**
 * course_tasks / task_submissions 在生产上还没建表。路由原先只看平台身份：
 * 任何教师账号都能读、批任何课的提交。哪天建了表，这里得已经是按课程收好的。
 */
describe('课程作业与提交：按课程、按课内身份', () => {
  const subsSeen = async (userId: string) => {
    as(userId);
    const res = await call('GET', '/courses/course-1/tasks/ctask-1/submissions');
    expect(res.status, userId).toBe(200);
    return (res.body.submissions as { id: string }[]).map(s => s.id).sort();
  };

  it('提交列表：课程教职看全部，其他人只看自己的', async () => {
    for (const userId of STAFF) expect(await subsSeen(userId)).toEqual(['sub-a', 'sub-b']);
    expect(await subsSeen('teacher-joined')).toEqual([]);
    expect(await subsSeen('student-a')).toEqual(['sub-a']);
  });

  it('草稿任务只给课程教职', async () => {
    const titles = async (userId: string) => {
      as(userId);
      return ((await call('GET', '/courses/course-1/tasks')).body.tasks as { id: string }[]).map(t => t.id).sort();
    };
    expect(await titles('co-teacher')).toEqual(['ctask-1', 'ctask-draft']);
    expect(await titles('teacher-joined')).toEqual(['ctask-1']);
  });

  it('看不了、批不了同学的提交：凭学生验证码入课的教师账号也不行', async () => {
    as('teacher-joined');
    expect((await call('GET', '/courses/course-1/tasks/ctask-1/submissions/sub-b')).status).toBe(403);
    expect((await call('PUT', '/courses/course-1/tasks/ctask-1/submissions/sub-b', { feedback: '不错', points_awarded: 10 })).status).toBe(403);
    expect(row('task_submissions', 'sub-b')).toMatchObject({ status: 'submitted' });
    expect(row('task_submissions', 'sub-b')).not.toHaveProperty('points_awarded');
  });

  it('课程管理员照常批改', async () => {
    as('co-teacher');
    expect((await call('PUT', '/courses/course-1/tasks/ctask-1/submissions/sub-b', { feedback: '不错', points_awarded: 10 })).status).toBe(200);
    expect(row('task_submissions', 'sub-b')).toMatchObject({ status: 'graded', points_awarded: 10 });
  });

  it('自己的提交不能自己标成已批', async () => {
    as('student-a');
    expect((await call('PUT', '/courses/course-1/tasks/ctask-1/submissions/sub-a', { status: 'graded' })).status).toBe(403);
    expect(row('task_submissions', 'sub-a')?.status).toBe('submitted');
  });

  it('别的课的任务和提交不能从这门课借道', async () => {
    as('owner-1');
    expect((await call('GET', '/courses/course-1/tasks/ctask-other/submissions')).status).toBe(404);
    expect((await call('GET', '/courses/course-1/tasks/ctask-1/submissions/sub-other')).status).toBe(404);

    // 另一门课的创建者：拿着 course-1 的 id 走自己那门课的路径
    as('owner-2');
    expect((await call('PUT', '/courses/course-2/tasks/ctask-1', { title: '改名了' })).status).toBe(404);
    expect((await call('DELETE', '/courses/course-2/tasks/ctask-1')).status).toBe(404);
    expect((await call('PUT', '/courses/course-2/tasks/ctask-1/submissions/sub-a', { feedback: '改分', points_awarded: 0 })).status).toBe(404);
    expect(row('course_tasks', 'ctask-1')?.title).toBe('读书报告');
    expect(row('task_submissions', 'sub-a')?.status).toBe('submitted');
    // 走 course-1 的路径，先被课程成员判定拦下
    expect((await call('GET', '/courses/course-1/tasks/ctask-1/submissions')).status).toBe(403);
  });

  it('交作业按课内身份：课程教职不交，课里的教师账号交；不在课里的人交不了', async () => {
    const submit = () => call('POST', '/courses/course-1/tasks/ctask-1/submissions', { content: '我的报告' });
    as('co-teacher');
    expect((await submit()).status).toBe(403);
    as('teacher-joined');
    expect((await submit()).status).toBe(201);
    as('owner-2');
    expect((await submit()).status).toBe(403);
    expect(h.db.task_submissions.filter(s => s.task_id === 'ctask-1').map(s => s.student_id).sort())
      .toEqual(['student-a', 'student-b', 'teacher-joined']);
  });
});

describe('生产上没有表、又不查课程的路由已删除', () => {
  const statusOf = async (method: Method, path: string) =>
    (await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })).status;

  it.each([
    ['GET', '/spaces/space-shared/conditions'],
    ['POST', '/spaces/space-shared/conditions'],
    ['PUT', '/conditions/cond-1'],
    ['DELETE', '/conditions/cond-1'],
    ['POST', '/conditions/cond-1/assign'],
    ['DELETE', '/conditions/cond-1/assign/student-a'],
    ['GET', '/spaces/space-shared/conditions/cond-1/assignments'],
    ['GET', '/courses/course-1/materials/mat-1/comments'],
    ['POST', '/courses/course-1/materials/mat-1/comments'],
    ['DELETE', '/courses/course-1/materials/mat-1/comments/c-1'],
  ] as [Method, string][])('%s %s → 404', async (method, path) => {
    as('owner-1');
    expect(await statusOf(method, path)).toBe(404);
  });
});
