import { describe, expect, it } from 'vitest';
import { summarizeToolResult } from './toolResultSummary';

describe('get_note_context 的一行摘要：说清找到几条 Build-on 关系', () => {
  it('整个空间：用总条数（列表可能被截断）', () => {
    const data = { scope: 'workspace', totalBuildOns: 131, buildOns: new Array(60).fill({}) };
    expect(summarizeToolResult('get_note_context', { success: true, data })).toBe('找到 131 条 Build-on 关系');
    expect(summarizeToolResult('get_note_context', { success: true, data }, 'en')).toBe('131 Build-on links found');
  });

  it('指定一条笔记：数这条笔记自己的关系', () => {
    const data = { noteId: 'n', buildOnRelations: [{}, {}] };
    expect(summarizeToolResult('get_note_context', { success: true, data })).toBe('找到 2 条 Build-on 关系');
  });

  it('一条都没有：明说还没有', () => {
    expect(summarizeToolResult('get_note_context', { success: true, data: { noteId: 'n', buildOnRelations: [] } })).toBe('还没有 Build-on 关系');
    expect(summarizeToolResult('get_note_context', { success: true, data: { scope: 'workspace', totalBuildOns: 0, buildOns: [] } }, 'en')).toBe('no Build-on links yet');
  });

  it('失败照旧显示原因', () => {
    expect(summarizeToolResult('get_note_context', { success: false, data: null, error: 'Note not found' })).toBe('没成功：Note not found');
  });
});
