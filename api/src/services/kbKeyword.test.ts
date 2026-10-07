import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 检索链路（第 2 步）：向量前 20 段加关键词前 10 段里不重复的做候选，重排（voyage rerank-3-lite）后
 * 低于相关度门槛 0.5 的不给；重排没拿到时按向量的顺序给；查询向量也没拿到时退到关键词（至少对上两个词、最多 3 段）。
 * 笔记 AI 和智能体工具每检索一次记一行检索记录。082 之前的片段启动时补上关键词的词序列。
 */

const h = vi.hoisted(() => {
  const state = {
    vector: null as number[] | null,
    rerank: null as null | ((docs: string[]) => number[] | null),
    rerankCalls: [] as string[][],
    rpcCalls: [] as Array<{ fn: string; args: Record<string, any> }>,
    vectorRows: [] as Array<Record<string, unknown>>,
    keywordRows: [] as Array<Record<string, unknown>>,
    missing: [] as Array<{ id: string; heading_path: string | null; content: string }>,
    logs: [] as Array<Record<string, any>>,
  };
  const rpc = async (fn: string, args: Record<string, any>) => {
    state.rpcCalls.push({ fn, args });
    if (fn === 'match_kb_chunks_keyword') return { data: state.keywordRows, error: null };
    if (fn === 'match_kb_chunk_vectors') return { data: state.vectorRows, error: null };
    if (fn === 'kb_set_search_text') {
      const ids = new Set((args.p_rows as Array<{ id: string }>).map(r => r.id));
      const before = state.missing.length;
      state.missing = state.missing.filter(c => !ids.has(c.id));
      return { data: before - state.missing.length, error: null };
    }
    return { data: null, error: { message: `unknown function ${fn}` } };
  };
  const from = (table: string) => {
    let limit = 1000;
    const builder: Record<string, unknown> = {
      select: () => builder,
      is: () => builder,
      limit: (n: number) => { limit = n; return builder; },
      insert: async (row: Record<string, any>) => {
        if (table === 'kb_retrieval_logs') state.logs.push(row);
        return { error: null };
      },
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve(table === 'kb_chunks' ? { data: state.missing.slice(0, limit), error: null } : { data: [], error: null }).then(ok, fail),
    };
    return builder;
  };
  return { state, supabase: { rpc, from } };
});

vi.mock('../config/supabase', () => ({ supabase: h.supabase }));
vi.mock('./accessControl', () => ({
  getCourseStanding: async () => 'member',
  enterableSpaceIds: async () => ['space-mine'],
}));
vi.mock('./kbEmbedding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./kbEmbedding')>()),
  kbEmbeddingConfigured: () => true,
  embedKbQuery: async () => h.state.vector,
}));
vi.mock('./kbRerank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./kbRerank')>()),
  rerankKb: async (_query: string, docs: string[]) => {
    h.state.rerankCalls.push(docs);
    return h.state.rerank ? h.state.rerank(docs) : null;
  },
}));
vi.mock('./kbVectorJob', () => ({ kickKbVectors: () => {} }));

import { fillMissingSearchText, searchKnowledgeBase, searchKnowledgeBaseDetailed } from './knowledgeBase';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  chunk_id: id, document_id: `doc-${id}`, title: `资料 ${id}`, heading_path: null, content: `片段 ${id}`,
  space_id: 'space-mine', material_id: null, ...extra,
});
const vrow = (id: string, similarity: number, extra: Record<string, unknown> = {}) => row(id, { similarity, ...extra });
const krow = (id: string, matched: number, extra: Record<string, unknown> = {}) => row(id, { score: 1, matched_terms: matched, ...extra });
const viewer = { id: 'student-1', role: 'student' as const };
/** 按片段 id 打分：rerank 收到的是正文，正文里带着 id */
const scoreBy = (table: Record<string, number>) => (docs: string[]) =>
  docs.map(d => table[d.replace('片段 ', '')] ?? 0);

beforeEach(() => {
  h.state.vector = null;
  h.state.rerank = null;
  h.state.rerankCalls = [];
  h.state.rpcCalls = [];
  h.state.vectorRows = [];
  h.state.keywordRows = [];
  h.state.missing = [];
  h.state.logs = [];
});

