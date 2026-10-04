import { describe, expect, it } from 'vitest';
import { looksLikeImage, looksLikeMarkup, sanitizeFileName, validateUpload } from './attachmentValidation';

const dataUrl = (mime: string, bytes: number[] | string) =>
  `data:${mime};base64,${Buffer.from(typeof bytes === 'string' ? bytes : Buffer.from(bytes)).toString('base64')}`;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];

describe('图片魔数', () => {
  it('认得 PNG 和 JPEG', () => {
    expect(looksLikeImage(Buffer.from(PNG))).toBe(true);
    expect(looksLikeImage(Buffer.from(JPEG))).toBe(true);
  });

  it('普通文本不是图片', () => {
    expect(looksLikeImage(Buffer.from('hello world 这是文本'))).toBe(false);
  });
});

describe('标记语言识别', () => {
  it('SVG、HTML、XML 都认得出来 —— 它们能在存储域上执行脚本', () => {
    expect(looksLikeMarkup(Buffer.from('<svg xmlns="..."><script>alert(1)</script></svg>'))).toBe(true);
    expect(looksLikeMarkup(Buffer.from('<!DOCTYPE html><html>'))).toBe(true);
    expect(looksLikeMarkup(Buffer.from('<?xml version="1.0"?>'))).toBe(true);
  });

  it('前面有空白也照样认出来', () => {
    expect(looksLikeMarkup(Buffer.from('   <svg>'))).toBe(true);
  });

  it('真图片不会被误判', () => {
    expect(looksLikeMarkup(Buffer.from(PNG))).toBe(false);
  });
});

describe('文件名清洗', () => {
  it('非 ASCII 和空格换成下划线，不会原样漏进存储路径', () => {
    expect(sanitizeFileName('我的 截图.png')).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('路径穿越字符被清掉', () => {
    expect(sanitizeFileName('../../etc/passwd')).not.toContain('/');
  });

  it('空名字给个兜底，不会生成以斜杠结尾的路径', () => {
    expect(sanitizeFileName('')).toBe('file');
  });
});

describe('求助截图上传（imagesOnly）', () => {
  const opts = { imagesOnly: true, maxBytes: 8 * 1024 * 1024 };

  it('正常 PNG 通过', () => {
    const r = validateUpload(dataUrl('image/png', PNG), 'shot.png', 'image/png', opts);
    expect(r.buffer.length).toBe(PNG.length);
    expect(r.safeName).toBe('shot.png');
  });

  it('PDF 在只收图片时被拒 —— 求助要的是「你看，长这样」', () => {
    expect(() => validateUpload(dataUrl('application/pdf', 'x'), 'a.pdf', 'application/pdf', opts)).toThrow();
  });

  it('SVG 直接拒，即使声明成图片', () => {
    expect(() => validateUpload(dataUrl('image/svg+xml', '<svg/>'), 'a.svg', 'image/svg+xml', opts)).toThrow();
  });

  it('声明 PNG 实际是 HTML 的，被字节检查拦下', () => {
    expect(() => validateUpload(
      dataUrl('image/png', '<html><script>alert(1)</script></html>'), 'evil.png', 'image/png', opts,
    )).toThrow();
  });

  it('声明 PNG 但字节既不是图片也不是标记语言，同样拒绝', () => {
    expect(() => validateUpload(dataUrl('image/png', 'MZ '), 'x.png', 'image/png', opts)).toThrow();
  });

  it('空文件拒绝', () => {
    expect(() => validateUpload('data:image/png;base64,', 'x.png', 'image/png', opts)).toThrow();
  });

  it('不是 data URL 的拒绝 —— 挡住「传个外链当附件」', () => {
    expect(() => validateUpload('https://evil.example/x.png', 'x.png', 'image/png', opts)).toThrow();
  });

  it('超过上限拒绝', () => {
    const big = dataUrl('image/png', [...PNG, ...new Array(200).fill(0)]);
    expect(() => validateUpload(big, 'x.png', 'image/png', { imagesOnly: true, maxBytes: 100 })).toThrow();
  });
});

describe('画布附件上传（默认，非 imagesOnly）', () => {
  it('PDF 放行', () => {
    expect(() => validateUpload(dataUrl('application/pdf', '%PDF-1.4'), 'a.pdf', 'application/pdf')).not.toThrow();
  });

  it('未知类型仍然拒绝', () => {
    expect(() => validateUpload(dataUrl('application/x-msdownload', 'MZ'), 'a.exe', 'application/x-msdownload')).toThrow();
  });

  it('和只收图片那条走的是同一套字节检查', () => {
    expect(() => validateUpload(dataUrl('image/png', '<svg/>'), 'x.png', 'image/png')).toThrow();
  });
});
