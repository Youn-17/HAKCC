/**
 * 小组 logo（2026-10-11 用户：各组设计了 logo，教师给他们放进去，小组的视图卡片上显示）。
 *
 * 上传前在浏览器里缩到 512 像素以内、转成 PNG：学生给的 logo 常是几 MB 的原图，缩小后传得快，
 * 画布上也足够清楚；SVG 也先画成位图再传，不把可执行的 SVG 放进公开存储（服务端也不收 SVG）。
 */

export const LOGO_MAX_SIDE = 512;
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

export type LogoProblem = 'type' | 'size' | 'decode';

export class LogoError extends Error {
  constructor(public readonly problem: LogoProblem) {
    super(problem);
  }
}

/** 缩到最长边不超过 max，不放大；拿不到尺寸的（个别 SVG）按 max 见方 */
export function fitWithin(width: number, height: number, max = LOGO_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: max, height: max };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 先查类型和大小，不合格的不用解码 */
export function checkLogoFile(file: Pick<File, 'type' | 'size'>): LogoProblem | null {
  if (!file.type.startsWith('image/')) return 'type';
  if (file.size > MAX_INPUT_BYTES) return 'size';
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new LogoError('decode'));
    img.src = src;
  });
}

export async function prepareLogo(file: File): Promise<{ fileName: string; mimeType: 'image/png'; dataUrl: string }> {
  const problem = checkLogoFile(file);
  if (problem) throw new LogoError(problem);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new LogoError('decode');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    const base = file.name.replace(/\.[^.]+$/, '').trim() || 'logo';
    return { fileName: `${base}.png`, mimeType: 'image/png', dataUrl: canvas.toDataURL('image/png') };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function logoErrorText(err: unknown, zh: boolean): string {
  const problem = err instanceof LogoError ? err.problem : null;
  if (problem === 'type') return zh ? '只能用图片（PNG、JPG、WebP、GIF 或 SVG）。' : 'Please use an image (PNG, JPG, WebP, GIF or SVG).';
  if (problem === 'size') return zh ? '图片太大了（超过 15 MB），换一张小一点的。' : 'The image is over 15 MB. Please use a smaller one.';
  if (problem === 'decode') return zh ? '这张图片打不开，换成 PNG 或 JPG 再试。' : 'This image could not be opened. Try a PNG or JPG.';
  return zh ? 'logo 没有上传成功，请再试一次。' : 'The logo was not uploaded. Please try again.';
}
