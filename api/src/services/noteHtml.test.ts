import { afterAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import {
  aiPartnerPublicationHtml,
  createNoteSanitizer,
  escapeHtmlAttr,
  escapeHtmlText,
  sanitizeNoteHtml,
  textToHtmlParagraphs,
} from './noteHtml';
import { segmentNoteContent } from './noteSegments';
import { normalizeScaffoldMarkers, scaffoldMarkerHtml, stripScaffoldPlaceholders } from '../../../components/scaffoldLibrary';
import type { Scaffold } from '../../../types';

/**
 * 后端写入笔记正文前的消毒（2026-09 存储型 XSS 加固）。
 *
 * 两件事同样要紧：
 * 1. 恶意 HTML 进不了库 —— 下面「挡住的」一组，每条既查结构也真跑一遍事件；
 * 2. 研究切分不变 —— 编辑器存下的正文消毒后逐字不变；服务端和前端直接拼出来的正文
 *    写法可能不规范（&quot;、空属性），消毒会改字节，但 segments/stats 必须一模一样。
 *    改不了的只有两种，单独列出来并写明原因。
 */

const dom = new JSDOM('');
const { window } = dom;

// jsdom 没有 contentEditable 到属性的反射，编辑器的 normalizeScaffoldMarkers 靠它写 "false"
Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
  configurable: true,
  get(this: Element) { return this.getAttribute('contenteditable') ?? 'inherit'; },
  set(this: Element, value: string) { this.setAttribute('contenteditable', value); },
});

/** 浏览器载入一段 HTML 再存回去（编辑器打开笔记、保存）得到的写法。 */
function browserRoundTrip(html: string): string {
  const div = window.document.createElement('div');
  div.innerHTML = html;
  return div.innerHTML;
}

/** 前端插入 AI 内容时先过一遍默认配置的 DOMPurify，再由浏览器序列化存盘。 */
const frontendPurify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);

/** 切分结果去掉 computedAt（每次调用都不同），其余逐字段比较。 */
function split(html: string) {
  const { segments, stats } = segmentNoteContent(html);
  const { computedAt: _computedAt, ...rest } = stats;
  return { segments, stats: rest };
}

function scaffold(id: string, title: string, titleEn: string, l1: 'TB' | 'KB' | 'CT' | 'GAI'): Scaffold {
  return {
    id, title, titleEn, description: '', category: '', steps: [], metadata: { l1 },
    usageCount: 0, isMandatory: false, isRecommended: false,
  };
}

/**
 * 支架段在编辑器里的完整生命周期：scaffoldMarkerHtml 插入 → normalizeScaffoldMarkers 把话头和括号
 * 设成不可编辑 → 学生在括号里写字 → 保存时 innerHTML 去掉零宽占位符。得到的就是库里存的样子。
 */
function scaffoldAsStored(s: Scaffold, lang: 'zh' | 'en', slotHtml: string, after = ''): string {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, Node: g.Node };
  g.document = window.document;
  g.Node = window.Node;
  try {
    const editor = window.document.createElement('div');
    const tpl = window.document.createElement('template');
    tpl.innerHTML = scaffoldMarkerHtml(s, lang);
    editor.appendChild(tpl.content);
    normalizeScaffoldMarkers(editor as unknown as HTMLElement);
    if (slotHtml) editor.querySelector('[data-scaffold-input]')!.innerHTML = slotHtml;
    editor.insertAdjacentHTML('beforeend', after);
    return stripScaffoldPlaceholders(editor.innerHTML);
  } finally {
    g.document = saved.document;
    g.Node = saved.Node;
  }
}

