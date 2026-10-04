import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureCourseMember, ensureCourseInstructor, ensureGroupAccess, invalidateMembershipCache, isCourseStaff } from '../services/accessControl';
import { invalidateConditionCache } from '../services/experimentCondition';
import {
  buildGroupIdeaGraph, fetchLatestIdeaGraph, shouldRegenerate,
  IDEA_GRAPH_PERIOD_DAYS, MIN_NOTES_FOR_GRAPH,
  type IdeaGraphPayload,
} from '../services/groupIdeaGraph';

const router = Router();

async function loadProfiles(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map<string, any>();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', ids);
  if (error) throw new ApiError(500, error.message);
  return new Map((data ?? []).map((profile: any) => [profile.id, profile]));
}

/**
 * 组的名单只证明「你是这门课的人」，返回课内身份。
 * 名单全课本来就看得到（GET /courses/:id/groups）；组里的东西走 ensureGroupAccess。
 */
async function ensureGroupCourseMember(groupId: string, user: { id: string; role: string }) {
  const { data: group, error } = await supabase
    .from('groups')
    .select('course_id')
    .eq('id', groupId)
    .single();
  if (error || !group) throw new ApiError(404, 'Group not found');
  return ensureCourseMember(group.course_id as string, user as any);
}


/** Every group write must prove instructor rights on that group's course. */
async function requireGroupInstructor(groupId: string, user: { id: string; role: string }) {
  const { data: group } = await supabase
    .from('groups')
    .select('id, course_id')
    .eq('id', groupId)
    .single();
  if (!group) throw new ApiError(404, 'Group not found');
  await ensureCourseInstructor(group.course_id as string, user as any);
  return group;
}


/** 生成一期并落库。窗口从上一期结束处接续，第一期从建组日算起。 */
async function generateIdeaGraph(
  group: { id: string; course_id: string; created_at: string },
  previous: { window_end: string; payload: IdeaGraphPayload } | null,
  trigger: 'auto' | 'manual',
  userId: string | null,
) {
  const windowEnd = new Date();
  const windowStart = previous ? new Date(previous.window_end) : new Date(group.created_at);

  const { payload, noteCount } = await buildGroupIdeaGraph({
    groupId: group.id,
    courseId: group.course_id,
    windowStart,
    windowEnd,
    previous: previous?.payload ?? null,
  });

  const { data, error } = await supabase
    .from('group_idea_graphs')
    .insert({
      group_id: group.id,
      course_id: group.course_id,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      note_count: noteCount,
      payload,
      trigger,
      created_by: userId,
    })
    .select('id, generated_at, window_start, window_end, note_count, payload, trigger')
    .single();
  if (error) throw new ApiError(500, `Failed to store idea graph: ${error.message}`);
  return data;
}

/**
 * GET /api/groups/:id/idea-graph — 取本组最新一期观点图谱。
 *
 * 满 7 天会在这里顺带生成新的一期（懒生成，不需要定时任务）。第一次访问时若
 * 组里笔记还不足 MIN_NOTES_FOR_GRAPH 条，返回 pending 而不是一张空图 ——
 * 三条笔记的图谱没有信息量，只会让学生觉得这功能没用。
 */
router.get('/groups/:id/idea-graph', verifyJWT, async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  const group = await ensureGroupAccess(groupId, req.user!);

  const latest = await fetchLatestIdeaGraph(groupId);
  const stale = shouldRegenerate(latest?.window_end ?? null);

  if (!stale && latest) {
    return res.json({ graph: latest, periodDays: IDEA_GRAPH_PERIOD_DAYS, regenerated: false });
  }

  const probe = await buildGroupIdeaGraph({
    groupId,
    courseId: group.course_id as string,
    windowStart: latest ? new Date(latest.window_end) : new Date(group.created_at as string),
    windowEnd: new Date(),
    previous: (latest?.payload as IdeaGraphPayload) ?? null,
  });

  if (probe.noteCount < MIN_NOTES_FOR_GRAPH) {
    return res.json({
      graph: latest ?? null,
      pending: true,
      needNotes: MIN_NOTES_FOR_GRAPH,
      haveNotes: probe.noteCount,
      periodDays: IDEA_GRAPH_PERIOD_DAYS,
      regenerated: false,
    });
  }

  const created = await generateIdeaGraph(
    group as any,
    latest ? { window_end: latest.window_end as string, payload: latest.payload as IdeaGraphPayload } : null,
    'auto',
    req.user!.id,
  );
  res.json({ graph: created, periodDays: IDEA_GRAPH_PERIOD_DAYS, regenerated: true });
});

