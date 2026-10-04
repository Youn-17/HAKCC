import { describe, expect, it } from 'vitest';
import { minimaxGroupIdFromKey, CHAT_ENDPOINTS, MODELS_ENDPOINTS } from './providerEndpoints';

describe('MiniMax key 解析', () => {
  // 语音接口要在 query 上带 GroupId。它就在 API key（JWT）的 payload 里，
  // 所以不必让教师再填一个字段——但解析失败时必须能识别出来，
  // 否则会发一个必然被拒的请求，错误信息还看不出原因。
  it('从 JWT 形态的 key 里取出 GroupID', () => {
    const payload = Buffer.from(JSON.stringify({ GroupID: '1234567890', SubjectID: 'x' })).toString('base64url');
    expect(minimaxGroupIdFromKey(`header.${payload}.sig`)).toBe('1234567890');
  });

  it('大小写不同的字段名也认', () => {
    const payload = Buffer.from(JSON.stringify({ group_id: 'abc' })).toString('base64url');
    expect(minimaxGroupIdFromKey(`h.${payload}.s`)).toBe('abc');
  });

  it('不是 JWT、或 payload 里没有 GroupID 时返回 null，而不是抛异常', () => {
    expect(minimaxGroupIdFromKey('sk-plain-key')).toBeNull();
    expect(minimaxGroupIdFromKey('a.!!!notbase64!!!.c')).toBeNull();
    const noGroup = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
    expect(minimaxGroupIdFromKey(`h.${noGroup}.s`)).toBeNull();
  });
});

describe('厂商接口地址（全站唯一一份）', () => {
  // 这张表以前在 9 个文件里各写一份并且已经漂了：aiTriggerService 指向
  // paas/v4，其余八处是 coding/paas/v4。课程用的是 Coding Plan 的 key。
  it('智谱走 Coding Plan 的地址', () => {
    expect(CHAT_ENDPOINTS.zhipu).toContain('/api/coding/paas/v4/');
    expect(MODELS_ENDPOINTS.zhipu).toContain('/api/coding/paas/v4/');
  });

  it('每个厂商都配了对话地址，且都是 https', () => {
    for (const [provider, url] of Object.entries(CHAT_ENDPOINTS)) {
      expect(url, provider).toMatch(/^https:\/\//);
    }
    expect(CHAT_ENDPOINTS.minimax).toBeDefined();
  });
});
