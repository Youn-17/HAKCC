import { supabase } from '../config/supabase';

/**
 * Rise Above 讨论室。
 *
 * 旧版是四步向导：选笔记 → 读 → AI 生成综述 → 完成。一个人走完，像填表，
 * 而且那个「AI 推荐笔记」其实是随机抽 4 条。
 *
 * 现在是一场讨论：来源笔记顶置常驻，同学在群聊里就这几条争，AI 同学按需被叫进来。
 *
 * ══ 边界（与观点图谱、讨论速览一致，改动前先读完）══
 *
 * 系统**不替学生写那句更高一层的说法**。它只做两件事：
 *   1. 让 AI 同学在被 @ 时参与讨论（提问、举例、唱反调、查资料、翻旧笔记）
 *   2. 在条件成熟时贴一张卡，把「你们对同一个词用了两种说法」指出来 —— 然后提一个问题
 *
 * 为什么：综合是知识建构里认知含量最高的一步，也是这门课要练的；而课程的因变量
 * 就是学生的认知主体性，AI 代写会直接污染测量。撰写区里 AI 完全退场。
 */

export type AgentSlug =
  | 'idea_coach'          // 刨根问底
  | 'rise_above_coach'    // 爱举例子（原「综合描述者」，已改为不做综合）
  | 'gap_finder'          // 爱唱反调
  | 'evidence_broker'     // 爱查资料
  | 'connection_scout';   // 记性特别好

/**
 * 五个 AI 同学。底层 id 沿用既有的 agent 模式，只换显示名和人设 ——
 * 数据、导出、研究编码都挂在 id 上，换 id 会把历史数据割断。
 *
 * 名字就是他们的讨论习惯，不另起名：学生要的是「班上不同性格的同学」，
 * 不是一排功能标签。
 */
export const ROOM_AGENTS: Record<AgentSlug, {
  nameZh: string; nameEn: string;
  habitZh: string; habitEn: string;
  avatar: string;
  persona: string;
}> = {
  idea_coach: {
    nameZh: '刨根问底', nameEn: 'Pins it down',
    habitZh: '你说的那个词到底指什么', habitEn: 'What exactly do you mean by that?',
    avatar: '问',
    persona: '你总要别人把话说清楚。听到含糊的词就追问它到底指什么，逼着大家先把用语对齐。一次只问一个问题，不给答案。',
  },
  rise_above_coach: {
    nameZh: '爱举例子', nameEn: 'Wants examples',
    habitZh: '说得太虚了，举个具体的', habitEn: 'Too abstract — give me a case',
    avatar: '例',
    persona: '你听不得抽象的话。别人一说概念，你就要一个具体情形。你自己也常抛出一个具体例子请大家判断。不要做综合，不要下结论。',
  },
  gap_finder: {
    nameZh: '爱唱反调', nameEn: 'Plays devil’s advocate',
    habitZh: '那如果反过来想呢', habitEn: 'What if the opposite were true?',
    avatar: '反',
    persona: '你听什么都先往反面想一遍，专门戳别人没想到的情形。反对要给理由或反例，不能只说「我觉得不对」。',
  },
  evidence_broker: {
    nameZh: '爱查资料', nameEn: 'Checks sources',
    habitZh: '这个有依据吗，我去找找', habitEn: 'Any evidence for that?',
    avatar: '查',
    persona: '听到断言就问有没有依据。你会指出哪句话需要证据、可以往哪个方向找。没把握的事明说没把握，不要编造来源。',
  },
  connection_scout: {
    nameZh: '记性特别好', nameEn: 'Remembers everything',
    habitZh: '上周好像有人说过类似的', habitEn: 'Someone said something like this before',
    avatar: '记',
    persona: '你记得谁在哪条笔记里说过类似的话，顺手把两边接上。只连你在给定笔记里真的看到的内容，不要凭空说「有人说过」。',
  },
};

const SHARED_RULES = `
你是一个知识建构课堂讨论里的同学，不是助教也不是老师。

- 说人话，一次说两三句就够，别长篇大论
- 你的作用是把讨论往前推，不是把它结束掉
- **不要做综合**：不要把几个人的说法合并成一句新的表述，不要写「综上所述」「所以结论是」
- 不要评价谁更有道理
- 不要用 emoji，不要客套
- 提到某条笔记时用它的编号，比如 [n3]`;

export function buildAgentSystemPrompt(slug: AgentSlug): string {
  const a = ROOM_AGENTS[slug];
  return `你叫「${a.nameZh}」。${a.persona}\n${SHARED_RULES}`;
}

// ── 那张「系统注意到的」卡 ──────────────────────────────────────────

/**
 * 触发条件（用户拍板：条件触发，不是每 N 条一次）。
 *
 * 每 N 条发言就贴一张，会产出一串浅层伪提示，并且教会学生这是例行公事。
 * 只在真的到点子上时才出现：
 */
export const NOTICE_RULES = {
  /** 同一处分歧至少持续这么多轮同学发言，才算「僵持」而不是刚提出来 */
  minTurnsOnSameSplit: 2,
  /** 一轮里至少要有这么多条同学发言，才考虑贴卡 —— 太早贴等于打断 */
  minStudentTurns: 4,
  /** 两张卡之间至少隔这么多条同学发言，避免连着刷 */
  cooldownTurns: 6,
  /** 讨论停滞：距上一条同学发言超过这么多分钟 */
  stalledAfterMinutes: 25,
};

