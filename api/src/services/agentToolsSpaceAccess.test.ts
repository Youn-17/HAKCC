import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * get_workspace_summary 的 space_id 由模型自己填，学生一句「总结一下那个空间」就能换掉。
 * 原先只核对那个空间属于本课：工作区助手（connection_scout）和笔记智能体都对学生开放这个工具，
 * 路由那一层把空间卡住了，组 A 的学生仍能借它读组 B 空间最近的笔记标题和摘录。
 */

const h = vi.hoisted(() => {
  const SECRET = '第二组还没公开的草稿';
  const SPACES: Record<string, { course_id: string }> = {
    'space-a': { course_id: 'course-1' },
    'space-b': { course_id: 'course-1' },
    'space-shared': { course_id: 'course-1' },
  };
  const NOTES: Record<string, { id: string; title: string; content: string; author_id: string; created_at: string; updated_at: string }[]> = {
    'space-a': [{ id: 'n-a', title: '第一组笔记', content: '<p>第一组的想法</p>', author_id: 'u-a', created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z' }],
    'space-b': [{ id: 'n-b', title: '第二组笔记', content: `<p>${SECRET}</p>`, author_id: 'u-b', created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z' }],
    'space-shared': [{ id: 'n-s', title: '共享笔记', content: '<p>共享空间里的一条</p>', author_id: 'u-s', created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z' }],
  };

  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const result = () => {
      if (table === 'spaces') {
        const space = SPACES[String(eq.id)];
        return { data: space && space.course_id === eq.course_id ? { id: eq.id } : null, error: null };
      }
      if (table === 'notes') return { data: NOTES[String(eq.space_id)] ?? [], error: null };
      return { data: [], error: null };
    };
    const builder: Record<string, unknown> = {
      eq: (col: string, value: unknown) => { eq[col] = value; return builder; },
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve(result()).then(onOk, onFail),
    };
    for (const m of ['select', 'is', 'order', 'limit']) builder[m] = () => builder;
    return builder;
  };

  return { SECRET, from, ensureSpaceAccess: vi.fn() };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('./accessControl', () => ({ ensureSpaceAccess: h.ensureSpaceAccess }));

import { createDefaultRegistry, type ToolContext } from './agentTools';
import { ApiError } from '../middleware/errorHandler';

const registry = createDefaultRegistry();
const context = (over: Partial<ToolContext> = {}): ToolContext => ({
  noteId: 'n-a', spaceId: 'space-a', courseId: 'course-1', userId: 'student-a', userRole: 'student',
  noteTitle: '', noteContent: '', ...over,
});
const summarize = (args: Record<string, unknown>, ctx: ToolContext) =>
  registry.executeTool('get_workspace_summary', args, ctx);

beforeEach(() => {
  h.ensureSpaceAccess.mockReset();
});

describe('get_workspace_summary 换空间时，学生也要进得去那个空间', () => {
  it('学生让模型填别组空间的 id：退回当前空间，别组的笔记一个字都拿不到', async () => {
    h.ensureSpaceAccess.mockRejectedValue(new ApiError(403, 'This space belongs to another group'));
    const result = await summarize({ space_id: 'space-b' }, context());

    expect(result.success).toBe(true);
    expect((result.data as { spaceId: string }).spaceId).toBe('space-a');
    expect(JSON.stringify(result)).not.toContain(h.SECRET);
    expect(h.ensureSpaceAccess).toHaveBeenCalledWith('space-b', { id: 'student-a', role: 'student' });
  });

  it('学生换到自己进得去的空间（比如共享空间）：照常总结那个空间', async () => {
    h.ensureSpaceAccess.mockResolvedValue({ id: 'space-shared', course_id: 'course-1', group_id: null });
    const result = await summarize({ space_id: 'space-shared' }, context());

    expect((result.data as { spaceId: string }).spaceId).toBe('space-shared');
    expect(JSON.stringify(result)).toContain('共享空间里的一条');
  });

  it('不换空间时不多查一道：当前空间路由已经放行过', async () => {
    const result = await summarize({}, context());

    expect((result.data as { spaceId: string }).spaceId).toBe('space-a');
    expect(h.ensureSpaceAccess).not.toHaveBeenCalled();
  });

  it('教师账号也要进得去：凭学生验证码入课的教师在课里是普通成员，换不进别组空间', async () => {
    h.ensureSpaceAccess.mockRejectedValue(new ApiError(403, 'This space belongs to another group'));
    const result = await summarize({ space_id: 'space-b' }, context({ userId: 'teacher-joined', userRole: 'teacher' }));

    expect((result.data as { spaceId: string }).spaceId).toBe('space-a');
    expect(JSON.stringify(result)).not.toContain(h.SECRET);
    expect(h.ensureSpaceAccess).toHaveBeenCalledWith('space-b', { id: 'teacher-joined', role: 'teacher' });
  });

  it('创建者和课程管理员照常：ensureSpaceAccess 放行，本课任何空间都能总结', async () => {
    h.ensureSpaceAccess.mockResolvedValue({ id: 'space-b', course_id: 'course-1', group_id: 'group-b' });
    const result = await summarize({ space_id: 'space-b' }, context({ userId: 'teacher-1', userRole: 'teacher' }));

    expect((result.data as { spaceId: string }).spaceId).toBe('space-b');
    expect(JSON.stringify(result)).toContain(h.SECRET);
  });
});
