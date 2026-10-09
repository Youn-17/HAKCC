
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Sidebar, { SIDEBAR_MAX_W, SIDEBAR_MIN_W, sidebarDefaultWidth } from './Sidebar';
import Header from './Header';
import NoteItem from './NoteItem';
import GroupIdeaGraph from './GroupIdeaGraph';
import RiseAboveRoom from './RiseAboveRoom';
import NoteEditorModal from './NoteEditorModal';
import AiDialogueNote from './AiDialogueNote';
import DrawingModal, { DrawingElement } from './DrawingModal';
import FileViewerPage from './FileViewerPage';
import { lazy, Suspense } from 'react';
import { collaborativeDocuments } from '../services/apiClient';
import { isCollaborativeDocument } from '../services/collaborativeDocuments';

const CollaborativeDocumentEditor = lazy(() => import('./CollaborativeDocumentEditor'));
const COLLAB_ENABLED = import.meta.env.VITE_ENABLE_COLLAB_DOCUMENTS === 'true';
import AttachmentUploadModal from './AttachmentUploadModal';
const SpaceAnalytics = React.lazy(() => import('./analytics/SpaceAnalytics'));
import ViewPanel from './ViewPanel';
import ViewCard, { VIEW_CARD_WIDTH, VIEW_CARD_HEIGHT } from './ViewCard';
// 旧的 RiseAboveModal（四步向导 + AI 生成综述）已删除。Rise Above 现在是一间讨论室：
// 见 RiseAboveRoom.tsx —— 系统只指出该往哪儿想，那句更高一层的说法由学生自己写。
import ScaffoldModal from './ScaffoldModal';
import MemberManagementModal from './MemberManagementModal';
import GroupManagementModal from './GroupManagementModal';
import AISidePanel from './AISidePanel';
import WorkspaceAgentPanel from './WorkspaceAgentPanel';
import { workspaceAgent as workspaceAgentApi } from '../services/apiClient';
import { uploadAttachment, MAX_ATTACHMENT_BYTES } from '../services/attachmentUpload';
import type { ApiAIConfig, CourseRole } from '../services/apiClient';
import InquiryPanel from './InquiryPanel';
import { Note, Edge, UserRole, Language, ViewDefinition, Scaffold, Notification, GroupTask, RelationType } from '../types';
import { scaffoldMarkerHtml } from './scaffoldLibrary';
import { ApiClientError, courses as coursesApi, groups as groupsApi, riseAbove as riseAboveApi, notes as notesApi, noteAiFeedback, relations as relationsApi, notifications as notificationsApi, scaffolds as scaffoldsApi, trackEvent, viewCards as viewCardsApi, views as viewsApi } from '../services/apiClient';
import type { ApiNote, ApiScaffold, ApiShape, ApiView, ApiViewCard, NotePresentation, ShapePayload, ShapeType, Space } from '../services/apiClient';
import ShapeLayer, { type ShapeDraft } from './ShapeLayer';
import ShapeStylePanel, { type ShapeStyleValue } from './ShapeStylePanel';
import ShapeGlyph from './ShapeGlyph';
import { SHAPE_CATALOG, isLineShape } from './shapeGeometry';
import { formatNoteStamp, notePlainParagraphs, notePreviewText, plainTextToNoteHtml } from './noteText';
import { hotBuildOnCounts, isNoteNew, isOwnNote, useMarkSeenAfterDwell, useNoteSeenVersion } from './noteBadges';
import ViewTopicTicker from './ViewTopicTicker';
import CanvasSearch, { type CanvasSearchItem } from './CanvasSearch';
import BuildOnPeek, { type PeekItem } from './BuildOnPeek';
import {
  autoFoldIds, buildFoldGraph, effectiveFolds, foldStorageKey, foldSummaries, hiddenByFolds,
  readFoldChoices, revealChoices, saveFoldChoices, toggleFold, type FoldChoices, type FoldGraph,
} from './buildOnCollapse';
import { notesFingerprint, useViewTopics } from './viewTopics';
import type { ViewTopic } from '../services/apiClient';
import { useSpaceData, apiNoteToNote, apiRelationToEdge, type NoteGeometry } from '../hooks/useSpaceData';
import { useAuth } from '../contexts/AuthContext';
import { useReportHelpContext } from './help/helpContext';
import { gsap, prepareForMotion, shouldReduceMotion, useGSAP } from '../utils/gsapMotion';
import RemixIcon from './RemixIcon';
import FloatingAtPoint from './FloatingAtPoint';
import { BUILD_ON_MOVES, RELATION_COLORS, RELATION_STYLE, RELATION_LABELS } from './relationColors';
import { MORANDI, chipStyle, noticeStyle } from './morandiPalette';
import NoteAiPanel from './NoteAiPanel';
import BuildOnNetwork from './BuildOnNetwork';
import SpaceTimeline from './SpaceTimeline';
import { canCreateCourseSpace, ideaGraphGroup, isCourseStaff } from './courseStanding';
import {
  STANDARD_NOTE_WIDTH, STANDARD_NOTE_HEIGHT,
  VIEW_NOTE_WIDTH, VIEW_NOTE_HEIGHT,
  RISEABOVE_NOTE_WIDTH, RISEABOVE_NOTE_HEIGHT,
  DRAWING_NOTE_SIZE, ATTACHMENT_NOTE_WIDTH, ATTACHMENT_NOTE_HEIGHT,
  MIN_NOTE_WIDTH, MIN_NOTE_HEIGHT,
} from './noteGeometry';
import { findOpenPosition, getNoteDimensions, placeNewNote } from './notePlacement';

interface WorkspaceProps {
  courseId?: string;
  courseTitle?: string;
  onExit?: () => void;
  userRole: UserRole;
  lang: Language;
  setLang: (lang: Language) => void;
}

/** Server-persisted notes carry a UUID; anything else exists only client-side. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 这一次新建的笔记接在哪条笔记上、以什么关系。 */
type BuildOnIntent = { parentId: string; relationType: RelationType };

// --- Geometric Helpers for Edge-to-Edge Connections ---




// Calculate the intersection point between a line (from center1 to center2) 
// and the border of the rectangle defined by rect (x, y, w, h)
const getRectIntersection = (
  rect: { x: number; y: number; w: number; h: number },
  targetCenter: { x: number; y: number }
) => {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = targetCenter.x - cx;
  const dy = targetCenter.y - cy;

  // If points are same (shouldn't happen), return center
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  // Calculate the slope of the line
  const slope = Math.abs(dy / dx);
  // Calculate the aspect ratio slope of the rectangle
  const rectSlope = (rect.h / 2) / (rect.w / 2);

  // Determine intersection based on quadrant
  if (slope <= rectSlope) {
    // Intersection is on the Left or Right vertical edge
    const xDir = dx > 0 ? 1 : -1;
    const xEdge = cx + xDir * (rect.w / 2);
    // Calculate y using point-slope form: y - cy = (dy/dx) * (x - cx)
    const yEdge = cy + (dy / dx) * (xEdge - cx);
    return { x: xEdge, y: yEdge };
  } else {
    // Intersection is on the Top or Bottom horizontal edge
    const yDir = dy > 0 ? 1 : -1;
    const yEdge = cy + yDir * (rect.h / 2);
    // Calculate x using: x - cx = (dx/dy) * (y - cy)
    const xEdge = cx + (dx / dy) * (yEdge - cy);
    return { x: xEdge, y: yEdge };
  }
};

const getContentBounds = (notes: Note[], padding = 2000) => {
  if (notes.length === 0) return { minX: -2000, maxX: 2000, minY: -1500, maxY: 1500, width: 4000, height: 3000 };
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  minX = Math.min(minX, 1000); maxX = Math.max(maxX, 1800);
  minY = Math.min(minY, 400); maxY = Math.max(maxY, 900);
  minX = Math.min(minX, 2300); maxX = Math.max(maxX, 3100);
  minY = Math.min(minY, 400); maxY = Math.max(maxY, 1200);
  notes.forEach(n => {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + (n.width || 200));
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + (n.height || 150));
  });
  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minY: minY - padding,
    maxY: maxY + padding,
    width: (maxX + padding) - (minX - padding),
    height: (maxY + padding) - (minY - padding)
  };
};

/** The default canvas every space starts with; virtual, not a DB row. */
const WELCOME_VIEW_ID = 'view-welcome';

const INITIAL_VIEWS: ViewDefinition[] = [
  { id: WELCOME_VIEW_ID, title: 'Welcome', creatorId: '', createdAt: '', lastModified: '' },
];

function apiViewToView(view: ApiView): ViewDefinition {
  return {
    id: view.id,
    title: view.title,
    description: view.description,
    creatorId: view.creatorId ?? '',
    createdAt: view.createdAt,
    lastModified: view.lastModified,
  };
}

function apiScaffoldToScaffold(scaffold: ApiScaffold): Scaffold {
  return {
    id: scaffold.id,
    hidden: scaffold.hidden,
    courseId: scaffold.courseId,
    title: scaffold.title,
    titleEn: scaffold.titleEn ?? undefined,
    description: scaffold.description ?? '',
    category: scaffold.category,
    metadata: scaffold.metadata,
    sortOrder: scaffold.sortOrder,
    icon: scaffold.icon,
    color: scaffold.color,
    usageCount: scaffold.usageCount,
    isMandatory: scaffold.isMandatory,
    isRecommended: scaffold.isRecommended,
    steps: scaffold.steps,
  };
}

/**
 * 侧栏宽度的存储键带版本号。旧键 hakcc-sidebar-width 里存的是按英文标签定的宽度，
 * 中文界面下会空出一大片；换个键等于把那批旧值一次性丢掉，之后用户自己拖的宽度照常记住。
 */
const SIDEBAR_WIDTH_KEY = 'hakcc-sidebar-width-v2';

/**
 * 右侧详情栏的类型、状态、知识缺口用中文说（原来直接显示 NOTE、promising、needed evidence）。
 * 普通笔记不标类型：画布上几乎全是笔记，标了等于没标。
 */
const DETAIL_TYPE_LABELS: Record<Language, Partial<Record<Note['type'], string>>> = {
  zh: { drawing: '绘图', attachment: '附件', video: '视频', link: '链接', view: '视图', riseabove: '综合升华', ai_dialogue: 'AI 对话' },
  en: { drawing: 'Drawing', attachment: 'Attachment', video: 'Video', link: 'Link', view: 'View', riseabove: 'Rise Above', ai_dialogue: 'AI dialogue' },
};
const DETAIL_STATUS_LABELS: Record<Language, Record<string, string>> = {
  zh: { promising: '有潜力', authoritative: '权威', needs_work: '待完善', unresolved: '未解决' },
  en: { promising: 'Promising', authoritative: 'Authoritative', needs_work: 'Needs work', unresolved: 'Unresolved' },
};
const LACK_LABELS: Record<Language, Record<string, string>> = {
  zh: { unanswered_question: '待回答的问题', confusion: '困惑', contradiction: '矛盾', needed_evidence: '需要证据', need_to_understand: '需要弄懂' },
  en: { unanswered_question: 'Unanswered question', confusion: 'Confusion', contradiction: 'Contradiction', needed_evidence: 'Needs evidence', need_to_understand: 'Need to understand' },
};

const NO_FOLD_CHOICES: FoldChoices = { collapsed: [], expanded: [] };
const NO_IDS: ReadonlySet<string> = new Set();
/** 停住多久才列出 Build-on：鼠标只是路过不弹；从一张卡挪到另一张时快一点 */
const PEEK_OPEN_MS = 450;
const PEEK_SWITCH_MS = 150;
/** 离开卡片后留一会儿，鼠标来得及挪到列表上 */
const PEEK_CLOSE_MS = 220;

