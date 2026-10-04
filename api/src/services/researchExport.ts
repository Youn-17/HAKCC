/**
 * Research data export engine.
 *
 * Design goals, in order:
 *  1. Readable — a researcher opens one CSV and understands it without a manual.
 *     Tables are denormalized: a note row already names its author, group, the
 *     note it builds on, and the notes that build on it.
 *  2. Joinable — every row carries participant_id / group / condition.
 *  3. Honest about interaction — building on a peer's note IS peer interaction,
 *     so `interactions` unifies build-ons, replies, messages and AI exchanges.
 *
 * Identities use readable course codes (STPKB01) from participantCode.ts.
 * Real names appear only where explicitly requested.
 */

import { supabase } from '../config/supabase';
import { resolveParticipantCodes, type ParticipantIdentity } from './participantCode';
import { toCsv } from './zipWriter';

export const DATASET_KEYS = [
  'notes',
  'interactions',
  'participants',
  'messages',
  'ai_feedbacks',
  'ai_interventions',
  'events',
  'note_revisions',
  'support_questions',
  'sessions',
] as const;

export type DatasetKey = typeof DATASET_KEYS[number];

export type ColumnGroup =
  | 'identity' | 'location' | 'content' | 'structure'
  | 'ai' | 'scaffold' | 'layer' | 'time' | 'meta';

export interface ColumnDef {
  key: string;
  zh: string;
  en: string;
  group: ColumnGroup;
  /** Only emitted when the caller asks for real names. */
  sensitive?: boolean;
}

export interface ExportFilters {
  spaceIds?: string[];
  groupIds?: string[];
  viewId?: string;
  from?: string;
  to?: string;
  includeAiGenerated?: boolean;
  includeSuppressed?: boolean;
  includeDeleted?: boolean;
  includeNames?: boolean;
  /** Hours east of UTC for the *_local time columns. Defaults to +8. */
  tzOffsetHours?: number;
}

const ROW_LIMIT = 20000;
const EXCERPT_LEN = 200;

// ── Text helpers ───────────────────────────────────────────────────────────

