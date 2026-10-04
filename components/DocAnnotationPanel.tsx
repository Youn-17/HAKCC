/**
 * 文档批注侧栏 —— 像 Word 的批注窗格：谁批的、批在哪句话上、说了什么。
 *
 * 文档是空间共享的，所以每条批注都显示头像和姓名。没有姓名的批注在共享文档里
 * 毫无用处：读的人无从判断该找谁确认。
 *
 * 排序按文档位置而不是时间。批注是就地讨论，顺着正文往下读才对得上；
 * 按时间排会让同一段的两条批注隔着半篇文档。
 */
import React, { useMemo, useState } from 'react';
import RemixIcon from './RemixIcon';
import UserAvatar from './UserAvatar';
import { MORANDI, chipStyle, ink, shade } from './morandiPalette';
import type { DocAnnotation } from '../services/apiClient';
import type { Language } from '../types';

interface Props {
  annotations: DocAnnotation[];
  /** 引文在当前正文里找不到的批注 id —— 文档被改过 */
  staleIds: Set<string>;
  currentUserId?: string;
  isStaff: boolean;
  lang: Language;
  loading: boolean;
  onJump: (annotation: DocAnnotation) => void;
  onReply: (parentId: string, body: string) => Promise<void>;
  onToggleResolved: (annotation: DocAnnotation) => Promise<void>;
  onDelete: (annotation: DocAnnotation) => Promise<void>;
}

