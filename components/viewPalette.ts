/**
 * View 的配色。色值取自全站唯一的莫兰迪色板（见 morandiPalette），
 * 与关系连线同一套调性 —— 视图卡片和连线共处一屏，两套饱和度不同的色板会打架。
 *
 * 颜色由 id 散列而来，不入库：同一个视图在任何设备、任何人眼里都是同一个颜色，
 * 而多存一列就意味着建视图时多一个要决定的东西。
 */
import { MORANDI } from './morandiPalette';

export const VIEW_COLORS = [
  MORANDI.sage,
  MORANDI.dustyBlue,
  MORANDI.ochre,
  MORANDI.mauve,
  MORANDI.lilac,
  MORANDI.clay,
] as const;

/** Welcome 是所有人的主画布，给中性灰蓝，不占用彩色位。 */
export const WELCOME_VIEW_COLOR = MORANDI.stone;

export const WELCOME_VIEW_ID = 'view-welcome';

export function viewColor(viewId: string): string {
  if (viewId === WELCOME_VIEW_ID) return WELCOME_VIEW_COLOR;
  let hash = 0;
  for (let i = 0; i < viewId.length; i++) hash = (hash * 31 + viewId.charCodeAt(i)) >>> 0;
  return VIEW_COLORS[hash % VIEW_COLORS.length];
}
