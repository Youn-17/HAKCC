/**
 * 课程知识库。上传的材料解析后按课程存进来，切片并向量化，供检索增强使用。
 *
 * 为什么是检索而不是微调：一门课一个微调模型无法管理，加一份文档就得重训，
 * 跨课程的泄露也很难防。检索天然按课程隔离、加材料立刻生效、成本低一到两个数量级。
 *
 * 隔离是这里最重要的性质。kb_chunks 冗余存了一份 course_id，检索时直接按它过滤 ——
 * 少一层 join 就少一个把别的课程材料混进来的机会，而那会直接污染整群随机实验的数据。
 * 课内同样要隔离：附件跟着它所在的空间走，绑定小组的空间只对本组开放，见 searchKnowledgeBase。
 */
import { createHash } from 'node:crypto';
import { supabase } from '../config/supabase';
import type { AuthUser } from '../middleware/auth';
import { enterableSpaceIds, getCourseStanding } from './accessControl';
import { chunkMarkdown } from './kbChunker';
import { embedKbQuery, kbEmbeddingConfigured, KB_VECTOR_MODEL, toHalfvecLiteral } from './kbEmbedding';
import { KB_RERANK_THRESHOLD, rerankKb } from './kbRerank';
import { kbQueryTerms, kbSearchFields } from './kbTokens';
import { pagesForChunks, shiftPageMap, type PageMap } from './pageMap';
import { kickKbVectors } from './kbVectorJob';

export interface IngestParams {
  courseId: string;
  spaceId?: string | null;
  /** 来源二选一：知识空间里的附件笔记，或教师在课程设置里上传的课程资料。 */
  noteId?: string | null;
  materialId?: string | null;
  title: string;
  fileName?: string | null;
  mimeType?: string | null;
  /** 'mineru' | 'pdf' | 'docx' | 'plain' | 'markdown' */
  textSource?: string | null;
  content: string;
  /** PDF 才有：正文第几个字起是第几页，给片段标起止页（见 pageMap.ts） */
  pageMap?: PageMap | null;
  createdBy?: string | null;
}

