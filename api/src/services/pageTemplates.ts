/**
 * 网页模板（技能库，2026-10-11 第五步）。智能体做网页时在 create_artifact 里带 template，写网页的模型
 * 拿到这个模板的结构说明再写，越用越稳。平台自带的几种写在这里；老师可以把做得好的网页存成本课模板
 * （agent_page_templates，迁移 094，只存版式、组件、交互，不存具体内容）。
 * 智能体的提示词里只放模板名和什么时候用，结构说明到真要做网页时才加载。
 */
import { supabase } from '../config/supabase';

export interface PageTemplate {
  slug: string;
  name: string;
  whenToUse: string;
  guide: string;
  builtin: boolean;
  id?: string;
  sourceArtifactId?: string | null;
}

export const BUILTIN_TEMPLATES: PageTemplate[] = [
  {
    slug: 'compare_table',
    name: '对比表',
    whenToUse: '把两到四种观点、做法或证据并排比较',
    builtin: true,
    guide: [
      '顶部一句话说明比的是什么、出自哪些笔记。',
      '主体是表格：每列一种观点（列头写观点名和作者），每行一个比较维度（主张、依据、适用条件、还没回答的问题）。',
      '单元格里放笔记原话或要点，原话加引号并标作者；没有材料的格子写「笔记里还没有」，不要编。',
      '表格下面留「你的判断」：两三个开放问题（如「哪一列的依据最站得住？为什么？」），配文本框让学生写，不给标准答案。',
      '窄屏时表格可横向滚动，列头固定。',
    ].join('\n'),
  },
  {
    slug: 'self_quiz',
    name: '自测题',
    whenToUse: '帮学生检查自己对一组笔记或概念的理解',
    builtin: true,
    guide: [
      '5–8 题，先易后难；题目来自笔记和课程资料，每题标出处。',
      '选择题答完立刻显示对错和一句解析（解析引用笔记原话），可以重做。',
      '最后一题是开放题：请学生用自己的话写一段，配文本框，不给参考答案，只给两三个思考提示。',
      '顶部显示进度（第几题 / 共几题），最后显示得分；不排名、不评价学生，不要计时器。',
    ].join('\n'),
  },
  {
    slug: 'timeline',
    name: '时间线',
    whenToUse: '按时间或讨论先后梳理一条线索：观点怎么演变、谁接了谁',
    builtin: true,
    guide: [
      '竖向时间线，每个节点：日期或顺序、笔记标题、作者、一句要点；点开节点展开原话。',
      '用颜色或标签区分节点类型（提出、补充、质疑、证据、综合），图例放在顶部。',
      '线索出现分歧或空缺的地方加一个「这里还没人回应」的标记。',
      '末尾留一个开放问题「接下来这条线可以往哪走？」，配文本框。',
    ].join('\n'),
  },
  {
    slug: 'idea_map',
    name: '观点地图',
    whenToUse: '展示几条笔记之间的关系：谁接了谁、哪里有分歧、哪里能连起来',
    builtin: true,
    guide: [
      '节点是笔记（标题 + 作者），连线标关系（补充、质疑、举证、综合）；用 SVG 画，节点可点。',
      '点节点在侧栏显示原话和它连着的笔记。',
      '内容相关但还没连起来的笔记用虚线标出，提示「可能可以连起来」。',
      '图上不下结论；页面下方留文本框，让学生写自己看到的联系。',
    ].join('\n'),
  },
];

type Row = { id: string; slug: string; name: string; when_to_use: string; guide: string; source_artifact_id: string | null };

export async function courseTemplates(courseId: string): Promise<PageTemplate[]> {
  const { data, error } = await supabase
    .from('agent_page_templates').select('id, slug, name, when_to_use, guide, source_artifact_id')
    .eq('course_id', courseId).eq('status', 'active').order('created_at', { ascending: true }).limit(20);
  if (error) {
    console.error('[PageTemplates] load failed:', error.message);
    return [];
  }
  return ((data ?? []) as Row[]).map(r => ({
    id: r.id, slug: r.slug, name: r.name, whenToUse: r.when_to_use, guide: r.guide, builtin: false, sourceArtifactId: r.source_artifact_id,
  }));
}

export async function listTemplates(courseId: string): Promise<PageTemplate[]> {
  return [...BUILTIN_TEMPLATES, ...(await courseTemplates(courseId))];
}

/** 真要做网页时才加载结构说明；找不到就不用模板 */
export async function findTemplate(courseId: string, slug: unknown): Promise<PageTemplate | null> {
  if (typeof slug !== 'string' || !slug.trim()) return null;
  const key = slug.trim();
  const builtin = BUILTIN_TEMPLATES.find(t => t.slug === key);
  if (builtin) return builtin;
  return (await courseTemplates(courseId)).find(t => t.slug === key) ?? null;
}

/** 智能体提示词里那一行：只有名字和什么时候用 */
export function templatesSection(templates: PageTemplate[]): string {
  if (templates.length === 0) return '';
  const lines = templates.map(t => `- ${t.slug}：${t.name}，${t.whenToUse}${t.builtin ? '' : '（本课老师存的）'}`);
  return ['做网页时，合适的话在 create_artifact 里带 template（下面的英文名），写网页的模型会照这个模板的结构写；都不合适就不带：', ...lines].join('\n');
}

/** 交给写网页的模型的那一段 */
export function templateBrief(t: PageTemplate): string {
  return `按「${t.name}」模板的结构来写（内容照制作说明，结构照这里）：\n${t.guide}`;
}

/** 本课模板的英文名：从名字生成，和已有的不重 */
export function templateSlug(name: string, taken: string[]): string {
  const base = `course_${(name.toLowerCase().match(/[a-z0-9]+/g) ?? []).join('_').slice(0, 24) || 'page'}`;
  let slug = base;
  for (let i = 2; taken.includes(slug) || BUILTIN_TEMPLATES.some(t => t.slug === slug); i++) slug = `${base}_${i}`;
  return slug;
}
