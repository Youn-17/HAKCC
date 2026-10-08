import { describe, expect, it } from 'vitest';
import { modelContextBudget, selectModelHistory } from './modelContextBudget';
describe('model-sized conversation context', () => {
  it('uses the verified 1M window without a 100-message ceiling', () => {
    const budget = modelContextBudget('deepseek', 'deepseek-flash');
    const messages = Array.from({ length: 1200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `详细讨论${i}` }));
    expect(budget.contextTokens).toBe(1_000_000);
    expect(selectModelHistory(messages, budget)).toEqual(messages);
  });
  it('keeps course model selection and reserves room for prompts, tools and output', () => {
    expect(modelContextBudget('moonshot', 'kimi-k3').contextTokens).toBe(1_000_000);
    const small = modelContextBudget('custom', 'unverified-model');
    expect(small.verified).toBe(false);
    const messages = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '中'.repeat(1000) }));
    messages.push({ role: 'user', content: '继续我的问题' });
    const selected = selectModelHistory(messages, small);
    expect(selected.length).toBeLessThan(messages.length);
    expect(selected.at(-1)).toEqual(messages.at(-1));
    expect(selected[0].role).toBe('user');
    expect(selected.reduce((n,m) => n + Buffer.byteLength(m.content) + 32, 0)).toBeLessThanOrEqual(small.historyBytes);
  });
});
