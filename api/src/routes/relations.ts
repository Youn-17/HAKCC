import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { updateHeatScore } from '../services/metricsService';
import { ensureNoteAccess, ensureSpaceAccess, isCourseStaff } from '../services/accessControl';

const router = Router();

// Valid relation types matching the database enum
const VALID_RELATION_TYPES = ['extend', 'clarify', 'question', 'challenge', 'evidence', 'synthesize'];

// Map DB relation row → API relation shape
function relationToApi(row: Record<string, unknown>, includeUsers = false) {
  const result: Record<string, unknown> = {
    id: row.id,
    space_id: row.space_id,
    source_note_id: row.source_note_id,
    target_note_id: row.target_note_id,
    relation_type: row.relation_type ?? 'extend',
    creator_id: row.creator_id,
    ai_suggested: row.ai_suggested ?? false,
    ai_accepted: row.ai_accepted,
    created_at: row.created_at,
  };

  if (includeUsers && row.users) {
    result.users = { name: (row.users as Record<string, unknown>).name ?? '' };
  }

  return result;
}

// GET /api/spaces/:spaceId/relations
// Get all relations for notes in a space.
router.get('/spaces/:spaceId/relations', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);

  await ensureSpaceAccess(spaceId, req.user!);

  const { data, error } = await supabase
    .from('relations')
    .select('*, users!creator_id(name)')
    .eq('space_id', spaceId);

  if (error) throw new ApiError(500, error.message);
  res.json({ relations: (data ?? []).map((r: Record<string, unknown>) => relationToApi(r, true)) });
});

// GET /api/notes/:noteId/relations
router.get('/notes/:noteId/relations', verifyJWT, async (req: Request, res: Response) => {
  const noteId = String(req.params.noteId);

  await ensureNoteAccess(noteId, req.user!);

  const { data, error } = await supabase
    .from('relations')
    .select('*, users!creator_id(name)')
    .or(`source_note_id.eq.${noteId},target_note_id.eq.${noteId}`);

  if (error) throw new ApiError(500, error.message);
  res.json({ relations: (data ?? []).map((r: Record<string, unknown>) => relationToApi(r, true)) });
});

// POST /api/relations - create a Build-on relation
router.post('/relations', verifyJWT, async (req: Request, res: Response) => {
  const { source_note_id, target_note_id, space_id, relation_type = 'extend', ai_suggested = false, ai_accepted = false } = req.body;

  if (!source_note_id || !target_note_id) {
    throw new ApiError(400, 'source_note_id and target_note_id are required');
  }
  if (source_note_id === target_note_id) {
    throw new ApiError(400, 'A note cannot connect to itself');
  }
  if (!VALID_RELATION_TYPES.includes(relation_type)) {
    throw new ApiError(400, `Invalid relation_type. Must be one of: ${VALID_RELATION_TYPES.join(', ')}`);
  }
  if (typeof ai_suggested !== 'boolean') {
    throw new ApiError(400, 'ai_suggested must be a boolean');
  }
  if (typeof ai_accepted !== 'boolean') {
    throw new ApiError(400, 'ai_accepted must be a boolean');
  }

  const sourceNote = await ensureNoteAccess(source_note_id, req.user!);
  const targetNote = await ensureNoteAccess(target_note_id, req.user!);

  const finalSpaceId = sourceNote.space_id;
  if (space_id && space_id !== finalSpaceId) {
    throw new ApiError(400, 'space_id must match the source note space');
  }
  if (targetNote.space_id !== finalSpaceId) {
    throw new ApiError(400, 'Relations must stay inside one inquiry space');
  }

  // Check for duplicate relations (same source, target, and type)
  const { count } = await supabase
    .from('relations')
    .select('id', { count: 'exact', head: true })
    .eq('source_note_id', source_note_id)
    .eq('target_note_id', target_note_id)
    .eq('relation_type', relation_type);

  // Allow multiple relations of different types between same notes
  // But warn if same type exists
  if ((count ?? 0) > 0) {
    // Still allow for now, but could add a flag to skip duplicates
  }

  const { data: relation, error } = await supabase
    .from('relations')
    .insert({
      source_note_id,
      target_note_id,
      relation_type,
      creator_id: req.user!.id,
      space_id: finalSpaceId,
      ai_suggested,
      ai_accepted,
    })
    .select('*, users!creator_id(name)')
    .single();

  if (error) throw new ApiError(500, error.message);

  // Initialize relation_aggregates entry for this relation
  await supabase.from('relation_aggregates').insert({
    relation_id: relation.id,
    occurrence_count: 1,
    repeated_uptake_count: 0,
    latest_activity_at: new Date().toISOString(),
    cached_strength_score: 1.0,
  });

  // Update existing relation_aggregates for prior relations between same note pair
  // This tracks "repeated uptake" — how many times these notes interact
  const { data: priorRelations } = await supabase
    .from('relations')
    .select('id')
    .eq('source_note_id', source_note_id)
    .eq('target_note_id', target_note_id)
    .neq('id', relation.id);

  if (priorRelations && priorRelations.length > 0) {
    const priorIds = priorRelations.map(r => r.id);
    await supabase
      .from('relation_aggregates')
      .update({
        repeated_uptake_count: priorRelations.length,
        latest_activity_at: new Date().toISOString(),
      })
      .in('relation_id', priorIds);
  }

  // Update metrics for both notes
  await updateRelationMetrics(source_note_id, target_note_id, relation_type, req.user!.id);

  // Log the event
  await logEvent(req.user!.id, req.user!.role, 'build_on_created', 'note', source_note_id, finalSpaceId, {
    target_note_id,
    relation_type,
  });

  res.status(201).json({ relation: relationToApi(relation, true) });
});

