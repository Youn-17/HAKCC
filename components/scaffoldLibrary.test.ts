import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Scaffold, ScaffoldMetadata } from '../types';
import { gaiFlagForSave, isGenAiScaffold, scaffoldGroup } from './scaffoldLibrary';

/**
 * 支架库的共享规则，和 2026-09-29 加进去的「GenAI 互动里的认知主体性支架」（迁移 072 插入 41 条，
 * 迁移 073 按教师改过的表述调整成现在的 34 条、4 组）。
 *
 * 「现在的 34 条」是把 072 的原始 JSON 和 073 的调整 JSON 从 SQL 文件里读出来合成的：那两份文件就是上线的内容，
 * 测试守住的是「不和已有的 147 条重复」「每组条数」「只有并进『判断与取舍』的那 6 条进采纳清单」
 * 「问卷十六题每题至少有一条话头」这些约定。
 */

const scaffold = (metadata: ScaffoldMetadata | undefined, title = '一条支架'): Scaffold => ({
  id: title, title, description: '', category: '', steps: [], usageCount: 0,
  isMandatory: false, isRecommended: false, metadata,
});

describe('isGenAiScaffold：AI 内容入笔记时能选哪些支架', () => {
  it('明确标了 gai:true 的算，不论一级类（CT、KB 里也有转述 GenAI 产出的）', () => {
    expect(isGenAiScaffold(scaffold({ l1: 'CT', gai: true }))).toBe(true);
    expect(isGenAiScaffold(scaffold({ l1: 'KB', gai: true }))).toBe(true);
  });

  it('一级类是 GAI 又没写 gai 的算（老数据和教师自建的）', () => {
    expect(isGenAiScaffold(scaffold({ l1: 'GAI' }))).toBe(true);
    expect(isGenAiScaffold(scaffold({ l1: 'GAI', gai: true }))).toBe(true);
  });

  it('其余的不算：没标、标了 false 的 KB / CT / TB', () => {
    expect(isGenAiScaffold(scaffold(undefined))).toBe(false);
    expect(isGenAiScaffold(scaffold({ l1: 'KB', gai: false }))).toBe(false);
    expect(isGenAiScaffold(scaffold({ l1: 'CT', gai: false }))).toBe(false);
    expect(isGenAiScaffold(scaffold({ l1: 'TB', gai: false }))).toBe(false);
  });

  it('一级类是 GAI 但明确写了 gai:false 的不算：「思考后询问 GAI」这类话头后面放不进 AI 原文', () => {
    expect(isGenAiScaffold(scaffold({ l1: 'GAI', gai: false }))).toBe(false);
  });
});

describe('gaiFlagForSave：教师保存支架时 metadata.gai 怎么写', () => {
  it('新建：一级类是 GAI 才算 GenAI 支架', () => {
    expect(gaiFlagForSave('GAI', null)).toBe(true);
    expect(gaiFlagForSave('KB', null)).toBe(false);
    expect(gaiFlagForSave('CT', undefined)).toBe(false);
  });

  it('改已有的：原来明确是 false 的保持 false，改个字不能让它悄悄进采纳清单', () => {
    expect(gaiFlagForSave('GAI', { l1: 'GAI', gai: false })).toBe(false);
  });

  it('改已有的：原来是 true 的保持 true（CT 里转述 GenAI 产出的那批）', () => {
    expect(gaiFlagForSave('CT', { l1: 'CT', gai: true })).toBe(true);
    expect(gaiFlagForSave('GAI', { l1: 'GAI', gai: true })).toBe(true);
  });

  it('改已有的：老数据没写 gai，按一级类算', () => {
    expect(gaiFlagForSave('GAI', { l1: 'GAI' })).toBe(true);
    expect(gaiFlagForSave('KB', { l1: 'KB' })).toBe(false);
  });
});

// ── 迁移 072 / 073：GenAI 互动里的认知主体性支架 ─────────────────────────

interface InitialRow {
  title: string;
  title_en: string;
  category: string;
  sort_order: number;
  metadata: ScaffoldMetadata & { agency_factor: string; ae_ai_items?: string[]; literacy_items?: string[] };
}
interface AdjustRow {
  old_category: string;
  old_title: string;
  category: string;
  title: string;
  title_en: string;
  l2_zh: string;
  l2_en: string;
  sort_order: number;
  gai: boolean;
}
interface DropRow { category: string; title: string }
interface SnapshotRow {
  id: string;
  title: string;
  title_en?: string;
  category: string;
  sort_order: number;
  metadata?: ScaffoldMetadata;
}

