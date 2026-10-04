import { describe, expect, it } from 'vitest';
import { formatTavilyResultsForPrompt } from './tavilySearch';

describe('formatTavilyResultsForPrompt', () => {
  it('formats source title, URL, and snippet for the assistant prompt', () => {
    const prompt = formatTavilyResultsForPrompt([
      {
        title: 'Knowledge Building overview',
        url: 'https://example.com/kb',
        content: 'Knowledge building treats ideas as improvable public objects.',
        score: 0.91,
      },
    ]);

    expect(prompt).toContain('Web evidence from Tavily');
    expect(prompt).toContain('[1] Knowledge Building overview');
    expect(prompt).toContain('URL: https://example.com/kb');
    expect(prompt).toContain('improvable public objects');
  });
});
