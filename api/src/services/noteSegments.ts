/**
 * 把一条笔记的正文切成来源分明的段落。
 *
 * 研究要回答的是「这条笔记里，哪些字是学生在支架里写的、哪些是自己自由写的、
 * 哪些是从 AI 那儿搬过来的」。光看整条笔记的字数或 is_ai_generated 标记回答不了 ——
 * 一条笔记里三种来源经常混在一起。
 *
 * 正文 HTML 是我们自己的编辑器生成的，结构固定，所以这里不引第三方解析器，
 * 只做块级切分 + 属性识别：
 *   <p data-scaffold-id>…</p>                     → 支架段（括号里的才算学生写的）
 *   <div data-ai-source="genai">…</div>            → 学生插入的 AI 内容
 *   <div data-ai-source="ai-partner-publication">  → 由 AI 摘录发布成的笔记
 *   <div data-imported-from="x.md">…</div>          → 从文件导入的材料
 *   其他块                                          → 学生自由书写
 */

export type SegmentKind = 'scaffold' | 'plain' | 'ai_inserted' | 'ai_published' | 'imported' | 'media';

export interface NoteSegment {
  order: number;
  kind: SegmentKind;
  /** 去掉标签后的字数，中英文都按字符数算 */
  chars: number;
  /** 纯文本，截断保存，够做人工核对但不重复存一份正文 */
  text: string;
  scaffoldId?: string;
  scaffoldTitle?: string;
  scaffoldL1?: string;
  /** 支架段：学生真正写在方括号里的字数（不含话头本身） */
  authoredChars?: number;
  /** 导入段：来自哪个文件 */
  importedFrom?: string;
  providerId?: string;
  model?: string;
  sourceMessageId?: string;
}

export interface NoteSegmentStats {
  totalChars: number;
  /** 学生自己写的字：自由书写 + 支架方括号内 */
  studentChars: number;
  /** 其中写在支架里的 */
  scaffoldChars: number;
  /** 其中自由书写的 */
  plainChars: number;
  /** 从 AI 搬进来的 */
  aiChars: number;
  /** 从文件导入的材料。既不算学生写的，也不算 AI 生成的 */
  importedChars: number;
  /** aiChars / totalChars，保留三位小数 */
  aiRatio: number;
  importedRatio: number;
  scaffoldRatio: number;
  segmentCount: number;
  scaffoldUseCount: number;
  scaffoldIds: string[];
  scaffoldL1s: string[];
  aiBlockCount: number;
  hasScaffold: boolean;
  hasAi: boolean;
  hasImported: boolean;
  importedSources: string[];
  computedAt: string;
}

const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'source', 'area', 'col', 'embed', 'wbr']);

/** 把 HTML 按顶层元素切开。不做通用解析，只数标签深度。 */
function splitTopLevel(html: string): string[] {
  const blocks: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html))) {
    const [full, closing, name, selfClose] = match;
    const isVoid = VOID_TAGS.has(name.toLowerCase()) || selfClose === '/';

    if (!closing && !isVoid) {
      if (depth === 0) {
        const between = html.slice(start, match.index);
        if (between.trim()) blocks.push(between);
        start = match.index;
      }
      depth += 1;
    } else if (closing) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        blocks.push(html.slice(start, match.index + full.length));
        start = match.index + full.length;
      }
    } else if (isVoid && depth === 0) {
      const between = html.slice(start, match.index);
      if (between.trim()) blocks.push(between);
      blocks.push(full);
      start = match.index + full.length;
    }
  }
  const tail = html.slice(start);
  if (tail.trim()) blocks.push(tail);
  return blocks.filter(b => b.trim());
}

function attr(html: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]*)"`).exec(html);
  return m && m[1] ? m[1] : undefined;
}

/** 去标签取纯文本。零宽占位符不算字。 */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/​/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 取某个属性所在元素的内层文本，例如 data-scaffold-input 里学生写的那段。 */
function innerTextOf(html: string, marker: string): string {
  const open = new RegExp(`<([a-zA-Z][\\w-]*)[^>]*\\b${marker}\\b[^>]*>`).exec(html);
  if (!open) return '';
  const tag = open[1];
  const from = open.index + open[0].length;
  const rest = html.slice(from);
  const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(rest))) {
    if (m[1]) {
      if (depth === 0) return plainText(rest.slice(0, m.index));
      depth -= 1;
    } else depth += 1;
  }
  return plainText(rest);
}

