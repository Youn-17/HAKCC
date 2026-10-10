import { createHash } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { getSpaceMetricsSummary } from '../services/metricsService';
import { ensureSpaceAccess, ensureSpaceStaff, ensureNoteAccess } from '../services/accessControl';
import { clampNumber } from '../services/requestParams';
import { buildOverview, buildStudentDetail, loadSpaceAnalytics, wordCloudDocs } from '../services/spaceAnalytics';
import { buildDiscussion, filterDiscussionPeriod, type DiscussionFilter } from '../services/discussionAnalytics';
import { extractKeywords, keywordChanges, layoutCloud, peerFocus, topicCoverage, type CloudItem, type KeywordTerm } from '../services/python/textWorker';

import {buildPeerConnections} from '../services/peerConnections';
import {loadTopics,saveTopics,validateTopics} from '../services/analyticsTopics';
import {studentAuthoredText} from '../services/feedbackUptake';
const router = Router();

// ── 讨论分析（2026-10-09）：教师看全班和个人的讨论情况，只给这门课的教职 ──────────────

const queryView = (raw: unknown) => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 100) : null);

function queryInstant(req: Request, key: string): string | null {
  const raw = req.query[key];
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) throw new ApiError(400, `Invalid ${key} date`);
  if (new Date(`${raw.slice(0,10)}T00:00:00Z`).toISOString().slice(0,10)!==raw.slice(0,10)) throw new ApiError(400, `Invalid ${key} date`);
  return new Date(raw).toISOString();
}
function discussionFilter(req: Request): DiscussionFilter {
  const from = queryInstant(req,'from'), until = queryInstant(req,'until');
  if (from && until && from >= until) throw new ApiError(400, 'End date must follow start date');
  const author = req.query.author_id;
  if (author != null && typeof author !== 'string') throw new ApiError(400, 'Invalid author');
  return {from, until, authorId: typeof author === 'string' && author ? author : null};
}
function termOptions(req: Request) {
  const words = (key: string) => {
    const raw=req.query[key];
    if (raw == null || raw === '') return [];
    if (typeof raw !== 'string' || raw.length > 1200) throw new ApiError(400, `Invalid ${key}`);
    const values=[...new Set(raw.split(/[\s,，;；]+/).filter(Boolean))];
    if (values.length > 50 || values.some(w=>w.length>20)) throw new ApiError(400, `Too many or too long ${key}`);
    return values;
  };
  return {extraWords:words('extra_words'),extraStop:words('extra_stop')};
}

router.get('/spaces/:spaceId/analytics/discussion', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  await ensureSpaceStaff(spaceId, req.user!);
  const filter = discussionFilter(req);
  const input = await loadSpaceAnalytics(spaceId, {viewId:queryView(req.query.view_id)});
  if (filter.authorId && !input.members.some(m => m.id === filter.authorId && !m.isStaff)) throw new ApiError(404, 'Student not in this space');
  res.json(buildDiscussion(input, filter));
});

// GET /api/spaces/:spaceId/analytics?view_id= — 全班概况
router.get('/spaces/:spaceId/analytics', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  await ensureSpaceStaff(spaceId, req.user!);
  const input = await loadSpaceAnalytics(spaceId, { viewId: queryView(req.query.view_id) });
  const filtered = filterDiscussionPeriod(input, discussionFilter(req));
  res.json({ overview: buildOverview(filtered), signature: input.signature, generatedAt: input.now.toISOString() });
});

// GET /api/spaces/:spaceId/analytics/students/:userId?view_id= — 一个学生
router.get('/spaces/:spaceId/analytics/students/:userId', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  await ensureSpaceStaff(spaceId, req.user!);
  const input = await loadSpaceAnalytics(spaceId, { viewId: queryView(req.query.view_id) });
  const userId = String(req.params.userId);
  if (!input.members.some(m => m.id === userId) && !input.notes.some(n => n.authorId === userId)) {
    throw new ApiError(404, 'This person has no records in this space');
  }
  res.json({ student: buildStudentDetail(input, userId) });
});

type CloudPayload = { available: boolean; terms: KeywordTerm[]; cloud: { items: CloudItem[]; width: number; height: number } | null; docs: number; error?: string };
const cloudCache = new Map<string, { at: number; value: CloudPayload }>();
const CLOUD_TTL_MS = 10 * 60_000;
const CLOUD_CACHE_MAX = 200;

