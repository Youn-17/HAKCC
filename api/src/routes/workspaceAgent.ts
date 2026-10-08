/**
 * Workspace Agent Routes — course-scoped AI assistant for the workspace panel.
 *
 * Unlike the per-note conversation agent (noteConversations.ts), this agent
 * operates at the workspace level: it sees ALL notes in a space and can help
 * with cross-note analysis, participation patterns, lesson planning, and
 * finding connections across the entire Knowledge Building community.
 *
 * Routes:
 *   GET  /workspace-agent/:courseId/conversations                  — list conversations (?space_id= narrows to one space)
 *   POST /workspace-agent/:courseId/conversations                  — create conversation
 *   GET  /workspace-agent/:courseId/conversations/:convId/messages  — load messages
 *   POST /workspace-agent/:courseId/stream                         — agent loop streaming
 *   GET  /workspace-agent/:courseId/configs                        — list AI provider configs
 */

import { restoreConversationMemory, type MemoryMessage } from '../services/conversationMemory';
import { CONVERSATION_HISTORY_LIMIT } from '../services/conversationHistory';
import { loadModelConversationHistory } from '../services/loadConversationHistory';
import { modelContextBudget, selectModelHistory } from '../services/modelContextBudget';
import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ensureCourseMember, ensureGroupAccess, ensureSpaceAccess, isCourseStaff, type CourseStanding } from '../services/accessControl';
import { ApiError } from '../middleware/errorHandler';
import {
  decryptProviderApiKey,
  listCourseAiConfigs,
} from '../services/aiProviderConfig';
import {
  getAgentModeToolNames,
  normalizeConversationAgentMode,
  getConversationAgentSpec,
  IMAGE_TURN_RULES,
} from '../services/noteAgentCatalog';
import { runAgentLoopStream, type AgentStreamEvent } from '../services/agentLoop';
import {
  buildAgentContext,
  stripHtml,
  updateProfileAfterInteraction,
  type AgentRole,
} from '../services/agentContext';
import { createDefaultRegistry } from '../services/agentTools';
import { isDmxProvider, orderConfigsByHealth, pickModel, pickNativeModel } from '../services/modelRouter';
import { freeCapacity } from '../services/aiGateway';
import { summarizeToolResult } from '../services/toolResultSummary';
import { resolveCourseProviderChain, callJson } from './thinkingTrainer';
import {
  applyPickerToConfigs,
  choiceModelFor,
  featureCandidateRows,
  loadCourseAiRows,
  pickerAllowlist,
  resolvePickerSelection,
  settingsFromRows,
} from '../services/aiFeatureModels';
import { buildDiscussionDigest, collectDigestNotes, type DigestScope } from '../services/discussionDigest';
import { detectDrawIntent } from '../services/drawIntent';
import { lengthInstruction, lengthPlanMetadata, maxTokensFor, parseAnswerLength, planAnswerLength, thinkingLikely } from '../services/answerLength';
import { streamDrawTurn } from '../services/drawTurn';
import { detectQuestionLanguage, languageDirective } from '../services/finalAnswer';
import { fetchSpaceBuildOnGraph, formatBuildOnSection } from '../services/buildOnContext';
import { fetchAiInteractionData, formatAiInteractionSection } from '../services/aiInteractionContext';
import { announceKbRetrieval, KB_STEP_NAME, startKbRetrieval, type KbToolStep } from '../services/kbSources';
import { attachImagesToLastUserMessage, imageAttachmentsToParts, isVisionModel, pickVisionModel } from '../services/visionMessages';

const router = Router();
// 学生问一句，答案两三百字就够；8192 让模型有时写成小论文，流式要吐一分多钟。
const WORKSPACE_MAX_TOKENS = 2048;
// 最多两轮工具再作答。压测里成功者中位 30–60s，大头是 5 轮工具循环里每一轮都要过网关排队。
const WORKSPACE_MAX_ITERATIONS = 3;
const WORKSPACE_NOTES_LIMIT = 30;

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

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60_000).unref();

// ---------------------------------------------------------------------------
// Shared registry (same tool registry as note-level agent)
// ---------------------------------------------------------------------------

const agentRegistry = createDefaultRegistry();

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * 课程成员才能用，返回课内身份。教职（创建者、课程管理员、平台管理员）不查分组、
 * 拿教师工具；平台身份是教师不算数，凭学生验证码入课的教师账号在这门课里是学生：
 * 空间按组隔离，工具按学生给。下游一律看这里返回的身份，不看 req.user.role。
 */
async function requireCourseMembership(courseId: string, req: Request) {
  if (!req.user) throw new ApiError(401, 'Authentication required');
  return ensureCourseMember(courseId, req.user);
}

// ---------------------------------------------------------------------------
// Workspace context helpers
// ---------------------------------------------------------------------------

type WorkspaceSpaceInfo = {
  id: string;
  name: string;
};

