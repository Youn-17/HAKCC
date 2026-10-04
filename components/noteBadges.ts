import { useSyncExternalStore } from 'react';
import { notes as notesApi } from '../services/apiClient';
import type { Edge, Note } from '../types';

/**
 * 画布卡片的「New」：别人发的笔记，我还没打开过（070，按人算）。
 *
 * A 没看过就只在 A 那里标 New，B 看没看过不影响 A。服务器按（笔记, 人）各记一行，
 * 列表接口给每条笔记带 seen_by_me。
 * 这里另存一份「这台设备报过的」：报出去之后列表接口可能先于写库重拉一次，
 * 没有这份，角标会闪回来。
 */
const seenHere = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  listeners.forEach(fn => fn());
}

type SeenFields = Pick<Note, 'id' | 'authorId' | 'seenByMe' | 'type'>;

export function isNoteNew(note: SeenFields, viewerId?: string | null): boolean {
  if (!viewerId || note.type === 'view') return false;
  return note.seenByMe === false && note.authorId !== viewerId && !seenHere.has(note.id);
}

/** 打开了一条笔记（笔记页，或在详情栏里停留）。自己的、早已被看过的都不发请求。 */
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

/** 测试用：清掉本机记录 */
export function resetNoteSeenForTests(): void {
  seenHere.clear();
  version = 0;
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
