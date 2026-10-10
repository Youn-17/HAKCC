import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { animate, stagger, type JSAnimation } from 'animejs';

interface Options {
  open: boolean;
  /** History restoration is static, including sources and recorded tool steps. */
  ready?: boolean;
  floating?: boolean;
}

const TARGET = '[data-ai-motion]';
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Animation owns only marked UI elements, never markdown, scroll position or canvas coordinates. */
export function useAiSurfaceMotion<T extends HTMLElement = HTMLDivElement>({ open, ready = true, floating = false }: Options) {
  // Responsive layouts can replace the DOM node without changing open/ready.
  const [surface, setSurface] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => { setSurface(node); }, []);
  const hasOpened = useRef(false);

  useLayoutEffect(() => {
    if (!surface) return;
    if (!floating) surface.style.removeProperty('transform');
    const preference = window.matchMedia?.(MOTION_QUERY);
    let entry: JSAnimation | undefined;
    const settle = () => {
      entry?.revert();
      entry = undefined;
      if (floating) surface.style.transform = open ? '' : 'translateX(100%)';
    };
    if (!preference?.matches && !document.hidden) {
      if (floating && (open || hasOpened.current)) {
        hasOpened.current ||= open;
        entry = animate(surface, {
          translateX: open ? ['100%', '0%'] : ['0%', '100%'],
          duration: open ? 280 : 200, ease: 'out(4)', onComplete: settle,
        });
      } else if (open) {
        const chrome = surface.querySelectorAll<HTMLElement>('[data-ai-motion-chrome]');
        if (chrome.length) entry = animate(chrome, {
          opacity: [0.65, 1], translateY: [5, 0], duration: 240,
          delay: stagger(35), ease: 'out(4)', onComplete: settle,
        });
      } else settle();
    } else settle();
    const changed = () => { if (preference?.matches || document.hidden) settle(); };
    preference?.addEventListener?.('change', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      entry?.revert();
      preference?.removeEventListener?.('change', changed);
      document.removeEventListener('visibilitychange', changed);
    };
  }, [surface, open, floating]);

  useLayoutEffect(() => {
    if (!surface || !open) return;
    const preference = window.matchMedia?.(MOTION_QUERY);
    const seen = new WeakSet<HTMLElement>();
    // Position keys prevent re-entry when a temporary streamed message gets its persisted ID.
    const messages = new Set<string>();
    const states = new WeakMap<HTMLElement, string | null>();
    const running = new Map<HTMLElement, { animation: JSAnimation; loop: boolean }>();
    const allowed = () => !preference?.matches && !document.hidden;
    const stop = (element: HTMLElement) => {
      running.get(element)?.animation.revert();
      running.delete(element);
    };
    const play = (element: HTMLElement, loop = false, index = 0) => {
      stop(element);
      if (!allowed()) return;
      const kind = element.dataset.aiMotion;
      let animation: JSAnimation;
      const complete = () => {
        if (running.get(element)?.animation === animation) stop(element);
      };
      animation = kind === 'dots'
        ? animate(element.querySelectorAll('.ai-dot'), {
          translateY: [0, -3, 0], opacity: [0.4, 1, 0.4], duration: 1100,
          delay: stagger(140), ease: 'inOutSine', loop: true,
        })
        : loop
          ? animate(element, { opacity: [0.5, 1], duration: 850, alternate: true, loop: true, ease: 'inOutSine' })
          : animate(element, {
            opacity: [0.6, 1], translateY: [kind === 'message' ? 7 : 4, 0],
            duration: kind === 'message' ? 240 : 200,
            delay: Math.min(index, 4) * 30, ease: 'out(4)', onComplete: complete,
          });
      running.set(element, { animation, loop });
    };
    const scan = (enter: boolean) => {
      for (const element of running.keys()) if (!surface.contains(element)) stop(element);
      const elements = Array.from(surface.querySelectorAll<HTMLElement>(TARGET));
      const present = new Set(elements.filter(el => el.dataset.aiMotion === 'message').map(el => el.dataset.aiMotionKey!));
      for (const key of messages) if (!present.has(key)) messages.delete(key);
      let index = 0;
      for (const element of elements) {
        const kind = element.dataset.aiMotion;
        const state = element.getAttribute('data-ai-motion-state');
        const fresh = !seen.has(element);
        const changed = states.has(element) && states.get(element) !== state;
        seen.add(element);
        states.set(element, state);
        const key = element.dataset.aiMotionKey;
        const duplicate = kind === 'message' && key != null && messages.has(key);
        if (kind === 'message' && key != null) messages.add(key);
        if (kind === 'dots' || kind === 'indicator') {
          const busy = kind === 'dots' || state === 'running';
          if (!busy || !allowed()) stop(element);
          else if (!running.has(element)) play(element, true);
          if (kind === 'indicator' && changed && !busy && enter) play(element);
        } else if (enter && !duplicate && (fresh || changed)) play(element, false, index++);
      }
    };
    scan(false);
    const observer = new MutationObserver(records => {
      // Text tokens do not create motion targets or restart the animation of their parent.
      if (records.some(record => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node =>
        node instanceof HTMLElement && (node.matches(TARGET) || node.querySelector(TARGET))))) scan(ready);
    });
    observer.observe(surface, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ai-motion-state'] });
    const changed = () => {
      if (!allowed()) for (const element of running.keys()) stop(element);
      else scan(false);
    };
    preference?.addEventListener?.('change', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      observer.disconnect();
      preference?.removeEventListener?.('change', changed);
      document.removeEventListener('visibilitychange', changed);
      for (const element of running.keys()) stop(element);
    };
  }, [surface, open, ready]);

  return ref;
}
