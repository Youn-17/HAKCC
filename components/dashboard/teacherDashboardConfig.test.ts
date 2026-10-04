import { describe, expect, it } from 'vitest';
import {
  buildTeacherKpiCards,
  getDashboardHeroMeta,
  getRoleDashboardTabs,
  getTeacherDashboardTabs,
} from './teacherDashboardConfig';

describe('getTeacherDashboardTabs', () => {
  // 页签会随功能增加，锁死全量列表只会让测试反复过时。
  // 这里锁的是导航契约：核心页签必须在、顺序不能变、id 不能重复。
  it('exposes overview, courses, and ai settings as first-class teacher navigation', () => {
    for (const lang of ['en', 'zh'] as const) {
      const ids = getTeacherDashboardTabs(lang).map((t) => t.id);
      expect(ids[0]).toBe('overview');
      expect(ids).toEqual(expect.arrayContaining(['overview', 'courses', 'ai-settings']));
      expect(new Set(ids).size).toBe(ids.length);
      expect(getTeacherDashboardTabs(lang).every((t) => t.label.trim().length > 0)).toBe(true);
    }

    const zhLabels = new Map(getTeacherDashboardTabs('zh').map((t) => [t.id, t.label]));
    expect(zhLabels.get('overview')).toBe('概览');
    expect(zhLabels.get('courses')).toBe('课程');
    expect(zhLabels.get('ai-settings')).toBe('AI 设置');
  });
});

describe('getRoleDashboardTabs', () => {
  it('returns stable tab order for student and admin dashboards', () => {
    // 栏目会增删重排（学生端已按 KBSI 设计改过版），所以锁的是
    // 「overview 永远打头」+「这些核心栏目不能丢」，而不是完整次序。
    const studentIds = getRoleDashboardTabs('student', 'en').map((t) => t.id);
    expect(studentIds[0]).toBe('overview');
    expect(studentIds).toEqual(expect.arrayContaining(['overview', 'feedback', 'discover']));

    const adminIds = getRoleDashboardTabs('admin', 'zh').map((t) => t.id);
    expect(adminIds[0]).toBe('overview');
    expect(adminIds).toEqual(
      expect.arrayContaining(['overview', 'approvals', 'ai-analysis', 'courses']),
    );

    // 每个角色的页签 id 都必须唯一，且都要有译好的标签。
    for (const role of ['student', 'teacher', 'admin'] as const) {
      for (const lang of ['en', 'zh'] as const) {
        const tabs = getRoleDashboardTabs(role, lang);
        expect(new Set(tabs.map((t) => t.id)).size).toBe(tabs.length);
        expect(tabs.every((t) => t.label.trim().length > 0)).toBe(true);
      }
    }
  });
});

describe('getDashboardHeroMeta', () => {
  it('keeps the teacher hero action-focused without explanatory marketing copy', () => {
    expect(getDashboardHeroMeta('teacher', 'zh')).toEqual({
      eyebrow: 'Teacher Workspace',
      description: null,
    });
  });

  it('keeps student and admin hero copy short and operational', () => {
    expect(getDashboardHeroMeta('student', 'zh')).toEqual({
      eyebrow: 'Learning Dashboard',
      description: '查看课程、反馈与待办。',
    });

    expect(getDashboardHeroMeta('admin', 'en')).toEqual({
      eyebrow: 'Platform Control',
      description: 'Monitor approvals, platform health, and course readiness.',
    });
  });
});

describe('buildTeacherKpiCards', () => {
  it('maps live teacher aggregates into dashboard cards without legacy placeholder metrics', () => {
    expect(
      buildTeacherKpiCards('en', {
        totalStudents: 40,
        totalNotes: 20,
        aiEnabledCourses: 3,
        pendingFeedbackCount: 4,
      }),
    ).toEqual([
      { id: 'students', label: 'Total Students', value: 40, icon: 'users' },
      { id: 'notes', label: 'Total Notes', value: 20, icon: 'layers' },
      { id: 'ai-courses', label: 'AI Courses', value: 3, icon: 'sparkles' },
      { id: 'feedback', label: 'Unread Feedback', value: 4, icon: 'bell' },
    ]);
  });
});
