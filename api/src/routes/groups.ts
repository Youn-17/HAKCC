import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureCourseMember, ensureCourseInstructor, ensureGroupAccess, ensureSpaceAccess, invalidateMembershipCache, isCourseStaff } from '../services/accessControl';
import { logEvent } from '../services/eventService';
import { validateUpload } from '../services/attachmentValidation';
import {
  canChangeLeader, courseGroups, loadAssignments, memberGroupIds, parseAssignmentInput, placementColumns, validatePlacement,
} from '../services/groupAssignments';
import { invalidateConditionCache } from '../services/experimentCondition';
import {
  buildGroupIdeaGraph, computeIdeaGraph, fetchLatestIdeaGraph, loadIdeaGraphSource, weeklyWindowsDue,
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

const IDEA_GRAPH_SUMMARY = 'id, generated_at, window_start, window_end, note_count, trigger';

/** 历次快照的摘要（不带图），新的在前；一个学期十几周，留 26 期够看半年 */
async function ideaGraphHistory(groupId: string) {
  const { data, error } = await supabase
    .from('group_idea_graphs')
    .select(IDEA_GRAPH_SUMMARY)
    .eq('group_id', groupId)
    .order('window_end', { ascending: false })
    .limit(26);
  if (error) throw new ApiError(500, error.message);
  return data ?? [];
}

/**
 * 把该补的周补上（2026-10-11 用户：每周更新一次，能看历史），见 weeklyWindowsDue。
 * 只取一次数据，每一期按那一周结束时的笔记算；笔记还不到 MIN_NOTES_FOR_GRAPH 条的周不单出一期，并进下一期。
 * 同一个组同时只跑一份：两个人同时打开，不会把同一周生成两遍。
 */
const ideaGraphRuns = new Map<string, Promise<number>>();

/** 返回这次新补了几期 */
function ensureWeeklyIdeaGraphs(group: { id: string; course_id: string; created_at: string }, userId: string): Promise<number> {
  const running = ideaGraphRuns.get(group.id);
  if (running) return running;
  const run = generateDueWeeks(group, userId).finally(() => ideaGraphRuns.delete(group.id));
  ideaGraphRuns.set(group.id, run);
  return run;
}

async function generateDueWeeks(group: { id: string; course_id: string; created_at: string }, userId: string): Promise<number> {
  const [lastAutoRes, firstRes] = await Promise.all([
    supabase.from('group_idea_graphs').select('window_end, payload')
      .eq('group_id', group.id).eq('trigger', 'auto')
      .order('window_end', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('group_idea_graphs').select('window_start')
      .eq('group_id', group.id)
      .order('window_start', { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (lastAutoRes.error) throw new ApiError(500, lastAutoRes.error.message);
  if (firstRes.error) throw new ApiError(500, firstRes.error.message);

  const anchor = new Date((firstRes.data?.window_start as string | undefined) ?? group.created_at);
  const lastAutoEnd = lastAutoRes.data ? new Date(lastAutoRes.data.window_end as string) : null;
  const ends = weeklyWindowsDue({ anchor, lastAutoEnd, hasAny: Boolean(firstRes.data), now: new Date() });
  if (ends.length === 0) return 0;

  const source = await loadIdeaGraphSource(group.id, group.course_id);
  let windowStart = lastAutoEnd ?? anchor;
  let previous = (lastAutoRes.data?.payload as IdeaGraphPayload | undefined) ?? null;
  const rows: Array<Record<string, unknown>> = [];
  for (const windowEnd of ends) {
    const { payload, noteCount } = computeIdeaGraph(source, { windowStart, windowEnd, previous });
    if (noteCount < MIN_NOTES_FOR_GRAPH) continue;
    rows.push({
      group_id: group.id,
      course_id: group.course_id,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      note_count: noteCount,
      payload,
      trigger: 'auto',
      created_by: userId,
    });
    windowStart = windowEnd;
    previous = payload;
  }
  if (rows.length === 0) return 0;
  const { error } = await supabase.from('group_idea_graphs').insert(rows);
  if (error) throw new ApiError(500, `Failed to store idea graph: ${error.message}`);
  return rows.length;
}

/**
 * GET /api/groups/:id/idea-graph — 本组最新一期观点图谱，连同历次快照的摘要（用来切换看往期）。
 *
 * 该补的周在这里顺带补上（懒生成，不需要定时任务）。一期都还没有、组里笔记又不足
 * MIN_NOTES_FOR_GRAPH 条时，返回 pending 而不是一张空图 —— 三条笔记的图谱没有信息量，
 * 只会让学生觉得这功能没用。
 */
router.get('/groups/:id/idea-graph', verifyJWT, async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  const group = await ensureGroupAccess(groupId, req.user!);

  const added = await ensureWeeklyIdeaGraphs(group as { id: string; course_id: string; created_at: string }, req.user!.id);
  const [latest, history] = await Promise.all([fetchLatestIdeaGraph(groupId), ideaGraphHistory(groupId)]);
  const regenerated = added > 0;

  if (!latest) {
    const probe = await buildGroupIdeaGraph({
      groupId,
      courseId: group.course_id as string,
      windowStart: new Date(group.created_at as string),
      windowEnd: new Date(),
    });
    return res.json({
      graph: null,
      pending: true,
      needNotes: MIN_NOTES_FOR_GRAPH,
      haveNotes: probe.noteCount,
      periodDays: IDEA_GRAPH_PERIOD_DAYS,
      regenerated: false,
      history,
    });
  }
  res.json({ graph: latest, periodDays: IDEA_GRAPH_PERIOD_DAYS, regenerated, history });
});

/** GET /api/groups/:id/idea-graph/snapshots/:snapshotId — 某一期的完整图谱（看往期用） */
router.get('/groups/:id/idea-graph/snapshots/:snapshotId', verifyJWT, async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  await ensureGroupAccess(groupId, req.user!);
  const { data, error } = await supabase
    .from('group_idea_graphs')
    .select('id, generated_at, window_start, window_end, note_count, payload, trigger')
    .eq('id', String(req.params.snapshotId))
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Snapshot not found');
  res.json({ graph: data });
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
  res.json({ graph: created, periodDays: IDEA_GRAPH_PERIOD_DAYS, regenerated: true, history: await ideaGraphHistory(groupId) });
});

/** GET /api/groups/:id/idea-graph/history — 历次快照的摘要，用来看趋势。 */
router.get('/groups/:id/idea-graph/history', verifyJWT, async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  await ensureGroupAccess(groupId, req.user!);
  res.json({ history: await ideaGraphHistory(groupId) });
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
    logoUrl: g.logo_url ?? null,
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
    logoUrl: data.logo_url ?? null,
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
  // 移出的是组长，组长一并取消。没清掉也不报错：读组长的地方都把不在组里的组长当作没有
  const { data: cleared, error: leaderError } = await supabase
    .from('groups')
    .update({ leader_id: null })
    .eq('id', id)
    .eq('leader_id', userId)
    .select('id');
  if (leaderError) console.warn('[groups] leader not cleared after removal', leaderError.message);
  invalidateMembershipCache();
  invalidateConditionCache();
  logEvent({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'group_member_removed',
    object_type: 'group',
    object_id: String(id),
    metadata_json: { user_id: userId, was_leader: (cleared ?? []).length > 0 },
  });
  res.json({ message: 'Member removed' });
});

// ── 小组 logo（迁移 089） ──────────────────────────────────────

/** logo 前端已缩到 512 像素以内的 PNG，正常几十到几百 KB；2MB 是上限 */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * POST /api/groups/:id/logo {file_name, mime_type, data_url} — 上传小组 logo（2026-10-11 用户：各组设计了 logo，
 * 教师给他们放进去，小组的视图卡片上显示）。只有课程教职能改；只收真图片（按字节判定，SVG 不收）。
 */
router.post('/groups/:id/logo', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  await requireGroupInstructor(groupId, req.user!);
  const { file_name, mime_type = 'image/png', data_url } = (req.body ?? {}) as { file_name?: string; mime_type?: string; data_url?: string };
  if (!file_name || !data_url) throw new ApiError(400, 'file_name and data_url are required');
  const { buffer, safeName } = validateUpload(data_url, file_name, mime_type, { imagesOnly: true, maxBytes: LOGO_MAX_BYTES });

  const path = `group-logos/${groupId}-${Date.now()}-${safeName}`;
  const bucket = supabase.storage.from('note-chat-attachments');
  const { error: uploadError } = await bucket.upload(path, buffer, { contentType: mime_type, upsert: false });
  if (uploadError) throw new ApiError(500, uploadError.message);
  const logoUrl = bucket.getPublicUrl(path).data.publicUrl;

  const { error } = await supabase.from('groups').update({ logo_url: logoUrl }).eq('id', groupId);
  if (error) throw new ApiError(500, error.message);
  logEvent({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'group_logo_set',
    object_type: 'group',
    object_id: groupId,
    metadata_json: { cleared: false },
  });
  res.json({ group: { id: groupId, logoUrl } });
});

// DELETE /api/groups/:id/logo — 去掉小组 logo
router.delete('/groups/:id/logo', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  await requireGroupInstructor(groupId, req.user!);
  const { error } = await supabase.from('groups').update({ logo_url: null }).eq('id', groupId);
  if (error) throw new ApiError(500, error.message);
  logEvent({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'group_logo_set',
    object_type: 'group',
    object_id: groupId,
    metadata_json: { cleared: true },
  });
  res.json({ group: { id: groupId, logoUrl: null } });
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

// ── 组长 ─────────────────────────────────────────────────────

/**
 * PUT /api/groups/:id/leader {leader_id | null} — 指定或取消组长（2026-10-10 用户：教师可以指定，学生也可以自己定）。
 * 教职随时可以改；组员在还没有组长时可以指定任何组员（包括自己），有了组长以后只有组长本人能移交或卸任。
 */
router.put('/groups/:id/leader', verifyJWT, async (req: Request, res: Response) => {
  const groupId = String(req.params.id);
  const { standing } = await ensureGroupAccess(groupId, req.user!);
  const raw = (req.body ?? {}).leader_id;
  const leaderId = raw === null || raw === undefined || raw === '' ? null : String(raw);

  const [groupRes, membersRes] = await Promise.all([
    supabase.from('groups').select('id, leader_id').eq('id', groupId).single(),
    supabase.from('group_members').select('user_id').eq('group_id', groupId),
  ]);
  if (groupRes.error || !groupRes.data) throw new ApiError(404, 'Group not found');
  if (membersRes.error) throw new ApiError(500, membersRes.error.message);
  const memberIds = new Set((membersRes.data ?? []).map((m: any) => m.user_id as string));
  if (leaderId && !memberIds.has(leaderId)) throw new ApiError(400, 'The leader must be a member of this group');

  const previous = (groupRes.data.leader_id as string | null) ?? null;
  const isStaff = isCourseStaff(standing);
  const decision = canChangeLeader({ isStaff, userId: req.user!.id, currentLeaderId: previous && memberIds.has(previous) ? previous : null });
  if (!decision.ok) throw new ApiError(403, decision.reason);

  const { error } = await supabase.from('groups').update({ leader_id: leaderId }).eq('id', groupId);
  if (error) throw new ApiError(500, error.message);
  logEvent({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'group_leader_set',
    object_type: 'group',
    object_id: groupId,
    metadata_json: { leader_id: leaderId, previous_leader_id: previous, by_staff: isStaff },
  });
  res.json({ group: { id: groupId, leaderId } });
});

// ── 教师给各组发布的任务（迁移 088，规则见 services/groupAssignments.ts） ──────

async function ensureCourseStaffStanding(courseId: string, user: Request['user']) {
  const standing = await ensureCourseMember(courseId, user!);
  if (!isCourseStaff(standing)) throw new ApiError(403, 'Only the course instructor can manage group tasks');
  return standing;
}

function notifyGroupMembers(
  assignment: { id: string; title: string },
  groups: Array<{ id: string; name: string }>,
  actorId: string,
  lang: 'zh' | 'en',
) {
  void (async () => {
    const { data: rows } = await supabase.from('group_members').select('group_id, user_id').in('group_id', groups.map(g => g.id));
    const name = new Map(groups.map(g => [g.id, g.name]));
    const seen = new Set<string>();
    const notices = [];
    for (const r of (rows ?? []) as Array<{ group_id: string; user_id: string }>) {
      if (r.user_id === actorId || seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      notices.push({
        user_id: r.user_id,
        type: 'group_assignment',
        title: lang === 'zh' ? '新的小组任务' : 'New group task',
        message: lang === 'zh'
          ? `老师给${name.get(r.group_id) ?? '你们组'}发布了任务「${assignment.title}」`
          : `Your teacher assigned "${assignment.title}" to ${name.get(r.group_id) ?? 'your group'}`,
        link_type: 'group',
        link_id: r.group_id,
      });
    }
    if (notices.length) await supabase.from('notifications').insert(notices);
  })().catch(err => console.warn('[group-assignments] notify failed:', err instanceof Error ? err.message : err));
}

// GET /api/courses/:courseId/group-assignments — 教职看全部；学生只看发给自己组的
router.get('/courses/:courseId/group-assignments', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const standing = await ensureCourseMember(courseId, req.user!);
  const visibleGroups = isCourseStaff(standing) ? null : await memberGroupIds(courseId, req.user!.id);
  res.json({ assignments: await loadAssignments(courseId, { visibleGroups }) });
});

// POST /api/courses/:courseId/group-assignments — 发布（默认发给这门课的全部小组）
router.post('/courses/:courseId/group-assignments', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseStaffStanding(courseId, req.user);
  const input = parseAssignmentInput(req.body);
  const groups = await courseGroups(courseId);
  if (groups.length === 0) throw new ApiError(400, 'This course has no groups yet');
  const known = new Set(groups.map(g => g.id));
  const targetIds = input.groupIds ?? groups.map(g => g.id);
  if (targetIds.length === 0) throw new ApiError(400, 'Choose at least one group');
  if (targetIds.some(id => !known.has(id))) throw new ApiError(400, 'group_ids must be groups in this course');
  const placement = placementColumns(input);
  await validatePlacement(courseId, placement.placement, placement.space_id, placement.view_id);

  const { data: row, error } = await supabase
    .from('group_assignments')
    .insert({
      course_id: courseId,
      title: input.title,
      content: input.content ?? '',
      requirements: input.requirements ?? '',
      due_at: input.dueAt ?? null,
      ...placement,
      created_by: req.user!.id,
    })
    .select('id, title')
    .single();
  if (error || !row) throw new ApiError(500, error?.message ?? 'Failed to publish');
  const { error: targetError } = await supabase
    .from('group_assignment_targets')
    .insert(targetIds.map(group_id => ({ assignment_id: row.id, group_id })));
  if (targetError) {
    await supabase.from('group_assignments').delete().eq('id', row.id);
    throw new ApiError(500, targetError.message);
  }

  const targets = groups.filter(g => targetIds.includes(g.id));
  notifyGroupMembers({ id: row.id as string, title: row.title as string }, targets, req.user!.id, req.body?.lang === 'en' ? 'en' : 'zh');
  logEvent({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'group_assignment_published',
    object_type: 'group_assignment',
    object_id: row.id as string,
    space_id: placement.space_id,
    metadata_json: { course_id: courseId, group_ids: targetIds, placement: placement.placement, view_id: placement.view_id, due_at: input.dueAt ?? null },
  });
  const [assignment] = await loadAssignments(courseId, { ids: [row.id as string] });
  res.status(201).json({ assignment });
});

async function staffAssignment(id: string, user: Request['user']) {
  const { data, error } = await supabase.from('group_assignments').select('id, course_id').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error || !data) throw new ApiError(404, 'Group task not found');
  await ensureCourseStaffStanding(data.course_id as string, user);
  return { id: data.id as string, courseId: data.course_id as string };
}

// PATCH /api/group-assignments/:id — 改内容、截止时间、位置、发给哪些组（不重复通知）
router.patch('/group-assignments/:id', verifyJWT, async (req: Request, res: Response) => {
  const { id, courseId } = await staffAssignment(String(req.params.id), req.user);
  const input = parseAssignmentInput(req.body, { partial: true });
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) updates.title = input.title;
  if (input.content !== undefined) updates.content = input.content;
  if (input.requirements !== undefined) updates.requirements = input.requirements;
  if (input.dueAt !== undefined) updates.due_at = input.dueAt;
  if (input.placement !== undefined) {
    const placement = placementColumns(input);
    await validatePlacement(courseId, placement.placement, placement.space_id, placement.view_id);
    Object.assign(updates, placement);
  }
  if (input.groupIds) {
    const groups = await courseGroups(courseId);
    const known = new Set(groups.map(g => g.id));
    if (input.groupIds.length === 0) throw new ApiError(400, 'Choose at least one group');
    if (input.groupIds.some(g => !known.has(g))) throw new ApiError(400, 'group_ids must be groups in this course');
  }
  const { error } = await supabase.from('group_assignments').update(updates).eq('id', id);
  if (error) throw new ApiError(500, error.message);
  if (input.groupIds) {
    const { error: delError } = await supabase.from('group_assignment_targets').delete().eq('assignment_id', id);
    if (delError) throw new ApiError(500, delError.message);
    const { error: insError } = await supabase.from('group_assignment_targets').insert(input.groupIds.map(group_id => ({ assignment_id: id, group_id })));
    if (insError) throw new ApiError(500, insError.message);
  }
  logEvent({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'group_assignment_updated',
    object_type: 'group_assignment',
    object_id: id,
    metadata_json: { course_id: courseId, fields: Object.keys(updates).filter(k => k !== 'updated_at'), group_ids: input.groupIds ?? null },
  });
  const [assignment] = await loadAssignments(courseId, { ids: [id] });
  res.json({ assignment });
});

