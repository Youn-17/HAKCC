import { describe, expect, it } from 'vitest';
import { apiNoteToNote, applyPendingGeometry, PENDING_GEOMETRY_TTL, type PendingGeometry } from './useSpaceData';
import type { ApiNote } from '../services/apiClient';
import type { Note } from '../types';

/**
 * 拖动后「卡片自己弹回原位」的回归测试。
 *
 * 成因：保存是发了就不管的，而 Realtime 每次写入都会触发一次全量重拉。
 * 只要那次 GET 在写入提交之前读了库，回来的就是旧坐标，一合并卡片就被拽回去。
 */
const serverNote = (over: Partial<Note> = {}): Note => ({
  id: 'note-1', type: 'note', title: 't', author: 'a',
  date: '2026/9/6', x: 200, y: 200, ...over,
});

const NOW = 1_000_000;

describe('applyPendingGeometry', () => {
  it('保护期内：服务器返回旧坐标时保住本地位置', () => {
    const pending = new Map<string, PendingGeometry>([
      ['note-1', { x: 500, y: 360, at: NOW - 1000 }],
    ]);
    const merged = applyPendingGeometry(serverNote(), pending, NOW);
    expect(merged.x).toBe(500);
    expect(merged.y).toBe(360);
    // 还没确认，保护继续
    expect(pending.has('note-1')).toBe(true);
  });

  it('服务器已回显新坐标：解除保护，之后以服务器为准', () => {
    const pending = new Map<string, PendingGeometry>([
      ['note-1', { x: 500, y: 360, at: NOW - 1000 }],
    ]);
    const merged = applyPendingGeometry(serverNote({ x: 500, y: 360 }), pending, NOW);
    expect(merged.x).toBe(500);
    expect(pending.has('note-1')).toBe(false);
  });

  it('double precision 往返的末位偏差仍算作已确认', () => {
    const pending = new Map<string, PendingGeometry>([
      ['note-1', { x: 500.0000001, y: 360, at: NOW - 1000 }],
    ]);
    applyPendingGeometry(serverNote({ x: 500, y: 360 }), pending, NOW);
    expect(pending.has('note-1')).toBe(false);
  });

  it('超过保护期：交还给服务器，不让本地和服务器永久分叉', () => {
    const pending = new Map<string, PendingGeometry>([
      ['note-1', { x: 500, y: 360, at: NOW - PENDING_GEOMETRY_TTL - 1 }],
    ]);
    const merged = applyPendingGeometry(serverNote({ x: 1200, y: 900 }), pending, NOW);
    expect(merged.x).toBe(1200);
    expect(merged.y).toBe(900);
    expect(pending.has('note-1')).toBe(false);
  });

  it('尺寸同样受保护，且不会污染没有待确认记录的笔记', () => {
    const pending = new Map<string, PendingGeometry>([
      ['note-1', { x: 200, y: 200, width: 320, height: 240, at: NOW }],
    ]);
    const resized = applyPendingGeometry(serverNote({ width: 200, height: 140 }), pending, NOW);
    expect(resized.width).toBe(320);
    expect(resized.height).toBe(240);

    const untouched = serverNote({ id: 'note-2', x: 77, y: 88 });
    expect(applyPendingGeometry(untouched, pending, NOW)).toBe(untouched);
  });
});

describe('apiNoteToNote 的未读教师反馈', () => {
  const apiNote = (over: Record<string, unknown> = {}) => ({
    id: 'note-1', space_id: 'space-1', author_id: 'user-1', type: 'note', title: 't',
    content: '<p>x</p>', x: 0, y: 0, created_at: '2026-09-28T00:00:00Z', ...over,
  }) as unknown as ApiNote;

  it('读笔记列表接口给的 unread_feedback', () => {
    expect(apiNoteToNote(apiNote({ unread_feedback: true })).unreadFeedback).toBe(true);
    expect(apiNoteToNote(apiNote({ unread_feedback: false })).unreadFeedback).toBe(false);
  });

  it('没有这个字段时按随笔记带回的反馈判断', () => {
    expect(apiNoteToNote(apiNote({ feedbacks: [{ id: 'f', isRead: false }] })).unreadFeedback).toBe(true);
    expect(apiNoteToNote(apiNote()).unreadFeedback).toBeUndefined();
  });
});
