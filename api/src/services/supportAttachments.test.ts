import { describe, expect, it } from 'vitest';
import { normalizeAttachments, MAX_SUPPORT_ATTACHMENTS } from '../routes/support';

const PREFIX = 'https://example.supabase.co/storage/v1/object/public/note-chat-attachments';
const ours = (name: string) => `${PREFIX}/support/c1/u1/${name}`;

describe('求助截图清单的清洗', () => {
  it('本平台存储里的图片放行', () => {
    const out = normalizeAttachments(
      [{ file_url: ours('a.png'), file_name: 'a.png', mime_type: 'image/png' }],
      PREFIX,
    );
    expect(out).toHaveLength(1);
    expect(out[0].file_url).toBe(ours('a.png'));
  });

  it('外链一律丢掉 —— 否则等于让人指挥教师端和 AI 去拉任意 URL', () => {
    const out = normalizeAttachments(
      [{ file_url: 'https://evil.example/x.png', file_name: 'x.png', mime_type: 'image/png' }],
      PREFIX,
    );
    expect(out).toEqual([]);
  });

  it('前缀相近但不同源的也丢掉', () => {
    const out = normalizeAttachments(
      [{ file_url: 'https://example.supabase.co.evil.example/x.png', file_name: 'x', mime_type: 'image/png' }],
      PREFIX,
    );
    expect(out).toEqual([]);
  });

  it('非图片类型丢掉，即使地址是我们自己的', () => {
    const out = normalizeAttachments(
      [{ file_url: ours('a.pdf'), file_name: 'a.pdf', mime_type: 'application/pdf' }],
      PREFIX,
    );
    expect(out).toEqual([]);
  });

  it('最多留三张，多的截断', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      file_url: ours(`${i}.png`), file_name: `${i}.png`, mime_type: 'image/png',
    }));
    expect(normalizeAttachments(many, PREFIX)).toHaveLength(MAX_SUPPORT_ATTACHMENTS);
  });

  it('不是数组、或者里面混了垃圾，都不会抛异常', () => {
    expect(normalizeAttachments(undefined, PREFIX)).toEqual([]);
    expect(normalizeAttachments('nope', PREFIX)).toEqual([]);
    expect(normalizeAttachments([null, 42, 'x'], PREFIX)).toEqual([]);
  });

  it('文件名过长会截断，不会把一整段文本塞进数据库', () => {
    const out = normalizeAttachments(
      [{ file_url: ours('a.png'), file_name: 'x'.repeat(500), mime_type: 'image/png' }],
      PREFIX,
    );
    expect(out[0].file_name.length).toBeLessThanOrEqual(200);
  });
});
