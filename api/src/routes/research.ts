/**
 * Research Routes — research summaries, analytics and exports.
 *
 * All endpoints require teacher or admin role.
 *
 * The per-space experiment_conditions / condition_assignments routes are gone:
 * those tables never existed in production, the routes checked no course, and
 * the trial's conditions live on groups / course_members (experimentCondition.ts).
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { anonymizeRow, getExportSalt } from '../services/anonymizer';
import { ensureCourseInstructor } from '../services/accessControl';
import { resolveSpaceIds } from '../services/researchScope';
import {
  DATASET_KEYS,
  DATASET_COLUMNS,
  DATASET_LABELS,
  type DatasetKey,
  type ExportFilters,
  resolveExportScope,
  buildAllDatasets,
  visibleColumns,
  datasetToCsv,
  buildReadme,
} from '../services/researchExport';
import { deriveAbbreviation, resolveParticipantCodes } from '../services/participantCode';
import { createZip } from '../services/zipWriter';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../middleware/rateLimitKey';

const router = Router();

// resolveSpaceIds now lives in services/researchScope so that this file,
// researchAdvanced and researchCharts all share one authorising implementation.

// Rate limiters for research routes
const researchExportLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many export requests' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

// ── Research Summary ──────────────────────────────────────────

// GET /api/spaces/:spaceId/research/summary — experiment overview
router.get(
  '/spaces/:spaceId/research/summary',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);

    const [conditionsRes, interventionsRes, eventsRes, notesRes, relationsRes] = await Promise.all([
      supabase
        .from('experiment_conditions')
        .select('id, condition_name, ai_enabled, woz_enabled')
        .in('space_id', spaceIds),
      supabase
        .from('ai_interventions')
        .select('id, accepted_flag')
        .in('space_id', spaceIds),
      supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .in('space_id', spaceIds),
      supabase
        .from('notes')
        .select('id, author_id', { count: 'exact' })
        .in('space_id', spaceIds)
        .is('deleted_at', null),
      supabase
        .from('relations')
        .select('id', { count: 'exact', head: true })
        .in('space_id', spaceIds),
    ]);

    const conditions = conditionsRes.data ?? [];
    const interventions = interventionsRes.data ?? [];
    const totalEvents = eventsRes.count ?? 0;
    const notes = notesRes.data ?? [];
    const totalNotes = notesRes.count ?? notes.length;
    const uniqueAuthors = new Set(notes.map(n => n.author_id)).size;
    const totalRelations = relationsRes.count ?? 0;

    res.json({
      summary: {
        condition_count: conditions.length,
        conditions: conditions.map(c => ({
          id: c.id,
          name: c.condition_name,
          ai_enabled: c.ai_enabled,
          woz_enabled: c.woz_enabled,
        })),
        total_notes: totalNotes,
        unique_authors: uniqueAuthors,
        total_relations: totalRelations,
        total_interventions: interventions.length,
        accepted_interventions: interventions.filter(i => i.accepted_flag === true).length,
        dismissed_interventions: interventions.filter(i => i.accepted_flag === false).length,
        pending_interventions: interventions.filter(i => i.accepted_flag === null).length,
        total_events: totalEvents,
      },
    });
  },
);

// GET /api/spaces/:spaceId/research/overview — enhanced overview with trends, sparklines, network, insights, activity feed
router.get(
  '/spaces/:spaceId/research/overview',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 7), 90);
    const now = new Date();
    const periodEnd = now.toISOString();
    const periodStart = new Date(now.getTime() - days * 86400000).toISOString();
    const prevPeriodStart = new Date(now.getTime() - days * 2 * 86400000).toISOString();

    const [
      notesCurrentRes, notesPrevRes,
      eventsCurrentRes, eventsPrevRes,
      relationsCurrentRes, relationsPrevRes,
      interventionsCurrentRes, interventionsPrevRes,
      recentInterventionsRes,
      allNotesForNetworkRes,
      allRelationsRes,
    ] = await Promise.all([
      supabase.from('notes').select('id, author_id, type, created_at').in('space_id', spaceIds).is('deleted_at', null).gte('created_at', periodStart).lte('created_at', periodEnd),
      supabase.from('notes').select('id, author_id, type, created_at').in('space_id', spaceIds).is('deleted_at', null).gte('created_at', prevPeriodStart).lt('created_at', periodStart),
      supabase.from('events').select('id, created_at', { count: 'exact' }).in('space_id', spaceIds).gte('created_at', periodStart).lte('created_at', periodEnd),
      supabase.from('events').select('id', { count: 'exact', head: true }).in('space_id', spaceIds).gte('created_at', prevPeriodStart).lt('created_at', periodStart),
      supabase.from('relations').select('id, relation_type, source_note_id, target_note_id, creator_id, created_at').in('space_id', spaceIds).gte('created_at', periodStart).lte('created_at', periodEnd),
      supabase.from('relations').select('id', { count: 'exact', head: true }).in('space_id', spaceIds).gte('created_at', prevPeriodStart).lt('created_at', periodStart),
      supabase.from('ai_interventions').select('id, accepted_flag, trigger_type, response_text, created_at').in('space_id', spaceIds).gte('created_at', periodStart).lte('created_at', periodEnd),
      supabase.from('ai_interventions').select('id, accepted_flag, trigger_type, created_at').in('space_id', spaceIds).gte('created_at', prevPeriodStart).lt('created_at', periodStart),
      supabase.from('ai_interventions').select('id, accepted_flag, trigger_type, response_text, created_at').in('space_id', spaceIds).order('created_at', { ascending: false }).limit(20),
      supabase.from('notes').select('id, author_id').in('space_id', spaceIds).is('deleted_at', null),
      supabase.from('relations').select('source_note_id, target_note_id, relation_type, creator_id').in('space_id', spaceIds),
    ]);

    // A failed query used to become `?? []`, rendering as a real-looking zero.
    // Surface it instead: a silently empty research card is worse than an error.
    for (const [label, res] of Object.entries({
      notesCurrent: notesCurrentRes, notesPrev: notesPrevRes,
      eventsCurrent: eventsCurrentRes, eventsPrev: eventsPrevRes,
      relationsCurrent: relationsCurrentRes, relationsPrev: relationsPrevRes,
      interventionsCurrent: interventionsCurrentRes, interventionsPrev: interventionsPrevRes,
      recentInterventions: recentInterventionsRes,
      allNotes: allNotesForNetworkRes, allRelations: allRelationsRes,
    })) {
      const err = (res as { error?: { message?: string } }).error;
      if (err) {
        console.error(`[ResearchOverview] ${label} query failed:`, err.message);
        throw new ApiError(500, `Research overview query failed (${label}): ${err.message}`);
      }
    }

    const notesCurrent = notesCurrentRes.data ?? [];
    const notesPrev = notesPrevRes.data ?? [];
    const eventsCurrent = eventsCurrentRes.data ?? [];
    const eventsCurrentCount = eventsCurrentRes.count ?? eventsCurrent.length;
    const eventsPrevCount = eventsPrevRes.count ?? 0;
    const relsCurrent = relationsCurrentRes.data ?? [];
    const relsCurrentCount = relsCurrent.length;
    const relsPrevCount = relationsPrevRes.count ?? 0;
    const currentInterventions = interventionsCurrentRes.data ?? [];
    const prevInterventions = interventionsPrevRes.data ?? [];
    const recentInterventions = recentInterventionsRes.data ?? [];
    const allNotesForNetwork = allNotesForNetworkRes.data ?? [];
    const allRelations = allRelationsRes.data ?? [];

    const currentAuthors = new Set(notesCurrent.map(n => n.author_id));
    const prevAuthors = new Set(notesPrev.map(n => n.author_id));

    const accepted = currentInterventions.filter(i => i.accepted_flag === true).length;
    const dismissed = currentInterventions.filter(i => i.accepted_flag === false).length;
    const pending = currentInterventions.filter(i => i.accepted_flag === null).length;
    const prevAccepted = prevInterventions.filter(i => i.accepted_flag === true).length;
    const prevDismissed = prevInterventions.filter(i => i.accepted_flag === false).length;
    const prevPending = prevInterventions.filter(i => i.accepted_flag === null).length;

    function pctChange(current: number, prev: number): number {
      if (prev === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - prev) / prev) * 1000) / 10;
    }

    // Sparkline: daily counts for the last 14 days
    const sparkDays = 14;
    const sparkStart = new Date(now.getTime() - sparkDays * 86400000);
    function buildSparkline(items: { created_at: string }[]): number[] {
      const counts = new Array(sparkDays).fill(0);
      for (const item of items) {
        const d = new Date(item.created_at);
        if (d >= sparkStart) {
          const idx = Math.floor((d.getTime() - sparkStart.getTime()) / 86400000);
          if (idx >= 0 && idx < sparkDays) counts[idx]++;
        }
      }
      return counts;
    }

    const stats = {
      total_notes: { value: notesCurrent.length, change: pctChange(notesCurrent.length, notesPrev.length), sparkline: buildSparkline(notesCurrent) },
      total_events: { value: eventsCurrentCount, change: pctChange(eventsCurrentCount, eventsPrevCount), sparkline: buildSparkline(eventsCurrent) },
      unique_authors: { value: currentAuthors.size, change: pctChange(currentAuthors.size, prevAuthors.size), sparkline: [] as number[] },
      total_relations: { value: relsCurrentCount, change: pctChange(relsCurrentCount, relsPrevCount), sparkline: buildSparkline(relsCurrent) },
      total_interventions: { value: currentInterventions.length, change: pctChange(currentInterventions.length, prevInterventions.length), sparkline: buildSparkline(currentInterventions) },
      accepted_interventions: { value: accepted, change: pctChange(accepted, prevAccepted), sparkline: [] as number[] },
      dismissed_interventions: { value: dismissed, change: pctChange(dismissed, prevDismissed), sparkline: [] as number[] },
      pending_interventions: { value: pending, change: pctChange(pending, prevPending), sparkline: [] as number[] },
    };

    // Activity timeline: daily notes + events (indexed by date for O(1) lookup)
    const timelineMap = new Map<string, { date: string; notes: number; events: number }>();
    const timelineStart = new Date(periodStart);
    for (let i = 0; i < days; i++) {
      const d = new Date(timelineStart.getTime() + i * 86400000);
      const ds = d.toISOString().slice(0, 10);
      timelineMap.set(ds, { date: ds, notes: 0, events: 0 });
    }
    for (const n of notesCurrent) {
      const entry = timelineMap.get(n.created_at.slice(0, 10));
      if (entry) entry.notes++;
    }
    for (const e of eventsCurrent) {
      const entry = timelineMap.get(e.created_at.slice(0, 10));
      if (entry) entry.events++;
    }
    const timeline = Array.from(timelineMap.values());

    // Intervention distribution (current period only, consistent with stat cards)
    const interventionDist = { accepted, dismissed, pending, total: currentInterventions.length };

    // Relation type distribution
    const relationTypeDist: Record<string, number> = {};
    for (const r of relsCurrent) {
      const rt = r.relation_type ?? 'unknown';
      relationTypeDist[rt] = (relationTypeDist[rt] ?? 0) + 1;
    }

    // Note type distribution (rise-above, regular, build-on)
    const noteTypeDist: Record<string, number> = {};
    for (const n of notesCurrent) {
      const nt = n.type ?? 'note';
      noteTypeDist[nt] = (noteTypeDist[nt] ?? 0) + 1;
    }
    const riseAboveCount = noteTypeDist['riseabove'] ?? 0;
    const prevRiseAboveCount = notesPrev.filter(n => n.type === 'riseabove').length;

    // Network stats: use ALL notes for author resolution so cross-period relations resolve correctly
    const noteAuthorMap = new Map<string, string>();
    for (const n of allNotesForNetwork) noteAuthorMap.set(n.id, n.author_id);

    const degreeMap = new Map<string, { in: number; out: number }>();
    let edgeCount = 0;
    for (const r of allRelations) {
      const s = noteAuthorMap.get(r.source_note_id);
      const t = noteAuthorMap.get(r.target_note_id);
      if (s && t && s !== t) {
        edgeCount++;
        if (!degreeMap.has(s)) degreeMap.set(s, { in: 0, out: 0 });
        if (!degreeMap.has(t)) degreeMap.set(t, { in: 0, out: 0 });
        degreeMap.get(s)!.out++;
        degreeMap.get(t)!.in++;
      }
    }
    const nodeCount = Math.max(currentAuthors.size, degreeMap.size);
    const maxEdges = nodeCount * (nodeCount - 1);
    const networkStats = {
      participants: nodeCount,
      active_participants: currentAuthors.size,
      density: maxEdges > 0 ? Math.round((edgeCount / maxEdges) * 100) / 100 : 0,
      avg_degree: nodeCount > 0 ? Math.round((edgeCount * 2 / nodeCount) * 10) / 10 : 0,
      avg_events_per_author: currentAuthors.size > 0 ? Math.round(eventsCurrentCount / currentAuthors.size * 10) / 10 : 0,
    };

    // Participation equity: Gini coefficient of note counts per author
    const authorNoteCounts = Array.from(
      notesCurrent.reduce((m, n) => m.set(n.author_id, (m.get(n.author_id) ?? 0) + 1), new Map<string, number>()).values()
    ).sort((a, b) => a - b);
    let gini = 0;
    if (authorNoteCounts.length > 1) {
      const totalNotes = authorNoteCounts.reduce((s, v) => s + v, 0);
      const n = authorNoteCounts.length;
      let sumWeighted = 0;
      for (let i = 0; i < n; i++) sumWeighted += (i + 1) * authorNoteCounts[i];
      gini = totalNotes > 0 ? Math.round(((2 * sumWeighted) / (n * totalNotes) - (n + 1) / n) * 100) / 100 : 0;
    }

    // Top contributors (by note count in current period)
    const authorNoteMap = new Map<string, number>();
    for (const n of notesCurrent) authorNoteMap.set(n.author_id, (authorNoteMap.get(n.author_id) ?? 0) + 1);
    const topContributors = Array.from(authorNoteMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([authorId, count]) => {
        const degree = degreeMap.get(authorId);
        return { authorId, noteCount: count, inDegree: degree?.in ?? 0, outDegree: degree?.out ?? 0 };
      });

    // Trigger type distribution for interventions
    const triggerTypeDist: Record<string, number> = {};
    for (const i of currentInterventions) {
      const tt = i.trigger_type ?? 'unknown';
      triggerTypeDist[tt] = (triggerTypeDist[tt] ?? 0) + 1;
    }

    // Build-on depth: longest chain via relations
    const childMap = new Map<string, string[]>();
    for (const r of allRelations) {
      if (!childMap.has(r.target_note_id)) childMap.set(r.target_note_id, []);
      childMap.get(r.target_note_id)!.push(r.source_note_id);
    }
    let maxBuildOnDepth = 0;
    const depthCache = new Map<string, number>();
    function getDepth(noteId: string, visited: Set<string>): number {
      if (depthCache.has(noteId)) return depthCache.get(noteId)!;
      if (visited.has(noteId)) return 0;
      visited.add(noteId);
      const children = childMap.get(noteId) ?? [];
      let d = 0;
      for (const c of children) d = Math.max(d, 1 + getDepth(c, visited));
      depthCache.set(noteId, d);
      return d;
    }
    for (const noteId of noteAuthorMap.keys()) {
      maxBuildOnDepth = Math.max(maxBuildOnDepth, getDepth(noteId, new Set()));
    }

    // AI insights — data-driven, structured for frontend i18n
    const insights: { type: string; icon: string; text: string; data?: Record<string, number | string> }[] = [];

    if (notesCurrent.length > 0) {
      const dailyAvg = Math.round(notesCurrent.length / Math.max(days, 1) * 10) / 10;
      const level = dailyAvg >= 3 ? 'high' : dailyAvg >= 1 ? 'moderate' : 'low';
      insights.push({
        type: 'activity', icon: 'line-chart-line',
        text: `日均笔记数 ${dailyAvg} 篇，讨论${level === 'high' ? '活跃' : level === 'moderate' ? '适中' : '不足'}。`,
        data: { dailyAvg, level, totalNotes: notesCurrent.length, days },
      });
    }

    if (currentInterventions.length > 0) {
      const acceptRate = Math.round(accepted / currentInterventions.length * 1000) / 10;
      insights.push({
        type: 'intervention', icon: 'robot-line',
        text: `AI 干预采纳率 ${acceptRate}%（${accepted}/${currentInterventions.length}），${acceptRate >= 30 ? '策略有效，建议保持' : '偏低，建议优化干预时机与提示内容'}。`,
        data: { acceptRate, accepted, dismissed, pending, total: currentInterventions.length },
      });
    }

    // Dominant relation type insight
    const sortedRelTypes = Object.entries(relationTypeDist).sort((a, b) => b[1] - a[1]);
    if (sortedRelTypes.length > 0 && relsCurrentCount > 0) {
      const [topType, topCount] = sortedRelTypes[0];
      const topPct = Math.round(topCount / relsCurrentCount * 100);
      insights.push({
        type: 'relation', icon: 'link',
        text: `关系类型以「${topType}」为主（${topPct}%），${sortedRelTypes.length >= 4 ? '类型分布较均衡' : '建议鼓励更多类型的互动（如质疑、证据、综合）'}。`,
        data: { topType, topPct, typeCount: sortedRelTypes.length },
      });
    }

    // Participation equity insight
    if (currentAuthors.size > 2) {
      const equityLevel = gini <= 0.2 ? 'equal' : gini <= 0.4 ? 'moderate' : 'unequal';
      insights.push({
        type: 'equity', icon: 'scales-3-line',
        text: `参与公平性 Gini=${gini}，${equityLevel === 'equal' ? '参与较为均衡' : equityLevel === 'moderate' ? '存在一定差异' : '少数学生贡献过高，建议关注低参与者'}。`,
        data: { gini, participants: currentAuthors.size, equityLevel },
      });
    }

    if (riseAboveCount > 0) {
      insights.push({
        type: 'riseabove', icon: 'mind-map',
        text: `本期产生 ${riseAboveCount} 个 Rise-above 笔记，${riseAboveCount >= 3 ? '综合升华活跃' : '可引导更多综合性思考'}。`,
        data: { riseAboveCount, change: pctChange(riseAboveCount, prevRiseAboveCount) },
      });
    }

    if (pending > 5) {
      insights.push({
        type: 'action', icon: 'alarm-warning-line',
        text: `有 ${pending} 条 AI 干预待处理，建议优先跟进。`,
        data: { pending },
      });
    }

    // Key findings — data-driven, not static strings
    const findings: string[] = [];
    if (maxBuildOnDepth >= 3) {
      findings.push(`最深 Build-on 链达到 ${maxBuildOnDepth} 层，说明部分议题引发了持续深入的讨论。`);
    }
    if (currentAuthors.size > 3 && networkStats.density < 0.2) {
      findings.push(`网络密度仅 ${networkStats.density}，存在孤立节点，建议通过跨组活动促进更广泛的互动。`);
    } else if (networkStats.density >= 0.4) {
      findings.push(`网络密度 ${networkStats.density}，社区互动紧密，知识建构活跃。`);
    }
    if (gini > 0.5 && currentAuthors.size > 3) {
      const topAuthor = topContributors[0];
      if (topAuthor) {
        const topPct = Math.round(topAuthor.noteCount / notesCurrent.length * 100);
        findings.push(`参与不均衡（Gini=${gini}），排名第一的参与者贡献了 ${topPct}% 的笔记，建议关注低参与者。`);
      }
    }
    const dominantTrigger = Object.entries(triggerTypeDist).sort((a, b) => b[1] - a[1])[0];
    if (dominantTrigger && currentInterventions.length >= 5) {
      const [triggerName, triggerCount] = dominantTrigger;
      findings.push(`AI 干预触发类型以 ${triggerName} 为主（${triggerCount}/${currentInterventions.length}），可据此调整教学策略。`);
    }
    if (riseAboveCount === 0 && notesCurrent.length >= 10) {
      findings.push(`尚未出现 Rise-above 笔记，建议引导学生尝试综合多个观点形成更高层次的理解。`);
    }

    // Recent activity feed
    const recentActivities = recentInterventions.slice(0, 10).map(i => ({
      id: i.id,
      type: 'intervention' as const,
      status: i.accepted_flag === true ? 'accepted' : i.accepted_flag === false ? 'dismissed' : 'pending',
      message: (i.response_text ?? '').slice(0, 80),
      trigger_type: i.trigger_type,
      created_at: i.created_at,
    }));

    // KB-specific metrics
    const kbMetrics = {
      riseAboveCount,
      riseAboveChange: pctChange(riseAboveCount, prevRiseAboveCount),
      maxBuildOnDepth,
      gini,
      noteTypeDist,
      relationTypeDist,
      triggerTypeDist,
      topContributors,
    };

    res.json({
      days,
      period: { start: periodStart, end: periodEnd },
      stats,
      timeline,
      interventionDist,
      networkStats,
      insights,
      findings,
      recentActivities,
      kbMetrics,
    });
  },
);

// ── Research Exports (always anonymized) ──────────────────────

// POST /api/spaces/:spaceId/research/export/events — anonymized event export
router.post(
  '/spaces/:spaceId/research/export/events',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const { from, to, format = 'json' } = req.body;

    const salt = await getExportSalt(spaceIds[0]);

    let query = supabase
      .from('events')
      .select('*')
      .in('space_id', spaceIds)
      .order('created_at', { ascending: true });

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw new ApiError(500, error.message);

    const anonymized = (data ?? []).map(row =>
      anonymizeRow(row, salt, ['actor_id', 'user_id'], ['session_id'])
    );

    if (format === 'csv') {
      if (anonymized.length === 0) {
        res.status(200).send('');
        return;
      }
      const headers = Object.keys(anonymized[0]).join(',');
      const rows = anonymized.map(row =>
        Object.values(row)
          .map(v => (typeof v === 'object' ? JSON.stringify(v) : v))
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="research_events_${req.params.spaceId}.csv"`);
      res.send([headers, ...rows].join('\n'));
      return;
    }

    res.json({ events: anonymized, total: anonymized.length });
  },
);

// POST /api/spaces/:spaceId/research/export/network — anonymized network export
router.post(
  '/spaces/:spaceId/research/export/network',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const { format = 'json' } = req.body;

    const salt = await getExportSalt(spaceIds[0]);

    const { data: notes, error: notesError } = await supabase
      .from('notes')
      .select('id, title, author_id, type, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null);

    if (notesError) throw new ApiError(500, notesError.message);

    const noteIds = (notes ?? []).map(n => n.id);
    if (noteIds.length === 0) {
      res.json({ nodes: [], edges: [] });
      return;
    }

    const { data: relations } = await supabase
      .from('relations')
      .select('id, source_note_id, target_note_id, relation_type, creator_id, created_at')
      .or(`source_note_id.in.(${noteIds.join(',')}),target_note_id.in.(${noteIds.join(',')})`);

    const nodes = (notes ?? []).map(n => anonymizeRow(
      { id: n.id, title: n.title, author_id: n.author_id, type: n.type, created_at: n.created_at },
      salt,
      ['author_id'],
      [],
    ));

    const edges = (relations ?? []).map(r => anonymizeRow(
      { id: r.id, source: r.source_note_id, target: r.target_note_id, relation_type: r.relation_type, creator_id: r.creator_id, created_at: r.created_at },
      salt,
      ['creator_id'],
      [],
    ));

    if (format === 'gexf') {
      const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] ?? c));
      let gexf = '<?xml version="1.0" encoding="UTF-8"?>\n<gexf xmlns="http://gexf.net/1.3" version="1.3">\n';
      gexf += '  <meta><creator>HAKCC Research Export</creator></meta>\n';
      gexf += '  <graph defaultedgetype="directed">\n';
      gexf += '    <attributes class="node" mode="static"><attribute id="0" title="author_anon" type="string"/><attribute id="1" title="type" type="string"/></attributes>\n';
      gexf += '    <attributes class="edge" mode="static"><attribute id="0" title="relation_type" type="string"/></attributes>\n';
      gexf += '    <nodes>\n';
      for (const n of nodes) {
        gexf += `      <node id="${n.id}" label="${escapeXml(n.title)}"><attvalues><attvalue for="0" value="${n.author_id}"/><attvalue for="1" value="${n.type}"/></attvalues></node>\n`;
      }
      gexf += '    </nodes>\n    <edges>\n';
      for (const e of edges) {
        gexf += `      <edge id="${e.id}" source="${e.source}" target="${e.target}"><attvalues><attvalue for="0" value="${e.relation_type}"/></attvalues></edge>\n`;
      }
      gexf += '    </edges>\n  </graph>\n</gexf>';
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="research_network_${req.params.spaceId}.gexf"`);
      res.send(gexf);
      return;
    }

    res.json({ nodes, edges });
  },
);

// POST /api/spaces/:spaceId/research/export/interventions — AI intervention data export
router.post(
  '/spaces/:spaceId/research/export/interventions',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const { from, to, format = 'json' } = req.body;

    const salt = await getExportSalt(spaceIds[0]);

    let query = supabase
      .from('ai_interventions')
      .select('*')
      .in('space_id', spaceIds)
      .order('created_at', { ascending: true });

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw new ApiError(500, error.message);

    const anonymized = (data ?? []).map(row =>
      anonymizeRow(row, salt, ['user_id'], [])
    );

    if (format === 'csv') {
      if (anonymized.length === 0) {
        res.status(200).send('');
        return;
      }
      const headers = Object.keys(anonymized[0]).join(',');
      const rows = anonymized.map(row =>
        Object.values(row)
          .map(v => (typeof v === 'object' ? JSON.stringify(v) : v))
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="research_interventions_${req.params.spaceId}.csv"`);
      res.send([headers, ...rows].join('\n'));
      return;
    }

    res.json({ interventions: anonymized, total: anonymized.length });
  },
);

// ── Social Network Analysis (SNA) ──────────────────────────────

// POST /api/spaces/:spaceId/research/sna — compute SNA metrics
router.post(
  '/spaces/:spaceId/research/sna',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const salt = await getExportSalt(spaceIds[0]);

    // Get all notes with authors
    const { data: notes, error: notesErr } = await supabase
      .from('notes')
      .select('id, author_id, type, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null);
    if (notesErr) throw new ApiError(500, notesErr.message);

    const noteIds = (notes ?? []).map(n => n.id);
    if (noteIds.length === 0) {
      res.json({ metrics: { density: 0, nodeCount: 0, edgeCount: 0, components: 0 }, nodes: [], edges: [] });
      return;
    }

    // Get relations (build-on, reference, etc.)
    const { data: relations } = await supabase
      .from('relations')
      .select('id, source_note_id, target_note_id, relation_type, creator_id')
      .or(`source_note_id.in.(${noteIds.join(',')}),target_note_id.in.(${noteIds.join(',')})`);

    // Build author-level interaction graph
    const noteAuthorMap = new Map<string, string>();
    for (const n of notes ?? []) {
      noteAuthorMap.set(n.id, n.author_id);
    }

    const authorSet = new Set<string>();
    for (const n of notes ?? []) authorSet.add(n.author_id);
    const authors = Array.from(authorSet);

    // Adjacency: author A -> author B (A's note builds on B's note)
    const edgeWeights = new Map<string, number>();
    for (const r of relations ?? []) {
      const srcAuthor = noteAuthorMap.get(r.source_note_id);
      const tgtAuthor = noteAuthorMap.get(r.target_note_id);
      if (!srcAuthor || !tgtAuthor || srcAuthor === tgtAuthor) continue;
      const key = `${srcAuthor}|${tgtAuthor}`;
      edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
    }

    const nodeCount = authors.length;
    const edgeCount = edgeWeights.size;
    const maxEdges = nodeCount * (nodeCount - 1);
    const density = maxEdges > 0 ? edgeCount / maxEdges : 0;

    // Weighted degree (strength) + binary degree (distinct partners)
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    const inPartners = new Map<string, Set<string>>();
    const outPartners = new Map<string, Set<string>>();
    for (const [key, w] of edgeWeights) {
      const [src, tgt] = key.split('|');
      outDeg.set(src, (outDeg.get(src) ?? 0) + w);
      inDeg.set(tgt, (inDeg.get(tgt) ?? 0) + w);
      if (!outPartners.has(src)) outPartners.set(src, new Set());
      if (!inPartners.has(tgt)) inPartners.set(tgt, new Set());
      outPartners.get(src)!.add(tgt);
      inPartners.get(tgt)!.add(src);
    }

    // Reciprocity: fraction of directed edges that are mutual
    let mutualEdges = 0;
    for (const key of edgeWeights.keys()) {
      const [src, tgt] = key.split('|');
      if (edgeWeights.has(`${tgt}|${src}`)) mutualEdges++;
    }
    const reciprocity = edgeCount > 0 ? mutualEdges / edgeCount : 0;

    // Connected components (undirected)
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
    for (const a of authors) find(a);
    for (const key of edgeWeights.keys()) {
      const [src, tgt] = key.split('|');
      union(src, tgt);
    }
    const roots = new Set(authors.map(a => find(a)));

    // Betweenness centrality (BFS-based, Brandes algorithm simplified)
    const betweenness = new Map<string, number>();
    for (const a of authors) betweenness.set(a, 0);

    // Undirected adjacency, deduped: A|B and B|A must yield a single neighbor
    // entry each way, otherwise Brandes double-counts shortest paths (sigma).
    const adjacencySets = new Map<string, Set<string>>();
    for (const key of edgeWeights.keys()) {
      const [src, tgt] = key.split('|');
      if (!adjacencySets.has(src)) adjacencySets.set(src, new Set());
      if (!adjacencySets.has(tgt)) adjacencySets.set(tgt, new Set());
      adjacencySets.get(src)!.add(tgt);
      adjacencySets.get(tgt)!.add(src);
    }
    const adjacency = new Map<string, string[]>();
    for (const [k, s] of adjacencySets) adjacency.set(k, Array.from(s));

    for (const s of authors) {
      const stack: string[] = [];
      const pred = new Map<string, string[]>();
      const sigma = new Map<string, number>();
      const dist = new Map<string, number>();
      const delta = new Map<string, number>();
      for (const v of authors) { sigma.set(v, 0); dist.set(v, -1); delta.set(v, 0); pred.set(v, []); }
      sigma.set(s, 1); dist.set(s, 0);
      const queue = [s];
      let qi = 0;
      while (qi < queue.length) {
        const v = queue[qi++];
        stack.push(v);
        for (const w of adjacency.get(v) ?? []) {
          if (dist.get(w)! < 0) { dist.set(w, dist.get(v)! + 1); queue.push(w); }
          if (dist.get(w) === dist.get(v)! + 1) {
            sigma.set(w, sigma.get(w)! + sigma.get(v)!);
            pred.get(w)!.push(v);
          }
        }
      }
      while (stack.length > 0) {
        const w = stack.pop()!;
        for (const v of pred.get(w)!) {
          delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
        }
        if (w !== s) betweenness.set(w, betweenness.get(w)! + delta.get(w)!);
      }
    }
    // Normalize
    const normFactor = nodeCount > 2 ? (nodeCount - 1) * (nodeCount - 2) : 1;
    for (const [k, v] of betweenness) betweenness.set(k, v / normFactor);

    // Degree centrality (Freeman): distinct partners / (n-1), computed on the
    // binary graph; weighted strength is reported separately as in/outDegree.
    const binaryDegree = (a: string) =>
      new Set([...(inPartners.get(a) ?? []), ...(outPartners.get(a) ?? [])]).size;

    // Freeman degree centralization: how star-like the network is (0-1)
    const binaryDegrees = authors.map(a => binaryDegree(a));
    const maxBinaryDeg = binaryDegrees.length > 0 ? Math.max(...binaryDegrees) : 0;
    const centralizationDenom = (nodeCount - 1) * (nodeCount - 2);
    const degreeCentralization = centralizationDenom > 0
      ? binaryDegrees.reduce((s, d) => s + (maxBinaryDeg - d), 0) / centralizationDenom
      : 0;

    const noteCountByAuthor = new Map<string, number>();
    for (const n of notes ?? []) noteCountByAuthor.set(n.author_id, (noteCountByAuthor.get(n.author_id) ?? 0) + 1);

    // Build anonymized result
    const snaNodes = authors.map(a => ({
      id: anonymizeRow({ id: a }, salt, ['id'], []).id,
      noteCount: noteCountByAuthor.get(a) ?? 0,
      inDegree: inDeg.get(a) ?? 0,
      outDegree: outDeg.get(a) ?? 0,
      degreeCentrality: nodeCount > 1
        ? Math.round((binaryDegree(a) / (nodeCount - 1)) * 10000) / 10000
        : 0,
      betweennessCentrality: Math.round((betweenness.get(a) ?? 0) * 10000) / 10000,
    }));

    const snaEdges = Array.from(edgeWeights.entries()).map(([key, weight]) => {
      const [src, tgt] = key.split('|');
      return {
        source: anonymizeRow({ id: src }, salt, ['id'], []).id,
        target: anonymizeRow({ id: tgt }, salt, ['id'], []).id,
        weight,
      };
    });

    res.json({
      metrics: {
        density: Math.round(density * 10000) / 10000,
        nodeCount,
        edgeCount,
        components: roots.size,
        avgDegree: nodeCount > 0 ? Math.round((edgeCount * 2 / nodeCount) * 100) / 100 : 0,
        reciprocity: Math.round(reciprocity * 10000) / 10000,
        degreeCentralization: Math.round(degreeCentralization * 10000) / 10000,
      },
      nodes: snaNodes,
      edges: snaEdges,
    });
  },
);

// ── Lag Sequential Analysis (LSA) ──────────────────────────────

// POST /api/spaces/:spaceId/research/lsa — compute lag sequential analysis
router.post(
  '/spaces/:spaceId/research/lsa',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const { lag = 1, codeField = 'event_type', sessionGapMinutes = 30 } = req.body;

    if (typeof lag !== 'number' || lag < 1 || lag > 5) {
      throw new ApiError(400, 'lag must be 1-5');
    }
    const gapMs = Math.min(Math.max(Number(sessionGapMinutes) || 30, 5), 24 * 60) * 60 * 1000;

    // Get events ordered by time
    const { data: events, error } = await supabase
      .from('events')
      .select('id, event_type, actor_id, object_type, created_at, metadata_json')
      .in('space_id', spaceIds)
      .order('created_at', { ascending: true });

    if (error) throw new ApiError(500, error.message);
    if (!events || events.length < 2) {
      res.json({ codes: [], transitionMatrix: [], zScoreMatrix: [], transitionProbs: [], significantTransitions: [], codeFrequencies: {}, sessionCount: 0, totalTransitions: 0, lag, codeField });
      return;
    }

    const getCode = (e: { event_type: string; object_type: string | null }) => {
      if (codeField === 'object_type') return e.object_type ?? 'unknown';
      return e.event_type;
    };

    // Segment into sessions: a gap > sessionGapMinutes breaks the sequence so
    // transitions never span session boundaries (Bakeman & Gottman practice).
    const sessions: string[][] = [];
    let current: string[] = [];
    let prevTime = 0;
    for (const e of events) {
      const t = new Date(e.created_at).getTime();
      if (current.length > 0 && t - prevTime > gapMs) {
        if (current.length > lag) sessions.push(current);
        current = [];
      }
      current.push(getCode(e));
      prevTime = t;
    }
    if (current.length > lag) sessions.push(current);

    // Get unique codes across all retained sessions
    const codeSet = new Set<string>();
    for (const s of sessions) for (const c of s) codeSet.add(c);
    const codes = Array.from(codeSet).sort();
    const codeIndex = new Map(codes.map((c, i) => [c, i]));
    const n = codes.length;

    // Transition frequency matrix at specified lag, within sessions only
    const freq = Array.from({ length: n }, () => Array(n).fill(0));
    let totalTransitions = 0;
    for (const seq of sessions) {
      for (let i = 0; i < seq.length - lag; i++) {
        const from = codeIndex.get(seq[i]);
        const to = codeIndex.get(seq[i + lag]);
        if (from !== undefined && to !== undefined) {
          freq[from][to]++;
          totalTransitions++;
        }
      }
    }

    // Row and column marginals
    const rowSums = freq.map(row => row.reduce((a, b) => a + b, 0));
    const colSums = Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) colSums[j] += freq[i][j];
    }

    // Adjusted residuals (Allison & Liker 1982): z = (O-E)/sqrt(E(1-p_row)(1-p_col))
    const zScores = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (totalTransitions === 0) continue;
        const expected = (rowSums[i] * colSums[j]) / totalTransitions;
        if (expected <= 0) continue;
        const variance = expected * (1 - colSums[j] / totalTransitions) * (1 - rowSums[i] / totalTransitions);
        if (variance <= 0) continue;
        zScores[i][j] = Math.round(((freq[i][j] - expected) / Math.sqrt(variance)) * 100) / 100;
      }
    }

    // Row-normalized transition probabilities
    const transitionProbs = freq.map((row, i) =>
      row.map(v => (rowSums[i] > 0 ? Math.round((v / rowSums[i]) * 10000) / 10000 : 0)),
    );

    // Significant transitions: |z| >= 1.96 (p < .05, two-tailed)
    const significantTransitions: { from: string; to: string; observed: number; expected: number; z: number; prob: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (Math.abs(zScores[i][j]) >= 1.96 && freq[i][j] > 0) {
          const expected = totalTransitions > 0 ? (rowSums[i] * colSums[j]) / totalTransitions : 0;
          significantTransitions.push({
            from: codes[i],
            to: codes[j],
            observed: freq[i][j],
            expected: Math.round(expected * 100) / 100,
            z: zScores[i][j],
            prob: transitionProbs[i][j],
          });
        }
      }
    }
    significantTransitions.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

    // Code frequencies for context
    const codeFrequencies: Record<string, number> = {};
    for (const s of sessions) for (const c of s) codeFrequencies[c] = (codeFrequencies[c] ?? 0) + 1;

    res.json({
      codes,
      lag,
      codeField,
      sessionGapMinutes: gapMs / 60000,
      sessionCount: sessions.length,
      totalTransitions,
      transitionMatrix: freq,
      zScoreMatrix: zScores,
      transitionProbs,
      significantTransitions,
      codeFrequencies,
    });
  },
);

// ── Temporal Analysis (时序分析) ──────────────────────────────

router.post(
  '/spaces/:spaceId/research/temporal',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const { granularity = 'day', tzOffsetHours = 8 } = req.body; // day | week; default UTC+8 (course timezone)
    const tzOffset = Math.min(Math.max(Number(tzOffsetHours) || 0, -12), 14);
    const tzMs = tzOffset * 3600000;
    // Shift into course-local time before extracting date/hour/day-of-week
    const toLocal = (dateStr: string) => new Date(new Date(dateStr).getTime() + tzMs);

    // Get notes with timestamps
    const { data: notes } = await supabase
      .from('notes')
      .select('id, author_id, type, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    // Get events with timestamps
    const { data: events } = await supabase
      .from('events')
      .select('id, event_type, actor_id, object_type, created_at')
      .in('space_id', spaceIds)
      .order('created_at', { ascending: true });

    // Get relations with timestamps
    const { data: relations } = await supabase
      .from('relations')
      .select('id, relation_type, creator_id, created_at')
      .in('space_id', spaceIds)
      .order('created_at', { ascending: true });

    const allNotes = notes ?? [];
    const allEvents = events ?? [];
    const allRelations = relations ?? [];

    // --- Activity Timeline (daily/weekly counts) ---
    const timelineBuckets = new Map<string, { notes: number; events: number; relations: number }>();

    const toBucketKey = (dateStr: string): string => {
      const d = toLocal(dateStr);
      if (granularity === 'week') {
        // Monday of the local week, computed in UTC space on the shifted date
        const day = d.getUTCDay();
        const diff = day === 0 ? -6 : 1 - day;
        const monday = new Date(d.getTime() + diff * 86400000);
        return monday.toISOString().slice(0, 10);
      }
      return d.toISOString().slice(0, 10);
    };

    for (const n of allNotes) {
      const key = toBucketKey(n.created_at);
      const bucket = timelineBuckets.get(key) ?? { notes: 0, events: 0, relations: 0 };
      bucket.notes++;
      timelineBuckets.set(key, bucket);
    }
    for (const e of allEvents) {
      const key = toBucketKey(e.created_at);
      const bucket = timelineBuckets.get(key) ?? { notes: 0, events: 0, relations: 0 };
      bucket.events++;
      timelineBuckets.set(key, bucket);
    }
    for (const r of allRelations) {
      const key = toBucketKey(r.created_at);
      const bucket = timelineBuckets.get(key) ?? { notes: 0, events: 0, relations: 0 };
      bucket.relations++;
      timelineBuckets.set(key, bucket);
    }

    // Zero-fill gaps so averages, std-dev and burst detection reflect the
    // full calendar span, not only days that happened to have activity.
    const sortedKeys = Array.from(timelineBuckets.keys()).sort();
    if (granularity === 'day' && sortedKeys.length > 1) {
      const start = new Date(sortedKeys[0]);
      const end = new Date(sortedKeys[sortedKeys.length - 1]);
      for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
        const key = new Date(t).toISOString().slice(0, 10);
        if (!timelineBuckets.has(key)) {
          timelineBuckets.set(key, { notes: 0, events: 0, relations: 0 });
        }
      }
    }

    const timeline = Array.from(timelineBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    // --- Hour-of-day distribution (course-local time) ---
    const hourDist = Array(24).fill(0);
    for (const n of allNotes) {
      hourDist[toLocal(n.created_at).getUTCHours()]++;
    }
    for (const e of allEvents) {
      hourDist[toLocal(e.created_at).getUTCHours()]++;
    }

    // --- Day-of-week distribution (course-local time) ---
    const dayOfWeekDist = Array(7).fill(0);
    for (const n of allNotes) {
      dayOfWeekDist[toLocal(n.created_at).getUTCDay()]++;
    }
    for (const e of allEvents) {
      dayOfWeekDist[toLocal(e.created_at).getUTCDay()]++;
    }

    // --- Contribution heatmap (date → count, course-local) ---
    const heatmap: { date: string; count: number }[] = [];
    const heatmapMap = new Map<string, number>();
    for (const n of allNotes) {
      const d = toLocal(n.created_at).toISOString().slice(0, 10);
      heatmapMap.set(d, (heatmapMap.get(d) ?? 0) + 1);
    }
    for (const [date, count] of heatmapMap) {
      heatmap.push({ date, count });
    }
    heatmap.sort((a, b) => a.date.localeCompare(b.date));

    // --- Per-author temporal patterns ---
    const authorTimeline = new Map<string, { firstActivity: string; lastActivity: string; totalDays: number; activeDays: number }>();
    const authorDays = new Map<string, Set<string>>();
    for (const n of allNotes) {
      const d = toLocal(n.created_at).toISOString().slice(0, 10);
      if (!authorDays.has(n.author_id)) authorDays.set(n.author_id, new Set());
      authorDays.get(n.author_id)!.add(d);
    }
    for (const [authorId, days] of authorDays) {
      const sorted = Array.from(days).sort();
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalDays = Math.max(1, Math.ceil((new Date(last).getTime() - new Date(first).getTime()) / 86400000) + 1);
      authorTimeline.set(authorId, { firstActivity: first, lastActivity: last, totalDays, activeDays: days.size });
    }

    // --- Burst detection (days with >2 std dev above mean) ---
    const dailyCounts = timeline.map(t => t.notes + t.events);
    const mean = dailyCounts.length > 0 ? dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length : 0;
    const stdDev = dailyCounts.length > 1
      ? Math.sqrt(dailyCounts.reduce((acc, v) => acc + (v - mean) ** 2, 0) / dailyCounts.length)
      : 0;
    const burstThreshold = mean + 2 * stdDev;
    const bursts = timeline
      .filter((t, i) => dailyCounts[i] > burstThreshold && burstThreshold > 0)
      .map(t => ({ date: t.date, activity: t.notes + t.events + t.relations }));

    res.json({
      timeline,
      hourDistribution: hourDist,
      dayOfWeekDistribution: dayOfWeekDist,
      heatmap,
      authorPatterns: Array.from(authorTimeline.entries()).map(([id, p]) => ({ authorId: id, ...p })),
      bursts,
      stats: {
        totalDays: timeline.length,
        avgDailyNotes: allNotes.length > 0 && timeline.length > 0 ? Math.round((allNotes.length / timeline.length) * 100) / 100 : 0,
        avgDailyEvents: allEvents.length > 0 && timeline.length > 0 ? Math.round((allEvents.length / timeline.length) * 100) / 100 : 0,
        peakDay: timeline.reduce((best, t) => (t.notes + t.events > (best?.notes ?? 0) + (best?.events ?? 0)) ? t : best, timeline[0]),
        burstCount: bursts.length,
      },
    });
  },
);

// ── Discourse Analysis (话语分析) ──────────────────────────────

router.post(
  '/spaces/:spaceId/research/discourse',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);

    // Get notes with content metadata
    const { data: notes } = await supabase
      .from('notes')
      .select('id, author_id, type, title, content, epistemic_status, scaffold_id, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null);

    // Get all relations
    const { data: relations } = await supabase
      .from('relations')
      .select('id, source_note_id, target_note_id, relation_type, creator_id, created_at')
      .in('space_id', spaceIds);

    const allNotes = notes ?? [];
    const allRelations = relations ?? [];

    // --- Relation type distribution ---
    const relationTypeDist: Record<string, number> = {};
    for (const r of allRelations) {
      relationTypeDist[r.relation_type] = (relationTypeDist[r.relation_type] ?? 0) + 1;
    }

    // --- Note type distribution ---
    const noteTypeDist: Record<string, number> = {};
    for (const n of allNotes) {
      noteTypeDist[n.type] = (noteTypeDist[n.type] ?? 0) + 1;
    }

    // --- Epistemic status distribution ---
    const epistemicDist: Record<string, number> = {};
    for (const n of allNotes) {
      const status = n.epistemic_status ?? 'standard';
      epistemicDist[status] = (epistemicDist[status] ?? 0) + 1;
    }

    // --- Build-on chain depth analysis ---
    const noteIdSet = new Set(allNotes.map(n => n.id));
    const childrenMap = new Map<string, string[]>();
    for (const r of allRelations) {
      if (!noteIdSet.has(r.source_note_id) || !noteIdSet.has(r.target_note_id)) continue;
      if (!childrenMap.has(r.target_note_id)) childrenMap.set(r.target_note_id, []);
      childrenMap.get(r.target_note_id)!.push(r.source_note_id);
    }

    // Find root notes: not building on any *existing* note. A relation whose
    // target was deleted must not disqualify the source from being a root,
    // otherwise that whole chain becomes unreachable and drops out of stats.
    const hasParent = new Set<string>();
    for (const r of allRelations) {
      if (noteIdSet.has(r.source_note_id) && noteIdSet.has(r.target_note_id)) {
        hasParent.add(r.source_note_id);
      }
    }
    const roots = allNotes.filter(n => !hasParent.has(n.id)).map(n => n.id);

    // BFS to compute chain depths
    const chainDepths: number[] = [];
    const noteDepth = new Map<string, number>();
    const queue: { id: string; depth: number }[] = roots.map(id => ({ id, depth: 0 }));
    const visited = new Set<string>();
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      noteDepth.set(id, depth);
      chainDepths.push(depth);
      for (const child of childrenMap.get(id) ?? []) {
        if (!visited.has(child)) queue.push({ id: child, depth: depth + 1 });
      }
    }
    // Notes unreachable from any root (relation cycles): count at depth 0
    for (const nId of allNotes.map(n => n.id)) {
      if (!visited.has(nId)) {
        noteDepth.set(nId, 0);
        chainDepths.push(0);
      }
    }

    const maxDepth = chainDepths.length > 0 ? Math.max(...chainDepths) : 0;
    const avgDepth = chainDepths.length > 0 ? Math.round((chainDepths.reduce((a, b) => a + b, 0) / chainDepths.length) * 100) / 100 : 0;
    const depthDistribution: Record<number, number> = {};
    for (const d of chainDepths) {
      depthDistribution[d] = (depthDistribution[d] ?? 0) + 1;
    }

    // --- Content length analysis ---
    const contentLengths = allNotes
      .map(n => (n.content ?? '').replace(/<[^>]*>/g, '').length)
      .filter(l => l > 0);
    const avgContentLength = contentLengths.length > 0
      ? Math.round(contentLengths.reduce((a, b) => a + b, 0) / contentLengths.length)
      : 0;
    const contentLengthBuckets = [
      { range: '0-50', count: 0 },
      { range: '51-150', count: 0 },
      { range: '151-300', count: 0 },
      { range: '301-500', count: 0 },
      { range: '500+', count: 0 },
    ];
    for (const l of contentLengths) {
      if (l <= 50) contentLengthBuckets[0].count++;
      else if (l <= 150) contentLengthBuckets[1].count++;
      else if (l <= 300) contentLengthBuckets[2].count++;
      else if (l <= 500) contentLengthBuckets[3].count++;
      else contentLengthBuckets[4].count++;
    }

    // --- Per-author discourse profile ---
    const authorDiscourse = new Map<string, { notes: number; relations: number; avgDepth: number; types: Record<string, number> }>();
    const authorDepthSums = new Map<string, { sum: number; count: number }>();
    for (const n of allNotes) {
      if (!authorDiscourse.has(n.author_id)) {
        authorDiscourse.set(n.author_id, { notes: 0, relations: 0, avgDepth: 0, types: {} });
      }
      const ad = authorDiscourse.get(n.author_id)!;
      ad.notes++;
      const depth = noteDepth.get(n.id);
      if (depth !== undefined) {
        const agg = authorDepthSums.get(n.author_id) ?? { sum: 0, count: 0 };
        agg.sum += depth;
        agg.count++;
        authorDepthSums.set(n.author_id, agg);
      }
    }
    for (const r of allRelations) {
      if (!authorDiscourse.has(r.creator_id)) {
        authorDiscourse.set(r.creator_id, { notes: 0, relations: 0, avgDepth: 0, types: {} });
      }
      const ad = authorDiscourse.get(r.creator_id)!;
      ad.relations++;
      ad.types[r.relation_type] = (ad.types[r.relation_type] ?? 0) + 1;
    }
    for (const [authorId, agg] of authorDepthSums) {
      const ad = authorDiscourse.get(authorId);
      if (ad && agg.count > 0) ad.avgDepth = Math.round((agg.sum / agg.count) * 100) / 100;
    }

    res.json({
      relationTypeDist,
      noteTypeDist,
      epistemicDist,
      chainAnalysis: {
        maxDepth,
        avgDepth,
        depthDistribution,
        rootCount: roots.length,
        totalChains: roots.length,
      },
      contentAnalysis: {
        avgContentLength,
        lengthBuckets: contentLengthBuckets,
        totalWithContent: contentLengths.length,
      },
      authorProfiles: Array.from(authorDiscourse.entries()).map(([id, profile]) => ({
        authorId: id,
        ...profile,
      })),
      stats: {
        totalNotes: allNotes.length,
        totalRelations: allRelations.length,
        riseAboveCount: allNotes.filter(n => n.type === 'riseabove').length,
        questionRelationPct: allRelations.length > 0
          ? Math.round(((relationTypeDist['question'] ?? 0) / allRelations.length) * 100)
          : 0,
        challengeRelationPct: allRelations.length > 0
          ? Math.round(((relationTypeDist['challenge'] ?? 0) / allRelations.length) * 100)
          : 0,
      },
    });
  },
);

// ── Participation Equity (参与公平性) ──────────────────────────────

router.post(
  '/spaces/:spaceId/research/equity',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);

    // Get notes per author
    const { data: notes } = await supabase
      .from('notes')
      .select('id, author_id, type, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null);

    // Get relations per creator
    const { data: relations } = await supabase
      .from('relations')
      .select('id, source_note_id, target_note_id, relation_type, creator_id')
      .in('space_id', spaceIds);

    // Get course members for context; instructors are excluded so the
    // equity metrics reflect *student* participation only.
    const { data: spaces } = await supabase
      .from('spaces')
      .select('course_id')
      .in('id', spaceIds);
    const courseIds = [...new Set((spaces ?? []).map(s => s.course_id))];
    let allMembers: { user_id: string }[] = [];
    const instructorIds = new Set<string>();
    if (courseIds.length > 0) {
      const [membersRes, coursesRes] = await Promise.all([
        supabase.from('course_members').select('user_id').in('course_id', courseIds),
        supabase.from('courses').select('instructor_id').in('id', courseIds),
      ]);
      allMembers = membersRes.data ?? [];
      for (const c of coursesRes.data ?? []) {
        if (c.instructor_id) instructorIds.add(c.instructor_id);
      }
    }

    const allNotes = notes ?? [];
    const allRelations = relations ?? [];

    // --- Per-author contribution counts ---
    const authorContrib = new Map<string, { notes: number; relations: number; received: number; types: Record<string, number> }>();

    for (const n of allNotes) {
      if (!authorContrib.has(n.author_id)) {
        authorContrib.set(n.author_id, { notes: 0, relations: 0, received: 0, types: {} });
      }
      authorContrib.get(n.author_id)!.notes++;
      const t = n.type ?? 'note';
      authorContrib.get(n.author_id)!.types[t] = (authorContrib.get(n.author_id)!.types[t] ?? 0) + 1;
    }

    // Who builds on whom
    const noteAuthorMap = new Map<string, string>();
    for (const n of allNotes) noteAuthorMap.set(n.id, n.author_id);

    for (const r of allRelations) {
      if (!authorContrib.has(r.creator_id)) {
        authorContrib.set(r.creator_id, { notes: 0, relations: 0, received: 0, types: {} });
      }
      authorContrib.get(r.creator_id)!.relations++;

      // Target note's author received a build-on
      const targetAuthor = noteAuthorMap.get(r.target_note_id);
      if (targetAuthor && targetAuthor !== r.creator_id) {
        if (!authorContrib.has(targetAuthor)) {
          authorContrib.set(targetAuthor, { notes: 0, relations: 0, received: 0, types: {} });
        }
        authorContrib.get(targetAuthor)!.received++;
      }
    }

    // Include zero-contribution members, exclude instructors entirely
    const memberIds = new Set(allMembers.map(m => m.user_id));
    for (const mid of memberIds) {
      if (!authorContrib.has(mid)) {
        authorContrib.set(mid, { notes: 0, relations: 0, received: 0, types: {} });
      }
    }
    for (const iid of instructorIds) authorContrib.delete(iid);

    // --- Gini coefficient (sorted formula, O(n)) ---
    const contributions = Array.from(authorContrib.values()).map(c => c.notes + c.relations);
    contributions.sort((a, b) => a - b);
    const n = contributions.length;
    const totalContrib = contributions.reduce((a, b) => a + b, 0);
    let gini = 0;
    if (n > 1 && totalContrib > 0) {
      let sumWeighted = 0;
      for (let i = 0; i < n; i++) sumWeighted += (i + 1) * contributions[i];
      gini = Math.round(((2 * sumWeighted) / (n * totalContrib) - (n + 1) / n) * 10000) / 10000;
    }

    // --- Lorenz curve data (starts at origin) ---
    let lorenzCum = 0;
    const lorenz = [{ populationPct: 0, contributionPct: 0 }];
    for (let i = 0; i < n; i++) {
      lorenzCum += contributions[i];
      lorenz.push({
        populationPct: Math.round(((i + 1) / n) * 100),
        contributionPct: totalContrib > 0 ? Math.round((lorenzCum / totalContrib) * 100) : 0,
      });
    }

    // --- Silent students (below 50% of mean) ---
    const mean = n > 0 ? totalContrib / n : 0;
    const silentThreshold = mean * 0.5;
    const silentStudents = Array.from(authorContrib.entries())
      .filter(([, c]) => (c.notes + c.relations) < silentThreshold)
      .map(([id, c]) => ({
        authorId: id,
        totalContributions: c.notes + c.relations,
        notes: c.notes,
        relations: c.relations,
      }));

    // --- Top contributors ---
    const ranked = Array.from(authorContrib.entries())
      .map(([id, c]) => ({ authorId: id, ...c, total: c.notes + c.relations }))
      .sort((a, b) => b.total - a.total);

    // --- Interaction coverage (student-student pairs only, to match denominator) ---
    const interactionPairs = new Set<string>();
    for (const r of allRelations) {
      const targetAuthor = noteAuthorMap.get(r.target_note_id);
      if (targetAuthor && targetAuthor !== r.creator_id
        && !instructorIds.has(r.creator_id) && !instructorIds.has(targetAuthor)) {
        interactionPairs.add(`${r.creator_id}|${targetAuthor}`);
      }
    }
    const possiblePairs = n > 1 ? n * (n - 1) : 1;
    const interactionCoverage = Math.round((interactionPairs.size / possiblePairs) * 10000) / 10000;

    res.json({
      gini,
      lorenz,
      interactionCoverage,
      rankings: ranked,
      silentStudents,
      stats: {
        totalParticipants: n,
        activeParticipants: contributions.filter(c => c > 0).length,
        silentCount: silentStudents.length,
        meanContribution: Math.round(mean * 100) / 100,
        maxContribution: contributions[n - 1] ?? 0,
        minContribution: contributions[0] ?? 0,
        stdDev: n > 1
          ? Math.round(Math.sqrt(contributions.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n) * 100) / 100
          : 0,
      },
    });
  },
);

// ── AI Insights (AI 智能建议) ──────────────────────────────

router.post(
  '/spaces/:spaceId/research/ai-insights',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);

    // Gather aggregated data for AI analysis
    const [notesRes, relationsRes, eventsRes, interventionsRes] = await Promise.all([
      supabase
        .from('notes')
        .select('id, author_id, type, content, epistemic_status, created_at')
        .in('space_id', spaceIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('relations')
        .select('id, source_note_id, target_note_id, relation_type, creator_id, created_at')
        .in('space_id', spaceIds)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('events')
        .select('id, event_type, actor_id, created_at')
        .in('space_id', spaceIds)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('ai_interventions')
        .select('id, accepted_flag, trigger_type, created_at')
        .in('space_id', spaceIds),
    ]);

    const allNotes = notesRes.data ?? [];
    const allRelations = relationsRes.data ?? [];
    const allEvents = eventsRes.data ?? [];
    const interventions = interventionsRes.data ?? [];

    // Compute insights without LLM (rule-based for now)
    const insights: { type: string; severity: 'high' | 'medium' | 'low'; title: string; description: string; metric?: string }[] = [];

    // Fetch student roster so members who never posted are also counted
    const { data: aiSpaces } = await supabase.from('spaces').select('course_id').in('id', spaceIds);
    const aiCourseIds = [...new Set((aiSpaces ?? []).map(s => s.course_id))];
    const rosterIds = new Set<string>();
    const rosterInstructors = new Set<string>();
    if (aiCourseIds.length > 0) {
      const [membersRes, coursesRes] = await Promise.all([
        supabase.from('course_members').select('user_id').in('course_id', aiCourseIds),
        supabase.from('courses').select('instructor_id').in('id', aiCourseIds),
      ]);
      for (const m of membersRes.data ?? []) rosterIds.add(m.user_id);
      for (const c of coursesRes.data ?? []) {
        if (c.instructor_id) rosterInstructors.add(c.instructor_id);
      }
      for (const iid of rosterInstructors) rosterIds.delete(iid);
    }

    // 1. Inactive students: last activity > 3 days ago, or never posted at all
    const now = Date.now();
    const threeDaysAgo = now - 3 * 86400000;
    const authorLastActivity = new Map<string, number>();
    for (const n of allNotes) {
      if (rosterInstructors.has(n.author_id)) continue;
      const t = new Date(n.created_at).getTime();
      authorLastActivity.set(n.author_id, Math.max(authorLastActivity.get(n.author_id) ?? 0, t));
    }
    const staleAuthors = Array.from(authorLastActivity.entries()).filter(([, t]) => t < threeDaysAgo).length;
    const neverPosted = Array.from(rosterIds).filter(id => !authorLastActivity.has(id)).length;
    const inactiveTotal = staleAuthors + neverPosted;
    const rosterSize = Math.max(rosterIds.size, authorLastActivity.size);
    if (inactiveTotal > 0) {
      insights.push({
        type: 'participation',
        severity: inactiveTotal > 3 ? 'high' : 'medium',
        title: `${inactiveTotal} 名学生超过 3 天未活跃${neverPosted > 0 ? `（其中 ${neverPosted} 人从未发帖）` : ''}`,
        description: '建议关注这些学生的参与情况，可通过提问或分配任务来激活讨论。',
        metric: `${inactiveTotal}/${rosterSize}`,
      });
    }

    // 2. Check discourse diversity (if most relations are just "extend")
    const relationTypes: Record<string, number> = {};
    for (const r of allRelations) {
      relationTypes[r.relation_type] = (relationTypes[r.relation_type] ?? 0) + 1;
    }
    const totalRels = allRelations.length;
    const extendPct = totalRels > 0 ? ((relationTypes['extend'] ?? 0) / totalRels) * 100 : 0;
    if (extendPct > 70 && totalRels > 10) {
      insights.push({
        type: 'discourse',
        severity: 'medium',
        title: '话语类型单一：延伸型关系占比过高',
        description: `${Math.round(extendPct)}% 的互动为"延伸"类型，建议引导学生使用"质疑"、"证据"等更深层的知识建构话语。`,
        metric: `${Math.round(extendPct)}%`,
      });
    }

    // 3. Check for low question/challenge ratio
    const questionPct = totalRels > 0 ? ((relationTypes['question'] ?? 0) + (relationTypes['challenge'] ?? 0)) / totalRels * 100 : 0;
    if (questionPct < 10 && totalRels > 10) {
      insights.push({
        type: 'discourse',
        severity: 'low',
        title: '批判性话语不足',
        description: `"提问"和"质疑"类型关系仅占 ${Math.round(questionPct)}%，社区缺少深度批判性对话。建议设置需要质证的探究问题。`,
        metric: `${Math.round(questionPct)}%`,
      });
    }

    // 4. Check contribution equity
    const authorCounts = new Map<string, number>();
    for (const n of allNotes) {
      authorCounts.set(n.author_id, (authorCounts.get(n.author_id) ?? 0) + 1);
    }
    const counts = Array.from(authorCounts.values()).sort((a, b) => a - b);
    if (counts.length > 3) {
      const top20Pct = counts.slice(Math.floor(counts.length * 0.8));
      const top20Share = top20Pct.reduce((a, b) => a + b, 0) / counts.reduce((a, b) => a + b, 0) * 100;
      if (top20Share > 60) {
        insights.push({
          type: 'equity',
          severity: 'high',
          title: '参与不均衡：少数学生贡献了大部分内容',
          description: `前 20% 的学生贡献了 ${Math.round(top20Share)}% 的笔记，建议采用分组讨论或轮流发言机制促进公平参与。`,
          metric: `${Math.round(top20Share)}%`,
        });
      }
    }

    // 5. Check AI intervention acceptance rate
    if (interventions.length > 10) {
      const accepted = interventions.filter(i => i.accepted_flag === true).length;
      const acceptRate = (accepted / interventions.length) * 100;
      if (acceptRate < 30) {
        insights.push({
          type: 'ai_effectiveness',
          severity: 'medium',
          title: 'AI 干预采纳率偏低',
          description: `学生仅采纳了 ${Math.round(acceptRate)}% 的 AI 建议，可能需要调整 AI 反馈的时机或内容策略。`,
          metric: `${Math.round(acceptRate)}%`,
        });
      }
    }

    // 6. Check for declining activity trend
    if (allNotes.length > 20) {
      const sorted = [...allNotes].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const midpoint = Math.floor(sorted.length / 2);
      const firstHalfDays = new Set(sorted.slice(0, midpoint).map(n => n.created_at.slice(0, 10))).size;
      const secondHalfDays = new Set(sorted.slice(midpoint).map(n => n.created_at.slice(0, 10))).size;
      const firstRate = midpoint / Math.max(firstHalfDays, 1);
      const secondRate = (sorted.length - midpoint) / Math.max(secondHalfDays, 1);
      if (secondRate < firstRate * 0.5 && firstRate > 2) {
        insights.push({
          type: 'trend',
          severity: 'high',
          title: '活跃度明显下降',
          description: '近期日均笔记数相比前期下降超过 50%，社区活力可能正在衰减。建议引入新的探究问题或活动激发讨论。',
          metric: `${Math.round(secondRate * 10) / 10} vs ${Math.round(firstRate * 10) / 10} 篇/天`,
        });
      }
    }

    // 7. Rise-above opportunity
    const riseAboveCount = allNotes.filter(n => n.type === 'riseabove').length;
    if (allNotes.length > 15 && riseAboveCount === 0) {
      insights.push({
        type: 'knowledge_building',
        severity: 'low',
        title: '尚未出现 Rise-above 笔记',
        description: '社区已有足够的笔记基础，但尚未有人进行概念提升（Rise-above）。建议引导学生综合已有观点形成更高层次的理解。',
      });
    }

    // Sort by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    res.json({
      insights,
      dataSnapshot: {
        totalNotes: allNotes.length,
        totalRelations: allRelations.length,
        totalEvents: allEvents.length,
        totalInterventions: interventions.length,
        uniqueAuthors: new Set(allNotes.map(n => n.author_id)).size,
      },
      generatedAt: new Date().toISOString(),
    });
  },
);


// ── Research export ────────────────────────────────────────────────────────
// One filter chain (course → space → group → view → date) feeds every table.
// Tables are previewed in the browser and downloaded as what you see.

function parseFilters(body: Record<string, unknown>): ExportFilters {
  const asIdArray = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const ids = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
    return ids.length > 0 ? ids.slice(0, 200) : undefined;
  };
  const asIso = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };
  return {
    spaceIds: asIdArray(body.space_ids),
    groupIds: asIdArray(body.group_ids),
    viewId: typeof body.view_id === 'string' && body.view_id ? body.view_id : undefined,
    from: asIso(body.from),
    to: asIso(body.to),
    includeAiGenerated: body.include_ai_generated !== false,
    includeSuppressed: body.include_suppressed !== false,
    includeDeleted: body.include_deleted !== false,
    includeNames: body.include_names === true,
    tzOffsetHours: typeof body.tz_offset_hours === 'number' ? body.tz_offset_hours : 8,
  };
}

function parseDatasets(value: unknown): DatasetKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter((d): d is DatasetKey =>
    typeof d === 'string' && (DATASET_KEYS as readonly string[]).includes(d));
}

// PUT /api/courses/:courseId/english-name — required before codes can be issued
router.put(
  '/courses/:courseId/english-name',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const courseId = String(req.params.courseId);
    await ensureCourseInstructor(courseId, req.user!);

    const englishName = typeof req.body?.english_name === 'string' ? req.body.english_name.trim() : '';
    if (englishName.length < 2) throw new ApiError(400, 'english_name is required');
    if (!/[A-Za-z]/.test(englishName)) throw new ApiError(400, 'english_name must contain Latin letters');

    const custom = typeof req.body?.code_abbr === 'string' ? req.body.code_abbr.trim().toUpperCase() : '';
    const abbr = /^[A-Z0-9]{2,8}$/.test(custom) ? custom : deriveAbbreviation(englishName);

    const { error } = await supabase
      .from('courses')
      .update({ english_name: englishName.slice(0, 200), code_abbr: abbr })
      .eq('id', courseId);
    if (error) throw new ApiError(500, error.message);

    // Issue codes right away so the export page is immediately usable.
    const codes = await resolveParticipantCodes(courseId);
    res.json({
      englishName: codes.englishName,
      abbr: codes.abbr,
      sample: Array.from(codes.identities.values()).slice(0, 3).map((i) => i.code),
    });
  },
);

// GET /api/courses/:courseId/research/export/options — filter + column metadata
router.get(
  '/courses/:courseId/research/export/options',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const courseId = String(req.params.courseId);
    await ensureCourseInstructor(courseId, req.user!);

    const [courseRes, spacesRes, groupsRes, membersRes] = await Promise.all([
      supabase.from('courses').select('title, english_name, code_abbr').eq('id', courseId).single(),
      supabase.from('spaces').select('id, title, group_id').eq('course_id', courseId).order('created_at'),
      supabase.from('groups').select('id, name, ai_feedback_condition').eq('course_id', courseId).order('created_at'),
      supabase.from('group_members').select('group_id, user_id'),
    ]);

    const spaces = spacesRes.data ?? [];
    const spaceIds = spaces.map((s) => s.id as string);
    const groupIds = new Set((groupsRes.data ?? []).map((g) => g.id as string));

    const memberCount = new Map<string, number>();
    for (const row of membersRes.data ?? []) {
      const gid = row.group_id as string;
      if (groupIds.has(gid)) memberCount.set(gid, (memberCount.get(gid) ?? 0) + 1);
    }

    // Views are string tags on notes.views — enumerate the ones holding data.
    const viewCounts = new Map<string, number>();
    let earliest: string | null = null;
    let latest: string | null = null;
    if (spaceIds.length > 0) {
      const { data: notes } = await supabase
        .from('notes')
        .select('views, created_at')
        .in('space_id', spaceIds)
        .limit(20000);
      for (const note of notes ?? []) {
        for (const view of (note.views as string[] | null) ?? []) {
          viewCounts.set(view, (viewCounts.get(view) ?? 0) + 1);
        }
        const at = note.created_at as string;
        if (at && (!earliest || at < earliest)) earliest = at;
        if (at && (!latest || at > latest)) latest = at;
      }
    }

    res.json({
      course: {
        title: courseRes.data?.title ?? '',
        englishName: (courseRes.data?.english_name as string | null) ?? null,
        abbr: (courseRes.data?.code_abbr as string | null) ?? null,
        suggestedAbbr: courseRes.data?.english_name ? deriveAbbreviation(courseRes.data.english_name as string) : null,
      },
      spaces: spaces.map((s) => ({ id: s.id, title: s.title, groupId: (s.group_id as string | null) ?? null })),
      groups: (groupsRes.data ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        condition: (g.ai_feedback_condition as string | null) ?? null,
        memberCount: memberCount.get(g.id as string) ?? 0,
      })),
      views: Array.from(viewCounts.entries())
        .map(([id, noteCount]) => ({ id, noteCount }))
        .sort((a, b) => b.noteCount - a.noteCount),
      dateRange: { earliest, latest },
      datasets: DATASET_KEYS.map((key) => ({
        key,
        ...DATASET_LABELS[key],
        columns: DATASET_COLUMNS[key],
      })),
    });
  },
);

// POST /api/courses/:courseId/research/export/table — rows for on-screen preview
router.post(
  '/courses/:courseId/research/export/table',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const courseId = String(req.params.courseId);
    await ensureCourseInstructor(courseId, req.user!);

    const filters = parseFilters(req.body ?? {});
    const scope = await resolveExportScope(courseId, filters);
    if (!scope.englishName) {
      res.json({ needsEnglishName: true, columns: [], rows: [], total: 0, counts: {}, warnings: [] });
      return;
    }

    const requested = parseDatasets(req.body?.datasets);
    const dataset: DatasetKey = requested[0] ?? 'notes';
    const limit = Math.min(Number(req.body?.limit) || 100, 500);

    const built = await buildAllDatasets(scope);
    const columns = visibleColumns(dataset, {
      includeNames: filters.includeNames,
      columns: Array.isArray(req.body?.columns) ? (req.body.columns as string[]) : undefined,
    });
    const rows = built.datasets[dataset].rows.slice(0, limit).map((row) => {
      const picked: Record<string, unknown> = {};
      for (const col of columns) picked[col.key] = row[col.key];
      return picked;
    });

    res.json({
      needsEnglishName: false,
      dataset,
      columns,
      rows,
      total: built.counts[dataset],
      counts: built.counts,
      truncated: built.truncated,
      warnings: built.warnings,
    });
  },
);

// POST /api/courses/:courseId/research/export/download — CSV, or ZIP for many
router.post(
  '/courses/:courseId/research/export/download',
  verifyJWT,
  researchExportLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const courseId = String(req.params.courseId);
    await ensureCourseInstructor(courseId, req.user!);

    const filters = parseFilters(req.body ?? {});
    const scope = await resolveExportScope(courseId, filters);
    if (!scope.englishName) throw new ApiError(400, '请先为课程填写英文名称，才能生成参与者编号');

    const selected = parseDatasets(req.body?.datasets);
    if (selected.length === 0) throw new ApiError(400, 'datasets is required');
    const headerLang = req.body?.header_lang === 'en' ? 'en' : 'zh';
    const columnFilter = Array.isArray(req.body?.columns) ? (req.body.columns as string[]) : undefined;

    const built = await buildAllDatasets(scope);
    const generatedAt = new Date().toISOString();
    const stamp = generatedAt.slice(0, 10).replace(/-/g, '');

    // A single table downloads as a plain CSV — exactly what the screen shows.
    if (selected.length === 1) {
      const key = selected[0];
      const columns = visibleColumns(key, { includeNames: filters.includeNames, columns: columnFilter });
      const csv = datasetToCsv(key, built.datasets[key].rows, columns, headerLang);
      const name = `${scope.abbr ?? 'course'}_${key}_${stamp}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.send(csv);
      return;
    }

    const files = selected.map((key) => ({
      name: `${key}.csv`,
      data: datasetToCsv(key, built.datasets[key].rows, visibleColumns(key, { includeNames: filters.includeNames }), headerLang),
    }));
    files.push({ name: 'README.md', data: buildReadme(scope, built, generatedAt, selected) });

    const zip = createZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${scope.abbr ?? 'course'}_export_${stamp}.zip"`);
    res.setHeader('Content-Length', String(zip.length));
    res.send(zip);
  },
);

export default router;
