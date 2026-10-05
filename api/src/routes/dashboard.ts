import { getCourseMemberCounts } from '../services/courseMemberCounts';
import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureCourseInstructor, ensureCourseMember } from '../services/accessControl';
import { cleanDisplayName, emailFallbackName } from '../services/displayName';
import { computeScaffoldingLevel, filterStudentIds, type CognitivePatterns } from '../services/learnerProfileService';
import { extractConcepts, extractConceptsScored } from '../services/conceptExtraction';
import { computePulse } from '../services/activityPulse';
import { notePreviewText, noteTextLength } from '../services/noteText';

const router = Router();
const DEFAULT_INSTRUCTOR_NAME = 'Course teacher';

type CourseRow = {
  id: string;
  title: string;
  instructor_id: string;
  cover_image: string | null;
  tags: string[] | null;
  verification_code: string | null;
  created_at: string;
};

type CourseSummary = {
  id: string;
  title: string;
  instructorId: string;
  instructorName: string;
  coverImage: string | null;
  tags: string[];
  verificationCode: string | null;
  createdAt: string;
  studentCount: number;
  teacherCount: number;
  noteCount: number;
  lastActivityAt: string | null;
  hasAi: boolean;
  hasUnreadFeedback: boolean;
  unreadFeedbackCount: number;
};

async function getCoursesByIds(courseIds: string[]): Promise<CourseRow[]> {
  if (courseIds.length === 0) return [];
  const { data, error } = await supabase
    .from('courses')
    .select('id, title, instructor_id, cover_image, tags, verification_code, created_at')
    .in('id', courseIds)
    .order('created_at', { ascending: false });

  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as CourseRow[];
}

