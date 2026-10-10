/**
 * Typed API client for the HAKCC backend.
 * - Dev: uses /api (proxied to localhost:4000)
 * - Prod: uses VITE_API_URL from environment
 */

import type { CourseGoal, CourseTask, CourseTaskStatus, KnowledgeLack, TaskSubmission, TaskSubmissionStatus } from '../types';
import { recordApiFailure } from './clientDiagnostics';
import type { CollaborationAdapter, CollaborationSession, CollaborationSnapshot, CollaborationSnapshotContent } from './collaborativeDocuments';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const SESSION_ID = Math.random().toString(36).slice(2);
const CLIENT_VERSION = '1.0.0';

/** 供「学生求助」附在处境里，用来和埋点事件对得上。 */
export const clientSessionId = SESSION_ID;
export const clientVersion = CLIENT_VERSION;
export const AUTH_TOKEN_KEY = 'hakcc-access-token';
export const AUTH_REFRESH_TOKEN_KEY = 'hakcc-refresh-token';
export const AUTH_SESSION_CLEARED_EVENT = 'hakcc-auth-session-cleared';

export const collaborativeDocuments = {
  create: (spaceId: string, input: { title: string; x: number; y: number; viewId: string }) =>
    request<ApiNote>('POST', `/spaces/${encodeURIComponent(spaceId)}/collaborative-documents`, input),
  adapter: (id: string): CollaborationAdapter => {
    const path = `/collaborative-documents/${encodeURIComponent(id)}`;
    return {
      session: () => request<CollaborationSession>('GET', `${path}/session`),
      token: async () => {
        await request<CollaborationSession>('GET', `${path}/session`); // refreshes expired login token
        const token = getAuthToken();
        if (!token) throw new Error('请重新登录');
        return token;
      },
      export: () => requestBlob('GET', `${path}/export`),
      snapshot: async () => { await request('POST', `${path}/snapshots`); },
      snapshots: ()=>request<CollaborationSnapshot[]>('GET',`${path}/snapshots`),
      readSnapshot: id=>request<CollaborationSnapshotContent>('GET',`${path}/snapshots/${id}`),
    };
  },
};

/** 画成哪种：画面、关系图、思维导图、时间线（和 api/src/services/drawJudge.ts 的 DRAW_FORMS 一致） */
export type DrawFormChoice = 'picture' | 'graph' | 'tree' | 'timeline';

/** 上一轮 AI 画的那张：判断「是不是要改它」、照着改时带上 */
export interface PreviousDrawingPayload {
  request: string;
  caption: string;
  kind: 'picture' | 'diagram';
  prompt?: string;
  diagram?: unknown;
}

export interface DrawRouteResult {
  draw: boolean;
  mode: 'new' | 'edit';
  form: DrawFormChoice | null;
  decided_by: 'rule' | 'jev' | 'forced';
  route: Record<string, unknown>;
}

// ── Auth token management ──────────────────────────────────────

let _token: string | null = null;

export function setAuthToken(token: string | null) {
  _token = token;
}

export function getAuthToken(): string | null {
  return _token;
}

/**
 * 把后端返回的 `/api/files/...` 这类相对路径变成能直接打开的地址。
 *
 * 前端在 Cloudflare Pages、后端在另一个域名：相对路径会被浏览器拼到前端域名上，
 * 被 SPA 兜底成首页 —— 备课助手「导出 Word」一点就回主页就是这么来的。
 * 文件路由要登录，浏览器直接打开带不了 Authorization 头，所以 token 走 query（verifyJWT 认）。
 */
export function apiFileUrl(pathOrUrl: string): string {
  const url = pathOrUrl.startsWith('/api/') ? `${BASE_URL}${pathOrUrl.slice(4)}` : pathOrUrl;
  const token = getAuthToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export function clearStoredAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
  setAuthToken(null);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_SESSION_CLEARED_EVENT));
  }
}

function getHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-session-id': SESSION_ID,
    'x-client-version': CLIENT_VERSION,
    ...((_token != null) ? { Authorization: `Bearer ${_token}` } : {}),
    ...extra,
  };
}

// Token refresh state to prevent concurrent refreshes
let _refreshPromise: Promise<void> | null = null;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  _isRetry = false,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: getHeaders(),
    // 接口响应不能走浏览器缓存：改完一条记录马上重新拉列表时，
    // 缓存会把旧数据原样发回来，界面就像「没保存成功」。
    cache: 'no-store',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Auto-refresh on 401 (token expired)
  if (res.status === 401 && !_isRetry && !path.includes('/auth/')) {
    await refreshTokenAndRetry();
    return request<T>(method, path, body, true);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 后端约定 { error: "文案" }。但网关或代理可能塞回别的结构，
    // 直接把对象丢进界面会显示成 [object Object] —— 而错误文案是用户
    // 唯一的诊断依据，不能退化成这个。
    const raw = json.error ?? json.message;
    const message = typeof raw === 'string' && raw.trim()
      ? raw
      : (typeof raw?.message === 'string' && raw.message.trim() ? raw.message : 'Request failed');
    recordApiFailure(method, path, res.status, message);
    throw new ApiClientError(res.status, message, json.details);
  }
  return json as T;
}

async function refreshTokenAndRetry(): Promise<void> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    const refreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      clearStoredAuthSession();
      throw new ApiClientError(401, 'No refresh token');
    }
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearStoredAuthSession();
        throw new ApiClientError(401, 'Refresh failed');
      }
      const data = await res.json();
      _token = data.accessToken;
      localStorage.setItem(AUTH_TOKEN_KEY, data.accessToken);
      if (data.refreshToken) {
        localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, data.refreshToken);
      }
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function requestBlob(
  method: string,
  path: string,
  body?: unknown,
): Promise<Blob> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: getHeaders(),
    // 接口响应不能走浏览器缓存：改完一条记录马上重新拉列表时，
    // 缓存会把旧数据原样发回来，界面就像「没保存成功」。
    cache: 'no-store',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiClientError(res.status, json.error ?? 'Request failed');
  }
  return res.blob();
}

// ── Auth ───────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'teacher' | 'admin';
  status?: 'active' | 'pending' | 'inactive';
  avatar?: string;
  /** 所在学院 */
  school?: string | null;
  age?: number | null;
  bio?: string | null;
  created_at?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export const auth = {
  register: (data: { email: string; password: string; name: string; role?: string }) =>
    request<{ message: string; userId: string; status: string }>('POST', '/auth/register', data),

  login: (email: string, password: string) =>
    request<LoginResult>('POST', '/auth/login', { email, password }),
  /** 浏览器已直连 Supabase 登录，拿 token 换平台会话（profile、状态、登录事件）。 */
  session: (tokens: { access_token: string; refresh_token: string }) =>
    request<LoginResult>('POST', '/auth/session', tokens),

  refresh: (refreshToken: string) =>
    request<{ accessToken: string; refreshToken: string }>('POST', '/auth/refresh', { refreshToken }),

  me: () => request<{ user: AuthUser }>('GET', '/auth/me'),

  forgotPassword: (email: string) =>
    request<{ message: string }>('POST', '/auth/forgot-password', { email }),

  resetPassword: (accessToken: string, refreshToken: string, newPassword: string) =>
    request<{ message: string }>('POST', '/auth/reset-password', { accessToken, refreshToken, newPassword }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ message: string }>('POST', '/auth/change-password', { currentPassword, newPassword }),

  /** 只改可编辑字段。真实姓名由后端固定，不接受修改。 */
  updateProfile: (data: { name?: string; school?: string | null; age?: number | null; bio?: string | null }) =>
    request<{ user: AuthUser }>('PATCH', '/auth/me', data),

  uploadAvatar: (data: { file_name: string; mime_type: string; data_url: string }) =>
    request<{ user: AuthUser; avatar_url: string }>('POST', '/auth/me/avatar', data),

  listUsers: (status?: string) =>
    request<{ users: AuthUser[] }>('GET', `/auth/users${status ? `?status=${status}` : ''}`),

  approveTeacher: (userId: string) =>
    request<{ message: string }>('PATCH', `/auth/users/${userId}/approve`),
};

// ── Courses & Spaces ──────────────────────────────────────────

export interface Course {
  id: string;
  title: string;
  instructor_id: string;
  cover_image?: string;
  tags: string[];
  created_at: string;
  verification_code?: string;
  course_type?: CourseType | null;
}

export interface Space {
  id: string;
  title: string;
  description?: string;
  inquiry_question?: string;
  course_id: string;
  group_id?: string | null;
  created_by: string;
  created_at: string;
}

export const courses = {
  list: () => request<{ courses: Course[] }>('GET', '/courses'),
  listAvailable: () => request<{ courses: Course[] }>('GET', '/courses/available'),
  /** 单门课程。列表接口对不同角色返回的范围不同，需要确定拿到某一门时用这个。 */
  get: (courseId: string) => request<{ course: Course & {
    credit_hours?: number | null; total_weeks?: number | null;
    start_date?: string | null; users?: { name: string } | null;
  } }>('GET', `/courses/${courseId}`),
  create: (data: { title: string; cover_image?: string; tags?: string[]; verification_code?: string }) =>
    request<{ course: Course }>('POST', '/courses', data),
  /** 改名。后端只放行课程创建者（或管理员）。 */
  rename: (courseId: string, title: string) =>
    request<{ course: Course }>('PATCH', `/courses/${courseId}`, { title }),
  join: (courseId: string, verificationCode?: string) =>
    request<{ message: string }>('POST', `/courses/${courseId}/join`, { verification_code: verificationCode }),
  /** Leave a course you joined. Notes you wrote stay in the knowledge space. */
  leave: (courseId: string) =>
    request<{ message: string }>('DELETE', `/courses/${courseId}/leave`),
  listSpaces: (courseId: string) =>
    request<{ spaces: Space[] }>('GET', `/courses/${courseId}/spaces`),
  createSpace: (courseId: string, data: { title: string; description?: string; inquiry_question?: string; group_id?: string }) =>
    request<{ space: Space }>('POST', `/courses/${courseId}/spaces`, data),
  createGroupSpaces: (courseId: string, data?: { inquiry_question?: string }) =>
    request<{ created: Space[]; message?: string }>('POST', `/courses/${courseId}/group-spaces`, data ?? {}),
};

// ── Notes ─────────────────────────────────────────────────────

export interface ApiNote {
  id: string;
  space_id: string;
  author_id: string;
  type: string;
  title: string;
  content?: string;
  summary?: string;
  inquiry_question?: string;
  promising_reason?: string;
  knowledge_lacks?: KnowledgeLack[];
  x: number;
  y: number;
  width?: number;
  height?: number;
  tags: string[];
  metadata?: Record<string, unknown>;
  views: string[];
  cited_note_ids: string[];
  rise_above_data?: Record<string, unknown>;
  file_url?: string;
  file_name?: string;
  mime_type?: string;
  drawing_data?: unknown;
  scaffold_id?: string;
  epistemic_status?: string;
  is_ai_generated?: boolean;
  ai_trigger_type?: string;
  feedbacks?: NoteFeedbackApi[];
  unreadFeedback?: boolean;
  /** 调用者自己打开过没有（列表接口按人给）；false 时画布卡片标 New */
  seen_by_me?: boolean;
  created_at: string;
  updated_at: string;
  users?: { name: string; email?: string; avatar?: string };
  note_metrics_realtime?: NoteMetrics;
}

/** notes.metadata 里的两个版式键，见 PATCH /notes/:id/presentation。 */
export interface NotePresentation {
  is_fixed?: boolean;
  display_mode?: 'media' | 'card';
}

export interface NoteMetrics {
  build_on_count: number;
  direct_in_degree: number;
  direct_out_degree: number;
  challenge_count: number;
  evidence_count: number;
  synthesis_count: number;
  heat_score: number;
  unique_contributor_count: number;
  revision_count: number;
}

export interface NoteRevision {
  id: string;
  note_id: string;
  revision_number: number;
  title?: string;
  content?: string;
  editor_id?: string;
  change_summary?: string;
  created_at: string;
  users?: { name?: string };
}

export interface AiPartnerNotePublication {
  id: string;
  note_id: string;
  source_note_id: string;
  relation_id?: string;
  space_id: string;
  course_id: string;
  published_by_user_id: string;
  source_conversation_id?: string;
  source_message_id?: string;
  provider_id?: string;
  model?: string;
  persona_id?: string;
  selected_text: string;
  adoption_reason: string;
  relation_type: RelationType;
  created_at: string;
}

export type ShapeType =
  | 'rect' | 'ellipse' | 'diamond' | 'text' | 'line' | 'arrow'
  // 流程图件：终止符、数据/输入输出、准备、存储、三角、圆角框
  | 'stadium' | 'parallelogram' | 'hexagon' | 'cylinder' | 'triangle' | 'roundRect';

export type TextAlign = 'left' | 'center' | 'right';
export type TextValign = 'top' | 'middle' | 'bottom';

export interface ApiShape {
  id: string;
  spaceId: string;
  viewId: string | null;
  shapeType: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  zIndex: number;
  fontSize: number;
  fontWeight: number;
  textAlign: TextAlign;
  textValign: TextValign;
  /** 空串表示跟随边框色 */
  textColor: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ShapePayload {
  shape_type: ShapeType;
  view_id?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  z_index?: number;
  font_size?: number;
  font_weight?: number;
  text_align?: TextAlign;
  text_valign?: TextValign;
  text_color?: string;
}

export type TimelineItem = {
  id: string;
  kind: 'note' | 'build_on' | 'revision' | 'ai_feedback' | 'ai_chat';
  at: string;
  actorId: string | null;
  actorName: string | null;
  noteId: string | null;
  noteTitle: string | null;
  targetNoteId?: string | null;
  targetNoteTitle?: string | null;
  targetActorId?: string | null;
  targetActorName?: string | null;
  relationType?: string | null;
  triggerType?: string | null;
  status?: string | null;
  aiGenerated?: boolean;
  excerpt?: string;
  beforeExcerpt?: string;
  revisionNumber?: number;
  changeSummary?: string;
  snapshotComplete?: boolean;
  excerptScope?: 'original' | 'current' | 'revision';
  spaceId?: string | null; spaceTitle?: string; groupId?: string | null;
};
export type HistoryNote = { spaceId?: string | null; spaceTitle?: string; groupId?: string | null; id: string; title: string; excerpt: string; authorId: string | null; authorName: string | null; type: string; createdAt: string; aiGenerated: boolean };
export type HistoryRelation = { id: string; source: string; target: string; relationType?: string; creatorId?: string; createdAt?: string; aiSuggested?: boolean };
export type TimelineContext = { courseId: string; currentSpaceId: string; scope: 'space' | 'course'; canExport: boolean; membershipBasis: 'current'; spaces: {id:string; title:string; groupId:string|null}[]; groups: {id:string; name:string; memberIds:string[]}[]; participants: {id:string; name:string; code:string; role:'teacher'|'student'}[] };
export type KnowledgeHistory = { context?: TimelineContext; items: TimelineItem[]; generatedAt: string; structure?: { notes: HistoryNote[]; relations: HistoryRelation[] }; coverage?: { truncated: boolean; limitPerSource: number; privateAiScope: 'self'; revisionHistoryComplete: boolean; revisionTimestampField?: 'edited_at' | 'created_at' } };

export const notes = {
  /** 这个空间里知识是怎么一步步长出来的：观点、Build-on、AI 反馈、AI 对话，按时间排。 */
  timeline: (spaceId: string, scope: 'space' | 'course' = 'space') =>
    request<KnowledgeHistory>('GET', `/spaces/${spaceId}/timeline?scope=${scope}`),
  list: (spaceId: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    return request<{ notes: ApiNote[] }>('GET', `/spaces/${spaceId}/notes?${qs}`);
  },
  get: (noteId: string, from?: string) =>
    request<{ note: ApiNote }>('GET', `/notes/${noteId}${from ? `?from=${from}` : ''}`),
  /** 作者以外的人打开了这条笔记：它从此不再标 New。 */
  markSeen: (noteId: string) =>
    request<{ recorded: boolean }>('POST', `/notes/${noteId}/seen`),
  create: (spaceId: string, data: Partial<ApiNote>) =>
    request<{ note: ApiNote }>('POST', `/spaces/${spaceId}/notes`, data),
  /** Stores a canvas attachment and returns its durable public URL. */
  /** 读取已经存在存储里的附件的正文（上传时没抽、或事后才要用）。 */
  extractAttachmentText: (data: { file_url: string; file_name?: string; mime_type?: string }) =>
    request<{ text: string | null; truncated: boolean; source: 'pdf' | 'docx' | 'plain' | null }>(
      'POST', '/attachments/extract-text', data,
    ),

  /**
   * 直传上传地址。文件不经过 API 服务器，所以不受请求体大小限制。
   * 拿到之后用 supabase 客户端 uploadToSignedUrl 上传，再调 commitSpaceAttachment。
   */
  signSpaceAttachment: (
    spaceId: string,
    data: { file_name: string; mime_type: string; file_size: number },
  ) =>
    request<{ path: string; token: string; bucket: string }>(
      'POST', `/spaces/${spaceId}/attachments/sign`, data,
    ),

  /**
   * 直传完成后必须调这一步：服务端回读文件开头做魔数校验，不合格会删掉并报错。
   * 少了它，公开桶里就能放一个伪装成图片的 HTML。
   */
  commitSpaceAttachment: (
    spaceId: string,
    data: { path: string; file_name: string; mime_type: string; extract_text?: boolean },
  ) =>
    request<{
      attachment: { file_url: string; file_name: string; mime_type: string; file_size: number };
      text: string | null;
      textTruncated: boolean;
      textSource: 'pdf' | 'docx' | 'plain' | null;
    }>('POST', `/spaces/${spaceId}/attachments/commit`, data),

  uploadSpaceAttachment: (
    spaceId: string,
    data: { file_name: string; mime_type: string; data_url: string; extract_text?: boolean },
  ) =>
    request<{
      attachment: { file_url: string; file_name: string; mime_type: string; file_size: number };
      /** extract_text 为真且是 PDF / Word / 纯文本时，服务端抽出的正文。 */
      text: string | null;
      textTruncated: boolean;
      textSource: 'pdf' | 'docx' | 'plain' | null;
    }>('POST', `/spaces/${spaceId}/attachments`, data),

  // ── Canvas shapes (ProcessOn-style regions drawn on the space) ──────────
  listShapes: (spaceId: string) =>
    request<{ shapes: ApiShape[] }>('GET', `/spaces/${spaceId}/shapes`),
  createShape: (spaceId: string, data: ShapePayload) =>
    request<{ shape: ApiShape }>('POST', `/spaces/${spaceId}/shapes`, data),
  updateShape: (shapeId: string, data: Partial<ShapePayload>) =>
    request<{ shape: ApiShape }>('PATCH', `/shapes/${shapeId}`, data),
  deleteShape: (shapeId: string) =>
    request<{ message: string }>('DELETE', `/shapes/${shapeId}`),
  update: (noteId: string, data: Partial<ApiNote> & { change_summary?: string }) =>
    request<{ note: ApiNote }>('PUT', `/notes/${noteId}`, data),
  /** 位置与尺寸共用一条轻量接口；size 省略时只挪位置。 */
  updatePosition: (noteId: string, x: number, y: number, size?: { width: number; height: number }) =>
    request<{ ok: boolean }>('PATCH', `/notes/${noteId}/position`, { x, y, ...size }),
  /** 固定、附件显示方式：和位置一样是共享版式，空间成员都能改；服务端只合并传来的键。 */
  updatePresentation: (noteId: string, data: NotePresentation) =>
    request<{ metadata: Record<string, unknown> }>('PATCH', `/notes/${noteId}/presentation`, data),
  /**
   * 编辑后的 Markdown 存成新文件，附件改指向它；换下来的地址由服务端记进 metadata.mdVersions。
   * base_file_url 是打开文档时的地址，编辑期间有人存过新版本就回 409。
   */
  saveMarkdownVersion: (noteId: string, data: { data_url: string; file_name: string; base_file_url: string | null }) =>
    request<{ file_url: string; file_name: string; mime_type: string; metadata: Record<string, unknown> }>(
      'POST', `/notes/${noteId}/markdown-versions`, data,
    ),
  delete: (noteId: string) =>
    request<{ message: string }>('DELETE', `/notes/${noteId}`),
  revisions: (noteId: string) =>
    request<{ revisions: NoteRevision[] }>('GET', `/notes/${noteId}/revisions`),
  publishAiSelection: (sourceNoteId: string, data: {
    title?: string;
    selected_text: string;
    adoption_reason: string;
    relation_type: RelationType;
    source_conversation_id?: string;
    source_message_id?: string;
    provider_id?: string;
    model?: string;
    persona_id?: string;
    view_id?: string;
    /** 学生选的 GenAI 支架 */
    scaffold_id?: string;
  }) => request<{ note: ApiNote; relation: ApiRelation; publication: AiPartnerNotePublication | null }>(
    'POST',
    `/notes/${sourceNoteId}/ai-selections/publish-note`,
    data,
  ),
};

// ── Relations ─────────────────────────────────────────────────

export type RelationType = 'extend' | 'clarify' | 'question' | 'challenge' | 'evidence' | 'synthesize';

export interface ApiRelation {
  id: string;
  space_id: string;
  source_note_id: string;
  target_note_id: string;
  relation_type: RelationType;
  creator_id: string;
  ai_suggested: boolean;
  ai_accepted?: boolean;
  created_at: string;
  users?: { name: string };
}

export const relations = {
  listForSpace: (spaceId: string) =>
    request<{ relations: ApiRelation[] }>('GET', `/spaces/${spaceId}/relations`),
  listForNote: (noteId: string) =>
    request<{ relations: ApiRelation[] }>('GET', `/notes/${noteId}/relations`),
  create: (data: {
    source_note_id: string;
    target_note_id: string;
    relation_type: RelationType;
    space_id: string;
    ai_suggested?: boolean;
    ai_accepted?: boolean;
  }) => request<{ relation: ApiRelation }>('POST', '/relations', data),
  retype: (relationId: string, relation_type: RelationType, space_id: string) =>
    request<{ message: string }>('PUT', `/relations/${relationId}/type`, { relation_type, space_id }),
  delete: (relationId: string, space_id: string) =>
    request<{ message: string }>('DELETE', `/relations/${relationId}`, { space_id }),
};

// ── Events ────────────────────────────────────────────────────

export interface ClientEvent {
  event_type: string;
  object_type: string;
  object_id: string;
  space_id: string;
  target_note_id?: string;
  related_note_id?: string;
  metadata_json?: Record<string, unknown>;
}

// Lightweight event queue with debounced flush
const eventQueue: ClientEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function trackEvent(event: ClientEvent) {
  eventQueue.push(event);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { void flushEventQueue(); }, 3000);
}

