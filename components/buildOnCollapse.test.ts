import { describe, expect, it } from 'vitest';
import {
  autoFoldIds,
  buildFoldGraph,
  descendantsOf,
  effectiveFolds,
  foldSummaries,
  hiddenByFolds,
  revealChoices,
  toggleFold,
  type FoldCandidate,
  type FoldEdge,
} from './buildOnCollapse';

// e(a, b): a 建立在 b 上
const e = (source: string, target: string): FoldEdge => ({ source, target });

describe('hiddenByFolds', () => {
  const ids = ['root', 'a', 'b', 'a1', 'a2', 'x'];
  const graph = buildFoldGraph(ids, [e('a', 'root'), e('b', 'root'), e('a1', 'a'), e('a2', 'a1')]);

  it('hides everything below a collapsed note but not the note itself', () => {
    expect([...hiddenByFolds(graph, new Set(['root']))].sort()).toEqual(['a', 'a1', 'a2', 'b']);
    expect([...hiddenByFolds(graph, new Set(['a']))].sort()).toEqual(['a1', 'a2']);
    expect(hiddenByFolds(graph, new Set()).size).toBe(0);
  });

  it('keeps a note that also builds on a visible, expanded note', () => {
    const g = buildFoldGraph(['p', 'q', 's'], [e('s', 'p'), e('s', 'q')]);
    expect(hiddenByFolds(g, new Set(['p'])).has('s')).toBe(false);
    expect(hiddenByFolds(g, new Set(['p', 'q'])).has('s')).toBe(true);
  });

  it('hides a multi-parent note when its other parent is itself hidden', () => {
    // s 建立在 p 和 m 上，m 又建立在 p 上：p 收起 → m 藏 → s 两个父笔记都不开着 → 藏
    const g = buildFoldGraph(['p', 'm', 's'], [e('m', 'p'), e('s', 'p'), e('s', 'm')]);
    expect([...hiddenByFolds(g, new Set(['p']))].sort()).toEqual(['m', 's']);
  });

  it('does not hide notes in a cycle that is only reachable through each other', () => {
    const g = buildFoldGraph(['a', 'b', 'c'], [e('a', 'b'), e('b', 'a'), e('a', 'c')]);
    expect(hiddenByFolds(g, new Set(['c'])).size).toBe(0);
  });

  it('ignores edges whose ends are not on this canvas and self loops', () => {
    const g = buildFoldGraph(['a', 'b'], [e('a', 'b'), e('a', 'elsewhere'), e('b', 'b')]);
    expect(g.parents.get('a')).toEqual(['b']);
    expect(g.children.get('b')).toEqual(['a']);
    expect(g.children.has('elsewhere')).toBe(false);
  });
});

describe('foldSummaries', () => {
  it('counts hidden notes below a collapsed note and flags unseen ones', () => {
    const g = buildFoldGraph(['r', 'a', 'b', 'c'], [e('a', 'r'), e('b', 'r'), e('c', 'a')]);
    const collapsed = new Set(['r']);
    const hidden = hiddenByFolds(g, collapsed);
    const sums = foldSummaries(g, collapsed, hidden, id => id === 'c');
    expect(sums.get('r')).toEqual({ childCount: 2, collapsed: true, hiddenCount: 3, hasNewHidden: true });
    // a 被藏了，不给它算摘要
    expect(sums.has('a')).toBe(false);
  });

  it('reports expanded notes with their direct Build-on count', () => {
    const g = buildFoldGraph(['r', 'a', 'b'], [e('a', 'r'), e('b', 'r')]);
    const sums = foldSummaries(g, new Set(), new Set(), () => false);
    expect(sums.get('r')).toEqual({ childCount: 2, collapsed: false, hiddenCount: 0, hasNewHidden: false });
  });
});

