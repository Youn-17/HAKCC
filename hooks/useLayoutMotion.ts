import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { createLayout, type AutoLayout } from 'animejs';

/**
 * 列表、网格换布局时的过渡（anime.js Layout，2026-10-10 用户：参考 staggered layout animation）。
 *
 * 用法：改状态之前调 capture()，React 提交新布局后，留下的项从旧位置滑到新位置，新出现的项淡入，
 * 一项接一项错开一点。只动标了 data-layout-item 的 HTML 元素，里面的文字不跟着变（swapAt 保持不透明）。
 *
 * 时长、缓动、错开间隔和其他动效一致（useAiMotion、useAnalyticsMotion：260–300ms、out(4)、约 30ms）。
 * 系统设置「减少动态效果」、页面在后台时 capture() 什么都不做，界面直接换到新状态。
 * React 卸载的节点没有离场动画（它已经不在页面上），其余的项会平滑补位。
 */

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** capture() 之后这么久还没提交新布局，就当这次没变，不再补动画 */
const CAPTURE_TTL_MS = 600;

export interface LayoutMotionOptions {
  /** 每一项比前一项晚多少毫秒 */
  step?: number;
  /** 错开到第几项为止，后面的项一起动：长列表不用等 */
  maxStagger?: number;
  duration?: number;
  /** 新出现的项从哪里来：默认往下 6px、透明 */
  enterFrom?: Record<string, string | number>;
}

export function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.hidden) return false;
  return !window.matchMedia?.(MOTION_QUERY).matches;
}

export function useLayoutMotion<T extends HTMLElement = HTMLElement>(options: LayoutMotionOptions = {}) {
  const { step = 28, maxStagger = 10, duration = 300, enterFrom } = options;
  const rootRef = useRef<T | null>(null);
  const layoutRef = useRef<AutoLayout | null>(null);
  const capturedAt = useRef(0);
  const settings = useRef({ step, maxStagger, duration, enterFrom });
  settings.current = { step, maxStagger, duration, enterFrom };

  const dispose = useCallback(() => {
    layoutRef.current?.revert();
    layoutRef.current = null;
  }, []);

  /** 根节点换了（条件渲染、重新挂载）就重建，旧的那个还原掉 */
  const ref = useCallback((node: T | null) => {
    if (rootRef.current === node) return;
    dispose();
    rootRef.current = node;
  }, [dispose]);

  const capture = useCallback(() => {
    const root = rootRef.current;
    if (!root || !motionAllowed()) return;
    if (layoutRef.current && layoutRef.current.root !== root) dispose();
    const { duration: ms, enterFrom: from } = settings.current;
    if (!layoutRef.current) {
      // 创建时就记下当前布局，等于第一次 record()
      layoutRef.current = createLayout(root, {
        children: '[data-layout-item]',
        duration: ms,
        ease: 'out(4)',
        enterFrom: from ?? { opacity: 0, transform: 'translateY(6px)' },
        leaveTo: { opacity: 0 },
        swapAt: { opacity: 1 },
      });
    } else {
      layoutRef.current.record();
    }
    capturedAt.current = performance.now();
  }, [dispose]);

  // 每次提交后看一眼：刚 capture 过就从记下的旧布局动到现在的布局
  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout || !capturedAt.current) return;
    const fresh = performance.now() - capturedAt.current < CAPTURE_TTL_MS;
    capturedAt.current = 0;
    if (!fresh || !motionAllowed()) return;
    const { step: gap, maxStagger: cap } = settings.current;
    // Layout 给根节点里每个元素都编了号（包括项里面的文字），不能直接拿来错开：
    // 按项在列表里的位置算，项里面的元素跟着所在的项，cap 之后的项一起动
    const root = (layout.root as HTMLElement | null) ?? rootRef.current;
    if (!root) return;
    const order = new Map<Element, number>();
    root.querySelectorAll('[data-layout-item]').forEach((el, i) => order.set(el, i));
    const delayOf = (el: Element) => {
      const item = order.has(el) ? el : el.closest?.('[data-layout-item]');
      return Math.min(item ? order.get(item) ?? 0 : 0, cap) * gap;
    };
    layout.animate({ delay: (el) => delayOf(el as Element) });
  });

  useLayoutEffect(() => dispose, [dispose]);

  // 同一个对象：调用方放进依赖数组也不会每次渲染都变。root 给同一个列表上的入场动效（useEnterMotion）用
  return useMemo(() => ({ ref, capture, root: rootRef }), [ref, capture]);
}
