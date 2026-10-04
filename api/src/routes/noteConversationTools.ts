export type ConversationToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type SpaceNoteForTool = {
  id: string;
  title?: string | null;
  content?: string | null;
  author?: string | null;
  created_at?: string | null;
};

export type RankedToolNote = {
  id: string;
  title: string;
  snippet: string;
  score: number;
};

export function buildConversationToolDefinitions(): ConversationToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'get_current_note_context',
        description: 'Read the current Knowledge Building Note title and content summary.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_related_notes',
        description: 'Read Notes directly connected to the current Note through Build-on relations.',
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Maximum number of related Notes to return.',
              minimum: 1,
              maximum: 8,
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_space_notes',
        description: 'Search Notes in the same Knowledge Building space for evidence, related ideas, or contrasting perspectives.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'A short search query based on the learner question or current idea.',
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of matching Notes to return.',
              minimum: 1,
              maximum: 8,
            },
          },
          required: ['query'],
        },
      },
    },
  ];
}

export function safeJsonParseToolArgs(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function clampToolLimit(value: unknown, fallback = 6): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

export function summarizeForTool(value?: string | null, maxLength = 420): string {
  const text = stripHtmlForTool(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

export function rankSpaceNotesForTool(params: {
  query: string;
  currentNoteId: string;
  notes: SpaceNoteForTool[];
  limit?: number;
}): RankedToolNote[] {
  const terms = tokenizeQuery(params.query);
  if (terms.length === 0) return [];
  const limit = clampToolLimit(params.limit, 6);
  return params.notes
    .filter(note => note.id !== params.currentNoteId)
    .map(note => {
      const title = note.title ?? 'Untitled Note';
      const content = stripHtmlForTool(note.content ?? '');
      const titleLower = title.toLowerCase();
      const contentLower = content.toLowerCase();
      const score = terms.reduce((total, term) => {
        const termLower = term.toLowerCase();
        let next = total;
        if (titleLower.includes(termLower)) next += 3;
        if (contentLower.includes(termLower)) next += 1;
        return next;
      }, 0);
      return {
        id: note.id,
        title,
        snippet: summarizeForTool(content, 260),
        score,
      };
    })
    .filter(note => note.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function shouldPrepareConversationTools(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const contextSignals = [
    '关联', '连接', '同学', '别人', '其他笔记', '其他 note', 'build-on',
    '证据', '来源', '文献', '资料', '引用', '搜索', '查找', '网上', '最新',
    'related', 'evidence', 'source', 'search', 'web', 'reference', 'citation',
  ];
  return contextSignals.some(signal => normalized.includes(signal));
}

function tokenizeQuery(query: string): string[] {
  const normalized = query.replace(/[，。！？；、,.!?;:()[\]{}"'`~]/g, ' ');
  const tokens = normalized.split(/\s+/).map(token => token.trim()).filter(Boolean);
  if (tokens.length > 0) return Array.from(new Set(tokens)).slice(0, 12);
  const compact = normalized.trim();
  if (!compact) return [];
  return [compact];
}

function stripHtmlForTool(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
