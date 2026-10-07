import { describe, expect, it, vi } from 'vitest';

/**
 * 知识空间助手要「认得出 Build-on 关系」：关系得进系统提示，方向别说反，已删的笔记不能出现，
 * 没有关系时要明说没有（别让模型编）。
 */

const h = vi.hoisted(() => {
  const state = {
    relations: [] as Array<{ source_note_id: string; target_note_id: string; relation_type: string; space_id: string; created_at: string }>,
    notes: [] as Array<{ id: string; title: string; space_id: string; deleted_at: string | null }>,
    queries: [] as string[],
  };
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const inList: Record<string, string[]> = {};
    let isNull: string | null = null;
    const result = () => {
      state.queries.push(table);
      if (table === 'relations') {
        const rows = state.relations
          .filter(r => !eq.space_id || r.space_id === eq.space_id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        return { data: rows, error: null };
      }
      if (table === 'notes') {
        const rows = state.notes.filter(n =>
          (!eq.space_id || n.space_id === eq.space_id)
          && (!inList.id || inList.id.includes(n.id))
          && (isNull !== 'deleted_at' || n.deleted_at === null));
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    };
    const builder: Record<string, unknown> = {
      eq: (col: string, value: unknown) => { eq[col] = value; return builder; },
      in: (col: string, values: string[]) => { inList[col] = values; return builder; },
      is: (col: string) => { isNull = col; return builder; },
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve(result()).then(onOk, onFail),
    };
    for (const m of ['select', 'order', 'limit']) builder[m] = () => builder;
    return builder;
  };
  return { state, from };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));

import {
  buildOnStats,
  describeSpaceGraph,
  fetchSpaceBuildOnGraph,
  formatBuildOnSection,
  isNoteId,
  longestBuildOnChain,
} from './buildOnContext';

const link = (sourceId: string, targetId: string, type = 'extend') => ({ sourceId, targetId, type });
const listed = [
  { id: 'a', title: '检索练习为什么有效' },
  { id: 'b', title: '我的补充：间隔也重要' },
  { id: 'c', title: '一个质疑' },
  { id: 'd', title: '还没人理的想法' },
];
const titles = new Map(listed.map(n => [n.id, n.title]));

describe('formatBuildOnSection', () => {
  it('写清方向：source 是后写的、在 Build-on 的那条；每条用提示词里的编号', () => {
    const text = formatBuildOnSection({ listed, titles, links: [link('b', 'a', 'extend'), link('c', 'a', 'challenge')] });

    expect(text).toContain('"X builds on Y" means X is the newer note and Y is the original it builds on');
    expect(text).toContain('#2 "我的补充：间隔也重要" builds on #1 "检索练习为什么有效" (extend)');
    expect(text).toContain('#3 "一个质疑" builds on #1 "检索练习为什么有效" (challenge)');
    // 反方向的说法不能出现
    expect(text).not.toContain('#1 "检索练习为什么有效" builds on #2');
  });

  it('六种关系的含义写在提示里，并说明任何一条关系都算 Build-on（库里没有 build_on 这个取值）', () => {
    const text = formatBuildOnSection({ listed, titles, links: [link('b', 'a')] });
    for (const kind of ['extend', 'clarify', 'question', 'challenge', 'evidence', 'synthesize']) expect(text).toContain(kind);
    expect(text).toContain('Every link between two notes is a Build-on, whatever its kind');
  });

  it('统计被 Build-on 最多的，以及列出的笔记里还没人 Build-on 的', () => {
    const text = formatBuildOnSection({ listed, titles, links: [link('b', 'a'), link('c', 'a'), link('d', 'b')] });

    expect(text).toContain('Built on most: #1 "检索练习为什么有效" (2); #2 "我的补充：间隔也重要" (1).');
    expect(text).toContain('Listed notes nobody has built on yet: #3, #4.');
  });

  it('一条关系都没有：明说没有，不让模型编', () => {
    const text = formatBuildOnSection({ listed, titles, links: [] });
    expect(text).toContain('There are no Build-on links in this workspace yet');
    expect(text).toContain('do not invent any');
    expect(text).not.toContain('builds on #');
  });

  it('列表里放不下的老笔记：端点写标题和 id，并说明列表只是一部分', () => {
    const older = new Map([...titles, ['z', '很早以前的一条']]);
    const text = formatBuildOnSection({ listed, titles: older, links: [link('b', 'z', 'question')], totalNotes: 81 });

    expect(text).toContain('#2 "我的补充：间隔也重要" builds on "很早以前的一条" (id: z) (question)');
    expect(text).toContain('shows 4 of 81 notes');
  });

  it('勾选了笔记：只写碰到这几条的关系，不再说「没人 Build-on」', () => {
    const text = formatBuildOnSection({
      listed: [listed[0], listed[1]], titles,
      links: [link('b', 'a'), link('d', 'c')],
      focusIds: new Set(['a', 'b']),
    });

    expect(text).toContain('1 link(s) touching the selected notes');
    expect(text).toContain('#2 "我的补充：间隔也重要" builds on #1');
    expect(text).not.toContain('一个质疑');
    expect(text).not.toContain('nobody has built on yet');
  });

  it('勾选的笔记上没有关系：说明是「选中的笔记上」没有', () => {
    const text = formatBuildOnSection({ listed: [listed[3]], titles, links: [link('b', 'a')], focusIds: new Set(['d']) });
    expect(text).toContain('There are no Build-on links on the selected notes yet');
  });

  it('关系太多只写最新的若干条，统计仍按全部算', () => {
    const many = Array.from({ length: 5 }, (_, i) => link('b', 'a', i % 2 ? 'extend' : 'clarify'));
    const text = formatBuildOnSection({ listed, titles, links: many, maxLinks: 2 });

    expect(text.match(/builds on #1/g)).toHaveLength(2);
    expect(text).toContain('and 3 older link(s) not shown');
    expect(text).toContain('Built on most: #1 "检索练习为什么有效" (5)');
  });

  it('标题再长也截断，提示词不被撑爆', () => {
    const long = '很长的标题'.repeat(30);
    const text = formatBuildOnSection({ listed: [{ id: 'a', title: long }, listed[1]], titles: new Map([['a', long], ['b', 'B']]), links: [link('b', 'a')] });
    expect(text).toContain('…');
    expect(text).not.toContain(long);
  });
});

describe('buildOnStats', () => {
  it('被 Build-on 次数多的在前；没被 Build-on 过的只在给定范围里算', () => {
    const stats = buildOnStats([link('b', 'a'), link('c', 'a'), link('d', 'b')], ['a', 'b', 'c', 'd']);
    expect(stats.builtOn).toEqual([{ id: 'a', count: 2 }, { id: 'b', count: 1 }]);
    expect(stats.notBuiltOn).toEqual(['c', 'd']);
  });
});

describe('longestBuildOnChain', () => {
  it('数最长那条链有几级；一条笔记同时 Build-on 好几条时按最长的路算，不按离得最近的算', () => {
    // d → c → b → a 是 3 级；d → a、c → a 这两条近路不能把它算短
    const links = [link('b', 'a'), link('c', 'b'), link('c', 'a'), link('d', 'c'), link('d', 'a')];
    expect(longestBuildOnChain(links)).toBe(3);
  });

  it('没有关系是 0，一条关系是 1，两条并排的关系仍是 1', () => {
    expect(longestBuildOnChain([])).toBe(0);
    expect(longestBuildOnChain([link('b', 'a')])).toBe(1);
    expect(longestBuildOnChain([link('b', 'a'), link('c', 'a')])).toBe(1);
  });

  it('关系成环（库里没有，后写的才 Build-on 先写的）也能停下来', () => {
    const n = longestBuildOnChain([link('a', 'b'), link('b', 'c'), link('c', 'a')]);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
  });
});

describe('fetchSpaceBuildOnGraph', () => {
  const rel = (s: string, t: string, type: string, at: string, space = 'space-1') =>
    ({ source_note_id: s, target_note_id: t, relation_type: type, space_id: space, created_at: at });

  it('只留两端都还在、都属于本空间的关系；已知的笔记不再补查', async () => {
    h.state.notes = [
      { id: 'a', title: 'A', space_id: 'space-1', deleted_at: null },
      { id: 'b', title: 'B', space_id: 'space-1', deleted_at: null },
      { id: 'gone', title: '已删除', space_id: 'space-1', deleted_at: '2026-10-01' },
      { id: 'other', title: '别的空间', space_id: 'space-2', deleted_at: null },
      { id: 'old', title: '老笔记', space_id: 'space-1', deleted_at: null },
    ];
    h.state.relations = [
      rel('b', 'a', 'extend', '2026-10-03'),
      rel('b', 'gone', 'question', '2026-10-02'),
      rel('b', 'other', 'evidence', '2026-10-01'),
      rel('b', 'old', 'clarify', '2026-09-30'),
      rel('x', 'y', 'extend', '2026-09-29', 'space-2'),
    ];
    h.state.queries = [];
    const graph = await fetchSpaceBuildOnGraph('space-1', new Map([['a', 'A'], ['b', 'B']]));

    expect(graph.links.map(l => `${l.sourceId}>${l.targetId}:${l.type}`)).toEqual(['b>a:extend', 'b>old:clarify']);
    expect(graph.titles.get('old')).toBe('老笔记');
    expect(graph.titles.has('gone')).toBe(false);
    expect(graph.titles.has('other')).toBe(false);
  });

  it('端点都在已知笔记里：只查一次关系，不再查笔记', async () => {
    h.state.notes = [];
    h.state.relations = [rel('b', 'a', 'extend', '2026-10-03')];
    h.state.queries = [];
    const graph = await fetchSpaceBuildOnGraph('space-1', new Map([['a', 'A'], ['b', 'B']]));

    expect(graph.links).toHaveLength(1);
    expect(h.state.queries).toEqual(['relations']);
  });
});

describe('describeSpaceGraph', () => {
  it('get_note_context 在知识空间里没指定笔记时给的结果：关系带标题，被 Build-on 最多的排前', () => {
    const graph = { links: [link('b', 'a'), link('c', 'a'), link('d', 'b', 'question')], titles };
    const out = describeSpaceGraph(graph);

    expect(out.scope).toBe('workspace');
    expect(out.totalBuildOns).toBe(3);
    expect(out.buildOns[0]).toEqual({ from: { id: 'b', title: '我的补充：间隔也重要' }, to: { id: 'a', title: '检索练习为什么有效' }, kind: 'extend' });
    expect(out.mostBuiltOn[0]).toEqual({ id: 'a', title: '检索练习为什么有效', buildOns: 2 });
  });
});

describe('isNoteId', () => {
  it('只放行 UUID：模型自己填的 note_id 会拼进查询', () => {
    expect(isNoteId('7c0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(isNoteId(' 7C0E1A2B-3C4D-4E5F-8A9B-0C1D2E3F4A5B ')).toBe(false);
    expect(isNoteId('n-1')).toBe(false);
    expect(isNoteId('x,source_note_id.neq.y')).toBe(false);
    expect(isNoteId(undefined)).toBe(false);
  });
});
