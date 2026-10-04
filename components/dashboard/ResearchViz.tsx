import React, { forwardRef, useMemo } from 'react';

// ── Gradient Defs (include inside each SVG) ──────────────────────────

export const ChartDefs: React.FC<{ id?: string }> = ({ id = '' }) => (
  <defs>
    <linearGradient id={`${id}gNavy`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#000080" stopOpacity={0.9} />
      <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0.2} />
    </linearGradient>
    <linearGradient id={`${id}gNavyH`} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor="#000080" stopOpacity={0.85} />
      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.6} />
    </linearGradient>
    <linearGradient id={`${id}gBlue`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.8} />
      <stop offset="100%" stopColor="#2563eb" stopOpacity={0.12} />
    </linearGradient>
    <linearGradient id={`${id}gEmerald`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#059669" stopOpacity={0.8} />
      <stop offset="100%" stopColor="#059669" stopOpacity={0.12} />
    </linearGradient>
    <linearGradient id={`${id}gAmber`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#d97706" stopOpacity={0.8} />
      <stop offset="100%" stopColor="#d97706" stopOpacity={0.12} />
    </linearGradient>
    <linearGradient id={`${id}gRose`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#e11d48" stopOpacity={0.8} />
      <stop offset="100%" stopColor="#e11d48" stopOpacity={0.12} />
    </linearGradient>
    <linearGradient id={`${id}gViolet`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.8} />
      <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.12} />
    </linearGradient>
    <linearGradient id={`${id}gBar`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#000080" />
      <stop offset="100%" stopColor="#1e40af" />
    </linearGradient>
    <filter id={`${id}shadow`} x="-4%" y="-4%" width="108%" height="108%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000080" floodOpacity="0.08" />
    </filter>
  </defs>
);

// ── Smooth path interpolation (monotone cubic) ──────────────────────

function smoothLine(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${cp1x},${cp1y},${cp2x},${cp2y},${p2.x},${p2.y}`;
  }
  return d;
}

// ── Grid helpers ──────────────────────────────────────────────────

function yGridLines(count: number, left: number, right: number, top: number, bottom: number) {
  const lines = [];
  for (let i = 0; i <= count; i++) {
    const y = top + (i / count) * (bottom - top);
    lines.push(
      <line key={i} x1={left} y1={y} x2={right} y2={y} stroke="currentColor" strokeWidth="0.5" className="text-gray-200 dark:text-gray-800" opacity={i === count ? 1 : 0.5} />
    );
  }
  return lines;
}

// ══════════════════════════════════════════════════════════════════
// 1. VizAreaLine - Smooth area chart with gradient fill
// ══════════════════════════════════════════════════════════════════

interface AreaLineProps {
  data: { label: string; value: number }[];
  refLines?: { y: number; label: string; color: string }[];
  color?: 'navy' | 'blue' | 'emerald' | 'amber' | 'rose' | 'violet';
  height?: number;
  showDots?: boolean;
  yLabel?: string;
}

export const VizAreaLine = forwardRef<SVGSVGElement, AreaLineProps>(
  ({ data, refLines, color = 'navy', height = 200, showDots = true, yLabel }, ref) => {
    const W = 600, pad = { left: 45, right: 20, top: 20, bottom: 35 };
    const cw = W - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;
    const maxVal = Math.max(...data.map(d => d.value), ...(refLines?.map(r => r.y) ?? []), 1);
    const colorMap: Record<string, string> = { navy: '#000080', blue: '#2563eb', emerald: '#059669', amber: '#d97706', rose: '#e11d48', violet: '#7c3aed' };
    const c = colorMap[color];
    const gId = `al_${color}_${data.length}`;

    const pts = data.map((d, i) => ({
      x: pad.left + (i / Math.max(data.length - 1, 1)) * cw,
      y: pad.top + ch - (d.value / maxVal) * ch,
    }));
    const linePath = smoothLine(pts);
    const areaPath = linePath + `L${pts[pts.length - 1].x},${pad.top + ch}L${pts[0].x},${pad.top + ch}Z`;

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}>
        <ChartDefs id={gId} />
        {yGridLines(4, pad.left, W - pad.right, pad.top, pad.top + ch)}
        {/* Y axis labels */}
        {[0, 1, 2, 3, 4].map(i => {
          const v = maxVal * (1 - i / 4);
          return <text key={i} x={pad.left - 6} y={pad.top + (i / 4) * ch + 3} textAnchor="end" className="text-[0.5625rem] fill-gray-400 dark:fill-gray-500 tabular-nums">{v % 1 === 0 ? v : v.toFixed(1)}</text>;
        })}
        {yLabel && <text x={12} y={pad.top + ch / 2} textAnchor="middle" className="text-[0.5rem] fill-gray-400" transform={`rotate(-90,12,${pad.top + ch / 2})`}>{yLabel}</text>}
        {/* Reference lines */}
        {refLines?.map((rl, i) => {
          const y = pad.top + ch - (rl.y / maxVal) * ch;
          return (
            <g key={i}>
              <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke={rl.color} strokeWidth="1" strokeDasharray="4,3" opacity={0.6} />
              <text x={W - pad.right + 4} y={y + 3} className="text-[0.5rem]" fill={rl.color}>{rl.label}</text>
            </g>
          );
        })}
        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gId}g${color.charAt(0).toUpperCase() + color.slice(1)})`} />
        {/* Line */}
        <path d={linePath} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* Dots */}
        {showDots && pts.length <= 50 && pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill="white" stroke={c} strokeWidth="1.5" className="dark:fill-gray-950">
              <title>{`${data[i].label}: ${data[i].value}`}</title>
            </circle>
          </g>
        ))}
        {/* X axis labels */}
        {data.length <= 20 ? data.map((d, i) => (
          <text key={i} x={pts[i].x} y={height - 6} textAnchor="middle" className="text-[0.5rem] fill-gray-400 dark:fill-gray-500">{d.label}</text>
        )) : (
          <>
            <text x={pts[0].x} y={height - 6} textAnchor="start" className="text-[0.5rem] fill-gray-400">{data[0].label}</text>
            {data.length > 2 && <text x={pts[Math.floor(data.length / 2)].x} y={height - 6} textAnchor="middle" className="text-[0.5rem] fill-gray-400">{data[Math.floor(data.length / 2)].label}</text>}
            <text x={pts[pts.length - 1].x} y={height - 6} textAnchor="end" className="text-[0.5rem] fill-gray-400">{data[data.length - 1].label}</text>
          </>
        )}
      </svg>
    );
  }
);
VizAreaLine.displayName = 'VizAreaLine';

// ══════════════════════════════════════════════════════════════════
// 2. VizBarChart - Beautiful vertical bar chart
// ══════════════════════════════════════════════════════════════════

interface BarChartProps {
  data: { label: string; value: number; highlight?: boolean }[];
  height?: number;
  barColor?: string;
  highlightColor?: string;
  showValues?: boolean;
  meanLine?: number;
}

export const VizBarChart = forwardRef<SVGSVGElement, BarChartProps>(
  ({ data, height = 180, barColor, highlightColor, showValues = true, meanLine }, ref) => {
    const W = 600, pad = { left: 40, right: 15, top: 15, bottom: 30 };
    const cw = W - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;
    const maxVal = Math.max(...data.map(d => d.value), meanLine ?? 0, 1);
    const barW = Math.max(Math.min(cw / data.length - 3, 40), 4);
    const gap = (cw - barW * data.length) / Math.max(data.length, 1);

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}>
        <ChartDefs id="bc_" />
        {yGridLines(3, pad.left, W - pad.right, pad.top, pad.top + ch)}
        {[0, 1, 2, 3].map(i => {
          const v = maxVal * (1 - i / 3);
          return <text key={i} x={pad.left - 5} y={pad.top + (i / 3) * ch + 3} textAnchor="end" className="text-[0.5625rem] fill-gray-400 tabular-nums">{Math.round(v)}</text>;
        })}
        {data.map((d, i) => {
          const barH = (d.value / maxVal) * ch;
          const x = pad.left + i * (barW + gap) + gap / 2;
          const y = pad.top + ch - barH;
          const fill = d.highlight
            ? (highlightColor ?? '#d97706')
            : (barColor ?? 'url(#bc_gBar)');
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx={Math.min(barW / 4, 4)} fill={fill} opacity={0.85} className="transition-opacity hover:opacity-100">
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
              {showValues && barH > 15 && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" className="text-[0.4375rem] fill-gray-400 tabular-nums">{d.value}</text>
              )}
              {data.length <= 24 && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="text-[0.4375rem] fill-gray-400" transform={data.length > 12 ? `rotate(-45,${x + barW / 2},${height - 6})` : undefined}>
                  {d.label.length > 8 ? d.label.slice(0, 8) : d.label}
                </text>
              )}
            </g>
          );
        })}
        {meanLine !== undefined && (
          <g>
            <line
              x1={pad.left}
              y1={pad.top + ch - (meanLine / maxVal) * ch}
              x2={W - pad.right}
              y2={pad.top + ch - (meanLine / maxVal) * ch}
              stroke="#d97706" strokeWidth="1.5" strokeDasharray="5,3"
            />
            <text x={W - pad.right + 4} y={pad.top + ch - (meanLine / maxVal) * ch + 3} className="text-[0.5rem] fill-amber-600">avg</text>
          </g>
        )}
      </svg>
    );
  }
);
VizBarChart.displayName = 'VizBarChart';

