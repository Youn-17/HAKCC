import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole, type AuthUser } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { isUuid } from '../services/eventPayload';
import { ensureCourseInstructor, getCourseStanding } from '../services/accessControl';

const router = Router();

/**
 * 「强制使用支架」管的是学生。开课教师、课程管理员和平台管理员要能写不带支架的
 * 示范笔记 —— v1.24 更新日志这样承诺过，编辑器却只放过了综合升华笔记。
 * 按课内身份判，不只看平台角色：以普通成员身份加入别人课程的教师账号照常受限。
 */
export async function isScaffoldExempt(courseId: string, user: AuthUser): Promise<boolean> {
  if (user.role !== 'teacher' && user.role !== 'admin') return false;
  try {
    const standing = await getCourseStanding(courseId, user);
    return standing === 'owner' || standing === 'manager';
  } catch {
    return false;
  }
}

// Map DB row → API shape
function scaffoldToApi(row: Record<string, unknown>, pref?: Record<string, unknown>) {
  return {
    id: row.id,
    hidden: Boolean(pref?.hidden ?? false),
    title: row.title,
    titleEn: row.title_en ?? null,
    description: row.description,
    category: row.category,
    icon: row.icon,
    color: row.color,
    steps: row.steps ?? [],
    metadata: row.metadata ?? {},
    sortOrder: row.sort_order ?? 0,
    usageCount: row.usage_count ?? 0,
    isMandatory: row.is_mandatory ?? false,
    isRecommended: (pref?.is_recommended ?? row.is_recommended ?? false) as boolean,
    courseId: row.course_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// GET /api/courses/:courseId/scaffolds — 本课程支架 + 全局支架，叠加课程级偏好
router.get('/courses/:courseId/scaffolds', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  // Interpolated into an .or() expression below, where PostgREST would treat
  // punctuation as syntax — reject anything that is not a plain UUID.
  if (!isUuid(courseId)) throw new ApiError(400, 'courseId must be a valid UUID');

  const [{ data, error }, { data: prefRows }, { data: course }, scaffoldExempt] = await Promise.all([
    supabase
      .from('scaffolds')
      .select('*')
      .or(`course_id.eq.${courseId},course_id.is.null`)
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
    supabase
      .from('course_scaffold_prefs')
      .select('scaffold_id, hidden, is_recommended, sort_order')
      .eq('course_id', courseId),
    // 课程级开关随支架一起回，编辑器不用再发一次请求
    supabase.from('courses').select('require_scaffold').eq('id', courseId).maybeSingle(),
    isScaffoldExempt(courseId, req.user!),
  ]);

  if (error) throw new ApiError(500, error.message);
  const prefs = new Map((prefRows ?? []).map(p => [p.scaffold_id as string, p as Record<string, unknown>]));

  let list = (data ?? []).map(row => scaffoldToApi(row, prefs.get(row.id as string)));
  // 课程教职看全部，隐藏的带 hidden 标记（支架管理里要能恢复）；其他人只看留下的那些。
  // 教职按课内身份，就是上面算豁免的那个判断：在这门课里只是普通成员的教师账号和学生一样。
  if (!scaffoldExempt) list = list.filter(item => !item.hidden);
  // requireScaffold 是课程级开关本身（支架管理弹窗里的那个开关要显示它）；
  // scaffoldExempt 说的是这个开关管不管当前这个人
  res.json({ scaffolds: list, requireScaffold: course?.require_scaffold === true, scaffoldExempt });
});

// PUT /api/courses/:courseId/scaffold-policy — 本课程是否强制使用支架（课程创建者与课程管理员）
router.put('/courses/:courseId/scaffold-policy', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  if (!isUuid(courseId)) throw new ApiError(400, 'courseId must be a valid UUID');
  await ensureCourseInstructor(courseId, req.user!);
  const { require_scaffold } = req.body ?? {};
  if (typeof require_scaffold !== 'boolean') throw new ApiError(400, 'require_scaffold must be a boolean');

  const { error } = await supabase.from('courses').update({ require_scaffold }).eq('id', courseId);
  if (error) throw new ApiError(500, error.message);
  res.json({ ok: true, requireScaffold: require_scaffold });
});