// 照抄 NoteEditorModal 里 AI 插入块的模板（含它自己的 escapeHtml，会把 ' 写成 &#039;）
function frontendEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function genaiInsertAsStored(params: { scaffold: Scaffold; aiHtml: string; reason: string; plan: string }): string {
  const label = params.scaffold.title;
  const html = `<div data-ai-source="genai" data-scaffold-adopted="${frontendEscape(params.scaffold.id)}" data-source-message-id="${frontendEscape('4b9c2f1e-7a51-4c0e-9d3a-51b8e2f0c7d4')}" data-feedback-id="" data-provider-id="${frontendEscape('dmx')}" data-model="${frontendEscape('deepseek-v4-flash')}" style="margin:10px 0;border:1px solid #cbd5e1;border-left:4px solid #22577a;background:#f8fafc;color:#1e293b;padding:10px 12px;border-radius:8px;"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#475569;"><span style="display:inline-flex;height:18px;align-items:center;border-radius:999px;background:#dbeafe;color:#1e3a8a;padding:0 8px;">AI 来源</span><span>${frontendEscape('DMX')} · ${frontendEscape('deepseek-v4-flash')}</span></div>`
    + `<div data-scaffold-id="${frontendEscape(params.scaffold.id)}" data-scaffold-l1="${frontendEscape('GAI')}" data-scaffold-title="${frontendEscape(label)}" style="margin-bottom:6px;font-size:13px;color:#1e293b;"><strong data-scaffold-tag>${frontendEscape(label)}</strong><span data-scaffold-slot>[</span></div>`
    + `<div style="font-size:14px;line-height:1.75;">${params.aiHtml}</div>`
    + '<div data-scaffold-slot style="font-size:13px;color:#1e293b;">]</div>'
    + `<div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:12px;line-height:1.6;color:#475569;"><strong style="color:#334155;">${frontendEscape('采纳理由')}:</strong> ${frontendEscape(params.reason)}<br><strong style="color:#334155;">${frontendEscape('我打算怎么改')}:</strong> ${frontendEscape(params.plan)}</div></div><p><br></p>`;
  return browserRoundTrip(frontendPurify.sanitize(html));
}

const theory = scaffold('8d0c6a57-3c1e-4c55-9d0e-2b4f7f0a1c11', '我的理论', 'My theory', 'KB');
const genaiCase = scaffold('c3f1d2e4-5a6b-4c7d-8e9f-0a1b2c3d4e5f', 'GenAI 提供的案例是', "GenAI's example & its \"limits\"", 'GAI');
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 编辑器存下来的样子：浏览器序列化过，写法规范。消毒必须逐字不变。 */
const STORED: Record<string, string> = {
  支架段: scaffoldAsStored(
    theory, 'zh',
    '学生认为<strong>光合作用</strong>需要光&nbsp;和"水"，a &lt; b 时 \'反应\' 变慢 &amp; 停止',
    '<p>我自己的补充：<em>这只是猜想</em>。<br>第二行</p>',
  ),
  英文支架段: scaffoldAsStored(genaiCase, 'en', "It's a case where AI's answer &amp; mine differ"),
  空支架段: scaffoldAsStored(theory, 'zh', ''),
  AI插入块: genaiInsertAsStored({
    scaffold: genaiCase,
    aiHtml: "<p>光合作用分两步：</p><ul><li>光反应</li><li>暗反应（卡尔文循环）</li></ul><p>It's <strong>not</strong> that simple &amp; \"it depends\".</p>",
    reason: '和我的"假设"一致 & 有例子',
    plan: "补上 teacher's 反例 <对照组>",
  }) + '<p>插入之后我自己接着写的一句。</p>',
  文件转笔记: '<div data-imported-from="阅读材料-第3周.md"><h2>第三周阅读</h2><p>正文<strong>重点</strong>和<em>斜体</em>，a &lt; b &amp;&amp; c &gt; d。</p>'
    + '<ul><li>要点一</li><li>要点二</li></ul><p><a href="https://example.org/paper?a=1&amp;b=2">原文链接</a></p>'
    + '<pre><code>if (a &lt; b) { return "ok"; }</code></pre></div><p>读后我的想法。</p>',
  富文本: '<h2>第三周小结</h2><p>我同意 <strong>A 同学</strong>的看法，但<em>不完全</em>同意。<br>第二行&nbsp;&nbsp;有两个空格。</p>'
    + '<div>用 div 分的一段</div><blockquote>引用一句话</blockquote>'
    + '<p><font color="#c00000">红色的字</font>和<span style="color: rgb(34, 87, 122); background-color: rgb(255, 242, 204);">着色的字</span>。</p>'
    + `<figure data-note-asset="image" style="margin:12px 0;border:1px solid #dbe3ea;"><img src="${IMAGE}" alt="截图.png" style="display:block;max-width:100%;height:auto;"><figcaption style="margin-top:6px;font-size:12px;">截图.png</figcaption></figure>`
    + `<p><img src="${IMAGE}" alt=""></p>`
    + '<p>参考 <a href="https://www.example.org/a?b=1&amp;c=2">这篇文章</a>。</p><p><br></p>',
  纯文本: '我们三个人的想法可以合起来看：\n\n第一，当 a &lt; b 时结论不同 &amp; 需要证据。\n第二，"再讨论"。',
};

