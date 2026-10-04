/**
 * 录屏里的鼠标和打字。
 *
 * 无头浏览器录下来的画面里没有鼠标。这里往页面注入一个光标元素，它跟着真实的
 * mousemove 事件走 —— page.mouse 移到哪，画面上的光标就在哪，点击位置不会对不上。
 * 按下时有一圈淡淡的波纹，看的人知道这里点了一下。
 */

export const CURSOR_INIT = () => {
  const install = () => {
    if (document.getElementById('__cap-cursor')) return;
    const c = document.createElement('div');
    c.id = '__cap-cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;will-change:transform;transform:translate(-80px,-80px)';
    c.innerHTML = '<svg width="22" height="26" viewBox="0 0 26 30" style="display:block;filter:drop-shadow(0 1.5px 3px rgba(15,23,42,.35))">'
      + '<path d="M2 1 L2 22 L7.5 16.8 L11.5 25.5 L15.2 23.8 L11.3 15.3 L18.6 14.8 Z" fill="#111827" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    const r = document.createElement('div');
    r.id = '__cap-ripple';
    r.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;'
      + 'background:rgba(0,0,128,.16);border:2px solid rgba(0,0,128,.45);opacity:0;transform:translate(-80px,-80px) scale(.4)';
    document.documentElement.appendChild(r);
    document.documentElement.appendChild(c);
    let x = -80, y = -80;
    addEventListener('mousemove', e => { x = e.clientX; y = e.clientY; c.style.transform = `translate(${x - 2}px,${y - 1}px)`; }, true);
    addEventListener('mousedown', () => {
      r.animate([
        { opacity: .9, transform: `translate(${x}px,${y}px) scale(.35)` },
        { opacity: 0, transform: `translate(${x}px,${y}px) scale(1.25)` },
      ], { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' });
    }, true);
  };
  const boot = () => {
    install();
    // 路由切换偶尔会整块替换 body 以外的节点；光标丢了就补回来
    new MutationObserver(() => { if (!document.getElementById('__cap-cursor')) install(); })
      .observe(document.documentElement, { childList: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function mouse(page) {
  let pos = { x: 720, y: 450 };
  return {
    get pos() { return pos; },
    async moveTo(x, y, ms) {
      const from = { ...pos };
      const dist = Math.hypot(x - from.x, y - from.y);
      const dur = ms ?? Math.min(1100, 320 + dist * 0.55);
      const steps = Math.max(8, Math.round(dur / 16));
      for (let i = 1; i <= steps; i++) {
        const k = ease(i / steps);
        await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
        await sleep(dur / steps);
      }
      pos = { x, y };
    },
    async click(x, y, { pause = 180, dbl = false } = {}) {
      await this.moveTo(x, y);
      await sleep(pause);
      if (dbl) await page.mouse.dblclick(x, y); else await page.mouse.click(x, y);
      await sleep(160);
    },
    async clickEl(locator, opts = {}) {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`no box for ${locator}`);
      const x = box.x + box.width * (opts.fx ?? 0.5);
      const y = box.y + box.height * (opts.fy ?? 0.5);
      await this.click(x, y, opts);
      return box;
    },
    async hoverEl(locator, opts = {}) {
      const box = await locator.boundingBox();
      await this.moveTo(box.x + box.width * (opts.fx ?? 0.5), box.y + box.height * (opts.fy ?? 0.5), opts.ms);
      return box;
    },
    async drag(x1, y1, x2, y2, ms = 900) {
      await this.moveTo(x1, y1);
      await page.mouse.down();
      await sleep(120);
      const steps = Math.round(ms / 16);
      for (let i = 1; i <= steps; i++) {
        const k = ease(i / steps);
        await page.mouse.move(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k);
        await sleep(16);
      }
      await page.mouse.up();
      pos = { x: x2, y: y2 };
    },
    async wheel(dy, times = 1, gap = 60) {
      for (let i = 0; i < times; i++) { await page.mouse.wheel(0, dy); await sleep(gap); }
    },
  };
}

/** 按人打字的节奏敲字：字间 45–110ms，标点后多停一下。 */
export async function typeHuman(page, text, { fast = false, newline = 'Enter' } = {}) {
  for (const ch of text) {
    if (ch === '\n') await page.keyboard.press(newline);
    else await page.keyboard.insertText(ch);
    let d = fast ? 18 + Math.random() * 20 : 34 + Math.random() * 40;
    if ('，。？！；：,.?!'.includes(ch)) d += fast ? 70 : 160;
    await sleep(d);
  }
}

export { sleep };
