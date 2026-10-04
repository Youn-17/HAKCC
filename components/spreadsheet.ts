/**
 * 表格附件（Excel、CSV）在文档页里的读取。
 *
 * 在浏览器里解析，不放到服务器上：API 是单进程，xlsx 是压缩包，一个解压后几个 G 的文件
 * 就能把所有人的请求拖住（jsdom 那次就是这么吃的亏）。放在打开它的人自己的页面里，
 * 最坏也只卡住这一个标签页。即便如此也先设三道限：文件大小、解压后的大小、每个工作表只读前若干行。
 *
 * 解析库 SheetJS 只在打开表格时才动态加载，平时的页面不多背它。
 */

export type SpreadsheetKind = 'xlsx' | 'xls' | 'ods' | 'csv' | 'tsv';

/** 超过就不在线打开，提示下载。学生、老师传的表一般几百 KB。 */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** 压缩包里所有文件解压后的总大小上限。正常的 30MB xlsx 解压后也到不了这么多 */
export const MAX_UNZIPPED_BYTES = 150 * 1024 * 1024;
/** 每个工作表最多读这么多行，再多就提示下载原文件 */
export const MAX_ROWS = 2000;
/** 最多显示这么多列 */
export const MAX_COLS = 200;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';

/**
 * 按扩展名优先判断：Windows 上的浏览器常把 .csv 报成 application/vnd.ms-excel，
 * 只看 MIME 会把 CSV 当成老版 Excel 去解析。
 */
export function spreadsheetKind(mimeType: string, fileName: string): SpreadsheetKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  if (ext === 'xls') return 'xls';
  if (ext === 'ods') return 'ods';
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv') return 'tsv';
  const mime = mimeType.toLowerCase();
  if (mime === XLSX_MIME) return 'xlsx';
  if (mime === ODS_MIME) return 'ods';
  if (mime === 'application/vnd.ms-excel') return 'xls';
  if (mime === 'text/csv') return 'csv';
  if (mime === 'text/tab-separated-values') return 'tsv';
  return null;
}

export type SpreadsheetErrorCode = 'tooLarge' | 'unzippedTooLarge' | 'password' | 'unreadable';

export class SpreadsheetError extends Error {
  constructor(public readonly code: SpreadsheetErrorCode) {
    super(code);
    this.name = 'SpreadsheetError';
  }
}

export function spreadsheetErrorMessage(code: SpreadsheetErrorCode, zh: boolean): string {
  switch (code) {
    case 'tooLarge':
      return zh ? '文件超过 30 MB，在线只能打开小一些的表格。' : 'The file is over 30 MB, too large to open here.';
    case 'unzippedTooLarge':
      return zh ? '这份表格解压后太大，在线打不开。' : 'This spreadsheet is too large once unpacked to open here.';
    case 'password':
      return zh ? '这份表格设了密码，在线打不开。' : 'This spreadsheet is password-protected.';
    default:
      return zh ? '没能读出这份表格，文件可能已损坏或格式不受支持。' : 'Could not read this spreadsheet. It may be damaged or in an unsupported format.';
  }
}

/**
 * 压缩包（xlsx、ods）里所有文件解压后的总大小，读自中央目录，不用真的解压。
 * 不是 zip、或目录读不通时返回 null，交给解析库自己判断格式。
 * 用 ZIP64 的（单个文件超过 4GB）直接当超限。
 */
export function zipUncompressedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) return null;
  // 目录结尾记录在最后 22 字节到 22+65535 字节（带注释）之间
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || dirOffset === 0xffffffff) return Number.POSITIVE_INFINITY;
  let offset = dirOffset;
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) return Number.POSITIVE_INFINITY;
    total += size;
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return total;
}

/**
 * 文本表格的编码：先按 UTF-8 严格解，失败再按 GB18030。Excel 在中文系统上「另存为 CSV」
 * 默认就是 GBK，按 UTF-8 读出来整张表都是乱码。UTF-16 靠开头的 BOM 认。
 */
