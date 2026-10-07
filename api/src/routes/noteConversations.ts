import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { announceKbRetrieval, KB_STEP_NAME, startNoteKbRetrieval, type KbToolStep } from '../services/kbSources';
import {
  buildConversationToolDefinitions,
  clampToolLimit,
  rankSpaceNotesForTool,
  safeJsonParseToolArgs,
  shouldPrepareConversationTools,
  summarizeForTool,
} from './noteConversationTools';
import {
  callTavilySearch,
  formatTavilyResultsForPrompt,
  type TavilySearchResult,
} from '../services/tavilySearch';
import { assertSafePublicUrl } from '../services/urlGuard';
import { ensureSpaceAccess, isCourseStaff } from '../services/accessControl';
import {
  decryptProviderApiKey,
  listCourseAiConfigs,
  normalizeDeepSeekModel,
  usesDeepSeekModelAliases,
  withDeepSeekOptions,
  withFastChatOptions,
} from '../services/aiProviderConfig';
import {
  getConversationAgentSpec,
  getAgentModeToolNames,
  normalizeConversationAgentMode,
  shouldPrepareToolsForAgentMode,
  shouldUseWebEvidenceForAgentMode,
  type ConversationAgentMode,
} from '../services/noteAgentCatalog';
import { CONTINUE_PROMPT, MAX_CONTINUATIONS, runAgentLoopStream, type AgentStreamEvent } from '../services/agentLoop';
import { lengthInstruction, lengthPlanMetadata, parseAnswerLength, planAnswerLength, thinkingLikely } from '../services/answerLength';
import { summarizeToolResult } from '../services/toolResultSummary';
import { detectQuestionLanguage } from '../services/finalAnswer';
import { buildAgentContext, updateProfileAfterInteraction } from '../services/agentContext';
import { createDefaultRegistry } from '../services/agentTools';
import { embedNote } from '../services/embeddingService';
import { aiFetch } from '../services/aiGateway';
import { CHAT_ENDPOINTS, MODELS_ENDPOINTS } from '../services/providerEndpoints';
import { attachImagesToLastUserMessage, pickVisionModel } from '../services/visionMessages';
import { IMAGE_TURN_RULES, isFreeAskMode, buildFreeAskSystemPrompt } from '../services/noteAgentCatalog';
import { generateNoteImage } from '../services/noteImage';
import { hasProviderKey, loadCourseAiRows, resolvePartnerSelection } from '../services/aiFeatureModels';

const router = Router();
const NOTE_CONVERSATION_MAX_TOKENS = 4096;

const VALID_TARGETS = ['group', 'member', 'ai'] as const;
type TargetType = typeof VALID_TARGETS[number];

type Attachment = {
  file_url: string;
  file_name: string;
  mime_type?: string;
  file_size?: number;
  /**
   * 服务端从 PDF / Word / 纯文本里抽出的正文。
   * **只喂给模型，绝不入库**：以前它被拼进 content 存了下来，
   * 于是一份四万字的 PDF 在对话里整篇铺开，研究导出的 messages 里
   * content_text 和 word_count 也把它算成了学生写的字。
   */
  text?: string;
};

/** 落库前剥掉附件正文，库里只留文件本身的信息。 */
function stripAttachmentText(list: Attachment[]): Attachment[] {
  return list.map(({ text: _text, ...rest }) => rest);
}

/**
 * 把附件正文接到最后一条学生消息后面，只用于这一轮的模型输入。
 * 读不出正文的类型如实说明，免得模型（和学生）以为它看过了内容。
 */
function appendAttachmentContext<T extends { role: string; content?: string | null }>(
  history: T[],
  list: Attachment[],
): T[] {
  const docs = list.filter(a => !a.mime_type?.startsWith('image/'));
  if (docs.length === 0) return history;
  const note = docs.map(a => (a.text?.trim()
    ? `\n\n[附件 ${a.file_name} 的内容]\n${a.text}`
    : `\n\n[学生附上了文件 ${a.file_name}，但它的文字内容抽不出来（可能是扫描版 PDF、加密文档或纯图片文件）。你只知道文件名，需要时请直接说明，不要猜测内容。]`))
    .join('');
  const lastUser = history.map(m => m.role).lastIndexOf('user');
  if (lastUser < 0) return history;
  const next = [...history];
  next[lastUser] = { ...next[lastUser], content: (next[lastUser].content ?? '') + note };
  return next;
}

type ConversationAIMessage = {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ConversationToolCall[];
};

type ConversationToolCall = {
  id: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ConversationToolPreparation = {
  messages: ConversationAIMessage[];
  toolCalls: Array<{ id: string; name: string }>;
};

type ConversationAIReply = {
  content: string;
  toolCalls: Array<{ id: string; name: string }>;
  toolsUsed: string[];
};

function isTargetType(value: unknown): value is TargetType {
  return typeof value === 'string' && VALID_TARGETS.includes(value as TargetType);
}

function paramString(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new ApiError(400, `${name} is required`);
  return value;
}

async function getNoteContext(noteId: string) {
  const { data, error } = await supabase
    .from('notes')
    .select('id, title, content, space_id, spaces!inner(id, course_id)')
    .eq('id', noteId)
    .is('deleted_at', null)
    .single();

  if (error || !data) throw new ApiError(404, 'Note not found');
  const space = Array.isArray((data as any).spaces) ? (data as any).spaces[0] : (data as any).spaces;
  return {
    id: data.id as string,
    title: data.title as string,
    content: (data.content as string | null) ?? '',
    spaceId: data.space_id as string,
    courseId: space.course_id as string,
  };
}

async function isCourseMember(courseId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('course_members')
    .select('course_id')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

/**
 * 按笔记所在的空间授权，返回调用者的课内身份。所有人都过 ensureSpaceAccess，
 * 不只是课程成员：绑定小组的空间只对本组开放，整群随机实验靠它隔离组间污染。
 * 只查课程的话，组 A 的学生拿到组 B 笔记的 id，就能在上面开一条 AI 线程——
 * AI 路由的系统提示里带着这条笔记最多 6000 字的正文，让 AI 复述一遍就读到了。
 *
 * 课程教职（创建者、课程管理员、平台管理员）能读这门课所有的私聊线程；
 * 平台身份是教师不算数，凭学生验证码入课的教师账号在这门课里是学生。
 * 下游凡是区分「教职 / 其他人」的地方，都用这里返回的身份，不看 req.user.role。
 */
async function requireNoteAccess(note: { spaceId: string }, req: Request) {
  if (!req.user) throw new ApiError(401, 'Authentication required');
  return (await ensureSpaceAccess(note.spaceId, req.user)).standing;
}

async function getThread(threadId: string) {
  const { data, error } = await supabase
    .from('note_conversation_threads')
    .select('*')
    .eq('id', threadId)
    .single();
  // 学生删掉的对话只是打了标记（行和消息留给研究导出），产品里当它不存在
  if (error || !data || (data as any).deleted_at) throw new ApiError(404, 'Conversation not found');
  return data as any;
}

async function isThreadParticipant(threadId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('note_conversation_participants')
    .select('thread_id')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

async function requireThreadRead(threadId: string, req: Request) {
  const thread = await getThread(threadId);
  // 线程的 space_id 建线程时照抄自它挂的那条笔记。只查参与者不够：
  // 学生换了组，或者在别组笔记上开过线程，AI 路由每一轮都会重新读那条笔记的最新正文。
  const standing = await requireNoteAccess({ spaceId: thread.space_id }, req);
  if (!isCourseStaff(standing)) {
    const participant = await isThreadParticipant(threadId, req.user!.id);
    if (!participant) throw new ApiError(403, 'Not a conversation participant');
  }
  return { thread, standing };
}

async function requireThreadWrite(threadId: string, req: Request) {
  // 写和读同一道门：课程教职，或者这条线程的参与者
  return requireThreadRead(threadId, req);
}

function threadToApi(row: any) {
  return {
    id: row.id,
    noteId: row.note_id,
    spaceId: row.space_id,
    courseId: row.course_id,
    targetType: row.target_type,
    groupId: row.group_id,
    targetUserId: row.target_user_id,
    providerId: row.provider_id,
    model: row.model,
    title: row.title,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participants: (row.note_conversation_participants ?? []).map((p: any) => ({
      userId: p.user_id,
      role: p.role,
      lastReadAt: p.last_read_at,
      user: p.profiles ? { id: p.profiles.id, name: p.profiles.full_name, avatar: p.profiles.avatar_url } : undefined,
    })),
  };
}

function messageToApi(row: any) {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    senderKind: row.sender_kind,
    content: row.content,
    scaffoldId: row.scaffold_id,
    scaffoldStepId: row.scaffold_step_id,
    attachments: row.attachments ?? [],
    aiMetadata: row.ai_metadata ?? {},
    createdAt: row.created_at,
    sender: row.profiles ? { id: row.profiles.id, name: row.profiles.full_name, avatar: row.profiles.avatar_url } : undefined,
  };
}

async function getGroupParticipants(groupId: string, courseId: string): Promise<string[]> {
  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('id, course_id')
    .eq('id', groupId)
    .single();
  if (groupError || !group || group.course_id !== courseId) throw new ApiError(400, 'Invalid group for this course');

  const { data, error } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId);
  if (error) throw new ApiError(500, error.message);
  return (data ?? []).map((m: any) => m.user_id as string);
}

async function insertParticipants(threadId: string, userIds: string[], ownerId: string) {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) return;
  const { error } = await supabase
    .from('note_conversation_participants')
    .upsert(
      uniqueIds.map((userId) => ({ thread_id: threadId, user_id: userId, role: userId === ownerId ? 'owner' : 'member' })),
      { onConflict: 'thread_id,user_id' },
    );
  if (error) throw new ApiError(500, error.message);
}

