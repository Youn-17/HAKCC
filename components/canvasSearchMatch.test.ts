import { describe, expect, it } from 'vitest';
import { highlightParts, searchNotes, searchTokens, snippetAround, type SearchableNote } from './canvasSearchMatch';
import { noteSearchText } from './noteText';

const note = (id: string, title: string, author: string, html: string, createdAt = '2026-10-01T00:00:00Z'): SearchableNote => ({
  id, title, author, text: noteSearchText(html), createdAt,
});

const notes = [
  note('n1', 'AI 可能让人不愿意自己思考', '陈思远', '<p>我觉得 AI 会让人<strong>偷懒</strong></p>', '2026-09-22T00:00:00Z'),
  note('n2', '检索练习：先自己回想', '赵一凡', '<p>Roediger &amp; Karpicke 的实验</p>', '2026-09-24T00:00:00Z'),
  note('n3', '先写提纲要花多久？', '周子涵', '<p>时间紧的时候还做得到吗&nbsp;</p>', '2026-09-26T00:00:00Z'),
  note('n4', '用 AI 查资料以后', '陈思远', '<p>记住的反而更少</p>', '2026-09-28T00:00:00Z'),
];

describe('searchNotes', () => {
  it('finds notes by title, author and visible text', () => {
    expect(searchNotes(notes, '检索').map(h => h.id)).toEqual(['n2']);
    expect(searchNotes(notes, '赵一凡').map(h => [h.id, h.field])).toEqual([['n2', 'author']]);
    expect(searchNotes(notes, '偷懒').map(h => [h.id, h.field])).toEqual([['n1', 'content']]);
  });

  it('matches decoded text, not markup', () => {
    expect(searchNotes(notes, 'strong')).toEqual([]);
    expect(searchNotes(notes, 'nbsp')).toEqual([]);
    expect(searchNotes(notes, 'roediger & karpicke').map(h => h.id)).toEqual(['n2']);
  });

  it('requires every word and ranks title hits above content hits, newer first on ties', () => {
    // 两条都是陈思远写、标题都有 AI；n1 的标题以 AI 开头，排前
    expect(searchNotes(notes, '陈思远 AI').map(h => h.id)).toEqual(['n1', 'n4']);
    // 只按作者找，两条同分，新的在前
    expect(searchNotes(notes, '陈思远').map(h => h.id)).toEqual(['n4', 'n1']);
    expect(searchNotes(notes, 'AI 偷懒').map(h => h.id)).toEqual(['n1']);
    expect(searchNotes(notes, 'AI 不存在的词')).toEqual([]);
  });

  it('returns a short snippet around a content hit', () => {
    const [hit] = searchNotes(notes, '偷懒');
    expect(hit.snippet).toContain('偷懒');
  });

  it('ignores empty queries and extra spaces', () => {
    expect(searchNotes(notes, '   ')).toEqual([]);
    expect(searchTokens('  AI   ai  思考 ')).toEqual(['ai', '思考']);
  });
});

describe('snippetAround', () => {
  it('adds ellipses only where text was cut', () => {
    expect(snippetAround('短句命中', '命中')).toBe('短句命中');
    const long = '甲'.repeat(40) + '命中' + '乙'.repeat(40);
    const s = snippetAround(long, '命中', 5);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('命中');
  });
});

describe('highlightParts', () => {
  it('splits text into hit and non-hit runs, case-insensitively', () => {
    expect(highlightParts('Use AI wisely, ai', ['ai'])).toEqual([
      { text: 'Use ', hit: false },
      { text: 'AI', hit: true },
      { text: ' wisely, ', hit: false },
      { text: 'ai', hit: true },
    ]);
  });

  it('merges overlapping tokens and handles no hits', () => {
    expect(highlightParts('检索练习', ['检索', '索练'])).toEqual([{ text: '检索练', hit: true }, { text: '习', hit: false }]);
    expect(highlightParts('没有', ['xyz'])).toEqual([{ text: '没有', hit: false }]);
    expect(highlightParts('', ['a'])).toEqual([]);
  });
});
