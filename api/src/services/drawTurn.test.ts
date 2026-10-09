import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 所有入口共用的画图流程（2026-10-09）：先规划，结构图由平台画、画面交给生图模型；规划不可用时用学生原话画。
 * 规划、生图、转存、动笔都换成假的，只看流程怎么走。
 */

const h = vi.hoisted(() => ({
  planDrawing: vi.fn(),
  generateNoteImage: vi.fn(),
  persistGeneratedImage: vi.fn(),
  renderDiagramPng: vi.fn(),
  checkDrawPlan: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  memory: null as unknown,
}));

vi.mock('./drawPlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./drawPlanner')>()),
  planDrawing: h.planDrawing,
}));
vi.mock('./drawJudge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./drawJudge')>()),
  checkDrawPlan: h.checkDrawPlan,
}));
vi.mock('./noteImage', () => ({ generateNoteImage: h.generateNoteImage }));
vi.mock('./generatedMedia', () => ({ persistGeneratedImage: h.persistGeneratedImage }));
vi.mock('./diagramRender', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./diagramRender')>()),
  renderDiagramPng: h.renderDiagramPng,
}));
vi.mock('../config/supabase', () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: h.rows, error: null }),
        maybeSingle: () => Promise.resolve({ data: { conversation_memory: h.memory }, error: null }),
      };
      return builder;
    },
  },
}));

import {
  drawingMarkdown, drawingMetadata, lastReplyFromTurns, loadLastExchange, loadRecentTurns, loadStoredMemory, planHasForm,
  previousFromMetadata, produceDrawing,
} from './drawTurn';

const DIAGRAM = {
  type: 'graph' as const,
  nodes: [{ id: 'a', label: '想这一步被外包' }, { id: 'b', label: '用得好反而多想' }],
  edges: [{ from: 'b', to: 'a', label: '质疑' }],
};

beforeEach(() => {
  h.planDrawing.mockReset();
  h.generateNoteImage.mockReset().mockResolvedValue({ ok: true, url: 'https://img.test/p.png', model: 'qwen-image-plus', provider: 'dmx', timings: {} });
  h.persistGeneratedImage.mockReset().mockResolvedValue({ ok: true, url: 'https://files.test/d.png' });
  h.renderDiagramPng.mockReset().mockResolvedValue({ ok: true, png: Buffer.from('89504e47', 'hex'), width: 600, height: 400 });
  // 默认 Jev 没开：不核对
  h.checkDrawPlan.mockReset().mockResolvedValue(null);
});

