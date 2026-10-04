/**
 * 所有发往模型厂商的 HTTP 请求的统一出口。
 *
 * 为什么需要它：一个班 52 个学生可能在同一分钟里同时点「请求反馈」。
 * 后端是单个 Node 进程（2 vCPU），事件循环扛得住——这些请求几乎全在等网络；
 * 真正会崩的是**上游**：
 *   - 自有 key（智谱/DeepSeek/Kimi）都有并发上限，几十路并发直接 429；
 *   - 429 之后 failover 链会把同样多的请求再打到 DMX，雪上加霜；
 *   - 没有排队的话，请求全部同时在飞，谁也拿不到结果，学生看到的是「全都很慢」，
 *     而不是「一部分快、一部分稍等」。
 *
 * 所以这里做三件事：
 *   1. 每个厂商一个信号量：并发到顶就排队，不是并发发出去
 *   2. 每个用户的并发上限：一个人开十个标签页也占不满队列
 *   3. 排队超时：等太久直接告诉学生「AI 正忙」，而不是让他盯着转圈
 *
 * 排队比并发好，是因为模型接口的吞吐基本恒定：同时发 52 个请求，总时长
 * 不会比排队分批发更短，只会让每个人的等待都变长、并且触发限流。
 */

import { AsyncLocalStorage } from 'node:async_hooks';

type FailureKind = 'rate_limit' | 'server' | 'timeout' | 'other';

export interface AiFetchOptions {
  /** 限流分桶。不传就按 URL 的域名推断，调用点因此不必逐个传 */
  provider?: string;
  /** 谁发起的。不传就从请求上下文取（见 withAiContext） */
  userId?: string | null;
  /** 单次请求超时，毫秒 */
  timeoutMs?: number;
  /** 排队最长等待，毫秒。超过就放弃，让上层给出「稍后再试」 */
  queueTimeoutMs?: number;
  /** 标记用途，只用于日志和统计 */
  label?: string;
}

export class AiBusyError extends Error {
  readonly code = 'ai_busy';
  constructor(message: string) {
    super(message);
    this.name = 'AiBusyError';
  }
}

/**
 * 请求上下文。中间件在每个 HTTP 请求开始时存入当前用户，
 * 深处的模型调用不必层层传参就能拿到——否则 31 个调用点都要改签名，改漏一个就没限流。
 */
const requestContext = new AsyncLocalStorage<{ userId: string | null }>();

export function withAiContext<T>(userId: string | null, fn: () => T): T {
  return requestContext.run({ userId }, fn);
}

/** 域名 → 厂商。用来分桶，认不出来的归到 other 桶（上限最保守）。 */
const HOST_PROVIDER: Array<[RegExp, string]> = [
  [/dmxapi\./i, 'dmx'],
  [/api\.deepseek\.com/i, 'deepseek'],
  [/bigmodel\.cn/i, 'zhipu'],
  [/moonshot\.(cn|ai)/i, 'moonshot'],
  [/api\.anthropic\.com/i, 'anthropic'],
  [/api\.openai\.com/i, 'openai'],
  [/generativelanguage\.googleapis\.com/i, 'google'],
  [/dashscope\.aliyuncs\.com/i, 'alibaba'],
  [/volces\.com/i, 'doubao'],
  [/api\.x\.ai/i, 'xai'],
  [/openrouter\.ai/i, 'openrouter'],
  [/minimax(i)?\.(chat|com)/i, 'minimax'],
  [/api\.tavily\.com/i, 'tavily'],
];

