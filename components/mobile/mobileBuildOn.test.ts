// @vitest-environment jsdom
/**
 * 手机上在别人的笔记上 Build-on（2026-09 课堂反馈：手机端没法在别人的笔记上建新笔记）。
 * 挂真的 MobileWorkspace + NoteEditorModal，屏幕按手机宽度（没有 min-width 断点），后端换成进程内的假服务。
 *
 *   - 点开同学的笔记：只能读，右下角 Build-on 弹出六种方式；
 *   - 选一种：换成新的 Build-on 草稿，原笔记默认展开在最上层，可以收起；
 *   - 贡献：建一条笔记（摆在原笔记旁边）和一条对应的关系，只建一次；
 *   - 关掉不写：什么都不留（手机端普通新建会先建一条「新笔记」，Build-on 不这样）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const USER = vi.hoisted(() => {
  // 手机屏：min-width 断点都不成立，AI 助手和原笔记都是盖在编辑器上的一层
  window.matchMedia = ((query: string) => ({
    matches: /prefers-reduced-motion/.test(query),
    media: query,
    onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  Object.assign(globalThis, { ResizeObserver: NoopObserver, IntersectionObserver: NoopObserver, IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  Element.prototype.scrollTo = function scrollTo() {} as Element['scrollTo'];
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent ?? ''; },
    set(value: string) { this.textContent = value; },
  });
  return { id: 'user-1', name: '测试学生', email: 'student@example.test', role: 'student' };
});

vi.mock('../../services/supabaseClient', () => {
  const channel: Record<string, unknown> = {};
  channel.on = () => channel;
  channel.subscribe = () => channel;
  return { supabase: { channel: () => channel, removeChannel: () => undefined } };
});

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: USER, loading: false, error: null,
    logout: () => undefined, applyUser: () => undefined, clearError: () => undefined,
  }),
}));

import MobileWorkspace from './MobileWorkspace';

const COURSE_ID = 'course-1';
const SPACE_ID = 'space-1';
const PARENT_ID = '00000000-0000-4000-8000-000000000001';

interface Req { method: string; path: string; body: any }

function apiNote(id: string, title: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return {
    id, space_id: SPACE_ID, author_id: 'user-2', type: 'note', title,
    content: `<p>${title}的正文</p>`, x, y, tags: [], views: ['view-1'], cited_note_ids: [],
    created_at: '2026-09-28T14:00:00.000Z', updated_at: '2026-09-28T14:00:00.000Z',
    users: { name: '同学甲' }, ...extra,
  };
}

function createBackend() {
  const state = {
    requests: [] as Req[],
    notes: [apiNote(PARENT_ID, '学生与AI如何互动', 200, 200)] as any[],
    relations: [] as any[],
    seq: 100,
  };
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const nextId = () => `00000000-0000-4000-8000-${String(state.seq++).padStart(12, '0')}`;

  async function handle(method: string, path: string, body: any): Promise<Response> {
    if (method === 'GET' && path === `/courses/${COURSE_ID}/spaces`) {
      return json({ spaces: [{ id: SPACE_ID, course_id: COURSE_ID, title: '主讨论空间', inquiry_question: '学生与 AI 怎样互动' }] });
    }
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/notes`) return json({ notes: state.notes });
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/relations`) return json({ relations: state.relations });
    if (method === 'POST' && path === `/spaces/${SPACE_ID}/notes`) {
      const note = apiNote(nextId(), body.title, body.x, body.y, {
        author_id: USER.id, content: body.content, views: body.views ?? [], users: { name: USER.name },
      });
      state.notes.push(note);
      return json({ note }, 201);
    }
    const noteMatch = path.match(/^\/notes\/([^/]+)$/);
    if (method === 'PUT' && noteMatch) {
      const note = state.notes.find(n => n.id === noteMatch[1]);
      Object.assign(note ?? {}, body);
      return json({ note });
    }
    if (method === 'POST' && path === '/relations') {
      const relation = { id: nextId(), space_id: SPACE_ID, creator_id: USER.id, ai_suggested: false, created_at: new Date().toISOString(), ...body };
      state.relations.push(relation);
      return json({ relation }, 201);
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
    state.requests.push({ method, path, body });
    return handle(method, path, body);
  });
  return { state, fetchStub };
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
const parentPanel = () => document.querySelector<HTMLElement>('aside[aria-label="你在回应的笔记"]');
const editorOpen = () => Boolean(document.querySelector('input[aria-label="标题"]'));
const noteCreates = () => backend.state.requests.filter(r => r.method === 'POST' && r.path === `/spaces/${SPACE_ID}/notes`);
const relationCreates = () => backend.state.requests.filter(r => r.method === 'POST' && r.path === '/relations');

async function click(el: Element) {
  await act(async () => { (el as HTMLElement).click(); });
}

async function typeInto(el: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mountAndOpenClassmateNote() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(MemoryRouter, { initialEntries: [`/workspace/${COURSE_ID}`] },
        React.createElement(Routes, null,
          React.createElement(Route, {
            path: '/workspace/:courseId/*',
            element: React.createElement(MobileWorkspace, { userRole: 'student', lang: 'zh', setLang: () => undefined }),
          }),
        ),
      ),
    );
  });
  await click(await waitFor(() => buttonWith('学生与AI如何互动'), '列表里同学的笔记'));
  await waitFor(() => editorOpen(), '笔记页');
}

async function chooseBuildOn(label: string) {
  await click(document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!);
  const item = all<HTMLButtonElement>('[role="menuitem"]').find(el => el.textContent?.startsWith(label))!;
  await click(item);
  await waitFor(() => parentPanel(), '原笔记');
}

beforeEach(() => {
  backend = createBackend();
  vi.stubGlobal('fetch', backend.fetchStub);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('手机上在别人的笔记上 Build-on', () => {
  it('同学的笔记只能读；右下角 Build-on 选「质疑」后，原笔记先展开，贡献时建一条笔记和一条质疑关系', async () => {
    await mountAndOpenClassmateNote();
    expect(document.querySelector('[contenteditable][data-placeholder]')!.getAttribute('contenteditable')).toBe('false');
    expect(buttonWith('贡献')).toBeNull();

    await chooseBuildOn('质疑');
    expect(parentPanel()!.textContent).toContain('学生与AI如何互动的正文');
    expect(document.body.textContent).toContain('正在 Build-on 已有想法');
    // 还没写，什么都没建
    expect(noteCreates()).toHaveLength(0);

    await click(parentPanel()!.querySelector('button[aria-label="关闭"]')!);
    expect(parentPanel()).toBeNull();

    await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="标题"]')!, '我不同意');
    const body = document.querySelector<HTMLElement>('[contenteditable][data-placeholder]')!;
    await act(async () => {
      body.innerHTML = '<p>理由是……</p>';
      body.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonWith('贡献')!);
    await waitFor(() => relationCreates().length === 1, '贡献时建的关系');
    await waitFor(() => !editorOpen(), '贡献后回到列表');

    expect(noteCreates()).toHaveLength(1);
    const created = noteCreates()[0].body;
    expect(created).toMatchObject({ title: '我不同意', type: 'note', views: ['view-1'] });
    expect(Math.hypot(created.x - 200, created.y - 200)).toBeLessThan(600);
    expect(relationCreates()[0].body).toMatchObject({
      source_note_id: backend.state.notes.at(-1).id,
      target_note_id: PARENT_ID,
      relation_type: 'challenge',
    });
    // 刚建的就是贡献时的正文，不再多写一遍
    expect(backend.state.requests.filter(r => r.method === 'PUT')).toHaveLength(0);
  });

  it('选了方式又关掉不写：不留空笔记，也不建关系', async () => {
    await mountAndOpenClassmateNote();
    await chooseBuildOn('延伸');
    await click(buttonWith('关闭')!);
    await waitFor(() => !editorOpen(), '回到列表');
    expect(noteCreates()).toHaveLength(0);
    expect(relationCreates()).toHaveLength(0);
  });
});
