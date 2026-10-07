// @vitest-environment jsdom
/**
 * 笔记编辑器的几条回归。挂真组件（Workspace + NoteEditorModal），后端换成进程内的假服务，
 * 按学生的操作顺序点下去，看最后落进「库」里的是什么。
 *
 * 1. 学生在 Build-on 草稿里先问了 AI：对话线程要 note_id，草稿被提前落库（自动保存）。
 *    以前这一步把笔记放在视口中央、不接关系，之后的「贡献」走更新分支，这条 Build-on 就永远没建成。
 * 2. 关掉编辑器不清 Build-on 父笔记：之后从支架库、从对话「发布为新笔记」开的新笔记，
 *    会被接到那条过期的父笔记上。
 * 3. 编辑器关着时组件并不卸载，AI 线程留在状态里：问过 AI 的笔记关掉后再开新笔记提问，
 *    问题发进了上一条笔记的线程，新草稿也没落库——研究数据里这段对话记在了别的笔记名下。
 * 4. 新草稿第一次问 AI 时，线程列表比建线程先查、后到：列表里没有新线程，选中的线程被置空，
 *    学生刚问的话和说到一半的回复从面板上消失（库里的数据没错）。
 * 5. 服务端存下提问（或回复）之后还要再查几次库才回传。这段时间里面板只要重拉一次历史，
 *    同一条消息就显示两遍，回传到了之后还变成两条同 key 的消息。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const USER = vi.hoisted(() => {
  // jsdom 缺的浏览器接口。放在 hoisted 里，保证组件模块加载之前就位。
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
  // jsdom 没实现 innerText；编辑器拿它数字数、记光标位置
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
  // 给 AI 传文件时浏览器直传存储那一步：一律成功（签发和回读校验走下面的假后端）
  const storage = { from: () => ({ uploadToSignedUrl: async () => ({ data: {}, error: null }) }) };
  return { supabase: { channel: () => channel, removeChannel: () => undefined, storage } };
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: USER, loading: false, error: null,
    logout: () => undefined, applyUser: () => undefined, clearError: () => undefined,
  }),
}));

import Workspace from './Workspace';
import { resetNoteSeenForTests, setSeenDwellForTests } from './noteBadges';

// ── 假后端 ──────────────────────────────────────────────────────

const COURSE_ID = 'course-1';
const SPACE_ID = 'space-1';
const PARENT_ID = '00000000-0000-4000-8000-000000000001';
const FAR_ID = '00000000-0000-4000-8000-000000000002';
const DIALOGUE_ID = '00000000-0000-4000-8000-000000000003';
const PARENT = { x: 200, y: 200 };

interface Req { method: string; path: string; body: any }

function apiNote(id: string, title: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return {
    id, space_id: SPACE_ID, author_id: 'user-2', type: 'note', title,
    content: `<p>${title}</p>`, x, y, tags: [], views: [], cited_note_ids: [],
    created_at: '2026-09-20T08:00:00.000Z', updated_at: '2026-09-20T08:00:00.000Z',
    users: { name: '同学甲' }, ...extra,
  };
}

function createBackend() {
  const state = {
    requests: [] as Req[],
    notes: [
      apiNote(PARENT_ID, '被接的观点', PARENT.x, PARENT.y),
      // 离父笔记很远的一条，把视口中心拉开：放错位置时一眼就能看出来
      apiNote(FAR_ID, '远处的观点', 4200, 2400),
      apiNote(DIALOGUE_ID, '和 AI 的一段对话', 4200, 200, { type: 'ai_dialogue' }),
    ] as any[],
    relations: [] as any[],
    /** 问题栏后面滚动的讨论主题 */
    viewTopics: [] as Array<{ label: string; noteIds: string[]; count: number }>,
    /**
     * 建过的 AI 线程。和真后端一样：第一次问 AI 时开线程，同一个人、同一条笔记、同一个模型只有一条；
     * 「新建对话」带 force_new：手头有还没问过话的空白对话就回它，否则新开一段；
     * 删除只是打 deletedAt，消息还在。
     */
    conversations: [] as any[],
    /** 对话消息。和真后端一样，提问一到就存，回复说完再存 */
    messages: [] as any[],
    seq: 100,
    /** 设了它，新建笔记的请求会卡在这里，直到测试放行 */
    noteCreateGate: null as Promise<void> | null,
    /** 同上，卡的是建对话线程 */
    conversationCreateGate: null as Promise<void> | null,
    /** 设了它，线程列表照样在请求到达那一刻查好（真后端也是先查参与记录），只是答复卡在这里 */
    conversationListGate: null as Promise<void> | null,
    /** 设了它，AI 回复说完前半句就停在这里，直到测试放行 */
    streamGate: null as Promise<void> | null,
    /** 设了它，回传提问后发一条「思考中」状态就停在这里（推理模型一想就是好几秒），字还没出来 */
    streamThinkGate: null as Promise<void> | null,
    /** 设了它，「思考中」之后服务端推一条 error 就结束，一个字也没出（模型中途出错） */
    streamError: null as string | null,
    /** 设了它，提问已经存进库，回传 userMessage 之前停在这里（真后端这中间还要查三四次库） */
    streamHeadGate: null as Promise<void> | null,
    /** 设了它，回复已经存进库，回传 assistantMessage 之前停在这里（真后端这中间也还要写三次库） */
    streamTailGate: null as Promise<void> | null,
    /** 设了它，生图时提问已经存进库，图还没画完 */
    imageGate: null as Promise<void> | null,
    /** 设了它，线程历史在请求到达那一刻按当时的库查好，答复卡在这里 */
    messageListGate: null as Promise<void> | null,
    /** 设了它，提问请求到了先卡住，还没存进库（真后端存之前要先查线程和参与记录） */
    streamInsertGate: null as Promise<void> | null,
    /** 支架列表里多一条 hidden 的（教职拿到的就是这样） */
    hiddenScaffold: false,
  };

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const aliveThreads = (noteId: string) => state.conversations.filter(c => c.noteId === noteId && !c.deletedAt);
  /** 学生问的第一句（压成一行，最多 80 字）；没问过话是 null */
  const firstQuestion = (threadId: string): string | null => {
    const asked = state.messages.find(m => m.threadId === threadId && m.senderKind === 'user');
    return asked ? String(asked.content).replace(/\s+/g, ' ').trim().slice(0, 80) : null;
  };
  /** 谁最近有动静：有消息按最后一条消息的先后，还没有消息的按建线程的先后（新建的空白对话在最前） */
  const threadActivity = (thread: any) => {
    const last = state.messages.reduce((acc, m, i) => (m.threadId === thread.id ? i : acc), -1);
    return last >= 0 ? last + 1 : 100_000 + thread.seq;
  };
  const nextId = () => `00000000-0000-4000-8000-${String(state.seq++).padStart(12, '0')}`;

  async function handle(method: string, path: string, body: any): Promise<Response> {
    if (method === 'GET' && path === `/courses/${COURSE_ID}/spaces`) {
      return json({ spaces: [{ id: SPACE_ID, course_id: COURSE_ID, title: '主讨论空间', inquiry_question: '问题' }] });
    }
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/notes`) return json({ notes: state.notes });
    if (method === 'GET' && path === `/spaces/${SPACE_ID}/relations`) return json({ relations: state.relations });
    if (method === 'POST' && path === `/spaces/${SPACE_ID}/notes`) {
      if (state.noteCreateGate) await state.noteCreateGate;
      const note = apiNote(nextId(), body.title, body.x, body.y, {
        author_id: USER.id, content: body.content, views: body.views ?? [], tags: body.tags ?? [],
        users: { name: USER.name },
      });
      state.notes.push(note);
      return json({ note }, 201);
    }
    // 「信息」页签取修订记录；真后端没有记录时也回空数组
    if (method === 'GET' && /^\/notes\/[^/]+\/revisions$/.test(path)) return json({ revisions: [] });
    const noteMatch = path.match(/^\/notes\/([^/]+)$/);
    if (method === 'PUT' && noteMatch) {
      const note = state.notes.find(n => n.id === noteMatch[1]);
      Object.assign(note ?? {}, body);
      return json({ note });
    }
    if (method === 'POST' && path === '/relations') {
      const relation = {
        id: nextId(), space_id: SPACE_ID, creator_id: USER.id, ai_suggested: false,
        created_at: new Date().toISOString(), ...body,
      };
      state.relations.push(relation);
      return json({ relation }, 201);
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/ai-configs`) {
      return json({ configs: [{
        id: 'cfg-1', courseId: COURSE_ID, providerId: 'deepseek', isVerified: true,
        enabledModels: ['deepseek-flash'], configuredAt: '2026-09-01T00:00:00Z', apiKeyMasked: '***',
      }] });
    }
    if (method === 'GET' && path === `/courses/${COURSE_ID}/scaffolds`) {
      return json({ requireScaffold: false, scaffolds: [{
        id: 'scaffold-1', title: '我的想法是', category: 'idea', steps: [],
        usageCount: 0, isMandatory: false, isRecommended: false, createdAt: '2026-09-01T00:00:00Z',
      }, ...(state.hiddenScaffold ? [{
        // 教职拿到的列表里带着被隐藏的支架（支架管理里要能恢复），hidden 标着
        id: 'scaffold-hidden', title: '这条老师隐藏了', category: 'idea', steps: [], hidden: true,
        usageCount: 0, isMandatory: false, isRecommended: false, createdAt: '2026-09-01T00:00:00Z',
      }] : [])] });
    }
    const convMatch = path.match(/^\/notes\/([^/]+)\/conversations$/);
    if (convMatch && method === 'GET') {
      if (convMatch[1] !== DIALOGUE_ID) {
        // 和真后端一样：不列删掉的，带学生问的第一句（空白的是 null），最近有动静的排最前
        const conversations = aliveThreads(convMatch[1])
          .sort((a, b) => threadActivity(b) - threadActivity(a))
          .map(c => ({ ...c, preview: firstQuestion(c.id) }));
        if (state.conversationListGate) await state.conversationListGate;
        return json({ conversations, aiConfigs: [] });
      }
      return json({ conversations: [{
        id: 'thread-dialogue', noteId: DIALOGUE_ID, targetType: 'ai', providerId: 'deepseek', model: 'deepseek-flash',
      }], aiConfigs: [] });
    }
    if (convMatch && method === 'POST') {
      if (state.conversationCreateGate) await state.conversationCreateGate;
      const mine = aliveThreads(convMatch[1]);
      if (body.force_new) {
        const blank = mine.find(c => firstQuestion(c.id) === null);
        if (blank) return json({ conversation: { ...blank, preview: null } });
      } else {
        const same = mine.find(c => c.providerId === body.provider_id && c.model === body.model);
        if (same) return json({ conversation: same }, 201);
      }
      const base = `thread-${convMatch[1]}`;
      const conversation = {
        id: state.conversations.some(c => c.id === base) ? `${base}-${state.conversations.length}` : base,
        noteId: convMatch[1], targetType: 'ai', createdBy: USER.id, seq: state.conversations.length,
        providerId: body.provider_id, model: body.model, title: body.title,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      state.conversations.push(conversation);
      return json({ conversation: { ...conversation, preview: null } }, 201);
    }
    const deleteMatch = path.match(/^\/note-conversations\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const thread = state.conversations.find(c => c.id === deleteMatch[1]);
      if (!thread || thread.deletedAt) return json({ error: 'Conversation not found' }, 404);
      thread.deletedAt = new Date().toISOString();
      return json({ ok: true });
    }
    if (method === 'GET' && path === '/note-conversations/thread-dialogue/messages') {
      return json({ messages: [
        { id: 'm-1', threadId: 'thread-dialogue', senderKind: 'user', content: '这条反馈什么意思？', attachments: [], aiMetadata: {}, createdAt: '2026-09-20T08:00:00Z' },
        { id: 'm-2', threadId: 'thread-dialogue', senderKind: 'assistant', content: 'AI 说的一段话', attachments: [], aiMetadata: {}, createdAt: '2026-09-20T08:00:01Z' },
      ] });
    }
    const messagesMatch = path.match(/^\/note-conversations\/([^/]+)\/messages$/);
    if (method === 'GET' && messagesMatch) {
      if (state.conversations.find(c => c.id === messagesMatch[1])?.deletedAt) return json({ error: 'Conversation not found' }, 404);
      const messages = state.messages.filter(m => m.threadId === messagesMatch[1]);
      if (state.messageListGate) await state.messageListGate;
      return json({ messages });
    }
    const streamMatch = path.match(/^\/note-conversations\/([^/]+)\/ai\/(?:agent-)?stream$/);
    if (method === 'POST' && streamMatch) {
      if (state.streamInsertGate) await state.streamInsertGate;
      return streamReply(streamMatch[1], body.content);
    }
    if (method === 'GET' && /^\/spaces\/[^/]+\/view-topics$/.test(path)) {
      return json({ topics: state.viewTopics, stale: false });
    }
    // 给 AI 传文件：签发直传地址；直传之后回读校验，真后端在这一步抽正文
    if (method === 'POST' && path === `/spaces/${SPACE_ID}/attachments/sign`) {
      return json({ path: `${SPACE_ID}/${body.file_name}`, token: 'upload-token', bucket: 'note-attachments' });
    }
    if (method === 'POST' && path === `/spaces/${SPACE_ID}/attachments/commit`) {
      return json({
        attachment: { file_url: `https://files.example.test/${body.path}`, file_name: body.file_name, mime_type: body.mime_type, file_size: 16 },
        text: '第三章讲检索练习。', textTruncated: false, textSource: 'pdf',
      });
    }
    const imageMatch = path.match(/^\/note-conversations\/([^/]+)\/image$/);
    if (method === 'POST' && imageMatch) {
      const userMessage = message(imageMatch[1], 'user', body.prompt);
      state.messages.push(userMessage);
      if (state.imageGate) await state.imageGate;
      const assistantMessage = message(imageMatch[1], 'assistant', '![配图](https://example.test/picture.png)');
      state.messages.push(assistantMessage);
      return json({ userMessage, assistantMessage, imageUrl: 'https://example.test/picture.png', model: 'image-model' }, 201);
    }
    // 其余接口：给一个各种列表都为空的对象，页面上的旁支功能拿到它都能安静地渲染成空
    return json({
      notes: [], relations: [], spaces: [], notifications: [], scaffolds: [], views: [], cards: [],
      groups: [], rooms: [], shapes: [], configs: [], aiConfigs: [], conversations: [], messages: [],
      feedbacks: [], outcomes: [], members: [], items: [], courses: [], sessions: [], ok: true,
    });
  }

  function message(threadId: string, senderKind: 'user' | 'assistant', content: string) {
    return {
      id: nextId(), threadId, senderKind, senderId: senderKind === 'user' ? USER.id : undefined,
      content, attachments: [], aiMetadata: {}, createdAt: new Date().toISOString(),
    };
  }

  /** 仿真后端的流式回复：先存提问、回传 userMessage，逐段吐字，说完存回复、回传 assistantMessage */
  function streamReply(threadId: string, question: string): Response {
    const userMessage = message(threadId, 'user', question);
    state.messages.push(userMessage);
    const { streamGate: gate, streamHeadGate: headGate, streamTailGate: tailGate } = state;
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`));
    void (async () => {
      const head = `关于「${question}」，`;
      const tail = '先说到这里。';
      if (headGate) await headGate;
      send({ userMessage });
      if (state.streamThinkGate) {
        send({ reasoningStatus: 'thinking', reasoningChars: 24 });
        await state.streamThinkGate;
      }
      if (state.streamError) {
        send({ error: state.streamError });
        send('[DONE]');
        controller.close();
        return;
      }
      send({ token: head });
      if (gate) await gate;
      send({ token: tail });
      const assistantMessage = message(threadId, 'assistant', head + tail);
      state.messages.push(assistantMessage);
      if (tailGate) await tailGate;
      send({ assistantMessage });
      send('[DONE]');
      controller.close();
    })();
    return new Response(stream, { status: 200 });
  }

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    state.requests.push({ method, path, body });
    // 带查询参数的完整地址也记一份（讨论主题按 view_id 取）
    if (url.search) state.requests.push({ method, path: `${path}${url.search}`, body: null });
    return handle(method, path, body);
  });

  return { state, fetchStub };
}

// ── 挂载与操作 ──────────────────────────────────────────────────

let backend: ReturnType<typeof createBackend>;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
/** 路由里的 navigate，用来模拟浏览器后退 */
let navigate: NavigateFunction | null = null;
function NavigateProbe() {
  navigate = useNavigate();
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
/** 画布上某条笔记卡里、只含标题文字的那个节点 */
const noteCard = (title: string) => all('.gsap-note-item *').find(el => el.children.length === 0 && el.textContent?.trim() === title) ?? null;

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setValue.call(el, value);
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
        React.createElement(NavigateProbe),
        React.createElement(Routes, null,
          React.createElement(Route, {
            path: '/workspace/:courseId/*',
            element: React.createElement(Workspace, { userRole: 'student', lang: 'zh', setLang: () => undefined }),
          }),
        ),
      ),
    );
  });
  await waitFor(() => noteCard('被接的观点'), '画布上的笔记');
}

/** 右键父笔记 → 建立于此 → 选关系 → 打开编辑器 */
async function startBuildOn(relationLabel: string) {
  const card = noteCard('被接的观点')!;
  await act(async () => {
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
  });
  await click(await waitFor(() => buttonWith('建立于此 (Build-on)'), '右键菜单里的 Build-on'));
  await click(await waitFor(() => buttonWith(relationLabel), `关系类型 ${relationLabel}`));
  await click(buttonWith('打开编辑器')!);
  await waitFor(() => document.querySelector('input[aria-label="标题"]'), '编辑器');
  // Build-on 草稿：左侧先显示原笔记，AI 助手收着（2026-09 课堂反馈：写着写着忘了在回应什么）
  const parentPanel = await waitFor(() => document.querySelector('aside[aria-label="你在回应的笔记"]'), '原笔记栏');
  expect(parentPanel.textContent).toContain('被接的观点');
  expect(document.querySelector('textarea[aria-label="围绕这条 Note 提问…"]')).toBeNull();
}

async function writeNote(title: string, bodyHtml: string) {
  await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="标题"]')!, title);
  const body = document.querySelector<HTMLElement>('[contenteditable][data-placeholder]')!;
  await act(async () => {
    body.innerHTML = bodyHtml;
    body.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** AI 助手收着（Build-on 草稿默认先显示原笔记）就先点顶栏的「AI 助手」 */
async function openAiPanel() {
  if (document.querySelector('textarea[aria-label="围绕这条 Note 提问…"]')) return;
  await click(await waitFor(() => buttonWith('AI 助手'), '顶栏的 AI 助手按钮'));
}

async function askAi(question: string) {
  await openAiPanel();
  const input = await waitFor(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="围绕这条 Note 提问…"]'), 'AI 输入框');
  await typeInto(input, question);
  const send = await waitFor(
    () => all<HTMLButtonElement>('button[aria-label="发送"]').find(b => !b.disabled),
    'AI 可用（发送按钮亮起）',
  );
  await click(send);
}

const editorOpen = () => Boolean(document.querySelector('input[aria-label="标题"]'));
const noteCreates = () => backend.state.requests.filter(r => r.method === 'POST' && r.path === `/spaces/${SPACE_ID}/notes`);
const relationCreates = () => backend.state.requests.filter(r => r.method === 'POST' && r.path === '/relations');
const noteUpdates = () => backend.state.requests.filter(r => r.method === 'PUT' && r.path.startsWith('/notes/'));
const conversationCreates = () => backend.state.requests.filter(r => r.method === 'POST' && /^\/notes\/[^/]+\/conversations$/.test(r.path));
/** 每一次向 AI 提问发到了哪条线程，按发出顺序 */
const streamThreads = () => backend.state.requests
  .map(r => (r.method === 'POST' ? r.path.match(/^\/note-conversations\/([^/]+)\/ai\/(?:agent-)?stream$/)?.[1] : undefined))
  .filter((id): id is string => Boolean(id));
const conversationLists = (noteId: string) => backend.state.requests.filter(r => r.method === 'GET' && r.path === `/notes/${noteId}/conversations`);
/** AI 面板里学生那一问的气泡。回复会复述问题，所以不能只看页面上有没有这句话 */
const questionBubble = (question: string) => all('[data-ai-scroll] .justify-end').find(el => el.textContent?.trim() === question) ?? null;
const questionBubbles = (question: string) => all('[data-ai-scroll] .justify-end').filter(el => el.textContent?.trim() === question).length;
const panelText = () => all('[data-ai-scroll]').map(el => el.textContent ?? '').join('\n');
/** 这段话在 AI 面板里出现了几次 */
const panelCount = (text: string) => panelText().split(text).length - 1;
/** 一轮问答还没结束：面板的滚动区标着 aria-busy（发出去、回复途中、画图都算） */
const aiBusy = () => Boolean(document.querySelector('[data-ai-scroll][aria-busy="true"]'));
const messageLoads = (threadId: string) => backend.state.requests.filter(r => r.method === 'GET' && r.path === `/note-conversations/${threadId}/messages`);

/** 双击画布上的笔记，打开它的编辑器 */
async function openNote(title: string) {
  await act(async () => {
    noteCard(title)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  await waitFor(() => editorOpen(), `${title} 的编辑器`);
}

async function closeEditorAndStartNewNote() {
  await click(buttonWith('关闭')!);
  await waitFor(() => !editorOpen(), '编辑器关闭');
  await click(document.querySelector('button[aria-label="Note 创建"]')!);
  await waitFor(() => editorOpen(), '新笔记的编辑器');
}

beforeEach(() => {
  backend = createBackend();
  vi.stubGlobal('fetch', backend.fetchStub);
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 1. Build-on 草稿被 AI 对话提前落库 ────────────────────────────

describe('Build-on 草稿先问 AI 再贡献', () => {
  /** 不问 AI、直接贡献：这就是 Build-on 应有的样子，下面拿它做对照 */
  async function contributeDirectly() {
    await mount();
    await startBuildOn('Question');
    await writeNote('我的追问', '<p>为什么会这样？</p>');
    await click(buttonWith('贡献')!);
    await waitFor(() => relationCreates().length === 1, '贡献时建的关系');
    return { note: noteCreates()[0].body, relation: relationCreates()[0].body };
  }

  it('自动保存就把笔记放到父笔记旁边、接上同一种关系；贡献不再建第二次', async () => {
    const expected = await contributeDirectly();
    await act(async () => { root?.unmount(); });
    host?.remove();
    backend = createBackend();
    vi.stubGlobal('fetch', backend.fetchStub);

    await mount();
    await startBuildOn('Question');
    await writeNote('我的追问', '<p>为什么会这样？</p>');
    await askAi('帮我看看这个问题问得清楚吗？');

    // 自动保存：只建一条笔记，位置和直接贡献时一模一样（挨着父笔记，不在视口中央）
    await waitFor(() => relationCreates().length === 1, '自动保存时建的关系');
    await waitFor(() => backend.state.requests.some(r => r.path.endsWith('/stream')), 'AI 回复');
    expect(noteCreates()).toHaveLength(1);
    const draft = noteCreates()[0].body;
    expect({ x: draft.x, y: draft.y }).toEqual({ x: expected.note.x, y: expected.note.y });
    expect(Math.hypot(draft.x - PARENT.x, draft.y - PARENT.y)).toBeLessThan(600);

    const draftId = backend.state.notes.at(-1).id;
    expect(relationCreates()[0].body).toEqual({ ...expected.relation, source_note_id: draftId });
    expect(relationCreates()[0].body).toMatchObject({ target_note_id: PARENT_ID, relation_type: 'question' });

    // 编辑器还开着这条草稿，Build-on 标记还在
    expect(editorOpen()).toBe(true);
    expect(document.body.textContent).toContain('正在 Build-on 已有想法');

    await writeNote('我的追问（改过）', '<p>为什么会这样？我补充一点。</p>');
    await click(buttonWith('贡献')!);
    await waitFor(() => noteUpdates().length === 1, '贡献写回草稿');
    await settle(50);

    expect(noteUpdates()[0].path).toBe(`/notes/${draftId}`);
    expect(noteUpdates()[0].body).toMatchObject({ title: '我的追问（改过）' });
    expect(noteCreates()).toHaveLength(1);
    expect(relationCreates()).toHaveLength(1);
    expect(editorOpen()).toBe(false);
  });

  it('草稿还在自动保存的路上就点了贡献：仍然只有一条笔记、一条关系', async () => {
    await mount();
    await startBuildOn('Evidence');
    await writeNote('补一条证据', '<p>数据在这里。</p>');

    let release!: () => void;
    backend.state.noteCreateGate = new Promise<void>(r => { release = r; });
    await askAi('这个证据够吗？');
    await waitFor(() => noteCreates().length === 1, '自动保存发出');

    await writeNote('补一条证据（定稿）', '<p>数据在这里，来源也写上了。</p>');
    await click(buttonWith('贡献')!);
    expect(editorOpen()).toBe(false);

    backend.state.noteCreateGate = null;
    release();
    await waitFor(() => relationCreates().length === 1 && noteUpdates().length === 1, '关系和写回');
    await settle(50);

    expect(noteCreates()).toHaveLength(1);
    expect(relationCreates()).toHaveLength(1);
    expect(relationCreates()[0].body).toMatchObject({ target_note_id: PARENT_ID, relation_type: 'evidence' });
    expect(noteUpdates()[0].body).toMatchObject({ title: '补一条证据（定稿）' });
    // 关掉的编辑器不会因为那次自动保存回来又弹开
    expect(editorOpen()).toBe(false);
  });
});

// ── 2. 关掉编辑器要清掉 Build-on 父笔记 ───────────────────────────

describe('没贡献就关掉 Build-on 编辑器', () => {
  async function abandonBuildOn() {
    await mount();
    await startBuildOn('Challenge');
    expect(document.body.textContent).toContain('正在 Build-on 已有想法');
    await click(buttonWith('关闭')!);
    await waitFor(() => !editorOpen(), '编辑器关闭');
  }

  it('之后从支架库开的新笔记不会接到那条父笔记上', async () => {
    await abandonBuildOn();

    await click(document.querySelector('button[aria-label="Scaffold"]')!);
    await click(await waitFor(() => buttonWith('插入笔记'), '支架库'));
    await waitFor(() => editorOpen(), '编辑器');
    expect(document.body.textContent).not.toContain('正在 Build-on 已有想法');

    await writeNote('用支架写的新想法', '<p>一个新想法</p>');
    await click(buttonWith('贡献')!);
    await waitFor(() => noteCreates().length === 1, '新笔记落库');
    await settle(50);
    expect(relationCreates()).toHaveLength(0);
    expect(Math.hypot(noteCreates()[0].body.x - PARENT.x, noteCreates()[0].body.y - PARENT.y)).toBeGreaterThan(600);
  });

  it('之后从对话「发布为新笔记」开的新笔记也不会', async () => {
    await abandonBuildOn();

    await act(async () => {
      noteCard('和 AI 的一段对话')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    await click(await waitFor(() => buttonWith('发布为新笔记'), '对话里的「发布为新笔记」'));
    await waitFor(() => editorOpen(), '编辑器');
    expect(document.body.textContent).not.toContain('正在 Build-on 已有想法');

    await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="标题"]')!, '从对话里来的观点');
    await click(buttonWith('贡献')!);
    await waitFor(() => noteCreates().length === 1, '新笔记落库');
    await settle(50);
    expect(relationCreates()).toHaveLength(0);
    expect(noteCreates()[0].body.content).toContain('AI 说的一段话');
  });

  it('用浏览器后退回画布也算关掉：之后从支架库开的新笔记同样不接', async () => {
    await mount();
    await startBuildOn('Clarify');
    await act(async () => { navigate!(-1); });
    await waitFor(() => !editorOpen(), '后退回画布');

    await click(document.querySelector('button[aria-label="Scaffold"]')!);
    await click(await waitFor(() => buttonWith('插入笔记'), '支架库'));
    await waitFor(() => editorOpen(), '编辑器');
    expect(document.body.textContent).not.toContain('正在 Build-on 已有想法');
    await writeNote('后退之后写的新想法', '<p>又一个新想法</p>');
    await click(buttonWith('贡献')!);
    await waitFor(() => noteCreates().length === 1, '新笔记落库');
    await settle(50);
    expect(relationCreates()).toHaveLength(0);
  });

  it('再打开 Build-on 时关系类型回到默认的「延伸」', async () => {
    await abandonBuildOn();
    const card = noteCard('被接的观点')!;
    await act(async () => {
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    });
    await click(await waitFor(() => buttonWith('建立于此 (Build-on)'), '右键菜单里的 Build-on'));
    await click(await waitFor(() => buttonWith('打开编辑器'), '关系选择'));
    await writeNote('接着说', '<p>延伸一下</p>');
    await click(buttonWith('贡献')!);
    await waitFor(() => relationCreates().length === 1, '关系');
    expect(relationCreates()[0].body).toMatchObject({ target_note_id: PARENT_ID, relation_type: 'extend' });
  });
});

// ── 3. 编辑器关着时并不卸载：上一条笔记的 AI 线程不能带进下一条 ──────────
// 面板上的观察用 expect.soft：修复前的那次运行要一路跑到后面，把数据记错了哪里一并报出来。

describe('问过 AI 的笔记关掉后，再开新笔记问 AI', () => {
  const FIRST_QUESTION = '这条观点的依据是什么？';

  it('新笔记的提问进新笔记自己的线程，草稿照常落库；自动保存不打断回复，接着再问还是这一条', async () => {
    await mount();
    await openNote('被接的观点');
    await askAi(FIRST_QUESTION);
    await waitFor(() => streamThreads().length === 1, '在第一条笔记里提问');
    expect(streamThreads()).toEqual([`thread-${PARENT_ID}`]);

    await closeEditorAndStartNewNote();
    // 面板上没有上一条笔记的线程和对话
    expect.soft(buttonWith('历史对话')!.textContent).toBe('历史对话');
    expect.soft(document.body.textContent).not.toContain(FIRST_QUESTION);

    await writeNote('新的想法', '<p>一个还没贡献的新想法</p>');
    let finishReply!: () => void;
    backend.state.streamGate = new Promise<void>(r => { finishReply = r; });
    await askAi('帮我看看这个想法');
    await waitFor(() => streamThreads().length === 2, '在新笔记里提问');

    expect(noteCreates()).toHaveLength(1);
    const draftId = backend.state.notes.at(-1).id;
    expect(streamThreads()[1]).toBe(`thread-${draftId}`);

    // 回复说到一半时，自动保存已经把编辑器换成了落库的笔记；回复要接着在面板上说完
    await waitFor(() => document.body.textContent?.includes('关于「帮我看看这个想法」，'), '回复的前半句');
    await settle(50);
    expect(editorOpen()).toBe(true);
    backend.state.streamGate = null;
    finishReply();
    await waitFor(() => document.body.textContent?.includes('关于「帮我看看这个想法」，先说到这里。'), '回复说完');

    await askAi('再追问一句');
    await waitFor(() => streamThreads().length === 3, '在新笔记里追问');
    expect(streamThreads()[2]).toBe(`thread-${draftId}`);
    expect(conversationCreates().map(r => r.path)).toEqual([
      `/notes/${PARENT_ID}/conversations`,
      `/notes/${draftId}/conversations`,
    ]);
    expect(noteCreates()).toHaveLength(1);
  });

  it('上一条笔记的线程还在路上就关掉：那一问仍记在原笔记名下，回来的线程和回复不落进新笔记', async () => {
    await mount();
    await openNote('被接的观点');
    let release!: () => void;
    backend.state.conversationCreateGate = new Promise<void>(r => { release = r; });
    await askAi(FIRST_QUESTION);
    await waitFor(() => conversationCreates().length === 1, '第一条笔记在建线程');

    await closeEditorAndStartNewNote();
    backend.state.conversationCreateGate = null;
    release();
    await waitFor(() => streamThreads().length === 1, '第一条笔记的提问发出');
    expect(streamThreads()).toEqual([`thread-${PARENT_ID}`]);
    await waitFor(() => backend.state.messages.length === 2, '第一条笔记的问答存进库');
    expect(backend.state.messages.map(m => [m.threadId, m.senderKind])).toEqual([
      [`thread-${PARENT_ID}`, 'user'],
      [`thread-${PARENT_ID}`, 'assistant'],
    ]);
    await settle(50);
    expect.soft(buttonWith('历史对话')!.textContent).toBe('历史对话');
    expect.soft(document.body.textContent).not.toContain(FIRST_QUESTION);

    await writeNote('新的想法', '<p>一个还没贡献的新想法</p>');
    await askAi('帮我看看这个想法');
    await waitFor(() => streamThreads().length === 2, '在新笔记里提问');
    expect(noteCreates()).toHaveLength(1);
    expect(streamThreads()[1]).toBe(`thread-${backend.state.notes.at(-1).id}`);
  });
});

// ── 4. 新草稿第一次问 AI：拉线程列表和建线程同时在路上 ────────────────────
// 草稿一落库 noteId 就变了，编辑器随即去拉这条笔记的线程列表，建线程的请求也在路上。
// 真后端里学生只看得到自己参与的线程，而建线程时参与记录最后才写（每次查询约 285ms），
// 于是列表可能先查（还没有新线程）、后送到（线程已选上、回复已经在说）。

describe('新草稿第一次问 AI，线程列表先查后到', () => {
  const QUESTION = '帮我看看这个想法';

  it('学生的提问和说到一半的回复留在面板上；接着追问还是那条线程，不再建第二次', async () => {
    await mount();
    await click(document.querySelector('button[aria-label="Note 创建"]')!);
    await waitFor(() => editorOpen(), '新笔记的编辑器');
    await writeNote('新的想法', '<p>一个还没贡献的新想法</p>');

    let releaseCreate!: () => void;
    let releaseList!: () => void;
    let finishReply!: () => void;
    backend.state.conversationCreateGate = new Promise<void>(r => { releaseCreate = r; });
    backend.state.conversationListGate = new Promise<void>(r => { releaseList = r; });
    backend.state.streamGate = new Promise<void>(r => { finishReply = r; });
    await askAi(QUESTION);

    await waitFor(() => noteCreates().length === 1, '草稿自动保存');
    const draftId = backend.state.notes.at(-1).id;
    // 线程还没建好时，列表已经查完了：里面什么也没有
    await waitFor(() => conversationLists(draftId).length > 0 && conversationCreates().length === 1, '拉列表和建线程都已发出');

    backend.state.conversationCreateGate = null;
    releaseCreate();
    await waitFor(() => document.body.textContent?.includes(`关于「${QUESTION}」，`), '回复的前半句');
    expect(questionBubble(QUESTION)).toBeTruthy();

    // 列表这时才送到
    backend.state.conversationListGate = null;
    releaseList();
    await settle(50);
    expect.soft(questionBubble(QUESTION), '列表送到后，学生的提问还在面板上').toBeTruthy();
    expect.soft(document.body.textContent, '说到一半的回复还在').toContain(`关于「${QUESTION}」，`);

    backend.state.streamGate = null;
    finishReply();
    await waitFor(() => document.body.textContent?.includes(`关于「${QUESTION}」，先说到这里。`), '回复说完');
    await settle(50);
    expect.soft(questionBubble(QUESTION), '回复说完后，提问仍在').toBeTruthy();
    expect.soft(buttonWith('历史对话')!.textContent, '历史对话里有这条线程').toContain('1');

    await askAi('再追问一句');
    await waitFor(() => streamThreads().length === 2, '追问');
    expect(streamThreads()).toEqual([`thread-${draftId}`, `thread-${draftId}`]);
    expect(conversationCreates().map(r => r.path)).toEqual([`/notes/${draftId}/conversations`]);
    expect(noteCreates()).toHaveLength(1);
  });
});

// ── 5. 消息已经存进库、还没回传时，面板重拉了历史 ───────────────────────
// 服务端存下提问之后还要再查三四次库才回传 userMessage，存下回复之后也还要再写三次库才回传 assistantMessage
// （每次约 285ms）。这段时间里面板只要重拉一次历史——选中的线程换了对象（建好线程、列表送到）、
// 窗口重新获得焦点、定时刷新——拉到的历史里就已经有这条消息，面板上它却还是本地占位。

describe('消息存进库、还没回传时面板重拉历史', () => {
  const QUESTION = '帮我看看这个想法';
  const REPLY = `关于「${QUESTION}」，先说到这里。`;
  /** React 在同一列表里碰到两个相同 key 时的报错：同一条消息在面板上出现了两次 */
  const sameKeyErrors = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls
    .map(args => args.map(String).join(' '))
    .filter(text => text.includes('Encountered two children with the same key'));
  /** 学生切出去又切回来：面板刷新线程列表，选中的线程换成列表里的新对象，历史随之重拉 */
  async function refocusWindow(threadId: string) {
    const before = messageLoads(threadId).length;
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => messageLoads(threadId).length > before, '重拉历史');
    await settle(50);
  }

  it('新草稿第一次提问：提问已存、还没回传时列表送到，提问只显示一次', async () => {
    const consoleError = vi.spyOn(console, 'error');
    await mount();
    await click(document.querySelector('button[aria-label="Note 创建"]')!);
    await waitFor(() => editorOpen(), '新笔记的编辑器');
    await writeNote('新的想法', '<p>一个还没贡献的新想法</p>');

    // 不卡建线程：列表查的时候新线程已经建好，送到后选中的线程换成列表里的新对象
    let releaseList!: () => void;
    let releaseHead!: () => void;
    backend.state.conversationListGate = new Promise<void>(r => { releaseList = r; });
    backend.state.streamHeadGate = new Promise<void>(r => { releaseHead = r; });
    await askAi(QUESTION);
    await waitFor(() => streamThreads().length === 1, '提问发出');
    const threadId = streamThreads()[0];
    expect(backend.state.messages.map(m => [m.threadId, m.senderKind])).toEqual([[threadId, 'user']]);

    const loadsBefore = messageLoads(threadId).length;
    backend.state.conversationListGate = null;
    releaseList();
    await waitFor(() => messageLoads(threadId).length > loadsBefore, '列表送到后重拉历史');
    await settle(50);
    expect.soft(questionBubbles(QUESTION), '提问已存、还没回传').toBe(1);

    backend.state.streamHeadGate = null;
    releaseHead();
    await waitFor(() => panelText().includes(REPLY) && !aiBusy(), '回复说完');
    await settle(50);
    expect.soft(questionBubbles(QUESTION), '回复说完后').toBe(1);
    expect.soft(panelCount(REPLY)).toBe(1);
    expect(sameKeyErrors(consoleError)).toEqual([]);
  });

  it('回复已存、还没回传时窗口重新获得焦点：回复只显示一次', async () => {
    const consoleError = vi.spyOn(console, 'error');
    await mount();
    await openNote('被接的观点');
    let releaseTail!: () => void;
    backend.state.streamTailGate = new Promise<void>(r => { releaseTail = r; });
    await askAi(QUESTION);
    await waitFor(() => backend.state.messages.some(m => m.senderKind === 'assistant') && panelText().includes(REPLY), '回复存进库');
    const threadId = streamThreads()[0];

    await refocusWindow(threadId);
    expect.soft(panelCount(REPLY), '回复已存、还没回传').toBe(1);

    backend.state.streamTailGate = null;
    releaseTail();
    await waitFor(() => !aiBusy(), '这一轮结束');
    await settle(50);
    expect.soft(questionBubbles(QUESTION)).toBe(1);
    expect.soft(panelCount(REPLY), '回传之后').toBe(1);
    expect(sameKeyErrors(consoleError)).toEqual([]);
  });

  it('连续问同一句话：第二问已存、还没回传时重拉历史，两问各显示一次', async () => {
    const consoleError = vi.spyOn(console, 'error');
    await mount();
    await openNote('被接的观点');
    await askAi(QUESTION);
    await waitFor(() => panelText().includes(REPLY) && !aiBusy(), '第一问答完');

    let releaseHead!: () => void;
    backend.state.streamHeadGate = new Promise<void>(r => { releaseHead = r; });
    await askAi(QUESTION);
    await waitFor(() => streamThreads().length === 2, '第二问发出');
    const threadId = streamThreads()[1];
    expect(backend.state.messages.filter(m => m.senderKind === 'user')).toHaveLength(2);

    await refocusWindow(threadId);
    expect.soft(questionBubbles(QUESTION), '第二问已存、还没回传').toBe(2);

    backend.state.streamHeadGate = null;
    releaseHead();
    await waitFor(() => panelCount(REPLY) >= 2 && !aiBusy(), '第二问答完');
    await settle(50);
    expect.soft(questionBubbles(QUESTION)).toBe(2);
    expect.soft(panelCount(REPLY)).toBe(2);
    expect(sameKeyErrors(consoleError)).toEqual([]);
  });

  it('连续问同一句话：第二问还没存进库时重拉历史，第二问不会先消失', async () => {
    await mount();
    await openNote('被接的观点');
    await askAi(QUESTION);
    await waitFor(() => panelText().includes(REPLY) && !aiBusy(), '第一问答完');

    let releaseInsert!: () => void;
    backend.state.streamInsertGate = new Promise<void>(r => { releaseInsert = r; });
    await askAi(QUESTION);
    await waitFor(() => streamThreads().length === 2, '第二问发出');
    const threadId = streamThreads()[1];
    expect(backend.state.messages.filter(m => m.senderKind === 'user')).toHaveLength(1);

    // 历史里只有第一问。它和第二问一字不差，但不是同一条
    await refocusWindow(threadId);
    expect.soft(questionBubbles(QUESTION), '第二问还没存进库').toBe(2);

    backend.state.streamInsertGate = null;
    releaseInsert();
    await waitFor(() => panelCount(REPLY) >= 2 && !aiBusy(), '第二问答完');
    await settle(50);
    expect(questionBubbles(QUESTION)).toBe(2);
    expect(panelCount(REPLY)).toBe(2);
  });

  it('直接生图：提问已存、图还没画完时重拉历史，提问只显示一次', async () => {
    const PROMPT = '画一张光合作用的示意图';
    const consoleError = vi.spyOn(console, 'error');
    await mount();
    await openNote('被接的观点');
    let releaseImage!: () => void;
    backend.state.imageGate = new Promise<void>(r => { releaseImage = r; });
    await typeInto(await waitFor(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="围绕这条 Note 提问…"]'), 'AI 输入框'), PROMPT);
    await click(await waitFor(() => all<HTMLButtonElement>('button[aria-label="让 AI 画一张配图"]').find(b => !b.disabled), '生图按钮'));
    await waitFor(() => backend.state.messages.some(m => m.senderKind === 'user'), '提问存进库');
    const threadId = backend.state.messages[0].threadId;

    await refocusWindow(threadId);
    expect.soft(questionBubbles(PROMPT), '提问已存、图还没画完').toBe(1);

    backend.state.imageGate = null;
    releaseImage();
    await waitFor(() => !aiBusy() && Boolean(document.querySelector('[data-ai-scroll] img')), '图画完');
    await settle(50);
    expect.soft(questionBubbles(PROMPT), '图画完之后').toBe(1);
    expect(sameKeyErrors(consoleError)).toEqual([]);
  });

  // 重新打开一条问过 AI 的笔记，历史请求在下一问之前发出（按那时的库查好），答复卡住
  const SECOND = '那反例呢？';
  const SECOND_REPLY = `关于「${SECOND}」，先说到这里。`;
  async function reopenWithHistoryInFlight() {
    await mount();
    await openNote('被接的观点');
    await askAi(QUESTION);
    await waitFor(() => panelText().includes(REPLY) && !aiBusy(), '第一问答完');
    const threadId = streamThreads()[0];
    await click(buttonWith('关闭')!);
    await waitFor(() => !editorOpen(), '编辑器关闭');

    let releaseHistory!: () => void;
    backend.state.messageListGate = new Promise<void>(r => { releaseHistory = r; });
    const loadsBefore = messageLoads(threadId).length;
    await openNote('被接的观点');
    await waitFor(() => messageLoads(threadId).length > loadsBefore, '重新打开后拉历史');
    return () => { backend.state.messageListGate = null; releaseHistory(); };
  }

  it('历史还没拉回来就问完了一轮：晚到的历史不把这一轮冲掉', async () => {
    const releaseHistory = await reopenWithHistoryInFlight();
    await askAi(SECOND);
    await waitFor(() => panelText().includes(SECOND_REPLY) && !aiBusy(), '第二问答完');

    releaseHistory();
    await waitFor(() => questionBubbles(QUESTION) === 1, '补上第一问的历史').catch(() => undefined);
    await settle(50);
    expect.soft(questionBubbles(QUESTION), '第一问（历史）').toBe(1);
    expect(questionBubbles(SECOND), '第二问').toBe(1);
    expect(panelCount(SECOND_REPLY)).toBe(1);
  });

  it('历史在一轮问答途中才送到：这一轮说完后补上历史，这一问不丢', async () => {
    const releaseHistory = await reopenWithHistoryInFlight();
    let finishReply!: () => void;
    backend.state.streamGate = new Promise<void>(r => { finishReply = r; });
    await askAi(SECOND);
    await waitFor(() => panelText().includes(`关于「${SECOND}」，`), '第二问回复的前半句');

    releaseHistory();
    await settle(50);
    expect.soft(questionBubbles(SECOND), '历史送到时，第二问还在').toBe(1);

    backend.state.streamGate = null;
    finishReply();
    await waitFor(() => panelText().includes(SECOND_REPLY) && !aiBusy(), '第二问答完');
    await waitFor(() => questionBubbles(QUESTION) === 1, '补上第一问的历史').catch(() => undefined);
    await settle(50);
    expect.soft(questionBubbles(QUESTION), '第一问（历史）').toBe(1);
    expect(questionBubbles(SECOND), '第二问').toBe(1);
    expect(panelCount(SECOND_REPLY)).toBe(1);
  });
});

// ── 结构约束：新笔记只有一个入口 ──────────────────────────────────

describe('Workspace 新建笔记的入口', () => {
  it('isCreatingNew 只在 startNewNote 里置真，Build-on 意图只能随它一起给出', () => {
    const src = readFileSync(resolve(__dirname, 'Workspace.tsx'), 'utf-8').split('\n');
    const start = src.findIndex(l => l.includes('const startNewNote = useCallback('));
    expect(start).toBeGreaterThan(0);
    const end = src.findIndex((l, i) => i > start && /^\s*\}, \[\]\);/.test(l));
    const outside = src
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => l.includes('setIsCreatingNew(true)') && (i < start || i > end))
      .map(({ l, i }) => `${i + 1}: ${l.trim()}`);
    expect(outside).toEqual([]);
  });
});

/**
 * 2026-09 课堂反馈：
 *   - 打开别人的笔记，右下角要有 Build-on，点开是六种方式；
 *   - 在别人的笔记上 Build-on 时，要能看到原笔记（左侧默认展开，可收起）；
 *   - 我还没打开过的同学笔记在我这里标 New（按人算）；被 Build-on 最多的标一团火。
 */
describe('别人的笔记：只读 + 右下角 Build-on；卡片上的 New 和火', () => {
  const menuButton = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  const parentPanel = () => document.querySelector<HTMLElement>('aside[aria-label="你在回应的笔记"]');
  const editorBody = () => document.querySelector<HTMLElement>('[contenteditable][data-placeholder]');

  beforeEach(() => { resetNoteSeenForTests(); });

  it('学生打开别人的笔记：正文不能改、没有「贡献」；AI 助手照样先显示', async () => {
    await mount();
    await openNote('被接的观点');
    expect(editorBody()!.getAttribute('contenteditable')).toBe('false');
    expect(buttonWith('贡献')).toBeNull();
    expect(document.body.textContent).toContain('这是别人的笔记，只能阅读');
    expect(document.querySelector('textarea[aria-label="围绕这条 Note 提问…"]')).not.toBeNull();
    // 不是 Build-on 草稿，也不是一条 Build-on：没有「原笔记」
    expect(parentPanel()).toBeNull();
    expect(buttonWith('原笔记')).toBeNull();
  });

  it('右下角 Build-on 弹出六种方式；选「提问」原地换成接着它的新笔记，左侧先显示原笔记，贡献后建一条提问关系', async () => {
    await mount();
    await openNote('被接的观点');
    await click(menuButton()!);
    const items = all<HTMLButtonElement>('[role="menuitem"]');
    expect(items.map(item => item.textContent?.slice(0, 2))).toEqual(['延伸', '澄清', '提问', '质疑', '证据', '综合']);

    await click(items[2]);
    const panel = await waitFor(() => parentPanel(), '原笔记栏');
    expect(panel.textContent).toContain('被接的观点');
    expect(panel.textContent).toContain('提问');
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    expect(document.body.textContent).toContain('正在 Build-on 已有想法');
    expect(document.querySelector('textarea[aria-label="围绕这条 Note 提问…"]')).toBeNull();
    expect(editorBody()!.getAttribute('contenteditable')).toBe('true');

    // 收起、再从顶上的「原笔记」打开
    await click(panel.querySelector('button[aria-label="关闭"]')!);
    expect(parentPanel()).toBeNull();
    await click(buttonWith('原笔记')!);
    expect(parentPanel()).not.toBeNull();
    // 打开 AI 助手时原笔记让位
    await click(buttonWith('AI 助手')!);
    expect(parentPanel()).toBeNull();
    expect(document.querySelector('textarea[aria-label="围绕这条 Note 提问…"]')).not.toBeNull();

    await writeNote('我的追问', '<p>为什么会这样？</p>');
    await click(buttonWith('贡献')!);
    await waitFor(() => relationCreates().length === 1, '贡献时建的关系');
    expect(noteCreates()).toHaveLength(1);
    expect(relationCreates()[0].body).toMatchObject({ target_note_id: PARENT_ID, relation_type: 'question' });
  });

  it('我还没打开过的同学笔记标 New；双击打开、停够时间才报给服务器，关掉后角标没了', async () => {
    setSeenDwellForTests(80);
    backend.state.notes[1].seen_by_me = false;
    await mount();
    const farCard = () => noteCard('远处的观点')!.closest('.gsap-note-item')!;
    const parentCard = () => noteCard('被接的观点')!.closest('.gsap-note-item')!;
    expect(farCard().textContent).toContain('New');
    expect(parentCard().textContent).not.toContain('New');

    await openNote('远处的观点');
    await waitFor(() => backend.state.requests.some(r => r.method === 'POST' && r.path === `/notes/${FAR_ID}/seen`), '报「打开过」');
    await click(buttonWith('关闭')!);
    await waitFor(() => !editorOpen(), '编辑器关闭');
    expect(farCard().textContent).not.toContain('New');
    // 同一条不再重复报
    await openNote('远处的观点');
    expect(backend.state.requests.filter(r => r.path === `/notes/${FAR_ID}/seen`)).toHaveLength(1);
  });

  it('单击选中、详情栏出来了都不算看过：New 留着，不报服务器（10-05 用户：一点就没了不行）', async () => {
    setSeenDwellForTests(80);
    backend.state.notes[1].seen_by_me = false;
    await mount();
    const card = noteCard('远处的观点')!;
    await act(async () => {
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    await waitFor(() => document.querySelector('[data-canvas-overlay]'), '详情栏');
    // 旧规则是详情栏停 1.2 秒就算；现在停多久都不算
    await settle(1500);
    expect(backend.state.requests.some(r => r.path === `/notes/${FAR_ID}/seen`)).toBe(false);
    expect(card.closest('.gsap-note-item')!.textContent).toContain('New');
  });

  it('双击打开又马上关掉：没看就不算，New 还在', async () => {
    setSeenDwellForTests(600);
    backend.state.notes[1].seen_by_me = false;
    await mount();
    await openNote('远处的观点');
    await click(buttonWith('关闭')!);
    await waitFor(() => !editorOpen(), '编辑器关闭');
    await settle(900);
    expect(backend.state.requests.some(r => r.path === `/notes/${FAR_ID}/seen`)).toBe(false);
    expect(noteCard('远处的观点')!.closest('.gsap-note-item')!.textContent).toContain('New');
  });

  it('单击卡片后详情栏等过一次双击的间隔才出现：画布右边的卡片不会被它盖住、双击打不开', async () => {
    await mount();
    const card = noteCard('远处的观点')!;
    await act(async () => {
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(document.querySelector('[data-canvas-overlay]')).toBeNull();
    await act(async () => {
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => editorOpen(), '双击打开的笔记');
    await click(buttonWith('关闭')!);
    await waitFor(() => !editorOpen(), '编辑器关闭');
    // 不双击：过一会儿详情栏照常出来
    await waitFor(() => document.querySelector('[data-canvas-overlay]'), '详情栏');
  });

  it('AI 助手里说「画一只……」：不走对话模型，直接出图；等图的时候放绘图动画', async () => {
    await mount();
    await openNote('被接的观点');
    let release!: () => void;
    backend.state.imageGate = new Promise<void>(r => { release = r; });
    await askAi('画一只在月球上看书的猫');
    await waitFor(
      () => backend.state.requests.some(r => r.method === 'POST' && /^\/note-conversations\/[^/]+\/image$/.test(r.path)),
      '出图请求',
    );
    expect(streamThreads()).toEqual([]);
    const progress = await waitFor(() => document.querySelector('[role="status"][aria-label^="正在画"]'), '绘图动画');
    expect(progress.textContent).toContain('读懂你的描述');

    release();
    await waitFor(() => !document.querySelector('[role="status"][aria-label^="正在画"]'), '画完');
    await waitFor(() => document.querySelector('img[src$="picture.png"]'), '画好的图');
  });

  it('老师在支架管理里隐藏的支架，写笔记时支架栏里不列（教职拿到的列表里带着它也一样）', async () => {
    backend.state.hiddenScaffold = true;
    await mount();
    await click(document.querySelector('button[aria-label="Note 创建"]')!);
    await waitFor(() => editorOpen(), '新笔记');
    await waitFor(() => document.body.textContent?.includes('我的想法是'), '支架栏');
    expect(document.body.textContent).not.toContain('这条老师隐藏了');
  });

  it('被 Build-on 最多的笔记标一团火，只有一次的不算', async () => {
    const reply = (id: string, target: string) => ({
      id, space_id: SPACE_ID, source_note_id: id, target_note_id: target, relation_type: 'extend',
      creator_id: 'user-3', ai_suggested: false, created_at: '2026-09-21T08:00:00.000Z',
    });
    backend.state.notes.push(
      apiNote('00000000-0000-4000-8000-0000000000a1', '回应一', 600, 200),
      apiNote('00000000-0000-4000-8000-0000000000a2', '回应二', 600, 500),
      apiNote('00000000-0000-4000-8000-0000000000a3', '回应三', 900, 500),
    );
    backend.state.relations.push(
      reply('00000000-0000-4000-8000-0000000000a1', PARENT_ID),
      reply('00000000-0000-4000-8000-0000000000a2', PARENT_ID),
      reply('00000000-0000-4000-8000-0000000000a3', FAR_ID),
    );
    await mount();
    const hot = await waitFor(
      () => noteCard('被接的观点')!.closest('.gsap-note-item')!.querySelector('[title^="被 Build-on 最多"]'),
      '火',
    );
    expect(hot.textContent).toBe('2');
    expect(noteCard('远处的观点')!.closest('.gsap-note-item')!.querySelector('[title^="被 Build-on 最多"]')).toBeNull();
  });
});

/**
 * 2026-09-29 课堂反馈：note 界面的 AI 助手——
 *   - 「新建对话」以前在同一个模型下一律回到旧线程，历史里永远只有一条，点哪条都是同一段，等于看不到历史；
 *   - 历史对话要能删；
 *   - 等 AI 回复的时候要有个「正在思考」的动效，不让学生干等。
 */
describe('AI 助手的历史对话：新建、切换、删除；等回复时的动效', () => {
  const Q1 = '检索练习为什么有效？';
  const Q2 = '那怎么安排复习？';
  const R1 = `关于「${Q1}」，先说到这里。`;
  const R2 = `关于「${Q2}」，先说到这里。`;
  const historyMenu = () => document.querySelector<HTMLElement>('[data-ai-history]');
  const historyRows = () => all('[data-ai-history] li');
  const rowFor = (question: string) => historyRows().find(li => li.textContent?.includes(question)) ?? null;
  const newChatButton = () => waitFor(() => {
    const button = buttonWith('新建对话');
    return button && !button.disabled ? button : null;
  }, '可点的「新建对话」');
  const deleteRequests = () => backend.state.requests.filter(r => r.method === 'DELETE');
  const busyMarks = () => all('[data-ai-scroll] [data-ai-busy]');
  const typingDots = () => all('[data-ai-scroll] .ai-dots');

  async function openHistory() {
    await click(buttonWith('历史对话')!);
    await waitFor(historyMenu, '历史菜单');
  }
  async function askAndWait(question: string, reply: string) {
    await askAi(question);
    await waitFor(() => panelText().includes(reply) && !aiBusy(), `「${question}」答完`);
  }
  /** 第一段问 Q1，点「新建对话」后第二段问 Q2 */
  async function twoConversations() {
    await mount();
    await openNote('被接的观点');
    await askAndWait(Q1, R1);
    await click(await newChatButton());
    await waitFor(() => !panelText().includes(R1), '面板清空');
    await askAndWait(Q2, R2);
    return streamThreads() as [string, string];
  }
  const trashOf = (question: string) => rowFor(question)!.querySelector<HTMLButtonElement>('button[aria-label="删除这段对话"]')!;
  const confirmButton = () => all<HTMLButtonElement>('[data-ai-history] button').find(b => b.textContent?.trim() === '删除')!;

  it('Note 探究建议可编辑；输入法确认和换行不触发提问', async () => {
    await mount();
    await openNote('被接的观点');
    await openAiPanel();
    await click(buttonWith('发现知识缺口')!);
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="围绕这条 Note 提问…"]')!;
    expect(input.value).toContain('尚未解释清楚的观点');
    expect(document.activeElement).toBe(input);
    expect(streamThreads()).toEqual([]);
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
      await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...options })); });
      expect(streamThreads()).toEqual([]);
    }
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await waitFor(() => streamThreads().length === 1, '普通回车发送');
  });

  it('「新建对话」开一段新的：面板清空，问话进新线程，历史里列出两段（各用第一句问话认）', async () => {
    const [first, second] = await twoConversations();
    expect(second).not.toBe(first);
    expect(conversationCreates().at(-1)!.body).toMatchObject({ target_type: 'ai', force_new: true });
    expect(panelText()).toContain(R2);
    expect(panelText()).not.toContain(R1);

    await openHistory();
    const rows = historyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain(Q2);
    expect(rows[1].textContent).toContain(Q1);
    expect(buttonWith('历史对话')!.textContent).toContain('2');
  });

  it('点历史里较早的一段：面板换成那一段的对话，菜单收起', async () => {
    const [first] = await twoConversations();
    await openHistory();
    const loadsBefore = messageLoads(first).length;
    await click(rowFor(Q1)!.querySelector('button')!);

    await waitFor(() => panelText().includes(R1) && !panelText().includes(R2), '较早那段的对话');
    expect(messageLoads(first).length).toBeGreaterThan(loadsBefore);
    expect(historyMenu()).toBeNull();
    expect(questionBubbles(Q1)).toBe(1);
  });

  it('切换对话时先清掉上一段、显示「正在打开」，历史到了再换成那一段', async () => {
    const [first] = await twoConversations();
    await openHistory();
    let releaseHistory!: () => void;
    backend.state.messageListGate = new Promise<void>(r => { releaseHistory = r; });
    await click(rowFor(Q1)!.querySelector('button')!);

    await waitFor(() => panelText().includes('正在打开这段对话'), '「正在打开」');
    expect(panelText()).not.toContain(R2);
    expect(panelText()).not.toContain(R1);

    backend.state.messageListGate = null;
    releaseHistory();
    await waitFor(() => panelText().includes(R1), '那一段的对话');
    expect(panelText()).not.toContain('正在打开这段对话');
    expect(messageLoads(first).length).toBeGreaterThan(0);
  });

  it('删除眼前这一段：先要确认；确认后从历史里消失，面板接着显示剩下的一段', async () => {
    const [, second] = await twoConversations();
    await openHistory();
    await click(trashOf(Q2));

    // 只是出了确认，还没删
    expect(historyMenu()!.textContent).toContain('删除这段对话？');
    expect(deleteRequests()).toHaveLength(0);

    await click(confirmButton());
    await waitFor(() => deleteRequests().some(r => r.path === `/note-conversations/${second}`), '删除请求');
    await waitFor(() => panelText().includes(R1) && !panelText().includes(R2), '接着显示剩下的一段');
    expect(rowFor(Q2)).toBeNull();
    expect(historyRows()).toHaveLength(1);
    expect(rowFor(Q1)).not.toBeNull();
    // 只是打标记：消息还在库里
    expect(backend.state.conversations.find(c => c.id === second)!.deletedAt).toBeTruthy();
    expect(backend.state.messages.some(m => m.threadId === second)).toBe(true);
  });

  it('点了删除又取消：什么都不删', async () => {
    await twoConversations();
    await openHistory();
    await click(trashOf(Q1));
    await click(all<HTMLButtonElement>('[data-ai-history] button').find(b => b.textContent?.trim() === '取消')!);

    expect(deleteRequests()).toHaveLength(0);
    expect(historyRows()).toHaveLength(2);
    expect(rowFor(Q1)).not.toBeNull();
  });

  it('删的不是眼前这一段：眼前的对话不动', async () => {
    await twoConversations();
    await openHistory();
    await click(trashOf(Q1));
    await click(confirmButton());
    await waitFor(() => deleteRequests().length === 1, '删除请求');
    await waitFor(() => historyRows().length === 1, '历史里少了一段');

    expect(panelText()).toContain(R2);
    expect(rowFor(Q2)).not.toBeNull();
  });

  it('把对话都删光：面板回到空白；再问一句开一段新的，不会捡回删掉的那段', async () => {
    await mount();
    await openNote('被接的观点');
    await askAndWait(Q1, R1);
    const first = streamThreads()[0];
    await openHistory();
    await click(trashOf(Q1));
    await click(confirmButton());
    await waitFor(() => !panelText().includes(R1), '面板回到空白');
    expect(historyMenu()!.textContent).toContain('还没有历史对话');

    const createsBefore = conversationCreates().length;
    await askAndWait(Q2, R2);
    expect(conversationCreates().length).toBe(createsBefore + 1);
    expect(streamThreads().at(-1)).not.toBe(first);
    expect(panelText()).not.toContain(R1);
  });

  it('这条笔记还没有对话：点历史对话，菜单里说明还没有，不是什么都不发生', async () => {
    await mount();
    await openNote('被接的观点');
    await openAiPanel();
    await openHistory();
    expect(historyMenu()!.textContent).toContain('还没有历史对话');
  });

  it('还没问过话的空白对话不占历史：只有眼前正开着的那段才列出来，切走以后就不列了', async () => {
    await mount();
    await openNote('被接的观点');
    await askAndWait(Q1, R1);
    await click(await newChatButton());
    await waitFor(() => !panelText().includes(R1), '新建了空白对话');

    await openHistory();
    expect(historyRows()).toHaveLength(2);
    expect(historyRows()[0].textContent).toContain('新对话');

    await click(rowFor(Q1)!.querySelector('button')!);
    await waitFor(() => panelText().includes(R1), '切回第一段');
    await openHistory();
    expect(historyRows()).toHaveLength(1);
    expect(rowFor(Q1)).not.toBeNull();
  });

  it('面板本来就是空白的：点「新建对话」不再多开一条', async () => {
    await mount();
    await openNote('被接的观点');
    await openAiPanel();
    await click(await newChatButton());
    expect(conversationCreates()).toHaveLength(0);

    // 刚新建完的空白对话，再点也不再开
    await askAndWait(Q1, R1);
    await click(await newChatButton());
    await waitFor(() => !panelText().includes(R1), '新建了空白对话');
    const creates = conversationCreates().length;
    await click(await newChatButton());
    expect(conversationCreates().length).toBe(creates);
  });

  it('AI 回答途中：历史里的对话不能点、不能删，菜单里说明要等回答完', async () => {
    await twoConversations();
    let releaseReply!: () => void;
    backend.state.streamGate = new Promise<void>(r => { releaseReply = r; });
    await askAi('再问一个');
    await waitFor(() => panelText().includes('关于「再问一个」，'), '回复的前半句');

    await openHistory();
    const rows = historyRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const button of Array.from(row.querySelectorAll('button'))) expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(historyMenu()!.textContent).toContain('AI 回答完才能切换');

    backend.state.streamGate = null;
    releaseReply();
    await waitFor(() => !aiBusy(), '回答完');
  });

  it('提问发出去、回复还没开始：面板里显示「正在思考」的动效，回复说完就没有了', async () => {
    await mount();
    await openNote('被接的观点');
    let releaseHead!: () => void;
    backend.state.streamHeadGate = new Promise<void>(r => { releaseHead = r; });
    await askAi(Q1);

    const mark = await waitFor(() => busyMarks()[0], '等待中的动效');
    expect(mark.textContent).toContain('正在思考');
    expect(mark.getAttribute('role')).toBe('status');
    expect(mark.querySelector('.ai-dots')).not.toBeNull();
    expect(busyMarks()).toHaveLength(1);

    backend.state.streamHeadGate = null;
    releaseHead();
    await waitFor(() => panelText().includes(R1) && !aiBusy(), '回复说完');
    expect(busyMarks()).toHaveLength(0);
    expect(typingDots()).toHaveLength(0);
  });

  it('上一轮出错中断、留下一条没有字的临时回复：不再画成动效，下一轮也不会多出第二个「正在思考」', async () => {
    await mount();
    await openNote('被接的观点');
    // 线程先存在（第一轮正常问答）：这样出错后没有补拉历史，那条没有字的临时回复才会留在面板里
    await askAndWait(Q1, R1);

    backend.state.streamThinkGate = Promise.resolve();
    backend.state.streamError = '模型暂时不可用';
    await askAi(Q2);
    await waitFor(() => document.body.textContent?.includes('模型暂时不可用') && !aiBusy(), '这一轮出错结束');
    expect(busyMarks()).toHaveLength(0);

    // 下一轮也想一阵：走到「思考中」这一步，这一轮自己的临时回复才出现，残留的那条要是还在就是第二个动效
    let releaseThink!: () => void;
    backend.state.streamError = null;
    backend.state.streamThinkGate = new Promise<void>(r => { releaseThink = r; });
    await askAi('第三个问题');
    await waitFor(() => backend.state.messages.filter(m => m.senderKind === 'user').length === 3, '第三问已存');
    await waitFor(() => busyMarks().length > 0, '下一轮等待中的动效');
    await settle(50);
    expect(busyMarks()).toHaveLength(1);

    backend.state.streamThinkGate = null;
    releaseThink();
    await waitFor(() => panelText().includes('关于「第三个问题」，先说到这里。') && !aiBusy(), '下一轮说完');
    expect(busyMarks()).toHaveLength(0);
  });

  it('回复途中：想的时候只有一处「正在思考」，字出来后换成文字加末尾跳动的小点，说完全部消失', async () => {
    await mount();
    await openNote('被接的观点');
    let releaseThink!: () => void;
    let releaseReply!: () => void;
    backend.state.streamThinkGate = new Promise<void>(r => { releaseThink = r; });
    backend.state.streamGate = new Promise<void>(r => { releaseReply = r; });
    await askAi(Q1);

    // 服务端说「思考中」、字还没出来：一处动效，不是空气泡加一个转圈
    await waitFor(() => backend.state.messages.some(m => m.senderKind === 'user'), '提问已存');
    await waitFor(() => busyMarks().length === 1 && questionBubbles(Q1) === 1, '思考中的动效');
    expect(busyMarks()[0].textContent).toContain('正在思考');

    backend.state.streamThinkGate = null;
    releaseThink();
    await waitFor(() => panelText().includes(`关于「${Q1}」，`), '前半句出来了');
    expect(busyMarks()).toHaveLength(0);
    expect(typingDots()).toHaveLength(1);

    backend.state.streamGate = null;
    releaseReply();
    await waitFor(() => panelText().includes(R1) && !aiBusy(), '回复说完');
    expect(typingDots()).toHaveLength(0);
    expect(busyMarks()).toHaveLength(0);
  });
});

describe('我的笔记：自己写的浅蓝底；工具栏「我的笔记」一条一条跳过去（2026-10-05）', () => {
  const MINE_OLD = '00000000-0000-4000-8000-0000000000b1';
  const MINE_NEW = '00000000-0000-4000-8000-0000000000b2';
  const AI_MINE = '00000000-0000-4000-8000-0000000000b3';
  const card = (title: string) => noteCard(title)!.closest('.gsap-note-item') as HTMLElement;
  const isMineCard = (title: string) => card(title).matches('[data-mine]') || Boolean(card(title).querySelector('[data-mine]'));
  const hasMeTag = (title: string) => Array.from(card(title).querySelectorAll('span')).some(s => s.textContent === '我');
  const canvasTransform = () => {
    let el: HTMLElement | null = card('被接的观点').parentElement;
    while (el && !el.style.transform.includes('scale(')) el = el.parentElement;
    return el?.style.transform ?? '';
  };
  const mineButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="我的笔记"]');
  const bar = () => document.querySelector<HTMLElement>('[role="toolbar"][aria-label="我的笔记"]');

  beforeEach(() => {
    backend.state.notes.push(
      apiNote(MINE_OLD, '我先写的一条', 300, 1800, { author_id: 'user-1', users: { name: '测试学生' }, created_at: '2026-09-21T08:00:00.000Z' }),
      apiNote(MINE_NEW, '我后写的一条', 3000, 300, { author_id: 'user-1', users: { name: '测试学生' }, created_at: '2026-09-22T08:00:00.000Z' }),
      apiNote(AI_MINE, '采纳后发布的反馈', 600, 600, { author_id: 'user-1', is_ai_generated: true, type: 'ai_dialogue' }),
    );
  });

  it('自己写的卡片浅蓝底、名字旁有「我」；别人的、记在我名下但 AI 写的都不算', async () => {
    await mount();
    expect(isMineCard('我先写的一条')).toBe(true);
    expect(hasMeTag('我先写的一条')).toBe(true);
    expect(isMineCard('被接的观点')).toBe(false);
    expect(hasMeTag('被接的观点')).toBe(false);
    expect(isMineCard('采纳后发布的反馈')).toBe(false);
  });

  it('点「我的笔记」：别人的卡片变淡；从最新的一条开始，下一条、上一条把画布移过去；Esc 退出', async () => {
    await mount();
    const before = canvasTransform();
    await click(mineButton()!);
    const toolbar = await waitFor(() => bar(), '我的笔记细栏');
    expect(toolbar.textContent).toContain('1 / 2');
    expect(mineButton()!.getAttribute('aria-pressed')).toBe('true');
    expect(card('被接的观点').className).toContain('opacity-30');
    expect(card('采纳后发布的反馈').className).toContain('opacity-30');
    expect(card('我后写的一条').className).not.toContain('opacity-30');
    const atNewest = canvasTransform();
    expect(atNewest).not.toBe(before);

    await click(bar()!.querySelector('button[aria-label="下一条"]')!);
    expect(bar()!.textContent).toContain('2 / 2');
    const atOlder = canvasTransform();
    expect(atOlder).not.toBe(atNewest);

    // 到头了接着从第一条来
    await click(bar()!.querySelector('button[aria-label="下一条"]')!);
    expect(bar()!.textContent).toContain('1 / 2');
    expect(canvasTransform()).toBe(atNewest);
    await click(bar()!.querySelector('button[aria-label="上一条"]')!);
    expect(bar()!.textContent).toContain('2 / 2');

    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(bar()).toBeNull();
    expect(card('被接的观点').className).not.toContain('opacity-30');
  });

  it('这个视图里一条自己的都没有：细栏照实说，别人的照样变淡', async () => {
    backend.state.notes = backend.state.notes.filter(n => n.author_id !== 'user-1' || n.is_ai_generated);
    await mount();
    await click(mineButton()!);
    const toolbar = await waitFor(() => bar(), '我的笔记细栏');
    expect(toolbar.textContent).toContain('这个视图里还没有你写的笔记');
    expect(toolbar.querySelector('button[aria-label="下一条"]')).toBeNull();
  });
});

describe('笔记页 AI：回答长度（2026-10-05）', () => {
  const streamBodies = () => backend.state.requests
    .filter(r => r.method === 'POST' && /^\/note-conversations\/[^/]+\/ai\/(?:agent-)?stream$/.test(r.path))
    .map(r => r.body);

  it('输入框下面有「回答长度」；提问时带上学生选的档位（默认适中）', async () => {
    localStorage.removeItem('hakcc-answer-length');
    await mount();
    await openNote('被接的观点');
    await openAiPanel();
    const select = await waitFor(() => document.querySelector<HTMLSelectElement>('select[aria-label="回答长度"]'), '回答长度');
    expect(select.value).toBe('medium');

    await act(async () => {
      select.value = 'long';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await askAi('为什么检索练习有效？');
    await waitFor(() => streamBodies().length > 0, '提问请求');
    expect(streamBodies()[0].answer_length).toBe('long');
  });

  it('画图按钮配上了字，不再只是一个图标', async () => {
    await mount();
    await openNote('被接的观点');
    await openAiPanel();
    const button = await waitFor(() => document.querySelector<HTMLButtonElement>('button[aria-label="让 AI 画一张配图"]'), '画图按钮');
    expect(button.textContent).toContain('画图');
  });
});

/**
 * 2026-10-07：只挂附件、不写问题时，以前替学生补一句「看看这张图，说说你看到了什么。」当成提问存进库
 * （附的是文档也这么说）。现在要写一句才能发，和知识空间助手一样；AI 中途报错时问题和附件放回输入框。
 */
describe('笔记页 AI：附件要配一句问题；出错时问题和附件放回输入框', () => {
  const Q = '这一章的主要观点是什么？';
  /** AI 面板：包着对话区的那个 aside，里面只有一个输入框、一个回形针、一个发送键 */
  const aiPanel = () => document.querySelector('[data-ai-scroll]')?.closest('aside') ?? null;
  const aiInput = () => aiPanel()?.querySelector<HTMLTextAreaElement>('textarea') ?? null;
  const sendButton = () => aiPanel()!.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!;
  const chips = () => Array.from(aiPanel()!.querySelectorAll('button[aria-label^="移除这个附件: "]'))
    .map(b => b.getAttribute('aria-label')!.slice('移除这个附件: '.length));
  const streamBodies = () => backend.state.requests
    .filter(r => r.method === 'POST' && /^\/note-conversations\/[^/]+\/ai\/(?:agent-)?stream$/.test(r.path))
    .map(r => r.body);
  const enabledSend = () => waitFor(() => (sendButton().disabled ? null : sendButton()), '发送键亮起');

  /** 打开笔记的 AI 助手，用输入框下面的回形针传一份 PDF；返回没挂附件时输入框里的提示 */
  async function openWithPdf() {
    await mount();
    await openNote('被接的观点');
    await openAiPanel();
    await waitFor(() => aiInput(), 'AI 输入框');
    const plainHint = aiInput()!.placeholder;
    const picker = aiPanel()!.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['%PDF-1.4 第三章'], '第三章.pdf', { type: 'application/pdf' });
    await act(async () => {
      Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => chips().includes('第三章.pdf'), '附件挂上输入框');
    return plainHint;
  }

  it('只挂了文件、没写问题：发送键灰着、回车不发，输入框提示写一句；写了才发，存下的提问是学生自己的话', async () => {
    const plainHint = await openWithPdf();
    expect(aiInput()!.placeholder).toBe('想问这份文件什么？写一句再发送');
    expect(sendButton().disabled).toBe(true);
    await act(async () => { aiInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await settle(50);
    expect(streamBodies()).toEqual([]);

    await typeInto(aiInput()!, Q);
    await click(await enabledSend());
    await waitFor(() => streamBodies().length === 1 && !aiBusy(), '这一问答完');
    expect(streamBodies()[0]).toMatchObject({
      content: Q,
      attachments: [expect.objectContaining({ file_name: '第三章.pdf', mime_type: 'application/pdf', text: '第三章讲检索练习。' })],
    });
    expect(backend.state.messages.filter(m => m.senderKind === 'user').map(m => m.content)).toEqual([Q]);
    expect(chips()).toEqual([]);
    expect(aiInput()!.placeholder).toBe(plainHint);
  });

  it('AI 一个字没答就报错：提问照旧留在对话里，问题和附件放回输入框，直接再发一次', async () => {
    await openWithPdf();
    backend.state.streamError = '模型暂时不可用';
    await typeInto(aiInput()!, Q);
    await click(await enabledSend());
    await waitFor(() => document.body.textContent?.includes('模型暂时不可用') && !aiBusy(), '这一轮出错结束');

    expect(questionBubbles(Q)).toBe(1);
    expect(aiInput()!.value).toBe(Q);
    expect(chips()).toEqual(['第三章.pdf']);

    backend.state.streamError = null;
    await click(await enabledSend());
    await waitFor(() => streamBodies().length === 2 && !aiBusy(), '再发一次答完');
    expect(streamBodies()[1]).toMatchObject({ content: Q, attachments: [expect.objectContaining({ file_name: '第三章.pdf' })] });
    expect(chips()).toEqual([]);
  });
});

describe('问题栏后面滚动的讨论主题（2026-10-05）', () => {
  const ticker = () => document.querySelector<HTMLElement>('[data-view-topics]');
  const card = (title: string) => noteCard(title)!.closest('.gsap-note-item') as HTMLElement;

  it('没有主题：问题栏照旧，没有多出来的东西', async () => {
    await mount();
    await settle(20);
    expect(ticker()).toBeNull();
  });

  it('有主题：直接接在问题后面，没有引导语；点一个主题，画布移过去，相关笔记亮起来', async () => {
    backend.state.viewTopics = [
      { label: '远处的争论', noteIds: [FAR_ID], count: 1 },
      { label: '被接的观点', noteIds: [PARENT_ID], count: 1 },
    ];
    await mount();
    const strip = await waitFor(() => ticker(), '讨论主题');
    expect(strip.textContent).toContain('远处的争论');
    expect(strip.textContent).toContain('· 1');
    expect(strip.closest('div')!.parentElement!.textContent).not.toContain('大家在聊');
    expect(backend.state.requests.some(r => /view-topics\?view_id=view-welcome/.test(r.path))).toBe(true);

    let transformBefore = '';
    let el: HTMLElement | null = card('远处的观点').parentElement;
    while (el && !el.style.transform.includes('scale(')) el = el.parentElement;
    transformBefore = el!.style.transform;

    await click([...strip.querySelectorAll('button')].find(b => b.textContent?.includes('远处的争论'))!);
    expect(card('远处的观点').className).toContain('ring-amber-400');
    expect(card('被接的观点').className).not.toContain('ring-amber-400');
    expect(el!.style.transform).not.toBe(transformBefore);
  });
});

/**
 * 2026-10-06：笔记页从「撰写」切到「信息」再切回来，编辑区是空的，点「贡献」就把空正文 PUT 进库。
 * 编辑器内部的各种情形在 noteEditorTabSwitch.test.ts；这里只走一遍学生的原操作，看发出去的请求。
 */
describe('笔记页切过页签再贡献', () => {
  const MINE_ID = '00000000-0000-4000-8000-000000000004';
  const MINE_HTML = '<p>植物向光生长，是因为背光一侧长得快。</p>';
  const editorBody = () => document.querySelector<HTMLElement>('[contenteditable][data-placeholder]');
  /** 编辑器顶栏的页签。页面上还有别的 nav，按「撰写」认出编辑器那一排 */
  const tabButton = (label: string) => {
    const nav = all('nav').find(n => Array.from(n.querySelectorAll('button')).some(b => b.textContent?.trim() === '撰写'));
    return Array.from(nav?.querySelectorAll('button') ?? []).find(b => b.textContent?.trim() === label)!;
  };
  const putsToMine = () => noteUpdates().filter(r => r.path === `/notes/${MINE_ID}`);

  it('自己的笔记：「信息」→「撰写」→「贡献」，PUT 带的是原来的正文，不是空串', async () => {
    backend.state.notes.push(apiNote(MINE_ID, '我自己的观点', 600, 600, {
      author_id: USER.id, users: { name: USER.name }, content: MINE_HTML,
    }));
    await mount();
    await openNote('我自己的观点');
    await waitFor(() => editorBody()?.textContent?.includes('背光一侧长得快'), '正文载入');

    await click(tabButton('信息'));
    await click(tabButton('撰写'));
    expect(editorBody()!.innerHTML).toBe(MINE_HTML);

    await click(buttonWith('贡献')!);
    await waitFor(() => putsToMine().length > 0, '保存请求');
    expect(putsToMine()).toHaveLength(1);
    expect(putsToMine()[0].body).toMatchObject({ title: '我自己的观点', content: MINE_HTML });
  });
});