/** POST /api/groups/:id/idea-graph/refresh — 教师手动重算一期，不等满 7 天。 */
router.post('/groups/:id/idea-graph/refresh', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  const group = await requireGroupInstructor(groupId, req.user!);

  const { data: full } = await supabase
    .from('groups')
    .select('id, course_id, created_at')
    .eq('id', groupId)
    .single();

  const latest = await fetchLatestIdeaGraph(groupId);
  const created = await generateIdeaGraph(
    (full ?? group) as any,
    latest ? { window_end: latest.window_end as string, payload: latest.payload as IdeaGraphPayload } : null,
    'manual',
    req.user!.id,
  );
  res.json({ graph: created, periodDays: IDEA_GRAPH_PERIOD_DAYS, regenerated: true });
});

/** GET /api/groups/:id/idea-graph/history — 历次快照的摘要，用来看趋势。 */
router.get('/groups/:id/idea-graph/history', verifyJWT, async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  await ensureGroupAccess(groupId, req.user!);
  const { data, error } = await supabase
    .from('group_idea_graphs')
    .select('id, generated_at, window_start, window_end, note_count, trigger')
    .eq('group_id', groupId)
    .order('generated_at', { ascending: false })
    .limit(20);
  if (error) throw new ApiError(500, error.message);
  res.json({ history: data ?? [] });
});

// ── Groups ────────────────────────────────────────────────────

// GET /api/courses/:courseId/groups — list groups in a course
router.get('/courses/:courseId/groups', verifyJWT, async (req: Request, res: Response) => {
  const { courseId } = req.params;
  // 各组的实验条件只给课程教职看。凭学生验证码入课的教师账号是受试者，
  // 让他看到自己组是哪一臂，盲法就破了。
  const viewerStanding = await ensureCourseMember(String(courseId), req.user!);
  const listIsStaff = isCourseStaff(viewerStanding);

  const { data: groups, error } = await supabase
    .from('groups')
    .select(`
      *,
      group_members(user_id, joined_at)
    `)
    .eq('course_id', courseId)
    .order('created_at');

  if (error) throw new ApiError(500, error.message);
  const profileMap = await loadProfiles((groups ?? []).flatMap((g: any) => (g.group_members ?? []).map((m: any) => m.user_id)));

  // Reshape so memberIds is a simple array and members includes profile info
  const shaped = (groups ?? []).map((g: any) => ({
    id: g.id,
    name: g.name,
    courseId: g.course_id,
    leaderId: g.leader_id,
    color: g.color,
    aiFeedbackCondition: listIsStaff ? (g.ai_feedback_condition ?? null) : null,
    createdAt: g.created_at,
    memberIds: (g.group_members ?? []).map((m: any) => m.user_id),
    members: (g.group_members ?? []).map((m: any) => {
      const profile = profileMap.get(m.user_id);
      return {
        id: m.user_id,
        name: profile?.full_name ?? '',
        avatar: profile?.avatar_url ?? null,
      };
    }),
  }));

  // 课内身份随名单带回：工作区据此决定显示哪些教职才有的操作（改删别人的笔记和批注、
  // 逐组看任务板、重算观点图谱），不再按平台身份猜。进工作区本来就要取这份名单，不多一次请求。
  res.json({ groups: shaped, viewerStanding });
});

