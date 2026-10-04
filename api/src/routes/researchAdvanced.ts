import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../middleware/rateLimitKey';
import { resolveSpaceIds } from '../services/researchScope';
import { numberInRange } from '../services/requestParams';

const router = Router();

// numberInRange is imported from services/requestParams
// resolveSpaceIds is imported from services/researchScope — see the note there
// on why the previous private copy was a security hole.

const researchLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many research requests' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

// ═══════════════════════════════════════════════════════════════════
// SNA Enhanced — Closeness, Eigenvector, Clustering, Reciprocity,
//                K-Core, Structural Holes (Burt's constraint)
// References: Freeman (1978), Burt (1992), Watts & Strogatz (1998)
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/spaces/:spaceId/research/sna-advanced',
  verifyJWT,
  researchLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);

    const { data: relations } = await supabase
      .from('relations')
      .select('id, source_note_id, target_note_id, relation_type, creator_id')
      .in('space_id', spaceIds);

    const { data: notes } = await supabase
      .from('notes')
      .select('id, author_id')
      .in('space_id', spaceIds)
      .is('deleted_at', null);

    const allRelations = relations ?? [];
    const allNotes = notes ?? [];
    const noteAuthor = new Map<string, string>();
    for (const n of allNotes) noteAuthor.set(n.id, n.author_id);

    // Build directed adjacency (author → author)
    const authors = new Set<string>();
    const adjOut = new Map<string, Map<string, number>>();
    const adjIn = new Map<string, Map<string, number>>();

    for (const r of allRelations) {
      const from = r.creator_id;
      const to = noteAuthor.get(r.target_note_id);
      if (!from || !to || from === to) continue;
      authors.add(from);
      authors.add(to);
      if (!adjOut.has(from)) adjOut.set(from, new Map());
      adjOut.get(from)!.set(to, (adjOut.get(from)!.get(to) ?? 0) + 1);
      if (!adjIn.has(to)) adjIn.set(to, new Map());
      adjIn.get(to)!.set(from, (adjIn.get(to)!.get(from) ?? 0) + 1);
    }

    const nodeList = Array.from(authors);
    const N = nodeList.length;
    const nodeIndex = new Map(nodeList.map((id, i) => [id, i]));

    // --- Closeness Centrality (Freeman 1978) ---
    // BFS shortest paths in undirected version
    const adjUndirected = new Map<number, Set<number>>();
    for (let i = 0; i < N; i++) adjUndirected.set(i, new Set());
    for (const [from, targets] of adjOut) {
      const fi = nodeIndex.get(from)!;
      for (const to of targets.keys()) {
        const ti = nodeIndex.get(to)!;
        adjUndirected.get(fi)!.add(ti);
        adjUndirected.get(ti)!.add(fi);
      }
    }

    const closeness: number[] = [];
    for (let src = 0; src < N; src++) {
      const dist = Array(N).fill(-1);
      dist[src] = 0;
      const queue = [src];
      let qi = 0;
      while (qi < queue.length) {
        const cur = queue[qi++];
        for (const nb of adjUndirected.get(cur) ?? []) {
          if (dist[nb] === -1) {
            dist[nb] = dist[cur] + 1;
            queue.push(nb);
          }
        }
      }
      const reachable = dist.filter(d => d > 0);
      closeness.push(reachable.length > 0
        ? Math.round((reachable.length / (N - 1)) * (reachable.length / reachable.reduce((a, b) => a + b, 0)) * 10000) / 10000
        : 0);
    }

    // --- Eigenvector Centrality (power iteration) ---
    let eigen = Array(N).fill(1 / N);
    for (let iter = 0; iter < 100; iter++) {
      const next = Array(N).fill(0);
      for (let i = 0; i < N; i++) {
        for (const nb of adjUndirected.get(i) ?? []) {
          next[i] += eigen[nb];
        }
      }
      const norm = Math.sqrt(next.reduce((a, b) => a + b * b, 0));
      if (norm === 0) break;
      const newEigen = next.map(v => v / norm);
      const diff = newEigen.reduce((acc, v, i) => acc + Math.abs(v - eigen[i]), 0);
      eigen = newEigen;
      if (diff < 1e-8) break;
    }

    // --- Local Clustering Coefficient (Watts & Strogatz 1998) ---
    const clustering: number[] = [];
    for (let i = 0; i < N; i++) {
      const neighbors = Array.from(adjUndirected.get(i) ?? []);
      const k = neighbors.length;
      if (k < 2) { clustering.push(0); continue; }
      let triangles = 0;
      for (let a = 0; a < neighbors.length; a++) {
        for (let b = a + 1; b < neighbors.length; b++) {
          if (adjUndirected.get(neighbors[a])!.has(neighbors[b])) triangles++;
        }
      }
      clustering.push(Math.round((2 * triangles / (k * (k - 1))) * 10000) / 10000);
    }
    const globalClustering = clustering.length > 0
      ? Math.round((clustering.reduce((a, b) => a + b, 0) / clustering.length) * 10000) / 10000
      : 0;

    // --- Reciprocity ---
    let reciprocalEdges = 0;
    let totalDirectedEdges = 0;
    for (const [from, targets] of adjOut) {
      for (const to of targets.keys()) {
        totalDirectedEdges++;
        if (adjOut.get(to)?.has(from)) reciprocalEdges++;
      }
    }
    const reciprocity = totalDirectedEdges > 0
      ? Math.round((reciprocalEdges / totalDirectedEdges) * 10000) / 10000
      : 0;

    // --- K-Core Decomposition ---
    const degree = Array(N).fill(0);
    for (let i = 0; i < N; i++) degree[i] = adjUndirected.get(i)?.size ?? 0;
    const coreNumber = [...degree];
    const removed = Array(N).fill(false);
    let maxCore = 0;

    for (let k = 1; k <= Math.max(...degree); k++) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < N; i++) {
          if (removed[i]) continue;
          let effectiveDeg = 0;
          for (const nb of adjUndirected.get(i) ?? []) {
            if (!removed[nb]) effectiveDeg++;
          }
          if (effectiveDeg < k) {
            removed[i] = true;
            coreNumber[i] = k - 1;
            changed = true;
          }
        }
      }
      if (removed.filter(r => !r).length > 0) maxCore = k;
    }
    for (let i = 0; i < N; i++) {
      if (!removed[i]) coreNumber[i] = maxCore;
    }

    // --- Structural Holes: Burt's Constraint (1992) ---
    const constraint: number[] = [];
    for (let i = 0; i < N; i++) {
      const neighbors = Array.from(adjUndirected.get(i) ?? []);
      if (neighbors.length === 0) { constraint.push(1); continue; }
      let totalConstraint = 0;
      for (const j of neighbors) {
        let pij = 1 / neighbors.length;
        let indirectSum = 0;
        for (const q of neighbors) {
          if (q === j) continue;
          const qNeighbors = adjUndirected.get(q) ?? new Set();
          if (qNeighbors.has(j)) {
            indirectSum += (1 / neighbors.length) * (1 / (qNeighbors.size || 1));
          }
        }
        totalConstraint += (pij + indirectSum) ** 2;
      }
      constraint.push(Math.round(totalConstraint * 10000) / 10000);
    }

    // --- Average Path Length (small-world check) ---
    let totalPathLength = 0;
    let pathCount = 0;
    for (let src = 0; src < N; src++) {
      const dist = Array(N).fill(-1);
      dist[src] = 0;
      const queue = [src];
      let qi = 0;
      while (qi < queue.length) {
        const cur = queue[qi++];
        for (const nb of adjUndirected.get(cur) ?? []) {
          if (dist[nb] === -1) {
            dist[nb] = dist[cur] + 1;
            queue.push(nb);
          }
        }
      }
      for (let t = 0; t < N; t++) {
        if (t !== src && dist[t] > 0) {
          totalPathLength += dist[t];
          pathCount++;
        }
      }
    }
    const avgPathLength = pathCount > 0 ? Math.round((totalPathLength / pathCount) * 1000) / 1000 : 0;

    // Build node-level response
    const nodeMetrics = nodeList.map((id, i) => ({
      authorId: id,
      closeness: closeness[i],
      eigenvector: Math.round(eigen[i] * 10000) / 10000,
      clustering: clustering[i],
      kCore: coreNumber[i],
      constraint: constraint[i],
    }));

    res.json({
      nodes: nodeMetrics,
      network: {
        globalClustering,
        reciprocity,
        avgPathLength,
        maxKCore: maxCore,
        smallWorldIndex: globalClustering > 0 && avgPathLength > 0
          ? Math.round((globalClustering / avgPathLength) * 1000) / 1000
          : 0,
      },
    });
  },
);