/** 历史对话列表里认这段对话用的：学生问的第一句，压成一行 */
function previewText(content: unknown): string {
  return String(content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** 每条线程学生问的第一句。没有学生消息的线程（空白的新对话）不在结果里 */
async function firstQuestions(threadIds: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (threadIds.length === 0) return found;
  const { data, error } = await supabase
    .from('note_conversation_messages')
    .select('thread_id, content, created_at')
    .in('thread_id', threadIds)
    .eq('sender_kind', 'user')
    .order('created_at', { ascending: true })
    .limit(2000);
  if (error) throw new ApiError(500, error.message);
  for (const row of data ?? []) {
    const id = String((row as any).thread_id);
    const text = previewText((row as any).content);
    if (text && !found.has(id)) found.set(id, text);
  }
  return found;
}

/**
 * 「新建对话」时先看这个人在这条笔记上有没有还没问过话的空白对话：有就直接用它，
 * 不再多开一条。连点两下、或者开了不问就又点新建，都不会攒出一堆空线程。
 */
async function findBlankAiThread(noteId: string, userId: string) {
  const { data: mine, error } = await supabase
    .from('note_conversation_threads')
    .select('*')
    .eq('note_id', noteId)
    .eq('target_type', 'ai')
    .eq('created_by', userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(5);
  if (error) throw new ApiError(500, error.message);
  const threads = (mine ?? []) as any[];
  if (threads.length === 0) return null;
  const { data: used, error: usedError } = await supabase
    .from('note_conversation_messages')
    .select('thread_id')
    .in('thread_id', threads.map(t => t.id))
    .limit(1000);
  if (usedError) throw new ApiError(500, usedError.message);
  const usedIds = new Set((used ?? []).map((m: any) => String(m.thread_id)));
  return threads.find(t => !usedIds.has(String(t.id))) ?? null;
}

async function logConversationEvent(req: Request, eventType: string, objectId: string, spaceId: string, metadata: Record<string, unknown>) {
  await supabase.from('events').insert({
    actor_id: req.user?.id,
    actor_role: req.user?.role,
    event_type: eventType,
    object_type: 'note_conversation',
    object_id: objectId,
    space_id: spaceId,
    metadata_json: metadata,
  });
}

router.get('/notes/:noteId/conversations', verifyJWT, async (req: Request, res: Response) => {
  const note = await getNoteContext(paramString(req.params.noteId, 'noteId'));
  const standing = await requireNoteAccess(note, req);
  const aiConfigs = await listCourseAiConfigs(note.courseId);

  let query = supabase
    .from('note_conversation_threads')
    .select('*, note_conversation_participants(user_id, role, last_read_at, profiles!user_id(id, full_name, avatar_url))')
    .eq('note_id', note.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  // 课程教职看这条笔记上的全部线程，其他人只看自己参与的
  if (!isCourseStaff(standing)) {
    const { data: participantRows, error: participantError } = await supabase
      .from('note_conversation_participants')
      .select('thread_id')
      .eq('user_id', req.user!.id);
    if (participantError) throw new ApiError(500, participantError.message);
    const threadIds = (participantRows ?? []).map((p: any) => p.thread_id);
    if (threadIds.length === 0) return res.json({ conversations: [], aiConfigs });
    query = query.in('id', threadIds);
  }

  const { data, error } = await query;
  if (error) throw new ApiError(500, error.message);

  // preview = 学生问的第一句；null = 还没问过话的空白对话（历史对话列表里不列）
  const previews = await firstQuestions((data ?? []).map((row: any) => String(row.id)));

  await logConversationEvent(req, 'note_conversation_opened', note.id, note.spaceId, { note_id: note.id });
  res.json({
    conversations: (data ?? []).map((row: any) => ({ ...threadToApi(row), preview: previews.get(String(row.id)) ?? null })),
    aiConfigs,
    courseId: note.courseId,
    spaceId: note.spaceId,
  });
});

router.post('/notes/:noteId/conversations', verifyJWT, async (req: Request, res: Response) => {
  const note = await getNoteContext(paramString(req.params.noteId, 'noteId'));
  const standing = await requireNoteAccess(note, req);

  const { target_type, group_id, target_user_id, provider_id, model, title, force_new } = req.body;
  if (!isTargetType(target_type)) throw new ApiError(400, 'target_type must be group, member, or ai');

  let participants: string[] = [req.user!.id];
  if (target_type === 'group') {
    if (!group_id) throw new ApiError(400, 'group_id is required for group conversations');
    participants = await getGroupParticipants(group_id, note.courseId);
    if (!participants.includes(req.user!.id) && !isCourseStaff(standing)) {
      throw new ApiError(403, 'Only group members can create this group conversation');
    }
    if (!participants.includes(req.user!.id)) participants.push(req.user!.id);
  }

  if (target_type === 'member') {
    if (!target_user_id) throw new ApiError(400, 'target_user_id is required for member conversations');
    const targetIsMember = await isCourseMember(note.courseId, target_user_id);
    if (!targetIsMember) throw new ApiError(400, 'Target user is not a course member');
    participants = [req.user!.id, target_user_id];
  }

  // 「新建对话」（force_new）要的是一段新的：不按模型去找旧线程，只在手头已有空白对话时复用它。
  // 其余情况（第一次问 AI 时开线程）照旧：同一个人、同一条笔记、同一个模型只有一条。
  if (target_type === 'ai' && force_new === true) {
    const blank = await findBlankAiThread(note.id, req.user!.id);
    if (blank) {
      return res.status(200).json({ conversation: { ...threadToApi({ ...blank, note_conversation_participants: [] }), preview: null } });
    }
  } else {
    let existingQuery = supabase
      .from('note_conversation_threads')
      .select('*')
      .eq('note_id', note.id)
      .eq('target_type', target_type)
      .is('deleted_at', null);
    if (target_type === 'group') existingQuery = existingQuery.eq('group_id', group_id);
    if (target_type === 'member') existingQuery = existingQuery.eq('target_user_id', target_user_id).eq('created_by', req.user!.id);
    if (target_type === 'ai') existingQuery = existingQuery.eq('created_by', req.user!.id).eq('provider_id', provider_id ?? '').eq('model', model ?? '');

    const { data: existing } = await existingQuery.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      await insertParticipants(existing.id, participants, existing.created_by);
      return res.status(200).json({ conversation: threadToApi({ ...existing, note_conversation_participants: [] }) });
    }
  }

  const { data: thread, error } = await supabase
    .from('note_conversation_threads')
    .insert({
      note_id: note.id,
      space_id: note.spaceId,
      course_id: note.courseId,
      target_type,
      group_id: target_type === 'group' ? group_id : null,
      target_user_id: target_type === 'member' ? target_user_id : null,
      provider_id: target_type === 'ai' ? provider_id ?? null : null,
      model: target_type === 'ai' ? model ?? null : null,
      title: title ?? defaultThreadTitle(target_type, note.title),
      created_by: req.user!.id,
    })
    .select('*')
    .single();

  if (error) throw new ApiError(500, error.message);
  await insertParticipants(thread.id, participants, req.user!.id);
  await logConversationEvent(req, 'note_conversation_created', thread.id, note.spaceId, { note_id: note.id, target_type });
  res.status(201).json({ conversation: { ...threadToApi({ ...thread, note_conversation_participants: [] }), preview: null } });
});

/**
 * DELETE /note-conversations/:threadId — 学生删掉自己的一段历史对话（2026-09-29）。
 *
 * 只打删除标记，线程和消息都留着：这些对话是研究数据，研究导出照旧包含（消息表里标「学生已删除」）。
 * 产品里从此当它不存在：列表不列、读消息 404、再往里发消息 404。
 * 只有开这段对话的人能删自己的；课程教职也不能替学生删。
 */
router.delete('/note-conversations/:threadId', verifyJWT, async (req: Request, res: Response) => {
  const { thread } = await requireThreadWrite(paramString(req.params.threadId, 'threadId'), req);
  if (thread.created_by !== req.user!.id) throw new ApiError(403, 'Only the person who started a conversation can delete it');

  const { error } = await supabase
    .from('note_conversation_threads')
    .update({ deleted_at: new Date().toISOString(), deleted_by: req.user!.id })
    .eq('id', thread.id)
    .is('deleted_at', null);
  if (error) throw new ApiError(500, error.message);

  await logConversationEvent(req, 'note_conversation_deleted', thread.id, thread.space_id, { note_id: thread.note_id, target_type: thread.target_type });
  res.json({ ok: true });
});

router.get('/note-conversations/:threadId/messages', verifyJWT, async (req: Request, res: Response) => {
  const threadId = paramString(req.params.threadId, 'threadId');
  await requireThreadRead(threadId, req);
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  const before = req.query.before as string | undefined;

  let query = supabase
    .from('note_conversation_messages')
    .select('*, profiles!sender_id(id, full_name, avatar_url)')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw new ApiError(500, error.message);
  res.json({ messages: (data ?? []).reverse().map(messageToApi) });
});

router.post('/note-conversations/:threadId/messages', verifyJWT, async (req: Request, res: Response) => {
  const { thread } = await requireThreadWrite(paramString(req.params.threadId, 'threadId'), req);
  const { content = '', scaffold_id, scaffold_step_id, attachments = [] } = req.body as {
    content?: string;
    scaffold_id?: string;
    scaffold_step_id?: string;
    attachments?: Attachment[];
  };
  if (!content.trim() && attachments.length === 0) throw new ApiError(400, 'content or attachments are required');

  const { data, error } = await supabase
    .from('note_conversation_messages')
    .insert({
      thread_id: thread.id,
      sender_id: req.user!.id,
      sender_kind: 'user',
      content: content.trim(),
      scaffold_id: scaffold_id ?? null,
      scaffold_step_id: scaffold_step_id ?? null,
      attachments: stripAttachmentText(attachments),
    })
    .select('*, profiles!sender_id(id, full_name, avatar_url)')
    .single();
  if (error) throw new ApiError(500, error.message);

  await logConversationEvent(req, attachments.length > 0 ? 'attachment_added' : 'message_sent', data.id, thread.space_id, {
    thread_id: thread.id,
    note_id: thread.note_id,
    scaffold_id: scaffold_id ?? null,
    scaffold_step_id: scaffold_step_id ?? null,
    attachment_count: attachments.length,
  });
  if (scaffold_id) {
    await logConversationEvent(req, 'scaffold_used_in_chat', data.id, thread.space_id, { thread_id: thread.id, scaffold_id, scaffold_step_id });
  }

  res.status(201).json({ message: messageToApi(data) });
});

/**
 * POST /note-conversations/:threadId/image — 只生图，不跑智能体。
 *
 * 走智能体那条整轮要 41s，其中生图本身只占 6.5s，其余全是 ReAct 循环里
 * 模型自己的推理轮次（调工具前想一次、拿到图再组织一次回复）。学生明确说
 * 「给我画张图」时，这些推理是白花的时间。
 *
 * 仍然写进对话记录（一条学生消息 + 一条助手消息），研究数据不能因为走了
 * 快路就少一条。
 */
router.post('/note-conversations/:threadId/image', verifyJWT, async (req: Request, res: Response) => {
  const { thread } = await requireThreadWrite(paramString(req.params.threadId, 'threadId'), req);
  const prompt = String((req.body as any)?.prompt ?? '').trim();
  if (!prompt) throw new ApiError(400, 'prompt is required');

  const { data: userMessage, error: userError } = await supabase
    .from('note_conversation_messages')
    .insert({
      thread_id: thread.id,
      sender_id: req.user!.id,
      sender_kind: 'user',
      content: prompt,
      attachments: [],
      ai_metadata: { direct_image: true },
    })
    .select('*')
    .single();
  if (userError) throw new ApiError(500, userError.message);

  const result = await generateNoteImage(thread.course_id, prompt);
  if (!result.ok) {
    // 生图失败也要留痕：学生看到的是失败，研究数据里也该是失败，
    // 而不是一条凭空消失的提问。
    await supabase.from('note_conversation_messages').insert({
      thread_id: thread.id,
      sender_kind: 'assistant',
      content: `图片生成失败：${result.error}`,
      attachments: [],
      ai_metadata: { direct_image: true, failed: true },
    });
    throw new ApiError(502, result.error);
  }

  const markdown = `![${prompt.slice(0, 60).replace(/[\[\]]/g, '')}](${result.url})`;
  const { data: assistantMessage, error: assistantError } = await supabase
    .from('note_conversation_messages')
    .insert({
      thread_id: thread.id,
      sender_kind: 'assistant',
      content: markdown,
      attachments: [],
      ai_metadata: { direct_image: true, model: result.model, image_url: result.url },
    })
    .select('*')
    .single();
  if (assistantError) throw new ApiError(500, assistantError.message);

  await supabase.from('ai_interventions').insert({
    space_id: thread.space_id,
    note_id: thread.note_id,
    user_id: req.user!.id,
    trigger_type: 'note_conversation_direct_image',
    provider_id: result.provider,
    model_name: result.model,
    input_context_summary: prompt.slice(0, 200),
    response_text: result.url.slice(0, 500),
    visibility_scope: 'private',
  });

  res.status(201).json({
    userMessage: messageToApi(userMessage),
    assistantMessage: messageToApi(assistantMessage),
    imageUrl: result.url,
    model: result.model,
  });
});

router.post('/note-conversations/:threadId/attachments', verifyJWT, async (req: Request, res: Response) => {
  const { thread } = await requireThreadWrite(paramString(req.params.threadId, 'threadId'), req);
  const { file_name, mime_type = 'application/octet-stream', file_size, data_url } = req.body as {
    file_name?: string;
    mime_type?: string;
    file_size?: number;
    data_url?: string;
  };
  if (!file_name || !data_url) throw new ApiError(400, 'file_name and data_url are required');

  const ALLOWED_MIME_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]);
  if (!ALLOWED_MIME_TYPES.has(mime_type)) {
    throw new ApiError(400, 'File type not allowed. Supported: images, PDF, Office documents, CSV, plain text.');
  }

  const match = data_url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new ApiError(400, 'data_url must be a base64 data URL');
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > 50 * 1024 * 1024) throw new ApiError(413, 'File exceeds 50MB limit');

  const safeName = file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${thread.course_id}/${thread.note_id}/${thread.id}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from('note-chat-attachments')
    .upload(path, buffer, { contentType: mime_type, upsert: false });
  if (uploadError) throw new ApiError(500, uploadError.message);

  const { data: publicData } = supabase.storage.from('note-chat-attachments').getPublicUrl(path);
  res.status(201).json({
    attachment: {
      file_url: publicData.publicUrl,
      file_name,
      mime_type,
      file_size: file_size ?? buffer.length,
    },
  });
});

