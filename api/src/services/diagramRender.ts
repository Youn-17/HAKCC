/**
 * 关系图、思维导图、时间线由平台自己画（2026-10-09 用户：画出来的图词不达意，没结合对话和记忆）。
 *
 * 生图模型写不准字、排不准结构，而这类图里每个框、每条线都来自对话和笔记，字一个都不能错。
 * 所以由画图规划（drawPlanner）给出结构，这里排版、用 @napi-rs/canvas 画成 PNG。
 * 排版是纯函数（layoutDiagram，测试里用假的量字函数，不依赖字体）；真正动笔只在 renderDiagramPng。
 */

export type DiagramType = 'graph' | 'tree' | 'timeline';
export interface DiagramNode { id: string; label: string; detail?: string }
export interface DiagramEdge { from: string; to: string; label?: string }
export interface DiagramSpec { type: DiagramType; title?: string; nodes: DiagramNode[]; edges: DiagramEdge[] }

/** 每种图最多几个框：再多就挤得看不清，宁可让规划少挑几条 */
export const DIAGRAM_LIMITS: Record<DiagramType, number> = { graph: 12, tree: 16, timeline: 8 };
const LABEL_MAX = 28;
const DETAIL_MAX = 48;
const EDGE_LABEL_MAX = 10;
const TITLE_MAX = 36;
const EDGES_MAX = 24;

const clip = (value: unknown, max: number): string => {
  const text = (typeof value === 'string' || typeof value === 'number' ? String(value) : '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** 沿父节点往上走能不能走回 child：能就说明加上这条边会成环 */
function closesLoop(parent: string, child: string, parentOf: Map<string, string>): boolean {
  let current: string | undefined = parent;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === child) return true;
    seen.add(current);
    current = parentOf.get(current);
  }
  return false;
}

/**
 * 规划给的结构不可全信：去掉没名字的框、重复的 id、指向不存在的框的线、自己连自己的线，数量截到上限。
 * 树只认每个框的第一个父节点；有好几个根时，有标题就补一个以标题为名的根，没标题就改成关系图。
 * 少于两个框画不成图，返回 null。
 */
export function normalizeDiagram(raw: unknown): DiagramSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  let type: DiagramType | null = input.type === 'graph' || input.type === 'tree' || input.type === 'timeline' ? input.type : null;
  if (!type) return null;
  const title = clip(input.title, TITLE_MAX) || undefined;

  const nodes: DiagramNode[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(input.nodes) ? input.nodes : []) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    const label = clip(node.label, LABEL_MAX);
    if (!label) continue;
    const id = clip(node.id, 40) || `n${nodes.length + 1}`;
    if (ids.has(id)) continue;
    ids.add(id);
    const detail = clip(node.detail, DETAIL_MAX);
    nodes.push(detail ? { id, label, detail } : { id, label });
    if (nodes.length >= DIAGRAM_LIMITS[type]) break;
  }
  if (nodes.length < 2) return null;

  let edges: DiagramEdge[] = [];
  if (type !== 'timeline') {
    const pairs = new Set<string>();
    for (const item of Array.isArray(input.edges) ? input.edges : []) {
      if (!item || typeof item !== 'object') continue;
      const edge = item as Record<string, unknown>;
      const from = clip(edge.from, 40);
      const to = clip(edge.to, 40);
      if (!ids.has(from) || !ids.has(to) || from === to) continue;
      const key = `${from}\u0000${to}`;
      if (pairs.has(key)) continue;
      pairs.add(key);
      const label = clip(edge.label, EDGE_LABEL_MAX);
      edges.push(label ? { from, to, label } : { from, to });
      if (edges.length >= EDGES_MAX) break;
    }
  }

  if (type === 'tree') {
    const parentOf = new Map<string, string>();
    const kept: DiagramEdge[] = [];
    for (const edge of edges) {
      if (parentOf.has(edge.to) || closesLoop(edge.from, edge.to, parentOf)) continue;
      parentOf.set(edge.to, edge.from);
      kept.push(edge);
    }
    edges = kept;
    const roots = nodes.filter(n => !parentOf.has(n.id));
    if (roots.length > 1) {
      if (title) {
        const rootId = '__root';
        nodes.unshift({ id: rootId, label: title });
        edges = [...roots.map(r => ({ from: rootId, to: r.id })), ...edges];
      } else {
        type = 'graph';
      }
    }
  }

  return { type, ...(title ? { title } : {}), nodes, edges };
}

