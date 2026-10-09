/**
 * 文档 AI 侧栏 —— 只读**当前打开的这份文档**，基于它跟学生对话。
 *
 * 和知识空间的 AI 助手分工不同：那个面向整个空间的讨论，这个面向手头这一份材料。
 * 学生读到看不懂的一段，不必先把它复制到别处再去问。
 *
 * 它的输出不是终点。两个动作让它进入公共话语：
 *   引用到笔记 —— 变成画布上一条可被 Build-on 的笔记；
 *   存为批注   —— 挂回文档里那一段，同伴读到时就在旁边。
 * 只让它在侧栏里说话，等于又造了一个私聊窗口，那不是知识建构。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Loader2, Sparkles, Send, History, Plus } from 'lucide-react';
import { ai as aiApi, documents as docsApi, type ApiAIConfig, type DocChatThread, type PreviousDrawingPayload } from '../services/apiClient';
import { MORANDI, chipStyle, ink } from './morandiPalette';
import type { Language } from '../types';
import { chooseDrawing } from './drawRouting';
import DrawingProgress from './DrawingProgress';

interface Props {
  /** 附件笔记 id。有它才能留存对话与读历史。 */
  noteId?: string;
  courseId?: string;
  docTitle: string;
  /**
   * 文档正文。undefined = 还在取（此时不让提问，否则 AI 会回答「读不到这份文档」）；
   * '' = 取到了但没有文字（扫描版 PDF）；字符串 = 就绪。
   */
  docText: string | undefined;
  /**
   * true = 目前用的是本地粗略抽取的文字，MinerU 的结构化解析还在后台跑。
   * 要如实说出来：AI 此刻读到的双栏论文是左右交错的一团，答得不准是可以预期的。
   */
  refining?: boolean;
  progress?: { done: number; total: number } | null;
  lang: Language;
  onQuoteToNote?: (text: string) => Promise<void> | void;
  onSaveAsAnnotation?: (text: string) => Promise<void> | void;
  /** 表格（Excel、CSV）：示例问题换成看数据的，「核心主张」对一张成绩表没有意义 */
  isSpreadsheet?: boolean;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  /** 这条回复是 AI 画的图：留着当时的原话和规划，下一句要改它时带回服务端 */
  drawing?: PreviousDrawingPayload;
}

/** AI 的回复本来就带 markdown。按纯文本渲染，学生看到的是一堆星号。 */
const AiMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }) as string),
    [text],
  );
  return <div className="md-chat text-[0.75rem] leading-6 text-zinc-800 dark:text-gray-200" dangerouslySetInnerHTML={{ __html: html }} />;
};

/** 上下文里放多少字。整本书塞进去既贵又没用，前若干字足以支撑讨论。 */
const MAX_CONTEXT = 12_000;

/**
 * 回复长度上限。服务端默认 400，那是给画布上「一句话加一个追问」用的；
 * 对着一份文档解释核心主张还要引一段原文，中文两三百字就到顶，
 * 线上出现过回答断在半句上。
 */
const MAX_REPLY_TOKENS = 1500;

