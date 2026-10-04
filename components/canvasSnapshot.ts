import type { Note, Language } from '../types';
import { RELATION_COLORS } from './relationColors';

/**
 * 把知识空间的画布画成一张图，交给视觉模型看。
 *
 * 刻意不做像素级截图（html2canvas 那类），原因有三：
 *   1. 不引依赖；
 *   2. 画布缩放后笔记标题会糊，而标题恰恰是模型唯一能抓住的语义；
 *   3. 我们要模型看的是「想法的分布和连接」，不是界面长什么样。
 *      重画成带标题的方框 + 按关系着色的连线，信息密度更高也更准。
 *
 * 当前正在编辑的那条会被高亮，好让模型知道「学生站在哪里看这张图」。
 */

export type SnapshotEdge = {
  source: string;
  target: string;
  relationType?: string;
};

const MAX_W = 1400;
const MAX_H = 900;
const PAD = 48;
const BOX_W = 190;
const BOX_H = 96;

const truncate = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string => {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
};

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    const candidate = current + ch;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = ch;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  const rest = text.slice(lines.join('').length);
  lines.push(lines.length === maxLines - 1 ? truncate(ctx, rest, maxWidth) : current);
  return lines.slice(0, maxLines);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function renderCanvasSnapshot(params: {
  notes: Note[];
  edges?: SnapshotEdge[];
  currentNoteId?: string | null;
  lang: Language;
}): string | null {
  const notes = params.notes.filter(n => typeof n.x === 'number' && typeof n.y === 'number');
  if (notes.length === 0) return null;

  const minX = Math.min(...notes.map(n => n.x));
  const maxX = Math.max(...notes.map(n => n.x + (n.width ?? BOX_W)));
  const minY = Math.min(...notes.map(n => n.y));
  const maxY = Math.max(...notes.map(n => n.y + (n.height ?? BOX_H)));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((MAX_W - PAD * 2) / spanX, (MAX_H - PAD * 2) / spanY, 1);

  const width = Math.round(spanX * scale + PAD * 2);
  const height = Math.round(spanY * scale + PAD * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const px = (x: number) => (x - minX) * scale + PAD;
  const py = (y: number) => (y - minY) * scale + PAD;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const byId = new Map(notes.map(n => [n.id, n]));
  const centreOf = (n: Note) => ({
    x: px(n.x + (n.width ?? BOX_W) / 2),
    y: py(n.y + (n.height ?? BOX_H) / 2),
  });

  // 连线先画，压在方框下面
  ctx.lineWidth = 2;
  for (const edge of params.edges ?? []) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) continue;
    const p = centreOf(a);
    const q = centreOf(b);
    ctx.strokeStyle = RELATION_COLORS[edge.relationType ?? ''] ?? '#c7c7c7';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }

  // 缩得太小就没有阅读价值了，给一个下限；字号跟着框高走而不是跟着缩放走。
  const boxW = Math.max(BOX_W * scale, 96);
  const boxH = Math.max(BOX_H * scale, 52);
  const titleSize = Math.max(10, Math.min(14, boxH / 5));

  for (const note of notes) {
    const x = px(note.x);
    const y = py(note.y);
    const isCurrent = note.id === params.currentNoteId;

    ctx.fillStyle = isCurrent ? '#eef0ff' : '#fafafa';
    ctx.strokeStyle = isCurrent ? '#000080' : '#d8d8d8';
    ctx.lineWidth = isCurrent ? 3 : 1.5;
    roundRect(ctx, x, y, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();

    // 文字必须夹在框里。之前按固定 3 行画，框被缩小后标题会溢到框外，
    // 叠在连线和邻框上，模型读到的是一团糊字。
    ctx.save();
    roundRect(ctx, x, y, boxW, boxH, 8);
    ctx.clip();

    const authorSize = Math.max(8, titleSize - 3);
    const showAuthor = Boolean(note.author) && boxH > titleSize * 2 + authorSize + 14;
    const titleRoom = boxH - 12 - (showAuthor ? authorSize + 4 : 0);
    const maxLines = Math.max(1, Math.floor(titleRoom / (titleSize + 3)));

    ctx.fillStyle = '#1a1a1a';
    ctx.font = `${isCurrent ? '700' : '400'} ${titleSize}px system-ui, -apple-system, "PingFang SC", sans-serif`;
    ctx.textBaseline = 'top';
    const lines = wrapLines(ctx, note.title || '（无标题）', boxW - 14, maxLines);
    lines.forEach((line, i) => ctx.fillText(line, x + 7, y + 6 + i * (titleSize + 3)));

    if (showAuthor) {
      ctx.fillStyle = '#8a8a8a';
      ctx.font = `${authorSize}px system-ui, sans-serif`;
      ctx.fillText(truncate(ctx, note.author!, boxW - 14), x + 7, y + boxH - authorSize - 6);
    }
    ctx.restore();
  }

  // 图注：模型不知道颜色代表什么，得写出来
  const legendEntries = Object.entries(RELATION_COLORS);
  const legendLabels: Record<string, { zh: string; en: string }> = {
    extend: { zh: '延伸', en: 'extend' },
    clarify: { zh: '澄清', en: 'clarify' },
    question: { zh: '提问', en: 'question' },
    challenge: { zh: '质疑', en: 'challenge' },
    evidence: { zh: '证据', en: 'evidence' },
    synthesize: { zh: '综合', en: 'synthesize' },
  };
  ctx.font = '12px system-ui, -apple-system, "PingFang SC", sans-serif';
  ctx.textBaseline = 'middle';
  let lx = PAD;
  const ly = height - 18;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, height - 34, width, 34);
  for (const [key, color] of legendEntries) {
    const label = legendLabels[key]?.[params.lang === 'zh' ? 'zh' : 'en'] ?? key;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + 18, ly);
    ctx.stroke();
    ctx.fillStyle = '#555';
    ctx.fillText(label, lx + 24, ly);
    lx += 30 + ctx.measureText(label).width + 14;
  }

  return canvas.toDataURL('image/png');
}
