/** Optional server-side DMX connection keep-warm. Uses KB_DMX_API_KEY only while recent user activity is present. Background calls may consume provider credits. */
import { aiFetch, lastUserRequestTime } from './aiGateway';
import { CHAT_ENDPOINTS } from './providerEndpoints';

const DMX_EMBEDDINGS_URL = `${CHAT_ENDPOINTS.dmx.replace(/\/chat\/completions\/?$/, '')}/embeddings`;
/** 最小的请求：qwen3.7-text-embedding 最小 256 维（64、128 报 400），响应约 1.5KB */
const PING_BODY = JSON.stringify({ model: 'qwen3.7-text-embedding', input: ['ping'], dimensions: 256, encoding_format: 'base64' });

const TICK_MS = 3_000;
const AFTER_IDLE_MS = 6_000;
const ONLY_IF_USED_WITHIN_MS = 30 * 60_000;

let lastOkAt = 0;
let warming = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let reportTimer: ReturnType<typeof setInterval> | null = null;
const count = { sent: 0, failed: 0 };

function dmxKey(): string {
  return (process.env.KB_DMX_API_KEY ?? '').trim();
}

export async function keepWarmTick(now = Date.now()): Promise<boolean> {
  const key = dmxKey();
  if (warming || !key) return false;
  if (now - lastUserRequestTime() > ONLY_IF_USED_WITHIN_MS) return false;
  if (now - lastOkAt < AFTER_IDLE_MS) return false;
  warming = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await aiFetch(DMX_EMBEDDINGS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: PING_BODY,
      signal: controller.signal,
    }, { provider: 'dmx', userId: null, label: 'dmx-keepwarm', timeoutMs: 6_000, queueTimeoutMs: 500 });
    await res.text();
    count.sent += 1;
    if (res.ok) lastOkAt = Date.now();
    else count.failed += 1;
    return res.ok;
  } catch {
    count.sent += 1;
    count.failed += 1;
    return false;
  } finally {
    clearTimeout(timer);
    warming = false;
  }
}

export function startDmxKeepWarm(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => { void keepWarmTick(); }, TICK_MS);
  tickTimer.unref?.();
  reportTimer = setInterval(() => {
    if (count.sent === 0) return;
    console.log(`[DMX] 连接保温：近一小时发了 ${count.sent} 次，失败 ${count.failed} 次`);
    count.sent = 0;
    count.failed = 0;
  }, 60 * 60_000);
  reportTimer.unref?.();
}

export function __resetDmxKeepWarm(): void {
  if (tickTimer) clearInterval(tickTimer);
  if (reportTimer) clearInterval(reportTimer);
  tickTimer = null;
  reportTimer = null;
  count.sent = 0;
  count.failed = 0;
  warming = false;
  lastOkAt = 0;
}