// ── 折行 ──────────────────────────────────────────────────────────────────

/** 不能出现在行首的标点：放不下也跟在上一行末尾 */
const NO_LINE_START = /^[，。、；：！？）」』》〉】,.;:!?)\]]$/;

/**
 * 按宽度折行：汉字一个字一个字地排，英文按单词，单词本身比一行还长就按字母断。
 * 超过 maxLines 行时最后一行末尾换成省略号。
 */
export function wrapText(text: string, maxWidth: number, measure: (t: string) => number, maxLines: number): string[] {
  const tokens = text.match(/[⺀-鿿豈-﫿＀-￯　-〿]|[^\s⺀-鿿豈-﫿＀-￯　-〿]+\s*|\s+/g) ?? [];
  const lines: string[] = [];
  let line = '';
  const push = () => { if (line.trim()) lines.push(line.trimEnd()); line = ''; };
  for (const token of tokens) {
    const candidate = line + token;
    if (!line.trim() || measure(candidate.trimEnd()) <= maxWidth || NO_LINE_START.test(token)) {
      if (!line.trim() && measure(token.trimEnd()) > maxWidth) {
        // 一个英文长词比一行还宽：按字母硬断
        for (const ch of token.trimEnd()) {
          if (line && measure(line + ch) > maxWidth) push();
          line += ch;
        }
        continue;
      }
      line = line.trim() ? candidate : token.trimStart();
    } else {
      push();
      line = token.trimStart();
    }
  }
  push();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

// ── 排版 ──────────────────────────────────────────────────────────────────

export type TextRole = 'label' | 'detail' | 'title' | 'edge';
export type Measure = (text: string, role: TextRole) => number;

export interface PlacedNode {
  id: string;
  x: number; y: number; w: number; h: number;
  lines: string[];
  detailLines: string[];
  /** 配色序号（TONES）；-1 = 重点（树根） */
  tone: number;
  /** 时间线上的第几步 */
  step?: number;
}

export interface PlacedEdge {
  from: string; to: string; label?: string;
  /** 三次贝塞尔：起点、两个控制点、终点 */
  curve: [[number, number], [number, number], [number, number], [number, number]];
}

export interface DiagramLayout {
  width: number;
  height: number;
  title?: { text: string; x: number; y: number };
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  /** 时间线的轴 */
  axis?: { x1: number; x2: number; y: number };
}

export const LAYOUT = {
  margin: 32,
  titleHeight: 46,
  padX: 14,
  padY: 10,
  lineHeight: 21,
  detailLineHeight: 17,
  nodeMinWidth: 96,
  nodeMaxWidth: 196,
  timelineNodeMaxWidth: 176,
  gapX: 36,
  gapY: 70,
  treeGapX: 64,
  treeGapY: 14,
  rowMax: 5,
  labelLines: 3,
  detailLines: 2,
} as const;

interface Sized { id: string; w: number; h: number; lines: string[]; detailLines: string[] }

/**
 * 折成几行时把各行排匀：在行数不变的前提下找最窄的宽度。
 * 不排匀的话常常第二行只剩一个字（「答」「案」被拆开），读起来像断了。
 */
export function balancedWrap(text: string, maxWidth: number, measure: (t: string) => number, maxLines: number): string[] {
  const lines = wrapText(text, maxWidth, measure, maxLines);
  if (lines.length < 2 || lines[lines.length - 1].endsWith('…')) return lines;
  if (lines.length === 2) {
    // 两行时，中间附近有冒号、逗号这类停顿就在那里断：「检索练习：/ 先回想再看答案」
    const total = text.trim().length;
    let best: string[] | null = null;
    for (const match of text.matchAll(/[：，、；:,;]/g)) {
      const cut = (match.index ?? 0) + 1;
      const pair = [text.slice(0, cut).trim(), text.slice(cut).trim()];
      if (!pair[0] || !pair[1] || pair.some(l => measure(l) > maxWidth)) continue;
      const gap = Math.abs(pair[0].length - pair[1].length);
      if (gap <= Math.max(2, total * 0.3) && (!best || gap < Math.abs(best[0].length - best[1].length))) best = pair;
    }
    if (best) return best;
  }
  let lo = maxWidth / 2;
  let hi = maxWidth;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const trial = wrapText(text, mid, measure, maxLines);
    if (trial.length === lines.length && !trial[trial.length - 1].endsWith('…')) hi = mid;
    else lo = mid;
  }
  return wrapText(text, hi, measure, maxLines);
}

