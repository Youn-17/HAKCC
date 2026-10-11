/**
 * 回答给学生看之前的两道检查（harness 的 onStop，2026-10-11）。
 *
 * 1. 说话自然：开场白（「当然」「好的」「这是个好问题」）、收尾套话（「希望对你有帮助」）、表情符号、
 *    短回答里的小标题和成串加粗，这几样能原样删掉的直接删；「作为 AI……」「首先……其次……最后」这类
 *    删了会断句的，交给模型改一遍。
 * 2. 主体性：学生让 AI 替自己写（一段观点、一份作答、给同学的回复）而 AI 真写了成段的现成文字，
 *    就把那段换成两三个提问或句子开头，让学生自己写。依据：Bastani et al. (2025, PNAS) 不加限制的
 *    GPT 让学生考试成绩低 17%，只给提示、不给答案的版本基本没有这个损失。
 *
 * 规则判断偏保守：宁可放过，不把正常回答改成一串反问。改写结果不可信（凭空多出引用、链接、书名，
 * 长度离谱，语言变了）就不用，退回删过套话的原文。
 */

// ── 提示词里的说话规则 ───────────────────────────────────────

export const NATURAL_SPEECH_RULES = [
  'How to talk: like a helpful classmate or TA, not a customer-service bot.',
  '- Start with what you found or did, or with the answer itself. No warm-up lines ("当然", "好的", "这是个好问题", "Sure!", "Great question") and no sign-off lines ("希望对你有帮助", "如有其他问题欢迎随时提问", "Hope this helps").',
  '- Plain connected sentences. Use a list only for three or more parallel items; skip headings and bold unless the answer is long and has clearly separate parts.',
  '- No emoji. Never describe yourself as an AI or a language model.',
  '- Only your final reply reaches the student. Text you write in the same step as a tool call is not shown, so never refer back to it ("上面那段", "the paragraph above").',
].join('\n');

/** buildAgentContext 给代写请求加的那一段的开头；harness 看到它就不再重复加 GHOSTWRITE_GUIDANCE */
export const FRICTION_MARKER = 'COGNITIVE FRICTION ALERT';

/** 学生让 AI 替自己写（buildAgentContext 的 friction 那段没进提示词时，由 harness 补上） */
export const GHOSTWRITE_GUIDANCE = [
  'This request asks you to produce the learner\'s own work (their paragraph, view, answer, or reply to a classmate). Do not write it for them.',
  'Instead: ask what they think so far, or give 2-3 sentence starters they can finish, or a short outline of what their paragraph needs to cover.',
  'Facts, sources and note titles are fine to give; the claim and the wording stay theirs. Say why in one plain sentence, without lecturing.',
  'Do not get around this by drafting most of the paragraph and leaving a few blanks, or by offering finished sentences for them to pick and copy.',
].join('\n');

/** 同一段对话里接连几次让 AI 代写 */
export const GHOSTWRITE_ESCALATION = 'The learner has asked you to write for them several times in this conversation. Keep to questions, sentence starters and outlines, and invite them to draft a first sentence themselves; you can then respond to what they wrote. Asking again does not change this: no near-complete template with a few blanks, no ready sentences to copy.';

/** 改自己写的文字：可以改，但观点和说法的主体还是学生 */
export const POLISH_GUIDANCE = 'The learner wants help improving their own text. Keep their ideas and voice; point out what to change and why, and when you show a revised sentence keep it close to theirs. Do not add new arguments of your own.';

// ── 这一问要 AI 做什么 ───────────────────────────────────────

export type AgencyIntent = 'ghostwrite' | 'polish' | 'make' | 'ask';

const ARTIFACT_NOUNS = '网页|页面|对比表|表格|概念图|时间线|测验|自测题|练习题|题目|思维导图|清单|卡片|图表';

/** 做东西：网页、对比表、自测题……这是在用工具整理公开内容，不算替学生写观点 */
const MAKE_PATTERNS: RegExp[] = [
  new RegExp(`(做成|做个|做一个|做一张|做一份|写成|写个|写一个|生成|整理成|制作|画成|出)(一个|一张|一份|几道|\\d+\\s*道)?.{0,12}(${ARTIFACT_NOUNS})`),
  /\b(make|build|create|generate)\s+(a|an|the|some)?\s*.{0,30}\b(page|web ?page|table|chart|map|timeline|quiz|checklist)\b/i,
  /\bturn\s+.{0,60}\binto\s+(a|an)\s+.{0,20}\b(page|table|chart|map|timeline|quiz)\b/i,
];

