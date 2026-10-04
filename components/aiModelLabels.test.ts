import { describe, expect, it } from 'vitest';
import { modelDisplayName, modelOptionLabel, modelSpeedHint, providerDisplayName } from './aiModelLabels';

describe('模型在界面上的名字', () => {
  it('认得的给可读名字，旧别名按现在的叫法', () => {
    expect(modelDisplayName('deepseek-flash')).toBe('DeepSeek Flash');
    expect(modelDisplayName('deepseek-chat')).toBe('DeepSeek Flash');
    expect(modelDisplayName('glm-5.3-flash')).toBe('GLM-5.3 Flash');
    expect(modelDisplayName('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
    expect(modelDisplayName('kimi-k2.7-code-highspeed', 'en')).toBe('Kimi K2.7 Code Highspeed');
  });

  it('认不得的（教师手填的）原样显示，下拉框里补上厂商', () => {
    expect(modelDisplayName('glm-4-plus')).toBe('glm-4-plus');
    expect(modelOptionLabel('zhipu', 'glm-4-plus')).toBe('智谱 · glm-4-plus');
  });

  it('同一个模型走聚合商时标出来，走原厂时不重复厂商名', () => {
    expect(modelOptionLabel('zhipu', 'glm-5.3')).toBe('GLM-5.3');
    expect(modelOptionLabel('dmx', 'glm-5.3')).toBe('GLM-5.3（DMX 聚合）');
    expect(providerDisplayName('moonshot')).toBe('Kimi');
  });
});

describe('速度提示只写实测过的', () => {
  it('DeepSeek Flash 快、并发高；V4 Pro 慢；DMX 最慢；智谱标出 6 路上限', () => {
    expect(modelSpeedHint('deepseek', 'deepseek-flash')).toMatchObject({ tone: 'fast', text: '快，并发高' });
    expect(modelSpeedHint('deepseek', 'deepseek-v4-pro')?.tone).toBe('slow');
    expect(modelSpeedHint('dmx', 'deepseek-v4-flash')).toMatchObject({ tone: 'slow', text: '最慢' });
    expect(modelSpeedHint('zhipu', 'glm-5.3')?.text).toContain('6 路');
  });

  it('生图按实测秒数', () => {
    expect(modelSpeedHint('minimax', 'image-01')?.text).toBe('约 35 秒一张');
    expect(modelSpeedHint('dmx', 'qwen-image-plus')?.tone).toBe('fast');
  });

  it('没测过的不猜', () => {
    expect(modelSpeedHint('openai', 'gpt-5.5')).toBeNull();
    expect(modelSpeedHint('minimax', 'MiniMax-M2.7')).toBeNull();
    expect(modelSpeedHint('alibaba', 'qwen3.8-max')).toBeNull();
  });
});
