import { Router, Request, Response } from 'express';
import { loadKnowledgeTimeline } from '../services/knowledgeTimeline';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { dropNoteFromKb, scheduleKbIngest, scheduleKbRefresh } from '../services/kbIngest';
import { segmentNoteContent } from '../services/noteSegments';
import { aiPartnerPublicationHtml, sanitizeNoteHtml } from '../services/noteHtml';
import { updateHeatScore } from '../services/metricsService';
import { ensureNoteAccess, ensureSpaceAccess, ensureCourseMember, ensureCourseInstructor, isCourseStaff } from '../services/accessControl';
import { isUuid } from '../services/eventPayload';
import { clampNumber } from '../services/requestParams';

/** Upload allows 40MB, but pulling that into memory to extract text does not. */
const MAX_EXTRACT_BYTES = 20 * 1024 * 1024;
import { fetchExperimentMode } from '../services/experimentCondition';
import { embedNote } from '../services/embeddingService';
import {
  cleanDisplayName,
  displayNameOrFallback,
  emailFallbackName,
  profileWithDisplayName,
  resolveDisplayProfile,
} from '../services/displayName';
import { TtlCache } from '../services/ttlCache';
import { canExtractText, extractDocumentText } from '../services/documentText';
import { validateUpload, validateDeclaredUpload, verifyStoredBytes } from '../services/attachmentValidation';
import { mergeNoteMetadata, parsePresentationPatch } from '../services/notePresentation';
import {
  isMarkdownFile,
  MARKDOWN_CONFLICT_MESSAGE,
  mergeClientMetadata,
  replaceMarkdownFile,
  updateNoteGuarded,
  withMdVersion,
} from '../services/noteMetadata';


const router = Router();

const NOTE_TYPES = ['note', 'drawing', 'attachment', 'video', 'link', 'view', 'riseabove'];
const VALID_EPISTEMIC_STATUSES = ['standard', 'promising', 'authoritative', 'needs_work', 'unresolved'];
const VALID_RELATION_TYPES = ['extend', 'clarify', 'question', 'challenge', 'evidence', 'synthesize'] as const;
const KNOWLEDGE_LACK_TYPES = ['unanswered_question', 'confusion', 'contradiction', 'needed_evidence', 'need_to_understand'] as const;

type KnowledgeLackType = typeof KNOWLEDGE_LACK_TYPES[number];
type RelationType = typeof VALID_RELATION_TYPES[number];
type ProfileSummary = {
  id: string;
  name?: string;
  email?: string;
  avatar?: string;
};

function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function makeAiPartnerNoteTitle(selectedText: string, requestedTitle?: unknown) {
  const explicit = textValue(requestedTitle);
  if (explicit) return explicit.slice(0, 180);
  const compact = selectedText.replace(/\s+/g, ' ').trim();
  return compact.length > 56 ? `${compact.slice(0, 56)}...` : compact || 'AI Partner Note';
}

function joinedUserSummary(value: unknown): ProfileSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const name = cleanDisplayName(textValue(row.full_name))
    ?? cleanDisplayName(textValue(row.name))
    ?? emailFallbackName(textValue(row.email));
  const email = textValue(row.email);
  const avatar = textValue(row.avatar_url) ?? textValue(row.avatar);
  if (!name && !email && !avatar) return undefined;
  return {
    id: textValue(row.id) ?? '',
    name,
    email,
    avatar,
  };
}

/**
 * 从主查询嵌进来的 author_profile 里直接构造作者资料。
 * 只要有一行缺这个字段就返回 null，让调用方退回批量查询——
 * 半对半错地混着用会让某些笔记显示成匿名。
 */
function embeddedAuthorProfiles(rows: Array<Record<string, unknown>>): Map<string, ProfileSummary> | null {
  const map = new Map<string, ProfileSummary>();
  for (const row of rows) {
    const authorId = textValue(row.author_id);
    if (!authorId) continue;
    const embedded = row.author_profile;
    if (!embedded || typeof embedded !== 'object') return null;
    const p = embedded as Record<string, unknown>;
    const email = textValue(p.email);
    const avatar = textValue(p.avatar_url);
    const summary = profileWithDisplayName({
      id: authorId, name: textValue(p.full_name), email, avatar,
    }) ?? { id: authorId, email, avatar };
    map.set(authorId, { ...summary, id: authorId });
  }
  return map;
}

/* Implementation notes are described in the public update guide. */
const profileCache = new TtlCache<ProfileSummary>(60_000, 5000);
/** profiles 和 users 两张表都查不到的 id。只用于跳过重复查询。 */
const absentProfiles = new TtlCache<true>(60_000, 5000);

async function getProfilesByIds(userIds: string[]): Promise<Map<string, ProfileSummary>> {
  const ids = Array.from(new Set(userIds.map((id) => id.trim()).filter(Boolean)));
  const profileMap = new Map<string, ProfileSummary>();
  if (ids.length === 0) return profileMap;

  for (const id of ids) {
    const hit = profileCache.get(id);
    if (hit) profileMap.set(id, hit);
  }
  const missing = ids.filter((id) => !profileMap.has(id) && !absentProfiles.get(id));
  if (missing.length === 0) return profileMap;

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url')
    .in('id', missing);

  if (!profileError) {
    for (const profile of (profiles ?? []) as Array<Record<string, unknown>>) {
      const id = textValue(profile.id);
      if (!id) continue;
      const email = textValue(profile.email);
      const summary = profileWithDisplayName({
        id,
        name: textValue(profile.full_name),
        email,
        avatar: textValue(profile.avatar_url),
      }) ?? { id, email, avatar: textValue(profile.avatar_url) };
      profileMap.set(id, { ...summary, id });
      profileCache.set(id, { ...summary, id });
    }
  }

  // profiles 里没有的 id 落到 users 兜底表。这一批也要进缓存，
  // 否则每次都会因为它们而重发一次查询（学生开画布时实测每次多 250ms）。
  const missingIds = ids.filter((id) => !profileMap.has(id) && !absentProfiles.get(id));
  if (missingIds.length === 0) return profileMap;

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, name, email, avatar')
    .in('id', missingIds);

  if (usersError) return profileMap;
  for (const user of (users ?? []) as Array<Record<string, unknown>>) {
    const id = textValue(user.id);
    if (!id) continue;
    const email = textValue(user.email);
    const summary = profileWithDisplayName({
      id,
      name: textValue(user.name),
      email,
      avatar: textValue(user.avatar),
    }) ?? { id, email, avatar: textValue(user.avatar) };
    profileMap.set(id, { ...summary, id });
    profileCache.set(id, { ...summary, id });
  }

  // 两张表都查不到的 id 单独记一份「确实没有」的名单：只用来跳过重复查询，
  // 不往 profileMap 里塞假资料——那会让作者名变空。
  for (const id of missingIds) {
    if (!profileMap.has(id)) absentProfiles.set(id, true);
  }

  return profileMap;
}

/** 空间 → 授课教师资料。这条链是 spaces→courses→profiles 三次串行往返，
 *  而结果几乎不变，所以整条缓存掉。 */
const instructorBySpaceCache = new TtlCache<ProfileSummary>(60_000, 2000);