/** 服务端生成的正文：写法与序列化器一致，消毒同样必须逐字不变。 */
const SERVER_GENERATED: Record<string, string> = {
  AI摘录发布: aiPartnerPublicationHtml({
    selectedText: "Photosynthesis isn't one step.\r\n\r\nIt's \"light\" & dark reactions: a < b > c.\n第二行 <script>alert(1)</script>",
    adoptionReason: "It matches my 'hypothesis' & <data> here",
    scaffold: { id: genaiCase.id, title: "GenAI's \"case\" & <example>" },
  }),
  AI摘录发布_无支架: aiPartnerPublicationHtml({ selectedText: '只有正文。\n\n两段。', adoptionReason: '有用', scaffold: null }),
};

/** 前端/服务端直接拼出来、没经过浏览器序列化的正文。写法不规范，消毒会改字节，但切分必须一样。 */
const HAND_BUILT: Record<string, string> = {
  // scaffoldMarkerHtml 原样：空属性没有 =""，空槽里有零宽占位符
  支架段原样: scaffoldMarkerHtml(theory, 'zh', '学生的"话" & 想法'),
  // Workspace 引用成笔记：文本里的 " 写成了 &quot;
  引用成笔记: '<blockquote data-imported-from="读本.pdf"><p>他说 &quot;知识是建构的&quot; 而且 a &lt; b &amp; c</p><cite>引自《读本.pdf》</cite></blockquote><p><br></p>',
  // CT 工具发布：只转义了 <，& 和 > 原样，<br/> 自闭合
  CT解题方案: '<p><em>问题：求 a &lt; b 且 b > c 的解 & 证明</em></p><p><strong>① 问题分解</strong><br/>· 第一步<br/>· 第二步</p><pre>if (a &lt; b) print("x")</pre><p style="color:#888;font-size:12px">—— 来自计算思维工具的解题方案，欢迎建构与改进</p>',
  // 图灵测试反思
  图灵测试反思: '<p><strong>话题：</strong>AI 会取代老师吗</p><blockquote><p><strong>小明（AI）：</strong>我觉得 &quot;不会&quot;</p></blockquote><h3>群聊记录</h3><p style="color:#888;font-size:12px">—— 来自图灵测试活动「第一次」</p>',
};

describe('研究切分不变', () => {
  it.each(Object.entries(STORED))('编辑器存下的正文：%s —— 消毒后逐字不变', async (_name, html) => {
    expect(await sanitizeNoteHtml(html)).toBe(html);
  });

  it.each(Object.entries(SERVER_GENERATED))('服务端生成的正文：%s —— 消毒后逐字不变', async (_name, html) => {
    expect(await sanitizeNoteHtml(html)).toBe(html);
  });

  it.each(Object.entries({ ...STORED, ...SERVER_GENERATED, ...HAND_BUILT }))(
    '%s：消毒前后 segments / stats 完全一致',
    async (_name, html) => {
      expect(split(await sanitizeNoteHtml(html))).toEqual(split(html));
    },
  );

  it.each(Object.entries(HAND_BUILT))('%s：写法不规范，消毒只做浏览器下次保存时也会做的规范化', async (_name, html) => {
    const clean = await sanitizeNoteHtml(html);
    expect(clean).not.toBe(html);
    expect(clean).toBe(browserRoundTrip(html));
  });

  it('样本确实覆盖了研究切分的各个分层', () => {
    const kinds = new Set(
      Object.values({ ...STORED, ...SERVER_GENERATED, ...HAND_BUILT })
        .flatMap(html => segmentNoteContent(html).segments.map(s => s.kind)),
    );
    expect([...kinds].sort()).toEqual(['ai_inserted', 'ai_published', 'imported', 'media', 'plain', 'scaffold'].sort());
    expect(segmentNoteContent(STORED.支架段).stats.scaffoldChars).toBeGreaterThan(0);
    expect(segmentNoteContent(SERVER_GENERATED.AI摘录发布).stats.aiChars).toBeGreaterThan(0);
  });

  it('支架话头和括号上的 contenteditable="false" 留着', async () => {
    expect(STORED.支架段).toContain('contenteditable="false"');
    expect(await sanitizeNoteHtml(STORED.支架段)).toContain('<span data-scaffold-bracket="" contenteditable="false">[</span>');
  });
});

