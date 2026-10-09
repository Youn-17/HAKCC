import React, { useEffect, useId, useState } from 'react';
import type { Language } from '../types';
import { MORANDI } from './morandiPalette';
import RemixIcon from './RemixIcon';

/**
 * AI 在画图时放在对话里的那一块（2026-09-29 用户要求：画图要有前端展示，别让学生干等着觉得无聊）。
 * 一张「画纸」上线稿一笔笔描出来、颜色一层层晕开，下面写着现在画到哪一步、已经用了几秒。
 * 进度条是按经验时长估的，到 94% 就停住等真正的结果，不会走完了图还没来。
 * 笔记 AI 助手、知识空间智能体、「AI 对话」、文档 AI、对话式笔记都用它。
 *
 * 2026-10-09 起画之前先读对话和笔记弄清楚要画什么（drawPlanner），所以分两段：
 * 「读懂你的意思」是真的在读；规划好了换成「正在画：……」，写的是规划出来的那句说明。
 * 推流的入口（知识空间智能体、AI 对话）给 phase 和 caption；其余入口按时间估这两段。
 * 同一天加上改图（Jev 判断出「颜色淡一点」「再加上小李的观点」是要改上一张）：第一段换成「读懂你要怎么改」。
 */

const PLAN_STAGES: Array<{ at: number; zh: string; en: string }> = [
  { at: 0, zh: '读懂你的意思', en: 'Working out what you mean' },
  { at: 1800, zh: '结合对话和笔记构思', en: 'Planning from the conversation and notes' },
];
const EDIT_PLAN_STAGES: Array<{ at: number; zh: string; en: string }> = [
  { at: 0, zh: '读懂你要怎么改', en: 'Working out what to change' },
  { at: 1800, zh: '在上一张的基础上改', en: 'Changing the last drawing' },
];
const DRAW_STAGES: Array<{ at: number; zh: string; en: string }> = [
  { at: 0, zh: '勾勒线稿', en: 'Sketching the outline' },
  { at: 3500, zh: '铺上颜色', en: 'Laying in colour' },
  { at: 8000, zh: '修整细节', en: 'Refining the details' },
  { at: 19000, zh: '这张比较费工夫，快好了', en: 'This one takes a little longer, almost there' },
];
/** 不推阶段的入口：前这么久当作在规划 */
const ASSUMED_PLAN_MS = 4000;

const stageAt = (stages: typeof PLAN_STAGES, elapsed: number) => [...stages].reverse().find(item => elapsed >= item.at) ?? stages[0];

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

export interface DrawingState {
  prompt: string;
  startedAt: number;
  phase?: 'planning' | 'drawing';
  drawingStartedAt?: number;
  caption?: string;
  /** 改上一张时为 edit */
  mode?: 'new' | 'edit';
}

/** 推流里的 {drawing: {...}} 事件换成绘图动画的状态。规划好了只换阶段和说明，计时不从头算 */
export function nextDrawingState(
  prev: DrawingState | null,
  event: { prompt: string; stage?: unknown; caption?: unknown; mode?: unknown },
  now: number = Date.now(),
): DrawingState {
  const caption = typeof event.caption === 'string' && event.caption.trim() ? event.caption.trim() : undefined;
  const mode = event.mode === 'edit' ? { mode: 'edit' as const } : {};
  if (event.stage === 'drawing') {
    return prev
      ? { ...prev, phase: 'drawing', drawingStartedAt: now, caption, ...mode }
      : { prompt: event.prompt, startedAt: now, phase: 'drawing', drawingStartedAt: now, caption, ...mode };
  }
  return { prompt: event.prompt, startedAt: now, ...(event.stage === 'planning' ? { phase: 'planning' as const } : {}), ...mode };
}

export function drawingProgress(elapsedMs: number, expectedMs: number): number {
  const tau = Math.max(expectedMs, 1000) / 2.2;
  return Math.min(0.94, 1 - Math.exp(-elapsedMs / tau));
}

const DrawingProgress: React.FC<{
  prompt: string;
  lang: Language;
  /** 开始的时刻（毫秒时间戳）；换一张图时换一个值，进度从头算 */
  startedAt: number;
  /** 大概要多久，用来估进度条：规划几秒加 DMX 六到十秒 */
  expectedMs?: number;
  /** 推流的入口知道现在在哪一段：planning = 在读对话和笔记，drawing = 规划好了在画 */
  phase?: 'planning' | 'drawing';
  /** 进入 drawing 的时刻 */
  drawingStartedAt?: number;
  /** 规划出来的那句说明：画的是什么、依据是什么 */
  caption?: string;
  /** 改上一张：第一段写「读懂你要怎么改」 */
  mode?: 'new' | 'edit';
}> = ({ prompt, lang, startedAt, expectedMs = 14000, phase, drawingStartedAt, caption, mode }) => {
  const [now, setNow] = useState(() => Date.now());
  // 对话里可能同时有两张在画，滤镜的 id 不能撞
  const blurId = `drawing-wash-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const zh = lang === 'zh';
  const elapsed = Math.max(0, now - startedAt);
  const planStages = mode === 'edit' ? EDIT_PLAN_STAGES : PLAN_STAGES;
  let progress: number;
  let stage: (typeof PLAN_STAGES)[number];
  if (phase === 'planning') {
    stage = stageAt(planStages, elapsed);
    progress = Math.min(0.3, drawingProgress(elapsed, 5000) * 0.32);
  } else if (phase === 'drawing') {
    const drawing = Math.max(0, now - (drawingStartedAt ?? startedAt));
    stage = stageAt(DRAW_STAGES, drawing);
    progress = Math.min(0.94, 0.3 + drawingProgress(drawing, 9000) * 0.68);
  } else {
    stage = elapsed < ASSUMED_PLAN_MS ? stageAt(planStages, elapsed) : stageAt(DRAW_STAGES, elapsed - ASSUMED_PLAN_MS);
    progress = drawingProgress(elapsed, expectedMs);
  }
  const seconds = Math.floor(elapsed / 1000);
  const shortPrompt = prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt;
  const what = caption || shortPrompt;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={zh ? `正在画：${what}` : `Drawing: ${what}`}
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
        <p className={`text-xs text-gray-500 dark:text-gray-400 ${caption ? 'line-clamp-2 leading-5' : 'truncate'}`} title={caption || prompt}>
          {zh ? '正在画：' : 'Drawing: '}{what}
        </p>
      </div>
    </div>
  );
};

export default DrawingProgress;
