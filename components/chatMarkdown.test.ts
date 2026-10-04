import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownMessage, readTable, splitTableRow } from './chatMarkdown';

const render = (content: string) =>
  renderToStaticMarkup(React.createElement(MarkdownMessage, { content }));

describe('AI 回复的 Markdown 渲染', () => {
  // 这条分支以前整个不存在：图片语法会被拆成一个孤立的 "!" 加一条普通链接，
  // generate_image 明明生成成功了，学生却永远看不到图。
  it('renders ![alt](url) as an image instead of a stray "!" plus a link', () => {
    const html = render('这是结果：\n![小组协作示意](https://cdn.example.com/a.png)');

    expect(html).toContain('<img');
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    expect(html).toContain('alt="小组协作示意"');
    expect(html).not.toContain('<a href="https://cdn.example.com/a.png"');
  });

  // 生图接口有时只回 b64，没有 url。data: 源不认的话，整串 base64 会当纯文本吐出来。
  it('renders base64 data: image sources', () => {
    const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const html = render(`![](${src})`);

    expect(html).toContain('<img');
    expect(html).toContain(`src="${src}"`);
  });

  it('keeps ordinary links as links', () => {
    const html = render('见 [这篇论文](https://example.org/paper)');

    expect(html).toContain('<a href="https://example.org/paper"');
    expect(html).not.toContain('<img');
  });

  // 图片 src 来自模型输出，非 http(s)/data: 的协议不能进 DOM。
  // 落到纯文本是可以的——React 会转义，既不可点也不执行；不能出现的是
  // 带这种协议的 <img src> 或 <a href>。
  it('never turns a non-http, non-data source into an img or link', () => {
    const html = render('![x](javascript:alert(1))');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('src="javascript:');
  });

  it('still renders bold, code and bare urls', () => {
    const html = render('**重点** 和 `code` 还有 https://example.com/x');

    expect(html).toContain('<strong');
    expect(html).toContain('<code');
    expect(html).toContain('<a href="https://example.com/x"');
  });

  // 模型最常用表格来对比概念。以前没有这条分支，学生看到的是一行行带竖线的原文。
  describe('表格', () => {
    const table = [
      '通常包括以下几个：',
      '| 要素 | 含义 | 例子 |',
      '|---|---|---|',
      '| 分解 | 把复杂问题拆成更小的问题 | 把“办一场活动”拆成场地、预算 |',
      '| 抽象 | 忽略无关细节 | 把城市交通抽象成“节点—边”的图 |',
      '',
      '后面是正文。',
    ].join('\n');

    it('renders a pipe table as a real table, with no raw pipes left', () => {
      const html = render(table);
      expect(html).toContain('<table');
      expect((html.match(/<th[ >]/g) ?? []).length).toBe(3);
      expect((html.match(/<tr[ >]/g) ?? []).length).toBe(3);
      expect(html).toContain('把城市交通抽象成“节点—边”的图');
      expect(html).not.toContain('|');
      expect(html).not.toContain('---');
      expect(html).toContain('后面是正文。');
    });

    it('scrolls sideways inside its own box instead of stretching the chat bubble', () => {
      expect(render(table)).toContain('overflow-x-auto');
    });

    it('reads alignment, tolerates missing outer pipes and short rows', () => {
      const parsed = readTable(['a | b | c', ':--|:-:|--:', '1 | 2', '| x | y | z | extra |'], 0)!;
      expect(parsed.align).toEqual(['left', 'center', 'right']);
      expect(parsed.rows).toEqual([['1', '2', ''], ['x', 'y', 'z']]);
    });

    it('keeps escaped pipes and pipes inside inline code within one cell', () => {
      expect(splitTableRow('| a \\| b | `x | y` | c |')).toEqual(['a | b', '`x | y`', 'c']);
    });

    // 流式输出时表头先到、分隔行后到；也防止把含竖线的普通句子画成表
    it('does not draw a table until the separator row is there', () => {
      expect(render('| 要素 | 含义 |')).not.toContain('<table');
      expect(render('选 A | B 都可以\n下一句')).not.toContain('<table');
    });

    it('formats bold and code inside cells', () => {
      const html = render('| 名称 | 说明 |\n|---|---|\n| **分解** | 用 `split` |');
      expect(html).toMatch(/<td[^>]*><strong/);
      expect(html).toContain('<code');
    });
  });

  it('renders fenced code verbatim: pipes and hashes inside are not parsed', () => {
    const html = render('```python\n# 注释\na = b | c\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('# 注释');
    expect(html).toContain('a = b | c');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('<h');
  });

  it('keeps ordered lists numbered and does not mistake a decimal for a list', () => {
    const html = render('1. 第一\n2. 第二');
    expect(html).toContain('<ol');
    expect((html.match(/<li/g) ?? []).length).toBe(2);
    expect(render('3.14 是圆周率')).not.toContain('<ol');
  });

  it('renders headings of every level, and block quotes', () => {
    const html = render('# 一级\n#### 四级\n> 引用的话');
    expect(html).not.toContain('# ');
    expect(html).toMatch(/<h2[^>]*>一级/);
    expect(html).toMatch(/<h4[^>]*>四级/);
    expect(html).toContain('<blockquote');
    expect(html).not.toContain('&gt; 引用');
  });

  // 模型写的 HTML 只能当文字显示
  it('never lets model-written html through', () => {
    const html = render('| a |\n|---|\n| <img src=x onerror=alert(1)> |\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
  });
});
