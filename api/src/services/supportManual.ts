/**
 * 求助回答的依据：学生版使用手册。
 *
 * 以前求助的系统提示词里是一段凭记忆写的「平台常识」：工具栏有哪些按钮、笔记页长什么样。
 * 界面一改它就过时，模型只能在过时的描述上猜。使用手册（components/manual/manualContent.ts）
 * 每次界面改动后都会对照更新，按钮名照界面原样写在「」里，回答应当以它为准。
 *
 * 后端编译只收 api/src 下的文件，读不到前端的手册源码，所以手册以纯文本快照放在
 * supportManualData.ts。快照由 supportManual.test.ts 生成并校对：手册改了、快照没重新生成，
 * 测试就失败。学生问的时候只用学生部分（STUDENT_MANUAL），教师专属的章节单独一份
 * （TEACHER_MANUAL_EXTRA），只有教师问的时候才放进提示词：学生问不出教师端的操作。
 *
 * 提示词里放整本学生手册（见 manualDocument），另用关键词打分（中文相邻两字、英文单词，BM25）
 * 挑出最接近提问的几处作为提示。不用向量：手册一共几十段，关键词够用，也省掉一次网络调用。
 */

import { STUDENT_MANUAL, TEACHER_MANUAL_EXTRA } from './supportManualData';

export type ManualLang = 'zh' | 'en';

type Pair = { zh: string; en: string };

export interface ManualChunk {
  /** 章节号，'04' 这样的两位数 */
  num: string;
  section: Pair;
  /** 小节标题；常见问题里是那一问。章节开头、第一个小标题之前的那段没有 */
  heading: Pair | null;
  text: Pair;
}

// ── 从手册源码生成快照（只在测试里跑） ──────────────────────────────

/** 手册的块结构，只描述这里用得到的字段，和前端 manualContent.ts 的 Block 对得上。 */
type ManualBlockInput =
  | { kind: 'p' | 'h3'; zh: string; en: string }
  | { kind: 'steps' | 'list'; zh: string[]; en: string[] }
  | { kind: 'table'; head: Pair[]; rows: Pair[][] }
  | { kind: 'callout'; label: Pair; zh: string[]; en: string[] }
  | { kind: 'figure' | 'demo' | 'clip'; cap: Pair }
  | { kind: 'faq'; items: Array<{ q: Pair; a: { zh: string[]; en: string[] } }> };

export interface ManualSectionInput {
  num: string;
  title: Pair;
  teacherOnly?: boolean;
  blocks: ReadonlyArray<{ kind: string }>;
}

/** 手册里只有 **加粗** 和 `等宽` 两种行内标记，模型读纯文本就够了。 */
function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
}

function blockText(block: ManualBlockInput, lang: ManualLang): string {
  switch (block.kind) {
    case 'p':
    case 'h3':
      return plain(block[lang]);
    case 'steps':
      return block[lang].map((s, i) => `${i + 1}. ${plain(s)}`).join('\n');
    case 'list':
      return block[lang].map(s => `- ${plain(s)}`).join('\n');
    case 'table':
      return [block.head, ...block.rows]
        .map(row => row.map(cell => plain(cell[lang])).join(' | '))
        .join('\n');
    case 'callout':
      return `${lang === 'zh' ? '【' : '['}${plain(block.label[lang])}${lang === 'zh' ? '】' : '] '}${block[lang].map(plain).join(' ')}`;
    case 'figure':
    case 'demo':
    case 'clip':
      // 配图说明写的正是「界面上长什么样」，对回答「在哪里」有用
      return `${lang === 'zh' ? '（配图）' : '(Figure) '}${plain(block.cap[lang])}`;
    default:
      return '';
  }
}

/**
 * 按小标题切段：一个小标题下的内容是一段，常见问题每一问单独一段。
 * 默认只收学生能看到的章节；teacherOnly 为 true 时只收教师专属的章节。
 */
