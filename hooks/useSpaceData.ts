import React, { useState, useEffect, useCallback, useRef } from 'react';
import { notes as notesApi, relations as relationsApi, ApiNote, ApiRelation } from '../services/apiClient';
import { supabase } from '../services/supabaseClient';
import { Note, Edge } from '../types';
import type { RealtimeChannel } from '@supabase/supabase-js';

const PLACEHOLDER_NAMES = new Set(['unknown', 'unnamed', 'anonymous', 'null', 'undefined', 'adrian', '未知', '未知用户']);

function cleanAuthorName(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name || PLACEHOLDER_NAMES.has(name.toLowerCase())) return undefined;
  return name;
}

/**
 * Maps a raw API note (snake_case) to the frontend Note type (camelCase).
 * The `authorName` parameter is used as a fallback when the joined `users`
 * field is absent (e.g. immediately after create, before a full re-fetch).
 */
export function apiNoteToNote(apiNote: ApiNote, authorName?: string): Note {
  const raw = apiNote as ApiNote & {
    drawing_data?: unknown;
    file_url?: string;
    file_name?: string;
    mime_type?: string;
    cited_note_ids?: string[];
    rise_above_data?: Note['riseAboveData'];
    is_ai_generated?: boolean;
    author_profile?: { full_name?: string; avatar_url?: string };
    metadata?: { display_mode?: 'media' | 'card'; is_fixed?: boolean } & Record<string, unknown>;
    unread_feedback?: boolean;
  };
  // AI-generated notes always display as the AI partner while provenance remains in audit data.
  const resolvedAuthor = raw.is_ai_generated
    ? 'AI Partner'
    : (cleanAuthorName(raw.users?.name) ?? cleanAuthorName(authorName) ?? 'Author');
  // An AI note must not wear the triggering student's face.
  const resolvedAvatar = raw.is_ai_generated
    ? undefined
    : (raw.users?.avatar ?? raw.author_profile?.avatar_url);
  return {
    id: raw.id,
    type: raw.type as Note['type'],
    title: raw.title,
    author: resolvedAuthor,
    authorId: raw.author_id,
    authorAvatar: resolvedAvatar,
    isAiGenerated: Boolean(raw.is_ai_generated),
    date: new Date(raw.created_at).toLocaleString(),
    createdAt: raw.created_at,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    content: raw.content,
    epistemicStatus: raw.epistemic_status as Note['epistemicStatus'],
    inquiryQuestion: raw.inquiry_question,
    promisingReason: raw.promising_reason,
    knowledgeLacks: raw.knowledge_lacks?.map((lack) => ({
      id: lack.id,
      type: lack.type,
      text: lack.text,
      createdAt: lack.createdAt,
      resolvedAt: lack.resolvedAt,
    })),
    metrics: raw.note_metrics_realtime ? {
      directInDegree: raw.note_metrics_realtime.direct_in_degree ?? 0,
      directOutDegree: raw.note_metrics_realtime.direct_out_degree ?? 0,
      buildOnCount: raw.note_metrics_realtime.build_on_count ?? 0,
      uniqueContributorCount: raw.note_metrics_realtime.unique_contributor_count ?? 0,
      challengeCount: raw.note_metrics_realtime.challenge_count ?? 0,
      evidenceCount: raw.note_metrics_realtime.evidence_count ?? 0,
      synthesisCount: raw.note_metrics_realtime.synthesis_count ?? 0,
      revisionCount: raw.note_metrics_realtime.revision_count ?? 0,
      heatScore: raw.note_metrics_realtime.heat_score ?? 0,
    } : undefined,
    tags: raw.tags,
    views: raw.views,
    drawingData: raw.drawing_data as Note['drawingData'],
    fileUrl: raw.file_url,
    fileName: raw.file_name,
    mimeType: raw.mime_type,
    metadata: raw.metadata,
    // Images and videos render inline on the canvas rather than as a file
    // card — an attachment you have to open twice isn't really "on" the board.
    // An explicit per-note choice (right-click) always wins.
    // Only real media can ever preview inline — a PDF flagged 'media' by an
    // older client build would otherwise render as a broken <img>.
    isPreviewMode: (raw.mime_type?.startsWith('image/') || raw.mime_type?.startsWith('video/'))
      ? (raw.metadata?.display_mode ? raw.metadata.display_mode === 'media' : !!raw.file_url)
      : false,
    isFixed: raw.metadata?.is_fixed === true,
    citedNoteIds: raw.cited_note_ids,
    riseAboveData: raw.rise_above_data,
    feedbacks: raw.feedbacks,
    // 笔记列表接口给的是 unread_feedback（只对作者本人的笔记算）；只读驼峰那个，画布上的未读角标永远亮不起来
    unreadFeedback: raw.unread_feedback ?? raw.unreadFeedback ?? raw.feedbacks?.some((feedback) => feedback.isRead === false),
    seenByMe: raw.seen_by_me,
  };
}