async function flushEventQueue() {
  if (eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, eventQueue.length);
  try {
    await request<{ ok: boolean }>('POST', '/events', batch);
  } catch {
    // Re-queue on failure (up to 100 items)
    if (eventQueue.length < 100) eventQueue.unshift(...batch);
  }
}

/**
 * Flush on page hide/unload.
 *
 * sendBeacon cannot set headers, so a bare beacon to the JWT-guarded /events
 * endpoint was rejected 401 and the batch — already spliced out of the queue —
 * was lost. Every tab switch and close silently dropped its trailing events,
 * i.e. the end of each study session. fetch(keepalive) survives unload AND
 * carries Authorization, so the batch both authenticates and can be re-queued
 * if it fails.
 */
function flushOnUnload() {
  if (eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, eventQueue.length);
  const token = getAuthToken();
  if (!token) { eventQueue.unshift(...batch); return; }

  const requeue = () => { if (eventQueue.length < 100) eventQueue.unshift(...batch); };

  try {
    fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(batch),
      keepalive: true,
    })
      .then((res) => { if (!res.ok) requeue(); })
      .catch(requeue);
  } catch {
    requeue();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnUnload();
  });
  window.addEventListener('pagehide', flushOnUnload);
  window.addEventListener('beforeunload', flushOnUnload);
}

// ── Note Feedback ─────────────────────────────────────────────

export interface NoteFeedbackApi {
  id: string;
  noteId: string;
  aiEvaluation?: string;
  studentSummary: string;
  teacherNote?: string;
  publishedBy?: string;
  publishedAt?: string;
  isRead?: boolean;
  createdAt: string;
}

export const feedback = {
  list: (noteId: string) =>
    request<{ feedbacks: NoteFeedbackApi[] }>('GET', `/notes/${noteId}/feedback`),

  generate: (noteId: string) =>
    request<{ feedback: NoteFeedbackApi }>('POST', `/notes/${noteId}/feedback/generate`, {}),

  publish: (noteId: string, data: { feedbackId: string; studentSummary: string; teacherNote?: string }) =>
    request<{ success: boolean; feedbackId: string }>('POST', `/notes/${noteId}/feedback/publish`, data),

  markRead: (noteId: string, feedbackId: string) =>
    request<{ success: boolean }>('PATCH', `/notes/${noteId}/feedback/${feedbackId}/read`, {}),
};

// ── Metrics ───────────────────────────────────────────────────

export interface SpaceSummary {
  activeUsers: number;
  newNotes: number;
  newRelations: number;
  unresolvedNotes: number;
  aiPrompts: number;
}

export interface AISummary {
  totalInterventions: number;
  todayInterventions: number;
  acceptedCount: number;
  acceptanceRate: string;
  uniqueUsersEngaged: number;
  triggerTypeDistribution: Record<string, number>;
}

export const metrics = {
  summary: (spaceId: string) =>
    request<SpaceSummary>('GET', `/spaces/${spaceId}/metrics/summary`),
  hotNotes: (spaceId: string, limit?: number) =>
    request<{ hotNotes: unknown[] }>('GET', `/spaces/${spaceId}/metrics/hot-notes${limit ? `?limit=${limit}` : ''}`),
  stagnantNotes: (spaceId: string, hours?: number) =>
    request<{ stagnantNotes: unknown[] }>('GET', `/spaces/${spaceId}/metrics/stagnant-notes${hours ? `?hours=${hours}` : ''}`),
  evidenceGaps: (spaceId: string) =>
    request<{ evidenceGaps: unknown[] }>('GET', `/spaces/${spaceId}/metrics/evidence-gaps`),
  participation: (spaceId: string) =>
    request<{ participation: unknown[] }>('GET', `/spaces/${spaceId}/metrics/participation`),
  aiSummary: (spaceId: string) =>
    request<{ aiSummary: AISummary }>('GET', `/spaces/${spaceId}/metrics/ai-summary`),
};

// ── Notifications ──────────────────────────────────────────────

export interface ApiNotification {
  id: string;
  user_id: string;
  type: 'system' | 'task' | 'buildon' | 'mention' | 'teacher';
  title: string;
  message: string;
  read: boolean;
  link_type?: string;
  link_id?: string;
  created_at: string;
}

export const notifications = {
  list: (unreadOnly?: boolean) =>
    request<{ notifications: ApiNotification[] }>(
      'GET',
      `/notifications${unreadOnly ? '?unread_only=true' : ''}`,
    ),
  markRead: (id: string) =>
    request<{ notification: ApiNotification }>('PATCH', `/notifications/${id}/read`),
  markAllRead: () =>
    request<{ message: string }>('PATCH', '/notifications/read-all'),
  create: (data: {
    user_id: string;
    type: string;
    title: string;
    message: string;
    link_type?: string;
    link_id?: string;
  }) => request<{ notification: ApiNotification }>('POST', '/notifications', data),
};

// ── Admin ──────────────────────────────────────────────────────

export interface AdminOverview {
  totals: {
    totalCourses: number;
    totalTeachers: number;
    totalStudents: number;
    totalMessages: number;
    pendingTeachers: number;
  };
  deltas30d: {
    courses: number;
    teachers: number;
    students: number;
    messages: number;
  };
  activity: {
    aiMessages24h: number;
  };
  generatedAt: string;
}

export interface AdminProviderUsage {
  providerId: string;
  count: number;
  percentage: number;
}

export interface AdminCourseAIUsage {
  courseId: string;
  courseName: string;
  teacherName: string;
  messageCount: number;
  activeProviders: string[];
}

export interface AdminAIAnalytics {
  platformTotals: {
    totalCourses: number;
    totalTeachers: number;
    totalStudents: number;
    totalMessages: number;
  };
  providerUsage: AdminProviderUsage[];
  courseUsage: AdminCourseAIUsage[];
  generatedAt: string;
}

export interface AdminCourseSummary {
  id: string;
  title: string;
  instructor_id: string;
  instructor_name: string;
  cover_image: string | null;
  tags: string[];
  verification_code: string | null;
  created_at: string;
  student_count: number;
  teacher_count?: number;
  note_count: number;
  last_activity_at: string | null;
}

export interface DashboardCourseSummary {
  id: string;
  title: string;
  instructorId: string;
  instructorName: string;
  coverImage: string | null;
  tags: string[];
  verificationCode: string | null;
  createdAt: string;
  studentCount: number;
  teacherCount?: number;
  noteCount: number;
  lastActivityAt: string | null;
  hasAi: boolean;
  hasUnreadFeedback: boolean;
  unreadFeedbackCount: number;
  /** 教师首页才有：我在这门课里的身份 */
  viewerStanding?: CourseRole;
}

export interface DashboardNotificationSummary {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  linkType: string | null;
  linkId: string | null;
}

export interface StudentDashboardOverview {
  generatedAt: string;
  actionCenter: {
    unreadFeedbackCount: number;
    unreadNotificationCount: number;
    aiEnabledCourseCount: number;
    availableCourseCount: number;
  };
  enrolledCourses: DashboardCourseSummary[];
  availableCourses: DashboardCourseSummary[];
  recentTeacherNotifications: DashboardNotificationSummary[];
}

export interface TeacherDashboardOverview {
  generatedAt: string;
  totals: {
    totalCourses: number;
    totalStudents: number;
    totalNotes: number;
    aiEnabledCourses: number;
    pendingFeedbackCount: number;
  };
  courses: DashboardCourseSummary[];
}

export interface LoginRecord { at: string; method: string }
export interface PlatformLoginSummary {
  userId: string; name: string; email: string; role: string; status: string;
  lastLoginAt: string | null; count: number;
}
export interface CourseLoginSummary { userId: string; lastLoginAt: string | null; count: number }