const readMigration = (name: string) => readFileSync(resolve(__dirname, `../supabase/migrations/${name}`), 'utf-8');
const withoutComments = (sql: string) => sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
function jsonBlock<T>(sql: string, tag: string): T {
  return JSON.parse(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(sql)![1]);
}

const code072 = withoutComments(readMigration('072_agency_genai_scaffolds.sql'));
const code073 = withoutComments(readMigration('073_adjust_agency_scaffolds.sql'));
const initialRows = jsonBlock<InitialRow[]>(code072, 'agency');
const adjustRows = jsonBlock<AdjustRow[]>(code073, 'adjust');
const dropRows = jsonBlock<DropRow[]>(code073, 'drop');

/** 现在的 34 条：072 的元数据（题项、功能类型……）加上 073 改的话头、组、次序、采纳标记 */
const rows: InitialRow[] = adjustRows.map(adj => {
  const initial = initialRows.find(r => r.category === adj.old_category && r.title === adj.old_title);
  if (!initial) throw new Error(`073 里的旧条目在 072 里找不到：${adj.old_category} | ${adj.old_title}`);
  return {
    title: adj.title,
    title_en: adj.title_en,
    category: adj.category,
    sort_order: adj.sort_order,
    metadata: { ...initial.metadata, l2_zh: adj.l2_zh, l2_en: adj.l2_en, gai: adj.gai },
  };
});
const asScaffold = (row: InitialRow): Scaffold => ({ ...scaffold(row.metadata, row.title), titleEn: row.title_en, category: row.category });

/** 演示用的快照，来自线上库 */
const snapshot = JSON.parse(readFileSync(resolve(__dirname, '../scripts/manual-capture/scaffolds.json'), 'utf-8')) as SnapshotRow[];
/** 库里原有的 147 条 */
const existing = snapshot.filter(row => row.metadata?.source !== 'agency_design_2026');