async function getInstructorProfilesBySpaceIds(spaceIds: string[]): Promise<Map<string, ProfileSummary>> {
  const allIds = Array.from(new Set(spaceIds.map((id) => id.trim()).filter(Boolean)));
  const instructorBySpace = new Map<string, ProfileSummary>();
  if (allIds.length === 0) return instructorBySpace;

  for (const id of allIds) {
    const hit = instructorBySpaceCache.get(id);
    if (hit) instructorBySpace.set(id, hit);
  }
  const ids = allIds.filter((id) => !instructorBySpace.has(id));
  if (ids.length === 0) return instructorBySpace;

  const { data: spaces, error: spacesError } = await supabase
    .from('spaces')
    .select('id, course_id')
    .in('id', ids);

  if (spacesError) return instructorBySpace;

  const courseIdBySpaceId = new Map<string, string>();
  for (const space of (spaces ?? []) as Array<Record<string, unknown>>) {
    const id = textValue(space.id);
    const courseId = textValue(space.course_id);
    if (id && courseId) courseIdBySpaceId.set(id, courseId);
  }

  const courseIds = Array.from(new Set(Array.from(courseIdBySpaceId.values())));
  if (courseIds.length === 0) return instructorBySpace;

  const { data: courses, error: coursesError } = await supabase
    .from('courses')
    .select('id, instructor_id')
    .in('id', courseIds);

  if (coursesError) return instructorBySpace;

  const instructorIdByCourseId = new Map<string, string>();
  for (const course of (courses ?? []) as Array<Record<string, unknown>>) {
    const id = textValue(course.id);
    const instructorId = textValue(course.instructor_id);
    if (id && instructorId) instructorIdByCourseId.set(id, instructorId);
  }

  const instructorProfiles = await getProfilesByIds(Array.from(instructorIdByCourseId.values()));
  for (const [spaceId, courseId] of courseIdBySpaceId.entries()) {
    const instructorId = instructorIdByCourseId.get(courseId);
    const instructor = instructorId ? instructorProfiles.get(instructorId) : undefined;
    if (instructor) {
      instructorBySpace.set(spaceId, instructor);
      instructorBySpaceCache.set(spaceId, instructor);
    }
  }

  return instructorBySpace;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ApiError(400, `${fieldName} must be a string`);
  return value.trim();
}

