// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import DrawingProgress, { drawingProgress } from './DrawingProgress';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('绘图动画', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    host?.remove();
  });

  it('进度条按经验时长估，最多走到 94%，不会走完了图还没来', () => {
    expect(drawingProgress(0, 9000)).toBe(0);
    expect(drawingProgress(9000, 9000)).toBeGreaterThan(0.8);
    expect(drawingProgress(9000, 9000)).toBeLessThan(0.94);
    expect(drawingProgress(120_000, 9000)).toBe(0.94);
  });

  it('按已用时间说明画到哪一步，写出正在画什么', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(React.createElement(DrawingProgress, { prompt: '画一只在月球上看书的猫', lang: 'zh', startedAt: Date.now() - 5000 }));
    });
    const status = host.querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-label')).toBe('正在画：画一只在月球上看书的猫');
    expect(status.textContent).toContain('勾勒线稿');
    expect(status.textContent).toContain('已用 5 秒');
  });
});
