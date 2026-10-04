import { useEffect, useSyncExternalStore } from 'react';
import type { HelpSurface } from './helpWidgetModel';

/**
 * 页面告诉使用帮助「学生现在在哪」。
 *
 * 帮助球挂在整个应用最外层，看得到地址，看不到工作区里的状态：阅读页、讨论室不改地址，
 * 当前空间、视图、小组也只在工作区里。提问时带上这些，老师才知道问题出在哪一块画布上，
 * 研究导出按空间筛选时这条求助也不会丢。只收定位用的 id，不收笔记内容和身份信息。
 */
export interface HelpPageContext {
  courseId?: string | null;
  surface?: HelpSurface;
  spaceId?: string | null;
  viewId?: string | null;
  groupId?: string | null;
  noteId?: string | null;
}

const EMPTY: HelpPageContext = {};
let current: HelpPageContext = EMPTY;
const listeners = new Set<() => void>();

function publish(next: HelpPageContext) {
  current = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function readHelpPageContext(): HelpPageContext {
  return current;
}

export function useHelpPageContext(): HelpPageContext {
  return useSyncExternalStore(subscribe, readHelpPageContext, readHelpPageContext);
}

/** 工作区这类页面调用。页面卸载时收回自己报的那一份，别的页面报的不动。 */
export function useReportHelpContext(context: HelpPageContext): void {
  const key = JSON.stringify(context);
  useEffect(() => {
    const snapshot = JSON.parse(key) as HelpPageContext;
    publish(snapshot);
    return () => {
      if (current === snapshot) publish(EMPTY);
    };
  }, [key]);
}
