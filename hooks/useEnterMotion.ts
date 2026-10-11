import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate } from 'animejs';
import { motionAllowed } from './useLayoutMotion';

/**
 * 出现时的入场（anime.js，2026-10-10 用户：给前端加舒适的动效）：一组元素依次淡入、上移几像素。
 *
 * play 每变成一个新的非空值就播一次（切换面板、打开下拉、内容加载完）；null / false / undefined 不播。
 * 默认动 root 里标了 data-enter-item 的元素，也可以用 targets 自己选。
 * 口径和其他动效一致：280ms、out(4)、每项晚 30ms，错开到第 8 项为止；只动屏幕里看得见的前 24 项。
 * 系统「减少动态效果」、页面在后台时不播。播放期间关掉元素自己的 CSS transition（否则逐帧的位移会被再缓一遍），
 * 播完把临时样式全部清掉，不留 transform，免得盖住悬停效果。
 */

export interface EnterMotionOptions {
  /** 动哪些元素；默认 root 里的 [data-enter-item] */
  targets?: (root: HTMLElement) => Element[];
  /** 每一项比前一项晚多少毫秒 */
  step?: number;
  /** 错开到第几项为止，后面的项一起出现 */
  maxStagger?: number;
  /** 从下面多少像素升上来 */
  distance?: number;
  duration?: number;
  /** 最多动几项 */
  limit?: number;
}

function inViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/** 播一次入场，返回停止函数：停下时元素回到自身样式 */
export function playEnter(targets: Element[], options: EnterMotionOptions = {}): () => void {
  const { step = 30, maxStagger = 8, distance = 6, duration = 280, limit = 24 } = options;
  if (!motionAllowed()) return () => {};
  const items = targets
    .filter((el): el is HTMLElement => el instanceof HTMLElement && inViewport(el))
    .slice(0, limit);
  if (items.length === 0) return () => {};

  const transitions = items.map(el => el.style.transition);
  items.forEach(el => { el.style.transition = 'none'; });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    animation.revert();
    items.forEach((el, i) => { el.style.transition = transitions[i]; });
  };
  const animation = animate(items, {
    opacity: [0, 1],
    translateY: [distance, 0],
    duration,
    ease: 'out(4)',
    delay: (_el: unknown, i: number) => Math.min(i, maxStagger) * step,
    onComplete: () => stop(),
  });
  return stop;
}

export function useEnterMotion(root: RefObject<HTMLElement | null>, play: unknown, options: EnterMotionOptions = {}) {
  const settings = useRef(options);
  settings.current = options;

  useLayoutEffect(() => {
    if (play === null || play === undefined || play === false) return;
    const node = root.current;
    if (!node) return;
    const { targets } = settings.current;
    return playEnter(targets ? targets(node) : Array.from(node.querySelectorAll('[data-enter-item]')), settings.current);
  }, [play, root]);
}
