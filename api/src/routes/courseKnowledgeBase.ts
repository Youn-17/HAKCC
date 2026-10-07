import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureCourseInstructor } from '../services/accessControl';
import { canExtractText } from '../services/documentText';
import { isIngestRunning, reparseMaterial } from '../services/kbIngest';
import { excerptOf } from '../services/kbSources';
import { invalidateKbPresence, kbDocumentCounts, searchKnowledgeBaseDetailed } from '../services/knowledgeBase';
import { lastPageOf } from '../services/pageMap';

/* Implementation notes are described in the public update guide. */
const router = Router();
const staffOnly = [verifyJWT, requireRole('teacher', 'admin')];

// PATCH /api/courses/:courseId/materials/:materialId/kb — 这份资料进不进 AI 检索。关掉只是检索不到，文件和片段都留着
router.patch('/courses/:courseId/materials/:materialId/kb', ...staffOnly, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') throw new ApiError(400, 'enabled must be a boolean');

  const { data, error } = await supabase
    .from('course_materials')
    .update({ kb_enabled: enabled })
    .eq('id', String(req.params.materialId))
    .eq('course_id', courseId)
    .select('id, kb_enabled')
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Material not found');
  invalidateKbPresence(courseId);
  res.json({ kbEnabled: data.kb_enabled });
});

// POST /api/courses/:courseId/materials/:materialId/reparse — 从头再读一遍、重新切片入库（见 reparseMaterial）
router.post('/courses/:courseId/materials/:materialId/reparse', ...staffOnly, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const materialId = String(req.params.materialId);

  const { data: material, error } = await supabase
    .from('course_materials')
    .select('id, mime_type, file_name')
    .eq('id', materialId)
    .eq('course_id', courseId)
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!material) throw new ApiError(404, 'Material not found');
  if (!canExtractText(material.mime_type ?? '', material.file_name ?? '')) {
    throw new ApiError(400, 'This file type is not added to the knowledge base');
  }
  if (isIngestRunning(materialId)) throw new ApiError(409, 'Still being read; try again when this pass finishes');

  await reparseMaterial(materialId);
  invalidateKbPresence(courseId);
  res.status(202).json({ state: 'processing' });
});

// PUT /api/courses/:courseId/kb/attachments — 知识空间里上传的附件进不进这门课的 AI 检索（整门课一个开关）
router.put('/courses/:courseId/kb/attachments', ...staffOnly, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') throw new ApiError(400, 'enabled must be a boolean');

  const { data, error } = await supabase
    .from('courses')
    .update({ kb_include_attachments: enabled })
    .eq('id', courseId)
    .select('id, kb_include_attachments')
    .maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Course not found');
  invalidateKbPresence(courseId);
  res.json({ includeAttachments: data.kb_include_attachments });
});

const RETRIEVAL_WINDOW_DAYS = 7;