describe('produceDrawing', () => {
  it('规划成画面：把规划写的描述交给生图模型，图下面附上说明', async () => {
    h.planDrawing.mockResolvedValue({ plan: { kind: 'picture', prompt: 'A student outlining before asking an AI', caption: '根据你的笔记，画了先写提纲再问 AI 的场景。' }, model: 'deepseek/deepseek-flash' });
    const onPlanned = vi.fn();
    const context = { history: [{ role: 'user' as const, content: '我的笔记写的是先写提纲' }], memory: 'm', background: 'b', learner: 'l' };
    const out = await produceDrawing({ courseId: 'course-1', request: '给我的观点画张图', context, onPlanned });

    expect(h.planDrawing).toHaveBeenCalledWith('course-1', '给我的观点画张图', context);
    expect(onPlanned).toHaveBeenCalledWith({ kind: 'picture', caption: '根据你的笔记，画了先写提纲再问 AI 的场景。' });
    expect(h.generateNoteImage.mock.calls[0].slice(0, 2)).toEqual(['course-1', 'A student outlining before asking an AI']);
    expect(out).toMatchObject({ ok: true, kind: 'picture', planned: true, provider: 'dmx', prompt: 'A student outlining before asking an AI' });
    if (out.ok) {
      expect(out.markdown).toBe('![根据你的笔记，画了先写提纲再问 AI 的场景。](https://img.test/p.png)\n\n根据你的笔记，画了先写提纲再问 AI 的场景。');
      expect(drawingMetadata(out)).toMatchObject({
        direct_image: true, provider_id: 'dmx', image_url: 'https://img.test/p.png',
        drawing: { kind: 'picture', planned: true, prompt: 'A student outlining before asking an AI', planner_model: 'deepseek/deepseek-flash' },
      });
    }
  });

  it('规划成结构图：平台自己画、转存，不找生图模型（没配 DMX/MiniMax 的课也画得出）', async () => {
    h.planDrawing.mockResolvedValue({ plan: { kind: 'diagram', diagram: DIAGRAM, caption: '画了两种看法之间的关系。' } });
    const out = await produceDrawing({ courseId: 'course-1', request: '画一张关系图', context: {} });
    expect(h.renderDiagramPng).toHaveBeenCalledWith(DIAGRAM);
    expect(h.persistGeneratedImage).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'course-1', model: 'diagram', b64: expect.any(String) }));
    expect(h.generateNoteImage).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true, kind: 'diagram', provider: 'hakcc', model: 'diagram', url: 'https://files.test/d.png' });
    if (out.ok) expect(drawingMetadata(out)).toMatchObject({ drawing: { kind: 'diagram', diagram: DIAGRAM } });
  });

  it('结构图画不成（比如缺中文字体）：按结构写一段话交给生图模型，框里的字原样带上', async () => {
    h.planDrawing.mockResolvedValue({ plan: { kind: 'diagram', diagram: DIAGRAM, caption: '画了两种看法之间的关系。' } });
    h.renderDiagramPng.mockResolvedValue({ ok: false, error: '服务器上没有中文字体' });
    const out = await produceDrawing({ courseId: 'course-1', request: '画一张关系图', context: {} });
    const prompt = h.generateNoteImage.mock.calls[0][1] as string;
    expect(prompt).toContain('"想这一步被外包"');
    expect(prompt).toContain('"用得好反而多想"');
    expect(out).toMatchObject({ ok: true, kind: 'picture', caption: '画了两种看法之间的关系。' });
  });

  it('规划不可用：退回原来的做法，用学生原话画，图下面不附说明', async () => {
    h.planDrawing.mockResolvedValue({ plan: null, error: 'planner unavailable' });
    const out = await produceDrawing({ courseId: 'course-1', request: '画一只在月球上看书的猫', context: {} });
    expect(h.generateNoteImage.mock.calls[0].slice(0, 2)).toEqual(['course-1', '画一只在月球上看书的猫']);
    expect(out).toMatchObject({ ok: true, planned: false, caption: '', plannerError: 'planner unavailable' });
    if (out.ok) expect(out.markdown).toBe('![画一只在月球上看书的猫](https://img.test/p.png)');
  });

  it('画不成：带上原因和已经想好的说明', async () => {
    h.planDrawing.mockResolvedValue({ plan: { kind: 'picture', prompt: 'p', caption: '想画的是……' } });
    h.generateNoteImage.mockResolvedValue({ ok: false, error: '本课程未配置 MiniMax 或 DMX，无法生成图像。' });
    expect(await produceDrawing({ courseId: 'course-1', request: '画一只猫', context: {} }))
      .toEqual({ ok: false, error: '本课程未配置 MiniMax 或 DMX，无法生成图像。', caption: '想画的是……' });
  });
});

describe('drawingMarkdown', () => {
  it('说明当图片的替代文字、也写在图下面；方括号去掉，不弄坏 markdown', () => {
    expect(drawingMarkdown('u', '画了[两个]观点', 'r')).toBe('![画了两个观点](u)\n\n画了[两个]观点');
    expect(drawingMarkdown('u', '', '画[一只]猫')).toBe('![画一只猫](u)');
  });
});

describe('画图要读的上下文', () => {
  it('最近几轮旧的在前，刚存进去的这一问不算「之前的对话」', async () => {
    h.rows = [
      { role: 'user', content: '画一张关系图', created_at: '3' },
      { role: 'assistant', content: '有三种看法', created_at: '2' },
      { role: 'user', content: '大家都说了什么？', created_at: '1' },
    ];
    expect(await loadRecentTurns('agent', 'conv-1', '画一张关系图')).toEqual([
      { role: 'user', content: '大家都说了什么？' },
      { role: 'assistant', content: '有三种看法' },
    ]);
    h.rows = [{ sender_kind: 'assistant', content: '上一张图', created_at: '1' }];
    expect(await loadRecentTurns('note', 'thread-1', '画一张')).toEqual([{ role: 'assistant', content: '上一张图' }]);
  });

  it('记忆摘要只认现行版本', async () => {
    h.memory = { version: 1, summary: '学生在比较两种看法' };
    expect(await loadStoredMemory('agent', 'conv-1')).toBe('学生在比较两种看法');
    h.memory = { version: 0, summary: '旧格式' };
    expect(await loadStoredMemory('note', 'thread-1')).toBe('');
  });
});

