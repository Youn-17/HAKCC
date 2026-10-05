// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 问题栏后面的讨论主题：笔记的指纹，和什么时候去取（2026-10-05）。
 */

const h = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { get: vi.fn() };
});
vi.mock('../services/apiClient', () => ({ viewTopics: { get: h.get } }));

import { CHANGE_DEBOUNCE_MS, notesFingerprint, STALE_RETRY_MS, useViewTopics } from './viewTopics';
import ViewTopicTicker, { MIN_VISIBLE_WIDTH } from './ViewTopicTicker';

const note = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'note' as const, title: `笔记 ${id}`, content: '<p>正文</p>', ...over });

describe('notesFingerprint', () => {
  it('同一批笔记、顺序不同：指纹一样', () => {
    expect(notesFingerprint([note('a'), note('b')])).toBe(notesFingerprint([note('b'), note('a')]));
  });

  it('多了一条、改了标题、正文变长：指纹都变', () => {
    const base = notesFingerprint([note('a'), note('b')]);
    expect(notesFingerprint([note('a'), note('b'), note('c')])).not.toBe(base);
    expect(notesFingerprint([note('a', { title: '新标题' }), note('b')])).not.toBe(base);
    expect(notesFingerprint([note('a', { content: '<p>正文加长了</p>' }), note('b')])).not.toBe(base);
  });

  it('视图卡不算', () => {
    expect(notesFingerprint([note('a'), note('v', { type: 'view' })])).toBe(notesFingerprint([note('a')]));
  });
});

describe('useViewTopics：什么时候去取', () => {
  let root: Root;
  let host: HTMLDivElement;
  let latest: Array<{ label: string }> = [];

  function Probe({ space, view, fp }: { space: string; view: string; fp: string }) {
    latest = useViewTopics(space, view, fp);
    return null;
  }
  const render = async (space: string, view: string, fp: string) => {
    await act(async () => { root.render(React.createElement(Probe, { space, view, fp })); });
  };
  const advance = async (ms: number) => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    h.get.mockReset();
    h.get.mockResolvedValue({ topics: [{ label: '主题一', noteIds: ['a'], count: 1 }] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    latest = [];
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.useRealTimers();
  });

  it('刚打开时笔记陆续加载、指纹连着变：还没取到过就马上取，不等 30 秒', async () => {
    // 第一次的回答还没回来，笔记就加载完了
    let resolveFirst!: (v: unknown) => void;
    h.get.mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }));
    await render('s', 'v', 'empty');
    await advance(0);
    expect(h.get).toHaveBeenCalledTimes(1);

    await render('s', 'v', 'loaded');
    resolveFirst({ topics: [{ label: '过时的', noteIds: [], count: 0 }] });
    await advance(0);
    expect(h.get).toHaveBeenCalledTimes(2);
    expect(latest.map(t => t.label)).toEqual(['主题一']);
  });

  it('取到过以后，笔记变了等 30 秒没有新变化再取', async () => {
    await render('s', 'v', 'fp1');
    await advance(0);
    expect(h.get).toHaveBeenCalledTimes(1);

    await render('s', 'v', 'fp2');
    await advance(CHANGE_DEBOUNCE_MS - 1000);
    await render('s', 'v', 'fp3');
    await advance(CHANGE_DEBOUNCE_MS - 1000);
    expect(h.get).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  it('服务器说是旧的：一分钟后再取一次', async () => {
    h.get.mockResolvedValueOnce({ topics: [{ label: '旧的', noteIds: [], count: 0 }], stale: true });
    await render('s', 'v', 'fp1');
    await advance(0);
    expect(latest.map(t => t.label)).toEqual(['旧的']);
    await advance(STALE_RETRY_MS);
    expect(h.get).toHaveBeenCalledTimes(2);
    expect(latest.map(t => t.label)).toEqual(['主题一']);
  });

  it('服务器说没生成出来：按它说的时间再取，不会停在空的', async () => {
    h.get.mockResolvedValueOnce({ topics: [], failed: true, retryAfterMs: 120_000 });
    await render('s', 'v', 'fp1');
    await advance(0);
    expect(latest).toEqual([]);
    await advance(STALE_RETRY_MS);
    expect(h.get).toHaveBeenCalledTimes(1);
    await advance(120_000 - STALE_RETRY_MS);
    expect(h.get).toHaveBeenCalledTimes(2);
    expect(latest.map(t => t.label)).toEqual(['主题一']);
  });

  it('换了视图：先清空，马上取新视图的', async () => {
    await render('s', 'v1', 'fp1');
    await advance(0);
    expect(latest).toHaveLength(1);
    h.get.mockImplementationOnce(() => new Promise(() => {}));
    await render('s', 'v2', 'fp1');
    expect(latest).toEqual([]);
    await advance(0);
    expect(h.get).toHaveBeenLastCalledWith('s', 'v2');
    expect(h.get).toHaveBeenCalledTimes(2);
  });
});

describe('ViewTopicTicker：问题优先，放不下就藏起来', () => {
  let root: Root;
  let host: HTMLDivElement;
  let boxWidth = 0;
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const topics = [{ label: '主题一', noteIds: ['a'], count: 1 }, { label: '主题二', noteIds: ['b'], count: 2 }];

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) { return this.hasAttribute('data-view-topics') ? boxWidth : 0; },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
  });

  const show = async () => {
    await act(async () => { root.render(React.createElement(ViewTopicTicker, { topics, lang: 'zh', onSelect: () => {} })); });
    return host.querySelector<HTMLElement>('[data-view-topics]')!;
  };

  it('问题很长或窗口很窄，剩下的地方放不下一个主题：整条藏起来，不滚动', async () => {
    boxWidth = MIN_VISIBLE_WIDTH - 1;
    const strip = await show();
    expect(strip.dataset.viewTopics).toBe('hidden');
    expect(strip.className).toContain('invisible');
    expect(strip.querySelector('.topic-marquee')).toBeNull();
  });

  it('地方够：显示出来', async () => {
    boxWidth = 400;
    const strip = await show();
    expect(strip.dataset.viewTopics).toBe('static');
    expect(strip.className).not.toContain('invisible');
    expect(strip.textContent).toContain('主题二');
  });
});
