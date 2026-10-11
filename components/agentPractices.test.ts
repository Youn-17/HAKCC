// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** 讨论分析 → 指导策略（第五步）：候选带证据、采用 / 不用、在用的试用情况、编写指导策略、做得好的网页保存为模板 */

const api = vi.hoisted(() => ({
  get: vi.fn(),
  generate: vi.fn(async () => ({ created: 0, turns: 7, reason: 'not_enough' })),
  write: vi.fn(async () => ({ card: {} })),
  decide: vi.fn(async () => ({ ok: true })),
  saveTemplate: vi.fn(async () => ({ template: {} })),
  setTemplateStatus: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../services/apiClient', () => ({ agentPracticesApi: api, apiUrl: (p: string) => `https://api.test${p}` }));

import AgentPractices from './analytics/AgentPractices';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const view = {
  cards: [
    { id: 'c1', taskKind: 'make', practice: '先用选项卡给学生两三个具体方向，学生选了再动手', rationale: '「做东西」这类问题里，先用选项卡让学生定方向的回答 10 次里 8 次被接住（80%）……', evidence: { feature: 'asked_choice' }, origin: 'induced', status: 'candidate', baselineRate: null, decidedAt: null, retiredReason: null, createdAt: '2026-10-11T00:00:00Z' },
    { id: 'c2', taskKind: 'make', practice: '做自测题时最后一题留成开放题', rationale: null, evidence: {}, origin: 'teacher', status: 'active', baselineRate: 0.3, decidedAt: '2026-10-10T00:00:00Z', retiredReason: null, createdAt: '2026-10-10T00:00:00Z', trial: { uses: 6, rate: 0.5, verdict: 'trial' } },
    { id: 'c3', taskKind: 'ask', practice: '回答控制在 400 字以内', rationale: null, evidence: {}, origin: 'induced', status: 'retired', baselineRate: 0.5, decidedAt: null, retiredReason: '试用 20 次，接住率 40%，没比采用前（50%）高', createdAt: '2026-10-01T00:00:00Z' },
  ],
  stats: { turns: 42, windowDays: 28, minKindTurns: 20, byKind: { ask: { took: 10, total: 30, rate: 0.33 }, make: { took: 6, total: 12, rate: 0.5 }, plan: { took: 0, total: 0, rate: 0 }, ghostwrite: { took: 0, total: 0, rate: 0 }, polish: { took: 0, total: 0, rate: 0 } }, lastGeneratedAt: null },
  templates: { builtin: [{ slug: 'self_quiz', name: '自测题', whenToUse: '帮学生检查理解', usage: { made: 3, adopted: 1 } }], course: [] },
  goodPages: [{ artifactId: 'a1', title: '个性化对比表', brief: '三种看法并排', template: 'compare_table', createdAt: '2026-10-11T00:00:00Z', notes: 2, viewPath: '/artifacts/a1/view?sig=x', savedAsTemplate: false }],
};

let root: Root | null = null;
let host: HTMLDivElement;
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement;

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(React.createElement(AgentPractices, { spaceId: 's1', lang: 'zh' })); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  Object.values(api).forEach(fn => fn.mockClear());
  api.get.mockResolvedValue(view);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe('指导策略', () => {
  it('候选带证据、在用的写试用情况、撤回的写原因；各类接住率和网页模板用量', async () => {
    await mount();
    const text = host.textContent ?? '';
    expect(text).toContain('42 条回答');
    expect(text).toContain('提问讨论 33%（30）');
    expect(text).toContain('先用选项卡给学生两三个具体方向');
    expect(text).toContain('10 次里 8 次被接住');
    expect(text).toContain('试用中：已使用 6 次，满 20 次后比较数据');
    expect(text).toContain('采用前 30%');
    expect(text).toContain('已撤回或未采用（1）');
    expect(text).toContain('已生成 3 个网页，1 个已导入笔记');
    expect(host.querySelector('a[href="https://api.test/artifacts/a1/view?sig=x"]')).not.toBeNull();
  });

  it('采用、撤回、保存为模板都调接口；生成候选数据不够时说清楚', async () => {
    await mount();
    await act(async () => { button('采用').click(); });
    expect(api.decide).toHaveBeenCalledWith('s1', 'c1', 'active');
    await act(async () => { button('撤回').click(); });
    expect(api.decide).toHaveBeenCalledWith('s1', 'c2', 'retired');
    await act(async () => { button('保存为模板').click(); });
    expect(api.saveTemplate).toHaveBeenCalledWith('s1', 'a1');
    await act(async () => { button('生成候选').click(); });
    expect(host.textContent).toContain('数据不足：最近有 7 条回答');
  });

  it('编写指导策略：选任务类型、写一句、保存并启用', async () => {
    await mount();
    await act(async () => { button('编写指导策略').click(); });
    const select = host.querySelector('select') as HTMLSelectElement;
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      select.value = 'plan';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '规划写作时先问学生最想回应哪条笔记');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { button('保存并启用').click(); });
    expect(api.write).toHaveBeenCalledWith('s1', 'plan', '规划写作时先问学生最想回应哪条笔记');
  });
});
