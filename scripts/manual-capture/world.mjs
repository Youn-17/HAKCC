/**
 * 演示课程的数据。
 *
 * 一门「人工智能与学习」课，第 3 周的探究问题是「生成式 AI 会让我们更会思考，还是更少思考？」。
 * 画布上两条线索：AI 与独立思考、AI 算不算「理解」。六种 Build-on 关系都用到了，
 * 有质疑、有证据、有一条综合升华，和手册正文里举的例子一致。
 *
 * 姓名全是虚构的演示数据（手册页脚写明了这一点）。演示学生是「林晓」。
 * 引用的文献只用真实、可查的一篇：Roediger & Karpicke (2006)，Psychological Science 17(3), 249–255。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const NOW = new Date('2026-09-28T10:20:00+08:00');
const ago = (days, hours = 0, minutes = 0) =>
  new Date(NOW.getTime() - ((days * 24 + hours) * 60 + minutes) * 60_000).toISOString();

export const COURSE_ID = '7c0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
export const SPACE_ID = '5b1d2c3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e';
export const GROUP_ID = '3a4b5c6d-7e8f-4a0b-8c1d-2e3f4a5b6c7d';
export const TEACHER_ID = 'u-teacher-liu';
export const ME = { id: 'u-linxiao', name: '林晓', email: 'linxiao@demo.example', role: 'student', status: 'active', school: '教育学部', created_at: ago(40) };

export const PEOPLE = {
  [ME.id]: ME.name,
  'u-chensy': '陈思远',
  'u-wangyt': '王雨桐',
  'u-zhouzh': '周子涵',
  'u-limz': '李明哲',
  'u-zhaoyf': '赵一凡',
  'u-sunjy': '孙佳怡',
  'u-wuhr': '吴浩然',
  [TEACHER_ID]: '刘老师',
};
export const GROUP_MEMBERS = [ME.id, 'u-chensy', 'u-wangyt', 'u-zhouzh', 'u-limz'];

export const COURSE = {
  id: COURSE_ID,
  title: '人工智能与学习',
  instructor_id: TEACHER_ID,
  instructor: '刘老师',
  users: { name: '刘老师' },
  cover_image: null,
  tags: ['知识建构', '生成式 AI'],
  created_at: ago(40),
  verification_code: 'K7Q2',
  studentCount: 32,
  noteCount: 86,
  hasAi: true,
  credit_hours: 2,
  total_weeks: 16,
  start_date: '2026-09-07',
};

export const INQUIRY = '生成式 AI 会让我们更会思考，还是更少思考？';
export const SPACE = {
  id: SPACE_ID,
  title: '第 3 周 · AI 与独立思考',
  description: '围绕本周阅读，提出你的解释，并在同伴的想法上继续推进。',
  inquiry_question: INQUIRY,
  course_id: COURSE_ID,
  group_id: null,
  created_by: TEACHER_ID,
  created_at: ago(9),
};

export const GROUP = {
  id: GROUP_ID,
  name: '第 2 组',
  courseId: COURSE_ID,
  leaderId: 'u-chensy',
  color: '#7C8C9E',
  aiFeedbackCondition: 'treatment',
  createdAt: ago(20),
  memberIds: GROUP_MEMBERS,
  members: GROUP_MEMBERS.map(id => ({ id, name: PEOPLE[id] })),
};

const p = (...lines) => lines.map(l => `<p>${l}</p>`).join('');

/** 画布上的笔记。坐标是世界坐标；卡片默认 240×160，这里统一放大一点方便读标题。 */
const RAW_NOTES = [
  // 线索一：AI 与独立思考
  { id: 'n-01', a: 'u-chensy', t: 'AI 可能让人不愿意自己思考', x: 180, y: 180, d: 6, h: 3,
    c: p('写作业卡住的时候，我的第一反应越来越常是去问 AI，而不是自己再想五分钟。', '答案来得太快，「想」的那一段就被跳过了。我担心时间一长，自己琢磨问题的耐心会变差。') },
  { id: 'n-02', a: 'u-wangyt', t: '不只是懒，是「想」这一步被外包了', x: 560, y: 60, d: 5, h: 20,
    c: p('我同意思远的观察，但我觉得问题不在懒。', '以前卡住时我们会先猜一个答案，再去验证；现在是直接拿到答案。被省掉的恰好是「先猜」这一步，而这一步才是在练思考。') },
  { id: 'n-03', a: 'u-zhouzh', t: '用得好反而逼人多想：AI 答错的地方要自己找出来', x: 560, y: 330, d: 5, h: 8,
    c: p('我不太同意。上周用 AI 做统计题，它有两步算错了，我是自己推了一遍才发现的。', '如果把 AI 的回答当成要检查的对象，而不是标准答案，它反而会逼人多想。') },
  { id: 'n-04', a: 'u-limz', t: '「自己思考」具体指什么？查资料算不算？', x: 940, y: 520, d: 4, h: 22,
    c: p('大家都在说「自己思考」，但这个词好像每个人理解得不一样。', '自己去图书馆查资料算自己思考吗？如果算，那问 AI 和查资料的区别到底在哪？') },
  { id: 'n-05', a: 'u-zhaoyf', t: '检索练习：先自己回想，再看答案，记得更牢', x: 940, y: 60, d: 4, h: 5,
    c: p('补一个证据。Roediger 和 Karpicke 2006 年的实验里，读完材料后做回忆测试的学生，一周后记住的内容明显多于把材料再读几遍的学生。', '这和雨桐说的「先猜」是一回事：自己先提取一遍，记忆才会被加固。直接看 AI 的总结，相当于跳过了提取。') },
  { id: 'n-06', a: 'u-sunjy', t: '我理解的「自己思考」：看到答案之前，先有一个自己的猜测', x: 1320, y: 520, d: 3, h: 6,
    c: p('回应明哲的问题。我觉得判断标准不是「用没用工具」，而是「看到答案之前，自己有没有先形成一个猜测」。', '查资料时我们带着问题去找，心里有预期；直接问 AI 常常是连问题都还没想清楚。') },
  { id: 'n-07', a: ME.id, t: '我试过先写提纲再问 AI，效果不一样', x: 940, y: 300, d: 2, h: 4,
    c: p('接着子涵的思路。这周写读书报告，我先花十分钟写了自己的提纲，再让 AI 给意见。', '和以前直接让它写相比，我能看出它哪里在套话，哪些建议真的对我有用。') },
  { id: 'n-08', a: 'u-zhouzh', t: '先写提纲要花多久？时间紧的时候还做得到吗？', x: 1320, y: 300, d: 1, h: 20,
    c: p('林晓的做法我觉得可行，但想问一下实际花了多少时间。', '赶作业的时候，大家真的会先写提纲吗？') },
  // 线索二：AI 算不算「理解」
  { id: 'n-09', a: 'u-wuhr', t: 'AI 只是在算概率，谈不上理解', x: 180, y: 860, d: 5, h: 2,
    c: p('大语言模型做的事情是根据前文预测下一个词最可能是什么。', '它没有经验，也不知道自己在说什么，所以我认为它谈不上「理解」。') },
  { id: 'n-10', a: 'u-chensy', t: '它答得比人还好，凭什么说它不懂', x: 560, y: 860, d: 4, h: 7,
    c: p('如果只看表现，很多问题它答得比我们好。', '我们判断一个人懂没懂，也是看他能不能解释、能不能用。用同样的标准，为什么到 AI 这里就不算了？') },
  { id: 'n-11', a: 'u-wangyt', t: '我们在用两套标准判断「懂」', x: 940, y: 860, d: 2, h: 3, type: 'riseabove',
    c: p('浩然看的是它内部在做什么，思远看的是它外部表现成什么样。两边都有道理，因为用的是两套判准。', '也许「懂」本来就不是有和没有的问题，而要问「靠什么在懂」：人靠经验和解释，模型靠统计规律。') },
  { id: 'n-12', a: 'u-limz', t: '那「理解」能不能分程度？', x: 1320, y: 860, d: 1, h: 6,
    c: p('雨桐的说法让我想到：理解也许有程度之分。能复述、能解释、能迁移到新问题，是三个不同的层次。', '按这个分法，AI 在哪一层？我们自己又在哪一层？') },
  // 林晓刚存下的草稿：录「AI 自动反馈」时她打开这条接着写
  { id: 'n-13', a: ME.id, t: '用 AI 查资料以后，我记住的反而更少', x: 1320, y: 60, d: 0, h: 0, m: 12,
    c: p('上周写课程论文，我先让 AI 帮我查了三篇文献的要点。交完作业以后，我发现自己几乎说不出其中任何一篇的具体内容。') },
];