// PUT /api/courses/:courseId/scaffolds/:scaffoldId/prefs — 这门课怎么用这条支架（课程创建者与课程管理员）
//
// 这里和下面的批量、新建原先只有 requireRole：任何教师账号都能改任何一门课的支架隐藏、推荐，
// 往任何一门课里加支架，包括在那门课里只是普通成员、甚至根本不在那门课里的。口径同强制开关。
router.put('/courses/:courseId/scaffolds/:scaffoldId/prefs', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { courseId, scaffoldId } = req.params;
  await ensureCourseInstructor(String(courseId), req.user!);
  const { hidden, is_recommended, sort_order } = req.body ?? {};

  const { error } = await supabase
    .from('course_scaffold_prefs')
    .upsert({
      course_id: courseId,
      scaffold_id: scaffoldId,
      hidden: hidden ?? false,
      is_recommended: is_recommended ?? null,
      sort_order: typeof sort_order === 'number' ? sort_order : null,
      updated_by: req.user!.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'course_id,scaffold_id' });

  if (error) throw new ApiError(500, error.message);
  res.json({ ok: true });
});

// POST /api/courses/:courseId/scaffolds/bulk — 批量隐藏/恢复/推荐/删除（课程创建者与课程管理员）
router.post('/courses/:courseId/scaffolds/bulk', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { courseId } = req.params;
  await ensureCourseInstructor(String(courseId), req.user!);
  const action = String(req.body?.action ?? '');
  const ids: string[] = Array.isArray(req.body?.scaffold_ids) ? req.body.scaffold_ids.map(String) : [];
  if (!ids.length) throw new ApiError(400, 'scaffold_ids is required');
  if (ids.length > 500) throw new ApiError(400, 'too many scaffolds in one request');

  if (action === 'delete') {
    const { data: rows } = await supabase.from('scaffolds').select('id, course_id').in('id', ids);
    const globals = (rows ?? []).filter(r => !r.course_id).map(r => r.id as string);

    // scope:"global" is a confirmation, not a permission. The shared library is
    // a multi-semester research asset, so only admins may delete from it, and a
    // course-owned scaffold may only be deleted by that course's instructor.
    if (globals.length) {
      if (req.user!.role !== 'admin') {
        throw new ApiError(403, `${globals.length} 条是全局支架，只有管理员可以删除`);
      }
      if (req.body?.scope !== 'global') {
        throw new ApiError(400, `${globals.length} 条是全局支架，删除会影响所有课程；确认请带 scope: "global"`);
      }
    }
    for (const owner of new Set((rows ?? []).map(r => r.course_id as string | null).filter(Boolean))) {
      await ensureCourseInstructor(owner as string, req.user!);
    }

    const { error } = await supabase.from('scaffolds').delete().in('id', ids);
    if (error) throw new ApiError(500, error.message);
    res.json({ ok: true, deleted: ids.length });
    return;
  }

  const patch: Record<string, unknown> =
    action === 'hide' ? { hidden: true }
    : action === 'show' ? { hidden: false }
    : action === 'recommend' ? { is_recommended: true }
    : action === 'unrecommend' ? { is_recommended: false }
    : {};
  if (!Object.keys(patch).length) throw new ApiError(400, 'unknown action');

  const { error } = await supabase
    .from('course_scaffold_prefs')
    .upsert(ids.map(id => ({
      course_id: courseId,
      scaffold_id: id,
      hidden: false,
      ...patch,
      updated_by: req.user!.id,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'course_id,scaffold_id' });

  if (error) throw new ApiError(500, error.message);
  res.json({ ok: true, updated: ids.length });
});

// GET /api/scaffolds/:id — get a single scaffold
router.get('/scaffolds/:id', verifyJWT, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('scaffolds')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) throw new ApiError(404, 'Scaffold not found');
  res.json({ scaffold: scaffoldToApi(data) });
});

