import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureSpaceAccess } from '../services/accessControl';
import { resolveEffectiveCondition } from '../services/experimentCondition';
import { resolveCourseProviderChain, callJson } from './thinkingTrainer';
import {
  buildTopicPrompt,
  fetchViewTopicNotes,
  latestStoredTopics,
  MIN_NOTES,
  parseTopics,
  shouldRegenerate,
  topicSignature,
  type TopicNote,
  type ViewTopic,
} from '../services/viewTopics';

/**
 * GET /spaces/:spaceId/view-topics?view_id= —— 问题栏后面滚动的讨论主题（2026-10-05）。
 * 生成和缓存的规则见 services/viewTopics.ts。
 */
const router = Router();

/** 同一个 View、同一份笔记，同时只生成一次 */
const inFlight = new Map<string, Promise<ViewTopic[] | null>>();

/**
 * 生成失败过的 View，这段时间内不再试，直接回「没有」：失败一次要把候选链走完，
 * 每家最多等 45 秒（10-05 线上第一次就是这样，学生等了一分多钟什么也没有）。
 */
export const FAILURE_COOLDOWN_MS = 2 * 60_000;
const failedAt = new Map<string, number>();

export function resetViewTopicFailuresForTests(): void {
  failedAt.clear();
}

/** 课程 AI 设置里能关；没设过就是开着 */
async function viewTopicsEnabled(courseId: string): Promise<boolean> {
  const { data } = await supabase
    .from('teacher_ai_configs')
    .select('trigger_settings, configured_at')
    .eq('course_id', courseId)
    .order('configured_at', { ascending: false });
  const row = ((data ?? []) as Array<{ trigger_settings?: Record<string, unknown> | null }>)
    .find(r => r.trigger_settings && Object.keys(r.trigger_settings).length > 0);
  return row?.trigger_settings?.view_topics_enabled !== false;
}

async function generate(courseId: string, spaceId: string, viewId: string, notes: TopicNote[], signature: string): Promise<ViewTopic[] | null> {
  const chain = await resolveCourseProviderChain(courseId, 'view_topics');
  const cfg = chain[0];
  if (!cfg) return null;
  const { system, user, idOf } = buildTopicPrompt(notes);
  const raw = await callJson(cfg, system, user, 900, 'fast', chain.slice(1));
  const topics = parseTopics(raw, idOf);
  if (topics.length === 0) {
    console.warn(`[view-topics] 没生成出来（${chain.map(c => c.providerId).join(' → ')}，${notes.length} 条笔记）`);
    return null;
  }
  const { error } = await supabase.from('view_topic_summaries').insert({
    space_id: spaceId,
    view_id: viewId,
    signature,
    topics,
    note_count: notes.length,
    provider_id: cfg.providerId,
    model: cfg.model,
  });
  if (error) console.warn('[view-topics] 没存下来：', error.message);
  return topics;
}

router.get('/spaces/:spaceId/view-topics', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  const viewId = String(req.query.view_id ?? '').trim();
  if (!viewId || viewId.length > 100) throw new ApiError(400, 'view_id is required');
  const space = await ensureSpaceAccess(spaceId, req.user!);

  if (!(await viewTopicsEnabled(space.course_id))) return res.json({ topics: [], disabled: 'course' });
  // AI 功能：整群实验的对照组不显示、不调模型
  const { condition } = await resolveEffectiveCondition(space.course_id, req.user!.id);
  if (condition === 'control') return res.json({ topics: [], disabled: 'experiment' });

  const notes = await fetchViewTopicNotes(spaceId, viewId);
  if (notes.length < MIN_NOTES) return res.json({ topics: [], noteCount: notes.length });

  const signature = topicSignature(notes);
  const stored = await latestStoredTopics(spaceId, viewId);
  if (stored && !shouldRegenerate(stored, signature)) {
    return res.json({ topics: stored.topics, generatedAt: stored.created_at, stale: stored.signature !== signature });
  }

  // 没生成出来时：有旧的先给旧的，并告诉前端过多久再问
  const fallback = (retryAfterMs: number) => res.json({
    topics: stored?.topics ?? [],
    generatedAt: stored?.created_at ?? null,
    stale: Boolean(stored),
    failed: true,
    retryAfterMs,
  });

  const viewKey = `${spaceId}:${viewId}`;
  const lastFailure = failedAt.get(viewKey);
  if (lastFailure && Date.now() - lastFailure < FAILURE_COOLDOWN_MS) {
    return fallback(FAILURE_COOLDOWN_MS - (Date.now() - lastFailure));
  }

  const key = `${viewKey}:${signature}`;
  let job = inFlight.get(key);
  if (!job) {
    job = generate(space.course_id, spaceId, viewId, notes, signature)
      .catch(err => { console.warn('[view-topics] 生成失败：', err instanceof Error ? err.message : err); return null; })
      .then(result => {
        if (result) failedAt.delete(viewKey);
        else failedAt.set(viewKey, Date.now());
        return result;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, job);
  }
  const topics = await job;
  if (!topics) return fallback(FAILURE_COOLDOWN_MS);
  res.json({ topics, generatedAt: new Date().toISOString(), stale: false });
});

export default router;
