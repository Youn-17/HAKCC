// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AiThinking, { AiThinkingDots, SHOW_SECONDS_AFTER_MS, SLOW_HINT_AFTER_MS, waitedSeconds } from './AiThinking';

/**
 * AI 在想的时候放在对话里的动效：三个点 + 一句「正在做什么」，等久了再补上秒数和一句宽心话。
 * 只是「在忙」的提示，不冒充进度。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-29T08:00:00.000Z'));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const render = (props: { label?: string; startedAt: number; lang?: 'zh' | 'en' }) => {
  act(() => {
    root.render(React.createElement(AiThinking, { label: props.label ?? '正在思考', startedAt: props.startedAt, lang: props.lang ?? 'zh' }));
  });
};
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('waitedSeconds', () => {
  it('向下取整，不出现负数', () => {
    expect(waitedSeconds(0)).toBe(0);
    expect(waitedSeconds(2999)).toBe(2);
    expect(waitedSeconds(12500)).toBe(12);
    expect(waitedSeconds(-800)).toBe(0);
  });
});

describe('AiThinking', () => {
  it('是一个 status：读屏软件能听到，三个点是装饰不读，标了 data-ai-busy 供面板判断', () => {
    render({ startedAt: Date.now() });
    const status = host.querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.hasAttribute('data-ai-busy')).toBe(true);
    expect(status.textContent).toContain('正在思考');
    const dots = status.querySelector('.ai-dots')!;
    expect(dots.getAttribute('aria-hidden')).toBe('true');
    expect(dots.querySelectorAll('.ai-dot')).toHaveLength(3);
  });

  it('刚开始不显示秒数：一两秒就出结果的时候，数字一闪而过反而添乱', () => {
    render({ startedAt: Date.now() });
    advance(SHOW_SECONDS_AFTER_MS - 600);
    expect(host.textContent).not.toMatch(/\d+ 秒/);
  });

  it('等满三秒起显示已经等了几秒，之后随时间走', () => {
    render({ startedAt: Date.now() });
    advance(SHOW_SECONDS_AFTER_MS + 500);
    expect(host.textContent).toContain('3 秒');
    advance(4000);
    expect(host.textContent).toContain('7 秒');
  });

  it('等满十五秒补一句宽心话；之前没有', () => {
    render({ startedAt: Date.now() });
    advance(SLOW_HINT_AFTER_MS - 1000);
    expect(host.textContent).not.toContain('请稍等');
    advance(1500);
    expect(host.textContent).toContain('还在处理，请稍等');
  });

  it('秒数从这一轮问答开始算：状态变了、组件换了位置也不重新计时', () => {
    const startedAt = Date.now() - 9000;
    render({ startedAt, label: '正在思考' });
    expect(host.textContent).toContain('9 秒');
    render({ startedAt, label: '正在组织回答' });
    expect(host.textContent).toContain('正在组织回答');
    expect(host.textContent).toContain('9 秒');
  });

  it('英文界面用英文', () => {
    render({ startedAt: Date.now() - 20000, label: 'Thinking', lang: 'en' });
    expect(host.textContent).toContain('Thinking');
    expect(host.textContent).toContain('20s');
    expect(host.textContent).toContain('taking a while');
  });

  it('卸载后不再计时（不留定时器）', () => {
    render({ startedAt: Date.now() });
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('AiThinkingDots', () => {
  it('单独用：回复一边流出来时挂在文字后面，表示还在写；不带 status，不重复播报', () => {
    act(() => { root.render(React.createElement(AiThinkingDots)); });
    expect(host.querySelectorAll('.ai-dot')).toHaveLength(3);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
