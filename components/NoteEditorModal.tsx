import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { TRIGGER_TYPE_LABEL } from './feedbackLabels';
import { normalizeScaffoldMarkers } from './scaffoldLibrary';
import DOMPurify from 'dompurify';
import {
  AlertCircle,
  AlignLeft,
  Baseline,
  Bold,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  CornerDownRight,
  FileText,
  Heading1,
  Heading2,
  History,
  Image as ImageIcon,
  Info,
  Italic,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  TextCursorInput,
  Trash2,
  Underline,
  Undo2,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import {
  ai as aiApi,
  ApiClientError,
  ApiNote,
  ApiAIConfig,
  ApiRelation,
  RelationType,
  noteAiFeedback,
  NoteAIFeedback,
  NoteAIFeedbackStatus,
  feedback as teacherFeedbackApi,
  NoteFeedbackApi,
  noteConversations,
  NoteConversationMessage,
  NoteConversationThread,
  notes as notesApi,
  NoteRevision,
  relations as relationsApi,
  trackEvent,
  type PartnerModelPolicy,
} from '../services/apiClient';
import { modelOptionLabel, modelSpeedHint, providerDisplayName } from './aiModelLabels';
import { uploadAttachment, MAX_ATTACHMENT_BYTES } from '../services/attachmentUpload';
import { attachmentQuestionHint, restoreTurnAttachments } from './chatAttachments';
import { Language, Note, Scaffold, UserRole } from '../types';
import ScaffoldPicker from './ScaffoldPicker';
import {
  SCAFFOLD_CARET_SELECTOR,
  isEmptyScaffoldSlot,
  isGenAiScaffold,
  scaffoldLabel,
  scaffoldMarkerHtml, extractScaffoldIds,
  stripScaffoldPlaceholders,
} from './scaffoldLibrary';
import {
  buildPartnerModelOptions,
  decodePartnerModelValue,
  encodePartnerModelValue,
  getPartnerAgentModes,
  inferPartnerConfigsFromMessages,
  mergePartnerConfigs,
  normalizePartnerAgentMode,
  resolveConcretePartnerModelSelection,
  resolvePartnerModelSelection,
  shouldUseWebSearchForAgent,
  type PartnerAgentMode,
  type PartnerAgentModeSelection,
} from './noteAiPartnerModel';
import { settleOptimisticMessage } from './noteConversationMerge';
import {
  NOTE_AI_SPLIT_LAYOUT,
  clampNoteAiPanelWidth,
  resizeNoteAiPanelWidth,
} from './noteEditorSplitLayout';
import {
  containsBlock,
  hasVisibleContent,
  insertFragmentAtRange,
  replaceAtTopLevel,
  topLevelOf,
  wholeBlockOf,
} from './noteEditorBlocks';
import { BUILD_ON_MOVES, RELATION_COLORS } from './relationColors';
import { useMarkSeenAfterDwell } from './noteBadges';
import DrawingProgress from './DrawingProgress';
import AiThinking, { AiThinkingDots } from './AiThinking';
import AnswerLengthSelect from './AnswerLengthSelect';
import AssistantAgentPicker from './AssistantAgentPicker';
import AssistantWelcome from './AssistantWelcome';
import { useChatPreferences, ChatPreferenceControls } from '../hooks/useChatPreferences';
import { useGrowingTextarea } from '../hooks/useGrowingTextarea';
import RemixIcon from './RemixIcon';
import AgentProcess from './AgentProcess';
import KbSourceCards, { parseKbSources } from './KbSourceCards';
import { applyToolEvent, stepsFromMetadata } from './agentProcessSteps';
import type { ToolCallInfo } from './AgentToolCallDisplay';
import { getAnswerLength } from './answerLengthPref';
import { chooseDrawing, lastReplyFrom, previousDrawingFrom, type DrawChoice } from './drawRouting';
import {
  formatThreadTime,
  nextThreadAfterDelete,
  visibleHistoryThreads,
  withFirstQuestion,
  withThreadFirst,
} from './noteChatHistory';

interface NoteEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (title: string, content: string, tags: string[]) => void;
  initialData?: { title: string; content?: string; author?: string; date?: string; tags?: string[] };
  isBuildOn?: boolean;
  buildOnMoveType?: string;
  /** 新建的 Build-on 笔记接的是哪一条：笔记页左侧默认展开这条原笔记 */
  buildOnParentId?: string;
  isRiseAbove?: boolean;
  riseAboveCitedIds?: string[];
  lang?: Language;
  availableScaffolds?: Scaffold[];
  /** 本课程要求笔记必须带支架时，保存前拦截没有支架的正文 */
  requireScaffold?: boolean;
  courseId?: string;
  userId?: string;
  spaceId?: string;
  noteId?: string;
  noteX?: number;
  noteY?: number;
  allNotes?: Note[];
  allEdges?: SnapshotEdge[];
  /** 把还没保存的新笔记落库，返回真实 id。AI 对话的 note_id 是 NOT NULL，没有它就开不了线程。 */
  onPersistDraft?: (title: string, content: string) => Promise<string | null>;
  /**
   * 打开时预先挂在 AI 输入框上的附件。
   * 走「带这份文档问 AI」进来时用：文档已经在存储里、正文也抽好了，
   * 学生一进来就能直接提问，不必再传一次。
   */
  initialAiAttachment?: { file_url: string; file_name: string; mime_type: string; text?: string } | null;
  currentViewId?: string;
  onAiNotePublished?: (note: ApiNote, relation: ApiRelation) => void;
  /** AI 回答下面的来源卡片：打开那份附件，PDF 跳到那一页。不给就不能点（手机端没有阅读页） */
  onOpenKbSource?: (noteId: string, page: number | null) => void;
  userRole?: UserRole;
  /**
   * 课程教职（按课内身份）。教师反馈是给作者看的：非教职打开自己的笔记就把反馈记为已读，
   * 在这门课里只是普通成员的教师账号也一样。不传（手机端拿不到课内身份）时按平台身份。
   */
  isStaff?: boolean;
  onTeacherFeedbackRead?: (noteId: string, feedbackId: string) => void;
  /** 打开的是别人的笔记：右下角 Build-on 菜单选了一种方式。由画布（或手机端）开一条新的 Build-on 笔记 */
  onBuildOn?: (parentNoteId: string, relationType: RelationType) => void;
}

interface PendingAiInsert {
  text: string;
  sourceMessageId?: string;
  feedbackId?: string;
  providerId?: string;
  model?: string;
}

interface PendingAiPublish {
  text: string;
  sourceMessageId?: string;
  sourceConversationId?: string;
  providerId?: string;
  model?: string;
}

interface AiSelectionMenu {
  text: string;
  messageId?: string;
  providerId?: string;
  model?: string;
  x: number;
  y: number;
}

// 颜色和画布连线同一份（RELATION_PALETTE），此前这里另写了一套 Tailwind 原色
const BUILD_ON_META: Record<string, { label: string; labelZh: string; color: string }> = {
  extend: { label: 'Extend', labelZh: '延伸', color: RELATION_COLORS.extend },
  clarify: { label: 'Clarify', labelZh: '澄清', color: RELATION_COLORS.clarify },
  question: { label: 'Question', labelZh: '提问', color: RELATION_COLORS.question },
  challenge: { label: 'Challenge', labelZh: '质疑', color: RELATION_COLORS.challenge },
  evidence: { label: 'Evidence', labelZh: '证据', color: RELATION_COLORS.evidence },
  synthesize: { label: 'Synthesize', labelZh: '综合', color: RELATION_COLORS.synthesize },
};

type TabId = 'edit' | 'read' | 'connections' | 'info';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  deepseek: 'DeepSeek',
  dmx: 'DMXAPI',
  dmxapi: 'DMXAPI',
  moonshot: 'Kimi',
  doubao: 'Doubao',
  xai: 'Grok',
  baidu: 'Wenxin',
  alibaba: 'Qwen',
  zhipu: 'Zhipu',
  openrouter: 'OpenRouter',
};

/**
 * 教师没显式选模型时的兜底清单。
 *
 * 这里的名字全部对照 DMXAPI 官方价目表和实测探测（2026-09）核过。
 * 之前躺着 claude-sonnet-4-5、glm-5v-turbo、moonshot-v1-8k 这些早已下线的名字——
 * 学生一旦落到它们身上就必然失败，表现出来就是「AI 时好时坏」。
 * 新增/下线模型时，同时更新 api/src/services/modelCatalog.ts。
 */
