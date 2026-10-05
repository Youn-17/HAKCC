import { useEffect, useRef, useSyncExternalStore } from 'react';
import { notes as notesApi } from '../services/apiClient';
import type { Edge, Note } from '../types';

/**
 * 画布卡片的「New」：别人发的笔记，我还没打开过（070，按人算）。
 *
 * A 没看过就只在 A 那里标 New，B 看没看过不影响 A。服务器按（笔记, 人）各记一行，
 * 列表接口给每条笔记带 seen_by_me。
 * 这里另存一份「这台设备报过的」：报出去之后列表接口可能先于写库重拉一次，
 * 没有这份，角标会闪回来。
 *
 * 什么算「打开过」：双击打开的窗口在前台停够 SEEN_DWELL_MS（useMarkSeenAfterDwell）。
 * 单击选中、右侧详情栏、双击的那一下都不算——2026-10-05 用户：一点就没了不行，要打开看过才消失。
 */
const seenHere = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export const SEEN_DWELL_MS = 3000;
let dwellOverrideMs: number | null = null;

function notify() {
  version += 1;
  listeners.forEach(fn => fn());
}

type SeenFields = Pick<Note, 'id' | 'authorId' | 'seenByMe' | 'type'>;

export function isNoteNew(note: SeenFields, viewerId?: string | null): boolean {
  if (!viewerId || note.type === 'view') return false;
  return note.seenByMe === false && note.authorId !== viewerId && !seenHere.has(note.id);
}

/**
 * 我自己写的笔记：卡片浅蓝底、名字旁一个「我」，「我的笔记」按它筛（2026-10-05）。
 * AI 写的不算，哪怕 author_id 是我——采纳反馈发布的笔记 author_id 记的就是学生。
 */
export function isOwnNote(note: Pick<Note, 'authorId' | 'author' | 'isAiGenerated' | 'type'>, viewerId?: string | null): boolean {
  if (!viewerId || note.type === 'view') return false;
  return note.authorId === viewerId && !note.isAiGenerated && note.author !== 'AI Partner';
}

/** 看过了一条笔记。自己的、早已被看过的都不发请求。界面里别直接调，走 useMarkSeenAfterDwell。 */
export function markNoteSeen(note: SeenFields, viewerId?: string | null): void {
  if (!isNoteNew(note, viewerId)) return;
  seenHere.add(note.id);
  notify();
  // 没报上去就从本地记录里拿掉，下次打开再报；角标先不闪回来，等列表重拉时以服务器为准
  notesApi.markSeen(note.id).catch(() => { seenHere.delete(note.id); });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 本机又报了一条「打开过」时变一下，给按 isNoteNew 算角标的 useMemo 当依赖。 */
export function useNoteSeenVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * 页面在前台累计满 delayMs 后调一次 onDone。切到后台暂停，回来接着算：
 * 打开就切走去做别的，不算看过。返回取消函数（窗口关了、换了一条笔记）。
 */
export function startVisibleDwell(delayMs: number, onDone: () => void, doc: VisibilitySource = document): () => void {
  let remaining = delayMs;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const run = () => {
    if (finished || timer !== null) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = null;
      finished = true;
      onDone();
    }, Math.max(0, remaining));
  };
  const pause = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining -= Date.now() - startedAt;
  };
  const onVisibility = () => (doc.visibilityState === 'visible' ? run() : pause());

  doc.addEventListener('visibilitychange', onVisibility);
  if (doc.visibilityState === 'visible') run();
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    finished = true;
  };
}

/**
 * 打开着的这条笔记（null = 没打开）在前台停够 SEEN_DWELL_MS 才算看过。
 * 给真正打开的窗口用：笔记页、AI 对话笔记、画图、附件、讨论室。
 */
export function useMarkSeenAfterDwell(note: SeenFields | null | undefined, viewerId?: string | null): void {
  const latest = useRef(note);
  latest.current = note;
  const noteId = note?.id ?? null;
  useEffect(() => {
    if (!noteId || typeof document === 'undefined') return;
    return startVisibleDwell(dwellOverrideMs ?? SEEN_DWELL_MS, () => {
      const current = latest.current;
      if (current && current.id === noteId) markNoteSeen(current, viewerId);
    });
  }, [noteId, viewerId]);
}

/** 测试用：清掉本机记录，停留时长恢复默认 */
export function resetNoteSeenForTests(): void {
  seenHere.clear();
  version = 0;
  dwellOverrideMs = null;
}

/** 测试用：把「停够多久」改短，免得每条用例真等 3 秒 */
export function setSeenDwellForTests(ms: number | null): void {
  dwellOverrideMs = ms;
}

/**
 * 被 Build-on 最多的笔记：卡片左上角一团火，值是次数。整个空间一起比，不分 View；
 * 至少两次才算 —— 刚开课时人人一条 Build-on，每张卡都着火就没意义了。
 * 只数学生自己建的：AI 建议、还没被采纳的连线不算。并列第一的都算。
 */
export function hotBuildOnCounts(edges: Pick<Edge, 'target' | 'aiSuggested' | 'aiAccepted'>[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const edge of edges) {
    if (!edge.target || (edge.aiSuggested && !edge.aiAccepted)) continue;
    totals.set(edge.target, (totals.get(edge.target) ?? 0) + 1);
  }
  let max = 0;
  for (const count of totals.values()) max = Math.max(max, count);
  const hot = new Map<string, number>();
  if (max >= 2) for (const [id, count] of totals) if (count === max) hot.set(id, count);
  return hot;
}
