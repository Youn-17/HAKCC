/**
 * 对话式笔记：学生采纳一条 AI 反馈后生成的那种笔记。
 *
 * 为什么不复用普通笔记编辑器：采纳一条反馈得到的不该是一段可以编辑的 AI 独白，
 * 而是一个还能继续问下去的对话。学生在这里追问、然后自己决定哪一段值得
 * 放回原笔记、哪一段值得成为社区里的一条新观点 —— 什么进入公共知识空间，
 * 决定权始终在学生手里（Scardamalia 2002 的集体认知责任正是要求这一点：
 * 对公共知识的状态负责，前提是这件事由学习者自己决定）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Send, Loader2, CornerUpLeft, Sparkles, MessageCircle } from 'lucide-react';
import { Language, Note } from '../types';
import { noteConversations, type NoteConversationMessage } from '../services/apiClient';
import MarkdownMessage from './chatMarkdown';
import { detectDrawIntent } from './drawIntent';
import DrawingProgress from './DrawingProgress';

interface Props {
  note: Note;
  lang: Language;
  onClose: () => void;
  /** 把选中的一段插回它承接的那条原笔记 */
  onInsertToSource: (params: { text: string; sourceNoteId: string }) => void;
  /** 把选中的一段发布成一条新的公共笔记 */
  onPublishAsNote: (params: { text: string }) => void;
}

