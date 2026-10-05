import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 知识空间助手「认不出 Build-on」的另一半：get_note_context、read_note 都不带参数，
 * 只认 context.noteId；助手的 noteId 是空间 id（合成的工作区笔记），于是它们在那里
 * 一个读不到笔记、一个永远查不到关系，而助手的指令偏偏让它「用 get_note_context 找 Build-on 关系」。
 */

const SPACE = '5cd95cfc-6813-444f-8d3a-3971e1935930';
const OTHER_SPACE = 'e14ce735-46ed-444a-9672-d82ab6ab87f3';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C, GONE, ELSEWHERE] = [id(1), id(2), id(3), id(4), id(5)];

const h = vi.hoisted(() => {
  type Note = { id: string; title: string; content: string; space_id: string; deleted_at: string | null; author_id: string; created_at: string; updated_at: string };
  type Rel = { id: string; source_note_id: string; target_note_id: string; relation_type: string; space_id: string; created_at: string };
  const state = { notes: [] as Note[], relations: [] as Rel[], queries: [] as Array<{ table: string; eq: Record<string, unknown> }> };

  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const inList: Record<string, string[]> = {};
    const nulls: string[] = [];
    let limitN: number | null = null;
    const rows = () => {
      state.queries.push({ table, eq: { ...eq } });
      if (table === 'notes') {
        return state.notes.filter(n =>
          (!eq.id || n.id === eq.id)
          && (!eq.space_id || n.space_id === eq.space_id)
          && (!inList.id || inList.id.includes(n.id))
          && (!nulls.includes('deleted_at') || n.deleted_at === null));
      }
      if (table === 'relations') {
        const found = state.relations
          .filter(r =>
            (!eq.space_id || r.space_id === eq.space_id)
            && (!eq.source_note_id || r.source_note_id === eq.source_note_id)
            && (!eq.target_note_id || r.target_note_id === eq.target_note_id))
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        return limitN != null ? found.slice(0, limitN) : found;
      }
      return [];
    };
    const builder: Record<string, unknown> = {
      eq: (col: string, value: unknown) => { eq[col] = value; return builder; },
      in: (col: string, values: string[]) => { inList[col] = values; return builder; },
      is: (col: string, value: unknown) => { if (value === null) nulls.push(col); return builder; },
      limit: (n: number) => { limitN = n; return builder; },
      single: async () => { const r = rows(); return r[0] ? { data: r[0], error: null } : { data: null, error: { message: 'not found' } }; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(onOk, onFail),
    };
    for (const m of ['select', 'order', 'or']) builder[m] = () => builder;
    return builder;
  };
  return { state, from };
});