function parseKnowledgeLacks(value: unknown): Array<{
  id: string;
  type: KnowledgeLackType;
  text: string;
  createdAt?: string;
  resolvedAt?: string;
}> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ApiError(400, 'knowledge_lacks must be an array');

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(400, `knowledge_lacks[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const id = optionalString(record.id, `knowledge_lacks[${index}].id`);
    const type = optionalString(record.type, `knowledge_lacks[${index}].type`);
    const text = optionalString(record.text, `knowledge_lacks[${index}].text`);
    if (!id) throw new ApiError(400, `knowledge_lacks[${index}].id is required`);
    if (!type || !KNOWLEDGE_LACK_TYPES.includes(type as KnowledgeLackType)) {
      throw new ApiError(400, `knowledge_lacks[${index}].type is invalid`);
    }
    if (!text) throw new ApiError(400, `knowledge_lacks[${index}].text is required`);

    return {
      id,
      type: type as KnowledgeLackType,
      text,
      createdAt: optionalString(record.createdAt, `knowledge_lacks[${index}].createdAt`),
      resolvedAt: optionalString(record.resolvedAt, `knowledge_lacks[${index}].resolvedAt`),
    };
  });
}

// Expand a DB note row into the API shape the frontend expects
function expandNote(
  row: Record<string, unknown>,
  authorProfile?: ProfileSummary,
  instructorProfile?: ProfileSummary,
) {
  const joinedUser = joinedUserSummary(row.users);
  const authorId = textValue(row.author_id);
  const displayUser = resolveDisplayProfile({
    authorId,
    authorProfile,
    joinedUser,
    instructorProfile,
  });

  return {
    id: row.id,
    space_id: row.space_id,
    author_id: row.author_id,
    type: row.type,
    title: row.title,
    content: row.content,
    summary: row.summary,
    inquiry_question: row.inquiry_question,
    promising_reason: row.promising_reason,
    knowledge_lacks: row.knowledge_lacks ?? [],
    x: row.x ?? 0,
    y: row.y ?? 0,
    width: row.width,
    height: row.height,
    tags: row.tags ?? [],
    views: row.views ?? [],
    cited_note_ids: row.cited_note_ids ?? [],
    rise_above_data: row.rise_above_data,
    drawing_data: row.drawing_data,
    file_url: row.file_url,
    file_name: row.file_name,
    mime_type: row.mime_type,
    // Canvas presentation prefs (e.g. attachment shown as media vs. card).
    metadata: row.metadata ?? {},
    epistemic_status: row.epistemic_status,
    scaffold_id: row.scaffold_id,
    scaffold_responses: row.scaffold_responses,
    is_ai_generated: row.is_ai_generated ?? false,
    ai_trigger_type: row.ai_trigger_type,
    created_at: row.created_at,
    updated_at: row.updated_at,
    users: displayUser
      ? { name: displayNameOrFallback(displayUser), email: displayUser.email, avatar: displayUser.avatar }
      : undefined,
    // Metrics from note_metrics_realtime if joined
    note_metrics_realtime: row.note_metrics_realtime,
  };
}

/**
 * 补上作者与授课教师的资料。
 *
 * knownInstructors 是给「已经知道教师是谁」的调用方用的（列表接口的权限检查
 * 刚查过同一门课）。不传的话要走 spaces→courses→profiles 三次串行往返，
 * 每次 ~300ms —— 画布加载慢的大头就在这里。
 */
// 列表只带画布要用的列。content_segments / segment_stats 是研究导出用的分段结构，
// 前端列表根本不读；指标表也只取画布用的 9 列。压测里 200 条笔记的列表响应 270KB，
// 其中指标嵌入占 78KB，序列化它们是 Node 单进程在 200 人并发时打满 CPU 的主因之一。
/**
 * 这之前发的笔记一律不标 New：那时画布右侧详情栏里的浏览没有记录，没法知道谁看过（070）。
 * 以后发的笔记都在这之后，这条只对老笔记起作用。
 */
const NEW_BADGE_SINCE_MS = Date.parse('2026-09-15T00:00:00+08:00');

const NOTES_SELECT =
  'id, course_id, author_id, author_name, type, title, content, x, y, width, height, views, metadata, created_at, updated_at, space_id, summary, tags, cited_note_ids, rise_above_data, drawing_data, file_url, file_name, mime_type, epistemic_status, scaffold_id, scaffold_responses, deleted_at, is_ai_generated, ai_trigger_type, inquiry_question, promising_reason, knowledge_lacks, ai_adoption_scaffold_id, users!author_id(id, name, email, avatar), note_metrics_realtime(direct_in_degree, direct_out_degree, build_on_count, unique_contributor_count, challenge_count, evidence_count, synthesis_count, revision_count, heat_score), author_profile:profiles!author_id(id, full_name, email, avatar_url), note_feedbacks(is_published, is_read)';

async function expandNotes(
  rows: Array<Record<string, unknown>>,
  knownInstructors?: Map<string, string>,   // spaceId → instructorId
) {
  const authorIds = rows.map((row) => textValue(row.author_id)).filter((id): id is string => Boolean(id));
  const spaceIds = rows.map((row) => textValue(row.space_id)).filter((id): id is string => Boolean(id));

  // 教师 id 已知时，把它并进作者那一批一次查完，省掉两次往返
  const preknown = knownInstructors
    && spaceIds.every((id) => knownInstructors.has(id))
    ? knownInstructors : null;

  // 主查询已经把作者资料嵌进来了（author_profile）就直接用，一次往返都不用发。
  // 别的调用方（单条笔记、Build-on 等）没嵌，就还是走批量查询。
  const embedded = embeddedAuthorProfiles(rows);
  const stillNeeded = embedded
    ? (preknown ? [...preknown.values()].filter((id) => !embedded.has(id)) : authorIds)
    : (preknown ? [...authorIds, ...preknown.values()] : authorIds);

  const [fetchedProfiles, lookedUpInstructors] = await Promise.all([
    stillNeeded.length ? getProfilesByIds(stillNeeded) : Promise.resolve(new Map<string, ProfileSummary>()),
    preknown ? Promise.resolve(null) : getInstructorProfilesBySpaceIds(spaceIds),
  ]);
  const authorProfiles = embedded
    ? new Map<string, ProfileSummary>([...embedded, ...fetchedProfiles])
    : fetchedProfiles;

  const instructorFor = (spaceId: string | undefined) => {
    if (!spaceId) return undefined;
    if (preknown) {
      const id = preknown.get(spaceId);
      return id ? authorProfiles.get(id) : undefined;
    }
    return lookedUpInstructors?.get(spaceId);
  };

  return rows.map((row) => {
    const authorId = textValue(row.author_id);
    return expandNote(
      row,
      authorId ? authorProfiles.get(authorId) : undefined,
      instructorFor(textValue(row.space_id)),
    );
  });
}

// GET /api/spaces/:spaceId/timeline
/** Knowledge progression: public ideas, real revisions and caller-owned AI activity. */
router.get('/spaces/:spaceId/timeline', verifyJWT, async (req: Request, res: Response) => {
  const scope = req.query.scope ?? 'space';
  if (scope !== 'space' && scope !== 'course') throw new ApiError(400, 'Invalid timeline scope');
  res.json(await loadKnowledgeTimeline(String(req.params.spaceId), req.user!, scope));
});

router.get('/spaces/:spaceId/notes', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  // NOTES_SELECT inlines author_profile and note_feedbacks, so an unbounded
  // ?limit materialises hundreds of MB in one query; NaN would make the range
  // nonsensical rather than erroring.
  const limit = clampNumber(req.query.limit, 1, 500, 200);
  const offset = clampNumber(req.query.offset, 0, 1_000_000, 0);
  const t0 = Date.now();

  // 权限检查和取笔记同时发：两者都只要 spaceId，串起来白白多等一个往返。
  // 检查没过就直接抛，笔记结果丢掉（下面 catch 掉，避免 unhandled rejection）。
  const notesQuery = supabase
    .from('notes')
    // author_profile 和 note_feedbacks 都嵌进来：各自单独查都要多付一次
    // 用 + 拼接会让 supabase-js 的类型推断退化成 GenericStringError。
    .select(NOTES_SELECT, { count: 'exact' })
    .eq('space_id', spaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
    .then(r => r, e => ({ data: null, count: null, error: e }));

  // 「New」按人算（070）：只查调用者自己在这个空间里打开过哪些。单独查、和主查询并发：
  // 查不到只是不显示角标，不能拖垮整块画布，所以不嵌进 NOTES_SELECT。
  const seenQuery = supabase
    .from('note_views')
    .select('note_id, notes!inner(space_id)')
    .eq('viewer_id', req.user!.id)
    .eq('notes.space_id', spaceId)
    .then(r => r, e => ({ data: null, error: e }));

  // .then(ok, err) 已经把失败吞成了普通结果，所以这里不会有 unhandled rejection
  const space = await ensureSpaceAccess(spaceId, req.user!);
  const tAccess = Date.now();

  const { data, count, error } = await notesQuery;
  if (error) throw new ApiError(500, (error as { message?: string }).message ?? 'notes query failed');
  const tNotes = Date.now();

  const rawRows = (data ?? []) as Array<Record<string, unknown>>;
  // 权限检查刚拿到这门课的教师，直接复用，省掉 spaces→courses→profiles 三次串行
  const knownInstructors = space.instructor_id
    ? new Map([[spaceId, space.instructor_id]])
    : undefined;

  // 未读教师反馈的角标：反馈已经随主查询一起回来了，这里只是筛一下，不再发查询。
  // 只对本人的笔记算——角标是给作者看的。
  const unreadSet = new Set(
    rawRows
      .filter((row) => row.author_id === req.user!.id)
      .filter((row) => {
        const fbs = Array.isArray(row.note_feedbacks) ? row.note_feedbacks : [];
        return fbs.some((fb: Record<string, unknown>) => fb.is_published === true && fb.is_read === false);
      })
      .map((row) => String(row.id)),
  );

  const [expanded, seenRes] = await Promise.all([expandNotes(rawRows, knownInstructors), seenQuery]);
  const tExpand = Date.now();

  // 查询失败时一律当作看过：宁可少一个角标，也不能满屏 New
  const seenIds = seenRes.error
    ? null
    : new Set(((seenRes.data ?? []) as Array<{ note_id: string }>).map((row) => String(row.note_id)));
  const seenByMe = (note: { id: unknown; author_id?: unknown; created_at?: unknown }) =>
    !seenIds
    || seenIds.has(String(note.id))
    || note.author_id === req.user!.id
    || Date.parse(String(note.created_at ?? '')) < NEW_BADGE_SINCE_MS;

  const notes = expanded.map((note: any) => ({
    ...note,
    unread_feedback: unreadSet.has(String(note.id)),
    seen_by_me: seenByMe(note),
  }));
  // Server-Timing：浏览器开发者工具直接能看到每段耗时，下次再慢不用重新挖
  // Server-Timing：浏览器开发者工具直接能看到每段耗时，下次再慢不用重新挖
  res.setHeader('Server-Timing',
    `access;dur=${tAccess - t0}, notes;dur=${tNotes - tAccess}, expand;dur=${tExpand - tNotes}`);
  res.json({ notes, total: count ?? 0 });
});

// GET /api/notes/:id
router.get('/notes/:id', verifyJWT, async (req: Request, res: Response) => {
  const noteId = String(req.params.id);
  await ensureNoteAccess(noteId, req.user!);

  const { data, error } = await supabase
    .from('notes')
    .select('*, users!author_id(id, name, email, avatar), note_metrics_realtime(*)')
    .eq('id', noteId)
    .is('deleted_at', null)
    .single();

  if (error) throw new ApiError(404, 'Note not found');
  const [note] = await expandNotes([data as Record<string, unknown>]);
  res.json({ note });
});

// POST /api/notes/:id/seen — 我打开了这条笔记，它在我这里不再标 New（070，按人算）。
// 记的是我第一次打开的时间，再打开不覆盖；作者自己的笔记不记。
router.post('/notes/:id/seen', verifyJWT, async (req: Request, res: Response) => {
  const note = await ensureNoteAccess(String(req.params.id), req.user!);
  if (note.author_id === req.user!.id) {
    res.json({ recorded: false });
    return;
  }
  const { error } = await supabase
    .from('note_views')
    .upsert({ note_id: note.id, viewer_id: req.user!.id }, { onConflict: 'note_id,viewer_id', ignoreDuplicates: true });
  if (error) throw new ApiError(500, error.message);
  res.json({ recorded: true });
});

// GET /api/notes/:id/revisions
router.get('/notes/:id/revisions', verifyJWT, async (req: Request, res: Response) => {
  const noteId = String(req.params.id);
  await ensureNoteAccess(noteId, req.user!);

  const { data, error } = await supabase
    .from('note_revisions')
    .select('*, users!editor_id(name)')
    .eq('note_id', noteId)
    .order('revision_number', { ascending: false });

  if (error) throw new ApiError(500, error.message);
  res.json({ revisions: data ?? [] });
});

// POST /api/spaces/:spaceId/attachments — store a canvas attachment and return
// its public URL. Canvas uploads used to live only as blob: URLs in the
// uploader's browser, so nobody else ever saw them and they vanished on reload.
/**
 * POST /attachments/extract-text — 读取一个**已经存在我们存储里**的附件的正文。
 *
 * 上传时可以顺手抽（extract_text），但学生也会对早就传上来的文件说
 * 「带这份文档去问 AI」，那时候文件已经在存储里了，只能回头再读一次。
 *
 * 只接受我们自己 bucket 的公开地址：这个接口会用服务端身份去 fetch，
 * 放开任意 URL 就是一个现成的 SSRF 跳板。
 */
router.post('/attachments/extract-text', verifyJWT, async (req: Request, res: Response) => {
  const { file_url, file_name = '', mime_type = '' } = req.body as {
    file_url?: string; file_name?: string; mime_type?: string;
  };
  if (!file_url) throw new ApiError(400, 'file_url is required');

  const { data: publicRoot } = supabase.storage.from('note-chat-attachments').getPublicUrl('');
  const prefix = publicRoot.publicUrl.replace(/\/$/, '');
  if (!file_url.startsWith(prefix)) {
    throw new ApiError(400, '只支持读取本平台存储里的附件。');
  }

  // Being in our bucket only proves the file is ours, not that it is yours.
  // The object key carries its owner, so authorise against that:
  //   spaces/<courseId>/<spaceId>/…   note attachments
  //   support/<courseId>/<userId>/…   help-desk screenshots
  //   <courseId>/<noteId>/<threadId>/… conversation attachments
  const segments = decodeURIComponent(file_url.slice(prefix.length))
    .replace(/^\/+/, '').split('/').filter(Boolean);
  if (segments[0] === 'spaces') {
    if (!isUuid(segments[2])) throw new ApiError(400, '附件地址不合法');
    await ensureSpaceAccess(segments[2], req.user!);
  } else if (segments[0] === 'support') {
    if (!isUuid(segments[1])) throw new ApiError(400, '附件地址不合法');
    if (segments[2] !== req.user!.id) await ensureCourseInstructor(segments[1], req.user!);
  } else {
    if (!isUuid(segments[0])) throw new ApiError(400, '附件地址不合法');
    await ensureCourseMember(segments[0], req.user!);
  }

  const resp = await fetch(file_url);
  if (!resp.ok) throw new ApiError(404, `读取附件失败：HTTP ${resp.status}`);
  const declaredSize = Number(resp.headers.get('content-length') ?? 0);
  if (declaredSize > MAX_EXTRACT_BYTES) {
    throw new ApiError(413, '附件过大，无法解析文本。');
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > MAX_EXTRACT_BYTES) {
    throw new ApiError(413, '附件过大，无法解析文本。');
  }

  const name = file_name || decodeURIComponent(file_url.split('/').pop() ?? '');
  const type = mime_type || resp.headers.get('content-type') || '';
  const extracted = canExtractText(type, name)
    ? await extractDocumentText(buffer, type, name)
    : null;

  res.json({
    text: extracted?.text ?? null,
    truncated: extracted?.truncated ?? false,
    source: extracted?.source ?? null,
  });
});

/**
 * 大文件走「浏览器直传存储」两步走。
 *
 * 旧路径把文件 base64 塞进 JSON 发给服务器，体积膨胀 37%，还要在内存里
 * 同时放一份字符串和一份 Buffer —— 上限被 Express 的请求体限制卡在 25MB，
 * 再往上就是几十人同时上传时的内存风险。直传之后字节根本不经过 API，
 * 上限只受存储桶本身约束。
 *
 * 代价是服务端看不到字节了，所以拆成两步：
 *   sign   —— 校验声明的类型和文件名，签发一次性上传地址；
 *   commit —— 文件落盘之后回读开头几百字节做魔数校验，不合格就删掉。
 * 少了 commit 这一步，公开桶里就能放一个伪装成图片的 HTML。
 */
const DIRECT_UPLOAD_MAX = 500 * 1024 * 1024;

router.post('/spaces/:spaceId/attachments/sign', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  const space = await ensureSpaceAccess(spaceId, req.user!);

  const { file_name, mime_type = 'application/octet-stream', file_size } = req.body as {
    file_name?: string; mime_type?: string; file_size?: number;
  };
  if (!file_name) throw new ApiError(400, 'file_name is required');
  if (typeof file_size === 'number' && file_size > DIRECT_UPLOAD_MAX) {
    throw new ApiError(413, `文件超过 ${DIRECT_UPLOAD_MAX / 1024 / 1024}MB 上限`);
  }

  const { safeName } = validateDeclaredUpload(file_name, mime_type);
  const path = `spaces/${space.course_id}/${spaceId}/${Date.now()}-${safeName}`;

  const { data, error } = await supabase.storage
    .from('note-chat-attachments')
    .createSignedUploadUrl(path);
  if (error) throw new ApiError(500, `签发上传地址失败：${error.message}`);

  res.json({ path: data.path, token: data.token, bucket: 'note-chat-attachments' });
});

router.post('/spaces/:spaceId/attachments/commit', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  const space = await ensureSpaceAccess(spaceId, req.user!);

  const { path, file_name, mime_type = 'application/octet-stream', extract_text } = req.body as {
    path?: string; file_name?: string; mime_type?: string; extract_text?: boolean;
  };
  if (!path || !file_name) throw new ApiError(400, 'path 和 file_name 是必填的');

  // 路径必须落在这个空间自己的前缀下，否则可以拿别处的对象来「认领」
  const prefix = `spaces/${space.course_id}/${spaceId}/`;
  if (!path.startsWith(prefix) || path.includes('..')) {
    throw new ApiError(400, '路径不属于这个知识空间。');
  }

  const drop = async () => {
    await supabase.storage.from('note-chat-attachments').remove([path]).catch(() => {});
  };

  const { data: publicData } = supabase.storage.from('note-chat-attachments').getPublicUrl(path);

  // 只取开头 512 字节做魔数校验。
  // 之前这里是 download() 整个文件 —— 传一个 140MB 的视频，服务器要把这
  // 140MB 全下回来再看头 12 个字节，慢，而且内存里凭空多出 140MB。
  // Content-Range 顺带把文件真实大小带回来了，不用再查一次。
  const head = await fetch(publicData.publicUrl, { headers: { Range: 'bytes=0-511' } });
  if (!head.ok && head.status !== 206) {
    await drop();
    throw new ApiError(400, '没有找到刚上传的文件。');
  }
  const headBuf = Buffer.from(await head.arrayBuffer());
  if (headBuf.length === 0) { await drop(); throw new ApiError(400, 'File is empty'); }

  const totalSize = Number(head.headers.get('content-range')?.split('/')[1])
    || Number(head.headers.get('content-length'))
    || headBuf.length;
  if (totalSize > DIRECT_UPLOAD_MAX) {
    await drop();
    throw new ApiError(413, `文件超过 ${DIRECT_UPLOAD_MAX / 1024 / 1024}MB 上限`);
  }

  try {
    verifyStoredBytes(headBuf, mime_type);
  } catch (e) {
    await drop();
    throw e;
  }

  // 只有要抽正文时才把整个文件拉回来，而且只对文档类型 —— 视频没有正文可抽，
  // 为它下载一整份纯属浪费。
  const extracted = extract_text && canExtractText(mime_type, file_name)
    ? await (async () => {
      const { data: blob } = await supabase.storage.from('note-chat-attachments').download(path);
      return blob ? extractDocumentText(Buffer.from(await blob.arrayBuffer()), mime_type, file_name) : null;
    })()
    : null;

  res.status(201).json({
    attachment: {
      file_url: publicData.publicUrl,
      file_name,
      mime_type,
      file_size: totalSize,
    },
    text: extracted?.text ?? null,
    textTruncated: extracted?.truncated ?? false,
    textSource: extracted?.source ?? null,
  });
});

router.post('/spaces/:spaceId/attachments', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  const space = await ensureSpaceAccess(spaceId, req.user!);

  const { file_name, mime_type = 'application/octet-stream', data_url } = req.body as {
    file_name?: string;
    mime_type?: string;
    data_url?: string;
  };
  if (!file_name || !data_url) throw new ApiError(400, 'file_name and data_url are required');

  // 校验走共用的那一套 —— 求助截图另开了一条上传路径，两条必须同源，
  // 否则新的那条迟早比老的松，而松的那条就是入口。
  const { buffer, safeName } = validateUpload(data_url, file_name, mime_type);
  const path = `spaces/${space.course_id}/${spaceId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from('note-chat-attachments')
    .upload(path, buffer, { contentType: mime_type, upsert: false });
  if (uploadError) throw new ApiError(500, uploadError.message);

  const { data: publicData } = supabase.storage.from('note-chat-attachments').getPublicUrl(path);

  // 只有请求方明确要（给 AI 看的那条路）才解析。画布贴图也走这个接口，
  // 没必要为它跑一遍 PDF 解析。
  const wantsText = Boolean((req.body as any)?.extract_text);
  const extracted = wantsText && canExtractText(mime_type, file_name)
    ? await extractDocumentText(buffer, mime_type, file_name)
    : null;

  res.status(201).json({
    attachment: {
      file_url: publicData.publicUrl,
      file_name,
      mime_type,
      file_size: buffer.length,
    },
    text: extracted?.text ?? null,
    textTruncated: extracted?.truncated ?? false,
    textSource: extracted?.source ?? null,
  });
});

