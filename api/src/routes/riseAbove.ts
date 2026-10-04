import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureSpaceAccess, isCourseStaff } from '../services/accessControl';
import { segmentNoteContent } from '../services/noteSegments';
import { sanitizeNoteHtml } from '../services/noteHtml';
import { resolveEffectiveCondition } from '../services/experimentCondition';
import { resolveCourseProviderChain, callJson, callChat } from './thinkingTrainer';
import {
  ROOM_AGENTS, buildAgentSystemPrompt, buildNoticeUserPrompt, NOTICE_SYSTEM,
  shouldPostNotice, isStalled, fetchRoomNotes, fetchRoomMessages,
  ROOM_MESSAGE_COLUMNS, toRoomMessage,
  type AgentSlug, type NoticePayload,
} from '../services/riseAboveRoom';

const router = Router();

const isAgent = (v: unknown): v is AgentSlug =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(ROOM_AGENTS, v);

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

async function loadRoom(roomId: string, user: { id: string; role: string }) {
  const { data: room, error } = await supabase
    .from('riseabove_rooms')
    .select('id, space_id, course_id, group_id, created_by, source_note_ids, title, status, published_note_id, card_x, card_y')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new ApiError(404, 'Room not found');
  const { standing } = await ensureSpaceAccess(room.space_id as string, user as any);
  return { room, standing };
}

/** 给模型的笔记块。用 n1/n2 短编号：省 token，模型引用编号比引用 UUID 稳。 */
async function buildNoteBlock(noteIds: string[]) {
  const notes = await fetchRoomNotes(noteIds);
  const keyed = notes.map((n: any, i) => ({
    key: `n${i + 1}`,
    id: n.id as string,
    author: (n.author_name as string) ?? '匿名',
    title: (n.title as string) ?? '',
    body: stripHtml((n.content as string) ?? '').slice(0, 600),
  }));
  return { notes, keyed, backTo: new Map(keyed.map(k => [k.key, k.id])) };
}

type KeyedNote = Awaited<ReturnType<typeof buildNoteBlock>>['keyed'][number];

/**
 * 规则已经放行之后贴那张卡。实验里**只有这一项**分组开关 —— 主动求助（@ AI）两组都保留，
 * 所以被操纵的变量只有「该往哪儿想被不被指出来」。返回贴出去的那条，没贴返回 null。
 */
async function postNotice(params: {
  room: { id: unknown; course_id: unknown };
  userId: string;
  keyed: KeyedNote[];
  turns: any[];
  chain: Awaited<ReturnType<typeof resolveCourseProviderChain>>;
}) {
  const { room, userId, keyed, turns, chain } = params;
  const cfg = chain[0];
  if (!cfg) return null;
  const eff = await resolveEffectiveCondition(room.course_id as string, userId);
  if (eff.condition === 'control') {
    // 对照组照跑判定但不投递，写影子记录留反事实分母
    await supabase.from('riseabove_messages').insert({
      room_id: room.id, sender_kind: 'system',
      content: '', payload: { suppressed: true, reason: 'control_arm', groupId: eff.groupId },
    });
    return null;
  }
  const notice = await callJson(
    cfg, NOTICE_SYSTEM,
    buildNoticeUserPrompt(keyed, turns.slice(-16).map((m: any) => ({
      who: m.sender_kind === 'user' ? '同学' : (ROOM_AGENTS[m.agent_mode as AgentSlug]?.nameZh ?? 'AI'),
      text: m.content,
    }))),
    700, 'chat', chain.slice(1),
  );
  if (!notice || notice.none || !Array.isArray(notice.sides) || notice.sides.length < 2) return null;
  const payload: NoticePayload = {
    topic: String(notice.topic ?? '').slice(0, 120),
    sides: (notice.sides as any[]).slice(0, 4).map(s => ({
      stance: String(s?.stance ?? '').slice(0, 200),
      who: String(s?.who ?? '').slice(0, 60),
      noteIds: Array.isArray(s?.noteIds)
        ? (s.noteIds.map((k: any) => keyed.find(x => x.key === String(k))?.id).filter(Boolean) as string[])
        : [],
    })).filter(s => s.stance),
    question: String(notice.question ?? '').slice(0, 240),
  };
  if (!payload.topic || !payload.question || payload.sides.length < 2) return null;
  const { data: sysMsg } = await supabase
    .from('riseabove_messages')
    .insert({ room_id: room.id, sender_kind: 'system', content: payload.question, payload })
    .select(ROOM_MESSAGE_COLUMNS)
    .single();
  return sysMsg ? toRoomMessage(sysMsg) : null;
}

/**
 * 每一段停滞（以停下来之前最后一条同学发言为准）只判一次。组里几个人同时开着页面，
 * 各自的轮询都会来问；判过「没有分歧」的也不再问模型。单进程，放内存就够。
 */
const idleChecked = new Map<string, number>();
function claimIdleEpisode(key: string): boolean {
  if (idleChecked.has(key)) return false;
  if (idleChecked.size > 500) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [k, at] of idleChecked) if (at < cutoff) idleChecked.delete(k);
  }
  idleChecked.set(key, Date.now());
  return true;
}

