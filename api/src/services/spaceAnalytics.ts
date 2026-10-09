import { supabase } from '../config/supabase';
import { studentAuthoredText } from './feedbackUptake';
import { WELCOME_VIEW_ID } from './viewTopics';

/**
 * 知识空间的「讨论分析」（2026-10-09 用户：给教师看学生整体的讨论情况，用于教学不是研究；可视化好看；能看个人）。
 *
 * 一次取齐这个空间的笔记、Build-on、成员、AI 反馈、AI 使用记录，再在内存里算全班概况和某个学生的详情。
 * 口径：
 *   - 学生 = 这门课（绑定小组的空间是这个组）里不是教职的成员；没发过言的学生也列出来，教学上最要看的就是他们；
 *   - 只算学生自己写的：AI 生成的笔记、视图卡不算；字数去掉 AI 摘录和支架话头（studentAuthoredText）；
 *   - Build-on 记在写回应的那条笔记的作者头上；AI 建议了但没采纳的连线不算；
 *   - 「没人回应」= 没有别人 Build-on 过（自己接自己不算）。
 * 可以只看一个视图，规则和画布一致：笔记的 views 里有它；主画布还收没有归属、或归属的视图已删掉的笔记。
 */

export interface AnalyticsNote {
  id: string;
  title: string;
  content: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string | null;
  type: string | null;
  aiGenerated: boolean;
  views: string[];
}

export interface AnalyticsRelation {
  source: string;
  target: string;
  type: string;
  createdAt: string;
  aiSuggested: boolean;
  aiAccepted: boolean | null;
}

export interface AnalyticsFeedback { noteId: string; userId: string; status: string; triggerType: string; createdAt: string }
export interface AnalyticsMember { id: string; name: string; avatar: string | null; isStaff: boolean }

export interface AnalyticsInput {
  notes: AnalyticsNote[];
  relations: AnalyticsRelation[];
  feedbacks: AnalyticsFeedback[];
  members: AnalyticsMember[];
  /** 每个人在这个空间用 AI 的次数（ai_interventions） */
  aiUse: Map<string, number>;
  /** 支架 id → 话头、所在的组 */
  scaffolds: Map<string, { title: string; group: string }>;
  now: Date;
}

const DAY_MS = 86_400_000;
/** 走势最多画这么多天 */
const MAX_TIMELINE_DAYS = 120;
/** 多少天没发言算「最近没参与」 */
export const QUIET_DAYS = 7;

const dayOf = (iso: string) => iso.slice(0, 10);
const ADOPTED = new Set(['accepted', 'inserted', 'followed_up']);

