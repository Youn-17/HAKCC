// @vitest-environment jsdom
/**
 * 学生求助时，前端会把最近几次报错（clientDiagnostics）随问题一起存下；
 * 研究导出里有这一列（ctx_recent_errors），教师的求助收件箱却从没显示过。
 * 学生说「点了没反应」时，答案往往就在这几行里。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { list: vi.fn(), answer: vi.fn() };
});

vi.mock('../../services/apiClient', () => ({
  support: { list: api.list, answer: api.answer },
}));

import StudentHelpDesk, { readRecentErrors } from './StudentHelpDesk';

describe('readRecentErrors：处境是客户端送来的 JSON，逐项校验', () => {
  it('正常的记录原样取出', () => {
    const ctx = { recentFailures: [
      { at: '2026-09-28T02:00:00.000Z', kind: 'api', detail: 'POST /notes → 500 Internal error' },
    ] };
    expect(readRecentErrors(ctx)).toEqual([
      { at: '2026-09-28T02:00:00.000Z', kind: 'api', detail: 'POST /notes → 500 Internal error' },
    ]);
  });

  it('没有这一项、不是数组、元素形状不对，都不会让页面崩', () => {
    expect(readRecentErrors(undefined)).toEqual([]);
    expect(readRecentErrors({})).toEqual([]);
    expect(readRecentErrors({ recentFailures: 'oops' })).toEqual([]);
    expect(readRecentErrors({ recentFailures: [null, 3, 'x', { detail: 42 }, { detail: '' }] })).toEqual([]);
  });

  it('缺时间或类型的照样显示报错内容', () => {
    expect(readRecentErrors({ recentFailures: [{ detail: 'Script error' }] }))
      .toEqual([{ at: '', kind: '', detail: 'Script error' }]);
  });
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
});

describe('收件箱里看得到这些报错', () => {
  it('折叠按钮提示有几条报错，展开后逐条显示，并写明离提问多久', async () => {
    api.list.mockResolvedValue({
      counts: { total: 1, waiting: 1, answered: 0, solvedByAi: 0 },
      questions: [{
        id: 'q-1', courseId: 'course-1', spaceId: 'space-1', userId: 'stu-1', userName: '学生甲',
        question: '点了保存没反应', aiAnswer: '先刷新试试', aiProvider: null, aiModel: null, aiResolved: false,
        escalatedAt: '2026-09-28T02:05:00.000Z', escalationNote: null, teacherAnswer: null, teacherAnsweredAt: null,
        status: 'escalated', attachments: [],
        context: {
          path: '/workspace/course-1',
          recentFailures: [
            { at: '2026-09-28T01:57:00.000Z', kind: 'api', detail: 'PUT /notes/n-1 → 500 relation does not exist' },
            { at: '2026-09-28T02:00:00.000Z', kind: 'script', detail: 'TypeError: x is undefined' },
          ],
        },
        createdAt: '2026-09-28T02:00:00.000Z', updatedAt: '2026-09-28T02:05:00.000Z',
      }],
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(React.createElement(StudentHelpDesk, { courseId: 'course-1', lang: 'zh' }));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const toggle = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('提问时的处境'))!;
    expect(toggle.textContent).toContain('2 条报错');
    expect(host.textContent).not.toContain('relation does not exist');

    await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const text = host.textContent ?? '';
    expect(text).toContain('提问前最近的报错');
    expect(text).toContain('PUT /notes/n-1 → 500 relation does not exist');
    expect(text).toContain('TypeError: x is undefined');
    expect(text).toContain('提问前 3 分钟');
    expect(text).toContain('提问时');
    expect(text).toContain('接口');
    expect(text).toContain('脚本');
  });
});
