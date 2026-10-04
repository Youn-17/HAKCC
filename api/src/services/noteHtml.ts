import { Worker } from 'node:worker_threads';
import { ApiError } from '../middleware/errorHandler';

/**
 * 笔记正文（notes.content）进库前的消毒，以及服务端拼正文 HTML 用的几个小工具。
 *
 * 正文是作者存的原始 HTML。前端在载入编辑器和显示时会过 DOMPurify，但研究导出、
 * 以后的新界面、第三方工具拿到的是库里的原样，所以每一条写 notes.content 的路径
 * 都先过 sanitizeNoteHtml（routes/noteContentWrites.test.ts 静态检查，漏了测试就挂）。
 *
 * 规则与前端一致：DOMPurify 默认配置 —— 去掉事件处理器、script、iframe、javascript: 链接，
 * 保留 data-*、style、<font color>、img 的 data: 图片、https 链接 —— 另外放行 contenteditable：
 * 编辑器给支架话头和括号写的是 contenteditable="false"，留着它，
 * 编辑器存下来的正文消毒后逐字不变，研究切分（noteSegments）也就不变。
 *
 * 消毒跑在单独的 worker 线程里，带超时和内存上限。jsdom 解析畸形 HTML 最坏是平方级的：
 * 实测 19KB 的嵌套格式标签要 15 秒、2GB 内存。放在主线程，一个学生的一次保存
 * 就能让整个 API 卡住或 OOM；放进 worker，超限只杀 worker，这一条返回 413，别的请求照常。
 */

export interface NoteSanitizerLimits {
  /** 单条正文最多算多久。从 worker 就绪开始计，加载 jsdom 的时间不算在这条正文头上 */
  timeoutMs: number;
  /** worker 多久没就绪就算起不来 */
  startupTimeoutMs: number;
  /** worker 老生代堆上限 */
  heapMb: number;
  /** worker 栈大小。极深的嵌套在序列化时会栈溢出，这一条按 413 处理 */
  stackMb?: number;
  /** 消毒结果最长多少字符。格式元素重建能把 9KB 放大成 1MB，超过请求体上限的不收 */
  maxOutputChars: number;
}

const DEFAULT_LIMITS: NoteSanitizerLimits = {
  timeoutMs: 5_000,
  startupTimeoutMs: 30_000,
  heapMb: 512,
  maxOutputChars: 8_000_000,
};

const PURIFY_CONFIG = { ADD_ATTR: ['contenteditable'] };

