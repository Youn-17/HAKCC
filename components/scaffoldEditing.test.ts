import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 支架里的字必须能选中、能改。
 * 出过的事：user-select:none 写在了包着输入槽的外层 span 上，输入槽跟着算成 none，
 * 学生在支架里拖不出选区，只能一个字一个字地删。这类错在界面上不报错，只能靠扫样式挡。
 */
describe('支架编辑', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
  const editor = readFileSync(resolve(__dirname, 'NoteEditorModal.tsx'), 'utf8');

  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1], body: m[2] }));

  it('包着输入槽的元素不能禁止选择', () => {
    const offenders = rules
      .filter(r => /user-select:\s*none/.test(r.body))
      .filter(r => /\[data-scaffold-(slot|input|id)\]/.test(r.selector))
      .map(r => r.selector.trim());
    expect(offenders).toEqual([]);
  });

  it('输入槽显式声明可选', () => {
    const input = rules.filter(r => /\[data-scaffold-input\]/.test(r.selector) && /user-select:\s*text/.test(r.body));
    expect(input.length).toBeGreaterThan(0);
  });

  it('槽内换行不再补占位 <br>（它会把 ] 顶到光标的下一行）', () => {
    expect(editor).not.toMatch(/const filler = document\.createElement\('br'\)/);
  });

  it('选区碰到支架的框时只清选中的字，而不是整个拦下', () => {
    expect(editor).toMatch(/deleteSelectionKeepingFrames/);
    expect(editor).not.toMatch(/if \(touchesFrame && !r\.collapsed\) \{ event\.preventDefault\(\); return; \}/);
  });
});
