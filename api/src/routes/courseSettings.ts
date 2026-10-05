import { getCourseMemberCounts } from '../services/courseMemberCounts';
import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureCourseInstructor, ensureCourseMember, ensureCourseOwner, getCourseStanding, invalidateMembershipCache, isCourseStaff, type CourseStanding } from '../services/accessControl';
import { invalidateConditionCache } from '../services/experimentCondition';
import { validateDeclaredUpload, verifyStoredBytes } from '../services/attachmentValidation';
import { canExtractText } from '../services/documentText';
import { materialKbState, scheduleMaterialKbIngest } from '../services/kbIngest';
import { isUuid } from '../services/eventPayload';

const router = Router();

// ============================================================
// Course Members API
// ============================================================

// GET /api/courses/:courseId/members — list all members of a course
router.get('/courses/:courseId/members', verifyJWT, async (req: Request, res: Response) => {
  const { courseId } = req.params;
  await ensureCourseMember(String(courseId), req.user!);
  // 邮箱和实验分组只给课程教职。学生打开小组管理只要名字和头像；个人的实验分组是盲法要藏的，
  // 同小组列表和迁移 063 收回的那一列。
  const viewerStanding = await getCourseStanding(String(courseId), req.user!);
  const viewerIsStaff = isCourseStaff(viewerStanding);

  const { data, error } = await supabase
    .from('course_members')
    .select('course_id, user_id, joined_at, ai_feedback_condition, role')
    .eq('course_id', courseId)
    .order('joined_at', { ascending: true });

  if (error) throw new ApiError(500, error.message);

  const userIds = (data ?? []).map((m: any) => m.user_id).filter(Boolean);
  const { data: profiles, error: profileError } = userIds.length > 0
    ? await supabase
        .from('profiles')
        .select('id, full_name, email, role, avatar_url')
        .in('id', userIds)
    : { data: [], error: null };

  if (profileError) throw new ApiError(500, profileError.message);
  const profileMap = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));

  // role 是平台身份（教师/学生），courseRole 是课内身份（创建者/管理员/成员）。
  // 两者必须分开：一个平台教师在别人的课里可能只是普通成员。
  const { data: course } = await supabase
    .from('courses').select('instructor_id').eq('id', courseId).maybeSingle();
  const ownerId = course?.instructor_id ?? null;

  const members = (data ?? []).map((m: any) => ({
    userId: m.user_id,
    joinedAt: m.joined_at,
    name: profileMap.get(m.user_id)?.full_name ?? '',
    email: viewerIsStaff ? profileMap.get(m.user_id)?.email : undefined,
    role: profileMap.get(m.user_id)?.role ?? 'student',
    courseRole: m.user_id === ownerId
      ? 'owner'
      : (m.role === 'teacher' || m.role === 'admin' ? 'manager' : 'member'),
    avatar: profileMap.get(m.user_id)?.avatar_url,
    aiFeedbackCondition: viewerIsStaff ? (m.ai_feedback_condition ?? null) : null,
  }));

  // 创建者未必在 course_members 里（早期建的课就没有这一行），单独补一条，
  // 否则权限页会显示成「这门课没有创建者」。
  if (ownerId && !members.some(m => m.userId === ownerId)) {
    const { data: ownerProfile } = await supabase
      .from('profiles').select('id, full_name, email, avatar_url, role').eq('id', ownerId).maybeSingle();
    members.unshift({
      userId: ownerId,
      joinedAt: null,
      name: ownerProfile?.full_name ?? '',
      email: viewerIsStaff ? ownerProfile?.email : undefined,
      role: ownerProfile?.role ?? 'teacher',
      courseRole: 'owner',
      avatar: ownerProfile?.avatar_url,
      aiFeedbackCondition: null,
    });
  }

  res.json({ members, total: members.length, viewerStanding });
});

// PUT /api/courses/:courseId/members/:userId/feedback-condition — individual
// experiment-condition override (beats the group's condition; null clears it)
router.put(
  '/courses/:courseId/members/:userId/feedback-condition',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { courseId, userId } = req.params;
    await ensureCourseInstructor(String(courseId), req.user!);

    const { condition } = req.body as { condition?: 'treatment' | 'control' | null };
    if (condition !== null && condition !== 'treatment' && condition !== 'control') {
      throw new ApiError(400, 'condition must be treatment, control or null');
    }

    const { data, error } = await supabase
      .from('course_members')
      .update({ ai_feedback_condition: condition })
      .eq('course_id', courseId)
      .eq('user_id', userId)
      .select('user_id, ai_feedback_condition')
      .maybeSingle();

    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'Member not found in this course');

    invalidateConditionCache();
    res.json({ userId: data.user_id, condition: data.ai_feedback_condition ?? null });
  },
);

/**
 * PATCH /api/courses/:courseId/members/:userId/role — 指定或撤销课程管理员。
 *
 * 只有创建者能调。管理员能改课程设置、排课、写教学日志，也会收到课次补记提醒，
 * 但授予权本身不下放 —— 否则被指定的人可以再指定别人，创建者无从收回。
 */
