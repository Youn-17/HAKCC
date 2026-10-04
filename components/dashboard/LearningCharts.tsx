import React, { useEffect, useState } from 'react';
import { type Language } from '../../types';
import RemixIcon from '../RemixIcon';
import { activityPulse, type ActivityPulse } from '../../services/apiClient';

/**
 * 概览三张图的数据来源。
 *
 * 这三张图曾经用组件里写死的默认值 —— 所有课、所有人看到的都是同一组数字。
 * 在一个用来做研究的平台上，编出来的分析图比空图更糟：它会让人以为
 * 自己在看学情。现在全部现算，没有数据就明说没有数据。
 */
export function useActivityPulse(courseId?: string) {
  const [pulse, setPulse] = useState<ActivityPulse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    activityPulse(courseId)
      .then(r => { if (alive) setPulse(r.pulse); })
      .catch(() => { if (alive) setPulse(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [courseId]);

  return { pulse, loading };
}

/** 三张图共用的空态。骨架屏在加载，加载完没数据就说清楚。 */
const ChartEmpty: React.FC<{ lang: Language; loading: boolean; hint?: string }> = ({ lang, loading, hint }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
    {loading ? (
      <div className="h-20 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
    ) : (
      <>
        <RemixIcon name="bar-chart-line" size={20} className="text-gray-300 dark:text-gray-600" />
        <p className="text-[0.6875rem] leading-5 text-gray-400 dark:text-gray-500">
          {hint ?? (lang === 'zh' ? '还没有数据' : 'No data yet')}
        </p>
      </>
    )}
  </div>
);

// --- Sparkline KPI Card ---
interface KpiCardProps {
  label: string;
  value: number | string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  sparkData?: number[];
}

const Sparkline: React.FC<{ data: number[]; color?: string; height?: number }> = ({ data, color = '#000080', height = 28 }) => {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 100;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const fillPoints = `${points} ${w},${height} 0,${height}`;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={`spark-fill-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={fillPoints} fill={`url(#spark-fill-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export const SparklineKpiCard: React.FC<KpiCardProps> = ({ label, value, change, trend = 'neutral', sparkData }) => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4">
    <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400 mb-2">{label}</div>
    <div className="text-[1.625rem] font-bold tracking-tight text-gray-900 dark:text-gray-100 leading-none">{value}</div>
    {change && (
      <div className={`text-[0.6875rem] mt-1.5 flex items-center gap-1 ${
        trend === 'up' ? 'text-emerald-600 dark:text-emerald-400' :
        trend === 'down' ? 'text-red-600 dark:text-red-400' :
        'text-gray-500 dark:text-gray-400'
      }`}>
        {trend === 'up' && '↑'}{trend === 'down' && '↓'} {change}
      </div>
    )}
    {sparkData && sparkData.length > 1 && (
      <div className="mt-2">
        <Sparkline data={sparkData} color={trend === 'down' ? '#dc2626' : '#000080'} />
      </div>
    )}
  </div>
);

// --- Weekly Activity Bar Chart ---
interface WeeklyActivityProps {
  lang: Language;
  pulse: ActivityPulse | null;
  loading?: boolean;
}

export const WeeklyActivityChart: React.FC<WeeklyActivityProps> = ({ lang, pulse, loading = false }) => {
  const zh = lang === 'zh';
  const weeks = pulse?.weeks ?? [];
  const total = weeks.reduce((s, w) => s + w.notes + w.aiInteractions, 0);
  const maxVal = Math.max(1, ...weeks.map(w => Math.max(w.notes, w.aiInteractions)));

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-5 h-full flex flex-col">
      <div className="mb-4">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {zh ? '学习活动趋势' : 'Weekly Learning Activity'}
        </div>
        <div className="text-[0.6875rem] text-gray-500 dark:text-gray-400 mt-0.5">
          {zh ? '最近 8 周 · 笔记创建 vs AI 介入' : 'Last 8 weeks · notes created vs AI interventions'}
        </div>
      </div>

      {total === 0 ? (
        <ChartEmpty lang={lang} loading={loading}
          hint={zh ? '这段时间还没有笔记或 AI 活动' : 'No notes or AI activity in this window'} />
      ) : (
        <>
          <div className="flex items-end gap-2 flex-1 min-h-[120px]">
            {weeks.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end"
                title={`${w.label}: ${w.notes} ${zh ? '条笔记' : 'notes'}, ${w.aiInteractions} ${zh ? '次 AI 介入' : 'AI'}`}>
                <div className="w-full max-w-[28px] rounded-t bg-[#000080] dark:bg-[#4169E1] transition-all"
                  style={{ height: `${(w.notes / maxVal) * 100}%` }} />
                <div className="w-full max-w-[28px] rounded-t bg-[#000080]/20 dark:bg-[#4169E1]/25 transition-all"
                  style={{ height: `${(w.aiInteractions / maxVal) * 100}%` }} />
                <span className="text-[0.6875rem] text-gray-400 dark:text-gray-500 mt-1">{w.label}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-4 mt-3 text-[0.6875rem] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#000080] dark:bg-[#4169E1] inline-block" />
              {zh ? '笔记' : 'Notes'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#000080]/20 dark:bg-[#4169E1]/25 inline-block" />
              {zh ? 'AI 介入' : 'AI interventions'}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

// --- AI Feedback Acceptance ---
const TRIGGER_LABELS: Record<string, { zh: string; en: string }> = {
  unclear: { zh: '表述不清', en: 'Unclear' },
  no_reasoning: { zh: '缺推理', en: 'No reasoning' },
  no_evidence: { zh: '缺证据', en: 'No evidence' },
  // 以下四类模型已不再产出（LLM 只输出 T1–T6），但生产库存有早期版本写下的行，
  // 标签保留，否则历史数据在图表上会显示成原始英文 id。
  evidence_gap: { zh: '证据缺口', en: 'Evidence gap' },
  no_connection: { zh: '缺连接', en: 'No connection' },
  promising_seed: { zh: '有潜力', en: 'Promising' },
  uncertainty: { zh: '存疑', en: 'Uncertainty' },
  undigested_ai: { zh: '未消化的AI内容', en: 'Undigested AI' },
  unknown: { zh: '未分类', en: 'Unclassified' },
};

interface DonutProps {
  lang: Language;
  pulse: ActivityPulse | null;
  loading?: boolean;
}

export const FeedbackDonutChart: React.FC<DonutProps> = ({ lang, pulse, loading = false }) => {
  const zh = lang === 'zh';
  const a = pulse?.acceptance;
  const decided = (a?.accepted ?? 0) + (a?.rejected ?? 0);

  const label = (key: string) => TRIGGER_LABELS[key]?.[zh ? 'zh' : 'en'] ?? key.replace(/_/g, ' ');

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-5 h-full flex flex-col">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {zh ? 'AI 反馈接受率' : 'AI Feedback Acceptance'}
      </div>
      <div className="text-[0.6875rem] text-gray-500 dark:text-gray-400 mb-4">
        {zh ? '学生采纳了反馈，还是放着没理' : 'Acted on the feedback, or left it alone'}
      </div>

      {!a || (a.accepted + a.rejected + a.pending) === 0 ? (
        <ChartEmpty lang={lang} loading={loading}
          hint={zh ? '还没有 AI 反馈记录' : 'No AI feedback yet'} />
      ) : (
        <div className="flex items-center gap-6">
          <div
            className="w-[100px] h-[100px] rounded-full flex-shrink-0 relative"
            style={{
              background: decided > 0
                ? `conic-gradient(#000080 0% ${(a.accepted / decided) * 100}%, #DDE3F0 ${(a.accepted / decided) * 100}% 100%)`
                : '#E5E7EB',
            }}
          >
            <div className="absolute inset-[18px] rounded-full bg-white dark:bg-gray-950 flex flex-col items-center justify-center">
              {/* 全部还没表态时显示「—」而不是 0%：0% 会被读成「一条都没被接受」 */}
              <span className="text-[1.0625rem] font-bold tracking-tight text-gray-900 dark:text-gray-100">
                {a.rate === null ? '—' : `${a.rate}%`}
              </span>
              <span className="text-[0.5625rem] text-gray-400">{zh ? '已采纳' : 'adopted'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[0.75rem] text-gray-600 dark:text-gray-400">
              <span className="w-2 h-2 rounded-full bg-[#000080] flex-shrink-0" />
              <span>{zh ? '采纳' : 'Adopted'}</span>
              <span className="ml-auto font-semibold text-gray-900 dark:text-gray-100">{a.accepted}</span>
            </div>
            <div className="flex items-center gap-2 text-[0.75rem] text-gray-600 dark:text-gray-400">
              <span className="w-2 h-2 rounded-full bg-[#DDE3F0] flex-shrink-0" />
              <span>{zh ? '看过未采纳' : 'Dismissed'}</span>
              <span className="ml-auto font-semibold text-gray-900 dark:text-gray-100">{a.rejected}</span>
            </div>
            {/* 待处理单独列出，不计入接受率的分母 —— 算进去会让接受率随时间自然下滑 */}
            <div className="flex items-center gap-2 text-[0.75rem] text-gray-400 dark:text-gray-500 pt-1 border-t border-gray-100 dark:border-gray-800">
              <span>{zh ? '还没处理' : 'Untouched'}</span>
              <span className="ml-auto font-semibold">{a.pending}</span>
            </div>
          </div>
        </div>
      )}

      {a && a.byTrigger.length > 0 && (
        <div className="mt-4 space-y-1 border-t border-gray-100 dark:border-gray-800 pt-3">
          {a.byTrigger.slice(0, 4).map(t => (
            <div key={t.triggerType} className="flex items-center gap-2 text-[0.6875rem]">
              <span className="truncate text-gray-500 dark:text-gray-400">{label(t.triggerType)}</span>
              <span className="ml-auto flex-shrink-0 text-gray-400">
                {t.rate === null ? (zh ? '未处理' : 'untouched') : `${t.rate}%`}
                <span className="ml-1.5 text-gray-300 dark:text-gray-600">
                  ({t.accepted + t.rejected + t.pending})
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- Student Engagement Heatmap ---
interface HeatmapProps {
  lang: Language;
  pulse: ActivityPulse | null;
  loading?: boolean;
}

export const EngagementHeatmap: React.FC<HeatmapProps> = ({ lang, pulse, loading = false }) => {
  const zh = lang === 'zh';
  const data = pulse?.heatmap ?? [];
  const max = pulse?.heatmapMax ?? 0;

  const heatColors = [
    'bg-gray-100 dark:bg-gray-800',
    'bg-[#000080]/[0.12] dark:bg-[#4169E1]/[0.15]',
    'bg-[#000080]/[0.28] dark:bg-[#4169E1]/[0.30]',
    'bg-[#000080]/[0.48] dark:bg-[#4169E1]/[0.50]',
    'bg-[#000080]/[0.72] dark:bg-[#4169E1]/[0.75]',
  ];
  // 按本课程的实际最大值分档，而不是写死「4 次就算最热」——
  // 一个 50 人的班和一个 8 人的班，热的标准不一样。
  const level = (v: number) => (max === 0 || v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));

  const dayLabels = zh
    ? ['一', '二', '三', '四', '五', '六', '日']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-5 h-full flex flex-col">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {zh ? '学生参与度' : 'Student Engagement'}
      </div>
      <div className="text-[0.6875rem] text-gray-500 dark:text-gray-400 mb-3">
        {zh ? '最近 4 周活动热力图' : 'Activity heatmap · last 4 weeks'}
      </div>

      {max === 0 ? (
        <ChartEmpty lang={lang} loading={loading}
          hint={zh ? '最近 4 周还没有活动记录' : 'No activity in the last 4 weeks'} />
      ) : (
        <>
          <div className="flex gap-1 mb-1.5 text-[0.6875rem] text-gray-400 dark:text-gray-500">
            {dayLabels.map(d => <span key={d} className="flex-1 text-center">{d}</span>)}
          </div>

          <div className="grid grid-cols-7 gap-[3px]">
            {data.flat().map((v, i) => (
              <div key={i} className={`aspect-square rounded-[3px] ${heatColors[level(v)]}`}
                title={`${v} ${zh ? '次活动' : 'events'}`} />
            ))}
          </div>

          <div className="flex items-center justify-between mt-2 text-[0.6875rem] text-gray-400 dark:text-gray-500">
            <span>{zh ? '低' : 'Less'}</span>
            <div className="flex gap-[3px]">
              {heatColors.map((cls, i) => (
                <div key={i} className={`w-[10px] h-[10px] rounded-[2px] ${cls}`} />
              ))}
            </div>
            <span>{zh ? `高 (${max})` : `More (${max})`}</span>
          </div>
        </>
      )}
    </div>
  );
};

// --- Dashboard Top Bar (replaces heavy hero) ---
interface TopBarProps {
  lang: Language;
  userName?: string;
  role: string;
  courseCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchResults?: Array<{ id: string; title: string }>;
  onSearchSelect?: (id: string, title: string) => void;
}

export const DashboardTopBar: React.FC<TopBarProps> = ({
  lang, userName, role, courseCount, searchQuery, onSearchChange, searchResults, onSearchSelect,
}) => {
  const zh = lang === 'zh';
  const roleLabel = role === 'teacher' ? (zh ? '教师' : 'Teacher')
    : role === 'admin' ? (zh ? '管理员' : 'Admin')
    : (zh ? '学生' : 'Student');

  return (
    <div className="flex items-center justify-end mb-6">
      <div className="relative hidden sm:block">
        <div className="flex items-center gap-2 px-3.5 py-2 border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-950 min-w-[220px]">
          <RemixIcon name="search-line" size={15} className="text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={zh ? '搜索课程...' : 'Search courses...'}
            className="w-full bg-transparent text-[0.8125rem] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none"
          />
        </div>
        {searchQuery.length > 1 && searchResults && searchResults.length > 0 && (
          <div className="absolute top-full mt-1.5 left-0 right-0 z-30 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-lg p-1">
            {searchResults.slice(0, 4).map(c => (
              <button
                key={c.id}
                onClick={() => onSearchSelect?.(c.id, c.title)}
                className="w-full text-left px-3 py-2 rounded-lg text-[0.8125rem] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                {c.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
