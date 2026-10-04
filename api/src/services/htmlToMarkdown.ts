/**
 * HTML → Markdown。只覆盖 mammoth 从 .docx 里吐出来的那个子集，
 * 不是通用转换器 —— 引一个通用库来处理这十几种标签不划算，
 * 而且通用库会带进大量我们用不上的边角行为。
 *
 * 为什么要转：Word 文档要能被编辑。平台的编辑器吃 Markdown（笔记、附件都是），
 * 让 Word 也落到同一种表示上，编辑、目录、批注就自动共用一条路径，
 * 而不是为 Word 再养一套富文本编辑链路。
 *
 * 原 .docx 不动，始终可下载。这里产出的是可编辑的呈现层。
 */

interface Token {
  type: 'open' | 'close' | 'text';
  tag?: string;
  attrs?: Record<string, string>;
  text?: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // & 放最后：先解码它会把 &amp;lt; 变成 <，把文档里字面的转义写法弄丢
    .replace(/&amp;/g, '&');
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][-\w:.]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[(m[1] ?? m[3]).toLowerCase()] = m[2] ?? m[4] ?? '';
  }
  return attrs;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    if (m.index > last) tokens.push({ type: 'text', text: html.slice(last, m.index) });
    const tag = m[1].toLowerCase();
    const isClose = m[0][1] === '/';
    tokens.push(isClose
      ? { type: 'close', tag }
      : { type: 'open', tag, attrs: parseAttrs(m[2] ?? '') });
    last = re.lastIndex;
  }
  if (last < html.length) tokens.push({ type: 'text', text: html.slice(last) });
  return tokens;
}

/** 行内文本里的 markdown 记号要转义，否则原文里的 * 会变成强调。 */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

export function htmlToMarkdown(html: string): string {
  const tokens = tokenize(html ?? '');
  const out: string[] = [];
  let line = '';
  /** 列表嵌套栈：记录每层是有序还是无序，以及有序列表数到几 */
  const listStack: { ordered: boolean; index: number }[] = [];
  let inTableHeaderRow = false;
  let tableCells: string[] = [];
  let tableRowCount = 0;
  let skipDepth = 0;   // script/style 之类整块丢弃
  /** 链接地址在开标签上，关标签取不到，所以压栈存住 */
  const linkStack: string[] = [];

  // 只推有内容的行。段落之间的空行由块级元素闭合时显式补 ——
  // 让 flushLine 顺手推空行的话，列表项之间也会被塞进空行。
  const flushLine = () => {
    const trimmed = line.replace(/[ \t]+$/g, '');
    if (trimmed.trim()) out.push(trimmed);
    line = '';
  };
  const blankLine = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  for (const token of tokens) {
    if (skipDepth > 0) {
      if (token.type === 'close' && (token.tag === 'script' || token.tag === 'style')) skipDepth -= 1;
      continue;
    }

    if (token.type === 'text') {
      const text = decodeEntities(token.text ?? '').replace(/\s+/g, ' ');
      if (!text.trim() && !line) continue;
      line += escapeInline(text);
      continue;
    }

    const tag = token.tag!;
    if (token.type === 'open') {
      switch (tag) {
        case 'script': case 'style': skipDepth += 1; break;
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          flushLine();
          line = `${'#'.repeat(Number(tag[1]))} `;
          break;
        case 'strong': case 'b': line += '**'; break;
        case 'em': case 'i': line += '*'; break;
        case 'code': line += '`'; break;
        case 'br': flushLine(); break;
        case 'hr': flushLine(); out.push('---'); blankLine(); break;
        case 'blockquote': flushLine(); line = '> '; break;
        case 'ul': listStack.push({ ordered: false, index: 0 }); break;
        case 'ol': listStack.push({ ordered: true, index: 0 }); break;
        case 'li': {
          flushLine();
          const level = Math.max(0, listStack.length - 1);
          const current = listStack[listStack.length - 1];
          if (current) {
            current.index += 1;
            line = `${'  '.repeat(level)}${current.ordered ? `${current.index}. ` : '- '}`;
          } else {
            line = '- ';
          }
          break;
        }
        case 'table': flushLine(); tableRowCount = 0; break;
        case 'tr': tableCells = []; inTableHeaderRow = tableRowCount === 0; break;
        case 'th': case 'td': line = ''; break;
        case 'a': {
          const href = token.attrs?.href ?? '';
          linkStack.push(href);
          if (href) line += '[';
          break;
        }
        case 'img': {
          const src = token.attrs?.src ?? '';
          const alt = token.attrs?.alt ?? '';
          // data: URI 的内嵌图片会把 markdown 撑到几 MB，正文里放不下 —— 只留占位
          line += src.startsWith('data:') ? `![${alt || '图片'}]` : `![${alt}](${src})`;
          break;
        }
        case 'p': case 'div': flushLine(); break;
        default: break;
      }
      continue;
    }

    // close
    switch (tag) {
      case 'strong': case 'b': line += '**'; break;
      case 'em': case 'i': line += '*'; break;
      case 'code': line += '`'; break;
      case 'a': {
        const href = linkStack.pop() ?? '';
        if (href) line += `](${href})`;
        break;
      }
      case 'ul': case 'ol': flushLine(); listStack.pop(); if (listStack.length === 0) blankLine(); break;
      case 'li': flushLine(); break;
      case 'th': case 'td': tableCells.push(line.trim()); line = ''; break;
      case 'tr': {
        if (tableCells.length) {
          out.push(`| ${tableCells.join(' | ')} |`);
          if (inTableHeaderRow) out.push(`| ${tableCells.map(() => '---').join(' | ')} |`);
          tableRowCount += 1;
        }
        tableCells = [];
        break;
      }
      case 'table': blankLine(); break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      case 'p': case 'div': case 'blockquote':
        flushLine();
        blankLine();
        break;
      default: break;
    }
  }
  flushLine();

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
