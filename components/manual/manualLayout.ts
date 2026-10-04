import type { Block, ManualSection } from './manualContent';

export type MediaBlock = Extract<Block, { kind: 'figure' | 'clip' | 'demo' }>;
type Entry<T = Block> = { index: number; block: T };
export interface Lesson {
  heading?: Extract<Block, { kind: 'h3' }>;
  headingIndex: number;
  body: Entry[];
  media: Entry<MediaBlock>[];
  details: Entry[];
}

/** A topic keeps its explanation beside its media; reference tables follow at full width. */
export function buildLessons(blocks: Block[]): Lesson[] {
  const lessons: Lesson[] = [];
  let current: Lesson = { headingIndex: -1, body: [], media: [], details: [] };
  for (const [index, block] of blocks.entries()) {
    if (block.kind === 'h3') {
      if (current.heading || current.body.length || current.media.length || current.details.length) lessons.push(current);
      current = { heading: block, headingIndex: index, body: [], media: [], details: [] };
    } else if (block.kind === 'figure' || block.kind === 'clip' || block.kind === 'demo') {
      current.media.push({ index, block });
    } else if (block.kind === 'table' || block.kind === 'faq') {
      current.details.push({ index, block });
    } else {
      current.body.push({ index, block });
    }
  }
  if (current.heading || current.body.length || current.media.length || current.details.length) lessons.push(current);
  return lessons;
}

export function searchSections(sections: ManualSection[], query: string, lang: 'zh' | 'en'): ManualSection[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return sections;
  // Only collect translated prose, not file paths or hidden role-specific content.
  function prose(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    if (Array.isArray(value)) return value.map(prose).join(' ');
    const object = value as Record<string, unknown>;
    if (lang in object) return String(object[lang]);
    return Object.values(object).map(prose).join(' ');
  }
  return sections.filter(section => prose(section).toLocaleLowerCase().includes(term));
}
