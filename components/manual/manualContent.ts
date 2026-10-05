import { type DemoId } from './ManualDemos';

/**
 * 使用手册的内容。
 *
 * 写法约定（2026-09-28 按 v1.33 的界面整体重写）：
 * - 只写界面上真实存在的东西。按钮、菜单、提示语照界面原样写在「」里，学生对着屏幕能找到。
 * - 一句话说一件事。少用加粗，不用破折号，不写「不是……而是……」这类对仗和结尾金句。
 * - 事实以代码为准：每次界面改动后，对照 components/dashboard/changelog.ts 检查这里有没有过时的说法。
 * - 截图和录屏由 scripts/manual-capture/ 在本地演示服务上生成，姓名和内容都是演示数据。
 *
 * 行内标记只支持两种：**加粗** 和 `等宽`。不用 HTML，
 * 免得内容里混进标签之后要走 dangerouslySetInnerHTML。
 */

export type Bilingual = { zh: string; en: string };

export type Block =
  | { kind: 'p'; zh: string; en: string }
  | { kind: 'h3'; zh: string; en: string }
  | { kind: 'steps'; zh: string[]; en: string[] }
  | { kind: 'list'; zh: string[]; en: string[] }
  | { kind: 'table'; head: Bilingual[]; rows: Bilingual[][] }
  | { kind: 'callout'; tone: 'tip' | 'warn'; label: Bilingual; zh: string[]; en: string[] }
  | { kind: 'figure'; src: string; cap: Bilingual }
  | { kind: 'demo'; id: DemoId; cap: Bilingual }
  /**
   * 真实操作录屏。和 demo 的区别：demo 是手画的示意动画，讲机制；
   * clip 是界面上真跑一遍录下来的，讲「实际长什么样」。两者互补。
   *
   * src 不带扩展名 —— 渲染器拼出 .webm / .mp4 / .jpg（海报帧）三个地址。
   * 用视频不用 GIF：GIF 只有 256 色又没有帧间运动补偿，要压小就得降帧降分辨率，
   * 结果就是又糊又卡；同样体积下 H.264/VP9 能跑 30fps 加原生分辨率。
   */
  | { kind: 'clip'; src: string; cap: Bilingual }
  | { kind: 'faq'; items: Array<{ q: Bilingual; a: { zh: string[]; en: string[] } }> };

export interface ManualSection {
  id: string;
  num: string;
  title: Bilingual;
  /** 只有教师看得到的章节。学生端完全不渲染。 */
  teacherOnly?: boolean;
  blocks: Block[];
}

export const MANUAL_INTRO: Block[] = [
  {
    kind: 'p',
    zh: 'HAKCC 用来把想法写成别人能检查、能接着往下推的样子。你写一条解释，同学在上面补证据、提问题、提出不同意见，你也这样回应他们。一个学期下来，画布上留下的是全班一起改出来的理解。',
    en: 'HAKCC is where you write ideas down in a form others can check and carry further. You post an explanation; classmates add evidence, ask questions or disagree, and you do the same with theirs. By the end of term the canvas holds an understanding the class worked out together.',
  },
  {
    kind: 'p',
    zh: '手册按使用顺序排：登录、进课程、写笔记、在同学的笔记上 Build-on、和 AI 对话、处理 AI 反馈、做综合升华，最后是回看自己的记录。多数小节配了截图和录屏。遇到问题可以直接翻到最后的「常见问题」。',
    en: 'The sections follow the order you will need them: signing in, entering a course, writing notes, building on classmates\' notes, talking with the AI, handling AI feedback, rising above, and finally looking back at your own record. Most sections have screenshots and a screen recording. For problems, go straight to Common problems at the end.',
  },
  {
    kind: 'callout',
    tone: 'tip',
    label: { zh: '三条基本要求', en: 'Three ground rules' },
    zh: [
      '写具体。「我认为 X 是因为 Y，依据是 Z」比一段泛泛而谈有用得多。',
      '多在同学的笔记上接着写。这门课看重的是想法有没有被人接过去、继续往前推。',
      'AI 的回答是材料。用不用、用哪一句、怎么改，由你决定；用之前先核对事实和出处。',
    ],
    en: [
      'Be specific. "I think X because of Y, and my evidence is Z" is worth more than a paragraph of generalities.',
      'Build on classmates\' notes more than you start new ones. The course looks at whether ideas get picked up and moved along.',
      'What the AI says is material. You decide whether to use it, which part, and how to change it. Check facts and sources first.',
    ],
  },
];

