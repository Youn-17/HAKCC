export interface DashboardCourseSignal {
  id: string;
  title: string;
  instructor?: string;
  createDate?: string;
  studentCount: number;
  noteCount: number;
  progress?: number;
  tags: string[];
  verification_code?: string | null;
  hasAi: boolean;
  hasUnreadFeedback: boolean;
  hasUnreadNotifications?: boolean;
  unreadFeedbackCount?: number;
  lastActivityAt: string | null;
}

export interface DiscoveryCourseSignal {
  id: string;
  title: string;
  instructor?: string;
  tags: string[];
  verification_code?: string | null;
  hasAi: boolean;
}

export interface TeacherNotificationSignal {
  id: string;
  title: string;
  message: string;
  createdAt: string;
}

export interface StudentOverviewModelInput {
  enrolledCourses: DashboardCourseSignal[];
  availableCourses: DiscoveryCourseSignal[];
  unreadNotifications: number;
  unreadTeacherFeedback: number;
  recentTeacherNotifications: TeacherNotificationSignal[];
  availableCoursesError: string | null;
}

export interface StudentOverviewModel {
  actionCards: Array<{ id: 'feedback' | 'notifications' | 'ai-courses' | 'discover'; value: number; tone: 'attention' | 'positive' | 'neutral' }>;
  highlightCourse: DashboardCourseSignal | null;
  discoveryState: 'ready' | 'empty' | 'error';
  emptyEnrolledState: 'onboarding' | 'ready';
}

export interface TeacherOverviewCourseSignal {
  id: string;
  title: string;
  studentCount: number;
  noteCount: number;
  hasAi: boolean;
  unreadFeedbackCount: number;
}

export interface TeacherOverviewModel {
  totalStudents: number;
  totalNotes: number;
  aiEnabledCourses: number;
  pendingFeedbackCount: number;
}

function pickHighlightCourse(courses: DashboardCourseSignal[]): DashboardCourseSignal | null {
  if (courses.length === 0) return null;

  const unreadFeedback = courses.find((course) => course.hasUnreadFeedback);
  if (unreadFeedback) return unreadFeedback;

  return [...courses].sort((left, right) => {
    const leftTs = left.lastActivityAt ? new Date(left.lastActivityAt).getTime() : 0;
    const rightTs = right.lastActivityAt ? new Date(right.lastActivityAt).getTime() : 0;
    return rightTs - leftTs;
  })[0];
}

export function buildStudentOverviewModel(input: StudentOverviewModelInput): StudentOverviewModel {
  return {
    actionCards: [
      { id: 'feedback', value: input.unreadTeacherFeedback, tone: input.unreadTeacherFeedback > 0 ? 'attention' : 'neutral' },
      { id: 'notifications', value: input.unreadNotifications, tone: input.unreadNotifications > 0 ? 'attention' : 'neutral' },
      {
        id: 'ai-courses',
        value: input.enrolledCourses.filter((course) => course.hasAi).length,
        tone: input.enrolledCourses.some((course) => course.hasAi) ? 'positive' : 'neutral',
      },
      { id: 'discover', value: input.availableCourses.length, tone: 'neutral' },
    ],
    highlightCourse: pickHighlightCourse(input.enrolledCourses),
    discoveryState: input.availableCoursesError ? 'error' : input.availableCourses.length > 0 ? 'ready' : 'empty',
    emptyEnrolledState: input.enrolledCourses.length > 0 ? 'ready' : 'onboarding',
  };
}

export function buildTeacherOverviewModel(courses: TeacherOverviewCourseSignal[]): TeacherOverviewModel {
  return {
    totalStudents: courses.reduce((sum, course) => sum + course.studentCount, 0),
    totalNotes: courses.reduce((sum, course) => sum + course.noteCount, 0),
    aiEnabledCourses: courses.filter((course) => course.hasAi).length,
    pendingFeedbackCount: courses.reduce((sum, course) => sum + course.unreadFeedbackCount, 0),
  };
}
