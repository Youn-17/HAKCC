/** Course-material keyword tokenization uses word segmentation and Chinese bigrams for database retrieval. */

// 后端 tsconfig 的 lib 是 ES2020，没有 Intl.Segmenter 的类型；Node 16 起就有这个 API，这里只补个局部类型
type WordSegmenter = { segment(text: string): Iterable<{ segment: string; isWordLike?: boolean }> };
const SEG: WordSegmenter = new (Intl as unknown as {
  Segmenter: new (locale: string, options: { granularity: 'word' }) => WordSegmenter;
}).Segmenter('zh', { granularity: 'word' });
const CJK = /[一-鿿]/;
const CJK_RUN = /[一-鿿]{2,}/g;

const EN_STOP = new Set((
  'a an the of and or to in on for with as by at from is are was were be been this that these those it its into than then '
  + 'which who what how why can could should would will may might not no we our they their he she his her you your i'
).split(' '));

/**
 * 提问里常见、片段里也到处都是的词。只从提问里去掉：留着的话「什么」「我们」这种词凑够两个就算命中，
 * 把不相干的片段带进来。片段那边不去，BM25 的 idf 本来就会把它们压低。
 */
const QUERY_STOP = new Set([
  '什么', '怎么', '怎样', '如何', '为什么', '哪些', '哪个', '是否', '是不是', '有没有', '可以', '能否', '能不能',
  '我们', '你们', '他们', '这个', '那个', '一个', '一些', '就是', '还是', '应该', '需要', '请问', '一下', '为什',
  '#什么', '#怎么', '#怎样', '#如何', '#为什', '#哪些', '#哪个', '#是否', '#是不', '#不是', '#有没', '#没有',
  '#可以', '#能否', '#能不', '#我们', '#你们', '#他们', '#这个', '#那个', '#一个', '#一些', '#就是', '#还是',
  '#应该', '#需要', '#请问', '#一下', '#的是', '#是什', '#么是', '#么样', '#样的',
]);

/** 片段或提问的词序列（保留重复，词频要用） */
export function kbTokens(text: string): string[] {
  const out: string[] = [];
  const lower = (text || '').toLowerCase();
  for (const s of SEG.segment(lower)) {
    if (!s.isWordLike) continue;
    const w = s.segment.trim();
    if (!w || EN_STOP.has(w)) continue;
    if (CJK.test(w) && w.length === 1) continue;
    out.push(w);
  }
  for (const run of lower.match(CJK_RUN) || []) {
    for (let i = 0; i < run.length - 1; i++) out.push(`#${run.slice(i, i + 2)}`);
  }
  return out;
}

/** 存进 kb_chunks 的那两列：词序列和词数。标题路径和正文一起算，和送去向量化的文字一致 */
export function kbSearchFields(headingPath: string | null, content: string): { search_text: string; search_len: number } {
  const tokens = kbTokens(headingPath ? `${headingPath}\n${content}` : content);
  return { search_text: tokens.join(' '), search_len: tokens.length };
}

/** 提问的检索词：去重，去掉提问里的套话，最多 40 个 */
export function kbQueryTerms(query: string): string[] {
  return [...new Set(kbTokens(query))].filter(t => !QUERY_STOP.has(t)).slice(0, 40);
}
