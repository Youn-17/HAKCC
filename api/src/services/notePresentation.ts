import { ApiError } from '../middleware/errorHandler';
import { updateNoteGuarded } from './noteMetadata';

/**
 * 卡片在画布上怎么呈现：固定（不能拖动、改大小），图片 / 视频附件显示成图还是条目。
 * 存在 notes.metadata 里，和位置一样是共享画布的版式，不是笔记内容。
 */
export type NotePresentation = {
  is_fixed?: boolean;
  display_mode?: 'media' | 'card';
};

/** 只收这两个键。多出来的键如果悄悄忽略，调用方会以为存上了，所以报 400。 */
export function parsePresentationPatch(body: unknown): NotePresentation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'is_fixed or display_mode required');
  }
  const { is_fixed, display_mode, ...rest } = body as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length > 0) throw new ApiError(400, `Unsupported fields: ${extra.join(', ')}`);

  const patch: NotePresentation = {};
  if (is_fixed !== undefined) {
    if (typeof is_fixed !== 'boolean') throw new ApiError(400, 'is_fixed must be a boolean');
    patch.is_fixed = is_fixed;
  }
  if (display_mode !== undefined) {
    if (display_mode !== 'media' && display_mode !== 'card') {
      throw new ApiError(400, "display_mode must be 'media' or 'card'");
    }
    patch.display_mode = display_mode;
  }
  if (Object.keys(patch).length === 0) throw new ApiError(400, 'is_fixed or display_mode required');
  return patch;
}

/**
 * 把 patch 合并进笔记的 metadata，其余键原样保留，返回合并后的 metadata。
 *
 * 以读到的旧值为条件写，没写中就重读再合并（见 updateNoteGuarded）。
 * 只是「读、合并、写」的话，两人几乎同时改不同的键，后写的会带着旧值把先写的冲掉。
 */
export async function mergeNoteMetadata(
  noteId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { metadata } = await updateNoteGuarded(noteId, row => ({ metadata: { ...row.metadata, ...patch } }));
  return metadata as Record<string, unknown>;
}
