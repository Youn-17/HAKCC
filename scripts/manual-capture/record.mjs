/**
 * 录制与镜头。
 *
 * 用 CDP 的 Page.startScreencast 按 2 倍像素抓帧（带浏览器自己的时间戳），
 * 场景脚本在关键时刻记镜头关键帧：focus(区域) 推近，wide() 拉回全景。
 * render.py 按时间戳重建 30fps 时间轴，镜头在关键帧之间缓动，
 * 从 2 倍像素的原帧里裁出来再缩到输出尺寸 —— 推近到 2 倍以内都是原生清晰度。
 *
 * 为什么要推镜头：手册里的画框大约 750px 宽，整屏 1440 的界面缩进去字只剩一半大，
 * AI 反馈卡片、对话里的表格根本读不了。镜头跟着动作走，该看清的地方就能看清。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function startRecording(page, workDir) {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(workDir, 'frames'), { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const camera = [];
  const marks = {};
  let n = 0;
  let writing = Promise.resolve();
  const vp = page.viewportSize();
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = path.join(workDir, 'frames', `${String(n++).padStart(6, '0')}.jpg`);
    frames.push({ t: metadata.timestamp, file });
    writing = writing.then(() => fs.promises.writeFile(file, Buffer.from(data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  const now = () => Date.now() / 1000;

  /** 把一个区域（CSS 像素）换成镜头矩形：补成 16:10、不小于半屏、不出画面。 */
  const fit = (r, pad = 24) => {
    let x = r.x - pad, y = r.y - pad, w = r.width + pad * 2, h = r.height + pad * 2;
    const aspect = vp.width / vp.height;
    const minW = vp.width * (r.minScale ?? 0.5);
    if (w < minW) { x -= (minW - w) / 2; w = minW; }
    if (w / h > aspect) { const nh = w / aspect; y -= (nh - h) / 2; h = nh; } else { const nw = h * aspect; x -= (nw - w) / 2; w = nw; }
    if (w > vp.width) { w = vp.width; h = vp.height; }
    x = Math.max(0, Math.min(x, vp.width - w));
    y = Math.max(0, Math.min(y, vp.height - h));
    return { x, y, w, h };
  };

  const cam = {
    /** 推近到一个区域。r 可以是 Playwright locator 或 {x,y,width,height}。 */
    async focus(target, { pad = 28, dur = 0.9, minScale } = {}) {
      const box = typeof target?.boundingBox === 'function' ? await target.boundingBox() : target;
      if (!box) return;
      camera.push({ t: now(), dur, rect: fit({ ...box, minScale }, pad) });
    },
    /** 同时框住几个区域。 */
    async focusAll(targets, opts = {}) {
      const boxes = [];
      for (const t of targets) { const b = typeof t?.boundingBox === 'function' ? await t.boundingBox() : t; if (b) boxes.push(b); }
      if (!boxes.length) return;
      const x1 = Math.min(...boxes.map(b => b.x)), y1 = Math.min(...boxes.map(b => b.y));
      const x2 = Math.max(...boxes.map(b => b.x + b.width)), y2 = Math.max(...boxes.map(b => b.y + b.height));
      await cam.focus({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, opts);
    },
    wide({ dur = 0.9 } = {}) { camera.push({ t: now(), dur, rect: { x: 0, y: 0, w: vp.width, h: vp.height } }); },
    /** 立刻切到某个镜头（片头用）。 */
    async cut(target, opts = {}) { await cam.focus(target, { ...opts, dur: 0 }); },
    mark(name) { marks[name] = now(); },
  };
  cam.wide({ dur: 0 });

  return {
    cam,
    async stop({ holdEnd = 1.2 } = {}) {
      await new Promise(r => setTimeout(r, holdEnd * 1000));
      await cdp.send('Page.stopScreencast').catch(() => {});
      await writing;
      const meta = { viewport: vp, t0, tEnd: now(), frames, camera, marks };
      fs.writeFileSync(path.join(workDir, 'timeline.json'), JSON.stringify(meta));
      return meta;
    },
  };
}

/**
 * 渲染：timeline.json + 帧 → mp4 / webm / 海报。
 * poster: 'end' | 'mark:<name>' | 秒数（相对片头）
 */
export function render(workDir, outStem, { fps = 30, width = 1280, height = 800, poster = 'end', trimStart = 0, speed = 1 } = {}) {
  execFileSync('python3', [path.join(HERE, 'render.py'), workDir, outStem,
    '--fps', String(fps), '--width', String(width), '--height', String(height),
    '--poster', String(poster), '--trim-start', String(trimStart), '--speed', String(speed)], { stdio: 'inherit' });
}
