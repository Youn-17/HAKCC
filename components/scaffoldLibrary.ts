import type { Language, Scaffold } from '../types';

/**
 * 支架库的共享规则。
 *
 * 支架来自五学期支架分类表（177 条，四个一级分类 × 16 个支架组）。
 * 一条支架就是学生在笔记里看到的那句话头本身 ——「我的理论」「ChatGPT 提供的案例是」——
 * 所以列表和笔记里显示的都是支架文本，不是分类名。
 *
 * 笔记里的形态固定为：**支架文本**[学生写的内容]。方括号是给学生和读者的边界提示：
 * 括号里是他自己的话，括号外是课堂给的话头。研究编码靠 data-scaffold-id，不靠文本匹配。
 */

export type ScaffoldL1 = 'TB' | 'KB' | 'CT' | 'GAI';

export const L1_ORDER: ScaffoldL1[] = ['TB', 'KB', 'CT', 'GAI'];

export const L1_LABEL: Record<ScaffoldL1, { zh: string; en: string; tone: string }> = {
  TB:  { zh: 'KF 默认支架',  en: 'Theory Building', tone: 'amber'   },
  KB:  { zh: '知识建构',     en: 'Knowledge Building', tone: 'indigo'  },
  CT:  { zh: '计算思维',     en: 'Computational Thinking', tone: 'emerald' },
  GAI: { zh: '生成式 AI 交互', en: 'Generative AI', tone: 'sky'     },
};

/** 一级分类的配色。写成完整类名，Tailwind 才扫得到。 */
export const L1_TONE: Record<ScaffoldL1, { chip: string; chipActive: string; dot: string }> = {
  TB: {
    chip: 'border-amber-200 text-amber-800 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300',
    chipActive: 'border-amber-500 bg-amber-500 text-white',
    dot: 'bg-amber-500',
  },
  KB: {
    chip: 'border-indigo-200 text-indigo-800 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300',
    chipActive: 'border-indigo-600 bg-indigo-600 text-white',
    dot: 'bg-indigo-600',
  },
  CT: {
    chip: 'border-emerald-200 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300',
    chipActive: 'border-emerald-600 bg-emerald-600 text-white',
    dot: 'bg-emerald-600',
  },
  GAI: {
    chip: 'border-sky-200 text-sky-800 hover:bg-sky-50 dark:border-sky-900 dark:text-sky-300',
    chipActive: 'border-sky-600 bg-sky-600 text-white',
    dot: 'bg-sky-600',
  },
};

export function scaffoldL1(scaffold: Scaffold): ScaffoldL1 {
  const l1 = scaffold.metadata?.l1;
  if (l1 && L1_ORDER.includes(l1 as ScaffoldL1)) return l1 as ScaffoldL1;
  return 'KB';
}

/** 学生看到的那句话头。中文界面用中文支架，英文界面用英文；缺一个就退回另一个。 */
export function scaffoldLabel(scaffold: Scaffold, lang: Language): string {
  if (lang === 'en') return (scaffold.titleEn || scaffold.title || '').trim();
  return (scaffold.title || scaffold.titleEn || '').trim();
}

/** 支架组名（二级分类）。 */
export function scaffoldGroup(scaffold: Scaffold, lang: Language): string {
  const meta = scaffold.metadata;
  const fromMeta = lang === 'en' ? meta?.l2_en : meta?.l2_zh;
  if (fromMeta) return fromMeta;
  const parts = (scaffold.category || '').split('/');
  return parts[1] || parts[0] || (lang === 'zh' ? '未分类' : 'Uncategorized');
}

/**
 * 这条支架是不是要求学生转述 AI 的产出。AI 内容入笔记时只能从这一批里选：
 * 话头排在 AI 原文前面，AI 原文放进后面的方括号里，所以话头必须是对那段文字的说明。
 * 明确写了 gai:false 的不算——「思考后询问 GAI」「GAI 使用回顾与校准」这类是学生写自己想法的话头，
 * 一级类虽然是 GAI（生成式 AI 交互），AI 原文放进它们后面的方括号里读不通。
 */
export function isGenAiScaffold(scaffold: Scaffold): boolean {
  if (scaffold.metadata?.gai === false) return false;
  return scaffold.metadata?.gai === true || scaffoldL1(scaffold) === 'GAI';
}

/**
 * 教师在支架管理里保存一条支架时，metadata.gai 怎么写。
 * 新建：一级类是 GAI 就算 GenAI 支架；已有的：原来明确是 false 的保持 false（改个字不能让
 * 「思考后询问 GAI」这类话头悄悄变成采纳时的选项），原来是 true 的保持 true。
 */
export function gaiFlagForSave(l1: ScaffoldL1, existing?: Scaffold['metadata'] | null): boolean {
  if (existing?.gai === false) return false;
  return l1 === 'GAI' || existing?.gai === true;
}

export function scaffoldMatches(scaffold: Scaffold, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [scaffold.title, scaffold.titleEn, scaffold.category, ...(scaffold.metadata?.variants ?? [])]
    .some(v => (v ?? '').toLowerCase().includes(q));
}

