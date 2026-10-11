import { describe, expect, it } from 'vitest';
import { modelDisplayName, modelSpeedHint } from './aiModelLabels';

/** 2026-10-11 补的 MiniMax、千问、APIKEY.FAN 型号：名字可读；速度提示只给当天用课程 key 实测过的 */
describe('新增的 MiniMax、千问型号', () => {
  it('显示名称', () => {
    expect(modelDisplayName('MiniMax-M2.7-highspeed', 'zh')).toBe('MiniMax M2.7 极速版');
    expect(modelDisplayName('MiniMax-M3.1-Flash-Preview', 'en')).toBe('MiniMax M3.1 Flash (preview)');
    expect(modelDisplayName('qwen-image-2.0-pro', 'zh')).toBe('千问图像 2.0 Pro');
    expect(modelDisplayName('qwen3.7-plus', 'zh')).toBe('Qwen 3.7 Plus');
  });

  it('MiniMax 对话按单次实测分快慢；生图照旧', () => {
    expect(modelSpeedHint('minimax', 'MiniMax-M3', 'zh')).toMatchObject({ tone: 'fast', text: '单次约 1.3 秒' });
    expect(modelSpeedHint('minimax', 'MiniMax-M2.5', 'zh')).toMatchObject({ tone: 'medium' });
    expect(modelSpeedHint('minimax', 'MiniMax-M2.7', 'zh')).toMatchObject({ tone: 'slow', text: '单次约 4.2 秒' });
    expect(modelSpeedHint('minimax', 'image-01', 'zh')).toMatchObject({ text: '约 35 秒一张' });
  });

  it('千问、APIKEY.FAN 两个分组按当天单次实测；千问图像 2.0 Pro 没测过不给提示', () => {
    expect(modelSpeedHint('alibaba', 'qwen3.8-flash', 'zh')).toMatchObject({ tone: 'medium', text: '单次约 2.2 秒' });
    expect(modelSpeedHint('alibaba', 'qwen3.7-plus', 'zh')?.detail).toContain('关思考');
    expect(modelSpeedHint('alibaba', 'qwen-image-2.0', 'zh')).toMatchObject({ tone: 'fast', text: '约 8 秒一张' });
    expect(modelSpeedHint('apikeyfan-grok', 'grok-4.20-0309-non-reasoning', 'zh')).toMatchObject({ tone: 'fast', text: '单次约 0.9 秒' });
    expect(modelSpeedHint('apikeyfan-grok', 'grok-4.6', 'zh')).toMatchObject({ tone: 'slow', text: '单次约 10.1 秒' });
    // multi-agent 走 Responses 接口（网关转换），同一天实测
    expect(modelSpeedHint('apikeyfan-grok', 'grok-4.20-multi-agent-0309', 'zh')).toMatchObject({ tone: 'medium', text: '单次约 3 秒' });
    expect(modelSpeedHint('apikeyfan-grok', 'grok-imagine-image', 'en')).toMatchObject({ text: 'about 6 s per image' });
    expect(modelSpeedHint('apikeyfan', 'gpt-6.1-sol', 'zh')).toMatchObject({ tone: 'medium', text: '单次约 2.9 秒' });
    expect(modelSpeedHint('apikeyfan', 'gpt-6-astra', 'zh')).toMatchObject({ tone: 'slow' });
    expect(modelSpeedHint('apikeyfan', 'gpt-image-2', 'zh')).toMatchObject({ tone: 'medium', text: '约 21 秒一张' });
    expect(modelSpeedHint('apikeyfan', 'gpt-7-preview', 'zh')).toBeNull();
    expect(modelSpeedHint('alibaba', 'qwen-image-2.0-pro', 'zh')).toBeNull();
  });
});
