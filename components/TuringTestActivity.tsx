import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import RemixIcon from './RemixIcon';
import { useAuth } from '../contexts/AuthContext';
import {
  turingTest,
  type TuringTestChatMessage,
  type TuringTestJudgment,
  type TuringTestMe,
  type TuringTestResults,
  type TuringTestRoom,
} from '../services/apiClient';

/**
 * 图灵测试 · 学生页（群聊版）。
 *
 * 按活动状态切换：说明与进入 → 等老师开始 → 匿名群聊限时对话 → 对群里每一位判「人」或「AI」→
 * 公布答案 → 把群聊和判断发布成笔记。谁是 AI 在公布答案前从不下发到浏览器。
 */

const POLL_CHAT_MS = 2000;
const POLL_IDLE_MS = 4000;
const POLL_REVEALED_MS = 8000;

type JudgmentBody = { votes: Array<{ participant_id: string; vote: 'human' | 'ai' }>; confidence: number; clues: string[] };

function useCountdown(endsAt: string | null | undefined, serverOffsetMs: number): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!endsAt) {
      setLeft(0);
      return;
    }
    const end = Date.parse(endsAt);
    const tick = () => setLeft(Math.max(0, end - (Date.now() + serverOffsetMs)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [endsAt, serverOffsetMs]);
  return left;
}

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function mergeMessages(prev: TuringTestChatMessage[], incoming: TuringTestChatMessage[]): TuringTestChatMessage[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map(m => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function latestAt(messages: TuringTestChatMessage[]): string | null {
  let best: string | null = null;
  let bestT = Number.NEGATIVE_INFINITY;
  for (const m of messages) {
    const t = Date.parse(m.at);
    if (t > bestT) {
      bestT = t;
      best = m.at;
    }
  }
  return best;
}

const card = 'rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';
const primaryBtn = 'flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#000080] px-5 text-sm font-semibold text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-40 dark:bg-[#4169E1] dark:hover:bg-[#4169E1]/90';
const inputCls = 'min-h-[44px] w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition-colors focus:border-[#000080]/40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

const T = {
  zh: {
    sendFailed: '发送失败',
    emptyOpen: '群里还没人说话，你可以先开口',
    emptyClosed: '这个群里没有人说话',
    me: '（我）',
    chatPlaceholder: '写好再发，像平时在群里聊天一样',
    chatEnded: '对话已结束',
    message: '发消息',
    send: '发送',
    members: (n: number) => `群成员 · ${n} 人`,
    aiCount: (n: number) => `其中 ${n} 位是 AI。`,
    aiCountHidden: '老师没有公开群里有几个 AI。',
    aliasNote: (alias: string) => `大家都用化名，你在群里叫「${alias}」。`,
    askHint: '可以自由提问，也可以直接问某个人。叫谁就写上谁的化名。',
    instructions: '任务说明',
    submitFailed: '提交失败',
    whoIsAi: '群里谁是 AI？',
    judgeHint: '对群里其他每一位判「人」或「AI」。',
    aiPicked: (total: number, picked: number) => `群里有 ${total} 位是 AI，你已标出 ${picked} 位。`,
    humanOrAi: (alias: string) => `${alias} 是人还是 AI`,
    human: '人',
    confidence: '有多确定',
    guessing: '猜的',
    verySure: '非常确定',
    cluesPrompt: '你靠什么区分的？每条写一个具体线索，至少两条',
    clue1: '例如：松果每次都回得很完整，从来不打错字',
    clue2: '例如：我问 37×48 等于几，橙子马上报出了准确答案',
    clueMore: '还有吗（选填）',
    savedHint: '已提交，公布答案前可以改',
    undecided: (n: number) => `还有 ${n} 位没判断`,
    update: '更新判断',
    submit: '提交判断',
    publishFailed: '发布失败',
    foundWall: '认出了全部 AI 的人靠的是',
    missedWall: '没认全的人靠的是',
    revealTitle: '答案公布',
    score: (total: number, correct: number): React.ReactNode => <>群里另外 {total} 位成员，你判对了 <strong>{correct}</strong> 位。</>,
    foundAll: '群里的 AI 你全部认出来了。',
    missedSome: '有 AI 没被你认出来。',
    accused: (n: number) => `你把 ${n} 位同学当成了 AI。`,
    noJudgment: '你没有提交判断。',
    tallying: '正在统计……',
    nobodyJudged: '没有人判断',
    votedAi: (ai: number, judged: number) => `${ai}/${judged} 人认为是 AI`,
    turingLine: (pct: number) => `图灵 1950 年预言：5 分钟提问之后，普通提问者认对的机会不超过 ${pct}%。`,
    groupRate: (rate: number, alias: string) => `这个群里 ${rate}% 的人认出了「${alias}」。`,
    classAccuracy: '全班判断准确率',
    aiIdentified: 'AI 被认出的比例',
    humanMistaken: '真人被当成 AI 的比例',
    none: '暂无',
    publishTitle: '发布到知识社区',
    publishHint: '把群聊记录（标出谁是 AI）、你的判断和线索发布成一条笔记，全班可以接着讨论。笔记里只有化名，不出现任何人的真名。',
    published: '已发布',
    viewOnCanvas: '去画布看',
    reflectionPlaceholder: '可选：你被「骗」了吗？是 AI 太像人，还是你太容易相信？写一两句放在笔记末尾',
    publishAsNote: '发布为笔记',
    loadFailed: '加载失败',
    missingActivity: '缺少活动信息',
    joinFailed: '进入失败',
    teacherLink: '教师请到「设置与主持」',
    backToSpace: '返回知识空间',
    topic: (topic: string) => `话题：${topic}`,
    youAre: (alias: string) => `你叫「${alias}」`,
    timeUp: '时间到',
    title: '图灵测试',
    chatMinutes: (m: number) => `对话时间 ${m} 分钟。老师点开始后才会分群，进入后请留在这个页面。`,
    joinedWaiting: '已进入，等老师开始',
    notJoined: '还没进入',
    join: '进入活动',
    missedRound: '这一轮已经开始，你没有进入。下次活动开放时，先点「进入活动」再等老师开始。',
  },
  en: {
    sendFailed: 'Could not send',
    emptyOpen: 'Nobody has said anything yet. You can start.',
    emptyClosed: 'Nobody said anything in this group',
    me: ' (me)',
    chatPlaceholder: 'Write, then send, as in any group chat',
    chatEnded: 'The chat has ended',
    message: 'Message',
    send: 'Send',
    members: (n: number) => `Members · ${n}`,
    aiCount: (n: number) => `${n} of them ${n === 1 ? 'is' : 'are'} AI. `,
    aiCountHidden: 'Your teacher has not said how many are AI. ',
    aliasNote: (alias: string) => `Everyone uses a pseudonym; yours is "${alias}".`,
    askHint: 'Ask anything, or ask someone directly by writing their pseudonym.',
    instructions: 'Instructions',
    submitFailed: 'Could not submit',
    whoIsAi: 'Who in the group is AI?',
    judgeHint: 'Mark everyone else in the group as Human or AI. ',
    aiPicked: (total: number, picked: number) => `${total} of them ${total === 1 ? 'is' : 'are'} AI; you have marked ${picked}.`,
    humanOrAi: (alias: string) => `Is ${alias} human or AI?`,
    human: 'Human',
    confidence: 'How sure are you',
    guessing: 'Guessing',
    verySure: 'Very sure',
    cluesPrompt: 'How did you tell? Write one concrete clue per line, at least two',
    clue1: 'For example: Pinecone always answered in full and never made a typo',
    clue2: 'For example: I asked what 37×48 is and Orange gave the exact answer at once',
    clueMore: 'Anything else? (optional)',
    savedHint: 'Submitted. You can change it until the answers are revealed',
    undecided: (n: number) => `${n} left to judge`,
    update: 'Update',
    submit: 'Submit',
    publishFailed: 'Could not publish',
    foundWall: 'Clues from those who found every AI',
    missedWall: 'Clues from those who missed some',
    revealTitle: 'The answers',
    score: (total: number, correct: number): React.ReactNode => <>You judged <strong>{correct}</strong> of the other {total} members correctly. </>,
    foundAll: 'You found every AI in the group. ',
    missedSome: 'You missed at least one AI. ',
    accused: (n: number) => `You took ${n} ${n === 1 ? 'classmate' : 'classmates'} for AI.`,
    noJudgment: 'You did not submit a judgment.',
    tallying: 'Tallying…',
    nobodyJudged: 'Nobody judged',
    votedAi: (ai: number, judged: number) => `${ai}/${judged} thought AI`,
    turingLine: (pct: number) => `Turing predicted in 1950 that after five minutes of questioning, an average interrogator would have no more than a ${pct}% chance of telling correctly. `,
    groupRate: (rate: number, alias: string) => `In this group, ${rate}% identified "${alias}". `,
    classAccuracy: 'Class accuracy',
    aiIdentified: 'AI identified',
    humanMistaken: 'Humans taken for AI',
    none: 'None yet',
    publishTitle: 'Publish to the community',
    publishHint: 'Publish the chat (with the AI marked), your judgment and your clues as a note the class can keep discussing. The note uses pseudonyms only; no real names appear.',
    published: 'Published',
    viewOnCanvas: 'View on canvas',
    reflectionPlaceholder: 'Optional: were you fooled? Was the AI too human, or were you too trusting? A sentence or two goes at the end of the note',
    publishAsNote: 'Publish as note',
    loadFailed: 'Could not load',
    missingActivity: 'Missing activity details',
    joinFailed: 'Could not join',
    teacherLink: 'Teachers: open "Set up"',
    backToSpace: 'Back to the space',
    topic: (topic: string) => `Topic: ${topic}`,
    youAre: (alias: string) => `You are "${alias}"`,
    timeUp: "Time's up",
    title: 'Turing test',
    chatMinutes: (m: number) => `The chat lasts ${m} minutes. Groups are formed when your teacher starts; stay on this page after joining.`,
    joinedWaiting: 'Joined. Waiting for your teacher to start',
    notJoined: 'Not joined yet',
    join: 'Join',
    missedRound: 'This round started without you. Next time it opens, click "Join" first and wait for your teacher to start.',
  },
};
type Tx = typeof T.zh;

const AiTag: React.FC = () => (
  <span className="rounded-full bg-zinc-800 px-1.5 py-px text-[0.625rem] font-semibold text-white dark:bg-zinc-200 dark:text-zinc-900">AI</span>
);

// ── 群聊 ─────────────────────────────────────────────────────────────

const ChatPanel: React.FC<{
  messages: TuringTestChatMessage[];
  canChat: boolean;
  revealed: boolean;
  t: Tx;
  onSend?: (text: string) => Promise<void>;
}> = ({ messages, canChat, revealed, t, onSend }) => {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending || !canChat || !onSend) return;
    setSending(true);
    setError('');
    try {
      await onSend(text);
      setDraft('');
      stickToBottom.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t.sendFailed);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className={`${card} flex min-h-0 flex-1 flex-col`}>
      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="py-12 text-center text-xs text-zinc-400">{canChat ? t.emptyOpen : t.emptyClosed}</p>
        )}
        {messages.map(m => (
          <div key={m.id} className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
            <span className="mb-1 flex items-center gap-1.5 px-1 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
              {m.mine ? `${m.alias}${t.me}` : m.alias}
              {revealed && m.is_ai && <AiTag />}
            </span>
            <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.mine ? 'rounded-tr-md bg-[#000080] text-white dark:bg-[#4169E1]' : 'rounded-tl-md bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'}`}>
              {m.content}
            </div>
          </div>
        ))}
      </div>
      {onSend && (
        <div className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          {error && <p className="mb-1.5 px-1 text-xs text-rose-500">{error}</p>}
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={!canChat}
              maxLength={300}
              placeholder={canChat ? t.chatPlaceholder : t.chatEnded}
              className={`${inputCls} flex-1 disabled:opacity-50`}
              aria-label={t.message}
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canChat || !draft.trim() || sending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#000080] text-white transition-all hover:bg-[#000080]/90 active:scale-[0.98] disabled:opacity-40 dark:bg-[#4169E1]"
              aria-label={t.send}
            >
              <RemixIcon name={sending ? 'loader-4-line' : 'send-plane-2-line'} size={16} className={sending ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

const MembersPanel: React.FC<{ room: TuringTestRoom; instructions: string; t: Tx }> = ({ room, instructions, t }) => (
  <aside className={`${card} space-y-4 p-5`}>
    <div>
      <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{t.members(room.members.length)}</h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        {room.ai_count !== null ? t.aiCount(room.ai_count) : t.aiCountHidden}
        {t.aliasNote(room.my_alias)}
      </p>
    </div>
    <ul className="flex flex-wrap gap-2">
      {room.members.map(m => (
        <li
          key={m.id}
          className={`rounded-full px-2.5 py-1 text-xs ${m.is_me ? 'bg-[#000080]/[0.08] font-semibold text-[#000080] dark:bg-[#4169E1]/20 dark:text-[#93AAFD]' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'}`}
        >
          {m.alias}
          {m.is_me && t.me}
        </li>
      ))}
    </ul>
    <p className="text-xs leading-relaxed text-zinc-500">{t.askHint}</p>
    <details className="group">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300">
        {t.instructions}
        <RemixIcon name="arrow-down-s-line" size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
        {instructions.split(/\n+/).map((line, i) => <p key={i}>{line}</p>)}
      </div>
    </details>
  </aside>
);

