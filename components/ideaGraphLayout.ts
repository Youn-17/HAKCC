/**
 * 观点图谱的连线、分群与布局（2026-10-11 用户：显示要更自然，现在有的叠在一起；底层算法能不能优化）。
 * 纯函数，不碰 DOM；同样的输入得到同样的结果。
 *
 * 连线：原来按「同一条笔记里共同出现的次数」取前 34 条。出现得多的词和谁都能共现，
 * 图就糊成以它为中心的一团。现在按关联强度 shared / √(nA·nB)（Ochiai 系数：相对两个观点各自出现的次数，
 * 它们有多常一起出现）：先取最大生成树，每个观点都连上和它最相关的那个；再按强度补，太弱的不补。
 *
 * 分群：在选出的连线上按模块度做一层局部移动（Louvain 的第一步），常一起出现的观点归成一群，用颜色区分。
 * 只分群、不起名字 —— 图谱只做定位，不替学生下结论。
 *
 * 布局：力导向。斥力、碰撞都按「圆 + 标签」实际占的地方算（标签放不进圆就放在圆下面），同群的观点互相靠近。
 * 模拟完不去缩放位置（缩了又会叠住），而是给出一个刚好装下全图的 viewBox，由 SVG 整体缩放显示。
 * 原来在模拟途中把点硬卡在边框里，挤到边上的点会叠在一起。
 * 换一期时把当前的位置当起点（seed），同一个观点大致留在原处，看得出图是怎么长出来的。
 */

export interface LayoutConcept {
  /** 稳定的键：用观点本身（各期的 id 是按排名编的 c0、c1，换一期就对不上） */
  id: string;
  term: string;
  noteIds: string[];
  authorCount: number;
}

export interface ConceptLink {
  source: string;
  target: string;
  /** 一起出现的笔记数 */
  shared: number;
  /** 关联强度 0–1 */
  strength: number;
}

export interface Point { x: number; y: number }
export interface ViewBox { x: number; y: number; width: number; height: number }

/** 生成树之外再补的连线，强度至少要到这个数，太弱的补上只会添乱 */
const EXTRA_LINK_MIN_STRENGTH = 0.2;

/** 两两共现：至少在一条笔记里一起出现过 */
export function conceptAssociations(concepts: LayoutConcept[]): ConceptLink[] {
  const sets = concepts.map(c => new Set(c.noteIds));
  const links: ConceptLink[] = [];
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      let shared = 0;
      for (const id of sets[i]) if (sets[j].has(id)) shared++;
      if (shared === 0) continue;
      links.push({ source: concepts[i].id, target: concepts[j].id, shared, strength: shared / Math.sqrt(sets[i].size * sets[j].size) });
    }
  }
  return links;
}

const byStrength = (a: ConceptLink, b: ConceptLink) =>
  b.strength - a.strength || b.shared - a.shared || `${a.source}|${a.target}`.localeCompare(`${b.source}|${b.target}`);

