import React, { useEffect, useMemo, useState } from 'react';
import { dashboard as dashboardApi, type StudentAnalytics, type StudentPromisingIdeas } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { RELATION_COLORS } from '../relationColors';

// ═══════════════════════════════════════════════════════════════
// Shared bits
// ═══════════════════════════════════════════════════════════════

const RELATION_LABELS_ZH: Record<string, string> = { extend: '延伸', clarify: '澄清', question: '提问', challenge: '质疑', evidence: '证据', synthesize: '综合' };
const RELATION_LABELS_EN: Record<string, string> = { extend: 'Extend', clarify: 'Clarify', question: 'Question', challenge: 'Challenge', evidence: 'Evidence', synthesize: 'Synthesize' };

const Card: React.FC<{ title?: string; icon?: string; children: React.ReactNode; className?: string; accent?: string }> = ({ title, icon, children, className, accent }) => (
  <div className={`rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950 ${className ?? ''}`}>
    {title && (
      <div className="mb-3 flex items-center gap-2">
        {icon && <RemixIcon name={icon} size={14} className={accent ?? 'text-[#000080] dark:text-[#93AAFD]'} />}
        <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</span>
      </div>
    )}
    {children}
  </div>
);

const StatCard: React.FC<{ icon: string; iconBg: string; iconColor: string; label: string; value: React.ReactNode; sub?: string }> = ({ icon, iconBg, iconColor, label, value, sub }) => (
  <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
      <RemixIcon name={icon} size={18} className={iconColor} />
    </div>
    <div className="min-w-0">
      <div className="text-[1.25rem] font-bold tracking-tight text-stone-900 dark:text-stone-100">{value}</div>
      <div className="truncate text-[0.6875rem] text-stone-400 dark:text-stone-500">{label}</div>
      {sub && <div className="text-[0.6875rem] text-stone-400">{sub}</div>}
    </div>
  </div>
);

const Skeleton: React.FC = () => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map(i => <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />)}
    </div>
    <div className="h-56 animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />
  </div>
);

const EmptyHint: React.FC<{ zh: boolean }> = ({ zh }) => (
  <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center dark:border-stone-800 dark:bg-stone-950">
    <RemixIcon name="seedling-line" size={28} className="mx-auto text-stone-300 dark:text-stone-600" />
    <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
      {zh ? '暂无数据。进入课程社区发布你的第一篇笔记吧！' : 'No data yet. Publish your first note in a course community!'}
    </p>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// Mini visualizations (pure SVG)
// ═══════════════════════════════════════════════════════════════

/** Cumulative area chart of note growth */
const CumulativeArea: React.FC<{ dates: string[]; zh: boolean }> = ({ dates, zh }) => {
  const { path, area, points, maxY } = useMemo(() => {
    if (dates.length === 0) return { path: '', area: '', points: [] as { x: number; y: number; label: string; cum: number }[], maxY: 0 };
    const sorted = [...dates].sort();
    const start = new Date(sorted[0]).getTime();
    const end = Math.max(new Date(sorted[sorted.length - 1]).getTime(), start + 86400000);
    const W2 = 560, H2 = 120, pad = 8;
    const pts: { x: number; y: number; label: string; cum: number }[] = sorted.map((d, i) => ({
      x: pad + ((new Date(d).getTime() - start) / (end - start)) * (W2 - pad * 2),
      y: 0,
      label: d.slice(5, 10),
      cum: i + 1,
    }));
    const maxCum = pts.length;
    for (const p of pts) p.y = H2 - pad - (p.cum / maxCum) * (H2 - pad * 2);
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const areaPath = `${line} L${pts[pts.length - 1].x},${H2 - pad} L${pts[0].x},${H2 - pad} Z`;
    return { path: line, area: areaPath, points: pts, maxY: maxCum };
  }, [dates]);

  if (dates.length === 0) return <p className="py-6 text-center text-xs text-stone-400">{zh ? '暂无笔记' : 'No notes yet'}</p>;

  return (
    <svg viewBox="0 0 560 130" className="w-full">
      <defs>
        <linearGradient id="cum-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000080" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#000080" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#cum-grad)" />
      <path d={path} fill="none" stroke="#000080" strokeWidth="1.8" strokeLinecap="round" className="dark:stroke-[#4169E1]" />
      {points.length > 0 && (
        <>
          <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3.5" fill="#000080" className="dark:fill-[#4169E1]" />
          <text x={Math.min(points[points.length - 1].x, 520)} y={points[points.length - 1].y - 8} textAnchor="middle" fontSize="10" fontWeight="600" className="fill-stone-700 dark:fill-stone-200">{maxY}</text>
        </>
      )}
      <text x="8" y="126" fontSize="8" className="fill-stone-400">{points[0]?.label}</text>
      <text x="552" y="126" textAnchor="end" fontSize="8" className="fill-stone-400">{points[points.length - 1]?.label}</text>
    </svg>
  );
};

/** GitHub-style contribution heatmap: last 12 weeks */
const ContributionHeatmap: React.FC<{ dates: string[]; zh: boolean }> = ({ dates, zh }) => {
  const { weeks, monthLabels, activeDays, maxStreak } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of dates) {
      const key = d.slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const today = new Date();
    const numWeeks = 12;
    // Start from the Monday numWeeks-1 weeks before this week's Monday
    const dow = today.getDay() === 0 ? 7 : today.getDay();
    const thisMonday = new Date(today.getTime() - (dow - 1) * 86400000);
    const start = new Date(thisMonday.getTime() - (numWeeks - 1) * 7 * 86400000);
    const weeks: { date: string; count: number; future: boolean }[][] = [];
    const monthLabels: { idx: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < numWeeks; w++) {
      const col: { date: string; count: number; future: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(start.getTime() + (w * 7 + d) * 86400000);
        const key = day.toISOString().slice(0, 10);
        col.push({ date: key, count: counts.get(key) ?? 0, future: day > today });
      }
      const m = new Date(start.getTime() + w * 7 * 86400000).getMonth();
      if (m !== lastMonth) {
        monthLabels.push({ idx: w, label: `${m + 1}${'月'}` });
        lastMonth = m;
      }
      weeks.push(col);
    }
    // Streak: consecutive active days ending anywhere
    const sortedKeys = Array.from(counts.keys()).sort();
    let maxStreak = 0, cur = 0;
    let prev: string | null = null;
    for (const k of sortedKeys) {
      if (prev && new Date(k).getTime() - new Date(prev).getTime() === 86400000) cur++;
      else cur = 1;
      maxStreak = Math.max(maxStreak, cur);
      prev = k;
    }
    return { weeks, monthLabels, activeDays: counts.size, maxStreak };
  }, [dates]);

  const cell = 13, gap = 3;
  const color = (c: number) =>
    c === 0 ? 'fill-stone-100 dark:fill-stone-800'
      : c === 1 ? 'fill-[#93AAFD]/50 dark:fill-[#4169E1]/30'
        : c <= 3 ? 'fill-[#4169E1]/70 dark:fill-[#4169E1]/60'
          : 'fill-[#000080] dark:fill-[#4169E1]';

  return (
    <div>
      <svg viewBox={`0 0 ${12 * (cell + gap) + 20} ${7 * (cell + gap) + 16}`} className="w-full max-w-[440px]">
        {monthLabels.map(m => (
          <text key={m.idx} x={20 + m.idx * (cell + gap)} y={8} fontSize="8" className="fill-stone-400">{m.label}</text>
        ))}
        {['一', '三', '五'].map((d, i) => (
          <text key={d} x={0} y={14 + (i * 2 + 0.8) * (cell + gap) + 9} fontSize="8" className="fill-stone-400">{d}</text>
        ))}
        {weeks.map((col, w) => col.map((day, d) => (
          !day.future && (
            <g key={day.date} className="group">
              <rect
                x={20 + w * (cell + gap)}
                y={14 + d * (cell + gap)}
                width={cell} height={cell} rx={3}
                className={`${color(day.count)} transition-opacity hover:opacity-70`}
              >
                <title>{day.date} · {day.count}</title>
              </rect>
            </g>
          )
        )))}
      </svg>
      <div className="mt-2 flex items-center gap-4 text-[0.6875rem] text-stone-400">
        <span>{zh ? `活跃 ${activeDays} 天` : `${activeDays} active days`}</span>
        {maxStreak >= 2 && <span className="flex items-center gap-1"><RemixIcon name="fire-line" size={11} className="text-amber-500" />{zh ? `最长连续 ${maxStreak} 天` : `${maxStreak}-day streak`}</span>}
        <span className="ml-auto flex items-center gap-1">
          {zh ? '少' : 'Less'}
          {[0, 1, 2, 4].map(c => <span key={c} className={`inline-block h-2.5 w-2.5 rounded-[2px] ${color(c).replace('fill-', 'bg-').replace(' dark:fill-', ' dark:bg-')}`} />)}
          {zh ? '多' : 'More'}
        </span>
      </div>
    </div>
  );
};

