// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { anonymousNames, bucketTimeline, circleLayout, dayLabel, labelWidth, linkPath, networkViewBox, nodeLabel, percent, sinceLabel } from './analyticsModel';

/**
 * 知识空间的「讨论分析」（2026-10-09）：纯函数，加上挂真组件看几个关键交互。
 * 接口换成假的；服务端口径见 api/src/services/spaceAnalytics.test.ts。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.hoisted(() => ({
  spaceAnalytics: { overview: vi.fn(), student: vi.fn(), wordCloud: vi.fn(), discussion: vi.fn(), changes: vi.fn(), peers:vi.fn(), topics:vi.fn(), saveTopics:vi.fn() },
}));
vi.mock('../../services/apiClient', () => api);

import SpaceAnalytics from './SpaceAnalytics';

describe('analyticsModel', () => {
  it('匿名编号按姓名排，不按参与多少', () => {
    const names = anonymousNames([{ id: 'b', name: '博文' }, { id: 'a', name: '艾米' }, { id: 'c', name: '蔡蔡' }], 'zh');
    const sorted = ['艾米', '博文', '蔡蔡'].sort((x, y) => x.localeCompare(y, 'zh'));
    expect(names.get({ 艾米: 'a', 博文: 'b', 蔡蔡: 'c' }[sorted[0]]!)).toBe('同学 1');
    expect(new Set(names.values()).size).toBe(3);
    expect(anonymousNames([{ id: 'x', name: 'Ann' }], 'en').get('x')).toBe('Student 1');
  });

  it('日期：今天、昨天、几天前，再早写日期；没发过言写「还没发言」', () => {
    const now = new Date(2026, 9, 9, 15);
    expect(sinceLabel(new Date(2026, 9, 9, 8).toISOString(), 'zh', now)).toBe('今天');
    expect(sinceLabel(new Date(2026, 9, 8, 23).toISOString(), 'zh', now)).toBe('昨天');
    expect(sinceLabel(new Date(2026, 9, 5, 10).toISOString(), 'zh', now)).toBe('4 天前');
    expect(sinceLabel(new Date(2026, 8, 20, 10).toISOString(), 'zh', now)).toBe('9月20日');
    expect(sinceLabel(null, 'zh', now)).toBe('还没发言');
    expect(dayLabel('2026-10-09', 'en')).toBe('Oct 9');
  });

  it('互动图：排成一圈、说得多的圆大；连线从圆边到圆边', () => {
    const placed = circleLayout([{ id: 'a', weight: 10 }, { id: 'b', weight: 1 }, { id: 'c', weight: 0 }], 400);
    expect(placed).toHaveLength(3);
    expect(placed[0].r).toBeGreaterThan(placed[1].r);
    expect(placed[0].y).toBeLessThan(200);
    expect(linkPath(placed[0], placed[1], 400)).toMatch(/^M[\d.]+,[\d.]+ Q[\d.]+,[\d.]+ [\d.]+,[\d.]+$/);
    expect(circleLayout([{ id: 'solo', weight: 3 }], 400)[0]).toMatchObject({ x: 200, y: 200 });
  });

  it('互动图的名字：放在圆外侧，viewBox 把左右两边的长名字也框进来', () => {
    const placed = circleLayout(Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, weight: 1 })), 420);
    const labels = placed.map(p => ({ ...nodeLabel(p, 420, 13), width: labelWidth('欧阳娜娜', 13) }));
    expect(labels.map(l => l.anchor)).toEqual(['middle', 'start', 'middle', 'end']);
    expect(labels[0].y).toBeLessThan(placed[0].y - placed[0].r);
    const [minX, , width] = networkViewBox(placed, labels, 420, 13).split(' ').map(Number);
    expect(minX).toBeLessThan(placed[3].x - placed[3].r - labelWidth('欧阳娜娜', 13));
    expect(minX + width).toBeGreaterThan(placed[1].x + placed[1].r + labelWidth('欧阳娜娜', 13));
    expect(labelWidth('Amy', 10)).toBeCloseTo(18);
  });

  it('走势超过 60 天按周合并；百分比分母为 0 时没有', () => {
    const days = Array.from({ length: 70 }, (_, i) => ({ day: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, notes: 1, buildOns: 2 }));
    const weekly = bucketTimeline(days, ['notes', 'buildOns']);
    expect(weekly).toHaveLength(10);
    expect(weekly[0]).toMatchObject({ notes: 7, buildOns: 14 });
    expect(bucketTimeline(days.slice(0, 10), ['notes'])).toHaveLength(10);
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 0)).toBeNull();
  });
});

const OVERVIEW = {
  overview: {
    summary: {
      students: 3, activeStudents: 2, quietStudents: 1, notes: 4, teacherNotes: 1, riseAbove: 0, buildOns: 3, unanswered: 1, chars: 320,
      feedback: { total: 2, adopted: 1, rejected: 1, ignored: 0, pending: 0 }, aiUse: 5, firstAt: '2026-10-01T09:00:00Z', lastAt: '2026-10-09T09:00:00Z',
    },
    timeline: [{ day: '2026-10-08', notes: 1, buildOns: 1, active: 2 }, { day: '2026-10-09', notes: 2, buildOns: 2, active: 2 }],
    participation: [
      { userId: 'amy', name: '艾米', avatar: null, notes: 3, buildOnsGiven: 2, buildOnsReceived: 1, chars: 200, scaffolds: 1, lastAt: '2026-10-09T09:00:00Z', quiet: false, aiFeedback: { received: 1, adopted: 1 }, aiUse: 3 },
      { userId: 'bo', name: '博文', avatar: null, notes: 1, buildOnsGiven: 1, buildOnsReceived: 2, chars: 120, scaffolds: 0, lastAt: '2026-10-08T09:00:00Z', quiet: false, aiFeedback: { received: 1, adopted: 0 }, aiUse: 2 },
      { userId: 'cai', name: '蔡蔡', avatar: null, notes: 0, buildOnsGiven: 0, buildOnsReceived: 0, chars: 0, scaffolds: 0, lastAt: null, quiet: true, aiFeedback: { received: 0, adopted: 0 }, aiUse: 0 },
    ],
    network: { nodes: [{ id: 'amy', name: '艾米', notes: 3, buildOns: 3 }, { id: 'bo', name: '博文', notes: 1, buildOns: 3 }, { id: 'cai', name: '蔡蔡', notes: 0, buildOns: 0 }], links: [{ from: 'amy', to: 'bo', count: 2 }, { from: 'bo', to: 'amy', count: 1 }] },
    unanswered: [{ id: 'n9', title: '还没人回应的那篇', authorId: 'amy', authorName: '艾米', createdAt: '2026-10-07T09:00:00Z' }],
    scaffoldGroups: [{ label: '表达与改进观点', count: 1 }],
    relationTypes: [{ label: 'extend', count: 2 }, { label: 'question', count: 1 }],
  },
  signature: 'x',
  generatedAt: '2026-10-09T12:00:00Z',
};

const STUDENT = {
  student: {
    member: { id: 'bo', name: '博文', avatar: null, isStaff: false },
    summary: { notes: 1, buildOnsGiven: 1, buildOnsReceived: 2, chars: 120, scaffolds: 0, aiUse: 2, firstAt: '2026-10-08T09:00:00Z', lastAt: '2026-10-08T09:00:00Z', quiet: false },
    timeline: [{ day: '2026-10-08', notes: 1, buildOns: 1 }],
    notes: [{ id: 'n2', title: '检索练习', createdAt: '2026-10-08T09:00:00Z', type: 'note', received: 2, scaffolds: 0, chars: 120 }],
    builtOn: [{ userId: 'amy', name: '艾米', count: 1 }],
    builtOnBy: [{ userId: 'amy', name: '艾米', count: 2 }],
    relationTypes: { given: [], received: [] },
    scaffoldGroups: [],
    scaffoldTitles: [],
    feedback: { total: 1, adopted: 0, rejected: 1, ignored: 0, pending: 0, byType: [{ label: 'no_reasoning', count: 1 }] },
    unanswered: 0,
  },
};

const CLOUD = {
  available: true,
  docs: 4,
  terms: [{ word: '检索练习', weight: 1, count: 3, notes: 2, note_ids: ['n2', 'n9'] }],
  cloud: { items: [{ word: '检索练习', weight: 1, size: 60, x: 10, y: 20, w: 240, h: 70, ascent: 66 }], width: 900, height: 380 },
};

const DISCUSSION={members:[{id:'amy',name:'艾米'},{id:'bo',name:'博文'},{id:'cai',name:'蔡蔡'}],notes:[{id:'n2',title:'检索练习',authorId:'bo',createdAt:'2026-10-08T09:00:00Z',type:'note',excerpt:'先试着回忆',selected:true},{id:'n9',title:'还没人回应的那篇',authorId:'amy',createdAt:'2026-10-07T09:00:00Z',type:'note',excerpt:'继续讨论',selected:true}],edges:[{from:'n9',to:'n2',type:'extend',createdAt:'2026-10-08T09:00:00Z'}],pending:[{noteId:'n2',reason:'unanswered'}]};
describe('SpaceAnalytics', () => {
  let host: HTMLDivElement; let root: Root;
  const onClose=vi.fn(), onLocateNote=vi.fn();
  beforeEach(()=>{
    sessionStorage.clear();window.history.replaceState({},'',window.location.href);
    api.spaceAnalytics.discussion.mockReset().mockResolvedValue(DISCUSSION);
    api.spaceAnalytics.wordCloud.mockReset().mockResolvedValue(CLOUD);
    api.spaceAnalytics.changes.mockReset().mockResolvedValue({available:true,splitAt:'2026-10-08T00:00:00Z',periods:{before:{docs:1,tokens:5},after:{docs:1,tokens:7}},terms:[{word:'检索练习',before:{count:1,notes:1,note_ids:['n9']},after:{count:2,notes:1,note_ids:['n2']},delta:0}]});
    api.spaceAnalytics.peers.mockReset().mockResolvedValue({available:true,members:DISCUSSION.members.map(m=>({...m,notes:1,peers:0})),connections:[],candidates:[{a:'amy',b:'bo',words:['检索练习'],noteIds:['n9','n2']}],candidateCount:1});
    api.spaceAnalytics.topics.mockReset().mockResolvedValue({available:true,docs:2,students:3,config:{topics:[{id:'t1',title:'记忆',terms:['检索练习']}],revision:'rev-1'},topics:[{id:'t1',title:'记忆',terms:['检索练习'],notes:1,students:1,note_ids:['n2'],peer_note_ids:['n9']}]});
    api.spaceAnalytics.saveTopics.mockReset().mockResolvedValue({revision:'rev-2',topics:[]});
    onClose.mockReset();onLocateNote.mockReset();
    host=document.createElement('div'); document.body.appendChild(host);root=createRoot(host);
  });
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
  const mount=async()=>{await act(async()=>root.render(React.createElement(SpaceAnalytics,{spaceId:'space-1',lang:'zh',viewId:'view-welcome',viewName:'Welcome',onClose,onLocateNote,noteTitles:new Map()})));await act(async()=>{await new Promise(r=>setTimeout(r,0));});};
  const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text))!;
  it('独立分析页使用左侧工具，个人选择跨工具保持，未打开的工具不发请求',async()=>{
    await mount();expect(host.querySelector('main[aria-label="讨论分析"]')).not.toBeNull();
    expect(api.spaceAnalytics.changes).not.toHaveBeenCalled();
    const person=host.querySelector('select[aria-label="对象"]') as HTMLSelectElement;
    await act(async()=>{person.value='bo';person.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>button('关键词变化').click());
    expect((host.querySelector('select[aria-label="对象"]') as HTMLSelectElement).value).toBe('bo');
    expect(api.spaceAnalytics.changes).toHaveBeenLastCalledWith('space-1',expect.objectContaining({authorId:'bo'}));
  });
  it('词语来源在右侧，匿名模式不暴露姓名、标题或正文；定位会返回画布',async()=>{
    await mount();
    const word=host.querySelector('svg[aria-label="学生笔记里的高频词"] text')!;
    await act(async()=>word.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    expect(host.querySelector('aside[aria-label="相关笔记"]')?.textContent).toContain('先试着回忆');
    await act(async()=>{(host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();});
    expect(host.textContent).not.toContain('艾米');expect(host.textContent).not.toContain('博文');
    await act(async()=>word.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    const sources=host.querySelector('aside[aria-label="相关笔记"]')?.textContent;
    expect(sources).not.toContain('先试着回忆');expect(sources).not.toContain('还没人回应的那篇');
    expect(sources).toContain('笔记 1');
    await act(async()=>button('回到画布').click());
    expect(onClose).toHaveBeenCalled();expect(onLocateNote).toHaveBeenCalledWith('n2');
  });

  it('日期筛选使用包含结束日的时间边界，来源选择在范围变化后清空，浏览器返回关闭分析',async()=>{
    await mount();
    await act(async()=>host.querySelector('svg[aria-label="学生笔记里的高频词"] text')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    const until=host.querySelector('input[aria-label="结束日期"]') as HTMLInputElement;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(until,'2026-10-09');until.dispatchEvent(new Event('input',{bubbles:true}));});
    const expected=new Date('2026-10-10T00:00:00').toISOString();
    expect(api.spaceAnalytics.discussion).toHaveBeenLastCalledWith('space-1',expect.objectContaining({until:expected}));
    expect(host.querySelectorAll('.da-source-note').length).toBe(0);
    await act(async()=>window.dispatchEvent(new PopStateEvent('popstate')));
    expect(onClose).toHaveBeenCalled();
  });

  it('讨论脉络按原文阅读，不再重复网络图；同伴候选可查看双方来源',async()=>{
    await mount();await act(async()=>button('讨论脉络').click());
    expect(host.querySelector('.da-thread-timeline')?.textContent).toContain('先试着回忆');
    expect(host.querySelector('.da-relay')).toBeNull();expect(host.querySelector('svg')).toBeNull();
    await act(async()=>button('查看来源').click());expect(host.querySelector('.da-source-note')).not.toBeNull();
    await act(async()=>button('同伴连接').click());await act(async()=>button('可邀请阅读').click());await act(async()=>button('查看双方笔记').click());
    expect(host.querySelectorAll('.da-source-note')).toHaveLength(2);
  });
  it('教师可保存主题关键词组，图表与同伴阅读均有来源',async()=>{
    await mount();await act(async()=>button('主题覆盖').click());await act(async()=>button('设置主题').click());
    expect(host.querySelector('input[aria-label="主题 1 名称"]')).not.toBeNull();
    await act(async()=>host.querySelector('form.da-topic-editor')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(api.spaceAnalytics.saveTopics).toHaveBeenCalledWith('space-1',[{id:'t1',title:'记忆',terms:['检索练习']}],'rev-1');
    await act(async()=>host.querySelector('svg[aria-label="主题提及范围"] g')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    expect(host.querySelector('.da-source-note')?.textContent).toContain('先试着回忆');
  });

  it('可展开筛选，收起后保留个人选择，切换工具不重置筛选',async()=>{
    await mount();
    const toggle=button('筛选');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const filterId=toggle.getAttribute('aria-controls')!;
    expect(document.getElementById(filterId)?.getAttribute('aria-label')).toBe('筛选');
    await act(async()=>toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const person=host.querySelector('select[aria-label="对象"]') as HTMLSelectElement;
    await act(async()=>{person.value='bo';person.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>toggle.click());
    await act(async()=>button('关键词变化').click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(person.value).toBe('bo');
    expect(api.spaceAnalytics.changes).toHaveBeenLastCalledWith('space-1',expect.objectContaining({authorId:'bo'}));
  });

  it('React StrictMode 不会重复增加分析的浏览器历史入口',async()=>{
    const push=vi.spyOn(window.history,'pushState');
    await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(SpaceAnalytics,{spaceId:'space-1',lang:'zh',viewId:null,viewName:'Welcome',onClose,onLocateNote,noteTitles:new Map()}))));
    expect(push).toHaveBeenCalledTimes(1);push.mockRestore();
  });

});
