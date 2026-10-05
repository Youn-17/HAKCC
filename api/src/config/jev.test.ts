import { describe, expect, it } from 'vitest';
import { JEV_DEFAULTS, readJevConfig } from './jev';

describe('readJevConfig', () => {
  it('没填 key：反馈判断和回答长度都关着，别的照默认', () => {
    const config = readJevConfig({});
    expect(config.apiKey).toBe('');
    expect(config.feedbackMode).toBe('off');
    expect(config.answerLength).toBe(false);
    expect(config.model).toBe('jev-1.13.0');
    expect(config.endpoint).toBe(JEV_DEFAULTS.endpoint);
  });

  it('只填 key：反馈先跑 shadow（只记录不决定），回答长度打开', () => {
    const config = readJevConfig({ JEV_API_KEY: '  k-123  ' });
    expect(config.apiKey).toBe('k-123');
    expect(config.feedbackMode).toBe('shadow');
    expect(config.answerLength).toBe(true);
  });

  it('模式写错了不会变成 gate：按默认 shadow', () => {
    expect(readJevConfig({ JEV_API_KEY: 'k', JEV_FEEDBACK_MODE: 'GATE' }).feedbackMode).toBe('gate');
    expect(readJevConfig({ JEV_API_KEY: 'k', JEV_FEEDBACK_MODE: 'on' }).feedbackMode).toBe('shadow');
    expect(readJevConfig({ JEV_API_KEY: 'k', JEV_FEEDBACK_MODE: 'off' }).feedbackMode).toBe('off');
  });

  it('有 mode 没 key：仍然是 off', () => {
    expect(readJevConfig({ JEV_FEEDBACK_MODE: 'gate' }).feedbackMode).toBe('off');
  });

  it('回答长度可以单独关', () => {
    expect(readJevConfig({ JEV_API_KEY: 'k', JEV_ANSWER_LENGTH: 'off' }).answerLength).toBe(false);
  });

  it('两个阈值：有问题 0.5，好想法更严 0.7', () => {
    const config = readJevConfig({ JEV_API_KEY: 'k' });
    expect(config.needThreshold).toBe(0.5);
    expect(config.promisingThreshold).toBe(0.7);
    expect(readJevConfig({ JEV_PROMISING_THRESHOLD: '0.8' }).promisingThreshold).toBe(0.8);
  });

  it('数字项：读不出来用默认，超出范围夹回去', () => {
    expect(readJevConfig({ JEV_NEED_THRESHOLD: 'abc' }).needThreshold).toBe(0.5);
    expect(readJevConfig({ JEV_NEED_THRESHOLD: '1.5' }).needThreshold).toBe(0.95);
    expect(readJevConfig({ JEV_NEED_THRESHOLD: '0.7' }).needThreshold).toBe(0.7);
    expect(readJevConfig({ JEV_TIMEOUT_MS: '' }).timeoutMs).toBe(4000);
    expect(readJevConfig({ JEV_TIMEOUT_MS: '10' }).timeoutMs).toBe(500);
  });
});
