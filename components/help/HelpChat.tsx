import React, { useCallback, useEffect, useRef, useState } from 'react';
import RemixIcon from '../RemixIcon';
import MarkdownMessage from '../chatMarkdown';
import { MORANDI, noticeStyle, solidStyle } from '../morandiPalette';
import { support, clientSessionId, clientVersion, type SupportQuestion } from '../../services/apiClient';
import { recentFailures } from '../../services/clientDiagnostics';
import { quickQuestions, readGrounding, type HelpLang, type HelpSurface } from './helpWidgetModel';

/**
 * 使用帮助的对话：平台怎么用的问题。
 *
 * 和知识建构的 AI 助手分开是有意的。那个是教学伙伴，职责是不替学生想；
 * 这个恰恰相反——「贡献按钮在哪」这种问题就该直接给答案，
 * 让它反问「你觉得应该在哪呢」是荒谬的。
 *
 * AI 先按使用手册答，答不了或学生说没解决，一键转教师。教师不该被「按钮在哪」淹掉，
 * 而这些常见问答本身就是要攒的语料：给平台改进用，也给下一届当现成答案。
 */

type Shot = { file_url: string; file_name: string; mime_type: string };

const MAX_SHOTS = 3;
const MAX_SHOT_BYTES = 8 * 1024 * 1024;

export interface HelpChatProps {
  courseId: string;
  lang: HelpLang;
  compact: boolean;
  surface: HelpSurface;
  spaceId: string | null;
  /** 页面报上来的处境（页面、空间、视图……），和浏览器处境合在一起随问题存下 */
  pageContext: Record<string, unknown>;
  /** 每次打开面板加一，重新拉一遍历史：老师可能刚回复过 */
  refreshKey: number;
  autoFocus: boolean;
}

/**
 * 采集提问时的处境。只存一句「保存不了」，下一届看到也没法复用；
 * 得知道他当时在哪个页面、屏幕多宽、前一刻哪个接口报了什么错。
 * 只收技术处境，不收姓名邮箱：表里已有 user_id，语料本身不该再夹带一份。
 */
function browserContext(): Record<string, unknown> {
  return {
    path: window.location.pathname,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    userAgent: navigator.userAgent.slice(0, 300),
    language: navigator.language,
    at: new Date().toISOString(),
    sessionId: clientSessionId,
    clientVersion,
    recentFailures: recentFailures(),
  };
}

const COPY = {
  zh: {
    welcome: '平台怎么用、按钮在哪、点了没反应，都可以在这里问。我按使用手册回答；手册里没写到的，可以一键转给老师。',
    quick: '常见问题',
    placeholder: '写下你的问题，回车发送',
    send: '发送',
    thinking: '正在查使用手册',
    waited: (n: number) => `${n} 秒`,
    assistant: '使用帮助',
    teacher: '老师',
    solved: '解决了',
    notSolved: '没解决，转给老师',
    escalate: '转给老师',
    escalateHint: '补充一句会让老师更快定位（可留空）',
    cancel: '取消',
    resolved: '已解决',
    waiting: '已转给老师，老师回复后会显示在这里',
    answered: '老师已回复',
    noAi: '这个问题 AI 暂时没能回答，已经转给老师。老师回复后会显示在这里。',
    sources: '参考使用手册',
    teacherSource: '老师以前的回答',
    addShot: '加截图',
    shotHint: '可以直接粘贴截图',
    contextNote: '提问会附带你所在的页面等信息，方便定位问题。',
    desktopNote: '可以直接粘贴截图（⌘V / Ctrl+V）。提问会附带你所在的页面等信息，方便定位问题。',
    tooManyShots: `最多 ${MAX_SHOTS} 张截图。`,
    notAnImage: '只能上传图片。',
    tooBig: '图片超过 8MB。',
    remove: '移除截图',
    loadFailed: '以前的提问没能加载。',
    failed: '没能发出去，请再试一次。',
    dismiss: '关闭提示',
  },
  en: {
    welcome: 'Ask here how to use the platform: where a button is, why something does nothing. I answer from the user manual, and anything it does not cover can go to your teacher in one click.',
    quick: 'Common questions',
    placeholder: 'Type your question, Enter to send',
    send: 'Send',
    thinking: 'Checking the manual',
    waited: (n: number) => `${n}s`,
    assistant: 'Help',
    teacher: 'Teacher',
    solved: 'This solved it',
    notSolved: 'Not solved, ask the teacher',
    escalate: 'Send to teacher',
    escalateHint: 'One more line helps the teacher (optional)',
    cancel: 'Cancel',
    resolved: 'Resolved',
    waiting: 'Sent to your teacher. Their reply will appear here.',
    answered: 'Teacher replied',
    noAi: 'The AI could not answer this, so it went to your teacher. Their reply will appear here.',
    sources: 'From the manual',
    teacherSource: "a teacher's earlier answer",
    addShot: 'Screenshot',
    shotHint: 'You can paste a screenshot',
    contextNote: 'Your current page and similar details are sent along to help locate the problem.',
    desktopNote: 'You can paste a screenshot (⌘V / Ctrl+V). Your current page and similar details are sent along to help locate the problem.',
    tooManyShots: `Up to ${MAX_SHOTS} screenshots.`,
    notAnImage: 'Images only.',
    tooBig: 'Image is larger than 8MB.',
    remove: 'Remove screenshot',
    loadFailed: 'Earlier questions could not be loaded.',
    failed: 'That did not go through. Please try again.',
    dismiss: 'Dismiss',
  },
};

