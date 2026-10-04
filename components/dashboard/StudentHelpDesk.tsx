import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Send, ChevronDown, ChevronRight } from 'lucide-react';
import RemixIcon from '../RemixIcon';
import { support, type SupportQuestion } from '../../services/apiClient';

/**
 * 教师端：学生求助。
 *
 * 这不是客服工单列表。学生卡在哪里本身是教学信号 —— 如果一周里
 * 七个人都在问「贡献到底是什么意思」，那是设计问题，不是七次提问。
 * 所以默认按「还等着回复的」排前面，同时把重复问题聚到一起看。
 */

interface Props {
  courseId: string;
  lang: 'zh' | 'en';
  courses?: Array<{ id: string; title?: string; name?: string }>;
}

type Filter = 'open' | 'all';

/** 语料价值在处境里，但教师不需要看整坨 JSON —— 挑几项人看得懂的。 */
function readableContext(ctx: Record<string, unknown>, zh: boolean): Array<{ k: string; v: string }> {
  const rows: Array<{ k: string; v: string }> = [];
  const push = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return;
    rows.push({ k, v: String(v) });
  };
  push(zh ? '页面' : 'Page', ctx.path);
  const panel = ctx.panel as { activeTab?: string; model?: string } | undefined;
  push(zh ? '面板' : 'Panel', panel?.activeTab);
  push(zh ? '模型' : 'Model', panel?.model);
  const vp = ctx.viewport as { w?: number; h?: number } | undefined;
  if (vp?.w) push(zh ? '窗口' : 'Viewport', `${vp.w}×${vp.h}`);
  push(zh ? '空间' : 'Space', ctx.spaceId);
  push(zh ? '版本' : 'Version', ctx.clientVersion);
  return rows;
}

export interface RecentError { at: string; kind: string; detail: string }

/**
 * 学生提问那一刻前端最近的几次报错（services/clientDiagnostics 记的，最多 5 条）。
 * 学生说「点了没反应」时，答案往往就在这里。研究导出里早就有这一列，
 * 教师在这里却看不到。处境是客户端送来的 JSON，逐项校验形状再用。
 */
export function readRecentErrors(ctx: Record<string, unknown> | null | undefined): RecentError[] {
  const raw = ctx?.recentFailures;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map(f => ({
      at: typeof f.at === 'string' ? f.at : '',
      kind: typeof f.kind === 'string' ? f.kind : '',
      detail: typeof f.detail === 'string' ? f.detail : '',
    }))
    .filter(f => f.detail);
}

