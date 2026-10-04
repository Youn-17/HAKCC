import { describe, expect, it } from 'vitest';
import { boundContext, MAX_CONTEXT_BYTES } from '../routes/support';

describe('求助处境的大小上限', () => {
  it('正常大小原样保留 —— 语料越详细越好', () => {
    const ctx = { path: '/workspace/abc', viewport: { w: 1440, h: 900 }, recentFailures: [] };
    expect(boundContext(ctx)).toEqual(ctx);
  });

  it('不是对象就当空处境，别把字符串或数组塞进 jsonb 列', () => {
    expect(boundContext('oops')).toEqual({});
    expect(boundContext(null)).toEqual({});
    expect(boundContext([1, 2, 3])).toEqual({});
    expect(boundContext(undefined)).toEqual({});
  });

  it('超限时丢大的、留小的，而不是整块清空', () => {
    const ctx = {
      path: '/workspace/abc',
      device: 'desktop',
      huge: 'x'.repeat(MAX_CONTEXT_BYTES * 2),
    };
    const out = boundContext(ctx);
    expect(out.path).toBe('/workspace/abc');
    expect(out.device).toBe('desktop');
    expect(out.huge).toBeUndefined();
  });

  it('截断过就留个标记，研究者才知道这条是不全的', () => {
    const out = boundContext({ huge: 'x'.repeat(MAX_CONTEXT_BYTES * 2) });
    expect(out._truncated).toBe(true);
  });

  it('无论怎么塞，落库的都在上限之内', () => {
    const ctx: Record<string, unknown> = {};
    for (let i = 0; i < 200; i += 1) ctx[`k${i}`] = 'y'.repeat(500);
    expect(JSON.stringify(boundContext(ctx)).length).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  });
});
