/**
 * 手册截图与录屏。
 *
 *   1. 用 /api 做接口地址构建一份前端：
 *        VITE_API_URL=/api npx vite build --outDir <dist>
 *   2. 起演示服务：CAPTURE_DIST=<dist> node scripts/manual-capture/server.mjs
 *   3. 录：node scripts/manual-capture/capture.mjs [场景名 …]   （不给就全录）
 *
 * 产物直接写进 public/manual/。换了图就把 components/manual/ManualMedia.tsx 里的 ASSET_V 加一。
 * 浏览器里所有指向 127.0.0.1 以外的请求和 WebSocket 一律拦掉：录制全程不碰线上。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CURSOR_INIT, mouse, typeHuman, sleep } from './cursor.mjs';
import { startRecording, render } from './record.mjs';
import { SCENES } from './scenes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.CAPTURE_BASE ?? 'http://127.0.0.1:5288';
const OUT = path.resolve(process.env.CAPTURE_OUT ?? path.join(HERE, '../../public/manual'));
fs.mkdirSync(OUT, { recursive: true });
const WORK = process.env.CAPTURE_WORK ?? path.join(os.tmpdir(), 'hakcc-manual-capture');
const VIEW = { width: 1440, height: 900 };

async function control(pathname, body = {}) {
  const res = await fetch(`${BASE}/__mock/${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`mock control ${pathname} failed`);
}

async function openPage(browser, { lang = 'zh', local = {}, auth = true } = {}) {
  const ctx = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: 2, locale: lang === 'zh' ? 'zh-CN' : 'en-US', timezoneId: 'Asia/Shanghai', colorScheme: 'light',
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => {
    const u = r.request().url();
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return r.continue();
    return r.abort();
  });
  await ctx.routeWebSocket(/.*/, ws => ws.close());
  await ctx.addInitScript(({ lang, local, auth }) => {
    if (auth) {
      localStorage.setItem('hakcc-access-token', 'demo-local-token');
      localStorage.setItem('hakcc-refresh-token', 'demo-local-refresh');
    }
    localStorage.setItem('hakcc-language', lang);
    localStorage.setItem('theme', 'light');
    localStorage.setItem('hakcc-changelog-seen', 'v1.33');
    for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
  }, { lang, local, auth });
  await ctx.addInitScript(CURSOR_INIT);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('   pageerror:', e.message.slice(0, 200)));
  return { ctx, page };
}

/** 截图：2 倍像素拍，按 clip（CSS 像素）裁，输出宽度 width。 */
async function shot(page, name, { clip, width = 1920 } = {}) {
  const tmp = path.join(WORK, `${name}.png`);
  // 截图里不要合成光标
  await page.evaluate(() => { for (const id of ['__cap-cursor', '__cap-ripple']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; } });
  await page.screenshot({ path: tmp, clip });
  await page.evaluate(() => { for (const id of ['__cap-cursor', '__cap-ripple']) { const el = document.getElementById(id); if (el) el.style.display = ''; } });
  const out = path.join(OUT, `${name}.jpg`);
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(tmp)}).convert('RGB')
w = min(${width}, im.width)
im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
im.save(${JSON.stringify(out)}, quality=88, optimize=True, progressive=True)
print('  shot', ${JSON.stringify(name)}, im.size)
`], { stdio: 'inherit' });
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const only = process.argv.slice(2);
  const browser = await chromium.launch();
  const failures = [];
  for (const scene of SCENES) {
    if (only.length && !only.includes(scene.name)) continue;
    console.log(`▶ ${scene.name}`);
    await control('reset', { role: scene.role ?? 'student' });
    const { ctx, page } = await openPage(browser, scene.page ?? {});
    const m = mouse(page);
    const helpers = { page, m, typeHuman, sleep, BASE, control, shot: (name, opts) => shot(page, name, opts) };
    try {
      if (scene.kind === 'clip') {
        if (scene.prepare) await scene.prepare(helpers);
        const workDir = path.join(WORK, scene.name);
        const rec = await startRecording(page, workDir);
        await scene.run({ ...helpers, cam: rec.cam });
        await rec.stop({ holdEnd: scene.holdEnd ?? 1.5 });
        render(workDir, path.join(OUT, scene.out ?? scene.name), scene.render ?? {});
      } else {
        await scene.run(helpers);
      }
    } catch (err) {
      console.log(`  ✗ ${scene.name}: ${err.message}`);
      await page.screenshot({ path: path.join(WORK, `${scene.name}-error.png`) }).catch(() => {});
      failures.push(scene.name);
    }
    await ctx.close();
  }
  await browser.close();
  if (failures.length) { console.log(`失败：${failures.join(', ')}`); process.exitCode = 1; }
}

main();