async function getInstructorNames(courses: CourseRow[]): Promise<Map<string, string>> {
  const instructorIds = Array.from(new Set(courses.map((course) => course.instructor_id).filter(Boolean)));
  if (instructorIds.length === 0) return new Map();

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', instructorIds);

  if (profileError) throw new ApiError(500, profileError.message);

  const names = new Map<string, string>();
  for (const row of (profileRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
    const name = cleanDisplayName(row.full_name ?? undefined) ?? emailFallbackName(row.email ?? undefined);
    if (name) names.set(row.id, name);
  }

  const missingIds = instructorIds.filter((id) => !names.has(id));
  if (missingIds.length > 0) {
    const { data: userRows, error: userError } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', missingIds);

    if (userError) throw new ApiError(500, userError.message);

    for (const row of (userRows ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
      const fallbackName = cleanDisplayName(row.name ?? undefined) ?? emailFallbackName(row.email ?? undefined);
      if (fallbackName) names.set(row.id, fallbackName);
    }
  }

  return names;
}

async function getCourseSpaces(courseIds: string[]): Promise<Array<{ id: string; course_id: string }>> {
  if (courseIds.length === 0) return [];

  const { data, error } = await supabase
    .from('spaces')
    .select('id, course_id')
    .in('course_id', courseIds);

  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as Array<{ id: string; course_id: string }>;
}

async function getCourseNoteStats(spaceRows: Array<{ id: string; course_id: string }>): Promise<Map<string, { noteCount: number; lastActivityAt: string | null }>> {
  const stats = new Map<string, { noteCount: number; lastActivityAt: string | null }>();
  if (spaceRows.length === 0) return stats;

  const spaceIds = spaceRows.map((space) => space.id);
  const spaceToCourse = new Map(spaceRows.map((space) => [space.id, space.course_id]));

  const { data, error } = await supabase
    .from('notes')
    .select('space_id, created_at')
    .in('space_id', spaceIds)
    .is('deleted_at', null);

  if (error) throw new ApiError(500, error.message);

  for (const note of (data ?? []) as Array<{ space_id: string; created_at: string }>) {
    const courseId = spaceToCourse.get(note.space_id);
    if (!courseId) continue;

    const current = stats.get(courseId) ?? { noteCount: 0, lastActivityAt: null };
    current.noteCount += 1;
    if (!current.lastActivityAt || new Date(note.created_at) > new Date(current.lastActivityAt)) {
      current.lastActivityAt = note.created_at;
    }
    stats.set(courseId, current);
  }

  return stats;
}

async function getAiEnabledCourseIds(courseIds: string[]): Promise<Set<string>> {
  if (courseIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('teacher_ai_configs')
    .select('course_id')
    .in('course_id', courseIds);

  if (error) throw new ApiError(500, error.message);
  return new Set((data ?? []).map((row: { course_id: string }) => row.course_id));
}

async function getUnreadFeedbackCountsForStudent(
  userId: string,
  spaceRows: Array<{ id: string; course_id: string }>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (spaceRows.length === 0) return counts;

  const spaceToCourse = new Map(spaceRows.map((space) => [space.id, space.course_id]));
  const { data: notes, error: notesError } = await supabase
    .from('notes')
    .select('id, space_id')
    .eq('author_id', userId)
    .in('space_id', spaceRows.map((space) => space.id))
    .is('deleted_at', null);

  if (notesError) throw new ApiError(500, notesError.message);
  const noteRows = (notes ?? []) as Array<{ id: string; space_id: string }>;
  if (noteRows.length === 0) return counts;

  const noteToCourse = new Map(
    noteRows
      .map((note) => {
        const courseId = spaceToCourse.get(note.space_id);
        return courseId ? [note.id, courseId] : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );

  const { data: feedbacks, error: feedbackError } = await supabase
    .from('note_feedbacks')
    .select('note_id')
    .in('note_id', noteRows.map((note) => note.id))
    .eq('is_published', true)
    .eq('is_read', false);

  if (feedbackError) throw new ApiError(500, feedbackError.message);

  for (const row of (feedbacks ?? []) as Array<{ note_id: string }>) {
    const courseId = noteToCourse.get(row.note_id);
    if (!courseId) continue;
    counts.set(courseId, (counts.get(courseId) ?? 0) + 1);
  }

  return counts;
}

async function getUnreadFeedbackCountsForTeacher(
  spaceRows: Array<{ id: string; course_id: string }>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (spaceRows.length === 0) return counts;

  const spaceToCourse = new Map(spaceRows.map((space) => [space.id, space.course_id]));
  const { data, error } = await supabase
    .from('note_feedbacks')
    .select('space_id')
    .in('space_id', spaceRows.map((space) => space.id))
    .eq('is_published', true)
    .eq('is_read', false);

  if (error) throw new ApiError(500, error.message);

  for (const row of (data ?? []) as Array<{ space_id: string }>) {
    const courseId = spaceToCourse.get(row.space_id);
    if (!courseId) continue;
    counts.set(courseId, (counts.get(courseId) ?? 0) + 1);
  }

  return counts;
}

function toCourseSummary(
  course: CourseRow,
  instructorNames: Map<string, string>,
  studentCounts: Map<string, { teacherCount: number; studentCount: number }>,
  noteStats: Map<string, { noteCount: number; lastActivityAt: string | null }>,
  aiEnabledCourseIds: Set<string>,
  unreadFeedbackCounts: Map<string, number>,
  // The join code is a credential. Callers must opt in, and only for courses the
  // viewer already belongs to — leaking it for unenrolled courses would let any
  // student self-enrol into every course on the platform.
  exposeVerificationCode = false,
): CourseSummary {
  const courseStats = noteStats.get(course.id) ?? { noteCount: 0, lastActivityAt: null };
  const unreadFeedbackCount = unreadFeedbackCounts.get(course.id) ?? 0;

  return {
    id: course.id,
    title: course.title,
    instructorId: course.instructor_id,
    instructorName: instructorNames.get(course.instructor_id) ?? DEFAULT_INSTRUCTOR_NAME,
    coverImage: course.cover_image,
    tags: course.tags ?? [],
    verificationCode: exposeVerificationCode ? course.verification_code : null,
    createdAt: course.created_at,
    studentCount: studentCounts.get(course.id)?.studentCount ?? 0,
    teacherCount: studentCounts.get(course.id)?.teacherCount ?? 1,
    noteCount: courseStats.noteCount,
    lastActivityAt: courseStats.lastActivityAt,
    hasAi: aiEnabledCourseIds.has(course.id),
    hasUnreadFeedback: unreadFeedbackCount > 0,
    unreadFeedbackCount,
  };
}

router.get('/student-overview', verifyJWT, requireRole('student'), async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const { data: memberships, error: membershipError } = await supabase
    .from('course_members')
    .select('course_id')
    .eq('user_id', userId);

  if (membershipError) throw new ApiError(500, membershipError.message);

  const enrolledIds = Array.from(new Set((memberships ?? []).map((row: { course_id: string }) => row.course_id)));
  const { data: allCourses, error: allCoursesError } = await supabase
    .from('courses')
    .select('id, title, instructor_id, cover_image, tags, verification_code, created_at')
    .order('created_at', { ascending: false });

  if (allCoursesError) throw new ApiError(500, allCoursesError.message);

  const courseRows = (allCourses ?? []) as CourseRow[];
  const enrolledCourses = courseRows.filter((course) => enrolledIds.includes(course.id));
  const availableCourses = courseRows.filter((course) => !enrolledIds.includes(course.id));
  const relevantCourses = [...enrolledCourses, ...availableCourses];

  const [instructorNames, studentCounts, aiEnabledCourseIds, spaceRows, unreadNotificationsResult, recentTeacherNotificationsResult] = await Promise.all([
    getInstructorNames(relevantCourses),
    getCourseMemberCounts(relevantCourses),
    getAiEnabledCourseIds(relevantCourses.map((course) => course.id)),
    getCourseSpaces(enrolledCourses.map((course) => course.id)),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false),
    supabase
      .from('notifications')
      .select('id, title, message, created_at, link_type, link_id')
      .eq('user_id', userId)
      .eq('type', 'teacher')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const [noteStats, unreadFeedbackCounts] = await Promise.all([
    getCourseNoteStats(spaceRows),
    getUnreadFeedbackCountsForStudent(userId, spaceRows),
  ]);

  const unreadNotifications = unreadNotificationsResult.count ?? 0;
  const recentTeacherNotifications = (recentTeacherNotificationsResult.data ?? []) as Array<{
    id: string;
    title: string;
    message: string;
    created_at: string;
    link_type?: string | null;
    link_id?: string | null;
  }>;

  const enrolledSummaries = enrolledCourses.map((course) =>
    toCourseSummary(course, instructorNames, studentCounts, noteStats, aiEnabledCourseIds, unreadFeedbackCounts, true),
  );
  const availableSummaries = availableCourses.map((course) =>
    toCourseSummary(course, instructorNames, studentCounts, new Map(), aiEnabledCourseIds, new Map()),
  );

  res.json({
    overview: {
      generatedAt: new Date().toISOString(),
      actionCenter: {
        unreadFeedbackCount: Array.from(unreadFeedbackCounts.values()).reduce((sum, value) => sum + value, 0),
        unreadNotificationCount: unreadNotifications,
        aiEnabledCourseCount: enrolledSummaries.filter((course) => course.hasAi).length,
        availableCourseCount: availableSummaries.length,
      },
      enrolledCourses: enrolledSummaries,
      availableCourses: availableSummaries,
      recentTeacherNotifications: recentTeacherNotifications.map((item) => ({
        id: item.id,
        title: item.title,
        message: item.message,
        createdAt: item.created_at,
        linkType: item.link_type ?? null,
        linkId: item.link_id ?? null,
      })),
    },
  });
});

router.get('/teacher-overview', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [ownedResult, memberResult] = await Promise.all([
    supabase
      .from('courses')
      .select('id, title, instructor_id, cover_image, tags, verification_code, created_at')
      .eq('instructor_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('course_members')
      .select('course_id')
      .eq('user_id', userId),
  ]);

  if (ownedResult.error) throw new ApiError(500, ownedResult.error.message);

  const ownedCourses = (ownedResult.data ?? []) as CourseRow[];
  const ownedIds = new Set(ownedCourses.map((c) => c.id));
  const memberCourseIds = (memberResult.data ?? [])
    .map((m: any) => m.course_id)
    .filter((id: string) => !ownedIds.has(id));

  let memberCourses: CourseRow[] = [];
  if (memberCourseIds.length > 0) {
    const { data } = await supabase
      .from('courses')
      .select('id, title, instructor_id, cover_image, tags, verification_code, created_at')
      .in('id', memberCourseIds)
      .order('created_at', { ascending: false });
    memberCourses = (data ?? []) as CourseRow[];
  }

  const courseRows = [...ownedCourses, ...memberCourses];
  const courseIds = courseRows.map((course) => course.id);

  const [instructorNames, studentCounts, aiEnabledCourseIds, spaceRows] = await Promise.all([
    getInstructorNames(courseRows),
    getCourseMemberCounts(courseRows),
    getAiEnabledCourseIds(courseIds),
    getCourseSpaces(courseIds),
  ]);

  const [noteStats, unreadFeedbackCounts] = await Promise.all([
    getCourseNoteStats(spaceRows),
    getUnreadFeedbackCountsForTeacher(spaceRows),
  ]);

  // Every course here is one this teacher owns or belongs to, so the join code
  // is theirs to see and share.
  const courseSummaries = courseRows.map((course) =>
    toCourseSummary(course, instructorNames, studentCounts, noteStats, aiEnabledCourseIds, unreadFeedbackCounts, true),
  );

  res.json({
    overview: {
      generatedAt: new Date().toISOString(),
      totals: {
        totalCourses: courseSummaries.length,
        totalStudents: courseSummaries.reduce((sum, course) => sum + course.studentCount, 0),
        totalNotes: courseSummaries.reduce((sum, course) => sum + course.noteCount, 0),
        aiEnabledCourses: courseSummaries.filter((course) => course.hasAi).length,
        pendingFeedbackCount: courseSummaries.reduce((sum, course) => sum + course.unreadFeedbackCount, 0),
      },
      courses: courseSummaries,
    },
  });
});

/**
 * GET /api/dashboard/activity-pulse — 概览三张图的真实数据。
 *
 * 之前这三张图读的是组件里写死的默认值，所有人看到的数字一模一样。
 * 在一个用来做研究的平台上，编出来的分析图比空图更糟。
 *
 * 教师看自己带的课，学生看自己选的课 —— 都是社区层面的数据，
 * 因为知识建构关心的本来就是共同体的进展，不是个人计分。
 */
router.get('/activity-pulse', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const role = req.user!.role;
  const courseFilter = typeof req.query.course_id === 'string' ? req.query.course_id : null;

  let courseIds: string[];
  if (courseFilter) {
    // 指定了课程就按课程的成员关系校验，不看全局角色
    await ensureCourseMember(courseFilter, req.user!);
    courseIds = [courseFilter];
  } else if (role === 'teacher' || role === 'admin') {
    const { data } = await supabase.from('courses').select('id').eq('instructor_id', userId);
    courseIds = (data ?? []).map((c: { id: string }) => c.id);
  } else {
    const { data } = await supabase.from('course_members').select('course_id').eq('user_id', userId);
    courseIds = [...new Set((data ?? []).map((m: { course_id: string }) => m.course_id))];
  }

  if (courseIds.length === 0) {
    return res.json({
      pulse: computePulse({ noteTimes: [], aiTimes: [], eventTimes: [], feedbacks: [] }),
    });
  }

  const spaceRows = await getCourseSpaces(courseIds);
  const spaceIds = spaceRows.map((s) => s.id);
  if (spaceIds.length === 0) {
    return res.json({
      pulse: computePulse({ noteTimes: [], aiTimes: [], eventTimes: [], feedbacks: [] }),
    });
  }

  // 只取 8 周窗口内的数据。整表拉回来在一个学期后就会拖垮这个接口。
  const since = new Date(Date.now() - 9 * 7 * 86_400_000).toISOString();

  const [notesRes, aiRes, eventsRes, feedbackRes] = await Promise.all([
    supabase
      .from('notes')
      .select('created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null)
      .gte('created_at', since)
      .limit(20000),
    supabase
      .from('ai_interventions')
      .select('created_at')
      .in('space_id', spaceIds)
      .eq('suppressed', false)
      .gte('created_at', since)
      .limit(20000),
    supabase
      .from('events')
      .select('created_at')
      .in('space_id', spaceIds)
      .gte('created_at', new Date(Date.now() - 5 * 7 * 86_400_000).toISOString())
      .limit(20000),
    supabase
      .from('note_ai_feedbacks')
      .select('trigger_type, status')
      .in('space_id', spaceIds)
      .limit(20000),
  ]);

  const pulse = computePulse({
    noteTimes: (notesRes.data ?? []).map((r: { created_at: string }) => r.created_at),
    aiTimes: (aiRes.data ?? []).map((r: { created_at: string }) => r.created_at),
    eventTimes: (eventsRes.data ?? []).map((r: { created_at: string }) => r.created_at),
    feedbacks: (feedbackRes.data ?? []) as Array<{ trigger_type: string | null; status: string | null }>,
  });

  res.json({ pulse });
});

// ── Teacher "Needs Attention" Queue ──────────────────────────

router.get(
  '/courses/:courseId/needs-attention',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
  await ensureCourseInstructor(String(req.params.courseId), req.user!);
    const { courseId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 30, 100);

    const { data: spaces } = await supabase
      .from('spaces')
      .select('id')
      .eq('course_id', courseId);
    const spaceIds = (spaces ?? []).map((s: any) => s.id);
    if (spaceIds.length === 0) return res.json({ items: [] });

    const [stagnantRes, rejectedRes, triggeredRes] = await Promise.all([
      // Notes with no build-ons and no activity for 48h
      supabase
        .from('notes')
        .select('id, title, author_id, space_id, created_at, updated_at, users!author_id(name)')
        .in('space_id', spaceIds)
        .is('deleted_at', null)
        .eq('is_ai_generated', false)
        .lt('updated_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
        .order('updated_at', { ascending: true })
        .limit(limit),

      // AI feedbacks that were ignored
      supabase
        .from('note_ai_feedbacks')
        .select('id, note_id, trigger_type, feedback_text, created_at, user_id, notes!inner(title, author_id, space_id, users!author_id(name))')
        .eq('status', 'ignored')
        .in('space_id', spaceIds)
        .order('created_at', { ascending: false })
        .limit(limit),

      // Notes that repeatedly trigger AI feedback (3+ times = needs teacher attention)
      supabase
        .rpc('get_repeat_trigger_notes', { p_space_ids: spaceIds, p_min_count: 3 })
        .limit(limit),
    ]);

    type AttentionItem = {
      type: 'stagnant' | 'rejected_feedback' | 'repeat_trigger';
      noteId: string;
      noteTitle: string;
      studentName: string;
      spaceId: string;
      detail: string;
      timestamp: string;
    };

    const items: AttentionItem[] = [];

    for (const note of stagnantRes.data ?? []) {
      const user = Array.isArray((note as any).users) ? (note as any).users[0] : (note as any).users;
      items.push({
        type: 'stagnant',
        noteId: note.id,
        noteTitle: note.title ?? 'Untitled',
        studentName: cleanDisplayName(user?.name) || 'Unknown',
        spaceId: note.space_id,
        detail: `No activity for ${Math.round((Date.now() - new Date(note.updated_at as string).getTime()) / (3600 * 1000))}h`,
        timestamp: note.updated_at as string,
      });
    }

    for (const fb of rejectedRes.data ?? []) {
      const note = Array.isArray((fb as any).notes) ? (fb as any).notes[0] : (fb as any).notes;
      const user = note?.users ? (Array.isArray(note.users) ? note.users[0] : note.users) : null;
      items.push({
        type: 'rejected_feedback',
        noteId: fb.note_id,
        noteTitle: note?.title ?? 'Untitled',
        studentName: cleanDisplayName(user?.name) || 'Unknown',
        spaceId: note?.space_id ?? '',
        detail: `Ignored ${fb.trigger_type?.replace(/_/g, ' ')} feedback`,
        timestamp: fb.created_at,
      });
    }

    // repeat_trigger RPC may not exist yet — gracefully degrade
    for (const row of triggeredRes.data ?? []) {
      items.push({
        type: 'repeat_trigger',
        noteId: row.note_id,
        noteTitle: row.note_title ?? 'Untitled',
        studentName: cleanDisplayName(row.student_name) || 'Unknown',
        spaceId: row.space_id ?? '',
        detail: `Triggered ${row.trigger_count} times`,
        timestamp: row.latest_at ?? new Date().toISOString(),
      });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json({ items: items.slice(0, limit) });
  },
);

// ── AI Intervention Review Dashboard ────────────────────────

router.get(
  '/courses/:courseId/feedback-review',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
  await ensureCourseInstructor(String(req.params.courseId), req.user!);
    const { courseId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const [statsRes, recentRes] = await Promise.all([
      supabase.rpc('get_feedback_review_stats', { p_course_id: courseId }),
      supabase
        .from('note_ai_feedbacks')
        .select('id, note_id, user_id, trigger_type, feedback_text, status, created_at, responded_at, notes!inner(title), users!user_id(name)')
        .eq('course_id', courseId)
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);

    const stats = statsRes.data?.[0] ?? {
      total_feedbacks: 0, accepted_count: 0, ignored_count: 0,
      inserted_count: 0, new_count: 0, acceptance_rate: 0,
      trigger_distribution: {}, student_breakdown: [],
    };

    const feedbacks = (recentRes.data ?? []).map((fb: any) => {
      const note = Array.isArray(fb.notes) ? fb.notes[0] : fb.notes;
      const user = Array.isArray(fb.users) ? fb.users[0] : fb.users;
      return {
        id: fb.id,
        noteId: fb.note_id,
        noteTitle: note?.title ?? 'Untitled',
        userId: fb.user_id,
        studentName: cleanDisplayName(user?.name) || 'Unknown',
        triggerType: fb.trigger_type,
        feedbackText: fb.feedback_text,
        status: fb.status,
        createdAt: fb.created_at,
        respondedAt: fb.responded_at,
      };
    });

    res.json({
      stats: {
        totalFeedbacks: Number(stats.total_feedbacks),
        acceptedCount: Number(stats.accepted_count),
        ignoredCount: Number(stats.ignored_count),
        insertedCount: Number(stats.inserted_count),
        newCount: Number(stats.new_count),
        acceptanceRate: Number(stats.acceptance_rate),
        triggerDistribution: stats.trigger_distribution,
        studentBreakdown: stats.student_breakdown,
      },
      feedbacks,
    });
  },
);

// ── C2: Trigger Effectiveness Analytics ─────────────────────

router.get(
  '/courses/:courseId/trigger-effectiveness',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
  await ensureCourseInstructor(String(req.params.courseId), req.user!);
    const { courseId } = req.params;

    const { data, error } = await supabase.rpc('get_trigger_effectiveness', { p_course_id: courseId });
    if (error) throw new ApiError(500, error.message);

    res.json({
      effectiveness: (data ?? []).map((row: any) => ({
        triggerType: row.trigger_type,
        totalCount: Number(row.total_count),
        acceptedCount: Number(row.accepted_count),
        ignoredCount: Number(row.ignored_count),
        insertedCount: Number(row.inserted_count),
        acceptanceRate: Number(row.acceptance_rate),
        avgResponseTimeSeconds: row.avg_response_time_seconds ? Number(row.avg_response_time_seconds) : null,
      })),
    });
  },
);

// ── Feedback Trend (daily aggregation) ──────────────────────

router.get(
  '/courses/:courseId/feedback-trend',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
  await ensureCourseInstructor(String(req.params.courseId), req.user!);
    const { courseId } = req.params;
    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('note_ai_feedbacks')
      .select('id, status, trigger_type, created_at')
      .eq('course_id', courseId)
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (error) throw new ApiError(500, error.message);

    const buckets = new Map<string, { total: number; accepted: number; ignored: number; byTrigger: Record<string, number> }>();

    for (const fb of data ?? []) {
      const day = fb.created_at.slice(0, 10);
      if (!buckets.has(day)) buckets.set(day, { total: 0, accepted: 0, ignored: 0, byTrigger: {} });
      const b = buckets.get(day)!;
      b.total++;
      if (fb.status === 'accepted' || fb.status === 'inserted' || fb.status === 'followed_up') b.accepted++;
      if (fb.status === 'ignored') b.ignored++;
      b.byTrigger[fb.trigger_type] = (b.byTrigger[fb.trigger_type] ?? 0) + 1;
    }

    const trend = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, b]) => ({
        date,
        total: b.total,
        accepted: b.accepted,
        ignored: b.ignored,
        acceptanceRate: b.total > 0 ? Math.round((b.accepted / b.total) * 100) : 0,
        byTrigger: b.byTrigger,
      }));

    res.json({ trend, days });
  },
);

// ── Teacher: Learner Profiles for a course ───────────────────
router.get(
  '/courses/:courseId/learner-profiles',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
  await ensureCourseInstructor(String(req.params.courseId), req.user!);
    const { courseId } = req.params;

    const { data: allProfiles, error } = await supabase
      .from('learner_profiles')
      .select('*')
      .eq('course_id', courseId);

    if (error) throw new ApiError(500, error.message);

    // 只保留学生。写入侧已经拦住了新的教师画像，但库里还有历史遗留行 ——
    // 光堵住写入，教师照样留在这个列表里。
    // 注意 learner_profiles.user_id 外键指向 auth.users 而不是 public.profiles，
    // PostgREST 无法内联 join 角色，只能先把学生 id 捞出来再过滤。
    const studentIds = await filterStudentIds((allProfiles ?? []).map((p: any) => p.user_id));
    const profiles = (allProfiles ?? []).filter((p: any) => studentIds.has(p.user_id));

    const userIds = profiles.map((p: any) => p.user_id);
    const { data: users } = userIds.length > 0
      ? await supabase.from('users').select('id, name, email, avatar').in('id', userIds)
      : { data: [] };

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    const { data: feedbackStats } = await supabase
      .from('note_ai_feedbacks')
      .select('user_id, trigger_type, status')
      .eq('course_id', courseId);

    const feedbackByUser = new Map<string, { total: number; accepted: number; byType: Record<string, number> }>();
    for (const fb of feedbackStats ?? []) {
      const uid = fb.user_id as string;
      if (!feedbackByUser.has(uid)) feedbackByUser.set(uid, { total: 0, accepted: 0, byType: {} });
      const entry = feedbackByUser.get(uid)!;
      entry.total++;
      if (fb.status === 'accepted' || fb.status === 'inserted' || fb.status === 'followed_up') entry.accepted++;
      const tt = fb.trigger_type as string;
      entry.byType[tt] = (entry.byType[tt] ?? 0) + 1;
    }

    const { data: reflectionCounts } = await supabase
      .from('agent_reflections')
      .select('user_id')
      .eq('course_id', courseId);

    const reflCountMap = new Map<string, number>();
    for (const r of reflectionCounts ?? []) {
      reflCountMap.set(r.user_id, (reflCountMap.get(r.user_id) ?? 0) + 1);
    }

    const result = profiles.map((p: any) => {
      const user = userMap.get(p.user_id);
      const patterns = (p.cognitive_patterns ?? {}) as CognitivePatterns;
      const level = computeScaffoldingLevel({
        interactionCount: p.interaction_count ?? 0,
        avgMessageLength: p.avg_message_length ?? 0,
        cognitivePatterns: patterns,
        evidenceCited: p.evidence_cited ?? 0,
        connectionsMade: p.connections_made ?? 0,
      });
      const fb = feedbackByUser.get(p.user_id);

      return {
        userId: p.user_id,
        userName: user ? cleanDisplayName(user.name) || emailFallbackName(user.email) : 'Unknown',
        avatar: user?.avatar ?? null,
        scaffoldingLevel: level,
        interactionCount: p.interaction_count ?? 0,
        totalMessagesSent: p.total_messages_sent ?? 0,
        avgMessageLength: Math.round(p.avg_message_length ?? 0),
        questionsAsked: p.questions_asked ?? 0,
        evidenceCited: p.evidence_cited ?? 0,
        connectionsMade: p.connections_made ?? 0,
        cognitivePatterns: patterns,
        reflectionCount: reflCountMap.get(p.user_id) ?? 0,
        feedbackStats: fb ?? { total: 0, accepted: 0, byType: {} },
        lastInteractionAt: p.last_interaction_at,
      };
    });

    res.json({ profiles: result });
  },
);

// ── Student: My Learning Insights ────────────────────────────
router.get(
  '/courses/:courseId/my-learning-insights',
  verifyJWT,
  async (req: Request, res: Response) => {
  await ensureCourseMember(String(req.params.courseId), req.user!);
    const userId = req.user!.id;
    const { courseId } = req.params;

    const [profileRes, reflectionsRes, feedbackRes] = await Promise.all([
      supabase
        .from('learner_profiles')
        .select('*')
        .eq('user_id', userId)
        .eq('course_id', courseId)
        .maybeSingle(),
      supabase
        .from('agent_reflections')
        .select('id, reflection_type, content, topic_keywords, created_at')
        .eq('user_id', userId)
        .eq('course_id', courseId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('note_ai_feedbacks')
        .select('trigger_type, status, created_at')
        .eq('user_id', userId)
        .eq('course_id', courseId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const profile = profileRes.data;
    const patterns = (profile?.cognitive_patterns ?? {}) as CognitivePatterns;
    const level = profile ? computeScaffoldingLevel({
      interactionCount: profile.interaction_count ?? 0,
      avgMessageLength: profile.avg_message_length ?? 0,
      cognitivePatterns: patterns,
      evidenceCited: profile.evidence_cited ?? 0,
      connectionsMade: profile.connections_made ?? 0,
    }) : 'high';

    const reflections = (reflectionsRes.data ?? []).map((r: any) => ({
      id: r.id,
      type: r.reflection_type,
      content: r.content,
      keywords: r.topic_keywords ?? [],
      createdAt: r.created_at,
    }));

    const feedbackHistory = (feedbackRes.data ?? []).map((f: any) => ({
      triggerType: f.trigger_type,
      status: f.status,
      createdAt: f.created_at,
    }));

    const triggerCounts: Record<string, number> = {};
    let accepted = 0;
    for (const f of feedbackHistory) {
      triggerCounts[f.triggerType] = (triggerCounts[f.triggerType] ?? 0) + 1;
      if (f.status === 'accepted' || f.status === 'inserted' || f.status === 'followed_up') accepted++;
    }

    res.json({
      insights: {
        hasProfile: !!profile,
        scaffoldingLevel: level,
        interactionCount: profile?.interaction_count ?? 0,
        questionsAsked: profile?.questions_asked ?? 0,
        evidenceCited: profile?.evidence_cited ?? 0,
        connectionsMade: profile?.connections_made ?? 0,
        reflections,
        reflectionCount: reflections.length,
        feedbackSummary: {
          total: feedbackHistory.length,
          accepted,
          acceptanceRate: feedbackHistory.length > 0 ? Math.round((accepted / feedbackHistory.length) * 100) : 0,
          byType: triggerCounts,
        },
        lastInteractionAt: profile?.last_interaction_at ?? null,
      },
    });
  },
);

// ── Student: Personal Learning Analytics (cross-course) ─────
router.get(
  '/student-analytics',
  verifyJWT,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const [memberRes, instructedRes] = await Promise.all([
      supabase.from('course_members').select('course_id').eq('user_id', userId),
      supabase.from('courses').select('id').eq('instructor_id', userId),
    ]);
    const courseIds = Array.from(new Set([
      ...(memberRes.data ?? []).map((m: any) => m.course_id as string),
      ...(instructedRes.data ?? []).map((c: any) => c.id as string),
    ]));
    if (courseIds.length === 0) {
      return res.json({ analytics: { noteActivity: [], buildOns: { given: 0, received: 0 }, communityStats: { uniqueCollaborators: 0, totalNotes: 0 }, weeklyTrend: [], actionItems: [] } });
    }

    const { data: spaces } = await supabase
      .from('spaces').select('id, course_id').in('course_id', courseIds);
    const spaceIds = (spaces ?? []).map((s: any) => s.id as string);
    if (spaceIds.length === 0) {
      return res.json({ analytics: { noteActivity: [], buildOns: { given: 0, received: 0 }, communityStats: { uniqueCollaborators: 0, totalNotes: 0 }, weeklyTrend: [], actionItems: [] } });
    }

    const tzOffset = Math.min(Math.max(Number(req.query.tz) || 8, -12), 14);
    const prevSince = new Date(Date.now() - days * 2 * 86_400_000).toISOString();

    const [myNotesRes, relGivenRes, aiUsageRes, communityNotesRes, allSpaceRelationsRes, prevAiRes] = await Promise.all([
      supabase
        .from('notes')
        .select('id, title, content, type, space_id, created_at, updated_at')
        .in('space_id', spaceIds)
        .eq('author_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
      supabase
        .from('relations')
        .select('id, relation_type, target_note_id, created_at')
        .in('space_id', spaceIds)
        .eq('creator_id', userId),
      supabase
        .from('ai_interventions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', since),
      supabase
        .from('notes')
        .select('id, author_id')
        .in('space_id', spaceIds)
        .is('deleted_at', null),
      supabase
        .from('relations')
        .select('source_note_id, target_note_id')
        .in('space_id', spaceIds),
      supabase
        .from('ai_interventions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', prevSince)
        .lt('created_at', since),
    ]);

    const myNotes = myNotesRes.data ?? [];
    const myNoteIds = myNotes.map((n: any) => n.id as string);
    const communityNotes = communityNotesRes.data ?? [];
    const allSpaceRelations = allSpaceRelationsRes.data ?? [];

    // NOTE: relation_type values are extend/clarify/question/challenge/evidence/synthesize.
    // Every relation is a build-on-style connection; "build-ons" = all relations.
    let relReceivedRes: any = { data: [] };
    if (myNoteIds.length > 0) {
      relReceivedRes = await supabase
        .from('relations')
        .select('id, relation_type, source_note_id, target_note_id, creator_id, created_at')
        .in('target_note_id', myNoteIds);
    }
    const relGiven = (relGivenRes.data ?? []) as any[];
    const relReceivedAll = ((relReceivedRes.data ?? []) as any[]).filter(r => r.creator_id !== userId);
    const relGivenPeriod = relGiven.filter(r => r.created_at >= since);
    const relReceivedPeriod = relReceivedAll.filter(r => r.created_at >= since);

    const buildOnsGiven = relGivenPeriod.length;
    const buildOnsReceived = relReceivedPeriod.length;

    // Relation type breakdowns (period)
    const relationTypesGiven: Record<string, number> = {};
    for (const r of relGivenPeriod) relationTypesGiven[r.relation_type] = (relationTypesGiven[r.relation_type] ?? 0) + 1;
    const relationTypesReceived: Record<string, number> = {};
    for (const r of relReceivedPeriod) relationTypesReceived[r.relation_type] = (relationTypesReceived[r.relation_type] ?? 0) + 1;

    const refsGiven = relationTypesGiven['evidence'] ?? 0;
    const refsReceived = relationTypesReceived['evidence'] ?? 0;

    // My note type distribution
    const noteTypeDist: Record<string, number> = {};
    for (const n of myNotes) noteTypeDist[n.type ?? 'note'] = (noteTypeDist[n.type ?? 'note'] ?? 0) + 1;

    // Collaborators (all time, both directions)
    const noteAuthorMap = new Map<string, string>();
    for (const n of communityNotes) noteAuthorMap.set(n.id, n.author_id);
    const collaboratorCounts = new Map<string, { given: number; received: number }>();
    const bump = (id: string, dir: 'given' | 'received') => {
      if (!id || id === userId) return;
      const c = collaboratorCounts.get(id) ?? { given: 0, received: 0 };
      c[dir]++;
      collaboratorCounts.set(id, c);
    };
    for (const r of relReceivedAll) bump(r.creator_id, 'received');
    for (const r of relGiven) {
      const targetAuthor = noteAuthorMap.get(r.target_note_id);
      if (targetAuthor) bump(targetAuthor, 'given');
    }

    // Idea impact: downstream build-on subtree of my notes (community-wide)
    const childMap = new Map<string, string[]>();
    for (const r of allSpaceRelations) {
      if (!childMap.has(r.target_note_id)) childMap.set(r.target_note_id, []);
      childMap.get(r.target_note_id)!.push(r.source_note_id);
    }
    let maxImpactChain = 0;
    let totalDescendants = 0;
    for (const noteId of myNoteIds) {
      const seen = new Set<string>([noteId]);
      let frontier = [noteId];
      let depth = 0;
      while (frontier.length > 0) {
        const next: string[] = [];
        for (const f of frontier) {
          for (const c of childMap.get(f) ?? []) {
            if (!seen.has(c)) {
              seen.add(c);
              next.push(c);
            }
          }
        }
        if (next.length > 0) depth++;
        frontier = next;
      }
      maxImpactChain = Math.max(maxImpactChain, depth);
      totalDescendants += seen.size - 1;
    }

    // Community percentile by note count
    const authorNoteCounts = new Map<string, number>();
    for (const n of communityNotes) authorNoteCounts.set(n.author_id, (authorNoteCounts.get(n.author_id) ?? 0) + 1);
    const myCount = authorNoteCounts.get(userId) ?? 0;
    const otherCounts = Array.from(authorNoteCounts.entries()).filter(([id]) => id !== userId).map(([, c]) => c);
    const percentile = otherCounts.length > 0
      ? Math.round((otherCounts.filter(c => c < myCount).length / otherCounts.length) * 100)
      : 100;

    // Personal posting hour distribution (course-local time)
    const hourDist = Array(24).fill(0);
    for (const n of myNotes) {
      hourDist[new Date(new Date(n.created_at).getTime() + tzOffset * 3600000).getUTCHours()]++;
    }

    const weekMap = new Map<string, { notes: number; buildOnsGiven: number; buildOnsReceived: number }>();
    const toWeekKey = (d: string) => {
      const date = new Date(d);
      const day = date.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      return new Date(date.getTime() + diff * 86400000).toISOString().slice(0, 10);
    };

    for (const n of myNotes) {
      if (n.created_at >= since) {
        const wk = toWeekKey(n.created_at);
        const entry = weekMap.get(wk) ?? { notes: 0, buildOnsGiven: 0, buildOnsReceived: 0 };
        entry.notes++;
        weekMap.set(wk, entry);
      }
    }
    for (const r of relGivenPeriod) {
      const wk = toWeekKey(r.created_at);
      const entry = weekMap.get(wk) ?? { notes: 0, buildOnsGiven: 0, buildOnsReceived: 0 };
      entry.buildOnsGiven++;
      weekMap.set(wk, entry);
    }
    for (const r of relReceivedPeriod) {
      const wk = toWeekKey(r.created_at);
      const entry = weekMap.get(wk) ?? { notes: 0, buildOnsGiven: 0, buildOnsReceived: 0 };
      entry.buildOnsReceived++;
      weekMap.set(wk, entry);
    }
    const weeklyTrend = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, data]) => ({ week, ...data }));

    const noteActivity = myNotes.map((n: any) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      contentLength: noteTextLength(n.content),
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    }));

    const builtOnIds = new Set(relReceivedAll.map((r: any) => r.target_note_id));
    const unbuiltNotes = myNotes
      .filter((n: any) => !builtOnIds.has(n.id))
      .slice(-5)
      .map((n: any) => ({ id: n.id, title: n.title, createdAt: n.created_at }));

    const recentBuildOnsOnMe = relReceivedAll
      .slice(-5)
      .map((r: any) => ({ sourceNoteId: r.source_note_id, creatorId: r.creator_id, createdAt: r.created_at }));

    // Resolve names for recent builders + top collaborators in one query
    const topCollaboratorIds = Array.from(collaboratorCounts.entries())
      .sort((a, b) => (b[1].given + b[1].received) - (a[1].given + a[1].received))
      .slice(0, 5)
      .map(([id]) => id);
    const nameIds = [...new Set([
      ...recentBuildOnsOnMe.map((b: any) => b.creatorId).filter(Boolean),
      ...topCollaboratorIds,
    ])];
    const profileNames = new Map<string, string>();
    if (nameIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles').select('id, full_name').in('id', nameIds);
      for (const p of profiles ?? []) profileNames.set(p.id, p.full_name ?? '');
    }

    const topCollaborators = topCollaboratorIds.map(id => {
      const c = collaboratorCounts.get(id)!;
      return { id, name: profileNames.get(id) || '', given: c.given, received: c.received, total: c.given + c.received };
    });

    const actionItems: Array<{ type: string; message: string; count?: number }> = [];
    if (unbuiltNotes.length > 0) {
      actionItems.push({ type: 'unbuilt_notes', message: `${unbuiltNotes.length} notes haven't been built on yet`, count: unbuiltNotes.length });
    }
    if (recentBuildOnsOnMe.length > 0) {
      actionItems.push({ type: 'new_build_ons', message: `${recentBuildOnsOnMe.length} peers built on your ideas recently`, count: recentBuildOnsOnMe.length });
    }

    const currentPeriodNotes = myNotes.filter((n: any) => n.created_at >= since);
    const prevPeriodNotes = myNotes.filter((n: any) => n.created_at >= prevSince && n.created_at < since);
    const curAvgLen = currentPeriodNotes.length > 0
      ? currentPeriodNotes.reduce((s: number, n: any) => s + noteTextLength(n.content), 0) / currentPeriodNotes.length
      : 0;
    const prevAvgLen = prevPeriodNotes.length > 0
      ? prevPeriodNotes.reduce((s: number, n: any) => s + noteTextLength(n.content), 0) / prevPeriodNotes.length
      : 0;
    const pctChange = (cur: number, prev: number) => prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : (cur > 0 ? 100 : 0);
    const avgLengthChange = pctChange(curAvgLen, prevAvgLen);
    const curAi = aiUsageRes.count ?? 0;
    const prevAi = prevAiRes.count ?? 0;
    const aiInteractionsChange = pctChange(curAi, prevAi);

    res.json({
      analytics: {
        period: { days, since },
        noteActivity,
        totalNotes: myNotes.length,
        buildOns: { given: buildOnsGiven, received: buildOnsReceived },
        references: { given: refsGiven, received: refsReceived },
        relationTypesGiven,
        relationTypesReceived,
        noteTypeDist,
        ideaImpact: { maxChain: maxImpactChain, totalDescendants },
        percentile,
        hourDist,
        communityStats: {
          uniqueCollaborators: collaboratorCounts.size,
          totalNotes: communityNotes.length,
          totalAuthors: authorNoteCounts.size,
        },
        aiInteractions: curAi,
        aiInteractionsChange,
        avgLengthChange,
        weeklyTrend,
        actionItems,
        unbuiltNotes,
        topCollaborators,
        recentBuildOns: recentBuildOnsOnMe.map((b: any) => ({
          ...b,
          creatorName: profileNames.get(b.creatorId) ?? '',
        })),
      },
    });
  },
);