/**
 * 笔记 AI 助手这一轮用哪个模型。
 * 学生在下拉框里选的、在教师允许的名单里，就照用；'auto' 和名单外的（教师刚改了名单、
 * 学生的页面还没刷新）落到课程 AI 设置里这一功能的「默认」。见 services/aiFeatureModels。
 * 顺带把那家的配置行带回去，调用方不必再查一次。
 */
async function resolvePartnerModel(courseId: string, providerId: string, model: string) {
  const rows = await loadCourseAiRows(courseId).catch((err: Error) => { throw new ApiError(500, err.message); });
  const selection = resolvePartnerSelection(rows, { providerId, model });
  if (!selection) throw new ApiError(404, 'No AI provider configured for this course');
  const config = rows.find(r => r.provider_id === selection.providerId && hasProviderKey(r));
  if (!config) throw new ApiError(404, `Provider "${selection.providerId}" is not configured for this course`);
  return {
    providerId: selection.providerId,
    model: selection.model,
    coerced: selection.coerced,
    config: {
      api_key_encrypted: config.api_key_encrypted ?? null,
      endpoint_url: config.endpoint_url ?? null,
      enabled_models: Array.isArray(config.enabled_models) ? config.enabled_models as string[] : [],
    },
  };
}

router.post('/note-conversations/:threadId/ai', verifyJWT, async (req: Request, res: Response) => {
  const { thread } = await requireThreadWrite(paramString(req.params.threadId, 'threadId'), req);
  const { content, provider_id, model, scaffold_id, scaffold_step_id, attachments = [], use_web_search = false, agent_mode } = req.body as {
    content?: string;
    provider_id?: string;
    model?: string;
    scaffold_id?: string;
    scaffold_step_id?: string;
    attachments?: Attachment[];
    use_web_search?: boolean;
    agent_mode?: unknown;
  };
  if (!content?.trim()) throw new ApiError(400, 'content is required');
  if (!provider_id || !model) throw new ApiError(400, 'provider_id and model are required');
  const normalizedAgentMode = normalizeConversationAgentMode(agent_mode);
  const shouldUseWebSearch = Boolean(use_web_search) || shouldUseWebEvidenceForAgentMode(normalizedAgentMode);

  const partner = await resolvePartnerModel(thread.course_id, provider_id, model);
  const resolvedPid = partner.providerId;
  const resolvedMod = partner.model;

  const { data: userMessage, error: userMessageError } = await supabase
    .from('note_conversation_messages')
    .insert({
      thread_id: thread.id,
      sender_id: req.user!.id,
      sender_kind: 'user',
      content: content.trim(),
      scaffold_id: scaffold_id ?? null,
      scaffold_step_id: scaffold_step_id ?? null,
      attachments: stripAttachmentText(attachments),
    })
    .select('*, profiles!sender_id(id, full_name, avatar_url)')
    .single();
  if (userMessageError) throw new ApiError(500, userMessageError.message);

  const note = await getNoteContext(thread.note_id);
  const { data: recent } = await supabase
    .from('note_conversation_messages')
    .select('sender_kind, content')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: false })
    .limit(12);

  const history: ConversationAIMessage[] = (recent ?? [])
    .reverse()
    .map((m: any) => ({
      role: (m.sender_kind === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content as string,
    }))
    .filter((m: { content: string }) => !!m.content?.trim());

  const reply = await callConversationAI({
    courseId: thread.course_id,
    providerId: resolvedPid,
    model: resolvedMod,
    config: partner.config,
    messages: appendAttachmentContext(history, attachments),
    note,
    useWebSearch: shouldUseWebSearch,
    agentMode: normalizedAgentMode,
  });
  const replyText = reply.content;

  const { data: assistantMessage, error: assistantError } = await supabase
    .from('note_conversation_messages')
    .insert({
      thread_id: thread.id,
      sender_id: null,
      sender_kind: 'assistant',
      content: replyText,
      ai_metadata: {
        provider_id: resolvedPid,
        model: resolvedMod,
        use_web_search: shouldUseWebSearch,
        agent_mode: normalizedAgentMode,
        toolsUsed: reply.toolsUsed,
        tools_used: reply.toolsUsed,
        tool_calls: reply.toolCalls,
      },
    })
    .select('*')
    .single();
  if (assistantError) throw new ApiError(500, assistantError.message);

  await supabase.from('note_conversation_threads').update({ provider_id: resolvedPid, model: resolvedMod }).eq('id', thread.id);
  await supabase.from('ai_interventions').insert({
    space_id: thread.space_id,
    note_id: thread.note_id,
    user_id: req.user!.id,
    trigger_type: 'note_conversation_chat',
    provider_id: resolvedPid,
    model_name: resolvedMod,
    input_context_summary: content.slice(0, 200),
    response_text: replyText.slice(0, 500),
    visibility_scope: 'private',
  });
  await logConversationEvent(req, 'ai_message_sent', assistantMessage.id, thread.space_id, {
    thread_id: thread.id,
    note_id: thread.note_id,
    provider_id: resolvedPid,
    model: resolvedMod,
    user_message_id: userMessage.id,
    agent_mode: normalizedAgentMode,
    tools_used: reply.toolsUsed,
  });

  res.status(201).json({ userMessage: messageToApi(userMessage), assistantMessage: messageToApi(assistantMessage) });
});

