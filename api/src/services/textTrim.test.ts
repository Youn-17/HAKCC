import { describe, it, expect } from 'vitest';
import { trimAtSentence } from './textTrim';

describe('trimAtSentence', () => {
  it('不超长时原样返回', () => {
    expect(trimAtSentence('短句。', 100)).toBe('短句。');
  });

  it('在中文句号处切断，不留半句', () => {
    const text = '第一句话在这里。第二句话也在这里。第三句被切掉。';
    const out = trimAtSentence(text, 20);
    expect(out.endsWith('。')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
  });

  it('识别英文句末标点', () => {
    const out = trimAtSentence('First sentence here. Second one follows. Third.', 30);
    expect(out).toBe('First sentence here. Second o'.slice(0, out.length));
    expect(out.endsWith('.')).toBe(true);
  });

  it('切点太靠前时硬截，避免丢掉大半内容', () => {
    // 句号只出现在 10% 处，按边界切会丢掉 90%
    const text = '短。' + '没有标点的很长一段内容'.repeat(10);
    const out = trimAtSentence(text, 50);
    expect(out.length).toBe(50);
  });

  it('全无标点时按长度硬截', () => {
    const out = trimAtSentence('abcdefghij'.repeat(10), 25);
    expect(out.length).toBe(25);
  });
});