/** 最大生成树（每个观点都连上和它最相关的那个）+ 按强度补到 max 条 */
export function selectLinks(concepts: LayoutConcept[], max = 34): ConceptLink[] {
  const all = conceptAssociations(concepts).sort(byStrength);
  const parent = new Map(concepts.map(c => [c.id, c.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) { const next = parent.get(cur)!; parent.set(cur, root); cur = next; }
    return root;
  };
  const chosen: ConceptLink[] = [];
  const extra: ConceptLink[] = [];
  for (const link of all) {
    const a = find(link.source);
    const b = find(link.target);
    if (a !== b) { parent.set(a, b); chosen.push(link); } else extra.push(link);
  }
  for (const link of extra) {
    if (chosen.length >= max) break;
    if (link.strength >= EXTRA_LINK_MIN_STRENGTH) chosen.push(link);
  }
  return chosen.slice(0, Math.max(0, max)).sort(byStrength);
}

/**
 * 分群：返回 观点 → 群号。群号按群的大小排（0 最大），一样大按群里排在最前的观点；没有连线的各自一群。
 */
export function detectClusters(ids: string[], links: ConceptLink[]): Map<string, number> {
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const adj: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
  let m2 = 0;
  for (const link of links) {
    const a = index.get(link.source);
    const b = index.get(link.target);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + link.strength);
    adj[b].set(a, (adj[b].get(a) ?? 0) + link.strength);
    m2 += 2 * link.strength;
  }
  const degree = adj.map(nb => [...nb.values()].reduce((sum, w) => sum + w, 0));
  const community = ids.map((_, i) => i);
  const total = degree.slice();
  if (m2 > 0) {
    for (let pass = 0; pass < 20; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        if (degree[i] === 0) continue;
        const own = community[i];
        total[own] -= degree[i];
        const weightTo = new Map<number, number>();
        for (const [j, w] of adj[i]) weightTo.set(community[j], (weightTo.get(community[j]) ?? 0) + w);
        let best = own;
        let bestGain = (weightTo.get(own) ?? 0) - (total[own] * degree[i]) / m2;
        for (const [c, w] of [...weightTo.entries()].sort((x, y) => x[0] - y[0])) {
          const gain = w - (total[c] * degree[i]) / m2;
          if (gain > bestGain + 1e-9) { best = c; bestGain = gain; }
        }
        total[best] += degree[i];
        if (best !== own) { community[i] = best; moved = true; }
      }
      if (!moved) break;
    }
  }
  const members = new Map<number, number[]>();
  community.forEach((c, i) => { if (!members.has(c)) members.set(c, []); members.get(c)!.push(i); });
  const ranked = [...members.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  const out = new Map<string, number>();
  ranked.forEach((list, rank) => list.forEach(i => out.set(ids[i], rank)));
  return out;
}

export const LABEL_FONT = 12;
const MAX_LABEL_CHARS = 8;
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;

/** 太长的观点在图上截短（完整的在提示里和右边栏） */
export function displayTerm(term: string): string {
  const chars = [...term];
  return chars.length > MAX_LABEL_CHARS ? `${chars.slice(0, MAX_LABEL_CHARS - 1).join('')}…` : term;
}

/** 估算标签宽度（不量 DOM）：汉字和全角一个字号宽，英文字母大约六成 */
export function labelWidth(text: string, fontSize = LABEL_FONT): number {
  let width = 0;
  for (const ch of text) {
    if (CJK.test(ch)) width += fontSize;
    else if (ch === ' ') width += fontSize * 0.3;
    else if (/[A-Z]/.test(ch)) width += fontSize * 0.68;
    else width += fontSize * 0.56;
  }
  return Math.ceil(width);
}

export interface NodeShape {
  id: string;
  r: number;
  label: string;
  labelWidth: number;
  /** 标签放在圆里；放不下就放在圆下面 */
  labelInside: boolean;
  /** 占地框（相对圆心）：左右各 halfW，上到 top（负数），下到 bottom */
  halfW: number;
  top: number;
  bottom: number;
}

/** 圆的大小按参与讨论的人数（面积大致成比例），标签放得下就放圆里 */
export function nodeShape(concept: LayoutConcept, maxAuthors: number): NodeShape {
  const r = Math.round(16 + 22 * Math.sqrt(Math.max(concept.authorCount, 0) / Math.max(maxAuthors, 1)));
  const label = displayTerm(concept.term);
  const width = labelWidth(label);
  const inside = width <= 2 * r - 10;
  return {
    id: concept.id,
    r,
    label,
    labelWidth: width,
    labelInside: inside,
    halfW: inside ? r : Math.max(r, width / 2 + 4),
    top: -r,
    bottom: inside ? r : r + 6 + LABEL_FONT + 2,
  };
}

/** 两个观点之间至少留这么宽的空 */
const GAP = 8;

interface SimNode { shape: NodeShape; x: number; y: number; vx: number; vy: number; cluster: number }

