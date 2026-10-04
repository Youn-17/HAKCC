import { aiFetch, isAiBusy } from './aiGateway';
import { DMX_TEXT_MODELS, DMX_VISION_MODELS, NATIVE_MODELS, TASK_TIERS, applyModelQuirks, extractChatContent } from './modelCatalog';
import { reportModelFailure, reportModelSuccess, classifyHttpFailure } from './modelRouter';

/**
 * 逐个模型打一次最小请求，看它到底能不能用。
 *
 * 「模型要稳定运行」没法靠读文档保证 —— 目录里写着的名字，厂商可能已经下线，
 * 也可能这个 key 没开通。唯一可靠的办法是真打一次。这个探测器就是干这个的：
 * 每个模型发一句最短的提示、限 8 个 token，记录 HTTP 状态和耗时。
 *
 * 探测结果会喂给 modelRouter 的健康度记分板，所以开课前跑一遍，
 * 挂掉的模型当场进冷却，不会被排到学生头上。
 */

export interface ProbeResult {
  model: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
}

export interface ProbeReport {
  provider: string;
  endpoint: string;
  probedAt: string;
  total: number;
  okCount: number;
  results: ProbeResult[];
}

async function probeOne(endpoint: string, apiKey: string, model: string): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const resp = await aiFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(applyModelQuirks(model, {
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 24,
        stream: false,
      })),
      // userId 传 null：探测是教师的批量操作，不该被「每人 2 路」这条
      // 防止学生霸占队列的规则卡住——那条规则管的是学生的交互请求。
    }, { timeoutMs: 45_000, queueTimeoutMs: 90_000, label: 'probe', userId: null });

    const latencyMs = Date.now() - started;
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 160);
      reportModelFailure(model, classifyHttpFailure(resp.status));
      return { model, ok: false, status: resp.status, latencyMs, error: body };
    }
    // 200 也可能是错误体（部分网关这样返回），要看有没有真的产出内容
    const json = await resp.json().catch(() => null) as any;
    const choice = json?.choices?.[0];
    const content = extractChatContent(json);

    // 探测只回答「这个模型接不接受我们的请求、能不能正常产出」。
    // 推理型号（kimi-k3 等）会先烧思考 token，24 个预算下正文常常是空的、
    // finish_reason=length —— 那是**成功**的调用，不能判成模型坏了。
    const truncated = choice?.finish_reason === 'length';
    if (content === null && !truncated) {
      reportModelFailure(model, 'other');
      const shape = JSON.stringify(choice ?? json ?? {}).slice(0, 200);
      return { model, ok: false, status: resp.status, latencyMs, error: `200 但取不到正文：${shape}` };
    }
    reportModelSuccess(model, latencyMs);
    return { model, ok: true, status: resp.status, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - started;
    if (isAiBusy(e)) return { model, ok: false, latencyMs, error: '闸门排队超时（并发已满）' };
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    reportModelFailure(model, e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'other');
    return { model, ok: false, latencyMs, error: msg.slice(0, 160) };
  }
}

/** 这个厂商值得探测哪些模型。 */
export function probeTargets(providerId: string, extra?: string[]): string[] {
  const explicit = (extra ?? []).filter(Boolean);
  if (explicit.length) return [...new Set(explicit)];
  if (providerId === 'dmx' || providerId === 'dmxapi') {
    return [...new Set([
      ...DMX_TEXT_MODELS.map(m => m.id),
      ...DMX_VISION_MODELS.map(m => m.id),
      ...TASK_TIERS.fast,
    ])];
  }
  return (NATIVE_MODELS[providerId] ?? []).map(m => m.id);
}

/**
 * 并行发出，并发由闸门压住（dmx 桶默认 16）。
 * 串行跑 26 个模型会超过 Cloudflare 的 100 秒上限，代理直接返回 524。
 */
