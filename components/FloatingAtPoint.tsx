import React, { useLayoutEffect, useRef, useState } from 'react';

export interface Placement {
  left: number;
  top: number;
  /** 翻到了点击处的左边 / 上边：缩放动画要从那个角长出来 */
  flipX: boolean;
  flipY: boolean;
}

/**
 * 点击处 (x, y) 弹出一个 width × height 的浮层，该放在哪。
 * 默认在右下方；右边放不下翻到左边，下面放不下翻到上方；翻过去还放不下（浮层比那一侧的空间大），
 * 就贴着屏幕边，保证整个浮层都在屏幕里。
 */
export function placeAtPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: { width: number; height: number },
  margin = 8,
): Placement {
  const flipX = x + width > viewport.width - margin && x - width >= margin;
  const flipY = y + height > viewport.height - margin && y - height >= margin;
  const rawLeft = flipX ? x - width : x;
  const rawTop = flipY ? y - height : y;
  const left = Math.max(margin, Math.min(rawLeft, viewport.width - margin - width));
  const top = Math.max(margin, Math.min(rawTop, viewport.height - margin - height));
  return { left, top, flipX, flipY };
}

interface FloatingAtPointProps extends React.HTMLAttributes<HTMLDivElement> {
  x: number;
  y: number;
  margin?: number;
}

/**
 * 贴着鼠标弹出的浮层（画布的右键菜单）。笔记靠近屏幕下边时，菜单原先直接从鼠标处往下长，
 * 下半截出了屏幕，「编辑」以下的选项点不到。
 * 在浏览器绘制之前量好、摆好（useLayoutEffect），不会先出现在错的位置再跳过去。
 * 量尺寸用 offsetWidth/offsetHeight：进场动画一开始是 scale(0.95)，getBoundingClientRect 会量小。
 */
const FloatingAtPoint: React.FC<FloatingAtPointProps> = ({ x, y, margin = 8, style, children, ...rest }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlacement(placeAtPoint(
      x, y, el.offsetWidth, el.offsetHeight,
      { width: window.innerWidth, height: window.innerHeight },
      margin,
    ));
  }, [x, y, margin]);

  return (
    <div
      ref={ref}
      {...rest}
      style={{
        ...style,
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        transformOrigin: placement
          ? `${placement.flipX ? 'right' : 'left'} ${placement.flipY ? 'bottom' : 'top'}`
          : undefined,
      }}
    >
      {children}
    </div>
  );
};

export default FloatingAtPoint;
