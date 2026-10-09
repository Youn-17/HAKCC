import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase', () => ({ supabase: {} }));

import { buildOverview, buildStudentDetail, inView, wordCloudDocs, type AnalyticsInput, type AnalyticsNote } from './spaceAnalytics';

/**
 * 讨论分析的口径（2026-10-09）：学生是谁、什么算回应、谁算最近没发言、词云读哪些字。
 * 数据都是编的。
 */

const NOW = new Date('2026-10-09T12:00:00Z');
const day = (offset: number, hour = 9) => new Date(Date.UTC(2026, 9, 9 + offset, hour)).toISOString();

const note = (id: string, authorId: string, created: string, over: Partial<AnalyticsNote> = {}): AnalyticsNote => ({
  id, title: `标题${id}`, content: `<p>${id} 的内容，写了一些自己的想法</p>`, authorId, authorName: null,
  createdAt: created, updatedAt: created, type: 'note', aiGenerated: false, views: [], ...over,
});

function input(): AnalyticsInput {
  return {
    members: [
      { id: 'amy', name: '艾米', avatar: null, isStaff: false },
      { id: 'bo', name: '博文', avatar: null, isStaff: false },
      { id: 'cai', name: '蔡蔡', avatar: null, isStaff: false },
      { id: 'dan', name: '丹丹', avatar: null, isStaff: false },
      { id: 't1', name: '刘老师', avatar: null, isStaff: true },
    ],
    notes: [
      // 存进库的正文是编辑区的 innerHTML：空属性序列化成 =""
      note('n1', 'amy', day(-10), { content: `<div data-scaffold-id="sc-1"><strong data-scaffold-tag="">我的想法/观点是</strong><span data-scaffold-input="">AI 会让人懒得想</span></div><p>因为直接给答案</p>` }),
      note('n2', 'bo', day(-9)),
      note('n3', 'bo', day(-1)),
      note('n4', 'amy', day(-2), { content: '<p>我的回应</p><blockquote data-ai-source="genai">AI 说的一大段话</blockquote>' }),
      note('n5', 'cai', day(-20)),
      note('t-n', 't1', day(-12)),
      note('ai-n', 'amy', day(-1), { aiGenerated: true }),
      note('view-card', 'amy', day(-1), { type: 'view' }),
      note('ra', 'bo', day(0), { type: 'riseabove' }),
    ],
    relations: [
      // 博文回应艾米（n2 → n1）
      { source: 'n2', target: 'n1', type: 'extend', createdAt: day(-9), aiSuggested: false, aiAccepted: null },
      // 艾米回应博文（n4 → n2）
      { source: 'n4', target: 'n2', type: 'question', createdAt: day(-2), aiSuggested: false, aiAccepted: null },
      // 博文接着自己写（n3 → n2）：不算回应别人
      { source: 'n3', target: 'n2', type: 'extend', createdAt: day(-1), aiSuggested: false, aiAccepted: null },
      // AI 建议、没采纳：不算
      { source: 'n5', target: 'n3', type: 'extend', createdAt: day(-1), aiSuggested: true, aiAccepted: false },
    ],
    feedbacks: [
      { noteId: 'n1', userId: 'amy', status: 'accepted', triggerType: 'no_evidence', createdAt: day(-10) },
      { noteId: 'n2', userId: 'bo', status: 'rejected', triggerType: 'no_reasoning', createdAt: day(-9) },
      { noteId: 'n3', userId: 'bo', status: 'new', triggerType: 'unclear', createdAt: day(-1) },
    ],
    aiUse: new Map([['amy', 4]]),
    scaffolds: new Map([['sc-1', { title: '我的想法/观点是', group: '表达与改进观点' }]]),
    now: NOW,
  };
}

