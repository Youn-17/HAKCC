import { aiFetch } from './aiGateway';
/**
 * Model Router — task-aware model selection with health-based auto-switching.
 *
 * DMX (dmxapi.cn) aggregates 500+ models behind one key with no gateway-level
 * concurrency cap; the practical bottleneck is per-model upstream rate limits.
 * This router keeps a health scoreboard per model (429/5xx/timeouts trigger
 * exponential-backoff cooldowns; successes clear them and track latency), so
 * under classroom load traffic automatically spreads across model tiers
 * instead of piling onto one rate-limited model.
 *
 * Only meaningful for the dmx/dmxapi provider — other providers keep their
 * single configured model.
 */

import { TASK_TIERS, preferredNativeModel } from './modelCatalog';
import { freeCapacity } from './aiGateway';

export type TaskKind = 'agent' | 'chat' | 'fast' | 'vision' | 'image_gen' | 'embedding' | 'search';

// 任务分档来自 modelCatalog —— 全平台唯一一份清单，模型名都对过官方价目表。
// 排在前面的先用，失败了下面的健康度记分板会自动往后走。
const MODEL_TIERS: Record<TaskKind, string[]> = {
  agent: [...TASK_TIERS.agent],
  chat: [...TASK_TIERS.chat],
  fast: [...TASK_TIERS.fast],
  vision: [...TASK_TIERS.vision],
  image_gen: [...TASK_TIERS.image_gen],
  embedding: [...TASK_TIERS.embedding],
  search: [...TASK_TIERS.search],
};

// 教师用厂商自有 key、且模型选了「自动」时，按目录顺序挑第一个他启用了的（逻辑在 modelCatalog）。
export function pickNativeModel(providerId: string, enabledModels: string[] | null | undefined): string | null {
  return preferredNativeModel(providerId, enabledModels);
}

export function isDmxProvider(providerId: string | null | undefined): boolean {
  return providerId === 'dmx' || providerId === 'dmxapi';
}

// ── Health scoreboard ──────────────────────────────────────────

type FailureKind = 'rate_limit' | 'server' | 'timeout' | 'other';

interface ModelHealth {
  consecutiveFailures: number;
  cooldownUntil: number;
  latencyEmaMs: number;
  totalCalls: number;
  totalFailures: number;
  lastFailureKind: FailureKind | null;
  lastUsedAt: number;
}

const health = new Map<string, ModelHealth>();

function getHealth(model: string): ModelHealth {
  let h = health.get(model);
  if (!h) {
    h = { consecutiveFailures: 0, cooldownUntil: 0, latencyEmaMs: 0, totalCalls: 0, totalFailures: 0, lastFailureKind: null, lastUsedAt: 0 };
    health.set(model, h);
  }
  return h;
}

export function reportModelSuccess(model: string, latencyMs: number): void {
  const h = getHealth(model);
  h.consecutiveFailures = 0;
  h.cooldownUntil = 0;
  h.totalCalls++;
  h.lastUsedAt = Date.now();
  h.latencyEmaMs = h.latencyEmaMs === 0 ? latencyMs : Math.round(h.latencyEmaMs * 0.7 + latencyMs * 0.3);
}

export function reportModelFailure(model: string, kind: FailureKind): void {
  const h = getHealth(model);
  h.consecutiveFailures++;
  h.totalCalls++;
  h.totalFailures++;
  h.lastFailureKind = kind;
  h.lastUsedAt = Date.now();
  // Rate limits cool down aggressively (that model is saturated right now);
  // server errors more gently; exponential backoff capped at 10 minutes.
  const base = kind === 'rate_limit' ? 60_000 : kind === 'timeout' ? 45_000 : 30_000;
  const backoff = Math.min(base * Math.pow(2, h.consecutiveFailures - 1), 600_000);
  h.cooldownUntil = Date.now() + backoff;
  console.warn(`[modelRouter] ${model} cooling down ${Math.round(backoff / 1000)}s after ${kind} (${h.consecutiveFailures} consecutive)`);
}

export function classifyHttpFailure(status: number): FailureKind {
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'other';
}

// ── Provider-level health (native first-party keys) ────────────
// The user's native DeepSeek/GLM keys are preferred but concurrency-capped.
// When one hits its limit we cool the whole provider down so auto-selection
// immediately falls through to DMX, then let it back in after the backoff.

const providerKey = (providerId: string) => `provider:${providerId}`;

export function reportProviderFailure(providerId: string, kind: FailureKind): void {
  reportModelFailure(providerKey(providerId), kind);
}

export function reportProviderSuccess(providerId: string): void {
  reportModelSuccess(providerKey(providerId), 0);
}

export function isProviderCoolingDown(providerId: string): boolean {
  return getHealth(providerKey(providerId)).cooldownUntil > Date.now();
}

/**
 * 给厂商排序：先健康的、再有空位的，最后按教师的偏好顺序。
 *
 * 教师同时配了 DMX / DeepSeek / GLM Coding Plan / Kimi 四把 key。原来的做法是
 * 「健康的保持偏好顺序」——结果一个班 52 个人的请求全压在第一把 key 上，
 * 把它打到限流，另外三把闲着。现在只要第一把的并发名额用完，后面的请求自动
 * 落到第二把上；第一把腾出名额又会自动回去。不是轮询，所以不会来回抖动。
 *
 * 冷却中的沉到最后（按最早恢复排）。DMX 是溢出车道，不参与「没空位就下沉」，
 * 因为聚合网关的并发余量比自有 key 大得多。
 */
