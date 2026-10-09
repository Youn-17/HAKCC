import type { DiagramSpec } from '../services/diagramRender';
import type { DrawPlan } from '../services/drawPlanner';
import type { DrawAct, DrawForm, PreviousDrawing } from '../services/drawJudge';

/**
 * 检验画图判断用的样例（scripts/jevDrawCheck.ts）。全是编的，不含真实学生的内容。
 * 场景照着平台上的课写：AI 与独立思考、检索练习、小组讨论。
 */

export interface RouteSample {
  id: string;
  text: string;
  previous?: PreviousDrawing;
  lastReply?: string;
  /** 该不该画（新画或改图） */
  expectDraw: boolean;
  /** 画的话：改上一张还是新画；可以接受两种时都写上 */
  expectMode?: Array<'new' | 'edit'>;
  /** 画的话画成哪种；可以接受几种时都写上 */
  expectForm?: DrawForm[];
  /** 不画的话属于哪一类（只作参考，不算对错） */
  expectAct?: DrawAct[];
  /** 定好题面和阈值以后才加的样例：看有没有迁就 */
  heldOut?: boolean;
  about: string;
}

const RELATION_MAP: DiagramSpec = {
  type: 'graph',
  title: 'AI 与独立思考：看法关系图',
  nodes: [
    { id: 'a', label: 'AI 可能让人不愿自己思考' },
    { id: 'b', label: '「想」这一步被外包了' },
    { id: 'c', label: '用得好反而逼人多想' },
    { id: 'd', label: '检索练习实验' },
    { id: 'e', label: '先写提纲再问 AI' },
  ],
  edges: [
    { from: 'b', to: 'a', label: '延伸' },
    { from: 'c', to: 'a', label: '质疑' },
    { from: 'd', to: 'b', label: '证据' },
    { from: 'e', to: 'c', label: '延伸' },
  ],
};

export const PREVIOUS_MAP: PreviousDrawing = {
  request: '画一张我们讨论的观点关系图',
  caption: '根据你们关于 AI 与独立思考的讨论，画了五个看法之间的关系。',
  kind: 'diagram',
  diagram: RELATION_MAP,
};

export const PREVIOUS_PICTURE: PreviousDrawing = {
  request: '画一个先自己想再问 AI 的学生',
  caption: '画了一个先写提纲、再打开电脑问 AI 的学生。',
  kind: 'picture',
  prompt: 'A university student at a desk writing an outline in a notebook before asking an AI on a laptop, clean flat illustration, warm colours, light background',
};

