import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase', () => ({ supabase: {} }));

import { collectGroupQuestions, computeIdeaGraph, weeklyWindowsDue, type IdeaGraphSource } from './groupIdeaGraph';

const note = (id: string, title: string, created_at: string, author_name = '同学') => ({ id, title, created_at, author_name });

describe('questions raised in the group', () => {
  it('lists each question once, newest first, from titles only', () => {
    // 只看标题。笔记上抄的空间共同问题（inquiry_question）根本不传进来
    const notes = [
      note('a', '生成式 AI 会让我们更会思考吗？', '2026-09-20T08:00:00Z'),
      note('b', '我试过先写提纲再问 AI', '2026-09-21T08:00:00Z'),
      note('c', '生成式 AI 会让我们更会思考吗？', '2026-09-22T08:00:00Z'),
      note('d', '「自己思考」具体指什么？', '2026-09-23T08:00:00Z'),
    ];
    const questions = collectGroupQuestions(notes, new Map([['a', 1]]));
    expect(questions.map(q => q.title)).toEqual(['「自己思考」具体指什么？', '生成式 AI 会让我们更会思考吗？']);
    // 重复的那句只列最新的一条；任何一条被接过都算已被建构
    expect(questions[1]).toMatchObject({ noteId: 'c', answered: true });
  });

  it('accepts both half- and full-width question marks and trims trailing space', () => {
    const questions = collectGroupQuestions([
      note('a', 'Does it understand?  ', '2026-09-20T08:00:00Z'),
      note('b', '它懂吗？', '2026-09-21T08:00:00Z'),
      note('c', '它懂', '2026-09-22T08:00:00Z'),
    ], new Map());
    expect(questions.map(q => q.noteId)).toEqual(['b', 'a']);
  });
});

describe('每周一期：该补哪几期（2026-10-11）', () => {
  const d = (s: string) => new Date(s);
  const iso = (dates: Date[]) => dates.map(x => x.toISOString());

  it('一期都没有：从建组日起每 7 天一格，补到现在为止走完的格子；不满一格的那一段不出', () => {
    expect(iso(weeklyWindowsDue({ anchor: d('2026-10-01T00:00:00Z'), lastAutoEnd: null, hasAny: false, now: d('2026-10-20T00:00:00Z') })))
      .toEqual(['2026-10-08T00:00:00.000Z', '2026-10-15T00:00:00.000Z']);
  });

  it('刚建组不满一周、又一期都没有：先出一期覆盖到现在', () => {
    const now = d('2026-10-04T00:00:00Z');
    expect(weeklyWindowsDue({ anchor: d('2026-10-01T00:00:00Z'), lastAutoEnd: null, hasAny: false, now })).toEqual([now]);
    // 已经有一期（比如老师手动生成过）就等到满一格
    expect(weeklyWindowsDue({ anchor: d('2026-10-01T00:00:00Z'), lastAutoEnd: null, hasAny: true, now })).toEqual([]);
  });

  it('从最近一期自动快照往后补；不在格子上的旧快照（原来按打开时间切的）接着下一个格子', () => {
    const anchor = d('2026-10-01T00:00:00Z');
    expect(iso(weeklyWindowsDue({ anchor, lastAutoEnd: d('2026-10-15T00:00:00Z'), hasAny: true, now: d('2026-10-23T00:00:00Z') })))
      .toEqual(['2026-10-22T00:00:00.000Z']);
    expect(iso(weeklyWindowsDue({ anchor, lastAutoEnd: d('2026-10-10T09:30:00Z'), hasAny: true, now: d('2026-10-23T00:00:00Z') })))
      .toEqual(['2026-10-15T00:00:00.000Z', '2026-10-22T00:00:00.000Z']);
    expect(weeklyWindowsDue({ anchor, lastAutoEnd: d('2026-10-15T00:00:00Z'), hasAny: true, now: d('2026-10-21T23:00:00Z') })).toEqual([]);
  });

  it('隔太久只补最近的几周', () => {
    const ends = weeklyWindowsDue({ anchor: d('2026-01-01T00:00:00Z'), lastAutoEnd: null, hasAny: false, now: d('2026-10-01T00:00:00Z'), max: 4 });
    expect(ends).toHaveLength(4);
    expect(ends[3].getTime()).toBeLessThanOrEqual(d('2026-10-01T00:00:00Z').getTime());
  });
});

describe('按截止时间算一期（补算往期用）', () => {
  const n = (id: string, created_at: string, title: string, author_id = 'u1') => ({
    id, title, content: `<p>${title}</p>`, author_id, author_name: author_id, created_at,
    type: 'note', is_ai_generated: false, epistemic_status: null, inquiry_question: null,
  });
  const source: IdeaGraphSource = {
    memberIds: ['u1', 'u2'],
    notes: [
      n('a', '2026-10-02T08:00:00Z', '认知卸载会不会让人变懒'),
      n('b', '2026-10-03T08:00:00Z', '认知卸载和提问引导', 'u2'),
      n('c', '2026-10-04T08:00:00Z', '提问引导的例子'),
      n('d', '2026-10-12T08:00:00Z', '后来才写的笔记', 'u2'),
    ],
    relations: [
      { id: 'r1', source_note_id: 'a', target_note_id: 'b', relation_type: 'build_on', creator_id: 'u2', created_at: '2026-10-03T08:00:00Z' },
      { id: 'r2', source_note_id: 'b', target_note_id: 'd', relation_type: 'build_on', creator_id: 'u2', created_at: '2026-10-12T08:00:00Z' },
    ],
  };

  it('只看截止时间之前写的笔记和做的 Build-on；本期新增只数窗口里的', () => {
    const { payload, noteCount } = computeIdeaGraph(source, { windowStart: new Date('2026-10-01T00:00:00Z'), windowEnd: new Date('2026-10-08T00:00:00Z') });
    expect(noteCount).toBe(3);
    expect(payload.notes.map(x => x.id).sort()).toEqual(['a', 'b', 'c']);
    expect(payload.stats.buildOnCount).toBe(1);
    expect(payload.stats.newNoteCount).toBe(3);

    const later = computeIdeaGraph(source, { windowStart: new Date('2026-10-08T00:00:00Z'), windowEnd: new Date('2026-10-15T00:00:00Z'), previous: payload });
    expect(later.noteCount).toBe(4);
    expect(later.payload.stats.newNoteCount).toBe(1);
    expect(later.payload.stats.buildOnCount).toBe(2);
  });
});
