import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 课程资料和附件笔记走同一条解析与入库链路，差别只在两处：
 *   - 解析缓存存哪（附件：document_renders；资料：course_materials 上的同名列）；
 *   - 知识库里按什么去重（附件：course_id+note_id；资料：course_id+material_id）。
 * 这里钉住这两处，并确认附件那一路的行为没有变。
 */

const PUBLIC_ROOT = 'https://storage.example.test/object/public/note-chat-attachments';

const h = vi.hoisted(() => {
  const calls = {
    upserts: [] as { table: string; payload: Record<string, unknown>; options: unknown }[],
    eqs: [] as { table: string; col: string; val: unknown }[],
    tables: [] as string[],
  };
  const from = (table: string) => {
    calls.tables.push(table);
    const builder: Record<string, unknown> = {
      upsert: (payload: Record<string, unknown>, options: unknown) => {
        calls.upserts.push({ table, payload, options });
        return builder;
      },
      eq: (col: string, val: unknown) => { calls.eqs.push({ table, col, val }); return builder; },
      single: async () => ({ data: { id: 'doc-1' }, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
    };
    for (const m of ['select', 'delete', 'insert', 'update', 'in', 'is', 'limit', 'order']) builder[m] = () => builder;
    return builder;
  };
  const storage = {
    from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.example.test/object/public/note-chat-attachments/${p}` } }) }),
  };
  return { calls, supabase: { from, storage } };
});

vi.mock('../config/supabase', () => ({ supabase: h.supabase }));
vi.mock('./embeddingService', () => ({
  resolveEmbeddingProvider: async () => null,
  generateEmbedding: async () => null,
}));

import { ingestDocument } from './knowledgeBase';
import { resolveDocumentTextWith, type CachedRender } from './documentPipeline';
import { materialKbState } from './kbIngest';

const CONTENT = '# 第一章\n\n' + '知识建构强调共同体对公共知识负责，而不是个人各自完成任务。'.repeat(6);

beforeEach(() => {
  h.calls.upserts.length = 0;
  h.calls.eqs.length = 0;
  h.calls.tables.length = 0;
});

describe('ingestDocument：资料与附件各按自己的键去重', () => {
  it('课程资料：写 material_id、source_type=material、按 course_id+material_id 冲突合并', async () => {
    const res = await ingestDocument({ courseId: 'c-1', materialId: 'm-1', title: '第一周阅读', content: CONTENT });
    expect(res.skipped).toBe(false);
    const up = h.calls.upserts.find(u => u.table === 'kb_documents')!;
    expect(up.payload).toMatchObject({ course_id: 'c-1', material_id: 'm-1', source_type: 'material' });
    expect(up.payload).not.toHaveProperty('note_id');
    expect(up.options).toEqual({ onConflict: 'course_id,material_id' });
    expect(h.calls.eqs).toContainEqual({ table: 'kb_documents', col: 'material_id', val: 'm-1' });
  });

  it('附件笔记：和改动之前完全一样', async () => {
    await ingestDocument({ courseId: 'c-1', noteId: 'n-1', spaceId: 's-1', title: '附件', content: CONTENT });
    const up = h.calls.upserts.find(u => u.table === 'kb_documents')!;
    expect(up.payload).toMatchObject({ course_id: 'c-1', note_id: 'n-1', space_id: 's-1', source_type: 'attachment' });
    expect(up.payload).not.toHaveProperty('material_id');
    expect(up.options).toEqual({ onConflict: 'course_id,note_id' });
  });

  it('两个来源都没给：不碰数据库', async () => {
    const res = await ingestDocument({ courseId: 'c-1', title: 'x', content: CONTENT });
    expect(res).toMatchObject({ skipped: true, reason: 'no_source' });
    expect(h.calls.tables).toHaveLength(0);
  });
});

describe('resolveDocumentTextWith：缓存写到调用方给的地方', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('资料的正文缓存走注入的缓存层，不写 document_renders', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe(`${PUBLIC_ROOT}/materials/c-1/1-reading.md`);
      return new Response(CONTENT);
    });
    const saved: CachedRender[] = [];
    const cache = { load: async () => null, save: async (patch: CachedRender) => { saved.push(patch); } };

    const result = await resolveDocumentTextWith({
      file_url: `${PUBLIC_ROOT}/materials/c-1/1-reading.md`,
      file_name: 'reading.md',
      mime_type: 'text/markdown',
    }, cache);

    expect(result.pending).toBe(false);
    expect(result.text).toContain('知识建构强调共同体');
    expect(saved[0]).toMatchObject({ text_source: 'plain' });
    expect(saved[0].plain_text).toContain('知识建构强调共同体');
    expect(h.calls.tables).not.toContain('document_renders');
  });

  it('缓存里已有结构化正文就直接用，不再下载', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('should not download'); });
    const result = await resolveDocumentTextWith(
      { file_url: `${PUBLIC_ROOT}/materials/c-1/a.pdf`, file_name: 'a.pdf', mime_type: 'application/pdf' },
      { load: async () => ({ markdown: '# 已解析', text_source: 'mineru' }), save: async () => {} },
    );
    expect(result).toEqual({ text: '# 已解析', source: 'mineru', pending: false });
  });
});

describe('materialKbState 的边界', () => {
  const pdf = { mime_type: 'application/pdf', file_name: 'a.pdf', text_updated_at: 't', mineru_state: null };

  it('入库出错', () => {
    expect(materialKbState(pdf, { status: 'failed', chunks: 0, embedded: 0 }).state).toBe('failed');
  });

  it('入库进行中', () => {
    expect(materialKbState(pdf, { status: 'parsing', chunks: 0, embedded: 0 }).state).toBe('processing');
  });

  it('标记为 ready 但一片都没切出来：等同于没有正文', () => {
    expect(materialKbState(pdf, { status: 'ready', chunks: 0, embedded: 0 }).state).toBe('no_text');
  });

  it('本地正文读不出来、MinerU 还在跑：还在处理，不算失败', () => {
    expect(materialKbState({ ...pdf, mineru_state: 'pending' }, null).state).toBe('processing');
  });

  it('扩展名认得出就算类型报成 octet-stream 也会解析', () => {
    expect(materialKbState({ ...pdf, mime_type: 'application/octet-stream', file_name: 'notes.md', text_updated_at: null }, null).state)
      .toBe('processing');
  });
});
