import React from 'react';

/**
 * AI 回复的轻量 Markdown 渲染。
 *
 * 从 NoteEditorModal 抽出来单独成文件，是为了能单测：
 * 图片那条分支曾经整个缺失——![alt](url) 会被拆成一个孤立的 "!" 加一条普通链接，
 * 生成的图永远显示不出来，base64 的更是整串当纯文本吐出来。
 */

export function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function shortenUrl(value: string) {
  try {
    const url = new URL(value);
    const path = `${url.pathname}${url.search}`.replace(/\/$/, '');
    const compactPath = path.length > 30 ? `${path.slice(0, 30)}...` : path;
    return `${url.hostname}${compactPath}`;
  } catch {
    return value.length > 46 ? `${value.slice(0, 43)}...` : value;
  }
}

/** 表格的一行切成单元格。转义的 \| 和行内代码里的 | 不算分隔符。 */
export function splitTableRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') { current += '|'; i++; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** |---|:---:|---:| 这一行：表头和表体的分界，顺带带着每列的对齐方式。 */
export function isTableSeparator(line: string): boolean {
  if (!line.includes('-') || !line.includes('|')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every(cell => /^:?-{1,}:?$/.test(cell.replace(/\s+/g, '')));
}

export type TableAlign = 'left' | 'center' | 'right';

export function tableAlignments(separator: string): TableAlign[] {
  return splitTableRow(separator).map(cell => {
    const c = cell.replace(/\s+/g, '');
    if (c.startsWith(':') && c.endsWith(':')) return 'center';
    if (c.endsWith(':')) return 'right';
    return 'left';
  });
}

/**
 * 从第 start 行起读一张表：表头行 + 分隔行 + 若干数据行。
 * 不是表就返回 null。流式输出时分隔行还没到，表头那一行会先按普通段落显示，
 * 分隔行一到整块变成表格 —— 不提前猜，免得把含竖线的普通句子画成表。
 */
export function readTable(lines: string[], start: number): { header: string[]; align: TableAlign[]; rows: string[][]; next: number } | null {
  const headerLine = lines[start]?.trim() ?? '';
  const separator = lines[start + 1]?.trim() ?? '';
  if (!headerLine.includes('|') || !isTableSeparator(separator)) return null;
  const header = splitTableRow(headerLine);
  const align = tableAlignments(separator);
  if (header.length !== align.length) return null;
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || !line.includes('|')) break;
    const cells = splitTableRow(line);
    // 列数对不上的行补齐或截断，整张表不能因为一行少了个竖线就散掉
    while (cells.length < header.length) cells.push('');
    rows.push(cells.slice(0, header.length));
    i++;
  }
  return { header, align, rows, next: i };
}

