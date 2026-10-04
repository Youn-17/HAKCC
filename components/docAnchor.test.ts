// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { addHeadingIds, findQuoteRange, MAX_QUOTE_LENGTH } from './docAnchor';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('addHeadingIds', () => {
  it('给 h1~h3 加 id 并抽出目录', () => {
    const { html, outline } = addHeadingIds('<h1>标题一</h1><p>正文</p><h2>标题二</h2><h4>不计入</h4>');
    expect(outline.map(o => o.text)).toEqual(['标题一', '标题二']);
    expect(outline.map(o => o.level)).toEqual([1, 2]);
    expect(html).toContain('id="md-h-0"');
    expect(html).toContain('id="md-h-1"');
    expect(html).not.toContain('<h4 id=');
  });

  it('跳过空标题，不产生无字的目录项', () => {
    const { outline } = addHeadingIds('<h1></h1><h2>   </h2><h2>有字</h2>');
    expect(outline).toHaveLength(1);
    expect(outline[0].text).toBe('有字');
  });
});

describe('findQuoteRange', () => {
  it('在单个文本节点里找回引文', () => {
    const host = mount('<p>判断标准如果只看输出，我们要如何区分会装作理解和真的理解？</p>');
    const range = findQuoteRange(host, '我们要如何区分');
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('我们要如何区分');
  });

  it('引文跨越行内标签时仍能找回（中间夹着 <strong>）', () => {
    const host = mount('<p>统计匹配和<strong>理解</strong>之间还剩下什么区别</p>');
    const range = findQuoteRange(host, '统计匹配和理解之间');
    expect(range).not.toBeNull();
    expect(range!.toString().replace(/\s+/g, '')).toBe('统计匹配和理解之间');
  });

  it('原文换行缩进与引文空白不一致时也能对上', () => {
    const host = mount('<p>The claim rests\n   on a single   model generation.</p>');
    const range = findQuoteRange(host, 'rests on a single model generation');
    expect(range).not.toBeNull();
  });

  it('找不到就返回 null，让调用方显示「原文已修改」', () => {
    const host = mount('<p>这段话里没有那句引文</p>');
    expect(findQuoteRange(host, '一句根本不存在的引文')).toBeNull();
  });

  it('空引文返回 null，不当作匹配到了开头', () => {
    const host = mount('<p>任意内容</p>');
    expect(findQuoteRange(host, '   ')).toBeNull();
  });

  it('同一段里重复出现时命中第一处', () => {
    const host = mount('<p>要点一。要点一。</p>');
    const range = findQuoteRange(host, '要点一');
    expect(range!.startOffset).toBe(0);
  });

  it('跨段落的引文不会误配到别处', () => {
    const host = mount('<p>第一段结尾</p><p>第二段开头</p>');
    // 两段之间没有空白字符相连，压平后是「第一段结尾第二段开头」
    expect(findQuoteRange(host, '结尾第二段')).not.toBeNull();
  });

  it('引文长度上限是个正数，够定位又不至于撑爆卡片', () => {
    expect(MAX_QUOTE_LENGTH).toBeGreaterThan(50);
    expect(MAX_QUOTE_LENGTH).toBeLessThanOrEqual(500);
  });
});
