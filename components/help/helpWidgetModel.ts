/**
 * 使用帮助小球的纯逻辑：挂在哪些页面、球停在哪、问哪门课、常见问题、未读的老师回复。
 * 和界面分开写，才能不挂 DOM 直接测。
 */

import type { SupportQuestion } from '../../services/apiClient';

export type HelpLang = 'zh' | 'en';

export type HelpSurface =
  | 'dashboard'
  | 'canvas'
  | 'note-editor'
  | 'document'
  | 'discussion-room'
  | 'turing-test'
  | 'ct-tool'
  | 'ai-assistant'
  | 'mobile-notes'
  | 'mobile-agent'
  | 'mobile-community'
  | 'mobile-profile'
  | 'other';

export interface HelpRoute {
  /** 地址里带的课程。首页没有，要另外挑一门 */
  courseId: string | null;
  surface: HelpSurface;
}

/** 只有登录后的页面挂。公开首页、登录、重置密码页不挂。 */
const APP_PAGES = /^\/(dashboard|workspace|ai-assistant|course)(\/|$)/;

export function routeInfo(pathname: string): HelpRoute {
  const workspace = /^\/workspace\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (workspace) {
    const courseId = decodeURIComponent(workspace[1]);
    const rest = workspace[2] ?? '';
    if (rest.startsWith('note/')) return { courseId, surface: 'note-editor' };
    if (rest.startsWith('turing-test')) return { courseId, surface: 'turing-test' };
    if (rest.startsWith('ct-tool')) return { courseId, surface: 'ct-tool' };
    return { courseId, surface: 'canvas' };
  }
  const settings = /^\/course\/([^/]+)\//.exec(pathname);
  if (settings) return { courseId: decodeURIComponent(settings[1]), surface: 'other' };
  if (pathname.startsWith('/dashboard')) return { courseId: null, surface: 'dashboard' };
  if (pathname.startsWith('/ai-assistant')) return { courseId: null, surface: 'ai-assistant' };
  return { courseId: null, surface: 'other' };
}

/** 教师、管理员：球里多一个「学生求助」页签，问 AI 时按含教师端的手册答 */
export function isHelpStaff(role: string | null | undefined): boolean {
  return role === 'teacher' || role === 'admin';
}

/**
 * 学生、教师、管理员都挂。教师原来没有（他们有首页的「学生求助」收件箱），2026-10-05 用户要：
 * 教师在哪个页面都能看到学生的求助，自己遇到技术问题也能问 AI。
 * 图灵测试页不给学生显示：那是匿名群聊实验，学生不该能转身去问另一个 AI「群里谁是 AI」，球本身也会分心。
 * 主持的老师不是被试，照常显示。
 */
export function shouldShowHelp(role: string | null | undefined, pathname: string): boolean {
  if (role !== 'student' && !isHelpStaff(role)) return false;
  if (!APP_PAGES.test(pathname)) return false;
  return routeInfo(pathname).surface !== 'turing-test' || isHelpStaff(role);
}

/** 小球上的数：等我回复的学生求助，管理员再加上教师转来的 */
export function inboxWaiting(counts: { student: number; teacher: number } | null | undefined): number {
  if (!counts) return 0;
  return Math.max(0, counts.student || 0) + Math.max(0, counts.teacher || 0);
}

// ── 球的位置 ───────────────────────────────────────────────────────

/** 窄屏按手机算：底部有标签栏和新建笔记的圆按钮，要多让出一截。 */
export const COMPACT_MAX_WIDTH = 640;
/** 顶栏的高度，球不往上面去 */
const TOP_RESERVE = 72;
/**
 * 底部让出的高度。电脑上要躲开笔记页右下角的「关闭」「贡献」和画布右下角的缩放条；
 * 手机上要躲开底部标签栏（约 63px 加安全区）和笔记列表右下角的新建按钮（到底边约 153px）。
 */
const BOTTOM_RESERVE = { desktop: 96, compact: 160 };

export interface BallBounds { min: number; max: number }

