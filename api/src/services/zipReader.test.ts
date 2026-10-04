import { describe, it, expect } from 'vitest';
import { createZip } from './zipWriter';
import { listZipEntries, readZipEntry, readZipText } from './zipReader';

// 用同目录的 writer 造包再读回来：两边都是自己写的，round-trip 能同时锁住两侧。
const LONG_MD = '# 标题\n\n' + '判断标准如果只看输出，我们要如何区分。\n\n'.repeat(80);

describe('zipReader', () => {
  it('列出中央目录里的所有条目', () => {
    const zip = createZip([
      { name: 'a.txt', data: 'alpha' },
      { name: 'nested/full.md', data: LONG_MD },
    ]);
    expect(listZipEntries(zip).map(e => e.name)).toEqual(['a.txt', 'nested/full.md']);
  });

  it('按后缀匹配取出 full.md —— MinerU 的包里它带目录前缀', () => {
    const zip = createZip([
      { name: 'images/fig1.png', data: Buffer.from([1, 2, 3]) },
      { name: 'x/y/full.md', data: LONG_MD },
    ]);
    expect(readZipText(zip, n => n.endsWith('full.md'))).toBe(LONG_MD);
  });

  it('取不到就返回 null，不抛异常', () => {
    const zip = createZip([{ name: 'only.txt', data: 'x' }]);
    expect(readZipEntry(zip, n => n.endsWith('full.md'))).toBeNull();
  });

  it('二进制条目按字节原样取回', () => {
    const bytes = Buffer.from([0, 255, 13, 10, 26, 7]);
    const zip = createZip([{ name: 'b.bin', data: bytes }]);
    expect(readZipEntry(zip, n => n === 'b.bin')!.equals(bytes)).toBe(true);
  });

  it('中文文件名与中文内容都能正确往返', () => {
    const zip = createZip([{ name: '解析结果/全文.md', data: '# 图灵测试\n\n统计匹配与理解。' }]);
    expect(readZipText(zip, n => n.endsWith('全文.md'))).toBe('# 图灵测试\n\n统计匹配与理解。');
  });

  it('不是 ZIP 就明确报错，而不是返回空内容', () => {
    expect(() => listZipEntries(Buffer.from('这不是一个压缩包'))).toThrow(/ZIP/);
  });

  it('空文件条目返回空 Buffer 而不是 null', () => {
    const zip = createZip([{ name: 'empty.md', data: '' }]);
    const out = readZipEntry(zip, n => n === 'empty.md');
    expect(out).not.toBeNull();
    expect(out!.length).toBe(0);
  });
});
