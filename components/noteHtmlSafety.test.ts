// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import { htmlToPlainText, plainTextToNoteHtml } from './noteText';
import {
  extractScaffoldIds,
  isEmptyScaffoldSlot,
  normalizeScaffoldMarkers,
  scaffoldMarkerHtml,
  SCAFFOLD_CARET_SELECTOR,
} from './scaffoldLibrary';
import { segmentNoteContent } from '../api/src/services/noteSegments';
import type { Scaffold } from '../types';

/**
 * 笔记正文是作者存的原始 HTML，后端原样入库。打开别人的笔记（编辑器）、
 * 教师做质性编码、手机端列表预览，都曾把它直接 innerHTML，别人写进去的
 * <img onerror> 就在看的人的会话里执行了。
 *
 * vitest 自带的 jsdom 不跑内联事件处理器，所以另起一个开了脚本的 jsdom，
 * 手动派发浏览器会自动派发的事件（坏图的 error、svg 的 load……），看处理器跑没跑。
 */
const PAYLOADS = [
  '<img src="x" onerror="window.__pwned=1">',
  '<svg onload="window.__pwned=1"></svg>',
  '<details open ontoggle="window.__pwned=1"><summary>s</summary></details>',
  '<p onmouseover="window.__pwned=1">悬停</p>',
  '<script>window.__pwned=1</script>',
  '<iframe srcdoc="<script>parent.__pwned=1</script>"></iframe>',
  '<a href="javascript:window.__pwned=1">点我</a>',
  '<form><button formaction="javascript:window.__pwned=1">提交</button></form>',
];
const EVENTS = ['error', 'load', 'toggle', 'mouseover', 'click', 'focus'];

/** 在开了脚本的页面里挂上这段 HTML，派发常见事件、点一遍链接，返回有没有代码被执行 */
function executesIn(html: string, where: 'live' | 'detached' | 'inert' = 'live'): boolean {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' });
  const w = dom.window as unknown as Window & typeof globalThis & { __pwned?: number };
  const doc = where === 'inert' ? w.document.implementation.createHTMLDocument('') : w.document;
  const host = doc.createElement('div');
  if (where === 'live') {
    host.contentEditable = 'true';
    w.document.body.appendChild(host);
  }
  host.innerHTML = html;
  host.querySelectorAll('*').forEach(el => {
    EVENTS.forEach(type => el.dispatchEvent(new w.Event(type)));
    const url = el.getAttribute('href') ?? el.getAttribute('formaction') ?? el.getAttribute('src') ?? '';
    if (/^\s*javascript:/i.test(url)) w.eval(decodeURIComponent(url.replace(/^\s*javascript:/i, '')));
  });
  const hit = w.__pwned === 1;
  dom.window.close();
  return hit;
}

// jsdom 没实现 contentEditable 到属性的反射；浏览器里 el.contentEditable = 'false'
// 会写出 contenteditable="false"，存进库的正文里就带着它。补上这一层，存稿往返才和真实编辑器一样。
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable')) {
  Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
    configurable: true,
    get(this: HTMLElement) { return this.getAttribute('contenteditable') ?? 'inherit'; },
    set(this: HTMLElement, value: string) { this.setAttribute('contenteditable', String(value)); },
  });
}

/** NoteEditorModal 打开笔记时的两步：消毒写入，再把支架的话头和括号锁回不可编辑 */
function openInEditor(content: string): HTMLElement {
  const editor = document.createElement('div');
  editor.contentEditable = 'true';
  document.body.appendChild(editor);
  editor.innerHTML = DOMPurify.sanitize(content);
  normalizeScaffoldMarkers(editor);
  return editor;
}

/** 编辑器存稿时做的事：去掉零宽占位符 */
const saved = (editor: HTMLElement) => editor.innerHTML.replace(/​/g, '');

/** 研究导出读的两列（content_segments / segment_stats），去掉计算时间戳 */
function research(html: string) {
  const { segments, stats } = segmentNoteContent(html);
  const { computedAt: _computedAt, ...rest } = stats;
  return { segments, stats: rest };
}

const scaffold = {
  id: 'kb-my-theory',
  title: '我的理论',
  titleEn: 'My theory',
  category: '知识建构/理论',
  metadata: { l1: 'KB' },
} as unknown as Scaffold;