type Copy = typeof COPY.zh;

function formatTime(iso: string, lang: HelpLang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === new Date().toDateString()) return hm;
  return lang === 'zh'
    ? `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
    : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${hm}`;
}

const BUBBLE = 'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words';

function AssistantRow({ label, icon = 'customer-service-2-line', teacher = false, children }: {
  label: string; icon?: string; teacher?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${teacher
          ? 'bg-[#000080] text-white dark:bg-[#4169E1]'
          : 'bg-[#000080]/[0.08] text-[#000080] dark:bg-[#93AAFD]/15 dark:text-[#93AAFD]'}`}
      >
        <RemixIcon name={icon} size={14} />
      </span>
      <div
        role="group"
        aria-label={label}
        className={`${BUBBLE} rounded-tl-md border ${teacher
          ? 'border-[#000080]/15 bg-[#000080]/[0.04] text-zinc-800 dark:border-[#93AAFD]/25 dark:bg-[#93AAFD]/10 dark:text-gray-100'
          : 'border-zinc-200 bg-white text-zinc-800 shadow-[0_1px_2px_rgba(24,24,27,0.04)] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100'}`}
      >
        {children}
      </div>
    </div>
  );
}

function UserRow({ text, shots }: { text: string; shots: Shot[] }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {shots.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {shots.map(s => (
            <a key={s.file_url} href={s.file_url} target="_blank" rel="noopener noreferrer"
              className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080]">
              <img src={s.file_url} alt={s.file_name}
                className="size-16 rounded-lg border border-zinc-200 object-cover transition-opacity hover:opacity-85 dark:border-gray-700" />
            </a>
          ))}
        </div>
      )}
      <div className={`${BUBBLE} whitespace-pre-wrap rounded-br-md bg-[#000080] text-white dark:bg-[#4169E1]`}>{text}</div>
    </div>
  );
}

function StatusLine({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 pl-9 text-[0.75rem] text-zinc-500 dark:text-gray-400">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={solidStyle(tone)} />
      {children}
    </p>
  );
}

/**
 * 展开「转给老师」时整块滚进视野再聚焦。直接 autoFocus 的话浏览器只滚到输入框，
 * 下面的「转给老师」「取消」还压在输入区底下，学生看不到按钮。
 */
function revealEscalateForm(el: HTMLDivElement | null) {
  if (!el) return;
  el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  el.querySelector('textarea')?.focus({ preventScroll: true });
}

const ghostButton = 'inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-[0.8125rem] font-medium text-zinc-700 transition-all duration-200 hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] sm:min-h-9 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
const primaryButton = 'inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#000080] px-3.5 text-[0.8125rem] font-semibold text-white transition-all duration-200 hover:bg-[#00006a] active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] sm:min-h-9 dark:bg-[#4169E1] dark:hover:bg-[#3457D5] dark:focus-visible:outline-[#93AAFD]';

function Exchange({ q, lang, t, busy, escalating, escalateNote, onEscalateNote, onStartEscalate, onCancelEscalate, onRespond }: {
  q: SupportQuestion;
  lang: HelpLang;
  t: Copy;
  busy: boolean;
  escalating: boolean;
  escalateNote: string;
  onEscalateNote: (value: string) => void;
  onStartEscalate: () => void;
  onCancelEscalate: () => void;
  onRespond: (payload: { resolved?: boolean; escalate?: boolean; note?: string }) => void;
}) {
  const grounding = readGrounding(q.context);
  const uncovered = grounding?.covered === false;
  const sources = [
    ...(grounding?.manual ?? []).map(m => `${m.num} ${m.title}`.trim()),
    ...(grounding && grounding.teacherAnswers > 0 ? [t.teacherSource] : []),
  ];

  return (
    <li className="space-y-2">
      <p className="text-center text-[0.6875rem] text-zinc-400 dark:text-gray-500">{formatTime(q.createdAt, lang)}</p>
      <UserRow text={q.question} shots={q.attachments ?? []} />

      {q.aiAnswer ? (
        <AssistantRow label={t.assistant}>
          <MarkdownMessage content={q.aiAnswer} />
          {sources.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 border-t border-zinc-100 pt-2 text-[0.6875rem] text-zinc-500 dark:border-gray-800 dark:text-gray-400">
              <RemixIcon name="book-read-line" size={12} />
              <span>{t.sources}</span>
              <span className="font-medium text-zinc-600 dark:text-gray-300">{sources.join(' · ')}</span>
            </p>
          )}
        </AssistantRow>
      ) : (
        <AssistantRow label={t.assistant}>
          <p className="text-zinc-600 dark:text-gray-300">{t.noAi}</p>
        </AssistantRow>
      )}

      {q.teacherAnswer && (
        <AssistantRow label={t.teacher} icon="user-star-line" teacher>
          <p className="mb-1 text-[0.6875rem] font-semibold text-[#000080] dark:text-[#93AAFD]">
            {t.teacher}{q.teacherAnsweredAt ? ` · ${formatTime(q.teacherAnsweredAt, lang)}` : ''}
          </p>
          <p className="whitespace-pre-wrap">{q.teacherAnswer}</p>
        </AssistantRow>
      )}

      {/* 只在「AI 答了但学生还没表态」时问一句。这一表态是语料质量的关键：
          没有它就分不清「AI 答对了」和「答了但没用」。 */}
      {q.status === 'ai_answered' && q.aiAnswer && (
        escalating ? (
          <div ref={revealEscalateForm} className="space-y-2 pl-9">
            <textarea
              value={escalateNote}
              onChange={e => onEscalateNote(e.target.value)}
              placeholder={t.escalateHint}
              aria-label={t.escalateHint}
              rows={2}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-base leading-6 text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/10 sm:text-[0.8125rem] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-[#93AAFD]"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={primaryButton}
                onClick={() => onRespond({ escalate: true, note: escalateNote })}>
                <RemixIcon name="mail-send-line" size={14} />{t.escalate}
              </button>
              <button type="button" disabled={busy} className={ghostButton} onClick={onCancelEscalate}>{t.cancel}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pl-9">
            {uncovered ? (
              <button type="button" disabled={busy} className={primaryButton} onClick={onStartEscalate}>
                <RemixIcon name="mail-send-line" size={14} />{t.escalate}
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} className={ghostButton} onClick={() => onRespond({ resolved: true })}>
                  <RemixIcon name="check-line" size={14} />{t.solved}
                </button>
                <button type="button" disabled={busy} className={ghostButton} onClick={onStartEscalate}>{t.notSolved}</button>
              </>
            )}
          </div>
        )
      )}

      {q.status === 'resolved' && <StatusLine tone={MORANDI.sage}>{t.resolved}</StatusLine>}
      {q.status === 'escalated' && <StatusLine tone={MORANDI.ochre}>{t.waiting}</StatusLine>}
      {q.status === 'teacher_answered' && <StatusLine tone={MORANDI.dustyBlue}>{t.answered}</StatusLine>}
    </li>
  );
}

