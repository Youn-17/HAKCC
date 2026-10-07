import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 重排请求：经 OpenRouter 用 voyageai/rerank-3-lite，平台 key，只走不收集数据的服务商；
 * 分数按 index 对回每段；没配 key、出错、少了分数都返回 null，调用方按向量的顺序给。
 */

const h = vi.hoisted(() => ({ aiFetch: vi.fn() }));
vi.mock('./aiGateway', () => ({ aiFetch: h.aiFetch }));

import { KB_RERANK_MODEL, KB_RERANK_THRESHOLD, rerankKb } from './kbRerank';

const reply = (results: Array<{ index: number; relevance_score: number }>, status = 200) => ({
  ok: status >= 200 && status < 300, status, text: async () => JSON.stringify({ results }),
});
const sentBody = () => JSON.parse(String((h.aiFetch.mock.calls[0][1] as RequestInit).body));

beforeEach(() => {
  h.aiFetch.mockReset();
  process.env.KB_OPENROUTER_API_KEY = 'platform-key';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env.KB_OPENROUTER_API_KEY = '';
  vi.restoreAllMocks();
});

describe('rerankKb', () => {
  it('用 rerank-3-lite、门槛 0.5（用户 10-06 定）', () => {
    expect(KB_RERANK_MODEL).toBe('voyageai/rerank-3-lite');
    expect(KB_RERANK_THRESHOLD).toBe(0.5);
  });

  it('请求经 OpenRouter，只走不收集数据的服务商，每段都要分数；分数按 index 对回原来的顺序', async () => {
    h.aiFetch.mockResolvedValueOnce(reply([{ index: 2, relevance_score: 0.9 }, { index: 0, relevance_score: 0.4 }, { index: 1, relevance_score: 0.1 }]));

    expect(await rerankKb('观点改进是什么', ['甲', '乙', 'x'.repeat(3000)])).toEqual([0.4, 0.1, 0.9]);

    const [url, init, opts] = h.aiFetch.mock.calls[0] as [string, RequestInit, Record<string, unknown>];
    expect(url).toBe('https://openrouter.ai/api/v1/rerank');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer platform-key');
    const body = sentBody();
    expect(body).toMatchObject({ model: 'voyageai/rerank-3-lite', query: '观点改进是什么', top_n: 3, provider: { data_collection: 'deny' } });
    expect(body.documents[2]).toHaveLength(2000);
    expect(opts).toMatchObject({ provider: 'kb-embed', userId: null, label: 'kb-rerank' });
  });

  it('没配 key、没有候选：不发请求', async () => {
    expect(await rerankKb('q', [])).toBeNull();
    process.env.KB_OPENROUTER_API_KEY = '';
    expect(await rerankKb('q', ['甲'])).toBeNull();
    expect(h.aiFetch).not.toHaveBeenCalled();
  });

  it('出错或有段落没打分：返回 null，调用方按向量的顺序给', async () => {
    h.aiFetch.mockResolvedValue(reply([], 502));
    expect(await rerankKb('q', ['甲', '乙'])).toBeNull();

    h.aiFetch.mockReset();
    h.aiFetch.mockResolvedValue(reply([{ index: 0, relevance_score: 0.7 }]));
    expect(await rerankKb('q', ['甲', '乙'])).toBeNull();
  });

  it('内容被拒（400）：不再另开一路', async () => {
    h.aiFetch.mockResolvedValue(reply([], 400));
    expect(await rerankKb('q', ['甲'])).toBeNull();
    expect(h.aiFetch).toHaveBeenCalledTimes(1);
  });
});
