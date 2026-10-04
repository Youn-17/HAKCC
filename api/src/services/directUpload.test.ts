import { describe, expect, it } from 'vitest';
import { validateDeclaredUpload, verifyStoredBytes } from './attachmentValidation';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('签发阶段：只看声明，不看字节', () => {
  it('常规图片放行，文件名清洗过', () => {
    const r = validateDeclaredUpload('我的 截图.png', 'image/png');
    expect(r.isImage).toBe(true);
    expect(r.safeName).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('视频和 PDF 放行 —— 直传就是为了这类大文件', () => {
    expect(() => validateDeclaredUpload('lecture.mp4', 'video/mp4')).not.toThrow();
    expect(() => validateDeclaredUpload('slides.pdf', 'application/pdf')).not.toThrow();
  });

  it('SVG / HTML 在签发阶段就拒，不必等它传上去', () => {
    expect(() => validateDeclaredUpload('a.svg', 'image/svg+xml')).toThrow();
    expect(() => validateDeclaredUpload('a.html', 'text/html')).toThrow();
  });

  it('未知类型拒绝', () => {
    expect(() => validateDeclaredUpload('a.exe', 'application/x-msdownload')).toThrow();
  });

  it('imagesOnly 时只放图片', () => {
    expect(() => validateDeclaredUpload('a.mp4', 'video/mp4', { imagesOnly: true })).toThrow();
    expect(() => validateDeclaredUpload('a.png', 'image/png', { imagesOnly: true })).not.toThrow();
  });
});

describe('落盘之后：只看字节，不信声明', () => {
  it('真 PNG 通过', () => {
    expect(() => verifyStoredBytes(PNG, 'image/png')).not.toThrow();
  });

  it('声明 PNG 实际是 HTML 的被拦下 —— 这正是直传丢掉、必须补回的那道检查', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(() => verifyStoredBytes(html, 'image/png')).toThrow();
  });

  it('伪装成图片的 SVG 被拦下', () => {
    expect(() => verifyStoredBytes(Buffer.from('<svg xmlns="..."/>'), 'image/png')).toThrow();
  });

  it('声明 PNG 但字节既不是图片也不是标记语言，同样拒绝', () => {
    expect(() => verifyStoredBytes(Buffer.from('MZ\\x90\\x00'), 'image/png')).toThrow();
  });

  it('非图片类型不做魔数比对，但仍然拦标记语言', () => {
    // PDF 的字节我们不逐一校验（格式太多），但 HTML 伪装成 PDF 一样要拦
    expect(() => verifyStoredBytes(Buffer.from('%PDF-1.4'), 'application/pdf')).not.toThrow();
    expect(() => verifyStoredBytes(Buffer.from('<!DOCTYPE html>'), 'application/pdf')).toThrow();
  });
});