describe('Jev 核对规划（2026-10-09）', () => {
  const TREE = { type: 'tree' as const, title: '检索练习', nodes: [{ id: 'r', label: '检索练习' }, { id: 'a', label: '记得更久' }], edges: [{ from: 'r', to: 'a' }] };

  it('Jev 说不合要求：带着这份规划重新规划一次，用更合要求的那份，经过记进元数据', async () => {
    h.planDrawing
      .mockResolvedValueOnce({ plan: { kind: 'picture', prompt: 'A student at a desk', caption: '画了一个学生。' }, model: 'deepseek/deepseek-flash' })
      .mockResolvedValueOnce({ plan: { kind: 'diagram', diagram: DIAGRAM, caption: '画了两种看法的关系。' }, model: 'deepseek/deepseek-flash' });
    h.checkDrawPlan
      .mockResolvedValueOnce({ matchProbability: 0.04, passed: false, latencyMs: 300 })
      .mockResolvedValueOnce({ matchProbability: 0.9, passed: true, latencyMs: 280 });
    const out = await produceDrawing({ courseId: 'course-1', request: '画一张小李和小王观点的关系图', context: {} });

    expect(h.planDrawing).toHaveBeenCalledTimes(2);
    expect(h.planDrawing.mock.calls[1][2]).toMatchObject({ rejected: { kind: 'picture', prompt: 'A student at a desk' } });
    expect(out).toMatchObject({ ok: true, kind: 'diagram', caption: '画了两种看法的关系。' });
    if (out.ok) {
      expect(drawingMetadata(out).drawing).toMatchObject({
        check: { p: 0.04, passed: false, replanned: true, p_retry: 0.9, chosen: 'retry' },
      });
    }
  });

  it('Jev 定了画思维导图，规划却给了关系图：不用等 Jev，代码比对种类就重新规划', async () => {
    h.planDrawing
      .mockResolvedValueOnce({ plan: { kind: 'diagram', diagram: DIAGRAM, caption: '关系图' } })
      .mockResolvedValueOnce({ plan: { kind: 'diagram', diagram: TREE, caption: '思维导图' } });
    const out = await produceDrawing({ courseId: 'course-1', request: '把这几条笔记做成思维导图', context: {}, form: 'tree' });
    expect(h.planDrawing.mock.calls[0][2]).toMatchObject({ form: 'tree' });
    expect(out).toMatchObject({ ok: true, kind: 'diagram', diagram: { type: 'tree' } });
    if (out.ok) expect(drawingMetadata(out).drawing).toMatchObject({ check: { passed: false, form_mismatch: true, replanned: true, chosen: 'retry' } });
  });

  it('重新规划也没更好：留第一份', async () => {
    h.planDrawing
      .mockResolvedValueOnce({ plan: { kind: 'picture', prompt: 'first', caption: '一' } })
      .mockResolvedValueOnce({ plan: { kind: 'picture', prompt: 'second', caption: '二' } });
    h.checkDrawPlan
      .mockResolvedValueOnce({ matchProbability: 0.4, passed: false })
      .mockResolvedValueOnce({ matchProbability: 0.2, passed: false });
    const out = await produceDrawing({ courseId: 'course-1', request: '画一只猫', context: {} });
    expect(h.generateNoteImage.mock.calls[0][1]).toBe('first');
    if (out.ok) expect(drawingMetadata(out).drawing).toMatchObject({ check: { chosen: 'first', p: 0.4, p_retry: 0.2 } });
  });

  it('核对通过：只规划一次；入口的判断经过原样记进元数据', async () => {
    h.planDrawing.mockResolvedValueOnce({ plan: { kind: 'picture', prompt: 'A cat', caption: '画了一只猫。' } });
    h.checkDrawPlan.mockResolvedValueOnce({ matchProbability: 0.95, passed: true, latencyMs: 250 });
    const out = await produceDrawing({ courseId: 'course-1', request: '画一只猫', context: {}, route: { decided_by: 'jev', p_draw: 1 } });
    expect(h.planDrawing).toHaveBeenCalledTimes(1);
    if (out.ok) {
      expect(drawingMetadata(out).drawing).toMatchObject({ mode: 'new', route: { decided_by: 'jev', p_draw: 1 }, check: { p: 0.95, passed: true } });
      expect(drawingMetadata(out).drawing).not.toHaveProperty('check.replanned');
    }
  });

  it('种类比对：画面对 picture，结构图看 type', () => {
    expect(planHasForm({ kind: 'picture', prompt: 'p', caption: '' }, 'picture')).toBe(true);
    expect(planHasForm({ kind: 'diagram', diagram: TREE, caption: '' }, 'tree')).toBe(true);
    expect(planHasForm({ kind: 'diagram', diagram: TREE, caption: '' }, 'graph')).toBe(false);
  });
});