async function resolveSpace(courseId: string, spaceId?: string, visibleToStudentId?: string): Promise<WorkspaceSpaceInfo> {
  if (spaceId) {
    const { data, error } = await supabase
      .from('spaces')
      .select('id, title')
      .eq('id', spaceId)
      .eq('course_id', courseId)
      .single();
    if (error || !data) throw new ApiError(404, 'Space not found in this course');
    return { id: data.id as string, name: (data.title as string) ?? 'Knowledge Building Space' };
  }

  // Fall back to the space with the most notes
  const { data: courseSpaces } = await supabase
    .from('spaces')
    .select('id, title, group_id')
    .eq('course_id', courseId)
    .order('created_at', { ascending: true });
  let allSpaces = courseSpaces ?? [];
  // 学生只在自己进得去的空间里挑：共享空间加本组空间，口径同 GET /courses/:id/spaces
  if (visibleToStudentId && allSpaces.some(s => s.group_id)) {
    const { data: myGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', visibleToStudentId);
    const myGroupIds = new Set((myGroups ?? []).map(g => g.group_id));
    allSpaces = allSpaces.filter(s => !s.group_id || myGroupIds.has(s.group_id));
  }
  if (allSpaces.length === 0) throw new ApiError(404, 'No space found for this course');

  if (allSpaces.length === 1) {
    return { id: allSpaces[0].id as string, name: (allSpaces[0].title as string) ?? 'Knowledge Building Space' };
  }

  const spaceIds = allSpaces.map((s: any) => s.id as string);
  const { data: notes } = await supabase
    .from('notes')
    .select('space_id')
    .in('space_id', spaceIds)
    .is('deleted_at', null);

  const countMap = new Map<string, number>();
  for (const n of notes ?? []) {
    const sid = (n as any).space_id as string;
    countMap.set(sid, (countMap.get(sid) ?? 0) + 1);
  }

  let bestSpace = allSpaces[0];
  let bestCount = 0;
  for (const s of allSpaces) {
    const cnt = countMap.get(s.id as string) ?? 0;
    if (cnt > bestCount) { bestSpace = s; bestCount = cnt; }
  }
  return { id: bestSpace.id as string, name: (bestSpace.title as string) ?? 'Knowledge Building Space' };
}

/**
 * 助手会把空间里的笔记读进系统提示，所以非教职只能把它指到自己进得去的空间。
 * resolveSpace 只核对空间属于本课；绑定小组的空间只对本组开放，整群随机实验靠它
 * 隔离组间污染。不补这一道，组 A 的学生带上组 B 空间的 id——或者不带，让兜底挑中
 * 笔记最多的别组空间——助手就把那个空间的笔记读给他。
 * 课程教职能跨组，不查分组。
 */
async function resolveAccessibleSpace(
  courseId: string,
  spaceId: string | undefined,
  standing: CourseStanding,
  req: Request,
): Promise<WorkspaceSpaceInfo> {
  if (isCourseStaff(standing)) return resolveSpace(courseId, spaceId);
  const space = await resolveSpace(courseId, spaceId, req.user!.id);
  await ensureSpaceAccess(space.id, req.user!);
  return space;
}

type WorkspaceNote = {
  id: string;
  title: string;
  content: string;
  author_id: string;
  created_at: string;
};

async function fetchWorkspaceNotes(spaceId: string): Promise<WorkspaceNote[]> {
  const { data } = await supabase
    .from('notes')
    .select('id, title, content, author_id, created_at')
    .eq('space_id', spaceId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(WORKSPACE_NOTES_LIMIT);

  return (data ?? []).map((n: any) => ({
    id: n.id as string,
    title: (n.title as string) ?? 'Untitled Note',
    content: (n.content as string) ?? '',
    author_id: n.author_id as string,
    created_at: n.created_at as string,
  }));
}

async function countWorkspaceNotes(spaceId: string): Promise<number> {
  const { count } = await supabase
    .from('notes')
    .select('id', { count: 'exact', head: true })
    .eq('space_id', spaceId)
    .is('deleted_at', null);
  return count ?? 0;
}

/**
 * Build a synthetic "workspace note" that summarizes the whole space.
 * This is fed into `buildAgentContext` as the note context so the agent
 * gets an overview of all notes instead of a single note.
 */
function buildWorkspaceNote(
  space: WorkspaceSpaceInfo,
  notes: WorkspaceNote[],
  courseId: string,
) {
  const summaryLines = notes.map(
    (n) => `[${n.title}]: ${stripHtml(n.content).slice(0, 200)}`,
  );

  return {
    id: space.id,
    title: `Workspace: ${space.name}`,
    content: summaryLines.join('\n'),
    spaceId: space.id,
    courseId,
  };
}

// ---------------------------------------------------------------------------
// Workspace-specific system prompt additions
// ---------------------------------------------------------------------------

const WORKSPACE_IDENTITY = [
  'You are a Workspace Agent — a course-scoped AI assistant inside a Knowledge Building platform.',
  'Unlike the per-note agent, you can see ALL notes in the current workspace.',
  'Help users analyze participation patterns, find connections across notes, plan lessons, and understand the community knowledge landscape.',
  'The Build-on links between notes are written out below, after the note list. Use them to answer who built on whom, which ideas are built on most, and which notes nobody has built on yet. Never say you cannot see Build-on relations; if the list says there are none, say there are none.',
  'Notes are numbered in the list; to read one in full, or to see its own Build-on links, call read_note or get_note_context with its note_id.',
  'The AI feedback cards and the AI content inserted into notes (how many, how students responded, which scaffolds they chose) are also written out below from the platform\'s own records. Include them when summarising the discussion or how AI was used; never say these figures are unavailable or have to be added from the back end.',
  'You cannot create downloadable files or data charts here (generate_image draws pictures; it cannot plot real data). If asked for a Word file, a report or a chart, say so and give the content in your reply instead, with a table for any figures. Never write a download link for a file that was not made.',
  'Be concise, evidence-oriented, and grounded in the actual workspace data.',
  'When referencing notes, mention them by title so the user can find them.',
].join(' ');

// ---------------------------------------------------------------------------
// Event logging
// ---------------------------------------------------------------------------

async function logWorkspaceAgentEvent(
  req: Request,
  eventType: string,
  spaceId: string,
  metadata: Record<string, unknown>,
) {
  await supabase.from('events').insert({
    actor_id: req.user?.id,
    actor_role: req.user?.role,
    event_type: eventType,
    object_type: 'workspace_agent',
    object_id: spaceId,
    space_id: spaceId,
    metadata_json: metadata,
  });
}

// ---------------------------------------------------------------------------
// Route 1: GET /workspace-agent/:courseId/conversations — list conversations
// ---------------------------------------------------------------------------

router.get('/workspace-agent/:courseId/conversations', verifyJWT, async (req: Request, res: Response) => {
  const standing = await requireCourseMembership(String(req.params.courseId), req);
  // 一门课里有共享空间和各组的空间；面板只接着聊眼前这个空间里的。
  // 返回的只是自己的对话标题，不碰空间内容；但凡带了空间 id 就照老规矩先过空间授权，
  // 免得这条路成了探别组空间在不在的口子
  const spaceId = typeof req.query.space_id === 'string' ? req.query.space_id : '';
  if (spaceId) await resolveAccessibleSpace(String(req.params.courseId), spaceId, standing, req);

  let query = supabase
    .from('agent_conversations')
    .select('id, title, agent_mode, provider_id, model, space_id, updated_at')
    .eq('user_id', req.user!.id)
    .eq('agent_type', 'workspace')
    .eq('course_id', req.params.courseId);
  if (spaceId) query = query.eq('space_id', spaceId);
  const { data } = await query.order('updated_at', { ascending: false }).limit(30);
  res.json({ conversations: data ?? [] });
});

// ---------------------------------------------------------------------------
// Route 2: POST /workspace-agent/:courseId/conversations — create conversation
// ---------------------------------------------------------------------------

router.post('/workspace-agent/:courseId/conversations', verifyJWT, async (req: Request, res: Response) => {
  const standing = await requireCourseMembership(String(req.params.courseId), req);
  const { space_id, title } = req.body;
  const space = await resolveAccessibleSpace(String(req.params.courseId), space_id, standing, req);

  const { data, error } = await supabase
    .from('agent_conversations')
    .insert({
      agent_type: 'workspace',
      user_id: req.user!.id,
      course_id: req.params.courseId,
      space_id: space.id,
      title: title ?? 'New conversation',
      agent_mode: 'connection_scout',
    })
    .select()
    .single();
  if (error) throw new ApiError(500, error.message);

  const aiConfigs = await listCourseAiConfigs(String(req.params.courseId));
  res.json({ conversation: data, aiConfigs });
});

// ---------------------------------------------------------------------------
// Route 3: GET /workspace-agent/:courseId/conversations/:convId/messages
// ---------------------------------------------------------------------------

router.get('/workspace-agent/:courseId/conversations/:convId/messages', verifyJWT, async (req: Request, res: Response) => {
  await requireCourseMembership(String(req.params.courseId), req);
  const { data: conv } = await supabase
    .from('agent_conversations')
    .select('id')
    .eq('id', req.params.convId)
    .eq('user_id', req.user!.id)
    .eq('agent_type', 'workspace')
    .eq('course_id', req.params.courseId)
    .single();
  if (!conv) throw new ApiError(404, 'Conversation not found');

  // 最近的 100 条，翻回正序：长对话要显示的是结尾，不是开头
  const { data } = await supabase
    .from('agent_messages')
    .select('id, role, content, tools_used, ai_metadata, created_at')
    .eq('conversation_id', req.params.convId)
    .order('created_at', { ascending: false })
    .limit(100);
  res.json({ messages: [...(data ?? [])].reverse() });
});

// ---------------------------------------------------------------------------
// Route 4: POST /workspace-agent/:courseId/stream
// ---------------------------------------------------------------------------

/**
 * 附件正文只拼进这一轮的模型输入，不写进消息记录。
 * 拼进 content 存下来的话，一份四万字的 PDF 会在对话里整篇铺开，
 * 而且被当成学生写的字进了库。
 */
function attachmentContextNote(
  list: Array<{ file_name: string; mime_type?: string; text?: string }>,
): string {
  const docs = list.filter(a => !a.mime_type?.startsWith('image/'));
  if (docs.length === 0) return '';
  return docs.map(a => (a.text?.trim()
    ? `\n\n[附件 ${a.file_name} 的内容]\n${a.text}`
    : `\n\n[学生附上了文件 ${a.file_name}，但它的文字内容抽不出来。你只知道文件名，需要时请直接说明，不要猜测内容。]`))
    .join('');
}

/**
 * 接到发给模型的最后一条提问后面。buildAgentContext 的 userMessage 只拿去判断过度依赖，
 * 发给模型的消息来自 history：以前附件正文只交给了 userMessage，模型从来没读到过。
 */
function withAttachmentNote<T extends { role: string; content: string }>(messages: T[], note: string): T[] {
  const lastUser = messages.map(m => m.role).lastIndexOf('user');
  if (!note || lastUser < 0) return messages;
  const next = [...messages];
  next[lastUser] = { ...next[lastUser], content: next[lastUser].content + note };
  return next;
}

router.post('/workspace-agent/:courseId/stream', verifyJWT, async (req: Request, res: Response) => {
  const { courseId } = req.params;
  if (!courseId) throw new ApiError(400, 'courseId is required');
  const standing = await requireCourseMembership(String(courseId), req);
  const turnStartedAt = Date.now();

  const {
    content, provider_id: requestedProviderId, model: requestedModel, space_id,
    history: clientHistory, conversation_id,
    note_ids, attachments = [], answer_length, force_draw,
  } = req.body as {
    content?: string;
    provider_id?: string;
    model?: string;
    space_id?: string;
    history?: Array<{ role: string; content: string }>;
    conversation_id?: string;
    /** 学生勾选的笔记。给了就只带这些，且带更全的正文——他是特意选的。 */
    note_ids?: string[];
    attachments?: Array<{ file_url: string; file_name: string; mime_type?: string; text?: string }>;
    /** 简短 / 适中 / 详细（2026-10-05 起） */
    answer_length?: unknown;
    /** 输入框下面的「画图」按钮：不管怎么措辞都直接出图 */
    force_draw?: boolean;
  };

  if (!content?.trim()) throw new ApiError(400, 'content is required');
  if (!requestedProviderId || !requestedModel) throw new ApiError(400, 'provider_id and model are required');
  if (!checkRateLimit(req.user!.id)) throw new ApiError(429, 'Too many requests. Please wait a moment.');

  // 侧栏里选「默认」时传 'auto'：用课程 AI 设置里「知识空间 AI 助手」这一行；
  // 模型没指定就留 'auto'，下面 resolveModelFor 照原规则挑。手选的照旧。
  // 教师限定了这个入口的菜单时，只认名单里的：「默认」和名单外的选择（页面没刷新、手改请求）都落到名单里的默认模型。
  let provider_id = requestedProviderId;
  let model = requestedModel;
  const aiRows = await loadCourseAiRows(String(courseId)).catch((err: Error) => { throw new ApiError(500, err.message); });
  if (pickerAllowlist(settingsFromRows(aiRows), 'workspace_agent')) {
    const picked = resolvePickerSelection('workspace_agent', aiRows, { providerId: requestedProviderId, model: requestedModel });
    if (!picked) throw new ApiError(404, 'No AI provider configured for this course');
    provider_id = picked.providerId;
    model = picked.model;
  } else if (provider_id === 'auto') {
    const { rows: candidates, choice } = featureCandidateRows('workspace_agent', aiRows);
    const first = candidates[0];
    if (!first) throw new ApiError(404, 'No AI provider configured for this course');
    provider_id = first.provider_id;
    model = choiceModelFor(choice, first.provider_id) ?? 'auto';
  }

  // 知识空间助手只有一种身份，不再分「智能体模式」——
  // 那套模式是给单条笔记设计的（澄清这一条、找这一条的缺口），
  // 放到「面对整个空间」的场景里既选不明白也用不上。
  const normalizedAgentMode = normalizeConversationAgentMode('connection_scout');

  // Resolve space and fetch workspace notes
  const space = await resolveAccessibleSpace(String(courseId), space_id, standing, req);

  // Resolve or create conversation for persistence
  // 接着聊的对话要是自己的、这门课的、知识空间助手的，和读消息那条路由同一个口径。
  // 原来只看是不是自己的：拿别门课的、或学生首页 AI 对话的对话 id 来问，这一轮会写进那段对话、
  // 把那段的历史读进来，对话记录跨课程、跨助手混在一起（10-07 修）。对不上就新开一段
  let convId = conversation_id;
  if (convId) {
    const { data: existingConv } = await supabase
      .from('agent_conversations')
      .select('id')
      .eq('id', convId)
      .eq('user_id', req.user!.id)
      .eq('agent_type', 'workspace')
      .eq('course_id', courseId)
      .maybeSingle();
    if (!existingConv) convId = undefined;
  }
  if (!convId) {
    const { data: newConv, error: convError } = await supabase
      .from('agent_conversations')
      .insert({
        agent_type: 'workspace',
        user_id: req.user!.id,
        course_id: courseId,
        space_id: space.id,
        title: content.trim().slice(0, 80) || 'New conversation',
        agent_mode: normalizedAgentMode,
        provider_id,
        model,
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

  // 「画一张……」这类绘图指令，或学生按了「画图」：不经对话模型，直接出图（DMX 优先），前端放绘图动画
  const drawIntent = attachments.length === 0
    ? (force_draw ? { prompt: content.trim() } : detectDrawIntent(content))
    : null;
  if (drawIntent) {
    await streamDrawTurn(res, {
      courseId: String(courseId),
      conversationId: String(convId),
      prompt: drawIntent.prompt,
      userId: req.user!.id,
      spaceId: space.id,
      triggerType: 'workspace_agent_direct_image',
    });
    return;
  }

  // 回答写多长：学生选的档位 + 问题深浅（Jev），和下面读笔记、关系同时进行
  const lengthPlanPromise = planAnswerLength(content.trim(), parseAnswerLength(answer_length));

  // 笔记、关系、总数互不依赖，一起发出去：库在首尔，每多一趟串行就多 100ms 以上
  const [allNotes, totalNotes] = await Promise.all([
    fetchWorkspaceNotes(space.id),
    countWorkspaceNotes(space.id),
  ]);
  // 勾了就只带勾的那几条。没勾等于「整个空间」，保持原样。
  const picked = Array.isArray(note_ids) && note_ids.length > 0
    ? allNotes.filter(n => note_ids.includes(n.id))
    : allNotes;
  const workspaceNotes = picked.length > 0 ? picked : allNotes;
  const isNarrowed = picked.length > 0 && picked.length < allNotes.length;

  // Fetch the API key
  const { data: config, error: configError } = await supabase
    .from('teacher_ai_configs')
    .select('api_key_encrypted, endpoint_url, is_verified, enabled_models')
    .eq('course_id', String(courseId))
    .eq('provider_id', provider_id)
    .single();
  if (configError || !config || !config.api_key_encrypted) {
    throw new ApiError(404, `Provider "${provider_id}" is not configured for this course`);
  }
  const apiKey = decryptProviderApiKey(config.api_key_encrypted);

  const memoryModel = model === 'auto'
    ? (isDmxProvider(provider_id) ? pickModel('fast') : (pickNativeModel(provider_id, Array.isArray(config.enabled_models) ? config.enabled_models : null) ?? model))
    : model;
  const contextBudget = modelContextBudget(provider_id, memoryModel);
  // Build conversation history — prefer server-side messages when conversation exists
  let history: MemoryMessage[];
  if (conversation_id && convId === conversation_id) {
    history = await loadModelConversationHistory('workspace', String(convId), contextBudget);
  } else {
    history = [
      ...(clientHistory ?? [])
        .filter((m) => m.content?.trim())
        .slice(-CONVERSATION_HISTORY_LIMIT)
        .map((m) => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: m.content,
        })),
      { role: 'user' as const, content: content.trim() },
    ];
  }

  // The current request must remain the final question even if the saved window is stale.
  if (history.at(-1)?.role !== 'user' || history.at(-1)?.content !== content.trim()) {
    history.push({ role: 'user', content: content.trim() });
  }
  const rawHistory = history;
  const restoredMemory = await restoreConversationMemory({ kind: 'workspace', id: String(convId), history, budget: contextBudget,
    model: { providerId: provider_id, model: memoryModel, apiKey, endpointUrl: config.endpoint_url } });
  history = restoredMemory.messages;

  // 课程资料：和下面装上下文、读 Build-on 同时检索（kbSources.ts）。按提问的人检索，别组空间里的附件进不来。
  // history 最后一条就是这一问
  const zhQuestion = detectQuestionLanguage(content) === 'zh';
  const kbRun = startKbRetrieval({
    courseId: String(courseId),
    viewer: req.user!,
    question: content.trim(),
    earlierQuestions: history.filter(m => m.role === 'user').map(m => m.content).slice(0, -1),
    contextTitle: null,
    zh: zhQuestion,
    source: 'workspace_ai',
  });

  // 工具按课内身份给：教师工具能读全班的数据，凭学生验证码入课的教师账号在这门课里是学生
  const userRole: AgentRole = !isCourseStaff(standing)
    ? 'student'
    : req.user!.role === 'admin' ? 'admin' : 'teacher';

  const modeToolNames = getAgentModeToolNames(normalizedAgentMode);
  const tools = agentRegistry.getToolsForRole(userRole).filter(
    (t) => modeToolNames.includes(t.function.name),
  );
  const toolNames = tools.map((t) => t.function.name);

  // Build the workspace "note" context (a summary of all notes)
  const workspaceNote = buildWorkspaceNote(space, workspaceNotes, String(courseId));
  const attachmentNote = attachmentContextNote(attachments);

  const agentContext = await buildAgentContext({
    note: workspaceNote,
    history,
    contextBudget,
    agentMode: normalizedAgentMode,
    userRole,
    userId: req.user!.id,
    courseId: String(courseId),
    spaceId: space.id,
    toolNames,
    userMessage: content.trim() + attachmentNote,
  });

  // Enhance the system prompt with workspace-specific identity and note listing
  // 学生勾了具体几条，就把正文给足（1200 字）——他是特意选的，
  // 还只喂 150 字的摘要等于让模型隔着毛玻璃看。没勾时仍按摘要列全部。
  const perNote = isNarrowed ? 1200 : 150;
  const noteListSection = workspaceNotes.length > 0
    ? [
      isNarrowed
        ? `The learner selected ${workspaceNotes.length} note(s) to focus on. Answer with these as the primary context:`
        : totalNotes > workspaceNotes.length
          ? `This workspace contains ${totalNotes} notes. The ${workspaceNotes.length} most recently updated are listed here; use search_notes to look further back:`
          : `This workspace contains ${workspaceNotes.length} note(s). Here is a summary:`,
      ...workspaceNotes.map(
        (n, i) => `${i + 1}. "${n.title}" (id: ${n.id}) — ${stripHtml(n.content).slice(0, perNote)}`,
      ),
    ].join('\n')
    : 'This workspace has no notes yet.';

  // 笔记之间谁 Build-on 谁：提示词里原先只有标题和摘要，助手于是「看不到」关系。
  // 查不出来（库慢、出错）就不写这一段，照常回答，别因此整轮失败。
  const buildOnPromise = workspaceNotes.length > 0
    ? fetchSpaceBuildOnGraph(space.id, new Map(allNotes.map(n => [n.id, n.title])))
      .then(graph => formatBuildOnSection({
        listed: workspaceNotes.map(n => ({ id: n.id, title: n.title })),
        links: graph.links,
        titles: graph.titles,
        focusIds: isNarrowed ? new Set(workspaceNotes.map(n => n.id)) : undefined,
        totalNotes: isNarrowed ? undefined : totalNotes,
      }))
      .catch((err: Error) => { console.error('[workspace-agent] build-on context failed:', err.message); return ''; })
    : Promise.resolve('');
  // AI 反馈和 AI 内容插入的记录（2026-10-06）：以前助手总结时只能说「后台埋点，工具未返回」。
  // 教职看全部、按人分；其他人看自己的和画布上本来就公开的。查不出来同样不写这一段
  const viewerIsStaff = isCourseStaff(standing);
  const aiInteractionPromise = fetchAiInteractionData(space.id, {
    noteIds: isNarrowed ? workspaceNotes.map(n => n.id) : null,
    withNames: viewerIsStaff,
  })
    .then(data => formatAiInteractionSection(data, {
      viewerId: req.user!.id,
      isStaff: viewerIsStaff,
      selectedCount: isNarrowed ? workspaceNotes.length : undefined,
    }))
    .catch((err: Error) => { console.error('[workspace-agent] AI interaction context failed:', err.message); return ''; });
  const [buildOnSection, aiInteractionSection] = await Promise.all([buildOnPromise, aiInteractionPromise]);

  // 按提问语言写死回复语言。不写死的话，模型会先用英文推理一轮 ——
  // 而推理过程在界面上是显示出来的（「深度思考中…」），中文课堂里
  // 学生看到一整段英文思考，观感和可读性都差。取最后一条学生消息判断。
  const lastUserText = [...agentContext.messages].reverse()
    .find(m => m.role === 'user')?.content ?? content ?? '';
  const langRule = languageDirective(
    detectQuestionLanguage(typeof lastUserText === 'string' ? lastUserText : ''),
  );

  const lengthPlan = await lengthPlanPromise;
  // 课程资料那一段等推流开始、过程里显示了「检索课程资料」之后再拼进来
  const promptBeforeMaterials = [
    WORKSPACE_IDENTITY,
    langRule,
    agentContext.systemPrompt,
    noteListSection,
    buildOnSection,
    aiInteractionSection,
  ];

  // Set up SSE headers
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
  // 每一步的结果和用时，存进回答里：回看历史时也能看到「用了几步」
  const toolSteps: KbToolStep[] = [];

  const keepaliveTimer = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch {}
  }, 15_000);

  // DMX 'auto' 在这里走 fast 梯队，不走 agent 梯队：课堂里几十人同时问，
  // gpt-5.5 / claude-opus 这类思考型模型带着工具循环一轮常常超过 90s 网关超时，
  // 原厂 key 仍选它最新的模型（deepseek-v4-pro / glm-5.2）。
  const resolveModelFor = (pid: string, requested: string, enabled: unknown): string =>
    requested === 'auto'
      ? (isDmxProvider(pid)
        ? pickModel('fast')
        : (pickNativeModel(pid, Array.isArray(enabled) ? enabled as string[] : null) ?? requested))
      : requested;
  const resolvedModel = resolveModelFor(provider_id, model, (config as any).enabled_models);

  // 候选链：学生选的厂商在前，课程里其余配了 key 的厂商按「网关还有几路空闲」排队跟在后面。
  // 一个班几十人同时问，都落在同一家（前端默认第一家）就撞那家的并发上限排队直到超时，
  // 而别家的额度整节课都空着 —— 压测里 52 人同选智谱只有 13% 成功，分到五家可到 ~90%。
  // 只在**一个字都没吐出来**之前切换：已经开始回答就不换，避免回答前后不是一个模型。
  type Candidate = { providerId: string; model: string; apiKey: string; endpointUrl: string | null; enabledModels: string[] };
  const candidates: Candidate[] = [{
    providerId: provider_id, model: resolvedModel, apiKey, endpointUrl: config.endpoint_url ?? null,
    enabledModels: Array.isArray(config.enabled_models) ? config.enabled_models as string[] : [],
  }];
  {
    const { data: others } = await supabase
      .from('teacher_ai_configs')
      .select('provider_id, api_key_encrypted, endpoint_url, enabled_models')
      .eq('course_id', String(courseId))
      .neq('provider_id', provider_id)
      .not('api_key_encrypted', 'is', null);
    const usable = (others ?? []).filter(r => r.provider_id !== 'tavily' && r.api_key_encrypted);
    // 是最慢的一条路，只配当溢出车道（与 modelRouter 的原厂优先策略一致）。
    const ordered = orderConfigsByHealth(usable).sort((a, b) => {
      const da = isDmxProvider(a.provider_id as string) ? 1 : 0;
      const db = isDmxProvider(b.provider_id as string) ? 1 : 0;
      if (da !== db) return da - db;
      return freeCapacity(b.provider_id as string) - freeCapacity(a.provider_id as string);
    });
    for (const r of ordered.slice(0, 2)) {
      const pid = r.provider_id as string;
      const enabled = Array.isArray(r.enabled_models) ? r.enabled_models as string[] : [];
      const alt = isDmxProvider(pid)
        ? pickModel('fast')
        : (pickNativeModel(pid, enabled) ?? enabled[0]);
      if (!alt) continue;
      candidates.push({ providerId: pid, model: alt, apiKey: decryptProviderApiKey(r.api_key_encrypted as string), endpointUrl: (r.endpoint_url as string) ?? null, enabledModels: enabled });
    }
  }

  // 分流：学生选的那家此刻已经没有空闲路数，而后面有自有厂商还空着，就直接从空着的起步。
  // 否则要先在首选那里排 25s 队超时才切，一节课几十人同时问全都白等这 25s。
  // DMX 不参与分流（它只做溢出），首选本身是 DMX 时也照常排队。
  if (freeCapacity(provider_id) <= 0) {
    const idle = candidates.findIndex((c, i) => i > 0 && !isDmxProvider(c.providerId) && freeCapacity(c.providerId) > 0);
    if (idle > 0) {
      const [free] = candidates.splice(idle, 1);
      candidates.unshift(free);
      console.info(`[workspace-agent] ${provider_id} saturated, starting on ${free.providerId}/${free.model}`);
    }
  }

  // 这一轮带了图：每家换成它看得懂图的型号，看得见图的排前面（同 support.ts）。
  // 纯文本模型会把图片块直接忽略，学生以为 AI 看见了，其实没有。
  const carriesImage = imageAttachmentsToParts(attachments).length > 0;
  if (carriesImage) {
    const before = candidates[0];
    const seeing = candidates
      .map(c => ({ ...c, model: pickVisionModel(c.providerId, c.model, c.enabledModels) ?? c.model }))
      .sort((a, b) => Number(isVisionModel(b.providerId, b.model)) - Number(isVisionModel(a.providerId, a.model)));
    candidates.splice(0, candidates.length, ...seeing);
    if (candidates[0].providerId !== before.providerId || candidates[0].model !== before.model) {
      res.write(`data: ${JSON.stringify({ modelSwitched: candidates[0].model, providerId: candidates[0].providerId, reason: 'vision' })}\n\n`);
    }
  }

  let usedProvider = provider_id;
  let usedModel = resolvedModel;

  try {
    const kb = await announceKbRetrieval(
      event => res.write(`data: ${JSON.stringify(event)}\n\n`), kbRun, toolSteps, allToolsUsed, zhQuestion,
    );
    let sentSources = kb?.citations.sources.length ?? 0;
    const workspaceSystemPrompt = [
      ...promptBeforeMaterials,
      kb?.section ?? '',
      carriesImage ? IMAGE_TURN_RULES : '',
      lengthInstruction(lengthPlan),
    ].filter(Boolean).join('\n\n');
    // 助手这一轮再查课程资料：查到的段落接着自动检索的编号往下编，来源卡片一起列
    const turnToolContext = kb ? { ...toolContext, kbCitations: kb.citations } : toolContext;

    const baseMessages = agentContext.messages.map((m) => ({
      role: m.role,
      content: m.content,
      tool_call_id: m.tool_call_id,
      tool_calls: m.tool_calls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
      })),
    }));
    // Fit each fallback model before attaching this turn’s documents/images.

    for (let ci = 0; ci < candidates.length; ci++) {
      const cand = candidates[ci];
      usedProvider = cand.providerId;
      usedModel = cand.model;
      let emitted = false;
      let failedBeforeOutput: string | null = null;

      const candidateBudget = modelContextBudget(cand.providerId, cand.model);
      const candidateHistory = candidateBudget.historyBytes < contextBudget.historyBytes
        ? (await restoreConversationMemory({ kind: 'workspace', id: String(convId), history: rawHistory, budget: candidateBudget,
          model: { providerId: cand.providerId, model: cand.model, apiKey: cand.apiKey, endpointUrl: cand.endpointUrl } })).messages
        : baseMessages;
      const candidateMessages = selectModelHistory<(typeof baseMessages)[number] | { role: 'user' | 'assistant'; content: string }>(candidateHistory, candidateBudget);
      const loopMessages = attachImagesToLastUserMessage(withAttachmentNote(candidateMessages, attachmentNote), attachments);
      const stream = runAgentLoopStream({
        providerId: cand.providerId,
        model: cand.model,
        apiKey: cand.apiKey,
        endpointUrl: cand.endpointUrl,
        systemPrompt: workspaceSystemPrompt,
        messages: loopMessages,
        tools,
        executeToolFn: (name, args) => agentRegistry.executeTool(name, args, turnToolContext),
        // 按目标字数留足余量；会先思考的模型（DeepSeek）思考也算在里面，再多留
        maxTokens: Math.max(WORKSPACE_MAX_TOKENS, maxTokensFor(lengthPlan.target, thinkingLikely(cand.providerId, cand.model))),
        maxIterations: WORKSPACE_MAX_ITERATIONS,
      });

      const toolStartedAt = new Map<string, number>();
      try {
        for await (const event of stream) {
          switch (event.type) {
            case 'thinking':
              res.write(`data: ${JSON.stringify({ reasoningStatus: 'thinking', reasoningChunk: event.content })}\n\n`);
              break;
            case 'tool_call':
              emitted = true;
              allToolCalls.push({ id: event.toolCall.id, name: event.toolCall.function.name });
              allToolsUsed.add(event.toolCall.function.name);
              toolStartedAt.set(event.toolCall.function.name, Date.now());
              res.write(`data: ${JSON.stringify({ toolStatus: 'running', toolName: event.toolCall.function.name })}\n\n`);
              break;
            case 'tool_result': {
              const startedAt = toolStartedAt.get(event.toolName);
              const ms = startedAt ? Date.now() - startedAt : undefined;
              // 只推统计性摘要（几条、成没成），不复述内容 —— 内容归模型自己在回答里说
              const summary = summarizeToolResult(event.toolName, event.result, 'zh');
              toolSteps.push({ name: event.toolName, summary, ...(ms != null ? { ms } : {}) });
              res.write(`data: ${JSON.stringify({
                toolStatus: 'used',
                toolName: event.toolName,
                toolNames: Array.from(allToolsUsed),
                toolSummary: summary,
                toolDurationMs: ms,
              })}\n\n`);
              // 又查到新的课程资料：来源卡片整份重发
              if (event.toolName === KB_STEP_NAME && kb && kb.citations.sources.length > sentSources) {
                sentSources = kb.citations.sources.length;
                res.write(`data: ${JSON.stringify({ kbSources: kb.citations.sources })}\n\n`);
              }
              break;
            }
            case 'token':
              emitted = true;
              fullReply += event.content;
              res.write(`data: ${JSON.stringify({ token: event.content })}\n\n`);
              break;
            case 'done':
              agentIterations = event.result.iterations;
              continuations = event.result.continuations ?? 0;
              truncated = event.result.truncated === true;
              break;
            case 'error':
              if (!emitted && ci < candidates.length - 1) {
                failedBeforeOutput = event.error;
              } else {
                res.write(`data: ${JSON.stringify({ error: event.error })}\n\n`);
              }
              break;
          }
          if (failedBeforeOutput) break;
        }
      } catch (err) {
        if (emitted || ci === candidates.length - 1) throw err;
        failedBeforeOutput = err instanceof Error ? err.message : String(err);
      }

      if (!failedBeforeOutput) break;
      const next = candidates[ci + 1];
      console.warn(`[workspace-agent] ${cand.providerId}/${cand.model} failed before output (${failedBeforeOutput.slice(0, 120)}), switching to ${next.providerId}/${next.model}`);
      res.write(`data: ${JSON.stringify({ providerSwitch: { from: cand.providerId, to: next.providerId, model: next.model } })}\n\n`);
    }

    // Save assistant message to agent_messages
    await supabase.from('agent_messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: fullReply,
      tools_used: Array.from(allToolsUsed),
      ai_metadata: {
        agent_mode: normalizedAgentMode,
        agent_loop: true,
        iterations: agentIterations,
        answer_length: lengthPlanMetadata(lengthPlan, fullReply, { continuations, truncated }),
        tool_steps: toolSteps,
        // 来源卡片：回答里的 [n] 对应哪份资料、哪一节、第几页
        kb_sources: kb?.citations.sources.length ? kb.citations.sources : undefined,
        elapsed_ms: Date.now() - turnStartedAt,
        provider_id: usedProvider,
        model: usedModel,
        requested_provider_id: provider_id,
      },
    });

    // Update conversation timestamp
    await supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId);

    // Log to ai_interventions for analytics
    await supabase.from('ai_interventions').insert({
      space_id: space.id,
      note_id: null,
      user_id: req.user!.id,
      trigger_type: 'workspace_agent_chat',
      provider_id,
      model_name: model,
      input_context_summary: content.slice(0, 200),
      response_text: fullReply.slice(0, 500),
      visibility_scope: 'private',
    });

    // Update learner profile with interaction metrics (non-blocking)
    if (userRole === 'student') {
      updateProfileAfterInteraction(req.user!.id, String(courseId), {
        messageLength: content.trim().length,
        usedEvidenceTools: allToolsUsed.has('web_search') || allToolsUsed.has('find_sources'),
        usedConnectionTools: allToolsUsed.has('search_notes') || allToolsUsed.has('compare_notes'),
        askedQuestion: /\?|？/.test(content),
        uniqueNoteId: space.id,
        overrelianceDetected: agentContext.overrelianceDetected ?? false,
      }).catch((err) => console.error('[WorkspaceAgent] Profile update failed:', err));
    }

    await logWorkspaceAgentEvent(req, 'workspace_agent_message', space.id, {
      course_id: courseId,
      provider_id,
      model,
      agent_mode: normalizedAgentMode,
      agent_iterations: agentIterations,
      tools_used: Array.from(allToolsUsed),
      workspace_notes_count: workspaceNotes.length,
      scaffolding_level: agentContext.learnerProfile?.scaffoldingLevel ?? null,
    });

    // Send completion event
    res.write(`data: ${JSON.stringify({
      done: true,
      conversationId: convId,
      toolsUsed: Array.from(allToolsUsed),
      iterations: agentIterations,
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    clearInterval(keepaliveTimer);
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message ?? 'Workspace agent stream error' })}\n\n`);
    res.write('data: [DONE]\n\n');
    clearInterval(keepaliveTimer);
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Route 5: GET /workspace-agent/:courseId/configs
// ---------------------------------------------------------------------------

