import { describe, expect, it } from 'vitest';
import { defaultImageProvider } from './aiFeatureModels';

describe('生图默认先用哪家', () => {
  // 2026-09-29 平台负责人定：作图默认 MiniMax，出图更好。
  // 代价是慢：实测 MiniMax image-01 35s，DMX qwen-image-plus 6.2–6.8s。
  // 课程可以在 AI 设置里把「生成图片」改成 DMX；服务器也可以整体改回 DMX 优先。
  it('默认 DMX（2026-09-29 平台负责人改的：DMX 的 key 专门用来画图）', () => {
    expect(defaultImageProvider(undefined)).toBe('dmx');
    expect(defaultImageProvider('')).toBe('dmx');
    expect(defaultImageProvider('dmx')).toBe('dmx');
  });

  it('服务器显式设 minimax 才默认先 MiniMax', () => {
    expect(defaultImageProvider('minimax')).toBe('minimax');
    expect(defaultImageProvider(' MiniMax ')).toBe('minimax');
  });

  it('拼错的取值按默认走', () => {
    expect(defaultImageProvider('minmax')).toBe('dmx');
    expect(defaultImageProvider('true')).toBe('dmx');
  });
});