/** 课程阅读材料：画布上的附件卡片，双击打开文档阅读页。 */
export const READING = {
  id: 'n-att-1', space_id: SPACE_ID, author_id: TEACHER_ID, type: 'attachment', title: '本周阅读：检索练习导读.md',
  content: '', x: 180, y: 470, tags: [], metadata: { mime_type: 'text/markdown' }, views: [], cited_note_ids: [],
  file_url: '/api/files/demo/reading.md', file_name: '本周阅读：检索练习导读.md', mime_type: 'text/markdown',
  created_at: ago(8), updated_at: ago(8), users: { name: '刘老师' },
};

/** 关系：source 是后写的那条，target 是被建构的那条。 */
const RAW_RELATIONS = [
  ['n-02', 'n-01', 'extend'],
  ['n-03', 'n-01', 'challenge'],
  ['n-04', 'n-03', 'question'],
  ['n-05', 'n-02', 'evidence'],
  ['n-06', 'n-04', 'clarify'],
  ['n-07', 'n-03', 'extend'],
  ['n-08', 'n-07', 'question'],
  ['n-10', 'n-09', 'challenge'],
  ['n-11', 'n-09', 'synthesize'],
  ['n-11', 'n-10', 'synthesize'],
  ['n-12', 'n-11', 'extend'],
];

