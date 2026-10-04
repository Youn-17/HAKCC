import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { toCsv } from '../services/zipWriter';
import { ensureCourseInstructor } from '../services/accessControl';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../middleware/rateLimitKey';
import { decryptProviderApiKey } from '../services/aiProviderConfig';
import { getProviderEndpoint } from '../services/agentLoop';
import { assertSafePublicUrl } from '../services/urlGuard';
import { aiFetch } from '../services/aiGateway';
import {
  COURSE_AI_ROW_COLUMNS,
  choiceModelFor,
  defaultModelForRow,
  featureCandidateRows,
  getAiFeature,
  settingsFromRows,
  type CourseAiRow,
} from '../services/aiFeatureModels';

const router = Router();

/** A note referenced by body params must belong to the stated course. */
async function assertNoteInCourse(noteId: string, courseId: string): Promise<void> {
  const { data } = await supabase
    .from('notes')
    .select('id, spaces!inner(course_id)')
    .eq('id', noteId)
    .maybeSingle();
  const space = Array.isArray((data as any)?.spaces) ? (data as any).spaces[0] : (data as any)?.spaces;
  if (!data || space?.course_id !== courseId) {
    throw new ApiError(404, 'Note not found in this course');
  }
}


async function getSchemeOwnerCourseId(schemeId: string): Promise<string> {
  const { data, error } = await supabase
    .from('coding_schemes')
    .select('course_id')
    .eq('id', schemeId)
    .single();
  if (error || !data) throw new ApiError(404, 'Scheme not found');
  return data.course_id as string;
}

async function getCodeOwnerCourseId(codeId: string): Promise<string> {
  const { data, error } = await supabase
    .from('coding_codes')
    .select('scheme_id, coding_schemes!inner(course_id)')
    .eq('id', codeId)
    .single();
  if (error || !data) throw new ApiError(404, 'Code not found');
  return ((data as any).coding_schemes as any).course_id as string;
}

async function getReferenceOwnerCourseId(refId: string): Promise<string> {
  const { data, error } = await supabase
    .from('coding_references')
    .select('code_id, coding_codes!inner(scheme_id, coding_schemes!inner(course_id))')
    .eq('id', refId)
    .single();
  if (error || !data) throw new ApiError(404, 'Reference not found');
  return ((data as any).coding_codes as any).coding_schemes.course_id as string;
}

async function getMemoOwnerCourseId(memoId: string): Promise<string> {
  const { data, error } = await supabase
    .from('coding_memos')
    .select('scheme_id, coding_schemes!inner(course_id)')
    .eq('id', memoId)
    .single();
  if (error || !data) throw new ApiError(404, 'Memo not found');
  return ((data as any).coding_schemes as any).course_id as string;
}

const codingMutationLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

// ── Coding Schemes ───────────────────────────────────────────

// GET /api/courses/:courseId/coding/schemes
router.get(
  '/courses/:courseId/coding/schemes',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    await ensureCourseInstructor(String(req.params.courseId), req.user!);
    const { courseId } = req.params;

    const { data, error } = await supabase
      .from('coding_schemes')
      .select('*, coding_codes(count)')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(500, error.message);
    res.json({ schemes: data ?? [] });
  },
);

// POST /api/courses/:courseId/coding/schemes
router.post(
  '/courses/:courseId/coding/schemes',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    await ensureCourseInstructor(String(req.params.courseId), req.user!);
    const { courseId } = req.params;
    const userId = (req as any).user?.id;
    const { name, description } = req.body;

    if (!name?.trim()) throw new ApiError(400, 'name is required');

    const { data, error } = await supabase
      .from('coding_schemes')
      .insert({ course_id: courseId, name: name.trim(), description: description ?? '', created_by: userId })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    res.status(201).json({ scheme: data });
  },
);

// PATCH /api/coding/schemes/:schemeId
router.patch(
  '/coding/schemes/:schemeId',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);
    const { name, description } = req.body;

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description;

    const { data, error } = await supabase
      .from('coding_schemes')
      .update(updates)
      .eq('id', schemeId)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    res.json({ scheme: data });
  },
);

// DELETE /api/coding/schemes/:schemeId
router.delete(
  '/coding/schemes/:schemeId',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);

    const { error } = await supabase
      .from('coding_schemes')
      .delete()
      .eq('id', schemeId);

    if (error) throw new ApiError(500, error.message);
    res.json({ ok: true });
  },
);

// ── Coding Codes (Nodes) ─────────────────────────────────────

// GET /api/coding/schemes/:schemeId/codes
router.get(
  '/coding/schemes/:schemeId/codes',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // The teacher role alone says nothing about this scheme: without the owner
    // check any teacher can read another course's codebook by its id.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);

    const { data, error } = await supabase
      .from('coding_codes')
      .select('*')
      .eq('scheme_id', schemeId)
      .order('sort_order', { ascending: true });

    if (error) throw new ApiError(500, error.message);
    res.json({ codes: data ?? [] });
  },
);

