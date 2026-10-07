import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 教师端个人助手（lesson_planner / teaching_analyst）的文件工具，2026-10-06 查出的两处：
 * - export_notes 按 source_id / target_id 读 relations，还筛了它没有的 deleted_at；查询报错被忽略，
 *   导出的 Word 里永远是「0 条关系」。
 * - analyze_engagement 按学生分组时，图表和 Word 报告在同一个 try 里：服务器画不出图，报告也跟着没了。
 * 假数据库只认线上真实的列，选或筛一个不存在的列，就像 PostgREST 一样返回错误。
 */

const SPACE = '5cd95cfc-6813-444f-8d3a-3971e1935930';
const OTHER_SPACE = 'e14ce735-46ed-444a-9672-d82ab6ab87f3';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C, GONE, ELSEWHERE] = [id(1), id(2), id(3), id(4), id(5)];

const h = vi.hoisted(() => {
  // 2026-10-06 线上 information_schema 里的列
  const COLUMNS: Record<string, string[]> = {
    notes: ['id', 'title', 'content', 'author_id', 'space_id', 'created_at', 'updated_at', 'deleted_at'],
    relations: ['id', 'source_note_id', 'target_note_id', 'relation_type', 'creator_id', 'space_id', 'ai_suggested', 'ai_accepted', 'created_at'],
  };
  type Row = Record<string, unknown>;
  const state = { notes: [] as Row[], relations: [] as Row[], failRelations: false };

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const unknown: string[] = [];
    const known = (col: string) => { if (!COLUMNS[table]?.includes(col)) unknown.push(col); };
    let sort: { col: string; ascending: boolean } | null = null;
    let limitN: number | null = null;
    const result = () => {
      if (unknown.length > 0) return { data: null, error: { code: '42703', message: `column ${table}.${unknown[0]} does not exist` } };
      if (table === 'relations' && state.failRelations) return { data: null, error: { message: 'fetch failed' } };
      let rows = (table === 'notes' ? state.notes : state.relations).filter(r => filters.every(f => f(r)));
      if (sort) {
        const { col, ascending } = sort;
        rows = [...rows].sort((x, y) => String(x[col]).localeCompare(String(y[col])) * (ascending ? 1 : -1));
      }
      return { data: limitN == null ? rows : rows.slice(0, limitN), error: null };
    };
    const builder: Record<string, unknown> = {
      select: (cols: string) => { cols.split(',').map(c => c.trim()).filter(Boolean).forEach(known); return builder; },
      eq: (col: string, v: unknown) => { known(col); filters.push(r => r[col] === v); return builder; },
      in: (col: string, vs: unknown[]) => { known(col); filters.push(r => vs.includes(r[col])); return builder; },
      is: (col: string, v: unknown) => { known(col); filters.push(r => (r[col] ?? null) === v); return builder; },
      gte: (col: string, v: string) => { known(col); filters.push(r => String(r[col]) >= v); return builder; },
      lt: (col: string, v: string) => { known(col); filters.push(r => String(r[col]) < v); return builder; },
      order: (col: string, opts?: { ascending?: boolean }) => { known(col); sort = { col, ascending: opts?.ascending !== false }; return builder; },
      limit: (n: number) => { limitN = n; return builder; },
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve(result()).then(onOk, onFail),
    };
    return builder;
  };

  return { state, from, generateWordDoc: vi.fn(), generateTableDoc: vi.fn(), generateChart: vi.fn() };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('./accessControl', () => ({ ensureSpaceAccess: vi.fn() }));
vi.mock('./fileGenerator', () => ({
  generateWordDoc: h.generateWordDoc,
  generateTableDoc: h.generateTableDoc,
  generateChart: h.generateChart,
  engagementBarChartConfig: () => ({ type: 'bar' }),
  timelineChartConfig: () => ({ type: 'line' }),
  comparisonBarChartConfig: () => ({ type: 'bar' }),
}));

import { createDefaultRegistry, type ToolContext } from './agentTools';

const registry = createDefaultRegistry();
const teacherCtx = (): ToolContext => ({
  noteId: SPACE, spaceId: SPACE, courseId: 'course-1', userId: 'teacher-1', userRole: 'teacher',
  noteTitle: '', noteContent: '',
});
const run = (tool: string, args: Record<string, unknown> = {}) => registry.executeTool(tool, args, teacherCtx());
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

const note = (noteId: string, title: string, over: Record<string, unknown> = {}) => ({
  id: noteId, title, content: `<p>${title}的正文</p>`, author_id: 'student-a', space_id: SPACE,
  created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z', deleted_at: null as string | null, ...over,
});
const rel = (n: number, source: string, target: string, type: string, at: string, space = SPACE) => ({
  id: `r${n}`, source_note_id: source, target_note_id: target, relation_type: type,
  creator_id: 'student-a', space_id: space, ai_suggested: false, ai_accepted: null, created_at: at,
});

type DocCall = { subtitle: string; sections: Array<{ heading: string; items?: string[] }> };
const lastDoc = () => h.generateWordDoc.mock.calls.at(-1)![0] as DocCall;
const itemsByNote = () => lastDoc().sections.map(s => [s.heading, s.items]);

beforeEach(() => {
  h.state.failRelations = false;
  h.state.notes = [
    note(A, '光合作用需要光吗', { created_at: '2026-09-20T01:00:00Z' }),
    note(B, '叶片颜色和光照', { created_at: '2026-09-20T02:00:00Z' }),
    note(C, '对照实验怎么设计', { created_at: '2026-09-20T03:00:00Z' }),
    note(GONE, '已经删掉的笔记', { created_at: '2026-09-19T00:00:00Z', deleted_at: '2026-09-25T00:00:00Z' }),
    note(ELSEWHERE, '别的空间的笔记', { space_id: OTHER_SPACE }),
  ];
  h.state.relations = [
    rel(1, B, A, 'extend', '2026-09-21T00:00:00Z'),
    rel(2, C, A, 'question', '2026-09-22T00:00:00Z'),
    rel(3, C, B, 'evidence', '2026-09-23T00:00:00Z'),
    rel(4, A, GONE, 'clarify', '2026-09-24T00:00:00Z'),
    rel(5, GONE, B, 'challenge', '2026-09-24T01:00:00Z'),
    rel(6, ELSEWHERE, A, 'extend', '2026-09-24T02:00:00Z', OTHER_SPACE),
  ];
  h.generateWordDoc.mockReset().mockResolvedValue({ fileId: 'doc-1', fileName: '笔记导出.docx' });
  h.generateTableDoc.mockReset().mockResolvedValue({ fileId: 'report-1', fileName: '学生参与度分析报告.docx' });
  h.generateChart.mockReset().mockResolvedValue({ fileId: 'chart-1', fileName: 'chart.png' });
});

describe('export_notes 导出的 Word 里列出 Build-on 关系', () => {
  it('每条笔记下列它 Build-on 了谁；碰到已删笔记、别的空间的关系不列', async () => {
    const res = await run('export_notes');

    expect(res.success).toBe(true);
    expect(itemsByNote()).toEqual([
      ['光合作用需要光吗', []],
      ['叶片颜色和光照', ['→ Build-on: 光合作用需要光吗']],
      ['对照实验怎么设计', ['→ Build-on: 叶片颜色和光照', '→ Build-on: 光合作用需要光吗']],
    ]);
    expect(lastDoc().subtitle).toBe('3 篇笔记 · 3 条 Build-on 关系');
    const data = res.data as Record<string, unknown>;
    expect(data.relationCount).toBe(3);
    expect(data).not.toHaveProperty('relationsError');
    expect(String(data.hint)).toContain('with 3 Build-on relations');
  });

  it('只导出部分笔记时，被 Build-on 的原笔记不在导出范围里也写出标题', async () => {
    const res = await run('export_notes', { note_ids: [A, C] });

    expect(itemsByNote()).toEqual([
      ['光合作用需要光吗', []],
      ['对照实验怎么设计', ['→ Build-on: 叶片颜色和光照', '→ Build-on: 光合作用需要光吗']],
    ]);
    expect((res.data as Record<string, unknown>).relationCount).toBe(2);
  });

  it('关系读不出来时照样导出笔记，但不说成「0 条关系」', async () => {
    h.state.failRelations = true;
    const res = await run('export_notes');

    expect(res.success).toBe(true);
    expect(lastDoc().subtitle).toBe('3 篇笔记');
    expect(itemsByNote().every(([, items]) => (items as string[]).length === 0)).toBe(true);
    const data = res.data as Record<string, unknown>;
    expect(data).not.toHaveProperty('relationCount');
    expect(data.relationsError).toBeTruthy();
    expect(String(data.hint)).toContain('could not be read');
    expect(String(data.hint)).not.toMatch(/\b0 (Build-on )?relations\b/);
  });
});

describe('analyze_engagement 按学生分组：图表和 Word 报告互不连累', () => {
  beforeEach(() => {
    h.state.notes = [
      note(A, 'a', { author_id: 'student-a', created_at: daysAgo(1) }),
      note(B, 'b', { author_id: 'student-a', created_at: daysAgo(2) }),
      note(C, 'c', { author_id: 'student-b', created_at: daysAgo(3) }),
    ];
  });

  it('画不出图时报告照样生成', async () => {
    h.generateChart.mockRejectedValue(new Error('Chart generation not available — native canvas module not installed'));
    const res = await run('analyze_engagement', { group_by: 'student', days: 7 });

    expect(res.success).toBe(true);
    expect(h.generateTableDoc).toHaveBeenCalledTimes(1);
    const data = res.data as Record<string, unknown>;
    expect(data.reportUrl).toBe(`/api/files/report-1?name=${encodeURIComponent('学生参与度分析报告.docx')}`);
    expect(data).not.toHaveProperty('chartUrl');
    expect(String(data.hint)).toContain('Report: [学生参与度分析报告.docx]');
    expect(String(data.hint)).not.toContain('Chart:');
  });

  it('报告生成失败时图表照样给', async () => {
    h.generateTableDoc.mockRejectedValue(new Error('docx failed'));
    const res = await run('analyze_engagement', { group_by: 'student', days: 7 });

    const data = res.data as Record<string, unknown>;
    expect(data.chartUrl).toBe('/api/files/chart-1?name=chart.png');
    expect(data).not.toHaveProperty('reportUrl');
  });
});

describe('图表的 base64 不回传给模型', () => {
  // 工具结果整段 JSON 回传给模型；前端只用 chartUrl。一张图的 base64 有一万多字符
  it.each([
    ['analyze_engagement 按学生', 'analyze_engagement', { group_by: 'student' }],
    ['analyze_engagement 按天', 'analyze_engagement', { group_by: 'day' }],
    ['compare_periods', 'compare_periods', {}],
  ])('%s', async (_name, tool, args) => {
    h.state.notes = [note(A, 'a', { created_at: daysAgo(1) }), note(B, 'b', { created_at: daysAgo(10) })];
    h.generateChart.mockResolvedValue({ fileId: 'chart-1', fileName: 'chart.png', base64: 'iVBORw0KGgoAAAANSUhEUgBASE64' });
    const res = await run(tool, args);

    expect(res.success).toBe(true);
    expect((res.data as Record<string, unknown>).chartUrl).toBe('/api/files/chart-1?name=chart.png');
    expect(JSON.stringify(res.data)).not.toContain('iVBORw0KGgo');
  });
});
