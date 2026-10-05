/**
 * 手册里每一段录屏、每一张截图怎么拍。
 *
 * 场景按手册章节排。录屏场景里 cam.focus() 是推镜头：该读清楚的地方（AI 反馈卡片、
 * 对话里的表格）推近到接近原大，读完再拉回全景交代位置。
 */
import { COURSE_ID } from './world.mjs';

const BASE = process.env.CAPTURE_BASE ?? 'http://127.0.0.1:5288';
const noteUrl = (id) => `${BASE}/workspace/${COURSE_ID}/note/${id}`;
const canvasUrl = () => `${BASE}/workspace/${COURSE_ID}`;

const EDITOR = '.note-prose[contenteditable="true"]';

/** 正文最后一个字后面的位置（视口坐标），用来把光标点到句尾。 */
async function endOfText(page) {
  return page.evaluate((sel) => {
    const ed = document.querySelector(sel);
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim()) last = n;
    if (!last) { const r = ed.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 40 }; }
    const range = document.createRange();
    range.setStart(last, last.textContent.length); range.collapse(true);
    const rects = range.getClientRects();
    const r = rects[rects.length - 1] ?? last.parentElement.getBoundingClientRect();
    return { x: r.right + 3, y: r.top + r.height / 2 };
  }, EDITOR);
}

async function openNote(page, id) {
  await page.goto(noteUrl(id));
  await page.locator(EDITOR).waitFor();
  await page.waitForTimeout(1200);
}

export const SCENES = [
  // ── 06 AI 自动反馈 ──────────────────────────────────────────────────────
  {
    name: 'c08-feedback',
    kind: 'clip',
    page: { local: { 'hakcc-scaffold-group': '表达与改进观点' } },
    async prepare({ page, control }) {
      await control('feedback-plan', { noteId: 'n-13', plan: 'no_evidence' });
      await openNote(page, 'n-13');
    },
    async run({ page, m, cam, typeHuman, sleep }) {
      const editor = page.locator(EDITOR);
      await m.moveTo(1150, 620, 1);
      await sleep(1000);
      await cam.focus(editor, { pad: 40 });
      await sleep(500);
      // 接着上一段往下写
      const end = await endOfText(page);
      await m.click(end.x + 4, end.y);
      await page.keyboard.press('Enter');
      await typeHuman(page, '以前查资料要翻好几篇文章，边看边记；现在 AI 直接给出总结，看完就过去了。所以我觉得 AI 会让人变懒，不愿意再自己去找资料、整理信息。');
      // 停笔：鼠标移开，镜头拉到能同时看到正文和反馈区的位置
      await m.moveTo(1180, 470, 700);
      const section = page.getByText('AI 自动反馈', { exact: true });
      await cam.focusAll([editor, section], { pad: 30, dur: 1.2 });
      const card = page.locator('text=缺证据').locator('xpath=ancestor::div[.//button[normalize-space()="采纳"]][1]');
      await card.waitFor({ timeout: 15000 });
      await sleep(400);
      await cam.focus(card, { pad: 22, dur: 1.0 });
      await sleep(1400);
      cam.mark('card');
      await sleep(3800);
      // 支架栏顶上多了一条 AI 为这条笔记写的话头
      const suggest = page.getByText('AI 为这条笔记建议').locator('xpath=ancestor::div[1]/..');
      await cam.focusAll([suggest, editor], { pad: 26, dur: 1.1 });
      await m.hoverEl(page.getByText('我对照了两次经历，发现'), { ms: 900 });
      await sleep(1600);
      // 先写一段自己的对照经历，再用这条话头把它框起来
      const end2 = await endOfText(page);
      await m.click(end2.x + 4, end2.y);
      await page.keyboard.press('Enter');
      await typeHuman(page, '上周用 AI 查的三篇，我现在只记得结论；上学期自己查、自己摘抄的那篇，到现在还能讲出实验是怎么做的。');
      await sleep(500);
      await m.clickEl(page.getByText('我对照了两次经历，发现'));
      await sleep(1600);
      await cam.focus(editor, { pad: 30, dur: 0.9 });
      await sleep(2200);
      // 回到反馈卡片，采纳
      await cam.focus(card, { pad: 22, dur: 1.0 });
      await sleep(700);
      await m.clickEl(card.getByRole('button', { name: '采纳' }));
      await page.getByText('已生成一条可继续对话的笔记').waitFor({ timeout: 8000 });
      await sleep(2200);
      cam.wide({ dur: 1.2 });
      await sleep(1600);
    },
    render: { poster: 'mark:card' },
  },
];

