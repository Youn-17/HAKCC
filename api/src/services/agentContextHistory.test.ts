import { describe, expect, it, vi } from 'vitest';
vi.mock('./learnerProfileService', () => ({
  getOrCreateProfile: vi.fn(), getScaffoldingPrompt: vi.fn(), loadReflections: vi.fn(),
  buildReflectionContext: vi.fn(), detectOverrelianceSignals: vi.fn(), updateProfileAfterInteraction: vi.fn(),
}));
import { summarizeHistory, type ConversationMessage } from './agentContext';
import { selectConversationHistory } from './conversationHistory';

describe('AI conversation continuity', () => {
  it('keeps details beyond the first sentence after six exchanges', () => {
    const earlier = 'We are preparing a lesson. The selected topic is evaporation, for class 7B, using a 35-minute lesson.';
    const history: ConversationMessage[] = [
      { role: 'user', content: earlier },
      { role: 'assistant', content: 'First identify the evidence. Compare a covered cup and an open cup, then discuss the change in water level.' },
      ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `Follow-up ${i}` })),
      { role: 'user', content: 'Use the topic, class and duration I gave you above.' },
    ];
    const sent = summarizeHistory(history);
    expect(sent).toEqual(history);
  });
});


describe('conversation input budget', () => {
  it('retains a full conversation of 80 short messages without artificial summaries', () => {
    const history = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `完整细节 ${i}` }));
    expect(selectConversationHistory(history)).toEqual(history);
  });
  it('limits large histories and preserves the current question without promoting user text to system instructions', () => {
    const history = Array.from({ length: 110 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` + 'x'.repeat(1500) }));
    history.push({ role: 'user', content: 'Continue with the same lesson requirements.' });
    const selected = selectConversationHistory(history);
    expect(selected.at(-1)).toEqual(history.at(-1));
    expect(selected.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(32000);
    expect(selected[0].role).toBe('user');
    expect(selected.every(message => history.includes(message))).toBe(true);
  });
  it('keeps a large current question intact and drops prior messages to respect the budget', () => {
    const latest = { role: 'user', content: 'x'.repeat(40000) };
    expect(selectConversationHistory([{ role: 'user', content: 'earlier' }, latest])).toEqual([latest]);
  });
});
