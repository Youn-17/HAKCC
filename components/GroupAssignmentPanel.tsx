import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import RemixIcon from './RemixIcon';
import { groupAssignments, type ApiGroupAssignment } from '../services/apiClient';
import { MORANDI, chipStyle } from './morandiPalette';
import { motionAllowed, useLayoutMotion } from '../hooks/useLayoutMotion';
import { assignmentVersion, assignmentViews, dueLabel, markSeen, readSeen, visibleInView, type DueTone, type ViewMeta } from './groupAssignmentModel';

/**
 * 小组任务面板（2026-10-10 用户：教师一键给各组发布任务，小组进到视图里就看到；学生不能 Build-on，也不算笔记）。
 *
 * 浮在画布左上角（2026-10-10 用户要求，原在右上角），不在画布坐标里，所以不会被拖走、不会被选中、不能连线；data-canvas-overlay 让滚轮和拖动
 * 不传给画布。学生看发给自己组的，教职看全部并标出发给了哪些组。有新任务或任务改过就自动展开一次。
 * 动效：第一次出现淡入、各条错开出现；展开收起和任务增减用 anime.js 布局动画（useLayoutMotion）。
 */

interface Props {
  spaceId: string;
  viewId: string;
  /** 这个空间的视图（含主画布、各组的视图）：判断任务显示在哪 */
  views: ReadonlyArray<ViewMeta>;
  lang: 'zh' | 'en';
  isStaff: boolean;
  /** 发布、修改、撤回之后加一，面板重新取 */
  refreshKey?: number;
  /** 点了「新的小组任务」通知：展开 */
  focusKey?: number;
  /** 教职：打开小组管理的「发布任务」 */
  onManage?: () => void;
  /** 学生不在任务所在的视图时，提示里的「前往」 */
  onGoToView?: (viewId: string) => void;
}

const REFRESH_MS = 120_000;
const COLLAPSE_KEY = 'hakcc-group-task-collapsed';

const DUE_TONE: Record<DueTone, string> = { normal: MORANDI.dustyBlue, soon: MORANDI.ochre, overdue: MORANDI.rose };

function readCollapsed(spaceId: string): boolean {
  try { return localStorage.getItem(`${COLLAPSE_KEY}:${spaceId}`) === '1'; } catch { return false; }
}
function writeCollapsed(spaceId: string, value: boolean) {
  try { localStorage.setItem(`${COLLAPSE_KEY}:${spaceId}`, value ? '1' : '0'); } catch { /* 记不住就算了 */ }
}

const signature = (list: ApiGroupAssignment[]) => list.map(assignmentVersion).join('|');

