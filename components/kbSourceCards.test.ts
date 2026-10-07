import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KbSourceCards, { citedNumbers, pagesText, parseKbSources } from './KbSourceCards';

/** 笔记 AI 回答下面的来源卡片：只列回答里标了 [n] 的；附件能点开原文，课程资料不能 */

const SOURCES = parseKbSources([
  { n: 1, title: 'Scardamalia 2006.pdf', section: 'Principles', pageStart: 3, pageEnd: 4, excerpt: '观点改进', kind: 'attachment', noteId: 'note-1', relevance: 0.8 },
  { n: 2, title: '课程大纲', section: null, pageStart: null, pageEnd: null, excerpt: '第三周讨论', kind: 'material', noteId: null, relevance: 0.7 },
  { n: 'x', title: '编号不对' },
  null,
]);

const render = (content: string, streaming = false, onOpen?: (noteId: string, page: number | null) => void) =>
  renderToStaticMarkup(createElement(KbSourceCards, { sources: SOURCES, content, streaming, lang: 'zh', onOpen }));

describe('解析与格式', () => {
  it('存下的卡片字段不全的丢掉', () => {
    expect(SOURCES.map(s => s.n)).toEqual([1, 2]);
    expect(SOURCES[1]).toMatchObject({ kind: 'material', noteId: null, section: null });
  });

  it('回答里标过的编号', () => {
    expect([...citedNumbers('观点要不断改进[1]，另见[2][3]。')]).toEqual([1, 2, 3]);
    expect(citedNumbers('没有标').size).toBe(0);
  });

  it('页码写法', () => {
    expect(pagesText(3, 4, true)).toBe('第 3–4 页');
    expect(pagesText(3, 3, true)).toBe('第 3 页');
    expect(pagesText(3, 4, false)).toBe('pp. 3–4');
    expect(pagesText(3, null, false)).toBe('p. 3');
    expect(pagesText(null, null, true)).toBeNull();
  });
});

describe('显示哪些', () => {
  it('只列回答里标了的', () => {
    const html = render('第三周讨论这个问题[2]。');
    expect(html).toContain('引用来源');
    expect(html).toContain('课程大纲');
    expect(html).not.toContain('Scardamalia');
  });

  it('写完了一个都没标：列出检索到的全部；还在写就先不列', () => {
    const done = render('没有标编号的回答');
    expect(done).toContain('检索到的课程资料');
    expect(done).toContain('Scardamalia');
    expect(done).toContain('课程大纲');
    expect(render('还在写', true)).toBe('');
  });

  it('附件给了打开的办法才是按钮，标题写明跳到第几页；课程资料不能点', () => {
    const html = render('见[1][2]', false, () => {});
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('打开原文，跳到第 3–4 页');
    expect(html).toContain('>课程资料<');
    expect(render('见[1]').includes('<button')).toBe(false);
  });
});
