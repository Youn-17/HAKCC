/**
 * 聊天里的一句话是不是「画一张图」的指令（2026-09-29 用户要求：识别到绘图指令就自动用 DMX 出图，
 * 其余照常用对话模型）。和 api/src/services/drawIntent.ts 是同一份规则（前端不引用后端代码），
 * components/drawIntent.test.ts 核对两边一致。改一边就要改另一边。
 *
 * 只认明确的绘图指令：
 *   - 画 / 绘制 + 量词或「一下」「出」：画一只猫、帮我画个海报、绘制一幅山水；
 *   - 生成 / 做 / 制作 / 创作 / 设计 / 来 / 出 + 量词 + 图一类的名词：生成一张图片、来一张猫的图、做一张海报；
 *   - 生成 / 做 / 制作 + 图一类的名词：生成插画、做配图；
 *   - 英文 draw / sketch / paint / illustrate，或 generate / create / make + image 一类的词。
 * 不认的：
 *   - 问怎么画（怎么画、如何绘制、画图的技巧）；
 *   - 画重点、画线、学生画像、动画这类只是带个「画」字的说法；
 *   - 流程图、思维导图、概念图、图表、柱状图这类要准确文字和结构的图：绘图模型写不好字，交给对话模型用文字讲；
 *   - draw a conclusion / draw attention / draw on 这类英文习语。
 */

const HOW_TO = /(怎么|怎样|如何|咋)\s*(才能|能|去|样)?\s*(画|绘制|绘|生成|做|制作|设计)|画.{0,6}(技巧|步骤|方法|教程|要点)/;
const NOT_A_PICTURE = /(画重点|划重点|画出重点|画线|划线|画勾|画圈|画饼|画像|动画|画布|画面感)/;
const DIAGRAM = /(流程图|思维导图|脑图|概念图|知识图谱|关系图|结构图|框架图|架构图|图表|表格|柱状图|条形图|折线图|饼图|散点图|统计图|甘特图|时间线|时间轴)/;

const PICTURE_NOUN = '(图|图片|图像|插图|插画|配图|海报|漫画|照片|相片|头像|壁纸|图标|logo|素描|水彩|油画|国画|简笔画|示意图|画)';
const MEASURE = '(一|两|三|四|五|几|这|那)?\\s*(个|只|张|幅|副|份|组|套|头|条|匹|朵|棵|座|位)';

const DRAW_VERB = new RegExp(`(画|绘制)\\s*(${MEASURE}|一下|出|个)`);
const MAKE_WITH_MEASURE = new RegExp(`(生成|做|制作|创作|设计|来|出|给我|要)\\s*${MEASURE}[^，。！？!?,.]{0,24}?${PICTURE_NOUN}`, 'i');
const MAKE_NOUN = new RegExp(`(生成|做|制作|创作|设计|绘制)\\s*(一些|一下|些)?\\s*${PICTURE_NOUN}`, 'i');

const EN_IDIOM = /\bdraw(ing|s|n)?\s+(a\s+|the\s+)?(conclusion|attention|on|upon|from|lessons?|comparisons?|distinctions?|the\s+line|a\s+line\s+between|parallels?|inspiration)\b/i;
const EN_DRAW = /\b(draw|sketch|paint|illustrate)\b/i;
const EN_MAKE = /\b(generate|create|make|design|produce|render)\s+(me\s+)?((a|an|some|the)\s+)?([\w-]+\s+){0,4}(image|picture|illustration|poster|drawing|photo|logo|icon|cartoon|comic|wallpaper|avatar)s?\b/i;
const EN_HOW_TO = /\bhow\s+(do|can|should|to|would)\b.{0,20}\b(draw|sketch|paint|illustrate)\b/i;
const EN_DIAGRAM = /\b(flow\s?chart|mind\s?map|concept\s?map|diagram|chart|table|graph|timeline)\b/i;

export interface DrawIntent {
  /** 交给绘图模型的描述：就是学生原话，绘图模型会忽略「帮我画」这类前缀 */
  prompt: string;
}

export function detectDrawIntent(text: string | null | undefined): DrawIntent | null {
  const raw = (text ?? '').trim();
  if (!raw || raw.length > 600) return null;

  if (/[一-龥]/.test(raw)) {
    if (HOW_TO.test(raw) || DIAGRAM.test(raw)) return null;
    // 去掉「画重点」「学生画像」这类词再看：剩下的句子里还有绘图指令才算
    const cleaned = raw.replace(new RegExp(NOT_A_PICTURE.source, 'g'), '');
    if (DRAW_VERB.test(cleaned) || MAKE_WITH_MEASURE.test(cleaned) || MAKE_NOUN.test(cleaned)) return { prompt: raw };
    return null;
  }

  if (EN_HOW_TO.test(raw) || EN_DIAGRAM.test(raw) || EN_IDIOM.test(raw)) return null;
  if (EN_DRAW.test(raw) || EN_MAKE.test(raw)) return { prompt: raw };
  return null;
}