// POST /api/courses/:courseId/scaffolds — 给这门课新建支架（课程创建者与课程管理员）
router.post('/courses/:courseId/scaffolds', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { courseId } = req.params;
  await ensureCourseInstructor(String(courseId), req.user!);
  const { title, title_en, description, category, icon, color, steps, metadata, sort_order, is_mandatory, is_recommended } = req.body;

  if (!title || !category) throw new ApiError(400, 'title and category are required');

  const { data, error } = await supabase
    .from('scaffolds')
    .insert({
      title,
      title_en: title_en ?? null,
      description,
      category,
      icon,
      color,
      steps: steps ?? [],
      metadata: metadata ?? {},
      sort_order: typeof sort_order === 'number' ? sort_order : 0,
      is_mandatory: is_mandatory ?? false,
      is_recommended: is_recommended ?? false,
      course_id: courseId,
      created_by: req.user!.id,
    })
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);

  // Log event
  await supabase.from('events').insert({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'scaffold_created',
    object_type: 'scaffold',
    object_id: data.id,
    metadata_json: { course_id: courseId, category },
  });

  res.status(201).json({ scaffold: scaffoldToApi(data) });
});

// PUT /api/scaffolds/:id — update scaffold (teacher/admin)
router.put('/scaffolds/:id', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { data: owner } = await supabase
    .from('scaffolds').select('course_id').eq('id', req.params.id).maybeSingle();
  if (!owner) throw new ApiError(404, 'Scaffold not found');
  // Same ownership rule as delete: the shared library is admin-only, and a
  // course scaffold belongs to that course's instructor.
  if (!owner.course_id) {
    if (req.user!.role !== 'admin') throw new ApiError(403, '只有管理员可以修改全局支架');
  } else {
    await ensureCourseInstructor(owner.course_id as string, req.user!);
  }

  const { title, title_en, description, category, icon, color, steps, metadata, sort_order, is_mandatory, is_recommended } = req.body;

  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title;
  if (title_en !== undefined) updateData.title_en = title_en;
  if (metadata !== undefined) updateData.metadata = metadata;
  if (sort_order !== undefined) updateData.sort_order = sort_order;
  if (description !== undefined) updateData.description = description;
  if (category !== undefined) updateData.category = category;
  if (icon !== undefined) updateData.icon = icon;
  if (color !== undefined) updateData.color = color;
  if (steps !== undefined) updateData.steps = steps;
  if (is_mandatory !== undefined) updateData.is_mandatory = is_mandatory;
  if (is_recommended !== undefined) updateData.is_recommended = is_recommended;

  const { data, error } = await supabase
    .from('scaffolds')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);
  res.json({ scaffold: scaffoldToApi(data) });
});

// DELETE /api/scaffolds/:id — delete scaffold (teacher/admin)
router.delete('/scaffolds/:id', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { data: row } = await supabase
    .from('scaffolds').select('id, course_id, title').eq('id', req.params.id).maybeSingle();
  if (!row) throw new ApiError(404, 'Scaffold not found');

  // 全局支架是所有课程共用的，误删一条就是全平台少一条
  if (!row.course_id) {
    if (req.user!.role !== 'admin') throw new ApiError(403, '只有管理员可以删除全局支架');
    if (req.query.scope !== 'global') {
      throw new ApiError(400, '这是全局支架，删除会影响所有课程；只想在本课程停用请用「隐藏」');
    }
  } else {
    await ensureCourseInstructor(row.course_id as string, req.user!);
  }

  const { error } = await supabase.from('scaffolds').delete().eq('id', req.params.id);
  if (error) throw new ApiError(500, error.message);

  await supabase.from('events').insert({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'scaffold_deleted',
    object_type: 'scaffold',
    object_id: req.params.id,
    metadata_json: { title: row.title, was_global: !row.course_id },
  });

  res.json({ message: 'Scaffold deleted' });
});

// POST /api/scaffolds/:id/use — increment usage count + log event
router.post('/scaffolds/:id/use', verifyJWT, async (req: Request, res: Response) => {
  const { space_id, note_id } = req.body;

  const { data, error } = await supabase
    .from('scaffolds')
    .select('id, usage_count')
    .eq('id', req.params.id)
    .single();

  if (error || !data) throw new ApiError(404, 'Scaffold not found');

  await supabase
    .from('scaffolds')
    .update({ usage_count: (data.usage_count ?? 0) + 1 })
    .eq('id', req.params.id);

  // Log scaffold usage event
  await supabase.from('events').insert({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'scaffold_used',
    object_type: 'scaffold',
    object_id: req.params.id,
    space_id: space_id ?? null,
    metadata_json: { note_id: note_id ?? null },
  });

  res.json({ ok: true });
});

export default router;