// POST /api/coding/schemes/:schemeId/codes
router.post(
  '/coding/schemes/:schemeId/codes',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // Without the owner check any teacher can write codes into another
    // course's codebook, corrupting its coding data.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);
    const { name, color, description, parent_id, sort_order } = req.body;

    if (!name?.trim()) throw new ApiError(400, 'name is required');

    const { data, error } = await supabase
      .from('coding_codes')
      .insert({
        scheme_id: schemeId,
        name: name.trim(),
        color: color ?? '#3b82f6',
        description: description ?? '',
        parent_id: parent_id ?? null,
        sort_order: sort_order ?? 0,
      })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    res.status(201).json({ code: data });
  },
);

// PATCH /api/coding/codes/:codeId
router.patch(
  '/coding/codes/:codeId',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const codeId = req.params.codeId as string;
    await ensureCourseInstructor(await getCodeOwnerCourseId(codeId), req.user!);
    const { name, color, description, parent_id, sort_order } = req.body;

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name.trim();
    if (color !== undefined) updates.color = color;
    if (description !== undefined) updates.description = description;
    if (parent_id !== undefined) updates.parent_id = parent_id;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabase
      .from('coding_codes')
      .update(updates)
      .eq('id', codeId)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    res.json({ code: data });
  },
);

// DELETE /api/coding/codes/:codeId
router.delete(
  '/coding/codes/:codeId',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const codeId = req.params.codeId as string;
    await ensureCourseInstructor(await getCodeOwnerCourseId(codeId), req.user!);

    const { error } = await supabase
      .from('coding_codes')
      .delete()
      .eq('id', codeId);

    if (error) throw new ApiError(500, error.message);
    res.json({ ok: true });
  },
);

// ── Coding References ────────────────────────────────────────

// GET /api/coding/schemes/:schemeId/references — all references for a scheme
router.get(
  '/coding/schemes/:schemeId/references',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // Coded references quote note excerpts, so an unchecked schemeId here
    // exposes another course's student writing along with its coding.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);
    const { note_id, code_id } = req.query;

    let query = supabase
      .from('coding_references')
      .select('*, coding_codes!code_id(name, color, scheme_id)')
      .order('created_at', { ascending: true });

    if (note_id) {
      query = query.eq('note_id', note_id as string);
    }

    // Always constrain to codes belonging to this scheme. A bare
    // .eq('code_id', …) would let an authorised scheme be paired with another
    // course's code id, reading straight past the ownership check above.
    const { data: codes } = await supabase
      .from('coding_codes')
      .select('id')
      .eq('scheme_id', schemeId);
    const schemeCodeIds = (codes ?? []).map(c => c.id as string);

    if (schemeCodeIds.length === 0) {
      res.json({ references: [] });
      return;
    }

    if (code_id) {
      if (!schemeCodeIds.includes(code_id as string)) {
        throw new ApiError(404, 'Code not found in this scheme');
      }
      query = query.eq('code_id', code_id as string);
    } else {
      query = query.in('code_id', schemeCodeIds);
    }

    const { data, error } = await query;
    if (error) throw new ApiError(500, error.message);
    res.json({ references: data ?? [] });
  },
);

// POST /api/coding/references
router.post(
  '/coding/references',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { code_id, note_id, start_offset, end_offset, coded_text, memo } = req.body;

    if (!code_id || !note_id) throw new ApiError(400, 'code_id and note_id are required');
    if (start_offset === undefined || end_offset === undefined) throw new ApiError(400, 'start_offset and end_offset are required');

    // Both ids come from the body. The code decides which course this write
    // lands in, and the note must belong to that same course — otherwise a
    // teacher could attach coded excerpts of another course's notes.
    const ownerCourseId = await getCodeOwnerCourseId(code_id);
    await ensureCourseInstructor(ownerCourseId, req.user!);
    await assertNoteInCourse(note_id, ownerCourseId);

    const { data, error } = await supabase
      .from('coding_references')
      .insert({
        code_id,
        note_id,
        coder_id: userId,
        start_offset,
        end_offset,
        coded_text: coded_text ?? '',
        memo: memo ?? null,
      })
      .select('*, coding_codes!code_id(name, color)')
      .single();

    if (error) throw new ApiError(500, error.message);
    res.status(201).json({ reference: data });
  },
);

