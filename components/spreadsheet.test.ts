import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  columnLetter, decodeTextTable, loadWorkbook, MAX_COLS, MAX_FILE_BYTES, MAX_ROWS, sniffDelimiter,
  SpreadsheetError, spreadsheetKind, workbookToText, zipUncompressedSize,
} from './spreadsheet';

const encoder = new TextEncoder();
const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const utf8 = (text: string) => toBuffer(encoder.encode(text));

/** 「姓名,成绩\r\n林晓,92」的 GBK 字节：Excel 在中文系统上另存为 CSV 就是这样 */
const GBK_CSV = new Uint8Array([
  0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xb3, 0xc9, 0xbc, 0xa8, 0x0d, 0x0a,
  0xc1, 0xd6, 0xcf, 0xfe, 0x2c, 0x39, 0x32, 0x0d, 0x0a,
]);

function workbookBytes(bookType: 'xlsx' | 'biff8' = 'xlsx'): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const scores = XLSX.utils.aoa_to_sheet([
    ['期中成绩', null, null],
    ['姓名', '成绩', '完成度'],
    ['林晓', 92.5, 0.25],
    ['周宁', 88, 0.5],
  ]);
  scores.C3.z = '0%';
  scores.C4.z = '0%';
  scores['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  XLSX.utils.book_append_sheet(wb, scores, '成绩');
  // 数据从 C5 开始：行号标 5，列字母标 C
  const records = XLSX.utils.aoa_to_sheet([[]]);
  XLSX.utils.sheet_add_aoa(records, [['日期'], [new Date(Date.UTC(2026, 8, 1))]], { origin: 'C5', cellDates: true });
  XLSX.utils.book_append_sheet(wb, records, '记录');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['不该显示']]), '隐藏');
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] } as typeof wb.Workbook;
  const out = XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer;
  return out;
}

describe('spreadsheetKind', () => {
  it('扩展名优先：Windows 把 .csv 报成 application/vnd.ms-excel 也按 CSV 读', () => {
    expect(spreadsheetKind('application/vnd.ms-excel', '名单.csv')).toBe('csv');
    expect(spreadsheetKind('application/vnd.ms-excel', '成绩.xls')).toBe('xls');
    expect(spreadsheetKind('', 'data.XLSX')).toBe('xlsx');
    expect(spreadsheetKind('', 'data.tsv')).toBe('tsv');
  });

  it('没有扩展名时看 MIME；不是表格就是 null', () => {
    expect(spreadsheetKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'download')).toBe('xlsx');
    expect(spreadsheetKind('text/csv', 'export')).toBe('csv');
    expect(spreadsheetKind('application/pdf', 'paper.pdf')).toBeNull();
    expect(spreadsheetKind('text/plain', 'notes.txt')).toBeNull();
  });
});

describe('文本表格的编码和分隔符', () => {
  it('UTF-8（带不带 BOM）、GBK、UTF-16 都读得对', () => {
    expect(decodeTextTable(encoder.encode('﻿姓名,成绩'))).toBe('姓名,成绩');
    expect(decodeTextTable(GBK_CSV)).toBe('姓名,成绩\r\n林晓,92\r\n');
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('名单').flatMap(ch => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])]);
    expect(decodeTextTable(utf16)).toBe('名单');
  });

  it('分号、制表符、sep= 行都认得；引号里的逗号不算', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3\n', 'csv').delimiter).toBe(';');
    expect(sniffDelimiter('"x, y",z\n1,2\n', 'csv').delimiter).toBe(',');
    expect(sniffDelimiter('a\tb\n1\t2\n', 'csv').delimiter).toBe('\t');
    expect(sniffDelimiter('a,b\n1,2\n', 'tsv').delimiter).toBe('\t');
    expect(sniffDelimiter('sep=;\na;b\n', 'csv')).toEqual({ delimiter: ';', body: 'a;b\n' });
  });
});

describe('loadWorkbook：CSV', () => {
  it('引号里的逗号和换行留在一格里，值原样显示', async () => {
    const book = await loadWorkbook(utf8('学号,姓名,备注\n0012,林晓,"喜欢数学, 也喜欢物理"\n0013,周宁,"第一行\n第二行"\n'), 'csv');
    const [sheet] = book.sheets;
    expect(sheet.rows.map(row => row.map(cell => cell.text))).toEqual([
      ['学号', '姓名', '备注'],
      ['0012', '林晓', '喜欢数学, 也喜欢物理'],
      ['0013', '周宁', '第一行\n第二行'],
    ]);
    // 学号是数字样子的文本：靠右，但不改写
    expect(sheet.rows[1][0]).toEqual({ text: '0012', numeric: true });
    expect(sheet.rows[1][1].numeric).toBe(false);
  });

  it('GBK 编码的 CSV 不乱码', async () => {
    const book = await loadWorkbook(toBuffer(GBK_CSV), 'csv');
    expect(book.sheets[0].rows.map(row => row.map(cell => cell.text))).toEqual([['姓名', '成绩'], ['林晓', '92']]);
  });
});

