// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { insertFragmentAtRange, replaceAtTopLevel, wholeBlockOf } from './noteEditorBlocks';

/**
 * 编辑区块级插入的几个边角。整条链路（真编辑器里点按钮插图片、AI 回复、支架）
 * 在 noteEditorBlockNesting.test.ts 里；这里只看两个函数在界面上不好摆出来的光标位置。
 */
function editorWith(html: string): HTMLElement {
  const editor = document.createElement('div');
  editor.innerHTML = html;
  document.body.appendChild(editor);
  return editor;
}

const fragment = (html: string) => document.createRange().createContextualFragment(html);

function caret(node: Node, offset: number): Range {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  return range;
}

const textOf = (editor: HTMLElement, text: string) => {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data === text) return n as Text;
  throw new Error(`没有「${text}」`);
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('insertFragmentAtRange', () => {
  it('只有行内内容：原地插入，不劈段', () => {
    const editor = editorWith('<p>甲乙</p>');
    insertFragmentAtRange(editor, caret(textOf(editor, '甲乙'), 1), fragment('<strong>粗</strong>'));
    expect(editor.innerHTML).toBe('<p>甲<strong>粗</strong>乙</p>');
  });

  it('没包段落的一行字：块落在最外层，字从光标处分开', () => {
    const editor = editorWith('前半后半');
    insertFragmentAtRange(editor, caret(textOf(editor, '前半后半'), 2), fragment('<figure>图</figure><p><br></p>'));
    expect(editor.innerHTML).toBe('前半<figure>图</figure><p><br></p>后半');
  });

  it('光标在两块之间（编辑区本身）：原地插入', () => {
    const editor = editorWith('<p>甲</p><p>乙</p>');
    insertFragmentAtRange(editor, caret(editor, 1), fragment('<figure>图</figure>'));
    expect(editor.innerHTML).toBe('<p>甲</p><figure>图</figure><p>乙</p>');
  });

  it('光标正好在换行前：后半段开头不多出一行空白', () => {
    const editor = editorWith('<p>第一行<br>第二行</p>');
    insertFragmentAtRange(editor, caret(textOf(editor, '第一行'), 3), fragment('<figure>图</figure>'));
    expect(editor.innerHTML).toBe('<p>第一行</p><figure>图</figure><p>第二行</p>');
  });

  it('光标在列表项开头：列表从这一项断开，不留空圆点', () => {
    const editor = editorWith('<ul><li>一</li><li>二</li></ul>');
    insertFragmentAtRange(editor, caret(textOf(editor, '二'), 0), fragment('<figure>图</figure>'));
    expect(editor.innerHTML).toBe('<ul><li>一</li></ul><figure>图</figure><ul><li>二</li></ul>');
  });

  it('光标在加粗字的开头：切口上不留空的 <strong>', () => {
    const editor = editorWith('<p>甲<strong>乙丙</strong></p>');
    insertFragmentAtRange(editor, caret(textOf(editor, '乙丙'), 0), fragment('<figure>图</figure>'));
    expect(editor.innerHTML).toBe('<p>甲</p><figure>图</figure><p><strong>乙丙</strong></p>');
  });

  it('光标在整块里（导入的引文）：块排在整块后面，整块不劈开', () => {
    const quote = '<blockquote data-imported-from="材料.md"><p>引文</p></blockquote>';
    const editor = editorWith(`${quote}<p>我的看法</p>`);
    insertFragmentAtRange(editor, caret(textOf(editor, '引文'), 1), fragment('<figure>图</figure>'));
    expect(editor.innerHTML).toBe(`${quote}<figure>图</figure><p>我的看法</p>`);
  });

  it('整块后面本来就有空行：不再叠一行空白，接着写的地方是原来那个空行', () => {
    const editor = editorWith('<p data-scaffold-id="s"><span data-scaffold-input="">括号里</span></p><p><br></p>');
    const blank = editor.children[1];
    const placed = insertFragmentAtRange(editor, caret(textOf(editor, '括号里'), 1), fragment('<figure>图</figure><p><br></p>'));
    expect(editor.innerHTML).toBe('<p data-scaffold-id="s"><span data-scaffold-input="">括号里</span></p><figure>图</figure><p><br></p>');
    expect(placed.at(-1)).toBe(blank);
  });

  it('光标记在正文末尾、紧跟着一个空行（刚打开笔记）：算在那个空行上', () => {
    const editor = editorWith('<p>甲</p><p><br></p>');
    insertFragmentAtRange(editor, caret(editor, 2), fragment('<figure>图</figure><p><br></p>'));
    expect(editor.innerHTML).toBe('<p>甲</p><figure>图</figure><p><br></p>');
  });
});

describe('replaceAtTopLevel', () => {
  it('套了两层的段落：外层容器从它前后劈开，替换的内容在最外层', () => {
    const editor = editorWith('<div><blockquote><p>甲</p><p>乙</p></blockquote><p>丙</p></div>');
    const piece = document.createElement('p');
    piece.textContent = '支架';
    replaceAtTopLevel(editor, editor.querySelectorAll('p')[1], [piece]);
    expect(editor.innerHTML).toBe('<div><blockquote><p>甲</p></blockquote></div><p>支架</p><div><p>丙</p></div>');
  });

  it('列表里唯一的一项：整个列表都换掉，不留空列表', () => {
    const editor = editorWith('<p>前</p><ul><li>唯一</li></ul><p>后</p>');
    const piece = document.createElement('p');
    piece.textContent = '支架';
    replaceAtTopLevel(editor, editor.querySelector('li')!, [piece]);
    expect(editor.innerHTML).toBe('<p>前</p><p>支架</p><p>后</p>');
  });

  it('本来就在最外层：原地替换', () => {
    const editor = editorWith('<p>甲</p><p>乙</p>');
    const piece = document.createElement('p');
    piece.textContent = '支架';
    replaceAtTopLevel(editor, editor.children[1], [piece]);
    expect(editor.innerHTML).toBe('<p>甲</p><p>支架</p>');
  });
});

describe('wholeBlockOf', () => {
  it('取最外一层整块：AI 块里的采纳支架标签算在 AI 块里', () => {
    const editor = editorWith('<div data-ai-source="genai"><div data-scaffold-id="g"><strong data-scaffold-tag="">话头</strong></div></div>');
    expect(wholeBlockOf(editor, textOf(editor, '话头'))).toBe(editor.firstElementChild);
  });

  it('编辑区外的节点不算', () => {
    const editor = editorWith('<p>甲</p>');
    const outside = document.createElement('figure');
    document.body.appendChild(outside);
    expect(wholeBlockOf(editor, outside)).toBeNull();
    expect(wholeBlockOf(editor, editor)).toBeNull();
  });
});
