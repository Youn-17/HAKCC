import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase', () => ({ supabase: {} }));

import { collectGroupQuestions } from './groupIdeaGraph';

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
