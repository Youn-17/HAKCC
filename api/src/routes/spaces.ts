import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { courseMemberRole, ensureCourseMember, ensureSpaceAccess, invalidateMembershipCache } from '../services/accessControl';
import { invalidateConditionCache } from '../services/experimentCondition';
import { logEvent } from '../services/eventService';
import { ApiError } from '../middleware/errorHandler';

const router = Router();

// Helper function to get courses based on user role
async function getUserCourses(userId: string, role: string) {
  const baseSelect = 'id, title, instructor_id, cover_image, tags, verification_code, created_at, course_type, users!instructor_id(name)';

  if (role === 'admin') {
    const { data, error } = await supabase
      .from('courses')
      .select(baseSelect)
      .order('created_at', { ascending: false });
    if (error) throw new ApiError(500, error.message);
    return data ?? [];
  }

  if (role === 'teacher') {
    // Own courses plus any course this teacher was invited to co-teach —
    // course_members is what ensureCourseInstructor honours, so the list must
    // agree or an invited co-teacher can never open the course.
    const { data: memberships } = await supabase
      .from('course_members')
      .select('course_id')
      .eq('user_id', userId);
    const memberCourseIds = (memberships ?? []).map(m => m.course_id).filter(Boolean);

    const { data: courses } = await supabase
      .from('courses')
      .select(baseSelect)
      .or(
        memberCourseIds.length > 0
          ? `instructor_id.eq.${userId},id.in.(${memberCourseIds.join(',')})`
          : `instructor_id.eq.${userId}`,
      )
      .order('created_at', { ascending: false });
    return courses ?? [];
  }

  // Students: courses they are members of
  const { data: memberships } = await supabase
    .from('course_members')
    .select('course_id')
    .eq('user_id', userId);
  const courseIds = (memberships ?? []).map(m => m.course_id);

  if (courseIds.length === 0) return [];

  const { data, error } = await supabase
    .from('courses')
    .select(baseSelect)
    .in('id', courseIds)
    .order('created_at', { ascending: false });

  if (error) throw new ApiError(500, error.message);
  return data ?? [];
}

// GET /api/courses - list courses for current user
router.get('/courses', verifyJWT, async (req: Request, res: Response) => {
  const courses = await getUserCourses(req.user!.id, req.user!.role);
  res.json({ courses });
});

// GET /api/courses/available - list all courses that students can join
router.get('/courses/available', verifyJWT, async (req: Request, res: Response) => {
  // Get all courses
  // Deliberately omits verification_code: handing every authenticated user the
  // join code for every course let anyone enrol themselves into any course.
  const { data: allCourses, error } = await supabase
    .from('courses')
    .select('id, title, instructor_id, cover_image, tags, created_at, users!instructor_id(name)')
    .order('created_at', { ascending: false });

  if (error) throw new ApiError(500, error.message);

  // Get courses the user is already a member of
  const { data: memberships } = await supabase
    .from('course_members')
    .select('course_id')
    .eq('user_id', req.user!.id);
  const enrolledIds = new Set((memberships ?? []).map(r => r.course_id));

  // Filter out already enrolled courses
  const availableCourses = (allCourses ?? []).filter(c => !enrolledIds.has(c.id));

  res.json({ courses: availableCourses });
});

/**
 * GET /api/courses/:id — 单门课程。
 *
 * 课程设置页此前是从 /courses 列表里 find 出这门课的，可那个列表对不同角色
 * 返回的范围不一样（管理员从后台点进别人的课就找不到），课程名会是空白。
 * 注册位置必须在 /courses/available 之后，否则 available 会被当成 id。
 */
router.get('/courses/:id', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.id);
  await ensureCourseMember(courseId, req.user!);

  const { data, error } = await supabase
    .from('courses')
    .select('id, title, instructor_id, cover_image, tags, verification_code, created_at, course_type, credit_hours, total_weeks, start_date, timezone, users!instructor_id(name)')
    .eq('id', courseId)
    .maybeSingle();

  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Course not found');
  res.json({ course: data });
});

// POST /api/courses - create course (teacher/admin)
router.post('/courses', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { title, cover_image, tags, verification_code } = req.body;
  if (!title) throw new ApiError(400, 'title is required');

  const { data, error } = await supabase
    .from('courses')
    .insert({
      title,
      instructor_id: req.user!.id,
      cover_image,
      tags: tags ?? [],
      verification_code,
    })
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);

  // Auto-enroll the teacher as a member
  await supabase.from('course_members').insert({
    course_id: data.id,
    user_id: req.user!.id,
    role: 'teacher',
  });

  res.status(201).json({ course: data });
});