export function buildManualChunks(sections: ReadonlyArray<ManualSectionInput>, opts: { teacherOnly?: boolean } = {}): ManualChunk[] {
  const chunks: ManualChunk[] = [];

  for (const section of sections) {
    if (Boolean(section.teacherOnly) !== Boolean(opts.teacherOnly)) continue;
    let heading: Pair | null = null;
    let lines: Pair[] = [];

    const flush = () => {
      if (lines.length > 0) {
        chunks.push({
          num: section.num,
          section: { zh: plain(section.title.zh), en: plain(section.title.en) },
          heading,
          text: {
            zh: lines.map(l => l.zh).filter(Boolean).join('\n'),
            en: lines.map(l => l.en).filter(Boolean).join('\n'),
          },
        });
      }
      lines = [];
    };

    for (const raw of section.blocks) {
      const block = raw as ManualBlockInput;
      if (block.kind === 'h3') {
        flush();
        heading = { zh: plain(block.zh), en: plain(block.en) };
        continue;
      }
      if (block.kind === 'faq') {
        flush();
        for (const item of block.items) {
          chunks.push({
            num: section.num,
            section: { zh: plain(section.title.zh), en: plain(section.title.en) },
            heading: { zh: plain(item.q.zh), en: plain(item.q.en) },
            text: { zh: item.a.zh.map(plain).join('\n'), en: item.a.en.map(plain).join('\n') },
          });
        }
        continue;
      }
      lines.push({ zh: blockText(block, 'zh'), en: blockText(block, 'en') });
    }
    flush();
  }
  return chunks;
}

/** 快照文件的全文。测试拿它和 supportManualData.ts 逐字比对。 */
export function renderManualDataModule(chunks: ManualChunk[], teacherChunks: ManualChunk[] = []): string {
  return [
    '// 自动生成：使用手册的纯文本快照，求助回答以它为依据。不要手改。',
    '// 来源是 components/manual/manualContent.ts。手册改了以后重新生成：',
    '//   npx vitest run api/src/services/supportManual.test.ts -u',
    "import type { ManualChunk } from './supportManual';",
    '',
    `export const STUDENT_MANUAL: ManualChunk[] = ${JSON.stringify(chunks, null, 2)};`,
    '',
    '// 教师专属的章节，只有教师在「使用帮助」里提问时才用',
    `export const TEACHER_MANUAL_EXTRA: ManualChunk[] = ${JSON.stringify(teacherChunks, null, 2)};`,
    '',
  ].join('\n');
}

// ── 检索 ──────────────────────────────────────────────────────────

const EN_STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'so', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'from', 'with',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'there', 'here', 'then', 'than',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'their',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'how', 'what', 'why', 'when', 'where', 'which', 'who',
  'not', 'no', 'up', 'out', 'about', 'into', 'just', 'only', 'also', 'some', 'any', 'all', 'more', 'get', 'got',
]);

/** 提问里的虚词。「怎么」「什么」满手册都是，却说明不了问的是哪件事。 */
const ZH_STOP = new Set([
  '什么', '怎么', '么办', '么样', '为什', '如何', '怎样', '请问', '一下', '哪里', '哪个',
  '我们', '你们', '他们', '这个', '那个', '一个', '是不', '不是', '的话', '为啥',
]);