function sizeNode(node: DiagramNode, measure: Measure, maxWidth: number): Sized {
  const inner = maxWidth - LAYOUT.padX * 2;
  const lines = balancedWrap(node.label, inner, t => measure(t, 'label'), LAYOUT.labelLines);
  const detailLines = node.detail ? balancedWrap(node.detail, inner, t => measure(t, 'detail'), LAYOUT.detailLines) : [];
  const widest = Math.max(
    ...lines.map(l => measure(l, 'label')),
    ...detailLines.map(l => measure(l, 'detail')),
    0,
  );
  const w = Math.round(Math.min(maxWidth, Math.max(LAYOUT.nodeMinWidth, widest + LAYOUT.padX * 2)));
  const h = Math.round(LAYOUT.padY * 2 + lines.length * LAYOUT.lineHeight + (detailLines.length ? 4 + detailLines.length * LAYOUT.detailLineHeight : 0));
  return { id: node.id, w, h, lines, detailLines };
}

const key = (a: string, b: string) => `${a}\u0000${b}`;

/** 上下分层：环里的线在分层时倒过来算，层内按父节点的平均位置排几轮，减少交叉 */
function layoutGraph(spec: DiagramSpec, sized: Map<string, Sized>, top: number): Omit<DiagramLayout, 'width' | 'height' | 'title'> {
  const ids = spec.nodes.map(n => n.id);
  const out = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const e of spec.edges) out.get(e.from)!.push(e.to);

  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      if (state.get(v) === 1) back.add(key(u, v));
      else if (!state.has(v)) visit(v);
    }
    state.set(u, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const dag = spec.edges.map(e => (back.has(key(e.from, e.to)) ? { from: e.to, to: e.from } : { from: e.from, to: e.to }));

  // 最长路径分层
  const indegree = new Map<string, number>(ids.map(id => [id, 0]));
  const next = new Map<string, string[]>(ids.map(id => [id, []]));
  const prev = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const e of dag) {
    next.get(e.from)!.push(e.to);
    prev.get(e.to)!.push(e.from);
    indegree.set(e.to, indegree.get(e.to)! + 1);
  }
  const layerOf = new Map<string, number>(ids.map(id => [id, 0]));
  const queue = ids.filter(id => indegree.get(id) === 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of next.get(u)!) {
      layerOf.set(v, Math.max(layerOf.get(v)!, layerOf.get(u)! + 1));
      indegree.set(v, indegree.get(v)! - 1);
      if (indegree.get(v) === 0) queue.push(v);
    }
  }
  const layerCount = Math.max(...ids.map(id => layerOf.get(id)!)) + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of ids) layers[layerOf.get(id)!].push(id);

  // 层内排序：上下各扫两轮
  const position = new Map<string, number>();
  const reindex = () => layers.forEach(layer => layer.forEach((id, i) => position.set(id, i)));
  reindex();
  const barycenter = (id: string, neighbours: string[]) => {
    if (!neighbours.length) return position.get(id)!;
    return neighbours.reduce((sum, n) => sum + position.get(n)!, 0) / neighbours.length;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const downward = sweep % 2 === 0;
    const order = downward ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const layer of order) {
      const scores = new Map(layer.map(id => [id, barycenter(id, downward ? prev.get(id)! : next.get(id)!)]));
      layer.sort((a, b) => scores.get(a)! - scores.get(b)! || position.get(a)! - position.get(b)!);
      layer.forEach((id, i) => position.set(id, i));
    }
  }

  // 一层太宽就折成几行，图不至于横着拉得很长
  const rows: string[][] = [];
  for (const layer of layers) {
    for (let i = 0; i < layer.length; i += LAYOUT.rowMax) rows.push(layer.slice(i, i + LAYOUT.rowMax));
  }
  const rowWidth = (row: string[]) => row.reduce((sum, id) => sum + sized.get(id)!.w, 0) + LAYOUT.gapX * (row.length - 1);
  const contentWidth = Math.max(...rows.map(rowWidth));
  const placed = new Map<string, PlacedNode>();
  let y = top;
  for (const [r, row] of rows.entries()) {
    let x = LAYOUT.margin + (contentWidth - rowWidth(row)) / 2;
    const rowHeight = Math.max(...row.map(id => sized.get(id)!.h));
    for (const id of row) {
      const s = sized.get(id)!;
      placed.set(id, { id, x: Math.round(x), y: Math.round(y + (rowHeight - s.h) / 2), w: s.w, h: s.h, lines: s.lines, detailLines: s.detailLines, tone: r % TONES.length });
      x += s.w + LAYOUT.gapX;
    }
    y += rowHeight + LAYOUT.gapY;
  }

  const edges: PlacedEdge[] = spec.edges.map(e => {
    const a = placed.get(e.from)!;
    const b = placed.get(e.to)!;
    let curve: PlacedEdge['curve'];
    if (b.y >= a.y + a.h) {
      const p0: [number, number] = [a.x + a.w / 2, a.y + a.h];
      const p3: [number, number] = [b.x + b.w / 2, b.y];
      const dy = (p3[1] - p0[1]) / 2;
      curve = [p0, [p0[0], p0[1] + dy], [p3[0], p3[1] - dy], p3];
    } else if (a.y >= b.y + b.h) {
      const p0: [number, number] = [a.x + a.w / 2, a.y];
      const p3: [number, number] = [b.x + b.w / 2, b.y + b.h];
      const dy = (p0[1] - p3[1]) / 2;
      curve = [p0, [p0[0], p0[1] - dy], [p3[0], p3[1] + dy], p3];
    } else {
      // 同一行：从侧面绕个弧
      const leftToRight = a.x < b.x;
      const p0: [number, number] = [leftToRight ? a.x + a.w : a.x, a.y + a.h / 2];
      const p3: [number, number] = [leftToRight ? b.x : b.x + b.w, b.y + b.h / 2];
      const lift = Math.min(60, 18 + Math.abs(p3[0] - p0[0]) / 6);
      curve = [p0, [p0[0] + (leftToRight ? 20 : -20), p0[1] - lift], [p3[0] + (leftToRight ? -20 : 20), p3[1] - lift], p3];
    }
    return { from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}), curve };
  });

  return { nodes: [...placed.values()], edges };
}

