import * as tus from 'tus-js-client';
import { supabase } from './supabaseClient';
import { notes as notesApi, getAuthToken } from './apiClient';

/**
 * 附件上传。
 *
 * 三步：后端签发上传地址 → 浏览器直传存储 → 后端回读字节校验。
 *
 * 为什么不走 API 服务器：旧做法把文件 base64 塞进 JSON 发过去，体积膨胀 37%，
 * 服务器内存里还要同时放字符串和 Buffer，上限被请求体大小卡在 25MB。
 *
 * 为什么大文件要走可续传：标准上传是一次性 PUT，100MB 传到 90% 断网就得从头再来。
 * 官方也明确写着超过 6MB 建议用可续传。这里以 6MB 为界分流。
 *
 * commit 那一步不能省 —— 直传让服务端看不到字节，魔数校验（拦伪装成图片的
 * HTML / SVG）只能在文件落盘之后补做。跳过它，公开桶里就能放一个 XSS。
 */

export const MAX_ATTACHMENT_BYTES = 500 * 1024 * 1024;

/** 超过这个大小走可续传。低于它用一次性上传，少几个来回。 */
const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;

/** Supabase 的可续传分片必须正好 6MB，官方文档写死的，别改。 */
const TUS_CHUNK = 6 * 1024 * 1024;

export interface UploadProgress {
  phase: 'signing' | 'uploading' | 'verifying';
  /** 0–1，仅可续传上传有；一次性上传拿不到进度。 */
  ratio?: number;
}

export interface UploadedAttachment {
  file_url: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  text: string | null;
  textSource: 'pdf' | 'docx' | 'plain' | null;
}

/**
 * 大文件走 TUS。
 *
 * 认证用的是**用户自己的 Supabase JWT**，不是后端签发的上传令牌。
 * 文档里提到可续传支持 x-signature 预签名，但实测在这个端点上不生效：
 * 只带 x-signature 会报 Invalid Compact JWS（它在解析 authorization 头），
 * 带上 authorization 之后授权就完全走用户身份和 RLS 了。
 *
 * 所以 storage.objects 上加了三条策略（insert / select / update），
 * 按路径里的 course_id 校验课程成员身份。签发那一步仍然保留 —— 它负责
 * 校验声明的类型、算出受控的路径，路径形状正是 RLS 判定的依据。
 */
function resumableUpload(
  file: File,
  bucket: string,
  path: string,
  jwt: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(
    '.supabase.co',
    '.storage.supabase.co',
  );

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${base}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${jwt}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      uploadDataDuringCreation: true,
      // 不清掉指纹的话，同一个文件重传会被认成「已完成」而直接跳过
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      chunkSize: TUS_CHUNK,
      onError: (error) => reject(error),
      onProgress: (sent, total) => {
        onProgress?.({ phase: 'uploading', ratio: total > 0 ? sent / total : 0 });
      },
      onSuccess: () => resolve(),
    });

    // 断过的上传接着传，而不是从头再来 —— 这正是可续传的意义
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    }).catch(reject);
  });
}

export async function uploadAttachment(
  spaceId: string,
  file: File,
  opts: { extractText?: boolean; onProgress?: (p: UploadProgress) => void } = {},
): Promise<UploadedAttachment> {
  if (file.size === 0) throw new Error('文件是空的。');
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`文件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB 上限。`);
  }

  const mime = file.type || 'application/octet-stream';
  opts.onProgress?.({ phase: 'signing' });
  const { path, token, bucket } = await notesApi.signSpaceAttachment(spaceId, {
    file_name: file.name,
    mime_type: mime,
    file_size: file.size,
  });

  opts.onProgress?.({ phase: 'uploading', ratio: 0 });
  try {
    if (file.size > RESUMABLE_THRESHOLD) {
      const jwt = getAuthToken();
      if (!jwt) throw new Error('登录状态已失效，请重新登录后再上传。');
      await resumableUpload(file, bucket, path, jwt, opts.onProgress);
    } else {
      const { error } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(path, token, file, { contentType: mime });
      if (error) throw error;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Supabase 的原文是 "The object exceeded the maximum allowed size"，学生看不懂，
    // 也不知道该找谁。这个上限有两道：桶级的和项目全局的，全局优先，
    // 而且只能在 Supabase 控制台改，代码里调不动。
    if (/exceeded the maximum allowed size|Payload too large|413/i.test(msg)) {
      throw new Error(
        `文件超出存储服务的上限（当前文件 ${(file.size / 1024 / 1024).toFixed(0)}MB）。`
        + '请压缩后再传，或让老师在 Supabase 控制台调高 Storage 的全局文件大小上限。',
      );
    }
    throw new Error(`上传失败：${msg}`);
  }

  opts.onProgress?.({ phase: 'verifying' });
  const res = await notesApi.commitSpaceAttachment(spaceId, {
    path,
    file_name: file.name,
    mime_type: mime,
    extract_text: opts.extractText,
  });

  return { ...res.attachment, text: res.text, textSource: res.textSource };
}
