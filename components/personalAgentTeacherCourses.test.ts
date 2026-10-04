// @vitest-environment jsdom
/**
 * 教师账号凭学生验证码入课、或受邀后还没被设为课程管理员，在那门课只是普通成员：
 * /personal-agent/stream 对备课 / 学情分析回 403。以前 /configs 把所有课一视同仁地列出来，
 * 页面默认选 courses[0]，只听课的那门排在前面时，教师第一句话就撞上 403。
 *
 * 挂真的 PersonalAgentPage（三个面板照挂），后端换成进程内的假服务，看默认选中哪门课、发出去的是什么。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.hoisted(() => {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'teacher-1', name: '测试教师', email: 'teacher@example.test', role: 'teacher' } }),
}));

import PersonalAgentPage from './PersonalAgentPage';

// ── 假后端 ──────────────────────────────────────────────────────

const LISTENS = { id: 'c-listen', title: '只听课的课', standing: 'member', teacherModes: false };
const TEACHES = { id: 'c-teach', title: '自己教的课', standing: 'owner', teacherModes: true };
const MANAGES = { id: 'c-manage', title: '当管理员的课', standing: 'manager', teacherModes: true };

interface Req { method: string; path: string; body: any }

function createBackend(courses: object[]) {
  const requests: Req[] = [];
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

  function stream(): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of [{ token: '好的。' }, { done: true, conversationId: 'conv-1' }]) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body });

    if (method === 'GET' && path === '/personal-agent/configs') {
      return json({
        courses,
        configs: courses.map((c: any) => ({ courseId: c.id, providerId: 'deepseek', isVerified: true, enabledModels: ['deepseek-flash'] })),
      });
    }
    if (method === 'POST' && path === '/personal-agent/stream') return stream();
    // 面板和历史列表的其余接口：各种列表都给空的
    return json({
      conversations: [], plans: [], profiles: [], memories: [], runs: [], items: [], trend: [], feedback: [],
      summary: {}, stats: {}, triggers: [], ok: true,
    });
  });

  return { requests, fetchStub, streamBodies: () => requests.filter(r => r.path === '/personal-agent/stream').map(r => r.body) };
}

// ── 挂载与操作 ──────────────────────────────────────────────────

let backend: ReturnType<typeof createBackend>;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

type PageProps = React.ComponentProps<typeof PersonalAgentPage>;
const CHAT: PageProps = { embedded: true, userRole: 'teacher', agentModule: 'chat', agentTitle: 'AI 对话' };
const LESSON: PageProps = { embedded: true, userRole: 'teacher', initialAgentMode: 'lesson_planner', agentModule: 'lesson', agentTitle: '备课助手' };
const ANALYTICS: PageProps = { embedded: true, userRole: 'teacher', initialAgentMode: 'teaching_analyst', agentModule: 'analytics', agentTitle: '学情分析' };

async function settle(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function waitFor<T>(probe: () => T | null | undefined | false, label: string, timeout = 3000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value as T;
    if (Date.now() - started > timeout) throw new Error(`等不到：${label}`);
    await settle(10);
  }
}

async function render(props: PageProps) {
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  // 同一个 root 再 render 一次，React 复用同一个实例。Dashboard 已按入口给 key、切换入口会重新挂载
  // （见 teacherAgentEntries.test.ts），这里测的是组件自己被复用时的兜底
  await act(async () => {
    root!.render(React.createElement(MemoryRouter, null, React.createElement(PersonalAgentPage, props)));
  });
}

async function mount(courses: object[], props: PageProps) {
  backend = createBackend(courses);
  vi.stubGlobal('fetch', backend.fetchStub);
  await render(props);
  await waitFor(() => !document.body.textContent?.includes('加载配置中'), '配置加载完');
}

const selects = () => Array.from(document.querySelectorAll('select'));
/** 设置抽屉里「课程上下文」那个下拉 */
const contextSelect = () => selects()[0];
const optionLabels = (select: HTMLSelectElement) => Array.from(select.options).map(o => o.textContent);
const hasText = (text: string) => document.body.textContent?.includes(text) ?? false;

async function choose(select: HTMLSelectElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function send(text: string) {
  const textarea = document.querySelector('textarea')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const before = backend.streamBodies().length;
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[title="发送"]')!.click();
  });
  await waitFor(() => backend.streamBodies().length > before, '发出的消息');
  await waitFor(() => !document.querySelector('textarea')?.disabled, '回复结束');
  return backend.streamBodies().at(-1);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('hakcc-language', 'zh');
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

// ── AI 对话：默认备课模式，任何课都能聊 ──────────────────────────