/** 报错离提问多久：「提问前 3 分钟」比一个绝对时间好读 */
function beforeAsked(at: string, askedAt: string, zh: boolean): string {
  const diff = Date.parse(askedAt) - Date.parse(at);
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.round(diff / 60_000);
  if (minutes <= 0) return zh ? '提问时' : 'when asked';
  if (minutes < 60) return zh ? `提问前 ${minutes} 分钟` : `${minutes} min before`;
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const StudentHelpDesk: React.FC<Props> = ({ courseId: initialCourseId, lang, courses = [] }) => {
  const zh = lang === 'zh';
  const [activeCourseId, setActiveCourseId] = useState(initialCourseId);
  const courseId = activeCourseId || initialCourseId;
  const [items, setItems] = useState<SupportQuestion[]>([]);
  const [counts, setCounts] = useState<{ total: number; waiting: number; answered: number; solvedByAi: number } | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const t = zh ? {
    title: '学生求助',
    sub: '学生在平台上遇到的问题。AI 先答过一轮，答不了的会转到这里。',
    waiting: '等你回复',
    solvedByAi: 'AI 已解决',
    answered: '你已回复',
    total: '累计',
    filterOpen: '待回复',
    filterAll: '全部',
    empty: '没有待回复的求助。',
    emptyAll: '这门课还没有学生提过问题。',
    aiSaid: 'AI 当时的回答',
    studentAdded: '学生补充',
    yourAnswer: '你的回复',
    placeholder: '直接给出做法。学生问的是「怎么用」，不是「怎么想」。',
    send: '回复',
    sending: '发送中…',
    context: '提问时的处境',
    recentErrors: '提问前最近的报错',
    errorCount: (n: number) => `${n} 条报错`,
    errorKind: { api: '接口', script: '脚本', promise: '异步' } as Record<string, string>,
    reload: '刷新',
    signal: '同类问题多，往往说明是设计问题，不是提问问题。',
  } : {
    title: 'Student Help',
    sub: 'Problems students hit on the platform. The AI answers first; what it cannot solve lands here.',
    waiting: 'Waiting on you',
    solvedByAi: 'Solved by AI',
    answered: 'You replied',
    total: 'Total',
    filterOpen: 'Waiting',
    filterAll: 'All',
    empty: 'Nothing waiting for a reply.',
    emptyAll: 'No questions in this course yet.',
    aiSaid: 'What the AI said',
    studentAdded: 'Student added',
    yourAnswer: 'Your reply',
    placeholder: 'Give the concrete steps. They asked how to use it, not how to think about it.',
    send: 'Reply',
    sending: 'Sending…',
    context: 'Context when asked',
    recentErrors: 'Errors just before asking',
    errorCount: (n: number) => `${n} error${n === 1 ? '' : 's'}`,
    errorKind: { api: 'API', script: 'Script', promise: 'Promise' } as Record<string, string>,
    reload: 'Refresh',
    signal: 'Many similar questions usually points at a design problem, not at the students.',
  };

  const load = useCallback(async () => {
    if (!courseId) { setItems([]); setCounts(null); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await support.list(courseId, filter === 'open' ? 'open' : undefined);
      setItems(res.questions);
      setCounts(res.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [courseId, filter]);

  useEffect(() => { void load(); }, [load]);

  /** 相同问题重复出现是最有用的信号，聚一下让它显出来。 */
  const repeated = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const q of items) {
      const key = q.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 40);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return buckets;
  }, [items]);

  const answer = async (id: string) => {
    const text = (drafts[id] ?? '').trim();
    if (!text) return;
    setSending(id);
    try {
      const { question } = await support.answer(id, text);
      setItems(prev => (filter === 'open'
        ? prev.filter(q => q.id !== id)
        : prev.map(q => (q.id === id ? question : q))));
      setDrafts(prev => { const next = { ...prev }; delete next[id]; return next; });
      setCounts(prev => prev ? { ...prev, waiting: Math.max(0, prev.waiting - 1), answered: prev.answered + 1 } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(null);
    }
  };

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{t.title}</h2>
        <p className="max-w-[65ch] text-sm leading-relaxed text-gray-500 dark:text-gray-400">{t.sub}</p>
      </header>

      {counts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: t.waiting, value: counts.waiting, accent: true },
            { label: t.solvedByAi, value: counts.solvedByAi },
            { label: t.answered, value: counts.answered },
            { label: t.total, value: counts.total },
          ].map(card => (
            <div key={card.label}
              className={`rounded-xl border p-4 ${card.accent && card.value > 0
                ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
                : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`}>
              <p className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{card.value}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {courses.length > 1 && (
          <select
            value={courseId}
            onChange={e => setActiveCourseId(e.target.value)}
            className="h-8 max-w-[16rem] rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 outline-none transition-colors hover:border-gray-300 focus:border-[#000080] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            {courses.map(c => (
              <option key={c.id} value={c.id}>{c.title ?? c.name ?? c.id}</option>
            ))}
          </select>
        )}
        {(['open', 'all'] as Filter[]).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === f
                ? 'bg-[#000080] text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}>
            {f === 'open' ? t.filterOpen : t.filterAll}
          </button>
        ))}
        <button type="button" onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          <RemixIcon name="refresh-line" size={12} />{t.reload}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={18} className="animate-spin text-gray-300" /></div>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">{filter === 'open' ? t.empty : t.emptyAll}</p>
      ) : (
        <ul className="space-y-4">
          {items.map(q => {
            const key = q.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 40);
            const dup = repeated.get(key) ?? 1;
            const isOpen = expanded.has(q.id);
            const ctxRows = readableContext(q.context ?? {}, zh);
            const errors = readRecentErrors(q.context);
            return (
              <li key={q.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{q.userName ?? '—'}</span>
                  <span className="text-[0.6875rem] text-gray-400">{new Date(q.createdAt).toLocaleString()}</span>
                  {dup > 1 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.625rem] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                      title={t.signal}>
                      ×{dup}
                    </span>
                  )}
                  {q.status === 'escalated' && (
                    <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[0.625rem] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      {t.waiting}
                    </span>
                  )}
                  {q.status === 'resolved' && (
                    <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[0.625rem] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      {t.solvedByAi}
                    </span>
                  )}
                </div>

                <p className="mt-2 text-[0.9375rem] font-semibold leading-7 text-gray-900 dark:text-gray-100">{q.question}</p>

                {/* 截图。学生说不清「哪个面板」，一张图就说清了 —— 所以放在
                    问题正下方，不藏在折叠区里。 */}
                {q.attachments?.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {q.attachments.map(a => (
                      <a key={a.file_url} href={a.file_url} target="_blank" rel="noopener noreferrer"
                        title={a.file_name}>
                        <img src={a.file_url} alt={a.file_name}
                          className="h-24 w-24 rounded-lg border border-gray-200 object-cover transition-opacity hover:opacity-80 dark:border-gray-700" />
                      </a>
                    ))}
                  </div>
                )}

                {q.escalationNote && (
                  <p className="mt-2 border-l-2 border-amber-300 pl-3 text-[0.8125rem] leading-6 text-gray-600 dark:text-gray-300">
                    <span className="font-semibold">{t.studentAdded}：</span>{q.escalationNote}
                  </p>
                )}

                <button type="button" onClick={() => toggle(q.id)}
                  className="mt-3 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300">
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {t.aiSaid} · {t.context}
                  {errors.length > 0 && (
                    <span className="text-rose-500 dark:text-rose-400">· {t.errorCount(errors.length)}</span>
                  )}
                </button>

                {isOpen && (
                  <div className="mt-2 space-y-2">
                    {q.aiAnswer && (
                      <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
                        <p className="whitespace-pre-wrap text-[0.75rem] leading-6 text-gray-600 dark:text-gray-300">{q.aiAnswer}</p>
                      </div>
                    )}
                    {ctxRows.length > 0 && (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-gray-50 p-3 text-[0.6875rem] dark:bg-gray-800/60">
                        {ctxRows.map(r => (
                          <div key={r.k} className="flex gap-1.5">
                            <dt className="shrink-0 text-gray-400">{r.k}</dt>
                            <dd className="truncate text-gray-600 dark:text-gray-300" title={r.v}>{r.v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {errors.length > 0 && (
                      <div className="rounded-lg border border-rose-100 bg-rose-50/60 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
                        <p className="mb-1.5 text-[0.6875rem] font-semibold text-rose-700 dark:text-rose-300">{t.recentErrors}</p>
                        <ul className="space-y-1">
                          {errors.map((f, i) => (
                            <li key={`${f.at}-${i}`} className="flex flex-wrap gap-x-2 text-[0.6875rem] leading-5">
                              <span className="shrink-0 text-gray-400">{beforeAsked(f.at, q.createdAt, zh)}</span>
                              {f.kind && <span className="shrink-0 text-gray-400">{t.errorKind[f.kind] ?? f.kind}</span>}
                              <code className="min-w-0 break-all font-mono text-gray-700 dark:text-gray-300">{f.detail}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {q.teacherAnswer ? (
                  <div className="mt-3 rounded-lg border border-[#000080]/15 bg-[#000080]/[0.04] p-3 dark:border-blue-800 dark:bg-blue-950/30">
                    <p className="mb-1 text-[0.625rem] font-bold uppercase tracking-wide text-[#000080] dark:text-blue-300">{t.yourAnswer}</p>
                    <p className="whitespace-pre-wrap text-[0.8125rem] leading-6 text-gray-800 dark:text-gray-200">{q.teacherAnswer}</p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={drafts[q.id] ?? ''}
                      onChange={e => setDrafts(prev => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder={t.placeholder}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-[0.8125rem] leading-6 outline-none transition-colors focus:border-[#000080] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    />
                    <button type="button" onClick={() => void answer(q.id)}
                      disabled={sending === q.id || !(drafts[q.id] ?? '').trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#000080] px-3.5 py-2 text-[0.75rem] font-semibold text-white transition-all hover:bg-[#000060] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
                      {sending === q.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      {sending === q.id ? t.sending : t.send}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default StudentHelpDesk;
