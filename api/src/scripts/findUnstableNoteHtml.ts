/**
 * 只读：列出正文「解析不稳定」的笔记，以及重新切分后研究统计会变的项。
 *
 * 编辑器以前用 DOM 操作把块（AI 插入块、支架段、图片）塞进 <p>，这种嵌套 HTML 解析器造不出来，
 * innerHTML 却原样写进了库（2026-09-28 查到 205 条里有 4 条）。阅读视图、编辑器、后端消毒每次解析
 * 都先关掉外层 <p>，而 content_segments / segment_stats 是在库里原样的字符串上切的（noteSegments 数标签）：
 * 研究数据和学生看到的结构对不上，可能把学生的字算进 AI 块、把支架记成外层那一条的 id。
 *
 * 脚本只 select，不写库。要不要按解析后的结构重算这些笔记的分段，由研究者看了清单再定。
 *
 * 在 api/ 下运行，环境变量同后端（SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY，可以放在 api/.env）：
 *   npx ts-node src/scripts/findUnstableNoteHtml.ts [--json 输出文件]
 * 构建后也可以 node dist/scripts/findUnstableNoteHtml.js。
 */
import { writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { segmentNoteContent, type NoteSegmentStats } from '../services/noteSegments';

let parserDocument: Document | null = null;

/** 解析再序列化：浏览器、编辑器、后端消毒看到的就是这个结构 */
export function reparseNoteHtml(html: string): string {
  parserDocument ??= new JSDOM('').window.document;
  const box = parserDocument.createElement('div');
  box.innerHTML = html;
  return box.innerHTML;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** 字符串里的标签序列，研究切分就是照着它分块的。实体、引号写法上的差别不算变化 */
function tagSequence(html: string): string {
  const tags: string[] = [];
  for (const [, closing, name] of html.matchAll(TAG)) {
    const tag = name.toLowerCase();
    if (!(closing && VOID_TAGS.has(tag))) tags.push(closing + tag);
  }
  return tags.join(' ');
}

export interface NoteHtmlStability {
  stable: boolean;
  /** 按库里原样的字符串切出来的统计 → 按解析后的结构切出来的统计，只列不一样的项 */
  statChanges: { field: keyof NoteSegmentStats; stored: unknown; rendered: unknown }[];
}

export function checkNoteHtmlStability(html: string): NoteHtmlStability {
  const rendered = reparseNoteHtml(html);
  if (tagSequence(rendered) === tagSequence(html)) return { stable: true, statChanges: [] };
  const stored = segmentNoteContent(html).stats;
  const after = segmentNoteContent(rendered).stats;
  const statChanges = (Object.keys(stored) as (keyof NoteSegmentStats)[])
    .filter(field => field !== 'computedAt' && JSON.stringify(stored[field]) !== JSON.stringify(after[field]))
    .map(field => ({ field, stored: stored[field], rendered: after[field] }));
  return { stable: false, statChanges };
}

const PAGE = 500;

async function main() {
  const { supabase } = await import('../config/supabase');
  const jsonAt = process.argv.indexOf('--json');
  const jsonOut = jsonAt > 0 ? process.argv[jsonAt + 1] : undefined;

  const found: ({ id: string; spaceId: string; type: string; updatedAt: string; deletedAt: string | null } & NoteHtmlStability)[] = [];
  let scanned = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('notes')
      .select('id, space_id, type, updated_at, deleted_at, content')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const note of data ?? []) {
      scanned += 1;
      const check = checkNoteHtmlStability(String(note.content ?? ''));
      if (!check.stable) {
        found.push({
          id: note.id, spaceId: note.space_id, type: note.type,
          updatedAt: note.updated_at, deletedAt: note.deleted_at, ...check,
        });
      }
    }
    if (!data || data.length < PAGE) break;
  }

  const affected = found.filter(note => note.statChanges.length > 0).length;
  console.log(`扫描 ${scanned} 条笔记：解析不稳定 ${found.length} 条，其中研究统计会变的 ${affected} 条`);
  for (const note of found) {
    console.log(`\n${note.id}  ${note.type}  更新于 ${note.updatedAt}${note.deletedAt ? '  （已删除）' : ''}`);
    if (!note.statChanges.length) console.log('  结构有变，研究统计不变');
    for (const change of note.statChanges) {
      console.log(`  ${change.field}: ${JSON.stringify(change.stored)} → ${JSON.stringify(change.rendered)}`);
    }
  }
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(found, null, 2));
    console.log(`\n明细写到了 ${jsonOut}`);
  }
}

// 只在直接运行时查库；测试 import 这个文件只用上面的检查函数
if (/findUnstableNoteHtml\.[jt]s$/.test(process.argv[1] ?? '')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
