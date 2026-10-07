import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Language } from '../../types';
import { courseSettings, type KbOverview, type KbSearchTestResult } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';
import { pagesText } from '../KbSourceCards';

/**
 * 课程资料页上的「AI 知识库」（课程知识库第 3 步）：知识库概况、画布附件整门课的开关和清单、检索测试。
 * 每份资料自己的「进入知识库」开关和「重新解析」在资料卡片上（CourseMaterials.tsx）。
 */

/** 开关：整行可点，点击区域不小于 44px */
export function KbSwitch({ checked, onChange, disabled, label }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-1 text-xs font-medium text-stone-600 transition-colors hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-300 dark:hover:text-stone-100"
    >
      <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${checked ? 'bg-[#000080] dark:bg-[#93AAFD]' : 'bg-stone-300 dark:bg-stone-700'}`}>
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

const T = {
  zh: {
    title: 'AI 知识库',
    loadFailed: '知识库概况没取到：',
    searchable: (n: number) => `AI 现在检索得到 ${n} 段`,
    materials: (on: number, total: number) => `课程资料 ${total} 份，${on} 份开着`,
    attachmentsCount: (n: number, on: boolean) => (on ? `画布附件 ${n} 份` : `画布附件 ${n} 份（已关闭）`),
    vectors: (n: number) => `其中 ${n} 段的向量还在后台补，补好之前只能按关键词找到`,
    retrievals: (days: number, total: number) => `近 ${days} 天被检索 ${total} 次`,
    sources: { note_ai: '笔记 AI', workspace_ai: '空间助手', agent_tool: 'AI 调工具' } as Record<string, string>,
    attachmentsSwitch: '知识空间里上传的附件也进知识库',
    attachmentsHint: '学生在知识空间里上传的附件，只有进得去那个空间的人检索得到。关掉后，所有空间的附件都不进 AI 检索；文件本身不受影响。',
    attachmentsList: (n: number) => `附件清单（${n} 份）`,
    noAttachments: '知识空间里还没有进入知识库的附件。',
    passages: (n: number) => `${n} 段`,
    pageCount: (n: number) => `共 ${n} 页`,
    status: { parsing: '解析中', pending: '排队中', failed: '出错' } as Record<string, string>,
    switchFailed: '开关没改成：',
    testTitle: '检索测试',
    testPlaceholder: '输入一个学生可能问的问题，看 AI 会拿到哪几段',
    testButton: '试一下',
    testHint: '用你的身份检索：所有小组空间的附件都算在内；学生只检索得到自己进得去的空间。不记进检索记录。',
    testFound: (n: number, ms: number) => `AI 会拿到这 ${n} 段（${(ms / 1000).toFixed(1)} 秒）`,
    testNone: '没有一段够相关。AI 会如实说课程资料里没有相关内容，不会硬套。',
    testEmpty: '没有找到。',
    keywordOnly: '这次语义检索没连上，下面是按关键词找到的，可能不相关。',
    relevance: (r: number) => `相关度 ${r.toFixed(2)}`,
    material: '课程资料',
    testFailed: '检索没成功：',
  },
  en: {
    title: 'AI knowledge base',
    loadFailed: 'Could not load the knowledge base overview: ',
    searchable: (n: number) => `The AI can search ${n} passages now`,
    materials: (on: number, total: number) => `${total} course materials, ${on} switched on`,
    attachmentsCount: (n: number, on: boolean) => (on ? `${n} canvas attachments` : `${n} canvas attachments (off)`),
    vectors: (n: number) => `${n} passages are still being embedded and can only be found by keyword until then`,
    retrievals: (days: number, total: number) => `searched ${total} times in the last ${days} days`,
    sources: { note_ai: 'note AI', workspace_ai: 'space assistant', agent_tool: 'AI tool calls' } as Record<string, string>,
    attachmentsSwitch: 'Include attachments uploaded in knowledge spaces',
    attachmentsHint: 'Attachments students upload in a knowledge space can only be found by people who can enter that space. Switching this off takes every space\'s attachments out of AI search; the files themselves are not affected.',
    attachmentsList: (n: number) => `Attachments (${n})`,
    noAttachments: 'No attachments from knowledge spaces are in the knowledge base yet.',
    passages: (n: number) => `${n} passages`,
    pageCount: (n: number) => `${n} pages`,
    status: { parsing: 'parsing', pending: 'queued', failed: 'failed' } as Record<string, string>,
    switchFailed: 'Could not change the switch: ',
    testTitle: 'Search test',
    testPlaceholder: 'Type a question a student might ask to see which passages the AI gets',
    testButton: 'Try it',
    testHint: 'Searches as you: attachments in every group space count; students only search the spaces they can enter. Not recorded in the search log.',
    testFound: (n: number, ms: number) => `The AI gets these ${n} passages (${(ms / 1000).toFixed(1)} s)`,
    testNone: 'No passage is relevant enough. The AI will say the course materials do not cover this instead of forcing a match.',
    testEmpty: 'Nothing found.',
    keywordOnly: 'Semantic search was unavailable this time; these were found by keyword and may be unrelated.',
    relevance: (r: number) => `relevance ${r.toFixed(2)}`,
    material: 'Course material',
    testFailed: 'The search failed: ',
  },
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Props {
  courseId: string;
  lang: Language;
  /** 资料列表一变（开关、重新解析、上传、删除）就重取概况 */
  refreshKey: string;
}

export default function CourseKnowledgeBase({ courseId, lang, refreshKey }: Props) {
  const zh = lang === 'zh';
  const t = zh ? T.zh : T.en;
  const [overview, setOverview] = useState<KbOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingAttachments, setSavingAttachments] = useState(false);
  const [query, setQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<KbSearchTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await courseSettings.kbOverview(courseId));
      setError(null);
    } catch (err) {
      setError(`${t.loadFailed}${message(err)}`);
    }
  }, [courseId, t.loadFailed]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const toggleAttachments = async (next: boolean) => {
    if (!overview) return;
    const previous = overview;
    setOverview({ ...overview, includeAttachments: next });
    setSavingAttachments(true);
    try {
      await courseSettings.setKbAttachments(courseId, next);
      await load();
    } catch (err) {
      setOverview(previous);
      setError(`${t.switchFailed}${message(err)}`);
    } finally {
      setSavingAttachments(false);
    }
  };

  const runTest = async (event: React.FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q || testing) return;
    setTesting(true);
    setTestError(null);
    try {
      setTest(await courseSettings.kbSearchTest(courseId, q));
    } catch (err) {
      setTest(null);
      setTestError(`${t.testFailed}${message(err)}`);
    } finally {
      setTesting(false);
    }
  };

  const pendingVectors = overview ? overview.searchable.chunks - overview.searchable.embedded : 0;
  const bySource = overview
    ? Object.entries(overview.retrievals.bySource).filter(([, n]) => n > 0).map(([source, n]) => `${t.sources[source] ?? source} ${n}`)
    : [];

  return (
    <section className="course-settings-card rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950" aria-labelledby="kb-panel-title">
      <h4 id="kb-panel-title" className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
        <RemixIcon name="book-2-line" size={16} className="text-[#000080] dark:text-[#93AAFD]" />
        {t.title}
      </h4>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {overview ? (
        <div className="mt-2 space-y-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
          <p>
            <span className="font-medium text-stone-700 dark:text-stone-200">{t.searchable(overview.searchable.chunks)}</span>
            {' · '}{t.materials(overview.materials.enabled, overview.materials.total)}
            {' · '}{t.attachmentsCount(overview.attachments.items.length, overview.includeAttachments)}
          </p>
          {pendingVectors > 0 && <p className="text-amber-700 dark:text-amber-400">{t.vectors(pendingVectors)}</p>}
          <p>
            {t.retrievals(overview.retrievals.days, overview.retrievals.total)}
            {bySource.length > 0 && `（${bySource.join(' · ')}）`}
          </p>
        </div>
      ) : !error && (
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-3 w-3/4 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
        </div>
      )}

      {overview && (
        <div className="mt-3 border-t border-stone-100 pt-2 dark:border-stone-800">
          <KbSwitch
            checked={overview.includeAttachments}
            onChange={next => void toggleAttachments(next)}
            disabled={savingAttachments}
            label={t.attachmentsSwitch}
          />
          <p className="text-xs leading-relaxed text-stone-400 dark:text-stone-500">{t.attachmentsHint}</p>
          <details className="group mt-2 text-xs">
            <summary className="flex min-h-[32px] cursor-pointer select-none list-none items-center gap-1 font-medium text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100 [&::-webkit-details-marker]:hidden">
              <RemixIcon name="arrow-right-s-line" size={14} className="transition-transform duration-200 group-open:rotate-90" />
              {t.attachmentsList(overview.attachments.items.length)}
            </summary>
            {overview.attachments.items.length === 0 ? (
              <p className="mt-1 text-stone-400 dark:text-stone-500">{t.noAttachments}</p>
            ) : (
              <ul className={`mt-1 divide-y divide-stone-100 dark:divide-stone-800 ${overview.includeAttachments ? '' : 'opacity-60'}`}>
                {overview.attachments.items.map(item => (
                  <li key={item.noteId} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                    <span className="min-w-0 max-w-full truncate font-medium text-stone-700 dark:text-stone-200">{item.title}</span>
                    {item.spaceName && <span className="text-stone-400 dark:text-stone-500">{item.spaceName}</span>}
                    <span className="text-stone-400 dark:text-stone-500">
                      {item.status === 'ready' ? t.passages(item.chunks) : (t.status[item.status] ?? item.status)}
                      {item.pages ? ` · ${t.pageCount(item.pages)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      )}

      <form onSubmit={event => void runTest(event)} className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
        <label htmlFor="kb-search-test" className="text-xs font-semibold text-stone-700 dark:text-stone-200">{t.testTitle}</label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="kb-search-test"
            type="text"
            value={query}
            maxLength={500}
            onChange={event => setQuery(event.target.value)}
            placeholder={t.testPlaceholder}
            className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none transition-colors focus:border-[#000080]/40 focus:ring-2 focus:ring-[#000080]/15 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-[#93AAFD]/50"
          />
          <button
            type="submit"
            disabled={testing || !query.trim()}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-[#000080] px-4 text-sm font-medium text-white transition-colors hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-50"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <RemixIcon name="search-line" size={14} />}
            {t.testButton}
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-stone-400 dark:text-stone-500">{t.testHint}</p>
        {testError && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{testError}</p>}
        {test && (
          <div className="mt-3" aria-live="polite">
            <p className="text-xs font-medium text-stone-700 dark:text-stone-200">
              {test.hits.length > 0 ? t.testFound(test.hits.length, test.ms) : test.reranked ? t.testNone : t.testEmpty}
            </p>
            {!test.semantic && test.hits.length > 0 && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{t.keywordOnly}</p>}
            <ol className="mt-2 space-y-1.5">
              {test.hits.map(hit => {
                const pages = pagesText(hit.pageStart, hit.pageEnd, zh);
                return (
                  <li key={hit.n} className="flex gap-2.5 rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/60">
                    <span className="mt-0.5 inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-md bg-[#000080]/[0.07] px-1 text-[0.6875rem] font-semibold tabular-nums text-[#000080] dark:bg-blue-950/50 dark:text-blue-300">{hit.n}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="min-w-0 max-w-full truncate text-xs font-semibold text-stone-800 dark:text-stone-100">{hit.title}</span>
                        {pages && <span className="text-[0.6875rem] text-stone-500 dark:text-stone-400">{pages}</span>}
                        {hit.kind === 'material' && <span className="text-[0.6875rem] text-stone-400 dark:text-stone-500">{t.material}</span>}
                        {hit.relevance !== null && <span className="text-[0.6875rem] tabular-nums text-stone-400 dark:text-stone-500">{t.relevance(hit.relevance)}</span>}
                      </span>
                      {hit.section && <span className="block truncate text-[0.6875rem] text-stone-500 dark:text-stone-400">{hit.section}</span>}
                      <span className="mt-0.5 line-clamp-3 text-[0.6875rem] leading-5 text-stone-600 dark:text-stone-400">{hit.excerpt}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </form>
    </section>
  );
}