type ToolStep = KbToolStep;

/** 往这一轮的 SSE 流里写一条事件 */
const sseSender = (res: Response) => (event: Record<string, unknown>) => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

router.post('/note-conversations/:threadId/ai/stream', verifyJWT, async (req: Request, res: Response) => {
  const { thread } = await requireThreadWrite(paramString(req.params.threadId, 'threadId'), req);
  const turnStartedAt = Date.now();
  const { content, provider_id, model, scaffold_id, scaffold_step_id, attachments = [], use_web_search = false, agent_mode, answer_length } = req.body as {
    content?: string;
    provider_id?: string;
    model?: string;
    scaffold_id?: string;
    scaffold_step_id?: string;
    attachments?: Attachment[];
    use_web_search?: boolean;
    agent_mode?: unknown;
    answer_length?: unknown;
  };
  if (!content?.trim()) throw new ApiError(400, 'content is required');
  if (!provider_id || !model) throw new ApiError(400, 'provider_id and model are required');
  const freeAsk = isFreeAskMode(agent_mode);
  const normalizedAgentMode = normalizeConversationAgentMode(agent_mode);
  // 自由提问只在学生自己打开联网时才搜；不替他决定
  const shouldUseWebSearch = Boolean(use_web_search) || (!freeAsk && shouldUseWebEvidenceForAgentMode(normalizedAgentMode));

  const partner = await resolvePartnerModel(thread.course_id, provider_id, model);
  const resolvedProviderId = partner.providerId;
  const resolvedModel = partner.model;
  // 回答写多长：学生选的档位 + 问题深浅（Jev），和下面读笔记、检索同时进行
  const lengthPlanPromise = planAnswerLength(content.trim(), parseAnswerLength(answer_length), {
    thinking: thinkingLikely(resolvedProviderId, resolvedModel),
  });

  const { data: userMessage, error: userMessageError } = await supabase
    .from('note_conversation_messages')
    .insert({
      thread_id: thread.id,
      sender_id: req.user!.id,
      sender_kind: 'user',
      content: content.trim(),
      scaffold_id: scaffold_id ?? null,
      scaffold_step_id: scaffold_step_id ?? null,
      attachments: stripAttachmentText(attachments),
    })
    .select('*, profiles!sender_id(id, full_name, avatar_url)')
    .single();
  if (userMessageError) throw new ApiError(500, userMessageError.message);

  const note = await getNoteContext(thread.note_id);
  const { data: recent } = await supabase
    .from('note_conversation_messages')
    .select('sender_kind, content')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: false })
    .limit(12);
  const history = (recent ?? [])
    .reverse()
    .map((m: any) => ({
      role: (m.sender_kind === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content as string,
    }))
    .filter((m: { content: string }) => !!m.content?.trim());

  const config = partner.config;
  if (!config.api_key_encrypted) throw new ApiError(404, `Provider "${resolvedProviderId}" is not configured for this course`);
  const apiKey = decryptProviderApiKey(config.api_key_encrypted);

  // 课程资料：和下面的准备同时检索，见 kbSources.ts。history 最后一条就是刚存的这句
  const zhQuestion = detectQuestionLanguage(content) === 'zh';
  const kbRun = startNoteKbRetrieval({
    courseId: thread.course_id,
    viewer: req.user!,
    question: content,
    earlierQuestions: history.filter(m => m.role === 'user').map(m => m.content).slice(0, -1),
    noteTitle: note.title,
    zh: zhQuestion,
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ userMessage: messageToApi(userMessage) })}\n\n`);
  if (partner.coerced) {
    res.write(`data: ${JSON.stringify({ modelSwitched: resolvedModel, providerId: resolvedProviderId, reason: 'course_policy' })}\n\n`);
  }

  const normalizedModel = usesDeepSeekModelAliases(resolvedProviderId) ? normalizeDeepSeekModel(resolvedModel, resolvedProviderId) : resolvedModel;
  let fullReply = '';
  let reasoningStarted = false;
  let reasoningChars = 0;
  let answeringStarted = false;
  const historyWithDocs = appendAttachmentContext(history, attachments);
  let toolPreparation: ConversationToolPreparation = { messages: historyWithDocs, toolCalls: [] };
  const toolsUsed = new Set<string>();
  // 这一轮做了哪几步，存进回答里：回看时也能看到「用了几步」（AgentProcess）
  const toolSteps: ToolStep[] = [];
  const keepaliveTimer = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch {}
  }, 15_000);
  try {
    const kb = await announceKbRetrieval(sseSender(res), kbRun, toolSteps, toolsUsed, zhQuestion);
    const baseSystemSections = [
      'You are a pedagogical GenAI collaborator inside a Knowledge Building note editor.',
      'Help the learner improve the current idea. Be concise, concrete, and evidence-oriented.',
      'When useful, ask one follow-up question that can improve the public idea object.',
      getConversationAgentSpec(normalizedAgentMode).systemInstruction,
      `Current note title: ${note.title}`,
      // 1200 字是早期为省 token 定的，一条像样的笔记就超了 —— AI 读到的是半截。
      // 模型的上下文窗口远不是瓶颈，真正的成本在于送太多无关内容。
      `Current note content: ${stripHtml(note.content).slice(0, 6000)}`,
      kb?.section ?? '',
    ].filter(Boolean);
    if (freeAsk) {
      baseSystemSections.length = 0;
      baseSystemSections.push(buildFreeAskSystemPrompt({ title: note.title, text: stripHtml(note.content).slice(0, 6000) }));
      if (kb?.section) baseSystemSections.push(kb.section);
    }
    let systemContent = baseSystemSections.join('\n\n');

    if (shouldUseWebSearch) {
      res.write(`data: ${JSON.stringify({ toolStatus: 'running', toolNames: ['tavily_search'] })}\n\n`);
      const searchStarted = Date.now();
      const webResults = await getCourseTavilyResults(thread.course_id, content, 3).catch(() => []);
      if (webResults.length > 0) {
        toolsUsed.add('tavily_search');
        systemContent = [...baseSystemSections, formatTavilyResultsForPrompt(webResults)].join('\n\n');
      }
      const searchSummary = webResults.length > 0
        ? (zhQuestion ? `找到 ${webResults.length} 条网页结果` : `${webResults.length} web results`)
        : (zhQuestion ? '没有找到网页结果' : 'no web results');
      toolSteps.push({ name: 'tavily_search', summary: searchSummary, ms: Date.now() - searchStarted });
      res.write(`data: ${JSON.stringify({
        toolStatus: 'used',
        toolName: 'tavily_search',
        toolNames: webResults.length > 0 ? Array.from(toolsUsed) : [],
        toolSummary: searchSummary,
        toolDurationMs: Date.now() - searchStarted,
      })}\n\n`);
    }

    // 自由提问不装载知识网络工具：不去读工作区里别人的笔记，也省掉一轮工具规划
    const needsTools = !freeAsk && (shouldPrepareToolsForAgentMode(normalizedAgentMode) || shouldPrepareConversationTools(content));
    if (needsTools && resolvedProviderId !== 'anthropic' && resolvedProviderId !== 'google') {
      res.write(`data: ${JSON.stringify({ toolStatus: 'running' })}\n\n`);
      const prepareStarted = Date.now();
      toolPreparation = await prepareToolMessages({
        providerId: resolvedProviderId,
        model: resolvedModel,
        messages: historyWithDocs,
        systemContent,
        apiKey,
        endpointUrl: config.endpoint_url ?? null,
        note,
      });
      const prepared = toolPreparation.toolCalls.map(tool => tool.name);
      prepared.forEach(name => toolsUsed.add(name));
      const prepareMs = Date.now() - prepareStarted;
      prepared.forEach(name => toolSteps.push({ name, ms: prepareMs }));
      // 什么也没用上也要说一声结束了：以前这里不发，「找相关内容」那个标签会一直转到回答写完
      res.write(`data: ${JSON.stringify({
        toolStatus: 'used',
        toolNames: prepared,
        toolDurationMs: prepareMs,
      })}\n\n`);
    }

    const lengthPlan = await lengthPlanPromise;
    const answerSystem = `${systemContent}\n\n${lengthInstruction(lengthPlan)}`;

    /** 发一次流式请求，token 直接推给学生。返回这一次是不是写到上限被截住；请求失败返回错误 */
    const streamAnswer = async (messages: ConversationAIMessage[]): Promise<{ truncated: boolean } | { failed: string }> => {
    const { url, headers, body } = await buildConversationStreamRequest(
      resolvedProviderId,
      resolvedModel,
      messages,
      answerSystem,
      apiKey,
      config.endpoint_url ?? null,
      lengthPlan.maxTokens,
    );
    const upstream = await aiFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!upstream.ok) {
      const errText = await upstream.text();
      return { failed: `HTTP ${upstream.status}: ${errText.slice(0, 200)}` };
    }
    let cut = false;
    if (upstream.body) {
      const reader = (upstream.body as any).getReader();
      const decoder = new TextDecoder();
      let streamBuffer = '';
      const handleStreamLine = (line: string) => {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') return;
        try {
          const json = JSON.parse(line.slice(6));
          if (conversationStreamTruncated(resolvedProviderId, json)) cut = true;
          const reasoning = extractConversationReasoning(resolvedProviderId, json);
          if (reasoning) {
            reasoningChars += reasoning.length;
            if (!reasoningStarted) {
              reasoningStarted = true;
              res.write(`data: ${JSON.stringify({ reasoningStatus: 'thinking', reasoningChars })}\n\n`);
            }
            return;
          }
          const token = extractConversationStreamToken(resolvedProviderId, json);
          if (token) {
            if (reasoningStarted && !answeringStarted) {
              answeringStarted = true;
              res.write(`data: ${JSON.stringify({ reasoningStatus: 'answering', reasoningChars })}\n\n`);
            }
            fullReply += token;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch {
          // Skip malformed provider lines.
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split(/\r?\n/);
        streamBuffer = lines.pop() ?? '';
        for (const line of lines) {
          handleStreamLine(line);
        }
      }
      streamBuffer += decoder.decode();
      if (streamBuffer.trim()) {
        handleStreamLine(streamBuffer.trim());
      }
    }
    return { truncated: cut };
    };

    const first = await streamAnswer(toolPreparation.messages);
    if ('failed' in first) {
      res.write(`data: ${JSON.stringify({ error: first.failed })}\n\n`);
      res.write('data: [DONE]\n\n');
      clearInterval(keepaliveTimer);
      res.end();
      return;
    }
    // 写到上限被截住：接着写，学生看到的是一段完整的回答（2026-10-05）
    let truncated = first.truncated;
    let continuations = 0;
    while (truncated && fullReply.trim() && continuations < MAX_CONTINUATIONS) {
      continuations += 1;
      const next = await streamAnswer([
        ...toolPreparation.messages,
        { role: 'assistant', content: fullReply },
        { role: 'user', content: CONTINUE_PROMPT },
      ]);
      if ('failed' in next) break;
      truncated = next.truncated;
    }

    const { data: assistantMessage, error: assistantError } = await supabase
      .from('note_conversation_messages')
      .insert({
        thread_id: thread.id,
        sender_id: null,
        sender_kind: 'assistant',
        content: fullReply,
        ai_metadata: {
          provider_id: resolvedProviderId,
          model: normalizedModel,
          answer_length: lengthPlanMetadata(lengthPlan, fullReply, { continuations, truncated }),
          tool_steps: toolSteps,
          // 来源卡片：回答里的 [n] 对应哪份资料、哪一节、第几页
          kb_sources: kb?.citations.sources.length ? kb.citations.sources : undefined,
          elapsed_ms: Date.now() - turnStartedAt,
          use_web_search: shouldUseWebSearch,
          agent_mode: freeAsk ? 'free_ask' : normalizedAgentMode,
          streamed: true,
          reasoningStatus: reasoningStarted ? 'done' : undefined,
          reasoning_status: reasoningStarted ? 'done' : undefined,
          reasoningChars: reasoningChars || undefined,
          reasoning_chars: reasoningChars || undefined,
          toolsUsed: Array.from(toolsUsed),
          tools_used: Array.from(toolsUsed),
          tool_calls: toolPreparation.toolCalls,
        },
      })
      .select('*')
      .single();
    if (assistantError) throw new ApiError(500, assistantError.message);

    await supabase.from('note_conversation_threads').update({ provider_id: resolvedProviderId, model: normalizedModel }).eq('id', thread.id);
    await supabase.from('ai_interventions').insert({
      space_id: thread.space_id,
      note_id: thread.note_id,
      user_id: req.user!.id,
      trigger_type: 'note_conversation_chat_stream',
      provider_id: resolvedProviderId,
      model_name: normalizedModel,
      input_context_summary: content.slice(0, 200),
      response_text: fullReply.slice(0, 500),
      visibility_scope: 'private',
    });
    await logConversationEvent(req, 'ai_message_sent', assistantMessage.id, thread.space_id, {
      thread_id: thread.id,
      note_id: thread.note_id,
      provider_id: resolvedProviderId,
      model: normalizedModel,
      user_message_id: userMessage.id,
      streamed: true,
      agent_mode: freeAsk ? 'free_ask' : normalizedAgentMode,
      tools_used: Array.from(toolsUsed),
    });

    if (reasoningStarted) {
      res.write(`data: ${JSON.stringify({ reasoningStatus: 'done', reasoningChars })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ assistantMessage: messageToApi(assistantMessage) })}\n\n`);
    res.write('data: [DONE]\n\n');
    clearInterval(keepaliveTimer);
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message ?? 'Stream error' })}\n\n`);
    res.write('data: [DONE]\n\n');
    clearInterval(keepaliveTimer);
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Agent Loop streaming endpoint — multi-step ReAct with native tool calling
// ---------------------------------------------------------------------------

