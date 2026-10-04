/**
 * 图灵测试（群聊版，2026-09-14）
 *
 * 教师在知识空间里设置一场活动。学生进入后，教师点开始：进来的学生被随机分成若干个群，
 * 每群混入设定数量的 AI「同学」，所有人用同一个化名池随机起名。限时聊完，每个学生对群里
 * 其他每一位判「人」或「AI」并写线索；教师公布答案后，学生可以把群聊和自己的判断发布成笔记。
 * AI 什么时候说、说什么、怎么判分的规则在 services/turingTestAi.ts。
 *
 * 教师：
 *   POST   /turing-test/:courseId                             新建（草稿）
 *   PUT    /turing-test/:courseId/:id                         改设置（草稿/开放时）
 *   DELETE /turing-test/:courseId/:id
 *   PUT    /turing-test/:courseId/:id/status                  draft→open→chatting→voting→revealed→completed（open 可退回 draft）
 *   GET    /turing-test/:courseId/:id/overview                进入名单、分群、每群消息数、判断数（带真名）
 *   GET    /turing-test/:courseId/:id/rooms/:roomId/messages  旁观某个群
 * 学生：
 *   GET    /turing-test/:courseId                             列表（学生只看到已开放的）
 *   POST   /turing-test/:courseId/:id/join
 *   GET    /turing-test/:courseId/:id/me?after=               我的群、化名、成员、消息、判断
 *   POST   /turing-test/:courseId/:id/message
 *   POST   /turing-test/:courseId/:id/judgment
 *   POST   /turing-test/:courseId/:id/publish-note
 * 两端：
 *   GET    /turing-test/:courseId/:id/results                 公布答案后（教师随时）
 *
 * 公布答案前，接口从不向学生返回 is_ai、真人的 user_id 或加入时间（AI 是开始时才建的，
 * 加入时间会直接露馅）。数据库层面这些表不开放任何直接访问（migration 059）。
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureSpaceAccess } from '../services/accessControl';
import { sanitizeNoteHtml } from '../services/noteHtml';
import { TtlCache } from '../services/ttlCache';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  DEFAULT_PERSONAS,
  TURING_LINE_PERCENT,
  type AiPersona,
  type RoomMember,
  type RoomMessage,
  type UtteranceMode,
  generateGroupUtterance,
  humanLikeDelayMs,
  makeAliasGenerator,
  pickAiSpeaker,
  pickLullSpeaker,
  resolveActivityProvider,
  scoreJudgment,
  shuffle,
  splitIntoRooms,
} from '../services/turingTestAi';

const router = Router();

type Status = 'draft' | 'open' | 'chatting' | 'voting' | 'revealed' | 'completed';

interface ActivityRow {
  id: string;
  course_id: string;
  created_by: string;
  title: string;
  topic: string;
  instructions: string | null;
  status: Status;
  chat_minutes: number;
  room_size: number;
  ai_per_room: number;
  disclose_ai_count: boolean;
  ai_provider: string | null;
  ai_model: string | null;
  config: { persona?: AiPersona } | null;
  started_at: string | null;
  ends_at: string | null;
  revealed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  id: string;
  alias: string;
  is_ai: boolean;
  user_id: string | null;
  ai_persona: AiPersona | null;
}

interface MessageRow {
  id: string;
  participant_id: string;
  content: string;
  visible_at: string;
}

interface MyParticipant {
  id: string;
  alias: string;
  room_id: string | null;
}

const STUDENT_VISIBLE: Status[] = ['open', 'chatting', 'voting', 'revealed'];
const VALID_TRANSITIONS: Record<Status, Status[]> = {
  draft: ['open'],
  open: ['draft', 'chatting'],
  chatting: ['voting'],
  voting: ['revealed'],
  revealed: ['completed'],
  completed: [],
};

export const DEFAULT_INSTRUCTIONS = [
  '活动目标：通过亲身体验，理解「模仿智能」与「真正智能」的边界。',
  '',
  '操作方式：你会进入一个匿名群聊。群里每个人都用随机化名，其中混着大语言模型扮演的「同学」。在规定时间内围绕话题自由聊天、自由提问，时间到后判断群里每一位是人还是 AI。',
  '',
  '规则：只在群里交流。对话期间不要在教室里说话、不要看别人的屏幕，也不要在群里透露真实姓名、学号或座位。能在群外核实的线索会让测试失去意义。',
  '',
  '公布答案后一起讨论：你判断的依据是什么？你被「骗」了吗？被骗是因为 AI 太「聪明」还是你太容易「相信」？有没有真人被当成了 AI？',
  '',
  '判断时请写出至少两个具体线索，说明你如何区分了 AI 与人类的对话风格。',
].join('\n');

// ── 小工具 ───────────────────────────────────────────────────────────

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parsePersona(value: unknown): AiPersona | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const style = typeof v.style === 'string' ? v.style.trim().slice(0, 200) : '';
  const quirks = typeof v.quirks === 'string' ? v.quirks.trim().slice(0, 200) : '';
  return style ? { style, quirks } : null;
}

function textOr(value: unknown, fallback: string, max: number): string {
  return (typeof value === 'string' && value.trim() ? value.trim() : fallback).slice(0, max);
}

/** undefined 表示没传，用默认值；空串表示教师选了「自动」，存 null。 */
function optionalId(value: unknown, fallback: string): string | null {
  if (value === undefined) return fallback;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function loadNames(userIds: Array<string | null | undefined>): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((x): x is string => Boolean(x))));
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('id, full_name').in('id', ids);
  return new Map(((data ?? []) as Array<{ id: string; full_name: string | null }>).map(p => [p.id, p.full_name ?? '（未命名）']));
}

// ── 权限与缓存 ───────────────────────────────────────────────────────

// 课内角色缓存 30 秒：学生对话时每 2 秒轮询一次，每次都查两张表太费。
// 和 accessControl 的成员缓存同一个口径（撤销后最多再有效 30 秒）。
const roleCache = new TtlCache<'teacher' | 'student'>(30_000, 20_000);

async function requireCourseMember(courseId: string, req: Request): Promise<'teacher' | 'student' | 'admin'> {
  if (!req.user) throw new ApiError(401, 'Auth required');
  if (req.user.role === 'admin') return 'admin';
  const key = `${courseId}|${req.user.id}`;
  const cached = roleCache.get(key);
  if (cached) return cached;
  const [memberRes, instructorRes] = await Promise.all([
    supabase.from('course_members').select('role').eq('course_id', courseId).eq('user_id', req.user.id).maybeSingle(),
    supabase.from('courses').select('id').eq('id', courseId).eq('instructor_id', req.user.id).maybeSingle(),
  ]);
  if (memberRes.error || instructorRes.error) throw new ApiError(503, 'Service temporarily unavailable, please retry');
  let role: 'teacher' | 'student' | null = null;
  if (instructorRes.data) {
    role = 'teacher';
  } else if (memberRes.data) {
    const r = (memberRes.data as { role?: string }).role;
    role = r === 'teacher' || r === 'admin' ? 'teacher' : 'student';
  }
  if (!role) throw new ApiError(403, 'Not a member of this course');
  roleCache.set(key, role);
  return role;
}