// worker 以 eval 方式启动：编译后的 dist 和 vitest 跑的 .ts 源码都能用同一段代码。
// 依赖的绝对路径由主线程解析好传进去，eval 出来的 worker 自己按进程 cwd 找模块会找错。
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { JSDOM } = require(workerData.jsdom);
const createDOMPurify = require(workerData.dompurify);
const purify = createDOMPurify(new JSDOM('').window);
parentPort.postMessage({ ready: true });
parentPort.on('message', ({ id, html }) => {
  try {
    parentPort.postMessage({ id, html: purify.sanitize(html, workerData.config) });
  } catch (err) {
    parentPort.postMessage({ id, error: String((err && err.message) || err) });
  }
});
`;

function tooComplex(): ApiError {
  return new ApiError(413, '正文太大或结构过于复杂，没能保存 / Note content is too large or too complex to save');
}

interface Job {
  html: string;
  resolve: (html: string) => void;
  reject: (err: Error) => void;
}

interface WorkerMessage {
  ready?: boolean;
  id?: number;
  html?: string;
  error?: string;
}

export interface NoteSanitizer {
  sanitize(html: string): Promise<string>;
  close(): Promise<void>;
}

export function createNoteSanitizer(overrides: Partial<NoteSanitizerLimits> = {}): NoteSanitizer {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const queue: Job[] = [];
  let worker: Worker | null = null;
  let ready = false;
  let startupTimer: NodeJS.Timeout | null = null;
  let running: (Job & { id: number; timer: NodeJS.Timeout | null }) | null = null;
  let nextId = 0;

  const discardWorker = (): Promise<unknown> => {
    const w = worker;
    worker = null;
    ready = false;
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    return w ? w.terminate() : Promise.resolve();
  };

  const finish = (err: Error | null, html?: string) => {
    const job = running;
    if (!job) return;
    running = null;
    if (job.timer) clearTimeout(job.timer);
    if (err) job.reject(err);
    else job.resolve(html as string);
    pump();
  };

  // 计时从 worker 就绪开始。冷启动加载 jsdom 要几百毫秒到一两秒，算进这条正文的话，
  // 慢机器上会每次都判超时、杀掉 worker、再冷启动，永远存不进去
  const armTimer = () => {
    if (!running || running.timer || !ready) return;
    running.timer = setTimeout(() => {
      // 这条正文让解析器陷进去了：换一个 worker，别让后面排队的保存一起等
      void discardWorker();
      finish(tooComplex());
    }, limits.timeoutMs);
  };

  const startWorker = (): Worker => {
    const w = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        jsdom: require.resolve('jsdom'),
        dompurify: require.resolve('dompurify'),
        config: PURIFY_CONFIG,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: limits.heapMb,
        ...(limits.stackMb ? { stackSizeMb: limits.stackMb } : {}),
      },
    });
    startupTimer = setTimeout(() => {
      if (w !== worker || ready) return;
      console.error('[noteHtml] sanitizer worker did not start in time');
      void discardWorker();
      finish(new Error('note sanitizer did not start in time'));
    }, limits.startupTimeoutMs);
    startupTimer.unref();
    w.on('message', (msg: WorkerMessage) => {
      if (w !== worker) return;
      if (msg.ready) {
        ready = true;
        if (startupTimer) clearTimeout(startupTimer);
        startupTimer = null;
        armTimer();
        return;
      }
      if (!running || msg.id !== running.id) return;
      if (msg.error !== undefined) {
        console.warn('[noteHtml] sanitizer rejected a note body:', msg.error);
        finish(tooComplex());
      } else if ((msg.html ?? '').length > limits.maxOutputChars) {
        finish(tooComplex());
      } else {
        finish(null, msg.html ?? '');
      }
    });
    w.on('error', (err) => {
      if (w !== worker) return;
      // 起不来（依赖缺失之类）是服务端的问题，按 500 报并大声记日志；
      // 起来之后才死（多半是堆超限）算这条正文的问题
      const wasReady = ready;
      console.error('[noteHtml] sanitizer worker crashed:', err.message);
      void discardWorker();
      finish(wasReady ? tooComplex() : new Error(`note sanitizer unavailable: ${err.message}`));
    });
    w.on('exit', (code) => {
      if (w !== worker) return;
      void discardWorker();
      finish(new Error(`note sanitizer exited with code ${code}`));
    });
    return w;
  };

  function pump() {
    if (running) return;
    const job = queue.shift();
    if (!job) {
      // 空闲时不拖住进程退出（测试、平滑重启）
      worker?.unref();
      return;
    }
    if (!worker) worker = startWorker();
    worker.ref();
    running = { ...job, id: ++nextId, timer: null };
    worker.postMessage({ id: running.id, html: job.html });
    armTimer();
  }

  return {
    sanitize(html: string): Promise<string> {
      if (html === '') return Promise.resolve('');
      return new Promise<string>((resolve, reject) => {
        queue.push({ html, resolve, reject });
        pump();
      });
    },
    async close() {
      const pending = queue.splice(0);
      pending.forEach(job => job.reject(new Error('note sanitizer closed')));
      if (running) {
        if (running.timer) clearTimeout(running.timer);
        running.reject(new Error('note sanitizer closed'));
        running = null;
      }
      await discardWorker();
    },
  };
}

const shared = createNoteSanitizer();

/**
 * 笔记正文进库前一律过这里，拿返回值写库、再拿同一个值做内容分层（segmentNoteContent），
 * 这样 content_segments 永远能从库里的正文重算出来。
 */
export function sanitizeNoteHtml(html: string): Promise<string> {
  return shared.sanitize(html);
}

/** 启动时先把 worker 拉起来：第一次保存不必等 jsdom 加载，依赖缺失也能在日志里立刻看到。 */
export async function warmNoteSanitizer(): Promise<void> {
  await shared.sanitize('<p>ok</p>');
}

// ── 服务端拼正文 ──────────────────────────────────────────────────
// 下面几个函数的输出与 HTML 序列化器的写法逐字一致（jsdom/parse5 与浏览器 innerHTML 相同）：
// 文本里只转义 & < >，双引号属性值里只转义 & "，不换行空格写成 &nbsp;，回车统一成 \n，
// 空属性写成 ="" 。这样消毒不会改动服务端生成的正文，内容分层按原样计数 ——
// 以前撇号写成 &#039;，noteSegments 只认 5 个实体，一个撇号会被算成 6 个字。

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function escapeHtmlText(value: string): string {
  return normalizeNewlines(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '&nbsp;');
}

export function escapeHtmlAttr(value: string): string {
  return normalizeNewlines(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/ /g, '&nbsp;');
}

/** 纯文本 → 段落：空行分段，段内换行变 <br>。 */
export function textToHtmlParagraphs(value: string): string {
  return normalizeNewlines(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtmlText(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * 学生把 AI 回复里选中的一段发布成新笔记时的正文。
 * data-ai-source="ai-partner-publication" 让内容分层把整块算成 ai_published，
 * 支架标记「话头[内容]」说明学生把这段 AI 产出当什么用。
 */
export function aiPartnerPublicationHtml(params: {
  selectedText: string;
  adoptionReason: string;
  scaffold: { id: string; title: string } | null;
}): string {
  const { selectedText, adoptionReason, scaffold } = params;
  return [
    '<div data-ai-source="ai-partner-publication" style="border-left:4px solid #22577a;background:#f8fafc;border-radius:8px;padding:10px 12px;margin:4px 0 10px;color:#1e293b;">',
    '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#22577a;margin-bottom:8px;">AI Partner</div>',
    // 支架标记「话头[内容]」：括号里是学生带进来的这段，括号外是课堂给的话头
    scaffold
      ? `<div data-scaffold-id="${escapeHtmlAttr(scaffold.id)}" data-scaffold-l1="GAI" data-scaffold-title="${escapeHtmlAttr(scaffold.title)}" style="margin-bottom:6px;font-size:13px;"><strong data-scaffold-tag="">${escapeHtmlText(scaffold.title)}</strong><span data-scaffold-slot="">[</span></div>`
      : '',
    textToHtmlParagraphs(selectedText),
    scaffold ? '<div data-scaffold-slot="" style="font-size:13px;">]</div>' : '',
    '</div>',
    '<div data-ai-adoption-reason="true" style="border-top:1px solid #e2e8f0;margin-top:10px;padding-top:8px;font-size:12px;line-height:1.6;color:#475569;">',
    `<strong style="color:#334155;">Adoption reason:</strong> ${escapeHtmlText(adoptionReason)}`,
    '</div>',
  ].join('');
}