/**
 * PATCH /api/courses/:id —— 修改课程名称。
 *
 * 权限刻意比 ensureCourseInstructor 更严：**只有创建这门课的教师**（或平台管理员）
 * 能改名。ensureCourseInstructor 还会放行 course_members.role = 'teacher' 的协作教师，
 * 而课程名是这门课对外的身份标识，学生列表、研究导出、跨学期对比都靠它辨认，
 * 不该由被邀请进来的协作教师单方面改掉。
 */
router.patch('/courses/:id', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.id);

  const { data: course, error: loadError } = await supabase
    .from('courses')
    .select('id, instructor_id')
    .eq('id', courseId)
    .maybeSingle();
  if (loadError) throw new ApiError(500, loadError.message);
  if (!course) throw new ApiError(404, 'Course not found');

  if (req.user!.role !== 'admin' && course.instructor_id !== req.user!.id) {
    throw new ApiError(403, '只有创建这门课程的教师可以修改课程名称');
  }

  const { title } = req.body as { title?: unknown };
  if (typeof title !== 'string') throw new ApiError(400, 'title is required');
  const trimmed = title.trim();
  if (!trimmed) throw new ApiError(400, '课程名称不能为空');
  if (trimmed.length > 120) throw new ApiError(400, '课程名称不能超过 120 个字符');

  const { data, error } = await supabase
    .from('courses')
    .update({ title: trimmed, updated_at: new Date().toISOString() })
    .eq('id', courseId)
    .select()
    .single();
  if (error) throw new ApiError(500, error.message);

  // 改名要留痕：研究数据按课程聚合，事后需要能解释某个名字是什么时候变的。
  logEvent({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'course_renamed',
    object_type: 'course',
    object_id: courseId,
    space_id: '',
    metadata_json: { title: trimmed },
  });

  res.json({ course: data });
});

// POST /api/courses/:id/join - student joins course with optional verification code
router.post('/courses/:id/join', verifyJWT, async (req: Request, res: Response) => {
  const courseId = req.params.id;
  const { verification_code } = req.body;

  // Check if the course exists
  const { data: course, error } = await supabase
    .from('courses')
    .select('id, verification_code')
    .eq('id', courseId)
    .single();

  if (error || !course) throw new ApiError(404, 'Course not found');

  // A course without a code is not open enrolment — it simply does not accept
  // self-service joins, and the teacher adds members from course settings.
  if (!course.verification_code || course.verification_code !== verification_code) {
    throw new ApiError(403, 'Invalid verification code');
  }

  // Enroll the student
  const { error: enrollError } = await supabase
    .from('course_members')
    .insert({ course_id: courseId, user_id: req.user!.id, role: 'student' });

  // Ignore duplicate key errors (already enrolled)
  if (enrollError && !enrollError.message.includes('duplicate')) {
    throw new ApiError(500, enrollError.message);
  }

  res.json({ message: 'Joined course successfully' });
});

// DELETE /api/courses/:id/leave - a member removes themselves from a course
router.delete('/courses/:id/leave', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.id);
  const userId = req.user!.id;

  const { data: course, error } = await supabase
    .from('courses')
    .select('id, instructor_id')
    .eq('id', courseId)
    .single();
  if (error || !course) throw new ApiError(404, 'Course not found');

  // The owner leaving would strand the course with no one able to manage it.
  if (course.instructor_id === userId) {
    throw new ApiError(400, '课程负责人不能退出自己的课程');
  }

  const { data: membership } = await supabase
    .from('course_members')
    .select('user_id')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) throw new ApiError(404, '你不在这门课程中');

  // Group membership is course-scoped, so it goes with the enrolment.
  // Notes and discussion stay: they belong to the community's knowledge base,
  // not to the enrolment record.
  const { data: courseGroups } = await supabase
    .from('groups')
    .select('id')
    .eq('course_id', courseId);
  const groupIds = (courseGroups ?? []).map((g) => g.id as string);
  if (groupIds.length > 0) {
    await supabase
      .from('group_members')
      .delete()
      .eq('user_id', userId)
      .in('group_id', groupIds);
  }

  const { error: leaveError } = await supabase
    .from('course_members')
    .delete()
    .eq('course_id', courseId)
    .eq('user_id', userId);
  if (leaveError) throw new ApiError(500, leaveError.message);
  invalidateMembershipCache();

  invalidateConditionCache();

  logEvent({
    actor_id: userId,
    actor_role: req.user!.role,
    event_type: 'course_left',
    object_type: 'course',
    object_id: courseId,
    space_id: '',
    metadata_json: {},
  });

  res.json({ message: 'Left course successfully' });
});

