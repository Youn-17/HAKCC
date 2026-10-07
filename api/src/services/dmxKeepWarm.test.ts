import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DMX 连接保温：平台有人用时，隔几秒向 DMX 发一个最小的请求（256 维），让 AI 对话用上热连接。
 * 平台半小时没人用、没配平台的 DMX key、6 秒内刚保温成功过，都不发；失败不抛错。
 */

const h = vi.hoisted(() => ({
  aiFetch: vi.fn(),
  /** 平台最近一次有登录用户请求的时刻 */
  lastUser: 0,
}));

vi.mock('./aiGateway', () => ({ aiFetch: h.aiFetch, lastUserRequestTime: () => h.lastUser }));

import { keepWarmTick, __resetDmxKeepWarm } from './dmxKeepWarm';

const ok = { ok: true, status: 200, text: async () => '{}' };
const sentBody = (call = 0) => JSON.parse(String((h.aiFetch.mock.calls[call][1] as RequestInit).body));

beforeEach(() => {
  h.aiFetch.mockReset();
  h.lastUser = 0;
  __resetDmxKeepWarm();
  process.env.KB_DMX_API_KEY = 'dmx-platform-key';
});

afterEach(() => {
  process.env.KB_DMX_API_KEY = '';
});

describe('DMX 连接保温', () => {
  it('平台这半小时有人用：向 DMX 发一个最小的请求（256 维），占的是 DMX 的名额、不算在任何人头上', async () => {
    h.aiFetch.mockResolvedValue(ok);
    const now = Date.now();
    h.lastUser = now - 60_000;

    expect(await keepWarmTick(now)).toBe(true);
    const [url, init, opts] = h.aiFetch.mock.calls[0] as [string, RequestInit, Record<string, unknown>];
    expect(url).toBe('https://www.dmxapi.cn/v1/embeddings');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dmx-platform-key');
    expect(sentBody()).toMatchObject({ model: 'qwen3.7-text-embedding', input: ['ping'], dimensions: 256 });
    expect(opts).toMatchObject({ provider: 'dmx', userId: null, label: 'dmx-keepwarm' });
  });

  it('刚保温成功过就不再发；隔 6 秒再发', async () => {
    h.aiFetch.mockResolvedValue(ok);
    h.lastUser = Date.now();
    expect(await keepWarmTick()).toBe(true);
    expect(await keepWarmTick(Date.now() + 3_000)).toBe(false);
    expect(await keepWarmTick(Date.now() + 6_500)).toBe(true);
    expect(h.aiFetch).toHaveBeenCalledTimes(2);
  });

  it('平台半小时没人用、或者没配平台的 DMX key：不发', async () => {
    h.aiFetch.mockResolvedValue(ok);
    h.lastUser = Date.now() - 31 * 60_000;
    expect(await keepWarmTick()).toBe(false);

    h.lastUser = Date.now();
    process.env.KB_DMX_API_KEY = '';
    expect(await keepWarmTick()).toBe(false);
    expect(h.aiFetch).not.toHaveBeenCalled();
  });

  it('保温请求失败不抛错，下一次照样发', async () => {
    h.aiFetch.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue(ok);
    h.lastUser = Date.now();
    expect(await keepWarmTick()).toBe(false);
    expect(await keepWarmTick()).toBe(true);
  });
});
