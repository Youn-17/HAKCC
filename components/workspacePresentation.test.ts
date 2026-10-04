// @vitest-environment jsdom
/**
 * 右键「固定」和图片附件的「显示为条目 / 在画布上显示图片」。
 *
 * 菜单对所有人显示，保存却走作者专用的 PUT /notes/:id：学生改同学的卡，本地变了，
 * 403 被 console.error 吞掉，刷新后又回到原样。现在这两项是共享画布的版式（同卡片位置），
 * 走 PATCH /notes/:id/presentation，只传改动的那个键；没存上就退回原样并提示。
 *
 * 挂真 Workspace，后端换成进程内的假服务：PUT 对非作者照线上一样回 403，
 * /presentation 像线上一样把传来的键合并进 metadata，重新挂载就等于刷新。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent ?? ''; },
    set(value: string) { this.textContent = value; },
  });
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { id: 'user-1', name: '测试学生', email: 'student@example.test', role: 'student' };
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
const IMAGE_ID = '00000000-0000-4000-8000-000000000002';

interface Req { method: string; path: string; body: any }

/** 两条都是同学（user-2）的：当前用户不是作者 */
function createBackend(presentationStatus: number) {
  const requests: Req[] = [];
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const base = {
    space_id: SPACE_ID, author_id: 'user-2', content: '', tags: [], views: [], cited_note_ids: [],
    created_at: '2026-09-20T08:00:00.000Z', updated_at: '2026-09-20T08:00:00.000Z', users: { name: '同学甲' },
  };
  const notes: Array<Record<string, any>> = [
    { ...base, id: NOTE_ID, type: 'note', title: '同学的观点', content: '<p>同学的观点</p>', x: 200, y: 200, metadata: {} },
    {
      ...base, id: IMAGE_ID, type: 'attachment', title: '实验照片', x: 700, y: 200, width: 320, height: 240,
      file_url: 'https://storage.example/photo.png', file_name: 'photo.png', mime_type: 'image/png', metadata: {},
    },
  ];

  async function handle(method: string, path: string, body: any): Promise<Response> {
    if (method === 'GET' && path === `/courses/${COURSE_ID}/spaces`) {
      return json({ spaces: [{ id: SPACE_ID, course_id: COURSE_ID, title: '主讨论空间', inquiry_question: '问题' }] });
    }
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/notes`) return json({ notes: structuredClone(notes) });
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/relations`) return json({ relations: [] });
    const presentation = path.match(/^\/notes\/([^/]+)\/presentation$/);
    if (method === 'PATCH' && presentation) {
      if (presentationStatus !== 200) return json({ error: 'This space belongs to another group' }, presentationStatus);
      const note = notes.find(n => n.id === presentation[1])!;
      note.metadata = { ...note.metadata, ...body };
      return json({ metadata: note.metadata });
    }
    if (method === 'PUT' && path.startsWith('/notes/')) return json({ error: 'Only the author can edit this note' }, 403);
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
let alertSpy: ReturnType<typeof vi.spyOn>;
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
const image = () => document.querySelector<HTMLImageElement>('img[alt="实验照片"]');
const imageEntry = () => all('[title="photo.png"]')[0] ?? null;
const presentationCalls = () => backend.requests.filter(r => r.path.endsWith('/presentation'));
const puts = () => backend.requests.filter(r => r.method === 'PUT');

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function rightClick(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
  });
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(MemoryRouter, { initialEntries: [`/workspace/${COURSE_ID}`] },
        React.createElement(Routes, null,
          React.createElement(Route, {
            path: '/workspace/:courseId/*',
            element: React.createElement(Workspace, { userRole: 'student', lang: 'zh', setLang: () => undefined }),
          }),
        ),
      ),
    );
  });
  await waitFor(() => noteCard('同学的观点'), '画布上的笔记');
  await waitFor(() => image() ?? imageEntry(), '画布上的图片附件');
}

/** 重新挂载 = 刷新页面：状态全部从假后端重新拉 */
async function reload() {
  await act(async () => { root?.unmount(); });
  host?.remove();
  await mount();
}

async function start(presentationStatus = 200) {
  backend = createBackend(presentationStatus);
  vi.stubGlobal('fetch', backend.fetchStub);
  await mount();
}

beforeEach(() => {
  localStorage.clear();
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('同学的卡：固定和显示方式都能存', () => {
  it('「固定」只传 is_fixed，不走作者专用的 PUT；刷新后还是固定的', async () => {
    await start();
    await rightClick(noteCard('同学的观点')!);
    await click(await waitFor(() => buttonWith('固定 (Fixed)'), '右键菜单里的「固定」'));
    await waitFor(() => presentationCalls().length === 1, '保存请求');
    expect(presentationCalls()[0]).toEqual({ method: 'PATCH', path: `/notes/${NOTE_ID}/presentation`, body: { is_fixed: true } });
    expect(puts()).toHaveLength(0);

    await reload();
    await rightClick(noteCard('同学的观点')!);
    expect(buttonWith('取消固定 (Unfix)')).not.toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('「显示为条目」只传 display_mode；刷新后还是条目，不影响别的键', async () => {
    await start();
    await rightClick(image()!);
    await click(await waitFor(() => buttonWith('显示为条目（仅文件名）'), '右键菜单里的「显示为条目」'));
    await waitFor(() => presentationCalls().length === 1, '保存请求');
    expect(presentationCalls()[0].body).toEqual({ display_mode: 'card' });
    expect(image()).toBeNull();

    // 再把它固定：两个键分开传，谁也不带另一个的旧值
    await rightClick(imageEntry()!);
    await click(await waitFor(() => buttonWith('固定 (Fixed)'), '右键菜单里的「固定」'));
    await waitFor(() => presentationCalls().length === 2, '第二次保存请求');
    expect(presentationCalls()[1].body).toEqual({ is_fixed: true });
    expect(puts()).toHaveLength(0);

    await reload();
    expect(image()).toBeNull();
    await rightClick(imageEntry()!);
    expect(buttonWith('在画布上显示图片')).not.toBeNull();
    expect(buttonWith('取消固定 (Unfix)')).not.toBeNull();
  });
});

describe('没存上：退回原样，而且看得见', () => {
  it('固定失败：卡片回到没固定，弹出提示', async () => {
    await start(403);
    await rightClick(noteCard('同学的观点')!);
    await click(await waitFor(() => buttonWith('固定 (Fixed)'), '右键菜单里的「固定」'));
    await waitFor(() => alertSpy.mock.calls.length > 0, '提示');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(String(alertSpy.mock.calls[0][0])).toContain('固定没有保存到服务器，已恢复原样');

    await rightClick(noteCard('同学的观点')!);
    expect(buttonWith('固定 (Fixed)')).not.toBeNull();
    expect(buttonWith('取消固定 (Unfix)')).toBeNull();
  });

  it('显示方式失败：图片回到画布上，弹出提示', async () => {
    await start(500);
    await rightClick(image()!);
    await click(await waitFor(() => buttonWith('显示为条目（仅文件名）'), '右键菜单里的「显示为条目」'));
    await waitFor(() => alertSpy.mock.calls.length > 0, '提示');
    expect(String(alertSpy.mock.calls[0][0])).toContain('显示方式没有保存到服务器，已恢复原样');
    await waitFor(image, '退回后的图片');
  });
});
