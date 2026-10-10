// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { animate } = vi.hoisted(() => ({ animate: vi.fn((_targets: HTMLElement[], _options: unknown) => ({ revert: vi.fn() })) }));
vi.mock('animejs', () => ({ animate, stagger: () => () => 0 }));
import { useAnalyticsMotion } from './useAnalyticsMotion';

let host: HTMLDivElement, root: Root;
let preference: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let changed: () => void;
let hidden: boolean;
const content = { words: ['检索练习'] };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function Surface({ busy = false, selection = '', tool = 'cloud', extra = '' }) {
  const ref = useRef<HTMLElement>(null);
  useAnalyticsMotion(ref, { tool, busy, content: busy ? null : content, selection, settings: false });
  return React.createElement('main', { ref },
    React.createElement('header', { 'data-analysis-motion': 'chrome' }, '讨论分析'),
    React.createElement('nav', { className: 'da-tools' }, React.createElement('button', { 'aria-current': 'page' }, tool)),
    busy ? React.createElement('i', { className: 'da-loading-dot' }) : React.createElement('div', { 'data-analysis-motion': 'result' }, extra),
    selection && React.createElement('article', { className: 'da-source-note', key: selection }, selection));
}
async function render(props = {}) { await act(async () => root.render(React.createElement(Surface, props))); }
const callsFor = (selector: string) => animate.mock.calls.filter(([elements]) => (elements as HTMLElement[])[0]?.matches(selector));
beforeEach(() => {
  animate.mockClear(); hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  preference = { matches: false, addEventListener: vi.fn((_, callback) => { changed = callback; }), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => preference);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('结果只在加载完成或切换工具时过渡，选择来源不重播图表', async () => {
  await render({ busy: true });
  expect(callsFor('[data-analysis-motion="result"]')).toHaveLength(0);
  await render({ selection: '' });
  expect(callsFor('[data-analysis-motion="result"]')).toHaveLength(1);
  await render({ selection: 'source-1', extra: '原文' });
  expect(callsFor('[data-analysis-motion="result"]')).toHaveLength(1);
  expect(callsFor('.da-source-note')).toHaveLength(1);
  await render({ selection: 'source-1', tool: 'changes' });
  expect(callsFor('[data-analysis-motion="result"]')).toHaveLength(2);
});

it('减少动态效果从一开始就保持内容可读，不延迟或隐藏结果', async () => {
  preference.matches = true;
  await render({ selection: 'source-1', extra: '原文' });
  expect(animate).not.toHaveBeenCalled();
  expect(host.textContent).toContain('原文');
  preference.matches = false; changed();
  expect(animate).not.toHaveBeenCalled();
});

it('后台和动态偏好变化立即清理动画，仅在请求仍未完成时恢复提示', async () => {
  await render({ busy: true });
  const first = [...animate.mock.results];
  hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  for (const item of first) expect(item.value.revert).toHaveBeenCalled();
  hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  expect(callsFor('.da-loading-dot')).toHaveLength(2);
  preference.matches = true; changed();
  expect(animate.mock.results.at(-1)!.value.revert).toHaveBeenCalled();
  await render({ extra: '结果' });
  preference.matches = false; changed();
  expect(callsFor('.da-loading-dot')).toHaveLength(2);
});

it('更换来源及关闭页面后，旧动画和监听均释放', async () => {
  await render({ selection: 'source-1' });
  const previous = animate.mock.results.at(-1)!.value;
  await render({ selection: 'source-2' });
  expect(previous.revert).toHaveBeenCalled();
  await act(async () => root.unmount());
  for (const item of animate.mock.results) expect(item.value.revert).toHaveBeenCalled();
  expect(preference.removeEventListener).toHaveBeenCalledWith('change', changed);
});
