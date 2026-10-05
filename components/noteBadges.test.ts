import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isOwnNote, SEEN_DWELL_MS, startVisibleDwell } from './noteBadges';

/**
 * New 什么时候摘：打开的窗口在前台停够 3 秒（2026-10-05 用户：一点就没了不行，要双击打开、看过才消失）。
 */

function fakeDocument(initial: 'visible' | 'hidden' = 'visible') {
  const listeners = new Set<() => void>();
  return {
    visibilityState: initial as string,
    addEventListener: (_type: 'visibilitychange', fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_type: 'visibilitychange', fn: () => void) => { listeners.delete(fn); },
    switchTo(state: 'visible' | 'hidden') {
      this.visibilityState = state;
      listeners.forEach(fn => fn());
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('startVisibleDwell', () => {
  it('在前台满 3 秒才算，只算一次', () => {
    const doc = fakeDocument();
    const done = vi.fn();
    startVisibleDwell(SEEN_DWELL_MS, done, doc);

    vi.advanceTimersByTime(2999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('不到 3 秒就关了：不算', () => {
    const done = vi.fn();
    const cancel = startVisibleDwell(SEEN_DWELL_MS, done, fakeDocument());
    vi.advanceTimersByTime(2000);
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(done).not.toHaveBeenCalled();
  });

  it('切到后台的时间不算，回来接着算', () => {
    const doc = fakeDocument();
    const done = vi.fn();
    startVisibleDwell(SEEN_DWELL_MS, done, doc);

    vi.advanceTimersByTime(2000);
    doc.switchTo('hidden');
    vi.advanceTimersByTime(60_000);
    expect(done).not.toHaveBeenCalled();

    doc.switchTo('visible');
    vi.advanceTimersByTime(999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('打开时页面就在后台：回到前台才开始算', () => {
    const doc = fakeDocument('hidden');
    const done = vi.fn();
    startVisibleDwell(SEEN_DWELL_MS, done, doc);
    vi.advanceTimersByTime(60_000);
    expect(done).not.toHaveBeenCalled();
    doc.switchTo('visible');
    vi.advanceTimersByTime(SEEN_DWELL_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('取消后不再挂着监听', () => {
    const doc = fakeDocument();
    const cancel = startVisibleDwell(SEEN_DWELL_MS, vi.fn(), doc);
    expect(doc.listenerCount()).toBe(1);
    cancel();
    expect(doc.listenerCount()).toBe(0);
  });
});

describe('界面只通过停留计时摘 New', () => {
  const source = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

  it('画布和笔记页都不直接调 markNoteSeen：单击、双击的那一下都不算看过', () => {
    for (const file of ['Workspace.tsx', 'NoteEditorModal.tsx', 'mobile/MobileWorkspace.tsx', 'mobile/MobileNotesList.tsx']) {
      expect(source(file), file).not.toMatch(/\bmarkNoteSeen\s*\(/);
    }
    expect(source('Workspace.tsx')).toMatch(/useMarkSeenAfterDwell\(openedForSeen/);
    expect(source('NoteEditorModal.tsx')).toMatch(/useMarkSeenAfterDwell\(seenTarget/);
  });
});

describe('isOwnNote：哪些卡片算「我的」（浅蓝底、我的笔记）', () => {
  const note = (over: Record<string, unknown> = {}) => ({ authorId: 'me', author: '测试学生', type: 'note' as const, ...over });

  it('自己写的算，别人写的不算', () => {
    expect(isOwnNote(note(), 'me')).toBe(true);
    expect(isOwnNote(note({ authorId: 'other' }), 'me')).toBe(false);
  });

  it('AI 写的不算，哪怕记在我名下（采纳反馈发布的笔记 author_id 是学生）', () => {
    expect(isOwnNote(note({ isAiGenerated: true }), 'me')).toBe(false);
    expect(isOwnNote(note({ author: 'AI Partner' }), 'me')).toBe(false);
  });

  it('视图卡、没登录：不算', () => {
    expect(isOwnNote(note({ type: 'view' }), 'me')).toBe(false);
    expect(isOwnNote(note(), undefined)).toBe(false);
  });
});
