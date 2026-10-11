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
import { ai as aiApi, getAuthToken, memoryApi, workspaceAgent as workspaceAgentApi } from '../services/apiClient';
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
import { AgentDeliverables, AgentPlanBlock, ArtifactCards, ArtifactViewer } from './agent/AgentExtrasView';
import { applyAgentEvent, choiceReplyText, formatBytes, hasExtras, latestArtifacts, type AgentArtifactRef, type AgentExtras, type AgentQuestion, type AgentQuestionOption } from './agent/agentTurn';
import { ImportToNoteDialog, type ImportItem } from './agent/ImportToNoteDialog';
import MemoryPanel from './agent/MemoryPanel';

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
  /** 空间里的全部笔记，供「选哪几条作上下文」用；authorId 给「导入笔记」挑自己的 */
  spaceNotes?: Array<{ id: string; title: string; author?: string; authorId?: string; updatedAt?: string }>;
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
  /**
   * 整页（2026-10-11 用户：知识空间智能体做成独立页面，点智能体直接就是整页）：
   * 左栏历史对话、中间对话、右栏这段对话的成果。isOpen 为 false 时什么都不画，但组件不卸载，对话还在。
   */
  layout?: 'panel' | 'page';
  /** 导入笔记时只列自己写的笔记 */
  currentUserId?: string | null;
  /** 导入笔记以后让画布重新拉一遍笔记：之后打开那条笔记，编辑器里是带着导入内容的新正文 */
  onNotesChanged?: () => Promise<void> | void;
  /** 导入完成后的「打开笔记」 */
  onOpenNote?: (noteId: string) => void;
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
  /** 智能体的计划清单、选项卡、做好的网页（ai_metadata.plan / question / artifacts） */
  agent?: AgentExtras;
  /** 学生这句话是点了选项卡上的哪一个 */
  choice?: string;
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

/**
 * 和样式表用同一种写法判断屏幕宽度：媒体查询里的 rem 按浏览器默认字号算，
 * 写 80rem 就和 Tailwind 的 xl 断点一致，浏览器调过默认字号也不会一边显示一边不显示。
 */
