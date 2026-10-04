// @vitest-environment jsdom
/**
 * 使用帮助小球：挂真的组件和真的 apiClient，接口用假的 fetch 回答。
 * 看的是学生实际碰到的几件事：谁看得到球、点开收起、问一句拿到回答、转给老师、拖动换位置。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const h = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => undefined;
  return {
    user: null as null | { id: string; name: string; email: string; role: 'student' | 'teacher' | 'admin' },
  };
});

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: h.user, loading: false }),
}));

import HelpWidget from './HelpWidget';
import { useReportHelpContext, type HelpPageContext } from './helpContext';
import { hasOpenDialog } from './helpWidgetModel';

type Row = Record<string, any>;

const now = () => new Date().toISOString();

function question(over: Partial<Row> = {}): Row {
  return {
    id: 'q-1', courseId: 'course-1', spaceId: null, userId: 'stu-1', userName: null,
    question: '怎么接着同学的笔记写？', aiAnswer: '1. 单击那条笔记。\n2. 点「建立于此」。',
    aiProvider: 'deepseek', aiModel: 'deepseek-flash', aiResolved: null,
    escalatedAt: null, escalationNote: null, teacherAnswer: null, teacherAnsweredAt: null,
    status: 'ai_answered', attachments: [],
    context: { grounding: { manual: [{ num: '05', title: '接着同学的笔记写：Build-on' }], teacherAnswers: 0, covered: true } },
    createdAt: now(), updatedAt: now(),
    ...over,
  };
}

let backend: {
  history: Row[];
  courses: Array<{ id: string; title: string }>;
  answer: (body: Row) => Row;
  calls: Array<{ method: string; url: string; body: Row | null }>;
};

function stubBackend() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) as Row : null;
    backend.calls.push({ method, url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

    if (method === 'GET' && url.includes('/support/questions/mine')) return json({ questions: backend.history });
    if (method === 'POST' && url.endsWith('/support/questions')) return json({ question: backend.answer(body!) }, 201);
    const patch = url.match(/\/support\/questions\/([^/?]+)$/);
    if (method === 'PATCH' && patch) {
      const current = backend.history.find(q => q.id === patch[1]) ?? question({ id: patch[1] });
      const next = body!.escalate
        ? { ...current, status: 'escalated', escalatedAt: now(), escalationNote: body!.note ?? null, aiResolved: false }
        : { ...current, status: 'resolved', aiResolved: true };
      return json({ question: next });
    }
    if (method === 'GET' && url.endsWith('/courses')) return json({ courses: backend.courses });
    return json({});
  }));
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function settle(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function waitFor<T>(probe: () => T | null | undefined | false, label: string, timeout = 4000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value as T;
    if (Date.now() - started > timeout) throw new Error(`等不到：${label}`);
    await settle(10);
  }
}

function Reporter({ context }: { context: HelpPageContext }) {
  useReportHelpContext(context);
  return null;
}

async function mount(path: string, role: 'student' | 'teacher' | 'admin' | null = 'student', page?: HelpPageContext) {
  h.user = role ? { id: 'stu-1', name: '林晓', email: 'lin@example.test', role } : null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      page ? React.createElement(Reporter, { context: page }) : null,
      React.createElement(HelpWidget, { lang: 'zh' }),
    ));
  });
}

const ball = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
const dock = () => ball()?.closest<HTMLElement>('[data-help-widget]') ?? null;
const panel = () => document.querySelector<HTMLElement>('section[role="dialog"]');
const panelOpen = () => {
  const p = panel();
  return p && p.closest('[data-help-widget]')?.getAttribute('aria-hidden') !== 'true' ? p : null;
};
const buttonWith = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === text) ?? null;
const text = () => document.body.textContent ?? '';

function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function click(el: Element | null) {
  if (!el) throw new Error('要点的东西不在页面上');
  await act(async () => { (el as HTMLElement).click(); });
}

async function openPanel() {
  await click(ball());
  return waitFor(panelOpen, '对话窗打开');
}

const composer = () => panel()!.querySelector<HTMLTextAreaElement>('form textarea')!;

beforeEach(() => {
  localStorage.clear();
  backend = {
    history: [],
    courses: [],
    answer: body => question({
      id: `q-${backend.calls.length}`,
      question: body.question,
      aiAnswer: '1. 单击同学的那条笔记。\n2. 点「建立于此」，选一种关系。',
    }),
    calls: [],
  };
  stubBackend();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  document.querySelectorAll('[data-test-dialog]').forEach(el => el.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('谁看得到小球', () => {
  it('学生在画布、笔记页、首页都看得到', async () => {
    await mount('/workspace/course-1');
    expect(ball()).not.toBeNull();
    expect(ball()!.getAttribute('aria-expanded')).toBe('false');
  });

  it('教师和管理员看不到：他们有学生求助收件箱', async () => {
    await mount('/workspace/course-1', 'teacher');
    expect(ball()).toBeNull();
    await act(async () => { root?.unmount(); });
    host?.remove();
    await mount('/dashboard', 'admin');
    expect(ball()).toBeNull();
  });

  it('没登录、或者在公开首页，都不挂', async () => {
    await mount('/dashboard', null);
    expect(ball()).toBeNull();
    await act(async () => { root?.unmount(); });
    host?.remove();
    await mount('/', 'student');
    expect(ball()).toBeNull();
  });
});

describe('打开、提问、收起', () => {
  it('点开是对话窗，收起后回到小球', async () => {
    await mount('/workspace/course-1');
    const dialog = await openPanel();
    expect(dialog.textContent).toContain('使用帮助');
    expect(dialog.textContent).toContain('按使用手册回答');
    expect(ball()!.getAttribute('aria-expanded')).toBe('true');
    // 对话窗开着时球让开
    expect(dock()!.hasAttribute('inert')).toBe(true);

    await click(document.querySelector('button[aria-label="收起使用帮助"]'));
    expect(panelOpen()).toBeNull();
    expect(ball()!.getAttribute('aria-expanded')).toBe('false');
    expect(dock()!.hasAttribute('inert')).toBe(false);

    // 第一次打开拉一次历史；再打开再拉一次（老师可能刚回复），不多拉
    const historyCalls = () => backend.calls.filter(c => c.url.includes('/support/questions/mine')).length;
    expect(historyCalls()).toBe(1);
    await openPanel();
    await waitFor(() => historyCalls() === 2, '再次打开时重新拉历史');
    await settle(50);
    expect(historyCalls()).toBe(2);
  });

  it('问一句：带上课程和所在页面发给接口，显示回答和参考的手册章节', async () => {
    await mount('/workspace/course-1/note/n-7');
    await openPanel();
    await waitFor(() => buttonWith('写完的笔记怎么保存？'), '笔记页的常见问题');

    await act(async () => { typeInto(composer(), '怎么接着同学的笔记写？'); });
    await click(panel()!.querySelector('button[aria-label="发送"]'));

    await waitFor(() => text().includes('点「建立于此」，选一种关系。'), 'AI 回答');
    const post = backend.calls.find(c => c.method === 'POST')!;
    expect(post.url).toContain('/support/questions');
    expect(post.body).toMatchObject({
      course_id: 'course-1',
      question: '怎么接着同学的笔记写？',
      context: { surface: 'note-editor', courseId: 'course-1', panel: { activeTab: 'note-editor', entry: 'help-widget' } },
    });
    expect(post.body!.context.viewport).toEqual({ w: window.innerWidth, h: window.innerHeight });
    expect(text()).toContain('参考使用手册');
    expect(text()).toContain('05 接着同学的笔记写：Build-on');
    expect(composer().value).toBe('');
  });

  it('点常见问题直接发出去', async () => {
    await mount('/workspace/course-1');
    await openPanel();
    const chip = await waitFor(() => buttonWith('我写的笔记不见了'), '画布上的常见问题');
    await click(chip);
    await waitFor(() => backend.calls.some(c => c.method === 'POST'), '发出提问');
    expect(backend.calls.find(c => c.method === 'POST')!.body!.question).toBe('我写的笔记不见了');
  });

  it('工作区报上来的空间和页面一起带上：阅读页不改地址，只能靠它', async () => {
    await mount('/workspace/course-1', 'student', { courseId: 'course-1', surface: 'document', spaceId: 'space-9', noteId: 'n-att' });
    await openPanel();
    await waitFor(() => buttonWith('怎么给文档加批注？'), '阅读页的常见问题');
    await click(buttonWith('怎么给文档加批注？'));
    await waitFor(() => backend.calls.some(c => c.method === 'POST'), '发出提问');
    const body = backend.calls.find(c => c.method === 'POST')!.body!;
    expect(body.space_id).toBe('space-9');
    expect(body.context).toMatchObject({ surface: 'document', spaceId: 'space-9', noteId: 'n-att' });
  });
});

describe('转给老师', () => {
  it('没解决：补一句说明，转给老师，状态变成等回复', async () => {
    backend.history = [question()];
    await mount('/workspace/course-1');
    await openPanel();
    await waitFor(() => buttonWith('没解决，转给老师'), '表态按钮');

    await click(buttonWith('没解决，转给老师'));
    const note = await waitFor(() => panel()!.querySelector<HTMLTextAreaElement>('textarea[aria-label^="补充一句"]'), '补充说明');
    await act(async () => { typeInto(note, '点了还是没有'); });
    await click(buttonWith('转给老师'));

    await waitFor(() => text().includes('已转给老师，老师回复后会显示在这里'), '等回复');
    const patch = backend.calls.find(c => c.method === 'PATCH')!;
    expect(patch.url).toContain('/support/questions/q-1');
    expect(patch.body).toEqual({ escalate: true, note: '点了还是没有' });
    expect(buttonWith('解决了')).toBeNull();
  });

  it('手册没写到的回答，直接给「转给老师」，不问解决了没有', async () => {
    backend.history = [question({
      aiAnswer: '使用手册里没有写到这个问题。',
      context: { grounding: { manual: [], teacherAnswers: 0, covered: false } },
    })];
    await mount('/workspace/course-1');
    await openPanel();
    await waitFor(() => buttonWith('转给老师'), '转给老师');
    expect(buttonWith('解决了')).toBeNull();
    expect(buttonWith('没解决，转给老师')).toBeNull();
  });

  it('解决了：记下来，下一届的语料靠这一下', async () => {
    backend.history = [question()];
    await mount('/workspace/course-1');
    await openPanel();
    await click(await waitFor(() => buttonWith('解决了'), '解决了'));
    await waitFor(() => text().includes('已解决'), '已解决');
    expect(backend.calls.find(c => c.method === 'PATCH')!.body).toEqual({ resolved: true });
  });

  it('老师的回复显示在对话里', async () => {
    backend.history = [question({ status: 'teacher_answered', teacherAnswer: '这门课的笔记要先贡献再改。', teacherAnsweredAt: now() })];
    await mount('/workspace/course-1');
    await openPanel();
    await waitFor(() => text().includes('这门课的笔记要先贡献再改。'), '老师回复');
    expect(text()).toContain('老师已回复');
  });
});

describe('首页上挑课程', () => {
  it('加了两门课：显示课程选择，默认最近进过的那门', async () => {
    backend.courses = [{ id: 'course-a', title: '人工智能与学习' }, { id: 'course-b', title: '教育技术' }];
    localStorage.setItem('hakcc.help.course', 'course-b');
    await mount('/dashboard');
    await openPanel();
    const select = await waitFor(() => panel()!.querySelector<HTMLSelectElement>('select'), '课程选择');
    expect(select.value).toBe('course-b');
    await waitFor(() => backend.calls.some(c => c.url.includes('/support/questions/mine?course_id=course-b')), '按那门课拉历史');
  });

  it('还没加入课程：说清楚去哪里加', async () => {
    await mount('/dashboard');
    await openPanel();
    await waitFor(() => text().includes('发现课程'), '加入课程的提示');
    expect(panel()!.querySelector('form')).toBeNull();
  });
});

describe('小球的位置和让路', () => {
  it('上下拖动换位置并记住；拖完那一下不算点开', async () => {
    await mount('/workspace/course-1');
    const before = parseFloat(dock()!.style.top);
    const b = ball()!;
    const fire = (type: string, clientY: number) => {
      const init = { bubbles: true, clientY, button: 0, pointerId: 1, pointerType: 'mouse' };
      b.dispatchEvent(typeof PointerEvent === 'function' ? new PointerEvent(type, init) : Object.assign(new MouseEvent(type, init), { pointerId: 1, pointerType: 'mouse' }));
    };
    await act(async () => {
      fire('pointerdown', 500);
      fire('pointermove', 420);
      fire('pointermove', 300);
      fire('pointerup', 300);
      b.click();
    });
    const after = parseFloat(dock()!.style.top);
    expect(after).toBeLessThan(before);
    expect(Number(localStorage.getItem('hakcc.help.ball'))).toBeLessThan(1);
    expect(panelOpen()).toBeNull();
  });

  it('手指拖完浏览器不补 click 时，下一次点还是能点开', async () => {
    await mount('/workspace/course-1');
    const b = ball()!;
    const fire = (type: string, clientY: number) => {
      const init = { bubbles: true, clientY, button: 0, pointerId: 2, pointerType: 'touch' };
      b.dispatchEvent(typeof PointerEvent === 'function' ? new PointerEvent(type, init) : Object.assign(new MouseEvent(type, init), { pointerId: 2, pointerType: 'touch' }));
    };
    await act(async () => { fire('pointerdown', 500); fire('pointermove', 380); fire('pointerup', 380); });
    await settle(450);
    await click(b);
    await waitFor(panelOpen, '对话窗打开');
  });

  it('拖到一半被系统打断，位置不变，也不会飞到顶上', async () => {
    await mount('/workspace/course-1');
    const before = dock()!.style.top;
    const b = ball()!;
    const fire = (type: string, clientY: number) => {
      const init = { bubbles: true, clientY, button: 0, pointerId: 3, pointerType: 'touch' };
      b.dispatchEvent(typeof PointerEvent === 'function' ? new PointerEvent(type, init) : Object.assign(new MouseEvent(type, init), { pointerId: 3, pointerType: 'touch' }));
    };
    await act(async () => { fire('pointerdown', 500); fire('pointermove', 420); fire('pointercancel', 0); });
    expect(dock()!.style.top).toBe(before);
    expect(localStorage.getItem('hakcc.help.ball')).toBeNull();
  });

  it('本地存储用不了也照常显示', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
      clear: () => undefined,
    });
    await mount('/workspace/course-1');
    expect(ball()).not.toBeNull();
    await act(async () => { ball()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
    expect(ball()).not.toBeNull();
  });

  it('页面弹出对话框时球收起来，不压在对话框上', async () => {
    await mount('/workspace/course-1');
    expect(dock()!.hasAttribute('inert')).toBe(false);
    const backdrop = document.createElement('div');
    backdrop.className = 'fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm';
    backdrop.setAttribute('data-test-dialog', '');
    await act(async () => { document.body.appendChild(backdrop); });
    await waitFor(() => dock()!.hasAttribute('inert'), '球让开');
    await act(async () => { backdrop.remove(); });
    await waitFor(() => !dock()!.hasAttribute('inert'), '球回来');
  });

  it('对话框的判定：整页（笔记页、阅读页）不算，带遮罩的才算，自己的抽屉不算', () => {
    const add = (html: string) => {
      const wrap = document.createElement('div');
      wrap.setAttribute('data-test-dialog', '');
      wrap.innerHTML = html;
      document.body.appendChild(wrap);
      return wrap;
    };
    const page = add('<div class="fixed inset-0 z-[100] flex bg-white dark:bg-gray-950"></div>');
    expect(hasOpenDialog(document)).toBe(false);
    const own = add('<div data-help-widget=""><div class="fixed inset-0 z-[110] bg-black/30"></div></div>');
    expect(hasOpenDialog(document)).toBe(false);
    const modal = add('<div class="fixed inset-0 z-[100] flex p-4"><div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div></div>');
    expect(hasOpenDialog(document)).toBe(true);
    [page, own, modal].forEach(el => el.remove());
  });
});

describe('老师回复的提示', () => {
  it('上次打开以后老师回复了，球上出现提示；打开看过就清掉', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.setItem('hakcc.help.seen.course-1', new Date(Date.now() - 3600_000).toISOString());
    backend.history = [question({ status: 'teacher_answered', teacherAnswer: '看第 4 节。', teacherAnsweredAt: now() })];
    await mount('/workspace/course-1');
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    vi.useRealTimers();
    await waitFor(() => ball()!.getAttribute('aria-label')?.includes('老师回复了 1 条'), '未读提示');

    await openPanel();
    await click(document.querySelector('button[aria-label="收起使用帮助"]'));
    expect(ball()!.getAttribute('aria-label')).not.toContain('老师回复了');
    expect(Date.parse(localStorage.getItem('hakcc.help.seen.course-1')!)).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('只有一个求助入口', () => {
  it('发起求助只在使用帮助里，知识空间助手不再有「求助」页签', () => {
    const ROOT = resolve(__dirname, '..');
    const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
    const askers = files(ROOT)
      .filter(path => /support\.ask\(/.test(readFileSync(path, 'utf-8')))
      .map(path => relative(ROOT, path));
    expect(askers).toEqual(['help/HelpChat.tsx']);
    expect(readFileSync(join(ROOT, 'WorkspaceAgentPanel.tsx'), 'utf-8')).not.toMatch(/'support'/);
  });
});
