/**
 * Group-level experiment condition resolution for the AI auto-feedback
 * cluster-randomized trial.
 *
 * Assignment unit is the GROUP (groups.ai_feedback_condition):
 *   'treatment' → proactive AI feedback chains run as configured
 *   'control'   → proactive chains suppressed; rule-based detection still
 *                 runs and is shadow-logged (ai_interventions.suppressed)
 *   NULL        → group not in an experiment: course-level settings apply
 *
 * Free-form AI chat the student opens (note conversations, personal agent)
 * stays ungated — both arms keep on-demand AI. The note editor's "request
 * feedback" button (POST /notes/:id/ai-feedback/request) IS gated like the
 * proactive chain since 2026-09-28: it yields the same T1–T6 feedback card
 * and AI scaffold, so leaving it open handed control students the
 * manipulated intervention on demand. Its shadow rows carry
 * chain='editor_request' to stay separable from 'editor_inline'.
 *
 * Precedence: individual override (course_members.ai_feedback_condition)
 * beats the group's condition. If a student belongs to several groups, the
 * earliest-joined group with an explicit condition wins (deterministic).
 * With neither set, the base condition is NULL — which resolves to 'control'
 * when the course's experiment_mode is on (allowlist semantics: only
 * explicitly assigned treatment students receive proactive feedback), and to
 * course-default behavior otherwise.
 */

import { supabase } from '../config/supabase';

export type ExperimentCondition = 'treatment' | 'control' | null;

export interface ConditionResult {
  condition: ExperimentCondition;
  groupId: string | null;
}

const NO_CONDITION: ConditionResult = { condition: null, groupId: null };

// Condition flips are rare (once, at randomization); a short TTL keeps the
// hot path at zero DB cost without meaningfully delaying reassignment.
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 5000;
const cache = new Map<string, { value: ConditionResult; expires: number }>();

export async function resolveUserCondition(
  courseId: string,
  userId: string,
): Promise<ConditionResult> {
  const key = `${courseId}:${userId}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const [memberRes, groupRes] = await Promise.all([
    supabase
      .from('course_members')
      .select('ai_feedback_condition')
      .eq('course_id', courseId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('group_members')
      .select('group_id, joined_at, groups!inner(id, course_id, ai_feedback_condition)')
      .eq('user_id', userId)
      .eq('groups.course_id', courseId)
      .order('joined_at', { ascending: true }),
  ]);

  // Fail open to course-level behavior: a transient DB error must never
  // block feedback delivery, and we don't cache the failure.
  if (memberRes.error || groupRes.error) return NO_CONDITION;

  let result: ConditionResult = NO_CONDITION;
  for (const row of groupRes.data ?? []) {
    const group = row.groups as unknown as { id: string; ai_feedback_condition: string | null };
    if (!result.groupId) result = { condition: null, groupId: group.id };
    if (group.ai_feedback_condition === 'treatment' || group.ai_feedback_condition === 'control') {
      result = { condition: group.ai_feedback_condition, groupId: group.id };
      break;
    }
  }

  // Individual override wins over the group's condition; groupId is kept
  // for per-cluster analysis regardless of which layer decided.
  const individual = memberRes.data?.ai_feedback_condition;
  if (individual === 'treatment' || individual === 'control') {
    result = { condition: individual, groupId: result.groupId };
  }

  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(key, { value: result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}

// ── Course experiment mode ─────────────────────────────────────────────────
// When trigger_settings.experiment_mode is true for a course:
//  - an unassigned student defaults to 'control' (allowlist semantics)
//  - proactive AI delivery is limited to group-bound spaces
//  - students may create new notes only in group-bound spaces

const modeCache = new Map<string, { value: boolean; expires: number }>();

export async function fetchExperimentMode(courseId: string): Promise<boolean> {
  const hit = modeCache.get(courseId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const { data, error } = await supabase
    .from('teacher_ai_configs')
    .select('trigger_settings, configured_at')
    .eq('course_id', courseId)
    .order('configured_at', { ascending: false });
  if (error) return false;

  const row = (data ?? []).find(
    (r: Record<string, unknown>) => r.trigger_settings && Object.keys(r.trigger_settings as object).length > 0,
  );
  const value = (row?.trigger_settings as Record<string, unknown> | undefined)?.experiment_mode === true;

  if (modeCache.size >= MAX_CACHE_ENTRIES) modeCache.clear();
  modeCache.set(courseId, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

export interface EffectiveCondition {
  condition: ExperimentCondition;
  groupId: string | null;
  experimentMode: boolean;
}

/** Condition with the experiment-mode default applied (null → control when mode is on). */
export async function resolveEffectiveCondition(
  courseId: string,
  userId: string,
): Promise<EffectiveCondition> {
  const [base, experimentMode] = await Promise.all([
    resolveUserCondition(courseId, userId),
    fetchExperimentMode(courseId),
  ]);
  return {
    condition: base.condition ?? (experimentMode ? 'control' : null),
    groupId: base.groupId,
    experimentMode,
  };
}

/** Call when conditions, membership, or experiment mode change so gating updates promptly. */
export function invalidateConditionCache(): void {
  cache.clear();
  modeCache.clear();
}

/**
 * Shadow log: record that a proactive intervention WOULD have fired for a
 * control-group student. Nothing is delivered; the row (suppressed = true)
 * gives the analysis a counterfactual denominator per cluster.
 */
export async function logSuppressedIntervention(params: {
  spaceId: string;
  noteId: string;
  userId: string;
  groupId: string | null;
  triggerType: string;
  triggerContext: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from('ai_interventions').insert({
    space_id: params.spaceId,
    note_id: params.noteId,
    user_id: params.userId,
    group_id: params.groupId,
    trigger_type: params.triggerType,
    trigger_context: { ...params.triggerContext, condition: 'control' },
    visibility_scope: 'private',
    suppressed: true,
  });
  if (error) {
    console.error('[Experiment] Failed to write shadow log:', error.message);
  }
}