// POST /api/spaces/:spaceId/notes
router.post('/spaces/:spaceId/notes', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  const {
    type = 'note',
    title,
    content,
    summary,
    x = 0,
    y = 0,
    width,
    height,
    views,
    tags,
    cited_note_ids,
    rise_above_data,
    file_url,
    file_name,
    mime_type,
    drawing_data,
    epistemic_status,
    inquiry_question,
    promising_reason,
    knowledge_lacks,
    scaffold_id,
    scaffold_responses,
  } = req.body;

  if (!title) throw new ApiError(400, 'title is required');
  if (!NOTE_TYPES.includes(type)) throw new ApiError(400, `Invalid note type: ${type}`);
  if (epistemic_status && !VALID_EPISTEMIC_STATUSES.includes(epistemic_status)) {
    throw new ApiError(400, `Invalid epistemic_status: ${epistemic_status}`);
  }
  const space = await ensureSpaceAccess(spaceId, req.user!);

  // Experiment mode: participants may only post in group-bound spaces, keeping
  // treatment/control activity out of shared spaces (contamination control).
  // Participant goes by course standing: a teacher account that joined with the
  // student code is one too; only course staff may still post in shared spaces.
  if (!space.group_id && !isCourseStaff(space.standing)) {
    const experimentMode = await fetchExperimentMode(space.course_id);
    if (experimentMode) {
      throw new ApiError(403, '实验模式:请在你的小组空间发布笔记 / Experiment mode: please post in your group space');
    }
  }

  // 附件、画图笔记没有正文，保持 null；其余一律消毒后入库，并按入库的样子切分
  const safeContent = content == null ? content : await sanitizeNoteHtml(String(content));
  const created = segmentNoteContent(safeContent ?? '');

  const { data: note, error } = await supabase
    .from('notes')
    .insert({
      space_id: spaceId,
      author_id: req.user!.id,
      type,
      title,
      content: safeContent,
      content_segments: created.segments,
      segment_stats: created.stats,
      summary,
      x,
      y,
      width,
      height,
      views: views ?? [],
      tags: tags ?? [],
      cited_note_ids: cited_note_ids ?? [],
      rise_above_data,
      file_url,
      file_name,
      mime_type,
      drawing_data,
      epistemic_status: epistemic_status ?? 'standard',
      inquiry_question: optionalString(inquiry_question, 'inquiry_question'),
      promising_reason: optionalString(promising_reason, 'promising_reason'),
      knowledge_lacks: parseKnowledgeLacks(knowledge_lacks) ?? [],
      scaffold_id,
      scaffold_responses,
    })
    .select('*, users!author_id(id, name, email, avatar)')
    .single();

  if (error) throw new ApiError(500, error.message);

  // Initialize metrics for the new note
  await supabase.from('note_metrics_realtime').insert({
    note_id: note.id,
    direct_in_degree: 0,
    direct_out_degree: 0,
    build_on_count: 0,
    unique_contributor_count: 0,
    revision_count: 0,
    challenge_count: 0,
    evidence_count: 0,
    synthesis_count: 0,
    recent_activity_score: 0,
    heat_score: 0,
  });

  // Log the event
  const wordCount = (safeContent ?? '').split(/\s+/).filter(Boolean).length;
  await supabase.from('events').insert({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'note_created',
    object_type: 'note',
    object_id: note.id,
    space_id: spaceId,
    metadata_json: { type, scaffold_id: scaffold_id ?? null, word_count: wordCount },
  });

  const [expandedNote] = await expandNotes([note as Record<string, unknown>]);
  res.status(201).json({ note: expandedNote });

  // 上传即解析：附件一落库就在后台走一遍解析并进课程知识库。
  // 放在响应之后、不 await —— MinerU 一份论文要几十秒，学生不该等着。
  // 等他真正打开这份文档时，正文多半已经就绪。
  if (type === 'attachment' && (note as any)?.file_url) {
    scheduleKbIngest(String((note as any).id));
  }
});