router.get('/workspace-agent/:courseId/configs', verifyJWT, async (req: Request, res: Response) => {
  const { courseId } = req.params;
  if (!courseId) throw new ApiError(400, 'courseId is required');
  await requireCourseMembership(String(courseId), req);

  // 菜单按课程 AI 设置里「知识空间助手」的名单画：限定了就只给名单里的模型
  const [aiConfigs, aiRows] = await Promise.all([
    listCourseAiConfigs(String(courseId)),
    loadCourseAiRows(String(courseId)).catch(() => []),
  ]);
  res.json({ aiConfigs: applyPickerToConfigs('workspace_agent', aiRows, aiConfigs) });
});


/**
 * POST /api/workspace-agent/:courseId/digest —— 讨论速览
 *
 * 学生选一个范围（当前 View / 本组讨论 / 画布上选中的几条），拿回一份
 * 「这里都有什么」的清单。做定位，不做综合 —— 详见 services/discussionDigest.ts
 * 开头那段边界说明，改这里之前先读它。
 */
router.post('/workspace-agent/:courseId/digest', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseMember(courseId, req.user!);

  const scope = String(req.body?.scope ?? 'view') as DigestScope;
  if (!['view', 'group', 'selection'].includes(scope)) {
    throw new ApiError(400, 'scope must be view, group or selection');
  }
  const spaceId = req.body?.space_id ? String(req.body.space_id) : null;
  const viewId = req.body?.view_id ? String(req.body.view_id) : null;
  const noteIds: string[] = Array.isArray(req.body?.note_ids)
    ? req.body.note_ids.map(String).slice(0, 60) : [];
  const groupId = req.body?.group_id ? String(req.body.group_id) : null;

  // space_id is required, not optional: scope 'selection' used to skip this
  // check entirely, and the note_ids below are then read with no space filter —
  // which turned the digest into a reader for any note on the platform.
  if (!spaceId) throw new ApiError(400, 'space_id is required');
  await ensureSpaceAccess(spaceId, req.user!);

  if (noteIds.length > 0) {
    const { data: ownedNotes } = await supabase
      .from('notes').select('id').in('id', noteIds).eq('space_id', spaceId).is('deleted_at', null);
    if ((ownedNotes?.length ?? 0) !== noteIds.length) {
      throw new ApiError(403, '只能速览本空间内的笔记');
    }
  }

  let groupNotes: any[] | undefined;
  let scopeLabel = '当前 View';
  if (scope === 'group') {
    if (!groupId) throw new ApiError(400, 'group_id required for group scope');
    // 「本组讨论」会读组空间里的笔记，而组空间只对本组开放；上面核对的 space_id
    // 管不到 group_id。只给本组成员和课程教职，组也得是这门课的。
    const group = await ensureGroupAccess(groupId, req.user!);
    if (group.course_id !== courseId) throw new ApiError(404, 'Group not found');
    // 复用观点图谱的范围口径，两个功能看到的是同一批笔记
    const { collectGroupNotesForDigest } = await import('../services/groupIdeaGraph');
    groupNotes = await collectGroupNotesForDigest(groupId, courseId);
    scopeLabel = '本组讨论';
  } else if (scope === 'selection') {
    scopeLabel = `选中的 ${noteIds.length} 条笔记`;
  }

  const notes = await collectDigestNotes({ scope, spaceId, viewId, noteIds, groupNotes });
  if (notes.length === 0) throw new ApiError(404, 'No notes in this scope');

  // 只用这门课的 key，课程 AI 设置里「讨论速览」选的模型排第一（以前按用户取，会用到他别的课的 key）
  const chain = await resolveCourseProviderChain(courseId, 'discussion_digest');
  const cfg = chain[0] ?? null;
  if (!cfg) console.warn('[digest] 没解析到可用的 AI 配置 user=%s course=%s', req.user!.id, courseId);
  const digest = await buildDiscussionDigest({
    scope, scopeLabel, notes,
    callModel: async (system, user) => {
      if (!cfg) return null;
      // 2400 而不是 1800：这个 JSON 有三段数组，模型稍微多写两句就会在 1800
      // 截断，而截断后 lastIndexOf('}') 找到的是内层括号，JSON.parse 直接抛，
      // 表现成「AI 没返回结果」而日志里什么都没有。
      const out = await callJson(cfg, system, user, 2400, 'chat', chain.slice(1));
      if (!out) console.warn('[digest] 整条候选链都没返回可解析 JSON（试过 %d 家）输入长度=%d', chain.length, user.length);
      return out;
    },
  });
  res.json({ digest });
});

export default router;