describe('切分会变的两种情况：都是旧数据本身的问题，下一次在编辑器里保存同样会变', () => {
  it('旧的 AI 摘录发布把撇号写成 &#039;，切分按 6 个字算；规范写法按 1 个字算', async () => {
    const legacy = '<div data-ai-source="ai-partner-publication"><p>It&#039;s the AI&#039;s idea</p></div>';
    const clean = await sanitizeNoteHtml(legacy);
    expect(clean).toBe(browserRoundTrip(legacy));
    expect(clean).toBe('<div data-ai-source="ai-partner-publication"><p>It\'s the AI\'s idea</p></div>');
    expect(split(legacy).stats.aiChars - split(clean).stats.aiChars).toBe(10);
    // 现在的生成器直接写规范形式，发布出来就是 1 个字
    expect(aiPartnerPublicationHtml({ selectedText: "It's", adoptionReason: 'x', scaffold: null })).toContain("<p>It's</p>");
  });

  // 线上 2026-09-28 有 4 条笔记是这种结构（编辑器用 DOM 操作把块插进了 <p>）。
  // 这样的字符串谁解析都会先把外层 <p> 关掉，库里的字符串和浏览器看到的结构本来就不一致。
  it('支架段被嵌进另一个支架段的 <p> 里：消毒后按浏览器解析出的结构切分', async () => {
    const nested = '<p data-scaffold-id="A" data-scaffold-l1="KB" data-scaffold-title="我的理论">'
      + '<p data-scaffold-id="B" data-scaffold-l1="KB" data-scaffold-title="我的理论"><strong data-scaffold-tag="">我的理论</strong><span data-scaffold-slot=""><span data-scaffold-input="">学生写的话</span></span></p>'
      + '<p data-scaffold-id="C" data-scaffold-l1="CT" data-scaffold-title="我的问题"><span data-scaffold-slot=""><span style="color: red;">另一段</span></span></p>'
      + '<p></p></p><p><br></p>';
    const clean = await sanitizeNoteHtml(nested);
    expect(clean).toBe(browserRoundTrip(nested));
    expect(split(nested).stats.scaffoldIds).toEqual(['A']);
    expect(split(clean).stats.scaffoldIds).toEqual(['B', 'C']);
    // 学生在括号里写的字数不变
    expect(split(clean).stats.scaffoldChars).toBe(split(nested).stats.scaffoldChars);
  });

  it('AI 插入块被插进一段 <p> 中间：学生自己那半句从 AI 块里分出来', async () => {
    const inP = '<p>我先写的半句<div data-ai-source="genai" data-model="m"><p>AI 的回答</p></div>后面的半句</p>';
    const clean = await sanitizeNoteHtml(inP);
    expect(clean).toBe(browserRoundTrip(inP));
    expect(split(inP).segments.map(s => s.kind)).toEqual(['ai_inserted']);
    expect(split(clean).segments.map(s => s.kind)).toEqual(['plain', 'ai_inserted', 'plain']);
  });
});