const agentRegistry = createDefaultRegistry();

router.post('/note-conversations/:threadId/ai/agent-stream', verifyJWT, async (req: Request, res: Response) => {
  const { thread, standing } = await requireThreadWrite(paramString(req.params.threadId, 'threadId'), req);
  const turnStartedAt = Date.now();
  const { content, provider_id: requestedProviderId, model: requestedModel, scaffold_id, scaffold_step_id, attachments = [], agent_mode, answer_length } = req.body as {
    content?: string;
    provider_id?: string;
    model?: string;
    scaffold_id?: string;
    scaffold_step_id?: string;
    attachments?: Attachment[];
    agent_mode?: unknown;
    answer_length?: unknown;
  };
  if (!content?.trim()) throw new ApiError(400, 'content is required');
  if (!requestedProviderId || !requestedModel) throw new ApiError(400, 'provider_id and model are required');
  const freeAsk = isFreeAskMode(agent_mode);
  const normalizedAgentMode = normalizeConversationAgentMode(agent_mode);
  const partner = await resolvePartnerModel(thread.course_id, requestedProviderId, requestedModel);
  const provider_id = partner.providerId;
  const model = partner.model;
  // 回答写多长：学生选的档位 + 问题深浅（Jev），和下面装上下文同时进行
  const lengthPlanPromise = planAnswerLength(content.trim(), parseAnswerLength(answer_length), {
    thinking: thinkingLikely(provider_id, model),
  });

  const { data: userMessage, error: userMessageError } = await supabase
    .from('note_conversation_messages')
    .insert({
      thread_id: thread.id,
      sender_id: req.user!.id,
      sender_kind: 'user',
      content: content.trim(),
      scaffold_id: scaffold_id ?? null,
      scaffold_step_id: scaffold_step_id ?? null,
      attachments: stripAttachmentText(attachments),
    })
    .select('*, profiles!sender_id(id, full_name, avatar_url)')
    .single();
  if (userMessageError) throw new ApiError(500, userMessageError.message);

  const note = await getNoteContext(thread.note_id);
  const { data: recent } = await supabase
    .from('note_conversation_messages')
    .select('sender_kind, content')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: false })
    .limit(12);
  const history = (recent ?? [])
    .reverse()
    .map((m: any) => ({ role: m.sender_kind === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content as string }))
    .filter((m) => !!m.content?.trim());
  const historyForModel = appendAttachmentContext(history, attachments);

  const config = partner.config;
  if (!config.api_key_encrypted) throw new ApiError(404, `Provider "${provider_id}" is not configured for this course`);
  const apiKey = decryptProviderApiKey(config.api_key_encrypted);

  // 课程资料：和下面装上下文同时检索，见 kbSources.ts
  const zhQuestion = detectQuestionLanguage(content) === 'zh';
  const kbRun = startNoteKbRetrieval({
    courseId: thread.course_id,
    viewer: req.user!,
    question: content,
    earlierQuestions: history.filter(m => m.role === 'user').map(m => m.content).slice(0, -1),
    noteTitle: note.title,
    zh: zhQuestion,
  });

  // 工具按课内身份给：教师工具能读全班的数据，凭学生验证码入课的教师账号在这门课里是学生
  const userRole = !isCourseStaff(standing) ? 'student' as const : req.user!.role === 'admin' ? 'admin' as const : 'teacher' as const;
  // 自由提问带了图或附件才会走到这条：不挂任何工具，也不用智能体的人设
  const modeToolNames = freeAsk ? [] : getAgentModeToolNames(normalizedAgentMode);
  const tools = agentRegistry.getToolsForRole(userRole).filter(
    (t) => modeToolNames.includes(t.function.name),
  );
  const toolNames = tools.map((t) => t.function.name);

  const agentContext = freeAsk ? {
    systemPrompt: buildFreeAskSystemPrompt({ title: note.title, text: stripHtml(note.content).slice(0, 6000) }),
    messages: historyForModel as Awaited<ReturnType<typeof buildAgentContext>>['messages'],
    toolContext: undefined as unknown as Awaited<ReturnType<typeof buildAgentContext>>['toolContext'],
  } : await buildAgentContext({
    note: { id: note.id, title: note.title, content: note.content, spaceId: note.spaceId, courseId: note.courseId },
    history: historyForModel,
    agentMode: normalizedAgentMode,
    userRole,
    userId: req.user!.id,
    courseId: thread.course_id,
    spaceId: thread.space_id,
    toolNames,
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ userMessage: messageToApi(userMessage) })}\n\n`);
  if (partner.coerced) {
    res.write(`data: ${JSON.stringify({ modelSwitched: model, providerId: provider_id, reason: 'course_policy' })}\n\n`);
  }

  const toolContext = agentContext.toolContext;
  let fullReply = '';
  const allToolCalls: Array<{ id: string; name: string }> = [];
  const allToolsUsed = new Set<string>();
  let agentIterations = 0;
  let continuations = 0;
  let truncated = false;
  // 每一步的结果和用时，推给学生（AgentProcess），也存进回答里
  const toolSteps: ToolStep[] = [];
  const toolStartedAt = new Map<string, number>();
  const summaryLang = detectQuestionLanguage(content);

  const keepaliveTimer2 = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch {}
  }, 15_000);

  try {
    const kb = await announceKbRetrieval(sseSender(res), kbRun, toolSteps, allToolsUsed, zhQuestion);
    let sentSources = kb?.citations.sources.length ?? 0;
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

    // 学生这轮传了图：挂到最后一条学生消息上，并换一个看得懂图的模型。
    // 不换的话纯文本模型会把 image_url 块直接忽略掉，学生以为 AI 看见了，其实没有。
    const withImages = attachImagesToLastUserMessage(baseMessages, attachments);
    const carriesImage = withImages !== baseMessages;
    const effectiveModel = carriesImage
      ? (pickVisionModel(provider_id, model, config.enabled_models ?? []) ?? model)
      : model;
    if (carriesImage && effectiveModel !== model) {
      res.write(`data: ${JSON.stringify({ modelSwitched: effectiveModel, reason: 'vision' })}\n\n`);
    }

    const lengthPlan = await lengthPlanPromise;
    const stream = runAgentLoopStream({
      providerId: provider_id,
      model: effectiveModel,
      apiKey,
      endpointUrl: config.endpoint_url ?? null,
      systemPrompt: [
        agentContext.systemPrompt,
        kb?.section ?? '',
        carriesImage ? IMAGE_TURN_RULES : '',
        lengthInstruction(lengthPlan),
      ].filter(Boolean).join('\n\n'),
      messages: withImages,
      tools,
      // 智能体这一轮再查课程资料：查到的段落接着自动检索的编号往下编，来源卡片一起列
      executeToolFn: (name, args) => agentRegistry.executeTool(name, args, kb ? { ...toolContext, kbCitations: kb.citations } : toolContext),
      maxTokens: lengthPlan.maxTokens,
    });

    for await (const event of stream) {
      switch (event.type) {
        case 'thinking':
          res.write(`data: ${JSON.stringify({ reasoningStatus: 'thinking', reasoningChunk: event.content })}\n\n`);
          break;
        case 'tool_call':
          allToolCalls.push({ id: event.toolCall.id, name: event.toolCall.function.name });
          allToolsUsed.add(event.toolCall.function.name);
          toolStartedAt.set(event.toolCall.function.name, Date.now());
          res.write(`data: ${JSON.stringify({ toolStatus: 'running', toolName: event.toolCall.function.name })}\n\n`);
          break;
        case 'tool_result': {
          const startedAt = toolStartedAt.get(event.toolName);
          const ms = startedAt ? Date.now() - startedAt : undefined;
          // 只推统计性摘要（几条、成没成），不复述内容
          const summary = summarizeToolResult(event.toolName, event.result, summaryLang);
          toolSteps.push({ name: event.toolName, summary, ...(ms != null ? { ms } : {}) });
          res.write(`data: ${JSON.stringify({
            toolStatus: 'used',
            toolName: event.toolName,
            toolNames: Array.from(allToolsUsed),
            toolSummary: summary,
            toolDurationMs: ms,
          })}\n\n`);
          // 又查到新的课程资料：来源卡片整份重发（编号接着自动检索的往下）
          if (event.toolName === KB_STEP_NAME && kb && kb.citations.sources.length > sentSources) {
            sentSources = kb.citations.sources.length;
            res.write(`data: ${JSON.stringify({ kbSources: kb.citations.sources })}\n\n`);
          }
          break;
        }
        case 'token':
          fullReply += event.content;
          res.write(`data: ${JSON.stringify({ token: event.content })}\n\n`);
          break;
        case 'done':
          agentIterations = event.result.iterations;
          continuations = event.result.continuations ?? 0;
          truncated = event.result.truncated === true;
          break;
        case 'error':
          res.write(`data: ${JSON.stringify({ error: event.error })}\n\n`);
          break;
      }
    }

    const { data: assistantMessage, error: assistantError } = await supabase
      .from('note_conversation_messages')
      .insert({
        thread_id: thread.id,
        sender_id: null,
        sender_kind: 'assistant',
        content: fullReply,
        ai_metadata: {
          provider_id,
          answer_length: lengthPlanMetadata(lengthPlan, fullReply, { continuations, truncated }),
          tool_steps: toolSteps,
          kb_sources: kb?.citations.sources.length ? kb.citations.sources : undefined,
          elapsed_ms: Date.now() - turnStartedAt,
          // 记实际跑的模型。带图时会被切到视觉档，记请求值等于把回复
          // 算到一个没参与生成的模型头上，研究数据会失真。
          model: effectiveModel,
          requested_model: model,
          agent_mode: freeAsk ? 'free_ask' : normalizedAgentMode,
          agent_loop: true,
          agent_iterations: agentIterations,
          toolsUsed: Array.from(allToolsUsed),
          tools_used: Array.from(allToolsUsed),
          tool_calls: allToolCalls,
        },
      })
      .select('*')
      .single();
    if (assistantError) throw new ApiError(500, assistantError.message);

    await supabase.from('note_conversation_threads').update({ provider_id, model }).eq('id', thread.id);
    await supabase.from('ai_interventions').insert({
      space_id: thread.space_id,
      note_id: thread.note_id,
      user_id: req.user!.id,
      trigger_type: 'note_conversation_agent_loop',
      provider_id,
      model_name: effectiveModel,
      input_context_summary: content.slice(0, 200),
      response_text: fullReply.slice(0, 500),
      visibility_scope: 'private',
    });
    await logConversationEvent(req, 'ai_agent_message_sent', assistantMessage.id, thread.space_id, {
      thread_id: thread.id,
      note_id: thread.note_id,
      provider_id,
      model: effectiveModel,
      requested_model: model,
      user_message_id: userMessage.id,
      agent_mode: freeAsk ? 'free_ask' : normalizedAgentMode,
      agent_iterations: agentIterations,
      tools_used: Array.from(allToolsUsed),
    });

    if (userRole === 'student') {
      updateProfileAfterInteraction(req.user!.id, thread.course_id, {
        messageLength: content.length,
        usedEvidenceTools: allToolsUsed.has('search_space_notes'),
        usedConnectionTools: allToolsUsed.has('list_related_notes'),
        askedQuestion: /[?？]/.test(content),
        uniqueNoteId: thread.note_id,
        overrelianceDetected: agentContext.overrelianceDetected ?? false,
      }).catch((err) => console.error('[AgentStream] Profile update failed:', err));
    }

    embedNote(thread.note_id, thread.course_id, note.content).catch(() => {});

    res.write(`data: ${JSON.stringify({ assistantMessage: messageToApi(assistantMessage) })}\n\n`);
    res.write('data: [DONE]\n\n');
    clearInterval(keepaliveTimer2);
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message ?? 'Agent stream error' })}\n\n`);
    res.write('data: [DONE]\n\n');
    clearInterval(keepaliveTimer2);
    res.end();
  }
});

