import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 学生记忆（第四步）：合并、遗忘、按问题取、提示词那一段；关了不记不用；关键时刻十分钟内不重复记。
 */

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };

const h = vi.hoisted(() => ({
  calls: [] as Call[],
  respond: (_c: Call): { data: unknown; error: null | { message: string } } => ({ data: null, error: null }),
}));

vi.mock('../config/supabase', () => {
  const builder = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      insert: (p: unknown) => { call.op = 'insert'; call.payload = p; return b; },
      update: (p: unknown) => { call.op = 'update'; call.payload = p; return b; },
      upsert: (p: unknown) => { call.op = 'upsert'; call.payload = p; return b; },
      delete: () => { call.op = 'delete'; return b; },
      eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
      in: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
      gte: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: () => b,
      single: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        h.calls.push(call);
        return Promise.resolve(h.respond(call)).then(res, rej);
      },
    });
    return b;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});

import {
  MEMORY_LIMITS,
  buildMemoryContext,
  choiceEpisodeText,
  importEpisodeText,
  memoriesForPrompt,
  memoriesToForget,
  memoryWeight,
  rankForQuestion,
  recordEpisode,
  rememberProfile,
  similarity,
  type StudentMemory,
} from './studentMemory';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-11T08:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const mem = (over: Partial<StudentMemory & { expiresAt: string | null }>): StudentMemory & { expiresAt: string | null } => ({
  id: 'm', kind: 'profile', type: 'interest', content: '对个性化的公平问题感兴趣', keywords: [], relevance: 0.5,
  createdAt: iso(0), updatedAt: iso(0), lastUsedAt: null, source: {}, expiresAt: null, ...over,
});

beforeEach(() => {
  h.calls = [];
  h.respond = () => ({ data: null, error: null });
});

describe('相似、分量、按问题取', () => {
  it('意思差不多的中文、英文句子重合度高；不相干的低', () => {
    expect(similarity('还分不清路径个性化和目标个性化', '分不清路径个性化与目标个性化')).toBeGreaterThan(MEMORY_LIMITS.mergeSimilarity);
    expect(similarity('Interested in who benefits from personalization', 'interested in who benefits from personalized tutors')).toBeGreaterThan(0.4);
    expect(similarity('对象棋和 AI 的关系感兴趣', '论文评估是一种代理测量')).toBeLessThan(0.15);
  });

  it('多久没用上就减半：120 天减到一半，用上一次就恢复', () => {
    const fresh = mem({ relevance: 0.8, updatedAt: iso(0) });
    const old = mem({ relevance: 0.8, updatedAt: iso(120 * DAY) });
    expect(memoryWeight(fresh, NOW)).toBeCloseTo(0.8);
    expect(memoryWeight(old, NOW)).toBeCloseTo(0.4);
    expect(memoryWeight({ ...old, lastUsedAt: iso(DAY) }, NOW)).toBeGreaterThan(0.79);
  });

  it('和这一问有关的排前面', () => {
    const list = [
      mem({ id: 'a', content: '擅长把几种看法放在一起比较', relevance: 0.6 }),
      mem({ id: 'b', content: '还没弄懂合意困难为什么能帮记忆', relevance: 0.5 }),
    ];
    expect(rankForQuestion(list, '合意困难到底是什么意思？', 1, NOW)[0].id).toBe('b');
  });
});

