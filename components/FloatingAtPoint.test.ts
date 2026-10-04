// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import FloatingAtPoint, { placeAtPoint } from './FloatingAtPoint';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const screen = { width: 1280, height: 800 };

describe('placeAtPoint：右键菜单放在哪', () => {
  it('四周都够：就在点击处的右下方', () => {
    expect(placeAtPoint(300, 200, 200, 320, screen)).toEqual({ left: 300, top: 200, flipX: false, flipY: false });
  });

  it('笔记靠近屏幕下边：菜单翻到点击处上方，整个菜单都在屏幕里', () => {
    const p = placeAtPoint(300, 700, 200, 320, screen);
    expect(p).toMatchObject({ top: 380, flipY: true, flipX: false });
    expect(p.top + 320).toBeLessThanOrEqual(screen.height);
  });

  it('靠近右边：翻到左边；右下角：同时往左上翻', () => {
    expect(placeAtPoint(1200, 200, 200, 320, screen)).toMatchObject({ left: 1000, flipX: true, flipY: false });
    expect(placeAtPoint(1200, 700, 200, 320, screen)).toMatchObject({ left: 1000, top: 380, flipX: true, flipY: true });
  });

  it('上下都放不下（菜单比哪一侧的空间都高）：贴着屏幕边，不出屏', () => {
    const p = placeAtPoint(300, 300, 200, 500, { width: 1280, height: 600 });
    expect(p.flipY).toBe(false);
    expect(p.top).toBe(92);
    expect(p.top + 500).toBeLessThanOrEqual(600 - 8);
  });

  it('屏幕比菜单还矮：顶到边距为止，剩下的靠菜单自己滚动', () => {
    expect(placeAtPoint(300, 100, 200, 900, screen).top).toBe(8);
  });
});

describe('FloatingAtPoint 挂载后按自己的大小摆位置', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    host?.remove();
    vi.restoreAllMocks();
  });

  it('屏幕下边弹出的菜单往上翻，缩放从左下角长出来', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320);
    Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(React.createElement(FloatingAtPoint, { x: 300, y: 700, className: 'fixed' }, '菜单'));
    });
    const menu = host.firstElementChild as HTMLElement;
    expect(menu.style.top).toBe('380px');
    expect(menu.style.left).toBe('300px');
    expect(menu.style.transformOrigin).toBe('left bottom');
  });
});
