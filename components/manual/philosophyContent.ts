/**
 * 平台理念：每一项设计背后参考了什么文献、文献怎么说、我们据此做了什么。
 *
 * 写这份内容的规则只有一条：**每一条引用都经过逐条核对**（出处、卷期、页码），
 * 核对不到的不写。宁可少一条，不能有一条是编的 —— 这个页面是给研究者和
 * 学生看的，一条假引用会让整页失去可信度。
 *
 * 结构分三层：章节 → 原则（一句主张 + 平台如何落实）→ 文献（这篇说了什么、
 * 我们据此做了什么）。文献按 id 引用，避免同一篇在多处重复抄写出处。
 */

export type Bilingual = { zh: string; en: string };

export interface Reference {
  id: string;
  /** 作者（年份）。按原文语言书写。 */
  authors: string;
  year: string;
  title: string;
  /** 期刊/书/会议 + 卷期页。 */
  venue: string;
  doi?: string;
  url?: string;
  /** 这篇文献的核心主张，用一两句话说清楚。 */
  said: Bilingual;
  /** 我们据此在平台上做了什么。 */
  applied: Bilingual;
  /** 未经同行评议或尚在审稿中的，标出来。 */
  status?: Bilingual;
}

export interface Principle {
  /** 一句主张。 */
  claim: Bilingual;
  /** 平台如何落实，每条对应一个具体功能。 */
  how: Bilingual[];
  /** 依据的文献 id。 */
  refs: string[];
}

export interface PhilosophySection {
  id: string;
  num: string;
  title: Bilingual;
  /** 章节导语。 */
  lead: Bilingual;
  principles: Principle[];
}

