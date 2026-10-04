import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiShape, ShapeType, TextAlign, TextValign } from '../services/apiClient';
import type { Language } from '../types';
import {
  type Box, cornerRadius, cylinderPaths, defaultSize, isLineShape,
  normalizeBox, polygonPoints, textInset,
} from './shapeGeometry';

/**
 * Canvas shape layer — rectangles, ellipses, diamonds, text labels and
 * connectors drawn directly on the knowledge space to group and label regions.
 *
 * Renders beneath the notes so shapes act as containers/backdrops: a region
 * can be labelled "待验证的假设" and notes dragged into it.
 */

export interface ShapeDraft {
  shapeType: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  text: string;
}

/** 新建形状时套用的样式，由工具栏的样式面板决定。 */
export interface ShapeStyleDefaults {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fontSize: number;
  fontWeight: number;
  textAlign: TextAlign;
  textValign: TextValign;
  textColor: string;
}

interface ShapeLayerProps {
  shapes: ApiShape[];
  /** Active shape tool, or null when the pointer belongs to the canvas. */
  tool: ShapeType | null;
  style: ShapeStyleDefaults;
  selectedId: string | null;
  editable: boolean;
  lang: Language;
  zoom: number;
  onSelect: (id: string | null) => void;
  onCreate: (draft: ShapeDraft) => void;
  onUpdate: (id: string, patch: Partial<ApiShape>, commit: boolean) => void;
  onDelete: (id: string) => void;
}

const VALIGN_TO_FLEX: Record<TextValign, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};
const ALIGN_TO_FLEX: Record<TextAlign, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

const HANDLE = 10;

/** Screen point → canvas world coordinates for the shape SVG. */
function toWorld(evt: React.MouseEvent, svg: SVGSVGElement | null) {
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  const scale = rect.width / (svg.viewBox.baseVal.width || rect.width);
  return {
    x: svg.viewBox.baseVal.x + (evt.clientX - rect.left) / scale,
    y: svg.viewBox.baseVal.y + (evt.clientY - rect.top) / scale,
  };
}

