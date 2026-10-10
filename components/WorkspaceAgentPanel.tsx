/**
 * WorkspaceAgentPanel — Unified workspace AI panel.
 *
 * 一个面板：顶上一行（标题、新对话、历史对话、关闭），对话区占满中间，控制项（附件、
 * 范围、模型）收在输入框下面的一排。以前顶上叠了标题、页签、用量条、控制条四层，
 * 再加常开的「讨论速览」，对话区被挤得很小。
 * 历史对话：后端一直在存，打开面板时读回这个空间里最近的一段，「历史」里能翻以前的；
 * 以前这里只有一个页签列「AI 介入记录」，从来读不回对话。
 * 默认宽度占屏幕的一半，拖宽拖窄会记住。
 * 平台怎么用的求助不在这里：它是全站右边缘的「使用帮助」小球（components/help），
 * 两个入口并存时学生分不清该去哪问。
 *
 * 介入触发已移到笔记详情面板（NoteAiPanel）：整空间一列检测结果看的人
 * 并不知道它们对应画布上的哪张卡片，按笔记归属之后才用得上。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import RemixIcon from './RemixIcon';
import type { ToolCallInfo } from './AgentToolCallDisplay';
import AgentProcess from './AgentProcess';
import { useAiSurfaceMotion } from '../hooks/useAiMotion';
import KbSourceCards, { parseKbSources } from './KbSourceCards';
import DiscussionDigestPanel from './DiscussionDigest';
import { ai as aiApi, getAuthToken, workspaceAgent as workspaceAgentApi } from '../services/apiClient';
import type { AgentConversation, KbSourceCard } from '../services/apiClient';
import { useDismissible } from '../hooks/useDismissible';
import { uploadAttachment, MAX_ATTACHMENT_BYTES } from '../services/attachmentUpload';
import MarkdownMessage from './chatMarkdown';
import { modelOptionLabel } from './aiModelLabels';
import DrawingProgress, { nextDrawingState, type DrawingState } from './DrawingProgress';
import AnswerLengthSelect from './AnswerLengthSelect';
import AssistantWelcome from './AssistantWelcome';
import { useChatPreferences, ChatPreferenceControls } from '../hooks/useChatPreferences';
import { useGrowingTextarea } from '../hooks/useGrowingTextarea';
import { getAnswerLength } from './answerLengthPref';
import { attachmentQuestionHint, restoreTurnAttachments } from './chatAttachments';
import { formatThreadTime } from './noteChatHistory';
import {
  clampPanelWidth,
  conversationLabel,
  initialPanelWidth,
  mergeConversations,
  messagesFromApi,
  pickConversationToRestore,
  sortConversations,
  upsertConversation,
} from './workspaceAgentHistory';

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
  /** 回答下面的来源卡片：打开那份附件，PDF 跳到那一页。不给就不能点（手机端没有阅读页） */
  onOpenKbSource?: (noteId: string, page: number | null) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolCallInfo[];
  /** 这一轮从发出到答完用了多久（「用了 3 步 · 6 秒」） */
  elapsedMs?: number;
  /** 课程资料的来源卡片（ai_metadata.kb_sources） */
  kbSources?: KbSourceCard[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const AUTH_TOKEN_KEY = 'hakcc-access-token';

/** 学生拖过的面板宽度记在浏览器里；没拖过就是屏幕的一半 */
const WIDTH_KEY = 'hakcc-ws-agent-width';
const readStoredWidth = (): string | null => { try { return localStorage.getItem(WIDTH_KEY); } catch { return null; } };
const writeStoredWidth = (width: number) => { try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* 隐私模式忽略 */ } };


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
  pendingAttachment, onPendingAttachmentTaken, onOpenKbSource,
}) => {
  // -- Panel width (resizable) ------------------------------------------------
  // 默认占屏幕的一半：对话和画布各一半。以前固定 420px，AI 的回答（表格、长段落）挤在一条窄缝里
  const [panelWidth, setPanelWidth] = useState(() => initialPanelWidth(window.innerWidth, readStoredWidth()));
  const isDragging = useRef(false);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;
    let latest = startWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX - ev.clientX;
      latest = clampPanelWidth(startWidth + delta, window.innerWidth);
      setPanelWidth(latest);
    };
    const onUp = () => {
      isDragging.current = false;
      writeStoredWidth(latest);
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

  // -- Chat state ------------------------------------------------------------
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  /** 这一轮是画图（后端识别出「画一张……」）：放绘图动画，图到了再换成图 */
  const [drawing, setDrawing] = useState<DrawingState | null>(null);
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
  const { enterToSend, setEnterToSend, largeText, setLargeText } = useChatPreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  useDismissible({ open: settingsOpen, onDismiss: () => setSettingsOpen(false), ref: settingsRef });
  const [activeTools, setActiveTools] = useState<ToolCallInfo[]>([]);
  // 这一轮开始的时刻：等待时 AgentProcess 显示已经等了几秒，答完记下总用时
  const turnStartedAtRef = useRef(0);
  const [reasoningText, setReasoningText] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);

  // -- History state ---------------------------------------------------------
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  /** 打开面板时正在读回上一段对话 */
  const [restoring, setRestoring] = useState(false);
  /** 在历史里点了、消息还在读的那一段 */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const restoredKeyRef = useRef<string | null>(null);
  const restoreRunRef = useRef(0);
  // 异步回调里要看「现在」的状态，不能读闭包里的旧值
  const messagesRef = useRef<ChatMessage[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  messagesRef.current = messages;
  conversationIdRef.current = conversationId;
  streamingRef.current = streaming;


  // -- Usage state -----------------------------------------------------------
  const [usageInfo, setUsageInfo] = useState<{ today: number; remaining: number; daily_limit: number } | null>(null);

  // -- Refs ------------------------------------------------------------------
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useGrowingTextarea(inputRef, input, isOpen || Boolean(embedded));
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
      title: zh ? '知识空间智能体' : 'Knowledge space agent',
      newChat: zh ? '新对话' : 'New chat',
      history: zh ? '历史对话' : 'History',
      historyEmpty: zh ? '还没有历史对话' : 'No earlier chats yet',
      historyLoading: zh ? '正在读取…' : 'Loading…',
      restoring: zh ? '正在打开上次的对话…' : 'Opening your last chat…',
      opening: zh ? '正在打开这段对话…' : 'Opening this chat…',
      openFailed: zh ? '没能打开这段对话，请稍后再试。' : 'Could not open that chat. Please try again.',
      switchBlocked: zh ? '回答完才能切换' : 'Wait for the answer to finish',
      send: zh ? '发送' : 'Send',
      draw: zh ? '画图' : 'Draw',
      drawHint: zh ? '按输入框里的描述画一张图；还没写描述就先写好再点' : 'Draw a picture from what you typed; type a description first',
      drawPrefix: zh ? '画一张：' : 'Draw a picture of ',
      thinking: zh ? '思考中…' : 'Thinking…',
      placeholder: zh ? '向智能体提问这个空间里的笔记…' : 'Ask the agent about the notes in this space…',
      provider: zh ? '服务商' : 'Provider',
      model: zh ? '模型' : 'Model',
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
      usageTip: (today: number, limit: number, left: number) => (zh
        ? `今天已用 ${today} 次，共 ${limit} 次，还剩 ${left} 次`
        : `${today} of ${limit} used today, ${left} left`),
    };
  }, [lang]);

  // -- Effects ---------------------------------------------------------------

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
    onPendingAttachmentTaken?.();
  }, [isOpen, pendingAttachment, onPendingAttachmentTaken]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Load usage info
  useEffect(() => {
    if (isOpen && courseId) {
      aiApi.usage(courseId).then((r) => setUsageInfo(r.usage)).catch(() => {});
    }
  }, [isOpen, courseId, messages.length]);

  // 打开面板时读回这个空间里最近的一段对话。后端一直在存，以前这里一条都不读，
  // 刷新页面、隔天再开都是一片空白。学生已经开始问了就不覆盖他眼前的。
  useEffect(() => {
    if (!isOpen || !courseId) return;
    const key = `${courseId}:${spaceId ?? ''}`;
    if (restoredKeyRef.current === key) return;
    if (restoredKeyRef.current !== null) {
      // 换了空间：上一个空间的对话不带过来
      setMessages([]);
      setConversationId(null);
      setConversations([]);
    }
    restoredKeyRef.current = key;
    const run = ++restoreRunRef.current;
    const stale = () => restoreRunRef.current !== run;
    const occupied = () => messagesRef.current.length > 0 || streamingRef.current || conversationIdRef.current !== null;
    setRestoring(true);
    void (async () => {
      try {
        const { conversations: list } = await workspaceAgentApi.listConversations(courseId, spaceId);
        if (stale()) return;
        setConversations(sortConversations(list));
        if (occupied()) return;
        const latest = pickConversationToRestore(list, spaceId);
        if (!latest) return;
        const { messages: stored } = await workspaceAgentApi.loadMessages(courseId, latest.id);
        if (stale() || occupied()) return;
        setMessages(messagesFromApi(stored));
        setConversationId(latest.id);
      } catch {
        // 读不回来也不影响提问；下次打开再试
        if (!stale()) restoredKeyRef.current = null;
      } finally {
        if (!stale()) setRestoring(false);
      }
    })();
  }, [isOpen, courseId, spaceId]);

  useDismissible({ open: historyOpen, onDismiss: () => setHistoryOpen(false), ref: historyMenuRef });

  /** 打开历史菜单时顺手刷新一遍列表（别的设备或别的标签页里聊过的也在） */
  const toggleHistory = useCallback(() => {
    setHistoryOpen((open) => {
      if (!open) {
        setHistoryLoading(true);
        workspaceAgentApi.listConversations(courseId, spaceId)
          .then(({ conversations: list }) => setConversations(prev => mergeConversations(prev, list)))
          .catch(() => { /* 用已有的列表 */ })
          .finally(() => setHistoryLoading(false));
      }
      return !open;
    });
  }, [courseId, spaceId]);

  const openConversation = useCallback(async (conv: AgentConversation) => {
    if (streaming || openingId) return;
    if (conv.id === conversationId) { setHistoryOpen(false); return; }
    setOpeningId(conv.id);
    setError(null);
    try {
      const { messages: stored } = await workspaceAgentApi.loadMessages(courseId, conv.id);
      setMessages(messagesFromApi(stored));
      setConversationId(conv.id);
      setHistoryOpen(false);
    } catch {
      setError(t.openFailed);
    } finally {
      setOpeningId(null);
    }
  }, [streaming, openingId, conversationId, courseId, t.openFailed]);

  const startNewChat = useCallback(() => {
    if (streaming) return;
    setHistoryOpen(false);
    if (messages.length > 0 || conversationId) {
      setMessages([]);
      setConversationId(null);
      setError(null);
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [streaming, messages.length, conversationId]);

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

  /** draw：输入框下面的「画图」，不管怎么措辞都直接出图 */
  const handleSend = useCallback(async (draw = false) => {
    const content = input.trim();
    // 挂了附件也要写一句问题才发（chatAttachments.ts）
    if (!content || streaming) return;
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
    turnStartedAtRef.current = Date.now();

    const tempAssistantId = `stream-${Date.now()}`;
    let streamedText = '';
    const collectedTools: ToolCallInfo[] = [];
    // 来源卡片在第一个字之前就到了，那时回答这条消息还没建：先记着，建的时候挂上
    let turnSources: KbSourceCard[] = [];
    // 流开始了就是服务端接下了这一问，提问已经存进库
    let accepted = false;
    let failed = false;
    // 出错时问题和附件都放回输入框，改一改或直接再发。服务端没接下的，对话里那条提问也撤掉
    const putBack = () => {
      if (!accepted) setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setInput((prev) => (prev.trim() ? prev : content));
      setAttachments((prev) => restoreTurnAttachments(turnAttachments, prev));
    };

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
          answer_length: getAnswerLength(),
          ...(draw ? { force_draw: true } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      accepted = true;
      if (!res.body) throw new Error('No response body');

      await readSSEStream(res.body.getReader(), (event) => {
        if (event === '[DONE]') return;
        if (typeof event.error === 'string') { failed = true; setDrawing(null); setError(event.error); return; }
        if (event.done === true && typeof event.conversationId === 'string') {
          const id = event.conversationId as string;
          setConversationId(id);
          // 标题是这段对话的第一句话；已经在列表里的对话 upsert 会保留原标题
          setConversations(prev => upsertConversation(prev, {
            id, title: content.slice(0, 80), updated_at: new Date().toISOString(), space_id: spaceId ?? null,
          }));
          return;
        }
        if (event.drawing && typeof (event.drawing as { prompt?: unknown }).prompt === 'string') {
          setDrawing(prev => nextDrawingState(prev, event.drawing as { prompt: string; stage?: unknown; caption?: unknown; mode?: unknown }));
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
        if (Array.isArray(event.kbSources)) {
          turnSources = parseKbSources(event.kbSources);
          setMessages((prev) => prev.map((m) => m.id === tempAssistantId ? { ...m, kbSources: turnSources } : m));
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
            return [...prev, {
              id: tempAssistantId, role: 'assistant' as const, content: streamedText,
              ...(turnSources.length > 0 ? { kbSources: turnSources } : {}),
            }];
          });
          return;
        }
        if (event.assistantMessage) {
          const final = event.assistantMessage as Record<string, unknown>;
          setMessages((prev) => prev.map((m) =>
            m.id === tempAssistantId
              ? { id: (final.id as string) ?? tempAssistantId, role: 'assistant' as const, content: (final.content as string) ?? streamedText, tools: collectedTools.length > 0 ? [...collectedTools] : undefined, elapsedMs: Date.now() - turnStartedAtRef.current }
              : m,
          ));
        }
      });

      // 这一轮答完：临时 id 换成正式的。智能体那条路不回传 assistantMessage，临时 id 以前一直留着，
      // 「正在思考」那一行按「有没有 stream- 开头的消息」判断，于是从第二问起就再也不显示了。
      setMessages((prev) => prev.map((m) =>
        m.id === tempAssistantId
          ? {
            ...m, id: generateId(), elapsedMs: Date.now() - turnStartedAtRef.current,
            ...(collectedTools.length > 0 ? { tools: [...collectedTools] } : {}),
            ...(turnSources.length > 0 ? { kbSources: turnSources } : {}),
          }
          : m,
      ));
      if (failed) putBack();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // 答到一半断了：写出的部分留着，临时 id 换成正式的，否则再问时「正在思考」不显示
      setMessages((prev) => (streamedText
        ? prev.map((m) => (m.id === tempAssistantId ? { ...m, id: generateId() } : m))
        : prev.filter((m) => m.id !== tempAssistantId)));
      putBack();
    } finally {
      setStreaming(false);
      setDrawing(null);
      setActiveTools([]);
      setReasoningText('');
      abortRef.current = null;
    }
  }, [input, streaming, selectedProvider, selectedModel, courseId, spaceId, contextNoteIds, attachments, conversationId, t.noProvider, messages]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && enterToSend && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void handleSend(); }
  }, [handleSend, enterToSend]);

  // -- Render ----------------------------------------------------------------

  const motionRef = useAiSurfaceMotion({ open: embedded || isOpen, ready: !restoring && !openingId, floating: !embedded });
  const emptyChat = messages.length === 0 && !streaming;

  return (
    <div
      ref={motionRef}
      data-ai-motion-floating={!embedded || undefined}
      data-large-text={largeText}
      data-ws-agent-panel
      role="complementary"
      aria-label={t.title}
      aria-hidden={!embedded && !isOpen}
      inert={!embedded && !isOpen}
      className={`ai-motion-surface assistant-panel ${embedded
        ? 'relative w-full h-full flex flex-col bg-white dark:bg-gray-900'
        : `fixed inset-y-0 right-0 z-50 max-w-full bg-white dark:bg-gray-900 shadow-2xl shadow-black/10 border-l border-gray-200 dark:border-gray-800 flex flex-col`
      }`}
      style={embedded ? undefined : { width: `${panelWidth}px` }}
    >
      {!embedded && <div
        className="absolute inset-y-0 left-0 w-1 cursor-col-resize hover:w-1.5 hover:bg-[#000080]/15 active:bg-[#000080]/25 transition-all z-10"
        onMouseDown={handleDragStart}
      />}

      {/* ── Header：一行。标题、今日用量、新对话、历史对话、关闭 ───────────── */}
      <div data-ai-motion-chrome className="assistant-header relative z-20 flex shrink-0 items-center gap-2 border-b">
        <span className="assistant-mark" aria-hidden="true"><RemixIcon name="chat-quote-line" size={18} /></span>
        <div className="assistant-header-title">
          <h2 className="truncate">{t.title}</h2>
          <p className="truncate">{lang === 'zh' ? '连接观点 · 共同探究' : 'Connect ideas · Explore together'}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {usageInfo && (
            <span
              title={t.usageTip(usageInfo.today, usageInfo.daily_limit, usageInfo.remaining)}
              className={`mr-1 rounded-md px-1.5 py-0.5 text-[0.6875rem] tabular-nums ${
                usageInfo.remaining <= 10
                  ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {usageInfo.today}/{usageInfo.daily_limit}
            </span>
          )}
          <button
            type="button"
            onClick={startNewChat}
            disabled={streaming}
            title={streaming ? t.switchBlocked : t.newChat}
            aria-label={t.newChat}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <RemixIcon name="chat-new-line" size={15} />
            <span className="assistant-header-action-label">{t.newChat}</span>
          </button>
          <div ref={historyMenuRef} className="relative">
            <button
              type="button"
              onClick={toggleHistory}
              aria-expanded={historyOpen}
              aria-label={t.history}
              className={`inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors ${
                historyOpen
                  ? 'bg-[#000080]/[0.07] text-[#000080] dark:bg-blue-950/40 dark:text-blue-300'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <RemixIcon name="history-line" size={15} />
              <span className="assistant-header-action-label">{t.history}</span>
            </button>
            {historyOpen && (
              <div
                data-ws-agent-history
                className="absolute right-0 top-full z-30 mt-1.5 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-[0.6875rem] font-semibold text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <span>{t.history}</span>
                  {historyLoading && <Loader2 size={12} className="animate-spin" aria-label={t.historyLoading} />}
                </div>
                <ul className="max-h-80 overflow-y-auto p-1">
                  {conversations.length === 0 && !historyLoading && (
                    <li className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">{t.historyEmpty}</li>
                  )}
                  {conversations.map((c) => {
                    const current = c.id === conversationId;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          data-conversation-id={c.id}
                          aria-current={current ? 'true' : undefined}
                          disabled={streaming || openingId !== null}
                          title={streaming ? t.switchBlocked : undefined}
                          onClick={() => void openConversation(c)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                            current
                              ? 'bg-[#000080]/[0.07] font-semibold text-[#000080] dark:bg-blue-950/40 dark:text-blue-300'
                              : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{conversationLabel(c, lang)}</span>
                          {openingId === c.id
                            ? <Loader2 size={12} className="shrink-0 animate-spin" />
                            : <span className="shrink-0 text-[0.625rem] tabular-nums text-gray-400 dark:text-gray-500">{formatThreadTime(c.updated_at, lang)}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          {!embedded && <button type="button" onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            aria-label={lang === 'zh' ? '关闭' : 'Close'}>
            <X size={18} />
          </button>}
        </div>
      </div>

      <div ref={notePickerRef} className="assistant-context-bar relative shrink-0">
        <button
          type="button"
          onClick={() => setNotePickerOpen(v => !v)}
          aria-expanded={notePickerOpen}
          aria-label={lang === 'zh' ? '选择 Note' : 'Choose Notes'}
          className="assistant-context-trigger"
        >
          <RemixIcon name="checkbox-multiple-line" size={13} />
          <span className="assistant-context-label">{lang === 'zh' ? '选择 Note' : 'Choose Notes'}</span>
          <span className="assistant-context-value">{contextNoteIds.size > 0 ? `${t.picked} ${contextNoteIds.size}` : t.wholeSpace}</span>
          <RemixIcon name="arrow-down-s-line" size={14} />
        </button>

        {notePickerOpen && (
          <div className="assistant-context-menu">
            <div className="flex items-center gap-1.5 px-1 pb-2">
              <input
                value={noteQuery}
                onChange={(e) => setNoteQuery(e.target.value)}
                aria-label={t.searchNotes}
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
                        <span className="min-w-0 flex-1 truncate">{n.title || (lang === 'zh' ? '（无标题）' : '(Untitled)')}</span>
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


      {/* 讨论速览：收成一行，点开才展开。在开始聊之前先看清这一批笔记里有什么 */}
      {spaceId && (
        <DiscussionDigestPanel
          collapsible
          courseId={courseId}
          spaceId={spaceId}
          viewId={viewId}
          selectedNoteIds={selectedNoteIds}
          groupId={groupId}
          lang={lang === 'zh' ? 'zh' : 'en'}
          onLocateNote={onLocateNote}
        />
      )}

      {/* ── Messages：占满中间 ─────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        aria-busy={streaming || restoring || openingId !== null}
        className={`assistant-conversation min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain transition-opacity ${openingId ? 'opacity-60' : ''}`}
      >
        {openingId && (
          <div role="status" className="flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            <Loader2 size={13} className="animate-spin" />
            {t.opening}
          </div>
        )}

        {emptyChat && !openingId && (
          restoring ? (
            <div role="status" className="flex h-full items-center justify-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <Loader2 size={13} className="animate-spin" />
              {t.restoring}
            </div>
          ) : (
            <div className="flex min-h-full flex-col">
              <AssistantWelcome scope="space" lang={lang === 'zh' ? 'zh' : 'en'} disabled={providers.length === 0}
                onChoose={prompt => { setInput(prompt); inputRef.current?.focus(); }} />
            </div>
          )
        )}

        {messages.map((msg, index) => (
          <div key={msg.id} data-ai-motion="message" data-ai-motion-key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`min-w-0 space-y-1.5 ${msg.role === 'user' ? 'max-w-[80%]' : 'max-w-full'}`}>
              {msg.role === 'assistant' && (
                // 写回答的时候、写完以后：收成一行「用了 3 步 · 6 秒」，点开能看每一步
                <AgentProcess
                  steps={msg.id.startsWith('stream-') ? activeTools : msg.tools ?? []}
                  phase={msg.id.startsWith('stream-') ? 'writing' : 'done'}
                  elapsedMs={msg.elapsedMs}
                  lang={lang === 'zh' ? 'zh' : 'en'}
                />
              )}
              <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'assistant-user-message'
                  : 'assistant-response'
              }`}>
                {msg.role === 'assistant'
                  ? (
                    <>
                      <MarkdownMessage content={msg.content} resolveUrl={url => `${BASE_URL}${url.slice(4)}`} />
                      <KbSourceCards
                        sources={msg.kbSources ?? []}
                        content={msg.content}
                        streaming={msg.id.startsWith('stream-')}
                        lang={lang === 'zh' ? 'zh' : 'en'}
                        onOpen={onOpenKbSource}
                      />
                    </>
                  )
                  : msg.content}
              </div>
            </div>
          </div>
        ))}

        {streaming && drawing && (
          <DrawingProgress {...drawing} lang={lang} />
        )}

        {/* 还没开始写：一步步显示在做什么（2026-10-05 用户：等的时候别让学生觉得无聊）。
            不显示模型的原始思考，只说「正在思考」 */}
        {streaming && !drawing && !messages.some((m) => m.id.startsWith('stream-') && m.content) && (
          <AgentProcess
            steps={activeTools}
            phase="waiting"
            startedAt={turnStartedAtRef.current}
            thinking={Boolean(reasoningText)}
            lang={lang === 'zh' ? 'zh' : 'en'}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs flex items-start gap-2 shrink-0">
          <RemixIcon name="error-warning-line" size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" aria-label={lang === 'zh' ? '关闭错误提示' : 'Dismiss error'} onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300">
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── 输入区：输入框在上，附件 / 范围 / 模型 / 发送收成下面一排 ───────── */}
      <div data-ai-motion-chrome className="assistant-footer shrink-0 border-t px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
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
        <div ref={settingsRef} data-ai-composer className="assistant-composer relative">
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            aria-label={t.placeholder} placeholder={attachments.length > 0 ? attachmentQuestionHint(attachments, lang) : t.placeholder}
            disabled={streaming} rows={2}
            className="assistant-input w-full resize-none bg-transparent outline-none disabled:opacity-50"
          />
          <div className={`assistant-options ${settingsOpen ? '' : 'hidden'}`}>
            <p className="assistant-options-title">{lang === 'zh' ? '对话设置' : 'Chat settings'}</p>
            <ChatPreferenceControls lang={lang} enterToSend={enterToSend} setEnterToSend={setEnterToSend} largeText={largeText} setLargeText={setLargeText} />

          </div>
          <div className="assistant-tools px-2.5 pb-2.5">
            <input ref={fileInputRef} type="file" className="hidden"
              accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.json"
              onChange={(e) => void handlePickFile(e)} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              disabled={!spaceId || uploading || streaming || attachments.length >= 4}
              title={t.attach} aria-label={t.attach}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-700">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <RemixIcon name="attachment-2" size={15} />}
            </button>

            <button
              type="button"
              onClick={() => {
                // 写了描述就直接画；还没写就先放个开头，学生接着写完再点
                if (input.trim()) { void handleSend(true); return; }
                setInput(t.drawPrefix);
                inputRef.current?.focus();
              }}
              disabled={streaming || attachments.length > 0}
              title={t.drawHint} aria-label={t.drawHint}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-[0.75rem] font-medium text-gray-500 transition-colors hover:bg-gray-200/70 hover:text-gray-800 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            >
              <RemixIcon name="image-line" size={15} />
              <span className="assistant-tool-label">{t.draw}</span>
            </button>
            <div className="assistant-primary-controls">
              <label className="assistant-model-control">
                <select
                aria-label={t.model}
                title={selectedProvider === 'auto' ? t.defaultModel : modelOptionLabel(selectedProvider, selectedModel, lang === 'zh' ? 'zh' : 'en')}
                  value={`${selectedProvider}::${selectedModel}`}
                  onChange={(e) => {
                    const [pid, mid] = e.target.value.split('::');
                    setSelectedProvider(pid); setSelectedModel(mid);
                  }}
                  disabled={providers.length === 0}
                  className="h-8 min-w-[7rem] max-w-full flex-1 truncate rounded-lg border border-transparent bg-transparent px-1.5 text-[0.6875rem] font-medium text-gray-500 outline-none transition-colors hover:bg-gray-200/70 focus:border-[#000080] dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  {providers.length === 0 && <option value="::">{t.noProvider}</option>}
                  {providers.length > 0 && <option value="auto::auto">{lang === 'zh' ? '默认 · 课程模型' : 'Default · Course model'}</option>}
                  {providers.flatMap((p) =>
                    (p.enabledModels ?? []).map((m) => (
                      <option key={`${p.providerId}::${m}`} value={`${p.providerId}::${m}`}>
                        {modelOptionLabel(p.providerId, m, lang === 'zh' ? 'zh' : 'en')}
                      </option>
                    )))}
                </select>
              </label>
              <AnswerLengthSelect lang={lang === 'zh' ? 'zh' : 'en'} disabled={streaming} />
            </div>
            <button type="button" onClick={() => setSettingsOpen(open => !open)}
              aria-expanded={settingsOpen} aria-label={lang === 'zh' ? '对话设置' : 'Chat settings'}
              title={lang === 'zh' ? '对话设置' : 'Chat settings'}
              className="assistant-settings-toggle">
              <RemixIcon name="equalizer-line" size={17} />
              <span className="assistant-settings-label">{lang === 'zh' ? '对话设置' : 'Settings'}</span>
            </button>
            <button type="button" onClick={() => void handleSend()} disabled={streaming || !input.trim()}
              title={!input.trim() && attachments.length > 0 ? attachmentQuestionHint(attachments, lang) : undefined}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#000080] text-white transition-all hover:bg-[#000060] active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t.send}>
              {streaming ? <Loader2 size={16} className="animate-spin" /> : <RemixIcon name="arrow-up-line" size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceAgentPanel;
