// @vitest-environment jsdom
/**
 * 知识空间 AI 助手面板：挂真组件，后端换成进程内的假服务。
 *
 * 1. 历史「从来不保留」：后端一直在存对话，面板从不读回来。打开时要接着这个空间里最近的一段，
 *    「历史对话」里能翻以前的、切换过去；别的空间的对话不接。
 * 2. 学生在读回完成之前就问了：读回的结果不能盖掉他眼前的。
 * 3. 版面：顶上一行、讨论速览收成一行、默认占屏幕一半。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  Object.assign(globalThis, { ResizeObserver: NoopObserver, IntersectionObserver: NoopObserver, IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

import WorkspaceAgentPanel, { type WorkspaceAgentPanelProps } from './WorkspaceAgentPanel';
import { resetAnswerLengthForTests } from './answerLengthPref';

const COURSE = 'course-1';
const SPACE = 'space-1';

interface Req { method: string; path: string; query: URLSearchParams; body: any }
interface Conv { id: string; title: string; updated_at: string; space_id: string | null }
interface Msg { id: string; role: 'user' | 'assistant'; content: string; tools_used?: string[]; created_at: string }

function createBackend() {
  const state = {
    requests: [] as Req[],
    conversations: [
      { id: 'c-new', title: '谁在 Build-on 谁？', updated_at: '2026-10-04T10:00:00Z', space_id: SPACE },
      { id: 'c-old', title: '这个空间里大家在争论什么？', updated_at: '2026-10-01T10:00:00Z', space_id: SPACE },
      { id: 'c-other', title: '别的空间里的问题', updated_at: '2026-10-05T10:00:00Z', space_id: 'space-2' },
    ] as Conv[],
    messages: {
      'c-new': [
        { id: 'm1', role: 'user', content: '谁在 Build-on 谁？', created_at: '1' },
        { id: 'm2', role: 'assistant', content: '「间隔也重要」Build-on 了「检索练习为什么有效」。', tools_used: ['get_note_context'], created_at: '2' },
      ],
      'c-old': [
        { id: 'm3', role: 'user', content: '这个空间里大家在争论什么？', created_at: '1' },
        { id: 'm4', role: 'assistant', content: '争论的是重读还是回想更有效。', created_at: '2' },
      ],
      'c-other': [{ id: 'm5', role: 'assistant', content: '别的空间的回答', created_at: '1' }],
    } as Record<string, Msg[]>,
    /** 设了它，对话列表的答复卡在这里，直到测试放行 */
    listGate: null as Promise<void> | null,
    /** 设了它，读消息的答复卡在这里，直到测试放行（列表已经回来了，面板正在读那一段） */
    messagesGate: null as Promise<void> | null,
    /** 设了它，列表请求直接 500 */
    listFails: false,
    /** 设了它，回答说完前半句就停在这里 */
    streamGate: null as Promise<void> | null,
    /** 设了它，第一个字之前停在这里（「正在思考」） */
    streamHeadGate: null as Promise<void> | null,
    /** 设了它，提问请求直接被拒（限流、没配 AI 等），流根本没开始 */
    streamReject: null as { status: number; error: string } | null,
    /** 设了它，一个字没答就推一条 error，照样收尾（真后端最后一家也失败时就是这样） */
    streamFailure: null as string | null,
    /** 设了它，说完前半句（过了 streamGate）连接就断了 */
    streamDrop: false,
    seq: 0,
  };

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  async function handle(method: string, path: string, query: URLSearchParams, body: any): Promise<Response> {
    if (method === 'GET' && path === '/ai/usage') {
      return json({ usage: { today: 3, total: 40, daily_limit: 50, remaining: 47 } });
    }
    if (method === 'GET' && path === `/workspace-agent/${COURSE}/conversations`) {
      const gate = state.listGate;
      if (gate) await gate;
      if (state.listFails) return json({ error: 'boom' }, 500);
      const space = query.get('space_id');
      const list = state.conversations
        .filter(c => !space || c.space_id === space)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return json({ conversations: list });
    }
    const messages = path.match(new RegExp(`^/workspace-agent/${COURSE}/conversations/([^/]+)/messages$`));
    if (method === 'GET' && messages) {
      const gate = state.messagesGate;
      if (gate) await gate;
      return json({ messages: state.messages[messages[1]] ?? [] });
    }
    if (method === 'POST' && path === `/workspace-agent/${COURSE}/stream`) {
      if (state.streamReject) return json({ error: state.streamReject.error }, state.streamReject.status);
      const encoder = new TextEncoder();
      const id = body.conversation_id ?? `c-created-${++state.seq}`;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`));
          if (state.streamHeadGate) await state.streamHeadGate;
          if (state.streamFailure) {
            send({ error: state.streamFailure });
            send({ done: true, conversationId: id });
            send('[DONE]');
            controller.close();
            return;
          }
          send({ token: '这是' });
          if (state.streamGate) await state.streamGate;
          if (state.streamDrop) { controller.error(new TypeError('network error')); return; }
          send({ token: 'AI 的回答' });
          send({ done: true, conversationId: id });
          send('[DONE]');
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }
    return json({});
  }

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    state.requests.push({ method, path, query: url.searchParams, body });
    return handle(method, path, url.searchParams, body);
  });
  return { state, fetchStub };
}

// ── 挂载与操作 ───────────────────────────────────────────────

let root: Root;
let container: HTMLDivElement;
let backend: ReturnType<typeof createBackend>;

const flush = async (rounds = 6) => {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

const baseProps = (over: Partial<WorkspaceAgentPanelProps> = {}): WorkspaceAgentPanelProps => ({
  isOpen: true,
  onClose: () => undefined,
  courseId: COURSE,
  spaceId: SPACE,
  userRole: 'student',
  lang: 'zh',
  aiConfigs: [{ providerId: 'deepseek', enabledModels: ['deepseek-chat'] }],
  spaceNotes: [{ id: 'n1', title: '检索练习为什么有效', author: '同学甲' }],
  ...over,
});

async function mount(over: Partial<WorkspaceAgentPanelProps> = {}) {
  await act(async () => { root.render(React.createElement(WorkspaceAgentPanel, baseProps(over))); });
  await flush();
}

const panelText = () => container.textContent ?? '';
const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const click = async (el: Element | null) => {
  expect(el, '要点的元素不存在').not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
const historyItems = () => [...container.querySelectorAll<HTMLButtonElement>('[data-ws-agent-history] [data-conversation-id]')];
const listRequests = () => backend.state.requests.filter(r => r.path === `/workspace-agent/${COURSE}/conversations`);
const messageRequests = () => backend.state.requests.filter(r => /\/messages$/.test(r.path));
const streamRequests = () => backend.state.requests.filter(r => r.path === `/workspace-agent/${COURSE}/stream`);

async function ask(question: string) {
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, question);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(byLabel('发送'));
  await flush(10);
}

beforeEach(() => {
  localStorage.clear();
  resetAnswerLengthForTests();
  window.innerWidth = 1200;
  backend = createBackend();
  vi.stubGlobal('fetch', backend.fetchStub);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe('历史对话：打开面板时读回这个空间里最近的一段', () => {
  it('接着最近的一段：显示当时的提问和回答，工具标签也在；只读这个空间的，别的空间的对话不接', async () => {
    await mount();

    expect(listRequests()).toHaveLength(1);
    expect(listRequests()[0].query.get('space_id')).toBe(SPACE);
    expect(messageRequests().map(r => r.path)).toEqual([`/workspace-agent/${COURSE}/conversations/c-new/messages`]);
    expect(panelText()).toContain('「间隔也重要」Build-on 了「检索练习为什么有效」。');
    // 用过的工具收成一行「用了 1 步」，点开才看到每一步（2026-10-05）
    expect(panelText()).toContain('用了 1 步');
    expect(panelText()).not.toContain('查看 Build-on 关系');
    await click(container.querySelector('[data-agent-process="done"] button'));
    expect(panelText()).toContain('查看 Build-on 关系');
    expect(panelText()).not.toContain('别的空间的回答');
  });

  it('接着聊：下一句带着这段对话的 id', async () => {
    await mount();
    await ask('再说说哪些笔记还没人 Build-on');

    expect(streamRequests()).toHaveLength(1);
    expect(streamRequests()[0].body.conversation_id).toBe('c-new');
    expect(streamRequests()[0].body.space_id).toBe(SPACE);
    expect(panelText()).toContain('这是AI 的回答');
  });

  it('这个空间还没聊过：显示空白提示，不去读消息', async () => {
    backend.state.conversations = backend.state.conversations.filter(c => c.space_id !== SPACE);
    await mount();

    expect(messageRequests()).toEqual([]);
    expect(panelText()).toContain('一起推进社区的知识');
  });

  it('面板关着的时候不去读；打开才读，且只读一次', async () => {
    await mount({ isOpen: false });
    expect(listRequests()).toEqual([]);

    await mount({ isOpen: true });
    expect(listRequests()).toHaveLength(1);
    await mount({ isOpen: false });
    await mount({ isOpen: true });
    expect(listRequests()).toHaveLength(1);
  });

  it('读不回来也不碍事：照常能问，下次打开再试', async () => {
    backend.state.listFails = true;
    await mount();
    expect(panelText()).toContain('一起推进社区的知识');
    expect(container.querySelector('textarea')!.disabled).toBe(false);

    backend.state.listFails = false;
    await mount({ isOpen: false });
    await mount({ isOpen: true });
    expect(listRequests()).toHaveLength(2);
    expect(panelText()).toContain('「间隔也重要」Build-on 了');
  });

  it('学生在读回完成之前就问了：读回的结果不盖掉他眼前的', async () => {
    let release!: () => void;
    backend.state.listGate = new Promise<void>(done => { release = done; });
    await mount();
    expect(panelText()).toContain('正在打开上次的对话');

    await ask('我先问一句');
    expect(panelText()).toContain('我先问一句');
    release();
    await flush(10);

    expect(panelText()).toContain('我先问一句');
    expect(panelText()).not.toContain('「间隔也重要」Build-on 了');
    expect(messageRequests()).toEqual([]);
    // 这一问开的是新对话，不带别的对话的 id
    expect(streamRequests()[0].body.conversation_id).toBeUndefined();
  });
});

describe('读回的第二个空档：列表回来了、正在读那一段消息', () => {
  it('学生这时问了，读回的消息同样不盖掉他眼前的', async () => {
    let release!: () => void;
    backend.state.messagesGate = new Promise<void>(done => { release = done; });
    await mount();
    expect(messageRequests()).toHaveLength(1);

    await ask('读的时候我又问了一句');
    release();
    await flush(10);

    expect(panelText()).toContain('读的时候我又问了一句');
    expect(panelText()).not.toContain('「间隔也重要」Build-on 了');
    expect(streamRequests()[0].body.conversation_id).toBeUndefined();
  });
});

describe('历史对话菜单', () => {
  it('列出这个空间里的对话，新的在前，眼前这段标出来；别的空间的不列', async () => {
    await mount();
    await click(byLabel('历史对话'));

    expect(historyItems().map(b => b.getAttribute('data-conversation-id'))).toEqual(['c-new', 'c-old']);
    expect(historyItems()[0].getAttribute('aria-current')).toBe('true');
    expect(historyItems()[1].getAttribute('aria-current')).toBeNull();
    expect(historyItems()[1].textContent).toContain('这个空间里大家在争论什么？');
  });

  it('点以前的一段：读回它的消息，面板换成那一段，菜单收起；接着聊用它的 id', async () => {
    await mount();
    await click(byLabel('历史对话'));
    await click(historyItems()[1]);

    expect(panelText()).toContain('争论的是重读还是回想更有效。');
    expect(panelText()).not.toContain('「间隔也重要」Build-on 了');
    expect(container.querySelector('[data-ws-agent-history]')).toBeNull();

    await ask('那结论呢');
    expect(streamRequests()[0].body.conversation_id).toBe('c-old');
  });

  it('没有历史时说「还没有历史对话」', async () => {
    backend.state.conversations = [];
    await mount();
    await click(byLabel('历史对话'));

    expect(container.querySelector('[data-ws-agent-history]')!.textContent).toContain('还没有历史对话');
  });

  it('聊完一轮：这段新对话出现在历史最前面，标题是第一句话', async () => {
    backend.state.conversations = [];
    await mount();
    await ask('这块画布上哪些提问还没人回应？');
    await click(byLabel('历史对话'));

    expect(historyItems()).toHaveLength(1);
    expect(historyItems()[0].textContent).toContain('这块画布上哪些提问还没人回应？');
    expect(historyItems()[0].getAttribute('aria-current')).toBe('true');
  });
});

describe('新对话', () => {
  it('探究建议只填入可编辑的问题，不自动发送', async () => {
    backend.state.conversations = [];
    await mount();
    const suggestion = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('梳理观点联系'))!;
    await click(suggestion);
    const input = container.querySelector('textarea')!;
    expect(input.value).toContain('哪些 Note 可以相互 Build-on');
    expect(document.activeElement).toBe(input);
    expect(streamRequests()).toEqual([]);
    await click(byLabel('发送'));
    expect(streamRequests()).toHaveLength(1);
  });

  it('输入法确认及 Shift+Enter 不发送，普通 Enter 才发送', async () => {
    await mount();
    const input = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '我的问题');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
      await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...options })); });
      expect(streamRequests()).toEqual([]);
    }
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await flush(10);
    expect(streamRequests()).toHaveLength(1);
  });

  it('清空面板；下一句不带旧对话的 id，另开一段', async () => {
    await mount();
    await click(byLabel('新对话'));

    expect(panelText()).not.toContain('「间隔也重要」Build-on 了');
    await ask('换个话题');
    expect(streamRequests()[0].body.conversation_id).toBeUndefined();
  });

  it('回答途中不能切：新对话和历史里的每一段都点不了', async () => {
    let release!: () => void;
    backend.state.streamGate = new Promise<void>(done => { release = done; });
    await mount();
    await ask('正在回答的一句');

    expect((byLabel('新对话') as HTMLButtonElement).disabled).toBe(true);
    await click(byLabel('历史对话'));
    expect(historyItems().every(b => b.disabled)).toBe(true);

    release();
    await flush(10);
    expect((byLabel('新对话') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('版面', () => {
  const panel = () => container.querySelector<HTMLElement>('[data-ws-agent-panel]')!;

  it('默认占屏幕的一半；拖宽过的记着，下次照那个宽度', async () => {
    window.innerWidth = 1200;
    await mount();
    expect(panel().style.width).toBe('600px');

    await act(async () => { root.unmount(); });
    localStorage.setItem('hakcc-ws-agent-width', '820');
    root = createRoot(container);
    await mount();
    expect(panel().style.width).toBe('820px');
  });

  it('范围选择在顶部，模型、回答长度和附件保留在输入区', async () => {
    await mount();

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(byLabel('新对话')).toBeTruthy();
    expect(byLabel('历史对话')).toBeTruthy();
    // 用量收成标题行右边的一小段字，不再占一整条
    expect(panelText()).toContain('3/50');
    // 模型和附件在输入框所在的那一块里，不在顶上
    const composer = container.querySelector('textarea')!.closest('[data-ai-composer]')!;
    expect(composer.querySelector('select[aria-label="模型"]')).not.toBeNull();
    expect(composer.querySelector('[aria-label="上传图片或文件"]')).not.toBeNull();
    expect(composer.querySelector('select[aria-label="回答长度"]')).not.toBeNull();
    const scope = byLabel('选择 Note');
    expect(scope.closest('[data-ai-composer]')).toBeNull();
    expect(scope.textContent).toContain('整个空间');
    await click(scope);
    await click(container.querySelector('.assistant-context-menu input[type="checkbox"]'));
    expect(scope.textContent).toContain('1');
    await ask('只讨论所选 Note');
    expect(streamRequests()[0].body.note_ids).toEqual(['n1']);
  });

  it('讨论速览默认收成一行，点开才出现「生成速览」', async () => {
    await mount();
    expect([...container.querySelectorAll('button')].some(b => b.textContent?.includes('生成速览'))).toBe(false);

    const toggle = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(b => b.textContent?.includes('讨论速览'))!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect([...container.querySelectorAll('button')].some(b => b.textContent?.includes('生成速览'))).toBe(true);
  });
});

/**
 * 2026-10-05：回答长度（简短 / 适中 / 详细）、「画图」按钮，以及从第二问起「思考中」不再显示的老问题。
 */
describe('回答长度、画图、第二问的等待提示', () => {
  const setText = async (value: string) => {
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const drawButton = () => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === '画图') ?? null;

  it('默认按「适中」发；改成「简短」，下一问就按简短发，选择记在本机', async () => {
    await mount();
    await ask('第一问');
    expect(streamRequests()[0].body.answer_length).toBe('medium');

    const select = byLabel('回答长度') as HTMLSelectElement;
    await act(async () => {
      select.value = 'short';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await ask('第二问');
    expect(streamRequests()[1].body.answer_length).toBe('short');
    expect(localStorage.getItem('hakcc-answer-length')).toBe('short');
  });

  it('「画图」：写了描述就直接出图（force_draw）；没写就先放个开头让学生接着写', async () => {
    await mount();
    await click(drawButton());
    expect(streamRequests()).toEqual([]);
    expect(container.querySelector('textarea')!.value).toBe('画一张：');

    await setText('一棵知识之树');
    await click(drawButton());
    expect(streamRequests()).toHaveLength(1);
    expect(streamRequests()[0].body).toMatchObject({ content: '一棵知识之树', force_draw: true });
  });

  it('发送按钮照常发，不带 force_draw', async () => {
    await mount();
    await ask('普通的提问');
    expect(streamRequests()[0].body.force_draw).toBeUndefined();
  });

  it('第二问也显示「思考中」：上一轮的临时消息答完就换了正式的 id', async () => {
    await mount();
    await ask('第一问');
    expect(panelText()).toContain('这是AI 的回答');

    // 第二问：让回答卡在第一个字之前
    let release!: () => void;
    backend.state.streamGate = new Promise<void>(r => { release = r; });
    const gateBeforeFirstToken = backend.state.streamGate;
    const originalHandle = backend.fetchStub.getMockImplementation()!;
    backend.fetchStub.mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.endsWith('/stream')) {
        backend.state.requests.push({ method: 'POST', path: url.pathname.replace(/^\/api/, ''), query: url.searchParams, body: JSON.parse(String(init?.body)) });
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            await gateBeforeFirstToken;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: '第二个回答' })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      return originalHandle(input, init);
    });
    await setText('第二问');
    await click(byLabel('发送'));
    expect(panelText()).toContain('正在思考');

    release();
    await flush(10);
    expect(panelText()).toContain('第二个回答');
  });
});

describe('回答时一步步显示在做什么（2026-10-05 用户：等的时候别让学生觉得无聊）', () => {
  it('等待时：工具先转圈、做完写结果和用时；字出来以后收成「用了 1 步」，点开能看', async () => {
    await mount();
    let releaseTool!: () => void;
    let releaseAnswer!: () => void;
    const toolGate = new Promise<void>(r => { releaseTool = r; });
    const answerGate = new Promise<void>(r => { releaseAnswer = r; });
    const original = backend.fetchStub.getMockImplementation()!;
    backend.fetchStub.mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      if (!url.pathname.endsWith('/stream')) return original(input, init);
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          send({ toolStatus: 'running', toolName: 'search_notes' });
          await toolGate;
          send({ toolStatus: 'used', toolName: 'search_notes', toolNames: ['search_notes'], toolSummary: '找到 5 条相关笔记', toolDurationMs: 820 });
          await answerGate;
          send({ token: '大家主要在讨论检索练习。' });
          send({ done: true, conversationId: 'c-new' });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }), { status: 200 });
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '大家在讨论什么？');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byLabel('发送'));
    const waiting = () => container.querySelector('[data-agent-process="waiting"]');
    expect(waiting()?.textContent).toContain('搜索相关笔记');
    expect(waiting()?.textContent).not.toContain('找到 5 条');

    releaseTool();
    await flush(6);
    expect(waiting()?.textContent).toContain('找到 5 条相关笔记');
    expect(waiting()?.textContent).toContain('0.8 秒');
    expect(waiting()?.textContent).toContain('正在组织回答');

    releaseAnswer();
    await flush(10);
    expect(waiting()).toBeNull();
    expect(panelText()).toContain('大家主要在讨论检索练习。');
    // 读回的上一段对话也有一行；这一问的是最后一个
    const done = [...container.querySelectorAll('[data-agent-process="done"]')].at(-1)!;
    expect(done.textContent).toContain('用了 1 步');
    await click(done.querySelector('button'));
    expect(done.textContent).toContain('找到 5 条相关笔记');
  });
});

/**
 * 2026-10-07：从阅读页「问知识空间助手」带着文件打开面板，学生直接按发送，后端回 400「content is required」，
 * 面板清掉的附件也不放回来。现在附件要配一句问题才能发；出错时问题和附件都放回输入框。
 */
describe('附件要配一句问题；出错时问题和附件放回输入框', () => {
  const PDF = { file_url: 'https://files.test/ch3.pdf', file_name: '第三章.pdf', mime_type: 'application/pdf', text: '第三章讲检索练习。' };
  const IMG = { file_url: 'https://files.test/board.png', file_name: 'board.png', mime_type: 'image/png' };
  const textarea = () => container.querySelector('textarea')!;
  const sendButton = () => byLabel('发送') as HTMLButtonElement;
  const chips = () => [...container.querySelectorAll('[aria-label^="移除: "]')].map(b => b.getAttribute('aria-label')!.slice('移除: '.length));
  /** 对话区（标着 aria-busy 的那一块） */
  const conversationText = () => container.querySelector('[aria-busy]')?.textContent ?? '';
  const type = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), value);
      textarea().dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  beforeEach(() => { backend.state.conversations = []; });

  it('带着文件打开、还没写问题：发送键灰着、回车也不发，输入框提示写一句；写了才发，带着附件', async () => {
    const taken = vi.fn();
    await mount({ pendingAttachment: PDF, onPendingAttachmentTaken: taken });
    expect(taken).toHaveBeenCalled();
    expect(chips()).toEqual(['第三章.pdf']);
    expect(textarea().placeholder).toBe('想问这份文件什么？写一句再发送');
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().title).toBe('想问这份文件什么？写一句再发送');

    await act(async () => { textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await flush(10);
    await type('   ');
    expect(sendButton().disabled).toBe(true);
    await act(async () => { textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await flush(10);
    expect(streamRequests()).toEqual([]);

    await type('这一章的主要观点是什么？');
    expect(sendButton().disabled).toBe(false);
    await click(sendButton());
    await flush(10);
    expect(streamRequests()).toHaveLength(1);
    expect(streamRequests()[0].body).toMatchObject({ content: '这一章的主要观点是什么？', attachments: [PDF] });
    // 答完了：附件不再挂着，提示回到平常的样子
    expect(conversationText()).toContain('这是AI 的回答');
    expect(chips()).toEqual([]);
    expect(textarea().placeholder).toBe('向智能体提问这个空间里的笔记…');
  });

  it('请求被拒（服务端没接下）：对话里那条提问撤掉，问题和附件放回输入框；再发一次照样带着附件', async () => {
    backend.state.streamReject = { status: 429, error: 'Too many requests. Please wait a moment.' };
    await mount({ pendingAttachment: PDF });
    await type('这一章的主要观点是什么？');
    await click(sendButton());
    await flush(10);

    expect(panelText()).toContain('Too many requests');
    expect(conversationText()).not.toContain('这一章的主要观点是什么？');
    expect(textarea().value).toBe('这一章的主要观点是什么？');
    expect(chips()).toEqual(['第三章.pdf']);

    backend.state.streamReject = null;
    await click(sendButton());
    await flush(10);
    expect(streamRequests()).toHaveLength(2);
    expect(streamRequests()[1].body).toMatchObject({ content: '这一章的主要观点是什么？', attachments: [PDF] });
    expect(conversationText().split('这一章的主要观点是什么？')).toHaveLength(2);
    expect(conversationText()).toContain('这是AI 的回答');
    expect(chips()).toEqual([]);
  });

  it('AI 一个字没答就报错（提问已存进库）：提问留在对话里，问题和附件放回输入框', async () => {
    backend.state.streamFailure = '所有模型暂时都不可用';
    await mount({ pendingAttachment: IMG });
    expect(textarea().placeholder).toBe('想问这张图什么？写一句再发送');
    await type('图里的箭头是什么意思？');
    await click(sendButton());
    await flush(10);

    expect(streamRequests()[0].body.attachments).toEqual([IMG]);
    expect(panelText()).toContain('所有模型暂时都不可用');
    expect(conversationText()).toContain('图里的箭头是什么意思？');
    expect(textarea().value).toBe('图里的箭头是什么意思？');
    expect(chips()).toEqual(['board.png']);
    expect(sendButton().disabled).toBe(false);
  });

  it('答到一半断网：写出的部分留着，问题和附件放回去；再问时照样显示「正在思考」', async () => {
    let releaseDrop!: () => void;
    backend.state.streamGate = new Promise<void>(r => { releaseDrop = r; });
    backend.state.streamDrop = true;
    await mount({ pendingAttachment: PDF });
    await type('第一问');
    await click(sendButton());
    expect(conversationText()).toContain('这是');
    releaseDrop();
    await flush(10);

    expect(panelText()).toContain('network error');
    expect(conversationText()).toContain('第一问');
    expect(conversationText()).toContain('这是');
    expect(textarea().value).toBe('第一问');
    expect(chips()).toEqual(['第三章.pdf']);

    backend.state.streamDrop = false;
    backend.state.streamGate = null;
    let releaseHead!: () => void;
    backend.state.streamHeadGate = new Promise<void>(r => { releaseHead = r; });
    await click(sendButton());
    expect(container.querySelector('[data-agent-process="waiting"]')?.textContent).toContain('正在思考');
    releaseHead();
    await flush(10);
    expect(conversationText()).toContain('这是AI 的回答');
  });
});
