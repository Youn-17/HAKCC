import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * NoteEditorModal 里有一句 `if (!isOpen) return null;`。任何 React 钩子写在它后面，
 * 编辑器关着和开着时钩子数量就不一致 —— 生产上就是 React #310 白屏。
 * 这个错在同一个文件里犯过两次，所以用测试挡住。
 */
describe('NoteEditorModal 钩子顺序', () => {
  it('所有钩子都在 isOpen 的提前 return 之前', () => {
    const src = readFileSync(resolve(__dirname, 'NoteEditorModal.tsx'), 'utf-8').split('\n');
    const ret = src.findIndex(l => l.includes('if (!isOpen) return null;'));
    expect(ret).toBeGreaterThan(0);
    const hookRe = /\buse(State|Effect|Ref|Memo|Callback|LayoutEffect|Reducer|Context)\(/;
    const late = src
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => i > ret && hookRe.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .map(({ l, i }) => `${i + 1}: ${l.trim()}`);
    expect(late).toEqual([]);
  });
});
