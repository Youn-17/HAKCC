// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 教师发布的小组任务和组长（2026-10-10）：显示规则、组长权限，挂真组件看面板和发布表单。
 * 接口换成假的；服务端口径见 api/src/routes/groupAssignments.test.ts。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.hoisted(() => ({
  groupAssignments: { forSpace: vi.fn(), listForCourse: vi.fn(), publish: vi.fn(), update: vi.fn(), withdraw: vi.fn() },
}));
vi.mock('../services/apiClient', () => api);
vi.mock('animejs', () => ({
  animate: () => ({ revert() {} }),
  stagger: () => 0,
  createLayout: (root: HTMLElement) => ({ root, record() {}, animate() {}, revert() {} }),
}));

import { assignmentViews, dueLabel, leaderPermissions, placeMember, placementLabel, visibleInView } from './groupAssignmentModel';
import GroupAssignmentPanel from './GroupAssignmentPanel';
import GroupAssignmentPublisher from './GroupAssignmentPublisher';

const SPACE = 'space-1';
const task = (over: Record<string, unknown> = {}) => ({
  id: 'a1', courseId: 'c1', title: '读第三章', content: '读完写观点', requirements: ['写出两个观点', '回应一位同学'], requirementsText: '写出两个观点\n回应一位同学',
  dueAt: null, placement: 'any', spaceId: null, viewId: null, createdAt: '2026-10-10T08:00:00Z', updatedAt: '2026-10-10T08:00:00Z',
  author: { id: 't1', name: '刘老师' }, groups: [{ id: 'g1', name: '第一组' }, { id: 'g2', name: '第二组' }], ...over,
});

