import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 教师看数字的两个工具读错了 Build-on 关系（2026-10-06 修 export_notes 时一并查出）：
 * - get_workspace_summary 查 relations 时筛了 deleted_at，这一列不存在，PostgREST 报错被忽略，总关系数永远是 0；
 *   笔记总数、今天活跃的笔记数取自「最近更新的 30 条」，永远不超过 30。
 * - class_analytics 的 buildon_depth 只认 relation_type = 'build_on'，库里没有这个值，深度永远是 0；
 *   connections 只看前 50 条笔记，连到已删笔记的关系也算进去。
 * 关系六种都算 Build-on。relations 没有 deleted_at，笔记软删除后关系还在，只能按两端笔记过滤。
 * 假数据库只认线上真实的列，选或筛一个不存在的列，就像 PostgREST 一样返回错误。
 */

const SPACE = '5cd95cfc-6813-444f-8d3a-3971e1935930';
const OTHER_SPACE = 'e14ce735-46ed-444a-9672-d82ab6ab87f3';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C, D, GONE, ELSEWHERE] = [1, 2, 3, 4, 5, 6].map(id);
const FILLERS = Array.from({ length: 50 }, (_, i) => id(100 + i));

const h = vi.hoisted(() => {
  // 2026-10-06 线上 information_schema 里这两张表的全部列
  const COLUMNS: Record<string, string[]> = {
    notes: [
      'id', 'course_id', 'author_id', 'author_name', 'type', 'title', 'content', 'x', 'y', 'width', 'height', 'views',
      'metadata', 'created_at', 'updated_at', 'space_id', 'summary', 'tags', 'cited_note_ids', 'rise_above_data',
      'drawing_data', 'file_url', 'file_name', 'mime_type', 'epistemic_status', 'scaffold_id', 'scaffold_responses',
      'deleted_at', 'is_ai_generated', 'ai_trigger_type', 'inquiry_question', 'promising_reason', 'knowledge_lacks',
      'ai_adoption_scaffold_id', 'content_segments', 'segment_stats',
    ],
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
    let head = false;
    const result = () => {
      if (unknown.length > 0) return { data: null, count: null, error: { code: '42703', message: `column ${table}.${unknown[0]} does not exist` } };
      if (table === 'relations' && state.failRelations) return { data: null, count: null, error: { message: 'fetch failed' } };
      let rows = (table === 'notes' ? state.notes : state.relations).filter(r => filters.every(f => f(r)));
      if (sort) {
        const { col, ascending } = sort;
        rows = [...rows].sort((x, y) => String(x[col]).localeCompare(String(y[col])) * (ascending ? 1 : -1));
      }
      if (head) return { data: null, count: rows.length, error: null };
      return { data: limitN == null ? rows : rows.slice(0, limitN), count: null, error: null };
    };
    const builder: Record<string, unknown> = {
      select: (cols: string, opts?: { head?: boolean }) => {
        cols.split(',').map(c => c.trim()).filter(Boolean).forEach(known);
        head = opts?.head === true;
        return builder;
      },
      eq: (col: string, v: unknown) => { known(col); filters.push(r => r[col] === v); return builder; },
      in: (col: string, vs: unknown[]) => { known(col); filters.push(r => vs.includes(r[col])); return builder; },
      is: (col: string, v: unknown) => { known(col); filters.push(r => (r[col] ?? null) === v); return builder; },
      // 旧代码的写法：「列.eq.值」用逗号连起来，满足任一条即可
      or: (expr: string) => {
        const terms = expr.split(',').map(t => {
          const [col, op, ...rest] = t.split('.');
          known(col);
          return { col, op, value: rest.join('.') };
        });
        filters.push(r => terms.some(t => t.op === 'eq' && String(r[t.col]) === t.value));
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => { known(col); sort = { col, ascending: opts?.ascending !== false }; return builder; },
      limit: (n: number) => { limitN = n; return builder; },
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve(result()).then(onOk, onFail),
    };
    return builder;
  };

  return { state, from };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('./accessControl', () => ({ ensureSpaceAccess: vi.fn() }));

import { createDefaultRegistry, type ToolContext } from './agentTools';
import { SPACE_RELATIONS_LIMIT } from './buildOnContext';

const registry = createDefaultRegistry();
const teacherCtx = (): ToolContext => ({
  noteId: SPACE, spaceId: SPACE, courseId: 'course-1', userId: 'teacher-1', userRole: 'teacher',
  noteTitle: '', noteContent: '',
});
const run = (tool: string, args: Record<string, unknown> = {}) => registry.executeTool(tool, args, teacherCtx());
const dataOf = (res: { data: unknown }) => res.data as Record<string, any>;
const hoursAgo = (hrs: number) => new Date(Date.now() - hrs * 60 * 60 * 1000).toISOString();

const note = (noteId: string, title: string, over: Record<string, unknown> = {}) => ({
  id: noteId, title, content: `<p>${title}的正文</p>`, author_id: 'student-a', space_id: SPACE,
  created_at: hoursAgo(24 * 5), updated_at: hoursAgo(24 * 3), deleted_at: null as string | null, ...over,
});
const rel = (n: number, source: string, target: string, type: string, space = SPACE) => ({
  id: `r${n}`, source_note_id: source, target_note_id: target, relation_type: type,
  creator_id: 'student-a', space_id: space, ai_suggested: false, ai_accepted: null,
  created_at: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
});

const classNotes = () => [
  note(A, '光合作用需要光吗', { author_id: 'student-a' }),
  note(B, '叶片颜色和光照', { author_id: 'student-b' }),
  note(C, '对照实验怎么设计', { author_id: 'student-c' }),
  note(D, '把几种说法合起来看', { author_id: 'student-a' }),
  note(GONE, '已经删掉的笔记', { author_id: 'student-d', deleted_at: hoursAgo(24) }),
  note(ELSEWHERE, '别的空间的笔记', { author_id: 'student-e', space_id: OTHER_SPACE }),
];
/** 排在前面的 50 条笔记，今天刚改过，都没有关系 */
const fillerNotes = () => FILLERS.map((f, i) => note(f, `补充 ${i + 1}`, { author_id: 'student-f', updated_at: hoursAgo(1) }));

beforeEach(() => {
  h.state.failRelations = false;
  h.state.notes = classNotes();
  // D 同时 Build-on 了 C 和 A；最长的链是 D → C → B → A，3 级
  h.state.relations = [
    rel(1, B, A, 'extend'),
    rel(2, C, B, 'question'),
    rel(3, C, A, 'evidence'),
    rel(4, D, C, 'synthesize'),
    rel(5, D, A, 'clarify'),
    rel(6, B, GONE, 'challenge'),
    rel(7, GONE, C, 'extend'),
    rel(8, ELSEWHERE, A, 'extend', OTHER_SPACE),
  ];
});

describe('get_workspace_summary', () => {
  it('总关系数只数两端笔记都还在、属于本空间的 Build-on，六种都算', async () => {
    const res = await run('get_workspace_summary');

    expect(res.success).toBe(true);
    const data = dataOf(res);
    expect(data.totalRelations).toBe(5);
    expect(data).not.toHaveProperty('relationsError');
    expect(data.totalNotes).toBe(4);
    expect(data.uniqueContributors).toBe(3);
  });

  it('笔记总数、今天活跃的笔记数不再止于 30', async () => {
    h.state.notes = [...fillerNotes(), ...classNotes()];
    const data = dataOf(await run('get_workspace_summary'));

    expect(data.totalNotes).toBe(54);
    expect(data.notesActiveToday).toBe(50);
    expect(data.uniqueContributors).toBe(4);
    expect(data.totalRelations).toBe(5);
    expect(data.recentNotes).toHaveLength(8);
  });

  it('关系读不出来时不说成 0 条', async () => {
    h.state.failRelations = true;
    const res = await run('get_workspace_summary');

    expect(res.success).toBe(true);
    const data = dataOf(res);
    expect(data).not.toHaveProperty('totalRelations');
    expect(data.relationsError).toBeTruthy();
    expect(String(data.hint)).toContain('could not be read');
    expect(data.totalNotes).toBe(4);
  });
});

describe('class_analytics', () => {
  it('connections 只数两端笔记都还在的关系，碰到已删笔记的不算', async () => {
    const data = dataOf(await run('class_analytics', { metric: 'connections' }));

    expect(data.connections).toEqual({ totalConnections: 5 });
    expect(data).not.toHaveProperty('buildonDepth');
    expect(data).not.toHaveProperty('participation');
  });

  it('buildon_depth 是最长那条 Build-on 链的级数：一条笔记同时 Build-on 好几条时按最长的路算', async () => {
    const data = dataOf(await run('class_analytics', { metric: 'buildon_depth' }));

    expect(data.buildonDepth).toEqual({ maxChainLength: 3 });
    expect(data).not.toHaveProperty('connections');
  });

  it('all：笔记多于 50 条时，排在 50 条以后的笔记的关系照样算', async () => {
    h.state.notes = [...fillerNotes(), ...classNotes()];
    const res = await run('class_analytics');

    expect(res.success).toBe(true);
    const data = dataOf(res);
    expect(data.participation).toMatchObject({ totalNotes: 54, uniqueAuthors: 4 });
    expect(data.participation.notesPerAuthor).toEqual({ 'student-f': 50, 'student-a': 2, 'student-b': 1, 'student-c': 1 });
    expect(data.connections).toEqual({ totalConnections: 5 });
    expect(data.buildonDepth).toEqual({ maxChainLength: 3 });
    expect(data).not.toHaveProperty('relationsError');
  });

  it('关系读不出来时不报 0：连接数和深度都不给，说明读不出来', async () => {
    h.state.failRelations = true;
    const res = await run('class_analytics');

    expect(res.success).toBe(true);
    const data = dataOf(res);
    expect(data).not.toHaveProperty('connections');
    expect(data).not.toHaveProperty('buildonDepth');
    expect(String(data.relationsError)).toContain('could not be read');
    expect(data.participation).toMatchObject({ totalNotes: 4, uniqueAuthors: 3 });
  });
});

describe('关系多到一次读不完时，说明数字只算了最新的那部分', () => {
  beforeEach(() => {
    h.state.notes = [...fillerNotes(), ...classNotes()];
    h.state.relations = Array.from({ length: SPACE_RELATIONS_LIMIT }, (_, i) => rel(100 + i, FILLERS[i % FILLERS.length], A, 'extend'));
  });

  it('get_workspace_summary', async () => {
    const data = dataOf(await run('get_workspace_summary'));

    expect(data.totalRelations).toBe(SPACE_RELATIONS_LIMIT);
    expect(String(data.hint)).toContain(`newest ${SPACE_RELATIONS_LIMIT}`);
  });

  it('class_analytics', async () => {
    const data = dataOf(await run('class_analytics'));

    expect(data.connections).toEqual({ totalConnections: SPACE_RELATIONS_LIMIT });
    expect(String(data.hint)).toContain(`newest ${SPACE_RELATIONS_LIMIT}`);
  });

  it('没到上限时不提', async () => {
    h.state.relations = h.state.relations.slice(0, 10);
    const summary = dataOf(await run('get_workspace_summary'));
    const analytics = dataOf(await run('class_analytics'));

    expect(String(summary.hint)).not.toContain('newest');
    expect(String(analytics.hint)).not.toContain('newest');
  });
});