/** 登录记录：学生看自己，课程创建者/管理员看本课成员，平台管理员看全站。查看本身会留痕。 */
export const loginLogs = {
  mine: () => request<{ logins: LoginRecord[]; retentionDays: number }>('GET', '/auth/me/logins'),
  course: (courseId: string, days = 30) =>
    request<{ days: number; retentionDays: number; members: CourseLoginSummary[] }>('GET', `/courses/${courseId}/login-logs?days=${days}`),
  courseUser: (courseId: string, userId: string) =>
    request<{ logins: LoginRecord[]; retentionDays: number }>('GET', `/courses/${courseId}/login-logs/${userId}`),
  platform: (days = 30, q = '') =>
    request<{ days: number; retentionDays: number; users: PlatformLoginSummary[] }>('GET', `/admin/login-logs?days=${days}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  platformUser: (userId: string) =>
    request<{ logins: LoginRecord[]; retentionDays: number }>('GET', `/admin/login-logs/${userId}`),
};

export const admin = {
  overview: () => request<{ overview: AdminOverview }>('GET', '/admin/overview'),
  aiAnalytics: (limit?: number) =>
    request<{ stats: AdminAIAnalytics }>('GET', `/admin/ai-analytics${limit ? `?limit=${limit}` : ''}`),
  courses: () => request<{ courses: AdminCourseSummary[] }>('GET', '/admin/courses'),
};

export interface AttentionItem {
  type: 'stagnant' | 'rejected_feedback' | 'repeat_trigger';
  noteId: string;
  noteTitle: string;
  studentName: string;
  spaceId: string;
  detail: string;
  timestamp: string;
}

export interface FeedbackReviewStats {
  totalFeedbacks: number;
  acceptedCount: number;
  ignoredCount: number;
  insertedCount: number;
  newCount: number;
  acceptanceRate: number;
  triggerDistribution: Record<string, number>;
  studentBreakdown: { userId: string; studentName: string; total: number; accepted: number; ignored: number }[];
}

export interface FeedbackReviewItem {
  id: string;
  noteId: string;
  noteTitle: string;
  userId: string;
  studentName: string;
  triggerType: string;
  feedbackText: string;
  status: string;
  createdAt: string;
  respondedAt?: string;
}

export interface FeedbackTrendPoint {
  date: string;
  total: number;
  accepted: number;
  ignored: number;
  acceptanceRate: number;
  byTrigger: Record<string, number>;
}

export interface TriggerEffectivenessRow {
  triggerType: string;
  totalCount: number;
  acceptedCount: number;
  ignoredCount: number;
  insertedCount: number;
  acceptanceRate: number;
  avgResponseTimeSeconds: number | null;
}

export const dashboard = {
  studentOverview: () => request<{ overview: StudentDashboardOverview }>('GET', '/dashboard/student-overview'),
  teacherOverview: () => request<{ overview: TeacherDashboardOverview }>('GET', '/dashboard/teacher-overview'),
  needsAttention: (courseId: string, limit?: number) =>
    request<{ items: AttentionItem[] }>('GET', `/dashboard/courses/${courseId}/needs-attention${limit ? `?limit=${limit}` : ''}`),
  feedbackReview: (courseId: string, limit?: number) =>
    request<{ stats: FeedbackReviewStats; feedbacks: FeedbackReviewItem[] }>('GET', `/dashboard/courses/${courseId}/feedback-review${limit ? `?limit=${limit}` : ''}`),
  triggerEffectiveness: (courseId: string) =>
    request<{ effectiveness: TriggerEffectivenessRow[] }>('GET', `/dashboard/courses/${courseId}/trigger-effectiveness`),
  feedbackTrend: (courseId: string, days?: number) =>
    request<{ trend: FeedbackTrendPoint[]; days: number }>('GET', `/dashboard/courses/${courseId}/feedback-trend${days ? `?days=${days}` : ''}`),
  learnerProfiles: (courseId: string) =>
    request<{ profiles: LearnerProfileSummary[] }>('GET', `/dashboard/courses/${courseId}/learner-profiles`),
  myLearningInsights: (courseId: string) =>
    request<{ insights: MyLearningInsights }>('GET', `/dashboard/courses/${courseId}/my-learning-insights`),
  studentAnalytics: (days?: number) => {
    const tz = -new Date().getTimezoneOffset() / 60;
    return request<{ analytics: StudentAnalytics }>('GET', `/dashboard/student-analytics?days=${days ?? 30}&tz=${tz}`);
  },
  studentKnowledgeGraph: (courseId?: string) =>
    request<{ graph: StudentKnowledgeGraph }>('GET', `/dashboard/student-knowledge-graph${courseId ? `?courseId=${courseId}` : ''}`),
  studentPromisingIdeas: () =>
    request<StudentPromisingIdeas>('GET', '/dashboard/student-promising-ideas'),
};

export interface StudentPromisingIdeas {
  promisingIdeas: Array<{ id: string; title: string; createdAt: string; buildOns: number; promisingFlags: number; deepRelations: number; score: number }>;
  similarPeers: Array<{ peerNoteId: string; peerNoteTitle: string; peerName: string; myNoteId: string; myNoteTitle: string; sharedConcepts: string[]; alreadyInteracted: boolean }>;
  riseAboveClusters: Array<{ themes: string[]; notes: Array<{ id: string; title: string; createdAt: string }> }>;
}

// ── Thinking Trainer (思维训练场) ──────────────────────────────

export interface ThinkingProfile {
  totalXp: number;
  level: number;
  nextLevelXp: number;
  skills: Record<string, number>;
  gamesPlayed: number;
  streakDays: number;
  bestScores: Record<string, number>;
}

export interface ThinkingSessionStart {
  sessionId: string;
  mode: 'fallacy' | 'arena' | 'ladder';
  difficulty: number;
  aiPowered: boolean;
  totalQuestions?: number;
  question?: { topic: string; sentences: string[] };
  fallacyOptions?: Array<{ key: string; label: string; desc: string }>;
  topic?: string;
  aiStance?: string;
  maxRounds?: number;
  myHp?: number;
  aiHp?: number;
  assertion?: string;
  maxRungs?: number;
  depthTypes?: Array<{ key: string; label: string; weight: number }>;
}

// ── Coding Trainer (Vibe Coding 道场) ──────────────────────────

export interface CodingProfile {
  totalXp: number;
  level: number;
  nextLevelXp: number;
  skills: Record<string, number>;
  challengesCompleted: number;
  bugsFixed: number;
  gamesPlayed: number;
  streakDays: number;
  bestScores: Record<string, number>;
}

export interface CodingTask {
  title: string;
  description: string;
  requires?: string;
  starterHint?: string;
  bugHint?: string;
  starterCode?: string;
  testCode: string;
}

export const codingTrainer = {
  start: (mode: 'challenge' | 'bughunt' | 'sandbox', difficulty?: number) =>
    request<{ sessionId: string; mode: string; difficulty: number; aiPowered: boolean; task: CodingTask }>('POST', '/coding-trainer/sessions', { mode, difficulty }),
  ai: (sessionId: string, payload: { action: 'generate' | 'explain' | 'fix' | 'review'; prompt?: string; currentCode?: string; lastOutput?: string }) =>
    request<{ reply: string; code: string | null; aiPowered: boolean }>('POST', `/coding-trainer/sessions/${sessionId}/ai`, payload),
  countRun: (sessionId: string) =>
    request<{ ok: boolean }>('POST', `/coding-trainer/sessions/${sessionId}/run`, {}),
  submit: (sessionId: string, payload: { passed: boolean; finalCode?: string }) =>
    request<{ score: number; xpGain: number; totalXp: number; level: number; leveledUp: boolean; streak: number; skills: Record<string, number>; isNewBest: boolean }>('POST', `/coding-trainer/sessions/${sessionId}/submit`, payload),
  profile: () =>
    request<{ profile: CodingProfile; recentSessions: Array<{ id: string; mode: string; title: string; score: number; status: string; created_at: string }> }>('GET', '/coding-trainer/profile'),
};

// ── CT Tool (计算思维工具) ─────────────────────────────────────

export interface CtProblem {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  source: 'builtin' | 'teacher' | 'student';
  proposerName: string;
  solverCount: number;
  myStatus: 'not_started' | 'active' | 'completed';
  myProgress: number;
  updatedAt: string | null;
  hints: string[];
  starterCode: string;
}

export interface CtSolutionSteps {
  decomposition?: { nodes: string[] };
  pattern?: { observation: string };
  abstraction?: { essence: string };
  algorithm?: { steps: string[] };
  code?: { source: string; lastOutput?: string };
  reflection?: { text: string };
}

export const ctTool = {
  problems: (courseId: string) =>
    request<{ problems: CtProblem[] }>('GET', `/ct/${courseId}/problems`),
  propose: (courseId: string, body: { title: string; description: string; category?: string; difficulty?: string }) =>
    request<{ problemId: string }>('POST', `/ct/${courseId}/problems`, body),
  loadSolution: (courseId: string, problemId: string) =>
    request<{ solution: { steps: CtSolutionSteps; step_status: Record<string, boolean>; status: string; published_note_id: string | null; updated_at: string | null } }>('GET', `/ct/${courseId}/solutions/${problemId}`),
  saveSolution: (courseId: string, problemId: string, body: { steps: CtSolutionSteps; step_status: Record<string, boolean>; status?: string }) =>
    request<{ saved: boolean }>('PUT', `/ct/${courseId}/solutions/${problemId}`, body),
  publish: (courseId: string, problemId: string) =>
    request<{ noteId: string; title: string }>('POST', `/ct/${courseId}/solutions/${problemId}/publish`, {}),
  aiAssist: (courseId: string, body: { kind: 'decompose' | 'pattern_hint' | 'algorithm_review' | 'code_feedback' | 'reflect_prompt'; problemTitle: string; problemDescription: string; context?: string }) =>
    request<{ aiPowered: boolean; suggestions: string[]; feedback: string }>('POST', `/ct/${courseId}/ai-assist`, body),
  myStats: (courseId: string) =>
    request<{ stats: { attempted: number; completed: number; published: number; totalProblems: number; stepCounts: Record<string, number>; lastActive: string | null } }>('GET', `/ct/${courseId}/my-stats`),
};

export const thinkingTrainer = {
  start: (mode: 'fallacy' | 'arena' | 'ladder', difficulty?: number) =>
    request<ThinkingSessionStart>('POST', '/thinking-trainer/sessions', { mode, difficulty }),
  move: (sessionId: string, payload: Record<string, unknown>) =>
    request<Record<string, any>>('POST', `/thinking-trainer/sessions/${sessionId}/move`, payload),
  complete: (sessionId: string) =>
    request<{ xpGain: number; totalXp: number; level: number; leveledUp: boolean; streak: number; skills: Record<string, number>; bestScore: number; isNewBest: boolean }>('POST', `/thinking-trainer/sessions/${sessionId}/complete`, {}),
  profile: () =>
    request<{ profile: ThinkingProfile; recentSessions: Array<{ id: string; mode: string; topic: string; score: number; status: string; rounds_completed: number; created_at: string }> }>('GET', '/thinking-trainer/profile'),
};

export interface LearnerProfileSummary {
  userId: string;
  userName: string;
  avatar: string | null;
  scaffoldingLevel: 'high' | 'medium' | 'low' | 'minimal';
  interactionCount: number;
  totalMessagesSent: number;
  avgMessageLength: number;
  questionsAsked: number;
  evidenceCited: number;
  connectionsMade: number;
  cognitivePatterns: Record<string, number>;
  reflectionCount: number;
  feedbackStats: { total: number; accepted: number; byType: Record<string, number> };
  lastInteractionAt: string | null;
}

export interface LearningReflection {
  id: string;
  type: string;
  content: string;
  keywords: string[];
  createdAt: string;
}

export interface MyLearningInsights {
  hasProfile: boolean;
  scaffoldingLevel: 'high' | 'medium' | 'low' | 'minimal';
  interactionCount: number;
  questionsAsked: number;
  evidenceCited: number;
  connectionsMade: number;
  reflections: LearningReflection[];
  reflectionCount: number;
  feedbackSummary: { total: number; accepted: number; acceptanceRate: number; byType: Record<string, number> };
  lastInteractionAt: string | null;
}

export interface StudentAnalytics {
  period: { days: number; since: string };
  noteActivity: Array<{ id: string; title: string; type: string; contentLength: number; createdAt: string; updatedAt: string }>;
  totalNotes: number;
  buildOns: { given: number; received: number };
  references: { given: number; received: number };
  relationTypesGiven?: Record<string, number>;
  relationTypesReceived?: Record<string, number>;
  noteTypeDist?: Record<string, number>;
  ideaImpact?: { maxChain: number; totalDescendants: number };
  percentile?: number;
  hourDist?: number[];
  communityStats: { uniqueCollaborators: number; totalNotes: number; totalAuthors?: number };
  aiInteractions: number;
  aiInteractionsChange?: number;
  avgLengthChange?: number;
  weeklyTrend: Array<{ week: string; notes: number; buildOnsGiven: number; buildOnsReceived: number }>;
  actionItems: Array<{ type: string; message: string; count?: number }>;
  unbuiltNotes: Array<{ id: string; title: string; createdAt: string }>;
  topCollaborators?: Array<{ id: string; name: string; given: number; received: number; total: number }>;
  recentBuildOns: Array<{ sourceNoteId: string; creatorId: string; creatorName: string; createdAt: string }>;
}

export interface KnowledgeGraphNode {
  id: string;
  kind: 'mine' | 'peer' | 'concept';
  label: string;
  noteType?: string;
  courseTitle?: string;
  authorName?: string;
  preview?: string;
  createdAt?: string;
  noteCount?: number;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  kind: 'relation' | 'contains';
  relationType?: string;
}

export interface StudentKnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  concepts: Array<{ term: string; noteCount: number }>;
  courses: Array<{ id: string; title: string }>;
  stats: { myNotes: number; peerNotes: number; concepts: number; connections: number };
}

// ── Groups & SSRL Tasks ───────────────────────────────────────

export interface ApiGroup {
  id: string;
  name: string;
  courseId: string;
  leaderId?: string;
  color?: string;
  aiFeedbackCondition?: 'treatment' | 'control' | null;
  createdAt: string;
  memberIds: string[];
  members: { id: string; name: string; avatar?: string }[];
}

export interface ApiGroupTask {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  assignedToId?: string;
  assigneeName?: string;
  createdById: string;
  status: 'todo' | 'in_progress' | 'done';
  ssrlPhase: 'planning' | 'monitoring' | 'evaluating';
  createdAt: string;
  updatedAt: string;
}

// ── 小组观点图谱 ──────────────────────────────────────────────
export interface IdeaGraphConcept {
  id: string;
  term: string;
  noteIds: string[];
  authorCount: number;
  score: number;
  /** 相比上一期增加的笔记数；首期或该词上期不在榜上时为 null */
  delta: number | null;
  /** 上一期榜上没有这个词 */
  isNew: boolean;
}
export interface IdeaGraphNote {
  id: string;
  title: string;
  author: string;
  createdAt: string;
  conceptIds: string[];
  builtOnBy: number;
  buildsOn: number;
  isAiGenerated: boolean;
}
export interface IdeaGraphPayload {
  concepts: IdeaGraphConcept[];
  conceptLinks: Array<{ source: string; target: string; weight: number }>;
  notes: IdeaGraphNote[];
  progress: {
    questions: Array<{ noteId: string; title: string; author: string; answered: boolean }>;
    unanswered: Array<{ noteId: string; title: string; author: string; daysOpen: number }>;
    growing: Array<{ term: string; delta: number; isNew: boolean }>;
    chains: Array<{ rootId: string; rootTitle: string; depth: number; participants: number }>;
    headline: string;
  };
  stats: {
    noteCount: number;
    newNoteCount: number;
    memberCount: number;
    activeMemberCount: number;
    buildOnCount: number;
    buildOnByMembers: number;
    aiNoteCount: number;
  };
}
export interface IdeaGraphSnapshot {
  id: string;
  generated_at: string;
  window_start: string;
  window_end: string;
  note_count: number;
  payload: IdeaGraphPayload;
  trigger: 'auto' | 'manual';
}
export interface IdeaGraphResponse {
  graph: IdeaGraphSnapshot | null;
  periodDays: number;
  regenerated: boolean;
  /** 笔记还不够生成一张有信息量的图时为 true */
  pending?: boolean;
  needNotes?: number;
  haveNotes?: number;
}

// ── 讨论速览 ──────────────────────────────────────────────────
export type DigestScope = 'view' | 'group' | 'selection';
export interface DiscussionDigest {
  scope: DigestScope;
  scopeLabel: string;
  noteCount: number;
  authorCount: number;
  questions: Array<{ text: string; noteIds: string[] }>;
  /** 同一问题上的不同说法，**并列**呈现，不合并 */
  positions: Array<{ topic: string; views: Array<{ summary: string; who: string; noteIds: string[] }> }>;
  agreements: Array<{ text: string; noteIds: string[] }>;
  notBuiltOn: Array<{ noteId: string; title: string; author: string; daysOpen: number }>;
  stats: { notes: number; authors: number; buildOns: number; aiNotes: number };
  degraded?: string;
}

// ── Rise Above 讨论室 ─────────────────────────────────────────
export interface RoomAgent {
  id: string; nameZh: string; nameEn: string;
  habitZh: string; habitEn: string; avatar: string;
}
export interface RoomMessage {
  id: string;
  sender_id: string | null;
  sender_name?: string | null;
  /** user=同学 ai=被叫来的 AI 同学 system=那张「系统注意到的」卡 */
  sender_kind: 'user' | 'ai' | 'system';
  agent_mode: string | null;
  content: string;
  payload: unknown;
  created_at: string;
}
export interface RiseAboveRoomData {
  room: {
    id: string; space_id: string; course_id: string; group_id: string | null;
    created_by: string; source_note_ids: string[]; title: string | null;
    status: 'open' | 'published'; published_note_id: string | null;
  };
  sourceNotes: Array<{ id: string; title: string | null; content: string | null; author_name: string | null }>;
  messages: RoomMessage[];
  agents: RoomAgent[];
  /** 服务器判定讨论已经停下来一阵子：页面该去 POST idle-check 问要不要贴卡 */
  stalled?: boolean;
  /** 当前用户能不能发布这间讨论室（开讨论室的人、课程职员） */
  canPublish?: boolean;
}

export const riseAbove = {
  create: (spaceId: string, body: { source_note_ids: string[]; title?: string; card_x?: number; card_y?: number }) =>
    request<{ room: { id: string } }>('POST', `/spaces/${spaceId}/riseabove-rooms`, body),
  listForSpace: (spaceId: string) =>
    request<{ rooms: Array<{ id: string; source_note_ids: string[]; title: string | null; status: string; published_note_id: string | null; card_x: number | null; card_y: number | null; created_at: string }> }>(
      'GET', `/spaces/${spaceId}/riseabove-rooms`),
  get: (roomId: string) =>
    request<RiseAboveRoomData>('GET', `/riseabove-rooms/${roomId}`),
  send: (roomId: string, body: { content: string; mention?: string }) =>
    request<{ messages: RoomMessage[] }>('POST', `/riseabove-rooms/${roomId}/messages`, body),
  idleCheck: (roomId: string) =>
    request<{ messages: RoomMessage[] }>('POST', `/riseabove-rooms/${roomId}/idle-check`),
  publish: (roomId: string, body: { title: string; content: string }) =>
    request<{ note: { id: string; title: string } }>('POST', `/riseabove-rooms/${roomId}/publish`, body),
};

export interface GroupTaskPhaseCount { total: number; done: number }
export interface GroupTaskStatsBucket {
  total: number;
  done: number;
  byPhase: Record<'planning' | 'monitoring' | 'evaluating', GroupTaskPhaseCount>;
}
export interface GroupTaskStats {
  /** teacher/admin 看全课程；学生只看得到自己组 */
  scope: 'course' | 'group';
  groups: Array<GroupTaskStatsBucket & { groupId: string; name: string }>;
  totals: GroupTaskStatsBucket;
}

// ── 教学安排与课次记录 ──────────────────────────────────────────

export type CourseType = 'general' | 'major' | 'required' | 'elective';
export type SessionStatus = 'planned' | 'held' | 'cancelled' | 'rescheduled';

export interface ScheduleSlot {
  /** 1=周一 … 7=周日 */
  weekday: number;
  start: string;   // HH:MM
  minutes: number;
}

export interface CourseSession {
  id: string;
  courseId: string;
  sessionNo: number;
  weekNo: number;
  plannedDate: string;
  plannedStart: string;
  plannedMinutes: number;
  plannedAt: string;
  status: SessionStatus;
  actualDate: string | null;
  actualStart: string | null;
  actualMinutes: number | null;
  movedToDate: string | null;
  movedToStart: string | null;
  cancelReason: string | null;
  note: string | null;
  confirmedAt: string | null;
  /** 系统统计的事实，不经过 AI */
  metrics: {
    window_start?: string; window_end?: string;
    notes?: number; participants?: number; build_ons?: number; ai_feedbacks?: number;
  };
  aiSummary: string | null;
  aiSummaryAt: string | null;
  aiSummaryEdited: boolean;
  /** 只在待确认列表里带上 */
  courseTitle?: string;
}

export interface SessionSummaryCounts {
  total: number; held: number; cancelled: number; rescheduled: number; pending: number;
}

export const courseSessions = {
  /** 设置教学安排并重建课次表。已确认过的课次不会被冲掉。 */
  saveSchedule: (courseId: string, data: {
    course_type?: CourseType | null;
    credit_hours?: number | null;
    total_weeks: number;
    start_date: string;
    timezone?: string;
    schedule: ScheduleSlot[];
  }) => request<{ totalSessions: number; created: number; kept: number; creditHours: number; estimatedHours: number }>(
    'PUT', `/courses/${courseId}/schedule`, data,
  ),

  list: (courseId: string) =>
    request<{
      sessions: CourseSession[];
      summary: SessionSummaryCounts;
      config: {
        courseType: CourseType | null;
        creditHours: number | null;
        totalWeeks: number | null;
        startDate: string | null;
        timezone: string;
        schedule: ScheduleSlot[];
      } | null;
    }>('GET', `/courses/${courseId}/sessions`),

  /** 我教的课里，时间已过但还没确认的课次。 */
  pending: () => request<{ sessions: CourseSession[] }>('GET', '/sessions/pending'),

  confirm: (sessionId: string, data: {
    status: Exclude<SessionStatus, 'planned'>;
    actual_date?: string; actual_start?: string; actual_minutes?: number;
    moved_to_date?: string; moved_to_start?: string;
    cancel_reason?: string; note?: string;
  }) => request<{ session: CourseSession }>('PATCH', `/sessions/${sessionId}`, data),

  /** 生成 AI 教学日志；传 summary 则保存教师自己写的版本。 */
  summarize: (sessionId: string, summary?: string) =>
    request<{ session: CourseSession; provider?: string; model?: string }>(
      'POST', `/sessions/${sessionId}/summary`, summary === undefined ? {} : { summary },
    ),
};

// ── Documents (阅读页 / Word 转换 / 批注) ──────────────────────

/** 文本锚定用「引文 + 所属标题」；PDF 第一版只锚到页码。 */
export type DocAnchor =
  | { kind: 'text'; headingId: string | null; quote: string }
  | { kind: 'page'; page: number }
  | Record<string, never>;

export interface DocAnnotation {
  id: string;
  noteId: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  anchor: DocAnchor;
  quote: string | null;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentText {
  text: string;
  /** mineru = 结构化 Markdown；pdf/docx/plain = 本地抽取的兜底正文 */
  source: 'mineru' | 'pdf' | 'docx' | 'plain' | 'edited' | 'none';
  /** true 表示 MinerU 还在解析，隔几秒再取一次会拿到更好的版本 */
  pending: boolean;
  progress?: { done: number; total: number };
  minerUError?: string | null;
}

export interface DocChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
export interface DocChatThread {
  id: string;
  title: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  messages: DocChatMessage[];
}

export const documents = {
  /** 文档 AI 的历史对话。学生看自己的，教师看全部。 */
  chatHistory: (noteId: string) =>
    request<{ threads: DocChatThread[] }>('GET', `/notes/${noteId}/doc-chat`),

  /** 记一轮问答。不传 thread_id 就新开一段。 */
  recordChatTurn: (noteId: string, data: {
    question: string; answer: string;
    thread_id?: string | null; provider_id?: string; model?: string;
  }) => request<{ thread_id: string }>('POST', `/notes/${noteId}/doc-chat`, data),

  /** 给 AI 阅读的正文。PDF 会在后台升级为 MinerU 解析的 Markdown。 */
  text: (noteId: string) =>
    request<DocumentText>('GET', `/notes/${noteId}/document-text`),

  /** Word → Markdown。服务端转换并缓存，原 .docx 始终可下载。 */
  wordMarkdown: (noteId: string) =>
    request<{ markdown: string; cached: boolean; edited: boolean }>('GET', `/notes/${noteId}/document`),

  /** 保存编辑后的 Word 正文。写在平台呈现层，不回写 .docx。 */
  saveWordMarkdown: (noteId: string, markdown: string) =>
    request<{ markdown: string; edited: boolean }>('PUT', `/notes/${noteId}/document`, { markdown }),

  listAnnotations: (noteId: string) =>
    request<{ annotations: DocAnnotation[] }>('GET', `/notes/${noteId}/annotations`),

  addAnnotation: (noteId: string, data: {
    body: string; anchor?: DocAnchor; quote?: string | null; parent_id?: string | null;
  }) => request<{ annotation: DocAnnotation }>('POST', `/notes/${noteId}/annotations`, data),

  updateAnnotation: (id: string, data: { body?: string; resolved?: boolean }) =>
    request<{ annotation: DocAnnotation }>('PATCH', `/doc-annotations/${id}`, data),

  removeAnnotation: (id: string) =>
    request<{ message: string }>('DELETE', `/doc-annotations/${id}`),
};

export const groups = {
  taskStats: (courseId: string) =>
    request<GroupTaskStats>('GET', `/courses/${courseId}/group-task-stats`),

  /** viewerStanding：调用者的课内身份。旧版后端不带这个字段。 */
  listForCourse: (courseId: string) =>
    request<{ groups: ApiGroup[]; viewerStanding?: CourseRole }>('GET', `/courses/${courseId}/groups`),
  create: (courseId: string, data: { name: string; leader_id?: string; color?: string; member_ids?: string[] }) =>
    request<{ group: ApiGroup }>('POST', `/courses/${courseId}/groups`, data),
  get: (groupId: string) =>
    request<{ group: ApiGroup }>('GET', `/groups/${groupId}`),
  update: (groupId: string, data: { name?: string; leader_id?: string; color?: string; ai_feedback_condition?: 'treatment' | 'control' | null }) =>
    request<{ group: ApiGroup }>('PUT', `/groups/${groupId}`, data),
  delete: (groupId: string) =>
    request<{ message: string }>('DELETE', `/groups/${groupId}`),
  ideaGraph: (groupId: string) =>
    request<IdeaGraphResponse>('GET', `/groups/${groupId}/idea-graph`),
  refreshIdeaGraph: (groupId: string) =>
    request<IdeaGraphResponse>('POST', `/groups/${groupId}/idea-graph/refresh`),
  ideaGraphHistory: (groupId: string) =>
    request<{ history: Array<{ id: string; generated_at: string; window_start: string; window_end: string; note_count: number; trigger: string }> }>(
      'GET', `/groups/${groupId}/idea-graph/history`),
  addMembers: (groupId: string, userIds: string[]) =>
    request<{ message: string }>('POST', `/groups/${groupId}/members`, { user_ids: userIds }),
  removeMember: (groupId: string, userId: string) =>
    request<{ message: string }>('DELETE', `/groups/${groupId}/members/${userId}`),
  // Tasks
  listTasks: (groupId: string, phase?: string) =>
    request<{ tasks: ApiGroupTask[] }>(
      'GET',
      `/groups/${groupId}/tasks${phase ? `?phase=${phase}` : ''}`,
    ),
  createTask: (groupId: string, data: {
    title: string;
    description?: string;
    assigned_to_id?: string;
    ssrl_phase?: string;
  }) => request<{ task: ApiGroupTask }>('POST', `/groups/${groupId}/tasks`, data),
  updateTask: (groupId: string, taskId: string, data: {
    status?: string;
    title?: string;
    description?: string;
    assigned_to_id?: string;
    ssrl_phase?: string;
  }) => request<{ task: ApiGroupTask }>('PATCH', `/groups/${groupId}/tasks/${taskId}`, data),
  deleteTask: (groupId: string, taskId: string) =>
    request<{ message: string }>('DELETE', `/groups/${groupId}/tasks/${taskId}`),
};

// ── AI Chat & Provider Configs ────────────────────────────────

export interface ApiAIConfig {
  id: string;
  courseId: string;
  providerId: string;
  isVerified: boolean;
  enabledModels: string[];
  endpointUrl?: string | null;
  configuredAt: string;
  apiKeyMasked: string;
}

// 模型名对照过 DMXAPI 价目表与实测探测（2026-09）。
// 之前这里有 claude-sonnet-4-5——DMX 已不提供，落到它必失败。
// DeepSeek 原厂 2026-09-10 起只认 deepseek-flash（V4.1）和 deepseek-v4-pro；
// DMX 聚合网关没有 deepseek-flash，那边仍叫 deepseek-v4-flash。
// 与 api/src/services/modelCatalog.ts 的 normalizeDeepSeekModel 保持一致。
const DEFAULT_AI_MODELS: Record<string, string[]> = {
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  dmx: ['glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.5'],
  dmxapi: ['glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.5'],
};

const DEEPSEEK_NATIVE_ALIASES: Record<string, string> = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
};

const DEEPSEEK_DMX_ALIASES: Record<string, string> = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-flash': 'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
};

function normalizeModelForProvider(providerId: string, model: string): string {
  if (providerId === 'deepseek') return DEEPSEEK_NATIVE_ALIASES[model] ?? model;
  if (providerId === 'dmx' || providerId === 'dmxapi') return DEEPSEEK_DMX_ALIASES[model] ?? model;
  return model;
}

function normalizeAIConfig(config: ApiAIConfig): ApiAIConfig {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_AI_MODELS, config.providerId)) return config;
  const enabledModels = Array.from(new Set((config.enabledModels ?? []).map(model => normalizeModelForProvider(config.providerId, model))));
  return {
    ...config,
    enabledModels: enabledModels.length ? enabledModels : DEFAULT_AI_MODELS[config.providerId],
  };
}

export interface AiModelRef {
  providerId: string;
  model: string;
}

/** 学生在笔记 AI 助手里能选哪些模型、「默认」是哪个（教师在课程 AI 设置里定） */
export interface PartnerModelPolicy {
  /** null = 不限，这门课启用的对话模型都能选 */
  allowed: AiModelRef[] | null;
  defaultModel: AiModelRef | null;
}

export type AiFeatureGroup = 'note' | 'space' | 'dashboard' | 'teacher' | 'background';

export interface AiFeatureModelRow {
  id: string;
  group: AiFeatureGroup;
  who: 'student' | 'teacher' | 'both';
  kind: 'chat' | 'image' | 'embedding' | 'search' | 'parse';
  selectable: boolean;
  /** 排第一的失败或排满时会不会自动换下一家 */
  failover: boolean;
  label: { zh: string; en: string };
  desc: { zh: string; en: string };
  fixedNote: { zh: string; en: string } | null;
  /** 教师保存的选择；null = 自动 */
  saved: AiModelRef | null;
  /** 保存的选择现在用不了（没有那家的 key，或模型没启用），正按自动走 */
  savedUnavailable: boolean;
  current: (AiModelRef & { source: 'teacher' | 'default' | 'auto' | 'fixed' | 'activity_default' }) | null;
  fallbacks: AiModelRef[];
  /** 这个功能能选的模型；不能选的功能为空 */
  options: AiModelRef[];
}

/** 有模型菜单的入口：笔记 AI 助手、知识空间助手、学生首页「AI 对话」 */
export type AiPickerSurface = 'note_partner' | 'workspace_agent' | 'personal_agent';

export interface AiPickerPolicy extends PartnerModelPolicy {
  restricted: boolean;
  /** 这个入口能勾的全部模型 */
  options: AiModelRef[];
}

/** GET/PUT /courses/:id/ai-feature-models */
export interface AiFeatureModelsPayload {
  features: AiFeatureModelRow[];
  options: { chat: AiModelRef[]; image: AiModelRef[] };
  partnerModels: PartnerModelPolicy & { restricted: boolean };
  /** 各入口的模型菜单里显示哪些（旧后端没有这个字段） */
  pickers?: Partial<Record<AiPickerSurface, AiPickerPolicy>>;
  providers: string[];
  /** 刚才连续出错、暂时被绕开的厂商 */
  coolingProviders: string[];
  providerConfigured: boolean;
}

export interface AiFeatureModelsPatch {
  /** 功能 → 模型；null 改回自动 */
  features?: Record<string, { provider_id: string; model: string } | null>;
  /** 笔记 AI 助手菜单里的模型；null 不限 */
  partner_models?: Array<{ provider_id: string; model: string }> | null;
  /** 知识空间助手、学生首页 AI 对话菜单里的模型；某个入口 null 不限 */
  picker_models?: Partial<Record<'workspace_agent' | 'personal_agent', Array<{ provider_id: string; model: string }> | null>>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export const ai = {
  // Chat proxy — routes to the configured provider
  chat: (data: {
    course_id: string;
    /** 'auto' 时按 feature 取课程 AI 设置里的选择 */
    provider_id: string;
    model: string;
    messages: ChatMessage[];
    system_prompt?: string;
    note_context?: string;
    use_web_search?: boolean;
    /** 回复长度上限。默认 400 —— 够画布上的简短脚手架，文档问答要更多。 */
    max_tokens?: number;
    /** 哪个功能在问（'doc_ai' | 'prompt_refine'），配合 provider_id: 'auto' 用 */
    feature?: 'doc_ai' | 'prompt_refine';
  }) => request<{ reply: string; provider_id: string; model: string; search_results?: SearchResult[] }>('POST', '/ai/chat', data),

  /**
   * 这一句要不要画、改上一张还是新画、画成哪种（服务端问 Jev，没开时按「画一张……」这类说法认）。
   * route 在画的时候原样带回去，记进这张图的元数据。
   */
  drawRoute: (data: { text: string; previous?: PreviousDrawingPayload | null; last_reply?: string | null; forced?: boolean }) =>
    request<DrawRouteResult>('POST', '/ai/draw-route', data),

  /**
   * 对话里要画图时直接出图（不经对话模型）。markdown 是现成的 ![描述](地址)，有说明时下面跟一句说明。
   * context：界面上正在看的东西（文档标题、正文、这段对话；改上一张时带上那张），服务端先读它们弄清楚要画什么。
   * 回来的 drawing 留着：下一句要改这张时作为 context.previous 带回去。
   */
  image: (data: {
    course_id: string;
    prompt: string;
    feature?: 'doc_ai';
    context?: {
      title?: string;
      text?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      previous?: PreviousDrawingPayload | null;
    };
    mode?: 'new' | 'edit';
    form?: DrawFormChoice | null;
    route?: Record<string, unknown>;
  }) =>
    request<{
      url: string; markdown: string; provider_id: string; model: string; caption?: string; kind?: 'picture' | 'diagram';
      drawing?: { kind: 'picture' | 'diagram'; prompt?: string; diagram?: unknown };
    }>('POST', '/ai/image', data),

  /** 把一段文字读出来。回的是音频字节，直接丢给 <audio> 或 URL.createObjectURL。 */
  speak: async (data: {
    course_id: string;
    text: string;
    model?: string;
    voice_id?: string;
    speed?: number;
  }): Promise<Blob> => {
    const res = await fetch(`${BASE_URL}/ai/speak`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
      cache: 'no-store',
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiClientError(res.status, json.error ?? '语音合成失败', json.details);
    }
    return res.blob();
  },

  // Tavily web search
  search: (data: {
    course_id: string;
    query: string;
    search_depth?: 'basic' | 'advanced';
    max_results?: number;
    include_answer?: boolean;
  }) => request<{ results: SearchResult[]; answer?: string }>('POST', '/ai/search', data),

  // Provider config management (teacher/admin)
  listConfigs: (courseId: string) =>
    request<{ configs: ApiAIConfig[]; partnerModels?: PartnerModelPolicy }>('GET', `/courses/${courseId}/ai-configs`)
      .then((result) => ({ configs: result.configs.map(normalizeAIConfig), partnerModels: result.partnerModels ?? null })),
  saveConfig: (courseId: string, data: {
    provider_id: string;
    api_key: string;
    endpoint_url?: string;
    enabled_models?: string[];
  }) => request<{ config: ApiAIConfig; verified: boolean }>('POST', `/courses/${courseId}/ai-configs`, {
    ...data,
    enabled_models: data.provider_id === 'deepseek' || data.provider_id === 'dmx' || data.provider_id === 'dmxapi'
      ? Array.from(new Set((data.enabled_models ?? []).map(model => normalizeModelForProvider(data.provider_id, model))))
      : data.enabled_models,
  }).then((result) => ({ ...result, config: normalizeAIConfig(result.config) })),
  deleteConfig: (courseId: string, providerId: string) =>
    request<{ message: string }>('DELETE', `/courses/${courseId}/ai-configs/${providerId}`),

  // Trigger settings (teacher AI control panel)
  /** providerConfigured=false 时这门课还没有服务商配置行，保存会 404。 */
  getTriggerSettings: (courseId: string) =>
    request<{ settings: TriggerSettings; providerConfigured?: boolean }>('GET', `/courses/${courseId}/trigger-settings`),
  updateTriggerSettings: (courseId: string, data: Partial<TriggerSettings>) =>
    request<{ settings: TriggerSettings }>('PUT', `/courses/${courseId}/trigger-settings`, data),

  // 各功能用哪个模型（课程教职）
  getFeatureModels: (courseId: string) =>
    request<AiFeatureModelsPayload>('GET', `/courses/${courseId}/ai-feature-models`),
  updateFeatureModels: (courseId: string, patch: AiFeatureModelsPatch) =>
    request<AiFeatureModelsPayload>('PUT', `/courses/${courseId}/ai-feature-models`, patch),

  // C3: Research data export
  researchExportUrl: (courseId: string, format: 'json' | 'csv' = 'json') =>
    `${BASE_URL}/courses/${courseId}/research-export?format=${format}`,

  // SSE streaming chat — returns a ReadableStream
  chatStream: async (data: {
    course_id: string;
    provider_id: string;
    model: string;
    messages: ChatMessage[];
    system_prompt?: string;
    note_context?: string;
  }): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    const res = await fetch(`${BASE_URL}/ai/chat/stream`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new ApiClientError(res.status, 'Stream request failed');
    if (!res.body) throw new ApiClientError(500, 'No response body');
    return res.body.getReader();
  },

  // Chat history
  history: (params?: { space_id?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.space_id) qs.set('space_id', params.space_id);
    if (params?.limit) qs.set('limit', String(params.limit));
    return request<{ history: Array<{
      id: string;
      trigger_type: string;
      provider_id: string;
      model_full_name: string;
      input_context_summary: string;
      response_text: string;
      created_at: string;
    }> }>('GET', `/ai/history?${qs}`);
  },

  // Usage stats
  usage: (courseId: string) =>
    request<{ usage: { today: number; total: number; daily_limit: number; remaining: number } }>(
      'GET', `/ai/usage?course_id=${courseId}`,
    ),
};

// ── Note Conversations ────────────────────────────────────────

export type NoteConversationTargetType = 'group' | 'member' | 'ai';
export type NoteConversationAgentMode =
  | 'idea_coach'
  | 'gap_finder'
  | 'connection_scout'
  | 'evidence_broker'
  | 'rise_above_coach'
  | 'lesson_planner'
  | 'teaching_analyst'
  | 'coach'
  | 'evidence'
  | 'community'
  | 'synthesis';

export interface NoteConversationParticipant {
  userId: string;
  role: 'owner' | 'member' | 'observer';
  lastReadAt?: string;
  user?: { id: string; name: string; avatar?: string };
}

export interface NoteConversationThread {
  id: string;
  noteId: string;
  spaceId: string;
  courseId: string;
  targetType: NoteConversationTargetType;
  groupId?: string;
  targetUserId?: string;
  providerId?: string;
  model?: string;
  title?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  participants: NoteConversationParticipant[];
  /**
   * 学生问的第一句，历史对话列表里靠它认出是哪一段。
   * null = 还没问过话的空白对话（列表里不列）；undefined = 本地刚建、还不知道（按有内容算）
   */
  preview?: string | null;
}

export interface NoteConversationAttachment {
  file_url: string;
  file_name: string;
  mime_type?: string;
  file_size?: number;
}

export interface NoteConversationMessage {
  id: string;
  threadId: string;
  senderId?: string;
  senderKind: 'user' | 'assistant' | 'system';
  content: string;
  scaffoldId?: string;
  scaffoldStepId?: string;
  attachments: NoteConversationAttachment[];
  aiMetadata: Record<string, unknown>;
  createdAt: string;
  sender?: { id: string; name: string; avatar?: string };
}

/** 课程管理 → 课程资料里的知识库概况 */
export interface KbOverview {
  includeAttachments: boolean;
  materials: { total: number; enabled: number; chunks: number };
  attachments: {
    items: Array<{
      noteId: string;
      title: string;
      spaceName: string | null;
      status: string;
      chunks: number;
      embedded: number;
      pages: number | null;
      textSource: string | null;
      updatedAt: string;
    }>;
    chunks: number;
  };
  /** AI 现在检索得到的片段，和其中算好向量的 */
  searchable: { chunks: number; embedded: number };
  retrievals: { days: number; total: number; bySource: Record<string, number>; lastAt: string | null };
}

export interface KbSearchTestResult {
  semantic: boolean;
  reranked: boolean;
  ms: number;
  hits: Array<{
    n: number;
    title: string;
    section: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    kind: 'attachment' | 'material';
    relevance: number | null;
    similarity: number | null;
    matchedBy: 'vector' | 'keyword';
    excerpt: string;
  }>;
}

/** 笔记 AI 回答下面的来源卡片（ai_metadata.kb_sources）：回答里的 [n] 对应哪份资料、哪一节、第几页 */
export interface KbSourceCard {
  n: number;
  title: string;
  section: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  excerpt: string;
  kind: 'attachment' | 'material';
  /** 附件所在的笔记，点开原文用；课程资料为 null */
  noteId: string | null;
  relevance: number | null;
  /** 回答写完后的引用核对：supported 对得上 / contradicted 和资料矛盾 / unsupported 资料没说到；没标引用时 used / unused */
  check?: 'supported' | 'contradicted' | 'unsupported' | 'used' | 'unused';
  checkP?: number;
}

export interface NoteConversationAIStreamEvent {
  token?: string;
  reasoningStatus?: 'thinking' | 'answering' | 'done';
  reasoningChars?: number;
  toolStatus?: 'running' | 'used';
  toolNames?: string[];
  /** 检索到的课程资料，回答开始写之前推来 */
  kbSources?: KbSourceCard[];
  error?: string;
  userMessage?: NoteConversationMessage;
  assistantMessage?: NoteConversationMessage;
}

export const noteConversations = {
  list: (noteId: string) =>
    request<{
      conversations: NoteConversationThread[];
      aiConfigs?: ApiAIConfig[];
      courseId?: string;
      spaceId?: string;
    }>('GET', `/notes/${noteId}/conversations`)
      .then((result) => ({
        ...result,
        aiConfigs: (result.aiConfigs ?? []).map(normalizeAIConfig),
      })),

  create: (noteId: string, data: {
    target_type: NoteConversationTargetType;
    group_id?: string;
    target_user_id?: string;
    provider_id?: string;
    model?: string;
    title?: string;
    /** 「新建对话」：要一段新的，而不是同一个模型下的旧线程。手头已有空白对话时后端直接回它 */
    force_new?: boolean;
  }) => request<{ conversation: NoteConversationThread }>('POST', `/notes/${noteId}/conversations`, data),

  /** 删掉自己的一段对话。只是不再显示，行和消息还留在库里给研究导出；404 = 已经不在了 */
  remove: (threadId: string) => request<{ ok: boolean }>('DELETE', `/note-conversations/${threadId}`),

  listMessages: (threadId: string, params?: { limit?: number; before?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.before) qs.set('before', params.before);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ messages: NoteConversationMessage[] }>('GET', `/note-conversations/${threadId}/messages${suffix}`);
  },

  sendMessage: (threadId: string, data: {
    content?: string;
    scaffold_id?: string;
    scaffold_step_id?: string;
    attachments?: NoteConversationAttachment[];
  }) => request<{ message: NoteConversationMessage }>('POST', `/note-conversations/${threadId}/messages`, data),

  sendAIMessage: (threadId: string, data: {
    content: string;
    provider_id: string;
    model: string;
    scaffold_id?: string;
    scaffold_step_id?: string;
    attachments?: NoteConversationAttachment[];
    use_web_search?: boolean;
    agent_mode?: NoteConversationAgentMode;
  }) => request<{ userMessage: NoteConversationMessage; assistantMessage: NoteConversationMessage }>(
    'POST',
    `/note-conversations/${threadId}/ai`,
    data,
  ),

  /**
   * agentStream=false 走 /ai/stream —— 不装载工具、不跑 ReAct 循环，直接打模型。
   * 「自由提问」用这条：学生只是想聊两句，没必要每次都过一遍智能体。
   */
  streamAIMessage: async (threadId: string, data: {
    content: string;
    provider_id: string;
    model: string;
    scaffold_id?: string;
    scaffold_step_id?: string;
    attachments?: NoteConversationAttachment[];
    use_web_search?: boolean;
    agent_mode?: NoteConversationAgentMode;
    /** 简短 / 适中 / 详细（2026-10-05 起），实际字数由后端按问题难度再调 */
    answer_length?: 'short' | 'medium' | 'long';
  }, agentStream = true): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    const endpoint = agentStream ? 'ai/agent-stream' : 'ai/stream';
    const res = await fetch(`${BASE_URL}/note-conversations/${threadId}/${endpoint}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiClientError(res.status, json.error ?? 'Stream request failed', json.details);
    }
    if (!res.body) throw new ApiClientError(500, 'No response body');
    return res.body.getReader();
  },

  /** 只生图，不跑智能体。整轮从 41s 降到一次生图的时间。 */
  /** mode / form / route 来自 aiApi.drawRoute：改上一张时服务端从这段对话里找出那张照着改 */
  generateImage: (threadId: string, data: { prompt: string; mode?: 'new' | 'edit'; form?: DrawFormChoice | null; route?: Record<string, unknown> }) =>
    request<{
      userMessage: NoteConversationMessage;
      assistantMessage: NoteConversationMessage;
      imageUrl: string;
      model: string;
      /** 画的是什么、依据是什么（先规划过才有） */
      caption?: string;
      kind?: 'picture' | 'diagram';
    }>('POST', `/note-conversations/${threadId}/image`, data),

  uploadAttachment: (threadId: string, data: {
    file_name: string;
    mime_type?: string;
    file_size?: number;
    data_url: string;
  }) => request<{ attachment: NoteConversationAttachment }>(
    'POST',
    `/note-conversations/${threadId}/attachments`,
    data,
  ),
};

