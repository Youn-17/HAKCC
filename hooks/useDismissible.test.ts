// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * useDismissible 现在管着四处浮层：侧栏悬停提示、顶栏视图/通知菜单、
 * 编辑器的「…」与取色板。它坏了会同时坏四个地方，而且不会报错，
 * 只表现为「点了别处东西还在」。
 *
 * 这里不渲染组件，直接验证它挂上去的那套监听的行为契约。
 */
function attach(opts: {
  onDismiss: () => void;
  container?: HTMLElement | null;
  dismissOnScroll?: boolean;
}) {
  const { onDismiss, container = null, dismissOnScroll = false } = opts;
  const dismiss = () => onDismiss();
  const onPointerDown = (event: Event) => {
    if (!container) { dismiss(); return; }
    const target = event.target;
    if (target instanceof Node && container.contains(target)) return;
    dismiss();
  };
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', dismiss);
  if (dismissOnScroll) window.addEventListener('scroll', dismiss, true);
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('blur', dismiss);
    if (dismissOnScroll) window.removeEventListener('scroll', dismiss, true);
  };
}

let cleanup: (() => void) | null = null;
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { cleanup?.(); cleanup = null; });

describe('浮层关闭规则', () => {
  it('点到浮层外面就关', () => {
    const menu = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(menu, outside);
    const onDismiss = vi.fn();
    cleanup = attach({ onDismiss, container: menu });

    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('点在浮层里面不关，否则菜单项根本点不动', () => {
    const menu = document.createElement('div');
    const item = document.createElement('button');
    menu.appendChild(item);
    document.body.appendChild(menu);
    const onDismiss = vi.fn();
    cleanup = attach({ onDismiss, container: menu });

    item.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  // 悬停提示本来就不该被点，任何一次按下都收掉
  it('没给容器时任何按下都关', () => {
    const onDismiss = vi.fn();
    cleanup = attach({ onDismiss });
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('按 Esc 关，按别的键不关', () => {
    const onDismiss = vi.fn();
    cleanup = attach({ onDismiss, container: document.createElement('div') });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(onDismiss).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  // 切走窗口回来还挂着一个提示，是最典型的「卡住」观感
  it('窗口失焦时关', () => {
    const onDismiss = vi.fn();
    cleanup = attach({ onDismiss, container: document.createElement('div') });
    window.dispatchEvent(new Event('blur'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  // 悬停提示按坐标定位，页面一滚就悬在错的位置
  it('开了 dismissOnScroll 才在滚动时关', () => {
    const withScroll = vi.fn();
    const cleanupA = attach({ onDismiss: withScroll, dismissOnScroll: true, container: document.createElement('div') });
    window.dispatchEvent(new Event('scroll'));
    expect(withScroll).toHaveBeenCalledOnce();
    cleanupA();

    const noScroll = vi.fn();
    cleanup = attach({ onDismiss: noScroll, dismissOnScroll: false, container: document.createElement('div') });
    window.dispatchEvent(new Event('scroll'));
    expect(noScroll).not.toHaveBeenCalled();
  });
});
