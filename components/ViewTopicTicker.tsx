import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ViewTopic } from '../services/apiClient';

/**
 * 问题栏后面滚动的讨论主题（2026-10-05 用户：直接显示滚动主题，不要「大家在聊」这类引导语）。
 *
 * 一排放得下就不滚；放不下才横向滚动，鼠标放上、键盘聚焦时停住。
 * 系统设了「减少动态效果」的不滚动，每 5 秒换一个主题。点一个主题，画布定位到相关的笔记。
 */

const SECONDS_PER_TOPIC = 6;
const ROTATE_MS = 5000;
/** 窗口窄、问题又长时，问题优先；剩下的地方连一个主题都放不下就整条藏起来（藏起来的按钮也不能被 Tab 到） */
export const MIN_VISIBLE_WIDTH = 96;

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

const TopicButton: React.FC<{ topic: ViewTopic; lang: 'zh' | 'en'; onSelect: (topic: ViewTopic) => void; hidden?: boolean }> = ({ topic, lang, onSelect, hidden }) => (
  <button
    type="button"
    tabIndex={hidden ? -1 : 0}
    aria-hidden={hidden || undefined}
    onClick={e => { e.stopPropagation(); onSelect(topic); }}
    title={lang === 'zh' ? `${topic.count} 条笔记，点一下在画布上找出来` : `${topic.count} notes; click to find them on the canvas`}
    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1 text-xs text-gray-600 transition-colors hover:text-[#000080] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#000080] dark:text-gray-300 dark:hover:text-blue-300"
  >
    {topic.label}
    <span className="tabular-nums text-gray-400 dark:text-gray-500">· {topic.count}</span>
  </button>
);

const ViewTopicTicker: React.FC<{ topics: ViewTopic[]; lang: 'zh' | 'en'; onSelect: (topic: ViewTopic) => void }> = ({ topics, lang, onSelect }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [boxWidth, setBoxWidth] = useState(0);
  const [reduced] = useState(prefersReducedMotion);
  const [index, setIndex] = useState(0);

  // 一排放不放得下：量第一份的宽度和外框的宽度
  useLayoutEffect(() => {
    const measure = () => {
      const box = boxRef.current?.clientWidth ?? 0;
      const row = rowRef.current?.scrollWidth ?? 0;
      setBoxWidth(box);
      setOverflowing(row > box + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined' || !boxRef.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(boxRef.current);
    return () => observer.disconnect();
  }, [topics]);

  useEffect(() => {
    setIndex(0);
    if (!reduced || topics.length < 2) return;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % topics.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [reduced, topics]);

  if (topics.length === 0) return null;
  const name = lang === 'zh' ? '讨论主题' : 'Discussion topics';
  const tooNarrow = boxWidth < MIN_VISIBLE_WIDTH;
  const scrolling = overflowing && !tooNarrow;

  if (reduced) {
    const topic = topics[index % topics.length];
    return (
      <div ref={boxRef} role="group" aria-label={name} className={`flex min-w-0 flex-1 items-center overflow-hidden ${tooNarrow ? 'invisible' : ''}`} data-view-topics={tooNarrow ? 'hidden' : 'rotate'}>
        <div ref={rowRef} key={topic.label} className="topic-fade">
          <TopicButton topic={topic} lang={lang} onSelect={onSelect} />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      role="group"
      aria-label={name}
      data-view-topics={tooNarrow ? 'hidden' : scrolling ? 'scroll' : 'static'}
      className={`relative flex min-w-0 flex-1 items-center overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)] ${tooNarrow ? 'invisible' : ''}`}
    >
      <div
        className={`flex w-max items-center ${scrolling ? 'topic-marquee' : ''}`}
        style={scrolling ? ({ '--marquee-duration': `${Math.max(12, topics.length * SECONDS_PER_TOPIC)}s` } as React.CSSProperties) : undefined}
      >
        <div ref={rowRef} className="flex items-center gap-4 pr-4">
          {topics.map(topic => <TopicButton key={topic.label} topic={topic} lang={lang} onSelect={onSelect} />)}
        </div>
        {/* 第二份接在后面，滚到一半正好接上第一份，看起来是一圈不断的 */}
        {scrolling && (
          <div className="flex items-center gap-4 pr-4" aria-hidden="true">
            {topics.map(topic => <TopicButton key={`copy-${topic.label}`} topic={topic} lang={lang} onSelect={onSelect} hidden />)}
          </div>
        )}
      </div>
    </div>
  );
};

export default ViewTopicTicker;
