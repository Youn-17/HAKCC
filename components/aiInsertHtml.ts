import { isSafeHttpUrl, readTable, shortenUrl } from './chatMarkdown';

/**
 * 把 AI 的内容放进笔记时用的 HTML（2026-10-11 从 NoteEditorModal 抽出来：知识空间智能体的「导入笔记」也要用）。
 * 笔记页「添加到 Note」和导入对话框生成的都是同一种块：data-ai-source="genai"，内容分层把它算成学生插入的 AI 内容。
 * 网页导入进来是一张卡片（data-ai-artifact），点「打开网页」在隔离窗口里看（笔记页里有点击处理）。
 */

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** 课程没配 GenAI 支架时的采纳归类；配了支架就以支架为准，不重复问 */
export const INSERT_TAGS = [
  { key: 'new_angle', zh: '给了我没想到的角度', en: 'A new angle' },
  { key: 'clearer', zh: '帮我说得更清楚', en: 'Says it more clearly' },
  { key: 'evidence', zh: '提供了证据或例子', en: 'Evidence or example' },
  { key: 'to_verify', zh: '先放着，待我查证', en: 'Keep for now, verify later' },
] as const;

export type InsertTagKey = typeof INSERT_TAGS[number]['key'];

export function renderInlineMarkdownToHtml(value: string) {
  return value
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"']+)/g)
    .filter(Boolean)
    .map(part => {
      if (part.startsWith('**') && part.endsWith('**')) return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
      if (part.startsWith('`') && part.endsWith('`')) return `<code style="background:#f1f5f9;color:#334155;border-radius:4px;padding:1px 5px;font-size:.92em;">${escapeHtml(part.slice(1, -1))}</code>`;
      const markdownLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (markdownLink && isSafeHttpUrl(markdownLink[2])) {
        return `<a href="${escapeHtml(markdownLink[2])}" target="_blank" rel="noreferrer" style="color:#0f6ca6;text-decoration:underline;word-break:break-word;">${escapeHtml(markdownLink[1])}</a>`;
      }
      if (part.startsWith('http') && isSafeHttpUrl(part)) {
        return `<a href="${escapeHtml(part)}" target="_blank" rel="noreferrer" style="color:#0f6ca6;text-decoration:underline;word-break:break-word;">${escapeHtml(shortenUrl(part))}</a>`;
      }
      return escapeHtml(part);
    })
    .join('');
}

