/**
 * 笔记正文（HTML）→ 纯文本预览。
 *
 * 抽出来是因为「去掉标签」到处都在做，但大多只写了 `replace(/<[^>]*>/g, '')`，
 * 漏掉实体解码 —— 富文本编辑器会大量产出 `&nbsp;`，于是卡片和侧栏里
 * 直接显示出 "差异。&nbsp;这中间" 这样的字面量。
 *
 * 用正则而不是 DOMParser：一块画布上百张卡，每张都解析一次 DOM 太贵。
 */
export function notePreviewText(html?: string | null): string {
  if (!html) return '';
  return html
    // script/style 的内容不是正文，整段丢掉
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    // &amp; 必须最后解，否则 "&amp;lt;" 会被两步解成 "<"
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 笔记正文（HTML）→ 保留分段的纯文本，段与段之间空一行，给能上下滚动阅读的地方用（画布右侧详情栏）。
 * notePreviewText 把所有空白压成一个空格，长文在那里就成了一整堵字墙。
 * 行内标签直接去掉、不补空格：支架、加粗这些 span 夹在中文句子中间，补空格会把句子劈开。
 */
export function notePlainParagraphs(html?: string | null): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    // 源码里的换行只是排版，浏览器也把它当空格
    .replace(/\r?\n/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    // 段与段之间空一行，列表项、段内换行只换行：显示时按空行切成段落
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|blockquote|pre|tr|ul|ol)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 笔记字数：一个汉字算一个，西文按词算，和编辑器底栏同一个口径。
 * 按空白切分数不了中文（一整段只算一个词），没解码的 &nbsp; 还会自己算成一个词。
 */
export function noteWordCount(html?: string | null): number {
  const text = notePreviewText(html);
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const latin = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/\b\w+\b/g) ?? []).length;
  return cjk + latin;
}

/**
 * 搜索时拿来比的正文：看得见的字，小写。
 * 直接比 HTML，搜 "span"、"nbsp" 几乎条条命中，搜 "A&B" 反而找不到写着 A&B 的笔记。
 */
export function noteSearchText(html?: string | null): string {
  return notePreviewText(html).toLowerCase();
}

let inertDoc: Document | null = null;

/**
 * 笔记正文（HTML）→ 逐字的纯文本，给按字符偏移做标注的地方用（质性编码）。
 *
 * 不能用 document.createElement('div').innerHTML：游离的元素也属于当前页面，
 * 正文里的 <img src=x onerror=…> 一解析就执行 —— 正文是作者存的原始 HTML，后端不清洗。
 * 改在没有浏览上下文的文档里解析：不加载资源、不跑事件处理器；
 * 仍是 div 上下文的片段解析，textContent 和原来一致，已存的编码偏移不会错位。
 */
export function htmlToPlainText(html?: string | null): string {
  if (!html) return '';
  inertDoc ??= document.implementation.createHTMLDocument('');
  const div = inertDoc.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * AI 回复（纯文本 / Markdown 原文）→ 放进笔记的 HTML。先转义：模型输出里的尖括号只能是字。
 * 分段规则和后端 notes.ts 的 textToHtmlParagraphs 一致：空行分段，段内换行变 <br>。
 */
export function plainTextToNoteHtml(text?: string | null): string {
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * 笔记的时间，到分钟：卡片署名行和右侧详情栏同一个格式（详情栏原来带秒）。
 * 年份始终显示 —— 课程跨学期复用同一个空间，只看月日会把去年的笔记误认成本周的。
 */
export function formatNoteStamp(note: { createdAt?: string; date?: string }): string {
  const iso = note.createdAt;
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return note.date ? note.date.split(' ')[0] : '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