// POST /api/notes/:sourceNoteId/ai-selections/publish-note
// Publish a selected AI assistant excerpt as a new public Note with student adoption provenance.
router.post('/notes/:sourceNoteId/ai-selections/publish-note', verifyJWT, async (req: Request, res: Response) => {
  const sourceNoteId = String(req.params.sourceNoteId);
  const sourceNoteAccess = await ensureNoteAccess(sourceNoteId, req.user!);
  const space = await ensureSpaceAccess(sourceNoteAccess.space_id, req.user!);

  if (!space.group_id && !isCourseStaff(space.standing)) {
    const experimentMode = await fetchExperimentMode(space.course_id);
    if (experimentMode) {
      throw new ApiError(403, '实验模式:请在你的小组空间发布笔记 / Experiment mode: please post in your group space');
    }
  }

  const {
    title,
    selected_text,
    adoption_reason,
    relation_type = 'extend',
    source_conversation_id,
    source_message_id,
    provider_id,
    model,
    persona_id,
    view_id,
    scaffold_id,
  } = req.body as Record<string, unknown>;

  const selectedText = optionalString(selected_text, 'selected_text');
  const adoptionReason = optionalString(adoption_reason, 'adoption_reason');
  const relationType = optionalString(relation_type, 'relation_type') ?? 'extend';
  if (!selectedText) throw new ApiError(400, 'selected_text is required');
  if (selectedText.length > 12000) throw new ApiError(400, 'selected_text is too long');
  if (!adoptionReason) throw new ApiError(400, 'adoption_reason is required');
  if (adoptionReason.length > 2000) throw new ApiError(400, 'adoption_reason is too long');
  if (!VALID_RELATION_TYPES.includes(relationType as RelationType)) {
    throw new ApiError(400, `Invalid relation_type. Must be one of: ${VALID_RELATION_TYPES.join(', ')}`);
  }

  const { data: sourceNote, error: sourceError } = await supabase
    .from('notes')
    .select('id, space_id, title, x, y, width, height')
    .eq('id', sourceNoteId)
    .is('deleted_at', null)
    .single();
  if (sourceError || !sourceNote) throw new ApiError(404, 'Source note not found');

  let finalConversationId = optionalString(source_conversation_id, 'source_conversation_id');
  let finalProviderId = optionalString(provider_id, 'provider_id');
  let finalModel = optionalString(model, 'model');
  const currentViewId = optionalString(view_id, 'view_id');
  const finalSourceMessageId = optionalString(source_message_id, 'source_message_id');
  const finalPersonaId = optionalString(persona_id, 'persona_id');

  // AI 摘录发布成笔记，要挂一条 GenAI 支架说明这段东西算什么。
  // 支架必须是全局的或本课程的，避免拿别的课的支架 id 试探。
  const scaffoldId = optionalString(scaffold_id, 'scaffold_id');
  let adoptionScaffold: { id: string; title: string; title_en: string | null } | null = null;
  if (scaffoldId) {
    const { data: row } = await supabase
      .from('scaffolds')
      .select('id, title, title_en, course_id')
      .eq('id', scaffoldId)
      .maybeSingle();
    if (!row || (row.course_id && row.course_id !== space.course_id)) {
      throw new ApiError(400, 'scaffold_id is invalid');
    }
    adoptionScaffold = { id: row.id as string, title: row.title as string, title_en: (row.title_en as string) ?? null };
  }

  if (finalSourceMessageId) {
    const { data: message, error: messageError } = await supabase
      .from('note_conversation_messages')
      .select('id, thread_id, sender_kind, ai_metadata')
      .eq('id', finalSourceMessageId)
      .single();
    if (messageError || !message) throw new ApiError(400, 'source_message_id is invalid');
    if (message.sender_kind !== 'assistant') throw new ApiError(400, 'source_message_id must point to an assistant message');

    const { data: thread, error: threadError } = await supabase
      .from('note_conversation_threads')
      .select('id, note_id, space_id, course_id')
      .eq('id', message.thread_id)
      .single();
    if (threadError || !thread) throw new ApiError(400, 'source conversation is invalid');
    if (thread.note_id !== sourceNoteId || thread.space_id !== sourceNoteAccess.space_id || thread.course_id !== space.course_id) {
      throw new ApiError(400, 'source message does not belong to this source note');
    }
    finalConversationId = thread.id as string;
    const aiMetadata = (message.ai_metadata ?? {}) as Record<string, unknown>;
    finalProviderId = finalProviderId ?? textValue(aiMetadata.provider_id);
    finalModel = finalModel ?? textValue(aiMetadata.model);
  }

  if (finalConversationId && !finalSourceMessageId) {
    const { data: thread, error: threadError } = await supabase
      .from('note_conversation_threads')
      .select('id, note_id, space_id, course_id')
      .eq('id', finalConversationId)
      .single();
    if (threadError || !thread) throw new ApiError(400, 'source_conversation_id is invalid');
    if (thread.note_id !== sourceNoteId || thread.space_id !== sourceNoteAccess.space_id || thread.course_id !== space.course_id) {
      throw new ApiError(400, 'source conversation does not belong to this source note');
    }
  }

  const sourceX = typeof sourceNote.x === 'number' ? sourceNote.x : 0;
  const sourceY = typeof sourceNote.y === 'number' ? sourceNote.y : 0;
  const sourceWidth = typeof sourceNote.width === 'number' ? sourceNote.width : 184;
  const noteTitle = makeAiPartnerNoteTitle(selectedText, title);
  const scaffoldTag = adoptionScaffold?.title ?? adoptionScaffold?.title_en ?? '';
  const noteContent = await sanitizeNoteHtml(aiPartnerPublicationHtml({
    selectedText,
    adoptionReason,
    scaffold: adoptionScaffold ? { id: adoptionScaffold.id, title: scaffoldTag } : null,
  }));

  const publishedSegments = segmentNoteContent(noteContent);

  const { data: note, error: noteError } = await supabase
    .from('notes')
    .insert({
      space_id: sourceNoteAccess.space_id,
      author_id: req.user!.id,
      type: 'note',
      title: noteTitle,
      content: noteContent,
      content_segments: publishedSegments.segments,
      segment_stats: publishedSegments.stats,
      x: sourceX + sourceWidth + 48,
      y: sourceY + 48,
      width: 220,
      height: 150,
      tags: ['AI Partner'],
      views: currentViewId ? [currentViewId] : [],
      cited_note_ids: [sourceNoteId],
      epistemic_status: 'promising',
      promising_reason: adoptionReason,
      knowledge_lacks: [],
      is_ai_generated: true,
      ai_trigger_type: 'ai_partner_publication',
      ai_adoption_scaffold_id: adoptionScaffold?.id ?? null,
    })
    .select('*, users!author_id(id, name, email, avatar), note_metrics_realtime(*)')
    .single();
  if (noteError) throw new ApiError(500, noteError.message);

  await supabase.from('note_metrics_realtime').insert({
    note_id: note.id,
    direct_in_degree: 0,
    direct_out_degree: 0,
    build_on_count: 0,
    unique_contributor_count: 0,
    revision_count: 0,
    challenge_count: 0,
    evidence_count: 0,
    synthesis_count: 0,
    recent_activity_score: 0,
    heat_score: 0,
  });

  const { data: relation, error: relationError } = await supabase
    .from('relations')
    .insert({
      source_note_id: note.id,
      target_note_id: sourceNoteId,
      relation_type: relationType,
      creator_id: req.user!.id,
      space_id: sourceNoteAccess.space_id,
      ai_suggested: false,
      ai_accepted: true,
    })
    .select('*, users!creator_id(name)')
    .single();
  if (relationError) {
    await supabase.from('notes').delete().eq('id', note.id);
    throw new ApiError(500, relationError.message);
  }

  await supabase.from('relation_aggregates').insert({
    relation_id: relation.id,
    occurrence_count: 1,
    repeated_uptake_count: 0,
    latest_activity_at: new Date().toISOString(),
    cached_strength_score: 1.0,
  });

  await updateRelationMetricsForAiPublication(note.id as string, sourceNoteId, relationType, req.user!.id);

  const provenancePayload = {
    note_id: note.id,
    source_note_id: sourceNoteId,
    relation_id: relation.id,
    space_id: sourceNoteAccess.space_id,
    course_id: space.course_id,
    published_by_user_id: req.user!.id,
    source_conversation_id: finalConversationId,
    source_message_id: finalSourceMessageId,
    provider_id: finalProviderId,
    model: finalModel,
    persona_id: finalPersonaId,
    selected_text: selectedText,
    adoption_reason: adoptionReason,
    relation_type: relationType,
  };
  const { data: publication } = await supabase
    .from('ai_partner_note_publications')
    .insert(provenancePayload)
    .select()
    .single();

  await supabase.from('events').insert({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'ai_partner_note_published',
    object_type: 'note',
    object_id: note.id,
    space_id: sourceNoteAccess.space_id,
    target_note_id: sourceNoteId,
    metadata_json: {
      relation_id: relation.id,
      relation_type: relationType,
      source_conversation_id: finalConversationId ?? null,
      source_message_id: finalSourceMessageId ?? null,
      provider_id: finalProviderId ?? null,
      model: finalModel ?? null,
      persona_id: finalPersonaId ?? null,
      selected_text_preview: selectedText.slice(0, 240),
      adoption_reason: adoptionReason,
      publication_id: publication?.id ?? null,
    },
  });

  const [expandedNote] = await expandNotes([note as Record<string, unknown>]);
  res.status(201).json({
    note: expandedNote,
    relation: {
      id: relation.id,
      space_id: relation.space_id,
      source_note_id: relation.source_note_id,
      target_note_id: relation.target_note_id,
      relation_type: relation.relation_type ?? 'extend',
      creator_id: relation.creator_id,
      ai_suggested: relation.ai_suggested ?? false,
      ai_accepted: relation.ai_accepted,
      created_at: relation.created_at,
      users: relation.users ? { name: (relation.users as Record<string, unknown>).name ?? '' } : undefined,
    },
    publication: publication ?? null,
  });
});