// PATCH /api/coding/references/:refId
router.patch(
  '/coding/references/:refId',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const refId = req.params.refId as string;
    await ensureCourseInstructor(await getReferenceOwnerCourseId(refId), req.user!);
    const { memo, code_id } = req.body;

    const updates: Record<string, any> = {};
    if (memo !== undefined) updates.memo = memo;
    if (code_id !== undefined) updates.code_id = code_id;

    const { data, error } = await supabase
      .from('coding_references')
      .update(updates)
      .eq('id', refId)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    res.json({ reference: data });
  },
);

// DELETE /api/coding/references/:refId
router.delete(
  '/coding/references/:refId',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const refId = req.params.refId as string;
    await ensureCourseInstructor(await getReferenceOwnerCourseId(refId), req.user!);

    const { error } = await supabase
      .from('coding_references')
      .delete()
      .eq('id', refId);

    if (error) throw new ApiError(500, error.message);
    res.json({ ok: true });
  },
);

// ── Stats ────────────────────────────────────────────────────

// GET /api/coding/schemes/:schemeId/stats — coding progress & frequency
router.get(
  '/coding/schemes/:schemeId/stats',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // Progress stats reveal how much of another course's data has been coded.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);
    const { course_id } = req.query;

    const { data: codes } = await supabase
      .from('coding_codes')
      .select('id, name, color')
      .eq('scheme_id', schemeId);

    if (!codes || codes.length === 0) {
      res.json({ stats: { totalCodes: 0, totalReferences: 0, codedNotes: 0, totalNotes: 0, codeFrequencies: [] } });
      return;
    }

    const codeIds = codes.map(c => c.id);

    const { data: refs } = await supabase
      .from('coding_references')
      .select('id, code_id, note_id')
      .in('code_id', codeIds);

    const references = refs ?? [];
    const codedNoteIds = new Set(references.map(r => r.note_id));

    // Count total notes in the course
    let totalNotes = 0;
    if (course_id) {
      const { data: spaces } = await supabase
        .from('spaces')
        .select('id')
        .eq('course_id', course_id as string);

      if (spaces && spaces.length > 0) {
        const { count } = await supabase
          .from('notes')
          .select('id', { count: 'exact', head: true })
          .in('space_id', spaces.map(s => s.id));
        totalNotes = count ?? 0;
      }
    }

    // Code frequency
    const freqMap: Record<string, number> = {};
    for (const ref of references) {
      freqMap[ref.code_id] = (freqMap[ref.code_id] ?? 0) + 1;
    }

    const codeFrequencies = codes.map(c => ({
      id: c.id,
      name: c.name,
      color: c.color,
      count: freqMap[c.id] ?? 0,
    })).sort((a, b) => b.count - a.count);

    res.json({
      stats: {
        totalCodes: codes.length,
        totalReferences: references.length,
        codedNotes: codedNoteIds.size,
        totalNotes,
        codeFrequencies,
      },
    });
  },
);

// GET /api/coding/notes/:noteId/content — get note content for coding view
router.get(
  '/coding/notes/:noteId/content',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { noteId } = req.params;

    const { data, error } = await supabase
      .from('notes')
      .select('id, title, content, user_id, created_at, type, space_id, spaces!inner(course_id)')
      .eq('id', noteId)
      .single();

    if (error || !data) throw new ApiError(404, 'Note not found');
    await ensureCourseInstructor(((data as any).spaces as any).course_id, req.user!);
    res.json({ note: { id: data.id, title: data.title, content: data.content, user_id: data.user_id, created_at: data.created_at, type: data.type, space_id: data.space_id } });
  },
);

// GET /api/courses/:courseId/coding/notes — list notes for coding
router.get(
  '/courses/:courseId/coding/notes',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    await ensureCourseInstructor(String(req.params.courseId), req.user!);
    const { courseId } = req.params;
    const { scheme_id } = req.query;

    const { data: spaces } = await supabase
      .from('spaces')
      .select('id')
      .eq('course_id', courseId);

    if (!spaces || spaces.length === 0) {
      res.json({ notes: [] });
      return;
    }

    const { data: notes, error } = await supabase
      .from('notes')
      .select('id, title, content, user_id, created_at, type')
      .in('space_id', spaces.map(s => s.id))
      .in('type', ['note', 'riseabove'])
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(500, error.message);

    // If scheme_id given, mark which notes are coded
    let codedNoteIds = new Set<string>();
    if (scheme_id) {
      const { data: codes } = await supabase
        .from('coding_codes')
        .select('id')
        .eq('scheme_id', scheme_id as string);

      if (codes && codes.length > 0) {
        const { data: refs } = await supabase
          .from('coding_references')
          .select('note_id')
          .in('code_id', codes.map(c => c.id));

        codedNoteIds = new Set((refs ?? []).map(r => r.note_id));
      }
    }

    const enriched = (notes ?? []).map(n => ({
      ...n,
      is_coded: codedNoteIds.has(n.id),
    }));

    res.json({ notes: enriched });
  },
);

