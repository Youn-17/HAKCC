import { describe, expect, it, vi } from 'vitest';
import { readJevConfig } from '../config/jev';
import { askJev, classifyJevStatus, jevCostUsd, JevError, type JevQuestion } from './jevClient';

const config = readJevConfig({ JEV_API_KEY: 'secret-key', JEV_TIMEOUT_MS: '1000' });

const QUESTIONS = {
  need: { type: 'noul', instructions: 'need?' },
  kind: { type: 'choice', instructions: 'which?', criteria: { a: 'A', b: 'B' } },
  depth: { type: 'score', instructions: 'how deep?', criteria: ['light', 'deep'] },
} satisfies Record<string, JevQuestion>;

const GOOD_BODY = {
  model: 'jev-1.13.0',
  answers: {
    need: { type: 'noul', noul: 0.82 },
    kind: { type: 'choice', choice: 'b', confidence: 0.7, probabilities: { a: 0.3, b: 0.7 } },
    depth: { type: 'score', score: 0.4, confidence: 0.6, probabilities: { 0: 0.6, 1: 0.4 } },
  },
  usage: { input_tokens: 321, output_tokens: 0 },
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const noSleep = vi.fn(async () => undefined);

describe('askJev', () => {
  it('发的是文档里的格式：Bearer key，body 里 model / state / questions', async () => {
    const fetchImpl = vi.fn(async () => json(200, GOOD_BODY));
    const result = await askJev({ note: '笔记' }, QUESTIONS, { config, fetchImpl, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'jev-1.13.0', state: { note: '笔记' }, questions: QUESTIONS });

    expect(result.model).toBe('jev-1.13.0');
    expect(result.answers.need.noul).toBe(0.82);
    expect(result.answers.kind.choice).toBe('b');
    expect(result.usage).toEqual({ inputTokens: 321, outputTokens: 0 });
  });

  it('没有 key：一次都不发', async () => {
    const fetchImpl = vi.fn();
    await expect(askJev('x', QUESTIONS, { config: readJevConfig({}), fetchImpl })).rejects.toMatchObject({ kind: 'no_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('key 不对（401 / 403）：不重试，报错里有服务端的话、没有 key', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => json(status, { detail: { error_type: 'authentication_error', message: 'Must supply an API key!' } }));
      const err = await askJev('x', QUESTIONS, { config, fetchImpl, sleep: noSleep }).catch(e => e as JevError);
      expect(err).toBeInstanceOf(JevError);
      expect(err.kind).toBe('auth');
      expect(err.message).toContain('Must supply an API key!');
      expect(err.message).not.toContain('secret-key');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('限流（429）：等一下再试一次，第二次成功就用第二次的', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(429, { detail: 'slow down' }, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(json(200, GOOD_BODY));
    const sleep = vi.fn(async () => undefined);
    const result = await askJev('x', QUESTIONS, { config, fetchImpl, sleep });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(result.answers.need.noul).toBe(0.82);
  });

  it('过载（529）两次：报 overloaded，只试两次', async () => {
    const fetchImpl = vi.fn(async () => json(529, { detail: 'busy' }));
    await expect(askJev('x', QUESTIONS, { config, fetchImpl, sleep: noSleep })).rejects.toMatchObject({ kind: 'overloaded', status: 529 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('在学生等待路径上（retry: false）：限流就直接放弃', async () => {
    const fetchImpl = vi.fn(async () => json(429, {}));
    await expect(askJev('x', QUESTIONS, { config, fetchImpl, sleep: noSleep, retry: false })).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('请求体不合格（422）：不重试', async () => {
    const fetchImpl = vi.fn(async () => json(422, { detail: [{ msg: 'field required' }] }));
    const err = await askJev('x', QUESTIONS, { config, fetchImpl, sleep: noSleep }).catch(e => e as JevError);
    expect(err.kind).toBe('invalid_request');
    expect(err.message).toContain('field required');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('超时：报 timeout', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    await expect(askJev('x', QUESTIONS, { config, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 }))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  it('网络断了：报 network', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(askJev('x', QUESTIONS, { config, fetchImpl, sleep: noSleep })).rejects.toMatchObject({ kind: 'network' });
  });

  it('答案缺题、类型不对、选项不在给的范围里：都算 bad_response，不往下用', async () => {
    const broken = [
      { ...GOOD_BODY, answers: { need: GOOD_BODY.answers.need, kind: GOOD_BODY.answers.kind } },
      { ...GOOD_BODY, answers: { ...GOOD_BODY.answers, need: { type: 'choice', choice: 'a', probabilities: {} } } },
      { ...GOOD_BODY, answers: { ...GOOD_BODY.answers, kind: { ...GOOD_BODY.answers.kind, choice: 'c' } } },
      { ...GOOD_BODY, answers: { ...GOOD_BODY.answers, need: { type: 'noul', noul: 1.7 } } },
    ];
    for (const body of broken) {
      const fetchImpl = vi.fn(async () => json(200, body));
      await expect(askJev('x', QUESTIONS, { config, fetchImpl, sleep: noSleep })).rejects.toMatchObject({ kind: 'bad_response' });
    }
  });
});

describe('classifyJevStatus / jevCostUsd', () => {
  it('状态码分类', () => {
    expect(classifyJevStatus(401)).toBe('auth');
    expect(classifyJevStatus(403)).toBe('auth');
    expect(classifyJevStatus(422)).toBe('invalid_request');
    expect(classifyJevStatus(429)).toBe('rate_limit');
    expect(classifyJevStatus(529)).toBe('overloaded');
    expect(classifyJevStatus(500)).toBe('http');
  });

  it('一百万输入 token 0.042 美元', () => {
    expect(jevCostUsd(1_000_000)).toBeCloseTo(0.042);
    expect(jevCostUsd(3000)).toBeCloseTo(0.000126);
  });
});
