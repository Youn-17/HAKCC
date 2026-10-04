import { describe, expect, it } from 'vitest';

/**
 * 时间线的三条纯逻辑：按天分组、节奏条补齐空白日、「只看我的」的口径。
 * 这里把 SpaceTimeline 里的规则复刻出来锁住。
 *
 * 最要紧的是补空白日：一个空间周一热闹、周二到周四没人动、周五又热闹，
 * 如果只画有活动的日子，节奏条会把三天沉寂压成看不见——而沉寂恰恰是
 * 老师最该看到的信息。
 */
type Item = { id: string; kind: 'note' | 'build_on' | 'ai_feedback' | 'ai_chat'; at: string; actorId: string | null; targetActorId?: string | null };

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function rhythm(items: Item[], me?: string) {
  const counts = new Map<string, { total: number; mine: number }>();
  for (const it of items) {
    const k = dayKey(it.at);
    const c = counts.get(k) ?? { total: 0, mine: 0 };
    c.total += 1;
    if (me && (it.actorId === me || it.targetActorId === me)) c.mine += 1;
    counts.set(k, c);
  }
  const keys = [...counts.keys()].sort();
  const out: Array<{ key: string; total: number; mine: number }> = [];
  const cursor = new Date(keys[0]);
  const last = new Date(keys[keys.length - 1]);
  while (cursor <= last) {
    const k = dayKey(cursor.toISOString());
    out.push({ key: k, ...(counts.get(k) ?? { total: 0, mine: 0 }) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function involvesMe(it: Item, me: string) {
  return it.actorId === me || it.targetActorId === me;
}

const at = (day: string, hour = 10) => `${day}T${String(hour).padStart(2, '0')}:00:00`;
const item = (id: string, kind: Item['kind'], day: string, actorId: string, targetActorId?: string): Item =>
  ({ id, kind, at: at(day), actorId, targetActorId });

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
