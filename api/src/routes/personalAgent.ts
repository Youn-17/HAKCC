/**
 * Personal Agent Routes — user-scoped AI assistant at /ai-assistant
 *
 * Unlike the workspace agent (course-scoped, note-anchored), the personal
 * agent is user-scoped.  It can help with cross-course questions, general
 * Knowledge Building theory, research planning, and lesson preparation.
 *
 * Conversations are persisted in agent_conversations / agent_messages.
 * Analytics logs also go to ai_interventions.
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, type AuthUser } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import {
  ensureCourseInstructor,
  enterableSpaceIds,
  isCourseStaff,
  listCourseStandings,
  type CourseStanding,
} from '../services/accessControl';
import {
  decryptProviderApiKey,
  providerConfigToApi,
} from '../services/aiProviderConfig';
import {
  normalizeConversationAgentMode,
  getAgentModeToolNames,
} from '../services/noteAgentCatalog';
import { runAgentLoopStream } from '../services/agentLoop';
import { lengthInstruction, lengthPlanMetadata, maxTokensFor, parseAnswerLength, planAnswerLength, thinkingLikely } from '../services/answerLength';
import { drawRouteSummary, routeDrawRequest } from '../services/drawJudge';
import { lastReplyFromTurns, loadLastExchange, loadRecentTurns, loadStoredMemory, streamDrawTurn } from '../services/drawTurn';
import { loadStudentLearningContext } from '../services/studentLearningContext';
import { isDmxProvider, pickModel, pickNativeModel, reportModelFailure, reportModelSuccess, reportProviderFailure, reportProviderSuccess, orderConfigsByHealth } from '../services/modelRouter';
import {
  applyPickerToConfigs,
  choiceModelFor,
  featureChoice,
  getAiFeature,
  loadCourseAiRows,
  pickerAllowlist,
  preferChoice,
  resolvePickerSelection,
  settingsFromRows,
  sortByOrder,
  type CourseAiRow,
} from '../services/aiFeatureModels';
import {
  buildAgentContext,
  stripHtml,
  updateProfileAfterInteraction,
  type AgentRole,
} from '../services/agentContext';
import { createDefaultRegistry } from '../services/agentTools';
import { getTeacherContext } from '../services/teacherMemoryService';
import { summarizeToolResult } from '../services/toolResultSummary';
import {
  startRun, transitionRun, recordEffect, failRun,
} from '../services/agentLifecycle';

const router = Router();
const PERSONAL_AGENT_MAX_TOKENS = 8192;
const agentRegistry = createDefaultRegistry();

// Simple in-memory rate limiter: max 20 requests per user per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60_000).unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect all course IDs the user has access to (as member or instructor).
 */
async function getUserCourseIds(userId: string): Promise<string[]> {
  const [memberRes, instructedRes] = await Promise.all([
    supabase
      .from('course_members')
      .select('course_id')
      .eq('user_id', userId),
    supabase
      .from('courses')
      .select('id')
      .eq('instructor_id', userId),
  ]);

  return Array.from(new Set([
    ...(memberRes.data ?? []).map((m: any) => m.course_id as string),
    ...(instructedRes.data ?? []).map((c: any) => c.id as string),
  ]));
}

/**
 * Verify that a user has access to a specific course (as member or instructor).
 */