// DELETE /api/group-assignments/:id — 撤回（软删，研究数据里还在）
router.delete('/group-assignments/:id', verifyJWT, async (req: Request, res: Response) => {
  const { id, courseId } = await staffAssignment(String(req.params.id), req.user);
  const { error } = await supabase.from('group_assignments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new ApiError(500, error.message);
  logEvent({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'group_assignment_withdrawn',
    object_type: 'group_assignment',
    object_id: id,
    metadata_json: { course_id: courseId },
  });
  res.json({ ok: true });
});

// GET /api/spaces/:spaceId/group-assignments — 工作区任务面板：这个空间里该看到的任务（按视图筛在前端）
router.get('/spaces/:spaceId/group-assignments', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  const space = await ensureSpaceAccess(spaceId, req.user!);
  const isStaff = isCourseStaff(space.standing);
  let visibleGroups: Set<string> | null;
  if (space.group_id) visibleGroups = new Set([space.group_id]);
  else visibleGroups = isStaff ? null : await memberGroupIds(space.course_id, req.user!.id);
  const all = visibleGroups && visibleGroups.size === 0 ? [] : await loadAssignments(space.course_id, { visibleGroups });
  res.json({ assignments: all.filter(a => !a.spaceId || a.spaceId === spaceId) });
});

export default router;
