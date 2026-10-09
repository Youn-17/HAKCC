import { notePreviewText } from './noteText';

/** Linear scan: AI excerpts and scaffold labels do not count as student thinking. */
export function studentAuthoredText(html: string): string {
  const stack: boolean[] = [];
  const output: string[] = [];
  for (const token of html.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (token.startsWith('<')) {
      const tag = token.match(/^<\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
      if (!tag) continue;
      // 属性可能没写值（<strong data-scaffold-tag>，线上有一篇是这样存的）
      const excluded = ['script', 'style'].includes(tag) || stack.at(-1) === true || /\bdata-(?:ai-source|scaffold-tag|scaffold-bracket)(?:\s*=|[\s/>])/.test(token);
      if (!['br', 'img', 'hr', 'input', 'meta', 'link', 'wbr'].includes(tag) && !token.endsWith('/>')) stack.push(excluded);
      if (!excluded) output.push(' ');
    } else if (!stack.at(-1)) output.push(token);
  }
  return notePreviewText(output.join(''));
}
export type UptakeDecision = 'unchanged' | 'review' | 'uncertain';
export function compareFeedbackRevision(before: unknown, after: string): UptakeDecision {
  if (typeof before !== 'string') return 'uncertain';
  const normalize = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  const a = normalize(before), b = normalize(after);
  if (a === b) return 'unchanged';
  // A substantial addition or rewrite is a candidate, never evidence of relevance by itself.
  let prefix = 0;
  while (prefix < Math.min(a.length,b.length) && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(a.length,b.length) - prefix && a[a.length-1-suffix] === b[b.length-1-suffix]) suffix++;
  return b.slice(prefix,b.length-suffix).length >= 12 ? 'review' : 'unchanged';
}
export function validUptakeEvidence(evidence: unknown, before: string, after: string, feedback: string): evidence is string {
  return typeof evidence === 'string' && evidence.trim().length >= 12
    && after.includes(evidence.trim()) && !before.includes(evidence.trim()) && !feedback.includes(evidence.trim());
}