/** 一条学生写过的支架段，就是编辑器存进库里的样子（话头、括号带 contenteditable） */
const STORED_SCAFFOLD =
  '<p data-scaffold-id="kb-my-theory" data-scaffold-l1="KB" data-scaffold-title="我的理论">' +
  '<strong data-scaffold-tag="" contenteditable="false">我的理论</strong>' +
  '<span data-scaffold-slot="">' +
  '<span data-scaffold-bracket="" contenteditable="false">[</span>' +
  '<span data-scaffold-input="">光合作用需要光，因为<b>暗处</b>的叶子不变绿</span>' +
  '<span data-scaffold-bracket="" contenteditable="false">]</span>' +
  '</span></p>';

/** 学生在编辑器里插入的 AI 段落（NoteEditorModal 的 AI 插入块，节选关键属性） */
const STORED_AI_INSERT =
  '<div data-ai-source="genai" data-scaffold-adopted="gai-1" data-source-message-id="m-1" data-provider-id="dmx" data-model="deepseek-v4-flash" ' +
  'style="margin:10px 0;border:1px solid #cbd5e1;border-left:4px solid #22577a;">' +
  '<div style="font-size:14px;line-height:1.75;"><p>AI 给的例子：叶绿素吸收红光和蓝光。</p></div></div><p><br></p>';

/** 后端 notes.ts 采纳 AI 摘录时生成的块（没有输入槽，normalizeScaffoldMarkers 不该动它） */
const STORED_AI_PUBLICATION =
  '<div data-ai-source="ai-partner-publication" style="border-left:4px solid #22577a;background:#f8fafc;">' +
  '<div data-scaffold-id="gai-2" data-scaffold-l1="GAI" data-scaffold-title="ChatGPT 提供的案例是" style="margin-bottom:6px;font-size:13px;">' +
  '<strong data-scaffold-tag="">ChatGPT 提供的案例是</strong><span data-scaffold-slot="">[</span></div>' +
  '<p>摘录的内容</p></div>';

const STORED_IMPORTED = '<div data-imported-from="实验记录.md"><h1>实验记录</h1><ul><li>第一组</li><li>第二组</li></ul></div>';

const STORED_RICH =
  '<h2>我的观察</h2><p>叶子在<font color="#22577a">光下</font>变绿，<span style="color: rgb(34, 87, 122);">暗处</span>发黄&nbsp;。</p>' +
  '<p><a href="https://example.org/paper">参考文献</a></p>' +
  '<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="></p>';

beforeEach(() => { document.body.innerHTML = ''; });

describe('测试工具本身能看出代码执行', () => {
  it('未消毒的正文写进活页面、写进游离 div，都会执行；惰性文档里不会', () => {
    for (const payload of PAYLOADS.slice(0, 4)) {
      expect(executesIn(payload, 'live'), payload).toBe(true);
    }
    expect(executesIn(PAYLOADS[0], 'detached')).toBe(true);
    expect(executesIn(PAYLOADS[0], 'inert')).toBe(false);
  });
});

describe('编辑器载入笔记：先消毒', () => {
  it('别人写进正文的脚本和事件处理器不会带进编辑器', () => {
    for (const payload of PAYLOADS) {
      const editor = openInEditor(`<p>正文</p>${payload}`);
      expect(executesIn(editor.innerHTML), payload).toBe(false);
      expect(editor.innerHTML, payload).not.toMatch(/\son\w+=|<script|<iframe|javascript:/i);
      expect(editor.textContent, payload).toContain('正文');
    }
  });

  it('编辑器自己存的正文原样读回：支架、AI 来源、导入标记、格式、图片都不丢', () => {
    for (const stored of [STORED_SCAFFOLD, STORED_AI_INSERT, STORED_AI_PUBLICATION, STORED_IMPORTED, STORED_RICH]) {
      expect(saved(openInEditor(stored))).toBe(stored);
    }
  });

  it('研究切分结果不变：载入前后 segmentNoteContent 完全一致', () => {
    const stored = [STORED_SCAFFOLD, STORED_RICH, STORED_AI_INSERT, STORED_IMPORTED, STORED_AI_PUBLICATION].join('');
    const reloaded = saved(openInEditor(stored));
    expect(research(reloaded)).toEqual(research(stored));
    expect(extractScaffoldIds(reloaded)).toEqual(['kb-my-theory', 'gai-2']);
    const kinds = research(reloaded).segments.map(s => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(['scaffold', 'plain', 'ai_inserted', 'imported', 'ai_published']));
  });

  it('消毒会剥掉 contenteditable，话头和括号由 normalizeScaffoldMarkers 重新锁上', () => {
    expect(DOMPurify.sanitize(STORED_SCAFFOLD)).not.toContain('contenteditable');
    const editor = openInEditor(STORED_SCAFFOLD);
    expect(editor.querySelector<HTMLElement>('[data-scaffold-tag]')!.contentEditable).toBe('false');
    const brackets = editor.querySelectorAll<HTMLElement>('[data-scaffold-bracket]');
    expect(brackets).toHaveLength(2);
    brackets.forEach(b => expect(b.contentEditable).toBe('false'));
    expect(editor.querySelector('[data-scaffold-input]')!.textContent).toBe('光合作用需要光，因为暗处的叶子不变绿');
  });

  it('从支架库新开的笔记：空支架槽还在，光标能落进方括号', () => {
    const editor = openInEditor(scaffoldMarkerHtml(scaffold, 'zh'));
    const slot = editor.querySelector(SCAFFOLD_CARET_SELECTOR);
    expect(isEmptyScaffoldSlot(slot)).toBe(true);
    expect(slot!.textContent).toBe('​');
    expect(editor.querySelector('[data-scaffold-id]')!.getAttribute('data-scaffold-title')).toBe('我的理论');
  });

  it('老结构（括号是裸文本）照旧升级成不可编辑的括号', () => {
    const legacy = '<p data-scaffold-id="kb-my-theory" data-scaffold-title="我的理论"><strong data-scaffold-tag="">我的理论</strong>' +
      '<span data-scaffold-slot="">[<span data-scaffold-input="">旧内容</span>]</span></p>';
    const editor = openInEditor(legacy);
    const slot = editor.querySelector('[data-scaffold-slot]')!;
    expect(Array.from(slot.children).map(c => c.textContent)).toEqual(['[', '旧内容', ']']);
    expect(slot.querySelectorAll('[data-scaffold-bracket][contenteditable="false"]')).toHaveLength(2);
  });
});

