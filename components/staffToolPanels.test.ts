// @vitest-environment jsdom
/**
 * AI 研究助手侧栏和成员管理弹窗按课内身份（isStaff）决定给谁什么，不再读平台身份。
 * 教师账号在这门课里只是普通成员时，他是这门课的学生：侧栏给学生那一侧（自己收到的反馈，
 * 打开即记已读），不给「AI 生成反馈」（后端 403）；成员管理打不开。
 *
 * 旧版组件读的是 userRole，所以这里照旧传一个教师账号的 userRole：现在它不该再起作用。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

import AISidePanel from './AISidePanel';
import MemberManagementModal from './MemberManagementModal';
import type { Note } from '../types';

const NOTE_ID = 'note-own';
/** 平台身份是教师的账号。组件不该再看它 */
const teacherAccount = { userRole: 'teacher' as const };

interface Req { method: string; path: string }
let requests: Req[] = [];
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function stubBackend() {
  requests = [];
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    requests.push({ method, path });
    if (method === 'GET' && path === `/notes/${NOTE_ID}/feedback`) {
      return json({ feedbacks: [{
        id: 'fb-1', noteId: NOTE_ID, studentSummary: '论证还可以再具体一些。', teacherNote: null,
        publishedBy: '任课教师', publishedAt: '2026-09-21T08:00:00Z', isRead: false, createdAt: '2026-09-21T08:00:00Z',
      }] });
    }
    if (method === 'GET' && path === '/courses/course-1/members') {
      return json({ members: [], total: 0, viewerStanding: 'member' });
    }
    return json({ ok: true, success: true, members: [], logins: [] });
  }));
}

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

async function render(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(element); });
}

const buttonWith = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text)) ?? null;
const sent = (method: string, path: string) => requests.filter(r => r.method === method && r.path === path);

const ownNote = {
  id: NOTE_ID, type: 'note', title: '我自己的观点', author: '教师账号', authorId: 'teacher-1',
  content: '<p>我自己的观点</p>', x: 0, y: 0, date: '2026-09-20 08:00', unreadFeedback: true,
} as Note;

async function openPanel(isStaff: boolean) {
  stubBackend();
  await render(React.createElement(AISidePanel, {
    ...teacherAccount,
    isOpen: true, onClose: () => undefined, notes: [ownNote], edges: [], selectedNote: ownNote,
    isStaff, lang: 'zh', spaceId: 'space-1', courseId: 'course-1', userId: 'teacher-1',
  }));
  await waitFor(() => sent('GET', `/notes/${NOTE_ID}/feedback`).length > 0, '读反馈');
  await settle(30);
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('AI 研究助手侧栏', () => {
  it('教师账号在这门课里只是普通成员：看到的是学生那一侧，自己收到的反馈打开即记已读', async () => {
    await openPanel(false);
    expect(document.body.textContent).toContain('已发布的反馈');
    expect(document.body.textContent).toContain('论证还可以再具体一些。');
    expect(buttonWith('AI 生成反馈')).toBeNull();
    expect(sent('PATCH', `/notes/${NOTE_ID}/feedback/fb-1/read`)).toHaveLength(1);
  });

  it('课程教职：给生成反馈，不替作者记已读', async () => {
    await openPanel(true);
    expect(buttonWith('AI 生成反馈')).not.toBeNull();
    expect(sent('PATCH', `/notes/${NOTE_ID}/feedback/fb-1/read`)).toHaveLength(0);
  });
});

describe('成员管理弹窗', () => {
  it('不是课程教职：打不开，也不去拉成员名单', async () => {
    stubBackend();
    await render(React.createElement(MemoryRouter, null,
      React.createElement(MemberManagementModal, {
        ...teacherAccount, isOpen: true, onClose: () => undefined, isStaff: false, lang: 'zh', courseId: 'course-1',
      }),
    ));
    await settle(30);
    expect(document.body.textContent).toContain('成员管理只对这门课的创建者和课程管理员开放');
    expect(sent('GET', '/courses/course-1/members')).toHaveLength(0);
  });
});