describe('教师端 AI 对话', () => {
  it('只听课的那门排在最前：默认选有教职的课，第一句话按备课模式发到这门课', async () => {
    await mount([LISTENS, TEACHES], CHAT);

    expect(contextSelect().value).toBe('c-teach');
    expect(optionLabels(contextSelect())).toEqual(['不关联课程', '只听课的课（普通成员）', '自己教的课']);
    expect(hasText('你在这门课是普通成员')).toBe(false);

    expect(await send('帮我设计一节课')).toMatchObject({
      agent_mode: 'lesson_planner', course_id: 'c-teach', context_course_id: 'c-teach', module: 'chat',
    });
  });

  it('换到只听课的课：页面说清楚，消息按想法发展发，不撞 403', async () => {
    await mount([LISTENS, TEACHES], CHAT);
    await choose(contextSelect(), 'c-listen');

    expect(hasText('你在这门课是普通成员。备课和学情分析只对课程创建者和课程管理员开放')).toBe(true);
    expect(await send('这门课讲到哪了')).toMatchObject({
      agent_mode: 'idea_coach', course_id: 'c-listen', context_course_id: 'c-listen',
    });
  });

  it('不关联课程：API key 落在有教职的课，不带笔记上下文，不交给后端随便挑', async () => {
    await mount([LISTENS, TEACHES], CHAT);
    await choose(contextSelect(), '');

    const body = await send('知识建构有哪些原则');
    expect(body).toMatchObject({ agent_mode: 'lesson_planner', course_id: 'c-teach' });
    expect(body).not.toHaveProperty('context_course_id');
  });

  it('一门有教职的课都没有：照样能聊，按想法发展发，并说明原因', async () => {
    await mount([LISTENS], CHAT);

    expect(contextSelect().value).toBe('c-listen');
    expect(hasText('你在这门课是普通成员')).toBe(true);
    expect(await send('你好')).toMatchObject({ agent_mode: 'idea_coach', course_id: 'c-listen' });
  });
});

// ── 固定是教师模式的入口 ──────────────────────────────────────────

describe('备课助手 / 学情分析', () => {
  it('备课助手的课程下拉只有有教职的课，默认第一门', async () => {
    await mount([LISTENS, TEACHES, MANAGES], LESSON);

    const lessonSelect = await waitFor(() => selects().find(s => optionLabels(s)[0] === '选择课程' && s !== contextSelect()), '备课面板的课程下拉');
    expect(optionLabels(lessonSelect)).toEqual(['选择课程', '自己教的课', '当管理员的课']);
    expect(lessonSelect.value).toBe('c-teach');
    expect(optionLabels(contextSelect())).toEqual(['选择课程', '自己教的课', '当管理员的课']);
  });

  it('一门有教职的课都没有：不摆面板、不给输入框，说明为什么、找谁', async () => {
    await mount([LISTENS], ANALYTICS);

    expect(hasText('学情分析只对课程创建者和课程管理员开放')).toBe(true);
    expect(hasText('你在加入的这门课里是普通成员')).toBe(true);
    expect(hasText('协作与权限')).toBe(true);
    expect(document.querySelector('textarea')).toBeNull();
    // 学情面板没挂上，也就没有拿只听课的课去查学情数据
    expect(backend.requests.filter(r => r.path.includes('c-listen'))).toEqual([]);
  });

  it('学情分析有可用的课：面板照常挂，只拿有教职的课查数据', async () => {
    await mount([LISTENS, MANAGES], ANALYTICS);
    await waitFor(() => backend.requests.some(r => r.path.includes('c-manage')), '学情面板查数据');

    expect(hasText('只对课程创建者和课程管理员开放')).toBe(false);
    expect(backend.requests.filter(r => r.path.includes('c-listen'))).toEqual([]);
    expect(await send('哪些学生需要关注')).toMatchObject({ agent_mode: 'teaching_analyst', course_id: 'c-manage' });
  });
});

// ── 同一个实例换入口（组件自己的兜底） ─────────────────────────────

describe('从 AI 对话切到备课助手', () => {
  it('在 AI 对话里选的只听课的课，不会带进备课助手', async () => {
    await mount([LISTENS, TEACHES], CHAT);
    await choose(contextSelect(), 'c-listen');

    await render(LESSON);
    await settle();

    const lessonSelect = await waitFor(() => selects().find(s => s !== contextSelect() && optionLabels(s)[0] === '选择课程'), '备课面板的课程下拉');
    expect(lessonSelect.value).toBe('c-teach');
    expect(contextSelect().value).toBe('c-teach');
    expect(hasText('你在这门课是普通成员')).toBe(false);
  });
});
