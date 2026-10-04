import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { spawn } from 'child_process';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../middleware/rateLimitKey';
import { resolveSpaceIds } from '../services/researchScope';

const router = Router();

const chartLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many chart requests' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

const PYTHON_SCRIPT = path.join(__dirname, '..', 'charts', 'research_charts.py');

async function generateChart(chartType: string, data: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [PYTHON_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

    proc.on('close', (code) => {
      if (code !== 0) {
        const errMsg = Buffer.concat(errChunks).toString().slice(0, 500);
        reject(new Error(`Python exited with code ${code}: ${errMsg}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    proc.on('error', (err) => reject(err));

    // stdin needs its own listener: proc.on('error') only covers spawn. When
    // the Python side dies at import time (a failed pip install), a payload
    // larger than the 64KB pipe buffer raises EPIPE here, and an unhandled
    // 'error' event on a stream terminates the whole API process.
    proc.stdin.on('error', (err) => reject(err));

    try {
      proc.stdin.write(JSON.stringify({ chart_type: chartType, data }));
      proc.stdin.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// resolveSpaceIds is imported from services/researchScope — see the note there
// on why the previous private copy was a security hole.

// ── Generic chart endpoint (accepts pre-computed data) ──
router.post(
  '/research/chart',
  verifyJWT,
  chartLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { chart_type, data } = req.body;
    if (!chart_type || !data) {
      throw new ApiError(400, 'chart_type and data required');
    }

    const validTypes = [
      'sna_network', 'sna_centrality',
      'lsa_heatmap', 'lsa_transitions',
      'temporal_timeline', 'temporal_momentum', 'temporal_rhythm',
      'discourse_levels', 'discourse_progression', 'discourse_keywords',
      'equity_lorenz', 'equity_temporal', 'equity_palma',
    ];
    if (!validTypes.includes(chart_type)) {
      throw new ApiError(400, `Invalid chart_type. Valid: ${validTypes.join(', ')}`);
    }

    const png = await generateChart(chart_type, data);
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${chart_type}.png"`);
    res.send(png);
  },
);

// ── Convenience: generate chart directly from course data ──
router.post(
  '/spaces/:spaceId/research/chart/:chartType',
  verifyJWT,
  chartLimit,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const spaceIds = await resolveSpaceIds(req.params.spaceId as string, req.user!);
    const chartType = req.params.chartType as string;

    let chartData: unknown;

    switch (chartType) {
      case 'sna_network':
      case 'sna_centrality': {
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
        const noteAuthor = new Map(allNotes.map(n => [n.id, n.author_id]));

        const edgeMap = new Map<string, number>();
        const nodeSet = new Set<string>();
        for (const r of allRelations) {
          const from = r.creator_id;
          const to = noteAuthor.get(r.target_note_id);
          if (!from || !to || from === to) continue;
          nodeSet.add(from);
          nodeSet.add(to);
          const key = `${from}|${to}`;
          edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
        }

        const nodes = Array.from(nodeSet).map(id => {
          let inDeg = 0, outDeg = 0;
          for (const [key, w] of edgeMap) {
            const [src, tgt] = key.split('|');
            if (tgt === id) inDeg += w;
            if (src === id) outDeg += w;
          }
          const total = inDeg + outDeg;
          const maxDeg = nodeSet.size > 1 ? nodeSet.size - 1 : 1;
          return { id, inDegree: inDeg, outDegree: outDeg, degreeCentrality: total / (2 * maxDeg), noteCount: allNotes.filter(n => n.author_id === id).length };
        });

        const edges = Array.from(edgeMap.entries()).map(([key, weight]) => {
          const [source, target] = key.split('|');
          return { source, target, weight };
        });

        const density = nodeSet.size > 1 ? edgeMap.size / (nodeSet.size * (nodeSet.size - 1)) : 0;

        chartData = { nodes, edges, metrics: { density, nodeCount: nodeSet.size, edgeCount: edgeMap.size } };

        if (chartType === 'sna_centrality') {
          // Add eigenvector from advanced endpoint data if available
          chartData = { ...chartData as object, nodes: (chartData as { nodes: unknown[] }).nodes };
        }
        break;
      }

      case 'lsa_heatmap':
      case 'lsa_transitions': {
        const { data: relations } = await supabase
          .from('relations')
          .select('id, relation_type, creator_id, created_at')
          .in('space_id', spaceIds)
          .order('created_at', { ascending: true });

        const allRelations = relations ?? [];
        const sequence = allRelations.map(r => r.relation_type);
        const codes = Array.from(new Set(sequence)).sort();
        const codeIndex = new Map(codes.map((c, i) => [c, i]));
        const n = codes.length;
        const totalTransitions = sequence.length - 1;

        const freq = Array.from({ length: n }, () => Array(n).fill(0));
        for (let i = 0; i < sequence.length - 1; i++) {
          const from = codeIndex.get(sequence[i]);
          const to = codeIndex.get(sequence[i + 1]);
          if (from !== undefined && to !== undefined) freq[from][to]++;
        }

        const rowSums = freq.map(row => row.reduce((a: number, b: number) => a + b, 0));
        const colSums = Array(n).fill(0);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) colSums[j] += freq[i][j];

        const zScores = Array.from({ length: n }, () => Array(n).fill(0));
        const significantTransitions: { from: string; to: string; freq: number; zScore: number; pValue: number }[] = [];

        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const expected = totalTransitions > 0 ? (rowSums[i] * colSums[j]) / totalTransitions : 0;
            if (expected > 0) {
              const variance = expected * (1 - colSums[j] / totalTransitions) * (1 - rowSums[i] / totalTransitions);
              const sd = Math.sqrt(Math.max(variance, 0.0001));
              zScores[i][j] = Math.round(((freq[i][j] - expected) / sd) * 100) / 100;
              if (Math.abs(zScores[i][j]) >= 1.96) {
                const absZ = Math.abs(zScores[i][j]);
                significantTransitions.push({
                  from: codes[i], to: codes[j], freq: freq[i][j], zScore: zScores[i][j],
                  pValue: absZ > 3.29 ? 0.001 : absZ > 2.58 ? 0.01 : 0.05,
                });
              }
            }
          }
        }

        chartData = { codes, zScoreMatrix: zScores, adjustedResiduals: zScores, significantTransitions, totalTransitions };
        break;
      }

      case 'temporal_timeline':
      case 'temporal_momentum': {
        const { data: notes } = await supabase
          .from('notes')
          .select('id, author_id, created_at')
          .in('space_id', spaceIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: true });
        const { data: events } = await supabase
          .from('events')
          .select('id, actor_id, created_at')
          .in('space_id', spaceIds)
          .order('created_at', { ascending: true });
        const { data: rels } = await supabase
          .from('relations')
          .select('id, creator_id, created_at')
          .in('space_id', spaceIds)
          .order('created_at', { ascending: true });

        const allNotes = notes ?? [];
        const allEvents = events ?? [];
        const allRels = rels ?? [];

        const buckets = new Map<string, { notes: number; events: number; relations: number }>();
        for (const n of allNotes) {
          const d = new Date(n.created_at).toISOString().slice(0, 10);
          const b = buckets.get(d) ?? { notes: 0, events: 0, relations: 0 };
          b.notes++;
          buckets.set(d, b);
        }
        for (const e of allEvents) {
          const d = new Date(e.created_at).toISOString().slice(0, 10);
          const b = buckets.get(d) ?? { notes: 0, events: 0, relations: 0 };
          b.events++;
          buckets.set(d, b);
        }
        for (const r of allRels) {
          const d = new Date(r.created_at).toISOString().slice(0, 10);
          const b = buckets.get(d) ?? { notes: 0, events: 0, relations: 0 };
          b.relations++;
          buckets.set(d, b);
        }

        const timeline = Array.from(buckets.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, counts]) => ({ date, ...counts }));

        // Burst detection
        const dailyCounts = timeline.map(t => t.notes + t.events);
        const mean = dailyCounts.length > 0 ? dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length : 0;
        const stdDev = dailyCounts.length > 1 ? Math.sqrt(dailyCounts.reduce((acc, v) => acc + (v - mean) ** 2, 0) / dailyCounts.length) : 0;
        const burstThreshold = mean + 2 * stdDev;
        const bursts = timeline
          .filter((t, i) => dailyCounts[i] > burstThreshold && burstThreshold > 0)
          .map(t => ({ date: t.date, activity: t.notes + t.events + t.relations }));

        if (chartType === 'temporal_momentum') {
          const windowSize = 7;
          const momentum: { date: string; rate: number; acceleration: number }[] = [];
          const sortedDays = timeline;
          for (let i = windowSize; i < sortedDays.length; i++) {
            const windowCounts = sortedDays.slice(i - windowSize, i).map(t => t.notes + t.events + t.relations);
            const prevWindowCounts = i >= windowSize * 2
              ? sortedDays.slice(i - windowSize * 2, i - windowSize).map(t => t.notes + t.events + t.relations)
              : [];
            const rate = windowCounts.reduce((a, b) => a + b, 0) / windowSize;
            const prevRate = prevWindowCounts.length > 0 ? prevWindowCounts.reduce((a, b) => a + b, 0) / prevWindowCounts.length : rate;
            momentum.push({ date: sortedDays[i].date, rate: Math.round(rate * 100) / 100, acceleration: Math.round((rate - prevRate) * 100) / 100 });
          }

          // Phase detection
          const globalMean = dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length;
          const phases: { startDate: string; endDate: string; avgActivity: number; phase: string }[] = [];
          const chunkSize = Math.max(Math.ceil(timeline.length / 5), 3);
          for (let i = 0; i < timeline.length; i += chunkSize) {
            const chunk = dailyCounts.slice(i, i + chunkSize);
            const avg = chunk.reduce((a, b) => a + b, 0) / chunk.length;
            phases.push({
              startDate: timeline[i].date,
              endDate: timeline[Math.min(i + chunkSize - 1, timeline.length - 1)].date,
              avgActivity: Math.round(avg * 100) / 100,
              phase: avg > globalMean * 1.3 ? 'high' : avg < globalMean * 0.7 ? 'low' : 'normal',
            });
          }

          chartData = { momentum, phases };
        } else {
          chartData = { timeline, bursts };
        }
        break;
      }

      case 'temporal_rhythm': {
        const { data: notes } = await supabase
          .from('notes')
          .select('id, author_id, created_at')
          .in('space_id', spaceIds)
          .is('deleted_at', null);
        const { data: events } = await supabase
          .from('events')
          .select('id, actor_id, created_at')
          .in('space_id', spaceIds);

        const allActivities = [
          ...(notes ?? []).map(n => ({ authorId: n.author_id, time: n.created_at })),
          ...(events ?? []).map(e => ({ authorId: e.actor_id, time: e.created_at })),
        ];

        const authorHourDist = new Map<string, number[]>();
        for (const a of allActivities) {
          if (!authorHourDist.has(a.authorId)) authorHourDist.set(a.authorId, Array(24).fill(0));
          const hour = new Date(a.time).getHours();
          authorHourDist.get(a.authorId)![hour]++;
        }

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

        chartData = { rhythmClusters };
        break;
      }

      case 'discourse_levels':
      case 'discourse_progression':
      case 'discourse_keywords': {
        const { data: notes } = await supabase
          .from('notes')
          .select('id, author_id, type, title, content, created_at')
          .in('space_id', spaceIds)
          .is('deleted_at', null);
        const { data: relations } = await supabase
          .from('relations')
          .select('id, source_note_id, target_note_id, relation_type, creator_id')
          .in('space_id', spaceIds);

        const allNotes = notes ?? [];
        const allRelations = relations ?? [];

        // KB Discourse levels
        const noteOutDeg = new Map<string, number>();
        for (const r of allRelations) {
          noteOutDeg.set(r.source_note_id, (noteOutDeg.get(r.source_note_id) ?? 0) + 1);
        }
        const synthesizeNotes = new Set(allRelations.filter(r => r.relation_type === 'synthesize').map(r => r.source_note_id));
        const evidenceNotes = new Set(allRelations.filter(r => r.relation_type === 'evidence').map(r => r.source_note_id));

        const noteLevel = new Map<string, number>();
        for (const n of allNotes) {
          if (n.type === 'riseabove') noteLevel.set(n.id, 4);
          else if (synthesizeNotes.has(n.id) || (noteOutDeg.get(n.id) ?? 0) >= 3) noteLevel.set(n.id, 3);
          else if (evidenceNotes.has(n.id) || (noteOutDeg.get(n.id) ?? 0) >= 1) noteLevel.set(n.id, 2);
          else noteLevel.set(n.id, 1);
        }

        const levelDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
        for (const level of noteLevel.values()) levelDist[level]++;

        const sortedNotes = [...allNotes].sort((a, b) => a.created_at.localeCompare(b.created_at));
        const thirds = Math.ceil(sortedNotes.length / 3);
        const progression = [
          sortedNotes.slice(0, thirds),
          sortedNotes.slice(thirds, thirds * 2),
          sortedNotes.slice(thirds * 2),
        ].map(chunk => {
          const levels = chunk.map(n => noteLevel.get(n.id) ?? 1);
          return levels.length > 0 ? Math.round((levels.reduce((a, b) => a + b, 0) / levels.length) * 100) / 100 : 0;
        });

        if (chartType === 'discourse_keywords') {
          const stopWords = new Set(['的', '了', '是', '在', '和', '有', '被', '将', 'the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'in', 'for', 'on', 'with', 'that', 'this', 'it', 'not', 'but', 'and', 'or']);
          const wordFreq = new Map<string, number>();
          const wordDocFreq = new Map<string, number>();

          for (const n of allNotes) {
            const text = ((n.title ?? '') + ' ' + (n.content ?? '')).replace(/<[^>]*>/g, '').toLowerCase();
            const words = text.split(/[\s,.;!?，。；！？、]+/).filter((w: string) => w.length > 1 && !stopWords.has(w));
            const unique = new Set(words);
            for (const w of words) wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
            for (const w of unique) wordDocFreq.set(w, (wordDocFreq.get(w) ?? 0) + 1);
          }

          const totalWords = Array.from(wordFreq.values()).reduce((a, b) => a + b, 0);
          let vocabularyEntropy = 0;
          for (const count of wordFreq.values()) {
            const p = count / totalWords;
            if (p > 0) vocabularyEntropy -= p * Math.log2(p);
          }

          const topKeywords = Array.from(wordFreq.entries())
            .map(([word, tf]) => {
              const df = wordDocFreq.get(word) ?? 1;
              const idf = Math.log(allNotes.length / df);
              return { word, score: tf * idf, tf, df };
            })
            .filter(w => w.df >= 2 && w.df < allNotes.length * 0.8)
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);

          chartData = { ideaDiversity: { vocabularyEntropy: Math.round(vocabularyEntropy * 100) / 100, topKeywords } };
        } else if (chartType === 'discourse_progression') {
          // CCR + Productive discourse
          const noteAuthor = new Map(allNotes.map(n => [n.id, n.author_id]));
          const authorContrib = new Map<string, { created: number; improvedByOthers: number; improvedOthers: number; level3Plus: number }>();
          for (const n of allNotes) {
            if (!authorContrib.has(n.author_id)) authorContrib.set(n.author_id, { created: 0, improvedByOthers: 0, improvedOthers: 0, level3Plus: 0 });
            authorContrib.get(n.author_id)!.created++;
            if ((noteLevel.get(n.id) ?? 1) >= 3) authorContrib.get(n.author_id)!.level3Plus++;
          }
          for (const r of allRelations) {
            const targetAuthor = noteAuthor.get(r.target_note_id);
            if (targetAuthor && targetAuthor !== r.creator_id) {
              if (authorContrib.has(targetAuthor)) authorContrib.get(targetAuthor)!.improvedByOthers++;
              if (!authorContrib.has(r.creator_id)) authorContrib.set(r.creator_id, { created: 0, improvedByOthers: 0, improvedOthers: 0, level3Plus: 0 });
              authorContrib.get(r.creator_id)!.improvedOthers++;
            }
          }
          const ccrParticipants = Array.from(authorContrib.values()).filter(a => a.improvedOthers > 0).length;
          const ccrIndex = authorContrib.size > 0 ? Math.round((ccrParticipants / authorContrib.size) * 10000) / 10000 : 0;

          const questionNotes = new Set(allRelations.filter(r => r.relation_type === 'question').map(r => r.source_note_id));
          const challengeNotes = new Set(allRelations.filter(r => r.relation_type === 'challenge').map(r => r.source_note_id));
          let questionsResolved = 0, challengesResolved = 0;
          for (const r of allRelations) {
            if (questionNotes.has(r.target_note_id) && r.relation_type !== 'question') questionsResolved++;
            if (challengeNotes.has(r.target_note_id) && r.relation_type !== 'challenge') challengesResolved++;
          }

          chartData = {
            collectiveCognitiveResponsibility: {
              ccrIndex,
              authorContributions: Array.from(authorContrib.entries()).map(([id, c]) => ({ authorId: id, ...c })),
            },
            productiveDiscourse: {
              totalQuestions: questionNotes.size,
              questionsResolved,
              questionResolutionRate: questionNotes.size > 0 ? questionsResolved / questionNotes.size : 0,
              totalChallenges: challengeNotes.size,
              challengesResolved,
              challengeResolutionRate: challengeNotes.size > 0 ? challengesResolved / challengeNotes.size : 0,
            },
          };
        } else {
          chartData = { kbDiscourse: { levelDistribution: levelDist, avgLevel: allNotes.length > 0 ? Array.from(noteLevel.values()).reduce((a, b) => a + b, 0) / allNotes.length : 0, progression } };
        }
        break;
      }

      case 'equity_lorenz':
      case 'equity_temporal':
      case 'equity_palma': {
        const { data: notes } = await supabase
          .from('notes')
          .select('id, author_id, type, created_at')
          .in('space_id', spaceIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: true });
        const { data: relations } = await supabase
          .from('relations')
          .select('id, source_note_id, target_note_id, relation_type, creator_id, created_at')
          .in('space_id', spaceIds);
        const { data: spaces } = await supabase
          .from('spaces')
          .select('course_id')
          .in('id', spaceIds);
        const courseIds = [...new Set((spaces ?? []).map(s => s.course_id))];
        let allMembers: { user_id: string }[] = [];
        if (courseIds.length > 0) {
          const { data: members } = await supabase.from('course_members').select('user_id').in('course_id', courseIds);
          allMembers = members ?? [];
        }

        const allNotes = notes ?? [];
        const allRelations = relations ?? [];
        const noteAuthor = new Map(allNotes.map(n => [n.id, n.author_id]));
        const allAuthors = new Set([...allNotes.map(n => n.author_id), ...allMembers.map(m => m.user_id)]);

        const authorCounts = new Map<string, number>();
        for (const id of allAuthors) authorCounts.set(id, 0);
        for (const n of allNotes) authorCounts.set(n.author_id, (authorCounts.get(n.author_id) ?? 0) + 1);
        for (const r of allRelations) authorCounts.set(r.creator_id, (authorCounts.get(r.creator_id) ?? 0) + 1);

        const sortedCounts = Array.from(authorCounts.values()).sort((a, b) => a - b);
        const totalContrib = sortedCounts.reduce((a, b) => a + b, 0);
        const numAuthors = sortedCounts.length;

        // Gini
        let gini = 0;
        if (numAuthors > 1 && totalContrib > 0) {
          let sumOfDiffs = 0;
          for (let i = 0; i < numAuthors; i++) for (let j = 0; j < numAuthors; j++) sumOfDiffs += Math.abs(sortedCounts[i] - sortedCounts[j]);
          gini = Math.round((sumOfDiffs / (2 * numAuthors * totalContrib)) * 10000) / 10000;
        }

        // Lorenz
        const lorenz = sortedCounts.map((_, i) => ({
          populationPct: Math.round(((i + 1) / numAuthors) * 100),
          contributionPct: totalContrib > 0 ? Math.round((sortedCounts.slice(0, i + 1).reduce((a, b) => a + b, 0) / totalContrib) * 100) : 0,
        }));

        if (chartType === 'equity_lorenz') {
          chartData = { lorenz, gini };
        } else if (chartType === 'equity_temporal') {
          const windowDays = 7;
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
                if (t >= wStart && t < wEnd) windowCounts.set(n.author_id, (windowCounts.get(n.author_id) ?? 0) + 1);
              }
              const wValues = Array.from(windowCounts.values()).sort((a, b) => a - b);
              const wTotal = wValues.reduce((a, b) => a + b, 0);
              let wGini = 0;
              if (wValues.length > 1 && wTotal > 0) {
                let sumD = 0;
                for (let i = 0; i < wValues.length; i++) for (let j = 0; j < wValues.length; j++) sumD += Math.abs(wValues[i] - wValues[j]);
                wGini = Math.round((sumD / (2 * wValues.length * wTotal)) * 10000) / 10000;
              }
              temporalEquity.push({ windowStart: new Date(wStart).toISOString().slice(0, 10), gini: wGini, activeCount: wValues.filter(v => v > 0).length });
            }
          }
          chartData = { temporalEquity };
        } else {
          // Palma
          const bottom40 = sortedCounts.slice(0, Math.ceil(numAuthors * 0.4)).reduce((a, b) => a + b, 0);
          const top10 = sortedCounts.slice(Math.floor(numAuthors * 0.9)).reduce((a, b) => a + b, 0);
          const palmaRatio = bottom40 > 0 ? Math.round((top10 / bottom40) * 100) / 100 : (top10 > 0 ? Infinity : 1);

          // Voice equity
          const respondedTo = new Set<string>();
          for (const r of allRelations) {
            const targetAuthor = noteAuthor.get(r.target_note_id);
            if (targetAuthor && targetAuthor !== r.creator_id) respondedTo.add(targetAuthor);
          }
          const voiceEquity = allAuthors.size > 0 ? respondedTo.size / allAuthors.size : 0;

          // Quality-weighted Gini
          const qualityWeights: Record<string, number> = { extend: 1, clarify: 1.5, evidence: 2, question: 2, challenge: 3, synthesize: 3 };
          const authorQuality = new Map<string, number>();
          for (const id of allAuthors) authorQuality.set(id, 0);
          for (const n of allNotes) authorQuality.set(n.author_id, (authorQuality.get(n.author_id) ?? 0) + (n.type === 'riseabove' ? 4 : 1));
          for (const r of allRelations) authorQuality.set(r.creator_id, (authorQuality.get(r.creator_id) ?? 0) + (qualityWeights[r.relation_type] ?? 1));
          const qCounts = Array.from(authorQuality.values()).sort((a, b) => a - b);
          const qTotal = qCounts.reduce((a, b) => a + b, 0);
          let qualityGini = 0;
          if (qCounts.length > 1 && qTotal > 0) {
            let sumD = 0;
            for (let i = 0; i < qCounts.length; i++) for (let j = 0; j < qCounts.length; j++) sumD += Math.abs(qCounts[i] - qCounts[j]);
            qualityGini = Math.round((sumD / (2 * qCounts.length * qTotal)) * 10000) / 10000;
          }

          chartData = { palmaRatio, voiceEquity, qualityWeightedGini: qualityGini, gini };
        }
        break;
      }

      default:
        throw new ApiError(400, `Unknown chart type: ${chartType}`);
    }

    const png = await generateChart(chartType, chartData);
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${chartType}.png"`);
    res.send(png);
  },
);

