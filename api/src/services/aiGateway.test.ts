import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiBusyError, aiFetch, gatewayStats, __resetGatewayStats } from './aiGateway';

/**
 * 这些用例回答的是「52 个学生同时点，会怎么样」。
 * 它们不打真接口，只验证闸门本身：并发被压住、队列会放行、单人不能霸占、等太久会被拒。
 */

const originalFetch = global.fetch;

/** 一个占住 delayMs 才返回的假上游，用来制造并发。 */
function stubUpstream(delayMs: number, onCall?: () => void) {
  global.fetch = vi.fn(async () => {
    onCall?.();
    await new Promise(r => setTimeout(r, delayMs));
    return new Response('{"ok":true}', { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => { __resetGatewayStats(); });
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

describe('aiGateway 并发闸门', () => {
  it('同时来 52 个请求时，在飞的数量不会超过全局上限', async () => {
    let concurrent = 0;
    let peak = 0;
    global.fetch = vi.fn(async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise(r => setTimeout(r, 20));
      concurrent--;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    // 52 个不同的学生，模拟一个班同时点「请求反馈」
    const calls = Array.from({ length: 52 }, (_, i) =>
      aiFetch('https://upstream.test/v1/chat/completions', { method: 'POST' },
        { provider: 'dmx', userId: `student-${i}`, queueTimeoutMs: 10_000 }));

    const results = await Promise.all(calls);

    expect(results).toHaveLength(52);
    expect(results.every(r => r.ok)).toBe(true);
    // 全局默认 24；dmx 分桶默认 16，所以真实峰值应该被 dmx 的桶压到 16
    expect(peak).toBeLessThanOrEqual(16);
    const s = gatewayStats().totals as Record<string, number>;
    expect(s.accepted).toBe(52);
    expect(s.queued).toBeGreaterThan(0);
  });

  it('一个人开多个标签页也只能占到每人上限', async () => {
    let concurrent = 0;
    let peak = 0;
    global.fetch = vi.fn(async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise(r => setTimeout(r, 25));
      concurrent--;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await Promise.all(Array.from({ length: 8 }, () =>
      aiFetch('https://upstream.test/v1/chat/completions', { method: 'POST' },
        { provider: 'dmx', userId: 'same-student', queueTimeoutMs: 10_000 })));

    expect(peak).toBeLessThanOrEqual(2); // AI_MAX_CONCURRENT_PER_USER 默认 2
  });

  it('不同厂商各自计数，一个厂商被打满不会堵住另一个', async () => {
    const seen: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      seen.push(String(url));
      await new Promise(r => setTimeout(r, 15));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) =>
        aiFetch('https://zhipu.test/x', { method: 'POST' }, { provider: 'zhipu', userId: `a${i}`, queueTimeoutMs: 10_000 })),
      ...Array.from({ length: 4 }, (_, i) =>
        aiFetch('https://dmx.test/x', { method: 'POST' }, { provider: 'dmx', userId: `b${i}`, queueTimeoutMs: 10_000 })),
    ]);

    expect(seen.filter(u => u.includes('zhipu'))).toHaveLength(10);
    expect(seen.filter(u => u.includes('dmx'))).toHaveLength(4);
  });

  it('排队等太久会被明确拒绝，而不是无限等下去', async () => {
    stubUpstream(500);
    const hogs = Array.from({ length: 16 }, (_, i) =>
      aiFetch('https://upstream.test/x', { method: 'POST' },
        { provider: 'dmx', userId: `hog-${i}`, queueTimeoutMs: 10_000 }));

    await expect(
      aiFetch('https://upstream.test/x', { method: 'POST' },
        { provider: 'dmx', userId: 'late', queueTimeoutMs: 30 }),
    ).rejects.toBeInstanceOf(AiBusyError);

    await Promise.all(hogs);
    expect((gatewayStats().totals as Record<string, number>).timedOut).toBe(1);
  });

  it('上游超时会中止请求并释放名额', async () => {
    global.fetch = vi.fn((_url: any, init: any) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;

    await expect(
      aiFetch('https://upstream.test/x', { method: 'POST' },
        { provider: 'dmx', userId: 'u', timeoutMs: 40 }),
    ).rejects.toThrow();

    // 名额已归还，后续请求不受影响
    expect((gatewayStats().now as Record<string, number>).inFlight).toBe(0);
  });
});

describe('四把 key 同时配置时的分流', () => {
  it('第一把 key 名额用满后，请求自动落到第二把，而不是排队干等', async () => {
    const { freeCapacity } = await import('./aiGateway');
    const { orderConfigsByHealth } = await import('./modelRouter');

    // 每一路都要留一个 resolver，只记最后一个的话前面 5 路永远挂着
    const releases: Array<() => void> = [];
    global.fetch = vi.fn(() => new Promise<Response>(res => {
      releases.push(() => res(new Response('{}', { status: 200 })));
    })) as unknown as typeof fetch;

    const configs = [{ provider_id: 'zhipu' }, { provider_id: 'deepseek' }, { provider_id: 'moonshot' }, { provider_id: 'dmx' }];
    // 空闲时保持教师的偏好顺序
    expect(orderConfigsByHealth(configs).map(c => c.provider_id))
      .toEqual(['zhipu', 'deepseek', 'moonshot', 'dmx']);

    // 把 zhipu 的 6 个名额占满（自有 key 默认 6）
    const holds = Array.from({ length: 6 }, (_, i) =>
      aiFetch('https://open.bigmodel.cn/x', { method: 'POST' }, { provider: 'zhipu', userId: `s${i}` }));
    await new Promise(r => setTimeout(r, 30));

    expect(freeCapacity('zhipu')).toBe(0);
    expect(freeCapacity('deepseek')).toBeGreaterThan(0);
    // zhipu 没空位了，应该沉到有空位的后面
    expect(orderConfigsByHealth(configs)[0].provider_id).not.toBe('zhipu');

    releases.forEach(r => r());
    await Promise.all(holds).catch(() => {});
  });

  it('系统批量任务（userId 传 null）不受每人并发上限约束', async () => {
    let peak = 0, cur = 0;
    global.fetch = vi.fn(async () => {
      cur++; peak = Math.max(peak, cur);
      await new Promise(r => setTimeout(r, 20));
      cur--;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await Promise.all(Array.from({ length: 10 }, () =>
      aiFetch('https://www.dmxapi.cn/x', { method: 'POST' }, { provider: 'dmx', userId: null, queueTimeoutMs: 10_000 })));

    expect(peak).toBeGreaterThan(2); // 若被每人上限管住就只有 2
  });
});

describe('aiGateway RPM 闸门', () => {
  // Kimi Tier2 是 40 并发 / 100 RPM。并发不是真约束——k2.6 一次约 1.8s，
  // 跑满 40 并发等于 1300 RPM，13 倍超。只限并发的话开课当天必被限流。
  it('停在每分钟上限，不会因为并发有空位就继续发', async () => {
    process.env.AI_RPM_MOONSHOT = '5';
    vi.resetModules();
    const gw = await import('./aiGateway');
    gw.__resetGatewayStats();

    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;

    // 十个请求，一个接一个（并发始终是 1，绝不会碰到并发上限）
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        gw.aiFetch('https://api.moonshot.cn/v1/chat/completions', { method: 'POST' }, { queueTimeoutMs: 300 })),
    );

    // 前 5 个走掉，其余被 RPM 挡住——排队超时而不是打到上游
    expect(calls).toBe(5);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5);

    delete process.env.AI_RPM_MOONSHOT;
    vi.resetModules();
  });

  it('没有配 RPM 配额的厂商不受影响', async () => {
    stubUpstream(1);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        aiFetch('https://api.deepseek.com/chat/completions', { method: 'POST' })),
    );
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  });
});
