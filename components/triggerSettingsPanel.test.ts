// @vitest-environment jsdom
/**
 * 触发设置保存失败以前被 `catch {}` 吞掉，界面还照样闪一下「已保存」。
 * 最常见的失败是这门课还没配 AI 服务商（后端 404）：设置存在服务商配置行上，
 * 一行都没有就无处可存。这里挂真面板，确认失败说出来、没配服务商时提前说明，
 * 以及已撤掉的「响应风格」「AI 角色设定」不再出现。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return { get: vi.fn(), update: vi.fn() };
});

vi.mock('../services/supabaseClient', () => ({ supabase: {} }));
vi.mock('../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/apiClient')>();
  return { ...actual, ai: { ...actual.ai, getTriggerSettings: api.get, updateTriggerSettings: api.update } };
});

import { TriggerSettingsPanel } from './Dashboard';
import { ApiClientError } from '../services/apiClient';

const SETTINGS = {
  enabled_triggers: ['no_evidence'], cooldown_seconds: 120, auto_feedback_enabled: true,
  custom_context: '', sensitivity: 'balanced', response_language: 'auto', max_feedback_length: 300,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(TriggerSettingsPanel, { lang: 'zh', courseId: 'course-1' }));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return host;
}

async function clickButton(text: string) {
  const btn = Array.from(host!.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
  await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
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

describe('AI 触发设置面板', () => {
  it('没配服务商：一打开就说明，保存失败时写明没保存和原因', async () => {
    api.get.mockResolvedValue({ settings: SETTINGS, providerConfigured: false });
    api.update.mockRejectedValue(new ApiClientError(404, 'No AI config found for this course — configure a provider first'));
    const el = await mount();

    expect(el.textContent).toContain('这门课还没有配置 AI 服务商');
    await clickButton('English');
    expect(el.textContent).toContain('没有保存：这门课还没有配置 AI 服务商');
    expect(el.textContent).not.toContain('已保存');
  });

  it('其他错误照原文显示', async () => {
    api.get.mockResolvedValue({ settings: SETTINGS, providerConfigured: true });
    api.update.mockRejectedValue(new ApiClientError(500, 'database unavailable'));
    const el = await mount();

    expect(el.textContent).not.toContain('这门课还没有配置 AI 服务商');
    await clickButton('English');
    expect(el.textContent).toContain('没有保存：database unavailable');
  });

  it('保存成功才显示「已保存」', async () => {
    api.get.mockResolvedValue({ settings: SETTINGS, providerConfigured: true });
    api.update.mockResolvedValue({ settings: { ...SETTINGS, response_language: 'en' } });
    const el = await mount();

    await clickButton('English');
    expect(api.update).toHaveBeenCalledWith('course-1', { response_language: 'en' });
    expect(el.textContent).toContain('已保存');
  });

  it('读取失败不再一直转圈', async () => {
    api.get.mockRejectedValue(new ApiClientError(500, 'boom'));
    const el = await mount();
    expect(el.textContent).toContain('触发设置没有加载成功：boom');
  });

  it('反馈代码不读的两项已从界面撤掉', async () => {
    api.get.mockResolvedValue({ settings: SETTINGS, providerConfigured: true });
    const el = await mount();
    expect(el.textContent).not.toContain('响应风格');
    expect(el.textContent).not.toContain('AI 角色设定');
    expect(el.textContent).toContain('AI 响应语言');
  });
});
