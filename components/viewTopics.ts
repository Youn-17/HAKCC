import { useEffect, useRef, useState } from 'react';
import { viewTopics as viewTopicsApi, type ViewTopic } from '../services/apiClient';
import type { Note } from '../types';

/**
 * 问题栏后面滚动的讨论主题：什么时候去取（2026-10-05 用户：AI 自动总结，可以实时更新）。
 *
 * - 换了空间或视图：马上取；
 * - 画布上的笔记变了（新增、删除、改了标题或正文）：等 30 秒没有新的变化再取——学生正在写的时候不必每个字都问一次；
 * - 服务器说给的是旧的（stale：笔记变了，但离上次生成不到 3 分钟）：一分钟后再取一次；
 *   没生成出来（failed）：按服务器说的时间再取（它两分钟内不会再试）。
 * 生成和缓存都在服务器（同一个视图同时只生成一次），这里只决定什么时候问。
 */

export const CHANGE_DEBOUNCE_MS = 30_000;
export const STALE_RETRY_MS = 60_000;

/** 画布上这个视图的笔记的指纹：只用来判断「变了没有」，不用来做缓存的键 */
export function notesFingerprint(notes: readonly Pick<Note, 'id' | 'type' | 'title' | 'content'>[]): string {
  const parts = notes
    .filter(n => n.type !== 'view')
    .map(n => `${n.id}:${n.title ?? ''}:${(n.content ?? '').length}`)
    .sort();
  // djb2：字符串很长时也只留一个短数
  let hash = 5381;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${parts.length}:${(hash >>> 0).toString(36)}`;
}

export function useViewTopics(spaceId: string | null | undefined, viewId: string | null | undefined, fingerprint: string): ViewTopic[] {
  const [topics, setTopics] = useState<ViewTopic[]>([]);
  const lastView = useRef('');
  /** 这个视图已经取到过一次：之后的笔记变化才按 30 秒防抖 */
  const loadedView = useRef('');

  useEffect(() => {
    if (!spaceId || !viewId) {
      setTopics([]);
      return;
    }
    const viewKey = `${spaceId}:${viewId}`;
    const switched = lastView.current !== viewKey;
    lastView.current = viewKey;
    // 换了视图：上一个视图的主题不能留着
    if (switched) setTopics([]);

    let cancelled = false;
    let retry = 0;
    const load = () => {
      viewTopicsApi.get(spaceId, viewId)
        .then(result => {
          if (cancelled) return;
          loadedView.current = viewKey;
          setTopics(result.topics ?? []);
          // 旧的，或这次没生成出来：过一会儿再问（没生成出来时服务器会说等多久）
          if (result.stale || result.failed) retry = window.setTimeout(load, Math.max(STALE_RETRY_MS, result.retryAfterMs ?? 0));
        })
        .catch(() => { /* 取不到就不显示，别打扰 */ });
    };
    // 还没取到过（刚打开时笔记陆续加载，指纹会连着变几次）：马上取，不等 30 秒
    const timer = window.setTimeout(load, loadedView.current === viewKey ? CHANGE_DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(retry);
    };
  }, [spaceId, viewId, fingerprint]);

  return topics;
}
