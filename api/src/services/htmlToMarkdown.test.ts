import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from './htmlToMarkdown';

describe('htmlToMarkdown', () => {
  it('标题按层级转成 #', () => {
    expect(htmlToMarkdown('<h1>标题一</h1><h3>标题三</h3>')).toBe('# 标题一\n\n### 标题三');
  });

  it('段落之间留空行', () => {
    expect(htmlToMarkdown('<p>第一段</p><p>第二段</p>')).toBe('第一段\n\n第二段');
  });

  it('加粗与斜体', () => {
    expect(htmlToMarkdown('<p>这是<strong>重点</strong>和<em>强调</em></p>')).toBe('这是**重点**和*强调*');
  });

  it('无序与有序列表，有序列表编号连续', () => {
    expect(htmlToMarkdown('<ul><li>甲</li><li>乙</li></ul>')).toBe('- 甲\n- 乙');
    expect(htmlToMarkdown('<ol><li>甲</li><li>乙</li><li>丙</li></ol>')).toBe('1. 甲\n2. 乙\n3. 丙');
  });

  it('嵌套列表按层缩进', () => {
    const md = htmlToMarkdown('<ul><li>外层<ul><li>内层</li></ul></li></ul>');
    expect(md).toContain('- 外层');
    expect(md).toContain('  - 内层');
  });

  it('链接保留地址', () => {
    expect(htmlToMarkdown('<p>见<a href="https://example.org">这里</a>。</p>'))
      .toBe('见[这里](https://example.org)。');
  });

  it('表格转成 markdown 表格，首行后补分隔行', () => {
    const md = htmlToMarkdown('<table><tr><th>姓名</th><th>角色</th></tr><tr><td>李晓明</td><td>学生</td></tr></table>');
    expect(md).toContain('| 姓名 | 角色 |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| 李晓明 | 学生 |');
  });

  it('HTML 实体解码，且 &amp;lt; 不会被二次解码成 <', () => {
    expect(htmlToMarkdown('<p>a &amp; b</p>')).toBe('a & b');
    expect(htmlToMarkdown('<p>&amp;lt;script&amp;gt;</p>')).toBe('&lt;script&gt;');
  });

  it('script / style 整块丢弃', () => {
    expect(htmlToMarkdown('<p>正文</p><script>alert(1)</script><style>p{}</style>')).toBe('正文');
  });

  it('内嵌 data: 图片只留占位，不把几 MB 的字节塞进正文', () => {
    const md = htmlToMarkdown('<p><img src="data:image/png;base64,AAAA" alt="图1"></p>');
    expect(md).toBe('![图1]');
    expect(md).not.toContain('base64');
  });

  it('外链图片保留地址', () => {
    expect(htmlToMarkdown('<p><img src="https://x.org/a.png" alt="图"></p>')).toBe('![图](https://x.org/a.png)');
  });

  it('正文里的星号被转义，不会变成强调', () => {
    expect(htmlToMarkdown('<p>3 * 4 = 12</p>')).toBe('3 \\* 4 = 12');
  });

  it('引用块', () => {
    expect(htmlToMarkdown('<blockquote>一句话</blockquote>')).toBe('> 一句话');
  });

  it('空输入返回空串', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   ')).toBe('');
  });
});