const DEFAULT_PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-5.5', 'gpt-5-mini'],
  anthropic: ['claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  google: ['gemini-2.5-flash'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  dmx: ['glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.5', 'claude-opus-4-6', 'glm-4.6v'],
  dmxapi: ['glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.5', 'claude-opus-4-6', 'glm-4.6v'],
  moonshot: ['kimi-k3'],
  doubao: ['doubao-pro-32k'],
  xai: ['grok-2'],
  baidu: ['ernie-4.0-8k'],
  alibaba: ['qwen3.8-max', 'qwen3.6-plus', 'qwen3.8-flash'],
  zhipu: ['glm-5.3', 'glm-5.2', 'glm-4.7', 'glm-4.6', 'glm-5.3-flash', 'glm-4.5-air', 'glm-4.6v', 'glm-4.5v'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet'],
};

const AI_CONFIG_REFRESH_INTERVAL_MS = 120000;

/** 流式回复的临时消息（还没有一个字）：状态到了才有，回复说完会被真消息换掉 */
const isEmptyStreamPlaceholder = (message: NoteConversationMessage) =>
  message.id.startsWith('stream-') && !message.content.trim();

function mergeCourseAiConfigs(...configLists: ApiAIConfig[][]): ApiAIConfig[] {
  const configMap = new Map<string, ApiAIConfig>();

  for (const config of configLists.flat()) {
    const existing = configMap.get(config.providerId);
    configMap.set(config.providerId, existing
      ? {
          ...existing,
          ...config,
          isVerified: existing.isVerified || config.isVerified,
          enabledModels: Array.from(new Set([...(existing.enabledModels ?? []), ...(config.enabledModels ?? [])])),
          configuredAt: config.configuredAt || existing.configuredAt,
          apiKeyMasked: config.apiKeyMasked || existing.apiKeyMasked,
        }
      : config);
  }

  return Array.from(configMap.values())
    .filter(config => config.isVerified || config.providerId === 'tavily' || (config.enabledModels?.length ?? 0) > 0);
}

/** 下拉框和提示里的模型名：可读的名字（DeepSeek Flash），不是原始 id */
function formatPartnerModelLabel(providerId: string, model: string, lang: Language = 'zh') {
  const l = lang === 'zh' ? 'zh' : 'en';
  if (providerId === 'auto' && model === 'auto') return l === 'zh' ? '默认' : 'Default';
  return modelOptionLabel(providerId, model, l);
}

/** 悬停时看到全名：模型、厂商和速度提示，下拉框窄的时候靠它看全 */
function partnerModelTitle(providerId: string, model: string, lang: Language = 'zh') {
  const l = lang === 'zh' ? 'zh' : 'en';
  if (providerId === 'auto') return undefined;
  const speed = modelSpeedHint(providerId, model, l);
  return [modelOptionLabel(providerId, model, l), providerDisplayName(providerId, l), speed?.text].filter(Boolean).join(' · ');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripHtml(value?: string): string {
  return (value ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function hashText(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return `${value.length}:${hash}`;
}

import MarkdownMessage, { isSafeHttpUrl, shortenUrl, readTable } from './chatMarkdown';
import { renderCanvasSnapshot, type SnapshotEdge } from './canvasSnapshot';
import { useDismissible } from '../hooks/useDismissible';

function formatTime(value?: string, locale: Language = 'en') {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** 正文色刻意不用纯黑（#000）；#0c0a09 跟支架方括号里的正文色一致。 */
const NOTE_TEXT_COLORS = [
  { value: '#0c0a09', label: { zh: '正文', en: 'Body' } },
  { value: '#000080', label: { zh: '藏青', en: 'Navy' } },
  { value: '#b91c1c', label: { zh: '红', en: 'Red' } },
  { value: '#15803d', label: { zh: '绿', en: 'Green' } },
  { value: '#c2410c', label: { zh: '橙', en: 'Orange' } },
  { value: '#71717a', label: { zh: '灰', en: 'Grey' } },
] as const;

function renderInlineMarkdownToHtml(value: string) {
  return value
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"']+)/g)
    .filter(Boolean)
    .map(part => {
      if (part.startsWith('**') && part.endsWith('**')) return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
      if (part.startsWith('`') && part.endsWith('`')) return `<code style="background:#f1f5f9;color:#334155;border-radius:4px;padding:1px 5px;font-size:.92em;">${escapeHtml(part.slice(1, -1))}</code>`;
      const markdownLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (markdownLink && isSafeHttpUrl(markdownLink[2])) {
        return `<a href="${escapeHtml(markdownLink[2])}" target="_blank" rel="noreferrer" style="color:#0f6ca6;text-decoration:underline;word-break:break-word;">${escapeHtml(markdownLink[1])}</a>`;
      }
      if (part.startsWith('http') && isSafeHttpUrl(part)) {
        return `<a href="${escapeHtml(part)}" target="_blank" rel="noreferrer" style="color:#0f6ca6;text-decoration:underline;word-break:break-word;">${escapeHtml(shortenUrl(part))}</a>`;
      }
      return escapeHtml(part);
    })
    .join('');
}

function renderMarkdownToHtml(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul style="margin:8px 0 8px 20px;padding:0;">${listItems.map(item => `<li style="margin:4px 0;line-height:1.65;">${renderInlineMarkdownToHtml(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) {
      flushList();
      continue;
    }
    // 表格：学生把 AI 的回答采纳进笔记时，表格要跟着进去，不能退化成一行行竖线
    const table = readTable(lines, index);
    if (table) {
      flushList();
      const cell = 'border:1px solid #e2e8f0;padding:6px 10px;vertical-align:top;line-height:1.6;';
      html.push(
        `<table style="border-collapse:collapse;width:100%;margin:10px 0;font-size:.92em;"><thead><tr>${table.header
          .map((h, c) => `<th style="${cell}background:#f1f5f9;font-weight:700;text-align:${table.align[c]};">${renderInlineMarkdownToHtml(h)}</th>`).join('')}</tr></thead><tbody>${table.rows
          .map(row => `<tr>${row.map((d, c) => `<td style="${cell}text-align:${table.align[c]};">${renderInlineMarkdownToHtml(d)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      index = table.next - 1;
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      listItems.push((bullet ?? numbered)?.[1] ?? line);
      continue;
    }
    flushList();
    if (line.startsWith('### ')) {
      html.push(`<h4 style="margin:10px 0 4px;font-size:14px;line-height:1.5;font-weight:700;color:#0f172a;">${renderInlineMarkdownToHtml(line.slice(4))}</h4>`);
    } else if (line.startsWith('## ')) {
      html.push(`<h3 style="margin:12px 0 6px;font-size:15px;line-height:1.5;font-weight:700;color:#0f172a;">${renderInlineMarkdownToHtml(line.slice(3))}</h3>`);
    } else if (line === '---') {
      html.push('<hr style="border:0;border-top:1px solid #cbd5e1;margin:12px 0;" />');
    } else {
      html.push(`<p style="margin:6px 0;line-height:1.75;">${renderInlineMarkdownToHtml(line)}</p>`);
    }
  }
  flushList();
  return html.join('');
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
      const line = part.split('\n').find(item => item.startsWith('data: '));
      if (!line) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        onEvent('[DONE]');
        continue;
      }
      try {
        onEvent(JSON.parse(data));
      } catch {
        // Ignore malformed SSE chunks.
      }
    }
  }
}

const NoteEditorModal: React.FC<NoteEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  isBuildOn,
  buildOnMoveType,
  buildOnParentId,
  isRiseAbove,
  riseAboveCitedIds = [],
  lang = 'en',
  availableScaffolds: courseScaffolds = [], requireScaffold = false,
  courseId,
  userId,
  spaceId,
  noteId,
  allNotes = [],
  allEdges = [],
  onPersistDraft,
  initialAiAttachment,
  currentViewId,
  onAiNotePublished,
  onOpenKbSource,
  userRole,
  isStaff,
  onTeacherFeedbackRead,
  onBuildOn,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('edit');
  const [title, setTitle] = useState(initialData?.title ?? '');
  const [wordCount, setWordCount] = useState(0);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [connections, setConnections] = useState<ApiRelation[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [revisions, setRevisions] = useState<NoteRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [aiConfigs, setAiConfigs] = useState<ApiAIConfig[]>([]);
  const [threads, setThreads] = useState<NoteConversationThread[]>([]);
  const [recentThreadsOpen, setRecentThreadsOpen] = useState(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  /** 历史对话里正等着确认删除的那一段 */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** 正在打开一段对话（它的消息还在路上）：面板显示「正在打开」，不显示上一段的内容。不挡提问——那条竞态另有守卫 */
  const [threadLoading, setThreadLoading] = useState(false);
  /** 面板上眼下显示的是哪一段的消息。换了一段才清面板；同一段刷新历史不闪 */
  const shownThreadRef = useRef<string | null>(null);
  /** 这次编辑里删掉的对话：发在删除之前、晚到的列表不能把它们带回来 */
  const deletedThreadIdsRef = useRef<Set<string>>(new Set());
  /** 这一轮问答开始的时刻。等待动画的秒数从这里算，从「还没有回复」换到「有了状态」也不重来 */
  const aiTurnStartedAtRef = useRef(0);
  /** 刚换了一段对话、它的消息刚到：对话区要贴到最底下（最新的一条），不是停在开头 */
  const stickAfterSwitchRef = useRef(false);
  /**
   * 对话区眼下是不是贴着底部（只由滚动事件更新）。内容增长不会改它，所以回复一大块一大块地流出来、
   * 或者提问后一下子多出两个气泡，都不会被误当成「学生往上翻了」；学生真往上翻，它才变 false，面板就不再拽他回底部。
   * 以前是内容渲染完再量「离底部多远」，超过 120px 就不跟了，一大块表格行加一个等待气泡就会超。
   */
  const aiPinnedRef = useRef(true);
  // aiPanel 原本在桌面列和移动端浮层里各渲染一次，chatBottomRef / aiInputRef
  // 被挂两遍，后挂上的隐藏节点会赢——滚动和聚焦因此都落在 display:none 的那份上。
  // 按 lg 断点只渲染一份。
  const aiWasOpenRef = useRef(false);
  const sendingRef = useRef(false);
  /** 发送前问服务端「这句要不要画」的那几百毫秒：别让回车再发一次 */
  const routingRef = useRef(false);
  /** 一轮问答开始、结束各加一。拉历史的请求发出后这个数变了，拉到的就可能早于那一轮 */
  const aiTurnRef = useRef(0);
  /** 一轮问答途中有拉到的历史没放进面板，这一轮结束后要重拉 */
  const historyReloadRef = useRef(false);
  const [historyReload, setHistoryReload] = useState(0);
  const justPersistedRef = useRef(false);
  /**
   * AI 面板眼下属于哪一次编辑。编辑器关着时组件并不卸载，线程还留在状态里——
   * 以前关掉一条问过 AI 的笔记、再开新笔记提问，问题直接发进上一条笔记的线程，草稿也不落库。
   * 现在换一条笔记、开新草稿、关掉编辑器都换一个号并清掉线程；在路上的请求回来时号变了，就不再写进面板。
   */
  const aiSessionRef = useRef(0);
  const aiShownRef = useRef<{ open: boolean; noteId?: string }>({ open: false });
  /** ensureAiThread 正把哪一号的草稿落库、落成了哪条笔记（id 回来之前是 null） */
  const aiDraftSaveRef = useRef<{ session: number; noteId: string | null } | null>(null);
  const [isLargeScreen, setIsLargeScreen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const { enterToSend, setEnterToSend, largeText, setLargeText } = useChatPreferences();
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [aiAttachments, setAiAttachments] = useState<Array<{ file_url: string; file_name: string; mime_type: string; text?: string; truncated?: boolean }>>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const aiFileInputRef = useRef<HTMLInputElement>(null);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const colorMenuRef = useRef<HTMLDivElement>(null);

  // 这两个弹层原来点别处不关、按 Esc 也不关——开着的取色板会一直盖在
  // 工具栏上。统一交给 useDismissible。
  useDismissible({ open: composerMenuOpen, onDismiss: () => setComposerMenuOpen(false), ref: composerMenuRef });
  useDismissible({ open: colorMenuOpen, onDismiss: () => setColorMenuOpen(false), ref: colorMenuRef });
  useDismissible({
    open: recentThreadsOpen,
    onDismiss: () => { setRecentThreadsOpen(false); setConfirmDeleteId(null); },
    ref: historyMenuRef,
  });
  const [noteTextColor, setNoteTextColor] = useState<string>(NOTE_TEXT_COLORS[0].value);
  const [refiningPrompt, setRefiningPrompt] = useState(false);
  const [promptBeforeRefine, setPromptBeforeRefine] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<NoteConversationThread | null>(null);
  const [messages, setMessages] = useState<NoteConversationMessage[]>([]);
  const [feedbacks, setFeedbacks] = useState<NoteAIFeedback[]>([]);
  const [dismissedFeedbackIds, setDismissedFeedbackIds] = useState<Set<string>>(new Set());
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [teacherFeedbacks, setTeacherFeedbacks] = useState<NoteFeedbackApi[]>([]);
  const [teacherFeedbackExpanded, setTeacherFeedbackExpanded] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [courseAiConfigsLoaded, setCourseAiConfigsLoaded] = useState(false);
  /** 教师在课程 AI 设置里定的：学生能选哪些模型、「默认」是哪个 */
  const [partnerPolicy, setPartnerPolicy] = useState<PartnerModelPolicy | null>(null);
  const partnerPolicyRef = useRef<PartnerModelPolicy | null>(null);
  partnerPolicyRef.current = partnerPolicy;
  const [aiRateLimited, setAiRateLimited] = useState(false);
  const [selectedAgentMode, setSelectedAgentMode] = useState<PartnerAgentModeSelection>('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [aiInput, setAiInput] = useState('');
  // 默认收起：撰写区要宽。触发自动反馈或学生主动点「AI 伙伴」时才展开。
  const [aiOpen, setAiOpen] = useState(true);
  /** 正在画的那张图（学生说「画一张……」或点了画图按钮）：对话里放绘图动画 */
  const [drawing, setDrawing] = useState<{ prompt: string; startedAt: number; mode?: 'new' | 'edit' } | null>(null);
  /**
   * 「原笔记」栏：和 AI 助手占左侧同一个位置。在别人的笔记上 Build-on 时默认展开，
   * 写的时候不用切回画布就能对着原文回应；看完可以收起。AI 助手打开时让位给它。
   */
  const [parentPanelOpen, setParentPanelOpen] = useState(false);
  /** 别人的笔记右下角的 Build-on 菜单（六种方式） */
  const [buildOnMenuOpen, setBuildOnMenuOpen] = useState(false);
  const buildOnMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!buildOnMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!buildOnMenuRef.current?.contains(event.target as Node)) setBuildOnMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setBuildOnMenuOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [buildOnMenuOpen]);
  // 别人的笔记在这里开着、停够 3 秒才算看过，画布上它就不再标 New。手机端、时间线、通知点进来的都走这里
  const seenTarget = useMemo(
    () => (isOpen && noteId ? allNotes.find(item => item.id === noteId) ?? null : null),
    [isOpen, noteId, allNotes],
  );
  useMarkSeenAfterDwell(seenTarget, userId);
  /**
   * 排版是**显示设置**，不写进正文 HTML。
   * 之前的行距按钮把选区包进带 line-height 的 span，正文里就多出一堆样式标签，
   * 研究导出时还得先剥掉。现在只存在浏览器里，正文保持干净。
   */
  const [noteFontSize, setNoteFontSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem('hakcc.note.fontSize'));
    return saved >= 12 && saved <= 26 ? saved : 15;
  });
  /** 「强制使用支架」拦下保存时给学生看的提示。必须放在 isOpen 的提前 return 之前 —— 钩子顺序。 */
  const [saveBlocked, setSaveBlocked] = useState<string | null>(null);
  /** 鼠标悬停的支架块（左上角显示删除小叉）。必须在 isOpen 提前 return 之前。 */
  const [hoveredScaffold, setHoveredScaffold] = useState<{ el: HTMLElement; top: number; left: number } | null>(null);
  /** 光标在支架里时，块下方浮一条提示（位置相对编辑区滚动容器）。必须在 isOpen 提前 return 之前。 */
  const [noteLineHeight, setNoteLineHeight] = useState<number>(() => {
    const saved = Number(localStorage.getItem('hakcc.note.lineHeight'));
    return saved >= 1 && saved <= 2.5 ? saved : 1.15;
  });
  useEffect(() => { localStorage.setItem('hakcc.note.fontSize', String(noteFontSize)); }, [noteFontSize]);
  useEffect(() => { localStorage.setItem('hakcc.note.lineHeight', String(noteLineHeight)); }, [noteLineHeight]);
  const proseStyle = { fontSize: `${noteFontSize}px`, lineHeight: noteLineHeight } as const;
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [checkingFeedback, setCheckingFeedback] = useState(false);
  const [requestingFeedback, setRequestingFeedback] = useState(false);
  const [showFeedbackHistory, setShowFeedbackHistory] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingAiInsert, setPendingAiInsert] = useState<PendingAiInsert | null>(null);
  // AI 产出进笔记时必须挂一条 GenAI 支架：学生得说清这段东西在他的思路里算什么
  const [aiInsertScaffold, setAiInsertScaffold] = useState<Scaffold | null>(null);
  const [aiPublishScaffold, setAiPublishScaffold] = useState<Scaffold | null>(null);
  const [aiInsertReason, setAiInsertReason] = useState('');
  /** 课程没配 GenAI 支架时的兜底归类，点一下即可 */
  const [aiInsertTag, setAiInsertTag] = useState('');
  const [aiInsertPlan, setAiInsertPlan] = useState('');
  const [aiInsertError, setAiInsertError] = useState('');
  const [pendingAiPublish, setPendingAiPublish] = useState<PendingAiPublish | null>(null);
  const [aiPublishTitle, setAiPublishTitle] = useState('');
  const [aiPublishReason, setAiPublishReason] = useState('');
  const [aiPublishRelationType, setAiPublishRelationType] = useState<RelationType>('extend');
  const [aiPublishError, setAiPublishError] = useState('');
  const [aiPublishing, setAiPublishing] = useState(false);
  const [aiSelectionMenu, setAiSelectionMenu] = useState<AiSelectionMenu | null>(null);
  const [aiPanelWidth, setAiPanelWidth] = useState<number>(NOTE_AI_SPLIT_LAYOUT.defaultAiWidth);
  const editorRef = useRef<HTMLDivElement>(null);
  /** beforeinput 走原生监听：React 的 onBeforeInput 拿不到 inputType。处理函数经 ref 取最新版本。 */
  const beforeInputRef = useRef<((e: InputEvent) => void) | null>(null);
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const listener = (e: Event) => beforeInputRef.current?.(e as InputEvent);
    el.addEventListener('beforeinput', listener);
    return () => el.removeEventListener('beforeinput', listener);
  }, [isOpen]);
  const editorRangeRef = useRef<Range | null>(null);
  const editorTextOffsetRef = useRef<number | null>(null);
  const aiInputRef = useRef<HTMLTextAreaElement>(null);
  useGrowingTextarea(aiInputRef, aiInput, isOpen && aiOpen);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const splitResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFeedbackHashRef = useRef('');
  const lastFeedbackAtRef = useRef(0);
  const selectedProviderRef = useRef('');
  const selectedModelRef = useRef('');
  const resolvedCourseIdRef = useRef(courseId ?? '');
  const aiConfigsRef = useRef<ApiAIConfig[]>([]);
  const aiStateActiveRef = useRef(false);
  /** 编辑器是否开着。与 aiStateActiveRef 的区别：这个不要求已有 noteId，
   *  新建笔记也算开着——取课程 AI 配置只跟课程有关。 */
  const editorOpenRef = useRef(false);
  const aiStateRequestIdRef = useRef(0);
  const teacherFeedbackReadRef = useRef<Set<string>>(new Set());

  const t = {
    note: lang === 'zh' ? '笔记' : 'Note',
    title: lang === 'zh' ? '标题' : 'Title',
    titlePlaceholder: lang === 'zh' ? '输入一个想法标题...' : 'Enter an idea title...',
    edit: lang === 'zh' ? '撰写' : 'Compose',
    read: lang === 'zh' ? '阅读' : 'Read',
    connections: lang === 'zh' ? 'Build-on' : 'Build-on',
    info: lang === 'zh' ? '信息' : 'Info',
    scaffolds: lang === 'zh' ? '支架' : 'Scaffolds',
    noScaffolds: lang === 'zh' ? '暂无可用支架' : 'No scaffolds available',
    author: lang === 'zh' ? '作者' : 'Author',
    modified: lang === 'zh' ? '时间' : 'Time',
    keywords: lang === 'zh' ? '关键词' : 'Keywords',
    addKeyword: lang === 'zh' ? '添加' : 'Add',
    keywordPlaceholder: lang === 'zh' ? '输入后回车' : 'Type and press Enter',
    removeKeyword: lang === 'zh' ? '移除关键词' : 'Remove keyword',
    words: lang === 'zh' ? '字' : 'words',
    contribute: lang === 'zh' ? '贡献' : 'Contribute',
    close: lang === 'zh' ? '关闭' : 'Close',
    startWriting: lang === 'zh' ? '在这里写下你的想法。你可以选择左侧支架句式，也可以直接书写。' : 'Write your idea here. You may use scaffolds on the left or write freely.',
    backToCanvas: lang === 'zh' ? '返回画布' : 'Back to canvas',
    buildOn: lang === 'zh' ? '正在 Build-on 已有想法' : 'Building on an existing idea',
    parentNote: lang === 'zh' ? '你在回应的笔记' : 'The note you are building on',
    parentNoteButton: lang === 'zh' ? '原笔记' : 'Original note',
    parentPanelHint: lang === 'zh' ? '看完可以收起，写的时候想再看，点顶上的「原笔记」。' : 'Collapse it when you are done. Reopen it from “Original note” at the top.',
    parentAttachment: lang === 'zh' ? '附件' : 'Attachment',
    buildOnThis: 'Build-on',
    buildOnMenuTitle: lang === 'zh' ? '选一种方式，接着这条笔记写一条新的' : 'Pick how your new note builds on this one',
    readOnlyHint: lang === 'zh' ? '这是别人的笔记，只能阅读。想回应，点右下角的 Build-on。' : 'This is someone else’s note and is read-only. To respond, use Build-on at the bottom right.',
    received: lang === 'zh' ? '收到的 Build-on' : 'Received Build-ons',
    sent: lang === 'zh' ? '发出的 Build-on' : 'Sent Build-ons',
    none: lang === 'zh' ? '暂无连接' : 'No connections yet',
    aiPartner: lang === 'zh' ? 'AI 助手' : 'AI partner',
    newChat: lang === 'zh' ? '新建对话' : 'New chat',
    chatHistory: lang === 'zh' ? '历史对话' : 'History',
    recentChats: lang === 'zh' ? '最近对话' : 'Recent',
    historyEmpty: lang === 'zh' ? '这条笔记还没有历史对话。你和 AI 聊过的会列在这里。' : 'No earlier chats on this note yet. Chats you have with the AI are listed here.',
    historyUntitled: lang === 'zh' ? '新对话' : 'New chat',
    historySwitchWait: lang === 'zh' ? 'AI 回答完才能切换或删除对话' : 'Wait for the AI to finish before switching or deleting chats',
    deleteChat: lang === 'zh' ? '删除这段对话' : 'Delete this chat',
    deleteChatAsk: lang === 'zh' ? '删除这段对话？' : 'Delete this chat?',
    deleteChatConfirm: lang === 'zh' ? '删除' : 'Delete',
    deleteChatCancel: lang === 'zh' ? '取消' : 'Cancel',
    openingChat: lang === 'zh' ? '正在打开这段对话' : 'Opening this chat',
    thinkingLabel: lang === 'zh' ? '正在思考' : 'Thinking',
    answeringLabel: lang === 'zh' ? '正在组织回答' : 'Composing the answer',
    toolRunningLabel: lang === 'zh' ? '正在读取课程知识网络' : 'Reading the course knowledge network',
    expandLabel: lang === 'zh' ? '展开' : 'Expand',
    collapseLabel: lang === 'zh' ? '收起' : 'Collapse',
    aroundThisNote: lang === 'zh' ? '围绕当前 Note 讨论' : 'Discussing this note',
    regenerateLabel: lang === 'zh' ? '重新生成' : 'Regenerate',
    attachImage: lang === 'zh' ? '上传图片或文件' : 'Attach an image or file',
    showCanvas: lang === 'zh' ? '让 AI 看整块画布' : 'Show the AI the whole canvas',
    drawImage: lang === 'zh' ? '让 AI 画一张配图' : 'Ask the AI to draw an image',
    drawShort: lang === 'zh' ? '画图' : 'Draw',
    saveNoteFirst: lang === 'zh'
      ? '这条笔记还没能保存，无法开始对话。请先点「贡献」保存后再试。'
      : 'This note could not be saved yet, so the conversation cannot start. Save it first and try again.',
    removeImage: lang === 'zh' ? '移除这个附件' : 'Remove attachment',
    attachmentReadable: lang === 'zh' ? 'AI 可读内容' : 'AI can read it',
    attachmentNameOnly: lang === 'zh' ? 'AI 只看到文件名' : 'AI sees only the name',
    refinePrompt: lang === 'zh' ? '优化提问' : 'Refine question',
    refining: lang === 'zh' ? '优化中…' : 'Refining…',
    undoRefine: lang === 'zh' ? '还原我原来的问题' : 'Undo refine',
    textColor: lang === 'zh' ? '字体颜色' : 'Text color',
    colorDefault: lang === 'zh' ? '正文' : 'Body',
    resizeSplit: lang === 'zh' ? '调整 AI 助手和 Note 的宽度' : 'Resize AI partner and Note panes',
    aiModel: lang === 'zh' ? '模型' : 'Model',
    autoAiModel: lang === 'zh' ? '默认' : 'Default',
    aiProvider: lang === 'zh' ? 'Provider' : 'Provider',
    noAi: lang === 'zh' ? '教师尚未配置可用 GenAI' : 'No GenAI provider is configured yet',
    aiPlaceholder: lang === 'zh' ? '围绕这条 Note 提问…' : 'Ask about this Note…',
    quickAsk: lang === 'zh' ? '快捷协助' : 'Quick help',
    agentMode: lang === 'zh' ? '教学 Agent' : 'Teaching agent',
    webEvidence: lang === 'zh' ? '网页证据' : 'Web evidence',
    tavilyReady: lang === 'zh' ? 'Tavily 已配置' : 'Tavily configured',
    tavilyMissing: lang === 'zh' ? '教师未配置 Tavily' : 'Tavily not configured by teacher',
    webEvidenceHint: lang === 'zh' ? '开启后，AI 会先检索网页证据，再结合当前 Note 回答。' : 'When enabled, AI retrieves web evidence before responding with the current Note context.',
    autoFeedback: lang === 'zh' ? 'AI 自动反馈' : 'AI auto feedback',
    autoFeedbackHint: lang === 'zh' ? '只监测 Note 主体。停止输入后，系统会在发现知识缺口、证据不足、表达不确定或综合不足时反馈。' : 'Monitors only the Note body and responds to gaps, uncertainty, weak evidence, or weak synthesis.',
    noFeedback: lang === 'zh' ? '继续写作；达到触发条件后这里会出现自动反馈。' : 'Keep writing; automatic feedback will appear here when triggered.',
    teacherFeedback: lang === 'zh' ? '教师发布的 AI 反馈' : 'Teacher-published AI feedback',
    teacherFeedbackHint: lang === 'zh'
      ? '这部分由教师审核后发布给学生，用于改进当前 Note。'
      : 'Reviewed and published by the teacher to help improve this Note.',
    teacherFeedbackCollapsedHint: lang === 'zh' ? '点击展开查看反馈摘要与教师补充。' : 'Expand to review the summary and teacher note.',
    teacherFeedbackSummary: lang === 'zh' ? '反馈摘要' : 'Feedback summary',
    teacherFeedbackNote: lang === 'zh' ? '教师补充' : 'Teacher note',
    teacherFeedbackFrom: lang === 'zh' ? '发布者' : 'Published by',
    teacherFeedbackUnread: lang === 'zh' ? '未读' : 'Unread',
    teacherFeedbackCount: lang === 'zh' ? '条反馈' : 'feedbacks',
    expandFeedback: lang === 'zh' ? '展开' : 'Expand',
    collapseFeedback: lang === 'zh' ? '折叠' : 'Collapse',
    rateLimited: lang === 'zh' ? '请求过于频繁，系统正在冷却。请稍等一会儿再继续使用 AI。' : 'Too many requests. The system is cooling down; please try AI again shortly.',
    checking: lang === 'zh' ? '正在检查...' : 'Checking...',
    history: lang === 'zh' ? '历史' : 'History',
    accept: lang === 'zh' ? '采纳' : 'Accept',
    ignore: lang === 'zh' ? '忽略' : 'Ignore',
    followUp: lang === 'zh' ? '追问' : 'Follow up',
    insert: lang === 'zh' ? '添加到 Note' : 'Add to Note',
    publishAsNote: lang === 'zh' ? '发布为新 Note' : 'Publish as Note',
    addToChat: lang === 'zh' ? '添加到聊天框' : 'Add to chat',
    send: lang === 'zh' ? '发送' : 'Send',
    thinking: lang === 'zh' ? '思考中...' : 'Thinking...',
    answering: lang === 'zh' ? '正在组织回答...' : 'Composing answer...',
    thoughtDone: lang === 'zh' ? '思考完成' : 'Thinking complete',
    toolRunning: lang === 'zh' ? '正在读取课程知识网络...' : 'Reading course knowledge network...',
    toolUsed: lang === 'zh' ? '已读取课程知识网络' : 'Course knowledge network used',
    // 「默认」= 课程 AI 设置里「笔记 AI 助手对话」那一行的模型（教师没指定时优先 DeepSeek Flash），不按任务切换
    autoModelHint: (model: string) => (lang === 'zh'
      ? `用老师给这门课定的默认模型（现在是 ${model}）。想换模型，在菜单里直接选。`
      : `Uses the default model your teacher set for this course (now ${model}). To change it, pick a model from the menu.`),
    fastModelHint: lang === 'zh' ? 'DeepSeek Flash 响应更快；DeepSeek V4 Pro 会先深度思考，要等更久。' : 'DeepSeek Flash answers faster; DeepSeek V4 Pro thinks first and takes longer.',
    insertAiTitle: lang === 'zh' ? '添加 AI 内容到 Note' : 'Add AI content to Note',
    insertAiIntro: lang === 'zh' ? '这段内容会带着「AI 来源」标记插进笔记。选一条支架说明你怎么用它，理由可写可不写。' : 'The text goes into your note with an AI source mark. Pick a scaffold to say how you are using it; a reason is optional.',
    insertAiReason: lang === 'zh' ? '采纳理由' : 'Reason for accepting',
    insertAiReasonPlaceholder: lang === 'zh' ? '例如：这段话帮助我澄清了理论之间的关系。' : 'For example: This helps me clarify the relationship among the theories.',
    insertAiPlan: lang === 'zh' ? '后续验证或修改计划（可选）' : 'Revision or verification plan (optional)',
    insertAiPlanPlaceholder: lang === 'zh' ? '例如：我还需要找一篇文献验证这个解释。' : 'For example: I still need to verify this explanation with a source.',
    insertAiRequired: lang === 'zh' ? '请先写一句自己的采纳理由。' : 'Please write one reason in your own words first.',
    aiScaffoldLabel: lang === 'zh' ? '这段内容用哪条支架说明' : 'Which scaffold frames this content',
    aiScaffoldHint: lang === 'zh'
      ? '选一条 AI 相关的支架。选完之后，笔记里这段会写成「支架[内容]」的样子。'
      : 'Pick an AI-related scaffold. The note will then read "scaffold[content]".',
    aiScaffoldRequired: lang === 'zh' ? '请先选一条 AI 相关的支架。' : 'Please pick an AI-related scaffold first.',
    aiScaffoldNone: lang === 'zh' ? '这门课还没有可用的 AI 支架，在下面选一项说明它对你的帮助即可。' : 'No AI scaffold is available in this course yet. Pick one option below to say how it helps.',
    aiScaffoldChosen: lang === 'zh' ? '已选' : 'Selected',
    insertAiConfirm: lang === 'zh' ? '添加到 Note' : 'Add to Note',
    publishAiTitle: lang === 'zh' ? '发布为 AI Partner Note' : 'Publish as AI Partner Note',
    publishAiIntro: lang === 'zh'
      ? '这会把选中的 AI 回复发布为一个新的公共 Note，并自动 Build-on 当前 Note。请说明为什么它值得进入社区知识空间。'
      : 'This publishes the selected AI response as a new public Note and automatically builds on the current Note. Explain why it belongs in the community space.',
    publishNoteTitle: lang === 'zh' ? '新 Note 标题' : 'New Note title',
    publishNoteTitlePlaceholder: lang === 'zh' ? '为这条 AI Partner Note 起一个标题...' : 'Give this AI Partner Note a title...',
    publishRelationType: lang === 'zh' ? '与当前 Note 的关系' : 'Relation to current Note',
    publishReason: lang === 'zh' ? '为什么值得发布' : 'Why publish this',
    publishReasonPlaceholder: lang === 'zh'
      ? '例如：这段回应提出了一个可以被大家继续检验的解释。'
      : 'For example: This response proposes an explanation the community can examine further.',
    publishAiRequired: lang === 'zh' ? '请填写标题和发布理由。' : 'Please provide a title and a reason for publishing.',
    publishAiConfirm: lang === 'zh' ? '确认发布新 Note' : 'Publish Note',
    publishAiFailed: lang === 'zh' ? '发布失败，请稍后再试。' : 'Publishing failed. Please try again.',
    cancel: lang === 'zh' ? '取消' : 'Cancel',
    aiSource: lang === 'zh' ? 'AI 来源' : 'AI source',
    linkedInquiry: lang === 'zh' ? '关联的共同问题' : 'Linked inquiry',
    promisingReason: lang === 'zh' ? '值得推进的理由' : 'Promising reason',
    knowledgeGaps: lang === 'zh' ? '知识缺口' : 'Knowledge gaps',
    improvementTrail: lang === 'zh' ? '改进轨迹' : 'Improvement trail',
    noRevisions: lang === 'zh' ? '暂无修订记录' : 'No revisions yet',
    aiUptake: lang === 'zh' ? 'AI 采纳段' : 'AI uptake blocks',
    heading1: lang === 'zh' ? '一级标题' : 'Heading 1',
    heading2: lang === 'zh' ? '二级标题' : 'Heading 2',
    paragraph: lang === 'zh' ? '正文' : 'Paragraph',
    lineHeight: lang === 'zh' ? '行距' : 'Line height',
    fontSize: lang === 'zh' ? '字号' : 'Font size',
    lhSingle: lang === 'zh' ? '单倍' : 'Single',
    lhTight: lang === 'zh' ? '紧凑' : 'Tight',
    lhOneHalf: lang === 'zh' ? '1.5 倍' : '1.5',
    lhDouble: lang === 'zh' ? '双倍' : 'Double',
    insertImage: lang === 'zh' ? '插入图片' : 'Insert image',
    insertDocument: lang === 'zh' ? '插入文档' : 'Insert document',
    insertLink: lang === 'zh' ? '插入链接' : 'Insert link',
    linkPrompt: lang === 'zh' ? '请输入链接地址' : 'Enter URL',
    fileTooLarge: lang === 'zh' ? '文件过大，请选择 6MB 以内的文件。' : 'File is too large. Please choose a file under 6MB.',
    noAgentMode: lang === 'zh' ? '默认 · 自由提问' : 'Default · Free inquiry',
    modeHint: lang === 'zh'
      ? '围绕当前 Note 自由提问，澄清想法或讨论下一步。'
      : 'Ask freely about this Note, clarify ideas, or discuss your next step.',
  };

  // 教师在支架管理里隐藏的支架，写笔记时谁都不列：教职拿到的列表里带着它们（带 hidden 标记），
  // 是为了在支架管理里能恢复，不是为了让老师写笔记时还看得到
  const availableScaffolds = useMemo(() => courseScaffolds.filter(scaffold => !scaffold.hidden), [courseScaffolds]);
  /** AI 产出进笔记时能挑的支架：分类表里标了 gai 的那些。 */
  const genAiScaffolds = useMemo(
    () => availableScaffolds.filter(isGenAiScaffold),
    [availableScaffolds],
  );

  const noteMap = useMemo(() => new Map(allNotes.map(note => [note.id, note])), [allNotes]);
  const verifiedConfigs = useMemo(
    () => aiConfigs.filter(config => config.isVerified || (config.enabledModels?.length ?? 0) > 0),
    [aiConfigs],
  );
  const configuredChatConfigs = useMemo(
    () => verifiedConfigs.filter(config => (
      config.providerId !== 'tavily' &&
      Object.prototype.hasOwnProperty.call(DEFAULT_PROVIDER_MODELS, config.providerId)
    )),
    [verifiedConfigs],
  );
  const inferredConfigs = useMemo(
    () => inferPartnerConfigsFromMessages(messages, DEFAULT_PROVIDER_MODELS),
    [messages],
  );
  const chatCapableConfigs = useMemo(
    () => courseAiConfigsLoaded
      ? configuredChatConfigs
      : mergePartnerConfigs(configuredChatConfigs, inferredConfigs),
    [configuredChatConfigs, courseAiConfigsLoaded, inferredConfigs],
  );
  const hasTavilyConfig = useMemo(() => verifiedConfigs.some(config => config.providerId === 'tavily'), [verifiedConfigs]);
  const partnerModelOptions = useMemo(
    () => buildPartnerModelOptions(chatCapableConfigs, DEFAULT_PROVIDER_MODELS, {
      includeAuto: true,
      autoLabel: t.autoAiModel,
      allowed: partnerPolicy?.allowed,
      preferred: partnerPolicy?.defaultModel,
      lang: lang === 'zh' ? 'zh' : 'en',
    }),
    [chatCapableConfigs, t.autoAiModel, partnerPolicy, lang],
  );
  const canChatWithAI = partnerModelOptions.length > 0;
  const concreteAiSelection = useMemo(() => {
    return resolveConcretePartnerModelSelection(partnerModelOptions, selectedProviderId, selectedModel);
  }, [partnerModelOptions, selectedModel, selectedProviderId]);
  const useWebSearchForNextMessage = shouldUseWebSearchForAgent(selectedAgentMode, webSearchEnabled, hasTavilyConfig);
  const selectedModelValue = selectedProviderId && selectedModel
    ? encodePartnerModelValue(selectedProviderId, selectedModel)
    : '';
  const latestFeedback = feedbacks[0];
  const visibleFeedbacks = (showFeedbackHistory ? feedbacks : feedbacks.slice(0, 1)).filter(feedback => !dismissedFeedbackIds.has(feedback.id) && (showFeedbackHistory || feedback.status !== 'ignored'));
  /** 正在填写不同意理由的那条反馈；理由必须和状态同一次提交，不接受事后补填 */
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectTag, setRejectTag] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  // Closing a card is local UI state. Only its recipient can record an outcome.
  const dismissFeedback = async (feedback: NoteAIFeedback) => {
    setRejectingId(null);
    setDismissedFeedbackIds(previous => new Set(previous).add(feedback.id));
    setFeedbackError(null);
    if (!noteId || feedback.status !== 'new' || feedback.userId !== userId) return;
    const live = captureAiSession();
    try {
      const { feedback: updated } = await noteAiFeedback.respond(noteId, feedback.id, { status: 'ignored' });
      if (live()) setFeedbacks(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      if (!live()) return;
      // A removed/stale row can still be closed; it has no outcome left to update.
      if (error instanceof ApiClientError && error.status === 404) return;
      setFeedbackError(lang === 'zh' ? '反馈已收起，未处理状态未保存。可打开历史后重试。' : 'Feedback closed. Its status could not be saved; open history to retry.');
    }
  };
  const agentModes = useMemo(() => getPartnerAgentModes(lang === 'zh' ? 'zh' : 'en'), [lang]);

  useEffect(() => {
    // 草稿还在保存的路上学生就关了编辑器：那次保存不会再回到编辑器里，
    // 标记留着会让下一次打开跳过重置、带着上一条笔记的内容。
    if (!isOpen) { justPersistedRef.current = false; return; }
    // 刚把草稿落库：initialData 变成了同一份内容，重置一遍是无谓的，
    // 还会把学生的光标顶掉。跳过这一轮。
    if (justPersistedRef.current) { justPersistedRef.current = false; return; }
    setActiveTab('edit');
    // 在别人的笔记上 Build-on：先看原笔记，AI 助手收着；其余情况（自己的、别人的笔记）先显示 AI 助手
    const buildingOn = Boolean(isBuildOn && buildOnParentId);
    setParentPanelOpen(buildingOn);
    setAiOpen(!buildingOn);
    setBuildOnMenuOpen(false);
    setTitle(initialData?.title ?? '');
    setKeywords(initialData?.tags ?? []);
    setKeywordDraft('');
    setConnections([]);
    setRevisions([]);
    setMessages([]);
    setFeedbacks([]);
    setDismissedFeedbackIds(new Set());
    setFeedbackError(null);
    setShowFeedbackHistory(false);
    setTeacherFeedbacks([]);
    setTeacherFeedbackExpanded(false);
    teacherFeedbackReadRef.current.clear();
    setCourseAiConfigsLoaded(false);
    setAiRateLimited(false);
    setAiInput('');
    setAiError(null);
    setPendingAiInsert(null);
    setAiInsertScaffold(null);
    setAiPublishScaffold(null);
    setAiInsertReason('');
    setAiInsertTag('');
    setAiInsertPlan('');
    setAiInsertError('');
    setPendingAiPublish(null);
    setAiPublishTitle('');
    setAiPublishReason('');
    setAiPublishRelationType('extend');
    setAiPublishError('');
    setAiPublishing(false);
    setAiSelectionMenu(null);
    if (isRiseAbove) {
      setSelectedAgentMode('rise_above_coach');
    }
    lastFeedbackHashRef.current = hashText(stripHtml(initialData?.content || ''));
    lastFeedbackAtRef.current = 0;
    window.setTimeout(() => {
      if (!editorRef.current) return;
      // 正文是作者存的原始 HTML，后端不清洗；打开别人的笔记不能执行别人写进去的标记
      editorRef.current.innerHTML = DOMPurify.sanitize(initialData?.content || '');
      normalizeScaffoldMarkers(editorRef.current);
      const range = document.createRange();
      // 从支架库开的新笔记，正文里已经有一条空的「支架[ ]」，光标直接落进方括号
      const emptySlot = editorRef.current.querySelector(SCAFFOLD_CARET_SELECTOR);
      if (isEmptyScaffoldSlot(emptySlot)) {
        range.selectNodeContents(emptySlot);
        range.collapse(false);
        editorRef.current.focus();
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else {
        range.selectNodeContents(editorRef.current);
        range.collapse(false);
      }
      editorRangeRef.current = range;
      editorTextOffsetRef.current = editorRef.current.innerText.length;
      updateWordCount();
    }, 0);
  }, [isOpen, initialData?.title, initialData?.content]);

  // 换了一条笔记（或开新草稿、或关掉）：上一条的线程、消息、在路上的请求一并作废。
  // 只有 ensureAiThread 把这份草稿落了库、noteId 从空变成那条新笔记时，还算同一次编辑。
  // 必须排在加载 AI 状态、挂入初始附件的 effect 之前，免得刚设好的又被清掉。
  useEffect(() => {
    const prev = aiShownRef.current;
    aiShownRef.current = { open: isOpen, noteId };
    if (prev.open === isOpen && prev.noteId === noteId) return;
    const draftSave = aiDraftSaveRef.current;
    if (prev.open && isOpen && !prev.noteId && noteId
      && draftSave?.session === aiSessionRef.current
      && (draftSave.noteId === null || draftSave.noteId === noteId)) return;
    aiSessionRef.current += 1;
    aiDraftSaveRef.current = null;
    sendingRef.current = false;
    historyReloadRef.current = false;
    setSending(false);
    setDrawing(null);
    setThreads([]);
    setSelectedThread(null);
    setRecentThreadsOpen(false);
    setConfirmDeleteId(null);
    setThreadLoading(false);
    shownThreadRef.current = null;
    deletedThreadIdsRef.current = new Set();
    setMessages([]);
    setAiLoading(false);
    setAiAttachments([]);
    setUploadingAttachment(false);
    setRefiningPrompt(false);
    setPromptBeforeRefine(null);
    setCheckingFeedback(false);
    setRequestingFeedback(false);
  }, [isOpen, noteId]);

  useEffect(() => {
    selectedProviderRef.current = selectedProviderId;
    selectedModelRef.current = selectedModel;
  }, [selectedModel, selectedProviderId]);

  useEffect(() => {
    const handleResize = () => {
      setAiPanelWidth(width => clampNoteAiPanelWidth(width, window.innerWidth));
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const isRateLimitedError = (error: unknown) => error instanceof ApiClientError && error.status === 429;

  /** 课程的 AI 配置只跟 courseId 有关。新建笔记还没有 noteId，但一样要能选模型。 */
  const loadCourseAiConfigs = useCallback(async () => {
    const requestedCourseId = resolvedCourseIdRef.current || courseId || '';
    if (!requestedCourseId) return;
    try {
      const { configs, partnerModels } = await aiApi.listConfigs(requestedCourseId);
      if (!editorOpenRef.current) return;
      setAiConfigs(prev => mergeCourseAiConfigs(prev, configs));
      setPartnerPolicy(partnerModels);
      setCourseAiConfigsLoaded(true);
      setAiRateLimited(false);
    } catch (error) {
      if (isRateLimitedError(error)) setAiRateLimited(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const loadAiWorkspaceState = useCallback(async (options: { showLoading?: boolean } = {}) => {
    if (!noteId) return;
    const requestId = (aiStateRequestIdRef.current += 1);
    if (options.showLoading) setAiLoading(true);
    setAiError(null);
    const requestedCourseId = resolvedCourseIdRef.current || courseId || '';

    try {
      const [configResult, threadResult, feedbackResult, teacherFeedbackResult] = await Promise.allSettled([
        requestedCourseId ? aiApi.listConfigs(requestedCourseId) : Promise.resolve({ configs: [] as ApiAIConfig[] }),
        noteConversations.list(noteId),
        noteAiFeedback.list(noteId),
        teacherFeedbackApi.list(noteId),
      ]);
      if (!aiStateActiveRef.current || requestId !== aiStateRequestIdRef.current) return;

      if (configResult.status === 'rejected' && threadResult.status === 'rejected') {
        if (isRateLimitedError(configResult.reason) || isRateLimitedError(threadResult.reason)) {
          setAiRateLimited(true);
          setAiError(t.rateLimited);
          return;
        }
        throw configResult.reason ?? threadResult.reason;
      }

      const configRes = configResult.status === 'fulfilled'
        ? configResult.value
        : { configs: aiConfigsRef.current };
      const threadRes = threadResult.status === 'fulfilled'
        ? threadResult.value
        : { conversations: [] as NoteConversationThread[], aiConfigs: [] as ApiAIConfig[] };
      const rateLimited = [configResult, threadResult, feedbackResult, teacherFeedbackResult]
        .some(result => result.status === 'rejected' && isRateLimitedError(result.reason));
      const actualCourseId = threadRes.courseId ?? requestedCourseId;
      let courseConfigs = configRes.configs;
      // 没取到这一次的就沿用上次的，别因为一次失败把名单限制丢了
      let coursePolicy: PartnerModelPolicy | null | undefined = configResult.status === 'fulfilled' && requestedCourseId
        ? (configResult.value as { partnerModels?: PartnerModelPolicy | null }).partnerModels ?? null
        : undefined;
      if (actualCourseId && actualCourseId !== requestedCourseId) {
        const realCourseConfigRes = await aiApi.listConfigs(actualCourseId)
          .catch(() => ({ configs: [] as ApiAIConfig[], partnerModels: undefined }));
        if (!aiStateActiveRef.current || requestId !== aiStateRequestIdRef.current) return;
        courseConfigs = mergeCourseAiConfigs(courseConfigs, realCourseConfigRes.configs);
        if (realCourseConfigRes.partnerModels !== undefined) coursePolicy = realCourseConfigRes.partnerModels;
      }
      if (coursePolicy !== undefined) setPartnerPolicy(coursePolicy);
      const policyForOptions = coursePolicy === undefined ? partnerPolicyRef.current : coursePolicy;
      if (actualCourseId && actualCourseId !== resolvedCourseIdRef.current) {
        resolvedCourseIdRef.current = actualCourseId;
      }
      const configs = mergeCourseAiConfigs(courseConfigs, threadRes.aiConfigs ?? []);
      setAiConfigs(configs);
      aiConfigsRef.current = configs;
      setCourseAiConfigsLoaded(true);
      setAiRateLimited(rateLimited);
      if (rateLimited && configs.length === 0) {
        setAiError(t.rateLimited);
      }
      // 列表只含学生参与的线程，而建线程时参与记录最后才写。新草稿第一次问 AI，
      // 拉列表和建线程同时在路上，列表可能先查、后到，里面没有刚建好的那条。
      // 这条笔记自己的线程不在列表里就留着：选中的一旦置空，学生刚问的话和正在说的回复都会从面板上消失。
      const listed = threadRes.conversations.filter(thread => !deletedThreadIdsRef.current.has(thread.id));
      setThreads(prev => {
        const unlisted = prev.filter(thread => thread.noteId === noteId
          && !deletedThreadIdsRef.current.has(thread.id)
          && !listed.some(item => item.id === thread.id));
        return unlisted.length ? [...unlisted, ...listed] : listed;
      });
      if (feedbackResult.status === 'fulfilled') {
        setFeedbacks(feedbackResult.value.feedbacks);
      }
      if (teacherFeedbackResult.status === 'fulfilled') {
        setTeacherFeedbacks(teacherFeedbackResult.value.feedbacks);
      }

      const nextModelOptions = buildPartnerModelOptions(
        configs.filter(config => config.providerId !== 'tavily'),
        DEFAULT_PROVIDER_MODELS,
        {
          includeAuto: true,
          autoLabel: t.autoAiModel,
          allowed: policyForOptions?.allowed,
          preferred: policyForOptions?.defaultModel,
        },
      );
      const nextSelection = resolvePartnerModelSelection(
        nextModelOptions,
        selectedProviderRef.current,
        selectedModelRef.current,
      );
      setSelectedProviderId(nextSelection.providerId);
      setSelectedModel(nextSelection.model);
      selectedProviderRef.current = nextSelection.providerId;
      selectedModelRef.current = nextSelection.model;

      setSelectedThread(current => {
        const currentThread = current ? listed.find(thread => thread.id === current.id) : null;
        if (currentThread) return currentThread;
        if (current?.noteId === noteId) return current;
        // 打开笔记先显示最近问过话的那段；只剩空白对话时才落到空白对话
        return listed.find(thread => thread.targetType === 'ai' && thread.preview !== null)
          ?? listed.find(thread => thread.targetType === 'ai')
          ?? null;
      });
    } catch (error) {
      if (aiStateActiveRef.current && requestId === aiStateRequestIdRef.current) {
        setCourseAiConfigsLoaded(false);
        setAiError(error instanceof Error ? error.message : 'Failed to load AI');
      }
    } finally {
      if (aiStateActiveRef.current && requestId === aiStateRequestIdRef.current) setAiLoading(false);
    }
  }, [courseId, noteId, t.autoAiModel, t.rateLimited]);

  useEffect(() => {
    if (!isOpen || !noteId || (isStaff ?? userRole !== 'student')) return;
    const unreadFeedbacks = teacherFeedbacks.filter(feedback => feedback.isRead === false);
    if (!unreadFeedbacks.length) return;

    unreadFeedbacks.forEach(feedback => {
      if (teacherFeedbackReadRef.current.has(feedback.id)) return;
      teacherFeedbackReadRef.current.add(feedback.id);
      teacherFeedbackApi.markRead(noteId, feedback.id)
        .then(() => {
          setTeacherFeedbacks(prev => prev.map(item =>
            item.id === feedback.id ? { ...item, isRead: true } : item
          ));
          onTeacherFeedbackRead?.(noteId, feedback.id);
        })
        .catch(() => {
          teacherFeedbackReadRef.current.delete(feedback.id);
        });
    });
  }, [isOpen, noteId, onTeacherFeedbackRead, teacherFeedbacks, userRole, isStaff]);

  useEffect(() => {
    if (courseId && courseId !== resolvedCourseIdRef.current) {
      resolvedCourseIdRef.current = courseId;
    }
  }, [courseId]);

  // 课程 AI 配置：编辑器一打开就取，新建笔记（还没有 noteId）同样要取。
  // 「带这份文档问 AI」进来时把文档挂上。只在打开那一刻挂一次，
  // 之后学生自己删掉了就不该再冒出来。
  const stagedAttachmentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) { stagedAttachmentRef.current = null; return; }
    if (!initialAiAttachment) return;
    if (stagedAttachmentRef.current === initialAiAttachment.file_url) return;
    stagedAttachmentRef.current = initialAiAttachment.file_url;
    setAiOpen(true);
    setAiAttachments([initialAiAttachment]);
  }, [isOpen, initialAiAttachment]);

  useEffect(() => {
    editorOpenRef.current = isOpen;
    if (!isOpen) return;
    void loadCourseAiConfigs();
    const id = window.setInterval(() => { void loadCourseAiConfigs(); }, AI_CONFIG_REFRESH_INTERVAL_MS);
    return () => { editorOpenRef.current = false; window.clearInterval(id); };
  }, [isOpen, loadCourseAiConfigs]);

  useEffect(() => {
    aiStateActiveRef.current = isOpen && Boolean(noteId);
    if (!aiStateActiveRef.current) return;

    void loadAiWorkspaceState({ showLoading: true });
    const intervalId = window.setInterval(() => {
      void loadAiWorkspaceState();
    }, AI_CONFIG_REFRESH_INTERVAL_MS);
    const refreshOnFocus = () => {
      void loadAiWorkspaceState();
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') void loadAiWorkspaceState();
    };

    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisible);

    return () => {
      aiStateActiveRef.current = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [courseId, isOpen, loadAiWorkspaceState, noteId]);

  useEffect(() => {
    const nextSelection = resolvePartnerModelSelection(partnerModelOptions, selectedProviderId, selectedModel);
    if (nextSelection.providerId !== selectedProviderId) setSelectedProviderId(nextSelection.providerId);
    if (nextSelection.model !== selectedModel) setSelectedModel(nextSelection.model);
  }, [partnerModelOptions, selectedModel, selectedProviderId]);

  useEffect(() => {
    if (!selectedThread) {
      shownThreadRef.current = null;
      setThreadLoading(false);
      setMessages([]);
      return;
    }
    let cancelled = false;
    const turnAtRequest = aiTurnRef.current;
    // 换了一段对话：先清掉上一段的内容，显示「正在打开」，别让学生对着旧内容以为没切过去。
    // 回答途中开出来的新线程（ensureAiThread）面板上已经是它的消息，不清；同一段刷新历史也不闪
    if (sendingRef.current) {
      shownThreadRef.current = selectedThread.id;
    } else if (shownThreadRef.current !== selectedThread.id) {
      setMessages([]);
      // 刚新建的空白对话没什么可等的：直接是空白面板，不显示「正在打开」
      setThreadLoading(selectedThread.preview !== null);
    }
    noteConversations.listMessages(selectedThread.id, { limit: 80 })
      .then(({ messages: loaded }) => {
        if (cancelled) return;
        // 一轮问答在路上时不动面板，这一轮结束再拉。服务端存下提问后还要查几次库才回传 userMessage，
        // 存下回复后也还要写几次库才回传 assistantMessage；这时拉到的历史里已经有这条消息，
        // 面板上它却还是本地占位，并进来就显示两遍，回传到了又变成两条同 key 的。
        // 占位要等回传才知道对应哪条，按内容认不行——学生可能连着问同一句。
        // 新线程的空历史也不会再把刚乐观渲染的提问冲掉。
        if (sendingRef.current) {
          historyReloadRef.current = true;
          return;
        }
        if (turnAtRequest !== aiTurnRef.current) {
          setHistoryReload(count => count + 1);
          return;
        }
        if (shownThreadRef.current !== selectedThread.id) stickAfterSwitchRef.current = true;
        shownThreadRef.current = selectedThread.id;
        setThreadLoading(false);
        setMessages(loaded);
      })
      .catch(error => {
        if (cancelled) return;
        setThreadLoading(false);
        setAiError(error instanceof Error ? error.message : 'Failed to load AI history');
      });
    return () => { cancelled = true; };
  }, [selectedThread, historyReload]);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const sync = (event: MediaQueryListEvent) => setIsLargeScreen(event.matches);
    setIsLargeScreen(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const justOpened = aiOpen && !aiWasOpenRef.current;
    aiWasOpenRef.current = aiOpen;
    const scroller = chatBottomRef.current?.closest<HTMLElement>('[data-ai-scroll]');
    if (!scroller) return;
    // 学生往上翻历史时不要把他拽回底部；刚打开面板、刚换了一段对话则一律贴底。
    const switched = stickAfterSwitchRef.current;
    stickAfterSwitchRef.current = false;
    if (!justOpened && !switched && !aiPinnedRef.current) return;
    aiPinnedRef.current = true;
    // 部分 WebView（含 Capacitor 打包的 iOS/Android）里 scrollIntoView 的
    // behavior:'smooth' 是空操作，直接设 scrollTop 才靠得住。
    // 延时那次是补流式结束后「插入笔记」操作行撑高的部分。
    const stick = () => { scroller.scrollTop = scroller.scrollHeight; };
    stick();
    const id = window.setTimeout(stick, 120);
    return () => window.clearTimeout(id);
    // aiOpen 必须在依赖里：面板关着时 chatBottomRef 是 null，
    // 重新打开时 messages 没变，不带上它就永远停在顶部。
  }, [messages, sending, aiOpen]);

  // 「信息」页签也显示 Build-on 数，不能只在打开 Build-on 页签时才取，否则那里一直是 0
  useEffect(() => {
    if (!isOpen || (activeTab !== 'connections' && activeTab !== 'info') || !noteId) return;
    setConnectionsLoading(true);
    relationsApi.listForNote(noteId)
      .then(({ relations }) => setConnections(relations))
      .catch(() => setConnections([]))
      .finally(() => setConnectionsLoading(false));
  }, [activeTab, isOpen, noteId]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'info' || !noteId) return;
    setRevisionsLoading(true);
    notesApi.revisions(noteId)
      .then(({ revisions: loaded }) => setRevisions(loaded))
      .catch(() => setRevisions([]))
      .finally(() => setRevisionsLoading(false));
  }, [activeTab, isOpen, noteId]);

  if (!isOpen) return null;

  /** 记下眼前这一次编辑。异步请求回来时调它：返回 false 说明学生已经换了笔记或关掉了编辑器。 */
  const captureAiSession = () => {
    const session = aiSessionRef.current;
    return () => aiSessionRef.current === session;
  };

  /** 一轮问答（发送、重新生成、直接生图）的开始与结束。途中拉到的历史先不进面板，结束时补拉 */
  const beginAiTurn = () => {
    aiTurnRef.current += 1;
    aiTurnStartedAtRef.current = Date.now();
    // 学生刚发出提问：接下来跟着回复往下滚，直到他自己往上翻
    aiPinnedRef.current = true;
    sendingRef.current = true;
    setSending(true);
    // 上一轮出错中断时可能留下一条没有一个字的临时回复：不清掉，这一轮开始它会跟着显示成第二个「正在思考」
    setMessages(prev => (prev.some(isEmptyStreamPlaceholder) ? prev.filter(message => !isEmptyStreamPlaceholder(message)) : prev));
  };
  const endAiTurn = () => {
    aiTurnRef.current += 1;
    sendingRef.current = false;
    setSending(false);
    if (historyReloadRef.current) {
      historyReloadRef.current = false;
      setHistoryReload(count => count + 1);
    }
  };

  const updateWordCount = () => {
    const text = editorRef.current?.innerText ?? '';
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    const englishWords = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/\b\w+\b/g) ?? []).length;
    setWordCount(chineseChars + englishWords);
  };

  const scheduleFeedbackCheck = (html: string) => {
    // Backend resolves a provider on its own — a missing client-side model
    // selection must not silently disable auto feedback
    if (!noteId) return;
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    // 在排定时就记下这一次编辑：学生停笔后两秒多内关掉、开了下一条，定时器才触发
    const live = captureAiSession();
    feedbackTimerRef.current = setTimeout(() => {
      void checkAutoFeedback(html, live);
    }, 2600);
  };

  const handleEditorInput = () => {
    const root = editorRef.current;
    if (root) {
      // 既没有话头也没有输入槽的 data-scaffold-id 块，是被劈开的克隆，还原成普通段
      const broken = Array.from(root.querySelectorAll('[data-scaffold-id]'))
        .some(b => !b.querySelector('[data-scaffold-tag]') && !b.querySelector('[data-scaffold-input]'));
      mergeSplitScaffolds(root);
      if (broken) repairSplitScaffolds(root);
      normalizeScaffoldMarkers(root);
      // 回车时补的占位 <br> 只为让光标停在空行上；行上有字之后它就多余，会把 ] 顶到下一行
      root.querySelectorAll('[data-scaffold-id]').forEach(hoistTextAfterBracket);
      // 最后一块若是支架，后面永远留一个空段：学生点下一行就能接着写正文
      const last = root.lastElementChild;
      if (last?.hasAttribute('data-scaffold-id')) {
        const pEl = document.createElement('p'); pEl.appendChild(document.createElement('br')); root.appendChild(pEl);
      }
    }
    saveEditorSelection();
    updateWordCount();
    scheduleFeedbackCheck(editorRef.current?.innerHTML ?? '');
  };

  /** 编辑区里鼠标移到哪个支架上，就在它左上角露出小叉。移到小叉本身时保持不变。 */
  const handleEditorMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-scaffold-remove]')) return;
    const block = target.closest<HTMLElement>('[data-scaffold-id]');
    const container = editorRef.current?.parentElement;
    if (!block || !container || !editorRef.current?.contains(block)) { if (hoveredScaffold) setHoveredScaffold(null); return; }
    if (hoveredScaffold?.el === block) return;
    const r = block.getBoundingClientRect(); const c = container.getBoundingClientRect();
    setHoveredScaffold({ el: block, top: Math.round(r.top - c.top + container.scrollTop - 6), left: Math.round(r.left - c.left + container.scrollLeft - 22) });
  };

  /**
   * 拆掉支架的框：话头和括号去掉，学生写的字留下来变成普通段落；括号里是空的就整块删。
   * 支架本身不能用光标删（那是研究编码的锚点），删除只能走这个明确的动作。
   */
  const removeScaffoldBlock = (block: HTMLElement) => {
    const input = block.querySelector<HTMLElement>('[data-scaffold-input]');
    const text = (input?.textContent ?? '').replace(/\u200b/g, '').trim();
    const pEl = document.createElement('p');
    if (input && text) {
      // 保留学生写的字与换行，丢掉话头/括号
      input.childNodes.forEach(n => {
        if (n.nodeType === Node.TEXT_NODE) { const t = (n.textContent ?? '').replace(/\u200b/g, ''); if (t) pEl.appendChild(document.createTextNode(t)); }
        else if (n.nodeName === 'BR') pEl.appendChild(document.createElement('br'));
        else pEl.appendChild(n.cloneNode(true));
      });
    } else {
      pEl.appendChild(document.createElement('br'));
    }
    block.replaceWith(pEl);
    setHoveredScaffold(null);
    const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(pEl); r.collapse(false);
    sel?.removeAllRanges(); sel?.addRange(r);
    editorRef.current?.focus();
    handleEditorInput();
  };

  /** 光标所在的支架块与输入槽；不在支架里返回 null。 */
  const caretScaffold = () => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    if (!anchor) return null;
    const element = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
    const block = element?.closest('[data-scaffold-id]');
    if (!block || !editorRef.current?.contains(block)) return null;
    // 槽从块里取，不从光标节点向上找：插入 <br> 后浏览器常把光标归一化到槽的外层 span，
    // 从光标找会得到 null，后面的清理就全部跳过了。
    const slot = block.querySelector('[data-scaffold-input]');
    return { selection: selection!, block, slot, zone: scaffoldZone(block, selection!) };
  };

  /**
   * 光标在支架块的哪一区：
   *   before —— 话头或 [ 之前；inside —— 两个括号之间；after —— ] 之后。
   * ] 之后就是支架外面：学生把光标点到 ] 后面接着写，写的是普通正文。
   */
  const scaffoldZone = (block: Element, selection: Selection): 'before' | 'inside' | 'after' => {
    const input = block.querySelector('[data-scaffold-input]');
    if (!input || !selection.rangeCount) return 'inside';
    const r = selection.getRangeAt(0);
    const brackets = block.querySelectorAll('[data-scaffold-bracket]');
    const closing = brackets.length > 1 ? brackets[brackets.length - 1] : null;
    const at = (node: Node, after: boolean) => {
      const point = document.createRange();
      if (after) point.setStartAfter(node); else point.setStartBefore(node);
      point.collapse(true);
      return point;
    };
    if (closing && r.compareBoundaryPoints(Range.START_TO_START, at(closing, true)) >= 0) return 'after';
    if (!input.contains(r.startContainer) && r.compareBoundaryPoints(Range.START_TO_START, at(input, false)) < 0) {
      const opening = brackets[0];
      // [ 和输入槽之间的那个位置算在里面
      if (!opening || r.compareBoundaryPoints(Range.START_TO_START, at(opening, true)) < 0) return 'before';
    }
    return 'inside';
  };

  /**
   * ] 后面写的字要落在支架框的外面。浏览器把光标放在「槽的外层 span 里、] 之后」，
   * 直接打字会落进那个 span，继承藏青加粗。这里把 ] 之后的节点挪到 span 外面，光标跟着走。
   */
  const hoistTextAfterBracket = (block: Element) => {
    const slotEl = block.querySelector('[data-scaffold-slot]');
    if (!slotEl) return;
    // 反方向同理：落在话头前、话头与 [ 之间的字属于括号里，收进输入槽开头
    const inputEl = slotEl.querySelector('[data-scaffold-input]');
    if (inputEl) {
      const stray: Node[] = [];
      for (let n = block.firstChild; n && n !== slotEl; n = n.nextSibling) if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').replace(/\u200b/g, '').trim()) stray.push(n);
      for (let n = slotEl.firstChild; n && n !== inputEl; n = n.nextSibling) if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').replace(/\u200b/g, '').trim() && !/^\s*\[\s*$/.test(n.textContent ?? '')) stray.push(n);
      if (stray.length) {
        const sel = window.getSelection();
        const a = sel?.anchorNode ?? null; const o = sel?.anchorOffset ?? 0;
        const first = inputEl.firstChild;
        stray.forEach(n => inputEl.insertBefore(n, first));
        if (sel && a && stray.includes(a)) { const r = document.createRange(); r.setStart(a, Math.min(o, (a.textContent ?? '').length)); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
      }
    }
    const brackets = slotEl.querySelectorAll(':scope > [data-scaffold-bracket]');
    const closing = brackets.length > 1 ? brackets[brackets.length - 1] : null;
    if (!closing) return;
    const selection = window.getSelection();
    const anchor = selection?.anchorNode ?? null;
    const offset = selection?.anchorOffset ?? 0;
    const caretInSlotTail = anchor === slotEl
      && offset > Array.prototype.indexOf.call(slotEl.childNodes, closing);
    const moved: Node[] = [];
    for (let n = closing.nextSibling; n; n = n.nextSibling) moved.push(n);
    const reference = slotEl.nextSibling;
    moved.forEach(n => block.insertBefore(n, reference));
    if (!selection) return;
    const movedAnchor = anchor ? moved.find(n => n === anchor || n.contains(anchor)) : undefined;
    if (movedAnchor && anchor) {
      const r = document.createRange(); r.setStart(anchor, Math.min(offset, anchor.nodeType === Node.TEXT_NODE ? (anchor.textContent ?? '').length : anchor.childNodes.length));
      r.collapse(true); selection.removeAllRanges(); selection.addRange(r);
    } else if (caretInSlotTail) {
      const r = document.createRange();
      const lastMoved = moved[moved.length - 1];
      if (lastMoved) r.setStartAfter(lastMoved); else r.setStartAfter(slotEl);
      r.collapse(true); selection.removeAllRanges(); selection.addRange(r);
    }
  };

  /** 编辑区里所有支架的框（话头、括号）有没有被这个选区碰到。 */
  const selectionTouchesFrame = (range: Range) => {
    const root = editorRef.current;
    if (!root || range.collapsed) return false;
    return Array.from(root.querySelectorAll('[data-scaffold-tag],[data-scaffold-bracket]')).some(n => range.intersectsNode(n));
  };

  /**
   * 选区跨到了支架的框上：只删选中的字，框留着。
   * 以前是整个拦下不许删 —— 学生拖选时多带进半个括号，就怎么按都删不掉。
   * 支架本身仍然只能用左上角的小叉去掉。
   */
  const deleteSelectionKeepingFrames = (selection: Selection) => {
    const root = editorRef.current;
    if (!root || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const inFrame = (n: Node) => !!(n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement)?.closest('[data-scaffold-tag],[data-scaffold-bracket]');
    const startBlock = (range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as Element) : range.startContainer.parentElement)?.closest('[data-scaffold-id]') ?? null;
    const texts: Text[] = [];
    const breaks: Element[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!range.intersectsNode(n) || inFrame(n)) continue;
      if (n.nodeType === Node.TEXT_NODE) texts.push(n as Text);
      else if (n.nodeName === 'BR') breaks.push(n as Element);
    }
    const { startContainer, startOffset, endContainer, endOffset } = range;
    texts.forEach(t => {
      const from = t === startContainer ? startOffset : 0;
      const to = t === endContainer ? endOffset : t.data.length;
      if (to > from) t.deleteData(from, to - from);
    });
    breaks.forEach(b => {
      const probe = document.createRange(); probe.selectNode(b);
      const inside = range.compareBoundaryPoints(Range.START_TO_START, probe) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, probe) >= 0;
      if (inside && b.parentElement?.closest('[data-scaffold-input]')) b.remove();
    });
    // 被整段选中删空的普通段落收掉，至少留一段
    Array.from(root.children).forEach(child => {
      if (child.hasAttribute('data-scaffold-id') || root.children.length <= 1) return;
      const probe = document.createRange(); probe.selectNode(child);
      const swallowed = range.compareBoundaryPoints(Range.START_TO_START, probe) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, probe) >= 0;
      if (swallowed && !(child.textContent ?? '').replace(/\u200b/g, '').trim() && !child.querySelector('img')) child.remove();
    });
    // 光标：选区从支架的框上开始的，落到那条支架输入槽的开头；否则留在选区起点
    const caret = document.createRange();
    const startInput = startBlock?.querySelector('[data-scaffold-input]');
    if (startBlock && startBlock.isConnected && startInput && !startInput.contains(range.startContainer)) {
      caret.selectNodeContents(startInput); caret.collapse(true);
    } else if (range.startContainer.isConnected && range.startContainer !== root) {
      caret.setStart(range.startContainer, Math.min(range.startOffset, range.startContainer.nodeType === Node.TEXT_NODE ? (range.startContainer.textContent ?? '').length : range.startContainer.childNodes.length));
      caret.collapse(true);
    } else {
      // 选区是从编辑区最外层开始的（全选）：落到第一块里能写字的地方
      const first = (range.startContainer === root ? root.children[Math.min(range.startOffset, root.children.length - 1)] : null) ?? root.firstElementChild;
      const target = first?.querySelector('[data-scaffold-input]') ?? first ?? root;
      caret.selectNodeContents(target); caret.collapse(true);
    }
    selection.removeAllRanges(); selection.addRange(caret);
  };

  /** 在 ] 后面回车：光标之后的字另起一段普通正文。 */
  const splitAfterScaffold = (block: Element, selection: Selection) => {
    hoistTextAfterBracket(block);
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const slotEl = block.querySelector('[data-scaffold-slot]');
    const tail = document.createRange();
    if (slotEl && slotEl.contains(range.startContainer)) tail.setStartAfter(slotEl);
    else tail.setStart(range.startContainer, range.startOffset);
    if (block.lastChild) tail.setEndAfter(block.lastChild); else tail.collapse(true);
    const rest = tail.extractContents();
    const hasRest = !!(rest.textContent ?? '').replace(/\u200b/g, '').trim() || !!rest.querySelector?.('img');
    const next = block.nextElementSibling;
    const nextIsBlankPlain = !!next && next.tagName === 'P' && !next.hasAttribute('data-scaffold-id')
      && !(next.textContent ?? '').replace(/\u200b/g, '').trim() && !next.querySelector('img');
    let paragraph: Element;
    if (!hasRest && nextIsBlankPlain) {
      paragraph = next!;
    } else {
      paragraph = document.createElement('p');
      if (hasRest) paragraph.appendChild(rest); else paragraph.appendChild(document.createElement('br'));
      block.insertAdjacentElement('afterend', paragraph);
    }
    const caret = document.createRange();
    caret.setStart(paragraph, 0); caret.collapse(true);
    selection.removeAllRanges(); selection.addRange(caret);
  };

  const isBlankText = (n: Node | null | undefined) =>
    !!n && n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').replace(/\u200b/g, '').trim();

  /** 去掉槽尾的空文本节点（Chrome 的选区操作会留下 #text("")），返回真正的最后一个节点。 */
  const pruneTrailingBlank = (slot: Element): Node | null => {
    while (slot.lastChild && isBlankText(slot.lastChild)) slot.removeChild(slot.lastChild);
    return slot.lastChild;
  };

  /** 退出支架前把结尾的换行全清掉，右括号紧跟最后一行文字。 */
  const trimTrailingBreaks = (slot: Element) => {
    for (;;) {
      const last = pruneTrailingBlank(slot);
      if (last?.nodeName === 'BR') slot.removeChild(last); else break;
    }
  };

  /** 在支架块后面另起一段普通正文，并把光标放进去。 */
  const leaveScaffold = (block: Element, selection: Selection) => {
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    block.insertAdjacentElement('afterend', paragraph);
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  /**
   * 支架里的回车 = 换行，不劈段。
   *
   * 支架是一行内联结构「标签 + [ 学生的话 ]」。浏览器默认的回车会把这个 <p> 从中间
   * 劈成两个，新段落继承标签的加粗和颜色、右括号被带到下一行 —— 学生看到的是
   * 「一换行字就变了」。这里在输入槽里插 <br>，多行答案仍然留在括号内、样式不变。
   * 想结束这条支架另起一段：Shift+Enter，或者在空行上再按一次回车。
   */
  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const isDeleteKey = event.key === 'Backspace' || event.key === 'Delete';

    // 支架后面那一段的开头按 Backspace：浏览器会把这段并进支架、文字落到 ] 外面。
    // 改成把光标送回括号末尾。
    if (event.key === 'Backspace') {
      const sel0 = window.getSelection();
      if (sel0 && sel0.rangeCount && sel0.isCollapsed) {
        const r0 = sel0.getRangeAt(0);
        const el0 = r0.startContainer.nodeType === Node.ELEMENT_NODE ? (r0.startContainer as Element) : r0.startContainer.parentElement;
        const para = el0?.closest('p');
        const prev = para?.previousElementSibling;
        if (para && prev?.hasAttribute('data-scaffold-id') && !para.closest('[data-scaffold-id]')) {
          const probe = r0.cloneRange(); probe.selectNodeContents(para); probe.setEnd(r0.startContainer, r0.startOffset);
          if (!probe.toString().replace(/\u200b/g, '')) {
            event.preventDefault();
            const input = prev.querySelector('[data-scaffold-input]');
            if (input) { const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); sel0.removeAllRanges(); sel0.addRange(r); }
            // 这一段若是空的就顺手收掉
            if (!para.textContent?.replace(/\u200b/g, '').trim() && para.nextElementSibling) para.remove();
            return;
          }
        }
      }
    }

    // 选区碰到了支架的框：删字、回车都先只清掉选中的字，框不动
    const live = window.getSelection();
    if ((isDeleteKey || event.key === 'Enter') && live && live.rangeCount && selectionTouchesFrame(live.getRangeAt(0))) {
      event.preventDefault();
      deleteSelectionKeepingFrames(live);
      if (isDeleteKey) { handleEditorInput(); return; }
    }

    const hit = caretScaffold();
    if (!hit) return;
    const { selection, block, slot } = hit;
    let zone = hit.zone;

    const isTyping = isDeleteKey || event.key === 'Enter' || (event.key.length === 1 && !event.ctrlKey && !event.metaKey) || event.key === 'Process';
    if (isTyping && slot && selection.isCollapsed) {
      if (zone === 'before') {
        // 光标落在话头或 [ 前面：要写的字属于括号里，送进输入槽开头
        const r = document.createRange(); r.selectNodeContents(slot); r.collapse(true);
        selection.removeAllRanges(); selection.addRange(r);
        zone = 'inside';
      } else if (zone === 'after') {
        hoistTextAfterBracket(block);
      }
    }

    if (isDeleteKey) {
      const r = selection.getRangeAt(0);
      if (slot && r.collapsed && zone === 'after') {
        // 紧贴着 ] 按 Backspace：括号删不得，光标退回括号里
        if (event.key === 'Backspace') {
          const closing = Array.from(block.querySelectorAll('[data-scaffold-bracket]')).pop();
          const gap = document.createRange();
          if (closing) { gap.setStartAfter(closing); gap.setEnd(r.startContainer, r.startOffset); }
          if (!closing || !gap.toString().replace(/\u200b/g, '')) {
            event.preventDefault();
            const back = document.createRange(); back.selectNodeContents(slot); back.collapse(false);
            selection.removeAllRanges(); selection.addRange(back);
          }
        }
        return;
      }
      if (slot && r.collapsed && event.key === 'Backspace' && slot.contains(r.startContainer)) {
        // 空行开头按 Backspace：连同垫在行首的零宽字符和上面的 <br> 一起收掉，
        // 否则第一下只删掉看不见的那个字符，像是没反应
        const lineStart = r.cloneRange(); lineStart.selectNodeContents(slot); lineStart.setEnd(r.startContainer, r.startOffset);
        const fragment = lineStart.cloneContents();
        let tail: Node | null = fragment.lastChild;
        let sawAnchor = false;
        while (tail && tail.nodeType === Node.TEXT_NODE && !(tail.textContent ?? '').replace(/\u200b/g, '')) {
          if ((tail.textContent ?? '').includes('\u200b')) sawAnchor = true;
          tail = tail.previousSibling;
        }
        if (sawAnchor && tail?.nodeName === 'BR') {
          event.preventDefault();
          // 光标前紧挨着的节点：零宽文本节点们，再往前是那个 <br>
          let node: Node | null = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer : r.startContainer.childNodes[r.startOffset - 1] ?? null;
          if (node && node.nodeType === Node.TEXT_NODE && node === r.startContainer) {
            const text = node as Text;
            const rest = text.data.slice(r.startOffset);
            text.data = rest;
          }
          let prev: Node | null = node?.previousSibling ?? null;
          if (node && node.nodeType === Node.TEXT_NODE && !(node as Text).data) { const gone = node; node = null; gone.parentNode?.removeChild(gone); }
          while (prev && prev.nodeType === Node.TEXT_NODE && !(prev.textContent ?? '').replace(/\u200b/g, '')) { const gone = prev; prev = prev.previousSibling; gone.parentNode?.removeChild(gone); }
          if (prev?.nodeName === 'BR') {
            const before = prev.previousSibling;
            prev.parentNode?.removeChild(prev);
            const caret = document.createRange();
            if (before && before.nodeType === Node.TEXT_NODE) caret.setStart(before, (before.textContent ?? '').length);
            else if (before) caret.setStartAfter(before);
            else { caret.selectNodeContents(slot); caret.collapse(true); }
            caret.collapse(true);
            selection.removeAllRanges(); selection.addRange(caret);
            // 退回去的位置又是「<br> 之后、后面没字」：同样要垫一个
            if (before?.nodeName === 'BR' && !before.nextSibling) placeCaretAfterBreak(before, selection);
          }
          handleEditorInput();
          return;
        }
      }
      if (slot && r.collapsed) {
        const before = r.cloneRange(); before.selectNodeContents(slot); before.setEnd(r.startContainer, r.startOffset);
        const after = r.cloneRange(); after.selectNodeContents(slot); after.setStart(r.endContainer, r.endOffset);
        const atStart = !before.toString().replace(/\u200b/g, '') && !before.cloneContents().querySelector('br');
        const atEnd = !after.toString().replace(/\u200b/g, '') && !after.cloneContents().querySelector('br');
        if ((event.key === 'Backspace' && atStart) || (event.key === 'Delete' && atEnd)) { event.preventDefault(); return; }
      }
      if (!slot) { event.preventDefault(); return; }   // 光标落在框上（不可编辑区）：什么都别删
      return;
    }

    if (event.key !== 'Enter') return;
    event.preventDefault();

    // ] 后面就是支架外：回车另起一段普通正文
    if (slot && zone === 'after') {
      splitAfterScaffold(block, selection);
      handleEditorInput();
      return;
    }

    const range = selection.getRangeAt(0);
    // 回车在支架内换行，] 跟着落到新行末尾。Shift+Enter 保留为备用出口。
    if (!slot || event.shiftKey) {
      if (slot) trimTrailingBreaks(slot);
      leaveScaffold(block, selection);
      handleEditorInput();
      return;
    }

    breakLineInSlot(selection, range, slot);
  };

  /**
   * 在支架槽内插一个换行。keydown 和 beforeinput 两条路径共用。
   * 不补占位 <br>：] 紧跟在输入槽后面，换行之后它自己就落在新行上，光标停在它前面。
   * 以前补了一个，结果光标在第二行、] 被顶到第三行。
   */
  const breakLineInSlot = (selection: Selection, range: Range, slot: Element) => {
    range.deleteContents();
    // 光标被浏览器归一化到了输入槽外面（槽的外层 span 上）：换行要落在槽的末尾
    if (!slot.contains(range.startContainer)) { range.selectNodeContents(slot); range.collapse(false); }
    const br = document.createElement('br');
    range.insertNode(br);
    placeCaretAfterBreak(br, selection);
    handleEditorInput();
  };

  /**
   * 把光标放到 <br> 后面的新行上。
   * 新行后面没有字时，光标位置是「输入槽末尾、<br> 之后」，浏览器会把它归一化到
   * 下一个可编辑位置 —— 也就是 ] 的后面，学生接着打的字就落到了支架外。
   * 垫一个零宽字符让光标有一个真实的文本节点可停（保存时由 stripScaffoldPlaceholders 去掉）。
   */
  const placeCaretAfterBreak = (br: Node, selection: Selection) => {
    let following: Node | null = br.nextSibling;
    while (following && isBlankText(following)) { const gone = following; following = following.nextSibling; gone.parentNode?.removeChild(gone); }
    const caret = document.createRange();
    if (!following) {
      const anchor = document.createTextNode('\u200b');
      br.parentNode?.insertBefore(anchor, br.nextSibling);
      caret.setStart(anchor, 1);
    } else {
      caret.setStartAfter(br);
    }
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  };

  /**
   * 兜底：keydown 没拦到的回车（中文输入法参与时，浏览器不一定给 keydown 一个干净的 Enter），
   * 在 beforeinput 的 insertParagraph 这一刻再拦一次 —— 这是浏览器真正要劈段的位置。
   */
  const handleEditorBeforeInput = (event: InputEvent) => {
    const live = window.getSelection();
    const guarded = ['insertText', 'insertParagraph', 'insertLineBreak', 'deleteContentBackward', 'deleteContentForward',
      'deleteByCut', 'deleteByDrag', 'deleteWordBackward', 'deleteWordForward', 'insertReplacementText'];
    if (live && live.rangeCount && guarded.includes(event.inputType) && event.cancelable && selectionTouchesFrame(live.getRangeAt(0))) {
      // 选中的范围带上了支架的框，再打字/剪切/删除：只动选中的字
      event.preventDefault();
      deleteSelectionKeepingFrames(live);
      if ((event.inputType === 'insertText' || event.inputType === 'insertReplacementText') && event.data) {
        const r = live.getRangeAt(0);
        const text = document.createTextNode(event.data);
        r.insertNode(text);
        r.setStartAfter(text); r.collapse(true);
        live.removeAllRanges(); live.addRange(r);
      }
      if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') { handleEditorInput(); return; }
    }
    if (event.inputType !== 'insertParagraph') return;
    const hit = caretScaffold();
    if (!hit?.slot) return;
    event.preventDefault();
    const { selection, slot, block, zone } = hit;
    if (zone === 'after') { splitAfterScaffold(block, selection); handleEditorInput(); return; }
    breakLineInSlot(selection, selection.getRangeAt(0), slot);
  };
  beforeInputRef.current = handleEditorBeforeInput;

  /** 粘贴进支架槽只收纯文本：带格式的富文本会把括号结构撑坏。 */
  const handleEditorPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const live = window.getSelection();
    const touches = !!live && live.rangeCount > 0 && selectionTouchesFrame(live.getRangeAt(0));
    if (touches && live) deleteSelectionKeepingFrames(live);
    const hit = caretScaffold();
    if (!hit?.slot || hit.zone === 'after') {
      if (touches) { event.preventDefault(); const plain = event.clipboardData.getData('text/plain'); if (plain) document.execCommand('insertText', false, plain); handleEditorInput(); }
      return;
    }
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    const selection = hit.selection;
    const range = selection.getRangeAt(0);
    if (hit.zone === 'before' || !hit.slot.contains(range.startContainer)) { range.selectNodeContents(hit.slot); range.collapse(hit.zone === 'before'); }
    else range.deleteContents();
    const frag = document.createDocumentFragment();
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, i) => {
      if (i > 0) frag.appendChild(document.createElement('br'));
      if (line) frag.appendChild(document.createTextNode(line));
    });
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) { range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
    handleEditorInput();
  };

  /**
   * 兜底修复：把被劈坏的支架段落还原成普通正文。
   * 无论哪条路径劈开了 <p data-scaffold-id>，克隆出来的那一半没有话头标签却带着
   * data-scaffold-id 和 <strong>。研究编码会把它误算成支架段，学生看到的是变粗的字。
   */
  /**
   * 第三道保险：回车既没被 keydown 拦下、beforeinput 又不可取消（execCommand、部分输入法），
   * 浏览器就会把支架劈成前后两个同 id 的块。这里把后一块并回前一块，劈开处换成 <br>，
   * 光标落在并回去的那一行开头 —— 学生看到的效果和正常的槽内换行一样。
   */
  const mergeSplitScaffolds = (root: HTMLElement) => {
    root.querySelectorAll<HTMLElement>('[data-scaffold-id]').forEach(block => {
      if (!block.isConnected) return;
      const next = block.nextElementSibling as HTMLElement | null;
      if (!next || next.getAttribute('data-scaffold-id') !== block.getAttribute('data-scaffold-id')) return;
      const input = block.querySelector<HTMLElement>('[data-scaffold-input]');
      if (!input) return;
      const nextInput = next.querySelector<HTMLElement>('[data-scaffold-input]');
      // 在末尾劈开时 Chrome 给的后半块没有输入槽，只有一个 <br> 或残留的 "]"：只取文字和换行
      const collect = (node: Node, out: Node[]) => {
        node.childNodes.forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) {
            const t = (child.textContent ?? '').replace(/^\]\s*/, '').replace(/\u200b/g, '');
            if (t) out.push(document.createTextNode(t));
          } else if (child.nodeName === 'BR') out.push(document.createElement('br'));
          else if (!(child as Element).hasAttribute?.('data-scaffold-tag') && !(child as Element).hasAttribute?.('data-scaffold-bracket')) collect(child, out);
        });
      };
      let moved: Node[] = [];
      if (nextInput) moved = Array.from(nextInput.childNodes).filter(n => !isBlankText(n));
      else collect(next, moved);
      const br = document.createElement('br');
      input.appendChild(br);
      moved.forEach(n => input.appendChild(n));
      // 在末尾劈开时后半块只有一个占位 <br>，带回来就多出一行空白
      if (moved.length === 1 && moved[0].nodeName === 'BR') moved[0].parentNode?.removeChild(moved[0]);
      next.remove();
      const sel = window.getSelection();
      if (sel) placeCaretAfterBreak(br, sel);
    });
  };

  const repairSplitScaffolds = (root: HTMLElement) => {
    root.querySelectorAll('[data-scaffold-id]').forEach(block => {
      if (block.querySelector('[data-scaffold-tag]') || block.querySelector('[data-scaffold-input]')) return;
      const p = document.createElement('p');
      // 只保留文字与换行；括号残片和加粗一起丢掉
      const walk = (node: Node) => {
        node.childNodes.forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) {
            const t = (child.textContent ?? '').replace(/^\]\s*/, '').replace(/\u200b/g, '');
            if (t) p.appendChild(document.createTextNode(t));
          } else if (child.nodeName === 'BR') {
            p.appendChild(document.createElement('br'));
          } else {
            walk(child);
          }
        });
      };
      walk(block);
      if (!p.childNodes.length) p.appendChild(document.createElement('br'));
      block.replaceWith(p);
    });
  };

  const checkAutoFeedback = async (html: string, live = captureAiSession()) => {
    if (!noteId) return;
    const plainText = stripHtml(html);
    if (plainText.length < 120) return;
    const nextHash = hashText(plainText);
    if (nextHash === lastFeedbackHashRef.current) return;
    if (Date.now() - lastFeedbackAtRef.current < 45000) return;

    // 已经换了笔记也照样检查（那是上一条笔记的内容），只是结果不进眼前的面板
    if (live()) {
      setCheckingFeedback(true);
      setAiError(null);
    }
    try {
      const result = await noteAiFeedback.check(noteId, {
        content: html,
        provider_id: concreteAiSelection?.providerId,
        model: concreteAiSelection?.model,
        last_feedback_id: latestFeedback?.id,
      });
      if (!live()) return;
      lastFeedbackHashRef.current = nextHash;
      lastFeedbackAtRef.current = Date.now();
      if (result.triggered && result.feedback) {
        setFeedbacks(prev => [result.feedback!, ...prev.filter(item => item.id !== result.feedback!.id)]);
        setAiOpen(true);
      }
    } catch (error) {
      if (live()) setAiError(error instanceof Error ? error.message : 'Failed to check auto feedback');
    } finally {
      if (live()) setCheckingFeedback(false);
    }
  };

  const handleAskAI = async () => {
    if (!noteId || requestingFeedback) return;
    const live = captureAiSession();
    setRequestingFeedback(true);
    setAiError(null);
    try {
      const result = await noteAiFeedback.requestFeedback(noteId, {
        content: editorRef.current?.innerHTML,
        provider_id: concreteAiSelection?.providerId,
        model: concreteAiSelection?.model,
      });
      if (!live()) return;
      if (result.triggered && result.feedback) {
        setFeedbacks(prev => [result.feedback!, ...prev.filter(item => item.id !== result.feedback!.id)]);
        setAiOpen(true);
      }
    } catch (error) {
      if (live()) setAiError(error instanceof Error ? error.message : 'Failed to request feedback');
    } finally {
      if (live()) setRequestingFeedback(false);
    }
  };

  const getEditorTextOffset = (editor: HTMLElement, range: Range) => {
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(editor);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    return beforeRange.toString().length;
  };

  const createEditorRangeAtTextOffset = (editor: HTMLElement, offset: number) => {
    const range = document.createRange();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let current = walker.nextNode();

    while (current) {
      const length = current.textContent?.length ?? 0;
      if (remaining <= length) {
        range.setStart(current, remaining);
        range.collapse(true);
        return range;
      }
      remaining -= length;
      current = walker.nextNode();
    }

    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  };

  const saveEditorSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    editorRangeRef.current = range.cloneRange();
    editorTextOffsetRef.current = getEditorTextOffset(editor, range);
  };

  const restoreEditorSelection = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();

    const savedRange = editorRangeRef.current;
    if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
      selection.addRange(savedRange);
      return;
    }

    const savedOffset = editorTextOffsetRef.current;
    if (savedOffset != null) {
      const range = createEditorRangeAtTextOffset(editor, savedOffset);
      selection.addRange(range);
      editorRangeRef.current = range.cloneRange();
      editorTextOffsetRef.current = getEditorTextOffset(editor, range);
      return;
    }

    const fallbackRange = document.createRange();
    fallbackRange.selectNodeContents(editor);
    fallbackRange.collapse(false);
    selection.addRange(fallbackRange);
    editorRangeRef.current = fallbackRange.cloneRange();
    editorTextOffsetRef.current = editor.innerText.length;
  };

  /**
   * 支架栏和 AI 面板在每个页签上都在。从别的页签往正文里插东西，先同步切回「撰写」再插：
   * 编辑区藏着时拿不到焦点，光标落不进去，插完学生也看不见插在了哪
   */
  const showEditorTab = () => {
    if (activeTab !== 'edit') flushSync(() => setActiveTab('edit'));
  };

  const insertHtmlAtCursor = (html: string, caretSelector?: string) => {
    showEditorTab();
    const editor = editorRef.current;
    if (!editor) return;

    const savedRange = editorRangeRef.current;
    const range = savedRange && editor.contains(savedRange.commonAncestorContainer)
      ? savedRange.cloneRange()
      : createEditorRangeAtTextOffset(editor, editorTextOffsetRef.current ?? editor.textContent?.length ?? 0);

    editor.focus();
    range.deleteContents();
    const fragment = range.createContextualFragment(DOMPurify.sanitize(html));
    const caretTarget = caretSelector ? fragment.querySelector(caretSelector) : null;
    // 插进来的都是块（支架、AI 块、图片、附件）：只放在最外层，光标在段落中间就把段落劈开。
    // 直接 insertNode 会把块套进 <p>，存进库的字符串一解析就变样
    const inserted = insertFragmentAtRange(editor, range, fragment);
    const lastNode = inserted[inserted.length - 1] ?? null;

    const nextRange = document.createRange();
    if (caretTarget && caretTarget.parentNode) {
      // 支架标记：光标落进方括号里，学生接着写自己的话
      nextRange.selectNodeContents(caretTarget);
      nextRange.collapse(false);
    } else if (lastNode && lastNode.parentNode) {
      // 块后面跟着的空段落是留给学生接着写的，光标放进去
      if (lastNode.nodeName === 'P' && !hasVisibleContent(lastNode as Element)) nextRange.setStart(lastNode, 0);
      else nextRange.setStartAfter(lastNode);
    } else {
      nextRange.selectNodeContents(editor);
      nextRange.collapse(false);
    }
    nextRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(nextRange);
    editorRangeRef.current = nextRange.cloneRange();
    editorTextOffsetRef.current = getEditorTextOffset(editor, nextRange);
    saveEditorSelection();
    const nextHtml = editorRef.current?.innerHTML ?? '';
    updateWordCount();
    scheduleFeedbackCheck(nextHtml);
  };

  const execCmd = (command: string, value?: string) => {
    restoreEditorSelection();
    document.execCommand(command, false, value);
    saveEditorSelection();
    updateWordCount();
  };

  const formatBlock = (tagName: 'p' | 'h1' | 'h2') => {
    restoreEditorSelection();
    const block = tagName === 'p' ? '<p>' : `<${tagName}>`;
    document.execCommand('formatBlock', false, block);
    saveEditorSelection();
    updateWordCount();
  };

  const insertEditorLink = () => {
    const url = window.prompt(t.linkPrompt);
    if (!url) return;
    const trimmedUrl = url.trim();
    if (!isSafeHttpUrl(trimmedUrl)) {
      setAiError(lang === 'zh' ? '链接需要以 http:// 或 https:// 开头。' : 'The link must start with http:// or https://.');
      return;
    }
    execCmd('createLink', trimmedUrl);
  };

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  const insertImageFile = async (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      setAiError(t.fileTooLarge);
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const html = `<figure data-note-asset="image" style="margin:12px 0;border:1px solid #dbe3ea;background:#f8fafc;border-radius:8px;padding:10px;"><img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(file.name)}" style="display:block;max-width:100%;height:auto;border-radius:6px;" /><figcaption style="margin-top:6px;font-size:12px;color:#64748b;">${escapeHtml(file.name)}</figcaption></figure><p><br></p>`;
    insertHtmlAtCursor(html);
  };

  const insertDocumentFile = async (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      setAiError(t.fileTooLarge);
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const sizeKb = Math.max(1, Math.round(file.size / 1024));
    const html = `<p data-note-asset="document" style="margin:12px 0;"><a href="${escapeHtml(dataUrl)}" download="${escapeHtml(file.name)}" style="display:flex;align-items:center;gap:10px;border:1px solid #cbd5e1;background:#f8fafc;color:#1e3a8a;text-decoration:none;border-radius:8px;padding:10px 12px;word-break:break-word;"><span style="display:inline-flex;width:30px;height:30px;align-items:center;justify-content:center;border-radius:6px;background:#dbeafe;color:#1e40af;font-weight:700;">DOC</span><span><strong style="display:block;color:#1e293b;">${escapeHtml(file.name)}</strong><span style="font-size:12px;color:#64748b;">${sizeKb} KB</span></span></a></p><p><br></p>`;
    insertHtmlAtCursor(html);
  };

  const handleImageInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void insertImageFile(file);
  };

  const handleDocumentInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void insertDocumentFile(file);
  };

  /** 认知路标一类的自由句式，没有对应的支架条目，仍按加粗段落插入。 */
  const insertPrompt = (prompt: string, scaffoldId: string, stepId: string) => {
    insertHtmlAtCursor(`<p><strong>${escapeHtml(prompt)}</strong></p><p><br></p>`);
    if (spaceId) {
      trackEvent({
        event_type: 'scaffold_step_inserted',
        object_type: 'scaffold',
        object_id: scaffoldId,
        space_id: spaceId,
        metadata_json: { step_id: stepId },
      });
    }
  };

  /** 支架库里的支架：插成「**支架文本**[ ]」，光标停在方括号内。 */
  /**
   * 插入 AI 自适应支架：把反馈附带的半句话头当作一条临时支架插进正文。
   * 它不在支架库里，id 用 ai-feedback:<反馈id>，研究编码据此区分教师支架与 AI 支架。
   */
  const insertAiScaffold = (sg: { id: string; text: string }) => {
    const pseudo = {
      id: `ai-feedback:${sg.id}`, title: sg.text, titleEn: sg.text, category: 'AI/adaptive', sortOrder: 0,
      metadata: { l1: 'KB', origin: 'ai_adaptive' },
    } as unknown as Scaffold;
    insertScaffoldMarker(pseudo);
    editorRef.current?.querySelectorAll(`[data-scaffold-id="ai-feedback:${sg.id}"]`).forEach(b => b.setAttribute('data-scaffold-origin', 'ai'));
    if (noteId) {
      noteAiFeedback.scaffoldUsed(noteId, sg.id)
        .then(({ feedback }) => setFeedbacks(prev => prev.map(f => (f.id === feedback.id ? feedback : f))))
        .catch(() => {});
    }
  };

  /**
   * 插入支架。学生常常先写了几句、再回头选支架：这时把光标所在的那一段
   * （或选中的那几个字）直接框进括号里，而不是在末尾再开一个空支架。
   */
  const insertScaffoldMarker = (scaffold: Scaffold) => {
    showEditorTab();
    const editor = editorRef.current;
    const selection = window.getSelection();
    const saved = editorRangeRef.current;
    const range = saved && editor && editor.contains(saved.commonAncestorContainer) ? saved.cloneRange()
      : selection && selection.rangeCount && editor?.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0).cloneRange()
      : null;

    const blockOf = (n: Node | null): HTMLElement | null => {
      const el = n && n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : n?.parentElement ?? null;
      const b = el?.closest<HTMLElement>('p, div, li, h1, h2, h3, blockquote');
      return b && editor && editor.contains(b) && b !== editor ? b : null;
    };
    const build = (bodyHtml: string) => {
      const tpl = document.createElement('template');
      tpl.innerHTML = scaffoldMarkerHtml(scaffold, lang);
      const block = tpl.content.firstElementChild as HTMLElement;
      const input = block.querySelector<HTMLElement>('[data-scaffold-input]')!;
      if (bodyHtml.replace(/\u200b|<br\s*\/?>|&nbsp;|\s/gi, '')) input.innerHTML = bodyHtml;
      return { block, input };
    };
    const finish = (block: HTMLElement, input: HTMLElement) => {
      if (!block.nextElementSibling || block.nextElementSibling.hasAttribute('data-scaffold-id')) {
        const pEl = document.createElement('p'); pEl.appendChild(document.createElement('br'));
        block.insertAdjacentElement('afterend', pEl);
      }
      normalizeScaffoldMarkers(editor!);
      const r = document.createRange(); r.selectNodeContents(input); r.collapse(false);
      selection?.removeAllRanges(); selection?.addRange(r);
      editor!.focus();
      saveEditorSelection();
      handleEditorInput();
    };

    const whole = editor && range ? wholeBlockOf(editor, range.startContainer) : null;
    let startBlock = range && !whole ? blockOf(range.startContainer) : null;
    const isBlank = (el: Element | null) => !!el && !(el.textContent ?? '').replace(/\u200b/g, '').trim();
    // 能整段框进支架的只有只装着字的普通段落；里面有别的块，框进去就成了 <p> 里套块
    const isPlain = (el: Element | null) => !!el && !!editor && !wholeBlockOf(editor, el) && !containsBlock(el);
    // 学生写完一句、回车到了下面的空行再来选支架：他要框的是上一段，不是这个空行
    if (startBlock && range?.collapsed && isBlank(startBlock) && isPlain(startBlock)) {
      const prev = startBlock.previousElementSibling as HTMLElement | null;
      if (prev && isPlain(prev) && !isBlank(prev)) { startBlock.remove(); startBlock = prev; }
    }
    // 光标根本不在编辑器里（先点了别处）：框最后一段有字的普通段落
    if (!startBlock && !whole && editor) {
      const paras = Array.from(editor.children) as HTMLElement[];
      startBlock = [...paras].reverse().find(el => isPlain(el) && !isBlank(el)) ?? null;
    }
    if (editor && startBlock && isPlain(startBlock)) {
      if (range && !range.collapsed && blockOf(range.startContainer) === startBlock && blockOf(range.endContainer) === startBlock) {
        // 选中了一段里的几个字：前后各留成普通段，中间框进支架
        const before = range.cloneRange(); before.selectNodeContents(startBlock); before.setEnd(range.startContainer, range.startOffset);
        const after = range.cloneRange(); after.selectNodeContents(startBlock); after.setStart(range.endContainer, range.endOffset);
        const html = (f: DocumentFragment) => { const d = document.createElement('div'); d.appendChild(f); return d.innerHTML; };
        const beforeHtml = html(before.cloneContents()), selHtml = html(range.cloneContents()), afterHtml = html(after.cloneContents());
        const { block, input } = build(selHtml);
        const frag = document.createDocumentFragment();
        const nonBlank = (h: string) => h.replace(/\u200b|<br\s*\/?>|&nbsp;|\s/gi, '') !== '';
        if (nonBlank(beforeHtml)) { const pEl = document.createElement('p'); pEl.innerHTML = beforeHtml; frag.appendChild(pEl); }
        frag.appendChild(block);
        if (nonBlank(afterHtml)) { const pEl = document.createElement('p'); pEl.innerHTML = afterHtml; frag.appendChild(pEl); }
        // 列表项、引用里的段落：从它前后把外层容器劈开，支架落在最外层
        replaceAtTopLevel(editor, startBlock, [frag]);
        finish(block, input);
      } else {
        // 光标停在某一段里：整段框进支架（空段就是一个空支架）
        const { block, input } = build(startBlock.innerHTML);
        replaceAtTopLevel(editor, startBlock, [block]);
        finish(block, input);
      }
    } else if (editor && whole) {
      // 光标正停在某条支架里（或 AI 块、图片、导入的引文这类整块里）：新支架接在它后面，
      // 绝不嵌套，也不把整块里的字框进支架 —— 研究切分按整块认来源
      const host = topLevelOf(editor, whole)!;
      const { block, input } = build('');
      host.after(block);
      finish(block, input);
    } else {
      insertHtmlAtCursor(scaffoldMarkerHtml(scaffold, lang), SCAFFOLD_CARET_SELECTOR);
      const hit = caretScaffold();
      if (hit) finish(hit.block as HTMLElement, hit.slot as HTMLElement);
    }
    if (spaceId) {
      trackEvent({
        event_type: 'scaffold_used',
        object_type: 'scaffold',
        object_id: scaffold.id,
        space_id: spaceId,
        metadata_json: {
          note_id: noteId ?? null,
          category: scaffold.category,
          l1: scaffold.metadata?.l1 ?? null,
          gai: isGenAiScaffold(scaffold),
        },
      });
    }
  };

  const ensureAiThread = async (): Promise<NoteConversationThread> => {
    // 只认这条笔记自己的线程；新草稿还没有 noteId，一律先落库再开
    if (selectedThread && selectedThread.noteId === noteId) return selectedThread;
    if (!concreteAiSelection) throw new Error(t.noAi);
    const live = captureAiSession();

    // 新笔记还没落库就不会有 noteId，而对话线程的 note_id 是 NOT NULL。
    // 先把草稿存下来再开对话——学生本来就是来写这条笔记的，
    // 拦住他反而莫名其妙。以前这里抛的是 t.noAi，
    // 于是屏幕上写着「教师尚未配置可用 GenAI」，把人往配置页面带，
    // 真实原因却是「笔记还没保存」。
    let targetNoteId = noteId;
    if (!targetNoteId) {
      if (!onPersistDraft) throw new Error(t.saveNoteFirst);
      justPersistedRef.current = true;
      const draftSave = { session: aiSessionRef.current, noteId: null as string | null };
      aiDraftSaveRef.current = draftSave;
      targetNoteId = (await onPersistDraft(
        title.trim() || (lang === 'zh' ? '未命名笔记' : 'Untitled Note'),
        stripScaffoldPlaceholders(editorRef.current?.innerHTML || ''),
      )) ?? undefined;
      if (!targetNoteId) {
        if (live()) justPersistedRef.current = false;
        if (aiDraftSaveRef.current === draftSave) aiDraftSaveRef.current = null;
        throw new Error(t.saveNoteFirst);
      }
      draftSave.noteId = targetNoteId;
    }

    const existing = threads.find(thread => thread.targetType === 'ai' && thread.noteId === targetNoteId);
    if (existing) {
      if (live()) setSelectedThread(existing);
      return existing;
    }
    const { conversation } = await noteConversations.create(targetNoteId, {
      target_type: 'ai',
      provider_id: concreteAiSelection.providerId,
      model: concreteAiSelection.model,
      title: `GenAI · ${title || initialData?.title || 'Note'}`,
    });
    // 学生已经关掉或换了一条：这一问仍记在提问时那条笔记名下，只是不再写进眼前的面板
    if (live()) {
      setThreads(prev => withThreadFirst(prev, conversation));
      setSelectedThread(conversation);
    }
    return conversation;
  };

  /** 这段对话第一次问话：列表里从此用这句话认它 */
  const rememberQuestion = (threadId: string, question: string) => {
    setThreads(prev => withFirstQuestion(prev, threadId, question));
  };

  /** 一次 AI 回合。发送与「重新生成」共用同一条链路。 */
  const runAiTurn = async (prompt: string, options: { restoreInputOnError?: boolean } = {}) => {
    if (!prompt.trim() || sending) return;
    if (!canChatWithAI || !concreteAiSelection) {
      setAiError(t.noAi);
      return;
    }
    const live = captureAiSession();
    beginAiTurn();
    setAiError(null);
    const tempAssistantId = `stream-${Date.now()}`;
    const turnAttachments = aiAttachments;
    setAiAttachments([]);
    // 附件正文随 attachments 一起送给后端：后端只把它拼进这一轮的模型输入，
    // 不写进消息正文。以前是拼在 content 里的，于是整篇 PDF 在对话里铺开，
    // 而且被当成学生写的字存进了库、进了研究导出。
    // 学生自己的话必须立刻出现。等服务器写库再经 SSE 回传 userMessage 要几百毫秒
    // （库在首尔），那段空白看起来就像卡住了。
    const tempUserId = `local-user-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempUserId,
      threadId: selectedThread?.id ?? '',
      senderKind: 'user',
      senderId: userId,
      content: prompt,
      attachments: [],
      aiMetadata: {},
      createdAt: new Date().toISOString(),
    } as NoteConversationMessage]);
    // 出错时附件和问题都放回输入框（重新生成的问题本来就在对话里，不放）。
    // 服务端还没回传「已存下」的提问，对话里那条也撤掉
    const putBack = () => {
      setMessages(prev => prev.filter(message => message.id !== tempUserId));
      setAiAttachments(prev => restoreTurnAttachments(turnAttachments, prev));
      if (options.restoreInputOnError !== false) setAiInput(prev => (prev.trim() ? prev : prompt));
    };
    try {
      const thread = await ensureAiThread();
      if (live()) rememberQuestion(thread.id, prompt);
      const reader = await noteConversations.streamAIMessage(thread.id, {
        content: prompt,
        provider_id: concreteAiSelection.providerId,
        model: concreteAiSelection.model,
        use_web_search: useWebSearchForNextMessage,
        agent_mode: selectedAgentMode || undefined,
        attachments: turnAttachments,
        answer_length: getAnswerLength(),
        // 选了具体模式才走智能体；「自由提问」直接打模型，省掉工具装载和 ReAct 循环
        // 但带了图必须走智能体那条：只有它会挂 image_url 并切到视觉模型。
      }, Boolean(selectedAgentMode) || turnAttachments.length > 0);
      let streamedText = '';
      let failed = false;
      await readSSEStream(reader, event => {
        // 学生已经换了笔记：这一问照样在它自己的线程里答完，只是不往眼前的面板写
        if (!live()) return;
        if (event === '[DONE]') return;
        if (typeof event.error === 'string') {
          failed = true;
          setAiError(event.error);
          return;
        }
        if (event.userMessage) {
          // 用服务端那条替换掉本地占位，位置不能变——否则学生的话会跑到回复后面
          const real = event.userMessage as NoteConversationMessage;
          setMessages(prev => settleOptimisticMessage(prev, tempUserId, real));
          return;
        }
        if (typeof event.toolStatus === 'string') {
          setMessages(prev => {
            const existing = prev.find(message => message.id === tempAssistantId);
            const nextMetadata = {
              provider_id: concreteAiSelection.providerId,
              model: concreteAiSelection.model,
              streaming: true,
              toolStatus: event.toolStatus,
              toolNames: event.toolNames ?? [],
              // 每一步的状态、结果、用时（AgentProcess）
              toolSteps: applyToolEvent((existing?.aiMetadata?.toolSteps as ToolCallInfo[] | undefined) ?? [], event),
              use_web_search: useWebSearchForNextMessage,
              agent_mode: selectedAgentMode,
            };
            if (existing) {
              return prev.map(message => message.id === tempAssistantId
                ? { ...message, aiMetadata: { ...message.aiMetadata, ...nextMetadata } }
                : message);
            }
            return [...prev, {
              id: tempAssistantId,
              threadId: thread.id,
              senderKind: 'assistant',
              content: '',
              attachments: [],
              aiMetadata: nextMetadata,
              createdAt: new Date().toISOString(),
            } as NoteConversationMessage];
          });
          return;
        }
        if (Array.isArray(event.kbSources)) {
          // 来源卡片挂在这条临时消息上，回答写完由服务端存下的 ai_metadata.kb_sources 接手
          const sources = event.kbSources;
          setMessages(prev => prev.map(message => (message.id === tempAssistantId
            ? { ...message, aiMetadata: { ...message.aiMetadata, kb_sources: sources } }
            : message)));
          return;
        }
        if (typeof event.reasoningStatus === 'string') {
          setMessages(prev => {
            const existing = prev.find(message => message.id === tempAssistantId);
            const nextMetadata = {
              provider_id: concreteAiSelection.providerId,
              model: concreteAiSelection.model,
              streaming: true,
              reasoningStatus: event.reasoningStatus,
              reasoningChars: event.reasoningChars,
              use_web_search: useWebSearchForNextMessage,
              agent_mode: selectedAgentMode,
            };
            if (existing) {
              return prev.map(message => message.id === tempAssistantId
                ? { ...message, aiMetadata: { ...message.aiMetadata, ...nextMetadata } }
                : message);
            }
            return [...prev, {
              id: tempAssistantId,
              threadId: thread.id,
              senderKind: 'assistant',
              content: '',
              attachments: [],
              aiMetadata: nextMetadata,
              createdAt: new Date().toISOString(),
            } as NoteConversationMessage];
          });
          return;
        }
        if (typeof event.token === 'string') {
          streamedText += event.token;
          setMessages(prev => {
            const existing = prev.find(message => message.id === tempAssistantId);
            if (existing) return prev.map(message => message.id === tempAssistantId ? { ...message, content: streamedText } : message);
            return [...prev, {
              id: tempAssistantId,
              threadId: thread.id,
              senderKind: 'assistant',
              content: streamedText,
              attachments: [],
              aiMetadata: { provider_id: concreteAiSelection.providerId, model: concreteAiSelection.model, streaming: true, use_web_search: useWebSearchForNextMessage, agent_mode: selectedAgentMode || undefined },
              createdAt: new Date().toISOString(),
            } as NoteConversationMessage];
          });
          return;
        }
        if (event.assistantMessage) {
          const assistant = event.assistantMessage as NoteConversationMessage;
          setMessages(prev => (prev.some(message => message.id === assistant.id)
            ? prev.filter(message => message.id !== tempAssistantId)
            : prev.map(message => (message.id === tempAssistantId ? assistant : message))));
        }
      });
      if (failed && live()) putBack();
    } catch (error) {
      if (!live()) return;
      setAiError(error instanceof Error ? error.message : 'Failed to send AI message');
      putBack();
    } finally {
      if (live()) endAiTurn();
    }
  };

  const sendAiMessage = async () => {
    const prompt = aiInput.trim();
    // 挂了附件也要写一句问题才发（chatAttachments.ts）
    if (!prompt || sending || routingRef.current) return;
    // 要画图（新画一张或改上一张）就直接出图（课程设置里「生成图片」那一行，默认 DMX），不经对话模型。
    // 要不要画由服务端的 Jev 判断（drawRouting.ts），和图不沾边的句子不问。带了附件的照常对话
    if (aiAttachments.length === 0) {
      const live = captureAiSession();
      routingRef.current = true;
      let choice: DrawChoice;
      try {
        choice = await chooseDrawing(prompt, { previous: previousDrawingFrom(messages), lastReply: lastReplyFrom(messages) });
      } finally {
        routingRef.current = false;
      }
      if (!live()) return;
      if (choice.draw) {
        setPromptBeforeRefine(null);
        await generateImageDirect(prompt, choice);
        return;
      }
    }
    setAiInput('');
    setPromptBeforeRefine(null);
    await runAiTurn(prompt);
  };

  /** 重新生成：把这条回复之前最近的一条学生消息再跑一遍，输入框里正在写的内容不动。 */
  const regenerateAiMessage = async (assistantId: string) => {
    const index = messages.findIndex(message => message.id === assistantId);
    if (index < 0) return;
    const previousUser = [...messages.slice(0, index)].reverse().find(message => message.senderKind === 'user');
    if (!previousUser?.content?.trim()) return;
    // 这条回复是一张图：按同一句话重新画一张，而不是把它拿去问对话模型
    if (messages[index].aiMetadata?.direct_image) {
      await generateImageDirect(previousUser.content, { draw: true, mode: 'new', form: null });
      return;
    }
    await runAiTurn(previousUser.content, { restoreInputOnError: false });
  };

  /** 「新建对话」：强制开新线程，不复用 ensureAiThread 里那条既有的。 */
  const startNewAiThread = async () => {
    if (!noteId || !concreteAiSelection || sending) return;
    setRecentThreadsOpen(false);
    // 面板上本来就是空白的（新笔记、刚开的新对话）：不用再开，把光标放进输入框就是了。
    // 看面板里有没有消息，不看 selectedThread.preview：那是建线程时的值，问过话以后不会更新
    if (messages.length === 0 && !threadLoading) {
      aiInputRef.current?.focus();
      return;
    }
    const live = captureAiSession();
    try {
      // force_new：要一段新的，不是同一个模型下的旧线程（以前每次都回到旧线程，历史里永远只有一条）
      const { conversation } = await noteConversations.create(noteId, {
        target_type: 'ai',
        provider_id: concreteAiSelection.providerId,
        model: concreteAiSelection.model,
        title: `GenAI · ${title || initialData?.title || 'Note'}`,
        force_new: true,
      });
      if (!live()) return;
      // 新建的是空白对话；后端手头有空白的就直接回它，本地也当空白看
      const blank = { ...conversation, preview: null };
      setThreads(prev => withThreadFirst(prev, blank));
      setSelectedThread(blank);
      setMessages([]);
      setAiError(null);
      aiInputRef.current?.focus();
    } catch (error) {
      if (live()) setAiError(error instanceof Error ? error.message : 'Failed to create conversation');
    }
  };

  /** 点历史对话里的一段：切过去看。回答途中不切（这一轮的内容还在往面板里写） */
  const openHistoryThread = (thread: NoteConversationThread) => {
    if (sending) return;
    setRecentThreadsOpen(false);
    setConfirmDeleteId(null);
    if (thread.id === selectedThread?.id) return;
    setAiError(null);
    setSelectedThread(thread);
  };

  /**
   * 删掉自己的一段历史对话。后端只打标记，行和消息还留给研究导出；这里从列表里拿掉。
   * 删的是眼前这一段就接着显示剩下的最近一段，没有了就回到空白。
   */
  const deleteAiThread = async (thread: NoteConversationThread) => {
    if (sending) return;
    const live = captureAiSession();
    setConfirmDeleteId(null);
    try {
      await noteConversations.remove(thread.id);
    } catch (error) {
      // 404 = 已经不在了（在别处删过），当作删成功
      if (!(error instanceof ApiClientError && error.status === 404)) {
        if (live()) setAiError(error instanceof Error ? error.message : 'Failed to delete the conversation');
        return;
      }
    }
    if (!live()) return;
    deletedThreadIdsRef.current.add(thread.id);
    const remaining = threads.filter(item => item.id !== thread.id);
    setThreads(remaining);
    if (selectedThread?.id === thread.id) {
      setSelectedThread(nextThreadAfterDelete(threads, thread.id, { noteId, deletedIds: deletedThreadIdsRef.current }));
    }
  };

  /**
   * 把学生写的问题改得更具体。只重写问题本身，绝不回答——
   * 直接给答案就把思考替学生做了，违背知识建构里学生保有认知主体性的要求。
   */
  const refinePrompt = async () => {
    const draft = aiInput.trim();
    const course = resolvedCourseIdRef.current || courseId || '';
    // 改写一个问题是小活，不该用推理模型：deepseek-v4-pro 实测 25 秒，flash 档一两秒就够。
    // 模型由课程 AI 设置里「优化提问」那一行定（没指定时先 DeepSeek Flash），后端按 'auto' 解析。
    if (!draft || refiningPrompt || !concreteAiSelection || !course) return;
    const live = captureAiSession();
    setRefiningPrompt(true);
    setAiError(null);
    try {
      const { reply } = await aiApi.chat({
        course_id: course,
        provider_id: 'auto',
        model: 'auto',
        feature: 'prompt_refine',
        // 只理顺表达，不替学生把问题「做大」。之前让它补情境、补证据标准、
        // 补「什么算好答案」，结果一句口语被撑成一整段——那已经不是学生的问题了。
        system_prompt: [
          'You tidy up a learner\'s draft question so a model can answer it well.',
          'Rewrite it into clear, well-organised phrasing. Keep the learner\'s own words, scope and voice.',
          'Do NOT add new conditions, examples, criteria, or sub-questions. Do NOT make it longer than it needs to be — a one-line question should stay roughly one line.',
          'Only make the intent explicit when the original is genuinely ambiguous.',
          'NEVER answer the question. Reply in the same language as the input.',
          'Output only the rewritten question. No preamble, no quotes, no explanation, no emoji.',
        ].join('\n'),
        messages: [{ role: 'user', content: draft }],
      });
      if (!live()) return;
      const refined = reply.trim();
      if (refined && refined !== draft) {
        setPromptBeforeRefine(draft);
        setAiInput(refined);
        aiInputRef.current?.focus();
      }
    } catch (error) {
      if (live()) setAiError(error instanceof Error ? error.message : 'Failed to refine the question');
    } finally {
      if (live()) setRefiningPrompt(false);
    }
  };

  const undoRefinePrompt = () => {
    if (promptBeforeRefine === null) return;
    setAiInput(promptBeforeRefine);
    setPromptBeforeRefine(null);
    aiInputRef.current?.focus();
  };

  /**
   * 给 AI 传图。走 uploadSpaceAttachment 拿一个稳定公开链接，
   * 而不是把 base64 塞进消息体——一张 1024×1024 的图 base64 化有 1.5MB 左右，
   * 每一轮对话都会把它重发一遍。
   */
  /**
   * 把画布画成一张图交给 AI 看。不是像素截图——重画成带标题的方框 + 按关系
   * 着色的连线，因为缩放后的界面截图里标题会糊，而标题是模型唯一能抓住的语义。
   */
  /**
   * 生图入口。功能本来就有（generate_image 挂在每个具体模式上），但学生得自己
   * 想到打字「画一张图」才用得到，等于隐形。这里只做两件事：把模式切到带工具的
   * 那档（「自由提问」不装载工具），再把提示词填进输入框——不直接发，
   * 让学生自己改成想画的东西。
   */
  /**
   * 直接生图，不经智能体。走智能体那条整轮 41s，其中生图只占 6.5s，
   * 其余全是 ReAct 循环里模型自己的推理——学生已经说清楚要画什么了，
   * 那些推理是白花的时间。仍然写进对话记录，研究数据不因走快路而缺一条。
   */
  const generateImageDirect = async (promptOverride?: string, decided?: DrawChoice) => {
    const prompt = (promptOverride ?? aiInput).trim();
    if (!prompt) {
      setAiInput(lang === 'zh'
        ? '请为我这条笔记的核心观点画一张示意图，帮助同学更快看懂。'
        : 'Draw a diagram of the core idea in my note so classmates can grasp it faster.');
      aiInputRef.current?.focus();
      return;
    }
    if (sending || !concreteAiSelection) return;
    const live = captureAiSession();
    beginAiTurn();
    setAiError(null);
    // 按「画图」按钮进来的：一定画，先问一下是改上一张还是新画、画成哪种
    const choice = decided ?? await chooseDrawing(prompt, { previous: previousDrawingFrom(messages), lastReply: lastReplyFrom(messages), forced: true });
    if (!live()) return;
    setDrawing({ prompt, startedAt: Date.now(), mode: choice.mode });
    const tempUserId = `local-user-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempUserId,
      threadId: selectedThread?.id ?? '',
      senderKind: 'user',
      senderId: userId,
      content: prompt,
      attachments: [],
      aiMetadata: {},
      createdAt: new Date().toISOString(),
    } as NoteConversationMessage]);
    setAiInput('');
    try {
      const thread = await ensureAiThread();
      if (live()) rememberQuestion(thread.id, prompt);
      const { userMessage, assistantMessage } = await noteConversations.generateImage(thread.id, {
        prompt, mode: choice.mode, form: choice.form, ...(choice.route ? { route: choice.route } : {}),
      });
      if (!live()) return;
      // 新线程的历史可能已经把这两条带回来了，按 id 去掉再接上
      setMessages(prev => [
        ...prev.filter(message => message.id !== tempUserId
          && message.id !== userMessage.id && message.id !== assistantMessage.id),
        userMessage,
        assistantMessage,
      ]);
    } catch (error) {
      if (!live()) return;
      setMessages(prev => prev.filter(message => message.id !== tempUserId));
      setAiInput(prompt);
      setAiError(error instanceof Error ? error.message : 'Failed to generate the image');
    } finally {
      if (live()) {
        setDrawing(null);
        endAiTurn();
      }
    }
  };

  const sendCanvasToAi = async () => {
    if (!spaceId || uploadingAttachment) return;
    const dataUrl = renderCanvasSnapshot({
      notes: allNotes,
      edges: allEdges,
      currentNoteId: noteId ?? null,
      lang,
    });
    if (!dataUrl) {
      setAiError(lang === 'zh' ? '画布上还没有笔记，没什么可看的。' : 'The canvas has no notes yet.');
      return;
    }
    const live = captureAiSession();
    setUploadingAttachment(true);
    setAiError(null);
    try {
      const { attachment } = await notesApi.uploadSpaceAttachment(spaceId, {
        file_name: `canvas-${Date.now()}.png`,
        mime_type: 'image/png',
        data_url: dataUrl,
      });
      if (!live()) return;
      setAiAttachments(prev => [...prev, {
        file_url: attachment.file_url,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
      }].slice(-4));
    } catch (error) {
      if (live()) setAiError(error instanceof Error ? error.message : 'Failed to capture the canvas');
    } finally {
      if (live()) setUploadingAttachment(false);
    }
  };

  const handleAiImagePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !spaceId) return;
    if (file.size > 8 * 1024 * 1024) {
      setAiError(lang === 'zh' ? '文件超过 8MB，请压缩后再传。' : 'File is larger than 8MB.');
      return;
    }
    if (/^(image\/svg|text\/html)/i.test(file.type)) {
      setAiError(lang === 'zh' ? '出于安全考虑不支持 SVG / HTML。' : 'SVG and HTML are not supported.');
      return;
    }
    const live = captureAiSession();
    setUploadingAttachment(true);
    setAiError(null);
    try {
      // 直传存储，字节不经过 API。extract_text 让服务端顺手抽正文：
      // PDF / Word 的解析在那边（浏览器里做不了），纯文本也一并交给它，
      // 前后端各写一套判断迟早会不一致。
      const uploaded = await uploadAttachment(spaceId, file, {
        extractText: !file.type.startsWith('image/'),
      });
      if (!live()) return;
      setAiAttachments(prev => [...prev, {
        file_url: uploaded.file_url,
        file_name: uploaded.file_name,
        mime_type: uploaded.mime_type,
        text: uploaded.text ?? undefined,
        truncated: false,
      }].slice(-4));
    } catch (error) {
      if (live()) setAiError(error instanceof Error ? error.message : 'Failed to upload the file');
    } finally {
      if (live()) setUploadingAttachment(false);
    }
  };

  const addKeyword = (raw: string) => {
    const value = raw.trim().replace(/[,，]+$/, '').trim();
    if (!value) return;
    // 大小写不同但拼写相同的算同一个，避免「协作学习 / 协作学习 」这种重复
    if (keywords.some(item => item.toLowerCase() === value.toLowerCase())) {
      setKeywordDraft('');
      return;
    }
    setKeywords(prev => [...prev, value]);
    setKeywordDraft('');
  };

  const removeKeyword = (value: string) => setKeywords(prev => prev.filter(item => item !== value));


  const updateFeedbackStatus = async (
    feedback: NoteAIFeedback,
    status: NoteAIFeedbackStatus,
    responseText?: string,
    rejection?: { tag: string; reason?: string },
  ) => {
    if (!noteId || feedback.userId !== userId) {
      closeAiInsertDialog();
      return;
    }
    setFeedbackError(null);
    const live = captureAiSession();
    try {
      const { feedback: updated } = await noteAiFeedback.respond(noteId, feedback.id, {
        status, response_text: responseText,
        rejection_tag: rejection?.tag, rejection_reason: rejection?.reason,
      });
      if (live()) setFeedbacks(prev => prev.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      if (live()) setFeedbackError(lang === 'zh' ? '反馈状态未保存，请刷新反馈后重试。' : 'Feedback status could not be saved. Refresh feedback and retry.');
    }
  };

  const insertAiTextToNote = (params: PendingAiInsert) => {
    if (!params.text.trim()) return;
    setPendingAiInsert(params);
    setAiSelectionMenu(null);
    setAiInsertReason('');
    setAiInsertTag('');
    setAiInsertPlan('');
    setAiInsertError('');
  };

  const makeAiPublishDraftTitle = (text: string) => {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    return compact.length > 42 ? `${compact.slice(0, 42)}...` : compact;
  };

  const publishAiSelectionAsNote = (params: PendingAiPublish) => {
    const selectedText = params.text.trim();
    if (!selectedText) return;
    setPendingAiPublish(params);
    setAiSelectionMenu(null);
    setAiPublishTitle(makeAiPublishDraftTitle(selectedText));
    setAiPublishReason('');
    setAiPublishRelationType('extend');
    setAiPublishError('');
    setAiPublishing(false);
  };

  const getAssistantSelection = (message: NoteConversationMessage): AiSelectionMenu | null => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (!selection || !selectedText || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return {
      text: selectedText,
      messageId: message.id.startsWith('stream-') ? undefined : message.id,
      providerId: String(message.aiMetadata?.provider_id ?? concreteAiSelection?.providerId ?? selectedProviderId),
      model: String(message.aiMetadata?.model ?? concreteAiSelection?.model ?? selectedModel),
      x: Math.min(window.innerWidth - 180, Math.max(180, rect.left + rect.width / 2)),
      y: Math.max(80, rect.top - 46),
    };
  };

  const handleAssistantSelection = (message: NoteConversationMessage) => {
    window.setTimeout(() => {
      setAiSelectionMenu(getAssistantSelection(message));
    }, 0);
  };

  const addAiSelectionToChat = () => {
    if (!aiSelectionMenu?.text.trim()) return;
    setAiInput(prev => {
      const prefix = prev.trim() ? `${prev.trim()}\n\n` : '';
      return `${prefix}${aiSelectionMenu.text.trim()}`;
    });
    setAiSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    window.setTimeout(() => aiInputRef.current?.focus(), 0);
  };

  const closeAiInsertDialog = () => {
    setPendingAiInsert(null);
    setAiInsertScaffold(null);
    setAiInsertReason('');
    setAiInsertTag('');
    setAiInsertPlan('');
    setAiInsertError('');
  };

  const closeAiPublishDialog = () => {
    if (aiPublishing) return;
    setPendingAiPublish(null);
    setAiPublishScaffold(null);
    setAiPublishTitle('');
    setAiPublishReason('');
    setAiPublishRelationType('extend');
    setAiPublishError('');
  };

  const confirmAiTextInsert = async () => {
    if (!pendingAiInsert) return;
    const selectedText = pendingAiInsert.text.trim();
    if (!selectedText) return;
    const acceptanceReason = aiInsertReason.trim();
    // 采纳理由不再要求写句子：选一个 GenAI 支架（它本身说明了以什么方式采纳，
    // 并会作为话头进入正文），课程没配支架时选一个标签。自由文本是可选补充。
    if (genAiScaffolds.length > 0 && !aiInsertScaffold) {
      setAiInsertError(t.aiScaffoldRequired);
      return;
    }
    if (genAiScaffolds.length === 0 && !aiInsertTag) {
      setAiInsertError(lang === 'zh' ? '请选择这段内容对你的帮助' : 'Please pick how this helps you');
      return;
    }
    const studentRevisionPlan = aiInsertPlan.trim();
    const providerId = pendingAiInsert.providerId ?? concreteAiSelection?.providerId ?? selectedProviderId;
    const model = pendingAiInsert.model ?? concreteAiSelection?.model ?? selectedModel;
    const providerLabel = PROVIDER_LABELS[providerId] ?? (providerId || 'AI');
    // 支架标记「话头[内容]」：方括号里是学生带进来的那段，括号外是课堂给的话头
    const scaffoldOpen = aiInsertScaffold
      ? `<div data-scaffold-id="${escapeHtml(aiInsertScaffold.id)}" data-scaffold-l1="${escapeHtml(aiInsertScaffold.metadata?.l1 ?? 'GAI')}" data-scaffold-title="${escapeHtml(scaffoldLabel(aiInsertScaffold, lang))}" style="margin-bottom:6px;font-size:13px;color:#1e293b;"><strong data-scaffold-tag>${escapeHtml(scaffoldLabel(aiInsertScaffold, lang))}</strong><span data-scaffold-slot>[</span></div>`
      : '';
    const scaffoldClose = aiInsertScaffold
      ? '<div data-scaffold-slot style="font-size:13px;color:#1e293b;">]</div>'
      : '';
    const html = `<div data-ai-source="genai" data-scaffold-adopted="${escapeHtml(aiInsertScaffold?.id ?? '')}" data-source-message-id="${escapeHtml(pendingAiInsert.sourceMessageId ?? '')}" data-feedback-id="${escapeHtml(pendingAiInsert.feedbackId ?? '')}" data-provider-id="${escapeHtml(providerId)}" data-model="${escapeHtml(model)}" style="margin:10px 0;border:1px solid #cbd5e1;border-left:4px solid #22577a;background:#f8fafc;color:#1e293b;padding:10px 12px;border-radius:8px;"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#475569;"><span style="display:inline-flex;height:18px;align-items:center;border-radius:999px;background:#dbeafe;color:#1e3a8a;padding:0 8px;">${t.aiSource}</span><span>${escapeHtml(providerLabel)} · ${escapeHtml(model || 'model')}</span></div>${scaffoldOpen}<div style="font-size:14px;line-height:1.75;">${renderMarkdownToHtml(selectedText)}</div>${scaffoldClose}<div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:12px;line-height:1.6;color:#475569;">${acceptanceReason ? `<strong style="color:#334155;">${escapeHtml(t.insertAiReason)}:</strong> ${escapeHtml(acceptanceReason)}` : ''}${studentRevisionPlan ? `<br><strong style="color:#334155;">${escapeHtml(t.insertAiPlan)}:</strong> ${escapeHtml(studentRevisionPlan)}` : ''}</div></div><p><br></p>`;
    insertHtmlAtCursor(html);
    if (!noteId) {
      closeAiInsertDialog();
      return;
    }
    try {
      await noteAiFeedback.recordInsertion(noteId, {
        source_message_id: pendingAiInsert.sourceMessageId,
        feedback_id: pendingAiInsert.feedbackId,
        provider_id: providerId,
        model,
        selected_text: selectedText,
        inserted_html: html,
        acceptance_reason: acceptanceReason,
        student_revision_plan: studentRevisionPlan || undefined,
        scaffold_id: aiInsertScaffold?.id,
        reason_tag: aiInsertTag || undefined,
        insertion_anchor: { word_count: wordCount },
      });
      if (pendingAiInsert.feedbackId) {
        setFeedbacks(prev => prev.map(item => item.id === pendingAiInsert.feedbackId ? { ...item, status: 'inserted', respondedAt: new Date().toISOString() } : item));
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Failed to record AI insertion');
    }
    closeAiInsertDialog();
  };

  const confirmAiSelectionPublish = async () => {
    if (!pendingAiPublish || !noteId) return;
    const selectedText = pendingAiPublish.text.trim();
    const publicationTitle = aiPublishTitle.trim();
    const adoptionReason = aiPublishReason.trim();
    if (!selectedText || !publicationTitle || !adoptionReason) {
      setAiPublishError(t.publishAiRequired);
      return;
    }
    if (genAiScaffolds.length > 0 && !aiPublishScaffold) {
      setAiPublishError(t.aiScaffoldRequired);
      return;
    }
    setAiPublishing(true);
    setAiPublishError('');
    try {
      const { note, relation } = await notesApi.publishAiSelection(noteId, {
        title: publicationTitle,
        selected_text: selectedText,
        adoption_reason: adoptionReason,
        relation_type: aiPublishRelationType,
        source_conversation_id: pendingAiPublish.sourceConversationId,
        source_message_id: pendingAiPublish.sourceMessageId,
        provider_id: pendingAiPublish.providerId,
        model: pendingAiPublish.model,
        persona_id: selectedAgentMode || undefined,
        view_id: currentViewId,
        scaffold_id: aiPublishScaffold?.id,
      });
      onAiNotePublished?.(note, relation);
      window.getSelection()?.removeAllRanges();
      setPendingAiPublish(null);
      setAiPublishTitle('');
      setAiPublishReason('');
      setAiPublishRelationType('extend');
    } catch (error) {
      setAiPublishError(error instanceof Error ? error.message : t.publishAiFailed);
    } finally {
      setAiPublishing(false);
    }
  };

  const save = () => {
    // 去掉支架空槽里的零宽占位符，导出的正文里不留不可见字符
    const content = stripScaffoldPlaceholders(editorRef.current?.innerHTML || '');
    // 教师开了「强制使用支架」：没有支架的普通笔记不放行。只在前端拦——
    // 开课教师和课程管理员要能写不带支架的示范笔记：后端按课内身份算出 scaffoldExempt，
    // Workspace 传进来的 requireScaffold 已经扣掉了它。综合升华笔记也不算，它的话头是引用。
    if (requireScaffold && !isRiseAbove && extractScaffoldIds(content).length === 0) {
      setSaveBlocked(lang === 'zh'
        ? '这门课要求每条笔记至少使用一条支架。请在左侧「支架」里选一条，把你的话写进方括号。'
        : 'This course requires at least one scaffold per note. Pick one on the left and write inside the brackets.');
      return;
    }
    setSaveBlocked(null);
    if (spaceId) {
      trackEvent({
        event_type: 'note_editor_saved',
        object_type: 'note_editor',
        object_id: noteId ?? `editor-${Date.now()}`,
        space_id: spaceId,
        metadata_json: { style: 'kf_classic', word_count: wordCount },
      });
    }
    onSave(title.trim() || (lang === 'zh' ? '未命名笔记' : 'Untitled Note'), content, keywords);
  };

  const move = buildOnMoveType ? BUILD_ON_META[buildOnMoveType] : undefined;
  // 编辑区一直挂着，阅读、信息页签读它眼下的内容（含没保存的修改）。不能用 || 回落：正文删光时 innerHTML 是空串，
  // 一回落就又显示打开时的旧正文。只有编辑区挂上之前的那一帧用打开时的正文
  const renderedContent = editorRef.current ? editorRef.current.innerHTML : (initialData?.content ?? '');
  const currentNote = noteId ? allNotes.find(note => note.id === noteId) : null;
  // 别人的笔记：学生只能读（后端只让作者和本课教职改），右下角换成 Build-on。
  // 刚落库的草稿可能还没进 allNotes，找不到作者时按自己的算。
  const staffLike = isStaff ?? (userRole === 'teacher' || userRole === 'admin');
  const isOthersNote = Boolean(noteId && currentNote?.authorId && userId && currentNote.authorId !== userId);
  const readOnlyNote = isOthersNote && !staffLike;
  // 原笔记：新建的 Build-on 用画布传进来的那条；已有的笔记按连线找它 Build-on 的那一条
  const parentEdge = !buildOnParentId && noteId
    ? allEdges.find(edge => edge.source === noteId && edge.target !== noteId)
    : undefined;
  const parentNoteId = buildOnParentId ?? parentEdge?.target;
  const parentNote = parentNoteId ? allNotes.find(note => note.id === parentNoteId) : undefined;
  const parentMove = BUILD_ON_META[(buildOnParentId ? buildOnMoveType : parentEdge?.relationType) ?? ''];
  const showParentPanel = parentPanelOpen && Boolean(parentNote) && !aiOpen;
  const aiUptakeCount = (renderedContent.match(/data-ai-source="genai"/g) ?? []).length;
  const received = connections.filter(connection => connection.target_note_id === noteId);
  const sent = connections.filter(connection => connection.source_note_id === noteId);

  const renderConnection = (connection: ApiRelation, direction: 'in' | 'out') => {
    const otherId = direction === 'in' ? connection.source_note_id : connection.target_note_id;
    const otherNote = noteMap.get(otherId);
    const meta = BUILD_ON_META[connection.relation_type] ?? BUILD_ON_META.extend;
    return (
      <div key={connection.id} className="flex items-start gap-3 border-b border-slate-200 py-2 last:border-b-0">
        <span className="mt-0.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-800 truncate">{otherNote?.title ?? otherId}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {lang === 'zh' ? meta.labelZh : meta.label}
            <span className="px-1.5 text-slate-300">{direction === 'in' ? '<' : '>'}</span>
            {otherNote?.author ?? ''}
          </div>
        </div>
      </div>
    );
  };

  /**
   * 不采纳的归类。点一下即完成 —— 强制写句子在插入那条路径上已经产生了近四成
   * 「没有」「没有理由」式的应付，标签既省事又更好编码。
   */
  /** 课程没配 GenAI 支架时的采纳归类；配了支架就以支架为准，不重复问 */
  const INSERT_TAGS = [
    { key: 'new_angle', zh: '给了我没想到的角度', en: 'A new angle' },
    { key: 'clearer', zh: '帮我说得更清楚', en: 'Says it more clearly' },
    { key: 'evidence', zh: '提供了证据或例子', en: 'Evidence or example' },
    { key: 'to_verify', zh: '先放着，待我查证', en: 'Keep for now, verify later' },
  ];

  const REJECT_TAGS = [
    { key: 'misread', zh: '误解了我的意思', en: 'Misread my point' },
    { key: 'already_considered', zh: '我已经考虑过了', en: 'Already considered' },
    { key: 'off_track', zh: '和我的探究无关', en: 'Not my focus' },
    { key: 'disagree', zh: '我不认同这个判断', en: 'I disagree' },
  ];

  const TRIGGER_LABEL = TRIGGER_TYPE_LABEL;

  const renderFeedback = (feedback: NoteAIFeedback) => {
    const handled = feedback.status !== 'new';
    const canRespond = feedback.userId === userId;
    const label = TRIGGER_LABEL[feedback.triggerType];
    const isRejecting = rejectingId === feedback.id;

    const submitRejection = async (tag: string) => {
      setRejectError('');
      await updateFeedbackStatus(feedback, 'rejected', undefined, {
        tag, reason: rejectReason.trim() || undefined,
      });
      setRejectingId(null);
      setRejectTag('');
      setRejectReason('');
    };

    return (
      <article
        key={feedback.id}
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 rounded-xl border border-[#000080]/15 bg-[#000080]/[0.035] p-3.5 dark:border-[#93AAFD]/20 dark:bg-[#93AAFD]/[0.06]"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold text-[#000080] dark:text-[#93AAFD]">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {label ? (lang === 'zh' ? label.zh : label.en) : feedback.triggerType.replace(/_/g, ' ')}
          </span>
          <span className="text-[0.6875rem] text-gray-400 dark:text-gray-500">{formatTime(feedback.createdAt, lang)}</span>
          {handled && (
            <span className="ml-auto text-[0.6875rem] font-medium text-gray-500 dark:text-gray-400">
              {feedback.status === 'accepted' ? (lang === 'zh' ? '已采纳' : 'Accepted')
                : feedback.status === 'rejected' ? (lang === 'zh' ? '已表示不同意' : 'Disagreed')
                : feedback.status === 'followed_up' ? (lang === 'zh' ? '已追问' : 'Followed up')
                : (lang === 'zh' ? '未处理' : 'Not used')}
            </span>
          )}
          <button type="button" onClick={() => void dismissFeedback(feedback)} aria-label={lang === 'zh' ? '收起' : 'Dismiss'} title={lang === 'zh' ? '收起反馈' : 'Close feedback'} className="ml-auto rounded-md p-1 text-gray-400 transition-colors hover:bg-white/70 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={14} />
          </button>
        </div>

        <p className="text-sm leading-6 text-gray-800 dark:text-gray-100">{feedback.feedbackText}</p>

        {feedback.status === 'accepted' && !feedback.publishedNoteId && (
          <p className="mt-2 text-[0.6875rem] leading-5 text-gray-500 dark:text-gray-400">
            {feedback.publicationReview?.state === 'addressed'
              ? (lang === 'zh' ? '已在原 Note 中回应，无需另建笔记。' : 'Addressed in this Note; no additional note needed.')
              : (lang === 'zh' ? '可先在原 Note 中回应；贡献时再判断是否需要关联笔记。' : 'Develop your response in this Note. Publication is reviewed when you contribute.')}
          </p>
        )}
        {feedback.publishedNoteId && (
          <p className="mt-2 flex items-center gap-1.5 text-[0.6875rem] font-medium text-gray-600 dark:text-gray-300">
            <MessageCircle size={12} />
            {lang === 'zh' ? '已生成一条可继续对话的笔记' : 'A note you can keep talking in was created'}
          </p>
        )}

        {isRejecting ? (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
              {lang === 'zh' ? '哪一点不合适？点一下就好' : 'What did not fit? One tap is enough'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {REJECT_TAGS.map(tagDef => (
                <button
                  key={tagDef.key}
                  type="button"
                  onClick={() => void submitRejection(tagDef.key)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-[#000080]/40 hover:bg-[#000080]/5 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-[#93AAFD]/40 dark:hover:bg-[#93AAFD]/10"
                >
                  {lang === 'zh' ? tagDef.zh : tagDef.en}
                </button>
              ))}
            </div>
            <details className="mt-2 group">
              <summary className="cursor-pointer text-[0.6875rem] text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                {lang === 'zh' ? '想多说两句（可不填）' : 'Add a note (optional)'}
              </summary>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={2}
                placeholder={lang === 'zh' ? '例如：它误解了我说的「变懒」，我指的是……' : 'e.g. It misread what I meant by…'}
                className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-[#000080] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-[#93AAFD]"
              />
            </details>
            {rejectError && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{rejectError}</p>}
            <button type="button" onClick={() => { setRejectingId(null); setRejectTag(''); setRejectReason(''); setRejectError(''); }} className="mt-2 text-[0.6875rem] text-gray-500 underline underline-offset-2 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              {lang === 'zh' ? '取消' : 'Cancel'}
            </button>
          </div>
        ) : !handled && canRespond && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void updateFeedbackStatus(feedback, 'accepted')} className="inline-flex items-center gap-1 rounded-md bg-[#000080] px-2.5 py-1 text-xs font-semibold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.97]">
              <Check size={13} />{t.accept}
            </button>
            <button type="button" onClick={() => { setRejectingId(feedback.id); setRejectReason(''); setRejectError(''); }} className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
              {lang === 'zh' ? '不同意' : 'Disagree'}
            </button>
            <button type="button" onClick={() => { setAiInput(feedback.feedbackText); setAiOpen(true); void updateFeedbackStatus(feedback, 'followed_up', feedback.feedbackText); }} className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
              <MessageCircle size={13} />{t.followUp}
            </button>

          </div>
        )}

        {feedback.status === 'rejected' && (feedback.rejectionTag || feedback.rejectionReason) && (
          <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs leading-5 text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
            {lang === 'zh' ? '你选了：' : 'You chose: '}
            {REJECT_TAGS.find(x => x.key === feedback.rejectionTag)
              ? (lang === 'zh' ? REJECT_TAGS.find(x => x.key === feedback.rejectionTag)!.zh : REJECT_TAGS.find(x => x.key === feedback.rejectionTag)!.en)
              : feedback.rejectionTag}
            {feedback.rejectionReason ? `　${feedback.rejectionReason}` : ''}
          </p>
        )}
      </article>
    );
  };

  const renderTeacherFeedbackSection = () => {
    if (!teacherFeedbacks.length) return null;
    const unreadCount = teacherFeedbacks.filter(feedback => feedback.isRead === false).length;
    const latestFeedback = teacherFeedbacks[0];

    return (
      <section className="border-t border-gray-200 dark:border-gray-800 bg-blue-50/40 dark:bg-blue-950/20">
        <button
          type="button"
          onClick={() => setTeacherFeedbackExpanded(value => !value)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-blue-50/60 dark:hover:bg-blue-950/30"
          aria-expanded={teacherFeedbackExpanded}
        >
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 text-[#000080] dark:text-blue-300">
            {teacherFeedbackExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-900 dark:text-gray-100">
              <MessageCircle size={15} className="text-[#000080] dark:text-blue-300" />
              {t.teacherFeedback}
              <span className="rounded-md bg-white dark:bg-gray-800 px-2 py-0.5 text-[0.6875rem] font-semibold text-gray-500">
                {teacherFeedbacks.length} {t.teacherFeedbackCount}
              </span>
              {unreadCount > 0 && (
                <span className="rounded-md bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-700 dark:text-amber-300">
                  {unreadCount} {t.teacherFeedbackUnread}
                </span>
              )}
            </span>
            <span className="mt-1 block truncate text-xs leading-5 text-gray-500">
              {teacherFeedbackExpanded ? t.teacherFeedbackHint : (latestFeedback?.studentSummary || t.teacherFeedbackCollapsedHint)}
            </span>
          </span>
          <span className="mt-0.5 shrink-0 text-[0.6875rem] font-bold text-[#000080] dark:text-blue-300">
            {teacherFeedbackExpanded ? t.collapseFeedback : t.expandFeedback}
          </span>
        </button>
        {teacherFeedbackExpanded && (
          <div className="space-y-2 px-4 pb-4">
          {teacherFeedbacks.map(feedback => (
            <article key={feedback.id} className="rounded-sm border border-[#b9c7f5] bg-white p-3 text-sm text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.6875rem] font-semibold text-slate-500">
                <span className="rounded-sm bg-[#e8edff] px-2 py-0.5 text-[#243f9c]">AI + {t.teacherFeedbackFrom} {feedback.publishedBy ?? (lang === 'zh' ? '教师' : 'Teacher')}</span>
                {(feedback.publishedAt || feedback.createdAt) && <span>{formatTime(feedback.publishedAt ?? feedback.createdAt, lang)}</span>}
                {feedback.isRead === false && <span className="rounded-sm bg-[#fff4d6] px-2 py-0.5 text-[#8a5a00]">{t.teacherFeedbackUnread}</span>}
              </div>
              <div className="space-y-2">
                <div>
                  <div className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wide text-slate-400">{t.teacherFeedbackSummary}</div>
                  <p className="leading-6">{feedback.studentSummary}</p>
                </div>
                {feedback.teacherNote && (
                  <div className="border-t border-slate-100 pt-2">
                    <div className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wide text-slate-400">{t.teacherFeedbackNote}</div>
                    <p className="leading-6 text-slate-700">{feedback.teacherNote}</p>
                  </div>
                )}
              </div>
            </article>
          ))}
          </div>
        )}
      </section>
    );
  };

  const startSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: aiPanelWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = splitResizeRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setAiPanelWidth(resizeNoteAiPanelWidth({
      startWidth: state.startWidth,
      startX: state.startX,
      currentX: event.clientX,
      viewportWidth: window.innerWidth,
    }));
  };

  const endSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (splitResizeRef.current?.pointerId !== event.pointerId) return;
    splitResizeRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resetSplitResize = () => {
    setAiPanelWidth(clampNoteAiPanelWidth(NOTE_AI_SPLIT_LAYOUT.defaultAiWidth, window.innerWidth));
  };

  const handleSplitResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 24;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setAiPanelWidth(width => clampNoteAiPanelWidth(width - step, window.innerWidth));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setAiPanelWidth(width => clampNoteAiPanelWidth(width + step, window.innerWidth));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      resetSplitResize();
    }
  };

  const setPartnerAgentMode = (nextMode: PartnerAgentModeSelection) => {
    const normalizedMode = nextMode ? normalizePartnerAgentMode(nextMode) : '';
    setSelectedAgentMode(normalizedMode);
    setWebSearchEnabled(normalizedMode === 'evidence_broker');
  };

  const agentModeIcon = (modeId: PartnerAgentModeSelection) => {
    if (modeId === 'gap_finder') return <AlertCircle size={12} />;
    if (modeId === 'evidence_broker') return <BookOpen size={12} />;
    if (modeId === 'connection_scout') return <Users size={12} />;
    if (modeId === 'rise_above_coach') return <Sparkles size={12} />;
    if (modeId === 'idea_coach') return <MessageCircle size={12} />;
    return <MessageCircle size={12} />;
  };

  // 不能用 useMemo：这里在 `if (!isOpen) return null` 之后，加 hook 会让
  // 两次渲染的 hook 数量对不上（React #310）。小数组算一遍就好。
  // 「默认」排在真实选项的第一个（教师定的，见 buildPartnerModelOptions 的 preferred）
  const defaultPartnerOption = partnerModelOptions.find(option => option.providerId !== 'auto');
  const selectedPartnerTitle = selectedProviderId === 'auto'
    ? (defaultPartnerOption ? partnerModelTitle(defaultPartnerOption.providerId, defaultPartnerOption.model, lang) : undefined)
    : partnerModelTitle(selectedProviderId, selectedModel, lang);

  const agentModeOptions: Array<{ id: PartnerAgentModeSelection; label: string; description: string; disabled: boolean }> = [
    { id: '', label: t.noAgentMode, description: t.modeHint, disabled: false },
    ...agentModes.map(mode => ({
      id: mode.id,
      label: mode.label,
      description: mode.description,
      disabled: mode.id === 'evidence_broker' && !hasTavilyConfig,
    })),
  ];

  const historyThreads = visibleHistoryThreads(threads, {
    noteId,
    selectedId: selectedThread?.id ?? null,
    deletedIds: deletedThreadIdsRef.current,
  });
  const aiPanel = (
    <aside data-large-text={largeText} aria-label={t.aiPartner} className="assistant-panel flex h-full min-h-0 flex-col overflow-hidden border-r border-gray-200 dark:border-gray-800">
      {/* 标题、新建、历史、收起放在一行。原来标题、两个按钮、分隔线、「围绕当前 Note 讨论」叠了四层，
          占掉侧栏顶上一百多像素，真正的对话区反而挤在下面。历史列表做成浮在下面的菜单，不再把对话往下顶。 */}
      <div ref={historyMenuRef} className="relative shrink-0 border-b border-gray-100 dark:border-gray-800">
        <div className="assistant-header flex items-center gap-2">
          <span className="assistant-mark" aria-hidden="true"><RemixIcon name="chat-quote-line" size={18} /></span>
          <div className="assistant-header-title">
            <h2 className="truncate" title={t.aroundThisNote}>{t.aiPartner}</h2>
            <p className="truncate">{t.aroundThisNote}</p>
          </div>
          <button
            type="button"
            onClick={() => void startNewAiThread()}
            disabled={!noteId || !concreteAiSelection || sending}
            aria-label={t.newChat}
            title={t.newChat}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <RemixIcon name="chat-new-line" size={16} /><span className="assistant-header-action-label">{t.newChat}</span>
          </button>
          <button
            type="button"
            onClick={() => { setRecentThreadsOpen(value => !value); setConfirmDeleteId(null); }}
            aria-expanded={recentThreadsOpen}
            aria-label={t.chatHistory}
            title={t.chatHistory}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <RemixIcon name="history-line" size={16} /><span className="assistant-header-action-label">{t.chatHistory}{historyThreads.length > 0 && <span className="ml-1 tabular-nums text-gray-500">· {historyThreads.length}</span>}</span>
          </button>
          <button
            type="button"
            onClick={() => setAiOpen(false)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
            aria-label={t.close}
          >
            <ChevronUp size={16} />
          </button>
        </div>

        {recentThreadsOpen && (
          <div data-ai-history className="absolute inset-x-2 top-full z-30 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg shadow-black/10 dark:border-gray-700 dark:bg-gray-900">
            {historyThreads.length === 0 ? (
              <p className="px-4 py-5 text-center text-[0.75rem] leading-5 text-gray-500 dark:text-gray-400">{t.historyEmpty}</p>
            ) : (
              <ul className="max-h-[min(20rem,55vh)] overflow-y-auto overscroll-contain p-1">
                {historyThreads.map(thread => {
                  const active = selectedThread?.id === thread.id;
                  const confirming = confirmDeleteId === thread.id;
                  return (
                    <li key={thread.id}>
                      {confirming ? (
                        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30">
                          <span className="min-w-0 flex-1 text-[0.75rem] font-medium text-red-700 dark:text-red-300">{t.deleteChatAsk}</span>
                          <button
                            type="button"
                            onClick={() => void deleteAiThread(thread)}
                            className="h-8 shrink-0 rounded-md bg-red-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-700 active:scale-[0.98]"
                          >
                            {t.deleteChatConfirm}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="h-8 shrink-0 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                          >
                            {t.deleteChatCancel}
                          </button>
                        </div>
                      ) : (
                        <div className={`flex items-center rounded-lg transition-colors ${
                          active ? 'bg-[#000080]/[0.06] dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                        >
                          <button
                            type="button"
                            onClick={() => openHistoryThread(thread)}
                            disabled={sending}
                            aria-current={active ? 'true' : undefined}
                            className="min-w-0 flex-1 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className={`block truncate text-[0.8125rem] ${
                              active ? 'font-semibold text-[#000080] dark:text-blue-300' : 'font-medium text-gray-800 dark:text-gray-200'
                            }`}
                            >
                              {thread.preview || t.historyUntitled}
                            </span>
                            <span className="block text-[0.6875rem] text-gray-400 dark:text-gray-500">{formatThreadTime(thread.updatedAt, lang)}</span>
                          </button>
                          {thread.createdBy === userId && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(thread.id)}
                              disabled={sending}
                              aria-label={t.deleteChat}
                              title={t.deleteChat}
                              className="mr-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-500 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {sending && historyThreads.length > 0 && (
              <p className="border-t border-gray-100 px-3 py-1.5 text-[0.6875rem] text-gray-400 dark:border-gray-800 dark:text-gray-500">{t.historySwitchWait}</p>
            )}
          </div>
        )}
      </div>

      <AssistantAgentPicker lang={lang === 'zh' ? 'zh' : 'en'} value={selectedAgentMode}
        options={agentModeOptions} onChange={setPartnerAgentMode} disabled={sending} />
      {aiError && (
        <div className="mx-4 mt-3 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />{aiError}
        </div>
      )}

      <div
        data-ai-scroll
        aria-busy={sending}
        onScroll={event => {
          const el = event.currentTarget;
          aiPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
        }}
        className="assistant-conversation min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="flex min-h-full flex-col gap-4">
          {messages.length === 0 && (threadLoading ? (
            <div role="status" className="flex items-center justify-center gap-2.5 py-10 text-[0.75rem] text-gray-500 dark:text-gray-400">
              <AiThinkingDots />{t.openingChat}
            </div>
          ) : (
            <AssistantWelcome scope="note" lang={lang === 'zh' ? 'zh' : 'en'} disabled={!canChatWithAI}
              onChoose={prompt => { setAiInput(prompt); aiInputRef.current?.focus(); }} />
          ))}
          {messages.map((message, index) => {
            const isAssistant = message.senderKind === 'assistant';
            const reasoningStatus = message.aiMetadata?.reasoningStatus ?? message.aiMetadata?.reasoning_status;

            if (!isAssistant) {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="assistant-user-message min-w-0 max-w-[85%] px-3.5 py-2.5 text-[0.8125rem] leading-6">
                    <MarkdownMessage content={message.content} isMine={false} />
                  </div>
                </div>
              );
            }

            const previous = messages[index - 1];
            const startsRun = !previous || previous.senderKind !== message.senderKind;
            const isStreaming = message.id.startsWith('stream-');
            const settled = Boolean(message.content.trim()) && !isStreaming;
            const processSteps = isStreaming
              ? ((message.aiMetadata?.toolSteps as ToolCallInfo[] | undefined) ?? [])
              : stepsFromMetadata(message.aiMetadata);
            // 流式回复的临时消息，字还没出来：显示「正在思考 / 读取 / 组织回答」的动效，不是一个空气泡加小转圈
            const waitingForText = isStreaming && !message.content.trim();
            // 这一轮已经结束（出错中断）却留下的空临时消息：不画，免得动效一直转下去
            if (waitingForText && !sending) return null;

            return (
              <div key={message.id} className="flex items-start gap-2">
                <span
                  className={`mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#000080] dark:text-blue-300 ${
                    startsRun
                      ? 'border border-[#000080]/15 bg-[#000080]/[0.06] dark:border-blue-400/25 dark:bg-blue-950/40'
                      : 'opacity-0'
                  } ${waitingForText ? 'ai-avatar-working' : ''}`}
                  aria-hidden={!startsRun}
                >
                  <RemixIcon name="chat-quote-line" size={13} />
                </span>
                <div
                  className="min-w-0 flex-1"
                  onMouseUp={() => handleAssistantSelection(message)}
                  onKeyUp={() => handleAssistantSelection(message)}
                >
                  <div className="assistant-response px-3.5 py-3 text-[0.8125rem] leading-6">
                    {waitingForText ? (
                      // 还没开始写：一步步显示在做什么（2026-10-05 用户：等的时候别让学生觉得无聊）
                      <AgentProcess
                        steps={processSteps}
                        phase="waiting"
                        startedAt={aiTurnStartedAtRef.current}
                        thinking={reasoningStatus === 'thinking'}
                        lang={lang === 'zh' ? 'zh' : 'en'}
                      />
                    ) : (
                      <>
                        {/* 字一出来，「思考中 / 正在组织回答」的小标签就不用了：流出来的字本身就在说它在写 */}
                        {typeof reasoningStatus === 'string' && !isStreaming && (
                          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300">
                            {reasoningStatus === 'thinking' ? t.thinking : reasoningStatus === 'answering' ? t.answering : t.thoughtDone}
                          </div>
                        )}
                        {/* 用了哪几步：收成一行「用了 3 步 · 6 秒」，点开看每一步。以前写完就没了，现在回看也在 */}
                        <AgentProcess
                          steps={processSteps}
                          phase={isStreaming ? 'writing' : 'done'}
                          elapsedMs={typeof message.aiMetadata?.elapsed_ms === 'number' ? message.aiMetadata.elapsed_ms : undefined}
                          lang={lang === 'zh' ? 'zh' : 'en'}
                        />
                        <MarkdownMessage content={message.content} isMine={false} />
                        <KbSourceCards
                          sources={parseKbSources(message.aiMetadata?.kb_sources)}
                          content={message.content}
                          streaming={isStreaming}
                          lang={lang === 'zh' ? 'zh' : 'en'}
                          onOpen={onOpenKbSource}
                        />
                        {isStreaming && <div className="mt-1.5"><AiThinkingDots /></div>}
                      </>
                    )}
                  </div>
                  {settled && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => void insertAiTextToNote({ text: message.content, sourceMessageId: message.id, providerId: String(message.aiMetadata?.provider_id ?? concreteAiSelection?.providerId ?? selectedProviderId), model: String(message.aiMetadata?.model ?? concreteAiSelection?.model ?? selectedModel) })}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[0.6875rem] font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        <TextCursorInput size={12} />{t.insert}
                      </button>
                      {noteId && (
                        <button
                          type="button"
                          onClick={() => void publishAiSelectionAsNote({ text: message.content, sourceMessageId: message.id, sourceConversationId: selectedThread?.id, providerId: String(message.aiMetadata?.provider_id ?? concreteAiSelection?.providerId ?? selectedProviderId), model: String(message.aiMetadata?.model ?? concreteAiSelection?.model ?? selectedModel) })}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#000080]/20 bg-[#000080]/[0.05] px-2 py-1 text-[0.6875rem] font-semibold text-[#000080] transition-colors hover:bg-[#000080]/10 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/30"
                        >
                          <FileText size={12} />{t.publishAsNote}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {settled && (
                  <div className="mt-1 flex shrink-0 flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => void regenerateAiMessage(message.id)}
                      disabled={sending}
                      className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
                      title={t.regenerateLabel}
                      aria-label={t.regenerateLabel}
                    >
                      <RefreshCw size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {sending && (drawing ? (
            <div className="flex justify-start">
              <DrawingProgress prompt={drawing.prompt} lang={lang} startedAt={drawing.startedAt} mode={drawing.mode} />
            </div>
          ) : (
            // 提问发出去、第一条状态还没回来的那几百毫秒：先放一个「正在思考」，状态一到由上面那条临时消息接手
            !messages.some(message => message.id.startsWith('stream-')) && (
              <div className="flex items-start gap-2">
                <span className="ai-avatar-working mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#000080]/15 bg-[#000080]/[0.06] text-[#000080] dark:border-blue-400/25 dark:bg-blue-950/40 dark:text-blue-300" aria-hidden="true">
                  <RemixIcon name="chat-quote-line" size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="assistant-response px-3.5 py-3">
                    <AiThinking label={t.thinkingLabel} startedAt={aiTurnStartedAtRef.current} lang={lang} />
                  </div>
                </div>
              </div>
            )
          ))}
          <div ref={chatBottomRef} />
        </div>
      </div>

      <div className="assistant-footer border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-gray-800">
        <div ref={composerMenuRef} data-ai-composer className="assistant-composer assistant-composer-refinable relative">
          {aiAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2.5 pt-2.5">
              {aiAttachments.map(attachment => (
                <span key={attachment.file_url} className="group relative">
                  {attachment.mime_type.startsWith('image/') ? (
                    <img
                      src={attachment.file_url}
                      alt={attachment.file_name}
                      className="h-14 w-14 rounded-lg border border-gray-200 object-cover dark:border-gray-600"
                    />
                  ) : (
                    <span
                      className="flex h-14 w-28 flex-col justify-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-2 dark:border-gray-600 dark:bg-gray-800"
                      title={attachment.file_name}
                    >
                      <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-gray-700 dark:text-gray-200">
                        <Paperclip size={11} className="shrink-0" />
                        <span className="truncate">{attachment.file_name}</span>
                      </span>
                      <span className="text-[0.625rem] text-gray-400">
                        {attachment.text ? t.attachmentReadable : t.attachmentNameOnly}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setAiAttachments(prev => prev.filter(a => a.file_url !== attachment.file_url))}
                    className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-900/80 text-white transition-colors hover:bg-gray-900"
                    aria-label={`${t.removeImage}: ${attachment.file_name}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="assistant-input-region relative">
            <div className="assistant-refine-actions">
              <button
                type="button"
                onClick={() => void refinePrompt()}
                disabled={!aiInput.trim() || refiningPrompt || sending || !canChatWithAI}
                className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg border border-[#000080]/20 bg-[#000080]/[0.05] px-2 text-[0.75rem] font-semibold text-[#000080] transition-colors hover:bg-[#000080]/10 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
                title={t.refinePrompt}
              >
                {refiningPrompt ? <Loader2 size={13} className="animate-spin" /> : <RemixIcon name="edit-2-line" size={13} />}
                {refiningPrompt ? t.refining : t.refinePrompt}
              </button>
              {promptBeforeRefine !== null && (
                <button
                  type="button"
                  onClick={undoRefinePrompt}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
                  title={t.undoRefine}
                  aria-label={t.undoRefine}
                >
                  <Undo2 size={15} />
                </button>
              )}
            </div>
          <textarea
            rows={1}
            ref={aiInputRef}
            value={aiInput}
            onChange={event => setAiInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && enterToSend && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void sendAiMessage(); } }}
            aria-label={t.aiPlaceholder}
            placeholder={aiAttachments.length > 0 ? attachmentQuestionHint(aiAttachments, lang === 'zh' ? 'zh' : 'en') : t.aiPlaceholder}
            className="assistant-input w-full resize-none bg-transparent outline-none"
          />

          </div>

          <div className={`assistant-options ${composerMenuOpen ? '' : 'hidden'}`}>
            <p className="assistant-options-title">{lang === 'zh' ? '对话设置' : 'Chat settings'}</p>
            <ChatPreferenceControls lang={lang} enterToSend={enterToSend} setEnterToSend={setEnterToSend} largeText={largeText} setLargeText={setLargeText} />

          </div>
          <div className="assistant-tools px-2.5 pb-2.5">
              <input
                ref={aiFileInputRef}
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.json"
                className="hidden"
                onChange={event => void handleAiImagePick(event)}
              />

            <button
              type="button"
              onClick={() => aiFileInputRef.current?.click()}
              disabled={!spaceId || uploadingAttachment || sending || aiAttachments.length >= 4}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-700"
              title={t.attachImage}
              aria-label={t.attachImage}
            >
              {uploadingAttachment ? <Loader2 size={16} className="animate-spin" /> : <RemixIcon name="attachment-2" size={16} />}
            </button>

            <button
              type="button"
              onClick={() => void generateImageDirect()}
              disabled={sending || !canChatWithAI}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap h-9 rounded-lg px-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-700"
              title={t.drawImage}
              aria-label={t.drawImage}
            >
              <RemixIcon name="image-line" size={16} className="shrink-0" />
              <span className="assistant-tool-label hidden text-[0.75rem] font-medium sm:inline">{t.drawShort}</span>
            </button>
            <button
              type="button"
              onClick={() => void sendCanvasToAi()}
              disabled={!spaceId || uploadingAttachment || sending || allNotes.length === 0 || aiAttachments.length >= 4}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-700"
              title={t.showCanvas}
              aria-label={t.showCanvas}
            >
              <RemixIcon name="layout-grid-line" size={16} />
            </button>

            <div className="assistant-primary-controls">
                {aiLoading ? (
                  <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-gray-400"><Loader2 size={13} className="animate-spin" />Loading AI</span>
                ) : !canChatWithAI ? (
                  <span className="min-w-0 text-[0.75rem] leading-5 text-gray-500 dark:text-gray-400">{aiRateLimited ? t.rateLimited : t.noAi}</span>
                ) : (
                  <label className="assistant-model-control inline-flex min-w-0 items-center gap-1">
                    <span className="sr-only">{t.aiModel}</span>
                    <select
                      value={selectedModelValue}
                      onChange={event => {
                        const next = decodePartnerModelValue(event.target.value);
                        setSelectedProviderId(next.providerId);
                        setSelectedModel(next.model);
                      }}
                      title={selectedPartnerTitle}
                      className="h-8 w-full min-w-0 max-w-full truncate rounded-lg border border-transparent bg-transparent pr-1 text-[0.75rem] font-semibold text-gray-600 outline-none transition-colors hover:border-gray-200 focus-visible:border-gray-300 dark:text-gray-300 dark:hover:border-gray-600"
                    >
                      {partnerModelOptions.map(option => (
                        <option key={option.value} value={option.value} title={partnerModelTitle(option.providerId, option.model, lang)}>
                          {option.providerId === 'auto'
                            ? (defaultPartnerOption ? `${option.label} · ${defaultPartnerOption.label === 'DeepSeek Flash' ? 'Flash' : defaultPartnerOption.label}` : option.label)
                            : option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              <AnswerLengthSelect lang={lang === 'zh' ? 'zh' : 'en'} disabled={sending} />
            </div>
            <button type="button" onClick={() => setComposerMenuOpen(open => !open)}
              aria-expanded={composerMenuOpen} aria-label={lang === 'zh' ? '对话设置' : 'Chat settings'}
              title={lang === 'zh' ? '对话设置' : 'Chat settings'}
              className="assistant-settings-toggle">
              <RemixIcon name="equalizer-line" size={17} />
              <span className="assistant-settings-label">{lang === 'zh' ? '对话设置' : 'Settings'}</span>
            </button>
            <button
              type="button"
              onClick={() => void sendAiMessage()}
              disabled={sending || !aiInput.trim() || !canChatWithAI}
              title={!aiInput.trim() && aiAttachments.length > 0 ? attachmentQuestionHint(aiAttachments, lang === 'zh' ? 'zh' : 'en') : undefined}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#000080] text-white transition-all hover:bg-[#000060] active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t.send}
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <RemixIcon name="arrow-up-line" size={16} />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );

  /**
   * AI 内容进笔记前必选的支架。
   * 课程里一条 GenAI 支架都没有时不硬卡，只提示——不能因为支架没配好就让学生写不了笔记。
   */
  const renderAiScaffoldField = (selected: Scaffold | null, onSelect: (value: Scaffold) => void) => (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t.aiScaffoldLabel}</span>
        <span className="text-[0.6875rem] text-red-500">*</span>
        {selected && (
          <span className="rounded-md bg-[#000080]/10 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-[#000080] dark:bg-blue-950/50 dark:text-blue-300">
            {t.aiScaffoldChosen}：{scaffoldLabel(selected, lang)}
          </span>
        )}
      </div>
      <p className="mb-2 text-[0.6875rem] leading-relaxed text-gray-500 dark:text-gray-400">{t.aiScaffoldHint}</p>
      {genAiScaffolds.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t.aiScaffoldNone}
        </p>
      ) : (
        <div className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
          <ScaffoldPicker
            scaffolds={genAiScaffolds}
            lang={lang}
            onlyGenAi
            onPick={onSelect}
            selectedId={selected?.id ?? null}
          />
        </div>
      )}
    </div>
  );

  const parentPanel = parentNote ? (
    <aside
      aria-label={t.parentNote}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-black/10 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
          style={{
            color: parentMove?.color ?? RELATION_COLORS.extend,
            borderColor: `${parentMove?.color ?? RELATION_COLORS.extend}33`,
            backgroundColor: `${parentMove?.color ?? RELATION_COLORS.extend}12`,
          }}
        >
          <CornerDownRight size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[0.9375rem] font-bold tracking-tight text-gray-900 dark:text-gray-100">{t.parentNote}</h2>
          {parentMove && (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Build-on · <span className="font-semibold" style={{ color: parentMove.color }}>{lang === 'zh' ? parentMove.labelZh : parentMove.label}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setParentPanelOpen(false)}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
          aria-label={t.close}
          title={t.close}
        >
          <ChevronUp size={17} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-gray-100 px-5 py-4 dark:border-gray-800">
        <h3 className="note-prose text-[1.0625rem] font-bold leading-snug text-gray-900 dark:text-gray-100">{parentNote.title}</h3>
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {parentNote.author}{parentNote.date ? ` · ${parentNote.date}` : ''}
        </p>
        {parentNote.fileUrl && (
          <a
            href={parentNote.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Paperclip size={13} className="shrink-0" />
            <span className="truncate">{t.parentAttachment}：{parentNote.fileName || parentNote.title}</span>
          </a>
        )}
        <article
          style={proseStyle}
          className="note-prose mt-4 text-gray-900 dark:text-gray-100 [&_a]:break-words [&_a]:font-semibold [&_a]:text-blue-700 dark:[&_a]:text-blue-400 [&_a]:underline [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-[1.3em] [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-2.5 [&_h2]:text-[1.15em] [&_h2]:font-bold [&_img]:max-w-full"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(parentNote.content || '') }}
        />
      </div>
      <p className="border-t border-gray-100 px-5 py-2.5 text-xs leading-5 text-gray-500 dark:border-gray-800 dark:text-gray-400">{t.parentPanelHint}</p>
    </aside>
  ) : null;
  const sidePanel = showParentPanel ? parentPanel : (aiOpen ? aiPanel : null);

  return (
    <div className="note-editor-shell fixed inset-0 z-[100] flex bg-white dark:bg-gray-950 font-sans">
      <div className="flex h-full w-full items-stretch gap-0">
      {sidePanel && isLargeScreen && (
        <div
          className="h-full shrink-0"
          style={{ width: `${aiPanelWidth}px` }}
        >
          {sidePanel}
        </div>
      )}
      {sidePanel && isLargeScreen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t.resizeSplit}
          aria-valuemin={NOTE_AI_SPLIT_LAYOUT.minAiWidth}
          aria-valuemax={NOTE_AI_SPLIT_LAYOUT.maxAiWidth}
          aria-valuenow={Math.round(aiPanelWidth)}
          title={t.resizeSplit}
          tabIndex={0}
          onPointerDown={startSplitResize}
          onPointerMove={moveSplitResize}
          onPointerUp={endSplitResize}
          onPointerCancel={endSplitResize}
          onDoubleClick={resetSplitResize}
          onKeyDown={handleSplitResizeKeyDown}
          className="group flex h-full w-2 shrink-0 cursor-col-resize touch-none items-center justify-center"
        >
          <div className="h-16 w-1 rounded-full bg-gray-300 dark:bg-gray-700 transition-colors group-hover:bg-[#000080] dark:group-hover:bg-blue-400 group-focus-visible:bg-[#000080]" />
        </div>
      )}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <div className="note-workspace-header flex select-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 px-4 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] backdrop-blur-sm">
          <div className="flex shrink-0 items-center gap-2">
            <FileText size={15} className="text-[#000080]" />
            {isBuildOn && move && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
                <CornerDownRight size={12} style={{ color: move.color }} />
                {t.buildOn}: {lang === 'zh' ? move.labelZh : move.label}
              </span>
            )}
            {isRiseAbove && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/50 px-2 py-0.5 text-xs font-semibold text-purple-800 dark:text-purple-300">
                <Sparkles size={12} className="text-purple-600 dark:text-purple-400" />
                Rise Above · {riseAboveCitedIds.length} {lang === 'zh' ? '笔记综合' : 'notes'}
              </span>
            )}
          </div>
          <nav className="flex items-center gap-0.5">
            {[
              { id: 'edit' as const, label: t.edit, icon: FileText },
              { id: 'read' as const, label: t.read, icon: BookOpen },
              { id: 'connections' as const, label: t.connections, icon: Link2 },
              { id: 'info' as const, label: t.info, icon: Info },
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                    activeTab === tab.id
                      ? 'bg-[#000080]/8 font-semibold text-[#000080] dark:bg-blue-950/50 dark:text-blue-300'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[0.6875rem] text-gray-400 dark:text-gray-500 lg:inline">
              {initialData?.author || (lang === 'zh' ? '我' : 'You')} · {initialData?.date || new Date().toLocaleDateString()} · {wordCount} {t.words}
            </span>
            {parentNote && (
              <button
                type="button"
                onClick={() => {
                  const next = !showParentPanel;
                  setParentPanelOpen(next);
                  if (next) setAiOpen(false);
                }}
                aria-pressed={showParentPanel}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold transition-colors ${showParentPanel ? 'border-gray-300 bg-gray-100 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100' : 'border-gray-200 bg-white/70 text-gray-700 hover:bg-white dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300 dark:hover:bg-gray-800'}`}
              >
                <CornerDownRight size={13} style={{ color: parentMove?.color }} />
                {t.parentNoteButton}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const next = !aiOpen;
                setAiOpen(next);
                if (next) setParentPanelOpen(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 px-2.5 py-1 text-xs font-bold text-[#000080] dark:text-blue-300 hover:bg-white dark:hover:bg-gray-800 transition-colors"
            >
              <Bot size={13} />
              {t.aiPartner}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 transition-colors hover:bg-white dark:hover:bg-gray-800"
              aria-label={t.close}
            >
              <X size={13} />
              {t.backToCanvas}
            </button>
          </div>
        </div>
        {sidePanel && !isLargeScreen && (
          <div className="fixed inset-0 z-[125] w-full sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[min(92vw,600px)]">
            {sidePanel}
          </div>
        )}


        <div className={`grid min-h-0 flex-1 grid-cols-1 bg-white dark:bg-gray-950 ${readOnlyNote ? '' : 'sm:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)]'}`}>
          {/* 只读时没有东西可插，支架栏收起 */}
          <aside className={`hidden min-h-0 overflow-y-auto border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 ${readOnlyNote ? '' : 'sm:block'}`}>
            {isRiseAbove ? (
              <>
                {/* Rise Above: Cited notes reference panel */}
                <div className="mb-3 text-xs font-bold uppercase tracking-wide text-purple-700">
                  {lang === 'zh' ? '综合来源' : 'Source Notes'}
                </div>
                <div className="space-y-1.5 mb-4">
                  {allNotes.filter(n => riseAboveCitedIds.includes(n.id)).map(n => (
                    <div
                      key={n.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', `[${n.title}]`); }}
                      className="rounded border border-purple-200 bg-white/80 p-2 text-xs cursor-grab active:cursor-grabbing hover:border-purple-400 transition-colors"
                    >
                      <div className="font-semibold text-slate-800 line-clamp-1">{n.title}</div>
                      <div className="text-slate-500 line-clamp-2 mt-0.5">{n.content}</div>
                      <div className="text-[0.6875rem] text-slate-400 mt-1">{n.author}</div>
                    </div>
                  ))}
                </div>
                {/* Epistemic markers — open questions, not fixed templates */}
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                  {lang === 'zh' ? '认知路标' : 'Epistemic Markers'}
                </div>
                <div className="space-y-1">
                  {(lang === 'zh' ? [
                    '这些想法之间，什么是我们尚未注意到的联系？',
                    '哪些观点之间存在张力或矛盾？这种张力能告诉我们什么？',
                    '如果把这些想法当作一个整体来看，什么更大的图景浮现了？',
                    '我们集体理解中还缺少什么？下一步的探究方向是？',
                    '这个综合如何改变了我们最初的问题理解？',
                  ] : [
                    'What connections between these ideas have we not yet noticed?',
                    'Where do these views create tension? What does that tension reveal?',
                    'Viewed as a whole, what larger pattern emerges?',
                    'What is still missing from our collective understanding?',
                    'How does this synthesis change our understanding of the original question?',
                  ]).map((marker, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => insertPrompt(marker, 'rise-above-epistemic', `marker-${i}`)}
                      className="w-full rounded-sm border border-purple-200 bg-purple-50/60 px-2 py-1.5 text-left text-xs leading-snug text-purple-900 hover:bg-purple-100/60"
                    >
                      {marker}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.scaffolds}</div>
                {availableScaffolds.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-white/45 dark:bg-gray-800/45 p-3 text-xs text-gray-500">{t.noScaffolds}</div>
                ) : (
                  <ScaffoldPicker
                    scaffolds={availableScaffolds}
                    lang={lang}
                    onPick={insertScaffoldMarker}
                    aiSuggestions={feedbacks
                      .filter(f => f.status === 'new' && f.suggestedScaffold && !f.suggestedScaffoldUsedAt)
                      .map(f => ({ id: f.id, text: f.suggestedScaffold! }))}
                    onPickAi={insertAiScaffold}
                    compact
                  />
                )}
              </div>
            )}
          </aside>

          <main className="flex min-h-0 flex-col bg-white dark:bg-gray-950">
            <div className="border-b border-gray-200 dark:border-gray-800 bg-white px-5 py-2.5 dark:bg-gray-950 sm:px-8">
              <label className="flex w-full items-center gap-3">
                <span className="shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-300">{t.title}</span>
                <input
                  value={title}
                  readOnly={readOnlyNote}
                  onChange={event => setTitle(event.target.value)}
                  placeholder={isRiseAbove ? (lang === 'zh' ? '为你的综合观点命名...' : 'Name your synthesis...') : t.titlePlaceholder}
                  aria-label={t.title}
                  style={{ fontSize: `${Math.round(noteFontSize * 1.15)}px` }}
                  className="note-prose min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 font-semibold text-gray-900 outline-none transition-colors placeholder:font-normal placeholder:text-gray-400 focus:border-[#000080] focus:bg-white focus:ring-1 focus:ring-[#000080] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:bg-gray-950 dark:focus:ring-blue-400"
                />
              </label>
              {saveBlocked && (
                <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">{saveBlocked}</p>
              )}
              {readOnlyNote && (
                <p className="mt-2 flex items-center gap-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  <CornerDownRight size={13} className="shrink-0 text-[#000080] dark:text-blue-300" />
                  {t.readOnlyHint}
                </p>
              )}
            </div>

            {/* 切到别的页签时撰写区只藏起来、不卸载。正文只在打开笔记时写进编辑区一次，卸载后重新挂上的是空的，
                再点「贡献」就把空正文存进了库（2026-10-06）。保存、阅读、信息页签都读这一个编辑区 */}
            <div className={activeTab === 'edit' ? 'contents' : 'hidden'}>
                <div className={`${readOnlyNote ? 'hidden' : 'flex'} flex-wrap items-center gap-1 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-1.5`}>
                  <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageInput} />
                  <input ref={documentInputRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={handleDocumentInput} />
                  <button type="button" onClick={() => formatBlock('h1')} className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title={t.heading1}><Heading1 size={14} />{t.heading1}</button>
                  <button type="button" onClick={() => formatBlock('h2')} className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title={t.heading2}><Heading2 size={14} />{t.heading2}</button>
                  <button type="button" onClick={() => formatBlock('p')} className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title={t.paragraph}><AlignLeft size={14} />{t.paragraph}</button>
                  <span className="mx-1 h-6 w-px bg-gray-200 dark:bg-gray-700" />
                  <button type="button" onClick={() => execCmd('bold')} className="h-7 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Bold" aria-label="Bold"><Bold size={14} /></button>
                  <button type="button" onClick={() => execCmd('italic')} className="h-7 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Italic" aria-label="Italic"><Italic size={14} /></button>
                  <button type="button" onClick={() => execCmd('underline')} className="h-7 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Underline" aria-label="Underline"><Underline size={14} /></button>
                  <button type="button" onClick={() => execCmd('insertUnorderedList')} className="h-7 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="List" aria-label="List"><List size={14} /></button>
                  <button type="button" onClick={insertEditorLink} className="h-7 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title={t.insertLink} aria-label={t.insertLink}><Link2 size={14} /></button>
                  <div ref={colorMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setColorMenuOpen(value => !value)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
                      title={t.textColor}
                      aria-label={t.textColor}
                      aria-expanded={colorMenuOpen}
                    >
                      <Baseline size={14} />
                      <span className="h-1 w-3.5 rounded-sm" style={{ backgroundColor: noteTextColor }} />
                    </button>
                    {colorMenuOpen && (
                      <div className="absolute left-0 top-8 z-30 flex gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                        {NOTE_TEXT_COLORS.map(color => (
                          <button
                            key={color.value}
                            type="button"
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => {
                              setNoteTextColor(color.value);
                              execCmd('foreColor', color.value);
                              setColorMenuOpen(false);
                            }}
                            title={color.label[lang === 'zh' ? 'zh' : 'en']}
                            aria-label={color.label[lang === 'zh' ? 'zh' : 'en']}
                            className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                              noteTextColor === color.value ? 'border-gray-900 dark:border-gray-100' : 'border-gray-200 dark:border-gray-600'
                            }`}
                            style={{ backgroundColor: color.value }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <select
                    aria-label={t.fontSize}
                    value={noteFontSize}
                    onChange={event => setNoteFontSize(Number(event.target.value))}
                    className="h-7 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300 outline-none"
                  >
                    {[12, 13, 14, 15, 16, 17, 18, 20, 22].map(size => (
                      <option key={size} value={size}>{t.fontSize} {size}</option>
                    ))}
                  </select>
                  <select
                    aria-label={t.lineHeight}
                    value={noteLineHeight}
                    onChange={event => setNoteLineHeight(Number(event.target.value))}
                    className="h-7 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300 outline-none"
                  >
                    <option value={1}>{t.lineHeight} {t.lhTight}</option>
                    <option value={1.15}>{t.lineHeight} {t.lhSingle}</option>
                    <option value={1.5}>{t.lineHeight} {t.lhOneHalf}</option>
                    <option value={1.75}>{t.lineHeight} 1.75</option>
                    <option value={2}>{t.lineHeight} {t.lhDouble}</option>
                  </select>
                  <span className="mx-1 h-6 w-px bg-gray-200 dark:bg-gray-700" />
                  <button type="button" onClick={() => imageInputRef.current?.click()} className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title={t.insertImage}><ImageIcon size={14} />{t.insertImage}</button>
                  <button type="button" onClick={() => documentInputRef.current?.click()} className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title={t.insertDocument}><Paperclip size={14} />{t.insertDocument}</button>
                </div>
                <div className="relative min-h-0 flex-1 overflow-y-auto bg-zinc-50/60 p-4 dark:bg-gray-950 sm:p-6" onMouseMove={handleEditorMouseMove} onMouseLeave={() => setHoveredScaffold(null)}>
                  <div
                    ref={editorRef}
                    contentEditable={!readOnlyNote}
                    suppressContentEditableWarning
                    lang={lang === 'zh' ? 'zh-CN' : 'en'}
                    onInput={handleEditorInput}
                    onKeyDown={handleEditorKeyDown}
                    onPaste={handleEditorPaste}
                    onFocus={saveEditorSelection}
                    onKeyUp={saveEditorSelection}
                    onMouseUp={saveEditorSelection}
                    onPointerUp={saveEditorSelection}
                    onSelect={saveEditorSelection}
                    style={{ ...proseStyle, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' }}
                    className="note-prose min-h-full w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-5 text-gray-900 dark:text-gray-100 outline-none transition-colors focus:border-[#000080] dark:focus:border-blue-400 sm:px-9 sm:py-6 empty:before:text-gray-400 [&_a]:break-words [&_a]:font-semibold [&_a]:text-blue-700 dark:[&_a]:text-blue-400 [&_a]:underline [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-[1.45em] [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-2.5 [&_h2]:text-[1.2em] [&_h2]:font-bold [&_img]:max-w-full [&_[data-ai-source='genai']]:border-b-2 [&_[data-ai-source='genai']]:border-stone-400 [&_[data-ai-source='genai']]:bg-stone-100 dark:[&_[data-ai-source='genai']]:bg-stone-800 transition-colors"
                    data-placeholder={t.startWriting}
                  />
                  {hoveredScaffold && (
                    <button
                      type="button"
                      data-scaffold-remove
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => removeScaffoldBlock(hoveredScaffold.el)}
                      title={lang === 'zh' ? '去掉这条支架（保留你写的字）' : 'Remove this scaffold (keeps your words)'}
                      aria-label={lang === 'zh' ? '去掉这条支架' : 'Remove scaffold'}
                      className="absolute z-10 flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      style={{ top: hoveredScaffold.top, left: hoveredScaffold.left }}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
                {renderTeacherFeedbackSection()}
                {/* 自动反馈是给作者改自己笔记用的，别人的笔记上不显示 */}
                <section className={`${readOnlyNote ? 'hidden ' : ''}border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 px-4 py-2.5 max-h-[28vh] overflow-y-auto`}>
                  <div className={`flex flex-wrap items-center justify-between gap-2 ${visibleFeedbacks.length > 0 ? 'mb-2.5' : ''}`}>
                    <div>
                      <div className="flex items-center gap-1.5 text-sm font-bold text-gray-800 dark:text-gray-200"><Sparkles size={15} className="text-amber-500" />{t.autoFeedback}</div>
                      {visibleFeedbacks.length === 0 && (
                        <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{t.autoFeedbackHint}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {(checkingFeedback || requestingFeedback) && <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><Loader2 size={13} className="animate-spin" />{t.checking}</span>}
                      <button
                        type="button"
                        onClick={handleAskAI}
                        disabled={requestingFeedback || !concreteAiSelection}
                        className="inline-flex items-center gap-1 rounded-sm border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                      >
                        <Sparkles size={13} />{lang === 'zh' ? '请求反馈' : 'Ask AI'}
                      </button>
                      {feedbacks.length > 0 && (
                        <button type="button" onClick={() => { if (!showFeedbackHistory) setDismissedFeedbackIds(new Set()); setShowFeedbackHistory(value => !value); }} className="inline-flex items-center gap-1 rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                          <History size={13} />{t.history}
                        </button>
                      )}
                    </div>
                  </div>
                  {feedbackError && <p role="status" className="mb-2 text-xs text-amber-700 dark:text-amber-300">{feedbackError}</p>}
                  {visibleFeedbacks.length > 0 && (
                    <div className="space-y-2">{visibleFeedbacks.map(renderFeedback)}</div>
                  )}
                </section>
            </div>

            {activeTab === 'read' && (
              <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50/60 p-4 dark:bg-gray-950 sm:p-6">
                <article
                  style={proseStyle}
                  className="note-prose min-h-full w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-5 text-gray-900 dark:text-gray-100 sm:px-9 sm:py-6 sm:px-10 sm:py-8 [&_a]:break-words [&_a]:font-semibold [&_a]:text-blue-700 dark:[&_a]:text-blue-400 [&_a]:underline [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-[1.45em] [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-2.5 [&_h2]:text-[1.2em] [&_h2]:font-bold [&_img]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderedContent || `<p class="text-slate-400">${t.startWriting}</p>`) }}
                />
                {teacherFeedbacks.length > 0 && (
                  <div className="mt-4 overflow-hidden rounded-sm border border-slate-200">
                    {renderTeacherFeedbackSection()}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'connections' && (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {connectionsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading</div>
                ) : !noteId || connections.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-white/70 dark:bg-gray-800/50 p-4 text-sm text-gray-500">{t.none}</div>
                ) : (
                  <div className="grid gap-5 lg:grid-cols-2">
                    <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
                      <h3 className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">{t.received}</h3>
                      {received.length ? received.map(connection => renderConnection(connection, 'in')) : <p className="text-xs text-gray-400">{t.none}</p>}
                    </section>
                    <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
                      <h3 className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">{t.sent}</h3>
                      {sent.length ? sent.map(connection => renderConnection(connection, 'out')) : <p className="text-xs text-gray-400">{t.none}</p>}
                    </section>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'info' && (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="grid max-w-3xl gap-4">
                  <dl className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm overflow-hidden">
                    <div className="grid grid-cols-[130px_1fr] border-b border-gray-100 dark:border-gray-800 px-4 py-2.5">
                      <dt className="font-semibold text-gray-500 dark:text-gray-400">{t.author}</dt>
                      <dd className="text-gray-900 dark:text-gray-100">{initialData?.author || (lang === 'zh' ? '我' : 'You')}</dd>
                    </div>
                    <div className="grid grid-cols-[130px_1fr] border-b border-gray-100 dark:border-gray-800 px-4 py-2.5">
                      <dt className="font-semibold text-gray-500 dark:text-gray-400">{t.modified}</dt>
                      <dd className="text-gray-900 dark:text-gray-100">{initialData?.date || new Date().toLocaleString()}</dd>
                    </div>
                    <div className="grid grid-cols-[130px_1fr] border-b border-gray-100 dark:border-gray-800 px-4 py-2.5">
                      <dt className="font-semibold text-gray-500 dark:text-gray-400">{t.connections}</dt>
                      <dd className="text-gray-900 dark:text-gray-100">{connectionsLoading ? '…' : connections.length}</dd>
                    </div>
                    <div className="grid grid-cols-[130px_1fr] px-4 py-2.5">
                      <dt className="font-semibold text-gray-500 dark:text-gray-400">{t.aiUptake}</dt>
                      <dd className="text-gray-900 dark:text-gray-100">{aiUptakeCount}</dd>
                    </div>
                  </dl>

                  {currentNote?.inquiryQuestion && (
                    <section className="rounded-lg border border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 p-4">
                      <h3 className="mb-1 text-sm font-bold text-gray-900 dark:text-gray-100">{t.linkedInquiry}</h3>
                      <p className="text-sm leading-6 text-gray-700 dark:text-gray-300">{currentNote.inquiryQuestion}</p>
                    </section>
                  )}

                  {(currentNote?.promisingReason || currentNote?.epistemicStatus === 'promising') && (
                    <section className="rounded-lg border border-sky-100 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/30 p-4">
                      <h3 className="mb-1 text-sm font-bold text-sky-800 dark:text-sky-300">{t.promisingReason}</h3>
                      <p className="text-sm leading-6 text-gray-700 dark:text-gray-300">
                        {currentNote.promisingReason || (lang === 'zh' ? '已标记为有潜力，但还需要补充为什么值得社区继续推进。' : 'Marked as promising, but it still needs an explicit reason for community uptake.')}
                      </p>
                    </section>
                  )}

                  {currentNote?.knowledgeLacks && currentNote.knowledgeLacks.length > 0 && (
                    <section className="rounded-lg border border-rose-100 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/30 p-4">
                      <h3 className="mb-2 text-sm font-bold text-rose-800 dark:text-rose-300">{t.knowledgeGaps}</h3>
                      <div className="grid gap-2">
                        {currentNote.knowledgeLacks.map(lack => (
                          <div key={lack.id} className="rounded-md border border-rose-100 dark:border-rose-800 bg-white dark:bg-gray-900 px-3 py-2 text-sm leading-6 text-gray-700 dark:text-gray-300">
                            <span className="mr-2 font-semibold text-rose-700 dark:text-rose-400">{lack.type.replace(/_/g, ' ')}</span>
                            {lack.text}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{t.improvementTrail}</h3>
                      {revisionsLoading && <Loader2 size={14} className="animate-spin text-gray-400" />}
                    </div>
                    {revisions.length === 0 ? (
                      <p className="text-sm leading-6 text-gray-500">{t.noRevisions}</p>
                    ) : (
                      <div className="grid gap-2">
                        {revisions.slice(0, 5).map(revision => (
                          <div key={revision.id} className="rounded-md border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                            <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                              <span className="font-bold text-gray-700 dark:text-gray-300">Rev {revision.revision_number}</span>
                              <span>{new Date(revision.created_at).toLocaleString()}</span>
                            </div>
                            <p className="mt-1 text-sm leading-6 text-slate-700">{revision.change_summary || 'Note updated'}</p>
                            {revision.users?.name && <p className="mt-1 text-xs text-slate-400">{revision.users.name}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}
          </main>
        </div>

        <div className="note-workspace-footer flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex">
            <span className="shrink-0 text-xs font-semibold text-gray-600 dark:text-gray-400">{t.keywords}</span>
            {keywords.map(keyword => (
              <span
                key={keyword}
                className="inline-flex items-center gap-1 rounded-full bg-[#000080]/[0.07] py-1 pl-2.5 pr-1 text-xs font-medium text-[#000080] dark:bg-blue-950/40 dark:text-blue-200"
              >
                {keyword}
                <button
                  type="button"
                  onClick={() => removeKeyword(keyword)}
                  className="rounded-full p-0.5 transition-colors hover:bg-[#000080]/15 dark:hover:bg-blue-900/50"
                  aria-label={`${t.removeKeyword}: ${keyword}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              hidden={readOnlyNote}
              value={keywordDraft}
              onChange={event => setKeywordDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                  event.preventDefault();
                  addKeyword(keywordDraft);
                } else if (event.key === 'Backspace' && !keywordDraft && keywords.length) {
                  removeKeyword(keywords[keywords.length - 1]);
                }
              }}
              onBlur={() => addKeyword(keywordDraft)}
              placeholder={t.keywordPlaceholder}
              aria-label={t.addKeyword}
              className="min-w-[8rem] flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs text-gray-900 outline-none transition-colors placeholder:text-gray-400 hover:border-gray-200 focus:border-[#000080] dark:text-gray-100 dark:hover:border-gray-700 dark:focus:border-blue-400"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              {t.close}
            </button>
            {!readOnlyNote && (
              <button type="button" onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-[#000080] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#000060] active:scale-[0.98] transition-all">
                <Save size={14} />
                {t.contribute}
              </button>
            )}
            {isOthersNote && noteId && onBuildOn && (
              <div ref={buildOnMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setBuildOnMenuOpen(value => !value)}
                  aria-haspopup="menu"
                  aria-expanded={buildOnMenuOpen}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-bold active:scale-[0.98] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/40 ${readOnlyNote ? 'bg-[#000080] text-white hover:bg-[#000060]' : 'border border-[#000080]/30 bg-white text-[#000080] hover:bg-[#000080]/5 dark:border-blue-400/40 dark:bg-gray-800 dark:text-blue-300'}`}
                >
                  <CornerDownRight size={14} />
                  {t.buildOnThis}
                  <ChevronUp size={14} className={`transition-transform duration-200 ${buildOnMenuOpen ? '' : 'rotate-180'}`} />
                </button>
                {buildOnMenuOpen && (
                  <div
                    role="menu"
                    aria-label={t.buildOnMenuTitle}
                    className="absolute bottom-full right-0 z-[130] mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl shadow-slate-900/15 animate-in fade-in slide-in-from-bottom-1 duration-150 dark:border-gray-700 dark:bg-gray-900"
                  >
                    <div className="px-2.5 pb-1.5 pt-1 text-xs font-semibold text-gray-500 dark:text-gray-400">{t.buildOnMenuTitle}</div>
                    {BUILD_ON_MOVES.map(move => (
                      <button
                        key={move.type}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setBuildOnMenuOpen(false);
                          onBuildOn(noteId, move.type);
                        }}
                        className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:hover:bg-gray-800 dark:focus:bg-gray-800"
                      >
                        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: RELATION_COLORS[move.type] }} />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
                            {lang === 'zh' ? move.labelZh : move.label}
                          </span>
                          <span className="block text-xs leading-5 text-gray-500 dark:text-gray-400">{lang === 'zh' ? move.desc : move.descEn}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
      {aiSelectionMenu && (
        <div
          className="fixed z-[145] flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-xl shadow-slate-950/20"
          style={{ left: aiSelectionMenu.x, top: aiSelectionMenu.y }}
          onMouseDown={event => event.preventDefault()}
        >
          <button
            type="button"
            onClick={() => {
              insertAiTextToNote({
                text: aiSelectionMenu.text,
                sourceMessageId: aiSelectionMenu.messageId,
                providerId: aiSelectionMenu.providerId,
                model: aiSelectionMenu.model,
              });
              window.getSelection()?.removeAllRanges();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#000080] px-3 text-xs font-bold text-white hover:bg-[#000080]/90 active:scale-[0.97] transition-all"
          >
            <TextCursorInput size={13} />
            {t.insert}
          </button>
          {noteId && (
            <button
              type="button"
              onClick={() => {
                publishAiSelectionAsNote({
                  text: aiSelectionMenu.text,
                  sourceMessageId: aiSelectionMenu.messageId,
                  sourceConversationId: selectedThread?.id,
                  providerId: aiSelectionMenu.providerId,
                  model: aiSelectionMenu.model,
                });
                window.getSelection()?.removeAllRanges();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 text-xs font-bold text-[#000080] dark:text-blue-300 hover:bg-white dark:hover:bg-blue-900/30 transition-colors"
            >
              <FileText size={13} />
              {t.publishAsNote}
            </button>
          )}
          <button
            type="button"
            onClick={addAiSelectionToChat}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors"
          >
            <MessageCircle size={13} />
            {t.addToChat}
          </button>
        </div>
      )}
      {pendingAiInsert && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 dark:bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-800 bg-blue-50/50 dark:bg-blue-950/20 px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-base font-bold text-gray-800 dark:text-gray-200"><TextCursorInput size={18} />{t.insertAiTitle}</div>
                <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{t.insertAiIntro}</p>
              </div>
              <button type="button" onClick={closeAiInsertDialog} className="rounded-md p-1.5 text-gray-500 hover:bg-white dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200 transition-colors" aria-label={t.cancel}>
                <X size={18} />
              </button>
            </div>

            <div className="grid max-h-[68vh] gap-4 overflow-y-auto p-5 md:grid-cols-[minmax(0,1fr)_320px]">
              <section className="min-w-0 space-y-4">
                <div>
                  <div className="mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-gray-500">{t.aiSource}</div>
                  <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3">
                    <MarkdownMessage content={pendingAiInsert.text} />
                  </div>
                </div>
                {renderAiScaffoldField(aiInsertScaffold, value => { setAiInsertScaffold(value); setAiInsertError(''); })}
              </section>

              <section className="space-y-3">
                {genAiScaffolds.length === 0 && (
                  <div>
                    <span className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-200">
                      {lang === 'zh' ? '这段内容对你的帮助是？' : 'How does this help you?'}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {INSERT_TAGS.map(tagDef => (
                        <button
                          key={tagDef.key}
                          type="button"
                          onClick={() => { setAiInsertTag(tagDef.key); setAiInsertError(''); }}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                            aiInsertTag === tagDef.key
                              ? 'border-[#000080] bg-[#000080]/5 text-[#000080] dark:border-[#93AAFD] dark:bg-[#93AAFD]/10 dark:text-[#93AAFD]'
                              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                          }`}
                        >
                          {lang === 'zh' ? tagDef.zh : tagDef.en}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <details className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                  <summary className="cursor-pointer text-xs font-medium text-gray-600 transition-colors hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
                    {lang === 'zh' ? '想多说两句（可不填）' : 'Add a note (optional)'}
                  </summary>
                  <textarea
                    value={aiInsertReason}
                    onChange={event => { setAiInsertReason(event.target.value); setAiInsertError(''); }}
                    placeholder={t.insertAiReasonPlaceholder}
                    className="mt-2 min-h-20 w-full resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm leading-6 text-gray-900 dark:text-gray-100 outline-none focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/20 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                  />
                  <textarea
                    value={aiInsertPlan}
                    onChange={event => setAiInsertPlan(event.target.value)}
                    placeholder={t.insertAiPlanPlaceholder}
                    className="mt-2 min-h-16 w-full resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm leading-6 text-gray-900 dark:text-gray-100 outline-none focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/20 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                  />
                </details>
                {aiInsertError && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{aiInsertError}</div>}
              </section>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-5 py-3">
              <button type="button" onClick={closeAiInsertDialog} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">{t.cancel}</button>
              <button type="button" onClick={() => void confirmAiTextInsert()} className="rounded-lg bg-[#000080] px-4 py-2 text-sm font-bold text-white hover:bg-[#000080]/90 active:scale-[0.98] transition-all">{t.insertAiConfirm}</button>
            </div>
          </div>
        </div>
      )}
      {pendingAiPublish && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 dark:bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-800 bg-blue-50/50 dark:bg-blue-950/20 px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-base font-bold text-gray-800 dark:text-gray-200"><FileText size={18} />{t.publishAiTitle}</div>
                <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{t.publishAiIntro}</p>
              </div>
              <button type="button" onClick={closeAiPublishDialog} disabled={aiPublishing} className="rounded-md p-1.5 text-gray-500 hover:bg-white dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200 disabled:opacity-50 transition-colors" aria-label={t.cancel}>
                <X size={18} />
              </button>
            </div>

            <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-5 md:grid-cols-[minmax(0,1fr)_320px]">
              <section className="min-w-0 space-y-4">
                <div>
                  <div className="mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-gray-500">{t.aiSource}</div>
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3">
                    <MarkdownMessage content={pendingAiPublish.text} />
                  </div>
                </div>
                {renderAiScaffoldField(aiPublishScaffold, value => { setAiPublishScaffold(value); setAiPublishError(''); })}
              </section>

              <section className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{t.publishNoteTitle}</span>
                  <input
                    value={aiPublishTitle}
                    onChange={event => { setAiPublishTitle(event.target.value); setAiPublishError(''); }}
                    placeholder={t.publishNoteTitlePlaceholder}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/20 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                    autoFocus
                  />
                </label>
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200">{t.publishRelationType}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(BUILD_ON_META) as Array<[RelationType, { label: string; labelZh: string; color: string }]>).map(([type, meta]) => {
                      const active = aiPublishRelationType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setAiPublishRelationType(type)}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-colors ${active ? 'border-[#000080] dark:border-blue-400 bg-blue-50 dark:bg-blue-950/30 text-[#000080] dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                          <span>{lang === 'zh' ? meta.labelZh : meta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{t.publishReason}</span>
                  <textarea
                    value={aiPublishReason}
                    onChange={event => { setAiPublishReason(event.target.value); setAiPublishError(''); }}
                    placeholder={t.publishReasonPlaceholder}
                    className="min-h-28 w-full resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm leading-6 text-gray-900 dark:text-gray-100 outline-none focus:border-[#000080] focus:ring-2 focus:ring-[#000080]/20 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
                  />
                </label>
                {aiPublishError && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" />{aiPublishError}</div>}
              </section>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-5 py-3">
              <button type="button" onClick={closeAiPublishDialog} disabled={aiPublishing} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors">{t.cancel}</button>
              <button type="button" onClick={() => void confirmAiSelectionPublish()} disabled={aiPublishing} className="inline-flex items-center gap-2 rounded-lg bg-[#000080] px-4 py-2 text-sm font-bold text-white hover:bg-[#000080]/90 active:scale-[0.98] transition-all disabled:opacity-60">
                {aiPublishing && <Loader2 size={15} className="animate-spin" />}
                {t.publishAiConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NoteEditorModal;
