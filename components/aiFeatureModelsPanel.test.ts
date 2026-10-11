// @vitest-environment jsdom
/**
 * 课程 AI 设置里的「各功能用哪个 AI」。教师以前不知道 AI 反馈、生图这些功能各用哪个模型，
 * 这里挂真面板（只替换接口），确认：每个功能都列出来、写明谁会用到和现在用哪个（可读的名字，
 * 不是原始 id）、带速度提示；能逐项指定和改回自动；能限定学生可选的模型；失败时说出原因。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AiFeatureModelRow, AiFeatureModelsPayload } from '../services/apiClient';

const api = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { get: vi.fn(), update: vi.fn() };
});

vi.mock('../services/supabaseClient', () => ({ supabase: {} }));
vi.mock('../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/apiClient')>();
  return { ...actual, ai: { ...actual.ai, getFeatureModels: api.get, updateFeatureModels: api.update } };
});

import AiFeatureModelsPanel from './dashboard/AiFeatureModelsPanel';
import { ApiClientError } from '../services/apiClient';

const ref = (providerId: string, model: string) => ({ providerId, model });
const CHAT = [
  ref('deepseek', 'deepseek-flash'), ref('deepseek', 'deepseek-v4-pro'),
  ref('zhipu', 'glm-5.3'), ref('zhipu', 'glm-5.3-flash'),
  ref('dmx', 'glm-5.3'), ref('dmx', 'gpt-5.5'),
];
const IMAGE = [ref('minimax', 'image-01'), ref('minimax', 'image-01-live'), ref('dmx', 'qwen-image-plus'), ref('dmx', 'gpt-image-2')];

function row(partial: Partial<AiFeatureModelRow> & Pick<AiFeatureModelRow, 'id' | 'group'>): AiFeatureModelRow {
  return {
    who: 'student',
    kind: 'chat',
    selectable: true,
    failover: false,
    label: { zh: partial.id, en: partial.id },
    desc: { zh: '说明', en: 'desc' },
    fixedNote: null,
    saved: null,
    savedUnavailable: false,
    current: { ...ref('deepseek', 'deepseek-flash'), source: 'default' },
    fallbacks: [],
    options: CHAT,
    ...partial,
  };
}

function payload(over: Partial<AiFeatureModelsPayload> = {}): AiFeatureModelsPayload {
  return {
    features: [
      row({ id: 'note_partner', group: 'note', who: 'both', label: { zh: '笔记 AI 助手对话', en: 'Note AI partner chat' } }),
      row({
        id: 'note_feedback', group: 'note', failover: true,
        label: { zh: 'AI 反馈与支架建议', en: 'AI feedback' },
        fallbacks: [ref('zhipu', 'glm-5.3'), ref('dmx', 'glm-5.3-flash')],
      }),
      row({
        id: 'note_image', group: 'note', kind: 'image', failover: true,
        label: { zh: '生成图片', en: 'Images' },
        current: { ...ref('minimax', 'image-01'), source: 'default' },
        options: IMAGE,
      }),
      row({
        id: 'support', group: 'space', label: { zh: '求助（AI 先答）', en: 'Help' },
        saved: ref('moonshot', 'kimi-k2.6'), savedUnavailable: true,
      }),
      row({
        id: 'teacher_agents', group: 'teacher', who: 'teacher', label: { zh: '备课助手', en: 'Lesson prep' },
        saved: ref('zhipu', 'glm-5.3'), current: { ...ref('zhipu', 'glm-5.3'), source: 'teacher' },
      }),
      row({
        id: 'web_search', group: 'background', who: 'both', kind: 'search', selectable: false,
        label: { zh: '网页检索', en: 'Web search' },
        fixedNote: { zh: '只用 Tavily，这门课配了 Tavily 的 key 才开放。', en: 'Tavily only.' },
        current: { ...ref('tavily', 'tavily-search'), source: 'fixed' },
        options: [],
      }),
    ],
    options: { chat: CHAT, image: IMAGE },
    partnerModels: { allowed: null, defaultModel: ref('deepseek', 'deepseek-flash'), restricted: false },
    providers: ['deepseek', 'zhipu', 'dmx', 'minimax', 'tavily'],
    coolingProviders: [],
    providerConfigured: true,
    ...over,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(AiFeatureModelsPanel, { lang: 'zh', courseId: 'course-1' }));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return host;
}

const featureRow = (id: string) => host!.querySelector(`[data-feature="${id}"]`) as HTMLElement;
const selectIn = (id: string) => featureRow(id).querySelector('select') as HTMLSelectElement;

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

async function click(el: HTMLElement) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  api.get.mockReset();
  api.update.mockReset();
});

describe('各功能用哪个 AI', () => {
  it('按分组每个功能一行：名字、谁会用到；说明和出错时换哪家收在 ⓘ 里，点开才显示', async () => {
    api.get.mockResolvedValue(payload());
    const el = await mount();

    expect(api.get).toHaveBeenCalledWith('course-1');
    for (const title of ['学生写笔记时', '知识空间与讨论', '教师端', '检索与解析（自动，不用选）']) {
      expect(el.textContent).toContain(title);
    }
    const feedback = featureRow('note_feedback');
    expect(feedback.textContent).toContain('AI 反馈与支架建议');
    expect(feedback.textContent).not.toContain('出错时换');
    expect(feedback.textContent).not.toContain('deepseek-flash');
    await click(feedback.querySelector('button[aria-expanded]') as HTMLElement);
    expect(featureRow('note_feedback').textContent).toContain('出错时换：GLM-5.3 → GLM-5.3 Flash（DMX 聚合）');
    expect(featureRow('note_partner').textContent).toContain('学生和教师');
  });

  it('下拉框：「自动」那一项写明现在用哪个，按厂商分组，带速度提示；生图只列生图模型', async () => {
    api.get.mockResolvedValue(payload());
    await mount();

    const select = selectIn('note_feedback');
    expect(select.value).toBe('auto');
    expect(select.options[0].textContent).toBe('自动（现在是 DeepSeek Flash）');
    const groups = Array.from(select.querySelectorAll('optgroup')).map(g => g.label);
    expect(groups).toEqual(['DeepSeek', '智谱', 'DMX 聚合']);
    const texts = Array.from(select.options).map(o => o.textContent);
    expect(texts).toContain('DeepSeek Flash · 快，并发高');
    expect(texts).toContain('GPT-5.5 · 最慢');
    expect(selectIn('note_image').options[0].textContent).toBe('自动（现在是 MiniMax image-01）');

    const image = Array.from(selectIn('note_image').options).map(o => o.value);
    expect(image).toEqual(['auto', 'minimax::image-01', 'minimax::image-01-live', 'dmx::qwen-image-plus', 'dmx::gpt-image-2']);
    // 老师指定过的，「自动」不再写现在是哪个
    expect(selectIn('teacher_agents').options[0].textContent).toBe('自动');
    expect(selectIn('teacher_agents').value).toBe('zhipu::glm-5.3');
  });

  it('检索与解析这些不能选的折叠着；展开后不给下拉框，写明用什么', async () => {
    api.get.mockResolvedValue(payload());
    const el = await mount();
    expect(featureRow('web_search')).toBeNull();
    const toggle = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('检索与解析'))!;
    await click(toggle);
    expect(featureRow('web_search').querySelector('select')).toBeNull();
    expect(featureRow('web_search').textContent).toContain('只用 Tavily');
  });

  it('指定一个模型、再改回自动，都立刻保存并显示「已保存」', async () => {
    api.get.mockResolvedValue(payload());
    const updated = payload();
    updated.features[1] = { ...updated.features[1], saved: ref('zhipu', 'glm-5.3-flash'), current: { ...ref('zhipu', 'glm-5.3-flash'), source: 'teacher' } };
    api.update.mockResolvedValueOnce(updated).mockResolvedValueOnce(payload());
    const el = await mount();

    await choose(selectIn('note_feedback'), 'zhipu::glm-5.3-flash');
    expect(api.update).toHaveBeenLastCalledWith('course-1', { features: { note_feedback: { provider_id: 'zhipu', model: 'glm-5.3-flash' } } });
    expect(el.textContent).toContain('已保存');
    expect(selectIn('note_feedback').value).toBe('zhipu::glm-5.3-flash');

    await choose(selectIn('note_feedback'), 'auto');
    expect(api.update).toHaveBeenLastCalledWith('course-1', { features: { note_feedback: null } });
  });

  it('指定的模型用不了时说明原因，下拉框回到自动', async () => {
    api.get.mockResolvedValue(payload());
    await mount();
    expect(featureRow('support').textContent).toContain('指定的 Kimi K2.6 现在用不了');
    expect(selectIn('support').value).toBe('auto');
  });

  it('保存失败写明没保存和原因', async () => {
    api.get.mockResolvedValue(payload());
    api.update.mockRejectedValue(new ApiClientError(400, '这门课现在用不了 dmx · gpt-5.5'));
    const el = await mount();
    await choose(selectIn('note_partner'), 'dmx::gpt-5.5');
    expect(el.textContent).toContain('没有保存：这门课现在用不了 dmx · gpt-5.5');
    expect(el.textContent).not.toContain('已保存');
  });

  it('这门课没有服务商：提前说明，下拉框不可用', async () => {
    api.get.mockResolvedValue(payload({ providerConfigured: false }));
    const el = await mount();
    expect(el.textContent).toContain('这门课还没有配置 AI 服务商');
    expect(selectIn('note_feedback').disabled).toBe(true);
  });

  it('刚出过错的厂商会提示暂时排到后面', async () => {
    api.get.mockResolvedValue(payload({ coolingProviders: ['zhipu'] }));
    const el = await mount();
    expect(el.textContent).toContain('智谱 刚才连续出错');
  });

  it('读取失败说出来，不一直转圈', async () => {
    api.get.mockRejectedValue(new ApiClientError(403, 'Only the course instructor can perform this action'));
    const el = await mount();
    expect(el.textContent).toContain('没有加载成功：Only the course instructor can perform this action');
  });
});

describe('模型菜单名单：一张表，行是模型（按服务商分组），列是三个入口', () => {
  const policy = (over: Partial<{ allowed: typeof CHAT | null; restricted: boolean }> = {}) => ({
    allowed: null, defaultModel: ref('deepseek', 'deepseek-flash'), restricted: false, options: CHAT, ...over,
  });
  const headers = () => Array.from(host!.querySelectorAll('thead th')).map(th => th.textContent);
  const box = (label: string) => host!.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  const asRows = (list: typeof CHAT) => list.map(r => ({ provider_id: r.providerId, model: r.model }));

  it('三个入口三列；旧后端只给笔记 AI 助手那一份时只有那一列', async () => {
    const pickers = { note_partner: policy(), workspace_agent: policy(), personal_agent: policy() };
    api.get.mockResolvedValue(payload({ pickers }));
    await mount();
    expect(headers()).toEqual(['模型', '笔记 AI 助手', '知识空间智能体', '学生 AI 对话']);
    await act(async () => { root?.unmount(); });
    host?.remove();

    api.get.mockResolvedValue(payload());
    await mount();
    expect(headers()).toEqual(['模型', '笔记 AI 助手']);
  });

  it('不限时全部勾着；取消一个就只存剩下的（知识空间智能体存进 picker_models，不动笔记 AI 助手）', async () => {
    const pickers = { note_partner: policy(), workspace_agent: policy(), personal_agent: policy() };
    api.get.mockResolvedValue(payload({ pickers }));
    api.update.mockResolvedValue(payload({ pickers }));
    await mount();
    expect(box('知识空间智能体：GPT-5.5（DMX 聚合）').checked).toBe(true);
    await click(box('知识空间智能体：GPT-5.5（DMX 聚合）'));
    expect(api.update).toHaveBeenLastCalledWith('course-1', {
      picker_models: { workspace_agent: asRows(CHAT.filter(r => r.model !== 'gpt-5.5')) },
    });
  });

  it('点服务商那一行：一次取消这家的全部模型；部分勾着时点一下全勾上，全部勾上就存「不限」', async () => {
    api.get.mockResolvedValue(payload());
    api.update.mockResolvedValue(payload());
    await mount();
    await click(box('笔记 AI 助手：DMX 聚合的全部模型'));
    expect(api.update).toHaveBeenLastCalledWith('course-1', { partner_models: asRows(CHAT.filter(r => r.providerId !== 'dmx')) });
    await act(async () => { root?.unmount(); });
    host?.remove();

    const partial = CHAT.filter(r => !(r.providerId === 'zhipu' && r.model === 'glm-5.3'));
    api.get.mockResolvedValue(payload({ partnerModels: { allowed: partial, defaultModel: ref('deepseek', 'deepseek-flash'), restricted: true } }));
    await mount();
    const zhipu = box('笔记 AI 助手：智谱的全部模型');
    expect(zhipu.indeterminate).toBe(true);
    await click(zhipu);
    expect(api.update).toHaveBeenLastCalledWith('course-1', { partner_models: null });
  });

  it('只剩一个时不能再取消，提示至少留一个；标出哪个是默认', async () => {
    const onlyOne = payload({ partnerModels: { allowed: [ref('deepseek', 'deepseek-flash')], defaultModel: ref('deepseek', 'deepseek-flash'), restricted: true } });
    api.get.mockResolvedValue(onlyOne);
    const el = await mount();
    expect(box('笔记 AI 助手：DeepSeek Flash').checked).toBe(true);
    expect(box('笔记 AI 助手：GLM-5.3 Flash').checked).toBe(false);
    expect(el.querySelector('tbody')!.textContent).toContain('默认');
    await click(box('笔记 AI 助手：DeepSeek Flash'));
    expect(api.update).not.toHaveBeenCalled();
    expect(el.textContent).toContain('每个入口至少留一个模型');
  });
});
