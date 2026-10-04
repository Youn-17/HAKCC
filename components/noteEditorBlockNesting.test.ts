// @vitest-environment jsdom
/**
 * 块级内容插进笔记时只能落在编辑区最外层，不能套进段落。
 *
 * 2026-09-28 生产库 205 条笔记里有 4 条的正文把块套进了 <p>：
 *   <p><div data-ai-source="genai">…</div><p><br></p><br></p>、<p>字<p data-scaffold-id>…</p></p>、
 *   支架段里再套支架段。
 * range.insertNode、直接拼 DOM 能造出 HTML 解析器永远造不出的嵌套，innerHTML 又原样写进库。
 * 之后每一次解析（阅读视图、下次打开编辑器、后端存稿前的 sanitizeNoteHtml）都先把外层 <p> 关掉，
 * 库里的字符串和显示出来的结构对不上；研究切分 noteSegments 在字符串上数标签，
 * 会把学生自己的字算进 AI 块，或者把支架记成外层那一条的 id。
 *
 * 这里挂真的 NoteEditorModal，按学生的操作放好光标、点按钮，然后检查编辑区：
 *   1. 解析稳定：editor.innerHTML 在一份新文档里重新解析、再序列化，逐字不变；
 *   2. 段落、标题、span、strong 这类只装字的元素里没有块；
 *   3. 支架、AI 块、图片、附件卡片都是编辑区最外层的块，各自的内容原样不动。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { segmentNoteContent } from '../api/src/services/noteSegments';
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

// ── 假后端：只有 AI 面板要用的几个接口有内容，其余一律给空列表 ─────────────

const NOTE_ID = '00000000-0000-4000-8000-000000000001';
const COURSE_ID = 'course-1';
const AI_TEXT = 'AI 的一段话：先看证据。';

const scaffold = (id: string, title: string) => ({
  id, title, titleEn: title, description: '', category: '知识建构/观点',
  steps: [], usageCount: 0, isMandatory: false, isRecommended: false, metadata: { l1: 'KB' },
} as unknown as Scaffold);
const SCAFFOLD = scaffold('kb-idea', '我的想法是');
/** 同一条支架紧挨着插两次会被 mergeSplitScaffolds 当成被劈开的一条并回去，接续用另一条 */
const REASON = scaffold('kb-reason', '我的理由是');

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
    return json({ configs: [], conversations: [], messages: [], feedbacks: [], relations: [], revisions: [], ok: true });
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

const editorEl = () => document.querySelector<HTMLElement>('[contenteditable][data-placeholder]')!;

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
      availableScaffolds: [SCAFFOLD, REASON], courseId: COURSE_ID, noteId: NOTE_ID, userRole: 'student',
      ...props,
    }));
  });
  await waitFor(() => editorEl() && editorEl().childNodes.length > 0, '正文载入');
  await settle(20);
  return editorEl();
}

/** 学生点进正文：把光标放在含有 text 的那个文本节点里、text 开头往后 at 个字处 */
function caretIn(text: string, at: number, length = 0) {
  const editor = editorEl();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n as Text).data.includes(text)) { node = n as Text; break; }
  }
  if (!node) throw new Error(`正文里没有「${text}」`);
  const start = node.data.indexOf(text) + at;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + length);
  placeSelection(range);
}

/** 光标放在某个空段落里（它只有一个 <br>） */
function caretInEmpty(p: Element) {
  const range = document.createRange();
  range.setStart(p, 0);
  range.collapse(true);
  placeSelection(range);
}

