// @vitest-environment jsdom
/**
 * 笔记页切页签不能丢正文。
 *
 * 2026-10-06 录展示视频时发现：笔记页从「撰写」切到「信息」（或阅读、Build-on）再切回来，编辑区是空的；
 * 这时点「贡献」，PUT /notes/:id 带的正文是 ""，笔记被清空。一个字不改也这样。
 * 原因：编辑区写在 {activeTab === 'edit' && …} 里，切页签就卸载；正文只在打开笔记时写进编辑区一次，
 * 重新挂上的是个空 div，保存读的就是它。「阅读」「信息」读 editorRef，卸载后回落到打开时的旧正文，
 * 没保存的修改看不到。新草稿停在别的页签上问 AI，提前落库的草稿也是空的。
 *
 * 这里挂真的 NoteEditorModal，按学生的操作点页签，看编辑区、阅读页、信息页，以及交给 onSave、
 * onPersistDraft 的正文。AI 面板的文案和版式改动频繁，这里只认「发送」按钮和唯一的输入框。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { scaffoldMarkerHtml, stripScaffoldPlaceholders } from './scaffoldLibrary';
import type { Scaffold } from '../types';

vi.hoisted(() => {
  // jsdom 缺的浏览器接口。放在 hoisted 里，保证组件模块加载之前就位。
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*\d+px/.test(query),
    media: query,
    onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  Object.assign(globalThis, { ResizeObserver: NoopObserver, IntersectionObserver: NoopObserver, IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  // jsdom 没实现 innerText；编辑器拿它数字数、记光标位置
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent ?? ''; },
    set(value: string) { this.textContent = value; },
  });
  // jsdom 也没实现 contentEditable 到属性的反射；浏览器里话头和括号会带着 contenteditable="false" 进 innerHTML
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable')) {
    Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
      configurable: true,
      get(this: HTMLElement) { return this.getAttribute('contenteditable') ?? 'inherit'; },
      set(this: HTMLElement, value: string) { this.setAttribute('contenteditable', String(value)); },
    });
  }
});

vi.mock('../services/supabaseClient', () => ({ supabase: {} }));

import NoteEditorModal from './NoteEditorModal';

// ── 假后端：AI 面板要的几个接口有内容，其余一律给空列表 ─────────────

const NOTE_ID = '00000000-0000-4000-8000-000000000001';
const COURSE_ID = 'course-1';
const AI_TEXT = 'AI 的一段话：先看证据。';

const SCAFFOLD = {
  id: 'kb-idea', title: '我的想法是', titleEn: '我的想法是', description: '', category: '知识建构/观点',
  steps: [], usageCount: 0, isMandatory: false, isRecommended: false, metadata: { l1: 'KB' },
} as unknown as Scaffold;

const AI_BLOCK =
  '<div data-ai-source="genai" data-scaffold-adopted="" data-source-message-id="m-0" data-provider-id="deepseek" data-model="deepseek-flash" style="margin:10px 0;">' +
  '<div style="font-size:10px;"><span>AI 来源</span><span>DeepSeek · deepseek-flash</span></div>' +
  '<div style="font-size:14px;line-height:1.75;"><p style="margin:6px 0;">早先采纳的 AI 回答。</p></div>' +
  '<div style="margin-top:10px;"></div></div>';

/** 一条已有的笔记：一段话、一条写了字的支架、一块早先采纳的 AI 内容、结尾一段 */
const CONTENT =
  '<p>植物向光生长，是因为背光一侧长得快。</p>' +
  scaffoldMarkerHtml(SCAFFOLD, 'zh', '生长素在背光一侧更多') +
  AI_BLOCK +
  '<p>还要再找一个实验验证。</p>';

function fetchStub() {
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && path === `/courses/${COURSE_ID}/ai-configs`) {
      return json({ configs: [{
        id: 'cfg-1', courseId: COURSE_ID, providerId: 'deepseek', isVerified: true,
        enabledModels: ['deepseek-flash'], configuredAt: '2026-09-01T00:00:00Z', apiKeyMasked: '***',
      }] });
    }
    if (method === 'GET' && path === `/notes/${NOTE_ID}/conversations`) {
      return json({ conversations: [{ id: 'thread-1', noteId: NOTE_ID, targetType: 'ai', providerId: 'deepseek', model: 'deepseek-flash' }], aiConfigs: [] });
    }
    if (method === 'GET' && path === '/note-conversations/thread-1/messages') {
      return json({ messages: [{
        id: 'm-ai', threadId: 'thread-1', senderKind: 'assistant', content: AI_TEXT, attachments: [],
        aiMetadata: { provider_id: 'deepseek', model: 'deepseek-flash' }, createdAt: '2026-09-28T08:00:00Z',
      }] });
    }
    return json({ configs: [], conversations: [], messages: [], feedbacks: [], outcomes: [], relations: [], revisions: [], ok: true });
  });
}