describe('显示规则和组长权限', () => {
  const views = [
    { id: 'view-welcome', title: 'Welcome', groupId: null },
    { id: 'v-week3', title: '第3周', groupId: null },
    { id: 'v-g1', title: '第一组', groupId: 'g1' },
    { id: 'v-g2', title: '第二组', groupId: 'g2' },
  ];
  const a = (over: Record<string, unknown>) => ({ placement: 'any' as const, spaceId: null, viewId: null, groups: [{ id: 'g1', name: '第一组' }], ...over }) as Parameters<typeof visibleInView>[0];

  it('any 到处显示；view 只在那个视图，视图删了退回主画布；别的空间不显示', () => {
    expect(visibleInView(a({}), SPACE, 'v-week3', views)).toBe(true);
    expect(visibleInView(a({ spaceId: SPACE }), SPACE, 'v-g1', views)).toBe(true);
    expect(visibleInView(a({ placement: 'view', spaceId: SPACE, viewId: 'v-week3' }), SPACE, 'v-week3', views)).toBe(true);
    expect(visibleInView(a({ placement: 'view', spaceId: SPACE, viewId: 'v-week3' }), SPACE, 'view-welcome', views)).toBe(false);
    expect(visibleInView(a({ placement: 'view', spaceId: SPACE, viewId: 'v-gone' }), SPACE, 'view-welcome', views)).toBe(true);
    expect(visibleInView(a({ placement: 'view', spaceId: SPACE, viewId: 'v-gone' }), SPACE, 'v-week3', views)).toBe(false);
    expect(visibleInView(a({ spaceId: 'other' }), SPACE, 'view-welcome', views)).toBe(false);
  });

  it('各组自己的视图：只在发给的组的视图里；某个组还没有视图，就给它显示在主画布', () => {
    const both = a({ placement: 'group_view', spaceId: SPACE, groups: [{ id: 'g1', name: '第一组' }, { id: 'g2', name: '第二组' }] });
    expect(visibleInView(both, SPACE, 'v-g1', views)).toBe(true);
    expect(visibleInView(both, SPACE, 'v-g2', views)).toBe(true);
    expect(visibleInView(both, SPACE, 'view-welcome', views)).toBe(false);
    expect(visibleInView(both, SPACE, 'v-week3', views)).toBe(false);
    // 学生拿到的 groups 只有自己的组
    const mine = a({ placement: 'group_view', spaceId: SPACE, groups: [{ id: 'g1', name: '第一组' }] });
    expect(visibleInView(mine, SPACE, 'v-g2', views)).toBe(false);
    expect(assignmentViews(mine, SPACE, views)?.map(v => v.id)).toEqual(['v-g1']);
    const noView = a({ placement: 'group_view', spaceId: SPACE, groups: [{ id: 'g3', name: '第三组' }] });
    expect(visibleInView(noView, SPACE, 'view-welcome', views)).toBe(true);
    expect(assignmentViews(a({}), SPACE, views)).toBeNull();
  });

  it('截止时间：24 小时内标 soon，过了标 overdue', () => {
    const now = new Date(2026, 9, 10, 12);
    expect(dueLabel(new Date(2026, 9, 10, 20).toISOString(), 'zh', now)).toEqual({ text: '截止 10月10日 20:00', tone: 'soon' });
    expect(dueLabel(new Date(2026, 9, 20, 8).toISOString(), 'zh', now)?.tone).toBe('normal');
    expect(dueLabel(new Date(2026, 9, 9, 8).toISOString(), 'zh', now)).toMatchObject({ tone: 'overdue' });
    expect(dueLabel(null, 'zh', now)).toBeNull();
    expect(placementLabel({ placement: 'view', spaceId: SPACE, viewId: 'v-week3' }, [{ id: 'v-week3', title: '第3周' }], 'zh')).toBe('第3周');
    expect(placementLabel({ placement: 'any', spaceId: null, viewId: null }, [], 'zh')).toBe('所有视图');
    expect(placementLabel({ placement: 'group_view', spaceId: SPACE, viewId: null }, [], 'zh')).toBe('各组自己的视图');
  });

  it('组长：教职随时可以；组员在没组长时可以定；有组长后只有组长本人能移交、卸任', () => {
    const memberIds = ['a', 'b'];
    expect(leaderPermissions({ isStaff: true, userId: 't', leaderId: 'a', memberIds })).toMatchObject({ canAssign: true, canClear: true });
    expect(leaderPermissions({ isStaff: false, userId: 'b', leaderId: null, memberIds })).toMatchObject({ current: null, canAssign: true, canClear: false });
    expect(leaderPermissions({ isStaff: false, userId: 'b', leaderId: 'a', memberIds })).toMatchObject({ canAssign: false, canClear: false });
    expect(leaderPermissions({ isStaff: false, userId: 'a', leaderId: 'a', memberIds })).toMatchObject({ canAssign: true, canClear: true });
    // 原组长已经不在组里：当作没有
    expect(leaderPermissions({ isStaff: false, userId: 'b', leaderId: 'x', memberIds })).toMatchObject({ current: null, canAssign: true });
    // 组外的人不能定
    expect(leaderPermissions({ isStaff: false, userId: 'z', leaderId: null, memberIds }).canAssign).toBe(false);
  });

  it('移出、移到别组：一个人只在一个组里；组长被移走就没有组长了；放回原组时组长还给他', () => {
    const groups = [
      { id: 'g1', memberIds: ['a', 'b'], leaderId: 'a' },
      { id: 'g2', memberIds: ['c'], leaderId: 'c' },
    ];
    const out = placeMember(groups, 'a', null);
    expect(out).toEqual([{ id: 'g1', memberIds: ['b'], leaderId: undefined }, { id: 'g2', memberIds: ['c'], leaderId: 'c' }]);
    expect(groups[0].memberIds).toEqual(['a', 'b']);
    // 普通组员移出，组长不变
    expect(placeMember(groups, 'b', null)[0]).toEqual({ id: 'g1', memberIds: ['a'], leaderId: 'a' });
    // 组长 a 拖到第二组：第一组没有组长，第二组的组长还是 c
    expect(placeMember(groups, 'a', 'g2')).toEqual([{ id: 'g1', memberIds: ['b'], leaderId: undefined }, { id: 'g2', memberIds: ['c', 'a'], leaderId: 'c' }]);
    // 没成功，放回第一组并把组长还给他
    expect(placeMember(placeMember(groups, 'a', 'g2'), 'a', 'g1', 'g1')).toEqual([{ id: 'g1', memberIds: ['b', 'a'], leaderId: 'a' }, { id: 'g2', memberIds: ['c'], leaderId: 'c' }]);
    // 还没分组的人拖进组
    expect(placeMember(groups, 'z', 'g1')[0].memberIds).toEqual(['a', 'b', 'z']);
  });
});

