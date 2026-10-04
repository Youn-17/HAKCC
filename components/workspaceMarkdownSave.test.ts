// @vitest-environment jsdom
/**
 * 文档查看器里编辑 Markdown 附件后点「保存」。
 *
 * 以前前端先传新文件，再拿打开阅读器那一刻的整块 metadata 加上新的 mdVersions 经 PUT 写回：
 * 这期间同学固定了这张卡会被改回去，两个人各存一版会丢掉对方的历史记录。
 * 现在一次 POST /notes/:id/markdown-versions，只带正文、文件名和打开时的文件地址，
 * metadata 由服务端读、改、条件写；本地以服务端返回的 metadata 为准。
 *
 * 挂真 Workspace，后端换成进程内的假服务。
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
const DOC_ID = '00000000-0000-4000-8000-000000000003';
const V1 = 'https://storage.example/v1.md';
const V2 = 'https://storage.example/v2.md';

interface Req { method: string; path: string; body: any }

/** 当前用户自己上传的 Markdown；saveStatus 不是 200 时保存接口按它回错 */
function createBackend(saveStatus: number) {
  const requests: Req[] = [];
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const files: Record<string, string> = { [V1]: '# 实验记录\n\n第一版。' };
  const doc: Record<string, any> = {
    id: DOC_ID, space_id: SPACE_ID, author_id: USER.id, type: 'attachment', title: '实验记录', content: '',
    x: 400, y: 200, tags: [], views: [], cited_note_ids: [], users: { name: USER.name },
    file_url: V1, file_name: '实验记录.md', mime_type: 'text/markdown', metadata: {},
    created_at: '2026-09-20T08:00:00.000Z', updated_at: '2026-09-20T08:00:00.000Z',
  };

  async function handle(method: string, path: string, body: any): Promise<Response> {
    if (method === 'GET' && path === `/courses/${COURSE_ID}/spaces`) {
      return json({ spaces: [{ id: SPACE_ID, course_id: COURSE_ID, title: '主讨论空间', inquiry_question: '问题' }] });
    }
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/notes`) return json({ notes: [structuredClone(doc)] });
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/relations`) return json({ relations: [] });
    if (method === 'GET' && path === `/notes/${DOC_ID}/annotations`) return json({ annotations: [] });
    if (method === 'POST' && path === `/notes/${DOC_ID}/markdown-versions`) {
      if (saveStatus !== 200) {
        return json({ error: 'Someone saved a newer version of this document while you were editing' }, saveStatus);
      }
      files[V2] = Buffer.from(body.data_url.split(',')[1], 'base64').toString('utf8');
      // 阅读器开着的时候，同学在画布上把这张卡固定了
      doc.metadata = { is_fixed: true, mdVersions: [{ url: V1, replacedAt: '2026-09-28T08:00:00.000Z', by: USER.id }] };
      Object.assign(doc, { file_url: V2, file_name: body.file_name });
      return json({ file_url: V2, file_name: body.file_name, mime_type: 'text/markdown', metadata: doc.metadata });
    }
    if (method === 'PUT' && path.startsWith('/notes/')) return json({ note: doc });
    return json({
      notes: [], relations: [], spaces: [], notifications: [], scaffolds: [], views: [], cards: [],
      groups: [], rooms: [], shapes: [], configs: [], aiConfigs: [], conversations: [], messages: [],
      feedbacks: [], members: [], items: [], courses: [], sessions: [], annotations: [], ok: true,
    });
  }

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.host === 'storage.example') {
      requests.push({ method, path: url.href, body: undefined });
      return new Response(files[url.href] ?? '', { status: files[url.href] ? 200 : 404 });
    }
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body });
    return handle(method, path, body);
  });

  return { requests, fetchStub, files };
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
const docCard = () => all('.gsap-note-item[title="实验记录.md"], .gsap-note-item [title="实验记录.md"]')[0] ?? null;
/** 查看器里还有批注用的输入框，编辑框是那个关了拼写检查的 */
const editor = () => document.querySelector<HTMLTextAreaElement>('textarea[spellcheck="false"]');
const saves = () => backend.requests.filter(r => r.path.endsWith('/markdown-versions'));
const legacyWrites = () => backend.requests.filter(r => r.method === 'PUT' || r.path.endsWith('/attachments'));

async function fire(el: Element, type: string, init: MouseEventInit = {}) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 420, clientY: 220, ...init }));
  });
}

async function type(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
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
  await waitFor(docCard, '画布上的 Markdown 附件');
}

/** 双击打开，点「编辑」，改成 text，点「保存」 */
async function editAndSave(text: string) {
  await fire(docCard()!, 'dblclick');
  await waitFor(() => document.body.textContent?.includes('第一版。'), '查看器里的正文');
  await fire(await waitFor(() => buttonWith('编辑'), '「编辑」'), 'click');
  await type(await waitFor(editor, '编辑框'), text);
  await fire(await waitFor(() => buttonWith('保存'), '「保存」'), 'click');
}

async function start(saveStatus = 200) {
  backend = createBackend(saveStatus);
  vi.stubGlobal('fetch', backend.fetchStub);
  await mount();
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, 'alert').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('保存编辑后的 Markdown', () => {
  it('一次请求，只带正文、文件名和打开时的地址，不带 metadata；不再经 PUT', async () => {
    await start();
    await editAndSave('# 实验记录\n\n第二版，加了结论。');
    await waitFor(() => saves().length === 1, '保存请求');

    expect(saves()[0].method).toBe('POST');
    expect(Object.keys(saves()[0].body).sort()).toEqual(['base_file_url', 'data_url', 'file_name']);
    expect(saves()[0].body).toMatchObject({ file_name: '实验记录.md', base_file_url: V1 });
    expect(backend.files[V2]).toBe('# 实验记录\n\n第二版，加了结论。');
    expect(legacyWrites()).toHaveLength(0);

    // 编辑框收起，显示的是新文件
    await waitFor(() => !editor() && document.body.textContent?.includes('第二版，加了结论。'), '保存后的正文');
    expect(backend.requests.some(r => r.path === V2)).toBe(true);
  });

  it('本地以服务端返回的 metadata 为准：同学刚固定的卡，保存后仍是固定的', async () => {
    await start();
    await editAndSave('# 实验记录\n\n第二版。');
    await waitFor(() => saves().length === 1 && !editor(), '保存完成');

    await fire(await waitFor(() => all<HTMLButtonElement>('button[aria-label="关闭"]')[0], '「关闭」'), 'click');
    await fire(docCard()!, 'contextmenu');
    expect(await waitFor(() => buttonWith('取消固定 (Unfix)'), '右键菜单里的「取消固定」')).not.toBeNull();
  });

  it('编辑期间有人存了新版本（409）：提示写在编辑框上方，改的内容还在', async () => {
    await start(409);
    await editAndSave('# 实验记录\n\n我这边的改动。');
    await waitFor(() => document.body.textContent?.includes('这份文档在你编辑期间有人保存了新版本'), '冲突提示');

    expect(editor()?.value).toBe('# 实验记录\n\n我这边的改动。');
    expect(legacyWrites()).toHaveLength(0);
  });
});
