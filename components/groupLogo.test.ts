// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 小组 logo（2026-10-11）：上传前缩到 512 像素以内；教职在方框里点选或拖入图片，拖组员时不拦；
 * 画布上的视图卡片有 logo 就显示，图片打不开时退回没有 logo 的样子。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { checkLogoFile, fitWithin, logoErrorText, LogoError, prepareLogo } from './groupLogo';
import GroupLogoSlot from './GroupLogoSlot';
import ViewCard from './ViewCard';

describe('缩放和检查', () => {
  it('最长边缩到 512，不放大；拿不到尺寸按 512 见方', () => {
    expect(fitWithin(2048, 1024)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(300, 900)).toEqual({ width: 171, height: 512 });
    expect(fitWithin(200, 120)).toEqual({ width: 200, height: 120 });
    expect(fitWithin(0, 0)).toEqual({ width: 512, height: 512 });
  });

  it('不是图片、超过 15MB 的不解码直接拒绝；提示说清楚原因', async () => {
    expect(checkLogoFile({ type: 'application/pdf', size: 10 })).toBe('type');
    expect(checkLogoFile({ type: 'image/png', size: 16 * 1024 * 1024 })).toBe('size');
    expect(checkLogoFile({ type: 'image/svg+xml', size: 2000 })).toBeNull();
    await expect(prepareLogo(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toMatchObject({ problem: 'type' });
    expect(logoErrorText(new LogoError('decode'), true)).toContain('打不开');
    expect(logoErrorText(new Error('500'), true)).toContain('没有上传成功');
  });
});

describe('logo 方框和视图卡片', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const render = (el: React.ReactElement) => act(async () => { root.render(el); });
  const dropEvent = (types: string[], files: File[] = []) => {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    Object.defineProperty(event, 'dataTransfer', { value: { types, files } });
    return event;
  };

  it('教职：选了文件就上传；拖入图片文件也上传，拖组员（不是文件）时交给外面的小组卡片', async () => {
    const onUpload = vi.fn(async () => {});
    const onCardDrop = vi.fn();
    await render(React.createElement('div', { onDrop: onCardDrop },
      React.createElement(GroupLogoSlot, { name: '第一组', lang: 'zh', editable: true, onUpload })));
    const file = new File(['png'], 'logo.png', { type: 'image/png' });
    const input = host.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onUpload).toHaveBeenCalledWith(file);

    const button = host.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toContain('给第一组上传 logo');
    await act(async () => { button.dispatchEvent(dropEvent(['Files'], [file])); });
    expect(onUpload).toHaveBeenCalledTimes(2);
    expect(onCardDrop).not.toHaveBeenCalled();
    await act(async () => { button.dispatchEvent(dropEvent(['text/plain'])); });
    expect(onUpload).toHaveBeenCalledTimes(2);
    expect(onCardDrop).toHaveBeenCalledTimes(1);
  });

  it('有 logo 时显示图片，可以去掉；不是教职只显示图片，没有 logo 就什么都不画', async () => {
    const onClear = vi.fn(async () => {});
    await render(React.createElement(GroupLogoSlot, { name: '第一组', lang: 'zh', editable: true, logoUrl: 'https://store.example/a.png', onClear }));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://store.example/a.png');
    const remove = host.querySelector('button[aria-label="去掉第一组的 logo"]') as HTMLButtonElement;
    await act(async () => { remove.click(); });
    expect(onClear).toHaveBeenCalledTimes(1);

    await render(React.createElement(GroupLogoSlot, { name: '第二组', lang: 'zh', logoUrl: 'https://store.example/b.png' }));
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.querySelector('img')?.getAttribute('alt')).toBe('第二组 的 logo');
    await render(React.createElement(GroupLogoSlot, { name: '第三组', lang: 'zh', logoUrl: null }));
    expect(host.innerHTML).toBe('');
  });

  it('视图卡片：有 logo 显示在左边；图片打不开退回原来的样子；没有 logo 不画图片', async () => {
    const base = { viewId: 'v1', title: '第一组', noteCount: 3, x: 0, y: 0, lang: 'zh' as const, onMouseDown: () => {}, onContextMenu: () => {} };
    await render(React.createElement(ViewCard, { ...base, logoUrl: 'https://store.example/a.png' }));
    const img = host.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://store.example/a.png');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(host.textContent).toContain('第一组');
    await act(async () => { img.dispatchEvent(new Event('error')); });
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('第一组');
    await render(React.createElement(ViewCard, { ...base, viewId: 'v2', logoUrl: null }));
    expect(host.querySelector('img')).toBeNull();
  });
});