describe('组件', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    localStorage.clear();
    Object.values(api.groupAssignments).forEach(fn => fn.mockReset());
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
  const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text));

  it('任务面板：只显示当前视图该看到的；可以收起成标签再展开；学生看不到发给哪些组', async () => {
    api.groupAssignments.forSpace.mockResolvedValue({ assignments: [task(), task({ id: 'a2', title: '只在第3周', placement: 'view', spaceId: SPACE, viewId: 'v-week3' })] });
    const props = { spaceId: SPACE, viewId: 'view-welcome', views: [{ id: 'view-welcome', title: 'Welcome' }, { id: 'v-week3', title: '第3周' }], lang: 'zh' as const, isStaff: false };
    await act(async () => { root.render(React.createElement(GroupAssignmentPanel, props)); });
    await settle();
    const text = host.textContent ?? '';
    expect(text).toContain('读第三章');
    expect(text).toContain('回应一位同学');
    expect(text).not.toContain('只在第3周');
    expect(text).not.toContain('发给 第一组');
    expect(host.querySelector('[data-canvas-overlay]')).toBeTruthy();
    await act(async () => { (host.querySelector('button[aria-label="收起小组任务"]') as HTMLButtonElement).click(); });
    expect(host.textContent).not.toContain('回应一位同学');
    expect(button('小组任务')!.textContent).toContain('1');
    await act(async () => { button('小组任务')!.click(); });
    expect(host.textContent).toContain('回应一位同学');
    // 换到第3周：两条都在
    await act(async () => { root.render(React.createElement(GroupAssignmentPanel, { ...props, viewId: 'v-week3' })); });
    expect(host.textContent).toContain('只在第3周');
  });

  it('任务面板：教职看得到发给哪些组；没有任务时什么都不显示', async () => {
    api.groupAssignments.forSpace.mockResolvedValueOnce({ assignments: [task()] });
    await act(async () => { root.render(React.createElement(GroupAssignmentPanel, { spaceId: SPACE, viewId: 'view-welcome', views: [{ id: 'view-welcome', title: 'Welcome' }], lang: 'zh', isStaff: true, onManage: () => {} })); });
    await settle();
    expect(host.textContent).toContain('发给 第一组、第二组');
    expect(button('管理')).toBeTruthy();
    await act(async () => root.unmount());
    root = createRoot(host);
    api.groupAssignments.forSpace.mockResolvedValueOnce({ assignments: [] });
    await act(async () => { root.render(React.createElement(GroupAssignmentPanel, { spaceId: SPACE, viewId: 'view-welcome', views: [], lang: 'zh', isStaff: false })); });
    await settle();
    expect(host.innerHTML).toBe('');
  });

  it('发布：默认发给全部小组；选了视图就带上当前空间和视图；发布后通知工作区', async () => {
    api.groupAssignments.listForCourse.mockResolvedValue({ assignments: [] });
    api.groupAssignments.publish.mockImplementation(async (_c: string, body: Record<string, unknown>) => ({ assignment: task({ id: 'new', title: body.title, groups: [{ id: 'g1', name: '第一组' }, { id: 'g2', name: '第二组' }] }) }));
    const onChanged = vi.fn();
    await act(async () => {
      root.render(React.createElement(GroupAssignmentPublisher, {
        courseId: 'c1', groups: [{ id: 'g1', name: '第一组' }, { id: 'g2', name: '第二组' }],
        views: [{ id: 'view-welcome', title: 'Welcome' }, { id: 'v-week3', title: '第3周' }], spaceId: SPACE, lang: 'zh', onChanged,
      }));
    });
    await settle();
    const title = host.querySelector('input:not([type])') as HTMLInputElement;
    const setValue = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => {
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    await act(async () => { setValue(title, '第3周任务'); });
    await act(async () => { setValue(host.querySelector('select')!, 'view:v-week3'); });
    expect(button('发布给 2 个小组')).toBeTruthy();
    await act(async () => { (host.querySelector('form') as HTMLFormElement).requestSubmit(); });
    await settle();
    expect(api.groupAssignments.publish).toHaveBeenCalledWith('c1', expect.objectContaining({ title: '第3周任务', group_ids: ['g1', 'g2'], placement: 'view', space_id: SPACE, view_id: 'v-week3' }));
    expect(onChanged).toHaveBeenCalled();
    expect(host.textContent).toContain('已发布给 2 个小组');
  });

  it('学生在主画布、任务在本组视图：显示「在『第一组』」的提示，点了去那个视图', async () => {
    api.groupAssignments.forSpace.mockResolvedValue({ assignments: [task({ placement: 'group_view', spaceId: SPACE, groups: [{ id: 'g1', name: '第一组' }] })] });
    const onGoToView = vi.fn();
    const views = [{ id: 'view-welcome', title: 'Welcome' }, { id: 'v-g1', title: '第一组', groupId: 'g1' }];
    await act(async () => { root.render(React.createElement(GroupAssignmentPanel, { spaceId: SPACE, viewId: 'view-welcome', views, lang: 'zh', isStaff: false, onGoToView })); });
    await settle();
    expect(host.textContent).toContain('1 个小组任务在「第一组」');
    expect(host.textContent).not.toContain('读完写观点');
    await act(async () => { button('前往')!.click(); });
    expect(onGoToView).toHaveBeenCalledWith('v-g1');
    await act(async () => { root.render(React.createElement(GroupAssignmentPanel, { spaceId: SPACE, viewId: 'v-g1', views, lang: 'zh', isStaff: false, onGoToView })); });
    expect(host.textContent).toContain('读完写观点');
  });

  it('发布：空间里有各组的视图才能选「各组自己的视图」，选了带上 placement=group_view', async () => {
    api.groupAssignments.listForCourse.mockResolvedValue({ assignments: [] });
    api.groupAssignments.publish.mockResolvedValue({ assignment: task({ id: 'gv' }) });
    const render = async (views: Array<{ id: string; title: string; groupId?: string | null }>) => {
      await act(async () => { root.render(React.createElement(GroupAssignmentPublisher, { courseId: 'c1', groups: [{ id: 'g1', name: '第一组' }], views, spaceId: SPACE, lang: 'zh' })); });
      await settle();
    };
    await render([{ id: 'view-welcome', title: 'Welcome' }]);
    expect((host.querySelector('option[value="group_view"]') as HTMLOptionElement).disabled).toBe(true);
    await render([{ id: 'view-welcome', title: 'Welcome' }, { id: 'v-g1', title: '第一组', groupId: 'g1' }]);
    const option = host.querySelector('option[value="group_view"]') as HTMLOptionElement;
    expect(option.disabled).toBe(false);
    const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    await act(async () => { setValue(host.querySelector('input:not([type])') as HTMLInputElement, '各组讨论'); });
    await act(async () => { setValue(host.querySelector('select')!, 'group_view'); });
    await act(async () => { (host.querySelector('form') as HTMLFormElement).requestSubmit(); });
    await settle();
    expect(api.groupAssignments.publish).toHaveBeenCalledWith('c1', expect.objectContaining({ placement: 'group_view', space_id: SPACE, view_id: null }));
  });

  it('撤回要先确认', async () => {
    api.groupAssignments.listForCourse.mockResolvedValue({ assignments: [task()] });
    api.groupAssignments.withdraw.mockResolvedValue({ ok: true });
    await act(async () => {
      root.render(React.createElement(GroupAssignmentPublisher, { courseId: 'c1', groups: [{ id: 'g1', name: '第一组' }], views: [], spaceId: SPACE, lang: 'zh' }));
    });
    await settle();
    await act(async () => { button('撤回')!.click(); });
    expect(api.groupAssignments.withdraw).not.toHaveBeenCalled();
    expect(host.textContent).toContain('确定撤回');
    const confirm = [...host.querySelectorAll('button')].filter(b => b.textContent === '撤回').at(-1)!;
    await act(async () => { confirm.click(); });
    await settle();
    expect(api.groupAssignments.withdraw).toHaveBeenCalledWith('a1');
    expect(host.textContent).not.toContain('读第三章');
  });
});
