import { describe, it, expect } from 'vitest';
import { PHILOSOPHY_SECTIONS, REFERENCES } from './philosophyContent';

/**
 * 这页的可信度全靠引用站得住。这些测试挡的是编辑时最容易犯的错：
 * 引了一个不存在的 id、留下一条没人引用的文献、DOI 少了个字符。
 */
describe('平台理念内容', () => {
  const ids = REFERENCES.map(r => r.id);

  it('public rationale contains published sources rather than private submissions', () => {
    expect(JSON.stringify(REFERENCES)).not.toMatch(/under review|投稿中|not yet peer-reviewed|尚未经同行评议/i);
  });

  it('文献 id 唯一 —— 重复会让锚点和查找认错', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条主张引用的文献都存在', () => {
    const missing: string[] = [];
    for (const s of PHILOSOPHY_SECTIONS) for (const p of s.principles) for (const id of p.refs) {
      if (!ids.includes(id)) missing.push(`${s.id}: ${id}`);
    }
    expect(missing).toEqual([]);
  });

  it('每条文献至少被一条主张引用 —— 没人引用的文献不该出现在总表里', () => {
    const used = new Set(PHILOSOPHY_SECTIONS.flatMap(s => s.principles.flatMap(p => p.refs)));
    expect(ids.filter(id => !used.has(id))).toEqual([]);
  });

  it('每条文献都写明「说了什么」和「我们据此做了什么」，中英都有', () => {
    for (const r of REFERENCES) {
      for (const f of [r.said, r.applied]) {
        expect(f.zh.trim().length, r.id).toBeGreaterThan(20);
        expect(f.en.trim().length, r.id).toBeGreaterThan(20);
      }
    }
  });

  it('DOI 形如 10.xxxx/… ，不带 https 前缀', () => {
    for (const r of REFERENCES) if (r.doi) expect(r.doi, r.id).toMatch(/^10\.\d{4,9}\/\S+$/);
  });

  it('每条文献都能点开：有 DOI 或有 URL（只有书和未出版稿例外）', () => {
    const noLink = REFERENCES.filter(r => !r.doi && !r.url);
    // 部分历史书籍和已发表文章没有稳定的在线链接
    expect(noLink.map(r => r.id).sort()).toEqual(['bakeman2011', 'bereiter2002', 'garrison2000', 'hannafin1999', 'risko2016', 'toulmin1958', 'turing1950'].sort());
  });

  it('reference status annotations, when present, are bilingual', () => {
    for (const reference of REFERENCES.filter(r => r.status)) {
      expect(reference.status!.zh.trim()).not.toBe('');
      expect(reference.status!.en.trim()).not.toBe('');
    }
  });

  it('章节编号连续', () => {
    expect(PHILOSOPHY_SECTIONS.map(s => s.num)).toEqual(PHILOSOPHY_SECTIONS.map((_, i) => String(i + 1).padStart(2, '0')));
  });
});
