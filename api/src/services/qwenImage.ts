import { aiFetch } from './aiGateway';

/**
 * 通义千问（阿里云百炼）自有 key 的生图（2026-10-11 用户要加千问的 key）。
 *
 * 百炼的生图不是 OpenAI 那套形状：千问图像 2.0 系列只有同步接口 multimodal-generation/generation，
 * 请求是一条 user 消息、content 里放一段 text，图片地址在 output.choices[0].message.content[].image，
 * PNG，24 小时后失效（noteImage 会立刻转存到我们自己的存储）。
 *
 * 接口域名：百炼新推的是「业务空间」域名 {WorkspaceId}.cn-beijing.maas.aliyuncs.com，老的 dashscope.aliyuncs.com
 * 文档说仍可用。教师在课程里给千问填了接口地址（业务空间的 compatible-mode 地址）就用同一个域名，没填用老域名。
 */

export const QWEN_IMAGE_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const IMAGE_PATH = '/api/v1/services/aigc/multimodal-generation/generation';

/**
 * 出图尺寸（2.0 系列总像素在 512×512 到 2048×2048 之间，边长取 16 的倍数）。
 * 原来用文档里最大的推荐尺寸，2026-10-11 实测 2688×1536 的 PNG 有 5.7MB、12 秒；1664×928 是 2.2MB、8 秒。
 * 笔记里显示用不着四百万像素，学生手机上还要下载，所以用小一号的（千问图像第一代的推荐尺寸）。
 */
export const QWEN_IMAGE_SIZES: Readonly<Record<string, string>> = {
  '1:1': '1328*1328',
  '16:9': '1664*928',
  '9:16': '928*1664',
  '4:3': '1472*1104',
  '3:4': '1104*1472',
};

export type QwenImageResult =
  | { ok: true; url: string; model: string }
  | { ok: false; error: string };

/** 课程里配的千问接口地址是阿里云的域名就沿用（业务空间域名更稳），否则用老域名 */
export function qwenImageEndpoint(chatEndpoint?: string | null): string {
  const raw = chatEndpoint?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && /(^|\.)aliyuncs\.com$/i.test(url.hostname)) return `https://${url.host}${IMAGE_PATH}`;
    } catch { /* 地址写坏了就用默认 */ }
  }
  return QWEN_IMAGE_ENDPOINT;
}

/** 宽高比优先；只给了 1024x1024 这类尺寸时按比例找最接近的推荐尺寸 */
export function qwenImageSize(options: { aspectRatio?: string; size?: string } = {}): string {
  if (options.aspectRatio && QWEN_IMAGE_SIZES[options.aspectRatio]) return QWEN_IMAGE_SIZES[options.aspectRatio];
  const m = /^(\d{2,5})\s*[x*×]\s*(\d{2,5})$/i.exec(options.size ?? '');
  if (m) {
    const ratio = Number(m[1]) / Number(m[2]);
    let best = '1:1';
    let gap = Infinity;
    for (const key of Object.keys(QWEN_IMAGE_SIZES)) {
      const [w, h] = key.split(':').map(Number);
      const d = Math.abs(Math.log(ratio / (w / h)));
      if (d < gap) { gap = d; best = key; }
    }
    return QWEN_IMAGE_SIZES[best];
  }
  return QWEN_IMAGE_SIZES['1:1'];
}

export async function generateQwenImage(params: {
  apiKey: string;
  prompt: string;
  model?: string;
  aspectRatio?: string;
  size?: string;
  chatEndpoint?: string | null;
}): Promise<QwenImageResult> {
  const model = params.model?.trim() || 'qwen-image-2.0';
  const prompt = params.prompt.trim();
  if (!prompt) return { ok: false, error: '要画的内容为空' };
  try {
    const resp = await aiFetch(qwenImageEndpoint(params.chatEndpoint), {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        // 2.0 系列提示词上限 1300 token，留余量
        input: { messages: [{ role: 'user', content: [{ text: prompt.slice(0, 1000) }] }] },
        parameters: { size: qwenImageSize(params), n: 1, prompt_extend: true, watermark: false },
      }),
    }, { provider: 'alibaba', timeoutMs: 120_000 });

    const json = await resp.json().catch(() => null) as any;
    if (!resp.ok) {
      const reason = [json?.code, json?.message].filter(Boolean).join(' ') || JSON.stringify(json ?? {}).slice(0, 160);
      return { ok: false, error: `千问生图失败：HTTP ${resp.status} ${reason}`.trim() };
    }
    const content = json?.output?.choices?.[0]?.message?.content;
    const url: string | undefined = Array.isArray(content) ? content.find((c: any) => typeof c?.image === 'string')?.image : undefined;
    if (!url) return { ok: false, error: `千问生图返回里没有图片：${JSON.stringify(json ?? {}).slice(0, 160)}` };
    return { ok: true, url, model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '千问生图调用异常' };
  }
}