async function requireTeacher(courseId: string, req: Request): Promise<void> {
  const role = await requireCourseMember(courseId, req);
  if (role === 'student') throw new ApiError(403, 'Teacher role required');
}

const activityCache = new TtlCache<ActivityRow>(2_000, 1_000);

async function loadActivity(courseId: string, activityId: string, opts: { fresh?: boolean } = {}): Promise<ActivityRow> {
  let activity = opts.fresh ? undefined : activityCache.get(activityId);
  if (!activity) {
    const { data } = await supabase.from('turing_test_activities').select('*').eq('id', activityId).maybeSingle();
    if (data) {
      activity = data as ActivityRow;
      activityCache.set(activityId, activity);
    }
  }
  if (!activity || activity.course_id !== courseId) throw new ApiError(404, 'Activity not found');
  return activity;
}

// 分群之后「我在哪个群、叫什么」整场不变，缓存；分群之前不缓存（开始时会改）
const myParticipantCache = new TtlCache<MyParticipant>(60_000, 20_000);

async function loadMyParticipant(activityId: string, userId: string): Promise<MyParticipant | null> {
  const key = `${activityId}|${userId}`;
  const hit = myParticipantCache.get(key);
  if (hit) return hit;
  const { data } = await supabase
    .from('turing_test_participants')
    .select('id, alias, room_id')
    .eq('activity_id', activityId)
    .eq('user_id', userId)
    .eq('is_ai', false)
    .maybeSingle();
  if (!data) return null;
  const row = data as MyParticipant;
  if (row.room_id) myParticipantCache.set(key, row);
  return row;
}

const roomMembersCache = new TtlCache<MemberRow[]>(60_000, 2_000);

async function loadRoomMembers(roomId: string): Promise<MemberRow[]> {
  const hit = roomMembersCache.get(roomId);
  if (hit) return hit;
  const { data } = await supabase
    .from('turing_test_participants')
    .select('id, alias, is_ai, user_id, ai_persona')
    .eq('room_id', roomId);
  const rows = (data ?? []) as MemberRow[];
  if (rows.length > 0) roomMembersCache.set(roomId, rows);
  return rows;
}

/** 最近的若干条消息，按显示时间升序。默认只要已经到显示时间的。 */
async function loadRoomMessages(
  roomId: string,
  opts: { includeFuture?: boolean; after?: string | null; limit?: number } = {},
): Promise<MessageRow[]> {
  let q = supabase
    .from('turing_test_messages')
    .select('id, participant_id, content, visible_at')
    .eq('room_id', roomId);
  if (!opts.includeFuture) q = q.lte('visible_at', new Date().toISOString());
  // 按时间戳续拉会漏掉「时间戳更早、但晚一点才提交」的消息，往前多拉 5 秒由前端按 id 去重
  if (opts.after) q = q.gt('visible_at', new Date(Date.parse(opts.after) - 5_000).toISOString());
  const { data } = await q.order('visible_at', { ascending: false }).limit(opts.limit ?? 400);
  return ((data ?? []) as MessageRow[]).reverse();
}

const toMembers = (rows: MemberRow[]): RoomMember[] => rows.map(r => ({ id: r.id, alias: r.alias, isAi: r.is_ai }));
const toMessages = (rows: MessageRow[]): RoomMessage[] =>
  rows.map(r => ({ id: r.id, participantId: r.participant_id, content: r.content, visibleAt: Date.parse(r.visible_at) }));

// ── AI 调度：什么时候有 AI 接话 ────────────────────────────────────────
//
// 单进程内存状态。重启会丢掉冷场/开场计时器，但真人一说话照样会触发回复。

const LULL_MS = 45_000;
const roomBusy = new Set<string>();
const roomDirty = new Set<string>();
const consideredBy = new Map<string, string>();
const recheckTimers = new Map<string, NodeJS.Timeout>();
const lullTimers = new Map<string, NodeJS.Timeout>();

function schedule(timers: Map<string, NodeJS.Timeout>, key: string, ms: number, fn: () => void): void {
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    timers.delete(key);
    fn();
  }, Math.max(0, ms));
  t.unref();
  timers.set(key, t);
}

async function activityStillChatting(activityId: string): Promise<ActivityRow | null> {
  const { data } = await supabase.from('turing_test_activities').select('*').eq('id', activityId).maybeSingle();
  const activity = data as ActivityRow | null;
  if (!activity || activity.status !== 'chatting') return null;
  const endsAt = activity.ends_at ? Date.parse(activity.ends_at) : Number.POSITIVE_INFINITY;
  return Date.now() < endsAt ? activity : null;
}

async function speak(
  activity: ActivityRow,
  roomId: string,
  members: MemberRow[],
  messages: MessageRow[],
  aiId: string,
  mode: UtteranceMode,
  incomingChars: number,
): Promise<void> {
  const ai = members.find(m => m.id === aiId && m.is_ai);
  if (!ai) return;
  const provider = await resolveActivityProvider(activity.course_id, { providerId: activity.ai_provider, model: activity.ai_model });
  if (!provider) {
    console.warn(`[turingTest] course ${activity.course_id} has no AI provider configured`);
    return;
  }
  const now = Date.now();
  const aliasOf = new Map(members.map(m => [m.id, m.alias]));
  const visible = messages.filter(m => Date.parse(m.visible_at) <= now);
  const startedAt = Date.now();
  const text = await generateGroupUtterance(provider, {
    topic: activity.topic,
    alias: ai.alias,
    persona: ai.ai_persona ?? DEFAULT_PERSONAS[0],
    memberAliases: shuffle(members.map(m => m.alias)),
    transcript: visible.slice(-30).map(m => ({ alias: aliasOf.get(m.participant_id) ?? '?', content: m.content, self: m.participant_id === ai.id })),
    mode,
    recentOwn: visible.filter(m => m.participant_id === ai.id).slice(-3).map(m => m.content),
  });
  if (!text) return;

  const current = await activityStillChatting(activity.id);
  if (!current || !current.ends_at) return;
  const delay = humanLikeDelayMs(incomingChars, text.length);
  const lastVisible = messages.reduce((max, m) => Math.max(max, Date.parse(m.visible_at)), 0);
  const visibleAt = Math.max(Date.now() + 800, startedAt + delay, lastVisible + 800);
  if (visibleAt >= Date.parse(current.ends_at)) return;

  const { data: inserted, error } = await supabase
    .from('turing_test_messages')
    .insert({
      activity_id: activity.id,
      room_id: roomId,
      participant_id: ai.id,
      round_number: 1,
      content: text,
      visible_at: new Date(visibleAt).toISOString(),
    })
    .select('id')
    .single();
  if (error || !inserted) {
    console.error('[turingTest] insert AI message failed:', error?.message);
    return;
  }
  const wait = visibleAt - Date.now();
  // 这句显示出来之后再看一次：它「打字」期间别人说的话也要有机会被接
  schedule(recheckTimers, roomId, wait + 1_500, () => void evaluateRoom(activity.id, roomId));
  schedule(lullTimers, roomId, wait + LULL_MS, () => void lullCheck(activity.id, roomId, (inserted as { id: string }).id));
}