/** 24-hour posting rhythm bars */
const HourBars: React.FC<{ hours: number[]; zh: boolean }> = ({ hours, zh }) => {
  const max = Math.max(...hours, 1);
  const peak = hours.indexOf(Math.max(...hours));
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="py-6 text-center text-xs text-stone-400">{zh ? '暂无数据' : 'No data'}</p>;
  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height: 72 }}>
        {hours.map((v, h) => (
          <div key={h} className="group relative flex-1">
            <div
              className={`w-full rounded-t transition-colors ${h === peak ? 'bg-amber-500' : 'bg-[#000080]/45 dark:bg-[#4169E1]/40'} group-hover:bg-[#000080] dark:group-hover:bg-[#4169E1]`}
              style={{ height: Math.max((v / max) * 64, v > 0 ? 3 : 1) }}
            />
            <div className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-stone-800 px-1.5 py-0.5 text-[0.6875rem] text-white group-hover:block">
              {h}:00 · {v}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[0.6875rem] text-stone-400">
        <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
      </div>
      <p className="mt-1.5 text-[0.6875rem] text-stone-400">
        {zh ? `你最常在 ${peak}:00 前后发布笔记` : `You post most often around ${peak}:00`}
      </p>
    </div>
  );
};

/** Radar chart for the 5-dimension thinking profile */
const ThinkingRadar: React.FC<{ dims: { label: string; value: number }[] }> = ({ dims }) => {
  const C = 110, R = 78;
  const angle = (i: number) => (Math.PI * 2 * i) / dims.length - Math.PI / 2;
  const pt = (i: number, r: number) => [C + r * Math.cos(angle(i)), C + r * Math.sin(angle(i))];
  const poly = dims.map((d, i) => pt(i, Math.max(d.value, 0.04) * R).join(',')).join(' ');
  return (
    <svg viewBox="0 0 220 220" className="mx-auto w-full max-w-[300px]">
      {[0.25, 0.5, 0.75, 1].map(f => (
        <polygon
          key={f}
          points={dims.map((_, i) => pt(i, R * f).join(',')).join(' ')}
          fill="none"
          className="stroke-stone-200 dark:stroke-stone-700"
          strokeWidth="0.8"
        />
      ))}
      {dims.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={C} y1={C} x2={x} y2={y} className="stroke-stone-200 dark:stroke-stone-700" strokeWidth="0.8" />;
      })}
      <polygon points={poly} fill="#000080" fillOpacity="0.16" stroke="#000080" strokeWidth="1.8" strokeLinejoin="round" className="dark:fill-[#4169E1]/25 dark:stroke-[#4169E1]" />
      {dims.map((d, i) => {
        const [x, y] = pt(i, Math.max(d.value, 0.04) * R);
        return <circle key={i} cx={x} cy={y} r="3" fill="#000080" className="dark:fill-[#4169E1]" />;
      })}
      {dims.map((d, i) => {
        const [x, y] = pt(i, R + 16);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="600" className="fill-stone-600 dark:fill-stone-300">
            {d.label}
          </text>
        );
      })}
    </svg>
  );
};

