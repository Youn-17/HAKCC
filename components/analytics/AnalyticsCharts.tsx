import React, { useMemo, useState } from 'react';
import { MORANDI, BRAND_NAVY } from '../morandiPalette';
import type { SpaceWordCloud } from '../../services/apiClient';
import { bucketTimeline, circleLayout, dayLabel, labelWidth, linkPath, networkViewBox, nodeLabel, sinceLabel } from './analyticsModel';

/**
 * 讨论分析里的几张图（2026-10-09）。颜色只用平台色板：笔记导航蓝、回应雾青、需要留意暖赭。
 * 都是自绘 SVG / div，viewBox 按容器缩放，深浅色跟着页面走。
 * 导航蓝在深色底上看不见，笔记色和圆点底色走 CSS 变量，由 SpaceAnalytics 外层按深浅色设置（ANALYTICS_THEME）。
 */

type Lang = 'zh' | 'en';

const NOTE_COLOR = `var(--analytics-note, ${BRAND_NAVY})`;
const SURFACE = 'var(--analytics-surface, #ffffff)';
const BUILD_ON_COLOR = MORANDI.sage;
const ATTENTION = MORANDI.ochre;
/** 加在分析面板最外层：深色时笔记换成低饱和的浅蓝，圆点描边换成卡片底色 */
export const ANALYTICS_THEME = '[--analytics-note:#000080] [--analytics-surface:#ffffff] dark:[--analytics-note:#8E9CD8] dark:[--analytics-surface:#111827]';

export const Card: React.FC<{ title: string; hint?: string; actions?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, hint, actions, className = '', children }) => (
  <section className={`flex min-w-0 flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,128,0.04)] dark:border-gray-800 dark:bg-gray-900 ${className}`}>
    <header className="mb-4 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-[0.9375rem] font-bold tracking-tight text-zinc-900 dark:text-gray-100">{title}</h3>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-gray-400">{hint}</p>}
      </div>
      {actions}
    </header>
    {children}
  </section>
);

export const Kpi: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: 'default' | 'attention'; className?: string }> = ({ label, value, hint, tone = 'default', className = '' }) => (
  <div className={`rounded-2xl border p-4 transition-colors ${className} ${tone === 'attention'
    ? 'border-[#C9A96E]/40 bg-[#C9A96E]/[0.07] dark:border-[#C9A96E]/30 dark:bg-[#C9A96E]/10'
    : 'border-zinc-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`}
  >
    <div className="text-xs font-medium text-zinc-500 dark:text-gray-400">{label}</div>
    <div className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-zinc-900 dark:text-gray-100">{value}</div>
    {hint && <div className="mt-1 text-[0.6875rem] leading-relaxed text-zinc-500 dark:text-gray-400">{hint}</div>}
  </div>
);

export const Legend: React.FC<{ items: Array<{ label: string; color: string }> }> = ({ items }) => (
  <div className="flex flex-wrap items-center gap-3 text-[0.6875rem] text-zinc-500 dark:text-gray-400">
    {items.map(item => (
      <span key={item.label} className="inline-flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden><rect width="10" height="10" rx="3" style={{ fill: item.color }} /></svg>
        {item.label}
      </span>
    ))}
  </div>
);

