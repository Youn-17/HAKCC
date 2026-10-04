// @vitest-environment jsdom
/**
 * 建小组时教师也能进组（2026-09 用户要求）：右侧「待分配」里除了学生，还列出没进组的教师，
 * 拖进小组就成了组员；组里的教师名字旁标「教师」。
 * 原来「待分配」只列 role === 'student'，而且小组接口带回的成员一律当学生合并，会把组里教师的身份盖掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.hoisted(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'owner-1', name: '刘老师', email: 'owner@example.test', role: 'teacher' },
    loading: false, error: null, logout: () => undefined, applyUser: () => undefined, clearError: () => undefined,
  }),
}));

import GroupManagementModal from './GroupManagementModal';

const COURSE_ID = 'course-1';
const requests: Array<{ method: string; path: string; body: any }> = [];

function stubBackend() {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body });
    if (method === 'GET' && path === `/courses/${COURSE_ID}/groups`) {
      return json({ groups: [
        { id: 'group-a', name: '第一组', courseId: COURSE_ID, memberIds: ['student-a', 'teacher-in'],
          members: [{ id: 'student-a', name: '学生甲' }, { id: 'teacher-in', name: '王助教' }] },
      ] });
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/members`) {
      const m = (userId: string, name: string, role: string) => ({ userId, name, email: `${userId}@example.test`, role, courseRole: 'member', joinedAt: '2026-09-01T00:00:00Z' });
      return json({ members: [
        m('student-a', '学生甲', 'student'), m('student-b', '学生乙', 'student'),
        m('teacher-in', '王助教', 'teacher'), m('teacher-x', '李老师', 'teacher'),
      ], total: 4, viewerStanding: 'owner' });
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/trigger-settings`) return json({ settings: { experiment_mode: false } });
    return json({ ok: true });
  }));
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function settle(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function waitFor<T>(probe: () => T | null | undefined | false, label: string, timeout = 3000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value as T;
    if (Date.now() - started > timeout) throw new Error(`等不到：${label}`);
    await settle(10);
  }
}

const byText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('span, div, h3')).find(el => el.children.length === 0 && el.textContent?.trim() === text) ?? null;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  requests.length = 0;
  vi.unstubAllGlobals();
});

describe('教师也能进小组', () => {
  it('待分配里有「教师」一段；拖进小组就加成组员；组里的教师标着「教师」', async () => {
    stubBackend();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(React.createElement(GroupManagementModal, { isOpen: true, onClose: () => undefined, isStaff: true, lang: 'zh', courseId: COURSE_ID }));
    });
    await waitFor(() => byText('李老师'), '待分配里的教师');

    const page = document.body.textContent ?? '';
    expect(page).toContain('教师 · 1');
    expect(page).toContain('学生 · 1');
    // 组里的王助教：身份没被小组接口盖成学生，名字旁标着教师
    const inGroup = byText('王助教')!;
    expect(inGroup.parentElement!.textContent).toContain('教师');

    const card = byText('李老师')!.closest<HTMLElement>('[draggable="true"]')!;
    await act(async () => { card.dispatchEvent(new Event('dragstart', { bubbles: true })); });
    // 小组卡片整块都接放下（onDrop 挂在卡片最外层）；从组名往上冒泡到它
    const groupName = byText('第一组')!;
    await act(async () => { groupName.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })); });
    await waitFor(() => requests.some(r => r.method === 'POST' && r.path === '/groups/group-a/members'), '加组员的请求');
    expect(requests.find(r => r.path === '/groups/group-a/members')!.body).toEqual({ user_ids: ['teacher-x'] });
  });
});
