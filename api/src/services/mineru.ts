/**
 * MinerU 文档解析。把 PDF 转成结构化 Markdown，专供 AI 阅读。
 *
 * 为什么需要它：pdf-parse 只能把文字层按流水顺序倒出来 —— 双栏论文会左右两栏
 * 交错成一团，表格塌成一行，标题和正文分不开，公式全丢。AI 拿到这样一坨，
 * 回答质量差得看得出来。MinerU 输出带标题层级、表格和公式的 Markdown。
 *
 * **数据流要说清楚**：这一步会把文件的公开地址交给 mineru.net，由他们的服务器
 * 下载并解析。学生的作业与材料因此离开本平台。没有配置 MINERU_TOKEN 时
 * 整条链路不启用，退回本地的 pdf-parse —— 不配置就不会有任何外发。
 *
 * 接口是异步的（提交 → 轮询），所以这里只提供无状态的三个动作，
 * 任务状态由调用方持久化（document_renders 表），进程重启不会丢。
 */

import { pageMapFromContentList, type PageMap } from './pageMap';

const BASE = 'https://mineru.net/api/v4';
const REQUEST_TIMEOUT_MS = 20_000;
const ZIP_TIMEOUT_MS = 60_000;
/** 解析结果里只取 full.md；一份论文的 zip 连图片可能几十 MB，给个上限。 */
const MAX_ZIP_BYTES = 80 * 1024 * 1024;

export type MinerUState = 'pending' | 'running' | 'converting' | 'done' | 'failed';

export interface MinerUTask {
  state: MinerUState;
  fullZipUrl?: string;
  errMsg?: string;
  extractedPages?: number;
  totalPages?: number;
}

export function isMinerUConfigured(): boolean {
  return Boolean(process.env.MINERU_TOKEN);
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.MINERU_TOKEN}`,
  };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`MinerU 返回了非 JSON（HTTP ${res.status}）：${text.slice(0, 160)}`);
    }
    // MinerU 用 body 里的 code 表示成败，HTTP 200 不代表成功
    if (json?.code !== 0) {
      throw new Error(`MinerU ${json?.code}: ${json?.msg ?? '未知错误'}`);
    }
    return json.data ?? {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 提交一个解析任务。返回 task_id。
 * fileUrl 必须是公网可访问的地址 —— MinerU 是从他们那边去下载的。
 */
export async function submitMinerUTask(fileUrl: string, options: {
  /** 页码范围，用来给超长文档设上限，避免一次吃掉当天的高优先额度 */
  pageRanges?: string;
  language?: string;
} = {}): Promise<string> {
  if (!isMinerUConfigured()) throw new Error('MINERU_TOKEN 未配置');

  const data = await fetchJson(`${BASE}/extract/task`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      url: fileUrl,
      // vlm 是官方推荐档，对双栏、表格、公式的处理明显好于 pipeline
      model_version: 'vlm',
      enable_formula: true,
      enable_table: true,
      language: options.language ?? 'ch',
      ...(options.pageRanges ? { page_ranges: options.pageRanges } : {}),
    }),
  }, REQUEST_TIMEOUT_MS);

  const taskId = data?.task_id;
  if (!taskId) throw new Error('MinerU 没有返回 task_id');
  return String(taskId);
}

export async function getMinerUTask(taskId: string): Promise<MinerUTask> {
  if (!isMinerUConfigured()) throw new Error('MINERU_TOKEN 未配置');

  const data = await fetchJson(`${BASE}/extract/task/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: authHeaders(),
  }, REQUEST_TIMEOUT_MS);

  return {
    state: (data?.state ?? 'pending') as MinerUState,
    fullZipUrl: data?.full_zip_url ? String(data.full_zip_url) : undefined,
    errMsg: data?.err_msg ? String(data.err_msg) : undefined,
    extractedPages: data?.extract_progress?.extracted_pages,
    totalPages: data?.extract_progress?.total_pages,
  };
}

/**
 * 下载结果包并取出 full.md；同一个包里的 *_content_list.json 每块带页码，用来做页码对照表（见 pageMap.ts）。
 * zip 里还有图片和中间产物，我们只要这两样。
 */
export async function fetchMinerUMarkdown(zipUrl: string): Promise<{ markdown: string; pageMap: PageMap }> {
  const { readZipText } = await import('./zipReader');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ZIP_TIMEOUT_MS);
  try {
    const res = await fetch(zipUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载解析结果失败：HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_ZIP_BYTES) throw new Error('解析结果过大');

    const markdown = readZipText(buffer, name => name.endsWith('full.md'));
    if (!markdown?.trim()) throw new Error('解析结果里没有 full.md');
    // 新版包里另有 _content_list_v2.json，格式不同；只认 v1 那份。没有或读不了就是没有页码，不影响正文
    let pageMap: PageMap = [];
    try {
      const list = readZipText(buffer, name => name.endsWith('_content_list.json'));
      if (list) pageMap = pageMapFromContentList(markdown, JSON.parse(list));
    } catch (err: any) {
      console.warn('[MinerU] 页码对照表没做成：', err?.message);
    }
    return { markdown, pageMap };
  } finally {
    clearTimeout(timer);
  }
}