export function scaffoldIdsOf(html: string): string[] {
  return [...new Set([...(html ?? '').matchAll(/data-scaffold-id="([^"]+)"/g)].map(m => m[1]))];
}

/** 学生自己写的字数（不算空白、AI 摘录、支架话头） */
export function authoredChars(html: string): number {
  return studentAuthoredText(html ?? '').replace(/\s/g, '').length;
}

/** 视图规则，和画布、讨论主题一致 */
export function inView(note: Pick<AnalyticsNote, 'views'>, viewId: string | null, existingViewIds: ReadonlySet<string>): boolean {
  if (!viewId) return true;
  if (note.views.includes(viewId)) return true;
  if (viewId !== WELCOME_VIEW_ID) return false;
  return note.views.length === 0 || !note.views.some(v => existingViewIds.has(v));
}

interface Scope {
  students: AnalyticsMember[];
  studentIds: Set<string>;
  nameOf: (id: string | null) => string;
  /** 学生写的、不是 AI 生成的、不是视图卡的笔记 */
  studentNotes: AnalyticsNote[];
  noteById: Map<string, AnalyticsNote>;
  /** 两头都在范围内、不是没采纳的 AI 建议 */
  buildOns: Array<AnalyticsRelation & { from: string | null; to: string | null }>;
}

function scope(input: AnalyticsInput): Scope {
  const students = input.members.filter(m => !m.isStaff);
  const studentIds = new Set(students.map(m => m.id));
  const names = new Map(input.members.map(m => [m.id, m.name]));
  for (const note of input.notes) {
    if (note.authorId && !names.has(note.authorId) && note.authorName) names.set(note.authorId, note.authorName);
  }
  const usable = input.notes.filter(n => n.type !== 'view' && !n.aiGenerated);
  const noteById = new Map(usable.map(n => [n.id, n]));
  const studentNotes = usable.filter(n => n.authorId && studentIds.has(n.authorId));
  const buildOns = input.relations
    .filter(r => !(r.aiSuggested && !r.aiAccepted) && noteById.has(r.source) && noteById.has(r.target) && r.source !== r.target)
    .map(r => ({ ...r, from: noteById.get(r.source)!.authorId, to: noteById.get(r.target)!.authorId }));
  return {
    students,
    studentIds,
    nameOf: id => (id ? names.get(id) ?? '未知成员' : '未知成员'),
    studentNotes,
    noteById,
    buildOns,
  };
}

function timelineDays(input: AnalyticsInput, earliest: string | null): string[] {
  const end = Date.parse(dayOf(input.now.toISOString()));
  const startCandidate = earliest ? Date.parse(dayOf(earliest)) : end - 13 * DAY_MS;
  const start = Math.max(startCandidate, end - (MAX_TIMELINE_DAYS - 1) * DAY_MS);
  const days: string[] = [];
  for (let t = Math.min(start, end - 6 * DAY_MS); t <= end; t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

function feedbackCounts(rows: AnalyticsFeedback[]) {
  return {
    total: rows.length,
    adopted: rows.filter(r => ADOPTED.has(r.status)).length,
    rejected: rows.filter(r => r.status === 'rejected').length,
    ignored: rows.filter(r => r.status === 'ignored').length,
    pending: rows.filter(r => r.status === 'new').length,
  };
}

function countBy<T>(items: T[], key: (item: T) => string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

const sortedCounts = (counts: Map<string, number>) =>
  [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

export function buildOverview(input: AnalyticsInput) {
  const s = scope(input);
  const quietSince = input.now.getTime() - QUIET_DAYS * DAY_MS;
  const notesBy = new Map<string, AnalyticsNote[]>();
  for (const note of s.studentNotes) notesBy.set(note.authorId!, [...(notesBy.get(note.authorId!) ?? []), note]);
  const receivedByNote = countBy(s.buildOns.filter(b => b.from !== b.to), b => b.target);
  // 回应别人：Build-on 到别人的笔记上（接着自己的写不算互动）
  const given = countBy(s.buildOns.filter(b => b.from !== b.to), b => (b.from && s.studentIds.has(b.from) ? b.from : null));
  const received = countBy(s.buildOns.filter(b => b.from !== b.to), b => (b.to && s.studentIds.has(b.to) ? b.to : null));
  const lastAt = new Map<string, string>();
  const touch = (id: string | null, at: string) => {
    if (id && s.studentIds.has(id) && (!lastAt.has(id) || lastAt.get(id)! < at)) lastAt.set(id, at);
  };
  for (const note of s.studentNotes) touch(note.authorId, note.createdAt);
  for (const b of s.buildOns) touch(b.from, b.createdAt);

  const feedbackBy = new Map<string, AnalyticsFeedback[]>();
  for (const f of input.feedbacks) feedbackBy.set(f.userId, [...(feedbackBy.get(f.userId) ?? []), f]);

  const participation = s.students.map(student => {
    const mine = notesBy.get(student.id) ?? [];
    const fb = feedbackCounts(feedbackBy.get(student.id) ?? []);
    return {
      userId: student.id,
      name: student.name,
      avatar: student.avatar,
      notes: mine.length,
      buildOnsGiven: given.get(student.id) ?? 0,
      buildOnsReceived: received.get(student.id) ?? 0,
      chars: mine.reduce((sum, n) => sum + authoredChars(n.content), 0),
      scaffolds: mine.reduce((sum, n) => sum + scaffoldIdsOf(n.content).length, 0),
      lastAt: lastAt.get(student.id) ?? null,
      quiet: !lastAt.has(student.id) || Date.parse(lastAt.get(student.id)!) < quietSince,
      aiFeedback: { received: fb.total, adopted: fb.adopted },
      aiUse: input.aiUse.get(student.id) ?? 0,
    };
  }).sort((a, b) => (b.notes + b.buildOnsGiven) - (a.notes + a.buildOnsGiven) || a.name.localeCompare(b.name, 'zh'));

  const earliest = [...s.studentNotes.map(n => n.createdAt), ...s.buildOns.map(b => b.createdAt)].sort()[0] ?? null;
  const days = timelineDays(input, earliest);
  const notesPerDay = countBy(s.studentNotes, n => dayOf(n.createdAt));
  const buildOnsPerDay = countBy(s.buildOns.filter(b => b.from && s.studentIds.has(b.from)), b => dayOf(b.createdAt));
  const activePerDay = new Map<string, Set<string>>();
  for (const note of s.studentNotes) activePerDay.set(dayOf(note.createdAt), (activePerDay.get(dayOf(note.createdAt)) ?? new Set()).add(note.authorId!));
  for (const b of s.buildOns) if (b.from && s.studentIds.has(b.from)) activePerDay.set(dayOf(b.createdAt), (activePerDay.get(dayOf(b.createdAt)) ?? new Set()).add(b.from));
  const timeline = days.map(day => ({ day, notes: notesPerDay.get(day) ?? 0, buildOns: buildOnsPerDay.get(day) ?? 0, active: activePerDay.get(day)?.size ?? 0 }));

  const links = countBy(
    s.buildOns.filter(b => b.from && b.to && b.from !== b.to && s.studentIds.has(b.from) && s.studentIds.has(b.to)),
    b => `${b.from}→${b.to}`,
  );
  const network = {
    nodes: participation.map(p => ({ id: p.userId, name: p.name, notes: p.notes, buildOns: p.buildOnsGiven + p.buildOnsReceived })),
    links: [...links.entries()].map(([key, count]) => {
      const [from, to] = key.split('→');
      return { from, to, count };
    }),
  };

  const unanswered = s.studentNotes
    .filter(n => (receivedByNote.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(n => ({ id: n.id, title: n.title || '无标题', authorId: n.authorId, authorName: s.nameOf(n.authorId), createdAt: n.createdAt }));

  const scaffoldGroups = sortedCounts(countBy(s.studentNotes.flatMap(n => scaffoldIdsOf(n.content)), id => input.scaffolds.get(id)?.group ?? null));
  const relationTypes = sortedCounts(countBy(s.buildOns, b => b.type));
  const allFeedback = feedbackCounts(input.feedbacks.filter(f => s.studentIds.has(f.userId)));
  const activeStudents = participation.filter(p => p.notes + p.buildOnsGiven > 0).length;
  const staffIds = new Set(input.members.filter(m => m.isStaff).map(m => m.id));

  return {
    summary: {
      students: s.students.length,
      activeStudents,
      quietStudents: participation.filter(p => p.quiet).length,
      notes: s.studentNotes.length,
      teacherNotes: input.notes.filter(n => n.type !== 'view' && !n.aiGenerated && n.authorId && staffIds.has(n.authorId)).length,
      riseAbove: s.studentNotes.filter(n => n.type === 'riseabove').length,
      buildOns: s.buildOns.filter(b => b.from && s.studentIds.has(b.from)).length,
      unanswered: unanswered.length,
      chars: participation.reduce((sum, p) => sum + p.chars, 0),
      feedback: allFeedback,
      aiUse: participation.reduce((sum, p) => sum + p.aiUse, 0),
      firstAt: earliest,
      lastAt: [...lastAt.values()].sort().at(-1) ?? null,
    },
    timeline,
    participation,
    network,
    unanswered: unanswered.slice(0, 30),
    scaffoldGroups,
    relationTypes,
  };
}

export type SpaceOverview = ReturnType<typeof buildOverview>;

export function buildStudentDetail(input: AnalyticsInput, userId: string) {
  const s = scope(input);
  const member = input.members.find(m => m.id === userId) ?? null;
  const mine = s.studentNotes.filter(n => n.authorId === userId);
  const mineIds = new Set(mine.map(n => n.id));
  const given = s.buildOns.filter(b => b.from === userId && b.to !== userId);
  const receivedRel = s.buildOns.filter(b => b.to === userId && b.from !== userId);
  const receivedByNote = countBy(receivedRel, b => b.target);
  const feedback = input.feedbacks.filter(f => f.userId === userId);
  const days = timelineDays(input, [...mine.map(n => n.createdAt), ...given.map(b => b.createdAt)].sort()[0] ?? null);
  const notesPerDay = countBy(mine, n => dayOf(n.createdAt));
  const givenPerDay = countBy(given, b => dayOf(b.createdAt));
  const partners = (rows: typeof given, pick: (b: (typeof given)[number]) => string | null) =>
    sortedCounts(countBy(rows, b => pick(b))).map(({ label, count }) => ({ userId: label, name: s.nameOf(label), count }));
  const scaffoldUse = mine.flatMap(n => scaffoldIdsOf(n.content));
  const activity = [...mine.map(n => n.createdAt), ...given.map(b => b.createdAt)].sort();

  return {
    member: member ? { id: member.id, name: member.name, avatar: member.avatar, isStaff: member.isStaff } : { id: userId, name: s.nameOf(userId), avatar: null, isStaff: false },
    summary: {
      notes: mine.length,
      buildOnsGiven: given.length,
      buildOnsReceived: receivedRel.length,
      chars: mine.reduce((sum, n) => sum + authoredChars(n.content), 0),
      scaffolds: scaffoldUse.length,
      aiUse: input.aiUse.get(userId) ?? 0,
      firstAt: activity[0] ?? null,
      lastAt: activity.at(-1) ?? null,
      quiet: !activity.length || Date.parse(activity.at(-1)!) < input.now.getTime() - QUIET_DAYS * DAY_MS,
    },
    timeline: days.map(day => ({ day, notes: notesPerDay.get(day) ?? 0, buildOns: givenPerDay.get(day) ?? 0 })),
    notes: mine
      .map(n => ({ id: n.id, title: n.title || '无标题', createdAt: n.createdAt, type: n.type, received: receivedByNote.get(n.id) ?? 0, scaffolds: scaffoldIdsOf(n.content).length, chars: authoredChars(n.content) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    builtOn: partners(given, b => b.to),
    builtOnBy: partners(receivedRel, b => b.from),
    relationTypes: {
      given: sortedCounts(countBy(given, b => b.type)),
      received: sortedCounts(countBy(receivedRel, b => b.type)),
    },
    scaffoldGroups: sortedCounts(countBy(scaffoldUse, id => input.scaffolds.get(id)?.group ?? null)),
    scaffoldTitles: sortedCounts(countBy(scaffoldUse, id => input.scaffolds.get(id)?.title ?? null)).slice(0, 8),
    feedback: {
      ...feedbackCounts(feedback),
      byType: sortedCounts(countBy(feedback, f => f.triggerType)),
    },
    unanswered: mine.filter(n => (receivedByNote.get(n.id) ?? 0) === 0 && mineIds.has(n.id)).length,
  };
}

export type StudentDetail = ReturnType<typeof buildStudentDetail>;

/** 词云用的文本：学生写的笔记，标题加正文里学生自己写的部分 */
export function wordCloudDocs(input: AnalyticsInput, authorId?: string | null): Array<{ id: string; text: string }> {
  const s = scope(input);
  return s.studentNotes
    .filter(n => !authorId || n.authorId === authorId)
    .map(n => ({ id: n.id, text: `${n.title ?? ''}\n${studentAuthoredText(n.content ?? '')}` }))
    .filter(doc => doc.text.trim());
}

// ── 取数 ──────────────────────────────────────────────────────

const PAGE = 1000;

async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * 读这个空间分析要用的全部数据。调用前必须已经确认调用者是这门课的教职（ensureSpaceStaff）。
 */
export async function loadSpaceAnalytics(spaceId: string, opts: { viewId?: string | null; now?: Date } = {}): Promise<AnalyticsInput & { signature: string }> {
  const { data: space, error: spaceError } = await supabase.from('spaces').select('id, course_id, group_id').eq('id', spaceId).maybeSingle();
  if (spaceError || !space) throw new Error(spaceError?.message ?? 'space not found');
  const courseId = space.course_id as string;
  const groupId = (space.group_id as string | null) ?? null;

  const [notes, relations, feedbacks, aiRows, courseMembers, groupMembers, course, views] = await Promise.all([
    all<Record<string, unknown>>((a, b) => supabase.from('notes')
      .select('id, title, content, author_id, author_name, created_at, updated_at, type, is_ai_generated, views')
      .eq('space_id', spaceId).is('deleted_at', null).order('created_at', { ascending: true }).range(a, b)),
    all<Record<string, unknown>>((a, b) => supabase.from('relations')
      .select('source_note_id, target_note_id, relation_type, created_at, ai_suggested, ai_accepted')
      .eq('space_id', spaceId).order('created_at', { ascending: true }).range(a, b)),
    all<Record<string, unknown>>((a, b) => supabase.from('note_ai_feedbacks')
      .select('note_id, user_id, status, trigger_type, created_at')
      .eq('space_id', spaceId).order('created_at', { ascending: true }).range(a, b)),
    all<Record<string, unknown>>((a, b) => supabase.from('ai_interventions').select('user_id').eq('space_id', spaceId).range(a, b)),
    all<Record<string, unknown>>((a, b) => supabase.from('course_members').select('user_id, role').eq('course_id', courseId).range(a, b)),
    groupId
      ? all<Record<string, unknown>>((a, b) => supabase.from('group_members').select('user_id').eq('group_id', groupId).range(a, b))
      : Promise.resolve(null),
    supabase.from('courses').select('instructor_id').eq('id', courseId).maybeSingle(),
    supabase.from('views').select('id').eq('space_id', spaceId),
  ]);

  const staffIds = new Set(courseMembers.filter(m => m.role === 'teacher').map(m => m.user_id as string));
  const instructor = (course.data as { instructor_id?: string } | null)?.instructor_id;
  if (instructor) staffIds.add(instructor);
  const memberIds = new Set<string>([
    ...(groupMembers ? groupMembers.map(m => m.user_id as string) : courseMembers.map(m => m.user_id as string)),
    ...staffIds,
  ]);
  const ids = [...memberIds];
  const profiles = ids.length
    ? await all<Record<string, unknown>>((a, b) => supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids).range(a, b))
    : [];
  const profileOf = new Map(profiles.map(p => [p.id as string, p]));
  const members: AnalyticsMember[] = ids.map(id => ({
    id,
    name: String(profileOf.get(id)?.full_name ?? '').trim() || '未命名',
    avatar: (profileOf.get(id)?.avatar_url as string | null) ?? null,
    isStaff: staffIds.has(id),
  }));

  const existingViews = new Set(((views.data ?? []) as Array<{ id: string }>).map(v => v.id));
  const viewId = opts.viewId ?? null;
  const analyticsNotes: AnalyticsNote[] = notes
    .map(n => ({
      id: n.id as string,
      title: String(n.title ?? ''),
      content: String(n.content ?? ''),
      authorId: (n.author_id as string | null) ?? null,
      authorName: (n.author_name as string | null) ?? null,
      createdAt: String(n.created_at),
      updatedAt: (n.updated_at as string | null) ?? null,
      type: (n.type as string | null) ?? null,
      aiGenerated: n.is_ai_generated === true,
      views: Array.isArray(n.views) ? (n.views as string[]) : [],
    }))
    .filter(n => inView(n, viewId, existingViews));
  const inScope = new Set(analyticsNotes.map(n => n.id));

  const scaffoldIds = [...new Set(analyticsNotes.flatMap(n => scaffoldIdsOf(n.content)))];
  const scaffoldRows = scaffoldIds.length
    ? (await supabase.from('scaffolds').select('id, title, category, metadata').in('id', scaffoldIds)).data ?? []
    : [];
  const scaffolds = new Map((scaffoldRows as Array<Record<string, unknown>>).map(row => {
    const meta = (row.metadata ?? {}) as { l2_zh?: string };
    return [row.id as string, { title: String(row.title ?? ''), group: meta.l2_zh || String(row.category ?? '其他') }];
  }));

  const signature = `${viewId ?? 'all'}:${analyticsNotes.length}:${analyticsNotes.map(n => n.updatedAt ?? n.createdAt).sort().at(-1) ?? ''}:${relations.length}`;
  return {
    notes: analyticsNotes,
    relations: relations
      .filter(r => inScope.has(r.source_note_id as string) && inScope.has(r.target_note_id as string))
      .map(r => ({
        source: r.source_note_id as string,
        target: r.target_note_id as string,
        type: String(r.relation_type ?? 'extend'),
        createdAt: String(r.created_at),
        aiSuggested: r.ai_suggested === true,
        aiAccepted: (r.ai_accepted as boolean | null) ?? null,
      })),
    feedbacks: feedbacks
      .filter(f => inScope.has(f.note_id as string))
      .map(f => ({ noteId: f.note_id as string, userId: f.user_id as string, status: String(f.status), triggerType: String(f.trigger_type ?? ''), createdAt: String(f.created_at) })),
    members,
    aiUse: countBy(aiRows, r => r.user_id as string),
    scaffolds,
    now: opts.now ?? new Date(),
    signature,
  };
}
