import React, { useState, useCallback } from 'react';
import RemixIcon from '../RemixIcon';
import { agentRuns, type AgentRun, type AgentEffect, type AgentCheckpoint } from '../../services/apiClient';

interface AgentRunTraceProps {
  runId: string | null;
  lang: 'zh' | 'en';
  compact?: boolean;
}

const PHASE_CONFIG: Record<string, { icon: string; zh: string; en: string; color: string }> = {
  planning: { icon: 'draft-line', zh: '规划', en: 'Plan', color: 'text-violet-500' },
  gathering: { icon: 'database-2-line', zh: '采集', en: 'Gather', color: 'text-blue-500' },
  executing: { icon: 'play-circle-line', zh: '执行', en: 'Execute', color: 'text-amber-500' },
  reviewing: { icon: 'eye-line', zh: '审查', en: 'Review', color: 'text-emerald-500' },
  applied: { icon: 'check-double-line', zh: '完成', en: 'Applied', color: 'text-emerald-600' },
  failed: { icon: 'close-circle-line', zh: '失败', en: 'Failed', color: 'text-red-500' },
  cancelled: { icon: 'forbid-line', zh: '取消', en: 'Cancelled', color: 'text-zinc-400' },
};

const PHASE_ORDER = ['planning', 'gathering', 'executing', 'reviewing', 'applied'];

const EFFECT_ICONS: Record<string, string> = {
  run_started: 'play-line',
  plan_validated: 'checkbox-circle-line',
  context_gathered: 'folder-received-line',
  memory_loaded: 'brain-line',
  llm_started: 'sparkling-2-line',
  llm_completed: 'check-line',
  llm_error: 'error-warning-line',
  tool_called: 'tools-line',
  tool_result: 'arrow-right-line',
  plan_persisted: 'save-line',
  checkpoint_created: 'bookmark-line',
  rollback: 'arrow-go-back-line',
  error: 'alert-line',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const AgentRunTrace: React.FC<AgentRunTraceProps> = ({ runId, lang, compact = true }) => {
  const zh = lang === 'zh';
  const [expanded, setExpanded] = useState(false);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [effects, setEffects] = useState<AgentEffect[]>([]);
  const [checkpoints, setCheckpoints] = useState<AgentCheckpoint[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTrace = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await agentRuns.get(runId);
      setRun(data.run);
      setEffects(data.effects);
      setCheckpoints(data.checkpoints);
    } catch { /* non-critical */ }
    setLoading(false);
  }, [runId]);

  const toggleExpand = useCallback(() => {
    if (!expanded && !run) loadTrace();
    setExpanded((e) => !e);
  }, [expanded, run, loadTrace]);

  if (!runId) return null;

  const status = run?.status ?? 'executing';
  const cfg = PHASE_CONFIG[status] ?? PHASE_CONFIG.planning;
  const currentIdx = PHASE_ORDER.indexOf(status);

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/50">
      {/* Compact lifecycle bar */}
      <button
        onClick={toggleExpand}
        className="flex w-full items-center gap-3 px-3 py-2 transition-colors hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40"
      >
        <div className="flex flex-1 items-center gap-1">
          {PHASE_ORDER.map((phase, i) => {
            const pcfg = PHASE_CONFIG[phase];
            const isActive = phase === status;
            const isDone = i < currentIdx || status === 'applied';
            const isFailed = status === 'failed' && i === currentIdx;
            return (
              <React.Fragment key={phase}>
                {i > 0 && (
                  <div className={`h-px flex-1 ${isDone ? 'bg-emerald-400 dark:bg-emerald-600' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
                )}
                <div
                  className={`flex h-6 items-center gap-1 rounded-full px-2 text-[0.6875rem] font-medium transition-colors ${
                    isFailed
                      ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                      : isActive
                        ? 'bg-[#000080]/[0.08] text-[#000080] dark:bg-[#4169E1]/[0.15] dark:text-[#93AAFD]'
                        : isDone
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-zinc-400 dark:text-zinc-600'
                  }`}
                  title={zh ? pcfg.zh : pcfg.en}
                >
                  <RemixIcon
                    name={isFailed ? 'close-circle-line' : isDone ? 'check-line' : pcfg.icon}
                    size={11}
                  />
                  {(!compact || isActive) && (
                    <span>{zh ? pcfg.zh : pcfg.en}</span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <RemixIcon
          name={expanded ? 'arrow-up-s-line' : 'arrow-down-s-line'}
          size={14}
          className="text-zinc-400"
        />
      </button>

      {/* Expanded: effect timeline */}
      {expanded && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {loading ? (
            <div className="flex items-center gap-2 py-3">
              <RemixIcon name="loader-4-line" size={14} className="animate-spin text-zinc-400" />
              <span className="text-xs text-zinc-400">{zh ? '加载中...' : 'Loading...'}</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {effects.map((e) => (
                <div key={e.id} className="flex items-start gap-2 py-1">
                  <RemixIcon
                    name={EFFECT_ICONS[e.effect_type] ?? 'circle-line'}
                    size={12}
                    className={`mt-0.5 flex-shrink-0 ${
                      e.effect_type.includes('error') ? 'text-red-500' : 'text-zinc-400 dark:text-zinc-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-[0.6875rem] font-medium text-zinc-600 dark:text-zinc-400">
                      {e.effect_type.replace(/_/g, ' ')}
                    </span>
                    {e.payload && Object.keys(e.payload).length > 0 && (
                      <span className="ml-1.5 text-[0.6875rem] text-zinc-400 dark:text-zinc-500">
                        {Object.entries(e.payload)
                          .filter(([, v]) => v !== null && v !== undefined && v !== '')
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                          .join(' · ')}
                      </span>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-[0.6875rem] tabular-nums text-zinc-400 dark:text-zinc-600">
                    {formatTime(e.created_at)}
                  </span>
                </div>
              ))}

              {checkpoints.length > 0 && (
                <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                  <div className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-400">
                    {zh ? '检查点' : 'Checkpoints'}
                  </div>
                  {checkpoints.map((cp) => (
                    <div key={cp.id} className="flex items-center gap-2 py-0.5">
                      <RemixIcon name="bookmark-line" size={11} className="text-amber-500" />
                      <span className="text-[0.6875rem] font-medium text-zinc-600 dark:text-zinc-400">{cp.name}</span>
                      <span className="text-[0.6875rem] text-zinc-400">seq {cp.seq_at}</span>
                    </div>
                  ))}
                </div>
              )}

              {effects.length === 0 && !loading && (
                <div className="py-2 text-center text-xs text-zinc-400">
                  {zh ? '暂无事件' : 'No events yet'}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentRunTrace;
