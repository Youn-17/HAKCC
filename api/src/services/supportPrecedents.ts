/**
 * 求助语料的检索与作用域。
 *
 * 攒下来的问答有两个用处：本届学生问重复问题时直接命中，下一届开课时
 * 沿用上一届的答案。后者要求跨课程检索 —— 「下一届」本身就是另一门课。
 *
 * 但跨课程不等于跨所有人。同一位老师的历届课程可以互相复用，
 * 换一位老师的课就不行：答案里常写着这门课自己的流程和约定，
 * 串过去既误导学生，也把别人课堂的内容漏了出去。
 */

export interface PrecedentRow {
  id: string;
  question: string;
  ai_answer: string | null;
  teacher_answer: string | null;
}

/**
 * 切成可比对的关键词。英文按词切；中文没有空格，切成相邻两字的二元组。
 *
 * 二元组这一步是必须的：整段中文按「连续汉字」去切，一句话只会得到
 * 一个 token，于是「研究数据怎么导出」和「怎么导出研究数据」互不命中 ——
 * 中文求助的复用等于没有。二元组不需要分词库，对这种短句够用。
 */
export function keywordsOf(question: string): string[] {
  const out = new Set<string>();

  for (const word of question.match(/[A-Za-z]{3,}/g) ?? []) {
    out.add(word.toLowerCase());
  }

  for (const run of question.match(/[一-龥]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2));
  }

  return [...out];
}

/** 命中一半以下的关键词就不算同一个问题；0.34 是三个词里对上一个。 */
export const PRECEDENT_MIN_SCORE = 0.34;

export function rankPrecedents<T extends PrecedentRow>(
  rows: T[],
  question: string,
  opts: { excludeId?: string; limit?: number } = {},
): T[] {
  const tokens = keywordsOf(question);
  if (tokens.length === 0) return [];

  return rows
    .filter(r => r.id !== opts.excludeId)
    .map(r => {
      // 只在「问题 + 教师答案」里找。AI 自己的回答不参与匹配 ——
      // 它啰嗦，几乎什么词都沾得上，会把匹配度整体抬高到失去区分度。
      const hay = `${r.question} ${r.teacher_answer ?? ''}`.toLowerCase();
      const hits = tokens.filter(t => hay.includes(t)).length;
      return { row: r, score: hits / tokens.length };
    })
    .filter(x => x.score >= PRECEDENT_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 3)
    .map(x => x.row);
}
