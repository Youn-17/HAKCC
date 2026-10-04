import { describe, it, expect } from 'vitest';
import { notePlainParagraphs, notePreviewText, noteSearchText, noteWordCount } from './noteText';
import * as backend from '../api/src/services/noteText';

/**
 * 从正文 HTML 里取字：预览、字数、搜索。
 *
 * 正文是 HTML 序列化器写的，文字里的 & < > 和不换行空格都存成实体；编辑器里连打两个空格、
 * 段首空格都会变成 &nbsp;。只去标签不解码，侧栏字数把 &nbsp; 当成一个词，
 * 手机端搜索比的是标签和属性，预览里直接显示 "&nbsp;"。
 */
describe('notePreviewText', () => {
  it('实体解码成字', () => {
    expect(notePreviewText('<p>A&amp;B&nbsp;&lt;tag&gt; &quot;q&quot; it&#39;s it&#039;s x&#160;y</p>'))
      .toBe('A&B <tag> "q" it\'s it\'s x y');
  });

  it('作者写下的字面 "&lt;" 存成 "&amp;lt;"，只解一层', () => {
    expect(notePreviewText('<p>&amp;lt;b&amp;gt; &amp;amp; &amp;nbsp; &amp;quot;</p>'))
      .toBe('&lt;b&gt; &amp; &nbsp; &quot;');
  });
});

describe('noteWordCount（侧栏「字数」）', () => {
  it('&nbsp; 不算词', () => {
    expect(noteWordCount('<p>one &nbsp; two</p>')).toBe(2);
    expect(noteWordCount('<p>&nbsp;</p>')).toBe(0);
  });

  it('其他实体也不算词', () => {
    expect(noteWordCount('<p>salt &amp; pepper &quot;fresh&quot;</p>')).toBe(3);
  });

  it('&amp;lt; 不会被解成 "<"', () => {
    expect(noteWordCount('<p>&amp;lt;</p>')).toBe(1);
  });

  it('中文按字算，和编辑器底栏一致', () => {
    expect(noteWordCount('<p>光合作用需要光。</p>')).toBe(7);
    expect(noteWordCount('<p>我认为&nbsp;AI tools&nbsp;很有用</p>')).toBe(8);
  });

  it('段落之间不粘成一个词', () => {
    expect(noteWordCount('<p>first</p><p>second</p>')).toBe(2);
  });

  it('空正文是 0', () => {
    expect(noteWordCount(undefined)).toBe(0);
    expect(noteWordCount(null)).toBe(0);
    expect(noteWordCount('')).toBe(0);
  });
});

describe('noteSearchText（手机端笔记搜索）', () => {
  const scaffold = '<p data-scaffold-id="kb-my-theory" data-scaffold-title="我的理论"><strong data-scaffold-tag="">我的理论</strong>'
    + '<span data-scaffold-slot=""><span style="color: rgb(34, 87, 122);">光合作用需要光</span></span></p>';

  it('标签名、属性不参与匹配', () => {
    const text = noteSearchText(scaffold);
    for (const markup of ['span', 'scaffold', 'strong', 'color', 'data-', 'rgb']) {
      expect(text.includes(markup), markup).toBe(false);
    }
    expect(text.includes('光合作用需要光')).toBe(true);
  });

  it('按看得见的字匹配实体', () => {
    const text = noteSearchText('<p>R&amp;D&nbsp;部门 &lt;br&gt;</p>');
    expect(text.includes('r&d 部门')).toBe(true);
    expect(text.includes('<br>')).toBe(true);
    expect(text.includes('amp')).toBe(false);
    expect(text.includes('nbsp')).toBe(false);
  });

  it('不区分大小写', () => {
    expect(noteSearchText('<p>ChatGPT</p>').includes('chatgpt')).toBe(true);
  });
});

describe('前后端同一规则', () => {
  const samples = [
    '<p>差异。&nbsp;这中间</p><p>&nbsp;</p>',
    '<p>A&amp;B &lt;C&gt; &quot;D&quot; it&#39;s x&#160;y</p>',
    '<p>&amp;lt;b&amp;gt; &amp;amp;</p>',
    '<p>first</p><p>second</p><script>alert(1)</script><style>p{}</style>',
    '<div data-ai-source="genai"><p>AI 给的例子</p></div><p>我的<b>想法</b></p>',
    '',
  ];

  it.each(samples)('%s', html => {
    expect(backend.notePreviewText(html)).toBe(notePreviewText(html));
  });
});

describe('notePlainParagraphs：详情栏里的长文要分段', () => {
  it('段落、换行、列表各自成行，空段不留成一串空行', () => {
    const html = '<p>第一段，<b>加粗</b>的字不断开。</p>\n<p>&nbsp;</p><p>第二段<br>第二行</p><ul><li>要点一</li><li>要点二</li></ul>';
    expect(notePlainParagraphs(html)).toBe('第一段，加粗的字不断开。\n\n第二段\n第二行\n\n• 要点一\n• 要点二');
  });

  it('支架标记夹在句子中间不补空格；实体照样解码', () => {
    const html = '<p><span data-scaffold-id="s1">我的想法是</span>[学生与AI如何互动] A&amp;B&nbsp;C</p>';
    expect(notePlainParagraphs(html)).toBe('我的想法是[学生与AI如何互动] A&B C');
  });

  it('空正文和脚本', () => {
    expect(notePlainParagraphs('')).toBe('');
    expect(notePlainParagraphs(null)).toBe('');
    expect(notePlainParagraphs('<p>正文</p><script>alert(1)</script>')).toBe('正文');
  });
});