describe('拿得到查询向量：向量和关键词一起做候选，重排后卡门槛', () => {
  it('候选是向量前 20 段加关键词里不重复的；按相关度重排，低于 0.5 的不给，取前 limit 段', async () => {
    h.state.vector = [0.1, 0.2];
    h.state.vectorRows = [vrow('v1', 0.8), vrow('v2', 0.7), vrow('v3', 0.6)];
    h.state.keywordRows = [krow('v2', 3), krow('k1', 2)];
    h.state.rerank = scoreBy({ v1: 0.55, v2: 0.3, v3: 0.92, k1: 0.81 });

    const { hits, semantic, reranked } = await searchKnowledgeBaseDetailed('course-1', viewer, '观点改进和知识建构', 5);

    const fns = h.state.rpcCalls.map(c => c.fn);
    expect(fns).toEqual(expect.arrayContaining(['match_kb_chunk_vectors', 'match_kb_chunks_keyword']));
    expect(h.state.rpcCalls.find(c => c.fn === 'match_kb_chunk_vectors')!.args.p_match_count).toBe(20);
    expect(h.state.rpcCalls.find(c => c.fn === 'match_kb_chunks_keyword')!.args.p_match_count).toBe(10);
    // 重排收到的候选：向量的 3 段在前，关键词里不重复的 1 段在后
    expect(h.state.rerankCalls[0]).toEqual(['片段 v1', '片段 v2', '片段 v3', '片段 k1']);
    expect(hits.map(x => [x.chunkId, x.relevance, x.matchedBy])).toEqual([
      ['v3', 0.92, 'vector'], ['k1', 0.81, 'keyword'], ['v1', 0.55, 'vector'],
    ]);
    expect(hits[0].similarity).toBe(0.6);
    expect(hits[1].similarity).toBeNull();
    expect({ semantic, reranked }).toEqual({ semantic: true, reranked: true });
  });

  it('一段都不够 0.5：给空，并说明重排跑成了（调用方据此告诉模型「检索过了、没有相关的」）', async () => {
    h.state.vector = [0.1];
    h.state.vectorRows = [vrow('v1', 0.8), vrow('v2', 0.7)];
    h.state.rerank = () => [0.2, 0.1];
    expect(await searchKnowledgeBaseDetailed('course-1', viewer, '番茄炒蛋怎么做', 5)).toEqual({ hits: [], semantic: true, reranked: true });
  });

  it('重排没拿到（超时、出错）：按向量的顺序给，不卡门槛，关键词那几段不要', async () => {
    h.state.vector = [0.1];
    h.state.vectorRows = [vrow('v1', 0.8), vrow('v2', 0.7), vrow('v3', 0.6)];
    h.state.keywordRows = [krow('k1', 5)];

    const { hits, reranked } = await searchKnowledgeBaseDetailed('course-1', viewer, '观点改进和知识建构', 2);
    expect(hits.map(x => [x.chunkId, x.relevance])).toEqual([['v1', null], ['v2', null]]);
    expect(reranked).toBe(false);
  });

  it('库里的函数哪天漏了范围：别人空间里的片段进不了候选', async () => {
    h.state.vector = [0.1];
    h.state.vectorRows = [vrow('mine', 0.8), vrow('other-group', 0.9, { space_id: 'space-other' })];
    h.state.keywordRows = [krow('kw-other', 3, { space_id: 'space-other' })];
    h.state.rerank = docs => docs.map(() => 0.9);

    const hits = await searchKnowledgeBase('course-1', viewer, '观点改进和知识建构', 5);
    expect(h.state.rerankCalls[0]).toEqual(['片段 mine']);
    expect(hits.map(x => x.chunkId)).toEqual(['mine']);
  });
});

