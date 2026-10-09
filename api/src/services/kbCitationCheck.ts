import { jevConfig, type JevConfig } from '../config/jev';
import { askJev, JevError, type JevAnswer, type JevChoiceAnswer, type JevQuestion } from './jevClient';

/**
 * 课程资料的引用核对（2026-10-09 用户要做的第一项）。
 *
 * 回答按要求在用到资料的句子后面标 [n]，来源卡片列出被标到的那几段。但标了不等于对得上：
 * 模型可能把一句资料里没有的话也标上 [2]，或者标反了。回答写完后交给 Jev 逐条核对：
 *   - 标了 [n] 的每一句：这句话和第 n 段资料的关系是支持、矛盾还是没说到（Jev 官方 citation_check 的做法），
 *     选项正序、倒序各问一遍取平均；
 *   - 整个回答一个 [n] 都没标时：每段检索到的资料，回答到底用没用上。以前这种情况把检索到的全部列出来，
 *     不相干的也在里面。
 * 结果写在卡片上（check / checkP），前端只列真正用到的，核对不上的标出来。Jev 没开、出错、超时，卡片照旧，
 * 不影响回答。只发这一句话（或整段回答）和那段资料，不带姓名。
 */

export type CardCheck = 'supported' | 'contradicted' | 'unsupported' | 'used' | 'unused';

export interface PassageForCheck {
  n: number;
  /** 文件名 · 章节 · 页码 */
  source: string;
  text: string;
}

