import { aiFetch } from './aiGateway';
import { APIKEYFAN_IMAGE_ENDPOINT } from './providerEndpoints';

/**
 * OpenAI 形状的生图接口 /v1/images/generations（2026-10-11 用户要配 APIKEY.FAN 的 GPT 生图）。
 *
 * APIKEY.FAN 文档（https://apikey.fan/docs#ApiScripts）的写法：
 *   POST https://api.apikey.fan/v1/images/generations
 *   { model: 'gpt-image-2', prompt, n: 1, size: '1024x1024', stream: true, response_format: 'b64_json' }
 *   返回 SSE：image_generation.partial_image（进度）… image_generation.completed（b64_json 或 data[0].b64_json）。
 * 生图要几十秒，流式能让连接一直有数据、不被中间层掐断。不是流式的返回（{ data: [{ b64_json | url }] }）也认。
 * 专线 slb.apikey.fan 禁用生图：教师填了那个地址也改走 api.apikey.fan。
 * Grok 分组的型号文档没写尺寸参数，不传 size、不要流式，按普通 JSON 收。
 */

export type OpenAiImageResult =
  | { ok: true; b64?: string; url?: string; model: string }
  | { ok: false; error: string };

/**
 * 教师填的 APIKEY.FAN 地址（控制台上写的是 https://api.apikey.fan 这种只有域名的，也可能带 /v1/…）换成某个接口的完整地址。
 * 专线 slb 能对话、不能生图：生图时换成 api。
 */
export function apikeyfanUrl(endpointUrl: string | null | undefined, path: 'images/generations' | 'models' | 'chat/completions'): string {
  const fallback = `https://api.apikey.fan/v1/${path}`;
  const raw = endpointUrl?.trim();
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return fallback;
    // 专线禁用生图
    const host = path === 'images/generations' && /^slb\./i.test(url.hostname) ? url.hostname.replace(/^slb\./i, 'api.') : url.host;
    return `https://${host}/v1/${path}`;
  } catch {
    return fallback;
  }
}

/** gpt-image 只认这三种尺寸：方图、横图、竖图 */
export function gptImageSize(options: { aspectRatio?: string; size?: string } = {}): string {
  const allowed = ['1024x1024', '1536x1024', '1024x1536'];
  if (options.size && allowed.includes(options.size)) return options.size;
  let ratio = 1;
  const ar = /^(\d{1,2}):(\d{1,2})$/.exec(options.aspectRatio ?? '');
  const px = /^(\d{2,5})\s*[x*×]\s*(\d{2,5})$/i.exec(options.size ?? '');
  if (ar) ratio = Number(ar[1]) / Number(ar[2]);
  else if (px) ratio = Number(px[1]) / Number(px[2]);
  if (ratio > 1.15) return '1536x1024';
  if (ratio < 0.87) return '1024x1536';
  return '1024x1024';
}

function pickImage(obj: any): { b64?: string; url?: string } | null {
  if (!obj || typeof obj !== 'object') return null;
  const first = Array.isArray(obj.data) ? obj.data[0] : null;
  const b64 = obj.b64_json ?? first?.b64_json ?? obj.item?.result;
  const url = obj.url ?? first?.url;
  if (typeof b64 === 'string' && b64.length > 100) return { b64 };
  if (typeof url === 'string' && /^https?:\/\//.test(url)) return { url };
  return null;
}

function errorText(obj: any): string | null {
  const e = obj?.error ?? (obj?.type === 'error' ? obj : null);
  if (!e) return null;
  if (typeof e === 'string') return e;
  return [e.code, e.message ?? e.msg].filter(Boolean).join(' ') || JSON.stringify(e).slice(0, 160);
}

/** 读 SSE：找完成事件里的图；中途有 error 事件就报错 */
export function imageFromSse(text: string): { b64?: string; url?: string } | { error: string } | null {
  let last: { b64?: string; url?: string } | null = null;
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n').trim();
    if (!data || data === '[DONE]') continue;
    let event: any;
    try { event = JSON.parse(data); } catch { continue; }
    const err = errorText(event);
    if (err) return { error: err };
    const image = pickImage(event);
    if (image && (event.type === 'image_generation.completed' || !String(event.type ?? '').includes('partial'))) last = image;
  }
  return last;
}

export async function generateOpenAiImage(params: {
  apiKey: string;
  prompt: string;
  model: string;
  provider: string;
  endpointUrl?: string | null;
  aspectRatio?: string;
  size?: string;
}): Promise<OpenAiImageResult> {
  const prompt = params.prompt.trim();
  if (!prompt) return { ok: false, error: '要画的内容为空' };
  const model = params.model;
  const isGpt = /^gpt-image/i.test(model);
  const body: Record<string, unknown> = { model, prompt: prompt.slice(0, 4000), n: 1, response_format: 'b64_json' };
  if (isGpt) {
    body.size = gptImageSize(params);
    body.stream = true;
  }
  try {
    const resp = await aiFetch(apikeyfanUrl(params.endpointUrl, 'images/generations'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: isGpt ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(body),
    }, { provider: params.provider, timeoutMs: 180_000 });

    const text = await resp.text();
    const type = resp.headers.get('content-type') ?? '';
    if (!resp.ok) {
      let reason = text.slice(0, 160);
      try { reason = errorText(JSON.parse(text)) ?? reason; } catch { /* 不是 JSON 就原样 */ }
      return { ok: false, error: `生图失败：HTTP ${resp.status} ${reason}`.trim() };
    }
    if (type.includes('text/event-stream') || /^\s*(event|data):/m.test(text.slice(0, 200))) {
      const found = imageFromSse(text);
      if (found && 'error' in found) return { ok: false, error: `生图失败：${found.error}` };
      if (found) return { ok: true, ...found, model };
      return { ok: false, error: '生图失败：流式返回里没有图片' };
    }
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* 下面报错 */ }
    const err = errorText(json);
    if (err) return { ok: false, error: `生图失败：${err}` };
    const image = pickImage(json);
    if (!image) return { ok: false, error: `生图失败：返回里没有图片 ${text.slice(0, 120)}` };
    return { ok: true, ...image, model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '生图调用异常' };
  }
}
