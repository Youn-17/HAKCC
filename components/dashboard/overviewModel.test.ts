import { describe, expect, it } from 'vitest';
import {
  buildStudentOverviewModel,
  buildTeacherOverviewModel,
  type DashboardCourseSignal,
} from './overviewModel';

describe('buildStudentOverviewModel', () => {
  const enrolledCourses: DashboardCourseSignal[] = [
    {
      id: 'course-1',
      title: 'Knowledge Building',
      instructor: 'Prof. Li',
      createDate: '2026-03-20',
      studentCount: 22,
      noteCount: 14,
      progress: 65,
      tags: ['kb'],
      hasAi: true,
      hasUnreadFeedback: true,
      hasUnreadNotifications: true,
      lastActivityAt: '2026-03-19T08:00:00.000Z',
    },
    {
      id: 'course-2',
      title: 'Community Inquiry',
      instructor: 'Prof. Chen',
      createDate: '2026-03-18',
      studentCount: 18,
      noteCount: 6,
      progress: 25,
      tags: ['inquiry'],
      hasAi: false,
      hasUnreadFeedback: false,
      hasUnreadNotifications: false,
      lastActivityAt: null,
    },
  ];

  it('aggregates student action-center counts from course and notification signals', () => {
    const model = buildStudentOverviewModel({
      enrolledCourses,
      availableCourses: [
        { id: 'course-3', title: 'AI Writing', instructor: 'Prof. Wu', tags: ['ai'], verification_code: 'AB12', hasAi: true },
      ],
      unreadNotifications: 3,
      unreadTeacherFeedback: 1,
      recentTeacherNotifications: [
        { id: 'n1', title: 'New Feedback', message: 'Teacher commented on your note.', createdAt: '2026-03-20T08:00:00.000Z' },
      ],
      availableCoursesError: null,
    });

    expect(model.actionCards).toEqual([
      { id: 'feedback', value: 1, tone: 'attention' },
      { id: 'notifications', value: 3, tone: 'attention' },
      { id: 'ai-courses', value: 1, tone: 'positive' },
      { id: 'discover', value: 1, tone: 'neutral' },
    ]);
    expect(model.highlightCourse?.id).toBe('course-1');
    expect(model.discoveryState).toBe('ready');
  });

  it('preserves API failure as error state instead of treating it as empty success', () => {
    const model = buildStudentOverviewModel({
      enrolledCourses: [],
      availableCourses: [],
      unreadNotifications: 0,
      unreadTeacherFeedback: 0,
      recentTeacherNotifications: [],
      availableCoursesError: 'Network unavailable',
    });

    expect(model.discoveryState).toBe('error');
    expect(model.emptyEnrolledState).toBe('onboarding');
  });
});

describe('buildTeacherOverviewModel', () => {
  it('sums real teacher KPIs from course aggregates', () => {
    const model = buildTeacherOverviewModel([
      {
        id: 'course-1',
        title: 'Knowledge Building',
        studentCount: 22,
        noteCount: 14,
        hasAi: true,
        unreadFeedbackCount: 3,
      },
      {
        id: 'course-2',
        title: 'Community Inquiry',
        studentCount: 18,
        noteCount: 6,
        hasAi: false,
        unreadFeedbackCount: 1,
      },
    ]);

    expect(model.totalStudents).toBe(40);
    expect(model.totalNotes).toBe(20);
    expect(model.aiEnabledCourses).toBe(1);
    expect(model.pendingFeedbackCount).toBe(4);
  });
});