describe('遗忘', () => {
  it('关键时刻过期就忘；「了解」淡到底就忘', () => {
    const drop = memoriesToForget([
      mem({ id: 'ep-old', kind: 'episode', type: 'choice', expiresAt: iso(1000) }),
      mem({ id: 'ep-new', kind: 'episode', type: 'choice', expiresAt: new Date(NOW + DAY).toISOString() }),
      mem({ id: 'faded', relevance: 0.3, updatedAt: iso(400 * DAY) }),
      mem({ id: 'kept', relevance: 0.6 }),
    ], NOW);
    expect(drop.sort()).toEqual(['ep-old', 'faded']);
  });

  it('超出条数：「了解」去掉最轻的，关键时刻去掉最旧的', () => {
    const profile = Array.from({ length: MEMORY_LIMITS.profile + 1 }, (_, i) => mem({ id: `p${i}`, relevance: i === 7 ? 0.11 : 0.5 + i / 100 }));
    const episodes = Array.from({ length: MEMORY_LIMITS.episode + 1 }, (_, i) => mem({ id: `e${i}`, kind: 'episode', type: 'choice', createdAt: iso(i * 60_000) }));
    const drop = memoriesToForget([...profile, ...episodes], NOW);
    expect(drop).toContain('p7');
    expect(drop).toContain(`e${MEMORY_LIMITS.episode}`);
    expect(drop).toHaveLength(2);
  });
});

describe('提示词里的那一段', () => {
  it('关了：说清楚别记、别翻旧账；没有记忆：不加这一段', () => {
    expect(buildMemoryContext({ enabled: false, profile: [], episodes: [] })).toContain('turned memory off');
    expect(buildMemoryContext({ enabled: true, profile: [], episodes: [] })).toBe('');
  });

  it('有记忆：分「了解」和「关键时刻」，说明学生看得到、删得掉，别复述', () => {
    const text = buildMemoryContext({
      enabled: true,
      profile: [mem({ type: 'knowledge_gap', content: '还没弄懂合意困难' })],
      episodes: [mem({ kind: 'episode', type: 'choice', content: '在「做哪种」里选了「对比表」', createdAt: '2026-10-11T03:00:00Z' })],
    });
    expect(text).toContain('AI 记得什么');
    expect(text).toContain('[Still working out] 还没弄懂合意困难');
    expect(text).toContain('Recent moments:');
    expect(text).toContain('10-11 在「做哪种」里选了「对比表」');
    expect(text).toMatch(/Do not recite them/);
  });

  it('关键时刻的说法', () => {
    expect(choiceEpisodeText({ label: '对比表' }, '要我做成哪种网页？', true)).toBe('在「要我做成哪种网页？」里选了「对比表」');
    expect(choiceEpisodeText({ label: '对比表' }, null, true)).toBe('选了「对比表」');
    expect(importEpisodeText('page', 'Who gets to struggle?', true)).toBe('把智能体做的网页放进了笔记《Who gets to struggle?》');
    expect(importEpisodeText('answer', '', false)).toBe('Imported the agent\'s answer into the note "a note"');
  });
});

describe('记一条「了解」', () => {
  const enabledRow = (enabled: boolean) => (c: Call) =>
    c.table === 'learner_profiles' ? { data: { memory_enabled: enabled }, error: null } : { data: [], error: null };

  it('学生关了记忆：不记', async () => {
    h.respond = enabledRow(false);
    expect(await rememberProfile({ userId: 'u', courseId: 'c', type: 'interest', content: '对公平感兴趣' })).toEqual({ saved: false, reason: 'off' });
    expect(h.calls.some(c => c.op === 'insert')).toBe(false);
  });

  it('意思差不多的：改写原来那条，重要程度略升，关键词合并', async () => {
    h.respond = (c: Call) => {
      if (c.table === 'learner_profiles') return { data: { memory_enabled: true }, error: null };
      if (c.op === 'select') {
        return { data: [{ id: 'old', memory_kind: 'profile', reflection_type: 'knowledge_gap', content: '分不清路径个性化与目标个性化', topic_keywords: ['个性化'], relevance_score: 0.5, created_at: iso(DAY), updated_at: iso(DAY) }], error: null };
      }
      return { data: null, error: null };
    };
    const r = await rememberProfile({ userId: 'u', courseId: 'c', type: 'knowledge_gap', content: '还分不清路径个性化和目标个性化', keywords: ['目标'], relevance: 0.4 });
    expect(r).toEqual({ saved: true, merged: true, id: 'old' });
    const update = h.calls.find(c => c.op === 'update');
    expect(update?.payload).toMatchObject({ content: '还分不清路径个性化和目标个性化', relevance_score: 0.55, topic_keywords: ['个性化', '目标'] });
    expect(h.calls.some(c => c.op === 'insert')).toBe(false);
  });

  it('新的：插一条 profile，重要程度夹在 0.05–1，类型不认识的当「观察」', async () => {
    h.respond = (c: Call) => {
      if (c.table === 'learner_profiles') return { data: null, error: null };
      if (c.op === 'insert') return { data: { id: 'new' }, error: null };
      return { data: [], error: null };
    };
    const r = await rememberProfile({ userId: 'u', courseId: 'c', type: 'weird', content: '  擅长举反例  ', relevance: 7, source: { surface: 'workspace' } });
    expect(r).toEqual({ saved: true, id: 'new' });
    expect(h.calls.find(c => c.op === 'insert')?.payload).toMatchObject({ memory_kind: 'profile', reflection_type: 'insight', content: '擅长举反例', relevance_score: 1, source: { surface: 'workspace' } });
  });
});