/** 一级分类 → 支架组 → 支架，保持分类表原始次序。 */
export function groupScaffolds(scaffolds: Scaffold[], lang: Language) {
  const byL1 = new Map<ScaffoldL1, Map<string, Scaffold[]>>();
  const ordered = [...scaffolds].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const scaffold of ordered) {
    const l1 = scaffoldL1(scaffold);
    const group = scaffoldGroup(scaffold, lang);
    if (!byL1.has(l1)) byL1.set(l1, new Map());
    const groups = byL1.get(l1)!;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(scaffold);
  }
  return L1_ORDER
    .filter(l1 => byL1.has(l1))
    .map(l1 => ({ l1, groups: [...byL1.get(l1)!.entries()].map(([name, items]) => ({ name, items })) }));
}

// ── 笔记里的支架标记 ──────────────────────────────────────────────

/** 空支架槽里放一个零宽空格：保证这个 span 在 innerHTML 往返里不被吞掉，
 *  光标也才有个文本节点可落。JS 的 trim() 不认它，判空要用 isEmptyScaffoldSlot。 */
const ZERO_WIDTH = '\u200B';

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const SCAFFOLD_CARET_SELECTOR = '[data-scaffold-input]';

/** 支架槽里除了零宽占位符还有没有真内容。 */
export function isEmptyScaffoldSlot(node: Element | null | undefined): boolean {
  if (!node) return false;
  return (node.textContent ?? '').replace(/\u200B/g, '').trim() === '';
}

/** 存稿前把零宽占位符和「空槽」标记去掉，导出的正文里不留不可见字符和编辑器的临时状态。 */
export function stripScaffoldPlaceholders(html: string): string {
  return html.replace(/\u200B/g, '').replace(/ data-scaffold-empty(="")?/g, '');
}

/**
 * 生成「**支架文本**[ ]」这一段。data-scaffold-id 是研究编码的锚点：
 * 学生后来改写了句子，也还能查到这条内容当初挂在哪个支架下。
 */
export function scaffoldMarkerHtml(scaffold: Scaffold, lang: Language, body = ''): string {
  const label = scaffoldLabel(scaffold, lang);
  const inner = body.trim() ? body : ZERO_WIDTH;
  return (
    `<p data-scaffold-id="${esc(scaffold.id)}" data-scaffold-l1="${esc(scaffoldL1(scaffold))}" data-scaffold-title="${esc(label)}">` +
      `<strong data-scaffold-tag>${esc(label)}</strong>` +
      `<span data-scaffold-slot>` +
        `<span data-scaffold-bracket>[</span>` +
        `<span data-scaffold-input>${body.trim() ? esc(body) : inner}</span>` +
        `<span data-scaffold-bracket>]</span>` +
      `</span>` +
    `</p>`
  );
}

/**
 * 把编辑器里的支架标记整理成当前结构，并把话头与括号设为不可编辑。
 *
 * 为什么在运行时做而不是写进 HTML：插入走 DOMPurify，contenteditable 属性会被剥掉；
 * 老笔记里的括号还是裸文本。每次打开和每次输入后跑一遍，两种情况都盖住。
 * 学生因此删不掉话头和括号 —— 支架是课堂给的框，删了研究编码就断了。
 */
export function normalizeScaffoldMarkers(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-scaffold-id]').forEach(block => {
    const input = block.querySelector<HTMLElement>('[data-scaffold-input]');
    let tag = block.querySelector<HTMLElement>('[data-scaffold-tag]');
    if (!input) return;                       // 没有输入槽的不是标准标记（AI 插入块 / 劈坏的克隆），别碰

    if (!tag) {
      // 话头被删了：按 data-scaffold-title 补回来
      tag = document.createElement('strong');
      tag.setAttribute('data-scaffold-tag', '');
      tag.textContent = block.getAttribute('data-scaffold-title') ?? '';
      block.insertBefore(tag, block.firstChild);
    }
    tag.contentEditable = 'false';

    let slot = input.closest<HTMLElement>('[data-scaffold-slot]');
    if (!slot || slot === block) {
      slot = document.createElement('span');
      slot.setAttribute('data-scaffold-slot', '');
      input.replaceWith(slot);
      slot.appendChild(input);
    }
    // 括号：老结构是裸文本 "[" / "]"，统一换成不可编辑的 span；缺了就补
    const mk = (ch: string) => {
      const b = document.createElement('span');
      b.setAttribute('data-scaffold-bracket', '');
      b.textContent = ch;
      b.contentEditable = 'false';
      return b;
    };
    Array.from(slot.childNodes).forEach(n => {
      if (n.nodeType === Node.TEXT_NODE && /^\s*[\[\]]?\s*$/.test(n.textContent ?? '')) n.parentNode?.removeChild(n);
    });
    const brackets = slot.querySelectorAll<HTMLElement>('[data-scaffold-bracket]');
    brackets.forEach(b => { b.contentEditable = 'false'; });
    if (!brackets[0] || brackets[0].compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING) slot.insertBefore(mk('['), slot.firstChild);
    if (!slot.lastElementChild?.hasAttribute('data-scaffold-bracket') || slot.lastElementChild === slot.firstElementChild) slot.appendChild(mk(']'));
    // 括号里还没写字：编辑器按这个标记显示灰色的「写在这里……」（index.css）。
    // 空槽里有个零宽占位符，:empty 选不中，只能在这里判断；每次输入后都会重跑，写了字就摘掉
    const empty = isEmptyScaffoldSlot(input) && !input.querySelector('img,video,audio,iframe,svg');
    input.toggleAttribute('data-scaffold-empty', empty);
  });
}

/** 从笔记 HTML 里读出用到的支架 id，用于统计和研究导出。 */
export function extractScaffoldIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /data-scaffold-id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) ids.add(m[1]);
  return [...ids];
}