// ── Note AI Feedback & Provenance ─────────────────────────────

export interface TriggerSettings {
  enabled_triggers: string[];
  cooldown_seconds: number;
  auto_feedback_enabled: boolean;
  custom_context: string;
  sensitivity: 'conservative' | 'balanced' | 'aggressive';
  response_language: 'auto' | 'zh' | 'en';
  max_feedback_length: number;
  experiment_mode?: boolean;
  /** 画布问题栏后面滚动的讨论主题，默认开 */
  view_topics_enabled?: boolean;
}

/** 问题栏后面滚动的一个讨论主题（AI 按视图里的笔记总结） */
export interface ViewTopic {
  label: string;
  noteIds: string[];
  count: number;
}

export const viewTopics = {
  get: (spaceId: string, viewId: string) =>
    request<{
      topics: ViewTopic[]; generatedAt?: string | null; stale?: boolean; disabled?: 'course' | 'experiment'; noteCount?: number;
      /** 这次没生成出来；retryAfterMs 后再问 */
      failed?: boolean; retryAfterMs?: number;
    }>(
      'GET', `/spaces/${encodeURIComponent(spaceId)}/view-topics?view_id=${encodeURIComponent(viewId)}`),
};

export type NoteAIFeedbackTriggerType =
  | 'undigested_ai' | 'no_reasoning' | 'no_evidence'
  | 'no_connection' | 'promising_seed' | 'unclear';
