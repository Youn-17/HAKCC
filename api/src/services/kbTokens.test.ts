import { describe, expect, it } from 'vitest';
import { kbQueryTerms, kbSearchFields, kbTokens } from './kbTokens';

/** 关键词检索的分词：中文与英文分词规则（中文分词 + 双字，英文去虚词，中文单字不要） */

describe('kbTokens', () => {
  it('中文：分出的词加上每两个相邻汉字，单字不要', () => {
    const tokens = kbTokens('知识建构');
    expect(tokens).toEqual(expect.arrayContaining(['#知识', '#识建', '#建构']));
    expect(tokens.every(t => t.replace('#', '').length >= 2)).toBe(true);
  });

  it('英文：转小写，去掉常用虚词，保留重复（词频要用）', () => {
    const tokens = kbTokens('The Idea improvement of ideas and the IDEA');
    expect(tokens).toEqual(['idea', 'improvement', 'ideas', 'idea']);
  });

  it('中英混排、标点和空白不算词', () => {
    expect(kbTokens('  ，。！ ')).toEqual([]);
    expect(kbTokens('Rise Above 讨论')).toEqual(expect.arrayContaining(['rise', 'above', '#讨论']));
  });
});

describe('kbSearchFields', () => {
  it('标题路径和正文一起算，词序列空格连起来，词数一起存', () => {
    const fields = kbSearchFields('角色与组织结构', '教师负责引导');
    expect(fields.search_text.split(' ')).toEqual(expect.arrayContaining(['#角色', '#教师', '#引导']));
    expect(fields.search_len).toBe(fields.search_text.split(' ').length);
  });
});

describe('kbQueryTerms', () => {
  it('去重，去掉「什么」「我们」这类提问套话', () => {
    const terms = kbQueryTerms('我们小组的观点改进是什么？观点改进怎么做');
    expect(terms).toEqual(expect.arrayContaining(['#观点', '#改进']));
    expect(terms).not.toContain('#什么');
    expect(terms).not.toContain('#我们');
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('全是套话：没有检索词', () => {
    expect(kbQueryTerms('是什么？')).toEqual([]);
  });
});