// GET /api/courses/:id/spaces - list spaces in a course
router.get('/courses/:id/spaces', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.id);

  // Verify user is a member of this course, or its instructor
  const [memberRole, { data: courseCheck }] = await Promise.all([
    courseMemberRole(courseId, req.user!.id),
    supabase.from('courses').select('instructor_id').eq('id', courseId).maybeSingle(),
  ]);
  const isInstructor = courseCheck?.instructor_id === req.user!.id;
  if (!memberRole && !isInstructor) {
    throw new ApiError(403, 'You are not a member of this course');
  }

  const { data, error } = await supabase
    .from('spaces')
    .select('*')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });

  if (error) throw new ApiError(500, error.message);

  // Group-bound spaces are listed only to their own group. Seeing every group
  // goes by course-level standing — admin, instructor or course manager — the
  // same rule as ensureSpaceAccess: a teacher account that joined with the
  // student code is an ordinary member here, and a manager row only counts on
  // a teacher account (managers are only ever granted to teachers).
  let spaces = data ?? [];
  const seesEveryGroup = req.user!.role === 'admin' || isInstructor
    || (memberRole === 'manager' && req.user!.role === 'teacher');
  if (!seesEveryGroup && spaces.some(s => s.group_id)) {
    const { data: myGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', req.user!.id);
    const myGroupIds = new Set((myGroups ?? []).map(g => g.group_id));
    spaces = spaces.filter(s => !s.group_id || myGroupIds.has(s.group_id));
  }

  res.json({ spaces });
});

// POST /api/courses/:id/spaces - create a new space in the course
router.post('/courses/:id/spaces', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = req.params.id;
  const { title, description, inquiry_question, group_id } = req.body;

  if (!title) throw new ApiError(400, 'title is required');
  if (inquiry_question !== undefined && typeof inquiry_question !== 'string') {
    throw new ApiError(400, 'inquiry_question must be a string');
  }

  // Verify user is the instructor or admin
  const { data: course } = await supabase
    .from('courses')
    .select('instructor_id')
    .eq('id', courseId)
    .single();

  if (!course) throw new ApiError(404, 'Course not found');
  if (course.instructor_id !== req.user!.id && req.user!.role !== 'admin') {
    throw new ApiError(403, 'Only the course instructor or admin can create spaces');
  }

  if (group_id) {
    const { data: group } = await supabase
      .from('groups')
      .select('id, course_id')
      .eq('id', group_id)
      .single();
    if (!group || group.course_id !== courseId) {
      throw new ApiError(400, 'group_id must reference a group in this course');
    }
  }

  const { data, error } = await supabase
    .from('spaces')
    .insert({
      title,
      description,
      inquiry_question: inquiry_question?.trim() || null,
      course_id: courseId,
      created_by: req.user!.id,
      group_id: group_id ?? null,
    })
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);

  res.status(201).json({ space: data });
});

// POST /api/courses/:id/group-spaces - one private space per group that lacks one
router.post('/courses/:id/group-spaces', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = req.params.id;
  const { inquiry_question } = req.body as { inquiry_question?: string };

  const { data: course } = await supabase
    .from('courses')
    .select('instructor_id')
    .eq('id', courseId)
    .single();
  if (!course) throw new ApiError(404, 'Course not found');
  if (course.instructor_id !== req.user!.id && req.user!.role !== 'admin') {
    throw new ApiError(403, 'Only the course instructor or admin can create spaces');
  }

  const [{ data: groups }, { data: existingSpaces }] = await Promise.all([
    supabase.from('groups').select('id, name').eq('course_id', courseId),
    supabase.from('spaces').select('group_id').eq('course_id', courseId).not('group_id', 'is', null),
  ]);

  const covered = new Set((existingSpaces ?? []).map(s => s.group_id));
  const pending = (groups ?? []).filter(g => !covered.has(g.id));
  if (pending.length === 0) {
    return res.json({ created: [], message: 'Every group already has a space' });
  }

  const { data: created, error } = await supabase
    .from('spaces')
    .insert(pending.map(g => ({
      title: g.name,
      description: null,
      inquiry_question: inquiry_question?.trim() || null,
      course_id: courseId,
      created_by: req.user!.id,
      group_id: g.id,
    })))
    .select();

  if (error) throw new ApiError(500, error.message);
  res.status(201).json({ created: created ?? [] });
});

// GET /api/spaces/:id - get space details
router.get('/spaces/:id', verifyJWT, async (req: Request, res: Response) => {
  await ensureSpaceAccess(String(req.params.id), req.user!);
  const { data, error } = await supabase
    .from('spaces')
    .select('*, courses(*), users!created_by(name)')
    .eq('id', req.params.id)
    .single();

  if (error || !data) throw new ApiError(404, 'Space not found');
  res.json({ space: data });
});

export default router;