// ── 06 与 AI 对话 ───────────────────────────────────────────────────────
const AI_INPUT = '向 AI 提问，让它帮你澄清、找证据缺口或改进当前 Idea...';
export const N13_FULL = '<p>上周写课程论文，我先让 AI 帮我查了三篇文献的要点。交完作业以后，我发现自己几乎说不出其中任何一篇的具体内容。</p>'
  + '<p>以前查资料要翻好几篇文章，边看边记；现在 AI 直接给出总结，看完就过去了。所以我觉得 AI 会让人变懒，不愿意再自己去找资料、整理信息。</p>';

/** 对话区里最后一条 AI 回复。 */
const lastReply = (page) => page.locator('button:has-text("添加到 Note")').last().locator('xpath=ancestor::div[2]');

SCENES.push(
  {
    name: 'c05-note-ai',
    kind: 'clip',
    page: { local: { 'hakcc-scaffold-group': '表达与改进观点' } },
    async prepare({ page, control }) {
      await control('note', { id: 'n-13', patch: { content: N13_FULL } });
      await openNote(page, 'n-13');
    },
    async run({ page, m, cam, typeHuman, sleep }) {
      const input = page.getByPlaceholder(AI_INPUT);
      await m.moveTo(760, 420, 1);
      await sleep(1000);
      await cam.focus({ x: 0, y: 640, width: 560, height: 250 }, { pad: 12 });
      await m.clickEl(input, { fy: 0.35 });
      await typeHuman(page, '「检索练习」是什么？和我说的「用 AI 查资料以后记不住」有没有关系？');
      await sleep(500);
      await m.clickEl(page.getByRole('complementary').getByLabel('发送').first());
      // 回答开始往外出字：镜头对准对话区下半部分，跟着看完
      await cam.focus({ x: 0, y: 150, width: 560, height: 500 }, { pad: 8, dur: 1.1 });
      await m.moveTo(700, 360, 800);
      await page.getByRole('button', { name: '添加到 Note' }).last().waitFor({ timeout: 30000 });
      cam.mark('done');
      await sleep(3400);
      await cam.focus({ x: 0, y: 300, width: 560, height: 360 }, { pad: 10, dur: 1.0 });
      await m.hoverEl(page.getByRole('button', { name: '添加到 Note' }).last(), { ms: 900 });
      await sleep(1600);
      cam.wide({ dur: 1.1 });
      await sleep(1400);
    },
    render: { poster: 'mark:done' },
  },
  {
    name: 'c06-insert',
    kind: 'clip',
    page: { local: { 'hakcc-scaffold-group': 'GAI 支持问题解决' } },
    async prepare({ page, control, typeHuman }) {
      await control('note', { id: 'n-13', patch: { content: N13_FULL } });
      await openNote(page, 'n-13');
      // 先把上一段的对话走完，录的是「添加到 Note」这一步
      const input = page.getByPlaceholder(AI_INPUT);
      await input.click();
      await input.fill('「检索练习」是什么？和我说的「用 AI 查资料以后记不住」有没有关系？');
      await page.getByRole('complementary').getByLabel('发送').first().click();
      await page.getByRole('button', { name: '添加到 Note' }).last().waitFor({ timeout: 30000 });
      await page.waitForTimeout(600);
    },
    async run({ page, m, cam, sleep }) {
      await m.moveTo(700, 420, 1);
      await sleep(800);
      await cam.focus({ x: 0, y: 330, width: 560, height: 320 }, { pad: 10 });
      await m.clickEl(page.getByRole('button', { name: '添加到 Note' }).last());
      const dialog = page.getByText('添加 AI 内容到 Note').locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
      await dialog.waitFor();
      await sleep(500);
      await cam.focus({ x: 320, y: 56, width: 800, height: 790 }, { pad: 6, dur: 1.0 });
      await sleep(1400);
      // 选一条 AI 相关支架：这段内容是 AI 对一个概念的解释
      // 左侧支架栏里也有同名的一条（被遮罩盖着），对话框里的是后渲染的那一条
      const pick = page.getByRole('button', { name: /GenAI对这个概念的解释是/ }).last();
      // 支架列表在对话框下半截，被底栏挡住一部分：先用滚轮把它滚上来
      await m.hoverEl(page.getByText('这段内容用哪条支架说明'), { ms: 700 });
      await pick.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      await sleep(900);
      await m.clickEl(pick);
      await sleep(900);
      await m.clickEl(page.getByRole('button', { name: '添加到 Note', exact: true }).last());
      await sleep(900);
      const block = page.locator('[data-ai-source="genai"]').first();
      await block.waitFor({ timeout: 8000 });
      await block.scrollIntoViewIfNeeded();
      await sleep(300);
      cam.mark('inserted');
      await cam.focus(page.locator(EDITOR), { pad: 20, dur: 1.1 });
      await sleep(3600);
      cam.wide({ dur: 1.1 });
      await sleep(1200);
    },
    render: { poster: 'mark:inserted' },
  },
  {
    name: 'c14-followup',
    kind: 'clip',
    page: { local: { 'hakcc-scaffold-group': '表达与改进观点' } },
    async prepare({ page, control }) {
      await control('seed-feedback', { noteId: 'n-07', plan: 'promising_seed' });
      await openNote(page, 'n-07');
    },
    async run({ page, m, cam, typeHuman, sleep }) {
      const card = page.locator('text=有潜力的想法').locator('xpath=ancestor::div[.//button[normalize-space()="追问"]][1]');
      await card.waitFor({ timeout: 10000 });
      await m.moveTo(1150, 480, 1);
      await sleep(900);
      await cam.focus(card, { pad: 22 });
      await sleep(3600);
      await m.clickEl(card.getByRole('button', { name: '追问' }));
      // 反馈的原话被放进了左边的输入框，接着补一句自己的问题再发出去
      await sleep(500);
      await cam.focus({ x: 0, y: 600, width: 560, height: 290 }, { pad: 12, dur: 1.1 });
      await sleep(1600);
      const input = page.getByPlaceholder(AI_INPUT);
      await m.clickEl(input, { fy: 0.9, fx: 0.9 });
      await page.keyboard.press('Meta+ArrowDown').catch(() => {});
      await page.keyboard.press('End');
      await typeHuman(page, '\n我觉得最关键的是先写下自己的判断。那提纲具体怎么写？', { fast: true, newline: 'Shift+Enter' });
      await sleep(400);
      await m.clickEl(page.getByRole('complementary').getByLabel('发送').first());
      await cam.focus({ x: 0, y: 150, width: 560, height: 500 }, { pad: 8, dur: 1.1 });
      await m.moveTo(700, 360, 800);
      await page.getByRole('button', { name: '添加到 Note' }).last().waitFor({ timeout: 30000 });
      cam.mark('done');
      await sleep(3800);
      cam.wide({ dur: 1.1 });
      await sleep(1400);
    },
    render: { poster: 'mark:done' },
  },
  {
    name: 'ui-feedback-actions',
    kind: 'shot',
    page: { local: { 'hakcc-scaffold-group': '表达与改进观点' } },
    async run({ page, control, shot }) {
      await control('note', { id: 'n-13', patch: { content: N13_FULL } });
      await control('seed-feedback', { noteId: 'n-13', plan: 'no_evidence' });
      await openNote(page, 'n-13');
      const card = page.locator('text=缺证据').locator('xpath=ancestor::div[.//button[normalize-space()="不同意"]][1]');
      await card.getByRole('button', { name: '不同意' }).click();
      await page.getByText('误解了我的意思').waitFor();
      await page.waitForTimeout(500);
      const top = await page.getByText('AI 自动反馈', { exact: true }).boundingBox();
      const bottom = await page.getByRole('button', { name: '取消', exact: true }).last().boundingBox();
      const left = await page.locator(EDITOR).boundingBox();
      await shot('ui-feedback-actions', { clip: { x: left.x - 40, y: top.y - 24, width: 1440 - (left.x - 40), height: bottom.y + bottom.height + 36 - (top.y - 24) }, width: 1400 });
    },
  },
);

