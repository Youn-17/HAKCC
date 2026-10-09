// @vitest-environment jsdom
/**
 * 课程设置页的「学习目标」「学习任务」：挂真的 CourseSettingsPage，后端用假的 fetch。
 *
 * 原先的毛病：增删改失败只打到控制台；改完要把三个列表整个重取；按平台身份给所有教师显示
 * 增删改按钮；任务编辑每次都带上当前状态（后端拒收，改个标题都存不上）；截止时间把
 * datetime-local 的本地时间原样发出去（东八区晚 8 小时），回填时又截 UTC 的前 16 位；
 * 清空截止时间发的是 undefined，清不掉。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const USER = vi.hoisted(() => {
  // 截止时间的换算按东八区验：机器在 UTC 时，截 ISO 前 16 位的老写法碰巧也对
  process.env.TZ = 'Asia/Shanghai';
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { id: 'owner-1', name: '王老师', email: 'owner@example.test', role: 'teacher' as 'teacher' | 'student' | 'admin' };
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: USER, loading: false, error: null,
    logout: () => undefined, applyUser: () => undefined, clearError: () => undefined,
  }),
}));
vi.mock('../services/supabaseClient', () => ({ supabase: {} }));

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CourseSettingsPage from './courseSettings/CourseSettingsPage';

const COURSE = 'course-1';

interface Req { method: string; path: string; body: any }

interface BackendOptions {
  standing?: 'owner' | 'manager' | 'member';
  forbidden?: boolean;
}

function createBackend({ standing = 'owner', forbidden = false }: BackendOptions = {}) {
  const requests: Req[] = [];
  const state = { failCreateGoal: null as string | null, goneGoal: null as string | null, failSubmissions: false };
  let seq = 0;
  const createdBy = { id: 'owner-1', name: '王老师' };
  // 故意不按顺序给：页面自己排（高优先级在前，同一档按添加先后）
  const goals = [
    { id: 'g-low', courseId: COURSE, title: '按时参与讨论', description: null, priority: 0, createdAt: '2026-09-04T00:00:00.000Z', createdBy },
    { id: 'g-high', courseId: COURSE, title: '能在别人的观点上建构', description: '至少接续两位同学', priority: 2, createdAt: '2026-09-03T00:00:00.000Z', createdBy },
    { id: 'g-mid', courseId: COURSE, title: '读懂论证结构', description: null, priority: 1, createdAt: '2026-09-02T00:00:00.000Z', createdBy },
  ];
  const tasks = [
    {
      id: 't-report', courseId: COURSE, title: '读书报告', description: '写一篇 800 字的读书报告',
      dueDate: '2026-10-01T15:59:00+00:00', points: 100, status: 'published', createdBy,
      createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z',
      submissionStats: { total: 2, submitted: 2, graded: 1 },
    },
    {
      id: 't-draft', courseId: COURSE, title: '小组访谈', description: null, dueDate: null, points: 0, status: 'draft', createdBy,
      createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z',
      submissionStats: { total: 0, submitted: 0, graded: 0 },
    },
  ];

  const submissions = [
    {
      id: 's-a', taskId: 't-report', studentId: 'student-a', student: { id: 'student-a', name: '林晓' },
      content: '第一段\n第二段', fileUrl: 'javascript:alert(1)', fileName: 'report.docx', drawingData: null, videoUrl: null,
      submissionType: 'text', status: 'submitted', submittedAt: '2026-09-21T02:00:00.000Z', gradedAt: null,
      feedback: null, pointsAwarded: null,
    },
  ];

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  async function handle(method: string, path: string, body: any): Promise<Response> {
    if (forbidden && /^\/courses\/[^/]+\/(goals|tasks|materials)$/.test(path)) {
      return json({ error: 'You are not a member of this course' }, 403);
    }
    if (method === 'GET' && path === `/courses/${COURSE}`) {
      return json({ course: { id: COURSE, title: '知识建构', instructor_id: 'owner-1', tags: [], created_at: '2026-09-01T00:00:00Z' } });
    }
    if (method === 'GET' && path === `/courses/${COURSE}/stats`) return json({ studentCount: 3, spaceCount: 1, noteCount: 12 });
    if (method === 'GET' && path === `/courses/${COURSE}/materials`) return json({ materials: [] });

    if (path === `/courses/${COURSE}/goals`) {
      if (method === 'GET') return json({ goals, viewerStanding: standing });
      if (method === 'POST') {
        if (state.failCreateGoal) return json({ error: state.failCreateGoal }, 400);
        const goal = {
          id: `g-new-${++seq}`, courseId: COURSE, title: body.title, description: body.description ?? null,
          priority: body.priority ?? 0, createdAt: `2026-09-29T0${seq}:00:00.000Z`, createdBy,
        };
        goals.push(goal);
        return json({ goal }, 201);
      }
    }
    const goalOne = path.match(/^\/courses\/[^/]+\/goals\/([^/]+)$/);
    if (goalOne) {
      const goal = goals.find(g => g.id === goalOne[1]);
      if (!goal || state.goneGoal === goalOne[1]) return json({ error: '目标不存在，可能已被删除' }, 404);
      if (method === 'PUT') {
        Object.assign(goal, body);
        return json({ goal });
      }
      if (method === 'DELETE') {
        goals.splice(goals.indexOf(goal), 1);
        return json({ message: 'Goal deleted' });
      }
    }

    if (path === `/courses/${COURSE}/tasks`) {
      if (method === 'GET') return json({ tasks, viewerStanding: standing });
      if (method === 'POST') {
        const task = {
          id: `t-new-${++seq}`, courseId: COURSE, title: body.title, description: body.description ?? null,
          dueDate: body.due_date ?? null, points: body.points ?? 0, status: body.status ?? 'published', createdBy,
          createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
          submissionStats: { total: 0, submitted: 0, graded: 0 },
        };
        tasks.unshift(task);
        return json({ task }, 201);
      }
    }
    const taskOne = path.match(/^\/courses\/[^/]+\/tasks\/([^/]+)$/);
    if (taskOne && method === 'PUT') {
      const task = tasks.find(item => item.id === taskOne[1])!;
      if (body.title !== undefined) task.title = body.title;
      if (body.description !== undefined) task.description = body.description;
      if (body.due_date !== undefined) task.dueDate = body.due_date;
      if (body.points !== undefined) task.points = body.points;
      if (body.status !== undefined) task.status = body.status;
      return json({ task: { ...task } });
    }
    if (method === 'GET' && path === `/courses/${COURSE}/tasks/t-report/submissions`) {
      if (state.failSubmissions) return json({ error: 'Service temporarily unavailable, please retry' }, 503);
      return json({ submissions });
    }
    const subOne = path.match(/^\/courses\/[^/]+\/tasks\/t-report\/submissions\/([^/]+)$/);
    if (subOne && method === 'PUT') {
      const submission = submissions.find(s => s.id === subOne[1])!;
      Object.assign(submission, {
        feedback: body.feedback, pointsAwarded: body.points_awarded, status: body.status, gradedAt: '2026-09-29T03:00:00.000Z',
      });
      tasks[0].submissionStats = { total: 2, submitted: 2, graded: 2 };
      return json({ submission: { ...submission } });
    }
    return json({ error: `unexpected ${method} ${path}` }, 500);
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

const text = () => document.body.textContent ?? '';
const buttonWith = (label: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === label) ?? null;
const byLabel = <T extends Element = HTMLElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`);
const goalTitles = () => Array.from(document.querySelectorAll('li h4')).map(el => el.textContent);
const writes = () => backend.requests.filter(r => r.method !== 'GET');

async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
}

async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(tab: 'goals' | 'tasks', options?: BackendOptions) {
  backend = createBackend(options);
  vi.stubGlobal('fetch', backend.fetchStub);
  vi.stubGlobal('confirm', vi.fn(() => true));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(
      MemoryRouter,
      { initialEntries: [`/course/${COURSE}/settings?tab=${tab}`] },
      React.createElement(Routes, null,
        React.createElement(Route, {
          path: '/course/:courseId/settings',
          element: React.createElement(CourseSettingsPage, { lang: 'zh' }),
        }),
      ),
    ));
  });
  await waitFor(() => backend.requests.some(r => r.path === `/courses/${COURSE}/tasks`), '页面取完列表');
  await settle(20);
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('学习目标', () => {
  it('按优先级排好；新加的目标直接进列表，不再把三个列表整个重取', async () => {
    await mount('goals');
    await waitFor(() => goalTitles().length === 3, '目标列表');
    expect(goalTitles()).toEqual(['能在别人的观点上建构', '读懂论证结构', '按时参与讨论']);
    expect(text()).toContain('备课助手');

    await click(buttonWith('添加目标')!);
    await typeInto(byLabel<HTMLInputElement>('目标标题')!, '  提出可检验的问题 ');
    await typeInto(byLabel<HTMLTextAreaElement>('目标描述（选填）')!, '用自己的话写出假设');
    await click(buttonWith('高')!);
    const gets = backend.requests.filter(r => r.method === 'GET').length;
    await click(buttonWith('保存')!);

    await waitFor(() => goalTitles().includes('提出可检验的问题'), '新目标进列表');
    expect(writes()).toEqual([{
      method: 'POST', path: `/courses/${COURSE}/goals`,
      body: { title: '提出可检验的问题', description: '用自己的话写出假设', priority: 2 },
    }]);
    // 同为高优先级，后加的排在后面
    expect(goalTitles()).toEqual(['能在别人的观点上建构', '提出可检验的问题', '读懂论证结构', '按时参与讨论']);
    expect(backend.requests.filter(r => r.method === 'GET')).toHaveLength(gets);
    expect(byLabel('目标标题')).toBeNull();
  });

  it('保存失败：页面上写出原因，表单留着', async () => {
    await mount('goals');
    await waitFor(() => goalTitles().length === 3, '目标列表');
    backend.state.failCreateGoal = '目标标题最多 200 字';
    await click(buttonWith('添加目标')!);
    await typeInto(byLabel<HTMLInputElement>('目标标题')!, '一个目标');
    await click(buttonWith('保存')!);

    const alert = await waitFor(() => document.querySelector('[role="alert"]'), '失败提示');
    expect(alert.textContent).toBe('目标标题不能超过 200 字。');
    expect(byLabel<HTMLInputElement>('目标标题')?.value).toBe('一个目标');
    expect(goalTitles()).toHaveLength(3);
  });

  it('改和删：用接口返回的那条更新列表；已经被删掉的从列表里拿掉并说明', async () => {
    await mount('goals');
    await waitFor(() => goalTitles().length === 3, '目标列表');

    await click(byLabel('编辑目标 读懂论证结构')!);
    await typeInto(byLabel<HTMLInputElement>('目标标题')!, '读懂并复述论证结构');
    await click(buttonWith('保存')!);
    await waitFor(() => goalTitles().includes('读懂并复述论证结构'), '改后的标题');
    expect(writes().at(-1)).toEqual({
      method: 'PUT', path: `/courses/${COURSE}/goals/g-mid`,
      body: { title: '读懂并复述论证结构', description: null, priority: 1 },
    });

    await click(byLabel('删除目标 按时参与讨论')!);
    await waitFor(() => !goalTitles().includes('按时参与讨论'), '删掉的目标');
    expect(writes().at(-1)).toMatchObject({ method: 'DELETE', path: `/courses/${COURSE}/goals/g-low` });

    backend.state.goneGoal = 'g-high';
    await click(byLabel('删除目标 能在别人的观点上建构')!);
    await waitFor(() => text().includes('该目标已不存在'), '已不存在的说明');
    expect(goalTitles()).toEqual(['读懂并复述论证结构']);
  });

  // 2026-10-06 用户：课程管理只有创建者和课程管理员能进。以前普通成员能打开、只能看不能改
  it('课内只是普通成员：整页说明没有权限，看不到目标列表，也没有增删改', async () => {
    await mount('goals', { standing: 'member' });
    await waitFor(() => document.querySelector('[data-course-settings-denied]'), '没有权限的说明');
    expect(text()).toContain('暂无课程管理权限');
    expect(text()).toContain('课程管理仅对课程创建者和课程管理员开放');
    expect(goalTitles()).toEqual([]);
    expect(buttonWith('添加目标')).toBeNull();
    expect(buttonWith('返回首页')).not.toBeNull();
  });

  it('不在这门课里：同样是没有权限的整页说明', async () => {
    await mount('goals', { forbidden: true });
    await waitFor(() => document.querySelector('[data-course-settings-denied]'), '没有权限的说明');
    expect(buttonWith('添加目标')).toBeNull();
  });

  it('课程管理员进得来，增删改都在', async () => {
    await mount('goals', { standing: 'manager' });
    await waitFor(() => goalTitles().length === 3, '目标列表');
    expect(document.querySelector('[data-course-settings-denied]')).toBeNull();
    expect(buttonWith('添加目标')).not.toBeNull();
  });
});

describe('学习任务', () => {
  it('截止时间按本地时间回填；只改标题时只发标题，不带状态', async () => {
    await mount('tasks');
    await waitFor(() => text().includes('读书报告'), '任务列表');
    expect(text()).toContain('23:59');
    expect(text()).toContain('已提交 2 份 · 已批改 1 份');

    await click(byLabel('编辑任务 读书报告')!);
    const due = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    expect(due.value).toBe('2026-10-01T23:59');
    const status = document.querySelector<HTMLSelectElement>('select')!;
    expect(Array.from(status.options).map(o => o.value)).toEqual(['published', 'closed', 'draft']);

    await typeInto(byLabel<HTMLInputElement>('任务标题')!, '读书报告（修订）');
    await click(buttonWith('保存')!);
    await waitFor(() => text().includes('读书报告（修订）') && !byLabel('任务标题'), '改好的标题');
    expect(writes()).toEqual([{ method: 'PUT', path: `/courses/${COURSE}/tasks/t-report`, body: { title: '读书报告（修订）' } }]);
  });

  it('改截止时间发带时区的 ISO；清除截止时间发 null', async () => {
    await mount('tasks');
    await waitFor(() => text().includes('读书报告'), '任务列表');

    await click(byLabel('编辑任务 读书报告')!);
    await typeInto(document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!, '2026-10-08T20:00');
    await click(buttonWith('保存')!);
    await waitFor(() => !byLabel('任务标题'), '保存完成');
    expect(writes().at(-1)).toEqual({ method: 'PUT', path: `/courses/${COURSE}/tasks/t-report`, body: { due_date: '2026-10-08T12:00:00.000Z' } });

    await click(byLabel('编辑任务 读书报告')!);
    expect(document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!.value).toBe('2026-10-08T20:00');
    await click(buttonWith('清除截止时间')!);
    await click(buttonWith('保存')!);
    await waitFor(() => text().includes('未设置截止时间') && !byLabel('任务标题'), '清除截止时间');
    expect(writes().at(-1)).toEqual({ method: 'PUT', path: `/courses/${COURSE}/tasks/t-report`, body: { due_date: null } });
  });

  it('草稿的状态下拉只有保存得了的选项', async () => {
    await mount('tasks');
    await waitFor(() => text().includes('小组访谈'), '任务列表');
    await click(byLabel('编辑任务 小组访谈')!);
    const options = Array.from(document.querySelector<HTMLSelectElement>('select')!.options).map(o => o.value);
    expect(options).toEqual(['draft', 'published']);
  });

  it('布置任务：截止时间换成带时区的 ISO，新任务排在最前', async () => {
    await mount('tasks');
    await waitFor(() => text().includes('读书报告'), '任务列表');
    await click(buttonWith('布置任务')!);
    await typeInto(byLabel<HTMLInputElement>('任务标题')!, '实地观察记录');
    await typeInto(document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!, '2026-10-15T08:30');
    await typeInto(document.querySelector<HTMLInputElement>('input[type="number"]')!, '50');
    await click(buttonWith('保存')!);

    await waitFor(() => Array.from(document.querySelectorAll('li h4'))[0]?.textContent === '实地观察记录', '新任务在最前');
    expect(writes()).toEqual([{
      method: 'POST', path: `/courses/${COURSE}/tasks`,
      body: { title: '实地观察记录', description: null, due_date: '2026-10-15T00:30:00.000Z', points: 50, status: 'published' },
    }]);
  });

  it('分值填错：不发请求，页面上说明', async () => {
    await mount('tasks');
    await waitFor(() => text().includes('读书报告'), '任务列表');
    await click(buttonWith('布置任务')!);
    await typeInto(byLabel<HTMLInputElement>('任务标题')!, '实地观察记录');
    await typeInto(document.querySelector<HTMLInputElement>('input[type="number"]')!, '2.5');
    await click(buttonWith('保存')!);
    await waitFor(() => text().includes('分值须为 0–1000 的整数。'), '分值提示');
    expect(writes()).toEqual([]);
  });

  it('课内只是普通成员：从任务页签进来也一样没有权限，看不到任务', async () => {
    await mount('tasks', { standing: 'member' });
    await waitFor(() => document.querySelector('[data-course-settings-denied]'), '没有权限的说明');
    expect(text()).not.toContain('读书报告');
    expect(buttonWith('布置任务')).toBeNull();
  });
});

describe('批改学生提交', () => {
  async function openSubmissions() {
    await mount('tasks');
    await waitFor(() => text().includes('读书报告'), '任务列表');
    await click(byLabel('查看提交 读书报告')!);
    return waitFor(() => document.querySelector('[role="dialog"]'), '提交弹窗');
  }

  it('得分超过满分不发请求；保存后更新这一份，并重取任务列表里的统计', async () => {
    const dialog = await openSubmissions();
    await waitFor(() => dialog.textContent?.includes('林晓'), '学生的提交');
    expect(dialog.textContent).toContain('第一段');
    // javascript: 链接不做成可点的
    expect(dialog.querySelector('a')).toBeNull();

    const score = dialog.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(score.max).toBe('100');
    await typeInto(score, '120');
    await click(buttonWith('保存批改')!);
    await waitFor(() => dialog.textContent?.includes('得分须为 0–100 的整数。'), '得分提示');
    expect(writes()).toEqual([]);

    await typeInto(score, '88');
    await typeInto(dialog.querySelector<HTMLTextAreaElement>('textarea')!, '  证据再多一条 ');
    await click(buttonWith('保存批改')!);
    await waitFor(() => dialog.textContent?.includes('已保存'), '保存成功');
    expect(writes()).toEqual([{
      method: 'PUT', path: `/courses/${COURSE}/tasks/t-report/submissions/s-a`,
      body: { feedback: '证据再多一条', points_awarded: 88, status: 'graded' },
    }]);
    expect(dialog.textContent).toContain('已批改');
    expect(dialog.textContent).toContain('88 分');
    await waitFor(() => text().includes('已提交 2 份 · 已批改 2 份'), '任务列表的统计');
  });

  it('提交列表没取到：说出原因，不显示成「暂无学生提交」', async () => {
    await mount('tasks');
    backend.state.failSubmissions = true;
    await waitFor(() => text().includes('读书报告'), '任务列表');
    await click(byLabel('查看提交 读书报告')!);
    const dialog = await waitFor(() => document.querySelector('[role="dialog"]'), '提交弹窗');
    await waitFor(() => dialog.textContent?.includes('提交记录加载失败'), '失败提示');
    expect(dialog.textContent).not.toContain('暂无学生提交');
    expect(dialog.textContent).not.toContain('Service temporarily unavailable');
  });
});
