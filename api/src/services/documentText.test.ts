import { describe, expect, it } from 'vitest';
import { canExtractText, extractDocumentText } from './documentText';

/** 手写一个最小 PDF，正文是给定的一行字。用真文件而不是 mock。 */
function tinyPdf(body: string): Buffer {
  const stream = `BT /F1 18 Tf 20 100 Td (${body}) Tj ET`;
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R'
    + '/Resources<</Font<</F1 5 0 R>>>>>>endobj\n'
    + `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n`
    + '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n'
    + 'trailer<</Root 1 0 R>>',
    'latin1',
  );
}

describe('文档正文提取', () => {
  it('认得出哪些类型能抽正文', () => {
    expect(canExtractText('application/pdf', 'a.pdf')).toBe(true);
    expect(canExtractText('text/markdown', 'a.md')).toBe(true);
    expect(canExtractText('', 'notes.txt')).toBe(true);
    expect(canExtractText('image/png', 'a.png')).toBe(false);
    expect(canExtractText('video/mp4', 'a.mp4')).toBe(false);
  });

  it('从 PDF 里抽出正文，并去掉 pdf-parse 附加的页码行', async () => {
    const result = await extractDocumentText(tinyPdf('Knowledge Building'), 'application/pdf', 'a.pdf');
    expect(result?.source).toBe('pdf');
    expect(result?.text).toContain('Knowledge Building');
    expect(result?.text).not.toMatch(/--\s*\d+\s+of\s+\d+\s*--/);
  });

  it('纯文本直接读出来', async () => {
    const result = await extractDocumentText(Buffer.from('第一行\n第二行'), 'text/plain', 'a.txt');
    expect(result).toEqual({ text: '第一行\n第二行', truncated: false, source: 'plain' });
  });

  // 超长文档要截断并标记：拿半篇当全篇下结论，比读不到更糟。
  it('过长的内容截断并标记 truncated', async () => {
    const long = 'x'.repeat(60_000);
    const result = await extractDocumentText(Buffer.from(long), 'text/plain', 'a.txt');
    expect(result?.truncated).toBe(true);
    expect(result!.text.length).toBeLessThanOrEqual(40_000);
  });

  // 扫描版 PDF、加密文档、损坏文件都会走到这里。上传本身是成功的，
  // 读不出内容不该让整个附件传不上去，所以返回 null 而不是抛异常。
  it('损坏或读不出的文件返回 null，不抛异常', async () => {
    await expect(
      extractDocumentText(Buffer.from('这不是一个 PDF'), 'application/pdf', 'broken.pdf'),
    ).resolves.toBeNull();
    await expect(extractDocumentText(Buffer.alloc(0), 'text/plain', 'empty.txt')).resolves.toBeNull();
  });
});