function releaseRoom(activityId: string, roomId: string): void {
  roomBusy.delete(roomId);
  if (roomDirty.delete(roomId)) {
    setTimeout(() => void evaluateRoom(activityId, roomId), 300).unref();
  }
}

async function evaluateRoom(activityId: string, roomId: string): Promise<void> {
  if (roomBusy.has(roomId)) {
    roomDirty.add(roomId);
    return;
  }
  roomBusy.add(roomId);
  try {
    const activity = await activityStillChatting(activityId);
    if (!activity) return;
    const [members, messages] = await Promise.all([
      loadRoomMembers(roomId),
      loadRoomMessages(roomId, { includeFuture: true, limit: 80 }),
    ]);
    const decision = pickAiSpeaker({
      now: Date.now(),
      members: toMembers(members),
      messages: toMessages(messages),
      lastConsidered: id => consideredBy.get(id),
    });
    for (const c of decision.considered) consideredBy.set(c.aiId, c.humanMessageId);
    if (decision.recheckInMs !== null) {
      schedule(recheckTimers, roomId, decision.recheckInMs, () => void evaluateRoom(activityId, roomId));
    }
    if (decision.speaker) {
      await speak(activity, roomId, members, messages, decision.speaker.aiId, 'reply', decision.speaker.incomingChars);
    }
  } catch (err) {
    console.error('[turingTest] evaluateRoom failed:', err instanceof Error ? err.message : err);
  } finally {
    releaseRoom(activityId, roomId);
  }
}

/**
 * 冷场检查。anchorId 为 null 表示「开场」：群里还没人说话时，六成概率由一个 AI 先开口。
 * 否则只有 anchor 仍是最后一条、且已经安静了一阵，才有四成概率让一个发言不多的 AI 随口说一句。
 */
async function lullCheck(activityId: string, roomId: string, anchorId: string | null): Promise<void> {
  if (roomBusy.has(roomId)) return;
  roomBusy.add(roomId);
  try {
    const activity = await activityStillChatting(activityId);
    if (!activity || !activity.ends_at) return;
    if (Date.parse(activity.ends_at) - Date.now() < 25_000) return;
    const [members, messages] = await Promise.all([
      loadRoomMembers(roomId),
      loadRoomMessages(roomId, { includeFuture: true, limit: 80 }),
    ]);
    const last = messages[messages.length - 1];

    if (anchorId === null) {
      if (last) return;
      if (Math.random() > 0.6) {
        schedule(lullTimers, roomId, LULL_MS, () => void lullCheck(activityId, roomId, null));
        return;
      }
      const aiIds = members.filter(m => m.is_ai).map(m => m.id);
      if (aiIds.length === 0) return;
      await speak(activity, roomId, members, messages, shuffle(aiIds)[0], 'open', 0);
      return;
    }

    if (!last || last.id !== anchorId) return;
    if (Date.parse(last.visible_at) > Date.now() - (LULL_MS - 2_000)) return;
    if (Math.random() > 0.4) return;
    const aiId = pickLullSpeaker(toMembers(members), toMessages(messages));
    if (!aiId) return;
    await speak(activity, roomId, members, messages, aiId, 'lull', 0);
  } catch (err) {
    console.error('[turingTest] lullCheck failed:', err instanceof Error ? err.message : err);
  } finally {
    releaseRoom(activityId, roomId);
  }
}

// ── 开始：分群、起化名、放 AI ─────────────────────────────────────────

async function startChatting(activity: ActivityRow): Promise<{ rooms: number; students: number; ais: number; roomIds: string[] }> {
  const { data: joined, error } = await supabase
    .from('turing_test_participants')
    .select('user_id')
    .eq('activity_id', activity.id)
    .eq('is_ai', false)
    .not('user_id', 'is', null);
  if (error) throw new ApiError(500, error.message);
  const ids = Array.from(new Set(((joined ?? []) as Array<{ user_id: string }>).map(r => r.user_id)));
  if (ids.length < 2) throw new ApiError(400, '至少要 2 名学生进入才能开始');

  // 上次开始失败留下的半截分群先清掉，保证可以重试
  await supabase.from('turing_test_participants').delete().eq('activity_id', activity.id).eq('is_ai', true);
  await supabase.from('turing_test_rooms').delete().eq('activity_id', activity.id);

  const groups = splitIntoRooms(ids, activity.room_size ?? 6);
  const aiPerRoom = clampInt(activity.ai_per_room, 1, 1, 3);
  const base = activity.config?.persona ?? DEFAULT_PERSONAS[0];
  const presetIdx = Math.max(0, DEFAULT_PERSONAS.findIndex(p => p.style === base.style));
  const personaFor = (k: number): AiPersona => (k === 0 ? base : DEFAULT_PERSONAS[(presetIdx + k) % DEFAULT_PERSONAS.length]);

  const { data: rooms, error: roomErr } = await supabase
    .from('turing_test_rooms')
    .insert(groups.map((_, i) => ({ activity_id: activity.id, room_no: i + 1 })))
    .select('id, room_no');
  if (roomErr || !rooms) throw new ApiError(500, roomErr?.message ?? 'Failed to create rooms');
  const roomIdByNo = new Map((rooms as Array<{ id: string; room_no: number }>).map(r => [r.room_no, r.id]));

  // 真人和 AI 混在一起打乱后再依次起名，化名的先后看不出谁是谁
  const nextAlias = makeAliasGenerator();
  const humanRows: Array<Record<string, unknown>> = [];
  const aiRows: Array<Record<string, unknown>> = [];
  groups.forEach((group, i) => {
    const roomId = roomIdByNo.get(i + 1);
    const slots = shuffle([
      ...group.map(uid => ({ kind: 'human' as const, uid, k: 0 })),
      ...Array.from({ length: aiPerRoom }, (_, k) => ({ kind: 'ai' as const, uid: '', k })),
    ]);
    for (const slot of slots) {
      const alias = nextAlias();
      if (slot.kind === 'human') {
        humanRows.push({ activity_id: activity.id, user_id: slot.uid, alias, is_ai: false, room_id: roomId });
      } else {
        aiRows.push({ activity_id: activity.id, user_id: null, alias, is_ai: true, ai_persona: personaFor(slot.k), room_id: roomId });
      }
    }
  });

  const { error: humanErr } = await supabase.from('turing_test_participants').upsert(humanRows, { onConflict: 'activity_id,user_id' });
  if (humanErr) throw new ApiError(500, humanErr.message);
  const { error: aiErr } = await supabase.from('turing_test_participants').insert(aiRows);
  if (aiErr) throw new ApiError(500, aiErr.message);

  myParticipantCache.clear();
  roomMembersCache.clear();
  return { rooms: rooms.length, students: ids.length, ais: aiRows.length, roomIds: (rooms as Array<{ id: string }>).map(r => r.id) };
}