describe('查询向量拿不到：退到关键词', () => {
  it('重排拿得到：关键词的候选同样重排、卡门槛，最多 3 段，标明是关键词找到的', async () => {
    h.state.keywordRows = [krow('k1', 1), krow('k2', 4), krow('k3', 2), krow('k4', 2), krow('k5', 3)];
    h.state.rerank = scoreBy({ k1: 0.9, k2: 0.2, k3: 0.8, k4: 0.7, k5: 0.6 });

    const { hits, semantic, reranked } = await searchKnowledgeBaseDetailed('course-1', viewer, '观点改进和知识建构的关系', 5);

    expect(h.state.rpcCalls.map(c => c.fn)).toEqual(['match_kb_chunks_keyword']);
    // 门槛筛掉 k2；只对上一个词的 k1 重排认为相关就给（重排拿得到时不看对上几个词）
    expect(hits.map(x => x.chunkId)).toEqual(['k1', 'k3', 'k4']);
    expect(hits.every(x => x.matchedBy === 'keyword' && x.similarity === null && x.relevance !== null)).toBe(true);
    expect({ semantic, reranked }).toEqual({ semantic: false, reranked: true });
  });

  it('重排也没拿到：至少对上两个词的才给，最多 3 段，范围再核一遍', async () => {
    h.state.keywordRows = [
      krow('two-terms', 2), krow('one-term', 1),
      krow('material', 3, { space_id: null, material_id: 'material-1' }),
      krow('other-group', 4, { space_id: 'space-other' }),
      krow('c4', 2), krow('c5', 2),
    ];

    const hits = await searchKnowledgeBase('course-1', viewer, '观点改进和知识建构的关系', 5);
    const args = h.state.rpcCalls[0].args;
    expect(args).toMatchObject({ p_course_id: 'course-1', p_space_ids: ['space-mine'], p_match_count: 10 });
    expect(args.p_terms).toEqual(expect.arrayContaining(['#观点', '#改进', '#建构']));
    expect(hits.map(x => x.chunkId)).toEqual(['two-terms', 'material', 'c4']);
    expect(hits.every(x => x.matchedBy === 'keyword' && x.similarity === null && x.relevance === null)).toBe(true);
  });

  it('提问里全是套话：不查', async () => {
    expect(await searchKnowledgeBase('course-1', viewer, '是什么？', 5)).toEqual([]);
    expect(h.state.rpcCalls).toEqual([]);
  });
});

describe('检索记录', () => {
  it('笔记 AI、智能体工具检索时记一行：来源、问题、候选数、重排后的前几段和分数、给出去几段、耗时', async () => {
    h.state.vector = [0.1];
    h.state.vectorRows = [vrow('v1', 0.8), vrow('v2', 0.7)];
    h.state.rerank = () => [0.3, 0.9];

    await searchKnowledgeBaseDetailed('course-1', viewer, '观点改进是什么', 5, { source: 'note_ai' });
    await vi.waitFor(() => expect(h.state.logs).toHaveLength(1));
    expect(h.state.logs[0]).toMatchObject({
      course_id: 'course-1', user_id: 'student-1', source: 'note_ai', query: '观点改进是什么',
      semantic: true, reranked: true, candidates: 2, returned: 1,
      ranked_ids: ['v2', 'v1'], ranked_scores: [0.9, 0.3],
    });
    expect(typeof h.state.logs[0].total_ms).toBe('number');
  });

  it('没说来源（测试、评测脚本）：不记', async () => {
    h.state.vector = [0.1];
    h.state.vectorRows = [vrow('v1', 0.8)];
    await searchKnowledgeBaseDetailed('course-1', viewer, '观点改进是什么', 5);
    await new Promise(r => setTimeout(r, 10));
    expect(h.state.logs).toEqual([]);
  });
});

describe('fillMissingSearchText', () => {
  it('没有词序列的片段一批批补上，补完就停', async () => {
    h.state.missing = Array.from({ length: 450 }, (_, i) => ({ id: `c${i}`, heading_path: '第一章', content: `知识建构 第 ${i} 段` }));

    expect(await fillMissingSearchText(200)).toBe(450);

    const writes = h.state.rpcCalls.filter(c => c.fn === 'kb_set_search_text');
    expect(writes.map(c => c.args.p_rows.length)).toEqual([200, 200, 50]);
    const first = writes[0].args.p_rows[0];
    expect(first.search_text.split(' ')).toEqual(expect.arrayContaining(['#知识', '#建构']));
    expect(first.search_len).toBe(first.search_text.split(' ').length);
    expect(h.state.missing).toEqual([]);
  });
});
