import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { cleanDisplayName, emailFallbackName } from '../services/displayName';

const router = Router();
const DEFAULT_INSTRUCTOR_NAME = 'Course teacher';

type ProviderUsage = {
  providerId: string;
  count: number;
  percentage: number;
};

type CourseAIUsage = {
  courseId: string;
  courseName: string;
  teacherName: string;
  messageCount: number;
  activeProviders: string[];
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function countRows(
  table: string,
  build?: (query: any) => any,
): Promise<number> {
  const base = supabase.from(table).select('id', { count: 'exact', head: true });
  const finalQuery = build ? build(base as any) : base;
  const { count, error } = (await finalQuery) as { count: number | null; error: { message: string } | null };
  if (error) throw new ApiError(500, error.message);
  return count ?? 0;
}

router.get('/overview', verifyJWT, requireRole('admin'), async (_req: Request, res: Response) => {
  const last30Iso = daysAgoIso(30);

  const [
    totalCourses,
    courses30d,
    totalTeachers,
    teachers30d,
    totalStudents,
    students30d,
    pendingTeachers,
    totalMessages,
    messages30d,
    messages24h,
  ] = await Promise.all([
    countRows('courses'),
    countRows('courses', (q) => q.gte('created_at', last30Iso)),
    countRows('profiles', (q) => q.eq('role', 'teacher').neq('status', 'inactive')),
    countRows('profiles', (q) => q.eq('role', 'teacher').gte('created_at', last30Iso)),
    countRows('profiles', (q) => q.eq('role', 'student').neq('status', 'inactive')),
    countRows('profiles', (q) => q.eq('role', 'student').gte('created_at', last30Iso)),
    countRows('profiles', (q) => q.eq('role', 'teacher').eq('status', 'pending')),
    countRows('ai_interventions'),
    countRows('ai_interventions', (q) => q.gte('created_at', last30Iso)),
    countRows('ai_interventions', (q) => q.gte('created_at', daysAgoIso(1))),
  ]);

  res.json({
    overview: {
      totals: {
        totalCourses,
        totalTeachers,
        totalStudents,
        totalMessages,
        pendingTeachers,
      },
      deltas30d: {
        courses: courses30d,
        teachers: teachers30d,
        students: students30d,
        messages: messages30d,
      },
      activity: {
        aiMessages24h: messages24h,
      },
      generatedAt: new Date().toISOString(),
    },
  });
});

router.get('/ai-analytics', verifyJWT, requireRole('admin'), async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 20);

  const { data: interventions, error: interventionError } = await supabase
    .from('ai_interventions')
    .select('provider_id, space_id, created_at');

  if (interventionError) throw new ApiError(500, interventionError.message);

  const rows = (interventions ?? []) as Array<{ provider_id: string | null; space_id: string | null }>;
  const providerMap = new Map<string, number>();
  let totalMessages = 0;

  for (const row of rows) {
    if (!row.provider_id) continue;
    totalMessages += 1;
    providerMap.set(row.provider_id, (providerMap.get(row.provider_id) ?? 0) + 1);
  }

  const providerUsage: ProviderUsage[] = Array.from(providerMap.entries())
    .map(([providerId, count]) => ({
      providerId,
      count,
      percentage: totalMessages > 0 ? Number(((count / totalMessages) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const spaceIds = Array.from(new Set(rows.map((r) => r.space_id).filter((id): id is string => Boolean(id))));
  let courseUsage: CourseAIUsage[] = [];

  if (spaceIds.length > 0) {
    const { data: spaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, course_id')
      .in('id', spaceIds);
    if (spacesError) throw new ApiError(500, spacesError.message);

    const spaceToCourse = new Map<string, string>();
    const courseIds = new Set<string>();
    for (const row of (spaces ?? []) as Array<{ id: string; course_id: string }>) {
      spaceToCourse.set(row.id, row.course_id);
      courseIds.add(row.course_id);
    }

    const courseIdList = Array.from(courseIds);
    const { data: courses, error: coursesError } = await supabase
      .from('courses')
      .select('id, title, instructor_id')
      .in('id', courseIdList);
    if (coursesError) throw new ApiError(500, coursesError.message);

    const instructorIds = Array.from(
      new Set((courses ?? []).map((c: any) => c.instructor_id).filter((id: unknown): id is string => typeof id === 'string')),
    );
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', instructorIds);
    if (profilesError) throw new ApiError(500, profilesError.message);

    const teacherNameById = new Map<string, string>();
    for (const row of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      const name = cleanDisplayName(row.full_name ?? undefined) ?? emailFallbackName(row.email ?? undefined);
      if (name) teacherNameById.set(row.id, name);
    }

    const courseMeta = new Map<string, { title: string; instructorId: string }>();
    for (const row of (courses ?? []) as Array<{ id: string; title: string; instructor_id: string }>) {
      courseMeta.set(row.id, { title: row.title, instructorId: row.instructor_id });
    }

    const usageAgg = new Map<string, { count: number; providers: Set<string> }>();
    for (const row of rows) {
      if (!row.provider_id || !row.space_id) continue;
      const courseId = spaceToCourse.get(row.space_id);
      if (!courseId) continue;
      const agg = usageAgg.get(courseId) ?? { count: 0, providers: new Set<string>() };
      agg.count += 1;
      agg.providers.add(row.provider_id);
      usageAgg.set(courseId, agg);
    }

    courseUsage = Array.from(usageAgg.entries())
      .map(([courseId, agg]) => {
        const meta = courseMeta.get(courseId);
        const teacherName = meta ? (teacherNameById.get(meta.instructorId) ?? DEFAULT_INSTRUCTOR_NAME) : DEFAULT_INSTRUCTOR_NAME;
        return {
          courseId,
          courseName: meta?.title ?? 'Untitled Course',
          teacherName,
          messageCount: agg.count,
          activeProviders: Array.from(agg.providers),
        };
      })
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, Math.max(1, limit));
  }

  const totalCourses = await countRows('courses');
  const totalTeachers = await countRows('profiles', (q) => q.eq('role', 'teacher').neq('status', 'inactive'));
  const totalStudents = await countRows('profiles', (q) => q.eq('role', 'student').neq('status', 'inactive'));

  res.json({
    stats: {
      platformTotals: {
        totalCourses,
        totalTeachers,
        totalStudents,
        totalMessages,
      },
      providerUsage,
      courseUsage,
      generatedAt: new Date().toISOString(),
    },
  });
});

router.get('/courses', verifyJWT, requireRole('admin'), async (_req: Request, res: Response) => {
  const { data: courses, error: courseError } = await supabase
    .from('courses')
    .select('id, title, instructor_id, cover_image, tags, verification_code, created_at')
    .order('created_at', { ascending: false });
  if (courseError) throw new ApiError(500, courseError.message);

  const courseRows = (courses ?? []) as Array<{
    id: string;
    title: string;
    instructor_id: string;
    cover_image?: string | null;
    tags?: string[] | null;
    verification_code?: string | null;
    created_at: string;
  }>;

  const courseIds = courseRows.map((c) => c.id);
  if (courseIds.length === 0) {
    res.json({ courses: [] });
    return;
  }

  const instructorIds = Array.from(new Set(courseRows.map((c) => c.instructor_id)));
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', instructorIds);
  if (profileError) throw new ApiError(500, profileError.message);

  const instructorNameById = new Map<string, string>();
  for (const row of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
    const name = cleanDisplayName(row.full_name ?? undefined) ?? emailFallbackName(row.email ?? undefined);
    if (name) instructorNameById.set(row.id, name);
  }

  const { data: memberships, error: memberError } = await supabase
    .from('course_members')
    .select('course_id')
    .in('course_id', courseIds);
  if (memberError) throw new ApiError(500, memberError.message);

  const studentCountByCourse = new Map<string, number>();
  for (const row of (memberships ?? []) as Array<{ course_id: string }>) {
    studentCountByCourse.set(row.course_id, (studentCountByCourse.get(row.course_id) ?? 0) + 1);
  }

  const { data: spaces, error: spacesError } = await supabase
    .from('spaces')
    .select('id, course_id')
    .in('course_id', courseIds);
  if (spacesError) throw new ApiError(500, spacesError.message);

  const spaceRows = (spaces ?? []) as Array<{ id: string; course_id: string }>;
  const spaceToCourse = new Map<string, string>();
  for (const row of spaceRows) {
    spaceToCourse.set(row.id, row.course_id);
  }

  const noteCountByCourse = new Map<string, number>();
  const lastActiveByCourse = new Map<string, string>();
  const spaceIds = spaceRows.map((s) => s.id);
  if (spaceIds.length > 0) {
    const { data: notes, error: notesError } = await supabase
      .from('notes')
      .select('space_id, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null);
    if (notesError) throw new ApiError(500, notesError.message);

    for (const note of (notes ?? []) as Array<{ space_id: string; created_at: string }>) {
      const courseId = spaceToCourse.get(note.space_id);
      if (!courseId) continue;
      noteCountByCourse.set(courseId, (noteCountByCourse.get(courseId) ?? 0) + 1);
      const prevTs = lastActiveByCourse.get(courseId);
      if (!prevTs || note.created_at > prevTs) {
        lastActiveByCourse.set(courseId, note.created_at);
      }
    }
  }

  const formatted = courseRows.map((course) => {
    return {
      id: course.id,
      title: course.title,
      instructor_id: course.instructor_id,
      instructor_name: instructorNameById.get(course.instructor_id) ?? DEFAULT_INSTRUCTOR_NAME,
      cover_image: course.cover_image ?? null,
      tags: course.tags ?? [],
      verification_code: course.verification_code ?? null,
      created_at: course.created_at,
      student_count: studentCountByCourse.get(course.id) ?? 0,
      note_count: noteCountByCourse.get(course.id) ?? 0,
      last_activity_at: lastActiveByCourse.get(course.id) ?? null,
    };
  });

  res.json({ courses: formatted });
});

export default router;