/** 粗略去词尾，让 contribute / contributed / contributing 落到同一个词上。 */
function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/**
 * 切词。中文没有空格，切成相邻两字：整句当一个词的话，「笔记怎么保存」和「怎么保存笔记」
 * 互不命中。和 supportPrecedents.keywordsOf 同一个思路，这里保留重复，BM25 要数词频。
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []) {
    if (!EN_STOP.has(word)) out.push(stem(word));
  }
  for (const run of text.match(/[一-鿿]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (!ZH_STOP.has(bigram)) out.push(bigram);
    }
  }
  return out;
}

interface IndexedChunk { chunk: ManualChunk; tf: Map<string, number>; len: number }
interface ManualIndex { chunks: IndexedChunk[]; df: Map<string, number>; avgLen: number }

const indexCache = new WeakMap<ReadonlyArray<ManualChunk>, Partial<Record<ManualLang, ManualIndex>>>();

function indexFor(source: ReadonlyArray<ManualChunk>, lang: ManualLang): ManualIndex {
  const cached = indexCache.get(source)?.[lang];
  if (cached) return cached;

  const df = new Map<string, number>();
  const chunks = source.map(chunk => {
    const heading = chunk.heading?.[lang] ?? '';
    // 小标题算两遍：「支架插错了怎么办」这种标题本身就是最准的索引
    const tokens = tokenize(`${heading}\n${heading}\n${chunk.section[lang]}\n${chunk.text[lang]}`);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { chunk, tf, len: tokens.length };
  });
  const avgLen = chunks.reduce((sum, c) => sum + c.len, 0) / Math.max(1, chunks.length);
  const index = { chunks, df, avgLen };
  indexCache.set(source, { ...indexCache.get(source), [lang]: index });
  return index;
}

const K1 = 1.2;
const B = 0.75;
/** 只沾上「笔记」「可以」这类满手册都是的词，分数到不了这里。 */
export const MIN_EXCERPT_SCORE = 1.5;
/** 和第一名差太远的不要，塞进去只会把模型带偏。 */
const RELATIVE_FLOOR = 0.3;
export const EXCERPT_BUDGET: Record<ManualLang, number> = { zh: 3200, en: 7000 };
const MAX_EXCERPTS = 5;

export interface ManualExcerpt {
  num: string;
  section: string;
  heading: string | null;
  text: string;
  score: number;
}

export function selectManualExcerpts(
  question: string,
  lang: ManualLang,
  opts: { budget?: number; limit?: number } = {},
  source: ReadonlyArray<ManualChunk> = STUDENT_MANUAL,
): ManualExcerpt[] {
  const terms = [...new Set(tokenize(question))];
  if (terms.length === 0 || source.length === 0) return [];

  const index = indexFor(source, lang);
  const n = index.chunks.length;
  const ranked = index.chunks
    .map(ic => {
      let score = 0;
      for (const t of terms) {
        const tf = ic.tf.get(t);
        if (!tf) continue;
        const df = index.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * ic.len / index.avgLen));
      }
      return { ic, score };
    })
    .filter(x => x.score >= MIN_EXCERPT_SCORE)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return [];

  const budget = opts.budget ?? EXCERPT_BUDGET[lang];
  const limit = opts.limit ?? MAX_EXCERPTS;
  const top = ranked[0].score;
  const out: ManualExcerpt[] = [];
  let used = 0;

  for (const { ic, score } of ranked) {
    if (out.length >= limit || score < top * RELATIVE_FLOOR) break;
    let text = ic.chunk.text[lang];
    if (out.length > 0 && used + text.length > budget) continue;
    // 第一名再长也要给：它最可能就是答案
    if (text.length > budget) text = `${text.slice(0, budget)}…`;
    out.push({
      num: ic.chunk.num,
      section: ic.chunk.section[lang],
      heading: ic.chunk.heading?.[lang] ?? null,
      text,
      score: Math.round(score * 100) / 100,
    });
    used += text.length;
  }
  return out;
}

export const STUDENT_SECTION_NUMS: ReadonlySet<string> = new Set(STUDENT_MANUAL.map(c => c.num));

/** 教师提问时用的整本：学生部分加教师专属的章节 */
export const TEACHER_MANUAL: ReadonlyArray<ManualChunk> = [...STUDENT_MANUAL, ...TEACHER_MANUAL_EXTRA];
export const TEACHER_SECTION_NUMS: ReadonlySet<string> = new Set(TEACHER_MANUAL.map(c => c.num));

export function sectionTitle(num: string, lang: ManualLang, source: ReadonlyArray<ManualChunk> = STUDENT_MANUAL): string | null {
  return source.find(c => c.num === num)?.section[lang] ?? null;
}

const documentCache = new WeakMap<ReadonlyArray<ManualChunk>, Partial<Record<ManualLang, string>>>();

/**
 * 整本学生手册的正文，按章节和小标题排好。
 *
 * 整本给，不只给检索出来的几段：学生描述的是现象（「点了贡献笔记没出现」），
 * 手册写的是做法（「写的笔记不见了：看视图、点重置视图、确认贡献过」），两者常常一个字都不重合，
 * 只靠关键词挑段落会漏掉正确答案。学生版中文约一万五千字，一万个 token 上下，
 * 快速档模型的上下文放得下；而且每次提问都是同一段前缀，厂商的前缀缓存能命中，不怎么拖慢。
 */
