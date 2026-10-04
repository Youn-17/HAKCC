import { describe, expect, it } from 'vitest';
import { detectDrawIntent } from './drawIntent';
import { detectDrawIntent as backendDetect } from '../api/src/services/drawIntent';

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
];

/** 不该触发的：问怎么画、只带个「画」字、要结构和文字的图、英文习语、普通提问 */
const CHAT = [
  '这块画布上讨论到哪了？',
  '帮我画重点',
  '画出重点，列三条',
  '怎么画好一幅画？',
  '如何绘制思维导图',
  '画一张思维导图总结这节课',
  '帮我画一个流程图',
  '生成一个表格对比两种观点',
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
