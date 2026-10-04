/**
 * Minimal ZIP writer (deflate) built on Node's zlib — no external dependency.
 *
 * Research exports ship as a bundle of CSVs plus a manifest, which only works
 * if we can hand the browser a single archive.
 */

import { deflateRawSync } from 'zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer | string;
}

export function createZip(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // UTF-8 filenames
    local.writeUInt16LE(8, 8);        // deflate
    local.writeUInt16LE(0, 10);       // mod time
    local.writeUInt16LE(0, 12);       // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);       // extra length
    localChunks.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);     // version made by
    central.writeUInt16LE(20, 6);     // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);     // extra length
    central.writeUInt16LE(0, 32);     // comment length
    central.writeUInt16LE(0, 34);     // disk number
    central.writeUInt16LE(0, 36);     // internal attrs
    central.writeUInt32LE(0, 38);     // external attrs
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralBuf, end]);
}

/** Rows → CSV. Column order comes from `columns`; values are stringified safely. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Excel mangles leading =/+/-/@ as formulas; guard those, but leave plain
    // negative numbers alone or every "-3" reads as "'-3" in the sheet.
    const isNumeric = /^-?\d+(\.\d+)?$/.test(str);
    const guarded = !isNumeric && /^[=+\-@]/.test(str) ? `'${str}` : str;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map((row) => columns.map((col) => escape(row[col])).join(','));
  return [header, ...body].join('\n');
}