function stripHtml(value: unknown): string {
  return String(value ?? '')
    // script/style 的内容不是正文，整段丢掉
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    // &amp; 必须最后解，否则 "&amp;lt;" 会被两步解成 "<"
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  const cjk = (text.match(/[一-龥]/g) ?? []).length;
  const latin = (text.replace(/[一-龥]/g, ' ').match(/\b[\w']+\b/g) ?? []).length;
  return cjk + latin;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Local wall-clock fields — UTC timestamps make classroom timing unreadable. */
function localTime(iso: string | null | undefined, tzOffsetHours: number, courseStartMs: number | null) {
  if (!iso) return { local: '', date: '', weekday: '', hour: '', week: '' };
  const shifted = new Date(new Date(iso).getTime() + tzOffsetHours * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  const week = courseStartMs
    ? String(Math.max(1, Math.floor((new Date(iso).getTime() - courseStartMs) / (7 * 86400_000)) + 1))
    : '';
  return {
    local: `${date} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    date,
    weekday: WEEKDAYS[shifted.getUTCDay()],
    hour: String(shifted.getUTCHours()),
    week,
  };
}

// ── Scope ──────────────────────────────────────────────────────────────────

export interface ExportScope {
  courseId: string;
  filters: ExportFilters;
  tz: number;
  englishName: string | null;
  abbr: string | null;
  identities: Map<string, ParticipantIdentity>;
  spaceIds: string[];
  spaceById: Map<string, { id: string; title: string; group_id: string | null }>;
  groupById: Map<string, { id: string; name: string; condition: string | null }>;
  groupOfUser: Map<string, string>;
  overrideOfUser: Map<string, string | null>;
  participantScope: Set<string> | null;
  courseStartMs: number | null;
}

export async function resolveExportScope(courseId: string, filters: ExportFilters): Promise<ExportScope> {
  const [codes, spacesRes, groupsRes, groupMembersRes, membersRes] = await Promise.all([
    resolveParticipantCodes(courseId),
    supabase.from('spaces').select('id, title, group_id').eq('course_id', courseId),
    supabase.from('groups').select('id, name, ai_feedback_condition').eq('course_id', courseId),
    supabase.from('group_members').select('group_id, user_id, joined_at').order('joined_at', { ascending: true }),
    supabase.from('course_members').select('user_id, ai_feedback_condition').eq('course_id', courseId),
  ]);

  const allSpaces = spacesRes.data ?? [];

  // Week 1 anchors on the course's first note. notes.course_id is unreliable
  // (null on older rows), so resolve through the space instead.
  const allSpaceIds = allSpaces.map((s) => s.id as string);
  const firstNoteRes = allSpaceIds.length > 0
    ? await supabase.from('notes').select('created_at').in('space_id', allSpaceIds).order('created_at', { ascending: true }).limit(1)
    : { data: [] as { created_at: string }[] };
  const groupById = new Map(
    (groupsRes.data ?? []).map((g) => [
      g.id as string,
      { id: g.id as string, name: g.name as string, condition: (g.ai_feedback_condition as string | null) ?? null },
    ]),
  );

  const groupOfUser = new Map<string, string>();
  for (const row of groupMembersRes.data ?? []) {
    const gid = row.group_id as string;
    const uid = row.user_id as string;
    if (groupById.has(gid) && !groupOfUser.has(uid)) groupOfUser.set(uid, gid);
  }

  const overrideOfUser = new Map<string, string | null>(
    (membersRes.data ?? []).map((m) => [m.user_id as string, (m.ai_feedback_condition as string | null) ?? null]),
  );

  const selectedGroups = (filters.groupIds ?? []).filter((g) => groupById.has(g));

  let spaceIds = allSpaces.map((s) => s.id as string);
  if (filters.spaceIds?.length) {
    const wanted = new Set(filters.spaceIds);
    spaceIds = spaceIds.filter((id) => wanted.has(id));
  }
  if (selectedGroups.length > 0) {
    const groupSet = new Set(selectedGroups);
    spaceIds = spaceIds.filter((id) => {
      const bound = allSpaces.find((s) => s.id === id)?.group_id as string | null;
      return !bound || groupSet.has(bound);
    });
  }

  let participantScope: Set<string> | null = null;
  if (selectedGroups.length > 0) {
    const groupSet = new Set(selectedGroups);
    participantScope = new Set(
      Array.from(groupOfUser.entries()).filter(([, gid]) => groupSet.has(gid)).map(([uid]) => uid),
    );
  }

  const firstNote = firstNoteRes.data?.[0]?.created_at as string | undefined;

  return {
    courseId,
    filters,
    tz: filters.tzOffsetHours ?? 8,
    englishName: codes.englishName,
    abbr: codes.abbr,
    identities: codes.identities,
    spaceIds,
    spaceById: new Map(
      allSpaces.map((s) => [
        s.id as string,
        { id: s.id as string, title: s.title as string, group_id: (s.group_id as string | null) ?? null },
      ]),
    ),
    groupById,
    groupOfUser,
    overrideOfUser,
    participantScope,
    courseStartMs: firstNote ? new Date(firstNote).getTime() : null,
  };
}

// Identity lookups -----------------------------------------------------------

const AI_CODE = 'AI';

function codeOf(scope: ExportScope, userId: string | null | undefined): string {
  if (!userId) return '';
  return scope.identities.get(userId)?.code ?? '';
}

function nameOf(scope: ExportScope, userId: string | null | undefined): string {
  if (!userId) return '';
  return scope.identities.get(userId)?.name ?? '';
}

function groupNameOf(scope: ExportScope, userId: string | null | undefined, spaceId?: string | null): string {
  const gid = (userId && scope.groupOfUser.get(userId)) || (spaceId ? scope.spaceById.get(spaceId)?.group_id : null);
  return gid ? scope.groupById.get(gid)?.name ?? '' : '';
}

function groupIdOf(scope: ExportScope, userId: string | null | undefined, spaceId?: string | null): string {
  return (userId && scope.groupOfUser.get(userId)) || (spaceId ? scope.spaceById.get(spaceId)?.group_id ?? '' : '') || '';
}

function conditionOf(scope: ExportScope, userId: string | null | undefined): string {
  if (!userId) return '';
  const override = scope.overrideOfUser.get(userId);
  if (override === 'treatment' || override === 'control') return override === 'treatment' ? '实验组' : '对照组';
  const gid = scope.groupOfUser.get(userId);
  const cond = gid ? scope.groupById.get(gid)?.condition : null;
  return cond === 'treatment' ? '实验组' : cond === 'control' ? '对照组' : '';
}

function inScope(scope: ExportScope, userId: string | null | undefined): boolean {
  if (!scope.participantScope) return true;
  return !!userId && scope.participantScope.has(userId);
}

type Party = '学生' | '教师' | 'AI' | '';

function partyOf(scope: ExportScope, code: string, userId: string | null | undefined): Party {
  if (code === AI_CODE) return 'AI';
  if (!code) return '';
  if (userId) return scope.identities.get(userId)?.isTeacher ? '教师' : '学生';
  return code.startsWith('T') ? '教师' : '学生';
}

/** "学生→学生" etc. — more informative than a bare peer/non-peer flag. */
function dyadOf(from: Party, to: Party): string {
  return from && to ? `${from}→${to}` : '';
}

// ── Shared note graph ──────────────────────────────────────────────────────

interface NoteRow {
  id: string; space_id: string; author_id: string; type: string;
  title: string; content: string; views: string[] | null; tags: string[] | null;
  epistemic_status: string | null; is_ai_generated: boolean; ai_trigger_type: string | null;
  inquiry_question: string | null; promising_reason: string | null;
  scaffold_id: string | null; scaffold_responses: unknown;
  ai_adoption_scaffold_id: string | null;
  content_segments: NoteSegmentRow[] | null;
  segment_stats: Record<string, unknown> | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}

/** notes.content_segments 里的一段，见 services/noteSegments.ts */
interface NoteSegmentRow {
  order: number; kind: string; chars: number; text: string;
  scaffoldId?: string; scaffoldTitle?: string; scaffoldL1?: string;
  authoredChars?: number; providerId?: string; model?: string;
}

interface RelationRow {
  id: string; space_id: string; source_note_id: string; target_note_id: string;
  relation_type: string; creator_id: string; ai_suggested: boolean; created_at: string;
}

interface NoteGraph {
  /** True when the relation query hit the row cap — the build-on graph is clipped. */
  relationsTruncated: boolean;
  notes: NoteRow[];
  noteById: Map<string, NoteRow>;
  relations: RelationRow[];
  /** note → notes it builds upon */
  parentsOf: Map<string, RelationRow[]>;
  /** note → notes building upon it */
  childrenOf: Map<string, RelationRow[]>;
  scaffoldTitleById: Map<string, string>;
  feedbacksByNote: Map<string, { trigger_type: string; status: string }[]>;
}

async function loadNoteGraph(scope: ExportScope): Promise<NoteGraph> {
  const { from, to, viewId, includeAiGenerated = true, includeDeleted = true } = scope.filters;

  let query = supabase
    .from('notes')
    .select('id, space_id, author_id, type, title, content, views, tags, epistemic_status, is_ai_generated, ai_trigger_type, inquiry_question, promising_reason, scaffold_id, scaffold_responses, ai_adoption_scaffold_id, content_segments, segment_stats, created_at, updated_at, deleted_at')
    .in('space_id', scope.spaceIds)
    .order('created_at', { ascending: true })
    .limit(ROW_LIMIT + 1);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (viewId) query = query.contains('views', [viewId]);
  if (!includeAiGenerated) query = query.eq('is_ai_generated', false);
  if (!includeDeleted) query = query.is('deleted_at', null);

  const [notesRes, relationsRes, scaffoldsRes, feedbackRes] = await Promise.all([
    query,
    supabase
      .from('relations')
      .select('id, space_id, source_note_id, target_note_id, relation_type, creator_id, ai_suggested, created_at')
      .in('space_id', scope.spaceIds)
      .order('created_at', { ascending: true })
      .limit(ROW_LIMIT + 1),
    supabase.from('scaffolds').select('id, title').eq('course_id', scope.courseId),
    supabase.from('note_ai_feedbacks').select('note_id, trigger_type, status').eq('course_id', scope.courseId),
  ]);

  const notes = ((notesRes.data ?? []) as unknown as NoteRow[]).filter((n) => inScope(scope, n.author_id));
  const noteById = new Map(notes.map((n) => [n.id, n]));

  // Keep only edges whose both endpoints survived the filters, so no row ever
  // points at a note that isn't in the export.
  const relations = ((relationsRes.data ?? []) as unknown as RelationRow[]).filter(
    (r) => noteById.has(r.source_note_id) && noteById.has(r.target_note_id),
  );

  const parentsOf = new Map<string, RelationRow[]>();
  const childrenOf = new Map<string, RelationRow[]>();
  for (const rel of relations) {
    if (!parentsOf.has(rel.source_note_id)) parentsOf.set(rel.source_note_id, []);
    parentsOf.get(rel.source_note_id)!.push(rel);
    if (!childrenOf.has(rel.target_note_id)) childrenOf.set(rel.target_note_id, []);
    childrenOf.get(rel.target_note_id)!.push(rel);
  }

  const feedbacksByNote = new Map<string, { trigger_type: string; status: string }[]>();
  for (const fb of feedbackRes.data ?? []) {
    const nid = fb.note_id as string;
    if (!nid) continue;
    if (!feedbacksByNote.has(nid)) feedbacksByNote.set(nid, []);
    feedbacksByNote.get(nid)!.push({ trigger_type: fb.trigger_type as string, status: fb.status as string });
  }

  return {
    relationsTruncated: (relationsRes.data ?? []).length > ROW_LIMIT,
    notes,
    noteById,
    relations,
    parentsOf,
    childrenOf,
    scaffoldTitleById: new Map((scaffoldsRes.data ?? []).map((s) => [s.id as string, s.title as string])),
    feedbacksByNote,
  };
}

/** Walk up the build-on chain to the thread root; guards against cycles. */
function threadRootOf(graph: NoteGraph, noteId: string): { rootId: string; depth: number } {
  let current = noteId;
  let depth = 0;
  const seen = new Set<string>([noteId]);
  while (depth < 50) {
    const parents = graph.parentsOf.get(current);
    if (!parents || parents.length === 0) break;
    const next = parents[0].target_note_id;
    if (seen.has(next)) break;
    seen.add(next);
    current = next;
    depth++;
  }
  return { rootId: current, depth };
}

// ── Column definitions ─────────────────────────────────────────────────────

export const DATASET_COLUMNS: Record<DatasetKey, ColumnDef[]> = {
  notes: [
    { key: 'seq', zh: '序号', en: 'seq', group: 'identity' },
    { key: 'participant_id', zh: '参与者编号', en: 'participant_id', group: 'identity' },
    { key: 'participant_name', zh: '姓名', en: 'participant_name', group: 'identity', sensitive: true },
    { key: 'group_name', zh: '所属小组', en: 'group_name', group: 'identity' },
    { key: 'condition', zh: '实验条件', en: 'condition', group: 'identity' },
    { key: 'space_title', zh: '知识空间', en: 'space', group: 'location' },
    { key: 'view_ids', zh: 'View', en: 'view_ids', group: 'location' },
    { key: 'title', zh: '笔记标题', en: 'title', group: 'content' },
    { key: 'content_text', zh: '笔记内容', en: 'content', group: 'content' },
    { key: 'word_count', zh: '字数', en: 'word_count', group: 'content' },
    { key: 'note_type', zh: '笔记类型', en: 'note_type', group: 'content' },
    { key: 'epistemic_status', zh: '认识论状态', en: 'epistemic_status', group: 'content' },
    { key: 'inquiry_question', zh: '探究问题', en: 'inquiry_question', group: 'content' },
    { key: 'tags', zh: '标签', en: 'tags', group: 'content' },
    { key: 'builds_on_count', zh: '建立在几条笔记上', en: 'builds_on_count', group: 'structure' },
    { key: 'builds_on_authors', zh: '建立在谁的笔记上', en: 'builds_on_authors', group: 'structure' },
    { key: 'builds_on_titles', zh: '建立在哪条笔记上', en: 'builds_on_titles', group: 'structure' },
    { key: 'builds_on_types', zh: '建立方式', en: 'builds_on_types', group: 'structure' },
    { key: 'built_on_by_count', zh: '被几条笔记建立', en: 'built_on_by_count', group: 'structure' },
    { key: 'built_on_by_authors', zh: '被谁建立', en: 'built_on_by_authors', group: 'structure' },
    { key: 'built_on_by_titles', zh: '被哪条笔记建立', en: 'built_on_by_titles', group: 'structure' },
    { key: 'thread_depth', zh: '所处层级', en: 'thread_depth', group: 'structure' },
    { key: 'thread_root_title', zh: '讨论串源头', en: 'thread_root_title', group: 'structure' },
    { key: 'is_ai_generated', zh: '是否AI生成', en: 'is_ai_generated', group: 'ai' },
    { key: 'ai_trigger_type', zh: 'AI触发类型', en: 'ai_trigger_type', group: 'ai' },
    { key: 'ai_feedback_count', zh: '收到AI反馈数', en: 'ai_feedback_count', group: 'ai' },
    { key: 'ai_feedback_types', zh: 'AI反馈类型', en: 'ai_feedback_types', group: 'ai' },
    { key: 'scaffold_title', zh: '使用的脚手架', en: 'scaffold_title', group: 'scaffold' },
    { key: 'scaffold_responses', zh: '脚手架作答', en: 'scaffold_responses', group: 'scaffold' },
    { key: 'seg_scaffold_count', zh: '用了几处支架', en: 'scaffold_segments', group: 'layer' },
    { key: 'seg_scaffold_titles', zh: '用了哪些支架', en: 'scaffold_titles', group: 'layer' },
    { key: 'seg_scaffold_l1', zh: '支架一级分类', en: 'scaffold_categories', group: 'layer' },
    { key: 'seg_total_chars', zh: '正文总字数', en: 'total_chars', group: 'layer' },
    { key: 'seg_student_chars', zh: '学生自写字数', en: 'student_chars', group: 'layer' },
    { key: 'seg_scaffold_chars', zh: '支架内字数', en: 'scaffold_chars', group: 'layer' },
    { key: 'seg_plain_chars', zh: '无支架字数', en: 'plain_chars', group: 'layer' },
    { key: 'seg_ai_chars', zh: 'AI 内容字数', en: 'ai_chars', group: 'layer' },
    { key: 'seg_ai_ratio', zh: 'AI 内容占比', en: 'ai_ratio', group: 'layer' },
    { key: 'seg_ai_blocks', zh: 'AI 内容段数', en: 'ai_blocks', group: 'layer' },
    { key: 'seg_ai_providers', zh: 'AI 来源模型', en: 'ai_providers', group: 'layer' },
    { key: 'ai_adoption_scaffold', zh: 'AI 采纳所挂支架', en: 'ai_adoption_scaffold', group: 'layer' },
    { key: 'created_at_local', zh: '发表时间', en: 'created_at', group: 'time' },
    { key: 'week_index', zh: '第几周', en: 'week', group: 'time' },
    { key: 'weekday', zh: '星期', en: 'weekday', group: 'time' },
    { key: 'hour', zh: '小时', en: 'hour', group: 'time' },
    { key: 'updated_at_local', zh: '最后修改', en: 'updated_at', group: 'time' },
    { key: 'is_deleted', zh: '已删除', en: 'is_deleted', group: 'meta' },
    { key: 'note_id', zh: '笔记ID', en: 'note_id', group: 'meta' },
    { key: 'space_id', zh: '空间ID', en: 'space_id', group: 'meta' },
    { key: 'group_id', zh: '小组ID', en: 'group_id', group: 'meta' },
  ],
  interactions: [
    { key: 'seq', zh: '序号', en: 'seq', group: 'identity' },
    { key: 'from_participant_id', zh: '发起人编号', en: 'from_participant_id', group: 'identity' },
    { key: 'from_name', zh: '发起人姓名', en: 'from_name', group: 'identity', sensitive: true },
    { key: 'from_group', zh: '发起人小组', en: 'from_group', group: 'identity' },
    { key: 'from_condition', zh: '发起人条件', en: 'from_condition', group: 'identity' },
    { key: 'to_participant_id', zh: '接收人编号', en: 'to_participant_id', group: 'identity' },
    { key: 'to_name', zh: '接收人姓名', en: 'to_name', group: 'identity', sensitive: true },
    { key: 'to_group', zh: '接收人小组', en: 'to_group', group: 'identity' },
    { key: 'interaction_type', zh: '互动类型', en: 'interaction_type', group: 'content' },
    { key: 'interaction_label', zh: '互动方式', en: 'interaction_label', group: 'content' },
    { key: 'dyad_type', zh: '互动双方', en: 'dyad_type', group: 'content' },
    { key: 'is_peer', zh: '是否学生间互动', en: 'is_peer', group: 'content' },
    { key: 'involves_ai', zh: '是否涉及AI', en: 'involves_ai', group: 'ai' },
    { key: 'is_cross_group', zh: '是否跨组', en: 'is_cross_group', group: 'content' },
    { key: 'is_self', zh: '是否自我延续', en: 'is_self', group: 'content' },
    { key: 'content_excerpt', zh: '内容摘要', en: 'content_excerpt', group: 'content' },
    { key: 'source_note_title', zh: '来源笔记', en: 'source_note_title', group: 'structure' },
    { key: 'target_note_title', zh: '目标笔记', en: 'target_note_title', group: 'structure' },
    { key: 'space_title', zh: '知识空间', en: 'space', group: 'location' },
    { key: 'created_at_local', zh: '时间', en: 'created_at', group: 'time' },
    { key: 'week_index', zh: '第几周', en: 'week', group: 'time' },
    { key: 'weekday', zh: '星期', en: 'weekday', group: 'time' },
    { key: 'interaction_id', zh: '互动ID', en: 'interaction_id', group: 'meta' },
    { key: 'source_note_id', zh: '来源笔记ID', en: 'source_note_id', group: 'meta' },
    { key: 'target_note_id', zh: '目标笔记ID', en: 'target_note_id', group: 'meta' },
  ],
  participants: [
    { key: 'participant_id', zh: '参与者编号', en: 'participant_id', group: 'identity' },
    { key: 'participant_name', zh: '真实姓名', en: 'participant_name', group: 'identity', sensitive: true },
    { key: 'role', zh: '角色', en: 'role', group: 'identity' },
    { key: 'group_name', zh: '所属小组', en: 'group_name', group: 'identity' },
    { key: 'condition', zh: '实验条件', en: 'condition', group: 'identity' },
    { key: 'n_notes', zh: '笔记数', en: 'n_notes', group: 'content' },
    { key: 'total_words', zh: '总字数', en: 'total_words', group: 'content' },
    { key: 'n_build_on_given', zh: '建立在他人笔记上次数', en: 'n_build_on_given', group: 'structure' },
    { key: 'n_build_on_received', zh: '笔记被他人建立次数', en: 'n_build_on_received', group: 'structure' },
    { key: 'n_peer_interactions', zh: '与同伴互动总数', en: 'n_peer_interactions', group: 'structure' },
    { key: 'n_peers_reached', zh: '互动过的同伴人数', en: 'n_peers_reached', group: 'structure' },
    { key: 'n_messages', zh: '发出消息数', en: 'n_messages', group: 'content' },
    { key: 'n_ai_interactions', zh: '与AI互动数', en: 'n_ai_interactions', group: 'ai' },
    { key: 'n_ai_feedbacks', zh: '收到AI反馈数', en: 'n_ai_feedbacks', group: 'ai' },
    { key: 'n_interventions_delivered', zh: 'AI干预投递数', en: 'n_interventions_delivered', group: 'ai' },
    { key: 'n_interventions_suppressed', zh: '影子记录数', en: 'n_interventions_suppressed', group: 'ai' },
    { key: 'first_activity', zh: '首次活动', en: 'first_activity', group: 'time' },
    { key: 'last_activity', zh: '最近活动', en: 'last_activity', group: 'time' },
    { key: 'group_id', zh: '小组ID', en: 'group_id', group: 'meta' },
  ],
  messages: [
    { key: 'seq', zh: '序号', en: 'seq', group: 'identity' },
    { key: 'participant_id', zh: '发送者编号', en: 'participant_id', group: 'identity' },
    { key: 'participant_name', zh: '发送者姓名', en: 'participant_name', group: 'identity', sensitive: true },
    { key: 'group_name', zh: '所属小组', en: 'group_name', group: 'identity' },
    { key: 'condition', zh: '实验条件', en: 'condition', group: 'identity' },
    { key: 'sender_kind', zh: '发送方', en: 'sender_kind', group: 'content' },
    { key: 'target_type', zh: '对话对象', en: 'target_type', group: 'content' },
    { key: 'is_peer_conversation', zh: '是否同伴对话', en: 'is_peer_conversation', group: 'content' },
    { key: 'content_text', zh: '消息内容', en: 'content', group: 'content' },
    { key: 'word_count', zh: '字数', en: 'word_count', group: 'content' },
    { key: 'seq_in_thread', zh: '线程内轮次', en: 'seq_in_thread', group: 'structure' },
    { key: 'note_title', zh: '所属笔记', en: 'note_title', group: 'structure' },
    { key: 'on_own_note', zh: '是否在自己笔记上', en: 'on_own_note', group: 'structure' },
    { key: 'scaffold_step_id', zh: '脚手架步骤', en: 'scaffold_step_id', group: 'scaffold' },
    { key: 'created_at_local', zh: '时间', en: 'created_at', group: 'time' },
    { key: 'week_index', zh: '第几周', en: 'week', group: 'time' },
    { key: 'message_id', zh: '消息ID', en: 'message_id', group: 'meta' },
    { key: 'thread_id', zh: '线程ID', en: 'thread_id', group: 'meta' },
    { key: 'thread_deleted', zh: '学生已删除该对话', en: 'thread_deleted_by_student', group: 'meta' },
    { key: 'note_id', zh: '笔记ID', en: 'note_id', group: 'meta' },
  ],
  ai_feedbacks: [
    { key: 'seq', zh: '序号', en: 'seq', group: 'identity' },
    { key: 'participant_id', zh: '参与者编号', en: 'participant_id', group: 'identity' },
    { key: 'participant_name', zh: '姓名', en: 'participant_name', group: 'identity', sensitive: true },
    { key: 'group_name', zh: '所属小组', en: 'group_name', group: 'identity' },
    { key: 'condition', zh: '实验条件', en: 'condition', group: 'identity' },
    { key: 'note_title', zh: '所属笔记', en: 'note_title', group: 'structure' },
    { key: 'trigger_type', zh: '触发类型', en: 'trigger_type', group: 'ai' },
    { key: 'detection_method', zh: '检测方式', en: 'detection_method', group: 'ai' },
    { key: 'rationale', zh: '触发理由', en: 'rationale', group: 'ai' },
    { key: 'feedback_text', zh: '反馈内容', en: 'feedback_text', group: 'content' },
    { key: 'feedback_words', zh: '反馈字数', en: 'feedback_words', group: 'content' },
    { key: 'status', zh: '学生处置', en: 'status', group: 'content' },
    { key: 'student_response', zh: '学生回应', en: 'student_response', group: 'content' },
    { key: 'rejection_tag', zh: '不采纳的归类', en: 'rejection_tag', group: 'content' },
    { key: 'suggested_scaffold', zh: 'AI 建议的支架', en: 'suggested_scaffold', group: 'ai' },
    { key: 'suggested_scaffold_used', zh: 'AI 支架是否被使用', en: 'suggested_scaffold_used', group: 'ai' },
    { key: 'rejection_reason', zh: '不采纳的补充说明', en: 'rejection_reason', group: 'content' },
    { key: 'created_at_local', zh: '时间', en: 'created_at', group: 'time' },
    { key: 'week_index', zh: '第几周', en: 'week', group: 'time' },
    { key: 'feedback_id', zh: '反馈ID', en: 'feedback_id', group: 'meta' },
    { key: 'note_id', zh: '笔记ID', en: 'note_id', group: 'meta' },
  ],
  ai_interventions: [
    { key: 'seq', zh: '序号', en: 'seq', group: 'identity' },
    { key: 'participant_id', zh: '参与者编号', en: 'participant_id', group: 'identity' },
    { key: 'participant_name', zh: '姓名', en: 'participant_name', group: 'identity', sensitive: true },
    { key: 'group_name', zh: '所属小组', en: 'group_name', group: 'identity' },
    { key: 'condition', zh: '实验条件', en: 'condition', group: 'identity' },
    { key: 'note_title', zh: '所属笔记', en: 'note_title', group: 'structure' },
    { key: 'trigger_type', zh: '触发类型', en: 'trigger_type', group: 'ai' },
    { key: 'chain', zh: '触发链路', en: 'chain', group: 'ai' },
    { key: 'delivered', zh: '是否投递', en: 'delivered', group: 'ai' },
    { key: 'suppressed', zh: '是否影子记录', en: 'suppressed', group: 'ai' },
    { key: 'response_text', zh: 'AI内容', en: 'response_text', group: 'content' },
    { key: 'accepted_flag', zh: '学生接受', en: 'accepted_flag', group: 'content' },
    { key: 'created_at_local', zh: '时间', en: 'created_at', group: 'time' },
    { key: 'week_index', zh: '第几周', en: 'week', group: 'time' },
    { key: 'intervention_id', zh: '干预ID', en: 'intervention_id', group: 'meta' },
    { key: 'note_id', zh: '笔记ID', en: 'note_id', group: 'meta' },
  ],
  events: [
    { key: 'seq', zh: '序号', en: 'seq', group: 'identity' },
    { key: 'participant_id', zh: '参与者编号', en: 'participant_id', group: 'identity' },
    { key: 'participant_name', zh: '姓名', en: 'participant_name', group: 'identity', sensitive: true },
    { key: 'group_name', zh: '所属小组', en: 'group_name', group: 'identity' },
    { key: 'condition', zh: '实验条件', en: 'condition', group: 'identity' },
    { key: 'event_type', zh: '事件类型', en: 'event_type', group: 'content' },
    { key: 'object_type', zh: '对象类型', en: 'object_type', group: 'content' },
    { key: 'note_title', zh: '相关笔记', en: 'note_title', group: 'structure' },
    { key: 'space_title', zh: '知识空间', en: 'space', group: 'location' },
    { key: 'created_at_local', zh: '时间', en: 'created_at', group: 'time' },
    { key: 'week_index', zh: '第几周', en: 'week', group: 'time' },
    { key: 'weekday', zh: '星期', en: 'weekday', group: 'time' },
    { key: 'hour', zh: '小时', en: 'hour', group: 'time' },
    { key: 'event_id', zh: '事件ID', en: 'event_id', group: 'meta' },
    { key: 'metadata_json', zh: '附加信息', en: 'metadata_json', group: 'meta' },
  ],
  note_revisions: [
    { key: 'seq', zh: '序号', en: 'seq', group: 'identity' },
    { key: 'participant_id', zh: '参与者编号', en: 'participant_id', group: 'identity' },
    { key: 'participant_name', zh: '姓名', en: 'participant_name', group: 'identity', sensitive: true },
    { key: 'group_name', zh: '所属小组', en: 'group_name', group: 'identity' },
    { key: 'note_title', zh: '所属笔记', en: 'note_title', group: 'structure' },
    { key: 'content_text', zh: '修订内容', en: 'content', group: 'content' },
    { key: 'word_count', zh: '字数', en: 'word_count', group: 'content' },
    { key: 'created_at_local', zh: '时间', en: 'created_at', group: 'time' },
    { key: 'revision_id', zh: '修订ID', en: 'revision_id', group: 'meta' },
    { key: 'note_id', zh: '笔记ID', en: 'note_id', group: 'meta' },
  ],
  // 学生求助。既是平台改进的证据,也是下一届的现成答案,所以处境列
  // （在哪个页面、什么设备、前一秒报了什么错）和问答正文一样重要。
  support_questions: [
    { key: 'seq', zh: '序号', en: 'seq', group: 'identity' },
    { key: 'participant_id', zh: '参与者编号', en: 'participant_id', group: 'identity' },
    { key: 'participant_name', zh: '姓名', en: 'participant_name', group: 'identity', sensitive: true },
    { key: 'group_name', zh: '所属小组', en: 'group_name', group: 'identity' },
    { key: 'condition', zh: '实验条件', en: 'condition', group: 'identity' },
    { key: 'space_title', zh: '知识空间', en: 'space', group: 'location' },
    { key: 'question', zh: '学生问题', en: 'question', group: 'content' },
    { key: 'question_length', zh: '问题字数', en: 'question_length', group: 'content' },
    { key: 'ai_answer', zh: 'AI回答', en: 'ai_answer', group: 'ai' },
    { key: 'ai_model', zh: 'AI模型', en: 'ai_model', group: 'ai' },
    { key: 'ai_resolved', zh: 'AI是否解决', en: 'ai_resolved', group: 'ai' },
    { key: 'escalated', zh: '是否转教师', en: 'escalated', group: 'content' },
    { key: 'escalation_note', zh: '学生补充', en: 'escalation_note', group: 'content' },
    { key: 'screenshot_count', zh: '截图数', en: 'screenshot_count', group: 'content' },
    { key: 'screenshot_urls', zh: '截图地址', en: 'screenshot_urls', group: 'meta' },
    { key: 'teacher_answer', zh: '教师回答', en: 'teacher_answer', group: 'content' },
    { key: 'status', zh: '状态', en: 'status', group: 'content' },
    { key: 'first_response_minutes', zh: '首次响应分钟数', en: 'first_response_minutes', group: 'time' },
    { key: 'resolution_minutes', zh: '解决用时分钟', en: 'resolution_minutes', group: 'time' },
    { key: 'ctx_path', zh: '提问页面', en: 'ctx_path', group: 'meta' },
    { key: 'ctx_panel', zh: '提问时面板', en: 'ctx_panel', group: 'meta' },
    { key: 'ctx_viewport', zh: '窗口尺寸', en: 'ctx_viewport', group: 'meta' },
    { key: 'ctx_device', zh: '设备形态', en: 'ctx_device', group: 'meta' },
    { key: 'ctx_client_version', zh: '前端版本', en: 'ctx_client_version', group: 'meta' },
    { key: 'ctx_recent_errors', zh: '提问前的报错', en: 'ctx_recent_errors', group: 'meta' },
    { key: 'created_at_local', zh: '提问时间', en: 'created_at', group: 'time' },
    { key: 'week_index', zh: '第几周', en: 'week', group: 'time' },
    { key: 'weekday', zh: '星期', en: 'weekday', group: 'time' },
    { key: 'hour', zh: '小时', en: 'hour', group: 'time' },
    { key: 'question_id', zh: '求助ID', en: 'question_id', group: 'meta' },
    { key: 'context_json', zh: '完整处境', en: 'context_json', group: 'meta' },
  ],
  sessions: [
    { key: 'seq', zh: '序号', en: 'seq', group: 'identity' },
    { key: 'session_no', zh: '课次', en: 'session_no', group: 'identity' },
    { key: 'week_no', zh: '周次', en: 'week_no', group: 'identity' },
    { key: 'planned_date', zh: '计划日期', en: 'planned_date', group: 'time' },
    { key: 'planned_weekday', zh: '星期', en: 'planned_weekday', group: 'time' },
    { key: 'planned_start', zh: '计划开始', en: 'planned_start', group: 'time' },
    { key: 'planned_minutes', zh: '计划时长分钟', en: 'planned_minutes', group: 'time' },
    { key: 'status', zh: '开课状态', en: 'status', group: 'content' },
    { key: 'actual_date', zh: '实际日期', en: 'actual_date', group: 'time' },
    { key: 'actual_start', zh: '实际开始', en: 'actual_start', group: 'time' },
    { key: 'actual_minutes', zh: '实际时长分钟', en: 'actual_minutes', group: 'time' },
    { key: 'moved_to_date', zh: '调整至日期', en: 'moved_to_date', group: 'time' },
    { key: 'moved_to_start', zh: '调整至开始', en: 'moved_to_start', group: 'time' },
    { key: 'cancel_reason', zh: '未上课原因', en: 'cancel_reason', group: 'content' },
    { key: 'note', zh: '教师备注', en: 'note', group: 'content' },
    { key: 'confirmed_at', zh: '确认时间', en: 'confirmed_at', group: 'time' },
    { key: 'participants', zh: '课堂参与人数', en: 'participants', group: 'content' },
    { key: 'notes_created', zh: '课堂新增笔记', en: 'notes_created', group: 'content' },
    { key: 'build_ons', zh: '课堂Build-on数', en: 'build_ons', group: 'structure' },
    { key: 'ai_feedbacks', zh: '课堂AI反馈数', en: 'ai_feedbacks', group: 'ai' },
    { key: 'ai_summary', zh: 'AI教学日志', en: 'ai_summary', group: 'ai' },
    { key: 'ai_summary_edited', zh: '日志经教师修订', en: 'ai_summary_edited', group: 'ai' },
  ],
};

export const DATASET_LABELS: Record<DatasetKey, { zh: string; en: string; descZh: string; descEn: string }> = {
  notes: { zh: '笔记总表', en: 'Notes', descZh: '一行一条笔记:作者、小组、标题、内容、建立在谁的笔记上、被谁建立', descEn: 'One row per note, with build-on parents and children' },
  interactions: { zh: '互动总表', en: 'Interactions', descZh: '一行一次互动:Build-on、回复、消息、AI 交互统一在此', descEn: 'One row per interaction: build-ons, replies, messages, AI' },
  participants: { zh: '参与者名册', en: 'Participants', descZh: '一行一人:编号、真实姓名、小组、各项活动统计', descEn: 'Roster with code, real name, group, activity counts' },
  messages: { zh: '对话消息', en: 'Messages', descZh: '一行一条消息:小组讨论、同伴私聊、与AI对话', descEn: 'Every message in group, peer, and AI threads' },
  ai_feedbacks: { zh: 'AI 内嵌反馈', en: 'AI feedbacks', descZh: '一行一条 T1-T6 反馈及学生处置', descEn: 'T1-T6 feedback and student disposition' },
  ai_interventions: { zh: 'AI 干预日志', en: 'AI interventions', descZh: '三条链的全部触发,含对照组影子记录', descEn: 'All trigger chains incl. control shadow logs' },
  events: { zh: '行为事件流', en: 'Event log', descZh: '一行一个操作事件,用于时序分析', descEn: 'Timestamped behaviour log' },
  note_revisions: { zh: '笔记修订史', en: 'Note revisions', descZh: '笔记内容随时间的演化', descEn: 'Content evolution over time' },
  sessions: { zh: '课次记录', en: 'Class sessions', descZh: '一行一次课:计划与实际的开课时间、是否上课、课堂期间的建构活动统计与教学日志', descEn: 'One row per class session: planned vs. actual time, whether it was held, in-class activity counts and the teaching log' },
  support_questions: { zh: '学生求助问答', en: 'Support questions', descZh: '一行一次求助:问题、AI 回答、教师回答、提问时的处境', descEn: 'One row per help request: question, AI answer, teacher answer, and the context it was asked in' },
};

const REJECT_TAG_LABEL: Record<string, string> = {
  misread: '误解了我的意思',
  already_considered: '我已经考虑过了',
  off_track: '和我的探究无关',
  disagree: '我不认同这个判断',
};

const RELATION_LABELS: Record<string, string> = {
  extend: '延伸', synthesize: '综合', challenge: '质疑',
  evidence: '证据', clarify: '澄清', question: '提问',
};

// ── Dataset builders ───────────────────────────────────────────────────────

export interface Dataset {
  key: DatasetKey;
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/**
 * 正文来源分层。一条笔记里三种来源常常混在一起：
 * 写在支架方括号里的、自由书写的、从 AI 搬进来的。存稿时已经切好，这里只是摊平成列。
 * 老笔记没有分层数据（写于这个功能之前），字段留空而不是补 0 —— 0 会被误读成「没用支架」。
 */
function layerColumns(n: NoteRow, graph: NoteGraph): Record<string, string | number> {
  const segs = Array.isArray(n.content_segments) ? n.content_segments : [];
  const stats = (n.segment_stats ?? {}) as Record<string, unknown>;
  const num = (k: string) => (typeof stats[k] === 'number' ? (stats[k] as number) : '');
  const uniq = (values: (string | undefined)[]) => [...new Set(values.filter(Boolean) as string[])];

  const scaffoldSegs = segs.filter(s => s.kind === 'scaffold');
  const aiSegs = segs.filter(s => s.kind === 'ai_inserted' || s.kind === 'ai_published');
  const analysed = segs.length > 0;

  return {
    seg_scaffold_count: analysed ? scaffoldSegs.length : '',
    seg_scaffold_titles: uniq(scaffoldSegs.map(s => s.scaffoldTitle)).join(' | '),
    seg_scaffold_l1: uniq(scaffoldSegs.map(s => s.scaffoldL1)).join(' | '),
    seg_total_chars: num('totalChars'),
    seg_student_chars: num('studentChars'),
    seg_scaffold_chars: num('scaffoldChars'),
    seg_plain_chars: num('plainChars'),
    seg_ai_chars: num('aiChars'),
    seg_ai_ratio: num('aiRatio'),
    seg_ai_blocks: analysed ? aiSegs.length : '',
    seg_ai_providers: uniq(aiSegs.map(s => [s.providerId, s.model].filter(Boolean).join('/'))).join(' | '),
    ai_adoption_scaffold: n.ai_adoption_scaffold_id
      ? graph.scaffoldTitleById.get(n.ai_adoption_scaffold_id) ?? n.ai_adoption_scaffold_id
      : '',
  };
}

function buildNotesTable(scope: ExportScope, graph: NoteGraph): Dataset {
  const rows = graph.notes.map((n, index) => {
    const text = stripHtml(n.content);
    const parents = graph.parentsOf.get(n.id) ?? [];
    const children = graph.childrenOf.get(n.id) ?? [];
    const { rootId, depth } = threadRootOf(graph, n.id);
    const feedbacks = graph.feedbacksByNote.get(n.id) ?? [];
    const created = localTime(n.created_at, scope.tz, scope.courseStartMs);
    const updated = localTime(n.updated_at, scope.tz, scope.courseStartMs);

    const authorOf = (noteId: string) => {
      const note = graph.noteById.get(noteId);
      if (!note) return '';
      return note.is_ai_generated ? AI_CODE : codeOf(scope, note.author_id);
    };
    const titleOf = (noteId: string) => graph.noteById.get(noteId)?.title ?? '';

    return {
      seq: index + 1,
      participant_id: n.is_ai_generated ? AI_CODE : codeOf(scope, n.author_id),
      participant_name: n.is_ai_generated ? 'AI' : nameOf(scope, n.author_id),
      group_name: groupNameOf(scope, n.author_id, n.space_id),
      condition: conditionOf(scope, n.author_id),
      space_title: scope.spaceById.get(n.space_id)?.title ?? '',
      view_ids: (n.views ?? []).join(' | '),
      title: n.title,
      content_text: text,
      word_count: countWords(text),
      note_type: n.type,
      epistemic_status: n.epistemic_status ?? '',
      inquiry_question: n.inquiry_question ?? '',
      tags: (n.tags ?? []).join(' | '),
      builds_on_count: parents.length,
      builds_on_authors: parents.map((p) => authorOf(p.target_note_id)).join(' | '),
      builds_on_titles: parents.map((p) => titleOf(p.target_note_id)).join(' | '),
      builds_on_types: parents.map((p) => RELATION_LABELS[p.relation_type] ?? p.relation_type).join(' | '),
      built_on_by_count: children.length,
      built_on_by_authors: children.map((c) => authorOf(c.source_note_id)).join(' | '),
      built_on_by_titles: children.map((c) => titleOf(c.source_note_id)).join(' | '),
      thread_depth: depth,
      thread_root_title: rootId === n.id ? '(自身为源头)' : titleOf(rootId),
      is_ai_generated: n.is_ai_generated ? '是' : '否',
      ai_trigger_type: n.ai_trigger_type ?? '',
      ai_feedback_count: feedbacks.length,
      ai_feedback_types: feedbacks.map((f) => f.trigger_type).join(' | '),
      scaffold_title: n.scaffold_id ? graph.scaffoldTitleById.get(n.scaffold_id) ?? n.scaffold_id : '',
      ...layerColumns(n, graph),
      scaffold_responses: n.scaffold_responses ? JSON.stringify(n.scaffold_responses) : '',
      created_at_local: created.local,
      week_index: created.week,
      weekday: created.weekday,
      hour: created.hour,
      updated_at_local: updated.local,
      is_deleted: n.deleted_at ? '是' : '否',
      note_id: n.id,
      space_id: n.space_id,
      group_id: groupIdOf(scope, n.author_id, n.space_id),
    };
  });

  return { key: 'notes', rows, truncated: graph.notes.length >= ROW_LIMIT };
}

interface ThreadRow {
  id: string; note_id: string | null; space_id: string | null;
  target_type: string; group_id: string | null; target_user_id: string | null;
  created_by: string; created_at: string;
  /** 学生在笔记 AI 助手里删掉了这段对话（只是不再显示，消息仍在这里） */
  deleted_at?: string | null;
}

/**
 * Every act one participant directs at another, in one table:
 *  - build_on:*  — building on someone's note (the core Knowledge Building move)
 *  - message:*   — replies and chat in note threads
 *  - ai_feedback — AI addressing a student
 * AI appears as the participant `AI`, so it can be filtered in or out.
 */
async function buildInteractionsTable(
  scope: ExportScope,
  graph: NoteGraph,
  threads: ThreadRow[],
): Promise<Dataset> {
  const rows: Record<string, unknown>[] = [];
  const push = (row: Record<string, unknown>) => rows.push(row);

  const noteAuthorCode = (noteId: string | null | undefined): string => {
    if (!noteId) return '';
    const note = graph.noteById.get(noteId);
    if (!note) return '';
    return note.is_ai_generated ? AI_CODE : codeOf(scope, note.author_id);
  };
  const noteAuthorUser = (noteId: string | null | undefined): string | null => {
    if (!noteId) return null;
    const note = graph.noteById.get(noteId);
    return note && !note.is_ai_generated ? note.author_id : null;
  };

  // 1. Build-on relations — a peer interaction whenever the two notes have
  //    different authors. This is what the previous export missed entirely.
  for (const rel of graph.relations) {
    const source = graph.noteById.get(rel.source_note_id);
    const target = graph.noteById.get(rel.target_note_id);
    if (!source || !target) continue;

    const fromAi = source.is_ai_generated || rel.ai_suggested;
    const fromCode = fromAi ? AI_CODE : codeOf(scope, source.author_id);
    const toCode = target.is_ai_generated ? AI_CODE : codeOf(scope, target.author_id);
    const fromUser = fromAi ? null : source.author_id;
    const toUser = target.is_ai_generated ? null : target.author_id;
    const t = localTime(rel.created_at, scope.tz, scope.courseStartMs);
    const label = RELATION_LABELS[rel.relation_type] ?? rel.relation_type;
    const fromParty = partyOf(scope, fromCode, fromUser);
    const toParty = partyOf(scope, toCode, toUser);

    push({
      from_participant_id: fromCode,
      from_name: fromAi ? 'AI' : nameOf(scope, fromUser),
      from_group: groupNameOf(scope, fromUser, source.space_id),
      from_condition: conditionOf(scope, fromUser),
      to_participant_id: toCode,
      to_name: target.is_ai_generated ? 'AI' : nameOf(scope, toUser),
      to_group: groupNameOf(scope, toUser, target.space_id),
      interaction_type: `build_on:${rel.relation_type}`,
      interaction_label: `${label}了对方的笔记`,
      dyad_type: dyadOf(fromParty, toParty),
      is_peer: fromParty === '学生' && toParty === '学生' && fromUser !== toUser ? '是' : '否',
      involves_ai: fromAi || target.is_ai_generated ? '是' : '否',
      is_cross_group: fromUser && toUser && groupIdOf(scope, fromUser) !== groupIdOf(scope, toUser) ? '是' : '否',
      is_self: fromUser && fromUser === toUser ? '是' : '否',
      content_excerpt: stripHtml(source.content).slice(0, EXCERPT_LEN),
      source_note_title: source.title,
      target_note_title: target.title,
      space_title: scope.spaceById.get(rel.space_id)?.title ?? '',
      created_at_local: t.local,
      week_index: t.week,
      weekday: t.weekday,
      interaction_id: rel.id,
      source_note_id: rel.source_note_id,
      target_note_id: rel.target_note_id,
      _sort: rel.created_at,
    });
  }

  // 2. Thread messages — a reply on someone's note is directed at its author.
  const threadById = new Map(threads.map((t) => [t.id, t]));
  if (threads.length > 0) {
    const { data: messages } = await supabase
      .from('note_conversation_messages')
      .select('id, thread_id, sender_id, sender_kind, content, created_at')
      .in('thread_id', threads.map((t) => t.id))
      .order('created_at', { ascending: true })
      .limit(ROW_LIMIT);

    for (const msg of messages ?? []) {
      const thread = threadById.get(msg.thread_id as string);
      if (!thread) continue;
      const isAiSender = msg.sender_kind !== 'user';
      const fromUser = isAiSender ? null : (msg.sender_id as string);

      // Recipient: the note's author for note threads, the DM target for
      // member threads, AI for AI threads, else the group.
      let toUser: string | null = null;
      let toCode = '';
      if (thread.target_type === 'ai' && !isAiSender) {
        toCode = AI_CODE;
      } else if (isAiSender) {
        toUser = thread.created_by;
        toCode = codeOf(scope, thread.created_by);
      } else if (thread.target_type === 'member' && thread.target_user_id) {
        toUser = thread.target_user_id;
        toCode = codeOf(scope, thread.target_user_id);
      } else {
        toUser = noteAuthorUser(thread.note_id);
        toCode = noteAuthorCode(thread.note_id);
      }
      if (toUser && fromUser && toUser === fromUser && thread.target_type === 'group') {
        toCode = ''; // talking on your own note in a group thread → addressed to the group
        toUser = null;
      }

      const t = localTime(msg.created_at as string, scope.tz, scope.courseStartMs);
      const text = stripHtml(msg.content);
      const fromParty = partyOf(scope, isAiSender ? AI_CODE : codeOf(scope, fromUser), fromUser);
      const toParty = partyOf(scope, toCode, toUser);
      const peer = fromParty === '学生' && toParty === '学生' && toUser !== fromUser;

      push({
        from_participant_id: isAiSender ? AI_CODE : codeOf(scope, fromUser),
        from_name: isAiSender ? 'AI' : nameOf(scope, fromUser),
        from_group: groupNameOf(scope, fromUser, thread.space_id),
        from_condition: conditionOf(scope, fromUser),
        to_participant_id: toCode,
        to_name: toCode === AI_CODE ? 'AI' : nameOf(scope, toUser),
        to_group: toUser
          ? groupNameOf(scope, toUser, thread.space_id)
          : thread.group_id
            ? scope.groupById.get(thread.group_id)?.name ?? ''
            : '',
        interaction_type: `message:${thread.target_type}`,
        interaction_label:
          thread.target_type === 'group' ? '小组讨论发言'
          : thread.target_type === 'member' ? '同伴私聊'
          : isAiSender ? 'AI 回复' : '向 AI 提问',
        dyad_type: dyadOf(fromParty, toParty),
        is_peer: peer ? '是' : '否',
        involves_ai: isAiSender || toCode === AI_CODE ? '是' : '否',
        is_cross_group: fromUser && toUser && groupIdOf(scope, fromUser) !== groupIdOf(scope, toUser) ? '是' : '否',
        is_self: fromUser && toUser === fromUser ? '是' : '否',
        content_excerpt: text.slice(0, EXCERPT_LEN),
        source_note_title: '',
        target_note_title: thread.note_id ? graph.noteById.get(thread.note_id)?.title ?? '' : '',
        space_title: thread.space_id ? scope.spaceById.get(thread.space_id)?.title ?? '' : '',
        created_at_local: t.local,
        week_index: t.week,
        weekday: t.weekday,
        interaction_id: msg.id,
        source_note_id: '',
        target_note_id: thread.note_id ?? '',
        _sort: msg.created_at,
      });
    }
  }

  // 3. AI inline feedback — AI addressing a student on their own note.
  const { data: feedbacks } = await supabase
    .from('note_ai_feedbacks')
    .select('id, note_id, user_id, trigger_type, feedback_text, created_at')
    .eq('course_id', scope.courseId)
    .order('created_at', { ascending: true })
    .limit(ROW_LIMIT);

  for (const fb of feedbacks ?? []) {
    const uid = fb.user_id as string;
    if (!inScope(scope, uid)) continue;
    if (fb.note_id && !graph.noteById.has(fb.note_id as string)) continue;
    const t = localTime(fb.created_at as string, scope.tz, scope.courseStartMs);
    push({
      from_participant_id: AI_CODE,
      from_name: 'AI',
      from_group: '',
      from_condition: '',
      to_participant_id: codeOf(scope, uid),
      to_name: nameOf(scope, uid),
      to_group: groupNameOf(scope, uid),
      interaction_type: `ai_feedback:${fb.trigger_type}`,
      interaction_label: 'AI 内嵌反馈',
      dyad_type: dyadOf('AI', partyOf(scope, codeOf(scope, uid), uid)),
      is_peer: '否',
      involves_ai: '是',
      is_cross_group: '否',
      is_self: '否',
      content_excerpt: stripHtml(fb.feedback_text).slice(0, EXCERPT_LEN),
      source_note_title: '',
      target_note_title: fb.note_id ? graph.noteById.get(fb.note_id as string)?.title ?? '' : '',
      space_title: '',
      created_at_local: t.local,
      week_index: t.week,
      weekday: t.weekday,
      interaction_id: fb.id,
      source_note_id: '',
      target_note_id: fb.note_id ?? '',
      _sort: fb.created_at,
    });
  }

  rows.sort((a, b) => String(a._sort).localeCompare(String(b._sort)));
  rows.forEach((row, i) => {
    row.seq = i + 1;
    delete row._sort;
  });

  return { key: 'interactions', rows, truncated: graph.relationsTruncated || rows.length >= ROW_LIMIT };
}

async function loadThreads(scope: ExportScope): Promise<ThreadRow[]> {
  const { from, to } = scope.filters;
  let query = supabase
    .from('note_conversation_threads')
    .select('id, note_id, space_id, target_type, group_id, target_user_id, created_by, created_at, deleted_at')
    .eq('course_id', scope.courseId)
    .order('created_at', { ascending: true })
    .limit(ROW_LIMIT);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data } = await query;
  const selectedGroups = new Set(scope.filters.groupIds ?? []);
  return ((data ?? []) as unknown as ThreadRow[]).filter((t) => {
    if (t.space_id && !scope.spaceIds.includes(t.space_id)) return false;
    if (!scope.participantScope) return true;
    return (
      inScope(scope, t.created_by) ||
      inScope(scope, t.target_user_id) ||
      (!!t.group_id && selectedGroups.has(t.group_id))
    );
  });
}

async function buildMessagesTable(scope: ExportScope, graph: NoteGraph, threads: ThreadRow[]): Promise<Dataset> {
  if (threads.length === 0) return { key: 'messages', rows: [], truncated: false };
  const threadById = new Map(threads.map((t) => [t.id, t]));

  const { data } = await supabase
    .from('note_conversation_messages')
    .select('id, thread_id, sender_id, sender_kind, content, scaffold_step_id, created_at')
    .in('thread_id', threads.map((t) => t.id))
    .order('created_at', { ascending: true })
    .limit(ROW_LIMIT + 1);

  const seqByThread = new Map<string, number>();
  const rows = (data ?? []).slice(0, ROW_LIMIT).map((m, index) => {
    const thread = threadById.get(m.thread_id as string);
    const seq = (seqByThread.get(m.thread_id as string) ?? 0) + 1;
    seqByThread.set(m.thread_id as string, seq);
    const isUser = m.sender_kind === 'user';
    const uid = isUser ? (m.sender_id as string) : null;
    const text = stripHtml(m.content);
    const t = localTime(m.created_at as string, scope.tz, scope.courseStartMs);
    const targetType = thread?.target_type ?? '';

    return {
      seq: index + 1,
      participant_id: isUser ? codeOf(scope, uid) : AI_CODE,
      participant_name: isUser ? nameOf(scope, uid) : 'AI',
      group_name: isUser ? groupNameOf(scope, uid, thread?.space_id) : '',
      condition: isUser ? conditionOf(scope, uid) : '',
      sender_kind: isUser ? '学生' : 'AI',
      target_type: targetType === 'group' ? '小组讨论' : targetType === 'member' ? '同伴私聊' : '与AI对话',
      is_peer_conversation: targetType === 'group' || targetType === 'member' ? '是' : '否',
      content_text: text,
      word_count: countWords(text),
      seq_in_thread: seq,
      note_title: thread?.note_id ? graph.noteById.get(thread.note_id)?.title ?? '' : '',
      // 「在自己笔记上用 AI」和「在同学笔记上用 AI」是两种不同的认知动作：
      // 后者是知识建构里 Build-on 的前置行为。分开才能问「AI 支架是否
      // 提高了学生对他人观点的介入程度」。AI 自己发的消息不适用，留空。
      on_own_note: isUser && thread?.note_id
        ? (graph.noteById.get(thread.note_id)?.author_id === uid ? '是' : '否')
        : '',
      scaffold_step_id: m.scaffold_step_id ?? '',
      created_at_local: t.local,
      week_index: t.week,
      message_id: m.id,
      thread_id: m.thread_id,
      thread_deleted: thread?.deleted_at ? '是' : '否',
      note_id: thread?.note_id ?? '',
    };
  });

  return { key: 'messages', rows, truncated: (data ?? []).length > ROW_LIMIT };
}

async function buildAiFeedbacksTable(scope: ExportScope, graph: NoteGraph): Promise<Dataset> {
  const { from, to } = scope.filters;
  let query = supabase
    .from('note_ai_feedbacks')
    .select('id, note_id, user_id, trigger_type, trigger_context, feedback_text, status, response_text, rejection_tag, rejection_reason, suggested_scaffold, suggested_scaffold_used_at, created_at')
    .eq('course_id', scope.courseId)
    .order('created_at', { ascending: true })
    .limit(ROW_LIMIT + 1);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data } = await query;
  const STATUS: Record<string, string> = {
    new: '未处理', accepted: '已接受', ignored: '已忽略',
    followed_up: '已跟进', inserted: '已采纳',
  };

  const rows = (data ?? [])
    .filter((f) => inScope(scope, f.user_id as string) && (!f.note_id || graph.noteById.has(f.note_id as string)))
    .slice(0, ROW_LIMIT)
    .map((f, index) => {
      const ctx = (f.trigger_context ?? {}) as Record<string, unknown>;
      const text = stripHtml(f.feedback_text);
      const t = localTime(f.created_at as string, scope.tz, scope.courseStartMs);
      return {
        seq: index + 1,
        participant_id: codeOf(scope, f.user_id as string),
        participant_name: nameOf(scope, f.user_id as string),
        group_name: groupNameOf(scope, f.user_id as string),
        condition: conditionOf(scope, f.user_id as string),
        note_title: f.note_id ? graph.noteById.get(f.note_id as string)?.title ?? '' : '',
        trigger_type: f.trigger_type,
        detection_method: (ctx.detection_method as string) ?? '',
        rationale: (ctx.rationale as string) ?? '',
        feedback_text: text,
        feedback_words: countWords(text),
        status: STATUS[f.status as string] ?? f.status,
        student_response: stripHtml(f.response_text),
        // 学生为什么不采纳。归类是必填的点选项，补充说明可留空 ——
        // 强制自由文本只会换来应付，分类反而更好编码。
        rejection_tag: REJECT_TAG_LABEL[f.rejection_tag as string] ?? (f.rejection_tag ?? ''),
        rejection_reason: stripHtml(f.rejection_reason),
        suggested_scaffold: f.suggested_scaffold ?? '',
        suggested_scaffold_used: f.suggested_scaffold ? (f.suggested_scaffold_used_at ? '是' : '否') : '',
        created_at_local: t.local,
        week_index: t.week,
        feedback_id: f.id,
        note_id: f.note_id ?? '',
      };
    });

  return { key: 'ai_feedbacks', rows, truncated: (data ?? []).length > ROW_LIMIT };
}

async function buildInterventionsTable(scope: ExportScope, graph: NoteGraph): Promise<Dataset> {
  const { from, to, includeSuppressed = true } = scope.filters;
  let query = supabase
    .from('ai_interventions')
    .select('id, note_id, user_id, trigger_type, trigger_context, response_text, accepted_flag, suppressed, created_at')
    .in('space_id', scope.spaceIds)
    .order('created_at', { ascending: true })
    .limit(ROW_LIMIT + 1);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (!includeSuppressed) query = query.eq('suppressed', false);

  const { data } = await query;
  const rows = (data ?? [])
    .filter((i) => inScope(scope, i.user_id as string) && (!i.note_id || graph.noteById.has(i.note_id as string)))
    .slice(0, ROW_LIMIT)
    .map((i, index) => {
      const ctx = (i.trigger_context ?? {}) as Record<string, unknown>;
      const t = localTime(i.created_at as string, scope.tz, scope.courseStartMs);
      return {
        seq: index + 1,
        participant_id: codeOf(scope, i.user_id as string),
        participant_name: nameOf(scope, i.user_id as string),
        group_name: groupNameOf(scope, i.user_id as string),
        condition: conditionOf(scope, i.user_id as string),
        note_title: i.note_id ? graph.noteById.get(i.note_id as string)?.title ?? '' : '',
        trigger_type: i.trigger_type,
        chain: (ctx.chain as string) ?? '',
        delivered: i.suppressed ? '否' : '是',
        suppressed: i.suppressed ? '是' : '否',
        response_text: stripHtml(i.response_text),
        accepted_flag: i.accepted_flag === null || i.accepted_flag === undefined ? '' : i.accepted_flag ? '是' : '否',
        created_at_local: t.local,
        week_index: t.week,
        intervention_id: i.id,
        note_id: i.note_id ?? '',
      };
    });

  return { key: 'ai_interventions', rows, truncated: (data ?? []).length > ROW_LIMIT };
}

async function buildEventsTable(scope: ExportScope, graph: NoteGraph): Promise<Dataset> {
  const { from, to } = scope.filters;
  let query = supabase
    .from('events')
    .select('id, actor_id, event_type, object_type, space_id, target_note_id, metadata_json, created_at')
    .in('space_id', scope.spaceIds)
    .order('created_at', { ascending: true })
    .limit(ROW_LIMIT + 1);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data } = await query;
  const rows = (data ?? [])
    .filter((e) => inScope(scope, e.actor_id as string) && (!e.target_note_id || graph.noteById.has(e.target_note_id as string)))
    .slice(0, ROW_LIMIT)
    .map((e, index) => {
      const t = localTime(e.created_at as string, scope.tz, scope.courseStartMs);
      return {
        seq: index + 1,
        participant_id: codeOf(scope, e.actor_id as string),
        participant_name: nameOf(scope, e.actor_id as string),
        group_name: groupNameOf(scope, e.actor_id as string, e.space_id as string),
        condition: conditionOf(scope, e.actor_id as string),
        event_type: e.event_type,
        object_type: e.object_type ?? '',
        note_title: e.target_note_id ? graph.noteById.get(e.target_note_id as string)?.title ?? '' : '',
        space_title: e.space_id ? scope.spaceById.get(e.space_id as string)?.title ?? '' : '',
        created_at_local: t.local,
        week_index: t.week,
        weekday: t.weekday,
        hour: t.hour,
        event_id: e.id,
        metadata_json: e.metadata_json ?? {},
      };
    });

  return { key: 'events', rows, truncated: (data ?? []).length > ROW_LIMIT };
}

/**
 * 学生求助。
 *
 * 和其他表不同,这张表按课程取而不是按空间 —— 学生在哪儿都可能卡住,
 * 很多求助根本没有 space_id。只有当研究者明确筛了空间时才收窄。
 *
 * 处境 jsonb 摊平成几列人能直接读的（页面、面板、设备、报错），
 * 同时保留完整 JSON:字段会随平台演进增减,摊平的那几列迟早不够用。
 */
async function buildSupportTable(scope: ExportScope): Promise<Dataset> {
  const { from, to, spaceIds: filteredSpaces } = scope.filters;
  let query = supabase
    .from('support_questions')
    .select('id, user_id, space_id, question, ai_answer, ai_model, ai_resolved, ai_answered_at, escalated_at, escalation_note, teacher_answer, teacher_answered_at, status, context, attachments, created_at')
    .eq('course_id', scope.courseId)
    .order('created_at', { ascending: true })
    .limit(ROW_LIMIT + 1);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data } = await query;
  const narrowed = filteredSpaces?.length ? new Set(filteredSpaces) : null;

  const rows = (data ?? [])
    .filter((q) => inScope(scope, q.user_id as string))
    .filter((q) => !narrowed || (q.space_id ? narrowed.has(q.space_id as string) : false))
    .slice(0, ROW_LIMIT)
    .map((q, index) => {
      const ctx = (q.context ?? {}) as Record<string, unknown>;
      const panel = (ctx.panel ?? {}) as Record<string, unknown>;
      const vp = (ctx.viewport ?? {}) as Record<string, unknown>;
      const failures = Array.isArray(ctx.recentFailures) ? ctx.recentFailures : [];
      const t = localTime(q.created_at as string, scope.tz, scope.courseStartMs);
      const askedMs = Date.parse(q.created_at as string);
      const minutesSince = (iso: unknown) => {
        if (typeof iso !== 'string') return '';
        const ms = Date.parse(iso) - askedMs;
        return Number.isFinite(ms) ? Math.round(ms / 60000) : '';
      };
      const width = typeof vp.w === 'number' ? vp.w : null;

      return {
        seq: index + 1,
        participant_id: codeOf(scope, q.user_id as string),
        participant_name: nameOf(scope, q.user_id as string),
        group_name: groupNameOf(scope, q.user_id as string, q.space_id as string | null),
        condition: conditionOf(scope, q.user_id as string),
        space_title: q.space_id ? scope.spaceById.get(q.space_id as string)?.title ?? '' : '',
        question: q.question ?? '',
        question_length: String(q.question ?? '').length,
        ai_answer: q.ai_answer ?? '',
        ai_model: q.ai_model ?? '',
        // 三态：解决了 / 没解决 / 学生没表态。空字符串不能写成「否」，
        // 那会把「没回答」算成「AI 没解决」，直接把这项指标做坏。
        ai_resolved: q.ai_resolved === true ? '是' : q.ai_resolved === false ? '否' : '',
        escalated: q.escalated_at ? '是' : '否',
        escalation_note: q.escalation_note ?? '',
        // 截图往往是这条求助里信息量最大的部分。地址和张数都留着：
        // 张数可以直接统计，地址让研究者能回头看原图。
        screenshot_count: Array.isArray(q.attachments) ? q.attachments.length : 0,
        screenshot_urls: (Array.isArray(q.attachments) ? q.attachments : [])
          .map((a: Record<string, unknown>) => String(a?.file_url ?? ''))
          .filter(Boolean)
          .join(' | '),
        teacher_answer: q.teacher_answer ?? '',
        status: q.status ?? '',
        first_response_minutes: minutesSince(q.ai_answered_at ?? q.created_at),
        resolution_minutes: minutesSince(q.teacher_answered_at),
        ctx_path: typeof ctx.path === 'string' ? ctx.path : '',
        ctx_panel: typeof panel.activeTab === 'string' ? panel.activeTab : '',
        ctx_viewport: width ? `${width}x${vp.h ?? ''}` : '',
        ctx_device: width ? (width < 768 ? 'mobile' : width < 1280 ? 'tablet' : 'desktop') : '',
        ctx_client_version: typeof ctx.clientVersion === 'string' ? ctx.clientVersion : '',
        ctx_recent_errors: failures
          .map((f) => (f && typeof f === 'object' ? String((f as Record<string, unknown>).detail ?? '') : ''))
          .filter(Boolean)
          .join(' | '),
        created_at_local: t.local,
        week_index: t.week,
        weekday: t.weekday,
        hour: t.hour,
        question_id: q.id,
        context_json: q.context ?? {},
      };
    });

  return { key: 'support_questions', rows, truncated: (data ?? []).length > ROW_LIMIT };
}

async function buildRevisionsTable(scope: ExportScope, graph: NoteGraph): Promise<Dataset> {
  const noteIds = Array.from(graph.noteById.keys());
  if (noteIds.length === 0) return { key: 'note_revisions', rows: [], truncated: false };

  // Postgres cannot take an unbounded IN list, so notes are queried in batches
  // instead of silently dropping everything past the first 1000.
  const NOTE_BATCH = 500;
  const collected: Record<string, unknown>[] = [];
  let hitLimit = false;
  for (let i = 0; i < noteIds.length; i += NOTE_BATCH) {
    const { data: batch } = await supabase
      .from('note_revisions')
      .select('*')
      .in('note_id', noteIds.slice(i, i + NOTE_BATCH))
      .order('created_at', { ascending: true })
      .limit(ROW_LIMIT + 1);
    collected.push(...((batch ?? []) as Record<string, unknown>[]));
    if (collected.length > ROW_LIMIT) { hitLimit = true; break; }
  }
  const data = collected.slice(0, ROW_LIMIT);

  const rows = (data ?? []).map((r, index) => {
    const row = r as Record<string, unknown>;
    const editor = (row.editor_id ?? row.author_id ?? row.user_id) as string | undefined;
    const text = stripHtml(row.content);
    const t = localTime(row.created_at as string, scope.tz, scope.courseStartMs);
    return {
      seq: index + 1,
      participant_id: codeOf(scope, editor),
      participant_name: nameOf(scope, editor),
      group_name: groupNameOf(scope, editor),
      note_title: graph.noteById.get(row.note_id as string)?.title ?? '',
      content_text: text,
      word_count: countWords(text),
      created_at_local: t.local,
      revision_id: row.id,
      note_id: row.note_id,
    };
  });

  return { key: 'note_revisions', rows, truncated: hitLimit };
}

/** Roster: code ↔ real name ↔ group, plus activity counts drawn from the other tables. */
function buildParticipantsTable(
  scope: ExportScope,
  notesDs: Dataset,
  interactionsDs: Dataset,
  extras: { feedbacks: Dataset; interventions: Dataset },
): Dataset {
  const stat = new Map<string, Record<string, number>>();
  const peersOf = new Map<string, Set<string>>();
  const firstLast = new Map<string, { first: string; last: string }>();

  const bump = (code: unknown, field: string, by = 1) => {
    const key = String(code ?? '');
    if (!key || key === AI_CODE) return;
    const entry = stat.get(key) ?? {};
    entry[field] = (entry[field] ?? 0) + by;
    stat.set(key, entry);
  };
  const touch = (code: unknown, at: unknown) => {
    const key = String(code ?? '');
    const time = String(at ?? '');
    if (!key || key === AI_CODE || !time) return;
    const entry = firstLast.get(key);
    if (!entry) firstLast.set(key, { first: time, last: time });
    else {
      if (time < entry.first) entry.first = time;
      if (time > entry.last) entry.last = time;
    }
  };

  for (const row of notesDs.rows) {
    bump(row.participant_id, 'n_notes');
    bump(row.participant_id, 'total_words', Number(row.word_count) || 0);
    touch(row.participant_id, row.created_at_local);
  }

  for (const row of interactionsDs.rows) {
    const from = String(row.from_participant_id ?? '');
    const to = String(row.to_participant_id ?? '');
    const isPeer = row.is_peer === '是';
    const isBuildOn = String(row.interaction_type ?? '').startsWith('build_on');
    const isMessage = String(row.interaction_type ?? '').startsWith('message');

    if (isBuildOn && isPeer) {
      bump(from, 'n_build_on_given');
      bump(to, 'n_build_on_received');
    }
    if (isMessage && from !== AI_CODE) bump(from, 'n_messages');
    if (row.involves_ai === '是' && from !== AI_CODE) bump(from, 'n_ai_interactions');
    if (row.involves_ai === '是' && from === AI_CODE) bump(to, 'n_ai_interactions');
    if (isPeer) {
      bump(from, 'n_peer_interactions');
      if (to && to !== AI_CODE) {
        if (!peersOf.has(from)) peersOf.set(from, new Set());
        peersOf.get(from)!.add(to);
      }
    }
    touch(from, row.created_at_local);
  }

  for (const row of extras.feedbacks.rows) bump(row.participant_id, 'n_ai_feedbacks');
  for (const row of extras.interventions.rows) {
    bump(row.participant_id, row.suppressed === '是' ? 'n_interventions_suppressed' : 'n_interventions_delivered');
  }

  const rows = Array.from(scope.identities.values())
    .filter((identity) => !scope.participantScope || scope.participantScope.has(identity.userId) || identity.isTeacher)
    .map((identity) => {
      const s = stat.get(identity.code) ?? {};
      const times = firstLast.get(identity.code);
      const gid = scope.groupOfUser.get(identity.userId) ?? '';
      return {
        participant_id: identity.code,
        participant_name: identity.name,
        role: identity.isTeacher ? '教师' : '学生',
        group_name: gid ? scope.groupById.get(gid)?.name ?? '' : '',
        condition: conditionOf(scope, identity.userId),
        n_notes: s.n_notes ?? 0,
        total_words: s.total_words ?? 0,
        n_build_on_given: s.n_build_on_given ?? 0,
        n_build_on_received: s.n_build_on_received ?? 0,
        n_peer_interactions: s.n_peer_interactions ?? 0,
        n_peers_reached: peersOf.get(identity.code)?.size ?? 0,
        n_messages: s.n_messages ?? 0,
        n_ai_interactions: s.n_ai_interactions ?? 0,
        n_ai_feedbacks: s.n_ai_feedbacks ?? 0,
        n_interventions_delivered: s.n_interventions_delivered ?? 0,
        n_interventions_suppressed: s.n_interventions_suppressed ?? 0,
        first_activity: times?.first ?? '',
        last_activity: times?.last ?? '',
        group_id: gid,
      };
    })
    .sort((a, b) => String(a.participant_id).localeCompare(String(b.participant_id)));

  return { key: 'participants', rows, truncated: false };
}

// ── Orchestration ──────────────────────────────────────────────────────────

export interface BuiltExport {
  datasets: Record<DatasetKey, Dataset>;
  counts: Record<DatasetKey, number>;
  truncated: DatasetKey[];
  warnings: string[];
}

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 课次记录。这张表是课程层面的，不跟着学生/小组筛选走 ——
 * 「计划 16 次实际上了 14 次」是整门课的事实，按小组切开没有意义。
 */
async function buildSessionsTable(scope: ExportScope): Promise<Dataset> {
  const { data } = await supabase
    .from('course_sessions')
    .select('*')
    .eq('course_id', scope.courseId)
    .order('session_no', { ascending: true });

  const statusLabel: Record<string, string> = {
    planned: '未确认', held: '已上课', cancelled: '未上课', rescheduled: '已调课',
  };

  const rows = (data ?? []).map((s: any, i: number) => {
    const metrics = (s.metrics ?? {}) as Record<string, number>;
    const weekday = s.planned_date ? new Date(`${s.planned_date}T00:00:00Z`).getUTCDay() : null;
    return {
      seq: i + 1,
      session_no: s.session_no,
      week_no: s.week_no,
      planned_date: s.planned_date ?? '',
      planned_weekday: weekday === null ? '' : WEEKDAY_ZH[weekday],
      planned_start: s.planned_start ? String(s.planned_start).slice(0, 5) : '',
      planned_minutes: s.planned_minutes ?? '',
      status: statusLabel[s.status] ?? s.status,
      actual_date: s.actual_date ?? '',
      actual_start: s.actual_start ? String(s.actual_start).slice(0, 5) : '',
      actual_minutes: s.actual_minutes ?? '',
      moved_to_date: s.moved_to_date ?? '',
      moved_to_start: s.moved_to_start ? String(s.moved_to_start).slice(0, 5) : '',
      cancel_reason: s.cancel_reason ?? '',
      note: s.note ?? '',
      confirmed_at: s.confirmed_at ? localTime(s.confirmed_at, scope.tz, scope.courseStartMs).local : '',
      // 只有确认上过课的课次才统计过课堂活动，其余留空而不是填 0
      participants: s.status === 'held' ? (metrics.participants ?? 0) : '',
      notes_created: s.status === 'held' ? (metrics.notes ?? 0) : '',
      build_ons: s.status === 'held' ? (metrics.build_ons ?? 0) : '',
      ai_feedbacks: s.status === 'held' ? (metrics.ai_feedbacks ?? 0) : '',
      ai_summary: s.ai_summary ?? '',
      ai_summary_edited: s.ai_summary ? (s.ai_summary_edited ? '是' : '否') : '',
    };
  });

  return { key: 'sessions', rows, truncated: false };
}

export async function buildAllDatasets(scope: ExportScope): Promise<BuiltExport> {
  const graph = await loadNoteGraph(scope);
  const threads = await loadThreads(scope);

  const notes = buildNotesTable(scope, graph);
  const [interactions, messages, feedbacks, interventions, events, revisions, supportQuestions, sessions] = await Promise.all([
    buildInteractionsTable(scope, graph, threads),
    buildMessagesTable(scope, graph, threads),
    buildAiFeedbacksTable(scope, graph),
    buildInterventionsTable(scope, graph),
    buildEventsTable(scope, graph),
    buildRevisionsTable(scope, graph),
    buildSupportTable(scope),
    buildSessionsTable(scope),
  ]);
  const participants = buildParticipantsTable(scope, notes, interactions, { feedbacks, interventions });

  const datasets: Record<DatasetKey, Dataset> = {
    notes, interactions, participants, messages,
    ai_feedbacks: feedbacks, ai_interventions: interventions,
    events, note_revisions: revisions,
    support_questions: supportQuestions,
    sessions,
  };

  const counts = {} as Record<DatasetKey, number>;
  const truncated: DatasetKey[] = [];
  for (const key of DATASET_KEYS) {
    counts[key] = datasets[key].rows.length;
    if (datasets[key].truncated) truncated.push(key);
  }

  // Surface data-quality issues before the researcher discovers them mid-analysis.
  const warnings: string[] = [];
  const ungrouped = participants.rows.filter((r) => r.role === '学生' && !r.group_name).length;
  if (ungrouped > 0) warnings.push(`有 ${ungrouped} 名学生尚未分配小组,其小组列为空`);
  const noCode = notes.rows.filter((r) => !r.participant_id).length;
  if (noCode > 0) warnings.push(`有 ${noCode} 条笔记的作者不在课程成员名单中,编号为空`);
  const peerCount = interactions.rows.filter((r) => r.is_peer === '是').length;
  if (interactions.rows.length > 0 && peerCount === 0) warnings.push('本次筛选中没有学生之间的互动');

  return { datasets, counts, truncated, warnings };
}

// ── Serialization ──────────────────────────────────────────────────────────

export function visibleColumns(
  dataset: DatasetKey,
  opts: { includeNames?: boolean; columns?: string[] },
): ColumnDef[] {
  const all = DATASET_COLUMNS[dataset];
  const wanted = opts.columns?.length ? new Set(opts.columns) : null;
  return all.filter((col) => {
    if (col.sensitive && !opts.includeNames) return false;
    if (wanted && !wanted.has(col.key)) return false;
    return true;
  });
}

export function datasetToCsv(
  dataset: DatasetKey,
  rows: Record<string, unknown>[],
  columns: ColumnDef[],
  headerLang: 'zh' | 'en',
): string {
  const keys = columns.map((c) => c.key);
  const headerRow = columns.map((c) => (headerLang === 'zh' ? c.zh : c.en));
  const body = toCsv(rows, keys).split('\n').slice(1);
  const header = headerRow.map((h) => `"${h.replace(/"/g, '""')}"`).join(',');
  // UTF-8 BOM so Excel opens Chinese text correctly.
  return '﻿' + [header, ...body].join('\n');
}

export function buildReadme(scope: ExportScope, built: BuiltExport, generatedAt: string, selected: DatasetKey[]): string {
  const f = scope.filters;
  const groupNames = (f.groupIds ?? []).map((g) => scope.groupById.get(g)?.name ?? g).join('、') || '全部小组';
  const spaceNames = (f.spaceIds ?? []).map((s) => scope.spaceById.get(s)?.title ?? s).join('、') || '全部空间';

  const lines = [
    '# HAKCC 研究数据导出',
    '',
    `导出时间:${generatedAt}`,
    `课程:${scope.englishName ?? ''}(编号前缀 ${scope.abbr ?? ''})`,
    '',
    '## 本次筛选',
    '',
    `- 知识空间:${spaceNames}`,
    `- 小组:${groupNames}`,
    `- View:${f.viewId || '全部'}`,
    `- 时间范围:${f.from?.slice(0, 10) || '不限'} ~ ${f.to?.slice(0, 10) || '不限'}`,
    `- 含 AI 生成笔记:${f.includeAiGenerated === false ? '否' : '是'}`,
    `- 含已删除笔记:${f.includeDeleted === false ? '否' : '是(标记"已删除")'}`,
    `- 含真实姓名:${f.includeNames ? '是' : '否'}`,
    '',
    '## 参与者编号',
    '',
    `编号形如 **S${scope.abbr ?? 'XXXX'}01**:首字母 S=学生 / T=教师,中间是课程英文缩写,末尾是随机分配的序号。`,
    '序号一经分配永久固定,历次导出保持一致;编号顺序与姓名、入课顺序无关。',
    scope.filters.includeNames
      ? '⚠️ 本次导出包含真实姓名。含姓名的文件相当于身份对照密钥,请单独存放,不要与分析数据一起转交他人。'
      : '分析用表只含编号;需要核查身份时请单独导出「参与者名册」(勾选包含姓名)。',
    '',
    '## 文件清单',
    '',
    '| 文件 | 行数 | 说明 |',
    '|------|------|------|',
  ];

  for (const key of selected) {
    lines.push(`| ${key}.csv | ${built.counts[key]} | ${DATASET_LABELS[key].descZh} |`);
  }

  lines.push(
    '',
    '## 表之间怎么连接',
    '',
    '所有表都用 `参与者编号` 连接到「参与者名册」;涉及笔记的行都用 `笔记ID` 连接到「笔记总表」。',
    '',
    '- 想看**谁和谁互动**:用「互动总表」,筛选 `是否学生间互动 = 是`',
    '- 想看**一条想法怎么被延伸**:用「笔记总表」的"建立在谁的笔记上""被谁建立""讨论串源头"',
    '- 想比较**两个实验组**:任何表按 `实验条件` 分组即可',
    '',
    '## 关于"互动"的口径',
    '',
    '在他人笔记上建构(延伸/综合/质疑/证据/澄清/提问)**计为学生之间的互动**,',
    '与聊天消息一并收录在「互动总表」中。涉及 AI 的行以 `是否涉及AI = 是` 标记,可自行过滤。',
  );

  if (built.warnings.length > 0) {
    lines.push('', '## 数据质量提示', '', ...built.warnings.map((w) => `- ${w}`));
  }
  if (built.truncated.length > 0) {
    lines.push('', `## ⚠️ 截断`, '', `以下表达到单次上限 ${ROW_LIMIT} 行:${built.truncated.join('、')}。请缩小时间范围分批导出。`);
  }

  return lines.join('\n');
}
