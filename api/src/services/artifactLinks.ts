import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 智能体做的网页「在新窗口打开」（2026-10-11 用户：网页可以在浏览器以新的网页打开）。
 *
 * 新标签页带不了 Authorization 头，用户的登录令牌也不该进地址栏；所以给这一个网页签一条只读链接：
 * 只认这个网页 id，几小时后过期。打开时后端用 CSP 的 sandbox 把页面关进匿名源（routes/artifacts.ts），
 * 网页里的脚本拿不到平台的任何登录信息。签名密钥从服务器已有的密钥派生，换用途加了前缀。
 */
export const VIEW_TTL_SECONDS = 6 * 60 * 60;

function viewKey(): Buffer {
  const base = process.env.ARTIFACT_VIEW_SECRET || process.env.AI_CONFIG_ENCRYPTION_KEY || process.env.SUPABASE_JWT_SECRET;
  if (!base) throw new Error('No secret configured for artifact view links');
  return createHmac('sha256', base).update('hakcc-artifact-view-v1').digest();
}

export function signArtifactView(id: string, exp: number): string {
  return createHmac('sha256', viewKey()).update(`${id}.${exp}`).digest('base64url');
}

/** 给前端的相对路径（前端自己拼 API 域名） */
export function artifactViewPath(id: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + VIEW_TTL_SECONDS;
  return `/artifacts/${id}/view?exp=${exp}&sig=${signArtifactView(id, exp)}`;
}

export function verifyArtifactView(id: string, exp: unknown, sig: unknown, nowMs = Date.now()): 'ok' | 'expired' | 'bad' {
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || typeof sig !== 'string' || !sig) return 'bad';
  const expected = Buffer.from(signArtifactView(id, expNum));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'bad';
  return expNum * 1000 < nowMs ? 'expired' : 'ok';
}
