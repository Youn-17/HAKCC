import React, { useEffect, useState } from 'react';
import type { Language } from '../types';

/**
 * AI 在想、在写的时候放在对话里的那一小块（2026-09-29 用户要求：等的时候要有个简单的动效，别让学生干等着无聊）。
 * 三个点依次跳一下，文字上有一道光扫过，后面跟着已经等了几秒：让人看得出它没有卡住。
 * 只是「在忙」的提示，不冒充进度——模型要想多久事先并不知道，所以不画进度条。
 * 画图另有 DrawingProgress（画纸和进度条），那个知道大概要几秒。
 */

/** 等满这么久才显示秒数：一两秒就出结果的时候，数字一闪而过反而添乱 */
export const SHOW_SECONDS_AFTER_MS = 3000;
/** 等满这么久再补一句宽心话（推理模型一想就是二十来秒） */
export const SLOW_HINT_AFTER_MS = 15000;

export function waitedSeconds(elapsedMs: number): number {
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

/** 三个点。单独拿出来：回复一边流出来的时候，文字后面也挂一组，表示还在写 */
export const AiThinkingDots: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span data-ai-motion="dots" className={`ai-dots ${className}`} aria-hidden="true">
    <span className="ai-dot" />
    <span className="ai-dot" />
    <span className="ai-dot" />
  </span>
);

const AiThinking: React.FC<{
  /** 现在在做什么：正在思考 / 正在读取课程知识网络 / 正在组织回答 */
  label: string;
  /** 这一轮问答开始的时刻（毫秒时间戳）。状态变了、组件换了位置，秒数也接着算 */
  startedAt: number;
  lang: Language;
}> = ({ label, startedAt, lang }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const zh = lang === 'zh';
  const elapsed = Math.max(0, now - startedAt);
  const seconds = waitedSeconds(elapsed);

  return (
    <div role="status" aria-live="polite" data-ai-busy className="text-[0.8125rem] leading-6">
      <span className="inline-flex items-center gap-2.5">
        <AiThinkingDots />
        <span className="ai-shimmer font-medium">{label}</span>
        {elapsed >= SHOW_SECONDS_AFTER_MS && (
          <span className="text-[0.75rem] tabular-nums text-gray-400 dark:text-gray-500">
            {zh ? `${seconds} 秒` : `${seconds}s`}
          </span>
        )}
      </span>
      {elapsed >= SLOW_HINT_AFTER_MS && (
        <p className="mt-0.5 text-[0.75rem] text-gray-400 dark:text-gray-500">
          {zh ? '这个问题想得久一些，还在处理，请稍等。' : 'This one is taking a while. Still working on it.'}
        </p>
      )}
    </div>
  );
};

export default AiThinking;
