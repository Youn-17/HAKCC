import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { decryptProviderApiKey } from '../services/aiProviderConfig';
import { isDmxProvider, orderConfigsByHealth, pickModel, pickNativeModel, reportProviderFailure, reportProviderSuccess } from '../services/modelRouter';
import { writeLessonPrepMemory } from '../services/teacherMemoryService';
import {
  choiceModelFor,
  featureChoice,
  getAiFeature,
  preferChoice,
  sortByOrder,
  type CourseAiRow,
} from '../services/aiFeatureModels';
import {
  startRun, transitionRun, failRun, recordEffect, createCheckpoint,
} from '../services/agentLifecycle';
import {
  generateLessonPlanStream,
  exportLessonPlanToWord,
  type PlanType,
  type LessonPlanContent,
} from '../services/lessonPlanService';

const router = Router();

const VALID_PLAN_TYPES = new Set<PlanType>(['full_plan', 'resources', 'activities', 'analysis', 'inquiry_activity']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireCourseMembership(courseId: string, req: Request): Promise<string> {
  const userId = req.user!.id;
  if (req.user!.role === 'admin') return 'admin';

  // course_members.role (migration 034) marks a co-teacher; the global
  // users.role must not stand in for it, or any teacher account that joined
  // the course counts as one of its instructors.
  const [memberRes, instructorRes] = await Promise.all([
    supabase
      .from('course_members')
      .select('role')
      .eq('course_id', courseId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('courses')
      .select('id')
      .eq('id', courseId)
      .eq('instructor_id', userId)
      .maybeSingle(),
  ]);

  if (instructorRes.data) return 'teacher';
  if (memberRes.data) {
    const memberRole = (memberRes.data as { role?: string }).role;
    return memberRole === 'teacher' || memberRole === 'admin' ? 'teacher' : 'student';
  }
  throw new ApiError(403, 'Not a member of this course');
}

async function requireTeacherRole(courseId: string, req: Request) {
  const role = await requireCourseMembership(courseId, req);
  if (role !== 'teacher' && role !== 'admin') {
    throw new ApiError(403, 'Teacher role required');
  }
}

// 备课助手统一先走 DeepSeek（2026-09-10 定），失败再退到其它家。顺序在 aiFeatureModels 的
// 「教师的 AI 对话、备课、学情分析、教学评估」那一项里；课程 AI 设置给它指定了模型时，那个排第一。
// 顺序里没有 tavily：它只做搜索，不会出现在候选里（没有 enabled_models）。

interface ProviderCandidate {
  apiKey: string;
  endpointUrl: string | null;
  resolvedProviderId: string;
  resolvedModel: string;
}

/**
 * 按优先级列出这门课所有能用的供应商。
 *
 * 原来只取第一家，那家一失败教师就只能看到一句报错重来。现在整列返回，
 * 生成端在「还没吐出任何字」的时候可以顺着往下换。
 */
async function resolveProviderCandidates(
  courseId: string,
  providerId: string,
  model: string,
): Promise<ProviderCandidate[]> {
  let query = supabase
    .from('teacher_ai_configs')
    .select('provider_id, api_key_encrypted, endpoint_url, enabled_models, configured_at, trigger_settings')
    .eq('course_id', courseId)
    .not('api_key_encrypted', 'is', null);
  if (providerId !== 'auto') {
    query = query.eq('provider_id', providerId);
  }
  const { data: configs } = await query;
  const rows = (configs ?? []) as CourseAiRow[];
  let available = rows.filter((c: any) =>
    c.api_key_encrypted && c.provider_id !== 'tavily' && Array.isArray(c.enabled_models) && c.enabled_models.length > 0);

  if (available.length === 0) {
    throw new ApiError(404, `No AI provider configured for this course`);
  }

  const choice = providerId === 'auto' ? featureChoice('teacher_agents', rows) : null;
  if (providerId === 'auto' && available.length > 1) {
    available = orderConfigsByHealth(preferChoice(sortByOrder(available, getAiFeature('teacher_agents').order), choice));
  }

  const candidates: ProviderCandidate[] = [];
  for (const config of available) {
    const pid = config.provider_id as string;
    let apiKey: string;
    try {
      apiKey = decryptProviderApiKey(config.api_key_encrypted as string);
    } catch {
      continue;
    }
    // 「自动」时：DMX 走任务分档，原厂 key 取它目录里排最前的那个（DeepSeek 就是 deepseek-flash）。
    // 教师手选了模型就照手选的来。
    const resolvedModel = model === 'auto'
      ? (choiceModelFor(choice, pid)
        ?? (isDmxProvider(pid) ? pickModel('chat') : (pickNativeModel(pid, config.enabled_models as string[]) ?? String((config.enabled_models as string[])[0]))))
      : model;
    candidates.push({
      apiKey,
      endpointUrl: (config.endpoint_url as string) ?? null,
      resolvedProviderId: pid,
      resolvedModel,
    });
  }
  if (candidates.length === 0) throw new ApiError(500, 'AI provider key could not be decrypted');
  return candidates;
}

// ---------------------------------------------------------------------------
// POST /lesson-plans/:courseId/generate — SSE streaming generation
// ---------------------------------------------------------------------------

router.post('/lesson-plans/:courseId/generate', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacherRole(courseId, req);

  const {
    plan_type, topic, duration_minutes, kb_principles,
    context_notes, provider_id, model, space_id, course_title,
  } = req.body as {
    plan_type?: string;
    topic?: string;
    duration_minutes?: number;
    kb_principles?: string[];
    context_notes?: string;
    provider_id?: string;
    model?: string;
    space_id?: string;
    course_title?: string;
  };

  if (!provider_id || !model) throw new ApiError(400, 'provider_id and model are required');

  const planType = (plan_type ?? 'full_plan') as PlanType;
  if (!VALID_PLAN_TYPES.has(planType)) throw new ApiError(400, 'Invalid plan_type');

  const duration = Math.min(Math.max(duration_minutes ?? 45, 5), 300);

  const candidates = await resolveProviderCandidates(courseId, provider_id, model);
  let { apiKey, endpointUrl, resolvedProviderId, resolvedModel } = candidates[0];

  // ── Lifecycle: Plan phase ──
  const agentRun = await startRun({
    userId: req.user!.id,
    courseId,
    agentType: 'lesson_prep',
    title: topic ?? course_title ?? 'Lesson Plan',
    input: { plan_type: planType, topic, duration, kb_principles, provider: resolvedProviderId, model: resolvedModel },
  });
  await recordEffect({ runId: agentRun.id, effectType: 'plan_validated', payload: { planType, duration } });

  const title = topic
    ? `${topic} — ${planType}`
    : `${course_title ?? 'Lesson Plan'} — ${planType}`;

  const { data: planRow, error: insertErr } = await supabase
    .from('lesson_plans')
    .insert({
      course_id: courseId,
      space_id: space_id ?? null,
      created_by: req.user!.id,
      title,
      plan_type: planType,
      topic: topic ?? null,
      duration_minutes: duration,
      kb_principles: kb_principles ?? [],
      context_notes: context_notes ?? null,
      status: 'generating',
      provider_id: resolvedProviderId,
      model: resolvedModel,
    })
    .select('id')
    .single();

  if (insertErr) throw new ApiError(500, insertErr.message);
  const planId = planRow.id;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send the plan ID + run ID so the frontend can track lifecycle
  res.write(`data: ${JSON.stringify({ type: 'plan_created', planId, runId: agentRun.id })}\n\n`);

  let finalContent: LessonPlanContent | null = null;
  let classroomCtx: unknown = null;

  try {
    // ── Lifecycle: Gather phase ──
    await transitionRun(agentRun.id, 'gathering');

    for (let attempt = 0; attempt < candidates.length; attempt++) {
      if (attempt > 0) {
        ({ apiKey, endpointUrl, resolvedProviderId, resolvedModel } = candidates[attempt]);
        console.warn(`[lessonPlans] switching to ${resolvedProviderId}/${resolvedModel} (attempt ${attempt})`);
        res.write(`data: ${JSON.stringify({ type: 'provider_switch', provider: resolvedProviderId, model: resolvedModel })}\n\n`);
      }

      const stream = generateLessonPlanStream({
        courseId,
        spaceId: space_id,
        planType,
        topic,
        durationMinutes: duration,
        kbPrinciples: kb_principles ?? [],
        contextNotes: context_notes,
        providerId: resolvedProviderId,
        model: resolvedModel,
        apiKey,
        endpointUrl,
        lang: 'zh',
        courseTitle: course_title ?? 'Knowledge Building Course',
        userId: req.user!.id,
      });

      let tokenCount = 0;
      let failedBeforeOutput: string | null = null;

      for await (const event of stream) {
        switch (event.type) {
          case 'context_ready':
            classroomCtx = event.context;
            if (attempt === 0) {
              // ── Lifecycle: context gathered ──
              await recordEffect({ runId: agentRun.id, effectType: 'context_gathered', payload: {
                notes_count: (event.context as any)?.recentNotes?.length ?? 0,
                triggers_count: (event.context as any)?.triggers?.length ?? 0,
              }});
              await transitionRun(agentRun.id, 'executing');
              res.write(`data: ${JSON.stringify({ type: 'context_ready', context: event.context })}\n\n`);
            }
            await recordEffect({ runId: agentRun.id, effectType: 'llm_started', payload: {
              provider: resolvedProviderId, model: resolvedModel, attempt,
            }});
            break;
          case 'token':
            tokenCount++;
            res.write(`data: ${JSON.stringify({ type: 'token', content: event.content })}\n\n`);
            break;
          case 'done':
            finalContent = event.plan;
            await recordEffect({ runId: agentRun.id, effectType: 'llm_completed', payload: {
              tokens: tokenCount, sections: Object.keys(event.plan ?? {}), provider: resolvedProviderId, model: resolvedModel,
            }});
            res.write(`data: ${JSON.stringify({ type: 'done', plan: event.plan, planId, runId: agentRun.id })}\n\n`);
            break;
          case 'error':
            await recordEffect({ runId: agentRun.id, effectType: 'llm_error', payload: { error: event.error, provider: resolvedProviderId, model: resolvedModel } });
            // 一个字都没出来就失败（429 / 5xx / 断连），换下一家重来；已经出了字的失败原样报给前端。
            if (tokenCount === 0 && attempt < candidates.length - 1) {
              failedBeforeOutput = event.error;
            } else {
              res.write(`data: ${JSON.stringify({ type: 'error', error: event.error })}\n\n`);
            }
            break;
        }
        if (failedBeforeOutput) break;
      }

      if (failedBeforeOutput) {
        const rateish = /\b(429|5\d\d|overloaded|rate.?limit|too many|timeout|abort)/i.test(failedBeforeOutput);
        if (!isDmxProvider(resolvedProviderId)) {
          reportProviderFailure(resolvedProviderId, rateish ? 'rate_limit' : 'other');
        }
        console.warn(`[lessonPlans] ${resolvedProviderId}/${resolvedModel} failed before output: ${failedBeforeOutput}`);
        continue;
      }
      if (finalContent && !isDmxProvider(resolvedProviderId)) reportProviderSuccess(resolvedProviderId);
      break;
    }

    // Persist the result
    if (finalContent) {
      // ── Lifecycle: transition to Review ──
      await transitionRun(agentRun.id, 'reviewing', {
        output: finalContent as unknown as Record<string, unknown>,
        contextSnapshot: (classroomCtx ?? {}) as Record<string, unknown>,
      });
      // Create auto-checkpoint so teacher can rollback to original generation
      await createCheckpoint({
        runId: agentRun.id,
        name: 'generated',
        snapshot: finalContent as unknown as Record<string, unknown>,
      });

      await supabase
        .from('lesson_plans')
        .update({
          content: finalContent,
          classroom_context: classroomCtx ?? {},
          status: 'completed',
          provider_id: resolvedProviderId,
          model: resolvedModel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', planId);

      // Auto-write cross-module memory
      writeLessonPrepMemory({
        userId: req.user!.id,
        courseId,
        title,
        planType,
        topic: topic ?? null,
        kbPrinciples: kb_principles,
      }).catch(() => {});

      await recordEffect({ runId: agentRun.id, effectType: 'plan_persisted', payload: { planId } });
    } else {
      await failRun(agentRun.id, 'No content generated');
      await supabase
        .from('lesson_plans')
        .update({ status: 'error', updated_at: new Date().toISOString() })
        .eq('id', planId);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Stream error';
    await failRun(agentRun.id, msg).catch(() => {});
    res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`);
    await supabase
      .from('lesson_plans')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', planId);
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

// ---------------------------------------------------------------------------
// GET /lesson-plans/:courseId — list saved plans
// ---------------------------------------------------------------------------

router.get('/lesson-plans/:courseId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMembership(courseId, req);

  const { data, error } = await supabase
    .from('lesson_plans')
    .select('id, title, plan_type, topic, duration_minutes, kb_principles, status, version, created_at, updated_at')
    .eq('course_id', courseId)
    .eq('created_by', req.user!.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new ApiError(500, error.message);
  res.json({ plans: data ?? [] });
});

// ---------------------------------------------------------------------------
// GET /lesson-plans/:courseId/:planId — single plan
// ---------------------------------------------------------------------------

router.get('/lesson-plans/:courseId/:planId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMembership(courseId, req);

  const { data, error } = await supabase
    .from('lesson_plans')
    .select('*')
    .eq('id', req.params.planId)
    .eq('course_id', courseId)
    .eq('created_by', req.user!.id)
    .single();

  if (error || !data) throw new ApiError(404, 'Plan not found');
  res.json({ plan: data });
});

// ---------------------------------------------------------------------------
// PUT /lesson-plans/:courseId/:planId — update plan content
// ---------------------------------------------------------------------------

router.put('/lesson-plans/:courseId/:planId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacherRole(courseId, req);

  const { title, content, status } = req.body as {
    title?: string;
    content?: LessonPlanContent;
    status?: string;
  };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (status !== undefined) updates.status = status;

  const { data, error } = await supabase
    .from('lesson_plans')
    .update(updates)
    .eq('id', req.params.planId)
    .eq('course_id', courseId)
    .eq('created_by', req.user!.id)
    .select('*')
    .single();

  if (error || !data) throw new ApiError(404, 'Plan not found or update failed');
  res.json({ plan: data });
});

// ---------------------------------------------------------------------------
// DELETE /lesson-plans/:courseId/:planId
// ---------------------------------------------------------------------------

router.delete('/lesson-plans/:courseId/:planId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacherRole(courseId, req);

  const { error } = await supabase
    .from('lesson_plans')
    .delete()
    .eq('id', req.params.planId)
    .eq('course_id', courseId)
    .eq('created_by', req.user!.id);

  if (error) throw new ApiError(500, error.message);
  res.json({ message: 'Deleted' });
});

// ---------------------------------------------------------------------------
// POST /lesson-plans/:courseId/:planId/export — Word document export
// ---------------------------------------------------------------------------

router.post('/lesson-plans/:courseId/:planId/export', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMembership(courseId, req);

  const { data: plan, error } = await supabase
    .from('lesson_plans')
    .select('title, content, topic, duration_minutes')
    .eq('id', req.params.planId)
    .eq('course_id', courseId)
    .eq('created_by', req.user!.id)
    .single();

  if (error || !plan) throw new ApiError(404, 'Plan not found');

  const lang = (req.body.lang as 'zh' | 'en') ?? 'zh';
  const result = await exportLessonPlanToWord(
    {
      title: plan.title as string,
      content: plan.content as LessonPlanContent,
      topic: plan.topic as string | null,
      duration_minutes: plan.duration_minutes as number,
    },
    lang,
  );

  res.json({
    fileId: result.fileId,
    fileName: result.fileName,
    // 文件路由是 /api/files/:fileId（带 ?name= 决定下载文件名），以前这里多写了 /download，404。
    downloadUrl: `/api/files/${result.fileId}?name=${encodeURIComponent(result.fileName)}`,
  });
});

export default router;