/** 公布答案时给每份判断打分，存下来供研究导出。 */
async function scoreAll(activityId: string): Promise<void> {
  const [partsRes, votesRes, judgmentsRes] = await Promise.all([
    supabase.from('turing_test_participants').select('id, user_id, is_ai, alias, room_id').eq('activity_id', activityId).not('room_id', 'is', null),
    supabase.from('turing_test_votes').select('voter_id, participant_id, vote').eq('activity_id', activityId),
    supabase.from('turing_test_judgments').select('student_id').eq('activity_id', activityId).eq('submitted', true),
  ]);
  const parts = (partsRes.data ?? []) as Array<{ id: string; user_id: string | null; is_ai: boolean; alias: string; room_id: string }>;
  const votes = (votesRes.data ?? []) as Array<{ voter_id: string; participant_id: string; vote: 'human' | 'ai' }>;
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const j of (judgmentsRes.data ?? []) as Array<{ student_id: string }>) {
    const me = parts.find(p => p.user_id === j.student_id && !p.is_ai);
    if (!me) continue;
    const others = parts.filter(p => p.room_id === me.room_id && p.id !== me.id).map(p => ({ id: p.id, alias: p.alias, isAi: p.is_ai }));
    const mine = new Map(votes.filter(v => v.voter_id === j.student_id).map(v => [v.participant_id, v.vote]));
    const s = scoreJudgment(mine, others);
    rows.push({ activity_id: activityId, student_id: j.student_id, correct: s.correct, total: s.total, found_all_ai: s.foundAllAi, updated_at: now });
  }
  if (rows.length > 0) {
    const { error } = await supabase.from('turing_test_judgments').upsert(rows, { onConflict: 'activity_id,student_id' });
    if (error) throw new ApiError(500, error.message);
  }
}

// ── 教师：建、改、删、推进、总览、旁观 ─────────────────────────────────

router.post('/turing-test/:courseId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacher(courseId, req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  if (!title || !topic) throw new ApiError(400, 'title and topic are required');

  const { data, error } = await supabase
    .from('turing_test_activities')
    .insert({
      course_id: courseId,
      created_by: req.user!.id,
      title: title.slice(0, 120),
      topic: topic.slice(0, 300),
      instructions: textOr(body.instructions, DEFAULT_INSTRUCTIONS, 4000),
      ai_provider: optionalId(body.ai_provider, DEFAULT_AI_PROVIDER),
      ai_model: optionalId(body.ai_model, DEFAULT_AI_MODEL),
      chat_minutes: clampInt(body.chat_minutes, 5, 2, 30),
      room_size: clampInt(body.room_size, 6, 2, 12),
      ai_per_room: clampInt(body.ai_per_room, 1, 1, 3),
      disclose_ai_count: typeof body.disclose_ai_count === 'boolean' ? body.disclose_ai_count : true,
      config: { persona: parsePersona(body.persona) ?? DEFAULT_PERSONAS[0] },
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, error.message);
  res.json({ activity: data });
});

router.put('/turing-test/:courseId/:id', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacher(courseId, req);
  const activity = await loadActivity(courseId, String(req.params.id), { fresh: true });
  if (activity.status !== 'draft' && activity.status !== 'open') throw new ApiError(400, '活动已开始，不能再改设置');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === 'string' && body.title.trim()) updates.title = body.title.trim().slice(0, 120);
  if (typeof body.topic === 'string' && body.topic.trim()) updates.topic = body.topic.trim().slice(0, 300);
  if (body.instructions !== undefined) updates.instructions = textOr(body.instructions, DEFAULT_INSTRUCTIONS, 4000);
  if (body.ai_provider !== undefined) updates.ai_provider = optionalId(body.ai_provider, DEFAULT_AI_PROVIDER);
  if (body.ai_model !== undefined) updates.ai_model = optionalId(body.ai_model, DEFAULT_AI_MODEL);
  if (body.chat_minutes !== undefined) updates.chat_minutes = clampInt(body.chat_minutes, 5, 2, 30);
  if (body.room_size !== undefined) updates.room_size = clampInt(body.room_size, 6, 2, 12);
  if (body.ai_per_room !== undefined) updates.ai_per_room = clampInt(body.ai_per_room, 1, 1, 3);
  if (typeof body.disclose_ai_count === 'boolean') updates.disclose_ai_count = body.disclose_ai_count;
  const persona = parsePersona(body.persona);
  if (persona) updates.config = { ...(activity.config ?? {}), persona };

  const { data, error } = await supabase.from('turing_test_activities').update(updates).eq('id', activity.id).select('*').single();
  if (error) throw new ApiError(500, error.message);
  activityCache.delete(activity.id);
  res.json({ activity: data });
});

router.delete('/turing-test/:courseId/:id', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacher(courseId, req);
  const activity = await loadActivity(courseId, String(req.params.id), { fresh: true });
  const { error } = await supabase.from('turing_test_activities').delete().eq('id', activity.id);
  if (error) throw new ApiError(500, error.message);
  activityCache.delete(activity.id);
  res.json({ ok: true });
});

router.put('/turing-test/:courseId/:id/status', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacher(courseId, req);
  const activity = await loadActivity(courseId, String(req.params.id), { fresh: true });
  const next = (req.body ?? {}).status as Status | undefined;
  if (!next || !(VALID_TRANSITIONS[activity.status] ?? []).includes(next)) {
    throw new ApiError(400, `Cannot transition from ${activity.status} to ${next}`);
  }
  const updates: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
  let started: Awaited<ReturnType<typeof startChatting>> | null = null;
  if (next === 'chatting') {
    started = await startChatting(activity);
    const now = Date.now();
    updates.started_at = new Date(now).toISOString();
    updates.ends_at = new Date(now + (activity.chat_minutes ?? 5) * 60_000).toISOString();
  }
  if (next === 'revealed') {
    await scoreAll(activity.id);
    updates.revealed_at = new Date().toISOString();
  }
  const { data, error } = await supabase.from('turing_test_activities').update(updates).eq('id', activity.id).select('*').single();
  if (error) throw new ApiError(500, error.message);
  activityCache.delete(activity.id);

  if (started) {
    // 开场：各群 8–30 秒后看一眼，还没人说话就可能由 AI 先开口
    for (const roomId of started.roomIds) {
      schedule(lullTimers, roomId, 8_000 + Math.random() * 22_000, () => void lullCheck(activity.id, roomId, null));
    }
  }
  res.json({ activity: data, started: started ? { rooms: started.rooms, students: started.students, ais: started.ais } : null });
});

