import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dashboard as dashboardApi, type StudentKnowledgeGraph as GraphData, type KnowledgeGraphNode } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { RELATION_COLORS } from '../relationColors';

interface Props {
  zh: boolean;
}

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
  r: number;
  data: KnowledgeGraphNode;
}

const W = 1000;
const H = 640;
const CONCEPT_COLOR = '#d97706';
const MINE_COLOR = '#000080';
const MINE_COLOR_DARK = '#4169E1';

const StudentKnowledgeGraphView: React.FC<Props> = ({ zh }) => {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [courseId, setCourseId] = useState('');
  const [selected, setSelected] = useState<KnowledgeGraphNode | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });

  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const alphaRef = useRef(1);
  const rafRef = useRef<number>(0);
  const dragRef = useRef<{ id: string | null; panning: boolean; sx: number; sy: number; tx: number; ty: number }>({ id: null, panning: false, sx: 0, sy: 0, tx: 0, ty: 0 });

  // ── Data loading ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    dashboardApi.studentKnowledgeGraph(courseId || undefined)
      .then(res => { if (!cancelled) setGraph(res.graph); })
      .catch(() => { if (!cancelled) setGraph(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [courseId]);

  // Degree map for node sizing
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    if (!graph) return d;
    for (const e of graph.edges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [graph]);

  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    if (!graph) return adj;
    for (const e of graph.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    return adj;
  }, [graph]);

  // ── Simulation setup ──────────────────────────────────────
  useEffect(() => {
    if (!graph) return;
    const rng = (seed: number) => {
      let s = seed;
      return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    };
    const rand = rng(42);
    nodesRef.current = graph.nodes.map(n => {
      const deg = degree.get(n.id) ?? 0;
      const r = n.kind === 'concept'
        ? Math.min(16 + (n.noteCount ?? 1) * 2.5, 30)
        : Math.min(8 + deg * 1.6, 20);
      return {
        id: n.id,
        x: W / 2 + (rand() - 0.5) * W * 0.7,
        y: H / 2 + (rand() - 0.5) * H * 0.7,
        vx: 0, vy: 0, fixed: false, r,
        data: n,
      };
    });
    alphaRef.current = 1;
    setTransform({ x: 0, y: 0, k: 1 });
    startSim();
    return stopSim;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const stopSim = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const startSim = useCallback(() => {
    stopSim();
    const step = () => {
      const nodes = nodesRef.current;
      const alpha = alphaRef.current;
      if (!graph || nodes.length === 0 || alpha < 0.004) { rafRef.current = 0; return; }

      const idx = new Map(nodes.map((n, i) => [n.id, i]));

      // Repulsion (O(n²), fine for ≤ ~160 nodes)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
          const dist = Math.sqrt(d2);
          const rep = Math.min((2600 * alpha) / d2, 12);
          const fx = (dx / dist) * rep, fy = (dy / dist) * rep;
          if (!a.fixed) { a.vx += fx; a.vy += fy; }
          if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
        }
      }

      // Springs along edges
      for (const e of graph.edges) {
        const a = nodes[idx.get(e.source) ?? -1];
        const b = nodes[idx.get(e.target) ?? -1];
        if (!a || !b) continue;
        const restLen = e.kind === 'contains' ? 95 : 130;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (dist - restLen) * 0.028 * alpha * 2.2;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        if (!a.fixed) { a.vx += fx; a.vy += fy; }
        if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
      }

      // Centering + integrate
      for (const n of nodes) {
        if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
        n.vx += (W / 2 - n.x) * 0.0015 * alpha * 2;
        n.vy += (H / 2 - n.y) * 0.0015 * alpha * 2;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(20, Math.min(W - 20, n.x));
        n.y = Math.max(20, Math.min(H - 20, n.y));
      }

      alphaRef.current = alpha * 0.985;
      setTick(t => t + 1);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [graph, stopSim]);

  useEffect(() => stopSim, [stopSim]);

  // ── Pointer interactions ──────────────────────────────────
  const toGraphCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const py = ((clientY - rect.top) / rect.height) * H;
    return { x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k };
  }, [transform]);

  const onPointerDown = useCallback((e: React.PointerEvent, nodeId?: string) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (nodeId) {
      const node = nodesRef.current.find(n => n.id === nodeId);
      if (node) {
        node.fixed = true;
        dragRef.current = { id: nodeId, panning: false, sx: e.clientX, sy: e.clientY, tx: 0, ty: 0 };
        alphaRef.current = Math.max(alphaRef.current, 0.25);
        if (!rafRef.current) startSim();
      }
    } else {
      dragRef.current = { id: null, panning: true, sx: e.clientX, sy: e.clientY, tx: transform.x, ty: transform.y };
    }
  }, [startSim, transform]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag.id) {
      const node = nodesRef.current.find(n => n.id === drag.id);
      if (node) {
        const p = toGraphCoords(e.clientX, e.clientY);
        node.x = Math.max(20, Math.min(W - 20, p.x));
        node.y = Math.max(20, Math.min(H - 20, p.y));
        alphaRef.current = Math.max(alphaRef.current, 0.12);
        if (!rafRef.current) startSim();
        setTick(t => t + 1);
      }
    } else if (drag.panning) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = ((e.clientX - drag.sx) / rect.width) * W;
      const dy = ((e.clientY - drag.sy) / rect.height) * H;
      setTransform(t => ({ ...t, x: drag.tx + dx, y: drag.ty + dy }));
    }
  }, [toGraphCoords, startSim]);

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (drag.id) {
      const node = nodesRef.current.find(n => n.id === drag.id);
      if (node) node.fixed = false;
      alphaRef.current = Math.max(alphaRef.current, 0.15);
      if (!rafRef.current) startSim();
    }
    dragRef.current = { id: null, panning: false, sx: 0, sy: 0, tx: 0, ty: 0 };
  }, [startSim]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setTransform(t => {
      const k = Math.max(0.35, Math.min(3.5, t.k * factor));
      const svg = svgRef.current;
      if (!svg) return { ...t, k };
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      return { k, x: px - ((px - t.x) / t.k) * k, y: py - ((py - t.y) / t.k) * k };
    });
  }, []);

  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, k: 1 });
    alphaRef.current = 0.6;
    if (!rafRef.current) startSim();
  }, [startSim]);

  // ── Search matching + focus ───────────────────────────────
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !graph) return null;
    const set = new Set<string>();
    for (const n of graph.nodes) {
      if (n.label.toLowerCase().includes(q)
        || (n.preview ?? '').toLowerCase().includes(q)
        || (n.authorName ?? '').toLowerCase().includes(q)) {
        set.add(n.id);
      }
    }
    return set;
  }, [search, graph]);

  const focusFirstMatch = useCallback(() => {
    if (!searchMatches || searchMatches.size === 0) return;
    const firstId = searchMatches.values().next().value as string;
    const node = nodesRef.current.find(n => n.id === firstId);
    if (!node) return;
    const k = Math.max(transform.k, 1.3);
    setTransform({ k, x: W / 2 - node.x * k, y: H / 2 - node.y * k });
    setSelected(node.data);
  }, [searchMatches, transform.k]);

  // ── Highlight sets (hover takes precedence over search) ───
  const highlightNodes = useMemo(() => {
    if (hoverId) {
      const set = new Set<string>([hoverId]);
      for (const n of adjacency.get(hoverId) ?? []) set.add(n);
      return set;
    }
    if (searchMatches && searchMatches.size > 0) return searchMatches;
    return null;
  }, [hoverId, adjacency, searchMatches]);

  const relationLabels: Record<string, string> = zh
    ? { extend: '延伸', clarify: '澄清', question: '提问', challenge: '质疑', evidence: '证据', synthesize: '综合' }
    : { extend: 'Extend', clarify: 'Clarify', question: 'Question', challenge: 'Challenge', evidence: 'Evidence', synthesize: 'Synthesize' };

  // ── Render ────────────────────────────────────────────────
  if (loading) {
    return <div className="h-[560px] animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />;
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center rounded-2xl border border-stone-200 bg-white text-center dark:border-stone-800 dark:bg-stone-950">
        <RemixIcon name="node-tree" size={36} className="text-stone-300 dark:text-stone-600" />
        <p className="mt-3 text-sm font-medium text-stone-600 dark:text-stone-300">
          {zh ? '还没有可以构建图谱的笔记' : 'No notes to build a graph from yet'}
        </p>
        <p className="mt-1 text-xs text-stone-400">
          {zh ? '进入课程社区发布笔记后，你的知识图谱会自动生成' : 'Publish notes in your course community and your knowledge graph will grow automatically'}
        </p>
      </div>
    );
  }

  const nodes = nodesRef.current;
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  void tick;

  return (
    <div className="space-y-3">
      {/* Controls + stats */}
      <div className="flex flex-wrap items-center gap-3">
        {graph.courses.length > 1 && (
          <select
            value={courseId}
            onChange={e => setCourseId(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300"
          >
            <option value="">{zh ? '全部课程' : 'All courses'}</option>
            {graph.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
        {/* Search box */}
        <div className="relative flex items-center">
          <RemixIcon name="search-line" size={13} className="pointer-events-none absolute left-2.5 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') focusFirstMatch(); }}
            placeholder={zh ? '搜索笔记 / 概念 / 同伴…' : 'Search notes / concepts / peers…'}
            className="w-52 rounded-lg border border-stone-200 bg-white py-1.5 pl-8 pr-14 text-xs text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-[#000080]/40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:focus:border-[#4169E1]/50"
          />
          {search && (
            <div className="absolute right-2 flex items-center gap-1">
              <span className={`text-[0.6875rem] tabular-nums ${searchMatches && searchMatches.size > 0 ? 'text-[#000080] dark:text-[#93AAFD]' : 'text-stone-400'}`}>
                {searchMatches?.size ?? 0}
              </span>
              <button onClick={() => setSearch('')} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200">
                <RemixIcon name="close-circle-fill" size={12} />
              </button>
            </div>
          )}
        </div>
        {search && searchMatches && searchMatches.size > 0 && (
          <button
            onClick={focusFirstMatch}
            className="flex items-center gap-1 rounded-lg bg-[#000080]/[0.06] px-2.5 py-1.5 text-[0.6875rem] font-medium text-[#000080] transition-colors hover:bg-[#000080]/10 dark:bg-[#4169E1]/15 dark:text-[#93AAFD] dark:hover:bg-[#4169E1]/25"
          >
            <RemixIcon name="crosshair-2-line" size={12} />
            {zh ? '定位' : 'Locate'}
          </button>
        )}
        <div className="flex items-center gap-3 text-[0.6875rem] text-stone-500 dark:text-stone-400">
          <span>{zh ? '我的笔记' : 'My notes'} <strong className="text-stone-900 dark:text-stone-100">{graph.stats.myNotes}</strong></span>
          <span>{zh ? '关联笔记' : 'Connected'} <strong className="text-stone-900 dark:text-stone-100">{graph.stats.peerNotes}</strong></span>
          <span>{zh ? '概念' : 'Concepts'} <strong className="text-amber-600">{graph.stats.concepts}</strong></span>
          <span>{zh ? '连接' : 'Links'} <strong className="text-stone-900 dark:text-stone-100">{graph.stats.connections}</strong></span>
        </div>
        <button
          onClick={resetView}
          className="ml-auto flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-[0.6875rem] font-medium text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
        >
          <RemixIcon name="focus-3-line" size={12} />
          {zh ? '重置视图' : 'Reset view'}
        </button>
      </div>

      <div className="relative">
        {/* Graph canvas */}
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-gradient-to-br from-white via-stone-50/60 to-white dark:border-stone-800 dark:from-stone-950 dark:via-stone-900/60 dark:to-stone-950">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-[560px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={e => onPointerDown(e)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          >
            <defs>
              <radialGradient id="kg-mine-grad" cx="35%" cy="35%">
                <stop offset="0%" stopColor="#2743c9" />
                <stop offset="100%" stopColor="#000080" />
              </radialGradient>
              <radialGradient id="kg-concept-grad" cx="35%" cy="35%">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#d97706" />
              </radialGradient>
              {Object.entries(RELATION_COLORS).map(([type, color]) => (
                <marker key={type} id={`kg-arrow-${type}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" fill={color} opacity="0.75" />
                </marker>
              ))}
            </defs>

            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
              {/* Edges */}
              {graph.edges.map((e, i) => {
                const a = nodeById.get(e.source);
                const b = nodeById.get(e.target);
                if (!a || !b) return null;
                const dimmed = highlightNodes && !(highlightNodes.has(e.source) && highlightNodes.has(e.target));
                if (e.kind === 'contains') {
                  return (
                    <line
                      key={i}
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={CONCEPT_COLOR}
                      strokeWidth={1}
                      strokeDasharray="3 4"
                      opacity={dimmed ? 0.06 : 0.3}
                    />
                  );
                }
                const color = RELATION_COLORS[e.relationType ?? 'extend'] ?? '#64748b';
                // Trim the line so the arrow lands on the node edge
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
                const tx = b.x - (dx / dist) * (b.r + 3);
                const ty = b.y - (dy / dist) * (b.r + 3);
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={tx} y2={ty}
                    stroke={color}
                    strokeWidth={1.6}
                    opacity={dimmed ? 0.08 : 0.65}
                    markerEnd={`url(#kg-arrow-${e.relationType ?? 'extend'})`}
                  />
                );
              })}

              {/* Nodes */}
              {nodes.map(n => {
                const dimmed = highlightNodes && !highlightNodes.has(n.id);
                const isSelected = selected?.id === n.id;
                const kind = n.data.kind;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.18 : 1}
                    onPointerDown={e => { e.stopPropagation(); onPointerDown(e, n.id); }}
                    onPointerEnter={() => setHoverId(n.id)}
                    onPointerLeave={() => setHoverId(null)}
                    onClick={() => setSelected(n.data)}
                  >
                    {isSelected && (
                      <circle r={n.r + 5} fill="none" stroke={kind === 'concept' ? CONCEPT_COLOR : MINE_COLOR_DARK} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.8} />
                    )}
                    {searchMatches?.has(n.id) && !isSelected && (
                      <circle r={n.r + 4} fill="none" stroke="#f59e0b" strokeWidth={2} opacity={0.9} />
                    )}
                    {kind === 'concept' ? (
                      <>
                        <circle r={n.r} fill="url(#kg-concept-grad)" opacity={0.92} />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#fff"
                          fontSize={Math.min(11, n.r * 0.55)}
                          fontWeight={600}
                          style={{ pointerEvents: 'none' }}
                        >
                          {n.data.label.length > 6 ? n.data.label.slice(0, 6) : n.data.label}
                        </text>
                      </>
                    ) : kind === 'mine' ? (
                      <circle r={n.r} fill="url(#kg-mine-grad)" stroke="#fff" strokeWidth={1.5} className="dark:stroke-stone-900" />
                    ) : (
                      <circle r={n.r} fill="#fff" stroke="#94a3b8" strokeWidth={1.5} className="dark:fill-stone-800 dark:stroke-stone-600" />
                    )}
                    {/* Label under note nodes (hidden when zoomed far out) */}
                    {kind !== 'concept' && transform.k >= 0.7 && (
                      <text
                        y={n.r + 11}
                        textAnchor="middle"
                        fontSize={9}
                        className="fill-stone-500 dark:fill-stone-400"
                        style={{ pointerEvents: 'none' }}
                      >
                        {n.data.label.length > 10 ? `${n.data.label.slice(0, 10)}…` : n.data.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Legend */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-xl bg-white/85 px-3 py-2 backdrop-blur-sm dark:bg-stone-900/85">
            <span className="flex items-center gap-1.5 text-[0.6875rem] text-stone-600 dark:text-stone-300">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: MINE_COLOR }} />
              {zh ? '我的笔记' : 'My note'}
            </span>
            <span className="flex items-center gap-1.5 text-[0.6875rem] text-stone-600 dark:text-stone-300">
              <span className="inline-block h-3 w-3 rounded-full border border-stone-400 bg-white dark:bg-stone-800" />
              {zh ? '同伴笔记' : 'Peer note'}
            </span>
            <span className="flex items-center gap-1.5 text-[0.6875rem] text-stone-600 dark:text-stone-300">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: CONCEPT_COLOR }} />
              {zh ? '概念' : 'Concept'}
            </span>
            <span className="hidden items-center gap-1.5 text-[0.6875rem] text-stone-400 sm:flex">
              <RemixIcon name="drag-move-2-line" size={11} />
              {zh ? '拖拽节点 · 滚轮缩放 · 拖动背景平移' : 'Drag nodes · scroll to zoom · drag canvas to pan'}
            </span>
          </div>
        </div>

        {/* Detail card */}
        {selected && (
          <div className="absolute right-3 top-3 w-64 rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/95">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ background: selected.kind === 'concept' ? CONCEPT_COLOR : selected.kind === 'mine' ? MINE_COLOR : '#94a3b8' }}
                />
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400">
                  {selected.kind === 'concept' ? (zh ? '概念' : 'Concept') : selected.kind === 'mine' ? (zh ? '我的笔记' : 'My note') : (zh ? '同伴笔记' : 'Peer note')}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200">
                <RemixIcon name="close-line" size={14} />
              </button>
            </div>
            <h4 className="mt-2 text-sm font-semibold leading-snug text-stone-900 dark:text-stone-100">{selected.label}</h4>
            {selected.kind === 'concept' ? (
              <p className="mt-1.5 text-[0.6875rem] text-stone-500 dark:text-stone-400">
                {zh ? `出现在你的 ${selected.noteCount ?? 0} 篇笔记中` : `Appears in ${selected.noteCount ?? 0} of your notes`}
              </p>
            ) : (
              <>
                {selected.preview && (
                  <p className="mt-1.5 line-clamp-4 text-[0.6875rem] leading-relaxed text-stone-500 dark:text-stone-400">{selected.preview}</p>
                )}
                <div className="mt-2 space-y-1 text-[0.6875rem] text-stone-400">
                  {selected.authorName && <div>{zh ? '作者' : 'By'}: {selected.authorName}</div>}
                  {selected.courseTitle && <div>{zh ? '课程' : 'Course'}: {selected.courseTitle}</div>}
                  {selected.createdAt && <div>{new Date(selected.createdAt).toLocaleDateString()}</div>}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Concept chips */}
      {graph.concepts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.6875rem] font-medium text-stone-500 dark:text-stone-400">{zh ? '高频概念：' : 'Top concepts:'}</span>
          {graph.concepts.map(c => (
            <button
              key={c.term}
              onClick={() => {
                const node = graph.nodes.find(n => n.id === `concept:${c.term}`);
                if (node) setSelected(node);
              }}
              className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[0.6875rem] font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
            >
              {c.term} <span className="opacity-60">×{c.noteCount}</span>
            </button>
          ))}
        </div>
      )}

      {/* Relation legend */}
      <div className="flex flex-wrap items-center gap-3">
        {Object.entries(relationLabels).map(([type, label]) => (
          <span key={type} className="flex items-center gap-1.5 text-[0.6875rem] text-stone-500 dark:text-stone-400">
            <span className="inline-block h-[2px] w-4 rounded" style={{ background: RELATION_COLORS[type] }} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[0.6875rem] text-stone-400">
          <span className="inline-block h-[2px] w-4 rounded border-b border-dashed" style={{ borderColor: CONCEPT_COLOR }} />
          {zh ? '概念关联' : 'Concept link'}
        </span>
      </div>
    </div>
  );
};

export default StudentKnowledgeGraphView;
