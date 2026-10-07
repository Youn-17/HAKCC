import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 课程知识库的向量请求：经 OpenRouter 用 voyage-4-lite（1024 维），平台 key，只走不收集数据的服务商；
 * 超时连读响应体一起算；卡住的请求另开一路：学生提问时最多三路、隔 1.2 秒补一路，4 秒拿不到就放弃。
 */

const h = vi.hoisted(() => ({
  aiFetch: vi.fn(),
}));

vi.mock('./aiGateway', () => ({ aiFetch: h.aiFetch }));

import {
  decodeEmbedding, embedKbQuery, embedKbTexts, hedged, isInputError, KbEmbeddingError, KB_EMBEDDING_DIMENSIONS,
  KB_VECTOR_MODEL, toHalfvecLiteral, __clearKbQueryCache,
} from './kbEmbedding';

const unit = (seed: number) => {
  const v = Array.from({ length: KB_EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(seed + i));
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / n);
};
const base64Of = (v: number[]) => {
  const buf = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => buf.writeFloatLE(x, i * 4));
  return buf.toString('base64');
};
const reply = (vectors: number[][], { asBase64 = false, status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify({
    data: vectors.map((v, index) => ({ index, embedding: asBase64 ? base64Of(v) : v })),
  }),
});
const sentBody = (call = 0) => JSON.parse(String((h.aiFetch.mock.calls[call][1] as RequestInit).body));

beforeEach(() => {
  h.aiFetch.mockReset();
  __clearKbQueryCache();
  process.env.KB_OPENROUTER_API_KEY = 'platform-key';
});

afterEach(() => {
  process.env.KB_OPENROUTER_API_KEY = '';
  vi.useRealTimers();
});

describe('格式', () => {
  it('base64 解成小端 float32，数组照收，坏数据返回 null', () => {
    const v = [0.5, -0.25, 0.125];
    expect(decodeEmbedding(base64Of(v))).toEqual(v);
    expect(decodeEmbedding(v)).toEqual(v);
    expect(decodeEmbedding('abc')).toBeNull();
    expect(decodeEmbedding([0.1, 'x'])).toBeNull();
    expect(decodeEmbedding(null)).toBeNull();
  });

  it('写进 halfvec 的文本保留五位有效数字', () => {
    expect(toHalfvecLiteral([0.0123456789, -1, 0.000012345678])).toBe('[0.012346,-1,0.000012346]');
  });

  it('kb_chunk_vectors.model 是「模型名@维度」', () => {
    expect(KB_VECTOR_MODEL).toBe('voyageai/voyage-4-lite@1024');
  });
});

