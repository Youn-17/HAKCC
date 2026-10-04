/**
 * WorkspaceAgentPanel — Unified workspace AI panel.
 *
 * Merges the old GenAIPanel (history / usage) with the agent chat.
 * Two tabs: Chat (agent with tools + SSE streaming) and History.
 * 平台怎么用的求助不在这里：它是全站右边缘的「使用帮助」小球（components/help），
 * 两个入口并存时学生分不清该去哪问。
 *
 * 介入触发已移到笔记详情面板（NoteAiPanel）：整空间一列检测结果看的人
 * 并不知道它们对应画布上的哪张卡片，按笔记归属之后才用得上。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import RemixIcon from './RemixIcon';
import AgentToolCallDisplay, { ToolCallInfo } from './AgentToolCallDisplay';
import DiscussionDigestPanel from './DiscussionDigest';
import { ai as aiApi, trackEvent, getAuthToken } from '../services/apiClient';
import { useDismissible } from '../hooks/useDismissible';
import { notes as notesApi } from '../services/apiClient';
import { uploadAttachment, MAX_ATTACHMENT_BYTES } from '../services/attachmentUpload';
import MarkdownMessage from './chatMarkdown';
import { modelOptionLabel } from './aiModelLabels';
import DrawingProgress from './DrawingProgress';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AIConfig {
  providerId: string;
  enabledModels?: string[];
}

export interface WorkspaceAgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  spaceId?: string;
  /** 当前 View，供讨论速览限定范围 */
  viewId?: string | null;
  /** 画布上多选的笔记 */
  selectedNoteIds?: string[];
  /** 空间里的全部笔记，供「选哪几条作上下文」用 */
  spaceNotes?: Array<{ id: string; title: string; author?: string }>;
  /** 学生所在小组 */
  groupId?: string | null;
  /** 点速览里的笔记 → 回画布定位 */
  onLocateNote?: (noteId: string) => void;
  userRole: 'student' | 'teacher' | 'admin';
  lang: 'en' | 'zh';
  aiConfigs?: AIConfig[];
  embedded?: boolean;
  /**
   * 从文档查看器带过来的文档：面板打开时挂到输入框上，学生直接提问。
   * 挂上之后调 onPendingAttachmentTaken 清掉，关了再开不会重复挂。
   */
  pendingAttachment?: { file_url: string; file_name: string; mime_type: string; text?: string } | null;
  onPendingAttachmentTaken?: () => void;
}

type PanelTab = 'chat' | 'history';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolCallInfo[];
}

interface HistoryEntry {
  id: string;
  trigger_type: string;
  provider_id: string;
  model_full_name: string;
  input_context_summary: string;
  response_text: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const AUTH_TOKEN_KEY = 'hakcc-access-token';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'ChatGPT', anthropic: 'Claude', google: 'Gemini', deepseek: 'DeepSeek',
  dmx: 'DMXAPI', dmxapi: 'DMXAPI', moonshot: 'Kimi', doubao: 'Doubao',
  xai: 'Grok', baidu: 'Wenxin', alibaba: 'Qwen', zhipu: 'Zhipu', openrouter: 'OpenRouter',
};


