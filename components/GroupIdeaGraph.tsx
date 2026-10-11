import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MORANDI } from './morandiPalette';
import { X, RefreshCw, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { groups as groupsApi, type IdeaGraphHistoryItem, type IdeaGraphSnapshot } from '../services/apiClient';
import IdeaGraphCanvas from './IdeaGraphCanvas';
import { motionAllowed } from '../hooks/useLayoutMotion';

/**
 * 小组观点图谱。
 *
 * 一个主题做三五周之后，组里几十条笔记堆在画布上，学生说不清「我们谈到哪了」。
 * 这个面板把已经发生的讨论组织成一眼能看懂的形状：哪些观点在场、谁的问题还没人答、
 * 这一周长出了什么。
 *
 * 它只做**定位**，不做**综合** —— 图上没有任何一句是系统替学生下的结论。
 * 那个「更高一层的新说法」仍然是他们自己要写的。
 *
 * 2026-10-11：每周一期，可以切到往期看（同一个观点在两期之间滑过去，看得出图是怎么长出来的）；
 * 画法见 IdeaGraphCanvas，布局与分群见 ideaGraphLayout。
 */

interface Props {
  groupId: string;
  groupName: string;
  lang: 'zh' | 'en';
  /** 课程教职（按课内身份，不是平台身份）。只有他们能手动重算一期，后端同样只放行课程教职。 */
  isTeacher: boolean;
  /** 点图上的笔记 → 回到画布定位到它 */
  onLocateNote?: (noteId: string) => void;
  onClose: () => void;
}

const T = {
  zh: {
    title: '观点图谱', period: '每周自动生成一期', refresh: '重新生成',
    loading: '正在生成本期图谱⋯⋯', pending: '笔记数量尚不足',
    pendingHint: (have: number, need: number) => `现在有 ${have} 条笔记，满 ${need} 条之后会生成第一期图谱。`,
    notes: '笔记', newNotes: '本期新增', members: '本期参与', buildOns: 'Build-on 次数', aiNotes: 'AI 笔记',
    conceptHint: '圆圈越大，参与讨论的人越多；颜色相同的观点常在同一条笔记里一起出现；连线越粗，两个观点越常一起出现。圆圈可以拖动，点一下看相关笔记。',
    growing: '本期讨论增长的观点', unanswered: '尚无人建构', questions: '组内提出的问题',
    chains: 'Build-on 链最长的观点', answered: '已被建构', notAnswered: '尚无人建构',
    depth: '层', people: '人', daysOpen: '天未被建构',
    clickNote: '点击在画布中定位', nothing: '本期尚无新的讨论',
    coveredBy: '篇笔记', byPeople: '人参与讨论', windowLabel: '覆盖',
    fail: '没能取到图谱', retry: '重试',
    showLabels: '显示标签', periods: '往期', latest: '最新', manual: '手动', backToLatest: '回到最新',
    pastPeriod: '往期', periodFail: '这一期没能打开，请再试一次。', prev: '上一期', next: '下一期',
    closeConcept: '收起',
  },
  en: {
    title: 'Idea Graph', period: 'Generated weekly', refresh: 'Regenerate',
    loading: 'Organising this period…', pending: 'Not enough notes yet',
    pendingHint: (have: number, need: number) => `${have} notes so far; the first graph appears at ${need}.`,
    notes: 'Notes', newNotes: 'New', members: 'Active', buildOns: 'Build-ons', aiNotes: 'AI notes',
    conceptHint: 'Bigger circle: more people discussing the idea. Same colour: ideas that often appear in the same notes. Thicker line: the two appear together more often. Drag circles; click one to see its notes.',
    growing: 'More discussed', unanswered: 'Not built on yet', questions: 'Questions raised',
    chains: 'Longest build-on chains', answered: 'built on', notAnswered: 'not built on',
    depth: 'deep', people: 'people', daysOpen: 'days without a build-on',
    clickNote: 'Open on canvas', nothing: 'No new discussion this period',
    coveredBy: 'notes', byPeople: 'people', windowLabel: 'covering',
    fail: 'Could not load the graph', retry: 'Retry',
    showLabels: 'Show labels', periods: 'Weeks', latest: 'Latest', manual: 'Manual', backToLatest: 'Back to latest',
    pastPeriod: 'Past week', periodFail: 'This week could not be opened. Please try again.', prev: 'Previous week', next: 'Next week',
    closeConcept: 'Close',
  },
};

const summaryOf = (g: IdeaGraphSnapshot): IdeaGraphHistoryItem => ({
  id: g.id, generated_at: g.generated_at, window_start: g.window_start, window_end: g.window_end, note_count: g.note_count, trigger: g.trigger,
});

const GroupIdeaGraph: React.FC<Props> = ({ groupId, groupName, lang, isTeacher, onLocateNote, onClose }) => {
  const t = T[lang];
  const [snap, setSnap] = useState<IdeaGraphSnapshot | null>(null);
  const [latestId, setLatestId] = useState<string | null>(null);
  const [history, setHistory] = useState<IdeaGraphHistoryItem[]>([]);
  const [pending, setPending] = useState<{ have: number; need: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodError, setPeriodError] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const cache = useRef(new Map<string, IdeaGraphSnapshot>());
  const wanted = useRef<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const show = useCallback((graph: IdeaGraphSnapshot) => {
    cache.current.set(graph.id, graph);
    wanted.current = graph.id;
    setSnap(graph);
    setPeriodError('');
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await groupsApi.ideaGraph(groupId);
      setHistory(res.history ?? (res.graph ? [summaryOf(res.graph)] : []));
      setLatestId(res.graph?.id ?? null);
      if (res.graph) show(res.graph); else setSnap(null);
      setPending(res.pending ? { have: res.haveNotes ?? 0, need: res.needNotes ?? 3 } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.fail);
    } finally {
      setLoading(false);
    }
  }, [groupId, t.fail, show]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true); setError(null);
    try {
      const res = await groupsApi.refreshIdeaGraph(groupId);
      if (res.graph) {
        setHistory(res.history ?? [summaryOf(res.graph), ...history]);
        setLatestId(res.graph.id);
        show(res.graph);
      }
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.fail);
    } finally {
      setRefreshing(false);
    }
  };

  /** 切到某一期：取过的直接换，没取过的先取（取到之前图不动，取到后滑过去） */
  const openPeriod = async (id: string) => {
    if (id === snap?.id) return;
    const cached = cache.current.get(id);
    wanted.current = id;
    if (cached) { show(cached); return; }
    setSwitching(id);
    setPeriodError('');
    try {
      const { graph } = await groupsApi.ideaGraphSnapshot(groupId, id);
      cache.current.set(graph.id, graph);
      if (wanted.current === id) show(graph);
    } catch {
      if (wanted.current === id) setPeriodError(t.periodFail);
    } finally {
      setSwitching(s => (s === id ? null : s));
    }
  };

  const periods = useMemo(() => [...history].sort((a, b) => a.window_end.localeCompare(b.window_end)), [history]);
  const index = periods.findIndex(h => h.id === snap?.id);
  const viewingPast = Boolean(snap && latestId && snap.id !== latestId);

  // 当前那一期滚到看得见的地方
  useEffect(() => {
    const el = railRef.current?.querySelector<HTMLElement>(`[data-period="${snap?.id}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: motionAllowed() ? 'smooth' : 'auto' });
  }, [snap?.id, periods.length]);

  const p = snap?.payload;

  // 换一期时，选中的观点那一期也有就留着
  useEffect(() => {
    if (selectedTerm && p && !p.concepts.some(c => c.term === selectedTerm)) setSelectedTerm(null);
  }, [p, selectedTerm]);

  const notesById = useMemo(() => new Map((p?.notes ?? []).map(n => [n.id, n])), [p]);
  const selectedConcept = useMemo(() => p?.concepts.find(c => c.term === selectedTerm) ?? null, [p, selectedTerm]);
  const selectedNotes = useMemo(
    () => (selectedConcept?.noteIds ?? []).map(id => notesById.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof notesById.get>>[],
    [selectedConcept, notesById],
  );

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric' });

  return (
    <div className="workspace-view-shell fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/45 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={t.title} className="workspace-view-dialog flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">

        {/* 顶栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-6 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-stone-900 dark:text-gray-100">
              {t.title}
              <span className="ml-2 text-sm font-normal text-stone-500 dark:text-gray-400">{groupName}</span>
            </h2>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-gray-400">
              {t.period}
              {snap && ` · ${viewingPast ? `${t.pastPeriod} · ` : ''}${t.windowLabel} ${fmt(snap.window_start)} – ${fmt(snap.window_end)}`}
            </p>
          </div>
          <div className="view-toolbar flex items-center gap-2">
            <button type="button" aria-pressed={showLabels} onClick={() => setShowLabels(value => !value)}>{t.showLabels}</button>
            {isTeacher && (
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="inline-flex min-h-10 items-center gap-2 rounded-2xl border border-stone-200 px-3.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
              >
                {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                {t.refresh}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={lang === 'zh' ? '关闭' : 'Close'}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-stone-200 text-stone-600 transition hover:bg-stone-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex flex-1 items-center justify-center gap-3 text-sm text-stone-500 dark:text-gray-400">
            <Loader2 size={18} className="animate-spin" />{t.loading}
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertCircle size={22} style={{ color: MORANDI.rose }} />
            <p className="text-sm text-stone-600 dark:text-gray-300">{error}</p>
            <button onClick={() => void load()} className="rounded-2xl bg-[#000080] px-4 py-2 text-sm font-semibold text-white">
              {t.retry}
            </button>
          </div>
        )}

        {!loading && !error && pending && !snap && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-base font-semibold text-stone-800 dark:text-gray-100">{t.pending}</p>
            <p className="max-w-sm text-sm leading-relaxed text-stone-500 dark:text-gray-400">
              {t.pendingHint(pending.have, pending.need)}
            </p>
          </div>
        )}

        {!loading && !error && p && (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">

            {/* 左：图谱 */}
            <div className="flex min-h-[420px] flex-col border-b border-stone-200 lg:min-h-0 lg:border-b-0 lg:border-r dark:border-gray-800">
              <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-stone-100 px-6 py-3 dark:border-gray-800/70">
                {([
                  [t.notes, p.stats.noteCount], [t.newNotes, p.stats.newNoteCount],
                  [t.members, `${p.stats.activeMemberCount}/${p.stats.memberCount}`],
                  [t.buildOns, p.stats.buildOnCount], [t.aiNotes, p.stats.aiNoteCount],
                ] as const).map(([label, v]) => (
                  <div key={label} className="flex items-baseline gap-1.5">
                    <span className="font-mono text-base font-medium tabular-nums text-stone-900 dark:text-gray-100">{v}</span>
                    <span className="text-xs text-stone-500 dark:text-gray-400">{label}</span>
                  </div>
                ))}
              </div>

              {/* 往期：每周一期，从早到晚 */}
              {periods.length > 1 && (
                <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2 dark:border-gray-800/70">
                  <span className="shrink-0 pl-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400 dark:text-gray-500">{t.periods}</span>
                  <button
                    type="button"
                    onClick={() => index > 0 && void openPeriod(periods[index - 1].id)}
                    disabled={index <= 0}
                    aria-label={t.prev}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div
                    ref={railRef}
                    role="tablist"
                    aria-label={t.periods}
                    onKeyDown={e => {
                      if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); void openPeriod(periods[index - 1].id); }
                      if (e.key === 'ArrowRight' && index >= 0 && index < periods.length - 1) { e.preventDefault(); void openPeriod(periods[index + 1].id); }
                    }}
                    className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]"
                  >
                    {periods.map(h => {
                      const active = h.id === snap?.id;
                      return (
                        <button
                          key={h.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          data-period={h.id}
                          onClick={() => void openPeriod(h.id)}
                          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-all duration-200 active:scale-[0.97] ${
                            active
                              ? 'border-[#000080] bg-[#000080] font-semibold text-white'
                              : 'border-stone-200 bg-white text-stone-600 hover:border-[#000080]/30 hover:text-stone-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                          } ${switching === h.id ? 'animate-pulse' : ''}`}
                        >
                          <span className="tabular-nums">{fmt(h.window_start)}–{fmt(h.window_end)}</span>
                          {h.id === latestId && <span className={active ? 'text-white/80' : 'text-[#000080] dark:text-[#93AAFD]'}>{t.latest}</span>}
                          {h.trigger === 'manual' && <span className={active ? 'text-white/70' : 'text-stone-400'}>{t.manual}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => index >= 0 && index < periods.length - 1 && void openPeriod(periods[index + 1].id)}
                    disabled={index < 0 || index >= periods.length - 1}
                    aria-label={t.next}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    <ChevronRight size={16} />
                  </button>
                  {viewingPast && latestId && (
                    <button type="button" onClick={() => void openPeriod(latestId)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[#000080] transition-colors hover:bg-[#000080]/[0.06] dark:text-[#93AAFD]">
                      {t.backToLatest}
                    </button>
                  )}
                </div>
              )}
              {periodError && (
                <p className="border-b border-stone-100 px-6 py-2 text-xs dark:border-gray-800/70" style={{ color: MORANDI.rose }}>{periodError}</p>
              )}

              <div className="view-graph-stage relative min-h-0 flex-1 bg-stone-50/70 dark:bg-gray-900/40">
                <IdeaGraphCanvas
                  payload={p}
                  lang={lang}
                  showLabels={showLabels}
                  selected={selectedTerm}
                  onSelect={setSelectedTerm}
                />
              </div>
              <p className="border-t border-stone-100 px-6 py-2 text-[0.6875rem] leading-relaxed text-stone-400 dark:border-gray-800/70 dark:text-gray-500">
                {t.conceptHint}
              </p>
            </div>

            {/* 右：选中的观点 + 文字进展 */}
            <aside className="min-h-0 overflow-y-auto bg-white px-5 py-4 dark:bg-gray-950">
              {selectedConcept && (
                <section className="mb-5 rounded-2xl border border-[#000080]/15 bg-[#000080]/[0.03] p-3.5 animate-in fade-in slide-in-from-top-1 duration-200 dark:border-[#93AAFD]/20 dark:bg-[#93AAFD]/[0.05]">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-stone-900 dark:text-gray-100">「{selectedConcept.term}」</p>
                      <p className="mt-0.5 text-xs text-stone-500 dark:text-gray-400">
                        {selectedConcept.authorCount} {t.byPeople} · {selectedNotes.length} {t.coveredBy}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedTerm(null)}
                      aria-label={t.closeConcept}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-white hover:text-stone-700 dark:hover:bg-gray-900"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="grid gap-1.5">
                    {selectedNotes.map(n => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => onLocateNote?.(n.id)}
                        title={t.clickNote}
                        className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-left text-[0.8125rem] transition hover:border-[#000080]/40 hover:bg-stone-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                      >
                        <span className="min-w-0 flex-1 truncate text-stone-800 dark:text-gray-200">{n.title || '—'}</span>
                        {n.isAiGenerated && (
                          <span className="shrink-0 rounded-full border border-stone-200 px-1.5 font-mono text-[0.6875rem] text-stone-500 dark:border-gray-700 dark:text-gray-400">AI</span>
                        )}
                        <span className="shrink-0 text-[0.6875rem] text-stone-400 dark:text-gray-500">{n.author}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <p className="mb-4 rounded-2xl bg-stone-50 px-4 py-3 text-[0.8125rem] leading-relaxed text-stone-700 dark:bg-gray-900 dark:text-gray-300">
                {p.progress.headline || t.nothing}
              </p>

              {p.progress.growing.length > 0 && (
                <Section label={t.growing}>
                  <div className="flex flex-wrap gap-1.5">
                    {p.progress.growing.map(g => (
                      <button
                        key={g.term}
                        type="button"
                        onClick={() => setSelectedTerm(term => (term === g.term ? null : g.term))}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${selectedTerm === g.term
                          ? 'border-[#000080]/40 bg-[#000080]/[0.06] text-[#000080] dark:text-[#93AAFD]'
                          : 'border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                      >
                        {g.term}<span className="ml-1 font-mono text-[0.6875rem] text-[#8c6b2f]">
                          {g.isNew ? (lang === 'zh' ? '新' : 'new') : `+${g.delta}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {p.progress.questions.length > 0 && (
                <Section label={t.questions}>
                  <ul className="grid gap-1.5">
                    {p.progress.questions.map(q => (
                      <li key={q.noteId}>
                        <button
                          type="button"
                          onClick={() => onLocateNote?.(q.noteId)}
                          className="flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left text-[0.8125rem] leading-snug transition hover:bg-stone-50 dark:hover:bg-gray-900"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: q.answered ? MORANDI.sage : MORANDI.stone }} />
                          <span className="min-w-0 flex-1 text-stone-700 dark:text-gray-300">{q.title}</span>
                          <span className="shrink-0 text-[0.6875rem] text-stone-400 dark:text-gray-500">
                            {q.answered ? t.answered : t.notAnswered}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {p.progress.unanswered.length > 0 && (
                <Section label={t.unanswered}>
                  <ul className="grid gap-1.5">
                    {p.progress.unanswered.map(u => (
                      <li key={u.noteId}>
                        <button
                          type="button"
                          onClick={() => onLocateNote?.(u.noteId)}
                          className="flex w-full items-baseline gap-2 rounded-xl px-2 py-1.5 text-left text-[0.8125rem] leading-snug transition hover:bg-stone-50 dark:hover:bg-gray-900"
                        >
                          <span className="min-w-0 flex-1 text-stone-700 dark:text-gray-300">{u.title || '—'}</span>
                          <span className="shrink-0 font-mono text-[0.6875rem] text-stone-400 dark:text-gray-500">
                            {u.author} · {u.daysOpen}{t.daysOpen}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {p.progress.chains.length > 0 && (
                <Section label={t.chains}>
                  <ul className="grid gap-1.5">
                    {p.progress.chains.map(c => (
                      <li key={c.rootId}>
                        <button
                          type="button"
                          onClick={() => onLocateNote?.(c.rootId)}
                          className="flex w-full items-baseline gap-2 rounded-xl px-2 py-1.5 text-left text-[0.8125rem] leading-snug transition hover:bg-stone-50 dark:hover:bg-gray-900"
                        >
                          <span className="min-w-0 flex-1 text-stone-700 dark:text-gray-300">{c.rootTitle || '—'}</span>
                          <span className="shrink-0 font-mono text-[0.6875rem] text-stone-400 dark:text-gray-500">
                            {c.depth} {t.depth} · {c.participants} {t.people}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section className="mb-5">
    <h3 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400 dark:text-gray-500">{label}</h3>
    {children}
  </section>
);

export default GroupIdeaGraph;