describe('embedKbTexts', () => {
  it('经 OpenRouter 用平台的 key，只走不收集数据的服务商，按 index 排好顺序', async () => {
    const [a, b] = [unit(1), unit(2)];
    h.aiFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      text: async () => JSON.stringify({ data: [{ index: 1, embedding: b }, { index: 0, embedding: a }] }),
    });

    const out = await embedKbTexts(['第一段', '第二段'], { timeoutMs: 5000, label: 'test' });

    expect(out[0][0]).toBeCloseTo(a[0], 6);
    expect(out[1][0]).toBeCloseTo(b[0], 6);
    const [url, init, opts] = h.aiFetch.mock.calls[0] as [string, RequestInit, Record<string, unknown>];
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer platform-key');
    expect(sentBody()).toEqual({
      model: 'voyageai/voyage-4-lite', input: ['第一段', '第二段'], provider: { data_collection: 'deny' },
    });
    // 单独的并发桶，不和 AI 对话抢名额；不占提问者本人的名额
    expect(opts).toMatchObject({ provider: 'kb-embed', userId: null, label: 'test' });
  });

  it('没配平台的 key：不发请求', async () => {
    process.env.KB_OPENROUTER_API_KEY = '';
    await expect(embedKbTexts(['x'], { timeoutMs: 5000, label: 'test' })).rejects.toMatchObject({ kind: 'service' });
    expect(h.aiFetch).not.toHaveBeenCalled();
  });

  it('400 算内容的问题，5xx 和维度不对算接口的问题', async () => {
    h.aiFetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => '{"error":"data_inspection_failed"}' });
    await expect(embedKbTexts(['x'], { timeoutMs: 5000, label: 'test' })).rejects.toMatchObject({ kind: 'input' });

    h.aiFetch.mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' });
    await expect(embedKbTexts(['x'], { timeoutMs: 5000, label: 'test' })).rejects.toMatchObject({ kind: 'service' });

    h.aiFetch.mockResolvedValueOnce(reply([[0.1, 0.2]]));
    const err = await embedKbTexts(['x'], { timeoutMs: 5000, label: 'test' }).catch(e => e);
    expect(err).toBeInstanceOf(KbEmbeddingError);
    expect(err.kind).toBe('service');
  });

  it('响应头到了、响应体一直读不完：到点就放弃（aiFetch 自己的超时不管读响应体）', async () => {
    h.aiFetch.mockImplementationOnce(async (_url: string, init: RequestInit) => ({
      ok: true, status: 200,
      text: () => new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    }));
    const started = Date.now();
    const err = await embedKbTexts(['x'], { timeoutMs: 80, label: 'test' }).catch(e => e);
    expect(err).toMatchObject({ kind: 'service' });
    expect(err.message).toContain('超时');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('hedged：慢了另开一路', () => {
  const opts = { every: 1500, max: 2, budgetMs: 4000 };

  it('第一路按时回来：只发一路', async () => {
    vi.useFakeTimers();
    const run = vi.fn((_signal: AbortSignal) => new Promise<string>(done => setTimeout(() => done('first'), 500)));
    const result = hedged(run, opts);
    await vi.advanceTimersByTimeAsync(600);
    expect(await result).toBe('first');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('第一路卡住：到点另开一路，先回来的算，卡住的那一路被取消', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const run = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise<string>(() => {})
        : new Promise<string>(done => setTimeout(() => done('second'), 300));
    });
    const result = hedged(run, opts);
    await vi.advanceTimersByTimeAsync(1900);
    expect(await result).toBe('second');
    expect(run).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
  });

  it('第一路马上失败：不等到点，立刻另开一路', async () => {
    vi.useFakeTimers();
    let n = 0;
    const run = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new KbEmbeddingError('fetch failed', 'service');
      return 'retry';
    });
    const result = hedged(run, opts);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBe('retry');
  });

  it('最多三路时隔 1.2 秒补一路：前两路都卡住，第三路回来', async () => {
    vi.useFakeTimers();
    const run = vi.fn((_signal: AbortSignal) => (run.mock.calls.length < 3
      ? new Promise<string>(() => {})
      : Promise.resolve('third')));
    const result = hedged(run, { every: 1200, max: 3, budgetMs: 4000 });
    await vi.advanceTimersByTimeAsync(1199);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1300);
    expect(await result).toBe('third');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('内容被拒（400）：不再另开一路，直接失败', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => { throw new KbEmbeddingError('HTTP 400', 'input'); });
    const result = hedged(run, { ...opts, stopOn: isInputError });
    const caught = result.catch(e => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(await caught).toMatchObject({ kind: 'input' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('都失败、或者总时间到了：失败', async () => {
    vi.useFakeTimers();
    const failing = hedged(async () => { throw new KbEmbeddingError('down', 'service'); }, opts).catch(e => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(await failing).toMatchObject({ kind: 'service', message: 'down' });

    const stuck = hedged(() => new Promise<string>(() => {}), opts).catch(e => e);
    await vi.advanceTimersByTimeAsync(4001);
    expect(await stuck).toMatchObject({ kind: 'service' });
    expect((await stuck).message).toContain('4000ms');
  });
});

describe('embedKbQuery', () => {
  it('同一个问题 10 分钟内只算一次；没配 key 直接返回 null', async () => {
    h.aiFetch.mockResolvedValue(reply([unit(3)]));
    const first = await embedKbQuery('  知识建构是什么  ');
    const again = await embedKbQuery('知识建构是什么');
    expect(first).not.toBeNull();
    expect(again).toBe(first);
    expect(h.aiFetch).toHaveBeenCalledTimes(1);
    expect(sentBody().input).toEqual(['知识建构是什么']);

    process.env.KB_OPENROUTER_API_KEY = '';
    expect(await embedKbQuery('别的问题')).toBeNull();
  });
});