export function renderMarkdownToHtml(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul style="margin:8px 0 8px 20px;padding:0;">${listItems.map(item => `<li style="margin:4px 0;line-height:1.65;">${renderInlineMarkdownToHtml(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) {
      flushList();
      continue;
    }
    // 表格：学生把 AI 的回答采纳进笔记时，表格要跟着进去，不能退化成一行行竖线
    const table = readTable(lines, index);
    if (table) {
      flushList();
      const cell = 'border:1px solid #e2e8f0;padding:6px 10px;vertical-align:top;line-height:1.6;';
      html.push(
        `<table style="border-collapse:collapse;width:100%;margin:10px 0;font-size:.92em;"><thead><tr>${table.header
          .map((h, c) => `<th style="${cell}background:#f1f5f9;font-weight:700;text-align:${table.align[c]};">${renderInlineMarkdownToHtml(h)}</th>`).join('')}</tr></thead><tbody>${table.rows
          .map(row => `<tr>${row.map((d, c) => `<td style="${cell}text-align:${table.align[c]};">${renderInlineMarkdownToHtml(d)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      index = table.next - 1;
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      listItems.push((bullet ?? numbered)?.[1] ?? line);
      continue;
    }
    flushList();
    if (line.startsWith('### ')) {
      html.push(`<h4 style="margin:10px 0 4px;font-size:14px;line-height:1.5;font-weight:700;color:#0f172a;">${renderInlineMarkdownToHtml(line.slice(4))}</h4>`);
    } else if (line.startsWith('## ')) {
      html.push(`<h3 style="margin:12px 0 6px;font-size:15px;line-height:1.5;font-weight:700;color:#0f172a;">${renderInlineMarkdownToHtml(line.slice(3))}</h3>`);
    } else if (line === '---') {
      html.push('<hr style="border:0;border-top:1px solid #cbd5e1;margin:12px 0;" />');
    } else {
      html.push(`<p style="margin:6px 0;line-height:1.75;">${renderInlineMarkdownToHtml(line)}</p>`);
    }
  }
  flushList();
  return html.join('');
}

/** 知识空间智能体的一段回答导入笔记：和笔记页「添加到 Note」同一种块，多记一个来源（data-import-surface） */
export function genaiImportHtml(params: {
  text: string;
  providerId: string;
  providerLabel: string;
  model: string;
  sourceMessageId?: string | null;
  tagLabel?: string;
  lang: 'zh' | 'en';
}): string {
  const zh = params.lang === 'zh';
  const reason = params.tagLabel
    ? `<div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:12px;line-height:1.6;color:#475569;"><strong style="color:#334155;">${zh ? '这段内容对我的帮助' : 'How this helps me'}:</strong> ${escapeHtml(params.tagLabel)}</div>`
    : '';
  return `<div data-ai-source="genai" data-scaffold-adopted="" data-source-message-id="${escapeHtml(params.sourceMessageId ?? '')}" data-feedback-id="" data-provider-id="${escapeHtml(params.providerId)}" data-model="${escapeHtml(params.model)}" data-import-surface="workspace" style="margin:10px 0;border:1px solid #cbd5e1;border-left:4px solid #22577a;background:#f8fafc;color:#1e293b;padding:10px 12px;border-radius:8px;"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#475569;"><span style="display:inline-flex;height:18px;align-items:center;border-radius:999px;background:#dbeafe;color:#1e3a8a;padding:0 8px;">${zh ? 'AI 来源' : 'AI source'}</span><span>${escapeHtml(params.providerLabel)} · ${escapeHtml(params.model || 'model')}</span></div><div style="font-size:14px;line-height:1.75;">${renderMarkdownToHtml(params.text)}</div>${reason}</div><p><br></p>`;
}

/** 网页导入笔记：一张卡片，整块不可编辑；「打开网页」由笔记页的点击处理打开隔离窗口 */
export function artifactEmbedHtml(params: { artifactId: string; title: string; version: number; tagLabel?: string; lang: 'zh' | 'en' }): string {
  const zh = params.lang === 'zh';
  const id = escapeHtml(params.artifactId);
  const reason = params.tagLabel
    ? `<div style="margin-top:8px;font-size:12px;line-height:1.6;color:#475569;"><strong style="color:#334155;">${zh ? '这段内容对我的帮助' : 'How this helps me'}:</strong> ${escapeHtml(params.tagLabel)}</div>`
    : '';
  return `<div data-ai-source="genai" data-ai-artifact="${id}" data-ai-artifact-version="${params.version}" data-import-surface="workspace" contenteditable="false" style="margin:10px 0;border:1px solid #cbd5e1;border-left:4px solid #1e3a8a;background:#f8fafc;color:#1e293b;padding:12px 14px;border-radius:10px;"><div style="margin-bottom:6px;font-size:10px;font-weight:800;letter-spacing:.12em;color:#475569;"><span style="display:inline-flex;height:18px;align-items:center;border-radius:999px;background:#dbeafe;color:#1e3a8a;padding:0 8px;">${zh ? 'AI 做的网页' : 'AI-built page'}</span></div><div style="font-size:15px;font-weight:700;line-height:1.5;">${escapeHtml(params.title)}</div><div style="margin-top:8px;"><span data-open-artifact="${id}" role="button" tabindex="0" style="display:inline-block;padding:5px 14px;border-radius:8px;background:#1e3a8a;color:#ffffff;font-size:12px;font-weight:700;cursor:pointer;">${zh ? '打开网页' : 'Open page'}</span></div>${reason}</div><p><br></p>`;
}
