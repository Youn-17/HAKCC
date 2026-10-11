import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 智能体动手做事（2026-10-11）：列计划、给选项、做网页、改网页。
 * 模型（写网页用的流式接口、智能体循环用的普通接口）和数据库都换成假的，只验证这几样：
 * 推给前端的事件、存进库的那一行、给模型的工具结果、循环在「等学生选」时停下。
 */

const h = vi.hoisted(() => ({
  replies: [] as Array<Record<string, unknown>>,
  streams: [] as string[],
  bodies: [] as Array<Record<string, any>>,
  rows: [] as Array<Record<string, any>>,
  inserts: [] as Array<{ table: string; row: Record<string, any> }>,
}));

vi.mock('./aiGateway', () => ({
  aiFetch: vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    h.bodies.push(body);
    if (body.stream) {
      const text = h.streams.shift() ?? '';
      const frames: string[] = [];
      for (let i = 0; i < text.length; i += 37) frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 37) } }] })}\n\n`);
      return new Response(`${frames.join('')}data: [DONE]\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    const reply = h.replies.shift() ?? { message: { content: '' }, finish_reason: 'stop' };
    return new Response(JSON.stringify({ choices: [reply] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }),
  isAiBusy: () => false,
}));

vi.mock('./courseAi', () => ({
  resolveCandidates: vi.fn(async () => [{ providerId: 'zhipu', model: 'glm-5.3', apiKey: 'k', endpointUrl: null }]),
}));

vi.mock('./modelRouter', () => ({
  reportProviderFailure: vi.fn(),
  reportProviderSuccess: vi.fn(),
}));

vi.mock('../config/supabase', () => {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let orderBy: [string, boolean] | null = null;
    let limitN: number | null = null;
    const query = () => {
      let rows = table === 'ai_artifacts' ? [...h.rows] : [];
      for (const [col, val] of filters) rows = rows.filter(r => r[col] === val);
      if (orderBy) {
        const [col, asc] = orderBy;
        rows.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1));
      }
      return limitN ? rows.slice(0, limitN) : rows;
    };
    const api: Record<string, any> = {
      select: () => api,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return api; },
      order: (col: string, opts?: { ascending?: boolean }) => { orderBy = [col, opts?.ascending !== false]; return api; },
      limit: (n: number) => { limitN = n; return api; },
      maybeSingle: async () => ({ data: query()[0] ?? null, error: null }),
      insert: async (row: Record<string, any>) => {
        h.inserts.push({ table, row });
        if (table === 'ai_artifacts') h.rows.push({ ...row, created_at: new Date().toISOString() });
        return { error: null };
      },
    };
    return api;
  };
  return { supabase: { from } };
});

import {
  ARTIFACT_CSP, MAKER_TOOL_NAMES, createTurnState, executeAskChoice, executeCreateArtifact, executeReviseArtifact,
  executeUpdatePlan, extractHtml, finalizeArtifactHtml, makerMemorySection, parseStudentChoice, scriptSyntaxErrors, settlePlan, turnMetadata,
} from './agentMaker';
import { runAgentLoopStream, type AgentStreamEvent } from './agentLoop';
import { MAKER_TOOLS, normalizeConversationAgentMode, getAgentModeToolNames } from './noteAgentCatalog';
import type { ToolContext } from './agentTools';

const USER = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';
const SPACE = '33333333-3333-4333-8333-333333333333';
const THREAD = '44444444-4444-4444-8444-444444444444';
const NOTE = '55555555-5555-4555-8555-555555555555';

function context(events: Array<Record<string, unknown>>, surface: 'note' | 'workspace' = 'note'): ToolContext {
  return {
    noteId: NOTE, spaceId: SPACE, courseId: COURSE, userId: USER, userRole: 'student', noteTitle: '光合作用', noteContent: '',
    turn: createTurnState({ emit: e => events.push(e), surface, conversationId: THREAD }),
  };
}

const PAGE = `<!doctype html><html lang="zh-CN"><head><title>光合作用</title></head><body><main><h1>光合作用的条件</h1><p>${'叶绿体在光照下把二氧化碳和水合成有机物。'.repeat(40)}</p></main></body></html>`;

beforeEach(() => {
  h.replies = [];
  h.streams = [];
  h.bodies = [];
  h.rows = [];
  h.inserts = [];
});