export function providerFromUrl(url: string): string {
  for (const [re, id] of HOST_PROVIDER) if (re.test(url)) return id;
  return 'other';
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * 并发上限。这些数字是压出来的，不是拍的（2026-09-05，四把 key 全配置的课程）：
 *
 *   并发 26  → 25/26  p50 3.1s   平均排队 0.2s
 *   并发 52  → 52/52  p50 4.0s   平均排队 1.9s
 *   并发 78  → 78/78  p50 5.3s   平均排队 3.2s
 *   并发 104 → 101/104 p50 7.1s  平均排队 4.3s
 *
 * 那几轮里 peakInFlight 一直顶在全局 24，说明瓶颈是这条全局线而不是上游——
 * 四个桶加起来有 36 个名额闲着。所以全局提到 36，让快的 key（DeepSeek 实测 p50
 * 0.17s）不被慢的拖住。服务器本身不是瓶颈：2 vCPU 上 104 并发读接口 p50 仍是 2.5s。
 */
const LIMITS = {
  global: num('AI_MAX_CONCURRENT', 36),
  perUser: num('AI_MAX_CONCURRENT_PER_USER', 2),
  queueTimeoutMs: num('AI_QUEUE_TIMEOUT_MS', 25_000),
  requestTimeoutMs: num('AI_REQUEST_TIMEOUT_MS', 90_000),
  maxQueueDepth: num('AI_MAX_QUEUE_DEPTH', 200),
};

const PROVIDER_LIMITS: Record<string, number> = {
  dmx: num('AI_MAX_CONCURRENT_DMX', 16),
  dmxapi: num('AI_MAX_CONCURRENT_DMX', 16),
  // 各家的额度不一样，按实测的成功率和延迟给：
  // DeepSeek 最快最稳（p50 0.17s，两轮 39/39 全成），给宽一点；
  // Kimi 升到 Tier2（40 并发 / 100 RPM），并发放宽到 12——
  // 持续速率交给上面的 PROVIDER_RPM 管，爆发时不至于被并发卡住。
  // 6 是实测出来的硬上限：提到 8 立刻出现 7 次
  // 「您的账户已达到速率限制」(code 1302)，成功率从 52/52 掉到 45/52。
  zhipu: num('AI_MAX_CONCURRENT_ZHIPU', 6),
  deepseek: num('AI_MAX_CONCURRENT_DEEPSEEK', 10),
  moonshot: num('AI_MAX_CONCURRENT_MOONSHOT', 12),
  // 生图和语音都比对话慢得多，给宽一点；真出问题再按实测收
  minimax: num('AI_MAX_CONCURRENT_MINIMAX', 8),
  alibaba: num('AI_MAX_CONCURRENT_NATIVE', 6),
  tavily: num('AI_MAX_CONCURRENT_SEARCH', 4),
  anthropic: num('AI_MAX_CONCURRENT_NATIVE', 6),
  openai: num('AI_MAX_CONCURRENT_NATIVE', 6),
  google: num('AI_MAX_CONCURRENT_NATIVE', 6),
  doubao: num('AI_MAX_CONCURRENT_NATIVE', 6),
  xai: num('AI_MAX_CONCURRENT_OTHER', 4),
  openrouter: num('AI_MAX_CONCURRENT_OTHER', 4),
};
/**
 * 每分钟请求数上限。并发和 RPM 是两回事，而且对 Kimi 来说 RPM 才是真约束：
 * Tier2 标称「40 并发 / 100 RPM」，但 k2.6 一次约 1.8s，跑满 40 并发
 * 等于 40 × 60 / 1.8 ≈ 1300 RPM，超上限 13 倍；就算按最慢的 k3（4.3s）
 * 也有 560 RPM。所以并发那个数基本用不到，必须按 RPM 限。
 * 只给确实有 RPM 配额的厂商设；不在表里的不限。
 */
const PROVIDER_RPM: Record<string, number> = {
  moonshot: num('AI_RPM_MOONSHOT', 100),
};

const rpmWindow = new Map<string, number[]>();
const rpmTimers = new Map<string, NodeJS.Timeout>();

function rpmAvailable(provider: string): boolean {
  const cap = PROVIDER_RPM[provider];
  if (!cap) return true;
  const cutoff = Date.now() - 60_000;
  const hits = (rpmWindow.get(provider) ?? []).filter(ts => ts > cutoff);
  rpmWindow.set(provider, hits);
  return hits.length < cap;
}

/**
 * 窗口最老那条过期时要主动放行队列。否则被 RPM 挡下的请求只能等到
 * 「有别的请求跑完」才被唤醒，而卡在 RPM 上时恰恰没有请求在跑。
 */
function scheduleRpmDrain(provider: string): void {
  if (rpmTimers.has(provider)) return;
  const hits = rpmWindow.get(provider) ?? [];
  if (!hits.length) return;
  const wait = Math.max(50, hits[0] + 60_000 - Date.now() + 10);
  const timer = setTimeout(() => { rpmTimers.delete(provider); drain(); }, wait);
  timer.unref?.();
  rpmTimers.set(provider, timer);
}

function rpmRecord(provider: string): void {
  if (!PROVIDER_RPM[provider]) return;
  const hits = rpmWindow.get(provider) ?? [];
  hits.push(Date.now());
  rpmWindow.set(provider, hits);
  scheduleRpmDrain(provider);
}

const DEFAULT_PROVIDER_LIMIT = num('AI_MAX_CONCURRENT_OTHER', 4);

const providerLimit = (provider: string) => PROVIDER_LIMITS[provider] ?? DEFAULT_PROVIDER_LIMIT;

// ── 计数与队列 ────────────────────────────────────────────────

let globalInFlight = 0;
const providerInFlight = new Map<string, number>();
const userInFlight = new Map<string, number>();

interface Waiter {
  provider: string;
  userId: string | null;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  enqueuedAt: number;
}
const queue: Waiter[] = [];

const stats = {
  accepted: 0,
  queued: 0,
  rejectedBusy: 0,
  timedOut: 0,
  failed: 0,
  totalQueueWaitMs: 0,
  maxQueueWaitMs: 0,
  peakInFlight: 0,
  peakQueueDepth: 0,
  connRetries: 0,
};

const inFlightOf = (map: Map<string, number>, key: string) => map.get(key) ?? 0;

function canRun(provider: string, userId: string | null): boolean {
  if (globalInFlight >= LIMITS.global) return false;
  if (inFlightOf(providerInFlight, provider) >= providerLimit(provider)) return false;
  if (!rpmAvailable(provider)) return false;
  if (userId && inFlightOf(userInFlight, userId) >= LIMITS.perUser) return false;
  return true;
}

function take(provider: string, userId: string | null): void {
  rpmRecord(provider);
  globalInFlight++;
  providerInFlight.set(provider, inFlightOf(providerInFlight, provider) + 1);
  if (userId) userInFlight.set(userId, inFlightOf(userInFlight, userId) + 1);
  if (globalInFlight > stats.peakInFlight) stats.peakInFlight = globalInFlight;
}

function give(provider: string, userId: string | null): void {
  globalInFlight = Math.max(0, globalInFlight - 1);
  const p = inFlightOf(providerInFlight, provider) - 1;
  if (p > 0) providerInFlight.set(provider, p); else providerInFlight.delete(provider);
  if (userId) {
    const u = inFlightOf(userInFlight, userId) - 1;
    if (u > 0) userInFlight.set(userId, u); else userInFlight.delete(userId);
  }
  drain();
}

/**
 * 放行队首能跑的那个。不是严格 FIFO：队首若卡在自己厂商的上限上，
 * 后面别的厂商的请求可以先走——否则一个厂商被打满会把整条队伍堵死。
 */
function drain(): void {
  for (let i = 0; i < queue.length; i++) {
    const w = queue[i];
    if (!canRun(w.provider, w.userId)) continue;
    queue.splice(i, 1);
    clearTimeout(w.timer);
    const waited = Date.now() - w.enqueuedAt;
    stats.totalQueueWaitMs += waited;
    if (waited > stats.maxQueueWaitMs) stats.maxQueueWaitMs = waited;
    take(w.provider, w.userId);
    w.resolve();
    if (globalInFlight >= LIMITS.global) return;
    i--;
  }
}

function acquire(provider: string, userId: string | null, queueTimeoutMs: number): Promise<void> {
  if (canRun(provider, userId)) {
    take(provider, userId);
    return Promise.resolve();
  }
  if (queue.length >= LIMITS.maxQueueDepth) {
    stats.rejectedBusy++;
    return Promise.reject(new AiBusyError('AI 请求排队已满，请稍后再试。'));
  }
  stats.queued++;
  if (queue.length + 1 > stats.peakQueueDepth) stats.peakQueueDepth = queue.length + 1;

  return new Promise<void>((resolve, reject) => {
    const w: Waiter = {
      provider, userId, resolve, reject, enqueuedAt: Date.now(),
      timer: setTimeout(() => {
        const idx = queue.indexOf(w);
        if (idx >= 0) queue.splice(idx, 1);
        stats.timedOut++;
        reject(new AiBusyError('AI 正忙（排队超时），请稍后再试。'));
      }, queueTimeoutMs),
    };
    queue.push(w);
  });
}

/**
 * 连接层面的失败重试一次。
 *
 * 并发上去之后会零星出现 `TypeError: fetch failed`（底层多半是 ECONNRESET /
 * socket hang up）—— 上游把连接掐了，请求根本没被处理过。这类失败重发是安全的，
 * 而且不该记到模型头上去冷却它：模型没问题，是这条连接没了。
 * HTTP 层面的错误（429/5xx）不在这里重试，交给 modelRouter 换模型。
 */
async function fetchWithConnRetry(url: string, init: RequestInit, label?: string): Promise<Response> {
  // 52 并发压测里每轮有 4–10 次连接失败，重试一次能救回大部分，但仍会漏 1–2 个；
  // 两次就基本收干净了。失败全部出现在 DMX 这条聚合链路上，自有 key 三轮 39/39 没掉过。
  const maxAttempts = num('AI_CONN_RETRIES', 2) + 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      const aborted = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
      if (aborted || (init as { signal?: AbortSignal }).signal?.aborted) throw e; // 超时/取消，重试没意义
      lastErr = e;
      if (attempt === maxAttempts) break;
      stats.connRetries++;
      console.warn(`[aiGateway] 连接失败，第 ${attempt} 次重试 (${label ?? 'ai'}): ${e instanceof Error ? e.message : e}`);
      await new Promise(r => setTimeout(r, 300 * attempt));
    }
  }
  throw lastErr;
}

