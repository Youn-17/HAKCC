import { describe, it, expect } from 'vitest';
import { generateSessions, normalizeSchedule, zonedTimeToUtc, estimateCreditHours } from './courseSchedule';

const TUE_14 = { weekday: 2, start: '14:00', minutes: 90 };
const THU_10 = { weekday: 4, start: '10:00', minutes: 90 };

describe('normalizeSchedule', () => {
  it('剔掉非法时段', () => {
    expect(normalizeSchedule([
      { weekday: 0, start: '14:00', minutes: 90 },     // 星期越界
      { weekday: 8, start: '14:00', minutes: 90 },
      { weekday: 2, start: '25:00', minutes: 90 },     // 时间非法
      { weekday: 2, start: '14:00', minutes: 0 },      // 时长非法
      TUE_14,
    ])).toEqual([TUE_14]);
  });

  it('按星期和时间排序，同星期同时间去重', () => {
    expect(normalizeSchedule([THU_10, TUE_14, THU_10])).toEqual([TUE_14, THU_10]);
  });

  it('非数组返回空', () => {
    expect(normalizeSchedule(null)).toEqual([]);
    expect(normalizeSchedule('周二')).toEqual([]);
  });
});

describe('zonedTimeToUtc', () => {
  it('东八区 14:00 等于 UTC 06:00', () => {
    expect(zonedTimeToUtc('2026-09-08', '14:00', 'Asia/Shanghai').toISOString())
      .toBe('2026-09-08T06:00:00.000Z');
  });

  it('按当天实际偏移换算，自动处理夏令时', () => {
    // 多伦多：3 月是 EDT(-4)，1 月是 EST(-5)
    const summer = zonedTimeToUtc('2026-07-15', '09:00', 'America/Toronto').toISOString();
    const winter = zonedTimeToUtc('2026-01-15', '09:00', 'America/Toronto').toISOString();
    expect(summer).toBe('2026-07-15T13:00:00.000Z');
    expect(winter).toBe('2026-01-15T14:00:00.000Z');
  });

  it('时区名不认识时退回 UTC，而不是整条链路失败', () => {
    expect(zonedTimeToUtc('2026-09-08', '14:00', 'Nowhere/Nothing').toISOString())
      .toBe('2026-09-08T14:00:00.000Z');
  });
});

describe('generateSessions', () => {
  const base = { startDate: '2026-09-07', totalWeeks: 4, timezone: 'Asia/Shanghai' }; // 2026-09-07 是周一

  it('单时段：周数 × 1', () => {
    const rows = generateSessions({ ...base, schedule: [TUE_14] });
    expect(rows).toHaveLength(4);
    expect(rows.map(r => r.plannedDate)).toEqual(['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
    expect(rows.map(r => r.weekNo)).toEqual([1, 2, 3, 4]);
  });

  it('多时段：课次号按真实先后排，不是按时段分组', () => {
    const rows = generateSessions({ ...base, schedule: [THU_10, TUE_14] });
    expect(rows).toHaveLength(8);
    expect(rows.map(r => `${r.plannedDate} ${r.plannedStart}`).slice(0, 4)).toEqual([
      '2026-09-08 14:00', '2026-09-10 10:00', '2026-09-15 14:00', '2026-09-17 10:00',
    ]);
    expect(rows.map(r => r.sessionNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('开课日当天就是上课日时，第一周不跳过', () => {
    const rows = generateSessions({ startDate: '2026-09-08', totalWeeks: 2, timezone: 'Asia/Shanghai', schedule: [TUE_14] });
    expect(rows[0].plannedDate).toBe('2026-09-08');
  });

  it('开课日晚于该星期时顺延到下一周', () => {
    // 2026-09-09 是周三，周二的课要排到 09-15
    const rows = generateSessions({ startDate: '2026-09-09', totalWeeks: 1, timezone: 'Asia/Shanghai', schedule: [TUE_14] });
    expect(rows[0].plannedDate).toBe('2026-09-15');
  });

  it('plannedAt 是按课程时区换算的绝对时刻', () => {
    const [first] = generateSessions({ ...base, totalWeeks: 1, schedule: [TUE_14] });
    expect(first.plannedAt).toBe('2026-09-08T06:00:00.000Z');
  });

  it('参数不全时返回空，不产生半张表', () => {
    expect(generateSessions({ ...base, schedule: [] })).toEqual([]);
    expect(generateSessions({ ...base, totalWeeks: 0, schedule: [TUE_14] })).toEqual([]);
    expect(generateSessions({ ...base, startDate: '', schedule: [TUE_14] })).toEqual([]);
  });

  it('课次数量有上限，参数填错不会生成上千行', () => {
    const rows = generateSessions({ ...base, totalWeeks: 999, schedule: [TUE_14, THU_10] });
    expect(rows.length).toBeLessThanOrEqual(400);
  });
});

describe('estimateCreditHours', () => {
  it('按分钟总和折算学时，取到 0.5', () => {
    const rows = generateSessions({ startDate: '2026-09-07', totalWeeks: 16, timezone: 'Asia/Shanghai', schedule: [TUE_14] });
    expect(estimateCreditHours(rows)).toBe(24); // 16 × 90 分钟
  });
});
