/**
 * 课程教学安排与课次记录。
 *
 * 这一层产出的是研究数据：这门课计划上几次、实际上了几次、哪几次调了课、
 * 每次课堂上发生了多少建构活动。所以「系统统计的事实」和「AI 写的概述」
 * 在库里就是分开的两组字段 —— 审稿人问「参与人数怎么来的」，
 * 答案必须是「数据库统计」，而不是「模型写的」。
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureCourseInstructor, ensureCourseMember } from '../services/accessControl';
import { generateSessions, normalizeSchedule, zonedTimeToUtc, estimateCreditHours } from '../services/courseSchedule';
import { callCourseChat } from '../services/courseAi';

const router = Router();

const COURSE_TYPES = ['general', 'major', 'required', 'elective'];
const STATUSES = ['planned', 'held', 'cancelled', 'rescheduled'];

/**
 * 课次的统计窗口：课前 1 小时到课后 23 小时，共 24 小时。
 *
 * 固定长度才可比较；只算「上课那 90 分钟」会漏掉课后当晚的延续，
 * 而知识建构的讨论大量发生在课后。课次间隔 ≥1 天时窗口互不重叠。
 */
const WINDOW_BEFORE_MS = 60 * 60 * 1000;
const WINDOW_AFTER_MS = 23 * 60 * 60 * 1000;

function paramId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new ApiError(400, `${name} is required`);
  return value;
}

function sessionToApi(row: any) {
  return {
    id: row.id,
    courseId: row.course_id,
    sessionNo: row.session_no,
    weekNo: row.week_no,
    plannedDate: row.planned_date,
    plannedStart: String(row.planned_start ?? '').slice(0, 5),
    plannedMinutes: row.planned_minutes,
    plannedAt: row.planned_at,
    status: row.status,
    actualDate: row.actual_date,
    actualStart: row.actual_start ? String(row.actual_start).slice(0, 5) : null,
    actualMinutes: row.actual_minutes,
    movedToDate: row.moved_to_date,
    movedToStart: row.moved_to_start ? String(row.moved_to_start).slice(0, 5) : null,
    cancelReason: row.cancel_reason,
    note: row.note,
    confirmedAt: row.confirmed_at,
    metrics: row.metrics ?? {},
    aiSummary: row.ai_summary,
    aiSummaryAt: row.ai_summary_at,
    aiSummaryEdited: row.ai_summary_edited,
  };
}

// PUT /api/courses/:courseId/schedule — 设置教学安排并重建课次表
router.put('/courses/:courseId/schedule', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = paramId(req.params.courseId, 'courseId');
  await ensureCourseInstructor(courseId, req.user!);

  const courseType = req.body.course_type ? String(req.body.course_type) : null;
  if (courseType && !COURSE_TYPES.includes(courseType)) throw new ApiError(400, '课程类型不合法');

  const startDate = String(req.body.start_date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new ApiError(400, '请填写开课日期');

  const totalWeeks = Number(req.body.total_weeks);
  if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 52) {
    throw new ApiError(400, '持续周数需在 1–52 之间');
  }

  const schedule = normalizeSchedule(req.body.schedule);
  if (schedule.length === 0) throw new ApiError(400, '请至少填写一个上课时段');

  const timezone = String(req.body.timezone || 'Asia/Shanghai');
  const planned = generateSessions({ startDate, totalWeeks, schedule, timezone });
  if (planned.length === 0) throw new ApiError(400, '按当前安排算不出任何课次，请检查参数');

  // 学时以教师填的为准，没填就按时段算出来
  const creditHours = Number.isFinite(Number(req.body.credit_hours)) && Number(req.body.credit_hours) > 0
    ? Math.round(Number(req.body.credit_hours))
    : estimateCreditHours(planned);

  const { error: courseErr } = await supabase
    .from('courses')
    .update({
      course_type: courseType,
      credit_hours: creditHours,
      total_weeks: totalWeeks,
      start_date: startDate,
      timezone,
      schedule,
      updated_at: new Date().toISOString(),
    })
    .eq('id', courseId);
  if (courseErr) throw new ApiError(500, courseErr.message);

  // 已经确认过的课次不能被重建冲掉 —— 那是教师记下的事实，
  // 改一次时间表就把整学期的出勤记录抹掉是不可接受的。
  const { data: confirmed } = await supabase
    .from('course_sessions')
    .select('id, session_no')
    .eq('course_id', courseId)
    .neq('status', 'planned');
  const keptNos = new Set((confirmed ?? []).map((r: any) => r.session_no));

  await supabase.from('course_sessions')
    .delete()
    .eq('course_id', courseId)
    .eq('status', 'planned');

  const rows = planned
    .filter(p => !keptNos.has(p.sessionNo))
    .map(p => ({
      course_id: courseId,
      session_no: p.sessionNo,
      week_no: p.weekNo,
      planned_date: p.plannedDate,
      planned_start: p.plannedStart,
      planned_minutes: p.plannedMinutes,
      planned_at: p.plannedAt,
    }));
  if (rows.length > 0) {
    const { error } = await supabase.from('course_sessions').insert(rows);
    if (error) throw new ApiError(500, error.message);
  }

  res.json({
    totalSessions: planned.length,
    created: rows.length,
    kept: keptNos.size,
    creditHours,
    estimatedHours: estimateCreditHours(planned),
  });
});

