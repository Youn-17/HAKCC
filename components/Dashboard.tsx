
import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { UserRole, Course, Language } from '../types';
import {
  Search, Bell, ChevronDown, BookOpen, Users, FileText, Plus, X,
  ArrowLeft,
  Filter, List, User, LogOut, Settings, LayoutGrid, Globe,
  TrendingUp, Clock, AlertCircle, CheckCircle, CheckCircle2, BarChart3, Activity,
  GraduationCap, Layers, Cpu, Key, ToggleLeft, ToggleRight, RefreshCw, Trash2, Eye,
  Bot, BrainCircuit, Sparkles, Waves, MoonStar, Orbit, Binary, Waypoints,
  MessageSquareCode, Atom, type LucideIcon
} from 'lucide-react';
import {
  courses as coursesApi,
  Course as ApiCourse,
  auth as authApi,
  AuthUser,
  ai as aiApi,
  ApiAIConfig,
  ApiClientError,
  TriggerSettings,
  AttentionItem,
  FeedbackReviewStats,
  FeedbackReviewItem,
  TriggerEffectivenessRow,
  FeedbackTrendPoint,
  admin as adminApi,
  AdminOverview,
  AdminAIAnalytics,
  AdminCourseSummary,
  dashboard as dashboardApi,
  StudentDashboardOverview,
  TeacherDashboardOverview,
  DashboardCourseSummary,
  LearnerProfileSummary,
  MyLearningInsights,
  type StudentAnalytics,
  aiModels,
  type AiModelCatalog,
  courseSessions,
  type CourseType,
  type ScheduleSlot,
} from '../services/apiClient';
import { useAuth } from '../contexts/AuthContext';
import ThemeToggle from './ThemeToggle';
import { LangSwitcher2, type Lang3 } from './LangSwitcher';
import { readPublicLanguage } from '../utils/languagePreference';
import { useTraditionalChinese } from '../hooks/useTraditionalChinese';
import { COURSE_TYPES, ScheduleSlotsEditor, estimateHours, inputClass, labelClass } from './courseSettings/scheduleShared';
import TeachingLogPanel from './dashboard/TeachingLogPanel';
import LoginLogPanel from './dashboard/LoginLogPanel';
import PlatformFeedbackPanel from './dashboard/PlatformFeedbackPanel';
import PendingSessionsPrompt from './dashboard/PendingSessionsPrompt';
import RemixIcon from './RemixIcon';
import { canManageCourse } from './courseStanding';
import { buildStudentOverviewModel, buildTeacherOverviewModel } from './dashboard/overviewModel';
import { buildTeacherKpiCards, getDashboardHeroMeta, getRoleDashboardTabs, getTeacherDashboardTabs, type DashboardTabId } from './dashboard/teacherDashboardConfig';
import { gsap, prepareForMotion, shouldReduceMotion, useGSAP } from '../utils/gsapMotion';
import DashboardSidebar from './dashboard/DashboardSidebar';
import NotificationBell from './dashboard/NotificationBell';
import { SparklineKpiCard, WeeklyActivityChart, FeedbackDonutChart, EngagementHeatmap, DashboardTopBar, useActivityPulse } from './dashboard/LearningCharts';
import { BentoGrid, HeroTile, KpiTile, StatusTile, CourseStrip, QuickAction } from './dashboard/BentoGrid';
import StudentHelpDesk from './dashboard/StudentHelpDesk';
import AiFeatureModelsPanel from './dashboard/AiFeatureModelsPanel';
import UserAvatar from './UserAvatar';
import CourseTitleEditor from './dashboard/CourseTitleEditor';
import ProfileSettingsCard from './dashboard/ProfileSettingsCard';
import UserManual from './manual/UserManual';
import PlatformPhilosophy from './manual/PlatformPhilosophy';
import { NoteActivityPanel, PromisingIdeasPanel, ThinkingDevPanel, CollabNetworkPanel } from './dashboard/StudentLearningPanels';

const PersonalAgentPage = lazy(() => import('./PersonalAgentPage'));
const StudentKnowledgeGraphView = lazy(() => import('./dashboard/StudentKnowledgeGraph'));
const ThinkingGym = lazy(() => import('./ThinkingGym'));
const CodingDojo = lazy(() => import('./CodingDojo'));
// Teacher-only research suite (~5.6k lines incl. ResearchViz/ResearchAdvanced) —
// lazy so students never download it.
const ResearchZone = lazy(() => import('./dashboard/ResearchZone'));
const QualitativeCoding = lazy(() => import('./dashboard/QualitativeCoding'));

interface DashboardProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  onCourseSelect: (courseId: string, courseTitle: string) => void;
  lang: Language;
  setLang: (lang: Language) => void;
}

// No mock courses — load from API only

// --- Translations ---
const TRANSLATIONS = {
  en: {
    welcome: "Welcome back, ",
    roleSubtitle: {
      student: "Let's continue the journey of knowledge building.",
      teacher: "Manage your courses and unleash student potential.",
      admin: "Monitor platform operations and ensure teaching quality."
    },
    searchPlaceholder: "Search courses, teachers, or codes...",
    roles: { student: "Student", teacher: "Teacher", admin: "Admin" },
    nav: { profile: "Profile", settings: "Settings", logout: "Logout", dashboard: "Dashboard", myCourses: "My Courses" },
    student: {
      myCourses: "My Courses",
      popular: "Popular Courses",
      allCourses: "Browse All Courses",
      continue: "Continue Learning",
      start: "Start Learning",
      join: "Join Course",
      filter: "Filter"
    },
    teacher: {
      createdCourses: "My Created Courses",
      stats: "Course Statistics",
      allPlatformCourses: "All Platform Courses",
      manage: "Manage",
      enter: "Enter Course",
      viewData: "View Data",
      create: "Create New Course",
      aiSettings: "AI Integration Settings",
      statLabels: { students: "Total Students", notes: "Total Notes", activity: "Activity Rate", messages: "New Messages" }
    },
    admin: {
      overview: "Platform Overview",
      pending: "Pending Tasks",
      allCourses: "All Courses Management",
      aiAnalysis: "AI Usage Analysis",
      tabs: {
        overview: "Overview",
        approvals: "Approvals",
        aiAnalysis: "AI Analytics",
        courses: "Courses",
      },
      enter: "Enter Course",
      statLabels: { courses: "Total Courses", teachers: "Total Teachers", students: "Total Students", pending: "Pending" },
      table: { name: "Course Name", instructor: "Instructor", stats: "Stats", date: "Created", actions: "Actions" },
      actions: { details: "Details", analysis: "Analysis", manage: "Manage", handle: "Handle Now", enter: "Enter" }
    }
  },
  zh: {
    welcome: "欢迎回来，",
    roleSubtitle: {
      student: "让我们继续知识建构之旅",
      teacher: "管理您的课程，激发学生潜能",
      admin: "监控平台运行，保障教学质量"
    },
    searchPlaceholder: "搜索课程名称、教师姓名或课程代码...",
    roles: { student: "学生", teacher: "教师", admin: "管理员" },
    nav: { profile: "个人中心", settings: "设置", logout: "退出登录", dashboard: "学习仪表盘", myCourses: "课程中心" },
    student: {
      myCourses: "我的课程",
      popular: "热门课程",
      allCourses: "浏览所有课程",
      continue: "继续学习",
      start: "开始学习",
      join: "加入课程",
      filter: "筛选"
    },
    teacher: {
      createdCourses: "我创建的课程",
      stats: "课程统计概览",
      allPlatformCourses: "平台所有课程",
      manage: "管理课程",
      enter: "进入课程",
      viewData: "查看数据",
      create: "创建新课程",
      aiSettings: "AI 集成设置",
      statLabels: { students: "总学生", notes: "总笔记", activity: "活跃度", messages: "新消息" }
    },
    admin: {
      overview: "平台概览",
      pending: "待处理事项",
      allCourses: "所有课程",
      aiAnalysis: "AI 使用分析",
      tabs: {
        overview: "概览",
        approvals: "审批",
        aiAnalysis: "AI 分析",
        courses: "课程",
      },
      enter: "进入课程",
      statLabels: { courses: "总课程", teachers: "总教师", students: "总学生", pending: "待审核" },
      table: { name: "课程名称", instructor: "教师信息", stats: "统计数据", date: "创建日期", actions: "操作" },
      actions: { details: "查看详情", analysis: "课程分析", manage: "管理", handle: "立即处理", enter: "进入" }
    }
  }
};

const TEACHER_KPI_ICONS: Record<'users' | 'layers' | 'sparkles' | 'bell', LucideIcon> = {
  users: Users,
  layers: Layers,
  sparkles: Sparkles,
  bell: Bell,
};
const DEFAULT_INSTRUCTOR_NAME = 'Course teacher';
const PLACEHOLDER_INSTRUCTOR_NAMES = new Set(['unknown', 'unnamed', 'anonymous', 'null', 'undefined', 'adrian', '未知', '未知用户']);
const ROLE_TAB_ICON_NAMES: Record<string, string> = {
  overview: 'dashboard-3-line',
  feedback: 'message-3-line',
  discover: 'compass-3-line',
  courses: 'book-open-line',
  'ai-settings': 'cpu-line',
  'ai-analysis': 'bar-chart-2-line',
  approvals: 'shield-check-line',
};
const STUDENT_ACTION_ICON_NAMES: Record<string, string> = {
  feedback: 'chat-3-line',
  notifications: 'notification-3-line',
  'ai-courses': 'cpu-line',
  discover: 'compass-discover-line',
};
const TEACHER_KPI_ICON_NAMES: Record<string, string> = {
  students: 'team-line',
  notes: 'file-list-3-line',
  'ai-courses': 'cpu-line',
  feedback: 'notification-3-line',
};

function cleanInstructorName(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name || PLACEHOLDER_INSTRUCTOR_NAMES.has(name.toLowerCase())) return undefined;
  return name;
}

// --- Components ---

