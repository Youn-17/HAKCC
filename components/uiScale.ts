/**
 * 根字号相对 16px 的倍数。界面文字和间距都是 rem，跟着根字号走；
 * 但侧栏宽度这类以像素记在 state / localStorage 里的尺寸不会自己长，
 * 拿这个倍数乘一下，才不会字大了栏还是老宽度、标签全被截断。
 */
export function uiScale(): number {
  try {
    const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(px) && px > 0 ? px / 16 : 1;
  } catch {
    return 1;
  }
}
