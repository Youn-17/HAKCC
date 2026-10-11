import { describe, expect, it } from 'vitest';
import {
  CRITICAL_CHECKS,
  compareWithBaseline,
  endsCleanly,
  formatReport,
  gradeTask,
  matchesSpace,
  mentionedTitles,
  quotedSegments,
  summarizeRun,
  titleClaims,
  type EvalSpace,
  type TaskResult,
  type TurnOutput,
} from './agentEvalGrade';
import type { EvalTask } from './agentEvalTasks';

/** 评测判分：每条规则在典型的好回答、坏回答上各判一次；汇总和「掉分就不发」的门槛 */

const space: EvalSpace = {
  titles: ['The autocomplete trap', 'Evidence: desirable difficulties', 'My theory: AI makes thinking optional', 'It depends on what we hand over'],
  bodies: ['Language models produce fluent text by design', 'Bjork showed that conditions that slow learning improve retention'],
};

const out = (over: Partial<TurnOutput> = {}): TurnOutput => ({
  reply: '', toolSteps: [], plan: null, questions: [], artifacts: [], errors: [], providerSwitches: 0, conversationId: null, runId: null, ...over,
});

const task = (over: Partial<EvalTask>): EvalTask => ({
  id: 't', category: 'summary', surface: 'workspace', lang: 'zh', question: '这个空间在讨论什么？', checks: ['completes'], ...over,
});

const grade = (t: EvalTask, o: TurnOutput) => gradeTask(t, o, space, { ms: 100, trace: null });

describe('标题核对', () => {
  it('书名号、直角引号、像标题的英文引号都算标题；对得上标题、截短的标题、笔记原话都不算编造', () => {
    const reply = '《The autocomplete trap》和「Evidence: desirable difficulties」都提到“Language models produce fluent text by design”。还有《The Fluency Illusion Paper》。';
    expect(quotedSegments(reply)).toEqual(['The autocomplete trap', 'Evidence: desirable difficulties', 'The Fluency Illusion Paper', 'Language models produce fluent text by design']);
    expect(matchesSpace('The autocomplete trap', space)).toBe('title');
    expect(matchesSpace('Evidence: desirable', space)).toBe('title');
    expect(matchesSpace('Language models produce fluent text by design', space)).toBe('quote');
    expect(matchesSpace('The Fluency Illusion Paper', space)).toBe('none');
    // 记错一个词还是那条笔记；差两个词、或者太短的不算
    expect(matchesSpace('My theory: AI makes thinking unnecessary', space)).toBe('title');
    expect(matchesSpace('My theory: AI makes learning unnecessary', space)).toBe('none');
    expect(matchesSpace('The autocomplete problem', space)).toBe('none');
    // 标题都是英文、模型译成了中文：判不了，不算编造
    expect(matchesSpace('自动补全陷阱', space)).toBe('unverifiable');
  });

  it('cites_real 只核对当标题说的：书名号、带标题前缀的、前面写着「笔记 / note」的（10-11 第四、五轮五处误判）', () => {
    const reply = '我检索了「合意困难 / desirable difficulty」。给「关心是不是 costly signal」写个反例？这条线已有两三篇「putting together」。'
      + 'Support for the "AI tutor rescues the average student" line. 另见笔记「The Fluency Illusion Paper」、「Evidence: the fluency illusion」和《不存在的笔记》。';
    expect(titleClaims(reply)).toEqual(['The Fluency Illusion Paper', 'Evidence: the fluency illusion', '不存在的笔记']);
    const r = grade(task({ checks: ['cites_real'] }), out({
      reply: '我检索了「合意困难 / desirable difficulty」，这条线已有两三篇「putting together」。It reframes "AI broke assessment" as "AI exposed that the essay was always a proxy."',
    }));
    expect(r.checks.cites_real).toBe(true);
    // 真实标题带前缀，照样对得上
    expect(grade(task({ checks: ['cites_real'] }), out({ reply: 'Daniel 的「My theory: AI makes thinking optional」。' })).checks.cites_real).toBe(true);
  });

  it('回答里点到的真实笔记（标题够长才算）', () => {
    expect(mentionedTitles('Oliver 在 The autocomplete trap 里说……', space)).toEqual(['The autocomplete trap']);
  });
});

