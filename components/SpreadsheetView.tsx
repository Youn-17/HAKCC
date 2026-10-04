import React, { useEffect, useMemo, useState } from 'react';
import type { Language } from '../types';
import { columnLetter, MAX_COLS, MAX_ROWS, type WorkbookView } from './spreadsheet';

/** 一次先画这么多行，几千行一起画会卡住页面好几秒 */
const STEP = 300;

interface Props {
  book: WorkbookView;
  lang: Language;
}

/**
 * 表格附件的只读视图：上面是工作表页签，表头是列字母、左边是行号，两者滚动时固定。
 * 行号和列字母按单元格在原表里的位置标，老师说「看 C 列第 12 行」学生能对上。
 */
const SpreadsheetView: React.FC<Props> = ({ book, lang }) => {
  const zh = lang === 'zh';
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(STEP);

  useEffect(() => { setActive(0); }, [book]);
  useEffect(() => { setShown(STEP); }, [active, book]);

  const sheet = book.sheets[Math.min(active, book.sheets.length - 1)];

  // 合并单元格：左上角那格带 rowSpan / colSpan，被它盖住的格子不画
  const { spans, covered } = useMemo(() => {
    const spanMap = new Map<string, { rowSpan: number; colSpan: number }>();
    const coveredSet = new Set<string>();
    for (const m of sheet?.merges ?? []) {
      spanMap.set(`${m.r},${m.c}`, { rowSpan: m.rowSpan, colSpan: m.colSpan });
      for (let r = m.r; r < m.r + m.rowSpan; r++) {
        for (let c = m.c; c < m.c + m.colSpan; c++) {
          if (r !== m.r || c !== m.c) coveredSet.add(`${r},${c}`);
        }
      }
    }
    return { spans: spanMap, covered: coveredSet };
  }, [sheet]);

  if (!sheet) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-zinc-500 dark:text-gray-400">
        {zh ? '这个文件里没有可以显示的工作表。' : 'This file has no sheets to show.'}
      </div>
    );
  }

  const visible = sheet.rows.slice(0, shown);
  const columns = Array.from({ length: sheet.colCount }, (_, i) => columnLetter(sheet.firstCol + i));
  const headerCell = 'border-b border-r border-zinc-200 bg-zinc-50 px-2 py-1 text-[0.6875rem] font-medium text-zinc-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {book.sheets.length > 1 && (
        <div role="tablist" aria-label={zh ? '工作表' : 'Sheets'} className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 px-3 dark:border-gray-800">
          {book.sheets.map((s, i) => (
            <button
              key={`${i}-${s.name}`}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`shrink-0 border-b-2 px-3 py-2 text-[0.75rem] transition-colors ${
                i === active
                  ? 'border-[#000080] font-semibold text-zinc-900 dark:text-gray-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {sheet.rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500 dark:text-gray-400">
          {zh ? '这个工作表是空的。' : 'This sheet is empty.'}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="border-separate border-spacing-0 text-[0.8125rem] text-zinc-800 dark:text-gray-200">
            <thead>
              <tr>
                <th scope="col" className={`${headerCell} sticky left-0 top-0 z-30 min-w-[3rem]`} aria-label={zh ? '行号' : 'Row'} />
                {columns.map(letter => (
                  <th key={letter} scope="col" className={`${headerCell} sticky top-0 z-20 text-center`}>{letter}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, r) => (
                <tr key={r}>
                  <th scope="row" className={`${headerCell} sticky left-0 z-10 text-right tabular-nums`}>{sheet.firstRow + r + 1}</th>
                  {row.map((cell, c) => {
                    const key = `${r},${c}`;
                    if (covered.has(key)) return null;
                    const span = spans.get(key);
                    return (
                      <td
                        key={c}
                        rowSpan={span ? Math.min(span.rowSpan, visible.length - r) : undefined}
                        colSpan={span?.colSpan}
                        className={`min-w-[3rem] max-w-[24rem] whitespace-pre-wrap break-words border-b border-r border-zinc-200 bg-white px-2.5 py-1.5 align-top dark:border-gray-800 dark:bg-gray-950 ${
                          cell.numeric ? 'text-right tabular-nums' : ''
                        }`}
                      >
                        {cell.text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-2 px-4 py-4 text-[0.75rem] text-zinc-500 dark:text-gray-400">
            {shown < sheet.rows.length && (
              <button
                onClick={() => setShown(n => n + STEP)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-50 active:scale-[0.98] dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {zh
                  ? `再显示 ${Math.min(STEP, sheet.rows.length - shown)} 行（已显示 ${shown} / ${sheet.rows.length} 行）`
                  : `Show ${Math.min(STEP, sheet.rows.length - shown)} more rows (${shown} of ${sheet.rows.length})`}
              </button>
            )}
            {sheet.truncatedRows && (
              <p>{zh ? `这个工作表超过 ${MAX_ROWS} 行，这里只显示前 ${MAX_ROWS} 行，完整内容请下载原文件。` : `This sheet has more than ${MAX_ROWS} rows; only the first ${MAX_ROWS} are shown. Download the file for the rest.`}</p>
            )}
            {sheet.truncatedCols && (
              <p>{zh ? `这个工作表超过 ${MAX_COLS} 列，这里只显示前 ${MAX_COLS} 列。` : `This sheet has more than ${MAX_COLS} columns; only the first ${MAX_COLS} are shown.`}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SpreadsheetView;