export type NoteAIFeedbackStatus = 'new' | 'accepted' | 'ignored' | 'followed_up' | 'inserted' | 'rejected';

export interface NoteAIFeedback {
  id: string;
  noteId: string;
  spaceId: string;
  courseId: string;
  userId: string;
  providerId?: string;
  model?: string;
  triggerType: NoteAIFeedbackTriggerType;
  triggerContext: Record<string, unknown>;
  draftExcerpt: string;
  feedbackText: string;
  status: NoteAIFeedbackStatus;
  responseText?: string;
  createdAt: string;
  respondedAt?: string;
  /** 贡献时判定后发布的关联笔记；原 Note 已回应反馈时为空。 */
  publicationReview?: { state: 'pending' | 'processing' | 'addressed' | 'published' | 'uncertain'; evidence?: string | null; reason?: string } | null;
  publishedNoteId?: string | null;
  /** status='rejected' 时学生填的理由（可选补充） */
  rejectionReason?: string | null;
  /** status='rejected' 时的归类 */
  rejectionTag?: string | null;
  /** AI 按这条笔记具体化的半句话头（自适应支架）；随反馈一起生成，受同一道实验门控 */
  suggestedScaffold?: string | null;
  /** 学生把这条 AI 支架插进笔记的时刻 */
  suggestedScaffoldUsedAt?: string | null;
}

export const noteAiFeedback = {
  list: (noteId: string, params?: { limit?: number }) =>
    request<{ feedbacks: NoteAIFeedback[] }>(
      'GET',
      `/notes/${noteId}/ai-feedback${params?.limit ? `?limit=${params.limit}` : ''}`,
    ),

  check: (noteId: string, data: {
    content: string;
    provider_id?: string;
    model?: string;
    last_feedback_id?: string;
  }) => request<{ triggered: boolean; reason?: string; feedback?: NoteAIFeedback }>(
    'POST',
    `/notes/${noteId}/ai-feedback/check`,
    data,
  ),

  respond: (noteId: string, feedbackId: string, data: {
    status: NoteAIFeedbackStatus;
    response_text?: string;
    /** status='rejected' 时必填：不采纳的归类，点一下即可 */
    rejection_tag?: string;
    /** 可选的展开说明 */
    rejection_reason?: string;
  }) =>
    request<{ feedback: NoteAIFeedback; published_note_id?: string | null }>(
      'POST', `/notes/${noteId}/ai-feedback/${feedbackId}/respond`, data,
    ),

  finalize: (noteId: string) => request<{ outcomes: { feedbackId: string; state: string; publishedNoteId?: string }[] }>(
    'POST', `/notes/${noteId}/ai-feedback/finalize`, {}),

  requestFeedback: (noteId: string, data: { content?: string; provider_id?: string; model?: string }) =>
    request<{ triggered: boolean; reason?: string; feedback?: NoteAIFeedback }>('POST', `/notes/${noteId}/ai-feedback/request`, data),

  batchGenerate: (courseId: string, noteIds: string[]) =>
    request<{ results: { noteId: string; triggered: boolean; feedback?: NoteAIFeedback }[] }>(
      'POST', `/courses/${courseId}/ai-feedback/batch`, { note_ids: noteIds },
    ),

  studentProgressReport: (courseId: string, userId: string) =>
    request<{ report: {
      studentId: string; studentName: string; noteCount: number;
      feedbackCount: number; acceptanceRate: number;
      triggerDistribution: Record<string, number>;
      aiSummary: string | null;
      firstNoteAt: string | null; lastNoteAt: string | null;
    } }>('GET', `/courses/${courseId}/students/${userId}/progress-report`),

  /** 学生把这条反馈附带的 AI 支架插进了笔记 */
  scaffoldUsed: (noteId: string, feedbackId: string) =>
    request<{ feedback: NoteAIFeedback }>('POST', `/notes/${noteId}/ai-feedback/${feedbackId}/scaffold-used`, {}),

  recordInsertion: (noteId: string, data: {
    source_message_id?: string;
    feedback_id?: string;
    provider_id?: string;
    model?: string;
    selected_text: string;
    inserted_html: string;
    /** 可选补充。此前是必填自由文本，产生了近四成应付式内容，已降为可选 */
    acceptance_reason?: string;
    student_revision_plan?: string;
    /** 学生选的 GenAI 支架，说明这段 AI 内容在他的思路里算什么 */
    scaffold_id?: string;
    /** 课程没配 GenAI 支架时的兜底归类 */
    reason_tag?: string;
    insertion_anchor?: Record<string, unknown>;
  }) => request<{ insertion: Record<string, unknown> }>('POST', `/notes/${noteId}/ai-insertions`, data),
};

// ── Triggers ──────────────────────────────────────────────────

export interface TriggerResult {
  trigger_type: string;
  severity: 'low' | 'medium' | 'high';
  note_id: string;
  space_id: string;
  prompt: string;
  intervention_id?: string;
}

export interface AIIntervention {
  id: string;
  trigger_type: string;
  provider_id?: string;
  model_full_name?: string;
  input_context_summary?: string;
  response_text?: string;
  accepted_flag?: boolean;
  created_at: string;
}

export const triggers = {
  history: (spaceId: string, limit?: number) =>
    request<{ interventions: AIIntervention[] }>(
      'GET', `/spaces/${spaceId}/triggers/history${limit ? `?limit=${limit}` : ''}`,
    ),

  noteContext: (noteId: string) =>
    request<{ context: unknown }>('GET', `/notes/${noteId}/ai-context`),

};

// ── Course Settings (Goals, Materials, Tasks) ───────────────────

export type { CourseGoal, CourseTask, TaskSubmission };

export interface CourseMaterial {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  uploadedBy?: {
    id: string;
    name: string;
    avatar?: string;
  };
  allowComments: boolean;
  allowAnnotations: boolean;
  commentCount: number;
  createdAt: string;
}

export interface MaterialComment {
  id: string;
  materialId: string;
  userId: string;
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  content: string;
  annotationData?: Record<string, unknown>;
  createdAt: string;
}

/** 课内身份，和平台身份（role）分开：平台教师在别人的课里也可能只是普通成员。 */
export type CourseRole = 'owner' | 'manager' | 'member';

export interface CourseMember {
  userId: string;
  name: string;
  email?: string;
  /** 平台身份：teacher / student / admin */
  role: string;
  /** 课内身份：创建者 / 课程管理员 / 普通成员 */
  courseRole: CourseRole;
  avatar?: string;
  joinedAt: string | null;
  aiFeedbackCondition?: 'treatment' | 'control' | null;
}

export const courseSettings = {
  // ── Members ─────────────────────────────────────────────────────
  listMembers: (courseId: string) =>
    request<{ members: CourseMember[]; total: number; viewerStanding: CourseRole | 'none' }>(
      'GET', `/courses/${courseId}/members`),

  /** 课程概况：学生数、知识空间数、笔记数。 */
  getStats: (courseId: string) =>
    request<{ studentCount: number; teacherCount: number; spaceCount: number; noteCount: number }>(
      'GET', `/courses/${courseId}/stats`),

  /** 指定或撤销课程管理员。只有课程创建者能调。 */
  setMemberRole: (courseId: string, userId: string, role: 'manager' | 'member') =>
    request<{ userId: string; courseRole: CourseRole }>(
      'PATCH', `/courses/${courseId}/members/${userId}/role`, { role }),

  setMemberFeedbackCondition: (courseId: string, userId: string, condition: 'treatment' | 'control' | null) =>
    request<{ userId: string; condition: 'treatment' | 'control' | null }>(
      'PUT', `/courses/${courseId}/members/${userId}/feedback-condition`, { condition },
    ),

  searchTeachers: (courseId: string, q: string) =>
    request<{ teachers: { id: string; full_name: string; email: string; avatar_url?: string }[] }>(
      'GET', `/courses/${courseId}/search-teachers?q=${encodeURIComponent(q)}`
    ),

  inviteTeacher: (courseId: string, userId: string) =>
    request<{ message: string }>('POST', `/courses/${courseId}/invite`, { userId }),

  // ── Goals ───────────────────────────────────────────────────────
  /** 带回调用者的课内身份：只有创建者和课程管理员能增删改。 */
  listGoals: (courseId: string) =>
    request<{ goals: CourseGoal[]; viewerStanding: CourseRole }>('GET', `/courses/${courseId}/goals`),

  createGoal: (courseId: string, data: {
    title: string;
    description?: string | null;
    priority?: number;
  }) => request<{ goal: CourseGoal }>('POST', `/courses/${courseId}/goals`, data),

  updateGoal: (courseId: string, goalId: string, data: {
    title?: string;
    description?: string | null;
    priority?: number;
  }) => request<{ goal: CourseGoal }>('PUT', `/courses/${courseId}/goals/${goalId}`, data),

  deleteGoal: (courseId: string, goalId: string) =>
    request<{ message: string }>('DELETE', `/courses/${courseId}/goals/${goalId}`),

  // ── Materials ───────────────────────────────────────────────────
  listMaterials: (courseId: string) =>
    request<{ materials: CourseMaterial[] }>('GET', `/courses/${courseId}/materials`),

  /** 直传地址。拿到后用 supabase 客户端 uploadToSignedUrl 上传，再调 createMaterial 登记。 */
  signMaterialUpload: (courseId: string, data: { file_name: string; mime_type: string; file_size: number }) =>
    request<{ path: string; token: string; bucket: string }>('POST', `/courses/${courseId}/materials/sign`, data),

  /** 文件落盘后登记。服务端回读字节校验，通过后在后台解析、进课程知识库。 */
  createMaterial: (courseId: string, data: {
    title: string;
    description?: string;
    path: string;
    file_name: string;
    mime_type: string;
  }) => request<{ material: { id: string } }>('POST', `/courses/${courseId}/materials`, data),

  deleteMaterial: (courseId: string, materialId: string) =>
    request<{ message: string }>('DELETE', `/courses/${courseId}/materials/${materialId}`),

  // ── 课程知识库（第 3 步，api/src/routes/courseKnowledgeBase.ts）──────────
  /** 这份资料进不进 AI 检索；关掉只是检索不到，文件和片段都留着 */
  setMaterialKb: (courseId: string, materialId: string, enabled: boolean) =>
    request<{ kbEnabled: boolean }>('PATCH', `/courses/${courseId}/materials/${materialId}/kb`, { enabled }),
  /** 清掉解析缓存，从头再读一遍、重新切片入库 */
  reparseMaterial: (courseId: string, materialId: string) =>
    request<{ state: 'processing' }>('POST', `/courses/${courseId}/materials/${materialId}/reparse`),
  /** 知识空间里上传的附件进不进这门课的 AI 检索（整门课一个开关） */
  setKbAttachments: (courseId: string, enabled: boolean) =>
    request<{ includeAttachments: boolean }>('PUT', `/courses/${courseId}/kb/attachments`, { enabled }),
  kbOverview: (courseId: string) =>
    request<KbOverview>('GET', `/courses/${courseId}/kb/overview`),
  /** 老师输入一个问题，看 AI 会拿到哪几段（不记进检索记录） */
  kbSearchTest: (courseId: string, query: string) =>
    request<KbSearchTestResult>('POST', `/courses/${courseId}/kb/search-test`, { query }),

  // Material comments
  listMaterialComments: (courseId: string, materialId: string) =>
    request<{ comments: MaterialComment[] }>('GET', `/courses/${courseId}/materials/${materialId}/comments`),

  createMaterialComment: (courseId: string, materialId: string, data: {
    content: string;
    annotation_data?: Record<string, unknown>;
  }) => request<{ comment: MaterialComment }>('POST', `/courses/${courseId}/materials/${materialId}/comments`, data),

  deleteMaterialComment: (courseId: string, materialId: string, commentId: string) =>
    request<{ message: string }>('DELETE', `/courses/${courseId}/materials/${materialId}/comments/${commentId}`),

  // ── Tasks ───────────────────────────────────────────────────────
  /** 草稿只给课程教职；带回调用者的课内身份。 */
  listTasks: (courseId: string) =>
    request<{ tasks: CourseTask[]; viewerStanding: CourseRole }>('GET', `/courses/${courseId}/tasks`),

  /** due_date 要带时区（toISOString），后端拒收 datetime-local 那种不带时区的值。 */
  createTask: (courseId: string, data: {
    title: string;
    description?: string | null;
    due_date?: string | null;
    points?: number;
    status?: CourseTaskStatus;
  }) => request<{ task: CourseTask }>('POST', `/courses/${courseId}/tasks`, data),

  /** 只发改了的字段；due_date 传 null 是去掉截止时间。 */
  updateTask: (courseId: string, taskId: string, data: {
    title?: string;
    description?: string | null;
    due_date?: string | null;
    points?: number;
    status?: CourseTaskStatus;
  }) => request<{ task: CourseTask }>('PUT', `/courses/${courseId}/tasks/${taskId}`, data),

  deleteTask: (courseId: string, taskId: string) =>
    request<{ message: string }>('DELETE', `/courses/${courseId}/tasks/${taskId}`),

  // ── Submissions ─────────────────────────────────────────────────
  listSubmissions: (courseId: string, taskId: string) =>
    request<{ submissions: TaskSubmission[] }>('GET', `/courses/${courseId}/tasks/${taskId}/submissions`),

  getSubmission: (courseId: string, taskId: string, submissionId: string) =>
    request<{ submission: TaskSubmission }>('GET', `/courses/${courseId}/tasks/${taskId}/submissions/${submissionId}`),

  createSubmission: (courseId: string, taskId: string, data: {
    content?: string;
    file_url?: string;
    file_name?: string;
    drawing_data?: Record<string, unknown>;
    video_url?: string;
    submission_type?: 'text' | 'file' | 'drawing' | 'video' | 'mixed';
  }) => request<{ submission: TaskSubmission }>('POST', `/courses/${courseId}/tasks/${taskId}/submissions`, data),

  /** 教职批改：评语、得分（不超过任务分值）、状态。 */
  updateSubmission: (courseId: string, taskId: string, submissionId: string, data: {
    feedback?: string | null;
    points_awarded?: number | null;
    status?: TaskSubmissionStatus;
  }) => request<{ submission: TaskSubmission }>('PUT', `/courses/${courseId}/tasks/${taskId}/submissions/${submissionId}`, data),
};

// ── Scaffolds ──────────────────────────────────────────────────

export interface ApiScaffoldStep {
  id: string;
  prompt: string;
  placeholder?: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect';
  options?: string[];
  required: boolean;
}

/** 三框架标注 + 学期出现记录，来自五学期支架分类表 */
export interface ApiScaffoldMetadata {
  l1?: 'TB' | 'CT' | 'GAI' | 'KB';
  l1_zh?: string;
  l1_en?: string;
  l2_zh?: string;
  l2_en?: string;
  hannafin?: string;
  saye_brush?: string;
  liu_metacognitive?: string;
  gai?: boolean;
  semesters?: string[];
  variants?: string[];
  /** 合并了几种原始写法（五学期语料里同一条支架的不同措辞） */
  merged_from?: number;
  source?: string;
}

export interface ApiScaffold {
  id: string;
  /** 教师在本课程隐藏了它；学生端的列表里不会出现 */
  hidden?: boolean;
  title: string;
  titleEn?: string | null;
  description?: string;
  category: string;
  icon?: string;
  color?: string;
  steps: ApiScaffoldStep[];
  metadata?: ApiScaffoldMetadata;
  sortOrder?: number;
  usageCount: number;
  isMandatory: boolean;
  isRecommended: boolean;
  courseId?: string;
  createdBy?: string;
  createdAt: string;
}