export function decodeTextTable(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

/**
 * CSV 的分隔符。欧洲版 Excel 导出的是分号；Excel 还认第一行写的 sep=;。
 * 看前几行里引号外的逗号、分号、制表符，哪个每行都出现、出现得最多就用哪个。
 */
export function sniffDelimiter(text: string, kind: 'csv' | 'tsv'): { delimiter: string; body: string } {
  const sep = /^sep=(.)\r?\n/i.exec(text);
  if (sep) return { delimiter: sep[1], body: text.slice(sep[0].length) };
  if (kind === 'tsv') return { delimiter: '\t', body: text };
  const lines = text.split(/\r?\n/).filter(line => line.trim()).slice(0, 10);
  let best = ',';
  let bestScore = 0;
  for (const candidate of [',', ';', '\t']) {
    const counts = lines.map(line => countOutsideQuotes(line, candidate));
    if (counts.length === 0 || counts.some(n => n === 0)) continue;
    const score = Math.min(...counts);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  return { delimiter: best, body: text };
}

function countOutsideQuotes(line: string, ch: string): number {
  let inQuotes = false;
  let n = 0;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ch && !inQuotes) n++;
  }
  return n;
}

export interface SheetCell {
  text: string;
  /** 数字（含日期、百分比）靠右，和 Excel 一样 */
  numeric: boolean;
}

export interface SheetMerge {
  /** 相对于 rows 的行列下标 */
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
}

export interface SheetView {
  name: string;
  /** 要显示的行，每行 colCount 格；首尾的空行空列已去掉 */
  rows: SheetCell[][];
  colCount: number;
  /** rows[0] 在表里是第几行、第几列（0 起），用来标行号和列字母 */
  firstRow: number;
  firstCol: number;
  merges: SheetMerge[];
  /** 行数超过 MAX_ROWS 只读了前面一部分 */
  truncatedRows: boolean;
  /** 列数超过 MAX_COLS 只显示了前面一部分 */
  truncatedCols: boolean;
}

export interface WorkbookView {
  sheets: SheetView[];
}

const NUMERIC_TEXT = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?%?$/;

type RawCell = { t?: string; v?: unknown; w?: string } | undefined;
type RawSheet = {
  '!data'?: RawCell[][];
  '!ref'?: string;
  '!fullref'?: string;
  '!merges'?: { s: { r: number; c: number }; e: { r: number; c: number } }[];
};

