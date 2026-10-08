/** Read the same recent window in each assistant; bound input by size, not six turns. */
export const CONVERSATION_HISTORY_LIMIT = 100;
export const CONVERSATION_HISTORY_CHAR_BUDGET = 32_000;

/** Keep complete recent messages in order. Do not replace details with first-sentence summaries. */
export function selectConversationHistory<T extends { role: string; content?: string | null }>(
  history: T[],
  maxMessages = CONVERSATION_HISTORY_LIMIT,
  charBudget = CONVERSATION_HISTORY_CHAR_BUDGET,
): T[] {
  const messages = history.filter(message => message.content?.trim());
  let start = messages.length;
  let chars = 0;
  const limit = Math.max(1, Math.floor(maxMessages));
  while (start > 0 && messages.length - start < limit) {
    const size = messages[start - 1].content!.length;
    // Always retain the current question, including a large attachment sent this turn.
    if (start < messages.length && chars + size > charBudget) break;
    chars += size;
    start--;
  }
  const selected = messages.slice(start);
  // An assistant response without its question is not a complete earlier exchange.
  if (start > 0 && selected[0]?.role === 'assistant' && selected.length > 1) selected.shift();
  return selected;
}