router.patch('/courses/:courseId/members/:userId/role', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { courseId, userId } = req.params;
  await ensureCourseOwner(String(courseId), req.user!);

  const { role } = req.body as { role?: string };
  if (role !== 'manager' && role !== 'member') {
    throw new ApiError(400, 'role must be manager or member');
  }

  const { data: course } = await supabase
    .from('courses').select('instructor_id').eq('id', courseId).maybeSingle();
  if (course?.instructor_id === userId) {
    throw new ApiError(400, '课程创建者的身份不可更改');
  }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', userId).maybeSingle();
  if (!profile) throw new ApiError(404, 'User not found');
  // 学生不能被提为管理员：课程设置和排课不是学生该碰的东西
  if (role === 'manager' && profile.role !== 'teacher') {
    throw new ApiError(400, '只能把课程内的教师设为课程管理员');
  }

  const { data, error } = await supabase
    .from('course_members')
    .update({ role: role === 'manager' ? 'teacher' : 'student' })
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .select('user_id, role')
    .maybeSingle();

  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Member not found in this course');
  // 成员缓存里存着课内身份，绑组空间靠它决定能不能跨组：撤销的管理员不能再多进 30 秒别组空间
  invalidateMembershipCache();

  res.json({ userId: data.user_id, courseRole: data.role === 'teacher' ? 'manager' : 'member' });
});

// DELETE /api/courses/:courseId/members/:userId — remove a member (teacher/admin only)
router.delete('/courses/:courseId/members/:userId', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { courseId, userId } = req.params;
  const standing = await getCourseStanding(String(courseId), req.user!);
  if (standing !== 'owner' && standing !== 'manager') {
    throw new ApiError(403, 'Only the course instructor can perform this action');
  }

  // Prevent removing the course instructor
  const { data: course } = await supabase
    .from('courses')
    .select('instructor_id')
    .eq('id', courseId)
    .single();

  if (course && course.instructor_id === userId) {
    throw new ApiError(400, 'Cannot remove the course instructor');
  }

  // 课程管理员只能移除学生。让管理员互相踢，等于把创建者的授权决定
  // 交给了被授权的人 —— 两个管理员可以互相移除，最后谁在场取决于谁先动手。
  if (standing === 'manager') {
    const { data: target } = await supabase
      .from('profiles').select('role').eq('id', userId).maybeSingle();
    if (target?.role !== 'student') {
      throw new ApiError(403, '课程管理员只能移除学生，移除教师需要课程创建者操作');
    }
  }

  const { error } = await supabase
    .from('course_members')
    .delete()
    .eq('course_id', courseId)
    .eq('user_id', userId);

  if (error) throw new ApiError(500, error.message);
  invalidateMembershipCache();

  res.json({ message: 'Member removed' });
});

// GET /api/courses/:courseId/search-teachers — search teachers by email/name (for invite)
router.get('/courses/:courseId/search-teachers', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  await ensureCourseInstructor(String(req.params.courseId), req.user!);
  const { courseId } = req.params;
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.json({ teachers: [] });
  }
  // PostgREST parses .or() as an expression, so unescaped punctuation lets the
  // caller append their own disjuncts (e.g. "zz%,id.not.is.null") and dump the
  // whole profiles table. Strip every syntax character before interpolating.
  const safeQ = q.replace(/[%_(),.*\\]/g, '');
  if (!safeQ) {
    return res.json({ teachers: [] });
  }

  const { data: existingMembers } = await supabase
    .from('course_members')
    .select('user_id')
    .eq('course_id', courseId);
  const existingIds = (existingMembers ?? []).map((m: any) => m.user_id);

  const { data: course } = await supabase
    .from('courses')
    .select('instructor_id')
    .eq('id', courseId)
    .single();
  if (course?.instructor_id) existingIds.push(course.instructor_id);

  const { data: teachers, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url')
    .eq('role', 'teacher')
    .or(`email.ilike.%${safeQ}%,full_name.ilike.%${safeQ}%`)
    .limit(10);

  if (error) throw new ApiError(500, error.message);

  const filtered = (teachers ?? []).filter((t: any) => !existingIds.includes(t.id));
  res.json({ teachers: filtered });
});

// POST /api/courses/:courseId/invite — invite a teacher to the course
router.post('/courses/:courseId/invite', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  // 只有创建者能拉人进来：放开给课程管理员的话，权限会一层层扩散出去
  await ensureCourseOwner(String(req.params.courseId), req.user!);
  const { courseId } = req.params;
  const { userId } = req.body;

  if (!userId) throw new ApiError(400, 'userId is required');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .single();

  if (!profile) throw new ApiError(404, 'Teacher not found');
  if (profile.role !== 'teacher') throw new ApiError(400, 'User is not a teacher');

  const { data: existing } = await supabase
    .from('course_members')
    .select('user_id')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) throw new ApiError(409, 'Teacher is already a member of this course');

  // 'member' = 课内普通成员。写 'teacher' 的话按课内身份的判定就直接是课程管理员了，
  // 一进来就能改课程设置 —— 授予管理权得是创建者单独的一次决定。
  const { error } = await supabase
    .from('course_members')
    .insert({ course_id: courseId, user_id: userId, role: 'member' });

  if (error) throw new ApiError(500, error.message);
  res.json({ message: 'Teacher invited successfully' });
});

