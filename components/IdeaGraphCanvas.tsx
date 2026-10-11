import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, type JSAnimation } from 'animejs';
import type { IdeaGraphConcept, IdeaGraphPayload } from '../services/apiClient';
import { BRAND_NAVY, MORANDI, shade } from './morandiPalette';
import { motionAllowed } from '../hooks/useLayoutMotion';
import {
  detectClusters, layoutIdeaGraph, LABEL_FONT, nodeShape, selectLinks,
  type LayoutConcept, type NodeShape, type Point, type ViewBox,
} from './ideaGraphLayout';

/**
 * 观点图谱的画布（2026-10-11 用户：显示更自然、加动画、不要叠在一起）。
 *
 * 位置由 ideaGraphLayout 算（不叠、同群靠近），这里只管画和动：
 *   - 第一次打开：观点按参与人数从大到小依次长出来，连线随后淡入；
 *   - 换一期：同一个观点从原来的位置滑到新位置，新出现的长出来，这一期没有的缩小消失；
 *   - 悬停一个观点，和它相连的亮起来；点一下选中（右边栏列出笔记），点空白处取消；可以拖动。
 * 画布大小只在第一次量一次：之后窗口变化只整体缩放，不重新布局（原来点开一个观点，下面的笔记列表
 * 把画布挤小，整张图就重排、跳一下）。系统设置「减少动态效果」时直接显示结果。
 */

interface Props {
  payload: IdeaGraphPayload;
  lang: 'zh' | 'en';
  showLabels: boolean;
  selected: string | null;
  onSelect: (term: string | null) => void;
}

interface NodeState { x: number; y: number; s: number; o: number }
interface SceneNode { term: string; shape: NodeShape; color: string; concept: IdeaGraphConcept; leaving: boolean; delay: number }
interface SceneLink { key: string; source: string; target: string; strength: number; shared: number; color: string; leaving: boolean }
interface Frame { nodes: Map<string, NodeState>; links: Map<string, number>; viewBox: ViewBox }

/** 群的颜色：莫兰迪色板按群的大小依次取；只有一个观点的群用中性灰 */
const CLUSTER_TONES = [MORANDI.sage, MORANDI.dustyBlue, MORANDI.ochre, MORANDI.rose, MORANDI.lilac, MORANDI.mauve, MORANDI.clay];
const LINK_NEUTRAL = '#a8a29e';
const FIRST_DURATION = 900;
const MORPH_DURATION = 640;
const NODE_STAGGER = 30;
const MAX_STAGGER_NODES = 12;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 按重要性排：参与的人多的在前（布局时放在中间，入场时先长出来） */
function orderedConcepts(payload: IdeaGraphPayload): IdeaGraphConcept[] {
  return [...payload.concepts].sort((a, b) => b.authorCount - a.authorCount || b.noteIds.length - a.noteIds.length || a.term.localeCompare(b.term));
}

/** 一期图的目标样子：每个观点的形状、颜色、位置，选出的连线，viewBox */
function buildTarget(payload: IdeaGraphPayload, width: number, height: number, seed: Map<string, Point> | undefined) {
  const concepts = orderedConcepts(payload);
  const layoutConcepts: LayoutConcept[] = concepts.map(c => ({ id: c.term, term: c.term, noteIds: c.noteIds, authorCount: c.authorCount }));
  const maxAuthors = Math.max(1, ...concepts.map(c => c.authorCount));
  const shapes = layoutConcepts.map(c => nodeShape(c, maxAuthors));
  const links = selectLinks(layoutConcepts);
  const clusters = detectClusters(layoutConcepts.map(c => c.id), links);
  const sizes = new Map<number, number>();
  clusters.forEach(c => sizes.set(c, (sizes.get(c) ?? 0) + 1));
  const colorOf = (term: string) => {
    const c = clusters.get(term) ?? -1;
    return (sizes.get(c) ?? 0) > 1 ? CLUSTER_TONES[c] ?? MORANDI.stone : MORANDI.stone;
  };
  const { positions, viewBox } = layoutIdeaGraph(shapes, links, clusters, { width, height, seed });
  const nodes: SceneNode[] = concepts.map((concept, i) => ({
    term: concept.term, shape: shapes[i], color: colorOf(concept.term), concept, leaving: false, delay: Math.min(i, MAX_STAGGER_NODES) * NODE_STAGGER,
  }));
  const sceneLinks: SceneLink[] = links.map(l => ({
    key: linkKey(l.source, l.target), source: l.source, target: l.target, strength: l.strength, shared: l.shared,
    color: clusters.get(l.source) === clusters.get(l.target) && colorOf(l.source) !== MORANDI.stone ? colorOf(l.source) : LINK_NEUTRAL,
    leaving: false,
  }));
  return { nodes, links: sceneLinks, positions, viewBox };
}

