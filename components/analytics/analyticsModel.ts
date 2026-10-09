/**
 * 讨论分析界面用的纯函数（数据来自 /spaces/:id/analytics，见 api/src/services/spaceAnalytics.ts）。
 */

/**
 * 匿名显示：投到课堂上时把姓名换成「同学 1、2、3」。编号按姓名排序给，不按参与多少：
 * 按参与排的话，「同学 1」就等于告诉全班谁说得最多。
 */
export function anonymousNames(people: Array<{ id: string; name: string }>, lang: 'zh' | 'en'): Map<string, string> {
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id));
  return new Map(sorted.map((p, i) => [p.id, lang === 'zh' ? `同学 ${i + 1}` : `Student ${i + 1}`]));
}

/** 「10月9日」/「Oct 9」 */
export function dayLabel(day: string, lang: 'zh' | 'en'): string {
  const [, m, d] = day.split('-').map(Number);
  if (!m || !d) return day;
  if (lang === 'zh') return `${m}月${d}日`;
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
}

/** 多久以前：今天、昨天、3 天前、10月2日 */
export function sinceLabel(iso: string | null, lang: 'zh' | 'en', now: Date = new Date()): string {
  if (!iso) return lang === 'zh' ? '还没发言' : 'Not yet';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(new Date(iso))) / 86_400_000);
  if (diff <= 0) return lang === 'zh' ? '今天' : 'Today';
  if (diff === 1) return lang === 'zh' ? '昨天' : 'Yesterday';
  if (diff < 7) return lang === 'zh' ? `${diff} 天前` : `${diff} days ago`;
  return dayLabel(iso.slice(0, 10), lang);
}

export interface PlacedNode { id: string; x: number; y: number; r: number }

/**
 * 互动图的位置：所有人排成一圈，说得多的圆大一些。连线画在圈里，谁回应谁一眼看出：
 * 力导向布局每次打开位置都不一样，老师下次看找不到人。
 */
export function circleLayout(nodes: Array<{ id: string; weight: number }>, size: number, padding = 28): PlacedNode[] {
  if (nodes.length === 0) return [];
  const center = size / 2;
  const radius = Math.max(40, center - padding);
  const maxWeight = Math.max(1, ...nodes.map(n => n.weight));
  return nodes.map((node, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
    return {
      id: node.id,
      x: nodes.length === 1 ? center : center + radius * Math.cos(angle),
      y: nodes.length === 1 ? center : center + radius * Math.sin(angle),
      r: 7 + 13 * Math.sqrt(node.weight / maxWeight),
    };
  });
}

/** 名字大概多宽（SVG 用户单位）：汉字一个字宽，字母数字约 0.6 个字宽 */
export function labelWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += /[\u0000-\u024f]/.test(ch) ? 0.6 : 1;
  return units * fontSize;
}

export interface PlacedLabel { x: number; y: number; anchor: 'start' | 'middle' | 'end' }

/** 名字放在圆外侧、沿圈心到圆心的方向：上下两头居中，左右两边朝外对齐 */
export function nodeLabel(p: PlacedNode, size: number, fontSize: number): PlacedLabel {
  const dx = p.x - size / 2;
  const dy = p.y - size / 2;
  const len = Math.hypot(dx, dy);
  const ux = len ? dx / len : 0;
  const uy = len ? dy / len : 1;
  const gap = p.r + 5;
  const anchor = Math.abs(ux) < 0.35 ? 'middle' : ux > 0 ? 'start' : 'end';
  return { x: p.x + ux * gap, y: p.y + uy * (gap + (anchor === 'middle' ? fontSize / 2 : 0)), anchor };
}

/** 圆和名字都框进来的 viewBox：名字长、在左右两边时不会被裁掉 */
export function networkViewBox(placed: PlacedNode[], labels: Array<PlacedLabel & { width: number }>, size: number, fontSize: number): string {
  if (placed.length === 0) return `0 0 ${size} ${size}`;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.r); maxX = Math.max(maxX, p.x + p.r);
    minY = Math.min(minY, p.y - p.r); maxY = Math.max(maxY, p.y + p.r);
  }
  for (const l of labels) {
    const left = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - l.width : l.x - l.width / 2;
    minX = Math.min(minX, left); maxX = Math.max(maxX, left + l.width);
    minY = Math.min(minY, l.y - fontSize * 0.7); maxY = Math.max(maxY, l.y + fontSize * 0.7);
  }
  const pad = 6;
  return `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(maxX - minX + 2 * pad).toFixed(1)} ${(maxY - minY + 2 * pad).toFixed(1)}`;
}

/** 连线：从一个圆的边到另一个圆的边，略弯，两个方向都有回应时不重叠 */
export function linkPath(a: PlacedNode, b: PlacedNode, size: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = a.x + ux * a.r;
  const sy = a.y + uy * a.r;
  const ex = b.x - ux * (b.r + 6);
  const ey = b.y - uy * (b.r + 6);
  // 往圈心那边弯一点
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const cx = mx + (size / 2 - mx) * 0.22 - uy * 14;
  const cy = my + (size / 2 - my) * 0.22 + ux * 14;
  return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
}

/** 百分比，整数；分母为 0 时给 null */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** 走势太长时按周合并，柱子不至于细成一根线 */
export function bucketTimeline<T extends { day: string }>(rows: T[], keys: Array<keyof T>, maxBars = 60): Array<{ label: string; day: string } & Record<string, number>> {
  if (rows.length <= maxBars) {
    return rows.map(row => ({ label: row.day, day: row.day, ...Object.fromEntries(keys.map(k => [k, Number(row[k]) || 0])) }) as { label: string; day: string } & Record<string, number>);
  }
  const out: Array<{ label: string; day: string } & Record<string, number>> = [];
  for (let i = 0; i < rows.length; i += 7) {
    const week = rows.slice(i, i + 7);
    const sums = Object.fromEntries(keys.map(k => [k, week.reduce((sum, row) => sum + (Number(row[k]) || 0), 0)]));
    out.push({ label: week[0].day, day: week[0].day, ...sums } as { label: string; day: string } & Record<string, number>);
  }
  return out;
}
