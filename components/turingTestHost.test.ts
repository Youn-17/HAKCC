// @vitest-environment jsdom
/**
 * 图灵测试两页按课内身份分「主持方」和「参加的人」，由后端随 /me 和列表带回 host。
 * 平台身份是教师不算数：凭学生验证码入课的教师账号在这门课里是参加测试的人，
 * 原先活动页不给他「进入活动」、只给一个进去全是 403 的「设置与主持」。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const USER = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { id: 'teacher-1', name: '教师账号', email: 'teacher@example.test', role: 'teacher' as const };
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: USER, loading: false, error: null,
    logout: () => undefined, applyUser: () => undefined, clearError: () => undefined,
  }),
}));

import TuringTestActivity from './TuringTestActivity';
import TuringTestManage from './TuringTestManage';

const COURSE_ID = 'course-1';
const ACTIVITY_ID = 'tt-1';

interface Req { method: string; path: string }
let requests: Req[] = [];
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let currentPath = '';

function LocationProbe() {
  const location = useLocation();
  currentPath = location.pathname + location.search;
  return null;
}

/** host 为 undefined 模拟旧版后端：不带这个字段 */
function stubBackend(hostFlag: boolean | undefined) {
  requests = [];
  const withHost = (body: Record<string, unknown>) => (hostFlag === undefined ? body : { ...body, host: hostFlag });
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    requests.push({ method, path });
    if (method === 'GET' && path === `/turing-test/${COURSE_ID}/${ACTIVITY_ID}/me`) {
      return json(withHost({
        activity: {
          id: ACTIVITY_ID, title: '第一轮图灵测试', topic: '什么算智能', instructions: '先聊五分钟，再判断。',
          status: 'open', chat_minutes: 5, started_at: null, ends_at: null, disclose_ai_count: true,
        },
        joined: false, in_room: false, room: null, messages: [], judgment: null,
        can_chat: false, can_vote: false, server_time: new Date().toISOString(),
      }));
    }
    if (method === 'GET' && path === `/turing-test/${COURSE_ID}`) {
      return json(withHost({ activities: [] }));
    }
    if (method === 'GET' && path === '/ai/model-catalog') {
      return json({ dmx: { text: [], vision: [] }, native: {} });
    }
    return json({ ok: true, configs: [] });
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

const buttonWith = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text)) ?? null;

async function mountAt(path: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(MemoryRouter, { initialEntries: [path] },
        React.createElement(LocationProbe),
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/workspace/:courseId', element: React.createElement('p', null, '知识空间') }),
          React.createElement(Route, { path: '/workspace/:courseId/turing-test', element: React.createElement(TuringTestManage, { lang: 'zh' }) }),
          React.createElement(Route, { path: '/workspace/:courseId/turing-test/:activityId', element: React.createElement(TuringTestActivity, { lang: 'zh' }) }),
        ),
      ),
    );
  });
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  currentPath = '';
  vi.unstubAllGlobals();
});

describe('活动页：进入活动还是去设置与主持', () => {
  const openActivity = async (hostFlag: boolean | undefined) => {
    stubBackend(hostFlag);
    await mountAt(`/workspace/${COURSE_ID}/turing-test/${ACTIVITY_ID}`);
    await waitFor(() => document.body.textContent?.includes('先聊五分钟'), '活动说明');
  };

  it('教师账号在这门课里只是普通成员（host=false）：能进入活动，没有设置与主持', async () => {
    await openActivity(false);
    expect(buttonWith('教师请到「设置与主持」')).toBeNull();
    await act(async () => { buttonWith('进入活动')!.click(); });
    await waitFor(() => requests.some(r => r.method === 'POST' && r.path === `/turing-test/${COURSE_ID}/${ACTIVITY_ID}/join`), '进入请求');
  });

  it('主持方（host=true）：去设置与主持，不进入', async () => {
    await openActivity(true);
    expect(buttonWith('教师请到「设置与主持」')).not.toBeNull();
    expect(buttonWith('进入活动')).toBeNull();
  });

  it('旧版后端不带 host：按平台身份，和原来一样', async () => {
    await openActivity(undefined);
    expect(buttonWith('教师请到「设置与主持」')).not.toBeNull();
    expect(buttonWith('进入活动')).toBeNull();
  });
});

describe('设置与主持页：不是主持方就送回知识空间', () => {
  it('host=false：回到知识空间', async () => {
    stubBackend(false);
    await mountAt(`/workspace/${COURSE_ID}/turing-test`);
    await waitFor(() => currentPath === `/workspace/${COURSE_ID}`, '回到知识空间');
  });

  it('host=true：留在这一页', async () => {
    stubBackend(true);
    await mountAt(`/workspace/${COURSE_ID}/turing-test`);
    await waitFor(() => requests.some(r => r.path === `/turing-test/${COURSE_ID}`), '活动列表');
    await settle(30);
    expect(currentPath).toBe(`/workspace/${COURSE_ID}/turing-test`);
  });
});
