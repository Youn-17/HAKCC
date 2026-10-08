import { supabase } from '../config/supabase';
import { ApiError } from '../middleware/errorHandler';
import type { MemoryMessage } from './conversationMemory';
import { selectModelHistory, type ModelContextBudget } from './modelContextBudget';
/** Caller must first authorize thread access. Paginate: PostgREST caps each page at 1000. */
export async function loadModelConversationHistory(kind: 'workspace' | 'note', id: string, budget: ModelContextBudget): Promise<MemoryMessage[]> {
  const table = kind === 'note' ? 'note_conversation_messages' : 'agent_messages';
  const foreignKey = kind === 'note' ? 'thread_id' : 'conversation_id';
  const messages: MemoryMessage[] = [];
  let bytes = 0;
  for (let offset = 0; bytes < budget.historyBytes; offset += 1000) {
    const { data, error } = await supabase.from(table)
      .select(kind === 'note' ? 'id, sender_kind, content, created_at' : 'id, role, content, created_at')
      .eq(foreignKey, id).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 999);
    if (error) throw new ApiError(500, '对话历史加载失败，请重试。');
    for (const row of data ?? []) {
      const content = row.content ?? '';
      messages.push({ id: row.id, createdAt: row.created_at, content, role: ('sender_kind' in row ? row.sender_kind : row.role) === 'assistant' ? 'assistant' : 'user' });
      bytes += Math.max(32, Buffer.byteLength(content) + 32);
    }
    if ((data ?? []).length < 1000) break;
  }
  return selectModelHistory(messages.reverse(), budget);
}