/** md-h-12 → 12。用来按文档位置排序；不是标题锚点的排到最后。 */
function headingOrder(a: DocAnnotation): number {
  const id = (a.anchor as { headingId?: string | null })?.headingId;
  const match = typeof id === 'string' ? id.match(/^md-h-(\d+)/) : null;
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function formatTime(iso: string, zh: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const mins = Math.floor((now - d.getTime()) / 60000);
  if (mins < 1) return zh ? '刚刚' : 'just now';
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return zh ? `${hrs} 小时前` : `${hrs}h ago`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

const DocAnnotationPanel: React.FC<Props> = ({
  annotations, staleIds, currentUserId, isStaff, lang, loading,
  onJump, onReply, onToggleResolved, onDelete,
}) => {
  const zh = lang === 'zh';
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const { threads, resolvedCount } = useMemo(() => {
    const roots = annotations.filter(a => !a.parentId);
    const repliesBy = new Map<string, DocAnnotation[]>();
    for (const a of annotations) {
      if (!a.parentId) continue;
      const list = repliesBy.get(a.parentId) ?? [];
      list.push(a);
      repliesBy.set(a.parentId, list);
    }
    const sorted = [...roots].sort((a, b) => (headingOrder(a) - headingOrder(b))
      || (Date.parse(a.createdAt) - Date.parse(b.createdAt)));
    return {
      threads: sorted.map(root => ({ root, replies: repliesBy.get(root.id) ?? [] })),
      resolvedCount: roots.filter(r => r.resolved).length,
    };
  }, [annotations]);

  const visible = showResolved ? threads : threads.filter(t => !t.root.resolved);

  const submitReply = async (parentId: string) => {
    const body = replyDraft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onReply(parentId, body);
      setReplyDraft('');
      setReplyTo(null);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-[0.75rem] text-zinc-400">{zh ? '正在读取批注⋯⋯' : 'Loading…'}</div>;
  }

  // min-h-0 flex-1 而不是 h-full：h-full 是 height:100%，要求父级有**指定**高度，
  // 而侧栏的高度是 flex 算出来的，解析不了 —— 面板会被撑到内容全高，
  // 于是列表滚不动、底部的输入框被挤出可视范围。
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {visible.length === 0 && (
          <div className="rounded-xl bg-zinc-50 px-3 py-4 text-[0.75rem] leading-6 text-zinc-500 dark:bg-gray-900">
            {zh
              ? '还没有批注。在正文里选中一段话，就能批注在那句话上——大家都看得到。'
              : 'No comments yet. Select a passage in the text to comment on it — everyone in the space sees it.'}
          </div>
        )}

        {visible.map(({ root, replies }) => {
          const stale = staleIds.has(root.id);
          const mine = root.authorId === currentUserId;
          return (
            <div
              key={root.id}
              className={`mb-2.5 rounded-xl border border-zinc-200 bg-white p-3 transition-colors dark:border-gray-700 dark:bg-gray-900 ${
                root.resolved ? 'opacity-60' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onJump(root)}
                className="mb-2 block w-full text-left"
                title={zh ? '跳到原文' : 'Jump to the text'}
              >
                {root.quote && (
                  <span
                    className="block border-l-2 pl-2 text-[0.75rem] italic leading-5 text-zinc-600 dark:text-gray-400"
                    style={{ borderColor: stale ? MORANDI.stone : MORANDI.ochre }}
                  >
                    {root.quote}
                  </span>
                )}
                {stale && (
                  <span
                    className="mt-1 inline-block rounded-full border px-1.5 py-0.5 text-[0.625rem] font-medium"
                    style={chipStyle(MORANDI.stone)}
                  >
                    {zh ? '原文已修改' : 'text has changed'}
                  </span>
                )}
              </button>

              <div className="mb-1.5 flex items-center gap-2">
                <UserAvatar name={root.authorName} avatar={root.authorAvatar ?? undefined} size={22} />
                <span className="truncate text-[0.75rem] font-semibold text-zinc-800 dark:text-gray-200">
                  {root.authorName || (zh ? '成员' : 'Member')}
                </span>
                <span className="ml-auto shrink-0 text-[0.6875rem] text-zinc-400">{formatTime(root.createdAt, zh)}</span>
              </div>

              <p className="whitespace-pre-wrap text-[0.8125rem] leading-6 text-zinc-800 dark:text-gray-200">{root.body}</p>

              {replies.map(reply => (
                <div key={reply.id} className="mt-2 border-l border-zinc-200 pl-2.5 dark:border-gray-700">
                  <div className="mb-1 flex items-center gap-1.5">
                    <UserAvatar name={reply.authorName} avatar={reply.authorAvatar ?? undefined} size={18} />
                    <span className="truncate text-[0.6875rem] font-semibold text-zinc-700 dark:text-gray-300">
                      {reply.authorName || (zh ? '成员' : 'Member')}
                    </span>
                    <span className="ml-auto shrink-0 text-[0.625rem] text-zinc-400">{formatTime(reply.createdAt, zh)}</span>
                    {(reply.authorId === currentUserId || isStaff) && (
                      <button
                        onClick={() => void onDelete(reply)}
                        aria-label={zh ? '删除回复' : 'Delete reply'}
                        className="text-zinc-300 transition-colors hover:text-zinc-600"
                      >
                        <RemixIcon name="delete-bin-line" size={12} />
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-[0.75rem] leading-5 text-zinc-700 dark:text-gray-300">{reply.body}</p>
                </div>
              ))}

              {replyTo === root.id ? (
                <div className="mt-2">
                  <textarea
                    autoFocus
                    rows={2}
                    value={replyDraft}
                    maxLength={2000}
                    onChange={e => setReplyDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitReply(root.id);
                      if (e.key === 'Escape') { setReplyTo(null); setReplyDraft(''); }
                    }}
                    placeholder={zh ? '回复⋯⋯' : 'Reply…'}
                    className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[0.75rem] outline-none focus:border-[#000080]/50 dark:border-gray-700 dark:bg-gray-950"
                  />
                  <div className="mt-1 flex gap-1.5">
                    <button
                      onClick={() => void submitReply(root.id)}
                      disabled={busy || !replyDraft.trim()}
                      className="rounded-md bg-[#000080] px-2.5 py-1 text-[0.6875rem] font-semibold text-white disabled:opacity-40"
                    >
                      {zh ? '回复' : 'Reply'}
                    </button>
                    <button
                      onClick={() => { setReplyTo(null); setReplyDraft(''); }}
                      className="rounded-md border border-zinc-200 px-2.5 py-1 text-[0.6875rem] text-zinc-600"
                    >
                      {zh ? '取消' : 'Cancel'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-3 text-[0.6875rem]">
                  <button onClick={() => { setReplyTo(root.id); setReplyDraft(''); }} className="font-medium text-[#000080] hover:underline dark:text-[#93AAFD]">
                    {zh ? '回复' : 'Reply'}
                  </button>
                  <button
                    onClick={() => void onToggleResolved(root)}
                    className="font-medium hover:underline"
                    style={{ color: root.resolved ? MORANDI.stone : ink(MORANDI.sage, 0.45) }}
                  >
                    {root.resolved ? (zh ? '重新打开' : 'Reopen') : (zh ? '标记解决' : 'Resolve')}
                  </button>
                  {(mine || isStaff) && (
                    <button
                      onClick={() => void onDelete(root)}
                      aria-label={zh ? '删除批注' : 'Delete comment'}
                      className="ml-auto text-zinc-300 transition-colors hover:text-zinc-600"
                    >
                      <RemixIcon name="delete-bin-line" size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {resolvedCount > 0 && (
        <button
          onClick={() => setShowResolved(v => !v)}
          className="shrink-0 border-t border-zinc-200 px-4 py-2.5 text-left text-[0.6875rem] text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-gray-800 dark:hover:bg-gray-900"
          style={{ backgroundColor: showResolved ? shade(MORANDI.stone, 0.94) : undefined }}
        >
          {showResolved
            ? (zh ? `隐藏已解决的 ${resolvedCount} 条` : `Hide ${resolvedCount} resolved`)
            : (zh ? `显示已解决的 ${resolvedCount} 条` : `Show ${resolvedCount} resolved`)}
        </button>
      )}
    </div>
  );
};

export default DocAnnotationPanel;
