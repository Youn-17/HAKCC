import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from './kbChunker';

const para = (n: number) => `第 ${n} 段。判断标准如果只看输出，我们要如何区分「会装作理解」和「真的理解」？统计匹配与理解之间还剩下什么区别，这一点需要一个可操作的判据，否则讨论只会停在措辞上。`;

describe('chunkMarkdown', () => {
  it('空文档不产生片段', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });

  it('标题是切分边界，不同节不会混进同一片', () => {
    const md = `# 一\n\n${para(1)}\n\n# 二\n\n${para(2)}`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('第 1 段');
    expect(chunks[0].content).not.toContain('第 2 段');
    expect(chunks[1].content).toContain('第 2 段');
  });

  it('标题路径记录层级，检索命中时能说清出自哪一节', () => {
    const md = `# 三、角色与组织结构\n\n## 教师\n\n${para(1)}`;
    const [chunk] = chunkMarkdown(md);
    expect(chunk.headingPath).toBe('三、角色与组织结构 › 教师');
  });

  it('回到上一级标题时，下一级的路径不会残留', () => {
    const md = `# A\n\n## A1\n\n${para(1)}\n\n# B\n\n${para(2)}`;
    const chunks = chunkMarkdown(md);
    expect(chunks[0].headingPath).toBe('A › A1');
    expect(chunks[1].headingPath).toBe('B');
  });

  it('长小节被切成多片，每片都不为空且带同一个标题路径', () => {
    const md = `# 长节\n\n` + Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n');
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.headingPath === '长节')).toBe(true);
    expect(chunks.every(c => c.content.trim().length > 0)).toBe(true);
  });

  it('切开的位置在段落或句末，不会从半句话开始', () => {
    const md = `# 节\n\n` + Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n');
    for (const c of chunkMarkdown(md)) {
      expect(c.content.startsWith('第')).toBe(true);
    }
  });

  it('没有标点的超长串也能切开，不会无限堆积', () => {
    const md = '啊'.repeat(5000);
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(2);
    expect(Math.max(...chunks.map(c => c.content.length))).toBeLessThanOrEqual(1600);
  });

  it('过短的碎片被丢弃：孤零零一个标题不该占一片', () => {
    expect(chunkMarkdown('# 只有标题\n\n## 还是标题')).toEqual([]);
    expect(chunkMarkdown('# 标题\n\n短。')).toEqual([]);
  });

  it('没有标题的纯文本按段落切，路径为 null', () => {
    const chunks = chunkMarkdown([para(1), para(2), para(3)].join('\n\n'));
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].headingPath).toBeNull();
  });

  it('ordinal 连续且从 0 开始 —— 入库后靠它还原文档顺序', () => {
    const md = `# A\n\n${para(1)}\n\n# B\n\n${para(2)}\n\n# C\n\n${para(3)}`;
    expect(chunkMarkdown(md).map(c => c.ordinal)).toEqual([0, 1, 2]);
  });
});