// ── 01–05 登录、首页、画布、写笔记、Build-on ─────────────────────────────
const dashUrl = () => `${BASE}/dashboard`;
const cardOf = (page, title) => page.getByText(title, { exact: true }).first();

async function openCanvas(page) {
  await page.goto(canvasUrl());
  await page.getByText('AI 可能让人不愿意自己思考').first().waitFor();
  // 问题栏后面的讨论主题是另一个请求，等它出来再拍（2026-10-05 起）
  await page.locator('[data-view-topics]').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1600);
}

SCENES.push(
  {
    name: 'fig-01',
    kind: 'shot',
    page: { auth: false },
    async run({ page, shot }) {
      await page.goto(`${BASE}/login`);
      await page.waitForTimeout(2500);
      await shot('fig-01');
    },
  },
  {
    name: 'ui-home',
    kind: 'shot',
    async run({ page, shot }) {
      await page.goto(dashUrl());
      await page.getByText('欢迎回来').first().waitFor();
      await page.waitForTimeout(2200);
      await shot('ui-home');
    },
  },
  {
    name: 'c01-enter',
    kind: 'clip',
    async prepare({ page }) {
      await page.goto(dashUrl());
      await page.getByText('欢迎回来').first().waitFor();
      await page.waitForTimeout(1800);
    },
    async run({ page, m, cam, sleep }) {
      await m.moveTo(700, 500, 1);
      await sleep(900);
      const enter = page.getByRole('button', { name: '进入', exact: true }).first();
      const welcome = page.getByText('欢迎回来').first().locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
      await cam.focusAll([welcome, enter], { pad: 30 });
      await sleep(1200);
      await m.clickEl(enter);
      await page.getByText('AI 可能让人不愿意自己思考').first().waitFor();
      cam.wide({ dur: 0.8 });
      await sleep(2200);
      cam.mark('canvas');
      await m.moveTo(560, 70, 900);
      await cam.focus(page.getByText('生成式 AI 会让我们更会思考，还是更少思考？').first(), { pad: 40, dur: 1.0 });
      await sleep(1800);
      cam.wide({ dur: 1.0 });
      await sleep(1200);
    },
    render: { poster: 'mark:canvas' },
  },
  {
    name: 'ui-canvas',
    kind: 'shot',
    async run({ page, shot }) {
      await openCanvas(page);
      // 静图拍主题条刚出来的样子：第一个主题完整，不拍滚到一半的
      await page.addStyleTag({ content: '.topic-marquee { animation: none !important; }' });
      await page.waitForTimeout(200);
      await shot('ui-canvas');
    },
  },
  {
    name: 'ui-toolbar',
    kind: 'shot',
    async run({ page, shot }) {
      await openCanvas(page);
      await shot('ui-toolbar', { clip: { x: 0, y: 52, width: 520, height: 848 }, width: 1040 });
    },
  },
  {
    name: 'c02-canvas',
    kind: 'clip',
    async prepare({ page }) { await openCanvas(page); },
    async run({ page, m, cam, sleep }) {
      await m.moveTo(900, 640, 1);
      await sleep(900);
      // 空白处按住拖动：平移
      await m.drag(1180, 640, 820, 520, 1300);
      await sleep(700);
      await m.drag(820, 520, 1100, 600, 1100);
      await sleep(600);
      // 滚轮：缩放
      await m.moveTo(760, 420, 600);
      await m.wheel(-120, 5, 110);
      await sleep(900);
      await m.wheel(120, 5, 110);
      await sleep(700);
      // 单击一张卡片：右侧打开详情
      await m.clickEl(cardOf(page, '检索练习：先自己回想，再看答案，记得更牢'));
      await sleep(1400);
      const panel = page.getByRole('button', { name: '建立于此' }).locator('xpath=ancestor::div[contains(@class,"absolute") or contains(@class,"fixed")][1]');
      await cam.focus({ x: 1080, y: 90, width: 350, height: 800 }, { pad: 10, dur: 1.0 });
      cam.mark('panel');
      await sleep(2600);
      cam.wide({ dur: 1.0 });
      await sleep(1200);
    },
    render: { poster: 'mark:panel' },
  },
  {
    name: 'c04-buildon',
    kind: 'clip',
    page: { local: { 'hakcc-scaffold-group': '表达与改进观点' } },
    async prepare({ page }) { await openCanvas(page); },
    async run({ page, m, cam, typeHuman, sleep }) {
      await m.moveTo(700, 600, 1);
      await sleep(800);
      const target = cardOf(page, '先写提纲要花多久？时间紧的时候还做得到吗？');
      await cam.focus(target, { pad: 160, dur: 0.9 });
      await m.clickEl(target);
      await sleep(900);
      await cam.focus({ x: 1080, y: 90, width: 350, height: 800 }, { pad: 10, dur: 0.9 });
      await sleep(700);
      await m.clickEl(page.getByRole('button', { name: '建立于此' }));
      await page.getByText('选择你的知识建构行动类型').waitFor();
      await cam.focus({ x: 440, y: 140, width: 560, height: 620 }, { pad: 10, dur: 0.9 });
      await sleep(900);
      await m.clickEl(page.getByRole('button', { name: /Clarify/ }));
      await sleep(700);
      await m.clickEl(page.getByRole('button', { name: /打开编辑器/ }));
      await page.locator(EDITOR).waitFor();
      cam.wide({ dur: 0.8 });
      await sleep(900);
      const chip = page.getByText(/正在 Build-on 已有想法/).first();
      await cam.focusAll([chip, page.getByPlaceholder(/输入一个想法标题/)], { pad: 40, dur: 0.9 });
      await sleep(1200);
      await m.clickEl(page.getByPlaceholder(/输入一个想法标题/));
      await typeHuman(page, '写提纲大约十分钟，赶作业时写三行也有用');
      await cam.focus(page.locator(EDITOR), { pad: 30, dur: 0.9 });
      await m.clickEl(page.locator(EDITOR), { fy: 0.2 });
      await typeHuman(page, '回应子涵：这周三次作业我计了时，写提纲平均十分钟左右。时间紧的时候，我只写三行：我的判断、一条理由、一个最没把握的地方，也比直接问 AI 强。', { fast: true });
      await sleep(600);
      cam.wide({ dur: 0.8 });
      await m.clickEl(page.getByRole('button', { name: '贡献' }));
      await page.getByText('写提纲大约十分钟，赶作业时写三行也有用').first().waitFor({ timeout: 10000 });
      await sleep(900);
      // 新卡片落在原笔记右边、画面边缘外：滚轮缩小一点把它带进画面
      await m.moveTo(1180, 420, 700);
      await m.wheel(120, 2, 160);
      await sleep(900);
      const created = cardOf(page, '写提纲大约十分钟，赶作业时写三行也有用');
      await cam.focusAll([created, cardOf(page, '先写提纲要花多久？时间紧的时候还做得到吗？')], { pad: 120, dur: 1.1 });
      cam.mark('linked');
      await sleep(2800);
      cam.wide({ dur: 1.0 });
      await sleep(1000);
    },
    render: { poster: 'mark:linked' },
  },
  {
    name: 'c03-scaffold',
    kind: 'clip',
    page: { local: { 'hakcc-scaffold-group': '表达与改进观点' } },
    async prepare({ page }) { await openCanvas(page); },
    async run({ page, m, cam, typeHuman, sleep }) {
      await m.moveTo(600, 500, 1);
      await sleep(700);
      await m.clickEl(page.getByRole('button', { name: /Note 创建/ }).first());
      await page.locator(EDITOR).waitFor();
      await sleep(900);
      await m.clickEl(page.getByPlaceholder(/输入一个想法标题/));
      await typeHuman(page, '先猜再查，比直接看答案记得牢');
      // 支架栏：先选组，再点一条
      const pane = page.getByText('支架组').first().locator('xpath=ancestor::div[2]');
      await cam.focus({ x: 570, y: 40, width: 870, height: 560 }, { pad: 6, dur: 1.0 });
      await sleep(900);
      await m.clickEl(page.getByRole('button', { name: '我的想法/观点是' }).first());
      await sleep(900);
      await typeHuman(page, '先自己猜一个答案，再用 AI 或资料核对，比直接看答案记得牢。', { fast: true });
      await sleep(400);
      // 括号里回车是换行，右括号跟着下来
      await page.keyboard.press('Enter');
      await typeHuman(page, '上周背单词我试了两种办法，先猜词义的那一组，第二天记得更多。', { fast: true });
      await sleep(900);
      cam.mark('inside');
      await cam.focus(page.locator(EDITOR), { pad: 20, dur: 0.9 });
      await sleep(1200);
      // 点到右括号后面：接着写的是普通正文
      const closing = page.locator('[data-scaffold-bracket]').last();
      const cb = await closing.boundingBox();
      await m.click(cb.x + cb.width + 3, cb.y + cb.height / 2);
      await page.keyboard.press('Enter');
      await typeHuman(page, '下周我想换一门课的内容再试一次。', { fast: true });
      await sleep(1000);
      // 鼠标移到支架上，左上角露出小叉：插错了点它，框去掉、字留下
      await m.hoverEl(page.locator('[data-scaffold-tag]').first(), { ms: 700 });
      await sleep(1600);
      cam.wide({ dur: 1.0 });
      await sleep(1000);
    },
    render: { poster: 'mark:inside' },
  },
  {
    name: 'ui-note-page',
    kind: 'shot',
    page: { local: { 'hakcc-scaffold-group': '表达与改进观点' } },
    async run({ page, control, shot }) {
      await control('note', { id: 'n-13', patch: { content: '<p data-scaffold-id="s-demo" data-scaffold-title="我的想法/观点是"><strong data-scaffold-tag="">我的想法/观点是</strong><span data-scaffold-slot=""><span data-scaffold-bracket="">[</span><span data-scaffold-input="">用 AI 查资料以后，我记住的内容反而更少了。</span><span data-scaffold-bracket="">]</span></span></p>' + N13_FULL } });
      await control('seed-feedback', { noteId: 'n-13', plan: 'no_evidence' });
      await openNote(page, 'n-13');
      await page.waitForTimeout(800);
      await shot('ui-note-page');
    },
  },
);

