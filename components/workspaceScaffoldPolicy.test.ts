// @vitest-environment jsdom
/**
 * 「强制使用支架」只管学生。v1.24 更新日志承诺教师可以写不带支架的示范笔记，
 * 编辑器却只放过了综合升华笔记，教师照样被拦。
 *
 * 豁免按课内身份算（开课教师、课程管理员、平台管理员），由后端随支架列表返回
 * scaffoldExempt。这里挂真 Workspace + NoteEditorModal，按操作点下去看「贡献」
 * 有没有真的发出建笔记的请求：
 *   - 学生：被拦，提示要用支架；
 *   - 后端判定豁免的教师：直接保存；
 *   - 平台角色是教师、但在这门课里只是普通成员（后端判定不豁免）：照样被拦。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  return { id: 'user-1', name: '测试用户', email: 'user@example.test', role: 'student' as 'student' | 'teacher' };
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
const PARENT_ID = '00000000-0000-4000-8000-000000000001';

interface Req { method: string; path: string; body: any }

function createBackend(scaffoldExempt: boolean) {
  const requests: Req[] = [];
  let seq = 100;
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  const note = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, space_id: SPACE_ID, author_id: 'user-2', type: 'note', title,
    content: `<p>${title}</p>`, x: 200, y: 200, tags: [], views: [], cited_note_ids: [],
    created_at: '2026-09-20T08:00:00.000Z', updated_at: '2026-09-20T08:00:00.000Z',
    users: { name: '同学甲' }, ...extra,
  });

  async function handle(method: string, path: string, body: any): Promise<Response> {
    if (method === 'GET' && path === `/courses/${COURSE_ID}/spaces`) {
      return json({ spaces: [{ id: SPACE_ID, course_id: COURSE_ID, title: '主讨论空间', inquiry_question: '问题' }] });
    }
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/notes`) return json({ notes: [note(PARENT_ID, '被接的观点')] });
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/relations`) return json({ relations: [] });
    if (method === 'POST' && path === `/spaces/${SPACE_ID}/notes`) {
      const id = `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;
      return json({ note: note(id, body.title, { author_id: USER.id, content: body.content, x: body.x, y: body.y }) }, 201);
    }
    if (method === 'POST' && path === '/relations') {
      return json({ relation: { id: `rel-${seq++}`, space_id: SPACE_ID, creator_id: USER.id, ...body } }, 201);
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/scaffolds`) {
      return json({
        requireScaffold: true,
        scaffoldExempt,
        scaffolds: [{
          id: 'scaffold-1', title: '我的想法是', category: 'idea', steps: [],
          usageCount: 0, isMandatory: false, isRecommended: false, createdAt: '2026-09-01T00:00:00Z',
        }],
      });
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
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body });
    return handle(method, path, body);
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
const buttonWith = (text: string) => all<HTMLButtonElement>('button').find(b => b.textContent?.includes(text)) ?? null;
const noteCard = (title: string) => all('.gsap-note-item *').find(el => el.children.length === 0 && el.textContent?.trim() === title) ?? null;

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function mountAs(role: 'student' | 'teacher', scaffoldExempt: boolean) {
  USER.role = role;
  backend = createBackend(scaffoldExempt);
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
            element: React.createElement(Workspace, { userRole: role, lang: 'zh', setLang: () => undefined }),
          }),
        ),
      ),
    );
  });
  await waitFor(() => noteCard('被接的观点'), '画布上的笔记');
  // 支架列表（连同 requireScaffold / scaffoldExempt）到了才开编辑器，否则测的是默认值
  await waitFor(() => backend.requests.some(r => r.path === `/courses/${COURSE_ID}/scaffolds`), '支架列表');
  await settle(20);
}

/** 右键笔记 → 建立于此 → 选关系 → 打开编辑器，写一段不带支架的正文，点「贡献」 */
async function contributeWithoutScaffold() {
  const card = noteCard('被接的观点')!;
  await act(async () => {
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
  });
  await click(await waitFor(() => buttonWith('建立于此 (Build-on)'), '右键菜单里的 Build-on'));
  await click(await waitFor(() => buttonWith('Question'), '关系类型'));
  await click(buttonWith('打开编辑器')!);
  const titleInput = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="标题"]'), '编辑器');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(titleInput, '示范笔记');
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const body = document.querySelector<HTMLElement>('[contenteditable][data-placeholder]')!;
  await act(async () => {
    body.innerHTML = '<p>这是一条没有支架的示范笔记。</p>';
    body.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(buttonWith('贡献')!);
  await settle(50);
}

const noteCreates = () => backend.requests.filter(r => r.method === 'POST' && r.path === `/spaces/${SPACE_ID}/notes`);
const blockedMessage = () => document.body.textContent?.includes('这门课要求每条笔记至少使用一条支架') ?? false;

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('强制使用支架只管学生', () => {
  it('学生：没有支架的笔记被拦下，不发建笔记请求', async () => {
    await mountAs('student', false);
    await contributeWithoutScaffold();
    expect(blockedMessage()).toBe(true);
    expect(noteCreates()).toHaveLength(0);
  });

  it('开课教师 / 课程管理员（后端判定豁免）：不带支架也能保存示范笔记', async () => {
    await mountAs('teacher', true);
    await contributeWithoutScaffold();
    await waitFor(() => noteCreates().length === 1, '建笔记请求');
    expect(blockedMessage()).toBe(false);
    expect(noteCreates()[0].body.title).toBe('示范笔记');
  });

  it('教师账号但在这门课里只是普通成员（后端判定不豁免）：照样被拦', async () => {
    await mountAs('teacher', false);
    await contributeWithoutScaffold();
    expect(blockedMessage()).toBe(true);
    expect(noteCreates()).toHaveLength(0);
  });
});

describe('开关本身和「管不管这个人」是两回事', () => {
  it('支架管理弹窗里的开关显示课程级设置，只有编辑器拿扣除豁免后的值', () => {
    const src = readFileSync(resolve(__dirname, 'Workspace.tsx'), 'utf-8');
    const editorProps = src.slice(src.indexOf('<NoteEditorModal'), src.indexOf('/>', src.indexOf('<NoteEditorModal')));
    expect(editorProps).toContain('requireScaffold={requireScaffold && !scaffoldExempt}');
    const modalProps = src.slice(src.indexOf('<ScaffoldModal'), src.indexOf('/>', src.indexOf('<ScaffoldModal')));
    expect(modalProps).toContain('requireScaffold={requireScaffold}');
    expect(modalProps).not.toContain('scaffoldExempt');
  });
});