describe('列计划', () => {
  it('整理步骤（最多 8 步、每步 40 字内、认不出的状态当没做），推给前端，告诉模型接着做', async () => {
    const events: Array<Record<string, unknown>> = [];
    const ctx = context(events);
    const out = await executeUpdatePlan({
      steps: [{ title: '找出组里关于光合作用的笔记', status: 'in_progress' }, { title: '整理分歧', status: 'weird' }, '做成对比页', { title: '' }],
    }, ctx);
    expect(out.success).toBe(true);
    expect(ctx.turn!.plan).toEqual({ steps: [
      { title: '找出组里关于光合作用的笔记', status: 'in_progress' },
      { title: '整理分歧', status: 'pending' },
      { title: '做成对比页', status: 'pending' },
    ] });
    expect(events).toEqual([{ agentPlan: ctx.turn!.plan }]);
    // 正常收尾：还在做的那一步算做完
    expect(settlePlan(ctx.turn!)!.steps[0].status).toBe('done');
  });

  it('别的助手（没有 turn）用不了；空计划不收', async () => {
    const { turn: _drop, ...bare } = context([]);
    expect((await executeUpdatePlan({ steps: ['a'] }, bare as ToolContext)).success).toBe(false);
    expect((await executeUpdatePlan({ steps: [] }, context([]))).success).toBe(false);
  });
});

describe('给选项', () => {
  it('一句问题 + 2–4 个选项：推 agentQuestion，告诉循环这一轮到此为止；在等学生选时计划不自动勾掉', async () => {
    const events: Array<Record<string, unknown>> = [];
    const ctx = context(events);
    await executeUpdatePlan({ steps: [{ title: '定呈现方式', status: 'in_progress' }] }, ctx);
    const out = await executeAskChoice({
      question: '想用哪种方式呈现组里的观点？',
      options: [{ label: '概念图', detail: '看清观点之间的联系' }, { label: '对比表' }, '时间线', { label: 'x' }, { label: '第五个' }],
    }, ctx);
    expect(out).toMatchObject({ success: true, endTurn: true, data: { reply: '想用哪种方式呈现组里的观点？' } });
    const q = ctx.turn!.question!;
    expect(q.options.map(o => o.label)).toEqual(['概念图', '对比表', '时间线', 'x']);
    expect(q.options[0].detail).toBe('看清观点之间的联系');
    expect(q.allowOther).toBe(true);
    expect(events.at(-1)).toEqual({ agentQuestion: q });
    expect(settlePlan(ctx.turn!)!.steps[0].status).toBe('in_progress');
    expect(turnMetadata(ctx.turn!)).toEqual({ plan: ctx.turn!.plan, question: q });
  });

  it('少于两个选项不行', async () => {
    expect((await executeAskChoice({ question: '要不要做？', options: ['要'] }, context([]))).success).toBe(false);
  });
});

describe('网页的清理和安全策略', () => {
  it('去掉代码块标记和前后的话，补上编码、不能联网的内容安全策略、视口', () => {
    const raw = `好的，下面是网页：\n\`\`\`html\n${PAGE}\n\`\`\`\n希望有帮助。`;
    const html = extractHtml(raw);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
    const done = finalizeArtifactHtml(html, '光合作用');
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.html).toContain(`<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`);
    expect(ARTIFACT_CSP).toContain("connect-src 'none'");
    expect(ARTIFACT_CSP).toContain("default-src 'none'");
    expect(done.html).toContain('<meta charset="utf-8">');
    expect(done.html).toContain('name="viewport"');
  });

  it('只写了片段也补成完整文档；没写出东西、太大的都不收', () => {
    const fragment = finalizeArtifactHtml(`<main>${'<p>段落</p>'.repeat(40)}</main>`, '片段 <测试>');
    expect(fragment.ok && fragment.html).toMatch(/^<!doctype html>\n<html lang="zh-CN"><head>/);
    expect(fragment.ok && fragment.html).toContain('<title>片段 &lt;测试&gt;</title>');
    expect(finalizeArtifactHtml('抱歉，我做不了', 'x').ok).toBe(false);
    expect(finalizeArtifactHtml(`<html><body>${'x'.repeat(520_000)}</body></html>`, 'x').ok).toBe(false);
  });
});

