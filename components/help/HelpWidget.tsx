import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ApiClientError, support } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { ErrorBoundary } from '../ErrorBoundary';
import { MORANDI, solidStyle } from '../morandiPalette';
import { useHelpPageContext } from './helpContext';
import {
  COMPACT_MAX_WIDTH,
  ballBounds,
  isSmallBall,
  forgetCourse,
  hasOpenDialog,
  inboxWaiting,
  isHelpStaff,
  isEditableElement,
  markSeen,
  ratioFromTop,
  readBallRatio,
  readRememberedCourse,
  readSeenAt,
  rememberCourse,
  routeInfo,
  saveBallRatio,
  shouldShowHelp,
  topFromRatio,
  unseenTeacherReplies,
  type HelpLang,
} from './helpWidgetModel';

/**
 * 使用帮助：贴在页面右边缘的小球，点开是右下角的对话窗（手机上是底部抽屉）。
 *
 * 挂在整个应用最外层而不是各个页面里：首页、画布、笔记页、阅读页都是同一个球，
 * 换页面时对话窗不关、写了一半的问题也不丢。教师、管理员也有（2026-10-05 起）：
 * 多一个「学生求助」页签，球上显示等回复的条数；问 AI 时按含教师端的手册答，答不了转平台管理员。
 *
 * 层级用 z-[110]：笔记页、阅读页、讨论室这几个整页是 z-[100]，球要在它们上面。
 * 对话框没法只靠层级让开：多数和整页同为 z-[100]；笔记页里的确认框虽然写的是 150，
 * 却在笔记页那层 z-[100] 的层叠上下文里，实际也排在球下面。所以页面上出现对话框遮罩时，
 * 球和对话窗都先收起来（见 hasOpenDialog）；画布上 z-[130] 的网络图、时间线本来就在球上面。
 */

const loadPanel = () => import('./HelpPanel');
const HelpPanel = lazy(loadPanel);

const COPY = {
  zh: {
    label: '使用帮助',
    replies: (n: number) => `老师回复了 ${n} 条`,
    adminReplies: (n: number) => `平台管理员回复了 ${n} 条`,
    waiting: (n: number) => `${n} 条求助等你回复`,
    aria: (unseen: string | null) => `打开使用帮助${unseen ? `，${unseen}` : ''}。可以用上下方向键移动位置`,
  },
  en: {
    label: 'Help',
    replies: (n: number) => `${n} new ${n === 1 ? 'reply' : 'replies'} from your teacher`,
    adminReplies: (n: number) => `${n} new ${n === 1 ? 'reply' : 'replies'} from the platform admin`,
    waiting: (n: number) => `${n} help ${n === 1 ? 'request' : 'requests'} waiting for you`,
    aria: (unseen: string | null) => `Open help${unseen ? `, ${unseen}` : ''}. Arrow up or down moves it`,
  },
};

function isFocusVisible(el: Element): boolean {
  try { return el.matches(':focus-visible'); } catch { return true; }
}

/** 球外面那一圈透明边距，量不到时用它估 dock 的高度 */
const FALLBACK_DOCK_HEIGHT = 110;
const KEY_STEP = 32;

function useViewport() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return coarse;
}

/** 页面上有没有打开的对话框。DOM 一有增删就查一次，同一帧里的多次变化只查一回。 */
function useDialogOpen(enabled: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled || typeof MutationObserver === 'undefined') { setOpen(false); return; }
    const raf = window.requestAnimationFrame?.bind(window) ?? ((cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16));
    const cancel = window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout.bind(window);
    let frame = 0;
    const check = () => { frame = 0; setOpen(hasOpenDialog(document)); };
    const schedule = () => { if (!frame) frame = raf(check); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => { observer.disconnect(); if (frame) cancel(frame); };
  }, [enabled]);
  return open;
}