/** 每改一次笔记签名就变、多一个键：存的时候顺手清掉过期的，再超出上限就从最早的删 */
function rememberCloud(key: string, value: CloudPayload): void {
  const now = Date.now();
  for (const [k, entry] of cloudCache) if (now - entry.at >= CLOUD_TTL_MS) cloudCache.delete(k);
  cloudCache.delete(key);
  cloudCache.set(key, { at: now, value });
  while (cloudCache.size > CLOUD_CACHE_MAX) cloudCache.delete(cloudCache.keys().next().value as string);
}

/**
 * GET /api/spaces/:spaceId/analytics/wordcloud?view_id=&author_id=&width=&height= — 词云。
 * 用 Python（jieba 分词 + wordcloud 排版，services/python）对学生写的笔记做，不经 AI；
 * 笔记里插入的 AI 摘录和支架话头不算。笔记没变就用缓存。Python 不可用时 available=false，其余分析照常。
 */
router.get('/spaces/:spaceId/analytics/wordcloud', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  await ensureSpaceStaff(spaceId, req.user!);
  const filter = discussionFilter(req);
  const authorId = filter.authorId;
  const width = clampNumber(req.query.width, 320, 1600, 900);
  const height = clampNumber(req.query.height, 200, 1000, 420);
  const input = await loadSpaceAnalytics(spaceId, { viewId: queryView(req.query.view_id) });
  if (authorId && !input.members.some(m => m.id === authorId && !m.isStaff)) throw new ApiError(404, 'Student not in this space');
  const docs = wordCloudDocs(filterDiscussionPeriod(input, filter), authorId);
  const options = termOptions(req);
  const digest = createHash('sha256').update(JSON.stringify({docs,names:input.members.map(m=>m.name),view:queryView(req.query.view_id),filter,width,height,options,version:3})).digest('hex');
  const key = `${spaceId}|${digest}`;
  const hit = cloudCache.get(key);
  if (hit && Date.now() - hit.at < CLOUD_TTL_MS) {
    res.json(hit.value);
    return;
  }
  let value: CloudPayload;
  if (docs.length === 0) {
    value = { available: true, terms: [], cloud: { items: [], width, height }, docs: 0 };
  } else {
    try {
      const names = input.members.map(m => m.name).filter(name => name && name !== '未命名');
      const keywords = await extractKeywords(docs, { topK: authorId ? 40 : 70, names, ...(options.extraWords.length || options.extraStop.length ? options : {}) });
      const cloud = await layoutCloud(keywords.terms.map(t => ({ word: t.word, weight: t.weight })), { width, height });
      value = { available: true, terms: keywords.terms, cloud, docs: keywords.docs };
    } catch (err) {
      console.warn('[analytics] word cloud unavailable:', err instanceof Error ? err.message : err);
      res.json({ available: false, terms: [], cloud: null, docs: docs.length, error: 'python unavailable' });
      return;
    }
  }
  rememberCloud(key, value);
  res.json(value);
});

type ChangesPayload = Awaited<ReturnType<typeof keywordChanges>> & {available: boolean; splitAt: string};
const changesCache = new Map<string,{at:number;value:ChangesPayload}>();
router.get('/spaces/:spaceId/analytics/changes', verifyJWT, async (req: Request, res: Response) => {
  const spaceId=String(req.params.spaceId);
  await ensureSpaceStaff(spaceId,req.user!);
  const filter=discussionFilter(req), requestedSplit=queryInstant(req,'split_at'), options=termOptions(req);
  const input=await loadSpaceAnalytics(spaceId,{viewId:queryView(req.query.view_id)});
  if (filter.authorId && !input.members.some(m=>m.id===filter.authorId && !m.isStaff)) throw new ApiError(404,'Student not in this space');
  const scoped=filterDiscussionPeriod(input,filter);
  const text=wordCloudDocs(scoped,filter.authorId);
  const dates=new Map(scoped.notes.map(n=>[n.id,Date.parse(n.createdAt)]));
  const times=text.map(d=>dates.get(d.id)!);
  const min=filter.from ? Date.parse(filter.from) : times.length ? Math.min(...times) : input.now.getTime();
  const max=filter.until ? Date.parse(filter.until) : times.length ? Math.max(...times)+1 : min+1;
  const splitAt=requestedSplit ?? new Date(min + (max-min)/2).toISOString();
  if ((filter.from && splitAt <= filter.from) || (filter.until && splitAt >= filter.until)) throw new ApiError(400,'Comparison date must be inside the selected range');
  const docs=text.map(d=>({...d,period:dates.get(d.id)! < Date.parse(splitAt) ? 'before' as const : 'after' as const}));
  const names=input.members.map(m=>m.name).filter(n=>n && n!=='未命名');
  const key=spaceId+'|'+createHash('sha256').update(JSON.stringify({docs,names,options,view:queryView(req.query.view_id),filter,splitAt,version:1})).digest('hex');
  const hit=changesCache.get(key);
  if(hit && Date.now()-hit.at<CLOUD_TTL_MS) {res.json(hit.value);return;}
  try {
    const result=docs.length ? await keywordChanges(docs,{names,...options}) : {terms:[],periods:{before:{docs:0,tokens:0},after:{docs:0,tokens:0}}};
    const value={...result,available:true,splitAt};
    for(const [k,entry] of changesCache) if(Date.now()-entry.at>=CLOUD_TTL_MS) changesCache.delete(k);
    changesCache.set(key,{at:Date.now(),value});
    while(changesCache.size>100) changesCache.delete(changesCache.keys().next().value as string);
    res.json(value);
  } catch {
    res.json({available:false,splitAt,terms:[],periods:{before:{docs:0,tokens:0},after:{docs:0,tokens:0}}});
  }
});

