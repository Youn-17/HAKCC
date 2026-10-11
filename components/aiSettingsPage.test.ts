// @vitest-environment jsdom
/**
 * 教师端「AI 设置」页（2026-10-11 用户：太长太复杂；切换课程后下面的都要跟着变）。
 * 挂真组件、只替换接口，确认：课程只在顶上选一次，三个页签都按它取数据；
 * 服务商一行一家、没配的缩成一排按钮；选模型是清楚的勾选框（默认全勾、可全选全不选）；
 * 改勾选不用重输 Key；移除在行内确认。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return {
    listConfigs: vi.fn(), saveConfig: vi.fn(), deleteConfig: vi.fn(), updateConfigModels: vi.fn(),
    getFeatureModels: vi.fn(), updateFeatureModels: vi.fn(), getTriggerSettings: vi.fn(), updateTriggerSettings: vi.fn(),
    catalog: vi.fn(),
  };
});

vi.mock('../services/supabaseClient', () => ({ supabase: {} }));
vi.mock('../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/apiClient')>();
  return {
    ...actual,
    ai: {
      ...actual.ai,
      listConfigs: api.listConfigs, saveConfig: api.saveConfig, deleteConfig: api.deleteConfig, updateConfigModels: api.updateConfigModels,
      getFeatureModels: api.getFeatureModels, updateFeatureModels: api.updateFeatureModels,
      getTriggerSettings: api.getTriggerSettings, updateTriggerSettings: api.updateTriggerSettings,
    },
    aiModels: { ...actual.aiModels, catalog: api.catalog },
  };
});

import AiSettingsPage from './dashboard/aiSettings/AiSettingsPage';

const COURSES = [
  { id: 'c1', title: '探索人工智能' },
  { id: 'c2', title: '知识建构' },
] as never;

const config = (providerId: string, enabledModels: string[], over: Record<string, unknown> = {}) => ({
  id: `cfg-${providerId}`, courseId: 'c1', providerId, isVerified: true, enabledModels, endpointUrl: null,
  configuredAt: '2026-10-01T00:00:00Z', apiKeyMasked: 'sk-…a1b2', ...over,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(React.createElement(AiSettingsPage, { lang: 'zh', courses: COURSES })); });
  await flush();
  return host;
}
const button = (text: string) => Array.from(host!.querySelectorAll('button')).find(b => b.textContent?.trim() === text) as HTMLButtonElement;
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const tab = (text: string) => Array.from(host!.querySelectorAll('[role="tab"]')).find(t => t.textContent === text)!;

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
  api.catalog.mockResolvedValue({
    dmx: { text: [{ id: 'glm-5.3', label: 'GLM-5.3' }, { id: 'gpt-5.5', label: 'GPT-5.5' }], vision: [], image: [], defaults: [] },
    native: {
      deepseek: [{ id: 'deepseek-flash', label: 'DeepSeek Flash' }, { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }],
      alibaba: [{ id: 'qwen3.8-max', label: 'Qwen 3.8 Max' }, { id: 'qwen3.8-flash', label: 'Qwen 3.8 Flash' }],
    },
    nativeImage: { alibaba: [{ id: 'qwen-image-2.0', label: '千问图像 2.0' }, { id: 'qwen-image-2.0-pro', label: '千问图像 2.0 Pro' }] },
    tiers: {},
  });
  api.listConfigs.mockResolvedValue({ configs: [config('dmx', ['glm-5.3', 'gpt-5.5'])], partnerModels: null });
  api.getFeatureModels.mockResolvedValue({ features: [], options: { chat: [], image: [] }, partnerModels: { allowed: null, defaultModel: null, restricted: false }, providers: [], coolingProviders: [], providerConfigured: true });
  api.getTriggerSettings.mockResolvedValue({
    settings: { enabled_triggers: ['no_evidence'], cooldown_seconds: 120, auto_feedback_enabled: true, custom_context: '', sensitivity: 'balanced', response_language: 'auto', max_feedback_length: 300 },
    providerConfigured: true,
  });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('课程只在顶上选一次，三个页签都跟着它', () => {
  it('换课程：当前页签马上按新课程取；换到别的页签也是新课程；下次打开还记得', async () => {
    const el = await mount();
    expect(api.listConfigs).toHaveBeenLastCalledWith('c1');
    expect(el.querySelectorAll('select')).toHaveLength(1);

    const select = el.querySelector('select[aria-label="课程"]') as HTMLSelectElement;
    await act(async () => { select.value = 'c2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(api.listConfigs).toHaveBeenLastCalledWith('c2');

    await click(tab('自动反馈'));
    expect(api.getTriggerSettings).toHaveBeenLastCalledWith('c2');
    await click(tab('各功能用哪个 AI'));
    expect(api.getFeatureModels).toHaveBeenLastCalledWith('c2');

    await act(async () => { root?.unmount(); });
    host?.remove();
    await mount();
    expect(api.getFeatureModels).toHaveBeenLastCalledWith('c2');
    expect((host!.querySelector('select[aria-label="课程"]') as HTMLSelectElement).value).toBe('c2');
  });
});

describe('服务商与密钥', () => {
  it('已配置的一行一家，没配的缩成一排按钮', async () => {
    const el = await mount();
    const row = el.querySelector('[data-provider="dmx"]')!;
    expect(row.textContent).toContain('DMXAPI 聚合');
    expect(row.textContent).toContain('启用 2 个模型');
    expect(row.textContent).toContain('sk-…a1b2');
    expect(button('DeepSeek')).toBeTruthy();
    expect(el.querySelectorAll('[data-provider]')).toHaveLength(1);
  });

  it('添加：模型默认全勾；全不选时保存不了；勾一个、填 Key 后保存，提示验证结果', async () => {
    api.saveConfig.mockResolvedValue({ config: config('deepseek', ['deepseek-flash']), verified: true });
    const el = await mount();
    await click(button('DeepSeek'));
    const dialog = el.querySelector('[role="dialog"]')!;
    const boxes = () => Array.from(dialog.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes().map(b => b.checked)).toEqual([true, true]);

    await click(button('全不选'));
    expect(boxes().every(b => !b.checked)).toBe(true);
    expect(dialog.textContent).toContain('至少勾一个模型');
    await type(dialog.querySelector('input[type="password"]') as HTMLInputElement, 'sk-test');
    expect(button('验证并保存').disabled).toBe(true);

    await click(boxes()[0]);
    expect(button('验证并保存').disabled).toBe(false);
    await click(button('验证并保存'));
    expect(api.saveConfig).toHaveBeenCalledWith('c1', { provider_id: 'deepseek', api_key: 'sk-test', endpoint_url: undefined, enabled_models: ['deepseek-flash'] });
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.textContent).toContain('已保存，Key 验证通过');
    expect(el.querySelector('[data-provider="deepseek"]')).toBeTruthy();
  });

  it('添加通义千问：列出对话模型，另外写明能画图的型号（千问图像 2.0 / 2.0 Pro）', async () => {
    const el = await mount();
    await click(button('通义千问'));
    const dialog = el.querySelector('[role="dialog"]')!;
    const labels = Array.from(dialog.querySelectorAll('label')).map(l => l.textContent ?? '');
    expect(labels.some(t => t.includes('Qwen 3.8 Max'))).toBe(true);
    expect(labels.some(t => t.includes('千问图像'))).toBe(false);
    const images = dialog.querySelector('[data-image-models]')!;
    expect(images.textContent).toContain('能画图 · 2');
    expect(images.textContent).toContain('千问图像 2.0、千问图像 2.0 Pro');
  });

  it('添加 APIKEY.FAN · GPT：写明 Key 要建在哪个分组；对话模型默认全勾，生图型号另外写明，保存时带上对话模型', async () => {
    api.saveConfig.mockResolvedValue({ config: config('apikeyfan', ['gpt-6.1-sol', 'gpt-5.5']), verified: true });
    const el = await mount();
    await click(button('APIKEY.FAN · GPT'));
    const dialog = el.querySelector('[role="dialog"]')!;
    const hint = dialog.querySelector('[data-setup-hint]')!.textContent ?? '';
    expect(hint).toContain('Codex Pro（外接版）');
    expect(hint).toContain('slb.apikey.fan');
    expect(dialog.textContent).toContain('启用的模型 · 6/6');
    const labels = Array.from(dialog.querySelectorAll('label')).map(l => l.textContent ?? '');
    expect(labels.some(t => t.includes('GPT-6.1 Sol'))).toBe(true);
    expect(labels.some(t => t.includes('GPT Image'))).toBe(false);
    expect(dialog.querySelector('[data-image-models]')!.textContent).toContain('GPT Image 2.5 Sunburst');
    await type(dialog.querySelector('input[type="password"]') as HTMLInputElement, 'sk-fan');
    await click(button('验证并保存'));
    expect(api.saveConfig).toHaveBeenCalledWith('c1', {
      provider_id: 'apikeyfan', api_key: 'sk-fan', endpoint_url: undefined,
      enabled_models: ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-6-astra'],
    });
    expect(el.querySelector('[data-provider="apikeyfan"]')!.textContent).toContain('能画图');
  });

  it('管理早先只画图时配的 APIKEY.FAN · Grok：存下的生图型号不当成对话模型列出来', async () => {
    api.listConfigs.mockResolvedValue({ configs: [config('apikeyfan-grok', ['grok-imagine-image', 'grok-imagine-image-quality'])], partnerModels: null });
    const el = await mount();
    await click(button('管理'));
    const dialog = el.querySelector('[role="dialog"]')!;
    const labels = Array.from(dialog.querySelectorAll('label')).map(l => l.textContent ?? '');
    expect(labels.some(t => t.includes('Grok 4.6'))).toBe(true);
    expect(labels.some(t => t.includes('Grok Imagine'))).toBe(false);
    expect(dialog.querySelector('[data-image-models]')!.textContent).toContain('Grok Imagine Image');
  });

  it('管理已配置的：带出原来勾的模型；不填 Key 只改勾选（不用重输 Key）', async () => {
    api.updateConfigModels.mockResolvedValue({ config: config('dmx', ['glm-5.3']) });
    const el = await mount();
    await click(button('管理'));
    const dialog = el.querySelector('[role="dialog"]')!;
    const gpt = Array.from(dialog.querySelectorAll('label')).find(l => l.textContent?.includes('GPT-5.5'))!.querySelector('input') as HTMLInputElement;
    expect(gpt.checked).toBe(true);
    await click(gpt);
    await click(button('保存勾选'));
    expect(api.updateConfigModels).toHaveBeenCalledWith('c1', 'dmx', ['glm-5.3']);
    expect(api.saveConfig).not.toHaveBeenCalled();
    expect(el.textContent).toContain('已保存启用的模型');
    expect(el.querySelector('[data-provider="dmx"]')!.textContent).toContain('启用 1 个模型');
  });

  it('移除在行内确认，确认后才删', async () => {
    api.deleteConfig.mockResolvedValue({ message: 'ok' });
    const el = await mount();
    await click(el.querySelector('button[aria-label="移除 DMXAPI 聚合"]')!);
    expect(api.deleteConfig).not.toHaveBeenCalled();
    expect(el.textContent).toContain('确定移除？');
    await click(button('移除'));
    expect(api.deleteConfig).toHaveBeenCalledWith('c1', 'dmx');
    expect(el.querySelector('[data-provider="dmx"]')).toBeNull();
  });
});