// ── Phase 2: Matrix, Kappa, Memos, Export ────────────────────

// GET /api/coding/schemes/:schemeId/matrix — code × author cross-tabulation
router.get(
  '/coding/schemes/:schemeId/matrix',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // The co-occurrence matrix is derived from another course's coded excerpts.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);
    const { course_id } = req.query;

    const { data: codes } = await supabase
      .from('coding_codes')
      .select('id, name, color')
      .eq('scheme_id', schemeId)
      .order('sort_order');

    if (!codes || codes.length === 0) {
      res.json({ matrix: { codes: [], authors: [], cells: [] } });
      return;
    }

    const { data: refs } = await supabase
      .from('coding_references')
      .select('code_id, note_id, coder_id')
      .in('code_id', codes.map(c => c.id));

    const references = refs ?? [];

    // Get note authors (the student who wrote the note, not the coder)
    const noteIds = [...new Set(references.map(r => r.note_id))];
    let noteAuthorMap: Record<string, string> = {};

    if (noteIds.length > 0) {
      const { data: notes } = await supabase
        .from('notes')
        .select('id, user_id')
        .in('id', noteIds);

      for (const n of notes ?? []) {
        noteAuthorMap[n.id] = n.user_id;
      }
    }

    // Get author names
    const authorIds = [...new Set(Object.values(noteAuthorMap))];
    let authorNameMap: Record<string, string> = {};
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', authorIds);

      for (const p of profiles ?? []) {
        authorNameMap[p.id] = p.name ?? p.id.slice(0, 8);
      }
    }

    // Build matrix: rows = codes, columns = authors
    const cells: Record<string, Record<string, number>> = {};
    for (const code of codes) cells[code.id] = {};

    for (const ref of references) {
      const authorId = noteAuthorMap[ref.note_id];
      if (!authorId) continue;
      cells[ref.code_id][authorId] = (cells[ref.code_id][authorId] ?? 0) + 1;
    }

    const authors = authorIds.map(id => ({ id, name: authorNameMap[id] ?? id.slice(0, 8) }));

    res.json({
      matrix: {
        codes: codes.map(c => ({ id: c.id, name: c.name, color: c.color })),
        authors,
        cells,
      },
    });
  },
);

// GET /api/coding/schemes/:schemeId/timeline — code × time distribution
router.get(
  '/coding/schemes/:schemeId/timeline',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // The timeline exposes when another course's coding happened, coder by coder.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);

    const { data: codes } = await supabase
      .from('coding_codes')
      .select('id, name, color')
      .eq('scheme_id', schemeId)
      .order('sort_order');

    if (!codes || codes.length === 0) {
      res.json({ timeline: { codes: [], dates: [], cells: {} } });
      return;
    }

    const { data: refs } = await supabase
      .from('coding_references')
      .select('code_id, note_id, created_at')
      .in('code_id', codes.map(c => c.id))
      .order('created_at');

    const references = refs ?? [];

    // Get note creation dates for temporal distribution
    const noteIds = [...new Set(references.map(r => r.note_id))];
    let noteCreatedMap: Record<string, string> = {};
    if (noteIds.length > 0) {
      const { data: notes } = await supabase
        .from('notes')
        .select('id, created_at')
        .in('id', noteIds);
      for (const n of notes ?? []) {
        noteCreatedMap[n.id] = n.created_at;
      }
    }

    // Group by date (note creation date) × code
    const cells: Record<string, Record<string, number>> = {};
    const dateSet = new Set<string>();

    for (const ref of references) {
      const raw = noteCreatedMap[ref.note_id] ?? ref.created_at;
      const date = raw.slice(0, 10);
      dateSet.add(date);
      if (!cells[date]) cells[date] = {};
      cells[date][ref.code_id] = (cells[date][ref.code_id] ?? 0) + 1;
    }

    const dates = [...dateSet].sort();

    res.json({
      timeline: {
        codes: codes.map(c => ({ id: c.id, name: c.name, color: c.color })),
        dates,
        cells,
      },
    });
  },
);

