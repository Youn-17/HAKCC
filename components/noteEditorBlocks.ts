/**
 * 笔记编辑区的块级结构：支架、AI 插入块、图片、附件卡片一律是编辑区最外层的块。
 *
 * range.insertNode、直接拼 DOM 能造出 HTML 解析器永远造不出的嵌套（<p> 里套 <div>、<p>、<figure>），
 * innerHTML 又原样把它写进库。之后每一次解析 —— 阅读视图、下次打开编辑器、后端存稿前的
 * sanitizeNoteHtml —— 都先把外层 <p> 关掉，库里的字符串和显示出来的结构对不上；研究切分
 * noteSegments 直接在字符串上数标签，会把学生自己的字算进 AI 块，或者把支架记成外层那一条的 id。
 */

/** 块级元素：解析器遇到它们会先关掉外层 <p>，它们也不该长在 span、strong 这类行内元素里 */
export const BLOCK_SELECTOR = [
  'address', 'article', 'aside', 'blockquote', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'li', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'plaintext', 'pre', 'search', 'section', 'summary',
  'table', 'ul', 'xmp',
].join(',');

/**
 * 各有归属、只能整块挪动的块：支架、AI 内容、附件、导入的材料。
 * 光标在它们里面时，新内容排在它后面：既不劈开它，也不把它的字框进别的结构（研究切分按整块认来源）。
 */
const WHOLE_BLOCK_SELECTOR = '[data-scaffold-id],[data-ai-source],[data-ai-adoption-reason],[data-note-asset],[data-imported-from],[data-attachment],figure,table';

const MEDIA_SELECTOR = 'img,video,audio,iframe,object,embed,svg,canvas,hr,table';

/** 编辑区最外层里包着 node 的那一个节点；node 就是编辑区本身或不在编辑区里时返回 null */
export function topLevelOf(editor: HTMLElement, node: Node | null): ChildNode | null {
  let current = node;
  while (current && current.parentNode !== editor) current = current.parentNode;
  return current as ChildNode | null;
}

/** 包着 node 的最外一层整块（支架、AI 块、附件……）；不在整块里，或不在编辑区里，返回 null */
export function wholeBlockOf(editor: HTMLElement, node: Node | null): HTMLElement | null {
  let found: HTMLElement | null = null;
  let el = !node ? null : node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el && el !== editor) {
    if (el.matches(WHOLE_BLOCK_SELECTOR)) found = el as HTMLElement;
    el = el.parentElement;
  }
  return el === editor ? found : null;
}

export const containsBlock = (el: Element) => !!el.querySelector(BLOCK_SELECTOR);

/** 有看得见的内容：除空白和零宽占位符以外的字，或者图片一类的媒体 */
export const hasVisibleContent = (el: Element) =>
  !!(el.textContent ?? '').replace(/[\s\u200b]/g, '') || el.matches(MEDIA_SELECTOR) || !!el.querySelector(MEDIA_SELECTOR);

const isLeaf = (el: Element) => el.matches(`${MEDIA_SELECTOR},br`);

/**
 * 剥掉切口上的空壳。extractContents 会把光标所在的每一层元素各复制一份，
 * 切口一侧常剩下空的 <strong></strong>、<li></li> —— 空的列表项会显示成一个空圆点。
 */
function trimCut(el: Element, side: 'first' | 'last'): void {
  for (let node = side === 'first' ? el.firstChild : el.lastChild; node;) {
    const next = side === 'first' ? node.nextSibling : node.previousSibling;
    if (node.nodeType === Node.ELEMENT_NODE && !isLeaf(node as Element)) trimCut(node as Element, side);
    const empty = node.nodeType === Node.TEXT_NODE
      ? !node.textContent
      : node.nodeType === Node.ELEMENT_NODE && !node.childNodes.length && !isLeaf(node as Element);
    if (!empty) return;
    node.remove();
    node = next;
  }
}