export interface IngestResult {
  documentId: string | null;
  chunks: number;
  skipped: boolean;
  reason?: string;
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/**
 * 把一份材料写进知识库。内容没变就直接跳过 —— 同一份 PDF 会被反复触发
 * （每次打开 AI 侧栏都会走一遍解析链路），重复切片和向量化纯属浪费。
 */
export async function ingestDocument(params: IngestParams): Promise<IngestResult> {
  const content = (params.content ?? '').trim();
  if (content.length < 80) {
    return { documentId: null, chunks: 0, skipped: true, reason: 'too_short' };
  }

  const source = params.materialId
    ? { column: 'material_id', id: params.materialId, type: 'material', onConflict: 'course_id,material_id' }
    : params.noteId
      ? { column: 'note_id', id: params.noteId, type: 'attachment', onConflict: 'course_id,note_id' }
      : null;
  if (!source) {
    return { documentId: null, chunks: 0, skipped: true, reason: 'no_source' };
  }

  const hash = hashOf(content);

  const { data: existing } = await supabase
    .from('kb_documents')
    .select('id, content_hash, status')
    .eq('course_id', params.courseId)
    .eq(source.column, source.id)
    .maybeSingle();

  if (existing?.content_hash === hash && existing.status === 'ready') {
    return { documentId: existing.id as string, chunks: 0, skipped: true, reason: 'unchanged' };
  }

  const { data: doc, error: docErr } = await supabase
    .from('kb_documents')
    .upsert({
      ...(existing?.id ? { id: existing.id } : {}),
      course_id: params.courseId,
      space_id: params.spaceId ?? null,
      [source.column]: source.id,
      source_type: source.type,
      title: params.title,
      file_name: params.fileName ?? null,
      mime_type: params.mimeType ?? null,
      text_source: params.textSource ?? null,
      content,
      content_hash: hash,
      char_count: content.length,
      status: 'parsing',
      error: null,
      created_by: params.createdBy ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: source.onConflict })
    .select('id')
    .single();

  if (docErr || !doc) {
    console.error('[KB] upsert document failed:', docErr?.message);
    return { documentId: null, chunks: 0, skipped: true, reason: 'db_error' };
  }
  const documentId = doc.id as string;

  // 内容变了就整份重切：增量对齐旧片段的成本远高于重来一遍
  await supabase.from('kb_chunks').delete().eq('document_id', documentId);

  const chunks = chunkMarkdown(content);
  if (chunks.length === 0) {
    await supabase.from('kb_documents')
      .update({ status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', documentId);
    return { documentId, chunks: 0, skipped: false };
  }

  // 向量不在这里算：片段先落库，后台任务（kbVectorJob）成批补齐。原来在这里一片一片现算，
  // 关键词检索的词序列是本地算的，随片段一起写。页码按对照表算；正文开头被 trim 掉的字要从对照表里扣掉
  const leading = (params.content ?? '').length - (params.content ?? '').trimStart().length;
  const pages = pagesForChunks(content, chunks, shiftPageMap(params.pageMap, leading));
  const rows = chunks.map((chunk, i) => ({
    document_id: documentId,
    course_id: params.courseId,
    ordinal: chunk.ordinal,
    heading_path: chunk.headingPath,
    content: chunk.content,
    char_count: chunk.content.length,
    page_start: pages[i].start,
    page_end: pages[i].end,
    ...kbSearchFields(chunk.headingPath, chunk.content),
  }));

  const { error: chunkErr } = await supabase.from('kb_chunks').insert(rows);
  if (chunkErr) {
    console.error('[KB] insert chunks failed:', chunkErr.message);
    await supabase.from('kb_documents')
      .update({ status: 'failed', error: chunkErr.message, updated_at: new Date().toISOString() })
      .eq('id', documentId);
    return { documentId, chunks: 0, skipped: true, reason: 'db_error' };
  }

  await supabase.from('kb_documents')
    .update({ status: 'ready', updated_at: new Date().toISOString() })
    .eq('id', documentId);

  kickKbVectors();
  return { documentId, chunks: chunks.length, skipped: false };
}

export interface KbHit {
  chunkId: string;
  documentId: string;
  title: string;
  headingPath: string | null;
  content: string;
  /** 向量相似度；关键词那一路找到的没有这个数（BM25 分数和它不能比），为 null */
  similarity: number | null;
  /** 重排给的相关度（0–1，门槛 0.5）；这次没重排成（超时、出错）为 null */
  relevance: number | null;
  matchedBy: 'vector' | 'keyword';
  /** PDF 才有的起止页；其他格式、或者 084 之前入库还没补上的为 null */
  pageStart: number | null;
  pageEnd: number | null;
  /** 来源二选一：知识空间里的附件笔记（来源卡片点开原文用），或课程设置里上传的课程资料 */
  noteId: string | null;
  materialId: string | null;
}

/**
 * 在一门课的知识库里检索，只给调用者看得到的那部分。**course_id 是硬过滤，不是排序权重** ——
 * 别的课程的材料一条都不该出现。
 *
 * 课内也不是全都能看：附件跟着它所在的空间走，调用者进不去的空间（别组的绑组空间）里的附件
 * 一片都不给，不然组 A 的学生问一句，AI 就把组 B 上传的材料念出来了。教师在课程设置里上传的
 * 课程资料不属于任何空间，全课可见；不在课里的人什么都拿不到。
 *
 * 范围交给数据库在取前 k 片之前过滤：先取再筛的话，别组的材料一多，本组能看的就被挤出前 k 了。
 */
export async function searchKnowledgeBase(
  courseId: string,
  viewer: Pick<AuthUser, 'id' | 'role'>,
  query: string,
  limit = 6,
): Promise<KbHit[]> {
  return (await searchKnowledgeBaseDetailed(courseId, viewer, query, limit)).hits;
}

export interface KbSearchResult {
  hits: KbHit[];
  /** false：这次查询向量没拿到，只按关键词查了。这时没找到不等于资料里没有，给模型的话要说清 */
  semantic: boolean;
  /** true：重排跑成了，hits 都过了相关度门槛；hits 为空就是候选里没有够格的 */
  reranked: boolean;
}

/** 检索记录（kb_retrieval_logs.source）里的来源：笔记 AI、知识空间助手的自动检索，智能体调工具 */
export type KbSearchSource = 'note_ai' | 'workspace_ai' | 'agent_tool';

export interface KbSearchOptions {
  /** 记进检索记录的来源；不传就不记（测试、评测脚本、老师的检索测试） */
  source?: KbSearchSource;
}

/** 候选：向量前 20 段，加上关键词前 10 段里不重复的，交给重排 */
const VECTOR_CANDIDATES = 20;
const KEYWORD_CANDIDATES = 10;

type Candidate = Omit<KbHit, 'relevance'>;

const toCandidate = (row: any, matchedBy: 'vector' | 'keyword'): Candidate => ({
  chunkId: row.chunk_id,
  documentId: row.document_id,
  title: row.title,
  headingPath: row.heading_path,
  content: row.content,
  similarity: matchedBy === 'vector' ? Number(row.similarity ?? 0) : null,
  matchedBy,
  pageStart: Number.isInteger(row.page_start) ? row.page_start : null,
  pageEnd: Number.isInteger(row.page_end) ? row.page_end : null,
  noteId: row.note_id ?? null,
  materialId: row.material_id ?? null,
});

export async function searchKnowledgeBaseDetailed(
  courseId: string,
  viewer: Pick<AuthUser, 'id' | 'role'>,
  query: string,
  limit = 6,
  opts: KbSearchOptions = {},
): Promise<KbSearchResult> {
  const started = Date.now();
  // 向量要调外部接口，范围只查库，一起发
  const [vector, standing, spaceIds] = await Promise.all([
    kbEmbeddingConfigured() ? embedKbQuery(query) : Promise.resolve(null),
    getCourseStanding(courseId, viewer),
    enterableSpaceIds(courseId, viewer),
  ]);
  if (standing === 'none') return { hits: [], semantic: true, reranked: false };
  const embedMs = Date.now() - started;

  const [vectorRows, keywordRows] = await Promise.all([
    vector ? matchVectors(courseId, vector, spaceIds) : Promise.resolve([] as any[]),
    matchKeywords(courseId, query, spaceIds),
  ]);
  // 数据库已经按范围筛过。这里再核一遍：函数哪天被改回只按课程过滤，少给几片也不能给错
  const visible = visibleTo(spaceIds);
  const candidates: Candidate[] = vectorRows.filter(visible).map(row => toCandidate(row, 'vector'));
  const seen = new Set(candidates.map(c => c.chunkId));
  for (const row of keywordRows.filter(visible)) {
    if (!seen.has(row.chunk_id)) candidates.push(toCandidate(row, 'keyword'));
  }

  const rerankStarted = Date.now();
  const scores = await rerankKb(query, candidates.map(c => (c.headingPath ? `${c.headingPath}\n${c.content}` : c.content)));
  const rerankMs = Date.now() - rerankStarted;

  let hits: KbHit[];
  let ranked: Array<{ chunkId: string; relevance: number | null }>;
  if (scores) {
    const scored = candidates.map((c, i) => ({ ...c, relevance: scores[i] })).sort((a, b) => b.relevance - a.relevance);
    ranked = scored;
    // 低于门槛的不给模型；只按关键词找到的（查询向量没拿到）最多 3 段，交给模型时还要说明可能不相关
    hits = scored.filter(h => h.relevance >= KB_RERANK_THRESHOLD).slice(0, vector ? limit : Math.min(limit, KEYWORD_FALLBACK_MAX));
  } else if (vector) {
    // 重排没回来：按向量的顺序给，不卡门槛（和上线重排之前一样）
    hits = candidates.filter(c => c.matchedBy === 'vector').slice(0, limit).map(c => ({ ...c, relevance: null }));
    ranked = hits;
  } else {
    hits = keywordFallback(keywordRows.filter(visible), query, limit);
    ranked = hits;
  }

  const result = { hits, semantic: Boolean(vector), reranked: Boolean(scores) };
  if (opts.source) {
    logRetrieval({
      courseId, userId: viewer.id, source: opts.source, query, result, candidates: candidates.length, ranked,
      embedMs, rerankMs: scores ? rerankMs : null, totalMs: Date.now() - started,
    });
  }
  return result;
}

/**
 * 这门课现在有没有 AI 检索得到的片段（开着的课程资料，或者附件开关开着时没删的附件，见 085 的 kb_course_searchable）。
 * 笔记 AI 和知识空间助手每轮都会先问一次：没有就不调向量接口，也不在过程里显示「检索课程资料」。
 * 结果缓存一分钟，刚上传的资料最多晚一分钟开始被检索（入库本身也要这么久）；老师改开关时清掉这门课的缓存。
 */
const KB_PRESENCE_TTL_MS = 60_000;
const kbPresence = new Map<string, { has: boolean; at: number }>();

export async function courseHasKnowledgeBase(courseId: string): Promise<boolean> {
  const cached = kbPresence.get(courseId);
  if (cached && Date.now() - cached.at < KB_PRESENCE_TTL_MS) return cached.has;
  const { data, error } = await supabase.rpc('kb_course_searchable', { p_course_id: courseId });
  if (error) throw new Error(`kb_course_searchable: ${error.message}`);
  const has = data === true;
  kbPresence.set(courseId, { has, at: Date.now() });
  return has;
}

export function invalidateKbPresence(courseId: string): void {
  kbPresence.delete(courseId);
}

/** 测试用：清掉上面的缓存 */
export function __resetKbPresence(): void {
  kbPresence.clear();
}

async function matchVectors(courseId: string, vector: number[], spaceIds: string[]): Promise<any[]> {
  // 只在同一个模型的向量里比（kb_chunk_vectors.model），换模型时新旧向量不会混在一起
  const { data, error } = await supabase.rpc('match_kb_chunk_vectors', {
    p_course_id: courseId,
    p_model: KB_VECTOR_MODEL,
    p_query_embedding: toHalfvecLiteral(vector),
    p_match_count: VECTOR_CANDIDATES,
    p_space_ids: spaceIds,
  });
  if (error) {
    console.error('[KB] search failed:', error.message);
    return [];
  }
  return data ?? [];
}

async function matchKeywords(courseId: string, query: string, spaceIds: string[]): Promise<any[]> {
  const terms = kbQueryTerms(query);
  if (terms.length === 0) return [];
  const { data, error } = await supabase.rpc('match_kb_chunks_keyword', {
    p_course_id: courseId,
    p_terms: terms,
    p_match_count: KEYWORD_CANDIDATES,
    p_space_ids: spaceIds,
  });
  if (error) {
    console.error('[KB] keyword search failed:', error.message);
    return [];
  }
  return data ?? [];
}

function visibleTo(spaceIds: string[]) {
  const enterable = new Set(spaceIds);
  return (row: any) => (row.space_id ? enterable.has(row.space_id) : Boolean(row.material_id));
}

/* Implementation notes are described in the public update guide. */
const KEYWORD_FALLBACK_MAX = 3;

function keywordFallback(rows: any[], query: string, limit: number): KbHit[] {
  const needed = Math.min(2, kbQueryTerms(query).length);
  return rows
    .filter((row: any) => Number(row.matched_terms ?? 0) >= needed)
    .slice(0, Math.min(limit, KEYWORD_FALLBACK_MAX))
    .map((row: any) => ({ ...toCandidate(row, 'keyword'), relevance: null }));
}

/**
 * 每次检索记一行（只有后端读），攒起来调相关度门槛：问了什么、候选几段、重排后的前 10 段和分数、给出去几段、各步耗时。
 * 后台写，失败只记日志，不拖慢回答。
 */
function logRetrieval(entry: {
  courseId: string; userId: string; source: NonNullable<KbSearchOptions['source']>; query: string;
  result: KbSearchResult; candidates: number; ranked: Array<{ chunkId: string; relevance: number | null }>;
  embedMs: number; rerankMs: number | null; totalMs: number;
}): void {
  const top = entry.ranked.slice(0, 10);
  void Promise.resolve(supabase.from('kb_retrieval_logs').insert({
    course_id: entry.courseId,
    user_id: entry.userId,
    source: entry.source,
    query: entry.query.slice(0, 500),
    semantic: entry.result.semantic,
    reranked: entry.result.reranked,
    candidates: entry.candidates,
    returned: entry.result.hits.length,
    ranked_ids: top.map(r => r.chunkId),
    ranked_scores: entry.result.reranked ? top.map(r => Number((r.relevance ?? 0).toFixed(4))) : [],
    embed_ms: entry.embedMs,
    rerank_ms: entry.rerankMs,
    total_ms: entry.totalMs,
  })).then(({ error }: { error: { message: string } | null }) => {
    if (error) console.warn('[KB] retrieval log failed:', error.message);
  }, (err: unknown) => console.warn('[KB] retrieval log failed:', err instanceof Error ? err.message : err));
}

/**
 * 082 之前入库的片段没有关键词的词序列：启动时补一遍。本地算，不调外部接口，
 * 一批 200 片写回（kb_set_search_text 按 id 更新）。
 */
export async function fillMissingSearchText(batch = 200): Promise<number> {
  let filled = 0;
  for (let round = 0; round < 100; round++) {
    const { data, error } = await supabase
      .from('kb_chunks')
      .select('id, heading_path, content')
      .is('search_text', null)
      .limit(batch);
    if (error) throw new Error(`kb_chunks: ${error.message}`);
    if (!data || data.length === 0) break;
    const rows = data.map((c: any) => ({ id: c.id, ...kbSearchFields(c.heading_path, c.content ?? '') }));
    const { data: updated, error: writeError } = await supabase.rpc('kb_set_search_text', { p_rows: rows });
    if (writeError) throw new Error(`kb_set_search_text: ${writeError.message}`);
    filled += Number(updated ?? 0);
    if (data.length < batch) break;
  }
  if (filled > 0) console.log(`[KB] 补了 ${filled} 片的关键词检索词`);
  return filled;
}

export interface KbDocumentCounts {
  chunks: number;
  /** 有当前模型向量的片段数 */
  embedded: number;
  /** 还有片段没向量、后台会补（平台 key 配了）。没配 key 时为 false：那是补不上的 */
  pending: boolean;
}

/** 一门课每份文档的片段数和其中有向量的片段数，在库里数好（资料列表用） */
export async function kbDocumentCounts(courseId: string): Promise<Map<string, KbDocumentCounts>> {
  const { data, error } = await supabase.rpc('kb_document_vector_counts', {
    p_course_id: courseId,
    p_model: KB_VECTOR_MODEL,
  });
  if (error) throw new Error(`kb_document_vector_counts: ${error.message}`);
  const configured = kbEmbeddingConfigured();
  const counts = new Map<string, KbDocumentCounts>();
  for (const row of (data ?? []) as Array<{ document_id: string; chunks: number | string; embedded: number | string }>) {
    const chunks = Number(row.chunks);
    const embedded = Number(row.embedded);
    counts.set(row.document_id, { chunks, embedded, pending: configured && embedded < chunks });
  }
  return counts;
}

/** 一门课知识库的概况，给教师端看。 */
export async function knowledgeBaseStats(courseId: string) {
  const [{ data: docs }, counts] = await Promise.all([
    supabase.from('kb_documents').select('id, title, status, char_count, updated_at').eq('course_id', courseId),
    kbDocumentCounts(courseId),
  ]);
  let chunks = 0;
  let embeddedChunks = 0;
  for (const c of counts.values()) {
    chunks += c.chunks;
    embeddedChunks += c.embedded;
  }
  return {
    documents: docs ?? [],
    chunks,
    embeddedChunks,
  };
}