export const scaffolds = {
  list: (courseId: string) =>
    request<{ scaffolds: ApiScaffold[]; requireScaffold?: boolean; scaffoldExempt?: boolean }>('GET', `/courses/${courseId}/scaffolds`),

  /** 本课程是否强制使用支架。课程创建者与课程管理员可改。 */
  setPolicy: (courseId: string, data: { require_scaffold: boolean }) =>
    request<{ ok: boolean; requireScaffold: boolean }>('PUT', `/courses/${courseId}/scaffold-policy`, data),

  get: (scaffoldId: string) =>
    request<{ scaffold: ApiScaffold }>('GET', `/scaffolds/${scaffoldId}`),

  create: (courseId: string, data: {
    title: string;
    title_en?: string;
    description?: string;
    category: string;
    icon?: string;
    color?: string;
    steps?: ApiScaffoldStep[];
    metadata?: ApiScaffoldMetadata;
    sort_order?: number;
    is_mandatory?: boolean;
    is_recommended?: boolean;
  }) => request<{ scaffold: ApiScaffold }>('POST', `/courses/${courseId}/scaffolds`, data),

  update: (scaffoldId: string, data: {
    title?: string;
    title_en?: string;
    description?: string;
    category?: string;
    icon?: string;
    color?: string;
    steps?: ApiScaffoldStep[];
    metadata?: ApiScaffoldMetadata;
    sort_order?: number;
    is_mandatory?: boolean;
    is_recommended?: boolean;
  }) => request<{ scaffold: ApiScaffold }>('PUT', `/scaffolds/${scaffoldId}`, data),

  /** 删全局支架要显式带 scope='global'：那是所有课程共用的 */
  delete: (scaffoldId: string, scope?: 'global') =>
    request<{ message: string }>('DELETE', `/scaffolds/${scaffoldId}${scope ? `?scope=${scope}` : ''}`),

  /** 这门课怎么用这条支架（隐藏 / 推荐 / 排序），不改动共用的支架本身 */
  setPrefs: (courseId: string, scaffoldId: string, prefs: { hidden?: boolean; is_recommended?: boolean; sort_order?: number }) =>
    request<{ ok: boolean }>('PUT', `/courses/${courseId}/scaffolds/${scaffoldId}/prefs`, prefs),

  bulk: (courseId: string, data: {
    action: 'hide' | 'show' | 'recommend' | 'unrecommend' | 'delete';
    scaffold_ids: string[];
    scope?: 'global';
  }) => request<{ ok: boolean; updated?: number; deleted?: number }>('POST', `/courses/${courseId}/scaffolds/bulk`, data),

  /** 按正在写的草稿推荐一条支架（服务端问 Jev）；没开或不合适时 scaffold 为 null */
  recommend: (courseId: string, data: {
    title: string;
    text: string;
    parent?: { title: string; text: string } | null;
    used_ids?: string[];
    note_id?: string | null;
    space_id?: string | null;
  }) => request<{
    scaffold: { id: string; title: string; titleEn: string | null; group: string } | null;
    fit: number | null;
    decided_by: 'jev' | 'off' | 'too_short';
  }>('POST', `/courses/${courseId}/scaffolds/recommend`, data),

  /** source: 'recommended' = 用的是推荐的那条 */
  use: (scaffoldId: string, data?: { space_id?: string; note_id?: string; source?: 'recommended' }) =>
    request<{ ok: boolean }>('POST', `/scaffolds/${scaffoldId}/use`, data ?? {}),
};

// ── Views ──────────────────────────────────────────────────────

export interface ApiView {
  id: string;
  spaceId: string;
  title: string;
  description?: string;
  creatorId: string;
  createdAt: string;
  lastModified: string;
}

/** A card is a placement of a view onto some canvas — the only way views link. */
export interface ApiViewCard {
  id: string;
  spaceId: string;
  viewId: string;
  hostViewId: string;
  x: number;
  y: number;
  createdBy: string | null;
}

export const views = {
  list: (spaceId: string) =>
    request<{ views: ApiView[]; cards: ApiViewCard[] }>('GET', `/spaces/${spaceId}/views`),

  create: (spaceId: string, data: {
    title: string;
    host_view_id: string;
    card_x: number;
    card_y: number;
  }) => request<{ view: ApiView; card: ApiViewCard }>('POST', `/spaces/${spaceId}/views`, data),

  rename: (viewId: string, title: string) =>
    request<{ view: ApiView }>('PUT', `/views/${viewId}`, { title }),

  delete: (viewId: string) =>
    request<{ message: string }>('DELETE', `/views/${viewId}`),
};

export const viewCards = {
  create: (spaceId: string, data: { view_id: string; host_view_id: string; x: number; y: number }) =>
    request<{ card: ApiViewCard }>('POST', `/spaces/${spaceId}/view-cards`, data),

  move: (cardId: string, x: number, y: number) =>
    request<{ card: ApiViewCard }>('PATCH', `/view-cards/${cardId}`, { x, y }),

  remove: (cardId: string) =>
    request<{ message: string }>('DELETE', `/view-cards/${cardId}`),
};

// ── Research (Experiment Conditions & Exports) ──────────────────

export interface ExperimentCondition {
  id: string;
  space_id: string;
  condition_name: string;
  ai_enabled: boolean;
  woz_enabled: boolean;
  visibility_mode?: string;
  threshold_profile?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  assigned_count?: number;
}

export interface ConditionAssignment {
  id: string;
  condition_id: string;
  user_id: string;
  assigned_at: string;
  assigned_by?: string;
  users?: { id: string; name: string; email: string };
}

export interface ResearchSummary {
  condition_count: number;
  conditions: { id: string; name: string; ai_enabled: boolean; woz_enabled: boolean }[];
  total_notes: number;
  unique_authors: number;
  total_relations: number;
  total_interventions: number;
  accepted_interventions: number;
  dismissed_interventions: number;
  pending_interventions: number;
  total_events: number;
}

export interface ResearchOverviewStat {
  value: number;
  change: number;
  sparkline: number[];
}

export interface ResearchOverview {
  days: number;
  period: { start: string; end: string };
  stats: {
    total_notes: ResearchOverviewStat;
    total_events: ResearchOverviewStat;
    unique_authors: ResearchOverviewStat;
    total_relations: ResearchOverviewStat;
    total_interventions: ResearchOverviewStat;
    accepted_interventions: ResearchOverviewStat;
    dismissed_interventions: ResearchOverviewStat;
    pending_interventions: ResearchOverviewStat;
  };
  timeline: { date: string; notes: number; events: number }[];
  interventionDist: { accepted: number; dismissed: number; pending: number; total: number };
  networkStats: { participants: number; active_participants: number; density: number; avg_degree: number; avg_events_per_author: number };
  insights: { type: string; icon: string; text: string; data?: Record<string, number | string> }[];
  findings: string[];
  recentActivities: { id: string; type: string; status: string; message: string; trigger_type: string; created_at: string }[];
  kbMetrics?: {
    riseAboveCount: number;
    riseAboveChange: number;
    maxBuildOnDepth: number;
    gini: number;
    noteTypeDist: Record<string, number>;
    relationTypeDist: Record<string, number>;
    triggerTypeDist: Record<string, number>;
    topContributors: { authorId: string; noteCount: number; inDegree: number; outDegree: number }[];
  };
}

export type ExportDatasetKey =
  | 'notes' | 'interactions' | 'participants' | 'messages'
  | 'ai_feedbacks' | 'ai_interventions' | 'feedback_checks' | 'events' | 'note_revisions'
  | 'support_questions' | 'sessions';

export interface AiModelInfo {
  id: string;
  label: string;
  note?: string;
  vision?: boolean;
  fast?: boolean;
}

/** 后端 modelCatalog 的快照：全平台唯一一份「有哪些模型可用」的清单 */
export interface AiModelCatalog {
  dmx: { text: AiModelInfo[]; vision: AiModelInfo[]; image: AiModelInfo[]; defaults: string[] };
  native: Record<string, AiModelInfo[]>;
  tiers: Record<string, string[]>;
}

export interface AiProbeResult { model: string; ok: boolean; status?: number; latencyMs: number; error?: string }
export interface AiProbeReport { provider: string; probedAt: string; total: number; okCount: number; results: AiProbeResult[] }

export const aiModels = {
  catalog: () => request<AiModelCatalog>('GET', '/ai/model-catalog'),
  probe: (courseId: string, data: { provider_id: string; models?: string[] }) =>
    request<AiProbeReport>('POST', `/courses/${courseId}/ai-probe`, data),
  loadTest: (courseId: string, data: { concurrency: number; providers?: string[] }) =>
    request<Record<string, unknown>>('POST', `/courses/${courseId}/ai-loadtest`, data),
  gatewayStats: () => request<Record<string, unknown>>('GET', '/ai/gateway-stats'),
};

export type ExportColumnGroup =
  | 'identity' | 'location' | 'content' | 'structure'
  | 'ai' | 'scaffold' | 'layer' | 'time' | 'meta';

export interface ExportColumnDef {
  key: string;
  zh: string;
  en: string;
  group: ExportColumnGroup;
  sensitive?: boolean;
}

export interface ExportFilterPayload {
  space_ids?: string[];
  group_ids?: string[];
  view_id?: string;
  from?: string;
  to?: string;
  include_ai_generated?: boolean;
  include_suppressed?: boolean;
  include_deleted?: boolean;
  include_names?: boolean;
  /** 只导出这一个人的数据（用户 id）；不给就是全部 */
  participant_id?: string;
  datasets?: ExportDatasetKey[];
  columns?: string[];
  header_lang?: 'zh' | 'en';
  limit?: number;
}

