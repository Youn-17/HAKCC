// @vitest-environment jsdom
/**
 * 工作区里教职才有的操作按课内身份给，课内身份由后端随小组名单带回（viewerStanding）。
 * 平台身份是教师不算数：凭学生验证码入课的教师账号在这门课里是普通成员，
 * 原先右键照样能点「删除」别人的笔记（后端 403），观点图谱也会回落到别人的组（又一个 403）。
 * 挂真 Workspace，看右键菜单和观点图谱实际给了什么、发了什么请求。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const USER = vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*\d+px/.test(query) || /prefers-reduced-motion/.test(query),
    media: query,
    onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  Object.assign(globalThis, { ResizeObserver: NoopObserver, IntersectionObserver: NoopObserver });
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  Element.prototype.scrollTo = function scrollTo() {} as Element['scrollTo'];
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { id: 'teacher-1', name: '教师账号', email: 'teacher@example.test', role: 'teacher' as const };
});

vi.mock('../services/supabaseClient', () => {
  const channel: Record<string, unknown> = {};
  channel.on = () => channel;
  channel.subscribe = () => channel;
  return { supabase: { channel: () => channel, removeChannel: () => undefined } };
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: USER, loading: false, error: null,
    logout: () => undefined, applyUser: () => undefined, clearError: () => undefined,
  }),
}));

import Workspace from './Workspace';

const COURSE_ID = 'course-1';
const SPACE_ID = 'space-1';
const NOTE_ID = '00000000-0000-4000-8000-000000000001';

interface Req { method: string; path: string }

/** viewerStanding 为 undefined 模拟旧版后端：名单里没有这个字段 */
function createBackend(viewerStanding: 'owner' | 'manager' | 'member' | undefined) {
  const requests: Req[] = [];
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  async function handle(method: string, path: string): Promise<Response> {
    if (method === 'GET' && path === `/courses/${COURSE_ID}/spaces`) {
      return json({ spaces: [{ id: SPACE_ID, course_id: COURSE_ID, title: '主讨论空间', inquiry_question: '问题' }] });
    }
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/notes`) {
      return json({ notes: [{
        id: NOTE_ID, space_id: SPACE_ID, author_id: 'student-1', type: 'note', title: '同学的观点',
        content: '<p>同学的观点</p>', x: 200, y: 200, tags: [], views: [], cited_note_ids: [],
        created_at: '2026-09-20T08:00:00.000Z', updated_at: '2026-09-20T08:00:00.000Z', users: { name: '同学甲' },
      }] });
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/groups`) {
      return json({
        groups: [{ id: 'group-a', name: '第一组', courseId: COURSE_ID, memberIds: ['student-1'], members: [{ id: 'student-1', name: '同学甲' }] }],
        ...(viewerStanding ? { viewerStanding } : {}),
      });
    }
    if (method === 'GET' && path === '/groups/group-a/idea-graph') {
      return json({ graph: null, pending: true, needNotes: 5, haveNotes: 1, periodDays: 7, regenerated: false });
    }
    return json({
      notes: [], relations: [], spaces: [], notifications: [], scaffolds: [], views: [], cards: [],
      groups: [], rooms: [], shapes: [], configs: [], aiConfigs: [], conversations: [], messages: [],
      feedbacks: [], members: [], items: [], courses: [], sessions: [], ok: true,
    });
  }

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    requests.push({ method, path });
    return handle(method, path);
  });

  return { requests, fetchStub };
}

let backend: ReturnType<typeof createBackend>;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function settle(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function waitFor<T>(probe: () => T | null | undefined | false, label: string, timeout = 4000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value as T;
    if (Date.now() - started > timeout) throw new Error(`等不到：${label}`);
    await settle(10);
  }
}

const all = <T extends Element = HTMLElement>(selector: string) => Array.from(document.querySelectorAll<T>(selector));
const buttonWith = (text: string) => all<HTMLButtonElement>('button').find(b => b.textContent?.trim().endsWith(text)) ?? null;
const noteCard = (title: string) => all('.gsap-note-item *').find(el => el.children.length === 0 && el.textContent?.trim() === title) ?? null;

async function mountAs(viewerStanding: 'owner' | 'manager' | 'member' | undefined) {
  backend = createBackend(viewerStanding);
  vi.stubGlobal('fetch', backend.fetchStub);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(MemoryRouter, { initialEntries: [`/workspace/${COURSE_ID}`] },
        React.createElement(Routes, null,
          React.createElement(Route, {
            path: '/workspace/:courseId/*',
            element: React.createElement(Workspace, { userRole: USER.role, lang: 'zh', setLang: () => undefined }),
          }),
        ),
      ),
    );
  });
  await waitFor(() => noteCard('同学的观点'), '画布上的笔记');
  await waitFor(() => backend.requests.some(r => r.path === `/courses/${COURSE_ID}/groups`), '小组名单');
  await settle(30);
}

/** 右键同学的笔记，返回菜单里的删除按钮 */
async function deleteButtonInContextMenu() {
  const card = noteCard('同学的观点')!;
  await act(async () => {
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
  });
  return waitFor(() => buttonWith('仅作者可删除') ?? buttonWith('删除'), '右键菜单里的删除');
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('右键删除同学的笔记：按课内身份', () => {
  it('教师账号在这门课里只是普通成员：不给删', async () => {
    await mountAs('member');
    const button = await deleteButtonInContextMenu();
    expect(button.textContent).toContain('仅作者可删除');
    expect(button.disabled).toBe(true);
  });

  it('课程管理员：可以删', async () => {
    await mountAs('manager');
    const button = await deleteButtonInContextMenu();
    expect(button.textContent?.trim().endsWith('删除')).toBe(true);
    expect(button.textContent).not.toContain('仅作者');
    expect(button.disabled).toBe(false);
  });

  it('旧版后端不带课内身份：按平台身份，和原来一样', async () => {
    await mountAs(undefined);
    const button = await deleteButtonInContextMenu();
    expect(button.disabled).toBe(false);
  });
});

describe('观点图谱：普通成员不回落到别人的组', () => {
  const openIdeaGraph = async () => {
    const tool = await waitFor(() => document.querySelector<HTMLElement>('[aria-label="观点图谱"]'), '侧栏的观点图谱');
    await act(async () => { tool.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    await settle(30);
  };
  const graphRequests = () => backend.requests.filter(r => r.path.includes('/idea-graph'));

  it('教师账号在这门课里只是普通成员、又没分组：提示还没有分组，不去读别的组', async () => {
    await mountAs('member');
    await openIdeaGraph();
    await waitFor(() => document.body.textContent?.includes('还没有分组'), '没有分组的提示');
    expect(graphRequests()).toEqual([]);
  });

  it('课程创建者不在任何组里：先看第一个组', async () => {
    await mountAs('owner');
    await openIdeaGraph();
    await waitFor(() => graphRequests().length > 0, '读第一个组的图谱');
    expect(graphRequests()[0].path).toBe('/groups/group-a/idea-graph');
  });
});