// GET /api/courses/:courseId/stats — compute real course statistics
router.get('/courses/:courseId/stats', verifyJWT, async (req: Request, res: Response) => {
  const { courseId } = req.params;
  await ensureCourseMember(String(courseId), req.user!);

  const [
    memberCounts,
    { count: spaceCount },
    noteCountResult,
  ] = await Promise.all([
    supabase.from('courses').select('id, instructor_id').eq('id', courseId).single()
      .then(({ data, error }) => {
        if (error || !data) throw new ApiError(500, 'Could not read course membership');
        return getCourseMemberCounts([data]);
      }),
    supabase
      .from('spaces')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', courseId),
    // Count notes across all spaces in the course
    supabase
      .from('spaces')
      .select('id')
      .eq('course_id', courseId)
      .then(async ({ data: spaces }) => {
        if (!spaces || spaces.length === 0) return { count: 0 };
        const spaceIds = spaces.map(s => s.id);
        const { count } = await supabase
          .from('notes')
          .select('id', { count: 'exact', head: true })
          .in('space_id', spaceIds)
          .is('deleted_at', null);
        return { count: count ?? 0 };
      }),
  ]);

  res.json({
    studentCount: memberCounts.get(String(courseId))?.studentCount ?? 0,
    teacherCount: memberCounts.get(String(courseId))?.teacherCount ?? 1,
    spaceCount: spaceCount ?? 0,
    noteCount: noteCountResult.count ?? 0,
  });
});

// ============================================================
// 学习目标、学习任务、提交：共用的校验和输出形状
// ============================================================
//
// 三张表在迁移 068 建（005 在新库上没跑成，这些接口原先一直 500）。读写都走这里，客户端直连没有权限。
// 输入一律在这里校验成中文的 400：原先标题超长、分值填错、截止时间格式不对都是数据库报错，
// 前端只拿到一句英文的 500。

const TITLE_MAX = 200;
const GOAL_DESCRIPTION_MAX = 2000;
const TASK_DESCRIPTION_MAX = 5000;
const TASK_POINTS_MAX = 1000;
const SUBMISSION_CONTENT_MAX = 20000;
const FEEDBACK_MAX = 5000;
const URL_MAX = 2000;

/** 不是合法 UUID 的 id 在库里报 22P02（invalid input syntax），对调用方来说就是「不存在」。 */
function isInvalidId(error: { code?: string } | null | undefined): boolean {
  return error?.code === '22P02';
}

function requiredTitle(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, `请填写${label}`);
  const title = value.trim();
  if (title.length > TITLE_MAX) throw new ApiError(400, `${label}最多 ${TITLE_MAX} 字`);
  return title;
}

/** 选填的说明文字：去掉首尾空白，空的存成 null。 */
function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ApiError(400, `${label}格式不对`);
  const text = value.trim();
  if (text.length > max) throw new ApiError(400, `${label}最多 ${max} 字`);
  return text || null;
}

/** 学生写的正文原样存（缩进、换行都留着），只是全空白的当作没填。 */
function optionalBody(value: unknown, label: string, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ApiError(400, `${label}格式不对`);
  if (value.length > max) throw new ApiError(400, `${label}最多 ${max} 字`);
  return value.trim() ? value : null;
}

function goalPriority(value: unknown): number {
  if (value === 0 || value === 1 || value === 2) return value;
  throw new ApiError(400, '优先级只能是 0（低）、1（中）或 2（高）');
}

function taskPoints(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= TASK_POINTS_MAX) return value;
  throw new ApiError(400, `分值要填 0 到 ${TASK_POINTS_MAX} 之间的整数`);
}

// 截止时间必须带时区。datetime-local 输入框给的「2026-10-01T23:59」没有时区，数据库按 UTC 存，
// 东八区的教师再看到时就晚了 8 小时。前端换算成带时区的 ISO 再发。
const ZONED_ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/i;

function taskDueDate(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !ZONED_ISO_TIME.test(value.trim())) {
    throw new ApiError(400, '截止时间格式不对，需要带时区的时间');
  }
  const date = new Date(value.trim());
  const year = date.getUTCFullYear();
  if (Number.isNaN(date.getTime()) || year < 2000 || year > 2100) {
    throw new ApiError(400, '截止时间不在合理范围内，请检查年份');
  }
  return date.toISOString();
}

type TaskStatus = 'draft' | 'published' | 'closed';
const TASK_STATUS_LABEL: Record<TaskStatus, string> = { draft: '草稿', published: '已发布', closed: '已关闭' };

function taskStatus(value: unknown): TaskStatus {
  if (value === 'draft' || value === 'published' || value === 'closed') return value;
  throw new ApiError(400, '任务状态只能是 draft、published 或 closed');
}

/** 关联的 users!xxx(id, name, avatar)。人删了是 null。 */
function personOf(row: any): { id: string; name: string; avatar?: string } | null {
  const user = Array.isArray(row?.users) ? row.users[0] : row?.users;
  if (!user) return null;
  return { id: user.id, name: user.name ?? '', avatar: user.avatar ?? undefined };
}

// ============================================================
// Course Goals API
// ============================================================
//
// 读：课程成员（学生端目前没有界面；备课助手生成教案时读排在前面的 5 条）。
// 增删改：课程教职（ensureCourseInstructor：平台管理员、创建者、课程管理员），一律按 :courseId 限定。
// 列表带回调用者的课内身份，前端据此决定显不显示增删改的按钮。

const GOAL_SELECT = 'id, course_id, title, description, priority, created_at, updated_at, users!created_by(id, name, avatar)';

function goalToApi(row: any) {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    description: row.description ?? null,
    priority: row.priority ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    createdBy: personOf(row),
  };
}

