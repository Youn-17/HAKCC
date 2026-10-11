// @vitest-environment jsdom
/**
 * 智能体的选项卡、网页卡片、网页查看窗口（2026-10-11）。挂真组件、只替换取网页的接口：
 * 选项卡点了就交出那个选项，答过就锁住；查看窗口的 iframe 必须隔离（只给 allow-scripts、不给同源），
 * 网页里带着不能联网的内容安全策略；能切版本、能关。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { get: vi.fn() };
});

vi.mock('../../services/supabaseClient', () => ({ supabase: {} }));
vi.mock('../../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...actual, artifacts: { get: api.get } };
});

import { AgentChoiceCard, AgentPlanBlock, ArtifactCards, ArtifactViewer } from './AgentExtrasView';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function mount(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(element); });
  await flush();
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
  api.get.mockReset();
});

const question = { id: 'q1', question: '用哪种方式呈现？', options: [{ label: '概念图', detail: '看清联系' }, { label: '对比表' }], allowOther: true };
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const buttons = () => Array.from(document.querySelectorAll('[data-agent-question] button')) as HTMLButtonElement[];

describe('选项卡', () => {
  it('没答：每个选项一个按钮，点了交出那个选项；「都不是」交给输入框', async () => {
    const onChoose = vi.fn();
    const onOther = vi.fn();
    await mount(React.createElement(AgentChoiceCard, { question, answered: null, onChoose, onOther, lang: 'zh' }));
    expect(document.body.textContent).toContain('用哪种方式呈现？');
    expect(document.body.textContent).toContain('看清联系');
    await click(buttons()[1]);
    expect(onChoose).toHaveBeenCalledWith({ label: '对比表' });
    await click(buttons().find(b => b.textContent === '都不是，我自己说')!);
    expect(onOther).toHaveBeenCalled();
  });

  it('答过：按钮锁住，标出选的那个，不再给「都不是」', async () => {
    await mount(React.createElement(AgentChoiceCard, { question, answered: '概念图', onChoose: vi.fn(), onOther: vi.fn(), lang: 'zh' }));
    expect(buttons().every(b => b.disabled)).toBe(true);
    expect(buttons()[0].getAttribute('aria-pressed')).toBe('true');
    expect(document.body.textContent).not.toContain('都不是');
  });
});

describe('计划清单和网页卡片', () => {
  it('计划写出做完几步；网页卡片点「打开」交出 id', async () => {
    const onOpen = vi.fn();
    await mount(React.createElement('div', null,
      React.createElement(AgentPlanBlock, { plan: { steps: [{ title: '找笔记', status: 'done' }, { title: '做网页', status: 'in_progress' }] }, progress: { stage: 'writing', title: '概念图', chars: 3200 }, lang: 'zh' }),
      React.createElement(ArtifactCards, { artifacts: [{ id: 'a2', groupId: 'g1', title: '光合作用概念图', version: 2, kind: 'html', bytes: 9500 }], onOpen, lang: 'zh' }),
    ));
    expect(document.querySelector('[data-agent-plan]')!.textContent).toContain('1/2');
    expect(document.querySelector('[data-artifact-progress]')!.textContent).toContain('正在做网页《概念图》 · 已写 3.2k 字');
    const card = document.querySelector('[data-agent-artifacts]')!;
    expect(card.textContent).toContain('网页 · 第 2 版 · 9.3 KB');
    await click(Array.from(card.querySelectorAll('button')).find(b => b.textContent === '打开')!);
    expect(onOpen).toHaveBeenCalledWith('a2');
  });
});

describe('网页查看窗口', () => {
  it('iframe 隔离：只给 allow-scripts，网页里带不能联网的安全策略；能切版本；Esc 关', async () => {
    const html = '<!doctype html><html><head><title>x</title></head><body><h1>第二版</h1></body></html>';
    api.get.mockImplementation(async (id: string) => ({
      artifact: { id, groupId: 'g1', version: id === 'a2' ? 2 : 1, title: '光合作用概念图', html: id === 'a2' ? html : html.replace('第二版', '第一版'), sources: [], model: 'glm-5.3', createdAt: '' },
      versions: [{ id: 'a1', version: 1, createdAt: '' }, { id: 'a2', version: 2, createdAt: '' }],
    }));
    const onClose = vi.fn();
    await mount(React.createElement(ArtifactViewer, { artifactId: 'a2', onClose, lang: 'zh' }));
    const frame = document.querySelector('[data-artifact-viewer] iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain('Content-Security-Policy');
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'");
    expect(frame.getAttribute('srcdoc')).toContain('第二版');
    expect(document.body.textContent).toContain('不能联网');

    const select = document.querySelector('[data-artifact-viewer] select') as HTMLSelectElement;
    await act(async () => { select.value = 'a1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(api.get).toHaveBeenLastCalledWith('a1');
    expect((document.querySelector('[data-artifact-viewer] iframe') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('第一版');

    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalled();
  });

  it('取不到（没权限、删了）：写明打不开', async () => {
    api.get.mockRejectedValue(new Error('Artifact not found'));
    await mount(React.createElement(ArtifactViewer, { artifactId: 'a9', onClose: vi.fn(), lang: 'zh' }));
    expect(document.body.textContent).toContain('打不开这个网页：Artifact not found');
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('新窗口打开', () => {
  it('查看窗口顶上有「新窗口打开」：新标签页、不带来源和 opener，地址是后端签好的只读链接', async () => {
    api.get.mockResolvedValue({
      artifact: { id: 'a1', groupId: 'a1', version: 1, title: '概念图', html: '<p>x</p>', sources: [], model: null, createdAt: '', viewPath: '/artifacts/a1/view?exp=1&sig=abc' },
      versions: [{ id: 'a1', version: 1, createdAt: '' }],
    });
    await mount(React.createElement(ArtifactViewer, { artifactId: 'a1', onClose: vi.fn(), lang: 'zh' }));
    const link = Array.from(document.querySelectorAll('[data-artifact-viewer] a')).find(a => a.textContent?.includes('新窗口打开')) as HTMLAnchorElement;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('href')).toMatch(/\/artifacts\/a1\/view\?exp=1&sig=abc$/);
    expect(link.getAttribute('href')).not.toContain('token=');
  });
});