// ── 对外接口 ──────────────────────────────────────────────────

/**
 * 发一个上游 AI 请求。用法与 fetch 一致，多一个 opts 说明是谁、打给谁。
 * 排队满或等待超时会抛 AiBusyError —— 上层应该把它翻译成对学生可读的提示，
 * 而不是当成模型故障去走 failover（那只会让上游更堵）。
 */
export async function aiFetch(
  url: string,
  init: RequestInit = {},
  opts?: AiFetchOptions,
): Promise<Response> {
  const provider = opts?.provider || providerFromUrl(url);
  // 显式传 null 表示「这是系统/批量任务，不计入每人上限」；
  // 不传（undefined）才回落到请求上下文里的当前用户。
  const userId = opts && 'userId' in opts
    ? opts.userId ?? null
    : requestContext.getStore()?.userId ?? null;
  const queueTimeoutMs = opts?.queueTimeoutMs ?? LIMITS.queueTimeoutMs;
  const timeoutMs = opts?.timeoutMs ?? LIMITS.requestTimeoutMs;

  await acquire(provider, userId, queueTimeoutMs);
  stats.accepted++;

  const controller = new AbortController();
  // 调用方自己传了 signal 就跟它联动，任一方取消都取消
  const outer = (init as { signal?: AbortSignal }).signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchWithConnRetry(url, { ...init, signal: controller.signal }, opts?.label);
  } catch (e) {
    stats.failed++;
    throw e;
  } finally {
    clearTimeout(timer);
    give(provider, userId);
  }
}