router.get('/turing-test/:courseId/:id/overview', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacher(courseId, req);
  const activity = await loadActivity(courseId, String(req.params.id), { fresh: true });

  const [partsRes, roomsRes, msgsRes, judgmentsRes] = await Promise.all([
    supabase.from('turing_test_participants').select('id, alias, is_ai, user_id, room_id').eq('activity_id', activity.id),
    supabase.from('turing_test_rooms').select('id, room_no').eq('activity_id', activity.id).order('room_no', { ascending: true }),
    supabase.from('turing_test_messages').select('room_id, participant_id').eq('activity_id', activity.id).not('room_id', 'is', null).lte('visible_at', new Date().toISOString()),
    supabase.from('turing_test_judgments').select('student_id, submitted, published_note_id').eq('activity_id', activity.id),
  ]);
  const parts = (partsRes.data ?? []) as Array<{ id: string; alias: string; is_ai: boolean; user_id: string | null; room_id: string | null }>;
  const rooms = (roomsRes.data ?? []) as Array<{ id: string; room_no: number }>;
  const msgs = (msgsRes.data ?? []) as Array<{ room_id: string; participant_id: string }>;
  const judgments = (judgmentsRes.data ?? []) as Array<{ student_id: string; submitted: boolean; published_note_id: string | null }>;
  const nameOf = await loadNames(parts.map(p => p.user_id));
  const aiIds = new Set(parts.filter(p => p.is_ai).map(p => p.id));
  const judged = new Set(judgments.filter(j => j.submitted).map(j => j.student_id));

  res.json({
    activity,
    joined: parts
      .filter(p => !p.is_ai && p.user_id)
      .map(p => ({ user_id: p.user_id as string, name: nameOf.get(p.user_id as string) ?? '（未命名）' })),
    rooms: rooms.map(r => ({
      id: r.id,
      room_no: r.room_no,
      members: parts
        .filter(p => p.room_id === r.id)
        .sort((a, b) => a.alias.localeCompare(b.alias, 'zh'))
        .map(p => ({
          id: p.id,
          alias: p.alias,
          is_ai: p.is_ai,
          name: p.user_id ? (nameOf.get(p.user_id) ?? '（未命名）') : null,
          judged: p.user_id ? judged.has(p.user_id) : false,
        })),
      messages: {
        human: msgs.filter(m => m.room_id === r.id && !aiIds.has(m.participant_id)).length,
        ai: msgs.filter(m => m.room_id === r.id && aiIds.has(m.participant_id)).length,
      },
    })),
    judgments: judged.size,
    published: judgments.filter(j => j.published_note_id).length,
  });
});

router.get('/turing-test/:courseId/:id/rooms/:roomId/messages', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireTeacher(courseId, req);
  const activity = await loadActivity(courseId, String(req.params.id));
  const roomId = String(req.params.roomId);
  const { data: room } = await supabase.from('turing_test_rooms').select('id').eq('id', roomId).eq('activity_id', activity.id).maybeSingle();
  if (!room) throw new ApiError(404, 'Room not found');
  const [members, rows] = await Promise.all([loadRoomMembers(roomId), loadRoomMessages(roomId, { limit: 400 })]);
  const nameOf = await loadNames(members.map(m => m.user_id));
  const byId = new Map(members.map(m => [m.id, m]));
  res.json({
    messages: rows.map(r => {
      const m = byId.get(r.participant_id);
      return {
        id: r.id,
        alias: m?.alias ?? '?',
        is_ai: Boolean(m?.is_ai),
        name: m?.user_id ? (nameOf.get(m.user_id) ?? null) : null,
        content: r.content,
        at: r.visible_at,
      };
    }),
  });
});

// ── 列表 ────────────────────────────────────────────────────────────

router.get('/turing-test/:courseId', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const role = await requireCourseMember(courseId, req);
  // 主持方 = 创建者、课程管理员、平台管理员。随列表带回 host，页面据此给「设置与主持」还是「加入」。
  // 平台身份是教师不算数：凭学生验证码入课的教师账号在 requireCourseMember 里是 student，是参加测试的人。
  const isTeacher = role !== 'student';

  let query = supabase
    .from('turing_test_activities')
    .select('id, title, topic, status, chat_minutes, room_size, ai_per_room, disclose_ai_count, ai_provider, ai_model, config, started_at, ends_at, created_at, updated_at')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });
  if (!isTeacher) query = query.in('status', STUDENT_VISIBLE);
  const { data } = await query;
  const activities = (data ?? []) as Array<Record<string, unknown> & { id: string }>;
  const ids = activities.map(a => a.id);
  if (ids.length === 0) {
    res.json({ activities: [], host: isTeacher });
    return;
  }

  const [joinedRes, judgmentsRes] = await Promise.all([
    supabase.from('turing_test_participants').select('activity_id, user_id').in('activity_id', ids).eq('is_ai', false),
    supabase.from('turing_test_judgments').select('activity_id').in('activity_id', ids).eq('submitted', true),
  ]);
  const joinedCount = new Map<string, number>();
  const mine = new Set<string>();
  for (const j of (joinedRes.data ?? []) as Array<{ activity_id: string; user_id: string | null }>) {
    joinedCount.set(j.activity_id, (joinedCount.get(j.activity_id) ?? 0) + 1);
    if (j.user_id === req.user!.id) mine.add(j.activity_id);
  }
  const judgmentCount = new Map<string, number>();
  for (const j of (judgmentsRes.data ?? []) as Array<{ activity_id: string }>) {
    judgmentCount.set(j.activity_id, (judgmentCount.get(j.activity_id) ?? 0) + 1);
  }

  res.json({
    activities: activities.map(a => {
      // 学生不需要知道用的是哪个模型、什么人设
      const { ai_provider, ai_model, config, ...rest } = a;
      return {
        ...(isTeacher ? a : rest),
        joined_count: joinedCount.get(a.id) ?? 0,
        judgment_count: judgmentCount.get(a.id) ?? 0,
        joined: mine.has(a.id),
      };
    }),
    host: isTeacher,
  });
});

// ── 学生：进入、我的状态、发言、判断、发布 ───────────────────────────────

router.post('/turing-test/:courseId/:id/join', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const role = await requireCourseMember(courseId, req);
  if (role !== 'student') throw new ApiError(403, '教师不参加测试，请在「设置与主持」里主持');
  const activity = await loadActivity(courseId, String(req.params.id), { fresh: true });
  if (activity.status !== 'open') {
    throw new ApiError(409, activity.status === 'draft' ? '活动还没开放' : '活动已经开始，这一轮进不去了');
  }
  const { error } = await supabase
    .from('turing_test_participants')
    .upsert(
      { activity_id: activity.id, user_id: req.user!.id, alias: `S-${req.user!.id}`, is_ai: false },
      { onConflict: 'activity_id,user_id', ignoreDuplicates: true },
    );
  if (error) throw new ApiError(500, error.message);
  res.json({ ok: true });
});