function placeSelection(range: Range) {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  // 编辑器在 mouseup / keyup 时记下光标，之后点工具栏按钮就插在这里
  act(() => { editorEl().dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
}

async function pickScaffold(which: Scaffold = SCAFFOLD) {
  const [button] = buttons(which.title);
  if (!button) throw new Error(`支架列表里没有「${which.title}」`);
  await click(button);
}

/** 编辑区工具栏上的隐藏文件框（AI 面板也有一个收图片的，别选错） */
async function chooseFile(accept: string, file: File, done: () => unknown) {
  const toolbar = buttons('插入图片')[0].parentElement!;
  const input = toolbar.querySelector<HTMLInputElement>(`input[type="file"][accept^="${accept}"]`)!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitFor(done, `插入 ${file.name}`);
}

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

async function insertImage() {
  const before = editorEl().querySelectorAll('figure').length;
  await chooseFile('image/', new File([PNG], '图.png', { type: 'image/png' }), () => editorEl().querySelectorAll('figure').length > before);
}

async function insertDocument() {
  const before = editorEl().querySelectorAll('[data-note-asset="document"]').length;
  await chooseFile('.pdf', new File(['文档内容'], '资料.txt', { type: 'text/plain' }), () => editorEl().querySelectorAll('[data-note-asset="document"]').length > before);
}

/** AI 面板里那条回复下面的「添加到 Note」→ 选一个帮助类型 → 确认 */
async function insertAiReply() {
  const before = editorEl().querySelectorAll('[data-ai-source="genai"]').length;
  const [fromMessage] = await waitFor(() => buttons('添加到 Note').length > 0 && buttons('添加到 Note'), 'AI 回复下面的添加按钮');
  await click(fromMessage);
  await click(await waitFor(() => buttons('给了我没想到的角度')[0], '采纳归类'));
  await click(buttons('添加到 Note').pop()!);
  await waitFor(() => editorEl().querySelectorAll('[data-ai-source="genai"]').length > before, 'AI 内容进了正文');
  await settle(10);
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

// ── 检查 ──────────────────────────────────────────────────────

const BLOCKS = 'address,article,aside,blockquote,details,dialog,dd,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,ul';
const TEXT_ONLY = 'p,h1,h2,h3,h4,h5,h6,span,strong,b,em,i,u,s,a,font,code,small,sub,sup,mark,label,cite,q';

/** 浏览器阅读视图、下次打开编辑器、后端消毒看到的结构：在一份新文档里解析再序列化 */
function reparse(html: string): string {
  const box = document.implementation.createHTMLDocument('').createElement('div');
  box.innerHTML = html;
  return box.innerHTML;
}

function expectWellFormed(editor: HTMLElement) {
  const html = editor.innerHTML;
  expect(reparse(html), '重新解析后结构变了').toBe(html);
  const nested = Array.from(editor.querySelectorAll(TEXT_ONLY))
    .filter(el => el.querySelector(BLOCKS))
    .map(el => `<${el.tagName.toLowerCase()}> 里有 <${el.querySelector(BLOCKS)!.tagName.toLowerCase()}>`);
  expect(nested, '只装字的元素里套了块').toEqual([]);
  // AI 插入块里的「采纳支架」标签也带 data-scaffold-id，但它没有输入槽，本来就长在 AI 块里
  const units = [
    ...editor.querySelectorAll('[data-ai-source], [data-note-asset]'),
    ...Array.from(editor.querySelectorAll('[data-scaffold-id]')).filter(el => el.querySelector('[data-scaffold-input]')),
  ];
  const buried = units.filter(el => el.parentElement !== editor).map(el => el.outerHTML.slice(0, 80));
  expect(buried, '支架、AI 块、附件没有落在最外层').toEqual([]);
}

/** 最外层每一块：标签名 + 去掉零宽占位后的字 */
const outline = (editor: HTMLElement) => Array.from(editor.childNodes).map(n =>
  `${n.nodeType === Node.ELEMENT_NODE ? (n as Element).tagName.toLowerCase() : '#text'}:${(n.textContent ?? '').replace(/\u200b/g, '')}`);

/** 光标所在的那一个最外层块 */
function caretBlock(editor: HTMLElement): Node | null {
  let node: Node | null = window.getSelection()?.anchorNode ?? null;
  while (node && node.parentNode !== editor) node = node.parentNode;
  return node;
}

function research(editor: HTMLElement) {
  return segmentNoteContent(stripScaffoldPlaceholders(editor.innerHTML)).stats;
}

const AI_BLOCK =
  '<div data-ai-source="genai" data-scaffold-adopted="" data-source-message-id="m-0" data-provider-id="deepseek" data-model="deepseek-flash" style="margin:10px 0;">' +
  '<div style="font-size:10px;"><span>AI 来源</span><span>DeepSeek · deepseek-flash</span></div>' +
  '<div style="font-size:14px;line-height:1.75;"><p style="margin:6px 0;">早先采纳的 AI 回答。</p></div>' +
  '<div style="margin-top:10px;"></div></div>';

const IMAGE_BLOCK =
  '<figure data-note-asset="image" style="margin:12px 0;"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="旧图.png">' +
  '<figcaption>旧图.png</figcaption></figure>';

// ── 图片、附件、AI 回复、认知路标：都走「在光标处插一段 HTML」 ─────────────

describe('在光标处插入块：段落从光标处劈开，块落在最外层', () => {
  it('图片插在一段话中间', async () => {
    const editor = await openEditor('<p>前半句后半句</p>');
    caretIn('前半句后半句', 3);
    await insertImage();
    expectWellFormed(editor);
    expect(outline(editor)).toEqual(['p:前半句', 'figure:图.png', 'p:', 'p:后半句']);
    // 光标落在图片下面留出的空行里，学生接着写
    expect(caretBlock(editor)).toBe(editor.children[2]);
  });

  it('图片插在加粗的字后面：粗体留在原段，没有劈出空段', async () => {
    const editor = await openEditor('<p>我的<strong>观点</strong></p>');
    caretIn('观点', 2);
    await insertImage();
    expectWellFormed(editor);
    expect(outline(editor)).toEqual(['p:我的观点', 'figure:图.png', 'p:']);
    expect(editor.children[0].innerHTML).toBe('我的<strong>观点</strong>');
  });

  it('图片插在标题中间', async () => {
    const editor = await openEditor('<h2>观察记录</h2>');
    caretIn('观察记录', 2);
    await insertImage();
    expectWellFormed(editor);
    expect(outline(editor)).toEqual(['h2:观察', 'figure:图.png', 'p:', 'h2:记录']);
  });

  it('光标在支架括号里插图片：图片排在支架后面，支架原样', async () => {
    const editor = await openEditor(`${scaffoldMarkerHtml(SCAFFOLD, 'zh', '我的理由')}<p>后面的话</p>`);
    const scaffoldBefore = editor.children[0].outerHTML;
    caretIn('我的理由', 2);
    await insertImage();
    expectWellFormed(editor);
    expect(outline(editor)).toEqual(['p:我的想法是[我的理由]', 'figure:图.png', 'p:', 'p:后面的话']);
    expect(editor.children[0].outerHTML).toBe(scaffoldBefore);
  });

  it('附件卡片插在一段话中间', async () => {
    const editor = await openEditor('<p>甲乙</p>');
    caretIn('甲乙', 1);
    await insertDocument();
    expectWellFormed(editor);
    expect(outline(editor).map(s => s.split(':')[0])).toEqual(['p', 'p', 'p', 'p']);
    expect(editor.children[1].getAttribute('data-note-asset')).toBe('document');
    expect(outline(editor)[0]).toBe('p:甲');
    expect(outline(editor)[3]).toBe('p:乙');
  });

  it('AI 回复插到空行上，再插一段：两块都在最外层（生产上的形状）', async () => {
    const editor = await openEditor('<p>我先写的</p><p><br></p>');
    caretInEmpty(editor.children[1]);
    await insertAiReply();
    expectWellFormed(editor);
    expect(outline(editor).map(s => s.split(':')[0])).toEqual(['p', 'div', 'p']);
    // 插完光标在 AI 块下面的空行里，紧接着再插一段
    expect(caretBlock(editor)).toBe(editor.children[2]);
    await insertAiReply();
    expectWellFormed(editor);
    expect(outline(editor).map(s => s.split(':')[0])).toEqual(['p', 'div', 'div', 'p']);
    const stats = research(editor);
    expect(stats.plainChars).toBe('我先写的'.length);
    expect(stats.aiBlockCount).toBe(2);
  });

  it('AI 回复插在一段话中间：学生自己的字不会算进 AI 块', async () => {
    const editor = await openEditor('<p>甲乙丙丁</p>');
    caretIn('甲乙丙丁', 2);
    await insertAiReply();
    expectWellFormed(editor);
    expect(outline(editor).map(s => s.split(':')[0])).toEqual(['p', 'div', 'p', 'p']);
    expect(outline(editor)[0]).toBe('p:甲乙');
    expect(outline(editor)[3]).toBe('p:丙丁');
    const stats = research(editor);
    expect(stats.plainChars).toBe(4);
    expect(stats.aiChars).toBeGreaterThan(0);
  });

  it('综合笔记的认知路标插在一段话中间', async () => {
    const editor = await openEditor('<p>综合甲乙</p>', { isRiseAbove: true, riseAboveCitedIds: [] });
    caretIn('综合甲乙', 2);
    const [marker] = buttons('这些想法之间，什么是我们尚未注意到的联系？');
    await click(marker);
    expectWellFormed(editor);
    expect(outline(editor)).toEqual(['p:综合', 'p:这些想法之间，什么是我们尚未注意到的联系？', 'p:', 'p:甲乙']);
  });

  it('存稿：交给 onSave 的正文解析稳定', async () => {
    const editor = await openEditor('<p>第一段</p><p>第二段</p>');
    caretIn('第一段', 1);
    await insertImage();
    caretIn('第二段', 2);
    await insertAiReply();
    await click(buttons('贡献')[0]);
    expect(onSave).toHaveBeenCalledTimes(1);
    const content = onSave.mock.calls[0][1];
    expect(reparse(content)).toBe(content);
    expect(content).toBe(stripScaffoldPlaceholders(editor.innerHTML));
  });
});

// ── 支架 ──────────────────────────────────────────────────────

describe('插入支架：支架永远是最外层的段落，不框走别人的内容', () => {
  it('从材料引文开的笔记，没点正文就选支架：引文原样，支架接在后面', async () => {
    const quote = '<blockquote data-imported-from="材料.md"><p>引文一句</p><cite>引自《材料.md》</cite></blockquote>';
    const editor = await openEditor(`${quote}<p><br></p>`);
    await pickScaffold();
    expectWellFormed(editor);
    expect(editor.children[0].outerHTML).toBe(quote);
    // 引文下面那个空行就是学生要写的地方：支架放在那里，不在引文和支架之间空一行
    expect(outline(editor)).toEqual(['blockquote:引文一句引自《材料.md》', 'p:我的想法是[]', 'p:']);
    const scaffold = editor.querySelector('[data-scaffold-id="kb-idea"]')!;
    expect(scaffold.querySelector('[data-scaffold-input]')!.textContent!.replace(/\u200b/g, '')).toBe('');
    expect(window.getSelection()!.anchorNode && scaffold.contains(window.getSelection()!.anchorNode)).toBe(true);
    const stats = research(editor);
    expect(stats.importedChars).toBe(segmentNoteContent(quote).stats.importedChars);
    expect(stats.scaffoldIds).toEqual(['kb-idea']);
  });

  it('没点正文就选支架，笔记末尾是 AI 块：框的是学生自己的最后一段，AI 块不动', async () => {
    const editor = await openEditor(`<p>我的想法</p>${AI_BLOCK}<p><br></p>`);
    await pickScaffold();
    expectWellFormed(editor);
    expect(outline(editor).map(s => s.split(':')[0])).toEqual(['p', 'div', 'p']);
    expect(editor.children[0].querySelector('[data-scaffold-input]')!.textContent).toBe('我的想法');
    expect(editor.children[1].outerHTML).toBe(AI_BLOCK);
  });

  it('没点正文就选支架，笔记末尾是图片：图片不动', async () => {
    const editor = await openEditor(`<p>说明文字</p>${IMAGE_BLOCK}<p><br></p>`);
    await pickScaffold();
    expectWellFormed(editor);
    expect(editor.children[0].querySelector('[data-scaffold-input]')!.textContent).toBe('说明文字');
    expect(editor.children[1].outerHTML).toBe(IMAGE_BLOCK);
  });

  it('光标在列表项里：列表从这一项前后断开，支架落在最外层', async () => {
    const editor = await openEditor('<ul><li>第一条</li><li>第二条</li><li>第三条</li></ul>');
    caretIn('第二条', 1);
    await pickScaffold();
    expectWellFormed(editor);
    expect(outline(editor)).toEqual(['ul:第一条', 'p:我的想法是[第二条]', 'ul:第三条']);
  });

  it('光标在 AI 块的文字里：新支架接在 AI 块后面，AI 的字不被框走', async () => {
    const editor = await openEditor(`${AI_BLOCK}<p><br></p>`);
    caretIn('早先采纳的 AI 回答。', 2);
    await pickScaffold();
    expectWellFormed(editor);
    expect(editor.children[0].outerHTML).toBe(AI_BLOCK);
    expect(outline(editor)).toEqual([expect.stringMatching(/^div:/), 'p:我的想法是[]', 'p:']);
  });

  it('光标停在普通段落里：整段框进支架（原有行为）', async () => {
    const editor = await openEditor('<p>甲</p><p>乙丙</p>');
    caretIn('乙丙', 1);
    await pickScaffold();
    expectWellFormed(editor);
    expect(outline(editor)).toEqual(['p:甲', 'p:我的想法是[乙丙]', 'p:']);
  });

  it('选中一段里的几个字：前后留成普通段，中间框进支架（原有行为）', async () => {
    const editor = await openEditor('<p>前面选中的后面</p>');
    caretIn('前面选中的后面', 2, 3);
    await pickScaffold();
    expectWellFormed(editor);
    expect(outline(editor)).toEqual(['p:前面', 'p:我的想法是[选中的]', 'p:后面']);
  });

  it('光标停在支架里：新支架接在它后面（原有行为）', async () => {
    const editor = await openEditor(`${scaffoldMarkerHtml(SCAFFOLD, 'zh', '已有内容')}<p>下一段</p>`);
    caretIn('已有内容', 2);
    await pickScaffold(REASON);
    expectWellFormed(editor);
    expect(outline(editor)).toEqual(['p:我的想法是[已有内容]', 'p:我的理由是[]', 'p:下一段']);
  });
});