/** 把异常翻译成失败类型，喂给 modelRouter 的健康度记分板。 */
export function classifyFetchError(e: unknown): FailureKind {
  if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return 'timeout';
  return 'other';
}

export function isAiBusy(e: unknown): e is AiBusyError {
  return e instanceof AiBusyError || (e as { code?: string })?.code === 'ai_busy';
}

/**
 * 各厂商还剩多少并发名额。
 * 教师同时配了 DMX / DeepSeek / GLM / Kimi 四把 key 时，路由靠这个把一个班的流量
 * 摊到四条通道上，而不是全压在偏好列表的第一个上——那样只会把第一个打到限流。
 */
export function freeCapacity(provider: string): number {
  const byProvider = providerLimit(provider) - inFlightOf(providerInFlight, provider);
  const byGlobal = LIMITS.global - globalInFlight;
  return Math.max(0, Math.min(byProvider, byGlobal));
}

/** 观测用：/api/ai/gateway-stats */
export function gatewayStats(): Record<string, unknown> {
  return {
    limits: { ...LIMITS, perProvider: { ...PROVIDER_LIMITS, default: DEFAULT_PROVIDER_LIMIT }, perProviderRpm: { ...PROVIDER_RPM } },
    rpmUsed: Object.fromEntries([...rpmWindow].map(([p, hits]) => [p, hits.filter(ts => ts > Date.now() - 60_000).length])),
    now: {
      inFlight: globalInFlight,
      queueDepth: queue.length,
      byProvider: Object.fromEntries(providerInFlight),
      distinctUsers: userInFlight.size,
    },
    totals: {
      ...stats,
      avgQueueWaitMs: stats.queued ? Math.round(stats.totalQueueWaitMs / stats.queued) : 0,
    },
  };
}

/** 测试用：重置计数。 */
export function __resetGatewayStats(): void {
  Object.assign(stats, {
    accepted: 0, queued: 0, rejectedBusy: 0, timedOut: 0, failed: 0,
    totalQueueWaitMs: 0, maxQueueWaitMs: 0, peakInFlight: 0, peakQueueDepth: 0, connRetries: 0,
  });
}