// ══════════════════════════════════════════════════════════════════
// 3. VizHorizontalBars - Horizontal bar chart with labels
// ══════════════════════════════════════════════════════════════════

interface HBarProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
}

export const VizHorizontalBars = forwardRef<SVGSVGElement, HBarProps>(
  ({ data, height: fixedHeight }, ref) => {
    const barH = 24, gap = 6, labelW = 80, valueW = 50;
    const W = 550;
    const h = fixedHeight ?? Math.max(data.length * (barH + gap) + 20, 80);
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barArea = W - labelW - valueW - 20;
    const sorted = [...data].sort((a, b) => b.value - a.value);

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${h}`} className="w-full" style={{ height: h }}>
        <ChartDefs id="hb_" />
        {sorted.map((d, i) => {
          const y = i * (barH + gap) + 8;
          const barW = (d.value / maxVal) * barArea;
          return (
            <g key={d.label}>
              <text x={labelW - 6} y={y + barH / 2 + 4} textAnchor="end" className="text-[0.625rem] fill-gray-600 dark:fill-gray-400 font-medium">{d.label}</text>
              <rect x={labelW} y={y} width={barW} height={barH} rx={barH / 4} fill={d.color ?? 'url(#hb_gNavyH)'} opacity={0.85} className="transition-opacity hover:opacity-100">
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
              <text x={labelW + barW + 8} y={y + barH / 2 + 4} className="text-[0.625rem] fill-gray-500 dark:fill-gray-400 tabular-nums font-medium">{d.value}</text>
            </g>
          );
        })}
      </svg>
    );
  }
);
VizHorizontalBars.displayName = 'VizHorizontalBars';

// ══════════════════════════════════════════════════════════════════
// 4. VizHeatmap - Beautiful color matrix
// ══════════════════════════════════════════════════════════════════

interface HeatmapProps {
  labels: string[];
  matrix: number[][];
  type: 'frequency' | 'zscore';
  maxDisplay?: number;
}

export const VizHeatmap = forwardRef<SVGSVGElement, HeatmapProps>(
  ({ labels, matrix, type, maxDisplay = 15 }, ref) => {
    const displayLabels = labels.slice(0, maxDisplay);
    const n = displayLabels.length;
    if (n === 0) return null;

    const cellSize = Math.max(20, Math.min(32, Math.floor(480 / n)));
    const labelSpace = 70;
    const totalW = cellSize * n + labelSpace + 20;
    const totalH = cellSize * n + labelSpace + 20;

    const maxFreq = type === 'frequency' ? Math.max(...matrix.flat().filter(Number.isFinite), 1) : 1;

    function cellColor(val: number): string {
      if (type === 'zscore') {
        if (val >= 1.96) {
          const t = Math.min(val / 5, 1);
          return `rgba(0, 0, 128, ${0.25 + t * 0.6})`;
        }
        if (val <= -1.96) {
          const t = Math.min(Math.abs(val) / 5, 1);
          return `rgba(220, 38, 38, ${0.2 + t * 0.5})`;
        }
        return 'rgba(0,0,0,0.03)';
      }
      const t = val / maxFreq;
      return `rgba(0, 0, 128, ${0.06 + t * 0.75})`;
    }

    return (
      <svg ref={ref} viewBox={`0 0 ${totalW} ${totalH}`} width={totalW} height={totalH} className="max-w-full">
        {displayLabels.map((rowLabel, ri) => (
          <g key={rowLabel}>
            <text x={labelSpace - 4} y={ri * cellSize + labelSpace + cellSize / 2 + 4} textAnchor="end" className="text-[0.5rem] fill-gray-500 dark:fill-gray-400 font-mono">
              {rowLabel.length > 10 ? rowLabel.slice(0, 10) : rowLabel}
            </text>
            {displayLabels.map((_, ci) => {
              const val = matrix[ri]?.[ci] ?? 0;
              const x = ci * cellSize + labelSpace;
              const y = ri * cellSize + labelSpace;
              const isSignificant = type === 'zscore' && Math.abs(val) >= 1.96;
              return (
                <g key={ci}>
                  <rect x={x + 1} y={y + 1} width={cellSize - 2} height={cellSize - 2} rx={3} fill={cellColor(val)} className="transition-colors">
                    <title>{`${labels[ri]} → ${labels[ci]}: ${type === 'zscore' ? val.toFixed(2) : val}`}</title>
                  </rect>
                  {isSignificant && (
                    <rect x={x} y={y} width={cellSize} height={cellSize} rx={4} fill="none" stroke={val > 0 ? '#000080' : '#dc2626'} strokeWidth="1.5" opacity={0.5} />
                  )}
                  {cellSize >= 24 && val !== 0 && (
                    <text x={x + cellSize / 2} y={y + cellSize / 2 + 3} textAnchor="middle" className={`text-[0.4375rem] tabular-nums ${isSignificant ? 'fill-white font-medium' : 'fill-gray-400'}`}>
                      {type === 'zscore' ? (Math.abs(val) >= 10 ? Math.round(val) : val.toFixed(1)) : val}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
        {/* Column labels (rotated) */}
        {displayLabels.map((colLabel, ci) => (
          <text key={ci} x={ci * cellSize + labelSpace + cellSize / 2} y={labelSpace - 6} textAnchor="end" className="text-[0.5rem] fill-gray-500 dark:fill-gray-400 font-mono" transform={`rotate(-45,${ci * cellSize + labelSpace + cellSize / 2},${labelSpace - 6})`}>
            {colLabel.length > 10 ? colLabel.slice(0, 10) : colLabel}
          </text>
        ))}
        {/* Legend */}
        {type === 'zscore' && (
          <g>
            <rect x={totalW - 110} y={4} width={10} height={10} rx={2} fill="rgba(0,0,128,0.5)" />
            <text x={totalW - 96} y={12} className="text-[0.5rem] fill-gray-500">z &ge; 1.96</text>
            <rect x={totalW - 110} y={18} width={10} height={10} rx={2} fill="rgba(220,38,38,0.4)" />
            <text x={totalW - 96} y={26} className="text-[0.5rem] fill-gray-500">z &le; -1.96</text>
          </g>
        )}
      </svg>
    );
  }
);
VizHeatmap.displayName = 'VizHeatmap';

// ══════════════════════════════════════════════════════════════════
// 5. VizLorenz - Beautiful Lorenz curve
// ══════════════════════════════════════════════════════════════════

interface LorenzProps {
  data: { populationPct: number; contributionPct: number }[];
  gini: number;
  interpretation?: string;
}

export const VizLorenz = forwardRef<SVGSVGElement, LorenzProps>(
  ({ data, gini, interpretation }, ref) => {
    const S = 320, pad = 40, inner = S - pad * 2;
    const giniColor = gini > 0.4 ? '#dc2626' : gini > 0.25 ? '#d97706' : '#059669';

    const pts = data.map(p => ({
      x: pad + (p.populationPct / 100) * inner,
      y: S - pad - (p.contributionPct / 100) * inner,
    }));

    const areaPath = `M${pad},${S - pad} ${pts.map(p => `L${p.x},${p.y}`).join(' ')} L${pad + inner},${S - pad}Z`;

    return (
      <svg ref={ref} viewBox={`0 0 ${S} ${S + 30}`} className="w-full max-w-[340px] mx-auto" style={{ height: S + 30 }}>
        <defs>
          <linearGradient id="lorenzFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000080" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#000080" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        {/* Grid */}
        {[0.25, 0.5, 0.75].map(t => (
          <g key={t}>
            <line x1={pad} y1={S - pad - t * inner} x2={pad + inner} y2={S - pad - t * inner} stroke="currentColor" strokeWidth="0.5" className="text-gray-200 dark:text-gray-800" />
            <line x1={pad + t * inner} y1={pad} x2={pad + t * inner} y2={S - pad} stroke="currentColor" strokeWidth="0.5" className="text-gray-200 dark:text-gray-800" />
            <text x={pad - 4} y={S - pad - t * inner + 3} textAnchor="end" className="text-[0.5rem] fill-gray-400 tabular-nums">{Math.round(t * 100)}</text>
            <text x={pad + t * inner} y={S - pad + 14} textAnchor="middle" className="text-[0.5rem] fill-gray-400 tabular-nums">{Math.round(t * 100)}</text>
          </g>
        ))}
        {/* Axes */}
        <line x1={pad} y1={S - pad} x2={pad + inner} y2={S - pad} stroke="currentColor" strokeWidth="1" className="text-gray-300 dark:text-gray-700" />
        <line x1={pad} y1={pad} x2={pad} y2={S - pad} stroke="currentColor" strokeWidth="1" className="text-gray-300 dark:text-gray-700" />
        {/* Equality line */}
        <line x1={pad} y1={S - pad} x2={pad + inner} y2={pad} stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="6,4" />
        <text x={pad + inner * 0.7} y={pad + inner * 0.2} className="text-[0.5625rem] fill-gray-300 dark:fill-gray-600" transform={`rotate(-45,${pad + inner * 0.7},${pad + inner * 0.2})`}>
          Perfect equality
        </text>
        {/* Fill */}
        <path d={areaPath} fill="url(#lorenzFill)" />
        {/* Lorenz curve */}
        <path d={smoothLine(pts)} fill="none" stroke="#000080" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* Gini badge */}
        <g transform={`translate(${pad + inner * 0.55},${S - pad - inner * 0.25})`}>
          <rect x={-38} y={-14} width={76} height={28} rx={14} fill="white" stroke={giniColor} strokeWidth="1.5" className="dark:fill-gray-950" />
          <text y={4} textAnchor="middle" className="text-[0.6875rem] font-semibold tabular-nums" fill={giniColor}>G = {gini.toFixed(3)}</text>
        </g>
        {/* Axis labels */}
        <text x={pad + inner / 2} y={S - 4} textAnchor="middle" className="text-[0.5625rem] fill-gray-500">Population %</text>
        <text x={14} y={pad + inner / 2} textAnchor="middle" className="text-[0.5625rem] fill-gray-500" transform={`rotate(-90,14,${pad + inner / 2})`}>Contribution %</text>
        {interpretation && (
          <text x={S / 2} y={S + 20} textAnchor="middle" className="text-[0.625rem] font-medium" fill={giniColor}>{interpretation}</text>
        )}
      </svg>
    );
  }
);
VizLorenz.displayName = 'VizLorenz';

// ══════════════════════════════════════════════════════════════════
// 6. VizRadialBars - Polar bar chart for hourly distribution
// ══════════════════════════════════════════════════════════════════

interface RadialBarsProps {
  data: number[];
  labels?: string[];
}

export const VizRadialBars = forwardRef<SVGSVGElement, RadialBarsProps>(
  ({ data, labels }, ref) => {
    const S = 280, cx = S / 2, cy = S / 2;
    const maxR = S / 2 - 30, minR = 30;
    const maxVal = Math.max(...data, 1);
    const n = data.length;

    return (
      <svg ref={ref} viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[300px] mx-auto" style={{ height: S }}>
        <defs>
          <radialGradient id="radialNavy" cx="50%" cy="50%" r="50%">
            <stop offset="40%" stopColor="#000080" stopOpacity={0.7} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.3} />
          </radialGradient>
        </defs>
        {/* Guide circles */}
        {[0.25, 0.5, 0.75, 1].map(t => (
          <circle key={t} cx={cx} cy={cy} r={minR + t * (maxR - minR)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-gray-200 dark:text-gray-800" />
        ))}
        {/* Bars */}
        {data.map((val, i) => {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          const nextAngle = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
          const r = minR + (val / maxVal) * (maxR - minR);
          const x1 = cx + Math.cos(angle) * minR;
          const y1 = cy + Math.sin(angle) * minR;
          const x2 = cx + Math.cos(angle) * r;
          const y2 = cy + Math.sin(angle) * r;
          const x3 = cx + Math.cos(nextAngle) * r;
          const y3 = cy + Math.sin(nextAngle) * r;
          const x4 = cx + Math.cos(nextAngle) * minR;
          const y4 = cy + Math.sin(nextAngle) * minR;
          const lf = (nextAngle - angle) > Math.PI ? 1 : 0;
          const isActive = i >= 8 && i <= 22;
          return (
            <g key={i}>
              <path
                d={`M${x1},${y1} L${x2},${y2} A${r},${r} 0 ${lf},1 ${x3},${y3} L${x4},${y4} A${minR},${minR} 0 ${lf},0 ${x1},${y1}Z`}
                fill={isActive ? 'rgba(0,0,128,0.55)' : 'rgba(0,0,128,0.2)'}
                stroke="white"
                strokeWidth="0.5"
                className="transition-all hover:opacity-90 dark:stroke-gray-950"
              >
                <title>{`${labels?.[i] ?? i}:00 - ${val}`}</title>
              </path>
            </g>
          );
        })}
        {/* Hour labels */}
        {[0, 3, 6, 9, 12, 15, 18, 21].map(h => {
          const angle = (h / n) * Math.PI * 2 - Math.PI / 2;
          const lx = cx + Math.cos(angle) * (maxR + 14);
          const ly = cy + Math.sin(angle) * (maxR + 14);
          return <text key={h} x={lx} y={ly + 3} textAnchor="middle" className="text-[0.5rem] fill-gray-400 font-medium">{h}</text>;
        })}
      </svg>
    );
  }
);
VizRadialBars.displayName = 'VizRadialBars';

// ══════════════════════════════════════════════════════════════════
// 7. VizStackedBar - Stacked horizontal bar
// ══════════════════════════════════════════════════════════════════

interface StackedBarProps {
  segments: { label: string; value: number; color: string }[];
  total?: number;
  height?: number;
}

export const VizStackedBar = forwardRef<SVGSVGElement, StackedBarProps>(
  ({ segments, total: forcedTotal, height = 60 }, ref) => {
    const W = 500, pad = 15;
    const barW = W - pad * 2, barH = 28, barY = 4;
    const total = forcedTotal ?? segments.reduce((a, s) => a + s.value, 0);
    if (total === 0) return null;

    let x = pad;
    const rects = segments.map(s => {
      const w = (s.value / total) * barW;
      const rect = { x, w, ...s };
      x += w;
      return rect;
    });

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}>
        <rect x={pad} y={barY} width={barW} height={barH} rx={barH / 2} fill="currentColor" className="text-gray-100 dark:text-gray-800" />
        {rects.map((r, i) => (
          <g key={i}>
            <rect
              x={r.x}
              y={barY}
              width={Math.max(r.w, 1)}
              height={barH}
              rx={i === 0 ? barH / 2 : i === rects.length - 1 ? barH / 2 : 0}
              fill={r.color}
              opacity={0.8}
            >
              <title>{`${r.label}: ${r.value} (${((r.value / total) * 100).toFixed(0)}%)`}</title>
            </rect>
            {r.w > 30 && (
              <text x={r.x + r.w / 2} y={barY + barH / 2 + 4} textAnchor="middle" className="text-[0.5625rem] fill-white font-medium">
                {((r.value / total) * 100).toFixed(0)}%
              </text>
            )}
          </g>
        ))}
        {/* Legend */}
        <g transform={`translate(${pad},${barY + barH + 10})`}>
          {segments.map((s, i) => {
            const lx = i * (W / segments.length);
            return (
              <g key={i} transform={`translate(${lx},0)`}>
                <rect width={10} height={10} rx={3} fill={s.color} opacity={0.8} />
                <text x={14} y={9} className="text-[0.5625rem] fill-gray-600 dark:fill-gray-400">{s.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    );
  }
);
VizStackedBar.displayName = 'VizStackedBar';

// ══════════════════════════════════════════════════════════════════
// 8. VizDualAxis - Dual-axis line chart (e.g., momentum + acceleration)
// ══════════════════════════════════════════════════════════════════

interface DualAxisProps {
  series1: { label: string; value: number }[];
  series2: { label: string; value: number }[];
  s1Label?: string;
  s2Label?: string;
  s1Color?: string;
  s2Color?: string;
  height?: number;
}

export const VizDualAxis = forwardRef<SVGSVGElement, DualAxisProps>(
  ({ series1, series2, s1Label, s2Label, s1Color = '#000080', s2Color = '#d97706', height = 200 }, ref) => {
    const W = 600, pad = { left: 45, right: 45, top: 20, bottom: 35 };
    const cw = W - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;
    const midY = pad.top + ch / 2;

    const max1 = Math.max(...series1.map(d => Math.abs(d.value)), 1);
    const max2 = Math.max(...series2.map(d => Math.abs(d.value)), 0.1);

    const pts1 = series1.map((d, i) => ({
      x: pad.left + (i / Math.max(series1.length - 1, 1)) * cw,
      y: midY - (d.value / max1) * (ch / 2),
    }));
    const pts2 = series2.map((d, i) => ({
      x: pad.left + (i / Math.max(series2.length - 1, 1)) * cw,
      y: midY - (d.value / max2) * (ch / 2 * 0.6),
    }));

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}>
        <ChartDefs id="da_" />
        {/* Zero line */}
        <line x1={pad.left} y1={midY} x2={W - pad.right} y2={midY} stroke="currentColor" strokeWidth="0.5" className="text-gray-300 dark:text-gray-700" />
        {yGridLines(2, pad.left, W - pad.right, pad.top, midY)}
        {yGridLines(2, pad.left, W - pad.right, midY, pad.top + ch)}
        {/* Series 1 area + line */}
        <path d={smoothLine(pts1) + `L${pts1[pts1.length - 1].x},${midY}L${pts1[0].x},${midY}Z`} fill={s1Color} opacity={0.08} />
        <path d={smoothLine(pts1)} fill="none" stroke={s1Color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* Series 2 line (dashed) */}
        <path d={smoothLine(pts2)} fill="none" stroke={s2Color} strokeWidth="1.5" strokeDasharray="4,3" strokeLinejoin="round" />
        {/* Legend */}
        <g transform={`translate(${pad.left},${height - 10})`}>
          <line x1={0} y1={-3} x2={16} y2={-3} stroke={s1Color} strokeWidth="2" />
          <text x={20} y={0} className="text-[0.5625rem] fill-gray-600 dark:fill-gray-400">{s1Label ?? 'Series 1'}</text>
          <line x1={120} y1={-3} x2={136} y2={-3} stroke={s2Color} strokeWidth="1.5" strokeDasharray="4,3" />
          <text x={140} y={0} className="text-[0.5625rem] fill-gray-600 dark:fill-gray-400">{s2Label ?? 'Series 2'}</text>
        </g>
        {/* X labels */}
        {series1.length > 0 && <text x={pts1[0].x} y={height - 22} textAnchor="start" className="text-[0.4375rem] fill-gray-400">{series1[0].label}</text>}
        {series1.length > 2 && <text x={pts1[pts1.length - 1].x} y={height - 22} textAnchor="end" className="text-[0.4375rem] fill-gray-400">{series1[series1.length - 1].label}</text>}
      </svg>
    );
  }
);
VizDualAxis.displayName = 'VizDualAxis';

// ══════════════════════════════════════════════════════════════════
// 9. VizNetworkGraph - Simple force-directed network layout
// ══════════════════════════════════════════════════════════════════

interface NetworkNode { id: string; weight: number }
interface NetworkEdge { source: string; target: string; weight: number }
interface NetworkGraphProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export const VizNetworkGraph = forwardRef<SVGSVGElement, NetworkGraphProps>(
  ({ nodes, edges }, ref) => {
    const W = 700, H = 420;

    const positioned = useMemo(() => {
      const n = nodes.length;
      if (n === 0) return [] as { id: string; x: number; y: number; r: number; weight: number }[];
      const maxWeight = Math.max(...nodes.map(nd => nd.weight), 1);

      const arr = [...nodes].sort((a, b) => b.weight - a.weight).map((node, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const dist = 60 + (i / n) * 120;
        return {
          id: node.id,
          x: W / 2 + Math.cos(angle) * dist,
          y: H / 2 + Math.sin(angle) * dist,
          r: Math.max(5, 6 + (node.weight / maxWeight) * 16),
          weight: node.weight,
        };
      });

      const nodeMap = new Map(arr.map(n => [n.id, n]));
      for (let iter = 0; iter < 60; iter++) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const dx = arr[j].x - arr[i].x;
            const dy = arr[j].y - arr[i].y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const minDist = arr[i].r + arr[j].r + 30;
            if (dist < minDist) {
              const force = (minDist - dist) * 0.3;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              arr[i].x -= fx; arr[i].y -= fy;
              arr[j].x += fx; arr[j].y += fy;
            }
          }
        }
        for (const e of edges) {
          const s = nodeMap.get(e.source);
          const t = nodeMap.get(e.target);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const ideal = 100;
          const force = (dist - ideal) * 0.005;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          s.x += fx; s.y += fy; t.x -= fx; t.y -= fy;
        }
        for (const nd of arr) {
          nd.x += (W / 2 - nd.x) * 0.02;
          nd.y += (H / 2 - nd.y) * 0.02;
        }
      }
      for (const nd of arr) {
        nd.x = Math.max(nd.r + 25, Math.min(W - nd.r - 25, nd.x));
        nd.y = Math.max(nd.r + 15, Math.min(H - nd.r - 15, nd.y));
      }
      return arr;
    }, [nodes, edges]);

    const maxEdgeW = Math.max(...edges.map(e => e.weight), 1);
    const posMap = new Map(positioned.map(p => [p.id, p]));

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <radialGradient id="nodeGrad" cx="40%" cy="40%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#000080" />
          </radialGradient>
        </defs>
        {edges.map((e, i) => {
          const s = posMap.get(e.source);
          const t = posMap.get(e.target);
          if (!s || !t) return null;
          return (
            <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#000080" strokeWidth={0.5 + (e.weight / maxEdgeW) * 2} opacity={0.12 + (e.weight / maxEdgeW) * 0.25}>
              <title>{`${e.source.slice(0, 6)} → ${e.target.slice(0, 6)}: ${e.weight}`}</title>
            </line>
          );
        })}
        {positioned.map(p => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={p.r} fill="url(#nodeGrad)" stroke="white" strokeWidth="1.5" className="dark:stroke-gray-950 transition-all hover:opacity-80">
              <title>{`${p.id.slice(0, 8)} (${p.weight})`}</title>
            </circle>
            <text x={p.x} y={p.y + p.r + 11} textAnchor="middle" className="text-[0.5rem] fill-gray-500 dark:fill-gray-400 font-mono">{p.id.slice(0, 6)}</text>
          </g>
        ))}
      </svg>
    );
  }
);
VizNetworkGraph.displayName = 'VizNetworkGraph';

// ══════════════════════════════════════════════════════════════════
// 10. VizGauge - Semi-circular gauge for ratio display
// ══════════════════════════════════════════════════════════════════

interface GaugeProps {
  value: number;
  max?: number;
  label: string;
  thresholds?: { value: number; color: string }[];
}

export const VizGauge: React.FC<GaugeProps> = ({ value, max = 5, label, thresholds }) => {
  const S = 160, cx = S / 2, cy = S * 0.65, r = 55;
  const startAngle = Math.PI * 0.8;
  const endAngle = Math.PI * 0.2;
  const range = startAngle + (Math.PI * 2 - startAngle) + endAngle;
  const clampedVal = Math.min(value, max);
  const t = clampedVal / max;
  const valAngle = startAngle + t * range;

  const arcPath = (start: number, end: number) => {
    const x1 = cx + Math.cos(Math.PI + start) * r;
    const y1 = cy + Math.sin(Math.PI + start) * r;
    const x2 = cx + Math.cos(Math.PI + end) * r;
    const y2 = cy + Math.sin(Math.PI + end) * r;
    const large = end - start > Math.PI ? 1 : 0;
    return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`;
  };

  const color = thresholds
    ? ([...thresholds].reverse().find(th => value >= th.value)?.color ?? '#059669')
    : (t > 0.7 ? '#dc2626' : t > 0.4 ? '#d97706' : '#059669');

  return (
    <svg viewBox={`0 0 ${S} ${S * 0.75}`} className="w-full max-w-[180px] mx-auto" style={{ height: S * 0.75 }}>
      {/* Background arc */}
      <path d={arcPath(0, range)} fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" className="text-gray-200 dark:text-gray-800" />
      {/* Value arc */}
      <path d={arcPath(0, t * range)} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      {/* Value text */}
      <text x={cx} y={cy - 2} textAnchor="middle" className="text-[1.125rem] font-bold tabular-nums" fill={color}>
        {value === Infinity ? '∞' : value.toFixed(2)}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" className="text-[0.5625rem] fill-gray-500">{label}</text>
    </svg>
  );
};