// ── 开一间讨论室 ────────────────────────────────────────────────────

router.post('/spaces/:spaceId/riseabove-rooms', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  await ensureSpaceAccess(spaceId, req.user!);

  const noteIds: string[] = Array.isArray(req.body?.source_note_ids)
    ? req.body.source_note_ids.map(String).slice(0, 12) : [];
  if (noteIds.length < 2) throw new ApiError(400, '至少选两条笔记才能开一间讨论室');

  // The room later reads these notes' full text with no space filter, so an
  // unchecked id here is a read primitive for any note on the platform.
  const { data: ownedNotes } = await supabase
    .from('notes').select('id').in('id', noteIds).eq('space_id', spaceId).is('deleted_at', null);
  if ((ownedNotes?.length ?? 0) !== noteIds.length) {
    throw new ApiError(403, '只能选择本空间内的笔记');
  }

  const { data: space } = await supabase
    .from('spaces').select('course_id, group_id').eq('id', spaceId).single();
  if (!space) throw new ApiError(404, 'Space not found');

  const { data: room, error } = await supabase
    .from('riseabove_rooms')
    .insert({
      space_id: spaceId,
      course_id: space.course_id,
      group_id: space.group_id ?? null,
      created_by: req.user!.id,
      source_note_ids: noteIds,
      title: req.body?.title ? String(req.body.title).slice(0, 120) : null,
      card_x: typeof req.body?.card_x === 'number' ? req.body.card_x : null,
      card_y: typeof req.body?.card_y === 'number' ? req.body.card_y : null,
    })
    .select('id, space_id, course_id, group_id, source_note_ids, title, status, created_at')
    .single();
  if (error) throw new ApiError(500, `建讨论室失败：${error.message}`);
  res.status(201).json({ room });
});

router.get('/spaces/:spaceId/riseabove-rooms', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  await ensureSpaceAccess(spaceId, req.user!);
  const { data, error } = await supabase
    .from('riseabove_rooms')
    .select('id, source_note_ids, title, status, published_note_id, card_x, card_y, created_at')
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(500, error.message);
  res.json({ rooms: data ?? [] });
});

/** 一间讨论室的全部内容：顶置笔记 + 消息流 + 五个 AI 同学 */
router.get('/riseabove-rooms/:id', verifyJWT, async (req: Request, res: Response) => {
  const { room, standing } = await loadRoom(String(req.params.id), req.user!);
  const [{ notes }, messages] = await Promise.all([
    buildNoteBlock(room.source_note_ids as string[]),
    fetchRoomMessages(room.id as string),
  ]);
  res.json({
    room,
    sourceNotes: notes,
    messages,
    agents: Object.entries(ROOM_AGENTS).map(([id, a]) => ({
      id, nameZh: a.nameZh, nameEn: a.nameEn,
      habitZh: a.habitZh, habitEn: a.habitEn, avatar: a.avatar,
    })),
    // 用服务器的时钟判，页面看到 true 再来 POST idle-check
    stalled: room.status !== 'published' && isStalled(messages as any),
    // 与发布接口同一条规则，页面据此决定给不给「发布」按钮
    canPublish: room.created_by === req.user!.id || isCourseStaff(standing),
  });
});

/**
 * POST /api/riseabove-rooms/:id/idle-check
 *
 * 讨论停下来一阵子后，由开着讨论室的页面来问一句要不要贴卡。服务器重判一遍规则，
 * 每段停滞最多判一次。课程职员（开课教师、课程管理员）来问不算：旁观一间讨论室，
 * 不该因此往里贴东西。
 */
router.post('/riseabove-rooms/:id/idle-check', verifyJWT, async (req: Request, res: Response) => {
  const { room, standing } = await loadRoom(String(req.params.id), req.user!);
  if (room.status === 'published' || isCourseStaff(standing)) {
    res.json({ messages: [] });
    return;
  }
  const history = await fetchRoomMessages(room.id as string);
  if (!isStalled(history as any)) {
    res.json({ messages: [] });
    return;
  }
  const lastStudent = [...history].reverse().find((m: any) => m.sender_kind === 'user');
  const episode = `${room.id}:${lastStudent?.id ?? ''}`;
  if (!claimIdleEpisode(episode)) {
    res.json({ messages: [] });
    return;
  }
  try {
    const chain = await resolveCourseProviderChain(String(room.course_id), 'riseabove_room');
    const { keyed } = await buildNoteBlock(room.source_note_ids as string[]);
    const sysMsg = await postNotice({ room, userId: req.user!.id, keyed, turns: history, chain });
    res.json({ messages: sysMsg ? [sysMsg] : [] });
  } catch (err) {
    // 模型调用失败不算判过，下次打开页面还能再问
    idleChecked.delete(episode);
    throw err;
  }
});

// ── 发言 ────────────────────────────────────────────────────────────

/**
 * POST /api/riseabove-rooms/:id/messages
 *
 * 学生发一条。若 @ 了某个 AI 同学，同一次请求里把它的回应也生成好。
 * 之后按规则判断要不要贴那张「系统注意到的」卡。
 */