describe('做网页', () => {
  it('交给「智能体做网页」那一行的模型写：边写边推进度，存一行（带安全策略），推网页卡片，返回 artifact_id', async () => {
    h.streams = [`\`\`\`html\n${PAGE}\n\`\`\``];
    const events: Array<Record<string, unknown>> = [];
    const ctx = context(events);
    const out = await executeCreateArtifact({
      title: '光合作用条件对比',
      brief: '把组里三条笔记关于光合作用条件的观点做成对比表，每条附原话和作者。',
      sources: [{ title: '光照是关键', author: '小李' }, '温度也重要'],
    }, ctx);
    expect(out.success).toBe(true);
    const saved = h.inserts.find(i => i.table === 'ai_artifacts')!.row;
    expect(saved).toMatchObject({
      group_id: saved.id, version: 1, course_id: COURSE, space_id: SPACE, owner_id: USER, surface: 'note',
      conversation_id: THREAD, note_id: NOTE, kind: 'html', title: '光合作用条件对比', provider_id: 'zhipu', model: 'glm-5.3',
      sources: [{ title: '光照是关键', author: '小李' }, { title: '温度也重要' }],
    });
    expect(saved.html).toContain('Content-Security-Policy');
    // 每个网页都带上自带的样式和动效（artifactKit.ts）
    expect(saved.html.match(/<style data-hakcc-kit>/g)).toHaveLength(1);
    expect(saved.html.match(/<script data-hakcc-kit>/g)).toHaveLength(1);
    expect(out.data).toMatchObject({ artifact_id: saved.id, version: 1 });
    expect(events[0]).toEqual({ artifactStatus: { stage: 'writing', title: '光合作用条件对比', chars: 0 } });
    expect(events.at(-1)).toEqual({ artifact: { id: saved.id, groupId: saved.id, title: '光合作用条件对比', version: 1, kind: 'html', bytes: Buffer.byteLength(saved.html) } });
    // 写网页那次：流式、关思考、系统提示是网页规则、用户消息里有制作说明和来源
    const build = h.bodies.find(b => b.stream)!;
    expect(build.messages[0].content).toContain('单文件 HTML');
    expect(build.messages[0].content).toContain('data-hk-stagger');
    expect(build.messages[1].content).toContain('《光照是关键》（小李）');
    expect(build.thinking).toEqual({ type: 'disabled' });
  });

  it('写到长度上限没写完：接着写一段再拼起来', async () => {
    const cut = PAGE.length - 40;
    h.streams = [PAGE.slice(0, cut), PAGE.slice(cut)];
    const ctx = context([]);
    const out = await executeCreateArtifact({ title: '接着写', brief: '一页介绍光合作用需要哪些条件的网页：光照、二氧化碳、水和温度，各配一句说明。' }, ctx);
    expect(out.success).toBe(true);
    expect(h.bodies.filter(b => b.stream)).toHaveLength(2);
    expect(h.rows[0].html).toContain('</main></body></html>');
  });

  it('改网页：按任一版本的 id 找到本人这个网页的最新版，存成下一版；别人的改不了', async () => {
    h.streams = [PAGE];
    const ctx = context([]);
    await executeCreateArtifact({ title: '第一版', brief: '一页介绍光合作用需要哪些条件的网页：光照、二氧化碳、水和温度，各配一句说明。' }, ctx);
    const first = h.rows[0];
    h.streams = [PAGE.replace('光合作用的条件', '光合作用的条件（改）')];
    const out = await executeReviseArtifact({ artifact_id: first.id, instructions: '标题后面加上「（改）」' }, ctx);
    expect(out).toMatchObject({ success: true, data: { version: 2 } });
    expect(h.rows[1]).toMatchObject({ group_id: first.id, version: 2, title: '第一版' });
    expect(h.rows[1].id).not.toBe(first.id);
    const revise = h.bodies.filter(b => b.stream).at(-1)!;
    expect(revise.messages[1].content).toContain('修改要求：\n标题后面加上「（改）」');
    expect(revise.messages[1].content).toContain('现在的 HTML（组件库已经去掉');
    // 组件库不发给模型（省 token），存新版本时再塞回去，而且只有一份
    expect(revise.messages[1].content).not.toContain('data-hakcc-kit');
    expect(h.rows[1].html.match(/<style data-hakcc-kit>/g)).toHaveLength(1);

    const other = { ...context([]), userId: '66666666-6666-4666-8666-666666666666' };
    const denied = await executeReviseArtifact({ artifact_id: first.id, instructions: '改' }, other);
    expect(denied.success).toBe(false);
  });
});

describe('网页脚本的语法检查', () => {
  const page = (script: string) => PAGE.replace('</body>', `<script>${script}</script></body>`);

  it('只查网页自己写的脚本（组件库、JSON 数据跳过），只解析不执行', () => {
    expect(scriptSyntaxErrors(page('document.title = "ok";'))).toEqual([]);
    expect(scriptSyntaxErrors(page('const m = ; m n'))).toHaveLength(1);
    expect(scriptSyntaxErrors('<script data-hakcc-kit>this is not js</script><script type="application/json">{"a":</script>')).toEqual([]);
    // 只解析：写了会抛错的代码也不会被执行
    expect(scriptSyntaxErrors(page('throw new Error("不会执行")'))).toEqual([]);
  });

  it('有语法错误：把报错交回去修一次，修好了就用修好的', async () => {
    h.streams = [page('const m = ; m n'), page('document.title = "fixed";')];
    const ctx = context([]);
    const out = await executeCreateArtifact({ title: '修脚本', brief: '一页介绍光合作用需要哪些条件的网页：光照、二氧化碳、水和温度，各配一句说明。' }, ctx);
    expect(out.success).toBe(true);
    const builds = h.bodies.filter(b => b.stream);
    expect(builds).toHaveLength(2);
    expect(builds[1].messages.at(-1).content).toContain('脚本有语法错误');
    expect(h.rows[0].html).toContain('document.title = "fixed"');
  });

  it('修了还是错：留原来那版（内容照样看得见），不让整个网页失败', async () => {
    h.streams = [page('const m = ; m n'), page('still ( broken')];
    const ctx = context([]);
    const out = await executeCreateArtifact({ title: '修不好', brief: '一页介绍光合作用需要哪些条件的网页：光照、二氧化碳、水和温度，各配一句说明。' }, ctx);
    expect(out.success).toBe(true);
    expect(h.rows[0].html).toContain('const m = ; m n');
  });
});