// POST /api/courses/:courseId/groups — create group (teacher/admin only)
router.post(
  '/courses/:courseId/groups',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { courseId } = req.params;
    await ensureCourseInstructor(String(courseId), req.user!);
    const { name, leader_id, color, member_ids = [] } = req.body;
    if (!name) throw new ApiError(400, 'name is required');

    const { data: group, error } = await supabase
      .from('groups')
      .insert({ name, course_id: courseId, leader_id, color })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    if (member_ids.length > 0) {
      const memberships = (member_ids as string[]).map((uid) => ({
        group_id: group.id,
        user_id: uid,
      }));
      const { error: memberError } = await supabase.from('group_members').insert(memberships);
      if (memberError) throw new ApiError(500, memberError.message);
    }

    res.status(201).json({ group });
  },
);

// GET /api/groups/:id — get a single group with members
router.get('/groups/:id', verifyJWT, async (req: Request, res: Response) => {
  const { id } = req.params;
  const isStaff = isCourseStaff(await ensureGroupCourseMember(String(id), req.user!));

  const { data, error } = await supabase
    .from('groups')
    .select(`
      *,
      group_members(user_id, joined_at)
    `)
    .eq('id', id)
    .single();

  if (error || !data) throw new ApiError(404, 'Group not found');
  const profileMap = await loadProfiles((data.group_members ?? []).map((m: any) => m.user_id));

  const group = {
    id: data.id,
    name: data.name,
    courseId: data.course_id,
    leaderId: data.leader_id,
    color: data.color,
    // Blinded: revealing the arm to a student defeats the trial's design.
    aiFeedbackCondition: isStaff ? (data.ai_feedback_condition ?? null) : null,
    createdAt: data.created_at,
    memberIds: (data.group_members ?? []).map((m: any) => m.user_id),
    members: (data.group_members ?? []).map((m: any) => {
      const profile = profileMap.get(m.user_id);
      return {
        id: m.user_id,
        name: profile?.full_name ?? '',
        avatar: profile?.avatar_url ?? null,
      };
    }),
  };

  res.json({ group });
});

// PUT /api/groups/:id — update group (teacher/admin only)
router.put('/groups/:id', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, leader_id, color, ai_feedback_condition } = req.body;

  // Verify the group exists and caller is instructor of its course
  const { data: group } = await supabase.from('groups').select('course_id').eq('id', id).single();
  if (!group) throw new ApiError(404, 'Group not found');
  await ensureCourseInstructor(group.course_id, req.user!);

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (leader_id !== undefined) updates.leader_id = leader_id;
  if (color !== undefined) updates.color = color;
  if (ai_feedback_condition !== undefined) {
    if (ai_feedback_condition !== null && !['treatment', 'control'].includes(ai_feedback_condition)) {
      throw new ApiError(400, 'ai_feedback_condition must be treatment, control or null');
    }
    updates.ai_feedback_condition = ai_feedback_condition;
  }

  const { data, error } = await supabase
    .from('groups')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new ApiError(404, 'Group not found');
  if (updates.ai_feedback_condition !== undefined) invalidateConditionCache();
  res.json({ group: data });
});

// DELETE /api/groups/:id — delete group (teacher/admin only)
router.delete('/groups/:id', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  await requireGroupInstructor(String(id), req.user!);
  const { error } = await supabase.from('groups').delete().eq('id', id);
  if (error) throw new ApiError(500, error.message);
  res.json({ message: 'Group deleted' });
});

// POST /api/groups/:id/members — add members to group
router.post('/groups/:id/members', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  await requireGroupInstructor(String(id), req.user!);
  const { user_ids } = req.body as { user_ids: string[] };
  if (!user_ids?.length) throw new ApiError(400, 'user_ids array is required');

  const memberships = user_ids.map((uid) => ({ group_id: id, user_id: uid }));
  const { error } = await supabase.from('group_members').upsert(memberships, { onConflict: 'group_id,user_id' });
  if (error) throw new ApiError(500, error.message);

  // 和移除成员一样清掉：小组空间按组员放行，不清的话刚拖进组的人要等缓存过期才进得去
  invalidateMembershipCache();
  invalidateConditionCache();
  res.json({ message: 'Members added' });
});

