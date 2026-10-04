/**
 * 笔记正文（HTML）→ 纯文本，后端这一份。规则和前端 components/noteText.ts 的
 * notePreviewText 一致（components/noteText.test.ts 拿同一批正文比对两边的输出）。
 *
 * 正文是 HTML 序列化器写出来的：文字里的 & < > 和不换行空格都存成实体。
 * 只去标签不解码，预览里就直接显示 "&nbsp;"，算长度时一个 &nbsp; 算成 6 个字。
 */

/** &amp; 必须最后解：作者写下的字面 "&lt;" 存成 "&amp;lt;"，先解 &amp; 会被两步解成 "<"。 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 一行纯文本：标签换成空格、解码实体、合并空白。预览和搜索用。 */
export function notePreviewText(html?: string | null): string {
  if (!html) return '';
  const withoutTags = html
    // script/style 的内容不是正文，整段丢掉
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

/**
 * 正文的字符数（含空格）。标签直接去掉、不补空格，和原来 replace(/<[^>]*>/g, '').length
 * 的口径相同，只是一个实体按一个字算。
 */
export function noteTextLength(html?: string | null): number {
  return decodeHtmlEntities((html ?? '').replace(/<[^>]*>/g, '')).length;
}
