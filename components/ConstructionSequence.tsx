import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TimelineItem } from '../services/apiClient';
import { sequenceFrame, stepSequence, timelineSequence, type SequenceMarker } from './timelineSequenceModel';
import RemixIcon from './RemixIcon';
import '../styles/timelineSequence.css';

interface Props {
  events: TimelineItem[];
  lang: 'zh' | 'en';
  selectedId?: string;
  actorName: (event: TimelineItem) => string;
  onPick: (events: TimelineItem[]) => void;
}

const colors = { note: '#687dcc', build_on: '#318e80', revision: '#b6803f', ai_feedback: '#967298', ai_chat: '#967298' };
const icons = { note: 'sticky-note-line', build_on: 'git-branch-line', revision: 'edit-2-line', ai_feedback: 'feedback-line', ai_chat: 'chat-3-line' };
const REPLAY_MS = 24_000;

/** Playback is a presentation clock. It never changes the filters or exported records. */
export default function ConstructionSequence({ events, lang, selectedId, actorName, onPick }: Props) {
  const zh = lang === 'zh';
  const container = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  const [progress, setProgress] = useState(1);
  const clock = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hover, setHover] = useState<SequenceMarker | null>(null);
  const id = useId().replace(/:/g, '');
  const left = width < 500 ? 65 : 92, right = 24, plotWidth = Math.max(1, width - left - right);
  const top = 22, bottom = 133, rowTop = 190, rowGap = 27;
  const sequence = useMemo(() => timelineSequence(events, Math.floor(plotWidth / 24)), [events, plotWidth]);
  const active = useMemo(() => sequence.series.filter(s => s.total || ['note', 'build_on', 'revision'].includes(s.kind)), [sequence]);
  const height = rowTop + active.length * rowGap + 25;
  const frame = useMemo(() => sequenceFrame(sequence, progress), [sequence, progress]);
  const maximum = Math.max(1, ...sequence.series.map(s => s.total));
  const ceiling = Math.max(1, Math.ceil(maximum / 4) * 4);
  const x = (at: number) => left + sequence.position(at) * plotWidth;
  const y = (count: number) => bottom - count / ceiling * (bottom - top);
  const labels = zh
    ? { note: '贡献', build_on: 'Build-on', revision: '修订', ai_feedback: 'AI 反馈', ai_chat: 'AI 对话' }
    : { note: 'Contributions', build_on: 'Build-ons', revision: 'Revisions', ai_feedback: 'AI feedback', ai_chat: 'AI chats' };
  const date = (at: number, full = false) => new Date(at).toLocaleString(zh ? 'zh-CN' : 'en-GB', full
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', ...(sequence.end - sequence.start > 31_536_000_000 ? { year: 'numeric' } : {}), ...(sequence.end - sequence.start < 86_400_000 ? { hour: '2-digit', minute: '2-digit' } : {}) });

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [Boolean(events.length)]);
  useEffect(() => { clock.current = 1; setProgress(1); setPlaying(false); setHover(null); }, [events]);
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  useEffect(() => {
    if (!playing) return;
    let animation = 0, previous = performance.now(), lastPaint = previous;
    const tick = (now: number) => {
      clock.current = Math.min(1, clock.current + (now - previous) * speed / REPLAY_MS);
      previous = now;
      if (now - lastPaint >= 32 || clock.current === 1) { setProgress(clock.current); lastPaint = now; }
      if (clock.current === 1) setPlaying(false);
      else animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, speed]);

  const seek = (value: number) => {
    setPlaying(false); setHover(null);
    clock.current = Math.max(0, Math.min(1, value)); setProgress(clock.current);
  };
  const play = () => {
    setHover(null);
    if (playing) { setPlaying(false); return; }
    if (clock.current >= 1) { clock.current = 0; setProgress(0); }
    setPlaying(true);
  };
  const choose = (marker: SequenceMarker) => {
    const visible = marker.events.filter(e => Date.parse(e.at) <= frame.at);
    if (visible.length) { setPlaying(false); onPick(visible); }
  };
  const scrub = (clientX: number) => {
    const bounds = svg.current?.getBoundingClientRect();
    if (bounds) seek(((clientX - bounds.left) * width / bounds.width - left) / plotWidth);
  };
  const preview = hover?.events.filter(e => Date.parse(e.at) <= frame.at).at(-1) ?? frame.latest;
  const tickCount = width < 500 ? 3 : 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => sequence.start + (sequence.end - sequence.start) * i / (tickCount - 1));
  const paths = useMemo(() => new Map(sequence.series.map(s => [s.kind, `M ${left} ${bottom} `
    + s.points.map(p => `H ${left + sequence.position(p.at) * plotWidth} V ${bottom - p.count / ceiling * (bottom - top)}`).join(' ')
    + ` H ${left + plotWidth}`])), [sequence, left, plotWidth, ceiling]);

  if (!sequence.events.length) return null;
  return <section className={`construction-sequence ${playing ? 'is-playing' : ''}`} aria-label={zh ? '构建时间序列图' : 'Construction time series'}>
    <div className="sequence-heading"><div><span className="sequence-eyebrow">{zh ? '时间中的共同构建' : 'CONSTRUCTION THROUGH TIME'}</span><h3>{zh ? '让构建过程重新展开' : 'Watch the inquiry unfold'}</h3></div><span className="sequence-date-range">{date(sequence.times[0])}<RemixIcon name="arrow-right-line" size={14}/>{date(sequence.times.at(-1)!)}</span></div>
    <div className="sequence-metrics">{active.map(s => <div key={s.kind} style={{ '--sequence-color': colors[s.kind] } as React.CSSProperties}><span><i/>{labels[s.kind]}</span><strong>{frame.totals.find(t => t.kind === s.kind)?.count ?? 0}<small>/ {s.total}</small></strong></div>)}<p>{zh ? '累计活动记录' : 'Cumulative activity records'}<small>{zh ? '数量不代表知识质量' : 'Counts do not indicate idea quality'}</small></p></div>
    <div className="sequence-controls">
      <button className="sequence-play" onClick={play} aria-label={zh ? (playing ? '暂停回放' : '播放构建过程') : (playing ? 'Pause replay' : 'Play construction')} aria-pressed={playing}><RemixIcon name={playing ? 'pause-fill' : 'play-fill'} size={19}/><span>{zh ? (playing ? '暂停' : '回放') : (playing ? 'Pause' : 'Play')}</span></button>
      <button className="sequence-control" aria-label={zh ? '回到起点' : 'Restart'} onClick={() => seek(0)}><RemixIcon name="restart-line" size={17}/></button>
      <div className="sequence-clock"><time>{date(frame.at, true)}</time><span>{frame.count} / {events.length} {zh ? '条记录' : 'events'}</span></div>
      <label className="sequence-scrubber"><span className="sr-only">{zh ? '回放进度' : 'Replay progress'}</span><input type="range" min="0" max="1000" step="1" value={Math.round(progress * 1000)} aria-valuetext={date(frame.at, true)} onChange={e => seek(Number(e.target.value) / 1000)} style={{ '--sequence-progress': `${progress * 100}%` } as React.CSSProperties}/></label>
      <div className="sequence-step"><button className="sequence-control" aria-label={zh ? '上一时刻' : 'Previous event time'} disabled={progress <= 0} onClick={() => seek(stepSequence(sequence, progress, -1))}><RemixIcon name="skip-back-mini-line" size={20}/></button><button className="sequence-control" aria-label={zh ? '下一时刻' : 'Next event time'} disabled={progress >= 1} onClick={() => seek(stepSequence(sequence, progress, 1))}><RemixIcon name="skip-forward-mini-line" size={20}/></button></div>
      <select className="sequence-speed" aria-label={zh ? '回放速度' : 'Replay speed'} value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[.5, 1, 2, 4].map(s => <option key={s} value={s}>{s}×</option>)}</select>
    </div>
    <div ref={container} className="sequence-chart" data-sequence-chart>
      <svg ref={svg} viewBox={`0 0 ${width} ${height}`} style={{ height }} role="group" aria-label={zh ? '累计活动曲线与事件时间带；拖动定位时间' : 'Cumulative curves and event tracks; drag to seek'}
        onPointerDown={e => { if (e.button !== 0 || e.pointerType === 'touch' || (e.target as Element).closest('[role="button"]')) return; e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX); }}
        onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e.clientX); }}
        onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}>
        <defs><clipPath id={`sequence-clip-${id}`}><rect x={left - 12} y="0" width={progress * plotWidth + 12} height={height}/></clipPath>{active.map(s => <linearGradient key={s.kind} id={`sequence-fill-${id}-${s.kind}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors[s.kind]} stopOpacity=".13"/><stop offset="100%" stopColor={colors[s.kind]} stopOpacity="0"/></linearGradient>)}</defs>
        {[0, 1, 2, 3, 4].map(i => <g key={i} className="sequence-grid"><line x1={left} x2={left + plotWidth} y1={y(ceiling * i / 4)} y2={y(ceiling * i / 4)}/><text x={left - 16} y={y(ceiling * i / 4) + 4} textAnchor="end">{Number((ceiling * i / 4).toFixed(1))}</text></g>)}
        {ticks.map((at, i) => <g key={i} className="sequence-grid sequence-time-tick"><line x1={x(at)} x2={x(at)} y1={top} y2={height - 20}/><text x={x(at)} y={bottom + 24} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{date(at)}</text></g>)}
        {active.map(s => <path key={s.kind} d={paths.get(s.kind)} className="sequence-future-path" stroke={colors[s.kind]}/>)}
        <g clipPath={`url(#sequence-clip-${id})`}>{active.map(s => <g key={s.kind}><path d={`${paths.get(s.kind)} V ${bottom} Z`} fill={`url(#sequence-fill-${id}-${s.kind})`}/><path d={paths.get(s.kind)} stroke={colors[s.kind]} className="sequence-path"/></g>)}</g>
        <text className="sequence-axis-caption" x={left} y={rowTop - 18}>{zh ? '事件发生时刻' : 'RECORDED EVENTS'}</text>
        {active.map((s, index) => <g key={s.kind}>
          <text className="sequence-row-label" x={left - 15} y={rowTop + index * rowGap + 4} textAnchor="end">{labels[s.kind]}</text>
          <line className="sequence-row-line" x1={left} x2={left + plotWidth} y1={rowTop + index * rowGap} y2={rowTop + index * rowGap}/>
          {s.markers.map((marker, m) => {
            const visible = marker.events.filter(e => Date.parse(e.at) <= frame.at);
            const selected = marker.events.some(e => e.id === selectedId);
            const markerAt = visible.length ? visible.reduce((sum, e) => sum + Date.parse(e.at), 0) / visible.length : marker.at;
            return <g key={m} transform={`translate(${x(markerAt)},${rowTop + index * rowGap})`} className={`sequence-marker ${visible.length ? 'is-visible' : 'is-future'} ${selected ? 'is-selected' : ''}`}
              role={visible.length ? 'button' : undefined} tabIndex={visible.length ? 0 : undefined}
              aria-label={visible.length ? `${labels[s.kind]} · ${date(Date.parse(visible[0].at), true)} · ${visible.length} ${zh ? '条记录' : 'events'} · ${visible[0].noteTitle}` : undefined}
              onClick={() => choose(marker)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(marker); } }}
              onPointerEnter={() => { if (visible.length) setHover(marker); }} onPointerLeave={() => setHover(null)} onFocus={() => setHover(marker)} onBlur={() => setHover(null)}>
              <circle className="sequence-marker-hit" r="12"/><circle className="sequence-marker-dot" r={Math.min(9, 4 + Math.sqrt(visible.length || marker.events.length))} fill={colors[s.kind]}/>{visible.length > 1 && <text className="sequence-marker-count" textAnchor="middle" y="3">{visible.length}</text>}
            </g>;
          })}
        </g>)}
        <g className="sequence-playhead" transform={`translate(${left + progress * plotWidth},0)`}><line y1={top - 8} y2={height - 20}/><circle cy={top - 9} r="4"/>{active.map(s => <circle key={s.kind} cy={y(frame.totals.find(t => t.kind === s.kind)?.count ?? 0)} r="4" style={{ fill: colors[s.kind] }}/>)}</g>
      </svg>
    </div>
    <div className="sequence-now">{preview ? <button onClick={() => { setPlaying(false); onPick([preview]); }}><span className="sequence-now-icon" style={{ color: colors[preview.kind] }}><RemixIcon name={icons[preview.kind]} size={19}/></span><span><small>{hover ? (zh ? '查看此时的记录' : 'Event preview') : (zh ? '此刻最近的记录' : 'Latest event at this time')} · {actorName(preview)} · {labels[preview.kind]}</small><strong>{preview.noteTitle || (zh ? '未命名 Note' : 'Untitled Note')}</strong></span><time>{date(Date.parse(preview.at), true)}</time><RemixIcon name="arrow-right-s-line" size={18}/></button> : <p>{zh ? '从起点播放，观察贡献、接续与修订逐步出现。' : 'Play from the start to reveal contributions, Build-ons and revisions.'}</p>}</div>
    <div className="sequence-footnote"><span>{zh ? '沿真实时间推进 · 空白时段保留 · 相近记录可点开查看' : 'Recorded time · Idle intervals preserved · Select dots to inspect events'}</span><span>{zh ? '回放不改变筛选与导出范围' : 'Replay does not change filters or export scope'}</span></div>
  </section>;
}