function useMediaQuery(query: string): boolean {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

type DayGroup = 'today' | 'yesterday' | 'week' | 'earlier';

/** 整页左栏的历史对话按「今天 / 昨天 / 近 7 天 / 更早」分组 */
export function groupConversationsByDay(list: AgentConversation[], zh: boolean, now = new Date()): Array<{ key: DayGroup; label: string; items: AgentConversation[] }> {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const keys: DayGroup[] = ['today', 'yesterday', 'week', 'earlier'];
  const labels = zh ? ['今天', '昨天', '近 7 天', '更早'] : ['Today', 'Yesterday', 'Last 7 days', 'Earlier'];
  const groups = keys.map((key, i) => ({ key, label: labels[i], items: [] as AgentConversation[] }));
  for (const c of list) {
    const at = Date.parse(c.updated_at);
    const i = Number.isNaN(at) ? 3 : at >= today ? 0 : at >= today - day ? 1 : at >= today - 6 * day ? 2 : 3;
    groups[i].items.push(c);
  }
  return groups.filter(g => g.items.length > 0);
}

/** 分组标题已经说了是哪天：今天、昨天只写几点，近 7 天写星期几，更早写日期 */
export function threadTimeInGroup(iso: string, group: DayGroup, zh: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (group === 'today' || group === 'yesterday') {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (group === 'week') return zh ? `周${'日一二三四五六'[d.getDay()]}` : d.toLocaleDateString('en', { weekday: 'short' });
  return zh ? `${d.getMonth() + 1}月${d.getDate()}日` : d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

/** 右栏网页卡片前的小缩略图：一页纸，几行字 */
const PageGlyph: React.FC<{ muted?: boolean }> = ({ muted }) => (
  <span
    aria-hidden="true"
    className={`flex h-12 w-10 shrink-0 flex-col gap-1 rounded-lg border p-1.5 ${muted
      ? 'border-dashed border-zinc-300 dark:border-gray-700'
      : 'border-zinc-200 bg-gradient-to-b from-white to-zinc-50 shadow-[0_1px_2px_rgba(30,58,138,0.06)] dark:border-gray-700 dark:from-gray-800 dark:to-gray-900'}`}
  >
    <span className={`h-1 w-4 rounded-full ${muted ? 'bg-zinc-300 dark:bg-gray-700' : 'bg-[#000080]/60 dark:bg-[#93AAFD]/70'}`} />
    <span className="h-0.5 w-full rounded-full bg-zinc-200 dark:bg-gray-700" />
    <span className="h-0.5 w-5/6 rounded-full bg-zinc-200 dark:bg-gray-700" />
    <span className="h-0.5 w-full rounded-full bg-zinc-200 dark:bg-gray-700" />
    <span className="h-0.5 w-2/3 rounded-full bg-zinc-200 dark:bg-gray-700" />
  </span>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WorkspaceAgentPanel: React.FC<WorkspaceAgentPanelProps> = ({
  isOpen, onClose, courseId, spaceId, lang, aiConfigs, embedded,
  viewId, selectedNoteIds, groupId, onLocateNote, spaceNotes = [],
  pendingAttachment, onPendingAttachmentTaken, onOpenKbSource,
  layout = 'panel', currentUserId, onNotesChanged, onOpenNote, userRole,
}) => {
  const pageLayout = layout === 'page';
  // 侧栏和整页都用得到的中英文判断（整页那段下面另有一个 zh，侧栏提前 return 了，用不到它）
  const zhUi = lang === 'zh';
  // 整页够宽（≥ 80rem，和 Tailwind 的 xl 一致）才有右栏：参考范围和讨论速览这时放进右栏，不够宽就留在对话上方
  const wideAgentPage = useMediaQuery('(min-width: 80rem)');
  const scopeInRail = pageLayout && wideAgentPage;
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
  // 这一轮还没出字时的计划清单和写网页进度（出字以后挂到那条回答上）
  const [liveAgent, setLiveAgent] = useState<AgentExtras>({});
  // 做好的网页：点「打开」在隔离窗口里看
  const [artifactViewerId, setArtifactViewerId] = useState<string | null>(null);
  // 导入笔记：要导入的那一段 / 那个网页；导入完的提示（带「打开笔记」）
  const [importItem, setImportItem] = useState<ImportItem | null>(null);
  const [importNotice, setImportNotice] = useState<{ id: string; title: string } | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // -- History state ---------------------------------------------------------
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 「AI 记得什么」面板；删历史对话前先问一句（存要删的那段 id）
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
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
      deepThinking: zh ? '正在思考…' : 'Thinking…',
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

  // 整页左栏一直摆着历史对话：进整页时刷新一遍（别的设备、别的标签页里聊过的也列上）
  useEffect(() => {
    if (!pageLayout || !isOpen || !courseId) return;
    let cancelled = false;
    workspaceAgentApi.listConversations(courseId, spaceId)
      .then(({ conversations: list }) => { if (!cancelled) setConversations(prev => mergeConversations(prev, list)); })
      .catch(() => { /* 用已有的列表 */ });
    return () => { cancelled = true; };
  }, [pageLayout, isOpen, courseId, spaceId]);

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

  const removeConversation = useCallback(async (c: AgentConversation) => {
    setConfirmDeleteId(null);
    try {
      await workspaceAgentApi.deleteConversation(courseId, c.id);
      setConversations(prev => prev.filter(x => x.id !== c.id));
      if (c.id === conversationId) startNewChat();
    } catch {
      setError(zhUi ? '没删掉这段对话，再试一次。' : 'Could not delete this chat. Try again.');
    }
  }, [courseId, conversationId, startNewChat, zhUi]);

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

  /**
   * draw：输入框下面的「画图」，不管怎么措辞都直接出图。
   * override：点了选项卡上的一个，发的是「我选：……」，输入框里正在写的不动
   */
  const handleSend = useCallback(async (draw = false, override?: { text: string; choice: { question_id: string; label: string } }) => {
    const content = (override?.text ?? input).trim();
    // 挂了附件也要写一句问题才发（chatAttachments.ts）
    if (!content || streaming) return;
    if (!selectedProvider || !selectedModel) { setError(t.noProvider); return; }

    const turnAttachments = override ? [] : attachments;
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content, ...(override ? { choice: override.choice.label } : {}) };
    setMessages((prev) => [...prev, userMsg]);
    if (!override) {
      setInput('');
      setAttachments([]);
    }
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
    // 计划清单、选项卡、做好的网页：同样可能先于第一个字到
    let turnAgent: AgentExtras = {};
    // 流开始了就是服务端接下了这一问，提问已经存进库
    let accepted = false;
    let failed = false;
    // 出错时问题和附件都放回输入框，改一改或直接再发。服务端没接下的，对话里那条提问也撤掉
    const putBack = () => {
      if (!accepted) setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      if (override) return;
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
          ...(override ? { choice: override.choice } : {}),
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
        {
          const next = applyAgentEvent(turnAgent, event);
          if (next) {
            turnAgent = next;
            setLiveAgent(next);
            setMessages((prev) => prev.map((m) => (m.id === tempAssistantId ? { ...m, agent: next } : m)));
            return;
          }
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
              ...(hasExtras(turnAgent) ? { agent: turnAgent } : {}),
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
            // 写网页的进度只在这一轮里有意义
            ...(hasExtras(turnAgent) ? { agent: { ...turnAgent, progress: undefined } } : {}),
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
      setLiveAgent({});
      abortRef.current = null;
    }
  }, [input, streaming, selectedProvider, selectedModel, courseId, spaceId, contextNoteIds, attachments, conversationId, t.noProvider, messages]);

  /** 点了选项卡上的一个：当作学生说了「我选：……」 */
  const handleChoose = useCallback((question: AgentQuestion, option: AgentQuestionOption) => {
    void handleSend(false, { text: choiceReplyText(option, lang === 'zh' ? 'zh' : 'en'), choice: { question_id: question.id, label: option.label } });
  }, [handleSend, lang]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && enterToSend && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void handleSend(); }
  }, [handleSend, enterToSend]);

  // -- Render ----------------------------------------------------------------

  const motionRef = useAiSurfaceMotion({ open: embedded || isOpen, ready: !restoring && !openingId, floating: !embedded && !pageLayout });
  const emptyChat = messages.length === 0 && !streaming;
  const turnArtifacts = latestArtifacts(messages.flatMap(m => m.agent?.artifacts ?? []));
  const importText = (msg: ChatMessage) => setImportItem({
    kind: 'text', text: msg.content, providerId: selectedProvider || 'auto', model: selectedModel || 'auto',
    sourceMessageId: msg.id, conversationId,
  });
  const importArtifact = (artifact: AgentArtifactRef) => setImportItem({ kind: 'artifact', artifact, conversationId });

  // 历史对话下拉：侧栏放在面板顶上；整页只在窄屏（没有左栏）时放进整页顶栏
  const deleteConfirmRow = (c: AgentConversation) => (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-red-50/80 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">
      <span className="min-w-0 truncate">{zhUi ? '删掉这段对话？' : 'Delete this chat?'}</span>
      <span className="flex shrink-0 gap-1">
        <button type="button" onClick={() => void removeConversation(c)} className="rounded-lg bg-red-600 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 active:scale-[0.98]">{zhUi ? '删除' : 'Delete'}</button>
        <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded-lg px-2.5 py-1 font-medium transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 dark:hover:bg-red-900/40">{zhUi ? '取消' : 'Cancel'}</button>
      </span>
    </div>
  );

  const historyMenu = (className = '') => (
    <div ref={historyMenuRef} className={`relative ${className}`}>
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
              if (confirmDeleteId === c.id) return <li key={c.id}>{deleteConfirmRow(c)}</li>;
              return (
                <li key={c.id} className="flex items-center gap-0.5">
                  <button
                    type="button"
                    data-conversation-id={c.id}
                    aria-current={current ? 'true' : undefined}
                    disabled={streaming || openingId !== null}
                    title={streaming ? t.switchBlocked : undefined}
                    onClick={() => void openConversation(c)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(c.id)}
                    disabled={streaming}
                    aria-label={zhUi ? '删掉这段对话' : 'Delete this chat'}
                    title={zhUi ? '删掉这段对话' : 'Delete this chat'}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-40 sm:h-8 sm:w-8 dark:hover:bg-red-950/40"
                  >
                    <RemixIcon name="delete-bin-6-line" size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );

  // 选 Note 的菜单：侧栏和窄屏整页挂在对话上方那一行，宽屏整页挂在右栏「参考范围」下面，同一时刻只挂一处
  const notePickerMenu = notePickerOpen && (
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
  );

  const panel = (
    <div
      ref={motionRef}
      data-ai-motion-floating={(!embedded && !pageLayout) || undefined}
      data-large-text={largeText}
      data-ws-agent-panel
      role="complementary"
      aria-label={t.title}
      aria-hidden={!embedded && !isOpen}
      inert={!embedded && !isOpen}
      data-layout={layout}
      className={`ai-motion-surface assistant-panel ${embedded || pageLayout
        ? 'relative w-full h-full min-w-0 flex-1 flex flex-col bg-white dark:bg-gray-900'
        : `fixed inset-y-0 right-0 z-50 max-w-full bg-white dark:bg-gray-900 shadow-2xl shadow-black/10 border-l border-gray-200 dark:border-gray-800 flex flex-col`
      }`}
      style={embedded || pageLayout ? undefined : { width: `${panelWidth}px` }}
    >
      {!embedded && !pageLayout && <div
        className="absolute inset-y-0 left-0 w-1 cursor-col-resize hover:w-1.5 hover:bg-[#000080]/15 active:bg-[#000080]/25 transition-all z-10"
        onMouseDown={handleDragStart}
      />}

      {/* ── Header：一行。标题、今日用量、新对话、历史对话、关闭（整页有自己的顶栏，这里不画） ─── */}
      {!pageLayout && (
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
          {historyMenu()}
          {!embedded && <button type="button" onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            aria-label={lang === 'zh' ? '关闭' : 'Close'}>
            <X size={18} />
          </button>}
        </div>
      </div>
      )}

      {!scopeInRail && (
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
          {notePickerMenu}
        </div>
      )}

      {/* 讨论速览：收成一行，点开才展开。在开始聊之前先看清这一批笔记里有什么（整页宽屏时在右栏） */}
      {spaceId && !scopeInRail && (
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
            <div data-agent-empty className="flex min-h-full flex-col">
              <AssistantWelcome scope="space" variant={pageLayout ? 'page' : 'panel'} lang={lang === 'zh' ? 'zh' : 'en'} disabled={providers.length === 0}
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
                      <AgentPlanBlock plan={msg.agent?.plan} progress={msg.id.startsWith('stream-') ? msg.agent?.progress : undefined} lang={lang === 'zh' ? 'zh' : 'en'} />
                      {msg.agent?.artifacts && <ArtifactCards artifacts={msg.agent.artifacts} onOpen={setArtifactViewerId} onImport={importArtifact} lang={lang === 'zh' ? 'zh' : 'en'} />}
                      <MarkdownMessage content={msg.content} resolveUrl={url => `${BASE_URL}${url.slice(4)}`} />
                      <KbSourceCards
                        sources={msg.kbSources ?? []}
                        content={msg.content}
                        streaming={msg.id.startsWith('stream-')}
                        lang={lang === 'zh' ? 'zh' : 'en'}
                        onOpen={onOpenKbSource}
                      />
                      {msg.agent && (() => {
                        const later = messages.slice(index + 1).find((m) => m.role === 'user');
                        return (
                          <AgentDeliverables
                            extras={msg.agent}
                            laterUserText={later ? later.content : null}
                            choiceLabel={later?.choice ?? null}
                            disabled={streaming}
                            onChoose={handleChoose}
                            onOther={() => { setInput((prev) => (prev.trim() ? prev : (lang === 'zh' ? '我的想法：' : 'My idea: '))); inputRef.current?.focus(); }}
                            lang={lang === 'zh' ? 'zh' : 'en'}
                            contentShowsQuestion={Boolean(msg.agent.question) && msg.content.trim() === msg.agent.question?.question}
                          />
                        );
                      })()}
                    </>
                  )
                  : msg.content}
              </div>
              {msg.role === 'assistant' && !msg.id.startsWith('stream-') && msg.content.trim() && (
                <div className={`flex flex-wrap gap-1.5 ${pageLayout ? '-ml-2' : ''}`}>
                  <button
                    type="button"
                    data-import-answer
                    onClick={() => importText(msg)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 py-1 text-[0.6875rem] font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-[#000080] dark:text-zinc-400 dark:hover:bg-gray-800 dark:hover:text-[#93AAFD]"
                  >
                    <RemixIcon name="file-transfer-line" size={12} />{lang === 'zh' ? '导入笔记' : 'Import into a note'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {streaming && drawing && (
          <DrawingProgress {...drawing} lang={lang} />
        )}

        {/* 还没开始写：一步步显示在做什么（2026-10-05 用户：等的时候别让学生觉得无聊）。
            不显示模型的原始思考，只说「正在思考」 */}
        {streaming && !drawing && !messages.some((m) => m.id.startsWith('stream-') && m.content) && (
          <>
            <AgentProcess
              steps={activeTools}
              phase="waiting"
              startedAt={turnStartedAtRef.current}
              thinking={Boolean(reasoningText)}
              lang={lang === 'zh' ? 'zh' : 'en'}
            />
            <AgentPlanBlock plan={liveAgent.plan} progress={liveAgent.progress} lang={lang === 'zh' ? 'zh' : 'en'} />
          </>
        )}
        {artifactViewerId && <ArtifactViewer artifactId={artifactViewerId} onClose={() => setArtifactViewerId(null)} lang={lang === 'zh' ? 'zh' : 'en'} />}
        {importItem && (
          <ImportToNoteDialog
            item={importItem}
            notes={spaceNotes}
            currentUserId={currentUserId}
            lang={lang === 'zh' ? 'zh' : 'en'}
            onClose={() => setImportItem(null)}
            onDone={async (note) => {
              // 导入了回答：记成「关键时刻」（网页挂到笔记由后端自己记；学生关了记忆后端就不记）
              if (importItem.kind === 'text' && userRole === 'student') void memoryApi.recordImport(courseId, note.id, zhUi ? 'zh' : 'en').catch(() => {});
              setImportItem(null);
              // 画布手里的笔记是旧正文：先重拉，之后打开这条笔记才看得到导入的内容，也不会被旧正文存回去盖掉
              await Promise.resolve(onNotesChanged?.()).catch(() => {});
              setImportNotice(note);
            }}
          />
        )}
        {importNotice && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <RemixIcon name="checkbox-circle-line" size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{lang === 'zh' ? `已导入笔记《${importNotice.title || '未命名笔记'}》` : `Imported into "${importNotice.title || 'Untitled note'}"`}</span>
            {onOpenNote && (
              <button type="button" onClick={() => { const id = importNotice.id; setImportNotice(null); onOpenNote(id); }} className="shrink-0 rounded-md px-2 py-1 font-semibold text-emerald-900 hover:bg-emerald-100 dark:text-emerald-100 dark:hover:bg-emerald-900/50">
                {lang === 'zh' ? '打开笔记' : 'Open note'}
              </button>
            )}
            <button type="button" aria-label={lang === 'zh' ? '关闭' : 'Dismiss'} onClick={() => setImportNotice(null)} className="shrink-0 rounded-md p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"><X size={12} /></button>
          </div>
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

  if (!pageLayout) return panel;
  if (!isOpen) return null;

  const zh = lang === 'zh';
  const answers = messages.filter(m => m.role === 'assistant' && !m.id.startsWith('stream-') && m.content.trim()).slice(-8).reverse();
  const threadGroups = groupConversationsByDay(conversations, zh);
  const scopeTitles = spaceNotes.filter(n => contextNoteIds.has(n.id)).map(n => n.title || (zh ? '（无标题）' : '(Untitled)'));
  const pagePrompt = zh
    ? '把这个空间里的主要观点做成一张对比表网页：每个观点写清楚是谁提的、依据是什么、还缺什么证据。'
    : 'Turn the main ideas in this space into a comparison page: who proposed each idea, what it rests on, and what evidence is still missing.';
  const fillComposer = (text: string) => { setInput(text); requestAnimationFrame(() => inputRef.current?.focus()); };
  const railLabel = 'mb-2.5 flex items-baseline gap-1.5 text-[0.6875rem] font-semibold tracking-wide text-zinc-500 dark:text-zinc-400';
  const gridCols = wideAgentPage
    ? 'lg:grid-cols-[12rem_minmax(0,1fr)_16rem] 2xl:grid-cols-[13.5rem_minmax(0,1fr)_18rem]'
    : 'lg:grid-cols-[12rem_minmax(0,1fr)]';

  return (
    <div className="agent-page safe-area-top fixed inset-0 z-[90] flex flex-col bg-[#f4f6fa] dark:bg-gray-950" data-ws-agent-page>
      {memoryOpen && <MemoryPanel courseId={courseId} lang={zh ? 'zh' : 'en'} surface="workspace" conversationId={conversationId} onClose={() => setMemoryOpen(false)} />}
      {/* 顶栏：返回、名字、新对话。窄屏没有左栏，用量和历史对话也放在这里 */}
      <header data-enter className="flex h-16 shrink-0 items-center gap-2 px-3 [--enter-i:0] sm:gap-3 sm:px-5">
        <button
          type="button"
          onClick={onClose}
          aria-label={zh ? '返回画布' : 'Back to canvas'}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-zinc-600 transition-all duration-200 hover:bg-white hover:text-zinc-900 hover:shadow-[0_1px_3px_rgba(30,58,138,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 active:scale-[0.98] dark:text-zinc-300 dark:hover:bg-gray-900 dark:hover:text-zinc-50"
        >
          <RemixIcon name="arrow-left-line" size={17} />
          <span className="hidden sm:inline">{zh ? '返回画布' : 'Back to canvas'}</span>
        </button>
        <span aria-hidden="true" className="hidden h-6 w-px bg-zinc-200 sm:block dark:bg-gray-800" />
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-[#000080] shadow-[0_1px_2px_rgba(30,58,138,0.06)] dark:border-gray-800 dark:bg-gray-900 dark:text-[#93AAFD]">
            <RemixIcon name="node-tree" size={19} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[0.9375rem] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{t.title}</h1>
            <p className="hidden truncate text-[0.6875rem] text-zinc-500 sm:block dark:text-zinc-400">{zh ? '连接观点 · 共同探究 · 动手做成网页' : 'Connect ideas · Explore together · Build pages'}</p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {usageInfo && (
            <span
              title={t.usageTip(usageInfo.today, usageInfo.daily_limit, usageInfo.remaining)}
              className={`rounded-full px-2.5 py-1 text-[0.6875rem] tabular-nums lg:hidden ${usageInfo.remaining <= 10 ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400' : 'text-zinc-500'}`}
            >
              {usageInfo.today}/{usageInfo.daily_limit}
            </span>
          )}
          {userRole === 'student' && (
            <button
              type="button"
              onClick={() => setMemoryOpen(true)}
              aria-label={zh ? 'AI 记得什么' : 'What the AI remembers'}
              title={zh ? 'AI 记得什么' : 'What the AI remembers'}
              data-memory-open
              className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-zinc-600 transition-all duration-200 hover:bg-white hover:text-zinc-900 hover:shadow-[0_1px_3px_rgba(30,58,138,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 active:scale-[0.98] dark:text-zinc-300 dark:hover:bg-gray-900 dark:hover:text-zinc-50"
            >
              <RemixIcon name="bookmark-3-line" size={16} />
              <span className="hidden md:inline">{zh ? 'AI 记得什么' : 'Memory'}</span>
            </button>
          )}
          {historyMenu('lg:hidden')}
          <button
            type="button"
            onClick={startNewChat}
            disabled={streaming}
            title={streaming ? t.switchBlocked : t.newChat}
            aria-label={t.newChat}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#000080] px-3.5 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgba(0,0,128,0.55)] transition-all duration-200 hover:bg-[#000080]/90 hover:shadow-[0_10px_22px_-10px_rgba(0,0,128,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 dark:bg-[#93AAFD] dark:text-gray-950"
          >
            <RemixIcon name="chat-new-line" size={16} />
            <span className="hidden sm:inline">{t.newChat}</span>
          </button>
        </div>
      </header>

      <div className={`grid min-h-0 flex-1 gap-3 px-2 pb-2 sm:px-3 sm:pb-3 ${gridCols}`}>
        {/* 左栏：历史对话，直接放在桌面上；底下是今天的用量 */}
        <aside data-enter className="hidden min-h-0 flex-col [--enter-i:1] lg:flex" aria-label={t.history} data-ws-agent-threads>
          <div className="flex items-baseline justify-between px-2.5 pb-2 pt-1">
            <p className="text-[0.6875rem] font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">{t.history}</p>
            {conversations.length > 0 && <span className="text-[0.6875rem] tabular-nums text-zinc-400">{conversations.length}</span>}
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 pr-1">
            {threadGroups.length === 0 && (
              <p className="px-2.5 py-6 text-xs leading-5 text-zinc-400">{zh ? '还没有历史对话。问过的会按日子排在这里。' : 'No earlier chats yet. They will be listed here by day.'}</p>
            )}
            {threadGroups.map(group => (
              <div key={group.label} className="mb-4">
                <p className="px-2.5 pb-1.5 text-[0.625rem] font-medium text-zinc-400 dark:text-zinc-500">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map(c => {
                    const current = c.id === conversationId;
                    if (confirmDeleteId === c.id) return <li key={c.id}>{deleteConfirmRow(c)}</li>;
                    return (
                      <li key={c.id} className="group/row relative">
                        <button
                          type="button"
                          data-conversation-id={c.id}
                          aria-current={current ? 'true' : undefined}
                          disabled={streaming || openingId !== null}
                          title={streaming ? t.switchBlocked : conversationLabel(c, lang)}
                          onClick={() => void openConversation(c)}
                          className={`group relative flex w-full items-center gap-2 rounded-xl py-2 pl-3 pr-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/25 disabled:cursor-not-allowed disabled:opacity-60 ${current
                            ? 'bg-white shadow-[0_1px_3px_rgba(30,58,138,0.08)] dark:bg-gray-900'
                            : 'hover:bg-white/70 dark:hover:bg-gray-900/60'}`}
                        >
                          {current && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[#000080] dark:bg-[#93AAFD]" />}
                          <span className={`min-w-0 flex-1 truncate text-[0.8125rem] ${current ? 'font-semibold text-zinc-900 dark:text-zinc-50' : 'text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-300 dark:group-hover:text-zinc-50'}`}>{conversationLabel(c, lang)}</span>
                          {openingId === c.id
                            ? <Loader2 size={12} className="shrink-0 animate-spin text-zinc-400" />
                            : <span className="shrink-0 text-[0.625rem] tabular-nums text-zinc-400 transition-opacity group-focus-within/row:opacity-0 group-hover/row:opacity-0">{threadTimeInGroup(c.updated_at, group.key, zh)}</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(c.id)}
                          disabled={streaming}
                          aria-label={zh ? '删掉这段对话' : 'Delete this chat'}
                          title={zh ? '删掉这段对话' : 'Delete this chat'}
                          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-400 opacity-0 transition-all duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 group-focus-within/row:opacity-100 group-hover/row:opacity-100 disabled:hidden dark:hover:bg-red-950/40"
                        >
                          <RemixIcon name="delete-bin-6-line" size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          {usageInfo && (
            <div className="mt-2 rounded-2xl border border-zinc-200/70 bg-white/60 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/50" title={t.usageTip(usageInfo.today, usageInfo.daily_limit, usageInfo.remaining)}>
              <div className="flex items-baseline justify-between text-[0.6875rem]">
                <span className="text-zinc-500 dark:text-zinc-400">{zh ? '今天已问' : 'Asked today'}</span>
                <span className={`font-semibold tabular-nums ${usageInfo.remaining <= 10 ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-200'}`}>{usageInfo.today} / {usageInfo.daily_limit}</span>
              </div>
              <progress
                className="agent-usage-meter mt-2"
                value={Math.min(usageInfo.today, usageInfo.daily_limit)}
                max={Math.max(usageInfo.daily_limit, 1)}
                aria-label={zh ? '今天的用量' : 'Usage today'}
              />
            </div>
          )}
        </aside>

        {/* 中间：一张稿纸 */}
        <div data-enter className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/70 bg-white shadow-[0_1px_2px_rgba(30,58,138,0.04),0_18px_48px_-24px_rgba(30,58,138,0.22)] [--enter-i:1] dark:border-gray-800 dark:bg-gray-900">
          {panel}
        </div>

        {/* 右栏：它在读什么、这段对话做出了什么。每样都能打开、导入笔记 */}
        {wideAgentPage && (
          <aside data-enter className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/70 bg-white/55 backdrop-blur-sm [--enter-i:2] dark:border-gray-800 dark:bg-gray-900/50" aria-label={zh ? '这段对话' : 'This chat'} data-ws-agent-outputs>
            <div className="min-h-0 flex-1 divide-y divide-zinc-200/60 overflow-y-auto overscroll-contain dark:divide-gray-800">
              <section className="px-4 pb-4 pt-5">
                <p className={railLabel}>{zh ? '参考范围' : 'Reading'}</p>
                <div ref={notePickerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setNotePickerOpen(v => !v)}
                    aria-expanded={notePickerOpen}
                    aria-label={zh ? '选择 Note' : 'Choose Notes'}
                    className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white px-3 py-2.5 text-left transition-all duration-200 hover:border-[#000080]/25 hover:shadow-[0_6px_18px_-12px_rgba(30,58,138,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/25 active:scale-[0.99] dark:border-gray-700 dark:bg-gray-900"
                  >
                    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#000080]/[0.06] text-[#000080] dark:bg-[#93AAFD]/10 dark:text-[#93AAFD]">
                      <RemixIcon name={contextNoteIds.size > 0 ? 'checkbox-multiple-line' : 'stack-line'} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8125rem] font-semibold text-zinc-900 dark:text-zinc-100">
                        {contextNoteIds.size > 0 ? (zh ? `选了 ${contextNoteIds.size} 条笔记` : `${contextNoteIds.size} notes picked`) : t.wholeSpace}
                      </span>
                      <span className="block truncate text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
                        {contextNoteIds.size > 0 ? scopeTitles.join('、') : (zh ? `${spaceNotes.length} 条笔记都会参考` : `All ${spaceNotes.length} notes`)}
                      </span>
                    </span>
                    <RemixIcon name="arrow-down-s-line" size={16} className={`shrink-0 text-zinc-400 transition-transform duration-200 ${notePickerOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {notePickerMenu}
                </div>
              </section>

              {spaceId && (
                <section className="py-1.5 [&>div]:border-b-0">
                  <DiscussionDigestPanel
                    collapsible
                    courseId={courseId}
                    spaceId={spaceId}
                    viewId={viewId}
                    selectedNoteIds={selectedNoteIds}
                    groupId={groupId}
                    lang={zh ? 'zh' : 'en'}
                    onLocateNote={onLocateNote}
                  />
                </section>
              )}

              <section className="px-4 py-4">
                <p className={railLabel}>
                  {zh ? '做出来的网页' : 'Pages'}
                  {turnArtifacts.length > 0 && <span className="tabular-nums font-medium text-zinc-400">{turnArtifacts.length}</span>}
                </p>
                {turnArtifacts.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => fillComposer(pagePrompt)}
                    disabled={streaming}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-dashed border-zinc-300/80 px-3 py-3 text-left transition-all duration-200 hover:border-[#000080]/35 hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-900"
                  >
                    <PageGlyph muted />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.8125rem] font-semibold text-zinc-700 dark:text-zinc-200">{zh ? '还没有网页' : 'No pages yet'}</span>
                      <span className="mt-0.5 block text-[0.6875rem] leading-5 text-zinc-500 transition-colors group-hover:text-[#000080] dark:text-zinc-400 dark:group-hover:text-[#93AAFD]">{zh ? '试试：把观点做成对比表网页' : 'Try: turn the ideas into a comparison page'}</span>
                    </span>
                  </button>
                ) : (
                  <ul className="space-y-2.5">
                    {turnArtifacts.map(a => (
                      <li key={a.groupId} className="rounded-2xl border border-zinc-200/80 bg-white p-3 transition-all duration-200 hover:border-[#000080]/20 hover:shadow-[0_10px_28px_-16px_rgba(30,58,138,0.4)] dark:border-gray-700 dark:bg-gray-900">
                        <div className="flex gap-3">
                          <PageGlyph />
                          <div className="min-w-0 flex-1 py-0.5">
                            <p className="line-clamp-2 text-[0.8125rem] font-semibold leading-5 text-zinc-900 dark:text-zinc-100">{a.title}</p>
                            <p className="mt-1 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{zh ? `第 ${a.version} 版` : `v${a.version}`}{a.bytes ? ` · ${formatBytes(a.bytes)}` : ''}</p>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-1.5">
                          <button type="button" onClick={() => setArtifactViewerId(a.id)} className="min-h-9 rounded-xl bg-[#000080] text-[0.75rem] font-semibold text-white transition-all duration-200 hover:bg-[#000080]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30 active:scale-[0.98] dark:bg-[#93AAFD] dark:text-gray-950">{zh ? '打开' : 'Open'}</button>
                          <button type="button" onClick={() => importArtifact(a)} className="min-h-9 rounded-xl border border-zinc-200 text-[0.75rem] font-semibold text-zinc-700 transition-colors duration-200 hover:border-[#000080]/25 hover:text-[#000080] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/25 dark:border-gray-700 dark:text-zinc-200 dark:hover:text-[#93AAFD]">{zh ? '导入笔记' : 'Import'}</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="px-4 pb-6 pt-4">
                <p className={railLabel}>{zh ? '可以留下的回答' : 'Answers to keep'}</p>
                {answers.length === 0
                  ? <p className="text-xs leading-5 text-zinc-400">{zh ? '聊过以后，觉得有用的回答可以从这里导入你的笔记。' : 'Useful answers can be imported into your notes from here.'}</p>
                  : (
                    <ul className="-mx-1 space-y-1">
                      {answers.map(m => (
                        <li key={m.id} className="rounded-xl px-2.5 py-2 transition-colors duration-200 hover:bg-white dark:hover:bg-gray-900">
                          <p className="line-clamp-3 text-xs leading-5 text-zinc-600 dark:text-zinc-300">{m.content.replace(/[#*`>|_-]+/g, ' ').replace(/\s+/g, ' ').trim()}</p>
                          <button type="button" onClick={() => importText(m)} className="mt-1 inline-flex min-h-7 items-center gap-1 rounded-md text-[0.6875rem] font-semibold text-[#000080] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/25 dark:text-[#93AAFD]">
                            <RemixIcon name="file-transfer-line" size={12} />{zh ? '导入笔记' : 'Import into a note'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </section>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default WorkspaceAgentPanel;
