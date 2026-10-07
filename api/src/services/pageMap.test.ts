import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from './kbChunker';
import { joinPages, pageAt, pageMapFromContentList, pagesForChunks, shiftPageMap } from './pageMap';

/** 页码对照表：MinerU 的分块清单、本地 pdf-parse 的逐页文字 → 正文第几个字起是第几页 → 片段的起止页 */

describe('pageMapFromContentList（MinerU）', () => {
  const markdown = [
    '# Knowledge Building',
    '',
    'Idea improvement is a principle in which ideas are treated as improvable objects.',
    '',
    '## Community',
    '',
    'Collective responsibility for community knowledge means everyone contributes.',
    '',
    'Rise above: working with ideas leads to higher-level formulations.',
  ].join('\n');
  const blocks = [
    { type: 'header', text: 'Journal of Learning Sciences', page_idx: 0 },
    { type: 'text', text: 'Knowledge Building', text_level: 1, page_idx: 0 },
    { type: 'text', text: 'Idea improvement is a principle in which ideas are treated as improvable objects.', page_idx: 0 },
    { type: 'page_number', text: '1', page_idx: 0 },
    { type: 'text', text: 'Community', text_level: 2, page_idx: 1 },
    { type: 'text', text: 'Collective responsibility for community knowledge means everyone contributes.', page_idx: 1 },
    { type: 'image', img_path: 'images/a.jpg', page_idx: 2 },
    { type: 'text', text: 'Rise above: working with ideas leads to higher-level formulations.', page_idx: 2 },
  ];

  it('各块在 full.md 里按顺序定位，页码从 1 起；页眉、页码、图片不拿来定位', () => {
    const map = pageMapFromContentList(markdown, blocks);
    expect(map.map(([, page]) => page)).toEqual([1, 2, 3]);
    expect(pageAt(map, markdown.indexOf('Idea improvement'))).toBe(1);
    expect(pageAt(map, markdown.indexOf('Collective'))).toBe(2);
    expect(pageAt(map, markdown.indexOf('Rise above'))).toBe(3);
  });

  it('标题行从「##」算起：从标题开始的片段落在标题那一页', () => {
    const map = pageMapFromContentList(markdown, blocks);
    expect(pageAt(map, markdown.indexOf('## Community'))).toBe(2);
    expect(pageAt(map, markdown.indexOf('## Community') - 1)).toBe(1);
  });

  it('第一个找到的块不在第 1 页：它前面的字不标页码', () => {
    const map = pageMapFromContentList('Cover text that MinerU did not list.\n\nCollective responsibility for community knowledge.', [
      { type: 'text', text: 'Collective responsibility for community knowledge.', page_idx: 1 },
    ]);
    expect(pageAt(map, 0)).toBeNull();
    expect(map).toEqual([[38, 2]]);
  });

  it('格式差异（Markdown 记号、空白）不影响定位；对不上的块跳过，页码不往回走', () => {
    const md = '**Idea   improvement** is a principle in which ideas are treated as improvable objects.\n\nOther text here that is long enough.';
    const map = pageMapFromContentList(md, [
      { type: 'text', text: 'Idea improvement is a principle in which ideas', page_idx: 4 },
      { type: 'text', text: 'Nothing like this appears anywhere in the file', page_idx: 5 },
      { type: 'text', text: 'Other text here that is long enough.', page_idx: 3 },
    ]);
    expect(map).toEqual([[0, 5]]);
  });

  it('不是数组、没有正文：空表', () => {
    expect(pageMapFromContentList(markdown, null)).toEqual([]);
    expect(pageMapFromContentList('', blocks)).toEqual([]);
  });
});

describe('joinPages（本地 pdf-parse）', () => {
  it('逐页拼起来，页与页空一行，记下每页起点；空页跳过', () => {
    const { text, pageMap } = joinPages([{ num: 2, text: ' 第二页 ' }, { num: 1, text: '第一页' }, { num: 3, text: '  ' }]);
    expect(text).toBe('第一页\n\n第二页');
    expect(pageMap).toEqual([[0, 1], [5, 2]]);
  });
});

describe('pageAt / shiftPageMap', () => {
  const map: Array<[number, number]> = [[0, 1], [100, 2], [250, 3]];
  it('落在哪一页；表为空或在第一项之前为 null', () => {
    expect(pageAt(map, 0)).toBe(1);
    expect(pageAt(map, 99)).toBe(1);
    expect(pageAt(map, 100)).toBe(2);
    expect(pageAt(map, 9999)).toBe(3);
    expect(pageAt([], 5)).toBeNull();
    expect(pageAt([[10, 4]], 5)).toBeNull();
  });
  it('整体平移，挪到 0 之前的并到一起', () => {
    expect(shiftPageMap(map, 120)).toEqual([[0, 2], [130, 3]]);
    expect(shiftPageMap(null, 3)).toEqual([]);
  });
});

describe('pagesForChunks', () => {
  it('切好的片段标起止页：跨页的片段起止不同；超长段落按句子拆开、丢了空格也找得到', () => {
    const page1 = 'Idea improvement matters. '.repeat(40).trim();
    const page2 = 'Rise above means synthesis. '.repeat(80).trim();
    const { text, pageMap } = joinPages([{ num: 1, text: `# Intro\n\n${page1}` }, { num: 2, text: page2 }]);
    const chunks = chunkMarkdown(text);
    expect(chunks.length).toBeGreaterThan(1);
    const pages = pagesForChunks(text.trim(), chunks, pageMap);
    expect(pages[0].start).toBe(1);
    expect(pages[pages.length - 1].end).toBe(2);
    expect(pages.every(p => p.start !== null && p.end !== null && p.start <= p.end)).toBe(true);
  });

  it('没有对照表（Word、Markdown）：全是 null', () => {
    expect(pagesForChunks('abc', [{ content: 'abc' }], null)).toEqual([{ start: null, end: null }]);
  });
});