vi.mock('../config/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('./accessControl', () => ({ ensureSpaceAccess: vi.fn() }));

import { createDefaultRegistry, type ToolContext } from './agentTools';

const registry = createDefaultRegistry();
const note = (noteId: string, title: string, over: Record<string, unknown> = {}) => ({
  id: noteId, title, content: `<p>${title}的正文</p>`, space_id: SPACE, deleted_at: null as string | null,
  author_id: 'u1', created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z', ...over,
});
const rel = (n: number, source: string, target: string, type: string, at: string) =>
  ({ id: `r${n}`, source_note_id: source, target_note_id: target, relation_type: type, space_id: SPACE, created_at: at });

/** 知识空间助手：当前「笔记」是合成的，id 就是空间 id */
const workspaceCtx = (): ToolContext => ({
  noteId: SPACE, spaceId: SPACE, courseId: 'course-1', userId: 'student-a', userRole: 'student',
  noteTitle: 'Workspace: 主讨论空间', noteContent: '[A]: 概要',
});
/** 笔记智能体：当前笔记是 B */
const noteCtx = (): ToolContext => ({ ...workspaceCtx(), noteId: B, noteTitle: 'B', noteContent: 'B 的正文' });

const run = (tool: string, args: Record<string, unknown>, ctx: ToolContext) => registry.executeTool(tool, args, ctx);

beforeEach(() => {
  h.state.notes = [
    note(A, '检索练习为什么有效'),
    note(B, '我的补充：间隔也重要'),
    note(C, '一个质疑'),
    note(GONE, '已经删掉的想法', { deleted_at: '2026-10-01T00:00:00Z' }),
    note(ELSEWHERE, '别的空间的笔记', { space_id: OTHER_SPACE, content: '<p>别组还没公开的草稿</p>' }),
  ];
  h.state.relations = [
    rel(1, B, A, 'extend', '2026-10-01T00:00:00Z'),
    rel(2, C, A, 'challenge', '2026-10-02T00:00:00Z'),
    rel(3, C, B, 'question', '2026-10-03T00:00:00Z'),
    rel(4, B, GONE, 'evidence', '2026-10-04T00:00:00Z'),
  ];
  h.state.queries = [];
});

describe('get_note_context：知识空间里没指定笔记，给整个空间的 Build-on 关系', () => {
  it('返回每条关系（带标题、种类，方向是「谁 Build-on 谁」）和被 Build-on 最多的，已删笔记不出现', async () => {
    const res = await run('get_note_context', {}, workspaceCtx());

    expect(res.success).toBe(true);
    const data = res.data as any;
    expect(data.scope).toBe('workspace');
    expect(data.totalBuildOns).toBe(3);
    expect(data.buildOns.map((l: any) => `${l.from.title}>${l.to.title}:${l.kind}`)).toEqual([
      '一个质疑>我的补充：间隔也重要:question',
      '一个质疑>检索练习为什么有效:challenge',
      '我的补充：间隔也重要>检索练习为什么有效:extend',
    ]);
    expect(data.mostBuiltOn[0]).toMatchObject({ id: A, title: '检索练习为什么有效', buildOns: 2 });
    expect(JSON.stringify(data)).not.toContain('已经删掉的想法');
  });

  it('只查本空间的关系', async () => {
    await run('get_note_context', {}, workspaceCtx());
    expect(h.state.queries.filter(q => q.table === 'relations').every(q => q.eq.space_id === SPACE)).toBe(true);
  });
});

describe('get_note_context：指定 note_id', () => {
  it('查那一条：outgoing 是它 Build-on 了谁，incoming 是谁 Build-on 了它', async () => {
    const res = await run('get_note_context', { note_id: B }, workspaceCtx());

    expect(res.success).toBe(true);
    const data = res.data as any;
    expect(data.noteId).toBe(B);
    expect(data.title).toBe('我的补充：间隔也重要');
    expect(data.contentSummary).toContain('我的补充：间隔也重要的正文');
    const rows = data.buildOnRelations.map((r: any) => `${r.direction}:${r.title}:${r.relationType}`).sort();
    expect(rows).toEqual([
      'incoming:一个质疑:question',
      'outgoing:检索练习为什么有效:extend',
    ]);
  });

  it('别的空间的笔记：查不到，不返回内容', async () => {
    const res = await run('get_note_context', { note_id: ELSEWHERE }, workspaceCtx());

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('别组还没公开的草稿');
  });

  it('已删除的笔记：查不到', async () => {
    const res = await run('get_note_context', { note_id: GONE }, workspaceCtx());
    expect(res.success).toBe(false);
  });

  it('note_id 不是笔记 id 的格式（会拼进查询）：直接拒绝，一次库都不查', async () => {
    for (const bad of ['n-1', `${A},target_note_id.neq.x`, '1) or (1=1']) {
      const res = await run('get_note_context', { note_id: bad }, workspaceCtx());
      expect(res.success).toBe(false);
    }
    expect(h.state.queries).toEqual([]);
  });
});

describe('get_note_context：笔记智能体照旧', () => {
  it('不带参数就是当前笔记，关系不变', async () => {
    const res = await run('get_note_context', {}, noteCtx());

    expect(res.success).toBe(true);
    const data = res.data as any;
    expect(data.noteId).toBe(B);
    expect(data.title).toBe('B');
    expect(data.buildOnRelations.map((r: any) => `${r.direction}:${r.title}`).sort()).toEqual([
      'incoming:一个质疑',
      'outgoing:检索练习为什么有效',
    ]);
  });
});

describe('read_note', () => {
  it('知识空间里不带 note_id：说清没有「当前笔记」，让它带 note_id，而不是拿空间 id 去查', async () => {
    const res = await run('read_note', {}, workspaceCtx());

    expect(res.success).toBe(false);
    expect(res.error).toContain('note_id');
    expect(h.state.queries).toEqual([]);
  });

  it('带 note_id：读那一条的全文', async () => {
    const res = await run('read_note', { note_id: A }, workspaceCtx());

    expect(res.success).toBe(true);
    expect((res.data as any).title).toBe('检索练习为什么有效');
    expect((res.data as any).content).toContain('检索练习为什么有效的正文');
  });

  it('别的空间的笔记读不到', async () => {
    const res = await run('read_note', { note_id: ELSEWHERE }, workspaceCtx());

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('别组还没公开的草稿');
  });

  it('笔记智能体不带参数仍读当前笔记', async () => {
    const res = await run('read_note', {}, noteCtx());
    expect(res.success).toBe(true);
    expect((res.data as any).id).toBe(B);
  });
});

describe('工具说明里写明 note_id', () => {
  it('模型看得到可以传 note_id', () => {
    const defs = registry.getToolsForRole('student');
    for (const name of ['read_note', 'get_note_context']) {
      const def = defs.find(d => d.function.name === name)!;
      expect(Object.keys((def.function.parameters as any).properties ?? {})).toContain('note_id');
    }
  });
});