// ── List available chart types ──
router.get(
  '/research/chart-types',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (_req: Request, res: Response) => {
    res.json({
      chartTypes: [
        { id: 'sna_network', name: 'Network Graph', module: 'sna', description: 'Force-directed knowledge building network' },
        { id: 'sna_centrality', name: 'Centrality Distribution', module: 'sna', description: 'Degree, betweenness, eigenvector distributions' },
        { id: 'lsa_heatmap', name: 'Transition Heatmap', module: 'lsa', description: 'Z-score matrix with significance markers' },
        { id: 'lsa_transitions', name: 'Significant Transitions', module: 'lsa', description: 'Excitatory/inhibitory transition bar chart' },
        { id: 'temporal_timeline', name: 'Activity Timeline', module: 'temporal', description: 'Stacked bar timeline with burst markers' },
        { id: 'temporal_momentum', name: 'Momentum Analysis', module: 'temporal', description: 'Rate and acceleration curves with phases' },
        { id: 'temporal_rhythm', name: 'Circadian Rhythm', module: 'temporal', description: 'Hourly activity and chronotype distribution' },
        { id: 'discourse_levels', name: 'KB Discourse Levels', module: 'discourse', description: 'Knowledge building discourse level distribution' },
        { id: 'discourse_progression', name: 'CCR & Productivity', module: 'discourse', description: 'Collective cognitive responsibility and resolution rates' },
        { id: 'discourse_keywords', name: 'Keyword Importance', module: 'discourse', description: 'TF-IDF keyword importance chart' },
        { id: 'equity_lorenz', name: 'Lorenz Curve', module: 'equity', description: 'Publication-quality Lorenz curve with Gini' },
        { id: 'equity_temporal', name: 'Equity Over Time', module: 'equity', description: 'Gini coefficient trajectory' },
        { id: 'equity_palma', name: 'Palma & Voice Equity', module: 'equity', description: 'Palma ratio gauge, voice equity, quality Gini' },
      ],
    });
  },
);

export default router;
