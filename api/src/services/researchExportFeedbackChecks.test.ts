import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 研究导出里的「AI 反馈检查记录」（feedback_trigger_checks，2026-10-05）。
 * 跑真的 buildAllDatasets，只替换数据库：没给数据的表一律当空表。
 */

const h = vi.hoisted(() => {
  const fixtures: Record<string, unknown[]> = {};
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  // 链式调用照单全收；await / single / maybeSingle 时按表名给数据
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: fixtures[table] ?? [], error: null, count: (fixtures[table] ?? []).length });
    const proxy: unknown = new Proxy({}, {
      get(_target, prop: string) {
        if (prop === 'then') return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => result().then(ok, fail);
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => Promise.resolve({ data: (fixtures[table] ?? [])[0] ?? null, error: null });
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: prop, args });
          return proxy;
        };
      },
    });
    return proxy;
  };
  return { fixtures, calls, from };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));

import { buildAllDatasets, buildReadme, DATASET_COLUMNS, DATASET_KEYS, DATASET_LABELS, type ExportScope } from './researchExport';
import type { ParticipantIdentity } from './participantCode';

const person = (userId: string, code: string, name: string, isTeacher = false): [string, ParticipantIdentity] =>
  [userId, { userId, code, name, email: '', role: isTeacher ? 'teacher' : 'student', isTeacher }];

function scope(over: Partial<ExportScope> = {}): ExportScope {
  return {
    courseId: 'course-1',
    filters: {},
    tz: 8,
    englishName: 'AI and Learning',
    abbr: 'AL',
    identities: new Map([person('s1', 'SAL01', '林晓'), person('s2', 'SAL02', '周子涵'), person('t1', 'TAL01', '刘老师', true)]),
    spaceIds: ['space-1'],
    spaceById: new Map([['space-1', { id: 'space-1', title: '第 3 周', group_id: null }]]),
    groupById: new Map([['g1', { id: 'g1', name: '一组', condition: 'treatment' }]]),
    groupOfUser: new Map([['s1', 'g1'], ['s2', 'g1']]),
    overrideOfUser: new Map(),
    participantScope: null,
    courseStartMs: Date.parse('2026-09-14T00:00:00Z'),
    ...over,
  };
}

const note = (id: string, authorId: string, title: string) => ({
  id, space_id: 'space-1', author_id: authorId, type: 'note', title, content: '<p>正文</p>', views: ['view-welcome'], tags: [],
  epistemic_status: null, is_ai_generated: false, ai_trigger_type: null, inquiry_question: null, promising_reason: null,
  scaffold_id: null, scaffold_responses: null, ai_adoption_scaffold_id: null, content_segments: null, segment_stats: null,
  created_at: '2026-10-01T02:00:00Z', updated_at: '2026-10-01T02:00:00Z', deleted_at: null,
});

const check = (over: Record<string, unknown>) => ({
  id: 'c', note_id: 'n1', user_id: 's1', chain: 'editor_inline', draft_length: 120,
  outcome: 'silent', decided_by: 'llm', trigger_type: null, feedback_id: null,
  llm_need: false, llm_type: null, llm_provider: 'deepseek', llm_model: 'deepseek-flash', llm_latency_ms: 1800,
  jev_mode: 'shadow', jev_need: false, jev_reason: null, jev_need_p: 0.2, jev_promising_p: 0.1, jev_type: 'T2',
  jev_type_p: { T1: 0.01, T2: 0.6, T3: 0.2, T4: 0.1, T5: 0.05, T6: 0.04 }, jev_thresholds: { need: 0.5, promising: 0.7 },
  jev_model: 'jev-1.13.0', jev_latency_ms: 380, jev_cached: false, jev_error: null,
  created_at: '2026-10-05T06:30:00Z',
  ...over,
});

beforeEach(() => {
  for (const key of Object.keys(h.fixtures)) delete h.fixtures[key];
  h.calls.length = 0;
  h.fixtures.notes = [note('n1', 's1', '数据与结论'), note('n2', 's2', '先写后问')];
  h.fixtures.feedback_trigger_checks = [
    check({ id: 'c1', outcome: 'triggered', trigger_type: 'no_evidence', feedback_id: 'fb-1', llm_need: true, llm_type: 'T3', jev_need: true, jev_reason: 'gap', jev_need_p: 0.89, jev_type: 'T3' }),
    check({ id: 'c2', llm_need: false, jev_need: true, jev_reason: 'gap', jev_need_p: 0.62 }),
    check({ id: 'c3', note_id: 'n2', user_id: 's2', chain: 'editor_request', outcome: 'triggered', llm_need: true, jev_need: false }),
    check({ id: 'c4', note_id: 'n2', user_id: 't1', chain: 'teacher_batch', decided_by: 'jev', jev_mode: 'gate' }),
    // 笔记不在这次导出里（比如被时间范围筛掉了）：不能留下指向它的行
    check({ id: 'c5', note_id: 'n-outside' }),
    // 笔记后来被删掉、外键置空：检查本身还在
    check({ id: 'c6', note_id: null, jev_mode: 'off', jev_need: null, jev_need_p: null, jev_promising_p: null, jev_type: null, jev_type_p: null, jev_thresholds: null, jev_model: null, jev_latency_ms: null, jev_cached: null }),
  ];
});

