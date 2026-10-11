import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 千问（百炼）生图（2026-10-11）：请求体是一条 user 消息 + 参数；图片地址从 output.choices[0].message.content 里取；
 * 失败时说出 HTTP 状态和百炼的错误码；课程填了业务空间地址就沿用那个域名。aiFetch 换成假的。
 */

const calls = vi.hoisted(() => [] as Array<{ url: string; init: RequestInit; opts: unknown }>);
const reply = vi.hoisted(() => ({ status: 200, body: {} as unknown }));
vi.mock('./aiGateway', () => ({
  aiFetch: async (url: string, init: RequestInit, opts: unknown) => {
    calls.push({ url, init, opts });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  },
}));

import { generateQwenImage, qwenImageEndpoint, qwenImageSize, QWEN_IMAGE_ENDPOINT } from './qwenImage';

afterEach(() => { calls.length = 0; reply.status = 200; reply.body = {}; });

describe('千问生图', () => {
  it('请求体：模型、一条 user 消息、尺寸按宽高比；取出图片地址', async () => {
    reply.body = { output: { choices: [{ message: { role: 'assistant', content: [{ image: 'https://dashscope-result.oss/x.png' }] } }] } };
    const result = await generateQwenImage({ apiKey: 'sk-test', prompt: '  一只在读书的猫  ', aspectRatio: '16:9' });
    expect(result).toEqual({ ok: true, url: 'https://dashscope-result.oss/x.png', model: 'qwen-image-2.0' });
    expect(calls[0].url).toBe(QWEN_IMAGE_ENDPOINT);
    expect(calls[0].opts).toMatchObject({ provider: 'alibaba' });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'qwen-image-2.0',
      input: { messages: [{ role: 'user', content: [{ text: '一只在读书的猫' }] }] },
      parameters: { size: '1664*928', n: 1, prompt_extend: true, watermark: false },
    });
  });

  it('失败时写明 HTTP 状态和百炼的错误码；返回里没有图片也算失败', async () => {
    reply.status = 400;
    reply.body = { code: 'InvalidParameter', message: 'Model not exist.' };
    expect(await generateQwenImage({ apiKey: 'k', prompt: '猫', model: 'qwen-image-9' })).toEqual({ ok: false, error: '千问生图失败：HTTP 400 InvalidParameter Model not exist.' });
    reply.status = 200;
    reply.body = { output: { choices: [{ message: { content: [{ text: '没有图' }] } }] } };
    const empty = await generateQwenImage({ apiKey: 'k', prompt: '猫' });
    expect(empty.ok).toBe(false);
    expect(await generateQwenImage({ apiKey: 'k', prompt: '   ' })).toEqual({ ok: false, error: '要画的内容为空' });
  });

  it('课程填了阿里云的接口地址就沿用那个域名；别的地址、写坏的地址用默认', () => {
    expect(qwenImageEndpoint('https://ws-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'))
      .toBe('https://ws-123.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    expect(qwenImageEndpoint('https://proxy.example.com/v1/chat/completions')).toBe(QWEN_IMAGE_ENDPOINT);
    expect(qwenImageEndpoint('not a url')).toBe(QWEN_IMAGE_ENDPOINT);
    expect(qwenImageEndpoint(null)).toBe(QWEN_IMAGE_ENDPOINT);
  });

  it('尺寸：宽高比优先；只给像素尺寸时找最接近的推荐尺寸；都没有用方图', () => {
    expect(qwenImageSize({ aspectRatio: '3:4' })).toBe('1104*1472');
    expect(qwenImageSize({ size: '1792x1024' })).toBe('1664*928');
    expect(qwenImageSize({ size: '1024x1024' })).toBe('1328*1328');
    expect(qwenImageSize({})).toBe('1328*1328');
  });
});