export const REFERENCES: Reference[] = [
  // ── 知识建构 ──────────────────────────────────────────────────────
  {
    id: 'scardamalia1994',
    authors: 'Scardamalia, M., & Bereiter, C.',
    year: '1994',
    title: 'Computer support for knowledge-building communities',
    venue: 'The Journal of the Learning Sciences, 3(3), 265–283',
    doi: '10.1207/s15327809jls0303_3',
    said: {
      zh: '学校应重组为「知识建构社区」：把知识的建构当作集体目标来支持，而不是各人各自完成任务。CSILE（Knowledge Forum 的前身）用一块共享的公共空间承载想法，并用「我的理论」「我需要理解」这类话头帮助学生进入知识建构话语。',
      en: 'Schools should be restructured as knowledge-building communities where constructing knowledge is supported as a collective goal. CSILE, the forerunner of Knowledge Forum, used a shared public space for ideas and scaffolds such as "My theory" and "I need to understand" to bring students into knowledge-building discourse.',
    },
    applied: {
      zh: '整个工作区就是那块公共空间：一门课一个知识社区，笔记是共有的对象，任何人都能在他人的笔记上 Build-on。支架库里的 KB 类支架（「我的理论」等）直接沿用了这一传统。',
      en: 'The workspace is that public space: one knowledge community per course, notes as shared objects that anyone can build on. The KB scaffolds in the library ("My theory" and others) follow this tradition directly.',
    },
  },
  {
    id: 'scardamalia2002',
    authors: 'Scardamalia, M.',
    year: '2002',
    title: 'Collective cognitive responsibility for the advancement of knowledge',
    venue: 'In B. Smith (Ed.), Liberal education in a knowledge society (pp. 67–98). Chicago: Open Court',
    url: 'https://ikit.org/fulltext/2002CollectiveCog.pdf',
    said: {
      zh: '提出知识建构的十二条原则，核心是「集体认知责任」——社区成员共同对公共知识的状态负责，而不是把责任留给教师；以及「认知主体性」——学生自己设定目标、评估进展、处理分歧。所有人都是合法的贡献者（知识民主化）。',
      en: 'Sets out the twelve knowledge-building principles, centred on collective cognitive responsibility — members share responsibility for the state of public knowledge rather than leaving it to the teacher — and epistemic agency, students setting goals, judging progress and handling disagreement themselves. Everyone is a legitimate contributor.',
    },
    applied: {
      zh: '三处直接落实：学生决定是否采纳 AI 反馈，采纳后可以先修订原 Note；贡献时检查修订是否回应反馈，尚未回应时才可能生成对同伴可见的关联 Note；观点图谱和讨论速览只做「定位」不做「综合」——更高一层的说法归学生写。',
      en: 'Three direct consequences: students decide whether to accept AI feedback and can first revise their original Note; contribution-time checks determine whether a peer-visible linked Note is still needed; the idea graph and discussion digest locate ideas but never synthesise them — that higher-level statement belongs to students.',
    },
  },
  {
    id: 'scardamalia2006',
    authors: 'Scardamalia, M., & Bereiter, C.',
    year: '2006',
    title: 'Knowledge building: Theory, pedagogy, and technology',
    venue: 'In R. K. Sawyer (Ed.), The Cambridge handbook of the learning sciences (pp. 97–118). Cambridge University Press',
    url: 'https://ikit.org/fulltext/2006_KBTheory.pdf',
    said: {
      zh: '知识建构与「学习」不同：学习是个人头脑状态的改变，知识建构是对社区公共知识的改进——产出的是可以被他人使用、批评、改进的观点。技术的作用是让观点成为可操作的对象。',
      en: 'Knowledge building differs from learning: learning changes an individual mind, knowledge building improves a community\'s public knowledge, producing ideas others can use, criticise and improve. Technology\'s role is to make ideas into manipulable objects.',
    },
    applied: {
      zh: '笔记卡片可以被拖动、连接、引用、综合、被 AI 反馈——它是一个对象，不是一段提交的文本。研究导出把「学生产出」和「AI 产出」分开计数，以支持核查贡献来源与共同体活动；计数本身不衡量知识质量。',
      en: 'A note card can be dragged, linked, cited, synthesised and given feedback — it is an object, not a submitted text. Research exports count student output and AI output separately to support inspection of contribution provenance and community activity; counts alone do not measure knowledge quality.',
    },
  },
  {
    id: 'bereiter2002',
    authors: 'Bereiter, C.',
    year: '2002',
    title: 'Education and mind in the knowledge age',
    venue: 'Mahwah, NJ: Lawrence Erlbaum Associates',
    said: {
      zh: '批评「心智是容器」的比喻。知识不是装进头脑里的东西，而是存在于概念性人工物（理论、解释、设计）中，可以被共同改进。教育应区分「学习」与「知识建构」，后者才是知识时代的核心工作。',
      en: 'Rejects the mind-as-container metaphor. Knowledge lives in conceptual artefacts — theories, explanations, designs — that can be improved together. Education must distinguish learning from knowledge building; the latter is the central work of the knowledge age.',
    },
    applied: {
      zh: '平台的评价指标围绕「想法有没有被接手并推进」（Build-on 链长度、跨组回应、Rise-above 次数），而不是提交数量。手册第一页就写明：在他人笔记上 Build-on，比新开一条更有价值。',
      en: 'Platform metrics ask whether ideas were picked up and carried forward — build-on chain length, cross-group responses, rise-aboves — not how many notes were submitted. The manual says so on its first page.',
    },
  },
  {
    id: 'zhang2009',
    authors: 'Zhang, J., Scardamalia, M., Reeve, R., & Messina, R.',
    year: '2009',
    title: 'Designs for collective cognitive responsibility in knowledge-building communities',
    venue: 'The Journal of the Learning Sciences, 18(1), 7–44',
    doi: '10.1080/10508400802581676',
    said: {
      zh: '用三年课堂数据比较三种社会组织形式：固定小组、互动小组、机会性协作。结论是流动的、按想法需要临时组合的协作最能产生集体认知责任——「谁在回应谁」的网络越分散越好。文中用社会网络分析度量这一点。',
      en: 'Compares three social configurations over three years — fixed groups, interacting groups, opportunistic collaboration. Fluid collaboration organised around ideas produced the strongest collective cognitive responsibility; the more distributed the who-responds-to-whom network, the better. Social network analysis was the measure.',
    },
    applied: {
      zh: '教师端研究区的「网络分析」正是这一度量：Build-on 网络的密度、中心性分布、跨组连接。「参与公平性」面板看的是责任是否集中在少数人身上。View 允许学生把任何画布的卡片作为传送门放到别处，就是为了让协作跨越固定小组的边界。',
      en: 'The teacher research area\'s network analysis is this measure: density and centrality of the build-on network, cross-group links. The equity panel asks whether responsibility concentrates in a few people. Views let students place any canvas\'s card elsewhere as a portal, so collaboration can cross fixed group boundaries.',
    },
  },
  {
    id: 'chen2015',
    authors: 'Chen, B., Scardamalia, M., & Bereiter, C.',
    year: '2015',
    title: 'Advancing knowledge-building discourse through judgments of promising ideas',
    venue: 'International Journal of Computer-Supported Collaborative Learning, 10(4), 345–366',
    doi: '10.1007/s11412-015-9225-z',
    said: {
      zh: '「判断哪些想法有潜力」是知识创造的核心能力，而且小学生就能做。让学生标记社区里有潜力的想法，再据此组织下一步讨论，能让知识建构话语持续推进而不是原地打转。',
      en: 'Judging which ideas are promising is a core capacity of knowledge creation, and even young students can do it. Having students mark promising ideas and organise the next round of discourse around them keeps knowledge building moving rather than circling.',
    },
    applied: {
      zh: '学生端「潜力想法」面板：潜力分 = 被 Build-on 次数 ×2 + 被标记为有潜力（T5）×3 + 被作为证据或综合引用 ×1.5。AI 反馈六类里的 T5「有潜力的想法」是唯一的正向类型——它的作用不是纠错，而是替学生指出「这里值得再推一步」。',
      en: 'The student "Promising ideas" panel: promise score = build-ons ×2 + promising (T5) marks ×3 + citations as evidence or synthesis ×1.5. Of the six AI feedback types, T5 "promising idea" is the only positive one — it does not correct, it points to where one more push is worth it.',
    },
  },
  {
    id: 'resendes2015',
    authors: 'Resendes, M., Scardamalia, M., Bereiter, C., Chen, B., & Halewood, C.',
    year: '2015',
    title: 'Group-level formative feedback and metadiscourse',
    venue: 'International Journal of Computer-Supported Collaborative Learning, 10(3), 309–336',
    doi: '10.1007/s11412-015-9219-x',
    said: {
      zh: '给二年级学生看小组层面的可视化反馈（词汇使用、话语模式），再组织「知识建构谈话」，学生能就自己社区知识的状态展开元话语——讨论「我们讨论到哪儿了」。反馈要指向社区而不是个人。',
      en: 'Grade-2 students shown group-level visualisations (vocabulary use, discourse patterns) and then engaged in "knowledge-building talk" could sustain metadiscourse about the state of their community knowledge. Feedback should address the community, not individuals.',
    },
    applied: {
      zh: '观点图谱（哪些概念在场、谁的问题没人接、Build-on 链最长的几条）和讨论速览（只列出在场立场，不下结论）都是群体层面的形成性反馈。Rise Above 讨论室里那张「系统注意到的」卡只并列陈述分歧并提一个问题，明令禁止合并观点。',
      en: 'The idea graph (which concepts are present, whose questions went unanswered, the longest build-on chains) and the discussion digest (positions listed, no conclusion drawn) are group-level formative feedback. The "what the system noticed" card in the Rise Above room states disagreements side by side and asks one question; merging ideas is forbidden.',
    },
  },

  {
    id: 'scardamalia2004',
    authors: 'Scardamalia, M.',
    year: '2004',
    title: 'CSILE/Knowledge Forum®',
    venue: 'In A. Kovalchick & K. Dawson (Eds.), Education and technology: An encyclopedia (pp. 183–192). Santa Barbara, CA: ABC-CLIO',
    url: 'https://ikit.org/fulltext/CSILE_KF.pdf',
    said: {
      zh: 'Knowledge Forum 的基本支架集：「我的理论」「我需要理解」「新信息」「这个理论无法解释」「更好的理论」「把我们的知识放在一起」。它们把学生的贡献导向明确的认知操作——提出解释、标出困惑、引入信息、指出反例、改进理论、综合。',
      en: 'Knowledge Forum\'s basic scaffold set — "My theory", "I need to understand", "New information", "This theory cannot explain", "A better theory", "Putting our knowledge together" — steers contributions toward explicit cognitive operations: propose, mark confusion, bring information, point out a counter-case, improve, synthesise.',
    },
    applied: {
      zh: '平台六种 Build-on 关系与这套支架一一对应：延伸 ≈ 更好的理论；澄清 / 提问 ≈ 我需要理解；质疑 ≈ 这个理论无法解释；证据 ≈ 新信息；综合 ≈ 把我们的知识放在一起。区别在于 KF 的支架写在正文里，我们把它做成连线的类型——这样「谁用什么方式回应了谁」直接成为网络数据。',
      en: 'The six build-on relations map onto this set: extend ≈ a better theory; clarify / question ≈ I need to understand; challenge ≈ this theory cannot explain; evidence ≈ new information; synthesise ≈ putting our knowledge together. KF writes scaffolds into the text; we make them the type of the link, so who-responded-how becomes network data directly.',
    },
  },
  {
    id: 'weinberger2006',
    authors: 'Weinberger, A., & Fischer, F.',
    year: '2006',
    title: 'A framework to analyze argumentative knowledge construction in computer-supported collaborative learning',
    venue: 'Computers & Education, 46(1), 71–95',
    url: 'https://www.sciencedirect.com/science/article/abs/pii/S0360131505000564',
    said: {
      zh: '分析 CSCL 中论证性知识建构的四个维度：参与、认识（内容质量）、论证结构（主张、依据、保证、限定、反论）、以及社会性共同建构模式——外化、引出、快速共识、整合导向共识、冲突导向共识。',
      en: 'Four dimensions for analysing argumentative knowledge construction in CSCL: participation, epistemic quality, argument structure (claim, grounds, warrant, qualifier, counter-argument) and social modes of co-construction — externalisation, elicitation, quick consensus, integration-oriented and conflict-oriented consensus.',
    },
    applied: {
      zh: '「提问」对应引出，「质疑」对应冲突导向共识，「综合」对应整合导向共识；「证据」是论证结构里的依据。研究导出的 relations 带类型，可以直接映射到这套编码做分析。',
      en: '"Question" maps to elicitation, "challenge" to conflict-oriented consensus, "synthesise" to integration-oriented consensus; "evidence" is the grounds in the argument structure. Exported relations carry their type and map directly onto this coding scheme.',
    },
  },
  {
    id: 'gunawardena1997',
    authors: 'Gunawardena, C. N., Lowe, C. A., & Anderson, T.',
    year: '1997',
    title: 'Analysis of a global online debate and the development of an interaction analysis model for examining social construction of knowledge in computer conferencing',
    venue: 'Journal of Educational Computing Research, 17(4), 397–431',
    doi: '10.2190/7MQV-X9UJ-C7Q3-NRAG',
    said: {
      zh: '交互分析模型（IAM）把在线知识的社会建构分五个阶段：分享与比较 → 发现分歧 → 协商意义 → 检验与修正 → 达成一致并应用。它是分析在线讨论「走到了哪一步」最常用的框架之一。',
      en: 'The Interaction Analysis Model stages the social construction of knowledge online: sharing and comparing → discovering dissonance → negotiating meaning → testing and modifying → agreeing and applying. One of the most used frameworks for judging how far an online discussion has progressed.',
    },
    applied: {
      zh: '六种关系大致覆盖了这五阶段：澄清 / 证据属于分享与比较，质疑对应发现分歧，提问与延伸推动协商，综合对应最后两阶段。观点图谱里「Build-on 链最长的几条」实际上是在找走得最远的讨论。',
      en: 'The six relations roughly span these phases: clarify and evidence belong to sharing, challenge to dissonance, question and extend drive negotiation, synthesise covers the last two. The idea graph\'s "longest build-on chains" is looking for the discussions that travelled furthest.',
    },
  },
  {
    id: 'vanaalst2009',
    authors: 'van Aalst, J.',
    year: '2009',
    title: 'Distinguishing knowledge-sharing, knowledge-construction, and knowledge-creation discourses',
    venue: 'International Journal of Computer-Supported Collaborative Learning, 4(3), 259–287',
    doi: '10.1007/s11412-009-9069-5',
    said: {
      zh: '区分三种在线话语：知识分享（交换信息）、知识建构（协商与整合）、知识创造（把想法当作可改进的对象、承担集体责任）。只有第三种才是 Scardamalia 与 Bereiter 意义上的知识建构；很多看起来热闹的讨论停留在第一种。',
      en: 'Distinguishes three online discourses: knowledge sharing (exchanging information), knowledge construction (negotiating and integrating), knowledge creation (treating ideas as improvable objects under collective responsibility). Only the third is knowledge building in Scardamalia and Bereiter\'s sense; many lively discussions never leave the first.',
    },
    applied: {
      zh: '这是为什么六种关系里没有「赞同」「补充一条」这类分享型动作——每一种都要求贡献者对原想法做点什么。教师端研究区把只有「证据 / 澄清」而缺少「质疑 / 综合」的小组标为可能停留在分享层。',
      en: 'This is why the six relations include no sharing-type moves such as "agree" or "add one more" — each requires doing something to the original idea. The teacher research area flags groups with only evidence and clarify but no challenge or synthesise as possibly stuck at sharing.',
    },
  },
  {
    id: 'chan1997',
    authors: 'Chan, C., Burtis, J., & Bereiter, C.',
    year: '1997',
    title: 'Knowledge building as a mediator of conflict in conceptual change',
    venue: 'Cognition and Instruction, 15(1), 1–40',
    doi: '10.1207/s1532690xci1501_1',
    said: {
      zh: '遇到与自己信念相冲突的信息时，是否发生概念转变，取决于学生对冲突做了什么：把冲突当作要解释的问题（知识建构式处理）才促进转变，简单吸收或忽略则不会。冲突本身不是原因，对冲突的建构性处理才是。',
      en: 'Whether conflicting information produces conceptual change depends on what students do with the conflict: treating it as a problem to explain (knowledge-building processing) mediates change; assimilating or ignoring it does not. Conflict is not the cause — constructive processing of it is.',
    },
    applied: {
      zh: '「质疑」作为一种独立的 Build-on 类型，而且用醒目的颜色标出，就是要让分歧被当作值得处理的对象。Rise Above 讨论室里的「系统注意到的」卡只做一件事：把在场的分歧并列出来并提一个问题——让冲突进入建构，而不是被绕开。',
      en: '"Challenge" exists as a distinct build-on type, in a visible colour, so that disagreement is treated as something worth working on. The Rise Above room\'s system card does one thing: lays out the disagreements present and asks one question — so conflict enters construction instead of being stepped around.',
    },
  },

  // ── 支架 ──────────────────────────────────────────────────────────
  {
    id: 'wood1976',
    authors: 'Wood, D., Bruner, J. S., & Ross, G.',
    year: '1976',
    title: 'The role of tutoring in problem solving',
    venue: 'Journal of Child Psychology and Psychiatry, 17(2), 89–100',
    doi: '10.1111/j.1469-7610.1976.tb00381.x',
    said: {
      zh: '首次用「支架」描述辅导：有经验者帮助学习者完成其独立无法完成的任务，方式是控制那些超出学习者当前能力的部分，而不是替他做。有效的支架会随学习者能力增长而撤除。',
      en: 'Introduced "scaffolding" for tutoring: a more capable person helps a learner complete a task beyond their unaided reach by controlling the elements beyond current capacity, not by doing it for them. Effective scaffolds fade as competence grows.',
    },
    applied: {
      zh: '支架在笔记里的形态固定为「话头[学生写的内容]」——话头是给出的，方括号里必须是学生自己的话。研究编码只把方括号内的算作学生产出。AI 只提问不代答，同样是「控制超出能力的部分」而非替做。',
      en: 'A scaffold in a note always takes the form "prompt[what the student wrote]" — the prompt is given, the brackets must hold the student\'s own words, and only the bracketed part counts as student output in research coding. The AI asks rather than answers for the same reason.',
    },
  },
  {
    id: 'saye2002',
    authors: 'Saye, J. W., & Brush, T.',
    year: '2002',
    title: 'Scaffolding critical reasoning about history and social issues in multimedia-supported learning environments',
    venue: 'Educational Technology Research and Development, 50(3), 77–96',
    doi: '10.1007/BF02505026',
    said: {
      zh: '区分「硬支架」与「软支架」：硬支架是预先嵌入环境的静态支持（提示模板、结构化工具），软支架是教师或同伴根据当下情境动态给出的回应。两者互补，都不可缺。',
      en: 'Distinguishes hard scaffolds — static supports embedded in advance (prompt templates, structured tools) — from soft scaffolds, dynamic responses a teacher or peer gives in the moment. Both are needed.',
    },
    applied: {
      zh: '支架库（181 条，四个一级类 KB / CT / GenAI / TB）是硬支架，教师可按课程隐藏或补充；AI 自动反馈与同伴 Build-on 是软支架，按学生正在写的内容临时给出。每条支架的 Saye & Brush 交付方式记在元数据里，导出时可按此分析。',
      en: 'The scaffold library (181 items in four categories) is hard scaffolding that teachers can hide or extend per course; AI feedback and peer build-ons are soft scaffolding, given in response to what a student is writing. Each scaffold\'s delivery mode is stored in metadata for analysis.',
    },
  },
  {
    id: 'hannafin1999',
    authors: 'Hannafin, M. J., Land, S. M., & Oliver, K.',
    year: '1999',
    title: 'Open learning environments: Foundations, methods, and models',
    venue: 'In C. M. Reigeluth (Ed.), Instructional-design theories and models: A new paradigm of instructional theory (Vol. II, pp. 115–140). Mahwah, NJ: Lawrence Erlbaum Associates',
    said: {
      zh: '把开放学习环境中的支架按功能分四类：概念支架（帮学习者识别关键主题与相关知识）、元认知支架（帮其监控与反思学习过程）、程序支架（帮其使用工具与资源）、策略支架（提供完成任务的其他路径）。',
      en: 'Classifies scaffolds in open learning environments by function: conceptual (identify key themes and related knowledge), metacognitive (monitor and reflect on the process), procedural (use tools and resources), and strategic (alternative approaches to the task).',
    },
    applied: {
      zh: '支架库每一条的 Hannafin 功能类型都记在元数据里（`scaffolds.metadata`），研究导出与分析从那里取，不从分类名字符串解析。这让「学生用的是概念支架还是元认知支架」成为可统计的问题。',
      en: 'Each scaffold\'s Hannafin functional type is stored in metadata and read from there by exports and analyses, never parsed from a label string — so "did the student use a conceptual or a metacognitive scaffold" becomes a countable question.',
    },
  },
  {
    id: 'sweller1988',
    authors: 'Sweller, J.',
    year: '1988',
    title: 'Cognitive load during problem solving: Effects on learning',
    venue: 'Cognitive Science, 12(2), 257–285',
    doi: '10.1207/s15516709cog1202_4',
    said: {
      zh: '认知负荷理论的起点：工作记忆有限，与学习目标无关的处理（外在负荷）会挤占用于建构图式的容量。教学设计的任务是减少外在负荷。',
      en: 'The origin of cognitive load theory: working memory is limited, and processing irrelevant to the learning goal (extraneous load) crowds out capacity for building schemas. Instructional design should reduce extraneous load.',
    },
    applied: {
      zh: '「忽略」不设按钮——不作为不该要求学生多点一次；反馈卡淡入而不弹出；正文下方没有待处理反馈时不摆空占位框；插入 AI 内容从「写理由」降为「选支架」。这些都在减少与思考无关的操作。',
      en: 'No "ignore" button — doing nothing should not cost a click; feedback fades in rather than popping up; no empty placeholder below the note when nothing is pending; inserting AI content takes one scaffold choice instead of a written reason. Each removes work unrelated to thinking.',
    },
  },

  // ── 反馈 ──────────────────────────────────────────────────────────
  {
    id: 'hattie2007',
    authors: 'Hattie, J., & Timperley, H.',
    year: '2007',
    title: 'The power of feedback',
    venue: 'Review of Educational Research, 77(1), 81–112',
    doi: '10.3102/003465430298487',
    said: {
      zh: '反馈是影响学习最强的因素之一，但方向可正可负。有效的反馈回答三个问题：我要去哪（feed-up）、我现在怎样（feed-back）、下一步往哪（feed-forward）。指向任务过程和自我调节的反馈优于指向个人的评价。',
      en: 'Feedback is among the most powerful influences on learning, in either direction. Effective feedback answers three questions — where am I going, how am I going, where to next — and feedback about task and self-regulation beats feedback about the person.',
    },
    applied: {
      zh: 'AI 反馈的模板固定为 EFA 三步：承认已有努力 → 指出空缺 → 给一个具体的下一步（通常是一个问题）。它从不评价学生本人，只评价这条笔记里的推理。',
      en: 'AI feedback follows a fixed three-step template: acknowledge the effort, name the gap, offer one concrete next step, usually a question. It never evaluates the person, only the reasoning in that note.',
    },
  },
  {
    id: 'deeva2021',
    authors: 'Deeva, G., Bogdanova, D., Serral, E., Snoeck, M., & De Weerdt, J.',
    year: '2021',
    title: 'A review of automated feedback systems for learners: Classification framework, challenges and opportunities',
    venue: 'Computers & Education, 162, Article 104094',
    doi: '10.1016/j.compedu.2020.104094',
    said: {
      zh: '系统综述了自动反馈系统，给出分类框架（反馈时机、内容类型、生成方式等），并指出现有系统大多集中在客观题与编程，对开放式写作与协作话语的自动反馈仍是缺口。',
      en: 'Systematically reviews automated feedback systems and offers a classification framework (timing, content type, generation method). Most systems target closed tasks and programming; automated feedback on open-ended writing and collaborative discourse remains a gap.',
    },
    applied: {
      zh: '平台的自动反馈正对准这个缺口：作用对象是开放的知识建构笔记，而不是有标准答案的题目。按该框架，它是「即时、面向过程、由 LLM 生成、需学生决定采纳」的一类。',
      en: 'The platform\'s automatic feedback targets exactly that gap: open knowledge-building notes rather than tasks with a key. In the framework\'s terms it is immediate, process-oriented, LLM-generated, and left to the student to accept.',
    },
  },
  {
    id: 'chi2014',
    authors: 'Chi, M. T. H., & Wylie, R.',
    year: '2014',
    title: 'The ICAP framework: Linking cognitive engagement to active learning outcomes',
    venue: 'Educational Psychologist, 49(4), 219–243',
    doi: '10.1080/00461520.2014.965823',
    said: {
      zh: '按可观察行为把认知参与分四级：被动（接收）< 主动（操作）< 建构（生成超出所给材料的输出）< 互动（与他人共同建构）。层级越高学习越好。「建构」的标志是产出了材料里没有的东西。',
      en: 'Classifies cognitive engagement by overt behaviour into four rising modes: passive < active < constructive (generating output beyond the given material) < interactive (co-constructing with others). The mark of "constructive" is producing something not in the material.',
    },
    applied: {
      zh: '触发类型 T1「未消化的 AI 内容」的判定标准就是 ICAP 的「建构」门槛：大段粘贴的 AI 输出没有学生自己的框定、筛选、批评或应用，就停在「被动/主动」层。反馈的目标是把它推到「建构」层。',
      en: 'Trigger type T1 "undigested AI content" is judged against ICAP\'s constructive threshold: pasted AI output with no framing, selection, critique or application by the student stays passive or active. The feedback aims to push it to constructive.',
    },
  },
  {
    id: 'garrison2000',
    authors: 'Garrison, D. R., Anderson, T., & Archer, W.',
    year: '2000',
    title: 'Critical inquiry in a text-based environment: Computer conferencing in higher education',
    venue: 'The Internet and Higher Education, 2(2–3), 87–105',
    said: {
      zh: '探究社区框架：文本化在线学习要有效，需要认知在场（批判性探究的四阶段：触发—探索—整合—解决）、社会在场与教学在场三者交织。',
      en: 'The Community of Inquiry framework: effective text-based online learning weaves cognitive presence (triggering → exploration → integration → resolution), social presence and teaching presence.',
    },
    applied: {
      zh: '触发类型 T6「表意不清 / 真问题无人接」对应认知在场的「触发」阶段被卡住；T4「缺联系」对应「整合」阶段缺失。研究区的「话语分析」按这四阶段编码笔记。',
      en: 'Trigger type T6 "unclear, or a real question at risk of going unanswered" maps to a stalled triggering phase; T4 "no connection" to a missing integration phase. The discourse analysis panel codes notes by these four phases.',
    },
  },
  // ── 学生如何处理反馈 ────────────────────────────────────────────
  {
    id: 'winstone2017',
    authors: 'Winstone, N. E., Nash, R. A., Parker, M., & Rowntree, J.',
    year: '2017',
    title: 'Supporting learners\' agentic engagement with feedback: A systematic review and a taxonomy of recipience processes',
    venue: 'Educational Psychologist, 52(1), 17–37',
    doi: '10.1080/00461520.2016.1207538',
    said: {
      zh: '综述 195 项研究，提出「主动接收」（proactive recipience）：学生是反馈的主动处理者，不是容器。文献过度关注「如何给反馈」，却很少研究学生怎样接收、理解、使用反馈。',
      en: 'Reviews 195 studies and proposes "proactive recipience": learners actively process feedback rather than receive it passively. The literature over-focuses on how to give feedback and neglects how learners receive, make sense of and use it.',
    },
    applied: {
      zh: '反馈卡上的三个动作（采纳 / 不同意 / 追问）把「接收」变成一个可观察的决定，并全部进入研究数据。反馈不会消失，也不会自动生效——学生必须做点什么，它才算被处理。',
      en: 'The three actions on a feedback card — accept, disagree, follow up — make reception an observable decision that enters research data. Feedback neither vanishes nor takes effect on its own; the student has to act.',
    },
  },
  {
    id: 'carless2018',
    authors: 'Carless, D., & Boud, D.',
    year: '2018',
    title: 'The development of student feedback literacy: Enabling uptake of feedback',
    venue: 'Assessment & Evaluation in Higher Education, 43(8), 1315–1325',
    doi: '10.1080/02602938.2018.1463354',
    said: {
      zh: '学生反馈素养四要素：欣赏反馈的价值、作出判断（包括判定某条反馈不适用）、管理情绪、采取行动。四者相互支撑，缺一则反馈难以转化为改进。',
      en: 'Four features of student feedback literacy: appreciating feedback, making judgements (including judging that a piece of feedback does not apply), managing affect, and taking action. Each supports the others.',
    },
    applied: {
      zh: '「不同意」是一个正式按钮而不是流程漏损——判定反馈不适用本身就是素养。「管理情绪」对应反馈卡的克制呈现：不打断、不弹出、一次只显示一条。',
      en: '"Disagree" is a first-class button, not a leak in the funnel — judging feedback inapplicable is itself literacy. "Managing affect" shapes the card\'s restraint: no interruption, no popup, one at a time.',
    },
  },
  {
    id: 'nelson2009',
    authors: 'Nelson, M. M., & Schunn, C. D.',
    year: '2009',
    title: 'The nature of feedback: How different types of peer feedback affect writing performance',
    venue: 'Instructional Science, 37(4), 375–401',
    url: 'https://www.lrdc.pitt.edu/Schunn/papers/nelson-schunn-is2009.pdf',
    said: {
      zh: '同伴反馈的中介模型：理解 → 同意 → 实施，三个环节可以脱钩。反直觉的发现是预测「实施」的是「理解」而非「同意」——新手写作者不确定该不该同意时，会把看懂的都照做。',
      en: 'A mediation model for peer feedback: understanding → agreement → implementation, and the links can break. Counter-intuitively, understanding — not agreement — predicted implementation: novices unsure whether to agree tend to implement whatever they understood.',
    },
    applied: {
      zh: '这是「不同意」必须独立于「忽略」的实证理由：前者是不同意，后者是未实施，混成一个状态就丢了一个变量。也是为什么必须保留「追问」——没看懂的学生需要一个出口，否则会把看不懂的点成采纳。',
      en: 'The empirical reason "disagree" must be separate from "ignore": one is disagreement, the other non-implementation, and merging them loses a variable. It is also why "follow up" must stay — a student who did not understand needs an exit, or will accept what they could not parse.',
    },
  },
  {
    id: 'chi1994',
    authors: 'Chi, M. T. H., de Leeuw, N., Chiu, M.-H., & LaVancher, C.',
    year: '1994',
    title: 'Eliciting self-explanations improves understanding',
    venue: 'Cognitive Science, 18(3), 439–477',
    doi: '10.1207/s15516709cog1803_3',
    said: {
      zh: '自我解释效应的首个实验证据：让学生边读边向自己解释，能显著提高理解与迁移。解释这一动作本身促进新旧知识的整合。',
      en: 'The first experimental evidence for the self-explanation effect: prompting students to explain material to themselves while reading improves both recall and transfer. The act of explaining integrates new with existing knowledge.',
    },
    applied: {
      zh: '「不同意」时要求学生留下判断的痕迹，依据在此。但形式是点一个标签，不是写一句话——见 Baker 等（2004）与实际数据。',
      en: 'The basis for asking students to leave a trace of judgement when they disagree. The form is a tap on a tag, not a written sentence — see Baker et al. (2004) and the platform\'s own data.',
    },
  },
  {
    id: 'lerner1999',
    authors: 'Lerner, J. S., & Tetlock, P. E.',
    year: '1999',
    title: 'Accounting for the effects of accountability',
    venue: 'Psychological Bulletin, 125(2), 255–275',
    doi: '10.1037/0033-2909.125.2.255',
    said: {
      zh: '综述「说明责任」对判断的影响：只有在**决策前**、面向立场未知的听众时，要求说明理由才会提升思维的整合复杂度；决策后再要求说明，会滑向为既有决定辩护。说明责任并非总是有益。',
      en: 'Reviews how accountability shapes judgement: only pre-decisional accountability to an audience of unknown views raises integrative complexity; post-decisional accountability slides into defending what was already decided. Accountability is not always beneficial.',
    },
    applied: {
      zh: '这条前提直接约束了实现：理由标签在学生点下「不同意」的那一刻出现，并与状态**同一次写入**；后端拒绝「先置为不同意、再补理由」的请求。',
      en: 'This condition constrains the implementation directly: the reason tags appear the moment "disagree" is pressed and are written with the status in a single request; the server rejects setting the status first and adding a reason later.',
    },
  },
  {
    id: 'baker2004',
    authors: 'Baker, R. S., Corbett, A. T., Koedinger, K. R., & Wagner, A. Z.',
    year: '2004',
    title: 'Off-task behavior in the Cognitive Tutor classroom: When students "game the system"',
    venue: 'Proceedings of the SIGCHI Conference on Human Factors in Computing Systems (CHI \'04), 383–390',
    doi: '10.1145/985692.985741',
    said: {
      zh: '「钻系统的空子」：学生利用软件反馈的规律性来通关而非学习——这种行为与学习损失的关联，几乎和其他任何脱离任务的行为一样强。',
      en: '"Gaming the system": students exploit regularities in software feedback to advance without learning — associated with reduced learning about as strongly as any other off-task behaviour.',
    },
    applied: {
      zh: '平台自己的数据印证了这一点：强制填写采纳理由时，16 次插入里 6 次的理由在四字以内（「没有」「没有理由」）。于是把必填的自由文本改成点选标签，自由文本降为可选——判断痕迹一条没少，垃圾数据没了。',
      en: 'The platform\'s own data confirmed it: with a required written reason, 6 of 16 insertions carried reasons of four characters or fewer ("none", "no reason"). Required free text became a tap on a tag, with free text optional — no loss of judgement data, no more junk.',
    },
  },

  // ── 智能体与人智协作 ─────────────────────────────────────────────
  {
    id: 'amershi2019',
    authors: 'Amershi, S., Weld, D., Vorvoreanu, M., Fourney, A., Nushi, B., Collisson, P., Suh, J., Iqbal, S., Bennett, P. N., Inkpen, K., Teevan, J., Kikin-Gil, R., & Horvitz, E.',
    year: '2019',
    title: 'Guidelines for human-AI interaction',
    venue: 'Proceedings of the 2019 CHI Conference on Human Factors in Computing Systems (CHI \'19), Paper 3',
    doi: '10.1145/3290605.3300233',
    said: {
      zh: '十八条人智交互设计准则，其中与本平台最相关的：说清系统能做什么、说清它做得有多好、支持高效的纠正、支持高效的忽略、让用户知道为什么系统这样做、随时间从用户行为中学习。',
      en: 'Eighteen guidelines for human-AI interaction. Most relevant here: make clear what the system can do and how well; support efficient correction and efficient dismissal; make clear why the system did what it did; learn from user behaviour over time.',
    },
    applied: {
      zh: '反馈卡显示触发类型的中文名（为什么系统这样做）；收起即忽略（高效忽略）；不同意一键完成（高效纠正）；教师端能看到各类反馈的采纳率（做得有多好）。',
      en: 'Feedback cards name the trigger type in plain language (why it did this); dismissing is one gesture (efficient dismissal); disagreeing is one tap (efficient correction); teachers see acceptance rates by type (how well it does).',
    },
  },
  {
    id: 'horvitz1999',
    authors: 'Horvitz, E.',
    year: '1999',
    title: 'Principles of mixed-initiative user interfaces',
    venue: 'Proceedings of the SIGCHI Conference on Human Factors in Computing Systems (CHI \'99), 159–166',
    doi: '10.1145/302979.303030',
    said: {
      zh: '混合主动性：智能系统主动介入的价值必须与打断成本权衡；系统应在不确定时询问而非擅自行动，把最终决定权留给用户，并允许用户直接操控而绕过自动化。',
      en: 'Mixed initiative: the value of a proactive action must be weighed against the cost of interruption; when uncertain the system should ask rather than act, leave the final decision to the user, and let the user bypass automation.',
    },
    applied: {
      zh: '自动反馈只在打字停顿后触发、冷却 120 秒、草稿变化不足 40 字不重开；Rise Above 讨论室里五个 AI 同学默认只在被 @ 时发言，不主动插话——导出数据显示人智互动量已远超同伴互动，这道闸是给同伴对话让位的。曾经存在的「命中即自动发布」链路已整体删除。',
      en: 'Feedback fires only after a typing pause, with a 120-second cooldown and no re-fire under 40 characters of change; the five AI classmates in the Rise Above room speak only when @-mentioned — export data showed human-AI exchange already outweighing peer exchange, and this gate yields the floor to peers. The former auto-publish chain was removed entirely.',
    },
  },
  {
    id: 'risko2016',
    authors: 'Risko, E. F., & Gilbert, S. J.',
    year: '2016',
    title: 'Cognitive offloading',
    venue: 'Trends in Cognitive Sciences, 20(9), 676–688',
    said: {
      zh: '认知卸载：把认知加工转移到外部工具上是人类的常态，短期提高表现，但会改变人对自身能力的评估，并可能削弱不借助工具时的能力。何时卸载是一个元认知决定。',
      en: 'Cognitive offloading — shifting processing onto external tools — is normal and boosts immediate performance, but alters people\'s assessment of their own abilities and can weaken unaided capacity. When to offload is a metacognitive decision.',
    },
    applied: {
      zh: '这是「AI 只提问不代答」的直接理由。AI 内容进入笔记必须被标记来源（`data-ai-source`），研究编码将其与学生产出分层；插入时必须选一条 GenAI 支架，说明学生把它当案例、当解释、还是当反例——让卸载成为一个有意识的决定。',
      en: 'The direct reason the AI asks rather than answers. AI content entering a note is source-tagged and coded separately from student output; inserting it requires choosing a GenAI scaffold that states whether the student treats it as example, explanation or counter-example — making offloading a conscious decision.',
    },
  },
  {
    id: 'lewis2020',
    authors: 'Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N., Küttler, H., Lewis, M., Yih, W.-t., Rocktäschel, T., Riedel, S., & Kiela, D.',
    year: '2020',
    title: 'Retrieval-augmented generation for knowledge-intensive NLP tasks',
    venue: 'Advances in Neural Information Processing Systems 33 (NeurIPS 2020), 9459–9474',
    url: 'https://proceedings.neurips.cc/paper/2020/file/6b493230205f780e1bc26945df7481e5-Paper.pdf',
    said: {
      zh: '检索增强生成：让语言模型先从外部文档库检索相关片段，再据此生成。相比只靠参数记忆，生成的内容更具体、更符合事实，且来源可追溯。',
      en: 'Retrieval-augmented generation: the model first retrieves relevant passages from an external corpus and then generates conditioned on them. Output is more specific and factual than parametric memory alone, and its sources are traceable.',
    },
    applied: {
      zh: '每门课有一个隔离的知识库：上传的 PDF / Word / Markdown 在后台解析、切块、向量化。笔记侧 AI 回答前先检索本课程材料，并被要求依据检索到的原文作答、无据时明说——降低凭训练记忆臆造的风险。',
      en: 'Each course has an isolated knowledge base: uploaded PDF, Word and Markdown files are parsed, chunked and embedded in the background. The note-side AI retrieves course material before answering and is instructed to ground its answer in what it finds, or say the materials do not cover it.',
    },
  },
  {
    id: 'turing1950',
    authors: 'Turing, A. M.',
    year: '1950',
    title: 'Computing machinery and intelligence',
    venue: 'Mind, 59(236), 433–460',
    said: {
      zh: '以「模仿游戏」代替「机器能否思考」这一问题：由人类裁判通过文字对话判断对方是人还是机器。它把「智能」的判定转化为一个可操作的实验。',
      en: 'Replaces "can machines think?" with the imitation game: a human judge decides through text conversation whether the interlocutor is human or machine, turning the question of intelligence into an operational test.',
    },
    applied: {
      zh: '「图灵测试」课堂活动让学生在不知道对方身份的情况下与人或 AI 对话并作出判断——目的不是测机器，而是让学生亲身体会「看起来合理」和「真的有道理」之间的差距，为后续批判地使用 AI 打底。',
      en: 'The Turing Test classroom activity has students converse without knowing whether the partner is human or AI, then judge. The point is not to test the machine but to let students feel the gap between "sounds plausible" and "is actually sound" before they rely on AI.',
    },
  },

  // ── 计算思维 ─────────────────────────────────────────────────────
  {
    id: 'wing2006',
    authors: 'Wing, J. M.',
    year: '2006',
    title: 'Computational thinking',
    venue: 'Communications of the ACM, 49(3), 33–35',
    doi: '10.1145/1118178.1118215',
    said: {
      zh: '计算思维是一种普适的态度与技能，不只属于计算机科学家：用抽象与分解处理复杂问题，用递归、并行、类型检查等方式思考，兼有数学思维与工程思维。',
      en: 'Computational thinking is a universally applicable attitude and skill set, not only for computer scientists: handling complexity through abstraction and decomposition, thinking recursively and in parallel, drawing on both mathematical and engineering thinking.',
    },
    applied: {
      zh: '支架库里 82 条 CT 类支架（分解、模式识别、抽象、算法设计等话头）；CT 工具页把一个问题拆成可发布为笔记的步骤；编程练习助手让学生用自然语言指挥 AI 写代码并在浏览器里真实运行——评价的是「提示力、读码、调试、迭代」四维，而不是代码本身。',
      en: 'Eighty-two CT scaffolds (decomposition, pattern recognition, abstraction, algorithm design); a CT tool that breaks a problem into publishable steps; a coding coach where students direct an AI in natural language and run the result in the browser — assessed on prompting, reading code, debugging and iterating, not on the code itself.',
    },
  },

  {
    id: 'toulmin1958',
    authors: 'Toulmin, S. E.',
    year: '1958/2003',
    title: 'The uses of argument (updated ed., 2003)',
    venue: 'Cambridge: Cambridge University Press',
    said: {
      zh: '用六个要素替代传统的「前提—结论」来刻画日常论证的结构：主张、依据、保证（把依据连到主张的理由）、支撑、限定语、反驳。一个论证站得住，不只看有没有依据，还看依据凭什么支持主张。',
      en: 'Replaces premise–conclusion with six elements for everyday argument: claim, data, warrant (what licenses the step from data to claim), backing, qualifier, rebuttal. An argument holds not just by having data but by showing why the data supports the claim.',
    },
    applied: {
      zh: '触发类型 T2「缺推理」与 T3「缺证据」分别对应保证与依据的缺失；思维练习助手的「观点擂台」用话语卡把这六个要素变成回合制的动作；「谬误侦探」训练识别保证不成立的情形。',
      en: 'Trigger types T2 "no reasoning" and T3 "no evidence" correspond to a missing warrant and missing data; the thinking coach\'s idea arena turns the six elements into turn-based discourse cards, and fallacy detective trains spotting a warrant that does not hold.',
    },
  },
  {
    id: 'michaels2008',
    authors: 'Michaels, S., O\'Connor, C., & Resnick, L. B.',
    year: '2008',
    title: 'Deliberative discourse idealized and realized: Accountable talk in the classroom and in civic life',
    venue: 'Studies in Philosophy and Education, 27(4), 283–297',
    doi: '10.1007/s11217-007-9071-1',
    said: {
      zh: '可问责谈话的三个维度：对学习社区负责（倾听并在他人贡献之上建构）、对推理标准负责（逻辑连接与合理结论）、对知识负责（以事实、文本或公共信息为据）。',
      en: 'Three dimensions of accountable talk: to the learning community (listen and build on others), to standards of reasoning (logical connections, sound conclusions), and to knowledge (grounded in facts, texts or public information).',
    },
    applied: {
      zh: '这三个维度正是 T4「缺联系」（对社区不负责）、T2「缺推理」（对推理标准不负责）、T3「缺证据」（对知识不负责）的来源之一；Build-on 的六种关系类型也要求每次贡献说明它如何回应他人。',
      en: 'These three dimensions are one source of T4 "no connection" (community), T2 "no reasoning" (standards of reasoning) and T3 "no evidence" (knowledge); the six build-on relation types likewise require every contribution to say how it responds to others.',
    },
  },

  // ── 研究方法 ─────────────────────────────────────────────────────
  {
    id: 'delaat2007',
    authors: 'de Laat, M., Lally, V., Lipponen, L., & Simons, R.-J.',
    year: '2007',
    title: 'Investigating patterns of interaction in networked learning and computer-supported collaborative learning: A role for social network analysis',
    venue: 'International Journal of Computer-Supported Collaborative Learning, 2(1), 87–103',
    doi: '10.1007/s11412-007-9006-4',
    said: {
      zh: '社会网络分析能揭示协作学习中「谁与谁互动」的结构（密度、中心性、子群），但应与内容分析等方法结合使用——结构说明了互动的形状，说明不了互动的质量。',
      en: 'Social network analysis reveals the structure of who interacts with whom in collaborative learning — density, centrality, cliques — but should be combined with content analysis: structure shows the shape of interaction, not its quality.',
    },
    applied: {
      zh: '研究区「网络分析」面板给出 Build-on 网络的这些指标，并与「话语分析」「序列分析」并列，而不是单独下结论。导出的 interactions 数据集每行一条师生/生生/人智互动，可直接进 SNA 软件。',
      en: 'The research area\'s network panel reports these measures for the build-on network alongside discourse and sequence analysis rather than alone. The exported interactions dataset is one row per exchange, ready for SNA software.',
    },
  },
  {
    id: 'bakeman2011',
    authors: 'Bakeman, R., & Quera, V.',
    year: '2011',
    title: 'Sequential analysis and observational methods for the behavioral sciences',
    venue: 'Cambridge: Cambridge University Press',
    said: {
      zh: '观察数据的序列分析方法：如何设计编码方案、训练观察者并检验一致性，以及如何用滞后序列分析判断「某一编码出现后，另一编码紧随其后的概率是否显著高于随机」。',
      en: 'Methods for sequential analysis of observational data: designing coding schemes, training observers and checking reliability, and lag-sequential analysis — whether one code significantly raises the probability of another following it.',
    },
    applied: {
      zh: '研究区「序列分析」面板按此思路计算建构动作之间的转移：例如「质疑」之后是否更可能出现「证据」，「AI 反馈」之后是否更可能出现「修订」。导出的 events 与 interactions 数据集带时间戳，可直接做滞后序列分析。',
      en: 'The research area\'s sequence panel computes transitions between moves this way — e.g. whether "challenge" is more likely followed by "evidence", or "AI feedback" by "revision". Exported events and interactions carry timestamps for lag-sequential analysis.',
    },
  },
  {
    id: 'shaffer2016',
    authors: 'Shaffer, D. W., Collier, W., & Ruis, A. R.',
    year: '2016',
    title: 'A tutorial on epistemic network analysis: Analyzing the structure of connections in cognitive, social, and interaction data',
    venue: 'Journal of Learning Analytics, 3(3), 9–45',
    doi: '10.18608/jla.2016.33.3',
    said: {
      zh: '认识网络分析：把话语中各编码要素在时间窗口内的共现建成网络，比较不同群体的网络结构。它关注的是要素之间**如何连接**，而非各要素出现了多少次。',
      en: 'Epistemic network analysis builds networks from co-occurrences of coded elements within moving windows of discourse and compares network structures across groups. It asks how elements connect, not how often each appears.',
    },
    applied: {
      zh: '研究导出的 notes 数据集带有六种建构关系类型（延伸/澄清/提问/质疑/证据/综合）与话语阶段编码，以及每条笔记的时间戳和会话归属，正是 ENA 所需的输入格式；「质性编码」面板允许研究者在平台内完成编码。',
      en: 'The exported notes dataset carries six relation types (extend, clarify, question, challenge, evidence, synthesise), discourse-phase codes, timestamps and session membership — the inputs ENA needs. The qualitative coding panel lets researchers code inside the platform.',
    },
  },
];