export function orderConfigsByHealth<T extends { provider_id: string }>(configs: T[]): T[] {
  const now = Date.now();
  const cooldownOf = (c: T) => {
    if (isDmxProvider(c.provider_id)) return 0;
    const h = getHealth(providerKey(c.provider_id));
    return h.cooldownUntil > now ? h.cooldownUntil : 0;
  };
  const hasRoom = (c: T) => isDmxProvider(c.provider_id) || freeCapacity(c.provider_id) > 0;

  const order = new Map(configs.map((c, i) => [c, i]));
  return [...configs].sort((a, b) => {
    const ca = cooldownOf(a);
    const cb = cooldownOf(b);
    if ((ca === 0) !== (cb === 0)) return ca === 0 ? -1 : 1;   // 健康的在前
    if (ca !== 0 && cb !== 0) return ca - cb;                   // 都在冷却：早恢复的在前
    const ra = hasRoom(a);
    const rb = hasRoom(b);
    if (ra !== rb) return ra ? -1 : 1;                          // 有空位的在前
    return (order.get(a) ?? 0) - (order.get(b) ?? 0);           // 其余保持教师的偏好顺序
  });
}

/**
 * Ordered candidate models for a task: healthy tier members first (tier
 * order preserved), then cooling-down ones ordered by soonest recovery, so
 * callers can walk the list as a failover chain.
 */
export function pickModels(kind: TaskKind): string[] {
  const tier = MODEL_TIERS[kind] ?? MODEL_TIERS.chat;
  const now = Date.now();
  const ready = tier.filter(m => getHealth(m).cooldownUntil <= now);
  const cooling = tier
    .filter(m => getHealth(m).cooldownUntil > now)
    .sort((a, b) => getHealth(a).cooldownUntil - getHealth(b).cooldownUntil);
  return [...ready, ...cooling];
}

export function pickModel(kind: TaskKind): string {
  return pickModels(kind)[0];
}

/** Observability snapshot for the router. */
export function routerStats(): Record<string, unknown> {
  const now = Date.now();
  const models: Record<string, unknown> = {};
  for (const [model, h] of health) {
    models[model] = {
      calls: h.totalCalls,
      failures: h.totalFailures,
      latencyMs: h.latencyEmaMs,
      coolingDown: h.cooldownUntil > now,
      cooldownRemainingS: h.cooldownUntil > now ? Math.round((h.cooldownUntil - now) / 1000) : 0,
      lastFailureKind: h.lastFailureKind,
    };
  }
  return { tiers: MODEL_TIERS, models };
}

// ── Image generation (OpenAI-compatible /v1/images/generations) ─

export interface ImageGenResult {
  ok: boolean;
  url?: string;
  b64?: string;
  model?: string;
  error?: string;
}

function imagesEndpointFrom(chatEndpoint: string): string {
  if (chatEndpoint.includes('/chat/completions')) {
    return chatEndpoint.replace('/chat/completions', '/images/generations');
  }
  return 'https://www.dmxapi.cn/v1/images/generations';
}

/**
 * Generate an image through DMX, walking the image_gen tier with automatic
 * failover. Returns a hosted URL when the provider gives one, otherwise the
 * base64 payload.
 */
export async function generateImage(params: {
  apiKey: string;
  chatEndpoint: string;
  prompt: string;
  size?: string;
  /** 课程 AI 设置里给生图指定的 DMX 型号：先试它，失败再走分档 */
  preferredModel?: string;
}): Promise<ImageGenResult> {
  const endpoint = imagesEndpointFrom(params.chatEndpoint);
  const size = params.size && /^\d{3,4}x\d{3,4}$/.test(params.size) ? params.size : '1024x1024';
  const tier = pickModels('image_gen');
  const candidates = (params.preferredModel
    ? [params.preferredModel, ...tier.filter(m => m !== params.preferredModel)]
    : tier).slice(0, 3);

  for (const model of candidates) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      const resp = await aiFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt: params.prompt.slice(0, 2000),
          n: 1,
          size,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        reportModelFailure(model, classifyHttpFailure(resp.status));
        const errText = (await resp.text()).slice(0, 200);
        console.error(`[modelRouter] image_gen ${model} HTTP ${resp.status}: ${errText}`);
        continue;
      }

      const json = await resp.json() as any;
      const item = json?.data?.[0];
      const url: string | undefined = item?.url;
      const b64: string | undefined = item?.b64_json;
      if (!url && !b64) {
        reportModelFailure(model, 'other');
        continue;
      }
      reportModelSuccess(model, Date.now() - started);
      return { ok: true, url, b64, model };
    } catch (e) {
      reportModelFailure(model, e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'other');
      console.error(`[modelRouter] image_gen ${model} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { ok: false, error: '图像生成暂时不可用，所有生图模型都在冷却中，请稍后再试。' };
}