// GET /api/courses/:courseId/sessions — 课次表
router.get('/courses/:courseId/sessions', verifyJWT, async (req: Request, res: Response) => {
  const courseId = paramId(req.params.courseId, 'courseId');
  await ensureCourseMember(courseId, req.user!);

  const [{ data, error }, { data: course }] = await Promise.all([
    supabase
      .from('course_sessions')
      .select('*')
      .eq('course_id', courseId)
      .order('session_no', { ascending: true }),
    supabase
      .from('courses')
      .select('course_type, credit_hours, total_weeks, start_date, timezone, schedule')
      .eq('id', courseId)
      .maybeSingle(),
  ]);
  if (error) throw new ApiError(500, error.message);

  const sessions = (data ?? []).map(sessionToApi);
  res.json({
    sessions,
    // 一并回传安排配置：设置页要用它回填表单，少一次往返
    config: course
      ? {
          courseType: course.course_type ?? null,
          creditHours: course.credit_hours ?? null,
          totalWeeks: course.total_weeks ?? null,
          startDate: course.start_date ?? null,
          timezone: course.timezone ?? 'Asia/Shanghai',
          schedule: normalizeSchedule(course.schedule),
        }
      : null,
    summary: {
      total: sessions.length,
      held: sessions.filter(s => s.status === 'held').length,
      cancelled: sessions.filter(s => s.status === 'cancelled').length,
      rescheduled: sessions.filter(s => s.status === 'rescheduled').length,
      pending: sessions.filter(s => s.status === 'planned').length,
    },
  });
});

/**
 * GET /api/sessions/pending — 我教的课里，时间已过但还没确认的课次。
 *
 * 教师登录后据此提示补记。不做「到点才弹」：教师很少在上课那一刻登录，
 * 那样绝大多数课次会被静默漏掉，而这正是要采集的研究数据。
 */
router.get('/sessions/pending', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  // 我创建的课，加上我被指定为课程管理员的课。管理员要能替创建者补记，
  // 提醒却只发给创建者的话，这个身份就只剩一半用处。
  const [{ data: owned }, { data: managed }] = await Promise.all([
    supabase.from('courses').select('id, title').eq('instructor_id', req.user!.id),
    supabase.from('course_members')
      .select('course_id')
      .eq('user_id', req.user!.id)
      .in('role', ['teacher', 'admin']),
  ]);

  const ownedIds = (owned ?? []).map((c: any) => c.id);
  const managedIds = (managed ?? []).map((m: any) => m.course_id).filter(Boolean);
  const ids = Array.from(new Set([...ownedIds, ...managedIds]));
  if (ids.length === 0) { res.json({ sessions: [] }); return; }

  // 协作的课不在 owned 里，标题要另取一次
  const { data: allCourses } = await supabase.from('courses').select('id, title').in('id', ids);
  const courses = allCourses ?? [];

  const { data } = await supabase
    .from('course_sessions')
    .select('*')
    .in('course_id', ids)
    .eq('status', 'planned')
    .lt('planned_at', new Date().toISOString())
    .order('planned_at', { ascending: true })
    .limit(20);

  const titleById = new Map(courses.map((c: any) => [c.id, c.title]));
  res.json({
    sessions: (data ?? []).map((row: any) => ({
      ...sessionToApi(row),
      courseTitle: titleById.get(row.course_id) ?? '',
    })),
  });
});

