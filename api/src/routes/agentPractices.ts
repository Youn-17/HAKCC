/**
 * 「讨论分析 → 智能体做法」（2026-10-11 第五步），只给本课教职：
 *   做法卡：看候选和在用的、生成本期候选、采用 / 不用 / 撤回、自己写一张；
 *   网页模板：平台自带的、本课存的、做得好的网页（放进过笔记的）存成模板。
 * 卡和模板都按空间所在的课程算。
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureSpaceStaff } from '../services/accessControl';
import { logEvent } from '../services/eventService';
import { artifactViewPath } from '../services/artifactLinks';
import {
  FEATURES,
  PRACTICE_LIMITS,
  TASK_KINDS,
  TASK_KIND_ZH,
  collectTurns,
  duplicateOf,
  evidenceSentence,
  featureStats,
  invalidatePracticeCache,
  kindRates,
  loadCards,
  pickCandidates,
  trialVerdict,
  type FeatureStat,
  type PracticeCard,
  type TaskKind,
} from '../services/agentPractices';
import { BUILTIN_TEMPLATES, courseTemplates, templateSlug } from '../services/pageTemplates';
import { callJson, resolveCourseProviderChain } from './thinkingTrainer';

const router = Router();
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

function cardToApi(c: PracticeCard, trial?: ReturnType<typeof trialVerdict>) {
  return {
    id: c.id, taskKind: c.task_kind, practice: c.practice, rationale: c.rationale, evidence: c.evidence,
    origin: c.origin, status: c.status, baselineRate: c.baseline_rate, decidedAt: c.decided_at,
    retiredReason: c.retired_reason, createdAt: c.created_at,
    ...(trial ? { trial: { uses: trial.uses, rate: trial.rate, verdict: trial.verdict } } : {}),
  };
}

/** 做得好的网页：放进过笔记的，按放进几条笔记排 */
async function goodPages(courseId: string, savedFrom: Set<string>) {
  const { data } = await supabase
    .from('ai_artifact_notes').select('artifact_id, note_id, ai_artifacts!inner(id, course_id, title, brief, template_slug, created_at)')
    .eq('ai_artifacts.course_id', courseId).order('created_at', { ascending: false }).limit(300);
  const pages = new Map<string, { artifactId: string; title: string; brief: string; template: string | null; createdAt: string; notes: number }>();
  for (const r of (data ?? []) as unknown as Array<{ artifact_id: string; ai_artifacts: { title: string; brief: string | null; template_slug: string | null; created_at: string } }>) {
    const p = pages.get(r.artifact_id) ?? {
      artifactId: r.artifact_id, title: r.ai_artifacts.title, brief: (r.ai_artifacts.brief ?? '').slice(0, 160),
      template: r.ai_artifacts.template_slug, createdAt: r.ai_artifacts.created_at, notes: 0,
    };
    p.notes += 1;
    pages.set(r.artifact_id, p);
  }
  return [...pages.values()].sort((a, b) => b.notes - a.notes || Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 12)
    .map(p => ({ ...p, viewPath: artifactViewPath(p.artifactId), savedAsTemplate: savedFrom.has(p.artifactId) }));
}

/** 每个模板做过几个网页、几个放进了笔记 */
async function templateUsage(courseId: string): Promise<Record<string, { made: number; adopted: number }>> {
  // 模板记在第一版上；挂到笔记的可能是改过的后几版，按同一组（group_id）对
  const { data } = await supabase.from('ai_artifacts').select('group_id, template_slug').eq('course_id', courseId).not('template_slug', 'is', null).limit(2000);
  const rows = (data ?? []) as Array<{ group_id: string; template_slug: string }>;
  const usage: Record<string, { made: number; adopted: number }> = {};
  for (const r of rows) (usage[r.template_slug] ??= { made: 0, adopted: 0 }).made += 1;
  if (rows.length) {
    const { data: links } = await supabase.from('ai_artifact_notes').select('group_id').in('group_id', rows.map(r => r.group_id).slice(0, 300));
    const adopted = new Set(((links ?? []) as Array<{ group_id: string }>).map(l => l.group_id));
    for (const r of rows) if (adopted.has(r.group_id)) usage[r.template_slug].adopted += 1;
  }
  return usage;
}