/** 从左往右的树：叶子从上往下依次排，父节点对齐到孩子中间；每一枝一个颜色 */
function layoutTree(spec: DiagramSpec, sized: Map<string, Sized>, top: number): Omit<DiagramLayout, 'width' | 'height' | 'title'> {
  const children = new Map<string, string[]>(spec.nodes.map(n => [n.id, []]));
  const hasParent = new Set<string>();
  for (const e of spec.edges) { children.get(e.from)!.push(e.to); hasParent.add(e.to); }
  const root = spec.nodes.find(n => !hasParent.has(n.id))!.id;
  // 规范化之后不该有，但万一有走不到的框，挂到根下面，别丢
  const reachable = new Set<string>();
  const walk = (id: string) => { reachable.add(id); for (const c of children.get(id)!) if (!reachable.has(c)) walk(c); };
  walk(root);
  for (const n of spec.nodes) if (!reachable.has(n.id)) { children.get(root)!.push(n.id); walk(n.id); }

  const depthOf = new Map<string, number>();
  const toneOf = new Map<string, number>();
  const assign = (id: string, depth: number, tone: number) => {
    depthOf.set(id, depth);
    toneOf.set(id, tone);
    children.get(id)!.forEach((c, i) => assign(c, depth + 1, depth === 0 ? i % TONES.length : tone));
  };
  assign(root, 0, -1);
  const maxDepth = Math.max(...depthOf.values());
  const colWidth = Array.from({ length: maxDepth + 1 }, (_, d) => Math.max(...spec.nodes.filter(n => depthOf.get(n.id) === d).map(n => sized.get(n.id)!.w)));
  const colX: number[] = [];
  let x = LAYOUT.margin;
  for (let d = 0; d <= maxDepth; d++) { colX.push(x); x += colWidth[d] + LAYOUT.treeGapX; }

  const placed = new Map<string, PlacedNode>();
  // 叶子按全局游标往下排；同一列里父节点比孩子们还高时，可能顶到上面那个兄弟，所以每列记着最低的框
  let cursor = top;
  const colBottom = new Map<number, number>();
  const place = (id: string): { cy: number } => {
    const s = sized.get(id)!;
    const d = depthOf.get(id)!;
    const kids = children.get(id)!;
    const floor = (colBottom.get(d) ?? -Infinity) + LAYOUT.treeGapY;
    let y: number;
    if (!kids.length) {
      y = Math.max(cursor, floor);
      cursor = y + s.h + LAYOUT.treeGapY;
    } else {
      const spans = kids.map(place);
      const mid = (spans[0].cy + spans[spans.length - 1].cy) / 2;
      y = Math.max(mid - s.h / 2, floor, top);
      cursor = Math.max(cursor, y + s.h + LAYOUT.treeGapY);
    }
    colBottom.set(d, y + s.h);
    placed.set(id, { id, x: colX[d], y: Math.round(y), w: s.w, h: s.h, lines: s.lines, detailLines: s.detailLines, tone: toneOf.get(id)! });
    return { cy: y + s.h / 2 };
  };
  place(root);

  const edges: PlacedEdge[] = [];
  for (const [parent, kids] of children) {
    const a = placed.get(parent)!;
    for (const kid of kids) {
      const b = placed.get(kid)!;
      const p0: [number, number] = [a.x + a.w, a.y + a.h / 2];
      const p3: [number, number] = [b.x, b.y + b.h / 2];
      const dx = (p3[0] - p0[0]) / 2;
      const label = spec.edges.find(e => e.from === parent && e.to === kid)?.label;
      edges.push({ from: parent, to: kid, ...(label ? { label } : {}), curve: [p0, [p0[0] + dx, p0[1]], [p3[0] - dx, p3[1]], p3] });
    }
  }
  return { nodes: [...placed.values()], edges };
}