/** 当次课堂活动的统计快照。全部来自数据库计数，不经过 AI。 */
async function computeMetrics(courseId: string, plannedAt: string) {
  const start = new Date(new Date(plannedAt).getTime() - WINDOW_BEFORE_MS).toISOString();
  const end = new Date(new Date(plannedAt).getTime() + WINDOW_AFTER_MS).toISOString();

  const { data: spaces } = await supabase.from('spaces').select('id').eq('course_id', courseId);
  const spaceIds = (spaces ?? []).map((s: any) => s.id);
  if (spaceIds.length === 0) return { window_start: start, window_end: end, notes: 0, participants: 0, build_ons: 0, ai_feedbacks: 0 };

  const [notesRes, relationsRes, feedbackRes] = await Promise.all([
    supabase.from('notes').select('author_id, is_ai_generated')
      .in('space_id', spaceIds).gte('created_at', start).lt('created_at', end).is('deleted_at', null),
    supabase.from('relations').select('id')
      .in('space_id', spaceIds).gte('created_at', start).lt('created_at', end),
    supabase.from('note_ai_feedbacks').select('id')
      .eq('course_id', courseId).gte('created_at', start).lt('created_at', end),
  ]);

  const notes = (notesRes.data ?? []).filter((n: any) => !n.is_ai_generated);
  return {
    window_start: start,
    window_end: end,
    notes: notes.length,
    participants: new Set(notes.map((n: any) => n.author_id)).size,
    build_ons: (relationsRes.data ?? []).length,
    ai_feedbacks: (feedbackRes.data ?? []).length,
  };
}

// PATCH /api/sessions/:id — 确认一次课
router.patch('/sessions/:id', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const id = paramId(req.params.id, 'id');
  const { data: session } = await supabase
    .from('course_sessions').select('*').eq('id', id).maybeSingle();
  if (!session) throw new ApiError(404, '课次不存在');
  await ensureCourseInstructor(String(session.course_id), req.user!);

  const status = String(req.body.status ?? '');
  if (!STATUSES.includes(status) || status === 'planned') {
    throw new ApiError(400, 'status 必须是 held / cancelled / rescheduled');
  }

  const patch: Record<string, unknown> = {
    status,
    note: req.body.note ? String(req.body.note).slice(0, 2000) : null,
    confirmed_by: req.user!.id,
    confirmed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (status === 'held') {
    // 实际时间可以和计划不同（推迟、提前），如实记下来
    patch.actual_date = req.body.actual_date ?? session.planned_date;
    patch.actual_start = req.body.actual_start ?? session.planned_start;
    patch.actual_minutes = Number(req.body.actual_minutes) || session.planned_minutes;
    patch.cancel_reason = null;
    patch.moved_to_date = null;
    patch.moved_to_start = null;

    const { data: course } = await supabase
      .from('courses').select('timezone').eq('id', session.course_id).single();
    const actualAt = zonedTimeToUtc(
      String(patch.actual_date), String(patch.actual_start).slice(0, 5),
      String(course?.timezone ?? 'Asia/Shanghai'),
    ).toISOString();
    patch.metrics = await computeMetrics(String(session.course_id), actualAt);
  } else if (status === 'rescheduled') {
    // 调课不是缺课：记下改到哪一天，导出时两者要能分开统计
    if (!req.body.moved_to_date) throw new ApiError(400, '调课需要填写改到哪一天');
    patch.moved_to_date = req.body.moved_to_date;
    patch.moved_to_start = req.body.moved_to_start ?? session.planned_start;
    patch.cancel_reason = null;
  } else {
    patch.cancel_reason = req.body.cancel_reason ? String(req.body.cancel_reason).slice(0, 500) : null;
  }

  const { data, error } = await supabase
    .from('course_sessions').update(patch).eq('id', id).select('*').single();
  if (error) throw new ApiError(500, error.message);
  res.json({ session: sessionToApi(data) });
});

