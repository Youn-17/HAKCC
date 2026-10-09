import { createHash } from 'node:crypto';
import { jevConfig, type JevConfig } from '../config/jev';
import { askJev, JevError, type JevAnswer, type JevChoiceAnswer, type JevQuestion } from './jevClient';

/**
 * 写笔记时推荐一条支架（2026-10-09 用户要做的第二项）。
 *
 * 支架库有 181 条、二十个组，学生要先选组再找那一句。这里按学生正在写的草稿（Build-on 时带上原笔记），
 * 从这门课能用的支架里挑一条最能点明「这一段在做什么」的话头。照 Jev 官方「从 182 个技能里挑一个」的做法分两步：
 *   1. 全部支架放进一道单选题排序（正序、倒序各问一遍取平均，官方提醒偏向排在前面的选项），
 *      同一次请求再问草稿有没有实在内容（问候、通知、几个字不推荐）；
 *   2. 排名前三的再逐个问「用这条开头合不合适」，每条单独打分，都不到门槛就不推荐。
 * 选哪条由单选决定，推不推荐由逐条打分决定。只发标题、草稿和原笔记的开头，不带姓名。
 * Jev 没开、出错、超时都不推荐，支架栏照旧。
 */

export interface ScaffoldOption {
  id: string;
  /** 话头本身（中文界面显示的那句） */
  title: string;
  titleEn: string | null;
  /** 支架组，如「表达与改进观点」「GAI 回答的判断与取舍」 */
  group: string;
}

export interface DraftForRecommend {
  title: string;
  text: string;
  /** Build-on 时接着的那条笔记 */
  parent?: { title: string; text: string } | null;
}

const MAX_DRAFT = 1500;
const MAX_PARENT = 400;
const SHORTLIST = 3;

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export function optionText(option: ScaffoldOption): string {
  const en = option.titleEn && option.titleEn !== option.title ? `（${option.titleEn}）` : '';
  return `「${option.title}」${en} — ${option.group}`;
}

export function recommendState(draft: DraftForRecommend): Record<string, unknown> {
  return {
    draft: { title: clip(draft.title, 200), text: clip(draft.text, MAX_DRAFT) },
    ...(draft.parent ? { building_on: { title: clip(draft.parent.title, 200), text: clip(draft.parent.text, MAX_PARENT) } } : {}),
  };
}

const RANK_INSTRUCTIONS =
  "The state is a student's draft note on a knowledge-building discussion board, and the classmate's note it responds to (building_on), if any. "
  + 'Scaffolds are sentence starters that name the kind of thinking move a sentence makes: proposing a theory, asking what one needs to understand, '
  + 'adding information, questioning, improving or synthesising ideas, working with generative AI output, solving a computing problem, organising the team. '
  + 'Which scaffold best names the main move this draft makes, or the move the student is in the middle of making?';

const SUBSTANTIVE: JevQuestion = {
  type: 'noul',
  instructions:
    'Is the draft knowledge content: an idea, explanation, question, evidence, reflection, plan, or a response to someone\'s idea? '
    + 'Say no for greetings, logistics such as time and place, thanks, or a few words with no content.',
  criteria: {
    true: 'Knowledge content: there is an idea, question, evidence, plan or response to frame',
    false: 'No knowledge content: greeting, logistics, thanks or too little to frame',
  },
};

const optionKey = (index: number) => `s${index + 1}`;

/** 第一步：全部支架排序（正序、倒序），再问有没有实在内容 */
export function rankQuestions(options: ScaffoldOption[]): Record<string, JevQuestion> {
  const forward = options.map((option, i) => [optionKey(i), optionText(option)] as const);
  return {
    pick: { type: 'choice', instructions: RANK_INSTRUCTIONS, criteria: Object.fromEntries(forward) },
    pick_reverse: { type: 'choice', instructions: RANK_INSTRUCTIONS, criteria: Object.fromEntries([...forward].reverse()) },
    substantive: SUBSTANTIVE,
  };
}

const isChoice = (answer: JevAnswer | undefined): answer is JevChoiceAnswer => answer?.type === 'choice';

/** 正序倒序取平均，按概率排出前几名 */
export function shortlist(answers: Record<string, JevAnswer | undefined>, count = SHORTLIST): Array<{ key: string; p: number }> {
  const got = [answers.pick, answers.pick_reverse].filter(isChoice);
  if (got.length === 0) return [];
  const keys = new Set(got.flatMap(answer => Object.keys(answer.probabilities)));
  return [...keys]
    .map(key => ({ key, p: got.reduce((sum, answer) => sum + (Number(answer.probabilities[key]) || 0), 0) / got.length }))
    .sort((a, b) => b.p - a.p)
    .slice(0, count);
}

const FIT_INSTRUCTIONS = (option: ScaffoldOption) =>
  `Would starting a sentence of this draft with the scaffold ${optionText(option)} fit what the draft says, `
  + 'naming the thinking move the student makes or is about to make? Say no if the scaffold describes a different move or a situation the draft is not in.';