/** 每天（太长时每周）的笔记和回应，叠在一根柱子上 */
export const TrendChart: React.FC<{ data: Array<{ day: string; notes: number; buildOns: number }>; lang: Lang; height?: number }> = ({ data, lang, height = 190 }) => {
  const bars = useMemo(() => bucketTimeline(data, ['notes', 'buildOns']), [data]);
  const weekly = bars.length < data.length;
  const W = 720;
  const pad = { left: 30, right: 8, top: 10, bottom: 26 };
  const ch = height - pad.top - pad.bottom;
  const max = Math.max(1, ...bars.map(b => b.notes + b.buildOns));
  const step = (W - pad.left - pad.right) / Math.max(bars.length, 1);
  const barW = Math.max(2, Math.min(22, step * 0.62));
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const labelEvery = Math.ceil(bars.length / 8);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={lang === 'zh' ? '讨论走势' : 'Discussion over time'}>
      {ticks.map(t => {
        const y = pad.top + ch - (t / max) * ch;
        return (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="currentColor" className="text-zinc-200 dark:text-gray-800" strokeWidth={1} />
            <text x={pad.left - 6} y={y + 3} textAnchor="end" className="fill-zinc-400 text-[0.625rem] tabular-nums dark:fill-gray-500">{t}</text>
          </g>
        );
      })}
      {bars.map((bar, i) => {
        const x = pad.left + i * step + (step - barW) / 2;
        const hn = (bar.notes / max) * ch;
        const hb = (bar.buildOns / max) * ch;
        const base = pad.top + ch;
        const label = weekly ? `${dayLabel(bar.day, lang)}${lang === 'zh' ? ' 那周' : ' week'}` : dayLabel(bar.day, lang);
        return (
          <g key={bar.day}>
            <title>{`${label}：${lang === 'zh' ? '笔记' : 'notes'} ${bar.notes}，${lang === 'zh' ? '回应' : 'build-ons'} ${bar.buildOns}`}</title>
            <rect x={x} width={barW} y={base - hn} height={Math.max(0, hn)} rx={Math.min(3, barW / 3)} style={{ fill: NOTE_COLOR }} opacity={0.85} />
            <rect x={x} width={barW} y={base - hn - hb} height={Math.max(0, hb)} rx={Math.min(3, barW / 3)} fill={BUILD_ON_COLOR} />
            {i % labelEvery === 0 && (
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="fill-zinc-400 text-[0.625rem] dark:fill-gray-500">{dayLabel(bar.day, lang)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

/** 横向条：支架组、回应方式、回应了谁 */
export const BarList: React.FC<{
  items: Array<{ key: string; label: string; count: number; color?: string; onClick?: () => void }>;
  empty: string;
  max?: number;
}> = ({ items, empty, max }) => {
  if (items.length === 0) return <p className="py-6 text-center text-xs text-zinc-400 dark:text-gray-500">{empty}</p>;
  const top = max ?? Math.max(1, ...items.map(i => i.count));
  return (
    <ul className="flex flex-col gap-2">
      {items.map(item => {
        const inner = (
          <>
            <span className="w-28 shrink-0 truncate text-left text-xs text-zinc-700 dark:text-gray-300 sm:w-36" title={item.label}>{item.label}</span>
            <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-gray-800">
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(4, (item.count / top) * 100)}%`, backgroundColor: item.color ?? NOTE_COLOR }} />
            </span>
            <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-700 dark:text-gray-300">{item.count}</span>
          </>
        );
        return (
          <li key={item.key}>
            {item.onClick ? (
              <button type="button" onClick={item.onClick} className="flex w-full items-center gap-3 rounded-lg px-1 py-0.5 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 dark:hover:bg-gray-800/60">{inner}</button>
            ) : (
              <div className="flex items-center gap-3 px-1 py-0.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

/** 长列表先列前几条，其余点开再看：分析页本身就在滚，里面再套一层滚动条不好用 */
export function useShowMore<T>(items: T[], limit: number) {
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, items.length - limit);
  return { shown: expanded || hidden <= 2 ? items : items.slice(0, limit), hidden: expanded || hidden <= 2 ? 0 : hidden, expanded, toggle: () => setExpanded(v => !v), collapsible: hidden > 2 };
}

export const ShowMoreButton: React.FC<{ hidden: number; expanded: boolean; onToggle: () => void; lang: Lang }> = ({ hidden, expanded, onToggle, lang }) => (
  <button type="button" onClick={onToggle}
    className="mt-2 inline-flex h-9 items-center gap-1 self-start rounded-lg px-2 text-xs font-medium text-[#000080] transition-colors hover:bg-[#000080]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 dark:text-blue-300 dark:hover:bg-blue-950/40">
    {expanded ? (lang === 'zh' ? '收起' : 'Show less') : (lang === 'zh' ? `还有 ${hidden} 条，展开` : `Show ${hidden} more`)}
  </button>
);

export function ExpandableList<T>({ items, limit, lang, keyOf, render }: {
  items: T[];
  limit: number;
  lang: Lang;
  keyOf: (item: T) => string;
  render: (item: T) => React.ReactNode;
}) {
  const more = useShowMore(items, limit);
  return (
    <div className="flex flex-col">
      <ul className="-mx-1 flex flex-col">
        {more.shown.map(item => <li key={keyOf(item)}>{render(item)}</li>)}
      </ul>
      {more.collapsible && <ShowMoreButton hidden={more.hidden} expanded={more.expanded} onToggle={more.toggle} lang={lang} />}
    </div>
  );
}

/** 每个人的参与：笔记、回应别人两根条，被回应几次、最近一次发言；七天没发言的标出来 */
export const ParticipationRows: React.FC<{
  rows: Array<{ userId: string; notes: number; buildOnsGiven: number; buildOnsReceived: number; lastAt: string | null; quiet: boolean; aiFeedback: { received: number; adopted: number } }>;
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
  lang: Lang;
}> = ({ rows, nameOf, onSelect, lang }) => {
  const zh = lang === 'zh';
  const max = Math.max(1, ...rows.map(r => Math.max(r.notes, r.buildOnsGiven)));
  const more = useShowMore(rows, 10);
  if (rows.length === 0) return <p className="py-8 text-center text-xs text-zinc-400">{zh ? '这个空间还没有学生' : 'No students in this space yet'}</p>;
  return (
    <div className="flex flex-col">
      <ul className="-mx-1 flex flex-col">
        {more.shown.map(row => (
          <li key={row.userId}>
            <button
              type="button"
              onClick={() => onSelect(row.userId)}
              className="group grid w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 dark:hover:bg-gray-800/60 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto]"
              title={zh ? '看这个人的详情' : 'Open this student'}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-zinc-800 dark:text-gray-200">{nameOf(row.userId)}</span>
                <span className={`text-[0.6875rem] ${row.quiet ? 'font-medium text-[#8a6d38] dark:text-[#dcc394]' : 'text-zinc-400 dark:text-gray-500'}`}>
                  {row.quiet && row.lastAt ? (zh ? `${sinceLabel(row.lastAt, lang)}，7 天没发言` : `${sinceLabel(row.lastAt, lang)}, quiet 7 days`) : sinceLabel(row.lastAt, lang)}
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-gray-800">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(row.notes / max) * 100}%`, backgroundColor: NOTE_COLOR, opacity: 0.85 }} />
                  </span>
                  <span className="w-6 text-right text-[0.6875rem] tabular-nums text-zinc-600 dark:text-gray-300">{row.notes}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-gray-800">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(row.buildOnsGiven / max) * 100}%`, backgroundColor: BUILD_ON_COLOR }} />
                  </span>
                  <span className="w-6 text-right text-[0.6875rem] tabular-nums text-zinc-600 dark:text-gray-300">{row.buildOnsGiven}</span>
                </span>
              </span>
              <span className="flex w-14 flex-col items-end text-[0.6875rem] text-zinc-500 dark:text-gray-400">
                <span title={zh ? '被别人回应的次数' : 'Times others built on them'}><span className="font-semibold tabular-nums text-zinc-700 dark:text-gray-200">{row.buildOnsReceived}</span>{zh ? ' 被回应' : ' recv'}</span>
                {row.aiFeedback.received > 0 && (
                  <span title={zh ? 'AI 反馈：采纳 / 收到' : 'AI feedback: adopted / received'}>AI {row.aiFeedback.adopted}/{row.aiFeedback.received}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {more.collapsible && <ShowMoreButton hidden={more.hidden} expanded={more.expanded} onToggle={more.toggle} lang={lang} />}
    </div>
  );
};

/** 谁在回应谁：所有人排成一圈，线的粗细是回应次数，箭头指向被回应的人 */
export const InteractionNetwork: React.FC<{
  nodes: Array<{ id: string; notes: number; buildOns: number }>;
  links: Array<{ from: string; to: string; count: number }>;
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
  lang: Lang;
}> = ({ nodes, links, nameOf, onSelect, lang }) => {
  const [hover, setHover] = useState<string | null>(null);
  const size = 420;
  const fontSize = 13;
  const placed = useMemo(() => circleLayout(nodes.map(n => ({ id: n.id, weight: n.notes + n.buildOns })), size), [nodes]);
  const labels = useMemo(() => new Map(placed.map(p => [p.id, { ...nodeLabel(p, size, fontSize), width: labelWidth(nameOf(p.id), fontSize) }])), [placed, nameOf]);
  const viewBox = useMemo(() => networkViewBox(placed, [...labels.values()], size, fontSize), [placed, labels]);
  const at = new Map(placed.map(p => [p.id, p]));
  const maxCount = Math.max(1, ...links.map(l => l.count));
  const zh = lang === 'zh';
  if (nodes.length === 0) return <p className="py-8 text-center text-xs text-zinc-400">{zh ? '还没有学生' : 'No students yet'}</p>;
  return (
    <svg viewBox={viewBox} className="mx-auto h-auto w-full max-w-[28rem]" role="img" aria-label={zh ? '同学之间的回应关系' : 'Who builds on whom'}>
      <defs>
        <marker id="analytics-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9 z" fill={BUILD_ON_COLOR} />
        </marker>
      </defs>
      {links.map(link => {
        const a = at.get(link.from);
        const b = at.get(link.to);
        if (!a || !b) return null;
        const active = !hover || hover === link.from || hover === link.to;
        return (
          <path
            key={`${link.from}-${link.to}`}
            d={linkPath(a, b, size)}
            fill="none"
            stroke={BUILD_ON_COLOR}
            strokeWidth={1 + 3.5 * (link.count / maxCount)}
            strokeLinecap="round"
            markerEnd="url(#analytics-arrow)"
            opacity={active ? 0.85 : 0.12}
          >
            <title>{zh ? `${nameOf(link.from)} 回应了 ${nameOf(link.to)} ${link.count} 次` : `${nameOf(link.from)} built on ${nameOf(link.to)} ${link.count}×`}</title>
          </path>
        );
      })}
      {placed.map(p => {
        const node = nodes.find(n => n.id === p.id)!;
        const isolated = !links.some(l => l.from === p.id || l.to === p.id);
        const dim = hover && hover !== p.id && !links.some(l => (l.from === hover && l.to === p.id) || (l.to === hover && l.from === p.id));
        const label = labels.get(p.id)!;
        return (
          <g
            key={p.id}
            role="button"
            tabIndex={0}
            aria-label={nameOf(p.id)}
            className="cursor-pointer outline-none"
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p.id)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(p.id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); } }}
            opacity={dim ? 0.3 : 1}
          >
            <title>{zh ? `${nameOf(p.id)}：笔记 ${node.notes}，回应往来 ${node.buildOns}` : `${nameOf(p.id)}: ${node.notes} notes, ${node.buildOns} build-ons`}</title>
            <circle cx={p.x} cy={p.y} r={p.r} fillOpacity={isolated ? 1 : 0.88} strokeWidth={isolated ? 2 : 1.5}
              style={{ fill: isolated ? SURFACE : NOTE_COLOR, stroke: isolated ? ATTENTION : SURFACE }} />
            <text x={label.x} y={label.y} textAnchor={label.anchor} dominantBaseline="middle" fontSize={fontSize}
              className="fill-zinc-600 font-medium dark:fill-gray-300">{nameOf(p.id)}</text>
          </g>
        );
      })}
    </svg>
  );
};

const CLOUD_FONTS = "'Noto Sans CJK SC', 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
/** 词的颜色：越重要越深；都是色板里的中间色，深浅底上都读得清 */
const CLOUD_TONES = ['fill-[#000080] dark:fill-[#8E9CD8]', 'fill-[#5d8a7f] dark:fill-[#9cc5ba]', 'fill-[#5f7f99] dark:fill-[#a9c3d6]', 'fill-[#9a7a3f] dark:fill-[#dcc394]', 'fill-[#9a5c5c] dark:fill-[#e0a5a5]'];

/**
 * 词云：位置、字号、每个词的宽高由服务端的 Python（wordcloud）算好，这里画成 SVG。
 * 用 textLength 把每个词卡在算好的宽度里，浏览器字体和服务器字体不一样也不会挤到一起。
 */
export const WordCloud: React.FC<{
  data: SpaceWordCloud;
  selected: string | null;
  onPick: (word: string | null) => void;
  lang: Lang;
}> = ({ data, selected, onPick, lang }) => {
  const zh = lang === 'zh';
  if (!data.available) {
    return <p className="py-10 text-center text-xs text-zinc-500">{zh ? '词云暂时生成不了（服务器上的分词程序没有响应），其余分析不受影响。' : 'The word cloud is unavailable right now; the rest of the analysis is unaffected.'}</p>;
  }
  const cloud = data.cloud;
  if (!cloud || cloud.items.length === 0) {
    return <p className="py-10 text-center text-xs text-zinc-400">{zh ? '学生写的内容还太少，凑不成词云' : 'Not enough student writing for a word cloud yet'}</p>;
  }
  const countOf = new Map(data.terms.map(t => [t.word, t]));
  return (
    <svg viewBox={`0 0 ${cloud.width} ${cloud.height}`} className="h-auto w-full" role="img" aria-label={zh ? '学生笔记里的高频词' : 'Frequent words in student notes'}>
      {cloud.items.map((item, i) => {
        const term = countOf.get(item.word);
        const isSelected = selected === item.word;
        const tone = CLOUD_TONES[item.weight >= 0.55 ? 0 : (i % (CLOUD_TONES.length - 1)) + 1];
        return (
          <text
            key={item.word}
            x={item.x}
            y={item.y + item.ascent}
            fontSize={item.size}
            textLength={item.w}
            lengthAdjust="spacingAndGlyphs"
            fontFamily={CLOUD_FONTS}
            fontWeight={item.weight >= 0.4 ? 700 : 500}
            role="button"
            tabIndex={0}
            className={`cursor-pointer outline-none transition-opacity ${tone} ${selected && !isSelected ? 'opacity-30' : 'opacity-100'} hover:opacity-80 focus-visible:underline`}
            onClick={() => onPick(isSelected ? null : item.word)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(isSelected ? null : item.word); } }}
          >
            <title>{term ? (zh ? `${item.word}：出现 ${term.count} 次，在 ${term.notes} 篇笔记里` : `${item.word}: ${term.count} times in ${term.notes} notes`) : item.word}</title>
            {item.word}
          </text>
        );
      })}
    </svg>
  );
};

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-2xl bg-zinc-200/70 dark:bg-gray-800/70 ${className}`} />
);

export { NOTE_COLOR, BUILD_ON_COLOR, ATTENTION };