// GET /api/courses/:courseId/goals — 高优先级在前，同一档按添加先后。
// 原先只按 priority 排：同一档里的顺序由数据库随手给，每次刷新都可能换位置。
router.get('/courses/:courseId/goals', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const standing = await ensureCourseMember(courseId, req.user!);

  const { data, error } = await supabase
    .from('course_goals')
    .select(GOAL_SELECT)
    .eq('course_id', courseId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw new ApiError(500, error.message);

  res.json({ goals: (data ?? []).map(goalToApi), viewerStanding: standing });
});

// POST /api/courses/:courseId/goals — 课程教职新建目标
router.post('/courses/:courseId/goals', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const row = {
    course_id: courseId,
    title: requiredTitle(body.title, '目标标题'),
    description: body.description === undefined ? null : optionalText(body.description, '目标描述', GOAL_DESCRIPTION_MAX),
    priority: body.priority === undefined ? 0 : goalPriority(body.priority),
    created_by: req.user!.id,
  };

  const { data, error } = await supabase
    .from('course_goals')
    .insert(row)
    .select(GOAL_SELECT)
    .single();

  if (error || !data) throw new ApiError(500, error?.message ?? '目标没有保存成功');

  res.status(201).json({ goal: goalToApi(data) });
});

// PUT /api/courses/:courseId/goals/:goalId — 改标题、描述、优先级，只改传了的字段
router.put('/courses/:courseId/goals/:goalId', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = requiredTitle(body.title, '目标标题');
  if (body.description !== undefined) updates.description = optionalText(body.description, '目标描述', GOAL_DESCRIPTION_MAX);
  if (body.priority !== undefined) updates.priority = goalPriority(body.priority);
  if (Object.keys(updates).length === 0) throw new ApiError(400, '没有要修改的内容');

  // 带上 course_id：只凭 goalId 改，别的课的教职拿到 id 就能改这门课的目标
  const { data, error } = await supabase
    .from('course_goals')
    .update(updates)
    .eq('id', String(req.params.goalId))
    .eq('course_id', courseId)
    .select(GOAL_SELECT)
    .maybeSingle();

  // 原先任何数据库错误都报成 404「Goal not found」，标题超长也是
  if (error && !isInvalidId(error)) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, '目标不存在，可能已被删除');

  res.json({ goal: goalToApi(data) });
});

// DELETE /api/courses/:courseId/goals/:goalId
router.delete('/courses/:courseId/goals/:goalId', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);

  // 原先删不到也回「已删除」：别的课的目标 id、早就删掉的目标，界面上都显示删成功了
  const { data, error } = await supabase
    .from('course_goals')
    .delete()
    .eq('id', String(req.params.goalId))
    .eq('course_id', courseId)
    .select('id')
    .maybeSingle();
  if (error && !isInvalidId(error)) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, '目标不存在，可能已被删除');

  res.json({ message: 'Goal deleted' });
});

// ============================================================
// Course Materials API
// ============================================================
//
// 资料的去处：文件进存储桶，能读出正文的（PDF、Word、文本）解析后进这门课的
// AI 知识库，和知识空间里上传的附件走同一条解析与入库链路。
// 学生端没有资料列表 —— 学生是通过 AI 用到它们的。以前这里存的是浏览器的
// blob: 地址，只在上传者那个标签页里有效，也从没进过知识库。

const MATERIALS_BUCKET = 'note-chat-attachments';
const MATERIAL_MAX_BYTES = 50 * 1024 * 1024;
const materialPrefix = (courseId: string) => `materials/${courseId}/`;

// GET /api/courses/:courseId/materials — list all materials for a course
router.get('/courses/:courseId/materials', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseMember(courseId, req.user!);

  const { data, error } = await supabase
    .from('course_materials')
    .select(`
      id, course_id, title, description, file_url, file_name, file_size, mime_type, created_at,
      text_updated_at, mineru_state,
      users!uploaded_by(id, name, avatar),
      kb_documents!material_id(id, status, char_count)
    `)
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });

  if (error) throw new ApiError(500, error.message);
  const rows = (data ?? []) as any[];

  const docOf = (m: any) => (Array.isArray(m.kb_documents) ? m.kb_documents[0] : m.kb_documents) ?? null;
  const docIds = rows.map(docOf).filter(Boolean).map((d: any) => d.id as string);

  // 有没有拿到向量只看 embedding_model：它和 embedding 同时写入，不必把向量本身拉回来
  const chunkCounts = new Map<string, { chunks: number; embedded: number }>();
  if (docIds.length > 0) {
    const { data: chunks } = await supabase
      .from('kb_chunks')
      .select('document_id, embedding_model')
      .in('document_id', docIds)
      .limit(50000);
    for (const c of (chunks ?? []) as Array<{ document_id: string; embedding_model: string | null }>) {
      const entry = chunkCounts.get(c.document_id) ?? { chunks: 0, embedded: 0 };
      entry.chunks += 1;
      if (c.embedding_model) entry.embedded += 1;
      chunkCounts.set(c.document_id, entry);
    }
  }

  const materials = rows.map((m) => {
    const doc = docOf(m);
    const counts = doc ? chunkCounts.get(doc.id) ?? { chunks: 0, embedded: 0 } : null;
    const kb = materialKbState(m, doc ? { status: doc.status, ...counts! } : null);
    return {
      id: m.id,
      courseId: m.course_id,
      title: m.title,
      description: m.description,
      fileUrl: m.file_url,
      fileName: m.file_name,
      fileSize: m.file_size,
      mimeType: m.mime_type,
      uploadedBy: {
        id: m.users?.id,
        name: m.users?.name,
        avatar: m.users?.avatar,
      },
      knowledgeBase: {
        state: kb.state,
        refining: kb.refining,
        chars: doc?.char_count ?? 0,
        chunks: counts?.chunks ?? 0,
      },
      createdAt: m.created_at,
    };
  });

  res.json({ materials });
});

