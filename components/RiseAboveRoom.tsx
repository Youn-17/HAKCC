import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Loader2, AlertCircle } from 'lucide-react';
import { riseAbove as roomApi, type RiseAboveRoomData, type RoomMessage, type RoomAgent } from '../services/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { notePreviewText } from './noteText';

/**
 * Rise Above 讨论室。
 *
 * 三栏：左边是组员与 AI 同学，中间是顶置的来源笔记加群聊，右边是提升区。
 *
 * ══ 这一版和旧版的根本区别 ══
 * 旧版：选笔记 → 读 → **AI 生成综述** → 完成。一个人走完，像填表。
 * 现在：一场讨论。系统只把看到的说出来，那句更高一层的说法由学生自己写。
 *
 * 落实在三处：右栏撰写区里没有任何 AI 按钮；那张系统卡只提问不给答案；
 * 发布走的接口完全不碰模型。
 */

interface Props {
  roomId: string;
  lang: 'zh' | 'en';
  onLocateNote?: (noteId: string) => void;
  onPublished?: (noteId: string) => void;
  onClose: () => void;
}

const T = {
  zh: {
    title: 'Rise Above', close: '关闭',
    sourceNotes: '正在讨论的笔记', clickToOpen: '点开看原文',
    agents: 'AI 同学 · 想叫谁就叫谁', agentHint: '默认只在被叫到时开口，不会抢同学之间的话',
    members: '这一组',
    placeholder: '说说你的想法⋯⋯', mentionHint: '点上面的 AI 同学，它会跟着这条一起发言',
    send: '发送', sending: '发送中',
    noticeFoot: '系统看到的，不是谁说的',
    writeUp: '由我们来写', later: '还想再聊聊',
    riseTitle: '写下你们的说法',
    riseHint: '草稿只在你自己的页面上，组员看不到。想一起改，就把句子发到群聊里。发布之前 AI 不碰这段文字。',
    onlyCreator: '只有开这间讨论室的同学可以发布。把商量好的说法发到群聊里，由这位同学来发布。',
    fieldTitle: '标题', fieldBody: '我们的说法',
    titlePh: '也许「懂」不是有没有，而是靠什么在懂',
    bodyPh: '写下那句更高一层的说法 —— 一个能同时容纳前面几种说法的表述',
    sources: '来源笔记', sourcesFoot: '会一并收进这一条',
    publish: '发布', publishing: '发布中', back: '返回',
    publishFoot: '发布后成为画布上一条新笔记，并自动连回这几条来源',
    published: '这间讨论室已经发布过了',
    empty: '还没有人说话。先说说你从这几条笔记里看到了什么。',
    loading: '正在打开⋯⋯', fail: '打不开这间讨论室',
    tooShort: '正文再写具体一点', needTitle: '给这条提升写个标题',
  },
  en: {
    title: 'Rise Above', close: 'Close',
    sourceNotes: 'Notes under discussion', clickToOpen: 'open',
    agents: 'AI classmates — call whoever you need', agentHint: 'They only speak when called, so they do not crowd out your peers',
    members: 'This group',
    placeholder: 'Say what you think…', mentionHint: 'Pick a classmate above and they will reply to this message',
    send: 'Send', sending: 'Sending',
    noticeFoot: 'noticed by the system, not said by anyone',
    writeUp: 'We will write it', later: 'Keep talking',
    riseTitle: 'Write your formulation',
    riseHint: 'Your draft stays on your own screen; your group cannot see it. To work on it together, post the sentence in the chat. AI does not touch this text before it is published.',
    onlyCreator: 'Only the classmate who opened this room can publish. Post the agreed wording in the chat so they can publish it.',
    fieldTitle: 'Title', fieldBody: 'Our formulation',
    titlePh: 'Maybe "understanding" is not yes-or-no but what it rests on',
    bodyPh: 'The higher-level statement — one that holds the earlier positions together',
    sources: 'Source notes', sourcesFoot: 'will be carried into this note',
    publish: 'Publish', publishing: 'Publishing', back: 'Back',
    publishFoot: 'Becomes a new note on the canvas, linked back to these sources',
    published: 'This room has already been published',
    empty: 'No one has spoken yet. Start with what you see in these notes.',
    loading: 'Opening…', fail: 'Could not open this room',
    tooShort: 'Write a bit more', needTitle: 'Give it a title',
  },
};

/** 组员的发言没有推送，只能自己去取。开着页面时每隔几秒取一次。 */
const POLL_MS = 5000;

