import { aiFetch } from './aiGateway';
import { MINIMAX_ENDPOINTS, minimaxGroupIdFromKey } from './providerEndpoints';

/**
 * MiniMax 的生图与语音。两个接口都不是 OpenAI 那套形状，
 * 所以不能塞进 callOpenAICompatible，单独一层。
 *
 * 2026-09-06 用课程里那把真 key 实测：
 *   生图 image-01       35.4s / 35.6s
 *   生图 image-01-live  26.9s
 *   语音 speech-2.8-turbo 948ms（68.6KB）、speech-2.8-hd 785ms（73.7KB）
 *
 * 注意生图这条：同一时间 DMX 的 qwen-image-plus 只要 6.2–6.8s，比 MiniMax
 * 快五倍。「DMX 太慢」这个印象来自**对话**（压测 p50 10–17s），生图上正好相反。
 * 谁优先见 noteImage.ts：课程 AI 设置里指定的优先，没指定默认 MiniMax（2026-09-29 平台负责人定）。
 *
 * 两个坑：
 *   1. MiniMax 出错时 **HTTP 仍然是 200**，真正的状态在 base_resp.status_code，
 *      只看 resp.ok 会把失败当成功。
 *   2. 语音的 GroupId 是可选的：实测不带也成功，而且课程里这把 key 根本不是
 *      JWT，解析不出 GroupId。带不带都要能跑。
 */

export type MinimaxImageResult =
  | { ok: true; url?: string; b64?: string; model: string }
  | { ok: false; error: string };

export type MinimaxSpeechResult =
  | { ok: true; audio: Buffer; format: string; model: string; charCount: number }
  | { ok: false; error: string };

/** 从响应里读 MiniMax 的业务状态；0 或缺省算成功。 */
function businessError(json: any): string | null {
  const resp = json?.base_resp;
  if (!resp) return null;
  const code = resp.status_code;
  if (code === undefined || code === 0) return null;
  return `MiniMax ${code}: ${resp.status_msg ?? '未知错误'}`;
}

export async function generateMinimaxImage(params: {
  apiKey: string;
  prompt: string;
  model?: string;
  aspectRatio?: string;
}): Promise<MinimaxImageResult> {
  const model = params.model?.trim() || 'image-01';
  const aspectRatio = /^\d{1,2}:\d{1,2}$/.test(params.aspectRatio ?? '') ? params.aspectRatio : '1:1';

  try {
    const resp = await aiFetch(MINIMAX_ENDPOINTS.image, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: params.prompt.slice(0, 2000),
        aspect_ratio: aspectRatio,
        response_format: 'url',
        n: 1,
        prompt_optimizer: true,
      }),
    }, { provider: 'minimax', timeoutMs: 120_000 });

    const json = await resp.json().catch(() => null) as any;
    if (!resp.ok) {
      return { ok: false, error: `生图请求失败：HTTP ${resp.status} ${JSON.stringify(json ?? {}).slice(0, 160)}` };
    }
    const failure = businessError(json);
    if (failure) return { ok: false, error: failure };

    // 不同版本回的字段不一样，几种都认一下。
    const url: string | undefined =
      json?.data?.image_urls?.[0] ?? json?.data?.[0]?.url ?? json?.image_urls?.[0];
    const b64: string | undefined =
      json?.data?.image_base64?.[0] ?? json?.data?.[0]?.b64_json;
    if (!url && !b64) {
      return { ok: false, error: `生图返回里没有图片字段：${JSON.stringify(json ?? {}).slice(0, 160)}` };
    }
    return { ok: true, url, b64, model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '生图调用异常' };
  }
}

export async function synthesizeMinimaxSpeech(params: {
  apiKey: string;
  text: string;
  model?: string;
  voiceId?: string;
  speed?: number;
  format?: 'mp3' | 'wav' | 'pcm';
}): Promise<MinimaxSpeechResult> {
  const text = params.text.trim();
  if (!text) return { ok: false, error: '要合成的文本为空' };

  // 实测（2026-09-06，课程里那把 key）：不带 GroupId 也能成功，HTTP 200、
  // base_resp.status_code=0。而且那把 key 根本不是 JWT（126 字符、无分段），
  // 解析不出 GroupId。所以这里改成「能解析就带上，解析不出就不带」——
  // 早先「解析不出就报错」的写法会把语音整个挡死。
  const groupId = minimaxGroupIdFromKey(params.apiKey);

  // turbo 便宜一半（¥2 vs ¥3.5 / 万字符），课堂朗读默认用它。
  // 实测两档速度几乎一样（turbo 948ms / hd 785ms），所以贵的那档不值。
  const model = params.model?.trim() || 'speech-2.8-turbo';
  const format = params.format ?? 'mp3';

  try {
    const endpoint = groupId
      ? `${MINIMAX_ENDPOINTS.t2a}?GroupId=${encodeURIComponent(groupId)}`
      : MINIMAX_ENDPOINTS.t2a;
    const resp = await aiFetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        text: text.slice(0, 10_000),
        stream: false,
        voice_setting: {
          voice_id: params.voiceId?.trim() || 'female-shaonv',
          speed: typeof params.speed === 'number' && params.speed >= 0.5 && params.speed <= 2 ? params.speed : 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format, channel: 1 },
      }),
    }, { provider: 'minimax', timeoutMs: 120_000 });

    const json = await resp.json().catch(() => null) as any;
    if (!resp.ok) {
      return { ok: false, error: `语音合成失败：HTTP ${resp.status} ${JSON.stringify(json ?? {}).slice(0, 160)}` };
    }
    const failure = businessError(json);
    if (failure) return { ok: false, error: failure };

    const hex: string | undefined = json?.data?.audio;
    if (!hex) {
      return { ok: false, error: `语音返回里没有音频字段：${JSON.stringify(json ?? {}).slice(0, 160)}` };
    }
    // MiniMax 回的是十六进制字符串，不是 base64。
    const audio = Buffer.from(hex, 'hex');
    if (!audio.length) return { ok: false, error: '语音返回的音频为空' };

    return { ok: true, audio, format, model, charCount: text.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '语音合成调用异常' };
  }
}
