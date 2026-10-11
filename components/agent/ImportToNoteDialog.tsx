import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import RemixIcon from '../RemixIcon';
import { artifacts as artifactsApi, noteAiFeedback, notes as notesApi } from '../../services/apiClient';
import { INSERT_TAGS, artifactEmbedHtml, genaiImportHtml, type InsertTagKey } from '../aiInsertHtml';
import { providerDisplayName } from '../aiModelLabels';
import type { AgentArtifactRef } from './agentTurn';

/**
 * 把智能体的一段回答或一个网页导入到自己的某条笔记（2026-10-11 用户：知识空间智能体生成的内容可以导入到指定的 Note）。
 *
 * 和笔记页「添加到 Note」同一套规矩：插进去的是带「AI 来源」标记的一块，要选这段内容对你的帮助（研究编码用），
 * 插入记录写进 note_ai_insertions。网页导入时先挂到那条笔记上（之后看得到这条笔记的人都能打开），再写正文。
 * 只列自己写的笔记：别人的笔记改不了（后端也会拦）。
 */

export type ImportItem =
  | { kind: 'text'; text: string; providerId: string; model: string; sourceMessageId?: string | null; conversationId?: string | null }
  | { kind: 'artifact'; artifact: AgentArtifactRef; conversationId?: string | null };

export interface ImportableNote { id: string; title: string; authorId?: string; updatedAt?: string }

type Position = 'end' | 'start';

