/**
 * 演示服务的接口层。只实现录制时会走到的接口；没实现的记进日志（MISS）并回 {}，
 * 录制前看一眼日志就知道还缺什么。
 *
 * 状态放在内存里，录制脚本通过 /__mock/* 控制：重置、切换身份、决定下一次反馈检查是否出结果。
 */
import fs from 'node:fs';
import * as W from './world.mjs';
import { handleAi } from './mockAi.mjs';
import { handleMore } from './mockMore.mjs';
import { handleTeacher } from './mockTeacher.mjs';

const LOG = process.env.CAPTURE_LOG ?? '/tmp/manual-capture-api.log';
const routes = [];
export const on = (method, pattern, handler) => routes.push({ method, pattern, handler });

export const state = {};
export function reset() {
  Object.assign(state, {
    role: 'student',
    notes: W.buildNotes(),
    relations: W.buildRelations(),
    shapes: W.buildShapes(),
    scaffolds: W.loadScaffolds(),
    requireScaffold: false,
    conversations: {},   // noteId -> thread[]
    messages: {},        // threadId -> message[]
    feedbacks: {},       // noteId -> feedback[]
    feedbackPlan: {},    // noteId -> 'ready' | 'none'
    rooms: {},
    support: [],
    seq: 1,
  });
}
reset();