// POST /api/courses/:courseId/materials/sign — 签发直传地址。文件不经过 API 服务器。
router.post('/courses/:courseId/materials/sign', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  if (!isUuid(courseId)) throw new ApiError(400, 'courseId must be a valid UUID');
  await ensureCourseInstructor(courseId, req.user!);

  const { file_name, mime_type = 'application/octet-stream', file_size } = req.body as {
    file_name?: string; mime_type?: string; file_size?: number;
  };
  if (!file_name) throw new ApiError(400, 'file_name is required');
  if (typeof file_size === 'number' && file_size > MATERIAL_MAX_BYTES) {
    throw new ApiError(413, `文件超过 ${MATERIAL_MAX_BYTES / 1024 / 1024}MB 上限`);
  }

  const { safeName } = validateDeclaredUpload(file_name, mime_type);
  const path = `${materialPrefix(courseId)}${Date.now()}-${safeName}`;

  const { data, error } = await supabase.storage.from(MATERIALS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new ApiError(500, `签发上传地址失败：${error?.message ?? 'unknown'}`);

  res.json({ path: data.path, token: data.token, bucket: MATERIALS_BUCKET });
});

// POST /api/courses/:courseId/materials — 文件直传落盘之后登记（teacher/admin only）
//
// 和知识空间附件的 commit 一样：字节绕过了服务器，所以回读开头几百字节做魔数校验，
// 不合格就删掉。登记成功后在后台解析并入库。
router.post('/courses/:courseId/materials', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);

  const { title, description, path, file_name, mime_type = 'application/octet-stream' } = req.body as {
    title?: string; description?: string; path?: string; file_name?: string; mime_type?: string;
  };
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 200) : '';
  if (!cleanTitle || !path || !file_name) {
    throw new ApiError(400, 'title、path 和 file_name 是必填的');
  }
  // 路径必须落在这门课自己的资料目录下，否则可以拿别处的对象来「认领」
  if (!path.startsWith(materialPrefix(courseId)) || path.includes('..')) {
    throw new ApiError(400, '路径不属于这门课的资料目录。');
  }
  validateDeclaredUpload(file_name, mime_type);

  const drop = async () => {
    await supabase.storage.from(MATERIALS_BUCKET).remove([path]).catch(() => {});
  };

  const { data: publicData } = supabase.storage.from(MATERIALS_BUCKET).getPublicUrl(path);
  const head = await fetch(publicData.publicUrl, { headers: { Range: 'bytes=0-511' } });
  if (!head.ok && head.status !== 206) {
    await drop();
    throw new ApiError(400, '没有找到刚上传的文件。');
  }
  const headBuf = Buffer.from(await head.arrayBuffer());
  if (headBuf.length === 0) { await drop(); throw new ApiError(400, 'File is empty'); }

  const totalSize = Number(head.headers.get('content-range')?.split('/')[1])
    || Number(head.headers.get('content-length'))
    || headBuf.length;
  if (totalSize > MATERIAL_MAX_BYTES) {
    await drop();
    throw new ApiError(413, `文件超过 ${MATERIAL_MAX_BYTES / 1024 / 1024}MB 上限`);
  }

  try {
    verifyStoredBytes(headBuf, mime_type);
  } catch (e) {
    await drop();
    throw e;
  }

  const { data, error } = await supabase
    .from('course_materials')
    .insert({
      course_id: courseId,
      title: cleanTitle,
      description: typeof description === 'string' && description.trim() ? description.trim() : null,
      file_url: publicData.publicUrl,
      storage_path: path,
      file_name: String(file_name).slice(0, 255),
      file_size: totalSize,
      mime_type: String(mime_type).slice(0, 100),
      uploaded_by: req.user!.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    await drop();
    throw new ApiError(500, error?.message ?? '资料登记失败');
  }

  if (canExtractText(mime_type, String(file_name))) scheduleMaterialKbIngest(String(data.id));

  res.status(201).json({ material: { id: data.id } });
});

// DELETE /api/courses/:courseId/materials/:materialId — 删资料，连同存储里的文件；
// 知识库里的那份随外键级联删除
router.delete('/courses/:courseId/materials/:materialId', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const { materialId } = req.params;

  // 带上 course_id：只凭 materialId 删，别的课的教师拿到 id 就能删这门课的资料
  const { data, error } = await supabase
    .from('course_materials')
    .delete()
    .eq('id', materialId)
    .eq('course_id', courseId)
    .select('id, storage_path')
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Material not found');

  if (data.storage_path) {
    await supabase.storage.from(MATERIALS_BUCKET).remove([String(data.storage_path)]).catch(() => {});
  }

  res.json({ message: 'Material deleted' });
});

// ============================================================
// Course Tasks API
// ============================================================
//
// 任务和提交一律经 :courseId 取；教职按课内身份算，和空间里一样。
// 草稿只给课程教职看；课程教职以外的人只看、只交、只改自己的提交。