export function ImportToNoteDialog({ item, notes, currentUserId, lang, onClose, onDone }: {
  item: ImportItem;
  notes: ImportableNote[];
  currentUserId?: string | null;
  lang: 'zh' | 'en';
  onClose: () => void;
  onDone: (note: { id: string; title: string }) => void;
}) {
  const zh = lang === 'zh';
  const [query, setQuery] = useState('');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [position, setPosition] = useState<Position>('end');
  const [tag, setTag] = useState<InsertTagKey | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mine = useMemo(() => notes
    .filter(n => Boolean(currentUserId) && n.authorId === currentUserId)
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))), [notes, currentUserId]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? mine.filter(n => n.title.toLowerCase().includes(q)) : mine).slice(0, 50);
  }, [mine, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const preview = item.kind === 'text' ? item.text.replace(/\s+/g, ' ').slice(0, 140) : (zh ? `网页《${item.artifact.title}》` : `Page "${item.artifact.title}"`);
  const tagDef = INSERT_TAGS.find(t => t.key === tag);

  const submit = async () => {
    if (!noteId) { setError(zh ? '请先选择笔记。' : 'Pick a note first.'); return; }
    if (!tagDef) { setError(zh ? '请选择这段内容对你的帮助。' : 'Pick how this helps you.'); return; }
    setBusy(true);
    setError('');
    try {
      const { note } = await notesApi.get(noteId);
      const tagLabel = zh ? tagDef.zh : tagDef.en;
      const block = item.kind === 'text'
        ? genaiImportHtml({ text: item.text, providerId: item.providerId, providerLabel: providerDisplayName(item.providerId, lang), model: item.model, sourceMessageId: item.sourceMessageId, tagLabel, lang })
        : artifactEmbedHtml({ artifactId: item.artifact.id, title: item.artifact.title, version: item.artifact.version, tagLabel, lang });
      // 网页先挂到笔记上：挂不上（不是自己的网页、改不了这条笔记）就不动正文
      if (item.kind === 'artifact') await artifactsApi.attach(item.artifact.id, noteId);
      const current = note.content ?? '';
      await notesApi.update(noteId, {
        content: position === 'start' ? `${block}${current}` : `${current}${block}`,
        change_summary: zh ? '从知识空间智能体导入' : 'Imported from the knowledge space agent',
      });
      await noteAiFeedback.recordInsertion(noteId, {
        provider_id: item.kind === 'text' ? item.providerId : undefined,
        model: item.kind === 'text' ? item.model : undefined,
        selected_text: item.kind === 'text' ? item.text : `网页：${item.artifact.title}`,
        inserted_html: block,
        reason_tag: tagDef.key,
        insertion_anchor: {
          source: 'workspace_agent',
          position,
          conversation_id: item.conversationId ?? null,
          ...(item.kind === 'text' ? { message_id: item.sourceMessageId ?? null } : { artifact_id: item.artifact.id, artifact_version: item.artifact.version }),
        },
      }).catch(err => console.warn('[import] insertion record failed:', err));
      onDone({ id: noteId, title: note.title || mine.find(n => n.id === noteId)?.title || '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[170] flex items-end justify-center bg-zinc-950/40 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={zh ? '导入到笔记' : 'Import into a note'} onClick={() => { if (!busy) onClose(); }}>
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_20px_60px_rgba(30,58,138,0.18)] sm:rounded-2xl dark:bg-gray-950" onClick={e => e.stopPropagation()} data-import-dialog>
        <header className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3.5 dark:border-gray-800">
          <RemixIcon name="file-transfer-line" size={17} className="text-[#000080] dark:text-[#93AAFD]" />
          <h2 className="flex-1 text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{zh ? '导入到笔记' : 'Import into a note'}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={zh ? '关闭' : 'Close'} className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-gray-900">
            <RemixIcon name="close-line" size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[0.8125rem] leading-6 text-zinc-600 dark:border-gray-800 dark:bg-gray-900 dark:text-zinc-300">{preview}{item.kind === 'text' && item.text.length > 140 ? '…' : ''}</p>

          <section>
            <p className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{zh ? '导入到哪条笔记' : 'Which note'}</p>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={zh ? '搜索我的笔记' : 'Search my notes'}
              className="mb-2 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none transition-colors focus:border-[#000080]/40 focus:ring-2 focus:ring-[#000080]/10 dark:border-gray-700 dark:bg-gray-900 dark:text-zinc-100"
            />
            <ul className="max-h-56 space-y-1 overflow-y-auto" role="radiogroup" aria-label={zh ? '我的笔记' : 'My notes'}>
              {shown.length === 0 && (
                <li className="px-2 py-4 text-center text-xs text-zinc-400">{mine.length === 0 ? (zh ? '这个空间里还没有你写的笔记。' : 'You have no notes in this space yet.') : (zh ? '没有找到。' : 'No match.')}</li>
              )}
              {shown.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={noteId === n.id}
                    onClick={() => { setNoteId(n.id); setError(''); }}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${noteId === n.id
                      ? 'border-[#000080] bg-[#000080]/[0.04] text-zinc-900 dark:border-[#93AAFD] dark:text-zinc-50'
                      : 'border-transparent text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-gray-900'}`}
                  >
                    <RemixIcon name={noteId === n.id ? 'radio-button-fill' : 'checkbox-blank-circle-line'} size={15} className={noteId === n.id ? 'text-[#000080] dark:text-[#93AAFD]' : 'text-zinc-300'} />
                    <span className="min-w-0 flex-1 truncate">{n.title || (zh ? '未命名笔记' : 'Untitled note')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <p className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{zh ? '放在笔记的' : 'Put it at the'}</p>
            <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-gray-700 dark:bg-gray-900">
              {(['end', 'start'] as Position[]).map(p => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={position === p}
                  onClick={() => setPosition(p)}
                  className={`min-h-9 rounded-lg px-4 text-xs font-semibold transition-all ${position === p ? 'bg-white text-zinc-900 shadow-sm dark:bg-gray-800 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'}`}
                >
                  {p === 'end' ? (zh ? '末尾' : 'End') : (zh ? '开头' : 'Start')}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{zh ? '这段内容对你的帮助是？' : 'How does this help you?'}</p>
            <div className="flex flex-wrap gap-1.5">
              {INSERT_TAGS.map(t => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={tag === t.key}
                  onClick={() => { setTag(t.key); setError(''); }}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${tag === t.key
                    ? 'border-[#000080] bg-[#000080]/5 text-[#000080] dark:border-[#93AAFD] dark:bg-[#93AAFD]/10 dark:text-[#93AAFD]'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-gray-700 dark:bg-gray-800 dark:text-zinc-300'}`}
                >
                  {zh ? t.zh : t.en}
                </button>
              ))}
            </div>
          </section>

          {item.kind === 'artifact' && (
            <p className="text-[0.6875rem] leading-5 text-zinc-400">{zh ? '导入以后，看得到这条笔记的同学和老师都能打开这个网页。' : 'Once imported, anyone who can see this note can open the page.'}</p>
          )}
          {error && <p role="alert" className="rounded-lg bg-[#C27C7C]/10 px-3 py-2 text-xs text-[#8A4B4B] dark:text-[#E3B5B5]">{error}</p>}
        </div>

        <footer className="safe-area-bottom border-t border-zinc-200 dark:border-gray-800">
          <div className="flex justify-end gap-2 px-5 py-3">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-xl px-4 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-gray-900">{zh ? '取消' : 'Cancel'}</button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#000080] px-5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-60 dark:bg-[#93AAFD] dark:text-gray-950"
            >
              {busy && <RemixIcon name="loader-4-line" size={15} className="animate-spin" />}
              {zh ? '导入' : 'Import'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