// Cache only pure text results; always reauthorize and rebuild actual relations.
const discussionTextCache=new Map<string,{at:number;value:unknown}>();
async function cachedDiscussionText<T>(spaceId:string,operation:string,payload:unknown,run:()=>Promise<T>):Promise<T> {
  const key=spaceId+'|'+operation+'|'+createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const now=Date.now(),hit=discussionTextCache.get(key);
  if(hit&&now-hit.at<10*60_000)return hit.value as T;
  const value=await run();
  for(const [k,entry] of discussionTextCache)if(now-entry.at>=10*60_000)discussionTextCache.delete(k);
  discussionTextCache.set(key,{at:now,value});
  while(discussionTextCache.size>100)discussionTextCache.delete(discussionTextCache.keys().next().value as string);
  return value;
}
async function discussionTextInput(req:Request) {
  const spaceId=String(req.params.spaceId);
  await ensureSpaceStaff(spaceId,req.user!);
  const filter=discussionFilter(req);
  const input=await loadSpaceAnalytics(spaceId,{viewId:queryView(req.query.view_id)});
  if(filter.authorId&&!input.members.some(m=>m.id===filter.authorId&&!m.isStaff))throw new ApiError(404,'Student not in this space');
  const scope=buildDiscussion(input,{...filter,authorId:null});
  const ids=new Set(scope.notes.map(n=>n.id));
  const docs=input.notes.filter(n=>ids.has(n.id)).map(n=>({id:n.id,authorId:n.authorId!,text:`${n.title}\n${studentAuthoredText(n.content)}`}));
  return {spaceId,input,filter,scope,docs};
}
router.get('/spaces/:spaceId/analytics/peers',verifyJWT,async(req:Request,res:Response)=>{
  const {spaceId,input,filter,docs}=await discussionTextInput(req);
  const options={names:input.members.map(m=>m.name),...termOptions(req)};
  try {
    const focus=docs.length?await cachedDiscussionText(spaceId,'focus',{docs,options},()=>peerFocus(docs,options)):{authors:[]};
    res.json({...buildPeerConnections(input,focus.authors,filter),available:true});
  }catch{res.json({...buildPeerConnections(input,[],filter),available:false});}
});
router.get('/spaces/:spaceId/analytics/topics',verifyJWT,async(req:Request,res:Response)=>{
  const {spaceId,input,filter,docs}=await discussionTextInput(req);
  const config=await loadTopics(spaceId);
  const students=filter.authorId?1:input.members.filter(m=>!m.isStaff).length;
  try {
    const result=await cachedDiscussionText(spaceId,'topics',{docs,config,authorId:filter.authorId},()=>topicCoverage(docs,config.topics,filter.authorId));
    res.json({...result,config,students,available:true});
  }catch{res.json({available:false,config,students,docs:docs.filter(d=>!filter.authorId||d.authorId===filter.authorId).length,topics:[]});}
});
router.put('/spaces/:spaceId/analytics/topics',verifyJWT,async(req:Request,res:Response)=>{
  const spaceId=String(req.params.spaceId);await ensureSpaceStaff(spaceId,req.user!);
  const topics=validateTopics(req.body?.topics);
  const revision=req.body?.expectedRevision;
  if(revision!==null&&(typeof revision!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(revision)))throw new ApiError(400,'Invalid expected revision');
  res.json(await saveTopics(spaceId,req.user!.id,topics,revision));
});

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