// PUT /api/relations/:id/type - change relation type
router.put('/relations/:id/type', verifyJWT, async (req: Request, res: Response) => {
  const relationId = String(req.params.id);
  const { relation_type } = req.body;

  if (!relation_type || !VALID_RELATION_TYPES.includes(relation_type)) {
    throw new ApiError(400, `Invalid relation_type. Must be one of: ${VALID_RELATION_TYPES.join(', ')}`);
  }

  const { data: existing, error: fetchError } = await supabase
    .from('relations')
    .select('id, creator_id, source_note_id, target_note_id, space_id')
    .eq('id', relationId)
    .single();

  if (fetchError || !existing) throw new ApiError(404, 'Relation not found');
  const relationSpaceId = existing.space_id as string | null;
  const { standing } = relationSpaceId
    ? await ensureSpaceAccess(relationSpaceId, req.user!)
    : await ensureNoteAccess(existing.source_note_id as string, req.user!);

  // Only the creator or course staff can modify
  if (existing.creator_id !== req.user!.id && !isCourseStaff(standing)) {
    throw new ApiError(403, 'Insufficient permissions');
  }

  const { data, error } = await supabase
    .from('relations')
    .update({ relation_type })
    .eq('id', relationId)
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);

  res.json({ message: 'Relation type updated', relation: relationToApi(data) });
});

// DELETE /api/relations/:id
router.delete('/relations/:id', verifyJWT, async (req: Request, res: Response) => {
  const relationId = String(req.params.id);
  const { data: existing, error: fetchError } = await supabase
    .from('relations')
    .select('id, creator_id, source_note_id, target_note_id, relation_type, space_id')
    .eq('id', relationId)
    .single();

  if (fetchError || !existing) throw new ApiError(404, 'Relation not found');
  const relationSpaceId = existing.space_id as string | null;
  const { standing } = relationSpaceId
    ? await ensureSpaceAccess(relationSpaceId, req.user!)
    : await ensureNoteAccess(existing.source_note_id as string, req.user!);

  if (existing.creator_id !== req.user!.id && !isCourseStaff(standing)) {
    throw new ApiError(403, 'Insufficient permissions');
  }

  // Get space_id from source note for event logging
  const { data: sourceNote } = await supabase
    .from('notes')
    .select('space_id')
    .eq('id', existing.source_note_id)
    .single();

  const { error } = await supabase.from('relations').delete().eq('id', relationId);
  if (error) throw new ApiError(500, error.message);

  // Decrement metrics
  await decrementRelationMetrics(existing.source_note_id, existing.target_note_id, existing.relation_type);

  // Log event
  const spaceId = sourceNote?.space_id as string | null;
  await logEvent(req.user!.id, req.user!.role, 'relation_deleted', 'relation', existing.id as string, spaceId ?? null, {
    relation_type: existing.relation_type,
    source_note_id: existing.source_note_id,
    target_note_id: existing.target_note_id,
  });

  res.json({ message: 'Relation deleted' });
});

