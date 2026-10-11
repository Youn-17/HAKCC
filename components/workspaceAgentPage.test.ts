// @vitest-environment jsdom
/**
 * 知识空间智能体整页 + 导入笔记（2026-10-11 用户：智能体做成独立页面，生成的内容可以导入到指定的 Note）。
 * 挂真组件，后端换成进程内的假服务。
 *
 * 1. 点智能体直接就是整页：左栏是这个空间的历史对话，右栏是这段对话做出来的网页和回答，「返回画布」交回去。
 * 2. 导入一段回答：只列自己写的笔记，选笔记、选帮助，正文末尾接上带 AI 来源标记的一块，记一条插入记录。
 * 3. 导入网页：先挂到那条笔记上再写正文（之后看得到这条笔记的人都能打开）；挂不上就不动正文。
 * 4. 导入完：先让画布重拉笔记，再给「打开笔记」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** 屏幕够不够宽（≥ 80rem 才有右栏）；每个测试开始时是宽屏 */
const media = vi.hoisted(() => {
  const state = { wide: true };
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*80rem/.test(query) ? state.wide : false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  Object.assign(globalThis, { ResizeObserver: NoopObserver, IntersectionObserver: NoopObserver, IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  return state;
});

import WorkspaceAgentPanel, { groupConversationsByDay, threadTimeInGroup, type WorkspaceAgentPanelProps } from './WorkspaceAgentPanel';
import { resetAnswerLengthForTests } from './answerLengthPref';

const COURSE = 'course-1';
const SPACE = 'space-1';
const ME = 'u-me';
const ARTIFACT = { id: 'a1', groupId: 'a1', title: '检索练习对比表', version: 1, kind: 'html', bytes: 9000 };

interface Req { method: string; path: string; body: any }

function createBackend() {
  const state = {
    requests: [] as Req[],
    noteContent: '<p>原来的正文</p>',
    attachStatus: 200,
  };
  const conversations = [
    { id: 'c-new', title: '把观点整理成对比表', updated_at: '2026-10-11T10:00:00Z', space_id: SPACE },
    { id: 'c-old', title: '这个空间里大家在争论什么？', updated_at: '2026-10-01T10:00:00Z', space_id: SPACE },
  ];
  const messages: Record<string, unknown[]> = {
    'c-new': [
      { id: 'm1', role: 'user', content: '把检索练习的几种观点做成对比表网页', created_at: '1' },
      { id: 'm2', role: 'assistant', content: '做好了，点上面的卡片打开。重读和回想的差别在第二栏。', ai_metadata: { artifacts: [ARTIFACT] }, created_at: '2' },
    ],
    'c-old': [
      { id: 'm3', role: 'user', content: '这个空间里大家在争论什么？', created_at: '1' },
      { id: 'm4', role: 'assistant', content: '争论的是重读还是回想更有效。', created_at: '2' },
    ],
  };
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    state.requests.push({ method, path, body });
    if (method === 'GET' && path === '/ai/usage') return json({ usage: { today: 3, total: 40, daily_limit: 50, remaining: 47 } });
    if (method === 'GET' && path === `/workspace-agent/${COURSE}/conversations`) return json({ conversations });
    const msg = path.match(/^\/workspace-agent\/[^/]+\/conversations\/([^/]+)\/messages$/);
    if (method === 'GET' && msg) return json({ messages: messages[msg[1]] ?? [] });
    if (method === 'GET' && path === '/notes/n-mine') return json({ note: { id: 'n-mine', title: '我的笔记', content: state.noteContent } });
    if (method === 'PUT' && path === '/notes/n-mine') { state.noteContent = body.content; return json({ note: { id: 'n-mine' } }); }
    if (method === 'POST' && path === '/notes/n-mine/ai-insertions') return json({ insertion: {} });
    if (method === 'POST' && path === '/artifacts/a1/attach') {
      return state.attachStatus === 200 ? json({ ok: true }) : json({ error: 'Only the author of the note can attach a page' }, state.attachStatus);
    }
    return json({});
  });
  return { state, fetchStub };
}

let root: Root;
let container: HTMLDivElement;
let backend: ReturnType<typeof createBackend>;

const flush = async (rounds = 8) => {
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
  spaceNotes: [
    { id: 'n-other', title: '同学的笔记', author: '同学甲' },
    { id: 'n-mine', title: '我的笔记', author: '我', authorId: ME, updatedAt: '2026-10-10T08:00:00Z' },
  ],
  currentUserId: ME,
  layout: 'page',
  ...over,
});

async function mount(over: Partial<WorkspaceAgentPanelProps> = {}) {
  await act(async () => { root.render(React.createElement(WorkspaceAgentPanel, baseProps(over))); });
  await flush();
}

const click = async (el: Element | null | undefined) => {
  expect(el, '要点的元素不存在').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
const buttonIn = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text);
const dialog = () => document.querySelector<HTMLElement>('[data-import-dialog]');
const notesRequests = () => backend.state.requests.filter(r => r.path.startsWith('/notes/') || r.path.startsWith('/artifacts/'));

