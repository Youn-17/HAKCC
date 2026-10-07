import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Implementation notes are described in the public update guide. */

type Chunk = { chunk_id: string; course_id: string; heading_path: string | null; content: string };

const h = vi.hoisted(() => {
  const state = {
    chunks: [] as Chunk[],
    vectors: new Map<string, { chunk_id: string; course_id: string; model: string; embedding: string }>(),
    rpcCalls: [] as Array<Record<string, any>>,
    embedCalls: [] as string[][],
    /** 每次 embedKbTexts 被调时怎么回应；默认每段给一个向量 */
    embed: null as null | ((texts: string[], signal?: AbortSignal) => Promise<number[][]>),
  };

  const rpc = async (fn: string, args: Record<string, any>) => {
    state.rpcCalls.push({ fn, ...args });
    if (fn !== 'kb_chunks_missing_vectors') return { data: null, error: { message: `unknown function ${fn}` } };
    const exclude = new Set<string>(args.p_exclude ?? []);
    const todo = state.chunks
      .filter(c => !state.vectors.has(`${c.chunk_id}|${args.p_model}`) && !exclude.has(c.chunk_id))
      .slice(0, args.p_limit);
    return { data: todo.map(c => ({ ...c })), error: null };
  };

  // kb_chunk_vectors 的外键：片段不在了，整条 upsert 被拒（和 Postgres 一样，一行不写）
  const from = (table: string) => ({
    upsert: async (payload: any, opts: { onConflict: string }) => {
      if (table !== 'kb_chunk_vectors' || opts.onConflict !== 'chunk_id,model') throw new Error('unexpected write');
      const rows = Array.isArray(payload) ? payload : [payload];
      if (rows.some(r => !state.chunks.some(c => c.chunk_id === r.chunk_id && c.course_id === r.course_id))) {
        return { error: { code: '23503', message: 'violates foreign key constraint "kb_chunk_vectors_chunk_fk"' } };
      }
      for (const r of rows) state.vectors.set(`${r.chunk_id}|${r.model}`, r);
      return { error: null };
    },
  });

  return { state, supabase: { rpc, from } };
});

vi.mock('../config/supabase', () => ({ supabase: h.supabase }));
vi.mock('./kbEmbedding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./kbEmbedding')>();
  return {
    ...actual,
    embedKbTexts: async (texts: string[], opts?: { signal?: AbortSignal }) => {
      h.state.embedCalls.push(texts);
      if (h.state.embed) return h.state.embed(texts, opts?.signal);
      return texts.map((_, i) => [0.1 * (i + 1), 0.2]);
    },
  };
});

import { fillMissingVectors, __resetKbVectorJob } from './kbVectorJob';
import { KbEmbeddingError } from './kbEmbedding';

const MODEL = 'voyageai/voyage-4-lite@1024';
const chunk = (i: number, course = 'course-1', heading: string | null = null): Chunk =>
  ({ chunk_id: `c${i}`, course_id: course, heading_path: heading, content: `第 ${i} 段` });
const stored = () => [...h.state.vectors.values()];

