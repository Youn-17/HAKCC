// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * useEnterMotion（2026-10-10）：play 变成新的非空值时，root 里的项依次淡入上移；
 * 只动看得见的项、错开有上限；播放时关掉元素自己的 transition，播完或打断时还原；
 * 系统「减少动态效果」时不动。anime.js 换成假的。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const anime = vi.hoisted(() => {
  const runs: Array<{ targets: HTMLElement[]; params: Record<string, any>; revert: ReturnType<typeof vi.fn>; transitionsAtStart: string[] }> = [];
  return {
    runs,
    animate: vi.fn((targets: HTMLElement[], params: Record<string, any>) => {
      const run = { targets, params, revert: vi.fn(), transitionsAtStart: targets.map(t => t.style.transition) };
      runs.push(run);
      return { revert: run.revert };
    }),
  };
});
vi.mock('animejs', () => ({ animate: anime.animate, createLayout: vi.fn() }));

import { playEnter, useEnterMotion } from './useEnterMotion';

let reduced = false;
const visible = { top: 10, bottom: 50, left: 0, right: 100, width: 100, height: 40 };

const Panel: React.FC<{ play: unknown; ids: string[]; targets?: (root: HTMLElement) => Element[] }> = ({ play, ids, targets }) => {
  const ref = useRef<HTMLUListElement>(null);
  useEnterMotion(ref, play, { step: 30, maxStagger: 2, targets });
  return React.createElement('ul', { ref }, ids.map(id => React.createElement('li', {
    key: id, 'data-enter-item': id.startsWith('x') ? undefined : '', 'data-id': id, style: id === 'b' ? { transition: 'opacity 1s' } : undefined,
  }, id)));
};

describe('useEnterMotion', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    reduced = false;
    anime.runs.length = 0;
    anime.animate.mockClear();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }) });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.dataset.id === 'off' ? { ...visible, top: 5000, bottom: 5040 } : visible) as DOMRect;
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  const render = (props: React.ComponentProps<typeof Panel>) => act(async () => { root.render(React.createElement(Panel, props)); });

  it('play 为空不播；变成新值时按顺序动标了的项，屏幕外的不动，错开到上限为止', async () => {
    await render({ play: null, ids: ['a', 'b', 'x1', 'off', 'c', 'd'] });
    expect(anime.animate).not.toHaveBeenCalled();
    await render({ play: 'open', ids: ['a', 'b', 'x1', 'off', 'c', 'd'] });
    expect(anime.runs).toHaveLength(1);
    const run = anime.runs[0];
    expect(run.targets.map(t => t.dataset.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(run.params).toMatchObject({ opacity: [0, 1], translateY: [6, 0], duration: 280, ease: 'out(4)' });
    expect(run.targets.map((t, i) => run.params.delay(t, i))).toEqual([0, 30, 60, 60]);
    // 同一个值再渲染一次不重播
    await render({ play: 'open', ids: ['a', 'b', 'x1', 'off', 'c', 'd'] });
    expect(anime.runs).toHaveLength(1);
  });

  it('播放时关掉元素的 transition；播完把动画样式清掉、transition 还原', async () => {
    await render({ play: 1, ids: ['a', 'b'] });
    const run = anime.runs[0];
    expect(run.transitionsAtStart).toEqual(['none', 'none']);
    run.params.onComplete();
    expect(run.revert).toHaveBeenCalledTimes(1);
    expect(run.targets.map(t => t.style.transition)).toEqual(['', 'opacity 1s']);
    // 再停一次不会重复还原
    run.params.onComplete();
    expect(run.revert).toHaveBeenCalledTimes(1);
  });

  it('换成新值时先把上一次停下（回到自身样式）再播；卸载时也停下', async () => {
    await render({ play: 'a', ids: ['a', 'b'] });
    await render({ play: 'b', ids: ['a', 'b'] });
    expect(anime.runs).toHaveLength(2);
    expect(anime.runs[0].revert).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(anime.runs[1].revert).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it('可以自己选目标；系统设置「减少动态效果」时不动', async () => {
    await render({ play: 'x', ids: ['a', 'x1', 'x2'], targets: el => Array.from(el.children).filter(c => (c as HTMLElement).dataset.id?.startsWith('x')) });
    expect(anime.runs[0].targets.map(t => t.dataset.id)).toEqual(['x1', 'x2']);
    reduced = true;
    await render({ play: 'y', ids: ['a', 'b'] });
    expect(anime.runs).toHaveLength(1);
  });

  it('playEnter：没有看得见的目标、或者只有隐藏的元素时什么都不做', () => {
    const hidden = document.createElement('div');
    vi.spyOn(hidden, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect);
    const stop = playEnter([hidden]);
    expect(anime.animate).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});
