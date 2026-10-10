import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate, stagger, type JSAnimation } from 'animejs';

interface State {
  tool: string;
  busy: boolean;
  content: unknown;
  selection: string;
  settings: boolean;
}
interface Motion {
  enter: (key: string, selector: string) => void;
  loading: (busy: boolean) => void;
  stop: (key: string) => void;
}

/** Move UI groups only; SVG positions, chart values and reading scroll stay untouched. */
export function useAnalyticsMotion(root: RefObject<HTMLElement | null>, state: State) {
  const motion = useRef<Motion | null>(null);

  useLayoutEffect(() => {
    const surface = root.current;
    if (!surface) return;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const running = new Map<string, JSAnimation>();
    let loading = false;
    const allowed = () => !preference?.matches && !document.hidden;
    const stop = (key: string) => {
      running.get(key)?.revert();
      running.delete(key);
    };
    const stopAll = () => { for (const key of running.keys()) stop(key); };
    const play = (key: string, selector: string, loop = false) => {
      stop(key);
      if (!allowed()) return;
      // Cap staggered groups so long source lists are readable immediately.
      const targets = Array.from(surface.querySelectorAll<HTMLElement>(selector)).slice(0, 6);
      if (!targets.length) return;
      const animation = animate(targets, loop ? {
        opacity: [0.3, 1, 0.3], translateY: [0, -3, 0],
        duration: 1000, delay: stagger(130), ease: 'inOutSine', loop: true,
      } : {
        opacity: [0.45, 1], translateY: [key === 'sources' ? 7 : 5, 0],
        duration: 280, delay: stagger(30), ease: 'out(4)',
        onComplete: () => { if (running.get(key) === animation) stop(key); },
      });
      running.set(key, animation);
    };
    const controller: Motion = {
      enter: (key, selector) => play(key, selector),
      loading: busy => { loading = busy; if (busy) play('loading', '.da-loading-dot', true); else stop('loading'); },
      stop,
    };
    motion.current = controller;
    play('chrome', '[data-analysis-motion="chrome"]');
    const changed = () => {
      stopAll();
      // Returning to the page resumes only an actual pending request.
      if (allowed() && loading) play('loading', '.da-loading-dot', true);
    };
    preference?.addEventListener?.('change', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      preference?.removeEventListener?.('change', changed);
      document.removeEventListener('visibilitychange', changed);
      stopAll();
      motion.current = null;
    };
  }, [root]);

  useLayoutEffect(() => {
    motion.current?.enter('tool', '.da-tools button[aria-current]');
    return () => motion.current?.stop('tool');
  }, [state.tool]);

  useLayoutEffect(() => {
    motion.current?.loading(state.busy);
    if (!state.busy && state.content != null) motion.current?.enter('result', '[data-analysis-motion="result"]');
    return () => { motion.current?.stop('loading'); motion.current?.stop('result'); };
  }, [state.tool, state.busy, state.content]);

  useLayoutEffect(() => {
    if (state.selection) motion.current?.enter('sources', '.da-source-note');
    return () => motion.current?.stop('sources');
  }, [state.selection]);

  useLayoutEffect(() => {
    if (state.settings) motion.current?.enter('settings', '[data-analysis-motion="settings"]');
    return () => motion.current?.stop('settings');
  }, [state.settings]);
}
