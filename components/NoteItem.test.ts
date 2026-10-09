import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NoteItem from './NoteItem';
import type { Note } from '../types';
import { STANDARD_NOTE_WIDTH, STANDARD_NOTE_HEIGHT, NOTE_FONT, NOTE_TITLE_LINE_BOX } from './noteGeometry';

const baseNote: Note = {
  id: 'note-1',
  type: 'note',
  title: '知识建构的理论依据与公共 Idea 持续改进路径',
  author: 'Alex Chen',
  date: '2026/3/18 13:23:32',
  x: 120,
  y: 80,
};

const noop = () => {};

describe('NoteItem workspace card', () => {
  it('keeps long idea titles more visible and exposes the full title', () => {
    const html = renderToStaticMarkup(
      React.createElement(NoteItem, {
        note: baseNote,
        lang: 'zh',
        onMouseDown: noop,
        onDoubleClick: noop,
        onContextMenu: noop,
      })
    );

    expect(html).toContain(`width:${STANDARD_NOTE_WIDTH}px`);
    expect(html).toContain(`height:${STANDARD_NOTE_HEIGHT}px`);
    // 行数由卡片高度算出（拉高就多显示几行），不再是写死的 line-clamp-3
    expect(html).toContain('-webkit-line-clamp:2');
    expect(html).toContain(`font-size:${NOTE_FONT.title}px`);
    expect(html).not.toContain('min-h-[2.65rem]');
    expect(html).toContain(`title="${baseNote.title}"`);
  });

  it('拉高卡片时标题能多排几行', () => {
    const render = (height: number) => renderToStaticMarkup(
      React.createElement(NoteItem, {
        note: { ...baseNote, height },
        lang: 'zh',
        onMouseDown: noop,
        onDoubleClick: noop,
        onContextMenu: noop,
      })
    );
    // 期望值由常量推导：调整标题字号时这条测试不该假失败，
    // 它要守的是「行数随高度增长」这个行为，不是某个具体数字。
    const linesFor = (h: number) => Math.max(1, Math.floor((h - 4 - 20 - 50) / NOTE_TITLE_LINE_BOX));
    expect(render(STANDARD_NOTE_HEIGHT)).toContain(`-webkit-line-clamp:${linesFor(STANDARD_NOTE_HEIGHT)}`);
    expect(render(300)).toContain(`-webkit-line-clamp:${linesFor(300)}`);
    expect(linesFor(300)).toBeGreaterThan(linesFor(STANDARD_NOTE_HEIGHT));
  });

  it('卡片上只显示标题，不显示正文', () => {
    const html = renderToStaticMarkup(
      React.createElement(NoteItem, {
        note: { ...baseNote, content: '<p>这段正文不应该出现在画布卡片上</p>' },
        lang: 'zh',
        onMouseDown: noop,
        onDoubleClick: noop,
        onContextMenu: noop,
      })
    );
    expect(html).not.toContain('这段正文不应该出现在画布卡片上');
  });

  it('时间戳带年份，避免把去年的笔记误认成本周的', () => {
    const html = renderToStaticMarkup(
      React.createElement(NoteItem, {
        note: { ...baseNote, createdAt: '2025-11-20T08:15:00.000Z' },
        lang: 'zh',
        onMouseDown: noop,
        onDoubleClick: noop,
        onContextMenu: noop,
      })
    );
    expect(html).toContain('2025/11/20');
  });

  it('有 Build-on 的卡片下沿是收起/展开开关，说法用 Build-on（2026-10-09 取代「已有 Build-on」字样）', () => {
    const render = (fold?: { childCount: number; collapsed: boolean; hiddenCount: number; hasNewHidden: boolean }) =>
      renderToStaticMarkup(
        React.createElement(NoteItem, {
          note: baseNote,
          lang: 'zh',
          fold,
          onMouseDown: noop,
          onDoubleClick: noop,
          onContextMenu: noop,
        })
      );

    const open = render({ childCount: 2, collapsed: false, hiddenCount: 0, hasNewHidden: false });
    expect(open).toContain('2 条 Build-on 建立在这条上');
    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toContain('已有 Build-on');
    expect(open).not.toContain('Built-upon');
    expect(open).not.toContain('被引用');

    const folded = render({ childCount: 2, collapsed: true, hiddenCount: 5, hasNewHidden: true });
    expect(folded).toContain('已收起 5 条 Build-on');
    expect(folded).toContain('+5');
    expect(folded).toContain('aria-expanded="false"');

    expect(render()).not.toContain('data-fold-toggle');
  });
});
