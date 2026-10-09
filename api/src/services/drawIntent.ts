/**
 * 聊天里的一句话是不是「画一张图」的指令（2026-09-29 用户要求：识别到绘图指令就自动用 DMX 出图，
 * 其余照常用对话模型）。前端 components/drawIntent.ts 是同一份规则，drawIntent.test.ts 核对两边一致。
 *
 * 2026-10-09 起，关系图、思维导图、流程图、概念图、时间线也算画图：先规划再画，结构图由平台画、字不会错（drawPlanner、diagramRender）。
 *
 * 只认明确的绘图指令：
 *   - 画 / 绘制 + 量词或「一下」「出」：画一只猫、帮我画个海报、绘制一幅山水；
 *   - 生成 / 做 / 制作 / 创作 / 设计 / 来 / 出 + 量词 + 图一类的名词：生成一张图片、来一张猫的图、做一张海报；
 *   - 生成 / 做 / 制作 + 图一类的名词：生成插画、做配图；
 *   - 英文 draw / sketch / paint / illustrate，或 generate / create / make + image 一类的词。
 * 不认的：
 *   - 问怎么画（怎么画、如何绘制、画图的技巧）；
 *   - 画重点、画线、学生画像、动画这类只是带个「画」字的说法；
 *   - 柱状图、饼图、表格、统计图这类要真实数据的图：画出来的数字会是编的，交给对话模型（教师端另有按真实数据出图的工具）；
 *   - draw a conclusion / draw attention / draw on 这类英文习语。
 */

const HOW_TO = /(怎么|怎样|如何|咋)\s*(才能|能|去|样)?\s*(画|绘制|绘|生成|做|制作|设计)|画.{0,6}(技巧|步骤|方法|教程|要点)/;
const NOT_A_PICTURE = /(画重点|划重点|画出重点|画线|划线|画勾|画圈|画饼|画像|动画|画布|画面感)/;
const DATA_CHART = /(图表|表格|柱状图|条形图|折线图|饼图|散点图|统计图|甘特图|雷达图|热力图)/;

const PICTURE_NOUN = '(图|图片|图像|插图|插画|配图|海报|漫画|照片|相片|头像|壁纸|图标|logo|素描|水彩|油画|国画|简笔画|示意图|画|时间线|时间轴)';
const MEASURE = '(一|两|三|四|五|几|这|那)?\\s*(个|只|张|幅|副|份|组|套|头|条|匹|朵|棵|座|位)';

const DRAW_VERB = new RegExp(`(画|绘制)\\s*(${MEASURE}|一下|出|个)`);
const MAKE_WITH_MEASURE = new RegExp(`(生成|做|制作|创作|设计|来|出|给我|要)\\s*${MEASURE}[^，。！？!?,.]{0,24}?${PICTURE_NOUN}`, 'i');
const MAKE_NOUN = new RegExp(`(生成|做|制作|创作|设计|绘制)\\s*(一些|一下|些)?\\s*${PICTURE_NOUN}`, 'i');

const EN_IDIOM = /\bdraw(ing|s|n)?\s+(a\s+|the\s+)?(conclusion|attention|on|upon|from|lessons?|comparisons?|distinctions?|the\s+line|a\s+line\s+between|parallels?|inspiration)\b/i;
const EN_DRAW = /\b(draw|sketch|paint|illustrate)\b/i;
const EN_MAKE = /\b(generate|create|make|design|produce|render)\s+(me\s+)?((a|an|some|the)\s+)?([\w-]+\s+){0,4}(image|picture|illustration|poster|drawing|photo|logo|icon|cartoon|comic|wallpaper|avatar|diagram|mind\s?map|concept\s?map|flow\s?chart|timeline)s?\b/i;
const EN_HOW_TO = /\bhow\s+(do|can|should|to|would)\b.{0,20}\b(draw|sketch|paint|illustrate)\b/i;
const EN_DATA_CHART = /\b(charts?|tables?|graphs?|histograms?|scatter\s?plots?|spreadsheets?)\b/i;
const EN_FLOWCHART = /\bflow\s?charts?\b/gi;

export interface DrawIntent {
  /** 学生原话：先交给画图规划（drawPlanner）读上下文；规划不可用时直接交给生图模型 */
  prompt: string;
}

export function detectDrawIntent(text: string | null | undefined): DrawIntent | null {
  const raw = (text ?? '').trim();
  if (!raw || raw.length > 600) return null;

  if (/[一-龥]/.test(raw)) {
    if (HOW_TO.test(raw) || DATA_CHART.test(raw)) return null;
    // 去掉「画重点」「学生画像」这类词再看：剩下的句子里还有绘图指令才算
    const cleaned = raw.replace(new RegExp(NOT_A_PICTURE.source, 'g'), '');
    if (DRAW_VERB.test(cleaned) || MAKE_WITH_MEASURE.test(cleaned) || MAKE_NOUN.test(cleaned)) return { prompt: raw };
    return null;
  }

  if (EN_HOW_TO.test(raw) || EN_DATA_CHART.test(raw.replace(EN_FLOWCHART, '')) || EN_IDIOM.test(raw)) return null;
  if (EN_DRAW.test(raw) || EN_MAKE.test(raw)) return { prompt: raw };
  return null;
}

/**
 * 句子里有柱状图、饼图、表格这类要真实数据的词（detectDrawIntent 因此不认）。
 * Jev 判断画图时用它把门槛提高：画出来的数字会是编的（drawJudge.ts）。
 */
export function hasDataChartWords(text: string | null | undefined): boolean {
  const raw = (text ?? '').trim();
  if (!raw) return false;
  return DATA_CHART.test(raw) || EN_DATA_CHART.test(raw.replace(EN_FLOWCHART, ''));
}

/** 和图沾边的字：画、绘、图、可视化、海报、时间线，draw、diagram、visualize…… 宽一点，最后由 Jev 判断 */
const VISUAL_CUE = /(画|绘|图|可视化|海报|漫画|照片|相片|头像|壁纸|素描|水彩|时间线|时间轴|流程|示意|脉络|场景|封面|标志|徽章|吉祥物|表情包|卡通|logo)|\b(draw|drawing|drawn|drew|sketch|paint|illustrat\w*|images?|pictures?|photos?|diagrams?|charts?|graphs?|maps?|mapping|visuali[sz]e|visual|posters?|timelines?|flow\s?charts?|infographics?|cartoons?|comics?|icons?|logos?|avatars?|wallpapers?)\b/i;

/**
 * 值不值得问一下 Jev「是不是要画」：句子里有和图沾边的字，或者上一轮刚画了图（「颜色淡一点」这种改图的话里不一定有）。
 * 都没有就直接对话，省一次请求。detectDrawIntent 认得出的，这里一定是 true。
 */
export function mightRequestDrawing(text: string | null | undefined, opts: { afterDrawing?: boolean } = {}): boolean {
  const raw = (text ?? '').trim();
  if (!raw) return false;
  if (opts.afterDrawing) return true;
  return raw.length <= 600 && VISUAL_CUE.test(raw);
}