const DocAiPanel: React.FC<Props> = ({ noteId, courseId, docTitle, docText, refining, progress, lang, onQuoteToNote, onSaveAsAnnotation, isSpreadsheet = false }) => {
  const zh = lang === 'zh';
  const [configs, setConfigs] = useState<ApiAIConfig[] | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  /** 这一轮是在画图（「画一张……」）：等待时放绘图动画，不显示「正在读这份文档」 */
  const [drawing, setDrawing] = useState<{ prompt: string; startedAt: number; mode?: 'new' | 'edit' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 历史对话。学生要能回头看自己问过什么 —— 关掉页面就没了的话，
  // 这些提问既帮不到他复习，也进不了研究数据。
  const [threads, setThreads] = useState<DocChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    docsApi.chatHistory(noteId)
      .then(({ threads: rows }) => {
        if (cancelled) return;
        setThreads(rows);
        const latest = rows[0];
        if (latest) {
          setThreadId(latest.id);
          setMessages(latest.messages.map(m => ({ role: m.role, content: m.content })));
        }
      })
      .catch(() => { /* 读不到历史不影响新的提问 */ });
    return () => { cancelled = true; };
  }, [noteId]);

  useEffect(() => {
    if (!courseId) { setConfigs([]); return; }
    let cancelled = false;
    aiApi.listConfigs(courseId)
      .then(({ configs: rows }) => { if (!cancelled) setConfigs(rows); })
      .catch(() => { if (!cancelled) setConfigs([]); });
    return () => { cancelled = true; };
  }, [courseId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  // 用哪个模型由课程 AI 设置里「文档 AI 助手」那一行定（没指定时先 DeepSeek Flash），
  // 后端按 'auto' 解析；这里只判断这门课有没有可用的 AI。以前取的是库里排第一的那个配置。
  const hasAi = useCallback(
    () => (configs ?? []).some(c => c.isVerified && c.enabledModels.length > 0),
    [configs],
  );

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    // 正文还没到手就先别问：拿着空文档去问，模型只会回答「这份文档读不到」，
    // 而那不是真的 —— 它只是还没被送进去。
    if (!question || sending || !courseId || docText === undefined) return;
    if (!hasAi()) {
      setError(zh ? '这门课还没有配置可用的 AI 服务。' : 'No AI provider is configured for this course.');
      return;
    }
    setError(null);
    setSending(true);
    const last = messages[messages.length - 1];
    const previous = last?.role === 'assistant' && last.drawing ? last.drawing : null;
    const next: Msg[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setInput('');
    try {
      let reply: string;
      let usedProvider: string;
      let usedModel: string;
      let drew: PreviousDrawingPayload | undefined;
      // 要不要画、改上一张还是新画：服务端的 Jev 判断（drawRouting.ts），和图不沾边的句子不问
      const choice = await chooseDrawing(question, {
        previous,
        lastReply: !previous && last?.role === 'assistant' ? last.content : null,
      });
      if (choice.draw) {
        // 要画就直接出图，不经对话模型。带上文档和这段对话：服务端先读它们弄清楚要画什么（2026-10-09）
        setDrawing({ prompt: question, startedAt: Date.now(), mode: choice.mode });
        const out = await aiApi.image({
          course_id: courseId, prompt: question, feature: 'doc_ai',
          context: {
            title: docTitle,
            text: docText.slice(0, 6000),
            history: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
            ...(choice.mode === 'edit' && previous ? { previous } : {}),
          },
          mode: choice.mode,
          form: choice.form,
          ...(choice.route ? { route: choice.route } : {}),
        });
        ({ markdown: reply, provider_id: usedProvider, model: usedModel } = out);
        drew = {
          request: question,
          caption: out.caption ?? '',
          kind: out.drawing?.kind ?? out.kind ?? 'picture',
          ...(out.drawing?.prompt ? { prompt: out.drawing.prompt } : {}),
          ...(out.drawing?.diagram ? { diagram: out.drawing.diagram } : {}),
        };
      } else {
        const excerpt = docText.slice(0, MAX_CONTEXT);
        const truncated = docText.length > MAX_CONTEXT;
        ({ reply, provider_id: usedProvider, model: usedModel } = await aiApi.chat({
          course_id: courseId,
          provider_id: 'auto',
          model: 'auto',
          feature: 'doc_ai',
          system_prompt: [
            'You are helping a learner read one specific document inside a Knowledge Building classroom.',
            'Answer strictly from the document below. If the answer is not in it, say so plainly instead of guessing.',
            'Be concise. Prefer pointing the learner to the passage that matters over summarising everything.',
            'End with one question that could turn this into a public idea their classmates can build on.',
            'Reply in the language the learner used.',
            truncated ? 'NOTE: only the beginning of the document is included; say so if the answer may lie further in.' : '',
            `--- DOCUMENT: ${docTitle} ---`,
            excerpt || '(no readable text could be extracted from this document)',
          ].filter(Boolean).join('\n\n'),
          max_tokens: MAX_REPLY_TOKENS,
          messages: next.map(m => ({ role: m.role, content: m.content })),
        }));
      }
      setMessages(prev => [...prev, { role: 'assistant', content: reply, ...(drew ? { drawing: drew } : {}) }]);

      // 留存这一轮。失败不打断对话 —— 但会在研究数据里留下缺口，所以要记日志。
      if (noteId) {
        docsApi.recordChatTurn(noteId, {
          question, answer: reply, thread_id: threadId,
          // 记实际回答的那个模型（后端解析 'auto' 后回传的）
          provider_id: usedProvider, model: usedModel,
        })
          .then(({ thread_id }) => setThreadId(thread_id))
          .catch(err => console.error('[DocAiPanel] 对话未能留存:', err));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? '没能取到回复' : 'Could not get a reply'));
      setMessages(prev => prev.slice(0, -1));
      setInput(question);
    } finally {
      setSending(false);
      setDrawing(null);
    }
  }, [courseId, docText, docTitle, hasAi, messages, noteId, sending, threadId, zh]);

  const loadingDoc = docText === undefined;

  const suggestions = isSpreadsheet
    ? (zh
      ? ['这张表有哪些列，各记的是什么？', '数据里有什么明显的规律？', '有没有看起来不对劲的数？']
      : ['What do the columns record?', 'What patterns stand out in the data?', 'Do any numbers look off?'])
    : (zh
      ? ['这份文档的核心主张是什么？', '哪些地方缺少证据支撑？', '有哪些说法是可以被质疑的？']
      : ['What is the central claim here?', 'Where is the evidence thin?', 'What could be challenged?']);

  const noText = docText !== undefined && docText.trim().length === 0;

  // min-h-0 flex-1 而不是 h-full：h-full 是 height:100%，要求父级有**指定**高度，
  // 而侧栏的高度是 flex 算出来的，解析不了 —— 面板会被撑到内容全高，
  // 于是列表滚不动、底部的输入框被挤出可视范围。
  const startNewThread = () => {
    setThreadId(null);
    setMessages([]);
    setShowHistory(false);
    setError(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(threads.length > 0 || messages.length > 0) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-gray-800">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.6875rem] text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <History size={12} />
            {zh ? '历史对话' : 'History'}
            {threads.length > 0 && <span className="text-zinc-400">{threads.length}</span>}
          </button>
          <button
            onClick={startNewThread}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.6875rem] text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <Plus size={12} />{zh ? '新对话' : 'New'}
          </button>
        </div>
      )}

      {showHistory && (
        <div className="max-h-52 shrink-0 overflow-y-auto border-b border-zinc-200 bg-white px-2 py-2 dark:border-gray-800 dark:bg-gray-950">
          {threads.length === 0 && (
            <p className="px-1.5 py-1 text-[0.6875rem] text-zinc-400">{zh ? '还没有历史对话' : 'No past conversations'}</p>
          )}
          {threads.map(t => (
            <button
              key={t.id}
              onClick={() => {
                setThreadId(t.id);
                setMessages(t.messages.map(m => ({ role: m.role, content: m.content })));
                setShowHistory(false);
              }}
              className={`block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-gray-800 ${
                t.id === threadId ? 'bg-zinc-100 dark:bg-gray-800' : ''
              }`}
            >
              <span className="block truncate text-[0.75rem] text-zinc-800 dark:text-gray-200">
                {t.title || (zh ? '未命名对话' : 'Untitled')}
              </span>
              <span className="block text-[0.625rem] text-zinc-400">
                {new Date(t.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {' · '}{t.messages.length} {zh ? '条' : 'msgs'}
              </span>
            </button>
          ))}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {refining && !noText && (
          <div className="mb-2 rounded-xl border px-3 py-2 text-[0.6875rem] leading-5" style={chipStyle(MORANDI.dustyBlue)}>
            {zh ? '正在深度解析这份 PDF' : 'Parsing this PDF in depth'}
            {progress ? `（${progress.done}/${progress.total} 页）` : ''}
            {zh
              ? '。现在就可以提问，AI 读的是初步文字；解析完成后会自动换成更准确的版本。'
              : '. You can ask now — the AI is reading a rough extraction, and will switch to the better one automatically.'}
          </div>
        )}

        {noText && (
          <div className="mb-2 rounded-xl border px-3 py-2 text-[0.6875rem] leading-5" style={chipStyle(MORANDI.ochre)}>
            {zh
              ? '这份文档没能抽出文字（比如扫描版 PDF），AI 读不到内容，只能就你描述的部分讨论。'
              : 'No text could be extracted from this document, so the AI cannot read it.'}
          </div>
        )}

        {messages.length === 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 px-1 text-[0.75rem] leading-6 text-zinc-500">
              {loadingDoc && <Loader2 size={12} className="animate-spin" />}
              {loadingDoc
                ? (zh ? '正在读取这份文档⋯⋯' : 'Reading the document…')
                : (zh ? '这个 AI 只读当前这份文档。' : 'This assistant reads only the open document.')}
            </p>
            <div className="space-y-1.5">
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  disabled={loadingDoc}
                  className="block w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-left text-[0.75rem] text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className="mb-2.5">
            {m.role === 'user' ? (
              <div className="ml-6 rounded-xl bg-[#000080] px-3 py-2 text-[0.75rem] leading-6 text-white">{m.content}</div>
            ) : (
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
                <div className="mb-1 flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-wide" style={{ color: ink(MORANDI.lilac, 0.42) }}>
                  <Sparkles size={11} /> AI
                </div>
                <AiMarkdown text={m.content} />
                <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-100 pt-2 text-[0.6875rem] dark:border-gray-800">
                  {onSaveAsAnnotation && (
                    <button onClick={() => void onSaveAsAnnotation(m.content)} className="font-medium text-[#000080] hover:underline dark:text-[#93AAFD]">
                      {zh ? '存为批注' : 'Save as comment'}
                    </button>
                  )}
                  {onQuoteToNote && (
                    <button onClick={() => void onQuoteToNote(m.content)} className="font-medium text-[#000080] hover:underline dark:text-[#93AAFD]">
                      {zh ? '引用到笔记' : 'Quote to a note'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {sending && drawing && (
          <div className="mb-2.5">
            <DrawingProgress prompt={drawing.prompt} lang={lang} startedAt={drawing.startedAt} mode={drawing.mode} />
          </div>
        )}
        {sending && !drawing && (
          <div className="flex items-center gap-1.5 px-1 text-[0.6875rem] text-zinc-400">
            <Loader2 size={12} className="animate-spin" /> {zh ? '正在读这份文档⋯⋯' : 'Reading the document…'}
          </div>
        )}

        {error && (
          <div className="mt-2 rounded-lg border px-2.5 py-1.5 text-[0.6875rem]" style={chipStyle(MORANDI.rose)}>{error}</div>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-200 p-2.5 dark:border-gray-800">
        <div className="flex items-end gap-1.5">
          <textarea
            rows={2}
            value={input}
            maxLength={1000}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); }
            }}
            disabled={loadingDoc}
            placeholder={loadingDoc
              ? (zh ? '正在读取文档⋯⋯' : 'Reading the document…')
              : (zh ? '就这份文档提问⋯⋯' : 'Ask about this document…')}
            className="min-w-0 flex-1 resize-none rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[0.75rem] outline-none focus:border-[#000080]/50 dark:border-gray-700 dark:bg-gray-900"
          />
          <button
            onClick={() => void send(input)}
            disabled={sending || loadingDoc || !input.trim()}
            aria-label={zh ? '发送' : 'Send'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#000080] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>
        {configs !== null && configs.length === 0 && (
          <p className="mt-1.5 text-[0.625rem] text-zinc-400">
            {zh ? '这门课尚未配置 AI 服务。' : 'No AI provider configured for this course.'}
          </p>
        )}
      </div>
    </div>
  );
};

export default DocAiPanel;
