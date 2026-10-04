import React, { useEffect, useId, useState } from 'react';
import type { Language } from '../types';
import { MORANDI } from './morandiPalette';
import RemixIcon from './RemixIcon';

/**
 * AI 在画图时放在对话里的那一块（2026-09-29 用户要求：画图要有前端展示，别让学生干等着觉得无聊）。
 * 一张「画纸」上线稿一笔笔描出来、颜色一层层晕开，下面写着现在画到哪一步、已经用了几秒。
 * 进度条是按经验时长估的（DMX 大多六到十秒），到 94% 就停住等真正的结果，不会走完了图还没来。
 * 笔记 AI 助手、知识空间助手、「AI 对话」三处都用它。
 */

const STAGES: Array<{ at: number; zh: string; en: string }> = [
  { at: 0, zh: '读懂你的描述', en: 'Reading your description' },
  { at: 1800, zh: '构思画面', en: 'Planning the picture' },
  { at: 4500, zh: '勾勒线稿', en: 'Sketching the outline' },
  { at: 8000, zh: '铺上颜色', en: 'Laying in colour' },
  { at: 12500, zh: '修整细节', en: 'Refining the details' },
  { at: 24000, zh: '这张比较费工夫，快好了', en: 'This one takes a little longer, almost there' },
];

/** 画纸上的几笔：地平线、远山、太阳、两只鸟、一棵小树。pathLength=1 让描线动画不用量真实长度 */
const STROKES = [
  'M8 70 C 40 66, 70 72, 112 68 S 170 66, 192 70',
  'M14 68 C 34 44, 52 40, 70 56 C 84 40, 104 34, 124 58',
  'M150 30 m -11 0 a 11 11 0 1 0 22 0 a 11 11 0 1 0 -22 0',
  'M92 26 q 5 -5 10 0 q 5 -5 10 0',
  'M116 38 q 4 -4 8 0 q 4 -4 8 0',
  'M168 68 L 168 52 M 168 56 C 160 54, 158 44, 168 40 C 178 44, 176 54, 168 56',
];

const WASHES = [
  { cx: 60, cy: 58, r: 34, color: MORANDI.sage },
  { cx: 150, cy: 30, r: 18, color: MORANDI.ochre },
  { cx: 110, cy: 22, r: 40, color: MORANDI.dustyBlue },
  { cx: 170, cy: 60, r: 16, color: MORANDI.rose },
];

export function drawingProgress(elapsedMs: number, expectedMs: number): number {
  const tau = Math.max(expectedMs, 1000) / 2.2;
  return Math.min(0.94, 1 - Math.exp(-elapsedMs / tau));
}

const DrawingProgress: React.FC<{
  prompt: string;
  lang: Language;
  /** 开始画的时刻（毫秒时间戳）；换一张图时换一个值，进度从头算 */
  startedAt: number;
  /** 大概要多久，用来估进度条。DMX 六到十秒 */
  expectedMs?: number;
}> = ({ prompt, lang, startedAt, expectedMs = 9000 }) => {
  const [now, setNow] = useState(() => Date.now());
  // 对话里可能同时有两张在画，滤镜的 id 不能撞
  const blurId = `drawing-wash-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const zh = lang === 'zh';
  const elapsed = Math.max(0, now - startedAt);
  const progress = drawingProgress(elapsed, expectedMs);
  const stage = [...STAGES].reverse().find(item => elapsed >= item.at) ?? STAGES[0];
  const seconds = Math.floor(elapsed / 1000);
  const shortPrompt = prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={zh ? `正在画：${shortPrompt}` : `Drawing: ${shortPrompt}`}
      className="w-full max-w-sm overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="relative bg-[#fbfaf6] dark:bg-gray-950">
        <svg viewBox="0 0 200 80" className="block h-auto w-full" aria-hidden="true">
          <defs>
            <filter id={blurId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>
          {WASHES.map((wash, index) => (
            <circle
              key={index}
              cx={wash.cx}
              cy={wash.cy}
              r={wash.r}
              fill={wash.color}
              filter={`url(#${blurId})`}
              // 颜色随进度一层层晕开：越往后的颜色越晚出现
              opacity={Math.max(0, Math.min(0.55, (progress - 0.25 - index * 0.1) * 1.4))}
            />
          ))}
          {STROKES.map((d, index) => (
            <path
              key={index}
              d={d}
              pathLength={1}
              className="drawing-stroke"
              style={{ animationDelay: `${index * 0.45}s` }}
              fill="none"
              stroke="#000080"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        <span className="drawing-brush absolute bottom-2 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#000080] shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-blue-300 dark:ring-gray-700">
          <RemixIcon name="brush-line" size={16} />
        </span>
      </div>
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{zh ? stage.zh : stage.en}</span>
          <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {zh ? `已用 ${seconds} 秒` : `${seconds}s`}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className="h-full rounded-full bg-[#000080] transition-[width] duration-300 ease-out motion-reduce:transition-none dark:bg-blue-400"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={prompt}>
          {zh ? '正在画：' : 'Drawing: '}{shortPrompt}
        </p>
      </div>
    </div>
  );
};

export default DrawingProgress;