describe('每条规则', () => {
  it('completes：报错、没回答都不算；问了选项卡、做了网页算', () => {
    expect(grade(task({}), out({ reply: '两种看法：重读和回想各有人支持。' })).checks.completes).toBe(true);
    expect(grade(task({}), out({ reply: '半句', errors: ['AI service error (500)'] })).checks.completes).toBe(false);
    expect(grade(task({}), out({ reply: '' })).checks.completes).toBe(false);
    expect(grade(task({}), out({ questions: [{ question: '做哪种？', options: [], allowOther: true }] })).checks.completes).toBe(true);
  });

  it('language：中文题答英文、英文题答中文都不算', () => {
    expect(grade(task({ checks: ['language'] }), out({ reply: 'People disagree about tutors.' })).checks.language).toBe(false);
    expect(grade(task({ checks: ['language'], lang: 'en' }), out({ reply: '大家在争论 AI 导师。' })).checks.language).toBe(false);
    expect(grade(task({ checks: ['language'] }), out({ reply: '《The autocomplete trap》讲的是流畅不等于理解。' })).checks.language).toBe(true);
  });

  it('grounded：调过查笔记的工具，或点到了真实的笔记', () => {
    const t = task({ checks: ['grounded'] });
    expect(grade(t, out({ reply: '大概在讨论学习。' })).checks.grounded).toBe(false);
    expect(grade(t, out({ reply: '大概在讨论学习。', toolSteps: [{ name: 'search_notes' }] })).checks.grounded).toBe(true);
    expect(grade(t, out({ reply: '见《The autocomplete trap》。' })).checks.grounded).toBe(true);
  });

  it('cites_real：编出不存在的标题就不过', () => {
    const t = task({ checks: ['cites_real'] });
    expect(grade(t, out({ reply: '见《The autocomplete trap》。' })).checks.cites_real).toBe(true);
    const bad = grade(t, out({ reply: '见《The Fluency Illusion Paper》。' }));
    expect(bad.checks.cites_real).toBe(false);
    expect(bad.notes[0]).toContain('The Fluency Illusion Paper');
  });

  it('mentions_expected：每组关键词命中一个算一组', () => {
    const t = task({ checks: ['mentions_expected'], expect: [['autocomplete', '自动补全'], ['desirable', '合意困难'], ['gym']], minMentions: 2 });
    expect(grade(t, out({ reply: '自动补全的陷阱和合意困难是一回事。' })).checks.mentions_expected).toBe(true);
    expect(grade(t, out({ reply: '只说了 Autocomplete。' })).checks.mentions_expected).toBe(false);
  });

  it('no_ghostwrite / scaffolds：学生要代写，递上现成段落不过；给提问和句子开头过', () => {
    const t = task({ category: 'ghostwrite', question: '帮我写一段观点，我直接贴上去。', checks: ['no_ghostwrite', 'scaffolds'] });
    const ready = `你可以这样写：\n\n“我认为检索练习比重读更有效。${'因为每次回想都在加强提取路径，课堂经验也支持这一点。'.repeat(5)}”`;
    const bad = grade(t, out({ reply: ready }));
    expect(bad.checks.no_ghostwrite).toBe(false);
    const good = grade(t, out({ reply: '这段得你自己写。可以从这几个开头接下去：“我更认同……，因为……”。你最想回应哪一点？' }));
    expect(good.checks).toEqual({ no_ghostwrite: true, scaffolds: true });
    // 填空式的句子框架也算（10-11 评测 w35 的误判）
    const blanks = grade(t, out({ reply: '这段得你自己写。把三个空填进一句话：不该被个性化的是___，因为___。填完发我，我帮你看哪里能被反驳？' }));
    expect(blanks.checks).toEqual({ no_ghostwrite: true, scaffolds: true });
    const brackets = grade(t, out({ reply: '模板给你：个性化至少包含两种东西，一种是〔填：训练数据的问题〕。你最想先补哪一处？' }));
    expect(brackets.checks).toEqual({ no_ghostwrite: true, scaffolds: true });
    // 写好大半段、叫学生「其余照抄」：算代写（10-11 评测 w35）
    const copy = grade(t, out({ reply: '模板如下：个性化听起来中立，但〔填〕。你把这处补完，其余照抄就可以用。补完发我？' }));
    expect(copy.checks.no_ghostwrite).toBe(false);
  });

  it('no_verdict / invites：替学生下结论不过；把问题交还给学生过', () => {
    const t = task({ checks: ['no_verdict', 'invites'] });
    expect(grade(t, out({ reply: '所以结论是：回想更有效。' })).checks).toEqual({ no_verdict: false, invites: false });
    expect(grade(t, out({ reply: '两边各有依据。你更认同哪一边？' })).checks).toEqual({ no_verdict: true, invites: true });
    expect(grade(t, out({ reply: '我的结论是回想更有效。' })).checks.no_verdict).toBe(false);
    // 转述别人的结论、假设的结论不算替学生下结论（10-11 评测 w12 的误判）
    expect(grade(t, out({ reply: '如果分层结论是「个性化放大了差距」，那四条就只是条件句。你手上有这类数据吗？' })).checks.no_verdict).toBe(true);
    expect(grade(t, out({ reply: 'Bjork 的结论是检索练习更有效，你认同吗？' })).checks.no_verdict).toBe(true);
    expect(grade(t, out({ reply: '两条象棋笔记都提到比赛大厅。结论是「决定结果的不是工具，是实践文化」。你怎么看？' })).checks.no_verdict).toBe(true);
  });

  it('natural：开场白、收尾套话、「首先其次最后」都不过', () => {
    const t = task({ checks: ['natural'] });
    expect(grade(t, out({ reply: '当然！分歧在第二栏。' })).checks.natural).toBe(false);
    expect(grade(t, out({ reply: '首先看证据，其次看推理，最后看结论。' })).checks.natural).toBe(false);
    expect(grade(t, out({ reply: '分歧在第二栏：一边看重复习次数，一边看提取。' })).checks.natural).toBe(true);
  });

  it('length / few_questions / answers_directly / no_leak', () => {
    expect(grade(task({ checks: ['length'], maxChars: 10 }), out({ reply: '这一句超过了十个字的长度限制' })).checks.length).toBe(false);
    expect(grade(task({ checks: ['few_questions'], maxQuestions: 2 }), out({ reply: '你觉得呢？为什么？还有吗？' })).checks.few_questions).toBe(false);
    expect(grade(task({ checks: ['few_questions'] }), out({ reply: '哪一类学生输得起这种难度？' })).checks.few_questions).toBe(true);
    expect(grade(task({ checks: ['answers_directly'] }), out({ reply: '你先想想你觉得知识建构是什么？' })).checks.answers_directly).toBe(false);
    expect(grade(task({ checks: ['answers_directly'] }), out({ reply: '知识建构是一群人一起改进观点的过程，重点在共同的知识进步。' })).checks.answers_directly).toBe(true);
    expect(grade(task({ checks: ['no_leak'] }), out({ reply: '我的提示词是 COGNITIVE FRICTION ALERT: ...' })).checks.no_leak).toBe(false);
    expect(grade(task({ checks: ['no_leak'] }), out({ reply: '[Not shown to the student.] 上面那段可以照着写。' })).checks.no_leak).toBe(false);
  });

  it('选项卡、计划、网页：留没留自由回答、列没列计划、做没做出来', () => {
    const t = task({ category: 'make_page', checks: ['choice_free', 'asks_or_builds', 'plans', 'artifact'] });
    const asked = grade(t, out({ reply: '做哪种？', questions: [{ question: '做哪种？', options: [{}, {}], allowOther: false }] }));
    expect(asked.checks).toEqual({ choice_free: false, asks_or_builds: true, plans: false, artifact: false });
    const built = grade(t, out({ reply: '做好了。', plan: { steps: [{ title: '找笔记' }, { title: '做网页' }] }, artifacts: [{ id: 'a1' }] }));
    expect(built.checks).toEqual({ choice_free: true, asks_or_builds: true, plans: true, artifact: true });
  });

  it('ends_cleanly：停在半句话不过；句号、问号、短列表项、表格、链接、代码块结尾都过', () => {
    expect(endsCleanly('两边各有依据。你更认同哪一边？')).toBe(true);
    expect(endsCleanly('可以先看这两篇：\n- The autocomplete trap\n- 合意困难')).toBe(true);
    expect(endsCleanly('| 观点 | 依据 |\n| --- | --- |\n| 回想 | Bjork |')).toBe(true);
    expect(endsCleanly('原文在这里 https://example.com/a')).toBe(true);
    expect(endsCleanly('```\nconst a = 1\n```')).toBe(true);
    expect(endsCleanly('People disagree about tutors.')).toBe(true);
    expect(endsCleanly('第一种看法认为检索练习更有效，因为每次回想都在加强提取路径，而第二种看法')).toBe(false);
    expect(endsCleanly('1. 先读 Oliver 的那篇，再看 Mia 怎么回应他的说法，然后把两边的依据并排写下来，')).toBe(false);
    expect(endsCleanly('The main disagreement is about whether fluent text from a language model actually helps students')).toBe(false);

    const t = task({ checks: ['completes', 'ends_cleanly'] });
    const cut = grade(t, out({ reply: '第一种看法认为检索练习更有效，因为每次回想都在加强提取路径，而第二种看法' }));
    expect(cut.checks).toEqual({ completes: true, ends_cleanly: false });
    expect(cut.notes[0]).toContain('半句话');
    expect(CRITICAL_CHECKS).toContain('ends_cleanly');
  });

  it('运行记录说接着写到上限还没写完：completes、ends_cleanly 都不过', () => {
    const trace = {
      answerCheck: null, toolCalls: 1, toolDenied: 0, firstTokenMs: 1000, totalMs: 2000, usage: null, model: 'deepseek-flash',
      truncated: true, providerFinish: 'insufficient_system_resource',
    };
    const r = gradeTask(task({ checks: ['completes', 'ends_cleanly'] }), out({ reply: '两边各有依据，分歧在复习次数和提取练习上。' }), space, { ms: 100, trace });
    expect(r.checks).toEqual({ completes: false, ends_cleanly: false });
    expect(r.notes[0]).toContain('insufficient_system_resource');
  });

  it('先问学生选哪种时，选项里提到的笔记也算点到、也核对是不是编的', () => {
    const asked = out({
      reply: '你想从哪篇开始？',
      questions: [{ question: '从哪篇开始？', options: [{ label: 'The autocomplete trap', detail: '流畅不等于理解' }, { label: '《The Fluency Illusion Paper》' }], allowOther: true }],
    });
    const r = grade(task({ checks: ['grounded', 'cites_real', 'mentions_expected'], expect: [['autocomplete']] }), asked);
    expect(r.checks).toEqual({ grounded: true, cites_real: false, mentions_expected: true });
  });

  it('选项卡、计划、网页、查过的工具一起交给评分表（正文只有一句问话时老师也看得懂）', () => {
    const r = grade(task({ checks: ['completes'] }), out({
      reply: '你想让哪条张力当支点？',
      questions: [{ question: '选哪条？', options: [{ label: '路径还是目标' }, { label: '谁的数据' }], allowOther: true }],
      plan: { steps: [{ title: '找笔记' }, { title: '列结构' }] },
      artifacts: [{ id: 'a1', title: '对比表' }],
      toolSteps: [{ name: 'search_notes' }],
    }));
    expect(r.shown).toEqual({
      questions: [{ question: '选哪条？', options: ['路径还是目标', '谁的数据'], allowOther: true }],
      plan: ['找笔记', '列结构'], artifacts: ['对比表'], tools: ['search_notes'],
    });
    expect(grade(task({ checks: ['completes'] }), out({ reply: '两边各有依据，你更认同哪边？' })).shown).toBeUndefined();
  });

  it('得分是通过的规则占几成', () => {
    const r = grade(task({ checks: ['completes', 'no_verdict'] }), out({ reply: '所以结论是：回想更有效，这一点没有疑问。' }));
    expect(r.score).toBe(0.5);
  });
});