router.get('/turing-test/:courseId/:id/me', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const role = await requireCourseMember(courseId, req);
  const activity = await loadActivity(courseId, String(req.params.id));
  if (activity.status === 'draft') throw new ApiError(404, '活动还没开放');

  const userId = req.user!.id;
  const me = await loadMyParticipant(activity.id, userId);
  const now = Date.now();
  const endsAt = activity.ends_at ? Date.parse(activity.ends_at) : null;
  const timeUp = endsAt !== null && now >= endsAt;
  const revealed = activity.status === 'revealed' || activity.status === 'completed';

  let room: Record<string, unknown> | null = null;
  let messages: Array<Record<string, unknown>> = [];
  let judgment: Record<string, unknown> | null = null;

  if (me?.room_id) {
    const members = await loadRoomMembers(me.room_id);
    const byId = new Map(members.map(m => [m.id, m]));
    room = {
      id: me.room_id,
      my_participant_id: me.id,
      my_alias: me.alias,
      members: [...members]
        .sort((a, b) => a.alias.localeCompare(b.alias, 'zh'))
        .map(m => ({ id: m.id, alias: m.alias, is_me: m.id === me.id, ...(revealed ? { is_ai: m.is_ai } : {}) })),
      ai_count: activity.disclose_ai_count || revealed ? members.filter(m => m.is_ai).length : null,
    };

    const afterParam = typeof req.query.after === 'string' && !Number.isNaN(Date.parse(req.query.after)) ? req.query.after : null;
    const rows = await loadRoomMessages(me.room_id, { after: afterParam, limit: 400 });
    messages = rows.map(r => {
      const m = byId.get(r.participant_id);
      return {
        id: r.id,
        participant_id: r.participant_id,
        alias: m?.alias ?? '?',
        mine: r.participant_id === me.id,
        content: r.content,
        at: r.visible_at,
        ...(revealed ? { is_ai: Boolean(m?.is_ai) } : {}),
      };
    });

    if (activity.status === 'voting' || revealed || (activity.status === 'chatting' && timeUp)) {
      const [judgmentRes, votesRes] = await Promise.all([
        supabase
          .from('turing_test_judgments')
          .select('submitted, confidence, clues, correct, total, found_all_ai, published_note_id')
          .eq('activity_id', activity.id)
          .eq('student_id', userId)
          .maybeSingle(),
        supabase.from('turing_test_votes').select('participant_id, vote').eq('activity_id', activity.id).eq('voter_id', userId),
      ]);
      if (judgmentRes.data) {
        judgment = {
          ...(judgmentRes.data as Record<string, unknown>),
          votes: Object.fromEntries(((votesRes.data ?? []) as Array<{ participant_id: string; vote: string }>).map(v => [v.participant_id, v.vote])),
        };
      }
    }
  }

  res.json({
    activity: {
      id: activity.id,
      title: activity.title,
      topic: activity.topic,
      instructions: activity.instructions || DEFAULT_INSTRUCTIONS,
      status: activity.status,
      chat_minutes: activity.chat_minutes,
      started_at: activity.started_at,
      ends_at: activity.ends_at,
      disclose_ai_count: activity.disclose_ai_count,
    },
    joined: Boolean(me),
    in_room: Boolean(me?.room_id),
    room,
    messages,
    judgment,
    can_chat: activity.status === 'chatting' && Boolean(me?.room_id) && !timeUp,
    can_vote: Boolean(me?.room_id) && (activity.status === 'voting' || (activity.status === 'chatting' && timeUp)),
    // 主持方不参加测试（见 /join）。口径同列表的 host
    host: role !== 'student',
    server_time: new Date(now).toISOString(),
  });
});

router.post('/turing-test/:courseId/:id/message', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMember(courseId, req);
  const activity = await loadActivity(courseId, String(req.params.id));
  if (activity.status !== 'chatting') throw new ApiError(409, '现在不是对话时间');
  if (activity.ends_at && Date.now() > Date.parse(activity.ends_at) + 2_000) throw new ApiError(409, '时间到了');
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) throw new ApiError(400, 'content is required');
  if (content.length > 300) throw new ApiError(400, '一条最多 300 字');

  const me = await loadMyParticipant(activity.id, req.user!.id);
  if (!me?.room_id) throw new ApiError(409, '你不在这一轮的群里');
  const roomId = me.room_id;

  // 显示时间一律用本机时钟：AI 消息的 visible_at 是本机算的，真人消息若用数据库的 now()，
  // 两台机器一旦有时钟差，排序和「到没到显示时间」的判断就会错位。2026-09-14 查过两边相差不到 0.1 秒，这里是不去依赖它。
  const { data: msg, error } = await supabase
    .from('turing_test_messages')
    .insert({ activity_id: activity.id, room_id: roomId, participant_id: me.id, round_number: 1, content, visible_at: new Date().toISOString() })
    .select('id, visible_at')
    .single();
  if (error || !msg) throw new ApiError(500, error?.message ?? 'Failed to send');
  const inserted = msg as { id: string; visible_at: string };

  void evaluateRoom(activity.id, roomId);
  schedule(lullTimers, roomId, LULL_MS, () => void lullCheck(activity.id, roomId, inserted.id));

  res.json({ message: { id: inserted.id, participant_id: me.id, alias: me.alias, mine: true, content, at: inserted.visible_at } });
});

router.post('/turing-test/:courseId/:id/judgment', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMember(courseId, req);
  const activity = await loadActivity(courseId, String(req.params.id), { fresh: true });
  if (activity.status === 'revealed' || activity.status === 'completed') throw new ApiError(409, '答案已公布，判断不能再改');
  const timeUp = activity.ends_at ? Date.now() >= Date.parse(activity.ends_at) : false;
  if (!(activity.status === 'voting' || (activity.status === 'chatting' && timeUp))) throw new ApiError(409, '还没到判断的时候');

  const me = await loadMyParticipant(activity.id, req.user!.id);
  if (!me?.room_id) throw new ApiError(409, '你不在这一轮的群里');
  const others = (await loadRoomMembers(me.room_id)).filter(m => m.id !== me.id);

  const body = (req.body ?? {}) as { votes?: unknown; confidence?: unknown; clues?: unknown };
  const votes = new Map<string, 'human' | 'ai'>();
  for (const v of Array.isArray(body.votes) ? body.votes : []) {
    const item = v as { participant_id?: unknown; vote?: unknown } | null;
    if (item && typeof item.participant_id === 'string' && (item.vote === 'human' || item.vote === 'ai')) {
      votes.set(item.participant_id, item.vote);
    }
  }
  const otherIds = new Set(others.map(o => o.id));
  for (const pid of votes.keys()) {
    if (!otherIds.has(pid)) throw new ApiError(400, '只能判断同一个群里的其他成员');
  }
  if (others.some(o => !votes.has(o.id))) throw new ApiError(400, '请对群里每一位成员都做出判断');
  const clues = (Array.isArray(body.clues) ? body.clues : [])
    .filter((c): c is string => typeof c === 'string')
    .map(c => c.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 5);
  if (clues.length < 2) throw new ApiError(400, '请至少写两条具体线索');
  const confidence = clampInt(body.confidence, 3, 1, 5);

  const { error: voteErr } = await supabase.from('turing_test_votes').upsert(
    [...votes.entries()].map(([participant_id, vote]) => ({ activity_id: activity.id, voter_id: req.user!.id, participant_id, vote, confidence })),
    { onConflict: 'activity_id,voter_id,participant_id' },
  );
  if (voteErr) throw new ApiError(500, voteErr.message);

  const { data, error } = await supabase
    .from('turing_test_judgments')
    .upsert(
      { activity_id: activity.id, room_id: me.room_id, student_id: req.user!.id, submitted: true, confidence, clues, updated_at: new Date().toISOString() },
      { onConflict: 'activity_id,student_id' },
    )
    .select('submitted, confidence, clues, correct, total, found_all_ai, published_note_id')
    .single();
  if (error) throw new ApiError(500, error.message);
  res.json({ judgment: { ...(data as Record<string, unknown>), votes: Object.fromEntries(votes) } });
});

