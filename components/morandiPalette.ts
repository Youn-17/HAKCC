/**
 * 全站莫兰迪基色 —— 唯一一份。
 *
 * 关系连线、视图卡片、角色标签、状态提示都从这里取色。此前 relationColors 和
 * viewPalette 各存了一份同样的六个色值，模态框里又各自散着 blue-600 / emerald-500 /
 * amber-50 / purple-700 —— 同一个"教师"在成员管理里是蓝、在小组管理里是另一种蓝。
 *
 * 低饱和、偏灰，与品牌导航蓝 #000080 共处不打架。
 */
export const MORANDI = {
  sage: '#7BA89D',      // 雾青
  dustyBlue: '#8EAEC4', // 灰蓝
  ochre: '#C9A96E',     // 暖赭
  rose: '#C27C7C',      // 陶红
  lilac: '#9B8BB4',     // 灰紫
  mauve: '#B4869F',     // 藕荷
  clay: '#A89B8C',      // 陶土
  stone: '#94A3B8',     // 中性灰蓝，用于"无状态/未启用"
} as const;

export type MorandiTone = keyof typeof MORANDI;

/**
 * Build-on 六种连线的颜色。不用上面的莫兰迪基色：那六个色明度几乎一样、饱和度都在 20%–45%，
 * 画布上 2px 的线基本分不出来（2026-09 课堂反馈）。算过的口径：
 *   - 两两色差（CIEDE2000）最小 22，原来 10.5；
 *   - 按 Machado 2009 模拟红绿、蓝黄色弱，两两色差仍在 10 以上，原来最低只有 4；
 *   - 对白底对比度都 ≥ 3:1（细线的最低要求），饱和度都 ≤ 80%，不用荧光色和蓝紫。
 * 色相按含义挑：延伸绿、澄清蓝、提问琥珀、质疑砖红、证据青、综合梅紫。
 */
export const RELATION_PALETTE = {
  extend: '#2E7334',     // 森绿
  clarify: '#2A6DB8',    // 钴蓝
  question: '#CC7F2E',   // 琥珀
  challenge: '#C8434A',  // 砖红
  evidence: '#16979C',   // 青
  synthesize: '#8C557F', // 梅紫
} as const;

/** 提醒用的红：画布卡片上的「New」和热帖的火。陶红在白底上太弱，这里要一眼看到。 */
export const SIGNAL_RED = '#D9423A';

/**
 * 「我的」卡片：自己写的笔记浅蓝底，几十张卡里一眼认出自己的（2026-10-05 用户定浅蓝底，不用边线）。
 * 画布底色 #f5f7fb 本身偏灰蓝，这个蓝要比它明显深一档、偏蓝，否则贴上去分不出来。
 * 不用灰：上面 stone 的意思是「无状态/未启用」，灰卡会被读成停用。
 * 类名写成字面量放在这里，Tailwind 才扫得到。
 */
export const MINE_CARD = {
  bg: '#E3ECFB',
  border: '#B9CDF0',
  bgClass: 'bg-[#E3ECFB]',
  borderClass: 'border-[#B9CDF0]',
  /** 名字旁的「我」 */
  tagClass: 'bg-[#D2E0F8] text-[#1E3A8A]',
} as const;

/** 品牌导航蓝在深色模式下的对应色。导航蓝本身在深底上读不出来。 */
export const BRAND_NAVY = '#000080';
export const BRAND_NAVY_DARK = '#93AAFD';

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 主色兑白，返回**不透明**色。底色不能用半透明 —— 一旦背后还叠着别的层，
 * 透上来会层层加浓，9% 的底能显示成 40%。whiteness 越大越淡。
 */
export function shade(hex: string, whiteness: number): string {
  const [r, g, b] = channels(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * whiteness);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** 把主色压向深板岩色，用作淡底上的文字 —— 直接用主色对比度不够。 */
export function ink(hex: string, amount = 0.62): string {
  const [r, g, b] = channels(hex);
  const mix = (c: number, target: number) => Math.round(c + (target - c) * amount);
  return `rgb(${mix(r, 30)}, ${mix(g, 41)}, ${mix(b, 59)})`;
}

/**
 * 标签与徽章：淡底 + 深字 + 中间调边框。任何色调走同一套算法，
 * 不会出现这个标签浅那个标签深。
 */
export function chipStyle(hex: string): React.CSSProperties {
  return {
    backgroundColor: shade(hex, 0.88),
    color: ink(hex, 0.5),
    borderColor: shade(hex, 0.58),
  };
}

/** 实心块：圆点、进度条、开关。 */
export function solidStyle(hex: string): React.CSSProperties {
  return { backgroundColor: hex };
}

/** 提示条：比标签稍强一档，用于成功/失败反馈。 */
export function noticeStyle(hex: string): React.CSSProperties {
  return {
    backgroundColor: shade(hex, 0.9),
    // 0.52 而不是更浅：提示条承载的是「邀请失败」这类必须读清的正文，
    // 淡一档就掉到 4.5:1 以下了。
    color: ink(hex, 0.52),
    borderColor: shade(hex, 0.66),
  };
}

/**
 * 头像回退底色：莫兰迪本色压暗到足以承载白字。
 * 原色在浅的一端（暖赭 #C9A96E）白字对比度不足 2:1，直接用会看不清。
 * 头像出现在成员列表、画布笔记、顶栏、小组面板 —— 它要是另一套饱和色，
 * 整页的克制就白做了。
 */
export const AVATAR_HUES: string[] = [
  MORANDI.sage,
  MORANDI.dustyBlue,
  MORANDI.lilac,
  MORANDI.ochre,
  MORANDI.rose,
  MORANDI.mauve,
  MORANDI.clay,
  MORANDI.stone,
].map(hex => ink(hex, 0.42));
