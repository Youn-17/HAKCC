/**
 * Metrics service: updates note_metrics_realtime after note/relation changes.
 * P0 uses synchronous inline updates. Heat formula is a linear proxy (full decay in P1).
 */
import { supabase } from '../config/supabase';

export async function incrementNoteMetric(
  noteId: string,
  field: 'build_on_count' | 'extend_count' | 'clarify_count' | 'question_count' | 'challenge_count' | 'evidence_count' | 'synthesis_count' | 'revision_count' | 'unresolved_challenges',
  delta: 1 | -1 = 1,
): Promise<void> {
  // Use a raw increment via RPC to avoid race conditions
  const { error } = await supabase.rpc('increment_note_metric', {
    p_note_id: noteId,
    p_field: field,
    p_delta: delta,
  });

  if (error) {
    console.error('[MetricsService] incrementNoteMetric failed:', error.message);
  }
}

export async function updateHeatScore(noteId: string): Promise<void> {
  // Simple linear heat score for P0: sum of weighted counts
  const { data, error } = await supabase
    .from('note_metrics_realtime')
    .select('build_on_count, unique_contributor_count, revision_count')
    .eq('note_id', noteId)
    .single();

  if (error || !data) return;

  const heat = (data.build_on_count * 1.0)
    + (data.unique_contributor_count * 2.0)
    + (data.revision_count * 0.3);

  await supabase
    .from('note_metrics_realtime')
    .update({ heat_score: heat, updated_at: new Date().toISOString() })
    .eq('note_id', noteId);
}

export async function incrementUniqueContributor(
  noteId: string,
  userId: string,
): Promise<void> {
  // Check if this user has already contributed a build-on to this note
  const { count } = await supabase
    .from('relations')
    .select('id', { count: 'exact', head: true })
    .eq('target_note_id', noteId)
    .eq('creator_id', userId);

  // Any prior build-on from this user means they are already counted as a contributor.
  if ((count ?? 0) >= 1) return;

  await supabase.rpc('increment_note_metric', {
    p_note_id: noteId,
    p_field: 'unique_contributor_count',
    p_delta: 1,
  });
}

export async function getSpaceMetricsSummary(spaceId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [activeUsers, newNotes, newRelations, unresolvedNotes, aiPrompts] =
    await Promise.all([
      supabase
        .from('events')
        .select('actor_id', { count: 'exact', head: false })
        .eq('space_id', spaceId)
        .gte('created_at', today.toISOString())
        .then(({ data }) => new Set(data?.map((e) => e.actor_id)).size),

      supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', spaceId)
        .eq('event_type', 'note_created')
        .gte('created_at', today.toISOString())
        .then(({ count }) => count ?? 0),

      supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', spaceId)
        .eq('event_type', 'build_on_created')
        .gte('created_at', today.toISOString())
        .then(({ count }) => count ?? 0),

      supabase
        .from('note_metrics_realtime')
        .select('note_id, notes!inner(space_id)', { count: 'exact', head: true })
        .eq('notes.space_id', spaceId)
        .is('notes.deleted_at', null)
        .gt('challenge_count', 0)
        .eq('evidence_count', 0)
        .then(({ count }) => count ?? 0),

      supabase
        .from('ai_interventions')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', spaceId)
        .gte('created_at', today.toISOString())
        .then(({ count }) => count ?? 0),
    ]);

  return { activeUsers, newNotes, newRelations, unresolvedNotes, aiPrompts };
}