async function importVia(trigger: HTMLElement | null | undefined) {
  await click(trigger);
  const d = dialog()!;
  await click([...d.querySelectorAll('[role="radio"]')].find(el => el.textContent?.includes('我的笔记')));
  await click(buttonIn(d, '给了我没想到的角度'));
  await click(buttonIn(d, '导入'));
  await flush(10);
}

beforeEach(() => {
  media.wide = true;
  localStorage.clear();
  resetAnswerLengthForTests();
  window.innerWidth = 1400;
  backend = createBackend();
  vi.stubGlobal('fetch', backend.fetchStub);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('整页', () => {
  it('打开就是整页，没有右上角的关闭；关着时什么都不画，但组件不卸载：再打开还是刚才那段对话，不再读一遍', async () => {
    await mount();
    expect(container.querySelector('[data-ws-agent-page]')).not.toBeNull();
    expect(container.querySelector('[aria-label="关闭"]')).toBeNull();
    const reads = backend.state.requests.filter(r => /\/messages$/.test(r.path)).length;

    await mount({ isOpen: false });
    expect(container.querySelector('[data-ws-agent-page]')).toBeNull();
    expect(container.textContent).toBe('');

    await mount({ isOpen: true });
    expect(container.querySelector('.assistant-conversation')!.textContent).toContain('重读和回想的差别在第二栏');
    expect(backend.state.requests.filter(r => /\/messages$/.test(r.path)).length).toBe(reads);
  });

  it('左栏：这个空间的历史对话，眼前这段标出来；点另一段就换过去。「返回画布」交回去', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    const threads = container.querySelector<HTMLElement>('[data-ws-agent-threads]')!;
    expect(threads.textContent).toContain('把观点整理成对比表');
    expect(threads.querySelector('[aria-current="true"]')!.textContent).toContain('把观点整理成对比表');

    await click([...threads.querySelectorAll('button')].find(b => b.textContent?.includes('争论什么')));
    expect(container.querySelector('.assistant-conversation')!.textContent).toContain('争论的是重读还是回想更有效。');

    await click(buttonIn(container.querySelector('[data-ws-agent-page] header')!, '返回画布'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('右栏：这段对话做的网页（打开 / 导入笔记）和回答', async () => {
    await mount();
    const outputs = container.querySelector<HTMLElement>('[data-ws-agent-outputs]')!;
    expect(outputs.textContent).toContain('检索练习对比表');
    expect(outputs.textContent).toContain('第 1 版');
    expect(buttonIn(outputs, '打开')).toBeTruthy();
    expect(outputs.textContent).toContain('重读和回想的差别在第二栏');
  });
});

describe('整页版面（2026-10-11 用户：布局要整洁、大方好看）', () => {
  it('宽屏：参考范围和讨论速览在右栏，对话上方不再有那一行；在右栏里挑笔记，右栏写出挑了几条', async () => {
    await mount();
    const rail = container.querySelector<HTMLElement>('[data-ws-agent-outputs]')!;
    expect(container.querySelector('.assistant-panel .assistant-context-bar')).toBeNull();
    expect(rail.textContent).toContain('整个空间');
    expect(rail.textContent).toContain('讨论速览');

    await click(rail.querySelector('[aria-label="选择 Note"]'));
    const box = rail.querySelector<HTMLInputElement>('.assistant-context-menu input[type="checkbox"]')!;
    await click(box);
    expect(rail.textContent).toContain('选了 1 条笔记');
  });

  it('窄屏：没有右栏，参考范围和讨论速览放回对话上方', async () => {
    media.wide = false;
    await mount();
    expect(container.querySelector('[data-ws-agent-outputs]')).toBeNull();
    expect(container.querySelector('.assistant-panel .assistant-context-bar')).not.toBeNull();
    expect(container.querySelector('.assistant-panel')!.textContent).toContain('讨论速览');
  });

  it('顶栏的「新对话」清出空白页：大标题和四张卡片；点「做成网页」只填进输入框，不发送', async () => {
    await mount();
    await click(container.querySelector('[data-ws-agent-page] header [aria-label="新对话"]'));
    const hero = container.querySelector<HTMLElement>('[data-agent-hero]')!;
    expect(hero.textContent).toContain('一起推进社区的知识');
    const cards = [...hero.querySelectorAll('button')];
    expect(cards).toHaveLength(4);
    for (const label of ['梳理观点联系', '寻找未解问题', '探索综合方向', '做成网页']) {
      expect(cards.some(b => b.textContent?.includes(label)), label).toBe(true);
    }
    await click(cards.find(b => b.textContent?.includes('做成网页')));
    expect(container.querySelector('textarea')!.value).toContain('对比表网页');
    expect(backend.state.requests.some(r => r.path.endsWith('/stream'))).toBe(false);
  });

  it('历史对话按「今天 / 昨天 / 近 7 天 / 更早」分组，没有的组不出现', () => {
    const now = new Date('2026-10-11T15:00:00');
    const at = (iso: string) => ({ id: iso, title: iso, updated_at: iso });
    const groups = groupConversationsByDay([
      at('2026-10-11T09:00:00'), at('2026-10-10T20:00:00'), at('2026-10-06T08:00:00'), at('2026-09-01T08:00:00'), at('not-a-date'),
    ], true, now);
    expect(groups.map(g => [g.label, g.items.length])).toEqual([['今天', 1], ['昨天', 1], ['近 7 天', 1], ['更早', 2]]);
    expect(groupConversationsByDay([at('2026-10-11T01:00:00')], false, now).map(g => g.label)).toEqual(['Today']);
    // 分组标题已经说了哪天：今天、昨天只写几点，近 7 天写星期几，更早写日期
    expect(threadTimeInGroup('2026-10-11T09:05:00', 'today', true)).toBe('09:05');
    expect(threadTimeInGroup('2026-10-06T08:00:00', 'week', true)).toBe('周二');
    expect(threadTimeInGroup('2026-09-01T08:00:00', 'earlier', true)).toBe('9月1日');
  });
});

describe('导入笔记', () => {
  it('导入一段回答：只列自己写的笔记；正文末尾接上带 AI 来源标记的一块，记一条插入记录；画布重拉以后给「打开笔记」', async () => {
    const order: string[] = [];
    const onNotesChanged = vi.fn(async () => { order.push('refetch'); });
    const onOpenNote = vi.fn();
    await mount({ onNotesChanged, onOpenNote });

    await click(container.querySelector('.assistant-conversation [data-import-answer]'));
    const d = dialog()!;
    expect(d.textContent).toContain('我的笔记');
    expect(d.textContent).not.toContain('同学的笔记');
    await click(buttonIn(d, '导入'));
    expect(d.textContent).toContain('请先选择笔记');
    expect(notesRequests()).toEqual([]);
    await click([...d.querySelectorAll('[role="radio"]')].find(el => el.textContent?.includes('我的笔记')));
    await click(buttonIn(d, '给了我没想到的角度'));
    await click(buttonIn(d, '导入'));
    await flush(10);

    const put = backend.state.requests.find(r => r.method === 'PUT')!;
    expect(put.path).toBe('/notes/n-mine');
    expect(put.body.content.startsWith('<p>原来的正文</p>')).toBe(true);
    expect(put.body.content).toContain('data-ai-source="genai"');
    expect(put.body.content).toContain('data-import-surface="workspace"');
    expect(put.body.content).toContain('重读和回想的差别在第二栏');
    const record = backend.state.requests.find(r => r.path === '/notes/n-mine/ai-insertions')!;
    expect(record.body.reason_tag).toBe('new_angle');
    expect(record.body.insertion_anchor).toMatchObject({ source: 'workspace_agent', position: 'end', conversation_id: 'c-new', message_id: 'm2' });

    expect(dialog()).toBeNull();
    expect(onNotesChanged).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已导入笔记《我的笔记》');
    await click(buttonIn(container, '打开笔记'));
    expect(onOpenNote).toHaveBeenCalledWith('n-mine');
    expect(order).toEqual(['refetch']);
  });

  it('导入网页：先挂到那条笔记上再写正文，正文里是能点开的网页卡片', async () => {
    await mount();
    await importVia(buttonIn(container.querySelector('[data-ws-agent-outputs]')!, '导入笔记'));
    const seq = notesRequests().map(r => `${r.method} ${r.path}`);
    expect(seq.slice(0, 3)).toEqual(['GET /notes/n-mine', 'POST /artifacts/a1/attach', 'PUT /notes/n-mine']);
    expect(backend.state.requests.find(r => r.path === '/artifacts/a1/attach')!.body).toEqual({ note_id: 'n-mine' });
    expect(backend.state.noteContent).toContain('data-open-artifact="a1"');
    const record = backend.state.requests.find(r => r.path === '/notes/n-mine/ai-insertions')!;
    expect(record.body.insertion_anchor).toMatchObject({ source: 'workspace_agent', artifact_id: 'a1', artifact_version: 1 });
  });

  it('网页挂不上（不是自己的笔记等）：正文一个字不动，对话框里写明原因', async () => {
    backend.state.attachStatus = 403;
    await mount();
    await importVia(buttonIn(container.querySelector('[data-agent-artifacts]')!, '导入笔记'));
    expect(backend.state.requests.some(r => r.method === 'PUT')).toBe(false);
    expect(backend.state.noteContent).toBe('<p>原来的正文</p>');
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('Only the author of the note can attach a page');
  });

  it('不知道是谁（没登录信息）：一条笔记都不列', async () => {
    await mount({ currentUserId: null });
    await click(container.querySelector('.assistant-conversation [data-import-answer]'));
    expect(dialog()!.textContent).toContain('这个空间里还没有你写的笔记');
    expect(dialog()!.querySelectorAll('[role="radio"]')).toHaveLength(0);
  });
});
