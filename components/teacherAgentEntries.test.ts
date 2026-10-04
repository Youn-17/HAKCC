// @vitest-environment jsdom
/**
 * 教师端四个 AI 入口（AI 对话 / 备课助手 / 学情分析 / 教学评估）在 Dashboard 里渲染在同一个位置。
 * PersonalAgentPage 的模式只在挂载时定下来；以前不按入口给 key，侧栏切换入口时 React 复用同一个实例：
 * 先开备课助手再去学情分析，发出去的还是 lesson_planner；上一个入口的消息和会话也跟过来，
 * 下一句话接进上一个入口的会话（module 还是旧的），历史不再按入口分开。
 *
 * 挂 Dashboard 真正渲染的 TeacherAgentEntry，后端换成进程内的假服务：和真后端一样，会话在回复之前
 * 按请求里的 module 建好，用户消息先存，回复说完才存。同一个 root 换 tab 再 render 一次，就是侧栏切换入口。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.hoisted(() => {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

vi.mock('../services/supabaseClient', () => ({ supabase: {} }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'teacher-1', name: '测试教师', email: 'teacher@example.test', role: 'teacher' } }),
}));

import { TeacherAgentEntry } from './Dashboard';

// ── 假后端 ──────────────────────────────────────────────────────

const TEACHES = { id: 'c-teach', title: '自己教的课', standing: 'owner', teacherModes: true };

interface Req { method: string; path: string; body: any }
interface StoredConversation {
  id: string;
  module: string;
  agent_mode: string;
  title: string;
  messages: { id: string; role: 'user' | 'assistant'; content: string }[];
}

function createBackend() {
  const requests: Req[] = [];
  const conversations: StoredConversation[] = [];
  const state = { streamGate: null as Promise<void> | null };
  let seq = 0;
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

  function stream(body: any): Response {
    // 真后端只核对会话归属，不核对 module：带上别的入口的 conversation_id 就接进那段会话
    let conv = conversations.find(c => c.id === body.conversation_id);
    if (!conv) {
      conv = { id: `conv-${conversations.length + 1}`, module: body.module ?? 'chat', agent_mode: body.agent_mode, title: body.content, messages: [] };
      conversations.push(conv);
    }
    const target = conv;
    target.messages.push({ id: `msg-${++seq}`, role: 'user', content: body.content });

    const reply = `收到：${body.content}`;
    const gate = state.streamGate;
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`));
    void (async () => {
      send({ token: reply });
      if (gate) await gate;
      const saved = { id: `msg-${++seq}`, role: 'assistant' as const, content: reply };
      target.messages.push(saved);
      send({ assistantMessage: { id: saved.id, content: reply, tools_used: [] } });
      send({ done: true, conversationId: target.id });
      send('[DONE]');
      controller.close();
    })();
    return new Response(readable, { status: 200 });
  }

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body });

    if (method === 'GET' && path === '/personal-agent/configs') {
      return json({
        courses: [TEACHES],
        configs: [{ courseId: TEACHES.id, providerId: 'deepseek', isVerified: true, enabledModels: ['deepseek-flash'] }],
      });
    }
    if (method === 'GET' && path === '/personal-agent/conversations') {
      const module = url.searchParams.get('module');
      return json({
        conversations: conversations
          .filter(c => !module || c.module === module)
          .map(c => ({ id: c.id, title: c.title, agent_mode: c.agent_mode, module: c.module, course_id: TEACHES.id, updated_at: '2026-09-28T08:00:00Z' })),
      });
    }
    const messagesOf = path.match(/^\/personal-agent\/conversations\/([^/]+)\/messages$/);
    if (method === 'GET' && messagesOf) {
      const conv = conversations.find(c => c.id === messagesOf[1]);
      return json({ messages: (conv?.messages ?? []).map(m => ({ ...m, tools_used: [] })) });
    }
    if (method === 'POST' && path === '/personal-agent/stream') return stream(body);
    // 三个面板的其余接口：各种列表都给空的
    return json({
      conversations: [], plans: [], profiles: [], memories: [], runs: [], items: [], trend: [], feedback: [],
      summary: {}, stats: {}, triggers: [], ok: true,
    });
  });

  return {
    conversations, state, fetchStub,
    streamBodies: () => requests.filter(r => r.path === '/personal-agent/stream').map(r => r.body),
  };
}

// ── 挂载与操作 ──────────────────────────────────────────────────

let backend: ReturnType<typeof createBackend>;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let releaseHeldReplies: (() => void) | null = null;

const TITLES: Record<string, string> = {
  'agent-chat': 'AI 对话',
  'agent-lesson': '备课助手',
  'agent-analytics': '学情分析',
  'agent-assess': '教学评估',
};

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

const hasText = (text: string) => document.body.textContent?.includes(text) ?? false;
const textarea = () => document.querySelector('textarea');

/** 侧栏点一个入口：Dashboard 在同一个位置换 tab 再渲染一次 */
async function openEntry(tab: keyof typeof TITLES) {
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(React.createElement(MemoryRouter, null, React.createElement(TeacherAgentEntry, { tab, lang: 'zh' })));
  });
  await waitFor(
    () => document.querySelector('header h1')?.textContent === TITLES[tab] && !hasText('加载配置中'),
    `${TITLES[tab]}加载完`,
  );
}