const normalize = (text: string) => text.replace(/[\s，。、；：？！…,.:;?!\-—/（）()「」[\]"“”]/g, '').toLowerCase();
const bigrams = (text: string) => {
  const t = normalize(text);
  return new Set(Array.from({ length: Math.max(1, t.length - 1) }, (_, i) => t.slice(i, i + 2)));
};
const similarity = (a: string, b: string) => {
  const A = bigrams(a); const B = bigrams(b);
  const both = [...A].filter(x => B.has(x)).length;
  return both / (A.size + B.size - both);
};

const GROUP = {
  think: '思考后询问 GAI',
  judge: 'GAI 回答的判断与取舍',
  check: 'GAI 多方求证',
  review: 'GAI 使用回顾与校准',
};

describe('迁移 072：最初插入的 41 条', () => {
  it('只新增，不动原有的行；重复执行不会插两遍', () => {
    expect(code072).not.toMatch(/\bupdate\s+public\.scaffolds\b/i);
    expect(code072).not.toMatch(/\bdelete\s+from\b/i);
    expect(code072).toMatch(/on conflict \(category, title\) where course_id is null do nothing/i);
    expect(code072).toMatch(/is_mandatory, is_recommended, course_id, created_by/);
    // 全局支架：course_id 与 created_by 都写空，不带课程
    expect(code072).toMatch(/false, false, null, null,/);
  });

  it('41 条，(category, title) 各不相同：073 靠它对号', () => {
    expect(initialRows).toHaveLength(41);
    const keys = initialRows.map(r => `${r.category}|${r.title}`);
    expect(new Set(keys).size).toBe(41);
  });
});

describe('迁移 073：按教师改的表述调整', () => {
  it('只动 072 加的那 41 条：改的 34 条加删的 7 条正好是那 41 条，各出现一次', () => {
    expect(adjustRows).toHaveLength(34);
    expect(dropRows).toHaveLength(7);
    const initialKeys = initialRows.map(r => `${r.category}|${r.title}`).sort();
    const touched = [
      ...adjustRows.map(r => `${r.old_category}|${r.old_title}`),
      ...dropRows.map(r => `${r.category}|${r.title}`),
    ].sort();
    expect(touched).toEqual(initialKeys);
  });

  it('不新增、不碰别的表，只改全局支架（course_id is null）', () => {
    expect(code073).not.toMatch(/\binsert\s+into\b/i);
    expect([...code073.matchAll(/\bupdate\s+public\.(\w+)/gi)].map(m => m[1])).toEqual(['scaffolds']);
    expect([...code073.matchAll(/\bdelete\s+from\s+public\.(\w+)/gi)].map(m => m[1])).toEqual(['scaffolds']);
    expect(code073.match(/s\.course_id is null/g)).toHaveLength(2);
  });

  it('学生用过的不删：采纳记录、对话消息、笔记上的采纳标签、笔记正文里的 id 都查；条数对不上整份回滚', () => {
    for (const table of ['note_ai_insertions', 'note_conversation_messages']) {
      expect(code073).toMatch(new RegExp(`not exists \\(select 1 from public\\.${table} x where x\\.scaffold_id = s\\.id\\)`));
    }
    expect(code073).toMatch(/x\.ai_adoption_scaffold_id = s\.id/);
    expect(code073).toMatch(/position\(s\.id::text in x\.content\) > 0/);
    expect(code073).toMatch(/raise exception/);
  });

  it('描述和输入框的提示跟着话头走，和 072 插入时的写法一致', () => {
    expect(code073).toMatch(/description = r\.title_en/);
    expect(code073).toMatch(/'prompt', r\.title,/);
    expect(code073).toMatch(/'placeholder', r\.title_en/);
  });

  it('新的 (category, title) 不撞已有的行：唯一索引逐行检查，撞了整份迁移会失败', () => {
    const others = new Set(existing.map(r => `${r.category}|${r.title}`));
    for (const adj of adjustRows) {
      const key = `${adj.category}|${adj.title}`;
      expect(others.has(key), key).toBe(false);
      const clash = initialRows.filter(r => `${r.category}|${r.title}` === key
        && !(r.category === adj.old_category && r.title === adj.old_title));
      expect(clash, key).toHaveLength(0);
    }
  });
});

describe('现在的 GenAI 互动支架：4 组 34 条', () => {
  const byGroup = new Map<string, InitialRow[]>();
  for (const row of rows) byGroup.set(row.metadata.l2_zh!, [...(byGroup.get(row.metadata.l2_zh!) ?? []), row]);

  it('共 4 组 34 条（6 / 14 / 8 / 6），每组条数在一屏放得下的范围内（选择器说明里是最多十七条）', () => {
    expect(rows).toHaveLength(34);
    expect([...byGroup].map(([name, items]) => [name, items.length])).toEqual([
      [GROUP.think, 6], [GROUP.judge, 14], [GROUP.check, 8], [GROUP.review, 6],
    ]);
    for (const [name, items] of byGroup) expect(items.length, name).toBeLessThanOrEqual(17);
  });

  it('分类、排序：接在原有 183 后面、连续；同一分类下没有同名（唯一索引会挡掉，这里提前发现）', () => {
    expect(rows.map(r => r.sort_order)).toEqual(Array.from({ length: rows.length }, (_, i) => 184 + i));
    for (const row of rows) expect(row.category).toBe(`生成式 AI 交互/${row.metadata.l2_zh}`);
    const keys = rows.map(r => `${r.category}|${r.title}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(rows.map(r => r.title_en)).size).toBe(rows.length);
  });

  it('每条都有中英文话头；话头是一句话，不是问句、不带工具名（库里统一写 GenAI，前后不加空格）', () => {
    for (const row of rows) {
      expect(row.title.trim(), row.title).toBe(row.title);
      // 建议 30 字以内；教师自己写的两条略长，这里只挡住写成一段话的
      expect(row.title.length, row.title).toBeLessThanOrEqual(40);
      expect(row.title_en.length, row.title).toBeGreaterThan(8);
      expect(row.title, row.title).not.toMatch(/[？?]$/);
      expect(row.title, row.title).not.toMatch(/GenAI\s|\sGenAI/);
      expect(`${row.title} ${row.title_en}`, row.title).not.toMatch(/chatgpt|gpt-?\d|deepseek|kimi|豆包/i);
    }
  });

  it('元数据：一级类 GAI、来源可区分、Hannafin 功能类型和量表因子都合法', () => {
    const factors = ['adaptive_direction', 'critical_integration', 'cross_source_inquiry', 'reflective_calibration'];
    for (const row of rows) {
      const m = row.metadata;
      expect(m.l1, row.title).toBe('GAI');
      expect(m.source, row.title).toBe('agency_design_2026');
      expect(m.hannafin, row.title).toBe('Human-AI Collaborative');
      expect(['Conceptual', 'Metacognitive', 'Procedural', 'Strategic'], row.title).toContain(m.hannafin_function);
      expect(['Hard', 'Hard→Soft hybrid'], row.title).toContain(m.saye_brush);
      expect(factors, row.title).toContain(m.agency_factor);
      for (const item of m.ae_ai_items ?? []) expect(item, row.title).toMatch(/^(AD|CI|CS|RC)[1-4]$/);
      for (const item of m.literacy_items ?? []) expect(item, row.title).toMatch(/^(EV|CD)[1-4]$/);
      // liu_metacognitive 对新条目没有定义，不能乱填
      expect(m.liu_metacognitive, row.title).toBeUndefined();
    }
  });

  it('每组对应一个 AE-AI 因子（合并进「判断与取舍」的 6 条本来就是批判性整合）', () => {
    const factorOf = (group: string) => [...new Set(byGroup.get(group)!.map(r => r.metadata.agency_factor))];
    expect(factorOf(GROUP.think)).toEqual(['adaptive_direction']);
    expect(factorOf(GROUP.judge)).toEqual(['critical_integration']);
    expect(factorOf(GROUP.check)).toEqual(['cross_source_inquiry']);
    expect(factorOf(GROUP.review)).toEqual(['reflective_calibration']);
  });

  it('问卷 AE-AI 十六题每题至少有一条话头对应（这批支架的设计依据；删话头时别把某一题删空）', () => {
    const covered = new Set(rows.flatMap(r => r.metadata.ae_ai_items ?? []));
    for (const dim of ['AD', 'CI', 'CS', 'RC']) {
      for (let i = 1; i <= 4; i++) expect(covered.has(`${dim}${i}`), `${dim}${i}`).toBe(true);
    }
  });

  it('进「添加到 Note」必选清单的只有并进「判断与取舍」的那 6 条（AI 原文放在话头后面的方括号里）；其余是学生写自己想法的话头，不进', () => {
    const adopt = rows.filter(r => r.metadata.gai === true);
    expect(adopt).toHaveLength(6);
    expect([...new Set(adopt.map(r => r.metadata.l2_zh))]).toEqual([GROUP.judge]);
    for (const row of rows) {
      // 一定要显式写布尔值：不写的话一级类是 GAI，会被当成采纳选项
      expect(typeof row.metadata.gai, row.title).toBe('boolean');
      expect(isGenAiScaffold(asScaffold(row)), row.title).toBe(row.metadata.gai);
    }
  });

  it('选择器里显示的组名就是 metadata.l2_zh / l2_en', () => {
    for (const row of rows) {
      expect(scaffoldGroup(asScaffold(row), 'zh')).toBe(row.metadata.l2_zh);
      expect(scaffoldGroup(asScaffold(row), 'en')).toBe(row.metadata.l2_en);
    }
  });

  it('和原有的 147 条不重复：没有同名，也没有近似句式（用字面相似度兜底）', () => {
    expect(existing).toHaveLength(147);
    for (const row of rows) {
      for (const old of existing) {
        expect(normalize(row.title), `${row.title} ≈ ${old.title}`).not.toBe(normalize(old.title));
        expect(similarity(row.title, old.title), `${row.title} ≈ ${old.title}`).toBeLessThan(0.5);
      }
    }
  });

  it('新条目之间没有近似重复', () => {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        expect(similarity(rows[i].title, rows[j].title), `${rows[i].title} ≈ ${rows[j].title}`).toBeLessThan(0.6);
      }
    }
  });

  it('演示用的快照和线上一致：181 条，这 34 条就是现在的样子', () => {
    expect(snapshot).toHaveLength(181);
    const fromSnapshot = snapshot
      .filter(r => r.metadata?.source === 'agency_design_2026')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(r => [r.category, r.title, r.title_en, r.sort_order, r.metadata?.l2_zh, r.metadata?.l2_en, r.metadata?.gai]);
    expect(fromSnapshot).toEqual(rows.map(r => [r.category, r.title, r.title_en, r.sort_order, r.metadata.l2_zh, r.metadata.l2_en, r.metadata.gai]));
  });
});
