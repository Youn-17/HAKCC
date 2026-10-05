import type { JevAnswer, JevQuestion } from './jevClient';

/**
 * Structured judgments for conditional feedback and answer length.
 * Clear gaps (T1–T4, T6), promising unfinished ideas (T5), and feedback type
 * use separate questions. English and Chinese prompt variants are available.
 * Type choices can be evaluated in forward and reverse order.
 */

export type TriggerCode = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';
export const TRIGGER_CODES: readonly TriggerCode[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
export type JudgeLang = 'en' | 'zh';
export type ChoiceOrder = 'forward' | 'reverse';

type Noul = { instructions: string; yes: string; no: string };

const NEED: Record<JudgeLang, Noul> = {
  en: {
    instructions:
      "The state is a student's note on a knowledge-building discussion board. Does the note have a clear gap that an AI facilitator should point out now with one short piece of feedback? "
      + 'The default is no. Say no when the student reasons in their own words, even imperfectly; writes a sincere reflection that reaches its own conclusion; '
      + 'adds a short, on-point follow-up; posts social or logistics content; or frames, selects, critiques or applies AI output in their own words. '
      + "Say yes only when the note clearly shows one of these: pasted AI output with no voice of the student's own; an opinion or plan with no reasons; "
      + 'a strong or absolute claim with no support, or a factual error; several points or keywords listed with no connection between them; '
      + 'or the student is stuck, confused, or asking a question that may go unanswered.',
    yes: 'Point out the gap: one of the listed situations clearly applies',
    no: 'No clear gap: the note works as it is, or it is not a knowledge post',
  },
  zh: {
    instructions:
      'state 是学生在知识建构讨论区里写的一条笔记。这条笔记有没有明显的问题，值得 AI 助教现在用一句简短的反馈指出来？默认没有。'
      + '以下情况算没有：学生在用自己的话推理，哪怕不完美；真诚的反思，并且有自己的结论；简短而切题的跟进；社交、通知类内容；学生对 AI 的输出做了取舍、评论或应用。'
      + '只有笔记明显属于以下情况之一才算有：直接粘贴 AI 的回答，没有自己的话；只给观点或打算，不说理由；绝对化或很强的事实判断却没有依据，或者事实错误；'
      + '罗列几点或几个关键词，却不说它们之间的关系；学生卡住了、说不清，或提了一个可能没人回答的问题。',
    yes: '有问题：明显属于上面列出的某一种情况',
    no: '没有明显问题：这条笔记本身可以，或不是讨论知识的内容',
  },
};

const PROMISING: Record<JudgeLang, Noul> = {
  en: {
    instructions:
      "Does the note end on a promising idea that the student has not followed through: a tentative hunch, a hypothesis, or an observation they have not yet tested, explained or connected, where one good question could take it deeper? "
      + 'Say no when the student has already reasoned the idea through to a conclusion with reasons or an example, and when the note is a list, a pasted text, or a request for help.',
    yes: 'Promising and unfinished: one push could take it deeper',
    no: 'Not this: already worked through, or a different kind of note',
  },
  zh: {
    instructions:
      '这条笔记是不是停在一个有潜力、但学生还没往下推的想法上：一个试探性的猜想、假设，或一个还没检验、没解释、没和别的想法联系起来的观察，一个好问题就能把它推得更深？'
      + '如果学生已经把想法推到了结论，并且有理由或例子，就不是；罗列、粘贴的文字、求助类的笔记也不是。',
    yes: '有潜力、没推完：推一把能更深',
    no: '不是：已经想完整了，或是别的类型的笔记',
  },
};

const TYPE: Record<JudgeLang, { instructions: string; criteria: Record<TriggerCode, string> }> = {
  en: {
    instructions:
      'Suppose an AI facilitator gives this note one piece of feedback. Which single issue should it address? Pick the one with the most leverage. '
      + "Whose words: pasted AI text with no student voice is T1; the student's own words without reasons is T2. "
      + 'Missing reasons is T2; missing facts or support, or a factual error, is T3. '
      + 'A bare list of points or keywords is T4, even though it also gives no reasons.',
    criteria: {
      T1: 'Undigested AI: a long pasted AI answer with no student voice: no framing, selection, critique or application',
      T2: "No reasoning: the student's own opinion or plan, with no why and no chain of reasoning",
      T3: 'No evidence: a strong or absolute factual claim with no support, or a claim that is factually wrong',
      T4: "No connection: several points listed without saying how they relate, or closely related classmates' ideas ignored",
      T5: 'Promising seed: a good insight that stops short; one push could take it deeper',
      T6: 'Unclear or stuck: the meaning is unclear, or the student says they cannot explain, tell apart or decide something, or asks a real question that may go unanswered',
    },
  },
  zh: {
    instructions:
      '如果 AI 助教要给这条笔记一句反馈，最该针对哪一个问题？只选影响最大的一个。'
      + '分辨谁的话：直接粘贴 AI 的回答、没有自己的话是 T1；学生自己的话但没有理由是 T2。缺理由是 T2；缺事实依据或事实错误是 T3。'
      + '光是罗列要点或关键词的算 T4，即使它也没给理由。',
    criteria: {
      T1: '未消化的 AI 内容：大段粘贴 AI 的回答，没有学生自己的声音，没有引入、取舍、评论或应用',
      T2: '缺推理：学生自己的观点或打算，没有说为什么，没有推理过程',
      T3: '缺证据：很强或绝对化的事实判断没有依据，或者事实错误',
      T4: '缺联系：罗列了几点却没说它们之间的关系，或忽略了同学密切相关的想法',
      T5: '有潜力的种子：好的想法停在半路，推一把就能更深入',
      T6: '不清楚或卡住了：意思不清楚，或学生说自己说不清、分不清、拿不定主意，或提了一个可能没人回答的真问题',
    },
  },
};

const typeKey = (order: ChoiceOrder) => (order === 'forward' ? 'type' : 'type_reverse');

const noul = (q: Noul): JevQuestion => ({ type: 'noul', instructions: q.instructions, criteria: { true: q.yes, false: q.no } });

/** 有没有问题、是不是好想法、哪一类，一次请求问完。orders 给两个就正序、倒序各问一遍 */
export function feedbackQuestions(lang: JudgeLang = 'en', orders: readonly ChoiceOrder[] = ['forward']): Record<string, JevQuestion> {
  const type = TYPE[lang];
  const questions: Record<string, JevQuestion> = { need: noul(NEED[lang]), promising: noul(PROMISING[lang]) };
  for (const order of orders) {
    const codes = order === 'forward' ? TRIGGER_CODES : [...TRIGGER_CODES].reverse();
    questions[typeKey(order)] = {
      type: 'choice',
      instructions: type.instructions,
      criteria: Object.fromEntries(codes.map(code => [code, type.criteria[code]])),
    };
  }
  return questions;
}

/** 只发判断要用的：官方说 state 里无关内容越多越不准。正文和现在的大模型一样截到 2000 字 */
export function feedbackState(title: string, text: string): Record<string, string> {
  return { title: (title ?? '').trim().slice(0, 200), note: (text ?? '').trim().slice(0, 2000) };
}

export interface FeedbackJudgment {
  /** 有明显问题（T1–T4、T6）的概率 */
  needProbability: number;
  /** 停在半路的好想法（T5）的概率；没问这一题时为 null */
  promisingProbability: number | null;
  need: boolean;
  /** 因为什么要反馈：有问题 / 好想法推一把；不要时为 null */
  reason: 'gap' | 'promising' | null;
  type: TriggerCode;
  /** 正序、倒序（问了几遍就平均几遍）的平均概率 */
  typeProbabilities: Record<TriggerCode, number>;
  typeConfidence: number;
  /** 正序、倒序选的是不是同一类；只问了一遍时为 null */
  orderAgreement: boolean | null;
}

export interface FeedbackThresholds {
  /** 有明显问题 */
  need: number;
  /** 停在半路的好想法，比上面严 */
  promising: number;
}

/**
 * 有问题优先：问题的概率到了阈值，类型取类型题里概率最高的。
 * 没有问题、但好想法的概率到了它的阈值，就是 T5。都没到就不要（类型照样给出，只作记录）。
 */
export function interpretFeedback(
  answers: Record<string, JevAnswer | undefined>,
  thresholds: FeedbackThresholds,
): FeedbackJudgment | null {
  const need = answers.need;
  if (!need || need.type !== 'noul') return null;
  const promising = answers.promising?.type === 'noul' ? answers.promising.noul : null;
  const typeAnswers = (['forward', 'reverse'] as const)
    .map(order => answers[typeKey(order)])
    .filter((a): a is Extract<JevAnswer, { type: 'choice' }> => a?.type === 'choice');
  if (typeAnswers.length === 0) return null;

  const typeProbabilities = Object.fromEntries(TRIGGER_CODES.map(code => [
    code,
    typeAnswers.reduce((sum, a) => sum + (Number(a.probabilities[code]) || 0), 0) / typeAnswers.length,
  ])) as Record<TriggerCode, number>;
  const likeliest = [...TRIGGER_CODES].sort((a, b) => typeProbabilities[b] - typeProbabilities[a])[0];

  const reason = need.noul >= thresholds.need ? 'gap'
    : promising != null && promising >= thresholds.promising ? 'promising'
    : null;
  const type = reason === 'promising' ? 'T5' : likeliest;

  return {
    needProbability: need.noul,
    promisingProbability: promising,
    need: reason !== null,
    reason,
    type,
    typeProbabilities,
    typeConfidence: typeProbabilities[type],
    orderAgreement: typeAnswers.length >= 2 ? typeAnswers.every(a => a.choice === typeAnswers[0].choice) : null,
  };
}

// ── 回答长度 ─────────────────────────────────────────────────

const DEPTH: Record<JudgeLang, { instructions: string; levels: [string, string, string] }> = {
  en: {
    instructions:
      'The state is a question a student asked an AI learning assistant. How much explanation does a good answer need? '
      + 'Judge what the question asks for, not how long the question is.',
    levels: [
      'Light: a fact, a definition, a yes or no, or how to do something in the app; a few clear sentences answer it fully',
      'Medium: explain a concept with an example, or give a few points of advice',
      'Deep: compare, analyse in several steps, weigh different views, design something, or draw on several notes or sources',
    ],
  },
  zh: {
    instructions: 'state 是学生向 AI 学习助手提的一个问题。一个好的回答需要讲多少？看问题要求什么，不看问题本身有多长。',
    levels: [
      '浅：一个事实、一个定义、是或否，或者平台里某个操作怎么做；几句话就能答完整',
      '中：要结合例子解释一个概念，或者给几条建议',
      '深：要比较、多步分析、权衡不同观点、设计方案，或综合多条笔记和资料',
    ],
  },
};

export function depthQuestions(lang: JudgeLang = 'en'): Record<string, JevQuestion> {
  const depth = DEPTH[lang];
  return { depth: { type: 'score', instructions: depth.instructions, criteria: [...depth.levels] } };
}

/**
 * 问题深度，0 浅 – 2 深，可以带小数。按各档概率算期望：档位的键是数字，排序后按名次算，
 * 不管服务端从 0 还是从 1 编号；概率不全时退回它给的 score。
 */
export function interpretDepth(answer: JevAnswer | undefined): number | null {
  if (!answer || answer.type !== 'score') return null;
  const levels = Object.entries(answer.probabilities ?? {})
    .map(([key, p]) => [Number(key), Number(p)] as const)
    .filter(([key, p]) => Number.isFinite(key) && Number.isFinite(p))
    .sort((a, b) => a[0] - b[0]);
  const total = levels.reduce((sum, [, p]) => sum + p, 0);
  const expected = levels.length >= 2 && total > 0
    ? levels.reduce((sum, [, p], rank) => sum + rank * p, 0) / total
    : answer.score;
  if (!Number.isFinite(expected)) return null;
  return Math.min(2, Math.max(0, expected));
}

export type AnswerLength = 'short' | 'medium' | 'long';

/** 三档的基准字数（中文字）。不是硬上限，是告诉模型大概写多少 */
export const ANSWER_LENGTH_BASE: Record<AnswerLength, number> = { short: 250, medium: 550, long: 1000 };

/**
 * 档位是中等难度问题该写的量，问题深浅在上面调：最浅七折，中等不变，最深 1.3 倍。
 * 没有深度判断（Jev 没开、超时）就按档位基准。取整到 10 字。
 */
export function answerLengthTarget(preset: AnswerLength, depth?: number | null): number {
  const base = ANSWER_LENGTH_BASE[preset];
  if (depth == null || !Number.isFinite(depth)) return base;
  const d = Math.min(2, Math.max(0, depth));
  // 按百分数算：0.7 × 550 这种小数乘法会落在 384.999…，取整差出 10 字
  const percent = d <= 1 ? 70 + 30 * d : 100 + 30 * (d - 1);
  return Math.round((base * percent) / 1000) * 10;
}
