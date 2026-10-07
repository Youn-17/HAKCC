/**
 * 附件 → 可读正文 的解析链路。上传时和打开时走的是同一条，所以放在服务里，
 * 不留在路由中 —— 两处各写一份，迟早会在一处修了 bug 而另一处没修。
 *
 * PDF 走两条腿：本地 pdf-parse 立刻给一份能用的文字，MinerU 在后台把它升级成
 * 结构化 Markdown。让学生等一分钟才能提第一个问题，这功能就没人用。
 */
import { supabase } from '../config/supabase';
import { canExtractText, extractDocumentText } from './documentText';
import { fetchMinerUMarkdown, getMinerUTask, isMinerUConfigured, submitMinerUTask } from './mineru';
import type { PageMap } from './pageMap';

const MAX_DOC_BYTES = 20 * 1024 * 1024;
const PDF_MIME = 'application/pdf';

export interface DocumentNote {
  id: string;
  space_id: string;
  file_url: string | null;
  file_name: string | null;
  mime_type: string | null;
}

export interface DocumentTextResult {
  text: string;
  /** edited = 学生在平台上改过的版本，优先于任何自动解析结果 */
  source: 'mineru' | 'pdf' | 'docx' | 'plain' | 'edited' | 'none';
  /** true = MinerU 还在解析，隔几秒再取一次会拿到更好的版本 */
  pending: boolean;
  progress?: { done: number; total: number };
  minerUError?: string | null;
  /** 只有 PDF 有：正文第几个字起是第几页，知识库给片段标页码用 */
  pageMap?: PageMap | null;
}

export function isPdfDocument(mime: string, name: string): boolean {
  return mime === PDF_MIME || /\.pdf$/i.test(name);
}

/** 只读我们自己的桶：这里用服务端身份 fetch，放开任意 URL 就是 SSRF 跳板。 */
function assertOwnStorage(fileUrl: string): void {
  const { data } = supabase.storage.from('note-chat-attachments').getPublicUrl('');
  const prefix = data.publicUrl.replace(/\/$/, '');
  if (!fileUrl.startsWith(prefix)) throw new Error('只支持读取本平台存储里的附件。');
}

