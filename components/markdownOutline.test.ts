// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * 目录抽取。id 是在**消毒之后**才加的——DOMPurify 负责剔掉危险内容，
 * 锚点由我们生成、不来自文件，所以不会把风险加回去。
 * 这里把 FileViewerModal 里的规则复刻出来锁住。
 */
type OutlineItem = { id: string; text: string; level: number };

function buildOutline(md: string): { html: string; outline: OutlineItem[] } {
  const clean = DOMPurify.sanitize(marked.parse(md, { async: false, gfm: true, breaks: true }) as string);
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  const items: OutlineItem[] = [];
  const used = new Set<string>();
  doc.querySelectorAll('h1, h2, h3').forEach((el, index) => {
    const text = (el.textContent ?? '').trim();
    if (!text) return;
    let id = `md-h-${index}`;
    while (used.has(id)) id = `${id}-x`;
    used.add(id);
    el.setAttribute('id', id);
    items.push({ id, text, level: Number(el.tagName.slice(1)) });
  });
  return { html: doc.body.innerHTML, outline: items };
}

describe('Markdown 目录', () => {
  it('抽出 h1–h3 并带上层级', () => {
    const { outline } = buildOutline('# 一\n\n## 二\n\n### 三\n\n正文');
    expect(outline.map(i => [i.text, i.level])).toEqual([['一', 1], ['二', 2], ['三', 3]]);
  });

  it('h4 以下不进目录，否则长文档的目录比正文还长', () => {
    const { outline } = buildOutline('# 一\n\n#### 四级');
    expect(outline).toHaveLength(1);
  });

  it('每个标题都拿到唯一 id，且写回了 HTML', () => {
    const { html, outline } = buildOutline('# 重复\n\n## 重复\n\n### 重复');
    expect(new Set(outline.map(i => i.id)).size).toBe(3);
    for (const item of outline) expect(html).toContain(`id="${item.id}"`);
  });

  it('没有标题时目录为空，不是崩掉', () => {
    expect(buildOutline('就一段话，没有任何标题。').outline).toEqual([]);
  });

  // 标题里塞脚本：消毒在加 id 之前，脚本早已被剔掉
  it('标题里的脚本不会因为加 id 而复活', () => {
    const { html, outline } = buildOutline('# 标题<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(outline[0].text).toContain('标题');
  });
});