// Helper: Update note metrics when relation is created
async function updateRelationMetrics(sourceId: string, targetId: string, relationType: string, creatorId: string) {
  // Source Note: out_degree +1
  await supabase.rpc('increment_note_metric', {
    p_note_id: sourceId,
    p_field: 'direct_out_degree',
  });

  // Target Note: in_degree +1, build_on_count +1
  await supabase.rpc('increment_note_metric', {
    p_note_id: targetId,
    p_field: 'direct_in_degree',
  });
  await supabase.rpc('increment_note_metric', {
    p_note_id: targetId,
    p_field: 'build_on_count',
  });

  // Type-specific counters (only on target)
  const typeFieldMap: Record<string, string> = {
    extend: 'extend_count',
    clarify: 'clarify_count',
    question: 'question_count',
    challenge: 'challenge_count',
    evidence: 'evidence_count',
    synthesize: 'synthesis_count',
  };
  if (typeFieldMap[relationType]) {
    await supabase.rpc('increment_note_metric', {
      p_note_id: targetId,
      p_field: typeFieldMap[relationType],
    });
  }
  // Unresolved challenge counter
  if (relationType === 'challenge') {
    await supabase.rpc('increment_note_metric', {
      p_note_id: targetId,
      p_field: 'unresolved_challenges',
    });
  }

  // Update unique_contributor_count on target:
  // Count distinct creator_ids of relations pointing to this note
  const { data: contributors } = await supabase
    .from('relations')
    .select('creator_id')
    .eq('target_note_id', targetId);

  const uniqueCreators = new Set((contributors ?? []).map(r => r.creator_id));
  await supabase
    .from('note_metrics_realtime')
    .update({ unique_contributor_count: uniqueCreators.size, updated_at: new Date().toISOString() })
    .eq('note_id', targetId);

  // Recalculate heat_score for both notes
  await Promise.all([updateHeatScore(sourceId), updateHeatScore(targetId)]);
}

// Helper: Decrement metrics when relation is deleted
async function decrementRelationMetrics(sourceId: string, targetId: string, relationType: string) {
  // Source: out_degree -1
  await supabase.rpc('increment_note_metric', {
    p_note_id: sourceId,
    p_field: 'direct_out_degree',
    p_delta: -1,
  });

  // Target: in_degree -1, build_on_count -1
  await supabase.rpc('increment_note_metric', {
    p_note_id: targetId,
    p_field: 'direct_in_degree',
    p_delta: -1,
  });
  await supabase.rpc('increment_note_metric', {
    p_note_id: targetId,
    p_field: 'build_on_count',
    p_delta: -1,
  });

  // Type-specific counters (only on target) — decrement
  const decTypeFieldMap: Record<string, string> = {
    extend: 'extend_count', clarify: 'clarify_count', question: 'question_count',
    challenge: 'challenge_count', evidence: 'evidence_count', synthesize: 'synthesis_count',
  };
  if (decTypeFieldMap[relationType]) {
    await supabase.rpc('increment_note_metric', {
      p_note_id: targetId,
      p_field: decTypeFieldMap[relationType],
      p_delta: -1,
    });
  }
  if (relationType === 'challenge') {
    await supabase.rpc('increment_note_metric', {
      p_note_id: targetId,
      p_field: 'unresolved_challenges',
      p_delta: -1,
    });
  }

  // Recalculate unique_contributor_count on target
  const { data: contributors } = await supabase
    .from('relations')
    .select('creator_id')
    .eq('target_note_id', targetId);

  const uniqueCreators = new Set((contributors ?? []).map(r => r.creator_id));
  await supabase
    .from('note_metrics_realtime')
    .update({ unique_contributor_count: uniqueCreators.size, updated_at: new Date().toISOString() })
    .eq('note_id', targetId);

  // Recalculate heat_score for both notes
  await Promise.all([updateHeatScore(sourceId), updateHeatScore(targetId)]);
}

// Helper: Log an event
async function logEvent(
  actorId: string,
  actorRole: string,
  eventType: string,
  objectType: string,
  objectId: string,
  spaceId: string | null,
  metadata?: Record<string, unknown>
) {
  await supabase.from('events').insert({
    actor_id: actorId,
    actor_role: actorRole,
    event_type: eventType,
    object_type: objectType,
    object_id: objectId,
    space_id: spaceId,
    metadata_json: metadata ?? {},
  });
}

export default router;
