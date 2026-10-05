import { supabase } from '../config/supabase';
import type { JevFeedbackCheck } from './feedbackJev';

/**
 * AI 自动反馈每一次检查的记录（feedback_trigger_checks，迁移 077）。
 *
 * 走到判断这一步的检查都记一行：大模型怎么判、Jev 怎么判、谁做的决定、结果是什么。
 * 以前只有出了反馈才有记录，算不出触发率，也比不了两边一致不一致。
 * 写库不等：学生的请求不为一条日志多等一次往返（库在爱尔兰，一次约 0.3 秒）。
 */

export type CheckChain = 'editor_inline' | 'editor_request' | 'teacher_batch';
export type CheckOutcome = 'triggered' | 'silent' | 'type_disabled' | 'llm_declined' | 'failed';
export type CheckDecider = 'llm' | 'jev' | 'regex_fallback' | 'none';

export interface LlmPart {
  /** null = 没调或调用失败 */
  need: boolean | null;
  /** T1–T6 */
  type?: string | null;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
}

export interface CheckInput {
  courseId: string;
  spaceId: string;
  noteId: string;
  userId: string;
  groupId?: string | null;
  chain: CheckChain;
  draftLength: number;
  outcome: CheckOutcome;
  decidedBy: CheckDecider;
  /** 出了反馈时的类型（note_ai_feedbacks.trigger_type 的写法） */
  triggerType?: string | null;
  feedbackId?: string | null;
  llm?: LlmPart | null;
  jev?: JevFeedbackCheck | null;
}

const round3 = (value: number | null | undefined) => (value == null ? null : Math.round(value * 1000) / 1000);

export function checkRow(input: CheckInput): Record<string, unknown> {
  const jev = input.jev ?? null;
  const judgment = jev?.judgment ?? null;
  return {
    course_id: input.courseId,
    space_id: input.spaceId,
    note_id: input.noteId,
    user_id: input.userId,
    group_id: input.groupId ?? null,
    chain: input.chain,
    draft_length: input.draftLength,
    outcome: input.outcome,
    decided_by: input.decidedBy,
    trigger_type: input.triggerType ?? null,
    feedback_id: input.feedbackId ?? null,
    llm_need: input.llm?.need ?? null,
    llm_type: input.llm?.type || null,
    llm_provider: input.llm?.provider ?? null,
    llm_model: input.llm?.model ?? null,
    llm_latency_ms: input.llm?.latencyMs ?? null,
    jev_mode: jev?.mode ?? 'off',
    jev_need: judgment ? judgment.need : null,
    jev_reason: judgment?.reason ?? null,
    jev_need_p: round3(judgment?.needProbability),
    jev_promising_p: round3(judgment?.promisingProbability),
    jev_type: judgment?.type ?? null,
    jev_type_p: judgment ? Object.fromEntries(Object.entries(judgment.typeProbabilities).map(([k, v]) => [k, round3(v)])) : null,
    jev_thresholds: jev?.thresholds ?? null,
    jev_model: jev?.model ?? null,
    jev_latency_ms: jev && !jev.cached ? jev.latencyMs ?? null : null,
    jev_input_tokens: jev && !jev.cached ? jev.inputTokens ?? null : null,
    jev_cached: jev ? jev.cached : null,
    jev_error: jev?.error ?? null,
  };
}

/** 记一行，不等结果；写不进去只打一条日志，不影响反馈本身 */
export function recordCheck(input: CheckInput): void {
  try {
    void Promise.resolve(supabase.from('feedback_trigger_checks').insert(checkRow(input)))
      .then(result => {
        const error = (result as { error?: { message?: string } | null } | undefined)?.error;
        if (error) console.warn('[feedback-checks] 记录失败：', error.message);
      })
      .catch((err: unknown) => console.warn('[feedback-checks] 记录失败：', err instanceof Error ? err.message : err));
  } catch (err) {
    console.warn('[feedback-checks] 记录失败：', err instanceof Error ? err.message : err);
  }
}

// ── 统计（/api/triggers/stats） ─────────────────────────────

export interface CheckStatRow {
  chain: string;
  outcome: string;
  decided_by: string;
  llm_need: boolean | null;
  llm_type: string | null;
  jev_mode: string | null;
  jev_need: boolean | null;
  jev_type: string | null;
  jev_error: string | null;
  jev_latency_ms: number | null;
  jev_cached: boolean | null;
}

/**
 * 一致率只算编辑器里的自动检查：学生主动要的那条大模型被要求一定给反馈，
 * 教师批量又要求放宽，两条都不是在判断「要不要」。
 * kappa 是二分类的 Cohen's kappa；两边全说同一个答案时分母为 0，给 null。
 */
export function summarizeChecks(rows: readonly CheckStatRow[]) {
  const byChain: Record<string, number> = {};
  const byDecider: Record<string, number> = {};
  for (const row of rows) {
    byChain[row.chain] = (byChain[row.chain] ?? 0) + 1;
    byDecider[row.decided_by] = (byDecider[row.decided_by] ?? 0) + 1;
  }

  const jevRows = rows.filter(r => r.jev_mode && r.jev_mode !== 'off');
  const errors: Record<string, number> = {};
  for (const row of jevRows) if (row.jev_error) errors[row.jev_error] = (errors[row.jev_error] ?? 0) + 1;
  const timed = jevRows.filter(r => !r.jev_cached && !r.jev_error && typeof r.jev_latency_ms === 'number');
  const avgLatencyMs = timed.length ? Math.round(timed.reduce((sum, r) => sum + (r.jev_latency_ms as number), 0) / timed.length) : null;

  const compared = rows.filter(r => r.chain === 'editor_inline' && r.llm_need != null && r.jev_need != null);
  const agree = compared.filter(r => r.llm_need === r.jev_need).length;
  let kappa: number | null = null;
  if (compared.length > 0) {
    const n = compared.length;
    const llmYes = compared.filter(r => r.llm_need).length / n;
    const jevYes = compared.filter(r => r.jev_need).length / n;
    const expected = llmYes * jevYes + (1 - llmYes) * (1 - jevYes);
    if (expected < 1) kappa = Math.round(((agree / n - expected) / (1 - expected)) * 1000) / 1000;
  }
  const bothYes = compared.filter(r => r.llm_need && r.jev_need && r.llm_type && r.jev_type);

  return {
    total: rows.length,
    triggered: rows.filter(r => r.outcome === 'triggered').length,
    byChain,
    byDecider,
    jev: {
      checks: jevRows.length,
      calls: jevRows.filter(r => !r.jev_cached).length,
      cached: jevRows.filter(r => r.jev_cached).length,
      errors: jevRows.filter(r => r.jev_error).length,
      errorKinds: errors,
      avgLatencyMs,
      need: {
        compared: compared.length,
        agree,
        agreement: compared.length ? Math.round((agree / compared.length) * 1000) / 1000 : null,
        kappa,
        llmOnly: compared.filter(r => r.llm_need && !r.jev_need).length,
        jevOnly: compared.filter(r => !r.llm_need && r.jev_need).length,
      },
      type: {
        compared: bothYes.length,
        agree: bothYes.filter(r => r.llm_type === r.jev_type).length,
      },
    },
  };
}
