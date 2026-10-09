import { supabase } from '../config/supabase';
import { ApiError } from '../middleware/errorHandler';

/**
 * notes.metadata 是几样互不相干的东西拼成的一块 jsonb：固定、附件显示方式（共享版式，空间成员都能改），
 * 以及 Markdown 附件被换下来的旧版本（mdVersions）。客户端手里的那块可能是几分钟前的，
 * 整块写回会冲掉别人在这期间改的键，所以都在服务端读、改，再以读到的旧值为条件写回。
 */

const MAX_ATTEMPTS = 3;

/** 最多记几条旧版本。旧文件本身一直留在存储里，这里记的是找回它们的地址。 */
export const MAX_MD_VERSIONS = 20;

export const MARKDOWN_CONFLICT_MESSAGE = 'Someone saved a newer version of this document while you were editing';

export interface GuardedNoteRow {
  metadata: Record<string, unknown>;
  file_url: string | null;
  file_name: string | null;
  mime_type: string | null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * 读出笔记，用 build 算出要写的列，以读到的 metadata 和 file_url 为条件写回（jsonb 相等不看键序）。
 * 没写中说明读和写之间有人改过这一行，重读再算；三次都没写中就报 409，不硬写。
 * build 抛出的错误原样抛给调用方，不重试。返回写进去的列。
 */
export async function updateNoteGuarded(
  noteId: string,
  build: (row: GuardedNoteRow) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: row, error } = await supabase
      .from('notes')
      .select('metadata, file_url, file_name, mime_type')
      .eq('id', noteId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!row) throw new ApiError(404, 'Note not found');

    const fileUrl = (row.file_url as string | null) ?? null;
    const changes = build({
      metadata: asObject(row.metadata),
      file_url: fileUrl,
      file_name: (row.file_name as string | null) ?? null,
      mime_type: (row.mime_type as string | null) ?? null,
    });

    let update = supabase.from('notes').update(changes).eq('id', noteId);
    update = row.metadata == null
      ? update.is('metadata', null)
      : update.eq('metadata', JSON.stringify(row.metadata));
    update = fileUrl === null ? update.is('file_url', null) : update.eq('file_url', fileUrl);
    const { data: written, error: writeError } = await update.select('id');
    if (writeError) throw new ApiError(500, writeError.message);
    if (written && written.length > 0) return changes;
  }
  throw new ApiError(409, 'The note changed while saving, please retry');
}

/** 和文档查看器判断「这是 Markdown」的口径一致（FileViewerPage 的 isMarkdown）。 */
export function isMarkdownFile(mimeType: string | null | undefined, fileName: string | null | undefined): boolean {
  return mimeType === 'text/markdown'
    || mimeType === 'text/x-markdown'
    || /\.(md|markdown)$/i.test(fileName ?? '');
}

/** 把换下来的文件地址记进 mdVersions，只留最近 MAX_MD_VERSIONS 条。 */
export function withMdVersion(
  metadata: Record<string, unknown>,
  replacedUrl: string | null,
  by: string,
  at = new Date().toISOString(),
): Record<string, unknown> {
  if (!replacedUrl) return metadata;
  const previous = Array.isArray(metadata.mdVersions) ? metadata.mdVersions : [];
  return {
    ...metadata,
    mdVersions: [...previous, { url: replacedUrl, replacedAt: at, by }].slice(-MAX_MD_VERSIONS),
  };
}

/**
 * 旧客户端经 PUT 发来的整块 metadata：按键合并。mdVersions 只由服务端记，客户端带来的不要，
 * 否则一块打开阅读器时的旧 metadata 就能把别人后来记下的版本冲掉。
 * collaborative_document 同样由服务端拥有，客户端不能用整块 metadata 修改正文的存储归属。
 */
export function mergeClientMetadata(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...current, ...patch };
  if ('mdVersions' in current) next.mdVersions = current.mdVersions;
  else delete next.mdVersions;
  // The collaborative-body owner is server-authored and cannot be forged or removed by old clients.
  if ('collaborative_document' in current) next.collaborative_document = current.collaborative_document;
  else delete next.collaborative_document;
  return next;
}

/**
 * 把 Markdown 附件指向新文件，换下来的地址记进 mdVersions，返回写入后的 metadata。
 *
 * baseFileUrl 是编辑者打开文档时的文件地址。它已经不是当前地址，说明编辑期间有人存过新版本：
 * 报 409，不覆盖对方的版本。不传就不比。
 */
export async function replaceMarkdownFile(
  noteId: string,
  file: { file_url: string; file_name: string; mime_type: string },
  by: string,
  baseFileUrl?: string | null,
): Promise<Record<string, unknown>> {
  const changes = await updateNoteGuarded(noteId, row => {
    if (baseFileUrl !== undefined && baseFileUrl !== row.file_url) {
      throw new ApiError(409, MARKDOWN_CONFLICT_MESSAGE);
    }
    return {
      file_url: file.file_url,
      file_name: file.file_name,
      mime_type: file.mime_type,
      metadata: withMdVersion(row.metadata, row.file_url, by),
      updated_at: new Date().toISOString(),
    };
  });
  return changes.metadata as Record<string, unknown>;
}
