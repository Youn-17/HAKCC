import { describe, expect, it } from 'vitest';
import { buildRetrievalQuery } from './kbQuery';

/** 笔记 AI 的检索词：追问补上前两句提问和笔记标题，意思完整的长问题保持原样 */

describe('buildRetrievalQuery', () => {
  const earlier = ['知识建构的十二条原则有哪些？', '其中「观点多样性」怎么理解？'];

  it('意思完整的长问题：原样拿去查，不补上文', () => {
    const q = '知识建构理论里，教师在社区中的角色和传统课堂有什么不同？';
    expect(buildRetrievalQuery(q, earlier, '我的研究计划')).toBe(q);
  });

  it('很短的追问：补上前两句提问（近的在前）和笔记标题', () => {
    expect(buildRetrievalQuery('那第二点呢？', earlier, '小组讨论记录')).toBe(
      '那第二点呢？\n（接着问：其中「观点多样性」怎么理解？；知识建构的十二条原则有哪些？）\n（笔记：小组讨论记录）',
    );
  });

  it('不算短、但带着指代上文的说法：也补', () => {
    const q = '能不能结合我们小组刚才说的那个访谈设计，再具体展开讲讲这个原则？';
    expect(q.length).toBeLessThanOrEqual(60);
    expect(buildRetrievalQuery(q, earlier, null)).toContain('（接着问：');
  });

  it('没有更早的提问、笔记没起标题：只剩这一句', () => {
    expect(buildRetrievalQuery('为什么？', [], 'Untitled Note')).toBe('为什么？');
    expect(buildRetrievalQuery('为什么？', ['  '], '')).toBe('为什么？');
  });

  it('总长不超过 500 字，单句上文截到 120 字', () => {
    const long = '观'.repeat(400);
    const q = buildRetrievalQuery('然后呢', [long, long], '题'.repeat(300));
    expect(q.length).toBeLessThanOrEqual(500);
    expect(q).toContain('观'.repeat(120));
    expect(q).not.toContain('观'.repeat(121));
    expect(buildRetrievalQuery('问'.repeat(600), [], null)).toHaveLength(500);
  });
});
