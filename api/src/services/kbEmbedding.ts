/** Course-material embeddings use the server-side OpenRouter key and a model/dimension identity. Provider request settings are configured in code; performance and data handling require installation-specific verification. */
import { aiFetch } from './aiGateway';
import { CHAT_ENDPOINTS } from './providerEndpoints';
import { TtlCache } from './ttlCache';

export const KB_EMBEDDING_MODEL = 'voyageai/voyage-4-lite';
export const KB_EMBEDDING_DIMENSIONS = 1024;
/** kb_chunk_vectors.model 的值。检索只在同一个值的向量里比，换模型或换维度就是换这个值 */
export const KB_VECTOR_MODEL = `${KB_EMBEDDING_MODEL}@${KB_EMBEDDING_DIMENSIONS}`;

const EMBEDDINGS_URL = `${CHAT_ENDPOINTS.openrouter.replace(/\/chat\/completions\/?$/, '')}/embeddings`;
/** 片段约 800 字；这是给异常长的片段兜底，免得整批被接口以超长拒掉 */
const MAX_INPUT_CHARS = 6000;

function platformKey(): string {
  return (process.env.KB_OPENROUTER_API_KEY ?? '').trim();
}

export function kbEmbeddingConfigured(): boolean {
  return platformKey().length > 0;
}

/**
 * input：这批输入本身被接口拒了（400/413），原样再发也没用；
 * service：接口或网络的问题，过一会儿再试。
 */
export class KbEmbeddingError extends Error {
  constructor(message: string, readonly kind: 'input' | 'service') {
    super(message);
    this.name = 'KbEmbeddingError';
  }
}

/* Implementation notes are described in the public update guide. */
export function decodeEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.every(x => typeof x === 'number' && Number.isFinite(x)) ? raw as number[] : null;
  if (typeof raw !== 'string') return null;
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 0 || buf.length % 4 !== 0) return null;
  const out = new Array<number>(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out.every(Number.isFinite) ? out : null;
}

/** 写进 halfvec 的文本。半精度只有三位多有效数字，写五位足够，请求体比默认的十几位小一半 */
export function toHalfvecLiteral(vector: number[]): string {
  return `[${vector.map(x => Number(x.toPrecision(5))).join(',')}]`;
}

export async function embedKbTexts(
  texts: string[],
  opts: { timeoutMs: number; label: string; signal?: AbortSignal; queueTimeoutMs?: number },
): Promise<number[][]> {
  const key = platformKey();
  if (!key) throw new KbEmbeddingError('KB_OPENROUTER_API_KEY 没有配置', 'service');

  // aiFetch 的超时只管到响应头，读响应体不算在里面；这里自己计时，连读完响应体一起算
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
  if (opts.signal?.aborted) controller.abort();
  try {
    const res = await aiFetch(EMBEDDINGS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: KB_EMBEDDING_MODEL,
        input: texts.map(t => t.slice(0, MAX_INPUT_CHARS)),
        provider: { data_collection: 'deny' },
      }),
      signal: controller.signal,
    }, {
      timeoutMs: opts.timeoutMs,
      label: opts.label,
      // 单独的并发桶（aiGateway 的 kb-embed），补发的请求不占 AI 对话的名额；也不占提问者本人的名额
      provider: 'kb-embed',
      userId: null,
      ...(opts.queueTimeoutMs ? { queueTimeoutMs: opts.queueTimeoutMs } : {}),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new KbEmbeddingError(`HTTP ${res.status}: ${body.slice(0, 160)}`, res.status === 400 || res.status === 413 ? 'input' : 'service');
    }
    let json: { data?: Array<{ index?: number; embedding?: unknown }> } | null = null;
    try { json = JSON.parse(body); } catch { /* 下面按格式不对处理 */ }
    const rows = Array.isArray(json?.data) ? json!.data!.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
    const vectors = rows.map(r => decodeEmbedding(r.embedding));
    // 维度不对要当场拦下：同一个 model 值下混进别的维度，这门课的向量就没法比了
    if (vectors.length !== texts.length || vectors.some(v => !v || v.length !== KB_EMBEDDING_DIMENSIONS)) {
      throw new KbEmbeddingError(
        `响应不对：${vectors.length}/${texts.length} 条，维度 ${vectors[0]?.length ?? '无'}`,
        'service',
      );
    }
    return vectors as number[][];
  } catch (e) {
    if (e instanceof KbEmbeddingError) throw e;
    const reason = controller.signal.aborted ? `超时或取消（${opts.timeoutMs}ms 内没拿到）` : (e instanceof Error ? e.message : String(e));
    throw new KbEmbeddingError(reason, 'service');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

export const isInputError = (e: unknown): boolean => e instanceof KbEmbeddingError && e.kind === 'input';

export interface HedgeOptions {
  /** 隔多久再补发一路；在飞的都已经失败了就不等，马上补发 */
  every: number;
  /** 最多发几路 */
  max: number;
  /** 总时间，到了就放弃 */
  budgetMs: number;
  /** 遇到这种错误不再补发，直接失败（内容被拒，换一路也一样） */
  stopOn?: (e: unknown) => boolean;
}

/* Implementation notes are described in the public update guide. */
export function hedged<T>(run: (signal: AbortSignal) => Promise<T>, opts: HedgeOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controllers: AbortController[] = [];
    let settled = false;
    let failures = 0;
    let nextTimer: ReturnType<typeof setTimeout> | undefined;
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    const done = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(nextTimer);
      clearTimeout(budgetTimer);
      for (const c of controllers) c.abort();
      finish();
    };
    const launch = () => {
      if (settled || controllers.length >= opts.max) return;
      const c = new AbortController();
      controllers.push(c);
      clearTimeout(nextTimer);
      if (controllers.length < opts.max) nextTimer = setTimeout(launch, opts.every);
      run(c.signal).then(value => done(() => resolve(value)), (e: unknown) => {
        if (settled) return;
        failures += 1;
        if (opts.stopOn?.(e) || failures >= opts.max) done(() => reject(e));
        else if (failures >= controllers.length) launch();
      });
    };
    budgetTimer = setTimeout(
      () => done(() => reject(new KbEmbeddingError(`${opts.budgetMs}ms 内没拿到`, 'service'))),
      opts.budgetMs,
    );
    launch();
  });
}

/** 学生提问时现算的查询向量：最多三路，隔 1.2 秒补发一路，4 秒拿不到就这次不检索 */
const QUERY_HEDGE = { every: 1_200, max: 3, budgetMs: 4_000, stopOn: isInputError };
/** 同一个问题 10 分钟内不重算（模型重打同一句、学生连问两遍时直接命中） */
const queryCache = new TtlCache<number[]>(10 * 60_000, 500);

/** 拿不到返回 null，调用方当作这次检索不到 */
export async function embedKbQuery(query: string): Promise<number[] | null> {
  const text = query.trim();
  if (!text || !kbEmbeddingConfigured()) return null;
  const cacheKey = text.toLowerCase();
  const cached = queryCache.get(cacheKey);
  if (cached) return cached;
  const vector = await hedged(
    signal => embedKbTexts([text], { timeoutMs: QUERY_HEDGE.budgetMs, label: 'kb-query', signal, queueTimeoutMs: 1_000 }).then(r => r[0]),
    QUERY_HEDGE,
  ).catch((e: unknown) => {
    console.warn(`[KB] 查询向量没拿到，这次不检索课程资料：${e instanceof Error ? e.message : e}`);
    return null;
  });
  if (vector) queryCache.set(cacheKey, vector);
  return vector;
}

export function __clearKbQueryCache(): void {
  queryCache.clear();
}