/** Diverging horizontal bars: relation types given vs received */
const RelationTypeBars: React.FC<{ given: Record<string, number>; received: Record<string, number>; zh: boolean }> = ({ given, received, zh }) => {
  const types = ['extend', 'clarify', 'question', 'challenge', 'evidence', 'synthesize'];
  const labels = zh ? RELATION_LABELS_ZH : RELATION_LABELS_EN;
  const max = Math.max(...types.map(t => Math.max(given[t] ?? 0, received[t] ?? 0)), 1);
  const total = types.reduce((s, t) => s + (given[t] ?? 0) + (received[t] ?? 0), 0);
  if (total === 0) return <p className="py-6 text-center text-xs text-stone-400">{zh ? '暂无互动数据' : 'No interactions yet'}</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[0.6875rem] text-stone-400">
        <span>← {zh ? '我发出的' : 'Given'}</span>
        <span>{zh ? '我收到的' : 'Received'} →</span>
      </div>
      {types.map(t => {
        const g = given[t] ?? 0;
        const r = received[t] ?? 0;
        if (g === 0 && r === 0) return null;
        return (
          <div key={t} className="flex items-center gap-2">
            <div className="flex flex-1 justify-end">
              <div className="h-4 rounded-l" style={{ width: `${(g / max) * 100}%`, background: RELATION_COLORS[t], opacity: 0.85, minWidth: g > 0 ? 4 : 0 }} />
            </div>
            <div className="w-20 flex-shrink-0 text-center">
              <span className="text-[0.6875rem] font-medium text-stone-600 dark:text-stone-300">{labels[t]}</span>
              <span className="ml-1 text-[0.6875rem] tabular-nums text-stone-400">{g}/{r}</span>
            </div>
            <div className="flex flex-1">
              <div className="h-4 rounded-r" style={{ width: `${(r / max) * 100}%`, background: RELATION_COLORS[t], opacity: 0.45, minWidth: r > 0 ? 4 : 0 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Weekly grouped bar trend */
const WeeklyBars: React.FC<{ trend: StudentAnalytics['weeklyTrend']; zh: boolean; mode: 'notes' | 'buildons' | 'all' }> = ({ trend, zh, mode }) => {
  if (trend.length === 0) return <p className="py-6 text-center text-xs text-stone-400">{zh ? '本期暂无活动' : 'No activity this period'}</p>;
  const val = (w: StudentAnalytics['weeklyTrend'][number]) =>
    mode === 'notes' ? w.notes : mode === 'buildons' ? w.buildOnsGiven + w.buildOnsReceived : w.notes + w.buildOnsGiven + w.buildOnsReceived;
  const max = Math.max(...trend.map(val), 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height: 90 }}>
      {trend.map((w, i) => (
        <div key={i} className="group relative flex flex-1 flex-col items-center gap-1">
          {mode === 'buildons' ? (
            <div className="flex w-full max-w-[36px] flex-col justify-end" style={{ height: 72 }}>
              <div className="w-full rounded-t bg-emerald-500/75" style={{ height: Math.max((w.buildOnsGiven / max) * 72, w.buildOnsGiven > 0 ? 3 : 0) }} />
              <div className="w-full bg-blue-500/70" style={{ height: Math.max((w.buildOnsReceived / max) * 72, w.buildOnsReceived > 0 ? 3 : 0) }} />
            </div>
          ) : (
            <div
              className="w-full max-w-[36px] rounded-t bg-[#000080]/70 transition-colors group-hover:bg-[#000080] dark:bg-[#4169E1]/60 dark:group-hover:bg-[#4169E1]"
              style={{ height: Math.max((val(w) / max) * 72, 3) }}
            />
          )}
          <span className="text-[0.6875rem] text-stone-400">{w.week.slice(5)}</span>
          <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-stone-800 px-2 py-1 text-[0.6875rem] text-white group-hover:block">
            {zh ? `笔记 ${w.notes} · 发出 ${w.buildOnsGiven} · 收到 ${w.buildOnsReceived}` : `Notes ${w.notes} · Given ${w.buildOnsGiven} · Recv ${w.buildOnsReceived}`}
          </div>
        </div>
      ))}
    </div>
  );
};

/** Note type donut */
const NoteTypeDonut: React.FC<{ dist: Record<string, number>; zh: boolean }> = ({ dist, zh }) => {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return <p className="py-6 text-center text-xs text-stone-400">{zh ? '暂无数据' : 'No data'}</p>;
  const colors = ['#000080', '#7c3aed', '#059669', '#d97706', '#0891b2'];
  const typeLabel = (t: string) => {
    if (!zh) return t;
    return t === 'riseabove' ? '综合升华' : t === 'note' ? '普通笔记' : t === 'buildon' ? 'Build-on' : t;
  };
  const R2 = 42, CIRC = 2 * Math.PI * R2;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 110 110" className="h-28 w-28 flex-shrink-0">
        <circle cx="55" cy="55" r={R2} fill="none" strokeWidth="14" className="stroke-stone-100 dark:stroke-stone-800" />
        {entries.map(([t, v], i) => {
          const dash = (v / total) * CIRC;
          const el = (
            <circle
              key={t}
              cx="55" cy="55" r={R2} fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth="14"
              strokeDasharray={`${dash} ${CIRC - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 55 55)"
            />
          );
          offset += dash;
          return el;
        })}
        <text x="55" y="52" textAnchor="middle" fontSize="18" fontWeight="700" className="fill-stone-900 dark:fill-stone-100">{total}</text>
        <text x="55" y="66" textAnchor="middle" fontSize="8" className="fill-stone-400">{zh ? '篇笔记' : 'notes'}</text>
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5">
        {entries.map(([t, v], i) => (
          <div key={t} className="flex items-center gap-2 text-[0.6875rem]">
            <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: colors[i % colors.length] }} />
            <span className="truncate text-stone-600 dark:text-stone-300">{typeLabel(t)}</span>
            <span className="ml-auto tabular-nums font-semibold text-stone-900 dark:text-stone-100">{v}</span>
            <span className="w-8 text-right text-[0.6875rem] tabular-nums text-stone-400">{Math.round((v / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Ego network: me in the center, top collaborators around */
const EgoNetwork: React.FC<{ collabs: NonNullable<StudentAnalytics['topCollaborators']>; zh: boolean }> = ({ collabs, zh }) => {
  if (collabs.length === 0) return <p className="py-6 text-center text-xs text-stone-400">{zh ? '暂无协作互动' : 'No collaborations yet'}</p>;
  const C = 140, R = 92;
  const maxTotal = Math.max(...collabs.map(c => c.total), 1);
  const nodes = collabs.map((c, i) => {
    const a = (Math.PI * 2 * i) / collabs.length - Math.PI / 2;
    return { ...c, x: C + R * Math.cos(a), y: C + R * Math.sin(a), r: 14 + (c.total / maxTotal) * 10 };
  });
  return (
    <svg viewBox="0 0 280 280" className="mx-auto w-full max-w-[320px]">
      {nodes.map(n => (
        <line key={`l-${n.id}`} x1={C} y1={C} x2={n.x} y2={n.y}
          stroke="#000080" strokeOpacity={0.15 + (n.total / maxTotal) * 0.45}
          strokeWidth={1 + (n.total / maxTotal) * 4} className="dark:stroke-[#4169E1]" />
      ))}
      <circle cx={C} cy={C} r={22} fill="#000080" className="dark:fill-[#4169E1]" />
      <text x={C} y={C} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="11" fontWeight="700">{zh ? '我' : 'Me'}</text>
      {nodes.map(n => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={n.r} className="fill-white stroke-stone-300 dark:fill-stone-800 dark:stroke-stone-600" strokeWidth="1.5" />
          <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="600" className="fill-stone-700 dark:fill-stone-200">
            {(n.name || '?').slice(0, 2)}
          </text>
          <text x={n.x} y={n.y + n.r + 10} textAnchor="middle" fontSize="8" className="fill-stone-400">
            {n.total}{zh ? ' 次' : ''}
          </text>
        </g>
      ))}
    </svg>
  );
};

// ═══════════════════════════════════════════════════════════════
// Panel 1: 笔记动态 Note Activity
// ═══════════════════════════════════════════════════════════════

const TrendBadge: React.FC<{ change: number; zh: boolean }> = ({ change, zh }) => {
  if (change === 0) return <span className="text-[0.6875rem] text-stone-400">{zh ? '与上期持平' : 'No change'}</span>;
  const up = change > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[0.6875rem] font-medium ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
      <RemixIcon name={up ? 'arrow-up-s-line' : 'arrow-down-s-line'} size={12} />
      {zh ? `较上期 ${up ? '+' : ''}${change}%` : `${up ? '+' : ''}${change}% vs prev`}
    </span>
  );
};

const NOTE_TYPE_LABELS_ZH: Record<string, string> = { riseabove: '综合升华', note: '普通笔记', buildon: 'Build-on' };

export const NoteActivityPanel: React.FC<{ a: StudentAnalytics | null; loading: boolean; zh: boolean }> = ({ a, loading, zh }) => {
  if (loading) return <Skeleton />;
  if (!a || a.totalNotes === 0) return <EmptyHint zh={zh} />;

  const avgLen = a.noteActivity.length > 0
    ? Math.round(a.noteActivity.reduce((s, n) => s + n.contentLength, 0) / a.noteActivity.length)
    : 0;

  const statCards = [
    {
      icon: 'file-text-line',
      bg: 'bg-blue-500',
      label: zh ? '我的笔记' : 'My Notes',
      value: a.totalNotes,
      sub: a.percentile !== undefined
        ? (zh ? `超过 ${a.percentile}% 的社区同伴` : `Ahead of ${a.percentile}% of peers`)
        : undefined,
    },
    {
      icon: 'quill-pen-line',
      bg: 'bg-amber-500',
      label: zh ? '平均篇幅（字）' : 'Avg Length',
      value: avgLen,
      change: a.avgLengthChange,
    },
    {
      icon: 'sparkling-2-line',
      bg: 'bg-violet-500',
      label: zh ? 'AI 互动次数' : 'AI Interactions',
      value: a.aiInteractions,
      change: a.aiInteractionsChange,
    },
    {
      icon: 'global-line',
      bg: 'bg-emerald-500',
      label: zh ? '社区总笔记' : 'Community Notes',
      value: a.communityStats.totalNotes,
      sub: zh ? `共 ${a.communityStats.totalAuthors ?? '—'} 位作者` : `${a.communityStats.totalAuthors ?? '—'} authors`,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((s, i) => (
          <div key={i} className="flex items-center gap-3.5 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
            <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${s.bg}`}>
              <RemixIcon name={s.icon} size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[1.375rem] font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-100">{s.value}</div>
              <div className="truncate text-[0.6875rem] text-stone-500 dark:text-stone-400">{s.label}</div>
              {s.sub && <div className="text-[0.6875rem] text-stone-400">{s.sub}</div>}
              {s.change !== undefined && <TrendBadge change={s.change} zh={zh} />}
            </div>
          </div>
        ))}
      </div>

      {/* Heatmap + Cumulative */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={zh ? '学习热力图（近 12 周）' : 'Contribution Heatmap (12w)'} icon="calendar-2-line">
          <ContributionHeatmap dates={a.noteActivity.map(n => n.createdAt)} zh={zh} />
        </Card>
        <Card title={zh ? '知识积累曲线' : 'Knowledge Growth'} icon="line-chart-line">
          <CumulativeArea dates={a.noteActivity.map(n => n.createdAt)} zh={zh} />
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={zh ? '笔记类型构成' : 'Note Types'} icon="pie-chart-2-line">
          <NoteTypeDonut dist={a.noteTypeDist ?? {}} zh={zh} />
        </Card>
        <Card title={zh ? '每周发布趋势' : 'Weekly Trend'} icon="bar-chart-grouped-line">
          <WeeklyBars trend={a.weeklyTrend} zh={zh} mode="notes" />
        </Card>
        <Card title={zh ? '我的发布节奏' : 'My Posting Rhythm'} icon="time-line">
          <HourBars hours={a.hourDist ?? Array(24).fill(0)} zh={zh} />
        </Card>
      </div>

      {/* Recent notes */}
      <Card title={zh ? '最近笔记' : 'Recent Notes'} icon="history-line">
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          {[...a.noteActivity].reverse().slice(0, 8).map(n => (
            <div key={n.id} className="group flex items-center gap-3 px-1 py-2.5 transition-colors hover:bg-stone-50/50 dark:hover:bg-stone-900/50">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-stone-100 dark:bg-stone-800">
                <RemixIcon name="file-text-line" size={14} className="text-stone-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                  {n.title || (zh ? '(无标题)' : '(Untitled)')}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-stone-400">
                  <span>{new Date(n.createdAt).toLocaleDateString()}</span>
                  <span>·</span>
                  <span>{n.contentLength} {zh ? '字' : 'chars'}</span>
                </div>
              </div>
              <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${
                n.type === 'riseabove'
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                  : n.type === 'buildon'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
              }`}>
                {zh ? (NOTE_TYPE_LABELS_ZH[n.type] ?? n.type) : n.type}
              </span>
              <RemixIcon name="arrow-right-s-line" size={16} className="flex-shrink-0 text-stone-300 transition-colors group-hover:text-stone-500 dark:text-stone-600 dark:group-hover:text-stone-400" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Panel 2: 潜力想法 Promising Ideas
// ═══════════════════════════════════════════════════════════════

export const PromisingIdeasPanel: React.FC<{ zh: boolean }> = ({ zh }) => {
  const [data, setData] = useState<StudentPromisingIdeas | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    dashboardApi.studentPromisingIdeas()
      .then(res => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Skeleton />;
  if (!data || (data.promisingIdeas.length === 0 && data.similarPeers.length === 0 && data.riseAboveClusters.length === 0)) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center dark:border-stone-800 dark:bg-stone-950">
        <RemixIcon name="seedling-line" size={28} className="mx-auto text-stone-300 dark:text-stone-600" />
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          {zh ? '想法的潜力信号来自同伴的建构与 AI 的识别。继续发布和参与讨论，这里会亮起来。' : 'Potential signals come from peer build-ons and AI flags. Keep posting and this page will light up.'}
        </p>
      </div>
    );
  }

  const maxScore = Math.max(...data.promisingIdeas.map(p => p.score), 1);

  return (
    <div className="space-y-4">
      {/* Promising ideas */}
      {data.promisingIdeas.length > 0 && (
        <Card title={zh ? '你最有潜力的想法' : 'Your Most Promising Ideas'} icon="flashlight-line" accent="text-amber-500">
          <p className="mb-3 text-[0.6875rem] text-stone-400">
            {zh ? '综合同伴建构次数、AI「有潜力」标记与深度连接（证据/综合）计算' : 'Ranked by peer build-ons, AI promising flags, and deep (evidence/synthesize) connections'}
          </p>
          <div className="space-y-2.5">
            {data.promisingIdeas.map((p, i) => (
              <div key={p.id} className="rounded-xl border border-stone-100 p-3.5 transition-colors hover:border-amber-200 hover:bg-amber-50/30 dark:border-stone-800 dark:hover:border-amber-500/30 dark:hover:bg-amber-500/5">
                <div className="flex items-start gap-3">
                  <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold ${i === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug text-stone-900 dark:text-stone-100">{p.title}</div>
                    <div className="mt-1.5 flex h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                      <div className="rounded-full bg-gradient-to-r from-amber-400 to-amber-500" style={{ width: `${(p.score / maxScore) * 100}%` }} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2 text-[0.6875rem] text-stone-400">
                      {p.buildOns > 0 && <span className="flex items-center gap-0.5"><RemixIcon name="git-merge-line" size={10} className="text-emerald-500" />{zh ? `被建构 ${p.buildOns} 次` : `${p.buildOns} build-ons`}</span>}
                      {p.promisingFlags > 0 && <span className="flex items-center gap-0.5"><RemixIcon name="sparkling-2-line" size={10} className="text-amber-500" />{zh ? `AI 认为有潜力` : 'AI-flagged promising'}</span>}
                      {p.deepRelations > 0 && <span className="flex items-center gap-0.5"><RemixIcon name="attachment-2" size={10} className="text-violet-500" />{zh ? `深度连接 ${p.deepRelations}` : `${p.deepRelations} deep links`}</span>}
                      <span className="ml-auto">{new Date(p.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Similar peers */}
        {data.similarPeers.length > 0 && (
          <Card title={zh ? '谁和你想到一起了' : 'Thinking Along With You'} icon="user-shared-line" accent="text-blue-500">
            <p className="mb-3 text-[0.6875rem] text-stone-400">
              {zh ? '这些同伴的笔记和你讨论着相同的概念——去看看，也许能碰撞出新的想法' : 'These peer notes share concepts with yours — go take a look'}
            </p>
            <div className="space-y-2.5">
              {data.similarPeers.map((s, i) => (
                <div key={i} className="rounded-xl bg-stone-50 p-3.5 dark:bg-stone-900">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-[0.6875rem] font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                      {(s.peerName || '?')[0]}
                    </div>
                    <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{s.peerName || (zh ? '同学' : 'Peer')}</span>
                    {s.alreadyInteracted && (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[0.6875rem] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        {zh ? '互动过' : 'Interacted'}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-[0.75rem] leading-relaxed text-stone-600 dark:text-stone-300">
                    <span className="text-stone-400">{zh ? 'TA 的笔记：' : 'Their note: '}</span>{s.peerNoteTitle}
                  </div>
                  <div className="mt-0.5 text-[0.6875rem] text-stone-400">
                    {zh ? '与你的《' : 'Shares concepts with your "'}{s.myNoteTitle}{zh ? '》相关' : '"'}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.sharedConcepts.map(c => (
                      <span key={c} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[0.6875rem] font-medium text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300">{c}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Rise-above clusters */}
        {data.riseAboveClusters.length > 0 && (
          <Card title={zh ? 'Rise-above 机会' : 'Rise-above Opportunities'} icon="mind-map" accent="text-violet-500">
            <p className="mb-3 text-[0.6875rem] text-stone-400">
              {zh ? '你的这些笔记围绕相同主题——试着把它们综合成一个更高层次的观点' : 'These notes of yours share themes — try synthesizing them into a higher-level idea'}
            </p>
            <div className="space-y-2.5">
              {data.riseAboveClusters.map((c, i) => (
                <div key={i} className="rounded-xl border border-violet-100 bg-violet-50/40 p-3.5 dark:border-violet-500/20 dark:bg-violet-500/5">
                  <div className="flex flex-wrap gap-1.5">
                    {c.themes.map(t => (
                      <span key={t} className="rounded-full bg-violet-100 px-2 py-0.5 text-[0.6875rem] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">{t}</span>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1">
                    {c.notes.map(n => (
                      <div key={n.id} className="flex items-center gap-2 text-[0.75rem] text-stone-600 dark:text-stone-300">
                        <RemixIcon name="file-text-line" size={12} className="flex-shrink-0 text-stone-400" />
                        <span className="truncate">{n.title}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-[0.6875rem] font-medium text-violet-600 dark:text-violet-400">
                    <RemixIcon name="lightbulb-flash-line" size={12} />
                    {zh ? `${c.notes.length} 篇笔记可以综合升华` : `${c.notes.length} notes ready to rise above`}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3 dark:border-stone-800 dark:bg-stone-900/40">
        <RemixIcon name="book-2-line" size={13} className="mt-0.5 flex-shrink-0 text-stone-400" />
        <p className="text-[0.6875rem] leading-relaxed text-stone-500 dark:text-stone-400">
          {zh
            ? '知识建构理论认为，聚焦「最有潜力的想法」并持续改进，是社区知识前进的关键（Scardamalia & Bereiter）。这里的信号帮你决定：哪个想法值得深耕、和谁一起、往哪个方向综合。'
            : 'Knowledge Building theory holds that focusing on the most promising ideas and improving them continuously drives community knowledge forward (Scardamalia & Bereiter). These signals help you decide what to deepen, with whom, and where to synthesize.'}
        </p>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Panel 3: 思维发展 Thinking Development
// ═══════════════════════════════════════════════════════════════

export const ThinkingDevPanel: React.FC<{ a: StudentAnalytics | null; loading: boolean; zh: boolean }> = ({ a, loading, zh }) => {
  if (loading) return <Skeleton />;
  if (!a || a.totalNotes === 0) return <EmptyHint zh={zh} />;

  const g = a.relationTypesGiven ?? {};
  const inquiry = (g['question'] ?? 0) + (g['challenge'] ?? 0);
  const synth = (g['synthesize'] ?? 0) + (a.noteTypeDist?.['riseabove'] ?? 0);
  const norm = (v: number, cap: number) => Math.min(v / cap, 1);
  const dims = [
    { label: zh ? '表达' : 'Express', value: norm(a.totalNotes, 20) },
    { label: zh ? '深化' : 'Deepen', value: norm(a.buildOns.given, 15) },
    { label: zh ? '影响' : 'Impact', value: norm(a.buildOns.received, 15) },
    { label: zh ? '探究' : 'Inquire', value: norm(inquiry, 8) },
    { label: zh ? '综合' : 'Synthesize', value: norm(synth, 5) },
  ];

  const impact = a.ideaImpact ?? { maxChain: 0, totalDescendants: 0 };

  // Achievements — unlocked vs in-progress
  const streakWeeks = (() => {
    let max = 0, cur = 0;
    for (const w of a.weeklyTrend) {
      if (w.notes > 0) { cur++; max = Math.max(max, cur); } else cur = 0;
    }
    return max;
  })();
  const achievements = [
    { icon: 'quill-pen-line', zh: '第一篇笔记', en: 'First note', done: a.totalNotes >= 1, progress: Math.min(a.totalNotes, 1), goal: 1 },
    { icon: 'booklet-line', zh: '笔记达人 ×10', en: '10 notes', done: a.totalNotes >= 10, progress: Math.min(a.totalNotes, 10), goal: 10 },
    { icon: 'git-merge-line', zh: '首次被建构', en: 'First build-on', done: a.buildOns.received >= 1, progress: Math.min(a.buildOns.received, 1), goal: 1 },
    { icon: 'magnet-line', zh: '想法磁铁 ×5', en: 'Idea magnet ×5', done: a.buildOns.received >= 5, progress: Math.min(a.buildOns.received, 5), goal: 5 },
    { icon: 'question-answer-line', zh: '探究者 ×3', en: 'Inquirer ×3', done: inquiry >= 3, progress: Math.min(inquiry, 3), goal: 3 },
    { icon: 'mind-map', zh: '综合升华者', en: 'Rise-above author', done: (a.noteTypeDist?.['riseabove'] ?? 0) >= 1, progress: Math.min(a.noteTypeDist?.['riseabove'] ?? 0, 1), goal: 1 },
    { icon: 'route-line', zh: '深链引发者', en: 'Deep chain ×3', done: impact.maxChain >= 3, progress: Math.min(impact.maxChain, 3), goal: 3 },
    { icon: 'fire-line', zh: '连续 3 周活跃', en: '3-week streak', done: streakWeeks >= 3, progress: Math.min(streakWeeks, 3), goal: 3 },
  ];

  const suggestions: { icon: string; text: string }[] = [];
  if (inquiry === 0) suggestions.push({ icon: 'question-line', text: zh ? '尝试用「提问」或「质疑」连接同伴的笔记，训练批判性思维' : 'Try connecting to peers with Question or Challenge relations to practice critical thinking' });
  if (synth === 0 && a.totalNotes >= 5) suggestions.push({ icon: 'mind-map', text: zh ? '你已有不少笔记，试试创建一篇 Rise-above 综合多个观点' : 'You have several notes — try a Rise-above to synthesize multiple ideas' });
  if (a.buildOns.given === 0) suggestions.push({ icon: 'git-merge-line', text: zh ? '阅读同伴的笔记并进行 Build-on 建构，你的想法会在对话中成长' : 'Read peer notes and build on them — ideas grow through dialogue' });
  if (impact.maxChain >= 2) suggestions.push({ icon: 'flashlight-line', text: zh ? `你的想法引发了 ${impact.maxChain} 层持续讨论，继续保持！` : `Your ideas sparked ${impact.maxChain}-layer discussions — keep it up!` });
  for (const item of a.actionItems) {
    if (item.type === 'new_build_ons') suggestions.push({ icon: 'chat-heart-line', text: zh ? `最近有 ${item.count} 位同伴建构了你的想法，去看看他们说了什么` : `${item.count} peers recently built on your ideas — go see what they said` });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card title={zh ? '思维画像' : 'Thinking Profile'} icon="radar-line">
          <ThinkingRadar dims={dims} />
          <p className="mt-1 text-center text-[0.6875rem] text-stone-400">
            {zh ? '五个维度基于你的笔记与互动行为自动计算' : 'Five dimensions computed from your notes and interactions'}
          </p>
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon="route-line" iconBg="bg-violet-50 dark:bg-violet-900/20" iconColor="text-violet-600 dark:text-violet-400" label={zh ? '最长影响链' : 'Longest impact chain'} value={impact.maxChain} sub={zh ? '你的想法被逐层深化的层数' : 'Layers of discussion your ideas sparked'} />
            <StatCard icon="broadcast-line" iconBg="bg-blue-50 dark:bg-blue-900/20" iconColor="text-blue-600 dark:text-blue-400" label={zh ? '引发的后续讨论' : 'Descendant notes'} value={impact.totalDescendants} sub={zh ? '从你的笔记生长出的笔记总数' : 'Notes that grew from yours'} />
          </div>
          <Card title={zh ? '综合活跃度趋势' : 'Overall Activity'} icon="pulse-line">
            <WeeklyBars trend={a.weeklyTrend} zh={zh} mode="all" />
          </Card>
        </div>
      </div>

      {/* Achievements */}
      <Card title={zh ? '成长里程碑' : 'Milestones'} icon="medal-line" accent="text-amber-500">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {achievements.map((ach, i) => (
            <div
              key={i}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${ach.done
                ? 'border-amber-200 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-500/10'
                : 'border-stone-100 bg-stone-50/50 dark:border-stone-800 dark:bg-stone-900/50'}`}
            >
              <RemixIcon name={ach.icon} size={17} className={ach.done ? 'text-amber-500' : 'text-stone-300 dark:text-stone-600'} />
              <div className="min-w-0">
                <div className={`truncate text-[0.6875rem] font-medium ${ach.done ? 'text-stone-900 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
                  {zh ? ach.zh : ach.en}
                </div>
                {!ach.done && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                    <div className="h-full rounded-full bg-stone-400 dark:bg-stone-500" style={{ width: `${(ach.progress / ach.goal) * 100}%` }} />
                  </div>
                )}
              </div>
              {ach.done && <RemixIcon name="checkbox-circle-fill" size={13} className="ml-auto flex-shrink-0 text-amber-500" />}
            </div>
          ))}
        </div>
      </Card>

      {suggestions.length > 0 && (
        <Card title={zh ? '成长建议' : 'Growth Suggestions'} icon="seedling-line">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {suggestions.slice(0, 4).map((s, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-xl bg-stone-50 px-3.5 py-3 dark:bg-stone-900">
                <RemixIcon name={s.icon} size={15} className="mt-0.5 flex-shrink-0 text-[#000080] dark:text-[#93AAFD]" />
                <span className="text-[0.75rem] leading-relaxed text-stone-700 dark:text-stone-300">{s.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Panel 4: 协作网络 Collaboration Network (absorbs Build-on details)
// ═══════════════════════════════════════════════════════════════

export const CollabNetworkPanel: React.FC<{ a: StudentAnalytics | null; loading: boolean; zh: boolean }> = ({ a, loading, zh }) => {
  if (loading) return <Skeleton />;
  if (!a) return <EmptyHint zh={zh} />;

  const myShare = a.communityStats.totalNotes > 0 ? Math.round((a.totalNotes / a.communityStats.totalNotes) * 100) : 0;
  const collabs = a.topCollaborators ?? [];
  const maxTotal = Math.max(...collabs.map(c => c.total), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="team-line" iconBg="bg-amber-50 dark:bg-amber-900/20" iconColor="text-amber-600 dark:text-amber-400" label={zh ? '协作伙伴' : 'Collaborators'} value={a.communityStats.uniqueCollaborators} />
        <StatCard icon="arrow-right-up-line" iconBg="bg-emerald-50 dark:bg-emerald-900/20" iconColor="text-emerald-600 dark:text-emerald-400" label={zh ? '我建构了他人' : 'I built on others'} value={a.buildOns.given} />
        <StatCard icon="arrow-left-down-line" iconBg="bg-blue-50 dark:bg-blue-900/20" iconColor="text-blue-600 dark:text-blue-400" label={zh ? '他人建构了我' : 'Others built on me'} value={a.buildOns.received} />
        <StatCard icon="donut-chart-line" iconBg="bg-violet-50 dark:bg-violet-900/20" iconColor="text-violet-600 dark:text-violet-400" label={zh ? '我的贡献占比' : 'My share'} value={`${myShare}%`} sub={zh ? `社区共 ${a.communityStats.totalAuthors ?? '—'} 位作者` : `${a.communityStats.totalAuthors ?? '—'} authors`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={zh ? '我的协作圈' : 'My Collaboration Circle'} icon="planet-line">
          <EgoNetwork collabs={collabs} zh={zh} />
          {collabs.length > 0 && (
            <p className="mt-1 text-center text-[0.6875rem] text-stone-400">
              {zh ? '线越粗 = 互动越多 · 圆越大 = 关系越紧密' : 'Thicker line = more interactions'}
            </p>
          )}
        </Card>

        <Card title={zh ? '互动类型对比（发出 vs 收到）' : 'Interaction Types (Given vs Received)'} icon="swap-line">
          <RelationTypeBars given={a.relationTypesGiven ?? {}} received={a.relationTypesReceived ?? {}} zh={zh} />
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-stone-400">
            {a.buildOns.given > a.buildOns.received * 2 && a.buildOns.given >= 4
              ? (zh ? '你更多在建构他人的想法 —— 很好的社区贡献者！也试着发布能引发讨论的原创观点。' : 'You give more than you receive — try posting ideas that invite discussion too.')
              : a.buildOns.received > a.buildOns.given * 2 && a.buildOns.received >= 4
                ? (zh ? '你的想法很受欢迎！也去看看同伴的笔记，建构他们的观点。' : 'Your ideas attract attention! Consider building on peers too.')
                : (zh ? '你的互动收支比较均衡，这是健康的协作状态。' : 'Your give/receive balance looks healthy.')}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={zh ? '协作伙伴排行' : 'Top Collaborators'} icon="user-heart-line">
          {collabs.length === 0 ? (
            <p className="py-6 text-center text-xs text-stone-400">{zh ? '尚无协作互动，去知识社区建构同伴的观点' : 'No collaborations yet — go build on peer ideas'}</p>
          ) : (
            <div className="space-y-2.5">
              {collabs.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold ${i === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}>
                    {(c.name || '?')[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{c.name || (zh ? '同学' : 'Peer')}</span>
                      <span className="flex-shrink-0 text-[0.6875rem] tabular-nums text-stone-400">
                        {zh ? `互动 ${c.total} 次` : `${c.total} interactions`}
                      </span>
                    </div>
                    <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                      <div className="bg-emerald-500/80" style={{ width: `${(c.given / maxTotal) * 100}%` }} />
                      <div className="bg-blue-500/70" style={{ width: `${(c.received / maxTotal) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-4 pt-1 text-[0.6875rem] text-stone-400">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/80" />{zh ? '我建构了 TA' : 'I built on them'}</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-blue-500/70" />{zh ? 'TA 建构了我' : 'They built on me'}</span>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {a.recentBuildOns.length > 0 && (
            <Card title={zh ? '最近有人建构了你的想法' : 'Recent build-ons on your ideas'} icon="chat-smile-2-line">
              <div className="space-y-1.5">
                {a.recentBuildOns.map((b, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-900">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[0.6875rem] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                      {(b.creatorName || '?')[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{b.creatorName || (zh ? '同学' : 'Peer')}</span>
                      <span className="ml-2 text-[0.6875rem] text-stone-400">{new Date(b.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {a.unbuiltNotes.length > 0 && (
            <Card title={zh ? '这些笔记还没有人 Build-on' : 'Notes awaiting build-on'} icon="lightbulb-line" accent="text-amber-500">
              <p className="mb-2 text-[0.6875rem] text-stone-400">{zh ? '可以在社区中分享或向同伴提问，吸引更多讨论' : 'Share them or ask peers questions to invite discussion'}</p>
              <div className="space-y-1.5">
                {a.unbuiltNotes.map(n => (
                  <div key={n.id} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-900">
                    <RemixIcon name="file-text-line" size={14} className="flex-shrink-0 text-stone-400" />
                    <span className="min-w-0 truncate">{n.title || (zh ? '(无标题)' : '(Untitled)')}</span>
                    <span className="ml-auto flex-shrink-0 text-[0.6875rem] text-stone-400">{new Date(n.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