function defaultThreadTitle(targetType: TargetType, noteTitle: string): string {
  if (targetType === 'group') return `Group discussion · ${noteTitle}`;
  if (targetType === 'member') return `Direct discussion · ${noteTitle}`;
  return `GenAI · ${noteTitle}`;
}

async function prepareToolMessages(params: {
  providerId: string;
  model: string;
  messages: ConversationAIMessage[];
  systemContent: string;
  apiKey: string;
  endpointUrl: string | null;
  note: Awaited<ReturnType<typeof getNoteContext>>;
}): Promise<ConversationToolPreparation> {
  const { providerId, model, messages, systemContent, apiKey, endpointUrl, note } = params;
  const tools = buildConversationToolDefinitions();
  if (endpointUrl) await assertSafePublicUrl(endpointUrl);
  const url = endpointUrl ?? getOpenAICompatibleEndpoint(providerId);
  const planningModel = providerId === 'deepseek'
    ? (model === 'deepseek-v4-pro' || model === 'deepseek-reasoner' ? 'deepseek-flash' : model)
    : model;
  try {
    const response = await aiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(withFastChatOptions(providerId, planningModel, {
        model: planningModel,
        stream: false,
        messages: [{ role: 'system', content: systemContent }, ...messages],
        tools,
        tool_choice: 'auto',
        max_tokens: 260,
        temperature: 0.2,
      })),
    });
    if (!response.ok) return { messages, toolCalls: [] };
    const data = await response.json() as any;
    const assistantMessage = data.choices?.[0]?.message;
    const toolCalls = normalizeConversationToolCalls(assistantMessage?.tool_calls).slice(0, 3);
    if (toolCalls.length === 0) return { messages, toolCalls: [] };

    const toolResultMessages = await Promise.all(toolCalls.map(toolCall => executeConversationTool(toolCall, note)));
    return {
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: assistantMessage?.content ?? '',
          tool_calls: toolCalls,
        },
        ...toolResultMessages,
      ],
      toolCalls: toolCalls.map(toolCall => ({
        id: toolCall.id,
        name: toolCall.function?.name ?? 'unknown_tool',
      })),
    };
  } catch {
    return { messages, toolCalls: [] };
  }
}