describe('关键时刻', () => {
  it('关了不记；十分钟内一模一样的不重复记；记的时候带 60 天过期', async () => {
    h.respond = (c: Call) => (c.table === 'learner_profiles' ? { data: { memory_enabled: false }, error: null } : { data: [], error: null });
    await recordEpisode({ userId: 'u', courseId: 'c', type: 'choice', content: '选了「对比表」' });
    expect(h.calls.some(c => c.op === 'insert')).toBe(false);

    h.calls = [];
    h.respond = (c: Call) => (c.table === 'learner_profiles' ? { data: null, error: null } : c.op === 'select' ? { data: [{ id: 'dup' }], error: null } : { data: null, error: null });
    await recordEpisode({ userId: 'u', courseId: 'c', type: 'choice', content: '选了「对比表」' });
    expect(h.calls.some(c => c.op === 'insert')).toBe(false);

    h.calls = [];
    h.respond = (c: Call) => (c.table === 'learner_profiles' ? { data: null, error: null } : { data: [], error: null });
    await recordEpisode({ userId: 'u', courseId: 'c', type: 'imported', content: '把智能体的回答导入了笔记《A》', source: { note_id: 'n' } });
    const insert = h.calls.find(c => c.op === 'insert')?.payload as Record<string, unknown>;
    expect(insert).toMatchObject({ memory_kind: 'episode', reflection_type: 'imported', source: { note_id: 'n' } });
    const days = (Date.parse(String(insert.expires_at)) - Date.now()) / DAY;
    expect(Math.round(days)).toBe(MEMORY_LIMITS.episodeDays);
  });
});

describe('放进提示词', () => {
  it('关了就什么都不给，也不标「用过」', async () => {
    h.respond = (c: Call) => (c.table === 'learner_profiles' ? { data: { memory_enabled: false }, error: null } : { data: [{ id: 'x', memory_kind: 'profile', reflection_type: 'interest', content: '对公平感兴趣', created_at: iso(0), updated_at: iso(0) }], error: null });
    expect(await memoriesForPrompt('u', 'c', '问')).toEqual({ enabled: false, profile: [], episodes: [] });
    expect(h.calls.some(c => c.table === 'agent_reflections' && c.op === 'update')).toBe(false);
  });

  it('开着：按问题取，用上的记下 last_used_at', async () => {
    h.respond = (c: Call) => (c.table === 'learner_profiles' ? { data: null, error: null } : c.op === 'select'
      ? { data: [{ id: 'x', memory_kind: 'profile', reflection_type: 'interest', content: '对公平感兴趣', relevance_score: 0.6, created_at: iso(0), updated_at: iso(0) }], error: null }
      : { data: null, error: null });
    const m = await memoriesForPrompt('u', 'c', '公平');
    expect(m.profile.map(x => x.id)).toEqual(['x']);
    await new Promise(r => setTimeout(r, 0));
    expect(h.calls.find(c => c.op === 'update')?.filters).toEqual(expect.arrayContaining([['user_id', 'u'], ['id', ['x']]]));
  });
});