const MAX_CLAIM = 400;
const MAX_PASSAGE = 1500;
const MAX_ANSWER = 2500;
/** 一个回答最多核对几处引用：太长的回答只看前面这些 */
const MAX_PAIRS = 8;

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** 去掉 Markdown 记号，留下句子本身 */
function plainSentence(text: string): string {
  return text
    .replace(/\[(\d{1,2})\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*(?:[-+]|\d+[.)、])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 回答里带 [n] 的句子。提示词要求把编号放在句末，模型常写成「……。[1]」：
 * 先把紧跟在句号后面的编号挪到句号前面，再按句子切。同一句标了 [1][2] 就是两处引用。
 */
export function citedClaims(answer: string, known: ReadonlySet<number>): Array<{ n: number; claim: string }> {
  const moved = answer.replace(/([。！？!?；;.])(\s*)((?:\[\d{1,2}\])+)/g, '$3$1$2');
  const pieces = moved.split(/(?<=[。！？!?；;])|(?<=\.)\s+|\n+/);
  const pairs: Array<{ n: number; claim: string }> = [];
  const seen = new Set<string>();
  for (const piece of pieces) {
    const numbers = [...piece.matchAll(/\[(\d{1,2})\]/g)].map(m => Number(m[1])).filter(n => known.has(n));
    if (numbers.length === 0) continue;
    const claim = clip(plainSentence(piece), MAX_CLAIM);
    if (claim.length < 4) continue;
    for (const n of numbers) {
      const key = `${n}\n${claim}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ n, claim });
    }
  }
  // 太多时先保证每个编号至少核对一句，再按出现顺序补
  const firstPerNumber = pairs.filter((pair, i) => pairs.findIndex(p => p.n === pair.n) === i);
  const rest = pairs.filter(pair => !firstPerNumber.includes(pair));
  return [...firstPerNumber, ...rest].slice(0, MAX_PAIRS);
}

const RELATIONS = ['supports', 'contradicts', 'says_nothing'] as const;
type Relation = typeof RELATIONS[number];

const RELATION_INSTRUCTIONS =
  "The state holds one sentence from an AI tutor's answer (claim) and the course-document passage that sentence cites (passage). "
  + 'How does the passage relate to the claim? Judge only what the passage itself says.';

const RELATION_CRITERIA: Record<Relation, string> = {
  supports: 'The passage states the claim or directly implies it is true',
  contradicts: 'The passage states the opposite of the claim or implies it is false',
  says_nothing: 'The passage does not address what the claim asserts, either way',
};

export function relationQuestions(): Record<string, JevQuestion> {
  const forward = RELATIONS;
  const reverse = [...RELATIONS].reverse();
  return {
    relation: { type: 'choice', instructions: RELATION_INSTRUCTIONS, criteria: Object.fromEntries(forward.map(r => [r, RELATION_CRITERIA[r]])) },
    relation_reverse: { type: 'choice', instructions: RELATION_INSTRUCTIONS, criteria: Object.fromEntries(reverse.map(r => [r, RELATION_CRITERIA[r]])) },
  };
}

export function relationState(claim: string, passage: PassageForCheck): Record<string, unknown> {
  return { claim: clip(claim, MAX_CLAIM), passage: { source: clip(passage.source, 200), text: clip(passage.text, MAX_PASSAGE) } };
}

const isChoice = (a: JevAnswer | undefined): a is JevChoiceAnswer => a?.type === 'choice';

/** 正序倒序的概率取平均 */
export function interpretRelation(answers: Record<string, JevAnswer | undefined>): Record<Relation, number> | null {
  const got = [answers.relation, answers.relation_reverse].filter(isChoice);
  if (got.length === 0) return null;
  return Object.fromEntries(RELATIONS.map(r => [r, got.reduce((sum, a) => sum + (Number(a.probabilities[r]) || 0), 0) / got.length])) as Record<Relation, number>;
}

const USE_QUESTION: JevQuestion = {
  type: 'noul',
  instructions:
    "The state holds an AI tutor's answer and one passage from a course document. Does the answer use information from this passage: "
    + 'a fact, definition, number, example, step or argument that appears in the passage? General statements that any passage on the topic would support do not count.',
  criteria: {
    true: 'Used: the answer contains information taken from this passage',
    false: 'Not used: the answer does not draw on this passage',
  },
};

export function usageQuestions(): Record<string, JevQuestion> {
  return { uses: USE_QUESTION };
}

export function usageState(answer: string, passage: PassageForCheck): Record<string, unknown> {
  return { answer: clip(answer, MAX_ANSWER), passage: { source: clip(passage.source, 200), text: clip(passage.text, MAX_PASSAGE) } };
}

export interface CitationThresholds {
  /** 支持的概率到这个值算核对上了 */
  supports: number;
  /** 矛盾的概率到这个值算和资料不符 */
  contradicts: number;
  /** 没标引用时，用上了的概率到这个值才列出来 */
  used: number;
}

export const CITATION_THRESHOLDS: CitationThresholds = { supports: 0.5, contradicts: 0.5, used: 0.5 };

/** 一处引用的结论 */
export function relationVerdict(p: Record<Relation, number>, t: CitationThresholds = CITATION_THRESHOLDS): 'supported' | 'contradicted' | 'unsupported' {
  if (p.supports >= t.supports) return 'supported';
  if (p.contradicts >= t.contradicts) return 'contradicted';
  return 'unsupported';
}

/** 一张卡片被引用了几次：有一句核对上就算核对上；都没对上，有矛盾的算矛盾 */
export function cardVerdict(verdicts: Array<'supported' | 'contradicted' | 'unsupported'>): 'supported' | 'contradicted' | 'unsupported' {
  if (verdicts.includes('supported')) return 'supported';
  if (verdicts.includes('contradicted')) return 'contradicted';
  return 'unsupported';
}

export interface CardCheckResult {
  check: CardCheck;
  /** 支持（被引用时）或用上了（没标引用时）的概率 */
  p: number;
}

export interface CitationCheckSummary {
  model?: string;
  ms: number;
  /** 核对了几处引用 / 几段没标引用的资料 */
  pairs: number;
  passages: number;
  errors: number;
  /** 回答里有没有标 [n] */
  cited: boolean;
}

export interface CitationCheckResult {
  cards: Map<number, CardCheckResult>;
  summary: CitationCheckSummary;
}

const ROUND = (n: number) => Math.round(n * 1000) / 1000;
const REQUEST_TIMEOUT_MS = 2500;
const CONCURRENCY = 4;

async function pool<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]);
    }
  }));
  return out;
}

/**
 * 核对一个回答的引用。没开 Jev、没有资料返回 null；单个请求出错只是那张卡片没有结论。
 */
export async function checkCitations(
  answer: string,
  passages: PassageForCheck[],
  opts: { config?: JevConfig; ask?: typeof askJev; thresholds?: CitationThresholds } = {},
): Promise<CitationCheckResult | null> {
  const config = opts.config ?? jevConfig();
  if (!config.citationCheck || !config.apiKey || passages.length === 0 || !answer.trim()) return null;
  const ask = opts.ask ?? askJev;
  const t = opts.thresholds ?? CITATION_THRESHOLDS;
  const started = Date.now();
  const byNumber = new Map(passages.map(p => [p.n, p]));
  const pairs = citedClaims(answer, new Set(byNumber.keys()));
  let errors = 0;
  let model: string | undefined;
  const cards = new Map<number, CardCheckResult>();
  const call = async <T>(state: Record<string, unknown>, questions: Record<string, JevQuestion>, read: (answers: Record<string, JevAnswer | undefined>) => T | null): Promise<T | null> => {
    try {
      const result = await ask(state, questions, { config, timeoutMs: REQUEST_TIMEOUT_MS, retry: false });
      model = result.model;
      const value = read(result.answers as Record<string, JevAnswer | undefined>);
      if (value == null) errors += 1;
      return value;
    } catch (err) {
      errors += 1;
      if (!(err instanceof JevError)) console.warn('[kb-cite] check failed:', err);
      return null;
    }
  };

  if (pairs.length > 0) {
    const results = await pool(pairs, pair => call(relationState(pair.claim, byNumber.get(pair.n)!), relationQuestions(), interpretRelation));
    const perCard = new Map<number, { verdicts: Array<'supported' | 'contradicted' | 'unsupported'>; best: number }>();
    pairs.forEach((pair, i) => {
      const p = results[i];
      if (!p) return;
      const entry = perCard.get(pair.n) ?? { verdicts: [], best: 0 };
      entry.verdicts.push(relationVerdict(p, t));
      entry.best = Math.max(entry.best, p.supports);
      perCard.set(pair.n, entry);
    });
    for (const [n, entry] of perCard) cards.set(n, { check: cardVerdict(entry.verdicts), p: ROUND(entry.best) });
  } else {
    // 一个 [n] 都没标：每段资料看回答用没用上
    const results = await pool(passages, passage => call(usageState(answer, passage), usageQuestions(), a => (a.uses?.type === 'noul' ? a.uses.noul : null)));
    passages.forEach((passage, i) => {
      const p = results[i];
      if (p == null) return;
      cards.set(passage.n, { check: p >= t.used ? 'used' : 'unused', p: ROUND(p) });
    });
  }

  return {
    cards,
    summary: { model, ms: Date.now() - started, pairs: pairs.length, passages: pairs.length > 0 ? 0 : passages.length, errors, cited: pairs.length > 0 },
  };
}
