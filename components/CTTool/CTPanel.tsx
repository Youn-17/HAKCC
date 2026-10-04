import React, { useCallback, useEffect, useMemo, useState } from 'react';
import RemixIcon from '../RemixIcon';
import CTWorkbench from './CTWorkbench';
import { ctTool, type CtProblem } from '../../services/apiClient';
import { Language } from '../../types';

interface CTPanelProps {
  courseId: string;
  lang: Language;
  onClose?: () => void;
}

const DIFF_META: Record<string, { zh: string; cls: string }> = {
  easy: { zh: '简单', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
  medium: { zh: '中等', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
  hard: { zh: '困难', cls: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300' },
};

const SOURCE_META: Record<string, { zh: string; icon: string; cls: string }> = {
  builtin: { zh: '经典问题', icon: 'book-2-line', cls: 'text-stone-400' },
  teacher: { zh: '老师提出', icon: 'user-star-line', cls: 'text-[#000080] dark:text-[#93AAFD]' },
  student: { zh: '同学提出', icon: 'user-smile-line', cls: 'text-emerald-600 dark:text-emerald-400' },
};

const STEP_LABELS: Record<string, string> = {
  decomposition: '分解', pattern: '模式', abstraction: '抽象', algorithm: '算法', code: '编码',
};

const CTPanel: React.FC<CTPanelProps> = ({ courseId, onClose }) => {
  const [tab, setTab] = useState<'library' | 'mine' | 'analysis'>('library');
  const [problems, setProblems] = useState<CtProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeProblem, setActiveProblem] = useState<CtProblem | null>(null);
  const [showPropose, setShowPropose] = useState(false);
  const [stats, setStats] = useState<{ attempted: number; completed: number; published: number; totalProblems: number; stepCounts: Record<string, number> } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    ctTool.problems(courseId)
      .then(res => setProblems(res.problems))
      .catch(() => setProblems([]))
      .finally(() => setLoading(false));
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'analysis') return;
    ctTool.myStats(courseId).then(res => setStats(res.stats)).catch(() => setStats(null));
  }, [tab, courseId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return problems;
    return problems.filter(p =>
      p.title.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q)
      || p.category.toLowerCase().includes(q));
  }, [problems, search]);

  const mine = useMemo(() => problems.filter(p => p.myStatus !== 'not_started'), [problems]);

  if (activeProblem) {
    return (
      <CTWorkbench
        courseId={courseId}
        problem={activeProblem}
        onClose={() => { setActiveProblem(null); load(); }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-stone-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-5 py-3 dark:border-stone-800 dark:bg-gray-950">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#000080]/[0.06] dark:bg-[#4169E1]/15">
            <RemixIcon name="flow-chart" size={17} className="text-[#000080] dark:text-[#93AAFD]" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">计算思维工具</h2>
            <p className="text-[0.6562rem] text-stone-400">分解 · 模式 · 抽象 · 算法 · 编码——五步解决真实问题</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-900">
          {([['library', '问题库'], ['mine', '我的进展'], ['analysis', '能力分析']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-lg px-3.5 py-1.5 text-[0.75rem] font-semibold transition-all ${tab === key
                ? 'bg-white text-[#000080] shadow-sm dark:bg-stone-800 dark:text-[#93AAFD]'
                : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {onClose && (
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200">
            <RemixIcon name="close-line" size={18} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── Library ── */}
        {tab === 'library' && (
          <div className="mx-auto max-w-4xl space-y-4 p-5">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <RemixIcon name="search-line" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜索问题（标题 / 描述 / 类别）"
                  className="w-full rounded-xl border border-stone-200 bg-white py-2.5 pl-9 pr-3 text-[0.8125rem] text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                />
              </div>
              <button
                onClick={() => setShowPropose(true)}
                className="flex items-center gap-1.5 rounded-xl bg-[#000080] px-4 py-2.5 text-[0.8125rem] font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] dark:bg-[#4169E1]"
              >
                <RemixIcon name="add-line" size={15} />
                提出问题
              </button>
            </div>

            <p className="flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-stone-400">
              <RemixIcon name="lightbulb-line" size={12} className="mt-0.5 flex-shrink-0 text-amber-500" />
              知识建构从真实问题开始——生活里遇到的、课堂上争论过的问题，都可以提出来让大家用计算思维拆解。
            </p>

            {loading ? (
              <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-400 dark:border-stone-800 dark:bg-stone-950">
                没有匹配的问题
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filtered.map(p => {
                  const diff = DIFF_META[p.difficulty] ?? DIFF_META.medium;
                  const src = SOURCE_META[p.source] ?? SOURCE_META.builtin;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setActiveProblem(p)}
                      className="group flex flex-col rounded-2xl border border-stone-200 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-[#000080]/25 hover:shadow-md active:scale-[0.99] dark:border-stone-800 dark:bg-stone-950 dark:hover:border-[#4169E1]/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${diff.cls}`}>{diff.zh}</span>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[0.6875rem] font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">{p.category}</span>
                        <span className={`ml-auto flex items-center gap-1 text-[0.6875rem] ${src.cls}`}>
                          <RemixIcon name={src.icon} size={11} />
                          {src.zh}{p.proposerName ? ` · ${p.proposerName}` : ''}
                        </span>
                      </div>
                      <h3 className="mt-2.5 text-[0.9375rem] font-bold tracking-tight text-stone-900 transition-colors group-hover:text-[#000080] dark:text-stone-100 dark:group-hover:text-[#93AAFD]">
                        {p.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-[0.75rem] leading-relaxed text-stone-500 dark:text-stone-400">{p.description}</p>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[0.6562rem] text-stone-400">
                          <RemixIcon name="team-line" size={11} />
                          {p.solverCount} 人在解
                        </span>
                        {p.myStatus === 'not_started' ? (
                          <span className="flex items-center gap-1 text-[0.7188rem] font-bold text-[#000080] transition-transform group-hover:translate-x-0.5 dark:text-[#93AAFD]">
                            开始挑战 <RemixIcon name="arrow-right-line" size={12} />
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                              <div className={`h-full rounded-full ${p.myStatus === 'completed' ? 'bg-emerald-500' : 'bg-[#000080] dark:bg-[#4169E1]'}`} style={{ width: `${p.myProgress}%` }} />
                            </div>
                            <span className="text-[0.6562rem] font-semibold tabular-nums text-stone-500">{p.myProgress}%</span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── My progress ── */}
        {tab === 'mine' && (
          <div className="mx-auto max-w-3xl space-y-3 p-5">
            {mine.length === 0 ? (
              <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center dark:border-stone-800 dark:bg-stone-950">
                <RemixIcon name="compass-3-line" size={28} className="mx-auto text-stone-300 dark:text-stone-600" />
                <p className="mt-2 text-sm text-stone-500">还没开始任何问题——去问题库挑一个感兴趣的吧</p>
              </div>
            ) : (
              mine.map(p => (
                <button
                  key={p.id}
                  onClick={() => setActiveProblem(p)}
                  className="flex w-full items-center gap-4 rounded-2xl border border-stone-200 bg-white p-4 text-left transition-all hover:border-[#000080]/25 hover:shadow-sm dark:border-stone-800 dark:bg-stone-950 dark:hover:border-[#4169E1]/40"
                >
                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${p.myStatus === 'completed' ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-[#000080]/[0.06] dark:bg-[#4169E1]/15'}`}>
                    <RemixIcon name={p.myStatus === 'completed' ? 'checkbox-circle-fill' : 'time-line'} size={18} className={p.myStatus === 'completed' ? 'text-emerald-500' : 'text-[#000080] dark:text-[#93AAFD]'} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">{p.title}</div>
                    <div className="mt-1.5 flex h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                      <div className={`h-full rounded-full transition-all ${p.myStatus === 'completed' ? 'bg-emerald-500' : 'bg-[#000080] dark:bg-[#4169E1]'}`} style={{ width: `${p.myProgress}%` }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold tabular-nums text-stone-900 dark:text-stone-100">{p.myProgress}%</div>
                    {p.updatedAt && <div className="text-[0.5938rem] text-stone-400">{new Date(p.updatedAt).toLocaleDateString()}</div>}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* ── Analysis (real data) ── */}
        {tab === 'analysis' && (
          <div className="mx-auto max-w-3xl space-y-4 p-5">
            {!stats ? (
              <div className="h-40 animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: '尝试过的问题', value: `${stats.attempted}/${stats.totalProblems}`, icon: 'flag-line', color: 'text-[#000080] dark:text-[#93AAFD]' },
                    { label: '完成五步', value: stats.completed, icon: 'checkbox-circle-line', color: 'text-emerald-600' },
                    { label: '发布到社区', value: stats.published, icon: 'send-plane-line', color: 'text-amber-600' },
                  ].map(s => (
                    <div key={s.label} className="rounded-2xl border border-stone-200 bg-white p-4 text-center dark:border-stone-800 dark:bg-stone-950">
                      <RemixIcon name={s.icon} size={18} className={`mx-auto ${s.color}`} />
                      <div className="mt-1.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100">{s.value}</div>
                      <div className="text-[0.6562rem] text-stone-400">{s.label}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
                  <h4 className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">五步能力覆盖</h4>
                  <div className="space-y-2.5">
                    {Object.entries(STEP_LABELS).map(([key, label]) => {
                      const count = stats.stepCounts[key] ?? 0;
                      const max = Math.max(stats.attempted, 1);
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <span className="w-10 flex-shrink-0 text-[0.75rem] font-medium text-stone-600 dark:text-stone-300">{label}</span>
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                            <div className="h-full rounded-full bg-[#000080]/70 transition-all duration-500 dark:bg-[#4169E1]/70" style={{ width: `${(count / max) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right text-[0.6875rem] tabular-nums text-stone-500">{count} 次</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-[0.6875rem] leading-relaxed text-stone-400">
                    哪一步完成得最少？那可能是你的思维盲区——下次解题时刻意多停留一会儿。
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Propose problem modal */}
      {showPropose && (
        <ProposeModal
          courseId={courseId}
          onClose={() => setShowPropose(false)}
          onCreated={() => { setShowPropose(false); load(); }}
        />
      )}
    </div>
  );
};

const ProposeModal: React.FC<{ courseId: string; onClose: () => void; onCreated: () => void }> = ({ courseId, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim() || !description.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await ctTool.propose(courseId, { title: title.trim(), description: description.trim(), category: category.trim() || 'general', difficulty });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-800 dark:bg-gray-950 animate-in zoom-in-95 duration-200">
        <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">提出一个问题</h3>
        <p className="mt-1 text-[0.75rem] leading-relaxed text-stone-500 dark:text-stone-400">
          真实的问题最有力量——可以来自生活、课堂讨论或你的好奇心，全班都能用计算思维来挑战它。
        </p>
        <div className="mt-4 space-y-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={100}
            placeholder="问题标题，如「怎样安排值日表最公平？」"
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[0.8125rem] text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="描述问题的背景和要解决什么。不需要知道答案——提出好问题本身就是贡献。"
            className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          />
          <div className="flex gap-2">
            <input
              value={category}
              onChange={e => setCategory(e.target.value)}
              maxLength={30}
              placeholder="类别（可选）"
              className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-[0.8125rem] text-stone-800 outline-none placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
            <select
              value={difficulty}
              onChange={e => setDifficulty(e.target.value)}
              className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-[0.8125rem] text-stone-700 outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            >
              <option value="easy">简单</option>
              <option value="medium">中等</option>
              <option value="hard">困难</option>
            </select>
          </div>
          {error && <p className="text-[0.75rem] text-rose-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={submit}
              disabled={!title.trim() || !description.trim() || submitting}
              className="flex-1 rounded-xl bg-[#000080] py-2.5 text-sm font-bold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-40 dark:bg-[#4169E1]"
            >
              {submitting ? '提交中…' : '发布问题'}
            </button>
            <button onClick={onClose} className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CTPanel;
