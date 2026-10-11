/**
 * 「AI 记得什么」（2026-10-11 第四步）：学生看、删、关自己在这门课里的 AI 记忆。只读写自己的。
 * 删掉的直接删行；研究只在 events 里记删了几条、什么类型，不留内容。
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureCourseMember, ensureNoteAccess } from '../services/accessControl';
import { logEvent } from '../services/eventService';
import {
  clearMemories,
  deleteMemory,
  importEpisodeText,
  isMemoryEnabled,
  listMemories,
  recordEpisode,
  setMemoryEnabled,
  type StudentMemory,
} from '../services/studentMemory';

const router = Router();

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

function toApi(m: StudentMemory) {
  return { id: m.id, kind: m.kind, type: m.type, content: m.content, createdAt: m.createdAt, updatedAt: m.updatedAt, lastUsedAt: m.lastUsedAt };
}

/** 这段对话里 AI 记着的要点（conversation_memory）：只给自己的、没删的对话 */
async function conversationSummary(userId: string, courseId: string, surface: unknown, conversationId: unknown) {
  if (!isUuid(conversationId)) return null;
  const query = surface === 'note'
    ? supabase.from('note_conversation_threads').select('conversation_memory')
      .eq('id', conversationId).eq('created_by', userId).eq('course_id', courseId).eq('target_type', 'ai').is('deleted_at', null)
    : supabase.from('agent_conversations').select('conversation_memory')
      .eq('id', conversationId).eq('user_id', userId).eq('course_id', courseId).is('deleted_at', null);
  const { data } = await query.maybeSingle();
  const memory = (data as { conversation_memory?: { summary?: unknown; updatedAt?: unknown } } | null)?.conversation_memory;
  return typeof memory?.summary === 'string' && memory.summary.trim()
    ? { summary: memory.summary, updatedAt: typeof memory.updatedAt === 'string' ? memory.updatedAt : null }
    : null;
}

router.get('/memory/:courseId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseMember(courseId, req.user!);
  const userId = req.user!.id;
  const [enabled, memories, profileRow, conversation] = await Promise.all([
    isMemoryEnabled(userId, courseId),
    listMemories(userId, courseId),
    supabase.from('learner_profiles').select('scaffolding_level, interaction_count').eq('user_id', userId).eq('course_id', courseId).maybeSingle(),
    conversationSummary(userId, courseId, req.query.surface, req.query.conversation_id),
  ]);
  const p = profileRow.data as { scaffolding_level?: string; interaction_count?: number } | null;
  res.json({
    enabled,
    scaffolding: p?.scaffolding_level ? { level: p.scaffolding_level, interactions: p.interaction_count ?? 0 } : null,
    profile: memories.profile.map(toApi),
    episodes: memories.episodes.map(toApi),
    conversation,
  });
});

router.delete('/memory/item/:id', verifyJWT, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) throw new ApiError(400, 'memory id is required');
  const result = await deleteMemory(req.user!.id, id);
  if (!result.deleted) throw new ApiError(404, 'Memory not found');
  logEvent({
    actor_id: req.user!.id, actor_role: req.user!.role, event_type: 'memory_deleted', object_type: 'student_memory', object_id: id,
    metadata_json: { kind: result.kind, type: result.type, course_id: result.courseId },
  });
  res.json({ ok: true });
});

router.post('/memory/:courseId/clear', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseMember(courseId, req.user!);
  const kind = (req.body ?? {}).kind;
  if (kind !== 'profile' && kind !== 'episode' && kind !== 'all') throw new ApiError(400, 'kind must be profile, episode or all');
  const removed = await clearMemories(req.user!.id, courseId, kind);
  logEvent({
    actor_id: req.user!.id, actor_role: req.user!.role, event_type: 'memory_cleared', object_type: 'course', object_id: courseId,
    metadata_json: { kind, removed },
  });
  res.json({ ok: true, removed });
});

router.put('/memory/:courseId/settings', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseMember(courseId, req.user!);
  const enabled = (req.body ?? {}).enabled;
  if (typeof enabled !== 'boolean') throw new ApiError(400, 'enabled must be true or false');
  await setMemoryEnabled(req.user!.id, courseId, enabled);
  logEvent({
    actor_id: req.user!.id, actor_role: req.user!.role, event_type: 'memory_toggled', object_type: 'course', object_id: courseId,
    metadata_json: { enabled },
  });
  res.json({ ok: true, enabled });
});

/** 把智能体的回答导入了笔记：记一个关键时刻（网页挂到笔记由 artifacts 路由自己记） */
router.post('/memory/:courseId/imported', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseMember(courseId, req.user!);
  const noteId = (req.body ?? {}).note_id;
  if (!isUuid(noteId)) throw new ApiError(400, 'note_id is required');
  const note = await ensureNoteAccess(noteId, req.user!);
  if (note.course_id !== courseId) throw new ApiError(400, 'The note is in another course');
  const zh = (req.body ?? {}).lang !== 'en';
  await recordEpisode({
    userId: req.user!.id, courseId, type: 'imported',
    content: importEpisodeText('answer', String(note.title ?? ''), zh),
    source: { note_id: noteId, surface: 'workspace' },
  });
  res.json({ ok: true });
});

export default router;