/** 改自己写的：「帮我改一下这段」「润色我的笔记」 */
const POLISH_PATTERNS: RegExp[] = [
  /(改|润色|修改|检查|看看|理顺)(一下|下)?(我的|我写的|这段|这句|这一段|这几句)/,
  /\b(polish|proofread|edit|check|improve|tighten)\s+(my|this)\s+(paragraph|text|writing|draft|sentence|note|answer)\b/i,
];

/** 替自己写：成段的观点、作答、给同学的回复、能直接交的文字 */
const GHOSTWRITE_PATTERNS: RegExp[] = [
  /(帮|替|给)我(写|编|撰写|拟)(一?[段篇份个句条]|几句|几段|些)?.{0,10}(笔记|观点|看法|段落|作业|答案|结论|回答|回复|论文|报告|反思|总结|文章|开头|结尾|内容|东西|发言)/,
  /(帮|替)我(写|回答|回复|完成|做完)(?!.{0,12}(网页|页面|表格|对比表|概念图|时间线|测验|自测题|题目|图))/,
  /(帮|替|给)我想(一个|个|一句|几句|一段)(观点|看法|结论|答案|回复|说法)/,
  /(帮|替)我做(作业|题|练习|这道题|这题)/,
  /(直接|就)(告诉|给)我(答案|结论|观点|看法)/,
  /写(一段|一篇|一份).{0,12}(我|可以|能)(直接)?(用|交|贴|复制)/,
  /(可以|能)直接(复制|粘贴|拷贝|提交|交上去)/,
  /给我一个(可以直接用|现成)的/,
  /\b(write|draft|complete|finish)\s+(this|it|that|my|the|a)\b.{0,40}\bfor me\b/i,
  /\bjust\s+(tell|give)\s+me\s+the\s+answer\b/i,
  /\b(something|text)\s+i\s+can\s+(just\s+)?(copy|paste|submit|hand in)\b/i,
];

export function classifyAgencyIntent(text: string): AgencyIntent {
  const t = (text ?? '').trim();
  if (!t) return 'ask';
  if (MAKE_PATTERNS.some(p => p.test(t))) return 'make';
  if (POLISH_PATTERNS.some(p => p.test(t))) return 'polish';
  if (GHOSTWRITE_PATTERNS.some(p => p.test(t))) return 'ghostwrite';
  return 'ask';
}

/** 之前几句里有几次是让 AI 代写 */
export function countGhostwriteRequests(texts: readonly string[]): number {
  return texts.filter(t => classifyAgencyIntent(t) === 'ghostwrite').length;
}

// ── 说话自然 ─────────────────────────────────────────────────

export type SpeechIssue = 'opener' | 'closer' | 'emoji' | 'over_formatted' | 'summary_connector' | 'self_ai' | 'template_chain';

const OPENER = /^\s*(当然[了啦]?|好的|好嘞|好呀|没问题|非常好的问题|好问题|这是一个(非常|很)?好的?问题|很高兴(为你|帮你|能)[^，,。！!\n]{0,12}|Sure|Of course|Certainly|Absolutely|Great question|Good question)[，,。.！!~～\s]+/i;

const CLOSER = /^(希望(以上|这些|这个|这)?(内容|回答|信息|分析|建议|解释)?(能|可以)?(对你)?有(所)?帮助|如果(你)?(还)?有(其他|任何|更多)的?(问题|疑问|想法)|如有(其他|任何)(问题|疑问)|欢迎(随时)?(继续)?(提问|交流|讨论|告诉我|追问)|祝(你)?(学习)?(顺利|愉快|进步)|有(任何)?问题(随时|欢迎)?(问我|找我)|I hope (this|that) helps|Hope (this|that) helps|Let me know if you (have|need)|Feel free to (ask|reach out)|Happy (learning|studying))/i;

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]️?/gu;
const SELF_AI = /作为(一个|一名)?\s*(AI|人工智能|语言模型|大模型)|\bas an AI\b|\bas a language model\b/i;
const SUMMARY_CONNECTOR = /^(总之|综上所述|总而言之|总的来说)[，,]\s*/;

