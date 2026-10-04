/**
 * Embedding Service — generate and manage vector embeddings for semantic search.
 *
 * Uses the course's configured AI provider to generate embeddings when possible,
 * with a fallback to simple TF-IDF-style text similarity when no embedding
 * provider is available.
 *
 * Theoretical grounding:
 *   - KB Design Principle: "Knowledge Building discourse is more than
 *     conversation" — semantic search captures conceptual relationships
 *     that keyword matching misses.
 *   - Enables cross-pollination of ideas across notes that use different
 *     vocabulary for the same concepts.
 */

import { createHash } from 'node:crypto';
import { supabase } from '../config/supabase';
import { decryptProviderApiKey } from './aiProviderConfig';
import { assertSafePublicUrl } from './urlGuard';
import { aiFetch } from './aiGateway';
import { TtlCache } from './ttlCache';
import { isDmxProvider } from './modelRouter';
import { CHAT_ENDPOINTS } from './providerEndpoints';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** note_embeddings.embedding 与 kb_chunks.embedding 都声明为 vector(1536)。 */
export const EMBEDDING_DIMENSIONS = 1536;

type EmbeddingProvider = {
  apiKey: string;
  endpointUrl: string;
  model: string;
};

// ---------------------------------------------------------------------------
// Content hashing — skip re-embedding unchanged content
// ---------------------------------------------------------------------------

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function stripHtmlForEmbedding(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Embedding generation
// ---------------------------------------------------------------------------

export async function generateEmbedding(
  text: string,
  provider: EmbeddingProvider,
  options: { timeoutMs?: number } = {},
): Promise<number[] | null> {
  const truncated = text.slice(0, 8000);

  try {
    await assertSafePublicUrl(provider.endpointUrl);
    const response = await aiFetch(provider.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        input: truncated,
      }),
    }, options.timeoutMs ? { timeoutMs: options.timeoutMs, label: 'embedding' } : undefined);

    if (!response.ok) {
      console.error('[EmbeddingService] Provider returned', response.status);
      return null;
    }

    const json = (await response.json()) as any;
    const embedding = json?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      console.error('[EmbeddingService] Invalid embedding response structure');
      return null;
    }
    // 列声明是 vector(1536)。维度不符要当场发现 —— 混进别的维度会让整张表的
    // 检索静默失真，比拿不到向量糟糕得多。
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      console.error(
        `[EmbeddingService] 维度不符：模型 ${provider.model} 返回 ${embedding.length}，期望 ${EMBEDDING_DIMENSIONS}`,
      );
      return null;
    }
    return embedding;
  } catch (err) {
    console.error('[EmbeddingService] Embedding generation failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolve embedding provider from course config
// ---------------------------------------------------------------------------

export async function resolveEmbeddingProvider(
  courseId: string,
): Promise<EmbeddingProvider | null> {
  const { data: configs } = await supabase
    .from('teacher_ai_configs')
    .select('provider_id, api_key_encrypted, endpoint_url')
    .eq('course_id', courseId)
    .eq('is_verified', true);

  if (!configs || configs.length === 0) return null;

  for (const cfg of configs) {
    const providerId = cfg.provider_id as string;
    const endpointUrl = cfg.endpoint_url as string | null;

    // 线上三门课配的 provider_id 是 'dmx'，这里原来只认 'dmxapi'，
    // 于是 resolveEmbeddingProvider 一直返回 null —— 向量检索对所有课都跑不起来。
    if (providerId === 'openai' || isDmxProvider(providerId)) {
      // 兜底地址原来对所有 provider 都写死 https://api.openai.com，
      // 于是拿 DMX 的 key 去调 OpenAI，每一片都 403。
      // 基址要按 provider 自己的聊天端点推出来。
      const chatEndpoint = endpointUrl ?? CHAT_ENDPOINTS[providerId] ?? 'https://api.openai.com/v1/chat/completions';
      const baseUrl = chatEndpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
      return {
        apiKey: decryptProviderApiKey(cfg.api_key_encrypted),
        endpointUrl: `${baseUrl}/embeddings`,
        model: 'text-embedding-3-small',
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate and store an embedding for a note.
 * Skips if the content hasn't changed since last embedding.
 */
export async function embedNote(
  noteId: string,
  courseId: string,
  content: string,
): Promise<boolean> {
  const plainText = stripHtmlForEmbedding(content);
  if (plainText.length < 10) return false;

  const hash = contentHash(plainText);

  const { data: existing } = await supabase
    .from('note_embeddings')
    .select('content_hash')
    .eq('note_id', noteId)
    .maybeSingle();

  if (existing?.content_hash === hash) return true;

  const provider = await resolveEmbeddingProvider(courseId);
  if (!provider) return false;

  const embedding = await generateEmbedding(plainText, provider);
  if (!embedding) return false;

  const { error } = await supabase
    .from('note_embeddings')
    .upsert(
      {
        note_id: noteId,
        content_hash: hash,
        embedding: JSON.stringify(embedding),
        model: provider.model,
      },
      { onConflict: 'note_id' },
    );

  if (error) {
    console.error('[EmbeddingService] Upsert failed:', error.message);
    return false;
  }
  return true;
}

/**
 * Semantic search: find notes similar to a query string.
 * Falls back to keyword search if no embeddings are available.
 */
/**
 * 检索一个查询向量最多等多久。
 * 2026-09-10 实测 DMX 的 /embeddings 一半请求 10s 后连接层报错，成功的也要 2.6–4.4s；
 * 工具整体上限 15s，等满就是模型看到超时再重打一次。有向量的空间等 6s，没有就不等。
 */
const QUERY_EMBEDDING_TIMEOUT_MS = 6_000;

/** 空间有没有向量：60s 内不重复问。 */
const spaceHasVectors = new TtlCache<boolean>(60_000, 2000);
/** 同一个查询串 10 分钟内不重复算向量（模型重打同一句时直接命中）。 */
const queryEmbeddings = new TtlCache<number[]>(10 * 60_000, 500);

async function spaceHasEmbeddings(spaceId: string): Promise<boolean> {
  const cached = spaceHasVectors.get(spaceId);
  if (cached !== undefined) return cached;
  const { count, error } = await supabase
    .from('note_embeddings')
    .select('note_id, notes!inner(space_id)', { count: 'exact', head: true })
    .eq('notes.space_id', spaceId);
  const has = !error && (count ?? 0) > 0;
  spaceHasVectors.set(spaceId, has);
  return has;
}

export async function semanticSearchNotes(
  query: string,
  spaceId: string,
  courseId: string,
  limit = 8,
): Promise<Array<{ noteId: string; title: string; content: string; similarity: number }>> {
  // 空间里一条向量都没有时，算查询向量纯属浪费（线上三门课至今全是 0 条），直接让调用方走关键词。
  if (!(await spaceHasEmbeddings(spaceId))) return [];

  const provider = await resolveEmbeddingProvider(courseId);
  if (!provider) return [];

  const cacheKey = `${courseId}:${query.trim().toLowerCase()}`;
  let queryEmbedding = queryEmbeddings.get(cacheKey) ?? null;
  if (!queryEmbedding) {
    queryEmbedding = await generateEmbedding(query, provider, { timeoutMs: QUERY_EMBEDDING_TIMEOUT_MS });
    if (queryEmbedding) queryEmbeddings.set(cacheKey, queryEmbedding);
  }
  if (!queryEmbedding) return [];

  const { data, error } = await supabase.rpc('match_notes', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_space_id: spaceId,
    match_threshold: 0.3,
    match_count: limit,
  });

  if (error) {
    console.error('[EmbeddingService] Semantic search failed:', error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    noteId: row.note_id,
    title: row.title ?? 'Untitled Note',
    content: row.content ?? '',
    similarity: row.similarity,
  }));
}

/**
 * Batch embed all notes in a space that don't have embeddings yet.
 */
export async function embedSpaceNotes(
  spaceId: string,
  courseId: string,
): Promise<{ embedded: number; skipped: number; failed: number }> {
  const { data: notes } = await supabase
    .from('notes')
    .select('id, content')
    .eq('space_id', spaceId)
    .is('deleted_at', null);

  if (!notes || notes.length === 0) return { embedded: 0, skipped: 0, failed: 0 };

  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  for (const note of notes) {
    const content = (note as any).content as string | null;
    if (!content || stripHtmlForEmbedding(content).length < 10) {
      skipped++;
      continue;
    }
    const ok = await embedNote((note as any).id, courseId, content);
    if (ok) embedded++;
    else failed++;
  }

  return { embedded, skipped, failed };
}
