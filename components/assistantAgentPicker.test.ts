// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AssistantAgentPicker from './AssistantAgentPicker';
import { getPartnerAgentModes } from './noteAiPartnerModel';

let root: Root;
let container: HTMLDivElement;
const change = vi.fn();
const options = [{ id: '' as const, label: '默认 · 自由提问', description: '围绕当前 Note 自由提问。', disabled: false },
  ...getPartnerAgentModes('zh').map(option => ({ ...option, disabled: option.id === 'evidence_broker' }))];
const click = async (selector: string) => act(() => { container.querySelector<HTMLButtonElement>(selector)!.click(); });
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  change.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(() => root.render(React.createElement(AssistantAgentPicker, { lang: 'zh', value: '', options, onChange: change })));
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); });
it('明确显示默认入口，选择前能阅读每个智能体的功能，选择后关闭菜单', async () => {
  expect(container.textContent).toContain('选择智能体');
  expect(container.textContent).toContain('默认 · 自由提问');
  await click('[aria-label="选择智能体"]');
  const choices = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(choices).toHaveLength(6);
  expect(choices.every(button => button.querySelector('.assistant-agent-option-description')?.textContent)).toBe(true);
  expect(choices.find(button => button.textContent?.includes('证据检验'))?.disabled).toBe(true);
  await act(() => choices.find(button => button.textContent?.includes('探究缺口'))!.click());
  expect(change).toHaveBeenCalledWith('gap_finder');
  expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('选择智能体');
});
it('键盘可以进入选项，Escape 回到入口，点击外部和离开区域也会收起', async () => {
  await click('[aria-label="选择智能体"]');
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="选择智能体"]')!;
  await act(() => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  expect(document.activeElement?.getAttribute('role')).toBe('radio');
  await act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).toBe(trigger);
  expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  await click('[aria-label="选择智能体"]');
  await act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  await click('[aria-label="选择智能体"]');
  await act(() => container.querySelector('.assistant-agent-picker')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
  expect(container.querySelector('[role="radiogroup"]')).toBeNull();
});