// DELETE /api/groups/:id/members/:userId — remove a member
router.delete('/groups/:id/members/:userId', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { id, userId } = req.params;
  await requireGroupInstructor(String(id), req.user!);
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', id)
    .eq('user_id', userId);

  if (error) throw new ApiError(500, error.message);
  invalidateMembershipCache();
  invalidateConditionCache();
  res.json({ message: 'Member removed' });
});

// ── Group Tasks (SSRL) ────────────────────────────────────────

/** 三个 SSRL 阶段的空计数骨架。缺阶段会让前端算百分比时除到 undefined。 */
function emptyPhaseTotals() {
  return {
    total: 0,
    done: 0,
    byPhase: {
      planning: { total: 0, done: 0 },
      monitoring: { total: 0, done: 0 },
      evaluating: { total: 0, done: 0 },
    } as Record<string, { total: number; done: number }>,
  };
}

/**
 * GET /api/courses/:courseId/group-task-stats — SSRL 任务板的真实分布
 *
 * 「分析」页原来写死 45%/30%/25% 三个数字加一段英文说明 —— 那不是分析，
 * 是占位图。这里返回按小组 × 阶段 × 状态的真实计数，一条任务都没有时就返回零，
 * 由前端显示空状态；编造出来的百分比会让教师据此判断小组协作状况。
 *
 * 学生只看得到自己组：跨组的任务分布不是学生需要的信息。
 */
router.get('/courses/:courseId/group-task-stats', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const isStaff = isCourseStaff(await ensureCourseMember(courseId, req.user!));

  const { data: groupRows, error: groupErr } = await supabase
    .from('groups')
    .select('id, name')
    .eq('course_id', courseId)
    .order('name');
  if (groupErr) throw new ApiError(500, groupErr.message);

  let visible = groupRows ?? [];
  if (!isStaff) {
    const { data: mine } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', req.user!.id);
    const myIds = new Set((mine ?? []).map((m: any) => m.group_id));
    visible = visible.filter((g: any) => myIds.has(g.id));
  }

  if (visible.length === 0) {
    res.json({ scope: isStaff ? 'course' : 'group', groups: [], totals: emptyPhaseTotals() });
    return;
  }

  const { data: taskRows, error: taskErr } = await supabase
    .from('group_tasks')
    .select('group_id, ssrl_phase, status')
    .in('group_id', visible.map((g: any) => g.id));
  if (taskErr) throw new ApiError(500, taskErr.message);

  const byGroup = new Map<string, ReturnType<typeof emptyPhaseTotals>>();
  for (const g of visible) byGroup.set(g.id as string, emptyPhaseTotals());
  const totals = emptyPhaseTotals();

  for (const task of taskRows ?? []) {
    const phase = String((task as any).ssrl_phase ?? 'planning');
    const status = String((task as any).status ?? 'todo');
    const bucket = byGroup.get(String((task as any).group_id));
    for (const target of [bucket, totals]) {
      if (!target) continue;
      const phaseBucket = target.byPhase[phase] ?? target.byPhase.planning;
      phaseBucket.total += 1;
      if (status === 'done') phaseBucket.done += 1;
      target.total += 1;
      if (status === 'done') target.done += 1;
    }
  }

  res.json({
    scope: isStaff ? 'course' : 'group',
    groups: visible.map((g: any) => ({ groupId: g.id, name: g.name, ...byGroup.get(g.id)! })),
    totals,
  });
});

// 任务板的读写都只给本组成员和课程教职（ensureGroupAccess），和组空间一样组间隔离。

