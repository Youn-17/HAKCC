import { describe, expect, it, vi } from 'vitest';
import { providerConfigToApi, withDeepSeekOptions, withFastChatOptions } from './aiProviderConfig';

vi.mock('../config/supabase', () => ({
  supabase: {},
}));

describe('providerConfigToApi', () => {
  it('redacts custom endpoint URLs by default for member-visible config payloads', () => {
    const config = providerConfigToApi({
      id: 'config-1',
      course_id: 'course-1',
      provider_id: 'deepseek',
      api_key_encrypted: 'encrypted-key',
      endpoint_url: 'https://gateway.example.com/v1/chat/completions',
      enabled_models: ['deepseek-chat'],
      configured_at: '2026-06-05T00:00:00.000Z',
    });

    expect(config.endpointUrl).toBeNull();
    expect(config.apiKeyMasked).toBe('****');
    expect(config.enabledModels).toEqual(['deepseek-flash']);
  });

  it('returns endpoint URLs only when the caller explicitly requests them', () => {
    const config = providerConfigToApi({
      provider_id: 'dmxapi',
      api_key_encrypted: 'encrypted-key',
      endpoint_url: 'https://gateway.example.com/v1/chat/completions',
      enabled_models: ['deepseek-reasoner'],
    }, { includeEndpointUrl: true });

    expect(config.endpointUrl).toBe('https://gateway.example.com/v1/chat/completions');
    expect(config.enabledModels).toEqual(['deepseek-v4-pro']);
  });

  it('maps the retired flash names to deepseek-flash on the native key but keeps deepseek-v4-flash on DMX', () => {
    const native = providerConfigToApi({
      provider_id: 'deepseek',
      api_key_encrypted: 'encrypted-key',
      enabled_models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp', 'deepseek-chat', 'deepseek-reasoner'],
    });
    expect(native.enabledModels).toEqual(['deepseek-flash', 'deepseek-v4-pro']);

    const dmx = providerConfigToApi({
      provider_id: 'dmx',
      api_key_encrypted: 'encrypted-key',
      enabled_models: ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-chat'],
    });
    expect(dmx.enabledModels).toEqual(['deepseek-v4-flash']);
  });
});

describe('withDeepSeekOptions', () => {
  const history = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{}' },
    { role: 'assistant', content: 'plain reply' },
  ];

  it('adds an empty reasoning_content to assistant tool-call turns in thinking mode', () => {
    const body = withDeepSeekOptions('deepseek', 'deepseek-flash', { model: 'deepseek-flash', messages: history, max_tokens: 4096 }) as any;
    expect(body.messages[2].reasoning_content).toBe('');
    expect(body.messages[4].reasoning_content).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it('keeps a real reasoning_content when the caller already has one', () => {
    const withReasoning = [{ ...history[2], reasoning_content: 'thought' }];
    const body = withDeepSeekOptions('deepseek', 'deepseek-v4-pro', { model: 'deepseek-v4-pro', messages: withReasoning, max_tokens: 4096 }) as any;
    expect(body.messages[0].reasoning_content).toBe('thought');
    expect(body.thinking).toEqual({ type: 'enabled' });
  });

  it('disables thinking for small budgets and for fast options, leaving messages alone', () => {
    const small = withDeepSeekOptions('deepseek', 'deepseek-flash', { model: 'deepseek-flash', messages: history, max_tokens: 260 }) as any;
    expect(small.thinking).toEqual({ type: 'disabled' });
    expect(small.messages[2].reasoning_content).toBeUndefined();
    const fast = withFastChatOptions('deepseek', 'deepseek-v4-pro', { model: 'deepseek-v4-pro', messages: history, max_tokens: 4096 }) as any;
    expect(fast.thinking).toEqual({ type: 'disabled' });
    expect(fast.reasoning_effort).toBeUndefined();
  });

  it('leaves other providers untouched', () => {
    const body = withDeepSeekOptions('zhipu', 'glm-5.3', { model: 'glm-5.3', messages: history, max_tokens: 4096 }) as any;
    expect(body.messages[2].reasoning_content).toBeUndefined();
  });
});