const rowsOf = async (s: ExportScope = scope()) => (await buildAllDatasets(s)).datasets.feedback_checks.rows;

describe('「AI 反馈检查记录」进研究导出', () => {
  it('是一张单独的表，排在 AI 干预日志后面，列和说明都配齐', () => {
    expect(DATASET_KEYS.indexOf('feedback_checks')).toBe(DATASET_KEYS.indexOf('ai_interventions') + 1);
    expect(DATASET_LABELS.feedback_checks.zh).toBe('AI 反馈检查记录');
    expect(DATASET_COLUMNS.feedback_checks.find(c => c.key === 'participant_name')?.sensitive).toBe(true);
  });

  it('按课程、按这次导出的空间取，时间范围也带上', async () => {
    await rowsOf(scope({ filters: { from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z' } }));
    const calls = h.calls.filter(c => c.table === 'feedback_trigger_checks');
    expect(calls).toContainEqual({ table: 'feedback_trigger_checks', method: 'eq', args: ['course_id', 'course-1'] });
    expect(calls).toContainEqual({ table: 'feedback_trigger_checks', method: 'in', args: ['space_id', ['space-1']] });
    expect(calls).toContainEqual({ table: 'feedback_trigger_checks', method: 'gte', args: ['created_at', '2026-10-01T00:00:00Z'] });
    expect(calls).toContainEqual({ table: 'feedback_trigger_checks', method: 'lte', args: ['created_at', '2026-10-31T23:59:59Z'] });
  });

  it('一行一次检查：标签读得懂，Jev 的原始概率和阈值都在', async () => {
    const rows = await rowsOf();
    const first = rows.find(r => r.check_id === 'c1')!;
    expect(first).toMatchObject({
      participant_id: 'SAL01', group_name: '一组', condition: '实验组', note_title: '数据与结论',
      chain: '打字时自动检查', outcome: '出了反馈', decided_by: '大模型', trigger_type: 'no_evidence',
      llm_need: '是', llm_type: 'T3', llm_model: 'deepseek/deepseek-flash', llm_latency_ms: 1800,
      jev_mode: '陪跑（只记录）', jev_need: '是', jev_reason: '有明显问题', jev_need_p: 0.89, jev_type: 'T3',
      jev_need_threshold: 0.5, jev_promising_threshold: 0.7, jev_model: 'jev-1.13.0', jev_cached: '否',
      need_agree: '是', created_at_local: '2026-10-05 14:30', week_index: '4', feedback_id: 'fb-1', note_id: 'n1',
    });
    expect(first.jev_type_probs).toMatchObject({ T3: 0.2, T2: 0.6 });
  });

  it('两边是否一致只在打字时的自动检查里算', async () => {
    const rows = await rowsOf();
    expect(rows.find(r => r.check_id === 'c2')?.need_agree).toBe('否');
    // 学生主动要：大模型被要求一定给，不算
    expect(rows.find(r => r.check_id === 'c3')?.need_agree).toBe('');
  });

  it('教师批量：参与者是被检查笔记的作者，不是发起的教师', async () => {
    const batch = (await rowsOf()).find(r => r.check_id === 'c4')!;
    expect(batch).toMatchObject({ participant_id: 'SAL02', chain: '教师批量', decided_by: 'Jev', jev_mode: '由 Jev 决定' });
  });

  it('笔记不在这次导出里的检查不出现；笔记删了（外键置空）的检查留着', async () => {
    const rows = await rowsOf();
    expect(rows.map(r => r.check_id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c6']);
    expect(rows.find(r => r.check_id === 'c6')).toMatchObject({ participant_id: 'SAL01', note_title: '', jev_mode: '未开启', jev_need: '', jev_cached: '', need_agree: '' });
  });

  it('按小组筛：只留组内学生笔记上的检查，教师批量查的别组笔记不进来', async () => {
    const rows = await rowsOf(scope({ participantScope: new Set(['s1']) }));
    expect(rows.map(r => r.check_id)).toEqual(['c1', 'c2', 'c6']);
  });

  it('序号按导出后的行重排', async () => {
    expect((await rowsOf()).map(r => r.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('README：选了这张表才写它的口径说明', async () => {
    const s = scope();
    const built = await buildAllDatasets(s);
    expect(buildReadme(s, built, '2026-10-05T07:00:00Z', ['feedback_checks'])).toContain('## 关于「AI 反馈检查记录」');
    expect(buildReadme(s, built, '2026-10-05T07:00:00Z', ['notes'])).not.toContain('AI 反馈检查记录');
  });
});
