import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MORANDI } from './morandiPalette';
import { X, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { groups as groupsApi, type IdeaGraphSnapshot, type IdeaGraphConcept } from '../services/apiClient';

/**
 * 小组观点图谱。
 *
 * 一个主题做三五周之后，组里几十条笔记堆在画布上，学生说不清「我们谈到哪了」。
 * 这个面板把已经发生的讨论组织成一眼能看懂的形状：哪些观点在场、谁的问题还没人答、
 * 这一周长出了什么。
 *
 * 它只做**定位**，不做**综合** —— 图上没有任何一句是系统替学生下的结论。
 * 那个「更高一层的新说法」仍然是他们自己要写的。
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
    concepts: '讨论中的观点', conceptHint: '圆圈越大表示参与讨论的人越多；连线表示两个观点常共现于同一条笔记。圆圈可拖动',
    growing: '本期讨论增长的观点', unanswered: '尚无人建构', questions: '组内提出的问题',
    chains: 'Build-on 链最长的观点', answered: '已被建构', notAnswered: '尚无人建构',
    depth: '层', people: '人', daysOpen: '天未被建构',
    clickNote: '点击在画布中定位', nothing: '本期尚无新的讨论',
    coveredBy: '篇笔记', byPeople: '人参与讨论', windowLabel: '覆盖',
    fail: '没能取到图谱', retry: '重试',
  },
  en: {
    title: 'Idea Graph', period: 'Generated weekly', refresh: 'Regenerate',
    loading: 'Organising this period…', pending: 'Not enough notes yet',
    pendingHint: (have: number, need: number) => `${have} notes so far; the first graph appears at ${need}.`,
    notes: 'Notes', newNotes: 'New', members: 'Active', buildOns: 'Build-ons', aiNotes: 'AI notes',
    concepts: 'Ideas in discussion', conceptHint: 'Bigger = more people discussing it; a line means the two appear in the same note. Circles can be dragged',
    growing: 'More discussed', unanswered: 'Not built on yet', questions: 'Questions raised',
    chains: 'Longest build-on chains', answered: 'built on', notAnswered: 'not built on',
    depth: 'deep', people: 'people', daysOpen: 'days without a build-on',
    clickNote: 'Open on canvas', nothing: 'No new discussion this period',
    coveredBy: 'notes', byPeople: 'people', windowLabel: 'covering',
    fail: 'Could not load the graph', retry: 'Retry',
  },
};

/** 力导向布局，自实现（项目里没有 d3，也不为一个面板引进来）。 */
function layoutConcepts(
  concepts: IdeaGraphConcept[],
  links: Array<{ source: string; target: string; weight: number }>,
  width: number,
  height: number,
) {
  const nodes = concepts.map((c, i) => {
    const angle = (i / Math.max(concepts.length, 1)) * Math.PI * 2;
    const r = Math.min(width, height) * 0.32;
    return {
      id: c.id,
      x: width / 2 + Math.cos(angle) * r,
      y: height / 2 + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));

  for (let step = 0; step < 260; step++) {
    // 斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (i - j) || 1; dy = 1; d2 = 2; }
        const f = 2600 / d2;
        const d = Math.sqrt(d2);
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    // 引力（共现）
    for (const l of links) {
      const a = byId.get(l.source), b = byId.get(l.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (d - 90) * 0.012 * Math.min(l.weight, 4);
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    // 向心 + 阻尼
    for (const n of nodes) {
      n.vx += (width / 2 - n.x) * 0.004;
      n.vy += (height / 2 - n.y) * 0.004;
      n.x += n.vx * 0.42; n.y += n.vy * 0.42;
      n.vx *= 0.72; n.vy *= 0.72;
      n.x = Math.max(52, Math.min(width - 52, n.x));
      n.y = Math.max(34, Math.min(height - 34, n.y));
    }
  }
  return byId;
}

const GroupIdeaGraph: React.FC<Props> = ({ groupId, groupName, lang, isTeacher, onLocateNote, onClose }) => {
  const t = T[lang];
  const [snap, setSnap] = useState<IdeaGraphSnapshot | null>(null);
  const [pending, setPending] = useState<{ have: number; need: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeConcept, setActiveConcept] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 640, h: 380 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await groupsApi.ideaGraph(groupId);
      setSnap(res.graph);
      setPending(res.pending ? { have: res.haveNotes ?? 0, need: res.needNotes ?? 3 } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.fail);
    } finally {
      setLoading(false);
    }
  }, [groupId, t.fail]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(el.clientWidth, 320), h: Math.max(el.clientHeight, 280) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [snap]);

  const refresh = async () => {
    setRefreshing(true); setError(null);
    try {
      const res = await groupsApi.refreshIdeaGraph(groupId);
      setSnap(res.graph); setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.fail);
    } finally {
      setRefreshing(false);
    }
  };

  const p = snap?.payload;
  const layout = useMemo(
    () => (p ? layoutConcepts(p.concepts, p.conceptLinks, size.w, size.h) : new Map()),
    [p, size.w, size.h],
  );

  // 学生拖过的位置。力导向布局只决定初始摆放，拖动之后以人为准 ——
  // 重算布局（换期、改窗口大小）会清空，因为那时坐标系已经不是同一套了。
  const [dragged, setDragged] = useState<Map<string, { x: number; y: number }>>(new Map());
  useEffect(() => { setDragged(new Map()); }, [layout]);

  const positions = useMemo(() => {
    const m = new Map(layout);
    for (const [id, pos] of dragged) {
      const base = m.get(id);
      if (base) m.set(id, { ...base, x: pos.x, y: pos.y });
    }
    return m;
  }, [layout, dragged]);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  /** 屏幕坐标 → viewBox 坐标。SVG 是按容器缩放的，不换算会跟不上指针。 */
  const toSvg = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: clientX, y: clientY };
    const r = el.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * size.w,
      y: ((clientY - r.top) / r.height) * size.h,
    };
  }, [size.w, size.h]);

  const onNodeDown = useCallback((e: React.PointerEvent, id: string) => {
    const pos = positions.get(id);
    if (!pos) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const pt = toSvg(e.clientX, e.clientY);
    dragRef.current = { id, dx: pt.x - pos.x, dy: pt.y - pos.y };
    setDragging(id);
  }, [positions, toSvg]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const pt = toSvg(e.clientX, e.clientY);
    setDragged(prev => {
      const next = new Map(prev);
      next.set(d.id, {
        x: Math.max(52, Math.min(size.w - 52, pt.x - d.dx)),
        y: Math.max(34, Math.min(size.h - 34, pt.y - d.dy)),
      });
      return next;
    });
  }, [toSvg, size.w, size.h]);

  // 拖完松手浏览器还会补一个 click，不挡住的话每次拖动都会顺手把概念选中/取消
  const justDragged = useRef(false);
  const endDrag = useCallback(() => {
    if (dragRef.current) {
      justDragged.current = true;
      window.setTimeout(() => { justDragged.current = false; }, 0);
    }
    dragRef.current = null;
    setDragging(null);
  }, []);

  // 圈的大小按**参与讨论的人数**，不是笔记条数。
  // 原来按 noteIds.length 画，而提示语写的是「越多人在谈」—— 说反了：
  // 一个人写 5 条会比三个人各写 1 条的圈更大。知识建构里在意的是有多少人
  // 卷进了这个观点，不是谁写得多。
  const maxAuthors = useMemo(
    () => Math.max(1, ...(p?.concepts ?? []).map(c => c.authorCount)),
    [p],
  );

  const notesById = useMemo(() => new Map((p?.notes ?? []).map(n => [n.id, n])), [p]);
  const activeNotes = useMemo(() => {
    if (!activeConcept || !p) return [];
    const c = p.concepts.find(x => x.id === activeConcept);
    return (c?.noteIds ?? []).map(id => notesById.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof notesById.get>>[];
  }, [activeConcept, p, notesById]);

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric' });

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/45 p-4 backdrop-blur-sm">
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">

        {/* 顶栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-6 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-stone-900 dark:text-gray-100">
              {t.title}
              <span className="ml-2 text-sm font-normal text-stone-500 dark:text-gray-400">{groupName}</span>
            </h2>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-gray-400">
              {t.period}
              {snap && ` · ${t.windowLabel} ${fmt(snap.window_start)} – ${fmt(snap.window_end)}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              aria-label="Close"
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
            <div className="flex min-h-0 flex-col border-b border-stone-200 lg:border-b-0 lg:border-r dark:border-gray-800">
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

              <div ref={canvasRef} className="relative min-h-0 flex-1 bg-stone-50/70 dark:bg-gray-900/40">
                <svg
                  ref={svgRef}
                  width="100%" height="100%"
                  viewBox={`0 0 ${size.w} ${size.h}`}
                  className={`absolute inset-0 ${dragging ? 'cursor-grabbing' : ''}`}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerLeave={endDrag}
                  onPointerCancel={endDrag}
                >
                  {p.conceptLinks.map((l, i) => {
                    const a = positions.get(l.source), b = positions.get(l.target);
                    if (!a || !b) return null;
                    const dim = activeConcept && activeConcept !== l.source && activeConcept !== l.target;
                    return (
                      <line
                        key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke="#000080"
                        strokeOpacity={dim ? 0.05 : 0.10 + Math.min(l.weight, 5) * 0.045}
                        strokeWidth={Math.min(1 + l.weight * 0.5, 4)}
                      />
                    );
                  })}
                  {p.concepts.map(c => {
                    const pos = positions.get(c.id);
                    if (!pos) return null;
                    const r = 15 + (c.authorCount / maxAuthors) * 20;
                    const on = activeConcept === c.id;
                    const dim = activeConcept != null && !on;
                    return (
                      <g
                        key={c.id}
                        onPointerDown={(e) => onNodeDown(e, c.id)}
                        onClick={() => { if (!justDragged.current) setActiveConcept(on ? null : c.id); }}
                        className={dragging === c.id ? 'cursor-grabbing' : 'cursor-grab'}
                        opacity={dim ? 0.32 : 1}
                        style={{ touchAction: 'none' }}
                      >
                        <circle
                          cx={pos.x} cy={pos.y} r={r}
                          fill={on ? '#000080' : '#ffffff'}
                          stroke="#000080"
                          strokeWidth={on ? 2 : 1.25}
                          strokeOpacity={on ? 1 : 0.5}
                        />
                        <text
                          x={pos.x} y={pos.y + 4} textAnchor="middle"
                          className="pointer-events-none select-none"
                          fontSize={12} fontWeight={600}
                          fill={on ? '#ffffff' : '#1c1b18'}
                        >
                          {c.term.length > 6 ? `${c.term.slice(0, 6)}…` : c.term}
                        </text>
                        {(c.isNew || (c.delta != null && c.delta > 0)) && (
                          <text x={pos.x + r - 2} y={pos.y - r + 6} fontSize={10} fontWeight={700} fill="#8c6b2f">
                            {c.isNew ? (lang === 'zh' ? '新' : 'new') : `+${c.delta}`}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                <p className="pointer-events-none absolute bottom-3 left-6 right-6 text-[0.6875rem] leading-relaxed text-stone-400 dark:text-gray-500">
                  {t.conceptHint}
                </p>
              </div>

              {/* 点开某个概念 → 挂在它下面的笔记 */}
              {activeConcept && activeNotes.length > 0 && (
                <div className="max-h-44 overflow-y-auto border-t border-stone-200 px-6 py-3 dark:border-gray-800">
                  <p className="mb-2 text-xs font-semibold text-stone-500 dark:text-gray-400">
                    「{p.concepts.find(c => c.id === activeConcept)?.term}」· {activeNotes.length} {t.coveredBy}
                  </p>
                  <div className="grid gap-1.5">
                    {activeNotes.map(n => (
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
                </div>
              )}
            </div>

            {/* 右：文字进展 */}
            <aside className="min-h-0 overflow-y-auto bg-white px-5 py-4 dark:bg-gray-950">
              <p className="mb-4 rounded-2xl bg-stone-50 px-4 py-3 text-[0.8125rem] leading-relaxed text-stone-700 dark:bg-gray-900 dark:text-gray-300">
                {p.progress.headline || t.nothing}
              </p>

              {p.progress.growing.length > 0 && (
                <Section label={t.growing}>
                  <div className="flex flex-wrap gap-1.5">
                    {p.progress.growing.map(g => (
                      <span key={g.term} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-stone-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                        {g.term}<span className="ml-1 font-mono text-[0.6875rem] text-[#8c6b2f]">
                          {g.isNew ? (lang === 'zh' ? '新' : 'new') : `+${g.delta}`}
                        </span>
                      </span>
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
