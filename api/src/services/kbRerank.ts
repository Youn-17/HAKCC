/** Optional course-material reranking via OpenRouter. Scores below the configured threshold are excluded; the default threshold is not a validated research cutoff. */
import { aiFetch } from './aiGateway';
import { hedged, isInputError, KbEmbeddingError } from './kbEmbedding';
import { CHAT_ENDPOINTS } from './providerEndpoints';

export const KB_RERANK_MODEL = 'voyageai/rerank-3-lite';
export const KB_RERANK_THRESHOLD = 0.5;

const RERANK_URL = `${CHAT_ENDPOINTS.openrouter.replace(/\/chat\/completions\/?$/, '')}/rerank`;
/** 片段约 800 字，这是给异常长的兜底 */
const MAX_DOC_CHARS = 2000;
/* Implementation notes are described in the public update guide. */
const RERANK_HEDGE = { every: 1_500, max: 2, budgetMs: 3_000, stopOn: isInputError };

function platformKey(): string {
  return (process.env.KB_OPENROUTER_API_KEY ?? '').trim();
}

async function rerankOnce(query: string, documents: string[], signal: AbortSignal): Promise<number[]> {
  const res = await aiFetch(RERANK_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${platformKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: KB_RERANK_MODEL,
      query,
      documents: documents.map(d => d.slice(0, MAX_DOC_CHARS)),
      top_n: documents.length,
      provider: { data_collection: 'deny' },
    }),
    // 读响应体也受这个 signal 管：hedged 到点会取消
    signal,
  }, {
    // 和知识库的向量请求同一个并发桶，不占 AI 对话的名额，也不算在提问者头上
    provider: 'kb-embed',
    userId: null,
    label: 'kb-rerank',
    timeoutMs: RERANK_HEDGE.budgetMs,
    queueTimeoutMs: 1_000,
  });
  const body = await res.text();
  if (!res.ok) {
    throw new KbEmbeddingError(`HTTP ${res.status}: ${body.slice(0, 160)}`, res.status === 400 || res.status === 413 ? 'input' : 'service');
  }
  let json: { results?: Array<{ index?: number; relevance_score?: number }> } | null = null;
  try { json = JSON.parse(body); } catch { /* 下面按格式不对处理 */ }
  const scores: Array<number | null> = documents.map(() => null);
  for (const r of json?.results ?? []) {
    if (Number.isInteger(r.index) && r.index! >= 0 && r.index! < documents.length && typeof r.relevance_score === 'number') {
      scores[r.index!] = r.relevance_score;
    }
  }
  if (scores.some(s => s === null)) throw new KbEmbeddingError('响应不对：有段落没打分', 'service');
  return scores as number[];
}

/**
 * 每段的相关度（0–1，和 documents 一一对应）。拿不到（没配 key、超时、出错）返回 null，调用方按原来的顺序用。
 */
export async function rerankKb(query: string, documents: string[]): Promise<number[] | null> {
  if (documents.length === 0 || !platformKey()) return null;
  return hedged(signal => rerankOnce(query, documents, signal), RERANK_HEDGE).catch((e: unknown) => {
    console.warn(`[KB] 重排没拿到，这次按向量的顺序给：${e instanceof Error ? e.message : e}`);
    return null;
  });
}
