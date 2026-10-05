import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../services/apiClient';
import { sequenceFrame, stepSequence, timelineSequence } from './timelineSequenceModel';

const event = (id: string, at: string, kind: TimelineItem['kind'] = 'note'): TimelineItem => ({
  id, at, kind, noteId: id, noteTitle: id, actorId: null, actorName: null,
});

describe('construction replay clock', () => {
  it('preserves time gaps, reveals simultaneous events together and steps by timestamp', () => {
    const sequence = timelineSequence([
      event('last', '2026-09-11T00:00:00Z'),
      event('first', '2026-09-01T00:00:00Z'),
      event('link', '2026-09-02T00:00:00Z', 'build_on'),
      event('edit', '2026-09-02T00:00:00Z', 'revision'),
    ]);
    expect(sequenceFrame(sequence, .05).count).toBe(1);
    expect(sequenceFrame(sequence, .1).count).toBe(3);
    expect(sequenceFrame(sequence, .9).count).toBe(3);
    expect(sequenceFrame(sequence, 1).count).toBe(4);
    expect(stepSequence(sequence, 0, 1)).toBe(.1);
    expect(stepSequence(sequence, .1, 1)).toBe(1);
    expect(stepSequence(sequence, 1, -1)).toBe(.1);
    expect(sequenceFrame(sequence, .1).totals.map(t => t.count)).toEqual([1, 1, 1, 0, 0]);
  });
  it('keeps dense marker groups bounded without losing events or altering their times', () => {
    const records = Array.from({ length: 2000 }, (_, i) => event(String(i), new Date(i * 1000).toISOString()));
    const sequence = timelineSequence(records);
    expect(sequence.series[0].markers.length).toBeLessThanOrEqual(120);
    expect(sequence.series[0].markers.flatMap(m => m.events)).toHaveLength(2000);
    expect(sequenceFrame(sequence, 1).latest?.at).toBe(records.at(-1)?.at);
    expect(sequence.events[500].at).toBe(records[500].at);
  });
  it('handles empty, invalid and isolated records without inventing activity', () => {
    expect(sequenceFrame(timelineSequence([]), 1).count).toBe(0);
    const sequence = timelineSequence([event('invalid', 'bad date'), event('only', '2026-09-01T00:00:00Z')]);
    expect(sequenceFrame(sequence, 0).count).toBe(0);
    expect(sequenceFrame(sequence, .5).count).toBe(1);
    expect(sequenceFrame(sequence, 1).count).toBe(1);
    expect(sequence.series[0].points).toHaveLength(1);
  });
});