router.get('/turing-test/:courseId/:id/results', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  const role = await requireCourseMember(courseId, req);
  const isTeacher = role !== 'student';
  const activity = await loadActivity(courseId, String(req.params.id));
  const revealed = activity.status === 'revealed' || activity.status === 'completed';
  if (!revealed && !isTeacher) throw new ApiError(403, '还没公布答案');

  const [roomsRes, partsRes, votesRes, judgmentsRes] = await Promise.all([
    supabase.from('turing_test_rooms').select('id, room_no').eq('activity_id', activity.id).order('room_no', { ascending: true }),
    supabase.from('turing_test_participants').select('id, user_id, alias, is_ai, room_id').eq('activity_id', activity.id).not('room_id', 'is', null),
    supabase.from('turing_test_votes').select('voter_id, participant_id, vote').eq('activity_id', activity.id),
    supabase.from('turing_test_judgments').select('student_id, confidence, clues').eq('activity_id', activity.id).eq('submitted', true),
  ]);
  const rooms = (roomsRes.data ?? []) as Array<{ id: string; room_no: number }>;
  const parts = (partsRes.data ?? []) as Array<{ id: string; user_id: string | null; alias: string; is_ai: boolean; room_id: string }>;
  const votes = (votesRes.data ?? []) as Array<{ voter_id: string; participant_id: string; vote: 'human' | 'ai' }>;
  const judgments = (judgmentsRes.data ?? []) as Array<{ student_id: string; confidence: number; clues: string[] }>;
  const judgmentOf = new Map(judgments.map(j => [j.student_id, j]));
  const nameOf = isTeacher ? await loadNames(parts.map(p => p.user_id)) : new Map<string, string>();

  let classTotal = 0;
  let classCorrect = 0;
  let aiJudged = 0;
  let aiCaught = 0;
  let humanJudged = 0;
  let humanAccused = 0;
  const cluesFound: Array<{ clue: string; confidence: number }> = [];
  const cluesMissed: Array<{ clue: string; confidence: number }> = [];
  let mine: { correct: number; total: number; found_all_ai: boolean; accused_humans: number } | null = null;
  const myRoomId = parts.find(p => p.user_id === req.user!.id && !p.is_ai)?.room_id ?? null;

  const roomStats = rooms.map(room => {
    const members = parts.filter(p => p.room_id === room.id);
    const judges = members.filter(p => !p.is_ai && p.user_id && judgmentOf.has(p.user_id));
    for (const judge of judges) {
      const others = members.filter(p => p.id !== judge.id).map(p => ({ id: p.id, alias: p.alias, isAi: p.is_ai }));
      const theirVotes = new Map(votes.filter(v => v.voter_id === judge.user_id).map(v => [v.participant_id, v.vote]));
      const s = scoreJudgment(theirVotes, others);
      classTotal += s.total;
      classCorrect += s.correct;
      for (const o of others) {
        if (o.isAi) {
          aiJudged += 1;
          if (theirVotes.get(o.id) === 'ai') aiCaught += 1;
        } else {
          humanJudged += 1;
          if (theirVotes.get(o.id) === 'ai') humanAccused += 1;
        }
      }
      const j = judgmentOf.get(judge.user_id as string);
      for (const clue of j?.clues ?? []) (s.foundAllAi ? cluesFound : cluesMissed).push({ clue, confidence: j?.confidence ?? 3 });
      if (judge.user_id === req.user!.id) {
        mine = { correct: s.correct, total: s.total, found_all_ai: s.foundAllAi, accused_humans: s.accusedHumans };
      }
    }
    return {
      id: room.id,
      room_no: room.room_no,
      members: members
        .sort((a, b) => a.alias.localeCompare(b.alias, 'zh'))
        .map(m => {
          const judgeIds = new Set(judges.filter(j => j.id !== m.id).map(j => j.user_id as string));
          const votedAi = votes.filter(v => v.participant_id === m.id && v.vote === 'ai' && judgeIds.has(v.voter_id)).length;
          return {
            id: m.id,
            alias: m.alias,
            is_ai: m.is_ai,
            ...(isTeacher ? { name: m.user_id ? (nameOf.get(m.user_id) ?? '（未命名）') : null } : {}),
            judged_by: judgeIds.size,
            voted_ai: votedAi,
            rate: pct(votedAi, judgeIds.size),
          };
        }),
    };
  });

  const byConfidence = (a: { confidence: number }, b: { confidence: number }) => b.confidence - a.confidence;
  res.json({
    turing_line: TURING_LINE_PERCENT,
    class: {
      rooms: rooms.length,
      students: parts.filter(p => !p.is_ai).length,
      judgments: judgments.length,
      accuracy: pct(classCorrect, classTotal),
      ai_identified_rate: pct(aiCaught, aiJudged),
      human_mistaken_rate: pct(humanAccused, humanJudged),
    },
    rooms: isTeacher ? roomStats : roomStats.filter(r => r.id === myRoomId),
    me: mine,
    clues_wall: { found: cluesFound.sort(byConfidence).slice(0, 40), missed: cluesMissed.sort(byConfidence).slice(0, 40) },
  });
});

/**
 * 把群聊记录和我的判断发布成一条笔记。公布答案后才能发（发之前写不了谁是 AI）。
 * 笔记里只有化名，不出现任何人的真名。
 */
