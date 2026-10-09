import { describe, expect, it } from 'vitest';
import {
  DIAGRAM_LIMITS,
  balancedWrap,
  bezierPoint,
  layoutDiagram,
  normalizeDiagram,
  renderDiagramPng,
  wrapText,
  type DiagramLayout,
  type DiagramSpec,
  type Measure,
} from './diagramRender';

/**
 * 平台自己画的关系图、思维导图、时间线（2026-10-09）。
 * 排版用假的量字函数测（汉字按字号宽、英文按半宽），不依赖服务器上有没有字体；动笔另测一次能出 PNG。
 */

const SIZE = { label: 15, detail: 12, title: 18, edge: 12 } as const;
const fakeMeasure: Measure = (text, role) => [...text].reduce((w, ch) => w + (/[⺀-鿿＀-￯　-〿]/.test(ch) ? SIZE[role] : SIZE[role] * 0.55), 0);

function overlaps(layout: DiagramLayout): string[] {
  const out: string[] = [];
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id}×${b.id}`);
    }
  }
  return out;
}

function insideCanvas(layout: DiagramLayout): boolean {
  return layout.nodes.every(n => n.x >= 0 && n.y >= 0 && n.x + n.w <= layout.width && n.y + n.h <= layout.height);
}

describe('normalizeDiagram：规划给的结构不可全信', () => {
  it('不认识的类型、少于两个框：画不成', () => {
    expect(normalizeDiagram({ type: 'pie', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })).toBeNull();
    expect(normalizeDiagram({ type: 'graph', nodes: [{ id: 'a', label: '只有一个' }] })).toBeNull();
    expect(normalizeDiagram(null)).toBeNull();
  });

  it('去掉没名字的框、重复的 id、指向不存在的框和自己连自己的线、重复的线', () => {
    const spec = normalizeDiagram({
      type: 'graph',
      title: '  观点之间  ',
      nodes: [{ id: 'a', label: '观点一' }, { id: 'a', label: '重复' }, { id: 'b', label: '' }, { id: 'c', label: '观点三' }, { label: '没有 id' }],
      edges: [{ from: 'a', to: 'c', label: '延伸' }, { from: 'a', to: 'c' }, { from: 'a', to: 'a' }, { from: 'a', to: 'zz' }, { from: 'c', to: 'n3' }],
    })!;
    expect(spec.title).toBe('观点之间');
    expect(spec.nodes.map(n => n.id)).toEqual(['a', 'c', 'n3']);
    expect(spec.edges).toEqual([{ from: 'a', to: 'c', label: '延伸' }, { from: 'c', to: 'n3' }]);
  });

  it('框数截到上限，过长的字收成省略号', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `第${i}个想法`.repeat(i === 0 ? 10 : 1) }));
    const spec = normalizeDiagram({ type: 'timeline', nodes, edges: [{ from: 'n0', to: 'n1' }] })!;
    expect(spec.nodes).toHaveLength(DIAGRAM_LIMITS.timeline);
    expect(spec.nodes[0].label.endsWith('…')).toBe(true);
    expect(spec.nodes[0].label.length).toBeLessThanOrEqual(28);
    // 时间线按顺序排，不用线
    expect(spec.edges).toEqual([]);
  });

  it('树：每个框只认第一个父节点、不成环；有几个根时有标题就补一个根，没标题就改成关系图', () => {
    const tree = normalizeDiagram({
      type: 'tree',
      title: 'AI 与学习',
      nodes: [{ id: 'a', label: '思考' }, { id: 'b', label: '记忆' }, { id: 'c', label: '提问' }, { id: 'd', label: '检索' }],
      edges: [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'b', to: 'd' }],
    })!;
    expect(tree.type).toBe('tree');
    expect(tree.nodes[0]).toEqual({ id: '__root', label: 'AI 与学习' });
    expect(tree.edges).toEqual([{ from: '__root', to: 'a' }, { from: '__root', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }]);

    const forest = normalizeDiagram({ type: 'tree', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [] })!;
    expect(forest.type).toBe('graph');
  });
});

describe('wrapText', () => {
  const m = (t: string) => fakeMeasure(t, 'label');

  it('汉字按宽度折行，标点不放在行首', () => {
    // 每行 5 个汉字宽
    expect(wrapText('学生先自己回想，再看答案', 75, m, 3)).toEqual(['学生先自己', '回想，再看', '答案']);
    expect(wrapText('一二三四五，六', 75, m, 3)).toEqual(['一二三四五，', '六']);
  });

  it('英文按单词折，过长的单词按字母断', () => {
    expect(wrapText('retrieval practice works', 90, m, 3)).toEqual(['retrieval', 'practice', 'works']);
    expect(wrapText('supercalifragilistic', 60, m, 3).every(l => m(l) <= 60)).toBe(true);
  });

  it('超过行数：最后一行收成省略号，宽度不超', () => {
    const lines = wrapText('这是一段很长很长的标签文字需要被截断显示', 75, m, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(m(lines[1])).toBeLessThanOrEqual(75);
  });
});

describe('balancedWrap', () => {
  const m = (t: string) => fakeMeasure(t, 'label');
  it('行数不变，把字排匀：第二行不会只剩一个字', () => {
    // 宽 12 个汉字时「检索练习：先回想再看答案」是 11+1，排匀后两行差不多长
    expect(wrapText('检索练习：先回想再看答案', 165, m, 3)).toEqual(['检索练习：先回想再看答', '案']);
    // 中间附近有冒号：在冒号后面断
    expect(balancedWrap('检索练习：先回想再看答案', 165, m, 3)).toEqual(['检索练习：', '先回想再看答案']);
    // 没有停顿：排匀
    const lines = balancedWrap('先写提纲再问人工智能答错的地方自己找', 165, m, 3);
    expect(lines).toHaveLength(2);
    expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThanOrEqual(1);
  });
  it('一行放得下的、要截断的，原样不动', () => {
    expect(balancedWrap('先写提纲', 165, m, 3)).toEqual(['先写提纲']);
    const cut = balancedWrap('这是一段很长很长的标签文字需要被截断显示', 75, m, 2);
    expect(cut[1].endsWith('…')).toBe(true);
  });
});

describe('layoutDiagram', () => {
  const graph: DiagramSpec = {
    type: 'graph',
    title: '大家对「AI 会不会让人更少思考」的看法',
    nodes: [
      { id: 'q', label: 'AI 会让我们更少思考吗？' },
      { id: 'a', label: '不只是懒，是「想」这一步被外包了', detail: '王雨桐' },
      { id: 'b', label: '用得好反而逼人多想' },
      { id: 'c', label: '检索练习：先回想再看答案' },
      { id: 'd', label: '先写提纲再问 AI' },
      { id: 'e', label: '「自己思考」指什么' },
      { id: 'f', label: '查资料算不算' },
    ],
    edges: [
      { from: 'a', to: 'q', label: '回应' }, { from: 'b', to: 'q', label: '质疑' }, { from: 'c', to: 'a', label: '证据' },
      { from: 'd', to: 'b', label: '延伸' }, { from: 'e', to: 'b', label: '提问' }, { from: 'f', to: 'e' }, { from: 'q', to: 'f' },
    ],
  };

  it('关系图：每个框都放下了，不重叠，都在画布里；有环也排得出', () => {
    const layout = layoutDiagram(graph, fakeMeasure);
    expect(layout.nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'q']);
    expect(overlaps(layout)).toEqual([]);
    expect(insideCanvas(layout)).toBe(true);
    expect(layout.title?.text).toBe(graph.title);
    // 线的两头落在框边上
    for (const edge of layout.edges) {
      const a = layout.nodes.find(n => n.id === edge.from)!;
      const b = layout.nodes.find(n => n.id === edge.to)!;
      const [start, , , end] = edge.curve;
      const onEdge = (n: typeof a, [x, y]: [number, number]) => x >= n.x - 0.5 && x <= n.x + n.w + 0.5 && y >= n.y - 0.5 && y <= n.y + n.h + 0.5;
      expect(onEdge(a, start)).toBe(true);
      expect(onEdge(b, end)).toBe(true);
    }
  });

  it('一层太多时折成几行，图不会横着拉得很长', () => {
    const wide: DiagramSpec = {
      type: 'graph',
      nodes: [{ id: 'r', label: '中心' }, ...Array.from({ length: 10 }, (_, i) => ({ id: `k${i}`, label: `想法${i + 1}` }))],
      edges: Array.from({ length: 10 }, (_, i) => ({ from: 'r', to: `k${i}` })),
    };
    const layout = layoutDiagram(wide, fakeMeasure);
    expect(overlaps(layout)).toEqual([]);
    const rows = new Set(layout.nodes.filter(n => n.id !== 'r').map(n => n.y));
    expect(rows.size).toBeGreaterThanOrEqual(2);
  });

  it('思维导图：根在最左边、加粗配色，孩子在右边一列，不重叠', () => {
    const tree: DiagramSpec = {
      type: 'tree',
      nodes: [
        { id: 'r', label: '生成式 AI 与思考' },
        { id: 'a', label: '担心', detail: '想的这一步被外包' }, { id: 'b', label: '机会' },
        { id: 'a1', label: '直接拿答案' }, { id: 'a2', label: '记得更少' },
        { id: 'b1', label: '检索练习' }, { id: 'b2', label: '先写提纲再问 AI，答错的地方要自己找出来' },
      ],
      edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'b' }, { from: 'a', to: 'a1' }, { from: 'a', to: 'a2' }, { from: 'b', to: 'b1' }, { from: 'b', to: 'b2' }],
    };
    const layout = layoutDiagram(tree, fakeMeasure);
    const byId = new Map(layout.nodes.map(n => [n.id, n]));
    expect(overlaps(layout)).toEqual([]);
    expect(insideCanvas(layout)).toBe(true);
    expect(byId.get('r')!.tone).toBe(-1);
    expect(byId.get('a')!.x).toBeGreaterThan(byId.get('r')!.x);
    expect(byId.get('a1')!.x).toBeGreaterThan(byId.get('a')!.x);
    // 两枝颜色不同，枝上的孩子跟着枝走
    expect(byId.get('a')!.tone).not.toBe(byId.get('b')!.tone);
    expect(byId.get('a1')!.tone).toBe(byId.get('a')!.tone);
  });

  it('父节点比孩子还高时，也不顶到上面那个兄弟', () => {
    const tall: DiagramSpec = {
      type: 'tree',
      nodes: [
        { id: 'r', label: '根' },
        { id: 'a', label: '短' }, { id: 'a1', label: '叶' },
        { id: 'b', label: '这是一个非常非常长的分支标题，会折成好几行', detail: '还有一行补充说明，也会折行' }, { id: 'b1', label: '叶' },
      ],
      edges: [{ from: 'r', to: 'a' }, { from: 'a', to: 'a1' }, { from: 'r', to: 'b' }, { from: 'b', to: 'b1' }],
    };
    expect(overlaps(layoutDiagram(tall, fakeMeasure))).toEqual([]);
  });

  it('时间线：从左到右按顺序，框在轴上下交替，写着第几步', () => {
    const steps: DiagramSpec = {
      type: 'timeline',
      nodes: ['提出问题', '查资料', '写下自己的解释', '同学 Build-on', '修改笔记'].map((label, i) => ({ id: `s${i}`, label })),
      edges: [],
    };
    const layout = layoutDiagram(steps, fakeMeasure);
    expect(overlaps(layout)).toEqual([]);
    const xs = layout.nodes.map(n => n.x + n.w / 2);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(layout.nodes.map(n => n.step)).toEqual([1, 2, 3, 4, 5]);
    expect(layout.nodes[0].y < layout.axis!.y).toBe(true);
    expect(layout.nodes[1].y > layout.axis!.y).toBe(true);
  });

  it('bezierPoint 取到两端和中间', () => {
    const curve: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [0, 10], [10, 10], [10, 20]];
    expect(bezierPoint(curve, 0)).toEqual([0, 0]);
    expect(bezierPoint(curve, 1)).toEqual([10, 20]);
    expect(bezierPoint(curve, 0.5)).toEqual([5, 10]);
  });
});

describe('renderDiagramPng', () => {
  it('画出一张 PNG（英文标签，不依赖中文字体）', async () => {
    const result = await renderDiagramPng({
      type: 'graph',
      title: 'Retrieval practice',
      nodes: [{ id: 'a', label: 'Recall first' }, { id: 'b', label: 'Then check the answer', detail: 'Roediger 2006' }],
      edges: [{ from: 'a', to: 'b', label: 'then' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.png.subarray(0, 4).toString('hex')).toBe('89504e47');
      expect(result.width).toBeGreaterThanOrEqual(480);
    }
  });

  it('中文标签：有中文字体就画，没有就说清楚（交给调用方换生图模型）', async () => {
    const result = await renderDiagramPng({
      type: 'tree',
      nodes: [{ id: 'r', label: '检索练习' }, { id: 'a', label: '先回想' }, { id: 'b', label: '再看答案' }],
      edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'b' }],
    });
    if (!result.ok) expect(result.error).toMatch(/中文字体|画图组件/);
    else expect(result.png.length).toBeGreaterThan(1000);
  });
});
