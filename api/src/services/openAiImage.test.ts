import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * APIKEY.FAN 的 GPT / Grok 生图（2026-10-11，按 https://apikey.fan/docs 的写法）：
 * GPT 型号用流式（SSE），从 image_generation.completed 取 b64_json；Grok 型号不传尺寸、按普通 JSON 收；
 * 出错时说出原因；教师只填 https://api.apikey.fan 也能拼出接口，专线 slb（禁用生图）改走 api。aiFetch 换成假的。
 */

const calls = vi.hoisted(() => [] as Array<{ url: string; init: RequestInit; opts: any }>);
const reply = vi.hoisted(() => ({ status: 200, type: 'application/json', body: '' }));
vi.mock('./aiGateway', () => ({
  aiFetch: async (url: string, init: RequestInit, opts: unknown) => {
    calls.push({ url, init, opts });
    return new Response(reply.body, { status: reply.status, headers: { 'Content-Type': reply.type } });
  },
}));

import { apikeyfanUrl, generateOpenAiImage, gptImageSize, imageFromSse } from './openAiImage';

const B64 = 'iVBORw0KGgo' + 'A'.repeat(200);
const sse = (...events: unknown[]) => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
afterEach(() => { calls.length = 0; reply.status = 200; reply.type = 'application/json'; reply.body = ''; });

describe('APIKEY.FAN 生图', () => {
  it('GPT 型号：流式请求（尺寸按宽高比），从完成事件里取图，进度事件不算', async () => {
    reply.type = 'text/event-stream';
    reply.body = sse({ type: 'image_generation.partial_image', b64_json: 'x'.repeat(150) }, { type: 'image_generation.completed', data: [{ b64_json: B64 }] });
    const result = await generateOpenAiImage({ apiKey: 'sk-test', prompt: ' 一只太空猫 ', model: 'gpt-image-2', provider: 'apikeyfan', aspectRatio: '16:9' });
    expect(result).toEqual({ ok: true, b64: B64, model: 'gpt-image-2' });
    expect(calls[0].url).toBe('https://api.apikey.fan/v1/images/generations');
    expect(calls[0].opts).toMatchObject({ provider: 'apikeyfan' });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(headers.Accept).toBe('text/event-stream');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'gpt-image-2', prompt: '一只太空猫', n: 1, response_format: 'b64_json', size: '1536x1024', stream: true,
    });
  });

  it('Grok 型号：不传尺寸、不要流式；普通 JSON 返回里的地址也认', async () => {
    reply.body = JSON.stringify({ data: [{ url: 'https://img.example/a.png' }] });
    const result = await generateOpenAiImage({ apiKey: 'k', prompt: '海边的柯基', model: 'grok-imagine-image', provider: 'apikeyfan-grok' });
    expect(result).toEqual({ ok: true, url: 'https://img.example/a.png', model: 'grok-imagine-image' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ model: 'grok-imagine-image', prompt: '海边的柯基', n: 1, response_format: 'b64_json' });
  });

  it('出错时说出原因：HTTP 错误、流里的 error 事件、流里没有图', async () => {
    reply.status = 404;
    reply.body = JSON.stringify({ error: { code: 'model_not_found', message: '当前分组没有这个模型' } });
    expect(await generateOpenAiImage({ apiKey: 'k', prompt: '猫', model: 'gpt-image-2', provider: 'apikeyfan' }))
      .toEqual({ ok: false, error: '生图失败：HTTP 404 model_not_found 当前分组没有这个模型' });
    reply.status = 200;
    reply.type = 'text/event-stream';
    reply.body = sse({ type: 'error', error: { message: '内容不合规' } });
    expect(await generateOpenAiImage({ apiKey: 'k', prompt: '猫', model: 'gpt-image-2', provider: 'apikeyfan' }))
      .toEqual({ ok: false, error: '生图失败：内容不合规' });
    reply.body = sse({ type: 'image_generation.partial_image', b64_json: 'x'.repeat(150) });
    expect((await generateOpenAiImage({ apiKey: 'k', prompt: '猫', model: 'gpt-image-2', provider: 'apikeyfan' })).ok).toBe(false);
    expect(await generateOpenAiImage({ apiKey: 'k', prompt: '  ', model: 'gpt-image-2', provider: 'apikeyfan' })).toEqual({ ok: false, error: '要画的内容为空' });
  });

  it('接口地址：只填域名也行；专线 slb 禁用生图，改走 api；写坏或不是 https 用默认', () => {
    expect(apikeyfanUrl('https://api.apikey.fan', 'images/generations')).toBe('https://api.apikey.fan/v1/images/generations');
    expect(apikeyfanUrl('https://api.apikey.fan/v1/chat/completions', 'models')).toBe('https://api.apikey.fan/v1/models');
    expect(apikeyfanUrl('https://slb.apikey.fan', 'images/generations')).toBe('https://api.apikey.fan/v1/images/generations');
    expect(apikeyfanUrl('https://slb.apikey.fan', 'models')).toBe('https://slb.apikey.fan/v1/models');
    expect(apikeyfanUrl('http://api.apikey.fan', 'images/generations')).toBe('https://api.apikey.fan/v1/images/generations');
    expect(apikeyfanUrl('not a url', 'models')).toBe('https://api.apikey.fan/v1/models');
    expect(apikeyfanUrl(null, 'images/generations')).toBe('https://api.apikey.fan/v1/images/generations');
    // 对话：控制台给的只有域名，保存时补成完整接口；专线能对话，对话地址保留 slb
    expect(apikeyfanUrl('https://api.apikey.fan', 'chat/completions')).toBe('https://api.apikey.fan/v1/chat/completions');
    expect(apikeyfanUrl('https://slb.apikey.fan/v1', 'chat/completions')).toBe('https://slb.apikey.fan/v1/chat/completions');
  });

  it('尺寸只用 gpt-image 认的三种；读 SSE 时取最后的完成图', () => {
    expect(gptImageSize({ aspectRatio: '9:16' })).toBe('1024x1536');
    expect(gptImageSize({ size: '1792x1024' })).toBe('1536x1024');
    expect(gptImageSize({ size: '1024x1024' })).toBe('1024x1024');
    expect(gptImageSize({})).toBe('1024x1024');
    expect(imageFromSse(sse({ type: 'image_generation.completed', b64_json: B64 }))).toEqual({ b64: B64 });
    expect(imageFromSse('data: not json\n\n')).toBeNull();
  });
});
