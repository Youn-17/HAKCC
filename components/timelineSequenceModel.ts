import type { TimelineItem } from '../services/apiClient';

export const sequenceKinds = ['note', 'build_on', 'revision', 'ai_feedback', 'ai_chat'] as const;
export type SequenceKind = typeof sequenceKinds[number];
export type SequencePoint = { at: number; count: number };
export type SequenceMarker = { at: number; kind: SequenceKind; events: TimelineItem[] };

/** A continuous clock preserves gaps in activity; simultaneous records share a frame. */
export function timelineSequence(items: TimelineItem[], markerColumns = 120) {
  const columns = Math.max(1, Math.min(120, Math.floor(markerColumns) || 120));
  const events = items.filter(e => Number.isFinite(Date.parse(e.at)))
    .slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const times = events.map(e => Date.parse(e.at));
  const first = times[0] ?? 0;
  const last = times.at(-1) ?? first;
  // An isolated instant needs a small plotting domain, without inventing other events.
  const start = first === last ? first - 3_600_000 : first;
  const end = first === last ? last + 3_600_000 : last;
  const position = (at: number) => (at - start) / (end - start);
  const series = sequenceKinds.map(kind => {
    const points: SequencePoint[] = [];
    const grouped = new Map<number, TimelineItem[]>();
    let count = 0;
    for (const e of events) {
      if (e.kind !== kind) continue;
      const at = Date.parse(e.at);
      count++;
      if (points.at(-1)?.at === at) points[points.length - 1].count = count;
      else points.push({ at, count });
      // Nearby dots aggregate for legibility; curves and replay keep exact timestamps.
      const cell = Math.min(columns - 1, Math.floor(position(at) * columns));
      const group = grouped.get(cell) ?? [];
      group.push(e);
      grouped.set(cell, group);
    }
    const markers: SequenceMarker[] = [];
    for (const group of grouped.values()) {
      const at = group.reduce((sum, e) => sum + Date.parse(e.at), 0) / group.length;
      const previous = markers.at(-1);
      // Events on opposite sides of a bin edge can still collide visually.
      if (previous && position(at) - position(previous.at) < .75 / columns) {
        previous.at = (previous.at * previous.events.length + at * group.length) / (previous.events.length + group.length);
        previous.events.push(...group);
      } else markers.push({ at, kind, events: group });
    }
    return { kind, points, pointTimes: points.map(p => p.at), markers, total: count };
  });
  return { events, times, start, end, position, series };
}

export type TimelineSequence = ReturnType<typeof timelineSequence>;

function upperBound(times: number[], at: number) {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function sequenceFrame(sequence: TimelineSequence, progress: number) {
  const at = sequence.start + (sequence.end - sequence.start) * Math.max(0, Math.min(1, progress));
  const count = upperBound(sequence.times, at);
  const totals = sequence.series.map(s => {
    const index = upperBound(s.pointTimes, at) - 1;
    return { kind: s.kind, count: s.points[index]?.count ?? 0 };
  });
  return { at, count, latest: sequence.events[count - 1], totals };
}

export function stepSequence(sequence: TimelineSequence, progress: number, direction: -1 | 1) {
  const frame = sequenceFrame(sequence, progress);
  const next = direction === 1
    ? sequence.times[upperBound(sequence.times, frame.at)]
    : sequence.times[upperBound(sequence.times, frame.at - 1) - 1];
  return next === undefined ? (direction === 1 ? 1 : 0) : sequence.position(next);
}
