/**
 * Trigger Routes — AI intervention trigger detection and management
 *
 * Endpoints:
 *   GET  /api/spaces/:spaceId/triggers/history — Past interventions
 *   GET  /api/triggers/stats?course_id=…      — Per-group delivered/suppressed counts (editor_inline chain only),
 *                                               plus every feedback check: trigger rate and LLM–Jev agreement
 *   GET  /api/notes/:noteId/ai-context        — Build AI context for a note
 *
 * 2026-09-10 删除了 GET /spaces/:id/triggers（全空间规则检测并落 ai_interventions）与
 * POST /triggers/:id/respond。那是第三条 AI 反馈链路：详情面板有卡、编辑器里没有，
 * 且不经学生采纳就写研究数据。规则引擎 triggerEngine 本身保留，供教师端备课与智能体工具使用。
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { buildContext } from '../services/triggerEngine';
import { ensureNoteAccess, ensureSpaceAccess, ensureCourseInstructor, isCourseStaff } from '../services/accessControl';
import { summarizeChecks, type CheckStatRow } from '../services/feedbackChecks';
import { jevConfig } from '../config/jev';

/** 统计只看最近这么多次检查：一门课一学期几千次，够算一致率，又不至于一次拉太多 */
const CHECK_STATS_LIMIT = 5000;

const router = Router();

// GET /api/spaces/:spaceId/triggers/history — past AI interventions
router.get(
  '/spaces/:spaceId/triggers/history',
  verifyJWT,
  async (req: Request, res: Response) => {
    const { spaceId } = req.params;
    const space = await ensureSpaceAccess(String(spaceId), req.user!);
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    // Participants must never see suppressed (control-group shadow) rows —
    // that would unblind their experiment condition. Only course staff do;
    // a teacher account that joined with the student code is a participant.
    let query = supabase
      .from('ai_interventions')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!isCourseStaff(space.standing)) {
      query = query.eq('suppressed', false);
    }
    const { data, error } = await query;

    if (error) throw new ApiError(500, error.message);
    res.json({ interventions: data ?? [] });
  },
);

// GET /api/triggers/stats?course_id=… — 每组的 AI 反馈投放/抑制计数（教师）。
// 数据源是 ai_interventions，编辑器内反馈链路会写入其中。
router.get('/triggers/stats', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = typeof req.query.course_id === 'string' ? req.query.course_id : null;
  if (!courseId) {
    // 进程内计数器随自动发布链路一起去掉了；投放/抑制的事实都在 ai_interventions 里，
    // 按课程查才有意义，所以这里不再返回一个全局数字。
    throw new ApiError(400, 'course_id is required');
  }
  // The per-course branch returns each group's ai_feedback_condition — the
  // arm assignment of a running cluster-randomised study. Unchecked, any
  // teacher could read (and thereby unblind) another course's experiment.
  await ensureCourseInstructor(courseId, req.user!);

  const [{ data: groups }, { data: spaces }] = await Promise.all([
    supabase.from('groups').select('id, name, ai_feedback_condition').eq('course_id', courseId),
    supabase.from('spaces').select('id').eq('course_id', courseId),
  ]);
  const spaceIds = (spaces ?? []).map(s => s.id);

  let interventions: Array<{ group_id: string | null; suppressed: boolean; trigger_type: string }> = [];
  if (spaceIds.length > 0) {
    const { data } = await supabase
      .from('ai_interventions')
      .select('group_id, suppressed, trigger_type')
      .in('space_id', spaceIds)
      // 只算学生真正会看到的那条链路。全空间规则检测（space_t1t6）曾写了近百行，
      // 学生从没把它当反馈见过，混进来会把「投放」数撑大好几倍。
      .eq('trigger_context->>chain', 'editor_inline');
    interventions = (data ?? []) as typeof interventions;
  }

  const byGroup = (groups ?? []).map(g => {
    const rows = interventions.filter(i => i.group_id === g.id);
    return {
      group_id: g.id,
      name: g.name,
      condition: g.ai_feedback_condition ?? null,
      delivered: rows.filter(r => !r.suppressed).length,
      suppressed: rows.filter(r => r.suppressed).length,
    };
  });
  const unassigned = interventions.filter(i => !i.group_id);

  // 每一次检查（077 起）：触发率，以及 Jev 陪跑时和大模型一致不一致
  const { data: checkRows } = await supabase
    .from('feedback_trigger_checks')
    .select('chain, outcome, decided_by, llm_need, llm_type, jev_mode, jev_need, jev_type, jev_error, jev_latency_ms, jev_cached')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
    .limit(CHECK_STATS_LIMIT);
  const config = jevConfig();

  res.json({
    experiment: {
      groups: byGroup,
      unassigned: { delivered: unassigned.filter(r => !r.suppressed).length, suppressed: unassigned.filter(r => r.suppressed).length },
    },
    checks: {
      ...summarizeChecks((checkRows ?? []) as CheckStatRow[]),
      window: CHECK_STATS_LIMIT,
      jevSetting: {
        mode: config.feedbackMode,
        model: config.model,
        thresholds: { need: config.needThreshold, promising: config.promisingThreshold },
      },
    },
  });
});

// GET /api/notes/:noteId/ai-context — build AI context for a note
router.get('/notes/:noteId/ai-context', verifyJWT, async (req: Request, res: Response) => {
  const noteId = req.params.noteId as string;
  await ensureNoteAccess(noteId, req.user!);

  const context = await buildContext(noteId);
  res.json({ context });
});


export default router;
