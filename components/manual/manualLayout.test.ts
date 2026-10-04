import { describe, expect, it } from 'vitest';
import { buildLessons, searchSections } from './manualLayout';
import { MANUAL_SECTIONS, type Block } from './manualContent';

describe('manual lesson composition', () => {
  it('keeps steps with their screenshot and schematic inside the same topic', () => {
    const blocks: Block[] = [
      { kind: 'h3', zh: '操作', en: 'Action' },
      { kind: 'clip', src: '/manual/c04-buildon', cap: { zh: '录像', en: 'Recording' } },
      { kind: 'steps', zh: ['选择 Note'], en: ['Select a Note'] },
      { kind: 'demo', id: 'buildon', cap: { zh: '原理', en: 'Concept' } },
      { kind: 'h3', zh: '关系', en: 'Relations' },
      { kind: 'p', zh: '选择关系', en: 'Choose a relation' },
    ];
    const lessons = buildLessons(blocks);
    expect(lessons).toHaveLength(2);
    expect(lessons[0].body.map(b => b.block.kind)).toEqual(['steps']);
    expect(lessons[0].media.map(b => b.block.kind)).toEqual(['clip', 'demo']);
    expect(lessons[1].heading?.zh).toBe('关系');
  });
  it('preserves every existing content block exactly once', () => {
    for (const section of MANUAL_SECTIONS) {
      const rebuilt = buildLessons(section.blocks).flatMap(l => [
        ...(l.heading ? [{ index: l.headingIndex, block: l.heading }] : []),
        ...l.body, ...l.media, ...l.details,
      ]).sort((a,b) => a.index-b.index).map(x=>x.block);
      expect(rebuilt).toEqual(section.blocks);
    }
  });
  it('finds instructions inside paragraphs and FAQs while respecting the allowed sections', () => {
    const studentSections = MANUAL_SECTIONS.filter(s=>!s.teacherOnly);
    expect(searchSections(studentSections, '忘记密码', 'zh').some(s=>s.id==='faq')).toBe(true);
    expect(searchSections(studentSections, '  BUILD-ON  ', 'en').some(s=>s.id==='buildon')).toBe(true);
    expect(searchSections(studentSections, '', 'zh')).toEqual(studentSections);
    expect(searchSections(studentSections, 'a-query-that-does-not-exist', 'en')).toEqual([]);
    expect(searchSections(studentSections, 'AI', 'en').some(s=>s.teacherOnly)).toBe(false);
  });
});
