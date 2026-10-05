import { describe, expect, it } from 'vitest';

import { dailyActivity as rhythm, involvesMe } from './knowledgeExplorerModel';
import type { TimelineItem as Item } from '../services/apiClient';

const at = (day: string, hour = 10) => `${day}T${String(hour).padStart(2, '0')}:00:00`;
const item = (id: string, kind: Item['kind'], day: string, actorId: string, targetActorId?: string): Item =>
  ({ id, kind, at: at(day), actorId, targetActorId, actorName: null, noteId: null, noteTitle: null });

describe('时间线节奏条', () => {
  it('中间没有活动的日子也要出现，计数为零', () => {
    const r = rhythm([item('a', 'note', '2026-09-01', 'u1'), item('b', 'note', '2026-09-04', 'u1')]);
    expect(r.map(d => d.key)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(r.map(d => d.total)).toEqual([1, 0, 0, 1]);
  });

  it('同一天多条累加', () => {
    const r = rhythm([item('a', 'note', '2026-09-01', 'u1'), item('b', 'build_on', '2026-09-01', 'u2')]);
    expect(r).toHaveLength(1);
    expect(r[0].total).toBe(2);
  });

  // 「我的」既包括我发起的，也包括别人接我的——被接是我在场的证据
  it('「我的」计数同时算我发起的和别人接我的', () => {
    const r = rhythm([
      item('a', 'note', '2026-09-01', 'me'),
      item('b', 'build_on', '2026-09-01', 'peer', 'me'),
      item('c', 'note', '2026-09-01', 'peer'),
    ], 'me');
    expect(r[0]).toEqual({ key: '2026-09-01', total: 3, mine: 2 });
  });
});

describe('「只看我的」口径', () => {
  it('我发的算、别人接我的算、与我无关的不算', () => {
    expect(involvesMe(item('a', 'note', '2026-09-01', 'me'), 'me')).toBe(true);
    expect(involvesMe(item('b', 'build_on', '2026-09-01', 'peer', 'me'), 'me')).toBe(true);
    expect(involvesMe(item('c', 'build_on', '2026-09-01', 'peer', 'other'), 'me')).toBe(false);
  });
});