// ═══════════════════════════════════════════════════════════════════
// LSA Enhanced — Yule's Q, Adjusted Residuals, Actor Transitions,
//                Sequential Patterns, Stationarity Test
// References: Bakeman & Gottman (1997), Sackett (1979)
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/spaces/:spaceId/research/lsa-advanced',
  verifyJWT,
  researchLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const { codeField = 'relation_type' } = req.body;
    const lag = numberInRange(req.body?.lag, 'lag', 1, 5, 1);
    const minSupport = numberInRange(req.body?.minSupport, 'minSupport', 1, 1000, 3);

    // Get relations (ordered by time) for KB-specific LSA
    const { data: relations } = await supabase
      .from('relations')
      .select('id, source_note_id, target_note_id, relation_type, creator_id, created_at')
      .in('space_id', spaceIds)
      .order('created_at', { ascending: true });

    const { data: notes } = await supabase
      .from('notes')
      .select('id, author_id, type, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    const allRelations = relations ?? [];
    const allNotes = notes ?? [];

    // Build sequence based on codeField
    let sequence: { code: string; actor: string; time: string }[];
    if (codeField === 'relation_type') {
      sequence = allRelations.map(r => ({
        code: r.relation_type,
        actor: r.creator_id,
        time: r.created_at,
      }));
    } else {
      sequence = allNotes.map(n => ({
        code: n.type ?? 'note',
        actor: n.author_id,
        time: n.created_at,
      }));
    }

    if (sequence.length < 2) {
      res.json({ codes: [], transitions: [], yulesQ: [], adjustedResiduals: [], actorTransitions: {}, patterns: [], stationarity: null });
      return;
    }

    const codes = Array.from(new Set(sequence.map(s => s.code))).sort();
    const codeIndex = new Map(codes.map((c, i) => [c, i]));
    const n = codes.length;

    // Transition frequency matrix — transitions may not span session
    // boundaries (gap > 30 min), per Bakeman & Gottman sequential practice.
    const SESSION_GAP_MS = 30 * 60 * 1000;
    const freq = Array.from({ length: n }, () => Array(n).fill(0));
    let totalTransitions = 0;
    for (let i = 0; i < sequence.length - lag; i++) {
      let crossesBoundary = false;
      for (let k = i; k < i + lag; k++) {
        if (new Date(sequence[k + 1].time).getTime() - new Date(sequence[k].time).getTime() > SESSION_GAP_MS) {
          crossesBoundary = true;
          break;
        }
      }
      if (crossesBoundary) continue;
      const from = codeIndex.get(sequence[i].code);
      const to = codeIndex.get(sequence[i + lag].code);
      if (from !== undefined && to !== undefined) {
        freq[from][to]++;
        totalTransitions++;
      }
    }

    const rowSums = freq.map(row => row.reduce((a, b) => a + b, 0));
    const colSums = Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) colSums[j] += freq[i][j];
    }

    // --- Yule's Q (effect size for 2x2 contingency) ---
    const yulesQ = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = freq[i][j];
        const b = rowSums[i] - a;
        const c = colSums[j] - a;
        const d = totalTransitions - a - b - c;
        const denom = a * d + b * c;
        yulesQ[i][j] = denom !== 0 ? Math.round(((a * d - b * c) / denom) * 10000) / 10000 : 0;
      }
    }

    // --- Adjusted Residuals with significance (Haberman 1973) ---
    const adjustedResiduals = Array.from({ length: n }, () => Array(n).fill(0));
    const pValues = Array.from({ length: n }, () => Array(n).fill(1));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const expected = totalTransitions > 0 ? (rowSums[i] * colSums[j]) / totalTransitions : 0;
        if (expected > 0) {
          const residual = freq[i][j] - expected;
          const variance = expected * (1 - rowSums[i] / totalTransitions) * (1 - colSums[j] / totalTransitions);
          const adjRes = variance > 0 ? residual / Math.sqrt(variance) : 0;
          adjustedResiduals[i][j] = Math.round(adjRes * 100) / 100;
          // p-value approximation using standard normal
          const absZ = Math.abs(adjRes);
          pValues[i][j] = absZ > 3.29 ? 0.001 : absZ > 2.58 ? 0.01 : absZ > 1.96 ? 0.05 : 1;
        }
      }
    }

    // --- Significant transitions (|z| > 1.96) ---
    const significantTransitions: { from: string; to: string; freq: number; zScore: number; yulesQ: number; pValue: number; direction: string }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (Math.abs(adjustedResiduals[i][j]) > 1.96) {
          significantTransitions.push({
            from: codes[i],
            to: codes[j],
            freq: freq[i][j],
            zScore: adjustedResiduals[i][j],
            yulesQ: yulesQ[i][j],
            pValue: pValues[i][j],
            direction: adjustedResiduals[i][j] > 0 ? 'excitatory' : 'inhibitory',
          });
        }
      }
    }
    significantTransitions.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

    // --- Actor-wise transition patterns ---
    const actors = Array.from(new Set(sequence.map(s => s.actor)));
    const actorTransitions: Record<string, { dominantPattern: string; diversity: number; transitions: Record<string, number> }> = {};

    for (const actor of actors) {
      const actorSeq = sequence.filter(s => s.actor === actor);
      const trans: Record<string, number> = {};
      for (let i = 0; i < actorSeq.length - 1; i++) {
        const key = `${actorSeq[i].code}→${actorSeq[i + 1].code}`;
        trans[key] = (trans[key] ?? 0) + 1;
      }
      const entries = Object.entries(trans);
      const totalActorTrans = entries.reduce((a, [, v]) => a + v, 0);
      const dominant = entries.sort((a, b) => b[1] - a[1])[0];
      // Shannon entropy for transition diversity
      let entropy = 0;
      for (const [, count] of entries) {
        const p = count / totalActorTrans;
        if (p > 0) entropy -= p * Math.log2(p);
      }
      const maxEntropy = entries.length > 1 ? Math.log2(entries.length) : 1;
      actorTransitions[actor] = {
        dominantPattern: dominant ? dominant[0] : '',
        diversity: Math.round((entropy / maxEntropy) * 10000) / 10000,
        transitions: trans,
      };
    }

    // --- Sequential Pattern Mining (frequent bigrams/trigrams) ---
    const patterns: { pattern: string[]; count: number; support: number }[] = [];
    // Bigrams
    const bigramCount = new Map<string, number>();
    for (let i = 0; i < sequence.length - 1; i++) {
      const key = `${sequence[i].code}|${sequence[i + 1].code}`;
      bigramCount.set(key, (bigramCount.get(key) ?? 0) + 1);
    }
    for (const [key, count] of bigramCount) {
      if (count >= minSupport) {
        patterns.push({ pattern: key.split('|'), count, support: Math.round((count / (sequence.length - 1)) * 10000) / 10000 });
      }
    }
    // Trigrams
    const trigramCount = new Map<string, number>();
    for (let i = 0; i < sequence.length - 2; i++) {
      const key = `${sequence[i].code}|${sequence[i + 1].code}|${sequence[i + 2].code}`;
      trigramCount.set(key, (trigramCount.get(key) ?? 0) + 1);
    }
    for (const [key, count] of trigramCount) {
      if (count >= minSupport) {
        patterns.push({ pattern: key.split('|'), count, support: Math.round((count / (sequence.length - 2)) * 10000) / 10000 });
      }
    }
    patterns.sort((a, b) => b.count - a.count);

    // --- Stationarity Check (split-half comparison) ---
    const mid = Math.floor(sequence.length / 2);
    const firstHalf = sequence.slice(0, mid);
    const secondHalf = sequence.slice(mid);
    const codeDist1: Record<string, number> = {};
    const codeDist2: Record<string, number> = {};
    for (const s of firstHalf) codeDist1[s.code] = (codeDist1[s.code] ?? 0) + 1;
    for (const s of secondHalf) codeDist2[s.code] = (codeDist2[s.code] ?? 0) + 1;

    // Chi-square test for distribution difference
    let chiSquare = 0;
    for (const code of codes) {
      const o1 = codeDist1[code] ?? 0;
      const o2 = codeDist2[code] ?? 0;
      const e1 = (o1 + o2) * firstHalf.length / sequence.length;
      const e2 = (o1 + o2) * secondHalf.length / sequence.length;
      if (e1 > 0) chiSquare += (o1 - e1) ** 2 / e1;
      if (e2 > 0) chiSquare += (o2 - e2) ** 2 / e2;
    }
    const df = Math.max(codes.length - 1, 1);
    // Approximate p-value from chi-square
    const stationaryPValue = chiSquare < df ? 0.5 : chiSquare < 2 * df ? 0.1 : chiSquare < 3 * df ? 0.01 : 0.001;

    res.json({
      codes,
      lag,
      totalTransitions,
      transitionMatrix: freq,
      yulesQ,
      adjustedResiduals,
      pValues,
      significantTransitions,
      actorTransitions,
      patterns: patterns.slice(0, 20),
      stationarity: {
        chiSquare: Math.round(chiSquare * 100) / 100,
        df,
        pValue: stationaryPValue,
        isStationary: stationaryPValue > 0.05,
        firstHalfDist: codeDist1,
        secondHalfDist: codeDist2,
      },
    });
  },
);