// GET /api/coding/schemes/:schemeId/kappa — Cohen's Kappa inter-coder reliability
router.get(
  '/coding/schemes/:schemeId/kappa',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // Inter-rater reliability is computed over another course's coders and codes.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);

    const { data: codes } = await supabase
      .from('coding_codes')
      .select('id, name')
      .eq('scheme_id', schemeId);

    if (!codes || codes.length === 0) {
      res.json({ kappa: { value: null, coders: [], message: 'No codes defined' } });
      return;
    }

    const { data: refs } = await supabase
      .from('coding_references')
      .select('code_id, note_id, coder_id, start_offset, end_offset')
      .in('code_id', codes.map(c => c.id));

    const references = refs ?? [];
    const coderIds = [...new Set(references.map(r => r.coder_id))];

    if (coderIds.length < 2) {
      res.json({ kappa: { value: null, coders: coderIds, message: 'Need at least 2 coders for Kappa calculation' } });
      return;
    }

    // Get coder names
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', coderIds);
    const nameMap: Record<string, string> = {};
    for (const p of profiles ?? []) nameMap[p.id] = p.name ?? p.id.slice(0, 8);

    // Compute pairwise kappa for each coder pair
    // Unit of analysis: (note_id, code_id) — did coder assign this code to this note?
    const noteIds = [...new Set(references.map(r => r.note_id))];
    const codeIds = codes.map(c => c.id);

    // Build coder→set of (noteId:codeId) assignments
    const coderAssignments: Record<string, Set<string>> = {};
    for (const cid of coderIds) coderAssignments[cid] = new Set();
    for (const ref of references) {
      coderAssignments[ref.coder_id].add(`${ref.note_id}:${ref.code_id}`);
    }

    const pairResults: { coder1: string; coder2: string; kappa: number; agreement: number; items: number }[] = [];

    for (let i = 0; i < coderIds.length; i++) {
      for (let j = i + 1; j < coderIds.length; j++) {
        const c1 = coderIds[i], c2 = coderIds[j];
        const set1 = coderAssignments[c1], set2 = coderAssignments[c2];

        // All possible (note, code) items
        const allItems: string[] = [];
        for (const nid of noteIds) {
          for (const cid of codeIds) {
            allItems.push(`${nid}:${cid}`);
          }
        }

        let agreeYes = 0, agreeNo = 0, disagree = 0;
        for (const item of allItems) {
          const in1 = set1.has(item), in2 = set2.has(item);
          if (in1 && in2) agreeYes++;
          else if (!in1 && !in2) agreeNo++;
          else disagree++;
        }

        const total = allItems.length;
        if (total === 0) continue;

        const po = (agreeYes + agreeNo) / total;
        const p1yes = (agreeYes + (set1.size - agreeYes)) / total;
        const p2yes = (agreeYes + (set2.size - agreeYes)) / total;
        const pe = p1yes * p2yes + (1 - p1yes) * (1 - p2yes);

        const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);

        pairResults.push({
          coder1: nameMap[c1] ?? c1.slice(0, 8),
          coder2: nameMap[c2] ?? c2.slice(0, 8),
          kappa: Math.round(kappa * 1000) / 1000,
          agreement: Math.round(po * 1000) / 1000,
          items: total,
        });
      }
    }

    // Overall kappa (average of pairs)
    const avgKappa = pairResults.length > 0
      ? Math.round((pairResults.reduce((s, p) => s + p.kappa, 0) / pairResults.length) * 1000) / 1000
      : null;

    res.json({
      kappa: {
        value: avgKappa,
        coders: coderIds.map(id => ({ id, name: nameMap[id] ?? id.slice(0, 8) })),
        pairs: pairResults,
      },
    });
  },
);

// ── Memos ────────────────────────────────────────────────────

// GET /api/coding/schemes/:schemeId/memos
router.get(
  '/coding/schemes/:schemeId/memos',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // Memos are the researcher's private analytic notes on this course.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);

    const { data, error } = await supabase
      .from('coding_memos')
      .select('*')
      .eq('scheme_id', schemeId)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(500, error.message);
    res.json({ memos: data ?? [] });
  },
);

// POST /api/coding/schemes/:schemeId/memos
router.post(
  '/coding/schemes/:schemeId/memos',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // Without this any teacher can write memos into another course's scheme.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);
    const userId = (req as any).user?.id;
    const { title, content, linked_note_id, linked_code_id } = req.body;

    const { data, error } = await supabase
      .from('coding_memos')
      .insert({
        scheme_id: schemeId,
        author_id: userId,
        title: title ?? '',
        content: content ?? '',
        linked_note_id: linked_note_id ?? null,
        linked_code_id: linked_code_id ?? null,
      })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    res.status(201).json({ memo: data });
  },
);

// PATCH /api/coding/memos/:memoId
router.patch(
  '/coding/memos/:memoId',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const memoId = req.params.memoId as string;
    await ensureCourseInstructor(await getMemoOwnerCourseId(memoId), req.user!);
    const { title, content } = req.body;

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;

    const { data, error } = await supabase
      .from('coding_memos')
      .update(updates)
      .eq('id', memoId)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    res.json({ memo: data });
  },
);

// DELETE /api/coding/memos/:memoId
router.delete(
  '/coding/memos/:memoId',
  verifyJWT,
  codingMutationLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const memoId = req.params.memoId as string;
    await ensureCourseInstructor(await getMemoOwnerCourseId(memoId), req.user!);

    const { error } = await supabase
      .from('coding_memos')
      .delete()
      .eq('id', memoId);

    if (error) throw new ApiError(500, error.message);
    res.json({ ok: true });
  },
);