/** 横向时间线：框在轴的上下交替，轴上的圆点写着第几步 */
function layoutTimeline(spec: DiagramSpec, sized: Map<string, Sized>, top: number): Omit<DiagramLayout, 'width' | 'height' | 'title'> {
  const slot = Math.max(...spec.nodes.map(n => sized.get(n.id)!.w)) + 28;
  const above = spec.nodes.filter((_, i) => i % 2 === 0).map(n => sized.get(n.id)!.h);
  const stem = 22;
  const axisY = top + Math.max(...above) + stem + 12;
  const nodes: PlacedNode[] = spec.nodes.map((n, i) => {
    const s = sized.get(n.id)!;
    const cx = LAYOUT.margin + slot * i + slot / 2;
    const y = i % 2 === 0 ? axisY - stem - 12 - s.h : axisY + stem + 12;
    return { id: n.id, x: Math.round(cx - s.w / 2), y: Math.round(y), w: s.w, h: s.h, lines: s.lines, detailLines: s.detailLines, tone: 0, step: i + 1 };
  });
  const firstX = LAYOUT.margin + slot / 2;
  return { nodes, edges: [], axis: { x1: firstX - 24, x2: firstX + slot * (spec.nodes.length - 1) + 24, y: axisY } };
}

export function layoutDiagram(spec: DiagramSpec, measure: Measure): DiagramLayout {
  const maxWidth = spec.type === 'timeline' ? LAYOUT.timelineNodeMaxWidth : LAYOUT.nodeMaxWidth;
  const sized = new Map(spec.nodes.map(n => [n.id, sizeNode(n, measure, maxWidth)]));
  const top = LAYOUT.margin + (spec.title ? LAYOUT.titleHeight : 0);
  const body = spec.type === 'tree' ? layoutTree(spec, sized, top)
    : spec.type === 'timeline' ? layoutTimeline(spec, sized, top)
      : layoutGraph(spec, sized, top);

  const right = Math.max(...body.nodes.map(n => n.x + n.w), body.axis ? body.axis.x2 : 0);
  const bottom = Math.max(...body.nodes.map(n => n.y + n.h));
  const titleWidth = spec.title ? measure(spec.title, 'title') : 0;
  const width = Math.round(Math.max(480, right + LAYOUT.margin, LAYOUT.margin * 2 + titleWidth));
  const height = Math.round(bottom + LAYOUT.margin);
  return {
    width,
    height,
    ...(spec.title ? { title: { text: spec.title, x: LAYOUT.margin, y: LAYOUT.margin + 20 } } : {}),
    ...body,
  };
}

