/**
 * 画布笔记卡的尺寸与字号 —— 单一来源。
 *
 * 尺寸此前硬编码在两处（NoteItem 的 containerStyle 和 Workspace 的连线几何常量）。
 * 两边只要有一边改了，连线就会贴到卡片边框之外。
 *
 * 字号是按 184×126 的旧卡片挤出来的，最小到过 7px。课堂上 52 个学生要长时间读这些卡，
 * 正文低于 12px 已经吃力，8px 只是能看见不是能读。这里定一套下限，
 * 并把卡片放到 200×140 让抬高后的字号放得进去。
 */

/** 标准笔记卡。放大 8.7% × 11%，为可读字号腾出空间。 */
export const STANDARD_NOTE_WIDTH = 200;
export const STANDARD_NOTE_HEIGHT = 140;

/**
 * 手动调整卡片大小的下限。低于这个尺寸标题只剩一行半、署名会被挤掉，
 * 卡片就不再承载信息了。上限与后端 `/notes/:id/position` 的校验保持一致。
 */
export const MIN_NOTE_WIDTH = 140;
/** 色条 4 + 内边距 20 + 一行标题 + 署名行最坏情况，再小就装不下一行标题。 */
export const MIN_NOTE_HEIGHT = 4 + 20 + 28 + 50;   // = 102

/** 其余卡型的尺寸，同样两处共用。 */
export const VIEW_NOTE_WIDTH = 180;
export const VIEW_NOTE_HEIGHT = 100;
export const RISEABOVE_NOTE_WIDTH = 232;
export const RISEABOVE_NOTE_HEIGHT = 132;
export const DRAWING_NOTE_SIZE = 200;
/** 紧凑文件条目卡：宽度随文件名自适应（150–240），这里取估算中值供连线锚定。 */
export const ATTACHMENT_NOTE_WIDTH = 195;
export const ATTACHMENT_NOTE_HEIGHT = 58;

/**
 * 工作台字号梯度（px）。
 * 11px 是下限 —— 再小就只是装饰，不承载信息。
 */
export const NOTE_FONT = {
  /** 卡片标题：卡上唯一的内容（正文只在笔记页里看），所以给到最大 */
  title: 20,
  /** 次级标题（Rise Above 卡等） */
  subtitle: 14,
  /** 作者名 —— 学生认领自己笔记的依据 */
  author: 15,
  /** 时间戳、附件名一类要认出来的短文本 */
  meta: 13,
  /** 计数、建构提示 —— 扫一眼即可，但仍须可读 */
  caption: 11,
  /** 圆点角标里的数字，受 14px 圆点直径限制 */
  dot: 9,
} as const;

/**
 * 标题的行高倍数与整行高度。
 *
 * 卡片能显示几行标题是按高度除以行高算出来的，所以这个数必须和实际渲染
 * 用的行高一致 —— 两边一旦对不上，标题要么压到署名行上，要么白留一片空。
 */
export const NOTE_TITLE_LINE_HEIGHT = 1.4;
export const NOTE_TITLE_LINE_BOX = Math.round(NOTE_FONT.title * NOTE_TITLE_LINE_HEIGHT);   // = 28