/** Maps a backend relation to a canvas Edge. */
export function apiRelationToEdge(rel: ApiRelation): Edge {
  return {
    id: rel.id,
    source: rel.source_note_id,
    target: rel.target_note_id,
    relationType: (rel.relation_type as Edge['relationType']) ?? 'extend',
    aiSuggested: rel.ai_suggested ?? false,
    aiAccepted: rel.ai_accepted ?? false,
  };
}

interface SpaceData {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** 拖动保存期间保护本地坐标，别被后台重拉覆盖。 */
  markGeometryPending: (noteId: string, geom: NoteGeometry) => void;
  clearGeometryPending: (noteId: string) => void;
}

export interface NoteGeometry {
  x: number;
  y: number;
  width?: number;
  height?: number;
}
export type PendingGeometry = NoteGeometry & { at: number };

/** 本地坐标的保护期。超过就认输，以服务器为准。 */
export const PENDING_GEOMETRY_TTL = 12_000;

/**
 * 若这条笔记刚被本地拖动过而服务器还没回显，就保留本地坐标。
 * 服务器一旦回显了相同坐标（或超时），解除保护。
 */
export function applyPendingGeometry(
  note: Note,
  pending: Map<string, PendingGeometry>,
  now: number,
): Note {
  const p = pending.get(note.id);
  if (!p) return note;

  if (now - p.at > PENDING_GEOMETRY_TTL) {
    pending.delete(note.id);
    return note;
  }

  // 坐标用近似比较：数据库是 double precision，往返一趟末位可能有偏差。
  const settled =
    Math.abs(note.x - p.x) < 0.5 &&
    Math.abs(note.y - p.y) < 0.5 &&
    (p.width === undefined || note.width === p.width) &&
    (p.height === undefined || note.height === p.height);
  if (settled) {
    pending.delete(note.id);
    return note;
  }

  return {
    ...note,
    x: p.x,
    y: p.y,
    ...(p.width !== undefined ? { width: p.width } : null),
    ...(p.height !== undefined ? { height: p.height } : null),
  };
}

/** Read beyond the default 200-note page; never silently organize only half a canvas. */
export async function loadCanvasNotes(spaceId: string) {
  const byId = new Map<string, ApiNote>();
  for (let offset = 0; ; offset += 500) {
    const page = await notesApi.list(spaceId, { limit: 500, offset });
    for (const note of page.notes) byId.set(note.id, note);
    if (page.notes.length < 500) return { notes: [...byId.values()] };
  }
}