/** 按 id 合并，同一条以新取回的为准，再按时间排。发送的回包和轮询可能带回同一条。 */
function mergeRoomMessages(prev: RoomMessage[], incoming: RoomMessage[]): RoomMessage[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map(m => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

const RiseAboveRoom: React.FC<Props> = ({ roomId, lang, onLocateNote, onPublished, onClose }) => {
  const t = T[lang];
  const { user } = useAuth();
  const [data, setData] = useState<RiseAboveRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [mention, setMention] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [riseTitle, setRiseTitle] = useState('');
  const [riseBody, setRiseBody] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [writeCue, setWriteCue] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const writeRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const cueTimer = useRef<number | undefined>(undefined);
  const polling = useRef(false);
  /** 这一段停滞已经替它问过服务器了（按停下来之前最后一条同学发言算） */
  const idleAskedFor = useRef<string | null>(null);

  const absorb = useCallback((incoming: RoomMessage[]) => {
    if (incoming.length) setData(d => (d ? { ...d, messages: mergeRoomMessages(d.messages, incoming) } : d));
  }, []);

  // 停滞那张卡只能由开着的页面来问（发言接口判不到停滞），服务器会再判一遍
  const askIfStalled = useCallback(async (fresh: RiseAboveRoomData) => {
    if (!fresh.stalled) return;
    const lastStudent = [...fresh.messages].reverse().find(m => m.sender_kind === 'user');
    if (!lastStudent || idleAskedFor.current === lastStudent.id) return;
    idleAskedFor.current = lastStudent.id;
    try { absorb((await roomApi.idleCheck(roomId)).messages); } catch { /* 下次打开再问 */ }
  }, [roomId, absorb]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const fresh = await roomApi.get(roomId);
      setData(fresh);
      void askIfStalled(fresh);
    } catch (e) { setError(e instanceof Error ? e.message : t.fail); }
    finally { setLoading(false); }
  }, [roomId, t.fail, askIfStalled]);

  useEffect(() => { void load(); }, [load]);

  // 组员的新发言、别人已经发布了这间讨论室，都要靠这里取回来
  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const fresh = await roomApi.get(roomId);
      setData(prev => (prev ? { ...fresh, messages: mergeRoomMessages(prev.messages, fresh.messages) } : fresh));
      void askIfStalled(fresh);
    } catch { /* 轮询失败不打扰，下一轮再取 */ }
    finally { polling.current = false; }
  }, [roomId, askIfStalled]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [refresh]);

  useEffect(() => () => window.clearTimeout(cueTimer.current), []);

  const visibleMessages = useMemo(
    () => (data?.messages ?? []).filter(m => !(m.payload as any)?.suppressed),
    [data?.messages],
  );

  // 只在本来就停在底部时跟到底；往上翻着看的时候别人发言不把人拽下来
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [visibleMessages.length]);

  const onListScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setError(null);
    try {
      const { messages } = await roomApi.send(roomId, { content: text, mention: mention ?? undefined });
      stickToBottom.current = true;
      absorb(messages);
      setDraft(''); setMention(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.fail);
    } finally { setSending(false); }
  };

  /** 系统卡上的「由我们来写」：把人带到右边的撰写区，光标落在标题上 */
  const goWrite = () => {
    writeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    titleRef.current?.focus({ preventScroll: true });
    setWriteCue(true);
    window.clearTimeout(cueTimer.current);
    cueTimer.current = window.setTimeout(() => setWriteCue(false), 1600);
  };

  const publish = async () => {
    if (!riseTitle.trim()) { setPublishError(t.needTitle); return; }
    if (riseBody.trim().length < 20) { setPublishError(t.tooShort); return; }
    setPublishing(true); setPublishError(null);
    try {
      const { note } = await roomApi.publish(roomId, { title: riseTitle.trim(), content: riseBody.trim() });
      onPublished?.(note.id);
      onClose();
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : t.fail);
    } finally { setPublishing(false); }
  };

  const agentById = useMemo(
    () => new Map((data?.agents ?? []).map(a => [a.id, a])),
    [data?.agents],
  );
  const agentName = (a: RoomAgent) => (lang === 'zh' ? a.nameZh : a.nameEn);
  const noteIndex = useMemo(
    () => new Map((data?.sourceNotes ?? []).map((n, i) => [n.id, i + 1])),
    [data?.sourceNotes],
  );

  const opened = data?.sourceNotes.find(n => n.id === openNote) ?? null;
  const isPublished = data?.room.status === 'published';
  // 以服务器的判断为准（开讨论室的人、课程职员）；接口没给这个字段时按角色估一个
  const canPublish = !data || (data.canPublish ?? (user?.role !== 'student' || data.room.created_by === user?.id));

  return (
    // 独立页面而不是弹窗：讨论室要待很久 —— 读来源笔记、跟五个 AI 同学来回、
    // 最后自己写出那句更高一层的说法。压在半透明蒙层上的一张卡片撑不住这种停留，
    // 而且它有自己的地址（/workspace/:courseId/riseabove/:roomId），可以直接分享、
    // 浏览器后退能回画布。和笔记页同一套呈现方式。
    <div className="fixed inset-0 z-[100] flex flex-col bg-white font-sans dark:bg-gray-950">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">

        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-6 py-4 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#000080] text-base text-white">↑</div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold tracking-tight text-stone-900 dark:text-gray-100">
                {data?.room.title || t.title}
              </h2>
              <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-stone-400 dark:text-gray-500">
                {t.title} · {data?.sourceNotes.length ?? 0} {lang === 'zh' ? '条来源笔记' : 'source notes'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t.close}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-stone-200 text-stone-600 transition hover:bg-stone-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900">
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-stone-500">
            <Loader2 size={16} className="animate-spin" />{t.loading}
          </div>
        )}

        {!loading && !data && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="flex items-center gap-1.5 text-sm text-stone-600 dark:text-gray-300">
              <AlertCircle size={15} className="shrink-0 text-red-500" />{error ?? t.fail}
            </p>
            <button type="button" onClick={() => void load()}
              className="rounded-2xl bg-[#000080] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1a1a72]">
              {lang === 'zh' ? '重试' : 'Retry'}
            </button>
          </div>
        )}

        {!loading && data && (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[236px_minmax(0,1fr)_300px]">

            {/* 左：AI 同学 */}
            <aside className="min-h-0 overflow-y-auto border-b border-stone-200 bg-white px-3.5 py-4 lg:border-b-0 lg:border-r dark:border-gray-800 dark:bg-gray-950">
              <p className="mb-2 px-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400 dark:text-gray-500">
                {t.agents}
              </p>
              <div className="grid gap-1">
                {data.agents.map(a => {
                  const on = mention === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setMention(on ? null : a.id)}
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ${
                        on ? 'border-[#000080]/25 bg-[#000080]/[0.06]'
                           : 'border-transparent hover:bg-stone-50 dark:hover:bg-gray-900'
                      }`}
                    >
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-[0.75rem] font-medium ${
                        on ? 'border-[#000080] bg-[#000080] text-white'
                           : 'border-stone-200 bg-white text-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-blue-300'
                      }`}>{a.avatar}</span>
                      <span className="min-w-0">
                        <span className="block text-[0.7812rem] font-semibold text-stone-800 dark:text-gray-200">{agentName(a)}</span>
                        <span className="block truncate text-[0.6875rem] text-stone-500 dark:text-gray-500">
                          {lang === 'zh' ? a.habitZh : a.habitEn}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2.5 px-1 text-[0.6875rem] leading-relaxed text-stone-400 dark:text-gray-500">{t.agentHint}</p>
            </aside>

            {/* 中：顶置笔记 + 群聊 */}
            <main className="flex min-h-0 flex-col bg-stone-50/60 dark:bg-gray-900/30">
              <div className="border-b border-stone-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950">
                <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400 dark:text-gray-500">
                  {t.sourceNotes} · {t.clickToOpen}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {data.sourceNotes.map((n, i) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setOpenNote(openNote === n.id ? null : n.id)}
                      className={`flex shrink-0 max-w-[210px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[0.75rem] transition ${
                        openNote === n.id
                          ? 'border-[#000080] bg-[#000080]/[0.06] text-stone-900 dark:text-gray-100'
                          : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-white dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                      }`}
                    >
                      <span className="shrink-0 font-mono text-[0.6875rem] text-stone-400">#{i + 1}</span>
                      <span className="truncate">{n.title || '—'}</span>
                    </button>
                  ))}
                </div>
                {opened && (
                  <div className="mt-2.5 rounded-r-xl border border-l-2 border-stone-200 border-l-[#000080] bg-stone-50 px-3.5 py-3 dark:border-gray-700 dark:bg-gray-900">
                    <h4 className="mb-1.5 text-[0.8125rem] font-semibold text-stone-900 dark:text-gray-100">{opened.title}</h4>
                    <p className="text-[0.7812rem] leading-relaxed text-stone-600 dark:text-gray-400">
                      {notePreviewText(opened.content).slice(0, 500)}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="font-mono text-[0.6875rem] text-stone-400">{opened.author_name}</span>
                      <button type="button" onClick={() => onLocateNote?.(opened.id)}
                        className="font-mono text-[0.6875rem] text-[#000080] underline-offset-2 hover:underline dark:text-blue-300">
                        {lang === 'zh' ? '在画布上看' : 'on canvas'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div ref={listRef} onScroll={onListScroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {visibleMessages.length === 0 && (
                  <p className="mt-8 text-center text-[0.8125rem] text-stone-400 dark:text-gray-500">{t.empty}</p>
                )}
                {visibleMessages.map(m => <Message key={m.id} m={m} agentById={agentById} lang={lang}
                                                   noteIndex={noteIndex} onLocateNote={onLocateNote}
                                                   onWriteUp={goWrite} t={t} />)}
              </div>

              <div className="border-t border-stone-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950">
                {error && (
                  <p className="mb-2 flex items-start gap-1.5 text-[0.6875rem] text-red-600 dark:text-red-400">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />{error}
                  </p>
                )}
                <div className="flex items-end gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    rows={1}
                    placeholder={t.placeholder}
                    className="max-h-28 min-h-[24px] flex-1 resize-none bg-transparent text-[0.8125rem] leading-relaxed text-stone-800 outline-none placeholder:text-stone-400 dark:text-gray-200"
                  />
                  <button type="button" onClick={() => void send()} disabled={sending || !draft.trim()}
                    aria-label={t.send}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#000080] text-white transition disabled:opacity-40">
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                </div>
                <p className="mt-1.5 text-[0.6875rem] text-stone-400 dark:text-gray-500">
                  {mention
                    ? `${lang === 'zh' ? '会叫上' : 'Will call'} ${agentName(agentById.get(mention)!)}`
                    : t.mentionHint}
                </p>
              </div>
            </main>

            {/* 右：提升区 —— 这里没有任何 AI 按钮 */}
            <aside ref={writeRef}
              className={`min-h-0 scroll-mt-4 overflow-y-auto border-t border-stone-200 px-4 py-4 transition-colors duration-500 lg:border-t-0 lg:border-l dark:border-gray-800 ${
                writeCue ? 'bg-[#000080]/[0.04] dark:bg-blue-950/30' : 'bg-white dark:bg-gray-950'
              }`}>
              <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400 dark:text-gray-500">
                {t.riseTitle}
              </p>
              <p className="mb-3 text-[0.6875rem] leading-relaxed text-stone-500 dark:text-gray-400">{t.riseHint}</p>

              {isPublished ? (
                <p className="rounded-xl bg-stone-50 px-3 py-2.5 text-[0.75rem] text-stone-600 dark:bg-gray-900 dark:text-gray-400">
                  {t.published}
                </p>
              ) : (
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400">{t.fieldTitle}</span>
                    <input ref={titleRef} value={riseTitle} onChange={e => setRiseTitle(e.target.value)} placeholder={t.titlePh}
                      className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[0.8125rem] font-semibold text-stone-900 outline-none focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-stone-400">{t.fieldBody}</span>
                    <textarea value={riseBody} onChange={e => setRiseBody(e.target.value)} rows={8} placeholder={t.bodyPh}
                      className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[0.7812rem] leading-relaxed text-stone-700 outline-none focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" />
                  </label>

                  <div className="rounded-xl border border-stone-200 dark:border-gray-700">
                    <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-3 py-1.5 text-[0.6875rem] font-semibold text-stone-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                      {t.sources}<em className="font-mono text-[0.6875rem] not-italic text-stone-400">{t.sourcesFoot}</em>
                    </div>
                    <div className="grid gap-1 p-2">
                      {data.sourceNotes.map((n, i) => (
                        <div key={n.id} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-[0.7188rem] dark:border-gray-700 dark:bg-gray-900">
                          <span className="shrink-0 font-mono text-[0.6875rem] text-stone-400">#{i + 1}</span>
                          <span className="truncate text-stone-700 dark:text-gray-300">{n.title || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {canPublish ? (
                    <>
                      <p className="text-[0.6875rem] leading-relaxed text-stone-400 dark:text-gray-500">{t.publishFoot}</p>
                      {publishError && (
                        <p role="alert" className="flex items-start gap-1.5 text-[0.6875rem] text-red-600 dark:text-red-400">
                          <AlertCircle size={12} className="mt-0.5 shrink-0" />{publishError}
                        </p>
                      )}
                      <button type="button" onClick={() => void publish()} disabled={publishing}
                        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-2xl bg-[#000080] px-4 text-sm font-semibold text-white transition hover:bg-[#1a1a72] disabled:opacity-50">
                        {publishing && <Loader2 size={14} className="animate-spin" />}
                        {publishing ? t.publishing : t.publish}
                      </button>
                    </>
                  ) : (
                    <p className="rounded-xl bg-stone-50 px-3 py-2.5 text-[0.7188rem] leading-relaxed text-stone-600 dark:bg-gray-900 dark:text-gray-400">
                      {t.onlyCreator}
                    </p>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

/** 一条消息。同学和 AI 同学是气泡；系统那张卡不是气泡也没有头像。 */
const Message: React.FC<{
  m: RoomMessage;
  agentById: Map<string, RoomAgent>;
  lang: 'zh' | 'en';
  noteIndex: Map<string, number>;
  onLocateNote?: (id: string) => void;
  onWriteUp: () => void;
  t: typeof T['zh'];
}> = ({ m, agentById, lang, noteIndex, onLocateNote, onWriteUp, t }) => {
  if (m.sender_kind === 'system') {
    const p = m.payload as any;
    if (!p?.sides) return null;
    return (
      <div className="rounded-2xl border border-[#ecdcb9] bg-[#fdf8ee] px-4 py-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
        <p className="mb-2.5 text-[0.8125rem] leading-relaxed text-stone-900 dark:text-gray-100">
          {lang === 'zh' ? '你们对' : 'You are using two different senses of'}
          「<b>{p.topic}</b>」
          {lang === 'zh' ? '用了不一样的说法 ——' : ''}
        </p>
        <ul className="mb-3 grid gap-2">
          {p.sides.map((s: any, i: number) => (
            <li key={i} className="flex gap-2.5 text-[0.7812rem] leading-relaxed text-stone-700 dark:text-gray-300">
              <span className="w-[3px] shrink-0 self-stretch rounded-full bg-[#ecdcb9] dark:bg-amber-900/50" />
              <span>
                <b className="text-stone-900 dark:text-gray-100">{s.who}</b>：{s.stance}
                {(s.noteIds ?? []).map((id: string) => (
                  <button key={id} type="button" onClick={() => onLocateNote?.(id)}
                    className="ml-1 rounded bg-[#000080]/[0.07] px-1 font-mono text-[0.6875rem] text-[#000080] dark:text-blue-300">
                    #{noteIndex.get(id) ?? '?'}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="mb-3 rounded-xl border border-[#ecdcb9] bg-white px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-stone-900 dark:border-amber-900/40 dark:bg-gray-900 dark:text-gray-100">
          {p.question}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onWriteUp}
            className="rounded-xl bg-[#000080] px-3.5 py-1.5 text-[0.75rem] font-semibold text-white">
            {t.writeUp}
          </button>
          <span className="ml-auto text-[0.6875rem] text-[#8c6b2f] dark:text-amber-500/80">{t.noticeFoot}</span>
        </div>
      </div>
    );
  }

  const isAi = m.sender_kind === 'ai';
  const agent = isAi && m.agent_mode ? agentById.get(m.agent_mode) : undefined;
  return (
    <div className="flex gap-2.5">
      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[0.75rem] font-semibold ${
        isAi ? 'border border-[#000080]/25 bg-white text-[#000080] dark:bg-gray-900 dark:text-blue-300'
             : 'bg-stone-200 text-stone-600 dark:bg-gray-700 dark:text-gray-300'
      }`}>
        {isAi ? (agent?.avatar ?? 'AI') : (m.sender_name ?? '·').slice(0, 1)}
      </span>
      <div className="min-w-0">
        <p className="mb-1 text-[0.6875rem] text-stone-500 dark:text-gray-500">
          <b className="text-[0.75rem] font-semibold text-stone-700 dark:text-gray-300">
            {isAi ? (agent ? (lang === 'zh' ? agent.nameZh : agent.nameEn) : 'AI') : (m.sender_name ?? '')}
          </b>
          {isAi && (
            <span className="ml-1.5 rounded-full border border-[#000080]/20 bg-[#000080]/[0.06] px-1.5 font-mono text-[0.625rem] text-[#000080] dark:text-blue-300">AI</span>
          )}
        </p>
        <div className={`max-w-[46ch] rounded-r-2xl rounded-bl-2xl border px-3.5 py-2.5 text-[0.7812rem] leading-relaxed ${
          isAi ? 'border-[#e2e2ee] bg-[#fdfdff] text-stone-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
               : 'border-stone-200 bg-white text-stone-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
        }`}>
          {m.content}
        </div>
      </div>
    </div>
  );
};

export default RiseAboveRoom;
