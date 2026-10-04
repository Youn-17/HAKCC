import { describe, expect, it } from 'vitest';
import { segmentNoteContent } from './noteSegments';

/**
 * 从文件导入的材料必须单列，不能落进 plain。
 * 一份三千字的 .md 转成笔记后若被算进 studentChars，
 * 「学生写了多少字」这个指标就假了，而且不会有任何报错。
 */
describe('导入材料的内容分层', () => {
  const importedText = '材'.repeat(300);
  const ownText = '这是我自己写的一句话。';
  const imported = `<div data-imported-from="reading.md"><p>${importedText}</p></div>`;
  const own = `<p>${ownText}</p>`;

  it('带 data-imported-from 的块归为 imported，不算学生产出', () => {
    const { segments, stats } = segmentNoteContent(imported + own);

    expect(segments.map(s => s.kind)).toEqual(['imported', 'plain']);
    expect(stats.importedChars).toBe(importedText.length);
    expect(stats.plainChars).toBe(ownText.length);
    expect(stats.studentChars).toBe(ownText.length);
    expect(stats.hasImported).toBe(true);
    expect(stats.importedSources).toEqual(['reading.md']);
  });

  it('导入材料不会被误算成 AI 内容', () => {
    const { stats } = segmentNoteContent(imported);
    expect(stats.aiChars).toBe(0);
    expect(stats.hasAi).toBe(false);
  });

  it('没有导入内容时这几个字段保持中性', () => {
    const { stats } = segmentNoteContent(own);
    expect(stats.importedChars).toBe(0);
    expect(stats.hasImported).toBe(false);
    expect(stats.importedSources).toEqual([]);
  });

  // 引用功能产出的是 <blockquote data-imported-from>，不是 <div>。
  // 块级切分只认标签白名单的话，引文会掉回 plain，学生的引用被算成自己写的。
  it('blockquote 形式的引文同样归为 imported', () => {
    const quote = '知识建构强调观点的持续改进';
    const html = `<blockquote data-imported-from="reading.md"><p>${quote}</p></blockquote>`
      + '<p><br></p><p>我的看法是……</p>';
    const { segments, stats } = segmentNoteContent(html);

    expect(segments[0].kind).toBe('imported');
    expect(segments[0].importedFrom).toBe('reading.md');
    expect(stats.importedChars).toBe(quote.length);
    expect(stats.studentChars).toBe('我的看法是……'.length);
  });

  it('importedRatio 按全文字数算', () => {
    const { stats } = segmentNoteContent(imported + own);
    expect(stats.importedRatio).toBeCloseTo(
      importedText.length / (importedText.length + ownText.length), 3);
  });
});