// 草稿 → 发布 → 关闭；发布后可以撤回成草稿，关闭后可以重新发布
const VALID_TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  draft: ['published'],
  published: ['closed', 'draft'],
  closed: ['published'],
};

const TASK_SELECT = 'id, course_id, title, description, due_date, points, status, created_at, updated_at, '
  + 'users!created_by(id, name, avatar), task_submissions(id, student_id, status)';

function taskToApi(row: any, viewer: { id: string; staff: boolean }) {
  const all: Array<{ student_id: string; status: string }> = Array.isArray(row.task_submissions) ? row.task_submissions : [];
  // 学生只算自己那一份：全班交了几份、批了几份不是学生该看的
  const submissions = viewer.staff ? all : all.filter(s => s.student_id === viewer.id);
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    description: row.description ?? null,
    dueDate: row.due_date ?? null,
    points: row.points ?? 0,
    status: row.status,
    createdBy: personOf(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    submissionStats: {
      total: submissions.length,
      submitted: submissions.filter(s => s.status === 'submitted' || s.status === 'graded').length,
      graded: submissions.filter(s => s.status === 'graded').length,
    },
  };
}

interface CourseTaskRow {
  id: string;
  status: TaskStatus;
  due_date: string | null;
  points: number | null;
}

/**
 * 任务必须属于 :courseId，不属于就按不存在处理 —— 别的课的任务 id 不能从这门课借道。
 * 传了调用者的课内身份时，草稿对课程教职以外的人也按不存在处理（列表里本来就不给他们）。
 */
async function loadCourseTask(courseId: string, taskId: string, standing?: CourseStanding): Promise<CourseTaskRow> {
  const { data, error } = await supabase
    .from('course_tasks')
    .select('id, status, due_date, points')
    .eq('id', taskId)
    .eq('course_id', courseId)
    .maybeSingle();
  if (error && !isInvalidId(error)) throw new ApiError(500, error.message);
  if (!data || (standing && !isCourseStaff(standing) && data.status === 'draft')) {
    throw new ApiError(404, '任务不存在，可能已被删除');
  }
  return data as CourseTaskRow;
}

// GET /api/courses/:courseId/tasks — 新建的在前
router.get('/courses/:courseId/tasks', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const standing = await ensureCourseMember(courseId, req.user!);
  const staff = isCourseStaff(standing);

  let query = supabase
    .from('course_tasks')
    .select(TASK_SELECT)
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });

  if (!staff) {
    query = query.neq('status', 'draft');
  }

  const { data, error } = await query;

  if (error) throw new ApiError(500, error.message);

  const viewer = { id: req.user!.id, staff };
  res.json({ tasks: (data ?? []).map((row: any) => taskToApi(row, viewer)), viewerStanding: standing });
});

// POST /api/courses/:courseId/tasks — 课程教职布置任务，不传 status 就直接发布
router.post('/courses/:courseId/tasks', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const row = {
    course_id: courseId,
    title: requiredTitle(body.title, '任务标题'),
    description: body.description === undefined ? null : optionalText(body.description, '任务描述', TASK_DESCRIPTION_MAX),
    due_date: body.due_date === undefined ? null : taskDueDate(body.due_date),
    points: body.points === undefined ? 0 : taskPoints(body.points),
    status: body.status === undefined ? 'published' : taskStatus(body.status),
    created_by: req.user!.id,
  };

  const { data, error } = await supabase
    .from('course_tasks')
    .insert(row)
    .select(TASK_SELECT)
    .single();

  if (error || !data) throw new ApiError(500, error?.message ?? '任务没有保存成功');

  res.status(201).json({ task: taskToApi(data, { id: req.user!.id, staff: true }) });
});

// PUT /api/courses/:courseId/tasks/:taskId — 只改传了的字段；due_date 传 null 是去掉截止时间
router.put('/courses/:courseId/tasks/:taskId', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const taskId = String(req.params.taskId);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = requiredTitle(body.title, '任务标题');
  if (body.description !== undefined) updates.description = optionalText(body.description, '任务描述', TASK_DESCRIPTION_MAX);
  if (body.due_date !== undefined) updates.due_date = taskDueDate(body.due_date);
  if (body.points !== undefined) updates.points = taskPoints(body.points);
  if (body.status !== undefined) {
    const next = taskStatus(body.status);
    const current = await loadCourseTask(courseId, taskId);
    // 状态没变不算转换。原先编辑表单每次都带上当前状态，于是改个标题也报
    // 「Cannot transition from 'published' to 'published'」，任何编辑都存不上
    if (next !== current.status && !(VALID_TASK_STATUS_TRANSITIONS[current.status] ?? []).includes(next)) {
      throw new ApiError(400, `「${TASK_STATUS_LABEL[current.status]}」的任务不能直接改成「${TASK_STATUS_LABEL[next]}」`);
    }
    updates.status = next;
  }
  if (Object.keys(updates).length === 0) throw new ApiError(400, '没有要修改的内容');

  // 带上 course_id：只凭 taskId 改，别的课的教职拿到 id 就能改这门课的任务
  const { data, error } = await supabase
    .from('course_tasks')
    .update(updates)
    .eq('id', taskId)
    .eq('course_id', courseId)
    .select(TASK_SELECT)
    .maybeSingle();

  // 原先任何数据库错误都报成 404「Task not found」
  if (error && !isInvalidId(error)) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, '任务不存在，可能已被删除');

  res.json({ task: taskToApi(data, { id: req.user!.id, staff: true }) });
});