export async function probeProvider(params: {
  providerId: string;
  endpoint: string;
  apiKey: string;
  models?: string[];
}): Promise<ProbeReport> {
  const models = probeTargets(params.providerId, params.models);
  const results = await Promise.all(
    models.map(model => probeOne(params.endpoint, params.apiKey, model)),
  );
  return {
    provider: params.providerId,
    endpoint: params.endpoint,
    probedAt: new Date().toISOString(),
    total: results.length,
    okCount: results.filter(r => r.ok).length,
    results: results.sort((a, b) => Number(b.ok) - Number(a.ok) || a.latencyMs - b.latencyMs),
  };
}

// ── 负载测试 ──────────────────────────────────────────────────

export interface LoadTestReport {
  requested: number;
  wallMs: number;
  ok: number;
  failed: number;
  busy: number;
  throughputPerSec: number;
  latency: { p50: number; p90: number; p99: number; max: number };
  byProvider: Record<string, { sent: number; ok: number; p50: number }>;
  errors: Record<string, number>;
  gateway: Record<string, unknown>;
}

const percentile = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
};

/**
 * 打 N 路并发，看这套东西在一个班同时用的时候是什么样。
 *
 * 每一路都当作**不同的学生**（userId 各不相同），因为「每人 2 路」那条规则
 * 管的是单个学生，不该影响对全班容量的测量。
 * 请求本身刻意做到最小（一句 ping、24 个 token），量的是链路而不是模型的生成速度。
 */
export async function loadTest(params: {
  targets: Array<{ providerId: string; endpoint: string; apiKey: string; model: string }>;
  concurrency: number;
}): Promise<LoadTestReport> {
  const n = Math.min(Math.max(1, params.concurrency), 200);
  const targets = params.targets;
  if (!targets.length) throw new Error('没有可用的厂商配置');

  const started = Date.now();
  const outcomes = await Promise.all(Array.from({ length: n }, async (_, i) => {
    // 轮流打到各把 key 上，模拟路由把一个班摊开的效果
    const t = targets[i % targets.length];
    const t0 = Date.now();
    try {
      const resp = await aiFetch(t.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` },
        body: JSON.stringify(applyModelQuirks(t.model, {
          model: t.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 24,
          stream: false,
        })),
      }, {
        provider: t.providerId,
        userId: `loadtest-${i}`,          // 每一路当成不同的学生
        timeoutMs: 60_000,
        queueTimeoutMs: 60_000,
        label: 'loadtest',
      });
      const ms = Date.now() - t0;
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 80);
        return { provider: t.providerId, ok: false, ms, err: `HTTP ${resp.status} ${body}` };
      }
      await resp.json().catch(() => null);
      return { provider: t.providerId, ok: true, ms };
    } catch (e) {
      const ms = Date.now() - t0;
      if (isAiBusy(e)) return { provider: t.providerId, ok: false, ms, err: 'BUSY 闸门拒绝', busy: true };
      return { provider: t.providerId, ok: false, ms, err: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 80) : String(e) };
    }
  }));

  const wallMs = Date.now() - started;
  const lat = outcomes.map(o => o.ms);
  const errors: Record<string, number> = {};
  for (const o of outcomes) if (o.err) errors[o.err] = (errors[o.err] ?? 0) + 1;

  const byProvider: LoadTestReport['byProvider'] = {};
  for (const t of targets) {
    const mine = outcomes.filter(o => o.provider === t.providerId);
    if (!mine.length) continue;
    byProvider[t.providerId] = {
      sent: mine.length,
      ok: mine.filter(o => o.ok).length,
      p50: percentile(mine.map(o => o.ms), 0.5),
    };
  }

  const { gatewayStats } = await import('./aiGateway');
  return {
    requested: n,
    wallMs,
    ok: outcomes.filter(o => o.ok).length,
    failed: outcomes.filter(o => !o.ok && !o.busy).length,
    busy: outcomes.filter(o => o.busy).length,
    throughputPerSec: Math.round((n / (wallMs / 1000)) * 100) / 100,
    latency: { p50: percentile(lat, .5), p90: percentile(lat, .9), p99: percentile(lat, .99), max: Math.max(...lat) },
    byProvider,
    errors,
    gateway: gatewayStats(),
  };
}