export function ballBounds(viewportHeight: number, ballHeight: number, compact: boolean): BallBounds {
  const min = TOP_RESERVE;
  const max = Math.max(min, viewportHeight - ballHeight - (compact ? BOTTOM_RESERVE.compact : BOTTOM_RESERVE.desktop));
  return { min, max };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 位置按「在可用范围里的比例」存：换了窗口高度，球还在原来那个相对位置。 */
export function topFromRatio(ratio: number, bounds: BallBounds): number {
  return Math.round(bounds.min + clamp01(ratio) * (bounds.max - bounds.min));
}

export function ratioFromTop(top: number, bounds: BallBounds): number {
  if (bounds.max <= bounds.min) return 1;
  return clamp01((top - bounds.min) / (bounds.max - bounds.min));
}

export const BALL_POSITION_KEY = 'hakcc.help.ball';
/**
 * 默认停在右边缘中间偏下。再往下，笔记页那一段是「AI 自动反馈」，反馈卡片右上角的 ×
 * 正好在边上；中间偏下的位置在各页面都只是空白或面板的内边距。
 */
export const DEFAULT_BALL_RATIO = 0.62;

/** 存储随时可能不可用（隐私模式、被禁用），读不到就用默认值，不能让页面挂掉。 */
export function readBallRatio(): number {
  try {
    const raw = window.localStorage.getItem(BALL_POSITION_KEY);
    if (raw === null) return DEFAULT_BALL_RATIO;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp01(n) : DEFAULT_BALL_RATIO;
  } catch {
    return DEFAULT_BALL_RATIO;
  }
}

export function saveBallRatio(ratio: number): void {
  try {
    window.localStorage.setItem(BALL_POSITION_KEY, String(Math.round(clamp01(ratio) * 1000) / 1000));
  } catch {
    // 存不了就只在这次打开的页面里记住
  }
}

// ── 问哪门课 ───────────────────────────────────────────────────────

const LAST_COURSE_KEY = 'hakcc.help.course';

export function rememberCourse(courseId: string): void {
  try { window.localStorage.setItem(LAST_COURSE_KEY, courseId); } catch { /* 同上 */ }
}

export function readRememberedCourse(): string | null {
  try { return window.localStorage.getItem(LAST_COURSE_KEY); } catch { return null; }
}

export function forgetCourse(): void {
  try { window.localStorage.removeItem(LAST_COURSE_KEY); } catch { /* 同上 */ }
}

/** 首页上没有「当前课程」：先用最近进过的那门，不在列表里就用第一门。 */
export function pickCourse(courses: ReadonlyArray<{ id: string }>, remembered: string | null): string | null {
  if (remembered && courses.some(c => c.id === remembered)) return remembered;
  return courses[0]?.id ?? null;
}

// ── 老师的新回复 ─────────────────────────────────────────────────────

const seenKey = (courseId: string) => `hakcc.help.seen.${courseId}`;
const WEEK_MS = 7 * 24 * 3600 * 1000;

export function readSeenAt(courseId: string): string | null {
  try { return window.localStorage.getItem(seenKey(courseId)); } catch { return null; }
}

export function markSeen(courseId: string, at: Date = new Date()): void {
  try { window.localStorage.setItem(seenKey(courseId), at.toISOString()); } catch { /* 同上 */ }
}

/**
 * 上次打开以后老师回复了几条。没有打开记录（换了浏览器、清过数据）时只算最近一周的，
 * 免得把一学期前的回复都当成新的。
 */
export function unseenTeacherReplies(
  questions: ReadonlyArray<Pick<SupportQuestion, 'teacherAnswer' | 'teacherAnsweredAt'>>,
  seenAt: string | null,
  now: number = Date.now(),
): number {
  const since = seenAt ? Date.parse(seenAt) : now - WEEK_MS;
  return questions.filter(q => q.teacherAnswer && q.teacherAnsweredAt && Date.parse(q.teacherAnsweredAt) > since).length;
}

// ── 回答依据 ───────────────────────────────────────────────────────

export interface AnswerGrounding {
  manual: Array<{ num: string; title: string }>;
  teacherAnswers: number;
  covered: boolean | null;
}

/** 依据是服务端写进处境里的，旧记录没有；形状不对就当没有。 */
export function readGrounding(context: unknown): AnswerGrounding | null {
  const g = (context as { grounding?: unknown } | null)?.grounding;
  if (!g || typeof g !== 'object') return null;
  const raw = g as Record<string, unknown>;
  const manual = Array.isArray(raw.manual)
    ? raw.manual
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
      .map(m => ({ num: String(m.num ?? ''), title: String(m.title ?? '') }))
      .filter(m => /^\d{2}$/.test(m.num))
    : [];
  return {
    manual,
    teacherAnswers: typeof raw.teacherAnswers === 'number' ? raw.teacherAnswers : 0,
    covered: typeof raw.covered === 'boolean' ? raw.covered : null,
  };
}

// ── 常见问题 ───────────────────────────────────────────────────────

type QuickSet = { zh: string[]; en: string[] };

/** 每一条都在学生手册里有答案，点了直接问。按学生当时所在的页面给。 */
const QUICK: Record<'dashboard' | 'canvas' | 'note' | 'document' | 'room' | 'phone', QuickSet> = {
  dashboard: {
    zh: ['怎么加入一门新课？', '加错课程了怎么退出？', '在哪里看老师给我的评语？', '密码忘了怎么办？'],
    en: ['How do I join a new course?', 'I joined the wrong course. How do I leave?', "Where do I see my teacher's comments?", 'I forgot my password'],
  },
  canvas: {
    zh: ['怎么在同学的笔记上 Build-on？', '我写的笔记不见了', '为什么有的笔记我看不到？', '怎么做综合升华？'],
    en: ["How do I build on a classmate's note?", 'My note has disappeared', 'Why can I not see some notes?', 'How do I do a rise-above?'],
  },
  note: {
    zh: ['写完的笔记怎么保存？', '支架插错了怎么去掉？', 'AI 的回答怎么放进笔记？', '为什么没有出现 AI 自动反馈？'],
    en: ['How do I save my note?', 'I inserted the wrong scaffold', "How do I put the AI's answer into my note?", 'Why is there no automatic feedback?'],
  },
  document: {
    zh: ['怎么给文档加批注？', '怎么把一段原文引用到笔记？', '上传的文件打不开怎么办？'],
    en: ['How do I comment on a document?', 'How do I quote a passage into a note?', 'An uploaded file will not open'],
  },
  room: {
    zh: ['怎么让 AI 同学发言？', '讨论好的说法怎么发布？', '我写的笔记不见了'],
    en: ['How do I get an AI classmate to speak?', 'How do we publish what we agreed on?', 'My note has disappeared'],
  },
  phone: {
    zh: ['手机上能用吗？', '我写的笔记不见了', '怎么在同学的笔记上 Build-on？'],
    en: ['Does it work on a phone?', 'My note has disappeared', "How do I build on a classmate's note?"],
  },
};

/** 教师问的：每一条都在手册的「教师端」一章或前面的章节里有答案 */
const QUICK_TEACHER: Record<'home' | 'course', QuickSet> = {
  home: {
    zh: ['怎么给 AI 反馈换一个模型？', '怎么关掉 AI 自动反馈？', '怎么导出研究数据？', '怎么邀请别的老师一起管课程？'],
    en: ['How do I change the model for AI feedback?', 'How do I turn off automatic AI feedback?', 'How do I export research data?', 'How do I invite another teacher to co-manage a course?'],
  },
  course: {
    zh: ['怎么给学生分组？', '怎么隐藏一条支架？', '怎么关掉 AI 自动反馈？', '怎么看全班的 Build-on 网络？'],
    en: ['How do I put students into groups?', 'How do I hide a scaffold?', 'How do I turn off automatic AI feedback?', "How do I see the class's Build-on network?"],
  },
};

export function quickQuestions(surface: HelpSurface, lang: HelpLang, compact: boolean, asker: 'student' | 'teacher' = 'student'): string[] {
  if (asker === 'teacher') {
    const home = surface === 'dashboard' || surface === 'ai-assistant' || surface === 'other';
    return QUICK_TEACHER[home ? 'home' : 'course'][lang].slice(0, compact ? 3 : 4);
  }
  let set: QuickSet;
  if (surface === 'dashboard' || surface === 'ai-assistant') set = QUICK.dashboard;
  else if (surface === 'note-editor') set = QUICK.note;
  else if (surface === 'document') set = QUICK.document;
  else if (surface === 'discussion-room') set = QUICK.room;
  else if (surface.startsWith('mobile-')) set = QUICK.phone;
  else set = QUICK.canvas;
  return set[lang].slice(0, compact ? 3 : 4);
}

// ── 对话框打开时让路 ─────────────────────────────────────────────────

/**
 * 页面上的对话框都是一层 fixed inset-0 的遮罩（backdrop-blur 或 bg-black/xx，
 * 写在根上或它的第一层子元素上）。笔记页、阅读页、讨论室是整页，不带遮罩。
 * 球的层级在整页之上，有对话框时就收起来，不压在对话框上面。
 */
export const DIALOG_BACKDROP_SELECTOR = [
  '.fixed.inset-0[class*="backdrop-blur"]',
  '.fixed.inset-0 > .absolute.inset-0[class*="backdrop-blur"]',
  '.fixed.inset-0[class*="bg-black/"]',
].join(', ');

export function hasOpenDialog(doc: Document): boolean {
  return Array.from(doc.querySelectorAll(DIALOG_BACKDROP_SELECTOR))
    .some(el => !el.closest('[data-help-widget]'));
}

/** 手机上在页面别处打字时球让开，不挡输入框，也不挡弹出的键盘上方那一截。 */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}
