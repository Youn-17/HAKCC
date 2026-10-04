import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, notePreviewText, noteTextLength } from './noteText';
import { escapeHtmlText } from './noteHtml';

/**
 * 学生仪表盘的笔记长度、知识图谱节点预览从正文 HTML 取字。
 * 以前只去标签不解码：预览里显示 "&nbsp;"，长度里一个 &nbsp; 算 6 个字。
 */
describe('decodeHtmlEntities', () => {
  it('解码序列化器会写出的实体', () => {
    expect(decodeHtmlEntities('A&amp;B&nbsp;&lt;C&gt; &quot;D&quot; it&#39;s it&#039;s x&#160;y'))
      .toBe('A&B <C> "D" it\'s it\'s x y');
  });

  it('&amp; 最后解：字面的 "&lt;" 不会变成 "<"', () => {
    expect(decodeHtmlEntities('&amp;lt; &amp;gt; &amp;amp; &amp;nbsp; &amp;quot;'))
      .toBe('&lt; &gt; &amp; &nbsp; &quot;');
  });

  it('是服务端拼正文时转义的反方向', () => {
    for (const text of ['a < b & c > d', '字面写着 &lt; 和 &amp;', '"引号" 与 \'撇号\'']) {
      expect(decodeHtmlEntities(escapeHtmlText(text))).toBe(text);
    }
  });
});

describe('notePreviewText', () => {
  it('去标签、解码、合并空白', () => {
    expect(notePreviewText('<p>差异。&nbsp;这中间</p><p>R&amp;D</p><p>&nbsp;</p>')).toBe('差异。 这中间 R&D');
  });

  it('预览里不出现实体写法', () => {
    const preview = notePreviewText('<p>A&nbsp;&nbsp;B &quot;C&quot;</p>');
    expect(preview).not.toMatch(/&(nbsp|quot|amp|lt|gt);/);
  });

  it('空正文', () => {
    expect(notePreviewText(null)).toBe('');
    expect(notePreviewText(undefined)).toBe('');
  });
});

describe('noteTextLength（学生仪表盘「N 字」、平均长度）', () => {
  it('一个实体算一个字', () => {
    expect(noteTextLength('<p>差异。&nbsp;这中间</p>')).toBe(7);
    expect(noteTextLength('<p>A&amp;B &lt;C&gt;</p>')).toBe(7);
    expect(noteTextLength('<p>&quot;引号&quot;</p>')).toBe(4);
  });

  it('字面的 "&lt;" 仍是 4 个字', () => {
    expect(noteTextLength('<p>&amp;lt;</p>')).toBe(4);
  });

  it('其余口径不变：标签去掉不补空格', () => {
    expect(noteTextLength('<p>第一段</p><p>第二段</p>')).toBe(6);
    expect(noteTextLength('<p>a b</p>')).toBe(3);
    expect(noteTextLength(null)).toBe(0);
  });
});
