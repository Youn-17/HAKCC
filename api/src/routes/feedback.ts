/**
 * Note Feedback Routes
 *
 * Endpoints:
 *   GET    /api/notes/:noteId/feedback          — get all published feedbacks for a note
 *   POST   /api/notes/:noteId/feedback/generate — (teacher/admin) generate AI feedback
 *   POST   /api/notes/:noteId/feedback/publish  — (teacher/admin) publish feedback to student
 *   PATCH  /api/notes/:noteId/feedback/:feedbackId/read — mark feedback as read (student)
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ensureCourseInstructor, ensureNoteAccess, isCourseStaff } from '../services/accessControl';
import { ApiError } from '../middleware/errorHandler';
import { decryptProviderApiKey, withDeepSeekOptions } from '../services/aiProviderConfig';
import { aiFetch } from '../services/aiGateway';

const router = Router();

// ── GET /api/notes/:noteId/feedback ──────────────────────────────
// Published feedback is addressed to the note's author: only the author and
// course staff read it (same audience as RLS note_feedbacks_student_select).
// Classmates who can open the note get an empty list. Course staff also see
// ai_evaluation.
router.get('/notes/:noteId/feedback', verifyJWT, async (req: Request, res: Response) => {
  const { noteId } = req.params;
  const user = (req as any).user;
  const note = await ensureNoteAccess(String(noteId), user);
  // Staff goes by course standing: a teacher account that joined with the
  // student code is a participant here.
  const isStaff = isCourseStaff(note.standing);
  if (note.author_id !== user.id && !isStaff) {
    res.json({ feedbacks: [] });
    return;
  }

  const { data, error } = await supabase
    .from('note_feedbacks')
    .select('*')
    .eq('note_id', noteId)
    .eq('is_published', true)
    .order('created_at', { ascending: false });

  if (error) throw new ApiError(500, error.message);

  const feedbacks = (data ?? []).map((row: any) => ({
    id: row.id,
    noteId: row.note_id,
    studentSummary: row.student_summary,
    teacherNote: row.teacher_note,
    publishedBy: row.published_by_name,
    publishedAt: row.published_at,
    isRead: row.is_read,
    createdAt: row.created_at,
    ...(isStaff ? { aiEvaluation: row.ai_evaluation } : {}),
  }));

  res.json({ feedbacks });
});

// ── POST /api/notes/:noteId/feedback/generate ─────────────────────
// Generate AI feedback using configured AI provider for the course.
router.post(
  '/notes/:noteId/feedback/generate',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { noteId } = req.params;
    const user = (req as any).user;

    // Fetch the note with content
    const { data: noteRow, error: noteErr } = await supabase
      .from('notes')
      .select('id, title, content, type, space_id, spaces(course_id)')
      .eq('id', noteId)
      .single();

    if (noteErr || !noteRow) throw new ApiError(404, 'Note not found');

    const spaceId = noteRow.space_id;
    const space = Array.isArray((noteRow as any).spaces) ? (noteRow as any).spaces[0] : (noteRow as any).spaces;
    const courseId = space?.course_id;
    if (!courseId) throw new ApiError(500, 'Note course could not be resolved');
    await ensureCourseInstructor(String(courseId), user);

    // Fetch build-on count for context
    const { count: buildOnCount } = await supabase
      .from('relations')
      .select('id', { count: 'exact', head: true })
      .eq('target_note_id', noteId);

    const wordCount = noteRow.content
      ? noteRow.content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length
      : 0;

    // Get AI config for the course (use first saved config; provider call validates the key)
    const { data: aiConfigs } = await supabase
      .from('teacher_ai_configs')
      .select('*')
      .eq('course_id', courseId)
      .limit(1);

    const aiConfig = aiConfigs?.[0];

    // Build the prompt
    const noteText = (noteRow.content ?? '').replace(/<[^>]*>/g, '').slice(0, 2000);
    const systemPrompt = `You are an expert in Knowledge Building pedagogy. Evaluate student notes from a Knowledge Building perspective and provide constructive feedback.`;

    const teacherPrompt = `Evaluate this student note from a Knowledge Building theory perspective:

Title: ${noteRow.title}
Content: ${noteText}
Word count: ${wordCount}
Build-ons received: ${buildOnCount ?? 0}

Provide:
1. KB Theory Evaluation (for teacher): Analyze the epistemic depth, idea improvement potential, community knowledge advancement, and any areas needing teacher intervention. Be specific and actionable.
2. Student Feedback Summary (1-2 paragraphs, encouraging and constructive): Highlight strengths and suggest how the student could deepen their ideas or connect with community knowledge.

Format your response as JSON: {"aiEvaluation": "...", "studentSummary": "..."}`;

    let aiEvaluation = '';
    let studentSummary = '';

    try {
      if (aiConfig) {
        // Use configured AI provider
        const { provider_id, api_key_encrypted, enabled_models } = aiConfig;
        const model = enabled_models?.[0];
        if (!api_key_encrypted) throw new Error('Configured AI provider has no API key');
        const apiKey = decryptProviderApiKey(api_key_encrypted);

        let response: Response | null = null;
        let resultText = '';

        if (provider_id === 'openai' || provider_id === 'deepseek' || provider_id === 'dmx' || provider_id === 'dmxapi' || provider_id === 'moonshot') {
          const baseUrls: Record<string, string> = {
            openai: 'https://api.openai.com/v1/chat/completions',
            deepseek: 'https://api.deepseek.com/chat/completions',
            dmx: 'https://www.dmxapi.cn/v1/chat/completions',
            dmxapi: 'https://www.dmxapi.cn/v1/chat/completions',
            moonshot: 'https://api.moonshot.cn/v1/chat/completions',
          };
          const resp = await aiFetch(baseUrls[provider_id], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(withDeepSeekOptions(provider_id, model || 'gpt-4o-mini', {
              model: model || 'gpt-4o-mini',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: teacherPrompt },
              ],
              response_format: { type: 'json_object' },
            })),
          });
          const data = await resp.json() as any;
          resultText = data.choices?.[0]?.message?.content ?? '{}';
        } else if (provider_id === 'anthropic') {
          const resp = await aiFetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: model || 'claude-3-haiku-20240307',
              max_tokens: 1500,
              system: systemPrompt,
              messages: [{ role: 'user', content: teacherPrompt }],
            }),
          });
          const data = await resp.json() as any;
          resultText = data.content?.[0]?.text ?? '{}';
        }

        try {
          const parsed = JSON.parse(resultText);
          aiEvaluation = parsed.aiEvaluation ?? '';
          studentSummary = parsed.studentSummary ?? '';
        } catch {
          aiEvaluation = resultText;
          studentSummary = 'Your note demonstrates engagement with the topic. Consider adding more evidence and connecting your ideas with classmates.';
        }
      } else {
        // Fallback: rule-based evaluation
        aiEvaluation = `KB Evaluation: This note (${wordCount} words, ${buildOnCount ?? 0} build-ons) shows ${wordCount > 100 ? 'substantial' : 'initial'} engagement. ${buildOnCount ? `It has attracted ${buildOnCount} community build-ons, indicating value to the discourse.` : 'Consider prompting students to engage with peers.'} Recommended intervention: ${wordCount < 50 ? 'Encourage deeper elaboration of the core idea.' : 'Prompt the student to synthesize related community ideas.'}`;
        studentSummary = `Your note on "${noteRow.title}" ${wordCount > 100 ? 'provides a thoughtful contribution' : 'is a good start'}. ${buildOnCount ? `${buildOnCount} classmate(s) have built on your idea, showing it resonates with the community.` : 'Try connecting your idea to what others have written.'} To deepen your contribution, consider adding supporting evidence or questioning your own assumptions.`;
      }
    } catch (err) {
      aiEvaluation = 'AI generation failed. Please review this note manually.';
      studentSummary = 'Your teacher will provide feedback soon.';
    }

    // Save as a draft feedback record
    const { data: feedbackRow, error: insertErr } = await supabase
      .from('note_feedbacks')
      .insert({
        note_id: noteId,
        space_id: spaceId,
        ai_evaluation: aiEvaluation,
        student_summary: studentSummary,
        generated_by: user.id,
        is_published: false,
      })
      .select()
      .single();

    if (insertErr) throw new ApiError(500, insertErr.message);

    res.json({
      feedback: {
        id: feedbackRow.id,
        noteId: feedbackRow.note_id,
        aiEvaluation: feedbackRow.ai_evaluation,
        studentSummary: feedbackRow.student_summary,
        createdAt: feedbackRow.created_at,
      },
    });
  }
);

// ── POST /api/notes/:noteId/feedback/publish ──────────────────────
// Publish (optionally edited) feedback to the student.
router.post(
  '/notes/:noteId/feedback/publish',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { noteId } = req.params;
    const user = (req as any).user;
    const { feedbackId, studentSummary, teacherNote } = req.body as {
      feedbackId: string;
      studentSummary: string;
      teacherNote?: string;
    };

    if (!feedbackId || !studentSummary?.trim()) {
      throw new ApiError(400, 'feedbackId and studentSummary are required');
    }

    const { data: noteRow, error: noteError } = await supabase
      .from('notes')
      .select('author_id, title, spaces(course_id)')
      .eq('id', noteId)
      .is('deleted_at', null)
      .single();
    if (noteError || !noteRow) throw new ApiError(404, 'Note not found');

    const space = Array.isArray((noteRow as any).spaces) ? (noteRow as any).spaces[0] : (noteRow as any).spaces;
    const courseId = space?.course_id;
    if (!courseId) throw new ApiError(500, 'Note course could not be resolved');
    await ensureCourseInstructor(String(courseId), user);

    const { data: updated, error } = await supabase
      .from('note_feedbacks')
      .update({
        student_summary: studentSummary,
        teacher_note: teacherNote ?? null,
        is_published: true,
        published_by: user.id,
        published_by_name: user.name,
        published_at: new Date().toISOString(),
        is_read: false,
      })
      .eq('id', feedbackId)
      .eq('note_id', noteId)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    // Create notification for note author
    if (noteRow?.author_id && noteRow.author_id !== user.id) {
      await supabase.from('notifications').insert({
        user_id: noteRow.author_id,
        type: 'teacher',
        title: 'New Feedback',
        message: `Your teacher has provided feedback on your note "${noteRow.title}".`,
        link_type: 'note',
        link_id: noteId,
      });
    }

    res.json({ success: true, feedbackId: updated.id });
  }
);

// ── PATCH /api/notes/:noteId/feedback/:feedbackId/read ────────────
// Mark feedback as read by the student.
router.patch(
  '/notes/:noteId/feedback/:feedbackId/read',
  verifyJWT,
  async (req: Request, res: Response) => {
    const { noteId, feedbackId } = req.params;
    const user = (req as any).user;
    const note = await ensureNoteAccess(String(noteId), user);
    if (note.author_id !== user.id && !isCourseStaff(note.standing)) {
      throw new ApiError(403, 'Only the note author can mark this feedback as read');
    }

    const { data, error } = await supabase
      .from('note_feedbacks')
      .update({ is_read: true })
      .eq('id', feedbackId)
      .eq('note_id', noteId)
      .eq('is_published', true)
      .select('id')
      .maybeSingle();

    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'Feedback not found');

    res.json({ success: true });
  }
);

export default router;
