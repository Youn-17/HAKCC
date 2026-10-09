import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { type Language, type Course } from '../../types';
import { research as researchApi, type ResearchSummary, type ResearchOverview, type ExportDatasetKey, type ExportFilterPayload, type ExportColumnGroup } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { ChartCard, DownloadBtn } from './ChartCard';
import { downloadSvgAsPng, downloadCsv } from './downloadUtils';
import { RELATION_COLORS, RELATION_LABELS } from '../relationColors';
import { SnaAdvancedPanel, LsaAdvancedPanel, TemporalAdvancedPanel, DiscourseAdvancedPanel, EquityAdvancedPanel } from './ResearchAdvanced';
import { VizAreaLine, VizBarChart, VizHorizontalBars, VizHeatmap, VizLorenz, VizRadialBars, VizStackedBar, VizDualAxis, VizNetworkGraph, VizGauge, VizActivityHeatmap, VizSessionHistogram, VizPhaseTimeline, VizCumulativeCurve, VizRhythmOverlay, VizEngagementSpans, VizStackedArea, VizDegreeDistribution, VizScatterPlot, VizDivergingBars, VizRadarChart, VizKCoreShell, VizBrokerBars, VizConceptNetwork } from './ResearchViz';

interface ResearchZoneProps {
  lang: Language;
  courses: Course[];
  activeModule?: ResearchModule;
}

type ResearchModule = 'overview' | 'temporal' | 'sna' | 'lsa' | 'discourse' | 'equity' | 'ai_insights' | 'export';

// ── Download Button Component ──────────────────────────────────

