import { describe, expect, it } from 'vitest';
import {
  attachImagesToLastUserMessage, imageAttachmentsToParts,
  isImageAttachment, isVisionModel, pickVisionModel,
} from './visionMessages';

const img = (url: string) => ({ file_url: url, mime_type: 'image/png', file_name: 'a.png' });

describe('图片附件 → 模型消息', () => {
  it('只认图片附件，PDF 之类不进多模态消息', () => {
    expect(isImageAttachment({ mime_type: 'image/jpeg' })).toBe(true);
    expect(isImageAttachment({ mime_type: 'application/pdf', file_name: 'a.pdf' })).toBe(false);
    // 老附件没存 mime，退回看扩展名
    expect(isImageAttachment({ mime_type: null, file_name: 'photo.JPG' })).toBe(true);
  });

  it('把图挂到最后一条学生消息上，历史消息不动', () => {
    const messages = [
      { role: 'user' as const, content: '第一句' },
      { role: 'assistant' as const, content: '回复' },
      { role: 'user' as const, content: '看看这张图' },
    ];
    const out = attachImagesToLastUserMessage(messages, [img('https://x/a.png')]);

    expect(out[0].content).toBe('第一句');
    expect(out[1].content).toBe('回复');
    expect(out[2].content).toEqual([
      { type: 'text', text: '看看这张图' },
      { type: 'image_url', image_url: { url: 'https://x/a.png', detail: 'high' } },
    ]);
  });

  it('没有图片时原样返回同一个数组，好让调用方用引用判断有没有图', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }];
    expect(attachImagesToLastUserMessage(messages, [])).toBe(messages);
    expect(attachImagesToLastUserMessage(messages, [{ mime_type: 'application/pdf' }])).toBe(messages);
  });

  it('一轮最多带四张，避免一次塞爆上下文', () => {
    const many = Array.from({ length: 9 }, (_, i) => img(`https://x/${i}.png`));
    expect(imageAttachmentsToParts(many)).toHaveLength(4);
  });
});

describe('视觉模型选择', () => {
  // 带了图却用纯文本模型，模型会静默忽略图片块——学生以为 AI 看见了，其实没有。
  it('当前模型看不懂图时换成同厂商的视觉档', () => {
    // 2026-09-10 起 DeepSeek 的视觉能力并进了 deepseek-flash（V4.1），vision-exp 只是它的旧名
    expect(pickVisionModel('deepseek', 'deepseek-v4-pro')).toBe('deepseek-flash');
    expect(pickVisionModel('zhipu', 'glm-5.3')).toBe('glm-4.6v');
  });

  it('当前模型本来就看得懂图就不动它', () => {
    expect(pickVisionModel('zhipu', 'glm-4.6v')).toBe('glm-4.6v');
    expect(isVisionModel('deepseek', 'deepseek-v4-flash-vision-exp')).toBe(true);
  });

  it('enabled 列表里有的视觉档优先', () => {
    expect(pickVisionModel('zhipu', 'glm-5.3', ['glm-4.5v'])).toBe('glm-4.5v');
  });

  it('厂商没有任何视觉档时返回 null，让调用方自己决定怎么办', () => {
    expect(pickVisionModel('moonshot', 'kimi-k2.6')).toBeNull();
  });
});