describe('挡住的', () => {
  const PAYLOADS: Record<string, string> = {
    'img onerror': '<p>看图</p><img src=x onerror="window.__xss=true">',
    script: '<p>a</p><script>window.__xss=true</script>',
    'script 在最前面': '<script>window.__xss=true</script><p>a</p>',
    'svg onload': '<svg><g onload="window.__xss=true"></g></svg>',
    'p onclick': '<p onclick="window.__xss=true">点我</p>',
    'details ontoggle': '<details open ontoggle="window.__xss=true">x</details>',
    'input onfocus': '<input autofocus onfocus="window.__xss=true">',
    'video source onerror': '<video><source onerror="window.__xss=true"></video>',
    'body onload': '<body onload="window.__xss=true"><p>b</p>',
    'html 属性': '<html onmouseover="window.__xss=true"><p>b</p>',
    iframe: '<iframe src="https://evil.example"></iframe><iframe srcdoc="<script>parent.__xss=true</script>"></iframe>',
    'javascript: 链接': '<a href="javascript:window.__xss=true">x</a><a href=" JaVaScRiPt:window.__xss=true">y</a><a href="&#106;avascript:window.__xss=true">z</a>',
    'svg xlink:href': '<svg><a xlink:href="javascript:window.__xss=true"><text>x</text></a></svg>',
    'object / embed': '<object data="javascript:window.__xss=true"></object><embed src="javascript:window.__xss=true">',
    'base / meta / link': '<base href="javascript:/"><meta http-equiv="refresh" content="0;url=javascript:window.__xss=true"><link rel="stylesheet" href="https://evil.example/x.css">',
    'button formaction': '<form><button formaction="javascript:window.__xss=true">b</button></form>',
    'mXSS: math/style': '<math><mtext><table><mglyph><style><img src=x onerror="window.__xss=true">',
    'mXSS: noscript': '<noscript><p title="</noscript><img src=x onerror=window.__xss=true>">',
    'mXSS: form 嵌套': '<form><math><mtext></form><form><mglyph><style></math><img src onerror=window.__xss=true>',
    'data: 链接': '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  };

  /**
   * 结构检查：不该出现的元素、事件属性、危险协议。
   * 这里是把消毒结果**再解析一遍**来查 —— mXSS 正是「存进去没问题、下次解析长出新东西」，
   * 所以查的就是下一次解析的结果。
   */
  function unsafeParts(html: string): string[] {
    const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
    const found: string[] = [];
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      const tag = el.localName;
      if (['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'frame', 'frameset', 'noscript', 'template'].includes(tag)
        && el.closest('body')) found.push(tag);
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) found.push(`${tag}@${attr.name}`);
        if (/^(href|src|action|formaction|xlink:href|data|srcdoc)$/i.test(attr.name)
          && /^(javascript|vbscript|data:text)/i.test(attr.value.replace(/[\u0000- ]/g, ''))) found.push(`${tag}@${attr.name}`);
        if (attr.name === 'srcdoc') found.push(`${tag}@srcdoc`);
      }
    }
    return found;
  }

  /** 真跑一遍：开脚本执行，给每个元素派发常见事件，看标记有没有被置上。 */
  function executes(html: string): boolean {
    const page = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'dangerously' });
    const win = page.window as unknown as { __xss?: boolean; Event: typeof Event; document: Document; close(): void };
    for (const el of Array.from(win.document.querySelectorAll('*'))) {
      for (const type of ['error', 'load', 'click', 'focus', 'mouseover', 'toggle']) el.dispatchEvent(new win.Event(type));
    }
    const hit = win.__xss === true;
    win.close();
    return hit;
  }

  it('检查手段本身有效：未消毒的载荷里能查出问题、事件能触发', () => {
    expect(unsafeParts(PAYLOADS['img onerror'])).toContain('img@onerror');
    expect(executes(PAYLOADS['img onerror'])).toBe(true);
    expect(executes(PAYLOADS.script)).toBe(true);
  });

  it.each(Object.entries(PAYLOADS))('%s', async (_name, payload) => {
    const clean = await sanitizeNoteHtml(payload);
    expect(unsafeParts(clean)).toEqual([]);
    expect(executes(clean)).toBe(false);
  });

  it('正常内容照留：全部 data-* 属性、style、font color、data: 图片、https 链接', async () => {
    const attrs = [
      'data-scaffold-id="s1"', 'data-scaffold-l1="GAI"', 'data-scaffold-title="话头"', 'data-scaffold-tag=""',
      'data-scaffold-slot=""', 'data-scaffold-input=""', 'data-scaffold-bracket=""', 'data-scaffold-origin="ai"',
      'data-scaffold-adopted="s2"', 'data-ai-source="genai"', 'data-imported-from="a.md"', 'data-model="deepseek-v4-flash"',
      'data-provider-id="dmx"', 'data-source-message-id="m1"', 'data-feedback-id="f1"', 'data-ai-adoption-reason="true"',
      'data-note-asset="image"', 'contenteditable="false"', 'style="color: rgb(1, 2, 3);"',
    ].join(' ');
    const html = `<div ${attrs}>x</div><p><font color="#c00000">红</font><img src="${IMAGE}" alt="图"><a href="https://example.org/x">链接</a></p>`;
    expect(await sanitizeNoteHtml(html)).toBe(html);
  });
});

