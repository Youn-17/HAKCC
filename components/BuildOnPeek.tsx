import React from 'react';
import RemixIcon from './RemixIcon';
import { RELATION_COLORS, RELATION_LABELS } from './relationColors';

/**
 * 鼠标停在一张卡片上，旁边列出建立在它上面的笔记标题（2026-10-09 用户要的）。
 * 收起的卡片也能看：不展开就知道底下是什么。点一条，画布移过去。
 * 只在有 Build-on 的卡片上出现；画在画布容器里（屏幕坐标），不跟着缩放变大变小。
 */

export interface PeekItem {
  id: string;
  title: string;
  author: string;
  relationType?: string;
  /** 在收起的分支里，画布上现在看不到 */
  hidden: boolean;
  isNew: boolean;
}

interface Props {
  lang: 'zh' | 'en';
  /** 卡片在画布容器里的位置（屏幕像素） */
  anchor: { left: number; top: number; width: number; height: number };
  container: { width: number; height: number };
  items: PeekItem[];
  collapsed: boolean;
  hiddenCount: number;
  onPick: (id: string) => void;
  onToggle: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

const WIDTH = 272;
const MAX_ROWS = 6;

const BuildOnPeek: React.FC<Props> = ({
  lang, anchor, container, items, collapsed, hiddenCount, onPick, onToggle, onPointerEnter, onPointerLeave,
}) => {
  const zh = lang === 'zh';
  const rows = items.slice(0, MAX_ROWS);
  const more = items.length - rows.length;
  const estimatedHeight = 52 + rows.length * 44 + (more > 0 ? 24 : 0) + 40;

  const roomRight = container.width - (anchor.left + anchor.width) - 12;
  const left = roomRight >= WIDTH
    ? anchor.left + anchor.width + 8
    : Math.max(8, anchor.left - WIDTH - 8);
  const top = Math.min(Math.max(8, anchor.top), Math.max(8, container.height - estimatedHeight - 8));
  const labels = RELATION_LABELS[zh ? 'zh' : 'en'];

  return (
    <div
      data-canvas-overlay
      role="dialog"
      aria-label={zh ? '建立在这条上的笔记' : 'Notes built on this one'}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      className="absolute z-40 rounded-xl border border-zinc-200 bg-white/97 p-1.5 shadow-[0_16px_40px_-18px_rgba(15,23,42,0.45)] backdrop-blur-sm animate-in fade-in duration-150 motion-reduce:animate-none dark:border-gray-700 dark:bg-gray-900/97"
      style={{ left, top, width: WIDTH }}
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-0.5">
        <span className="text-[0.6875rem] font-medium text-zinc-500 dark:text-gray-400">
          {zh ? `建立在这条上的 ${items.length} 条` : `${items.length} built on this`}
          {collapsed && <span className="ml-1 text-zinc-400">{zh ? '· 已收起' : '· folded'}</span>}
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="flex min-h-[28px] items-center gap-0.5 rounded-lg px-2 text-[0.6875rem] font-medium text-[#000080] transition-colors hover:bg-[#000080]/[0.06] active:scale-[0.98] dark:text-indigo-200 dark:hover:bg-indigo-400/15"
        >
          <RemixIcon name={collapsed ? 'arrow-right-s-line' : 'arrow-down-s-line'} size={14} />
          {/* 收起时藏着的可能不止这几条（往下还有），按钮上写全数 */}
          {collapsed ? (zh ? `展开 ${hiddenCount} 条` : `Expand ${hiddenCount}`) : (zh ? '收起' : 'Fold')}
        </button>
      </div>
      <ul className="space-y-0.5">
        {rows.map(item => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onPick(item.id)}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-50 active:scale-[0.99] dark:hover:bg-gray-800/70"
            >
              <span
                className="mt-[5px] h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: RELATION_COLORS[item.relationType ?? 'extend'] ?? RELATION_COLORS.extend }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[0.75rem] font-medium leading-snug text-zinc-900 dark:text-gray-100">
                  {item.title || (zh ? '（无标题）' : '(untitled)')}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[0.6875rem] text-zinc-500 dark:text-gray-400">
                  <span>{labels[item.relationType ?? 'extend'] ?? item.relationType}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{item.author}</span>
                  {item.isNew && <span className="rounded bg-rose-50 px-1 font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">New</span>}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <div className="px-2 pb-1 pt-0.5 text-[0.6875rem] text-zinc-400">{zh ? `还有 ${more} 条` : `${more} more`}</div>
      )}
    </div>
  );
};

export default BuildOnPeek;