export type NoticePayload = {
  /** 争的是哪个词或哪件事 */
  topic: string;
  /** 两种（或多种）说法，各自带人和笔记编号 */
  sides: Array<{ stance: string; who: string; noteIds: string[] }>;
  /** 唯一的一个问题。这张卡到此为止，不给答案 */
  question: string;
};

const NOTICE_SYSTEM = `你在看一个小组围绕几条笔记的讨论。

找出**同一个词或同一件事上，他们用了两套不同判准**的地方 —— 也就是他们其实在各说各的。

只在真的存在这种分歧时才输出。没有就返回 {"none": true}。

规则：
- 把不同说法**并列**写出来，不要合并，不要判断谁对
- 最后提**一个**问题，问的是「有没有一种说法能同时说清这两边各自看到了什么」这一类
- 不要给答案，不要写「建议」「应该」
- 用中文，每句都短

只返回 JSON：
{"topic":"争的是什么","sides":[{"stance":"一种说法","who":"谁","noteIds":["n1"]}],"question":"一个问题"}
或 {"none": true}`;

export function buildNoticeUserPrompt(
  notes: Array<{ key: string; author: string; title: string; body: string }>,
  turns: Array<{ who: string; text: string }>,
): string {
  const noteBlock = notes.map(n => `[${n.key}] ${n.author}：${n.title}\n${n.body}`).join('\n\n');
  const turnBlock = turns.map(t => `${t.who}：${t.text}`).join('\n');
  return `他们正在讨论的笔记：\n\n${noteBlock}\n\n———\n\n这一轮的对话：\n\n${turnBlock}`;
}

export { NOTICE_SYSTEM };

// ── 触发判定 ────────────────────────────────────────────────────────

type MsgLite = { sender_kind: string; created_at: string };

/** 同学发言够多、离上一张卡也够远，才谈得上贴卡。返回 null 表示门槛没过。 */
function noticeGate(messages: MsgLite[]) {
  const studentTurns = messages.filter(m => m.sender_kind === 'user');
  if (studentTurns.length < NOTICE_RULES.minStudentTurns) return null;

  // 距上一张卡还没够冷却
  const lastNoticeIdx = messages.map(m => m.sender_kind).lastIndexOf('system');
  const sinceLast = messages.slice(lastNoticeIdx + 1).filter(m => m.sender_kind === 'user').length;
  if (lastNoticeIdx >= 0 && sinceLast < NOTICE_RULES.cooldownTurns) return null;

  return { lastStudent: studentTurns[studentTurns.length - 1], sinceLast };
}

/**
 * 讨论停滞：门槛过了，而且最后一条同学发言已经过去一段时间，这时给个提示不算打断。
 *
 * 这条只可能在「没有新消息」时成立，所以发言接口永远判不到它 —— 那时最后一条
 * 同学发言就是刚发的那条。由开着讨论室的页面轮询时来问（POST .../idle-check）。
 */
export function isStalled(messages: MsgLite[], now = new Date()): boolean {
  const gate = noticeGate(messages);
  if (!gate) return false;
  const idleMin = (now.getTime() - new Date(gate.lastStudent.created_at).getTime()) / 60000;
  return idleMin >= NOTICE_RULES.stalledAfterMinutes;
}

/**
 * 现在该不该贴卡。纯规则，不花 LLM ——
 * 先用规则筛掉绝大多数情况，只有通过了才去问模型「有没有分歧」。
 */
export function shouldPostNotice(messages: MsgLite[], now = new Date()): boolean {
  const gate = noticeGate(messages);
  if (!gate) return false;
  if (isStalled(messages, now)) return true;
  // 否则要求这一轮里同学发言够多（说明确实在来回争）
  return gate.sinceLast >= NOTICE_RULES.minStudentTurns + NOTICE_RULES.minTurnsOnSameSplit;
}

// ── 取数 ────────────────────────────────────────────────────────────

export async function fetchRoomNotes(noteIds: string[]) {
  if (noteIds.length === 0) return [];
  const { data, error } = await supabase
    .from('notes')
    .select('id, title, content, author_name, author_id, created_at, is_ai_generated')
    .in('id', noteIds)
    .is('deleted_at', null);
  if (error) throw new Error(`riseabove notes: ${error.message}`);
  // 按传入顺序排，学生选的顺序就是他们心里的顺序
  const order = new Map(noteIds.map((id, i) => [id, i]));
  return (data ?? []).sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** 消息行统一带上发言人姓名：群聊里看不出谁说的，讨论就接不下去。 */
export const ROOM_MESSAGE_COLUMNS =
  'id, sender_id, sender_kind, agent_mode, content, payload, created_at, sender:profiles!sender_id(full_name)';

export function toRoomMessage(row: any) {
  const { sender, ...rest } = row ?? {};
  const profile = Array.isArray(sender) ? sender[0] : sender;
  return { ...rest, sender_name: (profile?.full_name as string | undefined) ?? null };
}

/**
 * 最近的 limit 条，按时间正序。
 * 原来是正序取前 limit 条：讨论一长，拿到的是最早那批，新消息永远显示不出来，
 * AI 同学和贴卡判定读到的「最近几句」也成了开头那几句。
 */
export async function fetchRoomMessages(roomId: string, limit = 200) {
  const { data, error } = await supabase
    .from('riseabove_messages')
    .select(ROOM_MESSAGE_COLUMNS)
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`riseabove messages: ${error.message}`);
  return (data ?? []).reverse().map(toRoomMessage);
}