// 11. VizActivityHeatmap - GitHub-style calendar heatmap
// ══════════════════════════════════════════════════════════════════

interface ActivityHeatmapProps {
  data: { date: string; count: number }[];
  height?: number;
}

export const VizActivityHeatmap = forwardRef<SVGSVGElement, ActivityHeatmapProps>(
  ({ data, height = 140 }, ref) => {
    const W = 700;
    const cellSize = 11, gap = 2, pad = { left: 30, top: 20, right: 10 };

    const { weeks, maxCount, monthLabels } = useMemo(() => {
      if (data.length === 0) return { weeks: [] as { date: string; count: number; dow: number; week: number }[][], maxCount: 1, monthLabels: [] as { label: string; x: number }[] };
      const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
      const firstDate = new Date(sorted[0].date);
      const countMap = new Map(sorted.map(d => [d.date, d.count]));
      const max = Math.max(...sorted.map(d => d.count), 1);

      const startDow = firstDate.getDay();
      const ws: { date: string; count: number; dow: number; week: number }[][] = [];
      let currentWeek: typeof ws[0] = [];
      const mLabels: { label: string; x: number }[] = [];
      let lastMonth = -1;

      for (let i = 0; i < sorted.length + startDow; i++) {
        const d = new Date(firstDate);
        d.setDate(d.getDate() + (i - startDow));
        const dateStr = d.toISOString().slice(0, 10);
        const dow = d.getDay();
        const weekIdx = Math.floor(i / 7);

        if (i >= startDow) {
          const month = d.getMonth();
          if (month !== lastMonth) {
            mLabels.push({ label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month], x: weekIdx });
            lastMonth = month;
          }
          currentWeek.push({ date: dateStr, count: countMap.get(dateStr) ?? 0, dow, week: weekIdx });
        }
        if (dow === 6 || i === sorted.length + startDow - 1) {
          if (currentWeek.length > 0) ws.push(currentWeek);
          currentWeek = [];
        }
      }
      return { weeks: ws, maxCount: max, monthLabels: mLabels };
    }, [data]);

    if (weeks.length === 0) return null;
    const totalWeeks = weeks.length;
    const actualW = pad.left + totalWeeks * (cellSize + gap) + pad.right;

    const getColor = (count: number) => {
      if (count === 0) return 'rgba(0,0,128,0.04)';
      const ratio = count / maxCount;
      if (ratio < 0.25) return 'rgba(0,0,128,0.15)';
      if (ratio < 0.5) return 'rgba(0,0,128,0.35)';
      if (ratio < 0.75) return 'rgba(0,0,128,0.6)';
      return 'rgba(0,0,128,0.9)';
    };

    return (
      <svg ref={ref} viewBox={`0 0 ${Math.max(actualW, W)} ${height}`} className="w-full" style={{ minHeight: height }}>
        {['Mon','Wed','Fri'].map((label, i) => (
          <text key={label} x={pad.left - 6} y={pad.top + [1,3,5][i] * (cellSize + gap) + cellSize / 2 + 3} textAnchor="end" className="text-[0.5rem] fill-gray-400">{label}</text>
        ))}
        {monthLabels.map((m, i) => (
          <text key={i} x={pad.left + m.x * (cellSize + gap)} y={pad.top - 6} className="text-[0.5rem] fill-gray-400">{m.label}</text>
        ))}
        {weeks.flat().map((cell, i) => (
          <rect key={i} x={pad.left + cell.week * (cellSize + gap)} y={pad.top + cell.dow * (cellSize + gap)} width={cellSize} height={cellSize} rx={2} fill={getColor(cell.count)}>
            <title>{cell.date}: {cell.count}</title>
          </rect>
        ))}
        {/* Legend */}
        <text x={actualW - 120} y={height - 8} className="text-[0.5rem] fill-gray-400">Less</text>
        {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
          <rect key={i} x={actualW - 100 + i * 14} y={height - 18} width={10} height={10} rx={2} fill={getColor(r * maxCount)} />
        ))}
        <text x={actualW - 25} y={height - 8} className="text-[0.5rem] fill-gray-400">More</text>
      </svg>
    );
  }
);