export const ROUTE_SAMPLES: RouteSample[] = [
  // 明说要画
  { id: 'R01', text: '画一只在月球上看书的猫', expectDraw: true, expectMode: ['new'], expectForm: ['picture'], about: '明说要画，画面' },
  { id: 'R02', text: '帮我画个海报，主题是「先想再问 AI」', expectDraw: true, expectMode: ['new'], expectForm: ['picture'], about: '海报' },
  { id: 'R03', text: '画一张我们讨论的观点关系图', expectDraw: true, expectMode: ['new'], expectForm: ['graph'], about: '关系图' },
  { id: 'R04', text: '把这几条笔记做成思维导图', expectDraw: true, expectMode: ['new'], expectForm: ['tree'], about: '思维导图（正则认不出）' },
  { id: 'R05', text: '画个时间线，按顺序列出检索练习的步骤', expectDraw: true, expectMode: ['new'], expectForm: ['timeline'], about: '时间线' },
  { id: 'R06', text: '给我配一张插图，放在笔记开头', expectDraw: true, expectMode: ['new'], expectForm: ['picture'], about: '配图' },
  { id: 'R07', text: '画个比喻图：AI 像拐杖还是像脚手架', expectDraw: true, expectMode: ['new'], expectForm: ['picture'], about: '比喻' },
  { id: 'R08', text: '我想要一张时间线，看看我们小组这几周的讨论是怎么发展的', expectDraw: true, expectMode: ['new'], expectForm: ['timeline'], about: '要一张时间线' },
  // 换了说法：正则认不出
  { id: 'R09', text: '能把刚才说的几个观点可视化一下吗？', expectDraw: true, expectMode: ['new'], expectForm: ['graph', 'tree'], about: '可视化' },
  { id: 'R10', text: '用一张图帮我理清这些看法之间的关系', expectDraw: true, expectMode: ['new'], expectForm: ['graph'], about: '用一张图理清关系' },
  { id: 'R11', text: '把上面的步骤用流程图表示出来', expectDraw: true, expectMode: ['new'], expectForm: ['timeline', 'graph'], about: '流程图表示', lastReply: '检索练习可以分四步：先合上材料；自己回想；再看答案；找出错的地方。' },
  { id: 'R12', text: '有没有办法把这些想法摆在一张图上看？', expectDraw: true, expectMode: ['new'], expectForm: ['graph', 'tree'], about: '摆在一张图上' },
  { id: 'R13', text: 'Can you visualize how these ideas connect?', expectDraw: true, expectMode: ['new'], expectForm: ['graph'], about: 'visualize' },
  // 不是要画
  { id: 'R14', text: '怎么画思维导图比较好？', expectDraw: false, expectAct: ['about_drawing'], about: '问怎么画' },
  { id: 'R15', text: '画一张图需要注意什么？', expectDraw: false, expectAct: ['about_drawing'], about: '问注意什么（正则会误认）' },
  { id: 'R16', text: '我画了一张图，你帮我看看有没有问题', expectDraw: false, expectAct: ['about_drawing'], about: '自己画的图' },
  { id: 'R17', text: '这个关系图里的箭头是什么意思？', expectDraw: false, expectAct: ['about_drawing'], about: '问图的意思' },
  { id: 'R18', text: '图书馆几点关门？', expectDraw: false, expectAct: ['text_answer'], about: '带「图」字的普通问题' },
  { id: 'R19', text: '总结一下我们刚才的讨论', expectDraw: false, expectAct: ['text_answer'], about: '总结' },
  { id: 'R20', text: '请解释一下什么是概念图', expectDraw: false, expectAct: ['about_drawing', 'text_answer'], about: '问概念' },
  { id: 'R21', text: '画重点：这周要读哪几篇？', expectDraw: false, expectAct: ['text_answer'], about: '画重点' },
  { id: 'R22', text: '这张照片说明了什么？', expectDraw: false, expectAct: ['about_drawing'], about: '问照片' },
  { id: 'R23', text: '我试图说明 AI 会削弱思考，但证据不够，怎么补？', expectDraw: false, expectAct: ['text_answer'], about: '「试图」' },
  { id: 'R24', text: '帮我做个表格，列出三种观点的支持者和理由', expectDraw: false, expectAct: ['text_answer', 'data_chart'], about: '文字表格' },
  { id: 'R25', text: 'How do I draw a good concept map?', expectDraw: false, expectAct: ['about_drawing'], about: '英文问怎么画' },
  { id: 'R26', text: "Let's draw a conclusion from these notes", expectDraw: false, expectAct: ['text_answer'], about: '英文习语' },
  // 要数据的图
  { id: 'R27', text: '画一个饼图，显示全班的观点分布', expectDraw: false, expectAct: ['data_chart'], about: '饼图' },
  { id: 'R28', text: '做一张柱状图对比两个小组的笔记数量', expectDraw: false, expectAct: ['data_chart'], about: '柱状图' },
  { id: 'R29', text: '用折线图画出这周每天的发帖数', expectDraw: false, expectAct: ['data_chart'], about: '折线图' },
  { id: 'R30', text: 'Make a bar chart of the posts per week', expectDraw: false, expectAct: ['data_chart'], about: '英文柱状图' },
  // 刚画了关系图之后
  { id: 'R31', text: '把第三个框改成「检索练习」', previous: PREVIOUS_MAP, expectDraw: true, expectMode: ['edit'], expectForm: ['graph'], about: '改一个框' },
  { id: 'R32', text: '再加上小李的观点', previous: PREVIOUS_MAP, expectDraw: true, expectMode: ['edit'], expectForm: ['graph'], about: '加一个观点' },
  { id: 'R33', text: '换成时间线的样子', previous: PREVIOUS_MAP, expectDraw: true, expectMode: ['edit'], expectForm: ['timeline'], about: '换成时间线' },
  { id: 'R34', text: '字太小了，看不清', previous: PREVIOUS_MAP, expectDraw: true, expectMode: ['edit'], expectForm: ['graph'], about: '字太小' },
  { id: 'R35', text: '不对，我要的是思维导图', previous: PREVIOUS_MAP, expectDraw: true, expectMode: ['edit', 'new'], expectForm: ['tree'], about: '要的是思维导图' },
  { id: 'R36', text: '这张图里的箭头是什么意思？', previous: PREVIOUS_MAP, expectDraw: false, expectAct: ['about_drawing'], about: '问刚画的图' },
  { id: 'R37', text: '谢谢，很清楚', previous: PREVIOUS_MAP, expectDraw: false, expectAct: ['text_answer'], about: '道谢' },
  { id: 'R38', text: '那检索练习和间隔重复有什么区别？', previous: PREVIOUS_MAP, expectDraw: false, expectAct: ['text_answer'], about: '接着问问题' },
  { id: 'R39', text: 'Make the boxes bigger', previous: PREVIOUS_MAP, expectDraw: true, expectMode: ['edit'], expectForm: ['graph'], about: '英文改图' },
  // 刚画了画面之后
  { id: 'R40', text: '颜色再淡一点', previous: PREVIOUS_PICTURE, expectDraw: true, expectMode: ['edit'], expectForm: ['picture'], about: '调颜色' },
  { id: 'R41', text: '把学生换成一个女生，背景放在图书馆', previous: PREVIOUS_PICTURE, expectDraw: true, expectMode: ['edit'], expectForm: ['picture'], about: '改人物和背景' },
  { id: 'R42', text: '再画一张，这次画小组一起讨论的场景', previous: PREVIOUS_PICTURE, expectDraw: true, expectMode: ['new', 'edit'], expectForm: ['picture'], about: '再画一张' },
  { id: 'R43', text: '这张图可以放进我的笔记吗？', previous: PREVIOUS_PICTURE, expectDraw: false, expectAct: ['about_drawing', 'text_answer'], about: '问能不能放进笔记' },
  { id: 'R44', text: '好的', previous: PREVIOUS_PICTURE, expectDraw: false, expectAct: ['text_answer'], about: '「好的」' },
  // 定好题面和阈值以后加的：说法更自然、更绕
  { id: 'H01', heldOut: true, text: '帮我把这条笔记的论证结构画出来', expectDraw: true, expectMode: ['new'], expectForm: ['graph', 'tree'], about: '论证结构' },
  { id: 'H02', heldOut: true, text: '能不能整理成一张图，我好放进汇报', expectDraw: true, expectMode: ['new'], about: '整理成一张图' },
  { id: 'H03', heldOut: true, text: '我想看看大家观点之间的联系', expectDraw: false, about: '没说要图（预筛拦下，交给对话）' },
  { id: 'H04', heldOut: true, text: '生成一个小组讨论的场景，大家围着桌子', expectDraw: true, expectMode: ['new'], expectForm: ['picture'], about: '生成场景（没有「图」字）' },
  { id: 'H05', heldOut: true, text: '把我们组的结论做成一页可视化总结', expectDraw: true, expectMode: ['new'], about: '可视化总结' },
  { id: 'H06', heldOut: true, text: '给这个观点配个图吧', expectDraw: true, expectMode: ['new'], expectForm: ['picture', 'graph'], about: '配个图' },
  { id: 'H07', heldOut: true, text: '能用图示的方式解释一下检索练习吗', expectDraw: true, expectMode: ['new'], about: '图示解释' },
  { id: 'H08', heldOut: true, text: '我要做海报，你觉得应该放哪些内容？', expectDraw: false, expectAct: ['text_answer'], about: '问海报放什么（正则会误认）' },
  { id: 'H09', heldOut: true, text: '老师让我们画一张概念图，概念图一般包括哪些部分？', expectDraw: false, expectAct: ['about_drawing', 'text_answer'], about: '问概念图的组成（正则会误认）' },
  { id: 'H10', heldOut: true, text: '生成一张图片：秋天的银杏树', expectDraw: true, expectMode: ['new'], expectForm: ['picture'], about: '明说生成图片' },
  { id: 'H11', heldOut: true, text: 'Summarize our discussion as a diagram', expectDraw: true, expectMode: ['new'], expectForm: ['graph', 'tree'], about: '英文：总结成图' },
  { id: 'H12', heldOut: true, text: '把这周的讨论热度画成趋势图', expectDraw: false, expectAct: ['data_chart'], about: '趋势图（要数据）' },
  { id: 'H13', heldOut: true, text: '统计一下每个人发了几条笔记，画出来', expectDraw: false, expectAct: ['data_chart'], about: '统计后画出来（正则会误认）' },
  { id: 'H14', heldOut: true, text: '画个简单的示意，说明 AI 回答和自己思考的先后', expectDraw: true, expectMode: ['new'], about: '先后示意' },
  { id: 'H15', heldOut: true, text: '你能看懂我上传的这张图吗？', expectDraw: false, expectAct: ['about_drawing'], about: '问上传的图' },
  { id: 'H16', heldOut: true, text: '把小组分工画一下', expectDraw: true, expectMode: ['new'], expectForm: ['tree', 'graph'], about: '分工' },
  { id: 'H17', heldOut: true, text: '图里能不能体现出小王反对的理由', previous: PREVIOUS_MAP, expectDraw: true, expectMode: ['edit'], expectForm: ['graph'], about: '改图：加理由' },
  { id: 'H18', heldOut: true, text: '把箭头上的字去掉', previous: PREVIOUS_MAP, expectDraw: true, expectMode: ['edit'], expectForm: ['graph'], about: '改图：去掉标签' },
  { id: 'H19', heldOut: true, text: '上面那张图挺好的，再帮我解释一下第二个框', previous: PREVIOUS_MAP, expectDraw: false, expectAct: ['about_drawing', 'text_answer'], about: '解释刚画的图' },
  { id: 'H20', heldOut: true, text: '换个风格，水彩的', previous: PREVIOUS_PICTURE, expectDraw: true, expectMode: ['edit'], expectForm: ['picture'], about: '改图：换水彩' },
  { id: 'H21', heldOut: true, text: '能不能画得更像漫画一点', previous: PREVIOUS_PICTURE, expectDraw: true, expectMode: ['edit'], expectForm: ['picture'], about: '改图：更像漫画（正则认不出）' },
  { id: 'H22', heldOut: true, text: '这张图是用什么模型画的？', previous: PREVIOUS_PICTURE, expectDraw: false, expectAct: ['about_drawing'], about: '问用的模型' },
  { id: 'H23', heldOut: true, text: '我觉得 AI 不会让人变懒，关键看怎么用', previous: PREVIOUS_PICTURE, expectDraw: false, expectAct: ['text_answer'], about: '画完之后发表看法' },
  { id: 'H24', heldOut: true, text: '把刚才那张图放大一点，再给每个框配个小图标', previous: PREVIOUS_MAP, expectDraw: true, expectMode: ['edit'], about: '改图：两处改动' },
];