async function fetchAttachment(fileUrl: string): Promise<Buffer> {
  assertOwnStorage(fileUrl);
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error(`读取附件失败：HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > MAX_DOC_BYTES) throw new Error('文件过大，无法解析。');
  return buffer;
}

/** 解析结果的缓存。字段名和 document_renders 的列一一对应。 */
export interface CachedRender {
  markdown?: string | null;
  plain_text?: string | null;
  text_source?: string | null;
  mineru_task_id?: string | null;
  mineru_state?: string | null;
  mineru_error?: string | null;
  /** 对应当前最好的那份正文（有 markdown 就是 markdown 的，否则是 plain_text 的） */
  page_map?: PageMap | null;
}

/**
 * 缓存存在哪里由调用方决定：附件笔记存 document_renders（外键到 notes），
 * 课程资料不是笔记，存在 course_materials 自己的同名列上。
 * 解析和 MinerU 的推进逻辑只有下面这一份。
 */
export interface RenderCache {
  load(): Promise<CachedRender | null>;
  save(patch: CachedRender): Promise<void>;
}

export type DocumentFile = Pick<DocumentNote, 'file_url' | 'file_name' | 'mime_type'>;

function noteRenderCache(note: DocumentNote): RenderCache {
  return {
    async load() {
      const { data } = await supabase
        .from('document_renders')
        .select('markdown, plain_text, text_source, mineru_task_id, mineru_state, mineru_error, page_map')
        .eq('note_id', note.id)
        .maybeSingle();
      return (data as CachedRender | null) ?? null;
    },
    async save(patch) {
      const { error } = await supabase.from('document_renders').upsert({
        note_id: note.id,
        space_id: note.space_id,
        source_mime: note.mime_type || null,
        text_updated_at: new Date().toISOString(),
        ...patch,
      });
      // 缓存写失败不影响这次结果：下次重算就是了
      if (error) console.error('[DocPipeline] cache write failed:', error.message);
    },
  };
}

/**
 * 取这份附件当前能拿到的最好正文，并推进 MinerU 的解析。
 * 可以反复调用：结果都进缓存，已完成的直接命中。
 */
export async function resolveDocumentText(note: DocumentNote): Promise<DocumentTextResult> {
  return resolveDocumentTextWith(note, noteRenderCache(note));
}

/**
 * 附件换了新文件之后用（查看器里给 Markdown 附件存了新版本）。缓存的正文是按旧文件算的，
 * 而 resolveDocumentText 只要缓存里有 plain_text 就一直返回它，所以按现在的文件重抽一遍盖掉；
 * markdown 列和 MinerU 的任务也属于旧文件，一起清空。
 *
 * 读不到新文件就抛出、缓存不动：一次网络抖动不能被存成「这份文档没有字」。
 */
export async function refreshDocumentText(note: DocumentNote): Promise<DocumentTextResult> {
  const mime = note.mime_type ?? '';
  const name = note.file_name ?? '';
  const extracted = note.file_url && canExtractText(mime, name)
    ? await extractDocumentText(await fetchAttachment(note.file_url), mime, name)
    : null;
  const cache = noteRenderCache(note);
  await cache.save({
    markdown: null,
    plain_text: extracted?.text ?? '',
    text_source: extracted?.source ?? 'none',
    mineru_task_id: null,
    mineru_state: null,
    mineru_error: null,
    page_map: extracted?.pageMap?.length ? extracted.pageMap : null,
  });
  // PDF 按新文件重新提交 MinerU；其余格式抽出来的就是最终正文
  if (isPdfDocument(mime, name) && isMinerUConfigured()) return resolveDocumentTextWith(note, cache);
  return { text: extracted?.text ?? '', source: extracted?.source ?? 'none', pending: false, pageMap: extracted?.pageMap ?? null };
}

export async function resolveDocumentTextWith(note: DocumentFile, cache: RenderCache): Promise<DocumentTextResult> {
  const mime = note.mime_type ?? '';
  const name = note.file_name ?? '';

  const cached = await cache.load();

  if (cached?.markdown) {
    // markdown 现在有三个来源：MinerU 解析的 PDF、mammoth 转的 Word、学生编辑过的。
    // 标签要如实反映来源，不能一律当成 mineru。
    const source = (cached.text_source as DocumentTextResult['source']) ?? 'mineru';
    return { text: cached.markdown, source, pending: false, pageMap: cached.page_map ?? null };
  }
  if (!note.file_url) return { text: '', source: 'none', pending: false };

  const save = (patch: CachedRender) => cache.save(patch);

  // 本地兜底正文：只算一次
  let plain = cached?.plain_text ?? null;
  let plainPageMap: PageMap | null = cached?.markdown ? null : (cached?.page_map ?? null);
  if (plain === null && canExtractText(mime, name)) {
    try {
      const extracted = await extractDocumentText(await fetchAttachment(note.file_url), mime, name);
      plain = extracted?.text ?? '';
      plainPageMap = extracted?.pageMap?.length ? extracted.pageMap : null;
      await save({ plain_text: plain, text_source: extracted?.source ?? 'none', page_map: plainPageMap });
    } catch (err: any) {
      console.warn('[DocPipeline] local extract failed:', err?.message);
      plain = '';
      await save({ plain_text: '', text_source: 'none' });
    }
  }

  // 非 PDF 到此为止 —— Word 的正文由本地 mammoth 抽，质量已经够用
  if (!isPdfDocument(mime, name) || !isMinerUConfigured()) {
    return {
      text: plain ?? '',
      source: (cached?.text_source as DocumentTextResult['source']) ?? 'plain',
      pending: false,
      pageMap: plainPageMap,
    };
  }

  const state = cached?.mineru_state as string | null | undefined;
  let taskId = cached?.mineru_task_id as string | null | undefined;

  // 失败过就不再重试：同一份文件重复提交只会重复失败，还耗额度
  if (state === 'failed') {
    return { text: plain ?? '', source: 'pdf', pending: false, minerUError: cached?.mineru_error ?? null, pageMap: plainPageMap };
  }

  try {
    if (!taskId) {
      taskId = await submitMinerUTask(note.file_url);
      await save({ mineru_task_id: taskId, mineru_state: 'pending', mineru_error: null });
      return { text: plain ?? '', source: 'pdf', pending: true, pageMap: plainPageMap };
    }

    const task = await getMinerUTask(taskId);
    if (task.state === 'done' && task.fullZipUrl) {
      const { markdown, pageMap } = await fetchMinerUMarkdown(task.fullZipUrl);
      const markdownPageMap = pageMap.length ? pageMap : null;
      await save({ markdown, text_source: 'mineru', mineru_state: 'done', mineru_error: null, page_map: markdownPageMap });
      return { text: markdown, source: 'mineru', pending: false, pageMap: markdownPageMap };
    }
    if (task.state === 'failed') {
      await save({ mineru_state: 'failed', mineru_error: task.errMsg ?? '解析失败' });
      return { text: plain ?? '', source: 'pdf', pending: false, minerUError: task.errMsg ?? null, pageMap: plainPageMap };
    }

    await save({ mineru_state: task.state });
    return {
      text: plain ?? '',
      source: 'pdf',
      pending: true,
      pageMap: plainPageMap,
      progress: task.totalPages ? { done: task.extractedPages ?? 0, total: task.totalPages } : undefined,
    };
  } catch (err: any) {
    // MinerU 挂了不该让文档打不开：如实返回兜底正文，下一次请求再试
    console.error('[DocPipeline] MinerU failed:', err?.message);
    return { text: plain ?? '', source: 'pdf', pending: false, minerUError: err?.message ?? 'MinerU 不可用', pageMap: plainPageMap };
  }
}