describe('buildOverview', () => {
  const o = buildOverview(input());

  it('学生是不是教职的成员，没发过言的也列出来；教师、AI 生成的笔记、视图卡不算进学生统计', () => {
    expect(o.participation.map(p => p.userId).sort()).toEqual(['amy', 'bo', 'cai', 'dan']);
    expect(o.summary).toMatchObject({ students: 4, activeStudents: 3, notes: 6, teacherNotes: 1, riseAbove: 1 });
    expect(o.participation.find(p => p.userId === 'dan')).toMatchObject({ notes: 0, lastAt: null, quiet: true });
  });

  it('回应记在写回应的人头上；接着自己写不算回应别人，也不算被回应；没采纳的 AI 建议不算', () => {
    const amy = o.participation.find(p => p.userId === 'amy')!;
    const bo = o.participation.find(p => p.userId === 'bo')!;
    expect(amy).toMatchObject({ buildOnsGiven: 1, buildOnsReceived: 1 });
    expect(bo).toMatchObject({ buildOnsGiven: 1, buildOnsReceived: 1 });
    expect(o.summary.buildOns).toBe(3);
    expect(o.network.links).toEqual(expect.arrayContaining([{ from: 'bo', to: 'amy', count: 1 }, { from: 'amy', to: 'bo', count: 1 }]));
    expect(o.network.links).toHaveLength(2);
  });

  it('七天没发言的标出来；还没人回应的笔记最早的在前（被自己接着写的不算有人回应）', () => {
    expect(o.participation.find(p => p.userId === 'cai')).toMatchObject({ quiet: true, notes: 1 });
    expect(o.participation.find(p => p.userId === 'bo')).toMatchObject({ quiet: false });
    expect(o.unanswered.map(n => n.id)).toEqual(['n5', 'n4', 'n3', 'ra']);
    expect(o.summary.unanswered).toBe(4);
  });

  it('字数只算学生自己写的：支架话头、插入的 AI 内容不算；支架按组统计', () => {
    const amy = o.participation.find(p => p.userId === 'amy')!;
    expect(amy.chars).toBe('AI会让人懒得想因为直接给答案'.length + '我的回应'.length);
    expect(amy.scaffolds).toBe(1);
    expect(o.scaffoldGroups).toEqual([{ label: '表达与改进观点', count: 1 }]);
  });

  it('AI 反馈：采纳、不同意、待处理分开数；走势至少一周，按天排', () => {
    expect(o.summary.feedback).toEqual({ total: 3, adopted: 1, rejected: 1, ignored: 0, pending: 1 });
    expect(o.timeline.length).toBeGreaterThanOrEqual(7);
    expect(o.timeline.at(-1)!.day).toBe('2026-10-09');
    expect(o.timeline.find(t => t.day === '2026-10-08')).toMatchObject({ notes: 1, buildOns: 1 });
    expect(o.relationTypes).toEqual(expect.arrayContaining([{ label: 'extend', count: 2 }, { label: 'question', count: 1 }]));
  });
});

describe('buildStudentDetail', () => {
  it('一个学生：回应了谁、被谁回应、笔记各有几个回应、支架和 AI 反馈', () => {
    const d = buildStudentDetail(input(), 'amy');
    expect(d.member).toMatchObject({ id: 'amy', name: '艾米' });
    expect(d.summary).toMatchObject({ notes: 2, buildOnsGiven: 1, buildOnsReceived: 1, scaffolds: 1, aiUse: 4, quiet: false });
    expect(d.builtOn).toEqual([{ userId: 'bo', name: '博文', count: 1 }]);
    expect(d.builtOnBy).toEqual([{ userId: 'bo', name: '博文', count: 1 }]);
    expect(d.notes.map(n => [n.id, n.received])).toEqual([['n4', 0], ['n1', 1]]);
    expect(d.scaffoldTitles).toEqual([{ label: '我的想法/观点是', count: 1 }]);
    expect(d.feedback).toMatchObject({ total: 1, adopted: 1, byType: [{ label: 'no_evidence', count: 1 }] });
    expect(d.unanswered).toBe(1);
  });

  it('没发过言的学生也能看，全是零', () => {
    expect(buildStudentDetail(input(), 'dan').summary).toMatchObject({ notes: 0, buildOnsGiven: 0, lastAt: null, quiet: true });
  });
});

describe('词云读哪些字、视图怎么筛', () => {
  it('学生写的笔记：标题加自己写的正文；AI 生成的、教师的不算；可以只看一个人', () => {
    const docs = wordCloudDocs(input());
    expect(docs.map(d => d.id).sort()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'ra']);
    const n4 = docs.find(d => d.id === 'n4')!;
    expect(n4.text).toContain('我的回应');
    expect(n4.text).not.toContain('AI 说的一大段话');
    expect(docs.find(d => d.id === 'n1')!.text).not.toContain('我的想法/观点是');
    expect(wordCloudDocs(input(), 'bo').map(d => d.id).sort()).toEqual(['n2', 'n3', 'ra']);
  });

  it('视图：笔记的 views 里有它；主画布还收没有归属、归属的视图已删掉的笔记', () => {
    const existing = new Set(['v1']);
    expect(inView({ views: ['v1'] }, 'v1', existing)).toBe(true);
    expect(inView({ views: [] }, 'v1', existing)).toBe(false);
    expect(inView({ views: [] }, 'view-welcome', existing)).toBe(true);
    expect(inView({ views: ['gone'] }, 'view-welcome', existing)).toBe(true);
    expect(inView({ views: ['v1'] }, 'view-welcome', existing)).toBe(false);
    expect(inView({ views: ['v1'] }, null, existing)).toBe(true);
  });
});