// ── 动笔 ──────────────────────────────────────────────────────────────────

/** 填充色、描边色。和平台的莫兰迪色板同一个调子，浅底深字 */
export const TONES: ReadonlyArray<readonly [string, string]> = [
  ['#EEF2FB', '#9AABD3'],
  ['#EDF4EE', '#9CBFA3'],
  ['#F7F0E3', '#D2B57F'],
  ['#F6EBEB', '#D1A1A1'],
  ['#F1EDF6', '#B3A3CC'],
  ['#EFF1F3', '#AEB8C2'],
];
const NAVY = '#000080';
const INK = '#1F2937';
const MUTED = '#64748B';
const LINE = '#94A3B8';

/** 和 fileGenerator 的图表同一组字体：服务器上是 fonts-noto-cjk（TTC 只认得出 JP 那个名字） */
const FONT_FAMILY = "'Noto Sans CJK SC', 'Noto Sans CJK JP', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'DejaVu Sans', sans-serif";
const FONTS: Record<TextRole, string> = {
  label: `600 15px ${FONT_FAMILY}`,
  detail: `400 12px ${FONT_FAMILY}`,
  title: `700 18px ${FONT_FAMILY}`,
  edge: `500 12px ${FONT_FAMILY}`,
};
const SCALE = 2;

type CanvasModule = typeof import('@napi-rs/canvas');
let canvasLoad: Promise<CanvasModule | null> | null = null;
let chineseOk: boolean | null = null;

// 第一次画时才加载：原生模块加载失败只让这类图画不成，不能拖垮整个进程
function loadCanvas(): Promise<CanvasModule | null> {
  canvasLoad ??= import('@napi-rs/canvas').catch((err: Error) => {
    console.warn('[diagramRender] @napi-rs/canvas unavailable:', err.message);
    return null;
  });
  return canvasLoad;
}

/** 缺中文字体时每个字都画成同一个方块：两个不同的汉字画得一模一样，就是没有可用的中文字体 */
function rendersChinese(mod: CanvasModule): boolean {
  if (chineseOk !== null) return chineseOk;
  const glyph = (ch: string) => {
    const canvas = mod.createCanvas(40, 40);
    const ctx = canvas.getContext('2d');
    ctx.font = `28px ${FONT_FAMILY}`;
    ctx.fillText(ch, 4, 32);
    return Buffer.from(ctx.getImageData(0, 0, 40, 40).data);
  };
  chineseOk = !glyph('学').equals(glyph('生'));
  return chineseOk;
}

const HAS_CJK = /[⺀-鿿豈-﫿]/;

export type RenderResult = { ok: true; png: Buffer; width: number; height: number } | { ok: false; error: string };

