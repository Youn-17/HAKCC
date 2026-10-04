/**
 * 文档批注的锚定。Markdown 和 Word（转成 HTML 之后）共用同一套。
 *
 * 锚点是「所属标题 + 引文」，不是字符偏移，也不是 XPath。
 * 文档是可以被编辑的，任何基于位置的锚点在下一次保存之后都会静默指向别处，
 * 而**指错比丢失更糟** —— 学生会以为同伴在批评另一段话。
 * 引文对不上时，界面明确显示「原文已修改」并退回定位到标题，把不确定性说出来。
 */

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

export type TextAnchor = { kind: 'text'; headingId: string | null; quote: string };

/** 引文过长会把批注卡撑爆，也没必要 —— 定位只需要足够独特的一段。 */
export const MAX_QUOTE_LENGTH = 300;

/**
 * 给 h1~h3 加稳定 id 并抽出目录。
 * id 在**消毒之后**才加：危险内容由 DOMPurify 剔除，锚点是我们自己生成的，
 * 不来自文件，所以不会把风险加回去。
 */
export function addHeadingIds(cleanHtml: string): { html: string; outline: OutlineItem[] } {
  const doc = new DOMParser().parseFromString(cleanHtml, 'text/html');
  const outline: OutlineItem[] = [];
  const used = new Set<string>();

  doc.querySelectorAll('h1, h2, h3').forEach((el, index) => {
    const text = (el.textContent ?? '').trim();
    if (!text) return;
    let id = `md-h-${index}`;
    while (used.has(id)) id = `${id}-x`;
    used.add(id);
    el.setAttribute('id', id);
    outline.push({ id, text, level: Number(el.tagName.slice(1)) });
  });

  return { html: doc.body.innerHTML, outline };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 选区所在位置之前最近的那个标题 —— 批注归属到哪一节。 */
function nearestHeadingId(container: HTMLElement, node: Node | null): string | null {
  if (!node) return null;
  const heads = [...container.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]')];
  if (heads.length === 0) return null;

  let found: string | null = null;
  for (const head of heads) {
    // compareDocumentPosition: 标题在选区之前才算「所属」
    const rel = head.compareDocumentPosition(node);
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) found = head.id;
    else break;
  }
  return found;
}

/** 把当前选区变成一个锚点。选区为空或不在容器内返回 null。 */
export function anchorFromSelection(container: HTMLElement): { anchor: TextAnchor; quote: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const quote = normalize(selection.toString()).slice(0, MAX_QUOTE_LENGTH);
  if (!quote) return null;

  return {
    anchor: { kind: 'text', headingId: nearestHeadingId(container, range.startContainer), quote },
    quote,
  };
}

/**
 * 在容器里找回一段引文，返回可用于定位的 Range。
 * 找不到就返回 null —— 调用方据此显示「原文已修改」并退回定位到标题。
 */
export function findQuoteRange(container: HTMLElement, quote: string): Range | null {
  const needle = normalize(quote);
  if (!needle) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  // 把所有文本节点连成一条，同时记下每个节点在这条长串里的起点，
  // 这样跨节点（引文中间夹着 <strong>）的引文也能找回来。
  const chunks: { node: Text; start: number }[] = [];
  let joined = '';
  let current = walker.nextNode() as Text | null;
  while (current) {
    chunks.push({ node: current, start: joined.length });
    joined += current.data;
    current = walker.nextNode() as Text | null;
  }

  // 原文里的空白可能和引文不同（换行、缩进），两边都压平再找
  const flatten = (raw: string) => raw.replace(/\s+/g, ' ');
  const haystack = flatten(joined);
  const at = haystack.indexOf(needle);
  if (at < 0) return null;

  // 压平会改变下标，用逐字符走位把压平后的位置映射回原始位置
  const mapIndex = (flatIndex: number): number => {
    let flat = 0;
    let prevSpace = false;
    for (let i = 0; i < joined.length; i++) {
      const isSpace = /\s/.test(joined[i]);
      if (isSpace && prevSpace) continue;
      if (flat === flatIndex) return i;
      flat++;
      prevSpace = isSpace;
    }
    return joined.length;
  };

  const startRaw = mapIndex(at);
  const endRaw = mapIndex(at + needle.length);

  const locate = (offset: number) => {
    for (let i = chunks.length - 1; i >= 0; i--) {
      if (chunks[i].start <= offset) {
        return { node: chunks[i].node, offset: Math.min(offset - chunks[i].start, chunks[i].node.length) };
      }
    }
    return null;
  };

  const from = locate(startRaw);
  const to = locate(endRaw);
  if (!from || !to) return null;

  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    return null;
  }
  return range;
}

/**
 * 滚到锚点。优先定位引文，找不到退回标题；都找不到返回 false，
 * 由调用方告诉学生「这条批注对应的原文已经改了」。
 *
 * 显式滚容器而不是 scrollIntoView：弹层里套着好几层可滚动祖先，滚错一层
 * 就表现为「点了没反应」；smooth 也并非到处生效（减少动效、部分内嵌浏览器），
 * 所以补一个兜底。
 */
export function scrollToAnchor(
  container: HTMLElement,
  anchor: { kind?: string; headingId?: string | null; quote?: string },
): { found: boolean; quoteFound: boolean } {
  let top: number | null = null;
  let quoteFound = false;

  if (anchor.quote) {
    const range = findQuoteRange(container, anchor.quote);
    if (range) {
      const rect = range.getBoundingClientRect();
      top = container.scrollTop + rect.top - container.getBoundingClientRect().top - 80;
      quoteFound = true;
      highlight(range);
    }
  }

  if (top === null && anchor.headingId) {
    const head = container.querySelector<HTMLElement>(`#${CSS.escape(anchor.headingId)}`);
    if (head) {
      top = container.scrollTop + head.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
    }
  }

  if (top === null) return { found: false, quoteFound: false };

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const before = container.scrollTop;
  const target = Math.max(0, top);
  container.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
  if (!reduced) {
    window.setTimeout(() => {
      if (container.scrollTop === before && Math.abs(target - before) > 1) container.scrollTop = target;
    }, 260);
  }
  return { found: true, quoteFound };
}

/**
 * 高亮用 CSS Custom Highlight API：它不碰 DOM。
 * 往 React 用 dangerouslySetInnerHTML 渲染出来的内容里插 <mark>，
 * 下一次重渲染就会被抹掉，还可能打乱后续锚点的文本偏移。
 * 浏览器不支持就安静跳过 —— 滚到位置已经解决了主要问题。
 */
const HIGHLIGHT_NAME = 'hakcc-doc-quote';

function highlight(range: Range): void {
  const api = (CSS as unknown as { highlights?: Map<string, unknown>; }).highlights;
  const Ctor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!api || !Ctor) return;
  try {
    api.set(HIGHLIGHT_NAME, new Ctor(range));
    window.setTimeout(() => api.delete(HIGHLIGHT_NAME), 2600);
  } catch {
    /* 高亮只是锦上添花，失败不该影响滚动 */
  }
}

export function clearHighlight(): void {
  const api = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  api?.delete(HIGHLIGHT_NAME);
}
