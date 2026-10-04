// @vitest-environment jsdom
/**
 * 插入支架后括号里显示灰色的「写在这里……」（2026-09 课堂反馈：学生不知道该在哪里写）。
 * 提示是 CSS 按 data-scaffold-empty 画的；这里核对这个标记什么时候有、什么时候没有，
 * 以及它不会跟着正文存进库。
 */
import { describe, expect, it } from 'vitest';
import { normalizeScaffoldMarkers, scaffoldMarkerHtml, stripScaffoldPlaceholders } from './scaffoldLibrary';
import type { Scaffold } from '../types';

const scaffold = { id: 's-view', title: '我的想法/观点是', content: '我的想法/观点是' } as unknown as Scaffold;

function editorWith(html: string): HTMLDivElement {
  const editor = document.createElement('div');
  editor.contentEditable = 'true';
  editor.innerHTML = html;
  normalizeScaffoldMarkers(editor);
  return editor;
}

describe('支架括号里的「写在这里」提示', () => {
  it('刚插入的支架（括号里只有零宽占位符）带空槽标记', () => {
    const editor = editorWith(scaffoldMarkerHtml(scaffold, 'zh'));
    expect(editor.querySelector('[data-scaffold-input]')!.hasAttribute('data-scaffold-empty')).toBe(true);
  });

  it('写了字就摘掉，删光了又回来', () => {
    const editor = editorWith(scaffoldMarkerHtml(scaffold, 'zh'));
    const input = editor.querySelector<HTMLElement>('[data-scaffold-input]')!;
    input.textContent = '​学生与AI如何互动';
    normalizeScaffoldMarkers(editor);
    expect(input.hasAttribute('data-scaffold-empty')).toBe(false);
    input.textContent = '​  ';
    normalizeScaffoldMarkers(editor);
    expect(input.hasAttribute('data-scaffold-empty')).toBe(true);
  });

  it('括号里只放了一张图也不算空', () => {
    const editor = editorWith(scaffoldMarkerHtml(scaffold, 'zh'));
    const input = editor.querySelector<HTMLElement>('[data-scaffold-input]')!;
    input.innerHTML = '<img src="https://files.example.test/a.png">';
    normalizeScaffoldMarkers(editor);
    expect(input.hasAttribute('data-scaffold-empty')).toBe(false);
  });

  it('存进库的正文里没有这个标记，也没有零宽占位符', () => {
    const editor = editorWith(scaffoldMarkerHtml(scaffold, 'zh') + scaffoldMarkerHtml(scaffold, 'zh'));
    const stored = stripScaffoldPlaceholders(editor.innerHTML);
    expect(stored).not.toContain('data-scaffold-empty');
    expect(stored).not.toContain('​');
    expect(stored).toContain('data-scaffold-id="s-view"');
  });
});