// 12. VizSessionHistogram - Session duration distribution
// ══════════════════════════════════════════════════════════════════

interface SessionHistogramProps {
  durations: number[];
  bucketSize?: number;
  height?: number;
}

export const VizSessionHistogram = forwardRef<SVGSVGElement, SessionHistogramProps>(
  ({ durations, bucketSize = 5, height = 180 }, ref) => {
    const W = 600, pad = { left: 45, right: 20, top: 15, bottom: 35 };
    const cw = W - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;

    const { buckets, maxCount } = useMemo(() => {
      if (durations.length === 0) return { buckets: [], maxCount: 0 };
      const maxDur = Math.min(Math.max(...durations), 120);
      const numBuckets = Math.ceil(maxDur / bucketSize);
      const b = Array.from({ length: numBuckets }, (_, i) => ({
        min: i * bucketSize,
        max: (i + 1) * bucketSize,
        count: 0,
      }));
      for (const d of durations) {
        const idx = Math.min(Math.floor(d / bucketSize), numBuckets - 1);
        if (idx >= 0 && idx < b.length) b[idx].count++;
      }
      return { buckets: b, maxCount: Math.max(...b.map(x => x.count), 1) };
    }, [durations, bucketSize]);

    if (buckets.length === 0) return null;
    const barW = cw / buckets.length - 2;

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full">
        <defs>
          <linearGradient id="hist_g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000080" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.4} />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(r => {
          const y = pad.top + ch - r * ch;
          return <line key={r} x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="#e5e7eb" strokeWidth={0.5} />;
        })}
        {buckets.map((b, i) => {
          const barH = (b.count / maxCount) * ch;
          const x = pad.left + i * (cw / buckets.length) + 1;
          const y = pad.top + ch - barH;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} fill="url(#hist_g)" rx={3} />
              {b.count > 0 && barH > 14 && <text x={x + barW / 2} y={y + 12} textAnchor="middle" className="text-[0.5rem] fill-white font-medium">{b.count}</text>}
            </g>
          );
        })}
        {buckets.filter((_, i) => i % Math.ceil(buckets.length / 8) === 0 || i === buckets.length - 1).map((b, i) => (
          <text key={i} x={pad.left + buckets.indexOf(b) * (cw / buckets.length) + barW / 2} y={height - 8} textAnchor="middle" className="text-[0.5rem] fill-gray-400">{b.min}m</text>
        ))}
        <text x={pad.left - 8} y={pad.top + 4} textAnchor="end" className="text-[0.5rem] fill-gray-400">{maxCount}</text>
        <text x={pad.left - 8} y={pad.top + ch} textAnchor="end" className="text-[0.5rem] fill-gray-400">0</text>
      </svg>
    );
  }
);