describe('loadWorkbook：Excel', () => {
  it('多个工作表、按单元格格式显示、合并单元格、隐藏的工作表不显示', async () => {
    const book = await loadWorkbook(workbookBytes(), 'xlsx');
    expect(book.sheets.map(s => s.name)).toEqual(['成绩', '记录']);

    const scores = book.sheets[0];
    expect(scores.rows[2].map(cell => cell.text)).toEqual(['林晓', '92.5', '25%']);
    expect(scores.rows[2][2].numeric).toBe(true);
    expect(scores.merges).toEqual([{ r: 0, c: 0, rowSpan: 1, colSpan: 3 }]);

    const records = book.sheets[1];
    expect(records.firstRow).toBe(4);
    expect(records.firstCol).toBe(2);
    expect(records.rows[0][0].text).toBe('日期');
    expect(records.rows[1][0].numeric).toBe(true);
  });

  it('Excel 里以文本存储的数字照 Excel 靠左，CSV 里像数字的靠右', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['学号', '人数'], ['20260001', 42]]), 'S');
    const book = await loadWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'xlsx');
    expect(book.sheets[0].rows[1]).toEqual([{ text: '20260001', numeric: false }, { text: '42', numeric: true }]);
  });

  it('老版 .xls 也能读', async () => {
    const book = await loadWorkbook(workbookBytes('biff8'), 'xls');
    expect(book.sheets[0].rows[3].map(cell => cell.text)).toEqual(['周宁', '88', '50%']);
  });

  it('只读前 MAX_ROWS 行、显示前 MAX_COLS 列，并标出截断', async () => {
    const wb = XLSX.utils.book_new();
    const tall = Array.from({ length: MAX_ROWS + 5 }, (_, i) => [`第 ${i + 1} 行`]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tall), '长表');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([Array.from({ length: MAX_COLS + 10 }, (_, i) => i)]), '宽表');
    const book = await loadWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'xlsx');
    expect(book.sheets[0].rows).toHaveLength(MAX_ROWS);
    expect(book.sheets[0].truncatedRows).toBe(true);
    expect(book.sheets[1].colCount).toBe(MAX_COLS);
    expect(book.sheets[1].truncatedCols).toBe(true);
  });

  it('格式化过的空行空列不画出来', async () => {
    const ws = XLSX.utils.aoa_to_sheet([['a', 'b']]);
    ws['!ref'] = 'A1:Z500';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const book = await loadWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'xlsx');
    expect(book.sheets[0].rows).toHaveLength(1);
    expect(book.sheets[0].colCount).toBe(2);
  });
});

describe('loadWorkbook：拒绝打开的', () => {
  it('超过大小上限', async () => {
    await expect(loadWorkbook(new ArrayBuffer(MAX_FILE_BYTES + 1), 'xlsx')).rejects.toMatchObject({ code: 'tooLarge' });
  });

  it('压缩包目录里声明的解压后大小超限（压缩炸弹），不交给解析库', async () => {
    const bytes = new Uint8Array(workbookBytes().slice(0));
    const view = new DataView(bytes.buffer);
    expect(zipUncompressedSize(bytes)).toBeGreaterThan(0);
    for (let i = 0; i + 4 <= bytes.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0x7fffffff, true);
    }
    await expect(loadWorkbook(toBuffer(bytes), 'xlsx')).rejects.toMatchObject({ code: 'unzippedTooLarge' });
  });

  it('损坏的 xlsx 报 unreadable，不是整页崩掉', async () => {
    // 只传了一半的压缩包：目录读不到，解析库会抛错
    const half = workbookBytes().slice(0, 1200);
    const error = await loadWorkbook(half, 'xlsx').catch(e => e);
    expect(error).toBeInstanceOf(SpreadsheetError);
    expect(error.code).toBe('unreadable');
  });
});

describe('辅助', () => {
  it('列字母', () => {
    expect([0, 25, 26, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
  });

  it('给 AI 的正文：每个工作表一段，行内用制表符', async () => {
    const book = await loadWorkbook(workbookBytes(), 'xlsx');
    const text = workbookToText(book, true);
    expect(text).toContain('工作表：成绩\n期中成绩\n姓名\t成绩\t完成度\n林晓\t92.5\t25%');
    expect(text).toContain('工作表：记录');
    expect(text).not.toContain('不该显示');
  });
});
