import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VIEW_TTL_SECONDS, artifactViewPath, signArtifactView, verifyArtifactView } from './artifactLinks';

/** 「在新窗口打开」的签名链接（2026-10-11）：只认这一个网页、几小时后过期、改一个字就不认 */

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let saved: string | undefined;
beforeEach(() => { saved = process.env.ARTIFACT_VIEW_SECRET; process.env.ARTIFACT_VIEW_SECRET = 'test-secret'; });
afterEach(() => { if (saved === undefined) delete process.env.ARTIFACT_VIEW_SECRET; else process.env.ARTIFACT_VIEW_SECRET = saved; });

describe('签名链接', () => {
  it('签出来的链接能用；过期时间是 6 小时后', () => {
    const now = Date.UTC(2026, 9, 11, 3, 0, 0);
    const path = artifactViewPath(ID, now);
    const params = new URL(`https://x${path}`).searchParams;
    expect(path.startsWith(`/artifacts/${ID}/view?`)).toBe(true);
    expect(Number(params.get('exp'))).toBe(Math.floor(now / 1000) + VIEW_TTL_SECONDS);
    expect(verifyArtifactView(ID, params.get('exp'), params.get('sig'), now)).toBe('ok');
  });

  it('过期、改了过期时间、换了网页、签名不对都不认', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signArtifactView(ID, exp);
    expect(verifyArtifactView(ID, exp, sig, (exp + 1) * 1000)).toBe('expired');
    expect(verifyArtifactView(ID, exp + 3600, sig)).toBe('bad');
    expect(verifyArtifactView('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', exp, sig)).toBe('bad');
    expect(verifyArtifactView(ID, exp, `${sig.slice(0, -1)}A`)).toBe('bad');
    expect(verifyArtifactView(ID, 'abc', sig)).toBe('bad');
    expect(verifyArtifactView(ID, exp, undefined)).toBe('bad');
  });
});
