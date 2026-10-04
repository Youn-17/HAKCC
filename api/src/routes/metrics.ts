import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { getSpaceMetricsSummary } from '../services/metricsService';
import { ensureSpaceAccess, ensureSpaceStaff, ensureNoteAccess } from '../services/accessControl';
import { clampNumber } from '../services/requestParams';

const router = Router();

// GET /api/spaces/:spaceId/metrics/summary - space metrics summary (any member)
router.get('/spaces/:spaceId/metrics/summary', verifyJWT, async (req: Request, res: Response) => {
  await ensureSpaceAccess(String(req.params.spaceId), req.user!);
  const summary = await getSpaceMetricsSummary(req.params.spaceId as string);
  res.json(summary);
});

// GET /api/spaces/:spaceId/metrics/hot-notes - top notes by heat score
router.get('/spaces/:spaceId/metrics/hot-notes', verifyJWT, async (req: Request, res: Response) => {
  await ensureSpaceAccess(String(req.params.spaceId), req.user!);
  const limit = clampNumber(req.query.limit, 1, 100, 10);

  const { data, error } = await supabase
    .from('note_metrics_realtime')
    .select(`
      note_id, heat_score, build_on_count, challenge_count, evidence_count,
      synthesis_count, unique_contributor_count,
      notes!inner(id, title, author_id, space_id, created_at, users!author_id(name))
    `)
    .eq('notes.space_id', req.params.spaceId)
    .is('notes.deleted_at', null)
    .order('heat_score', { ascending: false })
    .limit(limit);

  if (error) throw new ApiError(500, error.message);
  res.json({ hotNotes: data });
});

// GET /api/spaces/:spaceId/metrics/stagnant-notes - notes with no activity for N hours (any member)
router.get('/spaces/:spaceId/metrics/stagnant-notes', verifyJWT, async (req: Request, res: Response) => {
  await ensureSpaceAccess(String(req.params.spaceId), req.user!);
  // ?hours=abc used to reach new Date(NaN).toISOString(), which throws
  // RangeError and turned a malformed query into a 500.
  const hoursThreshold = clampNumber(req.query.hours, 1, 24 * 365, 48);
  const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('note_metrics_realtime')
    .select(`
      note_id, build_on_count, heat_score,
      notes!inner(id, title, author_id, space_id, created_at, users!author_id(name))
    `)
    .eq('notes.space_id', req.params.spaceId)
    .is('notes.deleted_at', null)
    .gte('build_on_count', 1)
    .lt('updated_at', cutoff);

  if (error) throw new ApiError(500, error.message);
  res.json({ stagnantNotes: data });
});

// GET /api/spaces/:spaceId/metrics/evidence-gaps - notes with challenge but no evidence (any member)
router.get('/spaces/:spaceId/metrics/evidence-gaps', verifyJWT, async (req: Request, res: Response) => {
  await ensureSpaceAccess(String(req.params.spaceId), req.user!);
  const { data, error } = await supabase
    .from('note_metrics_realtime')
    .select(`
      note_id, challenge_count, evidence_count,
      notes!inner(id, title, author_id, space_id, created_at, users!author_id(name))
    `)
    .eq('notes.space_id', req.params.spaceId)
    .is('notes.deleted_at', null)
    .gt('challenge_count', 0)
    .eq('evidence_count', 0);

  if (error) throw new ApiError(500, error.message);
  res.json({ evidenceGaps: data });
});

// GET /api/spaces/:spaceId/metrics/participation - per-student participation stats (course staff)
router.get('/spaces/:spaceId/metrics/participation', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { spaceId } = req.params;
  await ensureSpaceStaff(String(spaceId), req.user!);

  // Get note counts per author
  const { data: noteCounts, error: noteError } = await supabase
    .from('notes')
    .select('author_id, users!author_id(name, avatar)')
    .eq('space_id', spaceId)
    .is('deleted_at', null);

  if (noteError) throw new ApiError(500, noteError.message);

  // Aggregate by author
  const authorMap: Record<string, { name: string; avatar: string | null; noteCount: number; buildOnCount: number; lastActive: string | null }> = {};

  for (const note of noteCounts ?? []) {
    const author = (Array.isArray(note.users) ? note.users[0] : note.users) as { name: string; avatar: string | null } | null;
    if (!authorMap[note.author_id]) {
      authorMap[note.author_id] = { name: author?.name ?? 'Unknown', avatar: author?.avatar ?? null, noteCount: 0, buildOnCount: 0, lastActive: null };
    }
    authorMap[note.author_id].noteCount++;
  }

  // Get note IDs in this space for scoping relation queries
  const { data: spaceNotes } = await supabase
    .from('notes')
    .select('id')
    .eq('space_id', spaceId)
    .is('deleted_at', null);

  const noteIds = (spaceNotes ?? []).map((n) => n.id);

  // Get build-on counts per creator
  const { data: relationCounts } = await supabase
    .from('relations')
    .select('creator_id')
    .in('source_note_id', noteIds.length > 0 ? noteIds : ['__none__']);

  for (const rel of relationCounts ?? []) {
    if (authorMap[rel.creator_id]) {
      authorMap[rel.creator_id].buildOnCount++;
    }
  }

  // Fetch last activity per user in this space
  const { data: lastEvents } = await supabase
    .from('events')
    .select('actor_id, created_at')
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false });

  // Only keep the most recent event per actor
  for (const evt of lastEvents ?? []) {
    if (authorMap[evt.actor_id] && !authorMap[evt.actor_id].lastActive) {
      authorMap[evt.actor_id].lastActive = evt.created_at;
    }
  }

  const participation = Object.entries(authorMap).map(([userId, stats]) => ({
    userId,
    ...stats,
    activityScore: stats.noteCount * 1.0 + stats.buildOnCount * 0.5,
  }));

  res.json({ participation });
});

