import React, { useEffect, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import {
  dashboard as dashboardApi,
  teacherMemory as memoryApi,
  agentRuns as runsApi,
  LearnerProfileSummary,
  FeedbackReviewStats,
  FeedbackTrendPoint,
  TriggerEffectivenessRow,
  TeacherMemoryItem,
  AgentRun,
} from '../../services/apiClient';

interface AssessmentPanelProps {
  lang: 'zh' | 'en';
  courses: { id: string; title: string }[];
  selectedCourseId: string;
  onCourseChange: (id: string) => void;
  onSendMessage: (text: string) => void;
}

const T_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  T1: { zh: '照搬 AI', en: 'Undigested AI', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  T2: { zh: '无推理', en: 'No reasoning', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  T3: { zh: '无证据', en: 'No evidence', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  T4: { zh: '无关联', en: 'No connection', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  T5: { zh: '有潜力', en: 'Promising', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  T6: { zh: '不清晰', en: 'Unclear', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

const AssessmentPanel: React.FC<AssessmentPanelProps> = ({
  lang, courses, selectedCourseId, onCourseChange, onSendMessage,
}) => {
  const zh = lang === 'zh';
  const [profiles, setProfiles] = useState<LearnerProfileSummary[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackReviewStats | null>(null);
  const [triggerEff, setTriggerEff] = useState<TriggerEffectivenessRow[]>([]);
  const [trendData, setTrendData] = useState<FeedbackTrendPoint[]>([]);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [crossMemories, setCrossMemories] = useState<TeacherMemoryItem[]>([]);
  const memoryWrittenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    memoryWrittenRef.current = false;
    if (!selectedCourseId) { setLoading(false); return; }

    async function load() {
      setLoading(true);
      try {
        const [profRes, fbRes, teRes, trendRes, memRes, runsRes] = await Promise.all([
          dashboardApi.learnerProfiles(selectedCourseId),
          dashboardApi.feedbackReview(selectedCourseId),
          dashboardApi.triggerEffectiveness(selectedCourseId),
          dashboardApi.feedbackTrend(selectedCourseId, 56).catch(() => ({ trend: [] as FeedbackTrendPoint[], days: 56 })),
          memoryApi.list(selectedCourseId).catch(() => ({ memories: [] as TeacherMemoryItem[] })),
          runsApi.list({ course_id: selectedCourseId, limit: 6 }).catch(() => ({ runs: [] as AgentRun[] })),
        ]);
        if (!cancelled) {
          setProfiles(profRes.profiles ?? []);
          setFeedbackStats(fbRes.stats ?? null);
          setTriggerEff(teRes.effectiveness ?? []);
          setTrendData(trendRes.trend ?? []);
          setRecentRuns(runsRes.runs ?? []);
          setCrossMemories(
            (memRes.memories ?? []).filter((m: TeacherMemoryItem) => m.source !== 'assessment').slice(0, 6),
          );
        }
      } catch { /* non-critical */ }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [selectedCourseId]);

  // Auto-write T1 dominance insight to cross-module memory
  useEffect(() => {
    if (loading || !selectedCourseId || memoryWrittenRef.current) return;
    memoryWrittenRef.current = true;
    const localTDist: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, T6: 0 };
    profiles.forEach(p => {
      Object.entries(p.feedbackStats?.byType ?? {}).forEach(([k, v]) => {
        const key = k.toUpperCase();
        if (key in localTDist) localTDist[key] += v;
      });
    });
    const localTotal = Object.values(localTDist).reduce((s, v) => s + v, 0);
    if (localTotal > 0 && localTDist.T1 / localTotal > 0.2) {
      memoryApi.write(selectedCourseId, {
        source: 'assessment',
        memory_type: 'insight',
        content: zh
          ? `T1(照搬AI)占比${Math.round(localTDist.T1 / localTotal * 100)}%，需加强批判思维训练`
          : `T1 (undigested AI) at ${Math.round(localTDist.T1 / localTotal * 100)}%, need critical thinking focus`,
      }).catch(() => {});
    }
  }, [loading, selectedCourseId, profiles, zh]);

  // T1-T6 distribution from profiles' feedbackStats.byType
  const tDist: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, T6: 0 };
  profiles.forEach(p => {
    Object.entries(p.feedbackStats?.byType ?? {}).forEach(([k, v]) => {
      const key = k.toUpperCase();
      if (key in tDist) tDist[key] += v;
    });
  });
  const tTotal = Object.values(tDist).reduce((s, v) => s + v, 0);

  // Scaffolding distribution
  const scaffoldDist = { high: 0, medium: 0, low: 0, minimal: 0 };
  profiles.forEach(p => { scaffoldDist[p.scaffoldingLevel]++; });

  const actions = [
    {
      icon: 'file-chart-line', color: 'accent',
      title: zh ? '完整评估报告' : 'Full assessment report',
      desc: zh ? '生成综合 Word 报告含图表' : 'Comprehensive Word report with charts',
      prompt: zh
        ? '生成完整的教学评估报告，包含 T1-T6 反馈分布、脚手架效果分析和改进建议'
        : 'Generate a comprehensive teaching assessment report with T1-T6 distribution, scaffolding analysis, and recommendations',
    },
    {
      icon: 'checkbox-circle-line', color: 'success',
      title: zh ? '反馈效果分析' : 'Feedback effectiveness',
      desc: zh ? '评估哪种 AI 干预最有效' : 'Analyze which AI interventions work best',
      prompt: zh
        ? '分析各类型 AI 反馈的效果，哪种触发类型接受率最高？哪些需要调整？'
        : 'Analyze AI feedback effectiveness by type. Which trigger types have the highest acceptance rate?',
    },
    {
      icon: 'equalizer-line', color: 'warning',
      title: zh ? '优化触发策略' : 'Optimize triggers',
      desc: zh ? 'AI 推荐的触发参数调整' : 'AI-recommended trigger adjustments',
      prompt: zh
        ? '基于当前学生表现数据，推荐最优的 AI 触发策略设置'
        : 'Based on current student performance data, suggest optimal AI trigger settings',
    },
    {
      icon: 'presentation-line', color: 'pro',
      title: zh ? '教学改进建议' : 'Teaching suggestions',
      desc: zh ? '可操作的教学干预方案' : 'Actionable interventions for next class',
      prompt: zh
        ? '基于知识建构话语质量分析，给出下节课的具体教学干预建议'
        : 'Based on KB discourse quality analysis, provide specific teaching intervention suggestions for next class',
    },
  ];

  const bestTrigger = triggerEff.length > 0
    ? triggerEff.reduce((best, t) => (t.acceptanceRate ?? 0) > (best.acceptanceRate ?? 0) ? t : best)
    : null;

  const totalStudents = profiles.length;
  const highSupportPct = totalStudents > 0 ? Math.round(scaffoldDist.high / totalStudents * 100) : 0;
  const riskCount = profiles.filter(p => !p.lastInteractionAt || (Date.now() - new Date(p.lastInteractionAt).getTime()) / 86400000 > 5).length;
  const aiCompletionPct = feedbackStats && feedbackStats.totalFeedbacks > 0
    ? Math.round(feedbackStats.acceptanceRate * 100) : 0;

  // Calculate real period-over-period trends from trendData
  const calcTrend = (metric: (p: FeedbackTrendPoint) => number) => {
    if (trendData.length < 2) return { value: 0, up: true };
    const mid = Math.floor(trendData.length / 2);
    const recent = trendData.slice(mid);
    const prior = trendData.slice(0, mid);
    const recentAvg = recent.reduce((s, p) => s + metric(p), 0) / (recent.length || 1);
    const priorAvg = prior.reduce((s, p) => s + metric(p), 0) / (prior.length || 1);
    const pct = priorAvg > 0 ? Math.round(((recentAvg - priorAvg) / priorAvg) * 100 * 10) / 10 : 0;
    return { value: Math.abs(pct), up: pct >= 0 };
  };
  const totalTrend = calcTrend(p => p.total);
  const acceptTrend = calcTrend(p => p.acceptanceRate);

  const kpis = [
    { icon: 'team-line', label: zh ? '参与学生数' : 'Students', value: totalStudents, trend: totalTrend.value, up: totalTrend.up, bg: 'bg-blue-50 dark:bg-blue-900/15', iconColor: 'text-blue-500' },
    { icon: 'shield-check-line', label: zh ? '高支持学生比例' : 'High support %', value: `${highSupportPct}%`, trend: 0, up: true, bg: 'bg-emerald-50 dark:bg-emerald-900/15', iconColor: 'text-emerald-500' },
    { icon: 'alarm-warning-line', label: zh ? '风险提示数' : 'Risk alerts', value: riskCount, trend: 0, up: riskCount === 0, bg: 'bg-orange-50 dark:bg-orange-900/15', iconColor: 'text-orange-500' },
    { icon: 'robot-2-line', label: zh ? 'AI 反馈接受率' : 'AI acceptance', value: `${aiCompletionPct}%`, trend: acceptTrend.value, up: acceptTrend.up, bg: 'bg-sky-50 dark:bg-sky-900/15', iconColor: 'text-sky-500' },
  ];

  const actionBtns = [
    { icon: 'file-chart-line', color: 'text-[#000080] dark:text-[#93AAFD]', bg: 'bg-[#000080]/[0.06] dark:bg-[#4169E1]/[0.1]', ...actions[0], cta: zh ? '生成报告' : 'Generate' },
    { icon: 'checkbox-circle-line', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', ...actions[1], cta: zh ? '开始分析' : 'Analyze' },
    { icon: 'equalizer-line', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', ...actions[2], cta: zh ? '优化策略' : 'Optimize' },
    { icon: 'presentation-line', color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/20', ...actions[3], cta: zh ? '查看建议' : 'View' },
  ];

  const aiInsight = (() => {
    if (tDist.T1 > 0 && tTotal > 0 && tDist.T1 / tTotal > 0.15) {
      return zh
        ? `近 2 周学生在"照搬AI"模块的参与度较低，建议增加案例演练与分组讨论环节，并关注 ${riskCount} 名低参与学生的学习状态。`
        : `T1 (undigested AI) usage is elevated at ${Math.round(tDist.T1 / tTotal * 100)}%. Consider adding case exercises and group discussions. Monitor ${riskCount} low-engagement students.`;
    }
    return zh
      ? `课堂参与度提升空间显著。建议关注 ${riskCount} 名低参与学生，增加互动讨论和反思环节以提升整体话语质量。`
      : `Classroom engagement has room for improvement. Monitor ${riskCount} low-engagement students and increase discussion prompts.`;
  })();

  // Donut segments for scaffolding distribution
  const donutData = [
    { label: zh ? '高支持 (≥80)' : 'High (≥80)', value: scaffoldDist.high, color: '#3b82f6' },
    { label: zh ? '中支持 (60-79)' : 'Med (60-79)', value: scaffoldDist.medium, color: '#10b981' },
    { label: zh ? '低支持 (<60)' : 'Low (<60)', value: scaffoldDist.low + scaffoldDist.minimal, color: '#f59e0b' },
  ];
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0) || 1;

  // Aggregate trendData into weekly buckets for the chart
  const weeklyBuckets = (() => {
    if (trendData.length === 0) return [];
    const weeks: { label: string; total: number; accepted: number; rate: number; days: number }[] = [];
    let bucket = { label: '', total: 0, accepted: 0, days: 0 };
    trendData.forEach((p, i) => {
      if (i % 7 === 0 && i > 0) {
        bucket.label = trendData[i - 7]?.date?.slice(5) ?? '';
        weeks.push({ ...bucket, rate: bucket.total > 0 ? Math.round(bucket.accepted / bucket.total * 100) : 0 });
        bucket = { label: '', total: 0, accepted: 0, days: 0 };
      }
      bucket.total += p.total;
      bucket.accepted += p.accepted;
      bucket.days++;
    });
    if (bucket.days > 0) {
      bucket.label = trendData[trendData.length - bucket.days]?.date?.slice(5) ?? '';
      weeks.push({ ...bucket, rate: bucket.total > 0 ? Math.round(bucket.accepted / bucket.total * 100) : 0 });
    }
    return weeks;
  })();

  const trendLines = [
    { label: zh ? '反馈总量' : 'Total', color: '#3b82f6', points: weeklyBuckets.map(w => w.total) },
    { label: zh ? '接受量' : 'Accepted', color: '#10b981', points: weeklyBuckets.map(w => w.accepted) },
    { label: zh ? '接受率%' : 'Rate%', color: '#f59e0b', points: weeklyBuckets.map(w => w.rate) },
  ];
  const trendWeeks = weeklyBuckets.length || 1;

  const AGENT_TYPE_ICONS: Record<string, string> = { chat: 'chat-3-line', lesson_prep: 'file-text-line', analytics: 'bar-chart-line', assessment: 'clipboard-line' };
  const RUN_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
    applied: { label: zh ? '已完成' : 'Done', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    executing: { label: zh ? '执行中' : 'Running', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    failed: { label: zh ? '失败' : 'Failed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    reviewing: { label: zh ? '审查中' : 'Review', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  };

  const selClass = 'h-10 rounded-xl border border-gray-200 bg-white px-3 text-[0.8125rem] text-gray-700 focus:border-[#000080] focus:outline-none focus:ring-1 focus:ring-[#000080] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-5">
        {/* ── Title + mascot ──────────────────────────────── */}
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              {zh ? '教学评估' : 'Teaching Assessment'}
            </h1>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-gray-500 dark:text-gray-400">
              {zh ? 'AI 全流程辅助，驱动教学改进' : 'AI-powered assessment & improvement'}
            </p>
          </div>
          <img src="/assets/Teaching Evaluation.png" alt="" className="hidden h-24 w-auto flex-shrink-0 object-contain lg:block" />
        </div>

        {/* ── Filter bar ───────────────────────────────────────── */}
        <div className="relative mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[0.6875rem] font-medium text-gray-500 dark:text-gray-400">{zh ? '课程' : 'Course'}</span>
            <select value={selectedCourseId} onChange={e => onCourseChange(e.target.value)} className={selClass}>
              <option value="">{zh ? '选择课程' : 'Select course'}</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          {bestTrigger && (
            <div className="ml-auto flex items-center gap-2 text-[0.75rem] text-gray-500 dark:text-gray-400">
              <RemixIcon name="trophy-line" size={14} className="text-amber-500" />
              {zh ? '最优触发: ' : 'Best trigger: '}
              <span className="font-medium text-gray-700 dark:text-gray-200">{bestTrigger.triggerType}</span>
              <span className="text-emerald-600 dark:text-emerald-400">{Math.round((bestTrigger.acceptanceRate ?? 0) * 100)}%</span>
            </div>
          )}
          <div className={bestTrigger ? '' : 'ml-auto'}>
            <button
              onClick={() => onSendMessage(zh ? '分析当前课程的教学评估数据，给出综合报告' : 'Analyze current course assessment data and provide a comprehensive report')}
              className="flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[0.8125rem] font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-750"
            >
              <RemixIcon name="sparkling-2-line" size={14} />
              {zh ? 'AI 分析' : 'AI Analyze'}
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-[#000080] dark:border-gray-700 dark:border-t-[#4169E1]" />
            <span className="ml-3 text-[0.8125rem] text-gray-400">{zh ? '加载中...' : 'Loading...'}</span>
          </div>
        )}

        {!loading && selectedCourseId && (
          <div className="flex flex-1 min-h-0 flex-col">
            {/* ── 4 KPI cards ────────────────────────────────────── */}
            <div className="mb-3 grid grid-cols-2 gap-3">
              {kpis.map((kpi, i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${kpi.bg}`}>
                    <RemixIcon name={kpi.icon} size={18} className={kpi.iconColor} />
                  </div>
                  <div>
                    <div className="text-[0.75rem] text-zinc-500 dark:text-zinc-400">{kpi.label}</div>
                    <div className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{kpi.value}</div>
                    {kpi.trend > 0 && (
                      <div className={`mt-0.5 text-[0.6875rem] font-medium ${kpi.up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                        {zh ? '较上周期 ' : 'vs last '}{kpi.up ? '↑' : '↓'} {kpi.trend}%
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Action cards + AI insight ───────────────────────── */}
            <div className="mb-3 grid grid-cols-2 gap-3">
              {actionBtns.map((a, i) => (
                <button
                  key={i}
                  onClick={() => onSendMessage(a.prompt)}
                  className="group flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-4 text-left transition-all hover:shadow-sm active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div>
                    <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${a.bg}`}>
                      <RemixIcon name={a.icon} size={17} className={a.color} />
                    </div>
                    <div className="text-[0.8125rem] font-semibold text-gray-900 dark:text-gray-100">{a.title}</div>
                    <div className="mt-0.5 text-[0.6875rem] leading-relaxed text-gray-400 dark:text-gray-500">{a.desc}</div>
                  </div>
                  <div className="mt-3 flex items-center gap-1 text-[0.6875rem] font-medium text-[#000080] dark:text-[#93AAFD]">
                    {a.cta} <RemixIcon name="arrow-right-line" size={12} />
                  </div>
                </button>
              ))}

              {/* AI Insight card */}
              <button
                onClick={() => onSendMessage(zh ? '根据当前数据生成详细的教学评估洞察报告' : 'Generate detailed teaching assessment insights based on current data')}
                className="group relative col-span-2 overflow-hidden rounded-2xl border border-blue-200/60 bg-gradient-to-br from-blue-50 via-white to-indigo-50/50 p-4 text-left shadow-sm transition-all hover:shadow-md active:scale-[0.98] dark:border-blue-800/40 dark:from-blue-950/30 dark:via-gray-900 dark:to-indigo-950/20"
              >
                <div className="flex items-center gap-2 text-[0.75rem] font-semibold text-[#000080] dark:text-[#93AAFD]">
                  <RemixIcon name="sparkling-2-fill" size={14} />
                  AI {zh ? '洞察' : 'Insight'}
                  <span className="ml-auto text-[0.6875rem] font-normal text-gray-400">{zh ? '本周洞察' : 'This week'}</span>
                </div>
                <div className="mt-3 text-[0.875rem] font-semibold leading-snug text-gray-900 dark:text-gray-100">
                  {zh ? '课堂参与度提升空间显著' : 'Engagement improvement opportunity'}
                </div>
                <div className="mt-2 text-[0.6875rem] leading-relaxed text-gray-500 dark:text-gray-400">
                  {aiInsight}
                </div>
                <div className="mt-4 flex items-center gap-1 text-[0.75rem] font-medium text-[#000080] dark:text-[#93AAFD]">
                  {zh ? '查看详情' : 'Details'} <RemixIcon name="arrow-right-line" size={12} />
                </div>
                <div className="absolute -bottom-3 -right-3 opacity-10">
                  <svg viewBox="0 0 80 80" className="h-20 w-20">
                    <rect x="10" y="10" width="60" height="45" rx="14" fill="#4169E1" />
                    <rect x="22" y="22" width="10" height="8" rx="3" fill="#fff" />
                    <rect x="48" y="22" width="10" height="8" rx="3" fill="#fff" />
                    <path d="M30 38 C35 44, 45 44, 50 38" stroke="#fff" strokeWidth="2" fill="none" />
                  </svg>
                </div>
              </button>
            </div>

            {/* ── Bottom: Trend chart + Donut + Tasks ────────────── */}
            <div className="flex flex-1 min-h-0 flex-col gap-3">
              {/* Trend chart */}
              <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-gray-900 dark:text-gray-100">{zh ? '反馈趋势概览' : 'Feedback trends'}</span>
                    <span className="text-[0.6875rem] text-gray-400">{zh ? '（按周聚合）' : '(weekly)'}</span>
                  </div>
                </div>
                {weeklyBuckets.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-[0.8125rem] text-gray-400">{zh ? '暂无反馈数据' : 'No feedback data yet'}</div>
                ) : (
                  <>
                    <div className="mb-3 flex flex-wrap gap-4">
                      {trendLines.map((line, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[0.6875rem] text-gray-500 dark:text-gray-400">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: line.color }} />
                          {line.label}
                        </div>
                      ))}
                    </div>
                    <svg viewBox="0 0 400 160" className="w-full" preserveAspectRatio="xMidYMid meet">
                      {(() => {
                        const maxVal = Math.max(...trendLines.flatMap(l => l.points), 1);
                        const step = Math.ceil(maxVal / 4);
                        return [0, step, step * 2, step * 3, step * 4].map((v, i) => (
                          <React.Fragment key={i}>
                            <line x1="30" y1={140 - (v / (step * 4)) * 120} x2="390" y2={140 - (v / (step * 4)) * 120} stroke="#e5e7eb" strokeWidth="0.5" className="dark:stroke-gray-700" />
                            <text x="22" y={143 - (v / (step * 4)) * 120} textAnchor="end" fill="#9ca3af" fontSize="9">{v}</text>
                          </React.Fragment>
                        ));
                      })()}
                      {(() => {
                        const maxVal = Math.max(...trendLines.flatMap(l => l.points), 1);
                        const scale = 120 / maxVal;
                        const xStep = trendWeeks > 1 ? 360 / (trendWeeks - 1) : 0;
                        return (
                          <>
                            {trendLines.map((line, li) => line.points.length > 1 && (
                              <polyline
                                key={li}
                                fill="none"
                                stroke={line.color}
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                points={line.points.map((v, i) => `${30 + i * xStep},${140 - v * scale}`).join(' ')}
                              />
                            ))}
                            {trendLines.map((line, li) =>
                              line.points.map((v, i) => (
                                <circle key={`${li}-${i}`} cx={30 + i * xStep} cy={140 - v * scale} r="2.5" fill={line.color} />
                              ))
                            )}
                            {weeklyBuckets.map((w, i) => (
                              <text key={i} x={30 + i * xStep} y="155" textAnchor="middle" fill="#9ca3af" fontSize="8">{w.label}</text>
                            ))}
                          </>
                        );
                      })()}
                    </svg>
                  </>
                )}
              </div>

              {/* Donut chart */}
              <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-4 text-[0.9375rem] font-semibold text-gray-900 dark:text-gray-100">{zh ? '支持度分布' : 'Support distribution'}</div>
                <div className="flex items-center justify-center py-2">
                  <svg viewBox="0 0 120 120" className="h-32 w-32">
                    {(() => {
                      let offset = 0;
                      const r = 42, cx = 60, cy = 60, circumference = 2 * Math.PI * r;
                      return donutData.map((seg, i) => {
                        const pct = seg.value / donutTotal;
                        const dash = circumference * pct;
                        const gap = circumference - dash;
                        const el = (
                          <circle
                            key={i}
                            cx={cx} cy={cy} r={r}
                            fill="none" stroke={seg.color} strokeWidth="12"
                            strokeDasharray={`${dash} ${gap}`}
                            strokeDashoffset={-offset}
                            transform={`rotate(-90 ${cx} ${cy})`}
                            strokeLinecap="round"
                          />
                        );
                        offset += dash;
                        return el;
                      });
                    })()}
                    <text x="60" y="56" textAnchor="middle" fill="#374151" fontSize="18" fontWeight="700" className="dark:fill-gray-100">{totalStudents}</text>
                    <text x="60" y="70" textAnchor="middle" fill="#9ca3af" fontSize="8">{zh ? '学生总数' : 'Total'}</text>
                  </svg>
                </div>
                <div className="mt-3 space-y-2">
                  {donutData.map((seg, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[0.75rem] text-gray-600 dark:text-gray-300">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                        {seg.label}
                      </div>
                      <span className="text-[0.75rem] font-medium text-gray-700 dark:text-gray-200">
                        {donutTotal > 0 ? (seg.value / donutTotal * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent agent runs */}
              <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[0.9375rem] font-semibold text-gray-900 dark:text-gray-100">{zh ? '近期 Agent 运行' : 'Recent runs'}</span>
                </div>
                {recentRuns.length === 0 ? (
                  <div className="py-6 text-center text-[0.8125rem] text-gray-400">{zh ? '暂无运行记录' : 'No runs yet'}</div>
                ) : (
                  <div className="space-y-3">
                    {recentRuns.map((run) => {
                      const stCfg = RUN_STATUS_CONFIG[run.status] ?? { label: run.status, cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' };
                      return (
                        <div key={run.id} className="flex items-start gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gray-50 dark:bg-gray-800">
                            <RemixIcon name={AGENT_TYPE_ICONS[run.agent_type] ?? 'robot-2-line'} size={16} className="text-gray-400 dark:text-gray-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[0.8125rem] font-medium text-gray-700 dark:text-gray-200">
                              {run.title || run.agent_type}
                            </div>
                            <div className="mt-0.5 text-[0.6875rem] text-gray-400 dark:text-gray-500">
                              {new Date(run.started_at).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${stCfg.cls}`}>
                            {stCfg.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── T1-T6 distribution (compact inline bar) ─────────── */}
            {tTotal > 0 && (
              <div className="mt-3 flex items-center gap-3">
                <span className="text-[0.75rem] font-medium text-zinc-500 dark:text-zinc-400">{zh ? 'T1-T6' : 'T1-T6'}</span>
                <div className="flex flex-1 gap-0.5 overflow-hidden rounded-lg">
                  {Object.entries(tDist).map(([key, val]) => val > 0 && (
                    <div key={key} className={`px-1.5 py-1 text-center text-[0.6875rem] font-medium ${T_LABELS[key].color}`} style={{ flex: val }}>
                      {key} {Math.round(val / tTotal * 100)}%
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !selectedCourseId && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <RemixIcon name="clipboard-line" size={26} className="text-zinc-400 dark:text-zinc-500" />
            </div>
            <p className="text-[0.875rem] text-zinc-400 dark:text-zinc-500">{zh ? '请选择课程开始教学评估' : 'Select a course to begin assessment'}</p>
          </div>
        )}
    </div>
  );
};

export default AssessmentPanel;
