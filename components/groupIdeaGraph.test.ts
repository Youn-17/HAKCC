// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 观点图谱面板（2026-10-11）：每周一期，能切到往期；点一个观点，右边栏列出相关笔记；
 * 回到最新不用重新取；画布按观点（不是按各期的编号）对上同一个圆。接口和 anime.js 换成假的。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.hoisted(() => ({ groups: { ideaGraph: vi.fn(), ideaGraphSnapshot: vi.fn(), refreshIdeaGraph: vi.fn() } }));
vi.mock('../services/apiClient', () => api);
vi.mock('animejs', () => ({
  animate: (target: Record<string, number>, params: Record<string, any>) => {
    target.t = 1;
    params.onUpdate?.();
    params.onComplete?.();
    return { pause() {}, revert() {} };
  },
  createLayout: () => ({ record() {}, animate() {}, revert() {} }),
}));

import GroupIdeaGraph from './GroupIdeaGraph';
import { interpolateFrame } from './IdeaGraphCanvas';

const concept = (id: string, term: string, noteIds: string[], authorCount: number, extra: Record<string, unknown> = {}) =>
  ({ id, term, noteIds, authorCount, score: 1, delta: null, isNew: false, ...extra });
const payload = (concepts: ReturnType<typeof concept>[], headline: string) => ({
  concepts,
  conceptLinks: [],
  notes: [
    { id: 'n1', title: '认知卸载会不会让人变懒', author: '陈同学', createdAt: '2026-10-02T00:00:00Z', conceptIds: [], builtOnBy: 0, buildsOn: 0, isAiGenerated: false },
    { id: 'n2', title: '提问引导的例子', author: '王同学', createdAt: '2026-10-03T00:00:00Z', conceptIds: [], builtOnBy: 0, buildsOn: 0, isAiGenerated: false },
    { id: 'n3', title: '苏格拉底式提问', author: '李同学', createdAt: '2026-10-09T00:00:00Z', conceptIds: [], builtOnBy: 0, buildsOn: 0, isAiGenerated: false },
  ],
  progress: { questions: [], unanswered: [], growing: [], chains: [], headline },
  stats: { noteCount: 3, newNoteCount: 1, memberCount: 3, activeMemberCount: 2, buildOnCount: 0, buildOnByMembers: 0, aiNoteCount: 0 },
});
const snapshot = (id: string, start: string, end: string, p: ReturnType<typeof payload>, trigger = 'auto') =>
  ({ id, generated_at: end, window_start: start, window_end: end, note_count: 3, payload: p, trigger });

const week1 = snapshot('s1', '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z', payload([
  concept('c0', '认知卸载', ['n1', 'n2'], 2), concept('c1', '提问引导', ['n2'], 1), concept('c2', '早期观点', ['n1'], 1),
], '第一周'));
const week2 = snapshot('s2', '2026-10-08T00:00:00Z', '2026-10-15T00:00:00Z', payload([
  concept('c0', '提问引导', ['n2', 'n3'], 2), concept('c1', '认知卸载', ['n1', 'n2'], 2), concept('c2', '苏格拉底', ['n3'], 1, { isNew: true }),
], '第二周'));
const summary = (s: typeof week1) => ({ id: s.id, generated_at: s.generated_at, window_start: s.window_start, window_end: s.window_end, note_count: s.note_count, trigger: s.trigger });