async function verifyUserCourseAccess(
  userId: string,
  userRole: string,
  courseId: string,
): Promise<boolean> {
  // Admins can access any course
  if (userRole === 'admin') return true;

  const [memberRes, instructedRes] = await Promise.all([
    supabase
      .from('course_members')
      .select('course_id')
      .eq('course_id', courseId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('courses')
      .select('id')
      .eq('id', courseId)
      .eq('instructor_id', userId)
      .maybeSingle(),
  ]);

  return !!(memberRes.data || instructedRes.data);
}

/** ensureCourseInstructor 的布尔版：这几门课此人是不是都有教职（创建者 / 课程管理员 / 平台管理员）。 */
async function instructsEvery(courseIds: string[], user: AuthUser): Promise<boolean> {
  try {
    for (const courseId of courseIds) await ensureCourseInstructor(courseId, user);
    return true;
  } catch (err) {
    if (err instanceof ApiError && (err.statusCode === 403 || err.statusCode === 404)) return false;
    throw err;
  }
}

/**
 * 备课 / 学情分析在这门课放不放行，/configs 按它给每门课打 teacherModes。
 * 口径同 /stream 的门：平台管理员，或教师账号在课里有教职。课内身份的课程管理员这一档已经要求
 * 教师账号（见 accessControl 的 memberStanding），和 ensureCourseInstructor 一致；测试逐课对照两边。
 */
function allowsTeacherModes(user: AuthUser, standing: CourseStanding): boolean {
  return user.role === 'admin' || (user.role === 'teacher' && isCourseStaff(standing));
}

/**
 * 个人助手的身份和规则，只点这一轮真的给了的工具：生成 Word、数据分析、save_teaching_insight
 * 都只注册给教师，也只挂在备课 / 学情分析两个模式上。以前这里写死「你有这些工具，必须调用，
 * 不许说做不了文件」，学生的「AI 对话」和教师的其他模式也照收，模型就可能自称做好了 Word、
 * 编出下载链接（2026-10-06 改）。图表不许诺：服务器上的 canvas 原生模块没装上时画不出图，
 * 工具结果里有 chartUrl 才放图。
 */
function personalSystemAddition(toolNames: string[]): string {
  const offered = (...names: string[]) => names.filter((name) => toolNames.includes(name));
  const docTools = offered('generate_summary_doc', 'export_notes');
  const dataTools = offered('analyze_engagement', 'compare_periods');
  const rules = ['NEVER use emoji or emoticons. Write clean, professional text only.'];

  rules.push(docTools.length > 0
    ? `${docTools.join(' and ')} create real downloadable Word (.docx) files. When the user asks for a document, report, Word file, or export, you MUST call ${docTools.length > 1 ? 'one of them' : 'it'} immediately instead of suggesting manual copy-paste.`
    : 'You cannot create downloadable files here. If asked for a Word file, a report or an export, say so and give the content in your reply instead.');
  rules.push(dataTools.length > 0
    ? `When the user asks for data analysis, you MUST call ${dataTools.join(' or ')}. They return the figures; present them in a markdown table. They do not always make a chart, so never promise one.`
    : `You cannot plot charts of real data here${offered('generate_image').length > 0 ? ' (generate_image draws pictures; it cannot plot data)' : ''}. If asked for a chart, say so and give the figures in a markdown table instead.`);
  rules.push(docTools.length + dataTools.length > 0
    ? 'Link only what a tool result returns: a Word file as [fileName](downloadUrl) or [reportFileName](reportUrl), a chart as ![description](chartUrl). If the URL is not in the result, that file or chart was not made: say so instead of writing a link.'
    : 'Never write a download link for a file that was not made.');
  rules.push('Use markdown tables with | pipe syntax when presenting tabular data.');
  if (offered('save_teaching_insight').length > 0) {
    rules.push('You have a save_teaching_insight tool. Call it only when the TEACHER states a decision, plan, or observation in their own words. Do not save your own analysis or lesson drafts as insights, and never spend a separate turn on it: if you do call it, include it in the same turn as your other tool calls. Saved insights appear in the Lesson Prep, Analytics, and Assessment modules.');
  }
  rules.push('Gather data in as few turns as possible: issue all the tool calls you need in one turn (they run together), then answer. Do not repeat a call whose result you already have.');

  return [
    'You are a personal AI assistant for Knowledge Building education.',
    'You help with lesson planning, research, idea development, and pedagogical questions.',
    'You can access notes from the user\'s courses when a course context is provided.',
    'Be helpful, concise, and ground your answers in Knowledge Building principles when relevant.',
    'CRITICAL RULES:',
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
  ].join(' ');
}

// ---------------------------------------------------------------------------
// GET /personal-agent/configs — aggregate AI configs from all user's courses
// ---------------------------------------------------------------------------

router.get('/personal-agent/configs', verifyJWT, async (req: Request, res: Response) => {
  const user = req.user!;
  const standings = await listCourseStandings(user);
  const courseIds = Array.from(standings.keys());

  if (courseIds.length === 0) {
    return res.json({ configs: [], courses: [] });
  }

  // Fetch course details for context
  const { data: courses } = await supabase
    .from('courses')
    .select('id, title')
    .in('id', courseIds);

  // Fetch AI configs from all enrolled courses
  const { data: rawConfigs, error } = await supabase
    .from('teacher_ai_configs')
    .select('id, course_id, provider_id, api_key_encrypted, endpoint_url, is_verified, enabled_models, configured_at, trigger_settings')
    .in('course_id', courseIds);

  if (error) throw new ApiError(500, error.message);

  // Deduplicate by provider_id — prefer verified configs, then the most recent
  const configsByProvider = new Map<string, any>();
  for (const config of rawConfigs ?? []) {
    const existing = configsByProvider.get(config.provider_id);
    if (!existing) {
      configsByProvider.set(config.provider_id, config);
    } else if (!existing.is_verified && config.is_verified) {
      // Prefer a verified config
      configsByProvider.set(config.provider_id, config);
    }
  }

  // Return all configs (not just deduplicated) so the client can choose by course
  // 每门课的教师可以限定学生在「AI 对话」菜单里看到哪些模型（课程 AI 设置）。
  // 名单是给学生定的：这个人在那门课有教职（能用教师模式）就不套。
  const configs = courseIds.flatMap((courseId) => {
    const courseRows = (rawConfigs ?? []).filter((config: any) => config.course_id === courseId);
    const apiConfigs = courseRows.map((config: any) => ({
      ...providerConfigToApi(config, { includeEndpointUrl: false }),
      courseId: config.course_id as string,
    }));
    const standing = standings.get(courseId) ?? 'member';
    return allowsTeacherModes(user, standing)
      ? apiConfigs
      : applyPickerToConfigs('personal_agent', courseRows as CourseAiRow[], apiConfigs);
  });

  res.json({
    configs,
    // 教师账号凭学生验证码入课，在那门课就是普通成员：前端只在 teacherModes 为 true 的课里用教师模式，
    // 否则第一句话就撞上 /stream 的 403。放不放行仍以 /stream 为准。
    courses: (courses ?? []).map((c: any) => {
      const standing = standings.get(c.id) ?? 'member';
      return { id: c.id, title: c.title, standing, teacherModes: allowsTeacherModes(user, standing) };
    }),
  });
});

// ---------------------------------------------------------------------------
// GET /personal-agent/conversations — list personal agent conversations
// ---------------------------------------------------------------------------

// 教师端四个入口（AI 对话 / 备课助手 / 学情分析 / 教学评估）各自一份历史。
// 以前只按 agent_mode 存，学情分析和教学评估都是 teaching_analyst，历史混在一起，
// 备课的对话也会出现在学情分析里。
const CONVERSATION_MODULES = new Set(['chat', 'lesson', 'analytics', 'assessment']);

function normalizeConversationModule(value: unknown): string | null {
  return typeof value === 'string' && CONVERSATION_MODULES.has(value) ? value : null;
}

router.get('/personal-agent/conversations', verifyJWT, async (req: Request, res: Response) => {
  const module = normalizeConversationModule(req.query.module);
  let query = supabase
    .from('agent_conversations')
    .select('id, title, agent_mode, module, course_id, provider_id, model, updated_at')
    .eq('user_id', req.user!.id)
    .eq('agent_type', 'personal');
  if (module) query = query.eq('module', module);
  const { data } = await query
    .order('updated_at', { ascending: false })
    .limit(30);
  res.json({ conversations: data ?? [] });
});

// ---------------------------------------------------------------------------
// POST /personal-agent/conversations — create a new personal conversation
// ---------------------------------------------------------------------------

router.post('/personal-agent/conversations', verifyJWT, async (req: Request, res: Response) => {
  const { title, course_id } = req.body;
  const { data, error } = await supabase
    .from('agent_conversations')
    .insert({
      agent_type: 'personal',
      user_id: req.user!.id,
      course_id: course_id ?? null,
      title: title ?? 'New conversation',
    })
    .select()
    .single();
  if (error) throw new ApiError(500, error.message);
  res.json({ conversation: data });
});

// ---------------------------------------------------------------------------
// DELETE /personal-agent/conversations/:convId — delete a conversation
// ---------------------------------------------------------------------------

router.delete('/personal-agent/conversations/:convId', verifyJWT, async (req: Request, res: Response) => {
  const { data: conv } = await supabase
    .from('agent_conversations')
    .select('id')
    .eq('id', req.params.convId)
    .eq('user_id', req.user!.id)
    .single();
  if (!conv) throw new ApiError(404, 'Conversation not found');

  await supabase.from('agent_messages').delete().eq('conversation_id', conv.id);
  await supabase.from('agent_conversations').delete().eq('id', conv.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /personal-agent/conversations/:convId/messages — load messages
// ---------------------------------------------------------------------------

router.get('/personal-agent/conversations/:convId/messages', verifyJWT, async (req: Request, res: Response) => {
  // 自己的、个人助手的对话；知识空间助手的对话走它自己的路由
  const { data: conv } = await supabase
    .from('agent_conversations')
    .select('id')
    .eq('id', req.params.convId)
    .eq('user_id', req.user!.id)
    .eq('agent_type', 'personal')
    .single();
  if (!conv) throw new ApiError(404, 'Conversation not found');

  // 最近的 100 条，翻回正序。原来正序取 100 条，对话一长读回来的是开头那 100 条，最近说的反而看不到（10-07 修）
  const { data } = await supabase
    .from('agent_messages')
    .select('id, role, content, tools_used, ai_metadata, created_at')
    .eq('conversation_id', req.params.convId)
    .order('created_at', { ascending: false })
    .limit(100);
  res.json({ messages: [...(data ?? [])].reverse() });
});

// ---------------------------------------------------------------------------
// POST /personal-agent/stream — Agent Loop streaming for personal queries
// ---------------------------------------------------------------------------

router.post('/personal-agent/stream', verifyJWT, async (req: Request, res: Response) => {
  const {
    content,
    provider_id: requestedProviderId,
    model: requestedModel,
    course_id,
    context_course_id,
    agent_mode,
    module,
    history = [],
    conversation_id,
    answer_length,
  } = req.body as {
    content?: string;
    provider_id?: string;
    model?: string;
    course_id?: string;
    context_course_id?: string;
    agent_mode?: unknown;
    module?: unknown;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    conversation_id?: string;
    answer_length?: unknown;
  };
  const conversationModule = normalizeConversationModule(module) ?? 'chat';
  const contextCourseId = typeof context_course_id === 'string' && context_course_id ? context_course_id : undefined;
  // 学生首页「AI 对话」的菜单名单可能把选择改掉（见下面 personal_agent 那段）
  let provider_id = requestedProviderId;
  let model = requestedModel;

  if (!content?.trim()) throw new ApiError(400, 'content is required');
  if (!provider_id || !model) throw new ApiError(400, 'provider_id and model are required');
  if (!checkRateLimit(req.user!.id)) throw new ApiError(429, 'Too many requests. Please wait a moment.');

  const userId = req.user!.id;
  const userRole = req.user!.role;

  // Resolve course_id: use provided value, or auto-find a course with this provider configured
  let resolvedCourseId: string = course_id ?? '';
  if (!resolvedCourseId) {
    const courseIds = await getUserCourseIds(userId);
    if (courseIds.length === 0) throw new ApiError(400, 'No courses available for API key resolution');
    const effectiveProvider = provider_id === 'auto' ? undefined : provider_id;
    let query = supabase
      .from('teacher_ai_configs')
      .select('course_id, provider_id')
      .in('course_id', courseIds)
      .not('api_key_encrypted', 'is', null);
    if (effectiveProvider) query = query.eq('provider_id', effectiveProvider);
    const { data: availableConfigs } = await query.limit(1);
    if (!availableConfigs || availableConfigs.length === 0) {
      throw new ApiError(404, 'No AI provider configured in any of your courses');
    }
    resolvedCourseId = availableConfigs[0].course_id;
  }

  // Verify user has access to the course whose API key they want to use
  const hasAccess = await verifyUserCourseAccess(userId, userRole, resolvedCourseId);
  if (!hasAccess) throw new ApiError(403, 'You do not have access to this course');

  // Fetch available provider configs — when "auto", sort by preference.
  // The course AI settings' choice for this entry goes first (see
  // services/aiFeatureModels). Then native first-party keys (GLM / DeepSeek)
  // lead: newest models, already paid for, but concurrency-capped. DMX follows
  // as the uncapped overflow lane; orderConfigsByHealth() sinks any provider
  // that just hit its limit.
  // 教师端三个模块（备课助手 / 学情分析 / 教学评估）统一先走 DeepSeek（2026-09-10 定）：
  // 智谱 Coding Plan 那把 key 并发上限只有 6，学生端画布已经在用；教师这边的
  // 长对话和工具循环不该和学生抢那 6 个名额。两套顺序都在 aiFeatureModels 里。

  const normalizedAgentMode = normalizeConversationAgentMode(agent_mode);
  const modeToolNames = getAgentModeToolNames(normalizedAgentMode);
  const needsToolCalling = modeToolNames.length > 0;
  const isTeacherAgentMode = normalizedAgentMode === 'lesson_planner' || normalizedAgentMode === 'teaching_analyst';

  // 教师身份按课算，不按账号算：教师账号拿学生验证码入课，在那门课里就是学生。
  // 备课和学情分析带着全课的教师工具（学生画像、参与度、导出全部笔记），课程级工具读
  // API key 那门课，空间级工具读上下文那门课，所以两门都得有教职才放行。
  const touchedCourseIds = Array.from(new Set([resolvedCourseId, contextCourseId].filter((id): id is string => Boolean(id))));
  const isCourseStaff = userRole === 'admin'
    || (userRole === 'teacher' && await instructsEvery(touchedCourseIds, req.user!));
  if (isTeacherAgentMode && !isCourseStaff) {
    throw new ApiError(403, 'Lesson planning and learning analytics are only available to the course instructor and course managers');
  }
  const effectiveRole: AgentRole = userRole === 'admin' ? 'admin' : isCourseStaff ? 'teacher' : 'student';

  const featureId = isTeacherAgentMode ? 'teacher_agents' : 'personal_agent';

  // 教师在课程 AI 设置里限定了学生「AI 对话」菜单里的模型：学生只能用名单里的，
  // 「自动」和名单外的选择（页面没刷新、手改请求）都落到名单里的默认模型。教职不受这份名单限制。
  if (featureId === 'personal_agent' && effectiveRole === 'student') {
    const courseRows = await loadCourseAiRows(resolvedCourseId).catch(() => [] as CourseAiRow[]);
    if (pickerAllowlist(settingsFromRows(courseRows), 'personal_agent')) {
      const picked = resolvePickerSelection('personal_agent', courseRows, { providerId: provider_id, model });
      if (!picked) throw new ApiError(404, 'No AI provider configured for this course');
      provider_id = picked.providerId;
      model = picked.model;
    }
  }

  let configQuery = supabase
    .from('teacher_ai_configs')
    .select('provider_id, api_key_encrypted, endpoint_url, is_verified, enabled_models, configured_at, trigger_settings')
    .eq('course_id', resolvedCourseId)
    .not('api_key_encrypted', 'is', null);
  if (provider_id !== 'auto') {
    configQuery = configQuery.eq('provider_id', provider_id);
  }
  const { data: configRows } = await configQuery.order('is_verified', { ascending: false });
  let availableConfigs = (configRows ?? []).filter((c: any) => c.api_key_encrypted);
  // 「自动」时课程 AI 设置里给这个入口选的模型排第一；手选了厂商就照手选的
  const choice = provider_id === 'auto' ? featureChoice(featureId, availableConfigs as CourseAiRow[]) : null;
  if (provider_id === 'auto' && availableConfigs.length > 1) {
    availableConfigs = preferChoice(sortByOrder(availableConfigs, getAiFeature(featureId).order), choice);
    // Sink providers that recently hit their concurrency cap (DMX never sinks)
    availableConfigs = orderConfigsByHealth(availableConfigs);
    console.log(`[personalAgent] auto provider order: ${availableConfigs.map((c: any) => c.provider_id).join(' → ')}`);
  }

  if (availableConfigs.length === 0) {
    throw new ApiError(404, `No AI provider configured for this course`);
  }
  let config = availableConfigs[0];
  let resolvedProviderId = config.provider_id;
  let apiKey = decryptProviderApiKey(config.api_key_encrypted);

  // Optionally fetch notes from a context course for grounding
  let contextNotes: Array<{ id: string; title: string; content: string; space_id: string }> = [];
  let contextSpaceId: string | null = null;

  if (contextCourseId) {
    // 笔记摘录进系统提示，contextSpaceId 又是 search_notes 等工具读的空间，
    // 两样都只能来自调用者进得去的空间，不然组 A 的学生读得到组 B 的笔记。
    const spaceIds = await enterableSpaceIds(contextCourseId, req.user!);
    if (spaceIds.length > 0) {
      const { data: notes } = await supabase
        .from('notes')
        .select('id, title, content, space_id')
        .in('space_id', spaceIds)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(20);
      contextNotes = (notes ?? []) as any;
      // Use the space that has the most notes as primary context
      const spaceCounts = new Map<string, number>();
      for (const n of contextNotes) {
        spaceCounts.set(n.space_id, (spaceCounts.get(n.space_id) ?? 0) + 1);
      }
      let bestSpace = spaceIds[0];
      let bestCount = 0;
      for (const [sid, cnt] of spaceCounts) {
        if (cnt > bestCount) { bestSpace = sid; bestCount = cnt; }
      }
      contextSpaceId = bestSpace;
    }
  }

  // Build a synthetic "note" that represents the personal agent context
  const noteContextSummary = contextNotes.length > 0
    ? `User has access to notes:\n${contextNotes.map(
        (n) => `- ${n.title}: ${stripHtml(n.content ?? '').slice(0, 150)}`,
      ).join('\n')}`
    : 'General Knowledge Building assistance.';

  const personalNote = {
    id: 'personal-context',
    title: 'Personal AI Assistant',
    content: noteContextSummary,
    spaceId: contextSpaceId ?? 'personal',
    courseId: resolvedCourseId,
  };

  // normalizedAgentMode already resolved above for auto-provider selection

  // Resolve model: the course's choice for this entry when this is its
  // provider; otherwise DMX uses the task-aware router (frontier GPT/Claude
  // tier) and native providers prefer their newest models.
  const autoModelFor = (row: any): string => choiceModelFor(choice, row.provider_id)
    ?? (isDmxProvider(row.provider_id)
      ? pickModel(needsToolCalling ? 'agent' : 'chat')
      : (pickNativeModel(row.provider_id, row.enabled_models) ?? model));
  let resolvedModel = model;
  if (model === 'auto') {
    resolvedModel = autoModelFor(config);
  }

  // Resolve or create conversation for persistence
  let convId = conversation_id;
  if (convId) {
    // conversation_id comes from the request body. Unverified, it lets a caller
    // append forged user/assistant turns to somebody else's private agent
    // thread; fall back to a fresh conversation when it is not theirs.
    // 也得是个人助手的对话：知识空间助手的对话 id 拿来这里问，会写进那段、读进它的历史（10-07 修）
    const { data: existingConv } = await supabase
      .from('agent_conversations')
      .select('id')
      .eq('id', convId)
      .eq('user_id', userId)
      .eq('agent_type', 'personal')
      .maybeSingle();
    if (!existingConv) convId = undefined;
  }
  if (!convId) {
    const { data: newConv, error: convError } = await supabase
      .from('agent_conversations')
      .insert({
        agent_type: 'personal',
        user_id: userId,
        course_id: resolvedCourseId ?? null,
        title: content.trim().slice(0, 80) || 'New conversation',
        agent_mode: normalizedAgentMode,
        module: conversationModule,
        provider_id: resolvedProviderId,
        model: resolvedModel,
      })
      .select('id')
      .single();
    if (convError) throw new ApiError(500, convError.message);
    convId = newConv.id;
  }

  // Save the user message
  await supabase.from('agent_messages').insert({
    conversation_id: convId,
    role: 'user',
    content: content.trim(),
  });

  // 要不要画、是不是改上一张、画成哪种：Jev 判断（drawJudge），没开或出错时按「画一张……」这类说法认。
  // 要画就不经对话模型，直接出图（DMX 优先，用这门课的 key），前端放绘图动画
  const continuing = Boolean(conversation_id && convId === conversation_id);
  const clientTurns = history
    .filter(m => m.content?.trim())
    .slice(-12)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content }));
  const lastExchange = !resolvedCourseId
    ? { previous: null, lastReply: null }
    : continuing
      ? await loadLastExchange('agent', String(convId), content)
      : { previous: null, lastReply: lastReplyFromTurns(clientTurns) };
  const drawRoute = resolvedCourseId
    ? await routeDrawRequest(content, { previous: lastExchange.previous, lastReply: lastExchange.lastReply })
    : null;
  if (drawRoute?.draw && resolvedCourseId) {
    // 画之前先读这段对话、它的记忆、选了课时能看到的笔记、学生自己的记录（drawPlanner）
    const [recent, memory, learner] = await Promise.all([
      continuing
        ? loadRecentTurns('agent', String(convId), content)
        : Promise.resolve(clientTurns),
      continuing ? loadStoredMemory('agent', String(convId)) : Promise.resolve(''),
      effectiveRole === 'student' && contextCourseId === resolvedCourseId
        ? loadStudentLearningContext({ userId, courseId: resolvedCourseId, question: content }).catch(() => '')
        : Promise.resolve(''),
    ]);
    const background = contextNotes.length > 0
      ? ['Notes the learner can see in this course (most recently updated first):',
        ...contextNotes.map((n, i) => `${i + 1}. "${n.title}" — ${stripHtml(n.content ?? '').slice(0, 160)}`)].join('\n')
      : '';
    await streamDrawTurn(res, {
      courseId: resolvedCourseId,
      conversationId: String(convId),
      prompt: content.trim(),
      userId,
      spaceId: contextSpaceId,
      triggerType: 'personal_agent_direct_image',
      context: { history: recent, memory, background, learner },
      previous: drawRoute.mode === 'edit' ? lastExchange.previous : null,
      form: drawRoute.form,
      route: drawRouteSummary(drawRoute),
    });
    return;
  }

  // 回答写多长：学生选的档位 + 问题深浅（Jev），和下面装上下文同时进行（2026-10-09 起「AI 对话」也有）
  const lengthPlanPromise = planAnswerLength(content.trim(), parseAnswerLength(answer_length));

  // Build agent context with personal-agent-specific system prompt additions
  // 检索课程资料查的是 context.courseId（取 key 的那门课）：只有学生选了课、而且就是这门课时才给，
  // 选「不关联课程」时不能去翻自动挑来取 key 的那门课的资料
  const coursePicked = Boolean(contextCourseId) && contextCourseId === resolvedCourseId;
  const tools = agentRegistry.getToolsForRole(effectiveRole).filter(
    (t) => modeToolNames.includes(t.function.name)
      && (t.function.name !== 'search_course_materials' || coursePicked),
  );
  const toolNames = tools.map((t) => t.function.name);

  const conversationHistory = [
    ...history
      .filter((m) => m.content?.trim())
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    { role: 'user' as const, content: content.trim() },
  ];

  const agentContext = await buildAgentContext({
    note: personalNote,
    history: conversationHistory,
    agentMode: normalizedAgentMode,
    userRole: effectiveRole,
    userId,
    courseId: resolvedCourseId,
    spaceId: contextSpaceId ?? 'personal',
    toolNames,
    userMessage: content.trim(),
  });

  // Inject cross-module context for teachers
  let crossModuleCtx = '';
  if ((effectiveRole === 'teacher' || effectiveRole === 'admin') && resolvedCourseId) {
    try {
      crossModuleCtx = await getTeacherContext({
        userId,
        courseId: resolvedCourseId,
        excludeSource: 'chat',
        lang: 'zh',
      });
    } catch { /* non-critical */ }
  }

  const identity = personalSystemAddition(toolNames);
  const lengthPlan = await lengthPlanPromise;
  const systemPrompt = [
    identity,
    crossModuleCtx,
    agentContext.systemPrompt,
    lengthInstruction(lengthPlan),
  ].filter(Boolean).join('\n\n');

  // ── Lifecycle: start run for chat ──
  let chatRunId: string | null = null;
  if (resolvedCourseId) {
    try {
      const chatRun = await startRun({
        userId,
        courseId: resolvedCourseId,
        agentType: 'chat',
        title: content.trim().slice(0, 80),
        input: { agent_mode: normalizedAgentMode, message_preview: content.trim().slice(0, 200) },
      });
      chatRunId = chatRun.id;
      await transitionRun(chatRunId, 'gathering');
      if (crossModuleCtx) {
        await recordEffect({ runId: chatRunId, effectType: 'memory_loaded', payload: { cross_module: true } });
      }
      await transitionRun(chatRunId, 'executing');
      await recordEffect({ runId: chatRunId, effectType: 'llm_started', payload: {
        provider: resolvedProviderId, model: resolvedModel, mode: normalizedAgentMode,
      }});
    } catch { /* lifecycle is non-critical */ }
  }

  // Set up SSE stream
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const toolContext = agentContext.toolContext;
  let fullReply = '';
  const allToolCalls: Array<{ id: string; name: string }> = [];
  const allToolsUsed = new Set<string>();
  let agentIterations = 0;
  let continuations = 0;
  let truncated = false;
  const isAutoMode = provider_id === 'auto';
  // DMX gets model-level retries within the same key (router swaps to a
  // healthy model), so even a single-provider setup survives 429 storms.
  const hasDmx = availableConfigs.some((c: any) => isDmxProvider(c.provider_id));
  const maxAttempts = isAutoMode
    ? Math.max(availableConfigs.length, hasDmx ? 3 : 1)
    : (isDmxProvider(resolvedProviderId) ? 3 : 1);

  const keepaliveTimer = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch {}
  }, 15_000);

  try {
    let streamSuccess = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const previousProviderId = resolvedProviderId;
        config = availableConfigs[Math.min(attempt, availableConfigs.length - 1)];
        resolvedProviderId = config.provider_id;
        apiKey = decryptProviderApiKey(config.api_key_encrypted);
        // 同一个 DMX key 上重试：换分档里下一个健康的模型（指定的那个刚失败过）
        resolvedModel = isDmxProvider(resolvedProviderId)
          ? (model === 'auto' && previousProviderId !== resolvedProviderId
            ? autoModelFor(config)
            : pickModel(needsToolCalling ? 'agent' : 'chat'))
          : (model === 'auto' ? autoModelFor(config) : model);
      }

      let tokensSent = false;
      let retryableError = false;

      try {
        console.log(`[personalAgent] attempt ${attempt}: provider=${resolvedProviderId}, model=${resolvedModel}, endpoint=${config.endpoint_url ?? 'default'}`);
        const stream = runAgentLoopStream({
          providerId: resolvedProviderId,
          model: resolvedModel,
          apiKey,
          endpointUrl: config.endpoint_url ?? null,
          systemPrompt,
          messages: agentContext.messages.map((m) => ({
            role: m.role,
            content: m.content,
            tool_call_id: m.tool_call_id,
            tool_calls: m.tool_calls?.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
            })),
          })),
          tools,
          executeToolFn: (name, args) => agentRegistry.executeTool(name, args, toolContext),
          // 写到上限会自动接着写（agentLoop），这里只按目标字数留足余量
          maxTokens: Math.max(PERSONAL_AGENT_MAX_TOKENS, maxTokensFor(lengthPlan.target, thinkingLikely(resolvedProviderId, resolvedModel))),
        });

        const toolStartedAt = new Map<string, number>();
    for await (const event of stream) {
          switch (event.type) {
            case 'thinking':
              res.write(`data: ${JSON.stringify({ reasoningStatus: 'thinking', reasoningChunk: event.content })}\n\n`);
              break;
            case 'tool_call':
              allToolCalls.push({ id: event.toolCall.id, name: event.toolCall.function.name });
              allToolsUsed.add(event.toolCall.function.name);
              if (chatRunId) recordEffect({ runId: chatRunId, effectType: 'tool_called', payload: { tool: event.toolCall.function.name } }).catch(() => {});
              res.write(`data: ${JSON.stringify({ toolStatus: 'running', toolName: event.toolCall.function.name })}\n\n`);
              break;
            case 'tool_result':
              if (chatRunId) recordEffect({ runId: chatRunId, effectType: 'tool_result', payload: { tool: event.toolName } }).catch(() => {});
              res.write(`data: ${JSON.stringify({ toolStatus: 'used', toolName: event.toolName, toolNames: Array.from(allToolsUsed) })}\n\n`);
              break;
            case 'token':
              tokensSent = true;
              fullReply += event.content;
              res.write(`data: ${JSON.stringify({ token: event.content })}\n\n`);
              break;
            case 'done':
              agentIterations = event.result.iterations;
              continuations = event.result.continuations ?? 0;
              truncated = event.result.truncated === true;
              break;
            case 'error': {
              const isRateish = /\b(429|5\d\d|overloaded|rate.?limit|too many)/i.test(event.error);
              if (isRateish) {
                const failKind = /429|rate.?limit|too many/i.test(event.error) ? 'rate_limit' as const : 'server' as const;
                if (isDmxProvider(resolvedProviderId)) {
                  reportModelFailure(resolvedModel, failKind);
                } else {
                  // Native key hit its concurrency cap — cool the provider so
                  // the next requests jump straight to DMX
                  reportProviderFailure(resolvedProviderId, failKind);
                }
              }
              const canRetry = !tokensSent && attempt < maxAttempts - 1 && isRateish;
              if (canRetry) {
                retryableError = true;
                break;
              }
              res.write(`data: ${JSON.stringify({ error: event.error })}\n\n`);
              break;
            }
          }
          if (retryableError) break;
        }
      } catch (streamErr: any) {
        console.error(`[personalAgent] stream error (attempt ${attempt}, provider=${resolvedProviderId}):`, streamErr.message ?? streamErr);
        const isRateish = /\b(429|5\d\d|overloaded|rate.?limit|too many)/i.test(streamErr.message ?? '');
        if (isRateish) {
          const failKind = /429|rate.?limit|too many/i.test(streamErr.message ?? '') ? 'rate_limit' as const : 'server' as const;
          if (isDmxProvider(resolvedProviderId)) {
            reportModelFailure(resolvedModel, failKind);
          } else {
            reportProviderFailure(resolvedProviderId, failKind);
          }
        }
        const canRetry = !tokensSent && attempt < maxAttempts - 1 && isRateish;
        if (canRetry) continue;
        throw streamErr;
      }

      if (retryableError) continue;
      streamSuccess = true;
      if (fullReply) {
        if (isDmxProvider(resolvedProviderId)) {
          reportModelSuccess(resolvedModel, 0);
        } else {
          reportProviderSuccess(resolvedProviderId);
        }
      }
      break;
    }

    if (!streamSuccess && fullReply === '') {
      res.write(`data: ${JSON.stringify({ error: 'All available providers failed. Please try again later.' })}\n\n`);
    }

    // Save assistant message to agent_messages
    if (fullReply) {
      if (chatRunId) {
        recordEffect({ runId: chatRunId, effectType: 'llm_completed', payload: {
          reply_length: fullReply.length, tools_used: Array.from(allToolsUsed), iterations: agentIterations,
        }}).catch(() => {});
      }

      const { data: savedMsg } = await supabase.from('agent_messages').insert({
        conversation_id: convId,
        role: 'assistant',
        content: fullReply,
        tools_used: Array.from(allToolsUsed),
        ai_metadata: {
          agent_mode: normalizedAgentMode,
          agent_loop: true,
          iterations: agentIterations,
          provider_id: resolvedProviderId,
          model: resolvedModel,
          answer_length: lengthPlanMetadata(lengthPlan, fullReply, { continuations, truncated }),
        },
      }).select('id').single();

      if (chatRunId) {
        transitionRun(chatRunId, 'applied', {
          output: { reply_preview: fullReply.slice(0, 300), tools_used: Array.from(allToolsUsed) },
        }).catch(() => {});
      }

      res.write(`data: ${JSON.stringify({
        assistantMessage: {
          id: savedMsg?.id ?? null,
          content: fullReply,
          tools_used: Array.from(allToolsUsed),
        },
      })}\n\n`);
    } else if (chatRunId) {
      failRun(chatRunId, 'No reply generated').catch(() => {});
    }

    // Update conversation timestamp
    await supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId);

    // Update learner profile (non-blocking, students only)
    if (effectiveRole === 'student' && resolvedCourseId) {
      updateProfileAfterInteraction(userId, resolvedCourseId, {
        messageLength: content.trim().length,
        usedEvidenceTools: allToolsUsed.has('web_search') || allToolsUsed.has('find_sources'),
        usedConnectionTools: allToolsUsed.has('search_notes') || allToolsUsed.has('compare_notes'),
        askedQuestion: /\?|？/.test(content),
        uniqueNoteId: contextSpaceId ?? 'personal',
        overrelianceDetected: agentContext.overrelianceDetected ?? false,
      }).catch((err) => console.error('[PersonalAgent] Profile update failed:', err));
    }

    // Log to ai_interventions
    await supabase.from('ai_interventions').insert({
      space_id: contextSpaceId,
      user_id: userId,
      trigger_type: 'personal_agent_chat',
      provider_id: resolvedProviderId,
      model_name: resolvedModel,
      input_context_summary: content.slice(0, 200),
      response_text: fullReply.slice(0, 500),
      visibility_scope: 'private',
      trigger_context: {
        agent_mode: normalizedAgentMode,
        agent_loop: true,
        agent_iterations: agentIterations,
        tools_used: Array.from(allToolsUsed),
        context_course_id: contextCourseId ?? null,
        scaffolding_level: agentContext.learnerProfile?.scaffoldingLevel ?? null,
      },
    });

    res.write(`data: ${JSON.stringify({
      done: true,
      conversationId: convId,
      agentMode: normalizedAgentMode,
      toolsUsed: Array.from(allToolsUsed),
      iterations: agentIterations,
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    clearInterval(keepaliveTimer);
    res.end();
  } catch (err: any) {
    console.error(`[personalAgent] fatal error:`, err.message ?? err);
    if (chatRunId) failRun(chatRunId, err.message ?? 'Agent stream error').catch(() => {});
    res.write(`data: ${JSON.stringify({ error: err.message ?? 'Agent stream error' })}\n\n`);
    res.write('data: [DONE]\n\n');
    clearInterval(keepaliveTimer);
    res.end();
  }
});

// ---------------------------------------------------------------------------
// GET /personal-agent/history — recent personal agent interactions
// ---------------------------------------------------------------------------

router.get('/personal-agent/history', verifyJWT, async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const { data, error } = await supabase
    .from('ai_interventions')
    .select('id, trigger_type, provider_id, model_name, input_context_summary, response_text, created_at, trigger_context')
    .eq('user_id', req.user!.id)
    .eq('trigger_type', 'personal_agent_chat')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new ApiError(500, error.message);
  res.json({ history: data ?? [] });
});

export default router;
