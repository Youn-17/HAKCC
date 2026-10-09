// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import DrawingProgress, { drawingProgress, nextDrawingState } from './DrawingProgress';

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

  it('推流的入口：先「读懂你的意思」，规划好了换成「正在画：说明」，计时接着算（2026-10-09）', async () => {
    const t0 = Date.now() - 6000;
    const planning = nextDrawingState(null, { prompt: '画一张我们讨论的关系图', stage: 'planning' }, t0);
    expect(planning).toEqual({ prompt: '画一张我们讨论的关系图', startedAt: t0, phase: 'planning' });
    const drawing = nextDrawingState(planning, { prompt: '画一张我们讨论的关系图', stage: 'drawing', caption: '根据你们的讨论，画了三种看法之间的关系。' }, t0 + 3000);
    expect(drawing).toMatchObject({ startedAt: t0, phase: 'drawing', drawingStartedAt: t0 + 3000, caption: '根据你们的讨论，画了三种看法之间的关系。' });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(React.createElement(DrawingProgress, { ...planning, lang: 'zh' })); });
    expect(host.querySelector('[role="status"]')!.textContent).toContain('结合对话和笔记构思');
    await act(async () => { root!.render(React.createElement(DrawingProgress, { ...drawing, lang: 'zh' })); });
    const status = host.querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-label')).toBe('正在画：根据你们的讨论，画了三种看法之间的关系。');
    expect(status.textContent).toContain('勾勒线稿');
    expect(status.textContent).toContain('已用 6 秒');
  });

  it('改上一张：第一段写「读懂你要怎么改」，推流里的 mode 一路带着', async () => {
    const t0 = Date.now() - 500;
    const planning = nextDrawingState(null, { prompt: '颜色淡一点', stage: 'planning', mode: 'edit' }, t0);
    expect(planning).toEqual({ prompt: '颜色淡一点', startedAt: t0, phase: 'planning', mode: 'edit' });
    expect(nextDrawingState(planning, { prompt: '颜色淡一点', stage: 'drawing', caption: '把颜色调淡了。', mode: 'edit' }, t0 + 2000))
      .toMatchObject({ phase: 'drawing', mode: 'edit', caption: '把颜色调淡了。' });
    // 旧的推流没有 mode：照旧
    expect(nextDrawingState(null, { prompt: '画一只猫', stage: 'planning' }, t0)).not.toHaveProperty('mode');

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(React.createElement(DrawingProgress, { ...planning, lang: 'zh' })); });
    expect(host.querySelector('[role="status"]')!.textContent).toContain('读懂你要怎么改');
    // 不推阶段的入口（笔记 AI、对话式笔记、文档 AI）按时间估，也换成改图的字
    await act(async () => { root!.render(React.createElement(DrawingProgress, { prompt: '颜色淡一点', lang: 'zh', startedAt: Date.now(), mode: 'edit' })); });
    expect(host.querySelector('[role="status"]')!.textContent).toContain('读懂你要怎么改');
  });
});
