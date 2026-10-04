import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export type Platform = 'mobile' | 'tablet' | 'desktop';

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

function getPlatform(w: number): Platform {
  if (w < MOBILE_BREAKPOINT) return 'mobile';
  if (w < TABLET_BREAKPOINT) return 'tablet';
  return 'desktop';
}

export function usePlatform() {
  const isNative = Capacitor.isNativePlatform();
  const nativePlatform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

  const [platform, setPlatform] = useState<Platform>(() => getPlatform(window.innerWidth));
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setViewportWidth(w);
      setPlatform(getPlatform(w));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isMobile = platform === 'mobile';
  const isTablet = platform === 'tablet';
  const isMobileLayout = isMobile || (isTablet && isNative);

  return { platform, isMobile, isTablet, isMobileLayout, isNative, nativePlatform, viewportWidth };
}
