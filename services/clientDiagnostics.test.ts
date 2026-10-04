import { beforeEach, describe, expect, it } from 'vitest';
import { recordApiFailure, recordFailure, recentFailures } from './clientDiagnostics';

/** 环缓存是模块级的，每个用例先把它填满再挤空。 */
function drain() {
  for (let i = 0; i < 10; i += 1) recordFailure('script', `drain-${i}`);
  for (let i = 0; i < 10; i += 1) recordFailure('script', `flush-${i}`);
}

describe('前端故障环缓存', () => {
  beforeEach(drain);

  it('只留最近 5 条，不会无限长大', () => {
    expect(recentFailures()).toHaveLength(5);
    expect(recentFailures().map(f => f.detail)).toEqual([
      'flush-5', 'flush-6', 'flush-7', 'flush-8', 'flush-9',
    ]);
  });

  it('接口失败记下方法、路径和状态码 —— 学生说「保存不了」，这一行才是答案', () => {
    recordApiFailure('POST', '/notes', 500, 'Internal error');
    expect(recentFailures().at(-1)?.detail).toBe('POST /notes → 500 Internal error');
  });

  it('过长的路径截断，不把整串塞进语料', () => {
    recordApiFailure('GET', `/notes?ids=${'a'.repeat(400)}`, 400, 'Bad');
    const detail = recentFailures().at(-1)!.detail;
    expect(detail).toContain('…');
    expect(detail.length).toBeLessThanOrEqual(300);
  });

  it('返回的是副本，外部改不动内部缓存', () => {
    const snapshot = recentFailures();
    snapshot.push({ at: '', kind: 'script', detail: 'injected' });
    expect(recentFailures().map(f => f.detail)).not.toContain('injected');
  });

  it('每条都带时间戳，教师才排得出「报错在提问之前还是之后」', () => {
    recordFailure('promise', 'boom');
    expect(Date.parse(recentFailures().at(-1)!.at)).not.toBeNaN();
  });
});