// GET /api/notes/:noteId/metrics - single note metrics
router.get('/notes/:noteId/metrics', verifyJWT, async (req: Request, res: Response) => {
  const { noteId } = req.params;
  await ensureNoteAccess(String(noteId), req.user!);

  const { data, error } = await supabase
    .from('note_metrics_realtime')
    .select('*')
    .eq('note_id', noteId)
    .single();

  if (error || !data) throw new ApiError(404, 'Note metrics not found');

  res.json({
    metrics: {
      noteId: data.note_id,
      directInDegree: data.direct_in_degree,
      directOutDegree: data.direct_out_degree,
      buildOnCount: data.build_on_count,
      uniqueContributorCount: data.unique_contributor_count,
      revisionCount: data.revision_count,
      challengeCount: data.challenge_count,
      evidenceCount: data.evidence_count,
      synthesisCount: data.synthesis_count,
      recentActivityScore: data.recent_activity_score,
      heatScore: data.heat_score,
      updatedAt: data.updated_at,
    },
  });
});

// GET /api/spaces/:spaceId/metrics/ai-summary - AI intervention summary (course staff)
router.get('/spaces/:spaceId/metrics/ai-summary', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { spaceId } = req.params;
  await ensureSpaceStaff(String(spaceId), req.user!);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Total AI interventions in this space
  const [totalResult, todayResult, acceptedResult, triggerTypes] = await Promise.all([
    supabase
      .from('ai_interventions')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId),
    supabase
      .from('ai_interventions')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .gte('created_at', today.toISOString()),
    supabase
      .from('ai_interventions')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('accepted_flag', true),
    supabase
      .from('ai_interventions')
      .select('trigger_type, user_id')
      .eq('space_id', spaceId),
  ]);

  // Aggregate trigger type distribution
  const typeDistribution: Record<string, number> = {};
  const uniqueUsers = new Set<string>();
  for (const row of triggerTypes.data ?? []) {
    typeDistribution[row.trigger_type] = (typeDistribution[row.trigger_type] ?? 0) + 1;
    if (row.user_id) uniqueUsers.add(row.user_id);
  }

  res.json({
    aiSummary: {
      totalInterventions: totalResult.count ?? 0,
      todayInterventions: todayResult.count ?? 0,
      acceptedCount: acceptedResult.count ?? 0,
      acceptanceRate: (totalResult.count ?? 0) > 0
        ? ((acceptedResult.count ?? 0) / (totalResult.count ?? 1)).toFixed(2)
        : '0.00',
      uniqueUsersEngaged: uniqueUsers.size,
      triggerTypeDistribution: typeDistribution,
    },
  });
});

// GET /api/spaces/:spaceId/metrics/student/:userId - detailed student metrics (course staff)
router.get('/spaces/:spaceId/metrics/student/:userId', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { spaceId, userId } = req.params;
  await ensureSpaceStaff(String(spaceId), req.user!);

  const [notesResult, relationsCreated, relationsReceived, eventsResult, aiResult] = await Promise.all([
    // Notes authored
    supabase
      .from('notes')
      .select('id, title, created_at, type')
      .eq('space_id', spaceId)
      .eq('author_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    // Relations created (build-ons given) — in this space only. Unscoped, it
    // counted the student's build-ons in every course, including ones the
    // caller has no standing in.
    supabase
      .from('relations')
      .select('id, relation_type, target_note_id, created_at')
      .eq('space_id', spaceId)
      .eq('creator_id', userId),
    // Relations received (build-ons on this user's notes)
    supabase
      .from('notes')
      .select('id')
      .eq('space_id', spaceId)
      .eq('author_id', userId)
      .is('deleted_at', null)
      .then(async ({ data: userNotes }) => {
        if (!userNotes?.length) return { data: [], error: null };
        return supabase
          .from('relations')
          .select('id, relation_type, source_note_id, created_at')
          .in('target_note_id', userNotes.map(n => n.id));
      }),
    // Recent activity (last event timestamp)
    supabase
      .from('events')
      .select('created_at')
      .eq('space_id', spaceId)
      .eq('actor_id', userId)
      .order('created_at', { ascending: false })
      .limit(1),
    // AI usage count
    supabase
      .from('ai_interventions')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('user_id', userId),
  ]);

  // Aggregate relation types given
  const relTypeGiven: Record<string, number> = {};
  for (const r of relationsCreated.data ?? []) {
    relTypeGiven[r.relation_type] = (relTypeGiven[r.relation_type] ?? 0) + 1;
  }

  // Aggregate relation types received
  const relTypeReceived: Record<string, number> = {};
  for (const r of (relationsReceived as any).data ?? []) {
    relTypeReceived[r.relation_type] = (relTypeReceived[r.relation_type] ?? 0) + 1;
  }

  res.json({
    studentMetrics: {
      userId,
      noteCount: notesResult.data?.length ?? 0,
      notes: (notesResult.data ?? []).map(n => ({ id: n.id, title: n.title, type: n.type, createdAt: n.created_at })),
      buildOnsGiven: relationsCreated.data?.length ?? 0,
      buildOnsReceived: (relationsReceived as any).data?.length ?? 0,
      relationTypesGiven: relTypeGiven,
      relationTypesReceived: relTypeReceived,
      aiInteractions: aiResult.count ?? 0,
      lastActive: eventsResult.data?.[0]?.created_at ?? null,
    },
  });
});

export default router;
