import { useLayoutEffect, type RefObject } from 'react';

/** Size the composer from its text, bounded by the responsive CSS limits. */
export function useGrowingTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string, visible: boolean) {
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input || !visible) return;
    const resize = () => {
      input.style.height = 'auto';
      const style = getComputedStyle(input);
      const minimum = parseFloat(style.minHeight) || 128;
      const maximum = parseFloat(style.maxHeight) || 260;
      input.style.height = `${Math.min(maximum, Math.max(minimum, input.scrollHeight))}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [ref, value, visible]);
}