// 13. VizPhaseTimeline - Gantt-style phase visualization
// ══════════════════════════════════════════════════════════════════

interface PhaseTimelineProps {
  phases: { startDate: string; endDate: string; avgActivity: number; phase: string }[];
  height?: number;
}

export const VizPhaseTimeline = forwardRef<SVGSVGElement, PhaseTimelineProps>(
  ({ phases, height = 80 }, ref) => {
    const W = 600, pad = { left: 10, right: 10, top: 10, bottom: 25 };
    const barH = height - pad.top - pad.bottom - 10;

    const { segments, totalDays } = useMemo(() => {
      if (phases.length === 0) return { segments: [], totalDays: 0 };
      const first = new Date(phases[0].startDate).getTime();
      const last = new Date(phases[phases.length - 1].endDate).getTime();
      const total = Math.max((last - first) / 86400000, 1);
      const segs = phases.map(p => {
        const s = (new Date(p.startDate).getTime() - first) / 86400000;
        const e = (new Date(p.endDate).getTime() - first) / 86400000;
        return { ...p, x: s / total, w: Math.max((e - s) / total, 0.01) };
      });
      return { segments: segs, totalDays: total };
    }, [phases]);

    if (segments.length === 0) return null;
    const cw = W - pad.left - pad.right;
    const phaseColors: Record<string, string> = { high: '#059669', normal: '#6366f1', low: '#ef4444' };

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full">
        <rect x={pad.left} y={pad.top} width={cw} height={barH} rx={6} fill="#f3f4f6" className="dark:fill-gray-800" />
        {segments.map((s, i) => (
          <g key={i}>
            <rect
              x={pad.left + s.x * cw}
              y={pad.top + 2}
              width={s.w * cw - 1}
              height={barH - 4}
              rx={4}
              fill={phaseColors[s.phase] ?? '#6b7280'}
              opacity={0.75}
            />
            {s.w * cw > 40 && (
              <text x={pad.left + s.x * cw + (s.w * cw) / 2} y={pad.top + barH / 2 + 4} textAnchor="middle" className="text-[0.5625rem] fill-white font-medium">
                {s.phase === 'high' ? '↑' : s.phase === 'low' ? '↓' : '–'} {s.avgActivity}
              </text>
            )}
          </g>
        ))}
        <text x={pad.left} y={height - 5} className="text-[0.5rem] fill-gray-400">{phases[0]?.startDate}</text>
        <text x={W - pad.right} y={height - 5} textAnchor="end" className="text-[0.5rem] fill-gray-400">{phases[phases.length - 1]?.endDate}</text>
        {/* Legend */}
        {Object.entries(phaseColors).map(([label, color], i) => (
          <g key={label} transform={`translate(${pad.left + 80 + i * 70}, ${height - 7})`}>
            <rect width={8} height={8} rx={2} fill={color} opacity={0.75} />
            <text x={11} y={7} className="text-[0.5rem] fill-gray-500">{label}</text>
          </g>
        ))}
      </svg>
    );
  }
);

// 14. VizCumulativeCurve - Running total vs ideal linear
// ══════════════════════════════════════════════════════════════════

interface CumulativeCurveProps {
  data: { label: string; value: number }[];
  height?: number;
}

export const VizCumulativeCurve = forwardRef<SVGSVGElement, CumulativeCurveProps>(
  ({ data, height = 200 }, ref) => {
    const W = 600, pad = { left: 45, right: 20, top: 20, bottom: 35 };
    const cw = W - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;

    const { cumulative, total } = useMemo(() => {
      let sum = 0;
      const cum = data.map(d => { sum += d.value; return sum; });
      return { cumulative: cum, total: sum };
    }, [data]);

    if (data.length < 2 || total === 0) return null;
    const n = cumulative.length;

    const pts = cumulative.map((v, i) => ({
      x: pad.left + (i / (n - 1)) * cw,
      y: pad.top + ch - (v / total) * ch,
    }));

    const idealPts = Array.from({ length: n }, (_, i) => ({
      x: pad.left + (i / (n - 1)) * cw,
      y: pad.top + ch - ((i + 1) / n) * ch,
    }));

    const toPath = (points: { x: number; y: number }[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full">
        <defs>
          <linearGradient id="cum_fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000080" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#000080" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(r => (
          <line key={r} x1={pad.left} y1={pad.top + ch - r * ch} x2={W - pad.right} y2={pad.top + ch - r * ch} stroke="#e5e7eb" strokeWidth={0.5} />
        ))}
        {/* Ideal line */}
        <path d={toPath(idealPts)} fill="none" stroke="#d1d5db" strokeWidth={1} strokeDasharray="4" />
        {/* Actual fill */}
        <path d={`${toPath(pts)} L${pts[pts.length - 1].x},${pad.top + ch} L${pts[0].x},${pad.top + ch} Z`} fill="url(#cum_fill)" />
        {/* Actual line */}
        <path d={toPath(pts)} fill="none" stroke="#000080" strokeWidth={2} />
        {/* Labels */}
        <text x={pad.left} y={height - 5} className="text-[0.5rem] fill-gray-400">{data[0].label}</text>
        <text x={W - pad.right} y={height - 5} textAnchor="end" className="text-[0.5rem] fill-gray-400">{data[data.length - 1].label}</text>
        <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" className="text-[0.5rem] fill-gray-400">{total}</text>
        <text x={pad.left - 6} y={pad.top + ch + 4} textAnchor="end" className="text-[0.5rem] fill-gray-400">0</text>
        {/* Legend */}
        <line x1={W - 120} y1={pad.top + 6} x2={W - 100} y2={pad.top + 6} stroke="#000080" strokeWidth={2} />
        <text x={W - 96} y={pad.top + 10} className="text-[0.5rem] fill-gray-600">Actual</text>
        <line x1={W - 120} y1={pad.top + 20} x2={W - 100} y2={pad.top + 20} stroke="#d1d5db" strokeWidth={1} strokeDasharray="4" />
        <text x={W - 96} y={pad.top + 24} className="text-[0.5rem] fill-gray-400">Ideal</text>
      </svg>
    );
  }
);

// 15. VizRhythmOverlay - Multi-type 24h polar overlay
// ══════════════════════════════════════════════════════════════════

interface RhythmOverlayProps {
  clusters: { type: string; distribution: number[] }[];
  height?: number;
}

