import { describe, expect, it } from 'vitest';
import {
  conceptAssociations, detectClusters, displayTerm, labelWidth, layoutIdeaGraph, nodeShape, selectLinks, shapesOverlap,
  type LayoutConcept,
} from './ideaGraphLayout';

/**
 * 观点图谱的连线、分群与布局（2026-10-11）：关联强度不偏向高频词、每个观点都连上最相关的那个；
 * 常一起出现的归一群；布局里圆和标签都不叠、同样的输入同样的结果、换一期时老观点大致留在原处。
 */

/** 可复现的伪随机 */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

const TERMS = [
  '认知卸载', '认知摩擦', '计算思维', '情感支持', '思考过程', '提问引导', '知识传递', '苏格拉底', 'AI',
  '数字鸿沟', '最近发展区', '学习动机', '自主学习能力', '同伴互评', '元认知监控', '反馈', '生成式人工智能伦理', '批判性思维',
];

/** 两个话题群（前 9 个、后 9 个各自常一起出现），中间少量交叉 */
function fixture(seed = 7): LayoutConcept[] {
  const rand = rng(seed);
  return TERMS.map((term, i) => {
    const pool = i < 9 ? 0 : 1;
    const ids = new Set<string>();
    for (let k = 0; k < 3 + Math.floor(rand() * 6); k++) ids.add(`n${pool * 30 + Math.floor(rand() * 14)}`);
    if (rand() < 0.15) ids.add(`n${(1 - pool) * 30 + Math.floor(rand() * 14)}`);
    return { id: term, term, noteIds: [...ids], authorCount: 1 + Math.floor(rand() * 5) };
  });
}

describe('连线和分群', () => {
  it('关联强度看相对出现次数：高频词不会和谁都最强', () => {
    const hub = { id: 'hub', term: 'hub', noteIds: ['1', '2', '3', '4', '5', '6', '7', '8'], authorCount: 3 };
    const a = { id: 'a', term: 'a', noteIds: ['1', '9'], authorCount: 1 };
    const b = { id: 'b', term: 'b', noteIds: ['9', '10'], authorCount: 1 };
    const links = conceptAssociations([hub, a, b]);
    const strength = (x: string, y: string) => links.find(l => (l.source === x && l.target === y) || (l.source === y && l.target === x))!.strength;
    expect(strength('a', 'b')).toBeGreaterThan(strength('hub', 'a'));
  });

  it('选出的连线和全部共现连得一样通（生成树），不超过上限；树以外补的都够强', () => {
    const concepts = fixture();
    const all = conceptAssociations(concepts);
    const links = selectLinks(concepts, 34);
    expect(links.length).toBeLessThanOrEqual(34);
    const components = (edges: Array<{ source: string; target: string }>) => {
      const parent = new Map(concepts.map(c => [c.id, c.id]));
      const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
      for (const e of edges) parent.set(find(e.source), find(e.target));
      return new Set(concepts.map(c => find(c.id))).size;
    };
    expect(components(links)).toBe(components(all));
    const treeSize = concepts.length - components(all);
    expect(links.length).toBeGreaterThanOrEqual(treeSize);
    const weak = links.filter(l => l.strength < 0.2);
    expect(weak.length).toBeLessThanOrEqual(treeSize);
  });

  it('分群：两团各自成群；没有连线的各自一群；群号按大小排、结果稳定', () => {
    const ids = ['a', 'b', 'c', 'x', 'y', 'z', 'lone'];
    const links = [
      { source: 'a', target: 'b', shared: 3, strength: 0.9 }, { source: 'b', target: 'c', shared: 3, strength: 0.8 },
      { source: 'a', target: 'c', shared: 2, strength: 0.7 }, { source: 'x', target: 'y', shared: 3, strength: 0.9 },
      { source: 'y', target: 'z', shared: 2, strength: 0.8 }, { source: 'c', target: 'x', shared: 1, strength: 0.1 },
    ];
    const clusters = detectClusters(ids, links);
    expect(clusters.get('a')).toBe(clusters.get('b'));
    expect(clusters.get('b')).toBe(clusters.get('c'));
    expect(clusters.get('x')).toBe(clusters.get('z'));
    expect(clusters.get('a')).not.toBe(clusters.get('x'));
    expect(clusters.get('lone')).toBe(2);
    expect(detectClusters(ids, links)).toEqual(clusters);
  });
});

