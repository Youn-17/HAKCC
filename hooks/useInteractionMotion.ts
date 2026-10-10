import { useLayoutEffect, useMemo, useRef } from 'react';
import { animate, stagger, type JSAnimation } from 'animejs';
import '../styles/interactionMotion.css';

type Target = HTMLElement | SVGElement;
interface Running { animation?: JSAnimation; release(): void; }
/** Short event feedback. Never changes canvas transforms or editable HTML. */
export function createInteractionMotion(allowed: () => boolean) {
  const running = new Map<string, Running>();
  const stop = (key?: string) => {
    for (const id of key ? [key] : [...running.keys()]) {
      const item = running.get(id);
      running.delete(id);
      item?.animation?.revert();
      item?.release();
    }
  };
  const play = (key: string, targets: Target[], parameters: Record<string, unknown>, release = () => {}) => {
    stop(key);
    if (!allowed() || !targets.length) { release(); return; }
    const item: Running = { release };
    running.set(key, item);
    item.animation = animate(targets, {
      ...parameters,
      onComplete: () => { if (running.get(key) === item) stop(key); },
    });
  };
  const enter = (targets: Target[], key = 'enter') => play(key, targets.slice(0, 12), {
    opacity: [.6, 1], duration: 260, delay: stagger(24), ease: 'out(4)',
  });
  const draw = (paths: SVGPathElement[], key = 'draw') => {
    stop(key);
    if (!allowed()) return;
    const originals: Array<{ path: SVGPathElement; value: string; priority: string }> = [];
    for (const path of paths.slice(0, 16)) {
      const length = path.getTotalLength?.();
      if (!length) continue;
      originals.push({ path, value: path.style.getPropertyValue('stroke-dasharray'), priority: path.style.getPropertyPriority('stroke-dasharray') });
      path.style.strokeDasharray = String(length);
    }
    play(key, originals.map(p => p.path), {
      strokeDashoffset: (el: SVGPathElement) => [el.getTotalLength(), 0],
      duration: 420, delay: stagger(35), ease: 'out(3)',
    }, () => {
      for (const { path, value, priority } of originals) {
        if (value) path.style.setProperty('stroke-dasharray', value, priority);
        else path.style.removeProperty('stroke-dasharray');
      }
    });
  };
  const highlight = (target: Element, key = 'highlight') => {
    stop(key);
    if (!allowed() || !target.isConnected) return;
    const r = target.getBoundingClientRect();
    const left = Math.max(0, r.left), top = Math.max(0, r.top);
    const right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    if (right <= left || bottom <= top) return;
    // External overlay avoids serializing transient styles into saved Note content.
    const ring = document.createElement('div');
    ring.dataset.interactionHighlight = key;
    ring.className = 'interaction-highlight';
    ring.setAttribute('aria-hidden', 'true');
    Object.assign(ring.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    document.body.append(ring);
    play(key, [ring], { opacity: [0, .8, 0], duration: 850, ease: 'inOutSine' }, () => ring.remove());
  };
  const interrupt = () => stop();
  document.addEventListener('scroll', interrupt, true);
  document.addEventListener('input', interrupt, true);
  document.addEventListener('pointerdown', interrupt, true);
  document.addEventListener('wheel', interrupt, { capture: true, passive: true });
  document.addEventListener('keydown', interrupt, true);
  window.addEventListener('resize', interrupt);
  return { enter, draw, highlight, stop, dispose: () => {
    stop();
    document.removeEventListener('scroll', interrupt, true);
    document.removeEventListener('input', interrupt, true);
    document.removeEventListener('pointerdown', interrupt, true);
    document.removeEventListener('wheel', interrupt, true);
    document.removeEventListener('keydown', interrupt, true);
    window.removeEventListener('resize', interrupt);
  } };
}
type Controller = ReturnType<typeof createInteractionMotion>;
export function useInteractionMotion(active = true) {
  const current = useRef<Controller | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const controller = createInteractionMotion(() => !preference?.matches && !document.hidden);
    current.current = controller;
    const changed = () => controller.stop();
    preference?.addEventListener?.('change', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      preference?.removeEventListener?.('change', changed);
      document.removeEventListener('visibilitychange', changed);
      controller.dispose();
      current.current = null;
    };
  }, [active]);
  return useMemo(() => ({
    enter: (targets: Target[], key?: string) => current.current?.enter(targets, key),
    draw: (paths: SVGPathElement[], key?: string) => current.current?.draw(paths, key),
    highlight: (target: Element, key?: string) => current.current?.highlight(target, key),
    stop: (key?: string) => current.current?.stop(key),
  }), []);
}
