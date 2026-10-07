/**
 * 页码对照表：正文里第几个字起是第几页（页码从 1 起），按位置从小到大排。
 * 课程知识库给片段标页码用（第 2 步「页码引用」）：AI 引用资料能说到第几页，来源卡片能跳到那一页。
 *
 * 只有 PDF 有页码。两种来源：
 * - MinerU：解析包里的 *_content_list.json 每块带 page_idx（从 0 起）。我们照旧用 full.md 当正文，
 *   拿各块的文字去 full.md 里按顺序找位置，记下这一块从哪儿开始、属于第几页。找不到的块（图片、公式写法不同）跳过。
 * - 本地 pdf-parse：逐页取文字再拼起来，拼的时候记下每页从哪儿开始。
 *
 * Word、Markdown、纯文本没有固定页码，对照表为空。
 */

export type PageMap = Array<[offset: number, page: number]>;

type ContentBlock = { type?: string; text?: unknown; page_idx?: unknown; list_items?: unknown; table_caption?: unknown };

/** 页眉、页脚、页码这些块 full.md 里没有，不拿来定位 */
const SKIP_TYPES = new Set(['header', 'footer', 'page_number', 'page_footnote', 'image', 'chart']);
/** 拿每块开头这么多个字去找；太短容易撞上别处，太长遇到格式差异就找不到 */
const PROBE_CHARS = 24;
/** 去掉 Markdown 记号和空白再比，full.md 和分块清单的写法不完全一样 */
const normalize = (s: string) => s.replace(/[#*_`>|\-\s$\\]+/g, '');

function blockText(block: ContentBlock): string {
  if (typeof block.text === 'string') return block.text;
  if (Array.isArray(block.list_items)) return block.list_items.filter(x => typeof x === 'string').join(' ');
  return '';
}

/**
 * 在 markdown 里依次定位各块。为了不被格式差异卡住，先把 markdown 压成「只留字」的版本，
 * 记下压缩后每个字在原文的位置，在压缩版里找，再换算回原文位置。
 */
export function pageMapFromContentList(markdown: string, blocks: unknown): PageMap {
  if (!Array.isArray(blocks) || !markdown) return [];
  const kept: number[] = [];
  let compact = '';
  for (let i = 0; i < markdown.length; i++) {
    const ch = markdown[i];
    if (!/[#*_`>|\-\s$\\]/.test(ch)) {
      compact += ch;
      kept.push(i);
    }
  }
  const map: PageMap = [];
  let cursor = 0;
  for (const raw of blocks as ContentBlock[]) {
    if (!raw || typeof raw !== 'object') continue;
    if (SKIP_TYPES.has(String(raw.type ?? ''))) continue;
    const page = Number(raw.page_idx);
    if (!Number.isInteger(page) || page < 0) continue;
    const probe = normalize(blockText(raw)).slice(0, PROBE_CHARS);
    if (probe.length < 6) continue;
    const at = compact.indexOf(probe, cursor);
    if (at < 0) continue;
    cursor = at + probe.length;
    // 退到这一行的 Markdown 记号前面（「## 标题」「**加粗**」），片段开头带着这些记号也能落在这一页
    let offset = kept[at];
    while (offset > 0 && /[#*_`>|\-$\\ \t]/.test(markdown[offset - 1])) offset--;
    const last = map[map.length - 1];
    if (last && last[1] === page + 1) continue;
    if (last && page + 1 < last[1]) continue; // 页码不该往回走：顺序乱的块不信
    map.push([offset, page + 1]);
  }
  // 第一个找到的块在第 1 页，它前面的字也只能在第 1 页
  if (map.length && map[0][1] === 1) map[0] = [0, 1];
  return map;
}

/** 逐页文字拼成正文，同时记下每页的起点。页与页之间空一行 */
export function joinPages(pages: Array<{ num: number; text: string }>): { text: string; pageMap: PageMap } {
  let text = '';
  const pageMap: PageMap = [];
  for (const p of pages.slice().sort((a, b) => a.num - b.num)) {
    const body = (p.text ?? '').trim();
    if (!body) continue;
    if (text) text += '\n\n';
    pageMap.push([text.length, p.num]);
    text += body;
  }
  return { text, pageMap };
}

/** 某个位置在第几页：对照表里不超过它的最后一项；表为空或位置在第一项之前返回 null */
export function pageAt(map: PageMap | null | undefined, offset: number): number | null {
  if (!map?.length || offset < map[0][0]) return null;
  let lo = 0;
  let hi = map.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map[mid][0] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return map[lo][1];
}

/** 对照表最后一项就是最后一页（资料列表显示页数用）；不是对照表或为空返回 null */
export function lastPageOf(map: unknown): number | null {
  if (!Array.isArray(map) || map.length === 0) return null;
  const last = map[map.length - 1];
  return Array.isArray(last) && Number.isInteger(last[1]) ? last[1] : null;
}

/** 对照表的位置整体平移（正文前面被裁掉了几个字时用），挪到 0 之前的并到第一页 */
export function shiftPageMap(map: PageMap | null | undefined, by: number): PageMap {
  if (!map?.length) return [];
  const out: PageMap = [];
  for (const [offset, page] of map) {
    const moved = Math.max(0, offset - by);
    if (out.length && out[out.length - 1][0] === moved) out[out.length - 1] = [moved, page];
    else out.push([moved, page]);
  }
  return out;
}

/**
 * 给切好的片段标起止页：在正文里按顺序找每片的位置，起点和终点各查一次页码。
 * 切段时超长段落按句子拆开、句间空白会丢，所以比对时两边都去掉空白。找不到的片段两头都记 null。
 */
export function pagesForChunks(text: string, chunks: Array<{ content: string }>, map: PageMap | null | undefined): Array<{ start: number | null; end: number | null }> {
  if (!map?.length) return chunks.map(() => ({ start: null, end: null }));
  const kept: number[] = [];
  let compact = '';
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) {
      compact += text[i];
      kept.push(i);
    }
  }
  let cursor = 0;
  return chunks.map(chunk => {
    const body = chunk.content.replace(/\s+/g, '');
    const head = body.slice(0, 40);
    if (!head) return { start: null, end: null };
    let at = compact.indexOf(head, cursor);
    if (at < 0) at = compact.indexOf(head);
    if (at < 0) return { start: null, end: null };
    cursor = at + 1;
    const last = Math.min(compact.length - 1, at + body.length - 1);
    return { start: pageAt(map, kept[at]), end: pageAt(map, kept[last]) };
  });
}