/** 手机上在页面别处打字时让开：球贴着右边缘，正好压在输入框的末尾。 */
function useTypingElsewhere(enabled: boolean): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!enabled) { setTyping(false); return; }
    let timer = 0;
    const update = () => {
      const el = document.activeElement;
      setTyping(isEditableElement(el) && !el?.closest('[data-help-widget]'));
    };
    // focusout 先于下一个元素的 focusin，晚一拍再看焦点落在哪
    const onChange = () => { window.clearTimeout(timer); timer = window.setTimeout(update, 0); };
    document.addEventListener('focusin', onChange);
    document.addEventListener('focusout', onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', onChange);
      document.removeEventListener('focusout', onChange);
    };
  }, [enabled]);
  return typing;
}

/**
 * 老师回复了没有看的几条。进页面几秒后查一次，回到这个标签页时再查（至多三分钟一次）。
 * 学生求助转给老师以后，除了这里没有别的地方会告诉他老师回了。
 */
function useUnseenReplies(courseId: string | null, open: boolean): [number, () => void] {
  const [count, setCount] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    setCount(0);
    if (!courseId) return;
    let cancelled = false;
    last.current = 0;
    const check = () => {
      if (Date.now() - last.current < 3 * 60_000) return;
      last.current = Date.now();
      support.mine(courseId)
        .then(({ questions }) => { if (!cancelled) setCount(unseenTeacherReplies(questions, readSeenAt(courseId))); })
        .catch(err => {
          // 课程退掉了，记着的那门就别再查了；其余情况查不到就不显示，别打扰
          if (err instanceof ApiClientError && (err.status === 403 || err.status === 404) && readRememberedCourse() === courseId) {
            forgetCourse();
          }
        });
    };
    const timer = window.setTimeout(check, 3000);
    window.addEventListener('focus', check);
    return () => { cancelled = true; window.clearTimeout(timer); window.removeEventListener('focus', check); };
  }, [courseId]);
  useEffect(() => { if (open) setCount(0); }, [open]);
  const clear = useCallback(() => setCount(0), []);
  return [count, clear];
}

/**
 * 教师、管理员：等回复的求助有几条。进页面几秒后查一次，之后每两分钟（页面在前台时）、
 * 回到这个标签页时再查（至多半分钟一次）。回复了一条就立刻重查。
 */