const AiDialogueNote: React.FC<Props> = ({ note, lang, onClose, onInsertToSource, onPublishAsNote }) => {
  const zh = lang === 'zh';
  const [threadId, setThreadId] = useState<string | null>(null);
  /** 发消息要带模型。线程建的时候记了反馈用的那个；缺了就从课程已配置的里挑一个。 */
  const [ai, setAi] = useState<{ providerId: string; model: string } | null>(null);
  const [messages, setMessages] = useState<NoteConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  /** 这一轮是在画图（「画一张……」）：等待时放绘图动画 */
  const [drawing, setDrawing] = useState<{ prompt: string; startedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** 首条 AI 消息里记着它承接自哪条笔记，「插回原笔记」要用 */
  const sourceNoteId = (() => {
    for (const m of messages) {
      const src = (m.aiMetadata as Record<string, unknown> | undefined)?.source_note_id;
      if (typeof src === 'string') return src;
    }
    return null;
  })();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    noteConversations.list(note.id)
      .then(async ({ conversations, aiConfigs }) => {
        if (!alive) return;
        const aiThread = conversations.find(c => c.targetType === 'ai') ?? conversations[0];
        if (!aiThread) { setLoading(false); return; }
        setThreadId(aiThread.id);

        const fallback = (aiConfigs ?? []).find(c => c.isVerified && c.enabledModels.length > 0);
        if (aiThread.providerId && aiThread.model) {
          setAi({ providerId: aiThread.providerId, model: aiThread.model });
        } else if (fallback) {
          // 线程没记模型时交给后端：按课程 AI 设置里「笔记 AI 助手对话」的默认来，不再取库里排第一的配置
          setAi({ providerId: 'auto', model: 'auto' });
        }

        const { messages: rows } = await noteConversations.listMessages(aiThread.id, { limit: 100 });
        if (alive) setMessages(rows);
      })
      .catch(err => alive && setError(err?.message ?? (zh ? '读取对话失败' : 'Failed to load')))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [note.id, zh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !threadId || sending || !ai) return;
    setInput('');
    setSending(true);
    setError(null);
    const wantsPicture = Boolean(detectDrawIntent(text));
    if (wantsPicture) setDrawing({ prompt: text, startedAt: Date.now() });
    // 先把自己那句放上去：等一轮网络往返才看到自己说的话，会让人以为没发出去
    const optimistic: NoteConversationMessage = {
      id: `tmp-${Date.now()}`, threadId, senderId: null, senderKind: 'user',
      content: text, attachments: [], aiMetadata: {}, createdAt: new Date().toISOString(),
    } as NoteConversationMessage;
    setMessages(prev => [...prev, optimistic]);
    try {
      if (wantsPicture) {
        // 「画一张……」直接出图，不经对话模型；用哪个出图服务按课程 AI 设置里的「笔记配图」（默认 DMX）
        await noteConversations.generateImage(threadId, { prompt: text });
      } else {
        await noteConversations.sendAIMessage(threadId, {
          content: text, provider_id: ai.providerId, model: ai.model,
        });
      }
      const { messages: rows } = await noteConversations.listMessages(threadId, { limit: 100 });
      setMessages(rows);
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setInput(text);
      setError(err instanceof Error ? err.message : (zh ? '发送失败' : 'Failed to send'));
    } finally {
      setSending(false);
      setDrawing(null);
    }
  }, [input, threadId, sending, ai, zh]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[min(84dvh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl duration-200 animate-in zoom-in-95 dark:border-stone-800 dark:bg-stone-950">

        <header className="flex items-start gap-3 border-b border-stone-200 px-5 py-3.5 dark:border-stone-800">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#000080]/10 text-[#000080] dark:bg-[#93AAFD]/15 dark:text-[#93AAFD]">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400 dark:text-stone-500">
              {zh ? '对话式笔记' : 'Dialogue note'}
            </p>
            <h2 className="truncate text-base font-semibold tracking-tight text-stone-950 dark:text-stone-100">{note.title}</h2>
          </div>
          <button onClick={onClose} aria-label={zh ? '关闭' : 'Close'}
            className="shrink-0 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-stone-400">
              <Loader2 size={15} className="mr-2 animate-spin" />{zh ? '加载中…' : 'Loading…'}
            </div>
          ) : messages.length === 0 ? (
            <p className="py-16 text-center text-sm text-stone-400">{zh ? '这条笔记还没有对话记录。' : 'No messages yet.'}</p>
          ) : messages.map(m => {
            const mine = m.senderKind === 'user';
            return (
              <div key={m.id} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white ${
                  mine ? 'bg-stone-400 dark:bg-stone-600' : 'bg-[#000080] dark:bg-[#93AAFD] dark:text-stone-900'}`}>
                  {mine ? (zh ? '我' : 'Me') : 'AI'}
                </div>
                <div className={`max-w-[82%] ${mine ? 'text-right' : ''}`}>
                  <div className={`whitespace-pre-wrap rounded-xl border px-3.5 py-2.5 text-left text-sm leading-relaxed ${
                    mine
                      ? 'border-[#000080]/15 bg-[#000080]/[0.05] text-stone-800 dark:border-[#93AAFD]/20 dark:bg-[#93AAFD]/[0.08] dark:text-stone-100'
                      : 'border-stone-200 bg-stone-50 text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100'}`}>
                    {mine ? m.content : <MarkdownMessage content={m.content} />}
                  </div>
                  {!mine && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {sourceNoteId && (
                        <button type="button" onClick={() => onInsertToSource({ text: m.content, sourceNoteId })}
                          className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-0.5 text-[11px] font-medium text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800">
                          <CornerUpLeft size={11} />{zh ? '插入原笔记' : 'Insert into source'}
                        </button>
                      )}
                      <button type="button" onClick={() => onPublishAsNote({ text: m.content })}
                        className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-0.5 text-[11px] font-medium text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800">
                        <MessageCircle size={11} />{zh ? '发布为新笔记' : 'Publish as note'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="flex gap-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#000080] text-[9px] font-semibold text-white dark:bg-[#93AAFD] dark:text-stone-900">AI</div>
              {drawing ? (
                <DrawingProgress prompt={drawing.prompt} lang={lang} startedAt={drawing.startedAt} />
              ) : (
                <div className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 dark:border-stone-800 dark:bg-stone-900">
                  <Loader2 size={14} className="animate-spin text-stone-400" />
                </div>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="px-5 pb-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="flex items-end gap-2 border-t border-stone-200 px-5 py-3 dark:border-stone-800">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={1}
            placeholder={zh ? '继续问下去…' : 'Keep asking…'}
            disabled={!threadId || !ai || sending}
            className="max-h-32 min-h-[38px] flex-1 resize-none rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 outline-none transition-colors focus:border-[#000080] disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-[#93AAFD]"
          />
          <button type="button" onClick={() => void send()} disabled={!input.trim() || !threadId || !ai || sending}
            aria-label={zh ? '发送' : 'Send'}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-[#000080] text-white transition-all hover:bg-[#000080]/90 active:scale-95 disabled:opacity-40">
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiDialogueNote;
