import { Router, Request, Response } from 'express';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { supabase } from '../config/supabase';
import {
  readMemories,
  writeMemory,
  deleteMemory,
  getTeacherContext,
  pruneMemories,
  type MemorySource,
  type MemoryType,
} from '../services/teacherMemoryService';

const router = Router();

const VALID_SOURCES = new Set<MemorySource>(['lesson_prep', 'analytics', 'assessment', 'chat']);
const VALID_TYPES = new Set<MemoryType>(['insight', 'decision', 'observation', 'plan', 'action']);

async function requireTeacherRole(courseId: string, req: Request) {
  const userId = req.user!.id;
  if (req.user!.role === 'admin') return;

  // course_members.role (migration 034) marks a co-teacher; the global
  // users.role must not stand in for it, or any teacher account that joined
  // the course could read and write this course's private teaching notes.
  const [memberRes, instructorRes] = await Promise.all([
    supabase
      .from('course_members')
      .select('role')
      .eq('course_id', courseId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('courses')
      .select('id')
      .eq('id', courseId)
      .eq('instructor_id', userId)
      .maybeSingle(),
  ]);

  if (instructorRes.data) return;
  const memberRole = (memberRes.data as { role?: string } | null)?.role;
  if (memberRole === 'teacher' || memberRole === 'admin') return;
  throw new ApiError(403, 'Teacher role required');
}

// GET /teacher-memory/:courseId — list memories
router.get('/teacher-memory/:courseId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacherRole(courseId, req);

  const source = req.query.source as MemorySource | undefined;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const memories = await readMemories({
    userId: req.user!.id,
    courseId,
    source: source && VALID_SOURCES.has(source) ? source : undefined,
    limit,
  });

  res.json({ memories });
});

// GET /teacher-memory/:courseId/context — aggregated cross-module context
router.get('/teacher-memory/:courseId/context', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacherRole(courseId, req);

  const excludeSource = req.query.exclude as MemorySource | undefined;
  const lang = (req.query.lang as 'zh' | 'en') ?? 'zh';

  const context = await getTeacherContext({
    userId: req.user!.id,
    courseId,
    excludeSource: excludeSource && VALID_SOURCES.has(excludeSource) ? excludeSource : undefined,
    lang,
  });

  res.json({ context });
});

// POST /teacher-memory/:courseId — write a memory
router.post('/teacher-memory/:courseId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacherRole(courseId, req);

  const { source, memory_type, content, metadata } = req.body as {
    source?: string;
    memory_type?: string;
    content?: string;
    metadata?: Record<string, unknown>;
  };

  if (!source || !VALID_SOURCES.has(source as MemorySource)) {
    throw new ApiError(400, 'Invalid source');
  }
  if (!memory_type || !VALID_TYPES.has(memory_type as MemoryType)) {
    throw new ApiError(400, 'Invalid memory_type');
  }
  if (!content?.trim()) {
    throw new ApiError(400, 'content is required');
  }

  const memory = await writeMemory({
    userId: req.user!.id,
    courseId,
    source: source as MemorySource,
    memoryType: memory_type as MemoryType,
    content,
    metadata,
  });

  if (!memory) {
    res.json({ memory: null, message: 'Duplicate or empty — skipped' });
    return;
  }
  res.json({ memory });
});

// DELETE /teacher-memory/:courseId/:memoryId
router.delete('/teacher-memory/:courseId/:memoryId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacherRole(courseId, req);

  const ok = await deleteMemory(req.user!.id, String(req.params.memoryId));
  if (!ok) throw new ApiError(500, 'Delete failed');
  res.json({ message: 'Deleted' });
});

// POST /teacher-memory/:courseId/prune — keep last 100
router.post('/teacher-memory/:courseId/prune', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacherRole(courseId, req);

  await pruneMemories(req.user!.id, courseId);
  res.json({ message: 'Pruned' });
});

export default router;