/** 把叠在一起的推开。两个都是纯圆时按圆心连线推，其余按占地框沿重叠少的方向推。返回这一轮有没有重叠 */
function separate(nodes: SimNode[], strength: number): boolean {
  let overlapped = false;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const massA = a.shape.r * a.shape.r;
      const massB = b.shape.r * b.shape.r;
      const shareA = massB / (massA + massB);
      const shareB = 1 - shareA;
      if (a.shape.labelInside && b.shape.labelInside) {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const need = a.shape.r + b.shape.r + GAP;
        if (d >= need) continue;
        overlapped = true;
        if (d < 1e-6) { dx = 1; dy = (j - i) * 0.01; d = Math.hypot(dx, dy); }
        const push = ((need - d) / d) * strength;
        a.x -= dx * push * shareA; a.y -= dy * push * shareA;
        b.x += dx * push * shareB; b.y += dy * push * shareB;
        continue;
      }
      const overlapX = Math.min(a.x + a.shape.halfW, b.x + b.shape.halfW) - Math.max(a.x - a.shape.halfW, b.x - b.shape.halfW) + GAP;
      const overlapY = Math.min(a.y + a.shape.bottom, b.y + b.shape.bottom) - Math.max(a.y + a.shape.top, b.y + b.shape.top) + GAP;
      if (overlapX <= 0 || overlapY <= 0) continue;
      overlapped = true;
      if (overlapX < overlapY) {
        const dir = Math.sign(b.x - a.x) || 1;
        a.x -= dir * overlapX * strength * shareA;
        b.x += dir * overlapX * strength * shareB;
      } else {
        const ca = a.y + (a.shape.top + a.shape.bottom) / 2;
        const cb = b.y + (b.shape.top + b.shape.bottom) / 2;
        const dir = Math.sign(cb - ca) || 1;
        a.y -= dir * overlapY * strength * shareA;
        b.y += dir * overlapY * strength * shareB;
      }
    }
  }
  return overlapped;
}

/** 刚好装下全图的 viewBox：至少和画布一样大（小图不放大字），比例和画布一致 */
export function fitViewBox(shapes: NodeShape[], positions: Map<string, Point>, width: number, height: number, margin = 28): ViewBox {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const s of shapes) {
    const p = positions.get(s.id);
    if (!p) continue;
    left = Math.min(left, p.x - s.halfW); right = Math.max(right, p.x + s.halfW);
    top = Math.min(top, p.y + s.top); bottom = Math.max(bottom, p.y + s.bottom);
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0, width, height };
  let w = Math.max(right - left + margin * 2, width);
  let h = Math.max(bottom - top + margin * 2, height);
  if (w / h > width / height) h = (w * height) / width;
  else w = (h * width) / height;
  return { x: (left + right) / 2 - w / 2, y: (top + bottom) / 2 - h / 2, width: w, height: h };
}

/**
 * 力导向布局。shapes 按重要性排好（参与人数多的在前，初始放在中间）。
 * seed：上一期（或拖动后）的位置，有的话从那里出发、只做小幅调整。
 */