export interface PlanSample {
  id: string;
  heldOut?: boolean;
  request: string;
  previous?: PreviousDrawing;
  plan: DrawPlan;
  expectMatch: boolean;
  about: string;
}

const RETRIEVAL_STEPS = (labels: string[]): DiagramSpec => ({
  type: 'timeline',
  title: '检索练习的步骤',
  nodes: labels.map((label, i) => ({ id: `s${i + 1}`, label })),
  edges: [],
});

export const PLAN_SAMPLES: PlanSample[] = [
  {
    id: 'P01', request: '画一张我们讨论的观点关系图', expectMatch: true, about: '关系图，内容对',
    plan: { kind: 'diagram', diagram: RELATION_MAP, caption: '根据你们关于 AI 与独立思考的讨论，画了五个看法之间的关系。' },
  },
  {
    id: 'P02', request: '画个思维导图，梳理一下检索练习的好处', expectMatch: false, about: '要思维导图，给了画面',
    plan: { kind: 'picture', prompt: 'A student studying at a desk with a laptop and a cup of coffee, clean flat illustration', caption: '画了一个在桌前学习的学生。' },
  },
  {
    id: 'P03', request: '画一张小李和小王观点的关系图', expectMatch: false, about: '点名的两个人都不在图里',
    plan: {
      kind: 'diagram', caption: '画了几种学习方法之间的关系。',
      diagram: { type: 'graph', nodes: [{ id: 'a', label: '间隔重复' }, { id: 'b', label: '睡眠巩固' }, { id: 'c', label: '多感官学习' }], edges: [{ from: 'b', to: 'a', label: '支持' }] },
    },
  },
  {
    id: 'P04', request: '画检索练习的四个步骤', expectMatch: true, about: '四个步骤都在',
    plan: { kind: 'diagram', diagram: RETRIEVAL_STEPS(['先合上材料', '自己回想', '再看答案', '找出错的地方']), caption: '画了检索练习的四个步骤。' },
  },
  {
    id: 'P05', request: '画检索练习的四个步骤', expectMatch: false, about: '要四步只画了两步',
    plan: { kind: 'diagram', diagram: RETRIEVAL_STEPS(['先合上材料', '自己回想']), caption: '画了检索练习的步骤。' },
  },
  {
    id: 'P06', request: '画一只在月球上看书的猫', expectMatch: true, about: '画面，主题对',
    plan: { kind: 'picture', prompt: 'A cat sitting on the surface of the moon reading an open book, Earth in the starry sky behind, clean flat illustration, soft muted colours', caption: '画了一只坐在月球上看书的猫。' },
  },
  {
    id: 'P07', request: '画一只在月球上看书的猫', expectMatch: false, about: '画成了公园里的狗',
    plan: { kind: 'picture', prompt: 'A dog playing with a ball in a sunny park, clean flat illustration', caption: '画了一只在公园玩球的狗。' },
  },
  {
    id: 'P08', request: '颜色再淡一点', previous: PREVIOUS_PICTURE, expectMatch: true, about: '改图：调淡颜色',
    plan: { kind: 'picture', prompt: 'A university student at a desk writing an outline in a notebook before asking an AI on a laptop, clean flat illustration, very soft pastel muted colours, light background', caption: '把颜色调淡了，画面内容不变。' },
  },
  {
    id: 'P09', request: '再加上小李的观点', previous: PREVIOUS_MAP, expectMatch: true, about: '改图：加了小李',
    plan: {
      kind: 'diagram', caption: '在原图上加了小李的看法。',
      diagram: {
        ...RELATION_MAP,
        nodes: [...RELATION_MAP.nodes, { id: 'f', label: 'AI 能帮人发现盲点', detail: '小李' }],
        edges: [...RELATION_MAP.edges, { from: 'f', to: 'c', label: '支持' }],
      },
    },
  },
  {
    id: 'P10', request: '再加上小李的观点', previous: PREVIOUS_MAP, expectMatch: false, about: '改图：没加小李',
    plan: { kind: 'diagram', diagram: RELATION_MAP, caption: '重新画了这张关系图。' },
  },
  {
    id: 'P11', request: '画个时间线，看看我们小组这几周的讨论怎么发展', expectMatch: false, about: '要时间线，给了思维导图',
    plan: {
      kind: 'diagram', caption: '画了小组讨论的主要话题。',
      diagram: { type: 'tree', title: '小组讨论', nodes: [{ id: 'r', label: '小组讨论' }, { id: 'a', label: 'AI 与思考' }, { id: 'b', label: '检索练习' }], edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'b' }] },
    },
  },
  {
    id: 'P12', request: '给我们的讨论画张图', expectMatch: true, about: '没指定种类',
    plan: { kind: 'diagram', diagram: RELATION_MAP, caption: '根据你们的讨论，画了一张看法关系图。' },
  },
  {
    id: 'P13', request: '画个海报，主题是先想再问 AI', expectMatch: true, about: '海报',
    plan: { kind: 'picture', prompt: 'A simple poster with the words "先想再问 AI", a student thinking with a lightbulb above, then typing on a laptop, clean flat style, muted colours', caption: '画了一张「先想再问 AI」的海报。' },
  },
  {
    id: 'P14', request: 'Draw a mind map of the benefits of retrieval practice', expectMatch: true, about: '英文思维导图',
    plan: {
      kind: 'diagram', caption: 'A mind map of the benefits of retrieval practice.',
      diagram: { type: 'tree', title: 'Retrieval practice', nodes: [{ id: 'r', label: 'Retrieval practice' }, { id: 'a', label: 'Better long-term recall' }, { id: 'b', label: 'Shows what you do not know' }, { id: 'c', label: 'Less forgetting' }], edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'b' }, { from: 'r', to: 'c' }] },
    },
  },
  {
    id: 'P15', request: '把这几条笔记做成思维导图', expectMatch: false, about: '要思维导图，给了关系图',
    plan: { kind: 'diagram', diagram: RELATION_MAP, caption: '画了几条笔记之间的关系。' },
  },
  {
    id: 'P16', request: '画一张图说明为什么先想再问 AI 更好', expectMatch: true, about: '说明道理的画面',
    plan: { kind: 'picture', prompt: 'A student first writing their own ideas on paper, then asking an AI on a laptop and comparing the answer with their notes, a lightbulb above, clean flat illustration', caption: '画了一个先写自己的想法、再拿 AI 的回答来对照的学生。' },
  },
  // 定好题面和阈值以后加的
  {
    id: 'Q01', heldOut: true, request: '画一个时间线：我们组这三周的讨论', expectMatch: true, about: '三周都在',
    plan: { kind: 'diagram', diagram: { type: 'timeline', title: '三周的讨论', nodes: [{ id: 'w1', label: '第一周：AI 会不会让人变懒' }, { id: 'w2', label: '第二周：检索练习的证据' }, { id: 'w3', label: '第三周：先想再问的做法' }], edges: [] }, caption: '按周画了你们组三周的讨论。' },
  },
  {
    id: 'Q02', heldOut: true, request: '画关系图，要包括小李、小王、小张三个人的观点', expectMatch: false, about: '点名三人只画了两人',
    plan: { kind: 'diagram', diagram: { type: 'graph', nodes: [{ id: 'a', label: 'AI 能帮人发现盲点', detail: '小李' }, { id: 'b', label: 'AI 让人懒得想', detail: '小王' }], edges: [{ from: 'a', to: 'b', label: '质疑' }] }, caption: '画了小李和小王的观点。' },
  },
  {
    id: 'Q03', heldOut: true, request: '画一张海报，标题写「检索练习」', expectMatch: false, about: '标题写成了英文',
    plan: { kind: 'picture', prompt: 'A clean poster titled "Retrieval Practice" with a student recalling notes from memory, flat illustration, muted colours', caption: '画了一张检索练习的海报。' },
  },
  {
    id: 'Q04', heldOut: true, request: '画一只戴眼镜的猫在图书馆看书', expectMatch: false, about: '漏了眼镜',
    plan: { kind: 'picture', prompt: 'A cat reading a book between tall shelves in a quiet library, clean flat illustration', caption: '画了一只在图书馆看书的猫。' },
  },
  {
    id: 'Q05', heldOut: true, request: '画一张图说明检索练习比重读更好', expectMatch: true, about: '对比的道理',
    plan: { kind: 'diagram', diagram: { type: 'graph', title: '检索练习和重读', nodes: [{ id: 'a', label: '检索练习' }, { id: 'b', label: '重读' }, { id: 'c', label: '一周后记得更多' }, { id: 'd', label: '当下觉得熟，很快忘' }], edges: [{ from: 'a', to: 'c', label: '导致' }, { from: 'b', to: 'd', label: '导致' }] }, caption: '画了检索练习和重读各自带来的结果。' },
  },
  {
    id: 'Q06', heldOut: true, request: '换成时间线', previous: PREVIOUS_MAP, expectMatch: true, about: '改图：换成时间线',
    plan: { kind: 'diagram', diagram: { type: 'timeline', title: '讨论是怎么推进的', nodes: [{ id: 'a', label: 'AI 可能让人不愿自己思考' }, { id: 'b', label: '「想」这一步被外包了' }, { id: 'c', label: '检索练习实验' }, { id: 'd', label: '用得好反而逼人多想' }, { id: 'e', label: '先写提纲再问 AI' }], edges: [] }, caption: '把关系图改成了时间线，按讨论的先后排。' },
  },
  {
    id: 'Q07', heldOut: true, request: '换成时间线', previous: PREVIOUS_MAP, expectMatch: false, about: '改图：还是关系图',
    plan: { kind: 'diagram', diagram: RELATION_MAP, caption: '重新画了这张图。' },
  },
  {
    id: 'Q09', heldOut: true, request: '把上面的步骤用流程图表示出来', expectMatch: true, about: '流程图画成步骤图（上线后发现判错）',
    plan: { kind: 'diagram', diagram: RETRIEVAL_STEPS(['合上材料', '自己回想', '对照答案', '找出错处']), caption: '把上面说的检索练习四步画成了步骤图。' },
  },
  {
    id: 'Q10', heldOut: true, request: '做一个概念图，把这几个概念连起来', expectMatch: true, about: '概念图画成关系图',
    plan: { kind: 'diagram', diagram: RELATION_MAP, caption: '把讨论里的几个看法连成了一张概念图。' },
  },
  {
    id: 'Q08', heldOut: true, request: "Draw a poster that says 'Think first'", expectMatch: true, about: '英文海报',
    plan: { kind: 'picture', prompt: 'A simple poster with the words "Think first" in large letters, a student pausing to think before typing, flat style, muted colours', caption: 'A poster that says "Think first".' },
  },
];
