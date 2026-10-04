import { useEffect, type RefObject } from 'react';

/**
 * 浮层的统一关闭规则：菜单、弹层、悬停提示。
 *
 * 各处自己写会漏掉同一类情况，实际都漏过：
 *   · 侧栏悬停提示——点一下按钮弹出模态框后，指针没动，浏览器就不派发
 *     mouseleave，提示卡在那儿，模态框关了它还在；
 *   · 编辑器里的「…」和取色弹层、顶栏的视图/通知菜单——点别处不关。
 *
 * 所以把规则收成一处：点到外面、按 Esc、切走窗口都关掉；
 * 按坐标定位的浮层（悬停提示）再加上滚动也关，因为位置是悬停那一刻
 * 算出来的，页面一动它就悬在错的地方。
 */
export function useDismissible(options: {
  open: boolean;
  onDismiss: () => void;
  /**
   * 浮层容器。给了就只在点到它外面时关；
   * 不给表示任何一次按下都关（悬停提示这类本来就不该被点）。
   */
  ref?: RefObject<HTMLElement | null>;
  /** 位置随页面滚动而失效的浮层设为 true。菜单一般不需要。 */
  dismissOnScroll?: boolean;
}): void {
  const { open, onDismiss, ref, dismissOnScroll = false } = options;

  useEffect(() => {
    if (!open) return;

    const dismiss = () => onDismiss();
    const onPointerDown = (event: Event) => {
      if (!ref) { dismiss(); return; }
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };

    // 捕获阶段：浮层内部的 stopPropagation 不该让关闭逻辑失灵
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', dismiss);
    document.addEventListener('visibilitychange', dismiss);
    if (dismissOnScroll) window.addEventListener('scroll', dismiss, true);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', dismiss);
      document.removeEventListener('visibilitychange', dismiss);
      if (dismissOnScroll) window.removeEventListener('scroll', dismiss, true);
    };
  }, [open, onDismiss, ref, dismissOnScroll]);
}
