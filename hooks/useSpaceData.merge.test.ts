import { describe, expect, it } from 'vitest';
import type { Note } from '../types';

/**
 * 合并逻辑的行为契约。整体替换会让所有 Note 的对象标识都变，
 * React 把整块画布重渲一遍——在 75 条笔记的空间里就是肉眼可见的「刷新」。
 * 这里把 useSpaceData 里的合并规则复刻出来单测，避免它被无意改回整体替换。
 */
function mergeNotes(prev: Note[], incoming: Note[]): Note[] {
  const prevById = new Map(prev.map(n => [n.id, n]));
  const incomingIds = new Set(incoming.map(n => n.id));
  const merged = incoming.map(next => {
    const existing = prevById.get(next.id);
    return existing && JSON.stringify(existing) === JSON.stringify(next) ? existing : next;
  });
  const pendingLocal = prev.filter(n => n.id.startsWith('temp-') && !incomingIds.has(n.id));
  return [...merged, ...pendingLocal];
}

const note = (id: string, title: string): Note =>
  ({ id, type: 'note', title, author: 'A', date: '2026/1/1', x: 0, y: 0 } as Note);

describe('空间数据合并', () => {
  it('内容没变的笔记沿用原对象，React 才能跳过重渲', () => {
    const a = note('1', '甲');
    const b = note('2', '乙');
    const out = mergeNotes([a, b], [note('1', '甲'), note('2', '乙')]);

    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it('内容变了的换成新对象', () => {
    const a = note('1', '甲');
    const out = mergeNotes([a], [note('1', '甲改')]);

    expect(out[0]).not.toBe(a);
    expect(out[0].title).toBe('甲改');
  });

  // 学生刚拖出来的新笔记服务器还不知道。整体替换会让它闪一下消失、
  // 过几秒又冒出来。
  it('保住本地乐观创建、服务器还没有的笔记', () => {
    const local = note('temp-123', '刚建的');
    const out = mergeNotes([note('1', '甲'), local], [note('1', '甲')]);

    expect(out).toHaveLength(2);
    expect(out).toContain(local);
  });

  it('服务器已经有了同一条就不再重复保留本地那份', () => {
    const local = note('temp-123', '刚建的');
    const out = mergeNotes([local], [note('temp-123', '刚建的')]);

    expect(out).toHaveLength(1);
  });

  it('服务器删掉的笔记会从列表里消失', () => {
    const out = mergeNotes([note('1', '甲'), note('2', '乙')], [note('1', '甲')]);
    expect(out.map(n => n.id)).toEqual(['1']);
  });
});
