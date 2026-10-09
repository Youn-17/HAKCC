import type { PassageForCheck } from '../services/kbCitationCheck';

/**
 * 检验引用核对用的样例（scripts/jevCitationCheck.ts）。资料和回答都是编的，照着平台上的课写：
 * 检索练习、间隔练习、AI 与思考、课程要求。
 */

export const PASSAGES: Record<string, PassageForCheck> = {
  retrieval: {
    n: 1, source: '学习科学导读.pdf · 第三章 检索练习 · 第 42 页',
    text: '实验中，学生先阅读一篇科普短文，随后一组进行检索练习（合上材料，凭记忆写下要点），另一组再读一遍。一周后测验，检索练习组的正确率为 61%，重读组为 40%。Roediger 与 Karpicke（2006）据此指出，检索本身就是一种学习。研究对象为大学生，材料为说明文。',
  },
  howto: {
    n: 2, source: '学习科学导读.pdf · 第三章 检索练习 · 第 45 页',
    text: '提取练习的具体做法：合上书本或笔记，凭记忆写下刚学过的要点；写完后再对照材料，找出遗漏和错误；隔几天再重复一次。',
  },
  spacing: {
    n: 3, source: '学习科学导读.pdf · 第四章 间隔练习 · 第 58 页',
    text: '把练习分散在几天里完成，比在同一天集中完成，在延迟测验中的成绩显著更好。这类在学习时增加难度、却提高长期保持的做法被称为「合意困难」（desirable difficulties），间隔练习和检索练习都属于其中。',
  },
  syllabus: {
    n: 4, source: '课程大纲.docx · 考核方式',
    text: '每位同学每周至少发布 2 条观点笔记，并对同学的笔记做至少 1 次 Build-on。总评构成：讨论参与 30%，小组汇报 30%，期末反思报告 40%。第 5 周进行小组汇报，每组 10 分钟。',
  },
  aiuse: {
    n: 5, source: '课程大纲.docx · AI 使用约定',
    text: '可以使用生成式 AI 查资料、讨论思路。在笔记中引用 AI 的内容时须注明来源，并写出自己的取舍和判断；不能把 AI 的回答直接作为自己的观点发布。',
  },
  kb: {
    n: 6, source: 'Scardamalia2006.pdf · Knowledge Building principles · p. 98',
    text: 'Collective cognitive responsibility: participants take responsibility for the advancement of the community knowledge, not only for their own individual achievement.',
  },
  spacingEn: {
    n: 7, source: 'Cepeda2006.pdf · Abstract · p. 354',
    text: 'Distributed practice led to better retention on delayed tests than massed practice across the studies reviewed.',
  },
};

export interface RelationSample {
  id: string;
  claim: string;
  passage: keyof typeof PASSAGES;
  expect: 'supported' | 'contradicted' | 'unsupported';
  heldOut?: boolean;
  about: string;
}

