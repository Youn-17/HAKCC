/**
 * 课程设置独立页面。
 *
 * 原来是个 max-w-4xl 的弹窗，四个页签挤在一条边上，且整块没有暗色模式。
 * 课程设置是教师会停留十几分钟的地方（排课、传资料、布置任务），
 * 不该被塞进一个随时会被误点关掉的浮层里。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil, Check, Lock } from 'lucide-react';
import RemixIcon from '../RemixIcon';
import '../../styles/courseSettings.css';
import { Language, CourseGoal, CourseMaterial, CourseTask } from '../../types';
import { ApiClientError, courseSettings, courses as coursesApi, type Course, type CourseRole } from '../../services/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { canManageCourse, isCourseStaff } from '../courseStanding';
import CourseGoals from './CourseGoals';
import CourseMaterials from './CourseMaterials';
import CourseTasks from './CourseTasks';
import CourseSchedule from './CourseSchedule';
import CourseAccess from './CourseAccess';
import { courseTypeLabel } from './scheduleShared';

type SettingsTab = 'goals' | 'materials' | 'tasks' | 'schedule' | 'access';

const TABS: { id: SettingsTab; icon: string; zh: string; en: string; descZh: string; descEn: string }[] = [
  { id: 'goals', icon: 'focus-3-line', zh: '学习目标', en: 'Learning Goals', descZh: '目标与优先级', descEn: 'Goals and priorities' },
  { id: 'materials', icon: 'folder-open-line', zh: '课程资料', en: 'Materials', descZh: '阅读材料与参考文献', descEn: 'Readings and references' },
  { id: 'tasks', icon: 'task-line', zh: '学习任务', en: 'Assignments', descZh: '任务发布与提交', descEn: 'Assignments and submissions' },
  { id: 'schedule', icon: 'calendar-schedule-line', zh: '教学安排', en: 'Schedule', descZh: '上课时间与课次记录', descEn: 'Class times and session records' },
  { id: 'access', icon: 'shield-user-line', zh: '协作与权限', en: 'Collaboration', descZh: '教师协作与管理权限', descEn: 'Teachers and permissions' },
];

const isTab = (v: string | null): v is SettingsTab => TABS.some(t => t.id === v);

/** 列表接口失败的原因。403 是「不在这门课里」，后端那句英文对教师没有用。 */
function loadErrorText(reason: unknown, zh: boolean): string {
  if (reason instanceof ApiClientError && reason.status === 403) {
    return zh ? '你不是这门课的成员，看不到这一页。' : 'You are not a member of this course.';
  }
  return reason instanceof Error ? reason.message : String(reason);
}

const isForbidden = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' && r.reason instanceof ApiClientError && r.reason.status === 403;

interface Props {
  lang: Language;
}

