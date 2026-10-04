import { describe, expect, it } from 'vitest';

/**
 * /attachments/extract-text 会用**服务端身份**去 fetch 传进来的地址。
 * 放开任意 URL 就是一个现成的 SSRF 跳板（内网地址、云元数据服务等）。
 * 端点里的判断是「必须以我们 bucket 的公开前缀开头」，这里把这条规则
 * 复刻出来单测——它一旦被放宽，不会有任何报错，但会开一个洞。
 */
const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/note-chat-attachments';
const allowed = (url: string) => url.startsWith(PREFIX);

describe('附件正文读取的地址限制', () => {
  it('放行本平台存储里的附件', () => {
    expect(allowed(`${PREFIX}/spaces/c/s/1-a.md`)).toBe(true);
  });

  it('挡掉内网地址', () => {
    expect(allowed('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(allowed('http://localhost:4000/api/health')).toBe(false);
    expect(allowed('http://127.0.0.1:5432')).toBe(false);
    expect(allowed('http://10.0.0.5/internal')).toBe(false);
  });

  it('挡掉别人的存储和任意外网地址', () => {
    expect(allowed('https://evil.example.com/x.md')).toBe(false);
    expect(allowed('https://other.supabase.co/storage/v1/object/public/note-chat-attachments/x')).toBe(false);
  });

  // 前缀判断只认开头，把我们的地址塞在别处不算数
  it('挡掉把合法前缀藏在别处的地址', () => {
    expect(allowed(`https://evil.example.com/?next=${PREFIX}/a.md`)).toBe(false);
    expect(allowed(`https://evil.example.com${PREFIX}`)).toBe(false);
  });
});
