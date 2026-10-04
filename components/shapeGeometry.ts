/**
 * 形状的几何定义与目录 —— 单一来源。
 *
 * 画布渲染（ShapeLayer）、工具栏选择器（Workspace）和形状预览三处都读这里，
 * 否则加一个形状要改三个地方，迟早漏掉一处。
 */
import type { ShapeType } from '../services/apiClient';

export interface Box { x: number; y: number; width: number; height: number }

/** 每种形状在工具栏里的分组与名字。 */
export interface ShapeMeta {
  key: ShapeType;
  zh: string;
  en: string;
  group: 'basic' | 'flow' | 'line';
}

export const SHAPE_CATALOG: ShapeMeta[] = [
  { key: 'rect',          zh: '矩形',     en: 'Rectangle',     group: 'basic' },
  { key: 'roundRect',     zh: '圆角矩形', en: 'Rounded',       group: 'basic' },
  { key: 'ellipse',       zh: '椭圆',     en: 'Ellipse',       group: 'basic' },
  { key: 'triangle',      zh: '三角形',   en: 'Triangle',      group: 'basic' },
  { key: 'diamond',       zh: '菱形·判断', en: 'Decision',     group: 'flow' },
  { key: 'stadium',       zh: '起止',     en: 'Terminator',    group: 'flow' },
  { key: 'parallelogram', zh: '数据',     en: 'Data / IO',     group: 'flow' },
  { key: 'hexagon',       zh: '准备',     en: 'Preparation',   group: 'flow' },
  { key: 'cylinder',      zh: '存储',     en: 'Database',      group: 'flow' },
  { key: 'arrow',         zh: '箭头',     en: 'Arrow',         group: 'line' },
  { key: 'line',          zh: '直线',     en: 'Line',          group: 'line' },
  { key: 'text',          zh: '文字',     en: 'Text',          group: 'line' },
];

/** 线状形状不参与填充与文字排版。 */
export const isLineShape = (t: ShapeType) => t === 'line' || t === 'arrow';

/** 归一化：向左/向上拖也要得到正的宽高。 */
export function normalizeBox(b: Box): Box {
  return {
    x: b.width < 0 ? b.x + b.width : b.x,
    y: b.height < 0 ? b.y + b.height : b.y,
    width: Math.abs(b.width),
    height: Math.abs(b.height),
  };
}

/**
 * 多边形类形状的顶点。返回 null 表示该形状不是多边形（矩形/椭圆/圆柱另算）。
 * 斜切与圆角的比例都对宽高做了夹取，细长的形状不会被切穿。
 */
export function polygonPoints(type: ShapeType, b: Box): string | null {
  const { x, y, width: w, height: h } = b;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (type) {
    case 'diamond':
      return `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
    case 'triangle':
      return `${cx},${y} ${x + w},${y + h} ${x},${y + h}`;
    case 'parallelogram': {
      const skew = Math.min(w * 0.25, h * 0.6);
      return `${x + skew},${y} ${x + w},${y} ${x + w - skew},${y + h} ${x},${y + h}`;
    }
    case 'hexagon': {
      const notch = Math.min(w * 0.2, h * 0.5);
      return `${x + notch},${y} ${x + w - notch},${y} ${x + w},${cy} ${x + w - notch},${y + h} ${x + notch},${y + h} ${x},${cy}`;
    }
    default:
      return null;
  }
}

/** 圆柱（存储）的路径：顶面椭圆 + 侧壁。 */
export function cylinderPaths(b: Box): { body: string; topEllipse: { cx: number; cy: number; rx: number; ry: number } } {
  const { x, y, width: w, height: h } = b;
  const ry = Math.min(h * 0.18, w * 0.5);
  const rx = w / 2;
  return {
    body: `M ${x} ${y + ry} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} L ${x + w} ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} Z`,
    topEllipse: { cx: x + rx, cy: y + ry, rx, ry },
  };
}

/**
 * 圆角半径。必须跟着尺寸缩放 —— 固定值在 20px 的工具栏图标上会把
 * 矩形、圆角矩形、起止三者都渲染成同一个胶囊，选择器里根本分不出来。
 */
export function cornerRadius(type: ShapeType, b: Box): number {
  if (type === 'stadium') return Math.min(b.height, b.width) / 2;
  if (type === 'roundRect') return Math.min(16, b.width * 0.22, b.height * 0.32);
  return Math.min(4, b.width * 0.06, b.height * 0.08);
}

/**
 * 文字在形状内的可用区域。
 * 菱形/三角形这类尖角形状，文字贴边会溢出到形状外面，所以按比例内缩。
 */
export function textInset(type: ShapeType, b: Box): Box {
  const pad = 8;
  switch (type) {
    case 'diamond':
      return { x: b.x + b.width * 0.18, y: b.y + b.height * 0.22, width: b.width * 0.64, height: b.height * 0.56 };
    case 'triangle':
      return { x: b.x + b.width * 0.2, y: b.y + b.height * 0.38, width: b.width * 0.6, height: b.height * 0.56 };
    case 'parallelogram': {
      const skew = Math.min(b.width * 0.25, b.height * 0.6);
      return { x: b.x + skew, y: b.y, width: Math.max(10, b.width - skew * 2), height: b.height };
    }
    case 'hexagon': {
      const notch = Math.min(b.width * 0.2, b.height * 0.5);
      return { x: b.x + notch, y: b.y, width: Math.max(10, b.width - notch * 2), height: b.height };
    }
    case 'cylinder': {
      const ry = Math.min(b.height * 0.18, b.width * 0.5);
      return { x: b.x + pad, y: b.y + ry, width: Math.max(10, b.width - pad * 2), height: Math.max(10, b.height - ry * 2) };
    }
    case 'ellipse':
      return { x: b.x + b.width * 0.12, y: b.y + b.height * 0.12, width: b.width * 0.76, height: b.height * 0.76 };
    default:
      return { x: b.x + pad, y: b.y, width: Math.max(10, b.width - pad * 2), height: b.height };
  }
}

/** 新建形状时的默认尺寸（点击而非拖拽时使用）。 */
export function defaultSize(type: ShapeType): { width: number; height: number } {
  switch (type) {
    case 'text': return { width: 220, height: 48 };
    case 'stadium': return { width: 180, height: 64 };
    case 'ellipse': return { width: 180, height: 120 };
    case 'diamond': return { width: 180, height: 120 };
    case 'cylinder': return { width: 160, height: 120 };
    case 'triangle': return { width: 160, height: 130 };
    default: return { width: 200, height: 120 };
  }
}