// DELETE /api/courses/:courseId/tasks/:taskId — 学生的提交随外键一起删掉
router.delete('/courses/:courseId/tasks/:taskId', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);

  const { data, error } = await supabase
    .from('course_tasks')
    .delete()
    .eq('id', String(req.params.taskId))
    .eq('course_id', courseId)
    .select('id')
    .maybeSingle();
  if (error && !isInvalidId(error)) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, '任务不存在，可能已被删除');

  res.json({ message: 'Task deleted' });
});

// ── 提交 ─────────────────────────────────────────────────────────

const SUBMISSION_SELECT = '*, users!student_id(id, name, avatar)';
const SUBMISSION_TYPES = ['text', 'file', 'drawing', 'video', 'mixed'];
/** 学生交上来的内容。课程教职只批改，这几个字段一个都不能替学生改。 */
const SUBMISSION_CONTENT_FIELDS = ['content', 'file_url', 'file_name', 'drawing_data', 'video_url', 'submission_type'];

function submissionToApi(row: any) {
  return {
    id: row.id,
    taskId: row.task_id,
    studentId: row.student_id,
    student: personOf(row),
    content: row.content ?? null,
    fileUrl: row.file_url ?? null,
    fileName: row.file_name ?? null,
    drawingData: row.drawing_data ?? null,
    videoUrl: row.video_url ?? null,
    submissionType: row.submission_type ?? 'text',
    status: row.status,
    submittedAt: row.submitted_at ?? null,
    gradedAt: row.graded_at ?? null,
    feedback: row.feedback ?? null,
    pointsAwarded: row.points_awarded ?? null,
  };
}

/** 链接只收 http(s)：批改页把它渲染成可点的链接，javascript: 之类的地址不能进库。 */
function httpUrl(value: unknown, label: string): string | null {
  if (value === null || value === '') return null;
  if (typeof value === 'string' && value.length <= URL_MAX) {
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // 落到下面统一报错
    }
  }
  throw new ApiError(400, `${label}只能是 http 或 https 开头的链接`);
}

/** 请求里带了的内容字段，逐个校验。 */
function submissionFields(body: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (body.content !== undefined) fields.content = optionalBody(body.content, '提交内容', SUBMISSION_CONTENT_MAX);
  if (body.file_url !== undefined) fields.file_url = httpUrl(body.file_url, '文件地址');
  if (body.file_name !== undefined) fields.file_name = optionalText(body.file_name, '文件名', 255);
  if (body.video_url !== undefined) fields.video_url = httpUrl(body.video_url, '视频链接');
  if (body.drawing_data !== undefined) {
    const drawing = body.drawing_data;
    if (drawing !== null && (typeof drawing !== 'object' || Array.isArray(drawing))) {
      throw new ApiError(400, '绘图数据格式不对');
    }
    fields.drawing_data = drawing;
  }
  if (body.submission_type !== undefined) {
    if (!SUBMISSION_TYPES.includes(String(body.submission_type))) throw new ApiError(400, '提交类型不对');
    fields.submission_type = body.submission_type;
  }
  return fields;
}

/** 正文、文件、视频、绘图至少得有一样。 */
function hasSubmissionContent(row: Record<string, unknown>): boolean {
  return ['content', 'file_url', 'video_url', 'drawing_data'].some(key => row[key] != null);
}

function awardedPoints(value: unknown, max: number | null): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ApiError(400, '得分要填不小于 0 的整数');
  }
  if (typeof max === 'number' && value > max) {
    throw new ApiError(400, `得分不能超过这个任务的分值（${max} 分）`);
  }
  return value;
}

// GET /api/courses/:courseId/tasks/:taskId/submissions — 课程教职看全部，其他人只看自己的
router.get('/courses/:courseId/tasks/:taskId/submissions', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const standing = await ensureCourseMember(courseId, req.user!);
  const task = await loadCourseTask(courseId, String(req.params.taskId), standing);

  let query = supabase
    .from('task_submissions')
    .select(SUBMISSION_SELECT)
    .eq('task_id', task.id)
    .order('submitted_at', { ascending: false, nullsFirst: false });

  if (!isCourseStaff(standing)) {
    query = query.eq('student_id', req.user!.id);
  }

  const { data, error } = await query;

  if (error) throw new ApiError(500, error.message);

  res.json({ submissions: (data ?? []).map(submissionToApi) });
});

// GET /api/courses/:courseId/tasks/:taskId/submissions/:submissionId — get a single submission
router.get('/courses/:courseId/tasks/:taskId/submissions/:submissionId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const standing = await ensureCourseMember(courseId, req.user!);
  const task = await loadCourseTask(courseId, String(req.params.taskId), standing);

  const { data, error } = await supabase
    .from('task_submissions')
    .select(SUBMISSION_SELECT)
    .eq('id', String(req.params.submissionId))
    .eq('task_id', task.id)
    .maybeSingle();

  if (error && !isInvalidId(error)) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, '提交不存在');

  if (!isCourseStaff(standing) && data.student_id !== req.user!.id) {
    throw new ApiError(403, 'You can only view your own submission');
  }

  res.json({ submission: submissionToApi(data) });
});