export async function renderDiagramPng(spec: DiagramSpec): Promise<RenderResult> {
  const mod = await loadCanvas();
  if (!mod) return { ok: false, error: '服务器上画图组件不可用' };
  const allText = [spec.title ?? '', ...spec.nodes.flatMap(n => [n.label, n.detail ?? '']), ...spec.edges.map(e => e.label ?? '')].join('');
  if (HAS_CJK.test(allText) && !rendersChinese(mod)) return { ok: false, error: '服务器上没有中文字体' };

  const probe = mod.createCanvas(10, 10).getContext('2d');
  const measure: Measure = (text, role) => { probe.font = FONTS[role]; return probe.measureText(text).width; };
  const layout = layoutDiagram(spec, measure);

  const canvas = mod.createCanvas(layout.width * SCALE, layout.height * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.textBaseline = 'middle';

  if (layout.title) {
    ctx.font = FONTS.title;
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.fillText(layout.title.text, layout.title.x, layout.title.y);
  }

  if (layout.axis) {
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(layout.axis.x1, layout.axis.y);
    ctx.lineTo(layout.axis.x2, layout.axis.y);
    ctx.stroke();
    drawArrowHead(ctx, [layout.axis.x2 - 10, layout.axis.y], [layout.axis.x2, layout.axis.y], '#CBD5E1');
  }

  // 线先画，框盖在线上面
  for (const edge of layout.edges) {
    const [p0, c1, c2, p3] = edge.curve;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p3[0], p3[1]);
    ctx.stroke();
    drawArrowHead(ctx, c2, p3, LINE);
  }

  for (const node of layout.nodes) {
    if (node.step !== undefined && layout.axis) {
      const cx = node.x + node.w / 2;
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, node.y < layout.axis.y ? node.y + node.h : node.y);
      ctx.lineTo(cx, layout.axis.y);
      ctx.stroke();
      ctx.fillStyle = NAVY;
      ctx.beginPath();
      ctx.arc(cx, layout.axis.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 11px ${FONT_FAMILY}`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(String(node.step), cx, layout.axis.y + 0.5);
    }
    const emphasis = node.tone < 0;
    const [fill, stroke] = emphasis ? [NAVY, NAVY] : TONES[node.tone % TONES.length];
    roundRect(ctx, node.x, node.y, node.w, node.h, 10);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.textAlign = 'center';
    const cx = node.x + node.w / 2;
    let y = node.y + LAYOUT.padY + LAYOUT.lineHeight / 2;
    ctx.font = FONTS.label;
    ctx.fillStyle = emphasis ? '#FFFFFF' : INK;
    for (const line of node.lines) { ctx.fillText(line, cx, y); y += LAYOUT.lineHeight; }
    if (node.detailLines.length) {
      y += 4 - LAYOUT.lineHeight / 2 + LAYOUT.detailLineHeight / 2;
      ctx.font = FONTS.detail;
      ctx.fillStyle = emphasis ? '#E0E7FF' : MUTED;
      for (const line of node.detailLines) { ctx.fillText(line, cx, y); y += LAYOUT.detailLineHeight; }
    }
  }

  // 线上的字最后画，带白底，压在线和框上面都看得清
  ctx.font = FONTS.edge;
  for (const edge of layout.edges) {
    if (!edge.label) continue;
    const [x, y] = bezierPoint(edge.curve, 0.5);
    const w = measure(edge.label, 'edge') + 12;
    roundRect(ctx, x - w / 2, y - 10, w, 20, 10);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'center';
    ctx.fillText(edge.label, x, y + 0.5);
  }

  return { ok: true, png: canvas.toBuffer('image/png'), width: layout.width, height: layout.height };
}

type Ctx2D = ReturnType<ReturnType<CanvasModule['createCanvas']>['getContext']>;

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawArrowHead(ctx: Ctx2D, from: [number, number], to: [number, number], color: string) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const size = 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - size * Math.cos(angle - Math.PI / 7), to[1] - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(to[0] - size * Math.cos(angle + Math.PI / 7), to[1] - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

export function bezierPoint(curve: PlacedEdge['curve'], t: number): [number, number] {
  const [p0, p1, p2, p3] = curve;
  const u = 1 - t;
  const coord = (i: 0 | 1) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return [coord(0), coord(1)];
}
