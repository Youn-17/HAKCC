import { describe, expect, it, vi } from 'vitest';

/**
 * DMX 生图按模型给尺寸（2026-10-09）：qwen-image-plus 下架后默认换成豆包 Seedream 4.5，
 * 它要求至少 2048×2048，给 1024×1024 直接 400；其余模型照旧 1024×1024。
 */

const h = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>> }));

vi.mock('./aiGateway', () => ({
  aiFetch: vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    h.bodies.push(body);
    if (body.model === 'doubao-seedream-4-5-251128') {
      return { ok: false, status: 400, text: async () => 'size too small', json: async () => ({}) };
    }
    return { ok: true, status: 200, text: async () => '', json: async () => ({ data: [{ url: 'https://img.test/x.png' }] }) };
  }),
}));

import { generateImage } from './modelRouter';
import { DMX_IMAGE_MODELS } from './modelCatalog';

describe('generateImage', () => {
  it('默认先试 Seedream 4.5、给它 2048×2048；失败了换 GPT Image 2、给 1024×1024', async () => {
    expect(DMX_IMAGE_MODELS[0].id).toBe('doubao-seedream-4-5-251128');
    const result = await generateImage({ apiKey: 'k', chatEndpoint: 'https://www.dmxapi.cn/v1/chat/completions', prompt: '一只猫' });
    expect(result).toMatchObject({ ok: true, model: 'gpt-image-2', url: 'https://img.test/x.png' });
    expect(h.bodies.map(b => [b.model, b.size])).toEqual([
      ['doubao-seedream-4-5-251128', '2048x2048'],
      ['gpt-image-2', '1024x1024'],
    ]);
  });
});
