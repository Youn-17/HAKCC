// @vitest-environment jsdom
/**
 * 文档页里看 Excel 和 CSV：原来 Excel 只显示「这个格式无法在线预览」，CSV 按换行和逗号硬切，
 * 引号里的逗号、GBK 编码都读错。这里挂真的 FileViewerPage，文件从假的存储地址取。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as XLSX from 'xlsx';

vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom 没有 scrollTo，AI 侧栏挂上就会调它
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => undefined;
});

import FileViewerPage from './FileViewerPage';

function gradesXlsx(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['期中成绩', null, null],
    ['姓名', '成绩', '完成度'],
    ['林晓', 92.5, 0.25],
  ]);
  ws.C3.z = '0%';
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  XLSX.utils.book_append_sheet(wb, ws, '成绩');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['小组', '题目'], ['第一组', '光合作用']]), '分组');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** 「姓名,备注\r\n林晓,"喜欢数学, 也喜欢物理"」的 GBK 字节 */
const GBK_CSV = new Uint8Array([
  0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xb1, 0xb8, 0xd7, 0xa2, 0x0d, 0x0a, 0xc1, 0xd6, 0xcf,
  0xfe, 0x2c, 0x22, 0xcf, 0xb2, 0xbb, 0xb6, 0xca, 0xfd, 0xd1, 0xa7, 0x2c, 0x20, 0xd2,
  0xb2, 0xcf, 0xb2, 0xbb, 0xb6, 0xce, 0xef, 0xc0, 0xed, 0x22, 0x0d, 0x0a,
]);

const FILES: Record<string, () => ArrayBuffer> = {
  'https://files.example.test/grades.xlsx': gradesXlsx,
  'https://files.example.test/names.csv': () => GBK_CSV.buffer.slice(0) as ArrayBuffer,
  'https://files.example.test/broken.xlsx': () => gradesXlsx().slice(0, 1200),
};

function stubBackend() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const file = FILES[url];
    if (file) return new Response(file(), { status: 200 });
    return new Response(JSON.stringify({ messages: [], threads: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function settle(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function waitFor<T>(probe: () => T | null | undefined | false, label: string, timeout = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value as T;
    if (Date.now() - started > timeout) throw new Error(`等不到：${label}`);
    await settle(10);
  }
}

const cellTexts = () => Array.from(document.querySelectorAll('td')).map(td => td.textContent);
const buttonWith = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().startsWith(text)) ?? null;

async function open(fileName: string, mimeType: string) {
  stubBackend();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(FileViewerPage, {
      isOpen: true,
      onClose: () => undefined,
      fileUrl: `https://files.example.test/${fileName}`,
      fileName,
      mimeType,
      noteId: 'note-sheet',
      courseId: 'course-1',
      currentUserId: 'student-1',
      lang: 'zh',
    }));
  });
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('文档页看表格', () => {
  it('Excel：显示工作表、按格式显示的值和合并单元格，页签能切换', async () => {
    await open('grades.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await waitFor(() => cellTexts().includes('25%'), '成绩表');
    expect(document.body.textContent).not.toContain('无法在线预览');

    const title = Array.from(document.querySelectorAll('td')).find(td => td.textContent === '期中成绩')!;
    expect(title.colSpan).toBe(3);
    // 列字母和行号
    expect(Array.from(document.querySelectorAll('thead th')).map(th => th.textContent)).toEqual(['', 'A', 'B', 'C']);
    expect(Array.from(document.querySelectorAll('tbody th')).map(th => th.textContent)).toEqual(['1', '2', '3']);

    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.textContent === '分组') as HTMLButtonElement;
    await act(async () => { tab.click(); });
    await waitFor(() => cellTexts().includes('光合作用'), '第二个工作表');
    expect(cellTexts()).not.toContain('25%');
  });

  it('AI 助手读得到表格内容', async () => {
    await open('grades.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await waitFor(() => cellTexts().includes('25%'), '成绩表');
    await act(async () => { buttonWith('AI 助手')!.click(); });
    const input = await waitFor(() => document.querySelector<HTMLTextAreaElement>('aside textarea'), 'AI 输入框');
    expect(input.placeholder).toBe('就这份文档提问⋯⋯');
    expect(input.disabled).toBe(false);
    // 示例问题是看数据的，不是问一篇文章的「核心主张」
    expect(document.body.textContent).toContain('这张表有哪些列，各记的是什么？');
    expect(document.body.textContent).not.toContain('这份文档的核心主张是什么？');
  });

  it('GBK 编码的 CSV：不乱码，引号里的逗号留在一格里', async () => {
    await open('names.csv', 'application/vnd.ms-excel');
    await waitFor(() => cellTexts().includes('林晓'), 'CSV');
    expect(cellTexts()).toEqual(['姓名', '备注', '林晓', '喜欢数学, 也喜欢物理']);
  });

  it('坏文件：说明原因，给下载', async () => {
    await open('broken.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await waitFor(() => document.body.textContent?.includes('没能读出这份表格'), '错误提示');
    const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent?.includes('下载原文件'));
    expect(link?.getAttribute('href')).toBe('https://files.example.test/broken.xlsx');
  });
});