// ── Student: Personal Knowledge Graph ─────────────────────────
// Auto-built graph of the student's own notes, their 1-hop neighborhood,
// and extracted concept keywords linking related notes together.

router.get(
  '/student-knowledge-graph',
  verifyJWT,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const courseFilter = typeof req.query.courseId === 'string' && req.query.courseId ? req.query.courseId : null;

    const [memberRes, instructedRes] = await Promise.all([
      supabase.from('course_members').select('course_id').eq('user_id', userId),
      supabase.from('courses').select('id').eq('instructor_id', userId),
    ]);
    let courseIds = Array.from(new Set([
      ...(memberRes.data ?? []).map((m: any) => m.course_id as string),
      ...(instructedRes.data ?? []).map((c: any) => c.id as string),
    ]));
    if (courseFilter) courseIds = courseIds.filter(id => id === courseFilter);

    const empty = { nodes: [], edges: [], concepts: [], courses: [], stats: { myNotes: 0, peerNotes: 0, concepts: 0, connections: 0 } };
    if (courseIds.length === 0) return res.json({ graph: empty });

    const [{ data: spaces }, { data: courses }] = await Promise.all([
      supabase.from('spaces').select('id, course_id').in('course_id', courseIds),
      supabase.from('courses').select('id, title').in('id', courseIds),
    ]);
    const spaceIds = (spaces ?? []).map((s: any) => s.id as string);
    if (spaceIds.length === 0) return res.json({ graph: empty });

    const spaceCourse = new Map<string, string>();
    for (const s of spaces ?? []) spaceCourse.set(s.id, s.course_id);
    const courseTitles = new Map<string, string>();
    for (const c of courses ?? []) courseTitles.set(c.id, c.title);

    const { data: myNotesData } = await supabase
      .from('notes')
      .select('id, title, content, type, space_id, created_at')
      .in('space_id', spaceIds)
      .eq('author_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(80);
    const myNotes = myNotesData ?? [];
    const myNoteIds = myNotes.map((n: any) => n.id as string);
    const myNoteIdSet = new Set(myNoteIds);

    if (myNotes.length === 0) return res.json({ graph: empty });

    // Relations touching my notes (either direction)
    const [givenRes, receivedRes] = await Promise.all([
      supabase.from('relations')
        .select('source_note_id, target_note_id, relation_type, creator_id')
        .in('source_note_id', myNoteIds),
      supabase.from('relations')
        .select('source_note_id, target_note_id, relation_type, creator_id')
        .in('target_note_id', myNoteIds),
    ]);
    const touchingRels = [...(givenRes.data ?? []), ...(receivedRes.data ?? [])];
    // Dedupe relations
    const relKeySet = new Set<string>();
    const relations = touchingRels.filter((r: any) => {
      const key = `${r.source_note_id}|${r.target_note_id}|${r.relation_type}`;
      if (relKeySet.has(key)) return false;
      relKeySet.add(key);
      return true;
    });

    // 1-hop peer notes
    const peerNoteIds = new Set<string>();
    for (const r of relations) {
      if (!myNoteIdSet.has(r.source_note_id)) peerNoteIds.add(r.source_note_id);
      if (!myNoteIdSet.has(r.target_note_id)) peerNoteIds.add(r.target_note_id);
    }
    let peerNotes: any[] = [];
    if (peerNoteIds.size > 0) {
      const { data } = await supabase
        .from('notes')
        .select('id, title, type, author_id, space_id, created_at')
        .in('id', Array.from(peerNoteIds).slice(0, 60))
        .is('deleted_at', null);
      peerNotes = data ?? [];
    }

    // Peer author names
    const peerAuthorIds = [...new Set(peerNotes.map((n: any) => n.author_id).filter((id: string) => id !== userId))];
    const authorNames = new Map<string, string>();
    if (peerAuthorIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', peerAuthorIds);
      for (const p of profiles ?? []) authorNames.set(p.id, p.full_name ?? '');
    }

    // Concept extraction from my notes (titles get boosted weight)
    const conceptMap = extractConcepts(
      myNotes.map((n: any) => ({ id: n.id, title: n.title ?? '', text: n.content ?? '' })),
      12,
    );

    const nodes = [
      ...myNotes.map((n: any) => ({
        id: n.id,
        kind: 'mine' as const,
        label: n.title || '(无标题)',
        noteType: n.type ?? 'note',
        courseTitle: courseTitles.get(spaceCourse.get(n.space_id) ?? '') ?? '',
        preview: notePreviewText(n.content).slice(0, 120),
        createdAt: n.created_at,
      })),
      ...peerNotes.map((n: any) => ({
        id: n.id,
        kind: 'peer' as const,
        label: n.title || '(无标题)',
        noteType: n.type ?? 'note',
        courseTitle: courseTitles.get(spaceCourse.get(n.space_id) ?? '') ?? '',
        authorName: authorNames.get(n.author_id) ?? '',
        createdAt: n.created_at,
      })),
      ...Array.from(conceptMap.keys()).map(term => ({
        id: `concept:${term}`,
        kind: 'concept' as const,
        label: term,
        noteCount: conceptMap.get(term)!.size,
      })),
    ];
    const nodeIdSet = new Set(nodes.map(n => n.id));

    const edges = [
      ...relations
        .filter((r: any) => nodeIdSet.has(r.source_note_id) && nodeIdSet.has(r.target_note_id))
        .map((r: any) => ({
          source: r.source_note_id,
          target: r.target_note_id,
          kind: 'relation' as const,
          relationType: r.relation_type,
        })),
      ...Array.from(conceptMap.entries()).flatMap(([term, noteIds]) =>
        Array.from(noteIds)
          .filter(id => nodeIdSet.has(id))
          .map(id => ({
            source: `concept:${term}`,
            target: id,
            kind: 'contains' as const,
          })),
      ),
    ];

    res.json({
      graph: {
        nodes,
        edges,
        concepts: Array.from(conceptMap.entries()).map(([term, ids]) => ({ term, noteCount: ids.size })),
        courses: courseIds.map(id => ({ id, title: courseTitles.get(id) ?? '' })),
        stats: {
          myNotes: myNotes.length,
          peerNotes: peerNotes.length,
          concepts: conceptMap.size,
          connections: edges.filter(e => e.kind === 'relation').length,
        },
      },
    });
  },
);