// ── 挂载与操作 ──────────────────────────────────────────────────

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onSave: Mock<(title: string, content: string, tags: string[]) => void>;

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

const buttons = (text: string) => Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.trim() === text);

async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
}

const editorEl = () => document.querySelector<HTMLElement>('[contenteditable][data-placeholder]');
/** 学生看得见的编辑区：切到别的页签时它可以还在，但必须藏着 */
const visibleEditor = () => {
  const editor = editorEl();
  return editor && !editor.closest('.hidden') ? editor : null;
};

/** 打开编辑器，等正文载入（编辑器在 setTimeout 里写入正文） */
async function openEditor(content: string, props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onSave = vi.fn<(title: string, content: string, tags: string[]) => void>();
  await act(async () => {
    root!.render(React.createElement(NoteEditorModal, {
      isOpen: true, onClose: () => undefined, onSave, lang: 'zh',
      initialData: { title: '一条笔记', content },
      availableScaffolds: [SCAFFOLD], courseId: COURSE_ID, noteId: NOTE_ID, userRole: 'student',
      ...props,
    }));
  });
  await waitFor(() => editorEl() && editorEl()!.childNodes.length > 0, '正文载入');
  await settle(20);
  return editorEl()!;
}

/** 顶栏的页签：撰写 / 阅读 / Build-on / 信息 */
async function switchTab(label: string) {
  const tab = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent?.trim() === label);
  if (!tab) throw new Error(`没有「${label}」页签`);
  await click(tab);
  await settle(20);
}