// ═══════════════════════════════════════════════════════════════════
// Temporal Enhanced — Session Segmentation, Regularity Entropy,
//                     Momentum, Phase Detection, Rhythm Clustering
// References: Kovanović et al. (2015), Knight et al. (2017)
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/spaces/:spaceId/research/temporal-advanced',
  verifyJWT,
  researchLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const sessionGapMinutes = numberInRange(req.body?.sessionGapMinutes, 'sessionGapMinutes', 1, 1440, 30);
    const windowSize = numberInRange(req.body?.windowSize, 'windowSize', 1, 90, 7);

    const { data: notes } = await supabase
      .from('notes')
      .select('id, author_id, type, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    const { data: events } = await supabase
      .from('events')
      .select('id, event_type, actor_id, created_at')
      .in('space_id', spaceIds)
      .order('created_at', { ascending: true });

    const allNotes = notes ?? [];
    const allEvents = events ?? [];

    // Merge all activities with timestamps
    const activities: { authorId: string; time: number; type: string }[] = [];
    for (const n of allNotes) {
      activities.push({ authorId: n.author_id, time: new Date(n.created_at).getTime(), type: 'note' });
    }
    for (const e of allEvents) {
      activities.push({ authorId: e.actor_id, time: new Date(e.created_at).getTime(), type: 'event' });
    }
    activities.sort((a, b) => a.time - b.time);

    if (activities.length < 2) {
      res.json({ sessions: [], regularity: {}, momentum: [], phases: [], rhythmClusters: [] });
      return;
    }

    // --- Session Segmentation (gap-based) ---
    const gapMs = sessionGapMinutes * 60 * 1000;
    const sessions: { authorId: string; start: string; end: string; duration: number; activityCount: number }[] = [];
    const authorActivities = new Map<string, { time: number; type: string }[]>();
    for (const a of activities) {
      if (!authorActivities.has(a.authorId)) authorActivities.set(a.authorId, []);
      authorActivities.get(a.authorId)!.push({ time: a.time, type: a.type });
    }

    const authorSessions = new Map<string, { start: number; end: number; count: number }[]>();
    for (const [authorId, acts] of authorActivities) {
      const sesList: { start: number; end: number; count: number }[] = [];
      let sesStart = acts[0].time;
      let sesEnd = acts[0].time;
      let count = 1;
      for (let i = 1; i < acts.length; i++) {
        if (acts[i].time - sesEnd > gapMs) {
          sesList.push({ start: sesStart, end: sesEnd, count });
          sesStart = acts[i].time;
          sesEnd = acts[i].time;
          count = 1;
        } else {
          sesEnd = acts[i].time;
          count++;
        }
      }
      sesList.push({ start: sesStart, end: sesEnd, count });
      authorSessions.set(authorId, sesList);
      for (const s of sesList) {
        sessions.push({
          authorId,
          start: new Date(s.start).toISOString(),
          end: new Date(s.end).toISOString(),
          duration: Math.round((s.end - s.start) / 60000),
          activityCount: s.count,
        });
      }
    }

    // Session stats
    const sessionDurations = sessions.map(s => s.duration);
    const avgSessionDuration = sessionDurations.length > 0
      ? Math.round(sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length)
      : 0;
    const avgSessionActivity = sessions.length > 0
      ? Math.round((sessions.reduce((a, s) => a + s.activityCount, 0) / sessions.length) * 10) / 10
      : 0;

    // --- Regularity Analysis (entropy of inter-event intervals) ---
    const regularity: Record<string, { entropy: number; avgInterval: number; stdInterval: number; regularityScore: number }> = {};

    for (const [authorId, acts] of authorActivities) {
      if (acts.length < 3) continue;
      const intervals: number[] = [];
      for (let i = 1; i < acts.length; i++) {
        intervals.push(acts[i].time - acts[i - 1].time);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const stdInterval = Math.sqrt(intervals.reduce((a, v) => a + (v - avgInterval) ** 2, 0) / intervals.length);

      // Bin intervals into hours for entropy calculation
      const bins = new Map<number, number>();
      for (const interval of intervals) {
        const bin = Math.floor(interval / 3600000); // hour bins
        bins.set(bin, (bins.get(bin) ?? 0) + 1);
      }
      let entropy = 0;
      for (const count of bins.values()) {
        const p = count / intervals.length;
        if (p > 0) entropy -= p * Math.log2(p);
      }
      const maxEntropy = bins.size > 1 ? Math.log2(bins.size) : 1;
      const regularityScore = 1 - (maxEntropy > 0 ? entropy / maxEntropy : 0);

      regularity[authorId] = {
        entropy: Math.round(entropy * 1000) / 1000,
        avgInterval: Math.round(avgInterval / 60000),
        stdInterval: Math.round(stdInterval / 60000),
        regularityScore: Math.round(regularityScore * 10000) / 10000,
      };
    }

    // --- Momentum Analysis (sliding window contribution rate change) ---
    const dayBuckets = new Map<string, number>();
    for (const a of activities) {
      const day = new Date(a.time).toISOString().slice(0, 10);
      dayBuckets.set(day, (dayBuckets.get(day) ?? 0) + 1);
    }
    const sortedDays = Array.from(dayBuckets.entries()).sort(([a], [b]) => a.localeCompare(b));

    const momentum: { date: string; rate: number; acceleration: number }[] = [];
    for (let i = windowSize; i < sortedDays.length; i++) {
      const windowCounts = sortedDays.slice(i - windowSize, i).map(([, c]) => c);
      const prevWindowCounts = i >= windowSize * 2
        ? sortedDays.slice(i - windowSize * 2, i - windowSize).map(([, c]) => c)
        : [];
      const rate = windowCounts.reduce((a, b) => a + b, 0) / windowSize;
      const prevRate = prevWindowCounts.length > 0
        ? prevWindowCounts.reduce((a, b) => a + b, 0) / prevWindowCounts.length
        : rate;
      momentum.push({
        date: sortedDays[i][0],
        rate: Math.round(rate * 100) / 100,
        acceleration: Math.round((rate - prevRate) * 100) / 100,
      });
    }

    // --- Phase Detection (change-point analysis using CUSUM) ---
    const dailyCounts = sortedDays.map(([, c]) => c);
    const globalMean = dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length;
    const cusum: number[] = [];
    let cumSum = 0;
    for (const c of dailyCounts) {
      cumSum += (c - globalMean);
      cusum.push(cumSum);
    }

    // Find significant phase changes (peaks/troughs in CUSUM)
    const phases: { startDate: string; endDate: string; avgActivity: number; phase: string }[] = [];
    const changePoints: number[] = [0];
    for (let i = 1; i < cusum.length - 1; i++) {
      const diff = Math.abs(cusum[i] - cusum[i - 1]);
      if (diff > globalMean * 1.5) {
        changePoints.push(i);
      }
    }
    changePoints.push(sortedDays.length - 1);

    // Deduplicate close change points
    const filteredCPs = [changePoints[0]];
    for (let i = 1; i < changePoints.length; i++) {
      if (changePoints[i] - filteredCPs[filteredCPs.length - 1] >= 3) {
        filteredCPs.push(changePoints[i]);
      }
    }

    for (let i = 0; i < filteredCPs.length - 1; i++) {
      const startIdx = filteredCPs[i];
      const endIdx = filteredCPs[i + 1];
      const phaseCounts = dailyCounts.slice(startIdx, endIdx + 1);
      const phaseAvg = phaseCounts.reduce((a, b) => a + b, 0) / phaseCounts.length;
      phases.push({
        startDate: sortedDays[startIdx][0],
        endDate: sortedDays[endIdx][0],
        avgActivity: Math.round(phaseAvg * 100) / 100,
        phase: phaseAvg > globalMean * 1.3 ? 'high' : phaseAvg < globalMean * 0.7 ? 'low' : 'normal',
      });
    }

    // --- Circadian Rhythm Clustering ---
    const authorHourDist = new Map<string, number[]>();
    for (const a of activities) {
      if (!authorHourDist.has(a.authorId)) authorHourDist.set(a.authorId, Array(24).fill(0));
      const hour = new Date(a.time).getHours();
      authorHourDist.get(a.authorId)![hour]++;
    }

    // Simple clustering: morning (6-12), afternoon (12-18), evening (18-24), night (0-6)
    const rhythmClusters: { authorId: string; peakHour: number; type: string; distribution: number[] }[] = [];
    for (const [authorId, dist] of authorHourDist) {
      const total = dist.reduce((a, b) => a + b, 0);
      if (total < 3) continue;
      const normalized = dist.map(d => Math.round((d / total) * 1000) / 1000);
      const peakHour = dist.indexOf(Math.max(...dist));
      let type = 'night';
      if (peakHour >= 6 && peakHour < 12) type = 'morning';
      else if (peakHour >= 12 && peakHour < 18) type = 'afternoon';
      else if (peakHour >= 18) type = 'evening';
      rhythmClusters.push({ authorId, peakHour, type, distribution: normalized });
    }

    res.json({
      sessions: {
        list: sessions.slice(0, 200),
        stats: {
          totalSessions: sessions.length,
          avgDuration: avgSessionDuration,
          avgActivityPerSession: avgSessionActivity,
          medianDuration: sessionDurations.length > 0
            ? sessionDurations.sort((a, b) => a - b)[Math.floor(sessionDurations.length / 2)]
            : 0,
        },
      },
      regularity,
      momentum,
      phases,
      rhythmClusters,
    });
  },
);