describe('服务端拼正文的转义', () => {
  it('文本只转义 & < > 和不换行空格，属性只转义 & "，回车统一成换行', () => {
    expect(escapeHtmlText('a & b < c > d "e" \'f\' g\r\nh')).toBe('a &amp; b &lt; c &gt; d "e" \'f\'&nbsp;g\nh');
    expect(escapeHtmlAttr('a & b "c" <d> \'e\'')).toBe('a &amp; b &quot;c&quot; <d> \'e\'');
  });

  it('纯文本分段：空行分段、段内换行变 <br>，CRLF 也一样', () => {
    expect(textToHtmlParagraphs('第一段\r\n第一段第二行\r\n\r\n第二段')).toBe('<p>第一段<br>第一段第二行</p><p>第二段</p>');
  });
});

// 这一组要真的等 worker 撑爆内存、跑到超时再被杀掉，机器忙的时候（并行跑测试）会超过默认的 5 秒
describe('畸形正文拖不垮 API', { timeout: 20_000 }, () => {
  // 格式元素重建放大：19KB 能让 jsdom 算十几秒、吃掉 2GB
  const bomb = (a: number, b: number) => '<p>' + Array.from({ length: a }, (_, i) => `<b class="c${i}">`).join('') + '</p>' + '<p>x</p>'.repeat(b);
  const sanitizers: ReturnType<typeof createNoteSanitizer>[] = [];
  const make = (limits: Parameters<typeof createNoteSanitizer>[0]) => {
    const s = createNoteSanitizer(limits);
    sanitizers.push(s);
    return s;
  };
  afterAll(async () => { await Promise.all(sanitizers.map(s => s.close())); });

  it('超时：这一条 413，主线程全程不卡，换个 worker 继续干活', async () => {
    const s = make({ timeoutMs: 300 });
    await s.sanitize('<p>热身</p>');
    let last = Date.now();
    let maxGap = 0;
    const tick = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 5);
    const started = Date.now();
    await expect(s.sanitize(bomb(100, 2000))).rejects.toMatchObject({ statusCode: 413 });
    clearInterval(tick);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(maxGap).toBeLessThan(150);
    expect(await s.sanitize('<p>之后的保存</p>')).toBe('<p>之后的保存</p>');
  });

  it('冷启动加载 jsdom 的时间不算进超时', async () => {
    // 时限原来是 50ms：机器一忙，冷启动后的第一条本身就可能超过它，误报 413。
    // 放到 200ms，仍远小于加载 jsdom 的时间（本机约 350ms，VPS 约 1s）；下面再核对一次确实如此，
    // 否则这条测试就证明不了冷启动没被算进去
    const timeoutMs = 200;
    const s = make({ timeoutMs });
    const started = Date.now();
    expect(await s.sanitize('<p>第一次</p>')).toBe('<p>第一次</p>');
    expect(Date.now() - started).toBeGreaterThan(timeoutMs);
  });

  it('内存超限：worker 被杀，这一条 413，下一条正常', async () => {
    const s = make({ heapMb: 64, timeoutMs: 30_000 });
    await expect(s.sanitize(bomb(250, 2000))).rejects.toMatchObject({ statusCode: 413 });
    expect(await s.sanitize('<p>ok</p>')).toBe('<p>ok</p>');
  });

  it('嵌套太深导致序列化栈溢出：413，worker 不用重启', async () => {
    const s = make({ stackMb: 0.5, timeoutMs: 30_000 });
    await expect(s.sanitize('<span>'.repeat(1500) + 'x')).rejects.toMatchObject({ statusCode: 413 });
    expect(await s.sanitize('<p>ok</p>')).toBe('<p>ok</p>');
  });

  it('消毒结果超过上限：413', async () => {
    const s = make({ maxOutputChars: 1000 });
    await expect(s.sanitize(`<p>${'x'.repeat(2000)}</p>`)).rejects.toMatchObject({ statusCode: 413 });
  });

  it('并发的保存排队处理，各拿各的结果', async () => {
    const inputs = Array.from({ length: 30 }, (_, i) => `<p>第 ${i} 条<img src=x onerror=alert(${i})></p>`);
    const outputs = await Promise.all(inputs.map(html => sanitizeNoteHtml(html)));
    expect(outputs).toEqual(inputs.map((_, i) => `<p>第 ${i} 条<img src="x"></p>`));
  });

  it('空正文不必进 worker', async () => {
    expect(await sanitizeNoteHtml('')).toBe('');
  });
});
