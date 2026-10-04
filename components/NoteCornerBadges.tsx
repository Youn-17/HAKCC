import React from 'react';
import type { Language } from '../types';
import { SIGNAL_RED, shade } from './morandiPalette';
import RemixIcon from './RemixIcon';

/**
 * 卡片左上角的两个标记：New（我还没打开过）和火（被 Build-on 最多）。
 * 骑在卡片上沿、半截露在外面，像贴上去的标签 —— 放进卡片里会和标题抢位置，
 * 而且标题行数是按卡片高度算好的。白色描边把它和卡片、画布网格隔开。
 */
const NoteCornerBadges: React.FC<{ isNew?: boolean; hotCount?: number; lang: Language; className?: string }> = ({ isNew, hotCount = 0, lang, className = '-top-2.5 left-3' }) => {
  if (!isNew && hotCount <= 0) return null;
  const zh = lang === 'zh';
  return (
    <div className={`absolute z-30 flex items-center gap-1 ${className}`}>
      {isNew && (
        <span
          className="inline-flex h-5 items-center rounded-full px-2 text-[0.625rem] font-extrabold tracking-wide text-white ring-2 ring-white shadow-[0_2px_6px_rgba(217,66,58,0.35)] animate-in fade-in zoom-in-75 duration-300 motion-reduce:animate-none"
          style={{ backgroundColor: SIGNAL_RED }}
          title={zh ? '你还没打开过这条笔记' : 'New: you have not opened this note yet'}
        >
          New
        </span>
      )}
      {hotCount > 0 && (
        <span
          className="inline-flex h-5 items-center gap-0.5 rounded-full pl-1 pr-1.5 text-[0.6875rem] font-extrabold tabular-nums ring-2 ring-white shadow-[0_2px_6px_rgba(217,66,58,0.3)] animate-in fade-in zoom-in-75 duration-300 motion-reduce:animate-none"
          style={{ color: SIGNAL_RED, backgroundColor: shade(SIGNAL_RED, 0.88) }}
          title={zh ? `被 Build-on 最多的笔记（${hotCount} 次）` : `Most built-on note (${hotCount})`}
        >
          <RemixIcon name="fire-fill" size={15} />
          {hotCount}
        </span>
      )}
    </div>
  );
};

export default NoteCornerBadges;