function normalizeConversationToolCalls(value: unknown): ConversationToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ConversationToolCall => {
      const call = item as ConversationToolCall;
      return typeof call?.id === 'string' && typeof call.function?.name === 'string';
    })
    .filter(item => [
      'get_current_note_context',
      'list_related_notes',
      'search_space_notes',
    ].includes(item.function?.name ?? ''));
}

async function getCourseTavilyResults(
  courseId: string,
  query: string,
  maxResults = 3,
): Promise<TavilySearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];
  const { data: config } = await supabase
    .from('teacher_ai_configs')
    .select('api_key_encrypted, is_verified')
    .eq('course_id', courseId)
    .eq('provider_id', 'tavily')
    .maybeSingle();

  if (!config?.api_key_encrypted) return [];
  const tavilyApiKey = decryptProviderApiKey(config.api_key_encrypted);
  const result = await callTavilySearch(tavilyApiKey, trimmedQuery, 'basic', maxResults, false);
  return result.results ?? [];
}

async function executeConversationTool(
  toolCall: ConversationToolCall,
  note: Awaited<ReturnType<typeof getNoteContext>>,
): Promise<ConversationAIMessage> {
  const name = toolCall.function?.name ?? 'unknown_tool';
  const args = safeJsonParseToolArgs(toolCall.function?.arguments);
  let result: Record<string, unknown>;
  if (name === 'get_current_note_context') {
    result = {
      note: {
        id: note.id,
        title: note.title,
        contentSummary: summarizeForTool(note.content, 900),
        spaceId: note.spaceId,
        courseId: note.courseId,
      },
    };
  } else if (name === 'list_related_notes') {
    result = { relatedNotes: await listRelatedNotesForTool(note, clampToolLimit(args.limit, 6)) };
  } else if (name === 'search_space_notes') {
    result = { searchResults: await searchSpaceNotesForTool(note, String(args.query ?? ''), clampToolLimit(args.limit, 6)) };
  } else {
    result = { error: `Unsupported tool: ${name}` };
  }

  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  };
}