export const MANUAL_SECTIONS: ManualSection[] = [
  // ── 01 ────────────────────────────────────────────────────────────────
  {
    id: 'login',
    num: '01',
    title: { zh: '登录', en: 'Signing in' },
    blocks: [
      {
        kind: 'steps',
        zh: [
          '用 Chrome 或 Edge 打开 `https://ideaweave.tech`，点右上角「登录」。',
          '账号是老师发给你的邮箱，初始密码也由老师发。第一次登录后，在侧栏底部点「修改密码」换成自己的。',
          '登录页右上角的地球图标可以换界面语言。登录以后，在侧栏底部点语言按钮，按钮上显示的是下一个可选的语言，比如「繁」「EN」「简」。',
        ],
        en: [
          'Open `https://ideaweave.tech` in Chrome or Edge and click "Sign in" at the top right.',
          'Your account is the email your teacher gave you, with the password they issued. After the first sign-in, change it with "Change password" at the bottom of the sidebar.',
          'The globe icon at the top right of the sign-in page changes the language. After signing in, use the language button at the bottom of the sidebar; it shows the next language in turn, such as 繁, EN or 简.',
        ],
      },
      {
        kind: 'figure',
        src: '/manual/fig-01.jpg',
        cap: {
          zh: '登录页。左边轮换显示这门课依据的一些理念，登录只需要填右边的邮箱和密码。',
          en: 'The sign-in page. The left side cycles through ideas the course draws on; to sign in you only need the email and password on the right.',
        },
      },
      {
        kind: 'callout',
        tone: 'warn',
        label: { zh: '忘了密码', en: 'Forgotten password' },
        zh: ['不要反复试，试多了会被暂时锁住。点登录框里的「忘记密码？」，重置邮件会发到你的邮箱；收不到就告诉老师，由平台管理员帮你重置。'],
        en: ['Do not keep guessing; too many attempts lock sign-in for a while. Use "Forgot password?" in the form and a reset email is sent to you. If it does not arrive, tell your teacher and a platform administrator will reset it.'],
      },
    ],
  },

  // ── 02 ────────────────────────────────────────────────────────────────
  {
    id: 'home',
    num: '02',
    title: { zh: '首页：从这里进课程', en: 'Home: where you enter the course' },
    blocks: [
      {
        kind: 'p',
        zh: '登录后进入你的首页。平时用它做两件事：进课程，以及回头看自己的学习记录。',
        en: 'After signing in you land on your home page. You mostly use it for two things: getting into a course, and looking back at your own record.',
      },
      {
        kind: 'figure',
        src: '/manual/ui-home.jpg',
        cap: {
          zh: '首页。欢迎卡片右边的「进入」直接进课程；下面是几项计数、近 8 周的活动和 AI 反馈的处理情况。',
          en: 'Home. "Open" on the welcome card takes you into the course. Below are a few counts, the last eight weeks of activity, and how AI feedback has been handled.',
        },
      },
      {
        kind: 'clip',
        src: '/manual/c01-enter',
        cap: {
          zh: '点「进入」，直接落到这门课的画布上。',
          en: 'Click "Open" and you land on the course canvas.',
        },
      },
      { kind: 'h3', zh: '首页上有什么', en: 'What is on the page' },
      {
        kind: 'table',
        head: [{ zh: '位置', en: 'Where' }, { zh: '是什么', en: 'What it is' }],
        rows: [
          [{ zh: '欢迎卡片', en: 'Welcome card' }, { zh: '一门课和「进入」按钮。有老师新评语的课优先显示，没有就显示你最近在用的那门。', en: 'One course with an "Open" button: the one with new teacher comments if there is one, otherwise the one you used most recently.' }],
          [{ zh: '学习状态', en: 'Learning status' }, { zh: '三个数：老师的新评语、开了 AI 的课程、还没加入的课程。', en: 'Three counts: new comments from your teacher, courses with AI switched on, and courses you have not joined.' }],
          [{ zh: '四个计数', en: 'Four counters' }, { zh: '教师反馈、提醒、AI 课程、可加入。数字大于 0 时标「需处理」。这几张只显示数字，点了不会跳转。', en: 'Feedback, notifications, AI courses and available courses. A number above zero is marked "Action needed". They only show counts and do not open anything.' }],
          [{ zh: '学习活动趋势', en: 'Weekly learning activity' }, { zh: '最近 8 周每周新写的笔记（深色）和 AI 介入次数（浅色）。刚开课时是空的。', en: 'Notes written (dark) and AI interventions (light) per week over the last eight weeks. Empty at the start of term.' }],
          [{ zh: 'AI 反馈接受率', en: 'AI feedback acceptance' }, { zh: '你所在课程里 AI 反馈被采纳、看过未采纳、还没处理的数量，按全班统计，并按反馈类型分开列。', en: 'How much AI feedback in your courses was adopted, read but not adopted, or left untouched, counted across the class and split by feedback type.' }],
          [{ zh: '我的课程', en: 'My courses' }, { zh: '你加入的课程。鼠标移到课程卡片上会出现「退出课程」。', en: 'The courses you have joined. Hover over a course card to see "Leave course".' }],
        ],
      },
      { kind: 'h3', zh: '左边的栏目', en: 'The sidebar' },
      {
        kind: 'p',
        zh: '侧栏分五组：「主要」（概览、个人资料、发现课程）、「学习」（笔记动态、知识图谱、潜力想法、思维发展）、「社区」（协作网络、教师反馈）、「AI 智能体」（AI 对话、思维练习助手、编程练习助手）、「平台理念与帮助」（使用手册、使用反馈）。刚开课时用「概览」就够了，其他栏目要写上两三周才有内容，第 11 节有说明。',
        en: 'The sidebar has five groups: Main (Overview, Profile, Discover), Learning (Note activity, Knowledge graph, Promising ideas, Thinking development), Community (Collaboration, Feedback), AI Agents (AI chat, Thinking coach, Coding coach) and Rationale & Help (User manual, Send feedback). At first Overview is all you need. The rest fill up after two or three weeks of writing and are covered in section 11.',
      },
      {
        kind: 'p',
        zh: '侧栏最底下一行是 `v1.x · 更新日志`，下面是主题、语言、通知、修改密码、退出登录几个图标，最后是你的头像和名字，点它进入个人资料。点铃铛会列出最近的通知，有未读的时候铃铛上有个小点；点老师反馈的那一条，会跳到「教师反馈」。',
        en: 'At the very bottom of the sidebar is the `v1.x · What\'s new` line, then icons for theme, language, notifications, change password and sign out, and finally your avatar and name, which open your profile. The bell lists recent notifications and shows a dot when some are unread; clicking a teacher-feedback notification takes you to Feedback.',
      },
      { kind: 'h3', zh: '加入一门新课', en: 'Joining another course' },
      {
        kind: 'steps',
        zh: [
          '点侧栏「发现课程」，这里列出你还没加入的课程。',
          '在要加入的课程上点「加入课程」，输入老师给的 4 位验证码，点「确认加入」。',
        ],
        en: [
          'Click Discover in the sidebar. It lists the courses you have not joined.',
          'Click "Join course" on the one you want, enter the four-character code from your teacher, and click "Join".',
        ],
      },
      { kind: 'h3', zh: '个人资料', en: 'Your profile' },
      {
        kind: 'p',
        zh: '在「个人资料」里可以换头像（图片不超过 5 MB），填所在学院、年龄和一句话介绍，改完点「保存资料」。真实姓名由老师录入，学生在这里改不了。页面下方的「最近登录记录」列出你每次登录的时间和方式，保留 180 天。',
        en: 'In Profile you can change your avatar (images up to 5 MB) and fill in your college, age and a one-line introduction, then click "Save profile". Your real name is set by your teacher and cannot be changed here. "Recent sign-ins" further down lists when and how you signed in, kept for 180 days.',
      },
    ],
  },

  // ── 03 ────────────────────────────────────────────────────────────────
  {
    id: 'canvas',
    num: '03',
    title: { zh: '工作区：全班共用的画布', en: 'The workspace: one shared canvas' },
    blocks: [
      {
        kind: 'p',
        zh: '进课程后看到的是工作区，一块全班共用的画布。每张卡片是一条笔记，卡片之间的连线表示谁在谁的笔记上接着写了什么。',
        en: 'After entering a course you see the workspace: one canvas the whole class shares. Each card is a note, and the lines between cards show who continued whose note, and how.',
      },
      {
        kind: 'figure',
        src: '/manual/ui-canvas.jpg',
        cap: {
          zh: '工作区。最上面一行是这一周的探究问题，后面滚动着这个视图正在讨论的几个主题，再后面是笔记数量；左边是工具栏，画布上的方框是老师画的分区。',
          en: 'The workspace. The top strip shows this week\'s inquiry question, then the topics being discussed in this view rolling past, then the note counts; the toolbar is on the left, and the boxes on the canvas are areas your teacher drew.',
        },
      },
      {
        kind: 'p',
        zh: '问题后面滚动的是这个视图正在讨论的几个主题，由 AI 按画布上的笔记总结，每个主题后面的数字是涉及几条笔记。点一个主题，画布会移到相关的笔记上，它们亮几秒。笔记有变化时，最快三分钟更新一次。主题只说在讨论什么，不下结论。视图里的笔记少于三条时不显示；手机上没有这一行。鼠标放上去滚动就停；系统设了「减少动态效果」的，改成每五秒换一个。',
        en: 'The topics rolling past after the question are what this view is discussing, summarised by the AI from the notes on the canvas; the number after each is how many notes it covers. Click a topic and the canvas moves to those notes, which light up for a few seconds. As notes change it refreshes at most every three minutes. The topics say what is being discussed and draw no conclusions. They do not appear while a view has fewer than three notes, and the phone layout has no such strip. Hover to stop the scrolling; with "reduce motion" turned on in your system, it shows one topic at a time instead.',
      },
      { kind: 'h3', zh: '在画布上移动', en: 'Moving around the canvas' },
      {
        kind: 'clip',
        src: '/manual/c02-canvas',
        cap: {
          zh: '空白处按住拖动是平移，滚轮是缩放。单击一张卡片，右边打开它的详情。',
          en: 'Drag on empty space to pan and scroll to zoom. Click a card and its details open on the right.',
        },
      },
      {
        kind: 'demo',
        id: 'canvas',
        cap: {
          zh: '平移和缩放时，卡片和连线一起动。',
          en: 'When you pan or zoom, cards and lines move together.',
        },
      },
      {
        kind: 'table',
        head: [{ zh: '你想做', en: 'You want to' }, { zh: '怎么操作', en: 'Do this' }],
        rows: [
          [{ zh: '平移画布', en: 'Pan' }, { zh: '在空白处按住鼠标拖动', en: 'Drag on empty space' }],
          [{ zh: '放大缩小', en: 'Zoom' }, { zh: '滚动鼠标滚轮。进课程时默认 60%，右下角显示当前比例', en: 'Scroll. The course opens at 60%, and the current zoom shows at the bottom right' }],
          [{ zh: '回到笔记所在的地方', en: 'Go back to the notes' }, { zh: '点右下角的「重置视图」，画面会回到当前视图里笔记所在的地方', en: 'Click "Reset view" at the bottom right to return to where the notes in the current view are' }],
          [{ zh: '看一条笔记的详情', en: 'See a note\'s details' }, { zh: '单击卡片，右边打开详情面板', en: 'Click the card; the detail panel opens on the right' }],
          [{ zh: '打开整条笔记', en: 'Open the whole note' }, { zh: '双击卡片。笔记是独立页面，地址可以直接发给同学', en: 'Double-click the card. Each note has its own page, so you can share the link' }],
          [{ zh: '挪动卡片', en: 'Move a card' }, { zh: '按住卡片拖动。同一空间的成员都能挪动卡片，布局是大家共用的', en: 'Drag it. Anyone in the space can rearrange cards, since the layout is shared' }],
          [{ zh: '改卡片大小', en: 'Resize a card' }, { zh: '选中卡片后拖右下角的小手柄。右键选「固定」后，卡片就不能再拖动和改大小。固定对空间里所有人生效，谁都可以右键选「取消固定」', en: 'Select the card and drag the small handle at its bottom right. Right-click and choose Fixed to lock its position and size. The lock applies to everyone in the space, and anyone can right-click and choose Unfix' }],
          [{ zh: '把图片收成文件卡片', en: 'Show an image as a file card' }, { zh: '图片和视频上传后直接显示在画布上。右键选「显示为条目（仅文件名）」收成文件卡片，选「在画布上显示图片」换回来。和卡片位置一样，改了空间里的人都看得到', en: 'Images and videos show on the canvas as they are. Right-click and choose "Show as card (file name)" to turn one into a file card, or "Show media on canvas" to switch back. Like card positions, everyone in the space sees the change' }],
          [{ zh: '选中几条', en: 'Select several' }, { zh: '按住 Shift 逐条点选，画布上方会出现选择栏', en: 'Shift-click each card; a selection bar appears near the top' }],
          [{ zh: '把两条已有的笔记连起来', en: 'Link two existing notes' }, { zh: '按住 Shift 选中这两条，点选择栏里的「关联」，选一种关系，再点「建立关联」。默认后写的那条建立在先写的那条上，点「对调」可以反过来', en: 'Shift-select the two notes, click "Link" in the selection bar, pick a relation and click "Link notes". The later note builds on the earlier one by default; click "Swap" to reverse it' }],
        ],
      },
      { kind: 'h3', zh: '卡片上的信息', en: 'What a card shows' },
      {
        kind: 'list',
        zh: [
          '顶上的彩色条：这条笔记收到过哪几种 Build-on，颜色和第 5 节的六种关系对应。还没人接的是灰色。',
          '标题：卡片越高，显示的行数越多。',
          '底部：作者头像、姓名和发布时间。',
          '浅蓝底、名字旁有个「我」：你自己写的笔记。画布大了找不到时，点左侧工具栏的「我的笔记」：别人的卡片淡下去，顶上出现一条细栏，用左右箭头一条一条跳到自己的笔记，最新的在前；点 × 或按 Esc 退出。手机上在列表顶上点「我的」。',
          '「已有 Build-on」：已经有人接着这条往下写了。',
          '红色的 `! 数字`：有几位同学对它提出了质疑。',
          '左上角闪动的小红点：老师给这条写了你还没看的评语。',
          '左上角红色的「New」：同学发的笔记，你还没打开过。双击打开、看上几秒，回到画布它就不再标 New；只是单击选中、在右侧详情面板里扫一眼，New 还会留着。每个人各算各的，同学看没看过不影响你。9 月 15 日以前发的笔记不标。',
          '左上角的火和数字：整个空间里被 Build-on 次数最多的笔记，数字是次数。至少两次才算，并列最多的都会标。',
          '「可继续对话」：你采纳 AI 反馈后生成的对话式笔记，见第 7 节。',
        ],
        en: [
          'The coloured bar on top: which kinds of build-on this note has received, in the colours of the six relations in section 5. Grey means none yet.',
          'Title: the taller the card, the more lines show.',
          'Bottom: the author\'s avatar and name, and when it was posted.',
          'A light-blue card with "Me" next to the name: a note you wrote. When the canvas is too big to find them, click "My notes" in the left toolbar: other cards fade, and a bar at the top lets you jump through your notes one by one with the arrows, newest first; click × or press Esc to leave. On a phone, tap "Mine" at the top of the list.',
          '"Built on": someone has already continued from this note.',
          'A red `! n`: how many classmates have challenged it.',
          'A pulsing red dot at the top left: a teacher comment you have not read.',
          'A red "New" at the top left: a classmate\'s note you have not opened yet. Double-click to open it and read it for a few seconds; back on the canvas it no longer shows New. Just clicking it, or glancing at it in the detail panel, leaves the New in place. Everyone has their own, so what classmates have opened does not change yours. Notes posted before 15 September are not marked.',
          'A flame and a number at the top left: the note with the most build-ons in the space, and how many. It takes at least two, and ties all get the flame.',
          '"Open dialogue": a dialogue note created when you accepted AI feedback (section 7).',
        ],
      },
      { kind: 'h3', zh: '详情面板', en: 'The detail panel' },
      {
        kind: 'p',
        zh: '单击卡片后，右边的详情面板显示正文、它连着的共同问题、改进轨迹（修订次数、收到和发出的 Build-on）、和它有关系的笔记，以及它收到的 AI 反馈。正文放在一个单独的框里，全文都在，长的在框里上下滚动着看，不用打开笔记。底部的按钮：「编辑」打开这条笔记，只在你自己的笔记上出现；「建立于此」「补证据」「综合」都是在它上面写一条 Build-on，第 5 节细说。',
        en: 'Click a card and the detail panel on the right shows its text, the shared question it links to, its improvement trail (revisions, build-ons received and sent), related notes, and any AI feedback it received. The full text sits in a box of its own; scroll inside the box to read a long note without opening it. At the bottom, Edit opens the note and appears only on your own notes; Build-on, Evidence and Synthesize all start a build-on on it, as section 5 explains.',
      },
      { kind: 'h3', zh: '左边工具栏', en: 'The toolbar' },
      {
        kind: 'p',
        zh: '工具栏默认展开，图标旁边有文字。想让画布大一些，把工具栏右边缘往左拖，它会收成一列图标，下次进来还是收着的。最下面的「退出」回到首页，不会让你退出课程。',
        en: 'The toolbar starts expanded, with a label beside each icon. To give the canvas more room, drag its right edge to the left and it shrinks to icons; it stays that way next time. Exit at the bottom takes you back to the home page. It does not remove you from the course.',
      },
      {
        kind: 'figure',
        src: '/manual/ui-toolbar.jpg',
        cap: { zh: '工具栏分创建、建构、社区三组，下面是图例和「退出」。', en: 'The toolbar has three groups, Create, Build and Community, with the legend and Exit below.' },
      },
      {
        kind: 'table',
        head: [{ zh: '分组', en: 'Group' }, { zh: '工具', en: 'Tool' }, { zh: '用来做什么', en: 'What it does' }],
        rows: [
          [{ zh: '创建', en: 'Create' }, { zh: 'Note 创建', en: 'Create Note' }, { zh: '新写一条笔记', en: 'Write a new note' }],
          [{ zh: '', en: '' }, { zh: '绘图', en: 'Drawing' }, { zh: '在画布上画方框、箭头和文字，给内容分区', en: 'Draw boxes, arrows and text to organise the canvas' }],
          [{ zh: '', en: '' }, { zh: '附件', en: 'Attachment' }, { zh: '上传图片、文档、视频，单个文件最大 500 MB。PDF、Word 和 Markdown 可以在网页里直接读（第 9 节）', en: 'Upload images, documents and video, up to 500 MB each. PDF, Word and Markdown open in the browser (section 9)' }],
          [{ zh: '建构', en: 'Build' }, { zh: '探究', en: 'Inquiry' }, { zh: '打开「探究工具」：老师开了图灵测试时在这里进入，另外还有计算思维工具', en: 'Opens Inquiry tools: the Turing test when your teacher has opened one, and the computational thinking tool' }],
          [{ zh: '', en: '' }, { zh: '综合升华', en: 'Rise Above' }, { zh: '选几条笔记开一间讨论室，写一条更高一层的说法（第 8 节）', en: 'Open a discussion room on several notes and write a higher-level account (section 8)' }],
          [{ zh: '', en: '' }, { zh: 'Scaffold', en: 'Scaffolds' }, { zh: '查看这门课的支架（第 4 节）', en: 'Browse the course scaffolds (section 4)' }],
          [{ zh: '社区', en: 'Community' }, { zh: '我的笔记', en: 'My notes' }, { zh: '别人的卡片淡下去，用顶上细栏的左右箭头一条一条跳到自己写的笔记；再点一下、点 × 或按 Esc 退出', en: 'Fades other cards; the arrows in the bar at the top jump through the notes you wrote one by one. Click it again, click × or press Esc to leave' }],
          [{ zh: '', en: '' }, { zh: '视图', en: 'Views' }, { zh: '新建或切换画布', en: 'Create or switch canvases' }],
          [{ zh: '', en: '' }, { zh: 'Build-on 网络', en: 'Build-on Network' }, { zh: '全班的笔记怎么连在一起，你在其中哪里（第 10 节）', en: 'How the class\'s notes connect and where you are (section 10)' }],
          [{ zh: '', en: '' }, { zh: '时间线', en: 'Timeline' }, { zh: '按时间回看讨论（第 10 节）', en: 'Replay the discussion over time (section 10)' }],
          [{ zh: '', en: '' }, { zh: '观点图谱', en: 'Idea Graph' }, { zh: '你们组这一周讨论到哪了（第 10 节）', en: 'Where your group\'s discussion stands this week (section 10)' }],
          [{ zh: '', en: '' }, { zh: '小组', en: 'Groups' }, { zh: '你所在的小组和组员', en: 'Your group and its members' }],
        ],
      },
      { kind: 'h3', zh: '视图：分开的几块画布', en: 'Views: separate canvases' },
      {
        kind: 'p',
        zh: '一门课可以有几块画布，叫视图，主画布叫 Welcome。点工具栏「视图」，在框里输入名字按回车，就新建一块空画布并跳进去；原来的画布上会多一张这个视图的卡片，点它就能跳过去。顶栏右侧写着 `VIEW` 的菜单也能切换视图。笔记在哪块画布上写，就留在哪块画布上。',
        en: 'A course can have several canvases, called views; the main one is Welcome. Click Views in the toolbar, type a name and press Enter. A new empty canvas is created and you jump into it, and a card for it appears on the canvas you came from; click that card to jump across. The `VIEW` menu at the top right switches views too. Notes stay on the canvas they were written on.',
      },
    ],
  },

  // ── 04 ────────────────────────────────────────────────────────────────
  {
    id: 'write',
    num: '04',
    title: { zh: '写一条笔记', en: 'Writing a note' },
    blocks: [
      {
        kind: 'steps',
        zh: [
          '点工具栏第一个按钮「Note 创建」，打开笔记页。',
          '在「标题」里写你要说的那句话，比如「AI 可能让人不愿意自己思考」。写成「关于 AI 的思考」的话，别人看标题不知道你要说什么。',
          '在下面写正文。可以用标题、加粗、列表、链接和字体颜色，也可以插入图片和文档（每个不超过 6 MB）。',
          '写完点右下角「贡献」。笔记出现在画布上，全班都能看到。',
        ],
        en: [
          'Click the first toolbar button, "Create Note", to open the note page.',
          'In "Title", write the thing you actually want to say, such as "AI may make people less willing to think for themselves". A title like "Some thoughts on AI" tells nobody what you claim.',
          'Write the body below. You can use headings, bold, lists, links and text colour, and insert images and documents (up to 6 MB each).',
          'Click "Contribute" at the bottom right. The note appears on the canvas for everyone.',
        ],
      },
      {
        kind: 'figure',
        src: '/manual/ui-note-page.jpg',
        cap: {
          zh: '笔记页。左边是 AI 助手，中间窄栏是支架，右边写标题和正文，正文下面是 AI 自动反馈。',
          en: 'The note page. The AI assistant is on the left, scaffolds in the narrow middle column, the title and body on the right, and automatic AI feedback below the body.',
        },
      },
      {
        kind: 'callout',
        tone: 'warn',
        label: { zh: '先点「贡献」再离开', en: 'Contribute before you leave' },
        zh: ['笔记页没有自动保存。点「关闭」或「返回画布」时，没有贡献过的修改会丢掉。写到一半要离开，先点一次「贡献」，回来再接着改。'],
        en: ['The note page does not save automatically. "Close" or "Back to canvas" discards anything you have not contributed. If you need to stop halfway, click Contribute first and carry on editing later.'],
      },
      { kind: 'h3', zh: '笔记页上的几个部分', en: 'Parts of the note page' },
      {
        kind: 'table',
        head: [{ zh: '位置', en: 'Where' }, { zh: '作用', en: 'What it is for' }],
        rows: [
          [{ zh: '「撰写」页签', en: 'Compose tab' }, { zh: '写正文的地方，默认在这里', en: 'Where you write. The default tab' }],
          [{ zh: '「阅读」页签', en: 'Read tab' }, { zh: '不带编辑工具读一遍，老师的评语也在这里', en: 'Read it back without the editing tools; teacher comments show here too' }],
          [{ zh: '「Build-on」页签', en: 'Build-on tab' }, { zh: '谁在你这条上接着写了，你又接着写了谁', en: 'Who built on this note, and which notes it builds on' }],
          [{ zh: '「信息」页签', en: 'Info tab' }, { zh: '作者、时间和改进轨迹（最近几次修改）', en: 'Author, time and the improvement trail (recent revisions)' }],
          [{ zh: '字号、行距', en: 'Font size, line spacing' }, { zh: '只改你自己屏幕上的显示，不改变笔记本身', en: 'Change only how the note looks on your screen, not the note itself' }],
          [{ zh: '关键词', en: 'Keywords' }, { zh: '在页面底部输入后按回车，给笔记加标签', en: 'Type at the bottom of the page and press Enter to tag the note' }],
        ],
      },
      { kind: 'h3', zh: '用支架起头', en: 'Starting from a scaffold' },
      {
        kind: 'clip',
        src: '/manual/c03-scaffold',
        cap: {
          zh: '点「我的想法/观点是」，在方括号里写。回车换行，右括号跟着下来；点到右括号后面，接着写的是普通正文。',
          en: 'Click "My idea is" and write inside the brackets. Enter adds a line and the closing bracket follows. Click after the closing bracket and you are writing ordinary text again.',
        },
      },
      {
        kind: 'demo',
        id: 'scaffold',
        cap: {
          zh: '点一条支架，它插进正文，光标停在方括号里。',
          en: 'Click a scaffold: it goes into the body with the cursor inside the brackets.',
        },
      },
      {
        kind: 'p',
        zh: '支架是半句话的开头，比如「我的想法/观点是」「我不同意你的观点，理由是」「GenAI对这个概念的解释是」。在笔记页中间那一栏先选「支架组」，下面列出这一组的支架，点一条就插进正文。搜索框会在所有组里找，上次选的组会被记住。',
        en: 'A scaffold is the start of a sentence, such as "My idea is", "I disagree with your view because" or "GenAI\'s explanation of this concept is". In the middle column, choose a scaffold group and its scaffolds are listed below; click one to insert it. The search box looks across all groups, and your last group is remembered.',
      },
      {
        kind: 'p',
        zh: '和 GenAI 一起做事时，可以用这几组：「思考后询问 GAI」在提问之前和改提问时用；「GAI 回答的判断与取舍」在读完回答、决定用什么和改什么时用；「GAI 多方求证」在拿别的来源核对、请同学或老师看的时候用；「GAI 使用回顾与校准」在做完一次或几次任务以后用。话头后面写的是你自己的判断，不是 AI 的话。',
        en: 'When you work with GenAI, these groups help: "Think first, then ask GAI" is for before you ask and when you reword a question; "Judge and choose from GAI answers" for after you read an answer and decide what to use or change; "Check GAI with others" for checking against other sources or showing a classmate or teacher; "Review and recalibrate GAI use" for after one task or several. What you write after these prompts is your own judgement, not the AI\'s words.',
      },
      {
        kind: 'p',
        zh: '刚插入的支架，方括号里有一行灰色的「写在这里……」，提示你直接在括号里写，一打字它就消失。支架的话头是藏青色的，你写在方括号里的字是黑色。括号里的字和普通正文一样可以随便改。在括号里按回车是换行，右括号会跟到新一行的末尾。要在支架外面接着写，把光标点到右括号后面直接写，或者在那里按回车另起一段。',
        en: 'A newly inserted scaffold shows a grey "Write here…" inside the brackets to show where to type; it disappears as soon as you start. The scaffold prompt is navy and what you write inside the brackets is black. You can edit the bracketed text like any other text. Enter inside the brackets starts a new line, and the closing bracket moves to the end of it. To write outside the scaffold, click just after the closing bracket and type, or press Enter there for a new paragraph.',
      },
      {
        kind: 'p',
        zh: '先写了几句再加支架也可以。光标停在那一段里（句尾或它下面的空行也行），点一条支架，整段就被框进去；先选中几个字再点，只框选中的部分。',
        en: 'You can also add a scaffold after writing. With the cursor in a paragraph (or at its end, or on the empty line below it), click a scaffold and the whole paragraph is wrapped. Select a few words first and only those are wrapped.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        label: { zh: '支架插错了', en: 'Wrong scaffold?' },
        zh: ['话头和括号用键盘删不掉。把鼠标移到支架上，左上角会出现一个小叉，点它：框去掉，你写的字留下来变成普通段落。'],
        en: ['The prompt and brackets cannot be deleted with the keyboard. Hover over the scaffold and a small × appears at its top left. Click it: the frame goes and your words stay as a normal paragraph.'],
      },
      {
        kind: 'p',
        zh: '中间那一栏显示「暂无可用支架」，说明这门课没有设置支架。收到 AI 反馈以后，这一栏顶上有时会多出「AI 为这条笔记建议」，里面是 AI 按你这条笔记写的话头，用法和普通支架一样（第 7 节）。',
        en: 'If the column says "No scaffolds available", the course has none set up. After AI feedback, a box headed "AI suggests for this note" sometimes appears at the top of the column with a prompt written for your note. It works like any other scaffold (section 7).',
      },
      {
        kind: 'callout',
        tone: 'warn',
        label: { zh: '老师要求必须用支架时', en: 'When scaffolds are required' },
        zh: ['老师开了「强制使用支架」时，笔记里没有支架就贡献不了，标题下方会提示「这门课要求每条笔记至少使用一条支架」。在中间那一栏选一条，把你的话写进方括号，再点「贡献」。综合升华笔记不受这条限制。'],
        en: ['If your teacher has turned on "Require scaffold", a note without one cannot be contributed and a message appears under the title. Pick a scaffold in the middle column, write inside the brackets, and contribute again. Rise-above notes are exempt.'],
      },
      { kind: 'h3', zh: '保存和 AI 的关系', en: 'Saving and the AI' },
      {
        kind: 'p',
        zh: '新笔记还没贡献时也可以和 AI 对话：发第一条消息时，系统先把草稿存下来，它会出现在画布上。AI 自动反馈和「请求反馈」要等笔记贡献过一次才有。',
        en: 'You can talk to the AI before a new note is contributed: sending the first message saves the draft, and it appears on the canvas. Automatic feedback and "Ask AI" only work once the note has been contributed.',
      },
    ],
  },

  // ── 05 ────────────────────────────────────────────────────────────────
  {
    id: 'buildon',
    num: '05',
    title: { zh: '接着同学的笔记写：Build-on', en: 'Building on a classmate\'s note' },
    blocks: [
      {
        kind: 'p',
        zh: 'Build-on 是在同学的某条笔记上，接着写一条你自己的笔记，并写明你对它做了什么：延伸、澄清、提问、质疑、补证据，还是综合。画布上会有一条线把两条笔记连起来，箭头从你的笔记指向你接的那一条。',
        en: 'A build-on is a note of your own that continues a classmate\'s note and says what you did to it: extended, clarified, questioned, challenged, added evidence or synthesized. A line joins the two notes on the canvas, with the arrow pointing from your note to the one you built on.',
      },
      {
        kind: 'p',
        zh: '评论写完就停在那里了。Build-on 本身是一条笔记，别人还可以再接着它写，画布上因此能看出一个想法经过了哪些人、一步步怎么变化。',
        en: 'A comment stops where it is written. A build-on is a note in its own right that others can build on in turn, so the canvas shows how an idea changed as it passed from person to person.',
      },
      { kind: 'h3', zh: '怎么做', en: 'How to do it' },
      {
        kind: 'clip',
        src: '/manual/c04-buildon',
        cap: {
          zh: '单击同学的提问，点「建立于此」，选「澄清」，打开编辑器写回答。贡献以后，新卡片和连线出现在原笔记旁边。',
          en: 'Click a classmate\'s question, choose Build-on, pick Clarify and write the answer in the editor. After you contribute, the new card and its line appear beside the original.',
        },
      },
      {
        kind: 'demo',
        id: 'buildon',
        cap: {
          zh: '选一条笔记，选关系类型，写你的笔记，连线自动画出来。',
          en: 'Pick a note, pick a relation, write your note. The line is drawn for you.',
        },
      },
      {
        kind: 'steps',
        zh: [
          '在画布上单击你要接的那条笔记，右边打开详情面板。',
          '点面板底部的「建立于此」。「补证据」和「综合」也是 Build-on，只是预先选好了关系类型。在卡片上右键选「建立于此」也一样。',
          '弹出的「Build-on · 知识建构」里能看到你要接的那条笔记。选一种关系，点「打开编辑器」。已经打开了同学的笔记的话，点笔记页右下角的「Build-on」，在弹出的六种方式里选一种，效果一样。',
          '笔记页顶上显示「正在 Build-on 已有想法」，左侧先显示你在回应的那条笔记的全文。看完可以收起，写的时候想再看，点顶上的「原笔记」。写好标题和正文，点「贡献」。',
        ],
        en: [
          'Click the note you want to continue. The detail panel opens on the right.',
          'Click "Build-on" at the bottom of the panel. "Evidence" and "Synthesize" are build-ons too, with the relation already chosen. Right-clicking the card and choosing Build-on does the same.',
          'The "Build-on" dialog shows the note you are continuing. Pick a relation and click "Open editor". If you already have a classmate\'s note open, click "Build-on" at the bottom right of the note page and pick one of the six relations instead.',
          'The note page shows "Building on an existing idea" at the top, and the note you are responding to opens in full on the left. Collapse it when you have read it, and reopen it from "Original note" at the top while you write. Write a title and body, then click "Contribute".',
        ],
      },
      {
        kind: 'callout',
        tone: 'warn',
        label: { zh: '注意', en: 'Note' },
        zh: ['先选中一条笔记、再点工具栏的「Note 创建」，得到的是一条普通笔记，不会连到选中的那条上。要 Build-on，用详情面板或右键菜单里的「建立于此」。'],
        en: ['Selecting a note and then clicking "Create Note" in the toolbar gives you an ordinary note with no link to the selected one. To build on a note, use Build-on in the detail panel or the right-click menu.'],
      },
      { kind: 'h3', zh: '六种关系', en: 'The six relations' },
      {
        kind: 'p',
        zh: '关系类型写明你对那条笔记做了什么，按实际情况选：',
        en: 'The relation says what you did to that note, so choose the one that fits:',
      },
      {
        kind: 'table',
        head: [{ zh: '类型', en: 'Type' }, { zh: '什么时候用', en: 'When' }, { zh: '可以这样开头', en: 'You might start with' }],
        rows: [
          [{ zh: '延伸', en: 'Extend' }, { zh: '同意，还能往前推一步', en: 'You agree and can take it a step further' }, { zh: '「顺着这个想，还可以……」', en: '"Following that, we could also…"' }],
          [{ zh: '澄清', en: 'Clarify' }, { zh: '对方说得含糊，你帮着说清楚', en: 'It was vague and you can make it clearer' }, { zh: '「这里的『X』应该是指……」', en: '"By X, I think we mean…"' }],
          [{ zh: '提问', en: 'Question' }, { zh: '你有一个真想知道答案的问题', en: 'You have a question you really want answered' }, { zh: '「那如果是……的情况呢？」', en: '"What about the case where…?"' }],
          [{ zh: '质疑', en: 'Challenge' }, { zh: '你不同意，而且说得出理由', en: 'You disagree and can say why' }, { zh: '「我觉得这里有问题，因为……」', en: '"I see a problem here, because…"' }],
          [{ zh: '证据', en: 'Evidence' }, { zh: '你找到了支持或反对它的材料', en: 'You found material for or against it' }, { zh: '「我查到一份资料，它说……」', en: '"I found a source that says…"' }],
          [{ zh: '综合', en: 'Synthesize' }, { zh: '你把几种说法放到了一起', en: 'You brought several accounts together' }, { zh: '「这几种说法其实都在讲……」', en: '"These accounts are all about…"' }],
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        label: { zh: '挑哪一条来接', en: 'What to build on' },
        zh: ['卡片上有红色 `! 数字` 的，说明有人质疑过，那里往往正在争论。没有「已有 Build-on」标记的笔记还没人回应，接它最能推动讨论。观点图谱里的「尚无人建构」把这些笔记直接列了出来（第 10 节）。'],
        en: ['A red `! n` means someone challenged the note, and that is usually where the argument is. A note without "Built on" has not been answered yet, so continuing it moves the discussion most. The idea graph lists these under "Not built on yet" (section 10).'],
      },
      {
        kind: 'callout',
        tone: 'warn',
        label: { zh: '质疑要给理由', en: 'Give a reason when you challenge' },
        zh: ['「我不同意」后面要跟理由或反例。只写「我觉得不对」，别人没法接着往下讨论。'],
        en: ['"I disagree" needs a reason or a counter-example after it. "I think that is wrong" on its own gives nobody anything to continue from.'],
      },
    ],
  },

  // ── 06 ────────────────────────────────────────────────────────────────
  {
    id: 'ai',
    num: '06',
    title: { zh: '和 AI 对话', en: 'Talking with the AI' },
    blocks: [
      {
        kind: 'p',
        zh: '笔记页左边是 AI 助手，它读得到你正在写的这条笔记。它默认是打开的，笔记页顶栏的「AI 助手」按钮可以收起或打开它。',
        en: 'The AI assistant sits on the left of the note page and can read the note you are writing. It is open by default; the "AI partner" button in the note page\'s top bar hides or shows it.',
      },
      { kind: 'h3', zh: '自由提问和五种模式', en: 'Free ask and the five modes' },
      {
        kind: 'clip',
        src: '/manual/c05-note-ai',
        cap: {
          zh: '用「自由提问」问一个概念。AI 先显示「正在思考」，再一段段写出回答，表格和列表会排好版。写完后下面出现「添加到 Note」和「发布为新 Note」。',
          en: 'Using Free ask to ask about a concept. The AI shows "Thinking", then writes the answer bit by bit, with tables and lists laid out. When it finishes, "Add to Note" and "Publish as Note" appear below.',
        },
      },
      {
        kind: 'p',
        zh: '输入框上方的下拉菜单用来选模式。默认的「自由提问」就是普通问答，你问什么它答什么，也不去读画布上别人的笔记。另外五种模式会读取笔记的上下文，多用追问来帮你把想法理清：',
        en: 'The drop-down above the input box picks the mode. The default, Free ask, is ordinary question and answer: it answers what you ask and does not read other people\'s notes. The other five modes read the note\'s context and mostly ask you questions to help you sort out your thinking:',
      },
      {
        kind: 'table',
        head: [{ zh: '模式', en: 'Mode' }, { zh: '它会做什么', en: 'What it does' }, { zh: '什么时候用', en: 'When to use it' }],
        rows: [
          [{ zh: '自由提问', en: 'Free ask' }, { zh: '直接回答你的问题', en: 'Answers your question directly' }, { zh: '查概念、问做法、想要一个直接的答案时', en: 'Looking up a concept, asking how to do something, or wanting a straight answer' }],
          [{ zh: '观点澄清', en: 'Idea clarification' }, { zh: '帮你把当前的想法说清楚，再提一个可以继续推进的问题', en: 'Helps you state the idea clearly, then asks one question to take it further' }, { zh: '自己也觉得还没说清楚时', en: 'When you can tell it is not clear yet' }],
          [{ zh: '探究缺口', en: 'Inquiry gaps' }, { zh: '指出解释、证据或概念上缺了什么，补不补由你决定', en: 'Points out gaps in explanation, evidence or concepts, and leaves the decision to you' }, { zh: '写完一条，想检查一遍时', en: 'After finishing a note, as a check' }],
          [{ zh: '观点关联', en: 'Idea connections' }, { zh: '找出画布上相关的笔记和可以 Build-on 的地方', en: 'Finds related notes and places to build on' }, { zh: '想找该接谁的笔记时', en: 'When looking for something to build on' }],
          [{ zh: '证据检验', en: 'Evidence testing' }, { zh: '找可以核查的证据并整理出来，结论留给你', en: 'Finds and organises checkable evidence, leaving the conclusion to you' }, { zh: '只有观点、还没有依据时', en: 'When you have a position but no grounds' }],
          [{ zh: '观点提升', en: 'Idea rise-above' }, { zh: '描述几条想法之间的共同点和矛盾，综合由你来写', en: 'Describes what several ideas share and where they clash; the synthesis is yours to write' }, { zh: '准备做综合升华时。写综合升华笔记时会自动选它', en: 'Before a rise-above. It is chosen automatically when you write a rise-above note' }],
        ],
      },
      {
        kind: 'p',
        zh: '「证据检验」要联网搜索，需要老师先配置；没有配置时它在菜单里是灰色的。',
        en: 'Evidence testing searches the web, which your teacher has to set up first. Until then it is greyed out in the menu.',
      },
      { kind: 'h3', zh: '输入框里的其他按钮', en: 'Other controls' },
      {
        kind: 'list',
        zh: [
          '「优化提问」：把你的问题改写得更清楚，不会替你回答。不满意可以点撤销图标还原。',
          '模型菜单：「默认 · 课程首选模型」用老师配置的第一个模型，也可以指定一个模型。',
          '「回答长度」：简短、适中、详细，大约 250、550、1000 字，默认适中。这只是比例，AI 会按问题的难易再增减：简单的问题写得更短，难的写得更长；回答一定写完整，不会说到一半停下。选一次就记住，知识空间助手也用同一个选择。',
          '「画图」（带画笔的图标）、「让 AI 看整块画布」「上传图片或文件」三个按钮在右边。每个文件不超过 8 MB，一次最多 4 个，文件上会标出 AI 读得到内容还是只看得到文件名。',
          '面板顶上一行有「新建对话」和「历史对话」。「新建对话」开一段新的，原来的那段还在。「历史对话」列出这条笔记下你以前和 AI 的对话，每段用你问的第一句话标出来，点一条就能接着看、接着问。',
          '不想留的对话，在「历史对话」里点它右边的垃圾桶图标，确认后这段对话就不再显示。只能删自己的。',
          '提问发出去以后，AI 那一栏会一步步显示它在做什么：用到工具时（找相关笔记、查 Build-on 关系、联网搜索等）每一步一行，先转圈，做完打勾，写上结果和用了几秒；最后一行是「正在思考」或「正在组织回答」，等了三秒以上会显示已经等了几秒。字开始写出来以后，这些步骤收成一行「用了 N 步 · X 秒」，点开还能看；文字末尾的小点在跳说明还在写，小点不见了就是写完了。',
        ],
        en: [
          '"Refine question" rewrites your question more clearly without answering it. Use the undo icon to get your original back.',
          'The model menu: "Default · course model" uses the first model your teacher set up, or you can pick a specific model.',
          '"Answer length": Brief, Medium or Detailed, roughly 250, 550 and 1000 characters, Medium by default. These are proportions: the AI writes less for a simple question and more for a hard one, and always finishes the answer rather than stopping midway. Your choice is remembered and the workspace assistant uses it too.',
          '"Draw" (the picture icon), "Show the AI the whole canvas" and "Attach an image or file" sit on the right. Files can be up to 8 MB, four at a time, and each is marked with whether the AI can read its content or only its name.',
          'The top row of the panel has "New chat" and "History". "New chat" starts a fresh conversation and the old one stays. "History" lists your earlier conversations with the AI on this note, each named by the first thing you asked. Click one to read it or carry on.',
          'To drop a conversation, click the bin icon on its right in "History" and confirm; it no longer shows. You can only delete your own.',
          'After you send a question, the AI row shows what it is doing step by step: when it uses a tool (finding related notes, looking up Build-on links, searching the web and so on) each step gets a line that spins, then ticks, with what it found and how many seconds it took; the last line says "Thinking" or "Putting the answer together", with the seconds you have waited once it passes three. When the text starts to appear, the steps fold into one line, "N steps · X s", which you can open again; the dots after the text keep bouncing while it is still writing and disappear when it is done.',
        ],
      },
      {
        kind: 'p',
        zh: '回答写完后，下面有「添加到 Note」「发布为新 Note」和一个重新生成的图标。只想用其中一段，可以选中那几句，弹出的小菜单里同样有这两项，另外还有「添加到聊天框」。',
        en: 'When an answer is finished, "Add to Note", "Publish as Note" and a regenerate icon appear below it. To use only part of it, select those sentences: the small menu that pops up has the same two options, plus "Add to chat".',
      },
      { kind: 'h3', zh: '把 AI 的内容放进笔记', en: 'Putting AI text into your note' },
      {
        kind: 'clip',
        src: '/manual/c06-insert',
        cap: {
          zh: '点「添加到 Note」，在对话框里选一条 AI 相关的支架。插进笔记的内容带着「AI 来源」标记。',
          en: 'Click "Add to Note" and pick an AI-related scaffold in the dialog. The text goes into the note with an "AI source" mark.',
        },
      },
      {
        kind: 'p',
        zh: '「添加到 Note」会打开一个对话框。课程设了 AI 相关的支架时，选一条说明你怎么用这段内容，比如「GenAI对这个概念的解释是」；没有这类支架时，从「给了我没想到的角度」「帮我说得更清楚」「提供了证据或例子」「先放着，待我查证」里选一项。理由可写可不写。',
        en: '"Add to Note" opens a dialog. If the course has AI-related scaffolds, pick one that says how you are using the text, such as "GenAI\'s explanation of this concept is". If it has none, choose one of "A new angle", "Says it more clearly", "Evidence or example" and "Keep for now, verify later". A reason is optional.',
      },
      {
        kind: 'p',
        zh: '对话框里的「GAI 回答的判断与取舍」这一组，说明你对这段话的态度：已用别的来源核对过、拿来改写、当作反例检验、和我看法不同、追问后补充的证据、只是帮我整理了自己的想法。按你实际做的选，不用为了显得认真选别的。',
        en: 'In the dialog, the group "Judge and choose from GAI answers" says what you think of the text: checked against another source, rewritten, tested as a counter-example, differs from my view, evidence added when I pressed it, or GenAI only organised my own ideas. Pick what you actually did; there is no need to choose something that looks more careful.',
      },
      {
        kind: 'p',
        zh: '插进笔记的内容外面有一个框，标着「AI 来源」和所用的模型，读你笔记的人能分清哪段来自 AI。直接复制粘贴进来的 AI 文字不带这个标记。',
        en: 'The inserted text sits in a box marked "AI source" with the model that produced it, so readers can tell which part came from the AI. Text you copy and paste yourself carries no such mark.',
      },
      {
        kind: 'p',
        zh: '「发布为新 Note」把这段回答发成画布上的一条新笔记，作者显示为 AI Partner，并连到你的笔记上。发布前要写标题，选它和你这条笔记的关系，并说明为什么值得发布。',
        en: '"Publish as Note" posts the answer as a new note on the canvas, shown with the author AI Partner and linked to your note. Before publishing you give it a title, choose its relation to your note, and say why it is worth publishing.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        label: { zh: '用 AI 的回答时', en: 'Using what the AI says' },
        zh: ['先读懂，再用自己的话写进笔记，并写下你同意或不同意的地方。里面的事实和出处要自己核对，AI 会说错。'],
        en: ['Understand it first, then write it into your note in your own words, along with where you agree or disagree. Check the facts and sources yourself; the AI gets things wrong.'],
      },
      { kind: 'h3', zh: '知识空间助手', en: 'The workspace assistant' },
      {
        kind: 'p',
        zh: '画布顶栏的「助手」打开知识空间 AI 助手。它占屏幕的一半，宽度可以拖，下次打开还是你拖的宽度。它看的是整个空间，包括笔记之间谁 Build-on 了谁，适合问「这块画布上讨论到哪了」「哪些想法还没人接着写」这类问题。平台怎么用的问题，问页面右边的「使用帮助」，见第 13 节。',
        en: '"Agent" in the canvas top bar opens the workspace AI assistant. It takes up half the screen; drag its edge to change the width and it remembers your choice. It looks at the whole space, including who has built on whom, so it suits questions like "where has the discussion on this canvas got to" and "which ideas has nobody built on yet". For questions about using the platform, use Help on the right edge of the page (section 13).',
      },
      {
        kind: 'figure',
        src: '/manual/ui-workspace-ai.jpg',
        cap: {
          zh: '点开「讨论速览」，把当前视图整理成存在分歧的问题、不同观点、已形成的共识和尚无人建构的笔记。',
          en: 'Open the discussion overview and it sorts the current view into contested questions, differing positions, points of agreement, and notes nobody has built on.',
        },
      },
      {
        kind: 'clip',
        src: '/manual/c12-workspace-ai',
        cap: {
          zh: '问「哪些提问还没有人回应」。等待时显示已经等了几秒，推理过程和用到的工具一条条出现，然后是回答。',
          en: 'Asking which questions nobody has answered. While you wait it shows the seconds elapsed, then its reasoning and the tools it used, then the answer.',
        },
      },
      {
        kind: 'list',
        zh: [
          '输入框下面一排：回形针附文件，「整个空间」选范围，接着是模型和「回答长度」（和笔记页的 AI 助手共用一个选择），右边是「画图」和发送。范围不勾选就是整个空间；勾几条笔记，AI 会读到这几条更完整的正文。',
          '「画图」：在输入框里写下想画什么，点「画图」直接出图；还没写就点，输入框里会先填上「画一张：」，接着写完再点。',
          '它能看到笔记之间的 Build-on：谁 Build-on 了谁、是延伸还是质疑、哪些想法被接得最多、哪些还没人接。',
          '「讨论速览」平时收成一行，点开后选「当前 View」「本组讨论」或「选中的 N 条」（在画布上按住 Shift 选中的笔记），再点「生成速览」。它只整理已有的内容，不下结论。',
          '可以附图片和文件，一条消息最多 4 个，同时要写几句话。',
          '你和助手的对话会存下来。再打开面板，接着的是这个空间里最近的一段；顶上的「新对话」另开一段，「历史对话」里是最近的 30 段，点一段就接着聊。回答还没说完时不能切换。',
        ],
        en: [
          'The row under the input box: the paperclip attaches files, "Whole space" sets the scope, then the model and "Answer length" (shared with the note page\'s AI assistant), with "Draw" and send on the right. With nothing ticked the scope is the whole space; tick some notes and the AI reads more of their text.',
          '"Draw": type what you want drawn and click "Draw" to get the picture straight away; click it with an empty box and it starts the box with "画一张：" for you to finish.',
          'It can see the Build-ons between notes: who has built on whom, whether it extends or challenges, which ideas have been built on most, and which nobody has built on.',
          'The discussion overview is folded into one line; open it, choose "Current view", "Group discussion" or "N selected" (notes you Shift-selected on the canvas), then click "Generate". It sorts what is there and draws no conclusions.',
          'You can attach images and files, up to four per message, as long as you also write something.',
          'Your chats with the assistant are kept. When you open the panel again it continues the latest chat in this space; "New chat" at the top starts another, and "History" lists the last 30 chats, each one a click away. You cannot switch while an answer is still coming in.',
        ],
      },
      { kind: 'h3', zh: '让 AI 画图', en: 'Asking for a picture' },
      {
        kind: 'p',
        zh: '在 AI 对话里说「画一张……」「帮我画个……」，AI 会直接画图。笔记页的 AI 助手、知识空间助手、「AI 对话」、文档旁的 AI 侧栏和对话式笔记都可以这样用。图由课程设置的绘图模型来画（一般是 DMX，六到十秒），等的时候对话里会显示画到了哪一步；其他问题照常由对话模型回答。',
        en: 'Say "draw a …" in an AI chat and the AI draws it. This works in the note page\'s AI assistant, the workspace assistant, AI chat, the AI panel beside documents and dialogue notes. The course\'s image model does the drawing (usually DMX, six to ten seconds), and the chat shows how far it has got while you wait; everything else is answered by the chat model as before.',
      },
      {
        kind: 'p',
        zh: 'AI 只按你写的这句话画，不会先去读空间里的笔记，所以要把图里该有的东西写清楚。要画流程图、思维导图、概念图或统计图表时，这句话会交给对话模型处理，因为绘图模型写不准图里的文字。拿到图后检查上面的文字和箭头对不对。',
        en: 'The AI draws only from the sentence you wrote and does not read the notes in the space first, so say what the picture should contain. Requests for flowcharts, mind maps, concept maps or charts go to the chat model instead, because image models cannot write the labels reliably. Check the labels and arrows on any picture you get.',
      },
      {
        kind: 'clip',
        src: '/manual/c07-image',
        cap: {
          zh: '请知识空间助手画一张对比图。助手认出这是画图的要求，直接交给绘图模型；等图的几秒里对话中显示画到了哪一步，画好后图出现在对话里。',
          en: 'Asking the workspace assistant for a comparison picture. It recognises a drawing request and passes it straight to the image model; while you wait, the chat shows how far the drawing has got, and then the picture appears.',
        },
      },
    ],
  },

  // ── 07 ────────────────────────────────────────────────────────────────
  {
    id: 'feedback',
    num: '07',
    title: { zh: 'AI 自动反馈', en: 'Automatic AI feedback' },
    blocks: [
      {
        kind: 'p',
        zh: '笔记页正文下面是「AI 自动反馈」。你停笔以后，如果 AI 觉得这条笔记有值得提醒的地方，这里会出现一张反馈卡片。多数时候它不会出声。',
        en: 'Below the body of the note page is "AI auto feedback". When you stop typing, a feedback card appears there if the AI thinks something in the note is worth raising. Most of the time it stays quiet.',
      },
      {
        kind: 'clip',
        src: '/manual/c08-feedback',
        cap: {
          zh: '停笔后显示「正在检查」，接着出现反馈卡片，支架栏顶上多了一条 AI 写的话头。补一段自己的经历，用这条话头框起来，再点「采纳」。',
          en: 'After a pause the section shows "Checking", then a feedback card appears and a prompt written by the AI shows up at the top of the scaffold column. The student adds a paragraph from her own experience, wraps it with that prompt, and clicks Accept.',
        },
      },
      { kind: 'h3', zh: '什么时候会出现', en: 'When it appears' },
      {
        kind: 'list',
        zh: [
          '笔记至少贡献过一次。',
          '正文在 120 字以上，而且和上次检查时相比有改动。',
          '你停止打字 2.6 秒后检查一次，两次检查至少隔 45 秒；老师还可以把间隔设得更长。',
          '检查时，反馈区显示「正在检查...」。',
        ],
        en: [
          'The note has been contributed at least once.',
          'The body has at least 120 characters and has changed since the last check.',
          'It checks 2.6 seconds after you stop typing, at most once every 45 seconds; your teacher can set a longer gap.',
          'While checking, the section shows "Checking…".',
        ],
      },
      {
        kind: 'p',
        zh: '不想等，可以点「请求反馈」立刻要一条（正文至少 30 字）。反馈卡片左上角标着它的类型：',
        en: 'If you do not want to wait, click "Ask AI" for feedback right away (the body needs at least 30 characters). The top left of each card shows its type:',
      },
      {
        kind: 'table',
        head: [{ zh: '类型', en: 'Type' }, { zh: '说明', en: 'Meaning' }],
        rows: [
          [{ zh: '未消化的 AI 内容', en: 'Undigested AI' }, { zh: '贴进来的 AI 内容还没用自己的话消化', en: 'Pasted AI text that has not been put into your own words' }],
          [{ zh: '缺推理', en: 'No reasoning' }, { zh: '有结论，没说为什么', en: 'A conclusion without reasons' }],
          [{ zh: '缺证据', en: 'No evidence' }, { zh: '有主张，没有依据', en: 'A claim without grounds' }],
          [{ zh: '缺联系', en: 'No connection' }, { zh: '和同学的想法很接近，但没有连起来', en: 'Close to a classmate\'s idea but not linked to it' }],
          [{ zh: '有潜力的想法', en: 'Promising idea' }, { zh: '值得继续往下做', en: 'Worth taking further' }],
          [{ zh: '表意不清', en: 'Unclear' }, { zh: '有地方说得不清楚，或者看起来卡住了', en: 'Something is unclear, or you seem stuck' }],
        ],
      },
      { kind: 'h3', zh: '卡片上的三个按钮', en: 'The three buttons on a card' },
      {
        kind: 'figure',
        src: '/manual/ui-feedback-actions.jpg',
        cap: {
          zh: '点「不同意」以后，选一项最接近的理由就完成了。',
          en: 'After clicking Disagree, picking the closest reason is all it takes.',
        },
      },
      {
        kind: 'clip',
        src: '/manual/c14-followup',
        cap: {
          zh: '点「追问」，反馈原文被放进左边的输入框。补一句自己的问题再发出去，AI 接着回答。',
          en: 'Click Follow up and the feedback text is placed in the input box on the left. Add your own question, send it, and the AI answers.',
        },
      },
      {
        kind: 'table',
        head: [{ zh: '按钮', en: 'Button' }, { zh: '点了之后', en: 'What happens' }],
        rows: [
          [{ zh: '采纳', en: 'Accept' }, { zh: '画布上在你这条笔记旁边生成一张对话式笔记，标题由 AI 总结这条反馈在谈什么，用「延伸」关系连回你的笔记。你可以在里面接着追问（见本节最后）', en: 'A dialogue note appears on the canvas beside your note, titled by the AI with what the feedback is about, and linked back to your note as an extension. You can keep asking questions in it (see the end of this section)' }],
          [{ zh: '不同意', en: 'Disagree' }, { zh: '出现「哪一点不合适？点一下就好」，在「误解了我的意思」「我已经考虑过了」「和我的探究无关」「我不认同这个判断」里点一项就完成了。想补充几句，先展开「想多说两句」写好，再点理由', en: '"What doesn\'t fit? One tap is enough" appears. Tap one of "Misread my point", "Already considered", "Not my focus" and "I disagree" and you are done. To add a comment, open "Add a note" and write it before tapping a reason' }],
          [{ zh: '追问', en: 'Follow up' }, { zh: '反馈原文被放进左边 AI 助手的输入框，面板打开。补上你的问题再发送', en: 'The feedback text is put into the AI assistant\'s input box on the left and the panel opens. Add your question and send it' }],
          [{ zh: '右上角的 ×', en: 'The × at the top right' }, { zh: '收起卡片，记为未处理', en: 'Collapses the card; it is recorded as not handled' }],
        ],
      },
      {
        kind: 'p',
        zh: '收到过不止一条反馈时，反馈区会出现「历史」，可以看以前的反馈。在画布上单击这条笔记，详情面板里也列着它收到的反馈，点「打开笔记处理 N 条反馈」可以回到笔记页处理。',
        en: 'Once a note has had more than one piece of feedback, a History link lets you see the earlier ones. Clicking the note on the canvas also lists its feedback in the detail panel, with a link back to the note page to deal with it.',
      },
      { kind: 'h3', zh: 'AI 写的话头', en: 'Prompts written by the AI' },
      {
        kind: 'p',
        zh: '有新反馈时，笔记页中间那一栏顶上可能出现「AI 为这条笔记建议」，里面是 AI 看了你这条笔记后写的半句话，比如「我对照了两次经历，发现」。它只针对这条笔记，用法和普通支架一样：先写一段，再点它，整段就被框进去。用过一次以后它就不再显示。',
        en: 'With new feedback, "AI suggests for this note" may appear at the top of the middle column, holding a half-sentence the AI wrote after reading your note, such as "Comparing the two times, I noticed". It belongs to this note only and works like any scaffold: write a paragraph, then click it to wrap the paragraph. Once used, it disappears.',
      },
      { kind: 'h3', zh: '对话式笔记', en: 'Dialogue notes' },
      {
        kind: 'p',
        zh: '点「采纳」生成的卡片上标着「可继续对话」。双击它打开对话式笔记，可以就这条反馈继续问下去。每条 AI 回复下面有「插入原笔记」和「发布为新笔记」：前者打开你的原笔记，把这段文字接在末尾；后者用这段文字新开一条笔记。两种情况都是改完再点「贡献」才会保存。',
        en: 'The card created by Accept is marked "Open dialogue". Double-click it to open the dialogue note and keep asking about that feedback. Under each AI reply are "Insert into source" and "Publish as note". The first opens your original note with the text added at the end; the second starts a new note with it. Either way, nothing is saved until you edit it and click Contribute.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        label: { zh: '怎么用才有收获', en: 'Getting something out of it' },
        zh: ['把反馈里的问题当成真问题来回答。它问「你是在哪几次任务里注意到的」，就去找出那几次，写进笔记。笔记因此多了一条证据，这比点「采纳」这个动作重要得多。'],
        en: ['Treat the question in the feedback as a real question. If it asks which tasks you noticed this in, go and find them and write them into the note. The note gains a piece of evidence, which matters far more than the click on Accept.'],
      },
    ],
  },

  // ── 08 ────────────────────────────────────────────────────────────────
  {
    id: 'riseabove',
    num: '08',
    title: { zh: '综合升华', en: 'Rise above' },
    blocks: [
      {
        kind: 'p',
        zh: '讨论进行一段时间后，画布上常有几条笔记讲同一件事，角度不同，甚至互相矛盾。综合升华就是把它们放在一起讨论，写出一条能同时容纳这几种说法的新说法。',
        en: 'After a while the canvas often holds several notes about the same thing from different angles, sometimes contradicting each other. A rise-above brings them together and produces a new account that can hold all of them.',
      },
      {
        kind: 'p',
        zh: '摘要只转述「甲说 A，乙说 B」。综合升华要写出之前没有人写过的一句话，这句话能把 A 和 B 都装进去。',
        en: 'A summary only reports that A said this and B said that. A rise-above is a sentence nobody had written yet, one that can hold both A and B.',
      },
      {
        kind: 'demo',
        id: 'riseabove',
        cap: {
          zh: '选几条互相矛盾的笔记，写一条能同时容纳它们的说法。',
          en: 'Select notes that pull against each other and write the account that holds them together.',
        },
      },
      { kind: 'h3', zh: '一个例子', en: 'An example' },
      {
        kind: 'list',
        zh: [
          '甲：AI 只是在算概率，谈不上理解。',
          '乙：它答得比人还好，凭什么说它不懂？',
          '综合升华：两边用的判断标准不同，一个看它内部在做什么，一个看它表现出来什么。更值得问的也许是「它靠什么在懂」。',
        ],
        en: [
          'A: it is only computing probabilities, so there is no understanding in it.',
          'B: it answers better than people do, so on what grounds do we say it does not understand?',
          'Rise above: the two of you judge by different standards, one by what happens inside it, the other by how it performs. A better question may be what its understanding rests on.',
        ],
      },
      { kind: 'h3', zh: '怎么做', en: 'How to do it' },
      {
        kind: 'steps',
        zh: [
          '按住 Shift，在画布上逐条点选要放在一起讨论的笔记（2 到 12 条），上方的选择栏会显示「N 已选」。',
          '点选择栏里的「Rise Above」，打开讨论室。也可以点工具栏「综合升华」，在「选几条笔记来讨论」里勾选，再点「就这几条开始讨论」；这里还列着你之前没发布的讨论室。',
          '在讨论室里和组员讨论。想让某位 AI 同学说话，先点它，再发送你的消息。',
          '讨论出结果后，在右边「写下你们的说法」里填标题和正文（至少 20 字），点「发布」。',
        ],
        en: [
          'Hold Shift and click each note you want to discuss together (2 to 12). The selection bar at the top shows "N selected".',
          'Click "Rise Above" in the selection bar to open a discussion room. You can also click Rise Above in the toolbar, tick notes under "Pick notes to discuss", and click "Start a Rise Above room"; rooms you have not published yet are listed there too.',
          'Discuss with your group in the room. To bring in an AI classmate, click it before you send your message.',
          'When you have an answer, fill in the title and text (at least 20 characters) under "Write your account" on the right, and click "Publish".',
        ],
      },
      {
        kind: 'clip',
        src: '/manual/c09-riseabove',
        cap: {
          zh: '按住 Shift 选三条笔记，开讨论室，叫上「爱唱反调」。写下这一组的说法并发布，画布上多了一条综合升华笔记。',
          en: 'Shift-select three notes, open a room and call on "Plays devil\'s advocate". Write the group\'s account and publish it, and a rise-above note appears on the canvas.',
        },
      },
      { kind: 'h3', zh: '讨论室', en: 'The discussion room' },
      {
        kind: 'p',
        zh: '讨论室是一个独立页面，有自己的地址。中间上方是几条来源笔记，点开能看原文，也能跳到画布上看；下面是群聊。左边是五位 AI 同学，各有一个说话习惯：',
        en: 'The room is a page of its own with its own address. The source notes are at the top of the centre column; open one to read it or jump to it on the canvas. The group chat is below. On the left are five AI classmates, each with a habit:',
      },
      {
        kind: 'table',
        head: [{ zh: 'AI 同学', en: 'AI classmate' }, { zh: '习惯', en: 'Habit' }],
        rows: [
          [{ zh: '刨根问底', en: 'Pins it down' }, { zh: '你说的那个词到底指什么', en: 'What exactly do you mean by that?' }],
          [{ zh: '爱举例子', en: 'Wants examples' }, { zh: '说得太虚了，举个具体的', en: 'Too abstract, give me a case' }],
          [{ zh: '爱唱反调', en: 'Plays devil\'s advocate' }, { zh: '那如果反过来想呢', en: 'What if the opposite were true?' }],
          [{ zh: '爱查资料', en: 'Checks sources' }, { zh: '这个有依据吗，我去找找', en: 'Any evidence for that?' }],
          [{ zh: '记性特别好', en: 'Remembers everything' }, { zh: '上周好像有人说过类似的', en: 'Someone said something like this before' }],
        ],
      },
      {
        kind: 'list',
        zh: [
          'AI 同学只在被点名时说话：发送前点它，输入框下方会提示「会叫上」它。',
          '讨论到一定程度，或者停下来一阵子，系统可能插进一张卡片，指出你们对同一个词用了不同的说法，并提一个问题。卡片上注明「系统看到的，不是谁说的」；点卡片上的「由我们来写」，会跳到右边的撰写区。',
          '只有开讨论室的同学能发布。发布后生成一条综合升华笔记，放在来源笔记上方，用「综合」关系连着它们。以后双击这条笔记，还能回到讨论室。',
          '讨论室里的消息每隔几秒自动刷新，组员的新发言会自己出现。右边的草稿只保存在各自的浏览器里，商量好的说法可以先发在群聊里，再由开讨论室的同学整理发布。',
        ],
        en: [
          'AI classmates only speak when called on: click one before sending, and the box below the input shows who will be called.',
          'Once the discussion has gone on a while, or has gone quiet for a while, the system may add a card pointing out that you are using the same word in different ways, with a question. The card says it was noticed by the system, not said by anyone; "We will write it" on the card takes you to the writing panel on the right.',
          'Only the student who opened the room can publish. Publishing creates a rise-above note above the source notes, linked to each of them as a synthesis. Double-click that note later to return to the room.',
          'Messages refresh every few seconds, so new messages from your group appear on their own. The draft on the right is kept only in each person\'s browser, so agree on the wording in the chat and let the student who opened the room publish it.',
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        label: { zh: '什么时候做', en: 'When to do it' },
        zh: ['不用每周都做。几条笔记互相冲突、你又觉得它们说的是同一件事时，就是合适的时候。'],
        en: ['Not every week. When several notes pull against each other and you suspect they are about the same thing, that is the time.'],
      },
    ],
  },

  // ── 09 ────────────────────────────────────────────────────────────────
  {
    id: 'reading',
    num: '09',
    title: { zh: '阅读课程材料', en: 'Reading course materials' },
    blocks: [
      {
        kind: 'p',
        zh: '老师和同学用工具栏「附件」上传的文件，在画布上是一张文件卡片。双击它打开阅读页。',
        en: 'Files that your teacher or classmates upload with Attachment appear on the canvas as file cards. Double-click one to open the reading page.',
      },
      {
        kind: 'figure',
        src: '/manual/ui-doc-reader.jpg',
        cap: {
          zh: '阅读页。左边是目录，中间是正文，右边可以在批注和 AI 助手之间切换。每条批注上方引着它针对的原文。',
          en: 'The reading page: contents on the left, the text in the middle, and a right-hand panel that switches between comments and the AI assistant. Each comment quotes the passage it refers to.',
        },
      },
      {
        kind: 'list',
        zh: [
          'Markdown 和 Word 文件：左边有目录（文档里至少有三个标题时才显示），右边可以切换「批注」和「AI 助手」。',
          'PDF 用浏览器自带的阅读器打开，右边只有 AI 助手。',
          'Excel 和 CSV 表格：有几个工作表，上面就有几个页签；表头标着列字母，左边是行号，数字、百分比和日期按表格里设的格式显示。右边只有 AI 助手，可以直接问这张表。一个工作表超过 2000 行时只显示前 2000 行，完整内容请下载。',
          '顶部有下载和关闭按钮。',
        ],
        en: [
          'Markdown and Word files: contents on the left (shown when the document has at least three headings), and Comments or AI on the right.',
          'PDFs open in the browser\'s own viewer, with only the AI panel on the right.',
          'Excel and CSV files: one tab per sheet, column letters across the top and row numbers down the side, with numbers, percentages and dates shown in the sheet\'s own format. The right-hand panel has only the AI assistant, which you can ask about the table. Sheets over 2,000 rows show the first 2,000; download the file for the rest.',
          'Download and close buttons are at the top.',
        ],
      },
      { kind: 'h3', zh: '批注', en: 'Comments' },
      {
        kind: 'p',
        zh: '选中正文里的一段，会弹出「批注」和「引用到笔记」。点「批注」，写下你的看法，点「发布批注」。同一空间的同学都能看到批注，可以回复一层，也可以「标记解决」。文件改过以后，如果批注对应的原文找不到了，批注上会显示「原文已修改」。',
        en: 'Select a passage and "Comment" and "Quote" pop up. Click "Comment", write your thoughts and click "Post". Everyone in the space can see comments, reply once, and mark them resolved. If the file is edited and the quoted passage is gone, the comment shows "text has changed".',
      },
      {
        kind: 'p',
        zh: '「引用到笔记」会在文件卡片旁边新建并发布一条笔记，里面是你选的那段原文，下面注明「引自《文件名》」。',
        en: '"Quote" creates and posts a note beside the file card containing the passage you selected, with a line naming the file it came from.',
      },
      { kind: 'h3', zh: '文档 AI', en: 'The document AI' },
      {
        kind: 'p',
        zh: '右边的 AI 助手只读这一份文档，适合问「这一段在说什么」「作者的证据是什么」。回答下面有「存为批注」和「引用到笔记」，能把有用的回答放到大家都看得到的地方。「历史对话」里是你和这份文档的对话记录。想把这份文档和空间里的其他笔记放在一起谈，点面板底部的「带这份文档去空间 AI 助手」，知识空间 AI 助手会打开，文档已经挂在输入框上。',
        en: 'The AI panel reads only this document, so ask it things like what a passage says or what evidence the author gives. Under each answer are "Save as comment" and "Quote to a note", which put a useful answer where everyone can see it. "History" keeps your conversations about this document. To discuss it alongside the other notes in the space, click "Take this document to the space assistant" at the bottom of the panel: the workspace assistant opens with the document already attached.',
      },
      { kind: 'h3', zh: '编辑文档', en: 'Editing' },
      {
        kind: 'p',
        zh: 'Word 和 Markdown 文件可以点「编辑」修改：一边改文字，一边看预览，改完点「保存」。Word 的原文件不会被改动，始终可以下载。正文只有上传者和老师能改，所以「编辑」只出现在你自己上传的文档上。',
        en: 'Word and Markdown files can be changed with "Edit": edit the text on one side and watch the preview on the other, then click "Save". The original Word file is never altered and can always be downloaded. Only the uploader and teachers can change the text, so "Edit" appears only on documents you uploaded.',
      },
    ],
  },

  // ── 10 ────────────────────────────────────────────────────────────────
  {
    id: 'graph',
    num: '10',
    title: { zh: '看讨论的全貌：观点图谱、网络和时间线', en: 'The whole discussion: idea graph, network and timeline' },
    blocks: [
      {
        kind: 'p',
        zh: '工具栏「社区」一组里有三个工具，帮你看清讨论进行到哪了：观点图谱看你们组，Build-on 网络看全班的笔记怎么连，时间线看讨论怎样随时间推进。',
        en: 'Three tools in the toolbar\'s Community group show where the discussion stands: the idea graph for your group, the build-on network for how the class\'s notes connect, and the timeline for how things moved over time.',
      },
      { kind: 'h3', zh: '观点图谱', en: 'Idea graph' },
      {
        kind: 'figure',
        src: '/manual/ui-idea-graph.jpg',
        cap: {
          zh: '观点图谱。上方五个数字，左边是这一周反复出现的观点，右边是几份清单。',
          en: 'The idea graph: five counts across the top, the ideas that kept coming up this week on the left, and a set of lists on the right.',
        },
      },
      {
        kind: 'clip',
        src: '/manual/c10-graph',
        cap: {
          zh: '圆圈可以拖动；点一个圆圈，下面列出提到它的笔记。',
          en: 'Circles can be dragged. Click one to list the notes that mention it.',
        },
      },
      {
        kind: 'p',
        zh: '观点图谱按小组计算，每周自动生成一期，标题下写着这一期覆盖的日期。上方五个数字是笔记总数、本期新增、本期参与的人数、Build-on 次数和 AI 笔记数。',
        en: 'The idea graph is computed per group and a new edition is produced each week, with its date range under the title. The five counts are total notes, new this edition, people taking part, build-ons, and AI notes.',
      },
      {
        kind: 'list',
        zh: [
          '每个圆圈是你们笔记里反复出现的一个观点。谈到它的人越多，圆圈越大。',
          '两个圆圈之间有线，说明它们常出现在同一条笔记里。',
          '圆圈可以拖动，按你自己的理解排布，位置不会保存。',
          '圆圈旁标「新」的是这一期才出现的，标「+2」的是比上一期多了两条。',
          '点一个圆圈，下面列出提到它的笔记；再点笔记，会跳回画布上的那一条。',
        ],
        en: [
          'Each circle is an idea that keeps coming up in your notes. The more people discuss it, the bigger the circle.',
          'A line between two circles means they often appear in the same note.',
          'You can drag circles into an arrangement that makes sense to you; positions are not saved.',
          '"New" marks an idea that appeared this edition, and "+2" means two more notes than last time.',
          'Click a circle to list the notes that mention it, then click a note to jump to it on the canvas.',
        ],
      },
      {
        kind: 'table',
        head: [{ zh: '清单', en: 'List' }, { zh: '怎么用', en: 'How to use it' }],
        rows: [
          [{ zh: '本期讨论增长的观点', en: 'More discussed' }, { zh: '最近大家的注意力在哪里', en: 'Where attention has gone lately' }],
          [{ zh: '组内提出的问题', en: 'Questions raised' }, { zh: '标题以问号结尾的笔记，同一个问题只列一次。每个问题标着「已被建构」或「尚无人建构」，后一种可以去接', en: 'Notes whose title ends in a question mark, each question listed once. Each is marked as built on or not yet; the second kind are yours to pick up' }],
          [{ zh: '尚无人建构', en: 'Not built on yet' }, { zh: '发出两天以上还没人接的笔记，后面写着搁了几天', en: 'Notes left unanswered for two days or more, with the number of days' }],
          [{ zh: 'Build-on 链最长的观点', en: 'Longest build-on chains' }, { zh: '哪条线索被接得最深，有几层、几个人参与，可以顺着看下去', en: 'Which thread went deepest, how many levels and people, worth following' }],
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        label: { zh: '看不到图谱', en: 'No graph showing?' },
        zh: [
          '显示「还没有分组」：老师还没把你分进小组，图谱是按小组算的。',
          '显示「笔记数量尚不足」：你们组的笔记还不到 3 条，满 3 条后会生成第一期。',
        ],
        en: [
          '"No group yet": your teacher has not put you in a group, and the graph is computed per group.',
          '"Not enough notes yet": your group has fewer than three notes. The first edition appears at three.',
        ],
      },
      {
        kind: 'callout',
        tone: 'warn',
        label: { zh: '图谱不给结论', en: 'The graph draws no conclusions' },
        zh: ['它只显示讨论覆盖了什么、哪里还没人接。那句更高一层的说法要你们自己写（第 8 节）。'],
        en: ['It shows what has been covered and what nobody has picked up. The higher-level account is yours to write (section 8).'],
      },
      { kind: 'h3', zh: 'Build-on 网络', en: 'Build-on network' },
      {
        kind: 'figure',
        src: '/manual/ui-buildon-network.jpg',
        cap: {
          zh: 'Build-on 网络。每个点是一条笔记，连线是 Build-on 关系；右边是你在这次讨论中的位置。',
          en: 'The build-on network: each dot is a note and each line a build-on. On the right is your position in the discussion.',
        },
      },
      {
        kind: 'p',
        zh: '它画的是整个空间的笔记怎么连在一起，点的位置按连接关系排，和画布上的摆放无关。你的笔记是较大的藏青色点，还没人接的外面有一圈红色；点一个点，画布上会定位到那条笔记。右边列出你发布了几条观点、被同伴建构了几次、建构过几次同伴的观点、和几位同伴建立过关联，以及组内人均被建构的次数。这里不排名次。',
        en: 'It draws how all the notes in the space connect, laid out by their links rather than their positions on the canvas. Your notes are the larger navy dots, and those nobody has answered have a red ring; click a dot to find that note on the canvas. The right side lists how many ideas you posted, how often peers built on you, how often you built on peers, how many peers you are connected to, and the group\'s average. There is no ranking.',
      },
      { kind: 'h3', zh: '时间线', en: 'Timeline' },
      {
        kind: 'figure',
        src: '/manual/ui-timeline.jpg',
        cap: {
          zh: '时间线。上方是每天的活动量，下面按时间列出发布的观点、Build-on、AI 反馈和 AI 对话。',
          en: 'The timeline: daily activity at the top, and below it ideas, build-ons, AI feedback and AI conversations in time order.',
        },
      },
      {
        kind: 'clip',
        src: '/manual/c11-network',
        cap: {
          zh: '打开 Build-on 网络，再打开时间线，勾上「只看我的」。',
          en: 'Opening the build-on network, then the timeline, and ticking "Mine only".',
        },
      },
      {
        kind: 'p',
        zh: '时间线最上面是近 60 天每天的活动量，连续 3 天没有新观点时会提示。下面的条目可以按「观点」「Build-on」「AI 反馈」「AI 对话」筛选；勾上「只看我的」，只显示你自己的记录。',
        en: 'The top of the timeline shows daily activity for the last 60 days and warns after three days with no new ideas. Filter the entries below by Ideas, Build-on, AI feedback or AI chat, and tick "Mine only" to see just your own.',
      },
    ],
  },

  // ── 11 ────────────────────────────────────────────────────────────────
  {
    id: 'analytics',
    num: '11',
    title: { zh: '回头看看自己', en: 'Looking back at your own work' },
    blocks: [
      {
        kind: 'p',
        zh: '首页侧栏「学习」和「社区」两组栏目是你个人的记录。开课头两三周数据很少，之后才有参考价值。',
        en: 'The Learning and Community groups in the home page sidebar are your personal record. There is little in them for the first two or three weeks.',
      },
      { kind: 'h3', zh: '笔记动态', en: 'Note activity' },
      { kind: 'figure', src: '/manual/fig-07.jpg', cap: { zh: '笔记动态：四个统计、12 周的活动热力图、笔记累积曲线、笔记类型、每周趋势、你常在几点写，以及最近的 8 条笔记。', en: 'Note activity: four counts, a 12-week activity heat map, your notes over time, note types, weekly trend, the hours you tend to write, and your last eight notes.' } },
      {
        kind: 'p',
        zh: '这一页看你写了多少、写得多长、和 AI 互动了多少次，也能看出你一般在什么时间写。',
        en: 'This page shows how much you have written, how long your notes are, how often you worked with the AI, and when you usually write.',
      },
      { kind: 'h3', zh: '知识图谱', en: 'Knowledge graph' },
      { kind: 'figure', src: '/manual/fig-08.jpg', cap: { zh: '知识图谱：你的笔记、和它们有关系的同学笔记，以及其中的概念。', en: 'Knowledge graph: your notes, classmates\' notes linked to them, and the concepts they involve.' } },
      {
        kind: 'p',
        zh: '这张图以你为中心：你的笔记、连到这些笔记的同学笔记，以及它们共同涉及的概念。可以按课程筛选，也可以搜索。第 10 节的观点图谱看的是整个组，这张只看和你有关的部分。',
        en: 'This graph is centred on you: your notes, the classmates\' notes linked to them, and the concepts they share. You can filter by course and search. The idea graph in section 10 covers the whole group; this one covers only what involves you.',
      },
      { kind: 'h3', zh: '潜力想法', en: 'Promising ideas' },
      { kind: 'figure', src: '/manual/fig-09.jpg', cap: { zh: '潜力想法：值得继续做下去的笔记、想法接近的同学，以及可以放在一起做综合升华的笔记。', en: 'Promising ideas: notes worth taking further, classmates thinking along similar lines, and notes that could go into a rise-above together.' } },
      {
        kind: 'p',
        zh: '排序看三件事：被 Build-on 的次数、被 AI 标为「有潜力」的次数，以及被别人拿去当证据或做综合的次数。下面的「谁和你想到一起了」列出和你谈到相同概念的同学笔记，「Rise-above 机会」列出几组可以一起做综合升华的笔记。不知道下一步写什么时，可以从这一页挑一条。',
        en: 'Ranking uses how often a note was built on, how often the AI flagged it as promising, and how often others used it as evidence or in a synthesis. "Who is thinking along the same lines" lists classmates\' notes that share your concepts, and "Rise-above opportunities" lists groups of notes that could be combined. When you do not know what to write next, pick one from here.',
      },
      { kind: 'h3', zh: '思维发展', en: 'Thinking development' },
      { kind: 'figure', src: '/manual/fig-10.jpg', cap: { zh: '思维发展：思维画像、最长影响链、成长里程碑和成长建议。', en: 'Thinking development: your thinking profile, longest chain of influence, milestones and suggestions.' } },
      {
        kind: 'p',
        zh: '思维画像从表达、深化、影响、探究、综合五个方面画出你的情况；「最长影响链」是你的一个想法被一路接下去，最多接了几层。',
        en: 'The thinking profile charts expression, deepening, influence, inquiry and synthesis. The longest chain of influence is how many levels deep one of your ideas was carried by others.',
      },
      { kind: 'h3', zh: '协作网络', en: 'Collaboration' },
      { kind: 'figure', src: '/manual/fig-11.jpg', cap: { zh: '协作网络：你和谁来回建构过、发出和收到的互动类型，以及还没人接的笔记。', en: 'Collaboration: who you have built on and been built on by, the types of build-on sent and received, and your notes nobody has answered.' } },
      {
        kind: 'p',
        zh: '「互动类型对比」把你发出和收到的 Build-on 按六种关系分开。如果你发出的几乎都是「延伸」，很少「质疑」和「证据」，说明你多半在顺着别人说。协作伙伴只集中在一两个人身上时，可以去接一位你从没回应过的同学。',
        en: 'The comparison splits the build-ons you sent and received by relation. If nearly all of yours are Extend, with little Challenge or Evidence, you have probably been going along with people. If your partners are only one or two people, try building on someone you have never answered.',
      },
      { kind: 'h3', zh: '教师反馈', en: 'Feedback' },
      { kind: 'figure', src: '/manual/fig-12.jpg', cap: { zh: '教师反馈页：上面是「我的学习旅程」，下面是老师的评语和提醒。', en: 'The Feedback page: "My learning journey" at the top, your teacher\'s comments and reminders below.' } },
      {
        kind: 'p',
        zh: '「我的学习旅程」汇总你和 AI 的互动次数、提过的问题、引用的证据，以及 AI 反馈的采纳情况。下面是老师给你的评语和提醒，点「进入课程」可以回到那门课。',
        en: '"My learning journey" totals your AI interactions, questions asked, evidence cited, and how you handled AI feedback. Below are your teacher\'s comments and reminders; "Open course" takes you back to the course.',
      },
    ],
  },

  // ── 12 ────────────────────────────────────────────────────────────────
  {
    id: 'activities',
    num: '12',
    title: { zh: '图灵测试与两个练习场', en: 'The Turing test and two practice areas' },
    blocks: [
      { kind: 'h3', zh: '图灵测试', en: 'The Turing test' },
      {
        kind: 'figure',
        src: '/manual/ui-turing.jpg',
        cap: {
          zh: '图灵测试进行中。每个人用化名，右上角是剩余时间，右边是群成员；群里有一位是 AI。',
          en: 'A Turing test in progress. Everyone uses a nickname, the time left is at the top right, and the members are listed on the right. One of them is an AI.',
        },
      },
      {
        kind: 'p',
        zh: '这是老师组织的课堂活动。老师开放后，点画布工具栏「探究」，在「探究工具」里找到「图灵测试」卡片，点「进入活动」，然后等老师开始。',
        en: 'This is a class activity your teacher runs. When it is open, click Inquiry in the canvas toolbar, find the Turing test card under Inquiry tools, click "Enter", and wait for your teacher to start.',
      },
      {
        kind: 'steps',
        zh: [
          '老师开始后，你被随机分进一个匿名群聊，拿到一个化名，页面顶上会写你叫什么。群里混有 AI，老师可能会告诉你有几个。',
          '在倒计时内（默认 5 分钟）围绕话题聊天。想对某个人说话，就在消息里写上他的化名。每条消息最多 300 字。',
          '时间到后回答「群里谁是 AI？」：给每位成员选「人」或「AI」，拖动滑块表示你有多确定，至少写 2 条线索，点「提交判断」。老师公布答案之前都可以改。',
          '老师公布答案后，你能看到自己判对了几位、每个人被多少人当成 AI、全班的判断准确率，以及判对和判错的同学各自靠的是什么线索。点「发布到知识社区」，可以把群聊和你的判断发成一条笔记，笔记里只出现化名。',
        ],
        en: [
          'Once your teacher starts, you are put into an anonymous group chat at random and given a nickname, shown at the top of the page. The group includes AI members, and your teacher may tell you how many.',
          'Chat about the topic before the countdown ends (five minutes by default). To address someone, write their nickname in your message. Messages can be up to 300 characters.',
          'When time is up, answer "Who is the AI?": mark each member as human or AI, use the slider to say how sure you are, write at least two clues, and click "Submit". You can change it until the answers are revealed.',
          'After the reveal you see how many you got right, how many people took each member for an AI, the class\'s accuracy, and the clues used by those who were right and those who were wrong. "Publish to the community" turns the chat and your judgement into a note that shows nicknames only.',
        ],
      },
      { kind: 'h3', zh: '思维练习助手', en: 'Thinking coach' },
      { kind: 'figure', src: '/manual/fig-13.jpg', cap: { zh: '思维练习助手：三种玩法，有等级和经验值。右边的五边形是你在清晰、证据、逻辑、提问、视角五方面的情况。', en: 'The thinking coach: three modes, with levels and points. The pentagon on the right shows clarity, evidence, logic, questioning and perspective.' } },
      {
        kind: 'table',
        head: [{ zh: '模式', en: 'Mode' }, { zh: '玩法', en: 'How it works' }],
        rows: [
          [{ zh: '谬误侦探', en: 'Fallacy Detective' }, { zh: '给你一段论证，找出有问题的句子，说出是哪种谬误', en: 'Find the faulty sentences in an argument and name the fallacy' }],
          [{ zh: '观点擂台', en: 'Argument Arena' }, { zh: '和 AI 就一个话题辩三回合，出「话语卡」，论证越有力，对方掉血越多', en: 'Three rounds against the AI on a topic, playing discourse cards; stronger arguments do more damage' }],
          [{ zh: '苏格拉底阶梯', en: 'Socratic Ladder' }, { zh: '对一个断言一层层追问，问得越深，爬得越高', en: 'Question one claim level by level; deeper questions climb higher' }],
        ],
      },
      {
        kind: 'p',
        zh: '观点擂台的五张话语卡（证据、质疑、提问、澄清、延伸）和 Build-on 的关系类型是同一套，在这里练熟了，写 Build-on 时也用得上。',
        en: 'The Argument Arena\'s five discourse cards (evidence, challenge, question, clarify, extend) are the same moves as the build-on relations, so practice here carries over to your notes.',
      },
      { kind: 'h3', zh: '编程练习助手', en: 'Coding coach' },
      { kind: 'figure', src: '/manual/fig-14.jpg', cap: { zh: '编程练习助手：Python 直接在浏览器里运行，不用安装任何东西。', en: 'The coding coach: Python runs in the browser, with nothing to install.' } },
      {
        kind: 'table',
        head: [{ zh: '模式', en: 'Mode' }, { zh: '玩法', en: 'How it works' }],
        rows: [
          [{ zh: '挑战关卡', en: 'Challenge' }, { zh: '用自然语言让 AI 写代码，直到通过测试。来回的轮数越少，分越高', en: 'Direct the AI in plain language until the code passes the tests. Fewer rounds score higher' }],
          [{ zh: '代码捉虫', en: 'Bug Hunt' }, { zh: '修一段有 bug 的代码。这里的 AI 只给逐步提示，求助会扣分', en: 'Fix buggy code. The AI gives step-by-step hints only, and asking costs points' }],
          [{ zh: '自由创作', en: 'Sandbox' }, { zh: '没有题目，写什么都行', en: 'No set task; write whatever you like' }],
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        label: { zh: '为什么轮数少分高', en: 'Why fewer rounds score higher' },
        zh: ['挑战关卡练的是把要求一次说清楚。要求说清楚了，AI 写出能用的代码会快得多。'],
        en: ['The challenge trains you to state the requirement clearly the first time. A clear requirement gets working code from the AI much faster.'],
      },
    ],
  },

  // ── 13 ────────────────────────────────────────────────────────────────
  {
    id: 'help',
    num: '13',
    title: { zh: '使用帮助、使用反馈和更新日志', en: 'Help, feedback and what\'s new' },
    blocks: [
      { kind: 'h3', zh: '操作上遇到问题：使用帮助', en: 'Stuck with the interface: Help' },
      {
        kind: 'p',
        zh: '每个页面的右边缘都有一个藏青色的小圆球，平时大半藏在边上，鼠标移上去会滑出「使用帮助」。点它，右下角打开一个对话窗，专门回答平台怎么用的问题。AI 按这本使用手册回答，回答下面写着参考了手册的哪几节；手册里没写到的，它会照实说，建议你转给老师。小球挡住了东西，可以按住上下拖到别处，位置会被记住。',
        en: 'Every page has a small navy ball on its right edge, mostly tucked away; hover over it and "Help" slides out. Click it and a chat window opens at the bottom right for questions about using the platform. The AI answers from this manual and shows which sections it used; if the manual does not cover something, it says so and suggests asking your teacher. If the ball is in the way, drag it up or down; it remembers where you put it.',
      },
      {
        kind: 'steps',
        zh: [
          '点页面右边的「使用帮助」小球。',
          '写下遇到的问题，回车发送，也可以先点下面的常见问题。说不清楚时可以贴截图：点输入框左边的图片按钮，或者直接按 ⌘V / Ctrl+V 粘贴，最多 3 张。',
          'AI 先回答。问题解决了点「解决了」；没解决点「没解决，转给老师」，可以补一句说明，问题会转到老师那里。老师回复后，小球上会出现一个小点。',
        ],
        en: [
          'Click the Help ball on the right edge of the page.',
          'Write the problem and press Enter, or pick one of the common questions. If it is hard to put into words, add a screenshot with the image button, or paste with ⌘V / Ctrl+V. Up to three.',
          'The AI answers first. If that fixes it, click "Solved". If not, click "Not solved — ask the teacher", add a note if you like, and the question goes to your teacher. When your teacher replies, a dot appears on the ball.',
        ],
      },
      {
        kind: 'p',
        zh: '转给老师的问题会带上你当时的情况：在哪个页面、窗口多大、用的什么浏览器，以及前一刻有没有报错，老师不用再来回问。问题的状态显示为「等老师回复」「老师已回复」或「已解决」。',
        en: 'A question sent to your teacher carries the context it was asked in: the page, window size, browser, and any error just before, so your teacher does not have to ask. Its status shows as waiting, answered or resolved.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        label: { zh: '问哪里', en: 'Where to ask' },
        zh: ['平台怎么用的问题，问右边的「使用帮助」。课程内容的问题，用笔记页的 AI 助手，或知识空间助手的「对话」页签。'],
        en: ['Ask how to use the platform with Help on the right edge. For questions about course content, use the AI assistant on the note page or the Chat tab of the workspace assistant.'],
      },
      { kind: 'h3', zh: '给平台开发团队写反馈', en: 'Writing to the platform team' },
      {
        kind: 'figure',
        src: '/manual/ui-feedback-channel.jpg',
        cap: {
          zh: '使用反馈页：开头是开发团队写给同学们的一封信，下面可以写你的想法。',
          en: 'The Send feedback page opens with a letter from the development team, and you can write your own thoughts below it.',
        },
      },
      {
        kind: 'p',
        zh: '首页侧栏「平台理念与帮助」里的「使用反馈」是写给平台开发团队的。选一个类型（使用感受、改进建议、遇到的问题、不认同的地方），写下来点「提交」。只有开发团队看得到，不会转给任课老师，也不计入成绩。你写过的内容列在「我写过的」里，可以撤回。',
        en: '"Send feedback" under Rationale & Help in the home sidebar goes to the platform development team. Pick a type (how it feels, a suggestion, a problem, or something you disagree with), write it and click "Submit". Only the development team reads it; it does not go to your teacher and has nothing to do with grades. Everything you have sent is listed under "What I have written", where you can withdraw it.',
      },
      { kind: 'h3', zh: '更新日志', en: 'What\'s new' },
      {
        kind: 'figure',
        src: '/manual/ui-changelog.jpg',
        cap: { zh: '更新日志：每一版改了什么，新的在前。', en: 'What\'s new: what each release changed, newest first.' },
      },
      {
        kind: 'p',
        zh: '侧栏最下面的 `v1.x · 更新日志` 列出平台每一版改了什么。界面和这份手册对不上时，先看看这里是不是刚改过。',
        en: 'The `v1.x · What\'s new` line at the bottom of the sidebar lists what each release changed. If the interface does not match this manual, check there first.',
      },
    ],
  },

  // ── 14（教师） ────────────────────────────────────────────────────────
  {
    id: 'teacher',
    num: '14',
    teacherOnly: true,
    title: { zh: '教师端', en: 'For teachers' },
    blocks: [
      {
        kind: 'p',
        zh: '这一节只有教师能看到。前面讲画布、笔记、AI 和综合升华的内容，教师端都一样。教师首页的侧栏和学生不同：「主要」里有概览、个人资料、我的课程、教学日志；「AI 智能体」里有 AI 对话、备课助手、学情分析、教学评估、学生求助、AI 设置；「研究」里是几种分析和数据导出；「平台理念与帮助」里有使用手册和平台理念，后者写明每项设计的依据和文献。学生首页上的学习面板和练习场，教师端没有。',
        en: 'Only teachers see this section. Everything earlier about the canvas, notes, AI and rise-above works the same for you. Your home sidebar differs from a student\'s: Main has Overview, Profile, My courses and Teaching log; AI Agents has AI chat, Lesson prep, Analytics, Assessment, Student help and AI settings; Research has the analyses and the data export; Rationale & Help has the user manual and the design rationale, which gives the reasoning and literature behind each design. The student learning panels and practice areas are not on the teacher side.',
      },
      { kind: 'h3', zh: '课程设置', en: 'Course settings' },
      {
        kind: 'p',
        zh: '在「我的课程」里点课程卡片上的齿轮，进入课程设置页。页头是课程码、学生数、知识空间数和笔记数，下面分「学习目标」「课程资料」「学习任务」「教学安排」「协作与权限」五个分区。课程名旁边的铅笔可以改名，只有课程创建者能改。',
        en: 'Click the gear on a course card under My courses to open the course settings page. The header shows the course code and the numbers of students, spaces and notes. Below are five areas: Learning goals, Materials, Assignments, Schedule and Collaboration. The pencil beside the course name renames it; only the course creator can do that.',
      },
      { kind: 'h3', zh: '教学安排和教学日志', en: 'Schedule and teaching log' },
      {
        kind: 'figure',
        src: '/manual/ui-teaching-log.jpg',
        cap: {
          zh: 'AI 教学日志。每次课的参与人数、新增笔记、Build-on 和 AI 反馈数来自数据库；文字小结由 AI 按需生成，标明「AI 生成」或「教师已修订」。',
          en: 'The teaching log. Attendance, new notes, build-ons and AI feedback for each class come from the database; the written summary is generated on request and labelled as AI-generated or revised by the teacher.',
        },
      },
      {
        kind: 'steps',
        zh: [
          '在「教学安排」里填课程类型、课时、持续周数、开课日期和每周上课时段（一周上几次就点「+ 增加一个时段」），点「保存并排课」，系统排出整学期的课次。',
          '上课时间过了还没记录的课次，登录时会提示「有 N 次课还没记录」。点「记录这次课」，选「上课了」「调课」（要填新日期）或「没上」，可以加备注，点「确认记录」。关掉提示后，也可以在侧栏「教学日志」里补记。',
          '「教学日志」页列出每次课。已上的课显示当时的参与人数、新增笔记、Build-on 和 AI 反馈数。点「生成教学日志」得到一段 AI 小结，可以直接修改。',
        ],
        en: [
          'Under Schedule, fill in the course type, credit hours, number of weeks, start date and weekly time slots (use "+ Add a slot" for more than one a week), then click "Save & schedule". Every class for the term is laid out.',
          'Classes whose time has passed without a record trigger a prompt when you sign in. Click "Record this class", choose held, rescheduled (with the new date) or not held, add a note if you like, and confirm. After closing the prompt you can still record classes from Teaching log.',
          'Teaching log lists every class. Held classes show attendance, new notes, build-ons and AI feedback for that time. "Generate teaching log" writes an AI summary that you can edit directly.',
        ],
      },
      {
        kind: 'p',
        zh: '调课和没上课是分开记录的。研究数据导出里的「课次记录」会把计划和实际的上课时间都导出来。',
        en: 'Rescheduled and cancelled classes are recorded separately. The class sessions table in the research export includes both planned and actual times.',
      },
      { kind: 'h3', zh: '协作与权限', en: 'Co-teachers and course managers' },
      {
        kind: 'p',
        zh: '在课程设置的「协作与权限」里，课程创建者可以邀请其他教师加入，并把他们设为「课程管理员」或撤销。课程管理员可以改课程设置、排课、确认课次、写教学日志，也会收到补记提醒；可以移除学生，不能移除教师。指定和撤销管理员只有创建者能做。',
        en: 'Under Collaboration in course settings, the course creator can invite other teachers and make them course managers, or take that away. Managers can change settings, plan the schedule, confirm classes and write the teaching log, and they get the same reminders. They can remove students but not teachers. Only the creator can appoint or remove managers.',
      },
      {
        kind: 'p',
        zh: '在工作区里，课程创建者和课程管理员可以修改、删除任何人的笔记和批注，可以查看每个组的任务板。被邀请但没有设为管理员的教师，以及用学生验证码自己加入课程的教师账号，在这门课里是普通成员：和学生一样只能改删自己的内容，小组空间、任务板和观点图谱只看得到自己所在的组。',
        en: 'In the workspace, the creator and course managers can edit or delete anyone\'s notes and comments and can view every group\'s task board. A teacher who was invited but not made a manager, or who joined with the student code, is an ordinary member of that course: like a student, they can change only their own content, and see only their own group\'s space, task board and idea graph.',
      },
      { kind: 'h3', zh: 'AI 设置', en: 'AI settings' },
      {
        kind: 'figure',
        src: '/manual/ui-teacher-ai.jpg',
        cap: {
          zh: 'AI 集成设置。每个服务商一张卡片，添加 API 密钥后标为「已配置」。密钥按课程保存。',
          en: 'AI integration settings. Each provider has a card, marked as configured once a key is added. Keys are stored per course.',
        },
      },
      {
        kind: 'p',
        zh: '侧栏「AI 设置」的上半部分是「AI 集成设置」。在服务商卡片上点「添加 API 密钥」，填 API Key（Endpoint URL 可以不填），在「选择启用的模型」里勾这门课能用的模型（都不勾就是全部），点「验证并保存」。密钥按课程保存，课程创建者、课程管理员和平台管理员可以修改。验证不通过时密钥仍会保存，并提示「连通性验证未通过」，这时学生端的 AI 多半用不了，先检查密钥和模型名。',
        en: 'The top half of AI settings is AI integration. On a provider card, click "Add API key", enter the key (the endpoint URL is optional), tick the models this course may use under "Choose models" (none ticked means all), and click "Verify and save". Keys are stored per course and can be changed by the creator, course managers and platform administrators. If verification fails, the key is still saved with a warning; the AI will probably not work for students until you fix the key or model name.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        label: { zh: '选模型', en: 'Choosing models' },
        zh: ['至少勾一个 flash、air、turbo 这类快速模型，学生等待时间会短很多，使用帮助也优先用它。深度推理的模型留给分析类的任务。一门课可以勾好几个。'],
        en: ['Enable at least one fast model (flash, air, turbo). Students wait noticeably less, and Help prefers that tier. Keep heavy reasoning models for analysis. A course can have several.'],
      },
      { kind: 'h3', zh: '各功能用哪个 AI', en: 'Which AI each feature uses' },
      {
        kind: 'p',
        zh: '「AI 集成设置」下面是「各功能用哪个 AI」：平台上每个用到 AI 的功能列成一张表，写明谁会用到、现在用的是哪个模型、出错时换哪一家。每一项都可以在「指定模型」里选一个，或者留「自动」。自动的规则是：学生在等的功能（笔记 AI 助手、AI 反馈、讨论室、使用帮助等）先用 DeepSeek Flash，DMX 放最后；生成图片先用 DMX。模型旁边的「快，并发高」「最慢」这类提示来自 2026 年 9 月的实测。',
        en: 'Below AI integration is "Which AI each feature uses": every AI feature on the platform, who uses it, the model it uses now and what it falls back to. Each can be set to a specific model or left on Auto. Auto puts DeepSeek Flash first for features students wait on (note AI partner, AI feedback, the discussion room, Help and so on) and DMX last, and DMX first for images. Notes such as "fast, high concurrency" or "slowest" come from measurements in September 2026.',
      },
      {
        kind: 'p',
        zh: '表下面是「各入口的模型菜单里显示哪些模型」：笔记 AI 助手、知识空间助手、学生首页的「AI 对话」各一块。选「只显示勾选的」，再勾要显示的模型（可以多选，至少留一个），那个入口的模型菜单里就只有这几个。菜单里的「默认」是上表对应那一行的模型，它没被勾上时改用勾上的里排在最前的；之前选过、后来不在名单里的，会自动换成默认。学生首页「AI 对话」的名单只管学生，老师在自己有教职的课里不受限。',
        en: 'Below the table, "Which models each model menu shows" has one block each for the note AI partner, the workspace assistant and students\' AI chat. Choose "Show only the ticked ones" and tick the models to show (several are fine, keep at least one), and that entry\'s menu lists only those. "Default" in the menu is the model of the matching row above; if it is not ticked, Default uses the first ticked one, and an earlier pick that is no longer on the list switches to Default. The list for students\' AI chat applies to students only; teachers are not limited in courses they teach.',
      },
      { kind: 'h3', zh: '触发设置', en: 'Trigger settings' },
      {
        kind: 'figure',
        src: '/manual/ui-teacher-triggers.jpg',
        cap: {
          zh: 'AI 触发设置：总开关、六类触发、灵敏度和冷却时间。',
          en: 'Trigger settings: the main switch, the six trigger types, sensitivity and cooldown.',
        },
      },
      {
        kind: 'p',
        zh: '「AI 设置」的下半部分是「AI 触发设置」，控制第 7 节讲的自动反馈：',
        en: 'The lower half of AI settings, Trigger settings, controls the automatic feedback described in section 7:',
      },
      {
        kind: 'list',
        zh: [
          '「自动反馈（编辑时）」是总开关。',
          '「启用的触发类型」里六类（T1 到 T6）逐一开关。刚开课时开两三类就够了，学生对提醒的耐受度比想象中低。',
          '「灵敏度」（保守、平衡、积极）、「冷却时间」（30 到 600 秒，默认 120 秒）和「最大反馈字数」（默认 300）对整门课生效。',
          '「课程上下文提示」会一起发给模型，可以写上这门课在讨论什么。',
          '同一页上的「AI 响应语言」「响应风格」「AI 角色设定」目前会保存，但还不影响自动反馈的内容。',
        ],
        en: [
          '"Auto feedback while editing" is the main switch.',
          'Each of the six trigger types (T1 to T6) can be switched on or off. Early in a course two or three are enough; students tolerate fewer prompts than you would expect.',
          'Sensitivity (conservative, balanced, aggressive), cooldown (30 to 600 seconds, 120 by default) and maximum feedback length (300 by default) apply to the whole course.',
          'The course context text is sent to the model with each check, so describe what the course is discussing.',
          'The response language, response style and AI persona fields on the same page are saved but do not yet affect the feedback.',
        ],
      },
      { kind: 'h3', zh: '支架', en: 'Scaffolds' },
      {
        kind: 'p',
        zh: '在画布工具栏点「Scaffold」打开「支架管理」，可以新建支架，把某条在本课隐藏或恢复显示，标为必用或推荐。隐藏的支架，学生和老师写笔记时都不会在支架栏里看到；在支架管理里打开「显示已隐藏」可以找回来恢复。支架分「全局」和「本课程」两种，全局支架是各门课共用的。',
        en: 'Click Scaffolds in the canvas toolbar to open scaffold management. You can add scaffolds, hide or restore them for this course, and mark them required or recommended. A hidden scaffold no longer appears in the scaffold column when anyone writes a note, teachers included; turn on "Show hidden" in scaffold management to find and restore it. Scaffolds are either global, shared by all courses, or specific to this course.',
      },
      {
        kind: 'p',
        zh: '打开「强制使用支架」后，学生贡献普通笔记时必须至少用一条支架，没用会被拦下并提示（第 4 节）。综合升华笔记不受限制。目前教师自己保存笔记时也会被拦下，写示范笔记前可以先关掉。',
        en: 'With "Require scaffold" on, a student\'s ordinary note must contain at least one scaffold or it will not be contributed (section 4). Rise-above notes are exempt. At present the rule also applies to teachers\' own notes, so switch it off while writing a model note.',
      },
      { kind: 'h3', zh: '小组与实验条件', en: 'Groups and study conditions' },
      {
        kind: 'p',
        zh: '画布工具栏的「小组」打开小组管理，有「小组概览」「协作任务」「分析」「实验设置」四个页签。在小组概览里创建小组、把学生拖进去、设组长；右侧「待分配」里也列着还没进组的教师，教师也可以拖进小组，和学生一起讨论；「为每组建空间」给每个组建一块只有本组能进的空间。「协作任务」是各组的任务板，在左上角「查看小组」里切换组。观点图谱按小组计算，没分组就没有图谱，开课后尽早分组。',
        en: 'Groups in the canvas toolbar opens group management, with four tabs: Overview, Collaborative tasks, Analysis and Experiment settings. In Overview you create groups, drag students into them and choose leaders; teachers not yet in a group are listed under "Not in a group" too and can be dragged into a group to join the discussion; "Create group spaces" gives each group a space only its members can enter. Collaborative tasks shows each group\'s task board; switch groups with "Group" at the top left. The idea graph is computed per group, so assign groups early.',
      },
      {
        kind: 'p',
        zh: '做对照研究时，可以给每个小组标「实验组」「对照组」或「未分配」，在「实验设置」里打开「实验模式」，也可以给个别学生单独设「强制开」或「强制关」，优先于小组条件。对照组学生收不到自动反馈，「请求反馈」也不会返回结果，看不到 AI 写的话头和讨论室里的系统卡片；系统仍会用规则检测并记下影子记录，不投递给学生，留作事后对比。实验模式下，没分组的学生按对照组处理，学生只能在本组的空间里发笔记。',
        en: 'For a controlled study, mark each group as experimental, control or unassigned, and turn on experiment mode under Experiment settings. Individual students can be forced on or off, which overrides their group. Control students get no automatic feedback, no result from "Ask AI", no AI-written prompts and no system cards in rise-above rooms. The system still detects with rules and records shadow data without delivering it, for later comparison. In experiment mode, students without a group count as control, and students can post only in their own group\'s space.',
      },
      { kind: 'h3', zh: '学生求助', en: 'Student help' },
      {
        kind: 'figure',
        src: '/manual/ui-teacher-helpdesk.jpg',
        cap: {
          zh: '学生求助。AI 答不了或学生说没解决的问题转到这里，默认只显示等你回复的。',
          en: 'Student help. Questions the AI could not answer, or that students marked unsolved, land here. By default only those waiting for you are shown.',
        },
      },
      {
        kind: 'list',
        zh: [
          '顶上四个数：等你回复、AI 已解决、你已回复、累计。默认筛选是「待回复」，可以切到「全部」。',
          '展开「AI 当时的回答 · 提问时的处境」，能看到 AI 当时怎么答的，以及学生所在的页面、打开的面板、模型、窗口大小、空间和版本。',
          '学生贴的截图直接显示在问题下面。',
          '同样的问题反复出现时会标「×N」（按问题的前 40 个字判断）。一周里七个人问同一件事，多半是界面设计的问题。',
          '这些问答会进研究数据导出。同一位创建者的各门课程之间会复用这些问答，其他老师的课程不会混进来。',
        ],
        en: [
          'Four counts at the top: waiting for you, solved by AI, answered by you, and total. The default filter is waiting; switch to All to see everything.',
          'Expand the AI\'s answer and context to see how the AI replied and where the student was: page, open panel, model, window size, space and version.',
          'Screenshots the student attached appear under the question.',
          'Repeated questions are marked ×N, matched on their first 40 characters. Seven people asking the same thing in a week usually points to a design problem.',
          'These exchanges go into the research export. Questions are reused across courses with the same creator; other teachers\' courses are kept separate.',
        ],
      },
      {
        kind: 'p',
        zh: '学生求助也在每个页面右边缘的「使用帮助」小球里：有学生在等你回复时，球上显示条数。点开先是「学生求助」页签，在里面直接回复，学生在自己的「使用帮助」里看到；底下的按钮回到这一页看全部记录。另一个页签「问 AI」回答你自己的平台操作问题，依据包括这一章；手册里没写到的，可以一键转给平台管理员。你问的不会出现在课程的学生求助里，也不进研究数据导出。',
        en: 'Student help also lives in the Help ball on the right edge of every page: when students are waiting for you, the ball shows how many. It opens on the Student help tab, where you can reply directly; students see the reply in their own Help window, and the button at the bottom brings you back to this page for the full record. The other tab, Ask the AI, answers your own questions about the platform, drawing on this chapter too; anything the manual does not cover can go to the platform administrator in one click. Your questions do not appear in a course\'s student help and are not part of the research export.',
      },
      { kind: 'h3', zh: '研究数据导出', en: 'Research export' },
      {
        kind: 'p',
        zh: '在「研究 → 数据导出」里导出。第一次用要先给课程填英文名称，点「保存并生成编号」，每位学生会得到一个稳定编号（如 STPKB01）。',
        en: 'Export data from Research → Export. The first time, give the course an English name and click "Save & generate codes"; each student then gets a stable code such as STPKB01.',
      },
      {
        kind: 'p',
        zh: '一共 11 张表：笔记总表、互动总表、参与者名册、对话消息、AI 内嵌反馈、AI 干预日志、AI 反馈检查记录、行为事件流、笔记修订史、学生求助问答、课次记录。可以按课程、知识空间、小组（标着实验或对照）、View 和时间范围筛选；「包含」里可以勾 AI 生成笔记、已删除笔记、对照组影子记录和真实姓名；「显示列」里的技术 ID 默认不显示。单张表点「导出这张表」得到 CSV；「一次导出多张表」（至少两张，可选「核心三表」或「全选」）得到附说明文件的 ZIP。表头可以选中文或英文。',
        en: 'There are eleven tables: notes, interactions, participants, conversation messages, in-note AI feedback, AI intervention log, AI feedback checks, event stream, note revisions, student help, and class sessions. Filter by course, space, group (marked experimental or control), view and date range. Under Include you can add AI-generated notes, deleted notes, control-group shadow records and real names; technical IDs are hidden by default under Columns. "Export this table" gives a CSV; "Export several tables" (two or more, or the core three, or all) gives a ZIP with a readme. Headers can be in Chinese or English.',
      },
      {
        kind: 'p',
        zh: '和 AI 反馈有关的列包括「不采纳的归类」「不采纳的补充说明」「AI 建议的支架」「AI 支架是否被使用」，多数表上还有「实验条件」一列。「AI 反馈检查记录」从 2026 年 10 月 5 日起才有：一行一次自动检查，没出反馈的也在，记着要不要反馈、哪一类、原来的模型和 Jev 各自怎么判、由谁决定，用来算触发率和两边的一致率。',
        en: 'Columns about AI feedback include the reason category for not adopting, the free-text note, the AI-suggested scaffold and whether it was used. Most tables also carry the study condition. The AI feedback checks table starts on 5 October 2026: one row per automatic check, including checks that produced no feedback, with whether feedback was needed, which type, how the existing model and Jev each judged, and who decided. Use it for trigger rates and for how often the two agree.',
      },
      {
        kind: 'callout',
        tone: 'warn',
        label: { zh: '真实姓名', en: 'Real names' },
        zh: ['「真实姓名」默认不导出，勾上时页面会显示警告。不勾时每个人用稳定编号代替，跨表能对上，但对应不到具体的人。做匿名分析保持默认即可。'],
        en: ['Real names are left out unless you tick them, and the page warns you when you do. Without them each person has a stable code that joins across tables but does not identify anyone. Keep the default for anonymous analysis.'],
      },
      { kind: 'h3', zh: '主持图灵测试', en: 'Running a Turing test' },
      {
        kind: 'p',
        zh: '在画布工具栏点「探究」，在「探究工具」的「图灵测试」卡片上点「设置与主持」，进入主持页。',
        en: 'Click Inquiry in the canvas toolbar and choose "Set up" on the Turing test card under Inquiry tools to open the hosting page.',
      },
      {
        kind: 'list',
        zh: [
          '设置：活动标题、群聊话题、给学生的任务说明；扮演同学的模型（默认 DeepSeek Flash）和人设；对话时长 2 到 30 分钟（默认 5 分钟）；每群学生数 2 到 12（默认 6）；每群 AI 数 1 到 3（默认 1）；是否告诉学生群里有几个 AI（默认告诉）。',
          '阶段按钮依次是「开放给学生」「分群并开始对话」（至少要有 2 名学生）「结束对话，开始判断」「公布答案」「结束活动」。',
          '对话进行时可以「旁观」任意一个群。成员的真名和 AI 身份默认遮住，点「显示身份」才出现，投屏时不会泄底。',
          '公布答案后显示全班判断准确率、AI 被认出的比例、真人被当成 AI 的比例，以及判对和判错的学生各自靠的线索。',
        ],
        en: [
          'Settings: title, chat topic and instructions for students; the model playing classmates (DeepSeek Flash by default) and its persona; chat length 2 to 30 minutes (5 by default); students per group 2 to 12 (6 by default); AI members per group 1 to 3 (1 by default); and whether to tell students how many AIs there are (on by default).',
          'The phase buttons run in order: open to students, form groups and start (at least two students), end the chat and start judging, reveal, and end the activity.',
          'While groups are chatting you can watch any of them. Real names and AI identities stay hidden until you click "Show identities", so nothing leaks on a projector.',
          'After the reveal you see the class\'s accuracy, how often AIs were spotted, how often humans were taken for AIs, and the clues used by those who got it right and wrong.',
        ],
      },
      { kind: 'h3', zh: '备课助手、学情分析、教学评估', en: 'Lesson prep, analytics and assessment' },
      {
        kind: 'p',
        zh: '这三个在侧栏「AI 智能体」里，各有自己的历史对话（时钟图标），记录可以删除，齿轮里可以设课程上下文和模型。「备课助手」按课程、时长、探究主题和知识建构原则生成教案、教学资源、探究活动或讨论分析，结果可以「导出」为 Word。「学情分析」用对话的方式查询这门课的数据。「教学评估」给出参与学生数、高支持学生比例、风险提示数和 AI 反馈接受率，「完整评估报告」生成带图表的 Word 报告。',
        en: 'All three are under AI Agents in the sidebar. Each keeps its own history (the clock icon), entries can be deleted, and the gear sets the course context and model. Lesson prep generates a lesson plan, teaching resources, an inquiry activity or a discussion analysis from the course, length, inquiry topic and knowledge-building principles, and exports to Word. Analytics lets you query the course\'s data in conversation. Assessment shows participating students, the share needing high support, risk alerts and AI feedback acceptance, and "Full assessment report" produces a Word report with charts.',
      },
      { kind: 'h3', zh: '登录记录', en: 'Sign-in records' },
      {
        kind: 'p',
        zh: '在画布工具栏的「成员」→「成员管理」里，「最后登录」一列显示每位学生最近一次登录和 30 天内的登录次数，点开能看登录记录。只记录时间和登录方式，保留 180 天。',
        en: 'Under Members → Member management in the canvas toolbar, the "Last sign-in" column shows each student\'s latest sign-in and how many times they signed in over 30 days; click to see the record. Only the time and method are kept, for 180 days.',
      },
    ],
  },

  // ── 15 ────────────────────────────────────────────────────────────────
  {
    id: 'faq',
    num: '15',
    title: { zh: '常见问题', en: 'Common problems' },
    blocks: [
      {
        kind: 'faq',
        items: [
          {
            q: { zh: '密码忘了怎么办', en: 'I forgot my password' },
            a: {
              zh: ['在登录页点「忘记密码？」，重置邮件会发到你的邮箱。先看看垃圾邮件，还是收不到就告诉老师，由平台管理员帮你重置。', '别反复试密码，试多了会被暂时锁住。'],
              en: ['Use "Forgot password?" on the sign-in page and a reset email is sent to you. Check your spam folder; if it still does not arrive, tell your teacher and a platform administrator will reset it.', 'Do not keep retrying. Too many attempts lock sign-in for a while.'],
            },
          },
          {
            q: { zh: '写的笔记不见了', en: 'My note has disappeared' },
            a: {
              zh: ['按顺序查一下：', '一、是不是在别的视图里。点顶栏右侧的 `VIEW` 菜单或工具栏「视图」切换看看。', '二、是不是画布拖远了。点右下角「重置视图」，画面会回到当前视图里笔记所在的地方。', '三、有没有点「贡献」。笔记页不会自动保存，没贡献就关掉，内容不会留下。', '都不是的话，找老师看看。'],
              en: ['Check in this order:', '1. Is it in another view? Switch with the `VIEW` menu at the top right or Views in the toolbar.', '2. Has the canvas been dragged away? Click "Reset view" at the bottom right to return to where the notes in the current view are.', '3. Did you click Contribute? The note page does not save automatically; closing it without contributing loses the text.', 'If none of these, ask your teacher to take a look.'],
            },
          },
          {
            q: { zh: 'AI 一直转圈，半天没反应', en: 'The AI spins and nothing happens' },
            a: {
              zh: ['笔记页的 AI 会显示「正在思考」，等了三秒以上还会显示已经等了几秒，知识空间助手也一样。推理模型有时要十几秒才开始写。', '超过一分钟还没动静，刷新页面再试，或者在模型菜单里换一个模型。反复这样的话，点右边的「使用帮助」说一声。'],
              en: ['The note page\'s AI shows "Thinking" and, after three seconds, how many seconds you have waited; the workspace assistant does the same. A reasoning model can take ten or twenty seconds before it starts writing.', 'If nothing happens after a minute, reload and try again, or pick another model. If it keeps happening, say so in the Help tab.'],
            },
          },
          {
            q: { zh: 'AI 自动反馈从来没出现过', en: 'Automatic feedback never appears' },
            a: {
              zh: ['常见原因：', '笔记还没贡献过。自动反馈只对贡献过的笔记起作用。', '正文不到 120 字，或者和上次检查时相比没有改动。', '一直在打字。它在你停下来之后才检查，两次检查至少隔 45 秒。', 'AI 没发现值得提醒的地方，多数时候它本来就不出声。', '想马上要一条，点「请求反馈」。另外，自动反馈是否开启由老师按课程设置。'],
              en: ['The usual reasons:', 'The note has never been contributed. Automatic feedback only works on contributed notes.', 'The body is under 120 characters, or has not changed since the last check.', 'You are still typing. It checks after you stop, at most once every 45 seconds.', 'The AI found nothing worth raising. Most of the time it stays quiet.', 'To get feedback right away, click "Ask AI". Whether automatic feedback is on is also up to your teacher\'s course settings.'],
            },
          },
          {
            q: { zh: '手机上能用吗', en: 'Does it work on a phone?' },
            a: {
              zh: ['可以看笔记、参与讨论。在同学的笔记上 Build-on 也可以：打开那条笔记，点右下角的「Build-on」选一种方式。画布操作和综合升华建议用电脑。屏幕窄的时候笔记页看不到支架栏，如果老师要求必须用支架，请在电脑上写。'],
              en: ['You can read notes and take part in discussion, including building on a classmate\'s note: open it and click "Build-on" at the bottom right. Canvas work and rise-above are better on a computer. On a narrow screen the note page hides the scaffold column, so if your course requires scaffolds, write on a computer.'],
            },
          },
          {
            q: { zh: '别人的笔记能挪，却改不了内容', en: 'I can move others\' notes but not edit them' },
            a: {
              zh: ['这是正常的。同一空间的成员都能挪动卡片、调整布局；笔记的内容只有作者和老师能改。别人的笔记你可以读、可以接着写、可以质疑。', '别人的笔记在详情面板里没有「编辑」按钮。双击打开别人的笔记，正文只能阅读，右下角没有「贡献」，换成了「Build-on」：想回应就从这里接着写一条新的。'],
              en: ['That is expected. Anyone in the space can move cards and rearrange the layout, but only the author and teachers can change a note\'s content. You can read, build on and challenge anyone else\'s notes.', 'The detail panel shows no Edit button on other people\'s notes. When you open someone else\'s note, its text is read-only and the Contribute button is replaced by Build-on: use it to respond with a note of your own.'],
            },
          },
          {
            q: { zh: '为什么有的笔记我看不到', en: 'Why can I not see some notes?' },
            a: {
              zh: ['老师给各组分了各自的空间时，你只能看到自己组的空间。这是课程设置，不是出错了。'],
              en: ['If your teacher gave each group its own space, you only see your own group\'s. That is how the course is set up, not a fault.'],
            },
          },
          {
            q: { zh: '不小心加错课程了', en: 'I joined the wrong course' },
            a: {
              zh: ['回到首页，在「我的课程」里把鼠标移到那门课的卡片上，点「退出课程」。你写过的笔记会留在课程里。画布工具栏的「退出」只是回到首页。'],
              en: ['Go to the home page, hover over that course\'s card under My courses and click "Leave course". Notes you wrote stay in the course. Exit in the canvas toolbar only takes you back to the home page.'],
            },
          },
          {
            q: { zh: '上传的文件打不开', en: 'An uploaded file will not open' },
            a: {
              zh: ['图片、PDF、Word、Markdown 都能在网页里直接打开，Word 和 Markdown 还能编辑。打不开的话，看看文件是否超过 500 MB，或者格式是否少见。', '出于安全考虑，SVG 和 HTML 文件不能上传，请改成 PNG 或 JPG。'],
              en: ['Images, PDF, Word and Markdown open in the browser, and Word and Markdown can be edited there. If a file will not open, check whether it is over 500 MB or in an unusual format.', 'For security reasons SVG and HTML files cannot be uploaded. Use PNG or JPG instead.'],
            },
          },
          {
            q: { zh: 'AI 说的话可以直接抄进笔记吗', en: 'Can I paste the AI\'s words into my note?' },
            a: {
              zh: ['用「添加到 Note」插入的内容会带「AI 来源」标记，老师和同学都看得到。直接复制粘贴不带标记，自动反馈可能会提示「未消化的 AI 内容」。', '比较好的做法：读完 AI 的回答，用自己的话写进笔记，再写下你同意或不同意的地方。'],
              en: ['Text inserted with "Add to Note" carries an AI source mark that your teacher and classmates can see. Pasted text carries no mark, and automatic feedback may flag it as undigested AI content.', 'A better way: read the AI\'s answer, write it into your note in your own words, and add where you agree or disagree.'],
            },
          },
          {
            q: { zh: '支架插错了怎么办', en: 'I inserted the wrong scaffold' },
            a: {
              zh: ['把鼠标移到支架上，点左上角的小叉。框去掉，你写的字会留下。'],
              en: ['Hover over the scaffold and click the small × at its top left. The frame goes and your words stay.'],
            },
          },
          {
            q: { zh: '采纳反馈以后，画布上多了一张卡片', en: 'Accepting feedback added a card to the canvas' },
            a: {
              zh: ['那是对话式笔记，作者显示为 AI Partner，标题是 AI 总结的这条反馈在谈什么，标着「可继续对话」，用延伸关系连在你的笔记上。双击它可以接着追问，见第 7 节。'],
              en: ['That is a dialogue note, shown with the author AI Partner, titled by the AI with what the feedback is about, marked "Open dialogue", and linked to your note as an extension. Double-click it to keep asking (section 7).'],
            },
          },
          {
            q: { zh: '界面和这份手册对不上', en: 'The interface does not match this manual' },
            a: {
              zh: ['平台还在随课程调整。先看侧栏最下面的「更新日志」，多半是刚改过。', '还是对不上，点右边的「使用帮助」问一句，AI 答不上来会转给老师。'],
              en: ['The platform keeps changing as courses run. Check What\'s new at the bottom of the sidebar first; it has probably just changed.', 'If it still does not match, ask in the Help tab. Anything the AI cannot answer goes to your teacher.'],
            },
          },
        ],
      },
    ],
  },
];

export const MANUAL_FOOTER: Bilingual = {
  zh: '手册里的截图和录屏来自一门演示课程，其中的姓名、笔记和 AI 的回答都是演示数据。平台会随课程推进调整，界面和截图不一致时，以你看到的界面为准，并到侧栏最下面的更新日志里确认。',
  en: 'The screenshots and recordings come from a demonstration course; the names, notes and AI replies in them are demo data. The platform changes as courses run, so if the interface differs from a screenshot, trust the interface and check What\'s new at the bottom of the sidebar.',
};