export function buildNotes() {
  const notes = RAW_NOTES.map(n => ({
    id: n.id,
    space_id: SPACE_ID,
    author_id: n.a,
    type: n.type ?? 'note',
    title: n.t,
    content: n.c,
    x: n.x, y: n.y, width: 300, height: 180,
    tags: [],
    metadata: {},
    views: [],
    cited_note_ids: n.type === 'riseabove' ? ['n-09', 'n-10'] : [],
    rise_above_data: n.type === 'riseabove' ? { sourceNoteIds: ['n-09', 'n-10'] } : undefined,
    created_at: ago(n.d, n.h, n.m ?? 0),
    updated_at: ago(n.d, n.h, n.m ?? 0),
    users: { name: PEOPLE[n.a] },
    // 一天之内发的、演示学生还没打开过：画布卡片上标 New
    seen_by_me: n.d >= 2,
  }));
  notes.push({ ...READING });
  return notes;
}

export function buildRelations() {
  return RAW_RELATIONS.map(([source, target, type], i) => {
    const src = RAW_NOTES.find(n => n.id === source);
    return {
      id: `r-${String(i + 1).padStart(2, '0')}`,
      space_id: SPACE_ID,
      source_note_id: source,
      target_note_id: target,
      relation_type: type,
      creator_id: src.a,
      ai_suggested: false,
      created_at: ago(src.d, src.h),
      users: { name: PEOPLE[src.a] },
    };
  });
}

/** 画布上的两个分区框，演示「绘图」工具。 */
export function buildShapes() {
  const base = { spaceId: SPACE_ID, viewId: null, strokeWidth: 1.5, zIndex: 0, fontSize: 22, fontWeight: 600,
    textAlign: 'left', textValign: 'top', textColor: '#475569', createdBy: TEACHER_ID, createdAt: ago(9) };
  return [
    { ...base, id: 'sh-1', shapeType: 'rect', x: 130, y: 0, width: 1560, height: 760, text: '线索一：AI 与独立思考', fill: 'rgba(148,163,184,0.06)', stroke: '#cbd5e1' },
    { ...base, id: 'sh-2', shapeType: 'rect', x: 130, y: 800, width: 1560, height: 300, text: '线索二：AI 算不算「理解」', fill: 'rgba(148,163,184,0.06)', stroke: '#cbd5e1' },
  ];
}

export function loadScaffolds() {
  const rows = JSON.parse(fs.readFileSync(path.join(HERE, 'scaffolds.json'), 'utf8'));
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    titleEn: r.title_en,
    description: '',
    category: r.category,
    steps: [],
    metadata: r.metadata,
    sortOrder: r.sort_order,
    usageCount: 0,
    isMandatory: false,
    isRecommended: false,
    createdAt: ago(60),
  }));
}

export { ago };
