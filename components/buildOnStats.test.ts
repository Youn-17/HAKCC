import { describe, expect, it } from 'vitest';
import type { Edge, Note } from '../types';

/**
 * Build-on 网络的统计口径。
 *
 * 关系的方向是：source = 接的人那条新笔记，target = 被接的那条观点。
 * 搞反的话「我被接了几次」和「我接了几次」会整个对调，而且不会报错——
 * 学生会看到一个反过来的自我画像，这比没有更糟。
 */
const ME = 'me';

function stats(notes: Note[], edges: Edge[], userId: string) {
  const byId = new Map(notes.map(n => [n.id, n]));
  const isMine = (n?: Note) => Boolean(n && n.authorId === userId);
  const mine = notes.filter(n => isMine(n));
  const mineIds = new Set(mine.map(n => n.id));
  const receivedBy = new Map<string, number>();
  let given = 0;
  const partners = new Set<string>();

  for (const link of edges) {
    const from = byId.get(link.source);
    const to = byId.get(link.target);
    if (!from || !to) continue;
    if (mineIds.has(link.target) && !isMine(from)) {
      receivedBy.set(link.target, (receivedBy.get(link.target) ?? 0) + 1);
      if (from.authorId) partners.add(from.authorId);
    }
    if (mineIds.has(link.source) && !isMine(to)) {
      given += 1;
      if (to.authorId) partners.add(to.authorId);
    }
  }
  return {
    myNotes: mine.length,
    received: [...receivedBy.values()].reduce((a, b) => a + b, 0),
    given,
    partners: partners.size,
    unanswered: mine.filter(n => !receivedBy.has(n.id)).map(n => n.id),
  };
}

const note = (id: string, authorId: string): Note =>
  ({ id, type: 'note', title: id, author: authorId, authorId, date: '', x: 0, y: 0 } as Note);
const edge = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target });

describe('Build-on 网络的自我统计', () => {
  const notes = [note('a1', ME), note('a2', ME), note('b1', 'bob'), note('c1', 'cara')];

  it('别人接我 = 我的笔记出现在 target 上', () => {
    const s = stats(notes, [edge('b1', 'a1')], ME);
    expect(s.received).toBe(1);
    expect(s.given).toBe(0);
  });

  it('我接别人 = 我的笔记出现在 source 上', () => {
    const s = stats(notes, [edge('a1', 'b1')], ME);
    expect(s.given).toBe(1);
    expect(s.received).toBe(0);
  });

  // 自己接自己不算「被同学接过」，否则刷自己的连线就能把数字做上去
  it('自己接自己两边都不计', () => {
    const s = stats(notes, [edge('a1', 'a2')], ME);
    expect(s.received).toBe(0);
    expect(s.given).toBe(0);
    expect(s.partners).toBe(0);
  });

  it('连接过的同学按人去重，不按连线条数', () => {
    const s = stats(notes, [edge('b1', 'a1'), edge('b1', 'a2'), edge('a1', 'c1')], ME);
    expect(s.partners).toBe(2);
  });

  it('没人接过的观点会被列出来', () => {
    const s = stats(notes, [edge('b1', 'a1')], ME);
    expect(s.unanswered).toEqual(['a2']);
  });

  it('一条观点被接多次，次数累加但只算一条已回应', () => {
    const s = stats(notes, [edge('b1', 'a1'), edge('c1', 'a1')], ME);
    expect(s.received).toBe(2);
    expect(s.unanswered).toEqual(['a2']);
  });
});
