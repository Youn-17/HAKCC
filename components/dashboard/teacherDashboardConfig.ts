import { type Language, type UserRole } from '../../types';
import { type TeacherOverviewModel } from './overviewModel';

export type TeacherDashboardTabId = 'overview' | 'courses' | 'ai-settings';
export type TeacherKpiIconKey = 'users' | 'layers' | 'sparkles' | 'bell';
export type DashboardTabId = 'overview' | 'feedback' | 'discover' | 'ai-settings' | 'ai-analysis' | 'approvals' | 'courses' | 'research' | 'ai-agent' | 'student-help' | 'manual'
  | 'agent-chat' | 'agent-lesson' | 'agent-analytics' | 'agent-assess'
  | 'r-overview' | 'r-temporal' | 'r-sna' | 'r-lsa' | 'r-discourse' | 'r-equity' | 'r-ai-insights' | 'r-export'
  | 'r-coding' | 'teaching-log' | 'philosophy' | 'platform-feedback'
  | 'note-activity' | 'build-on' | 'thinking-dev' | 'collab-network' | 'thinking-trainer' | 'coding-trainer' | 'knowledge-graph' | 'promising-ideas';

export interface TeacherDashboardTab {
  id: DashboardTabId;
  label: string;
}

export interface TeacherKpiCard {
  id: 'students' | 'notes' | 'ai-courses' | 'feedback';
  label: string;
  value: number;
  icon: TeacherKpiIconKey;
}

export interface DashboardHeroMeta {
  eyebrow: string | null;
  description: string | null;
}

export function getRoleDashboardTabs(role: Extract<UserRole, 'student' | 'teacher' | 'admin'>, lang: Language): TeacherDashboardTab[] {
  if (role === 'student') {
    return lang === 'zh'
      ? [
          { id: 'overview', label: '概览' },
          { id: 'discover', label: '发现课程' },
          { id: 'note-activity', label: '笔记动态' },
          { id: 'knowledge-graph', label: '知识图谱' },
          { id: 'promising-ideas', label: '潜力想法' },
          { id: 'thinking-dev', label: '思维发展' },
          { id: 'collab-network', label: '协作网络' },
          { id: 'feedback', label: '教师反馈' },
          { id: 'ai-agent', label: 'AI 对话' },
          { id: 'thinking-trainer', label: '思维练习助手' },
          { id: 'coding-trainer', label: '编程练习助手' },
          { id: 'manual', label: '使用手册' },
        ]
      : [
          { id: 'overview', label: 'Overview' },
          { id: 'discover', label: 'Discover' },
          { id: 'note-activity', label: 'Note Activity' },
          { id: 'knowledge-graph', label: 'Knowledge Graph' },
          { id: 'promising-ideas', label: 'Promising Ideas' },
          { id: 'thinking-dev', label: 'Thinking Dev' },
          { id: 'collab-network', label: 'Collaboration' },
          { id: 'feedback', label: 'Feedback' },
          { id: 'ai-agent', label: 'AI Chat' },
          { id: 'thinking-trainer', label: 'Thinking Coach' },
          { id: 'coding-trainer', label: 'Coding Coach' },
          { id: 'manual', label: 'User Manual' },
        ];
  }

  if (role === 'admin') {
    return lang === 'zh'
      ? [
          { id: 'overview', label: '概览' },
          { id: 'approvals', label: '审批' },
          { id: 'ai-analysis', label: 'AI 分析' },
          { id: 'courses', label: '课程' },
        ]
      : [
          { id: 'overview', label: 'Overview' },
          { id: 'approvals', label: 'Approvals' },
          { id: 'ai-analysis', label: 'AI Analytics' },
          { id: 'courses', label: 'Courses' },
        ];
  }

  return lang === 'zh'
    ? [
        { id: 'overview', label: '概览' },
        { id: 'courses', label: '课程' },
        { id: 'agent-chat', label: 'AI 对话' },
        { id: 'agent-lesson', label: '备课助手' },
        { id: 'agent-analytics', label: '学情分析' },
        { id: 'agent-assess', label: '教学评估' },
        { id: 'student-help', label: '学生求助' },
        { id: 'ai-settings', label: 'AI 设置' },
        { id: 'manual', label: '使用手册' },
      ]
    : [
        { id: 'overview', label: 'Overview' },
        { id: 'courses', label: 'Courses' },
        { id: 'agent-chat', label: 'AI Chat' },
        { id: 'agent-lesson', label: 'Lesson Prep' },
        { id: 'agent-analytics', label: 'Analytics' },
        { id: 'agent-assess', label: 'Assessment' },
        { id: 'student-help', label: 'Student Help' },
        { id: 'ai-settings', label: 'AI Settings' },
        { id: 'manual', label: 'User Manual' },
      ];
}

export function getTeacherDashboardTabs(lang: Language): TeacherDashboardTab[] {
  return getRoleDashboardTabs('teacher', lang);
}

export function getDashboardHeroMeta(role: Extract<UserRole, 'student' | 'teacher' | 'admin'>, lang: Language): DashboardHeroMeta {
  if (role === 'teacher') {
    return {
      eyebrow: 'Teacher Workspace',
      description: null,
    };
  }

  if (role === 'student') {
    return {
      eyebrow: lang === 'zh' ? 'Learning Dashboard' : 'Learning Dashboard',
      description: lang === 'zh' ? '查看课程、反馈与待办。' : 'Review courses, feedback, and next actions.',
    };
  }

  return {
    eyebrow: lang === 'zh' ? 'Platform Control' : 'Platform Control',
    description: lang === 'zh' ? '监控审批、平台状态与课程准备度。' : 'Monitor approvals, platform health, and course readiness.',
  };
}

export function buildTeacherKpiCards(lang: Language, model: TeacherOverviewModel): TeacherKpiCard[] {
  return [
    {
      id: 'students',
      label: lang === 'zh' ? '总学生' : 'Total Students',
      value: model.totalStudents,
      icon: 'users',
    },
    {
      id: 'notes',
      label: lang === 'zh' ? '总笔记' : 'Total Notes',
      value: model.totalNotes,
      icon: 'layers',
    },
    {
      id: 'ai-courses',
      label: lang === 'zh' ? 'AI 课程' : 'AI Courses',
      value: model.aiEnabledCourses,
      icon: 'sparkles',
    },
    {
      id: 'feedback',
      label: lang === 'zh' ? '待阅读反馈' : 'Unread Feedback',
      value: model.pendingFeedbackCount,
      icon: 'bell',
    },
  ];
}
