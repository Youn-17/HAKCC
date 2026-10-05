import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 每一次反馈检查的记录（077）：一行里怎么填、写不进去不影响反馈、统计怎么算。
 */

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  error: null as null | { message: string },
  throwOnInsert: false,
}));

vi.mock('../config/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (h.throwOnInsert) throw new Error('connection refused');
        h.inserts.push({ table, row });
        return Promise.resolve({ data: null, error: h.error });
      },
    }),
  },
}));

import { checkRow, recordCheck, summarizeChecks, type CheckInput, type CheckStatRow } from './feedbackChecks';
import type { JevFeedbackCheck } from './feedbackJev';

const base: CheckInput = {
  courseId: 'c', spaceId: 's', noteId: 'n', userId: 'u', groupId: 'g',
  chain: 'editor_inline', draftLength: 120, outcome: 'silent', decidedBy: 'llm',
};

const jev = (over: Partial<JevFeedbackCheck> = {}): JevFeedbackCheck => ({
  mode: 'shadow',
  thresholds: { need: 0.5, promising: 0.7 },
  judgment: {
    needProbability: 0.81234, promisingProbability: 0.2, need: true, reason: 'gap', type: 'T3',
    typeProbabilities: { T1: 0.01, T2: 0.1, T3: 0.8, T4: 0.05, T5: 0.02, T6: 0.02 },
    typeConfidence: 0.8, orderAgreement: null,
  },
  model: 'jev-1.13.0', latencyMs: 400, inputTokens: 1400, cached: false,
  ...over,
});

beforeEach(() => {
  h.inserts.length = 0;
  h.error = null;
  h.throwOnInsert = false;
});

describe('checkRow', () => {
  it('Jev 没开：jev_mode=off，Jev 的列都为空', () => {
    const row = checkRow({ ...base, llm: { need: false, type: 'T2', provider: 'deepseek', model: 'deepseek-flash', latencyMs: 1800 } });
    expect(row).toMatchObject({ jev_mode: 'off', jev_need: null, jev_type: null, jev_error: null, llm_need: false, llm_type: 'T2', llm_latency_ms: 1800 });
  });

  it('Jev 答了：概率保留三位，阈值、版本、耗时、token 都记', () => {
    const row = checkRow({ ...base, jev: jev() });
    expect(row).toMatchObject({
      jev_mode: 'shadow', jev_need: true, jev_reason: 'gap', jev_need_p: 0.812, jev_promising_p: 0.2, jev_type: 'T3',
      jev_thresholds: { need: 0.5, promising: 0.7 }, jev_model: 'jev-1.13.0', jev_latency_ms: 400, jev_input_tokens: 1400, jev_cached: false,
    });
    expect((row.jev_type_p as Record<string, number>).T3).toBe(0.8);
  });

  it('用的缓存：不记耗时和 token（没花）', () => {
    const row = checkRow({ ...base, jev: jev({ cached: true, latencyMs: undefined, inputTokens: undefined }) });
    expect(row).toMatchObject({ jev_cached: true, jev_latency_ms: null, jev_input_tokens: null, jev_need: true });
  });

  it('Jev 出错：记错误类型，判断留空', () => {
    const row = checkRow({ ...base, jev: jev({ judgment: null, error: 'timeout', latencyMs: undefined }) });
    expect(row).toMatchObject({ jev_mode: 'shadow', jev_error: 'timeout', jev_need: null, jev_type: null, jev_type_p: null });
  });

  it('大模型调用失败：llm_need 为空，不是 false', () => {
    expect(checkRow({ ...base, outcome: 'failed', decidedBy: 'none', llm: { need: null } }).llm_need).toBeNull();
  });
});

describe('recordCheck', () => {
  it('写进 feedback_trigger_checks', async () => {
    recordCheck({ ...base, outcome: 'triggered', triggerType: 'no_evidence', feedbackId: 'fb-1' });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({ table: 'feedback_trigger_checks', row: { outcome: 'triggered', feedback_id: 'fb-1', trigger_type: 'no_evidence' } });
  });

  it('写不进去、甚至直接抛错：都不往外抛，只打日志', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.error = { message: 'permission denied' };
    expect(() => recordCheck(base)).not.toThrow();
    h.throwOnInsert = true;
    expect(() => recordCheck(base)).not.toThrow();
    await new Promise(r => setTimeout(r, 0));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('summarizeChecks', () => {
  const row = (over: Partial<CheckStatRow>): CheckStatRow => ({
    chain: 'editor_inline', outcome: 'silent', decided_by: 'llm', llm_need: false, llm_type: null,
    jev_mode: 'shadow', jev_need: false, jev_type: null, jev_error: null, jev_latency_ms: 400, jev_cached: false,
    ...over,
  });

  it('一致率和 kappa 只算编辑器里的自动检查', () => {
    const rows = [
      row({ llm_need: true, jev_need: true, llm_type: 'T3', jev_type: 'T3', outcome: 'triggered' }),
      row({ llm_need: true, jev_need: true, llm_type: 'T2', jev_type: 'T4', outcome: 'triggered' }),
      row({ llm_need: false, jev_need: false }),
      row({ llm_need: false, jev_need: false }),
      row({ llm_need: true, jev_need: false, outcome: 'triggered' }),
      row({ llm_need: false, jev_need: true }),
      // 学生主动要的：大模型被要求一定给，不算
      row({ chain: 'editor_request', llm_need: true, jev_need: false, outcome: 'triggered' }),
    ];
    const s = summarizeChecks(rows);
    expect(s.total).toBe(7);
    expect(s.triggered).toBe(4);
    expect(s.jev.need).toMatchObject({ compared: 6, agree: 4, agreement: 0.667, llmOnly: 1, jevOnly: 1 });
    // po = 4/6，两边各 3/6 说要：pe = 0.5，kappa = (0.667 - 0.5) / 0.5
    expect(s.jev.need.kappa).toBeCloseTo(0.333, 3);
    expect(s.jev.type).toEqual({ compared: 2, agree: 1 });
  });

  it('两边全说同一个答案：kappa 算不出来，给 null', () => {
    const s = summarizeChecks([row({}), row({})]);
    expect(s.jev.need.agreement).toBe(1);
    expect(s.jev.need.kappa).toBeNull();
  });

  it('Jev 调用数、缓存、错误、平均耗时（不算缓存和出错的）', () => {
    const s = summarizeChecks([
      row({ jev_latency_ms: 300 }),
      row({ jev_latency_ms: 500 }),
      row({ jev_cached: true, jev_latency_ms: null }),
      row({ jev_error: 'timeout', jev_need: null, jev_latency_ms: null }),
      row({ jev_mode: 'off', jev_need: null, jev_latency_ms: null }),
    ]);
    expect(s.jev).toMatchObject({ checks: 4, calls: 3, cached: 1, errors: 1, errorKinds: { timeout: 1 }, avgLatencyMs: 400 });
    expect(s.byDecider).toEqual({ llm: 5 });
  });

  it('没有记录：都是 0，比率为 null', () => {
    const s = summarizeChecks([]);
    expect(s).toMatchObject({ total: 0, triggered: 0, jev: { checks: 0, avgLatencyMs: null, need: { compared: 0, agreement: null, kappa: null } } });
  });
});