// ── Course Selector (shown in each module's content area) ──────────────
const CourseSelector: React.FC<{
  courses: Course[];
  selectedCourse: string;
  onChange: (id: string) => void;
  zh: boolean;
}> = ({ courses, selectedCourse, onChange, zh }) => (
  <div className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2">
    <RemixIcon name="book-open-line" size={14} className="text-gray-400 flex-shrink-0" />
    <select
      value={selectedCourse}
      onChange={e => onChange(e.target.value)}
      className="flex-1 bg-transparent text-sm font-medium text-gray-900 dark:text-gray-100 outline-none cursor-pointer"
    >
      <option value="">{zh ? '— 选择课程 —' : '— Select course —'}</option>
      {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
    </select>
  </div>
);

// ── Main Component ──────────────────────────────────
const ResearchZone: React.FC<ResearchZoneProps> = ({ lang, courses, activeModule = 'overview' }) => {
  const zh = lang === 'zh';
  const [selectedCourse, setSelectedCourse] = useState(courses[0]?.id ?? '');

  return (
    <div className="space-y-5">
      {/* Course Selector */}
      <div className="max-w-xs">
        <CourseSelector courses={courses} selectedCourse={selectedCourse} onChange={setSelectedCourse} zh={zh} />
      </div>

      {!selectedCourse ? (
        <div className="py-16 text-center">
          <RemixIcon name="flask-line" size={32} className="mx-auto text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            {zh ? '请先选择一门课程' : 'Select a course to begin'}
          </p>
        </div>
      ) : (
        <>
          {activeModule === 'overview' && <OverviewModule courseId={selectedCourse} zh={zh} />}
          {activeModule === 'temporal' && <TemporalModule courseId={selectedCourse} zh={zh} />}
          {activeModule === 'sna' && <SnaModule courseId={selectedCourse} zh={zh} />}
          {activeModule === 'lsa' && <LsaModule courseId={selectedCourse} zh={zh} />}
          {activeModule === 'discourse' && <DiscourseModule courseId={selectedCourse} zh={zh} />}
          {activeModule === 'equity' && <EquityModule courseId={selectedCourse} zh={zh} />}
          {activeModule === 'ai_insights' && <AiInsightsModule courseId={selectedCourse} zh={zh} />}
          {activeModule === 'export' && <ExportModule courseId={selectedCourse} zh={zh} />}
        </>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MODULE 1: Overview (研究概览) — Bento Dashboard
// ════════════════════════════════════════════════════════════════

const Sparkline: React.FC<{ data: number[]; color?: string; width?: number; height?: number }> = ({ data, color = '#000080', width = 64, height = 24 }) => {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * (height - 2) - 1}`).join(' ');
  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
    </svg>
  );
};

const TrendBadge: React.FC<{ change: number }> = ({ change }) => {
  if (change === 0) return <span className="text-[0.6875rem] tabular-nums text-gray-400">—</span>;
  const up = change > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[0.6875rem] tabular-nums font-medium ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
      {up ? '+' : ''}{change}%
      <RemixIcon name={up ? 'arrow-up-s-line' : 'arrow-down-s-line'} size={10} />
    </span>
  );
};

const MiniDonut: React.FC<{ accepted: number; dismissed: number; pending: number; total: number; size?: number }> = ({ accepted, dismissed, pending, total, size = 80 }) => {
  const r = (size - 12) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  if (total === 0) return null;
  const segments = [
    { pct: accepted / total, color: '#059669' },
    { pct: dismissed / total, color: '#ef4444' },
    { pct: pending / total, color: '#f59e0b' },
  ];
  let offset = 0;
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" className="dark:stroke-gray-800" />
      {segments.map((seg, i) => {
        const dash = seg.pct * circumference;
        const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth="6" strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round" />;
        offset += dash;
        return el;
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" className="fill-gray-900 dark:fill-gray-100 text-sm font-semibold">{total}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500 text-[0.5rem]">AI 干预</text>
    </svg>
  );
};

const OverviewModule: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<ResearchOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    researchApi.overview(courseId, days).then(res => setData(res)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [courseId, days]);

  if (loading) return <LoadingState zh={zh} />;
  if (!data) return <EmptyState zh={zh} />;

  const { stats, timeline, interventionDist, networkStats, insights, findings, recentActivities, kbMetrics } = data;

  const statCards = [
    { key: 'total_notes', label: zh ? '笔记总数' : 'Notes', icon: 'file-text-line', stat: stats.total_notes, color: '#000080' },
    { key: 'total_events', label: zh ? '事件总数' : 'Events', icon: 'pulse-line', stat: stats.total_events, color: '#2563eb' },
    { key: 'unique_authors', label: zh ? '参与者' : 'Participants', icon: 'team-line', stat: stats.unique_authors, color: '#7c3aed' },
    { key: 'total_relations', label: zh ? '关系数' : 'Relations', icon: 'link', stat: stats.total_relations, color: '#0891b2' },
    { key: 'total_interventions', label: zh ? 'AI 干预' : 'AI Interventions', icon: 'robot-line', stat: stats.total_interventions, color: '#000080' },
    { key: 'accepted_interventions', label: zh ? '已采纳' : 'Accepted', icon: 'checkbox-circle-line', stat: stats.accepted_interventions, color: '#059669' },
    { key: 'dismissed_interventions', label: zh ? '已忽略' : 'Dismissed', icon: 'close-circle-line', stat: stats.dismissed_interventions, color: '#ef4444' },
    { key: 'pending_interventions', label: zh ? '待处理' : 'Pending', icon: 'time-line', stat: stats.pending_interventions, color: '#f59e0b' },
  ];

  const dateRange = `${data.period.start.slice(0, 10)} ~ ${data.period.end.slice(0, 10)}`;

  // Build timeline SVG path
  const tlMax = Math.max(...timeline.map(t => t.notes + t.events), 1);
  const tlW = 100;
  const tlH = 100;
  const tlPad = { t: 10, b: 20, l: 5, r: 5 };
  const tlPlotW = tlW - tlPad.l - tlPad.r;
  const tlPlotH = tlH - tlPad.t - tlPad.b;
  const notesPts = timeline.map((t, i) => {
    const x = tlPad.l + (i / Math.max(timeline.length - 1, 1)) * tlPlotW;
    const y = tlPad.t + tlPlotH - (t.notes / tlMax) * tlPlotH;
    return `${x},${y}`;
  }).join(' ');
  const eventsPts = timeline.map((t, i) => {
    const x = tlPad.l + (i / Math.max(timeline.length - 1, 1)) * tlPlotW;
    const y = tlPad.t + tlPlotH - (t.events / tlMax) * tlPlotH;
    return `${x},${y}`;
  }).join(' ');
  const xLabels = timeline.length > 5
    ? [0, Math.floor(timeline.length / 4), Math.floor(timeline.length / 2), Math.floor(timeline.length * 3 / 4), timeline.length - 1]
    : timeline.map((_, i) => i);

  const statusLabel = (s: string) => {
    if (s === 'accepted') return { text: zh ? '已采纳' : 'Accepted', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
    if (s === 'dismissed') return { text: zh ? '已忽略' : 'Dismissed', cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    return { text: zh ? '待处理' : 'Pending', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <ModuleHeader title={zh ? '研究概览' : 'Research Overview'} description={zh ? '课程整体数据快照' : 'Course-level data snapshot'} />
        <div className="flex items-center gap-2">
          <RemixIcon name="calendar-line" size={14} className="text-gray-400" />
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
            <option value={7}>{zh ? '近 7 天' : 'Last 7 days'}</option>
            <option value={14}>{zh ? '近 14 天' : 'Last 14 days'}</option>
            <option value={30}>{zh ? '近 30 天' : 'Last 30 days'}</option>
            <option value={60}>{zh ? '近 60 天' : 'Last 60 days'}</option>
            <option value={90}>{zh ? '近 90 天' : 'Last 90 days'}</option>
          </select>
        </div>
      </div>

      {/* AI Insight Hero Card */}
      {insights.length > 0 && (
        <div className="rounded-xl border border-[#000080]/15 bg-[#000080]/[0.03] dark:border-[#93AAFD]/20 dark:bg-[#93AAFD]/[0.04] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#000080]/10 dark:bg-[#93AAFD]/15">
              <RemixIcon name="sparkling-2-fill" size={18} className="text-[#000080] dark:text-[#93AAFD]" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {zh ? '课程洞察（AI 总结）' : 'Course Insights (AI Summary)'}
              </h4>
              <div className="mt-1.5 space-y-1">
                {insights.map((ins, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <RemixIcon name={ins.icon} size={12} className="mt-0.5 flex-shrink-0 text-[#000080] dark:text-[#93AAFD]" />
                    <span>{ins.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <span className="flex-shrink-0 text-[0.6875rem] text-gray-400 dark:text-gray-500">{dateRange}</span>
          </div>
        </div>
      )}

      {/* Stats Grid — 2 rows x 4 cols */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map(c => (
          <div key={c.key} className="group rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <RemixIcon name={c.icon} size={14} style={{ color: c.color }} />
              <span className="text-xs">{c.label}</span>
            </div>
            <div className="mt-2 flex items-end justify-between">
              <div>
                <div className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{c.stat.value.toLocaleString()}</div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="text-[0.6875rem] text-gray-400">{zh ? '较上期' : 'vs prev'}</span>
                  <TrendBadge change={c.stat.change} />
                </div>
              </div>
              {c.stat.sparkline.length > 1 && <Sparkline data={c.stat.sparkline} color={c.color} />}
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row: Activity Trend | Intervention Donut | Network Stats | AI Insights */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        {/* Activity Trend */}
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-4 py-3">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{zh ? '互动活动趋势' : 'Activity Trend'}</h4>
            <div className="flex items-center gap-3 text-[0.6875rem] text-gray-400">
              <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 rounded bg-[#000080]" />{zh ? '笔记' : 'Notes'}</span>
              <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 rounded border-b border-dashed border-gray-400" />{zh ? '事件' : 'Events'}</span>
            </div>
          </div>
          <div className="p-4">
            <svg viewBox={`0 0 ${tlW} ${tlH}`} className="w-full" style={{ height: 120 }}>
              <polyline points={notesPts} fill="none" stroke="#000080" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={eventsPts} fill="none" stroke="#6b7280" strokeWidth="0.8" strokeDasharray="3,2" strokeLinecap="round" />
              {xLabels.map(idx => (
                <text key={idx} x={tlPad.l + (idx / Math.max(timeline.length - 1, 1)) * tlPlotW} y={tlH - 4} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500" fontSize="5">{timeline[idx]?.date.slice(5)}</text>
              ))}
            </svg>
          </div>
        </div>

        {/* Intervention Donut */}
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
          <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{zh ? '干预结果分布' : 'Intervention Dist.'}</h4>
          </div>
          <div className="flex flex-col items-center gap-2 p-4">
            <MiniDonut {...interventionDist} />
            <div className="flex flex-wrap justify-center gap-2 text-[0.6875rem]">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />{zh ? '已采纳' : 'Accepted'} {interventionDist.accepted}</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" />{zh ? '已忽略' : 'Dismissed'} {interventionDist.dismissed}</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-500" />{zh ? '待处理' : 'Pending'} {interventionDist.pending}</span>
            </div>
          </div>
        </div>

        {/* Network Stats */}
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
          <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{zh ? '参与者与网络概况' : 'Network Stats'}</h4>
          </div>
          <div className="space-y-2.5 p-4">
            {[
              { label: zh ? '总参与者' : 'Participants', value: networkStats.participants, icon: 'team-line' },
              { label: zh ? '活跃参与者' : 'Active', value: networkStats.active_participants, icon: 'user-follow-line' },
              { label: zh ? '平均事件/人' : 'Events/User', value: networkStats.avg_events_per_author, icon: 'bar-chart-line' },
              { label: zh ? '网络密度' : 'Density', value: networkStats.density, icon: 'share-line' },
              { label: zh ? '平均度数' : 'Avg Degree', value: networkStats.avg_degree, icon: 'git-branch-line' },
            ].map(n => (
              <div key={n.label} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <RemixIcon name={n.icon} size={12} className="text-gray-400" />
                  {n.label}
                </span>
                <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{n.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI Insights */}
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
          <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{zh ? 'AI 洞察' : 'AI Insights'}</h4>
          </div>
          <div className="space-y-2.5 p-4">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2">
                <RemixIcon name={ins.icon} size={12} className="mt-0.5 flex-shrink-0 text-[#000080] dark:text-[#93AAFD]" />
                <span className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">{ins.text}</span>
              </div>
            ))}
            {insights.length === 0 && <p className="text-xs text-gray-400">{zh ? '暂无洞察' : 'No insights'}</p>}
          </div>
        </div>
      </div>

      {/* KB Metrics Row */}
      {kbMetrics && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <RemixIcon name="mind-map" size={14} className="text-violet-600" />
                <span className="text-xs">{zh ? 'Rise-above' : 'Rise-above'}</span>
              </div>
              <div className="mt-2 flex items-end justify-between">
                <div className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{kbMetrics.riseAboveCount}</div>
                <TrendBadge change={kbMetrics.riseAboveChange} />
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <RemixIcon name="node-tree" size={14} className="text-blue-600" />
                <span className="text-xs">{zh ? '最深 Build-on 链' : 'Max Build-on Depth'}</span>
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{kbMetrics.maxBuildOnDepth}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <RemixIcon name="scales-3-line" size={14} className="text-amber-600" />
                <span className="text-xs">{zh ? '参与公平性 (Gini)' : 'Equity (Gini)'}</span>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{kbMetrics.gini}</span>
                <span className={`mb-0.5 text-[0.6875rem] font-medium ${kbMetrics.gini <= 0.2 ? 'text-emerald-600' : kbMetrics.gini <= 0.4 ? 'text-amber-600' : 'text-red-500'}`}>
                  {kbMetrics.gini <= 0.2 ? (zh ? '均衡' : 'Equal') : kbMetrics.gini <= 0.4 ? (zh ? '中等' : 'Moderate') : (zh ? '不均' : 'Unequal')}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <RemixIcon name="file-list-3-line" size={14} className="text-cyan-600" />
                <span className="text-xs">{zh ? '关系类型数' : 'Relation Types'}</span>
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {Object.keys(kbMetrics.relationTypeDist).length}
              </div>
            </div>
          </div>

          {/* Relation Type + Trigger Type Distribution */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {/* Relation type distribution */}
            {Object.keys(kbMetrics.relationTypeDist).length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
                <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{zh ? '关系类型分布' : 'Relation Types'}</h4>
                </div>
                <div className="space-y-2 p-4">
                  {Object.entries(kbMetrics.relationTypeDist).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                    const total = Object.values(kbMetrics.relationTypeDist).reduce((s, v) => s + v, 0);
                    const pct = total > 0 ? Math.round(count / total * 100) : 0;
                    return (
                      <div key={type} className="flex items-center gap-2">
                        <span className="w-16 truncate text-xs text-gray-600 dark:text-gray-400">{type}</span>
                        <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                          <div className="h-full rounded-full bg-[#000080]/60 dark:bg-[#4169E1]/50" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-right text-[0.6875rem] tabular-nums font-medium text-gray-700 dark:text-gray-300">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Trigger type distribution */}
            {Object.keys(kbMetrics.triggerTypeDist).length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
                <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{zh ? '干预触发类型' : 'Trigger Types'}</h4>
                </div>
                <div className="space-y-2 p-4">
                  {Object.entries(kbMetrics.triggerTypeDist).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                    const total = Object.values(kbMetrics.triggerTypeDist).reduce((s, v) => s + v, 0);
                    const pct = total > 0 ? Math.round(count / total * 100) : 0;
                    return (
                      <div key={type} className="flex items-center gap-2">
                        <span className="w-10 flex-shrink-0 text-[0.6875rem] font-bold text-gray-600 dark:text-gray-300">{type}</span>
                        <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                          <div className="h-full rounded-full bg-amber-500/60 dark:bg-amber-400/50" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-right text-[0.6875rem] tabular-nums font-medium text-gray-700 dark:text-gray-300">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top contributors */}
            {kbMetrics.topContributors.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
                <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{zh ? '贡献排名' : 'Top Contributors'}</h4>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
                  {kbMetrics.topContributors.map((c, i) => (
                    <div key={c.authorId} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-[0.6875rem] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-400">{c.authorId.slice(0, 8)}…</span>
                      <div className="flex items-center gap-3 text-[0.6875rem] tabular-nums">
                        <span className="text-gray-900 dark:text-gray-100">{c.noteCount} <span className="text-gray-400">{zh ? '篇' : 'N'}</span></span>
                        <span className="text-emerald-600">↑{c.outDegree}</span>
                        <span className="text-blue-600">↓{c.inDegree}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Row: Key Findings + Recent Activity */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Key Findings */}
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
          <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{zh ? '关键研究发现' : 'Key Findings'}</h4>
          </div>
          <div className="space-y-2.5 p-4">
            {findings.map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#000080] dark:bg-[#93AAFD]" />
                <span className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">{f}</span>
              </div>
            ))}
            {findings.length === 0 && <p className="text-xs text-gray-400">{zh ? '暂无发现' : 'No findings yet'}</p>}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
          <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{zh ? '最近活动 / 干预记录' : 'Recent Activity'}</h4>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {recentActivities.slice(0, 6).map(a => {
              const sl = statusLabel(a.status);
              const time = new Date(a.created_at);
              const isToday = time.toDateString() === new Date().toDateString();
              const timeStr = isToday
                ? `${zh ? '今天' : 'Today'} ${time.toTimeString().slice(0, 5)}`
                : `${time.toISOString().slice(5, 10)} ${time.toTimeString().slice(0, 5)}`;
              return (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium ${sl.cls}`}>{sl.text}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-400">{a.message || `${a.trigger_type ?? 'AI'} ${zh ? '干预' : 'intervention'}`}</span>
                  <span className="flex-shrink-0 text-[0.6875rem] tabular-nums text-gray-400">{timeStr}</span>
                </div>
              );
            })}
            {recentActivities.length === 0 && <p className="px-4 py-4 text-xs text-gray-400">{zh ? '暂无记录' : 'No recent activity'}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MODULE 2: Temporal Analysis (时序分析)
// ════════════════════════════════════════════════════════════════

const TemporalModule: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof researchApi.temporal>> | null>(null);
  const [adv, setAdv] = useState<Awaited<ReturnType<typeof researchApi.temporalAdvanced>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const timelineSvgRef = useRef<SVGSVGElement>(null);
  const heatmapSvgRef = useRef<SVGSVGElement>(null);
  const hourSvgRef = useRef<SVGSVGElement>(null);
  const stackedRef = useRef<SVGSVGElement>(null);
  const cumulativeRef = useRef<SVGSVGElement>(null);
  const momentumRef = useRef<SVGSVGElement>(null);
  const phaseRef = useRef<SVGSVGElement>(null);
  const sessionRef = useRef<SVGSVGElement>(null);
  const rhythmRef = useRef<SVGSVGElement>(null);
  const engagementRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setLoading(true);
    const tzOffsetHours = -new Date().getTimezoneOffset() / 60;
    Promise.all([
      researchApi.temporal(courseId, { granularity, tzOffsetHours }),
      researchApi.temporalAdvanced(courseId).catch(() => null),
    ]).then(([basic, advanced]) => {
      setData(basic);
      setAdv(advanced);
    }).catch(() => setData(null)).finally(() => setLoading(false));
  }, [courseId, granularity]);

  if (loading) return <LoadingState zh={zh} />;
  if (!data) return <EmptyState zh={zh} />;

  const { timeline, hourDistribution, dayOfWeekDistribution, heatmap, authorPatterns, bursts, stats } = data;
  const dayLabels = zh ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-8">
      <ModuleHeader title={zh ? '时序分析' : 'Temporal Analysis'} description={zh ? '活动时间线、参与节奏、学习动量与阶段检测' : 'Activity timeline, participation rhythm, momentum & phase detection'} />

      {/* ─── Section: Overview ─────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
          <RemixIcon name="dashboard-line" size={12} />
          {zh ? '总览' : 'Overview'}
        </h3>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            { label: zh ? '统计天数' : 'Days Covered', value: stats.totalDays, color: 'text-[#000080]' },
            { label: zh ? '日均笔记' : 'Notes/Day', value: stats.avgDailyNotes, color: stats.avgDailyNotes >= 3 ? 'text-emerald-600' : stats.avgDailyNotes >= 1 ? 'text-amber-600' : 'text-red-500' },
            { label: zh ? '日均事件' : 'Events/Day', value: stats.avgDailyEvents, color: 'text-gray-900 dark:text-gray-100' },
            { label: zh ? '突发日' : 'Bursts', value: stats.burstCount, color: stats.burstCount > 0 ? 'text-amber-600' : 'text-gray-400' },
            ...(adv ? [
              { label: zh ? '学习会话' : 'Sessions', value: adv.sessions.stats.totalSessions, color: 'text-[#000080]' },
              { label: zh ? '平均时长' : 'Avg Min', value: `${adv.sessions.stats.avgDuration}m`, color: adv.sessions.stats.avgDuration >= 15 ? 'text-emerald-600' : 'text-amber-600' },
            ] : []),
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3">
              <div className="text-[0.6875rem] text-gray-500 dark:text-gray-400 truncate">{s.label}</div>
              <div className={`mt-1 text-lg font-semibold tabular-nums ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500 flex items-center gap-1.5">
            <RemixIcon name="settings-3-line" size={12} />
            {zh ? '粒度' : 'Granularity'}
            <select value={granularity} onChange={e => setGranularity(e.target.value as 'day' | 'week')} className="ml-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-2 py-1 text-xs">
              <option value="day">{zh ? '按天' : 'Daily'}</option>
              <option value="week">{zh ? '按周' : 'Weekly'}</option>
            </select>
          </label>
        </div>

        <MethodNote zh={zh} textZh="方法说明：所有小时/星期分布均按你所在时区换算；统计天数为首末活动日之间的完整日历跨度（无活动日计 0），日均值据此计算。突发日 = 单日活动量超过均值 + 2 个标准差的日期。" textEn="Method: Hour-of-day and day-of-week distributions use your local timezone. Days covered is the full calendar span between first and last activity (zero-activity days included), and daily averages use that span. Burst days exceed mean + 2 SD of daily activity." />

        {/* Activity Heatmap (GitHub-style) */}
        {heatmap.length > 7 && (
          <ChartCard title={zh ? '活跃日历热力图' : 'Activity Calendar Heatmap'} onDownloadPng={() => downloadSvgAsPng(heatmapSvgRef.current, 'temporal_heatmap.png')}>
            <VizActivityHeatmap ref={heatmapSvgRef} data={heatmap} />
          </ChartCard>
        )}

        {/* Stacked Activity Breakdown */}
        <ChartCard title={zh ? '活动类型分层面积图' : 'Activity Breakdown (Stacked Area)'} onDownloadPng={() => downloadSvgAsPng(stackedRef.current, 'temporal_stacked.png')} onDownloadCsv={() => downloadCsv(timeline as unknown as Record<string, unknown>[], 'temporal_timeline.csv')}>
          <VizStackedArea
            ref={stackedRef}
            data={timeline.map(t => ({ label: t.date.slice(5), values: { notes: t.notes, events: t.events, relations: t.relations } }))}
            series={[
              { key: 'notes', color: '#000080', label: zh ? '笔记' : 'Notes' },
              { key: 'events', color: '#2563eb', label: zh ? '事件' : 'Events' },
              { key: 'relations', color: '#7c3aed', label: zh ? '关系' : 'Relations' },
            ]}
            height={200}
          />
        </ChartCard>

        {/* Cumulative Curve */}
        <ChartCard title={zh ? '累积活动曲线' : 'Cumulative Activity Curve'} onDownloadPng={() => downloadSvgAsPng(cumulativeRef.current, 'temporal_cumulative.png')}>
          <VizCumulativeCurve
            ref={cumulativeRef}
            data={timeline.map(t => ({ label: t.date.slice(5), value: t.notes + t.events + t.relations }))}
            height={180}
          />
          <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '实线=实际累积进度，虚线=理想匀速增长。差距越大表示活跃度波动越大' : 'Solid = actual cumulative, Dashed = ideal linear growth'}</p>
        </ChartCard>
      </section>

      {/* ─── Section: Rhythms ─────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
          <RemixIcon name="rhythm-line" size={12} />
          {zh ? '参与节律' : 'Participation Rhythms'}
        </h3>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title={zh ? '24 小时活跃分布 (极坐标)' : '24h Activity (Polar)'} onDownloadPng={() => downloadSvgAsPng(hourSvgRef.current, 'temporal_hours.png')} onDownloadCsv={() => downloadCsv(hourDistribution.map((c, h) => ({ hour: h, count: c })), 'temporal_hours.csv')}>
            <VizRadialBars ref={hourSvgRef} data={hourDistribution} />
          </ChartCard>

          <ChartCard title={zh ? '星期活跃分布' : 'Day-of-Week'} onDownloadCsv={() => downloadCsv(dayOfWeekDistribution.map((c, d) => ({ day: dayLabels[d], count: c })), 'temporal_dow.csv')}>
            <VizBarChart
              data={dayOfWeekDistribution.map((count, d) => ({ label: dayLabels[d], value: count }))}
              height={180}
            />
          </ChartCard>
        </div>

        {/* Rhythm Overlay */}
        {adv && adv.rhythmClusters.length > 0 && (
          <ChartCard title={zh ? '作息节律类型叠加图' : 'Circadian Rhythm Overlay'} onDownloadPng={() => downloadSvgAsPng(rhythmRef.current, 'temporal_rhythm_overlay.png')}>
            <VizRhythmOverlay ref={rhythmRef} clusters={adv.rhythmClusters} />
            <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '不同颜色代表晨型/午型/夜型/深夜型学习者的平均时段分布' : 'Colors represent avg hourly distribution per chronotype cluster'}</p>
          </ChartCard>
        )}
      </section>

      {/* ─── Section: Momentum & Phases ─────────────── */}
      {adv && (
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
            <RemixIcon name="speed-line" size={12} />
            {zh ? '活跃动量与阶段' : 'Momentum & Phases'}
          </h3>

          {/* Momentum */}
          {adv.momentum.length > 2 && (
            <ChartCard title={zh ? '活跃度动量曲线（速率 + 加速度）' : 'Activity Momentum (Rate + Acceleration)'} onDownloadPng={() => downloadSvgAsPng(momentumRef.current, 'temporal_momentum.png')} onDownloadCsv={() => downloadCsv(adv.momentum as unknown as Record<string, unknown>[], 'temporal_momentum.csv')}>
              <VizDualAxis
                ref={momentumRef}
                series1={adv.momentum.map(p => ({ label: p.date, value: p.rate }))}
                series2={adv.momentum.map(p => ({ label: p.date, value: p.acceleration }))}
                s1Label={zh ? '速率' : 'Rate'}
                s2Label={zh ? '加速度' : 'Accel'}
                height={180}
              />
              <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '蓝线=7天移动均值速率，橙线=加速度（正=增长趋势，负=衰退趋势）' : 'Blue = 7-day MA rate, Orange = acceleration (positive = growth)'}</p>
            </ChartCard>
          )}

          {/* Phase Timeline (Gantt) */}
          {adv.phases.length > 1 && (
            <ChartCard title={zh ? '活跃阶段检测 (CUSUM)' : 'Activity Phase Detection (CUSUM)'} onDownloadPng={() => downloadSvgAsPng(phaseRef.current, 'temporal_phases.png')}>
              <VizPhaseTimeline ref={phaseRef} phases={adv.phases} />
              <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '绿=高活跃期，紫=正常期，红=低活跃期。数字为该阶段日均活动数' : 'Green = high, Purple = normal, Red = low. Numbers show avg daily activity'}</p>
            </ChartCard>
          )}

          {/* Bursts */}
          {bursts.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-4">
              <h4 className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <RemixIcon name="flashlight-line" size={13} />
                {zh ? `检测到 ${bursts.length} 个突发活跃日` : `${bursts.length} burst day(s) detected`}
              </h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {bursts.map(b => (
                  <span key={b.date} className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-0.5 text-[0.6875rem] font-medium text-amber-700 dark:text-amber-300 tabular-nums">
                    {b.date} <span className="text-amber-500">({b.activity})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─── Section: Sessions ────────────────────────── */}
      {adv && (
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
            <RemixIcon name="timer-line" size={12} />
            {zh ? '学习会话分析' : 'Session Analysis'}
          </h3>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: zh ? '总会话数' : 'Total', value: adv.sessions.stats.totalSessions },
              { label: zh ? '平均时长' : 'Avg (min)', value: adv.sessions.stats.avgDuration },
              { label: zh ? '中位时长' : 'Median (min)', value: adv.sessions.stats.medianDuration },
              { label: zh ? '每次活动' : 'Acts/Session', value: adv.sessions.stats.avgActivityPerSession },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3">
                <div className="text-[0.6875rem] text-gray-500 dark:text-gray-400">{s.label}</div>
                <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Session Duration Histogram */}
          {adv.sessions.list.length > 3 && (
            <ChartCard title={zh ? '会话时长分布' : 'Session Duration Distribution'} onDownloadPng={() => downloadSvgAsPng(sessionRef.current, 'temporal_session_hist.png')}>
              <VizSessionHistogram ref={sessionRef} durations={adv.sessions.list.map(s => s.duration)} bucketSize={5} height={180} />
              <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? 'X 轴=会话时长（分钟），Y 轴=次数。桶宽 5 分钟' : 'X = session duration (min), Y = frequency. Bucket = 5 min'}</p>
            </ChartCard>
          )}

          {/* Regularity */}
          {Object.keys(adv.regularity).length > 0 && (
            <ChartCard title={zh ? '学习规律性排行' : 'Learning Regularity Ranking'}>
              <VizHorizontalBars
                data={Object.entries(adv.regularity)
                  .sort(([, a], [, b]) => b.regularityScore - a.regularityScore)
                  .slice(0, 12)
                  .map(([id, r]) => ({ label: id.slice(0, 6), value: Math.round(r.regularityScore * 100) }))}
              />
              <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '规律性 = 1 - 归一化熵（100=非常规律，0=完全随机）' : 'Regularity = (1 - normalized entropy) × 100'}</p>
            </ChartCard>
          )}
        </section>
      )}

      {/* ─── Section: Engagement ──────────────────────── */}
      {authorPatterns && authorPatterns.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
            <RemixIcon name="team-line" size={12} />
            {zh ? '个体参与度' : 'Individual Engagement'}
          </h3>

          <ChartCard title={zh ? '参与者活跃周期' : 'Author Engagement Spans'} onDownloadPng={() => downloadSvgAsPng(engagementRef.current, 'temporal_engagement.png')} onDownloadCsv={() => downloadCsv(authorPatterns as unknown as Record<string, unknown>[], 'temporal_authors.csv')}>
            <VizEngagementSpans ref={engagementRef} authors={authorPatterns} />
            <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '每条代表一位参与者的活跃期间，颜色反映活跃天占比（绿>50%，橙25-50%，红<25%）' : 'Each bar = active period. Color = active day ratio (green >50%, amber 25-50%, red <25%)'}</p>
          </ChartCard>
        </section>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MODULE 3: SNA (社会网络分析)