export function renderInlineMarkdown(text: string, isMine = false, resolveUrl?: (url: string) => string | null): React.ReactNode[] {
  // 图片必须排在链接之前：否则 ![alt](url) 会被当成一个孤立的 "!" 加一条普通链接，
  // 图永远显示不出来。base64 的 data: 源也要认，generate_image 有时只回 b64。
  const parts = text
    .split(/(!\[[^\]]*\]\((?:https?:\/\/[^\s)]+|\/api\/[^\s)]+|data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+)\)|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/[^\s)]+|\/api\/[^\s)]+)\)|https?:\/\/[^\s<>"']+|<br\s*\/?>)/g)
    .filter(Boolean);
  const resolve = (url: string) => (url.startsWith('/api/') ? (resolveUrl ? resolveUrl(url) : null) : url);
  const linkClass = `break-all font-semibold underline decoration-1 underline-offset-2 ${isMine ? 'text-blue-50' : 'text-[#0f6ca6] dark:text-[#93AAFD]'}`;
  return parts.map((part, index) => {
    if (/^<br\s*\/?>$/.test(part)) return <br key={index} />;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('~~') && part.endsWith('~~')) {
      return <del key={index} className="opacity-70">{part.slice(2, -2)}</del>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className={`rounded px-1.5 py-0.5 text-[0.92em] ${isMine ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-700 dark:bg-gray-700/60 dark:text-gray-100'}`}>{part.slice(1, -1)}</code>;
    }
    const markdownImage = part.match(/^!\[([^\]]*)\]\((.+)\)$/);
    if (markdownImage) {
      const src = resolve(markdownImage[2]);
      if (src && (src.startsWith('data:image/') || markdownImage[2].startsWith('/api/') || isSafeHttpUrl(src))) {
        return (
          <img
            key={index}
            src={src}
            alt={markdownImage[1] || 'AI image'}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="my-2 block max-h-80 w-auto max-w-full rounded-lg border border-slate-200 dark:border-gray-700"
          />
        );
      }
      return <React.Fragment key={index}>{part}</React.Fragment>;
    }
    const markdownLink = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/api\/)[^\s)]+)\)$/);
    if (markdownLink) {
      const href = resolve(markdownLink[2]);
      if (href && (markdownLink[2].startsWith('/api/') || isSafeHttpUrl(href))) {
        return <a key={index} href={href} target="_blank" rel="noreferrer" className={linkClass}>{markdownLink[1]}</a>;
      }
      return <React.Fragment key={index}>{markdownLink[1]}</React.Fragment>;
    }
    if (part.startsWith('http') && isSafeHttpUrl(part)) {
      return <a key={index} href={part} target="_blank" rel="noreferrer" className={linkClass} title={part}>{shortenUrl(part)}</a>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

const ALIGN_CLASS: Record<TableAlign, string> = { left: 'text-left', center: 'text-center', right: 'text-right' };

/**
 * AI 回复的渲染。模型按 Markdown 写，这里负责把它画成能读的版面：
 * 表格、代码块、引用、各级标题、有序/无序列表。
 * 不引整套 Markdown 库：输出直接是 React 节点，模型写的任何 HTML 都只会当文字显示，
 * 不需要再过一遍消毒。
 */
export const MarkdownMessage: React.FC<{
  content: string;
  isMine?: boolean;
  /** 把模型给的 /api/... 相对路径换成能访问的地址；不传则这类路径不渲染成图或链接 */
  resolveUrl?: (url: string) => string | null;
}> = ({ content, isMine = false, resolveUrl }) => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  const inline = (text: string) => renderInlineMarkdown(text, isMine, resolveUrl);
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let quote: string[] = [];

  const flushList = () => {
    if (!list) return;
    const current = list;
    list = null;
    const Tag = current.ordered ? 'ol' : 'ul';
    nodes.push(
      <Tag key={`list-${nodes.length}`} start={current.ordered ? current.start : undefined}
        className={`my-2 space-y-1.5 pl-5 ${current.ordered ? 'list-decimal' : 'list-disc'} marker:text-slate-400`}>
        {current.items.map((item, index) => <li key={index} className="break-words pl-0.5 leading-6">{inline(item)}</li>)}
      </Tag>,
    );
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const items = quote;
    quote = [];
    nodes.push(
      <blockquote key={`quote-${nodes.length}`} className="my-2 border-l-2 border-[#000080]/30 pl-3 text-slate-600 dark:border-[#93AAFD]/40 dark:text-gray-300">
        {items.map((item, index) => <p key={index} className="my-0.5 break-words leading-6">{inline(item)}</p>)}
      </blockquote>,
    );
  };
  const flush = () => { flushList(); flushQuote(); };

  const headingClass = isMine ? 'text-white' : 'text-slate-950 dark:text-gray-50';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // 代码块：原样显示，里面的 | 和 # 都不解析
    if (line.startsWith('```')) {
      flush();
      const language = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i++; }
      nodes.push(
        <div key={`code-${nodes.length}`} className="my-2 overflow-hidden rounded-lg border border-slate-200 dark:border-gray-700">
          {language && <div className="border-b border-slate-200 bg-slate-50 px-3 py-1 text-[0.6875rem] font-medium text-slate-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">{language}</div>}
          <pre className="overflow-x-auto bg-slate-900 p-3 text-[0.8125rem] leading-relaxed text-slate-100 dark:bg-gray-950"><code>{code.join('\n')}</code></pre>
        </div>,
      );
      continue;
    }

    if (!line) { flush(); continue; }

    const table = readTable(lines, i);
    if (table) {
      flush();
      // 窄侧栏里三列平分宽度，每格只放得下四五个字，一张表被拉成一长条。
      // 第一列多半是短标签，不让它折行，把宽度让给后面的列；列太多放不下时在表格自己的框里横向滚动。
      const labelColumn = table.header.length > 1 && table.rows.every(row => row[0].replace(/[*`~]/g, '').length <= 8);
      const cellWidth = (c: number) => (c === 0 && labelColumn ? 'whitespace-nowrap' : 'min-w-[5rem]');
      nodes.push(
        <div key={`table-${nodes.length}`} className="my-3 max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full border-collapse text-left text-[0.8125rem] leading-6 text-slate-800 dark:text-gray-100">
            <thead>
              <tr className="border-b border-slate-200 bg-[#000080]/[0.05] dark:border-gray-700 dark:bg-[#93AAFD]/[0.08]">
                {table.header.map((cell, c) => (
                  <th key={c} className={`${cellWidth(c)} whitespace-nowrap px-2.5 py-2 font-semibold text-slate-900 dark:text-gray-50 ${ALIGN_CLASS[table.align[c]]}`}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r} className="border-b border-slate-100 last:border-b-0 even:bg-slate-50/60 dark:border-gray-800 dark:even:bg-gray-800/40">
                  {row.map((cell, c) => (
                    <td key={c} className={`${cellWidth(c)} break-words px-2.5 py-2 align-top ${c === 0 ? 'font-medium text-slate-900 dark:text-gray-50' : ''} ${ALIGN_CLASS[table.align[c]]}`}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = table.next - 1;
      continue;
    }

    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) { flushList(); quote.push(quoted[1]); continue; }

    const bullet = line.match(/^[-*+•]\s+(.+)$/);
    const numbered = line.match(/^(\d+)(?:[.)]\s+|、\s*)(.+)$/);
    if (bullet || numbered) {
      flushQuote();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? bullet[1] : numbered![2]);
      continue;
    }

    flush();
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const level = heading[1].length;
      const text = inline(heading[2]);
      if (level <= 1) nodes.push(<h2 key={`h-${nodes.length}`} className={`mb-1.5 mt-4 break-words text-base font-bold tracking-tight ${headingClass}`}>{text}</h2>);
      else if (level === 2) nodes.push(<h3 key={`h-${nodes.length}`} className={`mb-1 mt-3 break-words text-[0.9375rem] font-semibold ${headingClass}`}>{text}</h3>);
      else nodes.push(<h4 key={`h-${nodes.length}`} className={`mb-1 mt-3 break-words text-sm font-semibold ${headingClass}`}>{text}</h4>);
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      nodes.push(<hr key={`hr-${nodes.length}`} className="my-3 border-slate-200 dark:border-gray-700" />);
    } else {
      nodes.push(<p key={`p-${nodes.length}`} className="my-1 break-words leading-6">{inline(line)}</p>);
    }
  }
  flush();

  return <div className={`min-w-0 max-w-full whitespace-normal text-sm ${isMine ? 'text-white' : 'text-slate-800 dark:text-gray-100'} [&>*:first-child]:mt-0 [&>*:last-child]:mb-0`}>{nodes}</div>;
};
export default MarkdownMessage;
