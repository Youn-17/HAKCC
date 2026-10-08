/** Official model windows verified 2026-10-07. Unknown models use a conservative fallback.
 * Sources: DeepSeek pricing; Moonshot Kimi K3 model card / API troubleshooting;
 * Google Gemini model docs; Anthropic 1M GA announcement.
 * Gateways may impose smaller account limits than their underlying models.
 */
export type ModelContextBudget = { contextTokens: number; historyBytes: number; verified: boolean };
export function modelContextBudget(providerId: string, model: string): ModelContextBudget {
  let contextTokens = 32_768;
  let verified = false;
  if ((providerId === 'deepseek' || providerId === 'dmx' || providerId === 'dmxapi') && /^(deepseek-flash|deepseek-v4-(pro|flash)|deepseek-chat|deepseek-reasoner)$/.test(model)) {
    contextTokens = 1_000_000; verified = true;
  } else if (model === 'kimi-k3') { contextTokens = 1_000_000; verified = true;
  } else if (/^kimi-k2\.(5|6|7)(-|$)/.test(model)) { contextTokens = 262_144; verified = true;
  } else if (/^claude-(opus|sonnet)-4[-.]6/.test(model)) { contextTokens = 1_000_000; verified = true;
  } else if (model === 'gemini-2.5-flash' || model === 'gemini-2.5-pro') { contextTokens = 1_048_576; verified = true; }
  // UTF-8 bytes plus framing is a conservative text-token upper bound, not a tokenizer.
  // Reserve at least 25% for instructions, Note context, tools, images and output.
  return { contextTokens, historyBytes: Math.floor(contextTokens * 0.75) - 8_000, verified };
}
export function selectModelHistory<T extends { role: string; content?: string | null }>(history: T[], budget: ModelContextBudget): T[] {
  const messages = history.filter(m => m.content?.trim());
  let start = messages.length; let size = 0;
  while (start > 0) {
    const bytes = Buffer.byteLength(messages[start - 1].content!, 'utf8') + 32;
    if (start < messages.length && size + bytes > budget.historyBytes) break;
    start--; size += bytes;
  }
  const selected = messages.slice(start);
  if (start > 0 && selected[0]?.role === 'assistant' && selected.length > 1) selected.shift();
  return selected;
}