router.post('/turing-test/:courseId/:id/publish-note', verifyJWT, async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await requireCourseMember(courseId, req);
  const activity = await loadActivity(courseId, String(req.params.id), { fresh: true });
  if (activity.status !== 'revealed' && activity.status !== 'completed') throw new ApiError(409, '公布答案之后才能发布');
  const userId = req.user!.id;
  const me = await loadMyParticipant(activity.id, userId);
  if (!me?.room_id) throw new ApiError(409, '你不在这一轮的群里');

  const { data: judgmentRow } = await supabase
    .from('turing_test_judgments')
    .select('submitted, confidence, clues, published_note_id')
    .eq('activity_id', activity.id)
    .eq('student_id', userId)
    .maybeSingle();
  const judgment = judgmentRow as { submitted: boolean; confidence: number; clues: string[]; published_note_id: string | null } | null;
  if (judgment?.published_note_id) {
    res.json({ noteId: judgment.published_note_id, already: true });
    return;
  }

  // 绑定小组的空间组外学生进不去，找第一个自己能发的
  const { data: spaces } = await supabase.from('spaces').select('id').eq('course_id', courseId).order('created_at', { ascending: true }).limit(20);
  let spaceId: string | null = null;
  for (const s of (spaces ?? []) as Array<{ id: string }>) {
    try {
      await ensureSpaceAccess(s.id, req.user!);
      spaceId = s.id;
      break;
    } catch {
      // 试下一个
    }
  }
  if (!spaceId) throw new ApiError(403, '没有可以发布的知识空间');

  const members = await loadRoomMembers(me.room_id);
  const byId = new Map(members.map(m => [m.id, m]));
  const others = members.filter(m => m.id !== me.id);
  const transcript = await loadRoomMessages(me.room_id, { limit: 400 });
  const aiAliases = others.filter(o => o.is_ai).map(o => o.alias);

  // 笔记里的固定字样跟着学生页面的语言走；话题、线索、群聊都是原话，不翻译
  const en = req.body?.lang === 'en';
  const list = (names: string[]) => names.join(en ? ', ' : '、');
  const parts: string[] = [];
  parts.push(`<p><strong>${en ? 'Topic: ' : '话题：'}</strong>${escapeHtml(activity.topic)}</p>`);
  if (judgment?.submitted) {
    const { data: voteRows } = await supabase.from('turing_test_votes').select('participant_id, vote').eq('activity_id', activity.id).eq('voter_id', userId);
    const voteMap = new Map(((voteRows ?? []) as Array<{ participant_id: string; vote: 'human' | 'ai' }>).map(v => [v.participant_id, v.vote]));
    const suspected = others.filter(o => voteMap.get(o.id) === 'ai').map(o => o.alias);
    const s = scoreJudgment(voteMap, others.map(o => ({ id: o.id, alias: o.alias, isAi: o.is_ai })));
    const tail = en
      ? [
          s.foundAllAi ? '' : ', and did not find every AI',
          s.accusedHumans > 0 ? `, and took ${s.accusedHumans} ${s.accusedHumans === 1 ? 'classmate' : 'classmates'} for AI` : '',
        ].join('')
      : [
          s.foundAllAi ? '' : '，没有把 AI 全部认出来',
          s.accusedHumans > 0 ? `，把 ${s.accusedHumans} 位同学当成了 AI` : '',
        ].join('');
    parts.push(en
      ? `<p><strong>My judgment: </strong>I thought ${escapeHtml(list(suspected) || 'nobody')} ${suspected.length === 1 ? 'was' : 'were'} AI (confidence ${judgment.confidence}/5).</p>`
      : `<p><strong>我的判断：</strong>我认为 ${escapeHtml(list(suspected) || '没有人')} 是 AI（信心 ${judgment.confidence}/5）。</p>`);
    parts.push(en
      ? `<p><strong>The answer: </strong>the AI ${aiAliases.length === 1 ? 'was' : 'were'} ${escapeHtml(list(aiAliases))}. I judged ${s.correct} of the other ${s.total} members correctly${tail}.</p>`
      : `<p><strong>公布的答案：</strong>AI 是 ${escapeHtml(list(aiAliases))}。群里另外 ${s.total} 位成员，我判对了 ${s.correct} 位${tail}。</p>`);
    if (judgment.clues.length > 0) {
      parts.push(`<p><strong>${en ? 'My clues:' : '我的线索：'}</strong></p><ul>${judgment.clues.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`);
    }
  } else {
    parts.push(en
      ? `<p><strong>My judgment: </strong>not submitted. The answer: the AI ${aiAliases.length === 1 ? 'was' : 'were'} ${escapeHtml(list(aiAliases))}.</p>`
      : `<p><strong>我的判断：</strong>没有提交。公布的答案：AI 是 ${escapeHtml(list(aiAliases))}。</p>`);
  }
  parts.push(en
    ? `<h3>Group chat (I was "${escapeHtml(me.alias)}"; those marked AI are the model)</h3>`
    : `<h3>群聊记录（我在群里叫「${escapeHtml(me.alias)}」，标「AI」的是模型）</h3>`);
  if (transcript.length === 0) {
    parts.push(en ? '<p><em>Nobody said anything in the group.</em></p>' : '<p><em>群里没有人说话。</em></p>');
  } else {
    parts.push(`<blockquote>${transcript.map(m => {
      const who = byId.get(m.participant_id);
      const label = en
        ? `${who?.alias ?? '?'}${who?.is_ai ? ' (AI)' : ''}${m.participant_id === me.id ? ' (me)' : ''}`
        : `${who?.alias ?? '?'}${who?.is_ai ? '（AI）' : ''}${m.participant_id === me.id ? '（我）' : ''}`;
      return `<p><strong>${escapeHtml(label)}${en ? ': ' : '：'}</strong>${escapeHtml(m.content)}</p>`;
    }).join('')}</blockquote>`);
  }
  const reflection = typeof req.body?.reflection === 'string' ? req.body.reflection.trim().slice(0, 4000) : '';
  if (reflection) {
    parts.push(`<p><strong>${en ? 'My reflection:' : '我的反思：'}</strong></p>${reflection.split(/\n+/).map((l: string) => `<p>${escapeHtml(l)}</p>`).join('')}`);
  }
  parts.push(en
    ? `<p style="color:#888;font-size:12px">From the Turing test activity "${escapeHtml(activity.title)}"</p>`
    : `<p style="color:#888;font-size:12px">—— 来自图灵测试活动「${escapeHtml(activity.title)}」</p>`);

  const { data: note, error } = await supabase
    .from('notes')
    .insert({
      space_id: spaceId,
      author_id: userId,
      type: 'note',
      title: `${en ? 'Turing test' : '图灵测试'} · ${activity.topic.slice(0, 40)}`,
      content: await sanitizeNoteHtml(parts.join('')),
      x: 100 + Math.random() * 400,
      y: 100 + Math.random() * 300,
      views: [],
      tags: ['图灵测试'],
      epistemic_status: 'standard',
    })
    .select('id, title')
    .single();
  if (error || !note) throw new ApiError(500, error?.message ?? 'Failed to publish');
  const created = note as { id: string; title: string };

  await supabase.from('note_metrics_realtime').insert({
    note_id: created.id,
    direct_in_degree: 0, direct_out_degree: 0, build_on_count: 0,
    unique_contributor_count: 0, revision_count: 0, challenge_count: 0,
    evidence_count: 0, synthesis_count: 0, recent_activity_score: 0, heat_score: 0,
  });
  await supabase.from('events').insert({
    actor_id: userId,
    actor_role: req.user!.role,
    event_type: 'note_created',
    object_type: 'note',
    object_id: created.id,
    space_id: spaceId,
    metadata_json: { source: 'turing_test', activity_id: activity.id },
  });
  await supabase.from('turing_test_judgments').upsert(
    {
      activity_id: activity.id,
      student_id: userId,
      room_id: me.room_id,
      submitted: judgment?.submitted ?? false,
      published_note_id: created.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'activity_id,student_id' },
  );

  res.json({ noteId: created.id, title: created.title });
});

export default router;
