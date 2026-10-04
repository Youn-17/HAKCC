import { aiFetch } from './aiGateway';
export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type TavilySearchResponse = {
  results: TavilySearchResult[];
  answer?: string;
};

export async function callTavilySearch(
  apiKey: string,
  query: string,
  searchDepth: string,
  maxResults: number,
  includeAnswer: boolean,
): Promise<TavilySearchResponse> {
  const res = await aiFetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: searchDepth,
      max_results: maxResults,
      include_answer: includeAnswer,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Tavily HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  return {
    results: (data.results ?? []).map((item: any) => ({
      title: item.title ?? '',
      url: item.url ?? '',
      content: item.content ?? '',
      score: item.score ?? 0,
    })),
    answer: data.answer,
  };
}

export function formatTavilyResultsForPrompt(results: TavilySearchResult[]): string {
  if (results.length === 0) return '';
  const snippets = results
    .slice(0, 5)
    .map((result, index) => [
      `[${index + 1}] ${result.title || 'Untitled source'}`,
      result.url ? `URL: ${result.url}` : '',
      `Snippet: ${result.content.slice(0, 520)}`,
    ].filter(Boolean).join('\n'))
    .join('\n\n');

  return [
    'Web evidence from Tavily. Use it only when it helps the learner improve the public idea object.',
    'When you use this evidence, cite the source title or URL and distinguish it from the student idea.',
    snippets,
  ].join('\n\n');
}
