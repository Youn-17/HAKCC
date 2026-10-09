import RemixIcon from './RemixIcon';
import type { KbSourceCard } from '../services/apiClient';

/**
 * 笔记 AI 回答下面的来源卡片（课程知识库第 2 步）：回答里标了 [n] 的那几段资料，写明文件名 · 章节 · 页码 · 摘录。
 * 附件能点开原文，PDF 跳到那一页；课程资料学生端看不到原件，只显示摘录。
 * 回答写完了却一个 [n] 都没标，就列出这次检索到的全部资料，标题换成「检索到的课程资料」。
 * 颜色用 AI 面板的变量（assistant.css 的 .assistant-panel），深浅两套跟着面板走。
 *
 * 2026-10-09 起回答写完后由 Jev 核对（api/src/services/kbCitationCheck.ts），卡片带上 check：
 * 引用对得上的标「已核对」，资料里找不到依据、和资料矛盾的标出来；没标引用时只列回答真正用到的资料。
 * 没有核对结果（旧消息、Jev 没开）时照原来的规则显示。
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
      ...(typeof card.check === 'string' && CHECKS.includes(card.check as CardCheck) ? { check: card.check as CardCheck } : {}),
      ...(typeof card.checkP === 'number' ? { checkP: card.checkP } : {}),
    }];
  });
}

type CardCheck = NonNullable<KbSourceCard['check']>;
const CHECKS: readonly CardCheck[] = ['supported', 'contradicted', 'unsupported', 'used', 'unused'];

/** 卡片上的核对标记。对得上的只给一个淡淡的勾，对不上的写明 */
const CHECK_MARK: Partial<Record<CardCheck, { zh: string; en: string; tipZh: string; tipEn: string; className: string; icon: string }>> = {
  supported: {
    zh: '已核对', en: 'Checked', icon: 'check-line',
    tipZh: '核对过：这段资料支持引用它的那句话', tipEn: 'Checked: this passage supports the sentence that cites it',
    className: 'text-[#5d8a7f] dark:text-[#9cc5ba]',
  },
  unsupported: {
    zh: '未找到依据', en: 'Not in source', icon: 'question-line',
    tipZh: '核对过：引用它的那句话在这段资料里找不到依据', tipEn: 'Checked: the sentence citing this passage is not found in it',
    className: 'border border-[#C9A96E]/50 bg-[#C9A96E]/10 px-1.5 text-[#8a6d38] dark:text-[#dcc394]',
  },
  contradicted: {
    zh: '与资料不符', en: 'Contradicts source', icon: 'error-warning-line',
    tipZh: '核对过：引用它的那句话和这段资料说的相反', tipEn: 'Checked: the sentence citing this passage says the opposite',
    className: 'border border-[#C27C7C]/50 bg-[#C27C7C]/10 px-1.5 text-[#9a5555] dark:text-[#e0a5a5]',
  },
};

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

/** 列哪几张、标题写什么。核对过的：没标引用时只列用上了的 */
export function visibleSources(sources: KbSourceCard[], content: string, streaming: boolean): { shown: KbSourceCard[]; kind: 'cited' | 'used' | 'found' } {
  const cited = citedNumbers(content);
  const citedCards = sources.filter(source => cited.has(source.n));
  if (citedCards.length > 0) return { shown: citedCards, kind: 'cited' };
  if (streaming) return { shown: [], kind: 'found' };
  if (sources.some(source => source.check === 'used' || source.check === 'unused')) {
    return { shown: sources.filter(source => source.check === 'used'), kind: 'used' };
  }
  return { shown: sources, kind: 'found' };
}

const HEADING = {
  cited: { zh: '引用来源', en: 'Sources' },
  used: { zh: '回答用到的课程资料', en: 'Course materials used' },
  found: { zh: '检索到的课程资料', en: 'Course materials found' },
} as const;

export default function KbSourceCards({ sources, content, streaming, lang, onOpen }: Props) {
  if (sources.length === 0) return null;
  const zh = lang === 'zh';
  const { shown, kind } = visibleSources(sources, content, streaming);
  if (shown.length === 0) return null;
  const heading = zh ? HEADING[kind].zh : HEADING[kind].en;
  const flagged = shown.filter(source => source.check === 'unsupported' || source.check === 'contradicted').length;

  return (
    <section className="mt-3 border-t border-[var(--assistant-line)] pt-2.5" aria-label={heading}>
      <h4 className="mb-1.5 text-[0.6875rem] font-semibold text-[var(--assistant-muted)]">{heading}</h4>
      {flagged > 0 && (
        <p className="mb-1.5 text-[0.6875rem] leading-5 text-[var(--assistant-muted)]">
          {zh ? `有 ${flagged} 处引用和资料对不上，已在卡片上标出，用之前请对照原文。` : `${flagged} citation(s) do not match the source and are marked below; check the original before relying on them.`}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {shown.map(source => {
          const pages = pagesText(source.pageStart, source.pageEnd, zh);
          const noteId = source.kind === 'attachment' ? source.noteId : null;
          const mark = source.check ? CHECK_MARK[source.check] : undefined;
          const body = (
            <>
              <span className="mt-0.5 inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-md bg-[#000080]/[0.07] px-1 text-[0.6875rem] font-semibold tabular-nums text-[#000080] dark:bg-blue-950/50 dark:text-blue-300">
                {source.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[0.75rem] font-semibold text-[var(--assistant-ink)]">{source.title}</span>
                  {pages && <span className="shrink-0 text-[0.6875rem] text-[var(--assistant-muted)]">{pages}</span>}
                  {mark && (
                    <span
                      title={zh ? mark.tipZh : mark.tipEn}
                      className={`ml-auto inline-flex shrink-0 items-center gap-0.5 self-center rounded-full text-[0.625rem] font-medium ${mark.className}`}
                    >
                      <RemixIcon name={mark.icon} size={11} />
                      {zh ? mark.zh : mark.en}
                    </span>
                  )}
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