// ── 判断 ─────────────────────────────────────────────────────────────

const JudgmentForm: React.FC<{
  room: TuringTestRoom;
  initial: TuringTestJudgment | null;
  t: Tx;
  onSubmit: (body: JudgmentBody) => Promise<void>;
}> = ({ room, initial, t, onSubmit }) => {
  const others = useMemo(() => room.members.filter(m => !m.is_me), [room.members]);
  const [votes, setVotes] = useState<Record<string, 'human' | 'ai'>>(() => (initial?.submitted ? initial.votes : {}));
  const [confidence, setConfidence] = useState(initial?.submitted ? initial.confidence : 3);
  const [clues, setClues] = useState<string[]>(() =>
    initial?.submitted && initial.clues.length > 0 ? [...initial.clues, ''].slice(0, 5) : ['', ''],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(Boolean(initial?.submitted));

  const filled = clues.map(c => c.trim()).filter(Boolean);
  const undecided = others.filter(o => !votes[o.id]).length;
  const aiPicked = others.filter(o => votes[o.id] === 'ai').length;
  const canSubmit = undecided === 0 && filled.length >= 2 && !saving;

  const setVote = (id: string, vote: 'human' | 'ai') => {
    setVotes(prev => ({ ...prev, [id]: vote }));
    setSaved(false);
  };
  const setClue = (i: number, value: string) => {
    setClues(prev => {
      const next = [...prev];
      next[i] = value;
      if (i === next.length - 1 && value.trim() && next.length < 5) next.push('');
      return next;
    });
    setSaved(false);
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await onSubmit({ votes: others.map(o => ({ participant_id: o.id, vote: votes[o.id] })), confidence, clues: filled });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.submitFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${card} space-y-6 p-6`}>
      <div>
        <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{t.whoIsAi}</h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-500">
          {t.judgeHint}
          {room.ai_count !== null ? t.aiPicked(room.ai_count, aiPicked) : t.aiCountHidden}
        </p>
      </div>
      <ul className="space-y-2">
        {others.map(o => (
          <li key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{o.alias}</span>
            <div className="flex shrink-0 gap-1.5" role="group" aria-label={t.humanOrAi(o.alias)}>
              {(['human', 'ai'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVote(o.id, v)}
                  aria-pressed={votes[o.id] === v}
                  className={`min-h-[44px] min-w-[3.5rem] rounded-lg border px-3 text-sm font-medium transition-all active:scale-[0.98] ${votes[o.id] === v ? 'border-[#000080] bg-[#000080] text-white dark:border-[#4169E1] dark:bg-[#4169E1]' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300'}`}
                >
                  {v === 'human' ? t.human : 'AI'}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div>
        <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-300">
          <span>{t.confidence}</span>
          <span className="font-medium">{confidence} / 5</span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          value={confidence}
          onChange={e => {
            setConfidence(Number(e.target.value));
            setSaved(false);
          }}
          className="mt-2 w-full accent-[#000080]"
          aria-label={t.confidence}
        />
        <div className="mt-1 flex justify-between text-[0.6875rem] text-zinc-400">
          <span>{t.guessing}</span>
          <span>{t.verySure}</span>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{t.cluesPrompt}</p>
        {clues.map((c, i) => (
          <input
            key={i}
            value={c}
            onChange={e => setClue(i, e.target.value)}
            maxLength={300}
            placeholder={i === 0 ? t.clue1 : i === 1 ? t.clue2 : t.clueMore}
            className={inputCls}
          />
        ))}
      </div>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-zinc-400">
          {saved ? t.savedHint : undecided > 0 ? t.undecided(undecided) : ''}
        </span>
        <button type="button" onClick={() => void submit()} disabled={!canSubmit} className={primaryBtn}>
          <RemixIcon name={saving ? 'loader-4-line' : 'check-line'} size={15} className={saving ? 'animate-spin' : ''} />
          {saved ? t.update : t.submit}
        </button>
      </div>
    </div>
  );
};

// ── 公布答案与发布 ────────────────────────────────────────────────────

const RevealPanel: React.FC<{
  me: TuringTestMe;
  results: TuringTestResults | null;
  courseId: string;
  t: Tx;
  onPublish: (reflection: string) => Promise<{ noteId: string }>;
}> = ({ me, results, courseId, t, onPublish }) => {
  const navigate = useNavigate();
  const [reflection, setReflection] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(me.judgment?.published_note_id ?? null);
  const [error, setError] = useState('');

  const room = results?.rooms.find(r => r.id === me.room?.id) ?? null;
  const score = results?.me ?? null;

  const publish = async () => {
    setPublishing(true);
    setError('');
    try {
      const r = await onPublish(reflection);
      setNoteId(r.noteId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.publishFailed);
    } finally {
      setPublishing(false);
    }
  };

  const wall: Array<[string, Array<{ clue: string; confidence: number }>]> = results
    ? [[t.foundWall, results.clues_wall.found], [t.missedWall, results.clues_wall.missed]]
    : [];

  return (
    <div className="space-y-5">
      <div className={`${card} p-6`}>
        <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{t.revealTitle}</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {score ? (
            <>
              {t.score(score.total, score.correct)}
              {score.found_all_ai ? t.foundAll : t.missedSome}
              {score.accused_humans > 0 ? t.accused(score.accused_humans) : ''}
            </>
          ) : results ? t.noJudgment : t.tallying}
        </p>
        {room && (
          <ul className="mt-4 space-y-2">
            {room.members.map(m => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
                <span className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {m.alias}
                  {m.id === me.room?.my_participant_id && t.me}
                  {m.is_ai ? <AiTag /> : (
                    <span className="rounded-full bg-zinc-200 px-1.5 py-px text-[0.625rem] font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">{t.human}</span>
                  )}
                </span>
                <span className="text-xs text-zinc-500">
                  {m.judged_by === 0 ? t.nobodyJudged : t.votedAi(m.voted_ai, m.judged_by)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {results && room?.members.some(m => m.is_ai && m.rate !== null) && (
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">
            {t.turingLine(results.turing_line)}
            {room.members.filter(m => m.is_ai && m.rate !== null).map(m => t.groupRate(m.rate as number, m.alias)).join('')}
          </p>
        )}
      </div>

      {results && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: t.classAccuracy, value: results.class.accuracy },
            { label: t.aiIdentified, value: results.class.ai_identified_rate },
            { label: t.humanMistaken, value: results.class.human_mistaken_rate },
          ].map(s => (
            <div key={s.label} className={`${card} p-4`}>
              <div className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{s.value === null ? '—' : `${s.value}%`}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {results && (results.clues_wall.found.length > 0 || results.clues_wall.missed.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {wall.map(([title, list]) => (
            <div key={title} className={`${card} p-5`}>
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h3>
              <ul className="mt-2 space-y-1.5">
                {list.slice(0, 12).map((c, i) => (
                  <li key={i} className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">· {c.clue}</li>
                ))}
                {list.length === 0 && <li className="text-xs text-zinc-400">{t.none}</li>}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className={`${card} p-6`}>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.publishTitle}</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          {t.publishHint}
        </p>
        {noteId ? (
          <div className="mt-4 flex items-center justify-between rounded-xl bg-emerald-50 p-3 dark:bg-emerald-900/20">
            <span className="text-sm text-emerald-700 dark:text-emerald-300">{t.published}</span>
            <button
              type="button"
              onClick={() => navigate(`/workspace/${courseId}`)}
              className="min-h-[44px] px-2 text-sm font-medium text-[#000080] hover:underline dark:text-[#93AAFD]"
            >
              {t.viewOnCanvas}
            </button>
          </div>
        ) : (
          <>
            <textarea
              value={reflection}
              onChange={e => setReflection(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder={t.reflectionPlaceholder}
              className="mt-3 w-full rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed outline-none transition-colors focus:border-[#000080]/40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => void publish()} disabled={publishing} className={primaryBtn}>
                <RemixIcon name={publishing ? 'loader-4-line' : 'send-plane-fill'} size={15} className={publishing ? 'animate-spin' : ''} />
                {t.publishAsNote}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── 页面 ─────────────────────────────────────────────────────────────

const TuringTestActivity: React.FC<{ lang?: 'zh' | 'en' }> = ({ lang = 'zh' }) => {
  const t = T[lang];
  const { courseId, activityId } = useParams<{ courseId: string; activityId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [me, setMe] = useState<TuringTestMe | null>(null);
  const [messages, setMessages] = useState<TuringTestChatMessage[]>([]);
  const [results, setResults] = useState<TuringTestResults | null>(null);
  const [loadError, setLoadError] = useState('');
  const [joining, setJoining] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const cursorRef = useRef<string | null>(null);
  const statusRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!courseId || !activityId || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const after = cursorRef.current ?? undefined;
      let data = await turingTest.me(courseId, activityId, after);
      const statusChanged = statusRef.current !== null && statusRef.current !== data.activity.status;
      if (statusChanged && after) {
        // 状态变了（尤其是公布答案，消息要带上谁是 AI），整段重拉
        data = await turingTest.me(courseId, activityId);
        setMessages(data.messages);
        cursorRef.current = latestAt(data.messages);
      } else {
        const incoming = data.messages;
        setMessages(prev => (after ? mergeMessages(prev, incoming) : incoming));
        const last = latestAt(incoming);
        if (last && (!cursorRef.current || Date.parse(last) > Date.parse(cursorRef.current))) cursorRef.current = last;
      }
      statusRef.current = data.activity.status;
      setMe(data);
      setServerOffset(Date.parse(data.server_time) - Date.now());
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t.loadFailed);
    } finally {
      inFlightRef.current = false;
    }
  }, [courseId, activityId, t.loadFailed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = me?.activity.status;
  useEffect(() => {
    if (!status || status === 'completed') return;
    const ms = status === 'chatting' ? POLL_CHAT_MS : status === 'revealed' ? POLL_REVEALED_MS : POLL_IDLE_MS;
    const t = setInterval(() => {
      void refresh();
    }, ms);
    return () => clearInterval(t);
  }, [status, refresh]);

  useEffect(() => {
    if (!courseId || !activityId) return;
    if (status === 'revealed' || status === 'completed') {
      turingTest.results(courseId, activityId).then(setResults).catch(() => setResults(null));
    }
  }, [status, courseId, activityId]);

  const left = useCountdown(me?.activity.ends_at, serverOffset);

  const send = useCallback(async (text: string) => {
    if (!courseId || !activityId) return;
    const { message } = await turingTest.sendMessage(courseId, activityId, text);
    setMessages(prev => mergeMessages(prev, [message]));
  }, [courseId, activityId]);

  const submitJudgment = useCallback(async (body: JudgmentBody) => {
    if (!courseId || !activityId) return;
    const { judgment } = await turingTest.judgment(courseId, activityId, body);
    setMe(prev => (prev ? { ...prev, judgment } : prev));
  }, [courseId, activityId]);

  const publish = useCallback(async (reflection: string) => {
    if (!courseId || !activityId) throw new Error(t.missingActivity);
    return turingTest.publishNote(courseId, activityId, reflection, lang);
  }, [courseId, activityId, t.missingActivity, lang]);

  // 主持方看「设置与主持」、不加入；其余的人加入。按课内身份算，由后端随 /me 带回：
  // 凭学生验证码入课的教师账号在这门课里是参加测试的人。还没拿到（或旧版后端不带）时按平台身份。
  const isTeacher = me?.host ?? (user?.role === 'teacher' || user?.role === 'admin');

  const join = async () => {
    if (!courseId || !activityId) return;
    setJoining(true);
    try {
      await turingTest.join(courseId, activityId);
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t.joinFailed);
    } finally {
      setJoining(false);
    }
  };

  const teacherLink = isTeacher && courseId ? (
    <button
      type="button"
      onClick={() => navigate(`/workspace/${courseId}/turing-test?activity=${activityId}`)}
      className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-zinc-200 px-4 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <RemixIcon name="settings-3-line" size={14} />
      {t.teacherLink}
    </button>
  ) : null;

  if (!me) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-zinc-50 dark:bg-gray-950">
        <div className="h-[4.25rem] border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-gray-950" />
        <div className="mx-auto w-full max-w-2xl space-y-3 p-6">
          {loadError ? (
            <div className={`${card} space-y-4 p-6`}>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">{loadError}</p>
              <div className="flex flex-wrap gap-2">
                {teacherLink}
                <button type="button" onClick={() => navigate(`/workspace/${courseId}`)} className={primaryBtn}>{t.backToSpace}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="h-6 w-1/3 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-40 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
            </>
          )}
        </div>
      </div>
    );
  }

  const a = me.activity;
  const room = me.room;
  const revealed = a.status === 'revealed' || a.status === 'completed';
  const canChat = me.can_chat && left > 0;
  const showChat = a.status === 'chatting' && Boolean(room) && !me.can_vote;
  const showVote = Boolean(room) && me.can_vote && !revealed;

  return (
    <div className="flex h-[100dvh] flex-col bg-zinc-50 dark:bg-gray-950">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-gray-950">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/workspace/${courseId}`)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t.backToSpace}
          >
            <RemixIcon name="arrow-left-line" size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{a.title}</h1>
            <p className="truncate text-[0.6875rem] text-zinc-500">{t.topic(a.topic)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {room && (
            <span className="hidden rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 sm:inline dark:bg-zinc-800 dark:text-zinc-300">
              {t.youAre(room.my_alias)}
            </span>
          )}
          {a.status === 'chatting' && room && (
            <span
              className={`rounded-full px-3 py-1 font-mono text-sm font-semibold ${left === 0 ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' : left < 60_000 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'}`}
            >
              {left === 0 ? t.timeUp : fmt(left)}
            </span>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {isTeacher && !me.joined && <div className="mx-auto mb-4 flex max-w-2xl justify-end">{teacherLink}</div>}

        {a.status === 'open' && (
          <div className={`${card} mx-auto max-w-2xl p-6`}>
            <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{t.title}</h2>
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {a.instructions.split(/\n+/).map((line, i) => <p key={i}>{line}</p>)}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-zinc-500">{t.chatMinutes(a.chat_minutes)}</p>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-zinc-500">{me.joined ? t.joinedWaiting : t.notJoined}</span>
              {!me.joined && !isTeacher && (
                <button type="button" onClick={() => void join()} disabled={joining} className={primaryBtn}>
                  <RemixIcon name={joining ? 'loader-4-line' : 'login-box-line'} size={15} className={joining ? 'animate-spin' : ''} />
                  {t.join}
                </button>
              )}
            </div>
            {loadError && <p className="mt-3 text-xs text-rose-500">{loadError}</p>}
          </div>
        )}

        {a.status !== 'open' && !room && (
          <div className={`${card} mx-auto max-w-2xl p-6 text-center`}>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              {t.missedRound}
            </p>
          </div>
        )}

        {showChat && room && (
          <div className="grid gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="flex h-[70dvh] min-h-0 flex-col lg:h-full">
              <ChatPanel messages={messages} canChat={canChat} revealed={false} t={t} onSend={send} />
            </div>
            <MembersPanel room={room} instructions={a.instructions} t={t} />
          </div>
        )}

        {showVote && room && (
          <div className="grid gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="flex h-[50dvh] min-h-0 flex-col lg:h-full">
              <ChatPanel messages={messages} canChat={false} revealed={false} t={t} />
            </div>
            <div className="min-h-0 lg:overflow-y-auto">
              <JudgmentForm room={room} initial={me.judgment} t={t} onSubmit={submitJudgment} />
            </div>
          </div>
        )}

        {revealed && room && courseId && (
          <div className="mx-auto grid max-w-6xl items-start gap-4 lg:grid-cols-2">
            <RevealPanel me={me} results={results} courseId={courseId} t={t} onPublish={publish} />
            <div className="flex h-[70dvh] min-h-0 flex-col lg:sticky lg:top-0">
              <ChatPanel messages={messages} canChat={false} revealed t={t} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default TuringTestActivity;
