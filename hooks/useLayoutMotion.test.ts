// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * useLayoutMotion（2026-10-10）：改状态前 capture() 记下旧布局，提交后从旧布局动到新布局；
 * 错开按项在列表里的位置算；系统「减少动态效果」时什么都不做。anime.js 换成假的。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const anime = vi.hoisted(() => {
  const layouts: Array<{ root: HTMLElement; params: Record<string, unknown>; record: ReturnType<typeof vi.fn>; animate: ReturnType<typeof vi.fn>; revert: ReturnType<typeof vi.fn> }> = [];
  return {
    layouts,
    createLayout: vi.fn((root: HTMLElement, params: Record<string, unknown>) => {
      const layout = { root, params, record: vi.fn(), animate: vi.fn(), revert: vi.fn() };
      layouts.push(layout);
      return layout;
    }),
  };
});
vi.mock('animejs', () => ({ createLayout: anime.createLayout }));

import { useLayoutMotion } from './useLayoutMotion';

let reduced = false;
const List: React.FC = () => {
  const [items, setItems] = useState(['a', 'b', 'c']);
  const motion = useLayoutMotion<HTMLUListElement>({ step: 30, maxStagger: 2 });
  return React.createElement('div', null,
    React.createElement('button', { onClick: () => { motion.capture(); setItems(prev => [...prev, `n${prev.length}`]); } }, 'add'),
    React.createElement('button', { onClick: () => { motion.capture(); } }, 'noop'),
    React.createElement('button', { onClick: () => { setItems(prev => [...prev, `p${prev.length}`]); } }, 'plain'),
    React.createElement('ul', { ref: motion.ref }, items.map(id => React.createElement('li', { key: id, 'data-layout-item': '' }, React.createElement('span', null, id)))),
  );
};

describe('useLayoutMotion', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    reduced = false;
    anime.layouts.length = 0;
    anime.createLayout.mockClear();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }) });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
    await act(async () => { button.click(); });
  };

  it('改之前记下旧布局，提交后动到新布局；只把 data-layout-item 当目标', async () => {
    await act(async () => { root.render(React.createElement(List)); });
    await click('add');
    expect(anime.createLayout).toHaveBeenCalledTimes(1);
    const layout = anime.layouts[0];
    expect(layout.root.tagName).toBe('UL');
    expect(layout.params).toMatchObject({ children: '[data-layout-item]', swapAt: { opacity: 1 } });
    expect(layout.animate).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('li')).toHaveLength(4);
    // 第二次：复用同一个 layout，先 record 再 animate
    await click('add');
    expect(anime.createLayout).toHaveBeenCalledTimes(1);
    expect(layout.record).toHaveBeenCalledTimes(1);
    expect(layout.animate).toHaveBeenCalledTimes(2);
  });

  it('错开按项的位置算，项里面的元素跟着所在的项，超过上限的一起动', async () => {
    await act(async () => { root.render(React.createElement(List)); });
    await click('add');
    const delay = anime.layouts[0].animate.mock.calls[0][0].delay as (el: Element) => number;
    const items = [...host.querySelectorAll('li')];
    expect(items.map(el => delay(el))).toEqual([0, 30, 60, 60]);
    expect(delay(items[1].querySelector('span')!)).toBe(30);
    expect(delay(host.querySelector('ul')!)).toBe(0);
  });

  it('只 capture 没变化：后面无关的重绘不补动画', async () => {
    await act(async () => { root.render(React.createElement(List)); });
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    await click('noop');
    now.mockReturnValue(5000);
    await click('plain');
    expect(host.querySelectorAll('li')).toHaveLength(4);
    expect(anime.layouts[0].animate).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('系统设置减少动态效果：不建 layout、不动', async () => {
    reduced = true;
    await act(async () => { root.render(React.createElement(List)); });
    await click('add');
    expect(anime.createLayout).not.toHaveBeenCalled();
    expect(host.querySelectorAll('li')).toHaveLength(4);
  });
});
