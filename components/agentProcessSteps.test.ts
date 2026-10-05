import { describe, expect, it } from 'vitest';
import { applyToolEvent, formatSeconds, PREPARE_STEP, stepsFromMetadata } from './agentProcessSteps';

/**
 * AI 回答时的每一步：三条后端路径发来的事件折成同一份列表（AgentProcess 显示）。
 */

describe('智能体（笔记页 agent-stream、知识空间）：每个工具一开一关', () => {
  it('开始是转圈，结束打勾，带结果和用时', () => {
    let steps = applyToolEvent([], { toolStatus: 'running', toolName: 'search_notes' });
    expect(steps).toEqual([{ name: 'search_notes', status: 'running' }]);
    steps = applyToolEvent(steps, { toolStatus: 'used', toolName: 'search_notes', toolSummary: '找到 5 条', toolDurationMs: 820 });
    expect(steps).toEqual([{ name: 'search_notes', status: 'done', result: '找到 5 条', duration: 820 }]);
  });

  it('同一个工具调两次：结束的是后一次', () => {
    let steps = applyToolEvent([], { toolStatus: 'running', toolName: 'read_note' });
    steps = applyToolEvent(steps, { toolStatus: 'used', toolName: 'read_note', toolSummary: '读了 300 字' });
    steps = applyToolEvent(steps, { toolStatus: 'running', toolName: 'read_note' });
    steps = applyToolEvent(steps, { toolStatus: 'used', toolName: 'read_note', toolSummary: '读了 120 字' });
    expect(steps.map(s => `${s.status}:${s.result}`)).toEqual(['done:读了 300 字', 'done:读了 120 字']);
  });
});

describe('笔记页「自由提问」（ai/stream）', () => {
  it('联网搜索：running/used 带名字和结果', () => {
    let steps = applyToolEvent([], { toolStatus: 'running', toolNames: ['tavily_search'] });
    steps = applyToolEvent(steps, { toolStatus: 'used', toolName: 'tavily_search', toolNames: ['tavily_search'], toolSummary: '找到 3 条网页结果' });
    expect(steps).toEqual([{ name: 'tavily_search', status: 'done', result: '找到 3 条网页结果' }]);
  });

  it('回答前找相关内容：不带名字的 running；结束时用上了哪些就换成哪些', () => {
    let steps = applyToolEvent([], { toolStatus: 'running' });
    expect(steps).toEqual([{ name: PREPARE_STEP, status: 'running' }]);
    steps = applyToolEvent(steps, { toolStatus: 'used', toolNames: ['search_space_notes'] });
    expect(steps).toEqual([{ name: PREPARE_STEP, status: 'done' }, { name: 'search_space_notes', status: 'done' }]);
  });

  it('什么也没用上：这一步撤掉，也不会一直转圈', () => {
    let steps = applyToolEvent([], { toolStatus: 'running' });
    steps = applyToolEvent(steps, { toolStatus: 'used', toolNames: [] });
    expect(steps).toEqual([]);
  });

  it('不认识的事件：原样返回', () => {
    const steps = [{ name: 'x', status: 'done' as const }];
    expect(applyToolEvent(steps, { toolStatus: 'weird' })).toEqual(steps);
  });
});

describe('回看：存下来的回答里的步骤', () => {
  it('新的回答：tool_steps 带结果和用时', () => {
    expect(stepsFromMetadata({ tool_steps: [{ name: 'get_note_context', summary: '找到 3 条 Build-on 关系', ms: 640 }] }))
      .toEqual([{ name: 'get_note_context', status: 'done', result: '找到 3 条 Build-on 关系', duration: 640 }]);
  });

  it('以前的回答只有 tools_used：还原成完成、去重', () => {
    expect(stepsFromMetadata({ tools_used: ['search_notes', 'search_notes', 'read_note'] }))
      .toEqual([{ name: 'search_notes', status: 'done' }, { name: 'read_note', status: 'done' }]);
  });

  it('什么都没有、或者形状不对：空列表', () => {
    expect(stepsFromMetadata(undefined)).toEqual([]);
    expect(stepsFromMetadata({ tool_steps: [{ nope: 1 }] })).toEqual([]);
    expect(stepsFromMetadata({ tool_steps: [] })).toEqual([]);
  });
});

describe('秒数', () => {
  it('十秒以内一位小数，之后取整', () => {
    expect(formatSeconds(820)).toBe('0.8');
    expect(formatSeconds(6400)).toBe('6.4');
    expect(formatSeconds(12600)).toBe('13');
  });
});