describe('智能体循环：给了选项就停下', () => {
  it('ask_choice 之后不再问模型；正文用模型写的引导语，done 里写明是哪个工具停的', async () => {
    h.replies = [{
      message: {
        content: '先请你定一下呈现方式。',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ask_choice', arguments: JSON.stringify({ question: '用哪种方式呈现？', options: [{ label: '概念图' }, { label: '对比表' }] }) } }],
      },
      finish_reason: 'tool_calls',
    }];
    const events: Array<Record<string, unknown>> = [];
    const ctx = context(events);
    const loopEvents: AgentStreamEvent[] = [];
    for await (const e of runAgentLoopStream({
      providerId: 'zhipu', model: 'glm-5.3', apiKey: 'k', systemPrompt: '系统', messages: [{ role: 'user', content: '把笔记做成网页' }],
      tools: [{ type: 'function', function: { name: 'ask_choice', description: 'x', parameters: {} } }],
      executeToolFn: (name, args) => (name === 'ask_choice' ? executeAskChoice(args, ctx) : Promise.resolve({ success: false, data: null })),
    })) loopEvents.push(e);
    expect(h.bodies).toHaveLength(1);
    const text = loopEvents.filter(e => e.type === 'token').map(e => (e as { content: string }).content).join('');
    expect(text).toBe('先请你定一下呈现方式。');
    const done = loopEvents.find(e => e.type === 'done') as Extract<AgentStreamEvent, { type: 'done' }>;
    expect(done.result).toMatchObject({ content: text, finishReason: 'completed', endedByTool: 'ask_choice' });
    expect(events).toEqual([{ agentQuestion: ctx.turn!.question }]);
  });
});

describe('接着上一轮', () => {
  it('提示词里写清楚做过的网页（带 artifact_id）、上一轮的计划、上一轮问了什么', () => {
    const text = makerMemorySection({
      artifacts: [{ id: 'a1', groupId: 'g1', title: '概念图', version: 2, kind: 'html', bytes: 1000 }],
      plan: { steps: [{ title: '找笔记', status: 'done' }, { title: '做网页', status: 'pending' }] },
      pendingQuestion: { id: 'q1', question: '用哪种方式？', options: [{ label: '概念图' }, { label: '对比表' }], allowOther: true },
    });
    expect(text).toContain('《概念图》 artifact_id: a1（第 2 版）');
    expect(text).toContain('1. 找笔记（已做完）');
    expect(text).toContain('2. 做网页（未做）');
    expect(text).toContain('「用哪种方式？」 选项：概念图 / 对比表');
    expect(makerMemorySection({ artifacts: [], plan: null, pendingQuestion: null })).toBe('');
  });

  it('学生点的选项：要有问题编号和选项名', () => {
    expect(parseStudentChoice({ question_id: '77777777-7777-4777-8777-777777777777', label: '  对比表 ' })).toEqual({ questionId: '77777777-7777-4777-8777-777777777777', label: '对比表' });
    expect(parseStudentChoice({ question_id: 'nope', label: '对比表' })).toBeNull();
    expect(parseStudentChoice({ question_id: '77777777-7777-4777-8777-777777777777', label: '', other: true })).toBeNull();
  });
});

describe('模式清单', () => {
  it('四个工具名两边一致；「动手做」模式认得，学生用的几个模式都带上这四个工具', () => {
    expect(MAKER_TOOLS).toEqual([...MAKER_TOOL_NAMES]);
    expect(normalizeConversationAgentMode('maker')).toBe('maker');
    for (const mode of ['maker', 'idea_coach', 'gap_finder', 'connection_scout', 'evidence_broker', 'rise_above_coach']) {
      expect(getAgentModeToolNames(mode)).toEqual(expect.arrayContaining([...MAKER_TOOL_NAMES]));
    }
    expect(getAgentModeToolNames('lesson_planner')).not.toContain('create_artifact');
  });
});
