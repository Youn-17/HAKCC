import { describe, expect, it } from 'vitest';
import {
  buildConversationToolDefinitions,
  rankSpaceNotesForTool,
  safeJsonParseToolArgs,
  shouldPrepareConversationTools,
} from './noteConversationTools';

describe('note conversation tool definitions', () => {
  it('exposes only read-only course and note context tools', () => {
    const toolNames = buildConversationToolDefinitions().map(tool => tool.function.name);

    expect(toolNames).toEqual([
      'get_current_note_context',
      'list_related_notes',
      'search_space_notes',
    ]);
    expect(toolNames.some(name => /create|update|delete|insert|write/i.test(name))).toBe(false);
  });

  it('parses malformed tool arguments as an empty object', () => {
    expect(safeJsonParseToolArgs('{bad json')).toEqual({});
    expect(safeJsonParseToolArgs('{"query":"计算思维","limit":3}')).toEqual({ query: '计算思维', limit: 3 });
  });
});

describe('shouldPrepareConversationTools', () => {
  it('uses tools only when the prompt asks for external note or source context', () => {
    expect(shouldPrepareConversationTools('算法设计仔细解释一下')).toBe(false);
    expect(shouldPrepareConversationTools('帮我找一下关联笔记里的证据')).toBe(true);
    expect(shouldPrepareConversationTools('Search related sources for this idea')).toBe(true);
  });
});

describe('rankSpaceNotesForTool', () => {
  it('returns the most relevant notes in the same space without the current note', () => {
    const results = rankSpaceNotesForTool({
      query: '计算 思维 算法',
      currentNoteId: 'note-current',
      limit: 2,
      notes: [
        { id: 'note-current', title: '当前 Note', content: '计算思维' },
        { id: 'note-a', title: '算法设计', content: '算法是清晰步骤，适合解释计算思维。' },
        { id: 'note-b', title: '协作学习', content: '共同体讨论。' },
        { id: 'note-c', title: '计算思维', content: '分解、抽象、模式识别和算法。' },
      ],
    });

    expect(results.map(note => note.id)).toEqual(['note-c', 'note-a']);
    expect(results[0].snippet).toContain('分解');
  });
});