function useInboxCount(enabled: boolean): [number, () => void] {
  const [count, setCount] = useState(0);
  const last = useRef(0);
  const check = useCallback((force = false) => {
    if (!force && Date.now() - last.current < 30_000) return;
    last.current = Date.now();
    support.inbox()
      .then(r => setCount(inboxWaiting(r.counts)))
      .catch(() => { /* 查不到就不显示，别打扰 */ });
  }, []);
  useEffect(() => {
    setCount(0);
    if (!enabled) return;
    last.current = 0;
    const first = window.setTimeout(() => check(), 2500);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') check(); }, 120_000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [enabled, check]);
  const refresh = useCallback(() => check(true), [check]);
  return [count, refresh];
}

export default function HelpWidget({ lang }: { lang: HelpLang }) {
  const t = COPY[lang];
  const { user } = useAuth();
  const { pathname } = useLocation();
  const route = routeInfo(pathname);
  const page = useHelpPageContext();
  const enabled = shouldShowHelp(user?.role, pathname);
  const staff = enabled && isHelpStaff(user?.role);
  const navigate = useNavigate();
  const [waiting, refreshInbox] = useInboxCount(staff);

  const viewport = useViewport();
  const compact = viewport.width < COMPACT_MAX_WIDTH;
  const coarse = useCoarsePointer();
  const dialogOpen = useDialogOpen(enabled);
  const typingElsewhere = useTypingElsewhere(enabled && coarse);

  const [open, setOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [peek, setPeek] = useState(false);
  const [ratio, setRatio] = useState(readBallRatio);
  const [dragTop, setDragTop] = useState<number | null>(null);
  const [dockHeight, setDockHeight] = useState(FALLBACK_DOCK_HEIGHT);
  const dockRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; startTop: number; moved: boolean } | null>(null);
  const draggedAt = useRef(0);
  const refocusBall = useRef(false);

  const [badgeCourse, setBadgeCourse] = useState<string | null>(() => readRememberedCourse());
  useEffect(() => {
    if (!enabled || !route.courseId) return;
    rememberCourse(route.courseId);
    setBadgeCourse(route.courseId);
  }, [enabled, route.courseId]);
  const [unseen, clearUnseen] = useUnseenReplies(enabled ? badgeCourse : null, open);

  // 对话窗的代码单独一个包，页面空下来就先取回来：等学生点的时候再取，
  // 要是恰好赶上新版本上线，旧的包已经不在了，只能整页刷新，正在写的笔记会丢。
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => { void loadPanel().catch(() => {}); }, 2500);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  useLayoutEffect(() => {
    const h = dockRef.current?.offsetHeight;
    if (h) setDockHeight(h);
  }, [enabled, compact]);

  const bounds = ballBounds(viewport.height, dockHeight, compact);
  const top = dragTop ?? topFromRatio(ratio, bounds);

  const surface = page.surface && (!page.courseId || page.courseId === route.courseId) ? page.surface : route.surface;
  const small = isSmallBall(surface, coarse, compact);

  const openPanel = useCallback(() => {
    setPanelMounted(true);
    setOpen(true);
    setPeek(false);
  }, []);

  const minimize = useCallback(() => {
    refocusBall.current = true;
    setOpen(false);
  }, []);

  // 打开时重查一次：页签上的数要是现在的
  useEffect(() => {
    if (open && staff) refreshInbox();
  }, [open, staff, refreshInbox]);

  const openDesk = useCallback(() => {
    setOpen(false);
    navigate('/dashboard', { state: { dashboardTab: 'student-help' } });
  }, [navigate]);

  const onSeen = useCallback((courseId: string) => {
    markSeen(courseId);
    if (courseId === badgeCourse) clearUnseen();
  }, [badgeCourse, clearUnseen]);

  // 收起后焦点回到球上，键盘用户不至于跳回页面顶上
  useEffect(() => {
    if (!open && refocusBall.current) {
      refocusBall.current = false;
      ballRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // 离开登录后的页面（退出登录）时收起
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  const settle = (nextTop: number) => {
    const clamped = Math.min(bounds.max, Math.max(bounds.min, nextTop));
    const nextRatio = ratioFromTop(clamped, bounds);
    setRatio(nextRatio);
    saveBallRatio(nextRatio);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    drag.current = { pointerId: e.pointerId, startY: e.clientY, startTop: top, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    setDragTop(Math.min(bounds.max, Math.max(bounds.min, d.startTop + dy)));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d.moved) {
      draggedAt.current = Date.now();
      settle(d.startTop + (e.clientY - d.startY));
    }
    setDragTop(null);
  };

  // 被系统打断（来电、手势）时位置不作数：这时的坐标可能是 0，照着存球就飞到顶上去了
  const onPointerCancel = () => {
    drag.current = null;
    setDragTop(null);
  };

  const onClick = () => {
    // 鼠标拖完松手，浏览器还会补一个 click，不能当成「点开」。
    // 按时间判断而不是留一个「吞掉下一次点击」的标记：手指拖动后浏览器往往不补 click，
    // 那个标记就会一直留着，把学生下一次真正的点击吃掉。
    if (Date.now() - draggedAt.current < 400) return;
    openPanel();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      settle(top + (e.key === 'ArrowUp' ? -KEY_STEP : KEY_STEP));
    }
  };

  if (!enabled) return null;

  const dragging = dragTop !== null;
  const out = peek || dragging;
  const ballHidden = open || dialogOpen || typingElsewhere;
  const repliesText = unseen > 0 ? (staff ? t.adminReplies(unseen) : t.replies(unseen)) : null;
  const waitingText = staff && waiting > 0 ? t.waiting(waiting) : null;
  const notice = waitingText ?? repliesText;
  const ariaLabel = t.aria(notice);

  return (
    <>
      <div
        ref={dockRef}
        data-help-widget=""
        inert={ballHidden}
        style={{ top }}
        className={`pointer-events-none fixed right-0 z-[110] flex items-center gap-2 overflow-hidden py-6 pl-4 transition-opacity duration-200 motion-reduce:transition-none ${ballHidden ? 'opacity-0' : 'opacity-100'}`}
      >
        {!compact && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={openPanel}
            onPointerEnter={() => setPeek(true)}
            onPointerLeave={() => setPeek(false)}
            className={`whitespace-nowrap rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[0.75rem] font-semibold text-[#000080] shadow-[0_6px_18px_-10px_rgba(0,0,128,0.45)] transition-all duration-200 motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-900 dark:text-[#93AAFD] ${out && !dragging && !ballHidden ? 'pointer-events-auto translate-x-0 opacity-100' : 'translate-x-3 opacity-0'}`}
          >
            {notice ?? t.label}
          </button>
        )}
        <button
          ref={ballRef}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerEnter={e => { if (e.pointerType === 'mouse') setPeek(true); }}
          onPointerLeave={e => { if (e.pointerType === 'mouse' && !drag.current) setPeek(false); }}
          onFocus={e => { if (isFocusVisible(e.currentTarget)) setPeek(true); }}
          onBlur={() => setPeek(false)}
          className={`pointer-events-auto relative grid ${small ? 'size-[1.875rem]' : 'size-11'} shrink-0 touch-none select-none place-items-center rounded-full bg-[#000080] text-white ring-1 ring-inset ring-white/15 shadow-[0_10px_24px_-10px_rgba(0,0,128,0.7)] transition-[translate,scale,background-color,box-shadow] duration-200 ease-out before:absolute before:inset-y-0 before:-left-3 before:content-[''] hover:bg-[#0b0b8c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] motion-reduce:transition-none dark:bg-[#4169E1] dark:hover:bg-[#3457D5] dark:ring-white/25 dark:shadow-[0_10px_24px_-10px_rgba(2,6,23,0.95)] dark:focus-visible:outline-[#93AAFD] ${dragging ? 'scale-105 cursor-grabbing' : 'cursor-pointer active:scale-95'} ${out ? '-translate-x-3' : small ? 'translate-x-[46%]' : 'translate-x-[42%]'}`}
        >
          <RemixIcon
            name="customer-service-2-line"
            size={small ? 16 : 21}
            className={`transition-transform duration-200 motion-reduce:transition-none ${out ? 'translate-x-0' : small ? '-translate-x-[0.45rem]' : '-translate-x-[0.6rem]'}`}
          />
          {waitingText ? (
            <span
              aria-hidden="true"
              data-help-waiting={waiting}
              className={`absolute -top-1 min-w-[1.125rem] rounded-full px-1 text-center text-[0.6875rem] font-bold leading-[1.125rem] text-white ring-2 ring-white transition-[left] duration-200 dark:ring-gray-950 ${out ? 'left-0' : '-left-0.5'}`}
              style={solidStyle(MORANDI.rose)}
            >
              {waiting > 99 ? '99+' : waiting}
            </span>
          ) : unseen > 0 && (
            <span
              aria-hidden="true"
              className={`absolute top-1 size-2.5 rounded-full ring-2 ring-white transition-[left] duration-200 dark:ring-gray-950 ${out ? 'left-1' : 'left-0.5'}`}
              style={solidStyle(MORANDI.rose)}
            />
          )}
        </button>
      </div>

      {panelMounted && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <HelpPanel
              open={open && !dialogOpen}
              lang={lang}
              compact={compact}
              routeCourseId={route.courseId}
              surface={surface}
              page={page}
              liftAboveFooter={surface === 'note-editor' && !compact}
              onMinimize={minimize}
              onSeen={onSeen}
              staff={staff}
              inboxCount={waiting}
              onInboxChanged={refreshInbox}
              onOpenDesk={openDesk}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}