describe('改上一张（2026-10-09）', () => {
  const PICTURE = { request: '画一个先想再问 AI 的学生', caption: '画了一个先写提纲的学生。', kind: 'picture' as const, prompt: 'A student outlining, warm colours' };

  it('规划拿到上一张，图标成改图', async () => {
    h.planDrawing.mockResolvedValueOnce({ plan: { kind: 'picture', prompt: 'A student outlining, soft pastel colours', caption: '把颜色调淡了。' } });
    const out = await produceDrawing({ courseId: 'course-1', request: '颜色淡一点', context: {}, previous: PICTURE });
    expect(h.planDrawing.mock.calls[0][2]).toMatchObject({ previous: PICTURE });
    expect(out).toMatchObject({ ok: true, mode: 'edit' });
    if (out.ok) expect(drawingMetadata(out).drawing).toMatchObject({ mode: 'edit' });
  });

  it('规划不可用：画面在原来的描述后面加上要改的地方；结构图不知道怎么改，直说', async () => {
    h.planDrawing.mockResolvedValue({ plan: null, error: 'planner unavailable' });
    await produceDrawing({ courseId: 'course-1', request: '颜色淡一点', context: {}, previous: PICTURE });
    expect(h.generateNoteImage.mock.calls[0][1]).toBe('A student outlining, warm colours. Change requested by the learner: 颜色淡一点');

    const out = await produceDrawing({
      courseId: 'course-1', request: '把第三个框改成检索练习', context: {},
      previous: { request: '画关系图', caption: '', kind: 'diagram', diagram: DIAGRAM },
    });
    expect(out).toMatchObject({ ok: false });
    if (!out.ok) expect(out.error).toContain('没能读懂要怎么改');
    expect(h.renderDiagramPng).not.toHaveBeenCalled();
  });

  it('存着的图换成「上一张」：10-09 起的有规划，更早的只有 direct_image，画失败的不算', () => {
    expect(previousFromMetadata({ drawing: { kind: 'diagram', caption: 'c', diagram: DIAGRAM } }, '画关系图'))
      .toMatchObject({ request: '画关系图', kind: 'diagram', diagram: { type: 'graph' } });
    expect(previousFromMetadata({ drawing: { kind: 'picture', caption: 'c', prompt: 'A cat' } }, '画猫'))
      .toEqual({ request: '画猫', caption: 'c', kind: 'picture', prompt: 'A cat' });
    expect(previousFromMetadata({ direct_image: true, image_url: 'https://x/1.png' }, '画猫'))
      .toEqual({ request: '画猫', caption: '', kind: 'picture', prompt: '画猫' });
    expect(previousFromMetadata({ direct_image: true, failed: true }, '画猫')).toBeNull();
    expect(previousFromMetadata({ tools_used: [] }, '画猫')).toBeNull();
  });

  it('上一轮：画了图给出那张（不含刚存的这一问），文字回答给出回答', async () => {
    h.rows = [
      { role: 'user', content: '颜色淡一点', ai_metadata: {}, created_at: '3' },
      { role: 'assistant', content: '![猫](u)', ai_metadata: { direct_image: true, drawing: { kind: 'picture', caption: '画了猫', prompt: 'A cat' } }, created_at: '2' },
      { role: 'user', content: '画一只猫', ai_metadata: {}, created_at: '1' },
    ];
    expect(await loadLastExchange('agent', 'conv-1', '颜色淡一点')).toEqual({
      previous: { request: '画一只猫', caption: '画了猫', kind: 'picture', prompt: 'A cat' },
      lastReply: null,
    });
    h.rows = [{ sender_kind: 'assistant', content: '检索练习分四步。', ai_metadata: {}, created_at: '1' }];
    expect(await loadLastExchange('note', 'thread-1', '把上面的画成图')).toEqual({ previous: null, lastReply: '检索练习分四步。' });
    h.rows = [];
    expect(await loadLastExchange('agent', 'conv-1', '画一只猫')).toEqual({ previous: null, lastReply: null });
  });

  it('新开的对话只看前端带来的最后一轮文字回答', () => {
    expect(lastReplyFromTurns([{ role: 'user', content: '有哪些步骤' }, { role: 'assistant', content: '四步' }])).toBe('四步');
    expect(lastReplyFromTurns([{ role: 'user', content: '画一只猫' }])).toBeNull();
  });
});