// GET /api/courses/:courseId/kb/overview — 知识库概况：资料和附件各多少、向量齐不齐、最近被检索了几次、附件清单
router.get('/courses/:courseId/kb/overview', ...staffOnly, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const since = new Date(Date.now() - RETRIEVAL_WINDOW_DAYS * 24 * 3600_000).toISOString();

  const [courseRes, docsRes, materialsRes, logsRes, counts] = await Promise.all([
    supabase.from('courses').select('kb_include_attachments').eq('id', courseId).maybeSingle(),
    supabase
      .from('kb_documents')
      .select('id, title, status, material_id, note_id, space_id, text_source, updated_at')
      .eq('course_id', courseId),
    supabase.from('course_materials').select('id, kb_enabled').eq('course_id', courseId),
    supabase
      .from('kb_retrieval_logs')
      .select('source, created_at')
      .eq('course_id', courseId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000),
    kbDocumentCounts(courseId),
  ]);
  for (const r of [courseRes, docsRes, materialsRes, logsRes]) {
    if (r.error) throw new ApiError(500, r.error.message);
  }
  if (!courseRes.data) throw new ApiError(404, 'Course not found');

  const docs = (docsRes.data ?? []) as Array<Record<string, any>>;
  const enabledMaterials = new Set(((materialsRes.data ?? []) as Array<{ id: string; kb_enabled: boolean }>)
    .filter(m => m.kb_enabled !== false).map(m => m.id));
  const countOf = (docId: string) => counts.get(docId) ?? { chunks: 0, embedded: 0, pending: false };

  // 附件：只列没删的笔记，带上所在空间的名字和页数
  const attachmentDocs = docs.filter(d => d.note_id);
  const noteIds = attachmentDocs.map(d => d.note_id as string);
  const [notesRes, rendersRes] = noteIds.length
    ? await Promise.all([
      supabase.from('notes').select('id, title, space_id, deleted_at').in('id', noteIds),
      supabase.from('document_renders').select('note_id, page_map').in('note_id', noteIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (notesRes.error) throw new ApiError(500, notesRes.error.message);
  if (rendersRes.error) throw new ApiError(500, rendersRes.error.message);
  const liveNotes = new Map(((notesRes.data ?? []) as Array<Record<string, any>>)
    .filter(n => !n.deleted_at).map(n => [n.id as string, n]));
  const spaceIds = [...new Set([...liveNotes.values()].map(n => n.space_id as string).filter(Boolean))];
  const spacesRes = spaceIds.length
    ? await supabase.from('spaces').select('id, title').in('id', spaceIds)
    : { data: [], error: null };
  if (spacesRes.error) throw new ApiError(500, spacesRes.error.message);
  const spaceName = new Map(((spacesRes.data ?? []) as Array<{ id: string; title: string }>).map(s => [s.id, s.title]));
  const pagesOf = new Map(((rendersRes.data ?? []) as Array<{ note_id: string; page_map: unknown }>)
    .map(r => [r.note_id, lastPageOf(r.page_map)]));

  const attachments = attachmentDocs
    .filter(d => liveNotes.has(d.note_id))
    .map(d => {
      const note = liveNotes.get(d.note_id)!;
      const c = countOf(d.id);
      return {
        noteId: d.note_id as string,
        title: (d.title as string) || (note.title as string) || '',
        spaceName: spaceName.get(note.space_id) ?? null,
        status: d.status as string,
        chunks: c.chunks,
        embedded: c.embedded,
        pages: pagesOf.get(d.note_id) ?? null,
        textSource: (d.text_source as string | null) ?? null,
        updatedAt: d.updated_at as string,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const materialDocs = docs.filter(d => d.material_id);
  const sum = (list: Array<Record<string, any>>, key: 'chunks' | 'embedded') =>
    list.reduce((total, d) => total + countOf(d.id)[key], 0);
  const searchable = [
    ...materialDocs.filter(d => enabledMaterials.has(d.material_id)),
    ...(courseRes.data.kb_include_attachments ? attachmentDocs.filter(d => liveNotes.has(d.note_id)) : []),
  ];

  const logs = (logsRes.data ?? []) as Array<{ source: string; created_at: string }>;
  const bySource: Record<string, number> = { note_ai: 0, workspace_ai: 0, agent_tool: 0 };
  for (const log of logs) bySource[log.source] = (bySource[log.source] ?? 0) + 1;

  res.json({
    includeAttachments: courseRes.data.kb_include_attachments !== false,
    materials: {
      total: (materialsRes.data ?? []).length,
      enabled: enabledMaterials.size,
      chunks: sum(materialDocs, 'chunks'),
    },
    attachments: { items: attachments, chunks: sum(attachmentDocs.filter(d => liveNotes.has(d.note_id)), 'chunks') },
    // AI 现在检索得到的片段里，有多少已经算好向量（没算好的只能按关键词找到）
    searchable: { chunks: sum(searchable, 'chunks'), embedded: sum(searchable, 'embedded') },
    retrievals: { days: RETRIEVAL_WINDOW_DAYS, total: logs.length, bySource, lastAt: logs[0]?.created_at ?? null },
  });
});

const TEST_PASSAGES = 5;
const TEST_EXCERPT_CHARS = 280;

// POST /api/courses/:courseId/kb/search-test — 老师输入一个问题，看 AI 会拿到哪几段。
// 和笔记 AI 每轮的检索同一套（向量 + 关键词 → 重排 → 门槛 0.5 → 前 5），不记进检索记录
router.post('/courses/:courseId/kb/search-test', ...staffOnly, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);
  const query = String(req.body?.query ?? '').trim().slice(0, 500);
  if (!query) throw new ApiError(400, 'query is required');

  const started = Date.now();
  const found = await searchKnowledgeBaseDetailed(courseId, req.user!, query, TEST_PASSAGES);
  res.json({
    semantic: found.semantic,
    reranked: found.reranked,
    ms: Date.now() - started,
    hits: found.hits.map((h, i) => ({
      n: i + 1,
      title: h.title,
      section: h.headingPath || null,
      pageStart: h.pageStart,
      pageEnd: h.pageEnd ?? h.pageStart,
      kind: h.materialId ? 'material' : 'attachment',
      relevance: h.relevance === null ? null : Number(h.relevance.toFixed(3)),
      similarity: h.similarity === null ? null : Number(h.similarity.toFixed(3)),
      matchedBy: h.matchedBy,
      excerpt: excerptOf(h.content, TEST_EXCERPT_CHARS),
    })),
  });
});

export default router;
