import { describe, expect, it } from 'vitest';
import { extractConceptsScored } from './conceptExtraction';

/**
 * 观点图谱用的区分度模式（2026-10-11 补）：疑问词、套话不上图；从更长说法里切出来的半截词
 * （「老|师的角色」「教|师的角色」→「师的角色」，「取|代教师」「替|代教师」→「代教师」）不上图；
 * 「的认知卸载」这种贴着虚字的照常保留；默认模式（学生个人知识图谱）不受影响。
 */

const doc = (id: string, text: string, title = '') => ({ id, title, text });

const docs = [
  doc('1', '我们讨论老师的角色会不会改变，有人说会取代教师，哪些依据'),
  doc('2', '教师的角色变化很大，也有人说是替代教师，哪些工作要人做'),
  doc('3', '老师上课常用提问引导，教师也要学会提问引导'),
  doc('4', '机器取代不了人的判断，替代品也有局限，认知卸载要小心'),
  doc('5', '我觉得的认知卸载很常见，认知卸载会不会让人变懒'),
  doc('6', '关于的认知卸载，提问引导的方式可以减少认知卸载'),
  doc('7', '另一条笔记谈到老师和教师在提问引导里的不同'),
];

describe('区分度模式的过滤', () => {
  it('默认模式下这批笔记会抽出半截词（说明数据确实会触发）', () => {
    const terms = [...extractConceptsScored(docs, 40).keys()];
    expect(terms.some(t => t === '师的角色' || t === '代教师')).toBe(true);
  });

  it('区分度模式：半截词、疑问词、套话不上图，真观点照常留下', () => {
    const terms = [...extractConceptsScored(docs, 18, { discriminative: true }).keys()];
    expect(terms).toContain('认知卸载');
    expect(terms).toContain('提问引导');
    for (const bad of ['师的角色', '代教师', '哪些', '方式']) expect(terms).not.toContain(bad);
  });
});