export const research = {
  // Conditions
  listConditions: (spaceId: string) =>
    request<{ conditions: ExperimentCondition[] }>('GET', `/spaces/${spaceId}/conditions`),

  createCondition: (spaceId: string, data: {
    condition_name: string;
    ai_enabled?: boolean;
    woz_enabled?: boolean;
    visibility_mode?: string;
  }) => request<{ condition: ExperimentCondition }>('POST', `/spaces/${spaceId}/conditions`, data),

  updateCondition: (conditionId: string, data: {
    condition_name?: string;
    ai_enabled?: boolean;
    woz_enabled?: boolean;
    visibility_mode?: string;
  }) => request<{ condition: ExperimentCondition }>('PUT', `/conditions/${conditionId}`, data),

  deleteCondition: (conditionId: string) =>
    request<{ message: string }>('DELETE', `/conditions/${conditionId}`),

  // Assignments
  assign: (conditionId: string, userIds: string[]) =>
    request<{ message: string }>('POST', `/conditions/${conditionId}/assign`, { user_ids: userIds }),

  unassign: (conditionId: string, userId: string) =>
    request<{ message: string }>('DELETE', `/conditions/${conditionId}/assign/${userId}`),

  listAssignments: (spaceId: string, conditionId: string) =>
    request<{ assignments: ConditionAssignment[] }>('GET', `/spaces/${spaceId}/conditions/${conditionId}/assignments`),

  // Summary
  summary: (spaceId: string) =>
    request<{ summary: ResearchSummary }>('GET', `/spaces/${spaceId}/research/summary`),

  overview: (spaceId: string, days?: number) =>
    request<ResearchOverview>('GET', `/spaces/${spaceId}/research/overview${days ? `?days=${days}` : ''}`),

  // ── Research export: preview on screen, download what you see ───────────
  setCourseEnglishName: (courseId: string, data: { english_name: string; code_abbr?: string }) =>
    request<{ englishName: string; abbr: string; sample: string[] }>(
      'PUT', `/courses/${courseId}/english-name`, data,
    ),

  exportOptions: (courseId: string) =>
    request<{
      course: { title: string; englishName: string | null; abbr: string | null; suggestedAbbr: string | null };
      spaces: { id: string; title: string; groupId: string | null }[];
      groups: { id: string; name: string; condition: 'treatment' | 'control' | null; memberCount: number }[];
      views: { id: string; noteCount: number }[];
      dateRange: { earliest: string | null; latest: string | null };
      /** 按人导出的名单：有编号的成员，学生在前（旧版后端没有） */
      people?: { userId: string; code: string; name: string; role: 'student' | 'teacher'; groupName: string | null }[];
      /** 按人导出时不含的表（课次记录是全班的） */
      notPerPerson?: ExportDatasetKey[];
      datasets: {
        key: ExportDatasetKey; zh: string; en: string; descZh: string; descEn: string;
        columns: ExportColumnDef[];
      }[];
    }>('GET', `/courses/${courseId}/research/export/options`),

  /** Rows for the on-screen table — the same rows the CSV will contain. */
  exportTable: (courseId: string, payload: ExportFilterPayload) =>
    request<{
      needsEnglishName: boolean;
      dataset: ExportDatasetKey;
      columns: ExportColumnDef[];
      rows: Record<string, unknown>[];
      total: number;
      counts: Record<ExportDatasetKey, number>;
      truncated: ExportDatasetKey[];
      warnings: string[];
    }>('POST', `/courses/${courseId}/research/export/table`, payload),

  /** One dataset → CSV blob; several → ZIP blob. */
  exportDownload: async (courseId: string, payload: ExportFilterPayload): Promise<Blob> => {
    const res = await fetch(`${BASE_URL}/courses/${courseId}/research/export/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(detail || `Export failed (${res.status})`);
    }
    return res.blob();
  },

  // Research exports (always anonymized)
  exportEvents: (spaceId: string, data: { from?: string; to?: string; format?: 'json' | 'csv' }) =>
    request<{ events: unknown[]; total: number }>('POST', `/spaces/${spaceId}/research/export/events`, data),

  exportNetwork: (spaceId: string, data: { format?: 'json' | 'gexf' }) =>
    request<{ nodes: unknown[]; edges: unknown[] }>('POST', `/spaces/${spaceId}/research/export/network`, data),

  exportInterventions: (spaceId: string, data: { from?: string; to?: string; format?: 'json' | 'csv' }) =>
    request<{ interventions: unknown[]; total: number }>('POST', `/spaces/${spaceId}/research/export/interventions`, data),

  sna: (spaceId: string) =>
    request<{
      metrics: { density: number; nodeCount: number; edgeCount: number; components: number; avgDegree: number; reciprocity?: number; degreeCentralization?: number };
      nodes: { id: string; noteCount: number; inDegree: number; outDegree: number; degreeCentrality: number; betweennessCentrality: number }[];
      edges: { source: string; target: string; weight: number }[];
    }>('POST', `/spaces/${spaceId}/research/sna`),

  lsa: (spaceId: string, data: { lag?: number; codeField?: string; sessionGapMinutes?: number }) =>
    request<{
      codes: string[];
      lag: number;
      codeField: string;
      sessionGapMinutes?: number;
      sessionCount?: number;
      totalTransitions: number;
      transitionMatrix: number[][];
      zScoreMatrix: number[][];
      transitionProbs?: number[][];
      significantTransitions?: { from: string; to: string; observed: number; expected: number; z: number; prob: number }[];
      codeFrequencies?: Record<string, number>;
    }>('POST', `/spaces/${spaceId}/research/lsa`, data),

  temporal: (spaceId: string, data?: { granularity?: 'day' | 'week' | 'hour'; tzOffsetHours?: number }) =>
    request<{
      timeline: { date: string; notes: number; events: number; relations: number }[];
      hourDistribution: number[];
      dayOfWeekDistribution: number[];
      heatmap: { date: string; count: number }[];
      authorPatterns: { authorId: string; firstActivity: string; lastActivity: string; totalDays: number; activeDays: number }[];
      bursts: { date: string; activity: number }[];
      stats: { totalDays: number; avgDailyNotes: number; avgDailyEvents: number; peakDay: { date: string; notes: number; events: number } | null; burstCount: number };
    }>('POST', `/spaces/${spaceId}/research/temporal`, data ?? {}),

  discourse: (spaceId: string) =>
    request<{
      relationTypeDist: Record<string, number>;
      noteTypeDist: Record<string, number>;
      epistemicDist: Record<string, number>;
      chainAnalysis: { maxDepth: number; avgDepth: number; depthDistribution: Record<number, number>; rootCount: number; totalChains: number };
      contentAnalysis: { avgContentLength: number; lengthBuckets: { range: string; count: number }[]; totalWithContent: number };
      authorProfiles: { authorId: string; notes: number; relations: number; avgDepth: number; types: Record<string, number> }[];
      stats: { totalNotes: number; totalRelations: number; riseAboveCount: number; questionRelationPct: number; challengeRelationPct: number };
    }>('POST', `/spaces/${spaceId}/research/discourse`),

  equity: (spaceId: string) =>
    request<{
      gini: number;
      lorenz: { populationPct: number; contributionPct: number }[];
      interactionCoverage: number;
      rankings: { authorId: string; notes: number; relations: number; received: number; total: number; types: Record<string, number> }[];
      silentStudents: { authorId: string; totalContributions: number; notes: number; relations: number }[];
      stats: { totalParticipants: number; activeParticipants: number; silentCount: number; meanContribution: number; maxContribution: number; minContribution: number; stdDev: number };
    }>('POST', `/spaces/${spaceId}/research/equity`),

  aiInsights: (spaceId: string) =>
    request<{
      insights: { type: string; severity: 'high' | 'medium' | 'low'; title: string; description: string; metric?: string }[];
      dataSnapshot: { totalNotes: number; totalRelations: number; totalEvents: number; totalInterventions: number; uniqueAuthors: number };
      generatedAt: string;
    }>('POST', `/spaces/${spaceId}/research/ai-insights`),

  // ── Advanced Research Endpoints ──
  snaAdvanced: (spaceId: string) =>
    request<{
      nodes: { authorId: string; closeness: number; eigenvector: number; clustering: number; kCore: number; constraint: number }[];
      network: { globalClustering: number; reciprocity: number; avgPathLength: number; maxKCore: number; smallWorldIndex: number };
    }>('POST', `/spaces/${spaceId}/research/sna-advanced`),

  cognitiveNetwork: (spaceId: string, data?: { maxNodes?: number }) =>
    request<{
      nodes: { id: string; weight: number; freq: number; docs: number }[];
      edges: { source: string; target: string; weight: number }[];
      stats: { totalNotes: number; uniqueKeywords: number };
    }>('POST', `/spaces/${spaceId}/research/cognitive-network`, data ?? {}),

  lsaAdvanced: (spaceId: string, data?: { lag?: number; codeField?: string; minSupport?: number }) =>
    request<{
      codes: string[];
      lag: number;
      totalTransitions: number;
      transitionMatrix: number[][];
      yulesQ: number[][];
      adjustedResiduals: number[][];
      pValues: number[][];
      significantTransitions: { from: string; to: string; freq: number; zScore: number; yulesQ: number; pValue: number; direction: string }[];
      actorTransitions: Record<string, { dominantPattern: string; diversity: number; transitions: Record<string, number> }>;
      patterns: { pattern: string[]; count: number; support: number }[];
      stationarity: { chiSquare: number; df: number; pValue: number; isStationary: boolean; firstHalfDist: Record<string, number>; secondHalfDist: Record<string, number> };
    }>('POST', `/spaces/${spaceId}/research/lsa-advanced`, data ?? {}),

  temporalAdvanced: (spaceId: string, data?: { sessionGapMinutes?: number; windowSize?: number }) =>
    request<{
      sessions: { list: { authorId: string; start: string; end: string; duration: number; activityCount: number }[]; stats: { totalSessions: number; avgDuration: number; avgActivityPerSession: number; medianDuration: number } };
      regularity: Record<string, { entropy: number; avgInterval: number; stdInterval: number; regularityScore: number }>;
      momentum: { date: string; rate: number; acceleration: number }[];
      phases: { startDate: string; endDate: string; avgActivity: number; phase: string }[];
      rhythmClusters: { authorId: string; peakHour: number; type: string; distribution: number[] }[];
    }>('POST', `/spaces/${spaceId}/research/temporal-advanced`, data ?? {}),

  discourseAdvanced: (spaceId: string) =>
    request<{
      kbDiscourse: { levelDistribution: Record<number, number>; avgLevel: number; progression: number[]; levelDescriptions: Record<number, string> };
      ideaDiversity: { vocabularyEntropy: number; uniqueWords: number; totalWords: number; topKeywords: { word: string; score: number; tf: number; df: number }[]; authorTopicCounts: { authorId: string; uniqueTopics: number }[] };
      collectiveCognitiveResponsibility: { ccrIndex: number; participantsContributing: number; totalParticipants: number; authorContributions: { authorId: string; created: number; improvedByOthers: number; improvedOthers: number; level3Plus: number }[] };
      productiveDiscourse: { totalQuestions: number; questionsResolved: number; questionResolutionRate: number; totalChallenges: number; challengesResolved: number; challengeResolutionRate: number };
    }>('POST', `/spaces/${spaceId}/research/discourse-advanced`),

  equityAdvanced: (spaceId: string, data?: { windowDays?: number }) =>
    request<{
      palmaRatio: number;
      palmaInterpretation: string;
      voiceEquity: number;
      voiceDetails: { respondedToCount: number; totalParticipants: number; neverRespondedTo: number };
      qualityWeightedGini: number;
      temporalEquity: { windowStart: string; gini: number; activeCount: number }[];
      interactionDiversity: { authorId: string; entropy: number; uniqueTargets: number; totalInteractions: number }[];
      equityTrend: string;
    }>('POST', `/spaces/${spaceId}/research/equity-advanced`, data ?? {}),

  // ── Publication-quality Chart Generation ──
  chartTypes: () =>
    request<{ chartTypes: { id: string; name: string; module: string; description: string }[] }>('GET', '/research/chart-types'),

  generateChart: (spaceId: string, chartType: string) =>
    requestBlob('POST', `/spaces/${spaceId}/research/chart/${chartType}`),

  generateChartFromData: (chartType: string, data: unknown) =>
    requestBlob('POST', '/research/chart', { chart_type: chartType, data }),
};

// ── Qualitative Coding ───────────────────────────────────────

export interface CodingScheme {
  id: string;
  course_id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CodingCode {
  id: string;
  scheme_id: string;
  parent_id: string | null;
  name: string;
  color: string;
  description: string;
  sort_order: number;
  created_at: string;
}

export interface CodingReference {
  id: string;
  code_id: string;
  note_id: string;
  coder_id: string;
  start_offset: number;
  end_offset: number;
  coded_text: string;
  memo: string | null;
  created_at: string;
  coding_codes?: { name: string; color: string };
}

export interface CodingStats {
  totalCodes: number;
  totalReferences: number;
  codedNotes: number;
  totalNotes: number;
  codeFrequencies: { id: string; name: string; color: string; count: number }[];
}

export interface CodingNote {
  id: string;
  title: string;
  content: string;
  user_id: string;
  created_at: string;
  type: string;
  is_coded: boolean;
}

export interface CodingMatrix {
  codes: { id: string; name: string; color: string }[];
  authors: { id: string; name: string }[];
  cells: Record<string, Record<string, number>>;
}

export interface CodingTimeline {
  codes: { id: string; name: string; color: string }[];
  dates: string[];
  cells: Record<string, Record<string, number>>;
}

export interface CodingKappa {
  value: number | null;
  coders: { id: string; name: string }[] | string[];
  pairs?: { coder1: string; coder2: string; kappa: number; agreement: number; items: number }[];
  message?: string;
}

export interface AiCodingSuggestion {
  code_name: string;
  code_id: string;
  color: string;
  start: number;
  end: number;
  text: string;
  confidence: number;
  reason: string;
}

export interface AiSimilarSegment {
  reference_id: string;
  code_name: string;
  coded_text: string;
  note_id: string;
  similarity: number;
  reason: string;
}

export interface CodingMemo {
  id: string;
  scheme_id: string;
  author_id: string;
  title: string;
  content: string;
  linked_note_id: string | null;
  linked_code_id: string | null;
  created_at: string;
  updated_at: string;
}

export const coding = {
  listSchemes: (courseId: string) =>
    request<{ schemes: CodingScheme[] }>('GET', `/courses/${courseId}/coding/schemes`),

  createScheme: (courseId: string, data: { name: string; description?: string }) =>
    request<{ scheme: CodingScheme }>('POST', `/courses/${courseId}/coding/schemes`, data),

  updateScheme: (schemeId: string, data: { name?: string; description?: string }) =>
    request<{ scheme: CodingScheme }>('PATCH', `/coding/schemes/${schemeId}`, data),

  deleteScheme: (schemeId: string) =>
    request<{ ok: boolean }>('DELETE', `/coding/schemes/${schemeId}`),

  listCodes: (schemeId: string) =>
    request<{ codes: CodingCode[] }>('GET', `/coding/schemes/${schemeId}/codes`),

  createCode: (schemeId: string, data: { name: string; color?: string; description?: string; parent_id?: string; sort_order?: number }) =>
    request<{ code: CodingCode }>('POST', `/coding/schemes/${schemeId}/codes`, data),

  updateCode: (codeId: string, data: { name?: string; color?: string; description?: string; parent_id?: string; sort_order?: number }) =>
    request<{ code: CodingCode }>('PATCH', `/coding/codes/${codeId}`, data),

  deleteCode: (codeId: string) =>
    request<{ ok: boolean }>('DELETE', `/coding/codes/${codeId}`),

  listReferences: (schemeId: string, filters?: { note_id?: string; code_id?: string }) =>
    request<{ references: CodingReference[] }>('GET', `/coding/schemes/${schemeId}/references${filters ? '?' + new URLSearchParams(filters as Record<string, string>).toString() : ''}`),

  createReference: (data: { code_id: string; note_id: string; start_offset: number; end_offset: number; coded_text: string; memo?: string }) =>
    request<{ reference: CodingReference }>('POST', `/coding/references`, data),

  updateReference: (refId: string, data: { memo?: string; code_id?: string }) =>
    request<{ reference: CodingReference }>('PATCH', `/coding/references/${refId}`, data),

  deleteReference: (refId: string) =>
    request<{ ok: boolean }>('DELETE', `/coding/references/${refId}`),

  getStats: (schemeId: string, courseId?: string) =>
    request<{ stats: CodingStats }>('GET', `/coding/schemes/${schemeId}/stats${courseId ? '?course_id=' + courseId : ''}`),

  listNotes: (courseId: string, schemeId?: string) =>
    request<{ notes: CodingNote[] }>('GET', `/courses/${courseId}/coding/notes${schemeId ? '?scheme_id=' + schemeId : ''}`),

  getNoteContent: (noteId: string) =>
    request<{ note: { id: string; title: string; content: string; user_id: string; created_at: string; type: string; space_id: string } }>('GET', `/coding/notes/${noteId}/content`),

  getMatrix: (schemeId: string, courseId?: string) =>
    request<{ matrix: CodingMatrix }>('GET', `/coding/schemes/${schemeId}/matrix${courseId ? '?course_id=' + courseId : ''}`),

  getTimeline: (schemeId: string) =>
    request<{ timeline: CodingTimeline }>('GET', `/coding/schemes/${schemeId}/timeline`),

  getKappa: (schemeId: string) =>
    request<{ kappa: CodingKappa }>('GET', `/coding/schemes/${schemeId}/kappa`),

  listMemos: (schemeId: string) =>
    request<{ memos: CodingMemo[] }>('GET', `/coding/schemes/${schemeId}/memos`),

  createMemo: (schemeId: string, data: { title: string; content: string; linked_note_id?: string; linked_code_id?: string }) =>
    request<{ memo: CodingMemo }>('POST', `/coding/schemes/${schemeId}/memos`, data),

  updateMemo: (memoId: string, data: { title?: string; content?: string }) =>
    request<{ memo: CodingMemo }>('PATCH', `/coding/memos/${memoId}`, data),

  deleteMemo: (memoId: string) =>
    request<{ ok: boolean }>('DELETE', `/coding/memos/${memoId}`),

  exportData: (schemeId: string, format: 'json' | 'csv' = 'json') =>
    format === 'csv'
      ? fetch(`${BASE_URL}/coding/schemes/${schemeId}/export?format=csv`, { headers: getHeaders() }).then(r => r.blob())
      : request<{ export: any }>('GET', `/coding/schemes/${schemeId}/export`),

  aiSuggest: (schemeId: string, noteId: string, courseId: string) =>
    request<{ suggestions: AiCodingSuggestion[] }>('POST', `/coding/schemes/${schemeId}/ai/suggest`, { note_id: noteId, course_id: courseId }),

  aiBatch: (schemeId: string, noteIds: string[], courseId: string) =>
    request<{ results: { note_id: string; created: number }[]; totalCreated: number }>('POST', `/coding/schemes/${schemeId}/ai/batch`, { note_ids: noteIds, course_id: courseId }),

  aiSimilar: (schemeId: string, text: string, courseId: string, codeId?: string) =>
    request<{ similar: AiSimilarSegment[] }>('POST', `/coding/schemes/${schemeId}/ai/similar`, { text, course_id: courseId, code_id: codeId }),
};

// ── Workspace Agent ──────────────────────────────────────────

export interface AgentConversation {
  id: string;
  title: string;
  agent_mode?: string;
  module?: string;
  provider_id?: string;
  model?: string;
  course_id?: string;
  /** 知识空间助手的对话记着自己在哪个空间 */
  space_id?: string | null;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools_used?: string[];
  ai_metadata?: Record<string, unknown>;
  created_at: string;
}

export const workspaceAgent = {
  digest: (courseId: string, body: {
    scope: DigestScope; space_id?: string; view_id?: string | null;
    note_ids?: string[]; group_id?: string;
  }) => request<{ digest: DiscussionDigest }>('POST', `/workspace-agent/${courseId}/digest`, body),
  getConfigs: (courseId: string) =>
    request<{ aiConfigs: ApiAIConfig[] }>('GET', `/workspace-agent/${courseId}/configs`)
      .then((r) => ({ aiConfigs: (r.aiConfigs ?? []).map(normalizeAIConfig) })),

  /** spaceId：只要这个空间里的（后端按空间授权后再筛） */
  listConversations: (courseId: string, spaceId?: string | null) =>
    request<{ conversations: AgentConversation[] }>(
      'GET',
      `/workspace-agent/${courseId}/conversations${spaceId ? `?space_id=${encodeURIComponent(spaceId)}` : ''}`,
    ),

  createConversation: (courseId: string, data?: { space_id?: string; title?: string }) =>
    request<{ conversation: AgentConversation; aiConfigs?: ApiAIConfig[] }>(
      'POST', `/workspace-agent/${courseId}/conversations`, data,
    ),

  loadMessages: (courseId: string, convId: string) =>
    request<{ messages: AgentMessage[] }>('GET', `/workspace-agent/${courseId}/conversations/${convId}/messages`),

  stream: async (courseId: string, data: {
    content: string;
    provider_id: string;
    model: string;
    space_id?: string;
    agent_mode?: string;
    conversation_id?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    const res = await fetch(`${BASE_URL}/workspace-agent/${courseId}/stream`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiClientError(res.status, json.error ?? 'Stream request failed', json.details);
    }
    return res.body!.getReader();
  },
};

// ── Personal Agent ───────────────────────────────────────────

export const personalAgent = {
  getConfigs: () =>
    request<{ configs: Array<ApiAIConfig & { courseId: string }>; courses: Array<{ id: string; name: string }> }>(
      'GET', '/personal-agent/configs',
    ),

  listConversations: (module?: string) =>
    request<{ conversations: AgentConversation[] }>('GET', `/personal-agent/conversations${module ? `?module=${encodeURIComponent(module)}` : ''}`),

  createConversation: (data?: { title?: string; course_id?: string }) =>
    request<{ conversation: AgentConversation }>('POST', '/personal-agent/conversations', data),

  loadMessages: (convId: string) =>
    request<{ messages: AgentMessage[] }>('GET', `/personal-agent/conversations/${convId}/messages`),

  stream: async (data: {
    content: string;
    provider_id: string;
    model: string;
    course_id: string;
    context_course_id?: string;
    agent_mode?: string;
    module?: string;
    conversation_id?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    const res = await fetch(`${BASE_URL}/personal-agent/stream`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiClientError(res.status, json.error ?? 'Stream request failed', json.details);
    }
    return res.body!.getReader();
  },

  deleteConversation: (convId: string) =>
    request<{ ok: boolean }>('DELETE', `/personal-agent/conversations/${convId}`),

  getHistory: (limit?: number) =>
    request<{ history: Array<{ id: string; trigger_type: string; provider_id: string; model_name: string; input_context_summary: string; response_text: string; created_at: string }> }>(
      'GET', `/personal-agent/history${limit ? `?limit=${limit}` : ''}`,
    ),
};

// ── Lesson Plans (备课助手) ─────────────────────────────────────

export interface LessonPlanSummary {
  id: string;
  title: string;
  plan_type: string;
  topic: string | null;
  duration_minutes: number;
  kb_principles: string[];
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LessonPlanFull extends LessonPlanSummary {
  course_id: string;
  space_id: string | null;
  created_by: string;
  context_notes: string | null;
  content: LessonPlanContentType;
  classroom_context: unknown;
  provider_id: string | null;
  model: string | null;
  parent_id: string | null;
}

export interface LessonPlanContentType {
  objectives?: {
    teaching_goals: string[];
    key_points: string[];
    difficulties: string[];
  };
  activities?: Array<{
    title: string;
    duration_min: number;
    phase: string;
    description: string;
    teacher_actions: string[];
    student_actions: string[];
    kb_principle: string;
    scaffolding_notes: string;
  }>;
  discussion_prompts?: Array<{
    prompt: string;
    purpose: string;
    expected_depth: string;
  }>;
  assessment?: {
    rubric: Array<{
      dimension: string;
      excellent: string;
      good: string;
      developing: string;
    }>;
    formative_checks: string[];
  };
  ai_triggers?: Array<{
    type: string;
    when: string;
    action: string;
    example_feedback: string;
  }>;
  resources?: Array<{
    type: string;
    title: string;
    content: string;
  }>;
  reflection?: {
    teacher_reflection: string[];
    student_reflection: string[];
  };
  inquiry_setup?: {
    activity_name: string;
    theoretical_basis: string;
    learning_objectives: string[];
    group_size: number;
    ai_participants: number;
    materials: string[];
    tech_requirements: string[];
    room_setup: string;
  };
  inquiry_rounds?: Array<{
    round_number: number;
    duration_min: number;
    theme: string;
    questions: Array<{
      question: string;
      category: string;
      difficulty: string;
      evaluation_hint: string;
    }>;
    student_instructions: string;
    evaluation_criteria: string[];
  }>;
  inquiry_evaluation?: {
    dimensions: Array<{
      name: string;
      description: string;
      indicators: string[];
    }>;
    worksheet_prompts: string[];
    scoring_guide: string;
  };
  inquiry_kb_reflection?: {
    principle_connections: Array<{
      principle: string;
      connection: string;
      forum_prompt: string;
    }>;
    rise_above_prompt: string;
    community_knowledge_question: string;
  };
}

export interface ClassroomContextType {
  recentNotes: Array<{
    id: string;
    title: string;
    contentSnippet: string;
    authorId: string;
    createdAt: string;
  }>;
  participation: {
    totalNotes: number;
    uniqueAuthors: number;
  };
  triggers: Array<{
    type: string;
    label: string;
    severity: string;
  }>;
  courseGoals: Array<{ title: string; description: string | null }>;
  learnerProfiles: {
    total: number;
    high: number;
    medium: number;
    low: number;
    minimal: number;
  };
}

export type LessonPlanStreamEvent =
  | { type: 'plan_created'; planId: string; runId?: string }
  | { type: 'context_ready'; context: ClassroomContextType }
  | { type: 'token'; content: string }
  | { type: 'done'; plan: LessonPlanContentType; planId: string; runId?: string }
  | { type: 'error'; error: string };

export const lessonPlans = {
  generate: async (courseId: string, data: {
    plan_type?: string;
    topic?: string;
    duration_minutes?: number;
    kb_principles?: string[];
    context_notes?: string;
    provider_id: string;
    model: string;
    space_id?: string;
    course_title?: string;
  }): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    const res = await fetch(`${BASE_URL}/lesson-plans/${courseId}/generate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiClientError(res.status, json.error ?? 'Generate failed', json.details);
    }
    return res.body!.getReader();
  },

  list: (courseId: string) =>
    request<{ plans: LessonPlanSummary[] }>('GET', `/lesson-plans/${courseId}`),

  get: (courseId: string, planId: string) =>
    request<{ plan: LessonPlanFull }>('GET', `/lesson-plans/${courseId}/${planId}`),

  update: (courseId: string, planId: string, data: {
    title?: string;
    content?: LessonPlanContentType;
    status?: string;
  }) =>
    request<{ plan: LessonPlanFull }>('PUT', `/lesson-plans/${courseId}/${planId}`, data),

  delete: (courseId: string, planId: string) =>
    request<{ message: string }>('DELETE', `/lesson-plans/${courseId}/${planId}`),

  export: (courseId: string, planId: string, lang?: 'zh' | 'en') =>
    request<{ fileId: string; fileName: string; downloadUrl: string }>(
      'POST', `/lesson-plans/${courseId}/${planId}/export`, { lang: lang ?? 'zh' },
    ),
};

// ── Teacher Memory ──────────────────────────────────────────────

