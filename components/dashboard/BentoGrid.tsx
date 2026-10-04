import React from 'react';
import { type Language } from '../../types';
import RemixIcon from '../RemixIcon';

interface MinimalCourse {
  id: string;
  title: string;
  instructor?: string;
  studentCount: number;
  tags: string[];
  hasAi?: boolean;
  hasUnreadFeedback?: boolean;
  progress?: number;
  coverImage?: string;
}

// --- Bento Tile Container ---
export const BentoGrid: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`grid gap-3 ${className}`}>
    {children}
  </div>
);

// --- Hero Tile (largest, contextual next-step) ---
interface HeroTileProps {
  lang: Language;
  course?: MinimalCourse | null;
  onCourseClick?: () => void;
  userName?: string;
  role: string;
  courseCount: number;
}

export const HeroTile: React.FC<HeroTileProps> = ({ lang, course, onCourseClick, userName, role, courseCount }) => {
  const zh = lang === 'zh';
  const roleLabel = role === 'teacher' ? (zh ? '教师' : 'Teacher')
    : role === 'admin' ? (zh ? '管理员' : 'Admin')
    : (zh ? '学生' : 'Student');

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6 flex flex-col justify-between min-h-[180px] group transition-shadow hover:shadow-md">
      <div>
        <p className="text-[0.75rem] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
          {roleLabel} · {courseCount} {zh ? '门课程' : 'courses'}
        </p>
        <h1 className="text-[1.375rem] font-bold tracking-tight text-gray-900 dark:text-gray-100 leading-snug">
          {zh ? '欢迎回来，' : 'Welcome, '}{userName}
        </h1>
      </div>

      {course ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.6875rem] text-gray-400 dark:text-gray-500 mb-0.5">
              {zh ? '继续' : 'Continue'}
            </p>
            <p className="text-[0.9375rem] font-semibold text-gray-900 dark:text-gray-100 truncate">
              {course.title}
            </p>
          </div>
          <button
            onClick={onCourseClick}
            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-[#000080] dark:bg-[#4169E1] px-4 py-2.5 text-[0.8125rem] font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {zh ? '进入' : 'Open'}
            <RemixIcon name="arrow-right-line" size={14} />
          </button>
        </div>
      ) : (
        <p className="mt-4 text-[0.8125rem] text-gray-500 dark:text-gray-400">
          {zh ? '开始新的知识建构之旅' : 'Start your knowledge building journey'}
        </p>
      )}
    </div>
  );
};

// --- KPI Tile (compact metric) ---
interface KpiTileProps {
  label: string;
  value: number | string;
  icon: string;
  trend?: 'up' | 'down' | 'neutral';
  change?: string;
  onClick?: () => void;
}

