import type { MutableRefObject } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

gsap.defaults({ ease: 'power3.out' });

export { gsap, useGSAP };

export const motionEase = {
  entrance: 'power3.out',
  soft: 'sine.out',
  precise: 'power2.out',
  exit: 'power2.inOut',
};

export function shouldReduceMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function entranceTimeline(scope?: Element | MutableRefObject<Element | null>) {
  return gsap.timeline({
    defaults: {
      duration: shouldReduceMotion() ? 0 : 0.46,
      ease: motionEase.entrance,
      clearProps: 'transform,opacity,visibility,willChange',
    },
    ...(scope ? { smoothChildTiming: true } : {}),
  });
}

export function prepareForMotion(targets: gsap.TweenTarget) {
  if (shouldReduceMotion()) return;
  gsap.set(targets, { willChange: 'transform, opacity' });
}