/** 学生在正文末尾另起一段写了几个字。jsdom 不会真的编辑 contenteditable：改 DOM 再发 input，和浏览器里打完字一样 */
async function typeParagraph(text: string) {
  const editor = editorEl()!;
  await act(async () => {
    const p = document.createElement('p');
    p.textContent = text;
    editor.appendChild(p);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function editDom(change: (editor: HTMLElement) => void) {
  const editor = editorEl()!;
  await act(async () => {
    change(editor);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 学生点进正文：光标放在含有 text 的那个文本节点里、text 开头往后 at 个字处 */
function caretIn(text: string, at: number) {
  const editor = editorEl()!;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n as Text).data.includes(text)) { node = n as Text; break; }
  }
  if (!node) throw new Error(`正文里没有「${text}」`);
  const range = document.createRange();
  range.setStart(node, node.data.indexOf(text) + at);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  // 编辑器在 mouseup / keyup 时记下光标，之后点支架就插在这里
  act(() => { editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
}

/** 光标在哪：从编辑区往下数的子节点序号加偏移。两次挂载之间可以直接比 */
function caretPath() {
  const editor = editorEl()!;
  const selection = window.getSelection()!;
  const path: number[] = [];
  for (let n: Node | null = selection.anchorNode; n && n !== editor; n = n.parentNode) {
    path.unshift(Array.prototype.indexOf.call(n.parentNode?.childNodes ?? [], n));
  }
  return `${path.join('/')}@${selection.anchorOffset}`;
}

async function closeEditor() {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
}

async function pickScaffold() {
  const [button] = buttons(SCAFFOLD.title);
  if (!button) throw new Error(`支架列表里没有「${SCAFFOLD.title}」`);
  await click(button);
  await settle(10);
}

/** 「信息」页签里某一行的值 */
const infoValue = (label: string) =>
  Array.from(document.querySelectorAll('dt')).find(dt => dt.textContent?.trim() === label)?.nextElementSibling?.textContent?.trim();

const readingView = () => document.querySelector<HTMLElement>('main article');

const sendButton = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="发送"]')).find(b => !b.disabled);

/** 在 AI 面板的输入框里打字（不发送）。每个字都让编辑器整个重渲染一遍 */
async function typeInAiInput(text: string) {
  // 默认状态下 AI 面板的输入框是页面上唯一的 textarea（拒绝理由、采纳弹窗里的只在打开时才有）
  const input = await waitFor(() => document.querySelector<HTMLTextAreaElement>('textarea'), 'AI 输入框');
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function askAi(question: string) {
  await typeInAiInput(question);
  await click(await waitFor(sendButton, 'AI 可用（发送按钮亮起）'));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub());
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 切页签 ──────────────────────────────────────────────────────

describe('笔记页切页签：编辑区里的正文不丢', () => {
  it('切到「信息」再切回「撰写」：正文原样还在；在「信息」上编辑区是藏着的', async () => {
    const editor = await openEditor(CONTENT);
    const before = editor.innerHTML;
    expect(editor.textContent).toContain('背光一侧长得快');

    await switchTab('信息');
    expect(visibleEditor()).toBeNull();
    await switchTab('撰写');

    expect(visibleEditor()).not.toBeNull();
    expect(editorEl()!.innerHTML).toBe(before);
  });

  it('写了还没保存的字，去「阅读」「Build-on」「信息」各转一圈回来，都还在', async () => {
    await openEditor(CONTENT);
    await typeParagraph('新写的一句：对照组放在暗处。');
    const edited = editorEl()!.innerHTML;
    expect(edited).toContain('对照组放在暗处');

    for (const tab of ['阅读', 'Build-on', '信息']) {
      await switchTab(tab);
      expect(visibleEditor(), `「${tab}」页签上不显示编辑区`).toBeNull();
      await switchTab('撰写');
      expect(editorEl()!.innerHTML, `从「${tab}」切回来`).toBe(edited);
    }
  });

  it('切回来后点支架：框住的是切走前光标所在的那一段', async () => {
    await openEditor('<p>第一段的想法</p><p>第二段的想法</p>');
    caretIn('第一段的想法', 2);
    await switchTab('信息');
    await switchTab('撰写');
    await pickScaffold();

    const editor = editorEl()!;
    const blocks = editor.querySelectorAll('[data-scaffold-id]');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].querySelector('[data-scaffold-input]')!.textContent).toBe('第一段的想法');
    expect(Array.from(editor.children).some(el => el.tagName === 'P' && el.textContent === '第二段的想法')).toBe(true);
  });

  it('切回来后支架照旧受保护：选区带上支架的框再删，只删字、框留着', async () => {
    await openEditor(CONTENT);
    await switchTab('信息');
    await switchTab('撰写');

    const editor = editorEl()!;
    const tag = editor.querySelector('[data-scaffold-tag]')!;
    // 从第一段中间拖到支架话头中间，再按退格
    const range = document.createRange();
    range.setStart(editor.querySelector('p')!.firstChild!, 3);
    range.setEnd(tag.firstChild!, 2);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const event = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true });
    await act(async () => { editor.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(true);
    expect(editor.querySelector('[data-scaffold-tag]')?.textContent).toBe('我的想法是');
    expect(editor.querySelector('p')!.textContent).toBe('植物向');
  });
});

// ── 保存 ──────────────────────────────────────────────────────

describe('切过页签再「贡献」：存的是眼下的正文，不是空串', () => {
  it('「信息」→「撰写」→「贡献」：一个字没改，也原样存回去', async () => {
    const editor = await openEditor(CONTENT);
    const before = editor.innerHTML;
    await switchTab('信息');
    await switchTab('撰写');
    await click(buttons('贡献')[0]);

    expect(onSave).toHaveBeenCalledTimes(1);
    const [title, content] = onSave.mock.calls[0];
    expect(title).toBe('一条笔记');
    expect(content).toBe(stripScaffoldPlaceholders(before));
    expect(content).toContain('背光一侧长得快');
  });

  it('停在「信息」页签直接点「贡献」：没保存的修改一起存进去', async () => {
    await openEditor(CONTENT);
    await typeParagraph('新写的一句：对照组放在暗处。');
    const edited = editorEl()!.innerHTML;
    await switchTab('信息');
    await click(buttons('贡献')[0]);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1]).toBe(stripScaffoldPlaceholders(edited));
    expect(onSave.mock.calls[0][1]).toContain('对照组放在暗处');
  });

  it('新草稿停在「信息」页签上问 AI：为开对话提前落库的草稿带着正文', async () => {
    const onPersistDraft = vi.fn(async (_title: string, _content: string): Promise<string | null> => null);
    await openEditor('<p>草稿里写的一段：先观察再下结论。</p>', { noteId: undefined, onPersistDraft });
    await switchTab('信息');
    await askAi('帮我看看这段');

    await waitFor(() => onPersistDraft.mock.calls.length > 0, '草稿落库');
    expect(onPersistDraft.mock.calls[0][1]).toContain('先观察再下结论');
  });
});

// ── 阅读、信息页签读眼下的正文 ───────────────────────────────────

describe('「阅读」「信息」显示的是眼下的正文，含没保存的修改', () => {
  // 以前切过去的那一帧还读得到编辑区（渲染时 ref 还没清），之后页面上随便哪里重渲染一次
  // （学生在 AI 输入框里打字、AI 配置定时刷新）就回落到打开时的旧正文。所以切过去之后要再渲染一次再看。
  it('「阅读」：新写的在，删掉的不在；停在这一页时页面重渲染也不变回旧正文', async () => {
    await openEditor(CONTENT);
    await editDom(editor => editor.querySelector('p')!.remove());
    await typeParagraph('新写的一句：对照组放在暗处。');
    await switchTab('阅读');
    await typeInAiInput('这段怎么改');

    const article = readingView()!;
    expect(article.textContent).toContain('对照组放在暗处');
    expect(article.textContent).not.toContain('背光一侧长得快');
  });

  it('「阅读」：正文删光了就显示空白提示，不再显示打开时的旧正文', async () => {
    await openEditor(CONTENT);
    await editDom(editor => { editor.innerHTML = ''; });
    await switchTab('阅读');
    await typeInAiInput('这段怎么改');

    const article = readingView()!;
    expect(article.textContent).not.toContain('背光一侧长得快');
    expect(article.textContent).toContain('在这里写下你的想法');
  });

  it('「信息」里的「AI 采纳段」按眼下的正文数', async () => {
    await openEditor(CONTENT);
    await switchTab('信息');
    expect(infoValue('AI 采纳段')).toBe('1');

    await switchTab('撰写');
    await editDom(editor => editor.querySelector('[data-ai-source="genai"]')!.remove());
    await switchTab('信息');
    await typeInAiInput('这段怎么改');
    expect(infoValue('AI 采纳段')).toBe('0');
  });

  it('「信息」：在「撰写」里删掉 AI 块再切过去，页面重渲染后也按眼下的数', async () => {
    await openEditor(CONTENT);
    await editDom(editor => editor.querySelector('[data-ai-source="genai"]')!.remove());
    await switchTab('信息');
    await typeInAiInput('这段怎么改');
    expect(infoValue('AI 采纳段')).toBe('0');
  });
});

// ── 从别的页签往正文里插东西 ─────────────────────────────────────

describe('支架栏、AI 面板在每个页签上都在：从别的页签插进正文时先切回「撰写」', () => {
  it('在「信息」页签点左侧支架：切回「撰写」，框住光标所在的那一段，和在「撰写」页签上点的结果一样', async () => {
    const pick = async (fromTab?: string) => {
      await openEditor('<p>第一段的想法</p><p>第二段的想法</p>');
      caretIn('第一段的想法', 2);
      if (fromTab) await switchTab(fromTab);
      await pickScaffold();
      const result = { visible: Boolean(visibleEditor()), html: editorEl()!.innerHTML, caret: caretPath() };
      await closeEditor();
      return result;
    };
    const onEditTab = await pick();
    const fromInfo = await pick('信息');

    expect(fromInfo).toEqual(onEditTab);
    expect(fromInfo.visible).toBe(true);
    const box = document.createElement('div');
    box.innerHTML = fromInfo.html;
    expect(box.querySelector('[data-scaffold-input]')!.textContent).toBe('第一段的想法');
  });

  it('在「阅读」页签把 AI 回复「添加到 Note」：切回「撰写」，内容进了正文', async () => {
    await openEditor('<p>我的想法</p>');
    await switchTab('阅读');
    const [fromMessage] = await waitFor(() => buttons('添加到 Note').length > 0 && buttons('添加到 Note'), 'AI 回复下面的添加按钮');
    await click(fromMessage);
    await click(await waitFor(() => buttons('给了我没想到的角度')[0], '采纳归类'));
    await click(buttons('添加到 Note').pop()!);
    await settle(20);

    expect(visibleEditor()).not.toBeNull();
    const inserted = editorEl()!.querySelector('[data-ai-source="genai"]');
    expect(inserted?.textContent).toContain(AI_TEXT);
    expect(editorEl()!.textContent).toContain('我的想法');
  });
});
