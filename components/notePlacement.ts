import type { Note } from '../types';
import {
  STANDARD_NOTE_WIDTH, STANDARD_NOTE_HEIGHT,
  VIEW_NOTE_WIDTH, VIEW_NOTE_HEIGHT,
  RISEABOVE_NOTE_WIDTH, RISEABOVE_NOTE_HEIGHT,
  DRAWING_NOTE_SIZE, ATTACHMENT_NOTE_WIDTH, ATTACHMENT_NOTE_HEIGHT,
} from './noteGeometry';

/*
 * 新笔记放在画布上哪里。从 Workspace 挪出来：手机端建 Build-on 也要把新笔记摆在原笔记旁边，
 * 不能为了这几个函数把整个画布组件打进手机端的包里。
 */

// Get approximate dimensions based on note type if not explicitly set
export const getNoteDimensions = (note: Note) => {
  // Attachments/videos shown as a card render compact regardless of the
  // 320×240 media size stored on upload — edges must anchor to the card.
  if ((note.type === 'attachment' || note.type === 'video') && !note.isPreviewMode) {
    return { w: ATTACHMENT_NOTE_WIDTH, h: ATTACHMENT_NOTE_HEIGHT };
  }
  if (note.width && note.height) return { w: note.width, h: note.height };

  switch (note.type) {
    case 'view': return { w: VIEW_NOTE_WIDTH, h: VIEW_NOTE_HEIGHT };
    case 'riseabove': return { w: RISEABOVE_NOTE_WIDTH, h: RISEABOVE_NOTE_HEIGHT };
    case 'drawing': return { w: DRAWING_NOTE_SIZE, h: DRAWING_NOTE_SIZE };
    case 'video':
    case 'attachment': return { w: ATTACHMENT_NOTE_WIDTH, h: ATTACHMENT_NOTE_HEIGHT };
    default: return { w: STANDARD_NOTE_WIDTH, h: STANDARD_NOTE_HEIGHT };
  }
};

// ── Auto-Layout: Collision-Aware Placement ───────────────────────
const NOTE_GAP = 24; // px gap between notes

/** Find the nearest non-overlapping position for a new note. */
export const findOpenPosition = (
  startX: number,
  startY: number,
  existingNotes: Note[],
  noteW = 184,
  noteH = 126,
): { x: number; y: number } => {
  if (existingNotes.length === 0) return { x: startX, y: startY };

  const occupied = existingNotes.map(n => ({
    x: n.x,
    y: n.y,
    w: n.width || (n.type === 'view' ? 180 : n.type === 'riseabove' ? 220 : 184),
    h: n.height || (n.type === 'view' ? 100 : n.type === 'riseabove' ? 120 : 126),
  }));

  const overlaps = (x: number, y: number) =>
    occupied.some(o =>
      x < o.x + o.w + NOTE_GAP &&
      x + noteW + NOTE_GAP > o.x &&
      y < o.y + o.h + NOTE_GAP &&
      y + noteH + NOTE_GAP > o.y,
    );

  // Try the start position first
  if (!overlaps(startX, startY)) return { x: startX, y: startY };

  // Spiral search outward in a grid pattern
  const step = noteW + NOTE_GAP;
  for (let ring = 1; ring <= 12; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue; // only perimeter
        const cx = startX + dx * step;
        const cy = startY + dy * (noteH + NOTE_GAP);
        if (!overlaps(cx, cy)) return { x: cx, y: cy };
      }
    }
  }
  // Fallback: offset down-right from start
  return { x: startX + noteW + NOTE_GAP, y: startY + noteH + NOTE_GAP };
};

/** Place a build-on note radially around its parent, avoiding collisions. */
const findBuildOnPosition = (
  parent: Note,
  existingNotes: Note[],
  noteW = 184,
  noteH = 126,
): { x: number; y: number } => {
  const pDims = getNoteDimensions(parent);
  const pcx = parent.x + pDims.w / 2;
  const pcy = parent.y + pDims.h / 2;
  const radius = Math.max(pDims.w, pDims.h) + noteW / 2 + NOTE_GAP * 2;

  const occupied = existingNotes.map(n => ({
    x: n.x, y: n.y,
    w: n.width || 184,
    h: n.height || 126,
  }));

  const overlaps = (x: number, y: number) =>
    occupied.some(o =>
      x < o.x + o.w + NOTE_GAP &&
      x + noteW + NOTE_GAP > o.x &&
      y < o.y + o.h + NOTE_GAP &&
      y + noteH + NOTE_GAP > o.y,
    );

  // Try 12 evenly-spaced angles, starting from the right
  const angles = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
  for (const deg of angles) {
    const rad = (deg * Math.PI) / 180;
    const x = pcx + Math.cos(rad) * radius - noteW / 2;
    const y = pcy + Math.sin(rad) * radius - noteH / 2;
    if (!overlaps(x, y)) return { x, y };
  }
  // Fallback: stack right of parent
  return findOpenPosition(parent.x + pDims.w + NOTE_GAP * 2, parent.y, existingNotes, noteW, noteH);
};

/**
 * 新笔记的落点：Build-on 挨着父笔记，其余放在视口中央附近的空位。
 * 「贡献」和草稿自动保存都从这里取，同一条笔记不管走哪条路落库，位置都一样。
 */
export const placeNewNote = (
  parent: Note | null | undefined,
  existingNotes: Note[],
  viewPort: { x: number; y: number; zoom: number },
): { x: number; y: number } => {
  if (parent) return findBuildOnPosition(parent, existingNotes);
  const rawX = (-viewPort.x + (window.innerWidth / 2)) / viewPort.zoom;
  const rawY = (-viewPort.y + (window.innerHeight / 2)) / viewPort.zoom;
  return findOpenPosition(rawX, rawY, existingNotes);
};

