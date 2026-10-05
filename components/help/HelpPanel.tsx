import React, { useEffect, useMemo, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import { courses as coursesApi } from '../../services/apiClient';
import HelpChat from './HelpChat';
import HelpInbox from './HelpInbox';
import type { HelpPageContext } from './helpContext';
import {
  pickCourse,
  readRememberedCourse,
  rememberCourse,
  type HelpLang,
  type HelpSurface,
} from './helpWidgetModel';

/**
 * 使用帮助的对话窗：电脑上是右下角的一个小窗，手机上是几乎占满屏幕的底部抽屉。
 * 收起时不卸载，写了一半的问题和已经拉下来的记录都还在。
 */

export interface HelpPanelProps {
  open: boolean;
  lang: HelpLang;
  compact: boolean;
  /** 地址里带的课程；首页上没有，要从学生加入的课程里挑 */
  routeCourseId: string | null;
  surface: HelpSurface;
  page: HelpPageContext;
  /** 笔记页右下角是「关闭」「贡献」，窗口往上让一截，不把它们盖住 */
  liftAboveFooter: boolean;
  onMinimize: () => void;
  /** 在这门课的窗口里看过了：小球上的「老师回复」提示据此清掉 */
  onSeen: (courseId: string) => void;
  /** 教师、管理员：多一个「学生求助」页签，问 AI 时按含教师端的手册答 */
  staff?: boolean;
  /** 等回复的求助有几条（页签上显示） */
  inboxCount?: number;
  /** 回复了一条，小球上的数要重查 */
  onInboxChanged?: () => void;
  /** 去首页的「学生求助」页 */
  onOpenDesk?: () => void;
}

const COPY = {
  zh: {
    title: '使用帮助',
    hint: '平台操作问题，按使用手册回答',
    staffHint: '学生的求助，和你自己的平台操作问题',
    tabs: '使用帮助的两个页签',
    inboxTab: (n: number) => (n > 0 ? `学生求助 · ${n}` : '学生求助'),
    askTab: '问 AI',
    minimize: '收起使用帮助',
    course: '提问的课程',
    noCourse: '加入课程以后就能在这里提问。在首页侧栏「发现课程」里输入老师给的验证码加入。',
    staffNoCourse: '有了课程以后就能在这里问 AI：回答用课程里配置的 AI。在「我的课程」里新建一门。',
    loadFailed: '课程列表没能加载，稍后再试。',
  },
  en: {
    title: 'Help',
    hint: 'How-to questions, answered from the user manual',
    staffHint: 'Student help requests, and your own how-to questions',
    tabs: 'Help sections',
    inboxTab: (n: number) => (n > 0 ? `Student help · ${n}` : 'Student help'),
    askTab: 'Ask the AI',
    minimize: 'Minimise help',
    course: 'Course',
    noCourse: 'Join a course first, then ask here. Use Discover in the home sidebar with the code your teacher gave you.',
    staffNoCourse: 'Once you have a course you can ask the AI here; it answers with the AI configured for that course. Create one under My courses.',
    loadFailed: 'Could not load your courses. Try again later.',
  },
};

const HelpPanel: React.FC<HelpPanelProps> = ({
  open, lang, compact, routeCourseId, surface, page, liftAboveFooter, onMinimize, onSeen,
  staff = false, inboxCount = 0, onInboxChanged, onOpenDesk,
}) => {
  const t = COPY[lang];
  const [tab, setTab] = useState<'inbox' | 'ask'>('ask');
  const pickedTab = useRef(false);
  // 有等回复的，打开时先落在「学生求助」；自己点过页签就按自己的来
  useEffect(() => {
    if (staff && open && !pickedTab.current && inboxCount > 0) setTab('inbox');
  }, [staff, open, inboxCount]);
  const showInbox = staff && tab === 'inbox';
  const [courses, setCourses] = useState<Array<{ id: string; title: string }> | null>(null);
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const openedBefore = useRef(false);

  // 只有首页这类不带课程的页面才要列课程。每次打开都重新列：刚加入的课也要能选到。
  useEffect(() => {
    if (routeCourseId || !open) return;
    let cancelled = false;
    coursesApi.list()
      .then(({ courses: list }) => {
        if (cancelled) return;
        setCourses(list.map(c => ({ id: c.id, title: c.title })));
        setCoursesFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setCourses(prev => prev ?? []);
        setCoursesFailed(true);
      });
    return () => { cancelled = true; };
  }, [routeCourseId, open]);

  const courseId = routeCourseId
    ?? (chosen && courses?.some(c => c.id === chosen) ? chosen : null)
    ?? (courses ? pickCourse(courses, readRememberedCourse()) : null);

  // 再次打开时重新拉历史：老师可能刚回复。第一次打开时对话自己会拉，不必再拉一遍。
  useEffect(() => {
    if (!open) return;
    if (openedBefore.current) setRefreshKey(k => k + 1);
    openedBefore.current = true;
  }, [open]);

  useEffect(() => {
    if (open && courseId) onSeen(courseId);
  }, [open, courseId, onSeen]);

  const pageContext = useMemo<Record<string, unknown>>(() => {
    const samePage = !page.courseId || page.courseId === courseId;
    return {
      role: staff ? 'teacher' : 'student',
      courseId,
      surface,
      spaceId: samePage ? page.spaceId ?? null : null,
      viewId: samePage ? page.viewId ?? null : null,
      groupId: samePage ? page.groupId ?? null : null,
      noteId: samePage ? page.noteId ?? null : null,
      // 研究导出的「提问时面板」读的是 panel.activeTab
      panel: { activeTab: surface, entry: 'help-widget' },
    };
  }, [courseId, surface, page, staff]);

  const showPicker = !routeCourseId && (courses?.length ?? 0) > 1;

  const position = compact
    ? 'inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] rounded-t-2xl border-x-0 border-b-0'
    : `right-4 w-[min(25rem,calc(100vw-2rem))] rounded-2xl ${liftAboveFooter
      ? 'bottom-[4.5rem] h-[min(35rem,calc(100dvh-6rem))]'
      : 'bottom-4 h-[min(35rem,calc(100dvh-2rem))]'}`;

  return (
    <div data-help-widget="" inert={!open} aria-hidden={!open}>
      {compact && (
        <div
          aria-hidden="true"
          onClick={onMinimize}
          className={`fixed inset-0 z-[110] bg-zinc-950/30 transition-opacity duration-200 motion-reduce:transition-none ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        />
      )}
      <section
        role="dialog"
        aria-modal={compact || undefined}
        aria-labelledby="help-widget-title"
        onKeyDown={e => {
          if (e.key === 'Escape') { e.stopPropagation(); onMinimize(); }
        }}
        className={`fixed z-[110] flex flex-col overflow-hidden border border-zinc-200 bg-white text-zinc-900 shadow-[0_24px_64px_-20px_rgba(0,0,128,0.32)] transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:shadow-[0_24px_64px_-20px_rgba(2,6,23,0.9)] ${position} ${open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'}`}
      >
        {compact && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-gray-700" />}
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-gray-800">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#000080] text-white shadow-[0_6px_16px_-8px_rgba(0,0,128,0.6)] dark:bg-[#4169E1]">
            <RemixIcon name="customer-service-2-line" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="help-widget-title" className="text-[0.9375rem] font-bold leading-tight tracking-tight">{t.title}</h2>
            <p className="mt-0.5 truncate text-[0.75rem] text-zinc-500 dark:text-gray-400">{staff ? t.staffHint : t.hint}</p>
          </div>
          <button
            type="button"
            onClick={onMinimize}
            aria-label={t.minimize}
            title={t.minimize}
            className="grid size-10 shrink-0 place-items-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] sm:size-9 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            <RemixIcon name={compact ? 'arrow-down-s-line' : 'subtract-line'} size={20} />
          </button>
        </header>

        {staff && (
          <div role="tablist" aria-label={t.tabs} className="flex shrink-0 gap-1 border-b border-zinc-200 px-3 py-2 dark:border-gray-800">
            {(['inbox', 'ask'] as const).map(id => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`help-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`help-panel-${id}`}
                onClick={() => { pickedTab.current = true; setTab(id); }}
                className={`h-10 flex-1 rounded-lg text-[0.8125rem] font-semibold transition-colors duration-200 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] sm:h-9 ${tab === id
                  ? 'bg-[#000080] text-white dark:bg-[#4169E1]'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}
              >
                {id === 'inbox' ? t.inboxTab(inboxCount) : t.askTab}
              </button>
            ))}
          </div>
        )}

        {staff && (
          <div
            id="help-panel-inbox"
            role="tabpanel"
            aria-labelledby="help-tab-inbox"
            hidden={!showInbox}
            className={showInbox ? 'flex min-h-0 flex-1 flex-col' : undefined}
          >
            <HelpInbox
              lang={lang}
              active={open && showInbox}
              onChanged={() => onInboxChanged?.()}
              onOpenDesk={() => onOpenDesk?.()}
            />
          </div>
        )}

        <div
          id={staff ? 'help-panel-ask' : undefined}
          role={staff ? 'tabpanel' : undefined}
          aria-labelledby={staff ? 'help-tab-ask' : undefined}
          hidden={showInbox}
          className={showInbox ? undefined : 'flex min-h-0 flex-1 flex-col'}
        >
        {showPicker && (
          <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-4 py-2 dark:border-gray-800">
            <label htmlFor="help-widget-course" className="shrink-0 text-[0.75rem] text-zinc-500 dark:text-gray-400">{t.course}</label>
            <select
              id="help-widget-course"
              value={courseId ?? ''}
              onChange={e => { setChosen(e.target.value); rememberCourse(e.target.value); }}
              className="h-10 min-w-0 flex-1 truncate rounded-xl border border-zinc-200 bg-white px-2.5 text-base text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/10 sm:h-9 sm:text-[0.8125rem] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              {courses!.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        )}

        {courseId ? (
          <HelpChat
            key={courseId}
            courseId={courseId}
            lang={lang}
            compact={compact}
            surface={surface}
            spaceId={(pageContext.spaceId as string | null) ?? null}
            pageContext={pageContext}
            refreshKey={refreshKey}
            autoFocus={open && !compact && !showInbox}
            asker={staff ? 'teacher' : 'student'}
          />
        ) : courses === null ? (
          <div aria-hidden="true" className="flex-1 space-y-3 bg-zinc-50 p-4 dark:bg-gray-950">
            <div className="h-16 w-3/4 animate-pulse rounded-2xl bg-zinc-200/70 dark:bg-gray-800" />
            <div className="h-9 w-1/2 animate-pulse rounded-full bg-zinc-200/70 dark:bg-gray-800" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 p-8 text-center dark:bg-gray-950">
            <RemixIcon name="book-open-line" size={28} className="text-zinc-300 dark:text-gray-600" />
            <p className="max-w-[18rem] text-sm leading-relaxed text-zinc-500 dark:text-gray-400">
              {coursesFailed ? t.loadFailed : staff ? t.staffNoCourse : t.noCourse}
            </p>
          </div>
        )}
        </div>
      </section>
    </div>
  );
};

export default HelpPanel;
