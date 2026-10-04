import { describe, expect, it } from 'vitest';
import {
  buildPartnerModelOptions,
  getPartnerAgentModes,
  inferPartnerConfigsFromMessages,
  mergePartnerConfigs,
  normalizePartnerAgentMode,
  resolveConcretePartnerModelSelection,
  resolvePartnerModelSelection,
  shouldUseWebSearchForAgent,
  type PartnerAiConfig,
} from './noteAiPartnerModel';

const defaultModels = {
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  dmxapi: ['deepseek-v4-flash', 'gpt-5-mini'],
  moonshot: ['moonshot-v1-8k'],
};

describe('buildPartnerModelOptions', () => {
  it('flattens verified provider configs into a single model picker', () => {
    const configs: PartnerAiConfig[] = [
      { providerId: 'deepseek', enabledModels: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
      { providerId: 'dmxapi', enabledModels: ['deepseek-v4-flash'] },
      { providerId: 'moonshot', enabledModels: ['moonshot-v1-8k'] },
    ];

    // 下拉框里显示可读的名字，不再是「deepseek · deepseek-v4-flash」这样的原始 id；
    // 经聚合商转发的补上厂商，认不得的模型保留 id
    expect(buildPartnerModelOptions(configs, defaultModels)).toEqual([
      { providerId: 'deepseek', model: 'deepseek-v4-flash', value: 'deepseek::deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { providerId: 'deepseek', model: 'deepseek-v4-pro', value: 'deepseek::deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { providerId: 'dmxapi', model: 'deepseek-v4-flash', value: 'dmxapi::deepseek-v4-flash', label: 'DeepSeek V4 Flash（DMX 聚合）' },
      { providerId: 'moonshot', model: 'moonshot-v1-8k', value: 'moonshot::moonshot-v1-8k', label: 'Kimi · moonshot-v1-8k' },
    ]);
  });

  it('does not show non-chat tool providers in the model picker', () => {
    const configs: PartnerAiConfig[] = [
      { providerId: 'tavily', enabledModels: ['tavily-search'] },
      { providerId: 'deepseek', enabledModels: ['deepseek-v4-flash'] },
    ];

    expect(buildPartnerModelOptions(configs, defaultModels)).toEqual([
      { providerId: 'deepseek', model: 'deepseek-v4-flash', value: 'deepseek::deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    ]);
  });

  it('uses provider defaults when the course config has no explicit model list', () => {
    expect(buildPartnerModelOptions([
      { providerId: 'moonshot', enabledModels: [] },
    ], defaultModels)).toEqual([
      { providerId: 'moonshot', model: 'moonshot-v1-8k', value: 'moonshot::moonshot-v1-8k', label: 'Kimi · moonshot-v1-8k' },
    ]);
  });

  it('English labels', () => {
    expect(buildPartnerModelOptions([{ providerId: 'dmxapi', enabledModels: ['glm-5.3'] }], { dmxapi: [] }, { lang: 'en' })[0].label)
      .toBe('GLM-5.3 (DMX)');
  });
});

describe('教师限定学生可选模型', () => {
  const configs: PartnerAiConfig[] = [
    { providerId: 'dmxapi', enabledModels: ['deepseek-v4-flash', 'gpt-5-mini'] },
    { providerId: 'deepseek', enabledModels: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  ];

  it('只留名单里的，其余不出现在下拉框', () => {
    const options = buildPartnerModelOptions(configs, defaultModels, {
      allowed: [{ providerId: 'deepseek', model: 'deepseek-v4-flash' }, { providerId: 'dmxapi', model: 'gpt-5-mini' }],
    });
    expect(options.map(o => o.value)).toEqual(['dmxapi::gpt-5-mini', 'deepseek::deepseek-v4-flash']);
  });

  it('「默认」解析成教师定的那个，而不是库里排第一的', () => {
    const options = buildPartnerModelOptions(configs, defaultModels, {
      includeAuto: true,
      autoLabel: '默认',
      preferred: { providerId: 'deepseek', model: 'deepseek-v4-flash' },
    });
    expect(resolveConcretePartnerModelSelection(options, 'auto', 'auto')).toEqual({ providerId: 'deepseek', model: 'deepseek-v4-flash' });
  });

  it('学生之前选的模型被移出名单：回到「默认」', () => {
    const options = buildPartnerModelOptions(configs, defaultModels, {
      includeAuto: true,
      allowed: [{ providerId: 'deepseek', model: 'deepseek-v4-flash' }],
    });
    expect(resolvePartnerModelSelection(options, 'dmxapi', 'gpt-5-mini')).toEqual({ providerId: 'auto', model: 'auto' });
  });
});

describe('inferPartnerConfigsFromMessages', () => {
  it('recovers chat provider choices from existing assistant message metadata', () => {
    expect(inferPartnerConfigsFromMessages([
      { senderKind: 'assistant', aiMetadata: { provider_id: 'moonshot', model: 'moonshot-v1-8k' } },
      { senderKind: 'assistant', aiMetadata: { provider_id: 'deepseek', model: 'deepseek-chat' } },
      { senderKind: 'user', aiMetadata: { provider_id: 'moonshot', model: 'moonshot-v1-32k' } },
      { senderKind: 'assistant', aiMetadata: { provider_id: 'tavily', model: 'tavily-search' } },
    ], defaultModels)).toEqual([
      { providerId: 'moonshot', enabledModels: ['moonshot-v1-8k'] },
      { providerId: 'deepseek', enabledModels: ['deepseek-chat'] },
    ]);
  });
});

describe('mergePartnerConfigs', () => {
  it('keeps configured providers and adds inferred models without duplication', () => {
    expect(mergePartnerConfigs(
      [{ providerId: 'moonshot', enabledModels: ['moonshot-v1-8k'] }],
      [
        { providerId: 'moonshot', enabledModels: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
        { providerId: 'deepseek', enabledModels: ['deepseek-chat'] },
      ],
    )).toEqual([
      { providerId: 'moonshot', enabledModels: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
      { providerId: 'deepseek', enabledModels: ['deepseek-chat'] },
    ]);
  });
});

describe('resolvePartnerModelSelection', () => {
  it('keeps the existing provider and model when it is still available', () => {
    const options = buildPartnerModelOptions([{ providerId: 'deepseek', enabledModels: ['deepseek-v4-flash'] }], defaultModels);

    expect(resolvePartnerModelSelection(options, 'deepseek', 'deepseek-v4-flash')).toEqual({
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
    });
  });

  it('falls back to the first available model without resetting chat memory', () => {
    const options = buildPartnerModelOptions([{ providerId: 'moonshot', enabledModels: ['moonshot-v1-8k'] }], defaultModels);

    expect(resolvePartnerModelSelection(options, 'deepseek', 'deepseek-v4-pro')).toEqual({
      providerId: 'moonshot',
      model: 'moonshot-v1-8k',
    });
  });
});

describe('resolveConcretePartnerModelSelection', () => {
  it('turns the auto UI option into the first real configured provider before API calls', () => {
    const options = buildPartnerModelOptions(
      [
        { providerId: 'dmxapi', enabledModels: ['deepseek-v4-flash'] },
        { providerId: 'moonshot', enabledModels: ['moonshot-v1-8k'] },
      ],
      defaultModels,
      { includeAuto: true, autoLabel: 'Auto · best available' },
    );

    expect(resolveConcretePartnerModelSelection(options, 'auto', 'auto')).toEqual({
      providerId: 'dmxapi',
      model: 'deepseek-v4-flash',
    });
  });

  it('keeps a real selected provider and model', () => {
    const options = buildPartnerModelOptions(
      [
        { providerId: 'dmxapi', enabledModels: ['deepseek-v4-flash'] },
        { providerId: 'moonshot', enabledModels: ['moonshot-v1-8k'] },
      ],
      defaultModels,
      { includeAuto: true, autoLabel: 'Auto · best available' },
    );

    expect(resolveConcretePartnerModelSelection(options, 'moonshot', 'moonshot-v1-8k')).toEqual({
      providerId: 'moonshot',
      model: 'moonshot-v1-8k',
    });
  });
});

describe('shouldUseWebSearchForAgent', () => {
  it('enables Tavily automatically for the evidence agent only when configured', () => {
    expect(shouldUseWebSearchForAgent('evidence_broker', false, true)).toBe(true);
    expect(shouldUseWebSearchForAgent('idea_coach', true, true)).toBe(true);
    expect(shouldUseWebSearchForAgent('', false, true)).toBe(false);
    expect(shouldUseWebSearchForAgent('evidence_broker', false, false)).toBe(false);
  });
});

describe('partner teaching agents', () => {
  it('normalizes legacy response-focus modes into explicit teaching agents', () => {
    expect(normalizePartnerAgentMode('coach')).toBe('idea_coach');
    expect(normalizePartnerAgentMode('evidence')).toBe('evidence_broker');
    expect(normalizePartnerAgentMode('community')).toBe('connection_scout');
    expect(normalizePartnerAgentMode('synthesis')).toBe('rise_above_coach');
    expect(normalizePartnerAgentMode('gap_finder')).toBe('gap_finder');
    expect(normalizePartnerAgentMode('unknown')).toBe('idea_coach');
  });

  it('exposes the P0/P1 Knowledge Building agent set in a stable order', () => {
    expect(getPartnerAgentModes('zh').map(mode => mode.id)).toEqual([
      'idea_coach',
      'gap_finder',
      'connection_scout',
      'evidence_broker',
      'rise_above_coach',
    ]);
  });

  // 三套名字曾经各写各的：学生看到中文，前端另有一套英文，后端 catalog 里还有第三套
  // label，互相对不上也没人发现。这里锁住学生实际看到的那一套。
  it('names every mode in Knowledge Building vocabulary, with no empty labels', () => {
    const zh = new Map(getPartnerAgentModes('zh').map(mode => [mode.id, mode.label]));
    expect(zh.get('idea_coach')).toBe('观点澄清');
    expect(zh.get('gap_finder')).toBe('探究缺口');
    expect(zh.get('connection_scout')).toBe('观点关联');
    expect(zh.get('evidence_broker')).toBe('证据检验');
    expect(zh.get('rise_above_coach')).toBe('观点提升');

    for (const lang of ['zh', 'en'] as const) {
      for (const mode of getPartnerAgentModes(lang)) {
        expect(mode.label.trim()).not.toBe('');
        expect(mode.description.trim()).not.toBe('');
      }
    }
  });
});
