import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 解析中的文档每 10 分钟再扫一遍（startKbParseSweep）。原来只在启动时扫一次：MinerU 超过 8 分钟还没好的
 * 课程资料，要等下次重启才有人接着轮询。定时扫描碰到正在轮询的那份要跳过，同一份不能跑两条轮询
 * （课程资料的入库不排队，两条交错会把片段写重）。
 */

const h = vi.hoisted(() => {
  const state = {
    renders: [] as Array<{ note_id: string }>,
    materials: [] as Array<{ id: string }>,
  };
  const note = (id: string) => ({
    id, space_id: 'space-1', file_url: `https://files.example/${id}.pdf`, file_name: `${id}.pdf`,
    mime_type: 'application/pdf', title: id, author_id: 'student-1', deleted_at: null,
  });
  // 链式调用在 await / maybeSingle 时按表给结果
  const from = (table: string) => {
    let id: unknown = null;
    const result = () => {
      if (table === 'document_renders') return { data: state.renders, error: null };
      if (table === 'course_materials') return { data: state.materials, error: null };
      if (table === 'notes') return { data: note(String(id)), error: null };
      if (table === 'spaces') return { data: { course_id: 'course-1' }, error: null };
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      eq: (col: string, value: unknown) => { if (col === 'id') id = value; return builder; },
      maybeSingle: async () => result(),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, fail),
    };
    for (const m of ['select', 'in', 'is', 'limit']) builder[m] = () => builder;
    return builder;
  };
  return {
    state,
    supabase: { from },
    /** MinerU 还在跑：先给本地抽出来的粗略正文 */
    resolveText: vi.fn(async () => ({ text: '本地抽出来的正文'.repeat(20), source: 'pdf', pending: true })),
    ingest: vi.fn(async (_params: Record<string, unknown>) => ({ documentId: 'doc-1', chunks: 3, skipped: false })),
  };
});

vi.mock('../config/supabase', () => ({ supabase: h.supabase }));
vi.mock('./documentPipeline', () => ({ resolveDocumentText: h.resolveText }));
vi.mock('./knowledgeBase', () => ({ ingestDocument: h.ingest }));

import { scheduleKbIngest, startKbParseSweep, sweepPendingDocuments } from './kbIngest';

beforeEach(() => {
  vi.useFakeTimers();
  h.state.renders = [];
  h.state.materials = [];
  h.resolveText.mockClear();
  h.ingest.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('解析中的文档', () => {
  it('上传后那几轮还在轮询时，扫描碰到同一份就跳过；轮询结束后，下次扫描接得上', async () => {
    scheduleKbIngest('note-slow');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.resolveText).toHaveBeenCalledTimes(1);

    // 上传那条轮询正在等 25 秒，这时扫描到它
    h.state.renders = [{ note_id: 'note-slow' }];
    expect(await sweepPendingDocuments()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.resolveText).toHaveBeenCalledTimes(1);

    // 原来那条照常往下轮询：5 次等待都走完，一共 6 轮
    await vi.advanceTimersByTimeAsync(25_000 + 45_000 + 90_000 + 180_000 + 240_000);
    expect(h.resolveText).toHaveBeenCalledTimes(6);

    // 8 分钟过去还没好：之后的扫描能重新接上
    await sweepPendingDocuments();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.resolveText).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
  });

  it('定时扫描每 10 分钟一次，解析好了就不再轮询', async () => {
    h.state.renders = [{ note_id: 'note-late' }];
    startKbParseSweep();

    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(h.resolveText).not.toHaveBeenCalled();

    // MinerU 这回好了
    h.resolveText.mockResolvedValueOnce({ text: '# 结构化正文'.repeat(20), source: 'mineru', pending: false });
    await vi.advanceTimersByTimeAsync(1);
    expect(h.resolveText).toHaveBeenCalledTimes(1);
    expect(h.ingest).toHaveBeenCalledTimes(1);
    expect(h.ingest.mock.calls[0][0]).toMatchObject({ courseId: 'course-1', noteId: 'note-late', textSource: 'mineru' });

    // 没有后续轮询
    await vi.advanceTimersByTimeAsync(25_000);
    expect(h.resolveText).toHaveBeenCalledTimes(1);
  });
});