const HelpChat: React.FC<HelpChatProps> = ({ courseId, lang, compact, surface, spaceId, pageContext, refreshKey, autoFocus }) => {
  const t = COPY[lang];
  const [items, setItems] = useState<SupportQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ question: string; shots: Shot[] } | null>(null);
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  /** 截图。文字说不清「哪个面板」，一张图就说清了。 */
  const [shots, setShots] = useState<Shot[]>([]);
  const [uploading, setUploading] = useState(false);
  const [escalatingId, setEscalatingId] = useState<string | null>(null);
  const [escalateNote, setEscalateNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // 接口按新到旧给，对话按旧到新排
  useEffect(() => {
    let cancelled = false;
    support.mine(courseId)
      .then(({ questions }) => { if (!cancelled) setItems([...questions].reverse()); })
      .catch(() => { if (!cancelled) setError(t.loadFailed); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [courseId, refreshKey, t.loadFailed]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, pending, loading]);

  // 等待时的秒表：快速档几秒就回来，超过三秒才显示，免得一闪而过
  useEffect(() => {
    if (!pending) { setWaited(0); return; }
    const started = Date.now();
    const id = window.setInterval(() => setWaited(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [pending]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  /** 选图和粘贴走同一条路。粘贴才是截图的自然动作，别只留一个文件选择器。 */
  const addImage = useCallback(async (file: File) => {
    if (shots.length >= MAX_SHOTS) { setError(t.tooManyShots); return; }
    if (!file.type.startsWith('image/')) { setError(t.notAnImage); return; }
    if (file.size > MAX_SHOT_BYTES) { setError(t.tooBig); return; }

    setUploading(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const { attachment } = await support.uploadImage({
        course_id: courseId,
        file_name: file.name || `screenshot-${Date.now()}.png`,
        mime_type: file.type,
        data_url: dataUrl,
      });
      setShots(prev => [...prev, attachment].slice(0, MAX_SHOTS));
    } catch (e) {
      setError(e instanceof Error ? e.message : t.failed);
    } finally {
      setUploading(false);
    }
  }, [courseId, shots.length, t]);

  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) { e.preventDefault(); void addImage(file); }
  };

  const ask = async (preset?: string) => {
    const question = (preset ?? input).trim();
    if (!question || pending) return;
    const sentShots = shots;
    setPending({ question, shots: sentShots });
    setError(null);
    setShots([]);
    if (!preset) setInput('');
    if (inputRef.current) inputRef.current.style.height = '';
    try {
      const { question: created } = await support.ask({
        course_id: courseId,
        space_id: spaceId ?? undefined,
        question,
        context: { ...browserContext(), ...pageContext },
        attachments: sentShots,
      });
      // 等回答时收起再打开，重新拉的历史里可能已经有这一条了
      setItems(prev => (prev.some(q => q.id === created.id) ? prev : [...prev, created]));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t.failed);
      if (!preset) setInput(question);
      setShots(sentShots);
    } finally {
      setPending(null);
    }
  };

  const respond = async (id: string, payload: { resolved?: boolean; escalate?: boolean; note?: string }) => {
    setBusyId(id);
    setError(null);
    try {
      const { question } = await support.respond(id, payload);
      setItems(prev => prev.map(q => (q.id === question.id ? question : q)));
      setEscalatingId(null);
      setEscalateNote('');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t.failed);
    } finally {
      setBusyId(null);
    }
  };

  const chips = quickQuestions(surface, lang, compact);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-busy={pending ? true : undefined}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-zinc-50 px-4 py-4 dark:bg-gray-950"
      >
        <AssistantRow label={t.assistant}>
          <p>{t.welcome}</p>
        </AssistantRow>

        {!loading && (
          <div className="pl-9">
            <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-zinc-400 dark:text-gray-500">{t.quick}</p>
            <div className="flex flex-wrap gap-2">
              {chips.map(chip => (
                <button
                  key={chip}
                  type="button"
                  disabled={!!pending}
                  onClick={() => void ask(chip)}
                  className="min-h-10 rounded-full border border-[#000080]/15 bg-white px-3.5 text-left text-[0.8125rem] text-[#000080] transition-all duration-200 hover:border-[#000080]/35 hover:bg-[#000080]/[0.04] active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] sm:min-h-9 dark:border-[#93AAFD]/25 dark:bg-gray-900 dark:text-[#93AAFD] dark:hover:bg-[#93AAFD]/10"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div aria-hidden="true" className="space-y-3">
            <div className="ml-auto h-10 w-2/3 animate-pulse rounded-2xl rounded-br-md bg-zinc-200/70 dark:bg-gray-800" />
            <div className="ml-9 h-16 w-3/4 animate-pulse rounded-2xl rounded-tl-md bg-zinc-200/70 dark:bg-gray-800" />
          </div>
        ) : (
          <ul className="space-y-5">
            {items.map(q => (
              <Exchange
                key={q.id}
                q={q}
                lang={lang}
                t={t}
                busy={busyId === q.id}
                escalating={escalatingId === q.id}
                escalateNote={escalateNote}
                onEscalateNote={setEscalateNote}
                onStartEscalate={() => { setEscalatingId(q.id); setEscalateNote(''); }}
                onCancelEscalate={() => { setEscalatingId(null); setEscalateNote(''); }}
                onRespond={payload => void respond(q.id, payload)}
              />
            ))}
          </ul>
        )}

        {pending && (
          <div className="space-y-2">
            <UserRow text={pending.question} shots={pending.shots} />
            <AssistantRow label={t.assistant}>
              <p className="flex items-center gap-2 text-zinc-500 dark:text-gray-400">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="size-1.5 animate-bounce rounded-full motion-reduce:animate-none bg-[#000080]/50 [animation-delay:-0.3s] dark:bg-[#93AAFD]/60" />
                  <span className="size-1.5 animate-bounce rounded-full motion-reduce:animate-none bg-[#000080]/50 [animation-delay:-0.15s] dark:bg-[#93AAFD]/60" />
                  <span className="size-1.5 animate-bounce rounded-full motion-reduce:animate-none bg-[#000080]/50 dark:bg-[#93AAFD]/60" />
                </span>
                {t.thinking}
                {waited >= 3 && <span className="font-mono text-[0.75rem] tabular-nums">{t.waited(waited)}</span>}
              </p>
            </AssistantRow>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mx-4 mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-[0.8125rem]" style={noticeStyle(MORANDI.rose)}>
          <RemixIcon name="error-warning-line" size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t.dismiss}
            className="-m-1 grid size-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-black/5">
            <RemixIcon name="close-line" size={14} />
          </button>
        </div>
      )}

      <form
        className="shrink-0 border-t border-zinc-200 bg-white px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] dark:border-gray-800 dark:bg-gray-900"
        onSubmit={e => { e.preventDefault(); void ask(); }}
      >
        {shots.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {shots.map((shot, i) => (
              <div key={shot.file_url} className="group relative">
                <img src={shot.file_url} alt={shot.file_name}
                  className="size-14 rounded-lg border border-zinc-200 object-cover dark:border-gray-700" />
                <button
                  type="button"
                  onClick={() => setShots(prev => prev.filter((_, j) => j !== i))}
                  aria-label={`${t.remove}: ${shot.file_name}`}
                  className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-zinc-900/80 text-white transition-opacity hover:bg-zinc-900 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                >
                  <RemixIcon name="close-line" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5 rounded-2xl border border-zinc-200 bg-zinc-50 p-1.5 transition-colors focus-within:border-[#000080]/50 focus-within:bg-white focus-within:ring-2 focus-within:ring-[#000080]/10 dark:border-gray-700 dark:bg-gray-950 dark:focus-within:border-[#93AAFD]/60 dark:focus-within:bg-gray-900">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void addImage(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || shots.length >= MAX_SHOTS}
            aria-label={t.addShot}
            title={`${t.addShot} · ${t.shotHint}`}
            className="grid size-10 shrink-0 place-items-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[#000080] sm:size-9 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            <RemixIcon name={uploading ? 'loader-4-line' : 'image-add-line'} size={18} className={uploading ? 'animate-spin' : ''} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onPaste={onPaste}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={e => {
              // 中文输入法选词时的回车不是发送
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void ask();
              }
            }}
            placeholder={t.placeholder}
            aria-label={t.placeholder}
            rows={1}
            className="max-h-40 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2 text-base leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 sm:min-h-9 sm:py-1.5 sm:text-[0.8125rem] dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <button
            type="submit"
            disabled={!!pending || !input.trim()}
            aria-label={t.send}
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#000080] text-white transition-all duration-200 hover:bg-[#00006a] active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#000080] sm:size-9 dark:bg-[#4169E1] dark:hover:bg-[#3457D5] dark:focus-visible:outline-[#93AAFD] dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
          >
            <RemixIcon name={pending ? 'loader-4-line' : 'send-plane-2-fill'} size={16} className={pending ? 'animate-spin' : ''} />
          </button>
        </div>
        <p className="mt-2 px-1 text-[0.6875rem] leading-4 text-zinc-400 dark:text-gray-500">
          {compact ? t.contextNote : t.desktopNote}
        </p>
      </form>
    </div>
  );
};

export default HelpChat;