/**
 * 动画进行到 t（0–1）时的样子。每个观点有自己的延迟；新出现的从小长大，要消失的缩小淡出；
 * 连线跟着两端走，新连线在后半段淡入，要消失的在前半段淡出。
 */
export function interpolateFrame(from: Frame, to: Frame, t: number, nodes: SceneNode[], links: SceneLink[], duration: number, first: boolean): Frame {
  const elapsed = t * duration;
  const span = Math.max(1, duration - Math.max(0, ...nodes.map(n => n.delay)));
  const out: Frame = { nodes: new Map(), links: new Map(), viewBox: to.viewBox };
  for (const node of nodes) {
    const a = from.nodes.get(node.term);
    const b = to.nodes.get(node.term);
    if (!a || !b) continue;
    const local = easeOut(clamp01((elapsed - node.delay) / span));
    out.nodes.set(node.term, { x: lerp(a.x, b.x, local), y: lerp(a.y, b.y, local), s: lerp(a.s, b.s, local), o: lerp(a.o, b.o, local) });
  }
  const linkIn = clamp01((elapsed - duration * (first ? 0.4 : 0.35)) / (duration * 0.4));
  const linkOut = clamp01(elapsed / (duration * 0.45));
  for (const link of links) {
    const a = from.links.get(link.key) ?? 0;
    const b = to.links.get(link.key) ?? 0;
    out.links.set(link.key, b > a ? lerp(a, b, linkIn) : lerp(a, b, linkOut));
  }
  const g = easeOut(clamp01(elapsed / duration));
  out.viewBox = {
    x: lerp(from.viewBox.x, to.viewBox.x, g), y: lerp(from.viewBox.y, to.viewBox.y, g),
    width: lerp(from.viewBox.width, to.viewBox.width, g), height: lerp(from.viewBox.height, to.viewBox.height, g),
  };
  return out;
}

