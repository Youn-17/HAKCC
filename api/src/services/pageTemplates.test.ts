import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('../config/supabase', () => {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, order: () => b,
    limit: () => Promise.resolve({ data: h.rows, error: null }),
  });
  return { supabase: { from: () => b } };
});

import { BUILTIN_TEMPLATES, findTemplate, listTemplates, templateBrief, templateSlug, templatesSection } from './pageTemplates';

/** 网页模板（技能库，第五步）：平台自带的、本课的；提示词里只放名字，做网页时才加载结构 */

describe('网页模板', () => {
  it('平台自带四种，英文名不重；自测题的最后一题留给学生自己写', () => {
    expect(BUILTIN_TEMPLATES.map(t => t.slug)).toEqual(['compare_table', 'self_quiz', 'timeline', 'idea_map']);
    expect(BUILTIN_TEMPLATES.find(t => t.slug === 'self_quiz')!.guide).toContain('最后一题是开放题');
  });

  it('提示词里只有名字和什么时候用；本课的标出来', async () => {
    h.rows = [{ id: 't1', slug: 'course_page', name: '论证拆解', when_to_use: '把一条论证拆成主张、依据、反例', guide: '三栏……', source_artifact_id: 'a1' }];
    const all = await listTemplates('c1');
    const text = templatesSection(all);
    expect(text).toContain('- compare_table：对比表，把两到四种观点、做法或证据并排比较');
    expect(text).toContain('- course_page：论证拆解，把一条论证拆成主张、依据、反例（本课老师存的）');
    expect(text).not.toContain('三栏');
  });

  it('按英文名找：平台自带的不查库；本课的从库里找；乱写的找不到', async () => {
    h.rows = [{ id: 't1', slug: 'course_page', name: '论证拆解', when_to_use: 'w', guide: '三栏：主张、依据、反例', source_artifact_id: null }];
    expect((await findTemplate('c1', 'timeline'))?.name).toBe('时间线');
    const course = await findTemplate('c1', 'course_page');
    expect(course && templateBrief(course)).toBe('按「论证拆解」模板的结构来写（内容照制作说明，结构照这里）：\n三栏：主张、依据、反例');
    expect(await findTemplate('c1', 'nope')).toBeNull();
    expect(await findTemplate('c1', '')).toBeNull();
  });

  it('本课模板的英文名不和平台的、已有的重', () => {
    expect(templateSlug('论证拆解', [])).toBe('course_page');
    expect(templateSlug('论证拆解', ['course_page'])).toBe('course_page_2');
    expect(templateSlug('Debate map', [])).toBe('course_debate_map');
  });
});