export function manualDocument(lang: ManualLang, source: ReadonlyArray<ManualChunk> = STUDENT_MANUAL): string {
  const cached = documentCache.get(source)?.[lang];
  if (cached) return cached;
  const lines: string[] = [];
  let current = '';
  for (const chunk of source) {
    if (chunk.num !== current) {
      if (lines.length > 0) lines.push('');
      lines.push(`## ${chunk.num} ${chunk.section[lang]}`);
      current = chunk.num;
    }
    if (chunk.heading) lines.push(`### ${chunk.heading[lang]}`);
    lines.push(chunk.text[lang]);
  }
  const doc = lines.join('\n');
  documentCache.set(source, { ...documentCache.get(source), [lang]: doc });
  return doc;
}

/** 关键词最接近提问的几处，作为提示放在手册后面，帮快速档模型先看对地方。 */
export function manualHints(question: string, lang: ManualLang, limit = 3, source: ReadonlyArray<ManualChunk> = STUDENT_MANUAL): ManualExcerpt[] {
  return selectManualExcerpts(question, lang, { limit }, source);
}

export function describeExcerpt(e: Pick<ManualExcerpt, 'num' | 'section' | 'heading'>): string {
  return e.heading ? `${e.num} ${e.section} › ${e.heading}` : `${e.num} ${e.section}`;
}

// ── 模型输出的来源行 ──────────────────────────────────────────────

export interface AnswerSources {
  /** 去掉来源行之后给学生看的回答 */
  answer: string;
  /** 模型说它用到的手册章节号，只留学生版手册里真有的 */
  sections: string[];
  /** 用到了第几条往届教师答案（Q1 → 1） */
  precedents: number[];
  /** true：材料里有答案；false：模型说材料没覆盖；null：模型没写来源行 */
  covered: boolean | null;
}

// 英文关键词是我们要求的写法，这一行不管出现在哪都删掉（有的模型写完来源行还要补一句客套话）；
// 中文的「来源」只在最后一行、后面全是编号时才删，免得把回答里正常的一句「来源：……」吃掉。
const EN_SOURCES_LINE = /^[ \t>*_`#-]*SOURCES?\b[*_` \t]*[:：](.*)$/gim;
const ZH_SOURCES_LINE = /(?:^|\n)[ \t>*_`#-]*来源[*_` \t]*[:：]([\s\dQq,，、;；/]*|\s*(?:NONE|无|没有)\s*)$/i;

export function splitAnswerSources(raw: string, known: ReadonlySet<string> = STUDENT_SECTION_NUMS): AnswerSources {
  const text = raw.replace(/\s+$/, '');
  let answer: string;
  let spec: string;
  const enLines = [...text.matchAll(EN_SOURCES_LINE)];
  if (enLines.length > 0) {
    spec = enLines[enLines.length - 1][1];
    answer = text.replace(EN_SOURCES_LINE, '').replace(/\n{3,}/g, '\n\n').trim();
  } else {
    const zh = ZH_SOURCES_LINE.exec(text);
    if (!zh) return { answer: text.trim(), sections: [], precedents: [], covered: null };
    spec = zh[1];
    answer = text.slice(0, zh.index).trim();
  }
  spec = spec.replace(/[*_`]/g, ' ');
  const sections = [...new Set((spec.match(/\b\d{1,2}\b/g) ?? [])
    .map(n => n.padStart(2, '0'))
    .filter(n => known.has(n)))];
  const precedents = [...new Set((spec.match(/\bQ(\d)\b/gi) ?? []).map(q => Number(q.slice(1))))];
  const saysNone = /\bnone\b|无|没有/i.test(spec);

  let covered: boolean | null = null;
  if (sections.length > 0 || precedents.length > 0) covered = true;
  else if (saysNone) covered = false;
  return { answer, sections, precedents, covered };
}
