// @vitest-environment jsdom
/**
 * 研究数据导出页的「参与者」（2026-10-09 用户：要能导出一个人的所有数据，可选）。
 * 挂真的导出页，接口换成假的，看选人之后发出去的请求。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.hoisted(() => ({
  exportOptions: vi.fn(),
  exportTable: vi.fn(),
  exportDownload: vi.fn(),
  setCourseEnglishName: vi.fn(),
}));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...actual, research: { ...actual.research, ...api } };
});

import ResearchZone from './ResearchZone';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const column = (key: string) => ({ key, zh: key, en: key, group: 'identity' as const });
const OPTIONS = {
  course: { title: '人工智能与学习', englishName: 'AI and Learning', abbr: 'AL', suggestedAbbr: 'AL' },
  spaces: [], groups: [], views: [], dateRange: { earliest: null, latest: null },
  people: [
    { userId: 's1', code: 'SAL01', name: '林晓', role: 'student', groupName: '一组' },
    { userId: 't1', code: 'TAL01', name: '刘老师', role: 'teacher', groupName: null },
  ],
  notPerPerson: ['sessions'],
  datasets: [
    { key: 'notes', zh: '笔记总表', en: 'Notes', descZh: '', descEn: '', columns: [column('participant_id')] },
    { key: 'interactions', zh: '互动总表', en: 'Interactions', descZh: '', descEn: '', columns: [column('from_participant_id')] },
    { key: 'sessions', zh: '课次记录', en: 'Sessions', descZh: '', descEn: '', columns: [column('session_no')] },
  ],
};
const TABLE = {
  needsEnglishName: false, dataset: 'notes', columns: [column('participant_id')],
  rows: [{ participant_id: 'SAL01' }], total: 1, counts: { notes: 1, interactions: 0, sessions: 0 }, truncated: [], warnings: [],
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function settle(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}
async function waitFor<T>(probe: () => T | null | undefined | false, label: string, timeout = 3000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value as T;
    if (Date.now() - started > timeout) throw new Error(`等不到：${label}`);
    await settle(20);
  }
}
const personSelect = () => document.querySelector<HTMLSelectElement>('select[aria-label="只导出一个人的数据"]');
const buttonWith = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text)) ?? null;

beforeEach(async () => {
  api.exportOptions.mockResolvedValue(OPTIONS);
  api.exportTable.mockResolvedValue(TABLE);
  api.exportDownload.mockResolvedValue(new Blob(['x']));
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(ResearchZone, {
      lang: 'zh', activeModule: 'export',
      courses: [{ id: 'course-1', title: '人工智能与学习' } as never],
    }));
  });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.restoreAllMocks();
  api.exportOptions.mockReset();
  api.exportTable.mockReset();
  api.exportDownload.mockReset();
});

describe('研究数据导出：按人导出', () => {
  it('默认是全部参与者，请求里不带 participant_id；名单写着编号、姓名、小组', async () => {
    const select = await waitFor(() => personSelect(), '参与者下拉框');
    expect(select.value).toBe('');
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['全部参与者', 'SAL01 · 林晓 · 一组', 'TAL01 · 刘老师 · 教师']);
    await waitFor(() => api.exportTable.mock.calls.length > 0, '预览请求');
    expect(api.exportTable.mock.calls.at(-1)![1].participant_id).toBeUndefined();
    expect(buttonWith('的全部数据')).toBeNull();
  });

  it('选一个人：预览只按这个人取；一键导出这个人的全部数据，不含课次记录，文件名用编号', async () => {
    const select = await waitFor(() => personSelect(), '参与者下拉框');
    await act(async () => {
      select.value = 's1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => api.exportTable.mock.calls.some(c => c[1].participant_id === 's1'), '按人预览');
    expect(document.body.textContent).toContain('课次记录是全班的，不含');

    const button = await waitFor(() => buttonWith('导出 SAL01 的全部数据'), '一键导出按钮');
    let downloaded: HTMLAnchorElement | null = null;
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement) { downloaded = this; });
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await waitFor(() => api.exportDownload.mock.calls.length > 0, '导出请求');
    const payload = api.exportDownload.mock.calls[0][1];
    expect(payload.participant_id).toBe('s1');
    expect(payload.datasets).toEqual(['notes', 'interactions']);
    await waitFor(() => downloaded, '下载');
    expect(downloaded!.download).toMatch(/^SAL01_export_\d{4}-\d{2}-\d{2}\.zip$/);
  });
});
