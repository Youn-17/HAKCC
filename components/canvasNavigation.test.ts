// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  createWheelClassifier, isTypingTarget, looksLikeMouseWheel, stepZoom, wheelPanDelta, wheelZoomFactor, zoomAround,
} from './canvasNavigation';

/**
 * 画布的平移和缩放（2026-10-10）：鼠标滚轮缩放、触控板双指滑动平移、捏合缩放；按钮按档位缩放；
 * 缩放时指针下面的内容不动。
 */

const wheel = (over: Partial<WheelEvent & { wheelDeltaY: number }> = {}) => ({
  deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, timeStamp: 0, ...over,
}) as Parameters<ReturnType<typeof createWheelClassifier>>[0];

describe('分清鼠标滚轮和触控板', () => {
  it('鼠标：wheelDeltaY 是 120 的倍数、Firefox 按行滚、没有 wheelDeltaY 时一格就很大', () => {
    expect(looksLikeMouseWheel(wheel({ deltaY: 100, wheelDeltaY: -120 }))).toBe(true);
    expect(looksLikeMouseWheel(wheel({ deltaY: 4, wheelDeltaY: -240 }))).toBe(true);
    expect(looksLikeMouseWheel(wheel({ deltaY: 3, deltaMode: 1 }))).toBe(true);
    expect(looksLikeMouseWheel(wheel({ deltaY: 100 }))).toBe(true);
  });

  it('触控板：有横向分量、wheelDeltaY 不是 120 的倍数、小的小数值', () => {
    expect(looksLikeMouseWheel(wheel({ deltaX: 2, deltaY: 6 }))).toBe(false);
    expect(looksLikeMouseWheel(wheel({ deltaY: 7.5, wheelDeltaY: -22 }))).toBe(false);
    expect(looksLikeMouseWheel(wheel({ deltaY: 3.2 }))).toBe(false);
  });

  it('一串里按第一下走：触控板快速一划中途凑出 120 的倍数也不会变成缩放；停一会再判断', () => {
    const classify = createWheelClassifier();
    expect(classify(wheel({ deltaY: 6, wheelDeltaY: -18, timeStamp: 0 }))).toBe('pan');
    expect(classify(wheel({ deltaY: 40, wheelDeltaY: -120, timeStamp: 16 }))).toBe('pan');
    expect(classify(wheel({ deltaY: 100, wheelDeltaY: -120, timeStamp: 600 }))).toBe('zoom');
  });

  it('捏合（ctrlKey）随时是缩放；⌘ / Ctrl + 鼠标滚轮也是缩放；Shift + 滚轮是横向平移', () => {
    const classify = createWheelClassifier();
    expect(classify(wheel({ deltaY: 6, timeStamp: 0 }))).toBe('pan');
    expect(classify(wheel({ deltaY: 2.4, ctrlKey: true, timeStamp: 10 }))).toBe('pinch');
    expect(classify(wheel({ deltaY: 100, wheelDeltaY: -120, ctrlKey: true, timeStamp: 900 }))).toBe('zoom');
    expect(classify(wheel({ deltaY: 100, wheelDeltaY: -120, shiftKey: true, timeStamp: 2000 }))).toBe('pan');
    expect(classify(wheel({ deltaY: 6, metaKey: true, timeStamp: 3000 }))).toBe('zoom');
    expect(wheelPanDelta(wheel({ deltaY: 30, shiftKey: true }))).toEqual({ dx: 30, dy: 0 });
    expect(wheelPanDelta(wheel({ deltaX: 3, deltaY: 1, deltaMode: 1 }))).toEqual({ dx: 99, dy: 33 });
  });

  it('缩放倍数：往下滚缩小、往上滚放大；捏合比鼠标细；一下最多 300 像素的量', () => {
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0 }, 'zoom')).toBeLessThan(1);
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 }, 'zoom')).toBeGreaterThan(1);
    expect(wheelZoomFactor({ deltaY: 5, deltaMode: 0 }, 'pinch')).toBeCloseTo(Math.exp(-0.05));
    expect(wheelZoomFactor({ deltaY: 5000, deltaMode: 0 }, 'zoom')).toBeCloseTo(wheelZoomFactor({ deltaY: 300, deltaMode: 0 }, 'zoom'));
  });
});

describe('缩放', () => {
  it('以指针为中心：指针下面的那一点缩放前后在同一个屏幕位置', () => {
    const view = { x: -300, y: -120, zoom: 0.6 };
    const px = 400; const py = 250;
    const worldBefore = { x: (px - view.x) / view.zoom, y: (py - view.y) / view.zoom };
    const next = zoomAround(view, px, py, 1.2);
    expect(next.zoom).toBe(1.2);
    expect((px - next.x) / next.zoom).toBeCloseTo(worldBefore.x);
    expect((py - next.y) / next.zoom).toBeCloseTo(worldBefore.y);
    expect(zoomAround(view, 0, 0, 9).zoom).toBe(3);
    expect(zoomAround(view, 0, 0, 0.01).zoom).toBe(0.1);
  });

  it('按钮按档位走：60% 往上是 75%、往下是 50%；在两档之间先到相邻一档；到头不再动', () => {
    expect(stepZoom(0.6, 1)).toBe(0.75);
    expect(stepZoom(0.6, -1)).toBe(0.5);
    expect(stepZoom(0.67, 1)).toBe(0.75);
    expect(stepZoom(0.67, -1)).toBe(0.6);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.1, -1)).toBe(0.1);
  });
});

describe('空格平移不打扰输入', () => {
  it('输入框、可编辑区里按空格是打字', () => {
    const input = document.createElement('input');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editor.appendChild(inner);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(inner)).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
