import React, {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { gsap } from 'gsap';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  customClass?: string;
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ customClass, className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      {...rest}
      className={[
        'absolute left-1/2 top-1/2 overflow-hidden rounded-xl border border-white bg-black shadow-[0_28px_80px_-38px_rgba(0,0,0,0.85)]',
        '[backface-visibility:hidden] [-webkit-backface-visibility:hidden] [transform-style:preserve-3d] will-change-transform',
        customClass,
        className,
      ].filter(Boolean).join(' ')}
    />
  );
});

type Slot = {
  x: number;
  y: number;
  z: number;
  zIndex: number;
};

const makeSlot = (index: number, distX: number, distY: number, total: number): Slot => ({
  x: index * distX,
  y: -index * distY,
  z: -index * distX * 1.5,
  zIndex: total - index,
});

const placeNow = (el: HTMLDivElement | null, slot: Slot, skew: number) => {
  if (!el) return;
  gsap.set(el, {
    x: slot.x,
    y: slot.y,
    z: slot.z,
    xPercent: -50,
    yPercent: -50,
    skewY: skew,
    transformOrigin: 'center center',
    zIndex: slot.zIndex,
    force3D: true,
  });
};

type CardSwapProps = {
  width?: number | string;
  height?: number | string;
  cardDistance?: number;
  verticalDistance?: number;
  delay?: number;
  pauseOnHover?: boolean;
  onCardClick?: (index: number) => void;
  skewAmount?: number;
  easing?: 'elastic' | 'linear';
  className?: string;
  children: ReactNode;
};

export default function CardSwap({
  width = 500,
  height = 400,
  cardDistance = 60,
  verticalDistance = 70,
  delay = 5000,
  pauseOnHover = false,
  onCardClick,
  skewAmount = 6,
  easing = 'elastic',
  className = '',
  children,
}: CardSwapProps) {
  const childArr = useMemo(() => Children.toArray(children), [children]);
  const refs = useMemo(
    () => childArr.map(() => React.createRef<HTMLDivElement>()),
    [childArr.length],
  );
  const order = useRef(Array.from({ length: childArr.length }, (_, i) => i));
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const intervalRef = useRef<number | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const total = refs.length;
    if (total === 0) return undefined;

    refs.forEach((ref, index) => placeNow(ref.current, makeSlot(index, cardDistance, verticalDistance, total), skewAmount));
    if (total < 2) return undefined;

    const config = easing === 'elastic'
      ? { ease: 'elastic.out(0.6,0.9)', drop: 2, move: 2, back: 2, overlap: 0.9, returnDelay: 0.05 }
      : { ease: 'power1.inOut', drop: 0.8, move: 0.8, back: 0.8, overlap: 0.45, returnDelay: 0.2 };

    const swap = () => {
      const [front, ...rest] = order.current;
      if (front === undefined || rest.length === 0) return;
      const frontEl = refs[front].current;
      if (!frontEl) return;

      const tl = gsap.timeline();
      timelineRef.current = tl;
      tl.to(frontEl, {
        y: '+=500',
        duration: config.drop,
        ease: config.ease,
      });

      tl.addLabel('promote', `-=${config.drop * config.overlap}`);
      rest.forEach((idx, index) => {
        const el = refs[idx].current;
        const slot = makeSlot(index, cardDistance, verticalDistance, total);
        if (!el) return;
        tl.set(el, { zIndex: slot.zIndex }, 'promote');
        tl.to(el, {
          x: slot.x,
          y: slot.y,
          z: slot.z,
          duration: config.move,
          ease: config.ease,
        }, `promote+=${index * 0.1}`);
      });

      const backSlot = makeSlot(total - 1, cardDistance, verticalDistance, total);
      tl.addLabel('return', `promote+=${config.move * config.returnDelay}`);
      tl.call(() => {
        gsap.set(frontEl, { zIndex: backSlot.zIndex });
      }, undefined, 'return');
      tl.to(frontEl, {
        x: backSlot.x,
        y: backSlot.y,
        z: backSlot.z,
        duration: config.back,
        ease: config.ease,
      }, 'return');
      tl.call(() => {
        order.current = [...rest, front];
      });
    };

    swap();
    intervalRef.current = window.setInterval(swap, delay);

    const node = container.current;
    const pause = () => {
      timelineRef.current?.pause();
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
    const resume = () => {
      timelineRef.current?.play();
      if (!intervalRef.current) intervalRef.current = window.setInterval(swap, delay);
    };

    if (pauseOnHover && node) {
      node.addEventListener('mouseenter', pause);
      node.addEventListener('mouseleave', resume);
    }

    return () => {
      timelineRef.current?.kill();
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      if (pauseOnHover && node) {
        node.removeEventListener('mouseenter', pause);
        node.removeEventListener('mouseleave', resume);
      }
    };
  }, [cardDistance, delay, easing, pauseOnHover, refs, skewAmount, verticalDistance]);

  const rendered = childArr.map((child, index) => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<{ style?: CSSProperties; onClick?: React.MouseEventHandler<HTMLDivElement> }>;
    return cloneElement(element, {
      key: index,
      ref: refs[index],
      style: { width, height, ...element.props.style },
      onClick: (event: React.MouseEvent<HTMLDivElement>) => {
        element.props.onClick?.(event);
        onCardClick?.(index);
      },
    } as Partial<{ ref: React.Ref<HTMLDivElement>; style: CSSProperties; onClick: React.MouseEventHandler<HTMLDivElement> }>);
  });

  return (
    <div
      ref={container}
      className={[
        'absolute bottom-0 right-0 origin-bottom-right translate-x-[5%] translate-y-[20%] overflow-visible [perspective:900px]',
        className,
      ].filter(Boolean).join(' ')}
      style={{ width, height }}
    >
      {rendered}
    </div>
  );
}
