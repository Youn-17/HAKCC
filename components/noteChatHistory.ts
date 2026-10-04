import type { Language } from '../types';
import type { NoteConversationThread } from '../services/apiClient';

/**
 * 笔记 AI 助手「历史对话」的纯逻辑（2026-09-29）：列哪些、删了以后选谁、列表里怎么认出是哪一段。
 * 抽出来是为了能单测——NoteEditorModal 的 AI 面板牵着一堆异步状态，这几条规则不该藏在里面。
 */

/** 学生问的第一句压成一行，最多 80 字（服务端列表返回的 preview 用同一个口径） */
export function previewOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * 历史对话里列哪些：这条笔记上的 AI 对话，去重，去掉这次编辑里删掉的，去掉还没问过话的空白对话
 * （眼下正打开的那一段例外：刚点了「新建对话」，它得在列表里能看到）。
 * 排序沿用传进来的顺序：服务端按最近有动静的排最前，本地新建的插在最前面。
 */
export function visibleHistoryThreads(
  threads: readonly NoteConversationThread[],
  opts: { noteId?: string; selectedId?: string | null; deletedIds: ReadonlySet<string> },
): NoteConversationThread[] {
  const seen = new Set<string>();
  const out: NoteConversationThread[] = [];
  for (const thread of threads) {
    if (seen.has(thread.id)) continue;
    seen.add(thread.id);
    if (thread.targetType !== 'ai') continue;
    if (opts.noteId && thread.noteId !== opts.noteId) continue;
    if (opts.deletedIds.has(thread.id)) continue;
    // preview === null：服务端说这段一句话都没问过；undefined：本地刚建、还不知道，按有内容算
    if (thread.preview === null && thread.id !== opts.selectedId) continue;
    out.push(thread);
  }
  return out;
}

/** 删掉眼前这一段以后接着显示哪一段：剩下的里最近的、问过话的；没有就回到空白 */
export function nextThreadAfterDelete(
  threads: readonly NoteConversationThread[],
  deletedId: string,
  opts: { noteId?: string; deletedIds: ReadonlySet<string> },
): NoteConversationThread | null {
  const rest = visibleHistoryThreads(
    threads.filter(thread => thread.id !== deletedId),
    { noteId: opts.noteId, selectedId: null, deletedIds: opts.deletedIds },
  );
  return rest[0] ?? null;
}

/** 这段对话第一次问话：本地先记下，列表里从此用这句话认它（下次拉列表服务端给的是同一句） */
export function withFirstQuestion(
  threads: readonly NoteConversationThread[],
  threadId: string,
  question: string,
): NoteConversationThread[] {
  const preview = previewOf(question);
  if (!preview) return [...threads];
  return threads.map(thread => (thread.id === threadId && !thread.preview ? { ...thread, preview } : thread));
}

/** 把新建（或后端复用）的线程放到列表最前面，同一条不重复 */
export function withThreadFirst(
  threads: readonly NoteConversationThread[],
  thread: NoteConversationThread,
): NoteConversationThread[] {
  return [thread, ...threads.filter(item => item.id !== thread.id)];
}

/** 列表里的时间：今天的只写钟点，其余写「月/日 钟点」 */
export function formatThreadTime(iso: string | undefined, lang: Language, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (date.toDateString() === now.toDateString()) return lang === 'zh' ? `今天 ${time}` : `Today ${time}`;
  return `${date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })} ${time}`;
}