const CourseCard: React.FC<{ course: Course; role: UserRole; onClick: () => void; onSettingsClick?: (course: Course) => void; lang: Language; t: any }> = ({ course, role, onClick, onSettingsClick, lang, t }) => {
  const showStats = role === 'teacher' || role === 'admin';
  const isTeacherCard = role === 'teacher';

  const handleEnter = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Enter course: ${course.title}`}
      className="gsap-course-card group rounded-xl transition-[box-shadow,transform] duration-200 cursor-pointer border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col h-[178px] bg-white dark:bg-gray-950 hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[#000080]/30"
      style={{ width: '100%' }}
    >
      <div className="h-14 relative p-3 flex flex-col justify-end text-white bg-cover bg-center"
           style={{ backgroundImage: course.coverImage }}>
        <div className="absolute inset-0 bg-[#000080]/80" />
        <h3 className="font-semibold text-[0.8125rem] leading-tight z-10 line-clamp-1">{course.title}</h3>
      </div>

      <div className="p-3 flex-1 flex flex-col justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[0.6875rem] text-gray-500 dark:text-gray-400">
            <RemixIcon name={isTeacherCard ? 'graduation-cap-line' : 'user-3-line'} size={11} />
            <span className="truncate">{course.instructor}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {course.tags.slice(0, 2).map(tag => (
              <span key={tag} className="px-2 py-0.5 text-[0.6875rem] rounded font-medium bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400">
                #{tag}
              </span>
            ))}
            {role === 'student' && course.hasAi && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#000080]/[0.06] dark:bg-[#4169E1]/[0.12] text-[#000080] dark:text-[#93AAFD] text-[0.6875rem] rounded font-medium">
                <RemixIcon name="cpu-line" size={10} />AI
              </span>
            )}
            {role === 'student' && course.hasUnreadFeedback && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[0.6875rem] rounded font-medium">
                <RemixIcon name="message-3-line" size={10} />
                {lang === 'zh' ? '反馈' : 'Feedback'}
              </span>
            )}
          </div>
        </div>

        <div>
          {showStats ? (
            <div className="flex items-center gap-3 text-[0.6875rem] mb-1.5 text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1"><RemixIcon name="user-star-line" size={12} /> {course.teacherCount ?? 1} {lang === 'zh' ? '教师' : 'teachers'} · {course.studentCount} {lang === 'zh' ? '学生' : 'students'}</span>
              <span className="flex items-center gap-1"><RemixIcon name="file-list-3-line" size={12} /> {course.noteCount}</span>
            </div>
          ) : (
             <div className="h-2" />
          )}

          {role === 'student' && course.progress !== undefined && (
            <div className="mb-1.5">
              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1 overflow-hidden">
                <div className="bg-[#000080] dark:bg-[#4169E1] h-1 rounded-full transition-[width] duration-500" style={{ width: `${course.progress}%` }} />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleEnter}
              className="flex-1 py-1.5 min-h-[32px] rounded-lg text-[0.75rem] font-semibold transition-colors inline-flex items-center justify-center gap-1.5 bg-[#000080] text-white hover:bg-[#000080]/90"
            >
              <span>
                {role === 'student'
                  ? (course.progress && course.progress > 0 ? t.student.continue : t.student.start)
                  : role === 'teacher' ? t.teacher.enter : t.admin.enter}
              </span>
              <RemixIcon name="arrow-right-line" size={12} />
            </button>
            {onSettingsClick && (
              <button
                onClick={(e) => { e.stopPropagation(); onSettingsClick(course); }}
                className="px-2.5 py-1.5 min-h-[32px] rounded-lg text-[0.75rem] font-semibold transition-colors bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
                title={lang === 'zh' ? '课程管理' : 'Course management'}
                aria-label={lang === 'zh' ? `课程管理 ${course.title}` : `Manage ${course.title}`}
              >
                <RemixIcon name="settings-3-line" size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- New Component: Teacher AI Settings ---
type ProviderMeta = {
  id: string;
  name: string;
  nameZh: string;
  icon: LucideIcon;
  models: string[];
  summaryEn: string;
  summaryZh: string;
};

const ALL_PROVIDERS: ProviderMeta[] = [
  { id: 'openai', name: 'OpenAI', nameZh: 'ChatGPT', icon: Bot, models: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'], summaryEn: 'General-purpose reasoning and assistant workflows.', summaryZh: '通用推理与课程助手工作流。' },
  { id: 'anthropic', name: 'Anthropic', nameZh: 'Claude', icon: BrainCircuit, models: ['claude-opus-4-6', 'claude-haiku-4-5-20251001'], summaryEn: 'Long-form explanation and careful instructional feedback.', summaryZh: '长文本解释与审慎教学反馈。' },
  { id: 'google', name: 'Google', nameZh: 'Gemini', icon: Sparkles, models: ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro'], summaryEn: 'Fast multimodal support for classroom exploration.', summaryZh: '适合课堂探索的快速多模态支持。' },
  { id: 'deepseek', name: 'DeepSeek', nameZh: 'DeepSeek', icon: Waves, models: ['deepseek-flash', 'deepseek-v4-pro'], summaryEn: 'Reasoning-heavy workflows with concise outputs.', summaryZh: '偏推理型工作流，输出克制清晰。' },
  { id: 'dmx', name: 'DMXAPI', nameZh: 'DMXAPI 聚合', icon: Waypoints, models: ['glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.5', 'claude-opus-4-6', 'glm-4.6v'], summaryEn: 'One aggregator key for automatic routing across major model families.', summaryZh: '一个聚合 Key，支持课程 AI 根据任务自动选择不同模型。' },
  { id: 'moonshot', name: 'Moonshot', nameZh: 'Kimi', icon: MoonStar, models: ['kimi-k3'], summaryEn: 'Long-context synthesis for reading-intensive courses.', summaryZh: '适合阅读密集课程的长上下文综合。' },
  { id: 'doubao', name: 'Doubao', nameZh: '豆包', icon: MessageSquareCode, models: ['doubao-pro-4k', 'doubao-pro-32k'], summaryEn: 'Conversation-first support for lightweight teaching tasks.', summaryZh: '适合轻量教学任务的对话支持。' },
  { id: 'xai', name: 'xAI', nameZh: 'Grok', icon: Orbit, models: ['grok-2', 'grok-beta'], summaryEn: 'Fast conversational ideation and alternative viewpoints.', summaryZh: '快速对话式发想与观点补充。' },
  { id: 'baidu', name: 'Baidu', nameZh: '文心一言', icon: Binary, models: ['ernie-4.0-8k', 'ernie-3.5-8k', 'ernie-speed-8k'], summaryEn: 'Domestic-language support for CN-first classrooms.', summaryZh: '更适合中文优先课堂的本地化支持。' },
  { id: 'alibaba', name: 'Alibaba', nameZh: '通义千问', icon: Atom, models: ['qwen3.8-max', 'qwen3.6-plus', 'qwen3.8-flash', 'qwen3-vl-plus'], summaryEn: 'Balanced generation quality with broad model options.', summaryZh: '质量与模型选择较均衡的方案。' },
  { id: 'zhipu', name: 'ZhiPu', nameZh: '智谱清言', icon: Waypoints, models: ['glm-5.3', 'glm-5.2', 'glm-4.7', 'glm-4.6', 'glm-5.3-flash', 'glm-4.5-air', 'glm-4.6v', 'glm-4.5v'], summaryEn: 'GLM models with native function calling. GLM-5V-Turbo supports multimodal coding.', summaryZh: '智谱 GLM 系列，原生支持工具调用。GLM-5V-Turbo 支持多模态视觉编程。' },
  { id: 'openrouter', name: 'OpenRouter', nameZh: 'OpenRouter', icon: Globe, models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro'], summaryEn: 'Centralized routing across multiple model families.', summaryZh: '统一路由多家模型服务。' },
  { id: 'minimax', name: 'MiniMax', nameZh: 'MiniMax 海螺', icon: Waves, models: ['MiniMax-Text-01', 'MiniMax-M2.7', 'abab6.5s-chat'], summaryEn: 'Native key for fast image generation (image-01) and speech synthesis, without routing through an aggregator.', summaryZh: '自有 Key，直连生图（image-01）与语音合成，不经聚合商中转，比 DMX 快很多。' },
  { id: 'tavily', name: 'Tavily', nameZh: 'Tavily 网页搜索', icon: Search, models: [], summaryEn: 'Course-level web evidence search for the AI partner. The key stays server-side.', summaryZh: '为课程 AI 助手提供网页证据检索能力，密钥只保存在后端。' },
];

const TeacherAISettings: React.FC<{ lang: Language; courseId: string; courses?: Course[] }> = ({ lang, courseId: initialCourseId, courses = [] }) => {
  const [activeCourseId, setActiveCourseId] = useState(initialCourseId);
  const courseId = activeCourseId || initialCourseId;
  const [configuredIds, setConfiguredIds] = useState<Set<string>>(new Set());
  const [editingProvider, setEditingProvider] = useState<typeof ALL_PROVIDERS[0] | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [endpointUrlInput, setEndpointUrlInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  /**
   * 可选模型从后端 /ai/model-catalog 取，不再在前端写死一份。
   * 写死的那份和后端漂移过：默认启用列表里躺着 DMX 早就下线的 claude-sonnet-4-5，
   * 学生点一次失败一次，表现出来就是「AI 时好时坏」。
   */
  const [catalog, setCatalog] = useState<AiModelCatalog | null>(null);
  useEffect(() => { aiModels.catalog().then(setCatalog).catch(() => setCatalog(null)); }, []);

  const providerModels = useMemo(() => {
    if (!editingProvider) return [] as { id: string; label: string; note?: string }[];
    if (!catalog) return editingProvider.models.map(id => ({ id, label: id }));
    if (editingProvider.id === 'dmx' || editingProvider.id === 'dmxapi') {
      return [...catalog.dmx.text, ...catalog.dmx.vision];
    }
    const native = catalog.native[editingProvider.id];
    return native?.length ? native : editingProvider.models.map(id => ({ id, label: id }));
  }, [editingProvider, catalog]);
  const [customModelInput, setCustomModelInput] = useState('');

  // Load existing configs from backend
  useEffect(() => {
    if (!courseId) return;
    setLoadingConfigs(true);
    aiApi.listConfigs(courseId)
      .then(({ configs }) => {
        setConfiguredIds(new Set(configs.map(c => c.providerId)));
      })
      .catch(() => {})
      .finally(() => setLoadingConfigs(false));
  }, [courseId]);

  // Labels
  const lbl = lang === 'zh' ? {
    title: 'AI 集成设置',
    desc: '配置并管理您的 AI API 密钥。这些密钥仅用于您的课程，不会与其他教师共享。',
    addKey: '添加 API 密钥',
    configured: '已配置',
    unconfigured: '未配置',
    verify: '验证并保存',
    verifying: '验证中...',
    endpointUrl: 'Endpoint URL（可选）',
    endpointHint: 'DMX 默认使用 https://www.dmxapi.cn/v1/chat/completions；COM/SSVIP 令牌请填写对应站点。',
    cancel: '取消',
    reconfig: '重新配置',
    remove: '移除',
    enterKey: '请输入 API Key…',
    success: '配置成功！API Key 已验证。',
    failed: '验证失败，请检查 API Key 是否正确。',
    supportedModels: '支持模型: ',
    selectModels: '选择启用的模型',
    noCourse: '请先创建一个课程，然后再配置 AI 提供商。',
  } : {
    title: 'AI Integration Settings',
    desc: 'Configure and manage your AI API keys. These are private to your courses.',
    addKey: 'Add API Key',
    configured: 'Configured',
    unconfigured: 'Not Configured',
    verify: 'Verify & Save',
    verifying: 'Verifying...',
    endpointUrl: 'Endpoint URL (optional)',
    endpointHint: 'DMX defaults to https://www.dmxapi.cn/v1/chat/completions; use the matching COM/SSVIP endpoint when needed.',
    cancel: 'Cancel',
    reconfig: 'Reconfigure',
    remove: 'Remove',
    enterKey: 'Enter API Key…',
    success: 'Configuration saved! API key verified.',
    failed: 'Verification failed. Please check your API key.',
    supportedModels: 'Supported Models: ',
    selectModels: 'Select enabled models',
    noCourse: 'Please create a course first before configuring AI providers.',
  };

  const handleSaveKey = async () => {
    if (!editingProvider || !courseId) return;
    setIsVerifying(true);

    try {
      const { verified } = await aiApi.saveConfig(courseId, {
        provider_id: editingProvider.id,
        api_key: apiKeyInput,
        endpoint_url: endpointUrlInput.trim() || undefined,
        enabled_models: selectedModels.length > 0 ? selectedModels : providerModels.map(m => m.id),
      });

      if (verified) {
        setConfiguredIds(prev => new Set([...prev, editingProvider.id]));
        setEditingProvider(null);
        setApiKeyInput('');
        setEndpointUrlInput('');
        setSelectedModels([]);
        setCustomModelInput('');
        alert(lbl.success);
      } else {
        // Saved but not verified — still mark as configured
        setConfiguredIds(prev => new Set([...prev, editingProvider.id]));
        setEditingProvider(null);
        setApiKeyInput('');
        setEndpointUrlInput('');
        setSelectedModels([]);
        setCustomModelInput('');
        alert(lang === 'zh' ? '已保存，但连通性验证未通过。请检查 API Key。' : 'Saved, but connectivity check failed. Please verify your API key.');
      }
    } catch (e: any) {
      alert(lbl.failed + (e?.message ? `\n${e.message}` : ''));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRemove = async (providerId: string) => {
    if (!courseId) return;
    const confirmed = confirm(lang === 'zh' ? '确定要移除此 AI 配置吗？' : 'Remove this AI configuration?');
    if (!confirmed) return;
    try {
      await aiApi.deleteConfig(courseId, providerId);
      setConfiguredIds(prev => { const n = new Set(prev); n.delete(providerId); return n; });
    } catch { /* ignore */ }
  };

  if (!courseId) {
    return (
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="rounded-[20px] border border-stone-200 dark:border-stone-800 bg-stone-50/90 dark:bg-stone-950 p-4 flex items-start gap-3">
          <div className="rounded-full bg-amber-100 dark:bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
            <AlertCircle size={18} className="mt-0.5" />
          </div>
          <p className="text-sm leading-6 text-stone-700 dark:text-stone-200">{lbl.noCourse}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 duration-700">
       <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Cpu size={15} className="text-[#000080] dark:text-[#93AAFD]" />
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{lbl.title}</h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xl">{lbl.desc}</p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-3.5 py-2 text-center">
            <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {lang === 'zh' ? '已配置' : 'Configured'}
            </div>
            <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">{configuredIds.size}</div>
          </div>
       </div>

       {/* Course selector (when teacher has multiple courses) */}
       {courses.length > 1 && (
	     <div className="mb-5">
           <label className="mb-2 block text-[0.6875rem] font-semibold uppercase tracking-[0.24em] text-stone-500 dark:text-stone-400">
             {lang === 'zh' ? '选择课程' : 'Select Course'}
           </label>
           <select
             className="w-full max-w-md rounded-xl border border-stone-200 dark:border-stone-700 bg-white/90 dark:bg-stone-950 px-4 py-2.5 text-sm text-stone-800 dark:text-stone-100 outline-none transition-colors focus:border-stone-400 focus:ring-2 focus:ring-stone-300/70 dark:focus:border-stone-500 dark:focus:ring-stone-700"
             value={courseId}
             onChange={e => { setActiveCourseId(e.target.value); setConfiguredIds(new Set()); setLoadingConfigs(true); }}
           >
             {courses.map(c => (
               <option key={c.id} value={c.id}>{c.title}</option>
             ))}
           </select>
         </div>
       )}

       {loadingConfigs ? (
         <div className="rounded-[20px] border border-stone-200 dark:border-stone-800 bg-white/80 dark:bg-stone-950 px-5 py-8 text-center text-stone-500 dark:text-stone-400">
           <RefreshCw size={20} className="animate-spin inline mr-2" />{lang === 'zh' ? '加载中…' : 'Loading…'}
         </div>
       ) : (
       <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {ALL_PROVIDERS.map(p => {
            const isConfigured = configuredIds.has(p.id);
            const ProviderIcon = p.icon;
            return (
            <div key={p.id} className={`rounded-xl border p-4 flex flex-col justify-between transition-colors ${isConfigured ? 'border-[#000080]/20 dark:border-[#4169E1]/20 bg-white dark:bg-gray-950' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 hover:border-gray-300 dark:hover:border-gray-700'}`}>
               <div>
	                 <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
	                       <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 text-stone-700 dark:text-stone-200">
	                         <ProviderIcon size={18} />
                       </div>
                       <div>
                         <div className="font-semibold text-stone-900 dark:text-stone-100">{lang === 'zh' ? p.nameZh : p.name}</div>
                         <div className="mt-1 text-[0.6875rem] uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500">{p.id}</div>
                       </div>
                    </div>
                    {isConfigured ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-[0.6875rem] font-semibold text-emerald-700 dark:text-emerald-400"><CheckCircle size={10}/> {lbl.configured}</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 px-2 py-0.5 text-[0.6875rem] font-semibold text-gray-500 dark:text-gray-400">{lbl.unconfigured}</span>
                    )}
                 </div>
	                 <p className="mb-3 text-sm leading-6 text-stone-600 dark:text-stone-300">
                   {lang === 'zh' ? p.summaryZh : p.summaryEn}
                 </p>
	                 <div className="mb-4 text-xs text-stone-500 dark:text-stone-400">
                    {p.models.length > 0 ? (
                      <>
                        <span className="font-semibold">{lbl.supportedModels}</span>
                        {p.models.slice(0, 2).join(', ')}{p.models.length > 2 && '…'}
                      </>
                    ) : (
                      <span className="font-semibold">
                        {lang === 'zh' ? '能力：课程级网页证据检索' : 'Capability: course-level web evidence search'}
                      </span>
                    )}
                 </div>
               </div>

               <div className="mt-2 flex gap-2">
                 {isConfigured ? (
                   <>
	                     <button onClick={() => { setEditingProvider(p); setApiKeyInput(''); setEndpointUrlInput(''); setSelectedModels([]); }} className="min-h-[40px] flex-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 px-3.5 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200 transition-colors hover:bg-stone-200 dark:hover:bg-stone-800">{lbl.reconfig}</button>
	                     <button onClick={() => handleRemove(p.id)} aria-label={lang === 'zh' ? '移除配置' : 'Remove configuration'} className="min-h-[40px] rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-950 px-3 py-2 text-stone-500 dark:text-stone-300 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-500/30 dark:hover:bg-red-500/10"><Trash2 size={14}/></button>
                   </>
                 ) : (
                   <button
                     onClick={() => { setEditingProvider(p); setApiKeyInput(''); setEndpointUrlInput(''); setSelectedModels([]); }}
	                     className="min-h-[40px] w-full rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300 flex items-center justify-center gap-2"
                   >
                     <Plus size={14}/> {lbl.addKey}
                   </button>
                 )}
               </div>
            </div>
          );})}
       </div>
       )}

       {/* API Key Modal */}
       {editingProvider && (
         <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
            <div className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6 shadow-lg animate-in zoom-in-95 duration-200">
               <h3 className="mb-5 flex items-center gap-3 text-base font-semibold text-gray-900 dark:text-gray-100">
                 <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200">
                   <editingProvider.icon size={16} />
                 </div>
                 {lang === 'zh' ? '配置 ' + editingProvider.nameZh : 'Configure ' + editingProvider.name}
               </h3>
               <div className="mb-4">
                 <label className="mb-2 block text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">API Key</label>
                 <input
                   type="password"
                   value={apiKeyInput}
                   onChange={(e) => setApiKeyInput(e.target.value)}
                   placeholder={lbl.enterKey}
                   className="w-full rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 p-3 font-mono text-sm text-stone-900 dark:text-stone-100 outline-none transition-colors focus:border-stone-400 focus:ring-2 focus:ring-stone-300/70 dark:focus:border-stone-500 dark:focus:ring-stone-700"
                 />
               </div>
               <div className="mb-4">
                 <label className="mb-2 block text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">{lbl.endpointUrl}</label>
                 <input
                   type="url"
                   value={endpointUrlInput}
                   onChange={(e) => setEndpointUrlInput(e.target.value)}
                   placeholder={editingProvider.id === 'dmx' || editingProvider.id === 'dmxapi' ? 'https://www.dmxapi.cn/v1/chat/completions' : editingProvider.id === 'zhipu' ? 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions' : 'https://.../v1/chat/completions'}
                   className="w-full rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 p-3 font-mono text-xs text-stone-900 dark:text-stone-100 outline-none transition-colors focus:border-stone-400 focus:ring-2 focus:ring-stone-300/70 dark:focus:border-stone-500 dark:focus:ring-stone-700"
                 />
                 <p className="mt-2 text-[0.6875rem] leading-5 text-stone-400 dark:text-stone-500">
                   {editingProvider.id === 'zhipu'
                     ? (lang === 'zh'
                       ? 'Coding Plan 订阅请填写 https://open.bigmodel.cn/api/coding/paas/v4/chat/completions，走订阅额度而非 token 余额。留空则使用普通 API。'
                       : 'For Coding Plan subscriptions, use https://open.bigmodel.cn/api/coding/paas/v4/chat/completions to consume plan quota instead of token balance. Leave empty for standard API.')
                     : lbl.endpointHint}
                 </p>
               </div>
               {providerModels.length > 0 ? (
                 <div className="mb-4">
                   <label className="mb-2 block text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">{lbl.selectModels}</label>
                   <div className="flex flex-wrap gap-2">
                     {editingProvider.models.map(m => (
                       <button
                         key={m}
                         onClick={() => setSelectedModels(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])}
                         className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                           selectedModels.includes(m) || selectedModels.length === 0
                             ? 'bg-stone-900 text-stone-50 border-stone-900 dark:bg-stone-100 dark:text-stone-950 dark:border-stone-100'
                             : 'bg-stone-50 dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-700'
                         }`}
                       >
                         {m}
                       </button>
                     ))}
                   </div>
                   <p className="mt-2 text-[0.6875rem] text-stone-400 dark:text-stone-500">{lang === 'zh' ? '不选择则启用全部模型' : 'Leave empty to enable all models'}</p>
                   <div className="mt-3 flex gap-2">
                     <input
                       type="text"
                       value={customModelInput}
                       onChange={(e) => setCustomModelInput(e.target.value)}
                       aria-label={lang === 'zh' ? '自定义模型 ID' : 'Custom model ID'}
                       placeholder={lang === 'zh' ? '输入自定义模型 ID，如 glm-5.2' : 'Custom model ID, e.g. glm-5.2'}
                       className="flex-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 px-3 py-1.5 font-mono text-xs text-stone-900 dark:text-stone-100 outline-none focus:border-stone-400 dark:focus:border-stone-500"
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && customModelInput.trim()) {
                           const m = customModelInput.trim();
                           if (!selectedModels.includes(m)) setSelectedModels(prev => [...prev, m]);
                           setCustomModelInput('');
                         }
                       }}
                     />
                     <button
                       type="button"
                       disabled={!customModelInput.trim()}
                       onClick={() => {
                         const m = customModelInput.trim();
                         if (m && !selectedModels.includes(m)) setSelectedModels(prev => [...prev, m]);
                         setCustomModelInput('');
                       }}
                       className="rounded-xl bg-stone-200 dark:bg-stone-700 px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-200 transition-colors hover:bg-stone-300 dark:hover:bg-stone-600 disabled:opacity-40"
                     >
                       {lang === 'zh' ? '添加' : 'Add'}
                     </button>
                   </div>
                 </div>
               ) : (
                 <div className="mb-4 rounded-2xl border border-sky-100 bg-sky-50/80 p-3 text-xs leading-5 text-slate-600 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-slate-300">
                   {lang === 'zh'
                     ? '保存后，这门课程的 AI 助手会出现“网页证据”能力。学生不会看到 API Key，也不能单独调用 Tavily。'
                     : 'After saving, this course AI partner gains a web evidence capability. Students never see the API key or call Tavily directly.'}
                 </div>
               )}
               <div className="flex gap-3">
                 <button onClick={() => { setEditingProvider(null); setEndpointUrlInput(''); }} className="min-h-[44px] flex-1 rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 py-2.5 text-sm font-semibold text-stone-700 dark:text-stone-200 transition-colors hover:bg-stone-200 dark:hover:bg-stone-800">{lbl.cancel}</button>
                 <button
                   onClick={handleSaveKey}
                   disabled={isVerifying || !apiKeyInput}
                   className="min-h-[44px] flex-1 rounded-2xl bg-stone-900 py-2.5 text-sm font-semibold text-stone-50 disabled:opacity-50 transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300 flex items-center justify-center gap-2"
                 >
                   {isVerifying ? <RefreshCw size={16} className="animate-spin"/> : <Key size={16}/>}
                   {isVerifying ? lbl.verifying : lbl.verify}
                 </button>
               </div>
            </div>
         </div>
       )}
    </section>
  );
};

// --- Teacher Trigger Settings Panel ---
const TRIGGER_TYPE_META: { id: string; labelEn: string; labelZh: string; descEn: string; descZh: string }[] = [
  { id: 'undigested_ai', labelEn: 'Undigested AI (T1)', labelZh: '未消化的 AI 内容 (T1)', descEn: 'Detects pasted AI output without student voice', descZh: '检测学生未加工的 AI 粘贴内容' },
  { id: 'no_reasoning', labelEn: 'No Reasoning (T2)', labelZh: '缺少推理 (T2)', descEn: 'Opinion stated without explanation', descZh: '有观点但无推理过程' },
  { id: 'no_evidence', labelEn: 'No Evidence (T3)', labelZh: '缺少证据 (T3)', descEn: 'Claim without supporting evidence', descZh: '知识主张缺少证据支撑' },
  { id: 'no_connection', labelEn: 'No Connection (T4)', labelZh: '缺少关联 (T4)', descEn: 'Ideas listed without connections', descZh: '要点罗列但未建立联系' },
  { id: 'promising_seed', labelEn: 'Promising Seed (T5)', labelZh: '有潜力的想法 (T5)', descEn: 'Good idea that could go deeper (positive)', descZh: '有潜力但可进一步深化（正面触发）' },
  { id: 'unclear', labelEn: 'Unclear (T6)', labelZh: '表意不清 (T6)', descEn: 'Meaning unclear or genuine question', descZh: '含义不清或存在真实疑问' },
];

export const TriggerSettingsPanel: React.FC<{ lang: Language; courseId: string; courses?: Course[] }> = ({ lang, courseId: initialCourseId, courses = [] }) => {
  const [activeCourseId, setActiveCourseId] = useState(initialCourseId);
  const courseId = activeCourseId || initialCourseId;
  const [settings, setSettings] = useState<TriggerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 保存结果要让教师看到。以前失败被吞掉，界面照样闪一下「已保存」
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 触发设置存在服务商配置行上，一行都没有时保存必然 404
  const [providerConfigured, setProviderConfigured] = useState(true);

  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setSaveState('idle');
    setSaveError(null);
    aiApi.getTriggerSettings(courseId)
      .then(({ settings: s, providerConfigured: configured }) => {
        if (!alive) return;
        setSettings(s);
        setProviderConfigured(configured !== false);
      })
      .catch((err) => { if (alive) setLoadError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [courseId]);

  const save = async (patch: Partial<TriggerSettings>) => {
    if (!courseId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { settings: updated } = await aiApi.updateTriggerSettings(courseId, patch);
      setSettings(updated);
      setProviderConfigured(true);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      if (err instanceof ApiClientError && err.status === 404) {
        setProviderConfigured(false);
        setSaveError(lang === 'zh'
          ? '没有保存：这门课还没有配置 AI 服务商。请先在上方「AI 集成设置」里为这门课添加一个。'
          : 'Not saved: this course has no AI provider yet. Add one for this course in "AI Integration Settings" above first.');
      } else {
        setSaveError(`${lang === 'zh' ? '没有保存：' : 'Not saved: '}${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const lbl = lang === 'zh' ? {
    title: 'AI 触发设置',
    desc: '控制学生写笔记时 AI 自动反馈的行为。',
    autoFeedback: '自动反馈（编辑时）',
    viewTopics: '画布顶上滚动显示讨论主题',
    viewTopicsHint: '问题后面滚动显示这个视图在讨论哪几个主题，由 AI 按笔记总结，笔记有变化时最快 3 分钟更新一次。实验的对照组看不到。',
    enabledTriggers: '启用的触发类型',
    cooldown: '冷却时间（秒）',
    sensitivity: '灵敏度',
    sensitivityOptions: { conservative: '保守', balanced: '平衡', aggressive: '积极' } as Record<string, string>,
    customContext: '课程上下文提示',
    customContextHint: '可选：为 AI 提供课程背景（如"本课程讨论计算思维"），帮助 AI 更好理解学生笔记。',
    saved: '已保存',
    noCourse: '请先创建课程。',
    responseLang: 'AI 响应语言',
    responseLangOptions: { auto: '自动', zh: '中文', en: 'English' } as Record<string, string>,
    responseLangHint: '自动：跟学生笔记用的语言。选了中文或 English，反馈和随反馈给出的话头都用这种语言。',
    maxLength: '最大反馈字数',
    saving: '保存中…',
    loadFailed: '触发设置没有加载成功：',
    noProvider: '这门课还没有配置 AI 服务商：AI 反馈不会运行，这里的设置也保存不了。请先在上方「AI 集成设置」里为这门课添加一个服务商。',
  } : {
    title: 'AI Trigger Settings',
    desc: 'Control how the AI gives automatic feedback while students write.',
    autoFeedback: 'Auto-feedback (while editing)',
    viewTopics: 'Rolling discussion topics above the canvas',
    viewTopicsHint: 'After the question, the topics being discussed in the view roll past, summarised by the AI from the notes and refreshed at most every 3 minutes as notes change. The control group does not see them.',
    enabledTriggers: 'Enabled trigger types',
    cooldown: 'Cooldown (seconds)',
    sensitivity: 'Sensitivity',
    sensitivityOptions: { conservative: 'Conservative', balanced: 'Balanced', aggressive: 'Aggressive' } as Record<string, string>,
    customContext: 'Course context hint',
    customContextHint: 'Optional: provide course context for AI (e.g. "This course discusses computational thinking").',
    saved: 'Saved',
    noCourse: 'Please create a course first.',
    responseLang: 'AI Response Language',
    responseLangOptions: { auto: 'Auto-detect', zh: '中文', en: 'English' } as Record<string, string>,
    responseLangHint: 'Auto-detect follows the language of the student\'s note. With 中文 or English, the feedback and the sentence starter that comes with it use that language.',
    maxLength: 'Max Feedback Length',
    saving: 'Saving…',
    loadFailed: 'Trigger settings failed to load: ',
    noProvider: 'This course has no AI provider yet: AI feedback will not run, and these settings cannot be saved. Add a provider for this course in "AI Integration Settings" above first.',
  };

  if (!courseId) return <p className="text-sm text-stone-500 dark:text-stone-400">{lbl.noCourse}</p>;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-5">
      {courses.length > 1 && (
        <select
          value={courseId}
          onChange={(e) => setActiveCourseId(e.target.value)}
          className="mb-4 w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-800 dark:text-gray-200"
        >
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      )}
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{lbl.title}</h3>
      <p className="mb-5 text-xs text-gray-500 dark:text-gray-400">{lbl.desc}</p>

      {!loading && !loadError && !providerConfigured && (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          {lbl.noProvider}
        </p>
      )}

      {loadError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {lbl.loadFailed}{loadError}
        </p>
      ) : loading || !settings ? (
        <div className="flex items-center gap-2 text-sm text-stone-400"><RefreshCw size={14} className="animate-spin"/> Loading…</div>
      ) : (
        <div className="space-y-5">
          {/* Toggle: auto-feedback */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.autoFeedback}</span>
            <button
              onClick={() => save({ auto_feedback_enabled: !settings.auto_feedback_enabled })}
              className="text-stone-600 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
            >
              {settings.auto_feedback_enabled ? <ToggleRight size={28} className="text-emerald-500"/> : <ToggleLeft size={28}/>}
            </button>
          </div>

          {/* Toggle: rolling discussion topics above the canvas */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.viewTopics}</span>
              <p className="mt-0.5 text-xs leading-relaxed text-stone-500 dark:text-stone-400">{lbl.viewTopicsHint}</p>
            </div>
            <button
              onClick={() => save({ view_topics_enabled: settings.view_topics_enabled === false })}
              aria-pressed={settings.view_topics_enabled !== false}
              aria-label={lbl.viewTopics}
              className="shrink-0 text-stone-600 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
            >
              {settings.view_topics_enabled !== false ? <ToggleRight size={28} className="text-emerald-500"/> : <ToggleLeft size={28}/>}
            </button>
          </div>

          {/* Enabled trigger types */}
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.enabledTriggers}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TRIGGER_TYPE_META.map(t => {
                const enabled = settings.enabled_triggers.includes(t.id);
                return (
                  <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 p-2.5 transition-colors hover:bg-stone-50 dark:border-stone-600 dark:hover:bg-stone-700/50">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => {
                        const next = enabled
                          ? settings.enabled_triggers.filter(x => x !== t.id)
                          : [...settings.enabled_triggers, t.id];
                        save({ enabled_triggers: next });
                      }}
                      className="mt-0.5 accent-[#3457D5]"
                    />
                    <div>
                      <div className="text-sm font-medium text-stone-800 dark:text-stone-200">{lang === 'zh' ? t.labelZh : t.labelEn}</div>
                      <div className="text-xs text-stone-500 dark:text-stone-400">{lang === 'zh' ? t.descZh : t.descEn}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Sensitivity */}
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.sensitivity}</p>
            <div className="flex gap-2">
              {(['conservative', 'balanced', 'aggressive'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => save({ sensitivity: s })}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    settings.sensitivity === s
                      ? 'border-[#3457D5] bg-[#3457D5]/10 text-[#3457D5] dark:border-[#8EA4FF] dark:bg-[#8EA4FF]/10 dark:text-[#8EA4FF]'
                      : 'border-stone-200 text-stone-600 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-400 dark:hover:bg-stone-700'
                  }`}
                >
                  {lbl.sensitivityOptions[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Cooldown */}
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.cooldown}</p>
            <input
              type="range"
              min={30} max={600} step={30}
              value={settings.cooldown_seconds}
              onChange={(e) => setSettings({ ...settings, cooldown_seconds: Number(e.target.value) })}
              onMouseUp={() => save({ cooldown_seconds: settings.cooldown_seconds })}
              onTouchEnd={() => save({ cooldown_seconds: settings.cooldown_seconds })}
              className="w-full accent-[#3457D5]"
            />
            <div className="text-xs text-stone-500 dark:text-stone-400">{settings.cooldown_seconds}s ({Math.round(settings.cooldown_seconds / 60)} min)</div>
          </div>

          {/* Response language */}
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.responseLang}</p>
            <div className="flex gap-2">
              {(['auto', 'zh', 'en'] as const).map(l => (
                <button
                  key={l}
                  onClick={() => save({ response_language: l })}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    settings.response_language === l
                      ? 'border-[#3457D5] bg-[#3457D5]/10 text-[#3457D5] dark:border-[#8EA4FF] dark:bg-[#8EA4FF]/10 dark:text-[#8EA4FF]'
                      : 'border-stone-200 text-stone-600 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-400 dark:hover:bg-stone-700'
                  }`}
                >
                  {lbl.responseLangOptions[l]}
                </button>
              ))}
            </div>
            <p className="mt-2 max-w-[65ch] text-xs leading-relaxed text-stone-400 dark:text-stone-500">{lbl.responseLangHint}</p>
          </div>

          {/* Max feedback length */}
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.maxLength}</p>
            <input
              type="range"
              min={50} max={1000} step={50}
              value={settings.max_feedback_length}
              onChange={(e) => setSettings({ ...settings, max_feedback_length: Number(e.target.value) })}
              onMouseUp={() => save({ max_feedback_length: settings.max_feedback_length })}
              onTouchEnd={() => save({ max_feedback_length: settings.max_feedback_length })}
              className="w-full accent-[#3457D5]"
            />
            <div className="text-xs text-stone-500 dark:text-stone-400">{settings.max_feedback_length} {lang === 'zh' ? '字' : 'chars'}</div>
          </div>

          {/* Custom context */}
          <div>
            <p className="mb-1 text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.customContext}</p>
            <p className="mb-2 text-xs text-stone-400 dark:text-stone-500">{lbl.customContextHint}</p>
            <textarea
              value={settings.custom_context}
              onChange={(e) => setSettings({ ...settings, custom_context: e.target.value })}
              onBlur={() => save({ custom_context: settings.custom_context })}
              rows={2}
              maxLength={500}
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-700 dark:text-stone-200"
            />
          </div>

          <div aria-live="polite" className="min-h-[1.25rem] text-xs leading-relaxed">
            {saving ? (
              <span className="text-stone-400 dark:text-stone-500">{lbl.saving}</span>
            ) : saveState === 'error' && saveError ? (
              <span className="text-rose-600 dark:text-rose-400">{saveError}</span>
            ) : saveState === 'saved' ? (
              <span className="text-emerald-600 dark:text-emerald-400">{lbl.saved}</span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
};

// --- SVG Visualization Components for AI Analysis ---

const FeedbackTrendChart: React.FC<{ data: FeedbackTrendPoint[]; lang: Language }> = ({ data, lang }) => {
  const zh = lang === 'zh';
  if (data.length === 0) return null;

  const W = 600, H = 160, PL = 36, PR = 12, PT = 8, PB = 28;
  const chartW = W - PL - PR, chartH = H - PT - PB;

  const maxTotal = Math.max(...data.map(d => d.total), 1);

  const xStep = data.length > 1 ? chartW / (data.length - 1) : chartW;
  const yScale = (v: number) => PT + chartH - (v / maxTotal) * chartH;

  const totalPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${PL + i * xStep},${yScale(d.total)}`).join(' ');
  const acceptedPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${PL + i * xStep},${yScale(d.accepted)}`).join(' ');
  const areaPath = `${totalPath} L${PL + (data.length - 1) * xStep},${PT + chartH} L${PL},${PT + chartH} Z`;

  const yTicks = [0, Math.round(maxTotal / 2), maxTotal];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
      {/* Grid lines */}
      {yTicks.map(v => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={yScale(v)} y2={yScale(v)} stroke="currentColor" className="text-stone-200 dark:text-stone-800" strokeDasharray="3,3" />
          <text x={PL - 4} y={yScale(v) + 3} textAnchor="end" className="fill-stone-400 dark:fill-stone-600" fontSize="9">{v}</text>
        </g>
      ))}
      {/* Area fill */}
      <path d={areaPath} fill="rgba(0,0,128,0.06)" />
      {/* Total line */}
      <path d={totalPath} fill="none" stroke="#000080" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Accepted line */}
      <path d={acceptedPath} fill="none" stroke="#16a34a" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4,2" />
      {/* Dots on last point */}
      {data.length > 0 && (
        <>
          <circle cx={PL + (data.length - 1) * xStep} cy={yScale(data[data.length - 1].total)} r="3" fill="#000080" />
          <circle cx={PL + (data.length - 1) * xStep} cy={yScale(data[data.length - 1].accepted)} r="3" fill="#16a34a" />
        </>
      )}
      {/* X-axis date labels (show ~5 evenly) */}
      {data.filter((_, i) => i === 0 || i === data.length - 1 || i % Math.max(1, Math.floor(data.length / 4)) === 0).map((d, _, arr) => {
        const i = data.indexOf(d);
        return (
          <text key={d.date} x={PL + i * xStep} y={H - 4} textAnchor="middle" className="fill-stone-400 dark:fill-stone-600" fontSize="8">
            {d.date.slice(5)}
          </text>
        );
      })}
      {/* Legend */}
      <line x1={PL} x2={PL + 16} y1={4} y2={4} stroke="#000080" strokeWidth="1.5" />
      <text x={PL + 20} y={7} className="fill-stone-500 dark:fill-stone-400" fontSize="8">{zh ? '总数' : 'Total'}</text>
      <line x1={PL + 60} x2={PL + 76} y1={4} y2={4} stroke="#16a34a" strokeWidth="1.5" strokeDasharray="4,2" />
      <text x={PL + 80} y={7} className="fill-stone-500 dark:fill-stone-400" fontSize="8">{zh ? '已接受' : 'Accepted'}</text>
    </svg>
  );
};