export const VizRhythmOverlay = forwardRef<SVGSVGElement, RhythmOverlayProps>(
  ({ clusters, height = 260 }, ref) => {
    const W = 400;
    const cx = W / 2, cy = height / 2, R = Math.min(cx, cy) - 30;

    const typeColors: Record<string, string> = {
      morning: '#f59e0b',
      afternoon: '#059669',
      evening: '#6366f1',
      night: '#1e3a8a',
    };

    const avgByType = useMemo(() => {
      const groups: Record<string, number[][]> = {};
      for (const c of clusters) {
        if (!groups[c.type]) groups[c.type] = [];
        groups[c.type].push(c.distribution);
      }
      return Object.entries(groups).map(([type, dists]) => {
        const avg = Array.from({ length: 24 }, (_, h) => {
          const sum = dists.reduce((a, d) => a + (d[h] ?? 0), 0);
          return sum / dists.length;
        });
        return { type, avg, count: dists.length };
      });
    }, [clusters]);

    const maxVal = Math.max(...avgByType.flatMap(a => a.avg), 1);

    const polarPath = (dist: number[]) => {
      return dist.map((v, h) => {
        const angle = (h / 24) * Math.PI * 2 - Math.PI / 2;
        const r = (v / maxVal) * R;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        return `${h === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') + ' Z';
    };

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full">
        {/* Rings */}
        {[0.25, 0.5, 0.75, 1].map(r => (
          <circle key={r} cx={cx} cy={cy} r={R * r} fill="none" stroke="#e5e7eb" strokeWidth={0.5} />
        ))}
        {/* Hour lines & labels */}
        {[0, 3, 6, 9, 12, 15, 18, 21].map(h => {
          const angle = (h / 24) * Math.PI * 2 - Math.PI / 2;
          return (
            <g key={h}>
              <line x1={cx} y1={cy} x2={cx + Math.cos(angle) * R} y2={cy + Math.sin(angle) * R} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={cx + Math.cos(angle) * (R + 14)} y={cy + Math.sin(angle) * (R + 14) + 3} textAnchor="middle" className="text-[0.5rem] fill-gray-400">{h}:00</text>
            </g>
          );
        })}
        {/* Overlay paths */}
        {avgByType.map(({ type, avg }) => (
          <path key={type} d={polarPath(avg)} fill={typeColors[type] ?? '#6b7280'} fillOpacity={0.12} stroke={typeColors[type] ?? '#6b7280'} strokeWidth={1.5} />
        ))}
        {/* Legend */}
        {avgByType.map(({ type, count }, i) => (
          <g key={type} transform={`translate(${10 + i * 90}, ${height - 14})`}>
            <rect width={10} height={10} rx={2} fill={typeColors[type]} opacity={0.7} />
            <text x={14} y={9} className="text-[0.5625rem] fill-gray-600">{type} ({count})</text>
          </g>
        ))}
      </svg>
    );
  }
);

// 16. VizEngagementSpans - Horizontal engagement timeline per author
// ══════════════════════════════════════════════════════════════════

interface EngagementSpansProps {
  authors: { authorId: string; firstActivity: string; lastActivity: string; totalDays: number; activeDays: number }[];
  height?: number;
}

export const VizEngagementSpans = forwardRef<SVGSVGElement, EngagementSpansProps>(
  ({ authors, height: forcedHeight }, ref) => {
    const W = 600, pad = { left: 70, right: 30, top: 20, bottom: 25 };
    const rowH = 22;
    const sorted = useMemo(() => [...authors].sort((a, b) => a.firstActivity.localeCompare(b.firstActivity)).slice(0, 20), [authors]);
    const h = forcedHeight ?? Math.max(pad.top + sorted.length * rowH + pad.bottom, 100);
    const cw = W - pad.left - pad.right;

    const { minDate, dateRange } = useMemo(() => {
      if (sorted.length === 0) return { minDate: 0, dateRange: 1 };
      const dates = sorted.flatMap(a => [new Date(a.firstActivity).getTime(), new Date(a.lastActivity).getTime()]);
      const min = Math.min(...dates);
      const max = Math.max(...dates);
      return { minDate: min, dateRange: Math.max(max - min, 86400000) };
    }, [sorted]);

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${h}`} className="w-full">
        {sorted.map((a, i) => {
          const y = pad.top + i * rowH;
          const x1 = pad.left + ((new Date(a.firstActivity).getTime() - minDate) / dateRange) * cw;
          const x2 = pad.left + ((new Date(a.lastActivity).getTime() - minDate) / dateRange) * cw;
          const ratio = a.totalDays > 0 ? a.activeDays / a.totalDays : 0;
          const barColor = ratio > 0.5 ? '#059669' : ratio > 0.25 ? '#d97706' : '#ef4444';
          return (
            <g key={a.authorId}>
              <text x={pad.left - 6} y={y + rowH / 2 + 3} textAnchor="end" className="text-[0.5625rem] fill-gray-500">{a.authorId.slice(0, 6)}</text>
              <rect x={x1} y={y + 4} width={Math.max(x2 - x1, 3)} height={rowH - 8} rx={4} fill={barColor} opacity={0.6} />
              <text x={Math.max(x2, x1 + 4) + 4} y={y + rowH / 2 + 3} className="text-[0.5rem] fill-gray-400">{a.activeDays}/{a.totalDays}d</text>
            </g>
          );
        })}
        {sorted.length > 0 && (
          <>
            <text x={pad.left} y={h - 5} className="text-[0.5rem] fill-gray-400">{sorted[0]?.firstActivity.slice(0, 10)}</text>
            <text x={W - pad.right} y={h - 5} textAnchor="end" className="text-[0.5rem] fill-gray-400">{sorted[sorted.length - 1]?.lastActivity.slice(0, 10)}</text>
          </>
        )}
      </svg>
    );
  }
);

// 17. VizStackedArea - Stacked area chart for multi-series timeline
// ══════════════════════════════════════════════════════════════════

interface StackedAreaProps {
  data: { label: string; values: Record<string, number> }[];
  series: { key: string; color: string; label: string }[];
  height?: number;
}

export const VizStackedArea = forwardRef<SVGSVGElement, StackedAreaProps>(
  ({ data, series, height = 200 }, ref) => {
    const W = 600, pad = { left: 40, right: 20, top: 15, bottom: 35 };
    const cw = W - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;

    const { stacked, maxY } = useMemo(() => {
      const layers = series.map(s => data.map(d => d.values[s.key] ?? 0));
      const cumLayers: number[][] = [];
      for (let si = 0; si < layers.length; si++) {
        cumLayers.push(layers[si].map((v, di) => {
          const below = si > 0 ? cumLayers[si - 1][di] : 0;
          return below + v;
        }));
      }
      const max = Math.max(...(cumLayers[cumLayers.length - 1] ?? [1]), 1);
      return { stacked: cumLayers, maxY: max };
    }, [data, series]);

    if (data.length < 2) return null;
    const n = data.length;
    const xOf = (i: number) => pad.left + (i / (n - 1)) * cw;
    const yOf = (v: number) => pad.top + ch - (v / maxY) * ch;

    const areaPath = (layerIdx: number) => {
      const top = stacked[layerIdx];
      const bottom = layerIdx > 0 ? stacked[layerIdx - 1] : top.map(() => 0);
      let path = `M${xOf(0)},${yOf(top[0])}`;
      for (let i = 1; i < n; i++) path += ` L${xOf(i)},${yOf(top[i])}`;
      for (let i = n - 1; i >= 0; i--) path += ` L${xOf(i)},${yOf(bottom[i])}`;
      return path + ' Z';
    };

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full">
        {[0, 0.25, 0.5, 0.75, 1].map(r => (
          <line key={r} x1={pad.left} y1={pad.top + ch - r * ch} x2={W - pad.right} y2={pad.top + ch - r * ch} stroke="#e5e7eb" strokeWidth={0.5} />
        ))}
        {series.map((s, si) => (
          <path key={s.key} d={areaPath(si)} fill={s.color} fillOpacity={0.5} stroke={s.color} strokeWidth={1} />
        ))}
        {/* X labels */}
        {data.filter((_, i) => i % Math.max(1, Math.floor(n / 6)) === 0 || i === n - 1).map((d, idx) => {
          const i = data.indexOf(d);
          return <text key={idx} x={xOf(i)} y={height - 8} textAnchor="middle" className="text-[0.5rem] fill-gray-400">{d.label}</text>;
        })}
        {/* Y labels */}
        <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" className="text-[0.5rem] fill-gray-400">{maxY}</text>
        <text x={pad.left - 6} y={pad.top + ch + 4} textAnchor="end" className="text-[0.5rem] fill-gray-400">0</text>
        {/* Legend */}
        {series.map((s, i) => (
          <g key={s.key} transform={`translate(${pad.left + i * 80}, ${pad.top - 10})`}>
            <rect width={10} height={8} rx={2} fill={s.color} fillOpacity={0.7} />
            <text x={13} y={7} className="text-[0.5625rem] fill-gray-500">{s.label}</text>
          </g>
        ))}
      </svg>
    );
  }
);

// 18. VizDegreeDistribution - Degree frequency histogram
// ══════════════════════════════════════════════════════════════════

interface DegreeDistProps {
  degrees: number[];
  height?: number;
}

