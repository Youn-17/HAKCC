// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAiSurfaceMotion } from './useAiMotion';

const { animate } = vi.hoisted(() => ({ animate: vi.fn(() => ({ revert: vi.fn() })) }));
vi.mock('animejs', () => ({ animate, stagger: () => () => 0 }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = undefined; root = undefined; });
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.clearAllMocks(); media.matches = false; });

function Surface({ texts, open = true, ready = true, identity = '', busy = false, state = 'running', shell = '' }: { texts: string[]; open?: boolean; ready?: boolean; identity?: string; busy?: boolean; state?: string; shell?: string }) {
  const ref = useAiSurfaceMotion({ open, ready });
  return React.createElement('div', { ref, key: shell },
    ...texts.map((text, index) => React.createElement('div', { key: `${identity}-${index}`, 'data-ai-motion': 'message', 'data-ai-motion-key': index }, text)),
    busy && React.createElement('span', { key: 'dots', 'data-ai-motion': 'dots' }, React.createElement('span', { className: 'ai-dot' })),
    busy && React.createElement('span', { key: 'indicator', 'data-ai-motion': 'indicator', 'data-ai-motion-state': state }, state),
  );
}
async function render(texts: string[], options: { open?: boolean; ready?: boolean; identity?: string; busy?: boolean; state?: string; shell?: string } = {}) {
  if (!host) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  await act(async () => { root.render(React.createElement(Surface, { texts, ...options })); });
}

it('历史消息静态显示；新消息出现一次，流式更新不重复入场', async () => {
  await render(['历史回答']);
  expect(animate).not.toHaveBeenCalled();
  await render(['历史回答', '正在']);
  expect(animate).toHaveBeenCalledTimes(1);
  await render(['历史回答', '正在生成回答']);
  expect(animate).toHaveBeenCalledTimes(1);
});

it('临时消息换正式 ID 后不重播；清空后新对话可以再次入场', async () => {
  await render([]);
  await render(['回答'], { identity: 'stream' });
  expect(animate).toHaveBeenCalledTimes(1);
  await render(['回答完成'], { identity: 'saved' });
  expect(animate).toHaveBeenCalledTimes(1);
  await render([]);
  await render(['新问题']);
  expect(animate).toHaveBeenCalledTimes(2);
});

it('异步读回历史不播放；接着发送的新消息正常播放', async () => {
  await render([], { ready: false });
  await render(['之前的问题', '之前的回答'], { ready: false });
  await render(['之前的问题', '之前的回答']);
  expect(animate).not.toHaveBeenCalled();
  await render(['之前的问题', '之前的回答', '继续问']);
  expect(animate).toHaveBeenCalledTimes(1);
});

it('关闭面板清理所有动画，隐藏期间不播放，重开只恢复忙碌提示', async () => {
  await render([], { busy: true });
  expect(animate).toHaveBeenCalledTimes(2);
  const instances = animate.mock.results.map(result => result.value);
  await render([], { open: false, busy: true });
  instances.forEach(instance => expect(instance.revert).toHaveBeenCalled());
  await render(['后台回答'], { open: false });
  expect(animate).toHaveBeenCalledTimes(2);
  await render(['后台回答']);
  expect(animate).toHaveBeenCalledTimes(2);
});

it('减少动态效果时所有文字直接可见，且不创建动画', async () => {
  media.matches = true;
  await render([], { busy: true });
  await render(['完整回答'], { busy: true });
  expect(host.textContent).toContain('完整回答');
  expect(animate).not.toHaveBeenCalled();
});

it('运行中启用减少动态效果会立即停止动画', async () => {
  await render([], { busy: true });
  const instances = animate.mock.results.map(result => result.value);
  media.matches = true;
  act(() => { media.addEventListener.mock.calls.forEach(([, callback]) => callback()); });
  instances.forEach(instance => expect(instance.revert).toHaveBeenCalled());
});

it('工具状态变成失败后停止呼吸；卸载清理动画和监听', async () => {
  await render([], { busy: true });
  const indicator = animate.mock.results[1].value;
  await render([], { busy: true, state: 'error' });
  expect(indicator.revert).toHaveBeenCalled();
  expect(host.querySelector('[data-ai-motion="indicator"]')?.textContent).toBe('error');
  const instances = animate.mock.results.map(result => result.value);
  act(() => root.unmount());
  root = undefined;
  instances.forEach(instance => expect(instance.revert).toHaveBeenCalled());
  expect(media.removeEventListener).toHaveBeenCalled();
});

it('页面进入后台暂停循环，回到前台恢复，正文不重播', async () => {
  await render(['回答'], { busy: true });
  const instances = animate.mock.results.map(result => result.value);
  const hidden = vi.spyOn(document, 'hidden', 'get');
  hidden.mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  instances.forEach(instance => expect(instance.revert).toHaveBeenCalled());
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(animate).toHaveBeenCalledTimes(4);
  hidden.mockRestore();
});

it('桌面与手机切换更换面板 DOM 时，清理旧动画并接续新面板', async () => {
  await render(['回答'], { busy: true, shell: 'desktop' });
  const instances = animate.mock.results.map(result => result.value);
  await render(['回答'], { busy: true, shell: 'mobile' });
  instances.forEach(instance => expect(instance.revert).toHaveBeenCalled());
  expect(animate).toHaveBeenCalledTimes(4);
  await render(['回答', '继续问'], { busy: true, shell: 'mobile' });
  expect(animate).toHaveBeenCalledTimes(5);
});