async function listRelatedNotesForTool(note: Awaited<ReturnType<typeof getNoteContext>>, limit: number) {
  const { data: relations } = await supabase
    .from('relations')
    .select('id, relation_type, source_note_id, target_note_id, created_at')
    .or(`source_note_id.eq.${note.id},target_note_id.eq.${note.id}`)
    .order('created_at', { ascending: false })
    .limit(24);

  const relationRows = relations ?? [];
  const otherIds = Array.from(new Set(relationRows.map((relation: any) =>
    relation.source_note_id === note.id ? relation.target_note_id : relation.source_note_id,
  ))).filter(Boolean).slice(0, 24);
  if (otherIds.length === 0) return [];

  const { data: notes } = await supabase
    .from('notes')
    .select('id, title, content, created_at')
    .in('id', otherIds)
    .is('deleted_at', null);
  const noteMap = new Map((notes ?? []).map((item: any) => [item.id, item]));

  return relationRows
    .map((relation: any) => {
      const direction = relation.source_note_id === note.id ? 'outgoing' : 'incoming';
      const otherId = direction === 'outgoing' ? relation.target_note_id : relation.source_note_id;
      const other = noteMap.get(otherId);
      if (!other) return null;
      return {
        id: other.id,
        title: other.title ?? 'Untitled Note',
        relationType: relation.relation_type,
        direction,
        contentSummary: summarizeForTool(other.content, 360),
        createdAt: other.created_at,
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

async function searchSpaceNotesForTool(note: Awaited<ReturnType<typeof getNoteContext>>, query: string, limit: number) {
  if (!query.trim()) return [];
  const { data: notes } = await supabase
    .from('notes')
    .select('id, title, content, created_at')
    .eq('space_id', note.spaceId)
    .is('deleted_at', null)
    .limit(80);

  return rankSpaceNotesForTool({
    query,
    currentNoteId: note.id,
    notes: notes ?? [],
    limit,
  });
}

async function callConversationAI(params: {
  courseId: string;
  providerId: string;
  model: string;
  /** 调用方已经读过这家的配置行就传进来，省一次查询 */
  config: { api_key_encrypted?: string | null; endpoint_url?: string | null };
  messages: ConversationAIMessage[];
  note: Awaited<ReturnType<typeof getNoteContext>>;
  useWebSearch: boolean;
  agentMode?: ConversationAgentMode;
}): Promise<ConversationAIReply> {
  const { courseId, providerId, model, messages, note, config } = params;
  if (!config.api_key_encrypted) throw new ApiError(404, `Provider "${providerId}" is not configured for this course`);
  const apiKey = decryptProviderApiKey(config.api_key_encrypted);

  const webResults = params.useWebSearch
    ? await getCourseTavilyResults(courseId, messages.at(-1)?.content ?? '', 3).catch(() => [])
    : [];
  const systemSections = [
    'You are a pedagogical GenAI collaborator inside a Knowledge Building note conversation.',
    'Help students clarify ideas, ask probing questions, compare perspectives, and use evidence. Keep answers concise and directly useful.',
    getConversationAgentSpec(params.agentMode).systemInstruction,
    `Current note title: ${note.title}`,
    `Current note content: ${stripHtml(note.content).slice(0, 1200)}`,
  ];
  if (webResults.length > 0) systemSections.push(formatTavilyResultsForPrompt(webResults));
  const systemContent = systemSections.join('\n\n');
  const needsTools = shouldPrepareToolsForAgentMode(params.agentMode) || shouldPrepareConversationTools(messages.at(-1)?.content ?? '');
  const toolPreparation = needsTools && providerId !== 'anthropic' && providerId !== 'google'
    ? await prepareToolMessages({
      providerId,
      model,
      messages,
      systemContent,
      apiKey,
      endpointUrl: config.endpoint_url ?? null,
      note,
    })
    : { messages, toolCalls: [] };
  const aiMessages = toolPreparation.messages;
  const toolsUsed = Array.from(new Set(toolPreparation.toolCalls.map(tool => tool.name)));

  let content: string;

  if (providerId === 'anthropic') {
    content = await callAnthropic(model, aiMessages, systemContent, apiKey);
  } else if (providerId === 'google') {
    content = await callGoogle(model, aiMessages, systemContent, apiKey);
  } else {
    content = await callOpenAICompatible(providerId, model, aiMessages, systemContent, apiKey, config.endpoint_url ?? null);
  }
  return {
    content,
    toolCalls: toolPreparation.toolCalls,
    toolsUsed,
  };
}

async function callOpenAICompatible(
  providerId: string,
  model: string,
  messages: ConversationAIMessage[],
  systemContent: string,
  apiKey: string,
  endpointUrl: string | null,
): Promise<string> {
  if (endpointUrl) await assertSafePublicUrl(endpointUrl);
  const url = endpointUrl ?? getOpenAICompatibleEndpoint(providerId);
  const response = await aiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(withDeepSeekOptions(providerId, model, {
      model,
      messages: [{ role: 'system', content: systemContent }, ...messages],
      max_tokens: NOTE_CONVERSATION_MAX_TOKENS,
      temperature: 0.7,
    })),
  });
  if (!response.ok) throw new ApiError(502, `AI provider error: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content ?? 'No response from AI.';
}

async function callAnthropic(model: string, messages: ConversationAIMessage[], systemContent: string, apiKey: string): Promise<string> {
  const response = await aiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: NOTE_CONVERSATION_MAX_TOKENS, system: systemContent, messages: messages.map((m) => ({ role: m.role, content: m.content ?? '' })) }),
  });
  if (!response.ok) throw new ApiError(502, `AI provider error: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as any;
  return data.content?.[0]?.text ?? 'No response from AI.';
}

async function callGoogle(model: string, messages: ConversationAIMessage[], systemContent: string, apiKey: string): Promise<string> {
  const contents = messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content ?? '' }],
  }));
  const response = await aiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemContent }] },
      contents,
      generationConfig: { maxOutputTokens: NOTE_CONVERSATION_MAX_TOKENS, temperature: 0.7 },
    }),
  });
  if (!response.ok) throw new ApiError(502, `AI provider error: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from AI.';
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getOpenAICompatibleEndpoint(providerId: string): string {
  const endpoints: Record<string, string> = CHAT_ENDPOINTS;
  return endpoints[providerId] ?? endpoints.openai;
}

async function buildConversationStreamRequest(
  providerId: string,
  model: string,
  messages: ConversationAIMessage[],
  systemContent: string,
  apiKey: string,
  endpointUrl: string | null,
  maxTokens: number = NOTE_CONVERSATION_MAX_TOKENS,
): Promise<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> {
  if (providerId === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: maxTokens, stream: true, system: systemContent, messages: messages.map((m) => ({ role: m.role, content: m.content ?? '' })) },
    };
  }

  if (providerId === 'google') {
    const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content ?? '' }] }));
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      headers: { 'Content-Type': 'application/json' },
      body: { system_instruction: { parts: [{ text: systemContent }] }, contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } },
    };
  }

  if (endpointUrl) await assertSafePublicUrl(endpointUrl);
  const url = endpointUrl ?? getOpenAICompatibleEndpoint(providerId);
  return {
    url,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: withDeepSeekOptions(providerId, model, { model, stream: true, messages: [{ role: 'system', content: systemContent }, ...messages], max_tokens: maxTokens, temperature: 0.7 }),
  };
}

function extractConversationStreamToken(providerId: string, json: any): string | null {
  if (providerId === 'anthropic') {
    if (json.type === 'content_block_delta') return json.delta?.text ?? null;
    return null;
  }
  if (providerId === 'google') return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  return json.choices?.[0]?.delta?.content ?? null;
}

/** 这一行是不是在说「写到 max_tokens 停了」 */
export function conversationStreamTruncated(providerId: string, json: any): boolean {
  if (providerId === 'anthropic') return json.type === 'message_delta' && json.delta?.stop_reason === 'max_tokens';
  if (providerId === 'google') return json.candidates?.[0]?.finishReason === 'MAX_TOKENS';
  return json.choices?.[0]?.finish_reason === 'length';
}

function extractConversationReasoning(providerId: string, json: any): string | null {
  if (providerId !== 'deepseek') return null;
  const delta = json.choices?.[0]?.delta;
  return delta?.reasoning_content ?? delta?.reasoning ?? null;
}

export default router;