// POST /api/sessions/:id/summary — 生成或重写这次课的 AI 教学日志
router.post('/sessions/:id/summary', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const id = paramId(req.params.id, 'id');
  const { data: session } = await supabase
    .from('course_sessions').select('*').eq('id', id).maybeSingle();
  if (!session) throw new ApiError(404, '课次不存在');
  await ensureCourseInstructor(String(session.course_id), req.user!);

  // 教师自己写的内容，直接存，不调模型
  if (typeof req.body.summary === 'string') {
    const text = req.body.summary.trim();
    const { data, error } = await supabase.from('course_sessions')
      .update({ ai_summary: text.slice(0, 8000), ai_summary_edited: true, updated_at: new Date().toISOString() })
      .eq('id', id).select('*').single();
    if (error) throw new ApiError(500, error.message);
    res.json({ session: sessionToApi(data) });
    return;
  }

  if (session.status !== 'held') throw new ApiError(400, '只有已上课的课次可以生成日志');

  const metrics = (session.metrics ?? {}) as Record<string, unknown>;
  const windowStart = String(metrics.window_start ?? session.planned_at);
  const windowEnd = String(metrics.window_end ?? session.planned_at);

  // 取当次窗口内的笔记标题，让概述有内容可依，而不是只对着几个数字发挥
  const { data: spaces } = await supabase.from('spaces').select('id').eq('course_id', session.course_id);
  const spaceIds = (spaces ?? []).map((s: any) => s.id);
  const { data: notes } = spaceIds.length
    ? await supabase.from('notes')
        .select('title, is_ai_generated')
        .in('space_id', spaceIds)
        .gte('created_at', windowStart).lt('created_at', windowEnd)
        .is('deleted_at', null)
        .limit(60)
    : { data: [] as any[] };
  const titles = (notes ?? []).filter((n: any) => !n.is_ai_generated)
    .map((n: any) => `- ${n.title}`).join('\n');

  const facts = [
    `课次：第 ${session.week_no} 周，第 ${session.session_no} 次`,
    `计划：${session.planned_date} ${String(session.planned_start).slice(0, 5)}，${session.planned_minutes} 分钟`,
    `实际：${session.actual_date} ${String(session.actual_start ?? '').slice(0, 5)}，${session.actual_minutes} 分钟`,
    `当次新增学生笔记：${metrics.notes ?? 0} 条`,
    `参与人数：${metrics.participants ?? 0} 人`,
    `Build-on 次数：${metrics.build_ons ?? 0}`,
    `AI 反馈条数：${metrics.ai_feedbacks ?? 0}`,
    session.note ? `教师备注：${session.note}` : '',
  ].filter(Boolean).join('\n');

  const result = await callCourseChat(String(session.course_id), {
    systemPrompt: [
      '你在为一位知识建构课堂的教师整理教学日志。',
      '只依据下面给出的统计与笔记标题写，不要推断没有依据的事（比如学生的情绪、理解程度）。',
      '结构：一段话概述这次课的讨论集中在哪些问题；一段话指出值得注意的地方（参与是否集中在少数人、哪些问题没人接续）。',
      '不要复述数字清单——数字教师已经看得到了。300 字以内，中文。',
    ].join('\n'),
    userMessage: `【本次课的统计】\n${facts}\n\n【本次课产生的笔记标题】\n${titles || '（无）'}`,
    maxTokens: 900,
    feature: 'teaching_log',
  });

  if (!result) throw new ApiError(503, '这门课还没有可用的 AI 服务，或调用失败。');

  const { data, error } = await supabase.from('course_sessions')
    .update({
      ai_summary: result.text,
      ai_summary_at: new Date().toISOString(),
      ai_summary_edited: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).select('*').single();
  if (error) throw new ApiError(500, error.message);

  res.json({ session: sessionToApi(data), provider: result.providerId, model: result.model });
});

export default router;