export const VizDegreeDistribution = forwardRef<SVGSVGElement, DegreeDistProps>(
  ({ degrees, height = 180 }, ref) => {
    const W = 500, pad = { left: 40, right: 15, top: 15, bottom: 35 };
    const cw = W - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;

    const { buckets, maxCount } = useMemo(() => {
      if (degrees.length === 0) return { buckets: [] as { degree: number; count: number }[], maxCount: 0 };
      const maxDeg = Math.max(...degrees);
      const b: Record<number, number> = {};
      for (const d of degrees) b[d] = (b[d] ?? 0) + 1;
      const arr = Array.from({ length: maxDeg + 1 }, (_, i) => ({ degree: i, count: b[i] ?? 0 }));
      return { buckets: arr, maxCount: Math.max(...arr.map(x => x.count), 1) };
    }, [degrees]);

    if (buckets.length === 0) return null;
    const barW = Math.min(cw / buckets.length - 1, 24);

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full">
        <defs>
          <linearGradient id="deg_g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000080" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(r => (
          <line key={r} x1={pad.left} y1={pad.top + ch - r * ch} x2={W - pad.right} y2={pad.top + ch - r * ch} stroke="#e5e7eb" strokeWidth={0.5} />
        ))}
        {buckets.map((b, i) => {
          const barH = (b.count / maxCount) * ch;
          const x = pad.left + (i / buckets.length) * cw + (cw / buckets.length - barW) / 2;
          return (
            <g key={i}>
              <rect x={x} y={pad.top + ch - barH} width={barW} height={barH} fill="url(#deg_g)" rx={2} />
              {b.count > 0 && barH > 12 && <text x={x + barW / 2} y={pad.top + ch - barH + 11} textAnchor="middle" className="text-[0.4375rem] fill-white font-medium">{b.count}</text>}
            </g>
          );
        })}
        {buckets.filter((_, i) => i % Math.max(1, Math.ceil(buckets.length / 10)) === 0).map(b => (
          <text key={b.degree} x={pad.left + (b.degree / buckets.length) * cw + cw / buckets.length / 2} y={height - 8} textAnchor="middle" className="text-[0.5rem] fill-gray-400">{b.degree}</text>
        ))}
        <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" className="text-[0.5rem] fill-gray-400">{maxCount}</text>
        <text x={pad.left - 6} y={pad.top + ch + 4} textAnchor="end" className="text-[0.5rem] fill-gray-400">0</text>
        <text x={W / 2} y={height - 1} textAnchor="middle" className="text-[0.5rem] fill-gray-400">Degree</text>
      </svg>
    );
  }
);

// 19. VizScatterPlot - 2D scatter with labeled points
// ══════════════════════════════════════════════════════════════════

interface ScatterPlotProps {
  points: { label: string; x: number; y: number; size?: number }[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
}

export const VizScatterPlot = forwardRef<SVGSVGElement, ScatterPlotProps>(
  ({ points, xLabel, yLabel, height = 240 }, ref) => {
    const W = 540, pad = { left: 55, right: 40, top: 25, bottom: 45 };
    const cw = W - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;

    if (points.length === 0) return null;
    const maxX = Math.max(...points.map(p => p.x), 0.001) * 1.1;
    const maxY = Math.max(...points.map(p => p.y), 0.001) * 1.1;
    const maxSize = Math.max(...points.map(p => p.size ?? 1), 1);

    const mapped = points.map(p => ({
      ...p,
      cx: pad.left + (p.x / maxX) * cw,
      cy: pad.top + ch - (p.y / maxY) * ch,
      r: 4 + ((p.size ?? 1) / maxSize) * 9,
    }));

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full">
        {[0, 0.25, 0.5, 0.75, 1].map(r => (
          <g key={r}>
            <line x1={pad.left} y1={pad.top + ch - r * ch} x2={W - pad.right} y2={pad.top + ch - r * ch} stroke="#e5e7eb" strokeWidth={0.5} />
            <text x={pad.left - 6} y={pad.top + ch - r * ch + 3} textAnchor="end" className="text-[0.4375rem] fill-gray-400">{(maxY * r).toFixed(3)}</text>
          </g>
        ))}
        {[0, 0.5, 1].map(r => (
          <text key={r} x={pad.left + r * cw} y={height - 22} textAnchor="middle" className="text-[0.4375rem] fill-gray-400">{(maxX * r).toFixed(3)}</text>
        ))}
        {mapped.map((p, i) => (
          <g key={i}>
            <circle cx={p.cx} cy={p.cy} r={p.r} fill="#000080" fillOpacity={0.45} stroke="#000080" strokeWidth={0.8} />
            <text x={p.cx} y={p.cy - p.r - 4} textAnchor="middle" className="text-[0.5rem] fill-gray-500">{p.label}</text>
          </g>
        ))}
        {xLabel && <text x={pad.left + cw / 2} y={height - 4} textAnchor="middle" className="text-[0.5625rem] fill-gray-500">{xLabel}</text>}
        {yLabel && <text x={14} y={pad.top + ch / 2} textAnchor="middle" className="text-[0.5625rem] fill-gray-500" transform={`rotate(-90, 14, ${pad.top + ch / 2})`}>{yLabel}</text>}
      </svg>
    );
  }
);

// 20. VizDivergingBars - Diverging horizontal bar chart (in/out balance)
// ══════════════════════════════════════════════════════════════════

interface DivergingBarsProps {
  data: { label: string; left: number; right: number }[];
  leftLabel?: string;
  rightLabel?: string;
  leftColor?: string;
  rightColor?: string;
  height?: number;
}