// PUT /api/notes/:id
router.put('/notes/:id', verifyJWT, async (req: Request, res: Response) => {
  const id = String(req.params.id);

  const existing = await ensureNoteAccess(id, req.user!);

  // Only the author or course staff can edit — a teacher account that is only
  // a member of this course cannot rewrite classmates' notes.
  if (existing.author_id !== req.user!.id && !isCourseStaff(existing.standing)) {
    throw new ApiError(403, 'Only the author can edit this note');
  }

  const {
    title,
    content,
    summary,
    x,
    y,
    width,
    height,
    views,
    tags,
    cited_note_ids,
    rise_above_data,
    drawing_data,
    file_url,
    file_name,
    mime_type,
    epistemic_status,
    inquiry_question,
    promising_reason,
    knowledge_lacks,
    change_summary,
    metadata,
  } = req.body;

  // 与新建同一规则：null 保持 null，其余消毒后入库。下面比较、切分、嵌入都用消毒后的版本
  const safeContent = content == null ? content : await sanitizeNoteHtml(String(content));

  // Check if content or title changed for revision tracking
  const needsRevision =
    (title && title !== existing.title) || (safeContent && safeContent !== existing.content);

  // Prepare update object
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) updateData.title = title;
  if (content !== undefined) updateData.content = safeContent;
  if (summary !== undefined) updateData.summary = summary;
  if (x !== undefined) updateData.x = x;
  if (y !== undefined) updateData.y = y;
  if (width !== undefined) updateData.width = width;
  if (height !== undefined) updateData.height = height;
  // 新客户端不经这里写 metadata（版式走 /presentation，Markdown 新版本走 /markdown-versions）。
  // 还没刷新的网页和旧 iOS 包会带着整块 metadata 来：不再整块写，下面按键合并。
  const metadataPatch = metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : undefined;
  if (views !== undefined) updateData.views = views;
  if (tags !== undefined) updateData.tags = tags;
  if (cited_note_ids !== undefined) updateData.cited_note_ids = cited_note_ids;
  if (rise_above_data !== undefined) updateData.rise_above_data = rise_above_data;
  if (drawing_data !== undefined) updateData.drawing_data = drawing_data;
  if (file_url !== undefined) updateData.file_url = file_url;
  if (file_name !== undefined) updateData.file_name = file_name;
  if (mime_type !== undefined) updateData.mime_type = mime_type;
  if (epistemic_status !== undefined) {
    if (!VALID_EPISTEMIC_STATUSES.includes(epistemic_status)) {
      throw new ApiError(400, `Invalid epistemic_status: ${epistemic_status}`);
    }
    updateData.epistemic_status = epistemic_status;
  }
  if (inquiry_question !== undefined) updateData.inquiry_question = optionalString(inquiry_question, 'inquiry_question');
  if (promising_reason !== undefined) updateData.promising_reason = optionalString(promising_reason, 'promising_reason');
  if (knowledge_lacks !== undefined) updateData.knowledge_lacks = parseKnowledgeLacks(knowledge_lacks);

  // 正文变了就重算来源分层，研究导出直接读这两列
  if (content !== undefined) {
    const { segments, stats } = segmentNoteContent(safeContent ?? '');
    updateData.content_segments = segments;
    updateData.segment_stats = stats;
  }

  const returning = '*, users!author_id(id, name, email, avatar), note_metrics_realtime(*)';
  let updated: unknown;
  if (file_url !== undefined || metadataPatch) {
    let replacedMarkdown = false;
    // 换文件、改 metadata 都以读到的旧值为条件写，否则会冲掉读和写之间别人的改动
    await updateNoteGuarded(id, row => {
      const fileChanged = file_url !== undefined && (file_url ?? null) !== row.file_url;
      // 回调在并发时会重跑，以最后真正写进去的那一次为准
      replacedMarkdown = fileChanged && isMarkdownFile(mime_type ?? row.mime_type, file_name ?? row.file_name);
      if (fileChanged) {
        // 旧版的 Markdown 保存：捎带的 metadata 是打开阅读器那一刻的，不写回；换下来的地址由服务端记
        return replacedMarkdown
          ? { ...updateData, metadata: withMdVersion(row.metadata, row.file_url, req.user!.id) }
          : updateData;
      }
      return metadataPatch
        ? { ...updateData, metadata: mergeClientMetadata(row.metadata, metadataPatch) }
        : updateData;
    });
    // 同新接口：缓存的正文和知识库还是旧文件的，后台按新文件重算
    if (replacedMarkdown) void scheduleKbRefresh(id);
    const { data, error } = await supabase.from('notes').select(returning).eq('id', id).single();
    if (error) throw new ApiError(500, error.message);
    updated = data;
  } else {
    const { data, error: updateError } = await supabase
      .from('notes')
      .update(updateData)
      .eq('id', id)
      .select(returning)
      .single();
    if (updateError) throw new ApiError(500, updateError.message);
    updated = data;
  }

  // Create revision if content/title changed
  if (needsRevision) {
    // Get current revision number
    const { data: currentRev } = await supabase
      .from('note_revisions')
      .select('revision_number')
      .eq('note_id', id)
      .order('revision_number', { ascending: false })
      .limit(1)
      .single();

    const nextRev = (currentRev?.revision_number ?? 0) + 1;

    await supabase.from('note_revisions').insert({
      note_id: id,
      revision_number: nextRev,
      title: existing.title,
      content: existing.content,
      editor_id: req.user!.id,
      change_summary: change_summary ?? 'Note updated',
    });

    // Update revision count metric and recalculate heat score
    await supabase.rpc('increment_note_metric', {
      p_note_id: id,
      p_field: 'revision_count',
    });
    await updateHeatScore(id as string);

    // Log note_updated event
    const oldWordCount = (existing.content ?? '').split(/\s+/).filter(Boolean).length;
    const newWordCount = (safeContent ?? existing.content ?? '').split(/\s+/).filter(Boolean).length;
    await supabase.from('events').insert({
      actor_id: req.user!.id,
      actor_role: req.user!.role,
      event_type: 'note_updated',
      object_type: 'note',
      object_id: id,
      space_id: existing.space_id,
      metadata_json: { revision_number: nextRev, word_diff: newWordCount - oldWordCount },
    });

    // Generate embedding for semantic search
    if (safeContent && safeContent !== existing.content) {
      const { data: space } = await supabase
        .from('spaces')
        .select('course_id')
        .eq('id', existing.space_id)
        .single();
      if (space?.course_id) {
        embedNote(id, space.course_id, safeContent).catch(() => {});
      }
    }
  }

  const [expandedNote] = await expandNotes([updated as Record<string, unknown>]);
  res.json({ note: expandedNote });
});

