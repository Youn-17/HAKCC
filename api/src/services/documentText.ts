/**
 * 从上传的文档里抽正文，好让 AI 真的读得到。
 *
 * 在此之前学生传 PDF 只能得到一个文件名——消息里写着「你无法读取它的内容」，
 * 等于附件功能对 AI 是空的。这一层把 PDF / Word / 纯文本变成文字。
 *
 * 三条硬约束：
 *   1. 解析在请求线程里跑，必须有超时，否则一个构造过的 PDF 能把接口挂住；
 *   2. 抽出来的字要截断，一本几百页的书塞进上下文既贵又没用；
 *   3. 失败一律返回 null 而不是抛异常——上传本身是成功的，
 *      读不出内容只是「AI 看不到」，不该让学生的附件整个传不上去。
 */

const PARSE_TIMEOUT_MS = 20_000;
const MAX_CHARS = 40_000;
const MAX_BYTES = 20 * 1024 * 1024;

export type ExtractedText = {
  text: string;
  /** 原文被截断过就为 true，提示词里会说明，免得 AI 拿半篇当全篇下结论。 */
  truncated: boolean;
  source: 'pdf' | 'docx' | 'plain';
  /** PDF 才有：正文第几个字起是第几页（见 pageMap.ts），知识库给片段标页码用 */
  pageMap?: PageMap;
};

import { joinPages, type PageMap } from './pageMap';

const TEXTUAL = /^(text\/|application\/(json|xml|x-yaml|yaml))/i;
const TEXTUAL_EXT = /\.(txt|md|markdown|csv|tsv|json|ya?ml|log)$/i;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 解析超时`)), PARSE_TIMEOUT_MS);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function clip(raw: string): { text: string; truncated: boolean } {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= MAX_CHARS) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, MAX_CHARS), truncated: true };
}

export function canExtractText(mimeType: string, fileName: string): boolean {
  if (TEXTUAL.test(mimeType) || TEXTUAL_EXT.test(fileName)) return true;
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(fileName)) return true;
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || /\.docx$/i.test(fileName)
  ) return true;
  return false;
}

export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractedText | null> {
  if (buffer.length === 0 || buffer.length > MAX_BYTES) return null;

  try {
    if (TEXTUAL.test(mimeType) || TEXTUAL_EXT.test(fileName)) {
      const { text, truncated } = clip(buffer.toString('utf8'));
      return text ? { text, truncated, source: 'plain' } : null;
    }

    if (mimeType === 'application/pdf' || /\.pdf$/i.test(fileName)) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await withTimeout(parser.getText(), 'PDF');
      if (Array.isArray(result?.pages) && result.pages.length) {
        // 逐页拼正文，顺带记下每页从哪个字开始。每页先按 clip 的规矩收拾好，clip 就只剩截断，位置不会再挪
        const pages = result.pages.map(p => ({
          num: p.num,
          text: String(p.text ?? '').replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
        }));
        const joined = joinPages(pages);
        const { text, truncated } = clip(joined.text);
        return text ? { text, truncated, source: 'pdf', pageMap: joined.pageMap.filter(([offset]) => offset < text.length) } : null;
      }
      // pdf-parse 会在末尾附上 "-- 1 of 3 --" 这样的页码行，对 AI 是噪音
      const raw = String(result?.text ?? '').replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, '');
      const { text, truncated } = clip(raw);
      return text ? { text, truncated, source: 'pdf' } : null;
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || /\.docx$/i.test(fileName)
    ) {
      const mammoth = await import('mammoth');
      const result = await withTimeout(mammoth.extractRawText({ buffer }), 'Word');
      const { text, truncated } = clip(String(result?.value ?? ''));
      return text ? { text, truncated, source: 'docx' } : null;
    }
  } catch (error) {
    // 扫描版 PDF（纯图片，无文字层）、加密文档、损坏文件都会走到这里。
    // 这不是错误，只是「读不出来」，交给调用方如实告诉学生。
    console.warn('[documentText] 提取失败:', fileName, error instanceof Error ? error.message : error);
  }
  return null;
}
