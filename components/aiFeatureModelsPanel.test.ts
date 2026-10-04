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
  it('按分组列出每个功能：谁会用到、现在用哪个（可读名字）、速度提示、出错时换哪家', async () => {
    api.get.mockResolvedValue(payload());
    const el = await mount();

    expect(api.get).toHaveBeenCalledWith('course-1');
    for (const title of ['学生写笔记时', '知识空间与讨论', '教师端', '检索与解析（不在这里选模型）']) {
      expect(el.textContent).toContain(title);
    }

    const feedback = featureRow('note_feedback');
    expect(feedback.textContent).toContain('AI 反馈与支架建议');
    expect(feedback.querySelector('[data-current-model]')?.textContent).toBe('DeepSeek Flash');
    expect(feedback.textContent).toContain('快，并发高');
    expect(feedback.textContent).toContain('自动');
    expect(feedback.textContent).toContain('出错时换：GLM-5.3 → GLM-5.3 Flash（DMX 聚合）');
    expect(feedback.textContent).not.toContain('deepseek-flash');

    expect(featureRow('note_partner').textContent).toContain('学生和教师');
    expect(featureRow('teacher_agents').textContent).toContain('已指定');
    expect(featureRow('note_image').querySelector('[data-current-model]')?.textContent).toBe('MiniMax image-01');
    expect(featureRow('note_image').textContent).toContain('约 35 秒一张');
  });

  it('下拉框：「自动」在前（悬停看到现在是哪个），按厂商分组，带速度提示；生图只列生图模型', async () => {
    api.get.mockResolvedValue(payload());
    await mount();

    const select = selectIn('note_feedback');
    expect(select.value).toBe('auto');
    expect(select.options[0].textContent).toBe('自动');
    expect(select.title).toBe('自动（现在是 DeepSeek Flash）');
    const groups = Array.from(select.querySelectorAll('optgroup')).map(g => g.label);
    expect(groups).toEqual(['DeepSeek', '智谱', 'DMX 聚合']);
    const texts = Array.from(select.options).map(o => o.textContent);
    expect(texts).toContain('DeepSeek Flash · 快，并发高');
    expect(texts).toContain('GPT-5.5 · 最慢');

    const image = Array.from(selectIn('note_image').options).map(o => o.value);
    expect(image).toEqual(['auto', 'minimax::image-01', 'minimax::image-01-live', 'dmx::qwen-image-plus', 'dmx::gpt-image-2']);
  });

  it('不能在这里选的功能不给下拉框，写明用什么', async () => {
    api.get.mockResolvedValue(payload());
    await mount();
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
    expect(featureRow('note_feedback').querySelector('[data-current-model]')?.textContent).toBe('GLM-5.3 Flash');
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

describe('各入口的模型菜单：知识空间助手、学生首页 AI 对话各有一份名单', () => {
  const policy = (over: Partial<{ allowed: typeof CHAT | null; restricted: boolean }> = {}) => ({
    allowed: null, defaultModel: ref('deepseek', 'deepseek-flash'), restricted: false, options: CHAT, ...over,
  });
  const sectionOf = (title: string) => Array.from(host!.querySelectorAll('h4'))
    .find(h => h.textContent === title)!.parentElement!.parentElement!;
  const radioIn = (section: HTMLElement, text: string) => Array.from(section.querySelectorAll('label'))
    .find(l => l.textContent?.includes(text))!.querySelector('input') as HTMLInputElement;

  it('三个入口各一块；知识空间助手改成「只显示勾选的」存进 picker_models，不动笔记 AI 助手那份', async () => {
    const pickers = { note_partner: policy(), workspace_agent: policy(), personal_agent: policy() };
    api.get.mockResolvedValue(payload({ pickers }));
    api.update.mockResolvedValue(payload({ pickers: { ...pickers, workspace_agent: policy({ allowed: CHAT, restricted: true }) } }));
    await mount();

    expect(Array.from(host!.querySelectorAll('h4')).map(h => h.textContent))
      .toEqual(expect.arrayContaining(['笔记 AI 助手', '知识空间助手', '学生首页的「AI 对话」']));
    await click(radioIn(sectionOf('知识空间助手'), '只显示勾选的'));
    expect(api.update).toHaveBeenLastCalledWith('course-1', {
      picker_models: { workspace_agent: CHAT.map(r => ({ provider_id: r.providerId, model: r.model })) },
    });
  });

  it('旧后端只给笔记 AI 助手那一份时，只显示那一块', async () => {
    api.get.mockResolvedValue(payload());
    await mount();
    const titles = Array.from(host!.querySelectorAll('h4')).map(h => h.textContent);
    expect(titles).toContain('笔记 AI 助手');
    expect(titles).not.toContain('知识空间助手');
  });
});

describe('笔记 AI 助手的菜单名单', () => {
  const partnerSection = () => Array.from(host!.querySelectorAll('h4'))
    .find(h => h.textContent === '笔记 AI 助手')!.parentElement!.parentElement!;
  const radio = (text: string) => Array.from(partnerSection().querySelectorAll('label'))
    .find(l => l.textContent?.includes(text))!.querySelector('input') as HTMLInputElement;
  const box = (name: string) => Array.from(partnerSection().querySelectorAll('label'))
    .find(l => l.textContent?.startsWith(name))!.querySelector('input') as HTMLInputElement;

  it('不限时全部可选、勾选框不可点；标出哪个是默认', async () => {
    api.get.mockResolvedValue(payload());
    await mount();
    expect(radio('全部显示').checked).toBe(true);
    expect(box('DeepSeek Flash').disabled).toBe(true);
    expect(partnerSection().textContent).toContain('DeepSeek · 默认');
  });

  it('改成「只提供勾选的」先把全部勾上存下；取消一个就存剩下的', async () => {
    api.get.mockResolvedValue(payload());
    const restricted = payload({ partnerModels: { allowed: CHAT, defaultModel: ref('deepseek', 'deepseek-flash'), restricted: true } });
    api.update.mockResolvedValue(restricted);
    await mount();

    await click(radio('只显示勾选的'));
    expect(api.update).toHaveBeenLastCalledWith('course-1', {
      partner_models: CHAT.map(r => ({ provider_id: r.providerId, model: r.model })),
    });

    await click(box('GPT-5.5（DMX 聚合）'));
    expect(api.update).toHaveBeenLastCalledWith('course-1', {
      partner_models: CHAT.filter(r => r.model !== 'gpt-5.5').map(r => ({ provider_id: r.providerId, model: r.model })),
    });
  });

  it('只剩一个时不能再取消；改回不限就存 null', async () => {
    const onlyOne = payload({ partnerModels: { allowed: [ref('deepseek', 'deepseek-flash')], defaultModel: ref('deepseek', 'deepseek-flash'), restricted: true } });
    api.get.mockResolvedValue(onlyOne);
    api.update.mockResolvedValue(payload());
    await mount();

    expect(box('DeepSeek Flash').checked).toBe(true);
    expect(box('DeepSeek Flash').disabled).toBe(true);
    expect(box('GLM-5.3 Flash').checked).toBe(false);

    await click(radio('全部显示'));
    expect(api.update).toHaveBeenLastCalledWith('course-1', { partner_models: null });
  });
});
