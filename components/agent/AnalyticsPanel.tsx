import React, { useEffect, useMemo, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import {
  dashboard as dashboardApi,
  teacherMemory as memoryApi,
  activityPulse as fetchActivityPulse,
  type ActivityPulse,
  LearnerProfileSummary,
} from '../../services/apiClient';
import { WeeklyActivityChart } from '../dashboard/LearningCharts';

/**
 * 学情分析左栏。
 *
 * 这一栏以前在没有数据时回落到写死的数字：活跃度 84.6%、参与深度 7.8、12 名风险学生、
 * 固定的「较上周期」涨跌、写死的小折线，趋势图是一条正弦波。教师会把这些当成自己课上的
 * 真实情况。现在每个数都从学生学习画像和 activity-pulse 现算，没有数据就写「暂无数据」。
 */

interface AnalyticsPanelProps {
  lang: 'zh' | 'en';
  courses: { id: string; title: string }[];
  selectedCourseId: string;
  onCourseChange: (id: string) => void;
  onSendMessage: (text: string) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const DAY_MS = 86_400_000;

const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({
  lang, courses, selectedCourseId, onCourseChange, onSendMessage,
}) => {
  const zh = lang === 'zh';
  const [timeRange, setTimeRange] = useState('14');
  const [profiles, setProfiles] = useState<LearnerProfileSummary[]>([]);
  const [pulse, setPulse] = useState<ActivityPulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const memoryWrittenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    memoryWrittenRef.current = false;
    if (!selectedCourseId) {
      setProfiles([]);
      setPulse(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    Promise.allSettled([
      dashboardApi.learnerProfiles(selectedCourseId),
      fetchActivityPulse(selectedCourseId),
    ]).then(([profRes, pulseRes]) => {
      if (cancelled) return;
      setProfiles(profRes.status === 'fulfilled' ? profRes.value.profiles ?? [] : []);
      setPulse(pulseRes.status === 'fulfilled' ? pulseRes.value.pulse : null);
      // 取数失败要说出来，不能显示成「暂无数据」—— 那是另一回事
      const failed = [profRes, pulseRes].find((r): r is PromiseRejectedResult => r.status === 'rejected');
      setLoadError(failed ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : null);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [selectedCourseId]);

  useEffect(() => {
    if (loading || !selectedCourseId || memoryWrittenRef.current || profiles.length === 0) return;
    memoryWrittenRef.current = true;
    const inactiveCount = profiles.filter(p => {
      if (!p.lastInteractionAt) return true;
      return (Date.now() - new Date(p.lastInteractionAt).getTime()) / DAY_MS > 5;
    }).length;
    if (inactiveCount >= 3) {
      memoryApi.write(selectedCourseId, {
        source: 'analytics',
        memory_type: 'insight',
        content: zh
          ? `${inactiveCount}名学生超过5天未参与讨论，需要关注`
          : `${inactiveCount} students inactive for 5+ days`,
      }).catch(() => {});
    }
  }, [loading, selectedCourseId, profiles, zh]);

  // 画像来自学生和 AI 的对话（画布 AI、笔记 AI、个人助手），没和 AI 说过话的学生不在里面
  const stats = useMemo(() => {
    const now = Date.now();
    const days = Number(timeRange);
    const daysSince = (iso: string | null) => (iso ? (now - new Date(iso).getTime()) / DAY_MS : Infinity);
    const total = profiles.length;
    const active = profiles.filter(p => daysSince(p.lastInteractionAt) <= days).length;
    const inactive = profiles.filter(p => daysSince(p.lastInteractionAt) > 5).length;
    const highScaffold = profiles.filter(p => p.scaffoldingLevel === 'high').length;
    const riskIds = new Set(profiles
      .filter(p => p.scaffoldingLevel === 'high' || daysSince(p.lastInteractionAt) > 5)
      .map(p => p.userId));
    const depthRaw = total
      ? profiles.reduce((sum, p) => sum + p.interactionCount + p.connectionsMade * 1.8 + p.evidenceCited * 1.5 + p.reflectionCount * 2, 0) / total / 12
      : 0;
    return {
      total,
      active,
      inactive,
      highScaffold,
      activeRate: total ? Math.round((active / total) * 1000) / 10 : null,
      avgDepth: total ? Math.round(clamp(depthRaw, 0, 10) * 10) / 10 : null,
      riskCount: total ? riskIds.size : null,
    };
  }, [profiles, timeRange]);

  const segments = useMemo(() => ({
    high: profiles.filter(p => p.scaffoldingLevel === 'low' || p.scaffoldingLevel === 'minimal').length,
    medium: profiles.filter(p => p.scaffoldingLevel === 'medium').length,
    low: profiles.filter(p => p.scaffoldingLevel === 'high').length,
    total: profiles.length,
  }), [profiles]);

  const selectedCourse = courses.find(c => c.id === selectedCourseId)?.title;
  const noData = zh ? '暂无数据' : 'No data yet';
  const noProfiles = zh
    ? '暂无数据：学生和 AI 对话过，才会有学习画像'
    : 'No data yet: a learner profile appears once a student has talked to the AI';

  const kpis: { icon: string; label: string; value: string; suffix?: string; caption: string; tone: string }[] = [
    {
      icon: 'group-line',
      label: zh ? '学生活跃度' : 'Student activity',
      value: stats.activeRate === null ? '—' : `${stats.activeRate}%`,
      caption: stats.total
        ? (zh
          ? `${stats.active}/${stats.total} 人最近 ${timeRange} 天和 AI 对话过`
          : `${stats.active} of ${stats.total} talked to the AI in the last ${timeRange} days`)
        : noProfiles,
      tone: 'accent',
    },
    {
      icon: 'focus-3-line',
      label: zh ? '平均参与深度' : 'Avg engagement depth',
      value: stats.avgDepth === null ? '—' : `${stats.avgDepth}`,
      suffix: stats.avgDepth === null ? undefined : '/ 10',
      caption: stats.total
        ? (zh
          ? `按 ${stats.total} 名学生的 AI 互动、建立的关联、引用的证据和反思折算`
          : `From ${stats.total} students' AI exchanges, connections, evidence and reflections`)
        : noProfiles,
      tone: 'success',
    },
    {
      icon: 'alert-line',
      label: zh ? '风险学生' : 'At-risk students',
      value: stats.riskCount === null ? '—' : String(stats.riskCount),
      caption: stats.total
        ? (zh
          ? `${stats.inactive} 人 5 天以上没和 AI 对话，${stats.highScaffold} 人需要高支架`
          : `${stats.inactive} inactive with the AI for 5+ days, ${stats.highScaffold} need high scaffolding`)
        : noProfiles,
      tone: 'warning',
    },
  ];

  const summary = useMemo(() => {
    const lines: { icon: string; tone: string; text: string }[] = [];
    const weeks = pulse?.weeks ?? [];
    if (pulse?.hasData && weeks.length >= 2) {
      const thisWeek = weeks[weeks.length - 1].notes;
      const lastWeek = weeks[weeks.length - 2].notes;
      lines.push({
        icon: 'sticky-note-line',
        tone: 'text-[#000080] dark:text-[#93AAFD]',
        text: zh ? `本周新笔记 ${thisWeek} 条，上周 ${lastWeek} 条` : `${thisWeek} new notes this week, ${lastWeek} last week`,
      });
    }
    const a = pulse?.acceptance;
    const feedbackTotal = a ? a.accepted + a.rejected + a.pending : 0;
    if (a && feedbackTotal > 0) {
      lines.push({
        icon: 'chat-check-line',
        tone: 'text-emerald-500',
        text: zh
          ? `AI 反馈 ${feedbackTotal} 条：采纳 ${a.accepted}，没采纳 ${a.rejected}，还没处理 ${a.pending}`
          : `${feedbackTotal} AI feedback cards: ${a.accepted} adopted, ${a.rejected} dismissed, ${a.pending} untouched`,
      });
    }
    if (segments.total > 0) {
      const pct = Math.round((segments.low / segments.total) * 1000) / 10;
      lines.push({
        icon: 'alert-line',
        tone: 'text-amber-500',
        text: zh
          ? `${pct}% 的学生需要高支架（${segments.low}/${segments.total}）`
          : `${pct}% of students need high scaffolding (${segments.low}/${segments.total})`,
      });
    }
    return lines;
  }, [pulse, segments, zh]);

  const interventions = [
    {
      icon: 'graduation-cap-line',
      title: zh ? '关注低参与学生' : 'Support low-participation students',
      desc: stats.riskCount
        ? (zh ? `跟进 ${stats.riskCount} 名风险学生，发送个性化提醒与资源` : `Follow up with ${stats.riskCount} at-risk students using tailored prompts`)
        : (zh ? '找出低参与的学生，发送个性化提醒与资源' : 'Find low-participation students and send tailored prompts'),
      prompt: zh ? `分析课程中最近${timeRange}天低参与和高风险学生，并给出个性化干预方案` : `Analyze low-participation students in the last ${timeRange} days`,
      tone: 'violet',
    },
    {
      icon: 'chat-smile-3-line',
      title: zh ? '提升反思深度' : 'Improve reflection depth',
      desc: zh ? '设计反思性问题，鼓励学生进行深度思考与表达' : 'Design reflection prompts for deeper reasoning',
      prompt: zh ? '基于当前学情，设计一组提升学生反思深度的问题和课堂活动' : 'Design prompts to improve reflection depth',
      tone: 'teal',
    },
    {
      icon: 'team-line',
      title: zh ? '优化协作互动' : 'Optimize collaboration',
      desc: zh ? '组织小组讨论或互评活动，提升互动质量' : 'Plan peer discussion to improve interaction quality',
      prompt: zh ? '根据当前学生分层，设计一次优化协作互动的小组活动' : 'Create a collaboration intervention by student segments',
      tone: 'blue',
    },
  ] as const;

  const toneColors: Record<string, { text: string; iconBg: string }> = {
    accent: {
      text: 'text-[#000080] dark:text-[#93AAFD]',
      iconBg: 'bg-[#000080]/[0.08] text-[#000080] dark:bg-[#4169E1]/[0.15] dark:text-[#93AAFD]',
    },
    success: {
      text: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    },
    warning: {
      text: 'text-amber-600 dark:text-amber-400',
      iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    },
  };

  const inputCls = 'h-10 rounded-xl border border-zinc-200 bg-white px-3 text-[0.875rem] text-zinc-700 outline-none transition focus:border-[#000080] focus:ring-1 focus:ring-[#000080]/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-[#000080] dark:border-zinc-700 dark:border-t-[#4169E1]" />
          {zh ? '正在加载学情数据...' : 'Loading analytics...'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-5">
      {/* ── Title + mascot ──────────────────────────────── */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {zh ? '学情分析' : 'Learning Analytics'}
          </h1>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-gray-500 dark:text-gray-400">
            {zh ? 'AI 支持的课程学习洞察与干预' : 'AI-supported learning insights'}
          </p>
        </div>
        <img src="/assets/Learning situation analysis.png" alt="" className="hidden h-24 w-auto flex-shrink-0 object-contain lg:block" />
      </div>

      {/* ── Filter bar ──────────────────────────────────── */}
      <div className="relative mb-3 flex items-center gap-2">
        <select value={selectedCourseId} onChange={e => onCourseChange(e.target.value)} className={`${inputCls} min-w-[160px]`}>
          <option value="">{zh ? '选择课程' : 'Select course'}</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <select value={timeRange} onChange={e => setTimeRange(e.target.value)} className={`${inputCls} w-[100px]`}>
          <option value="7">{zh ? '7 天' : '7 days'}</option>
          <option value="14">{zh ? '14 天' : '14 days'}</option>
          <option value="30">{zh ? '30 天' : '30 days'}</option>
        </select>
      </div>

      {loadError && (
        <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[0.8125rem] leading-relaxed text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {zh ? '部分学情数据没有加载成功：' : 'Some analytics failed to load: '}{loadError}
        </p>
      )}

      {!selectedCourseId ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <RemixIcon name="bar-chart-2-line" size={26} className="text-zinc-400 dark:text-zinc-500" />
            </div>
            <p className="text-[0.875rem] text-zinc-400 dark:text-zinc-500">{zh ? '请选择课程查看学情数据' : 'Select a course to view analytics'}</p>
          </div>
        </div>
      ) : (
        <div className="relative flex flex-1 min-h-0 flex-col gap-3">
          {/* ── Row 1: KPI cards + summary ────────────── */}
          <div className="grid gap-3 grid-cols-2">
            {kpis.map(card => {
              const tc = toneColors[card.tone] ?? toneColors.accent;
              return (
                <div key={card.label} className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tc.iconBg}`}>
                    <RemixIcon name={card.icon} size={18} />
                  </div>
                  <div className="mt-3 text-[0.75rem] font-medium text-zinc-500 dark:text-zinc-400">{card.label}</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{card.value}</span>
                    {card.suffix && <span className="text-[0.8125rem] text-zinc-400">{card.suffix}</span>}
                  </div>
                  <div className="mt-2 text-[0.6875rem] leading-relaxed text-zinc-400">{card.caption}</div>
                </div>
              );
            })}

            {/* Summary card: 全是从数据里直接数出来的句子，不是模型生成的判断 */}
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
              <div className="mb-2 flex items-center gap-1.5">
                <RemixIcon name="file-list-3-line" size={14} className="text-[#000080] dark:text-[#93AAFD]" />
                <span className="text-[0.8125rem] font-semibold text-zinc-700 dark:text-zinc-300">{zh ? '数据摘要' : 'At a glance'}</span>
              </div>
              <div className="space-y-1.5 text-[0.75rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
                {summary.length === 0 ? (
                  <p className="text-zinc-400 dark:text-zinc-500">{noData}</p>
                ) : summary.map(line => (
                  <div key={line.text} className="flex items-start gap-2">
                    <RemixIcon name={line.icon} size={14} className={`mt-0.5 flex-shrink-0 ${line.tone}`} />
                    {line.text}
                  </div>
                ))}
              </div>
              <button onClick={() => onSendMessage(zh ? `生成${selectedCourse ?? '本课程'}最近${timeRange}天的完整学情分析报告` : `Generate a full analytics report for the last ${timeRange} days`)} className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-2 text-[0.75rem] font-semibold text-[#000080] transition hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800 dark:text-[#93AAFD] dark:hover:bg-zinc-700">
                {zh ? '生成完整报告' : 'Full report'} <RemixIcon name="arrow-right-line" size={12} className="ml-1" />
              </button>
            </div>
          </div>

          {/* ── Row 2: Trend chart + Segments + Interventions ── */}
          <div className="flex flex-1 min-h-0 flex-col gap-3">
            {/* 真实的周度数据：笔记创建与 AI 介入，最近 8 周。定高且不参与收缩：
                这一列是 flex，不定高的话图会被压扁，柱子溢出到下一行 */}
            <div className="h-64 flex-shrink-0">
              <WeeklyActivityChart lang={lang} pulse={pulse} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Segments donut */}
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-3 text-[0.875rem] font-semibold text-gray-900 dark:text-gray-100">{zh ? '学生分层' : 'Student segments'}</h3>
                {segments.total === 0 ? (
                  <p className="py-4 text-[0.75rem] leading-relaxed text-zinc-400 dark:text-zinc-500">{noProfiles}</p>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="grid h-20 w-20 flex-shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#000080 0 ${segments.high / segments.total * 100}%, #10B981 ${segments.high / segments.total * 100}% ${(segments.high + segments.medium) / segments.total * 100}%, #F59E0B ${(segments.high + segments.medium) / segments.total * 100}% 100%)` }}>
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-white dark:bg-zinc-900 text-center">
                        <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{segments.total}</div>
                      </div>
                    </div>
                    <div className="flex-1 space-y-1.5 text-[0.75rem]">
                      <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"><i className="h-2 w-2 rounded-full bg-[#000080] dark:bg-[#4169E1]" />{zh ? '高参与' : 'High'}</span><span className="font-semibold text-gray-900 dark:text-gray-100">{segments.high}</span></div>
                      <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"><i className="h-2 w-2 rounded-full bg-emerald-500" />{zh ? '中参与' : 'Medium'}</span><span className="font-semibold text-gray-900 dark:text-gray-100">{segments.medium}</span></div>
                      <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"><i className="h-2 w-2 rounded-full bg-amber-500" />{zh ? '低参与' : 'Low'}</span><span className="font-semibold text-gray-900 dark:text-gray-100">{segments.low}</span></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Interventions */}
              <div className="flex-1 min-h-0 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-3 text-[0.875rem] font-semibold text-gray-900 dark:text-gray-100">{zh ? '建议干预' : 'Interventions'}</h3>
                <div className="space-y-2">
                  {interventions.map(item => (
                    <button key={item.title} onClick={() => onSendMessage(item.prompt)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-100 bg-white p-2.5 text-left transition hover:border-zinc-300 hover:shadow-sm active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:border-zinc-700">
                      <span className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl ${
                        item.tone === 'violet' ? 'bg-[#000080]/[0.08] text-[#000080] dark:bg-[#4169E1]/[0.15] dark:text-[#93AAFD]' :
                        item.tone === 'teal' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' :
                        'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        <RemixIcon name={item.icon} size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.8125rem] font-semibold text-gray-900 dark:text-gray-100">{item.title}</span>
                        <span className="block truncate text-[0.6875rem] text-zinc-400 dark:text-zinc-500">{item.desc}</span>
                      </span>
                      <RemixIcon name="arrow-right-s-line" size={16} className="flex-shrink-0 text-zinc-300 dark:text-zinc-600" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsPanel;