export const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(state.seq++).toString(36)}`;
export const me = () => (state.role === 'teacher'
  ? { id: W.TEACHER_ID, name: '刘老师', email: 'teacher@demo.example', role: 'teacher', status: 'active' }
  : W.ME);

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export async function handleApi(req, res, url) {
  const body = req.method === 'GET' ? {} : await readBody(req);
  const p = url.pathname.replace(/^\/api/, '');
  for (const r of routes) {
    if (r.method !== req.method && r.method !== '*') continue;
    const m = p.match(r.pattern);
    if (!m) continue;
    fs.appendFileSync(LOG, `HIT  ${req.method} ${p}${url.search}\n`);
    const out = await r.handler({ req, res, url, body, params: m.groups ?? {}, query: Object.fromEntries(url.searchParams) });
    if (out === undefined || res.writableEnded) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
    return;
  }
  fs.appendFileSync(LOG, `MISS ${req.method} ${p}${url.search}\n`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{}');
}

// ── 录制控制 ─────────────────────────────────────────────────────────────
on('POST', /^\/__mock\/reset$/, ({ body }) => { reset(); if (body.role) state.role = body.role; return { ok: true }; });
on('POST', /^\/__mock\/set$/, ({ body }) => { Object.assign(state, body); return { ok: true }; });
on('POST', /^\/__mock\/feedback-plan$/, ({ body }) => { state.feedbackPlan[body.noteId] = body.plan; return { ok: true }; });

on('POST', /^\/__mock\/note$/, ({ body }) => {
  const n = state.notes.find(x => x.id === body.id);
  if (n) Object.assign(n, body.patch ?? {});
  return { ok: !!n };
});
on('POST', /^\/__mock\/seed-feedback$/, async ({ body }) => {
  const { FEEDBACKS } = await import('./scripts.mjs');
  const spec = FEEDBACKS[body.plan];
  const fb = {
    id: nextId('fb'), noteId: body.noteId, spaceId: W.SPACE_ID, courseId: W.COURSE_ID, userId: me().id, providerId: 'deepseek', model: 'deepseek-flash',
    triggerType: spec.triggerType, triggerContext: { chain: 'editor_inline' }, draftExcerpt: '', feedbackText: spec.text, status: body.status ?? 'new',
    createdAt: body.createdAt ?? W.ago(0, 0, 8), suggestedScaffold: spec.scaffold ?? null, suggestedScaffoldUsedAt: null,
  };
  (state.feedbacks[body.noteId] ??= []).unshift(fb);
  return { feedback: fb };
});

// ── 身份 ─────────────────────────────────────────────────────────────────
on('GET', /^\/auth\/me$/, () => ({ user: me() }));

// ── 首页 ─────────────────────────────────────────────────────────────────
const courseSummary = () => ({
  id: W.COURSE_ID, title: W.COURSE.title, instructorId: W.TEACHER_ID, instructorName: '刘老师', coverImage: null,
  tags: W.COURSE.tags, verificationCode: null, createdAt: W.COURSE.created_at, studentCount: 32, noteCount: 86,
  lastActivityAt: W.ago(0, 1), hasAi: true, hasUnreadFeedback: true, unreadFeedbackCount: 1,
});
on('GET', /^\/dashboard\/student-overview$/, () => ({
  overview: {
    generatedAt: W.NOW.toISOString(),
    actionCenter: { unreadFeedbackCount: 1, unreadNotificationCount: 2, aiEnabledCourseCount: 1, availableCourseCount: 1 },
    enrolledCourses: [courseSummary()],
    availableCourses: [{ ...courseSummary(), id: 'c-other', title: '计算思维导论', studentCount: 45, noteCount: 0, hasUnreadFeedback: false, unreadFeedbackCount: 0, lastActivityAt: null }],
    recentTeacherNotifications: [
      { id: 'tn-1', title: '刘老师评论了你的笔记', message: '「我试过先写提纲再问 AI」这条可以补一个具体的例子。', createdAt: W.ago(0, 5), linkType: 'note', linkId: 'n-07' },
    ],
  },
}));
on('GET', /^\/dashboard\/activity-pulse$/, () => {
  const weeks = ['9/1', '9/8', '9/15', '9/22'].map((label, i) => ({ label, startsAt: W.ago(21 - i * 7), notes: [2, 5, 7, 9][i], aiInteractions: [1, 4, 6, 5][i] }));
  const pre = ['8/4', '8/11', '8/18', '8/25'].map((label, i) => ({ label, startsAt: W.ago(49 - i * 7), notes: 0, aiInteractions: 0 }));
  return {
    pulse: {
      weeks: [...pre, ...weeks],
      acceptance: {
        accepted: 7, rejected: 2, pending: 1, rate: 78,
        byTrigger: [
          { triggerType: 'no_evidence', accepted: 3, rejected: 1, pending: 1, rate: 75 },
          { triggerType: 'no_reasoning', accepted: 2, rejected: 0, pending: 0, rate: 100 },
          { triggerType: 'promising_seed', accepted: 1, rejected: 0, pending: 0, rate: 100 },
          { triggerType: 'unclear', accepted: 1, rejected: 1, pending: 0, rate: 50 },
        ],
      },
      heatmap: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => ((h >= 9 && h <= 11) || (h >= 19 && h <= 22)) && d < 5 ? ((d + h) % 3) + 1 : 0)),
      heatmapMax: 3,
      hasData: true,
    },
  };
});
on('GET', /^\/dashboard\/student-analytics$/, () => {
  const mine = state.notes.filter(n => n.author_id === W.ME.id);
  // 前两周在别的知识空间里写的笔记：画布上看不到，但算在「我的笔记」里
  const earlier = [
    ['我觉得 AI 写的总结太顺了，反而不知道重点在哪', 16, 180], ['课堂上用 AI 翻译文献，意思对但术语不统一', 14, 150],
    ['同一个问题问两次 AI，答案不一样，该信哪个？', 11, 120], ['我对「知识建构」的理解：不是分工，是一起改进想法', 9, 210],
    ['读书报告用 AI 列提纲，还是要自己挑例子', 6, 160],
  ].map(([title, d, len], i) => ({ id: `e-${i}`, title, type: 'note', contentLength: len, createdAt: W.ago(d, 3), updatedAt: W.ago(d, 3) }));
  return {
    analytics: {
      period: { days: 30, since: W.ago(30) },
      noteActivity: [...earlier, ...mine.map(n => ({ id: n.id, title: n.title, type: n.type, contentLength: n.content.length, createdAt: n.created_at, updatedAt: n.updated_at }))],
      totalNotes: earlier.length + mine.length,
      noteTypeDist: { note: 6, question: 1 },
      hourDist: Array.from({ length: 24 }, (_, h) => ({ 9: 1, 10: 2, 14: 1, 20: 1, 21: 2 })[h] ?? 0),
      ideaImpact: { maxChain: 3, totalDescendants: 4 },
      percentile: 68,
      avgLengthChange: 12,
      aiInteractionsChange: 4,
      buildOns: { given: 3, received: 2 },
      references: { given: 1, received: 0 },
      relationTypesGiven: { extend: 2, question: 1 },
      relationTypesReceived: { question: 1, extend: 1 },
      communityStats: { uniqueCollaborators: 4, totalNotes: 86, totalAuthors: 32 },
      aiInteractions: 16,
      weeklyTrend: [
        { week: '9/8', notes: 1, buildOnsGiven: 1, buildOnsReceived: 0 },
        { week: '9/15', notes: 2, buildOnsGiven: 1, buildOnsReceived: 1 },
        { week: '9/22', notes: 2, buildOnsGiven: 1, buildOnsReceived: 1 },
      ],
      actionItems: [{ type: 'unbuilt', message: '有 1 条同学的提问还没人回应', count: 1 }],
      unbuiltNotes: [{ id: 'n-08', title: '先写提纲要花多久？时间紧的时候还做得到吗？', createdAt: W.ago(1, 20) }],
      topCollaborators: [
        { id: 'u-zhouzh', name: '周子涵', given: 1, received: 1, total: 2 },
        { id: 'u-wangyt', name: '王雨桐', given: 1, received: 0, total: 1 },
      ],
      recentBuildOns: [{ sourceNoteId: 'n-08', creatorId: 'u-zhouzh', creatorName: '周子涵', createdAt: W.ago(1, 20) }],
    },
  };
});

// ── 课程 ─────────────────────────────────────────────────────────────────
on('GET', /^\/courses$/, () => ({ courses: [W.COURSE] }));
on('GET', /^\/courses\/available$/, () => ({ courses: [] }));
on('GET', /^\/courses\/(?<id>[^/]+)$/, () => ({ course: W.COURSE }));
on('GET', /^\/courses\/[^/]+\/spaces$/, () => ({ spaces: [W.SPACE] }));
on('GET', /^\/courses\/[^/]+\/groups$/, () => ({ groups: [W.GROUP] }));
on('GET', /^\/courses\/[^/]+\/scaffolds$/, () => ({ scaffolds: state.scaffolds, requireScaffold: state.requireScaffold }));
on('GET', /^\/notifications$/, () => ({
  notifications: [
    { id: 'nt-1', user_id: W.ME.id, type: 'buildon', title: '周子涵 在你的笔记上提了一个问题', message: '先写提纲要花多久？时间紧的时候还做得到吗？', read: false, link_type: 'note', link_id: 'n-08', created_at: W.ago(1, 20) },
    { id: 'nt-2', user_id: W.ME.id, type: 'teacher', title: '刘老师评论了你的笔记', message: '可以补一个具体的例子。', read: false, link_type: 'note', link_id: 'n-07', created_at: W.ago(0, 5) },
  ],
}));

// ── 空间：笔记、关系、图形、视图 ─────────────────────────────────────────
on('GET', /^\/spaces\/[^/]+\/notes$/, () => ({ notes: state.notes }));
on('GET', /^\/spaces\/[^/]+\/relations$/, () => ({ relations: state.relations }));
on('GET', /^\/spaces\/[^/]+\/shapes$/, () => ({ shapes: state.shapes }));
on('GET', /^\/spaces\/[^/]+\/views$/, () => ({ views: [], cards: [] }));
on('GET', /^\/notes\/(?<id>[^/?]+)$/, ({ params }) => ({ note: state.notes.find(n => n.id === params.id) ?? state.notes[0] }));
on('GET', /^\/notes\/(?<id>[^/]+)\/relations$/, ({ params }) => ({ relations: state.relations.filter(r => r.source_note_id === params.id || r.target_note_id === params.id) }));
on('GET', /^\/notes\/[^/]+\/revisions$/, () => ({ revisions: [] }));
on('GET', /^\/notes\/[^/]+\/feedback$/, () => ({ feedbacks: [] }));
// 「New」按人算：演示只有一个学生，打开过就在他那里不再标 New
on('POST', /^\/notes\/(?<id>[^/]+)\/seen$/, ({ params }) => {
  const n = state.notes.find(x => x.id === params.id);
  if (!n || n.author_id === me().id) return { recorded: false };
  n.seen_by_me = true;
  return { recorded: true };
});
on('PATCH', /^\/notes\/(?<id>[^/]+)\/position$/, ({ params, body }) => {
  const n = state.notes.find(x => x.id === params.id);
  if (n) Object.assign(n, { x: body.x ?? n.x, y: body.y ?? n.y, width: body.width ?? n.width, height: body.height ?? n.height });
  return { ok: true };
});
on('POST', /^\/spaces\/(?<space>[^/]+)\/notes$/, ({ body }) => {
  const note = {
    id: nextId('n'), space_id: W.SPACE_ID, author_id: me().id, type: body.type ?? 'note',
    title: body.title ?? '', content: body.content ?? '', x: body.x ?? 1700, y: body.y ?? 300, width: 300, height: 180,
    tags: body.tags ?? [], metadata: body.metadata ?? {}, views: body.views ?? [], cited_note_ids: body.cited_note_ids ?? [],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), users: { name: me().name },
  };
  state.notes.push(note);
  if (body.build_on?.parent_id || body.parent_id) {
    state.relations.push({ id: nextId('r'), space_id: W.SPACE_ID, source_note_id: note.id, target_note_id: body.build_on?.parent_id ?? body.parent_id,
      relation_type: body.build_on?.relation_type ?? body.relation_type ?? 'extend', creator_id: me().id, ai_suggested: false, created_at: note.created_at, users: { name: me().name } });
  }
  return { note };
});
on('PUT', /^\/notes\/(?<id>[^/]+)$/, ({ params, body }) => {
  const n = state.notes.find(x => x.id === params.id);
  if (n) Object.assign(n, body, { updated_at: new Date().toISOString() });
  return { note: n };
});
on('POST', /^\/relations$/, ({ body }) => {
  const rel = { id: nextId('r'), space_id: W.SPACE_ID, source_note_id: body.source_note_id, target_note_id: body.target_note_id,
    relation_type: body.relation_type ?? 'extend', creator_id: me().id, ai_suggested: false, created_at: new Date().toISOString(), users: { name: me().name } };
  state.relations.push(rel);
  return { relation: rel };
});

handleAi(on, state, { nextId, me });
handleMore(on, state, { nextId, me });
handleTeacher(on);