router.post('/riseabove-rooms/:id/messages', verifyJWT, async (req: Request, res: Response) => {
  const { room } = await loadRoom(String(req.params.id), req.user!);
  const content = String(req.body?.content ?? '').trim();
  if (!content) throw new ApiError(400, 'content required');
  const mention = isAgent(req.body?.mention) ? (req.body.mention as AgentSlug) : null;

  const { data: mine, error: insErr } = await supabase
    .from('riseabove_messages')
    .insert({ room_id: room.id, sender_id: req.user!.id, sender_kind: 'user', content })
    .select(ROOM_MESSAGE_COLUMNS)
    .single();
  if (insErr) throw new ApiError(500, insErr.message);

  const out: any[] = [toRoomMessage(mine)];
  const { keyed } = await buildNoteBlock(room.source_note_ids as string[]);
  const history = await fetchRoomMessages(room.id as string);
  const chain = await resolveCourseProviderChain(String(room.course_id), 'riseabove_room');
  const cfg = chain[0] ?? null;

  // ① 被 @ 的 AI 同学发言
  if (mention && cfg) {
    const noteBlock = keyed.map(k => `[${k.key}] ${k.author}：${k.title}\n${k.body}`).join('\n\n');
    const turns = history.slice(-14)
      .map((m: any) => `${m.sender_kind === 'ai' ? (ROOM_AGENTS[m.agent_mode as AgentSlug]?.nameZh ?? 'AI') : '同学'}：${m.content}`)
      .join('\n');
    const reply = await callChat(
      cfg,
      buildAgentSystemPrompt(mention),
      `正在讨论的笔记：\n\n${noteBlock}\n\n———\n\n对话：\n${turns}`,
      420, 'chat', chain.slice(1),
    );
    if (reply) {
      const { data: aiMsg } = await supabase
        .from('riseabove_messages')
        .insert({ room_id: room.id, sender_kind: 'ai', agent_mode: mention, content: reply.slice(0, 1200) })
        .select(ROOM_MESSAGE_COLUMNS)
        .single();
      if (aiMsg) out.push(toRoomMessage(aiMsg));
    }
  }

  // ② 那张卡（停滞那一条这里判不到，见 idle-check）
  const allMsgs = [...history, ...out.slice(1)];
  if (cfg && shouldPostNotice(allMsgs as any)) {
    const sysMsg = await postNotice({ room, userId: req.user!.id, keyed, turns: allMsgs, chain });
    if (sysMsg) out.push(sysMsg);
  }

  res.json({ messages: out });
});

// ── 发布提升 ────────────────────────────────────────────────────────

/**
 * 学生写完那句更高一层的说法，发布成画布上一条新笔记。
 *
 * 这一步**没有任何 AI 参与** —— title 和 content 完全来自学生输入。
 * cited_note_ids 把来源笔记收进这条里，Knowledge Forum 的 rise-above 笔记
 * 本来就是「包含它所超越的那些笔记」。
 */
router.post('/riseabove-rooms/:id/publish', verifyJWT, async (req: Request, res: Response) => {
  const { room, standing } = await loadRoom(String(req.params.id), req.user!);
  if (room.status === 'published') throw new ApiError(409, '这间讨论室已经发布过了');
  // loadRoom only proves you can see the space. The published note is authored
  // under the caller's name, so without this any classmate could publish
  // someone else's discussion as their own work. Course staff still may; a
  // teacher account that is only a member of this course may not.
  if (room.created_by !== req.user!.id && !isCourseStaff(standing)) {
    throw new ApiError(403, '只有开这间讨论室的人可以发布它');
  }

  const title = String(req.body?.title ?? '').trim();
  if (!title) throw new ApiError(400, '给这条提升写个标题');
  const content = await sanitizeNoteHtml(String(req.body?.content ?? '').trim());
  if (content.length < 20) throw new ApiError(400, '正文再写具体一点');

  const riseAboveSegments = segmentNoteContent(content);

  const { data: note, error: noteErr } = await supabase
    .from('notes')
    .insert({
      content_segments: riseAboveSegments.segments,
      segment_stats: riseAboveSegments.stats,
      space_id: room.space_id,
      course_id: room.course_id,
      author_id: req.user!.id,
      author_name: (req.user as any)?.name ?? null,
      type: 'riseabove',
      title: title.slice(0, 200),
      content,
      cited_note_ids: room.source_note_ids,
      x: room.card_x ?? 0,
      y: room.card_y ?? 0,
      is_ai_generated: false,
    })
    .select('id, title')
    .single();
  if (noteErr) throw new ApiError(500, `发布失败：${noteErr.message}`);

  // 连回每一条来源笔记，画布上看得见这条是从哪来的
  const rels = (room.source_note_ids as string[]).map(src => ({
    source_note_id: src,
    target_note_id: note.id,
    relation_type: 'synthesize',
    creator_id: req.user!.id,
    space_id: room.space_id,
  }));
  if (rels.length) await supabase.from('relations').insert(rels);

  await supabase.from('riseabove_rooms')
    .update({ status: 'published', published_note_id: note.id, updated_at: new Date().toISOString() })
    .eq('id', room.id);

  res.json({ note });
});

export default router;