/** 从 range 起点到 host 末尾剪下来，装进一个和 host 同样的空壳里；两边切口上的空壳都剥掉 */
function cutTail(host: Element, from: Range): Element {
  const rest = host.cloneNode(false) as Element;
  rest.appendChild(from.extractContents());
  trimCut(host, 'last');
  trimCut(rest, 'first');
  return rest;
}

/** 学生留的空行：没有属性、没有内容的 <p> */
const isBlankLine = (node: Node | null | undefined): node is Element =>
  !!node && node.nodeName === 'P' && !(node as Element).attributes.length && !hasVisibleContent(node as Element);

/**
 * 在 range 处插入片段，返回片段占据的顶层节点，最后一个是接着写的地方。
 * 只有行内内容时原地插入；带块的片段只进编辑区最外层：
 *   光标在普通段落、标题、列表这类没有归属的块里 —— 从光标处劈成前后两块，片段放在中间，劈出来的空块不留；
 *   光标在支架、AI 块、图片这类整块里 —— 片段排在整块后面，整块原样；
 *   光标本来就在最外层（两块之间，或没包段落的一行字里）—— 原地插入。
 */
export function insertFragmentAtRange(editor: HTMLElement, range: Range, fragment: DocumentFragment): ChildNode[] {
  const nodes = Array.from(fragment.childNodes);
  const host = topLevelOf(editor, range.startContainer);
  if (!nodes.length || !fragment.querySelector(BLOCK_SELECTOR)) {
    range.insertNode(fragment);
    return nodes;
  }
  if (!host || host.nodeType !== Node.ELEMENT_NODE) {
    // 光标落在最外层、紧跟着一个空行（刚打开笔记时光标记在正文末尾就是这样）：算在那个空行上
    const before = range.startContainer === editor ? editor.childNodes[range.startOffset - 1] : null;
    if (range.collapsed && isBlankLine(before)) before.replaceWith(fragment);
    else range.insertNode(fragment);
    return reuseBlankLine(nodes);
  }
  const hostEl = host as Element;
  if (wholeBlockOf(editor, range.startContainer) || isLeaf(hostEl)) {
    hostEl.after(fragment);
    return reuseBlankLine(nodes);
  }
  const tail = editor.ownerDocument.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEnd(hostEl, hostEl.childNodes.length);
  const rest = cutTail(hostEl, tail);
  // 光标正好停在一个换行前：插进来的块自己就换了行，后半段开头再留这个 <br> 就多出一行空白
  if (rest.firstChild?.nodeName === 'BR') rest.firstChild.remove();
  hostEl.after(fragment);
  if (hasVisibleContent(rest)) nodes[nodes.length - 1].after(rest);
  if (!hasVisibleContent(hostEl)) hostEl.remove();
  return reuseBlankLine(nodes);
}

/** 片段末尾带来的空行，后面紧挨着本来就有一个空行：不叠两行空白，用原来那个 */
function reuseBlankLine(nodes: ChildNode[]): ChildNode[] {
  const last = nodes[nodes.length - 1];
  const next = last?.nextSibling;
  if (!isBlankLine(last) || !isBlankLine(next)) return nodes;
  last.remove();
  return [...nodes.slice(0, -1), next as ChildNode];
}

/**
 * 用 pieces 换掉 target。target 套在列表、引用这类容器里时，先从它前后把容器劈开，
 * pieces 落在编辑区最外层；劈出来的空容器不留。
 */
export function replaceAtTopLevel(editor: HTMLElement, target: Element, pieces: Node[]): void {
  const host = topLevelOf(editor, target);
  if (!host || host === target || host.nodeType !== Node.ELEMENT_NODE) {
    target.replaceWith(...pieces);
    return;
  }
  const hostEl = host as Element;
  const tail = editor.ownerDocument.createRange();
  tail.setStartAfter(target);
  tail.setEnd(hostEl, hostEl.childNodes.length);
  target.remove();
  const rest = cutTail(hostEl, tail);
  hostEl.after(...pieces, rest);
  if (!hasVisibleContent(rest)) rest.remove();
  if (!hasVisibleContent(hostEl)) hostEl.remove();
}
