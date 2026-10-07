import RemixIcon from './RemixIcon';
import type { KbSourceCard } from '../services/apiClient';

/**
 * 笔记 AI 回答下面的来源卡片（课程知识库第 2 步）：回答里标了 [n] 的那几段资料，写明文件名 · 章节 · 页码 · 摘录。
 * 附件能点开原文，PDF 跳到那一页；课程资料学生端看不到原件，只显示摘录。
 * 回答写完了却一个 [n] 都没标，就列出这次检索到的全部资料，标题换成「检索到的课程资料」。
 * 颜色用 AI 面板的变量（assistant.css 的 .assistant-panel），深浅两套跟着面板走。
 */

/** 回答里出现过的 [n] */
export function citedNumbers(content: string): Set<number> {
  const out = new Set<number>();
  for (const match of content.matchAll(/\[(\d{1,2})\]/g)) out.add(Number(match[1]));
  return out;
}

const intOrNull = (value: unknown) => (Number.isInteger(value) ? (value as number) : null);
const textOrNull = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

/** ai_metadata.kb_sources 里存的卡片；字段不全的丢掉 */
export function parseKbSources(raw: unknown): KbSourceCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): KbSourceCard[] => {
    if (!item || typeof item !== 'object') return [];
    const card = item as Record<string, unknown>;
    if (!Number.isInteger(card.n) || typeof card.title !== 'string') return [];
    return [{
      n: card.n as number,
      title: card.title,
      section: textOrNull(card.section),
      pageStart: intOrNull(card.pageStart),
      pageEnd: intOrNull(card.pageEnd),
      excerpt: typeof card.excerpt === 'string' ? card.excerpt : '',
      kind: card.kind === 'material' ? 'material' : 'attachment',
      noteId: textOrNull(card.noteId),
      relevance: typeof card.relevance === 'number' ? card.relevance : null,
    }];
  });
}

export function pagesText(start: number | null, end: number | null, zh: boolean): string | null {
  if (start == null) return null;
  const range = end == null || end === start ? `${start}` : `${start}–${end}`;
  if (zh) return `第 ${range} 页`;
  return end == null || end === start ? `p. ${range}` : `pp. ${range}`;
}

interface Props {
  sources: KbSourceCard[];
  /** 回答正文，用来找 [n] */
  content: string;
  /** 回答还在写：只显示已经标出来的 */
  streaming: boolean;
  lang: 'zh' | 'en';
  /** 打开附件原文；不给（手机端）卡片就不能点 */
  onOpen?: (noteId: string, page: number | null) => void;
}

export default function KbSourceCards({ sources, content, streaming, lang, onOpen }: Props) {
  if (sources.length === 0) return null;
  const zh = lang === 'zh';
  const cited = citedNumbers(content);
  const citedCards = sources.filter(source => cited.has(source.n));
  const shown = citedCards.length > 0 ? citedCards : streaming ? [] : sources;
  if (shown.length === 0) return null;
  const heading = citedCards.length > 0
    ? (zh ? '引用来源' : 'Sources')
    : (zh ? '检索到的课程资料' : 'Course materials found');

  return (
    <section className="mt-3 border-t border-[var(--assistant-line)] pt-2.5" aria-label={heading}>
      <h4 className="mb-1.5 text-[0.6875rem] font-semibold text-[var(--assistant-muted)]">{heading}</h4>
      <ul className="flex flex-col gap-1.5">
        {shown.map(source => {
          const pages = pagesText(source.pageStart, source.pageEnd, zh);
          const noteId = source.kind === 'attachment' ? source.noteId : null;
          const body = (
            <>
              <span className="mt-0.5 inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-md bg-[#000080]/[0.07] px-1 text-[0.6875rem] font-semibold tabular-nums text-[#000080] dark:bg-blue-950/50 dark:text-blue-300">
                {source.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[0.75rem] font-semibold text-[var(--assistant-ink)]">{source.title}</span>
                  {pages && <span className="shrink-0 text-[0.6875rem] text-[var(--assistant-muted)]">{pages}</span>}
                </span>
                {source.section && (
                  <span className="block truncate text-[0.6875rem] text-[var(--assistant-muted)]">{source.section}</span>
                )}
                {source.excerpt && (
                  <span className="mt-0.5 line-clamp-2 text-[0.6875rem] leading-5 text-[var(--assistant-muted)]">{source.excerpt}</span>
                )}
              </span>
            </>
          );
          return (
            <li key={source.n}>
              {noteId && onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(noteId, source.pageStart)}
                  title={pages ? (zh ? `打开原文，跳到${pages}` : `Open the file at ${pages}`) : (zh ? '打开原文' : 'Open the file')}
                  className="group flex min-h-[44px] w-full items-start gap-2.5 rounded-xl border border-[var(--assistant-line)] bg-[var(--assistant-paper)] px-3 py-2 text-left transition-all duration-200 hover:border-[#000080]/30 hover:bg-[var(--assistant-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 active:scale-[0.99] dark:hover:border-blue-400/40"
                >
                  {body}
                  <RemixIcon name="arrow-right-up-line" size={14} className="mt-0.5 shrink-0 text-[var(--assistant-muted)] transition-colors group-hover:text-[#000080] dark:group-hover:text-blue-300" />
                </button>
              ) : (
                <div className="flex min-h-[44px] items-start gap-2.5 rounded-xl border border-[var(--assistant-line)] bg-[var(--assistant-wash)] px-3 py-2">
                  {body}
                  {source.kind === 'material' && (
                    <span className="mt-0.5 shrink-0 rounded-full border border-[var(--assistant-line)] px-1.5 text-[0.625rem] text-[var(--assistant-muted)]">
                      {zh ? '课程资料' : 'Course material'}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