beforeEach(() => {
  __resetKbVectorJob();
  h.state.chunks = [];
  h.state.vectors.clear();
  h.state.rpcCalls = [];
  h.state.embedCalls = [];
  h.state.embed = null;
  process.env.KB_OPENROUTER_API_KEY = 'platform-key';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env.KB_OPENROUTER_API_KEY = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('补齐向量', () => {
  it('没配平台的 key：不查库也不调接口', async () => {
    h.state.chunks = [chunk(1)];
    process.env.KB_OPENROUTER_API_KEY = '';
    expect(await fillMissingVectors()).toEqual({ embedded: 0, rejected: 0, paused: false });
    expect(h.state.rpcCalls).toEqual([]);
    expect(h.state.embedCalls).toEqual([]);
  });

  it('16 片一批，标题路径一起送去算，写回时带上课程和模型', async () => {
    h.state.chunks = [
      chunk(0, 'course-1', '角色与组织结构'),
      ...Array.from({ length: 39 }, (_, i) => chunk(i + 1, i % 2 ? 'course-1' : 'course-2')),
    ];

    expect(await fillMissingVectors()).toEqual({ embedded: 40, rejected: 0, paused: false });

    expect(h.state.embedCalls.map(batch => batch.length)).toEqual([16, 16, 8]);
    expect(h.state.embedCalls[0][0]).toBe('角色与组织结构\n第 0 段');
    expect(stored()).toHaveLength(40);
    expect(stored().every(v => v.model === MODEL)).toBe(true);
    expect(h.state.vectors.get(`c1|${MODEL}`)?.course_id).toBe('course-2');
    expect(h.state.vectors.get(`c2|${MODEL}`)?.course_id).toBe('course-1');
    expect(h.state.vectors.get(`c0|${MODEL}`)?.embedding).toBe('[0.1,0.2]');
    expect(h.state.rpcCalls.every(call => call.p_model === MODEL)).toBe(true);
  });

  it('一轮最多 160 片，剩下的下一轮接着补', async () => {
    h.state.chunks = Array.from({ length: 200 }, (_, i) => chunk(i));

    expect((await fillMissingVectors()).embedded).toBe(160);
    expect((await fillMissingVectors()).embedded).toBe(40);
    expect(stored()).toHaveLength(200);
  });

  it('算的这一会儿文档重新入库、片段被删了：只跳过删掉的，同批其余照样写进去', async () => {
    h.state.chunks = Array.from({ length: 5 }, (_, i) => chunk(i));
    h.state.embed = async texts => {
      h.state.chunks = h.state.chunks.filter(c => c.chunk_id !== 'c2');
      return texts.map(() => [0.3]);
    };

    expect(await fillMissingVectors()).toMatchObject({ embedded: 4, paused: false });
    expect([...h.state.vectors.keys()].sort()).toEqual(['c0', 'c1', 'c3', 'c4'].map(id => `${id}|${MODEL}`));
  });
});

describe('出错', () => {
  it('整批被拒（400）：逐片重试找出是哪一片，其余写进去；被拒的 6 小时内不再取', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    h.state.chunks = Array.from({ length: 3 }, (_, i) => chunk(i));
    h.state.embed = async texts => {
      if (texts.some(t => t.includes('第 1 段'))) throw new KbEmbeddingError('HTTP 400: data_inspection_failed', 'input');
      return texts.map(() => [0.5]);
    };

    expect(await fillMissingVectors()).toEqual({ embedded: 2, rejected: 1, paused: false });
    expect(h.state.vectors.has(`c1|${MODEL}`)).toBe(false);

    h.state.rpcCalls = [];
    await fillMissingVectors();
    expect(h.state.rpcCalls[0].p_exclude).toEqual(['c1']);

    // 6 小时后再试一次，这回接口收了
    vi.setSystemTime(Date.now() + 6 * 60 * 60_000 + 1);
    h.state.embed = async texts => texts.map(() => [0.5]);
    expect((await fillMissingVectors()).embedded).toBe(1);
    expect(h.state.vectors.has(`c1|${MODEL}`)).toBe(true);
  });

  it('逐片重试也全被拒：多半是模型名或账号的问题，整体暂停，不把片段关进 6 小时的冷宫', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    h.state.chunks = [chunk(0), chunk(1)];
    h.state.embed = async () => { throw new KbEmbeddingError('HTTP 400: model not found', 'input'); };

    expect(await fillMissingVectors()).toEqual({ embedded: 0, rejected: 0, paused: true });

    vi.setSystemTime(Date.now() + 60_000 + 1);
    h.state.embed = async texts => texts.map(() => [0.5]);
    h.state.rpcCalls = [];
    expect((await fillMissingVectors()).embedded).toBe(2);
    expect(h.state.rpcCalls[0].p_exclude).toEqual([]);
  });

  it('接口出错：一批先试三轮（每轮两路）；都不行暂停 1 分钟、再错 2 分钟，暂停期间不调接口；好了以后从头计', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    h.state.chunks = [chunk(0)];
    h.state.embed = async () => { throw new KbEmbeddingError('fetch failed', 'service'); };

    expect(await fillMissingVectors()).toMatchObject({ embedded: 0, paused: true });
    expect(h.state.embedCalls).toHaveLength(6);
    expect(await fillMissingVectors()).toMatchObject({ paused: true });
    expect(h.state.embedCalls).toHaveLength(6);

    vi.setSystemTime(Date.now() + 60_000 + 1);
    await fillMissingVectors();
    expect(h.state.embedCalls).toHaveLength(12);
    // 第二次出错：暂停 2 分钟，1 分钟后还没到
    vi.setSystemTime(Date.now() + 60_000 + 1);
    expect(await fillMissingVectors()).toMatchObject({ paused: true });
    expect(h.state.embedCalls).toHaveLength(12);

    vi.setSystemTime(Date.now() + 60_000 + 1);
    h.state.embed = async texts => texts.map(() => [0.5]);
    expect((await fillMissingVectors()).embedded).toBe(1);
  });

  it('请求卡住不回（丢包）：8 秒后另开一路，回来的那一路照样写进去，卡住的那一路被取消', async () => {
    vi.useFakeTimers();
    h.state.chunks = [chunk(0), chunk(1)];
    const signals: AbortSignal[] = [];
    h.state.embed = (texts, signal) => {
      signals.push(signal!);
      if (signals.length === 1) {
        return new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(new KbEmbeddingError('取消', 'service')));
        });
      }
      return Promise.resolve(texts.map(() => [0.5]));
    };

    const run = fillMissingVectors();
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await run).toEqual({ embedded: 2, rejected: 0, paused: false });
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(stored()).toHaveLength(2);
  });
});

describe('同一时刻只跑一轮', () => {
  it('跑的途中又被叫：不另起一轮并发，跑完补一轮，接住途中新入库的片段', async () => {
    h.state.chunks = [chunk(0)];
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    h.state.embed = async texts => {
      await gate;
      return texts.map(() => [0.5]);
    };

    const first = fillMissingVectors();
    await vi.waitFor(() => expect(h.state.embedCalls).toHaveLength(1));
    h.state.chunks.push(chunk(1));
    const second = fillMissingVectors();
    release();

    expect(second).toBe(first);
    expect((await first).embedded).toBe(2);
    expect(stored()).toHaveLength(2);
  });
});
