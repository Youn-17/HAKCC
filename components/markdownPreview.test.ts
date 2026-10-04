// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * .md 附件预览的渲染契约。文件是学生上传的，marked 出的是原始 HTML，
 * 一份构造过的 .md 里可以塞 <script> 或 onerror —— 消毒失效就是 XSS。
 */
const render = (md: string) =>
  DOMPurify.sanitize(marked.parse(md, { async: false, gfm: true, breaks: true }) as string, {
    ADD_ATTR: ['target', 'rel'],
  });

describe('Markdown 预览渲染', () => {
  it('渲染文档常用结构（聊天那个极简渲染器撑不起这些）', () => {
    const html = render([
      '# 一级标题',
      '',
      '> 引用',
      '',
      '| 列一 | 列二 |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '- [ ] 待办',
    ].join('\n'));

    expect(html).toContain('<h1>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<table>');
    expect(html).toContain('<pre>');
    expect(html).toContain('type="checkbox"');
  });

  it('剥掉 script 标签', () => {
    const html = render('正常文字\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('正常文字');
  });

  it('剥掉事件处理属性', () => {
    const html = render('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('剥掉 javascript: 协议的链接', () => {
    const html = render('[点我](javascript:alert(1))');
    expect(html).not.toContain('javascript:alert');
  });

  it('正常的图片和链接保留', () => {
    const html = render('![图](https://example.com/a.png) 和 [链接](https://example.com)');
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain('href="https://example.com"');
  });
});
