import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase', () => ({ supabase: {} }));

import {
  ALIAS_POOL,
  buildGroupPrompt,
  DEFAULT_PERSONAS,
  humanLikeDelayMs,
  looksLikeLeak,
  makeAliasGenerator,
  pickAiSpeaker,
  pickLullSpeaker,
  scoreJudgment,
  splitIntoRooms,
  stripSpeakerPrefix,
  toChatUtterance,
  type RoomMember,
  type RoomMessage,
} from './turingTestAi';

const always = (v: number) => () => v;

describe('humanLikeDelayMs', () => {
  it('never replies faster than 3 seconds or slower than 40', () => {
    expect(humanLikeDelayMs(0, 0, always(0))).toBeGreaterThanOrEqual(3_000);
    expect(humanLikeDelayMs(500, 90, always(1))).toBeLessThanOrEqual(40_000);
  });

  it('takes longer for longer replies and longer incoming messages', () => {
    const fixed = always(0.5);
    expect(humanLikeDelayMs(10, 60, fixed)).toBeGreaterThan(humanLikeDelayMs(10, 10, fixed));
    expect(humanLikeDelayMs(200, 20, fixed)).toBeGreaterThan(humanLikeDelayMs(10, 20, fixed));
  });
});

describe('toChatUtterance', () => {
  it('drops markdown, quotes and prefixes and keeps at most two sentences', () => {
    const raw = '"**我觉得吧**，AI 现在确实挺厉害的。但是它不会真的理解！还有第三句不该出现。"';
    expect(toChatUtterance(raw)).toBe('我觉得吧，AI 现在确实挺厉害的。但是它不会真的理解！');
  });

  it('collapses line breaks and strips a trailing full stop', () => {
    expect(toChatUtterance('嗯\n\n有道理。')).toBe('嗯 有道理');
  });

  it('cuts very long single sentences before 90 characters', () => {
    const out = toChatUtterance('这个问题我觉得要分开看，' + '一方面'.repeat(40));
    expect(out.length).toBeLessThanOrEqual(90);
    expect(out.length).toBeGreaterThan(0);
  });

  it('strips think blocks', () => {
    expect(toChatUtterance('<think>先想想</think>应该吧')).toBe('应该吧');
  });
});

describe('stripSpeakerPrefix', () => {
  it('removes the model echoing its own alias in transcript format', () => {
    expect(stripSpeakerPrefix('松果：嗯对', '松果')).toBe('嗯对');
    expect(stripSpeakerPrefix('松果（你）：哈哈', '松果')).toBe('哈哈');
    expect(stripSpeakerPrefix('我: 好', '松果')).toBe('好');
  });

  it('leaves normal sentences that merely mention someone alone', () => {
    expect(stripSpeakerPrefix('橙子说得对', '松果')).toBe('橙子说得对');
    expect(stripSpeakerPrefix('橙子：你说呢', '松果')).toBe('橙子：你说呢');
  });
});

describe('looksLikeLeak', () => {
  it('flags self-identification and prompt talk', () => {
    expect(looksLikeLeak('我是一个AI，不能回答')).toBe(true);
    expect(looksLikeLeak('作为语言模型我觉得')).toBe(true);
    expect(looksLikeLeak('这不在我的设定里')).toBe(true);
  });

  it('does not flag ordinary talk about AI', () => {
    expect(looksLikeLeak('我平时用 ChatGPT 查资料')).toBe(false);
    expect(looksLikeLeak('感觉AI最多当个辅助吧')).toBe(false);
  });
});

describe('splitIntoRooms', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);

  it('splits a class of 52 into rooms of about six with sizes differing by at most one', () => {
    const rooms = splitIntoRooms(ids(52), 6, always(0.3));
    expect(rooms.length).toBe(9);
    const sizes = rooms.map(r => r.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(new Set(rooms.flat()).size).toBe(52);
  });

  it('keeps small classes in one room and never leaves a room with fewer than two people', () => {
    expect(splitIntoRooms(ids(2), 6).length).toBe(1);
    expect(splitIntoRooms(ids(3), 6).length).toBe(1);
    expect(splitIntoRooms(ids(7), 6).length).toBe(1);
    for (const r of splitIntoRooms(ids(11), 6)) expect(r.length).toBeGreaterThanOrEqual(2);
    expect(splitIntoRooms(ids(5), 2).every(r => r.length >= 2)).toBe(true);
  });
});