const GroupAssignmentPanel: React.FC<Props> = ({ spaceId, viewId, views, lang, isStaff, refreshKey = 0, focusKey = 0, onManage, onGoToView }) => {
  const zh = lang === 'zh';
  const [all, setAll] = useState<ApiGroupAssignment[]>([]);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(spaceId));
  const { ref: motionRef, capture } = useLayoutMotion<HTMLDivElement>({ step: 32, maxStagger: 8 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRoot = useCallback((node: HTMLDivElement | null) => { rootRef.current = node; motionRef(node); }, [motionRef]);
  const latest = useRef(all);
  latest.current = all;

  useEffect(() => { setAll([]); setCollapsed(readCollapsed(spaceId)); }, [spaceId]);

  const load = useCallback(async () => {
    try {
      const { assignments } = await groupAssignments.forSpace(spaceId);
      if (signature(assignments) === signature(latest.current)) return;
      capture();
      setAll(assignments);
    } catch { /* 取不到就不显示面板，下次再取 */ }
  }, [spaceId, capture]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const visible = useMemo(() => all.filter(a => visibleInView(a, spaceId, viewId, views)), [all, spaceId, viewId, views]);
  /** 学生：这里没有、但在别的视图里给自己组的任务（比如发到了「各组自己的视图」），提示去哪看 */
  const elsewhere = useMemo(() => {
    if (isStaff || visible.length > 0) return null;
    for (const a of all) {
      const target = assignmentViews(a, spaceId, views)?.find(v => v.id !== viewId);
      if (target) return { view: target, count: all.filter(x => assignmentViews(x, spaceId, views)?.some(v => v.id === target.id)).length };
    }
    return null;
  }, [all, isStaff, visible.length, spaceId, viewId, views]);
  const versions = useMemo(() => visible.map(assignmentVersion), [visible]);
  const versionKey = versions.join('|');

  // 有没看过的（新发的、改过的）就展开给人看；展开着就记为看过
  useEffect(() => {
    if (!versions.length || !collapsed) return;
    const seen = readSeen();
    if (versions.some(v => !seen.has(v))) {
      capture();
      setCollapsed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionKey]);
  useEffect(() => { if (!collapsed && versions.length) markSeen(versions); }, [collapsed, versions]);

  useEffect(() => {
    if (!focusKey) return;
    capture();
    setCollapsed(false);
  }, [focusKey, capture]);

  const toggle = () => {
    const next = !collapsed;
    writeCollapsed(spaceId, next);
    capture();
    setCollapsed(next);
  };

  // 换到一个有任务的视图（或第一次取到任务）时整块淡入、各条错开：比一下子冒出来柔和
  const enteredKey = useRef('');
  const hasVisible = visible.length > 0;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !hasVisible) { if (!hasVisible) enteredKey.current = ''; return; }
    const key = `${spaceId}:${viewId}`;
    if (enteredKey.current === key) return;
    enteredKey.current = key;
    if (!motionAllowed()) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-layout-item]')).slice(0, 10);
    const box = animate(root, { opacity: [0, 1], translateY: [-8, 0], duration: 320, ease: 'out(4)' });
    const rows = items.length ? animate(items, { opacity: [0, 1], translateY: [6, 0], delay: stagger(36, { start: 110 }), duration: 300, ease: 'out(4)' }) : null;
    return () => { box.revert(); rows?.revert(); };
  }, [spaceId, viewId, hasVisible]);

  if (!hasVisible) {
    if (!elsewhere || !onGoToView) return null;
    return (
      <div data-canvas-overlay onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} className="absolute left-4 top-4 z-30">
        <button
          type="button"
          onClick={() => onGoToView(elsewhere.view.id)}
          className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-2xl border border-zinc-200 bg-white/95 px-3.5 text-sm text-zinc-700 shadow-[0_6px_20px_rgba(0,0,128,0.08)] backdrop-blur transition-colors hover:border-[#000080]/30 hover:text-[#000080] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 active:scale-[0.98] dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-200"
        >
          <RemixIcon name="task-line" size={16} className="text-[#000080] dark:text-blue-300" />
          <span>
            {zh ? `${elsewhere.count} 个小组任务在「${elsewhere.view.title}」` : `${elsewhere.count} group task${elsewhere.count === 1 ? '' : 's'} in "${elsewhere.view.title}"`}
          </span>
          <span className="font-semibold text-[#000080] dark:text-blue-300">{zh ? '前往' : 'Go'}</span>
          <RemixIcon name="arrow-right-s-line" size={16} className="text-[#000080] dark:text-blue-300" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={setRoot}
      data-canvas-overlay
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      className="absolute left-4 top-4 z-30 flex flex-col items-start"
      role="region"
      aria-label={zh ? '小组任务' : 'Group tasks'}
    >
      {collapsed ? (
        <button
          type="button"
          data-layout-item
          onClick={toggle}
          aria-expanded={false}
          className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-2xl border border-zinc-200 bg-white/95 px-3.5 text-sm font-semibold text-zinc-800 shadow-[0_6px_20px_rgba(0,0,128,0.08)] backdrop-blur transition-colors hover:border-[#000080]/30 hover:text-[#000080] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 active:scale-[0.98] dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-100"
        >
          <RemixIcon name="task-line" size={16} className="text-[#000080] dark:text-blue-300" />
          {zh ? '小组任务' : 'Group tasks'}
          <span className="rounded-full bg-[#000080] px-1.5 text-[0.6875rem] font-bold leading-5 text-white tabular-nums dark:bg-blue-400/80">{visible.length}</span>
        </button>
      ) : (
        <section
          data-layout-item
          className="flex max-h-[min(58vh,34rem)] w-[min(22rem,calc(100vw-7rem))] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-[0_10px_30px_rgba(0,0,128,0.10)] backdrop-blur dark:border-gray-800 dark:bg-gray-900/95"
        >
          <header data-layout-item className="flex items-start gap-2.5 border-b border-zinc-100 px-4 pb-3 pt-3.5 dark:border-gray-800">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#000080]/[0.07] text-[#000080] dark:bg-blue-400/10 dark:text-blue-300">
              <RemixIcon name="task-line" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-gray-100">{zh ? '小组任务' : 'Group tasks'}</h2>
              <p className="text-[0.6875rem] leading-relaxed text-zinc-500 dark:text-gray-400">
                {isStaff ? (zh ? '教师视角：显示所有小组收到的任务' : 'Teacher view: tasks for every group') : (zh ? '老师发给你们组的任务，只能查看' : 'From your teacher to your group (read only)')}
              </p>
            </div>
            {onManage && (
              <button type="button" onClick={onManage}
                className="min-h-8 rounded-lg px-2 text-xs font-medium text-[#000080] transition-colors hover:bg-[#000080]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 dark:text-blue-300">
                {zh ? '管理' : 'Manage'}
              </button>
            )}
            <button type="button" onClick={toggle} aria-expanded aria-label={zh ? '收起小组任务' : 'Collapse group tasks'} title={zh ? '收起' : 'Collapse'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 dark:hover:bg-gray-800 dark:hover:text-gray-200">
              <RemixIcon name="arrow-up-s-line" size={18} />
            </button>
          </header>
          <ol className="flex-1 space-y-4 overflow-y-auto px-4 py-3.5">
            {visible.map(a => <AssignmentItem key={a.id} assignment={a} lang={lang} isStaff={isStaff} />)}
          </ol>
        </section>
      )}
    </div>
  );
};

const AssignmentItem: React.FC<{ assignment: ApiGroupAssignment; lang: 'zh' | 'en'; isStaff: boolean }> = ({ assignment: a, lang, isStaff }) => {
  const zh = lang === 'zh';
  const due = dueLabel(a.dueAt, lang);
  const published = new Date(a.createdAt);
  const when = Number.isNaN(published.getTime()) ? '' : (zh ? `${published.getMonth() + 1}月${published.getDate()}日发布` : `Posted ${published.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  return (
    <li data-layout-item className="border-b border-zinc-100 pb-4 last:border-b-0 last:pb-0 dark:border-gray-800">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-[0.9375rem] font-bold leading-snug tracking-tight text-zinc-900 dark:text-gray-100">{a.title}</h3>
        {due && <span className="shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium" style={chipStyle(DUE_TONE[due.tone])}>{due.text}</span>}
      </div>
      {a.content && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-700 dark:text-gray-300">{a.content}</p>}
      {a.requirements.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-gray-400">{zh ? '要求' : 'Requirements'}</p>
          <ol className="space-y-1.5">
            {a.requirements.map((line, i) => (
              <li key={i} data-layout-item className="flex gap-2 text-sm leading-relaxed text-zinc-700 dark:text-gray-300">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#000080]/[0.07] text-[0.6875rem] font-semibold tabular-nums text-[#000080] dark:bg-blue-400/10 dark:text-blue-300">{i + 1}</span>
                <span className="min-w-0 break-words">{line}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="mt-3 text-[0.6875rem] text-zinc-400 dark:text-gray-500">
        {[a.author?.name, when, isStaff && a.groups.length ? (zh ? `发给 ${a.groups.map(g => g.name).join('、')}` : `To ${a.groups.map(g => g.name).join(', ')}`) : null].filter(Boolean).join(' · ')}
      </p>
    </li>
  );
};

export default GroupAssignmentPanel;
