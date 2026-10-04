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
import { generateEmbedding, resolveEmbeddingProvider } from './embeddingService';

/** 一次入库最多向量化多少片。超长材料先入库，向量慢慢补，不阻塞。 */
const MAX_EMBED_PER_RUN = 120;
/** 连续这么多片拿不到向量就停手，剩下的留空，等下次重新入库时再补。 */
const EMBED_FAILURE_LIMIT = 3;

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
  createdBy?: string | null;
}

export interface IngestResult {
  documentId: string | null;
  chunks: number;
  embedded: number;
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
    return { documentId: null, chunks: 0, embedded: 0, skipped: true, reason: 'too_short' };
  }

  const source = params.materialId
    ? { column: 'material_id', id: params.materialId, type: 'material', onConflict: 'course_id,material_id' }
    : params.noteId
      ? { column: 'note_id', id: params.noteId, type: 'attachment', onConflict: 'course_id,note_id' }
      : null;
  if (!source) {
    return { documentId: null, chunks: 0, embedded: 0, skipped: true, reason: 'no_source' };
  }

  const hash = hashOf(content);

  const { data: existing } = await supabase
    .from('kb_documents')
    .select('id, content_hash, status')
    .eq('course_id', params.courseId)
    .eq(source.column, source.id)
    .maybeSingle();

  if (existing?.content_hash === hash && existing.status === 'ready') {
    return { documentId: existing.id as string, chunks: 0, embedded: 0, skipped: true, reason: 'unchanged' };
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
    return { documentId: null, chunks: 0, embedded: 0, skipped: true, reason: 'db_error' };
  }
  const documentId = doc.id as string;

  // 内容变了就整份重切：增量对齐旧片段的成本远高于重来一遍
  await supabase.from('kb_chunks').delete().eq('document_id', documentId);

  const chunks = chunkMarkdown(content);
  if (chunks.length === 0) {
    await supabase.from('kb_documents')
      .update({ status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', documentId);
    return { documentId, chunks: 0, embedded: 0, skipped: false };
  }

  // 向量拿不到不算失败：没有 embedding 的片段仍可被全文检索命中，
  // 而且供应商恢复后可以补 —— 因为向量化失败就整份材料不入库是本末倒置。
  const provider = await resolveEmbeddingProvider(params.courseId).catch(() => null);
  let embedded = 0;
  let consecutiveFailures = 0;

  const rows: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    let embedding: number[] | null = null;
    // 连续失败就别再试了。第一次上线时 endpoint 配错，54 个片段各发了一次
    // 注定 403 的请求 —— 供应商挂了或密钥不对时，重试整篇只是白白的负荷。
    const giveUp = consecutiveFailures >= EMBED_FAILURE_LIMIT;
    if (provider && !giveUp && embedded < MAX_EMBED_PER_RUN) {
      // 把标题路径一起送去向量化：「教师」这一段脱离「角色与组织结构」就没有意义
      const forEmbedding = chunk.headingPath ? `${chunk.headingPath}\n${chunk.content}` : chunk.content;
      embedding = await generateEmbedding(forEmbedding, provider);
      if (embedding) { embedded += 1; consecutiveFailures = 0; }
      else consecutiveFailures += 1;
    }
    rows.push({
      document_id: documentId,
      course_id: params.courseId,
      ordinal: chunk.ordinal,
      heading_path: chunk.headingPath,
      content: chunk.content,
      char_count: chunk.content.length,
      embedding: embedding ? JSON.stringify(embedding) : null,
      embedding_model: embedding ? provider?.model ?? null : null,
    });
  }

  const { error: chunkErr } = await supabase.from('kb_chunks').insert(rows);
  if (chunkErr) {
    console.error('[KB] insert chunks failed:', chunkErr.message);
    await supabase.from('kb_documents')
      .update({ status: 'failed', error: chunkErr.message, updated_at: new Date().toISOString() })
      .eq('id', documentId);
    return { documentId, chunks: 0, embedded: 0, skipped: true, reason: 'db_error' };
  }

  await supabase.from('kb_documents')
    .update({ status: 'ready', updated_at: new Date().toISOString() })
    .eq('id', documentId);

  if (provider && embedded === 0 && chunks.length > 0) {
    console.error(`[KB] 全部片段都没拿到向量（course ${params.courseId}）—— 检索会退化为不可用`);
  }
  return { documentId, chunks: chunks.length, embedded, skipped: false };
}

export interface KbHit {
  chunkId: string;
  documentId: string;
  title: string;
  headingPath: string | null;
  content: string;
  similarity: number;
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
  const provider = await resolveEmbeddingProvider(courseId).catch(() => null);
  if (!provider) return [];

  // 向量要调外部接口，范围只查库，一起发
  const [vector, standing, spaceIds] = await Promise.all([
    generateEmbedding(query, provider),
    getCourseStanding(courseId, viewer),
    enterableSpaceIds(courseId, viewer),
  ]);
  if (!vector || standing === 'none') return [];

  const { data, error } = await supabase.rpc('match_kb_chunks', {
    p_course_id: courseId,
    p_query_embedding: JSON.stringify(vector),
    p_match_count: limit,
    p_space_ids: spaceIds,
  });
  if (error) {
    console.error('[KB] search failed:', error.message);
    return [];
  }

  // 数据库已经按范围筛过。这里再核一遍：函数哪天被改回只按课程过滤，少给几片也不能给错
  const enterable = new Set(spaceIds);
  const visible = (row: any) => (row.space_id ? enterable.has(row.space_id) : Boolean(row.material_id));
  return (data ?? []).filter(visible).map((row: any) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: row.title,
    headingPath: row.heading_path,
    content: row.content,
    similarity: Number(row.similarity ?? 0),
  }));
}

/** 一门课知识库的概况，给教师端看。 */
export async function knowledgeBaseStats(courseId: string) {
  const [{ data: docs }, { count: chunkCount }, { count: embeddedCount }] = await Promise.all([
    supabase.from('kb_documents').select('id, title, status, char_count, updated_at').eq('course_id', courseId),
    supabase.from('kb_chunks').select('id', { count: 'exact', head: true }).eq('course_id', courseId),
    supabase.from('kb_chunks').select('id', { count: 'exact', head: true }).eq('course_id', courseId).not('embedding', 'is', null),
  ]);
  return {
    documents: docs ?? [],
    chunks: chunkCount ?? 0,
    embeddedChunks: embeddedCount ?? 0,
  };
}