// ════════════════════════════════════════════════════════════════

const SnaModule: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [result, setResult] = useState<Awaited<ReturnType<typeof researchApi.sna>> | null>(null);
  const [adv, setAdv] = useState<Awaited<ReturnType<typeof researchApi.snaAdvanced>> | null>(null);
  const [cogNet, setCogNet] = useState<Awaited<ReturnType<typeof researchApi.cognitiveNetwork>> | null>(null);
  const [aiResult, setAiResult] = useState<Awaited<ReturnType<typeof researchApi.aiInsights>> | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const heatmapRef = useRef<SVGSVGElement>(null);
  const degreeRef = useRef<SVGSVGElement>(null);
  const scatterRef = useRef<SVGSVGElement>(null);
  const divergingRef = useRef<SVGSVGElement>(null);
  const radarRef = useRef<SVGSVGElement>(null);
  const kcoreRef = useRef<SVGSVGElement>(null);
  const brokerRef = useRef<SVGSVGElement>(null);
  const cogNetRef = useRef<SVGSVGElement>(null);

  const runSna = async () => {
    setLoading(true);
    setError('');
    try {
      const [basic, advanced, cognitive] = await Promise.all([
        researchApi.sna(courseId),
        researchApi.snaAdvanced(courseId).catch(() => null),
        researchApi.cognitiveNetwork(courseId).catch(() => null),
      ]);
      setResult(basic);
      setAdv(advanced);
      setCogNet(cognitive);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'SNA failed');
    } finally {
      setLoading(false);
    }
  };

  const runAiAnalysis = async () => {
    setAiLoading(true);
    try {
      const res = await researchApi.aiInsights(courseId);
      setAiResult(res);
    } catch { /* ignore */ } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <ModuleHeader title={zh ? '社会网络分析 (SNA)' : 'Social Network Analysis'} description={zh ? '知识建构互动网络的结构、中心性与角色分析' : 'Network structure, centrality & role analysis'} />
      <RunButton onClick={runSna} loading={loading} zh={zh} />
      {error && <ErrorBanner message={error} />}

      {result && (
        <>
          {/* ─── Section: Network Overview ────────────── */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
              <RemixIcon name="dashboard-line" size={12} />
              {zh ? '网络总览' : 'Network Overview'}
            </h3>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-5">
              {[
                { label: zh ? '节点数' : 'Nodes', value: result.metrics.nodeCount, color: 'text-[#000080]' },
                { label: zh ? '边数' : 'Edges', value: result.metrics.edgeCount, color: 'text-[#000080]' },
                { label: zh ? '网络密度' : 'Density', value: result.metrics.density.toFixed(4), color: result.metrics.density > 0.3 ? 'text-emerald-600' : result.metrics.density > 0.1 ? 'text-amber-600' : 'text-red-500' },
                { label: zh ? '连通分量' : 'Components', value: result.metrics.components, color: result.metrics.components === 1 ? 'text-emerald-600' : 'text-amber-600' },
                { label: zh ? '平均度' : 'Avg Degree', value: result.metrics.avgDegree, color: 'text-gray-900 dark:text-gray-100' },
                ...(result.metrics.degreeCentralization !== undefined ? [
                  { label: zh ? '度中心势' : 'Centralization', value: result.metrics.degreeCentralization.toFixed(4), color: result.metrics.degreeCentralization > 0.5 ? 'text-amber-600' : 'text-emerald-600' },
                ] : []),
                ...(adv ? [
                  { label: zh ? '聚类系数' : 'Clustering', value: adv.network.globalClustering.toFixed(4), color: adv.network.globalClustering > 0.3 ? 'text-emerald-600' : 'text-amber-600' },
                  { label: zh ? '互惠性' : 'Reciprocity', value: adv.network.reciprocity.toFixed(4), color: adv.network.reciprocity > 0.3 ? 'text-emerald-600' : 'text-amber-600' },
                  { label: zh ? '平均路径' : 'Avg Path', value: adv.network.avgPathLength.toFixed(2), color: 'text-gray-900 dark:text-gray-100' },
                  { label: zh ? '最大 K-Core' : 'Max K-Core', value: adv.network.maxKCore, color: 'text-[#000080]' },
                  { label: zh ? '小世界 σ' : 'Small-World σ', value: adv.network.smallWorldIndex.toFixed(3), color: adv.network.smallWorldIndex > 1 ? 'text-emerald-600' : 'text-gray-600' },
                ] : (result.metrics.reciprocity !== undefined ? [
                  { label: zh ? '互惠性' : 'Reciprocity', value: result.metrics.reciprocity.toFixed(4), color: result.metrics.reciprocity > 0.3 ? 'text-emerald-600' : 'text-amber-600' },
                ] : [])),
              ].map(m => (
                <div key={m.label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3">
                  <div className="text-[0.6875rem] text-gray-500 dark:text-gray-400 truncate">{m.label}</div>
                  <div className={`mt-1 text-lg font-semibold tabular-nums ${m.color}`}>{m.value}</div>
                </div>
              ))}
            </div>

            <MethodNote zh={zh} textZh="方法说明：网络为有向图，节点=学生（已匿名化），边=Build-on/引用等互动。密度=实际边数/可能边数 n(n-1)；度中心性按不重复互动对象数计算（Freeman, 1978），加权强度另列；介数中心性采用 Brandes 算法（无向化处理）；度中心势反映网络是否由少数核心节点主导（越接近 1 越集中）；互惠性=双向互动边占比。教师账号已包含在网络中，解读时请注意。" textEn="Method: Directed graph; nodes = students (anonymized), edges = build-on/reference interactions. Density = edges / n(n-1); degree centrality counts distinct partners (Freeman, 1978) with weighted strength reported separately; betweenness uses Brandes' algorithm on the undirected projection; centralization indicates hub dominance (closer to 1 = more centralized); reciprocity = share of mutual edges." />

            {/* Network Graph */}
            <ChartCard title={zh ? '知识建构互动网络图' : 'Interaction Network Graph'} onDownloadCsv={() => downloadCsv(result.edges.map(e => ({ source: e.source, target: e.target, weight: e.weight })), 'sna_edges.csv')}>
              <VizNetworkGraph
                nodes={result.nodes.map(n => ({ id: n.id, weight: n.noteCount + n.inDegree + n.outDegree }))}
                edges={result.edges}
              />
            </ChartCard>

            {/* Adjacency Heatmap */}
            <ChartCard title={zh ? '邻接矩阵热力图' : 'Adjacency Heatmap'} onDownloadPng={() => downloadSvgAsPng(heatmapRef.current, 'sna_heatmap.png')} onDownloadCsv={() => downloadCsv(result.edges.map(e => ({ source: e.source, target: e.target, weight: e.weight })), 'sna_edges.csv')}>
              <AdjacencyHeatmap nodes={result.nodes} edges={result.edges} svgRef={heatmapRef} />
            </ChartCard>
          </section>

          {/* ─── Section: Centrality Analysis ─────────── */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
              <RemixIcon name="focus-3-line" size={12} />
              {zh ? '中心性分析' : 'Centrality Analysis'}
            </h3>

            {/* Degree Distribution */}
            <ChartCard title={zh ? '度分布直方图' : 'Degree Distribution'} onDownloadPng={() => downloadSvgAsPng(degreeRef.current, 'sna_degree_dist.png')}>
              <VizDegreeDistribution ref={degreeRef} degrees={result.nodes.map(n => n.inDegree + n.outDegree)} />
              <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? 'X 轴=节点度数，Y 轴=拥有该度数的节点数。尖峰分布=少数核心节点主导' : 'X = node degree, Y = frequency. Skewed = hub-dominated network'}</p>
            </ChartCard>

            {/* Centrality Scatter */}
            <ChartCard title={zh ? '中心性散点图（度 vs 中介）' : 'Centrality Scatter (Degree vs Betweenness)'} onDownloadPng={() => downloadSvgAsPng(scatterRef.current, 'sna_centrality_scatter.png')}>
              <VizScatterPlot
                ref={scatterRef}
                points={result.nodes.map(n => ({
                  label: n.id.slice(0, 6),
                  x: n.degreeCentrality,
                  y: n.betweennessCentrality,
                  size: n.noteCount,
                }))}
                xLabel={zh ? '度中心性 (连接数)' : 'Degree Centrality'}
                yLabel={zh ? '中介中心性 (桥梁度)' : 'Betweenness'}
              />
              <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '右上=核心枢纽，左上=信息桥梁，右下=活跃但非关键，左下=边缘节点。圆大小=笔记数' : 'Top-right = hub, Top-left = bridge, Bottom-right = active non-key, Bottom-left = peripheral'}</p>
            </ChartCard>

            {/* In/Out Degree Balance */}
            <ChartCard title={zh ? '入度 / 出度平衡' : 'In-Degree / Out-Degree Balance'} onDownloadPng={() => downloadSvgAsPng(divergingRef.current, 'sna_inout_balance.png')}>
              <VizDivergingBars
                ref={divergingRef}
                data={result.nodes.map(n => ({ label: n.id.slice(0, 6), left: n.inDegree, right: n.outDegree }))}
                leftLabel={zh ? '← 入度 (被引用)' : '← In (received)'}
                rightLabel={zh ? '出度 (发起) →' : 'Out (initiated) →'}
                leftColor="#6366f1"
                rightColor="#000080"
              />
              <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '入度高=受关注者（被回复/引用多），出度高=发起者（主动连接多）' : 'High in-degree = attention receiver, High out-degree = initiator'}</p>
            </ChartCard>

            {/* Centrality Table (condensed) */}
            <ChartCard title={zh ? '节点中心性排行' : 'Centrality Ranking'} onDownloadCsv={() => downloadCsv(result.nodes.map(n => ({ id: n.id, noteCount: n.noteCount, inDegree: n.inDegree, outDegree: n.outDegree, degreeCentrality: n.degreeCentrality, betweennessCentrality: n.betweennessCentrality })), 'sna_centrality.csv')}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-900 bg-gray-50 dark:bg-gray-950">
                      <th className="px-2 py-2 text-left font-medium text-gray-500">{zh ? '节点' : 'Node'}</th>
                      <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '笔记' : 'Notes'}</th>
                      <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '入/出' : 'In/Out'}</th>
                      <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '度中心性' : 'Degree'}</th>
                      <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '中介性' : 'Between.'}</th>
                      {adv && <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '特征向量' : 'Eigenvec.'}</th>}
                      {adv && <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '聚类' : 'Clust.'}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.nodes.sort((a, b) => b.degreeCentrality - a.degreeCentrality).slice(0, 12).map(node => {
                      const advNode = adv?.nodes.find(n => n.authorId === node.id);
                      const maxDeg = Math.max(...result.nodes.map(n => n.degreeCentrality), 0.001);
                      return (
                        <tr key={node.id} className="border-b border-gray-50 dark:border-gray-900/50 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                          <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400">{node.id.slice(0, 8)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{node.noteCount}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{node.inDegree}/{node.outDegree}</td>
                          <td className="px-2 py-1.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <div className="h-1.5 w-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800">
                                <div className="h-full bg-[#000080] rounded-full" style={{ width: `${(node.degreeCentrality / maxDeg) * 100}%` }} />
                              </div>
                              <span className="tabular-nums text-[0.6875rem]">{node.degreeCentrality.toFixed(3)}</span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{node.betweennessCentrality.toFixed(3)}</td>
                          {adv && <td className="px-2 py-1.5 text-right tabular-nums">{advNode?.eigenvector.toFixed(3) ?? '—'}</td>}
                          {adv && <td className="px-2 py-1.5 text-right tabular-nums">{advNode?.clustering.toFixed(3) ?? '—'}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </section>

          {/* ─── Section: Network Structure ───────────── */}
          {adv && (
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
                <RemixIcon name="git-branch-line" size={12} />
                {zh ? '网络结构分析' : 'Network Structure'}
              </h3>

              {/* Structural Roles Radar */}
              {adv.nodes.length > 0 && (() => {
                const top3 = [...adv.nodes]
                  .sort((a, b) => b.eigenvector - a.eigenvector)
                  .slice(0, 3);
                const basicMap = new Map(result.nodes.map(n => [n.id, n]));
                const maxDeg = Math.max(...result.nodes.map(n => n.degreeCentrality), 0.001);
                const maxBtw = Math.max(...result.nodes.map(n => n.betweennessCentrality), 0.001);
                const maxClose = Math.max(...adv.nodes.map(n => n.closeness), 0.001);
                const maxEigen = Math.max(...adv.nodes.map(n => n.eigenvector), 0.001);
                const maxClust = Math.max(...adv.nodes.map(n => n.clustering), 0.001);
                const colors = ['#000080', '#2563eb', '#7c3aed'];

                return (
                  <ChartCard title={zh ? '核心节点角色雷达图' : 'Top Node Role Radar'} onDownloadPng={() => downloadSvgAsPng(radarRef.current, 'sna_radar.png')}>
                    <VizRadarChart
                      ref={radarRef}
                      axes={zh ? ['度中心性', '中介性', '闭合性', '特征向量', '聚类系数'] : ['Degree', 'Between.', 'Closeness', 'Eigenvec.', 'Clustering']}
                      series={top3.map((n, i) => {
                        const basic = basicMap.get(n.authorId);
                        return {
                          label: n.authorId.slice(0, 6),
                          values: [
                            (basic?.degreeCentrality ?? 0) / maxDeg,
                            (basic?.betweennessCentrality ?? 0) / maxBtw,
                            n.closeness / maxClose,
                            n.eigenvector / maxEigen,
                            n.clustering / maxClust,
                          ],
                          color: colors[i],
                        };
                      })}
                    />
                    <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '对比前 3 名核心节点在 5 个中心性维度上的相对位置' : 'Comparing top 3 nodes across 5 centrality dimensions (normalized)'}</p>
                  </ChartCard>
                );
              })()}

              {/* K-Core Shell */}
              {adv.nodes.length > 0 && (
                <ChartCard title={zh ? 'K-Core 分层壳图' : 'K-Core Shell Diagram'} onDownloadPng={() => downloadSvgAsPng(kcoreRef.current, 'sna_kcore.png')}>
                  <VizKCoreShell
                    ref={kcoreRef}
                    nodes={adv.nodes.map(n => {
                      const basic = result.nodes.find(b => b.id === n.authorId);
                      return { id: n.authorId, kCore: n.kCore, degree: (basic?.inDegree ?? 0) + (basic?.outDegree ?? 0) };
                    })}
                  />
                  <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '同心圆=K-Core 层级（中心=核心，外围=边缘），节点大小=度数。K-Core 值越高表示该节点处于越紧密的子图中' : 'Inner rings = higher k-core (tighter subgraph). Node size = degree'}</p>
                </ChartCard>
              )}

              {/* Structural Hole Broker Bars */}
              {adv.nodes.length > 0 && (
                <ChartCard title={zh ? '结构洞分析（Burt 约束值排行）' : 'Structural Holes (Burt Constraint)'} onDownloadPng={() => downloadSvgAsPng(brokerRef.current, 'sna_brokers.png')} onDownloadCsv={() => downloadCsv(adv.nodes.map(n => ({ id: n.authorId, constraint: n.constraint, kCore: n.kCore })), 'sna_structural_holes.csv')}>
                  <VizBrokerBars
                    ref={brokerRef}
                    data={adv.nodes.map(n => ({ label: n.authorId.slice(0, 6), constraint: n.constraint }))}
                    threshold={0.3}
                  />
                  <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '约束值 < 0.3（红色虚线左侧，绿色）= 结构洞位置，充当不同群体间的信息桥梁 (Burt, 1992)' : 'Constraint < 0.3 (left of red line, green) = structural hole broker bridging disconnected groups (Burt, 1992)'}</p>
                </ChartCard>
              )}
            </section>
          )}

          {/* ─── Section: Cognitive Network ───────────── */}
          {cogNet && cogNet.nodes.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
                <RemixIcon name="mind-map" size={12} />
                {zh ? '认知网络（关键词共现）' : 'Cognitive Network (Keyword Co-occurrence)'}
              </h3>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3">
                  <div className="text-[0.6875rem] text-gray-500">{zh ? '提取关键词数' : 'Keywords'}</div>
                  <div className="mt-1 text-lg font-semibold text-[#000080]">{cogNet.stats.uniqueKeywords}</div>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3">
                  <div className="text-[0.6875rem] text-gray-500">{zh ? '共现关联数' : 'Co-occurrences'}</div>
                  <div className="mt-1 text-lg font-semibold text-[#000080]">{cogNet.edges.length}</div>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3">
                  <div className="text-[0.6875rem] text-gray-500">{zh ? '分析笔记数' : 'Notes Analyzed'}</div>
                  <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{cogNet.stats.totalNotes}</div>
                </div>
              </div>

              <ChartCard title={zh ? '认知关键词网络图' : 'Cognitive Keyword Network'} onDownloadPng={() => downloadSvgAsPng(cogNetRef.current, 'cognitive_network.png')} onDownloadCsv={() => downloadCsv(cogNet.edges.map(e => ({ keyword1: e.source, keyword2: e.target, cooccurrence: e.weight })), 'cognitive_network_edges.csv')}>
                <VizConceptNetwork
                  ref={cogNetRef}
                  nodes={cogNet.nodes}
                  edges={cogNet.edges}
                />
                <p className="text-[0.6875rem] text-gray-400 mt-1">{zh ? '节点=关键词（大小=TF-IDF 权重），边=同一篇笔记中共同出现的频率。聚集的概念表示学生在讨论中经常一起提到的知识点' : 'Nodes = keywords (size = TF-IDF weight), edges = co-occurrence frequency. Clusters indicate concepts frequently discussed together'}</p>
              </ChartCard>

              {/* Top Keywords Table */}
              <ChartCard title={zh ? '高频关键词排行' : 'Top Keywords'} onDownloadCsv={() => downloadCsv(cogNet.nodes.map(n => ({ keyword: n.id, tfidf_score: n.weight.toFixed(2), frequency: n.freq, documents: n.docs })), 'cognitive_keywords.csv')}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {cogNet.nodes.slice(0, 15).map((n, i) => {
                    const maxW = cogNet.nodes[0]?.weight ?? 1;
                    return (
                      <div key={n.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                        <span className="text-[0.6875rem] font-mono text-gray-400 w-4">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate block">{n.id}</span>
                          <div className="h-1 w-full rounded-full bg-gray-200 dark:bg-gray-800 mt-0.5">
                            <div className="h-full rounded-full bg-[#000080]" style={{ width: `${(n.weight / maxW) * 100}%` }} />
                          </div>
                        </div>
                        <span className="text-[0.6875rem] text-gray-400 tabular-nums">{n.freq}</span>
                      </div>
                    );
                  })}
                </div>
              </ChartCard>
            </section>
          )}

          {/* ─── Section: AI Analysis ────────────────── */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#000080] dark:text-[#93AAFD] flex items-center gap-1.5">
              <RemixIcon name="sparkling-2-line" size={12} />
              {zh ? 'AI 智能分析' : 'AI Analysis'}
            </h3>

            {!aiResult ? (
              <button
                onClick={runAiAnalysis}
                disabled={aiLoading}
                className="w-full rounded-xl border border-dashed border-[#000080]/30 dark:border-[#93AAFD]/30 bg-[#000080]/[0.02] dark:bg-[#93AAFD]/[0.03] p-5 text-center transition-all hover:border-[#000080]/50 hover:bg-[#000080]/[0.05]"
              >
                {aiLoading ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                    <div className="w-4 h-4 border-2 border-[#000080]/30 border-t-[#000080] rounded-full animate-spin" />
                    {zh ? 'AI 正在分析网络数据...' : 'AI analyzing network data...'}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-[#000080] dark:text-[#93AAFD]">
                      <RemixIcon name="sparkling-2-line" size={16} className="inline mr-1" />
                      {zh ? '生成 AI 分析报告' : 'Generate AI Analysis'}
                    </div>
                    <div className="text-[0.6875rem] text-gray-400">{zh ? '基于当前网络结构、中心性指标和互动模式，AI 将给出教学建议' : 'AI will analyze network structure, centrality & interaction patterns to provide teaching recommendations'}</div>
                  </div>
                )}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="text-[0.6875rem] text-gray-400">{zh ? '生成于' : 'Generated at'}: {new Date(aiResult.generatedAt).toLocaleString()}</div>
                {aiResult.insights.filter(i => i.type === 'sna' || i.type === 'network' || i.type === 'participation' || i.type === 'interaction').length > 0 ? (
                  aiResult.insights
                    .filter(i => ['sna', 'network', 'participation', 'interaction', 'equity', 'engagement'].includes(i.type))
                    .map((insight, i) => (
                      <div key={i} className={`rounded-xl border p-4 ${
                        insight.severity === 'high' ? 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20' :
                        insight.severity === 'medium' ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20' :
                        'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20'
                      }`}>
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 text-xs ${insight.severity === 'high' ? 'text-red-500' : insight.severity === 'medium' ? 'text-amber-500' : 'text-emerald-500'}`}>
                            {insight.severity === 'high' ? '⚠' : insight.severity === 'medium' ? '◐' : '✓'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{insight.title}</div>
                            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{insight.description}</div>
                            {insight.metric && <div className="text-[0.6875rem] text-gray-400 mt-1.5 font-mono">{insight.metric}</div>}
                          </div>
                        </div>
                      </div>
                    ))
                ) : (
                  aiResult.insights.slice(0, 5).map((insight, i) => (
                    <div key={i} className={`rounded-xl border p-4 ${
                      insight.severity === 'high' ? 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20' :
                      insight.severity === 'medium' ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20' :
                      'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20'
                    }`}>
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 text-xs ${insight.severity === 'high' ? 'text-red-500' : insight.severity === 'medium' ? 'text-amber-500' : 'text-emerald-500'}`}>
                          {insight.severity === 'high' ? '⚠' : insight.severity === 'medium' ? '◐' : '✓'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{insight.title}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{insight.description}</div>
                          {insight.metric && <div className="text-[0.6875rem] text-gray-400 mt-1.5 font-mono">{insight.metric}</div>}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MODULE 4: LSA (滞后序列分析)
// ════════════════════════════════════════════════════════════════

const LsaModule: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [result, setResult] = useState<Awaited<ReturnType<typeof researchApi.lsa>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lag, setLag] = useState(1);
  const [codeField, setCodeField] = useState<'event_type' | 'object_type'>('event_type');

  const runLsa = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await researchApi.lsa(courseId, { lag, codeField });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'LSA failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <ModuleHeader title={zh ? '滞后序列分析 (LSA)' : 'Lag Sequential Analysis'} description={zh ? '分析事件序列中的行为转换模式与显著性' : 'Behavioral transition patterns and significance'} />

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs text-gray-500">
          {zh ? '滞后阶数' : 'Lag'}
          <select value={lag} onChange={e => setLag(Number(e.target.value))} className="ml-1.5 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-2 py-1 text-xs">
            {[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          {zh ? '编码字段' : 'Code Field'}
          <select value={codeField} onChange={e => setCodeField(e.target.value as typeof codeField)} className="ml-1.5 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-2 py-1 text-xs">
            <option value="event_type">{zh ? '事件类型' : 'Event Type'}</option>
            <option value="object_type">{zh ? '对象类型' : 'Object Type'}</option>
          </select>
        </label>
        <RunButton onClick={runLsa} loading={loading} zh={zh} />
      </div>

      {error && <ErrorBanner message={error} />}

      {result && (
        <>
          <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            <span>{zh ? '编码数' : 'Codes'}: <strong className="text-gray-900 dark:text-gray-100">{result.codes.length}</strong></span>
            <span>{zh ? '有效转换' : 'Transitions'}: <strong className="text-gray-900 dark:text-gray-100">{result.totalTransitions.toLocaleString()}</strong></span>
            {result.sessionCount !== undefined && (
              <span>{zh ? '会话段数' : 'Sessions'}: <strong className="text-gray-900 dark:text-gray-100">{result.sessionCount}</strong></span>
            )}
            {result.sessionGapMinutes !== undefined && (
              <span className="text-gray-400">{zh ? `（间隔 > ${result.sessionGapMinutes} 分钟视为新会话，跨会话转换已排除）` : `(gap > ${result.sessionGapMinutes}min starts a new session; cross-session transitions excluded)`}</span>
            )}
          </div>

          {/* Significant transitions table */}
          {result.significantTransitions && result.significantTransitions.length > 0 && (
            <ChartCard title={zh ? '显著转换序列（|z| ≥ 1.96, p < .05）' : 'Significant Transitions (|z| ≥ 1.96, p < .05)'} onDownloadCsv={() => {
              downloadCsv(result.significantTransitions as unknown as Record<string, unknown>[], 'lsa_significant_transitions.csv');
            }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800 text-left text-gray-400">
                      <th className="py-2 pr-3 font-medium">{zh ? '前项行为' : 'From'}</th>
                      <th className="py-2 pr-3 font-medium">{zh ? '后项行为' : 'To'}</th>
                      <th className="py-2 pr-3 font-medium text-right">{zh ? '观察值' : 'Observed'}</th>
                      <th className="py-2 pr-3 font-medium text-right">{zh ? '期望值' : 'Expected'}</th>
                      <th className="py-2 pr-3 font-medium text-right">Z</th>
                      <th className="py-2 pr-3 font-medium text-right">{zh ? '转移概率' : 'P(to|from)'}</th>
                      <th className="py-2 font-medium">{zh ? '方向' : 'Direction'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.significantTransitions.slice(0, 12).map((t, i) => (
                      <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50">
                        <td className="py-2 pr-3 font-medium text-gray-900 dark:text-gray-100">{t.from}</td>
                        <td className="py-2 pr-3 font-medium text-gray-900 dark:text-gray-100">{t.to}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{t.observed}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{t.expected}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${t.z > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{t.z}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{Math.round(t.prob * 100)}%</td>
                        <td className="py-2">
                          <span className={`rounded px-1.5 py-0.5 text-[0.6875rem] font-medium ${t.z > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                            {t.z > 0 ? (zh ? '促进' : 'Excitatory') : (zh ? '抑制' : 'Inhibitory')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          )}

          <ChartCard title={zh ? '转换频率热力图' : 'Transition Frequency Heatmap'} onDownloadCsv={() => {
            const rows = result.codes.map((code, i) => {
              const row: Record<string, unknown> = { from: code };
              result.codes.forEach((c, j) => { row[c] = result.transitionMatrix[i]?.[j] ?? 0; });
              return row;
            });
            downloadCsv(rows, 'lsa_frequency_matrix.csv');
          }}>
            <VizHeatmap labels={result.codes} matrix={result.transitionMatrix} type="frequency" />
          </ChartCard>

          <ChartCard title={zh ? 'Z 值热力图（|z| ≥ 1.96 显著）' : 'Z-Score Heatmap (|z| ≥ 1.96 significant)'} onDownloadCsv={() => {
            const rows = result.codes.map((code, i) => {
              const row: Record<string, unknown> = { from: code };
              result.codes.forEach((c, j) => { row[c] = result.zScoreMatrix[i]?.[j] ?? 0; });
              return row;
            });
            downloadCsv(rows, 'lsa_zscore_matrix.csv');
          }}>
            <VizHeatmap labels={result.codes} matrix={result.zScoreMatrix} type="zscore" />
          </ChartCard>

          <MethodNote zh={zh} textZh="方法说明：Z 值为调整残差（Allison & Liker, 1982），|z| ≥ 1.96 表示该转换在 p < .05 水平上显著偏离随机期望。序列已按 30 分钟无活动间隔切分为会话，跨会话转换不计入，符合 Bakeman & Gottman (1997) 的序列分析规范。" textEn="Method: Z-scores are adjusted residuals (Allison & Liker, 1982); |z| ≥ 1.96 indicates the transition deviates from chance at p < .05. Sequences are segmented into sessions at 30-min inactivity gaps and cross-session transitions are excluded, following Bakeman & Gottman (1997)." />

          {/* Advanced LSA */}
          <LsaAdvancedPanel courseId={courseId} zh={zh} />

          {/* Publication Charts */}
        </>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MODULE 5: Discourse Analysis (话语分析)
// ════════════════════════════════════════════════════════════════

const DiscourseModule: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof researchApi.discourse>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const relChartRef = useRef<SVGSVGElement>(null);
  const depthChartRef = useRef<SVGSVGElement>(null);
  const contentChartRef = useRef<SVGSVGElement>(null);

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await researchApi.discourse(courseId);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const relationLabels = RELATION_LABELS[zh ? 'zh' : 'en'];

  // Use the shared palette: this module had its own brighter map, so the same
  // relation type rendered in one colour on the canvas and another in research.
  const relationColors = RELATION_COLORS;

  return (
    <div className="space-y-4">
      <ModuleHeader title={zh ? '话语分析' : 'Discourse Analysis'} description={zh ? '分析知识建构话语类型分布、论述深度与认识论状态' : 'Relation types, discourse depth, and epistemic status'} />
      <RunButton onClick={run} loading={loading} zh={zh} />
      {error && <ErrorBanner message={error} />}

      {data && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: zh ? '笔记总数' : 'Notes', value: data.stats.totalNotes },
              { label: zh ? '关系总数' : 'Relations', value: data.stats.totalRelations },
              { label: zh ? 'Rise-above' : 'Rise-above', value: data.stats.riseAboveCount },
              { label: zh ? '提问占比' : 'Question %', value: `${data.stats.questionRelationPct}%` },
              { label: zh ? '质疑占比' : 'Challenge %', value: `${data.stats.challengeRelationPct}%` },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3 text-center">
                <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
                <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Relation Type Distribution */}
          <ChartCard title={zh ? '关系类型分布' : 'Relation Type Distribution'} onDownloadPng={() => downloadSvgAsPng(relChartRef.current, 'discourse_relations.png')} onDownloadCsv={() => downloadCsv(Object.entries(data.relationTypeDist).map(([type, count]) => ({ type, count })), 'discourse_relations.csv')}>
            <VizHorizontalBars
              ref={relChartRef}
              data={Object.entries(data.relationTypeDist).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({
                label: relationLabels[type] ?? type,
                value: count,
                color: relationColors[type],
              }))}
            />
          </ChartCard>

          {/* Chain Depth */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title={zh ? 'Build-on 链深度分布' : 'Build-on Chain Depth'} onDownloadPng={() => downloadSvgAsPng(depthChartRef.current, 'discourse_depth.png')} onDownloadCsv={() => downloadCsv(Object.entries(data.chainAnalysis.depthDistribution).map(([depth, count]) => ({ depth: Number(depth), count })), 'discourse_depth.csv')}>
              <div className="mb-2 flex gap-4 text-xs text-gray-500">
                <span>{zh ? '最大深度' : 'Max'}: <strong>{data.chainAnalysis.maxDepth}</strong></span>
                <span>{zh ? '平均深度' : 'Avg'}: <strong>{data.chainAnalysis.avgDepth}</strong></span>
              </div>
              <svg ref={depthChartRef} viewBox="0 0 400 120" className="w-full h-28">
                {(() => {
                  const entries = Object.entries(data.chainAnalysis.depthDistribution).map(([d, c]) => ({ depth: Number(d), count: c as number })).sort((a, b) => a.depth - b.depth);
                  const maxC = Math.max(...entries.map(e => e.count), 1);
                  return entries.map((e, i) => {
                    const barH = (e.count / maxC) * 80;
                    const x = i * 40 + 20;
                    return (
                      <g key={e.depth}>
                        <rect x={x} y={95 - barH} width={30} height={barH} rx={3} fill="rgba(0,0,128,0.5)" />
                        <text x={x + 15} y={110} textAnchor="middle" className="text-[0.5625rem] fill-gray-500">{e.depth}</text>
                        <text x={x + 15} y={90 - barH} textAnchor="middle" className="text-[0.5rem] fill-gray-400">{e.count}</text>
                      </g>
                    );
                  });
                })()}
              </svg>
            </ChartCard>

            <ChartCard title={zh ? '内容长度分布' : 'Content Length Distribution'} onDownloadPng={() => downloadSvgAsPng(contentChartRef.current, 'discourse_content_length.png')} onDownloadCsv={() => downloadCsv(data.contentAnalysis.lengthBuckets as unknown as Record<string, unknown>[], 'discourse_content_length.csv')}>
              <div className="mb-2 text-xs text-gray-500">{zh ? '平均字数' : 'Avg length'}: <strong>{data.contentAnalysis.avgContentLength}</strong></div>
              <svg ref={contentChartRef} viewBox="0 0 400 120" className="w-full h-28">
                {(() => {
                  const maxC = Math.max(...data.contentAnalysis.lengthBuckets.map(b => b.count), 1);
                  return data.contentAnalysis.lengthBuckets.map((b, i) => {
                    const barH = (b.count / maxC) * 80;
                    const x = i * 75 + 15;
                    return (
                      <g key={b.range}>
                        <rect x={x} y={90 - barH} width={60} height={barH} rx={4} fill="rgba(0,0,128,0.4)" />
                        <text x={x + 30} y={105} textAnchor="middle" className="text-[0.5rem] fill-gray-500">{b.range}</text>
                        <text x={x + 30} y={85 - barH} textAnchor="middle" className="text-[0.5rem] fill-gray-400">{b.count}</text>
                      </g>
                    );
                  });
                })()}
              </svg>
            </ChartCard>
          </div>

          {/* Epistemic Status */}
          <ChartCard title={zh ? '认识论状态分布' : 'Epistemic Status Distribution'} onDownloadCsv={() => downloadCsv(Object.entries(data.epistemicDist).map(([status, count]) => ({ status, count })), 'discourse_epistemic.csv')}>
            <div className="flex flex-wrap gap-3">
              {Object.entries(data.epistemicDist).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
                  <span className="text-xs text-gray-600 dark:text-gray-400">{status}</span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{count as number}</span>
                </div>
              ))}
            </div>
          </ChartCard>

          <MethodNote zh={zh} textZh="方法说明：Build-on 链深度从根笔记（未建构于任何现存笔记之上）开始计算，深度 n 表示经过 n 层 Build-on 到达；链深度越大，说明观点被持续深化的程度越高（Scardamalia & Bereiter 知识建构理论中的 idea improvement 指标）。提问/质疑占比反映社区批判性话语水平，健康的知识建构社区通常两者合计 ≥ 15%。" textEn="Method: Build-on chain depth starts from root notes (not building on any existing note); depth n means n build-on layers deep — an idea-improvement indicator in Knowledge Building theory (Scardamalia & Bereiter). Question/challenge shares reflect critical discourse; healthy KB communities typically total ≥ 15%." />

          {/* Advanced Discourse */}
          <DiscourseAdvancedPanel courseId={courseId} zh={zh} />

          {/* Publication Charts */}
        </>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MODULE 6: Participation Equity (参与公平性)
// ════════════════════════════════════════════════════════════════

const EquityModule: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof researchApi.equity>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const lorenzRef = useRef<SVGSVGElement>(null);
  const barRef = useRef<SVGSVGElement>(null);

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await researchApi.equity(courseId);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <ModuleHeader title={zh ? '参与公平性分析' : 'Participation Equity'} description={zh ? '评估社区成员贡献均衡程度，识别边缘化参与者' : 'Assess contribution balance and identify marginalized participants'} />
      <RunButton onClick={run} loading={loading} zh={zh} />
      {error && <ErrorBanner message={error} />}

      {data && (
        <>
          {/* Key metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: zh ? '基尼系数' : 'Gini Coefficient', value: data.gini.toFixed(4), color: data.gini > 0.4 ? 'text-red-600' : data.gini > 0.25 ? 'text-amber-600' : 'text-green-600' },
              { label: zh ? '活跃参与者' : 'Active', value: `${data.stats.activeParticipants}/${data.stats.totalParticipants}` },
              { label: zh ? '沉默学生' : 'Silent', value: data.stats.silentCount },
              { label: zh ? '互动覆盖率' : 'Coverage', value: `${(data.interactionCoverage * 100).toFixed(1)}%` },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3 text-center">
                <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
                <div className={`mt-1 text-lg font-semibold ${('color' in s && s.color) || 'text-gray-900 dark:text-gray-100'}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Lorenz Curve */}
          <ChartCard title={zh ? '洛伦兹曲线（参与不平等度）' : 'Lorenz Curve (Inequality)'} onDownloadPng={() => downloadSvgAsPng(lorenzRef.current, 'equity_lorenz.png')} onDownloadCsv={() => downloadCsv(data.lorenz as unknown as Record<string, unknown>[], 'equity_lorenz.csv')}>
            <VizLorenz
              ref={lorenzRef}
              data={data.lorenz}
              gini={data.gini}
              interpretation={data.gini > 0.4 ? (zh ? '高度不平等' : 'High inequality') : data.gini > 0.25 ? (zh ? '中度不平等' : 'Moderate inequality') : (zh ? '相对公平' : 'Relatively equitable')}
            />
          </ChartCard>

          {/* Contribution bar chart */}
          <ChartCard title={zh ? '个人贡献排名' : 'Individual Contribution Ranking'} onDownloadPng={() => downloadSvgAsPng(barRef.current, 'equity_contributions.png')} onDownloadCsv={() => downloadCsv(data.rankings.map(r => ({ id: r.authorId, notes: r.notes, relations: r.relations, received: r.received, total: r.total })), 'equity_rankings.csv')}>
            <VizHorizontalBars
              ref={barRef}
              data={data.rankings.slice(0, 25).map(r => ({
                label: r.authorId.slice(0, 6),
                value: r.total,
                color: r.total < data.stats.meanContribution * 0.5 ? '#ef4444' : undefined,
              }))}
            />
          </ChartCard>

          {/* Silent students */}
          {data.silentStudents.length > 0 && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-4">
              <h4 className="text-sm font-medium text-red-800 dark:text-red-300">
                {zh ? `${data.silentStudents.length} 名沉默学生（低于平均 50%）` : `${data.silentStudents.length} silent student(s) (below 50% of mean)`}
              </h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.silentStudents.map(s => (
                  <span key={s.authorId} className="rounded-full bg-red-100 dark:bg-red-900/30 px-2.5 py-0.5 text-xs text-red-700 dark:text-red-300 font-mono">
                    {s.authorId.slice(0, 8)} ({s.totalContributions})
                  </span>
                ))}
              </div>
            </div>
          )}

          <MethodNote zh={zh} textZh="方法说明：贡献量 = 笔记数 + 发起的关系数；计算范围仅含学生（教师账号已排除），未发帖的注册学生计为 0 并纳入统计。Gini 系数 0 表示完全均等、1 表示完全集中，通常 > 0.4 视为参与高度不均。互动覆盖率 = 实际发生互动的学生对 / 全部可能学生对。" textEn="Method: Contribution = notes + initiated relations; instructors are excluded and enrolled students with zero posts are counted as 0. Gini = 0 means perfect equality, 1 means total concentration (> 0.4 is typically read as highly unequal). Interaction coverage = realized student pairs / all possible student pairs." />

          {/* Advanced Equity */}
          <EquityAdvancedPanel courseId={courseId} zh={zh} />

          {/* Publication Charts */}
        </>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MODULE 7: AI Insights (AI 智能建议)
// ════════════════════════════════════════════════════════════════

const AiInsightsModule: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof researchApi.aiInsights>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await researchApi.aiInsights(courseId);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const severityConfig = {
    high: { border: 'border-red-200 dark:border-red-800', bg: 'bg-red-50 dark:bg-red-950/20', text: 'text-red-800 dark:text-red-300', badge: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
    medium: { border: 'border-amber-200 dark:border-amber-800', bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-800 dark:text-amber-300', badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
    low: { border: 'border-blue-200 dark:border-blue-800', bg: 'bg-blue-50 dark:bg-blue-950/20', text: 'text-blue-800 dark:text-blue-300', badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  };

  const typeLabels: Record<string, string> = zh
    ? { participation: '参与度', discourse: '话语质量', equity: '公平性', ai_effectiveness: 'AI效果', trend: '趋势', knowledge_building: '知识建构' }
    : { participation: 'Participation', discourse: 'Discourse', equity: 'Equity', ai_effectiveness: 'AI', trend: 'Trend', knowledge_building: 'KB' };

  return (
    <div className="space-y-4">
      <ModuleHeader title={zh ? 'AI 智能建议' : 'AI-Powered Insights'} description={zh ? '基于数据模式自动生成教师干预建议' : 'Data-driven suggestions for teacher interventions'} />
      <RunButton onClick={run} loading={loading} label={zh ? '生成建议' : 'Generate Insights'} zh={zh} />
      {error && <ErrorBanner message={error} />}

      {data && (
        <>
          {/* Data snapshot */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span>{zh ? '笔记' : 'Notes'}: {data.dataSnapshot.totalNotes}</span>
            <span>{zh ? '关系' : 'Relations'}: {data.dataSnapshot.totalRelations}</span>
            <span>{zh ? '事件' : 'Events'}: {data.dataSnapshot.totalEvents}</span>
            <span>{zh ? '参与者' : 'Authors'}: {data.dataSnapshot.uniqueAuthors}</span>
            <span className="ml-auto">{zh ? '生成于' : 'Generated'}: {new Date(data.generatedAt).toLocaleString()}</span>
          </div>

          {/* Insights list */}
          {data.insights.length === 0 ? (
            <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-6 text-center">
              <RemixIcon name="check-double-line" size={24} className="mx-auto text-green-600 dark:text-green-400" />
              <p className="mt-2 text-sm text-green-700 dark:text-green-300">{zh ? '一切正常，暂无需要关注的问题' : 'All clear — no issues detected'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.insights.map((insight, i) => {
                const cfg = severityConfig[insight.severity];
                return (
                  <div key={i} className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4`}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${cfg.badge}`}>
                            {typeLabels[insight.type] ?? insight.type}
                          </span>
                          {insight.metric && (
                            <span className="text-xs font-mono text-gray-500">{insight.metric}</span>
                          )}
                        </div>
                        <h4 className={`text-sm font-medium ${cfg.text}`}>{insight.title}</h4>
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{insight.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MODULE 8: Data Export (数据导出)
// ════════════════════════════════════════════════════════════════



type ExportOptions = Awaited<ReturnType<typeof researchApi.exportOptions>>;
type ExportTable = Awaited<ReturnType<typeof researchApi.exportTable>>;

const COLUMN_GROUPS: { key: ExportColumnGroup; zh: string; en: string }[] = [
  { key: 'identity', zh: '身份', en: 'Identity' },
  { key: 'content', zh: '内容', en: 'Content' },
  { key: 'structure', zh: '结构关系', en: 'Structure' },
  { key: 'ai', zh: 'AI', en: 'AI' },
  { key: 'scaffold', zh: '脚手架', en: 'Scaffold' },
  { key: 'layer', zh: '内容分层', en: 'Content layers' },
  { key: 'location', zh: '位置', en: 'Location' },
  { key: 'time', zh: '时间', en: 'Time' },
  { key: 'meta', zh: '技术ID', en: 'Technical IDs' },
];

// Column groups that stay off until asked for — raw UUIDs only add noise.
const DEFAULT_OFF: ExportColumnGroup[] = ['meta'];

const ExportModule: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [table, setTable] = useState<ExportTable | null>(null);
  const [loadingTable, setLoadingTable] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [error, setError] = useState('');

  // Course English name (required before participant codes can be issued)
  const [englishName, setEnglishName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [dataset, setDataset] = useState<ExportDatasetKey>('notes');
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  /** 按人导出（2026-10-09）：空 = 全部参与者 */
  const [personId, setPersonId] = useState('');
  const [viewId, setViewId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeAi, setIncludeAi] = useState(true);
  const [includeSuppressed, setIncludeSuppressed] = useState(true);
  const [includeDeleted, setIncludeDeleted] = useState(true);
  const [includeNames, setIncludeNames] = useState(false);
  const [headerLang, setHeaderLang] = useState<'zh' | 'en'>(zh ? 'zh' : 'en');
  const [offGroups, setOffGroups] = useState<ExportColumnGroup[]>(DEFAULT_OFF);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [multiSelect, setMultiSelect] = useState<ExportDatasetKey[]>([]);

  useEffect(() => {
    setOptions(null);
    setTable(null);
    setSpaceIds([]);
    setGroupIds([]);
    setPersonId('');
    setViewId('');
    setEnglishName('');
    researchApi.exportOptions(courseId)
      .then(res => { setOptions(res); setEnglishName(res.course.englishName ?? ''); })
      .catch(() => setError(zh ? '无法加载导出选项' : 'Failed to load export options'));
  }, [courseId, zh]);

  const filters: ExportFilterPayload = useMemo(() => ({
    space_ids: spaceIds.length ? spaceIds : undefined,
    group_ids: groupIds.length ? groupIds : undefined,
    view_id: viewId || undefined,
    from: from || undefined,
    to: to ? `${to}T23:59:59.999Z` : undefined,
    include_ai_generated: includeAi,
    include_suppressed: includeSuppressed,
    include_deleted: includeDeleted,
    include_names: includeNames,
    participant_id: personId || undefined,
  }), [spaceIds, groupIds, viewId, from, to, includeAi, includeSuppressed, includeDeleted, includeNames, personId]);

  const hasEnglishName = !!options?.course.englishName;

  // The on-screen table is the source of truth for what gets exported.
  useEffect(() => {
    if (!options || !hasEnglishName) return;
    let cancelled = false;
    setLoadingTable(true);
    const timer = setTimeout(() => {
      researchApi.exportTable(courseId, { ...filters, datasets: [dataset], limit: 100 })
        .then(res => { if (!cancelled) { setTable(res); setError(''); setExpandedRow(null); } })
        .catch(() => { if (!cancelled) setError(zh ? '加载数据失败' : 'Failed to load data'); })
        .finally(() => { if (!cancelled) setLoadingTable(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [courseId, dataset, filters, options, hasEnglishName, zh]);

  const datasetMeta = options?.datasets.find(d => d.key === dataset);
  const visibleColumns = useMemo(() => {
    if (!datasetMeta) return [];
    return datasetMeta.columns.filter(c =>
      (!c.sensitive || includeNames) && !offGroups.includes(c.group));
  }, [datasetMeta, includeNames, offGroups]);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  const people = options?.people ?? [];
  const selectedPerson = people.find(p => p.userId === personId) ?? null;
  /** 一个人的全部数据：除了全班层面的表（课次记录）都要 */
  const personDatasets = useMemo(
    () => (options?.datasets ?? []).map(d => d.key).filter(k => !(options?.notPerPerson ?? ['sessions']).includes(k)),
    [options],
  );

  const saveEnglishName = async () => {
    if (englishName.trim().length < 2) return;
    setSavingName(true);
    setError('');
    try {
      const res = await researchApi.setCourseEnglishName(courseId, { english_name: englishName.trim() });
      const refreshed = await researchApi.exportOptions(courseId);
      setOptions(refreshed);
      setError('');
      window.alert(zh
        ? `编号已生成，示例：${res.sample.join('、')}`
        : `Codes generated, e.g. ${res.sample.join(', ')}`);
    } catch {
      setError(zh ? '保存英文名称失败' : 'Failed to save English name');
    } finally {
      setSavingName(false);
    }
  };

  const download = async (datasets: ExportDatasetKey[]) => {
    setDownloading(datasets.length === 1 ? datasets[0] : 'bundle');
    setError('');
    try {
      const blob = await researchApi.exportDownload(courseId, {
        ...filters,
        datasets,
        header_lang: headerLang,
        columns: datasets.length === 1 ? visibleColumns.map(c => c.key) : undefined,
      });
      const abbr = selectedPerson?.code ?? options?.course.abbr ?? 'course';
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = datasets.length === 1
        ? `${abbr}_${datasets[0]}_${stamp}.csv`
        : `${abbr}_export_${stamp}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(zh ? '导出失败，请重试' : 'Export failed, please retry');
    } finally {
      setDownloading('');
    }
  };

  if (!options) {
    return (
      <div className="space-y-4">
        <ModuleHeader title={zh ? '研究数据导出' : 'Research Data Export'} description={zh ? '先在网页上看清数据，再导出你需要的部分' : 'See the data first, then export exactly what you need'} />
        {error ? <div className="text-sm text-red-600">{error}</div> : <LoadingState zh={zh} />}
      </div>
    );
  }

  // Gate: participant codes need the course's English name.
  if (!hasEnglishName) {
    return (
      <div className="space-y-4">
        <ModuleHeader title={zh ? '研究数据导出' : 'Research Data Export'} description={zh ? '先为课程设置英文名称，用于生成参与者编号' : 'Set the course English name to generate participant codes'} />
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-6 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <RemixIcon name="information-line" size={16} />
            <span className="text-sm font-medium">{zh ? '需要课程英文名称' : 'Course English name required'}</span>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            {zh
              ? '参与者编号由「S/T + 课程英文缩写 + 序号」组成，例如 STPKB01。请填写课程英文名称，系统会自动生成缩写并为每位成员分配固定编号（序号随机，一经分配不再变化）。'
              : 'Participant codes are S/T + course abbreviation + number, e.g. STPKB01. Enter the English course name; the abbreviation is derived automatically and each member gets a permanent random number.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={englishName}
              onChange={e => setEnglishName(e.target.value)}
              placeholder={zh ? '例如：Theory and Practice of Knowledge Building' : 'e.g. Theory and Practice of Knowledge Building'}
              className="min-w-[320px] flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950"
            />
            <button
              onClick={saveEnglishName}
              disabled={savingName || englishName.trim().length < 2}
              className="rounded-lg bg-[#000080] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-50"
            >
              {savingName ? (zh ? '生成中…' : 'Generating…') : (zh ? '保存并生成编号' : 'Save & generate codes')}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ModuleHeader
        title={zh ? '研究数据导出' : 'Research Data Export'}
        description={zh
          ? `课程编号前缀 ${options.course.abbr}（学生 S${options.course.abbr}01…，教师 T${options.course.abbr}01…）。下方看到的表格就是导出的内容。`
          : `Code prefix ${options.course.abbr}. What you see below is exactly what gets exported.`}
      />

      {/* Analysis unit */}
      <div className="flex flex-wrap gap-1.5">
        {options.datasets.map(d => (
          <button
            key={d.key}
            onClick={() => setDataset(d.key)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              dataset === d.key
                ? 'border-[#000080]/40 bg-[#000080]/[0.05] dark:border-[#4169E1]/50 dark:bg-[#4169E1]/[0.1]'
                : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900'
            }`}
          >
            <span className={`block text-xs font-medium ${dataset === d.key ? 'text-[#000080] dark:text-[#93AAFD]' : 'text-gray-700 dark:text-gray-300'}`}>
              {zh ? d.zh : d.en}
            </span>
            <span className="mt-0.5 block font-mono text-[0.6875rem] text-gray-400">
              {table?.counts?.[d.key] ?? '—'}
            </span>
          </button>
        ))}
      </div>

      {datasetMeta && (
        <p className="-mt-2 text-xs text-gray-500 dark:text-gray-400">{zh ? datasetMeta.descZh : datasetMeta.descEn}</p>
      )}

      {/* Filters */}
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <FilterRow label={zh ? '知识空间' : 'Spaces'} hint={zh ? '不选 = 全部' : 'none = all'}>
          {options.spaces.length === 0 && <span className="text-xs text-gray-400">{zh ? '暂无空间' : 'No spaces'}</span>}
          {options.spaces.map(s => (
            <Chip key={s.id} active={spaceIds.includes(s.id)} onClick={() => setSpaceIds(prev => toggle(prev, s.id))}>
              {s.title}{s.groupId && <span className="ml-1 opacity-60">· {zh ? '组' : 'grp'}</span>}
            </Chip>
          ))}
        </FilterRow>

        <FilterRow label={zh ? '小组' : 'Groups'} hint={zh ? '按成员归属筛选' : 'by membership'}>
          {options.groups.length === 0 && <span className="text-xs text-gray-400">{zh ? '本课程尚未分组' : 'No groups yet'}</span>}
          {options.groups.map(g => (
            <Chip key={g.id} active={groupIds.includes(g.id)} onClick={() => setGroupIds(prev => toggle(prev, g.id))}>
              {g.name}<span className="ml-1 opacity-60">({g.memberCount})</span>
              {g.condition && (
                <span className={`ml-1.5 rounded-full px-1.5 text-[0.6875rem] ${g.condition === 'treatment' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                  {g.condition === 'treatment' ? (zh ? '实验' : 'T') : (zh ? '对照' : 'C')}
                </span>
              )}
            </Chip>
          ))}
        </FilterRow>

        {people.length > 0 && (
          <FilterRow label={zh ? '参与者' : 'Participant'} hint={zh ? '不选 = 全部；可只导出一个人' : 'none = everyone'}>
            <select
              value={personId}
              onChange={e => setPersonId(e.target.value)}
              aria-label={zh ? '只导出一个人的数据' : 'Export one participant only'}
              className="min-w-[14rem] rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-gray-800 dark:bg-gray-950"
            >
              <option value="">{zh ? '全部参与者' : 'Everyone'}</option>
              {people.map(p => (
                <option key={p.userId} value={p.userId}>
                  {[p.code, p.name, p.groupName ?? (p.role === 'teacher' ? (zh ? '教师' : 'Teacher') : '')].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
            {selectedPerson && (
              <button
                type="button"
                onClick={() => download(personDatasets)}
                disabled={!!downloading}
                className="flex items-center gap-1.5 rounded-lg bg-[#000080] px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-50"
              >
                {downloading === 'bundle'
                  ? <><RemixIcon name="loader-4-line" size={13} className="animate-spin" />{zh ? '打包中…' : 'Packaging…'}</>
                  : <><RemixIcon name="folder-user-line" size={13} />{zh ? `导出 ${selectedPerson.code} 的全部数据 (ZIP)` : `Export all of ${selectedPerson.code} (ZIP)`}</>}
              </button>
            )}
            {selectedPerson && (
              <p className="w-full text-[0.6875rem] leading-relaxed text-gray-500 dark:text-gray-400">
                {zh
                  ? '每张表只留和这个人有关的行：Ta 的笔记；Ta 发起和接收的互动（同学在 Ta 的笔记上 Build-on 也算）；Ta 发的消息、Ta 和 AI 对话里 AI 的回复、同学私聊 Ta 的消息；Ta 收到的 AI 反馈；Ta 的操作记录和求助。课次记录是全班的，不含。上面的空间、时间等筛选照样有效。'
                  : 'Each table keeps only the rows involving this person: their notes, interactions they started or received, their messages and the AI replies to them, AI feedback they received, their events and help requests. Class sessions are course-wide and left out. The other filters still apply.'}
              </p>
            )}
          </FilterRow>
        )}

        <FilterRow label="View" hint={zh ? '按画布视图筛选' : 'by canvas view'}>
          <Chip active={!viewId} onClick={() => setViewId('')}>{zh ? '全部' : 'All'}</Chip>
          {options.views.map(v => (
            <Chip key={v.id} active={viewId === v.id} onClick={() => setViewId(v.id)}>
              {v.id}<span className="ml-1 opacity-60">({v.noteCount})</span>
            </Chip>
          ))}
        </FilterRow>

        <FilterRow label={zh ? '时间范围' : 'Date range'} hint={options.dateRange.earliest ? `${options.dateRange.earliest.slice(0, 10)} ~ ${options.dateRange.latest?.slice(0, 10)}` : ''}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-gray-800 dark:bg-gray-950" />
          <span className="text-xs text-gray-400">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-gray-800 dark:bg-gray-950" />
          {(from || to) && (
            <button onClick={() => { setFrom(''); setTo(''); }} className="text-xs text-gray-400 hover:text-gray-600">{zh ? '清除' : 'Clear'}</button>
          )}
        </FilterRow>

        <FilterRow label={zh ? '包含' : 'Include'} hint="">
          <Chip active={includeAi} onClick={() => setIncludeAi(v => !v)}>{zh ? 'AI 生成笔记' : 'AI notes'}</Chip>
          <Chip active={includeDeleted} onClick={() => setIncludeDeleted(v => !v)}>{zh ? '已删除笔记' : 'Deleted notes'}</Chip>
          <Chip active={includeSuppressed} onClick={() => setIncludeSuppressed(v => !v)}>{zh ? '对照组影子记录' : 'Shadow logs'}</Chip>
          <Chip active={includeNames} onClick={() => setIncludeNames(v => !v)}>
            {zh ? '真实姓名' : 'Real names'}
          </Chip>
        </FilterRow>

        <FilterRow label={zh ? '显示列' : 'Columns'} hint={zh ? '关掉不需要的整组' : 'toggle groups off'}>
          {COLUMN_GROUPS.filter(g => datasetMeta?.columns.some(c => c.group === g.key)).map(g => (
            <Chip key={g.key} active={!offGroups.includes(g.key)} onClick={() => setOffGroups(prev => toggle(prev, g.key))}>
              {zh ? g.zh : g.en}
            </Chip>
          ))}
          <span className="ml-2 text-[0.6875rem] text-gray-400">
            {zh ? `共 ${visibleColumns.length} 列` : `${visibleColumns.length} columns`}
          </span>
        </FilterRow>
      </div>

      {includeNames && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          <RemixIcon name="shield-keyhole-line" size={13} className="mt-0.5 flex-shrink-0" />
          <span>
            {zh
              ? '当前包含真实姓名。含姓名的文件相当于身份对照密钥，请单独存放，不要与分析数据一并转交他人。'
              : 'Real names are included. Such a file is the re-identification key — store it separately from analysis data.'}
          </span>
        </div>
      )}

      {/* Data table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <RemixIcon name={loadingTable ? 'loader-4-line' : 'table-line'} size={15} className={loadingTable ? 'animate-spin' : ''} />
            <span className="font-medium">{datasetMeta ? (zh ? datasetMeta.zh : datasetMeta.en) : ''}</span>
            <span className="text-xs text-gray-400">
              {table ? (zh ? `共 ${table.total} 行，预览前 ${table.rows.length} 行` : `${table.total} rows, showing ${table.rows.length}`) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={headerLang}
              onChange={e => setHeaderLang(e.target.value as 'zh' | 'en')}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-800 dark:bg-gray-950"
            >
              <option value="zh">{zh ? '中文表头' : 'Chinese headers'}</option>
              <option value="en">{zh ? '英文表头' : 'English headers'}</option>
            </select>
            <button
              onClick={() => download([dataset])}
              disabled={!!downloading || !table || table.total === 0}
              className="flex items-center gap-1.5 rounded-lg bg-[#000080] px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-50"
            >
              {downloading === dataset
                ? <><RemixIcon name="loader-4-line" size={13} className="animate-spin" />{zh ? '导出中…' : 'Exporting…'}</>
                : <><RemixIcon name="download-2-line" size={13} />{zh ? '导出这张表 (CSV)' : 'Export this table (CSV)'}</>}
            </button>
          </div>
        </div>

        {table && table.rows.length > 0 ? (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full border-collapse text-[0.6875rem]">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900">
                <tr>
                  {visibleColumns.map(col => (
                    <th key={col.key} className="whitespace-nowrap border-b border-gray-200 px-2.5 py-2 text-left font-medium text-gray-600 dark:border-gray-800 dark:text-gray-400">
                      {headerLang === 'zh' ? col.zh : col.en}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                    className={`cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-gray-900 dark:hover:bg-gray-900/60 ${expandedRow === i ? 'bg-gray-50 dark:bg-gray-900/60' : ''}`}
                  >
                    {visibleColumns.map(col => {
                      const value = row[col.key];
                      const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
                      return (
                        <td
                          key={col.key}
                          className={`px-2.5 py-1.5 align-top text-gray-700 dark:text-gray-300 ${expandedRow === i ? 'whitespace-pre-wrap' : 'max-w-[18rem] truncate whitespace-nowrap'}`}
                          title={expandedRow === i ? undefined : text}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-gray-400">
            {loadingTable ? (zh ? '加载中…' : 'Loading…') : (zh ? '当前筛选没有数据' : 'No data for these filters')}
          </div>
        )}

        {table && table.rows.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-2 text-[0.6875rem] text-gray-400 dark:border-gray-900">
            {zh ? '点击任意一行可展开查看完整内容' : 'Click a row to expand full content'}
          </div>
        )}
      </div>

      {/* Warnings */}
      {table && (table.warnings.length > 0 || table.truncated.length > 0 || error) && (
        <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-[0.6875rem] leading-relaxed text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          {table.warnings.map((w, i) => <div key={i}>· {w}</div>)}
          {table.truncated.length > 0 && (
            <div>· {zh ? `以下表达到上限被截断：${table.truncated.join('、')}，请缩小时间范围` : `Truncated: ${table.truncated.join(', ')}`}</div>
          )}
          {error && <div className="text-red-600 dark:text-red-400">· {error}</div>}
        </div>
      )}

      {/* Multi-table bundle */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          {zh ? '一次导出多张表' : 'Export several tables at once'}
        </div>
        <p className="mb-3 text-[0.6875rem] text-gray-500 dark:text-gray-400">
          {zh ? '勾选多张表会打包成 ZIP，并附一份说明文件；只需要一张表时直接用上方的按钮即可。' : 'Selecting several tables produces a ZIP with a README. For a single table use the button above.'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {options.datasets.map(d => (
            <Chip key={d.key} active={multiSelect.includes(d.key)} onClick={() => setMultiSelect(prev => toggle(prev, d.key))}>
              {zh ? d.zh : d.en}
            </Chip>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setMultiSelect(['participants', 'notes', 'interactions'])}
            className="text-[0.6875rem] text-[#000080] hover:underline dark:text-[#93AAFD]"
          >
            {zh ? '核心三表' : 'Core three'}
          </button>
          <span className="text-gray-300">·</span>
          <button
            onClick={() => setMultiSelect(options.datasets.map(d => d.key))}
            className="text-[0.6875rem] text-[#000080] hover:underline dark:text-[#93AAFD]"
          >
            {zh ? '全选' : 'All'}
          </button>
          <div className="flex-1" />
          <button
            onClick={() => download(multiSelect)}
            disabled={!!downloading || multiSelect.length < 2}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
          >
            {downloading === 'bundle'
              ? <><RemixIcon name="loader-4-line" size={13} className="animate-spin" />{zh ? '打包中…' : 'Packaging…'}</>
              : <><RemixIcon name="folder-zip-line" size={13} />{zh ? `导出 ${multiSelect.length} 张表 (ZIP)` : `Export ${multiSelect.length} tables (ZIP)`}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

const FilterRow: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
    <div className="w-full shrink-0 sm:w-28 sm:pt-1">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</div>
      {hint && <div className="mt-0.5 text-[0.6875rem] leading-tight text-gray-400">{hint}</div>}
    </div>
    <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
  </div>
);

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors ${
      active
        ? 'border-[#000080]/40 bg-[#000080]/[0.06] text-[#000080] dark:border-[#4169E1]/50 dark:bg-[#4169E1]/[0.12] dark:text-[#93AAFD]'
        : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400'
    }`}
  >
    {children}
  </button>
);


// ════════════════════════════════════════════════════════════════
// Shared Components
// ════════════════════════════════════════════════════════════════

const MethodNote: React.FC<{ zh: boolean; textZh: string; textEn: string }> = ({ zh, textZh, textEn }) => (
  <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/40">
    <RemixIcon name="book-2-line" size={13} className="mt-0.5 flex-shrink-0 text-gray-400" />
    <p className="text-[0.6875rem] leading-relaxed text-gray-500 dark:text-gray-400">{zh ? textZh : textEn}</p>
  </div>
);

const ModuleHeader: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div>
    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</p>
  </div>
);

const LoadingState: React.FC<{ zh: boolean }> = ({ zh }) => (
  <div className="py-10 text-center text-sm text-gray-500">{zh ? '加载中...' : 'Loading...'}</div>
);

const EmptyState: React.FC<{ zh: boolean }> = ({ zh }) => (
  <div className="py-10 text-center text-sm text-gray-500">{zh ? '暂无数据' : 'No data available'}</div>
);

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
  <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">{message}</div>
);

const RunButton: React.FC<{ onClick: () => void; loading: boolean; zh: boolean; label?: string }> = ({ onClick, loading, zh, label }) => (
  <button
    onClick={onClick}
    disabled={loading}
    className="flex items-center gap-1.5 rounded-lg bg-[#000080] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#000060] disabled:opacity-50"
  >
    <RemixIcon name={loading ? 'loader-4-line' : 'play-line'} size={14} className={loading ? 'animate-spin' : ''} />
    {loading ? (zh ? '分析中...' : 'Analyzing...') : (label ?? (zh ? '运行分析' : 'Run Analysis'))}
  </button>
);



// ── Adjacency Heatmap ──────────────────────────────────
const AdjacencyHeatmap: React.FC<{ nodes: { id: string }[]; edges: { source: string; target: string; weight: number }[]; svgRef?: React.RefObject<SVGSVGElement | null> }> = ({ nodes, edges, svgRef }) => {
  const nodeIds = nodes.map(n => n.id);
  const n = nodeIds.length;
  if (n === 0) return null;
  const maxSize = Math.min(n, 20);
  const displayIds = nodeIds.slice(0, maxSize);

  const weightMap = new Map<string, number>();
  let maxWeight = 1;
  for (const e of edges) {
    weightMap.set(`${e.source}|${e.target}`, e.weight);
    if (e.weight > maxWeight) maxWeight = e.weight;
  }

  const cellSize = Math.max(16, Math.min(28, Math.floor(500 / maxSize)));
  const totalSize = cellSize * maxSize + cellSize * 3;

  return (
    <div className="overflow-x-auto">
      <svg ref={svgRef} viewBox={`0 0 ${totalSize} ${totalSize}`} width={totalSize} height={totalSize}>
        {displayIds.map((rowId, ri) => (
          <g key={rowId}>
            <text x={cellSize * 2.5 - 4} y={ri * cellSize + cellSize * 1.5 + cellSize / 2 + 3} textAnchor="end" className="text-[0.4375rem] fill-gray-400 font-mono">{rowId.slice(0, 5)}</text>
            {displayIds.map((colId, ci) => {
              const w = weightMap.get(`${rowId}|${colId}`) ?? 0;
              const intensity = w / maxWeight;
              return (
                <rect
                  key={colId}
                  x={ci * cellSize + cellSize * 3}
                  y={ri * cellSize + cellSize * 1.5}
                  width={cellSize - 1}
                  height={cellSize - 1}
                  rx={2}
                  fill={w > 0 ? `rgba(0, 0, 128, ${0.15 + intensity * 0.7})` : '#f3f4f6'}
                >
                  <title>{`${rowId.slice(0, 5)} → ${colId.slice(0, 5)}: ${w}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
      {n > maxSize && <p className="mt-2 text-xs text-gray-400">{`Showing ${maxSize} of ${n} nodes`}</p>}
    </div>
  );
};

// ── Transition Matrix Table ──────────────────────────────────

export default ResearchZone;
