import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase', () => ({ supabase: {} }));

import { isStalled, shouldPostNotice, NOTICE_RULES } from './riseAboveRoom';

const now = new Date('2026-09-28T10:00:00Z');
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
const user = (minutesAgo: number) => ({ sender_kind: 'user', created_at: at(minutesAgo) });
const system = (minutesAgo: number) => ({ sender_kind: 'system', created_at: at(minutesAgo) });

describe('Rise Above notice rules', () => {
  it('the stalled rule fires once the room has been quiet long enough', () => {
    const quiet = NOTICE_RULES.stalledAfterMinutes + 5;
    const turns = [user(quiet + 3), user(quiet + 2), user(quiet + 1), user(quiet)];
    expect(isStalled(turns, now)).toBe(true);
    expect(shouldPostNotice(turns, now)).toBe(true);
  });

  it('the message path never sees a stall: the newest turn was just posted', () => {
    const turns = [user(60), user(50), user(40), user(0)];
    expect(isStalled(turns, now)).toBe(false);
    // 四条还不够「来回争」，要六条
    expect(shouldPostNotice(turns, now)).toBe(false);
    expect(shouldPostNotice([user(5), user(4), ...turns], now)).toBe(true);
  });

  it('too few student turns: neither rule fires, however long the silence', () => {
    const turns = [user(90), user(80), user(70)];
    expect(isStalled(turns, now)).toBe(false);
    expect(shouldPostNotice(turns, now)).toBe(false);
  });

  it('a recent card (or its control-arm shadow) holds both rules until the cooldown passes', () => {
    const before = [user(100), user(99), user(98), user(97)];
    const afterCard = [...before, system(96), user(95), user(94)];
    expect(isStalled(afterCard, now)).toBe(false);
    expect(shouldPostNotice(afterCard, now)).toBe(false);
    const cooled = [...afterCard, user(93), user(92), user(91), user(90)];
    expect(isStalled(cooled, now)).toBe(true);
  });
});
