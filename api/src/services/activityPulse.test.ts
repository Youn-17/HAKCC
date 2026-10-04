import { describe, expect, it } from 'vitest';
import { computePulse, weekStart } from './activityPulse';

const empty = { noteTimes: [], aiTimes: [], eventTimes: [], feedbacks: [] };
// 固定一个星期三，免得测试在周日跑和周一跑结果不同。
const NOW = Date.parse('2026-09-02T06:00:00Z');

describe('周分桶', () => {
  it('同一周的不同天归到同一个桶', () => {
    const mon = weekStart(Date.parse('2026-08-31T10:00:00+08:00'));
    const sun = weekStart(Date.parse('2026-09-06T23:00:00+08:00'));
    expect(mon).toBe(sun);
  });

  it('周一零点是边界，跨过去就换桶', () => {
    const before = weekStart(Date.parse('2026-08-30T23:59:00+08:00'));
    const after = weekStart(Date.parse('2026-08-31T00:01:00+08:00'));
    expect(after).toBeGreaterThan(before);
  });
});

describe('活动趋势', () => {
  it('没有数据时给出空的周序列，而不是编几根柱子', () => {
    const p = computePulse({ ...empty, now: NOW });
    expect(p.weeks).toHaveLength(8);
    expect(p.weeks.every(w => w.notes === 0 && w.aiInteractions === 0)).toBe(true);
    expect(p.hasData).toBe(false);
  });

  it('本周的笔记落在最后一个桶', () => {
    const p = computePulse({ ...empty, noteTimes: ['2026-09-02T06:00:00Z'], now: NOW });
    expect(p.weeks.at(-1)!.notes).toBe(1);
    expect(p.hasData).toBe(true);
  });

  it('窗口之外的旧数据被丢掉，不会挤进第一个桶把它撑高', () => {
    const p = computePulse({ ...empty, noteTimes: ['2025-01-01T00:00:00Z'], now: NOW });
    expect(p.weeks.reduce((s, w) => s + w.notes, 0)).toBe(0);
    // 但它确实存在过，hasData 仍为真
    expect(p.hasData).toBe(true);
  });

  it('坏时间戳直接跳过，不会让整个接口崩掉', () => {
    const p = computePulse({ ...empty, noteTimes: ['not-a-date', '2026-09-02T06:00:00Z'], now: NOW });
    expect(p.weeks.reduce((s, w) => s + w.notes, 0)).toBe(1);
  });
});

describe('AI 反馈接受率', () => {
  it('「还没表态」不算拒绝 —— 否则接受率会随时间自然下滑', () => {
    const p = computePulse({
      ...empty, now: NOW,
      feedbacks: [
        { trigger_type: 'unclear', status: 'followed_up' },
        { trigger_type: 'unclear', status: 'ignored' },
        { trigger_type: 'unclear', status: 'new' },
        { trigger_type: 'unclear', status: 'new' },
      ],
    });
    expect(p.acceptance.accepted).toBe(1);
    expect(p.acceptance.rejected).toBe(1);
    expect(p.acceptance.pending).toBe(2);
    expect(p.acceptance.rate).toBe(50); // 1/(1+1)，不是 1/4
  });

  it('inserted 和 followed_up 都算接受', () => {
    const p = computePulse({
      ...empty, now: NOW,
      feedbacks: [
        { trigger_type: 't', status: 'inserted' },
        { trigger_type: 't', status: 'followed_up' },
      ],
    });
    expect(p.acceptance.rate).toBe(100);
  });

  it('全部还没表态时接受率是 null，不是 0 —— 0 会被读成「一条都没被接受」', () => {
    const p = computePulse({
      ...empty, now: NOW,
      feedbacks: [{ trigger_type: 't', status: 'new' }],
    });
    expect(p.acceptance.rate).toBeNull();
    expect(p.acceptance.byTrigger[0].rate).toBeNull();
  });

  it('按触发类型分别算，并按总量排序', () => {
    const p = computePulse({
      ...empty, now: NOW,
      feedbacks: [
        { trigger_type: 'rare', status: 'ignored' },
        { trigger_type: 'common', status: 'followed_up' },
        { trigger_type: 'common', status: 'followed_up' },
        { trigger_type: 'common', status: 'new' },
      ],
    });
    expect(p.acceptance.byTrigger[0].triggerType).toBe('common');
    expect(p.acceptance.byTrigger[0].rate).toBe(100);
    expect(p.acceptance.byTrigger[1].rate).toBe(0);
  });

  it('trigger_type 为空归到 unknown，而不是丢掉这条', () => {
    const p = computePulse({
      ...empty, now: NOW,
      feedbacks: [{ trigger_type: null, status: 'ignored' }],
    });
    expect(p.acceptance.byTrigger[0].triggerType).toBe('unknown');
  });
});

describe('参与度热力图', () => {
  it('形状固定 4 周 × 7 天', () => {
    const p = computePulse({ ...empty, now: NOW });
    expect(p.heatmap).toHaveLength(4);
    expect(p.heatmap.every(r => r.length === 7)).toBe(true);
    expect(p.heatmapMax).toBe(0);
  });

  it('事件落到正确的星期几（周一是第 0 列）', () => {
    // 2026-08-31 是周一
    const p = computePulse({ ...empty, eventTimes: ['2026-08-31T10:00:00+08:00'], now: NOW });
    expect(p.heatmap[3][0]).toBe(1);
  });

  it('给出最大值，让前端按真实分布着色而不是写死阈值', () => {
    const times = Array.from({ length: 5 }, () => '2026-09-02T10:00:00+08:00');
    const p = computePulse({ ...empty, eventTimes: times, now: NOW });
    expect(p.heatmapMax).toBe(5);
  });
});
