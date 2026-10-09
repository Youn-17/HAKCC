/**
 * 画布搜索（2026-10-09 用户：进了知识空间想找一条要 Build-on 的笔记，找起来很麻烦）。
 *
 * 按标题、作者名、正文找。输入几个词用空格隔开时，每个词都要在其中一处出现。
 * 排序：标题里出现 > 作者名 > 正文；分数一样的新的在前。
 * 正文用 noteSearchText 取看得见的字（直接比 HTML 会命中标签和 &nbsp;，见 noteTextSites.test）。
 */

export interface SearchableNote {
  id: string;
  title: string;
  author: string;
  /** 看得见的正文，已经小写（noteSearchText） */
  text: string;
  createdAt?: string;
}

export type SearchField = 'title' | 'author' | 'content';

export interface SearchHit {
  id: string;
  score: number;
  /** 最能说明为什么命中的那一处 */
  field: SearchField;
  /** 命中在正文里时，命中词前后的一小段 */
  snippet?: string;
}

export function searchTokens(query: string): string[] {
  return Array.from(new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean))).slice(0, 8);
}

function scoreToken(note: SearchableNote, token: string): { score: number; field: SearchField } | null {
  const title = note.title.toLowerCase();
  const author = note.author.toLowerCase();
  if (author === token) return { score: 5, field: 'author' };
  if (title.includes(token)) return { score: title.startsWith(token) ? 5 : 4, field: 'title' };
  if (author.includes(token)) return { score: 3, field: 'author' };
  if (note.text.includes(token)) return { score: 1, field: 'content' };
  return null;
}

/** 正文里命中词前后各 radius 个字，两头省略。 */
export function snippetAround(text: string, token: string, radius = 18): string {
  const at = text.indexOf(token);
  if (at < 0) return '';
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + token.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export function searchNotes(notes: readonly SearchableNote[], query: string, limit = 50): SearchHit[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const hits: Array<SearchHit & { t: number }> = [];
  for (const note of notes) {
    let score = 0;
    let best: { score: number; field: SearchField } | null = null;
    let contentToken: string | null = null;
    let missed = false;
    for (const token of tokens) {
      const s = scoreToken(note, token);
      if (!s) { missed = true; break; }
      score += s.score;
      if (!best || s.score > best.score) best = s;
      if (s.field === 'content' && !contentToken) contentToken = token;
    }
    if (missed || !best) continue;
    hits.push({
      id: note.id,
      score,
      field: best.field,
      snippet: contentToken ? snippetAround(note.text, contentToken) : undefined,
      t: note.createdAt ? Date.parse(note.createdAt) || 0 : 0,
    });
  }
  hits.sort((a, b) => b.score - a.score || b.t - a.t);
  return hits.slice(0, limit).map(({ t: _t, ...hit }) => hit);
}

/** 把一段字按命中词切开，给界面加底色用。不区分大小写，原文大小写不变。 */
export function highlightParts(text: string, tokens: readonly string[]): Array<{ text: string; hit: boolean }> {
  if (!text) return [];
  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    if (!token) continue;
    let from = 0;
    for (;;) {
      const at = lower.indexOf(token, from);
      if (at < 0) break;
      for (let i = at; i < at + token.length; i++) marks[i] = true;
      from = at + token.length;
    }
  }
  const parts: Array<{ text: string; hit: boolean }> = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marks[i] !== marks[start]) {
      parts.push({ text: text.slice(start, i), hit: marks[start] });
      start = i;
    }
  }
  return parts;
}