async function send(text: string, { waitForReply = true } = {}) {
  const box = textarea();
  if (!box || box.disabled) throw new Error(`输入框${box ? '不可用' : '不存在'}，发不出「${text}」`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const before = backend.streamBodies().length;
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[title="发送"]')!.click();
  });
  await waitFor(() => backend.streamBodies().length > before, `发出「${text}」`);
  if (waitForReply) await waitFor(() => hasText(`收到：${text}`) && !textarea()?.disabled, `「${text}」的回复`);
  return backend.streamBodies().at(-1);
}

/** 接下来的回复说到一半停住，直到调用返回的函数 */
function holdReplies() {
  let release!: () => void;
  backend.state.streamGate = new Promise<void>(r => { release = r; });
  releaseHeldReplies = release;
  return release;
}

/** 历史对话抽屉里列出的对话（标题），按每行的删除按钮找 */
const historyRows = () => Array.from(document.querySelectorAll('button[aria-label="删除对话"]'))
  .map(del => ({ title: del.previousElementSibling?.querySelector('span')?.textContent ?? '', open: del.previousElementSibling as HTMLButtonElement }));

async function restore(title: string) {
  const row = await waitFor(() => historyRows().find(r => r.title === title), `历史里的「${title}」`);
  await act(async () => { row.open.click(); });
  await waitFor(() => hasText(`收到：${title}`), `「${title}」载入`);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('hakcc-language', 'zh');
  backend = createBackend();
  vi.stubGlobal('fetch', backend.fetchStub);
});

afterEach(async () => {
  releaseHeldReplies?.();
  releaseHeldReplies = null;
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

// ── 切换入口 ────────────────────────────────────────────────────

describe('教师端切换 AI 入口', () => {
  it('先开备课助手再切到学情分析：学情分析按 teaching_analyst 发，不是 lesson_planner', async () => {
    await openEntry('agent-lesson');
    await openEntry('agent-analytics');

    expect(await send('哪些学生需要关注')).toMatchObject({
      agent_mode: 'teaching_analyst', module: 'analytics', course_id: 'c-teach',
    });
  });

  it('AI 对话里聊过再切到学情分析：不接上一个入口的会话，也不把那段对话当上下文发出去', async () => {
    await openEntry('agent-chat');
    const first = await send('帮我设计一节课');
    expect(first).toMatchObject({ agent_mode: 'lesson_planner', module: 'chat' });
    expect(first).not.toHaveProperty('conversation_id');

    await openEntry('agent-analytics');
    expect(hasText('收到：帮我设计一节课')).toBe(false);

    const body = await send('哪些学生需要关注');
    expect(body).toMatchObject({ agent_mode: 'teaching_analyst', module: 'analytics', history: [] });
    expect(body).not.toHaveProperty('conversation_id');
    // 两个入口各一段会话，AI 对话那段只有它自己的一问一答
    expect(backend.conversations.map(c => [c.module, c.messages.length])).toEqual([['chat', 2], ['analytics', 2]]);
  });

  it('学情分析切到教学评估：模式一样，也各开各的会话', async () => {
    await openEntry('agent-analytics');
    await send('这周参与度怎么样');

    await openEntry('agent-assess');
    const body = await send('这学期的反馈效果如何');
    expect(body).toMatchObject({ agent_mode: 'teaching_analyst', module: 'assessment', history: [] });
    expect(body).not.toHaveProperty('conversation_id');
    expect(backend.conversations.map(c => c.module)).toEqual(['analytics', 'assessment']);
  });

  it('切回原来的入口：界面从头开始，历史里只有这个入口的对话，点开能接着聊', async () => {
    await openEntry('agent-analytics');
    await send('这周参与度怎么样');
    await openEntry('agent-assess');
    await send('这学期的反馈效果如何');

    await openEntry('agent-analytics');
    expect(hasText('收到：这周参与度怎么样')).toBe(false);
    expect(hasText('收到：这学期的反馈效果如何')).toBe(false);
    await waitFor(() => historyRows().length > 0, '学情分析的历史列表');
    expect(historyRows().map(r => r.title)).toEqual(['这周参与度怎么样']);

    await restore('这周参与度怎么样');
    const body = await send('那下周呢');
    expect(body).toMatchObject({ agent_mode: 'teaching_analyst', module: 'analytics', conversation_id: 'conv-1' });
    expect(body.history).toEqual([
      { role: 'user', content: '这周参与度怎么样' },
      { role: 'assistant', content: '收到：这周参与度怎么样' },
    ]);
  });

  it('回复还没说完就切走：新入口马上能用，旧回复不串过来，切回去能从历史里找回', async () => {
    await openEntry('agent-chat');
    const finishReply = holdReplies();
    await send('帮我设计一节课', { waitForReply: false });
    await waitFor(() => hasText('收到：帮我设计一节课'), '回复说到一半');
    backend.state.streamGate = null;

    await openEntry('agent-analytics');
    expect(textarea()?.disabled).toBe(false);
    expect(hasText('收到：帮我设计一节课')).toBe(false);
    const body = await send('哪些学生需要关注');
    expect(body).toMatchObject({ agent_mode: 'teaching_analyst', module: 'analytics', history: [] });
    expect(body).not.toHaveProperty('conversation_id');

    await act(async () => { finishReply(); });
    await settle(20);
    expect(hasText('收到：帮我设计一节课')).toBe(false);

    await openEntry('agent-chat');
    await restore('帮我设计一节课');
    expect(historyRows().map(r => r.title)).toEqual(['帮我设计一节课']);
  });
});