// ── Export ────────────────────────────────────────────────────

// GET /api/coding/schemes/:schemeId/export — export coded data as JSON
router.get(
  '/coding/schemes/:schemeId/export',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const schemeId = req.params.schemeId as string;
    // Export is the whole coded dataset — the most sensitive read in this file.
    await ensureCourseInstructor(await getSchemeOwnerCourseId(schemeId), req.user!);
    const { format } = req.query;

    const { data: scheme } = await supabase
      .from('coding_schemes')
      .select('*')
      .eq('id', schemeId)
      .single();

    const { data: codes } = await supabase
      .from('coding_codes')
      .select('*')
      .eq('scheme_id', schemeId)
      .order('sort_order');

    if (!codes || codes.length === 0) {
      res.json({ export: { scheme, codes: [], references: [], memos: [] } });
      return;
    }

    const { data: refs } = await supabase
      .from('coding_references')
      .select('*')
      .in('code_id', codes.map(c => c.id))
      .order('created_at');

    // Get note titles
    const noteIds = [...new Set((refs ?? []).map(r => r.note_id))];
    let noteTitleMap: Record<string, string> = {};
    if (noteIds.length > 0) {
      const { data: notes } = await supabase
        .from('notes')
        .select('id, title, user_id')
        .in('id', noteIds);
      for (const n of notes ?? []) noteTitleMap[n.id] = n.title ?? '';
    }

    // Get coder names
    const coderIds = [...new Set((refs ?? []).map(r => r.coder_id))];
    let coderNameMap: Record<string, string> = {};
    if (coderIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', coderIds);
      for (const p of profiles ?? []) coderNameMap[p.id] = p.name ?? '';
    }

    const { data: memos } = await supabase
      .from('coding_memos')
      .select('*')
      .eq('scheme_id', schemeId)
      .order('created_at');

    // Code name lookup
    const codeNameMap: Record<string, string> = {};
    for (const c of codes) codeNameMap[c.id] = c.name;

    if (format === 'csv') {
      const rows = (refs ?? []).map(r => ({
        reference_id: r.id,
        code_name: codeNameMap[r.code_id] ?? '',
        note_title: noteTitleMap[r.note_id] ?? '',
        note_id: r.note_id,
        coder: coderNameMap[r.coder_id] ?? '',
        start_offset: r.start_offset,
        end_offset: r.end_offset,
        coded_text: r.coded_text,
        memo: r.memo ?? '',
        created_at: r.created_at,
      }));

      const headers = ['reference_id', 'code_name', 'note_title', 'note_id', 'coder', 'start_offset', 'end_offset', 'coded_text', 'memo', 'created_at'];
      // Hand-rolled quoting here skipped the formula guard, so a coded excerpt
      // beginning with = or + executed as a formula when the researcher opened
      // the export in Excel. toCsv is the repo's guarded serializer.
      const csv = toCsv(rows as Record<string, unknown>[], headers);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="coding_export_${schemeId.slice(0, 8)}.csv"`);
      res.send('﻿' + csv);
      return;
    }

    res.json({
      export: {
        scheme,
        codes,
        references: (refs ?? []).map(r => ({
          ...r,
          code_name: codeNameMap[r.code_id] ?? '',
          note_title: noteTitleMap[r.note_id] ?? '',
          coder_name: coderNameMap[r.coder_id] ?? '',
        })),
        memos: memos ?? [],
      },
    });
  },
);

// ── Phase 3: AI-Assisted Coding ──────────────────────────────

/**
 * 课程 AI 设置里「质性编码建议」选的模型优先；没选就按原来的顺序（DMX 在前：批量编码不赶时间，
 * DMX 不限并发）取第一家验证过的。只接这几家 OpenAI 兼容的，见 aiFeatureModels 里这一项的 providers。
 * 以前按厂商一家一家查，最多七次往返；现在一次读完整门课的配置。
 */
async function resolveAIConfig(courseId: string) {
  const { data } = await supabase
    .from('teacher_ai_configs')
    .select(COURSE_AI_ROW_COLUMNS)
    .eq('course_id', courseId);
  const rows = (data ?? []) as CourseAiRow[];
  const verified = rows.filter(r => r.is_verified);
  const { rows: candidates, choice } = featureCandidateRows('qualitative_coding', verified, settingsFromRows(rows));
  const def = getAiFeature('qualitative_coding');
  for (const row of candidates) {
    let apiKey = '';
    try {
      apiKey = decryptProviderApiKey(String(row.api_key_encrypted));
    } catch {
      continue;
    }
    if (!apiKey) continue;
    const pid = row.provider_id;
    return {
      apiKey,
      endpointUrl: row.endpoint_url ?? getProviderEndpoint(pid),
      providerId: pid,
      model: choiceModelFor(choice, pid) ?? defaultModelForRow(def, row) ?? (pid === 'deepseek' ? 'deepseek-flash' : 'gpt-4o-mini'),
    };
  }
  return null;
}

async function callAI(config: { apiKey: string; endpointUrl: string; model: string }, messages: { role: string; content: string }[], temperature = 0.3): Promise<string> {
  if (config.endpointUrl) {
    await assertSafePublicUrl(config.endpointUrl);
  }
  const res = await aiFetch(config.endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature, max_tokens: 4096, stream: false }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}`);
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? '';
}

const aiCodingLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many AI coding requests' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

// POST /api/coding/schemes/:schemeId/ai/suggest — AI suggests codes for a note
router.post(
  '/coding/schemes/:schemeId/ai/suggest',
  verifyJWT,
  aiCodingLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { schemeId } = req.params;
    const { note_id, course_id } = req.body;

    if (!note_id || !course_id) throw new ApiError(400, 'note_id and course_id are required');
    // course_id is caller-supplied and selects which course's API key gets
    // decrypted and billed — it must be a course this teacher actually owns.
    await ensureCourseInstructor(String(course_id), req.user!);
    await assertNoteInCourse(String(note_id), String(course_id));

    const aiConfig = await resolveAIConfig(course_id);
    if (!aiConfig) throw new ApiError(400, 'No AI provider configured for this course');

    // Get codebook
    const { data: codes } = await supabase
      .from('coding_codes')
      .select('id, name, description, color')
      .eq('scheme_id', schemeId)
      .order('sort_order');

    if (!codes || codes.length === 0) throw new ApiError(400, 'No codes defined in this scheme');

    // Get note content
    const { data: note } = await supabase
      .from('notes')
      .select('id, title, content')
      .eq('id', note_id)
      .single();

    if (!note) throw new ApiError(404, 'Note not found');

    const plainText = note.content?.replace(/<[^>]*>/g, '') ?? '';

    const codeList = codes.map(c => `- "${c.name}": ${c.description || '(no description)'}`).join('\n');

    const reply = await callAI(aiConfig, [
      {
        role: 'system',
        content: `You are a qualitative coding assistant. Given a codebook and a text, identify text segments that match each code. Return a JSON array of suggestions.

Each suggestion: {"code_name": "...", "start": <char offset>, "end": <char offset>, "text": "exact text from the source", "confidence": 0.0-1.0, "reason": "brief reason"}

Rules:
- Only use codes from the provided codebook
- "text" must be an EXACT substring of the source text
- start/end are character offsets in the plain text
- confidence: 0.8+ = strong match, 0.5-0.8 = moderate, <0.5 = weak
- Return only valid JSON array, no markdown fencing`,
      },
      {
        role: 'user',
        content: `Codebook:\n${codeList}\n\nText to code:\n${plainText}`,
      },
    ]);

    // Parse AI response
    let suggestions: any[] = [];
    try {
      const cleaned = reply.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      suggestions = JSON.parse(cleaned);
      // Validate and enrich with code IDs
      const codeNameMap: Record<string, string> = {};
      const codeColorMap: Record<string, string> = {};
      for (const c of codes) {
        codeNameMap[c.name.toLowerCase()] = c.id;
        codeColorMap[c.name.toLowerCase()] = c.color;
      }

      suggestions = suggestions
        .filter((s: any) => s.code_name && s.text && typeof s.start === 'number' && typeof s.end === 'number')
        .map((s: any) => ({
          ...s,
          code_id: codeNameMap[s.code_name.toLowerCase()] ?? null,
          color: codeColorMap[s.code_name.toLowerCase()] ?? '#3b82f6',
        }))
        .filter((s: any) => s.code_id);
    } catch {
      suggestions = [];
    }

    res.json({ suggestions });
  },
);