// ── 06 知识空间助手、求助；07 综合升华；08 观点图谱；09 回看；10 练习场 ─────────
const WS_INPUT = '向 AI 助手提问关于工作台笔记的问题…';
async function openAssistant(page) {
  await openCanvas(page);
  await page.getByRole('button', { name: '助手' }).first().click();
  await page.getByText('知识空间 AI 助手').first().waitFor();
  await page.waitForTimeout(900);
}
async function dashPanel(page, name) {
  await page.goto(dashUrl());
  await page.getByText('欢迎回来').first().waitFor();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name }).first().click();
  await page.waitForTimeout(2400);
}
const PANEL = { x: 880, y: 44, width: 560, height: 856 };

SCENES.push(
  {
    name: 'ui-workspace-ai',
    kind: 'shot',
    async run({ page, shot }) {
      await openAssistant(page);
      // 讨论速览默认收成一行，点开才有「生成速览」
      await page.getByRole('button', { name: /讨论速览/ }).first().click();
      await page.getByRole('button', { name: '生成速览' }).first().click();
      await page.getByText('存在分歧的问题').first().waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      // 实际使用时卡片最高占屏幕 45%、里面自己滚；手册图里让它完整展开，范围、统计和四类内容都看得见
      await page.getByText('存在分歧的问题').first().evaluate((el) => {
        for (let n = el.parentElement; n; n = n.parentElement) {
          if (getComputedStyle(n).overflowY === 'auto' && n.className.includes('max-h-')) {
            n.style.maxHeight = 'none';
            n.style.overflow = 'visible';
            break;
          }
        }
      });
      await page.waitForTimeout(600);
      await shot('ui-workspace-ai');
    },
  },
  {
    name: 'c12-workspace-ai',
    kind: 'clip',
    async prepare({ page }) { await openAssistant(page); },
    async run({ page, m, cam, typeHuman, sleep }) {
      await m.moveTo(700, 450, 1);
      await sleep(900);
      await cam.focus({ x: 720, y: 450, width: 720, height: 450 }, { pad: 8 });
      const input = page.getByPlaceholder(WS_INPUT);
      await m.clickEl(input);
      await typeHuman(page, '这一块画布上，哪些提问还没有人回应？', { fast: true });
      await sleep(400);
      await page.keyboard.press('Enter');
      await cam.focus({ x: 720, y: 60, width: 720, height: 450 }, { pad: 8, dur: 1.0 });
      await m.moveTo(1000, 330, 700);
      await page.getByText('从第一条开始').first().waitFor({ timeout: 30000 });
      cam.mark('done');
      await sleep(3600);
      cam.wide({ dur: 1.0 });
      await sleep(1200);
    },
    render: { poster: 'mark:done' },
  },
  {
    name: 'c07-image',
    kind: 'clip',
    async prepare({ page }) { await openAssistant(page); },
    async run({ page, m, cam, typeHuman, sleep }) {
      await m.moveTo(700, 450, 1);
      await sleep(800);
      await cam.focus({ x: 720, y: 450, width: 720, height: 450 }, { pad: 8 });
      await m.clickEl(page.getByPlaceholder(WS_INPUT));
      await typeHuman(page, '帮我画一张示意图，对比读完以后「自己回想」和「再读一遍」。', { fast: true });
      await sleep(400);
      await page.keyboard.press('Enter');
      // 画图的要求不经对话模型，直接交给绘图模型；等图的几秒里对话中放绘图进度
      const progress = page.locator('[role="status"][aria-label^="正在画"]');
      await progress.waitFor({ timeout: 10000 });
      await m.moveTo(1000, 330, 700);
      cam.mark('drawing');
      await cam.focus(progress, { pad: 30, dur: 1.0 });
      const img = page.locator('img[src$="retrieval-diagram.png"]').last();
      await img.waitFor({ timeout: 40000 });
      await img.scrollIntoViewIfNeeded();
      await sleep(600);
      cam.mark('image');
      await cam.focus(img, { pad: 30, dur: 1.0 });
      await sleep(3600);
      cam.wide({ dur: 1.0 });
      await sleep(1000);
    },
    render: { poster: 'mark:image' },
  },
  {
    name: 'c13-support',
    kind: 'clip',
    async prepare({ page }) {
      await openAssistant(page);
      await page.getByRole('button', { name: '求助' }).first().click();
      await page.waitForTimeout(900);
    },
    async run({ page, m, cam, typeHuman, sleep }) {
      await m.moveTo(700, 450, 1);
      await sleep(800);
      await cam.focus(PANEL, { pad: 0 });
      const box = page.getByPlaceholder(/描述你遇到的问题/);
      await m.clickEl(box);
      await typeHuman(page, '我写好的笔记在画布上找不到了，是没保存吗？', { fast: true });
      await sleep(500);
      await m.clickEl(page.getByRole('button', { name: '提问', exact: true }));
      await page.getByRole('button', { name: '解决了' }).first().waitFor({ timeout: 20000 });
      await sleep(600);
      cam.mark('answer');
      await cam.focus({ x: 880, y: 90, width: 560, height: 520 }, { pad: 8, dur: 1.0 });
      await sleep(4200);
      await m.clickEl(page.getByRole('button', { name: '解决了' }).first());
      await sleep(1800);
      cam.wide({ dur: 1.0 });
      await sleep(1000);
    },
    render: { poster: 'mark:answer' },
  },
  {
    name: 'c09-riseabove',
    kind: 'clip',
    async prepare({ page }) { await openCanvas(page); },
    async run({ page, m, cam, typeHuman, sleep }) {
      await m.moveTo(700, 820, 1);
      await sleep(800);
      const picks = ['不只是懒，是「想」这一步被外包了', '用得好反而逼人多想：AI 答错的地方要自己找出来', '我理解的「自己思考」：看到答案之前，先有一个自己的猜测'];
      await cam.focusAll(picks.map(t => cardOf(page, t)), { pad: 60 });
      await page.keyboard.down('Shift');
      for (const t of picks) { await m.clickEl(cardOf(page, t)); await sleep(350); }
      await page.keyboard.up('Shift');
      await sleep(600);
      const openRoom = page.getByTitle(/就这几条开一间讨论室/).first();
      await cam.focusAll([openRoom, ...picks.map(t => cardOf(page, t))], { pad: 40, dur: 0.8 });
      await sleep(700);
      await m.clickEl(openRoom);
      await page.getByPlaceholder('说说你的想法⋯⋯').waitFor({ timeout: 15000 });
      cam.wide({ dur: 0.6 });
      await sleep(1600);
      // 叫上一位 AI 同学再发言
      await m.clickEl(page.getByRole('button', { name: /爱唱反调/ }).first());
      await sleep(500);
      const say = page.getByPlaceholder('说说你的想法⋯⋯');
      await m.clickEl(say);
      await typeHuman(page, '我觉得这三条其实在说同一件事：关键不是用不用 AI，而是什么时候用。', { fast: true });
      await m.clickEl(page.getByRole('button', { name: '发送' }).first());
      await page.getByText(/那如果反过来想呢/).first().waitFor({ timeout: 15000 });
      cam.mark('ai');
      await sleep(3200);
      await m.clickEl(say);
      await typeHuman(page, '对，不只是时机，还看你把 AI 的回答当成什么：当答案，还是当要检查的东西。', { fast: true });
      await m.clickEl(page.getByRole('button', { name: '发送' }).first());
      await sleep(1200);
      // 右边写下这一组的说法并发布
      await m.clickEl(page.getByPlaceholder(/也许「懂」不是有没有/));
      await typeHuman(page, 'AI 让人想得多还是少，看它的回答在你这里是答案还是证据', { fast: true });
      await m.clickEl(page.getByPlaceholder(/写下那句更高一层的说法/));
      await typeHuman(page, '三条笔记的分歧在于 AI 让人想得更少还是更多。放在一起看，差别不在工具：自己还没有判断时，AI 的回答被当成答案，思考就被替代了；先有自己的猜测，再把 AI 的回答当作要检验的东西，思考反而更多。', { fast: true });
      await sleep(600);
      await m.clickEl(page.getByRole('button', { name: '发布', exact: true }));
      await page.getByText('AI 让人想得多还是少，看它的回答在你这里是答案还是证据').first().waitFor({ timeout: 15000 });
      await sleep(1400);
      const created = cardOf(page, 'AI 让人想得多还是少，看它的回答在你这里是答案还是证据');
      await cam.focusAll([created, ...picks.map(t => cardOf(page, t))], { pad: 40, dur: 1.0 });
      await sleep(2600);
      cam.wide({ dur: 1.0 });
      await sleep(900);
    },
    render: { poster: 'mark:ai' },
  },
  {
    name: 'c10-graph',
    kind: 'clip',
    async prepare({ page }) { await openCanvas(page); },
    async run({ page, m, cam, sleep }) {
      await m.moveTo(700, 450, 1);
      await sleep(700);
      await m.clickEl(page.getByRole('button', { name: '观点图谱' }).first());
      await page.getByText('本期新增').first().waitFor({ timeout: 15000 });
      await sleep(1600);
      cam.mark('graph');
      const circle = page.locator('svg text', { hasText: '独立思考' }).first();
      const cb = await circle.boundingBox();
      await cam.focus({ x: cb.x - 260, y: cb.y - 200, width: 620, height: 420 }, { pad: 0, dur: 1.0 });
      await m.drag(cb.x + cb.width / 2, cb.y + cb.height / 2, cb.x + cb.width / 2 - 90, cb.y + cb.height / 2 + 60, 1100);
      await sleep(700);
      const moved = await circle.boundingBox();
      await m.click(moved.x + moved.width / 2, moved.y + moved.height / 2);
      await sleep(1800);
      cam.wide({ dur: 1.0 });
      await sleep(2400);
    },
    render: { poster: 'mark:graph' },
  },
  {
    name: 'ui-idea-graph',
    kind: 'shot',
    async run({ page, shot }) {
      await openCanvas(page);
      await page.getByRole('button', { name: '观点图谱' }).first().click();
      await page.getByText('本期新增').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(2200);
      await shot('ui-idea-graph');
    },
  },
  {
    name: 'ui-buildon-network',
    kind: 'shot',
    async run({ page, shot }) {
      await openCanvas(page);
      await page.getByRole('button', { name: 'Build-on 网络' }).first().click();
      await page.waitForTimeout(2600);
      await shot('ui-buildon-network');
    },
  },
  {
    name: 'ui-timeline',
    kind: 'shot',
    async run({ page, shot }) {
      await openCanvas(page);
      await page.getByRole('button', { name: '时间线' }).first().click();
      await page.waitForTimeout(2200);
      await shot('ui-timeline');
    },
  },
  {
    name: 'c11-network',
    kind: 'clip',
    async prepare({ page }) { await openCanvas(page); },
    async run({ page, m, cam, sleep }) {
      await m.moveTo(700, 450, 1);
      await sleep(700);
      await m.clickEl(page.getByRole('button', { name: 'Build-on 网络' }).first());
      await sleep(2200);
      cam.mark('network');
      await m.moveTo(1000, 330, 900);
      await sleep(1400);
      await page.keyboard.press('Escape');
      await sleep(700);
      await m.clickEl(page.getByRole('button', { name: '时间线' }).first());
      await sleep(1200);
      const modal = page.getByText('只看我的').first().locator('xpath=ancestor::div[contains(@class,"rounded")][last()]');
      await cam.focus(modal, { pad: 12, dur: 1.0 });
      await sleep(900);
      const mineOnly = page.getByText('只看我的').first();
      await m.clickEl(mineOnly);
      await sleep(2000);
      await m.clickEl(mineOnly);
      await sleep(1400);
    },
    render: { poster: 'mark:network' },
  },
  { name: 'fig-07', kind: 'shot', async run({ page, shot }) { await dashPanel(page, '笔记动态'); await shot('fig-07'); } },
  { name: 'fig-08', kind: 'shot', async run({ page, shot }) { await dashPanel(page, '知识图谱'); await page.waitForTimeout(1500); await shot('fig-08'); } },
  { name: 'fig-09', kind: 'shot', async run({ page, shot }) { await dashPanel(page, '潜力想法'); await shot('fig-09'); } },
  { name: 'fig-10', kind: 'shot', async run({ page, shot }) { await dashPanel(page, '思维发展'); await shot('fig-10'); } },
  { name: 'fig-11', kind: 'shot', async run({ page, shot }) { await dashPanel(page, '协作网络'); await shot('fig-11'); } },
  { name: 'fig-12', kind: 'shot', async run({ page, shot }) { await dashPanel(page, '教师反馈'); await shot('fig-12'); } },
  { name: 'fig-13', kind: 'shot', async run({ page, shot }) { await dashPanel(page, '思维练习助手'); await shot('fig-13'); } },
  { name: 'fig-14', kind: 'shot', async run({ page, shot }) { await dashPanel(page, '编程练习助手'); await shot('fig-14'); } },
  { name: 'ui-feedback-channel', kind: 'shot', async run({ page, shot }) { await dashPanel(page, '使用反馈'); await shot('ui-feedback-channel'); } },
  {
    name: 'ui-changelog',
    kind: 'shot',
    async run({ page, shot }) {
      await page.goto(dashUrl());
      await page.getByText('欢迎回来').first().waitFor();
      await page.waitForTimeout(600);
      await page.getByText(/更新日志/).first().click();
      await page.waitForTimeout(1800);
      await shot('ui-changelog');
    },
  },
);