// ═══════════════════════════════════════════════════════════════════
// Discourse Enhanced — KB Discourse Levels, Idea Diversity,
//                      Collective Cognitive Responsibility, Productive Discourse
// References: Bereiter & Scardamalia (2003), Zhang et al. (2009), van Aalst (2009)
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/spaces/:spaceId/research/discourse-advanced',
  verifyJWT,
  researchLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);

    const { data: notes } = await supabase
      .from('notes')
      .select('id, author_id, type, title, content, epistemic_status, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null);

    const { data: relations } = await supabase
      .from('relations')
      .select('id, source_note_id, target_note_id, relation_type, creator_id, created_at')
      .in('space_id', spaceIds);

    const allNotes = notes ?? [];
    const allRelations = relations ?? [];

    // --- Knowledge Building Discourse Levels (based on van Aalst 2009) ---
    // Level 1: Simple assertion / opinion
    // Level 2: Supported explanation (evidence, extend)
    // Level 3: Synthesis / connection-making (synthesize, multiple build-ons)
    // Level 4: Rise-above / theory building (riseabove type)

    const noteLevel = new Map<string, number>();
    const noteInDeg = new Map<string, number>();
    const noteOutDeg = new Map<string, number>();

    for (const r of allRelations) {
      noteInDeg.set(r.target_note_id, (noteInDeg.get(r.target_note_id) ?? 0) + 1);
      noteOutDeg.set(r.source_note_id, (noteOutDeg.get(r.source_note_id) ?? 0) + 1);
    }

    const synthesizeRelations = new Set(allRelations.filter(r => r.relation_type === 'synthesize').map(r => r.source_note_id));
    const evidenceRelations = new Set(allRelations.filter(r => r.relation_type === 'evidence').map(r => r.source_note_id));

    for (const n of allNotes) {
      if (n.type === 'riseabove') {
        noteLevel.set(n.id, 4);
      } else if (synthesizeRelations.has(n.id) || (noteOutDeg.get(n.id) ?? 0) >= 3) {
        noteLevel.set(n.id, 3);
      } else if (evidenceRelations.has(n.id) || (noteOutDeg.get(n.id) ?? 0) >= 1) {
        noteLevel.set(n.id, 2);
      } else {
        noteLevel.set(n.id, 1);
      }
    }

    const levelDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const level of noteLevel.values()) levelDist[level]++;

    const avgLevel = allNotes.length > 0
      ? Math.round((Array.from(noteLevel.values()).reduce((a, b) => a + b, 0) / allNotes.length) * 100) / 100
      : 0;

    // --- Idea Diversity (keyword-based topic diversity) ---
    // Extract simple word tokens from note content, compute diversity metrics
    const stopWords = new Set(['的', '了', '是', '在', '和', '有', '被', '将', '对', '与', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'that', 'this', 'it', 'not', 'but', 'and', 'or', 'as', 'if']);
    const wordFreq = new Map<string, number>();
    const authorTopics = new Map<string, Set<string>>();

    for (const n of allNotes) {
      const text = ((n.title ?? '') + ' ' + (n.content ?? '')).replace(/<[^>]*>/g, '').toLowerCase();
      const words = text.split(/[\s,.;!?，。；！？、]+/).filter(w => w.length > 1 && !stopWords.has(w));
      if (!authorTopics.has(n.author_id)) authorTopics.set(n.author_id, new Set());
      for (const w of words) {
        wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
        authorTopics.get(n.author_id)!.add(w);
      }
    }

    // Shannon diversity index for vocabulary
    const totalWords = Array.from(wordFreq.values()).reduce((a, b) => a + b, 0);
    let vocabularyEntropy = 0;
    for (const count of wordFreq.values()) {
      const p = count / totalWords;
      if (p > 0) vocabularyEntropy -= p * Math.log2(p);
    }

    // Top keywords (TF-IDF-like: frequent but not in every note)
    const noteCount = allNotes.length;
    const wordDocFreq = new Map<string, number>();
    for (const n of allNotes) {
      const text = ((n.title ?? '') + ' ' + (n.content ?? '')).replace(/<[^>]*>/g, '').toLowerCase();
      const uniqueWords = new Set(text.split(/[\s,.;!?，。；！？、]+/).filter(w => w.length > 1 && !stopWords.has(w)));
      for (const w of uniqueWords) {
        wordDocFreq.set(w, (wordDocFreq.get(w) ?? 0) + 1);
      }
    }

    const topKeywords = Array.from(wordFreq.entries())
      .map(([word, tf]) => {
        const df = wordDocFreq.get(word) ?? 1;
        const idf = Math.log(noteCount / df);
        return { word, score: tf * idf, tf, df };
      })
      .filter(w => w.df >= 2 && w.df < noteCount * 0.8)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    // --- Collective Cognitive Responsibility (Zhang et al. 2009) ---
    // Measures: distribution of idea authorship and improvement
    const authorIdeaContrib = new Map<string, { created: number; improvedByOthers: number; improvedOthers: number; level3Plus: number }>();

    for (const n of allNotes) {
      if (!authorIdeaContrib.has(n.author_id)) {
        authorIdeaContrib.set(n.author_id, { created: 0, improvedByOthers: 0, improvedOthers: 0, level3Plus: 0 });
      }
      authorIdeaContrib.get(n.author_id)!.created++;
      if ((noteLevel.get(n.id) ?? 1) >= 3) authorIdeaContrib.get(n.author_id)!.level3Plus++;
    }

    const noteAuthor = new Map(allNotes.map(n => [n.id, n.author_id]));
    for (const r of allRelations) {
      const targetAuthor = noteAuthor.get(r.target_note_id);
      if (targetAuthor && targetAuthor !== r.creator_id) {
        if (authorIdeaContrib.has(targetAuthor)) {
          authorIdeaContrib.get(targetAuthor)!.improvedByOthers++;
        }
        if (!authorIdeaContrib.has(r.creator_id)) {
          authorIdeaContrib.set(r.creator_id, { created: 0, improvedByOthers: 0, improvedOthers: 0, level3Plus: 0 });
        }
        authorIdeaContrib.get(r.creator_id)!.improvedOthers++;
      }
    }

    // CCR index: proportion of students contributing to idea improvement above threshold
    const ccrParticipants = Array.from(authorIdeaContrib.values()).filter(a => a.improvedOthers > 0).length;
    const totalParticipants = authorIdeaContrib.size;
    const ccrIndex = totalParticipants > 0
      ? Math.round((ccrParticipants / totalParticipants) * 10000) / 10000
      : 0;

    // --- Productive Discourse Indicators ---
    // Question → Answer chains, Challenge → Resolution patterns
    const questionNotes = new Set(allRelations.filter(r => r.relation_type === 'question').map(r => r.source_note_id));
    const challengeNotes = new Set(allRelations.filter(r => r.relation_type === 'challenge').map(r => r.source_note_id));

    // Find responses to questions (notes that build on question notes)
    let questionsResolved = 0;
    let challengesResolved = 0;
    for (const r of allRelations) {
      if (questionNotes.has(r.target_note_id) && r.relation_type !== 'question') questionsResolved++;
      if (challengeNotes.has(r.target_note_id) && r.relation_type !== 'challenge') challengesResolved++;
    }

    // --- Temporal discourse progression ---
    const sortedNotes = [...allNotes].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const thirds = Math.ceil(sortedNotes.length / 3);
    const progressionLevels = [
      sortedNotes.slice(0, thirds),
      sortedNotes.slice(thirds, thirds * 2),
      sortedNotes.slice(thirds * 2),
    ].map(chunk => {
      const levels = chunk.map(n => noteLevel.get(n.id) ?? 1);
      return levels.length > 0 ? Math.round((levels.reduce((a, b) => a + b, 0) / levels.length) * 100) / 100 : 0;
    });

    res.json({
      kbDiscourse: {
        levelDistribution: levelDist,
        avgLevel,
        progression: progressionLevels,
        levelDescriptions: {
          1: 'Simple assertion / opinion',
          2: 'Supported explanation with evidence',
          3: 'Synthesis / connection-making',
          4: 'Rise-above / theory building',
        },
      },
      ideaDiversity: {
        vocabularyEntropy: Math.round(vocabularyEntropy * 100) / 100,
        uniqueWords: wordFreq.size,
        totalWords,
        topKeywords,
        authorTopicCounts: Array.from(authorTopics.entries()).map(([id, topics]) => ({
          authorId: id,
          uniqueTopics: topics.size,
        })),
      },
      collectiveCognitiveResponsibility: {
        ccrIndex,
        participantsContributing: ccrParticipants,
        totalParticipants,
        authorContributions: Array.from(authorIdeaContrib.entries()).map(([id, c]) => ({
          authorId: id, ...c,
        })),
      },
      productiveDiscourse: {
        totalQuestions: questionNotes.size,
        questionsResolved,
        questionResolutionRate: questionNotes.size > 0
          ? Math.round((questionsResolved / questionNotes.size) * 10000) / 10000
          : 0,
        totalChallenges: challengeNotes.size,
        challengesResolved,
        challengeResolutionRate: challengeNotes.size > 0
          ? Math.round((challengesResolved / challengeNotes.size) * 10000) / 10000
          : 0,
      },
    });
  },
);

