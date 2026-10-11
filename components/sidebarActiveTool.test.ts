// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Sidebar from './Sidebar';

/**
 * 侧栏工具按钮的高亮（2026-10-10 用户：点了工具会亮，点别处就该消失）。
 * 亮着时按下任何别的地方都收掉；按的是亮着的那个按钮本身不收，交给它自己的点击处理。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('Sidebar 工具高亮', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onDismissActiveTool = vi.fn();
  const onToolOpen = vi.fn();

  beforeEach(() => {
    onDismissActiveTool.mockReset();
    onToolOpen.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const mount = async (activeTool: string) => {
    await act(async () => {
      root.render(React.createElement(Sidebar, {
        activeTool, onToolSelect: vi.fn(), onToolOpen, onDismissActiveTool, onOpenAttachmentModal: vi.fn(),
        isStaff: true, lang: 'zh', width: 220, onWidthChange: vi.fn(),
      }));
    });
  };
  const press = async (target: EventTarget) => {
    await act(async () => { target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
  };
  const button = (label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

  it('亮着时点到别处（画布、其他按钮）就收掉', async () => {
    await mount('inquiry');
    await press(document.body);
    expect(onDismissActiveTool).toHaveBeenCalledTimes(1);
    await press(button('支架'));
    expect(onDismissActiveTool).toHaveBeenCalledTimes(2);
  });

  it('按的是亮着的那个按钮：不收，点击照常交给工具', async () => {
    await mount('inquiry');
    const inquiry = button('探究');
    await press(inquiry);
    expect(onDismissActiveTool).not.toHaveBeenCalled();
    await act(async () => { inquiry.click(); });
    expect(onToolOpen).toHaveBeenCalledWith('inquiry');
  });

  it('没有亮着的工具：按哪里都不触发', async () => {
    await mount('');
    await press(document.body);
    expect(onDismissActiveTool).not.toHaveBeenCalled();
  });
});