export const PHILOSOPHY_INTRO: Bilingual = {
  zh: '这个页面回答一个问题：平台上的每一项设计，凭什么这样做。每一节先说一条主张，再列出它在界面上落到了哪里，最后给出依据的文献——文献说了什么，我们据此做了什么。所有文献均逐条核对过出处；尚未经同行评议的已单独标出。',
  en: 'This page answers one question: on what grounds is each part of the platform designed the way it is. Each section states a claim, shows where it lands in the interface, and gives the literature behind it — what the paper says, and what we did with it. Every reference has been checked against its source; anything not yet peer-reviewed is marked.',
};

export const PHILOSOPHY_SECTIONS: PhilosophySection[] = [
  {
    id: 'kb',
    num: '01',
    title: { zh: '知识建构：平台的理论基础', en: 'Knowledge Building: the foundation' },
    lead: {
      zh: '平台建立在 Scardamalia 与 Bereiter 的知识建构理论之上。它与「学习」的区别是：学习改变个人的头脑，知识建构改进社区的公共知识。因此这里的基本单位不是作业，而是可以被他人检验、推进和综合的观点。',
      en: 'The platform rests on Scardamalia and Bereiter\'s theory of knowledge building. It differs from learning: learning changes an individual mind, knowledge building improves a community\'s public knowledge. The basic unit here is therefore not an assignment but an idea others can test, extend and synthesise.',
    },
    principles: [
      {
        claim: { zh: '观点是可改进的公共对象', en: 'Ideas are improvable public objects' },
        how: [
          { zh: '一门课是一个知识社区，笔记放在共享画布上，而不是提交给教师。', en: 'A course is one knowledge community; notes live on a shared canvas rather than being handed to the teacher.' },
          { zh: '任何人可以在任何笔记上 Build-on，六种关系类型（延伸、澄清、提问、质疑、证据、综合）说明这次贡献如何推进原来的想法。', en: 'Anyone can build on any note; six relation types (extend, clarify, question, challenge, evidence, synthesise) say how the contribution moves the idea.' },
          { zh: '研究导出把学生产出与 AI 产出分开计数——用于检查过程，不直接衡量知识质量。', en: 'Research exports count student and AI output separately — supporting process inspection without directly measuring knowledge quality.' },
        ],
        refs: ['scardamalia1994', 'scardamalia2006', 'bereiter2002'],
      },
      {
        claim: { zh: '集体认知责任与认知主体性', en: 'Collective cognitive responsibility and epistemic agency' },
        how: [
          { zh: 'AI 反馈的采纳与原 Note 的贡献由学生决定；关联发布还受回应检查和权限约束。', en: 'Students decide on feedback acceptance and Note contribution; linked publication also follows uptake checks and permissions.' },
          { zh: '采纳后先修订原 Note；贡献时检查是否回应反馈，未回应的采纳项可生成同伴可见的关联 Note。', en: 'Revise the original Note after acceptance; contribution-time checks can publish a peer-visible linked Note for an accepted item that remains unaddressed.' },
          { zh: 'View 允许把任何画布的卡片作为传送门放到别处，协作不受固定小组边界限制。', en: 'Views let any canvas\'s card be placed elsewhere as a portal, so collaboration is not bound by fixed groups.' },
          { zh: '教师端「参与公平性」面板检查责任是否集中在少数人身上。', en: 'The equity panel checks whether responsibility concentrates in a few people.' },
        ],
        refs: ['scardamalia2002', 'zhang2009'],
      },
      {
        claim: { zh: '推进有潜力的想法，而不是原地打转', en: 'Advance promising ideas instead of circling' },
        how: [
          { zh: '学生端「潜力想法」按被 Build-on、被标记为有潜力、被作为证据引用三项加权排序。', en: 'The "Promising ideas" panel ranks by build-ons, promising marks and citations as evidence.' },
          { zh: 'Rise Above 讨论室把多条笔记放在一起讨论，形成可继续改进的新解释；系统只并列陈述分歧并提一个问题。', en: 'The Rise Above room brings several notes into one discussion toward a new, improvable account; the system only states disagreements side by side and asks one question.' },
          { zh: '观点图谱与讨论速览是群体层面的形成性反馈：哪些概念在场、谁的问题没人接。它们定位，不综合。', en: 'The idea graph and discussion digest are group-level formative feedback: which concepts are present, whose questions went unanswered. They locate; they do not synthesise.' },
        ],
        refs: ['chen2015', 'resendes2015'],
      },
      {
        claim: { zh: 'Build-on 的六种关系：每次贡献都要说明它如何回应他人', en: 'Six build-on relations: every contribution says how it responds' },
        how: [
          { zh: '在他人笔记上 Build-on 时必须选一种关系：**延伸**（在此基础上发展）、**澄清**（解释或阐明）、**提问**（提出疑问）、**质疑**（提出反驳）、**证据**（提供支持）、**综合**（整合多个观点）。', en: 'Building on a note requires choosing one relation: **extend**, **clarify**, **question**, **challenge**, **evidence**, **synthesise**.' },
          { zh: '这六种是平台把多条文献综合起来形成的操作化框架：直接原型是 Knowledge Forum 的六个基本支架（右侧第一条），再对照 CSCL 三套成熟的话语编码框架校准——每一类都有独立的文献支撑，把它们组合成一套可点选的 Build-on 关系，是平台的一点贡献。', en: 'The six are an operationalisation the platform synthesised from several literatures: Knowledge Forum\'s six basic scaffolds as direct ancestor (first reference), calibrated against three established CSCL discourse-coding frameworks — each type has independent support, and combining them into one selectable set of build-on relations is the platform\'s modest contribution.' },
          { zh: '没有「赞同」「补充一条」这类分享型动作——每一种关系都要求对原想法做点什么，否则讨论停留在知识分享层。', en: 'No sharing-type moves such as "agree" — each relation requires doing something to the idea, or discussion stays at the knowledge-sharing level.' },
          { zh: '关系类型随连线存进 relations 表并进入研究导出，可直接映射到 Weinberger & Fischer 的社会性建构模式或 IAM 的五阶段做编码。', en: 'The relation type is stored with the link and exported, mapping directly onto Weinberger & Fischer\'s social modes or the IAM phases for coding.' },
          { zh: '「质疑」单独成类并用醒目颜色，是因为分歧被建构性处理才产生概念转变；「综合」对应 Rise Above，是知识创造话语的标志。', en: '"Challenge" is its own type in a visible colour because conflict produces conceptual change only when processed constructively; "synthesise" corresponds to Rise Above, the mark of knowledge-creation discourse.' },
        ],
        refs: ['scardamalia2004', 'weinberger2006', 'gunawardena1997', 'vanaalst2009', 'chan1997', 'toulmin1958', 'michaels2008'],
      },
    ],
  },
  {
    id: 'scaffold',
    num: '02',
    title: { zh: '支架：给形式，不给内容', en: 'Scaffolds: shape, not content' },
    lead: {
      zh: '支架帮助学习者完成其独立无法完成的任务——方式是控制超出其当前能力的部分，而不是替他做。平台里的支架永远只给出话头，方括号里必须是学生自己的话。',
      en: 'Scaffolds help learners complete what they cannot yet do alone — by controlling the parts beyond current capacity, never by doing the work. Here a scaffold only ever gives the opening; the brackets must hold the student\'s own words.',
    },
    principles: [
      {
        claim: { zh: '硬支架与软支架互补', en: 'Hard and soft scaffolds complement each other' },
        how: [
          { zh: '支架库 181 条，四类：知识建构（KB）、计算思维（CT）、生成式 AI（GenAI）、Knowledge Forum 默认（TB）。教师可按课程隐藏或补充。', en: 'A library of 181 scaffolds in four categories: KB, CT, GenAI, and Knowledge Forum defaults. Teachers hide or extend per course.' },
          { zh: '笔记里的形态固定为「话头[学生内容]」；研究编码只把方括号内算作学生产出。', en: 'In a note the form is always "prompt[student content]"; only the bracketed part counts as student output.' },
          { zh: 'AI 自动反馈与同伴 Build-on 是软支架——按学生正在写的内容临时给出。', en: 'AI feedback and peer build-ons are soft scaffolds — given in response to what is being written.' },
        ],
        refs: ['wood1976', 'saye2002', 'hannafin1999', 'scardamalia1994'],
      },
      {
        claim: { zh: '减少与思考无关的负荷', en: 'Remove load unrelated to thinking' },
        how: [
          { zh: '「忽略」不设按钮，收起卡片即记录；反馈淡入而不弹出；无待处理反馈时正文下方不摆空框。', en: 'No "ignore" button — dismissing records it; feedback fades in rather than popping up; nothing is shown when nothing is pending.' },
          { zh: '插入 AI 内容从「写理由」降为「选支架」，因为支架本身就说明了以什么方式采纳。', en: 'Inserting AI content takes one scaffold choice instead of a written reason — the scaffold already states how the content is taken up.' },
        ],
        refs: ['sweller1988'],
      },
    ],
  },
  {
    id: 'feedback',
    num: '03',
    title: { zh: 'AI 智能反馈：何时介入、说什么', en: 'AI feedback: when to intervene, what to say' },
    lead: {
      zh: '反馈是影响学习最强的因素之一，但方向可正可负。平台的自动反馈解决两个问题：什么时候该介入（T1–T6 触发分类），以及介入时说什么（承认努力 → 指出空缺 → 一个具体的下一步）。它从不评价学生本人，只评价这条笔记里的推理。',
      en: 'Feedback is among the strongest influences on learning, in either direction. The platform\'s automatic feedback answers two questions: when to intervene (the T1–T6 taxonomy) and what to say (acknowledge → name the gap → one concrete next step). It never evaluates the person, only the reasoning in the note.',
    },
    principles: [
      {
        claim: { zh: '六类触发，各有理论来源', en: 'Six trigger types, each with a theoretical source' },
        how: [
          { zh: 'T1 未消化的 AI 内容 — 大段粘贴的 AI 输出没有学生自己的框定、筛选、批评或应用（ICAP 的「建构」门槛）。', en: 'T1 Undigested AI — pasted output with no framing, selection, critique or application (ICAP\'s constructive threshold).' },
          { zh: 'T2 缺推理 — 有观点没有「为什么」。T3 缺证据 — 强主张没有支撑。T4 缺联系 — 罗列要点却不说明关系，忽略同伴观点。', en: 'T2 No reasoning — a claim without "why". T3 No evidence — a strong claim unsupported. T4 No connection — points listed without relations, peers ignored.' },
          { zh: 'T5 有潜力的想法 — 唯一的正向类型：有洞察但停在半路。T6 表意不清 — 意思不明，或提了真问题却可能无人回应。', en: 'T5 Promising idea — the only positive type: insight that stops short. T6 Unclear — meaning unclear, or a real question at risk of going unanswered.' },
          { zh: '教师可按类型开关；LLM 先判「该不该介入」再判「属于哪类」。', en: 'Teachers toggle by type; the LLM gates first, then classifies.' },
        ],
        refs: ['michaels2008', 'chi2014', 'garrison2000', 'toulmin1958'],
      },
      {
        claim: { zh: '反馈指向任务与下一步，不指向个人', en: 'Feedback addresses the task and the next step, not the person' },
        how: [
          { zh: '模板固定为三步：承认已有努力 → 指出空缺 → 给一个具体的下一步（通常是一个问题）。', en: 'A fixed three-step template: acknowledge effort → name the gap → one concrete next step, usually a question.' },
          { zh: '反馈长度有上限，超出时在句子边界截断——断在句中比短一点更糟。', en: 'Feedback has a length cap and is cut at a sentence boundary — a half sentence is worse than a shorter one.' },
          { zh: '作用对象是开放的知识建构笔记，而不是有标准答案的题目。', en: 'It targets open knowledge-building notes, not tasks with an answer key.' },
        ],
        refs: ['hattie2007', 'deeva2021'],
      },
      {
        claim: { zh: '不打断：时机由学生的节奏决定', en: 'No interruption: timing follows the student\'s rhythm' },
        how: [
          { zh: '只在打字停顿后检查；冷却 120 秒；草稿变化不足 40 字不重开窗口。', en: 'Checks only after a typing pause; 120-second cooldown; no re-fire under 40 characters of change.' },
          { zh: '一次只显示一条待处理反馈，历史进折叠区。', en: 'One pending item at a time; history is folded away.' },
          { zh: '曾经存在的「命中即自动发布为笔记」链路已整体删除——学生没有拒绝的机会，是不可接受的。', en: 'The former chain that auto-published a hit as a note has been removed entirely — a student with no chance to refuse was unacceptable.' },
        ],
        refs: ['horvitz1999', 'carless2018'],
      },
    ],
  },
  {
    id: 'recipience',
    num: '04',
    title: { zh: '学生如何处理反馈：采纳、不同意、追问', en: 'How students handle feedback: accept, disagree, follow up' },
    lead: {
      zh: '文献过度关注「如何给反馈」，却很少研究学生怎样接收它。平台把接收变成一个可观察的决定：三个动作，每一个都有理论依据，每一个都进入研究数据。',
      en: 'The literature over-focuses on giving feedback and neglects how students receive it. The platform makes reception an observable decision: three actions, each grounded, each recorded.',
    },
    principles: [
      {
        claim: { zh: '同意与实施是两件事，所以「不同意」独立于「忽略」', en: 'Agreement and implementation differ, so "disagree" is separate from "ignore"' },
        how: [
          { zh: '采纳 → 生成一条可继续对话的笔记，并连回原笔记。', en: 'Accept → creates a dialogue note linked back to the original.' },
          { zh: '不同意 → 点选一个原因（误解了我的意思 / 我已经考虑过了 / 和我的探究无关 / 我不认同这个判断），可选补充说明。', en: 'Disagree → tap one reason (misread my point / already considered / not my focus / I disagree), with an optional note.' },
          { zh: '追问 → 就地展开对话。这是「没看懂」的出口——否则学生会把看不懂的点成采纳。', en: 'Follow up → opens a dialogue in place. This is the exit for "I did not understand" — otherwise students accept what they could not parse.' },
          { zh: '忽略 → 不是按钮。收起卡片即静默记录。', en: 'Ignore → not a button. Dismissing the card records it silently.' },
        ],
        refs: ['nelson2009', 'winstone2017', 'carless2018'],
      },
      {
        claim: { zh: '留下判断的痕迹，但用点选而不是写句子', en: 'Leave a trace of judgement — by tapping, not writing' },
        how: [
          { zh: '理由标签在点下「不同意」那一刻出现，并与状态同一次写入；服务端拒绝事后补填。', en: 'Reason tags appear the moment "disagree" is pressed and are written with the status; the server rejects adding a reason afterwards.' },
          { zh: '平台数据：强制写理由时，16 次里 6 次是「没有」「没有理由」这类应付。改为标签后，判断痕迹一条没少，垃圾数据没了。', en: 'Platform data: with a required written reason, 6 of 16 were "none" or "no reason". With tags, no judgement data was lost and the junk disappeared.' },
          { zh: '教师端可看到各类反馈的采纳率与不同意原因分布。', en: 'Teachers see acceptance rates by type and the distribution of disagreement reasons.' },
        ],
        refs: ['chi1994', 'lerner1999', 'baker2004', 'amershi2019'],
      },
    ],
  },
  {
    id: 'agents',
    num: '05',
    title: { zh: '智能体与人智协作：AI 是参与者，不是权威', en: 'Agents and human-AI collaboration: a participant, not an authority' },
    lead: {
      zh: '平台上的 AI 以「伙伴」身份出现：它提问、举例、唱反调、查资料，但不下结论，也不替学生写那句更高一层的说法。把认知加工卸载给工具是人的常态；平台要做的是让卸载成为一个有意识的、可追溯的决定。',
      en: 'AI on the platform appears as a partner: it asks, gives examples, plays devil\'s advocate, looks things up — but draws no conclusions and never writes the higher-level statement for the student. Offloading cognition onto tools is normal; the platform\'s job is to make that offloading conscious and traceable.',
    },
    principles: [
      {
        claim: { zh: '混合主动性：系统在不确定时询问，把决定权留给人', en: 'Mixed initiative: ask when uncertain, leave the decision to the person' },
        how: [
          { zh: 'Rise Above 讨论室的五个 AI 同学（刨根问底 / 爱举例子 / 爱唱反调 / 爱查资料 / 记性特别好）默认只在被 @ 时发言。', en: 'The five AI classmates in the Rise Above room speak only when @-mentioned.' },
          { zh: '画布 AI 有「检索课程材料」工具，按需调用，而不是无条件把材料塞进上下文。', en: 'The canvas AI has a search-course-materials tool it calls when needed, rather than injecting everything unconditionally.' },
          { zh: '对话式笔记里的每条 AI 消息都可以「插回原笔记」或「发布为新笔记」——但都由学生点下。', en: 'Each AI message in a dialogue note can be inserted into the source note or published as a new one — always by the student\'s hand.' },
        ],
        refs: ['horvitz1999', 'amershi2019'],
      },
      {
        claim: { zh: '让认知卸载可见、可追溯', en: 'Make cognitive offloading visible and traceable' },
        how: [
          { zh: 'AI 内容进入笔记必须带来源标记；研究编码把它与学生产出分层存储（content_segments）。', en: 'AI content entering a note carries a source tag; research coding stores it in separate segments from student output.' },
          { zh: '插入时必须选一条 GenAI 支架，说明学生把它当案例、当解释还是当反例。', en: 'Insertion requires a GenAI scaffold stating whether the content is treated as example, explanation or counter-example.' },
          { zh: '「图灵测试」活动让学生体会「看起来合理」与「真的有道理」的差距。', en: 'The Turing Test activity lets students feel the gap between "sounds plausible" and "is sound".' },
        ],
        refs: ['risko2016', 'turing1950'],
      },
      {
        claim: { zh: '有据可查：AI 回答先检索课程材料', en: 'Grounded answers: retrieve course material first' },
        how: [
          { zh: '每门课有隔离的知识库；上传的文档在后台解析、切块、向量化。', en: 'Each course has an isolated knowledge base; uploaded documents are parsed, chunked and embedded in the background.' },
          { zh: '笔记侧 AI 回答前先检索，并被要求依据原文作答、无据时明说。', en: 'The note-side AI retrieves before answering and must ground its answer in the text, or say the materials do not cover it.' },
          { zh: '文档阅读页的 AI 助手只读当前这份文档。', en: 'The document reader\'s AI assistant reads only the open document.' },
        ],
        refs: ['lewis2020'],
      },
    ],
  },
  {
    id: 'ct',
    num: '06',
    title: { zh: '计算思维与思维训练', en: 'Computational thinking and thinking practice' },
    lead: {
      zh: '计算思维是普适的态度与技能：用抽象与分解处理复杂问题。平台把它和论证训练放在一起，都是为知识建构话语打底——一个训练把问题拆开，一个训练把理由说清。',
      en: 'Computational thinking is a universal attitude and skill: handling complexity through abstraction and decomposition. The platform pairs it with argumentation practice; both underpin knowledge-building discourse — one trains taking problems apart, the other trains giving reasons.',
    },
    principles: [
      {
        claim: { zh: '评价思维过程，而不是代码', en: 'Assess the thinking, not the code' },
        how: [
          { zh: 'CT 工具把一个问题拆成步骤，每一步可发布为笔记进入社区讨论。', en: 'The CT tool breaks a problem into steps, each publishable as a note into the community.' },
          { zh: '编程练习助手：学生用自然语言指挥 AI 写代码，在浏览器里真实运行；捉虫模式下 AI 只给渐进提示。评价四维：提示力、读码、调试、迭代。', en: 'Coding coach: students direct an AI in natural language and run the result in the browser; in bug-hunt mode the AI gives only graduated hints. Four dimensions: prompting, reading code, debugging, iterating.' },
          { zh: '思维练习助手：谬误侦探、观点擂台、苏格拉底阶梯——话语卡与社区六种 Build-on 关系类型一致。', en: 'Thinking coach: fallacy detective, idea arena, Socratic ladder — its discourse cards match the community\'s six build-on relation types.' },
        ],
        refs: ['wing2006', 'toulmin1958'],
      },
    ],
  },
  {
    id: 'research',
    num: '07',
    title: { zh: '研究方法：平台如何成为研究现场', en: 'Research methods: the platform as a research site' },
    lead: {
      zh: '平台提供教学过程记录与分析工具，帮助教师结合观点内容和互动结构进行反思。活动记录与分析不能单独证明学习成效。',
      en: 'The platform provides process records and analysis tools for reflecting on ideas and interaction. Activity records alone do not establish learning outcomes.',
    },
    principles: [
      {
        claim: { zh: '结构与内容并重', en: 'Structure and content together' },
        how: [
          { zh: '网络分析：Build-on 网络的密度、中心性、跨组连接。', en: 'Network analysis: density, centrality and cross-group links of the build-on network.' },
          { zh: '话语分析：按探究社区四阶段编码；序列分析：建构动作的先后转移；质性编码在平台内完成。', en: 'Discourse analysis by the four CoI phases; sequence analysis of transitions between moves; qualitative coding inside the platform.' },
          { zh: '导出九个零孤儿、可 join 的数据集（笔记、互动、参与者、消息、AI 反馈、事件、修订、求助、课次），每行带参与者匿名编号。', en: 'Nine joinable, orphan-free datasets exported (notes, interactions, participants, messages, AI feedback, events, revisions, support, sessions), each row carrying an anonymised participant id.' },
        ],
        refs: ['delaat2007', 'shaffer2016', 'bakeman2011', 'garrison2000'],
      },
      {
        claim: { zh: '事实与推断分开', en: 'Distinguish records from interpretation' },
        how: [
          { zh: '教学日志里的参与人数、笔记数是数据库统计；文字小结由 AI 生成并标明——两者分开存。', en: 'In the teaching log, participant and note counts come from the database; the written summary is AI-generated and marked as such — stored separately.' },
          { zh: '课程权限决定可见的反馈与记录；分析结果由教师结合课堂情境解释。', en: 'Course permissions govern visible feedback and records; teachers interpret analysis in its classroom context.' },
          { zh: '学生与 AI 的全部对话进入导出——包括被拒绝的反馈及其原因。', en: 'All student-AI dialogue enters the export — including rejected feedback and its reasons.' },
        ],
        refs: ['zhang2009'],
      },
    ],
  },
];