// ═══════════════════════════════════════════════════════════════════
// Equity Enhanced — Palma Ratio, Voice Equity, Temporal Equity,
//                   Quality-weighted Equity, Cross-group Interaction
// References: Palma (2011), Webb (2009), Stahl (2006)
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/spaces/:spaceId/research/equity-advanced',
  verifyJWT,
  researchLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const windowDays = numberInRange(req.body?.windowDays, 'windowDays', 1, 90, 7);

    const { data: notes } = await supabase
      .from('notes')
      .select('id, author_id, type, created_at')
      .in('space_id', spaceIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    const { data: relations } = await supabase
      .from('relations')
      .select('id, source_note_id, target_note_id, relation_type, creator_id, created_at')
      .in('space_id', spaceIds)
      .order('created_at', { ascending: true });

    const { data: spaces } = await supabase
      .from('spaces')
      .select('course_id')
      .in('id', spaceIds);
    const courseIds = [...new Set((spaces ?? []).map(s => s.course_id))];
    let allMembers: { user_id: string }[] = [];
    if (courseIds.length > 0) {
      const { data: members } = await supabase
        .from('course_members')
        .select('user_id')
        .in('course_id', courseIds);
      allMembers = members ?? [];
    }

    const allNotes = notes ?? [];
    const allRelations = relations ?? [];
    const memberIds = new Set(allMembers.map(m => m.user_id));

    const noteAuthor = new Map(allNotes.map(n => [n.id, n.author_id]));

    // Include all members
    const allAuthors = new Set([...allNotes.map(n => n.author_id), ...memberIds]);

    // --- Palma Ratio (top 10% / bottom 40%) ---
    const authorCounts = new Map<string, number>();
    for (const id of allAuthors) authorCounts.set(id, 0);
    for (const n of allNotes) {
      authorCounts.set(n.author_id, (authorCounts.get(n.author_id) ?? 0) + 1);
    }
    for (const r of allRelations) {
      authorCounts.set(r.creator_id, (authorCounts.get(r.creator_id) ?? 0) + 1);
    }
    const sortedCounts = Array.from(authorCounts.values()).sort((a, b) => a - b);
    const n = sortedCounts.length;
    const bottom40 = sortedCounts.slice(0, Math.ceil(n * 0.4)).reduce((a, b) => a + b, 0);
    const top10 = sortedCounts.slice(Math.floor(n * 0.9)).reduce((a, b) => a + b, 0);
    const palmaRatio = bottom40 > 0 ? Math.round((top10 / bottom40) * 100) / 100 : top10 > 0 ? Infinity : 1;

    // --- Voice Equity (who has been responded to) ---
    const respondedTo = new Set<string>();
    const respondedBy = new Set<string>();
    for (const r of allRelations) {
      const targetAuthor = noteAuthor.get(r.target_note_id);
      if (targetAuthor && targetAuthor !== r.creator_id) {
        respondedTo.add(targetAuthor);
        respondedBy.add(r.creator_id);
      }
    }
    const voiceEquity = allAuthors.size > 0
      ? Math.round((respondedTo.size / allAuthors.size) * 10000) / 10000
      : 0;

    // --- Quality-weighted Equity ---
    // Weight: note=1, extend=1, evidence=2, question=2, challenge=3, synthesize=3
    const qualityWeights: Record<string, number> = {
      extend: 1, clarify: 1.5, evidence: 2, question: 2, challenge: 3, synthesize: 3,
    };
    const authorQuality = new Map<string, number>();
    for (const id of allAuthors) authorQuality.set(id, 0);
    for (const n of allNotes) {
      const weight = n.type === 'riseabove' ? 4 : 1;
      authorQuality.set(n.author_id, (authorQuality.get(n.author_id) ?? 0) + weight);
    }
    for (const r of allRelations) {
      const weight = qualityWeights[r.relation_type] ?? 1;
      authorQuality.set(r.creator_id, (authorQuality.get(r.creator_id) ?? 0) + weight);
    }

    const qualityCounts = Array.from(authorQuality.values()).sort((a, b) => a - b);
    const qTotal = qualityCounts.reduce((a, b) => a + b, 0);
    let qualityGini = 0;
    if (qualityCounts.length > 1 && qTotal > 0) {
      let sumOfDiffs = 0;
      for (let i = 0; i < qualityCounts.length; i++) {
        for (let j = 0; j < qualityCounts.length; j++) {
          sumOfDiffs += Math.abs(qualityCounts[i] - qualityCounts[j]);
        }
      }
      qualityGini = Math.round((sumOfDiffs / (2 * qualityCounts.length * qTotal)) * 10000) / 10000;
    }

    // --- Temporal Equity (Gini over time windows) ---
    const temporalEquity: { windowStart: string; gini: number; activeCount: number }[] = [];
    if (allNotes.length > 0) {
      const startTime = new Date(allNotes[0].created_at).getTime();
      const endTime = new Date(allNotes[allNotes.length - 1].created_at).getTime();
      const windowMs = windowDays * 86400000;

      for (let wStart = startTime; wStart < endTime; wStart += windowMs) {
        const wEnd = wStart + windowMs;
        const windowCounts = new Map<string, number>();
        for (const id of allAuthors) windowCounts.set(id, 0);

        for (const n of allNotes) {
          const t = new Date(n.created_at).getTime();
          if (t >= wStart && t < wEnd) {
            windowCounts.set(n.author_id, (windowCounts.get(n.author_id) ?? 0) + 1);
          }
        }

        const wValues = Array.from(windowCounts.values()).sort((a, b) => a - b);
        const wTotal = wValues.reduce((a, b) => a + b, 0);
        let wGini = 0;
        if (wValues.length > 1 && wTotal > 0) {
          let sumD = 0;
          for (let i = 0; i < wValues.length; i++) {
            for (let j = 0; j < wValues.length; j++) {
              sumD += Math.abs(wValues[i] - wValues[j]);
            }
          }
          wGini = Math.round((sumD / (2 * wValues.length * wTotal)) * 10000) / 10000;
        }

        temporalEquity.push({
          windowStart: new Date(wStart).toISOString().slice(0, 10),
          gini: wGini,
          activeCount: wValues.filter(v => v > 0).length,
        });
      }
    }

    // --- Interaction Diversity (entropy of build-on targets) ---
    const authorInteractionTargets = new Map<string, Map<string, number>>();
    for (const r of allRelations) {
      const targetAuthor = noteAuthor.get(r.target_note_id);
      if (!targetAuthor || targetAuthor === r.creator_id) continue;
      if (!authorInteractionTargets.has(r.creator_id)) authorInteractionTargets.set(r.creator_id, new Map());
      const targets = authorInteractionTargets.get(r.creator_id)!;
      targets.set(targetAuthor, (targets.get(targetAuthor) ?? 0) + 1);
    }

    const interactionDiversity: { authorId: string; entropy: number; uniqueTargets: number; totalInteractions: number }[] = [];
    for (const [authorId, targets] of authorInteractionTargets) {
      const total = Array.from(targets.values()).reduce((a, b) => a + b, 0);
      let entropy = 0;
      for (const count of targets.values()) {
        const p = count / total;
        if (p > 0) entropy -= p * Math.log2(p);
      }
      const maxEntropy = targets.size > 1 ? Math.log2(targets.size) : 1;
      interactionDiversity.push({
        authorId,
        entropy: Math.round((maxEntropy > 0 ? entropy / maxEntropy : 0) * 10000) / 10000,
        uniqueTargets: targets.size,
        totalInteractions: total,
      });
    }

    res.json({
      palmaRatio,
      palmaInterpretation: palmaRatio > 2 ? 'highly_unequal' : palmaRatio > 1.5 ? 'moderately_unequal' : 'relatively_equal',
      voiceEquity,
      voiceDetails: {
        respondedToCount: respondedTo.size,
        totalParticipants: allAuthors.size,
        neverRespondedTo: allAuthors.size - respondedTo.size,
      },
      qualityWeightedGini: qualityGini,
      temporalEquity,
      interactionDiversity,
      equityTrend: temporalEquity.length >= 2
        ? temporalEquity[temporalEquity.length - 1].gini - temporalEquity[0].gini > 0.05
          ? 'worsening'
          : temporalEquity[temporalEquity.length - 1].gini - temporalEquity[0].gini < -0.05
            ? 'improving'
            : 'stable'
        : 'insufficient_data',
    });
  },
);

