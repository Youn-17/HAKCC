import { describe, expect, it } from 'vitest';
import { CHANGELOG, LATEST_VERSION, changelogFor, latestVersionFor } from './changelog';

describe('更新日志', () => {
  it('public release notes exclude private study findings and internal planning paths', () => {
    expect(JSON.stringify(CHANGELOG)).not.toMatch(/pre-test|前测问卷|docs\/plans\/|under review|投稿|six of sixteen insertions/i);
  });
  it('最新的排在最前面，入口显示的就是它', () => {
    expect(LATEST_VERSION).toBe(CHANGELOG[0].version);
  });

  it('版本号不重复 —— 重复会让「已读」标记认错版本', () => {
    const versions = CHANGELOG.map(e => e.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('日期从新到旧排列', () => {
    // 'YYYY-MM' 的意思是「那个月某天」，不是「那个月一号」。
    // 所以按区间比：新条目的最晚可能日期，不能早于旧条目的最早可能日期。
    // 这样六月排在九月上面照样能抓出来，同月里不知道具体哪天则不误报。
    const span = (d: string): [number, number] => {
      if (d.length === 7) {
        const [y, m] = d.split('-').map(Number);
        return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 0)];
      }
      const ms = Date.parse(d);
      return [ms, ms];
    };
    for (let i = 1; i < CHANGELOG.length; i += 1) {
      const [, newerEnd] = span(CHANGELOG[i - 1].date);
      const [olderStart] = span(CHANGELOG[i].date);
      expect(newerEnd).toBeGreaterThanOrEqual(olderStart);
    }
  });

  it('这条排序检查确实抓得住真正的颠倒', () => {
    const span = (d: string) => (d.length === 7
      ? [Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, 1), Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)]
      : [Date.parse(d), Date.parse(d)]);
    // 六月的条目排在九月上面 —— 必须判为颠倒
    expect(span('2026-06')[1]).toBeLessThan(span('2026-09-06')[0]);
  });

  it('日期格式只允许 YYYY-MM 或 YYYY-MM-DD —— 不确定到哪天就别编', () => {
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
    }
  });

  it('每条都有中英文标题和至少一条内容，每条内容中英文都不为空', () => {
    for (const e of CHANGELOG) {
      expect(e.titleZh.trim()).not.toBe('');
      expect(e.titleEn.trim()).not.toBe('');
      expect(e.items.length).toBeGreaterThan(0);
      for (const item of e.items) {
        expect(item.zh.trim()).not.toBe('');
        expect(item.en.trim()).not.toBe('');
        if (item.for !== undefined) expect(['teacher', 'student']).toContain(item.for);
      }
    }
  });

  it('按受众过滤：教师端看不到学生专属条目，学生端看不到教师专属条目，共有的两端都有', () => {
    const teacher = changelogFor('teacher');
    const student = changelogFor('student');
    for (const e of teacher) for (const item of e.items) expect(item.for).not.toBe('student');
    for (const e of student) for (const item of e.items) expect(item.for).not.toBe('teacher');
    const shared = CHANGELOG.flatMap(e => e.items.filter(i => !i.for)).length;
    expect(teacher.flatMap(e => e.items.filter(i => !i.for)).length).toBe(shared);
    expect(student.flatMap(e => e.items.filter(i => !i.for)).length).toBe(shared);
  });

  it('一端一条都不剩的版本整个不出现，最新版本号按该端算', () => {
    for (const e of [...changelogFor('teacher'), ...changelogFor('student')]) {
      expect(e.items.length).toBeGreaterThan(0);
    }
    expect(latestVersionFor('teacher')).toBe(changelogFor('teacher')[0].version);
    expect(latestVersionFor('student')).toBe(changelogFor('student')[0].version);
  });
});