const TriggerDistributionBars: React.FC<{ distribution: Record<string, number>; lang: Language }> = ({ distribution }) => {
  const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-xs text-stone-400">No data</p>;
  const max = Math.max(...entries.map(e => e[1]), 1);
  const TRIGGER_LABELS: Record<string, string> = {
    undigested_ai: 'T1', no_reasoning: 'T2', no_evidence: 'T3',
    no_connection: 'T4', promising_seed: 'T5', unclear: 'T6',
  };
  const COLORS = ['#000080', '#1e3a8a', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa'];

  return (
    <div className="space-y-2">
      {entries.map(([type, count], i) => (
        <div key={type} className="flex items-center gap-2">
          <span className="w-8 text-right text-[0.6875rem] font-mono font-semibold text-stone-500 dark:text-stone-400">{TRIGGER_LABELS[type] ?? type.slice(0, 4)}</span>
          <div className="flex-1 h-5 rounded bg-stone-100 dark:bg-stone-800 overflow-hidden">
            <div
              className="h-full rounded transition-[width] duration-500"
              style={{ width: `${(count / max) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }}
            />
          </div>
          <span className="w-8 text-right text-xs font-semibold text-stone-700 dark:text-stone-300">{count}</span>
        </div>
      ))}
    </div>
  );
};

const TriggerEffectivenessBars: React.FC<{ effectiveness: TriggerEffectivenessRow[]; lang: Language }> = ({ effectiveness, lang }) => {
  const zh = lang === 'zh';
  if (effectiveness.length === 0) return <p className="text-xs text-stone-400">{zh ? '暂无数据' : 'No data'}</p>;

  return (
    <div className="space-y-3">
      {effectiveness.map(e => (
        <div key={e.triggerType}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-stone-700 dark:text-stone-300">{e.triggerType.replace(/_/g, ' ')}</span>
            <span className="text-xs text-stone-500 dark:text-stone-400">
              {e.acceptanceRate}% · {e.totalCount} {zh ? '次' : 'total'}
              {e.avgResponseTimeSeconds != null && ` · ${Math.round(e.avgResponseTimeSeconds)}s`}
            </span>
          </div>
          <div className="h-4 rounded bg-stone-100 dark:bg-stone-800 overflow-hidden flex">
            <div className="h-full bg-emerald-500/80 transition-[width] duration-500" style={{ width: `${e.acceptanceRate}%` }} />
            <div className="h-full bg-red-400/60 transition-[width] duration-500" style={{ width: `${Math.round((e.ignoredCount / Math.max(e.totalCount, 1)) * 100)}%` }} />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 text-[0.6875rem] text-stone-400 dark:text-stone-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded bg-emerald-500/80" />{zh ? '已接受' : 'Accepted'}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded bg-red-400/60" />{zh ? '已忽略' : 'Ignored'}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded bg-stone-100 dark:bg-stone-800" />{zh ? '其他' : 'Other'}</span>
      </div>
    </div>
  );
};

// --- Teacher AI Feedback Review Dashboard ---
const FeedbackReviewPanel: React.FC<{ lang: Language; courseId: string; courses?: Course[] }> = ({ lang, courseId: initialCourseId, courses = [] }) => {
  const [activeCourseId, setActiveCourseId] = useState(initialCourseId);
  const courseId = activeCourseId || initialCourseId;
  const [stats, setStats] = useState<FeedbackReviewStats | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackReviewItem[]>([]);
  const [effectiveness, setEffectiveness] = useState<TriggerEffectivenessRow[]>([]);
  const [trend, setTrend] = useState<FeedbackTrendPoint[]>([]);
  const [trendDays, setTrendDays] = useState(30);
  const [aiUsage, setAiUsage] = useState<{ today: number; total: number; daily_limit: number; remaining: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    Promise.all([
      dashboardApi.feedbackReview(courseId, 50),
      dashboardApi.triggerEffectiveness(courseId).catch(() => ({ effectiveness: [] })),
      dashboardApi.feedbackTrend(courseId, trendDays).catch(() => ({ trend: [] })),
      aiApi.usage(courseId).catch(() => ({ usage: null })),
    ])
      .then(([review, eff, trendRes, usageRes]) => {
        setStats(review.stats);
        setFeedbacks(review.feedbacks);
        setEffectiveness(eff.effectiveness);
        setTrend(trendRes.trend);
        setAiUsage(usageRes.usage);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [courseId, trendDays]);

  const lbl = lang === 'zh' ? {
    title: 'AI 反馈分析',
    desc: '查看 AI 反馈的使用情况、接受率和学生分析。',
    total: '总反馈数',
    accepted: '已接受',
    ignored: '已忽略',
    pending: '待处理',
    acceptanceRate: '接受率',
    triggerDist: '触发类型分布',
    studentBreakdown: '学生分析',
    recentFeedbacks: '最近反馈',
    noData: '暂无 AI 反馈数据。',
    student: '学生',
    count: '次数',
    rate: '接受率',
  } : {
    title: 'AI Feedback Analytics',
    desc: 'Review AI feedback usage, acceptance rates, and per-student analysis.',
    total: 'Total Feedbacks',
    accepted: 'Accepted',
    ignored: 'Ignored',
    pending: 'Pending',
    acceptanceRate: 'Acceptance Rate',
    triggerDist: 'Trigger Type Distribution',
    studentBreakdown: 'Student Breakdown',
    recentFeedbacks: 'Recent Feedbacks',
    noData: 'No AI feedback data yet.',
    student: 'Student',
    count: 'Count',
    rate: 'Acceptance',
  };

  if (!courseId) return null;

  const statusColor: Record<string, string> = {
    accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
    ignored: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
    inserted: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
    new: 'bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300',
    followed_up: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  };

  return (
    <div className="space-y-5">
      {courses.length > 1 && (
        <select
          value={courseId}
          onChange={(e) => setActiveCourseId(e.target.value)}
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-700 dark:text-stone-200"
        >
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      )}

      <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{lbl.title}</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{lbl.desc}</p>
          </div>
          <div className="flex gap-2">
            <a
              href={aiApi.researchExportUrl(courseId, 'csv')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
            >
              {lang === 'zh' ? '导出 CSV' : 'Export CSV'}
            </a>
            <a
              href={aiApi.researchExportUrl(courseId, 'json')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
            >
              {lang === 'zh' ? '导出 JSON' : 'Export JSON'}
            </a>
          </div>
        </div>

        <div className="mt-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-stone-400"><RefreshCw size={14} className="animate-spin"/> Loading…</div>
        ) : !stats || stats.totalFeedbacks === 0 ? (
          <p className="text-sm text-stone-400">{lbl.noData}</p>
        ) : (
          <div className="space-y-5">
            {/* AI Usage bar */}
            {aiUsage && (
              <div className="flex items-center gap-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <Activity size={13} className="text-[#000080] dark:text-[#93AAFD]" />
                  <span className="font-medium">{lang === 'zh' ? '今日 AI 调用' : 'AI Today'}</span>
                </div>
                <div className="flex-1">
                  <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#000080] dark:bg-[#4169E1] transition-[width] duration-500"
                      style={{ width: `${Math.min(100, (aiUsage.today / aiUsage.daily_limit) * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
                  {aiUsage.today} / {aiUsage.daily_limit}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {lang === 'zh' ? `累计 ${aiUsage.total}` : `Total: ${aiUsage.total}`}
                </span>
              </div>
            )}

            {/* KPI row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: lbl.total, value: stats.totalFeedbacks },
                { label: lbl.accepted, value: stats.acceptedCount },
                { label: lbl.ignored, value: stats.ignoredCount },
                { label: lbl.pending, value: stats.newCount },
                { label: lbl.acceptanceRate, value: `${stats.acceptanceRate}%` },
              ].map((kpi, i) => (
                <div key={i} className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-900">
                  <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{kpi.label}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">{kpi.value}</div>
                </div>
              ))}
            </div>

            {/* Feedback trend chart */}
            {trend.length > 1 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-stone-700 dark:text-stone-300">
                    {lang === 'zh' ? '反馈趋势' : 'Feedback Trend'}
                  </h4>
                  <div className="flex gap-1">
                    {[7, 14, 30, 60].map(d => (
                      <button
                        key={d}
                        onClick={() => setTrendDays(d)}
                        className={`rounded-md px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                          trendDays === d
                            ? 'bg-[#000080]/[0.08] text-[#000080] dark:bg-[#4169E1]/[0.12] dark:text-[#93AAFD]'
                            : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'
                        }`}
                      >
                        {d}{lang === 'zh' ? '天' : 'd'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4 dark:border-stone-700 dark:bg-stone-900/50">
                  <FeedbackTrendChart data={trend} lang={lang} />
                </div>
              </div>
            )}

            {/* Trigger distribution + effectiveness side by side */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.triggerDist}</h4>
                <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4 dark:border-stone-700 dark:bg-stone-900/50">
                  <TriggerDistributionBars distribution={stats.triggerDistribution} lang={lang} />
                </div>
              </div>
              {effectiveness.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">
                    {lang === 'zh' ? '触发类型有效性' : 'Trigger Effectiveness'}
                  </h4>
                  <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4 dark:border-stone-700 dark:bg-stone-900/50">
                    <TriggerEffectivenessBars effectiveness={effectiveness} lang={lang} />
                  </div>
                </div>
              )}
            </div>

            {/* Student breakdown */}
            {stats.studentBreakdown.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.studentBreakdown}</h4>
                <div className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 dark:bg-stone-900">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-stone-600 dark:text-stone-400">{lbl.student}</th>
                        <th className="px-3 py-2 text-right font-medium text-stone-600 dark:text-stone-400">{lbl.count}</th>
                        <th className="px-3 py-2 text-right font-medium text-stone-600 dark:text-stone-400">{lbl.accepted}</th>
                        <th className="px-3 py-2 text-right font-medium text-stone-600 dark:text-stone-400">{lbl.rate}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-700">
                      {stats.studentBreakdown.slice(0, 15).map((s: any) => (
                        <tr key={s.userId} className="hover:bg-stone-50 dark:hover:bg-stone-800">
                          <td className="px-3 py-2 text-stone-800 dark:text-stone-200">{s.studentName}</td>
                          <td className="px-3 py-2 text-right text-stone-600 dark:text-stone-400">{s.total}</td>
                          <td className="px-3 py-2 text-right text-stone-600 dark:text-stone-400">{s.accepted}</td>
                          <td className="px-3 py-2 text-right text-stone-600 dark:text-stone-400">
                            {s.total > 0 ? `${Math.round(s.accepted / s.total * 100)}%` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Effectiveness detail table (collapsed into expandable) */}

            {/* Recent feedbacks */}
            <div>
              <h4 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{lbl.recentFeedbacks}</h4>
              <div className="space-y-2">
                {feedbacks.slice(0, 10).map(fb => (
                  <div key={fb.id} className="rounded-xl border border-stone-100 p-3 dark:border-stone-700">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">{fb.noteTitle}</span>
                      <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[0.6875rem] font-medium text-stone-500 dark:bg-stone-700 dark:text-stone-400">
                        {fb.triggerType.replace(/_/g, ' ')}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${statusColor[fb.status] ?? statusColor.new}`}>
                        {fb.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {fb.studentName} · {new Date(fb.createdAt).toLocaleDateString()}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-stone-600 dark:text-stone-300">{fb.feedbackText}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        </div>
      </section>
    </div>
  );
};

// --- Teacher "Needs Attention" Queue ---
const ATTENTION_TYPE_ICONS: Record<string, { icon: string; colorClass: string }> = {
  stagnant: { icon: 'time-line', colorClass: 'text-amber-500' },
  rejected_feedback: { icon: 'close-circle-line', colorClass: 'text-red-500' },
  repeat_trigger: { icon: 'error-warning-line', colorClass: 'text-orange-500' },
};

const NeedsAttentionPanel: React.FC<{ lang: Language; courseId: string; onNoteClick?: (noteId: string, spaceId: string) => void }> = ({ lang, courseId, onNoteClick }) => {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    dashboardApi.needsAttention(courseId, 20)
      .then(({ items: data }) => setItems(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [courseId]);

  const lbl = lang === 'zh' ? {
    title: '需要关注',
    desc: '停滞的笔记、被忽略的 AI 反馈、反复触发的笔记。',
    empty: '目前没有需要关注的内容。',
    stagnant: '停滞',
    rejected_feedback: '忽略反馈',
    repeat_trigger: '重复触发',
    ago: '前',
  } : {
    title: 'Needs Attention',
    desc: 'Stagnant notes, ignored AI feedback, and repeat triggers.',
    empty: 'Nothing needs attention right now.',
    stagnant: 'Stagnant',
    rejected_feedback: 'Ignored feedback',
    repeat_trigger: 'Repeat trigger',
    ago: 'ago',
  };

  const typeLabel = (t: string) => (lbl as any)[t] ?? t;

  const timeAgo = (ts: string) => {
    const h = Math.round((Date.now() - new Date(ts).getTime()) / (3600 * 1000));
    if (h < 1) return lang === 'zh' ? '<1 小时前' : '<1h ago';
    if (h < 24) return lang === 'zh' ? `${h} 小时前` : `${h}h ago`;
    const d = Math.round(h / 24);
    return lang === 'zh' ? `${d} 天前` : `${d}d ago`;
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-5">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{lbl.title}</h3>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{lbl.desc}</p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-stone-400"><RefreshCw size={14} className="animate-spin"/> Loading…</div>
      ) : items.length === 0 ? (
        <p className="text-sm text-stone-400 dark:text-stone-500">{lbl.empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const meta = ATTENTION_TYPE_ICONS[item.type] ?? ATTENTION_TYPE_ICONS.stagnant;
            return (
              <button
                type="button"
                key={`${item.noteId}-${i}`}
                className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-stone-100 p-3 text-left transition-colors hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-700/50"
                onClick={() => onNoteClick?.(item.noteId, item.spaceId)}
              >
                <RemixIcon name={meta.icon} size={18} className={`mt-0.5 shrink-0 ${meta.colorClass}`}/>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">{item.noteTitle}</span>
                    <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[0.6875rem] font-medium text-stone-500 dark:bg-stone-700 dark:text-stone-400">
                      {typeLabel(item.type)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                    {item.studentName} · {item.detail} · {timeAgo(item.timestamp)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

// --- New Component: Admin AI Stats ---
const AdminAIAnalysis: React.FC<{
  lang: Language;
  stats: AdminAIAnalytics | null;
  loading: boolean;
  error?: string | null;
}> = ({ lang, stats, loading, error }) => {
  const totals = stats?.platformTotals ?? { totalCourses: 0, totalTeachers: 0, totalStudents: 0, totalMessages: 0 };

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {loading && (
        <div className="rounded-[24px] border border-stone-200 bg-white p-4 text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
          <RefreshCw size={16} className="inline mr-2 animate-spin" />
          {lang === 'zh' ? '正在加载 AI 分析数据...' : 'Loading AI analytics...'}
        </div>
      )}
      {error && !loading && (
        <div className="rounded-[24px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: lang === 'zh' ? '总课程' : 'Total Courses', value: totals.totalCourses, icon: BookOpen, iconCls: 'bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200' },
              { label: lang === 'zh' ? '总教师' : 'Total Teachers', value: totals.totalTeachers, icon: GraduationCap, iconCls: 'bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200' },
              { label: lang === 'zh' ? '总学生' : 'Total Students', value: totals.totalStudents, icon: Users, iconCls: 'bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200' },
              { label: lang === 'zh' ? '总对话数' : 'Total Messages', value: totals.totalMessages.toLocaleString(), icon: Cpu, iconCls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-3 rounded-[20px] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.iconCls}`}>
                  <s.icon size={20} />
                </div>
                <div>
                  <div className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{s.value}</div>
                  <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-[24px] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
            <h3 className="mb-4 text-base font-semibold tracking-tight text-stone-950 dark:text-stone-100">{lang === 'zh' ? 'AI 提供商使用分布' : 'AI Provider Usage Distribution'}</h3>
            {stats?.providerUsage?.length ? (
              <div className="space-y-3">
                {stats.providerUsage.map((p) => (
                  <div key={p.providerId}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize font-medium text-stone-700 dark:text-stone-300">{p.providerId}</span>
                      <span className="text-stone-500 dark:text-stone-400">{p.count} msgs ({p.percentage}%)</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-900">
                      <div className="h-2.5 rounded-full bg-stone-900 dark:bg-stone-100" style={{ width: `${Math.min(100, Math.max(0, p.percentage))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-stone-500 dark:text-stone-400">
                {lang === 'zh' ? '暂无可用 AI 使用数据。' : 'No AI usage data available yet.'}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-[24px] border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
            <div className="border-b border-stone-200 px-4 py-3 font-semibold text-stone-950 dark:border-stone-800 dark:text-stone-100">
              {lang === 'zh' ? '课程 AI 活跃度' : 'Course AI Activity'}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[760px]">
                <thead className="bg-stone-50 text-xs uppercase text-stone-500 dark:bg-stone-900/80 dark:text-stone-400">
                  <tr>
                    <th className="px-4 py-3">{lang === 'zh' ? '课程' : 'Course'}</th>
                    <th className="px-4 py-3">{lang === 'zh' ? '教师' : 'Teacher'}</th>
                    <th className="px-4 py-3">{lang === 'zh' ? '对话数' : 'Messages'}</th>
                    <th className="px-4 py-3">{lang === 'zh' ? '活跃 AI' : 'Active AIs'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
                  {stats?.courseUsage?.length ? (
                    stats.courseUsage.map((c) => (
                      <tr key={c.courseId} className="hover:bg-stone-50 dark:hover:bg-stone-900/70">
                        <td className="px-4 py-3 font-medium text-stone-950 dark:text-stone-100">{c.courseName}</td>
                        <td className="px-4 py-3 text-stone-600 dark:text-stone-400">{c.teacherName}</td>
                        <td className="px-4 py-3 font-semibold text-stone-900 dark:text-stone-100">{c.messageCount}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {c.activeProviders.map((p) => (
                              <span key={p} className="rounded-full border border-stone-200 bg-stone-100 px-2.5 py-1 text-[0.6875rem] uppercase tracking-[0.16em] text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                                {p}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-6 py-8 text-stone-500 dark:text-stone-400" colSpan={4}>
                        {lang === 'zh' ? '暂无按课程聚合的 AI 数据（需课程空间内产生 AI 使用记录）。' : 'No course-level AI records yet (AI usage must occur inside course spaces).'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-[24px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertCircle size={20} className="flex-shrink-0" />
            {lang === 'zh'
              ? '管理员无法查看具体对话内容和 API 密钥信息。管理员职责是维护平台稳定性和监控使用数据。'
              : 'Admins cannot view chat content or API keys. Their role focuses on platform stability and usage monitoring.'}
          </div>
        </>
      )}
    </div>
  );
};


/** Map a raw API course to the richer frontend Course type. */
function mapApiCourse(c: ApiCourse & { users?: { name: string }; profiles?: { full_name: string }; instructor_id?: string; verification_code?: string }): Course {
  const instructorName = cleanInstructorName(c.profiles?.full_name) ?? cleanInstructorName(c.users?.name) ?? DEFAULT_INSTRUCTOR_NAME;
  return {
    id: c.id,
    title: c.title,
    instructor: instructorName,
    instructor_id: c.instructor_id ?? (c as unknown as Record<string, string>)['teacher_id'],
    studentCount: 0,
    teacherCount: 1,
    noteCount: 0,
    progress: 0,
    tags: c.tags ?? [],
    coverImage: c.cover_image
      ? `url("${c.cover_image}")`
      : 'url("https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=1000&auto=format&fit=crop")',
    visits: 0,
    createDate: c.created_at?.split('T')[0] ?? '',
    rating: 0,
    verification_code: c.verification_code,
    hasAi: false,
    hasUnreadFeedback: false,
    unreadFeedbackCount: 0,
    lastActivityAt: null,
  };
}

function mapDashboardCourse(c: DashboardCourseSummary): Course {
  return {
    id: c.id,
    title: c.title,
    instructor: cleanInstructorName(c.instructorName) ?? DEFAULT_INSTRUCTOR_NAME,
    instructor_id: c.instructorId,
    studentCount: c.studentCount,
    teacherCount: c.teacherCount,
    noteCount: c.noteCount,
    progress: 0,
    tags: c.tags ?? [],
    coverImage: c.coverImage
      ? `url("${c.coverImage}")`
      : 'url("https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=1000&auto=format&fit=crop")',
    visits: 0,
    createDate: c.createdAt?.split('T')[0] ?? '',
    rating: 0,
    verification_code: c.verificationCode ?? undefined,
    hasAi: c.hasAi,
    hasUnreadFeedback: c.hasUnreadFeedback,
    unreadFeedbackCount: c.unreadFeedbackCount,
    lastActivityAt: c.lastActivityAt,
    viewerStanding: c.viewerStanding,
  };
}

// 教师端四个 AI 入口在 Dashboard 里渲染在同一个位置，PersonalAgentPage 的模式、会话、默认课程都在挂载时定下来。
// 所以按入口给 key：不给的话 React 复用同一个实例，切到学情分析还按备课的模式发、接着备课的会话。
export const TeacherAgentEntry: React.FC<{ tab: string; lang: Language }> = ({ tab, lang }) => {
  const agentConfig: Record<string, { mode: string; module: string; title: string }> = {
    'agent-chat': { mode: '', module: 'chat', title: lang === 'zh' ? 'AI 对话' : 'AI Chat' },
    'agent-lesson': { mode: 'lesson_planner', module: 'lesson', title: lang === 'zh' ? '备课助手' : 'Lesson Prep' },
    'agent-analytics': { mode: 'teaching_analyst', module: 'analytics', title: lang === 'zh' ? '学情分析' : 'Learning Analytics' },
    'agent-assess': { mode: 'teaching_analyst', module: 'assessment', title: lang === 'zh' ? '教学评估' : 'Teaching Assessment' },
    'ai-agent': { mode: '', module: 'chat', title: '' },
  };
  const cfg = agentConfig[tab] ?? agentConfig['ai-agent'];
  return (
    <div className="h-full">
      <Suspense fallback={<div className="flex items-center justify-center py-20"><span className="text-sm text-gray-400">Loading…</span></div>}>
        <PersonalAgentPage
          key={tab}
          embedded
          userRole="teacher"
          initialAgentMode={cfg.mode || undefined}
          agentModule={cfg.module}
          agentTitle={cfg.title || undefined}
        />
      </Suspense>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ currentRole, onRoleChange, onCourseSelect, lang, setLang }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const dashboardRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTabId | 'profile'>('overview');
  // 使用帮助小球里点「打开学生求助页」：从任何页面回到首页，直接落在这一栏
  const location = useLocation();
  useEffect(() => {
    const target = (location.state as { dashboardTab?: string } | null)?.dashboardTab;
    if (target === 'student-help' && (currentRole === 'teacher' || currentRole === 'admin')) setActiveTab('student-help');
  }, [location.state, currentRole]);
  // 概览三张图的真实数据。以前用的是组件里写死的默认值，谁看都一样。
  const { pulse, loading: pulseLoading } = useActivityPulse();
  const [lang3, setLang3] = useState<Lang3>(() => readPublicLanguage());
  useTraditionalChinese(lang3 === 'zh-TW');
  const [courseList, setCourseList] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [newCourseTags, setNewCourseTags] = useState('');
  const [pendingSessionCount, setPendingSessionCount] = useState(0);
  const [newCourseType, setNewCourseType] = useState<CourseType | null>(null);
  const [newCourseHours, setNewCourseHours] = useState('');
  const [newCourseWeeks, setNewCourseWeeks] = useState('16');
  const [newCourseStart, setNewCourseStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [newCourseSlots, setNewCourseSlots] = useState<ScheduleSlot[]>([{ weekday: 1, start: '14:00', minutes: 90 }]);
  const [generatedCode, setGeneratedCode] = useState('');

  /** 课程名出现在多份列表里，改名后逐一同步，避免同一门课两个名字。 */
  const handleCourseRenamed = useCallback((courseId: string, title: string) => {
    setCourseList(prev => prev.map(c => (c.id === courseId ? { ...c, title } : c)));
    setAvailableCourses(prev => prev.map(c => (c.id === courseId ? { ...c, title } : c)));
  }, []);
  // Sidebar is always expanded (no collapse toggle)
  // Student-specific state
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [availableLoading, setAvailableLoading] = useState(true);
  const [availableError, setAvailableError] = useState<string | null>(null);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joiningCourse, setJoiningCourse] = useState<Course | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [leavingCourseId, setLeavingCourseId] = useState<string | null>(null);
  const [studentOverview, setStudentOverview] = useState<StudentDashboardOverview | null>(null);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [teacherOverview, setTeacherOverview] = useState<TeacherDashboardOverview | null>(null);
  const [teacherLoading, setTeacherLoading] = useState(false);
  const [teacherError, setTeacherError] = useState<string | null>(null);
  // Admin: pending teacher approval
  const [pendingTeachers, setPendingTeachers] = useState<AuthUser[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [adminAIStats, setAdminAIStats] = useState<AdminAIAnalytics | null>(null);
  const [adminCourses, setAdminCourses] = useState<AdminCourseSummary[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  // Learning insights (student) & learner profiles (teacher)
  const [learningInsights, setLearningInsights] = useState<MyLearningInsights | null>(null);
  const [learningInsightsLoading, setLearningInsightsLoading] = useState(false);
  const [studentAnalytics, setStudentAnalytics] = useState<StudentAnalytics | null>(null);
  const [studentAnalyticsLoading, setStudentAnalyticsLoading] = useState(false);
  const [learnerProfiles, setLearnerProfiles] = useState<LearnerProfileSummary[]>([]);
  const [learnerProfilesLoading, setLearnerProfilesLoading] = useState(false);
  const [learnerProfilesCourseId, setLearnerProfilesCourseId] = useState<string | null>(null);

  useEffect(() => {
    if (!isUserMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!userMenuRef.current?.contains(target) && !mobileMenuRef.current?.contains(target)) {
        setIsUserMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isUserMenuOpen]);

  // Generate a 4-character course code (letters and numbers)
  const generateCourseCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like 0O, 1I
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  useEffect(() => {
    if (currentRole === 'admin') {
      setCoursesLoading(false);
      setAvailableLoading(false);
      return;
    }

    setCoursesLoading(true);
    if (currentRole !== 'student') setAvailableLoading(false);
  }, [currentRole]);

  useEffect(() => {
    if (showCreateModal) {
      setGeneratedCode(generateCourseCode());
    }
  }, [showCreateModal]);

  useEffect(() => {
    setActiveTab('overview');
  }, [currentRole]);

  // Fetch pending teachers for admin
  useEffect(() => {
    if (currentRole === 'admin') {
      authApi.listUsers('pending')
        .then(({ users }) => setPendingTeachers(users))
        .catch(() => { /* API unreachable */ });
    }
  }, [currentRole]);

  useEffect(() => {
    if (currentRole !== 'admin') return;
    setAdminLoading(true);
    setAdminError(null);

    Promise.all([
      adminApi.overview(),
      adminApi.aiAnalytics(20),
      adminApi.courses(),
    ])
      .then(([overviewRes, aiRes, coursesRes]) => {
        setAdminOverview(overviewRes.overview);
        setAdminAIStats(aiRes.stats);
        setAdminCourses(coursesRes.courses);
      })
      .catch((err) => {
        setAdminError(err instanceof Error ? err.message : 'Failed to load admin dashboard data');
      })
      .finally(() => setAdminLoading(false));
  }, [currentRole]);

  useEffect(() => {
    if (currentRole !== 'student') return;
    setStudentLoading(true);
    setStudentError(null);
    setAvailableError(null);

    dashboardApi.studentOverview()
      .then(({ overview }) => {
        setStudentOverview(overview);
        setCourseList(overview.enrolledCourses.map(mapDashboardCourse));
        setAvailableCourses(overview.availableCourses.map(mapDashboardCourse));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to load student dashboard data';
        setStudentError(message);
        setAvailableError(message);
      })
      .finally(() => {
        setStudentLoading(false);
        setCoursesLoading(false);
        setAvailableLoading(false);
      });
  }, [currentRole]);

  useEffect(() => {
    if (currentRole !== 'teacher') return;
    setTeacherLoading(true);
    setTeacherError(null);

    dashboardApi.teacherOverview()
      .then(({ overview }) => {
        setTeacherOverview(overview);
        setCourseList(overview.courses.map(mapDashboardCourse));
      })
      .catch((error) => {
        setTeacherError(error instanceof Error ? error.message : 'Failed to load teacher dashboard data');
      })
      .finally(() => {
        setTeacherLoading(false);
        setCoursesLoading(false);
      });
  }, [currentRole]);

  // Fetch student learning insights when on feedback tab
  useEffect(() => {
    if (currentRole !== 'student' || activeTab !== 'feedback') return;
    const firstCourse = courseList[0];
    if (!firstCourse) return;
    setLearningInsightsLoading(true);
    dashboardApi.myLearningInsights(firstCourse.id)
      .then(({ insights }) => setLearningInsights(insights))
      .catch(() => setLearningInsights(null))
      .finally(() => setLearningInsightsLoading(false));
  }, [currentRole, activeTab, courseList]);

  // Fetch student analytics when on learning tabs
  useEffect(() => {
    if (currentRole !== 'student') return;
    if (!['note-activity', 'thinking-dev', 'collab-network', 'overview'].includes(activeTab)) return;
    if (studentAnalytics) return;
    setStudentAnalyticsLoading(true);
    dashboardApi.studentAnalytics(30)
      .then(({ analytics }) => setStudentAnalytics(analytics))
      .catch(() => setStudentAnalytics(null))
      .finally(() => setStudentAnalyticsLoading(false));
  }, [currentRole, activeTab]);

  // Fetch teacher learner profiles when viewing a course
  useEffect(() => {
    if (currentRole !== 'teacher') return;
    const targetCourseId = learnerProfilesCourseId || courseList[0]?.id;
    if (!targetCourseId) return;
    setLearnerProfilesLoading(true);
    dashboardApi.learnerProfiles(targetCourseId)
      .then(({ profiles }) => setLearnerProfiles(profiles))
      .catch(() => setLearnerProfiles([]))
      .finally(() => setLearnerProfilesLoading(false));
  }, [currentRole, learnerProfilesCourseId, courseList]);

  const t = TRANSLATIONS[lang];


  const newCourseEstimatedHours = estimateHours(newCourseSlots, Number(newCourseWeeks));

  const handleCreateCourse = async () => {
    if (!newCourseTitle.trim()) return;
    setCreatingCourse(true);
    try {
      const tags = newCourseTags.split(',').map(t => t.trim()).filter(t => t);
      const { course } = await coursesApi.create({
        title: newCourseTitle,
        tags,
        verification_code: generatedCode
      });
      // Add to course list with the code
      const mappedCourse = mapApiCourse({
        ...course,
        verification_code: generatedCode,
        profiles: { full_name: user?.name || DEFAULT_INSTRUCTOR_NAME }
      } as ApiCourse & { users?: { name: string }; verification_code?: string });
      setCourseList(prev => [mappedCourse, ...prev]);

      try {
        await courseSessions.saveSchedule(course.id, {
          course_type: newCourseType,
          credit_hours: Number(newCourseHours),
          total_weeks: Number(newCourseWeeks),
          start_date: newCourseStart,
          schedule: newCourseSlots,
        });
      } catch (scheduleError) {
        // 课已经建好了，排课失败不回滚：教师到课程设置的教学安排里补一次就行
        console.error('Failed to save course schedule:', scheduleError);
        alert(lang === 'zh'
          ? '课程已创建，但教学安排未能保存，请到「课程管理 → 教学安排」中重新填写。'
          : 'Course created, but the schedule was not saved. Please set it in Course management → Schedule.');
      }

      setShowCreateModal(false);
      setNewCourseTitle('');
      setNewCourseTags('');
      setGeneratedCode('');
      setNewCourseType(null);
      setNewCourseHours('');
      setNewCourseWeeks('16');
      setNewCourseSlots([{ weekday: 1, start: '14:00', minutes: 90 }]);
      // Enter the newly created course
      onCourseSelect(course.id, course.title);
    } catch (error) {
      console.error('Failed to create course:', error);
      alert(lang === 'zh' ? '创建课程失败，请重试' : 'Failed to create course, please try again');
    } finally {
      setCreatingCourse(false);
    }
  };

  const handleJoinCourse = async () => {
    if (!joiningCourse) return;

    setJoining(true);
    try {
      await coursesApi.join(joiningCourse.id, joinCode);
      const { overview } = await dashboardApi.studentOverview();
      setCourseList(overview.enrolledCourses.map(mapDashboardCourse));
      setStudentOverview(overview);
      setAvailableCourses(overview.availableCourses.map(mapDashboardCourse));
      setShowJoinModal(false);
      setJoiningCourse(null);
      setJoinCode('');
      alert(lang === 'zh' ? '成功加入课程！' : 'Successfully joined the course!');
    } catch (error) {
      console.error('Failed to join course:', error);
      alert(lang === 'zh' ? '加入课程失败，请检查验证码' : 'Failed to join course. Please check the verification code.');
    } finally {
      setJoining(false);
    }
  };

  const handleLeaveCourse = async (courseId: string, courseTitle: string) => {
    const ok = window.confirm(lang === 'zh'
      ? `确定退出「${courseTitle}」吗？\n\n退出后将无法访问该课程的知识空间。你已发布的笔记会保留在课程中，重新加入即可继续参与。`
      : `Leave "${courseTitle}"?\n\nYou will lose access to this course's knowledge spaces. Notes you already published stay in the course, and you can rejoin later.`);
    if (!ok) return;

    setLeavingCourseId(courseId);
    try {
      await coursesApi.leave(courseId);
      const { overview } = await dashboardApi.studentOverview();
      setCourseList(overview.enrolledCourses.map(mapDashboardCourse));
      setStudentOverview(overview);
      setAvailableCourses(overview.availableCourses.map(mapDashboardCourse));
    } catch (error) {
      console.error('Failed to leave course:', error);
      const message = error instanceof Error ? error.message : '';
      window.alert(lang === 'zh'
        ? `退出课程失败${message ? `：${message}` : '，请稍后重试。'}`
        : `Failed to leave the course${message ? `: ${message}` : '. Please try again.'}`);
    } finally {
      setLeavingCourseId(null);
    }
  };

  const handleApproveTeacher = async (userId: string) => {
    setApprovingId(userId);
    try {
      await authApi.approveTeacher(userId);
      setPendingTeachers(prev => prev.filter(u => u.id !== userId));
      setAdminOverview((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          totals: {
            ...prev.totals,
            pendingTeachers: Math.max(0, prev.totals.pendingTeachers - 1),
            totalTeachers: prev.totals.totalTeachers + 1,
          },
        };
      });
    } catch (error) {
      console.error('Failed to approve teacher:', error);
      alert(lang === 'zh' ? '审批失败，请重试' : 'Approval failed, please try again');
    } finally {
      setApprovingId(null);
    }
  };

  const studentCourses = courseList;
  const discoverCourses = availableCourses;
  const teacherManagedCourses = currentRole === 'teacher' ? courseList : courseList.filter(c => c.instructor_id === user?.id);
  const teacherKpis = buildTeacherOverviewModel(
    (teacherOverview?.courses ?? []).map((course) => ({
      id: course.id,
      title: course.title,
      studentCount: course.studentCount,
      teacherCount: course.teacherCount,
      noteCount: course.noteCount,
      hasAi: course.hasAi,
      unreadFeedbackCount: course.unreadFeedbackCount,
    })),
  );
  const teacherKpiCards = buildTeacherKpiCards(lang, teacherKpis);
  const teacherTabs = getTeacherDashboardTabs(lang);
  const studentTabs = getRoleDashboardTabs('student', lang);
  const adminTabs = getRoleDashboardTabs('admin', lang);
  const teacherHeroMeta = getDashboardHeroMeta('teacher', lang);
  const studentHeroMeta = getDashboardHeroMeta('student', lang);
  const adminHeroMeta = getDashboardHeroMeta('admin', lang);
  const roleTabs = currentRole === 'student' ? studentTabs : currentRole === 'admin' ? adminTabs : teacherTabs;
  const roleHeroMeta = currentRole === 'student' ? studentHeroMeta : currentRole === 'admin' ? adminHeroMeta : teacherHeroMeta;
  const studentModel = buildStudentOverviewModel({
    enrolledCourses: studentCourses.map((course) => ({
      id: course.id,
      title: course.title,
      instructor: course.instructor,
      createDate: course.createDate,
      studentCount: course.studentCount,
      teacherCount: course.teacherCount,
      noteCount: course.noteCount,
      progress: course.progress,
      tags: course.tags,
      verification_code: course.verification_code,
      hasAi: course.hasAi ?? false,
      hasUnreadFeedback: course.hasUnreadFeedback ?? false,
      hasUnreadNotifications: false,
      unreadFeedbackCount: course.unreadFeedbackCount ?? 0,
      lastActivityAt: course.lastActivityAt ?? null,
    })),
    availableCourses: discoverCourses.map((course) => ({
      id: course.id,
      title: course.title,
      instructor: course.instructor,
      tags: course.tags,
      verification_code: course.verification_code,
      hasAi: course.hasAi ?? false,
    })),
    unreadNotifications: studentOverview?.actionCenter.unreadNotificationCount ?? 0,
    unreadTeacherFeedback: studentOverview?.actionCenter.unreadFeedbackCount ?? 0,
    recentTeacherNotifications: studentOverview?.recentTeacherNotifications ?? [],
    availableCoursesError: availableError,
  });
  const enrolledCourseIds = new Set(studentCourses.map((course) => course.id));
  const searchableCourses = currentRole === 'student'
    ? [...studentCourses, ...discoverCourses]
    : courseList;
  const filteredCourses = searchableCourses.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.instructor.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.verification_code ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  useGSAP(() => {
    if (shouldReduceMotion()) return;
    prepareForMotion('.gsap-dashboard-nav, .gsap-dashboard-hero, .gsap-role-tab, .gsap-course-card, .gsap-student-metric, .gsap-student-next');
    const tl = gsap.timeline({ defaults: { ease: 'power3.out', clearProps: 'transform,opacity,visibility,willChange' } });
    tl.from('.gsap-dashboard-nav', { autoAlpha: 0, y: -12, duration: 0.36 })
      .from('.gsap-dashboard-hero', { autoAlpha: 0, y: 18, scale: 0.985, duration: 0.5 }, '-=0.18')
      .from('.gsap-role-tab', { autoAlpha: 0, y: 8, duration: 0.3, stagger: 0.035 }, '-=0.24')
      .from('.gsap-student-metric, .gsap-course-card, .gsap-student-next', { autoAlpha: 0, y: 14, scale: 0.985, duration: 0.36, stagger: 0.035 }, '-=0.16');
  }, {
    scope: dashboardRef,
    dependencies: [
      currentRole,
      activeTab,
      studentCourses.length,
      discoverCourses.length,
      teacherManagedCourses.length,
      adminCourses.length,
      coursesLoading,
      studentLoading,
      teacherLoading,
      adminLoading,
    ],
    revertOnUpdate: true,
  });

  // --- Role Based Content Renderers ---

  /**
   * 个人资料对所有角色都一样，所以放在角色分叉之前。
   * 早先它写在 renderStudentContent 里，教师点开是一片空白 —— 教师走的是另一个分支。
   */
  const renderProfileContent = () => {
    const isStudent = currentRole === 'student';
    const latestCourse = studentModel.highlightCourse;
    const stat = (label: string, value: React.ReactNode) => (
      <div className="rounded-2xl bg-stone-50 p-3 dark:bg-stone-900">
        <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-100">{value}</div>
      </div>
    );

    return (
      <div className="space-y-5 pt-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
              {lang === 'zh' ? '个人资料' : 'Profile'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-300">
              {lang === 'zh'
                ? '设置头像和个人信息。头像会显示在你的每一条笔记上，方便在画布上认出自己的想法。'
                : 'Set your avatar and details. Your avatar appears on every note you write, so you can spot your own ideas on the canvas.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900"
          >
            <ArrowLeft size={16} />
            {lang === 'zh' ? '返回仪表盘' : 'Back to dashboard'}
          </button>
        </div>

        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <ProfileSettingsCard lang={lang} roleLabel={t.roles[currentRole]} />
        </section>

        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
            <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-5">
              <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">
                {lang === 'zh' ? '我的数据' : 'My Stats'}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {isStudent ? (
                  <>
                    {stat(lang === 'zh' ? '已加入课程' : 'Enrolled', studentCourses.length)}
                    {stat(lang === 'zh' ? 'AI 课程' : 'AI Courses', studentOverview?.actionCenter.aiEnabledCourseCount ?? studentCourses.filter(course => course.hasAi).length)}
                    {stat(lang === 'zh' ? '未读反馈' : 'Unread Feedback', studentOverview?.actionCenter.unreadFeedbackCount ?? 0)}
                    {stat(lang === 'zh' ? '可加入课程' : 'Available', studentOverview?.actionCenter.availableCourseCount ?? discoverCourses.length)}
                  </>
                ) : (
                  <>
                    {stat(lang === 'zh' ? '我的课程' : 'My Courses', teacherManagedCourses.length)}
                    {stat(lang === 'zh' ? 'AI 已启用' : 'AI Enabled', teacherManagedCourses.filter(course => course.hasAi).length)}
                  </>
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-5">
              <div className="mb-4">
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">
                  {isStudent ? (lang === 'zh' ? '学习状态' : 'Learning Status') : (lang === 'zh' ? '教学入口' : 'Teaching')}
                </div>
                <h3 className="mt-1 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
                  {isStudent
                    ? (lang === 'zh' ? '下一步学习入口' : 'Next learning action')
                    : (lang === 'zh' ? '继续进入课程' : 'Open a course')}
                </h3>
              </div>

              {(() => {
                const course = isStudent ? latestCourse : teacherManagedCourses[0];
                if (!course) {
                  return (
                    <div className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                      {isStudent
                        ? (lang === 'zh' ? '还没有课程数据。可以先到发现课程加入一个社区。' : 'No course data yet. Discover a course to join a community first.')
                        : (lang === 'zh' ? '还没有课程。到「我的课程」里新建一个。' : 'No courses yet. Create one under My Courses.')}
                    </div>
                  );
                }
                return (
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
                    <h4 className="text-lg font-semibold text-stone-950 dark:text-stone-100">{course.title}</h4>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {course.hasAi && <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 dark:bg-stone-950 dark:text-stone-200">{lang === 'zh' ? 'AI 已启用' : 'AI enabled'}</span>}
                      {isStudent && latestCourse?.hasUnreadFeedback && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{lang === 'zh' ? '有教师反馈' : 'Teacher feedback'}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => onCourseSelect(course.id, course.title)}
                      className="mt-4 min-h-[42px] w-full rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
                    >
                      {lang === 'zh' ? '进入课程' : 'Open course'}
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </section>
      </div>
    );
  };

  const renderStudentContent = () => {
    const feedbackItems = studentOverview?.recentTeacherNotifications ?? [];
    const latestCourse = studentModel.highlightCourse;

    if (activeTab === 'feedback') {
      const scaffoldLabels: Record<string, { zh: string; en: string; color: string }> = {
        high: { zh: '高支持', en: 'High Support', color: 'bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300' },
        medium: { zh: '中等支持', en: 'Medium Support', color: 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' },
        low: { zh: '低支持', en: 'Low Support', color: 'bg-sky-100 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300' },
        minimal: { zh: '自主探索', en: 'Self-directed', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' },
      };
      const triggerLabels: Record<string, string> = {
        T1: lang === 'zh' ? '未消化AI' : 'Undigested AI',
        T2: lang === 'zh' ? '无推理' : 'No Reasoning',
        T3: lang === 'zh' ? '无证据' : 'No Evidence',
        T4: lang === 'zh' ? '无联系' : 'No Connection',
        T5: lang === 'zh' ? '有潜力' : 'Promising Seed',
        T6: lang === 'zh' ? '不明确' : 'Unclear',
      };
      return (
        <div className="space-y-4">
          {/* Learning Journey Section */}
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
                <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 p-2 text-stone-700 dark:text-stone-200"><TrendingUp size={18} /></div>
                {lang === 'zh' ? '我的学习旅程' : 'My Learning Journey'}
              </h2>
            </div>

            {learningInsightsLoading ? (
              <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4 text-sm text-stone-500 dark:text-stone-400">
                <RefreshCw size={16} className="inline mr-2 animate-spin" />
                {lang === 'zh' ? '正在加载学习数据...' : 'Loading learning data...'}
              </div>
            ) : !learningInsights || !learningInsights.hasProfile ? (
              <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6 text-center text-sm text-stone-500 dark:text-stone-400">
                {lang === 'zh' ? '继续与 AI 助手互动，你的学习画像将逐步生成。' : 'Keep interacting with the AI assistant to build your learner profile.'}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Scaffolding level & stats */}
                <div className="rounded-[22px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${scaffoldLabels[learningInsights.scaffoldingLevel]?.color}`}>
                      {lang === 'zh' ? scaffoldLabels[learningInsights.scaffoldingLevel]?.zh : scaffoldLabels[learningInsights.scaffoldingLevel]?.en}
                    </span>
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                      {lang === 'zh' ? 'AI 将根据此水平调整支持策略' : 'AI adjusts support based on this level'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: lang === 'zh' ? '总互动' : 'Interactions', value: learningInsights.interactionCount },
                      { label: lang === 'zh' ? '提出问题' : 'Questions', value: learningInsights.questionsAsked },
                      { label: lang === 'zh' ? '引用证据' : 'Evidence', value: learningInsights.evidenceCited },
                      { label: lang === 'zh' ? '建立联系' : 'Connections', value: learningInsights.connectionsMade },
                    ].map((stat, i) => (
                      <div key={i} className="rounded-xl bg-stone-50 dark:bg-stone-900 p-3">
                        <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{stat.label}</div>
                        <div className="mt-1 text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-100">{stat.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Feedback summary with T1-T6 distribution */}
                {learningInsights.feedbackSummary.total > 0 && (
                  <div className="rounded-[22px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {lang === 'zh' ? 'AI 反馈统计' : 'AI Feedback Stats'}
                      </span>
                      <span className="text-xs text-stone-500 dark:text-stone-400">
                        {lang === 'zh' ? `采纳率 ${learningInsights.feedbackSummary.acceptanceRate}%` : `${learningInsights.feedbackSummary.acceptanceRate}% accepted`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(learningInsights.feedbackSummary.byType).filter(([, v]) => v > 0).map(([type, count]) => (
                        <div key={type} className="flex items-center gap-1.5 rounded-lg bg-stone-50 dark:bg-stone-900 px-2.5 py-1.5">
                          <span className="text-[0.6875rem] font-bold text-stone-600 dark:text-stone-300">{type}</span>
                          <span className="text-[0.6875rem] text-stone-400 dark:text-stone-500">{triggerLabels[type] || type}</span>
                          <span className="ml-1 text-xs font-semibold tabular-nums text-stone-900 dark:text-stone-100">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent reflections */}
                {learningInsights.reflections.length > 0 && (
                  <div className="rounded-[22px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-5">
                    <div className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {lang === 'zh' ? '近期学习反思' : 'Recent Reflections'}
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {learningInsights.reflections.slice(0, 5).map((r) => (
                        <div key={r.id} className="flex items-start gap-2 text-sm">
                          <Sparkles size={12} className="mt-1 shrink-0 text-stone-400" />
                          <div>
                            <span className="text-stone-700 dark:text-stone-300 line-clamp-2">{r.content}</span>
                            <div className="mt-0.5 flex gap-1.5">
                              {r.keywords.slice(0, 3).map((kw) => (
                                <span key={kw} className="text-[0.6875rem] text-stone-400 dark:text-stone-500">#{kw}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Teacher Feedback Section */}
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
                <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 p-2 text-stone-700 dark:text-stone-200"><Bell size={18} /></div>
                {lang === 'zh' ? '教师反馈与提醒' : 'Teacher Feedback & Alerts'}
              </h2>
              <div className="rounded-full bg-amber-50 dark:bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-300">
                {studentOverview?.actionCenter.unreadFeedbackCount ?? 0} {lang === 'zh' ? '条未读反馈' : 'unread feedback'}
              </div>
            </div>

            {studentLoading ? (
              <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4 text-sm text-stone-500 dark:text-stone-400">
                <RefreshCw size={16} className="inline mr-2 animate-spin" />
                {lang === 'zh' ? '正在加载反馈中心...' : 'Loading feedback center...'}
              </div>
            ) : studentError ? (
              <div className="rounded-[24px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">{studentError}</div>
            ) : feedbackItems.length === 0 ? (
              <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6 text-center text-sm text-stone-500 dark:text-stone-400">
                {lang === 'zh' ? '目前还没有新的教师反馈。' : 'There is no new teacher feedback yet.'}
              </div>
            ) : (
              <div className="space-y-3">
                {feedbackItems.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3 rounded-[22px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4">
                    <div>
                      <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</div>
                      <div className="mt-1 text-sm leading-relaxed text-stone-600 dark:text-stone-300">{item.message}</div>
                      <div className="mt-3 text-xs text-stone-400 dark:text-stone-500">{new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(item.createdAt))}</div>
                    </div>
                    {studentModel.highlightCourse && (
                      <button
                        onClick={() => onCourseSelect(studentModel.highlightCourse!.id, studentModel.highlightCourse!.title)}
                        className="min-h-[40px] rounded-xl bg-stone-900 px-3.5 py-2 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
                      >
                        {lang === 'zh' ? '进入课程' : 'Open Course'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      );
    }

    if (activeTab === 'note-activity') {
      return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{lang === 'zh' ? '笔记动态' : 'Note Activity'}</h2>
          <NoteActivityPanel a={studentAnalytics} loading={studentAnalyticsLoading} zh={lang === 'zh'} />
        </div>
      );
    }

    if (activeTab === 'knowledge-graph') {
      return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{lang === 'zh' ? '知识图谱' : 'Knowledge Graph'}</h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {lang === 'zh' ? '基于你发布的笔记与互动关系自动生成，探索你的想法如何连接成体系' : 'Auto-built from your notes and interactions — explore how your ideas connect'}
            </p>
          </div>
          <Suspense fallback={<div className="h-[560px] animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />}>
            <StudentKnowledgeGraphView zh={lang === 'zh'} />
          </Suspense>
        </div>
      );
    }

    if (activeTab === 'promising-ideas') {
      return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{lang === 'zh' ? '潜力想法' : 'Promising Ideas'}</h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {lang === 'zh' ? '发现最值得深耕的想法、想到一起的同伴，以及可以综合升华的机会' : 'Find ideas worth deepening, peers thinking along with you, and rise-above opportunities'}
            </p>
          </div>
          <PromisingIdeasPanel zh={lang === 'zh'} />
        </div>
      );
    }

    if (activeTab === 'thinking-dev') {
      return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{lang === 'zh' ? '思维发展' : 'Thinking Development'}</h2>
          <ThinkingDevPanel a={studentAnalytics} loading={studentAnalyticsLoading} zh={lang === 'zh'} />
        </div>
      );
    }

    if (activeTab === 'collab-network') {
      return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{lang === 'zh' ? '协作网络' : 'Collaboration Network'}</h2>
          <CollabNetworkPanel a={studentAnalytics} loading={studentAnalyticsLoading} zh={lang === 'zh'} />
        </div>
      );
    }

    if (activeTab === 'thinking-trainer') {
      return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 px-3 sm:px-5 lg:px-7 py-4 sm:py-5 pb-14">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{lang === 'zh' ? '思维练习助手' : 'Thinking Coach'}</h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {lang === 'zh' ? '三种游戏化训练，和 AI 陪练一起打磨批判性思维' : 'Three gamified drills to sharpen critical thinking with an AI sparring partner'}
            </p>
          </div>
          <Suspense fallback={<div className="h-[480px] animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />}>
            <ThinkingGym zh={lang === 'zh'} />
          </Suspense>
        </div>
      );
    }

    if (activeTab === 'coding-trainer') {
      return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 px-3 sm:px-5 lg:px-7 py-4 sm:py-5 pb-14">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{lang === 'zh' ? '编程练习助手' : 'Coding Coach'}</h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {lang === 'zh' ? '指挥 AI 写代码、亲手捉虫、自由创作——Python 就在你的浏览器里运行' : 'Direct the AI, hunt bugs, build freely — Python runs right in your browser'}
            </p>
          </div>
          <Suspense fallback={<div className="h-[480px] animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />}>
            <CodingDojo zh={lang === 'zh'} />
          </Suspense>
        </div>
      );
    }

    if (activeTab === 'ai-agent') {
      const modeMap: Record<string, string> = {
        'ai-agent': '',
      };
      const titleMap: Record<string, string> = {
        'ai-agent': '',
      };
      return (
        <div className="h-full">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><span className="text-sm text-gray-400">Loading…</span></div>}>
            <PersonalAgentPage
              embedded
              userRole="student"
              initialAgentMode={modeMap[activeTab] || undefined}
              agentTitle={titleMap[activeTab] || undefined}
            />
          </Suspense>
        </div>
      );
    }

    if (activeTab === 'discover') {
      return (
        <div className="space-y-4">
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
                <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 p-2 text-stone-700 dark:text-stone-200"><Globe size={18} /></div>
                {lang === 'zh' ? '课程发现' : 'Discover Courses'}
              </h2>
              <div className="rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">
                {studentOverview?.actionCenter.availableCourseCount ?? discoverCourses.length} {lang === 'zh' ? '门课程可加入' : 'course(s) available'}
              </div>
            </div>

            {studentLoading || availableLoading ? (
              <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 py-8 text-center text-stone-400 dark:text-stone-500">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-b-2 border-stone-700 dark:border-stone-200"></div>
                <p>{lang === 'zh' ? '加载中…' : 'Loading…'}</p>
              </div>
            ) : availableError ? (
              <div className="rounded-[24px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {lang === 'zh' ? '可加入课程加载失败，请稍后重试。' : 'Failed to load joinable courses. Please try again later.'}
              </div>
            ) : discoverCourses.length === 0 ? (
              <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 py-8 text-center">
                <CheckCircle2 size={40} className="mx-auto mb-3 text-stone-300 dark:text-stone-700" />
                <p className="text-stone-500 dark:text-stone-400">{lang === 'zh' ? '你已经加入了所有可用课程' : 'You\'ve joined all available courses'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {discoverCourses.map(course => (
                  <div
                    key={course.id}
                    className="group overflow-hidden rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/80"
                  >
                    <div className="relative h-28 bg-cover bg-center" style={{ backgroundImage: course.coverImage }}>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                      <div className="absolute bottom-3 left-4 text-white">
                        <h3 className="font-bold text-lg truncate">{course.title}</h3>
                        <p className="text-xs opacity-90 flex items-center gap-1">
                          <User size={12} /> {course.instructor}
                        </p>
                      </div>
                      <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                        {course.verification_code && (
                          <div className="rounded-full bg-stone-950/85 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-stone-50">
                            {lang === 'zh' ? '需要验证码' : 'Code Required'}
                          </div>
                        )}
                        {course.hasAi && (
                          <div className="rounded-full bg-amber-50/95 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-amber-800">
                            {lang === 'zh' ? 'AI 已启用' : 'AI Enabled'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        {course.tags.slice(0, 2).map(tag => (
                          <span key={tag} className="rounded-full border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-stone-600 dark:text-stone-300">
                            #{tag}
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          setJoiningCourse(course);
                          setShowJoinModal(true);
                        }}
                        className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-stone-900 py-2 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
                      >
                        <Plus size={16} />
                        {lang === 'zh' ? '加入课程' : 'Join Course'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {studentError && !studentLoading && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{studentError}</div>
        )}

        {/* Bento Grid: Hero + KPIs + Status */}
        <BentoGrid className="grid-cols-1 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <HeroTile
              lang={lang}
              course={latestCourse}
              onCourseClick={latestCourse ? () => onCourseSelect(latestCourse.id, latestCourse.title) : undefined}
              userName={user?.name}
              role="student"
              courseCount={studentCourses.length}
            />
          </div>
          <StatusTile
            lang={lang}
            title={lang === 'zh' ? '学习状态' : 'Learning Status'}
            items={[
              { label: lang === 'zh' ? '教师反馈' : 'Feedback', value: String(studentModel.actionCards.find(c => c.id === 'feedback')?.value ?? 0), tone: (studentModel.actionCards.find(c => c.id === 'feedback')?.tone === 'attention' ? 'warning' : 'normal') },
              { label: lang === 'zh' ? 'AI 课程' : 'AI Courses', value: String(studentModel.actionCards.find(c => c.id === 'ai-courses')?.value ?? 0), tone: 'accent' },
              { label: lang === 'zh' ? '可发现' : 'Discover', value: String(studentModel.actionCards.find(c => c.id === 'discover')?.value ?? 0), tone: 'normal' },
            ]}
          />
        </BentoGrid>

        {/* KPI Row */}
        <BentoGrid className="grid-cols-2 lg:grid-cols-4">
          {studentModel.actionCards.map((card) => (
            <KpiTile
              key={card.id}
              label={
                card.id === 'feedback' ? (lang === 'zh' ? '教师反馈' : 'Feedback') :
                card.id === 'notifications' ? (lang === 'zh' ? '提醒' : 'Notifications') :
                card.id === 'ai-courses' ? (lang === 'zh' ? 'AI 课程' : 'AI Courses') :
                (lang === 'zh' ? '可加入' : 'Available')
              }
              value={card.value}
              icon={
                card.id === 'feedback' ? 'message-3-line' :
                card.id === 'notifications' ? 'notification-3-line' :
                card.id === 'ai-courses' ? 'cpu-line' :
                'compass-3-line'
              }
              change={card.tone === 'attention' ? (lang === 'zh' ? '需处理' : 'Action needed') : undefined}
              trend={card.tone === 'attention' ? 'up' : 'neutral'}
            />
          ))}
        </BentoGrid>

        {/* Charts: asymmetric 2:1 */}
        <BentoGrid className="grid-cols-1 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <WeeklyActivityChart lang={lang} pulse={pulse} loading={pulseLoading} />
          </div>
          <FeedbackDonutChart lang={lang} pulse={pulse} loading={pulseLoading} />
        </BentoGrid>

        {/* Course Strip */}
        {coursesLoading || studentLoading ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 py-12 text-center text-gray-400 dark:text-gray-500">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-b-2 border-gray-700 dark:border-gray-200"></div>
            <p>{lang === 'zh' ? '加载中…' : 'Loading…'}</p>
          </div>
        ) : studentModel.emptyEnrolledState === 'onboarding' ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 py-16 text-center">
            <BookOpen size={48} className="mx-auto mb-4 text-gray-300 dark:text-gray-700" />
            <p className="mb-2 text-gray-500 dark:text-gray-400">{lang === 'zh' ? '你还没有加入任何课程' : 'You haven\'t joined any courses yet'}</p>
            <button
              onClick={() => setActiveTab('discover')}
              className="mt-4 min-h-[44px] rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-50 transition-all hover:bg-gray-700 hover:scale-[1.02] active:scale-[0.98] dark:bg-gray-100 dark:text-gray-950 dark:hover:bg-gray-300"
            >
              {lang === 'zh' ? '去发现课程' : 'Discover Courses'}
            </button>
          </div>
        ) : (
          <CourseStrip
            courses={studentCourses}
            lang={lang}
            onCourseClick={onCourseSelect}
            title={`${lang === 'zh' ? '我的课程' : 'My Courses'} (${studentCourses.length})`}
            onLeaveCourse={handleLeaveCourse}
            leavingCourseId={leavingCourseId}
          />
        )}
      </div>
    );
  };

  const renderTeacherContent = () => {
    if (activeTab === 'agent-chat' || activeTab === 'agent-lesson' || activeTab === 'agent-analytics' || activeTab === 'agent-assess' || activeTab === 'ai-agent') {
      return <TeacherAgentEntry tab={activeTab} lang={lang} />;
    }
    if (activeTab === 'teaching-log') {
      return <TeachingLogPanel lang={lang} courseId={teacherManagedCourses[0]?.id ?? ''} courses={teacherManagedCourses} />;
    }
    if (activeTab === 'student-help') {
      const teacherCourses = courseList;
      return <StudentHelpDesk lang={lang} courseId={teacherCourses[0]?.id ?? ''} courses={teacherCourses} />;
    }
    if (activeTab === 'ai-settings') {
      const teacherCourses = courseList;
      return (
        <div className="space-y-6">
          <TeacherAISettings lang={lang} courseId={teacherCourses[0]?.id ?? ''} courses={teacherCourses} />
          <AiFeatureModelsPanel lang={lang} courseId={teacherCourses[0]?.id ?? ''} courses={teacherCourses} />
          <TriggerSettingsPanel lang={lang} courseId={teacherCourses[0]?.id ?? ''} courses={teacherCourses} />
        </div>
      );
    }
    if (activeTab === 'ai-analysis') {
      const teacherCourses = courseList;
      return <FeedbackReviewPanel lang={lang} courseId={teacherCourses[0]?.id ?? ''} courses={teacherCourses} />;
    }
    if (activeTab === 'r-coding') {
      const teacherCourses = courseList;
      return (
        <Suspense fallback={<div className="h-[560px] animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />}>
          <QualitativeCoding lang={lang} courses={teacherCourses} />
        </Suspense>
      );
    }
    if (activeTab === 'research' || activeTab.startsWith('r-')) {
      const teacherCourses = courseList;
      const moduleMap: Record<string, string> = {
        'research': 'overview', 'r-overview': 'overview', 'r-temporal': 'temporal',
        'r-sna': 'sna', 'r-lsa': 'lsa', 'r-discourse': 'discourse',
        'r-equity': 'equity', 'r-ai-insights': 'ai_insights', 'r-export': 'export',
      };
      return (
        <Suspense fallback={<div className="h-[560px] animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />}>
          <ResearchZone lang={lang} courses={teacherCourses} activeModule={(moduleMap[activeTab] ?? 'overview') as any} />
        </Suspense>
      );
    }
    const teacherPreviewCourses = teacherManagedCourses.slice(0, 3);

    const coursesPanel = (
      <div className="space-y-5">
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.24em] text-stone-500 dark:text-stone-400">
                {lang === 'zh' ? 'Teaching Library' : 'Teaching Library'}
              </div>
              <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{t.teacher.createdCourses}</h2>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex min-h-[40px] items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
            >
              <Plus size={16} /> {t.teacher.create}
            </button>
          </div>
          <div className="overflow-hidden rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
            <div className="divide-y divide-stone-200 dark:divide-stone-800">
              {coursesLoading || teacherLoading ? (
                <div className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">Loading courses...</div>
              ) : teacherError ? (
                <div className="py-10 text-center text-sm text-red-600">{teacherError}</div>
              ) : teacherManagedCourses.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-stone-500 dark:text-stone-400">No courses created yet. Click "+ Create" to get started.</div>
              ) : teacherManagedCourses.map(course => (
                <div
                  key={course.id}
                  onClick={() => onCourseSelect(course.id, course.title)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCourseSelect(course.id, course.title); }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Enter course: ${course.title}`}
                  className="group flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/80 focus:bg-stone-50 dark:focus:bg-stone-900/80 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-stone-400 md:flex-row md:items-center"
                >
                  <div className="h-14 w-full rounded-xl bg-stone-200 dark:bg-stone-800 overflow-hidden md:h-14 md:w-24 md:flex-shrink-0" aria-hidden="true">
                    <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: course.coverImage }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CourseTitleEditor
                      courseId={course.id}
                      title={course.title}
                      canRename={currentRole === 'admin' || (!!course.instructor_id && course.instructor_id === user?.id)}
                      lang={lang}
                      onRenamed={handleCourseRenamed}
                      titleClassName="text-base font-semibold text-stone-900 dark:text-stone-100"
                    />
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-stone-500 dark:text-stone-400">
                      <span className="flex items-center gap-1.5"><Users size={12} className="text-stone-600 dark:text-stone-300" /> {course.teacherCount ?? 1} {lang === 'zh' ? '教师' : 'teachers'} · {course.studentCount} {lang === 'zh' ? '学生' : 'students'}</span>
                      <span className="flex items-center gap-1.5"><FileText size={12} className="text-amber-700 dark:text-amber-300" /> {course.noteCount}</span>
                      <span className="flex items-center gap-1.5"><Clock size={12} /> {course.createDate}</span>
                      {course.verification_code && (
                        <span className="rounded-full border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 px-2.5 py-1 font-mono font-semibold text-stone-600 dark:text-stone-300">
                          {course.verification_code}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* 课程管理只给创建者和课程管理员（2026-10-06 用户：原来的入口太难找） */}
                    {canManageCourse(course.viewerStanding, currentRole) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/course/${course.id}/settings`); }}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-950 px-3.5 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200 transition-all duration-200 hover:bg-stone-100 dark:hover:bg-stone-900 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-stone-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-stone-950 md:flex-none"
                        aria-label={lang === 'zh' ? `课程管理 ${course.title}` : `Manage ${course.title}`}
                      >
                        <RemixIcon name="settings-3-line" size={14} />
                        {lang === 'zh' ? '课程管理' : 'Manage'}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onCourseSelect(course.id, course.title); }}
                      className="min-h-[44px] flex-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 px-3.5 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200 transition-colors hover:bg-stone-200 dark:hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-stone-950 md:flex-none"
                      aria-label={`Enter ${course.title}`}
                    >
                      {t.teacher.enter}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 p-2 text-stone-700 dark:text-stone-200"><Globe size={17} /></div>
            <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{t.teacher.allPlatformCourses}</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredCourses.map(course => (
              <CourseCard key={course.id} course={course} role="teacher" onClick={() => onCourseSelect(course.id, course.title)} onSettingsClick={canManageCourse(course.viewerStanding, currentRole) ? (c) => navigate(`/course/${c.id}/settings`) : undefined} lang={lang} t={t} />
            ))}
          </div>
        </section>
      </div>
    );

    if (activeTab === 'courses') {
      return coursesPanel;
    }

    return (
      <div className="space-y-6">
        {teacherError && !teacherLoading && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{teacherError}</div>
        )}

        {/* Bento Grid: Hero + Status + Quick Actions */}
        <BentoGrid className="grid-cols-1 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <HeroTile
              lang={lang}
              course={teacherPreviewCourses[0]}
              onCourseClick={teacherPreviewCourses[0] ? () => onCourseSelect(teacherPreviewCourses[0].id, teacherPreviewCourses[0].title) : undefined}
              userName={user?.name}
              role="teacher"
              courseCount={teacherManagedCourses.length}
            />
          </div>
          <StatusTile
            lang={lang}
            title={lang === 'zh' ? '教学状态' : 'Teaching Status'}
            items={teacherKpiCards.slice(0, 3).map(stat => ({
              label: stat.label,
              value: String(stat.value),
              tone: 'normal' as const,
            }))}
          />
        </BentoGrid>

        {/* Quick Actions + KPI Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <QuickAction
            icon="add-line"
            label={t.teacher.create}
            onClick={() => setShowCreateModal(true)}
            variant="primary"
          />
          <QuickAction
            icon="cpu-line"
            label={t.teacher.aiSettings}
            onClick={() => setActiveTab('ai-settings')}
          />
        </div>

        <BentoGrid className="grid-cols-2 lg:grid-cols-4">
          {teacherKpiCards.map((stat) => (
            <KpiTile
              key={stat.id}
              label={stat.label}
              value={stat.value}
              icon={
                stat.id === 'students' ? 'team-line' :
                stat.id === 'notes' ? 'sticky-note-line' :
                stat.id === 'ai-courses' ? 'cpu-line' :
                stat.id === 'feedback' ? 'message-3-line' :
                'bar-chart-box-line'
              }
              trend="up"
            />
          ))}
        </BentoGrid>

        {/* Charts: asymmetric 2:1 */}
        <BentoGrid className="grid-cols-1 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <WeeklyActivityChart lang={lang} pulse={pulse} loading={pulseLoading} />
          </div>
          <EngagementHeatmap lang={lang} pulse={pulse} loading={pulseLoading} />
        </BentoGrid>

        {/* Course Strip */}
        {teacherPreviewCourses.length > 0 ? (
          <CourseStrip
            courses={teacherPreviewCourses}
            lang={lang}
            onCourseClick={onCourseSelect}
            title={lang === 'zh' ? '你最近管理的课程' : 'Active Courses'}
            onViewAll={() => setActiveTab('courses')}
          />
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            {lang === 'zh' ? '还没有课程。先创建第一门课，再配置 AI 和课程设置。' : 'No courses yet. Create your first course, then configure AI and course settings.'}
          </div>
        )}

        {teacherManagedCourses.length > 0 && (
          <NeedsAttentionPanel
            lang={lang}
            courseId={teacherManagedCourses[0].id}
            onNoteClick={(noteId, spaceId) => onCourseSelect(spaceId, '')}
          />
        )}

        {/* Learner Profiles Panel */}
        {teacherManagedCourses.length > 0 && (
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 p-2 text-stone-700 dark:text-stone-200"><BrainCircuit size={17} /></div>
                <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
                  {lang === 'zh' ? '学习者画像' : 'Learner Profiles'}
                </h2>
              </div>
              {courseList.length > 1 && (
                <select
                  value={learnerProfilesCourseId || courseList[0]?.id || ''}
                  onChange={(e) => setLearnerProfilesCourseId(e.target.value)}
                  className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-1.5 text-xs text-stone-700 dark:text-stone-300"
                >
                  {courseList.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              )}
            </div>

            {learnerProfilesLoading ? (
              <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4 text-sm text-stone-500 dark:text-stone-400">
                <RefreshCw size={16} className="inline mr-2 animate-spin" />
                {lang === 'zh' ? '加载学习者数据...' : 'Loading learner data...'}
              </div>
            ) : learnerProfiles.length === 0 ? (
              <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6 text-center text-sm text-stone-500 dark:text-stone-400">
                {lang === 'zh' ? '学生开始与 AI 互动后，学习者画像将自动生成。' : 'Learner profiles will appear once students interact with the AI.'}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
                  <span>{lang === 'zh' ? '学生' : 'Student'}</span>
                  <span>{lang === 'zh' ? '支持水平' : 'Scaffold'}</span>
                  <span>{lang === 'zh' ? '互动' : 'Interactions'}</span>
                  <span>{lang === 'zh' ? '反馈采纳' : 'Acceptance'}</span>
                  <span>{lang === 'zh' ? '最近活动' : 'Last Active'}</span>
                </div>
                <div className="divide-y divide-stone-100 dark:divide-stone-800/60 max-h-72 overflow-y-auto">
                  {learnerProfiles.map((profile) => {
                    const scaffoldColors: Record<string, string> = {
                      high: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
                      medium: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
                      low: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
                      minimal: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
                    };
                    const scaffoldLabel: Record<string, { zh: string; en: string }> = {
                      high: { zh: '高', en: 'High' },
                      medium: { zh: '中', en: 'Med' },
                      low: { zh: '低', en: 'Low' },
                      minimal: { zh: '自主', en: 'Self' },
                    };
                    const acceptRate = profile.feedbackStats.total > 0
                      ? Math.round((profile.feedbackStats.accepted / profile.feedbackStats.total) * 100)
                      : 0;
                    const lastActive = profile.lastInteractionAt
                      ? new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }).format(new Date(profile.lastInteractionAt))
                      : '-';
                    return (
                      <div key={profile.userId} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-2 px-4 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-7 w-7 shrink-0 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-[0.6875rem] font-bold text-stone-600 dark:text-stone-300">
                            {profile.userName?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{profile.userName}</span>
                        </div>
                        <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${scaffoldColors[profile.scaffoldingLevel]}`}>
                          {lang === 'zh' ? scaffoldLabel[profile.scaffoldingLevel]?.zh : scaffoldLabel[profile.scaffoldingLevel]?.en}
                        </span>
                        <span className="text-xs tabular-nums text-stone-700 dark:text-stone-300">{profile.interactionCount}</span>
                        <span className="text-xs tabular-nums text-stone-700 dark:text-stone-300">{acceptRate}%</span>
                        <span className="text-xs text-stone-500 dark:text-stone-400">{lastActive}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    );
  };

  const renderAdminContent = () => {
    const pendingWithPriority = pendingTeachers.map((teacher) => {
      const createdAt = teacher.created_at ? new Date(teacher.created_at).getTime() : Date.now();
      const days = Math.max(0, Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000)));
      const priority = days >= 7 ? 'high' : days >= 3 ? 'medium' : 'normal';
      return { ...teacher, pendingDays: days, priority };
    });

    if (activeTab === 'ai-analysis') {
      return <AdminAIAnalysis lang={lang} stats={adminAIStats} loading={adminLoading} error={adminError} />;
    }

    if (activeTab === 'approvals') {
      return (
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h2 className="mb-4 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 p-2 text-stone-700 dark:text-stone-200"><Bell size={18} /></div>
            {t.admin.pending}
          </h2>
          <div className="space-y-3">
            {pendingWithPriority.length === 0 ? (
              <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6 text-center text-stone-500 dark:text-stone-400">
                {lang === 'zh' ? '暂无待审批教师' : 'No pending teacher approvals'}
              </div>
            ) : (
              pendingWithPriority.map((teacher) => (
                <div key={teacher.id} className="flex items-center justify-between gap-3 rounded-[22px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-200 dark:bg-stone-800 text-sm font-semibold text-stone-700 dark:text-stone-200">
                      {teacher.name?.charAt(0)?.toUpperCase() || 'T'}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{teacher.name}</div>
                      <div className="text-xs text-stone-500 dark:text-stone-400">{teacher.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] ${
                      teacher.priority === 'high'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : teacher.priority === 'medium'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-900 dark:text-stone-300 dark:border-stone-700'
                    }`}>
                      {lang === 'zh'
                        ? `待审批 ${teacher.pendingDays} 天`
                        : `${teacher.pendingDays} day(s) pending`}
                    </span>
                    <button
                      onClick={() => handleApproveTeacher(teacher.id)}
                      disabled={approvingId === teacher.id}
                      className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-stone-900 px-3.5 py-2 text-xs font-semibold text-stone-50 transition-colors hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300"
                    >
                      {approvingId === teacher.id ? (
                        <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      ) : (
                        <CheckCircle size={13} />
                      )}
                      {lang === 'zh' ? '批准' : 'Approve'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      );
    }

    if (activeTab === 'courses') {
      return (
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h2 className="mb-4 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 p-2 text-stone-700 dark:text-stone-200"><List size={18} /></div>
            {t.admin.allCourses}
          </h2>
          <div className="overflow-hidden rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[860px]">
                <thead className="border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/80">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">{t.admin.table.name}</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">{t.admin.table.instructor}</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">{t.admin.table.stats}</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">{t.admin.table.date}</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">{t.admin.table.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                  {adminCourses.map((course) => (
                    <tr key={course.id} className="group transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/70">
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{course.title}</div>
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          {course.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="rounded-full border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-stone-600 dark:text-stone-300">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-200 dark:bg-stone-800 text-xs font-bold text-stone-700 dark:text-stone-200">
                            {course.instructor_name.charAt(0)}
                          </div>
                          <div className="text-sm font-medium text-stone-700 dark:text-stone-300">{course.instructor_name}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-xs font-medium text-stone-500 dark:text-stone-400"><Users size={12} className="text-stone-400 dark:text-stone-500" /> {course.teacher_count ?? 1} {lang === 'zh' ? '教师' : 'teachers'} · {course.student_count} {lang === 'zh' ? '学生' : 'students'}</div>
                          <div className="flex items-center gap-2 text-xs font-medium text-stone-500 dark:text-stone-400"><CheckCircle size={12} className="text-amber-600 dark:text-amber-300" /> {course.note_count} {lang === 'zh' ? '笔记' : 'notes'}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-stone-500 dark:text-stone-400">
                        {course.created_at?.split('T')[0] ?? '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 opacity-70 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => onCourseSelect(course.id, course.title)} className="min-h-[36px] rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-stone-200 transition-colors hover:bg-stone-200 dark:hover:bg-stone-800">
                            {t.admin.actions.enter}
                          </button>
                          <button onClick={() => navigate(`/course/${course.id}/settings`)} className="min-h-[36px] rounded-xl bg-stone-900 px-3 py-1.5 text-xs font-semibold text-stone-50 transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-300">
                            {t.admin.actions.manage}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      );
    }

    const overviewCards = adminOverview
      ? [
          { label: t.admin.statLabels.courses, value: adminOverview.totals.totalCourses, change: `+${adminOverview.deltas30d.courses} / 30d`, icon: BookOpen, iconClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200', badgeClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-300' },
          { label: t.admin.statLabels.teachers, value: adminOverview.totals.totalTeachers, change: `+${adminOverview.deltas30d.teachers} / 30d`, icon: GraduationCap, iconClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200', badgeClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-300' },
          { label: t.admin.statLabels.students, value: adminOverview.totals.totalStudents, change: `+${adminOverview.deltas30d.students} / 30d`, icon: Users, iconClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200', badgeClass: 'bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-300' },
          { label: t.admin.statLabels.pending, value: adminOverview.totals.pendingTeachers, change: adminOverview.totals.pendingTeachers > 0 ? (lang === 'zh' ? '需处理' : 'Needs action') : (lang === 'zh' ? '无待办' : 'All clear'), icon: AlertCircle, iconClass: 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400', badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
        ]
      : [];

    return (
      <div className="space-y-5">
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h2 className="mb-4 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 p-2 text-stone-700 dark:text-stone-200"><Activity size={18} /></div>
            {t.admin.overview}
          </h2>

          {adminLoading && (
            <div className="rounded-[24px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4 text-sm text-stone-500 dark:text-stone-400">
              <RefreshCw size={16} className="inline mr-2 animate-spin" />
              {lang === 'zh' ? '正在加载管理员数据...' : 'Loading admin data...'}
            </div>
          )}
          {adminError && !adminLoading && (
            <div className="rounded-[24px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">{adminError}</div>
          )}

          {!adminLoading && !adminError && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {overviewCards.map((stat) => (
                  <div key={stat.label} className="rounded-[20px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4">
                    <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${stat.iconClass}`}>
                      <stat.icon size={18} />
                    </div>
                    <div className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">{stat.label}</div>
                    <div className="mb-2 text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{stat.value}</div>
                    <div className={`inline-block rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] ${stat.badgeClass}`}>
                      {stat.change}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <button onClick={() => setActiveTab('approvals')} className="min-h-[40px] rounded-[20px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-3.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-900">
                  <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{lang === 'zh' ? '教师审批队列' : 'Teacher Approval Queue'}</div>
                  <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {pendingTeachers.length} {lang === 'zh' ? '项待处理' : 'item(s) pending'}
                  </div>
                </button>
                <button onClick={() => setActiveTab('ai-analysis')} className="min-h-[40px] rounded-[20px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-3.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-900">
                  <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{lang === 'zh' ? 'AI 使用分析' : 'AI Usage Analytics'}</div>
                  <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {adminOverview?.activity.aiMessages24h ?? 0} {lang === 'zh' ? '条 / 24h' : 'messages / 24h'}
                  </div>
                </button>
                <button onClick={() => setActiveTab('courses')} className="min-h-[40px] rounded-[20px] border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-3.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-900">
                  <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{lang === 'zh' ? '课程治理面板' : 'Course Governance'}</div>
                  <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {adminCourses.length} {lang === 'zh' ? '门课程可管理' : 'course(s)'}
                  </div>
                </button>
              </div>
            </>
          )}
        </section>
        <LoginLogPanel lang={lang} />
      </div>
    );
  };

  // --- Main Render ---
  return (
    <div ref={dashboardRef} className="h-screen w-full font-sans flex bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200">
      {/* Sidebar Navigation — hidden on mobile */}
      <div className="hidden sm:block">
        <DashboardSidebar
          role={currentRole}
          lang={lang}
          activeTab={activeTab}
          onTabChange={(tab) => setActiveTab(tab as typeof activeTab)}
          onLogout={logout}
          onLangChange={v => { setLang3(v); setLang(v === 'en' ? 'en' : 'zh'); }}
          userName={user?.name}
          userAvatar={user?.avatar}
          pendingSessions={pendingSessionCount}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header — visible only on small screens */}
        <header className="sm:hidden safe-area-top sticky top-0 z-50 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div className="h-12 flex items-center justify-between px-4">
            <div ref={mobileMenuRef} className="relative flex items-center gap-2.5">
              <button
                onClick={() => setIsUserMenuOpen(prev => !prev)}
                className="flex items-center gap-2.5 active:opacity-70"
              >
                <UserAvatar name={user?.name} avatar={user?.avatar} size={28} />
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">HAKCC</span>
                <ChevronDown size={12} className="text-gray-400" />
              </button>
              {isUserMenuOpen && (
                <div className="absolute top-full left-0 mt-2 w-52 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-lg z-50 overflow-hidden">
                  <div className="p-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">{user?.name ?? ''}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.roles[currentRole]}</div>
                  </div>
                  <div className="p-1">
                    <button
                      onClick={() => { setActiveTab('profile'); setIsUserMenuOpen(false); }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 rounded-lg flex items-center gap-2"
                    >
                      <RemixIcon name="user-3-line" size={15} className="text-gray-400" /> {t.nav.profile}
                    </button>
                    <LangSwitcher2 value={lang as 'zh' | 'en'} onChange={v => { setLang(v as Language); setIsUserMenuOpen(false); }} />
                    <div className="h-px my-1 mx-2 bg-gray-100 dark:bg-gray-800" />
                    <button
                      onClick={() => { setIsUserMenuOpen(false); logout(); }}
                      className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg flex items-center gap-2"
                    >
                      <RemixIcon name="logout-box-r-line" size={15} /> {t.nav.logout}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <NotificationBell
                lang={lang === 'zh' ? 'zh' : 'en'}
                placement="header"
                buttonClassName="h-9 w-9"
                onOpenFeedback={currentRole === 'student' ? () => setActiveTab('feedback') : undefined}
              />
            </div>
          </div>
          {/* Mobile horizontal tab strip */}
          <div className="flex gap-1 px-3 pb-2 overflow-x-auto scrollbar-hide">
            {roleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[#000080] text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {/* Desktop Top Bar — removed; controls moved to sidebar */}

        {/* Main Content Area */}
        <main className={`gsap-dashboard-main flex-1 overflow-y-auto ${activeTab === 'ai-agent' || activeTab.startsWith('agent-') || activeTab === 'thinking-trainer' || activeTab === 'coding-trainer' || activeTab === 'manual' || activeTab === 'philosophy' ? '' : 'px-3 sm:px-5 lg:px-7 py-4 sm:py-5 pb-14'}`}>
          {/* Top greeting bar on overview */}
          {activeTab === 'overview' && (
            <DashboardTopBar
              lang={lang}
              userName={user?.name}
              role={currentRole}
              courseCount={courseList.length}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchResults={searchQuery.length > 1 ? filteredCourses.slice(0, 4).map(c => ({ id: c.id, title: c.title })) : undefined}
              onSearchSelect={(id, title) => {
                if (currentRole === 'student' && !enrolledCourseIds.has(id)) {
                  const course = discoverCourses.find(c => c.id === id);
                  if (course) { setJoiningCourse(course); setShowJoinModal(true); }
                  return;
                }
                onCourseSelect(id, title);
              }}
            />
          )}

          {/* 手册三种角色共用一份（教师多一节），所以在角色分叉之前处理 ——
              放进 renderTeacherContent 里的话，学生点进来是一片空白。 */}
          {activeTab === 'manual' ? (
            <UserManual lang={lang === 'zh' ? 'zh' : 'en'} role={currentRole as 'student' | 'teacher' | 'admin'} />
          ) : activeTab === 'philosophy' ? (
            <PlatformPhilosophy lang={lang === 'zh' ? 'zh' : 'en'} />
          ) : activeTab === 'platform-feedback' ? (
            <PlatformFeedbackPanel
              lang={lang}
              role={currentRole as 'student' | 'teacher' | 'admin'}
              // 只在他确实只有一门课时才记课程。有好几门却按第一门记，导出的数据是错的。
              courseId={courseList.length === 1 ? courseList[0].id : null}
            />
          ) : activeTab === 'profile' ? (
            renderProfileContent()
          ) : (
            <>
              {currentRole === 'student' && renderStudentContent()}
              {currentRole === 'teacher' && renderTeacherContent()}
              {currentRole === 'admin' && renderAdminContent()}
            </>
          )}
        </main>
      </div>

      {/* Create Course Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="relative flex max-h-[90dvh] w-full max-w-xl flex-col p-6 animate-in zoom-in-95 duration-200 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-xl">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X size={20} />
            </button>

            <h2 className="mb-6 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {lang === 'zh' ? '创建新课程' : 'Create New Course'}
            </h2>

            <div className="-mr-2 space-y-4 overflow-y-auto pr-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {lang === 'zh' ? '课程标题' : 'Course Title'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newCourseTitle}
                  onChange={(e) => setNewCourseTitle(e.target.value)}
                  placeholder={lang === 'zh' ? '例如：知识建构理论与实践…' : 'e.g., Knowledge Building Theory and Practice…'}
                  className="w-full px-4 py-2.5 outline-none transition-[box-shadow,border-color] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-700"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {lang === 'zh' ? '课程码（学生加入课程时使用）' : 'Course Code (for students to join)'}
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 px-4 py-2.5 font-mono text-lg font-bold tracking-wider rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                    {generatedCode}
                  </div>
                  <button
                    type="button"
                    onClick={() => setGeneratedCode(generateCourseCode())}
                    className="px-3 py-2 transition-colors rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-600 dark:text-gray-300"
                    title={lang === 'zh' ? '重新生成' : 'Regenerate'}
                    aria-label={lang === 'zh' ? '重新生成课程码' : 'Regenerate course code'}
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {lang === 'zh' ? '4位数字和字母组合，用于学生加入课程' : '4-character code for students to join the course'}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {lang === 'zh' ? '标签（可选，用逗号分隔）' : 'Tags (optional, comma separated)'}
                </label>
                <input
                  type="text"
                  value={newCourseTags}
                  onChange={(e) => setNewCourseTags(e.target.value)}
                  placeholder={lang === 'zh' ? '例如：知识建构, 协作学习…' : 'e.g., knowledge building, collaborative learning…'}
                  className="w-full px-4 py-2.5 outline-none transition-[box-shadow,border-color] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-700"
                />
              </div>

              <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                <p className="mb-3 text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  {lang === 'zh' ? '教学安排' : 'Teaching Schedule'}
                </p>

                <div className="space-y-4">
                  <div>
                    <label className={labelClass}>{lang === 'zh' ? '课程类型' : 'Course Type'}</label>
                    <div className="flex flex-wrap gap-2">
                      {COURSE_TYPES.map(type => (
                        <button
                          key={type.value}
                          type="button"
                          onClick={() => setNewCourseType(newCourseType === type.value ? null : type.value)}
                          className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-all duration-200 ${
                            newCourseType === type.value
                              ? 'border-[#000080] bg-[#000080]/5 text-[#000080] dark:border-[#93AAFD] dark:bg-[#93AAFD]/10 dark:text-[#93AAFD]'
                              : 'border-stone-200 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900'
                          }`}
                        >
                          {lang === 'zh' ? type.zh : type.en}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className={labelClass}>{lang === 'zh' ? '课时' : 'Hours'} <span className="text-rose-500">*</span></label>
                      <input
                        type="number" min={1} max={500} step={0.5}
                        value={newCourseHours}
                        onChange={(e) => setNewCourseHours(e.target.value)}
                        placeholder={newCourseEstimatedHours > 0 ? String(newCourseEstimatedHours) : ''}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>{lang === 'zh' ? '持续周数' : 'Weeks'} <span className="text-rose-500">*</span></label>
                      <input
                        type="number" min={1} max={52}
                        value={newCourseWeeks}
                        onChange={(e) => setNewCourseWeeks(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>{lang === 'zh' ? '开课日期' : 'Start Date'} <span className="text-rose-500">*</span></label>
                      <input
                        type="date"
                        value={newCourseStart}
                        onChange={(e) => setNewCourseStart(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  {newCourseEstimatedHours > 0 && (
                    <p className="-mt-2 text-xs text-stone-500 dark:text-stone-400">
                      {lang === 'zh'
                        ? `按下面的时段和 ${newCourseWeeks || 0} 周计算，约 ${newCourseEstimatedHours} 学时`
                        : `≈ ${newCourseEstimatedHours} hours over ${newCourseWeeks || 0} weeks`}
                    </p>
                  )}

                  <div>
                    <label className={labelClass}>{lang === 'zh' ? '每周上课时段' : 'Weekly Time Slots'}</label>
                    <ScheduleSlotsEditor slots={newCourseSlots} onChange={setNewCourseSlots} zh={lang === 'zh'} />
                    <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                      {lang === 'zh'
                        ? '每周到点后系统会提示你确认这次课是否上了，记录进研究数据'
                        : 'You will be prompted to confirm each session afterwards'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={creatingCourse}
                className="flex-1 px-4 py-2.5 font-medium transition-colors disabled:opacity-50 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={handleCreateCourse}
                disabled={creatingCourse || !newCourseTitle.trim() || !(Number(newCourseHours) > 0) || !(Number(newCourseWeeks) > 0) || !newCourseStart}
                className="flex-1 px-4 py-2.5 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 rounded-lg bg-[#000080] hover:bg-[#000080]/90"
              >
                {creatingCourse ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    {lang === 'zh' ? '创建中...' : 'Creating...'}
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    {lang === 'zh' ? '创建课程' : 'Create Course'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 登录后提示教师补记未确认的课次 */}
      {(currentRole === 'teacher' || currentRole === 'admin') && (
        <PendingSessionsPrompt lang={lang} onCountChange={setPendingSessionCount} />
      )}

      {/* Join Course Modal */}
      {showJoinModal && joiningCourse && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
                {lang === 'zh' ? '加入课程' : 'Join Course'}
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {lang === 'zh' ? '正在加入：' : 'Joining:'} <span className="font-semibold text-blue-600">{joiningCourse.title}</span>
              </p>

              {joiningCourse.verification_code ? (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {lang === 'zh' ? '请输入验证码' : 'Enter Verification Code'}
                  </label>
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder={lang === 'zh' ? '例如: AB7X' : 'e.g., AB7X'}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-center font-mono text-lg uppercase dark:bg-slate-700 dark:text-white"
                    maxLength={4}
                    autoFocus
                  />
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {lang === 'zh' ? '此课程无需验证码，点击下方按钮即可加入。' : 'This course doesn\'t require a verification code.'}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowJoinModal(false);
                    setJoiningCourse(null);
                    setJoinCode('');
                  }}
                  className="flex-1 py-3 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button
                  onClick={handleJoinCourse}
                  disabled={joining || (joiningCourse.verification_code && !joinCode.trim())}
                  className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {joining ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      {lang === 'zh' ? '加入中...' : 'Joining...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      {lang === 'zh' ? '确认加入' : 'Join'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