// POST /api/spaces/:spaceId/research/cognitive-network — keyword co-occurrence network
router.post(
  '/spaces/:spaceId/research/cognitive-network',
  verifyJWT,
  researchLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const maxNodes = numberInRange(req.body?.maxNodes, 'maxNodes', 1, 500, 30);

    const { data: notes, error } = await supabase
      .from('notes')
      .select('id, author_id, title, content')
      .in('space_id', spaceIds)
      .is('deleted_at', null);
    if (error) throw new ApiError(500, error.message);
    if (!notes || notes.length < 3) {
      res.json({ nodes: [], edges: [], stats: { totalNotes: 0, uniqueKeywords: 0 } });
      return;
    }

    const stopWords = new Set([
      // Chinese function words, pronouns, connectives, auxiliary words
      '的', '了', '是', '在', '和', '有', '被', '将', '对', '与', '我', '你', '他', '她', '它', '们', '这', '那', '就', '也', '都', '会', '要', '能', '可以', '不', '还', '很', '没有', '什么', '一个',
      '如果', '但是', '但如果', '因为', '所以', '虽然', '而且', '或者', '以及', '不过', '然而', '其实', '比如', '可能', '应该', '已经', '自己', '这个', '那个', '这些', '那些', '怎么', '为什么', '哪些', '哪个',
      '觉得', '认为', '知道', '需要', '使用', '进行', '通过', '以为', '成为', '作为', '关于', '对于', '根据', '按照', '来说', '其中', '之间', '目前', '以后', '以前', '之后', '之前',
      '一些', '一定', '一样', '一种', '非常', '比较', '可能', '当然', '而是', '还是', '不是', '只是', '只有', '并且', '然后', '所以', '因此', '同时', '实际', '确实',
      '会让', '变得', '让', '把', '给', '从', '到', '向', '跟', '比', '像', '每', '各', '某', '该', '本', '其', '另', '同', '这样', '那样', '这么', '那么', '怎样',
      '学生', '老师', '同学', '大家', '所有', '个人', '方面', '问题', '时候', '东西', '事情', '地方',
      '感觉', '认为', '看到', '做到', '想到', '说到', '看看', '想想', '说说', '来看', '起来',
      // English stop words
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'that', 'this', 'it', 'not', 'but', 'and', 'or', 'as', 'if', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'may', 'might', 'should', 'shall', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him', 'us', 'them',
      'also', 'just', 'about', 'more', 'some', 'than', 'very', 'what', 'when', 'where', 'which', 'who', 'how', 'all', 'each', 'every', 'both', 'few', 'most', 'other', 'such', 'only', 'own', 'same', 'so', 'too', 'any', 'no', 'nor',
      'think', 'know', 'make', 'like', 'use', 'get', 'go', 'see', 'come', 'take', 'want', 'look', 'give', 'find', 'tell', 'ask', 'work', 'seem', 'feel', 'try', 'leave', 'call',
    ]);

    // Extract keywords per note
    const noteKeywords: string[][] = [];
    const wordFreq = new Map<string, number>();
    const wordDocFreq = new Map<string, number>();

    const isChinese = (w: string) => /[一-鿿]/.test(w);
    for (const n of notes) {
      const text = ((n.title ?? '') + ' ' + (n.content ?? '')).replace(/<[^>]*>/g, '').toLowerCase();
      const words = text.split(/[\s,.;!?，。；！？、:：""''（）()【】\[\]{}「」『』…—·\-_/\\|@#$%^&*+=~`]+/)
        .filter(w => {
          if (stopWords.has(w)) return false;
          if (isChinese(w)) return w.length >= 2;
          return w.length > 2;
        });
      const unique = [...new Set(words)];
      noteKeywords.push(unique);
      for (const w of words) wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
      for (const w of unique) wordDocFreq.set(w, (wordDocFreq.get(w) ?? 0) + 1);
    }

    // TF-IDF scoring to pick top keywords
    const noteCount = notes.length;
    const scored = Array.from(wordFreq.entries())
      .map(([word, tf]) => {
        const df = wordDocFreq.get(word) ?? 1;
        const idf = Math.log(noteCount / df);
        return { word, score: tf * idf, tf, df };
      })
      .filter(w => w.df >= 2 && w.df < noteCount * 0.8)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(maxNodes, 50));

    const topWordSet = new Set(scored.map(s => s.word));

    // Compute co-occurrence edges (words appearing in same note)
    const cooccurrence = new Map<string, number>();
    for (const keywords of noteKeywords) {
      const filtered = keywords.filter(w => topWordSet.has(w));
      for (let i = 0; i < filtered.length; i++) {
        for (let j = i + 1; j < filtered.length; j++) {
          const key = [filtered[i], filtered[j]].sort().join('|');
          cooccurrence.set(key, (cooccurrence.get(key) ?? 0) + 1);
        }
      }
    }

    // Build network nodes and edges
    const nodes = scored.map(s => ({
      id: s.word,
      weight: s.score,
      freq: s.tf,
      docs: s.df,
    }));

    const edges = Array.from(cooccurrence.entries())
      .filter(([, w]) => w >= 2)
      .map(([key, weight]) => {
        const [source, target] = key.split('|');
        return { source, target, weight };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 100);

    res.json({
      nodes,
      edges,
      stats: { totalNotes: noteCount, uniqueKeywords: topWordSet.size },
    });
  },
);

export default router;