/** 回答里去掉 Markdown 记号后的字数，判断「短回答」用 */
function plainLength(text: string): number {
  return text.replace(/[#*_`>|\-\s]/g, '').length;
}

/** 只改代码块外面的文字：短回答里带一段 Python，注释的 # 不能当小标题删掉 */
function mapOutsideCode(text: string, fn: (segment: string) => string): string {
  return text.split(/(```[\s\S]*?```)/g).map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');
}

/** 最后一句（中文按 。！？ 断，英文按 .!?）；返回去掉它之后的文字和这一句 */
function splitLastSentence(line: string): { head: string; last: string } {
  const m = line.match(/^(.*[。！？!?.])\s*([^。！？!?.]+[。！？!?.]?)\s*$/);
  if (!m) return { head: '', last: line };
  return { head: m[1], last: m[2] };
}

/**
 * 要模型改一遍的说话问题。改一遍要多等 5–10 秒：替学生写了现成文字（主体性）和「作为 AI……」值得等；
 * 「首先……其次……最后」国产模型几乎每答必用，回回改学生就回回等，只记下来，靠提示词里的规则少出现，
 * 评测集（第三步）量出频率再定要不要改。
 */
export const REWRITE_SPEECH: ReadonlySet<SpeechIssue> = new Set<SpeechIssue>(['self_ai']);

export interface SpeechCheck {
  /** 能原样删掉的已经删了 */
  text: string;
  /** 删掉了哪些 */
  fixed: SpeechIssue[];
  /** 删了会断句、要模型改的 */
  remaining: SpeechIssue[];
}

export function checkSpeech(input: string): SpeechCheck {
  const original = input ?? '';
  let text = original;
  const fixed = new Set<SpeechIssue>();
  const remaining = new Set<SpeechIssue>();

  // 开场白：只看最开头，删掉之后还得有正文
  const opener = text.match(OPENER);
  if (opener) {
    const rest = text.slice(opener[0].length).trimStart();
    if (rest.length >= 4) {
      text = rest;
      fixed.add('opener');
    }
  }

  // 收尾套话：整行是套话就删整行，最后一行末尾那一句是套话就删那一句（最多删两处）
  for (let i = 0; i < 2; i++) {
    const lines = text.trimEnd().split('\n');
    const lastLine = (lines[lines.length - 1] ?? '').trim();
    if (!lastLine) break;
    // 带问号的是在问学生，不是客套（「欢迎继续讨论：你觉得哪种更有说服力？」）
    if (/[？?]/.test(lastLine)) break;
    if (CLOSER.test(lastLine) && lastLine.length <= 60 && lines.length > 1) {
      lines.pop();
      text = lines.join('\n').trimEnd();
      fixed.add('closer');
      continue;
    }
    const { head, last } = splitLastSentence(lastLine);
    if (head && CLOSER.test(last.trim()) && last.length <= 60) {
      lines[lines.length - 1] = head;
      text = lines.join('\n').trimEnd();
      fixed.add('closer');
      continue;
    }
    break;
  }

  // 表情符号
  if (EMOJI.test(text)) {
    text = mapOutsideCode(text, seg => seg.replace(EMOJI, '').replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' '));
    fixed.add('emoji');
  }
  EMOJI.lastIndex = 0;

  const short = plainLength(text) < 500;

  // 短回答里的小标题、成串加粗：去掉记号，字一个不动
  if (short) {
    const prose = text.replace(/```[\s\S]*?```/g, '');
    const headings = (prose.match(/^#{1,6}\s+\S/gm) ?? []).length;
    const bolds = (prose.match(/\*\*[^*\n]+\*\*/g) ?? []).length;
    if (headings > 0 || bolds >= 3) {
      text = mapOutsideCode(text, seg => seg.replace(/^#{1,6}\s+(.+)$/gm, '$1').replace(/\*\*([^*\n]+)\*\*/g, '$1'));
      fixed.add('over_formatted');
    }
  }

  // 短回答最后一段用「总之，」起头：去掉这两个字
  if (short) {
    const paras = text.split(/\n{2,}/);
    const lastPara = paras[paras.length - 1] ?? '';
    if (paras.length > 1 && SUMMARY_CONNECTOR.test(lastPara)) {
      paras[paras.length - 1] = lastPara.replace(SUMMARY_CONNECTOR, '');
      text = paras.join('\n\n');
      fixed.add('summary_connector');
    }
  }

  if (SELF_AI.test(text)) remaining.add('self_ai');
  if (plainLength(text) < 600 && /首先/.test(text) && /其次/.test(text) && /(最后|此外|再次)/.test(text)) remaining.add('template_chain');

  return { text: text.trim() ? text : original, fixed: [...fixed], remaining: [...remaining] };
}

// ── 主体性：有没有替学生写成段的现成文字 ─────────────────────

export type AgencyIssue = 'ghostwritten' | 'ready_text';

/** 引出「可以直接用」的一段：你可以这样写：/ 以下是一段你可以直接用的回复 */
const READY_TEXT_LEADS: RegExp[] = [
  /你可以(这样|直接)?(写|回复|回答|说)[：:]/,
  /(可以|能)直接(复制|粘贴|使用|提交|用|交)/,
  /以下是(一段|一份|一篇|一个)?(你)?(可以|能)?(直接)?(用|使用|参考)?的?(段落|回复|回答|文字|范文|示例|版本)[：:]?/,
  /参考(写法|范文|段落|回复|答案)[：:]/,
  /(示例|范例)(段落|回复|回答|答案)[：:]/,
  /here(?:'s| is) (a|an) (paragraph|reply|response|draft|version) you (can|could) (use|submit|paste|post)/i,
  /you (can|could) (write|say|reply|post)[:：]/i,
];

/** 成段的第一人称立场：AI 用学生的口吻写观点 */
const FIRST_PERSON_STANCE = /我(认为|觉得|的观点是|主张|相信|的看法是)|\bI (think|believe|argue|would argue)\b/gi;

/**
 * AI 叫学生照抄自己写的（「其余照抄就可以用」，10-11 评测 w35）。同一小句里有「不/别/没/无」的不算（「不是让你照抄」），
 * 只看到前一个标点为止，免得「我写不了。其余照抄就行」被前一句的「不」放过。
 */
function offersCopy(text: string): boolean {
  // 「照搬了」是在说别人照搬，不是叫学生照抄
  for (const m of text.matchAll(/(?:照抄|照搬)(?!了)|原样(?:贴|交|用|抄)/g)) {
    const before = text.slice(0, m.index ?? 0);
    const clause = before.slice(Math.max(before.search(/[^，。；！？,.;!?\n]*$/), before.length - 8));
    if (!/[不别没无勿]/.test(clause)) return true;
  }
  for (const m of text.matchAll(/\b(?:copy|paste) (?:it|this|the rest) (?:as is|directly|word for word)\b/gi)) {
    const clause = text.slice(0, m.index ?? 0).split(/[.;!?\n]/).pop() ?? '';
    if (!/\b(?:don't|do not|never|not)\b/i.test(clause)) return true;
  }
  return false;
}

/**
 * 留了空让学生接着写的句子开头（「所以我认为……」「I think ___ because ___」）是支架，不是替学生表态。
 * 短的、带省略号或下划线的引号片段和短行先拿掉再查（2026-10-11 评测 w31：一句「所以我认为空间还没回答的是……」
 * 让整段被当成代写，白改了一遍）。长段引文中间带个省略号照样算。
 */
const BLANK = /……|…|\.\.\.|_{2,}|＿{2,}/;
const QUOTED_SEGMENT = /[「“"『][^」”"』\n]{0,200}[」”"』]/g;
const STARTER_MAX_CHARS = 80;

function withoutStarters(text: string): string {
  return text
    .replace(QUOTED_SEGMENT, seg => (seg.length <= STARTER_MAX_CHARS + 2 && BLANK.test(seg) ? '' : seg))
    .split('\n')
    .map(line => (line.trim().length <= STARTER_MAX_CHARS && BLANK.test(line) ? '' : line))
    .join('\n');
}

/** 引出语后面那一段（到空行或结尾为止，引号/引用块原样算进去）有多长 */
function passageAfter(text: string, index: number): number {
  const rest = text.slice(index);
  const block = rest.split(/\n\s*\n/).slice(0, 2).join('\n');
  return withoutStarters(block).replace(/[\s>“”"「」*]/g, '').length;
}

export interface AgencyCheck {
  issues: AgencyIssue[];
  /** 最长那段现成文字的字数（研究记录用） */
  passageChars: number;
}

export function checkAgency(answer: string, opts: { intent: AgencyIntent }): AgencyCheck {
  const text = answer ?? '';
  let passageChars = 0;
  for (const lead of READY_TEXT_LEADS) {
    const m = lead.exec(text);
    if (m) passageChars = Math.max(passageChars, passageAfter(text, m.index + m[0].length));
  }
  const issues = new Set<AgencyIssue>();
  // 学生明说要代写：引出一段现成文字、或者写了成段的第一人称观点，都算
  if (opts.intent === 'ghostwrite') {
    if (passageChars >= 80 || offersCopy(text)) issues.add('ready_text');
    const paras = text.split(/\n\s*\n/);
    for (const p of paras) {
      const body = withoutStarters(p);
      const stances = body.match(FIRST_PERSON_STANCE)?.length ?? 0;
      const chars = body.replace(/\s/g, '').length;
      if (stances >= 1 && chars >= 150) {
        issues.add('ghostwritten');
        passageChars = Math.max(passageChars, chars);
      }
    }
  } else if (opts.intent !== 'polish' && passageChars >= 150) {
    // 学生没要，AI 自己递上一段能直接交的文字
    issues.add('ready_text');
  }
  return { issues: [...issues], passageChars };
}

// ── 交给模型改一遍 ───────────────────────────────────────────

export function buildRevisionPrompt(p: { text: string; speech: SpeechIssue[]; agency: AgencyIssue[] }): { system: string; user: string } {
  const asks: string[] = [];
  if (p.agency.length > 0) {
    asks.push('The reply writes the learner\'s own work for them (a paragraph, view, answer or reply they could paste). Replace that ready-made text with 2-3 short questions or sentence starters that help them write it themselves. Keep facts, sources and note titles that help them, and add one plain sentence saying the wording should be theirs.');
  }
  if (p.speech.includes('self_ai')) asks.push('Remove any mention of being an AI or a language model.');
  if (p.speech.includes('template_chain')) asks.push('Drop the 首先/其次/最后 scaffolding and say it as connected sentences, the way a classmate would.');
  const system = [
    'You edit one reply from a learning assistant before a student sees it.',
    'Change only what is asked. Keep every fact, number, note title, link and citation marker like [2] exactly as written. Never add new facts, new sources or new links.',
    'Keep the same language, and the same length or shorter. Plain sentences: no headings, no bold, no emoji, no opening or closing pleasantries.',
    'Return only the edited reply.',
  ].join('\n');
  const user = `What to fix:\n- ${asks.join('\n- ')}\n\nReply to edit:\n<<<\n${p.text}\n>>>`;
  return { system, user };
}

const CITATION = /\[(\d{1,3})\]/g;
const URL_RE = /https?:\/\/[^\s)）\]>"']+/g;
const BOOK_TITLE = /《[^》\n]{1,60}》/g;

function setOf(text: string, re: RegExp): Set<string> {
  return new Set(text.match(re) ?? []);
}

function cjkRatio(text: string): number {
  // 链接、引用编号不算字：一条网址能把整段中文的占比压下去
  const chars = text.replace(URL_RE, '').replace(CITATION, '').replace(/\s/g, '');
  if (!chars) return 0;
  return (chars.match(/[一-鿿]/g)?.length ?? 0) / chars.length;
}

/** 模型偶尔把 <<< >>> 或代码围栏一起抄回来 */
export function unwrapRevision(raw: string): string {
  let text = (raw ?? '').trim();
  text = text.replace(/^<<<\s*/, '').replace(/\s*>>>$/, '');
  const fence = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1];
  return text.trim();
}

/**
 * 改写结果能不能用：没有凭空多出的引用编号、链接、书名号标题，长度在合理范围，语言没变。
 * 主体性改写会把一大段现成文字换成两三个提问，变短很多是正常的；只改说法的不该短到一半以下。
 */
export function acceptRevision(original: string, revised: string, opts: { agency?: boolean } = {}): { ok: boolean; reason?: string } {
  const text = unwrapRevision(revised);
  if (!text) return { ok: false, reason: 'empty' };
  if (cjkRatio(original) >= 0.3 && cjkRatio(text) < 0.3) return { ok: false, reason: 'language' };
  if (cjkRatio(original) < 0.05 && cjkRatio(text) >= 0.3) return { ok: false, reason: 'language' };
  const origCites = setOf(original, CITATION);
  for (const c of setOf(text, CITATION)) if (!origCites.has(c)) return { ok: false, reason: 'new_citation' };
  const origUrls = setOf(original, URL_RE);
  for (const u of setOf(text, URL_RE)) if (!origUrls.has(u)) return { ok: false, reason: 'new_link' };
  const origTitles = setOf(original, BOOK_TITLE);
  for (const b of setOf(text, BOOK_TITLE)) if (!origTitles.has(b)) return { ok: false, reason: 'new_title' };
  const ratio = text.length / Math.max(1, original.length);
  const [min, max] = opts.agency ? [0.08, 1.2] : [0.5, 1.3];
  if (ratio < min || ratio > max) return { ok: false, reason: 'length' };
  return { ok: true };
}
