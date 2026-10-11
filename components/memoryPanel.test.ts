// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** 「AI 记得什么」面板（第四步）：分三类列出来，单条删、整类清除前先问、开关，读不到时说一声 */

const api = vi.hoisted(() => ({
  get: vi.fn(),
  deleteItem: vi.fn(async () => ({ ok: true })),
  clear: vi.fn(async () => ({ ok: true, removed: 1 })),
  setEnabled: vi.fn(async (_c: string, enabled: boolean) => ({ ok: true, enabled })),
}));

vi.mock('../services/apiClient', () => ({ memoryApi: api }));

import MemoryPanel from './agent/MemoryPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const view = {
  enabled: true,
  scaffolding: { level: 'medium', interactions: 12 },
  profile: [{ id: 'p1', kind: 'profile', type: 'knowledge_gap', content: '还没弄懂合意困难', createdAt: '2026-10-10T02:00:00Z', updatedAt: '2026-10-11T02:00:00Z', lastUsedAt: null }],
  episodes: [{ id: 'e1', kind: 'episode', type: 'choice', content: '在「做哪种」里选了「对比表」', createdAt: '2026-10-11T03:00:00Z', updatedAt: '2026-10-11T03:00:00Z', lastUsedAt: null }],
  conversation: { summary: '学生在比较两种个性化。', updatedAt: null },
};

let root: Root | null = null;
let host: HTMLDivElement;

async function mount(onClose = vi.fn()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(MemoryPanel, { courseId: 'c1', lang: 'zh', surface: 'workspace', conversationId: 'conv1', onClose }));
  });
  await act(async () => { await Promise.resolve(); });
  return onClose;
}

const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;

beforeEach(() => {
  api.get.mockReset();
  api.deleteItem.mockClear();
  api.clear.mockClear();
  api.setEnabled.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe('AI 记得什么', () => {
  it('三类分开列：这段对话的要点、关于你的了解、关键时刻；带类型和日期，底下说提示多少', async () => {
    api.get.mockResolvedValue(view);
    await mount();
    expect(api.get).toHaveBeenCalledWith('c1', { surface: 'workspace', conversationId: 'conv1' });
    const text = host.textContent ?? '';
    expect(text).toContain('这段对话的要点');
    expect(text).toContain('学生在比较两种个性化。');
    expect(text).toContain('还没弄懂合意困难');
    expect(text).toContain('还没弄懂');
    expect(text).toContain('做了选择');
    expect(text).toContain('记于 10月10日');
    expect(text).toContain('AI 给你的提示：适中');
  });

  it('删一条：调接口、从列表里拿掉', async () => {
    api.get.mockResolvedValue(view);
    await mount();
    const del = host.querySelectorAll('button[aria-label="删除这条记忆"]');
    expect(del).toHaveLength(2);
    await act(async () => { (del[0] as HTMLButtonElement).click(); });
    expect(api.deleteItem).toHaveBeenCalledWith('p1');
    expect(host.textContent).not.toContain('还没弄懂合意困难');
  });

  it('整类清除先问一句；开关调接口', async () => {
    api.get.mockResolvedValue(view);
    await mount();
    await act(async () => { button('全部清除')!.click(); });
    expect(api.clear).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('清除这一类的 1 条');
    await act(async () => { button('清除')!.click(); });
    expect(api.clear).toHaveBeenCalledWith('c1', 'profile');

    const sw = host.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await act(async () => { sw.click(); });
    expect(api.setEnabled).toHaveBeenCalledWith('c1', false);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(host.textContent).toContain('已关闭跨对话记忆');
  });

  it('读不到：说一声；Esc 关掉', async () => {
    api.get.mockRejectedValue(new Error('500'));
    const onClose = await mount();
    expect(host.textContent).toContain('暂时无法读取记忆');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalled();
  });
});