export const RELATION_SAMPLES: RelationSample[] = [
  { id: 'C01', claim: '检索练习比重新阅读更能提高一周后的记忆成绩', passage: 'retrieval', expect: 'supported', about: '直接支持（数字）' },
  { id: 'C02', claim: '检索练习对小学生同样有效', passage: 'retrieval', expect: 'unsupported', about: '资料只研究大学生' },
  { id: 'C03', claim: '间隔练习的效果不如集中练习', passage: 'spacing', expect: 'contradicted', about: '说反了' },
  { id: 'C04', claim: '提取练习要求先合上材料，从记忆中回想要点', passage: 'howto', expect: 'supported', about: '换个说法的支持' },
  { id: 'C05', claim: 'Roediger 和 Karpicke 在 2006 年的研究认为检索本身就能促进学习', passage: 'retrieval', expect: 'supported', about: '作者和年份' },
  { id: 'C06', claim: '检索练习能减轻考试焦虑', passage: 'retrieval', expect: 'unsupported', about: '资料没说' },
  { id: 'C07', claim: '课程要求每人每周至少发布两条观点笔记', passage: 'syllabus', expect: 'supported', about: '课程要求' },
  { id: 'C08', claim: '讨论参与占总评的一半', passage: 'syllabus', expect: 'contradicted', about: '数字不对（30%）' },
  { id: 'C09', claim: '小组汇报安排在第 5 周，每组 10 分钟', passage: 'syllabus', expect: 'supported', about: '时间安排' },
  { id: 'C10', claim: '可以把 AI 的回答直接复制到笔记里作为自己的观点', passage: 'aiuse', expect: 'contradicted', about: '违反约定' },
  { id: 'C11', claim: '检索练习属于合意困难的一种', passage: 'spacing', expect: 'supported', about: '概念归类' },
  { id: 'C12', claim: '检索练习的效果一天后就消失了', passage: 'retrieval', expect: 'contradicted', about: '资料说一周后仍有差别' },
  { id: 'C13', claim: 'Knowledge building asks students to take responsibility for the community\'s knowledge, not just their own', passage: 'kb', expect: 'supported', about: '英文支持' },
  { id: 'C14', claim: 'Spacing practice makes no difference to long-term retention', passage: 'spacingEn', expect: 'contradicted', about: '英文说反' },
  // 定好题面以后加的
  { id: 'C15', heldOut: true, claim: '写完要点之后还要对照材料，找出漏掉和写错的地方', passage: 'howto', expect: 'supported', about: '步骤细节' },
  { id: 'C16', heldOut: true, claim: '期末反思报告占总评的 40%', passage: 'syllabus', expect: 'supported', about: '数字对' },
  { id: 'C17', heldOut: true, claim: '课程禁止使用生成式 AI', passage: 'aiuse', expect: 'contradicted', about: '说反（允许使用）' },
  { id: 'C18', heldOut: true, claim: '间隔练习最好间隔一周以上', passage: 'spacing', expect: 'unsupported', about: '资料没说间隔多久' },
  { id: 'C19', heldOut: true, claim: '检索练习组和重读组一周后成绩相差约 20 个百分点', passage: 'retrieval', expect: 'supported', about: '要算一下（61−40）' },
  { id: 'C20', heldOut: true, claim: '这项研究使用的材料是数学题', passage: 'retrieval', expect: 'contradicted', about: '材料是说明文' },
  { id: 'C21', heldOut: true, claim: '每位同学都要参加小组汇报', passage: 'aiuse', expect: 'unsupported', about: '引错了段落' },
  { id: 'C22', heldOut: true, claim: '合意困难指的是让学习当下更容易的方法', passage: 'spacing', expect: 'contradicted', about: '定义说反' },
];

export interface UseSample {
  id: string;
  answer: string;
  passage: keyof typeof PASSAGES;
  expectUsed: boolean;
  heldOut?: boolean;
  about: string;
}

const ANSWER_STEPS = '可以这样做检索练习：先合上书本，凭记忆把刚学的要点写下来；写完再翻开材料，对照找出漏掉和写错的地方；过几天再做一次。这样做比反复阅读更费劲，但记得更牢。';
const ANSWER_GRADING = '这门课的总评里，讨论参与占 30%，小组汇报占 30%，期末反思报告占 40%。所以平时在画布上发观点、做 Build-on 很重要。';
const ANSWER_AI = '用 AI 的时候，先自己写下想法，再拿 AI 的回答来对照，看看哪些同意、哪些不同意，并在笔记里写清楚你的判断。这样 AI 是帮你想，而不是替你想。';

export const USE_SAMPLES: UseSample[] = [
  { id: 'U01', answer: ANSWER_STEPS, passage: 'howto', expectUsed: true, about: '步骤来自这段' },
  { id: 'U02', answer: ANSWER_STEPS, passage: 'syllabus', expectUsed: false, about: '和考核无关' },
  { id: 'U03', answer: ANSWER_GRADING, passage: 'syllabus', expectUsed: true, about: '数字来自这段' },
  { id: 'U04', answer: ANSWER_GRADING, passage: 'retrieval', expectUsed: false, about: '和实验无关' },
  { id: 'U05', answer: ANSWER_AI, passage: 'aiuse', expectUsed: true, about: '约定的内容' },
  { id: 'U06', answer: ANSWER_AI, passage: 'spacing', expectUsed: false, about: '和间隔练习无关' },
  { id: 'U07', heldOut: true, answer: ANSWER_STEPS, passage: 'retrieval', expectUsed: false, about: '同一话题但没用到实验数据' },
  { id: 'U08', heldOut: true, answer: 'Spacing your practice over several days helps you remember more on later tests than cramming it into one session.', passage: 'spacingEn', expectUsed: true, about: '英文' },
  { id: 'U09', heldOut: true, answer: '加油！多和同学交流，有问题随时问我。', passage: 'howto', expectUsed: false, about: '一般性鼓励' },
  { id: 'U10', heldOut: true, answer: ANSWER_GRADING, passage: 'aiuse', expectUsed: false, about: '同一份大纲的另一节' },
];