const CourseSettingsPage: React.FC<Props> = ({ lang }) => {
  const zh = lang === 'zh';
  const navigate = useNavigate();
  const { courseId = '' } = useParams<{ courseId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const tabParam = searchParams.get('tab');
  const activeTab: SettingsTab = isTab(tabParam) ? tabParam : 'goals';

  const [course, setCourse] = useState<Course | null>(null);
  const [stats, setStats] = useState<{ studentCount: number; teacherCount?: number; spaceCount: number; noteCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<CourseGoal[]>([]);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [tasks, setTasks] = useState<CourseTask[]>([]);
  // 存原始的失败原因，显示时再按语言转成文字（403 要换成中文说明）
  const [loadErrors, setLoadErrors] = useState<Partial<Record<SettingsTab, unknown>>>({});
  // 调用者在这门课里的身份，随目标、任务列表带回。增删改的按钮只给创建者和课程管理员：
  // 平台身份是教师不算数，受邀未设管理员、凭学生验证码入课的教师点下去都是 403。
  const [standing, setStanding] = useState<CourseRole | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const canRename = user?.role === 'admin' || (!!course?.instructor_id && course.instructor_id === user?.id);
  const canManage = !forbidden && isCourseStaff(standing, user?.role ?? 'student');

  // 各页签的列表分开取、分开报错。原来用 Promise.all：任何一个接口失败，
  // 课程名和所有页签一起加载不出来，界面上只剩空白，看不出是哪里坏了。
  const applyLists = useCallback((
    [goalsRes, materialsRes, tasksRes]: PromiseSettledResult<unknown>[],
  ) => {
    const reason = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? r.reason ?? 'Request failed' : undefined);
    if (goalsRes.status === 'fulfilled') {
      const value = goalsRes.value as { goals: CourseGoal[]; viewerStanding?: CourseRole };
      setGoals(value.goals);
      if (value.viewerStanding) setStanding(value.viewerStanding);
    }
    if (materialsRes.status === 'fulfilled') setMaterials((materialsRes.value as { materials: CourseMaterial[] }).materials);
    if (tasksRes.status === 'fulfilled') {
      const value = tasksRes.value as { tasks: CourseTask[]; viewerStanding?: CourseRole };
      setTasks(value.tasks);
      if (value.viewerStanding) setStanding(value.viewerStanding);
    }
    setForbidden([goalsRes, materialsRes, tasksRes].some(isForbidden));
    setLoadErrors({ goals: reason(goalsRes), materials: reason(materialsRes), tasks: reason(tasksRes) });
  }, []);

  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    setLoading(true);
    // 换了一门课：上一门课的身份不能带过来
    setStanding(null);
    setForbidden(false);
    Promise.allSettled([
      coursesApi.get(courseId),
      courseSettings.getStats(courseId),
      courseSettings.listGoals(courseId),
      courseSettings.listMaterials(courseId),
      courseSettings.listTasks(courseId),
    ])
      .then(([courseRes, statsRes, ...lists]) => {
        if (!alive) return;
        if (courseRes.status === 'fulfilled') setCourse(courseRes.value.course);
        else console.error('Failed to load course:', courseRes.reason);
        setStats(statsRes.status === 'fulfilled' ? statsRes.value : null);
        applyLists(lists);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [courseId, applyLists]);

  // 批改之后任务的提交统计会变，只重取任务列表。增删改目标和任务直接用接口返回的那一条更新，不再整页重取
  const refreshTasks = useCallback(async () => {
    try {
      const res = await courseSettings.listTasks(courseId);
      setTasks(res.tasks);
      if (res.viewerStanding) setStanding(res.viewerStanding);
      setLoadErrors(prev => ({ ...prev, tasks: undefined }));
    } catch (error) {
      setLoadErrors(prev => ({ ...prev, tasks: error }));
    }
  }, [courseId]);

  // 资料页解析期间会定时刷新，只取资料列表，不连带另外两个接口
  const refreshMaterials = useCallback(async () => {
    try {
      const { materials: next } = await courseSettings.listMaterials(courseId);
      setMaterials(next);
      setLoadErrors(prev => ({ ...prev, materials: undefined }));
    } catch (error) {
      setLoadErrors(prev => ({ ...prev, materials: error }));
    }
  }, [courseId]);

  const commitTitle = async () => {
    const next = titleDraft.trim();
    if (!next) { setTitleError(zh ? '课程名称不能为空' : 'The course name cannot be empty'); return; }
    if (next === course?.title) { setEditingTitle(false); setTitleError(null); return; }
    setSavingTitle(true);
    setTitleError(null);
    try {
      const { course: updated } = await coursesApi.rename(courseId, next);
      setCourse(prev => (prev ? { ...prev, title: updated.title } : prev));
      setEditingTitle(false);
    } catch (err) {
      setTitleError(err instanceof ApiClientError || err instanceof Error
        ? err.message
        : (zh ? '保存失败，请稍后重试。' : 'Save failed. Please try again.'));
    } finally {
      setSavingTitle(false);
    }
  };

  const counts: Record<SettingsTab, number | null> = useMemo(() => ({
    goals: goals.length,
    materials: materials.length,
    tasks: tasks.length,
    schedule: null,
    access: null,
  }), [goals.length, materials.length, tasks.length]);

  const title = course?.title ?? '';
  const typeLabel = courseTypeLabel(course?.course_type, zh);

  // 只有课程创建者和课程管理员进得来（2026-10-06 用户）。课内的普通成员（包括凭学生验证码入课的教师账号）
  // 和不在课里的人，都只看到这一页，不再是「能看不能改」。课内身份没拿到（接口都出错）时照旧显示，各页签自己报错
  const denied = !loading && (forbidden || (standing !== null && !canManageCourse(standing, user?.role ?? 'student')));
  if (denied) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-5 dark:bg-stone-900">
        <div role="alert" data-course-settings-denied className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center dark:border-stone-800 dark:bg-stone-950">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400">
            <Lock size={20} />
          </div>
          <h1 className="mt-4 text-lg font-bold tracking-tight text-stone-950 dark:text-stone-100">
            {zh ? '没有权限管理这门课' : 'You cannot manage this course'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
            {zh
              ? '课程管理只对课程创建者和课程管理员开放。需要管理权限，请联系这门课的创建者。'
              : 'Course management is open only to the course creator and course managers. Ask the creator of this course for access.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#000080] px-4 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#000080]/90 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[#000080]/40 focus:ring-offset-2"
          >
            <ArrowLeft size={16} />
            {zh ? '返回首页' : 'Back to the dashboard'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="course-settings-page min-h-[100dvh] bg-stone-50 dark:bg-stone-900">
      {/* 顶栏 */}
      <header className="course-settings-header sticky top-0 z-20 border-b border-stone-200 bg-stone-50/85 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/85">
        <div className="course-settings-header-inner mx-auto flex max-w-[1600px] items-center gap-3 px-5 py-3.5 sm:px-8">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-500 transition-all duration-200 hover:bg-stone-100 hover:text-stone-700 active:scale-[0.96] dark:border-stone-700 dark:bg-stone-950 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={zh ? '返回' : 'Back'}
          >
            <ArrowLeft size={17} />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-stone-400 dark:text-stone-500">
              {zh ? '课程管理' : 'Course management'}
            </p>
            {editingTitle ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={titleDraft}
                  maxLength={120}
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void commitTitle();
                    if (e.key === 'Escape') { setEditingTitle(false); setTitleError(null); }
                  }}
                  aria-label={zh ? '修改课程名称' : 'Rename course'}
                  className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-lg font-bold tracking-tight text-stone-900 outline-none transition-[box-shadow,border-color] focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/10 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-[#93AAFD] dark:focus:ring-[#93AAFD]/15"
                />
                <button
                  type="button"
                  onClick={() => void commitTitle()}
                  disabled={savingTitle}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#000080] px-3 py-1.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-50"
                >
                  {savingTitle ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {zh ? '保存' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingTitle(false); setTitleError(null); }}
                  className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  {zh ? '取消' : 'Cancel'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-stone-950 dark:text-stone-100">
                  {loading && !title ? <span className="inline-block h-6 w-48 animate-pulse rounded bg-stone-200 dark:bg-stone-800" /> : title}
                </h1>
                {typeLabel && (
                  <span className="shrink-0 rounded-md bg-stone-200/70 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                    {typeLabel}
                  </span>
                )}
                {course?.verification_code && (
                  <span className="course-settings-code shrink-0 rounded-md border border-stone-200 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-stone-600 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300">
                    <span className="course-settings-code-label">{zh ? '课程码' : 'Code'}</span>{course.verification_code}
                  </span>
                )}
                {!loading && (canRename ? (
                  <button
                    type="button"
                    onClick={() => { setTitleDraft(title); setEditingTitle(true); }}
                    title={zh ? '修改课程名称' : 'Rename course'}
                    aria-label={zh ? '修改课程名称' : 'Rename course'}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  >
                    <Pencil size={15} />
                  </button>
                ) : (
                  <Lock size={13} className="shrink-0 text-stone-300 dark:text-stone-600" aria-label={zh ? '只有创建这门课程的教师可以修改名称' : 'Only the teacher who created this course can rename it'} />
                ))}
              </div>
            )}
            {titleError && <p role="alert" className="mt-1 text-sm text-rose-600 dark:text-rose-400">{titleError}</p>}
          </div>

          {stats && (
            <div className="course-settings-stats hidden shrink-0 items-center gap-5 text-right sm:flex">
              {([
                [zh ? '教师' : 'Teachers', stats.teacherCount ?? '—'],
                [zh ? '学生' : 'Students', stats.studentCount],
                [zh ? '知识空间' : 'Spaces', stats.spaceCount],
                [zh ? '笔记' : 'Notes', stats.noteCount],
              ] as [string, number | string][]).map(([label, value]) => (
                <div key={label}>
                  <p className="text-lg font-semibold leading-tight tracking-tight text-stone-900 dark:text-stone-100">{value}</p>
                  <p className="text-[0.6875rem] text-stone-500 dark:text-stone-400">{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="course-settings-layout mx-auto max-w-[1600px] px-5 py-6 sm:px-8 sm:py-8">
        <div className="course-settings-body flex min-h-[calc(100dvh-9.5rem)] flex-col gap-6 lg:flex-row lg:gap-8">
          {/* 分区导航：窄屏横排，宽屏靠左竖排 */}
          <nav aria-label={zh ? '课程管理分区' : 'Course management sections'} className="course-settings-nav -mx-5 flex shrink-0 gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:w-60 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {TABS.map(tab => {
              const active = activeTab === tab.id;
              const count = counts[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setSearchParams({ tab: tab.id }, { replace: true })}
                  className={`course-settings-nav-item group flex shrink-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200 active:scale-[0.99] lg:w-full ${
                    active
                      ? 'border-[#000080]/20 bg-[#000080]/[0.06] dark:border-[#93AAFD]/25 dark:bg-[#93AAFD]/[0.10]'
                      : 'border-transparent hover:bg-stone-100 dark:hover:bg-stone-800/70'
                  }`}
                >
                  <span className={`course-settings-nav-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                    active
                      ? 'border-[#000080]/20 bg-white text-[#000080] dark:border-[#93AAFD]/25 dark:bg-stone-950 dark:text-[#93AAFD]'
                      : 'border-stone-200 bg-white text-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-400'
                  }`}>
                    <RemixIcon name={tab.icon} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className={`flex items-center gap-1.5 text-sm font-semibold tracking-tight ${
                      active ? 'text-[#000080] dark:text-[#93AAFD]' : 'text-stone-800 dark:text-stone-200'
                    }`}>
                      {zh ? tab.zh : tab.en}
                      {count !== null && count > 0 && (
                        <span className="course-settings-nav-count rounded bg-stone-200/80 px-1.5 text-[0.6875rem] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                          {count}
                        </span>
                      )}
                    </span>
                    <span className="course-settings-nav-description hidden text-xs text-stone-500 dark:text-stone-400 lg:block">
                      {zh ? tab.descZh : tab.descEn}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* 内容区 */}
          <main className="course-settings-main flex min-w-0 flex-1 flex-col">
            <div className="course-settings-content flex flex-1 flex-col rounded-2xl border border-stone-200 bg-white p-6 shadow-sm shadow-stone-200/50 dark:border-stone-800 dark:bg-stone-950 dark:shadow-none sm:p-8">
              {loading ? (
                <div className="space-y-3 py-6">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-900" />
                  ))}
                </div>
              ) : (
                <>
                  {loadErrors[activeTab] !== undefined && (
                    <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-relaxed text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                      {zh ? '这一页的数据没有加载成功：' : 'This page\'s data failed to load: '}{loadErrorText(loadErrors[activeTab], zh)}
                    </p>
                  )}
                  {activeTab === 'goals' && (
                    <CourseGoals courseId={courseId} goals={goals} onGoalsChange={setGoals} canManage={canManage} lang={lang} />
                  )}
                  {activeTab === 'materials' && <CourseMaterials courseId={courseId} materials={materials} onRefresh={refreshMaterials} lang={lang} />}
                  {activeTab === 'tasks' && (
                    <CourseTasks
                      courseId={courseId}
                      tasks={tasks}
                      onTasksChange={setTasks}
                      onRefresh={refreshTasks}
                      canManage={canManage}
                      lang={lang}
                    />
                  )}
                  {activeTab === 'schedule' && <CourseSchedule courseId={courseId} lang={lang} />}
                  {activeTab === 'access' && <CourseAccess courseId={courseId} lang={lang} />}
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default CourseSettingsPage;
