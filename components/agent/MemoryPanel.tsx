/**
 * 「AI 记得什么」（2026-10-11 第四步）：学生看、删、关 AI 在这门课里记下的关于自己的事。
 * 三类：这段对话的要点（删对话就没了）、关于你的了解、关键时刻（60 天后自动忘掉）。
 * 盖在所在容器上（知识空间智能体整页、笔记 AI 面板），不另开层级。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { memoryApi, type StudentMemoryItem, type StudentMemoryView } from '../../services/apiClient';
import RemixIcon from '../RemixIcon';

type Props = {
  courseId: string;
  lang: 'zh' | 'en';
  surface?: 'workspace' | 'note';
  conversationId?: string | null;
  onClose: () => void;
};

const TYPE_LABEL: Record<string, { zh: string; en: string }> = {
  insight: { zh: '观察', en: 'Noticed' },
  knowledge_gap: { zh: '还没弄懂', en: 'Still working out' },
  misconception: { zh: '容易混淆', en: 'Mixed up' },
  progress: { zh: '进步', en: 'Progress' },
  interest: { zh: '感兴趣', en: 'Interested in' },
  strength: { zh: '擅长', en: 'Good at' },
  choice: { zh: '做了选择', en: 'Choice' },
  imported: { zh: '导入笔记', en: 'Imported' },
};

const LEVEL_LABEL: Record<string, { zh: string; en: string }> = {
  high: { zh: '较多', en: 'more' },
  medium: { zh: '适中', en: 'some' },
  low: { zh: '较少', en: 'less' },
  minimal: { zh: '很少', en: 'very little' },
};

function dayLabel(iso: string, zh: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return zh ? `${d.getMonth() + 1}月${d.getDate()}日` : d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export default function MemoryPanel({ courseId, lang, surface, conversationId, onClose }: Props) {
  const zh = lang === 'zh';
  const [view, setView] = useState<StudentMemoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState<'profile' | 'episode' | null>(null);
  const [toggling, setToggling] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    memoryApi.get(courseId, { surface, conversationId })
      .then(v => { if (alive) setView(v); })
      .catch(() => { if (alive) setError(zh ? '暂时无法读取记忆，请稍后重试。' : 'Could not load memories. Try again later.'); });
    closeRef.current?.focus();
    return () => { alive = false; };
  }, [courseId, surface, conversationId, zh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const remove = useCallback(async (item: StudentMemoryItem) => {
    setBusy(prev => new Set(prev).add(item.id));
    try {
      await memoryApi.deleteItem(item.id);
      setView(v => v && { ...v, profile: v.profile.filter(m => m.id !== item.id), episodes: v.episodes.filter(m => m.id !== item.id) });
    } catch {
      setError(zh ? '删除失败，请重试。' : 'Could not delete. Try again.');
    } finally {
      setBusy(prev => { const next = new Set(prev); next.delete(item.id); return next; });
    }
  }, [zh]);

  const clear = useCallback(async (kind: 'profile' | 'episode') => {
    setConfirmClear(null);
    try {
      await memoryApi.clear(courseId, kind);
      setView(v => v && (kind === 'profile' ? { ...v, profile: [] } : { ...v, episodes: [] }));
    } catch {
      setError(zh ? '清除失败，请重试。' : 'Could not clear. Try again.');
    }
  }, [courseId, zh]);

  const toggle = useCallback(async () => {
    if (!view) return;
    setToggling(true);
    try {
      const { enabled } = await memoryApi.setEnabled(courseId, !view.enabled);
      setView(v => v && { ...v, enabled });
    } catch {
      setError(zh ? '设置未保存，请重试。' : 'Could not change the setting. Try again.');
    } finally {
      setToggling(false);
    }
  }, [courseId, view, zh]);

  const section = (kind: 'profile' | 'episode', title: string, hint: string, empty: string, items: StudentMemoryItem[]) => (
    <section className="space-y-3" aria-labelledby={`memory-${kind}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`memory-${kind}`} className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {title}{items.length > 0 && <span className="ml-1.5 font-normal tabular-nums text-zinc-400">{items.length}</span>}
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{hint}</p>
        </div>
        {items.length > 0 && confirmClear !== kind && (
          <button
            type="button"
            onClick={() => setConfirmClear(kind)}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/25 dark:hover:bg-gray-800 dark:hover:text-zinc-200"
          >
            {zh ? '全部清除' : 'Clear all'}
          </button>
        )}
      </div>
      {confirmClear === kind && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300" role="alert">
          <span>{zh ? `清除这一类的 ${items.length} 条？清除后不再作为记忆使用。` : `Clear these ${items.length}? They will no longer be used as memories.`}</span>
          <span className="flex gap-1.5">
            <button type="button" onClick={() => void clear(kind)} className="rounded-lg bg-red-600 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 active:scale-[0.98]">{zh ? '清除' : 'Clear'}</button>
            <button type="button" onClick={() => setConfirmClear(null)} className="rounded-lg px-2.5 py-1 font-medium transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 dark:hover:bg-red-900/40">{zh ? '取消' : 'Cancel'}</button>
          </span>
        </div>
      )}
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-xs leading-5 text-zinc-400 dark:border-gray-800 dark:text-zinc-500">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(item => (
            <li key={item.id} className="group flex items-start gap-3 rounded-xl border border-zinc-100 bg-white px-3 py-2.5 transition-colors hover:border-zinc-200 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
              <span className="mt-0.5 shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-zinc-600 dark:bg-gray-800 dark:text-zinc-300">
                {(TYPE_LABEL[item.type] ?? { zh: item.type, en: item.type })[zh ? 'zh' : 'en']}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem] leading-5 text-zinc-800 dark:text-zinc-100">{item.content}</p>
                <p className="mt-0.5 text-[0.625rem] tabular-nums text-zinc-400">
                  {zh ? `记于 ${dayLabel(item.createdAt, zh)}` : `Saved ${dayLabel(item.createdAt, zh)}`}
                  {item.updatedAt && dayLabel(item.updatedAt, zh) !== dayLabel(item.createdAt, zh) && (zh ? ` · ${dayLabel(item.updatedAt, zh)}更新` : ` · updated ${dayLabel(item.updatedAt, zh)}`)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(item)}
                disabled={busy.has(item.id)}
                aria-label={zh ? '删除这条记忆' : 'Delete this memory'}
                title={zh ? '删除这条记忆' : 'Delete this memory'}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-all duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 active:scale-[0.96] disabled:opacity-40 sm:h-8 sm:w-8 dark:hover:bg-red-950/40"
              >
                <RemixIcon name="delete-bin-6-line" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-zinc-950/25 backdrop-blur-[2px] sm:items-center sm:p-6" onClick={onClose} data-memory-panel>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-panel-title"
        onClick={e => e.stopPropagation()}
        className="safe-area-bottom flex max-h-[min(44rem,92%)] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] border border-zinc-200/80 bg-zinc-50 shadow-[0_24px_64px_-24px_rgba(30,58,138,0.35)] sm:rounded-[1.75rem] dark:border-gray-800 dark:bg-gray-950"
      >
        <header className="flex items-start gap-3 px-6 pb-4 pt-6">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-[#000080] dark:border-gray-800 dark:bg-gray-900 dark:text-[#93AAFD]">
            <RemixIcon name="bookmark-3-line" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="memory-panel-title" className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{zh ? 'AI 记得什么' : 'What the AI remembers'}</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {zh ? '这里显示本课 AI 保存的学习记忆。你可以查看和删除，删除后不再作为记忆使用。' : 'Review or delete your saved AI memories for this course. Deleted items are no longer used as memories.'}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={zh ? '关闭' : 'Close'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/25 sm:h-9 sm:w-9 dark:hover:bg-gray-800 dark:hover:text-zinc-50"
          >
            <RemixIcon name="close-line" size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 pb-6">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

          {!view && !error && (
            <div className="space-y-4" aria-busy="true" aria-label={zh ? '正在读取' : 'Loading'}>
              {[0, 1, 2].map(i => (
                <div key={i} className="space-y-2">
                  <div className="h-3.5 w-28 animate-pulse rounded bg-zinc-200 dark:bg-gray-800" />
                  <div className="h-14 animate-pulse rounded-xl bg-white dark:bg-gray-900" />
                </div>
              ))}
            </div>
          )}

          {view && (
            <>
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{zh ? '让 AI 记住我' : 'Let the AI remember me'}</p>
                  <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    {view.enabled
                      ? (zh ? '已开启：将选择和学习记录用于后续对话。' : 'On: choices and learning records can be used in later conversations.')
                      : (zh ? '已关闭跨对话记忆：不再新增或使用，已有记忆仍保留；当前对话仍有上下文。' : 'Cross-conversation memory is off. No new memories are saved. Existing memories stay stored but are not used; the current conversation keeps its context.')}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={view.enabled}
                  aria-label={zh ? '让 AI 记住我' : 'Let the AI remember me'}
                  onClick={() => void toggle()}
                  disabled={toggling}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 focus-visible:ring-offset-2 disabled:opacity-60 ${view.enabled ? 'bg-[#000080] dark:bg-[#93AAFD]' : 'bg-zinc-300 dark:bg-gray-700'}`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${view.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {view.conversation && (
                <section className="space-y-2" aria-labelledby="memory-conversation">
                  <h3 id="memory-conversation" className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{zh ? '这段对话的要点' : 'This conversation'}</h3>
                  <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{zh ? '用于延续当前对话。删除这段对话时，其摘要也会删除。' : 'The AI uses this summary to continue the conversation. Deleting the conversation also deletes its summary.'}</p>
                  <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-zinc-100 bg-white px-3 py-2.5 text-[0.8125rem] leading-6 text-zinc-700 dark:border-gray-800 dark:bg-gray-900 dark:text-zinc-200">{view.conversation.summary}</p>
                </section>
              )}

              {section('profile', zh ? '关于你的了解' : 'About you',
                zh ? 'AI 在对话里注意到的兴趣、进步、还没弄懂的地方。' : 'Interests, progress and things still being worked out that the AI noticed.',
                zh ? '还没有。AI 注意到你的兴趣、进步或还没弄懂的地方时，会记在这里。' : 'Nothing yet. When the AI notices an interest, progress or something you are still working out, it will show up here.',
                view.profile)}

              {section('episode', zh ? '关键时刻' : 'Key moments',
                zh ? '你在选项卡上做的选择、把 AI 的内容导入笔记。60 天后自动清除。' : 'Choices you made on option cards and AI content you imported into notes. Automatically removed after 60 days.',
                zh ? '还没有。你在选项卡上做选择、把 AI 的内容导入笔记时，会记在这里。' : 'Nothing yet. Choices on option cards and imports into notes will show up here.',
                view.episodes)}

              {view.scaffolding && (
                <p className="border-t border-zinc-200/70 pt-4 text-xs leading-5 text-zinc-500 dark:border-gray-800 dark:text-zinc-400">
                  {zh
                    ? `AI 给你的提示：${LEVEL_LABEL[view.scaffolding.level]?.zh ?? view.scaffolding.level}。按你和 AI 的 ${view.scaffolding.interactions} 次对话自动调整。`
                    : `The AI currently gives you ${LEVEL_LABEL[view.scaffolding.level]?.en ?? view.scaffolding.level} prompting, adjusted from your ${view.scaffolding.interactions} conversations with it.`}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