describe('autoFoldIds', () => {
  const day = 86_400_000;
  const base = Date.parse('2026-10-01T12:00:00Z');
  const at = (daysAgo: number) => new Date(base - daysAgo * day).toISOString();
  // 15 条笔记：一条最新的，一枝旧的小分支，其余是不相连的旧笔记
  const fillers = (n: number): FoldCandidate[] =>
    Array.from({ length: n }, (_, i) => ({ id: `f${i}`, createdAt: at(30), protect: false }));

  it('folds a small old branch on a busy canvas', () => {
    const candidates: FoldCandidate[] = [
      { id: 'latest', createdAt: at(0), protect: false },
      { id: 'root', createdAt: at(20), protect: false },
      { id: 'a', createdAt: at(19), protect: false },
      { id: 'a1', createdAt: at(18), protect: false },
      ...fillers(12),
    ];
    const g = buildFoldGraph(candidates.map(c => c.id), [e('a', 'root'), e('a1', 'a')]);
    // root 和 a 都合格，只收最外层 root
    expect([...autoFoldIds(candidates, g)]).toEqual(['root']);
  });

  it('leaves small canvases alone', () => {
    const candidates: FoldCandidate[] = [
      { id: 'latest', createdAt: at(0), protect: false },
      { id: 'root', createdAt: at(20), protect: false },
      { id: 'a', createdAt: at(19), protect: false },
    ];
    const g = buildFoldGraph(candidates.map(c => c.id), [e('a', 'root')]);
    expect(autoFoldIds(candidates, g).size).toBe(0);
  });

  it('does not fold a branch with a recent, protected or undated note, or a big branch', () => {
    const make = (child: Partial<FoldCandidate>) => {
      const candidates: FoldCandidate[] = [
        { id: 'latest', createdAt: at(0), protect: false },
        { id: 'root', createdAt: at(20), protect: false },
        { id: 'a', createdAt: at(19), protect: false, ...child },
        ...fillers(12),
      ];
      return autoFoldIds(candidates, buildFoldGraph(candidates.map(c => c.id), [e('a', 'root')]));
    };
    expect(make({ createdAt: at(2) }).size).toBe(0);
    expect(make({ protect: true }).size).toBe(0);
    expect(make({ createdAt: undefined }).size).toBe(0);

    const candidates: FoldCandidate[] = [
      { id: 'latest', createdAt: at(0), protect: false },
      { id: 'root', createdAt: at(20), protect: false },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `k${i}`, createdAt: at(19), protect: false })),
      ...fillers(8),
    ];
    const big = buildFoldGraph(candidates.map(c => c.id), Array.from({ length: 6 }, (_, i) => e(`k${i}`, 'root')));
    expect(autoFoldIds(candidates, big).size).toBe(0);
  });

  it('measures "old" against the newest note on the canvas, not today', () => {
    const candidates: FoldCandidate[] = [
      { id: 'latest', createdAt: at(400), protect: false },
      { id: 'root', createdAt: at(420), protect: false },
      { id: 'a', createdAt: at(419), protect: false },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, createdAt: at(401), protect: false })),
    ];
    const g = buildFoldGraph(candidates.map(c => c.id), [e('a', 'root'), e('f0', 'latest')]);
    // latest 的分支（f0）只比 latest 早一天，不算旧；root 的分支早了 19 天
    expect([...autoFoldIds(candidates, g)]).toEqual(['root']);
  });
});

describe('choices', () => {
  it('lets an explicit expand override the default fold and an explicit collapse add one', () => {
    const auto = new Set(['a', 'b']);
    expect([...effectiveFolds(auto, { collapsed: ['c'], expanded: ['a'] })].sort()).toEqual(['b', 'c']);
  });

  it('toggles between collapsed and expanded without duplicates', () => {
    let c = toggleFold({ collapsed: [], expanded: [] }, 'x', false);
    expect(c).toEqual({ collapsed: ['x'], expanded: [] });
    c = toggleFold(c, 'x', true);
    expect(c).toEqual({ collapsed: [], expanded: ['x'] });
  });
});

describe('revealChoices', () => {
  it('opens the folds on the way down to a hidden note', () => {
    const g = buildFoldGraph(['r', 'a', 'a1'], [e('a', 'r'), e('a1', 'a')]);
    const collapsed = new Set(['r', 'a']);
    const hidden = hiddenByFolds(g, collapsed);
    const next = revealChoices(g, { collapsed: ['r', 'a'], expanded: [] }, collapsed, hidden, 'a1');
    const after = effectiveFolds(new Set(), next);
    expect(hiddenByFolds(g, after).has('a1')).toBe(false);
  });

  it('opens a default fold by recording an explicit expand', () => {
    const g = buildFoldGraph(['r', 'a'], [e('a', 'r')]);
    const auto = new Set(['r']);
    const choices = { collapsed: [], expanded: [] };
    const collapsed = effectiveFolds(auto, choices);
    const next = revealChoices(g, choices, collapsed, hiddenByFolds(g, collapsed), 'a');
    expect(next.expanded).toContain('r');
    expect(hiddenByFolds(g, effectiveFolds(auto, next)).has('a')).toBe(false);
  });

  it('prefers a parent that is already visible and leaves visible notes as they are', () => {
    const g = buildFoldGraph(['p', 'q', 's'], [e('s', 'p'), e('s', 'q')]);
    const collapsed = new Set(['p', 'q']);
    const hidden = hiddenByFolds(g, collapsed);
    const next = revealChoices(g, { collapsed: ['p', 'q'], expanded: [] }, collapsed, hidden, 's');
    expect(next.expanded).toHaveLength(1);
    const same = { collapsed: [], expanded: [] };
    expect(revealChoices(g, same, new Set(), new Set(), 's')).toBe(same);
  });
});

describe('descendantsOf', () => {
  it('walks the whole branch and survives cycles', () => {
    const g = buildFoldGraph(['a', 'b', 'c'], [e('b', 'a'), e('c', 'b'), e('a', 'c')]);
    expect([...descendantsOf(g, 'a')].sort()).toEqual(['b', 'c']);
  });
});