// ── 11 教师端 ───────────────────────────────────────────────────────────
async function teacherPanel(page, name) {
  await page.goto(dashUrl());
  await page.getByText('欢迎回来').first().waitFor();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name }).first().click();
  await page.waitForTimeout(2600);
}
SCENES.push(
  { name: 'ui-teacher-ai', kind: 'shot', role: 'teacher', async run({ page, shot }) { await teacherPanel(page, 'AI 设置'); await shot('ui-teacher-ai'); } },
  { name: 'ui-teacher-helpdesk', kind: 'shot', role: 'teacher', async run({ page, shot }) { await teacherPanel(page, '学生求助'); await shot('ui-teacher-helpdesk'); } },
  { name: 'ui-teaching-log', kind: 'shot', role: 'teacher', async run({ page, shot }) { await teacherPanel(page, '教学日志'); await shot('ui-teaching-log'); } },
);

// ── 新增：文档阅读、图灵测试、触发设置 ───────────────────────────────────
SCENES.push(
  {
    name: 'ui-doc-reader',
    kind: 'shot',
    async run({ page, shot }) {
      await openCanvas(page);
      const card = page.getByText('本周阅读：检索练习导读.md').first();
      await card.dblclick();
      await page.getByText('一、研究在比较什么').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(900);
      const toggle = page.getByRole('button', { name: /批注/ }).first();
      if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(1200); }
      await shot('ui-doc-reader');
    },
  },
  {
    name: 'ui-turing',
    kind: 'shot',
    async run({ page, shot }) {
      await page.goto(`${BASE}/workspace/${COURSE_ID}/turing-test/tt-1`);
      await page.getByText('期末考试应不应该允许用 AI？').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1800);
      await shot('ui-turing');
    },
  },
  {
    name: 'ui-teacher-triggers',
    kind: 'shot',
    role: 'teacher',
    async run({ page, shot }) {
      await teacherPanel(page, 'AI 设置');
      const head = page.getByText('AI 触发设置').first();
      await head.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -12));
      await head.evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(900);
      await shot('ui-teacher-triggers');
    },
  },
);