// PUT /api/courses/:courseId/tasks/:taskId/submissions/:submissionId
// 课程教职批改（评语、得分、状态）；学生改自己还没批改的提交（内容）
router.put('/courses/:courseId/tasks/:taskId/submissions/:submissionId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const standing = await ensureCourseMember(courseId, req.user!);
  const task = await loadCourseTask(courseId, String(req.params.taskId), standing);

  const { data: existing, error: fetchErr } = await supabase
    .from('task_submissions')
    .select('id, student_id, status, content, file_url, video_url, drawing_data')
    .eq('id', String(req.params.submissionId))
    .eq('task_id', task.id)
    .maybeSingle();

  if (fetchErr && !isInvalidId(fetchErr)) throw new ApiError(500, fetchErr.message);
  if (!existing) throw new ApiError(404, '提交不存在');

  const isStaff = isCourseStaff(standing);
  const isOwner = existing.student_id === req.user!.id;

  if (!isOwner && !isStaff) {
    throw new ApiError(403, 'Insufficient permissions');
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if (isStaff) {
    if (SUBMISSION_CONTENT_FIELDS.some(field => body[field] !== undefined)) {
      throw new ApiError(403, '只能批改，不能改学生提交的内容');
    }
    if (body.feedback !== undefined) updates.feedback = optionalText(body.feedback, '评语', FEEDBACK_MAX);
    if (body.points_awarded !== undefined) updates.points_awarded = awardedPoints(body.points_awarded, task.points);
    if (body.status !== undefined) {
      if (body.status !== 'submitted' && body.status !== 'graded' && body.status !== 'returned') {
        throw new ApiError(400, '提交状态只能是 submitted、graded 或 returned');
      }
      updates.status = body.status;
    }
    if (body.feedback !== undefined || body.points_awarded !== undefined) {
      updates.graded_at = new Date().toISOString();
      if (updates.status === undefined) updates.status = 'graded';
    }
  } else {
    // 'graded' / 'returned' 是批改的结果，自己不能把提交标成已批
    if (body.feedback !== undefined || body.points_awarded !== undefined || body.status === 'graded' || body.status === 'returned') {
      throw new ApiError(403, 'Only teachers can grade submissions');
    }
    if (body.status !== undefined && body.status !== 'submitted') {
      throw new ApiError(400, '提交状态不对');
    }
    if (existing.status === 'graded') {
      throw new ApiError(400, '这份提交已经批改，不能再改');
    }
    // 原先只有新交的时候看任务状态，任务关了照样能改已交的内容
    if (task.status !== 'published') {
      throw new ApiError(400, '这个任务已经关闭，不能再改提交');
    }
    const fields = submissionFields(body);
    if (Object.keys(fields).length > 0) {
      if (!hasSubmissionContent({ ...existing, ...fields })) throw new ApiError(400, '提交内容是空的');
      // 改了内容就是重新提交：提交时间跟着更新，教师看到的时间才对得上内容
      Object.assign(updates, fields, { status: 'submitted', submitted_at: new Date().toISOString() });
    }
  }

  if (Object.keys(updates).length === 0) throw new ApiError(400, '没有要修改的内容');

  const { data, error } = await supabase
    .from('task_submissions')
    .update(updates)
    .eq('id', existing.id)
    .eq('task_id', task.id)
    .select(SUBMISSION_SELECT)
    .single();

  if (error || !data) throw new ApiError(500, error?.message ?? '提交没有保存成功');

  res.json({ submission: submissionToApi(data) });
});

// POST /api/courses/:courseId/tasks/:taskId/submissions — 交作业；交过的再交是改同一份
router.post('/courses/:courseId/tasks/:taskId/submissions', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);

  // 交作业的是这门课的学生，按课内身份算：凭学生验证码入课的教师账号也交，课程教职不交
  const standing = await ensureCourseMember(courseId, req.user!);
  if (isCourseStaff(standing)) {
    throw new ApiError(403, 'Only students can submit assignments');
  }

  // 草稿按不存在处理，关闭的任务不再收
  const task = await loadCourseTask(courseId, String(req.params.taskId), standing);
  if (task.status !== 'published') {
    throw new ApiError(400, '这个任务已经关闭，不再收提交');
  }

  const fields = submissionFields((req.body ?? {}) as Record<string, unknown>);
  if (!hasSubmissionContent(fields)) throw new ApiError(400, '提交内容是空的');

  const { data: existing, error: existingErr } = await supabase
    .from('task_submissions')
    .select('id, status')
    .eq('task_id', task.id)
    .eq('student_id', req.user!.id)
    .maybeSingle();
  if (existingErr) throw new ApiError(500, existingErr.message);
  // 和 PUT 同一条规矩。原先重交会把已批改的提交冲回「已提交」，分数和评语却还留着
  if (existing?.status === 'graded') {
    throw new ApiError(400, '这份提交已经批改，不能再改');
  }

  // 按 (task_id, student_id) 合并：原先先查再插，同一个学生两个请求同时到，后一个撞唯一约束报 500
  const { data, error } = await supabase
    .from('task_submissions')
    .upsert({
      submission_type: 'text',
      ...fields,
      task_id: task.id,
      student_id: req.user!.id,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'task_id,student_id' })
    .select(SUBMISSION_SELECT)
    .single();

  if (error || !data) throw new ApiError(500, error?.message ?? '提交没有保存成功');

  res.status(existing ? 200 : 201).json({ submission: submissionToApi(data) });
});

export default router;