export const VizDivergingBars = forwardRef<SVGSVGElement, DivergingBarsProps>(
  ({ data, leftLabel, rightLabel, leftColor = '#e11d48', rightColor = '#000080', height: forcedHeight }, ref) => {
    const W = 500, pad = { left: 60, right: 20, top: 20, bottom: 10 };
    const rowH = 22;
    const sorted = useMemo(() => [...data].sort((a, b) => (b.left + b.right) - (a.left + a.right)).slice(0, 15), [data]);
    const h = forcedHeight ?? Math.max(pad.top + sorted.length * rowH + pad.bottom, 80);
    const halfW = (W - pad.left - pad.right) / 2;
    const midX = pad.left + halfW;
    const maxVal = Math.max(...sorted.flatMap(d => [d.left, d.right]), 1);

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${h}`} className="w-full">
        <line x1={midX} y1={pad.top - 5} x2={midX} y2={pad.top + sorted.length * rowH} stroke="#d1d5db" strokeWidth={0.5} />
        {leftLabel && <text x={midX - halfW / 2} y={pad.top - 8} textAnchor="middle" className="text-[0.5625rem] fill-gray-500">{leftLabel}</text>}
        {rightLabel && <text x={midX + halfW / 2} y={pad.top - 8} textAnchor="middle" className="text-[0.5625rem] fill-gray-500">{rightLabel}</text>}
        {sorted.map((d, i) => {
          const y = pad.top + i * rowH;
          const lw = (d.left / maxVal) * halfW;
          const rw = (d.right / maxVal) * halfW;
          return (
            <g key={d.label}>
              <text x={pad.left - 4} y={y + rowH / 2 + 3} textAnchor="end" className="text-[0.5625rem] fill-gray-500">{d.label}</text>
              <rect x={midX - lw} y={y + 4} width={lw} height={rowH - 8} rx={3} fill={leftColor} opacity={0.65} />
              {lw > 18 && <text x={midX - lw + 4} y={y + rowH / 2 + 3} className="text-[0.4375rem] fill-white font-medium">{d.left}</text>}
              <rect x={midX + 1} y={y + 4} width={rw} height={rowH - 8} rx={3} fill={rightColor} opacity={0.65} />
              {rw > 18 && <text x={midX + rw - 4} y={y + rowH / 2 + 3} textAnchor="end" className="text-[0.4375rem] fill-white font-medium">{d.right}</text>}
            </g>
          );
        })}
      </svg>
    );
  }
);

// 21. VizRadarChart - Multi-axis radar for node role comparison
// ══════════════════════════════════════════════════════════════════

interface RadarChartProps {
  axes: string[];
  series: { label: string; values: number[]; color: string }[];
  height?: number;
}

export const VizRadarChart = forwardRef<SVGSVGElement, RadarChartProps>(
  ({ axes, series, height = 280 }, ref) => {
    const W = 400;
    const cx = W / 2, cy = height / 2 - 5, R = Math.min(cx, cy) - 35;
    const n = axes.length;
    if (n < 3) return null;

    const angleOf = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;

    const polyPoints = (values: number[]) =>
      values.map((v, i) => {
        const a = angleOf(i);
        const r = v * R;
        return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
      }).join(' ');

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full">
        {[0.25, 0.5, 0.75, 1].map(r => (
          <polygon key={r} points={axes.map((_, i) => `${cx + Math.cos(angleOf(i)) * R * r},${cy + Math.sin(angleOf(i)) * R * r}`).join(' ')} fill="none" stroke="#e5e7eb" strokeWidth={0.5} />
        ))}
        {axes.map((label, i) => {
          const a = angleOf(i);
          const lx = cx + Math.cos(a) * (R + 18);
          const ly = cy + Math.sin(a) * (R + 18);
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={cx + Math.cos(a) * R} y2={cy + Math.sin(a) * R} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={lx} y={ly + 3} textAnchor="middle" className="text-[0.5rem] fill-gray-500">{label}</text>
            </g>
          );
        })}
        {series.map((s, si) => (
          <g key={si}>
            <polygon points={polyPoints(s.values)} fill={s.color} fillOpacity={0.1} stroke={s.color} strokeWidth={1.5} />
            {s.values.map((v, i) => {
              const a = angleOf(i);
              return <circle key={i} cx={cx + Math.cos(a) * v * R} cy={cy + Math.sin(a) * v * R} r={3} fill={s.color} />;
            })}
          </g>
        ))}
        {series.map((s, i) => (
          <g key={i} transform={`translate(${10 + i * 80}, ${height - 12})`}>
            <rect width={10} height={8} rx={2} fill={s.color} opacity={0.7} />
            <text x={13} y={7} className="text-[0.5625rem] fill-gray-500">{s.label}</text>
          </g>
        ))}
      </svg>
    );
  }
);

// 22. VizKCoreShell - Concentric k-core shell diagram
// ══════════════════════════════════════════════════════════════════

interface KCoreShellProps {
  nodes: { id: string; kCore: number; degree: number }[];
  height?: number;
}

export const VizKCoreShell = forwardRef<SVGSVGElement, KCoreShellProps>(
  ({ nodes, height = 300 }, ref) => {
    const W = 450;
    const cx = W / 2, cy = height / 2;
    const maxR = Math.min(cx, cy) - 25;

    const { shells, maxCore, maxDeg } = useMemo(() => {
      const mc = Math.max(...nodes.map(n => n.kCore), 1);
      const md = Math.max(...nodes.map(n => n.degree), 1);
      const groups: Record<number, typeof nodes> = {};
      for (const n of nodes) {
        const k = n.kCore;
        if (!groups[k]) groups[k] = [];
        groups[k].push(n);
      }
      return { shells: groups, maxCore: mc, maxDeg: md };
    }, [nodes]);

    const coreColors = ['#ef4444', '#f59e0b', '#3b82f6', '#000080', '#1e3a8a'];

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="w-full">
        {Array.from({ length: maxCore + 1 }, (_, k) => k).reverse().map(k => {
          const r = maxR * ((maxCore - k + 1) / (maxCore + 1));
          return <circle key={k} cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray={k === 0 ? '4' : 'none'} />;
        })}
        {Object.entries(shells).map(([kStr, group]) => {
          const k = Number(kStr);
          const shellR = maxR * ((maxCore - k + 1) / (maxCore + 1)) * 0.85;
          const color = coreColors[Math.min(k, coreColors.length - 1)];
          return group.map((n, i) => {
            const angle = (i / group.length) * Math.PI * 2 - Math.PI / 2;
            const jitter = (Math.sin(i * 7) * 0.15 + 1) * shellR;
            const nx = cx + Math.cos(angle) * jitter;
            const ny = cy + Math.sin(angle) * jitter;
            const nr = 3 + (n.degree / maxDeg) * 7;
            return (
              <g key={n.id}>
                <circle cx={nx} cy={ny} r={nr} fill={color} fillOpacity={0.6} stroke={color} strokeWidth={0.8} />
                {nr > 5 && <text x={nx} y={ny - nr - 2} textAnchor="middle" className="text-[0.375rem] fill-gray-500">{n.id.slice(0, 4)}</text>}
              </g>
            );
          });
        })}
        {Array.from({ length: maxCore + 1 }, (_, k) => k).map(k => {
          const r = maxR * ((maxCore - k + 1) / (maxCore + 1));
          return <text key={k} x={cx + r - 8} y={cy - 4} className="text-[0.4375rem] fill-gray-400">k={k}</text>;
        })}
      </svg>
    );
  }
);

// 23. VizBrokerBars - Structural hole constraint ranking
// ══════════════════════════════════════════════════════════════════

interface BrokerBarsProps {
  data: { label: string; constraint: number }[];
  threshold?: number;
  height?: number;
}

export const VizBrokerBars = forwardRef<SVGSVGElement, BrokerBarsProps>(
  ({ data, threshold = 0.3, height: forcedHeight }, ref) => {
    const W = 500, pad = { left: 60, right: 30, top: 15, bottom: 10 };
    const rowH = 22;
    const sorted = useMemo(() => [...data].sort((a, b) => a.constraint - b.constraint).slice(0, 15), [data]);
    const h = forcedHeight ?? Math.max(pad.top + sorted.length * rowH + pad.bottom, 80);
    const cw = W - pad.left - pad.right;
    const maxVal = Math.max(...sorted.map(d => d.constraint), threshold + 0.1);

    const threshX = pad.left + (threshold / maxVal) * cw;

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${h}`} className="w-full">
        <line x1={threshX} y1={pad.top - 5} x2={threshX} y2={pad.top + sorted.length * rowH} stroke="#ef4444" strokeWidth={0.8} strokeDasharray="4" />
        <text x={threshX} y={pad.top - 8} textAnchor="middle" className="text-[0.5rem] fill-red-400">{threshold}</text>
        {sorted.map((d, i) => {
          const y = pad.top + i * rowH;
          const barW = (d.constraint / maxVal) * cw;
          const isBroker = d.constraint < threshold;
          return (
            <g key={d.label}>
              <text x={pad.left - 4} y={y + rowH / 2 + 3} textAnchor="end" className={`text-[0.5625rem] ${isBroker ? 'fill-emerald-600 font-medium' : 'fill-gray-500'}`}>{d.label}</text>
              <rect x={pad.left} y={y + 4} width={barW} height={rowH - 8} rx={3} fill={isBroker ? '#059669' : '#6b7280'} opacity={0.55} />
              <text x={pad.left + barW + 4} y={y + rowH / 2 + 3} className="text-[0.5rem] fill-gray-400 tabular-nums">{d.constraint.toFixed(3)}</text>
            </g>
          );
        })}
      </svg>
    );
  }
);

// ═══════════════════════════════════════════════════════════════════
// 24. VizConceptNetwork — force-directed keyword co-occurrence graph
// ═══════════════════════════════════════════════════════════════════

interface ConceptNetProps {
  nodes: { id: string; weight: number; freq: number }[];
  edges: { source: string; target: string; weight: number }[];
}

export const VizConceptNetwork = React.forwardRef<SVGSVGElement, ConceptNetProps>(
  ({ nodes, edges }, ref) => {
    const W = 700, H = 400;

    const positioned = useMemo(() => {
      if (nodes.length === 0) return { nodes: [] as { x: number; y: number; r: number; weight: number; id: string }[], edges: [] as typeof edges };

      const maxWeight = Math.max(...nodes.map(n => n.weight), 1);
      const nodeMap = new Map<string, { x: number; y: number; r: number; weight: number; id: string }>();
      const edgeSet = new Set(edges.flatMap(e => [e.source, e.target]));

      nodes.forEach((n, i) => {
        const angle = i * 2.399;
        const radius = 40 + i * 6;
        nodeMap.set(n.id, {
          x: W / 2 + Math.cos(angle) * Math.min(radius, W * 0.32),
          y: H / 2 + Math.sin(angle) * Math.min(radius, H * 0.32),
          r: 4 + (n.weight / maxWeight) * 10,
          weight: n.weight,
          id: n.id,
        });
      });

      const nodeArr = Array.from(nodeMap.values());
      for (let iter = 0; iter < 100; iter++) {
        for (let i = 0; i < nodeArr.length; i++) {
          for (let j = i + 1; j < nodeArr.length; j++) {
            const dx = nodeArr[j].x - nodeArr[i].x;
            const dy = nodeArr[j].y - nodeArr[i].y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const minDist = nodeArr[i].r + nodeArr[j].r + 35;
            if (dist < minDist) {
              const force = (minDist - dist) * 0.25;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              nodeArr[i].x -= fx; nodeArr[i].y -= fy;
              nodeArr[j].x += fx; nodeArr[j].y += fy;
            }
          }
        }
        for (const e of edges) {
          const s = nodeMap.get(e.source);
          const t = nodeMap.get(e.target);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const ideal = 70;
          const force = (dist - ideal) * 0.008 * Math.min(e.weight, 4);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          s.x += fx; s.y += fy; t.x -= fx; t.y -= fy;
        }
        for (const nd of nodeArr) {
          nd.x += (W / 2 - nd.x) * 0.04;
          nd.y += (H / 2 - nd.y) * 0.04;
        }
      }
      for (const nd of nodeArr) {
        nd.x = Math.max(nd.r + 30, Math.min(W - nd.r - 30, nd.x));
        nd.y = Math.max(nd.r + 18, Math.min(H - nd.r - 18, nd.y));
      }

      return { nodes: nodeArr, edges };
    }, [nodes, edges]);

    const maxEdgeW = Math.max(...positioned.edges.map(e => e.weight), 1);
    const maxNodeW = Math.max(...positioned.nodes.map(n => n.weight), 1);
    const posMap = new Map(positioned.nodes.map(n => [n.id, n]));

    return (
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <radialGradient id="concept-glow">
            <stop offset="0%" stopColor="#000080" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#000080" stopOpacity="0" />
          </radialGradient>
        </defs>
        {positioned.edges.map((e, i) => {
          const s = posMap.get(e.source);
          const t = posMap.get(e.target);
          if (!s || !t) return null;
          return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#000080" strokeWidth={0.5 + (e.weight / maxEdgeW) * 2} strokeOpacity={0.2 + (e.weight / maxEdgeW) * 0.5} />;
        })}
        {positioned.nodes.map(n => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={n.r + 3} fill="url(#concept-glow)" />
            <circle cx={n.x} cy={n.y} r={n.r} fill="#000080" fillOpacity={0.2 + (n.weight / maxNodeW) * 0.55} stroke="#000080" strokeWidth={0.8} />
            <text x={n.x} y={n.y + n.r + 11} textAnchor="middle" className="text-[0.5rem] fill-gray-700 dark:fill-gray-300 font-medium">{n.id}</text>
          </g>
        ))}
      </svg>
    );
  }
);