export function segmentNoteContent(html: string): { segments: NoteSegment[]; stats: NoteSegmentStats } {
  const segments: NoteSegment[] = [];
  const source = String(html ?? '');

  for (const block of splitTopLevel(source)) {
    const text = plainText(block);
    const isMedia = /<img\b/i.test(block) || /data-attachment/i.test(block);
    if (!text && !isMedia) continue;

    const aiSource = attr(block, 'data-ai-source');
    const scaffoldId = attr(block, 'data-scaffold-id');
    const importedFrom = attr(block, 'data-imported-from');

    // 从 .md 之类的文件导入进来的材料。不是学生写的，也不是 AI 生成的，
    // 落进 plain 会被算成学生产出——一份三千字的材料能把整条笔记的
    // studentChars 撑成假数据。
    if (importedFrom) {
      segments.push({
        order: segments.length, kind: 'imported', chars: text.length, text: text.slice(0, 400),
        importedFrom,
      });
      continue;
    }

    if (aiSource === 'ai-partner-publication') {
      segments.push({
        order: segments.length, kind: 'ai_published', chars: text.length, text: text.slice(0, 400),
        scaffoldId: attr(block, 'data-scaffold-id'),
        scaffoldTitle: attr(block, 'data-scaffold-title'),
      });
      continue;
    }
    if (aiSource === 'genai') {
      segments.push({
        order: segments.length, kind: 'ai_inserted', chars: text.length, text: text.slice(0, 400),
        scaffoldId: attr(block, 'data-scaffold-adopted') || attr(block, 'data-scaffold-id'),
        scaffoldTitle: attr(block, 'data-scaffold-title'),
        providerId: attr(block, 'data-provider-id'),
        model: attr(block, 'data-model'),
        sourceMessageId: attr(block, 'data-source-message-id'),
      });
      continue;
    }
    if (scaffoldId) {
      // 括号里的才是学生写的，话头是课堂给的，不该算进学生产出
      const authored = innerTextOf(block, 'data-scaffold-input');
      segments.push({
        order: segments.length, kind: 'scaffold', chars: text.length, text: text.slice(0, 400),
        scaffoldId,
        scaffoldTitle: attr(block, 'data-scaffold-title'),
        scaffoldL1: attr(block, 'data-scaffold-l1'),
        authoredChars: authored.length,
      });
      continue;
    }
    if (isMedia && !text) {
      segments.push({ order: segments.length, kind: 'media', chars: 0, text: '' });
      continue;
    }
    segments.push({ order: segments.length, kind: 'plain', chars: text.length, text: text.slice(0, 400) });
  }

  const sum = (kind: SegmentKind, field: 'chars' | 'authoredChars' = 'chars') =>
    segments.filter(s => s.kind === kind).reduce((n, s) => n + (s[field] ?? 0), 0);

  const scaffoldChars = sum('scaffold', 'authoredChars');
  const plainChars = sum('plain');
  const aiChars = sum('ai_inserted') + sum('ai_published');
  const importedChars = sum('imported');
  const totalChars = segments.reduce((n, s) => n + s.chars, 0);
  // 导入的材料既不算学生写的，也不算 AI 生成的，单列一档
  const studentChars = scaffoldChars + plainChars;
  const scaffoldIds = [...new Set(segments.map(s => s.scaffoldId).filter(Boolean) as string[])];
  const round = (v: number) => Math.round(v * 1000) / 1000;

  return {
    segments,
    stats: {
      totalChars,
      studentChars,
      scaffoldChars,
      plainChars,
      aiChars,
      importedChars,
      aiRatio: totalChars ? round(aiChars / totalChars) : 0,
      importedRatio: totalChars ? round(importedChars / totalChars) : 0,
      scaffoldRatio: studentChars ? round(scaffoldChars / studentChars) : 0,
      segmentCount: segments.length,
      scaffoldUseCount: segments.filter(s => s.kind === 'scaffold').length,
      scaffoldIds,
      scaffoldL1s: [...new Set(segments.map(s => s.scaffoldL1).filter(Boolean) as string[])],
      aiBlockCount: segments.filter(s => s.kind === 'ai_inserted' || s.kind === 'ai_published').length,
      hasScaffold: segments.some(s => s.kind === 'scaffold'),
      hasAi: segments.some(s => s.kind === 'ai_inserted' || s.kind === 'ai_published'),
      hasImported: segments.some(s => s.kind === 'imported'),
      importedSources: [...new Set(segments.map(s => s.importedFrom).filter(Boolean) as string[])],
      computedAt: new Date().toISOString(),
    },
  };
}