describe('标签和圆', () => {
  it('汉字按一个字号宽，英文窄一些；太长的截短', () => {
    expect(labelWidth('认知卸载')).toBe(48);
    expect(labelWidth('AI')).toBeLessThan(24);
    expect(displayTerm('生成式人工智能伦理')).toBe('生成式人工智能…');
    expect(displayTerm('认知卸载')).toBe('认知卸载');
  });

  it('参与的人越多圆越大；放不进圆的标签放在圆下面，占地框把标签算进去', () => {
    const small = nodeShape({ id: 's', term: '自主学习能力', noteIds: [], authorCount: 1 }, 5);
    const big = nodeShape({ id: 'b', term: 'AI', noteIds: [], authorCount: 5 }, 5);
    expect(big.r).toBeGreaterThan(small.r);
    expect(big.labelInside).toBe(true);
    expect(small.labelInside).toBe(false);
    expect(small.halfW).toBeGreaterThanOrEqual(small.labelWidth / 2);
    expect(small.bottom).toBeGreaterThan(small.r);
  });
});

describe('布局', () => {
  const build = (concepts: LayoutConcept[], width = 720, height = 440, seed?: Map<string, { x: number; y: number }>) => {
    const sorted = [...concepts].sort((a, b) => b.authorCount - a.authorCount || a.term.localeCompare(b.term));
    const maxAuthors = Math.max(...sorted.map(c => c.authorCount));
    const shapes = sorted.map(c => nodeShape(c, maxAuthors));
    const links = selectLinks(sorted);
    const clusters = detectClusters(sorted.map(c => c.id), links);
    return { shapes, ...layoutIdeaGraph(shapes, links, clusters, { width, height, seed }) };
  };

  it('18 个观点：圆和标签两两不叠，位置都在 viewBox 里，比例和画布一致', () => {
    for (const seed of [7, 11, 23]) {
      const { shapes, positions, viewBox } = build(fixture(seed));
      for (let i = 0; i < shapes.length; i++) {
        const p = positions.get(shapes[i].id)!;
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x - shapes[i].halfW).toBeGreaterThanOrEqual(viewBox.x);
        expect(p.x + shapes[i].halfW).toBeLessThanOrEqual(viewBox.x + viewBox.width);
        expect(p.y + shapes[i].top).toBeGreaterThanOrEqual(viewBox.y);
        expect(p.y + shapes[i].bottom).toBeLessThanOrEqual(viewBox.y + viewBox.height);
        for (let j = i + 1; j < shapes.length; j++) {
          expect(shapesOverlap(shapes[i], p, shapes[j], positions.get(shapes[j].id)!), `${shapes[i].id} × ${shapes[j].id}`).toBe(false);
        }
      }
      expect(viewBox.width / viewBox.height).toBeCloseTo(720 / 440, 5);
      expect(viewBox.width).toBeGreaterThanOrEqual(720);
    }
  });

  it('同样的输入同样的结果；图不大时不放大（viewBox 就是画布大小）', () => {
    const a = build(fixture());
    const b = build(fixture());
    expect([...a.positions]).toEqual([...b.positions]);
    const tiny = build(fixture().slice(0, 3));
    expect(tiny.viewBox.width).toBeCloseTo(720, 5);
  });

  it('换一期：从上一期的位置出发，老观点挪得不远；新观点也不和别的叠', () => {
    const first = build(fixture().slice(0, 14));
    const next = build(fixture(), 720, 440, first.positions);
    const moved = [...first.positions].map(([id, p]) => Math.hypot(next.positions.get(id)!.x - p.x, next.positions.get(id)!.y - p.y));
    const median = [...moved].sort((x, y) => x - y)[Math.floor(moved.length / 2)];
    expect(median).toBeLessThan(80);
    for (let i = 0; i < next.shapes.length; i++) {
      for (let j = i + 1; j < next.shapes.length; j++) {
        expect(shapesOverlap(next.shapes[i], next.positions.get(next.shapes[i].id)!, next.shapes[j], next.positions.get(next.shapes[j].id)!)).toBe(false);
      }
    }
  });

  it('一个观点、没有观点也不出错', () => {
    expect(build(fixture().slice(0, 1)).positions.size).toBe(1);
    expect(layoutIdeaGraph([], [], new Map(), { width: 600, height: 400 }).viewBox).toEqual({ x: 0, y: 0, width: 600, height: 400 });
  });
});