// ── Student: Promising Ideas (潜力想法) ───────────────────────
// Scardamalia's "focus on most promising ideas" + redundancy discovery +
// rise-above opportunities, computed from build-on signals, T5 promising
// triggers, and concept overlap between notes.

router.get(
  '/student-promising-ideas',
  verifyJWT,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const [memberRes, instructedRes] = await Promise.all([
      supabase.from('course_members').select('course_id').eq('user_id', userId),
      supabase.from('courses').select('id').eq('instructor_id', userId),
    ]);
    const courseIds = Array.from(new Set([
      ...(memberRes.data ?? []).map((m: any) => m.course_id as string),
      ...(instructedRes.data ?? []).map((c: any) => c.id as string),
    ]));
    const empty = { promisingIdeas: [], similarPeers: [], riseAboveClusters: [] };
    if (courseIds.length === 0) return res.json(empty);

    const { data: spaces } = await supabase.from('spaces').select('id').in('course_id', courseIds);
    const spaceIds = (spaces ?? []).map((s: any) => s.id as string);
    if (spaceIds.length === 0) return res.json(empty);

    const [myNotesRes, communityNotesRes] = await Promise.all([
      supabase
        .from('notes')
        .select('id, title, content, type, created_at')
        .in('space_id', spaceIds)
        .eq('author_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('notes')
        .select('id, title, content, author_id, created_at')
        .in('space_id', spaceIds)
        .neq('author_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(250),
    ]);
    const myNotes = myNotesRes.data ?? [];
    if (myNotes.length === 0) return res.json(empty);
    const myNoteIds = myNotes.map((n: any) => n.id as string);
    const communityNotes = communityNotesRes.data ?? [];

    const [receivedRelsRes, promisingTriggersRes] = await Promise.all([
      supabase
        .from('relations')
        .select('target_note_id, relation_type, creator_id')
        .in('target_note_id', myNoteIds),
      supabase
        .from('ai_interventions')
        .select('note_id, trigger_type')
        .in('space_id', spaceIds)
        .eq('trigger_type', 'T5')
        .in('note_id', myNoteIds),
    ]);
    const receivedRels = (receivedRelsRes.data ?? []).filter((r: any) => r.creator_id !== userId);
    const promisingHits = new Map<string, number>();
    for (const t of promisingTriggersRes.data ?? []) {
      if (t.note_id) promisingHits.set(t.note_id, (promisingHits.get(t.note_id) ?? 0) + 1);
    }

    // ── Promising ideas: build-on received ×2 + T5 promising ×3 + evidence/synthesize received ×1.5
    const buildOnCounts = new Map<string, number>();
    const deepRelCounts = new Map<string, number>();
    for (const r of receivedRels) {
      buildOnCounts.set(r.target_note_id, (buildOnCounts.get(r.target_note_id) ?? 0) + 1);
      if (r.relation_type === 'evidence' || r.relation_type === 'synthesize') {
        deepRelCounts.set(r.target_note_id, (deepRelCounts.get(r.target_note_id) ?? 0) + 1);
      }
    }
    const promisingIdeas = myNotes
      .map((n: any) => {
        const buildOns = buildOnCounts.get(n.id) ?? 0;
        const t5 = promisingHits.get(n.id) ?? 0;
        const deep = deepRelCounts.get(n.id) ?? 0;
        return {
          id: n.id,
          title: n.title || '(无标题)',
          createdAt: n.created_at,
          buildOns,
          promisingFlags: t5,
          deepRelations: deep,
          score: Math.round((buildOns * 2 + t5 * 3 + deep * 1.5) * 10) / 10,
        };
      })
      .filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    // ── Concept sets: mine + community (shared extraction pass for consistency)
    const allDocs = [
      ...myNotes.map((n: any) => ({ id: n.id, title: n.title ?? '', text: n.content ?? '' })),
      ...communityNotes.map((n: any) => ({ id: n.id, title: n.title ?? '', text: n.content ?? '' })),
    ];
    const conceptMap = extractConceptsScored(allDocs, 40);
    const noteConcepts = new Map<string, Set<string>>();
    for (const [term, v] of conceptMap) {
      for (const noteId of v.docs) {
        if (!noteConcepts.has(noteId)) noteConcepts.set(noteId, new Set());
        noteConcepts.get(noteId)!.add(term);
      }
    }

    // ── Similar peers: peer notes sharing >= 2 concepts with one of my notes
    const myNoteById = new Map(myNotes.map((n: any) => [n.id, n]));
    const alreadyConnected = new Set(receivedRels.map((r: any) => `${r.creator_id}`));
    const peerMatches: { peerNoteId: string; peerAuthorId: string; myNoteId: string; shared: string[] }[] = [];
    for (const pn of communityNotes) {
      const pnConcepts = noteConcepts.get(pn.id);
      if (!pnConcepts || pnConcepts.size === 0) continue;
      for (const myId of myNoteIds) {
        const mine = noteConcepts.get(myId);
        if (!mine) continue;
        const shared = Array.from(pnConcepts).filter(c => mine.has(c));
        if (shared.length >= 2) {
          peerMatches.push({ peerNoteId: pn.id, peerAuthorId: pn.author_id, myNoteId: myId, shared });
        }
      }
    }
    peerMatches.sort((a, b) => b.shared.length - a.shared.length);
    const seenPeerNotes = new Set<string>();
    const topMatches = peerMatches.filter(m => {
      if (seenPeerNotes.has(m.peerNoteId)) return false;
      seenPeerNotes.add(m.peerNoteId);
      return true;
    }).slice(0, 5);

    const peerAuthorIds = [...new Set(topMatches.map(m => m.peerAuthorId))];
    const peerNames = new Map<string, string>();
    if (peerAuthorIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', peerAuthorIds);
      for (const p of profiles ?? []) peerNames.set(p.id, p.full_name ?? '');
    }
    const peerNoteById = new Map(communityNotes.map((n: any) => [n.id, n]));
    const similarPeers = topMatches.map(m => {
      const pn = peerNoteById.get(m.peerNoteId);
      const mn = myNoteById.get(m.myNoteId);
      return {
        peerNoteId: m.peerNoteId,
        peerNoteTitle: pn?.title || '(无标题)',
        peerName: peerNames.get(m.peerAuthorId) || '',
        myNoteId: m.myNoteId,
        myNoteTitle: mn?.title || '(无标题)',
        sharedConcepts: m.shared.slice(0, 4),
        alreadyInteracted: alreadyConnected.has(m.peerAuthorId),
      };
    });

    // ── Rise-above clusters: greedy grouping of my notes sharing >= 2 concepts
    const clusters: { noteIds: string[]; concepts: Set<string> }[] = [];
    const assigned = new Set<string>();
    for (const myId of myNoteIds) {
      if (assigned.has(myId)) continue;
      const mine = noteConcepts.get(myId);
      if (!mine || mine.size === 0) continue;
      const group = [myId];
      const groupConcepts = new Set(mine);
      for (const otherId of myNoteIds) {
        if (otherId === myId || assigned.has(otherId)) continue;
        const other = noteConcepts.get(otherId);
        if (!other) continue;
        const shared = Array.from(other).filter(c => groupConcepts.has(c));
        if (shared.length >= 2) {
          group.push(otherId);
          for (const c of other) groupConcepts.add(c);
        }
      }
      if (group.length >= 3) {
        for (const id of group) assigned.add(id);
        clusters.push({ noteIds: group, concepts: groupConcepts });
      }
    }
    const riseAboveClusters = clusters.slice(0, 3).map(c => {
      // Rank the cluster's concepts by global score for a readable theme label
      const themes = Array.from(c.concepts)
        .map(t => ({ t, s: conceptMap.get(t)?.score ?? 0 }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 3)
        .map(x => x.t);
      return {
        themes,
        notes: c.noteIds.map(id => {
          const n = myNoteById.get(id);
          return { id, title: n?.title || '(无标题)', createdAt: n?.created_at ?? '' };
        }).slice(0, 6),
      };
    });

    res.json({ promisingIdeas, similarPeers, riseAboveClusters });
  },
);

export default router;