/** Loads the space's Notes and relations, preserving local pending geometry. */
export function useSpaceData(spaceId: string | null): SpaceData {
  const [notes, setNotes] = useState<Note[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadedOnceRef = useRef(false);

  /**
   * 刚拖动过、服务器还没回显新坐标的笔记。
   *
   * 保存是「发了就不管」，而 Realtime 每次写入都会触发一次全量重拉。
   * 只要那次 GET 在写入提交之前就读了库，回来的就是旧坐标，
   * mergeNotes 一合并，卡片当场被拽回原位 —— 用户看到的就是
   * 「拖到 B，过一会自己跳回 A」。
   *
   * 所以在服务器确认之前，本地坐标优先。超过 TTL 仍未回显就放弃保护，
   * 免得一次失败的保存让本地和服务器永远不一致。
   */
  const pendingGeometryRef = useRef(new Map<string, PendingGeometry>());

  const markGeometryPending = useCallback((noteId: string, geom: NoteGeometry) => {
    pendingGeometryRef.current.set(noteId, { ...geom, at: Date.now() });
  }, []);

  const clearGeometryPending = useCallback((noteId: string) => {
    pendingGeometryRef.current.delete(noteId);
  }, []);

  /**
   * 合并而不是整体替换。
   *
   * 以前每次重拉都 setNotes(全新数组)，于是所有 Note 的对象标识都变了，
   * React 把整块画布重渲一遍——在 75 条笔记的空间里肉眼可见地「刷新」。
   * 内容没变的就沿用原来的对象，React 自然跳过。
   *
   * 同时保住本地乐观创建、服务器还没有的笔记（temp- 开头），
   * 否则学生刚拖出来的新笔记会被一次后台重拉抹掉、过几秒又冒出来。
   */
  const mergeNotes = useCallback((incoming: Note[]) => {
    setNotes(prev => {
      const prevById = new Map(prev.map(n => [n.id, n]));
      const incomingIds = new Set(incoming.map(n => n.id));
      const now = Date.now();
      const merged = incoming.map(raw => {
        const next = applyPendingGeometry(raw, pendingGeometryRef.current, now);
        const existing = prevById.get(next.id);
        return existing && JSON.stringify(existing) === JSON.stringify(next) ? existing : next;
      });
      const pendingLocal = prev.filter(n => n.id.startsWith('temp-') && !incomingIds.has(n.id));
      return [...merged, ...pendingLocal];
    });
  }, []);

  /**
   * silent=true 时不亮加载态。后台刷新（Realtime 推送、保存后轮询）必须是静默的：
   * 那个加载蒙层是全屏白底加转圈，一个班里同学每存一次笔记，
   * 所有人的画布都会被盖住闪一下。
   */
  const fetch = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!spaceId) return;
    const silent = options.silent ?? loadedOnceRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [notesRes, relsRes] = await Promise.all([
        loadCanvasNotes(spaceId),
        relationsApi.listForSpace(spaceId),
      ]);
      mergeNotes(notesRes.notes.map(n => apiNoteToNote(n)));
      const nextEdges = relsRes.relations.map(apiRelationToEdge);
      setEdges(prev => (JSON.stringify(prev) === JSON.stringify(nextEdges) ? prev : nextEdges));
      loadedOnceRef.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load space data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [spaceId, mergeNotes]);

  useEffect(() => {
    loadedOnceRef.current = false;
    void fetch({ silent: false });
  }, [fetch]);

  // ── Supabase Realtime: auto-refresh on INSERT/UPDATE/DELETE ──
  const channelRef = useRef<RealtimeChannel | null>(null);
  const realtimeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!spaceId) return;

    // 一批变更（比如一次 Build-on 同时改了 notes 和 relations）会连着推好几条，
    // 每条都重拉一次纯属浪费。合并成一次。
    const scheduleRefresh = () => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current);
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = null;
        void fetch({ silent: true });
      }, 800);
    };

    const channel = supabase
      .channel(`space-${spaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: `space_id=eq.${spaceId}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'relations', filter: `space_id=eq.${spaceId}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'note_feedbacks', filter: `space_id=eq.${spaceId}` },
        scheduleRefresh,
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (realtimeTimerRef.current !== null) window.clearTimeout(realtimeTimerRef.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [spaceId, fetch]);

  return {
    notes, setNotes, edges, setEdges, loading, error, refetch: fetch,
    markGeometryPending, clearGeometryPending,
  };
}