export const KpiTile: React.FC<KpiTileProps> = ({ label, value, icon, trend = 'neutral', change, onClick }) => (
  <div
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4 flex flex-col justify-between min-h-[110px] transition-all hover:shadow-md ${onClick ? 'cursor-pointer hover:scale-[1.01] active:scale-[0.99]' : ''}`}
  >
    <div className="flex items-center justify-between">
      <span className="text-[0.75rem] font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <RemixIcon name={icon} size={14} className="text-gray-600 dark:text-gray-400" />
      </div>
    </div>
    <div>
      <div className="text-[1.5rem] font-bold tracking-tight text-gray-900 dark:text-gray-100 leading-none tabular-nums">{value}</div>
      {change && (
        <p className={`text-[0.6875rem] mt-1 ${
          trend === 'up' ? 'text-emerald-600 dark:text-emerald-400' :
          trend === 'down' ? 'text-red-600 dark:text-red-400' :
          'text-gray-400 dark:text-gray-500'
        }`}>
          {trend === 'up' && '↑ '}{trend === 'down' && '↓ '}{change}
        </p>
      )}
    </div>
  </div>
);

// --- Status Tile (AI status / recent activity) ---
interface StatusTileProps {
  lang: Language;
  title: string;
  items: Array<{ label: string; value: string; tone?: 'normal' | 'accent' | 'warning' }>;
}

export const StatusTile: React.FC<StatusTileProps> = ({ title, items }) => (
  <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4 flex flex-col min-h-[110px]">
    <span className="text-[0.75rem] font-medium text-gray-500 dark:text-gray-400 mb-3">{title}</span>
    <div className="flex-1 flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center justify-between">
          <span className="text-[0.8125rem] text-gray-600 dark:text-gray-400 truncate">{item.label}</span>
          <span className={`text-[0.8125rem] font-semibold tabular-nums ${
            item.tone === 'accent' ? 'text-[#000080] dark:text-[#93AAFD]' :
            item.tone === 'warning' ? 'text-amber-600 dark:text-amber-400' :
            'text-gray-900 dark:text-gray-100'
          }`}>{item.value}</span>
        </div>
      ))}
    </div>
  </div>
);

// --- Course Strip (horizontal scroll) ---
interface CourseStripProps {
  courses: MinimalCourse[];
  lang: Language;
  onCourseClick: (id: string, title: string) => void;
  title: string;
  onViewAll?: () => void;
  /** When provided, each card gets a "leave course" action (students only). */
  onLeaveCourse?: (id: string, title: string) => void;
  leavingCourseId?: string | null;
}

export const CourseStrip: React.FC<CourseStripProps> = ({ courses, lang, onCourseClick, title, onViewAll, onLeaveCourse, leavingCourseId }) => {
  const zh = lang === 'zh';
  if (courses.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[0.9375rem] font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-[0.75rem] font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {zh ? '查看全部' : 'View all'} →
          </button>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory scrollbar-hide">
        {courses.map(course => (
          <div
            key={course.id}
            onClick={() => onCourseClick(course.id, course.title)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCourseClick(course.id, course.title); }}
            className="snap-start flex-shrink-0 w-[260px] rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 overflow-hidden cursor-pointer group transition-all hover:shadow-md hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#000080]/30"
          >
            <div
              className="h-[72px] bg-cover bg-center relative"
              style={{ backgroundImage: course.coverImage }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-3 left-3 right-3">
                <h3 className="text-[0.875rem] font-semibold text-white leading-tight line-clamp-1">{course.title}</h3>
              </div>
              {onLeaveCourse && (
                <button
                  onClick={(e) => { e.stopPropagation(); onLeaveCourse(course.id, course.title); }}
                  disabled={leavingCourseId === course.id}
                  title={zh ? '退出课程' : 'Leave course'}
                  aria-label={zh ? `退出课程 ${course.title}` : `Leave course ${course.title}`}
                  className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/35 text-white/80 opacity-0 backdrop-blur-sm transition-all hover:bg-red-500/90 hover:text-white focus:opacity-100 group-hover:opacity-100 disabled:opacity-60"
                >
                  <RemixIcon name={leavingCourseId === course.id ? 'loader-4-line' : 'logout-box-r-line'} size={13} className={leavingCourseId === course.id ? 'animate-spin' : ''} />
                </button>
              )}
            </div>
            <div className="px-3.5 py-3">
              <div className="flex items-center gap-3 text-[0.75rem] text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <RemixIcon name="user-3-line" size={12} />
                  {course.instructor}
                </span>
                {course.studentCount > 0 && (
                  <span className="flex items-center gap-1">
                    <RemixIcon name="team-line" size={12} />
                    {course.studentCount}
                  </span>
                )}
              </div>
              {course.progress !== undefined && course.progress > 0 && (
                <div className="mt-2.5">
                  <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-[#000080] dark:bg-[#4169E1] h-1.5 rounded-full transition-[width] duration-500"
                      style={{ width: `${course.progress}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex gap-1.5 mt-2.5 flex-wrap">
                {course.tags.slice(0, 2).map(tag => (
                  <span key={tag} className="px-2 py-0.5 text-[0.6875rem] rounded-md font-medium bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
                    {tag}
                  </span>
                ))}
                {course.hasAi && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-[#000080]/[0.06] dark:bg-[#4169E1]/[0.12] text-[#000080] dark:text-[#93AAFD] text-[0.6875rem] rounded-md font-medium">
                    <RemixIcon name="cpu-line" size={10} />AI
                  </span>
                )}
                {course.hasUnreadFeedback && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[0.6875rem] rounded-md font-medium">
                    <RemixIcon name="message-3-line" size={10} />
                    {zh ? '反馈' : 'New'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Quick Action Button ---
interface QuickActionProps {
  icon: string;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export const QuickAction: React.FC<QuickActionProps> = ({ icon, label, onClick, variant = 'secondary' }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[0.8125rem] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] ${
      variant === 'primary'
        ? 'bg-[#000080] dark:bg-[#4169E1] text-white'
        : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900'
    }`}
  >
    <RemixIcon name={icon} size={15} />
    {label}
  </button>
);