router.get('/spaces/:spaceId/agent-practices', verifyJWT, async (req: Request, res: Response) => {
  const space = await ensureSpaceStaff(String(req.params.spaceId), req.user!);
  const courseId = space.course_id;
  const [cards, turns, templates, usage] = await Promise.all([loadCards(courseId), collectTurns(courseId), courseTemplates(courseId), templateUsage(courseId)]);

  // 在用的卡：看试用结果，用满还没更好就撤回
  const trials = new Map<string, ReturnType<typeof trialVerdict>>();
  for (const c of cards.filter(x => x.status === 'active')) {
    const v = trialVerdict(c.baseline_rate, turns.filter(t => t.cards.includes(c.id)));
    trials.set(c.id, v);
    if (v.verdict === 'retire') {
      const now = new Date().toISOString();
      await supabase.from('agent_practice_cards').update({ status: 'retired', retired_reason: v.reason, updated_at: now }).eq('id', c.id);
      c.status = 'retired';
      c.retired_reason = v.reason ?? null;
      invalidatePracticeCache(courseId);
    }
  }
  const induced = cards.filter(c => c.origin === 'induced').map(c => Date.parse(c.created_at));
  const pages = await goodPages(courseId, new Set(templates.map(t => t.sourceArtifactId).filter((x): x is string => Boolean(x))));
  res.json({
    cards: cards.map(c => cardToApi(c, trials.get(c.id))),
    stats: {
      turns: turns.length,
      windowDays: PRACTICE_LIMITS.windowDays,
      minKindTurns: PRACTICE_LIMITS.minKindTurns,
      byKind: kindRates(turns),
      lastGeneratedAt: induced.length ? new Date(Math.max(...induced)).toISOString() : null,
    },
    templates: {
      builtin: BUILTIN_TEMPLATES.map(t => ({ slug: t.slug, name: t.name, whenToUse: t.whenToUse, usage: usage[t.slug] ?? { made: 0, adopted: 0 } })),
      course: templates.map(t => ({ id: t.id, slug: t.slug, name: t.name, whenToUse: t.whenToUse, guide: t.guide, usage: usage[t.slug] ?? { made: 0, adopted: 0 } })),
    },
    goodPages: pages,
  });
});