/** 第二步：前三名逐条问合不合适，再在这三条里单选一次 */
export function fitQuestions(candidates: ScaffoldOption[]): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  candidates.forEach((option, i) => {
    questions[`fit_${i}`] = {
      type: 'noul',
      instructions: FIT_INSTRUCTIONS(option),
      criteria: { true: 'Fits: it names what this draft is doing', false: 'Does not fit: it names a different move' },
    };
  });
  const forward = candidates.map((option, i) => [`c${i}`, optionText(option)] as const);
  questions.best = { type: 'choice', instructions: RANK_INSTRUCTIONS, criteria: Object.fromEntries(forward) };
  questions.best_reverse = { type: 'choice', instructions: RANK_INSTRUCTIONS, criteria: Object.fromEntries([...forward].reverse()) };
  return questions;
}

export interface RecommendThresholds {
  /** 草稿有实在内容的概率到这个值才推荐 */
  substantive: number;
  /** 这条支架合适的概率到这个值才推荐 */
  fit: number;
}

export const RECOMMEND_THRESHOLDS: RecommendThresholds = { substantive: 0.5, fit: 0.5 };

export interface CandidateScore { id: string; rank: number; fit: number | null; best: number | null }

/** 合适的里面挑单选概率最高的；都不合适就不推荐 */
export function chooseRecommendation(
  candidates: ScaffoldOption[],
  answers: Record<string, JevAnswer | undefined>,
  rankP: number[],
  t: RecommendThresholds = RECOMMEND_THRESHOLDS,
): { pick: ScaffoldOption | null; scores: CandidateScore[] } {
  const bestAnswers = [answers.best, answers.best_reverse].filter(isChoice);
  const scores = candidates.map((option, i): CandidateScore => {
    const fit = answers[`fit_${i}`];
    return {
      id: option.id,
      rank: rankP[i] ?? 0,
      fit: fit?.type === 'noul' ? fit.noul : null,
      best: bestAnswers.length ? bestAnswers.reduce((sum, a) => sum + (Number(a.probabilities[`c${i}`]) || 0), 0) / bestAnswers.length : null,
    };
  });
  const eligible = scores
    .map((score, i) => ({ score, option: candidates[i] }))
    .filter(({ score }) => (score.fit ?? 0) >= t.fit)
    .sort((a, b) => (b.score.best ?? b.score.rank) - (a.score.best ?? a.score.rank));
  return { pick: eligible[0]?.option ?? null, scores };
}

export interface ScaffoldRecommendation {
  scaffold: ScaffoldOption | null;
  /** 推荐的那条合适的概率 */
  fit: number | null;
  substantive: number | null;
  candidates: CandidateScore[];
  model?: string;
  latencyMs: number;
  cached?: boolean;
  /** JevError 的类型 */
  error?: string;
}

// ── 同一份草稿 10 分钟内只问一次（学生停笔几秒就会来问） ─────────────

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; value: ScaffoldRecommendation }>();

export function clearScaffoldRecommendCacheForTests(): void {
  cache.clear();
}

const REQUEST_TIMEOUT_MS = 2500;

/**
 * 推荐一条支架。没开 Jev 返回 null；出错返回不推荐（带 error）。
 */
export async function recommendScaffold(
  draft: DraftForRecommend,
  options: ScaffoldOption[],
  opts: { config?: JevConfig; ask?: typeof askJev; thresholds?: RecommendThresholds; now?: () => number } = {},
): Promise<ScaffoldRecommendation | null> {
  const config = opts.config ?? jevConfig();
  if (!config.scaffoldRecommend || !config.apiKey || options.length === 0 || !draft.text.trim()) return null;
  const ask = opts.ask ?? askJev;
  const t = opts.thresholds ?? RECOMMEND_THRESHOLDS;
  const now = opts.now ?? Date.now;
  const state = recommendState(draft);
  const key = createHash('sha1')
    .update(`${config.model}\n${options.map(o => o.id).join(',')}\n${JSON.stringify(state)}`)
    .digest('hex');
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

  const started = Date.now();
  const none = (extra: Partial<ScaffoldRecommendation>): ScaffoldRecommendation => ({
    scaffold: null, fit: null, substantive: null, candidates: [], latencyMs: Date.now() - started, ...extra,
  });
  try {
    const first = await ask(state, rankQuestions(options), { config, timeoutMs: REQUEST_TIMEOUT_MS, retry: false });
    const answers1 = first.answers as Record<string, JevAnswer | undefined>;
    const substantive = answers1.substantive?.type === 'noul' ? answers1.substantive.noul : null;
    const top = shortlist(answers1);
    const byKey = new Map(options.map((option, i) => [optionKey(i), option]));
    const candidates = top.map(item => byKey.get(item.key)).filter((o): o is ScaffoldOption => Boolean(o));
    let value: ScaffoldRecommendation;
    if (substantive == null || substantive < t.substantive || candidates.length === 0) {
      value = none({ substantive, model: first.model, candidates: candidates.map((o, i) => ({ id: o.id, rank: top[i]?.p ?? 0, fit: null, best: null })) });
    } else {
      const second = await ask(state, fitQuestions(candidates), { config, timeoutMs: REQUEST_TIMEOUT_MS, retry: false });
      const { pick, scores } = chooseRecommendation(candidates, second.answers as Record<string, JevAnswer | undefined>, top.map(item => item.p), t);
      value = {
        scaffold: pick,
        fit: pick ? scores.find(score => score.id === pick.id)?.fit ?? null : null,
        substantive,
        candidates: scores,
        model: second.model,
        latencyMs: Date.now() - started,
      };
    }
    cache.delete(key);
    cache.set(key, { at: now(), value });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return value;
  } catch (err) {
    return none({ error: err instanceof JevError ? err.kind : 'other' });
  }
}
