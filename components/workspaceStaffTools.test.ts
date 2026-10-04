// @vitest-environment jsdom
/**
 * 工作区里剩下那几件教职工具也按课内身份给（viewerStanding，随小组名单带回），不看平台身份。
 * 平台身份是教师不算数：凭学生验证码入课、或受邀还没设为课程管理员的教师账号，在这门课里是普通成员，
 * 原先照样看得到「成员」、支架的新建和隐藏、图灵测试的「设置与主持」、别人视图的改名删除，
 * 进一门还没有空间的课还会替它建空间，点下去全是 403。反过来，他收到的教师反馈打开了也不记已读。
 * 挂真 Workspace，看实际给了什么、发了什么请求。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent ?? ''; },
    set(value: string) { this.textContent = value; },
  });
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
const PEER_NOTE_ID = '00000000-0000-4000-8000-000000000001';
const OWN_NOTE_ID = '00000000-0000-4000-8000-000000000002';

type Standing = 'owner' | 'manager' | 'member';
interface Req { method: string; path: string; search: string }

/** standing 为 undefined 模拟旧版后端：小组名单里没有 viewerStanding */
function createBackend(standing: Standing | undefined, { withSpace = true } = {}) {
  const requests: Req[] = [];
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const note = (id: string, title: string, authorId: string, author: string) => ({
    id, space_id: SPACE_ID, author_id: authorId, type: 'note', title,
    content: `<p>${title}</p>`, x: id === OWN_NOTE_ID ? 600 : 200, y: 200, tags: [], views: [], cited_note_ids: [],
    created_at: '2026-09-20T08:00:00.000Z', updated_at: '2026-09-20T08:00:00.000Z', users: { name: author },
  });

  async function handle(method: string, path: string): Promise<Response> {
    if (method === 'GET' && path === `/courses/${COURSE_ID}/spaces`) {
      return json({ spaces: withSpace ? [{ id: SPACE_ID, course_id: COURSE_ID, title: '主讨论空间', inquiry_question: '问题' }] : [] });
    }
    if (method === 'POST' && path === `/courses/${COURSE_ID}/spaces`) {
      return json({ space: { id: 'space-new', course_id: COURSE_ID, title: '主讨论空间', inquiry_question: '我们共同讨论的问题' } }, 201);
    }
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/notes`) {
      return json({ notes: [
        note(PEER_NOTE_ID, '同学的观点', 'student-1', '同学甲'),
        note(OWN_NOTE_ID, '我自己的观点', USER.id, USER.name),
      ] });
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/groups`) {
      return json({
        groups: [{ id: 'group-a', name: '第一组', courseId: COURSE_ID, memberIds: ['student-1'], members: [{ id: 'student-1', name: '同学甲' }] }],
        ...(standing ? { viewerStanding: standing } : {}),
      });
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/scaffolds`) {
      // 旧版后端按平台身份把隐藏的也发给教师账号，这里照发，看前端挡不挡
      return json({
        requireScaffold: false,
        scaffoldExempt: standing === 'owner' || standing === 'manager',
        scaffolds: [
          { id: 'scaffold-1', title: '我的想法是', category: '知识建构/观点', steps: [], hidden: false, usageCount: 0, isMandatory: false, isRecommended: false, courseId: COURSE_ID },
          { id: 'scaffold-2', title: '这门课停用的话头', category: '知识建构/观点', steps: [], hidden: true, usageCount: 0, isMandatory: false, isRecommended: false, courseId: null },
        ],
      });
    }
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/views`) {
      return json({
        views: [{ id: 'view-1', spaceId: SPACE_ID, title: '同学的视图', creatorId: 'student-1', createdAt: '2026-09-20T08:00:00Z', lastModified: '2026-09-20T08:00:00Z' }],
        cards: [],
      });
    }
    if (method === 'GET' && path === `/turing-test/${COURSE_ID}`) {
      return json({ activities: [{ id: 'tt-1', title: '第一轮图灵测试', topic: '什么算智能', status: 'open', chat_minutes: 5, room_size: 6, ai_per_room: 1, joined_count: 0, judgment_count: 0, joined: false }] });
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/members`) {
      return json({
        members: [{ userId: 'student-1', name: '同学甲', email: 'student@example.test', role: 'student', courseRole: 'member' }],
        total: 1,
        viewerStanding: standing ?? 'owner',
      });
    }
    if (method === 'GET' && path === `/notes/${OWN_NOTE_ID}/feedback`) {
      return json({ feedbacks: [{
        id: 'fb-1', noteId: OWN_NOTE_ID, studentSummary: '论证还可以再具体一些。', teacherNote: null,
        publishedBy: '任课教师', publishedAt: '2026-09-21T08:00:00Z', isRead: false, createdAt: '2026-09-21T08:00:00Z',
      }] });
    }
    return json({
      notes: [], relations: [], spaces: [], notifications: [], scaffolds: [], views: [], cards: [],
      groups: [], rooms: [], shapes: [], configs: [], aiConfigs: [], conversations: [], messages: [],
      feedbacks: [], members: [], items: [], courses: [], sessions: [], activities: [], threads: [], ok: true,
    });
  }

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    requests.push({ method, path, search: url.search });
    return handle(method, path);
  });

  return { requests, fetchStub };
}

let backend: ReturnType<typeof createBackend>;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
/** 路由当前在哪（MemoryRouter 不改 window.location） */
let currentPath = '';

function LocationProbe() {
  const location = useLocation();
  currentPath = location.pathname + location.search;
  return null;
}

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
const buttonWith = (text: string) => all<HTMLButtonElement>('button').find(b => b.textContent?.includes(text)) ?? null;
const noteCard = (title: string) => all('.gsap-note-item *').find(el => el.children.length === 0 && el.textContent?.trim() === title) ?? null;
const sidebarTool = (label: string) => document.querySelector<HTMLButtonElement>(`aside button[aria-label="${label}"]`);
const sent = (method: string, path: string) => backend.requests.filter(r => r.method === method && r.path === path);
const groupsAnswered = () => sent('GET', `/courses/${COURSE_ID}/groups`).length > 0;

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function mountAs(
  standing: Standing | undefined,
  { withSpace = true, path = `/workspace/${COURSE_ID}` }: { withSpace?: boolean; path?: string } = {},
) {
  backend = createBackend(standing, { withSpace });
  vi.stubGlobal('fetch', backend.fetchStub);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(MemoryRouter, { initialEntries: [path] },
        React.createElement(Routes, null,
          React.createElement(Route, {
            path: '/workspace/:courseId/*',
            element: React.createElement(React.Fragment, null,
              React.createElement(Workspace, { userRole: USER.role, lang: 'zh', setLang: () => undefined }),
              React.createElement(LocationProbe),
            ),
          }),
        ),
      ),
    );
  });
  if (withSpace) await waitFor(() => noteCard('同学的观点'), '画布上的笔记');
  else await waitFor(() => sent('GET', `/courses/${COURSE_ID}/spaces`).length > 0, '空间列表');
  await waitFor(groupsAnswered, '小组名单');
  await settle(30);
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  currentPath = '';
  vi.unstubAllGlobals();
});

describe('侧栏的「成员」', () => {
  it('教师账号在这门课里只是普通成员：和学生一样没有这个入口', async () => {
    await mountAs('member');
    expect(sidebarTool('成员')).toBeNull();
    expect(sidebarTool('小组')).not.toBeNull();
  });

  it('课程管理员：有，点开是这门课的成员名单', async () => {
    await mountAs('manager');
    await click(sidebarTool('成员')!);
    await waitFor(() => document.body.textContent?.includes('student@example.test') && document.body.textContent.includes('成员管理'), '成员名单');
    expect(sent('GET', `/courses/${COURSE_ID}/members`)).toHaveLength(1);
  });

  it('旧版后端不带课内身份：按平台身份，和原来一样', async () => {
    await mountAs(undefined);
    expect(sidebarTool('成员')).not.toBeNull();
  });
});

describe('支架管理', () => {
  const openScaffolds = async () => {
    await click(sidebarTool('Scaffold')!);
    await waitFor(() => document.body.textContent?.includes('支架管理'), '支架管理弹窗');
  };
  const policySwitch = () => all('[role="switch"]').find(el => el.textContent?.includes('强制使用支架')) ?? null;

  it('普通成员：只能查阅和插入，没有新建、强制开关，也看不到这门课隐藏掉的支架', async () => {
    await mountAs('member');
    await openScaffolds();
    expect(document.body.textContent).toContain('我的想法是');
    expect(document.body.textContent).not.toContain('这门课停用的话头');
    expect(buttonWith('新建支架')).toBeNull();
    expect(policySwitch()).toBeNull();
    expect(buttonWith('插入笔记')).not.toBeNull();
  });

  it('课程管理员：能新建、能开强制，隐藏的也列出来（好恢复）', async () => {
    await mountAs('manager');
    await openScaffolds();
    expect(buttonWith('新建支架')).not.toBeNull();
    expect(policySwitch()).not.toBeNull();
    expect(document.body.textContent).toContain('这门课停用的话头');
  });
});

describe('探究面板里的图灵测试', () => {
  const openInquiry = async () => {
    await click(sidebarTool('探究')!);
    return waitFor(() => buttonWith('第一轮图灵测试'), '活动列表');
  };

  it('普通成员：没有「设置与主持」，点活动进的是参加测试的那一页', async () => {
    await mountAs('member');
    const activity = await openInquiry();
    expect(buttonWith('设置与主持')).toBeNull();
    await click(activity);
    await waitFor(() => currentPath.includes('/turing-test'), '跳转');
    expect(currentPath).toBe(`/workspace/${COURSE_ID}/turing-test/tt-1`);
  });

  it('课程管理员：有「设置与主持」，点活动进的是主持页', async () => {
    await mountAs('manager');
    const activity = await openInquiry();
    expect(buttonWith('设置与主持')).not.toBeNull();
    await click(activity);
    await waitFor(() => currentPath.includes('/turing-test'), '跳转');
    expect(currentPath).toBe(`/workspace/${COURSE_ID}/turing-test?activity=tt-1`);
  });
});

describe('视图面板：别人建的视图', () => {
  const openViews = async () => {
    await click(sidebarTool('视图')!);
    await waitFor(() => buttonWith('同学的视图'), '视图列表');
  };

  it('普通成员：不给改名、删除（后端只认创建者和课程教职）', async () => {
    await mountAs('member');
    await openViews();
    expect(document.querySelector('[aria-label="改名"]')).toBeNull();
    expect(document.querySelector('[aria-label="删除视图"]')).toBeNull();
  });

  it('课程管理员：可以', async () => {
    await mountAs('manager');
    await openViews();
    expect(document.querySelector('[aria-label="改名"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="删除视图"]')).not.toBeNull();
  });
});

describe('课里一个空间都没有：只有创建者（和平台管理员）替它建默认空间', () => {
  const creates = () => sent('POST', `/courses/${COURSE_ID}/spaces`);

  it('课程创建者：建', async () => {
    await mountAs('owner', { withSpace: false });
    await waitFor(() => creates().length > 0, '建空间请求');
    expect(creates()).toHaveLength(1);
  });

  it('课程管理员：不建（后端也不让）', async () => {
    await mountAs('manager', { withSpace: false });
    await settle(50);
    expect(creates()).toHaveLength(0);
  });

  it('教师账号在这门课里只是普通成员：不建', async () => {
    await mountAs('member', { withSpace: false });
    await settle(50);
    expect(creates()).toHaveLength(0);
  });

  it('旧版后端不带课内身份：按平台身份建，和原来一样', async () => {
    await mountAs(undefined, { withSpace: false });
    await waitFor(() => creates().length > 0, '建空间请求');
    expect(creates()).toHaveLength(1);
  });
});

describe('自己笔记上的教师反馈：打开就记已读', () => {
  const readMarks = () => sent('PATCH', `/notes/${OWN_NOTE_ID}/feedback/fb-1/read`);
  const openOwnNote = async (standing: Standing) => {
    await mountAs(standing, { path: `/workspace/${COURSE_ID}/note/${OWN_NOTE_ID}` });
    await waitFor(() => sent('GET', `/notes/${OWN_NOTE_ID}/feedback`).length > 0, '读反馈');
  };

  it('教师账号在这门课里只是普通成员（这门课的学生）：记已读', async () => {
    await openOwnNote('member');
    await waitFor(() => readMarks().length > 0, '已读请求');
    expect(readMarks()).toHaveLength(1);
  });

  it('课程管理员看笔记：不替作者记已读', async () => {
    await openOwnNote('manager');
    await settle(80);
    expect(readMarks()).toHaveLength(0);
  });
});
