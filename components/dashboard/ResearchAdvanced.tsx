import React, { useState, useRef } from 'react';
import { research as researchApi } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { ChartCard } from './ChartCard';
import { downloadSvgAsPng, downloadCsv } from './downloadUtils';
import { VizDualAxis, VizStackedBar, VizAreaLine, ChartDefs } from './ResearchViz';




const MetricCard: React.FC<{ label: string; value: string | number; sub?: string; color?: string }> = ({ label, value, sub, color }) => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3 text-center">
    <div className="text-[0.6875rem] text-gray-500 dark:text-gray-400">{label}</div>
    <div className={`mt-1 text-lg font-semibold ${color ?? 'text-gray-900 dark:text-gray-100'}`}>{value}</div>
    {sub && <div className="text-[0.6875rem] text-gray-400">{sub}</div>}
  </div>
);

// ═══════════════════════════════════════════════════════
// SNA Advanced Panel
// ═══════════════════════════════════════════════════════

export const SnaAdvancedPanel: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof researchApi.snaAdvanced>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await researchApi.snaAdvanced(courseId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading && !error) {
    return (
      <button onClick={run} className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400 hover:border-[#000080] hover:text-[#000080] transition-colors">
        <RemixIcon name="microscope-line" size={14} />
        {zh ? '加载高级网络指标（闭合中心性、特征向量、聚类系数、结构洞）' : 'Load Advanced Network Metrics'}
      </button>
    );
  }

  if (loading) return <div className="py-4 text-center text-xs text-gray-500 animate-pulse">{zh ? '计算高级网络指标...' : 'Computing advanced metrics...'}</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 px-3 py-2 text-xs text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4 mt-4 pt-4 border-t border-gray-100 dark:border-gray-900">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
        <RemixIcon name="microscope-line" size={12} />
        {zh ? '高级网络指标' : 'Advanced Network Metrics'}
      </h4>

      {/* Network-level metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MetricCard label={zh ? '全局聚类系数' : 'Global Clustering'} value={data.network.globalClustering.toFixed(4)} sub="Watts & Strogatz" />
        <MetricCard label={zh ? '互惠性' : 'Reciprocity'} value={data.network.reciprocity.toFixed(4)} />
        <MetricCard label={zh ? '平均路径长度' : 'Avg Path Length'} value={data.network.avgPathLength.toFixed(2)} />
        <MetricCard label={zh ? '最大 K-Core' : 'Max K-Core'} value={data.network.maxKCore} />
        <MetricCard label={zh ? '小世界指数' : 'Small-World σ'} value={data.network.smallWorldIndex.toFixed(3)} sub="C/L ratio" />
      </div>

      {/* Node-level table */}
      <ChartCard
        title={zh ? '节点级高级中心性指标' : 'Node-Level Advanced Centrality'}
        onDownloadCsv={() => downloadCsv(data.nodes.map(n => ({
          authorId: n.authorId, closeness: n.closeness, eigenvector: n.eigenvector, clustering: n.clustering, kCore: n.kCore, constraint: n.constraint,
        })), 'sna_advanced_centrality.csv')}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-900 bg-gray-50 dark:bg-gray-950">
                <th className="px-2 py-2 text-left font-medium text-gray-500">{zh ? '节点' : 'Node'}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500" title="Freeman 1978">{zh ? '闭合中心性' : 'Closeness'}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500" title="Power iteration">{zh ? '特征向量' : 'Eigenvec.'}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500" title="Watts & Strogatz 1998">{zh ? '聚类系数' : 'Clustering'}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? 'K-Core' : 'K-Core'}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500" title="Burt 1992">{zh ? '结构约束' : 'Constraint'}</th>
              </tr>
            </thead>
            <tbody>
              {data.nodes.sort((a, b) => b.eigenvector - a.eigenvector).slice(0, 30).map(node => (
                <tr key={node.authorId} className="border-b border-gray-50 dark:border-gray-900/50 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                  <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400">{node.authorId.slice(0, 8)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{node.closeness.toFixed(4)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{node.eigenvector.toFixed(4)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{node.clustering.toFixed(4)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{node.kCore}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <span className={node.constraint < 0.3 ? 'text-green-700 dark:text-green-400 font-medium' : ''}>
                      {node.constraint.toFixed(4)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[0.6875rem] text-gray-400">
          {zh ? '低约束值（<0.3）= 结构洞位置（信息桥梁角色），高特征向量 = 连接到核心节点' : 'Low constraint (<0.3) = structural hole broker, high eigenvector = connected to well-connected nodes'}
        </p>
      </ChartCard>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// LSA Advanced Panel
// ═══════════════════════════════════════════════════════

export const LsaAdvancedPanel: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof researchApi.lsaAdvanced>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await researchApi.lsaAdvanced(courseId, { codeField: 'relation_type' }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading && !error) {
    return (
      <button onClick={run} className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400 hover:border-[#000080] hover:text-[#000080] transition-colors">
        <RemixIcon name="microscope-line" size={14} />
        {zh ? '加载高级序列分析（Yule\'s Q、显著转换、行为模式挖掘）' : 'Load Advanced LSA (Yule\'s Q, Patterns, Stationarity)'}
      </button>
    );
  }

  if (loading) return <div className="py-4 text-center text-xs text-gray-500 animate-pulse">{zh ? '计算高级序列指标...' : 'Computing advanced LSA...'}</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 px-3 py-2 text-xs text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4 mt-4 pt-4 border-t border-gray-100 dark:border-gray-900">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
        <RemixIcon name="microscope-line" size={12} />
        {zh ? '高级序列分析 (知识建构关系)' : 'Advanced Sequential Analysis (KB Relations)'}
      </h4>

      {/* Stationarity check */}
      <div className={`rounded-lg px-4 py-3 text-xs ${data.stationarity.isStationary ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'}`}>
        <span className="font-medium">{zh ? '平稳性检验' : 'Stationarity Test'}:</span>{' '}
        {data.stationarity.isStationary
          ? (zh ? '序列平稳 (p > 0.05)，行为模式在前后半段保持一致' : 'Stationary (p > 0.05) — patterns consistent across halves')
          : (zh ? '序列非平稳 (p ≤ 0.05)，行为模式在前后半段存在显著变化' : 'Non-stationary (p ≤ 0.05) — patterns shifted between halves')
        }
        <span className="ml-2 font-mono">χ² = {data.stationarity.chiSquare}, df = {data.stationarity.df}</span>
      </div>

      {/* Significant Transitions */}
      {data.significantTransitions.length > 0 && (
        <ChartCard
          title={zh ? '显著行为转换（|z| > 1.96）' : 'Significant Transitions (|z| > 1.96)'}
          onDownloadCsv={() => downloadCsv(data.significantTransitions.map(t => ({ from: t.from, to: t.to, freq: t.freq, zScore: t.zScore, yulesQ: t.yulesQ, pValue: t.pValue, direction: t.direction })), 'lsa_significant_transitions.csv')}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-900 bg-gray-50 dark:bg-gray-950">
                  <th className="px-2 py-2 text-left font-medium text-gray-500">{zh ? '前行为' : 'From'}</th>
                  <th className="px-2 py-2 text-center font-medium text-gray-500">→</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-500">{zh ? '后行为' : 'To'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '频次' : 'Freq'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">z</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">Yule's Q</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">p</th>
                  <th className="px-2 py-2 text-center font-medium text-gray-500">{zh ? '方向' : 'Dir'}</th>
                </tr>
              </thead>
              <tbody>
                {data.significantTransitions.slice(0, 20).map((t, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-900/50">
                    <td className="px-2 py-1.5 font-medium text-gray-700 dark:text-gray-300">{t.from}</td>
                    <td className="px-2 py-1.5 text-center text-gray-400">→</td>
                    <td className="px-2 py-1.5 font-medium text-gray-700 dark:text-gray-300">{t.to}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.freq}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${t.zScore > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{t.zScore.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.yulesQ.toFixed(3)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-mono text-[0.6875rem]">{t.pValue < 0.001 ? '<.001' : t.pValue < 0.01 ? '<.01' : '<.05'}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium ${t.direction === 'excitatory' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                        {t.direction === 'excitatory' ? (zh ? '激发' : '↑') : (zh ? '抑制' : '↓')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[0.6875rem] text-gray-400">
            {zh ? 'Yule\'s Q: 效果量（-1到+1），激发=显著高于期望频率，抑制=显著低于期望频率' : "Yule's Q: effect size (-1 to +1), excitatory = above expected, inhibitory = below expected"}
          </p>
        </ChartCard>
      )}

      {/* Sequential Patterns */}
      {data.patterns.length > 0 && (
        <ChartCard title={zh ? '频繁序列模式' : 'Frequent Sequential Patterns'}>
          <div className="flex flex-wrap gap-2">
            {data.patterns.slice(0, 15).map((p, i) => (
              <div key={i} className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-800 px-2.5 py-1.5">
                {p.pattern.map((code, ci) => (
                  <React.Fragment key={ci}>
                    {ci > 0 && <span className="text-gray-300 dark:text-gray-600">→</span>}
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{code}</span>
                  </React.Fragment>
                ))}
                <span className="ml-1.5 text-[0.6875rem] text-gray-400">×{p.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {/* Actor Transition Diversity */}
      {Object.keys(data.actorTransitions).length > 0 && (
        <ChartCard
          title={zh ? '个体行为转换多样性' : 'Actor Transition Diversity'}
          onDownloadCsv={() => downloadCsv(Object.entries(data.actorTransitions).map(([id, v]) => ({ authorId: id, dominantPattern: v.dominantPattern, diversity: v.diversity })), 'lsa_actor_diversity.csv')}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-900 bg-gray-50 dark:bg-gray-950">
                  <th className="px-2 py-2 text-left font-medium text-gray-500">{zh ? '参与者' : 'Actor'}</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-500">{zh ? '主导模式' : 'Dominant'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '多样性' : 'Diversity'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '可视化' : 'Visual'}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.actorTransitions)
                  .sort(([, a], [, b]) => b.diversity - a.diversity)
                  .slice(0, 20)
                  .map(([id, v]) => (
                    <tr key={id} className="border-b border-gray-50 dark:border-gray-900/50">
                      <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400">{id.slice(0, 8)}</td>
                      <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">{v.dominantPattern}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{v.diversity.toFixed(3)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="inline-flex h-2 w-16 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800">
                          <div className="h-full bg-[#000080] rounded-full" style={{ width: `${v.diversity * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[0.6875rem] text-gray-400">
            {zh ? '多样性 = 归一化 Shannon 熵（0=完全单一，1=完全均匀），衡量个体行为转换模式的丰富程度' : 'Diversity = normalized Shannon entropy (0=homogeneous, 1=uniform)'}
          </p>
        </ChartCard>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// Temporal Advanced Panel
// ═══════════════════════════════════════════════════════

export const TemporalAdvancedPanel: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof researchApi.temporalAdvanced>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const momentumRef = useRef<SVGSVGElement>(null);

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await researchApi.temporalAdvanced(courseId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading && !error) {
    return (
      <button onClick={run} className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400 hover:border-[#000080] hover:text-[#000080] transition-colors">
        <RemixIcon name="microscope-line" size={14} />
        {zh ? '加载高级时序分析（学习会话、规律性、动量、阶段检测、作息聚类）' : 'Load Advanced Temporal (Sessions, Regularity, Momentum, Phases)'}
      </button>
    );
  }

  if (loading) return <div className="py-4 text-center text-xs text-gray-500 animate-pulse">{zh ? '计算高级时序指标...' : 'Computing advanced temporal...'}</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 px-3 py-2 text-xs text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4 mt-4 pt-4 border-t border-gray-100 dark:border-gray-900">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
        <RemixIcon name="microscope-line" size={12} />
        {zh ? '高级时序分析' : 'Advanced Temporal Analysis'}
      </h4>

      {/* Session Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label={zh ? '学习会话数' : 'Total Sessions'} value={data.sessions.stats.totalSessions} />
        <MetricCard label={zh ? '平均时长 (min)' : 'Avg Duration (min)'} value={data.sessions.stats.avgDuration} />
        <MetricCard label={zh ? '中位时长' : 'Median (min)'} value={data.sessions.stats.medianDuration} />
        <MetricCard label={zh ? '每次活动数' : 'Avg Activities'} value={data.sessions.stats.avgActivityPerSession} />
      </div>

      {/* Momentum Chart */}
      {data.momentum.length > 2 && (
        <ChartCard title={zh ? '活跃度动量曲线' : 'Activity Momentum'} onDownloadPng={() => downloadSvgAsPng(momentumRef.current, 'temporal_momentum.png')} onDownloadCsv={() => downloadCsv(data.momentum as unknown as Record<string, unknown>[], 'temporal_momentum.csv')}>
          <VizDualAxis
            ref={momentumRef}
            series1={data.momentum.map(p => ({ label: p.date, value: p.rate }))}
            series2={data.momentum.map(p => ({ label: p.date, value: p.acceleration }))}
            s1Label={zh ? '速率' : 'Rate'}
            s2Label={zh ? '加速度' : 'Accel'}
            height={180}
          />
          <p className="text-[0.6875rem] text-gray-400 mt-2">{zh ? '蓝线=7天滑动窗口日均活跃度，橙虚线=加速度（正=增长，负=衰退）' : 'Blue = 7-day moving avg rate, Orange dashed = acceleration'}</p>
        </ChartCard>
      )}

      {/* Phase Detection */}
      {data.phases.length > 1 && (
        <ChartCard title={zh ? '活跃阶段检测 (CUSUM)' : 'Activity Phase Detection (CUSUM)'}>
          <div className="flex flex-wrap gap-2">
            {data.phases.map((p, i) => (
              <div key={i} className={`rounded-lg border px-3 py-2 ${p.phase === 'high' ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20' : p.phase === 'low' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20' : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950'}`}>
                <div className="text-[0.6875rem] text-gray-500">{p.startDate} → {p.endDate}</div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className={`text-xs font-medium ${p.phase === 'high' ? 'text-green-700 dark:text-green-300' : p.phase === 'low' ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>
                    {p.phase === 'high' ? (zh ? '高活跃期' : 'High') : p.phase === 'low' ? (zh ? '低活跃期' : 'Low') : (zh ? '正常期' : 'Normal')}
                  </span>
                  <span className="text-[0.6875rem] text-gray-400">{zh ? `日均 ${p.avgActivity}` : `avg ${p.avgActivity}/day`}</span>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {/* Regularity Analysis */}
      {Object.keys(data.regularity).length > 0 && (
        <ChartCard
          title={zh ? '学习规律性分析' : 'Learning Regularity Analysis'}
          onDownloadCsv={() => downloadCsv(Object.entries(data.regularity).map(([id, r]) => ({ authorId: id, ...r })), 'temporal_regularity.csv')}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-900 bg-gray-50 dark:bg-gray-950">
                  <th className="px-2 py-2 text-left font-medium text-gray-500">{zh ? '参与者' : 'Author'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '规律性' : 'Regularity'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '平均间隔(min)' : 'Avg Gap (min)'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '间隔标准差' : 'Std Gap'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '熵值' : 'Entropy'}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.regularity)
                  .sort(([, a], [, b]) => b.regularityScore - a.regularityScore)
                  .slice(0, 20)
                  .map(([id, r]) => (
                    <tr key={id} className="border-b border-gray-50 dark:border-gray-900/50">
                      <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400">{id.slice(0, 8)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <div className="h-2 w-12 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800">
                            <div className="h-full bg-[#000080] rounded-full" style={{ width: `${r.regularityScore * 100}%` }} />
                          </div>
                          <span className="tabular-nums">{r.regularityScore.toFixed(3)}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.avgInterval}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.stdInterval}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.entropy.toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[0.6875rem] text-gray-400">
            {zh ? '规律性 = 1 - 归一化熵（1=非常规律，0=完全随机），高规律性学生倾向于固定时间学习' : 'Regularity = 1 - normalized entropy (1=very regular, 0=random)'}
          </p>
        </ChartCard>
      )}

      {/* Circadian Rhythm Clusters */}
      {data.rhythmClusters.length > 0 && (
        <ChartCard title={zh ? '作息节律聚类' : 'Circadian Rhythm Clusters'}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-3">
            {['morning', 'afternoon', 'evening', 'night'].map(type => {
              const count = data.rhythmClusters.filter(r => r.type === type).length;
              const labels: Record<string, string> = zh
                ? { morning: '晨型 (6-12)', afternoon: '午型 (12-18)', evening: '夜型 (18-24)', night: '深夜型 (0-6)' }
                : { morning: 'Morning (6-12)', afternoon: 'Afternoon (12-18)', evening: 'Evening (18-24)', night: 'Night (0-6)' };
              return (
                <div key={type} className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 text-center">
                  <div className="text-[0.6875rem] text-gray-500">{labels[type]}</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{count} {zh ? '人' : ''}</div>
                </div>
              );
            })}
          </div>
        </ChartCard>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// Discourse Advanced Panel
// ═══════════════════════════════════════════════════════

export const DiscourseAdvancedPanel: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof researchApi.discourseAdvanced>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const levelRef = useRef<SVGSVGElement>(null);

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await researchApi.discourseAdvanced(courseId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading && !error) {
    return (
      <button onClick={run} className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400 hover:border-[#000080] hover:text-[#000080] transition-colors">
        <RemixIcon name="microscope-line" size={14} />
        {zh ? '加载高级话语分析（KB话语层级、观点多样性、集体认知责任、生产性对话）' : 'Load Advanced Discourse (KB Levels, Diversity, CCR, Productive)'}
      </button>
    );
  }

  if (loading) return <div className="py-4 text-center text-xs text-gray-500 animate-pulse">{zh ? '计算高级话语指标...' : 'Computing advanced discourse...'}</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 px-3 py-2 text-xs text-red-600">{error}</div>;
  if (!data) return null;

  const levelLabels: Record<number, string> = zh
    ? { 1: 'L1: 简单断言', 2: 'L2: 有据阐释', 3: 'L3: 综合联结', 4: 'L4: 理论提升' }
    : { 1: 'L1: Assertion', 2: 'L2: Explanation', 3: 'L3: Synthesis', 4: 'L4: Rise-above' };

  const levelColors = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'];

  return (
    <div className="space-y-4 mt-4 pt-4 border-t border-gray-100 dark:border-gray-900">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
        <RemixIcon name="microscope-line" size={12} />
        {zh ? '高级话语分析' : 'Advanced Discourse Analysis'}
      </h4>

      {/* KB Discourse Levels */}
      <ChartCard title={zh ? '知识建构话语层级分布 (van Aalst 2009)' : 'KB Discourse Levels (van Aalst 2009)'} onDownloadPng={() => downloadSvgAsPng(levelRef.current, 'discourse_kb_levels.png')}>
        <div className="flex items-center gap-4 mb-3">
          <span className="text-xs text-gray-500">{zh ? '平均话语层级' : 'Avg Level'}:</span>
          <span className="text-lg font-semibold text-[#000080]">{data.kbDiscourse.avgLevel.toFixed(2)}</span>
        </div>
        <VizStackedBar
          ref={levelRef}
          segments={[1, 2, 3, 4].map((level, i) => ({
            label: levelLabels[level],
            value: (data.kbDiscourse.levelDistribution as Record<number, number>)[level] ?? 0,
            color: levelColors[i],
          }))}
        />

        {/* Progression over time */}
        {data.kbDiscourse.progression.length === 3 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium">{zh ? '话语层级演变：' : 'Progression:'}</span>
            {data.kbDiscourse.progression.map((v, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-gray-300">→</span>}
                <span className={`font-medium ${v > data.kbDiscourse.avgLevel ? 'text-green-600' : v < data.kbDiscourse.avgLevel ? 'text-red-600' : ''}`}>
                  {v.toFixed(2)}
                </span>
              </React.Fragment>
            ))}
            <span className="text-[0.6875rem] text-gray-400 ml-1">({zh ? '前/中/后期' : 'early/mid/late'})</span>
          </div>
        )}
      </ChartCard>

      {/* Collective Cognitive Responsibility */}
      <ChartCard title={zh ? '集体认知责任指数 (Zhang et al. 2009)' : 'Collective Cognitive Responsibility (Zhang et al. 2009)'}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-3">
          <MetricCard label={zh ? 'CCR 指数' : 'CCR Index'} value={data.collectiveCognitiveResponsibility.ccrIndex.toFixed(3)} color={data.collectiveCognitiveResponsibility.ccrIndex > 0.7 ? 'text-green-600' : data.collectiveCognitiveResponsibility.ccrIndex > 0.4 ? 'text-amber-600' : 'text-red-600'} />
          <MetricCard label={zh ? '参与改进者' : 'Contributors'} value={`${data.collectiveCognitiveResponsibility.participantsContributing}/${data.collectiveCognitiveResponsibility.totalParticipants}`} />
          <MetricCard label={zh ? 'L3+ 笔记占比' : 'L3+ Notes'} value={(() => { const total = data.collectiveCognitiveResponsibility.authorContributions.reduce((a, c) => a + c.created, 0); const l3 = data.collectiveCognitiveResponsibility.authorContributions.reduce((a, c) => a + c.level3Plus, 0); return total > 0 ? `${Math.round((l3 / total) * 100)}%` : '0%'; })()} />
        </div>
        <p className="text-[0.6875rem] text-gray-400">
          {zh ? 'CCR 指数衡量社区中主动改进他人观点的成员比例（>0.7 优秀，0.4-0.7 中等，<0.4 需关注）' : 'CCR measures proportion of members actively improving others\' ideas (>0.7 excellent, 0.4-0.7 moderate, <0.4 needs attention)'}
        </p>
      </ChartCard>

      {/* Productive Discourse */}
      <ChartCard title={zh ? '生产性对话指标' : 'Productive Discourse Indicators'}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-500 mb-1">{zh ? '提问 → 回应解决率' : 'Question Resolution Rate'}</div>
            <div className="flex items-center gap-2">
              <div className="h-3 flex-1 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800">
                <div className="h-full bg-[#000080] rounded-full" style={{ width: `${data.productiveDiscourse.questionResolutionRate * 100}%` }} />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{(data.productiveDiscourse.questionResolutionRate * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-0.5 text-[0.6875rem] text-gray-400">{data.productiveDiscourse.questionsResolved}/{data.productiveDiscourse.totalQuestions} {zh ? '已解决' : 'resolved'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">{zh ? '质疑 → 回应解决率' : 'Challenge Resolution Rate'}</div>
            <div className="flex items-center gap-2">
              <div className="h-3 flex-1 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800">
                <div className="h-full bg-[#d97706] rounded-full" style={{ width: `${data.productiveDiscourse.challengeResolutionRate * 100}%` }} />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{(data.productiveDiscourse.challengeResolutionRate * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-0.5 text-[0.6875rem] text-gray-400">{data.productiveDiscourse.challengesResolved}/{data.productiveDiscourse.totalChallenges} {zh ? '已解决' : 'resolved'}</div>
          </div>
        </div>
      </ChartCard>

      {/* Idea Diversity */}
      <ChartCard
        title={zh ? '观点多样性分析' : 'Idea Diversity Analysis'}
        onDownloadCsv={() => downloadCsv(data.ideaDiversity.topKeywords.map(k => ({ word: k.word, score: k.score, tf: k.tf, df: k.df })), 'discourse_keywords.csv')}
      >
        <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
          <span>{zh ? '词汇熵' : 'Vocab Entropy'}: <strong className="text-gray-900 dark:text-gray-100">{data.ideaDiversity.vocabularyEntropy}</strong></span>
          <span>{zh ? '独立词汇' : 'Unique Words'}: <strong className="text-gray-900 dark:text-gray-100">{data.ideaDiversity.uniqueWords.toLocaleString()}</strong></span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.ideaDiversity.topKeywords.slice(0, 20).map((kw, i) => (
            <span key={i} className="rounded-full border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[0.6875rem] text-gray-700 dark:text-gray-300" style={{ opacity: 0.5 + (kw.score / (data.ideaDiversity.topKeywords[0]?.score || 1)) * 0.5 }}>
              {kw.word}
            </span>
          ))}
        </div>
      </ChartCard>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// Equity Advanced Panel
// ═══════════════════════════════════════════════════════

export const EquityAdvancedPanel: React.FC<{ courseId: string; zh: boolean }> = ({ courseId, zh }) => {
  const [data, setData] = useState<Awaited<ReturnType<typeof researchApi.equityAdvanced>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const trendRef = useRef<SVGSVGElement>(null);

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await researchApi.equityAdvanced(courseId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading && !error) {
    return (
      <button onClick={run} className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400 hover:border-[#000080] hover:text-[#000080] transition-colors">
        <RemixIcon name="microscope-line" size={14} />
        {zh ? '加载高级公平性分析（Palma比率、声音公平、质量加权基尼、时序公平趋势）' : 'Load Advanced Equity (Palma Ratio, Voice, Quality-Weighted, Temporal Trend)'}
      </button>
    );
  }

  if (loading) return <div className="py-4 text-center text-xs text-gray-500 animate-pulse">{zh ? '计算高级公平性指标...' : 'Computing advanced equity...'}</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 px-3 py-2 text-xs text-red-600">{error}</div>;
  if (!data) return null;

  const trendLabel = data.equityTrend === 'improving' ? (zh ? '改善中 ↗' : 'Improving ↗')
    : data.equityTrend === 'worsening' ? (zh ? '恶化中 ↘' : 'Worsening ↘')
    : data.equityTrend === 'stable' ? (zh ? '稳定 →' : 'Stable →')
    : (zh ? '数据不足' : 'Insufficient data');

  const trendColor = data.equityTrend === 'improving' ? 'text-green-600' : data.equityTrend === 'worsening' ? 'text-red-600' : 'text-gray-600';

  return (
    <div className="space-y-4 mt-4 pt-4 border-t border-gray-100 dark:border-gray-900">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
        <RemixIcon name="microscope-line" size={12} />
        {zh ? '高级公平性分析' : 'Advanced Equity Analysis'}
      </h4>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MetricCard
          label={zh ? 'Palma 比率' : 'Palma Ratio'}
          value={data.palmaRatio === Infinity ? '∞' : data.palmaRatio.toFixed(2)}
          sub={data.palmaInterpretation === 'highly_unequal' ? (zh ? '高度不平等' : 'High inequality') : data.palmaInterpretation === 'moderately_unequal' ? (zh ? '中度不平等' : 'Moderate') : (zh ? '相对公平' : 'Relatively equal')}
          color={data.palmaInterpretation === 'highly_unequal' ? 'text-red-600' : data.palmaInterpretation === 'moderately_unequal' ? 'text-amber-600' : 'text-green-600'}
        />
        <MetricCard label={zh ? '声音公平' : 'Voice Equity'} value={`${(data.voiceEquity * 100).toFixed(0)}%`} sub={`${data.voiceDetails.neverRespondedTo} ${zh ? '人未被回应' : 'unheard'}`} />
        <MetricCard label={zh ? '质量加权基尼' : 'Quality Gini'} value={data.qualityWeightedGini.toFixed(4)} color={data.qualityWeightedGini > 0.4 ? 'text-red-600' : data.qualityWeightedGini > 0.25 ? 'text-amber-600' : 'text-green-600'} />
        <MetricCard label={zh ? '公平性趋势' : 'Equity Trend'} value={trendLabel} color={trendColor} />
        <MetricCard label={zh ? '互动多样性' : 'Interaction Div.'} value={data.interactionDiversity.length > 0 ? (data.interactionDiversity.reduce((a, d) => a + d.entropy, 0) / data.interactionDiversity.length).toFixed(3) : '—'} />
      </div>

      {/* Temporal Equity Trend */}
      {data.temporalEquity.length > 1 && (
        <ChartCard title={zh ? '公平性时序趋势（基尼系数随时间变化）' : 'Equity Over Time (Gini Trajectory)'} onDownloadPng={() => downloadSvgAsPng(trendRef.current, 'equity_trend.png')} onDownloadCsv={() => downloadCsv(data.temporalEquity as unknown as Record<string, unknown>[], 'equity_temporal.csv')}>
          <VizAreaLine
            ref={trendRef}
            data={data.temporalEquity.map(p => ({ label: p.windowStart, value: p.gini }))}
            refLines={[
              { y: 0.25, label: '0.25', color: '#10b981' },
              { y: 0.4, label: '0.40', color: '#ef4444' },
            ]}
            color="navy"
            height={160}
            yLabel="Gini"
          />
          <p className="text-[0.6875rem] text-gray-400 mt-2">
            {zh ? '绿线=0.25（公平阈值），红线=0.40（不平等阈值）。Palma比率 = 前10%贡献 / 后40%贡献（比Gini对极端值更敏感）' : 'Green=0.25 (equitable), Red=0.40 (unequal). Palma ratio = top 10% / bottom 40% (more sensitive to extremes than Gini)'}
          </p>
        </ChartCard>
      )}

      {/* Interaction Diversity Table */}
      {data.interactionDiversity.length > 0 && (
        <ChartCard title={zh ? '互动对象多样性' : 'Interaction Target Diversity'} onDownloadCsv={() => downloadCsv(data.interactionDiversity as unknown as Record<string, unknown>[], 'equity_interaction_diversity.csv')}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-900 bg-gray-50 dark:bg-gray-950">
                  <th className="px-2 py-2 text-left font-medium text-gray-500">{zh ? '参与者' : 'Author'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '互动对象数' : 'Targets'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '互动次数' : 'Total'}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-500">{zh ? '分散度' : 'Diversity'}</th>
                </tr>
              </thead>
              <tbody>
                {data.interactionDiversity
                  .sort((a, b) => b.entropy - a.entropy)
                  .slice(0, 15)
                  .map(d => (
                    <tr key={d.authorId} className="border-b border-gray-50 dark:border-gray-900/50">
                      <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400">{d.authorId.slice(0, 8)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{d.uniqueTargets}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{d.totalInteractions}</td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <div className="h-2 w-12 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800">
                            <div className="h-full bg-[#000080] rounded-full" style={{ width: `${d.entropy * 100}%` }} />
                          </div>
                          <span className="tabular-nums">{d.entropy.toFixed(3)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[0.6875rem] text-gray-400">
            {zh ? '高分散度 = 与多人均匀互动（好），低分散度 = 只与少数人互动（可能存在小圈子）' : 'High diversity = interacts evenly with many, Low = only interacts with few (potential cliques)'}
          </p>
        </ChartCard>
      )}
    </div>
  );
};