// POST /api/coding/schemes/:schemeId/ai/batch — AI batch pre-code multiple notes
router.post(
  '/coding/schemes/:schemeId/ai/batch',
  verifyJWT,
  aiCodingLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { schemeId } = req.params;
    const { note_ids, course_id } = req.body;

    if (!note_ids?.length || !course_id) throw new ApiError(400, 'note_ids array and course_id are required');
    await ensureCourseInstructor(String(course_id), req.user!);
    for (const nid of note_ids as string[]) await assertNoteInCourse(String(nid), String(course_id));

    const aiConfig = await resolveAIConfig(course_id);
    if (!aiConfig) throw new ApiError(400, 'No AI provider configured for this course');

    const { data: codes } = await supabase
      .from('coding_codes')
      .select('id, name, description')
      .eq('scheme_id', schemeId)
      .order('sort_order');

    if (!codes || codes.length === 0) throw new ApiError(400, 'No codes defined');

    const codeNameMap: Record<string, string> = {};
    for (const c of codes) codeNameMap[c.name.toLowerCase()] = c.id;

    const { data: notes } = await supabase
      .from('notes')
      .select('id, title, content')
      .in('id', note_ids.slice(0, 20)); // Cap at 20

    if (!notes || notes.length === 0) throw new ApiError(404, 'Notes not found');

    const userId = (req as any).user?.id;
    const codeList = codes.map(c => `- "${c.name}": ${c.description || ''}`).join('\n');

    const results: { note_id: string; created: number }[] = [];

    for (const note of notes) {
      const plainText = note.content?.replace(/<[^>]*>/g, '') ?? '';
      if (!plainText.trim()) { results.push({ note_id: note.id, created: 0 }); continue; }

      try {
        const reply = await callAI(aiConfig, [
          {
            role: 'system',
            content: `You are a qualitative coding assistant. Given a codebook and text, identify text segments matching each code. Return a JSON array.
Each item: {"code_name": "...", "start": <char offset>, "end": <char offset>, "text": "exact substring"}
Only use codes from the codebook. Return ONLY the JSON array.`,
          },
          { role: 'user', content: `Codebook:\n${codeList}\n\nText:\n${plainText}` },
        ]);

        const cleaned = reply.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const items = JSON.parse(cleaned) as any[];

        let created = 0;
        for (const item of items) {
          const codeId = codeNameMap[item.code_name?.toLowerCase()];
          if (!codeId || typeof item.start !== 'number' || typeof item.end !== 'number' || !item.text) continue;

          const { error } = await supabase
            .from('coding_references')
            .insert({
              code_id: codeId,
              note_id: note.id,
              coder_id: userId,
              start_offset: item.start,
              end_offset: item.end,
              coded_text: item.text,
              memo: '[AI pre-coded]',
            });

          if (!error) created++;
        }

        results.push({ note_id: note.id, created });
      } catch {
        results.push({ note_id: note.id, created: 0 });
      }
    }

    res.json({ results, totalCreated: results.reduce((s, r) => s + r.created, 0) });
  },
);

// POST /api/coding/schemes/:schemeId/ai/similar — find semantically similar coded segments
router.post(
  '/coding/schemes/:schemeId/ai/similar',
  verifyJWT,
  aiCodingLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { schemeId } = req.params;
    const { text, course_id, code_id } = req.body;

    if (!text || !course_id) throw new ApiError(400, 'text and course_id are required');
    await ensureCourseInstructor(String(course_id), req.user!);

    const aiConfig = await resolveAIConfig(course_id);
    if (!aiConfig) throw new ApiError(400, 'No AI provider configured');

    // Get existing coded segments for comparison
    const { data: codes } = await supabase
      .from('coding_codes')
      .select('id, name')
      .eq('scheme_id', schemeId);

    if (!codes || codes.length === 0) {
      res.json({ similar: [] });
      return;
    }

    const codeIds = code_id ? [code_id] : codes.map(c => c.id);
    const codeNameMap: Record<string, string> = {};
    for (const c of codes) codeNameMap[c.id] = c.name;

    const { data: refs } = await supabase
      .from('coding_references')
      .select('id, code_id, note_id, coded_text')
      .in('code_id', codeIds)
      .limit(100);

    if (!refs || refs.length === 0) {
      res.json({ similar: [] });
      return;
    }

    const existingTexts = refs.map(r => `[${codeNameMap[r.code_id] ?? '?'}] "${r.coded_text}"`).join('\n');

    const reply = await callAI(aiConfig, [
      {
        role: 'system',
        content: `You are a qualitative coding similarity analyst. Given a target text and a list of already-coded text segments, find the most semantically similar ones.
Return a JSON array of matches: [{"index": <0-based index in the list>, "similarity": 0.0-1.0, "reason": "brief explanation"}]
Sort by similarity descending. Return top 5 matches. Return ONLY the JSON array.`,
      },
      {
        role: 'user',
        content: `Target text: "${text}"\n\nExisting coded segments:\n${existingTexts}`,
      },
    ], 0.2);

    let similar: any[] = [];
    try {
      const cleaned = reply.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const matches = JSON.parse(cleaned) as any[];
      similar = matches
        .filter((m: any) => typeof m.index === 'number' && m.index >= 0 && m.index < refs.length)
        .map((m: any) => ({
          reference_id: refs[m.index].id,
          code_name: codeNameMap[refs[m.index].code_id] ?? '?',
          coded_text: refs[m.index].coded_text,
          note_id: refs[m.index].note_id,
          similarity: m.similarity ?? 0,
          reason: m.reason ?? '',
        }));
    } catch {}

    res.json({ similar });
  },
);

export default router;
