import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase', () => ({ supabase: {} }));

import { DEFAULTS, collectTurn, digestTrace, forgeToken, needsSecondPass, parseArgs, runEval, parseSse } from './agentEvalRun';

/** 跑评测里不碰网络的几块：参数、令牌、SSE 解析、运行记录摘要 */

describe('参数', () => {
  it('默认演示课、测试学生、DeepSeek Flash、并发 4；可以只跑几题、更新基线', () => {
    expect(parseArgs([])).toMatchObject({ base: DEFAULTS.base, courseId: DEFAULTS.courseId, userId: DEFAULTS.userId, providerId: 'deepseek', model: 'deepseek-flash', concurrency: 4, only: null, updateBaseline: false });
    const cfg = parseArgs(['--base=http://127.0.0.1:4100/api/', '--only=w01-summary, n17-ct', '--concurrency=20', '--update-baseline']);
    expect(cfg.base).toBe('http://127.0.0.1:4100/api');
    expect(cfg.only).toEqual(['w01-summary', 'n17-ct']);
    expect(cfg.concurrency).toBe(8);
    expect(cfg.updateBaseline).toBe(true);
    expect(cfg.confirm).toBe(true);
    expect(parseArgs(['--no-confirm']).confirm).toBe(false);
  });

  it('只有和基线比没过才再跑一遍；只跑几题、没有基线、关掉了都不再跑', () => {
    const fail = { ok: false };
    expect(needsSecondPass(fail, { partial: false, hasBaseline: true, confirm: true })).toBe(true);
    expect(needsSecondPass({ ok: true }, { partial: false, hasBaseline: true, confirm: true })).toBe(false);
    expect(needsSecondPass(fail, { partial: true, hasBaseline: true, confirm: true })).toBe(false);
    expect(needsSecondPass(fail, { partial: false, hasBaseline: false, confirm: true })).toBe(false);
    expect(needsSecondPass(fail, { partial: false, hasBaseline: true, confirm: false })).toBe(false);
    // 要更新基线：过没过都跑两遍取平均，免得一遍的波动把基线拉偏
    expect(needsSecondPass({ ok: true }, { partial: false, hasBaseline: true, confirm: true, updateBaseline: true })).toBe(true);
    expect(needsSecondPass({ ok: true }, { partial: true, hasBaseline: true, confirm: true, updateBaseline: true })).toBe(false);
  });
});

it('requires explicit isolated fixture IDs before running evaluation', async () => {
  await expect(runEval(parseArgs([]))).rejects.toThrow('Pass --course, --space and --user');
});

describe('令牌', () => {
  it('和 Supabase 一样的 HS256：用同一把密钥验得过，sub 是测试学生', () => {
    const token = forgeToken('user-1', 'secret', 60);
    const [h, p, s] = token.split('.');
    expect(createHmac('sha256', 'secret').update(`${h}.${p}`).digest('base64url')).toBe(s);
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toMatchObject({ sub: 'user-1', aud: 'authenticated', role: 'authenticated' });
  });
});

describe('SSE', () => {
  it('收齐回答、过程步骤、计划、选项卡、网页、错误、换模型、对话 id、运行记录 id', () => {
    const text = [
      'data: {"toolStatus":"running","toolName":"search_notes"}',
      'data: {"toolStatus":"used","toolName":"search_notes","toolSummary":"找到 3 条"}',
      'data: {"agentPlan":{"steps":[{"title":"找笔记"},{"title":"做网页"}]}}',
      'data: {"agentQuestion":{"question":"做哪种？","options":[{"label":"表"}],"allowOther":true}}',
      'data: {"artifact":{"id":"a1","title":"对比表"}}',
      'data: {"providerSwitch":{"from":"zhipu","to":"deepseek"}}',
      'data: {"token":"两种"}',
      'data: {"token":"看法"}',
      'data: {"assistantMessage":{"aiMetadata":{"run_id":"run-1"}}}',
      'data: {"done":true,"conversationId":"conv-1"}',
      ': keepalive',
      'data: [DONE]',
    ].join('\n\n');
    const turn = collectTurn(parseSse(text));
    expect(turn).toMatchObject({
      reply: '两种看法',
      toolSteps: [{ name: 'search_notes', summary: '找到 3 条' }],
      plan: { steps: [{ title: '找笔记' }, { title: '做网页' }] },
      questions: [{ question: '做哪种？', allowOther: true }],
      artifacts: [{ id: 'a1', title: '对比表' }],
      errors: [],
      providerSwitches: 1,
      conversationId: 'conv-1',
      runId: 'run-1',
    });
  });
});

describe('运行记录摘要', () => {
  it('从 answer_checked、run_finished、tool_denied 里取出判分要的几项', () => {
    const digest = digestTrace({ metadata: { model: 'deepseek-flash' } }, [
      { effect_type: 'run_started', payload: {} },
      { effect_type: 'tool_denied', payload: { name: 'read_note' } },
      { effect_type: 'answer_checked', payload: { action: 'cleaned', speech_fixed: ['opener'], speech_flagged: [], agency: [] } },
      { effect_type: 'run_finished', payload: { tool_calls: 4, first_token_ms: 1200, total_ms: 9000, usage: { prompt: 1000, completion: 80, calls: 2 }, model: 'deepseek-flash' } },
    ]);
    expect(digestTrace(null, [
      { effect_type: 'run_finished', payload: { truncated: true, provider_finish: 'insufficient_system_resource' } },
    ])).toMatchObject({ truncated: true, providerFinish: 'insufficient_system_resource' });
    expect(digest).toEqual({
      answerCheck: { action: 'cleaned', speech_fixed: ['opener'], speech_flagged: [], agency: [] },
      toolCalls: 4, toolDenied: 1, firstTokenMs: 1200, totalMs: 9000, usage: { prompt: 1000, completion: 80, calls: 2 }, model: 'deepseek-flash',
      truncated: false, providerFinish: null,
    });
  });
});