// GET /api/groups/:id/tasks — list tasks for a group
router.get('/groups/:id/tasks', verifyJWT, async (req: Request, res: Response) => {
  const { id } = req.params;
  await ensureGroupAccess(String(id), req.user!);
  const { phase } = req.query;

  let query = supabase
    .from('group_tasks')
    .select('*')
    .eq('group_id', id)
    .order('created_at');

  if (phase) query = query.eq('ssrl_phase', phase as string);

  const { data, error } = await query;
  if (error) throw new ApiError(500, error.message);
  const profileMap = await loadProfiles((data ?? []).map((task: any) => task.assigned_to_id));

  const tasks = (data ?? []).map((t: any) => ({
    id: t.id,
    groupId: t.group_id,
    title: t.title,
    description: t.description,
    assignedToId: t.assigned_to_id,
    assigneeName: profileMap.get(t.assigned_to_id)?.full_name ?? null,
    createdById: t.created_by_id,
    status: t.status,
    ssrlPhase: t.ssrl_phase,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));

  res.json({ tasks });
});

// POST /api/groups/:id/tasks — create task
router.post('/groups/:id/tasks', verifyJWT, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await ensureGroupAccess(id, req.user!);
  const { title, description, assigned_to_id, ssrl_phase = 'planning' } = req.body;
  if (!title) throw new ApiError(400, 'title is required');

  const validPhases = ['planning', 'monitoring', 'evaluating'];
  if (!validPhases.includes(ssrl_phase)) {
    throw new ApiError(400, `ssrl_phase must be one of: ${validPhases.join(', ')}`);
  }

  const { data, error } = await supabase
    .from('group_tasks')
    .insert({
      group_id: id,
      title,
      description,
      assigned_to_id,
      created_by_id: req.user!.id,
      ssrl_phase,
    })
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);
  res.status(201).json({ task: data });
});

// PATCH /api/groups/:id/tasks/:taskId — update task (status, assignee, etc.)
router.patch('/groups/:id/tasks/:taskId', verifyJWT, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const taskId = req.params.taskId as string;
  await ensureGroupAccess(id, req.user!);
  const { status, title, description, assigned_to_id, ssrl_phase } = req.body;

  if (status !== undefined) {
    const validStatuses = ['todo', 'in_progress', 'done'];
    if (!validStatuses.includes(status)) {
      throw new ApiError(400, `status must be one of: ${validStatuses.join(', ')}`);
    }
  }
  if (ssrl_phase !== undefined) {
    const validPhases = ['planning', 'monitoring', 'evaluating'];
    if (!validPhases.includes(ssrl_phase)) {
      throw new ApiError(400, `ssrl_phase must be one of: ${validPhases.join(', ')}`);
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status !== undefined) updates.status = status;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (assigned_to_id !== undefined) updates.assigned_to_id = assigned_to_id;
  if (ssrl_phase !== undefined) updates.ssrl_phase = ssrl_phase;

  // Scope by group too: the access check above only proved the caller belongs
  // to :id, so without this a member could pass another group's taskId.
  const { data, error } = await supabase
    .from('group_tasks')
    .update(updates)
    .eq('id', taskId)
    .eq('group_id', id)
    .select()
    .single();

  if (error || !data) throw new ApiError(404, 'Task not found');
  res.json({ task: data });
});

// DELETE /api/groups/:id/tasks/:taskId — delete task
router.delete('/groups/:id/tasks/:taskId', verifyJWT, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const taskId = req.params.taskId as string;
  const { standing } = await ensureGroupAccess(id, req.user!);

  // Scoped by group: :id was authorised above, so the task must belong to it.
  const { data: task, error: fetchErr } = await supabase
    .from('group_tasks')
    .select('created_by_id')
    .eq('id', taskId)
    .eq('group_id', id)
    .single();

  if (fetchErr || !task) throw new ApiError(404, 'Task not found');

  if (task.created_by_id !== req.user!.id && !isCourseStaff(standing)) {
    throw new ApiError(403, 'Only the task creator, teacher, or admin can delete this task');
  }

  const { error } = await supabase.from('group_tasks').delete().eq('id', taskId).eq('group_id', id);
  if (error) throw new ApiError(500, error.message);
  res.json({ message: 'Task deleted' });
});

export default router;