export interface TeacherMemoryItem {
  id: string;
  user_id: string;
  course_id: string;
  source: 'lesson_prep' | 'analytics' | 'assessment' | 'chat';
  memory_type: 'insight' | 'decision' | 'observation' | 'plan' | 'action';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const teacherMemory = {
  list: (courseId: string, source?: string) =>
    request<{ memories: TeacherMemoryItem[] }>(
      'GET', `/teacher-memory/${courseId}${source ? `?source=${source}` : ''}`,
    ),

  context: (courseId: string, exclude?: string, lang?: string) =>
    request<{ context: string }>(
      'GET', `/teacher-memory/${courseId}/context?${new URLSearchParams({
        ...(exclude ? { exclude } : {}),
        ...(lang ? { lang } : {}),
      })}`,
    ),

  write: (courseId: string, data: {
    source: string;
    memory_type: string;
    content: string;
    metadata?: Record<string, unknown>;
  }) =>
    request<{ memory: TeacherMemoryItem | null }>('POST', `/teacher-memory/${courseId}`, data),

  delete: (courseId: string, memoryId: string) =>
    request<{ message: string }>('DELETE', `/teacher-memory/${courseId}/${memoryId}`),
};

// ── Agent Runs (lifecycle / effects / checkpoints) ──────────────

export interface AgentRun {
  id: string;
  user_id: string;
  course_id: string | null;
  agent_type: 'chat' | 'lesson_prep' | 'analytics' | 'assessment';
  status: 'planning' | 'gathering' | 'executing' | 'reviewing' | 'applied' | 'failed' | 'cancelled';
  title: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  version: number;
  parent_run_id: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface AgentEffect {
  id: string;
  run_id: string;
  seq: number;
  effect_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AgentCheckpoint {
  id: string;
  run_id: string;
  name: string;
  seq_at: number;
  snapshot: Record<string, unknown>;
  created_at: string;
}

export const agentRuns = {
  list: (params?: { course_id?: string; agent_type?: string; limit?: number }) =>
    request<{ runs: AgentRun[] }>('GET', `/agent-runs?${new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    )}`),

  get: (runId: string) =>
    request<{ run: AgentRun; effects: AgentEffect[]; checkpoints: AgentCheckpoint[] }>(
      'GET', `/agent-runs/${runId}`,
    ),

  versions: (runId: string) =>
    request<{ versions: AgentRun[] }>('GET', `/agent-runs/${runId}/versions`),

  checkpoint: (runId: string, name: string, snapshot?: Record<string, unknown>) =>
    request<{ checkpoint: AgentCheckpoint }>('POST', `/agent-runs/${runId}/checkpoint`, { name, snapshot }),

  rollback: (runId: string, name: string) =>
    request<{ checkpoint: AgentCheckpoint; message: string }>('POST', `/agent-runs/${runId}/rollback`, { name }),
};

// ---------------------------------------------------------------------------
// Turing Test（2026-09-14 群聊版：分群、化名、AI 同学混在群里）
// ---------------------------------------------------------------------------

export type TuringTestStatus = 'draft' | 'open' | 'chatting' | 'voting' | 'revealed' | 'completed';

export interface TuringTestPersona { style: string; quirks: string }

export interface TuringTestActivity {
  id: string;
  course_id?: string;
  title: string;
  topic: string;
  instructions?: string | null;
  status: TuringTestStatus;
  chat_minutes: number;
  room_size: number;
  ai_per_room: number;
  disclose_ai_count: boolean;
  ai_provider?: string | null;
  ai_model?: string | null;
  config?: { persona?: TuringTestPersona } | null;
  started_at?: string | null;
  ends_at?: string | null;
  created_at: string;
  updated_at?: string;
  joined_count?: number;
  judgment_count?: number;
  joined?: boolean;
}

export interface TuringTestMember { id: string; alias: string; is_me: boolean; is_ai?: boolean }

export interface TuringTestChatMessage {
  id: string;
  participant_id: string;
  alias: string;
  mine: boolean;
  content: string;
  at: string;
  is_ai?: boolean;
}

export interface TuringTestJudgment {
  submitted: boolean;
  confidence: number;
  clues: string[];
  correct: number | null;
  total: number | null;
  found_all_ai: boolean | null;
  published_note_id: string | null;
  votes: Record<string, 'human' | 'ai'>;
}

export interface TuringTestRoom {
  id: string;
  my_participant_id: string;
  my_alias: string;
  members: TuringTestMember[];
  /** 教师选择公开时是群里 AI 的数量，否则公布答案前为 null */
  ai_count: number | null;
}

export interface TuringTestMe {
  activity: {
    id: string;
    title: string;
    topic: string;
    instructions: string;
    status: TuringTestStatus;
    chat_minutes: number;
    started_at: string | null;
    ends_at: string | null;
    disclose_ai_count: boolean;
  };
  joined: boolean;
  in_room: boolean;
  room: TuringTestRoom | null;
  messages: TuringTestChatMessage[];
  judgment: TuringTestJudgment | null;
  can_chat: boolean;
  can_vote: boolean;
  /** 调用者在这门课里是主持方（创建者、课程管理员、平台管理员），不参加测试。旧版后端不带。 */
  host?: boolean;
  server_time: string;
}

export interface TuringTestMemberStat {
  id: string;
  alias: string;
  is_ai: boolean;
  /** 只有教师看得到 */
  name?: string | null;
  judged_by: number;
  voted_ai: number;
  rate: number | null;
}

export interface TuringTestResults {
  turing_line: number;
  class: {
    rooms: number;
    students: number;
    judgments: number;
    accuracy: number | null;
    ai_identified_rate: number | null;
    human_mistaken_rate: number | null;
  };
  rooms: Array<{ id: string; room_no: number; members: TuringTestMemberStat[] }>;
  me: { correct: number; total: number; found_all_ai: boolean; accused_humans: number } | null;
  clues_wall: { found: Array<{ clue: string; confidence: number }>; missed: Array<{ clue: string; confidence: number }> };
}

export interface TuringTestOverview {
  activity: TuringTestActivity;
  joined: Array<{ user_id: string; name: string }>;
  rooms: Array<{
    id: string;
    room_no: number;
    members: Array<{ id: string; alias: string; is_ai: boolean; name: string | null; judged: boolean }>;
    messages: { human: number; ai: number };
  }>;
  judgments: number;
  published: number;
}

export interface TuringTestTeacherMessage { id: string; alias: string; is_ai: boolean; name: string | null; content: string; at: string }

export interface TuringTestActivityInput {
  title: string;
  topic: string;
  instructions?: string;
  ai_provider?: string | null;
  ai_model?: string | null;
  chat_minutes?: number;
  room_size?: number;
  ai_per_room?: number;
  disclose_ai_count?: boolean;
  persona?: TuringTestPersona;
}

export const turingTest = {
  /** host 同 TuringTestMe.host，旧版后端不带 */
  list: (courseId: string) =>
    request<{ activities: TuringTestActivity[]; host?: boolean }>('GET', `/turing-test/${courseId}`),

  create: (courseId: string, body: TuringTestActivityInput) =>
    request<{ activity: TuringTestActivity }>('POST', `/turing-test/${courseId}`, body),

  update: (courseId: string, activityId: string, body: Partial<TuringTestActivityInput>) =>
    request<{ activity: TuringTestActivity }>('PUT', `/turing-test/${courseId}/${activityId}`, body),

  remove: (courseId: string, activityId: string) =>
    request<{ ok: boolean }>('DELETE', `/turing-test/${courseId}/${activityId}`),

  updateStatus: (courseId: string, activityId: string, status: TuringTestStatus) =>
    request<{ activity: TuringTestActivity; started: { rooms: number; students: number; ais: number } | null }>(
      'PUT', `/turing-test/${courseId}/${activityId}/status`, { status },
    ),

  overview: (courseId: string, activityId: string) =>
    request<TuringTestOverview>('GET', `/turing-test/${courseId}/${activityId}/overview`),

  roomMessages: (courseId: string, activityId: string, roomId: string) =>
    request<{ messages: TuringTestTeacherMessage[] }>('GET', `/turing-test/${courseId}/${activityId}/rooms/${roomId}/messages`),

  join: (courseId: string, activityId: string) =>
    request<{ ok: boolean }>('POST', `/turing-test/${courseId}/${activityId}/join`),

  me: (courseId: string, activityId: string, after?: string) =>
    request<TuringTestMe>('GET', `/turing-test/${courseId}/${activityId}/me${after ? `?after=${encodeURIComponent(after)}` : ''}`),

  sendMessage: (courseId: string, activityId: string, content: string) =>
    request<{ message: TuringTestChatMessage }>('POST', `/turing-test/${courseId}/${activityId}/message`, { content }),

  judgment: (courseId: string, activityId: string, body: {
    votes: Array<{ participant_id: string; vote: 'human' | 'ai' }>;
    confidence: number;
    clues: string[];
  }) =>
    request<{ judgment: TuringTestJudgment }>('POST', `/turing-test/${courseId}/${activityId}/judgment`, body),

  results: (courseId: string, activityId: string) =>
    request<TuringTestResults>('GET', `/turing-test/${courseId}/${activityId}/results`),

  publishNote: (courseId: string, activityId: string, reflection?: string, lang?: 'zh' | 'en') =>
    request<{ noteId: string; title?: string; already?: boolean }>('POST', `/turing-test/${courseId}/${activityId}/publish-note`, { reflection, lang }),
};

export type ActivityPulse = {
  weeks: Array<{ label: string; startsAt: string; notes: number; aiInteractions: number }>;
  acceptance: {
    accepted: number;
    rejected: number;
    pending: number;
    /** 全部还没表态时为 null —— 0 会被读成「一条都没被接受」。 */
    rate: number | null;
    byTrigger: Array<{ triggerType: string; accepted: number; rejected: number; pending: number; rate: number | null }>;
  };
  heatmap: number[][];
  heatmapMax: number;
  hasData: boolean;
};

/** 概览三张图的真实数据。不传 course_id 就按角色汇总本人相关的全部课程。 */
export const activityPulse = (courseId?: string) =>
  request<{ pulse: ActivityPulse }>(
    'GET',
    `/dashboard/activity-pulse${courseId ? `?course_id=${encodeURIComponent(courseId)}` : ''}`,
  );

export type SupportQuestion = {
  id: string;
  courseId: string;
  spaceId: string | null;
  userId: string;
  userName: string | null;
  question: string;
  aiAnswer: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  aiResolved: boolean | null;
  escalatedAt: string | null;
  escalationNote: string | null;
  teacherAnswer: string | null;
  teacherAnsweredAt: string | null;
  status: 'ai_answered' | 'escalated' | 'teacher_answered' | 'resolved';
  attachments: Array<{ file_url: string; file_name: string; mime_type: string }>;
  context: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

/** 使用帮助小球里「学生求助」的一条：带课程名；askerRole=teacher 是教师转给平台管理员的 */
export type SupportInboxItem = SupportQuestion & {
  courseTitle: string | null;
  askerRole: 'student' | 'teacher';
};

/**
 * 学生求助：平台怎么用的问题。AI 先答，答不了转教师。
 * 攒下来的问答同时是平台改进和下一届学生的语料。
 */
export type PlatformFeedbackKind = 'thought' | 'suggestion' | 'problem' | 'disagree';
export interface PlatformLetterSide { title: string; body: string; signature: string }
export interface PlatformLetter { zh: PlatformLetterSide; en: PlatformLetterSide }
export interface PlatformFeedbackItem {
  id: string;
  kind: PlatformFeedbackKind;
  body: string;
  course_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface AdminPlatformFeedbackItem {
  id: string;
  kind: PlatformFeedbackKind;
  body: string;
  createdAt: string;
  updatedAt: string;
  courseTitle: string | null;
  author: { id: string; name: string; email: string; role: string } | null;
}

/** 学生对平台本身的反馈。任课教师没有入口，只有平台管理员读得到。 */
export const platformFeedback = {
  create: (data: { body: string; kind: PlatformFeedbackKind; course_id?: string | null; context?: Record<string, string> }) =>
    request<{ feedback: PlatformFeedbackItem }>('POST', '/platform-feedback', data),
  mine: () => request<{ feedback: PlatformFeedbackItem[] }>('GET', '/platform-feedback/mine'),
  update: (id: string, data: { body?: string; kind?: PlatformFeedbackKind }) =>
    request<{ feedback: PlatformFeedbackItem }>('PATCH', `/platform-feedback/${id}`, data),
  remove: (id: string) => request<{ ok: boolean }>('DELETE', `/platform-feedback/${id}`),
  all: (kind?: PlatformFeedbackKind) =>
    request<{ feedback: AdminPlatformFeedbackItem[] }>('GET', `/admin/platform-feedback${kind ? `?kind=${kind}` : ''}`),
  /** 走 blob 而不是普通链接：鉴权在请求头里，<a href> 带不上，而 token 不该出现在 URL 里。 */
  exportCsv: () => requestBlob('GET', '/admin/platform-feedback.csv'),

  /** letter 为 null 表示后台没改过，前端用代码里的默认文案。 */
  getLetter: () =>
    request<{ letter: PlatformLetter | null; updatedAt: string | null }>('GET', '/platform-feedback/letter'),
  saveLetter: (letter: PlatformLetter) =>
    request<{ letter: PlatformLetter; updatedAt: string }>('PUT', '/admin/platform-feedback/letter', letter),
  resetLetter: () => request<{ letter: null }>('DELETE', '/admin/platform-feedback/letter'),
};

export const support = {
  ask: (data: {
    course_id: string; space_id?: string; question: string;
    context?: Record<string, unknown>;
    attachments?: Array<{ file_url: string; file_name: string; mime_type: string }>;
  }) =>
    request<{ question: SupportQuestion }>('POST', '/support/questions', data),
  /** 上传求助截图。只收图片，8MB 上限。 */
  uploadImage: (data: { course_id: string; file_name: string; mime_type: string; data_url: string }) =>
    request<{ attachment: { file_url: string; file_name: string; mime_type: string } }>(
      'POST', '/support/attachments', data,
    ),
  mine: (courseId: string) =>
    request<{ questions: SupportQuestion[] }>('GET', `/support/questions/mine?course_id=${encodeURIComponent(courseId)}`),
  /** 学生表态：AI 解决了，或转给教师。 */
  respond: (id: string, data: { resolved?: boolean; escalate?: boolean; note?: string }) =>
    request<{ question: SupportQuestion }>('PATCH', `/support/questions/${id}`, data),
  /** 教师端：列出本课程的求助。status='open' 只看等回复的。 */
  list: (courseId: string, status?: string) =>
    request<{ questions: SupportQuestion[]; counts: { total: number; waiting: number; answered: number; solvedByAi: number } }>(
      'GET', `/support/questions?course_id=${encodeURIComponent(courseId)}${status ? `&status=${status}` : ''}`),
  answer: (id: string, answer: string) =>
    request<{ question: SupportQuestion }>('POST', `/support/questions/${id}/answer`, { answer }),
  /** 教师、管理员：我当教职的课里等回复的学生求助；管理员另有教师转来的。小球上的数也从这里来 */
  inbox: () =>
    request<{ student: SupportInboxItem[]; teacher: SupportInboxItem[]; counts: { student: number; teacher: number } }>(
      'GET', '/support/inbox'),
};

// ── 讨论分析（知识空间顶栏「分析」，2026-10-09）：只给这门课的教职 ──────────────

export interface AnalyticsCount { label: string; count: number }

export interface SpaceAnalyticsOverview {
  summary: {
    students: number;
    activeStudents: number;
    quietStudents: number;
    notes: number;
    teacherNotes: number;
    riseAbove: number;
    buildOns: number;
    unanswered: number;
    chars: number;
    feedback: { total: number; adopted: number; rejected: number; ignored: number; pending: number };
    aiUse: number;
    firstAt: string | null;
    lastAt: string | null;
  };
  timeline: Array<{ day: string; notes: number; buildOns: number; active: number }>;
  participation: Array<{
    userId: string;
    name: string;
    avatar: string | null;
    notes: number;
    buildOnsGiven: number;
    buildOnsReceived: number;
    chars: number;
    scaffolds: number;
    lastAt: string | null;
    quiet: boolean;
    aiFeedback: { received: number; adopted: number };
    aiUse: number;
  }>;
  network: { nodes: Array<{ id: string; name: string; notes: number; buildOns: number }>; links: Array<{ from: string; to: string; count: number }> };
  unanswered: Array<{ id: string; title: string; authorId: string | null; authorName: string; createdAt: string }>;
  scaffoldGroups: AnalyticsCount[];
  relationTypes: AnalyticsCount[];
}

export interface SpaceStudentDetail {
  member: { id: string; name: string; avatar: string | null; isStaff: boolean };
  summary: {
    notes: number;
    buildOnsGiven: number;
    buildOnsReceived: number;
    chars: number;
    scaffolds: number;
    aiUse: number;
    firstAt: string | null;
    lastAt: string | null;
    quiet: boolean;
  };
  timeline: Array<{ day: string; notes: number; buildOns: number }>;
  notes: Array<{ id: string; title: string; createdAt: string; type: string | null; received: number; scaffolds: number; chars: number }>;
  builtOn: Array<{ userId: string; name: string; count: number }>;
  builtOnBy: Array<{ userId: string; name: string; count: number }>;
  relationTypes: { given: AnalyticsCount[]; received: AnalyticsCount[] };
  scaffoldGroups: AnalyticsCount[];
  scaffoldTitles: AnalyticsCount[];
  feedback: { total: number; adopted: number; rejected: number; ignored: number; pending: number; byType: AnalyticsCount[] };
  unanswered: number;
}

export interface SpaceWordCloud {
  available: boolean;
  terms: Array<{ word: string; weight: number; count: number; notes: number; note_ids: string[] }>;
  cloud: { items: Array<{ word: string; weight: number; size: number; x: number; y: number; w: number; h: number; ascent: number }>; width: number; height: number } | null;
  docs: number;
  error?: string;
}

const analyticsQuery = (params: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') q.set(key, String(value));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export interface DiscussionOptions { viewId?: string | null; authorId?: string | null; from?: string | null; until?: string | null }
export interface SpaceDiscussion {
  members: Array<{id: string; name: string}>;
  notes: Array<{id: string; title: string; authorId: string; createdAt: string; type: string | null; excerpt: string; selected: boolean}>;
  edges: Array<{from: string; to: string; type: string; createdAt: string}>;
  pending: Array<{noteId: string; reason: 'unanswered' | 'question'}>;
}
export interface SpaceKeywordChanges {
  available: boolean;
  splitAt: string;
  periods: {before: {docs: number; tokens: number}; after: {docs: number; tokens: number}};
  terms: Array<{word: string; before: {count: number; notes: number; note_ids: string[]}; after: {count: number; notes: number; note_ids: string[]}; delta: number}>;
}
export interface AnalyticsTopic {id:string;title:string;terms:string[]}
export interface TopicConfig {topics:AnalyticsTopic[];revision:string|null}
export interface SpaceTopicCoverage {
  available:boolean;config:TopicConfig;docs:number;students:number;
  topics:Array<AnalyticsTopic&{notes:number;students:number;note_ids:string[];peer_note_ids:string[]}>;
}
export interface SpacePeerConnections {
  available:boolean;members:Array<{id:string;name:string;notes:number;peers:number}>;
  connections:Array<{a:string;b:string;aToB:number;bToA:number;noteIds:string[]}>;
  candidates:Array<{a:string;b:string;words:string[];noteIds:string[]}>;candidateCount:number;
}
const discussionQuery = (opts: DiscussionOptions) => ({view_id:opts.viewId,author_id:opts.authorId,from:opts.from,until:opts.until});

export const spaceAnalytics = {
  peers:(spaceId:string,opts:DiscussionOptions&{extraWords?:string;extraStop?:string}={})=>request<SpacePeerConnections>('GET',`/spaces/${spaceId}/analytics/peers${analyticsQuery({...discussionQuery(opts),extra_words:opts.extraWords,extra_stop:opts.extraStop})}`),
  topics:(spaceId:string,opts:DiscussionOptions={})=>request<SpaceTopicCoverage>('GET',`/spaces/${spaceId}/analytics/topics${analyticsQuery(discussionQuery(opts))}`),
  saveTopics:(spaceId:string,topics:AnalyticsTopic[],expectedRevision:string|null)=>request<TopicConfig>('PUT',`/spaces/${spaceId}/analytics/topics`,{topics,expectedRevision}),
  discussion: (spaceId: string, opts: DiscussionOptions = {}) => request<SpaceDiscussion>('GET', `/spaces/${spaceId}/analytics/discussion${analyticsQuery(discussionQuery(opts))}`),
  changes: (spaceId: string, opts: DiscussionOptions & {splitAt?: string | null; extraWords?: string; extraStop?: string} = {}) => request<SpaceKeywordChanges>('GET', `/spaces/${spaceId}/analytics/changes${analyticsQuery({...discussionQuery(opts),split_at:opts.splitAt,extra_words:opts.extraWords,extra_stop:opts.extraStop})}`),
  overview: (spaceId: string, viewId?: string | null, period: Pick<DiscussionOptions, 'from' | 'until'> = {}) =>
    request<{ overview: SpaceAnalyticsOverview; signature: string; generatedAt: string }>('GET', `/spaces/${spaceId}/analytics${analyticsQuery({ view_id: viewId, from: period.from, until: period.until })}`),
  student: (spaceId: string, userId: string, viewId?: string | null) =>
    request<{ student: SpaceStudentDetail }>('GET', `/spaces/${spaceId}/analytics/students/${userId}${analyticsQuery({ view_id: viewId })}`),
  /** 词云：服务端用 Python（jieba + wordcloud）对学生写的笔记做，不经 AI */
  wordCloud: (spaceId: string, opts: DiscussionOptions & { width?: number; height?: number; extraWords?: string; extraStop?: string } = {}) =>
    request<SpaceWordCloud>('GET', `/spaces/${spaceId}/analytics/wordcloud${analyticsQuery({ ...discussionQuery(opts), width: opts.width, height: opts.height, extra_words: opts.extraWords, extra_stop: opts.extraStop })}`),
};