const Workspace: React.FC<WorkspaceProps> = ({ courseId: _courseId, courseTitle: _courseTitle, onExit, userRole, lang, setLang }) => {
  const { user, logout } = useAuth();
  // 本机刚报了「打开过」的笔记要马上摘掉 New；订阅一下，报的时候重渲染
  const seenVersion = useNoteSeenVersion();
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Get courseId from URL params
  const courseId = params.courseId || _courseId;
  // Get courseTitle from location state or props
  const courseTitle = (location.state as any)?.courseTitle || _courseTitle;

  // Update onExit to navigate to dashboard
  const handleExit = useCallback(() => {
    navigate('/dashboard');
  }, [navigate]);

  // ── Space resolution ──────────────────────────────────────────
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [currentSpace, setCurrentSpace] = useState<Space | null>(null);

  /**
   * 当前用户在这门课里的课内身份，后端随小组名单带回。
   * undefined = 请求还在路上；null = 请求回来了但没有（旧版后端不带这个字段，或请求失败）。
   */
  const [courseStanding, setCourseStanding] = useState<CourseRole | null | undefined>(undefined);
  /**
   * 课程教职才有的操作（改删别人的笔记、批注和视图，改别人上传的文档，重算观点图谱，组的管理，
   * 支架管理，成员管理，图灵测试的设置与主持）都看它，不看平台身份
   */
  const viewerIsStaff = isCourseStaff(courseStanding, userRole);

  // 解析当前用户在这门课里属于哪个组。没有分组时侧栏入口给出提示而不是静默失效 ——
  // 「点了没反应」是最难排查的一类问题。
  useEffect(() => {
    setCourseStanding(undefined);
    // 用解析后的 courseId 而不是 _courseId 属性：直接访问 /workspace/:courseId 时
    // 属性是 undefined，真实值只在 URL 参数里。用错会让 effect 直接返回，
    // 学生永远看到「还没有分组」。
    if (!courseId || !user?.id) { setMyGroup(null); return; }
    let alive = true;
    (async () => {
      try {
        const { groups: list, viewerStanding } = await groupsApi.listForCourse(courseId);
        if (!alive) return;
        setCourseStanding(viewerStanding ?? null);
        const pick = ideaGraphGroup(list, user.id, isCourseStaff(viewerStanding, userRole));
        setMyGroup(pick ? { id: pick.id, name: pick.name } : null);
      } catch {
        if (alive) {
          setCourseStanding(null);
          setMyGroup(null);
        }
      }
    })();
    return () => { alive = false; };
  }, [courseId, user?.id, userRole]);

  /** 这门课一个空间都没有（值是那门课的 id）。要不要替它建默认空间，见下一个 effect。 */
  const [spacelessCourseId, setSpacelessCourseId] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId || courseId === 'default') return;
    setSpacelessCourseId(null);
    coursesApi.listSpaces(courseId)
      .then(({ spaces }) => {
        if (spaces.length > 0) {
          setCurrentSpace(spaces[0]);
          setSpaceId(spaces[0].id);
        } else {
          setSpacelessCourseId(courseId);
        }
      })
      .catch(() => {
        // API unavailable — operate in local-only mode (spaceId stays null)
      });
  }, [courseId]);

  // 替没有空间的课建默认空间。后端只让创建者和平台管理员建（课程管理员也不行），
  // 所以等课内身份回来再定：教师账号在这门课里可能只是普通成员，照平台身份先建就是一个 403。
  useEffect(() => {
    if (!courseId || spacelessCourseId !== courseId || courseStanding === undefined) return;
    if (!canCreateCourseSpace(courseStanding, userRole)) return;
    setSpacelessCourseId(null);
    coursesApi.createSpace(courseId, {
      title: '主讨论空间',
      description: 'Main inquiry space',
      inquiry_question: lang === 'zh'
        ? '我们共同讨论的问题'
        : 'What real problem are we trying to explain together?',
    })
      .then(({ space }) => {
        setCurrentSpace(space);
        setSpaceId(space.id);
      })
      .catch(() => {
        // 同上：建不成就留在本地模式
      });
  }, [courseId, spacelessCourseId, courseStanding, userRole, lang]);

  // ── Data from backend ─────────────────────────────────────────
  const {
    notes, setNotes,
    edges, setEdges,
    loading: spaceLoading,
    loadedSpaceId,
    refetch: refetchSpace,
    markGeometryPending,
    clearGeometryPending,
  } = useSpaceData(spaceId);

  const [activeTool, setActiveTool] = useState<string>('');
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // ── 笔记是独立页面 ──────────────────────────────────────────
  // /workspace/:courseId/note/:noteId 有自己的地址：可以直接分享、浏览器后退能回画布。
  // 状态仍是「哪条笔记开着」的准，地址只是镜像；两个 effect 各自先比对再动手，所以不会互相触发。
  const workspaceBasePath = `/workspace/${courseId}`;
  /** 上面那个 effect 已经消化过的地址，避免两个 effect 互相把对方的动作撤销 */
  const lastPathRef = useRef<string | null>(null);
  /** 当前地址的镜像。下面「状态 → 地址」那个 effect 要读地址但不能把它当依赖：
   *  否则地址一变它就跑一遍，而那一轮里状态还是旧的，会把刚发生的后退又推回去。 */
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  /** 「地址 → 状态」刚刚改过状态。下面那个 effect 在同一轮里读到的还是旧状态，
   *  这时它算出来的目标地址是错的，必须跳过这一轮。 */
  const justAdoptedRef = useRef(false);
  const routeNoteId = useMemo(() => {
    const rest = (params['*'] ?? '').replace(/^\/+|\/+$/g, '');
    const match = rest.match(/^note\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [params]);

  /** 综合升华讨论室也是独立页面：/workspace/:courseId/riseabove/:roomId */
  const routeRiseAboveId = useMemo(() => {
    const rest = (params['*'] ?? '').replace(/^\/+|\/+$/g, '');
    const match = rest.match(/^riseabove\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [params]);
  
  // View Management State
  // 主画布在顶栏和视图列表里就叫 Welcome（2026-10-09 用户：视图后面默认写 Welcome，不写别的）
  const [views, setViews] = useState<ViewDefinition[]>(INITIAL_VIEWS);
  /** 视图列表是哪个空间的。没回来之前，指向别的视图的笔记会暂时落在主画布上 */
  const [viewsLoadedFor, setViewsLoadedFor] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string>('view-welcome');
  const [isViewPanelOpen, setIsViewPanelOpen] = useState(false);
  /** 卡片 = 某个视图在某块画布上的一个落点。一个视图可以有任意多张，散在各处。 */
  const [viewCards, setViewCards] = useState<ApiViewCard[]>([]);

  // Drawing State
  const [isDrawingOpen, setIsDrawingOpen] = useState(false);
  const [drawingToEdit, setDrawingToEdit] = useState<Note | null>(null);
  const [dialogueNote, setDialogueNote] = useState<Note | null>(null);
  /** 从对话里选出、准备发布成一条新笔记的内容 */
  const [dialogueDraft, setDialogueDraft] = useState<string | null>(null);

  // Canvas shapes (ProcessOn-style regions drawn directly on the space)
  const [shapes, setShapes] = useState<ApiShape[]>([]);
  const [shapeToolbarOpen, setShapeToolbarOpen] = useState(false);
  const [shapeTool, setShapeTool] = useState<ShapeType | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  /** 新图形的默认样式；选中图形时样式面板改的是那个图形本身。 */
  const [shapeStyle, setShapeStyle] = useState<ShapeStyleValue>({
    fill: '#e0e7ff',
    stroke: '#4338ca',
    strokeWidth: 2,
    fontSize: 15,
    fontWeight: 600,
    textAlign: 'center',
    textValign: 'middle',
    textColor: '',
  });
  
  // Rise Above State — canvas-native with inline note picker
  const [riseAboveCitedIds, setRiseAboveCitedIds] = useState<string[]>([]);
  const [showRiseAbovePicker, setShowRiseAbovePicker] = useState(false);
  const [riseAbovePickerSelected, setRiseAbovePickerSelected] = useState<Set<string>>(new Set());

  // Scaffold State
  const [scaffolds, setScaffolds] = useState<Scaffold[]>([]);
  const [isScaffoldModalOpen, setIsScaffoldModalOpen] = useState(false);
  const [activeScaffold, setActiveScaffold] = useState<Scaffold | null>(null);

  useEffect(() => {
    if (!courseId || courseId === 'default') return;
    scaffoldsApi.list(courseId)
      .then(({ scaffolds: loaded, requireScaffold: required, scaffoldExempt: exempt }) => {
        if (loaded.length > 0) {
          setScaffolds(loaded.map(apiScaffoldToScaffold));
        }
        setRequireScaffold(required === true);
        setScaffoldExempt(exempt === true);
      })
      .catch(() => {
        setScaffolds([]);
      });
  }, [courseId]);

  // Member Management State
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);

  // Group Management State
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);

  // AI Side Panel + Workspace Agent State
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [isWorkspaceAgentOpen, setIsWorkspaceAgentOpen] = useState(false);
  const [wsAgentConfigs, setWsAgentConfigs] = useState<ApiAIConfig[]>([]);

  // Inquiry Panel State
  const [isInquiryPanelOpen, setIsInquiryPanelOpen] = useState(false);

  // Notification State — loaded from backend, falls back to empty
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    notificationsApi.list()
      .then(({ notifications: loaded }) => {
        // Map backend shape to frontend Notification type
        setNotifications(loaded.map(n => ({
          id: n.id,
          userId: n.user_id,
          type: n.type,
          title: n.title,
          message: n.message,
          read: n.read,
          createdAt: n.created_at,
          link: n.link_type && n.link_id
            ? { type: n.link_type as 'note' | 'group' | 'view', id: n.link_id }
            : undefined,
        })));
      })
      .catch(() => {
        // Backend unavailable — silently stay empty
      });
  }, []);

  // Fetch workspace agent AI configs when panel opens
  useEffect(() => {
    if (isWorkspaceAgentOpen && courseId && wsAgentConfigs.length === 0) {
      workspaceAgentApi.getConfigs(courseId)
        .then(({ aiConfigs }) => setWsAgentConfigs(aiConfigs))
        .catch(() => {});
    }
  }, [isWorkspaceAgentOpen, courseId, wsAgentConfigs.length]);

  // File Viewer State
  const [viewingFile, setViewingFile] = useState<Note | null>(null);
  const [collabDocument, setCollabDocument] = useState<Note | null>(null);
  const [collabCreateOpen, setCollabCreateOpen] = useState(false);
  const [collabTitle, setCollabTitle] = useState('');
  const [collabCreating, setCollabCreating] = useState(false);
  const [collabCreateError, setCollabCreateError] = useState('');
  const collabAdapter = useMemo(() => collabDocument ? collaborativeDocuments.adapter(collabDocument.id) : null, [collabDocument?.id]);
  /** 从笔记 AI 的来源卡片打开时要跳到的页；阅读页一关就清掉，画布上双击打开的从第一页看 */
  const [viewingFilePage, setViewingFilePage] = useState<number | null>(null);
  useEffect(() => {
    if (!viewingFile) setViewingFilePage(null);
  }, [viewingFile]);
  /** 从文档查看器带去知识空间 AI 助手的文档，助手打开后挂到它的输入框上 */
  const [assistantAttachment, setAssistantAttachment] =
    useState<{ file_url: string; file_name: string; mime_type: string; text?: string } | null>(null);
  
  // Attachment Modal State
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false);

  // Analytics Modal State
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  /**
   * 右侧详情栏晚一点出来：选中后等过一次双击的间隔。详情栏一选中就出现的话，
   * 画布右边的卡片会被它盖住，双击的第二下点在详情栏上，笔记打不开。
   */
  const [detailNoteId, setDetailNoteId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedNoteId) { setDetailNoteId(null); return; }
    const timer = window.setTimeout(() => setDetailNoteId(selectedNoteId), 280);
    return () => window.clearTimeout(timer);
  }, [selectedNoteId]);
  // Multi-select state — Shift+click to add/remove; cleared on plain canvas click
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  // (riseAboveInitialIds removed — replaced by riseAboveCitedIds above)
  /**
   * 工具栏默认展开。图标本身不解释自己 —— 学生第一次进来，
   * 一列没有文字的方块看不出哪个是「新建想法」哪个是「上传附件」。
   * 谁主动收起来就记住谁的选择，别每次进来又给他掰开。
   */
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(saved) && saved >= SIDEBAR_MIN_W && saved <= SIDEBAR_MAX_W) return saved;
    } catch { /* 隐私模式下读不到，用默认值就行 */ }
    return sidebarDefaultWidth(lang);
  });
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); } catch { /* 同上 */ }
  }, [sidebarWidth]);
  // 观点图谱：学生看自己所在的组，教师看当前课程的第一个组（教师另可在小组管理里逐组查看）
  const [riseAboveRoomId, setRiseAboveRoomId] = useState<string | null>(null);
  /** 本空间的讨论室。用来「继续之前的讨论」，以及从已发布的笔记回溯到当初那场讨论。 */
  const [riseAboveRooms, setRiseAboveRooms] = useState<Array<{
    id: string; source_note_ids: string[]; title: string | null;
    status: string; published_note_id: string | null; created_at: string;
  }>>([]);
  const [ideaGraphOpen, setIdeaGraphOpen] = useState(false);
  const [buildOnNetOpen, setBuildOnNetOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineFocus, setTimelineFocus] = useState<string|null>(null);
  const [networkFocus, setNetworkFocus] = useState<string|null>(null);
  const [networkSpace, setNetworkSpace] = useState<string|null>(null);
  const [pendingTimelineNote, setPendingTimelineNote] = useState<{note:Note;spaceId:string;observedLoading:boolean}|null>(null);
  const [myGroup, setMyGroup] = useState<{ id: string; name: string } | null>(null);
  // 告诉右边缘的「使用帮助」学生此刻在哪：阅读页和讨论室不改地址，它自己看不出来
  useReportHelpContext({
    courseId: courseId ?? null,
    surface: viewingFile ? 'document'
      : (isCreatingNew || editingNote) ? 'note-editor'
        : riseAboveRoomId ? 'discussion-room' : 'canvas',
    spaceId,
    viewId: activeViewId,
    groupId: myGroup?.id ?? null,
    noteId: viewingFile?.id ?? editingNote?.id ?? null,
  });
  const [isKnowledgePanelOpen, setIsKnowledgePanelOpen] = useState(false);

  /**
   * Build-on 分支的收起/展开（2026-10-09，规则在 buildOnCollapse.ts）。
   * 学生自己点过的存在本机，每人每个空间一份；换了空间就按新空间的键读。
   */
  const foldKey = spaceId ? foldStorageKey(user?.id, spaceId) : null;
  const [foldStore, setFoldStore] = useState<{ key: string | null; choices: FoldChoices }>({ key: null, choices: NO_FOLD_CHOICES });
  const foldChoices = useMemo(
    () => (foldStore.key === foldKey ? foldStore.choices : (foldKey ? readFoldChoices(foldKey) : NO_FOLD_CHOICES)),
    [foldStore, foldKey],
  );
  const foldKeyRef = useRef(foldKey);
  foldKeyRef.current = foldKey;
  const updateFoldChoices = useCallback((change: (current: FoldChoices) => FoldChoices) => {
    const key = foldKeyRef.current;
    if (!key) return;
    setFoldStore(prev => {
      const current = prev.key === key ? prev.choices : readFoldChoices(key);
      const next = change(current);
      if (next === current && prev.key === key) return prev;
      saveFoldChoices(key, next);
      return { key, choices: next };
    });
  }, []);
  /** 刚写的、刚连上的 Build-on 要看得见：把它接上的那条笔记展开 */
  const openFold = useCallback((id: string) => {
    updateFoldChoices(c => (c.expanded.includes(id) && !c.collapsed.includes(id)
      ? c
      : { collapsed: c.collapsed.filter(x => x !== id), expanded: [...c.expanded.filter(x => x !== id), id] }));
  }, [updateFoldChoices]);

  /** 鼠标停在有 Build-on 的卡片上，旁边列出建立在它上面的笔记（BuildOnPeek） */
  const [peekNoteId, setPeekNoteId] = useState<string | null>(null);
  const peekNoteIdRef = useRef<string | null>(null);
  peekNoteIdRef.current = peekNoteId;
  const peekOpenTimerRef = useRef(0);
  const peekCloseTimerRef = useRef(0);
  const closePeekNow = useCallback(() => {
    window.clearTimeout(peekOpenTimerRef.current);
    window.clearTimeout(peekCloseTimerRef.current);
    setPeekNoteId(null);
  }, []);
  const keepPeekOpen = useCallback(() => window.clearTimeout(peekCloseTimerRef.current), []);
  const releasePeek = useCallback(() => {
    window.clearTimeout(peekCloseTimerRef.current);
    peekCloseTimerRef.current = window.setTimeout(() => setPeekNoteId(null), PEEK_CLOSE_MS);
  }, []);
  useEffect(() => () => {
    window.clearTimeout(peekOpenTimerRef.current);
    window.clearTimeout(peekCloseTimerRef.current);
  }, []);
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; noteId: string; type: string; } | null>(null);
  const [buildOnParentId, setBuildOnParentId] = useState<string | null>(null);
  const [buildOnRelationType, setBuildOnRelationType] = useState<RelationType>('extend');
  const [showBuildOnComposer, setShowBuildOnComposer] = useState(false);
  /**
   * 多选两条后点「关联」：Build-on 的那一方。有值时类型选择器只在这两条已有笔记之间连线，
   * 不开新笔记；buildOnParentId 是被建构的那一方。
   */
  const [buildOnLinkSourceId, setBuildOnLinkSourceId] = useState<string | null>(null);
  const [linkingNotes, setLinkingNotes] = useState(false);

  /**
   * 编辑器每开一次（开新笔记、换一条笔记、关掉）换一个号。草稿自动保存是异步的，
   * 回来时编辑器可能已经关了、甚至开着另一条，那时不能再把这条草稿塞回编辑器。
   */
  const editorSessionRef = useRef(0);
  /** 正在自动保存的草稿。同一次编辑只落库一次，重复调用拿到的是同一个结果。 */
  const draftPersistRef = useRef<{ session: number; promise: Promise<string | null> } | null>(null);

  /** Build-on 意图作废：父笔记清空，关系类型回到默认的「延伸」。 */
  const clearBuildOn = useCallback(() => {
    setBuildOnParentId(null);
    setBuildOnRelationType('extend');
    setBuildOnLinkSourceId(null);
  }, []);

  /**
   * 开一条新笔记。Build-on 意图只能在这里随新笔记一起给出，不给就是普通新笔记。
   * 以前各个入口只把 isCreatingNew 置真，上一次没用掉的父笔记会被带进来——
   * 从支架库、从对话「发布为新笔记」开出来的笔记就这样接到了一条无关的笔记上。
   */
  const startNewNote = useCallback((buildOn: BuildOnIntent | null = null) => {
    editorSessionRef.current += 1;
    setBuildOnParentId(buildOn?.parentId ?? null);
    setBuildOnRelationType(buildOn?.relationType ?? 'extend');
    setEditingNote(null);
    setIsCreatingNew(true);
  }, []);

  /** 关掉笔记编辑器。贡献与否都一样：这一次的 Build-on 意图和各种预填内容随之作废。 */
  const closeNoteEditor = useCallback(() => {
    editorSessionRef.current += 1;
    setIsCreatingNew(false);
    setEditingNote(null);
    setActiveTool('');
    setActiveScaffold(null);
    setRiseAboveCitedIds([]);
    setDialogueDraft(null);
    clearBuildOn();
  }, [clearBuildOn]);
  /**
   * 进入课程时的缩放。原来按内容「全部装进屏幕」来算，一块几十条笔记的画布会被
   * 压到 30%，卡片上的字根本读不了；空画布又是 100%，两种情形差太远。
   * 现在锚定在 60%：内容多时最多缩到 55%，内容少也不放大过 60%，
   * 学生每次进来看到的密度大致一样。
   */
  const DEFAULT_ZOOM = 0.6;
  const MIN_FIT_ZOOM = 0.55;
  const HOME_VIEWPORT = { x: -1500 * DEFAULT_ZOOM, y: -800 * DEFAULT_ZOOM, zoom: DEFAULT_ZOOM };
  const [viewPort, setViewPort] = useState(HOME_VIEWPORT);
  /** 教师是否要求本课程笔记必须带支架；随支架列表一起从后端拿到 */
  const [requireScaffold, setRequireScaffold] = useState(false);
  /** 这条规定管不管当前用户：开课教师、课程管理员、平台管理员不受限，由后端按课内身份算 */
  const [scaffoldExempt, setScaffoldExempt] = useState(false);
  
  const [dragMode, setDragMode] = useState<'none' | 'pan' | 'note' | 'noteResize' | 'scrollX' | 'scrollY'>('none');
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const dragModeRef = useRef(dragMode);
  dragModeRef.current = dragMode;
  const [initialViewPort, setInitialViewPort] = useState({ x: 0, y: 0 }); 
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const workspaceMotionRef = useRef<HTMLDivElement>(null);
  const scrollTrackXRef = useRef<HTMLDivElement>(null);
  const scrollTrackYRef = useRef<HTMLDivElement>(null);
  /** Tracks the final canvas position of the note being dragged so we can persist it on mouse-up. */
  const draggedNotePositionRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * 拖动过程中的瞬时量一律走 ref，不进 state。
   * 之前 dragStart 是 state 且写在 mousemove 里，而拖动的 effect 又依赖它 ——
   * 于是每动一下鼠标就把 window 监听器拆掉重装一次，卡顿的大头在这里。
   * 位置更新再用 rAF 合帧，一帧最多一次 setState。
   */
  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const pendingDeltaRef = useRef({ dx: 0, dy: 0 });
  const dragRafRef = useRef<number | null>(null);
  const draggingNoteIdRef = useRef<string | null>(null);
  /** 这次按下之后鼠标是否真的动过 —— 只是点一下选中，不该写一次库。 */
  const dragMovedRef = useRef(false);
  /** 世界坐标原点元素，用来把屏幕坐标换算成画布坐标。 */
  const worldOriginRef = useRef<HTMLDivElement>(null);
  /**
   * 按下时鼠标相对卡片左上角的偏移（世界坐标），以及那一刻的原点位置。
   *
   * 位置由「当前鼠标 − 这个偏移」直接算出，而不是把每次 mousemove 的增量累加。
   * 累加法只要漏掉一个事件（快速拖动、指针划出窗口、掉帧）就永远差那么一截，
   * 表现出来就是卡片跟不上光标、松手后停在别处 —— 也就是「漂移」。
   * 绝对法每一帧都自我校正，拖到哪里就停在哪里。
   */
  const grabOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const worldRectRef = useRef<{ left: number; top: number } | null>(null);
  /** 拖动开始前的几何，保存失败时回滚用。 */
  const dragOriginRef = useRef<NoteGeometry | null>(null);
  /** 同一个失败原因只提示一次，避免连续拖几张卡弹一串一样的提示。 */
  const geometryErrorShownRef = useRef<string | null>(null);
  /** 调整卡片大小时的当前尺寸，与位置同理由 ref 持有以便同步落库。 */
  const resizedNoteSizeRef = useRef<{ width: number; height: number } | null>(null);
  const viewPortRef = useRef(viewPort);
  const initialViewPortRef = useRef(initialViewPort);
  const contentBoundsRef = useRef({ width: 1, height: 1 });
  const hasAutoFittedRef = useRef(false);
  

  /**
   * Frame the viewport on a set of canvas items. Switching views must land on
   * the notes, not on some arbitrary corner of an infinite canvas — otherwise
   * students open a view and see nothing but grid.
   */
  const fitViewportTo = useCallback((
    items: { x: number; y: number; width?: number; height?: number }[],
  ) => {
    const positioned = items.filter(n => n.x !== 0 || n.y !== 0);
    if (positioned.length === 0) {
      setViewPort(HOME_VIEWPORT);
      return;
    }

    const NOTE_W = 240;
    const NOTE_H = 160;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of positioned) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + (n.width || NOTE_W) > maxX) maxX = n.x + (n.width || NOTE_W);
      if (n.y + (n.height || NOTE_H) > maxY) maxY = n.y + (n.height || NOTE_H);
    }

    const PADDING = 80;
    minX -= PADDING; minY -= PADDING; maxX += PADDING; maxY += PADDING;

    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const centerX = minX + bboxW / 2;
    const centerY = minY + bboxH / 2;

    const vw = window.innerWidth - 54;
    const vh = window.innerHeight - 40 - 38;
    const zoom = Math.min(Math.max(Math.min(vw / bboxW, vh / bboxH), MIN_FIT_ZOOM), DEFAULT_ZOOM);

    setViewPort({ x: -centerX * zoom + vw / 2, y: -centerY * zoom + vh / 2, zoom });
  }, []);

  // --- Auto-center viewport on notes when they first load ---
  useEffect(() => {
    if (hasAutoFittedRef.current) return;
    const positionedNotes = notes.filter(n => n.type !== 'view' && (n.x !== 0 || n.y !== 0));
    if (positionedNotes.length === 0) return;
    hasAutoFittedRef.current = true;
    fitViewportTo(positionedNotes);
  }, [notes, fitViewportTo]);

  const activeView = views.find(v => v.id === activeViewId) || views[0];

  /**
   * 笔记按 note.views 归属画布 —— 就这一条规则。
   *
   * 这里原来还有一条筛选分支：View 只要带任何 filter，归属判断就整个被跳过，
   * 改成全空间按条件匹配。于是这块画布会冒出别处的笔记，而你在它里面新建的
   * 笔记反而消失。筛选功能已随面板一起去掉。
   */
  const visibleNotes = useMemo(() => {
    if (!views.some(v => v.id === activeViewId)) return [];

    return notes.filter(note => {
      if (note.views?.includes(activeViewId)) return true;
      if (activeViewId !== WELCOME_VIEW_ID) return false;
      // 没有归属、或指向一个已经不存在的视图的笔记，否则会永久隐形 ——
      // 主画布是它们的兜底去处。
      if (!note.views || note.views.length === 0) return true;
      return !note.views.some(v => views.some(def => def.id === v));
    });
  }, [notes, activeViewId, views]);

  const contentBounds = useMemo(() => getContentBounds(visibleNotes), [visibleNotes]);

  /**
   * id → 笔记。连线层原来对每条连线各做两次 visibleNotes.find()，
   * 也就是 O(连线数 × 笔记数)，而这段在拖动时每帧都要重跑 ——
   * 一块 120 张卡、200 条连线的画布，每帧要扫近五万次数组。
   */
  const visibleNoteById = useMemo(
    () => new Map(visibleNotes.map(n => [n.id, n])),
    [visibleNotes],
  );

  // 被 Build-on 最多的笔记，卡片左上角一团火（口径见 hotBuildOnCounts）
  const hotBuildOnCountMap = useMemo(() => hotBuildOnCounts(edges), [edges]);

  // ── Build-on 分支的收起 ─────────────────────────────────────────────
  // 图只看笔记 id 和连线：拖动时 visibleNotes 每帧换新，不能每帧重建。
  // AI 建议、还没被采纳的连线不算「建立在它上面」：没有人真的接着写。
  const visibleIdsKey = useMemo(() => visibleNotes.map(n => n.id).join('\n'), [visibleNotes]);
  const foldGraph = useMemo(
    () => buildFoldGraph(
      visibleIdsKey ? visibleIdsKey.split('\n') : [],
      edges.filter(e => !(e.aiSuggested && !e.aiAccepted)),
    ),
    [visibleIdsKey, edges],
  );
  /**
   * 默认收起哪些（旧的细枝末节）。我写的、我还没看过的（New）、被 Build-on 最多的（火）所在的分支不收。
   * 签名里只放 id、时间和「要不要保护」，拖动时不变，autoFoldIds 不会每帧重算。
   */
  const foldProtectSig = useMemo(
    () => visibleNotes
      .map(n => `${n.id}|${n.createdAt ?? ''}|${isOwnNote(n, user?.id) || isNoteNew(n, user?.id) || hotBuildOnCountMap.has(n.id) ? 1 : 0}`)
      .join('\n'),
    // seenVersion：本机刚看过一条，它就不再是 New
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleNotes, user?.id, hotBuildOnCountMap, seenVersion],
  );
  const qualifiedAutoFolds = useMemo(() => autoFoldIds(
    foldProtectSig
      ? foldProtectSig.split('\n').map(line => {
        const [id, createdAt, protect] = line.split('|');
        return { id, createdAt: createdAt || undefined, protect: protect === '1' };
      })
      : [],
    foldGraph,
  ), [foldProtectSig, foldGraph]);
  /**
   * 进入一个视图、这个空间的笔记和视图都到齐时定一次，之后只会变少（分支里来了新笔记就不再默认收着）、
   * 不会变多：学生看着看着，卡片不会自己藏起来。
   */
  const autoFoldKey = !spaceLoading && spaceId && loadedSpaceId === spaceId && viewsLoadedFor === spaceId
    ? `${spaceId}:${activeViewId}`
    : null;
  const frozenAutoFoldsRef = useRef<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const autoFolds = useMemo<ReadonlySet<string>>(() => {
    if (!autoFoldKey) return NO_IDS;
    const frozen = frozenAutoFoldsRef.current;
    if (frozen?.key === autoFoldKey) {
      const kept = [...frozen.ids].filter(id => qualifiedAutoFolds.has(id));
      if (kept.length === frozen.ids.size) return frozen.ids;
      frozenAutoFoldsRef.current = { key: autoFoldKey, ids: new Set(kept) };
    } else {
      frozenAutoFoldsRef.current = { key: autoFoldKey, ids: new Set(qualifiedAutoFolds) };
    }
    return frozenAutoFoldsRef.current.ids;
  }, [autoFoldKey, qualifiedAutoFolds]);
  const foldedIds = useMemo(() => effectiveFolds(autoFolds, foldChoices), [autoFolds, foldChoices]);
  const foldHidden = useMemo(() => hiddenByFolds(foldGraph, foldedIds), [foldGraph, foldedIds]);
  const newNoteKey = useMemo(
    () => visibleNotes.filter(n => isNoteNew(n, user?.id)).map(n => n.id).join('\n'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleNotes, user?.id, seenVersion],
  );
  /** 卡片下沿开关用的摘要。拖动时不变，卡片的 memo 才拦得住 */
  const foldMap = useMemo(() => {
    const fresh = new Set(newNoteKey ? newNoteKey.split('\n') : []);
    return foldSummaries(foldGraph, foldedIds, foldHidden, id => fresh.has(id));
  }, [foldGraph, foldedIds, foldHidden, newNoteKey]);
  /** 回调里读最新的，回调本身保持不变 */
  const foldRef = useRef<{ graph: FoldGraph; auto: ReadonlySet<string>; folded: ReadonlySet<string>; hidden: ReadonlySet<string> }>({
    graph: foldGraph, auto: autoFolds, folded: foldedIds, hidden: foldHidden,
  });
  foldRef.current = { graph: foldGraph, auto: autoFolds, folded: foldedIds, hidden: foldHidden };
  const foldTotals = useMemo(() => {
    let branches = 0;
    for (const sum of foldMap.values()) if (sum.collapsed && sum.hiddenCount > 0) branches += 1;
    return { branches, notes: foldHidden.size };
  }, [foldMap, foldHidden]);

  /** 要看的笔记藏在收起的分支里：沿路把挡着的收起打开（搜索、我的笔记、讨论主题、各处的「定位」） */
  const revealNotes = useCallback((ids: readonly string[]) => {
    const { graph, auto, hidden } = foldRef.current;
    if (!ids.some(id => hidden.has(id))) return;
    updateFoldChoices(current => {
      let next = current;
      for (const id of ids) {
        const folded = effectiveFolds(auto, next);
        next = revealChoices(graph, next, folded, hiddenByFolds(graph, folded), id);
      }
      return next;
    });
  }, [updateFoldChoices]);

  const handleToggleFold = useCallback((note: Note) => {
    const collapsed = foldRef.current.folded.has(note.id);
    updateFoldChoices(c => toggleFold(c, note.id, collapsed));
    if (spaceId && UUID_RE.test(note.id)) {
      trackEvent({
        event_type: collapsed ? 'buildon_branch_expanded' : 'buildon_branch_folded',
        object_type: 'note',
        object_id: note.id,
        space_id: spaceId,
        metadata_json: { child_count: foldRef.current.graph.children.get(note.id)?.length ?? 0, view_id: activeViewId },
      });
    }
  }, [updateFoldChoices, spaceId, activeViewId]);

  const expandAllFolds = useCallback(() => {
    const { auto, folded } = foldRef.current;
    updateFoldChoices(c => ({ collapsed: [], expanded: Array.from(new Set([...c.expanded, ...auto, ...folded])) }));
    if (spaceId) {
      trackEvent({
        event_type: 'buildon_branches_expanded_all',
        object_type: 'space',
        object_id: spaceId,
        space_id: spaceId,
        metadata_json: { folded_count: folded.size, view_id: activeViewId },
      });
    }
  }, [updateFoldChoices, spaceId, activeViewId]);

  const handleNoteHover = useCallback((note: Note, hovering: boolean) => {
    window.clearTimeout(peekOpenTimerRef.current);
    if (!hovering) {
      releasePeek();
      return;
    }
    if (dragModeRef.current !== 'none' || !foldRef.current.graph.children.get(note.id)?.length) return;
    window.clearTimeout(peekCloseTimerRef.current);
    if (peekNoteIdRef.current === note.id) return;
    peekOpenTimerRef.current = window.setTimeout(() => {
      if (dragModeRef.current === 'none') setPeekNoteId(note.id);
    }, peekNoteIdRef.current ? PEEK_SWITCH_MS : PEEK_OPEN_MS);
  }, [releasePeek]);

  /** 「这个视图有几条 Build-on」只数两头都在这个视图里的，和画布上的连线对得上 */
  const viewEdgeCount = useMemo(() => {
    const here = new Set(visibleIdsKey ? visibleIdsKey.split('\n') : []);
    return edges.filter(e => here.has(e.source) && here.has(e.target)).length;
  }, [edges, visibleIdsKey]);

  // Per-note move-type counts derived from edges (for NoteItem dots)
  const moveCountsMap = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const edge of edges) {
      if (!edge.target) continue;
      const rt = edge.relationType ?? 'extend';
      if (!m.has(edge.target)) m.set(edge.target, {});
      const counts = m.get(edge.target)!;
      counts[rt] = (counts[rt] ?? 0) + 1;
    }
    return m;
  }, [edges]);

  // Synthesis depth for Rise Above notes (1 = cites only regular notes, 2+ = cites other Rise Aboves)
  // 这段是 O(n²)（每个 riseabove 递归里都要 notes.find），而它只依赖引用关系，
  // 与坐标无关。拖动时 notes 每帧换新会白跑一遍，直接沿用上一次的结果。
  const synthesisDepthCacheRef = useRef<Map<string, number>>(new Map());
  const synthesisDepthMap = useMemo(() => {
    if (dragMode === 'note') return synthesisDepthCacheRef.current;
    const m = new Map<string, number>();
    const raNotes = notes.filter(n => n.type === 'riseabove');
    const getDepth = (noteId: string, visited: Set<string>): number => {
      if (visited.has(noteId)) return 1;
      visited.add(noteId);
      const n = notes.find(x => x.id === noteId);
      if (!n || n.type !== 'riseabove') return 0;
      const citedDepths = (n.citedNoteIds ?? []).map(cid => getDepth(cid, visited));
      return Math.max(0, ...citedDepths) + 1;
    };
    for (const ra of raNotes) {
      m.set(ra.id, getDepth(ra.id, new Set()));
    }
    synthesisDepthCacheRef.current = m;
    return m;
  }, [notes, dragMode]);

  const actionCandidates = useMemo(() => {
    const unresolvedLackNotes = visibleNotes.filter(note =>
      note.knowledgeLacks?.some(lack => !lack.resolvedAt),
    );
    const evidenceGapNotes = visibleNotes.filter(note => {
      const explicitGap = note.knowledgeLacks?.some(lack => !lack.resolvedAt && lack.type === 'needed_evidence');
      const metricGap = (note.metrics?.challengeCount ?? 0) > (note.metrics?.evidenceCount ?? 0);
      const moveCounts = moveCountsMap.get(note.id);
      const relationGap = (moveCounts?.challenge ?? 0) > (moveCounts?.evidence ?? 0);
      return explicitGap || metricGap || relationGap;
    });
    const promisingNotes = visibleNotes
      .filter(note => note.epistemicStatus === 'promising' || Boolean(note.promisingReason))
      .sort((a, b) => (b.metrics?.heatScore ?? 0) - (a.metrics?.heatScore ?? 0));
    const synthesisCandidates = visibleNotes.filter(note => {
      const moveCounts = moveCountsMap.get(note.id);
      const tensionCount = (moveCounts?.challenge ?? 0) + (moveCounts?.question ?? 0) + (moveCounts?.evidence ?? 0);
      return tensionCount >= 2 && (moveCounts?.synthesize ?? 0) === 0;
    });

    return {
      unresolvedLackNotes,
      evidenceGapNotes,
      promisingNotes,
      synthesisCandidates,
      firstGap: evidenceGapNotes[0] ?? unresolvedLackNotes[0],
      firstPromising: promisingNotes[0],
      firstSynthesis: synthesisCandidates[0],
    };
  }, [moveCountsMap, visibleNotes]);

  useGSAP(() => {
    // The canvas container itself is never animated: fading a wrapper that
    // holds the entire workspace means any interrupted tween blanks the app.
    // Only the individual note cards get an entrance.
    const MOTION_TARGETS = '.gsap-workspace-shell, .gsap-workspace-toolbar, .gsap-note-item';
    const reveal = () => gsap.set(MOTION_TARGETS, { clearProps: 'opacity,visibility,willChange' });

    reveal();
    if (shouldReduceMotion() || spaceLoading) return reveal;

    prepareForMotion('.gsap-note-item');
    const tl = gsap.timeline({
      defaults: { ease: 'power3.out' },
      onComplete: reveal,
      onInterrupt: reveal,
    });
    // fromTo (not from) so the end state is explicit: even an interrupted tween
    // lands on autoAlpha:1 rather than inheriting a hidden current value.
    tl.fromTo('.gsap-note-item', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.32, stagger: { each: 0.018, from: 'center' } });

    return reveal;
  }, {
    scope: workspaceMotionRef,
    dependencies: [spaceLoading, activeViewId],
    revertOnUpdate: true,
  });
  
  // 让 rAF 回调总能读到最新的视口/边界，而不必把它们写进 effect 依赖。
  viewPortRef.current = viewPort;
  initialViewPortRef.current = initialViewPort;
  contentBoundsRef.current = contentBounds;

  /**
   * 保存卡片的位置/尺寸。
   *
   * 三件事一起做，缺一个就会出现「拖到 B、过一会自己跳回 A」：
   *  1. 标记为待确认 —— 服务器回显之前，后台重拉不许覆盖本地坐标；
   *  2. 失败时**回滚到拖动前的位置**，而不是让卡片停在一个根本没存下的地方；
   *  3. 把失败原因告诉用户。以前这里是 `.catch(console.error)`，
   *     于是没有权限移动别人的笔记时，卡片莫名其妙弹回去，谁也不知道为什么。
   */
  const saveNoteGeometry = useCallback((
    noteId: string,
    geom: NoteGeometry,
    origin: NoteGeometry | null,
  ) => {
    if (!spaceId || !UUID_RE.test(noteId)) return;
    markGeometryPending(noteId, geom);
    const size = geom.width !== undefined && geom.height !== undefined
      ? { width: geom.width, height: geom.height }
      : undefined;

    notesApi.updatePosition(noteId, geom.x, geom.y, size).catch((err: unknown) => {
      clearGeometryPending(noteId);
      if (origin) {
        setNotes(prev => prev.map(n => (n.id === noteId
          ? { ...n, x: origin.x, y: origin.y, ...(origin.width !== undefined ? { width: origin.width, height: origin.height } : null) }
          : n)));
      }
      const forbidden = err instanceof ApiClientError && err.status === 403;
      const message = forbidden
        ? (lang === 'zh'
          ? '这条笔记不是你创建的，只有作者和教师可以移动它。'
          : 'Only the author or a teacher can move this note.')
        : (lang === 'zh'
          ? `位置没有保存到服务器${err instanceof Error && err.message ? `：${err.message}` : '，请稍后重试。'}`
          : `Position was not saved${err instanceof Error && err.message ? `: ${err.message}` : '. Please try again.'}`);
      if (geometryErrorShownRef.current !== message) {
        geometryErrorShownRef.current = message;
        window.setTimeout(() => { geometryErrorShownRef.current = null; }, 5000);
        window.alert(message);
      }
      console.error('Failed to save note geometry:', err);
    });
  }, [spaceId, lang, markGeometryPending, clearGeometryPending, setNotes]);

  // --- Global Drag Handlers ---
  useEffect(() => {
    if (dragMode === 'none') return;

    // 一帧只提交一次：鼠标事件可以到 1000Hz，屏幕只有 60。
    const flush = () => {
      dragRafRef.current = null;

      if (dragMode === 'pan') {
        const { dx, dy } = pendingDeltaRef.current;
        pendingDeltaRef.current = { dx: 0, dy: 0 };
        if (dx || dy) setViewPort(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        return;
      }

      if (dragMode === 'noteResize') {
        const id = draggingNoteIdRef.current;
        const from = resizedNoteSizeRef.current;
        const { dx, dy } = pendingDeltaRef.current;
        pendingDeltaRef.current = { dx: 0, dy: 0 };
        if (!id || !from || (!dx && !dy)) return;
        const zoom = viewPortRef.current.zoom;
        // 下限跟着后端的校验走，免得拖到一半的尺寸存不进去。
        const next = {
          width: Math.max(MIN_NOTE_WIDTH, Math.min(1600, from.width + dx / zoom)),
          height: Math.max(MIN_NOTE_HEIGHT, Math.min(1600, from.height + dy / zoom)),
        };
        resizedNoteSizeRef.current = next;
        setNotes(prev => prev.map(n => (n.id === id ? { ...n, width: next.width, height: next.height } : n)));
        return;
      }

      if (dragMode === 'note') {
        const id = draggingNoteIdRef.current;
        const grab = grabOffsetRef.current;
        const origin = worldRectRef.current;
        if (!id || !grab || !origin) return;
        // 绝对定位：直接由当前鼠标位置算出卡片该在哪，不累加增量。
        // 坐标同时写回 ref —— 放在 setNotes 的 updater 里算的话，updater 要等
        // 下一次渲染才跑，松手那一刻读到的还是上一帧的位置，存进库的坐标就少一帧位移。
        const zoom = viewPortRef.current.zoom;
        const next = {
          x: (lastMouseRef.current.x - origin.left) / zoom - grab.x,
          y: (lastMouseRef.current.y - origin.top) / zoom - grab.y,
        };
        const prevPos = draggedNotePositionRef.current;
        if (prevPos && prevPos.x === next.x && prevPos.y === next.y) return;
        draggedNotePositionRef.current = next;
        setNotes(prev => prev.map(n => (n.id === id ? { ...n, x: next.x, y: next.y } : n)));
        return;
      }

      // 滚动条是绝对定位：始终以按下点为基准，不累加增量。
      if (dragMode === 'scrollX' && scrollTrackXRef.current) {
        const dx = lastMouseRef.current.x - dragStartRef.current.x;
        const worldDelta = (dx / scrollTrackXRef.current.clientWidth) * contentBoundsRef.current.width;
        setViewPort(prev => ({ ...prev, x: initialViewPortRef.current.x - (worldDelta * prev.zoom) }));
      } else if (dragMode === 'scrollY' && scrollTrackYRef.current) {
        const dy = lastMouseRef.current.y - dragStartRef.current.y;
        const worldDelta = (dy / scrollTrackYRef.current.clientHeight) * contentBoundsRef.current.height;
        setViewPort(prev => ({ ...prev, y: initialViewPortRef.current.y - (worldDelta * prev.zoom) }));
      }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      dragMovedRef.current = true;
      // 拖卡片走绝对定位（见 grabOffsetRef），不需要累加增量。
      if (dragMode === 'pan' || dragMode === 'noteResize') {
        pendingDeltaRef.current.dx += e.clientX - dragStartRef.current.x;
        pendingDeltaRef.current.dy += e.clientY - dragStartRef.current.y;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
      }
      if (dragRafRef.current === null) dragRafRef.current = requestAnimationFrame(flush);
    };

    const handleGlobalMouseUp = () => {
      // 最后一帧可能还压在队列里，先落地再收尾。
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
        flush();
      }
      const noteId = draggingNoteIdRef.current;
      if (dragMode === 'note' && dragMovedRef.current && noteId && draggedNotePositionRef.current && spaceId) {
        const { x, y } = draggedNotePositionRef.current;
        saveNoteGeometry(noteId, { x, y }, dragOriginRef.current);
      }
      if (dragMode === 'noteResize' && dragMovedRef.current && noteId && resizedNoteSizeRef.current && spaceId) {
        // 尺寸和位置走同一条接口，位置取当前值（改大小不挪位置）。
        const note = notesRef.current.find(n => n.id === noteId);
        const { width, height } = resizedNoteSizeRef.current;
        if (note) {
          saveNoteGeometry(
            noteId,
            { x: note.x, y: note.y, width: Math.round(width), height: Math.round(height) },
            dragOriginRef.current,
          );
        }
      }
      pendingDeltaRef.current = { dx: 0, dy: 0 };
      draggedNotePositionRef.current = null;
      resizedNoteSizeRef.current = null;
      draggingNoteIdRef.current = null;
      grabOffsetRef.current = null;
      worldRectRef.current = null;
      dragMovedRef.current = false;
      dragOriginRef.current = null;
      setDragMode('none');
      setDraggingNoteId(null);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };
  }, [dragMode, spaceId, saveNoteGeometry]);
  
  // --- Handlers ---
  const handleToolSelect = (id: string) => setActiveTool(id);
  const handleToolOpen = (id: string) => {
    setActiveTool(id); 
    switch (id) {
      case 'note':
        startNewNote();
        break;
      case 'drawing': {
        // Toggle the on-canvas shape toolbar rather than opening a modal:
        // shapes are drawn directly on the space, so the palette only needs to
        // be present while the teacher is actually drawing.
        // The next value is computed outside the setter — a state updater must
        // stay pure, and StrictMode runs it twice (toggling back to the start).
        const openShapeBar = !shapeToolbarOpen;
        setShapeToolbarOpen(openShapeBar);
        if (!openShapeBar) {
          setShapeTool(null);
          setSelectedShapeId(null);
          setActiveTool('');
        }
        break;
      }
      case 'exit':
        handleExit();
        break;
      case 'attachment':
        setIsAttachmentModalOpen(true);
        break;
      case 'collaborative_document':
        if (COLLAB_ENABLED) { setCollabTitle(''); setCollabCreateError(''); setCollabCreateOpen(true); }
        break;
      case 'assessment':
        setIsAnalyticsOpen(true);
        break;
      case 'view': {
        const opening = !isViewPanelOpen;
        setIsViewPanelOpen(opening);
        if (!opening) setActiveTool('');
        break;
      }
      case 'riseabove':
        setShowRiseAbovePicker(true);
        setRiseAbovePickerSelected(new Set());
        break;
      case 'scaffold':
        setIsScaffoldModalOpen(true);
        break;
      case 'authors':
        setIsMemberModalOpen(true);
        break;
      case 'group':
        setIsGroupModalOpen(true);
        break;
      case 'inquiry':
        setIsInquiryPanelOpen(true);
        break;
      default: break;
    }
  };

  // Add a notification helper
  const addNotification = (n: Partial<Notification>) => {
      const newNotif: Notification = {
          id: `notif-${Date.now()}`,
          userId: user?.id ?? 'anonymous',
          type: 'system',
          title: 'System',
          message: '',
          read: false,
          createdAt: new Date().toLocaleString(),
          ...n
      } as Notification;
      setNotifications(prev => [newNotif, ...prev]);
  };

  /** 每个视图里有多少条笔记 —— 面板和卡片都要显示，算一次共用。 */
  const noteCountByView = useMemo(() => {
    const counts = new Map<string, number>();
    const known = new Set(views.map(v => v.id));
    for (const note of notes) {
      const assigned = (note.views ?? []).filter(v => known.has(v));
      // 没有归属、或指向已删除视图的笔记显示在 Welcome，计数也要跟着算在那里。
      for (const viewId of assigned.length > 0 ? assigned : [WELCOME_VIEW_ID]) {
        counts.set(viewId, (counts.get(viewId) ?? 0) + 1);
      }
    }
    return counts;
  }, [notes, views]);

  /** 当前画布上的卡片。指向已删除视图的卡片直接不画，免得点进一片空白。 */
  const cardsOnCanvas = useMemo(
    () => viewCards.filter(c => c.hostViewId === activeViewId && views.some(v => v.id === c.viewId)),
    [viewCards, activeViewId, views],
  );

  const placedViewIds = useMemo(
    () => new Set(cardsOnCanvas.map(c => c.viewId)),
    [cardsOnCanvas],
  );

  /**
   * Switch canvases and frame whatever lives there — the notes of the target
   * view, or the cards sitting on it when it has no notes yet.
   */
  const goToView = useCallback((viewId: string) => {
    setActiveViewId(viewId);
    setSelectedShapeId(null);
    const targetNotes = notes.filter(n => (
      viewId === WELCOME_VIEW_ID
        ? (n.views?.includes(WELCOME_VIEW_ID) || !n.views?.length)
        : n.views?.includes(viewId)
    ));
    const cards = viewCards
      .filter(c => c.hostViewId === viewId)
      .map(c => ({ x: c.x, y: c.y, width: VIEW_CARD_WIDTH, height: VIEW_CARD_HEIGHT }));
    fitViewportTo([...targetNotes, ...cards]);
  }, [notes, viewCards, fitViewportTo]);

  /** 「重置视图」：回到当前画布上笔记和视图卡片所在的地方，而不是一个固定坐标。 */
  const frameActiveView = useCallback(() => {
    fitViewportTo([
      ...visibleNotes,
      ...cardsOnCanvas.map(c => ({ x: c.x, y: c.y, width: VIEW_CARD_WIDTH, height: VIEW_CARD_HEIGHT })),
    ]);
  }, [visibleNotes, cardsOnCanvas, fitViewportTo]);

  /** 拖动挪位置；没挪动的一次点击就是进入那个视图。 */
  const handleViewCardMouseDown = useCallback((e: React.MouseEvent, card: ApiViewCard) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const onMove = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      const dx = (ev.clientX - startX) / viewPort.zoom;
      const dy = (ev.clientY - startY) / viewPort.zoom;
      setViewCards(prev => prev.map(c => (
        c.id === card.id ? { ...c, x: card.x + dx, y: card.y + dy } : c
      )));
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) {
        goToView(card.viewId);
        trackEvent({
          event_type: 'view_switched',
          object_type: 'view',
          object_id: card.viewId,
          space_id: spaceId,
          metadata_json: { from_view_id: card.hostViewId, to_view_id: card.viewId },
        });
        return;
      }
      const x = card.x + (ev.clientX - startX) / viewPort.zoom;
      const y = card.y + (ev.clientY - startY) / viewPort.zoom;
      viewCardsApi.move(card.id, x, y).catch(err => {
        console.error('Failed to save view card position:', err);
        setViewCards(prev => prev.map(c => (c.id === card.id ? { ...c, x: card.x, y: card.y } : c)));
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [viewPort.zoom, spaceId, goToView]);

  /** 卡片落点：屏幕中央；已经有卡片占着就顺次错开，免得叠成一摞。 */
  const openCardSpot = useCallback(() => {
    const cx = (-viewPort.x + window.innerWidth / 2) / viewPort.zoom - VIEW_CARD_WIDTH / 2;
    const cy = (-viewPort.y + window.innerHeight / 2) / viewPort.zoom - VIEW_CARD_HEIGHT / 2;
    const here = viewCards.filter(c => c.hostViewId === activeViewId);
    for (let i = 0; i < 12; i++) {
      const x = cx + i * 28;
      const y = cy + i * 28;
      if (!here.some(c => Math.abs(c.x - x) < 40 && Math.abs(c.y - y) < 40)) return { x, y };
    }
    return { x: cx, y: cy };
  }, [viewPort, viewCards, activeViewId]);

  /**
   * 新建视图 = 一块空画布 + 当前画布上一张通往它的卡片，然后直接进去。
   *
   * 这里等服务器返回再切换，而不是先用临时 id 乐观切过去 —— 乐观那版要在保存
   * 回来后把这期间创建的笔记和形状从临时 id 重新归档到真 id，漏一个就永久孤立。
   * 多等一个来回，换掉一整类孤儿笔记。
   */
  const handleCreateView = useCallback(async (title: string) => {
    if (!spaceId) return;
    const spot = openCardSpot();
    try {
      const { view, card } = await viewsApi.create(spaceId, {
        title,
        host_view_id: activeViewId,
        card_x: spot.x,
        card_y: spot.y,
      });
      const saved = apiViewToView(view);
      setViews(prev => [...prev, saved]);
      setViewCards(prev => [...prev, card]);
      setActiveViewId(saved.id);
      setSelectedShapeId(null);
      setViewPort(HOME_VIEWPORT);
      trackEvent({ event_type: 'view_created', object_type: 'view', object_id: saved.id, space_id: spaceId });
    } catch (err) {
      console.error('Failed to create view:', err);
      window.alert(lang === 'zh' ? '新建视图失败，请重试。' : 'Could not create the view. Please try again.');
    }
  }, [spaceId, activeViewId, openCardSpot, lang]);

  /** 把某个视图放到当前画布上，作为跳转入口。Welcome 也可以被放到任何地方。 */
  const handlePlaceCard = useCallback(async (viewId: string) => {
    if (!spaceId || viewId === activeViewId) return;
    const spot = openCardSpot();
    try {
      const { card } = await viewCardsApi.create(spaceId, {
        view_id: viewId,
        host_view_id: activeViewId,
        x: spot.x,
        y: spot.y,
      });
      setViewCards(prev => (prev.some(c => c.id === card.id) ? prev : [...prev, card]));
      trackEvent({ event_type: 'view_card_placed', object_type: 'view', object_id: viewId, space_id: spaceId });
    } catch (err) {
      console.error('Failed to place view card:', err);
      window.alert(lang === 'zh' ? '放置卡片失败，请重试。' : 'Could not place the card. Please try again.');
    }
  }, [spaceId, activeViewId, openCardSpot, lang]);

  const handleRenameView = useCallback(async (id: string, title: string) => {
    if (id === WELCOME_VIEW_ID) return;
    const before = views.find(v => v.id === id)?.title;
    if (before === title) return;
    setViews(prev => prev.map(v => (v.id === id ? { ...v, title } : v)));
    try {
      await viewsApi.rename(id, title);
    } catch (err) {
      console.error('Failed to rename view:', err);
      setViews(prev => prev.map(v => (v.id === id && before != null ? { ...v, title: before } : v)));
      window.alert(lang === 'zh' ? '改名失败，只有创建者和教师可以改。' : 'Rename failed — only the creator or a teacher can rename this view.');
    }
  }, [views, lang]);

  /** 移除卡片只是撤掉一个入口，视图和里面的笔记都还在。 */
  const handleRemoveCard = useCallback(async (card: ApiViewCard, title: string) => {
    const ok = window.confirm(lang === 'zh'
      ? `移除通往「${title}」的卡片？视图本身和里面的笔记都不会被删除。`
      : `Remove the card linking to "${title}"? The view and its notes stay.`);
    if (!ok) return;
    setViewCards(prev => prev.filter(c => c.id !== card.id));
    try {
      await viewCardsApi.remove(card.id);
    } catch (err) {
      console.error('Failed to remove view card:', err);
      setViewCards(prev => (prev.some(c => c.id === card.id) ? prev : [...prev, card]));
      window.alert(lang === 'zh' ? '移除失败，只有放卡片的人和教师可以移除。' : 'Could not remove it — only the person who placed it or a teacher can.');
    }
  }, [lang]);

  const handleDeleteView = useCallback(async (id: string) => {
    if (id === WELCOME_VIEW_ID) return;
    // 只归属这个视图的笔记会随之失去去处，先说清楚再动手。
    const stranded = notes.filter(n => n.views?.includes(id));
    const ok = window.confirm(stranded.length === 0
      ? (lang === 'zh' ? '删除这个视图？' : 'Delete this view?')
      : (lang === 'zh'
          ? `该视图中有 ${stranded.length} 条笔记，删除后它们会移回 Welcome。继续？`
          : `${stranded.length} note(s) live in this view. They will be moved back to Welcome. Continue?`));
    if (!ok) return;

    setViews(prev => prev.filter(v => v.id !== id));
    setViewCards(prev => prev.filter(c => c.viewId !== id && c.hostViewId !== id));
    setNotes(prev => prev.map(n => (
      n.views?.includes(id)
        ? { ...n, views: [...(n.views ?? []).filter(v => v !== id), WELCOME_VIEW_ID] }
        : n
    )));
    if (activeViewId === id) goToView(WELCOME_VIEW_ID);

    try {
      await Promise.all(stranded.filter(n => UUID_RE.test(n.id)).map(n => notesApi.update(n.id, {
        views: [...(n.views ?? []).filter(v => v !== id), WELCOME_VIEW_ID],
      })));
      await viewsApi.delete(id);
    } catch (err) {
      console.error('Failed to delete view:', err);
      window.alert(lang === 'zh' ? '删除失败，只有创建者和教师可以删除。' : 'Delete failed — only the creator or a teacher can delete this view.');
    }
  }, [notes, activeViewId, lang, goToView]);

  // Views live on the server; Welcome is always prepended as the home canvas.
  useEffect(() => {
    if (!spaceId) { setViews(INITIAL_VIEWS); setViewCards([]); return; }
    let cancelled = false;
    viewsApi.list(spaceId)
      .then(({ views: loaded, cards }) => {
        if (cancelled) return;
        setViews([...INITIAL_VIEWS, ...loaded.map(apiViewToView)]);
        setViewCards(cards);
        setViewsLoadedFor(spaceId);
      })
      .catch(() => { if (!cancelled) { setViews(INITIAL_VIEWS); setViewCards([]); setViewsLoadedFor(spaceId); } });
    return () => { cancelled = true; };
  }, [spaceId]);

  // ── Canvas shapes ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!spaceId) { setShapes([]); return; }
    let cancelled = false;
    notesApi.listShapes(spaceId)
      .then(({ shapes: loaded }) => { if (!cancelled) setShapes(loaded); })
      .catch(() => { /* shapes are decoration — never block the canvas */ });
    return () => { cancelled = true; };
  }, [spaceId]);

  // Shapes belong to the view they were drawn in, like notes.
  const visibleShapes = useMemo(
    () => shapes.filter(s => !s.viewId || s.viewId === activeViewId),
    [shapes, activeViewId],
  );


  const handleCreateShape = useCallback(async (draft: ShapeDraft) => {
    if (!spaceId) return;
    const payload: ShapePayload = {
      shape_type: draft.shapeType,
      view_id: activeViewId,
      x: draft.x, y: draft.y, width: draft.width, height: draft.height,
      fill: draft.shapeType === 'text' ? '' : draft.fill,
      stroke: draft.stroke,
      text: draft.shapeType === 'text' ? (lang === 'zh' ? '标签' : 'Label') : '',
      stroke_width: shapeStyle.strokeWidth,
      font_size: shapeStyle.fontSize,
      font_weight: shapeStyle.fontWeight,
      text_align: shapeStyle.textAlign,
      text_valign: shapeStyle.textValign,
      text_color: shapeStyle.textColor,
    };
    try {
      const { shape } = await notesApi.createShape(spaceId, payload);
      setShapes(prev => [...prev, shape]);
      setSelectedShapeId(shape.id);
      setShapeTool(null);      // one shape per click, like ProcessOn
      setActiveTool('');
    } catch (err) {
      console.error('Failed to create shape:', err);
    }
  }, [spaceId, activeViewId, lang, shapeStyle]);

  const handleUpdateShape = useCallback((id: string, patch: Partial<ApiShape>, commit: boolean) => {
    setShapes(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
    if (!commit || !spaceId) return;
    const body: Partial<ShapePayload> = {};
    if (patch.x !== undefined) body.x = patch.x;
    if (patch.y !== undefined) body.y = patch.y;
    if (patch.width !== undefined) body.width = patch.width;
    if (patch.height !== undefined) body.height = patch.height;
    if (patch.text !== undefined) body.text = patch.text;
    if (patch.fill !== undefined) body.fill = patch.fill;
    if (patch.stroke !== undefined) body.stroke = patch.stroke;
    if (patch.shapeType !== undefined) body.shape_type = patch.shapeType;
    if (patch.strokeWidth !== undefined) body.stroke_width = patch.strokeWidth;
    if (patch.fontSize !== undefined) body.font_size = patch.fontSize;
    if (patch.fontWeight !== undefined) body.font_weight = patch.fontWeight;
    if (patch.textAlign !== undefined) body.text_align = patch.textAlign;
    if (patch.textValign !== undefined) body.text_valign = patch.textValign;
    if (patch.textColor !== undefined) body.text_color = patch.textColor;
    notesApi.updateShape(id, body).catch(err => console.error('Failed to save shape:', err));
  }, [spaceId]);

  /**
   * 样式面板的改动：选中了图形就落到该图形，没选中就更新默认值。
   * 两条路都要更新默认值，这样"调好色再画下一个"是连贯的。
   */
  const handleStyleChange = useCallback((patch: Partial<ShapeStyleValue>) => {
    setShapeStyle(prev => ({ ...prev, ...patch }));
    if (!selectedShapeId) return;
    const shapePatch: Partial<ApiShape> = {};
    if (patch.fill !== undefined) shapePatch.fill = patch.fill;
    if (patch.stroke !== undefined) shapePatch.stroke = patch.stroke;
    if (patch.strokeWidth !== undefined) shapePatch.strokeWidth = patch.strokeWidth;
    if (patch.fontSize !== undefined) shapePatch.fontSize = patch.fontSize;
    if (patch.fontWeight !== undefined) shapePatch.fontWeight = patch.fontWeight;
    if (patch.textAlign !== undefined) shapePatch.textAlign = patch.textAlign;
    if (patch.textValign !== undefined) shapePatch.textValign = patch.textValign;
    if (patch.textColor !== undefined) shapePatch.textColor = patch.textColor;
    handleUpdateShape(selectedShapeId, shapePatch, true);
  }, [selectedShapeId, handleUpdateShape]);

  // 选中一个图形时，把它的样式读进面板 —— 否则面板显示的是上一次的默认值，
  // 一改就把选中图形的其他属性覆盖成不相干的值。
  useEffect(() => {
    if (!selectedShapeId) return;
    const s = shapes.find(sh => sh.id === selectedShapeId);
    if (!s) return;
    setShapeStyle({
      fill: s.fill ?? '',
      stroke: s.stroke ?? '#4338ca',
      strokeWidth: s.strokeWidth ?? 2,
      fontSize: s.fontSize ?? 15,
      fontWeight: s.fontWeight ?? 600,
      textAlign: s.textAlign ?? 'center',
      textValign: s.textValign ?? 'middle',
      textColor: s.textColor ?? '',
    });
    // shapes 故意不进依赖：拖动图形时 shapes 每帧都变，会把面板里正在编辑的值冲掉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShapeId]);

  const handleDeleteShape = useCallback(async (id: string) => {
    setShapes(prev => prev.filter(s => s.id !== id));
    setSelectedShapeId(null);
    try {
      await notesApi.deleteShape(id);
    } catch (err) {
      console.error('Failed to delete shape:', err);
    }
  }, []);

  const handleFileUpload = async (file: File) => {
    const centerX = (-viewPort.x + (window.innerWidth / 2)) / viewPort.zoom;
    const centerY = (-viewPort.y + (window.innerHeight / 2)) / viewPort.zoom;
    const isVideo = file.type.startsWith('video/');
    const localUrl = URL.createObjectURL(file);
    const tempId = `temp-${Date.now()}`;

    // Show the attachment immediately, then swap in the saved note.
    const optimisticNote: Note = {
      id: tempId,
      type: isVideo ? 'video' : 'attachment',
      title: file.name,
      author: user?.name ?? 'Current user',
      authorId: user?.id,
      date: new Date().toLocaleString(),
      createdAt: new Date().toISOString(),
      authorAvatar: user?.avatar,
      x: centerX,
      y: centerY,
      fileUrl: localUrl,
      fileName: file.name,
      mimeType: file.type,
      isPreviewMode: file.type.startsWith('image/') || file.type.startsWith('video/'),
      width: 320,
      height: 240,
      views: [activeViewId],
    };
    setNotes(prev => [...prev, optimisticNote]);
    setActiveTool('');

    // Without a space there is no server to save to (demo canvas).
    if (!spaceId) return;

    const dropOptimistic = () => {
      setNotes(prev => prev.filter(n => n.id !== tempId));
      URL.revokeObjectURL(localUrl);
    };

    if (file.size > MAX_ATTACHMENT_BYTES) {
      dropOptimistic();
      window.alert(lang === 'zh'
        ? `文件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB 上限，请压缩后再上传。`
        : `File exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit.`);
      return;
    }

    try {
      // 直传存储，字节不经过 API —— 旧做法把文件 base64 塞进 JSON，
      // 体积膨胀 37%，上限被请求体大小卡在 25MB。
      // 大文件走可续传，进度写在那张占位卡片的标题上：传一个 100MB 的视频
      // 要好几分钟，没有任何反馈的话没人分得清「在传」和「卡死了」。
      const attachment = await uploadAttachment(spaceId, file, {
        onProgress: ({ phase, ratio }) => {
          const label = phase === 'verifying'
            ? (lang === 'zh' ? '校验中…' : 'verifying…')
            : ratio !== undefined && ratio < 1
              ? `${Math.round(ratio * 100)}%`
              : (lang === 'zh' ? '上传中…' : 'uploading…');
          setNotes(prev => prev.map(n =>
            n.id === tempId ? { ...n, title: `${file.name} · ${label}` } : n));
        },
      });

      const { note: created } = await notesApi.create(spaceId, {
        type: isVideo ? 'video' : 'attachment',
        title: file.name,
        x: centerX,
        y: centerY,
        file_url: attachment.file_url,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        width: 320,
        height: 240,
        views: [activeViewId],
      } as Partial<ApiNote>);

      // 先把 Note 建出来，再进 updater。updater 是惰性的 —— 要等下一次 render 时
      // 在 useSpaceData 的 useState 里才执行，那时抛错会拦腰打断 Workspace 的渲染，
      // React 只报一个 #310 把真正的异常盖掉。放在这里抛，外层 catch 接得住。
      const savedNote = apiNoteToNote(created, user?.name);
      setNotes(prev => prev.map(n => (n.id === tempId ? savedNote : n)));
      URL.revokeObjectURL(localUrl);

      trackEvent({
        event_type: 'note_created',
        object_type: 'note',
        object_id: created.id,
        space_id: spaceId,
        metadata_json: { note_type: isVideo ? 'video' : 'attachment', mime_type: attachment.mime_type },
      });
    } catch (error) {
      console.error(error);
      dropOptimistic();
      const message = error instanceof Error ? error.message : '';
      window.alert(lang === 'zh'
        ? `附件上传失败${message ? `：${message}` : '，请重试。'}`
        : `Attachment upload failed${message ? `: ${message}` : '. Please try again.'}`);
    }
  };
  
  /**
   * 学生在还没保存的新笔记里就跟 AI 说话时，先把笔记落库并返回真实 id。
   * 对话线程的 note_id 是 NOT NULL——没有真实笔记就开不了线程，而研究数据
   * 要求每次 AI 交互都能追到一条笔记上。这里刻意**不关闭编辑器**：
   * 学生还在写，只是笔记从此有了身份。
   */
  /**
   * AI 自动反馈通常 5–15 秒落库，但慢的失败转移能拖到半分钟。
   * 以前是无脑挂 7 个定时器各重拉一次（2.5/5/8/12/18/30/50 秒）——
   * 一次保存就是 50 秒里 7 次全量重拉，一个班同时写就成了持续刷新。
   *
   * 改成：查到新反馈就停，最多轮 6 次。而且这些重拉都是静默的
   * （useSpaceData 里对后台刷新不亮加载蒙层）。
   */
  // 轮询回调跨越多次 setState，闭包里的 notes 是旧的，用 ref 读最新的
  const notesRef = useRef(notes);
  notesRef.current = notes;

  /**
   * 双击打开的窗口开着、停够 3 秒，New 才摘掉：AI 对话笔记、画图、附件、讨论室发布的 Rise Above。
   * 普通笔记走笔记页，NoteEditorModal 自己算。单击选中、右侧详情栏都不算——
   * 以前详情栏停 1.2 秒就算看过，学生一点卡片 New 就没了（10-05 用户反馈）。
   */
  const openedForSeen = useMemo<Note | null>(() => {
    if (dialogueNote) return dialogueNote;
    if (isDrawingOpen && drawingToEdit) return drawingToEdit;
    if (viewingFile) return viewingFile;
    if (riseAboveRoomId) {
      const publishedId = riseAboveRooms.find(room => room.id === riseAboveRoomId)?.published_note_id;
      return publishedId ? notes.find(n => n.id === publishedId) ?? null : null;
    }
    return null;
  }, [dialogueNote, isDrawingOpen, drawingToEdit, viewingFile, riseAboveRoomId, riseAboveRooms, notes]);
  useMarkSeenAfterDwell(openedForSeen, user?.id);

  /**
   * 把 .md 附件转成一条真正的笔记，放在原附件旁边。
   *
   * 附件本身不动——学生仍能看到原文件，而且研究上要能追溯「这条笔记
   * 是从哪份材料来的」。正文里的 data-imported-from 由查看器包好，
   * 后端据此把这段算成 imported 而不是学生产出。
   */
  /**
   * 保存编辑后的 Markdown：传成**新文件**，再把附件笔记指向它。
   *
   * 不覆盖原文件，因为那个链接可能已经嵌在别人的笔记里、被引用过——
   * 覆盖会让别人看到的东西悄悄变了。旧版本留在存储里，
   * 并在 metadata.mdVersions 里记一笔，否则「留着」等于「找不回」。
   */
  /**
   * 文档查看器底部「带这份文档去空间 AI 助手」：打开知识空间 AI 助手，文档挂在它的输入框上。
   *
   * 只问这一份文档用查看器右边的文档 AI；这个入口是要把文档和空间里的其他笔记放在一起谈。
   * 以前这里打开的是这条附件笔记的编辑器，和按钮上写的去处不是一回事。
   */
  /**
   * 把选中的一段引用成一条新笔记，并**立刻打开编辑器**。
   *
   * 引文单独包 data-imported-from：这段字不是学生写的，
   * 内容分层要把它算进 imported 而不是 studentChars。
   * 引文下面留一个空段落，光标落在那里——引用的价值在于
   * 学生接着写自己的看法，只搬一段原文对知识建构没有意义。
   */
  const handleQuoteToNote = useCallback(async (payload: { quote: string; fileName: string }) => {
    if (!spaceId) return;
    const authorName = user?.name ?? 'Current user';
    const source = viewingFile;
    const pos = source
      ? findOpenPosition(source.x + 260, source.y, notes)
      : findOpenPosition((-viewPort.x + window.innerWidth / 2) / viewPort.zoom,
                         (-viewPort.y + window.innerHeight / 2) / viewPort.zoom, notes);

    const escape = (v: string) => v
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // data-imported-from 早就在了，但那是给 segmentNoteContent 分层用的属性，
    // 读者看不见。摘出来的一段话不标出处，同伴读到时无从判断这是谁说的、
    // 能不能引用 —— 所以再加一行看得见的引注。
    const cite = lang === 'zh'
      ? `引自《${escape(payload.fileName)}》`
      : `From “${escape(payload.fileName)}”`;
    const html = `<blockquote data-imported-from="${escape(payload.fileName)}">`
      + `<p>${escape(payload.quote)}</p>`
      + `<cite>${cite}</cite>`
      + `</blockquote><p><br></p>`;
    const title = payload.quote.replace(/\s+/g, ' ').trim().slice(0, 28)
      + (payload.quote.trim().length > 28 ? '…' : '');

    const { note: created } = await notesApi.create(spaceId, {
      type: 'note',
      title,
      content: html,
      x: pos.x, y: pos.y,
      inquiry_question: currentSpace?.inquiry_question,
      views: [activeViewId],
    });
    const realNote = apiNoteToNote(created, authorName);
    setNotes(prev => [...prev, realNote]);
    trackEvent({
      event_type: 'note_created',
      object_type: 'note',
      object_id: created.id,
      space_id: spaceId,
      metadata_json: { type: 'note', quoted_from: payload.fileName, source_note_id: source?.id ?? null },
    });
    setViewingFile(null);
    setEditingNote(realNote);
    setIsCreatingNew(false);
  }, [spaceId, user?.name, viewingFile, notes, viewPort, currentSpace?.inquiry_question, activeViewId, lang]);

  const handleAskAiAboutFile = useCallback(async () => {
    const target = viewingFile;
    if (!target?.fileUrl) return;
    let text: string | undefined;
    try {
      const result = await notesApi.extractAttachmentText({
        file_url: target.fileUrl,
        file_name: target.fileName ?? '',
        mime_type: target.mimeType ?? '',
      });
      text = result.text ?? undefined;
    } catch {
      // 抽不出正文不拦着——图片类附件本来就靠视觉模型读，
      // 读不出的类型消息里会明说，学生不会以为 AI 看过了。
    }
    setAssistantAttachment({
      file_url: target.fileUrl,
      file_name: target.fileName ?? (lang === 'zh' ? '附件' : 'Attachment'),
      mime_type: target.mimeType ?? 'application/octet-stream',
      text,
    });
    setViewingFile(null);
    setIsWorkspaceAgentOpen(true);
  }, [viewingFile, lang]);

  /**
   * 笔记 AI 回答下面的来源卡片：打开那份附件，PDF 跳到那一页。阅读页叠在笔记页上面，关掉回到笔记。
   * 附件不在这个空间的画布上（课里别的空间）时按 id 取一次，接口照常判权限。
   */
  const openKbSource = useCallback(async (noteId: string, page: number | null) => {
    const target = notes.find(note => note.id === noteId)
      ?? await notesApi.get(noteId).then(res => apiNoteToNote(res.note)).catch(() => null);
    if (!target?.fileUrl) return;
    setViewingFilePage(page);
    setViewingFile(target);
  }, [notes]);

  // 上传、换地址、记旧版本都在服务端一次做完，这里不碰 metadata：打开阅读器时拿到的那块
  // 可能已经旧了，整块写回会冲掉这期间同学对这张卡的「固定」、显示方式，或别人刚存的一版。
  const handleSaveMarkdown = useCallback(async (payload: { text: string; fileName: string }) => {
    if (!spaceId || !viewingFile?.id) return;
    const target = viewingFile;
    // btoa 只吃 latin1，中文会抛 InvalidCharacterError。
    // unescape 那套写法已废弃，用 TextEncoder 转字节再编码。
    const bytes = new TextEncoder().encode(payload.text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);

    let saved: Awaited<ReturnType<typeof notesApi.saveMarkdownVersion>>;
    try {
      saved = await notesApi.saveMarkdownVersion(target.id, {
        data_url: `data:text/markdown;base64,${btoa(binary)}`,
        file_name: payload.fileName,
        base_file_url: target.fileUrl ?? null,
      });
    } catch (error) {
      // 抛出去的文案由查看器显示在编辑框上方，编辑框里的内容不动
      const status = error instanceof ApiClientError ? error.status : 0;
      const zh = lang === 'zh';
      if (status === 409) {
        throw new Error(zh
          ? '这份文档在你编辑期间有人保存了新版本，这次没有保存。你的修改还在编辑框里，请先复制出来，关闭文档再重新打开后修改。'
          : 'Someone saved a newer version of this document while you were editing, so this save did not go through. Your changes are still in the editor: copy them, then close and reopen the document.');
      }
      if (status === 403) {
        throw new Error(zh
          ? '只有上传者和课程教师可以修改这份文档。'
          : 'Only the uploader and course teachers can edit this document.');
      }
      throw error;
    }

    // 合进本地最新的那条，不用打开时的快照；固定状态以服务端为准
    const apply = (n: Note): Note => ({
      ...n,
      fileUrl: saved.file_url,
      fileName: saved.file_name,
      mimeType: saved.mime_type,
      metadata: saved.metadata,
      isFixed: saved.metadata.is_fixed === true,
    });
    setNotes(prev => prev.map(n => (n.id === target.id ? apply(n) : n)));
    setViewingFile(prev => (prev?.id === target.id ? apply(prev) : prev));
  }, [spaceId, viewingFile, lang]);

  const handleConvertMarkdownToNote = useCallback(async (
    payload: { title: string; html: string; fileName: string },
  ) => {
    if (!spaceId) return;
    const authorName = user?.name ?? 'Current user';
    const source = viewingFile;
    const pos = source
      ? findOpenPosition(source.x + 260, source.y, notes)
      : findOpenPosition((-viewPort.x + window.innerWidth / 2) / viewPort.zoom,
                         (-viewPort.y + window.innerHeight / 2) / viewPort.zoom, notes);

    const { note: created } = await notesApi.create(spaceId, {
      type: 'note',
      title: payload.title,
      content: payload.html,
      x: pos.x, y: pos.y,
      inquiry_question: currentSpace?.inquiry_question,
      views: [activeViewId],
    });
    const realNote = apiNoteToNote(created, authorName);
    setNotes(prev => [...prev, realNote]);
    trackEvent({
      event_type: 'note_created',
      object_type: 'note',
      object_id: created.id,
      space_id: spaceId,
      metadata_json: { type: 'note', imported_from: payload.fileName, source_note_id: source?.id ?? null },
    });
  }, [spaceId, user?.name, viewingFile, notes, viewPort, currentSpace?.inquiry_question, activeViewId]);

  /**
   * 给刚落库的新笔记接上 Build-on 父笔记。「贡献」和草稿自动保存都从这里建，
   * 两处建出来的关系、埋点、通知必须一模一样。失败时抛出，画布上的连线由调用方收拾。
   */
  const createBuildOnRelation = useCallback(async (noteId: string, buildOn: BuildOnIntent): Promise<Edge> => {
    if (!spaceId) throw new Error('No space');
    openFold(buildOn.parentId);
    const { relation } = await relationsApi.create({
      source_note_id: noteId,
      target_note_id: buildOn.parentId,
      relation_type: buildOn.relationType,
      space_id: spaceId,
    });
    trackEvent({
      event_type: 'buildon_created',
      object_type: 'relation',
      object_id: relation.id,
      space_id: spaceId,
      target_note_id: buildOn.parentId,
      metadata_json: { relation_type: buildOn.relationType },
    });
    const parentNote = notesRef.current.find(n => n.id === buildOn.parentId);
    if (parentNote) {
      addNotification({
        type: 'buildon',
        title: 'New Build-on',
        message: `${user?.name ?? 'Current user'} built on "${parentNote.title}"`,
        link: { type: 'note', id: noteId },
      });
    }
    return apiRelationToEdge(relation);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, user, openFold]);

  /** 类型选择器在「关联」模式下的确认：只在两条已有笔记之间建关系。 */
  const handleLinkExistingNotes = useCallback(async () => {
    const sourceId = buildOnLinkSourceId;
    const targetId = buildOnParentId;
    if (!spaceId || !sourceId || !targetId || linkingNotes) return;
    setLinkingNotes(true);
    try {
      const { relation } = await relationsApi.create({
        source_note_id: sourceId,
        target_note_id: targetId,
        relation_type: buildOnRelationType,
        space_id: spaceId,
      });
      const edge = apiRelationToEdge(relation);
      setEdges(prev => prev.some(e => e.id === edge.id) ? prev : [...prev, edge]);
      openFold(targetId);
      trackEvent({
        event_type: 'buildon_created',
        object_type: 'relation',
        object_id: relation.id,
        space_id: spaceId,
        target_note_id: targetId,
        metadata_json: { relation_type: buildOnRelationType, linked_existing: true },
      });
      setShowBuildOnComposer(false);
      clearBuildOn();
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      window.alert(lang === 'zh'
        ? `没能把这两条笔记连起来。${reason}`
        : `Could not link these notes. ${reason}`);
    } finally {
      setLinkingNotes(false);
    }
  }, [spaceId, buildOnLinkSourceId, buildOnParentId, buildOnRelationType, linkingNotes, setEdges, clearBuildOn, lang, openFold]);

  /**
   * AI 对话要求笔记先落库（对话线程的 note_id 不能为空），所以学生在新笔记里第一次问 AI 时
   * 草稿会被提前存下，之后的「贡献」走更新分支。Build-on 草稿因此必须在这里就放到父笔记旁边、
   * 接上关系——以前这里既不挨着父笔记放、也不建关系，这条笔记就再也接不上了。
   */
  const handlePersistDraft = useCallback(async (title: string, content: string): Promise<string | null> => {
    if (editingNote?.id) return editingNote.id;
    if (!spaceId) return null;
    const session = editorSessionRef.current;
    const pending = draftPersistRef.current;
    if (pending && pending.session === session) return pending.promise;

    const buildOn: BuildOnIntent | null = buildOnParentId
      ? { parentId: buildOnParentId, relationType: buildOnRelationType }
      : null;
    const parentNote = buildOn ? notes.find(n => n.id === buildOn.parentId) : null;
    const pos = placeNewNote(parentNote, notes, viewPort);
    const authorName = user?.name ?? 'Current user';

    const persist = async (): Promise<string | null> => {
      try {
        const { note: created } = await notesApi.create(spaceId, {
          type: 'note', title, content,
          x: pos.x, y: pos.y,
          inquiry_question: currentSpace?.inquiry_question,
          views: [activeViewId],
        });
        const realNote = apiNoteToNote(created, authorName);
        // Realtime 的后台重拉可能已经先把它带回来了，按 id 去重
        setNotes(prev => prev.some(n => n.id === realNote.id) ? prev : [...prev, realNote]);
        // 学生已经关掉或换了一条，这条草稿只留在画布上，不再塞回编辑器
        if (editorSessionRef.current === session) {
          setEditingNote(realNote);
          setIsCreatingNew(false);
        }
        if (buildOn) {
          // 不等它：建关系那一趟要查好几次库，AI 的第一句回复不该陪着等
          createBuildOnRelation(created.id, buildOn)
            .then(edge => setEdges(prev => prev.some(e => e.id === edge.id) ? prev : [...prev, edge]))
            .catch(relErr => console.error('Failed to create relation:', relErr));
        }
        return created.id;
      } catch (error) {
        console.error('[persistDraft]', error);
        return null;
      }
    };

    // 记录一直留到这次编辑结束：落库之后、编辑器重渲之前点下的「贡献」也要认得这条草稿
    const entry = { session, promise: persist() };
    draftPersistRef.current = entry;
    const id = await entry.promise;
    if (!id && draftPersistRef.current === entry) draftPersistRef.current = null; // 失败了允许下一次重试
    return id;
  }, [editingNote?.id, spaceId, user?.name, viewPort, notes, currentSpace?.inquiry_question, activeViewId,
      buildOnParentId, buildOnRelationType, createBuildOnRelation]);

  /** 与 PUT /notes/:id 同一条规则：作者本人，或课程教职。还没落库的临时笔记只可能是自己的。 */
  const canEditNote = useCallback((note: Note) => (
    !spaceId || note.id.startsWith('temp-') || note.authorId === user?.id || viewerIsStaff
  ), [spaceId, user?.id, viewerIsStaff]);

  const handleSaveNote = useCallback(async (title: string, content: string, tags: string[] = []) => {
    const authorName = user?.name ?? 'Current user';

    const saveEdits = (noteId: string) => {
      const before = notesRef.current.find(n => n.id === noteId);
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, title, content } : n));
      if (!spaceId || !noteId) return;
      notesApi.update(noteId, { title, content, tags })
        .then(async () => {
          const ownContribution = user?.id === before?.authorId;
          if (ownContribution) {
            try {
              const result = await noteAiFeedback.finalize(noteId);
              if (result.outcomes.some(outcome => outcome.publishedNoteId)) refetchSpace();
            } catch (error) {
              console.error('[feedback contribution review]', error);
              window.alert(lang === 'zh' ? '笔记已保存，反馈发布判断暂未完成；下次贡献时会重试。' : 'Note saved. Feedback review is pending and will retry on your next contribution.');
            }
          }
          trackEvent({
            event_type: 'note_updated',
            object_type: 'note',
            object_id: noteId,
            space_id: spaceId,
            metadata_json: { word_count: content.split(/\s+/).length },
          });
        })
        .catch(error => {
          console.error('[saveNote]', error);
          // 画布已经先显示了新内容，服务器却没存上：退回原样并说清楚，不能让人以为存好了
          if (before) {
            setNotes(prev => prev.map(n => (n.id === noteId && n.title === title && n.content === content)
              ? { ...n, title: before.title, content: before.content }
              : n));
          }
          const forbidden = error instanceof ApiClientError && error.status === 403;
          const reason = error instanceof Error ? error.message : '';
          window.alert(lang === 'zh'
            ? (forbidden ? '只有作者本人和教师可以修改这条笔记，这次的改动没有保存。' : `这次的改动没有保存成功，请再试一次。${reason}`)
            : (forbidden ? 'Only the author or a teacher can edit this note. Your changes were not saved.' : `Your changes were not saved. Please try again. ${reason}`));
        });
    };

    // 别人的笔记：服务器会拒绝，别让画布先显示改动再悄悄作废。编辑器不关，改过的字还在
    if (!isCreatingNew && editingNote && !canEditNote(editingNote)) {
      window.alert(lang === 'zh'
        ? `这条笔记是 ${editingNote.author} 写的，只有作者本人和教师可以修改。想接着说，可以用「建立于此」写一条 Build-on。`
        : `This note belongs to ${editingNote.author}; only the author or a teacher can edit it. To respond, write a Build-on instead.`);
      return;
    }

    // 这条草稿已经被自动保存（或正在保存）：贡献写进它。再按新建走一遍，
    // 画布上会多出一条一模一样的笔记，Build-on 也会建两次。
    const draft = draftPersistRef.current;
    if (isCreatingNew && draft && draft.session === editorSessionRef.current) {
      closeNoteEditor();
      const draftId = await draft.promise;
      if (draftId) {
        saveEdits(draftId);
        return;
      }
      // 自动保存没成功，草稿不在库里：照常新建（下面读的都是这一轮闭包里的值）
    }

    if (isCreatingNew) {
      // Capture build-on context before async work (state may change)
      const buildOn: BuildOnIntent | null = buildOnParentId
        ? { parentId: buildOnParentId, relationType: buildOnRelationType }
        : null;
      const parentNote = buildOn ? notes.find(n => n.id === buildOn.parentId) : null;
      const { x: centerX, y: centerY } = placeNewNote(parentNote, notes, viewPort);

      // ── Optimistic UI: show note & close modal INSTANTLY ──────────
      const tempId = `temp-${Date.now()}`;
      const optimisticNote: Note = {
        id: tempId,
        type: 'note', title, content, tags,
        author: authorName,
        date: new Date().toLocaleString(),
        createdAt: new Date().toISOString(),
        authorAvatar: user?.avatar,
        x: centerX, y: centerY,
        inquiryQuestion: currentSpace?.inquiry_question,
        views: [activeViewId],
      };
      setNotes(prev => [...prev, optimisticNote]);

      // Add optimistic edge immediately so the connection renders right away
      if (buildOn) {
        openFold(buildOn.parentId);
        setEdges(prev => [...prev, {
          id: `e-temp-${Date.now()}`,
          source: tempId,
          target: buildOn.parentId,
          relationType: buildOn.relationType,
        }]);
      }

      // Close modal immediately — no waiting for network
      closeNoteEditor();

      // ── Background sync to backend ─────────────────────────────────
      if (spaceId) {
        try {
          const { note: created } = await notesApi.create(spaceId, {
            type: 'note', title, content, tags,
            x: centerX, y: centerY,
            inquiry_question: currentSpace?.inquiry_question,
            views: [activeViewId],
          });
          const realNote = apiNoteToNote(created, authorName);

          // Track note creation
          if (spaceId) {
            trackEvent({
              event_type: 'note_created',
              object_type: 'note',
              object_id: created.id,
              space_id: spaceId,
              metadata_json: { type: 'note', scaffold_id: activeScaffold?.id, word_count: content.split(/\s+/).length },
            });
          }

          // Replace temp note with real note (preserves real ID for relations)
          setNotes(prev => prev.map(n => n.id === tempId ? realNote : n));

          if (buildOn) {
            try {
              const realEdge = await createBuildOnRelation(created.id, buildOn);
              // Replace temp edge with real edge (correct source ID)
              setEdges(prev => prev.map(e => e.source === tempId ? realEdge : e));
            } catch (relErr) {
              console.error('Failed to create relation:', relErr);
              // Remove temp edge if relation creation failed
              setEdges(prev => prev.filter(e => e.source !== tempId));
            }
          }
        } catch (err) {
          console.error('Failed to sync note with backend:', err);
          // Keep optimistic note visible; edge was already cleaned up above
        }
      }
      return;
    }

    // 自动保存过的 Build-on 草稿也走这里：关系在自动保存时已经建好，这里不再建
    if (editingNote) saveEdits(editingNote.id);

    closeNoteEditor();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatingNew, editingNote, buildOnParentId, buildOnRelationType, notes, viewPort, activeViewId, activeScaffold,
      spaceId, user, currentSpace?.inquiry_question, closeNoteEditor, createBuildOnRelation, canEditNote, lang, refetchSpace, openFold]);

  const handleAiNotePublished = useCallback((
    createdNote: Parameters<typeof apiNoteToNote>[0],
    createdRelation: Parameters<typeof apiRelationToEdge>[0],
  ) => {
    const nextNote = apiNoteToNote(createdNote, user?.name);
    const nextEdge = apiRelationToEdge(createdRelation);
    setNotes(prev => prev.some(note => note.id === nextNote.id) ? prev : [...prev, nextNote]);
    setEdges(prev => prev.some(edge => edge.id === nextEdge.id) ? prev : [...prev, nextEdge]);
    openFold(nextEdge.target);
  }, [setEdges, setNotes, user?.name, openFold]);
  
  const handleSaveDrawing = useCallback(async (title: string, elements: DrawingElement[]) => {
    if (drawingToEdit) {
      if (spaceId && drawingToEdit.id) {
        notesApi.update(drawingToEdit.id, { title, drawing_data: elements } as Parameters<typeof notesApi.update>[1]).catch(console.error);
        trackEvent({
          event_type: 'drawing_updated',
          object_type: 'note',
          object_id: drawingToEdit.id,
          space_id: spaceId,
        });
      }
      setNotes(prev => prev.map(n => n.id === drawingToEdit.id ? { ...n, title, drawingData: elements } : n));
    } else {
      const centerX = (-viewPort.x + (window.innerWidth / 2)) / viewPort.zoom;
      const centerY = (-viewPort.y + (window.innerHeight / 2)) / viewPort.zoom;

      if (spaceId) {
        try {
          const { note: created } = await notesApi.create(spaceId, {
            type: 'drawing', title,
            x: centerX, y: centerY,
            width: 200, height: 200,
            drawing_data: elements,
            views: [activeViewId],
          } as Parameters<typeof notesApi.create>[1]);
          // 同上：转换放在 updater 外，异常才落进下面的 catch 而不是渲染期。
          const savedNote = apiNoteToNote(created, user?.name);
          setNotes(prev => [...prev, savedNote]);
          trackEvent({
            event_type: 'drawing_created',
            object_type: 'note',
            object_id: created.id,
            space_id: spaceId,
            metadata_json: { shape_count: elements.length },
          });
        } catch (err) {
          console.error('Failed to save drawing:', err);
        }
      } else {
        setNotes(prev => [...prev, {
          id: Date.now().toString(),
          type: 'drawing', title,
          author: user?.name ?? 'Current user',
          date: new Date().toLocaleString(),
          createdAt: new Date().toISOString(),
          authorAvatar: user?.avatar,
          x: centerX, y: centerY,
          drawingData: elements,
          width: 200, height: 200,
          views: [activeViewId],
        }]);
      }
    }
    setIsDrawingOpen(false);
    setDrawingToEdit(null);
    setActiveTool('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingToEdit, viewPort, activeViewId, spaceId, user]);

  // Canvas-native Rise Above: create note directly above selected notes, then open editor
  /**
   * 开一间 Rise Above 讨论室。
   *
   * 旧版这里直接建一条「综合」笔记再让 AI 写摘要。现在改成开讨论室：
   * 同学先就这几条笔记争一轮，那句更高一层的说法由他们自己写完再发布。
   */
  const reloadRiseAboveRooms = useCallback(async () => {
    if (!spaceId) { setRiseAboveRooms([]); return; }
    try {
      const { rooms } = await riseAboveApi.listForSpace(spaceId);
      setRiseAboveRooms(rooms as any);
    } catch { setRiseAboveRooms([]); }
  }, [spaceId]);
  useEffect(() => { void reloadRiseAboveRooms(); }, [reloadRiseAboveRooms]);

  const handleOpenRiseAboveRoom = useCallback(async (ids: string[]) => {
    if (!spaceId || ids.length < 2) return;
    const cited = notes.filter(n => ids.includes(n.id));
    let cardX = 0, cardY = 0;
    if (cited.length) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity;
      cited.forEach(n => {
        const { w } = getNoteDimensions(n);
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x + w); minY = Math.min(minY, n.y);
      });
      cardX = (minX + maxX) / 2 - 120;
      cardY = minY - 200;
    }
    try {
      const { room } = await riseAboveApi.create(spaceId, {
        source_note_ids: ids, card_x: cardX, card_y: cardY,
      });
      setMultiSelectedIds(new Set());
      setRiseAboveRoomId(room.id);
      void reloadRiseAboveRooms();
    } catch (e) {
      console.error('[riseabove] 开讨论室失败', e);
    }
  }, [spaceId, notes, reloadRiseAboveRooms]);
  
  const handleContextMenu = useCallback((e: React.MouseEvent, note: Note) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      noteId: note.id,
      type: note.type
    });
  }, []);
  
  const closeContextMenu = () => setContextMenu(null);
  /**
   * 笔记页右下角的 Build-on：打开的是别人的笔记，选好了方式。和画布右键 → Build-on → 打开编辑器
   * 是同一件事，只是不再弹一次选方式的窗口；编辑器原地换成新的 Build-on 草稿，左侧先显示原笔记。
   */
  const handleBuildOnFromNotePage = useCallback((parentId: string, relationType: RelationType) => {
    if (spaceId) {
      trackEvent({
        event_type: 'buildon_initiated',
        object_type: 'note',
        object_id: parentId,
        space_id: spaceId,
        metadata_json: { relation_type: relationType, source: 'note_page' },
      });
    }
    startNewNote({ parentId, relationType });
  }, [spaceId, startNewNote]);

  const handleBuildOnAction = () => {
    if(contextMenu) {
      if (spaceId) {
        trackEvent({
          event_type: 'buildon_initiated',
          object_type: 'note',
          object_id: contextMenu.noteId,
          space_id: spaceId,
          metadata_json: { relation_type: buildOnRelationType },
        });
      }
      setBuildOnParentId(contextMenu.noteId);
      closeContextMenu();
      setShowBuildOnComposer(true);
    }
  };
  const handleDeleteAction = async () => {
    if (!contextMenu) return;
    const noteToDelete = notes.find(n => n.id === contextMenu.noteId);
    const canDeleteNote = Boolean(noteToDelete && (
      !spaceId || noteToDelete.authorId === user?.id || viewerIsStaff
    ));

    if (!canDeleteNote) {
      window.alert(lang === 'zh'
        ? '你只能删除自己创建的 Note。'
        : 'You can only delete Notes you created.');
      closeContextMenu();
      return;
    }

    if (window.confirm(lang === 'zh' ? '确定要删除这个 Note 吗？' : 'Are you sure you want to delete this Note?')) {
      const noteId = contextMenu.noteId;
      // A note that never reached the server (still uploading, or left over
      // from an older client build) has no row to delete — drop it locally.
      const isLocalOnly = !UUID_RE.test(noteId);
      try {
        if (spaceId && !isLocalOnly) {
          await notesApi.delete(noteId);
          trackEvent({
            event_type: 'note_deleted',
            object_type: 'note',
            object_id: noteId,
            space_id: spaceId,
          });
        }
        setNotes(prev => prev.filter(n => n.id !== noteId));
        setEdges(prev => prev.filter(e => e.source !== noteId && e.target !== noteId));
      } catch (error) {
        console.error(error);
        const isForbidden = error instanceof ApiClientError && error.status === 403;
        const serverMessage = error instanceof Error ? error.message : '';
        window.alert(lang === 'zh'
          ? (isForbidden
            ? '删除没有保存到服务器：你只能删除自己创建的 Note。'
            : `删除没有保存到服务器${serverMessage ? `：${serverMessage}` : '，请稍后重试。'}`)
          : (isForbidden
            ? 'Delete was not saved: you can only delete Notes you created.'
            : `Delete was not saved${serverMessage ? `: ${serverMessage}` : '. Please try again.'}`));
      }
    }
    closeContextMenu();
  };
  
  /**
   * 固定、附件显示方式是共享画布的版式，和卡片位置一样，空间成员都能改（PATCH /presentation）。
   * 先改本地，没存上就退回原样并提示。以前走作者专用的 PUT，同学点了 403 被吞掉，
   * 看着改了，刷新又回到原样。
   */
  const savePresentation = (target: Note, patch: NotePresentation, undo: NotePresentation) => {
    const apply = (note: Note, p: NotePresentation): Note => ({
      ...note,
      ...(p.is_fixed !== undefined ? { isFixed: p.is_fixed } : {}),
      ...(p.display_mode !== undefined ? { isPreviewMode: p.display_mode === 'media' } : {}),
      metadata: { ...(note.metadata ?? {}), ...p },
    });
    setNotes(prev => prev.map(n => (n.id === target.id ? apply(n, patch) : n)));
    if (!spaceId || !UUID_RE.test(target.id)) return;

    notesApi.updatePresentation(target.id, patch).catch(error => {
      console.error('Failed to save note presentation:', error);
      // 失败回来之前可能又点了一次，那一次的结果不退
      const stillOurs = (n: Note) => Object.entries(patch).every(([key, value]) => n.metadata?.[key] === value);
      setNotes(prev => prev.map(n => (n.id === target.id && stillOurs(n) ? apply(n, undo) : n)));
      const zh = lang === 'zh';
      const what = patch.is_fixed === undefined
        ? (zh ? '显示方式' : 'The display change')
        : patch.is_fixed
          ? (zh ? '固定' : 'Fixing this card')
          : (zh ? '取消固定' : 'Unfixing this card');
      const status = error instanceof ApiClientError ? error.status : 0;
      const reason = status === 403
        ? (zh ? '你没有这个空间的权限。' : 'You do not have access to this space.')
        : status === 404
          ? (zh ? '这条 Note 已被删除。' : 'This Note has been deleted.')
          : (zh ? '请稍后重试。' : 'Please try again.');
      window.alert(zh
        ? `${what}没有保存到服务器，已恢复原样。${reason}`
        : `${what} was not saved and has been undone. ${reason}`);
    });
  };

  const handleTogglePreview = () => {
    if (!contextMenu) return;
    const target = notes.find(n => n.id === contextMenu.noteId);
    closeContextMenu();
    if (!target) return;
    const current = target.isPreviewMode ? 'media' : 'card';
    savePresentation(target, { display_mode: current === 'media' ? 'card' : 'media' }, { display_mode: current });
  };

  const handleToggleFixed = () => {
    if (!contextMenu) return;
    const target = notes.find(n => n.id === contextMenu.noteId);
    closeContextMenu();
    if (!target) return;
    savePresentation(target, { is_fixed: !target.isFixed }, { is_fixed: Boolean(target.isFixed) });
  };

  // useCallback：这三个回调直接传给 memo 化的 NoteItem，
  // 每次渲染新建函数会让 memo 完全失效，拖动又回到全量重渲染。
  const handleDoubleClickNote = useCallback((e: React.MouseEvent, note: Note) => {
    e.stopPropagation();
    if (spaceId) {
      trackEvent({
        event_type: 'note_opened',
        object_type: 'note',
        object_id: note.id,
        space_id: spaceId,
        metadata_json: { note_type: note.type },
      });
    }
    if (note.type === 'view') {
        const fromViewId = activeViewId;
        goToView(note.id);
        if (spaceId) {
          trackEvent({
            event_type: 'view_switched',
            object_type: 'view',
            object_id: note.id,
            space_id: spaceId,
            metadata_json: { from_view_id: fromViewId, to_view_id: note.id },
          });
        }
    } else if (note.type === 'ai_dialogue') {
        // 采纳反馈生成的笔记：打开的是对话，不是一个可编辑的文本框
        setDialogueNote(note);
    } else if (note.type === 'drawing') {
        setDrawingToEdit(note);
        setIsDrawingOpen(true);
    } else if (isCollaborativeDocument(note)) {
        setCollabDocument(note);
    } else if (note.fileUrl) {
        setViewingFile(note);
    } else {
        // 从讨论室发布出来的 rise-above 笔记，双击回到当初那场讨论 ——
        // 讨论过程本身就是这条笔记的一部分，不该被埋掉。
        // 老的 rise-above 笔记（没有对应讨论室）照旧进编辑器。
        const room = note.type === 'riseabove'
          ? riseAboveRooms.find(r => r.published_note_id === note.id)
          : undefined;
        if (room) {
          setRiseAboveRoomId(room.id);
        } else {
          setEditingNote(note);
          setIsCreatingNew(false);
        }
    }
  }, [spaceId, activeViewId, goToView, riseAboveRooms]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      // 详情面板等浮层渲染在画布容器**内部**，滚轮事件会冒泡到这里。
      // 这个监听器无条件 preventDefault 去做缩放，于是浮层永远滚不动。
      if ((e.target as HTMLElement | null)?.closest('[data-canvas-overlay]')) return;
      e.preventDefault();
      const zoomSensitivity = -0.001;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setViewPort(prev => {
        const newZoom = Math.min(Math.max(prev.zoom + e.deltaY * zoomSensitivity, 0.1), 3);
        const worldX = (mouseX - prev.x) / prev.zoom;
        const worldY = (mouseY - prev.y) / prev.zoom;
        const newX = mouseX - worldX * newZoom;
        const newY = mouseY - worldY * newZoom;
        return { x: newX, y: newY, zoom: newZoom };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);
  
  const handleMouseDownCanvas = (e: React.MouseEvent) => {
    if (contextMenu?.visible) closeContextMenu();
    closePeekNow();
    setSelectedNoteId(null);
    // Clear multi-selection on plain canvas click (not shift)
    if (!e.shiftKey) setMultiSelectedIds(new Set());
    if (e.button === 0 || e.button === 1) {
      setDragMode('pan');
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    pendingDeltaRef.current = { dx: 0, dy: 0 };
    }
  };

  const handleMouseDownNote = useCallback((e: React.MouseEvent, note: Note) => {
    e.stopPropagation();
    setContextMenu(prev => (prev?.visible ? null : prev));
    closePeekNow();
    if (e.button !== 0) return;

    if (e.shiftKey) {
      // Shift+click: toggle this note in multi-select; do NOT drag
      setMultiSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(note.id)) { next.delete(note.id); } else { next.add(note.id); }
        return next;
      });
      setSelectedNoteId(null);
      return;
    }

    // Plain click: clear multi-select, select single note, enable drag
    setMultiSelectedIds(new Set());
    setSelectedNoteId(note.id);
    if (note.isFixed) return; // 固定的对象只选中，不进入拖动
    dragModeRef.current = 'note';
    setDragMode('note');
    setDraggingNoteId(note.id);
    draggingNoteIdRef.current = note.id;
    draggedNotePositionRef.current = { x: note.x, y: note.y };
    dragOriginRef.current = { x: note.x, y: note.y };
    // 原点在一次拖动中不会变（画布不滚动，视口也不动），量一次就够。
    const rect = worldOriginRef.current?.getBoundingClientRect();
    if (rect) {
      const zoom = viewPortRef.current.zoom;
      worldRectRef.current = { left: rect.left, top: rect.top };
      grabOffsetRef.current = {
        x: (e.clientX - rect.left) / zoom - note.x,
        y: (e.clientY - rect.top) / zoom - note.y,
      };
    } else {
      worldRectRef.current = null;
      grabOffsetRef.current = null;
    }
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    dragMovedRef.current = false;
    pendingDeltaRef.current = { dx: 0, dy: 0 };
  }, [closePeekNow]);

  /** 右下角手柄：只改尺寸，不进入位移。 */
  const handleNoteResizeStart = useCallback((e: React.MouseEvent, note: Note) => {
    if (e.button !== 0 || note.isFixed) return;
    e.stopPropagation();
    closePeekNow();
    setContextMenu(prev => (prev?.visible ? null : prev));
    setMultiSelectedIds(new Set());
    setSelectedNoteId(note.id);
    setDragMode('noteResize');
    setDraggingNoteId(note.id);
    draggingNoteIdRef.current = note.id;
    resizedNoteSizeRef.current = {
      width: note.width ?? getNoteDimensions(note).w,
      height: note.height ?? getNoteDimensions(note).h,
    };
    dragOriginRef.current = {
      x: note.x, y: note.y,
      width: resizedNoteSizeRef.current.width,
      height: resizedNoteSizeRef.current.height,
    };
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    dragMovedRef.current = false;
    pendingDeltaRef.current = { dx: 0, dy: 0 };
  }, [closePeekNow]);
  
  const handleScrollbarXMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDragMode('scrollX');
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    pendingDeltaRef.current = { dx: 0, dy: 0 };
    setInitialViewPort({ ...viewPort });
  };
  
  const handleScrollbarYMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDragMode('scrollY');
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    pendingDeltaRef.current = { dx: 0, dy: 0 };
    setInitialViewPort({ ...viewPort });
  };
  
  const viewportWorldRect = {
    x: -viewPort.x / viewPort.zoom,
    y: -viewPort.y / viewPort.zoom,
    w: window.innerWidth / viewPort.zoom,
    h: window.innerHeight / viewPort.zoom
  };
  
  const getScrollbarMetrics = (axis: 'x' | 'y') => {
    const isX = axis === 'x';
    const min = isX ? contentBounds.minX : contentBounds.minY;
    const range = isX ? contentBounds.width : contentBounds.height;
    const vpPos = isX ? viewportWorldRect.x : viewportWorldRect.y;
    const vpSize = isX ? viewportWorldRect.w : viewportWorldRect.h;
    let posPct = (vpPos - min) / range;
    let sizePct = vpSize / range;
    if (sizePct > 1) sizePct = 1;
    if (posPct < 0) posPct = 0;
    if (posPct + sizePct > 1) posPct = 1 - sizePct;
    return { pos: posPct * 100, size: sizePct * 100 };
  };
  
  const scrollX = getScrollbarMetrics('x');
  const scrollY = getScrollbarMetrics('y');
  
  /**
   * 从支架库里选一条 → 开一条新笔记，正文里已经放好「支架[ ]」。
   * 标题留空让学生自己写：支架是句头，不是笔记的名字。
   */
  const handleUseScaffold = (scaffold: Scaffold) => {
      setIsScaffoldModalOpen(false);
      setActiveScaffold(scaffold);
      if (spaceId) {
        void scaffoldsApi.use(scaffold.id, { space_id: spaceId }).catch(() => undefined);
      }
      startNewNote();
  };

  /**
   * 地址 → 状态。只在地址真的变了时动手，用 lastPathRef 记住上一次消化过的地址。
   *
   * 不用 useNavigationType 判断「是不是用户点的后退」：页面加载过程中别处也会 navigate，
   * 类型早就不是 POP 了，直接打开 /note/:id 的链接会因此打不开。改成比地址本身，
   * 我们自己 push 的地址在这里跑一遍也是幂等的（set 同一个对象 React 会自行短路）。
   */
  useEffect(() => {
    const path = location.pathname;
    if (lastPathRef.current === path) return;

    if (!routeNoteId) {
      // 从笔记页回到画布才算关闭；首屏就在画布上时不该动任何状态
      if (lastPathRef.current?.includes('/note/') && (editingNote || isCreatingNew)) {
        closeNoteEditor();
        justAdoptedRef.current = true;
      }
      lastPathRef.current = path;
      return;
    }

    if (routeNoteId === 'new') {
      if (!isCreatingNew || editingNote) {
        startNewNote();
        justAdoptedRef.current = true;
      }
      lastPathRef.current = path;
      return;
    }

    const target = notes.find(note => note.id === routeNoteId);
    if (target) {
      if (editingNote?.id !== target.id || isCreatingNew) {
        // 地址换成了另一条笔记（浏览器前进后退）：编辑器里原来那条草稿连同 Build-on 意图作废
        editorSessionRef.current += 1;
        clearBuildOn();
        setEditingNote(target);
        setIsCreatingNew(false);
        justAdoptedRef.current = true;
      }
      lastPathRef.current = path;
      return;
    }
    // 笔记还没拉回来：不记 lastPathRef，等 notes 到齐再跑一遍
    if (notes.length > 0) {
      // 链接失效，退回画布，不往历史里塞垃圾
      lastPathRef.current = workspaceBasePath;
      navigate(workspaceBasePath, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, routeNoteId, notes]);

  /**
   * 状态 → 地址。只在「开着哪条笔记」变了时跑，不依赖地址。
   * 守卫那一句管首屏：地址指着一条笔记、而上面那个 effect 还没消化它时先别动地址，
   * 否则直接打开 /note/:id 的链接会被这里当场抹回画布。
   */
  useEffect(() => {
    const path = pathRef.current;
    // 上面那个 effect 刚改过状态，这一轮读到的还是旧的，等下一轮
    if (justAdoptedRef.current) { justAdoptedRef.current = false; return; }
    // 地址指着一条笔记但还没被消化（笔记没加载完 / 首屏），别把地址抹回画布
    if (path.includes('/note/') && lastPathRef.current !== path) return;
    // 讨论室有自己的一对 effect，这里不能顺手把它的地址改回画布
    if (path.includes('/riseabove/')) return;
    const target = isCreatingNew || (editingNote && !editingNote.id)
      ? `${workspaceBasePath}/note/new`
      : editingNote
        ? `${workspaceBasePath}/note/${editingNote.id}`
        : workspaceBasePath;
    if (path === target) return;
    navigate(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatingNew, editingNote?.id, workspaceBasePath]);

  /**
   * 讨论室的地址同步。和笔记那一对是各自独立的：两边守卫的路径段不同
   * （/note/ 与 /riseabove/），互不触发。
   */
  // 地址 → 状态：只在地址变了时跑。以前也依赖状态，于是关掉讨论室（状态先清空、地址还没改）
  // 的那一轮里它又按旧地址把讨论室打开了 —— 发布之后学生被弹回讨论室，看到「已经发布过了」。
  useEffect(() => {
    if (routeRiseAboveId && routeRiseAboveId !== riseAboveRoomId) {
      setRiseAboveRoomId(routeRiseAboveId);
    } else if (!routeRiseAboveId && riseAboveRoomId && !pathRef.current.includes('/riseabove/')) {
      // 浏览器后退离开了讨论室的地址
      setRiseAboveRoomId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeRiseAboveId]);

  useEffect(() => {
    const path = pathRef.current;
    const onRoomPath = path.includes('/riseabove/');
    if (riseAboveRoomId) {
      const target = `${workspaceBasePath}/riseabove/${riseAboveRoomId}`;
      if (path !== target) navigate(target);
    } else if (onRoomPath) {
      // 关掉讨论室就退回画布；用 replace 免得后退键又把它翻出来
      navigate(workspaceBasePath, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riseAboveRoomId, workspaceBasePath]);

  const handleUpdateScaffolds = (updatedScaffolds: Scaffold[]) => {
      setScaffolds(updatedScaffolds);
  };

  // Handle New Task from Group Modal
  const handleGroupTaskCreate = (task: GroupTask) => {
      addNotification({
          type: 'task',
          title: 'New Group Task',
          message: `Task "${task.title}" created in your group.`,
          link: { type: 'group', id: task.groupId }
      });
  };

  const handleNotificationClick = (n: Notification) => {
      // Mark as read locally + persist to backend
      setNotifications(prev => prev.map(notif => notif.id === n.id ? { ...notif, read: true } : notif));
      notificationsApi.markRead(n.id).catch(() => { /* best-effort */ });
      
      // Navigate
      if (n.link) {
          if (n.link.type === 'group') setIsGroupModalOpen(true);
          if (n.link.type === 'view') goToView(n.link.id);
          if (n.link.type === 'note') {
              const targetNote = notes.find(note => note.id === n.link!.id);
              if (targetNote) {
                  // Center view on note
                  const newX = -targetNote.x * viewPort.zoom + window.innerWidth / 2;
                  const newY = -targetNote.y * viewPort.zoom + window.innerHeight / 2;
                  setViewPort(prev => ({ ...prev, x: newX, y: newY }));
                  // Highlight it (by editing or selecting)
                  setEditingNote(targetNote);
              }
          }
      }
  };

  const focusNote = useCallback((noteId: string) => {
    const targetNote = notes.find(note => note.id === noteId);
    if (!targetNote) return;
    revealNotes([targetNote.id]);
    const newX = -targetNote.x * viewPort.zoom + window.innerWidth / 2;
    const newY = -targetNote.y * viewPort.zoom + window.innerHeight / 2;
    setViewPort(prev => ({ ...prev, x: newX, y: newY }));
    setSelectedNoteId(targetNote.id);
  }, [notes, viewPort.zoom, revealNotes]);

  const openTimelineNote = async (id:string, targetSpace?:string) => {
    try {
      const {note:raw}=await notesApi.get(id);
      const note=apiNoteToNote(raw,user?.name);
      if(targetSpace&&targetSpace!==spaceId&&courseId){
        const {spaces}=await coursesApi.listSpaces(courseId);
        const target=spaces.find(s=>s.id===targetSpace);
        if(!target)throw new Error('Space unavailable');
        setPendingTimelineNote({note,spaceId:targetSpace,observedLoading:false});
        setCurrentSpace(target);setSpaceId(targetSpace);
      }else{setEditingNote(note);setIsCreatingNew(false);focusNote(id);}
      setTimelineOpen(false);setBuildOnNetOpen(false);
    }catch{window.alert(lang==='zh'?'暂时无法打开这条 Note，请重试。':'Could not open this Note. Please retry.');}
  };
  useEffect(()=>{
    if(!pendingTimelineNote||spaceId!==pendingTimelineNote.spaceId)return;
    if(spaceLoading&&!pendingTimelineNote.observedLoading){setPendingTimelineNote({...pendingTimelineNote,observedLoading:true});return;}
    if(spaceLoading||!pendingTimelineNote.observedLoading)return;
    const note=pendingTimelineNote.note;
    setNotes(current=>current.some(n=>n.id===note.id)?current:[...current,note]);
    setEditingNote(note);setIsCreatingNew(false);setPendingTimelineNote(null);
  },[pendingTimelineNote,spaceId,spaceLoading,setNotes]);

  /**
   * 「我的笔记」（2026-10-05 用户：学生在画布上一下子找不到自己的 note）。
   * 卡片浅蓝底只解决「在眼前的认得出」；画布大了，自己的笔记在屏幕外，什么颜色都看不到。
   * 开着时别人的卡片淡下去，细栏上一条一条把自己的笔记移到画布中间，新的在前。
   * 只移画布、不选中：选中会弹出右侧详情栏。
   */
  const [mineFocus, setMineFocus] = useState(false);
  const [mineIndex, setMineIndex] = useState(0);
  const myNotes = useMemo(
    () => visibleNotes
      .filter(n => isOwnNote(n, user?.id))
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
    [visibleNotes, user?.id],
  );
  const myNoteIds = useMemo(() => new Set(myNotes.map(n => n.id)), [myNotes]);
  const panToNote = useCallback((note: Note) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const { w, h } = getNoteDimensions(note);
    setViewPort(prev => ({
      ...prev,
      x: (rect?.width ?? window.innerWidth) / 2 - (note.x + w / 2) * prev.zoom,
      y: (rect?.height ?? window.innerHeight) / 2 - (note.y + h / 2) * prev.zoom,
    }));
  }, []);
  const showMyNote = useCallback((index: number) => {
    if (myNotes.length === 0) return;
    const next = ((index % myNotes.length) + myNotes.length) % myNotes.length;
    setMineIndex(next);
    revealNotes([myNotes[next].id]);
    panToNote(myNotes[next]);
  }, [myNotes, panToNote, revealNotes]);
  const toggleMineFocus = useCallback(() => {
    if (mineFocus) {
      setMineFocus(false);
      return;
    }
    setMineFocus(true);
    setMineIndex(0);
    if (myNotes.length > 0) {
      revealNotes([myNotes[0].id]);
      panToNote(myNotes[0]);
    }
  }, [mineFocus, myNotes, panToNote, revealNotes]);
  useEffect(() => { setMineIndex(0); }, [activeViewId]);
  useEffect(() => {
    if (!mineFocus) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMineFocus(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mineFocus]);

  /**
   * 问题栏后面滚动的讨论主题（2026-10-05）。点一个主题：画布移到相关的第一条笔记，相关的几条亮四秒。
   * 用单独的高亮，不借多选：多选会弹出批量操作的工具条，学生只是想看看是哪几条。
   */
  const topicFingerprint = useMemo(() => notesFingerprint(visibleNotes), [visibleNotes]);
  const viewTopicList = useViewTopics(spaceId, activeViewId, topicFingerprint);
  const [topicHighlight, setTopicHighlight] = useState<ReadonlySet<string>>(() => new Set());
  const topicHighlightTimer = useRef(0);
  /** 相关的几条亮四秒（讨论主题、搜索结果、悬停列表里点的那条） */
  const flashNotes = useCallback((ids: readonly string[]) => {
    setTopicHighlight(new Set(ids));
    window.clearTimeout(topicHighlightTimer.current);
    topicHighlightTimer.current = window.setTimeout(() => setTopicHighlight(new Set()), 4000);
  }, []);
  const selectTopic = useCallback((topic: ViewTopic) => {
    const ids = topic.noteIds.filter(id => visibleNoteById.has(id));
    if (ids.length === 0) return;
    revealNotes(ids);
    panToNote(visibleNoteById.get(ids[0])!);
    flashNotes(ids);
  }, [visibleNoteById, panToNote, revealNotes, flashNotes]);
  useEffect(() => () => window.clearTimeout(topicHighlightTimer.current), []);

  /** 搜索结果、悬停列表里点了一条：藏着就先展开，画布移过去，选中（右侧出详情），亮几秒 */
  const locateNote = useCallback((id: string) => {
    const note = visibleNoteById.get(id);
    if (!note) return;
    closePeekNow();
    revealNotes([id]);
    panToNote(note);
    setMultiSelectedIds(new Set());
    setSelectedNoteId(id);
    flashNotes([id]);
  }, [visibleNoteById, closePeekNow, revealNotes, panToNote, flashNotes]);

  /**
   * 画布搜索（2026-10-09）。当前视图的笔记（含收起藏着的）+ 其他视图的笔记。
   * 拖卡片时 notes 每帧换新，这份清单沿用上一次的，不然搜索框每帧把全部正文重新取一遍。
   */
  const searchItemsRef = useRef<CanvasSearchItem[]>([]);
  const searchItems = useMemo<CanvasSearchItem[]>(() => {
    if (dragMode === 'note' || dragMode === 'noteResize') return searchItemsRef.current;
    const here = new Set(visibleNotes.map(n => n.id));
    const viewTitles = new Map(views.map(v => [v.id, v.title]));
    const items: CanvasSearchItem[] = [];
    for (const note of visibleNotes) {
      if (note.type !== 'view') items.push({ note, folded: foldHidden.has(note.id) });
    }
    for (const note of notes) {
      if (here.has(note.id) || note.type === 'view') continue;
      const viewId = note.views?.find(v => v !== activeViewId && viewTitles.has(v));
      if (viewId) items.push({ note, viewId, viewTitle: viewTitles.get(viewId) });
    }
    searchItemsRef.current = items;
    return items;
  }, [dragMode, visibleNotes, notes, views, activeViewId, foldHidden]);
  /** 正在搜：当前视图里命中的笔记；其余卡片调淡 */
  const [searchMatches, setSearchMatches] = useState<ReadonlySet<string> | null>(null);
  /** 点了别的视图里的笔记：先切过去，那边的笔记到了再定位 */
  const [pendingLocate, setPendingLocate] = useState<{ id: string; viewId: string } | null>(null);
  const handleSearchPick = useCallback((item: CanvasSearchItem) => {
    if (spaceId && UUID_RE.test(item.note.id)) {
      trackEvent({
        event_type: 'canvas_search_picked',
        object_type: 'note',
        object_id: item.note.id,
        space_id: spaceId,
        metadata_json: { other_view: Boolean(item.viewId), folded: Boolean(item.folded), view_id: activeViewId },
      });
    }
    if (item.viewId && item.viewId !== activeViewId) {
      setPendingLocate({ id: item.note.id, viewId: item.viewId });
      goToView(item.viewId);
      return;
    }
    locateNote(item.note.id);
  }, [spaceId, activeViewId, goToView, locateNote]);
  useEffect(() => {
    if (!pendingLocate) return;
    if (pendingLocate.viewId !== activeViewId) { setPendingLocate(null); return; }
    if (!visibleNoteById.has(pendingLocate.id)) return;
    setPendingLocate(null);
    locateNote(pendingLocate.id);
  }, [pendingLocate, activeViewId, visibleNoteById, locateNote]);
  /** 讨论分析里点的笔记：在这个视图就直接定位，在别的视图先切过去（和搜索一样） */
  const locateAnyNote = useCallback((id: string) => {
    if (visibleNoteById.has(id)) { locateNote(id); return; }
    const item = searchItems.find(entry => entry.note.id === id);
    if (item?.viewId && item.viewId !== activeViewId) {
      setPendingLocate({ id, viewId: item.viewId });
      goToView(item.viewId);
    }
  }, [visibleNoteById, locateNote, searchItems, activeViewId, goToView]);
  const analyticsNoteTitles = useMemo(
    () => new Map(notes.map(note => [note.id, { title: note.title, authorId: note.authorId ?? null }])),
    [notes],
  );
  const handlePeekPick = useCallback((id: string) => {
    if (spaceId && UUID_RE.test(id)) {
      trackEvent({
        event_type: 'buildon_peek_picked',
        object_type: 'note',
        object_id: id,
        space_id: spaceId,
        target_note_id: peekNoteIdRef.current && UUID_RE.test(peekNoteIdRef.current) ? peekNoteIdRef.current : undefined,
        metadata_json: { view_id: activeViewId },
      });
    }
    locateNote(id);
  }, [spaceId, activeViewId, locateNote]);

  const headerTitle = courseTitle || currentSpace?.title || (lang === 'zh' ? '知识空间' : 'Workspace');

  return (
    <div ref={workspaceMotionRef} className="gsap-workspace-shell flex flex-col h-screen bg-white dark:bg-gray-950 overflow-hidden" onClick={() => contextMenu?.visible && closeContextMenu()}>
      <Header
        title={headerTitle}
        userRole={userRole}
        userName={user?.name}
        lang={lang}
        setLang={setLang}
        views={views}
        activeViewId={activeViewId}
        onViewSelect={goToView}
        onOpenViewManager={() => setIsViewPanelOpen(true)}
        notifications={notifications}
        onNotificationClick={handleNotificationClick}
        onExit={handleExit}
        onLogout={logout}
        isWorkspaceAgentOpen={isWorkspaceAgentOpen}
        onToggleWorkspaceAgent={() => setIsWorkspaceAgentOpen(v => !v)}
        onOpenAnalytics={viewerIsStaff ? () => setIsAnalyticsOpen(true) : undefined}
        afterTitle={spaceId ? (
          <CanvasSearch
            lang={lang === 'zh' ? 'zh' : 'en'}
            items={searchItems}
            onPick={handleSearchPick}
            onMatchesChange={setSearchMatches}
          />
        ) : undefined}
      />
      
      <div className="gsap-workspace-toolbar flex flex-1 overflow-hidden relative bg-gray-100 dark:bg-gray-950">
        <Sidebar
          collaborativeDocumentsEnabled={COLLAB_ENABLED}
          activeTool={activeTool}
          onToolSelect={handleToolSelect}
          onToolOpen={handleToolOpen}
          onFileUpload={handleFileUpload}
          onOpenAttachmentModal={() => setIsAttachmentModalOpen(true)}
          isStaff={viewerIsStaff}
          lang={lang}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          onOpenIdeaGraph={() => setIdeaGraphOpen(true)}
          onOpenMap={() => {setNetworkFocus(null);setNetworkSpace(null);setBuildOnNetOpen(true);}}
          onOpenTimeline={() => {setTimelineFocus(null);setTimelineOpen(true);}}
          onOpenGroups={() => setIsGroupModalOpen(true)}
          onOpenMembers={() => setIsMemberModalOpen(true)}
          mineActive={mineFocus}
          onToggleMine={toggleMineFocus}
        />
        
        {/* Canvas column: inquiry strip + canvas */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Inquiry knowledge strip */}
          <div className="relative z-10 shrink-0">
            <div
              className="flex h-[38px] items-center gap-2.5 border-b border-gray-200 dark:border-gray-800 bg-white/92 dark:bg-gray-950/90 px-3 backdrop-blur-sm"
              onClick={() => setIsKnowledgePanelOpen(prev => !prev)}
              style={{ cursor: 'pointer' }}
            >
              <RemixIcon name="focus-3-line" size={14} className="shrink-0 text-[#000080] dark:text-blue-300" />
              {/* 这一栏是问题、讨论主题和几个数，合起来是讨论的概况（2026-10-09 把英文 inquiry 换掉）。
                  不叫「AI 概况」：问题是老师写的、数是统计出来的，只有滚动的主题是 AI 归纳的。 */}
              <span className="shrink-0 text-[0.6875rem] font-semibold tracking-wide text-gray-500 dark:text-gray-400">
                {lang === 'zh' ? '讨论概况' : 'Overview'}
              </span>
              <span className={`min-w-0 truncate text-xs font-medium text-gray-800 dark:text-gray-200 ${viewTopicList.length > 0 ? 'max-w-[42%] shrink' : 'flex-1'}`}>
                {currentSpace?.inquiry_question || (lang === 'zh' ? '我们共同讨论的问题' : 'The question we are working on together')}
              </span>
              {viewTopicList.length > 0 && (
                <>
                  <span aria-hidden="true" className="h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />
                  <ViewTopicTicker topics={viewTopicList} lang={lang === 'zh' ? 'zh' : 'en'} onSelect={selectTopic} />
                </>
              )}
              <span className="flex items-center gap-3 shrink-0 text-[0.6875rem] text-gray-500">
                <span><span className="font-semibold text-gray-700 dark:text-gray-300">{visibleNotes.length}</span> {lang === 'zh' ? '想法' : 'ideas'}</span>
                <span><span className="font-semibold text-gray-700 dark:text-gray-300">{viewEdgeCount}</span> Build-on</span>
                <span><span className="font-semibold text-gray-700 dark:text-gray-300">{visibleNotes.filter(n => n.type === 'riseabove').length}</span> {lang === 'zh' ? '综合升华' : 'Rise Above'}</span>
              </span>
              <RemixIcon
                name={isKnowledgePanelOpen ? 'arrow-up-s-line' : 'arrow-down-s-line'}
                size={16}
                className="shrink-0 text-gray-400"
              />
            </div>

            {isKnowledgePanelOpen && (
              <div
                className="absolute left-0 right-0 top-full z-20 border-b border-gray-200 dark:border-gray-800 bg-white/96 dark:bg-gray-950/96 px-3 py-2 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.12)] backdrop-blur-md"
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex gap-2">
                  {[
                    {
                      id: 'gap',
                      iconName: 'alarm-warning-line',
                      label: lang === 'zh' ? '需要补证据' : 'Needs evidence',
                      count: actionCandidates.evidenceGapNotes.length,
                      detail: actionCandidates.firstGap?.title ?? (lang === 'zh' ? '暂无明显证据缺口' : 'No clear evidence gap'),
                      note: actionCandidates.firstGap,
                      relationType: 'evidence' as const,
                      accent: 'border-rose-200 text-rose-700 bg-rose-50',
                    },
                    {
                      id: 'promising',
                      iconName: 'lightbulb-flash-line',
                      label: lang === 'zh' ? '有潜力想法' : 'Promising idea',
                      count: actionCandidates.promisingNotes.length,
                      detail: actionCandidates.firstPromising?.title ?? (lang === 'zh' ? '还没有被标记的有潜力想法' : 'No marked promising idea'),
                      note: actionCandidates.firstPromising,
                      relationType: 'extend' as const,
                      accent: 'border-sky-200 text-sky-700 bg-sky-50',
                    },
                    {
                      id: 'synthesis',
                      iconName: 'git-merge-line',
                      label: lang === 'zh' ? '需要综合' : 'Needs synthesis',
                      count: actionCandidates.synthesisCandidates.length,
                      detail: actionCandidates.firstSynthesis?.title ?? (lang === 'zh' ? '暂无明显综合入口' : 'No clear synthesis entry'),
                      note: actionCandidates.firstSynthesis,
                      relationType: 'synthesize' as const,
                      accent: 'border-violet-200 text-violet-700 bg-violet-50',
                    },
                  ].map(card => (
                    <button
                      key={card.id}
                      type="button"
                      disabled={!card.note}
                      onClick={e => {
                        e.stopPropagation();
                        if (!card.note) return;
                        focusNote(card.note.id);
                        setBuildOnParentId(card.note.id);
                        setBuildOnRelationType(card.relationType);
                        setShowBuildOnComposer(true);
                        setIsKnowledgePanelOpen(false);
                      }}
                      className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2 text-left transition-colors hover:border-[#000080]/20 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-default disabled:opacity-60"
                    >
                      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${card.accent}`}>
                        <RemixIcon name={card.iconName} size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-gray-700 dark:text-gray-300">
                          {card.label}
                          <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-1.5 py-px text-[0.6875rem] font-normal text-gray-500">{card.count}</span>
                        </span>
                        <span className="block truncate text-[0.6875rem] text-gray-500">{card.detail}</span>
                      </span>
                      {card.note && <RemixIcon name="arrow-right-up-line" size={12} className="shrink-0 text-gray-400" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Main Canvas Area */}
          <div
            ref={canvasRef}
            className="flex-1 relative overflow-hidden cursor-default select-none"
            style={{
              touchAction: 'manipulation',
              backgroundColor: '#f5f7fb',
              backgroundImage: 'linear-gradient(rgba(148,163,184,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.13) 1px, transparent 1px), radial-gradient(circle at 22% 18%, rgba(52,87,213,0.08), transparent 28%)',
              backgroundSize: '32px 32px, 32px 32px, 100% 100%',
            }}
            onMouseDown={handleMouseDownCanvas}
            onContextMenu={(e) => e.preventDefault()}
          >
          {/* Loading overlay while fetching space data */}
          {spaceLoading && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-50">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-gray-500">加载知识空间…</span>
              </div>
            </div>
          )}
          {/* Render View Container —— 这个零尺寸元素就是世界坐标原点，
              拖动时用它的 getBoundingClientRect() 把鼠标位置换算成世界坐标。 */}
          <div
            ref={worldOriginRef}
            className="absolute w-0 h-0"
            style={{ transform: `translate(${viewPort.x}px, ${viewPort.y}px) scale(${viewPort.zoom})` }}
          >
             {/* Shape Layer — beneath notes, so regions act as containers */}
             <ShapeLayer
                shapes={visibleShapes}
                tool={shapeTool}
                style={shapeStyle}
                selectedId={selectedShapeId}
                // Shapes are inert backdrops until the Drawing tool is open,
                // so they never intercept clicks meant for notes.
                editable={!!spaceId && shapeToolbarOpen}
                lang={lang}
                zoom={viewPort.zoom}
                onSelect={setSelectedShapeId}
                onCreate={handleCreateShape}
                onUpdate={handleUpdateShape}
                onDelete={handleDeleteShape}
             />

             {/* Edges Layer */}
             <svg
                className="absolute pointer-events-none z-10 overflow-visible"
                style={{ top: -5000, left: -5000, width: 10000, height: 10000 }}
             >
                <defs>
                  {Object.entries(RELATION_COLORS).map(([type, color]) => (
                    <marker key={`arrow-${type}`} id={`arrow-${type}`} markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                      <polygon points="0 0, 10 5, 0 10" fill={color} stroke="white" strokeWidth="1" />
                    </marker>
                  ))}
                </defs>
                {edges.map(edge => {
                   // Both endpoints must belong to the active view, otherwise a
                   // fresh view still shows lines from every other canvas.
                   const source = visibleNoteById.get(edge.source);
                   const target = visibleNoteById.get(edge.target);
                   if (!source || !target) return null;
                   // 收起的分支里的连线不画
                   if (foldHidden.has(source.id) || foldHidden.has(target.id)) return null;

                   const sDims = getNoteDimensions(source);
                   const tDims = getNoteDimensions(target);

                   const sRect = { x: source.x, y: source.y, w: sDims.w, h: sDims.h };
                   const tRect = { x: target.x, y: target.y, w: tDims.w, h: tDims.h };

                   const sCenter = { x: sRect.x + sRect.w / 2, y: sRect.y + sRect.h / 2 };
                   const tCenter = { x: tRect.x + tRect.w / 2, y: tRect.y + tRect.h / 2 };

                   const start = getRectIntersection(sRect, tCenter);
                   const end = getRectIntersection(tRect, sCenter);

                   const rt = edge.relationType ?? 'extend';
                   const color = RELATION_COLORS[rt] ?? RELATION_COLORS.extend;

                   // Line style encoding: solid=human, dashed=AI-suggested, thick-dashed=AI-accepted
                   const strokeWidth = edge.aiAccepted ? 3 : edge.aiSuggested ? 1.5 : 2;
                   const strokeDasharray = edge.aiAccepted ? '8 4' : edge.aiSuggested ? '5 4' : undefined;
                   const strokeOpacity = edge.aiSuggested && !edge.aiAccepted ? 0.7 : 1;

                   const dx = end.x - start.x;
                   const dy = end.y - start.y;
                   const distance = Math.hypot(dx, dy) || 1;
                   const curve = Math.min(36, distance * 0.12);
                   const normalX = -dy / distance;
                   const normalY = dx / distance;
                   const controlX = (start.x + end.x) / 2 + normalX * curve;
                   const controlY = (start.y + end.y) / 2 + normalY * curve;
                   const pathD = `M ${start.x + 5000} ${start.y + 5000} Q ${controlX + 5000} ${controlY + 5000} ${end.x + 5000} ${end.y + 5000}`;

                   return (
                     <path
                       key={edge.id}
                       d={pathD}
                       fill="none"
                       stroke={color}
                       strokeWidth={strokeWidth}
                       strokeDasharray={strokeDasharray}
                       strokeOpacity={strokeOpacity}
                       strokeLinecap="round"
                       markerEnd={`url(#arrow-${rt})`}
                     />
                   );
                })}
             </svg>

             {/* 视图卡片 —— 单击进入，拖动挪位置，右键移除入口 */}
             {cardsOnCanvas.map(card => {
               const target = views.find(v => v.id === card.viewId);
               if (!target) return null;
               return (
                 <ViewCard
                   key={card.id}
                   viewId={card.viewId}
                   title={target.title}
                   noteCount={noteCountByView.get(card.viewId) ?? 0}
                   x={card.x}
                   y={card.y}
                   lang={lang}
                   onMouseDown={(e) => handleViewCardMouseDown(e, card)}
                   onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveCard(card, target.title); }}
                 />
               );
             })}

             {/* Notes Layer */}
             {visibleNotes.map(note => foldHidden.has(note.id) ? null : (
                <NoteItem
                  key={note.id}
                  note={note}
                  lang={lang}
                  isSelected={selectedNoteId === note.id || draggingNoteId === note.id}
                  isMultiSelected={multiSelectedIds.has(note.id)}
                  moveCounts={moveCountsMap.get(note.id)}
                  synthesisDepth={synthesisDepthMap.get(note.id)}
                  isNew={isNoteNew(note, user?.id)}
                  hotCount={hotBuildOnCountMap.get(note.id) ?? 0}
                  isMine={myNoteIds.has(note.id)}
                  className={[
                    'gsap-note-item transition-opacity duration-200 motion-reduce:transition-none',
                    mineFocus && !myNoteIds.has(note.id) ? 'opacity-30' : '',
                    // 正在搜索：没命中的调淡
                    searchMatches && !searchMatches.has(note.id) ? 'opacity-30' : '',
                    // 点了上面的讨论主题：相关的几条亮几秒
                    topicHighlight.has(note.id) ? 'rounded-lg ring-2 ring-amber-400 ring-offset-2 ring-offset-transparent' : '',
                  ].filter(Boolean).join(' ')}
                  onMouseDown={handleMouseDownNote}
                  onDoubleClick={handleDoubleClickNote}
                  onContextMenu={handleContextMenu}
                  onResizeStart={handleNoteResizeStart}
                  fold={foldMap.get(note.id)}
                  onToggleFold={handleToggleFold}
                  onHoverChange={handleNoteHover}
                />
             ))}
          </div>

          {/* 鼠标停在有 Build-on 的卡片上：旁边列出建立在它上面的笔记，收起的也看得到 */}
          {peekNoteId && dragMode === 'none' && (() => {
            const anchorNote = visibleNoteById.get(peekNoteId);
            if (!anchorNote || foldHidden.has(anchorNote.id)) return null;
            const kids = foldGraph.children.get(anchorNote.id) ?? [];
            if (kids.length === 0) return null;
            const items: PeekItem[] = kids
              .map(id => visibleNoteById.get(id))
              .filter((n): n is Note => Boolean(n))
              .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
              .map(child => ({
                id: child.id,
                title: child.title || child.fileName || '',
                author: child.author,
                relationType: edges.find(e => e.source === child.id && e.target === anchorNote.id)?.relationType,
                hidden: foldHidden.has(child.id),
                isNew: isNoteNew(child, user?.id),
              }));
            const { w, h } = getNoteDimensions(anchorNote);
            const summary = foldMap.get(anchorNote.id);
            return (
              <BuildOnPeek
                lang={lang === 'zh' ? 'zh' : 'en'}
                anchor={{
                  left: anchorNote.x * viewPort.zoom + viewPort.x,
                  top: anchorNote.y * viewPort.zoom + viewPort.y,
                  width: w * viewPort.zoom,
                  height: h * viewPort.zoom,
                }}
                container={{
                  width: canvasRef.current?.clientWidth ?? window.innerWidth,
                  height: canvasRef.current?.clientHeight ?? window.innerHeight,
                }}
                items={items}
                collapsed={Boolean(summary?.collapsed)}
                hiddenCount={summary?.hiddenCount ?? 0}
                onPick={handlePeekPick}
                onToggle={() => handleToggleFold(anchorNote)}
                onPointerEnter={keepPeekOpen}
                onPointerLeave={releasePeek}
              />
            );
          })()}

          {/* ── Multi-select Floating Toolbar ── */}
          {multiSelectedIds.size >= 2 && (() => {
            // Compute bounding box of selected notes in world coords
            const selNotes = visibleNotes.filter(n => multiSelectedIds.has(n.id) && !foldHidden.has(n.id));
            if (selNotes.length < 2) return null;
            let minX = Infinity, maxX = -Infinity, minY = Infinity;
            selNotes.forEach(n => {
              const { w } = getNoteDimensions(n);
              minX = Math.min(minX, n.x);
              maxX = Math.max(maxX, n.x + w);
              minY = Math.min(minY, n.y);
            });
            const midWorldX = (minX + maxX) / 2;
            // Convert world → screen coords
            const screenX = midWorldX * viewPort.zoom + viewPort.x;
            const screenY = minY * viewPort.zoom + viewPort.y - 56; // 56px above top edge
            const lbl = (zh: string, en: string) => lang === 'zh' ? zh : en;
            return (
              <div
                className="absolute z-[200] flex items-center gap-1 bg-gray-900/95 backdrop-blur text-white
                           rounded-xl shadow-2xl px-2 py-1.5 border border-white/10"
                style={{ left: screenX, top: screenY, transform: 'translateX(-50%)' }}
                onMouseDown={e => e.stopPropagation()}
              >
                {/* Count badge */}
                <span className="text-[0.6875rem] font-bold text-gray-400 px-1">
                  {multiSelectedIds.size} {lbl('已选', 'selected')}
                </span>
                <div className="w-px h-4 bg-white/20" />

                {/* Rise Above — canvas-native */}
                <button
                  onClick={() => { void handleOpenRiseAboveRoom(Array.from(multiSelectedIds)); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#000080] hover:bg-[#1a1a72]
                             text-white text-xs font-semibold transition-colors"
                  title={lbl('就这几条开一间讨论室 (Rise Above)', 'Open a Rise Above room on these notes')}
                >
                  <RemixIcon name="git-merge-line" size={14} />
                  {lbl('Rise Above', 'Rise Above')}
                </button>

                {/* Link (Build-on) — only shown when exactly 2 notes selected */}
                {multiSelectedIds.size === 2 && (() => {
                  // 两条都已经在画布上，只在它们之间连一条线，不新建笔记。
                  // 默认后写的那条建立在先写的那条上，类型选择器里可以对调。
                  const [a, b] = selNotes;
                  const [srcId, tgtId] = (Date.parse(a.createdAt ?? '') || 0) >= (Date.parse(b.createdAt ?? '') || 0)
                    ? [a.id, b.id] : [b.id, a.id];
                  return (
                    <button
                      onClick={() => {
                        setBuildOnLinkSourceId(srcId);
                        setBuildOnParentId(tgtId);
                        setBuildOnRelationType('extend');
                        setShowBuildOnComposer(true);
                        setMultiSelectedIds(new Set());
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500
                                 text-white text-xs font-semibold transition-colors"
                      title={lbl('在这两条笔记之间建立 Build-on 关系', 'Link these two notes with a Build-on relation')}
                    >
                      <RemixIcon name="links-line" size={14} />
                      {lbl('关联', 'Link')}
                    </button>
                  );
                })()}

                {/* Clear */}
                <button
                  onClick={() => setMultiSelectedIds(new Set())}
                  className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-white/10
                             text-gray-400 hover:text-white transition-colors ml-0.5"
                  aria-label={lbl('取消选择', 'Clear selection')}
                  title={lbl('取消选择', 'Clear selection')}
                >
                  <RemixIcon name="close-line" size={14} />
                </button>
              </div>
            );
          })()}

          {/* Custom Scrollbars */}
          <div className="absolute bottom-0 left-0 right-4 h-3 bg-gray-100 border-t border-gray-200 z-20" ref={scrollTrackXRef}>
             <div 
               className="h-full bg-gray-300 rounded-full hover:bg-gray-400 cursor-pointer active:bg-gray-500"
               style={{ 
                 width: `${scrollX.size}%`, 
                 marginLeft: `${scrollX.pos}%`, 
                 position: 'relative'
               }}
               onMouseDown={handleScrollbarXMouseDown}
             ></div>
          </div>
          <div className="absolute top-0 right-0 bottom-3 w-3 bg-gray-100 border-l border-gray-200 z-20" ref={scrollTrackYRef}>
             <div 
               className="w-full bg-gray-300 rounded-full hover:bg-gray-400 cursor-pointer active:bg-gray-500"
               style={{ 
                 height: `${scrollY.size}%`, 
                 marginTop: `${scrollY.pos}%`, 
                 position: 'relative'
               }}
               onMouseDown={handleScrollbarYMouseDown}
             ></div>
          </div>
          
          {/* Shape toolbar — opened from the Drawing tool in the left sidebar */}
          {spaceId && shapeToolbarOpen && (() => {
            const zh = lang === 'zh';
            const activeMeta = SHAPE_CATALOG.find(m => m.key === shapeTool);
            const quickTools: Array<{ key: ShapeType; icon: string; zh: string; en: string }> = [
              { key: 'arrow', icon: 'arrow-right-line', zh: '箭头', en: 'Arrow' },
              { key: 'line', icon: 'subtract-line', zh: '直线', en: 'Line' },
              { key: 'text', icon: 'text', zh: '文字', en: 'Text' },
            ];
            const toolBtn = (active: boolean) =>
              `flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                active ? 'bg-[#000080] text-white' : 'text-gray-500 hover:bg-gray-100'
              }`;

            return (
              <div className="absolute top-4 left-1/2 z-30 -translate-x-1/2">
                <div className="relative flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
                  {/* 选择 */}
                  <button
                    onClick={() => { setShapeTool(null); setShapePickerOpen(false); }}
                    title={zh ? '选择' : 'Select'}
                    aria-label={zh ? '选择' : 'Select'}
                    className={toolBtn(shapeTool === null)}
                  >
                    <RemixIcon name="cursor-line" size={16} />
                  </button>

                  <div className="mx-0.5 h-5 w-px bg-gray-200" />

                  {/* 形状选择器 —— 12 种形状塞进工具栏会太挤，收进下拉网格 */}
                  <button
                    onClick={() => { setShapePickerOpen(o => !o); setStylePanelOpen(false); }}
                    title={zh ? '选择形状' : 'Pick a shape'}
                    aria-label={zh ? '选择形状' : 'Pick a shape'}
                    aria-expanded={shapePickerOpen}
                    className={`flex h-8 items-center gap-1 rounded-lg px-2 transition-colors ${
                      activeMeta && !isLineShape(activeMeta.key) && activeMeta.key !== 'text'
                        ? 'bg-[#000080] text-white'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    <ShapeGlyph type={activeMeta && activeMeta.group !== 'line' ? activeMeta.key : 'rect'} size={15} />
                    <RemixIcon name="arrow-down-s-line" size={13} />
                  </button>

                  {quickTools.map(item => (
                    <button
                      key={item.key}
                      onClick={() => { setShapeTool(item.key); setSelectedShapeId(null); setShapePickerOpen(false); }}
                      title={zh ? item.zh : item.en}
                      aria-label={zh ? item.zh : item.en}
                      className={toolBtn(shapeTool === item.key)}
                    >
                      <RemixIcon name={item.icon} size={16} />
                    </button>
                  ))}

                  <div className="mx-0.5 h-5 w-px bg-gray-200" />

                  {/* 样式：颜色 + 文字排版，全部收进面板 */}
                  <button
                    onClick={() => { setStylePanelOpen(o => !o); setShapePickerOpen(false); }}
                    title={zh ? '颜色与文字样式' : 'Colour & text style'}
                    aria-label={zh ? '颜色与文字样式' : 'Colour & text style'}
                    aria-expanded={stylePanelOpen}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-2 transition-colors ${
                      stylePanelOpen ? 'bg-gray-100' : 'hover:bg-gray-100'
                    }`}
                  >
                    <span
                      className="h-4 w-4 rounded border"
                      style={{
                        backgroundColor: shapeStyle.fill || 'white',
                        borderColor: shapeStyle.stroke || '#94a3b8',
                        borderWidth: 2,
                        backgroundImage: shapeStyle.fill
                          ? undefined
                          : 'linear-gradient(45deg, transparent 44%, #cbd5e1 44%, #cbd5e1 56%, transparent 56%)',
                      }}
                    />
                    <span className="text-[0.75rem] font-medium text-gray-600">{zh ? '样式' : 'Style'}</span>
                    <RemixIcon name="arrow-down-s-line" size={13} className="text-gray-400" />
                  </button>

                  {shapeTool && (
                    <span className="ml-1 whitespace-nowrap text-[0.6875rem] text-gray-400">
                      {zh ? '在画布上拖拽绘制' : 'Drag on canvas to draw'}
                    </span>
                  )}
                  {!shapeTool && selectedShapeId && (
                    <span className="ml-1 whitespace-nowrap text-[0.6875rem] text-gray-400">
                      {zh ? '双击图形编辑文字' : 'Double-click to edit text'}
                    </span>
                  )}

                  <div className="mx-0.5 h-5 w-px bg-gray-200" />
                  <button
                    onClick={() => {
                      setShapeToolbarOpen(false); setShapeTool(null); setSelectedShapeId(null);
                      setShapePickerOpen(false); setStylePanelOpen(false); setActiveTool('');
                    }}
                    title={zh ? '完成绘图' : 'Done'}
                    aria-label={zh ? '完成绘图' : 'Done'}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  >
                    <RemixIcon name="close-line" size={16} />
                  </button>

                  {/* 形状网格 */}
                  {shapePickerOpen && (
                    <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-[268px] rounded-2xl border border-gray-200 bg-white p-3 shadow-xl">
                      {([
                        { g: 'basic' as const, zh: '基础', en: 'Basic' },
                        { g: 'flow' as const, zh: '流程图', en: 'Flowchart' },
                      ]).map(section => (
                        <div key={section.g} className="mb-2 last:mb-0">
                          <div className="mb-1.5 text-[0.6875rem] font-semibold text-stone-500">
                            {zh ? section.zh : section.en}
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {SHAPE_CATALOG.filter(m => m.group === section.g).map(m => (
                              <button
                                key={m.key}
                                onClick={() => { setShapeTool(m.key); setSelectedShapeId(null); setShapePickerOpen(false); }}
                                title={zh ? m.zh : m.en}
                                aria-label={zh ? m.zh : m.en}
                                className={`flex h-[54px] flex-col items-center justify-center gap-1 rounded-lg border transition-colors ${
                                  shapeTool === m.key
                                    ? 'border-[#000080] bg-[#000080]/5 text-[#000080]'
                                    : 'border-transparent text-stone-500 hover:bg-stone-50'
                                }`}
                              >
                                <ShapeGlyph type={m.key} size={22} />
                                <span className="max-w-full truncate px-0.5 text-[0.625rem] leading-none">{zh ? m.zh : m.en}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {stylePanelOpen && (
                    <ShapeStylePanel
                      value={shapeStyle}
                      lang={lang}
                      editingSelection={!!selectedShapeId}
                      onChange={handleStyleChange}
                      onClose={() => setStylePanelOpen(false)}
                    />
                  )}
                </div>
              </div>
            );
          })()}

          {/* Zoom + Controls Bar */}
          <div className="absolute bottom-5 right-5 flex items-center gap-2 z-30">
            {foldTotals.branches > 0 && (
              <div
                data-canvas-overlay
                onMouseDown={e => e.stopPropagation()}
                className="flex items-center overflow-hidden rounded-lg border border-gray-200 bg-white/90 text-xs text-gray-600 shadow backdrop-blur-sm"
              >
                <span className="px-2.5 py-1 tabular-nums">
                  {lang === 'zh' ? `已收起 ${foldTotals.notes} 条 Build-on` : `${foldTotals.notes} build-ons folded`}
                </span>
                <button
                  type="button"
                  onClick={expandAllFolds}
                  className="border-l border-gray-200 px-2.5 py-1 font-medium text-[#000080] transition-colors hover:bg-[#000080]/[0.06] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                >
                  {lang === 'zh' ? '全部展开' : 'Expand all'}
                </button>
              </div>
            )}
            <div className="bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-lg text-xs font-mono text-gray-600 shadow border border-gray-200 pointer-events-none">
              {Math.round(viewPort.zoom * 100)}%
            </div>
            <button
              onClick={frameActiveView}
              aria-label={lang === 'zh' ? '重置视图' : 'Reset view'}
              title={lang === 'zh' ? '重置视图' : 'Reset view'}
              className="bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-lg text-xs text-gray-600 shadow border border-gray-200 hover:bg-white transition-colors"
            >
              <RemixIcon name="focus-3-line" size={13} />
            </button>
          </div>

          {/* Empty State */}
          {!spaceLoading && visibleNotes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center select-none">
                <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-white/80 border-2 border-dashed border-gray-300 flex items-center justify-center">
                  <RemixIcon name="lightbulb-flash-line" size={34} className="text-[#000080] dark:text-blue-300" />
                </div>
                <p className="text-gray-500 font-semibold text-base">{lang === 'zh' ? '还没有笔记' : 'No notes yet'}</p>
                <p className="text-gray-400 text-sm mt-1">
                  {lang === 'zh' ? '点击左侧工具栏创建第一个想法' : 'Click the toolbar to create your first idea'}
                </p>
              </div>
            </div>
          )}

          {/* 「我的笔记」细栏：几条、第几条、上一条/下一条 */}
          {mineFocus && (
            <div
              role="toolbar"
              aria-label={lang === 'zh' ? '我的笔记' : 'My notes'}
              data-canvas-overlay
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[#B9CDF0] bg-white/95 py-1 pl-3 pr-1 text-xs shadow-[0_8px_24px_-12px_rgba(30,58,138,0.35)] backdrop-blur"
            >
              <RemixIcon name="user-search-line" size={15} className="text-[#1E3A8A]" />
              <span className="font-semibold text-[#1E3A8A]">{lang === 'zh' ? '我的笔记' : 'My notes'}</span>
              {myNotes.length === 0 ? (
                <span className="px-1 text-slate-500">{lang === 'zh' ? '这个视图里还没有你写的笔记' : 'You have no notes in this view yet'}</span>
              ) : (
                <>
                  <span className="px-1 tabular-nums text-slate-600" aria-live="polite">{mineIndex + 1} / {myNotes.length}</span>
                  <button
                    type="button"
                    aria-label={lang === 'zh' ? '上一条' : 'Previous'}
                    onClick={() => showMyNote(mineIndex - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-[#E3ECFB] hover:text-[#1E3A8A] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <RemixIcon name="arrow-left-s-line" size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={lang === 'zh' ? '下一条' : 'Next'}
                    onClick={() => showMyNote(mineIndex + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-[#E3ECFB] hover:text-[#1E3A8A] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <RemixIcon name="arrow-right-s-line" size={18} />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={lang === 'zh' ? '退出我的笔记' : 'Leave My notes'}
                onClick={() => setMineFocus(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <RemixIcon name="close-line" size={16} />
              </button>
            </div>
          )}

          {/* Right Detail Panel */}
          {selectedNoteId && detailNoteId === selectedNoteId && (() => {
            const sel = notes.find(n => n.id === selectedNoteId);
            if (!sel) return null;
            const relatedEdges = edges.filter(e => e.source === sel.id || e.target === sel.id);
            // 类型是分类不是优劣，走同一套莫兰迪标签样式
            const typeTone: Record<string, string> = {
              note: MORANDI.ochre,
              drawing: MORANDI.clay,
              attachment: MORANDI.lilac,
              video: MORANDI.dustyBlue,
              link: MORANDI.sage,
              view: MORANDI.stone,
              riseabove: MORANDI.mauve,
            };
            const zhLang: Language = lang === 'zh' ? 'zh' : 'en';
            const typeLabel = DETAIL_TYPE_LABELS[zhLang][sel.type];
            const statusLabel = sel.epistemicStatus && sel.epistemicStatus !== 'standard'
              ? (DETAIL_STATUS_LABELS[zhLang][sel.epistemicStatus] ?? sel.epistemicStatus)
              : null;
            // 写这条时的问题和现在的共同问题一样，问题栏上已经写着，不再重复一遍
            const writtenUnder = sel.inquiryQuestion?.trim() && sel.inquiryQuestion.trim() !== (currentSpace?.inquiry_question ?? '').trim()
              ? sel.inquiryQuestion.trim()
              : null;
            const strippedContent = notePlainParagraphs(sel.content);
            const openKnowledgeLacks = sel.knowledgeLacks?.filter(lack => !lack.resolvedAt) ?? [];
            const receivedEdges = relatedEdges.filter(edge => edge.target === sel.id);
            const sentEdges = relatedEdges.filter(edge => edge.source === sel.id);
            const aiUptakeCount = (sel.content?.match(/data-ai-source="genai"/g) ?? []).length;
            const trailStats = [
              { key: 'revisions', count: sel.metrics?.revisionCount ?? 0, label: lang === 'zh' ? '次修订' : 'revisions' },
              { key: 'received', count: receivedEdges.length, label: lang === 'zh' ? '收到 Build-on' : 'received' },
              { key: 'sent', count: sentEdges.length, label: lang === 'zh' ? '发出 Build-on' : 'sent' },
              { key: 'ai', count: aiUptakeCount, label: lang === 'zh' ? 'AI 采纳段' : 'AI uptakes' },
            ].filter(stat => stat.count > 0);
            const relationMoveCounts = receivedEdges.reduce<Record<string, number>>((acc, edge) => {
              const key = edge.relationType ?? 'extend';
              acc[key] = (acc[key] ?? 0) + 1;
              return acc;
            }, {});
            return (
              <div
                /* 浮层标记：画布的滚轮缩放监听器据此放行，否则面板滚不动 */
                data-canvas-overlay
                data-note-detail
                /* 面板就长在画布容器里，不拦住的话每一次点击都会冒泡到
                   handleMouseDownCanvas，那里无条件清空 selectedNoteId —— 
                   点面板里任何东西，面板自己就没了。 */
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                onContextMenu={e => e.stopPropagation()}
                className="absolute top-0 right-3 bottom-3 z-30 flex w-72 select-text flex-col overflow-hidden rounded-xl border border-gray-200 bg-white/95 shadow-xl backdrop-blur-sm animate-in slide-in-from-right-4 duration-200"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/80">
                  <div className="flex items-center gap-2">
                    {typeLabel ? (
                      <span
                        className="rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold"
                        style={chipStyle(typeTone[sel.type] ?? MORANDI.stone)}
                      >
                        {typeLabel}
                      </span>
                    ) : !statusLabel && (
                      <span className="text-[0.6875rem] font-medium text-gray-500">{lang === 'zh' ? '笔记详情' : 'Note details'}</span>
                    )}
                    {statusLabel && (
                      <span className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">
                        {statusLabel}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedNoteId(null)}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={lang === 'zh' ? '关闭详情' : 'Close detail panel'}
                  >
                    <RemixIcon name="close-line" size={14} />
                  </button>
                </div>
                {/* Body */}
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
                  <div>
                    <h3 className="font-bold text-gray-800 text-sm leading-snug">{sel.title}</h3>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[0.6875rem] text-gray-500">{sel.author}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-[0.6875rem] text-gray-400 tabular-nums">{formatNoteStamp(sel)}</span>
                    </div>
                  </div>
                  {strippedContent && (
                    <div>
                      <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                        {lang === 'zh' ? '内容' : 'Content'}
                      </div>
                      {/* 正文单独一个滚动框：长文在这里读完，不用再打开笔记；
                          下面的推进理由、知识缺口等照样在详情栏里往下滚到。 */}
                      <div
                        tabIndex={0}
                        aria-label={lang === 'zh' ? '笔记正文，可上下滚动' : 'Note text, scrollable'}
                        className="reading-scroll max-h-[min(26rem,50vh)] space-y-2 overflow-y-auto overscroll-contain rounded-lg border border-gray-100 bg-gray-50/70 py-2.5 pl-3 pr-2 text-[0.8125rem] leading-6 text-gray-700 break-words focus:outline-none focus-visible:ring-2 focus-visible:ring-[#000080]/30"
                      >
                        {strippedContent.split('\n\n').map((paragraph, index) => (
                          <p key={index} className="whitespace-pre-line">{paragraph}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {writtenUnder && (
                    <div className="rounded-lg border border-blue-100 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/30 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-[0.6875rem] font-semibold text-[#000080] dark:text-blue-300">
                        <RemixIcon name="focus-3-line" size={12} />{lang === 'zh' ? '写这条时的问题' : 'Question when written'}
                      </div>
                      <p className="text-xs leading-5 text-gray-700 dark:text-gray-300">{writtenUnder}</p>
                    </div>
                  )}
                  {(sel.promisingReason || sel.epistemicStatus === 'promising') && (
                    <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-sky-700">
                        <RemixIcon name="lightbulb-flash-line" size={12} />{lang === 'zh' ? '为什么值得推进' : 'Why this is promising'}
                      </div>
                      <p className="text-xs leading-5 text-gray-700 dark:text-gray-300">
                        {sel.promisingReason || (lang === 'zh' ? '已标记为有潜力，但还需要补充推进理由。' : 'Marked as promising, but it still needs an explicit reason.')}
                      </p>
                    </div>
                  )}
                  {openKnowledgeLacks.length > 0 && (
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-wider">
                        <RemixIcon name="alarm-warning-line" size={12} />{lang === 'zh' ? '知识缺口' : 'Knowledge gaps'}
                      </div>
                      <div className="space-y-1">
                        {openKnowledgeLacks.slice(0, 3).map(lack => (
                          <div key={lack.id} className="rounded-lg border px-2.5 py-2 text-xs leading-5" style={noticeStyle(MORANDI.rose)}>
                            <span className="mr-1 font-semibold">{LACK_LABELS[zhLang][lack.type] ?? lack.type.replace(/_/g, ' ')}</span>
                            {lack.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 只列不是零的：一排「0 次修订」「0 AI 采纳段」只是噪音 */}
                  {(trailStats.length > 0 || Object.keys(relationMoveCounts).length > 0) && (
                  <div>
                    <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                      {lang === 'zh' ? '改进轨迹' : 'Improvement trail'}
                    </div>
                    {trailStats.length > 0 && (
                      <div className="grid grid-cols-2 gap-1.5 text-[0.6875rem]">
                        {trailStats.map(stat => (
                          <div key={stat.key} className="rounded-lg bg-gray-50 px-2 py-1.5 text-gray-600">
                            <span className="font-bold text-gray-900">{stat.count}</span> {stat.label}
                          </div>
                        ))}
                      </div>
                    )}
                    {Object.keys(relationMoveCounts).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {Object.entries(relationMoveCounts).map(([type, count]) => (
                          <span key={type} className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[0.6875rem] text-gray-600">
                            {RELATION_LABELS[lang]?.[type] ?? type} {count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  )}
                  {relatedEdges.length > 0 && (
                    <div>
                      <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                        {lang === 'zh' ? '关联' : 'Connections'} ({relatedEdges.length})
                      </div>
                      <div className="space-y-1">
                        {relatedEdges.map(e => {
                          const isOut = e.source === sel.id;
                          const otherId = isOut ? e.target : e.source;
                          const other = notes.find(n => n.id === otherId);
                          const c = RELATION_COLORS[e.relationType ?? 'extend'] ?? '#6b7280';
                          const direction = isOut
                            ? (lang === 'zh' ? '这条建立在它上面' : 'This note builds on it')
                            : (lang === 'zh' ? '它建立在这条上面' : 'It builds on this note');
                          const row = (
                            <>
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                              <span className="shrink-0 whitespace-nowrap text-[0.6875rem] font-medium" style={{ color: c }}>{RELATION_LABELS[lang]?.[e.relationType ?? 'extend'] ?? e.relationType}</span>
                              <span className="shrink-0 text-gray-300" aria-hidden="true">{isOut ? '→' : '←'}</span>
                              <span className="min-w-0 truncate text-gray-700">{other?.title ?? otherId.slice(0, 8)}</span>
                            </>
                          );
                          // 在这块画布上的，点一下画布移过去（收起的也会展开）
                          return visibleNoteById.has(otherId) ? (
                            <button
                              key={e.id}
                              type="button"
                              title={direction}
                              onClick={() => locateNote(otherId)}
                              className="flex w-full items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-left text-xs text-gray-600 transition-colors hover:bg-gray-100 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                            >
                              {row}
                            </button>
                          ) : (
                            <div key={e.id} title={direction} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5">
                              {row}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {sel.tags && sel.tags.length > 0 && (
                    <div>
                      <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-gray-400 mb-1.5">{lang === 'zh' ? '标签' : 'Tags'}</div>
                      <div className="flex flex-wrap gap-1">
                        {sel.tags.map(tag => (
                          <span key={tag} className="rounded-full border px-2 py-0.5 text-[0.6875rem]" style={chipStyle(MORANDI.dustyBlue)}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* AI 反馈跟着正文一起滚。放在滚动区外面会把底部按钮挤出可视范围 ——
                      面板是 overflow-hidden 的固定高度，多出来的部分直接看不见。 */}
                  <div className="border-t border-gray-100 pt-3">
                    <NoteAiPanel
                      noteId={sel.id}
                      lang={lang}
                      onOpenNote={() => { setEditingNote(sel); setIsCreatingNew(false); setSelectedNoteId(null); }}
                    />
                  </div>
                </div>

                {/* 三个 Build-on 动作直接用对应的关系色 —— 和画布上那条线同色，
                    学生按下去之后画出来的就是这个颜色的连线。 */}
                <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-gray-100 bg-white/95 p-3">
                  {/* 别人的笔记改不了（服务器只认作者和教师），不给「编辑」；回应它用 Build-on */}
                  {canEditNote(sel) && (
                    <button
                      onClick={() => { setEditingNote(sel); setIsCreatingNew(false); setSelectedNoteId(null); }}
                      className="flex-1 rounded-lg border border-stone-200 bg-white py-1.5 text-xs font-semibold text-stone-700 transition-colors hover:bg-stone-50"
                    >
                      {lang === 'zh' ? '编辑' : 'Edit'}
                    </button>
                  )}
                  <button
                    onClick={() => { setBuildOnParentId(sel.id); setShowBuildOnComposer(true); setSelectedNoteId(null); }}
                    className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 ${canEditNote(sel) ? '' : 'col-span-2'}`}
                    style={chipStyle(RELATION_COLORS.extend)}
                  >
                    {lang === 'zh' ? '建立于此' : 'Build-on'}
                  </button>
                  <button
                    onClick={() => { setBuildOnParentId(sel.id); setBuildOnRelationType('evidence'); setShowBuildOnComposer(true); setSelectedNoteId(null); }}
                    className="rounded-lg border py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                    style={chipStyle(RELATION_COLORS.evidence)}
                  >
                    {lang === 'zh' ? '补证据' : 'Evidence'}
                  </button>
                  <button
                    onClick={() => { setBuildOnParentId(sel.id); setBuildOnRelationType('synthesize'); setShowBuildOnComposer(true); setSelectedNoteId(null); }}
                    className="rounded-lg border py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                    style={chipStyle(RELATION_COLORS.synthesize)}
                  >
                    {lang === 'zh' ? '综合' : 'Synthesize'}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
        </div>{/* end canvas column */}

        {/* View Management Panel */}
        <ViewPanel
           isOpen={isViewPanelOpen}
           onClose={() => { setIsViewPanelOpen(false); setActiveTool(''); }}
           views={views}
           activeViewId={activeViewId}
           noteCounts={noteCountByView}
           placedViewIds={placedViewIds}
           onSelectView={(id) => { goToView(id); setIsViewPanelOpen(false); setActiveTool(''); }}
           onCreateView={handleCreateView}
           onPlaceCard={handlePlaceCard}
           onRenameView={handleRenameView}
           onDeleteView={handleDeleteView}
           lang={lang}
           currentUserId={user?.id}
           isStaff={viewerIsStaff}
           offsetLeft={sidebarWidth}
        />
      </div>

      {/* Build-on Move Type Composer */}
      {showBuildOnComposer && (() => {
        const zh = lang === 'zh';
        const targetNote = notes.find(n => n.id === buildOnParentId);
        // 「关联」模式：两条都是已有笔记，确认后只连线
        const linkSource = buildOnLinkSourceId && buildOnLinkSourceId !== buildOnParentId
          ? notes.find(n => n.id === buildOnLinkSourceId) ?? null
          : null;
        const closeComposer = () => { setShowBuildOnComposer(false); clearBuildOn(); };
        const notePreview = (note: Note, caption: string) => (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3">
            <div className="flex items-start gap-2.5">
              <div className="w-1 self-stretch rounded-full bg-gray-400 dark:bg-gray-600 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[0.6875rem] font-semibold uppercase tracking-widest text-gray-400 mb-0.5">{caption}</div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-snug truncate">{note.title}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[0.6875rem] text-gray-500">{note.author}</span>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span className="text-[0.6875rem] text-gray-400">{note.date}</span>
                </div>
                {note.content && (
                  <p className="text-[0.6875rem] text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{notePreviewText(note.content)}</p>
                )}
              </div>
            </div>
          </div>
        );
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" style={{ overscrollBehavior: 'contain' }} onClick={closeComposer}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-[560px] max-w-[95vw] overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-[#000080]">
                <div>
                  <h2 className="text-sm font-semibold text-white tracking-wide">
                    {linkSource
                      ? (zh ? 'Build-on · 关联两条笔记' : 'Build-on · Link two notes')
                      : (zh ? 'Build-on · 知识建构' : 'Build-on')}
                  </h2>
                  <p className="text-xs text-blue-200/70 mt-0.5">
                    {linkSource
                      ? (zh ? '选一种关系，把这两条已有的笔记连起来' : 'Pick a relation to connect these two existing notes')
                      : (zh ? '选择你的知识建构行动类型' : 'Choose how your note builds on this one')}
                  </p>
                </div>
                <button onClick={closeComposer} aria-label={zh ? '关闭' : 'Close'} className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer">
                  <RemixIcon name="close-line" size={15} className="text-white/70" />
                </button>
              </div>

              {/* Target Note Preview；关联模式下两条都列出来，可以对调谁建立在谁上 */}
              {linkSource && targetNote ? (
                <div className="mx-6 mt-4 mb-3 grid gap-1.5">
                  {notePreview(linkSource, zh ? '这条' : 'This note')}
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[0.6875rem] font-semibold text-gray-500">
                      {zh ? '建立在下面这条之上' : 'builds on'}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setBuildOnLinkSourceId(targetNote.id); setBuildOnParentId(linkSource.id); }}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[0.6875rem] font-semibold text-[#000080] transition-colors hover:bg-[#000080]/[0.06] dark:text-blue-300"
                    >
                      <RemixIcon name="arrow-up-down-line" size={13} />
                      {zh ? '对调' : 'Swap'}
                    </button>
                  </div>
                  {notePreview(targetNote, zh ? '被建构的笔记' : 'Note being built on')}
                </div>
              ) : targetNote && (
                <div className="mx-6 mt-4 mb-3">
                  {notePreview(targetNote, zh ? '要建构的笔记' : 'Target note')}
                </div>
              )}

              {/* Move Type Grid */}
              <div className="px-6 pb-2">
                <div className="grid grid-cols-2 gap-2">
                  {BUILD_ON_MOVES.map(({ type, label, labelZh, desc, descEn }) => {
                    const isSelected = buildOnRelationType === type;
                    const hex = RELATION_COLORS[type];
                    const style = RELATION_STYLE[type];
                    return (
                      <button
                        key={type}
                        onClick={() => setBuildOnRelationType(type)}
                        className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-[border-color,background-color,box-shadow] cursor-pointer ${isSelected ? `${style.bg} ${style.border} ring-2 ${style.ring} ring-offset-1` : `border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600`}`}
                      >
                        <div className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: hex }} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}
                            {zh && <span className="ml-1.5 text-xs font-normal text-gray-400">{labelZh}</span>}
                          </div>
                          <div className="text-[0.6875rem] text-gray-500 mt-0.5 leading-snug">{zh ? desc : descEn}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Action Footer */}
              <div className="px-6 py-4 flex items-center gap-3 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={closeComposer}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  {zh ? '取消' : 'Cancel'}
                </button>
                {linkSource ? (
                  <button
                    onClick={() => void handleLinkExistingNotes()}
                    disabled={linkingNotes}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors active:scale-[0.98] cursor-pointer disabled:opacity-60"
                    style={{ backgroundColor: RELATION_COLORS[buildOnRelationType] ?? RELATION_COLORS.extend }}
                  >
                    <RemixIcon name={linkingNotes ? 'loader-4-line' : 'links-line'} size={16} className={linkingNotes ? 'animate-spin' : ''} />
                    <span>{linkingNotes ? (zh ? '正在关联…' : 'Linking…') : (zh ? '建立关联' : 'Link notes')}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setShowBuildOnComposer(false);
                      startNewNote(buildOnParentId ? { parentId: buildOnParentId, relationType: buildOnRelationType } : null);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors active:scale-[0.98] cursor-pointer"
                    style={{ backgroundColor: RELATION_COLORS[buildOnRelationType] ?? RELATION_COLORS.extend }}
                  >
                    <span>{zh ? '打开编辑器' : 'Open editor'}</span>
                    <RemixIcon name="arrow-right-line" size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {dialogueNote && (
        <AiDialogueNote
          note={dialogueNote}
          lang={lang}
          onClose={() => setDialogueNote(null)}
          onInsertToSource={({ text, sourceNoteId }) => {
            // 插回原笔记：打开那条笔记的编辑器，把这段话带进去
            const target = notesRef.current.find(n => n.id === sourceNoteId);
            if (!target) return;
            setDialogueNote(null);
            setEditingNote({ ...target, content: `${target.content ?? ''}\n${plainTextToNoteHtml(text)}` });
            setIsCreatingNew(false);
          }}
          onPublishAsNote={({ text }) => {
            setDialogueNote(null);
            startNewNote();
            setDialogueDraft(plainTextToNoteHtml(text));
          }}
        />
      )}

      {/* Modals */}
      <NoteEditorModal
        isOpen={isCreatingNew || !!editingNote}
        onClose={closeNoteEditor}
        onSave={handleSaveNote}
        initialData={
          editingNote
            ? { title: editingNote.title, content: editingNote.content, author: editingNote.author, date: editingNote.date, tags: editingNote.tags }
            : dialogueDraft
              ? { title: '', content: dialogueDraft }
              : activeScaffold
                ? { title: '', content: scaffoldMarkerHtml(activeScaffold, lang) }
                : undefined
        }
        isBuildOn={!!buildOnParentId}
        buildOnMoveType={buildOnParentId ? buildOnRelationType : undefined}
        buildOnParentId={buildOnParentId ?? undefined}
        onBuildOn={handleBuildOnFromNotePage}
        isRiseAbove={editingNote?.type === 'riseabove'}
        riseAboveCitedIds={riseAboveCitedIds.length > 0 ? riseAboveCitedIds : (editingNote?.citedNoteIds ?? [])}
        lang={lang}
        availableScaffolds={scaffolds}
        requireScaffold={requireScaffold && !scaffoldExempt}
        courseId={courseId}
        userId={user?.id}
        spaceId={spaceId ?? undefined}
        noteId={editingNote?.id}
        noteX={editingNote?.x}
        noteY={editingNote?.y}
        allNotes={notes}
        allEdges={edges}
        onPersistDraft={handlePersistDraft}
        currentViewId={activeViewId}
        onAiNotePublished={handleAiNotePublished}
        onOpenKbSource={openKbSource}
        userRole={userRole}
        isStaff={viewerIsStaff}
        onTeacherFeedbackRead={(noteId, _feedbackId) => {
          setNotes(prev => prev.map(note =>
            note.id === noteId
              ? {
                  ...note,
                  unreadFeedback: false,
                  feedbacks: note.feedbacks?.map(feedback => ({ ...feedback, isRead: true })),
                }
              : note
          ));
        }}
      />

      <DrawingModal 
        isOpen={isDrawingOpen}
        onClose={() => { setIsDrawingOpen(false); setDrawingToEdit(null); setActiveTool(''); }}
        onSave={handleSaveDrawing}
        initialData={drawingToEdit ? { title: drawingToEdit.title, elements: drawingToEdit.drawingData || [] } : undefined}
        lang={lang}
      />

      {collabCreateOpen && <div className="fixed inset-0 z-[200] bg-slate-950/30 flex items-center justify-center" data-canvas-overlay>
        <form className="bg-white dark:bg-slate-900 rounded-xl p-6 w-[min(440px,90vw)] shadow-xl" onSubmit={async event => {
          event.preventDefault();
          if (!spaceId || collabCreating) return;
          setCollabCreating(true); setCollabCreateError('');
          try {
            const rect = canvasRef.current?.getBoundingClientRect();
            const created = await collaborativeDocuments.create(spaceId, { title: collabTitle, viewId: activeViewId,
              x: ((rect?.width ?? 800) / 2 - viewPort.x) / viewPort.zoom,
              y: ((rect?.height ?? 600) / 2 - viewPort.y) / viewPort.zoom });
            const note = apiNoteToNote(created, user?.name);
            setNotes(previous => previous.some(item => item.id === note.id) ? previous : [...previous, note]);
            setCollabCreateOpen(false); setCollabDocument(note);
          } catch (error) { setCollabCreateError(error instanceof Error ? error.message : '创建失败'); }
          finally { setCollabCreating(false); }
        }}>
          <h2 className="text-lg font-semibold mb-3">{lang === 'zh' ? '创建协作文档' : 'Create shared document'}</h2>
          <label className="block text-sm">{lang === 'zh' ? '文档标题' : 'Document title'}<input autoFocus required maxLength={200} value={collabTitle} onChange={event => setCollabTitle(event.target.value)} className="block w-full border rounded-lg p-2 mt-2 bg-transparent" /></label>
          <p className="text-xs text-slate-500 my-3">{lang === 'zh' ? '本空间成员可共同编辑；小组空间保持组内共享。' : 'Members of this space can write together. Group spaces stay within the group.'}</p>
          {collabCreateError && <p role="alert" className="text-sm text-red-600 mb-3">{collabCreateError}</p>}
          <div className="flex gap-3 justify-end"><button type="button" disabled={collabCreating} onClick={() => setCollabCreateOpen(false)}>{lang === 'zh' ? '取消' : 'Cancel'}</button><button disabled={collabCreating} className="bg-indigo-700 text-white rounded-lg px-4 py-2">{collabCreating ? '…' : lang === 'zh' ? '创建' : 'Create'}</button></div>
        </form>
      </div>}
      {collabAdapter && <Suspense fallback={<div className="fixed inset-6 z-[200] bg-white p-8" data-canvas-overlay>正在打开协作文档…</div>}><CollaborativeDocumentEditor key={collabDocument!.id} adapter={collabAdapter} onClose={() => setCollabDocument(null)} /></Suspense>}

      {viewingFile && (
        <FileViewerPage 
          isOpen={!!viewingFile}
          onClose={() => setViewingFile(null)}
          fileUrl={viewingFile.fileUrl || ''}
          onConvertToNote={handleConvertMarkdownToNote}
          onSaveMarkdown={handleSaveMarkdown}
          onAskAi={handleAskAiAboutFile}
          onQuoteToNote={handleQuoteToNote}
          fileName={viewingFile.fileName || viewingFile.title}
          mimeType={viewingFile.mimeType || ''}
          noteId={viewingFile.id}
          currentUserId={user?.id}
          courseId={courseId}
          isStaff={viewerIsStaff}
          canEdit={canEditNote(viewingFile)}
          initialPage={viewingFilePage}
          lang={lang}
        />
      )}

      <AttachmentUploadModal 
        isOpen={isAttachmentModalOpen}
        onClose={() => setIsAttachmentModalOpen(false)}
        onUpload={handleFileUpload}
        lang={lang}
      />

      {riseAboveRoomId && (
        <RiseAboveRoom
          roomId={riseAboveRoomId}
          lang={lang}
          onLocateNote={(id) => { setRiseAboveRoomId(null); focusNote(id); }}
          onPublished={() => { setRiseAboveRoomId(null); void refetchSpace(); void reloadRiseAboveRooms(); }}
          onClose={() => setRiseAboveRoomId(null)}
        />
      )}

      {timelineOpen && spaceId && (
        <SpaceTimeline
          spaceId={spaceId}
          currentUserId={user?.id}
          lang={lang === 'zh' ? 'zh' : 'en'}
          initialNoteId={timelineFocus}
          onLocateNote={openTimelineNote}
          onShowNetwork={(id,sid)=>{setTimelineOpen(false);setNetworkFocus(id);setNetworkSpace(sid??spaceId);setBuildOnNetOpen(true);}}
          onClose={() => setTimelineOpen(false)}
        />
      )}

      {buildOnNetOpen && (
        <BuildOnNetwork
          spaceId={networkSpace??spaceId??undefined}
          notes={notes}
          edges={edges}
          currentUserId={user?.id}
          lang={lang === 'zh' ? 'zh' : 'en'}
          initialNoteId={networkFocus}
          onLocateNote={id=>openTimelineNote(id,networkSpace??spaceId??undefined)}
          onShowTimeline={id=>{setBuildOnNetOpen(false);setTimelineFocus(id);setTimelineOpen(true);}}
          onClose={() => setBuildOnNetOpen(false)}
        />
      )}

      {ideaGraphOpen && myGroup && (
        <GroupIdeaGraph
          groupId={myGroup.id}
          groupName={myGroup.name}
          lang={lang}
          isTeacher={viewerIsStaff}
          onLocateNote={(id) => { setIdeaGraphOpen(false); focusNote(id); }}
          onClose={() => setIdeaGraphOpen(false)}
        />
      )}

      {ideaGraphOpen && !myGroup && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/45 p-4 backdrop-blur-sm" onClick={() => setIdeaGraphOpen(false)}>
          <div className="max-w-sm rounded-3xl border border-stone-200 bg-white px-7 py-6 text-center shadow-2xl dark:border-gray-800 dark:bg-gray-950" onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-stone-900 dark:text-gray-100">
              {lang === 'zh' ? '还没有分组' : 'No group yet'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-gray-400">
              {lang === 'zh'
                ? '观点图谱按小组生成。等老师把你分进小组之后，这里就会显示你们组讨论中的观点。'
                : 'The idea graph is per group. Once your teacher puts you in one, your group\u2019s ideas appear here.'}
            </p>
            <button type="button" onClick={() => setIdeaGraphOpen(false)} className="mt-5 min-h-10 rounded-2xl bg-[#000080] px-5 text-sm font-semibold text-white">
              {lang === 'zh' ? '知道了' : 'Got it'}
            </button>
          </div>
        </div>
      )}
      {/* 讨论分析：只给这门课的教职（2026-10-09 用户：给教师看学生整体的讨论情况，用于教学） */}
      {isAnalyticsOpen && viewerIsStaff && spaceId && (
        <React.Suspense fallback={null}>
          <SpaceAnalytics
            key={spaceId}
            spaceTitle={currentSpace?.title || headerTitle}
            spaceId={spaceId}
            lang={lang === 'zh' ? 'zh' : 'en'}
            viewId={activeViewId}
            viewName={activeView.title}
            onClose={() => setIsAnalyticsOpen(false)}
            onLocateNote={locateAnyNote}
            noteTitles={analyticsNoteTitles}
          />
        </React.Suspense>
      )}

      {/* Rise Above Note Picker — lightweight selection before canvas-native creation */}
      {showRiseAbovePicker && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
             onClick={() => setShowRiseAbovePicker(false)}>
          <div className="bg-white dark:bg-gray-900 w-full max-w-2xl max-h-[70vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700"
               onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                  {lang === 'zh' ? '选几条笔记来讨论' : 'Pick notes to discuss'}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {lang === 'zh'
                    ? '选 2 条以上。它们会顶置在讨论室里，你们先争一轮，再写下那句更高一层的说法'
                    : 'Pick 2 or more. They stay pinned in the room while you argue, then you write the higher-level formulation'}
                </p>
              </div>
              <button onClick={() => setShowRiseAbovePicker(false)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                <RemixIcon name="close-line" size={18} />
              </button>
            </div>
            {/* 还没发布的讨论室 —— 关掉之后要回得去，否则那场讨论就丢了 */}
            {riseAboveRooms.filter(r => r.status !== 'published').length > 0 && (
              <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-800">
                <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-gray-400">
                  {lang === 'zh' ? '继续之前的讨论' : 'Back to an open room'}
                </p>
                <div className="grid gap-1.5">
                  {riseAboveRooms.filter(r => r.status !== 'published').slice(0, 5).map(r => {
                    const titles = r.source_note_ids
                      .map(id => notes.find(n => n.id === id)?.title)
                      .filter(Boolean).slice(0, 2).join(' · ');
                    return (
                      <button
                        key={r.id}
                        onClick={() => { setShowRiseAbovePicker(false); setRiseAboveRoomId(r.id); }}
                        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left text-[0.7812rem] transition hover:border-[#000080]/40 hover:bg-white dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
                      >
                        <RemixIcon name="chat-3-line" size={14} className="shrink-0 text-[#000080] dark:text-blue-300" />
                        <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
                          {r.title || titles || (lang === 'zh' ? '未命名讨论' : 'Untitled')}
                        </span>
                        <span className="shrink-0 font-mono text-[0.6875rem] text-gray-400">
                          {r.source_note_ids.length} {lang === 'zh' ? '条' : 'notes'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Note Grid */}
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {visibleNotes.filter(n => n.type === 'note' || n.type === 'riseabove').map(n => (
                <button
                  key={n.id}
                  onClick={() => setRiseAbovePickerSelected(prev => {
                    const next = new Set(prev);
                    if (next.has(n.id)) next.delete(n.id); else next.add(n.id);
                    return next;
                  })}
                  className={`text-left p-3 rounded-xl border-2 transition-all ${
                    riseAbovePickerSelected.has(n.id)
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                      : 'border-gray-100 dark:border-gray-800 hover:border-purple-200 dark:hover:border-purple-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 line-clamp-1">{n.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">{notePreviewText(n.content ?? '')}</div>
                      <div className="text-[0.6875rem] text-gray-400 mt-1">{n.author}</div>
                    </div>
                    {riseAbovePickerSelected.has(n.id) && (
                      <div className="w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
                        <RemixIcon name="check-line" size={12} className="text-white" />
                      </div>
                    )}
                    {n.type === 'riseabove' && (
                      <span className="text-[0.6875rem] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded font-medium flex-shrink-0">RA</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {riseAbovePickerSelected.size} {lang === 'zh' ? '个已选' : 'selected'}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setShowRiseAbovePicker(false)}
                        className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button
                  onClick={() => {
                    const ids = Array.from(riseAbovePickerSelected);
                    setShowRiseAbovePicker(false);
                    void handleOpenRiseAboveRoom(ids);
                  }}
                  disabled={riseAbovePickerSelected.size < 2}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#000080] hover:bg-[#1a1a72] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {lang === 'zh' ? '就这几条开始讨论' : 'Start a Rise Above room'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ScaffoldModal
        isOpen={isScaffoldModalOpen}
        onClose={() => setIsScaffoldModalOpen(false)}
        isStaff={viewerIsStaff}
        lang={lang}
        scaffolds={scaffolds}
        onUpdateScaffolds={handleUpdateScaffolds}
        onUseScaffold={handleUseScaffold}
        courseId={courseId}
        spaceId={spaceId ?? undefined}
        requireScaffold={requireScaffold}
        onRequireScaffoldChange={setRequireScaffold}
      />

      <MemberManagementModal 
        isOpen={isMemberModalOpen}
        onClose={() => setIsMemberModalOpen(false)}
        isStaff={viewerIsStaff}
        lang={lang}
        courseId={courseId}
      />

      <GroupManagementModal
        isOpen={isGroupModalOpen}
        onClose={() => setIsGroupModalOpen(false)}
        isStaff={viewerIsStaff}
        lang={lang}
        courseId={courseId}
        onTaskCreate={handleGroupTaskCreate}
        spaceId={spaceId ?? undefined}
      />

      {/* AI Side Panel */}
      <AISidePanel
        isOpen={isAIPanelOpen}
        onClose={() => setIsAIPanelOpen(false)}
        notes={notes}
        edges={edges}
        selectedNote={selectedNoteId ? notes.find(n => n.id === selectedNoteId) ?? null : null}
        isStaff={viewerIsStaff}
        lang={lang}
        spaceId={spaceId ?? undefined}
        courseId={courseId}
        userId={user?.id ?? 's1'}
        onFeedbackPublished={(noteId) => {
          // Mark the note as having unread feedback for student view
          setNotes(prev => prev.map(n =>
            n.id === noteId ? { ...n, unreadFeedback: true } : n
          ));
          void refetchSpace();
        }}
        onFeedbackRead={(noteId, _feedbackId) => {
          setNotes(prev => prev.map(n =>
            n.id === noteId
              ? {
                  ...n,
                  unreadFeedback: false,
                  feedbacks: n.feedbacks?.map(feedback => ({ ...feedback, isRead: true })),
                }
              : n
          ));
          void refetchSpace();
        }}
        onSelectNote={focusNote}
      />

      {/* Workspace Agent Panel */}
      <WorkspaceAgentPanel
        isOpen={isWorkspaceAgentOpen}
        onClose={() => setIsWorkspaceAgentOpen(false)}
        courseId={courseId}
        spaceId={spaceId ?? undefined}
        userRole={userRole}
        lang={lang}
        aiConfigs={wsAgentConfigs}
        viewId={activeViewId}
        selectedNoteIds={[...multiSelectedIds]}
        spaceNotes={notes
          .filter(n => n.type !== 'attachment' && n.type !== 'drawing')
          .map(n => ({ id: n.id, title: n.title, author: n.author }))}
        groupId={myGroup?.id ?? null}
        onLocateNote={(id) => { setIsWorkspaceAgentOpen(false); focusNote(id); }}
        pendingAttachment={assistantAttachment}
        onPendingAttachmentTaken={() => setAssistantAttachment(null)}
        onOpenKbSource={openKbSource}
      />

      {/* Inquiry Panel */}
      {isInquiryPanelOpen && (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-end">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setIsInquiryPanelOpen(false)} />
          <div className="relative w-[380px] max-w-full bg-white dark:bg-zinc-900 shadow-2xl border-l border-gray-200 dark:border-zinc-800 animate-in slide-in-from-right-10 duration-300">
            <InquiryPanel
              courseId={courseId}
              isStaff={viewerIsStaff}
              lang={lang}
              onClose={() => setIsInquiryPanelOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu?.visible && (() => {
        const ctxNote = notes.find(n => n.id === contextMenu.noteId);
        const zh = lang === 'zh';
        // Only images and videos can toggle between inline media and a card —
        // other files (PDF/doc/…) always stay a compact file entry.
        const ctxMime = ctxNote?.mimeType ?? '';
        const isMedia = Boolean(ctxNote?.fileUrl)
          && (ctxMime.startsWith('image/') || ctxMime.startsWith('video/'));
        const canDeleteContextNote = Boolean(ctxNote && (
          !spaceId || ctxNote.authorId === user?.id || viewerIsStaff
        ));
        return (
          <FloatingAtPoint
            x={contextMenu.x}
            y={contextMenu.y}
            className="fixed bg-white shadow-2xl rounded-xl py-1.5 z-50 border border-gray-200 min-w-[200px] max-h-[calc(100dvh-1rem)] overflow-y-auto animate-in fade-in zoom-in-95 duration-100"
            onClick={e => e.stopPropagation()}
          >
            {/* ── Group 1: Knowledge actions ── */}
            <div className="px-3 pt-1 pb-0.5 text-[0.6875rem] font-bold uppercase tracking-widest text-gray-400">
              {zh ? '知识操作' : 'Knowledge'}
            </div>

            {/* Build-on */}
            <button onClick={handleBuildOnAction}
              className="w-full text-left px-3 py-2 hover:bg-green-50 text-xs text-gray-700 font-medium flex items-center gap-2.5 transition-colors">
              <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
              {zh ? '建立于此 (Build-on)' : 'Build-on'}
            </button>

            {/* Rise Above — open picker with this note pre-selected */}
            <button
              onClick={() => {
                if (!contextMenu) return;
                setRiseAbovePickerSelected(new Set([contextMenu.noteId]));
                setShowRiseAbovePicker(true);
                closeContextMenu();
              }}
              className="w-full text-left px-3 py-2 hover:bg-purple-50 text-xs text-gray-700 font-medium flex items-center gap-2.5 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" />
              {zh ? '元认知综合 (Rise Above)' : 'Rise Above'}
            </button>

            {/* Divider */}
            <div className="h-px bg-gray-100 my-1 mx-2" />

            {/* ── Group 2: Content actions ── */}
            <div className="px-3 pb-0.5 text-[0.6875rem] font-bold uppercase tracking-widest text-gray-400">
              {zh ? '内容' : 'Content'}
            </div>

            {/* Edit */}
            <button
              onClick={() => {
                if (!ctxNote) return;
                setEditingNote(ctxNote);
                setIsCreatingNew(false);
                closeContextMenu();
              }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs text-gray-700 font-medium flex items-center gap-2.5 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
              {zh ? '编辑' : 'Edit'}
            </button>

            {/* View Connections */}
            <button
              onClick={() => {
                if (!ctxNote) return;
                setEditingNote(ctxNote);
                setIsCreatingNew(false);
                // connections tab will be wired in Step 5
                closeContextMenu();
              }}
              className="w-full text-left px-3 py-2 hover:bg-indigo-50 text-xs text-gray-700 font-medium flex items-center gap-2.5 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
              {zh ? '查看连接' : 'View Connections'}
            </button>

            {/* Preview toggle (media only) */}
            {isMedia && (
              <button onClick={handleTogglePreview}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-gray-600 flex items-center gap-2.5 transition-colors">
                <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                {ctxNote?.isPreviewMode
                  ? (zh ? '显示为条目（仅文件名）' : 'Show as card (file name)')
                  : (zh ? '在画布上显示图片' : 'Show media on canvas')}
              </button>
            )}

            {/* Divider */}
            <div className="h-px bg-gray-100 my-1 mx-2" />

            {/* ── Group 3: Management ── */}
            {/* Fixed — pin in place so it can't be dragged */}
            <button
              onClick={handleToggleFixed}
              className="w-full text-left px-3 py-2 hover:bg-sky-50 text-xs text-gray-600 flex items-center gap-2.5 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-sky-400 flex-shrink-0" />
              {ctxNote?.isFixed
                ? (zh ? '取消固定 (Unfix)' : 'Unfix')
                : (zh ? '固定 (Fixed)' : 'Fixed')}
            </button>

            {/* Delete */}
            <button
              onClick={canDeleteContextNote ? handleDeleteAction : undefined}
              disabled={!canDeleteContextNote}
              title={!canDeleteContextNote ? (zh ? '只能删除自己创建的 Note' : 'Only the author can delete this Note') : undefined}
              className={`w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2.5 transition-colors ${
                canDeleteContextNote
                  ? 'text-red-600 hover:bg-red-50'
                  : 'cursor-not-allowed text-gray-300'
              }`}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${canDeleteContextNote ? 'bg-red-400' : 'bg-gray-200'}`} />
              {canDeleteContextNote ? (zh ? '删除' : 'Delete') : (zh ? '仅作者可删除' : 'Author only')}
            </button>
          </FloatingAtPoint>
        );
      })()}
    </div>
  );
};

export default Workspace;