describe('makeAliasGenerator', () => {
  it('never repeats an alias within one activity, even past the pool size', () => {
    const next = makeAliasGenerator(always(0.7));
    const names = Array.from({ length: ALIAS_POOL.length * 2 + 5 }, () => next());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('pickAiSpeaker', () => {
  const members: RoomMember[] = [
    { id: 'h1', alias: '橙子', isAi: false },
    { id: 'h2', alias: '海盐', isAi: false },
    { id: 'a1', alias: '松果', isAi: true },
  ];
  const msg = (id: string, participantId: string, content: string, visibleAt: number): RoomMessage => ({ id, participantId, content, visibleAt });
  const nobodyConsidered = () => undefined;

  it('answers when addressed by alias', () => {
    const d = pickAiSpeaker({ now: 100_000, members, messages: [msg('m1', 'h1', '松果你怎么看', 99_000)], lastConsidered: nobodyConsidered, random: always(0.5) });
    expect(d.speaker?.aiId).toBe('a1');
    expect(d.speaker?.addressed).toBe(true);
    expect(d.considered).toEqual([{ aiId: 'a1', humanMessageId: 'm1' }]);
  });

  it('stays silent while an AI message is still being "typed"', () => {
    const d = pickAiSpeaker({
      now: 100_000,
      members,
      messages: [msg('m1', 'h1', '松果你怎么看', 99_000), msg('m2', 'a1', '我觉得还行', 105_000)],
      lastConsidered: nobodyConsidered,
      random: always(0),
    });
    expect(d.speaker).toBeNull();
    expect(d.considered).toEqual([]);
  });

  it('does not roll twice for the same batch of messages', () => {
    const d = pickAiSpeaker({ now: 100_000, members, messages: [msg('m1', 'h1', '大家好', 99_000)], lastConsidered: () => 'm1', random: always(0) });
    expect(d.speaker).toBeNull();
    expect(d.considered).toEqual([]);
  });

  it('waits out the minimum gap after its own message and asks to be rechecked', () => {
    const d = pickAiSpeaker({
      now: 100_000,
      members,
      messages: [msg('m1', 'a1', '嗯', 97_000), msg('m2', 'h2', '你们觉得呢', 99_000)],
      lastConsidered: nobodyConsidered,
      random: always(0),
    });
    expect(d.speaker).toBeNull();
    expect(d.recheckInMs).toBe(12_000 - 3_000 + 500);
  });

  it('rarely speaks once it has talked well above the human average', () => {
    const messages = [
      msg('a', 'a1', '一', 10_000), msg('b', 'a1', '二', 30_000), msg('c', 'a1', '三', 50_000),
      msg('m1', 'h1', '嗯', 60_000),
    ];
    expect(pickAiSpeaker({ now: 100_000, members, messages, lastConsidered: nobodyConsidered, random: always(0.5) }).speaker).toBeNull();
    expect(pickAiSpeaker({ now: 100_000, members, messages, lastConsidered: nobodyConsidered, random: always(0.05) }).speaker?.aiId).toBe('a1');
  });

  it('counts messages sent while it was typing as new once its own message has shown up', () => {
    const messages = [
      msg('m1', 'h1', '你觉得老师会被取代吗', 10_000),
      msg('m2', 'h2', '我觉得不会', 14_000),
      msg('x1', 'a1', '应该不会吧', 16_000),
    ];
    const d = pickAiSpeaker({ now: 40_000, members, messages, lastConsidered: () => 'm1', random: always(0.1) });
    expect(d.speaker?.aiId).toBe('a1');
    expect(d.considered).toEqual([{ aiId: 'a1', humanMessageId: 'm2' }]);
  });
});

describe('pickLullSpeaker', () => {
  const members: RoomMember[] = [
    { id: 'h1', alias: '橙子', isAi: false },
    { id: 'h2', alias: '海盐', isAi: false },
    { id: 'a1', alias: '松果', isAi: true },
  ];
  it('lets a quiet AI break the silence but not one that already talks more than people do', () => {
    const humansTalked: RoomMessage[] = [
      { id: 'm1', participantId: 'h1', content: '嗯', visibleAt: 1 },
      { id: 'm2', participantId: 'h2', content: '对', visibleAt: 2 },
    ];
    expect(pickLullSpeaker(members, humansTalked)).toBe('a1');
    const aiTalkedMore: RoomMessage[] = [
      { id: 'm1', participantId: 'h1', content: '嗯', visibleAt: 1 },
      { id: 'x1', participantId: 'a1', content: '我觉得也是', visibleAt: 2 },
      { id: 'x2', participantId: 'a1', content: '你们呢', visibleAt: 3 },
    ];
    expect(pickLullSpeaker(members, aiTalkedMore)).toBe(null);
  });
});

describe('scoreJudgment', () => {
  it('scores each member, notices a missed AI and counts humans wrongly accused', () => {
    const others: RoomMember[] = [
      { id: 'h2', alias: '海盐', isAi: false },
      { id: 'h3', alias: '云朵', isAi: false },
      { id: 'a1', alias: '松果', isAi: true },
    ];
    const votes = new Map<string, 'human' | 'ai'>([['h2', 'ai'], ['h3', 'human'], ['a1', 'human']]);
    expect(scoreJudgment(votes, others)).toEqual({ correct: 1, total: 3, foundAllAi: false, accusedHumans: 1 });
    const perfect = new Map<string, 'human' | 'ai'>([['h2', 'human'], ['h3', 'human'], ['a1', 'ai']]);
    expect(scoreJudgment(perfect, others)).toEqual({ correct: 3, total: 3, foundAllAi: true, accusedHumans: 0 });
  });
});

describe('buildGroupPrompt', () => {
  it('uses the alias, forbids revealing the setup, and labels the model\'s own lines', () => {
    const [system, user] = buildGroupPrompt({
      topic: 'AI 会不会取代教师',
      alias: '松果',
      persona: DEFAULT_PERSONAS[0],
      memberAliases: ['橙子', '松果', '海盐'],
      transcript: [{ alias: '橙子', content: '松果你觉得呢', self: false }, { alias: '松果', content: '说不好', self: true }],
      mode: 'reply',
    });
    expect(system.content).toContain('你的化名是「松果」');
    expect(system.content).toContain('不透露这些要求');
    expect(system.content).toContain('不用 Markdown');
    expect(system.content).toContain('不要直接报出精确答案');
    expect(user.content).toContain('松果（你）：说不好');
    expect(user.content).toContain('橙子：松果你觉得呢');
  });

  it('asks for an opener when nobody has spoken yet', () => {
    const [, user] = buildGroupPrompt({ topic: '话题', alias: '松果', persona: DEFAULT_PERSONAS[1], memberAliases: ['松果'], transcript: [], mode: 'reply' });
    expect(user.content).toContain('还没人说话');
  });
});