const ShapeLayer: React.FC<ShapeLayerProps> = ({
  shapes, tool, style, selectedId, editable, lang, zoom,
  onSelect, onCreate, onUpdate, onDelete,
}) => {
  const { fill, stroke } = style;
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<ShapeDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; startX: number; startY: number; orig: ApiShape } | null>(null);

  const zh = lang === 'zh';

  // ── Drawing a new shape ──────────────────────────────────────────────────
  const handleBackgroundDown = (e: React.MouseEvent) => {
    if (!tool || !editable) return;
    e.stopPropagation();
    const p = toWorld(e, svgRef.current);
    setDraft({ shapeType: tool, x: p.x, y: p.y, width: 0, height: 0, fill, stroke, text: '' });
  };

  const handleMove = (e: React.MouseEvent) => {
    if (draft) {
      const p = toWorld(e, svgRef.current);
      setDraft(d => (d ? { ...d, width: p.x - d.x, height: p.y - d.y } : d));
      return;
    }
    if (!drag.current) return;
    const p = toWorld(e, svgRef.current);
    const { mode, orig, startX, startY, id } = drag.current;
    const dx = p.x - startX;
    const dy = p.y - startY;
    if (mode === 'move') {
      onUpdate(id, { x: orig.x + dx, y: orig.y + dy }, false);
    } else {
      onUpdate(id, { width: Math.max(20, orig.width + dx), height: Math.max(20, orig.height + dy) }, false);
    }
  };

  const handleUp = () => {
    if (draft) {
      // 线状形状要保留方向，不能归一化，否则箭头永远指向右下。
      const line = isLineShape(draft.shapeType);
      const box = line
        ? { x: draft.x, y: draft.y, width: draft.width, height: draft.height }
        : normalizeBox(draft);
      // A click without a drag gets a sensible default box.
      const isClick = Math.abs(draft.width) < 12 && Math.abs(draft.height) < 12;
      const fallback = defaultSize(draft.shapeType);
      onCreate({
        ...draft,
        x: box.x,
        y: box.y,
        width: isClick ? fallback.width : box.width,
        height: isClick ? fallback.height : box.height,
      });
      setDraft(null);
      return;
    }
    if (drag.current) {
      const shape = shapes.find(s => s.id === drag.current!.id);
      if (shape) onUpdate(shape.id, { x: shape.x, y: shape.y, width: shape.width, height: shape.height }, true);
      drag.current = null;
    }
  };

  const startDrag = (e: React.MouseEvent, shape: ApiShape, mode: 'move' | 'resize') => {
    if (!editable || tool) return;
    e.stopPropagation();
    const p = toWorld(e, svgRef.current);
    drag.current = { id: shape.id, mode, startX: p.x, startY: p.y, orig: { ...shape } };
    onSelect(shape.id);
  };

  const commitText = useCallback(() => {
    if (!editingId) return;
    onUpdate(editingId, { text: editingText }, true);
    setEditingId(null);
  }, [editingId, editingText, onUpdate]);

  // Delete/Escape act on the selected shape, but never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      if (!selectedId || !editable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete(selectedId);
      } else if (e.key === 'Escape') {
        onSelect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, editable, onDelete, onSelect]);

  const renderShapeBody = (
    s: { shapeType: ShapeType; x: number; y: number; width: number; height: number; fill: string; stroke: string; strokeWidth?: number },
    key?: string,
  ) => {
    const sw = s.strokeWidth ?? 2;
    const strokeColor = s.stroke || '#64748b';
    const common = { fill: s.fill || 'none', stroke: strokeColor, strokeWidth: sw };

    if (isLineShape(s.shapeType)) {
      return (
        <line
          key={key}
          x1={s.x} y1={s.y} x2={s.x + s.width} y2={s.y + s.height}
          stroke={strokeColor} strokeWidth={sw} strokeLinecap="round"
          markerEnd={s.shapeType === 'arrow' ? `url(#shape-arrow-${strokeColor.replace('#', '')})` : undefined}
        />
      );
    }

    const box: Box = normalizeBox(s);

    if (s.shapeType === 'text') {
      return <rect key={key} x={box.x} y={box.y} width={box.width} height={box.height} fill="transparent" stroke="none" />;
    }
    if (s.shapeType === 'ellipse') {
      return <ellipse key={key} cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} {...common} />;
    }
    if (s.shapeType === 'cylinder') {
      const { body, topEllipse } = cylinderPaths(box);
      return (
        <g key={key}>
          <path d={body} {...common} />
          {/* 顶面单独描一次，圆柱才有立体感 */}
          <ellipse cx={topEllipse.cx} cy={topEllipse.cy} rx={topEllipse.rx} ry={topEllipse.ry} fill={s.fill || 'none'} stroke={strokeColor} strokeWidth={sw} />
        </g>
      );
    }
    const points = polygonPoints(s.shapeType, box);
    if (points) return <polygon key={key} points={points} {...common} />;

    return <rect key={key} x={box.x} y={box.y} width={box.width} height={box.height} rx={cornerRadius(s.shapeType, box)} {...common} />;
  };

  // 箭头标记要跟随线条颜色 —— 单一个灰色 marker 会让彩色箭头头尾不同色。
  const arrowColors = Array.from(new Set([
    ...shapes.filter(s => s.shapeType === 'arrow').map(s => s.stroke || '#64748b'),
    stroke || '#64748b',
  ]));

  return (
    <svg
      ref={svgRef}
      viewBox="-6000 -6000 14000 14000"
      className="absolute overflow-visible"
      style={{
        top: -6000, left: -6000, width: 14000, height: 14000,
        // Only intercept the pointer while a shape tool is armed, otherwise
        // the canvas keeps its pan/select behaviour and notes stay clickable.
        pointerEvents: tool ? 'auto' : 'none',
        cursor: tool ? 'crosshair' : 'default',
        zIndex: 1,
      }}
      onMouseDown={handleBackgroundDown}
      onMouseMove={handleMove}
      onMouseUp={handleUp}
      onMouseLeave={handleUp}
    >
      <defs>
        {arrowColors.map(c => (
          <marker
            key={c}
            id={`shape-arrow-${c.replace('#', '')}`}
            markerWidth="12" markerHeight="10" refX="10" refY="5"
            orient="auto" markerUnits="userSpaceOnUse"
          >
            <polygon points="0 0, 10 5, 0 10" fill={c} />
          </marker>
        ))}
      </defs>

      {shapes.map(shape => {
        const selected = shape.id === selectedId;
        const label = shape.text ?? '';
        return (
          <g key={shape.id} style={{ pointerEvents: editable && !tool ? 'auto' : 'none' }}>
            {renderShapeBody(shape)}

            {/* Hit area: shapes are hollow, so give them a grabbable surface */}
            <rect
              x={Math.min(shape.x, shape.x + shape.width)}
              y={Math.min(shape.y, shape.y + shape.height)}
              width={Math.abs(shape.width)}
              height={Math.abs(shape.height)}
              fill="transparent"
              style={{ cursor: editable && !tool ? 'move' : 'default' }}
              onMouseDown={(e) => startDrag(e, shape, 'move')}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!editable) return;
                setEditingId(shape.id);
                setEditingText(label);
              }}
            />

            {/* 文字层 —— 用 foreignObject 承载 HTML，中文才能正常换行；
                同时靠 flex 实现真正的上下/左右居中（SVG <text> 做不到多行垂直居中）。 */}
            {!isLineShape(shape.shapeType) && (label || editingId === shape.id) && (() => {
              const area = textInset(shape.shapeType, normalizeBox(shape));
              const fontSize = shape.fontSize ?? 15;
              const textStyle: React.CSSProperties = {
                fontSize,
                fontWeight: shape.fontWeight ?? 600,
                color: shape.textColor || shape.stroke || '#334155',
                textAlign: (shape.textAlign ?? 'center') as TextAlign,
                lineHeight: 1.35,
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
                width: '100%',
              };
              return (
                <foreignObject
                  x={area.x}
                  y={area.y}
                  width={area.width}
                  height={area.height}
                  style={{ pointerEvents: editingId === shape.id ? 'auto' : 'none', overflow: 'visible' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      height: '100%',
                      width: '100%',
                      alignItems: VALIGN_TO_FLEX[shape.textValign ?? 'middle'],
                      justifyContent: ALIGN_TO_FLEX[shape.textAlign ?? 'center'],
                    }}
                  >
                    {editingId === shape.id ? (
                      <textarea
                        autoFocus
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onBlur={commitText}
                        onKeyDown={(e) => {
                          // Enter 提交，Shift+Enter 换行 —— 流程图里多行标签很常见。
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        style={{
                          ...textStyle,
                          border: '1px solid #6366f1',
                          borderRadius: 6,
                          padding: '2px 6px',
                          background: 'white',
                          outline: 'none',
                          resize: 'none',
                          minHeight: Math.max(fontSize * 1.6, 24),
                          maxHeight: '100%',
                          fontFamily: 'inherit',
                        }}
                      />
                    ) : (
                      <div style={textStyle}>{label}</div>
                    )}
                  </div>
                </foreignObject>
              );
            })()}

            {selected && editable && (() => {
              const b = normalizeBox(shape);
              const gripX = b.x + b.width;
              const gripY = b.y + b.height;
              return (
                <>
                  <rect
                    x={b.x - 4} y={b.y - 4}
                    width={b.width + 8} height={b.height + 8}
                    fill="none" stroke="#6366f1" strokeWidth={1.5 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                  />
                  {/* Resize grip (bottom-right) */}
                  <rect
                    x={gripX - HANDLE / 2} y={gripY - HANDLE / 2}
                    width={HANDLE} height={HANDLE}
                    fill="#6366f1" stroke="white" strokeWidth={1.5}
                    style={{ cursor: 'nwse-resize' }}
                    onMouseDown={(e) => startDrag(e, shape, 'resize')}
                  />
                  {/* Delete grip (top-right) */}
                  <g
                    style={{ cursor: 'pointer' }}
                    onMouseDown={(e) => { e.stopPropagation(); onDelete(shape.id); }}
                  >
                    <circle cx={gripX} cy={b.y} r={9} fill="#ef4444" stroke="white" strokeWidth={1.5} />
                    <path
                      d={`M ${gripX - 4} ${b.y - 4} L ${gripX + 4} ${b.y + 4} M ${gripX + 4} ${b.y - 4} L ${gripX - 4} ${b.y + 4}`}
                      stroke="white" strokeWidth={2} strokeLinecap="round"
                    />
                  </g>
                </>
              );
            })()}
          </g>
        );
      })}

      {/* Live preview of the shape being drawn */}
      {draft && (
        <g opacity={0.7}>
          {renderShapeBody({
            shapeType: draft.shapeType,
            ...(isLineShape(draft.shapeType)
              ? { x: draft.x, y: draft.y, width: draft.width, height: draft.height }
              : normalizeBox(draft)),
            fill: draft.fill,
            stroke: draft.stroke,
            strokeWidth: style.strokeWidth,
          }, 'draft')}
        </g>
      )}
    </svg>
  );
};

export default ShapeLayer;
