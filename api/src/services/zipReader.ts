/**
 * 极简 ZIP 读取：从压缩包里取出**一个**文件。
 *
 * MinerU 的精准解析接口返回一个 zip，我们只要里面的 full.md。
 * 为这一件事引一个解压依赖不划算 —— 同目录的 zipWriter 也是基于 zlib 手写的，
 * 保持一致。这里只实现「按名字找一个条目并解出来」，不做完整的 zip 语义。
 */
import { inflateRawSync } from 'zlib';

const EOCD_SIG = 0x06054b50;      // End of central directory
const CD_SIG = 0x02014b50;        // Central directory file header
const MAX_COMMENT = 0xffff;

/** 从尾部往前找 EOCD。注释最长 64KB，所以只需回扫这么多。 */
function findEocd(buf: Buffer): number {
  const start = Math.max(0, buf.length - MAX_COMMENT - 22);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

export interface ZipEntryInfo {
  name: string;
  offset: number;
  compressedSize: number;
  method: number;
}

/** 列出中央目录里的所有条目（只读元信息，不解压）。 */
export function listZipEntries(buf: Buffer): ZipEntryInfo[] {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('不是有效的 ZIP：找不到中央目录');

  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntryInfo[] = [];

  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CD_SIG) break;
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const offset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    entries.push({ name, offset, compressedSize, method });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * 解出一个条目。`match` 用来挑条目 —— MinerU 的 zip 里 full.md 可能带目录前缀，
 * 所以按后缀匹配而不是全名相等。
 */
export function readZipEntry(buf: Buffer, match: (name: string) => boolean): Buffer | null {
  const entry = listZipEntries(buf).find(e => match(e.name));
  if (!entry) return null;

  // 中央目录里的 offset 指向本地文件头；本地头的名字/扩展字段长度可能与中央目录不同，
  // 必须按本地头自己的长度往后跳，不能复用中央目录的值。
  const local = entry.offset;
  if (local + 30 > buf.length) return null;
  const nameLen = buf.readUInt16LE(local + 26);
  const extraLen = buf.readUInt16LE(local + 28);
  const dataStart = local + 30 + nameLen + extraLen;

  // 本地头的 compressedSize 在使用数据描述符时为 0，这时以中央目录的值为准
  const localSize = buf.readUInt32LE(local + 18);
  const size = localSize || entry.compressedSize;
  const data = buf.subarray(dataStart, dataStart + size);

  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`ZIP 压缩方式 ${entry.method} 不支持`);
}

/** 便捷封装：取出一个文本文件的内容。 */
export function readZipText(buf: Buffer, match: (name: string) => boolean): string | null {
  const data = readZipEntry(buf, match);
  return data ? data.toString('utf8') : null;
}