describe('htmlToPlainText：取纯文本不执行正文', () => {
  const oldStripHtml = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent ?? '';
  };

  it('在没有浏览上下文的文档里解析，不碰当前页面', () => {
    const setter = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    try {
      htmlToPlainText(PAYLOADS[0]);
      const target = setter.mock.contexts.at(-1) as Element;
      expect(target.ownerDocument).not.toBe(document);
      expect(target.ownerDocument.defaultView).toBeNull();
    } finally {
      setter.mockRestore();
    }
  });

  it('和原来的实现逐字一致：已存的质性编码偏移不错位', () => {
    for (const html of [STORED_SCAFFOLD, STORED_AI_INSERT, STORED_AI_PUBLICATION, STORED_IMPORTED, STORED_RICH,
      '<p>第一段</p><p>第二段&amp;&lt;符号&gt;</p>', '<table><tr><td>格</td><td>子</td></tr></table>', '纯文本，没有标签']) {
      expect(htmlToPlainText(html)).toBe(oldStripHtml(html));
    }
  });

  it('空值返回空串', () => {
    expect(htmlToPlainText('')).toBe('');
    expect(htmlToPlainText(undefined)).toBe('');
    expect(htmlToPlainText(null)).toBe('');
  });
});

describe('plainTextToNoteHtml：AI 回复插进笔记前先转义', () => {
  it('模型输出里的标签只是字，不会变成元素', () => {
    const reply = '可以这样写：<img src=x onerror="window.__pwned=1"> 和 <script>alert(1)</script>';
    const html = plainTextToNoteHtml(reply);
    expect(html).not.toMatch(/<img|<script/);
    expect(executesIn(html)).toBe(false);
    const editor = openInEditor(html);
    expect(editor.querySelectorAll('img, script')).toHaveLength(0);
    expect(editor.textContent).toBe(reply);
  });

  it('原来的拼法会执行，这是回归基线', () => {
    expect(executesIn(`<p>${'<img src=x onerror="window.__pwned=1">'}</p>`)).toBe(true);
  });

  it('空行分段、段内换行变 <br>，和后端 textToHtmlParagraphs 一致', () => {
    expect(plainTextToNoteHtml('第一段第一行\n第一段第二行\n\n\n第二段')).toBe('<p>第一段第一行<br>第一段第二行</p><p>第二段</p>');
    expect(plainTextToNoteHtml('  a & b "c" \'d\'  ')).toBe('<p>a &amp; b &quot;c&quot; &#039;d&#039;</p>');
  });

  it('Markdown 原样保留成文字', () => {
    expect(htmlToPlainText(plainTextToNoteHtml('**要点**：\n- 第一条'))).toBe('**要点**：- 第一条');
  });

  it('空回复不产出段落', () => {
    expect(plainTextToNoteHtml('')).toBe('');
    expect(plainTextToNoteHtml('\n\n  \n')).toBe('');
  });
});