/** 读进来的字节变成要显示的工作表。只读前 MAX_ROWS 行，隐藏的工作表不显示。 */
export async function loadWorkbook(data: ArrayBuffer, kind: SpreadsheetKind): Promise<WorkbookView> {
  if (data.byteLength > MAX_FILE_BYTES) throw new SpreadsheetError('tooLarge');
  const bytes = new Uint8Array(data);
  if (kind === 'xlsx' || kind === 'ods') {
    const unzipped = zipUncompressedSize(bytes);
    if (unzipped !== null && unzipped > MAX_UNZIPPED_BYTES) throw new SpreadsheetError('unzippedTooLarge');
  }

  const XLSX = await import('xlsx');
  let workbook: { SheetNames: string[]; Sheets: Record<string, unknown>; Workbook?: { Sheets?: { Hidden?: number }[] } };
  try {
    if (kind === 'csv' || kind === 'tsv') {
      const { delimiter, body } = sniffDelimiter(decodeTextTable(bytes), kind);
      // raw：文本表格里的值原样显示，不把「0012」读成 12、不把学号读成科学计数法
      workbook = XLSX.read(body, { type: 'string', raw: true, FS: delimiter, dense: true, sheetRows: MAX_ROWS + 1 });
    } else {
      workbook = XLSX.read(bytes, {
        type: 'array', dense: true, sheetRows: MAX_ROWS + 1,
        cellHTML: false, cellFormula: false, cellStyles: false, cellDates: false,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SpreadsheetError(/password|encrypt/i.test(message) ? 'password' : 'unreadable');
  }

  const sheets: SheetView[] = [];
  workbook.SheetNames.forEach((name, index) => {
    if ((workbook.Workbook?.Sheets?.[index]?.Hidden ?? 0) !== 0) return;
    sheets.push(toSheetView(name, workbook.Sheets[name] as RawSheet, kind === 'csv' || kind === 'tsv'));
  });
  return { sheets };
}

/**
 * 密集模式下 !data[r][c] 就是表里第 r 行第 c 列（0 起），行号和列字母直接按它标。
 * textTable：CSV 里所有值都是文本，看起来像数字的也靠右；Excel 里「以文本存储的数字」照 Excel 靠左。
 */
function toSheetView(name: string, sheet: RawSheet, textTable: boolean): SheetView {
  const empty: SheetView = { name, rows: [], colCount: 0, firstRow: 0, firstCol: 0, merges: [], truncatedRows: false, truncatedCols: false };
  const data = sheet['!data'];
  if (!sheet['!ref'] || !data) return empty;

  // 实际有内容的范围。!ref 常常连带格式化过的空行空列，照它画会拖出一大片空白
  let top = Infinity, bottom = -1, left = Infinity, right = -1;
  data.forEach((row, r) => {
    row?.forEach((cell, c) => {
      if (cellText(cell) === '') return;
      top = Math.min(top, r); bottom = Math.max(bottom, r);
      left = Math.min(left, c); right = Math.max(right, c);
    });
  });
  if (bottom < 0) return empty;

  // 多读的那一行只用来判断后面还有没有内容
  const truncatedRows = bottom >= MAX_ROWS;
  bottom = Math.min(bottom, MAX_ROWS - 1);
  const truncatedCols = right - left + 1 > MAX_COLS;
  right = Math.min(right, left + MAX_COLS - 1);
  const colCount = right - left + 1;

  const rows: SheetCell[][] = [];
  for (let r = top; r <= bottom; r++) {
    const source = data[r] ?? [];
    const row: SheetCell[] = [];
    for (let c = left; c <= right; c++) {
      const cell = source[c];
      const text = cellText(cell);
      row.push({ text, numeric: cell?.t === 'n' || (textTable && text !== '' && NUMERIC_TEXT.test(text.trim())) });
    }
    rows.push(row);
  }

  const merges: SheetMerge[] = [];
  for (const m of sheet['!merges'] ?? []) {
    const r0 = Math.max(m.s.r, top), c0 = Math.max(m.s.c, left);
    const r1 = Math.min(m.e.r, bottom), c1 = Math.min(m.e.c, right);
    if (r0 > r1 || c0 > c1 || (r0 === r1 && c0 === c1)) continue;
    merges.push({ r: r0 - top, c: c0 - left, rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 });
  }

  return { name, rows, colCount, firstRow: top, firstCol: left, merges, truncatedRows, truncatedCols };
}

function cellText(cell: RawCell): string {
  if (!cell) return '';
  if (typeof cell.w === 'string') return cell.w;
  if (cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.v);
}

/** 列号转字母：0 → A，26 → AA */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * 给文档页 AI 助手读的正文：每个工作表一段，行内用制表符分隔。
 * 侧栏自己会截到它的上限并告诉 AI 截断了，这里只防一个特别大的表把字符串撑得太长。
 */
export function workbookToText(book: WorkbookView, zh: boolean, maxChars = 200_000): string {
  const parts: string[] = [];
  let length = 0;
  for (const sheet of book.sheets) {
    const title = zh
      ? `工作表：${sheet.name}${sheet.truncatedRows ? `（只读了前 ${MAX_ROWS} 行）` : ''}`
      : `Sheet: ${sheet.name}${sheet.truncatedRows ? ` (first ${MAX_ROWS} rows only)` : ''}`;
    const lines = [title, ...sheet.rows.map(row => row.map(cell => cell.text.replace(/[\t\r\n]+/g, ' ')).join('\t').replace(/\t+$/, ''))];
    const block = lines.join('\n');
    parts.push(block);
    length += block.length + 2;
    if (length >= maxChars) break;
  }
  return parts.join('\n\n').slice(0, maxChars);
}
