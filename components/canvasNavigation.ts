/**
 * 画布的平移和缩放（2026-10-10 用户：很多人用笔记本触控板（Windows、Mac），不能只靠滚轮缩放；
 * 右下角要有放大缩小按钮，进去默认 60%；平移也要更方便）。
 *
 * 滚轮事件分三种：
 *   - 触控板双指捏合：浏览器发 ctrlKey 的 wheel（Chrome / Edge / Firefox，Mac 和 Windows 精确式触控板都是）→ 缩放；
 *   - Ctrl / ⌘ + 鼠标滚轮 → 缩放；
 *   - 鼠标滚轮一格一格地转 → 缩放（老用户习惯，不改）；
 *   - 触控板双指滑动 → 平移。
 * 鼠标和触控板分不清时看 wheelDeltaY：鼠标一格是 120 的整数倍，触控板是连续的小数值；Firefox 的鼠标按行滚（deltaMode=1）。
 * 一串连续的滚轮事件（间隔 < 160ms）按第一下的判断走，免得触控板快速一划时偶尔凑出 120 的倍数，中途变成缩放。
 * Safari 的捏合不发 wheel，发 gesturechange（见 Workspace）。
 */

export interface ViewPort { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;
export const DEFAULT_ZOOM = 0.6;
/** 「−」「+」按钮走的档位 */
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3] as const;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** 以画布上 (px, py) 这一点为中心缩放：这一点下面的内容不动 */
export function zoomAround(view: ViewPort, px: number, py: number, nextZoom: number): ViewPort {
  const zoom = clampZoom(nextZoom);
  const worldX = (px - view.x) / view.zoom;
  const worldY = (py - view.y) / view.zoom;
  return { x: px - worldX * zoom, y: py - worldY * zoom, zoom };
}

/** 按档位放大（+1）或缩小（-1）：当前缩放在两档之间时先到相邻那一档 */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const eps = 0.001;
  if (direction > 0) return ZOOM_STEPS.find(z => z > zoom + eps) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find(z => z < zoom - eps) ?? MIN_ZOOM;
}

type WheelLike = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'timeStamp'> & { wheelDeltaY?: number };

export type WheelIntent = 'pinch' | 'zoom' | 'pan';

/** 一下滚轮是鼠标滚轮吗（不看 ctrl） */
export function looksLikeMouseWheel(e: WheelLike): boolean {
  if (e.deltaMode !== 0) return true;
  if (e.deltaX !== 0) return false;
  const wd = e.wheelDeltaY;
  if (typeof wd === 'number' && wd !== 0) return Math.abs(wd) % 120 === 0;
  // 没有 wheelDeltaY 的浏览器：整数且一下就很大的，多半是鼠标一格
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
}

/** 连续的一串滚轮事件按第一下的判断走 */
export function createWheelClassifier(gapMs = 160) {
  let last = -Infinity;
  let current: WheelIntent = 'pan';
  return (e: WheelLike): WheelIntent => {
    if (e.ctrlKey) {
      // 捏合（或 Ctrl+滚轮）随时可以开始，不受前一串的影响
      last = e.timeStamp;
      current = looksLikeMouseWheel(e) ? 'zoom' : 'pinch';
      return current;
    }
    if (e.timeStamp - last > gapMs || current === 'pinch') {
      current = e.metaKey || (looksLikeMouseWheel(e) && !e.shiftKey) ? 'zoom' : 'pan';
    }
    last = e.timeStamp;
    return current;
  };
}

/** 滚轮缩放的倍数：捏合手感细腻一些；鼠标一格（deltaY 100）约 14%，接近原来按加减算的手感 */
export function wheelZoomFactor(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, intent: WheelIntent): number {
  const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  const k = intent === 'pinch' ? 0.01 : 0.0015;
  return Math.exp(-Math.max(-300, Math.min(300, dy)) * k);
}

/** 平移的像素：按行、按页滚的换算成像素；Shift + 滚轮横着走 */
export function wheelPanDelta(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>): { dx: number; dy: number } {
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
  let dx = e.deltaX * unit;
  let dy = e.deltaY * unit;
  if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
  return { dx, dy };
}

/** 正在输入（输入框、可编辑区）时不拦空格 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}
