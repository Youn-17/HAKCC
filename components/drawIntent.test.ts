import { describe, expect, it } from 'vitest';
import { detectDrawIntent, hasDataChartWords, mightRequestDrawing } from './drawIntent';
import {
  detectDrawIntent as backendDetect,
  hasDataChartWords as backendDataChart,
  mightRequestDrawing as backendMight,
} from '../api/src/services/drawIntent';

/** 该识别成绘图指令的 */
const DRAW = [
  '画一只在月球上看书的猫',
  '帮我画个光合作用的示意图',
  '请绘制一幅江南水乡的水彩画',
  '生成一张图片：秋天的银杏树',
  '来一张宇航员骑自行车的图',
  '做一张环保主题的海报',
  '能不能给我画一下细胞分裂的过程',
  '生成插画，主题是人工智能与学习',
  '给我一张猫咪的照片',
  '我要一张熊猫吃竹子的图',
  '画出一只正在飞的鹰',
  'Draw a cat reading a book on the moon',
  'Generate an image of a futuristic classroom',
  'please sketch a tree',
  'Can you create a poster about recycling?',
  // 2026-10-09 起结构图也画：先规划，再由平台按结构画（字不会错）
  '画一张思维导图总结这节课',
  '帮我画一个流程图',
  '画一张我们讨论的观点关系图',
  '画一下这几个观点之间的关系',
  '生成一张时间线：这条笔记是怎么改进的',
  '做一个概念图',
  'Draw a mind map of our discussion',
  'Create a concept map of these notes',
  'please draw a flowchart of the steps',
];

/** 不该触发的：问怎么画、只带个「画」字、要结构和文字的图、英文习语、普通提问 */
const CHAT = [
  '这块画布上讨论到哪了？',
  '帮我画重点',
  '画出重点，列三条',
  '怎么画好一幅画？',
  '如何绘制思维导图',
  '生成一个表格对比两种观点',
  // 要真实数据的图：画出来的数字会是编的
  '画一个柱状图对比两组的笔记数',
  '做一张统计图',
  'Draw a bar chart of the scores',
  'make a table of the results',
  '生成一个学生画像',
  '做一个学习计划',
  '设计一个实验验证这个假设',
  '这幅画表达了什么？',
  '推荐几部动画片',
  '画图有什么技巧',
  'Draw a conclusion from these notes',
  'How do I draw a good picture?',
  'What does this picture mean?',
  'Can you explain the chart?',
  'Please draw on the readings to answer',
  '',
];

describe('聊天里识别绘图指令', () => {
  it.each(DRAW)('画：%s', text => {
    expect(detectDrawIntent(text)).toEqual({ prompt: text.trim() });
  });

  it.each(CHAT)('照常对话：%s', text => {
    expect(detectDrawIntent(text)).toBeNull();
  });

  it('前后端是同一份规则', () => {
    for (const text of [...DRAW, ...CHAT]) {
      expect(backendDetect(text)).toEqual(detectDrawIntent(text));
    }
  });
});

/**
 * 2026-10-09 起要不要画由 Jev 判断（api/src/services/drawJudge.ts），这两个只做预筛：
 * mightRequestDrawing 决定值不值得问 Jev，hasDataChartWords 让带柱状图、饼图的句子门槛更高。
 */
describe('预筛：值不值得问 Jev', () => {
  it('正则认得出的一定放行（预筛只会更宽）', () => {
    for (const text of DRAW) {
      expect(mightRequestDrawing(text), text).toBe(true);
      expect(backendMight(text), text).toBe(true);
    }
  });

  it('换了说法的画图要求也放行，交给 Jev', () => {
    for (const text of ['能把刚才说的几个观点可视化一下吗？', '用一张图帮我理清这些看法之间的关系', '把上面的步骤用流程图表示出来',
      '生成一个小组讨论的场景，大家围着桌子', 'Can you visualize how these ideas connect?']) {
      expect(mightRequestDrawing(text), text).toBe(true);
    }
  });

  it('和图不沾边的直接对话；上一轮刚画了图，什么话都问一下（「颜色淡一点」里没有图字）', () => {
    for (const text of ['总结一下我们刚才的讨论', '能再举一个例子吗？', 'What is retrieval practice?', '']) {
      expect(mightRequestDrawing(text), text).toBe(false);
      expect(backendMight(text), text).toBe(false);
    }
    expect(mightRequestDrawing('颜色淡一点')).toBe(false);
    expect(mightRequestDrawing('颜色淡一点', { afterDrawing: true })).toBe(true);
    expect(backendMight('颜色淡一点', { afterDrawing: true })).toBe(true);
    expect(mightRequestDrawing('', { afterDrawing: true })).toBe(false);
  });

  it('要真实数据的图：前后端一致地认出来；流程图不算', () => {
    const cases: Array<[string, boolean]> = [
      ['画一个饼图，显示全班的观点分布', true], ['Make a bar chart of the posts', true], ['做一张统计图', true],
      ['please draw a flowchart of the steps', false], ['画一张思维导图', false],
    ];
    for (const [text, expected] of cases) {
      expect(hasDataChartWords(text), text).toBe(expected);
      expect(backendDataChart(text), text).toBe(expected);
    }
  });
});