describe('观点图谱面板', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    api.groups.ideaGraph.mockReset().mockResolvedValue({ graph: week2, periodDays: 7, regenerated: false, history: [summary(week2), summary(week1)] });
    api.groups.ideaGraphSnapshot.mockReset().mockResolvedValue({ graph: week1 });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const render = () => act(async () => {
    root.render(React.createElement(GroupIdeaGraph, { groupId: 'g1', groupName: '第一组', lang: 'zh', isTeacher: false, onClose: () => {}, onLocateNote: vi.fn() }));
  });
  const nodeLabels = () => [...host.querySelectorAll('svg [role="button"]')].map(n => n.getAttribute('aria-label')?.split('，')[0]);
  const chip = (text: string) => [...host.querySelectorAll('[role="tab"]')].find(b => b.textContent?.includes(text)) as HTMLButtonElement;

  it('打开显示最新一期和往期；切到上一周取那一期的图，同名观点还是同一个圆；回到最新不重新取', async () => {
    await render();
    expect(host.textContent).toContain('第二周');
    expect(nodeLabels().sort()).toEqual(['提问引导', '苏格拉底', '认知卸载'].sort());
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].textContent).toContain('最新');
    const before = [...host.querySelectorAll('svg [role="button"]')].find(n => n.getAttribute('aria-label')?.startsWith('认知卸载'));

    await act(async () => { chip('10/1').click(); });
    expect(api.groups.ideaGraphSnapshot).toHaveBeenCalledWith('g1', 's1');
    expect(host.textContent).toContain('第一周');
    expect(host.textContent).toContain('往期');
    expect(nodeLabels().sort()).toEqual(['提问引导', '早期观点', '认知卸载'].sort());
    const after = [...host.querySelectorAll('svg [role="button"]')].find(n => n.getAttribute('aria-label')?.startsWith('认知卸载'));
    expect(after).toBe(before);

    const back = [...host.querySelectorAll('button')].find(b => b.textContent === '回到最新')!;
    await act(async () => { back.click(); });
    expect(host.textContent).toContain('第二周');
    expect(api.groups.ideaGraphSnapshot).toHaveBeenCalledTimes(1);
  });

  it('点一个观点：右边栏列出它的笔记，点笔记回到画布；再点一下收起', async () => {
    await render();
    const node = [...host.querySelectorAll('svg [role="button"]')].find(n => n.getAttribute('aria-label')?.startsWith('认知卸载')) as SVGGElement;
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const aside = host.querySelector('aside')!;
    expect(aside.textContent).toContain('「认知卸载」');
    expect(aside.textContent).toContain('认知卸载会不会让人变懒');
    expect(aside.textContent).toContain('提问引导的例子');
    expect(node.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(host.querySelector('aside')!.textContent).not.toContain('「认知卸载」');
  });

  it('往期取不到时提示，图留在原来那一期', async () => {
    api.groups.ideaGraphSnapshot.mockRejectedValueOnce(new Error('500'));
    await render();
    await act(async () => { chip('10/1').click(); });
    expect(host.textContent).toContain('这一期没能打开');
    expect(host.textContent).toContain('第二周');
  });
});

describe('过渡的中间状态', () => {
  it('t=0 是起点、t=1 是终点；新连线后半段才淡入，要消失的连线前半段就淡出', () => {
    const node = { term: 'a', delay: 0 } as never;
    const links = [{ key: 'a|b' }, { key: 'a|c' }] as never;
    const from = { nodes: new Map([['a', { x: 0, y: 0, s: 0.4, o: 0 }]]), links: new Map([['a|b', 0], ['a|c', 1]]), viewBox: { x: 0, y: 0, width: 100, height: 60 } };
    const to = { nodes: new Map([['a', { x: 100, y: 50, s: 1, o: 1 }]]), links: new Map([['a|b', 1], ['a|c', 0]]), viewBox: { x: 10, y: 0, width: 120, height: 72 } };
    const start = interpolateFrame(from, to, 0, [node], links, 600, false);
    expect(start.nodes.get('a')).toEqual({ x: 0, y: 0, s: 0.4, o: 0 });
    const mid = interpolateFrame(from, to, 0.3, [node], links, 600, false);
    expect(mid.links.get('a|b')).toBe(0);
    expect(mid.links.get('a|c')!).toBeLessThan(0.5);
    const end = interpolateFrame(from, to, 1, [node], links, 600, false);
    expect(end.nodes.get('a')).toEqual({ x: 100, y: 50, s: 1, o: 1 });
    expect(end.links.get('a|b')).toBe(1);
    expect(end.links.get('a|c')).toBe(0);
    expect(end.viewBox).toEqual(to.viewBox);
  });
});
