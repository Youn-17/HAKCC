/**
 * 形状的小图标预览，供工具栏的形状选择器使用。
 * 直接复用画布的几何函数，图标和实际画出来的形状不会走样。
 */
import React from 'react';
import type { ShapeType } from '../services/apiClient';
import { type Box, cornerRadius, cylinderPaths, polygonPoints } from './shapeGeometry';

const ShapeGlyph: React.FC<{ type: ShapeType; size?: number }> = ({ type, size = 20 }) => {
  const pad = 2;
  const box: Box = { x: pad, y: pad + 2, width: size - pad * 2, height: size - pad * 2 - 4 };
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };

  const body = () => {
    if (type === 'line' || type === 'arrow') {
      return (
        <>
          <line x1={box.x} y1={box.y + box.height} x2={box.x + box.width} y2={box.y} {...common} />
          {type === 'arrow' && (
            <polygon
              points={`${box.x + box.width},${box.y} ${box.x + box.width - 5},${box.y + 1.5} ${box.x + box.width - 1.5},${box.y + 5}`}
              fill="currentColor" stroke="none"
            />
          )}
        </>
      );
    }
    if (type === 'text') {
      return (
        <text
          x={size / 2} y={size / 2 + 5}
          textAnchor="middle" fontSize={14} fontWeight={700} fill="currentColor"
        >
          T
        </text>
      );
    }
    if (type === 'ellipse') {
      return <ellipse cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} {...common} />;
    }
    if (type === 'cylinder') {
      const { body: d, topEllipse } = cylinderPaths(box);
      return (
        <>
          <path d={d} {...common} />
          <ellipse cx={topEllipse.cx} cy={topEllipse.cy} rx={topEllipse.rx} ry={topEllipse.ry} {...common} />
        </>
      );
    }
    const pts = polygonPoints(type, box);
    if (pts) return <polygon points={pts} {...common} />;
    return <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={cornerRadius(type, box)} {...common} />;
  };

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      {body()}
    </svg>
  );
};

export default ShapeGlyph;