// DELETE /api/notes/:id (soft delete)
router.delete('/notes/:id', verifyJWT, async (req: Request, res: Response) => {
  const noteId = String(req.params.id);
  const existing = await ensureNoteAccess(noteId, req.user!);

  if (existing.author_id !== req.user!.id && !isCourseStaff(existing.standing)) {
    throw new ApiError(403, 'Insufficient permissions');
  }

  // Soft delete
  const { error } = await supabase
    .from('notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', noteId);

  if (error) throw new ApiError(500, error.message);

  // 附件进过课程知识库，软删除不会级联过去，后台那几轮见笔记已删也只是直接返回：
  // 这里不清，AI 检索还会把删掉的附件念出来。和下面记事件一起发，不多等一次往返；
  // 清理失败只记日志，笔记已经删了
  const leavingKb = dropNoteFromKb(noteId).catch((err: any) =>
    console.error('[KB] drop deleted note failed:', noteId, err?.message));

  // Log note_deleted event
  await supabase.from('events').insert({
    actor_id: req.user!.id,
    actor_role: req.user!.role,
    event_type: 'note_deleted',
    object_type: 'note',
    object_id: noteId,
    space_id: existing.space_id,
    metadata_json: {},
  });
  await leavingKb;

  res.json({ message: 'Note deleted' });
});

