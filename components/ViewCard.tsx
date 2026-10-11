/**
 * 画布上通往某个 View 的卡片。
 *
 * 它必须和笔记卡一眼分得开，而且要在自动缩放的 0.3~1.0 全程都分得开 ——
 * 之前那圈虚线边框缩到 0.5 以下就消失了。所以用四层区分同时上：
 * 莫兰迪淡底（缩到最小仍能辨色）、更大的圆角、背后错开的叠层轮廓（像一叠纸，
 * 暗示"里面还有东西"）、以及没有头像和时间的结构差异。
 *
 * 小组的视图有 logo 时（2026-10-11，迁移 089），logo 放在左边，名称在右边。
 */
import React, { useState } from 'react';
import RemixIcon from './RemixIcon';
import { Language } from '../types';
import { viewColor } from './viewPalette';
import { ink, shade, withAlpha } from './morandiPalette';

export const VIEW_CARD_WIDTH = 200;
export const VIEW_CARD_HEIGHT = 132;

interface Props {
  viewId: string;
  title: string;
  noteCount: number;
  /** 小组视图的 logo；打不开时当作没有 */
  logoUrl?: string | null;
  x: number;
  y: number;
  lang: Language;
  isDragging?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const ViewCard: React.FC<Props> = ({
  viewId, title, noteCount, logoUrl, x, y, lang, isDragging, onMouseDown, onContextMenu,
}) => {
  const color = viewColor(viewId);
  const textInk = ink(color);
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null);
  const logo = logoUrl && brokenLogo !== logoUrl ? logoUrl : null;
  const heading = (
    <>
      <div className="text-[11px] tracking-[0.14em]" style={{ color: withAlpha(textInk, 0.75) }}>
        {lang === 'zh' ? '视图' : 'VIEW'}
      </div>
      <div
        className="mt-1.5 overflow-hidden text-[15px] font-semibold leading-snug"
        style={{ color: textInk, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}
      >
        {title}
      </div>
    </>
  );

  return (
    <div
      className="absolute z-20 select-none"
      style={{ transform: `translate(${x}px, ${y}px)`, width: VIEW_CARD_WIDTH }}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      title={lang === 'zh' ? `进入「${title}」` : `Open "${title}"`}
    >
      <div className="relative">
        <div
          className="absolute rounded-2xl"
          style={{ inset: '9px -9px -9px 9px', backgroundColor: shade(color, 0.82) }}
        />
        <div
          className="absolute rounded-2xl"
          style={{ inset: '4px -4px -4px 4px', backgroundColor: shade(color, 0.7) }}
        />
        <div
          className={`relative cursor-pointer overflow-hidden rounded-2xl border transition-shadow duration-200 motion-reduce:transition-none ${
            isDragging ? 'shadow-lg' : 'shadow-sm hover:shadow-md'
          }`}
          style={{
            height: VIEW_CARD_HEIGHT,
            backgroundColor: shade(color, 0.9),
            borderColor: shade(color, 0.5),
          }}
        >
          <div style={{ height: 4, backgroundColor: color }} />
          <div className="flex h-[calc(100%-4px)] flex-col px-3.5 pb-3 pt-2.5">
            {logo ? (
              <div className="flex items-start gap-2.5">
                <img
                  src={logo}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                  onError={() => setBrokenLogo(logo)}
                  className="pointer-events-none h-[56px] w-[56px] shrink-0 rounded-xl bg-white object-contain p-1"
                  style={{ boxShadow: `0 0 0 1px ${shade(color, 0.55)}` }}
                />
                <div className="min-w-0 flex-1">{heading}</div>
              </div>
            ) : heading}
            <div
              className="mt-auto flex items-center text-[11px]"
              style={{ color: withAlpha(textInk, 0.7) }}
            >
              <span>{noteCount} {lang === 'zh' ? '条笔记' : noteCount === 1 ? 'note' : 'notes'}</span>
              <RemixIcon name="arrow-right-line" size={14} className="ml-auto" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ViewCard);
