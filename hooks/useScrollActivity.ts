import { useEffect } from 'react';

/** Reveal native drag handles while any scroll surface is moving. */
export function useScrollActivity() {
  useEffect(() => {
    const pending = new Map<Element, ReturnType<typeof setTimeout>>();
    const reveal = (event: Event) => {
      const surface = event.target === document ? document.scrollingElement : event.target;
      if (!(surface instanceof Element)) return;
      surface.classList.add('is-scrolling');
      clearTimeout(pending.get(surface));
      pending.set(surface, setTimeout(() => {
        surface.classList.remove('is-scrolling'); pending.delete(surface);
      }, 1400));
    };
    document.addEventListener('scroll', reveal, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', reveal, true);
      for (const [surface, timer] of pending) { clearTimeout(timer); surface.classList.remove('is-scrolling'); }
    };
  }, []);
}