// 知识空间助手只有一种身份：模式选择连同 AgentMode / AGENT_MODES 一起删了。
// 那套模式是给单条笔记设计的，面对整个空间时既选不明白也用不上。
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: Record<string, unknown> | '[DONE]') => void,
) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') { onEvent('[DONE]'); continue; }
      try { onEvent(JSON.parse(data)); } catch { /* skip */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WorkspaceAgentPanel: React.FC<WorkspaceAgentPanelProps> = ({
  isOpen, onClose, courseId, spaceId, lang, aiConfigs, embedded,
  viewId, selectedNoteIds, groupId, onLocateNote, spaceNotes = [],
  pendingAttachment, onPendingAttachmentTaken,
}) => {
  // -- Panel width (resizable) ------------------------------------------------
  const [panelWidth, setPanelWidth] = useState(420);
  const isDragging = useRef(false);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX - ev.clientX;
      setPanelWidth(Math.max(320, Math.min(800, startWidth + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  // -- Tab state -------------------------------------------------------------
  const [activeTab, setActiveTab] = useState<PanelTab>('chat');

  // -- Chat state ------------------------------------------------------------
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  /** 这一轮是画图（后端识别出「画一张……」）：放绘图动画，图到了再换成图 */
  const [drawing, setDrawing] = useState<{ prompt: string; startedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  /** 勾了哪几条笔记当上下文。空 = 整个空间。 */
  const [contextNoteIds, setContextNoteIds] = useState<Set<string>>(new Set());
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [noteQuery, setNoteQuery] = useState('');
  const [attachments, setAttachments] = useState<Array<{ file_url: string; file_name: string; mime_type: string; text?: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notePickerRef = useRef<HTMLDivElement>(null);
  const [activeTools, setActiveTools] = useState<ToolCallInfo[]>([]);
  // 等待期间的秒表。推理模型可能十几二十秒才吐第一个字，光一个转圈学生分不清
  // 「在想」和「卡死了」—— 看得见秒数在走，就知道系统还活着。
  const [waitedSec, setWaitedSec] = useState(0);
  const [reasoningText, setReasoningText] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);

  // -- History state ---------------------------------------------------------
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);


  // -- Usage state -----------------------------------------------------------
  const [usageInfo, setUsageInfo] = useState<{ today: number; remaining: number; daily_limit: number } | null>(null);

  // -- Refs ------------------------------------------------------------------
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // -- Derived values --------------------------------------------------------
  const providers = useMemo(() => {
    if (!aiConfigs?.length) return [];
    return aiConfigs.filter((c) => (c.enabledModels?.length ?? 0) > 0);
  }, [aiConfigs]);

  const models = useMemo(() => {
    const config = providers.find((p) => p.providerId === selectedProvider);
    return config?.enabledModels ?? [];
  }, [providers, selectedProvider]);

  // -- i18n ------------------------------------------------------------------
  const t = useMemo(() => {
    const zh = lang === 'zh';
    return {
      title: zh ? '知识空间 AI 助手' : 'Knowledge Space AI',
      tabChat: zh ? '对话' : 'Chat',
      tabHistory: zh ? '历史' : 'History',
      send: zh ? '发送' : 'Send',
      thinking: zh ? '思考中…' : 'Thinking…',
      placeholder: zh ? '向 AI 助手提问关于工作台笔记的问题…' : 'Ask the AI agent about workspace notes…',
      provider: zh ? '服务商' : 'Provider',
      model: zh ? '模型' : 'Model',
      mode: zh ? '模式' : 'Mode',
      wholeSpace: zh ? '整个空间' : 'Whole space',
      picked: zh ? '已选' : 'Selected',
      searchNotes: zh ? '搜索笔记…' : 'Search notes…',
      selectAll: zh ? '全选' : 'All',
      clearSel: zh ? '清空' : 'Clear',
      pickHint: zh ? '不勾就是整个空间；勾了会把这几条的正文更完整地给 AI。'
                   : 'Nothing checked means the whole space. Checked notes are sent in fuller detail.',
      noNotes: zh ? '这个空间还没有笔记' : 'No notes in this space yet',
      attach: zh ? '上传图片或文件' : 'Attach an image or file',
      removeAttach: zh ? '移除' : 'Remove',
      noProvider: zh ? '未配置 AI 服务' : 'No AI provider configured',
      defaultModel: zh ? '默认（老师为本课设定）' : 'Default (set by your teacher)',
      selectModel: zh ? '选择模型' : 'Select model',
      deepThinking: zh ? '深度思考中...' : 'Deep thinking...',
      noHistory: zh ? '暂无历史对话' : 'No conversation history yet',
      loadingText: zh ? '加载中...' : 'Loading...',
      accept: zh ? '接受建议' : 'Accept',
      dismiss: zh ? '忽略' : 'Dismiss',
      accepted: zh ? '已接受' : 'Accepted',
      dismissed: zh ? '已忽略' : 'Dismissed',
      today: zh ? '今日' : 'Today',
      remaining: zh ? '剩余' : 'left',
    };
  }, [lang]);

  // -- Effects ---------------------------------------------------------------

  useEffect(() => {
    if (!streaming) { setWaitedSec(0); return; }
    const started = Date.now();
    const id = window.setInterval(() => setWaitedSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [streaming]);

  // 默认选「默认」：用老师在课程 AI 设置里给知识空间 AI 助手定的模型（后端按 'auto' 解析）。
  // 以前默认是库里排第一的那家配置的第一个模型，可能正好是最慢的 DMX。
  useEffect(() => {
    if (providers.length > 0 && !selectedProvider) {
      setSelectedProvider('auto');
      setSelectedModel('auto');
    }
  }, [providers, selectedProvider]);

  useEffect(() => {
    if (models.length > 0 && !models.includes(selectedModel)) {
      setSelectedModel(models[0]);
    }
  }, [models, selectedModel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTools, reasoningText]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 350);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !pendingAttachment) return;
    setAttachments(prev => (prev.some(a => a.file_url === pendingAttachment.file_url)
      ? prev
      : [...prev, pendingAttachment].slice(-4)));
    setActiveTab('chat');
    onPendingAttachmentTaken?.();
  }, [isOpen, pendingAttachment, onPendingAttachmentTaken]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Load usage info
  useEffect(() => {
    if (isOpen && courseId) {
      aiApi.usage(courseId).then((r) => setUsageInfo(r.usage)).catch(() => {});
    }
  }, [isOpen, courseId, messages.length]);

  // Load history when tab switches to history
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { history } = await aiApi.history({ space_id: spaceId, limit: 50 });
      setHistoryEntries(history);
    } catch { /* silent */ } finally {
      setLoadingHistory(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab, loadHistory]);

  // -- Handlers --------------------------------------------------------------

  /** 传图片或文件给助手。正文交给服务端抽，前后端各写一套判断迟早不一致。 */
  useDismissible({ open: notePickerOpen, onDismiss: () => setNotePickerOpen(false), ref: notePickerRef });

  const handlePickFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !spaceId) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(lang === 'zh'
        ? `文件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB。`
        : `File is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      // 直传存储，字节不经过 API
      const uploaded = await uploadAttachment(spaceId, file, {
        extractText: !file.type.startsWith('image/'),
      });
      setAttachments(prev => [...prev, {
        file_url: uploaded.file_url,
        file_name: uploaded.file_name,
        mime_type: uploaded.mime_type,
        text: uploaded.text ?? undefined,
      }].slice(-4));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [spaceId, lang]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if ((!content && attachments.length === 0) || streaming) return;
    if (!selectedProvider || !selectedModel) { setError(t.noProvider); return; }

    const turnAttachments = attachments;
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setAttachments([]);
    setError(null);
    setStreaming(true);
    setActiveTools([]);
    setReasoningText('');

    const tempAssistantId = `stream-${Date.now()}`;
    let streamedText = '';
    const collectedTools: ToolCallInfo[] = [];

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch(`${BASE_URL}/workspace-agent/${courseId}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          content, provider_id: selectedProvider, model: selectedModel,
          space_id: spaceId,
          note_ids: [...contextNoteIds],
          attachments: turnAttachments,
          conversation_id: conversationId ?? undefined,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error('No response body');

      await readSSEStream(res.body.getReader(), (event) => {
        if (event === '[DONE]') return;
        if (typeof event.error === 'string') { setDrawing(null); setError(event.error); return; }
        if (event.done === true && typeof event.conversationId === 'string') {
          setConversationId(event.conversationId as string); return;
        }
        if (event.drawing && typeof (event.drawing as { prompt?: unknown }).prompt === 'string') {
          setDrawing({ prompt: (event.drawing as { prompt: string }).prompt, startedAt: Date.now() });
          return;
        }
        if (event.toolStatus === 'running' && typeof event.toolName === 'string') {
          const toolName = event.toolName as string;
          const info: ToolCallInfo = { name: toolName, status: 'running' };
          if (!collectedTools.find((t) => t.name === toolName)) collectedTools.push(info);
          setActiveTools((prev) => prev.find((t) => t.name === toolName) ? prev : [...prev, info]);
          return;
        }
        if (event.toolStatus === 'used') {
          const names = (event.toolNames as string[]) ?? (event.toolName ? [event.toolName as string] : []);
          const justFinished = typeof event.toolName === 'string' ? (event.toolName as string) : null;
          const summary = typeof event.toolSummary === 'string' ? (event.toolSummary as string) : undefined;
          const dur = typeof event.toolDurationMs === 'number' ? (event.toolDurationMs as number) : undefined;
          for (const n of names) {
            const existing = collectedTools.find((t) => t.name === n);
            if (existing) {
              existing.status = 'done';
              if (n === justFinished) { existing.result = summary; existing.duration = dur; }
            } else {
              collectedTools.push({ name: n, status: 'done', ...(n === justFinished ? { result: summary, duration: dur } : {}) });
            }
          }
          if (justFinished) {
            setActiveTools((prev) => prev.map((t) =>
              t.name === justFinished ? { ...t, status: 'done' as const, result: summary, duration: dur } : t));
          }
          setActiveTools((prev) => prev.map((t) => names.includes(t.name) ? { ...t, status: 'done' as const } : t));
          return;
        }
        if (event.reasoningStatus === 'thinking' && typeof event.reasoningChunk === 'string') {
          setReasoningText((prev) => prev + (event.reasoningChunk as string)); return;
        }
        if (event.reasoningStatus === 'answering' || event.reasoningStatus === 'done') {
          setReasoningText(''); return;
        }
        if (typeof event.token === 'string') {
          setDrawing(null);
          streamedText += event.token;
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === tempAssistantId);
            if (existing) return prev.map((m) => m.id === tempAssistantId ? { ...m, content: streamedText } : m);
            return [...prev, { id: tempAssistantId, role: 'assistant' as const, content: streamedText }];
          });
          return;
        }
        if (event.assistantMessage) {
          const final = event.assistantMessage as Record<string, unknown>;
          setMessages((prev) => prev.map((m) =>
            m.id === tempAssistantId
              ? { id: (final.id as string) ?? tempAssistantId, role: 'assistant' as const, content: (final.content as string) ?? streamedText, tools: collectedTools.length > 0 ? [...collectedTools] : undefined }
              : m,
          ));
        }
      });

      setMessages((prev) => prev.map((m) =>
        m.id === tempAssistantId && collectedTools.length > 0 ? { ...m, tools: [...collectedTools] } : m,
      ));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setInput(content);
      if (!streamedText) setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId));
    } finally {
      setStreaming(false);
      setDrawing(null);
      setActiveTools([]);
      setReasoningText('');
      abortRef.current = null;
    }
  }, [input, streaming, selectedProvider, selectedModel, courseId, spaceId, contextNoteIds, attachments, conversationId, t.noProvider, messages]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  // -- Render ----------------------------------------------------------------


  return (
    <div
      className={`${embedded
        ? 'relative w-full h-full flex flex-col bg-white dark:bg-gray-900'
        : `fixed inset-y-0 right-0 z-50 max-w-full bg-white dark:bg-gray-900 shadow-2xl shadow-black/10 border-l border-gray-200 dark:border-gray-800 transform transition-transform duration-300 flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`
      }`}
      style={embedded ? undefined : { width: `${panelWidth}px` }}
    >
      {!embedded && <div
        className="absolute inset-y-0 left-0 w-1 cursor-col-resize hover:w-1.5 hover:bg-[#000080]/15 active:bg-[#000080]/25 transition-all z-10"
        onMouseDown={handleDragStart}
      />}
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2.5">
          <img src="/assets/ai-tutor-avatar.png" alt="" className="h-7 w-7 rounded-lg object-cover ring-1 ring-gray-200 dark:ring-gray-700" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 tracking-tight">{t.title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button type="button" onClick={() => { setMessages([]); setConversationId(null); setError(null); }}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={lang === 'zh' ? '新对话' : 'New chat'}>
              <RemixIcon name="chat-new-line" size={16} />
            </button>
          )}
          {!embedded && <button type="button" onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close">
            <X size={18} />
          </button>}
        </div>
      </div>

      {/* ── Tab bar ────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 shrink-0">
        {([
          { key: 'chat' as PanelTab, label: t.tabChat, icon: 'chat-3-line' },
          { key: 'history' as PanelTab, label: t.tabHistory, icon: 'history-line' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? 'text-[#000080] dark:text-[#93AAFD] border-b-2 border-[#000080] dark:border-[#4169E1]'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
          >
            <RemixIcon name={tab.icon} size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Usage bar (chat tab only) ──────────────────────────── */}
      {usageInfo && activeTab === 'chat' && (
        <div className="px-4 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 text-[0.6875rem] text-gray-500 dark:text-gray-400 shrink-0">
          <RemixIcon name="bar-chart-line" size={10} />
          <span>{t.today}: {usageInfo.today}/{usageInfo.daily_limit}</span>
          <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${usageInfo.remaining <= 10 ? 'bg-red-400' : 'bg-[#000080] dark:bg-[#4169E1]'}`}
              style={{ width: `${Math.min(100, (usageInfo.today / usageInfo.daily_limit) * 100)}%` }}
            />
          </div>
          <span>{usageInfo.remaining} {t.remaining}</span>
        </div>
      )}

      {/* ── Tab content ────────────────────────────────────────── */}

      {/* Chat tab */}
      {activeTab === 'chat' && (
        <>
          {/* 一行控制条：选模型、选上下文。以前是「厂商 / 模型 / 模式」三个下拉，
              学生要先懂 DMXAPI 和 DeepSeek 的区别才选得动。现在合成一个。 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800 shrink-0">
            <select
              value={`${selectedProvider}::${selectedModel}`}
              onChange={(e) => {
                const [pid, mid] = e.target.value.split('::');
                setSelectedProvider(pid); setSelectedModel(mid);
              }}
              disabled={providers.length === 0}
              className="h-8 max-w-[15rem] flex-1 truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 outline-none transition-colors hover:border-gray-300 focus:border-[#000080] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {providers.length === 0 && <option value="::">{t.noProvider}</option>}
              {providers.length > 0 && <option value="auto::auto">{t.defaultModel}</option>}
              {providers.flatMap((p) =>
                (p.enabledModels ?? []).map((m) => (
                  <option key={`${p.providerId}::${m}`} value={`${p.providerId}::${m}`}>
                    {modelOptionLabel(p.providerId, m, lang === 'zh' ? 'zh' : 'en')}
                  </option>
                )))}
            </select>

            <div ref={notePickerRef} className="relative">
              <button
                type="button"
                onClick={() => setNotePickerOpen(v => !v)}
                aria-expanded={notePickerOpen}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                  contextNoteIds.size > 0
                    ? 'border-[#000080]/30 bg-[#000080]/[0.06] text-[#000080] dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                <RemixIcon name="checkbox-multiple-line" size={13} />
                {contextNoteIds.size > 0 ? `${t.picked} ${contextNoteIds.size}` : t.wholeSpace}
              </button>

              {notePickerOpen && (
                <div className="absolute left-0 top-9 z-30 w-80 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                  <div className="flex items-center gap-1.5 px-1 pb-2">
                    <input
                      value={noteQuery}
                      onChange={(e) => setNoteQuery(e.target.value)}
                      placeholder={t.searchNotes}
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs outline-none focus:border-[#000080] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    />
                    <button type="button" onClick={() => setContextNoteIds(new Set(spaceNotes.map(n => n.id)))}
                      className="shrink-0 rounded-lg px-2 py-1 text-[0.6875rem] font-semibold text-[#000080] hover:bg-[#000080]/[0.07] dark:text-blue-300">
                      {t.selectAll}
                    </button>
                    <button type="button" onClick={() => setContextNoteIds(new Set())}
                      className="shrink-0 rounded-lg px-2 py-1 text-[0.6875rem] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                      {t.clearSel}
                    </button>
                  </div>
                  <p className="px-1 pb-1.5 text-[0.6875rem] leading-4 text-gray-400">{t.pickHint}</p>
                  <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                    {spaceNotes
                      .filter(n => !noteQuery.trim() || (n.title ?? '').toLowerCase().includes(noteQuery.trim().toLowerCase()))
                      .map(n => {
                        const on = contextNoteIds.has(n.id);
                        return (
                          <li key={n.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => setContextNoteIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(n.id)) next.delete(n.id); else next.add(n.id);
                                  return next;
                                })}
                                className="h-3.5 w-3.5 shrink-0 accent-[#000080]"
                              />
                              <span className="min-w-0 flex-1 truncate">{n.title || '（无标题）'}</span>
                              {n.author && <span className="shrink-0 text-[0.625rem] text-gray-400">{n.author}</span>}
                            </label>
                          </li>
                        );
                      })}
                    {spaceNotes.length === 0 && (
                      <li className="px-2 py-3 text-center text-[0.6875rem] text-gray-400">{t.noNotes}</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* 讨论速览：在开始聊之前，先看清这一批笔记里有什么 */}
          {spaceId && (
            <DiscussionDigestPanel
              courseId={courseId}
              spaceId={spaceId}
              viewId={viewId}
              selectedNoteIds={selectedNoteIds}
              groupId={groupId}
              lang={lang === 'zh' ? 'zh' : 'en'}
              onLocateNote={onLocateNote}
            />
          )}

          {/* Messages */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && !streaming && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 dark:text-gray-500 space-y-3">
                <img src="/assets/ai-tutor-avatar.png" alt="" className="h-12 w-12 rounded-2xl object-cover opacity-30" />
                <p className="text-sm max-w-[240px] leading-relaxed">{t.placeholder}</p>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[85%] space-y-1.5">
                  {msg.role === 'assistant' && msg.tools && msg.tools.length > 0 && (
                    <AgentToolCallDisplay tools={msg.tools} lang={lang} compact />
                  )}
                  <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === 'user'
                      ? 'bg-[#000080] text-white rounded-br-md'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-md'
                  }`}>
                    {msg.role === 'assistant'
                      ? <MarkdownMessage content={msg.content} resolveUrl={url => `${BASE_URL}${url.slice(4)}`} />
                      : msg.content}
                  </div>
                </div>
              </div>
            ))}

            {streaming && activeTools.length > 0 && (
              <AgentToolCallDisplay tools={activeTools} lang={lang} compact />
            )}

            {streaming && reasoningText && (
              <div className="bg-[#000080]/[0.04] dark:bg-blue-500/10 rounded-xl px-3.5 py-2.5 text-xs text-[#000080] dark:text-blue-300 italic border border-[#000080]/10 dark:border-blue-500/20">
                <div className="flex items-center gap-1.5 mb-1 font-semibold not-italic">
                  <RemixIcon name="brain-line" size={12} />
                  {t.deepThinking}
                </div>
                <div className="line-clamp-3 opacity-70">{reasoningText}</div>
              </div>
            )}

            {streaming && drawing && (
              <DrawingProgress prompt={drawing.prompt} lang={lang} startedAt={drawing.startedAt} />
            )}

            {streaming && !drawing && !messages.some((m) => m.id.startsWith('stream-')) && !reasoningText && activeTools.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                <Loader2 size={14} className="animate-spin" />
                {t.thinking}
                {waitedSec >= 3 && (
                  <span className="font-mono tabular-nums opacity-70">{waitedSec}s</span>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Error banner */}
          {error && (
            <div className="mx-4 mb-2 px-3 py-2 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs flex items-start gap-2 shrink-0">
              <RemixIcon name="error-warning-line" size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300">
                <X size={12} />
              </button>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 shrink-0">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map(a => (
                  <span key={a.file_url} className="relative">
                    {a.mime_type.startsWith('image/') ? (
                      <img src={a.file_url} alt={a.file_name}
                        className="h-12 w-12 rounded-lg border border-gray-200 object-cover dark:border-gray-600" />
                    ) : (
                      <span className="flex h-12 max-w-[9rem] items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 text-[0.6875rem] font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                        title={a.file_name}>
                        <RemixIcon name="file-text-line" size={13} className="shrink-0" />
                        <span className="truncate">{a.file_name}</span>
                      </span>
                    )}
                    <button type="button" aria-label={`${t.removeAttach}: ${a.file_name}`}
                      onClick={() => setAttachments(prev => prev.filter(x => x.file_url !== a.file_url))}
                      className="absolute -right-1.5 -top-1.5 inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-gray-900/80 p-0.5 text-white hover:bg-gray-900">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={fileInputRef} type="file" className="hidden"
                accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.json"
                onChange={(e) => void handlePickFile(e)} />
              <button type="button" onClick={() => fileInputRef.current?.click()}
                disabled={!spaceId || uploading || streaming || attachments.length >= 4}
                title={t.attach} aria-label={t.attach}
                className="shrink-0 rounded-xl p-2.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <RemixIcon name="attachment-2" size={16} />}
              </button>
              <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder={t.placeholder} disabled={streaming} rows={1}
                className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#000080] dark:focus:ring-blue-400 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 disabled:opacity-50 max-h-32 transition-colors"
                onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 128)}px`; }}
              />
              <button type="button" onClick={handleSend} disabled={streaming || (!input.trim() && attachments.length === 0)}
                className="shrink-0 p-2.5 rounded-xl bg-[#000080] text-white hover:bg-[#000060] active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                aria-label={t.send}>
                {streaming ? <Loader2 size={16} className="animate-spin" /> : <RemixIcon name="arrow-up-line" size={16} />}
              </button>
            </div>
          </div>
        </>
      )}

      {/* History tab */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto p-4">
          {loadingHistory ? (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400 mt-10">
              <Loader2 size={12} className="animate-spin" />
              {t.loadingText}
            </div>
          ) : historyEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 text-center space-y-2">
              <RemixIcon name="history-line" size={28} className="text-gray-300 dark:text-gray-600" />
              <p className="text-xs">{t.noHistory}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {historyEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/60 p-3.5 hover:shadow-sm transition-shadow">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[0.6875rem] font-semibold text-gray-600 dark:text-gray-400">
                      {PROVIDER_LABELS[entry.provider_id] ?? entry.provider_id}
                    </span>
                    <span className="text-[0.6875rem] text-gray-400 dark:text-gray-500 ml-auto font-mono">
                      {new Date(entry.created_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="text-[0.6875rem] text-gray-500 dark:text-gray-400 mb-1.5 bg-gray-50 dark:bg-gray-700/40 rounded-md p-2 border border-gray-100 dark:border-gray-700">
                    {entry.input_context_summary}
                  </div>
                  <div className="text-[0.6875rem] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/40 rounded-md p-2">
                    {entry.response_text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkspaceAgentPanel;