const IdeaGraphCanvas: React.FC<Props> = ({ payload, lang, showLabels, selected, onSelect }) => {
  const zh = lang === 'zh';
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [space, setSpace] = useState<{ width: number; height: number } | null>(null);
  const [scene, setScene] = useState<{ nodes: SceneNode[]; links: SceneLink[] } | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const targetRef = useRef<Frame | null>(null);
  const sceneRef = useRef<{ nodes: SceneNode[]; links: SceneLink[] } | null>(null);
  const animRef = useRef<JSAnimation | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // 只量一次：之后窗口变化由 viewBox 整体缩放
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || space) return;
    const take = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width > 40 && height > 40) setSpace({ width, height });
    };
    take();
    if (typeof ResizeObserver === 'undefined') {
      if (!(el.clientWidth > 40)) setSpace({ width: 720, height: 440 });
      return;
    }
    const ro = new ResizeObserver(take);
    ro.observe(el);
    return () => ro.disconnect();
  }, [space]);

  const commit = useCallback((next: Frame) => { frameRef.current = next; setFrame(next); }, []);

  const finish = useCallback(() => {
    animRef.current?.pause();
    animRef.current = null;
    if (targetRef.current) commit(targetRef.current);
    if (sceneRef.current) {
      const kept = { nodes: sceneRef.current.nodes.filter(n => !n.leaving), links: sceneRef.current.links.filter(l => !l.leaving) };
      sceneRef.current = kept;
      setScene(kept);
    }
  }, [commit]);

  useLayoutEffect(() => {
    if (!space) return;
    const previous = frameRef.current;
    const prevScene = sceneRef.current;
    animRef.current?.pause();
    const seed = previous ? new Map([...previous.nodes].map(([term, s]) => [term, { x: s.x, y: s.y }])) : undefined;
    const built = buildTarget(payload, space.width, space.height, seed);
    const first = !previous;

    const nextTerms = new Set(built.nodes.map(n => n.term));
    const nextLinks = new Set(built.links.map(l => l.key));
    const leavingNodes = (prevScene?.nodes ?? []).filter(n => !n.leaving && !nextTerms.has(n.term)).map(n => ({ ...n, leaving: true, delay: 0 }));
    const NEW_IDEA_DELAY = 140;
    for (const node of built.nodes) {
      if (!first) node.delay = (previous?.nodes.get(node.term)?.o ?? 0) > 0.05 ? 0 : NEW_IDEA_DELAY;
    }
    const leavingLinks = (prevScene?.links ?? []).filter(l => !l.leaving && !nextLinks.has(l.key)).map(l => ({ ...l, leaving: true }));
    const nodes = [...leavingNodes, ...built.nodes];
    const links = [...leavingLinks, ...built.links];

    const to: Frame = { nodes: new Map(), links: new Map(), viewBox: built.viewBox };
    const from: Frame = { nodes: new Map(), links: new Map(), viewBox: previous?.viewBox ?? built.viewBox };
    const cx = built.viewBox.x + built.viewBox.width / 2;
    const cy = built.viewBox.y + built.viewBox.height / 2;
    for (const node of built.nodes) {
      const p = built.positions.get(node.term)!;
      to.nodes.set(node.term, { x: p.x, y: p.y, s: 1, o: 1 });
      const was = previous?.nodes.get(node.term);
      from.nodes.set(node.term, was && was.o > 0.05
        ? was
        : { x: first ? lerp(cx, p.x, 0.82) : p.x, y: first ? lerp(cy, p.y, 0.82) : p.y, s: 0.35, o: 0 });
    }
    for (const node of leavingNodes) {
      const was = previous?.nodes.get(node.term) ?? { x: cx, y: cy, s: 1, o: 1 };
      from.nodes.set(node.term, was);
      to.nodes.set(node.term, { ...was, s: 0.4, o: 0 });
    }
    for (const link of built.links) { to.links.set(link.key, 1); from.links.set(link.key, previous?.links.get(link.key) ?? 0); }
    for (const link of leavingLinks) { to.links.set(link.key, 0); from.links.set(link.key, previous?.links.get(link.key) ?? 1); }

    const settled: Frame = { nodes: new Map([...to.nodes].filter(([term]) => nextTerms.has(term))), links: new Map([...to.links].filter(([key]) => nextLinks.has(key))), viewBox: to.viewBox };
    targetRef.current = settled;
    const full = { nodes, links };
    sceneRef.current = full;
    setScene(full);

    if (!motionAllowed()) { finish(); return; }
    const duration = first ? FIRST_DURATION : MORPH_DURATION;
    commit(interpolateFrame(from, to, 0, nodes, links, duration, first));
    const proxy = { t: 0 };
    animRef.current = animate(proxy, {
      t: 1,
      duration,
      ease: 'linear',
      onUpdate: () => commit(interpolateFrame(from, to, proxy.t, nodes, links, duration, first)),
      onComplete: () => finish(),
    });
  }, [payload, space, commit, finish]);

  useEffect(() => () => { animRef.current?.pause(); }, []);

  // ── 拖动 ──────────────────────────────────────────────────
  const dragRef = useRef<{ term: string; dx: number; dy: number } | null>(null);
  const justDragged = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);

  const toSvgPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !ctm || typeof svg.createSVGPoint !== 'function') return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const onNodeDown = (e: React.PointerEvent, term: string) => {
    if (e.button !== 0) return;
    if (animRef.current) finish();
    const state = frameRef.current?.nodes.get(term);
    const pt = toSvgPoint(e.clientX, e.clientY);
    if (!state || !pt) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { term, dx: pt.x - state.x, dy: pt.y - state.y };
    setDragging(term);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const current = frameRef.current;
    if (!d || !current) return;
    const pt = toSvgPoint(e.clientX, e.clientY);
    if (!pt) return;
    const vb = current.viewBox;
    const nodes = new Map(current.nodes);
    const state = nodes.get(d.term);
    if (!state) return;
    nodes.set(d.term, {
      ...state,
      x: Math.max(vb.x + 16, Math.min(vb.x + vb.width - 16, pt.x - d.dx)),
      y: Math.max(vb.y + 16, Math.min(vb.y + vb.height - 16, pt.y - d.dy)),
    });
    const next = { ...current, nodes };
    targetRef.current = next;
    commit(next);
  };

  // 拖完松手浏览器还会补一个 click，挡住它，不然每次拖动都会顺手选中、取消
  const endDrag = () => {
    if (dragRef.current) {
      justDragged.current = true;
      window.setTimeout(() => { justDragged.current = false; }, 0);
    }
    dragRef.current = null;
    setDragging(null);
  };

  const focusTerm = selected ?? hovered;
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!focusTerm || !scene) return set;
    for (const l of scene.links) {
      if (l.leaving) continue;
      if (l.source === focusTerm) set.add(l.target);
      if (l.target === focusTerm) set.add(l.source);
    }
    return set;
  }, [focusTerm, scene]);

  const maxShared = useMemo(() => Math.max(1, ...(scene?.links ?? []).map(l => l.shared)), [scene]);

  const vb = frame?.viewBox;
  return (
    <div ref={stageRef} className="absolute inset-0">
      {payload.concepts.length === 0 && (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-stone-500 dark:text-gray-400">
          {zh ? '这一期的笔记里还没有抽出反复出现的观点。' : 'No recurring ideas in this period yet.'}
        </div>
      )}
      {payload.concepts.length > 0 && scene && frame && vb && (
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
          preserveAspectRatio="xMidYMid meet"
          className={`absolute inset-0 h-full w-full select-none ${dragging ? 'cursor-grabbing' : ''}`}
          style={{ touchAction: 'none' }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={() => { if (!justDragged.current) onSelect(null); }}
        >
          <g>
            {scene.links.map(link => {
              const a = frame.nodes.get(link.source);
              const b = frame.nodes.get(link.target);
              const shown = frame.links.get(link.key) ?? 0;
              if (!a || !b || shown <= 0.01) return null;
              const touches = focusTerm != null && (link.source === focusTerm || link.target === focusTerm);
              const dim = focusTerm != null && !touches;
              return (
                <line
                  key={link.key}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={touches && selected ? BRAND_NAVY : link.color}
                  strokeOpacity={(0.25 + 0.55 * link.strength) * shown * (dim ? 0.25 : 1)}
                  strokeWidth={1 + 2.6 * link.strength + (link.shared / maxShared) * 0.8}
                  strokeLinecap="round"
                  className="transition-[stroke-opacity] duration-200"
                />
              );
            })}
          </g>
          <g>
            {scene.nodes.map(node => {
              const state = frame.nodes.get(node.term);
              if (!state || state.o <= 0.01) return null;
              const { shape, concept, color } = node;
              const isSelected = selected === node.term;
              const related = focusTerm == null || focusTerm === node.term || neighbours.has(node.term);
              const labelVisible = showLabels || isSelected || hovered === node.term;
              const badge = concept.isNew ? (zh ? '新' : 'new') : concept.delta != null && concept.delta > 0 ? `+${concept.delta}` : null;
              const badgeW = badge ? Math.max(18, badge.length * 7 + 8) : 0;
              return (
                <g
                  key={node.term}
                  style={{ opacity: related ? 1 : 0.32 }}
                  className="transition-opacity duration-200"
                >
                  <g
                    transform={`translate(${state.x} ${state.y}) scale(${state.s})`}
                    opacity={state.o}
                    role="button"
                    tabIndex={node.leaving ? -1 : 0}
                    aria-label={zh ? `${concept.term}，${concept.authorCount} 人参与，${concept.noteIds.length} 篇笔记` : `${concept.term}, ${concept.authorCount} people, ${concept.noteIds.length} notes`}
                    aria-pressed={isSelected}
                    className={`outline-none focus-visible:outline-2 focus-visible:outline-[#000080]/50 ${dragging === node.term ? 'cursor-grabbing' : 'cursor-grab'}`}
                    onPointerDown={e => onNodeDown(e, node.term)}
                    onPointerEnter={() => setHovered(node.term)}
                    onPointerLeave={() => setHovered(h => (h === node.term ? null : h))}
                    onClick={e => { e.stopPropagation(); if (!justDragged.current && !node.leaving) onSelect(isSelected ? null : node.term); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(isSelected ? null : node.term); } }}
                  >
                    <title>{zh ? `${concept.term} · ${concept.authorCount} 人参与 · ${concept.noteIds.length} 篇笔记` : `${concept.term} · ${concept.authorCount} people · ${concept.noteIds.length} notes`}</title>
                    <circle
                      r={shape.r}
                      fill={isSelected ? BRAND_NAVY : shade(color, 0.84)}
                      stroke={isSelected ? BRAND_NAVY : color}
                      strokeWidth={isSelected ? 2 : 1.5}
                    />
                    {labelVisible && (shape.labelInside ? (
                      <text y={4} textAnchor="middle" fontSize={LABEL_FONT} fontWeight={600} fill={isSelected ? '#ffffff' : '#1c1917'} className="pointer-events-none">
                        {shape.label}
                      </text>
                    ) : (
                      <text
                        y={shape.r + 6 + LABEL_FONT - 2}
                        textAnchor="middle"
                        fontSize={LABEL_FONT}
                        fontWeight={600}
                        strokeWidth={3}
                        strokeLinejoin="round"
                        paintOrder="stroke"
                        className={`pointer-events-none stroke-stone-50 dark:stroke-gray-900 ${isSelected ? 'fill-[#000080] dark:fill-[#93AAFD]' : 'fill-stone-700 dark:fill-gray-200'}`}
                      >
                        {shape.label}
                      </text>
                    ))}
                    {badge && (
                      <g transform={`translate(${shape.r * 0.72} ${-shape.r * 0.72})`} className="pointer-events-none">
                        <rect x={-badgeW / 2} y={-8} width={badgeW} height={16} rx={8} fill="#ffffff" stroke={MORANDI.ochre} strokeWidth={1} />
                        <text y={4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#8c6b2f">{badge}</text>
                      </g>
                    )}
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
};

export default IdeaGraphCanvas;
