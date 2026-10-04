// @vitest-environment jsdom
/**
 * 小组管理弹窗按课内身份分两种人：
 *   - 课程教职（平台管理员、创建者、课程管理员）：建组、分组、实验设置，任务板可以逐组切换；
 *   - 其他人（学生、凭学生验证码入课或受邀未设管理员的教师账号）：只看自己组的任务板。
 * 原先按平台身份分：教师账号一律读第一个组的任务，不在那个组就是 403；
 * 任务的新建和改状态只改了本地状态、从不发请求，刷新就没了。
 * 这里挂真组件，看它实际发出了哪些请求。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const USER = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { id: 'teacher-joined', name: '入课的教师', email: 'teacher@example.test', role: 'teacher' as 'teacher' | 'student' };
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: USER, loading: false, error: null,
    logout: () => undefined, applyUser: () => undefined, clearError: () => undefined,
  }),
}));

import GroupManagementModal from './GroupManagementModal';

const COURSE_ID = 'course-1';

interface Req { method: string; path: string; body: any }

function createBackend() {
  const requests: Req[] = [];
  const state = { failPatch: false };
  const tasks: Record<string, any[]> = {
    'group-a': [{ id: 'task-a', groupId: 'group-a', title: '整理资料', createdById: 'student-a', status: 'todo', ssrlPhase: 'planning', createdAt: '2026-09-01T00:00:00Z' }],
    'group-b': [{ id: 'task-b', groupId: 'group-b', title: '写综述', createdById: 'student-b', status: 'todo', ssrlPhase: 'evaluating', createdAt: '2026-09-01T00:00:00Z' }],
  };
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  async function handle(method: string, path: string, body: any): Promise<Response> {
    if (method === 'GET' && path === `/courses/${COURSE_ID}/groups`) {
      return json({
        groups: [
          { id: 'group-a', name: '第一组', courseId: COURSE_ID, memberIds: ['student-a'], members: [{ id: 'student-a', name: '学生甲' }] },
          // 入课的教师在第二组：原先教师账号一律读第一个组，读的正是别人的组
          { id: 'group-b', name: '第二组', courseId: COURSE_ID, memberIds: ['student-b', 'teacher-joined'],
            members: [{ id: 'student-b', name: '学生乙' }, { id: 'teacher-joined', name: '入课的教师' }] },
        ],
      });
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/members`) {
      return json({ members: [], total: 0, viewerStanding: 'member' });
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/trigger-settings`) {
      return json({ settings: { experiment_mode: false } });
    }
    const list = path.match(/^\/groups\/([^/]+)\/tasks$/);
    if (list && method === 'GET') return json({ tasks: tasks[list[1]] ?? [] });
    if (list && method === 'POST') {
      // 真实后端建任务回的是数据库原始行（下划线字段），不是列表接口那种驼峰形状
      return json({ task: { id: 'task-new', group_id: list[1], title: body.title, status: 'todo', ssrl_phase: body.ssrl_phase, created_by_id: USER.id } }, 201);
    }
    const one = path.match(/^\/groups\/([^/]+)\/tasks\/([^/]+)$/);
    if (one && method === 'PATCH') {
      if (state.failPatch) return json({ error: 'Service temporarily unavailable, please retry' }, 503);
      return json({ task: { id: one[2], group_id: one[1], status: body.status } });
    }
    return json({ ok: true });
  }

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body });
    return handle(method, path, body);
  });

  return { requests, state, fetchStub };
}

let backend: ReturnType<typeof createBackend>;
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

const buttonWith = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().includes(text)) ?? null;
const text = () => document.body.textContent ?? '';
const taskRequests = () => backend.requests.filter(r => /^\/groups\/[^/]+\/tasks/.test(r.path));

async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
}

async function mountAs(userId: string, isStaff: boolean) {
  USER.id = userId;
  backend = createBackend();
  vi.stubGlobal('fetch', backend.fetchStub);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(GroupManagementModal, {
      isOpen: true, onClose: () => undefined, isStaff, lang: 'zh', courseId: COURSE_ID,
    }));
  });
  await waitFor(() => backend.requests.some(r => r.path === `/courses/${COURSE_ID}/groups`), '小组名单');
  await settle(20);
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('普通成员：只看自己组的任务板', () => {
  it('凭学生验证码入课的教师账号：只取本组任务，看不到建组和实验设置', async () => {
    await mountAs('teacher-joined', false);
    await waitFor(() => text().includes('写综述'), '本组的任务');
    expect(taskRequests().map(r => `${r.method} ${r.path}`)).toEqual(['GET /groups/group-b/tasks']);
    expect(text()).not.toContain('整理资料');
    expect(buttonWith('创建新小组')).toBeNull();
    expect(buttonWith('实验设置')).toBeNull();
    expect(backend.requests.some(r => r.path.endsWith('/trigger-settings'))).toBe(false);
  });

  it('没分组的：一个任务请求都不发，直接说没有小组', async () => {
    await mountAs('teacher-invited', false);
    await waitFor(() => text().includes('您尚未加入任何小组'), '没有小组的提示');
    expect(taskRequests()).toEqual([]);
  });

  it('发布任务真的建到服务器上', async () => {
    await mountAs('teacher-joined', false);
    await waitFor(() => text().includes('写综述'), '本组的任务');
    await click(buttonWith('添加任务')!);
    const title = await waitFor(() => document.querySelector<HTMLInputElement>('input[placeholder="任务标题"]'), '任务表单');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(title, '找三篇实证研究');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonWith('发布任务')!);
    await waitFor(() => text().includes('找三篇实证研究') && !document.querySelector('input[placeholder="任务标题"]'), '新任务上板');

    const creates = taskRequests().filter(r => r.method === 'POST');
    expect(creates).toHaveLength(1);
    expect(creates[0].path).toBe('/groups/group-b/tasks');
    expect(creates[0].body).toMatchObject({ title: '找三篇实证研究', ssrl_phase: 'planning', assigned_to_id: 'teacher-joined' });
  });

  it('改状态发 PATCH；服务器没存上就退回原状态并说明', async () => {
    await mountAs('teacher-joined', false);
    await waitFor(() => text().includes('写综述'), '本组的任务');

    await click(buttonWith('待办')!);
    await waitFor(() => buttonWith('进行中'), '状态变成进行中');
    await settle(20);
    expect(taskRequests().filter(r => r.method === 'PATCH')).toEqual([
      { method: 'PATCH', path: '/groups/group-b/tasks/task-b', body: { status: 'in_progress' } },
    ]);

    backend.state.failPatch = true;
    await click(buttonWith('进行中')!);
    await waitFor(() => text().includes('任务状态没有改成功'), '失败提示');
    expect(buttonWith('进行中')).not.toBeNull();
    expect(buttonWith('完成')).toBeNull();
  });
});

describe('课程教职：管理小组，任务板逐组切换', () => {
  it('概览是建组分组，有实验设置；任务板默认第一个组，可以切到别的组', async () => {
    await mountAs('owner-1', true);
    await waitFor(() => buttonWith('创建新小组'), '建组');
    expect(buttonWith('实验设置')).not.toBeNull();
    expect(backend.requests.some(r => r.path === `/courses/${COURSE_ID}/trigger-settings`)).toBe(true);

    await click(buttonWith('协作任务 (SSRL)')!);
    await waitFor(() => text().includes('整理资料'), '第一个组的任务');
    const picker = document.querySelector<HTMLSelectElement>('select')!;
    expect(Array.from(picker.options).map(o => o.textContent)).toEqual(['第一组', '第二组']);

    await act(async () => {
      picker.value = 'group-b';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => text().includes('写综述'), '第二组的任务');
    expect(text()).not.toContain('整理资料');
    expect(taskRequests().map(r => `${r.method} ${r.path}`)).toEqual(['GET /groups/group-a/tasks', 'GET /groups/group-b/tasks']);
  });
});