/** 把挑出来的做法写成给智能体的一句话：模型写不出来就用现成的说法 */
async function phrase(courseId: string, s: FeatureStat, examples: string[]): Promise<{ practice: string; rationale: string }> {
  const fallback = { practice: FEATURES[s.feature].practice, rationale: evidenceSentence(s) };
  try {
    const chain = await resolveCourseProviderChain(courseId, 'teacher_agents');
    if (!chain.length) return fallback;
    const system = [
      '你帮老师把学生和学习智能体的对话记录里看出来的一个规律，写成给智能体的一条做法。',
      '只写一句中文祈使句，40 字以内，具体到能照着做；不提学生姓名，不夸大，不承诺效果。',
      '只输出 JSON：{"practice":"……"}',
    ].join('\n');
    const user = [
      `任务类型：${TASK_KIND_ZH[s.kind]}`,
      `规律：${FEATURES[s.feature].zh}的回答更常被学生接住（${s.with.took}/${s.with.total}，对比没这样做的 ${s.without.took}/${s.without.total}）。`,
      examples.length ? `几个被接住的例子（学生的问题 → 回答开头）：\n${examples.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    const out = await callJson(chain[0], system, user, 400, 'fast', chain.slice(1));
    const practice = typeof out?.practice === 'string' ? out.practice.replace(/\s+/g, ' ').trim() : '';
    if (practice.length >= 6 && practice.length <= 80) return { practice, rationale: fallback.rationale };
  } catch (err) {
    console.error('[AgentPractices] phrase failed:', err instanceof Error ? err.message : err);
  }
  return fallback;
}

router.post('/spaces/:spaceId/agent-practices/generate', verifyJWT, async (req: Request, res: Response) => {
  const space = await ensureSpaceStaff(String(req.params.spaceId), req.user!);
  const courseId = space.course_id;
  const [turns, existing] = await Promise.all([collectTurns(courseId), loadCards(courseId)]);
  const picks = pickCandidates(featureStats(turns), existing);
  if (picks.length === 0) {
    const enough = Object.values(kindRates(turns)).some(r => r.total >= PRACTICE_LIMITS.minKindTurns);
    res.json({ created: 0, reason: enough ? 'nothing_clear' : 'not_enough', turns: turns.length });
    return;
  }
  const since = new Date(Date.now() - PRACTICE_LIMITS.windowDays * 86_400_000).toISOString();
  const created: PracticeCard[] = [];
  for (const s of picks) {
    const examples = turns
      .filter(t => t.kind === s.kind && t.features.includes(s.feature) && (t.adopted || t.engaged))
      .slice(0, 3)
      .map(t => `- ${t.question.replace(/\s+/g, ' ').slice(0, 80)} → ${t.reply.replace(/\s+/g, ' ').slice(0, 140)}`);
    const { practice, rationale } = await phrase(courseId, s, examples);
    if (duplicateOf(practice, s.kind, [...existing, ...created])) continue;
    const { data, error } = await supabase.from('agent_practice_cards').insert({
      course_id: courseId,
      task_kind: s.kind,
      practice,
      rationale,
      evidence: { feature: s.feature, with: s.with, without: s.without, window: { from: since, to: new Date().toISOString() } },
      origin: 'induced',
      status: 'candidate',
      created_by: req.user!.id,
    }).select('id, course_id, task_kind, practice, rationale, evidence, origin, status, baseline_rate, decided_at, retired_reason, created_at').single();
    if (error) throw new ApiError(500, error.message);
    created.push(data as PracticeCard);
  }
  logEvent({ actor_id: req.user!.id, actor_role: req.user!.role, event_type: 'agent_practices_generated', object_type: 'course', object_id: courseId, metadata_json: { created: created.length, turns: turns.length } });
  res.json({ created: created.length, turns: turns.length, cards: created.map(c => cardToApi(c)) });
});

/** 采用时这类任务的接住率：试用对照。样本太少就不记（不会自动撤回） */
async function baselineFor(courseId: string, kind: TaskKind): Promise<number | null> {
  const rate = kindRates(await collectTurns(courseId))[kind];
  return rate.total >= PRACTICE_LIMITS.minGroup ? rate.rate : null;
}

router.post('/spaces/:spaceId/agent-practices', verifyJWT, async (req: Request, res: Response) => {
  const space = await ensureSpaceStaff(String(req.params.spaceId), req.user!);
  const courseId = space.course_id;
  const { task_kind, practice } = (req.body ?? {}) as { task_kind?: unknown; practice?: unknown };
  if (!TASK_KINDS.includes(task_kind as TaskKind)) throw new ApiError(400, 'task_kind is invalid');
  const text = typeof practice === 'string' ? practice.replace(/\s+/g, ' ').trim() : '';
  if (text.length < 4 || text.length > 120) throw new ApiError(400, '做法写一句话，4 到 120 个字');
  const existing = await loadCards(courseId);
  if (duplicateOf(text, task_kind as TaskKind, existing.filter(c => c.status === 'active' || c.status === 'candidate'))) throw new ApiError(409, '已经有一张差不多的卡了');
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('agent_practice_cards').insert({
    course_id: courseId, task_kind, practice: text, origin: 'teacher', status: 'active',
    baseline_rate: await baselineFor(courseId, task_kind as TaskKind),
    decided_by: req.user!.id, decided_at: now, created_by: req.user!.id,
  }).select('id, course_id, task_kind, practice, rationale, evidence, origin, status, baseline_rate, decided_at, retired_reason, created_at').single();
  if (error) throw new ApiError(500, error.message);
  invalidatePracticeCache(courseId);
  logEvent({ actor_id: req.user!.id, actor_role: req.user!.role, event_type: 'agent_practice_card_written', object_type: 'agent_practice_card', object_id: (data as PracticeCard).id, metadata_json: { course_id: courseId, task_kind } });
  res.json({ card: cardToApi(data as PracticeCard) });
});

router.patch('/spaces/:spaceId/agent-practices/:cardId', verifyJWT, async (req: Request, res: Response) => {
  const space = await ensureSpaceStaff(String(req.params.spaceId), req.user!);
  const courseId = space.course_id;
  const cardId = String(req.params.cardId);
  const status = (req.body ?? {}).status;
  if (!isUuid(cardId)) throw new ApiError(400, 'card id is required');
  if (!['active', 'rejected', 'retired'].includes(status)) throw new ApiError(400, 'status must be active, rejected or retired');
  const { data: card } = await supabase.from('agent_practice_cards').select('id, task_kind, status').eq('id', cardId).eq('course_id', courseId).maybeSingle();
  if (!card) throw new ApiError(404, 'Card not found');
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, decided_by: req.user!.id, decided_at: now, updated_at: now };
  if (status === 'active') {
    patch.baseline_rate = await baselineFor(courseId, (card as { task_kind: TaskKind }).task_kind);
    patch.retired_reason = null;
  }
  if (status === 'retired') patch.retired_reason = '老师撤回';
  const { error } = await supabase.from('agent_practice_cards').update(patch).eq('id', cardId).eq('course_id', courseId);
  if (error) throw new ApiError(500, error.message);
  invalidatePracticeCache(courseId);
  logEvent({ actor_id: req.user!.id, actor_role: req.user!.role, event_type: 'agent_practice_card_decided', object_type: 'agent_practice_card', object_id: cardId, metadata_json: { course_id: courseId, from: (card as { status: string }).status, to: status } });
  res.json({ ok: true });
});

/** 把一个做得好的网页存成本课模板：模型只抽版式、组件、交互，不抄内容 */
router.post('/spaces/:spaceId/page-templates/from-artifact', verifyJWT, async (req: Request, res: Response) => {
  const space = await ensureSpaceStaff(String(req.params.spaceId), req.user!);
  const courseId = space.course_id;
  const artifactId = (req.body ?? {}).artifact_id;
  if (!isUuid(artifactId)) throw new ApiError(400, 'artifact_id is required');
  const { data: art } = await supabase.from('ai_artifacts').select('id, title, brief, html, course_id').eq('id', artifactId).eq('course_id', courseId).maybeSingle();
  if (!art) throw new ApiError(404, 'Page not found in this course');
  const chain = await resolveCourseProviderChain(courseId, 'teacher_agents');
  if (!chain.length) throw new ApiError(400, '这门课还没配置教师端用的 AI');
  const page = art as { id: string; title: string; brief: string | null; html: string };
  const system = [
    '你把一个教学网页抽象成可以反复用的模板，给另一个写网页的模型照着写同类网页。',
    '只写版式、组件、交互和必须有的部分；不写这个网页的具体内容、人名、笔记标题、数据。',
    '保留对学生主体性有用的设计（开放题、让学生自己写的文本框、标出处）。',
    '只输出 JSON：{"name":"模板名，8 字以内","when_to_use":"什么时候用，一句话","guide":"4–6 行结构说明，每行一条"}',
  ].join('\n');
  const html = page.html.replace(/<script[\s\S]*?<\/script>/gi, '<script>…</script>').replace(/<style[\s\S]*?<\/style>/gi, '<style>…</style>').slice(0, 24_000);
  const user = [`网页标题：${page.title}`, page.brief ? `当时的制作说明：\n${page.brief.slice(0, 2000)}` : '', `HTML（脚本和样式已省略）：\n${html}`].filter(Boolean).join('\n\n');
  const out = await callJson(chain[0], system, user, 1200, 'fast', chain.slice(1));
  const name = typeof out?.name === 'string' ? out.name.trim().slice(0, 16) : '';
  const whenToUse = typeof out?.when_to_use === 'string' ? out.when_to_use.trim().slice(0, 80) : '';
  const guideRaw = out?.guide;
  const guide = (Array.isArray(guideRaw) ? guideRaw.join('\n') : typeof guideRaw === 'string' ? guideRaw : '').trim().slice(0, 1200);
  if (!name || !whenToUse || guide.length < 30) throw new ApiError(502, '模板没抽出来，换一个网页或稍后再试');
  const taken = (await courseTemplates(courseId)).map(t => t.slug);
  const { data: allSlugs } = await supabase.from('agent_page_templates').select('slug').eq('course_id', courseId);
  const slug = templateSlug(name, [...taken, ...((allSlugs ?? []) as Array<{ slug: string }>).map(r => r.slug)]);
  const { data, error } = await supabase.from('agent_page_templates').insert({
    course_id: courseId, slug, name, when_to_use: whenToUse, guide, source_artifact_id: page.id, created_by: req.user!.id,
  }).select('id, slug, name, when_to_use, guide').single();
  if (error) throw new ApiError(500, error.message);
  logEvent({ actor_id: req.user!.id, actor_role: req.user!.role, event_type: 'page_template_saved', object_type: 'agent_page_template', object_id: (data as { id: string }).id, metadata_json: { course_id: courseId, artifact_id: page.id } });
  const t = data as { id: string; slug: string; name: string; when_to_use: string; guide: string };
  res.json({ template: { id: t.id, slug: t.slug, name: t.name, whenToUse: t.when_to_use, guide: t.guide } });
});

router.patch('/spaces/:spaceId/page-templates/:templateId', verifyJWT, async (req: Request, res: Response) => {
  const space = await ensureSpaceStaff(String(req.params.spaceId), req.user!);
  const status = (req.body ?? {}).status;
  if (status !== 'active' && status !== 'retired') throw new ApiError(400, 'status must be active or retired');
  const { data, error } = await supabase.from('agent_page_templates').update({ status, updated_at: new Date().toISOString() })
    .eq('id', String(req.params.templateId)).eq('course_id', space.course_id).select('id');
  if (error) throw new ApiError(500, error.message);
  if (!data?.length) throw new ApiError(404, 'Template not found');
  res.json({ ok: true });
});

export default router;