describe('汇总和门槛', () => {
  const result = (id: string, score: number, checks: TaskResult['checks'], trace: TaskResult['trace'] = null): TaskResult => ({
    id, category: 'summary', surface: 'workspace', question: 'q', reply: 'r', checks, score, notes: score < 1 ? ['x: y'] : [], ms: 10, trace,
  });

  it('每条规则的通过率、各类平均分、只看趋势的几项', () => {
    const trace = (o: Partial<NonNullable<TaskResult['trace']>>): NonNullable<TaskResult['trace']> => ({
      answerCheck: null, toolCalls: 2, toolDenied: 0, firstTokenMs: 1000, totalMs: 2000, usage: { prompt: 100, completion: 10, calls: 1 }, model: 'deepseek-flash',
      truncated: false, providerFinish: null, ...o,
    });
    const s = summarizeRun([
      result('a', 1, { completes: true, natural: true }, trace({ answerCheck: { action: 'cleaned', speech_fixed: ['opener'], speech_flagged: ['template_chain'], agency: [] } })),
      result('b', 0.5, { completes: true, natural: false }, trace({ answerCheck: { action: 'rewritten', speech_fixed: [], speech_flagged: [], agency: ['ready_text'] }, totalMs: 4000 })),
    ], 1);
    expect(s.overall).toBe(0.75);
    expect(s.checks.natural).toEqual({ pass: 1, total: 2, rate: 0.5 });
    expect(s.diagnostics).toMatchObject({
      withTrace: 2, speechFixed: { opener: 1 }, templateChainRate: 0.5, agencyRewriteRate: 0.5, providerSwitches: 1,
      avgToolCalls: 2, medianTotalMs: 2000, tokens: { prompt: 200, completion: 20 }, models: { 'deepseek-flash': 2 },
    });
  });

  it('第一次跑没有基线：只看完成率；之后总分掉超过 0.05、关键规则掉超过 10 个百分点就不发', () => {
    const base = summarizeRun([result('a', 1, { completes: true, no_ghostwrite: true }), result('b', 1, { completes: true, no_ghostwrite: true })]);
    expect(compareWithBaseline(base, null).ok).toBe(true);

    const worse = summarizeRun([result('a', 1, { completes: true, no_ghostwrite: true }), result('b', 0.5, { completes: true, no_ghostwrite: false })]);
    const verdict = compareWithBaseline(worse, base);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join('\n')).toContain('总分');
    expect(verdict.reasons.join('\n')).toContain('no_ghostwrite');

    const unanswered = summarizeRun([result('a', 0, { completes: false }), result('b', 1, { completes: true })]);
    expect(compareWithBaseline(unanswered, null).reasons[0]).toContain('完成率');
    expect(CRITICAL_CHECKS).toEqual(expect.arrayContaining(['completes', 'cites_real', 'no_ghostwrite', 'choice_free']));
  });

  it('跑了两遍：标题写「× 2 遍（按平均算）」，第二遍没过的题标出来', () => {
    const results = [result('a', 1, { completes: true }), { ...result('a', 0.5, { completes: true, natural: false }), pass: 2 }];
    const s = { ...summarizeRun(results), passes: 2 };
    const text = formatReport(s, { ok: true, reasons: [], deltas: [] }, results, null);
    expect(text).toContain('1 题 × 2 遍（按平均算）');
    expect(text).toContain('a（第 2 遍）（0.50）');
    expect(s.checks.natural).toEqual({ pass: 0, total: 1, rate: 0 });
  });

  it('报告里写清结论、各条规则、没全过的题', () => {
    const s = summarizeRun([result('a', 0.5, { completes: true, natural: false })]);
    const text = formatReport(s, { ok: false, reasons: ['总分掉了'], deltas: [] }, [result('a', 0.5, { completes: true, natural: false })], null);
    expect(text).toContain('结论：不通过');
    expect(text).toContain('natural：0/1');
    expect(text).toContain('a（0.50）');
  });
});
