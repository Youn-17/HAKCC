/**
 * 上传附件的内容校验。
 *
 * 抽出来是因为求助也要传截图，而截图不一定发生在某个知识空间里 ——
 * 学生可能就在仪表盘上卡住。两条上传路径必须走同一套校验，
 * 否则新开的那条迟早比老的松，而松的那条就是入口。
 *
 * 关键点：声明的 MIME 类型来自客户端，不能信。真正算数的是字节。
 */

import { ApiError } from '../middleware/errorHandler';

/** SVG 是可执行文档，不是图片。放进公开 bucket 按 image/svg+xml 发出去，
 *  等于让上传者的脚本跑在存储域上，每个打开它的同学都中招。 */
const BLOCKED_TYPES = new Set([
  'image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml',
]);

const DOC_TYPES = new Set([
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export interface ValidateOptions {
  /** 只收图片（求助截图）还是也收文档与音视频（画布附件）。 */
  imagesOnly?: boolean;
  maxBytes?: number;
}

export interface ValidatedUpload {
  buffer: Buffer;
  mimeType: string;
  /** 清洗过的文件名，可直接拼进存储路径。 */
  safeName: string;
}

/** 图片的魔数。声明成 PNG 实际是别的东西，就在这里被拦下。 */
export function looksLikeImage(buffer: Buffer): boolean {
  const sig = buffer.subarray(0, 12);
  const isPng = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47;
  const isJpeg = sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff;
  const isGif = sig.subarray(0, 3).toString('ascii') === 'GIF';
  const isWebp = sig.subarray(0, 4).toString('ascii') === 'RIFF' && sig.subarray(8, 12).toString('ascii') === 'WEBP';
  const isBmp = sig[0] === 0x42 && sig[1] === 0x4d;
  return isPng || isJpeg || isGif || isWebp || isBmp;
}

/** 开头看起来像标记语言就拒。即便扩展名和 MIME 都伪装成图片。 */
export function looksLikeMarkup(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 512).toString('utf8').trim().toLowerCase();
  return head.startsWith('<svg') || head.startsWith('<?xml')
    || head.startsWith('<!doctype html') || head.startsWith('<html');
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file';
}

/**
 * 只看声明的类型和文件名，不看字节。
 *
 * 直传存储时，签发上传地址那一刻服务端还没有文件，能查的只有这些。
 * 字节层面的检查在文件落盘之后由 verifyStoredBytes 补上 —— 两步都不能省：
 * 声明的 MIME 是客户端说的，字节才算数。
 */
export function validateDeclaredUpload(
  fileName: string,
  mimeType: string,
  opts: ValidateOptions = {},
): { safeName: string; isImage: boolean } {
  if (BLOCKED_TYPES.has(mimeType)) {
    throw new ApiError(400, '出于安全考虑不支持 SVG / HTML 文件，请改用 PNG、JPG 等格式。');
  }
  const isImage = mimeType.startsWith('image/');
  const allowed = opts.imagesOnly
    ? isImage
    : isImage || mimeType.startsWith('video/') || mimeType.startsWith('audio/') || DOC_TYPES.has(mimeType);
  if (!allowed) {
    throw new ApiError(400, opts.imagesOnly
      ? '只支持上传图片（PNG、JPG、GIF、WebP）。'
      : '不支持的文件类型。支持图片、音视频、PDF、Office 文档、文本文件。');
  }
  return { safeName: sanitizeFileName(fileName), isImage };
}

/**
 * 校验已经存进存储的那份文件的开头字节。
 *
 * 直传把字节绕过了服务器，这一层是把丢掉的防护补回来：公开桶里放一个
 * 伪装成图片的 HTML，就是存储域上的一个 XSS。只读前几百字节即可判断。
 * 校验不通过的文件由调用方删除。
 */
export function verifyStoredBytes(head: Buffer, mimeType: string): void {
  if (looksLikeMarkup(head)) {
    throw new ApiError(400, '文件内容为标记语言文档，出于安全考虑已拒绝。');
  }
  if (mimeType.startsWith('image/') && !looksLikeImage(head)) {
    throw new ApiError(400, '图片内容与声明的格式不符，已拒绝上传。');
  }
}

export function validateUpload(
  dataUrl: string,
  fileName: string,
  mimeType: string,
  opts: ValidateOptions = {},
): ValidatedUpload {
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;

  if (BLOCKED_TYPES.has(mimeType)) {
    throw new ApiError(400, '出于安全考虑不支持 SVG / HTML 文件，请改用 PNG、JPG 等格式。');
  }

  const isImage = mimeType.startsWith('image/');
  const allowed = opts.imagesOnly
    ? isImage
    : isImage || mimeType.startsWith('video/') || mimeType.startsWith('audio/') || DOC_TYPES.has(mimeType);
  if (!allowed) {
    throw new ApiError(400, opts.imagesOnly
      ? '只支持上传图片（PNG、JPG、GIF、WebP）。'
      : '不支持的文件类型。支持图片、音视频、PDF、Office 文档、文本文件。');
  }

  const match = dataUrl.match(/^data:([^;]*);base64,(.+)$/);
  if (!match) throw new ApiError(400, 'data_url must be a base64 data URL');

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) throw new ApiError(400, 'File is empty');
  if (buffer.length > maxBytes) {
    throw new ApiError(413, `文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`);
  }

  if (looksLikeMarkup(buffer)) {
    throw new ApiError(400, '文件内容为标记语言文档，出于安全考虑已拒绝。');
  }
  if (isImage && !looksLikeImage(buffer)) {
    throw new ApiError(400, '图片内容与声明的格式不符，已拒绝上传。');
  }

  return { buffer, mimeType, safeName: sanitizeFileName(fileName) };
}