/**
 * PATCH /api/notes/:id/position —— 位置与尺寸。
 *
 * 权限只到「这个空间的成员」，不再要求是作者。
 * 摆放位置是**共享画布的布局**，不是笔记内容：把相关的想法聚到一起、
 * 给一簇观点腾地方，本来就是知识建构里大家共同做的事。
 * 之前限制成作者+教师，学生一拖别人的卡就 403，而前端把错误吞掉，
 * 表现出来就是「拖过去、过一会自己弹回原位」，谁也不知道为什么。
 *
 * 笔记的**内容**仍然只有作者能改（见 PUT /notes/:id），这里放开的只是坐标。
 * 空间成员资格由 ensureNoteAccess 把关，小组隔离照旧生效。
 */
router.patch('/notes/:id/position', verifyJWT, async (req: Request, res: Response) => {
  const { x, y, width, height } = req.body;
  if (x === undefined || y === undefined) throw new ApiError(400, 'x and y required');

  const noteId = String(req.params.id);
  await ensureNoteAccess(noteId, req.user!);

  /** 卡片尺寸的合法范围：低于下限文字读不了，高于上限一张卡能盖住整块画布。 */
  const size = (value: unknown, min: number, max: number): number | undefined => {
    if (value === undefined) return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    return Math.round(Math.min(max, Math.max(min, n)));
  };

  const updates: Record<string, unknown> = { x, y };
  const w = size(width, 120, 1600);
  const h = size(height, 72, 1600);
  if (w !== undefined) updates.width = w;
  if (h !== undefined) updates.height = h;

  const { error } = await supabase
    .from('notes')
    .update(updates)
    .eq('id', noteId);

  if (error) throw new ApiError(500, error.message);
  res.json({ ok: true });
});

/**
 * PATCH /api/notes/:id/presentation —— 固定，图片 / 视频附件显示成图还是条目。
 *
 * 和 /position 同一个口径：这是共享画布的版式，空间成员都能改，小组隔离由 ensureNoteAccess 把关。
 * 之前这两项走作者专用的 PUT /notes/:id，右键菜单却对所有人显示：
 * 同学点了只改了本地，403 被前端吞掉，刷新后又回到原样。
 *
 * 只合并传来的键，不整块写 metadata：客户端手里的 metadata 可能是几分钟前的，
 * 整块写回会冲掉别人刚改的另一个键。
 */
router.patch('/notes/:id/presentation', verifyJWT, async (req: Request, res: Response) => {
  const patch = parsePresentationPatch(req.body);
  const noteId = String(req.params.id);
  await ensureNoteAccess(noteId, req.user!);
  const metadata = await mergeNoteMetadata(noteId, patch);
  res.json({ metadata });
});

/**
 * POST /api/notes/:id/markdown-versions —— 文档查看器里编辑 Markdown 附件后点「保存」。
 *
 * 存成新文件再把附件指过去，不覆盖原文件：那个链接可能已经嵌在别人的笔记里、被引用过。
 * 换下来的地址由服务端记进 metadata.mdVersions。以前是前端拿打开阅读器时的整块 metadata
 * 加上新列表经 PUT 写回：这期间同学固定了这张卡，或者另一个人也存了一版，都会被冲掉。
 *
 * base_file_url 是打开文档时的文件地址，和当前地址不同就是编辑期间有人存过新版本，报 409。
 * 只有作者和课程教师能存（同 PUT）。先查权限、再上传，被拒的人不会在存储里留下文件。
 */
router.post('/notes/:id/markdown-versions', verifyJWT, async (req: Request, res: Response) => {
  const noteId = String(req.params.id);
  const existing = await ensureNoteAccess(noteId, req.user!);
  if (existing.author_id !== req.user!.id && !isCourseStaff(existing.standing)) {
    throw new ApiError(403, 'Only the author can edit this note');
  }

  const { data_url, file_name, base_file_url } = req.body as {
    data_url?: unknown; file_name?: unknown; base_file_url?: unknown;
  };
  if (typeof data_url !== 'string') throw new ApiError(400, 'data_url is required');
  if (base_file_url !== undefined && base_file_url !== null && typeof base_file_url !== 'string') {
    throw new ApiError(400, 'base_file_url must be a string');
  }
  const baseFileUrl = base_file_url as string | null | undefined;

  const { data: current, error } = await supabase
    .from('notes')
    .select('file_url, file_name, mime_type')
    .eq('id', noteId)
    .single();
  if (error || !current) throw new ApiError(404, 'Note not found');
  if (!isMarkdownFile(current.mime_type, current.file_name)) {
    throw new ApiError(400, 'Only Markdown attachments can be saved as a new version');
  }
  // 上传之前先比一次，冲突时不留下文件。写的时候 replaceMarkdownFile 还会再比
  if (baseFileUrl !== undefined && baseFileUrl !== (current.file_url ?? null)) {
    throw new ApiError(409, MARKDOWN_CONFLICT_MESSAGE);
  }

  const fileName = textValue(file_name) ?? textValue(current.file_name) ?? 'document.md';
  // 校验和画布附件上传是同一套（validateUpload）
  const { buffer, safeName } = validateUpload(data_url, fileName, 'text/markdown');
  const path = `spaces/${existing.course_id}/${existing.space_id}/${Date.now()}-${safeName}`;
  const bucket = supabase.storage.from('note-chat-attachments');
  const { error: uploadError } = await bucket.upload(path, buffer, { contentType: 'text/markdown', upsert: false });
  if (uploadError) throw new ApiError(500, uploadError.message);
  const { data: publicData } = bucket.getPublicUrl(path);

  const file = { file_url: publicData.publicUrl, file_name: fileName, mime_type: 'text/markdown' };
  let metadata: Record<string, unknown>;
  try {
    metadata = await replaceMarkdownFile(noteId, file, req.user!.id, baseFileUrl);
  } catch (err) {
    // 没换上去的新文件没有人引用，删掉
    await bucket.remove([path]).catch(() => {});
    throw err;
  }
  // 缓存的正文和知识库里的片段都是按旧文件算的：后台按新文件重算、重新入库，
  // 空间 AI 才检索得到这一版。出错只记日志，这次保存照样成功
  void scheduleKbRefresh(noteId);
  res.json({ ...file, metadata });
});

async function updateRelationMetricsForAiPublication(
  sourceId: string,
  targetId: string,
  relationType: string,
  creatorId: string,
) {
  await supabase.rpc('increment_note_metric', {
    p_note_id: sourceId,
    p_field: 'direct_out_degree',
  });
  await supabase.rpc('increment_note_metric', {
    p_note_id: targetId,
    p_field: 'direct_in_degree',
  });
  await supabase.rpc('increment_note_metric', {
    p_note_id: targetId,
    p_field: 'build_on_count',
  });

  const typeFieldMap: Record<string, string> = {
    extend: 'extend_count',
    clarify: 'clarify_count',
    question: 'question_count',
    challenge: 'challenge_count',
    evidence: 'evidence_count',
    synthesize: 'synthesis_count',
  };
  const metricField = typeFieldMap[relationType];
  if (metricField) {
    await supabase.rpc('increment_note_metric', {
      p_note_id: targetId,
      p_field: metricField,
    });
  }
  if (relationType === 'challenge') {
    await supabase.rpc('increment_note_metric', {
      p_note_id: targetId,
      p_field: 'unresolved_challenges',
    });
  }

  const { data: contributors } = await supabase
    .from('relations')
    .select('creator_id')
    .eq('target_note_id', targetId);

  const uniqueCreators = new Set((contributors ?? []).map((row) => row.creator_id));
  uniqueCreators.add(creatorId);
  await supabase
    .from('note_metrics_realtime')
    .update({ unique_contributor_count: uniqueCreators.size, updated_at: new Date().toISOString() })
    .eq('note_id', targetId);

  await Promise.all([updateHeatScore(sourceId), updateHeatScore(targetId)]);
}

export default router;