export function layoutIdeaGraph(
  shapes: NodeShape[],
  links: ConceptLink[],
  clusters: Map<string, number>,
  opts: { width: number; height: number; seed?: Map<string, Point> },
): { positions: Map<string, Point>; viewBox: ViewBox } {
  const { width, height, seed } = opts;
  const cx = width / 2;
  const cy = height / 2;
  const aspect = Math.max(0.5, Math.min(width / height, 2.2));
  const index = new Map(shapes.map((s, i) => [s.id, i]));
  const nodes: SimNode[] = shapes.map((shape, i) => {
    const radius = 34 * Math.sqrt(0.5 + i);
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    return { shape, x: cx + radius * Math.cos(angle) * Math.min(aspect, 1.6), y: cy + radius * Math.sin(angle), vx: 0, vy: 0, cluster: clusters.get(shape.id) ?? -1 };
  });
  const pairs = links
    .map(l => ({ a: index.get(l.source), b: index.get(l.target), strength: l.strength }))
    .filter((l): l is { a: number; b: number; strength: number } => l.a !== undefined && l.b !== undefined && l.a !== l.b);
  const degree = nodes.map(() => 0);
  for (const l of pairs) { degree[l.a]++; degree[l.b]++; }

  const seeded = Boolean(seed && shapes.some(s => seed.has(s.id)));
  if (seeded && seed) {
    nodes.forEach(node => {
      const p = seed.get(node.shape.id);
      if (p) { node.x = p.x; node.y = p.y; }
    });
    // 新出现的观点放在和它有连线、已经有位置的观点旁边；都没有就放在中间
    nodes.forEach((node, i) => {
      if (seed.has(node.shape.id)) return;
      const anchors = pairs
        .filter(l => l.a === i || l.b === i)
        .map(l => nodes[l.a === i ? l.b : l.a])
        .filter(other => seed.has(other.shape.id));
      const angle = i * 2.399963;
      if (anchors.length > 0) {
        node.x = anchors.reduce((s, o) => s + o.x, 0) / anchors.length + Math.cos(angle) * 60;
        node.y = anchors.reduce((s, o) => s + o.y, 0) / anchors.length + Math.sin(angle) * 60;
      } else {
        node.x = cx + Math.cos(angle) * 40;
        node.y = cy + Math.sin(angle) * 40;
      }
    });
  }

  const alphaMin = 0.002;
  const ticks = 320;
  const alphaDecay = 1 - Math.pow(alphaMin, 1 / ticks);
  let alpha = seeded ? 0.35 : 1;
  for (let tick = 0; tick < ticks && alpha > alphaMin; tick++) {
    for (const l of pairs) {
      const a = nodes[l.a];
      const b = nodes[l.b];
      let dx = b.x + b.vx - a.x - a.vx;
      let dy = b.y + b.vy - a.y - a.vy;
      const d = Math.hypot(dx, dy) || 1e-6;
      const rest = a.shape.halfW + b.shape.halfW + 34 + 46 * (1 - l.strength);
      const k = (0.3 + 0.6 * l.strength) / Math.min(degree[l.a], degree[l.b]);
      const f = ((d - rest) / d) * alpha * k;
      dx *= f; dy *= f;
      const bias = degree[l.a] / (degree[l.a] + degree[l.b]);
      b.vx -= dx * bias; b.vy -= dy * bias;
      a.vx += dx * (1 - bias); a.vy += dy * (1 - bias);
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = 0.5 + (j - i) * 0.1; dy = 0.3; d2 = dx * dx + dy * dy; }
        const minD = a.shape.halfW + b.shape.halfW;
        if (d2 < minD * minD) d2 = Math.sqrt(minD * minD * d2);
        const pushA = ((70 + 6 * b.shape.r) * alpha) / d2;
        const pushB = ((70 + 6 * a.shape.r) * alpha) / d2;
        a.vx -= dx * pushA; a.vy -= dy * pushA;
        b.vx += dx * pushB; b.vy += dy * pushB;
      }
    }
    const centroids = new Map<number, { x: number; y: number; n: number }>();
    for (const node of nodes) {
      if (node.cluster < 0) continue;
      const c = centroids.get(node.cluster) ?? { x: 0, y: 0, n: 0 };
      c.x += node.x; c.y += node.y; c.n++;
      centroids.set(node.cluster, c);
    }
    for (const node of nodes) {
      const c = centroids.get(node.cluster);
      if (c && c.n > 1) {
        node.vx += (c.x / c.n - node.x) * 0.05 * alpha;
        node.vy += (c.y / c.n - node.y) * 0.05 * alpha;
      }
      node.vx += (cx - node.x) * 0.025 * alpha;
      node.vy += (cy - node.y) * 0.025 * alpha * Math.max(aspect, 1);
      node.vx *= 0.6; node.vy *= 0.6;
      node.x += node.vx; node.y += node.vy;
    }
    separate(nodes, 0.7);
    alpha += (0 - alpha) * alphaDecay;
  }
  for (let pass = 0; pass < 240; pass++) if (!separate(nodes, 1)) break;

  const positions = new Map(nodes.map(node => [node.shape.id, { x: node.x, y: node.y }]));
  return { positions, viewBox: fitViewBox(shapes, positions, width, height) };
}

/** 两个占地框有没有叠在一起（测试和拖动后检查用） */
export function shapesOverlap(a: NodeShape, pa: Point, b: NodeShape, pb: Point): boolean {
  if (a.labelInside && b.labelInside) return Math.hypot(pb.x - pa.x, pb.y - pa.y) < a.r + b.r - 0.5;
  const ox = Math.min(pa.x + a.halfW, pb.x + b.halfW) - Math.max(pa.x - a.halfW, pb.x - b.halfW);
  const oy = Math.min(pa.y + a.bottom, pb.y + b.bottom) - Math.max(pa.y + a.top, pb.y + b.top);
  return ox > 0.5 && oy > 0.5;
}
