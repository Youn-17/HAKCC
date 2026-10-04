import { supabase } from '../config/supabase';
import { assertSafePublicUrl } from './urlGuard';

/**
 * 把模型生成的图片转存到我们自己的存储。
 *
 * 各家生图接口回的都是**临时签名 URL**（阿里云 OSS、MiniMax 的 CDN 等），
 * 有效期通常只有几小时到一天。直接把那个链接嵌进学生的笔记，等签名过期
 * 整批图就全变裂图——研究语料里的图证据会成片烂掉，而且不可追溯。
 * 所以生成之后立刻抓回来存进 note-chat-attachments，对外只给稳定链接。
 */

const BUCKET = 'note-chat-attachments';
const MAX_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

type PersistResult = { ok: true; url: string } | { ok: false; error: string };

/** 按文件头判类型。不信任 Content-Type，它可以是任何东西。 */
function sniffImage(buffer: Buffer): { mime: string; ext: string } | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') {
    return { mime: 'image/gif', ext: 'gif' };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

export async function persistGeneratedImage(params: {
  courseId: string | null;
  model: string;
  url?: string | null;
  b64?: string | null;
}): Promise<PersistResult> {
  let buffer: Buffer;

  if (params.b64) {
    try {
      buffer = Buffer.from(params.b64, 'base64');
    } catch {
      return { ok: false, error: '生图返回的 base64 无法解码' };
    }
  } else if (params.url) {
    try {
      // 地址来自模型厂商的响应而非用户输入，但仍然过一遍 SSRF 校验：
      // 被污染的上游响应不该变成我们从内网发起的一次请求。
      await assertSafePublicUrl(params.url);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '生图地址未通过安全校验' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const resp = await fetch(params.url, { signal: controller.signal });
      if (!resp.ok) return { ok: false, error: `下载生成的图片失败：HTTP ${resp.status}` };
      const array = await resp.arrayBuffer();
      if (array.byteLength > MAX_BYTES) return { ok: false, error: '生成的图片超过 12MB' };
      buffer = Buffer.from(array);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error && e.name === 'AbortError'
          ? '下载生成的图片超时'
          : '下载生成的图片失败',
      };
    } finally {
      clearTimeout(timer);
    }
  } else {
    return { ok: false, error: '生图接口既没有返回 url 也没有返回 base64' };
  }

  const kind = sniffImage(buffer);
  if (!kind) return { ok: false, error: '生成的内容不是可识别的图片格式' };

  const safeModel = params.model.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
  const path = `generated/${params.courseId ?? 'unscoped'}/${Date.now()}-${safeModel}.${kind.ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: kind.mime, upsert: false });
  if (error) return { ok: false, error: `转存生成的图片失败：${error.message}` };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
