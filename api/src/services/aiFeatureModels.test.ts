import { afterEach, describe, expect, it } from 'vitest';
import {
  AI_FEATURES,
  AI_MODELS_SETTINGS_KEY,
  AiModelSettingsError,
  applyAiModelSettingsPatch,
  applyPickerToConfigs,
  featureCandidateRows,
  featureChoice,
  modelOptionsFor,
  orderedPartnerOptions,
  partnerModelPolicy,
  pickSettingsRow,
  planFeature,
  orderedPickerOptions,
  pickerPolicy,
  resolvePartnerSelection,
  resolvePickerSelection,
  serializeAiModelSettings,
  settingsFromRows,
  type AiModelSettings,
  type CourseAiRow,
} from './aiFeatureModels';

/**
 * 每个 AI 功能用哪个模型：教师指定的 → 默认规则（学生在等的先用 DeepSeek Flash，生图先用 MiniMax）
 * → 调用处原来的候选链。这里只测解析本身；调用处的健康度排序、失败换家在各自的路由里。
 */

const row = (providerId: string, enabled: string[] = [], extra: Partial<CourseAiRow> = {}): CourseAiRow => ({
  id: `row-${providerId}`,
  provider_id: providerId,
  api_key_encrypted: 'enc:v1:x',
  enabled_models: enabled,
  configured_at: '2026-09-01T00:00:00Z',
  ...extra,
});

/** 生产上三门课的样子：DMX 聚合 + DeepSeek + 智谱 Coding Plan + Kimi，外加 Tavily 和 MiniMax */
const FULL: CourseAiRow[] = [
  row('dmx', ['glm-5.3', 'glm-5.3-flash', 'deepseek-v4-flash', 'gpt-5.5']),
  row('deepseek', ['deepseek-flash', 'deepseek-v4-pro']),
  row('zhipu', ['glm-5.3', 'glm-5.3-flash']),
  row('moonshot', ['kimi-k2.6', 'kimi-k3']),
  row('minimax', ['MiniMax-M2.7']),
  row('tavily'),
];

function withSettings(rows: CourseAiRow[], settings: AiModelSettings, onProvider = 'zhipu'): CourseAiRow[] {
  return rows.map(r => (r.provider_id === onProvider
    ? { ...r, trigger_settings: { cooldown_seconds: 120, [AI_MODELS_SETTINGS_KEY]: serializeAiModelSettings(settings) } }
    : r));
}

const ref = (providerId: string, model: string) => ({ providerId, model });

afterEach(() => {
  delete process.env.AI_IMAGE_PREFER;
});

describe('featureChoice：谁排第一', () => {
  it('教师指定的排第一，哪怕是 DMX', () => {
    const rows = withSettings(FULL, { features: { note_feedback: ref('dmx', 'gpt-5.5') }, partnerModels: null });
    expect(featureChoice('note_feedback', rows)).toEqual({ providerId: 'dmx', model: 'gpt-5.5', source: 'teacher' });
  });

  it('没指定时，学生在等的功能默认用 DeepSeek Flash，不看配置行在库里的先后', () => {
    const rows = [...FULL].reverse();
    for (const id of ['note_partner', 'note_feedback', 'prompt_refine', 'doc_ai', 'support', 'workspace_agent'] as const) {
      expect(featureChoice(id, rows)).toEqual({ providerId: 'deepseek', model: 'deepseek-flash', source: 'default' });
    }
  });

  it('教师端不套这条默认，交给原来的候选链（本来就是 DeepSeek 在前）', () => {
    expect(featureChoice('teacher_agents', FULL)).toBeNull();
    expect(featureChoice('qualitative_coding', FULL)).toBeNull();
  });

  it('没有 DeepSeek 的课：没有默认选择，按原链走', () => {
    const rows = FULL.filter(r => r.provider_id !== 'deepseek');
    expect(featureChoice('note_feedback', rows)).toBeNull();
    const plan = planFeature('note_feedback', rows);
    expect(plan.current).toEqual({ providerId: 'zhipu', model: 'glm-5.3', source: 'auto' });
    expect(plan.fallbacks[0]).toEqual({ providerId: 'dmx', model: 'glm-5.3-flash' });
  });

  it('DeepSeek 只启用了 pro：默认规则不硬塞没启用的 flash', () => {
    const rows = FULL.map(r => (r.provider_id === 'deepseek' ? { ...r, enabled_models: ['deepseek-v4-pro'] } : r));
    expect(featureChoice('note_partner', rows)).toBeNull();
  });

  it('旧名字 deepseek-v4-flash 按现在的名字认', () => {
    const rows = FULL.map(r => (r.provider_id === 'deepseek' ? { ...r, enabled_models: ['deepseek-v4-flash'] } : r));
    expect(featureChoice('note_partner', rows)).toMatchObject({ providerId: 'deepseek', model: 'deepseek-flash' });
  });

  it('指定的那家 key 被删了：退回默认，设置页标出「用不了」', () => {
    const settings = { features: { note_feedback: ref('alibaba', 'qwen3.8-max') }, partnerModels: null };
    const rows = withSettings(FULL, settings);
    expect(featureChoice('note_feedback', rows)).toMatchObject({ providerId: 'deepseek', source: 'default' });
    const plan = planFeature('note_feedback', rows);
    expect(plan.saved).toEqual(ref('alibaba', 'qwen3.8-max'));
    expect(plan.savedUnavailable).toBe(true);
  });

  it('指定的模型不在那家的启用列表里：同样退回默认', () => {
    const rows = withSettings(FULL, { features: { doc_ai: ref('zhipu', 'glm-4.7') }, partnerModels: null });
    expect(featureChoice('doc_ai', rows)?.source).toBe('default');
  });

  it('不能在这里选的功能（向量、网页检索、PDF 解析、图灵测试）没有选择，只显示固定用什么', () => {
    for (const id of ['embedding', 'web_search', 'pdf_parse', 'turing_test'] as const) {
      expect(featureChoice(id, FULL)).toBeNull();
    }
    // 课程知识库的向量用平台的 OpenRouter key：配了就是 voyage-4-lite，和这门课配了哪家无关；没配就没有
    expect(planFeature('embedding', FULL).current).toBeNull();
    process.env.KB_OPENROUTER_API_KEY = 'platform-key';
    try {
      expect(planFeature('embedding', []).current).toEqual({ providerId: 'openrouter', model: 'voyageai/voyage-4-lite', source: 'fixed' });
    } finally {
      process.env.KB_OPENROUTER_API_KEY = '';
    }
    expect(planFeature('web_search', FULL).current).toEqual({ providerId: 'tavily', model: 'tavily-search', source: 'fixed' });
    expect(planFeature('web_search', FULL.filter(r => r.provider_id !== 'tavily')).current).toBeNull();
  });

  it('调用处只接得了几家的功能，指定了别家也不算数', () => {
    const rows = withSettings(FULL, { features: { qualitative_coding: ref('minimax', 'MiniMax-M2.7') }, partnerModels: null });
    expect(featureChoice('qualitative_coding', rows)).toBeNull();
    expect(modelOptionsFor('qualitative_coding', rows).some(o => o.providerId === 'minimax')).toBe(false);
  });
});

describe('failover：选择只决定谁排第一，其余照原链', () => {
  it('选中的那家排最前，其余按功能原来的顺序，Tavily 不进对话候选', () => {
    const rows = withSettings(FULL, { features: { note_feedback: ref('moonshot', 'kimi-k2.6') }, partnerModels: null });
    const { rows: ordered, choice } = featureCandidateRows('note_feedback', rows);
    expect(choice).toMatchObject({ providerId: 'moonshot', model: 'kimi-k2.6' });
    // 反馈原来的顺序：zhipu → deepseek → dmx → … → moonshot
    expect(ordered.map(r => r.provider_id)).toEqual(['moonshot', 'zhipu', 'deepseek', 'dmx', 'minimax']);
  });

  it('默认规则同样只挪第一个：DeepSeek 在前，后面仍是智谱、DMX', () => {
    const { rows: ordered } = featureCandidateRows('note_feedback', FULL);
    expect(ordered.map(r => r.provider_id).slice(0, 3)).toEqual(['deepseek', 'zhipu', 'dmx']);
  });

  it('设置页显示的「失败时换」就是这条链的后两个；不自动换的功能不显示', () => {
    const plan = planFeature('note_feedback', FULL);
    expect(plan.current).toEqual({ providerId: 'deepseek', model: 'deepseek-flash', source: 'default' });
    expect(plan.fallbacks).toEqual([ref('zhipu', 'glm-5.3'), ref('dmx', 'glm-5.3-flash')]);
    expect(planFeature('note_partner', FULL).fallbacks).toEqual([]);
  });
});

describe('生图', () => {
  it('配了 DMX 就默认 DMX（MiniMax 也配了也一样）', () => {
    expect(featureChoice('note_image', FULL)).toEqual({ providerId: 'dmx', model: 'qwen-image-plus', source: 'default' });
  });

  it('只有 MiniMax：没有默认选择，按链落到 MiniMax', () => {
    const rows = FULL.filter(r => r.provider_id !== 'dmx');
    expect(featureChoice('note_image', rows)).toBeNull();
    expect(planFeature('note_image', rows).current).toMatchObject({ providerId: 'minimax', source: 'auto' });
  });

  it('教师可以改成 DMX 的某个生图模型', () => {
    const rows = withSettings(FULL, { features: { note_image: ref('dmx', 'gpt-image-2') }, partnerModels: null });
    expect(featureChoice('note_image', rows)).toEqual({ providerId: 'dmx', model: 'gpt-image-2', source: 'teacher' });
  });

  it('服务器设了 AI_IMAGE_PREFER=minimax 时默认先 MiniMax', () => {
    process.env.AI_IMAGE_PREFER = 'minimax';
    expect(featureChoice('note_image', FULL)).toMatchObject({ providerId: 'minimax', model: 'image-01' });
  });

  it('生图的可选项只有生图模型，对话模型不混进来', () => {
    expect(modelOptionsFor('note_image', FULL)).toEqual([
      ref('minimax', 'image-01'), ref('minimax', 'image-01-live'),
      ref('dmx', 'qwen-image-plus'), ref('dmx', 'gpt-image-2'),
    ]);
  });
});

describe('学生在笔记 AI 助手里能选的模型', () => {
  const restricted = (partnerModels: AiModelSettings['partnerModels'], features: AiModelSettings['features'] = {}) =>
    withSettings(FULL, { features, partnerModels });

  it('不限时：全部对话模型，DeepSeek 在前、DMX 最后；默认 DeepSeek Flash', () => {
    const options = orderedPartnerOptions(FULL);
    expect(options[0]).toEqual(ref('deepseek', 'deepseek-flash'));
    expect(options.at(-1)?.providerId).toBe('dmx');
    expect(partnerModelPolicy(FULL)).toEqual({ allowed: null, defaultModel: ref('deepseek', 'deepseek-flash') });
  });

  it('MiniMax 的 key 是配来生图的：学生下拉框里没有它（和前端下拉框一致）', () => {
    expect(orderedPartnerOptions(FULL).some(o => o.providerId === 'minimax')).toBe(false);
    expect(modelOptionsFor('note_feedback', FULL).some(o => o.providerId === 'minimax')).toBe(true);
    expect(() => applyAiModelSettingsPatch({ features: {}, partnerModels: null }, { partnerModels: [ref('minimax', 'MiniMax-M2.7')] }, FULL))
      .toThrow(AiModelSettingsError);
  });

  it('限定后只剩名单里的，顺序不变', () => {
    const rows = restricted([ref('zhipu', 'glm-5.3-flash'), ref('deepseek', 'deepseek-flash')]);
    expect(orderedPartnerOptions(rows)).toEqual([ref('deepseek', 'deepseek-flash'), ref('zhipu', 'glm-5.3-flash')]);
  });

  it('默认的 DeepSeek Flash 不在名单里：默认落到名单里第一个', () => {
    const rows = restricted([ref('zhipu', 'glm-5.3-flash'), ref('moonshot', 'kimi-k2.6')]);
    expect(partnerModelPolicy(rows).defaultModel).toEqual(ref('zhipu', 'glm-5.3-flash'));
  });

  it('教师给「笔记 AI 助手对话」指定的模型就是「默认」', () => {
    const rows = restricted(null, { note_partner: ref('moonshot', 'kimi-k2.6') });
    expect(partnerModelPolicy(rows).defaultModel).toEqual(ref('moonshot', 'kimi-k2.6'));
    expect(resolvePartnerSelection(rows, { providerId: 'auto', model: 'auto' })).toEqual({ ...ref('moonshot', 'kimi-k2.6'), coerced: false });
  });

  it('名单内的照学生选的发；名单外的（页面还没刷新）落到默认，并标出被换过', () => {
    const rows = restricted([ref('deepseek', 'deepseek-flash'), ref('zhipu', 'glm-5.3')]);
    expect(resolvePartnerSelection(rows, ref('zhipu', 'glm-5.3'))).toEqual({ ...ref('zhipu', 'glm-5.3'), coerced: false });
    expect(resolvePartnerSelection(rows, ref('dmx', 'gpt-5.5'))).toEqual({ ...ref('deepseek', 'deepseek-flash'), coerced: true });
  });

  it('不限名单时，老对话里记着的自定义模型照发（保持原行为）', () => {
    expect(resolvePartnerSelection(FULL, ref('zhipu', 'glm-4-plus'))).toEqual({ ...ref('zhipu', 'glm-4-plus'), coerced: false });
  });

  it('这门课一个对话模型都没有：返回 null，路由报「没有配置」', () => {
    expect(resolvePartnerSelection([row('tavily')], ref('auto', 'auto'))).toBeNull();
  });
});

describe('设置存在哪一行', () => {
  it('最新的非空设置行；都没有就最新的一行', () => {
    const rows = [
      row('zhipu', [], { configured_at: '2026-09-03T00:00:00Z', trigger_settings: {} }),
      row('deepseek', [], { configured_at: '2026-09-01T00:00:00Z', trigger_settings: { cooldown_seconds: 60 } }),
      row('dmx', [], { configured_at: '2026-09-02T00:00:00Z', trigger_settings: null }),
    ];
    expect(pickSettingsRow(rows)?.provider_id).toBe('deepseek');
    expect(pickSettingsRow(rows.map(r => ({ ...r, trigger_settings: null })))?.provider_id).toBe('zhipu');
  });

  it('读出来的设置与存进去的一致，坏数据被忽略', () => {
    const rows = [row('zhipu', [], {
      trigger_settings: {
        [AI_MODELS_SETTINGS_KEY]: {
          features: { note_feedback: { provider_id: 'deepseek', model: 'deepseek-v4-flash' }, bogus: { provider_id: 'x', model: 'y' }, doc_ai: 'nope' },
          partner_models: [{ provider_id: 'deepseek', model: 'deepseek-flash' }, { provider_id: '' }],
          picker_models: {
            workspace_agent: [{ provider_id: 'zhipu', model: 'glm-5.3-flash' }, 'nope'],
            personal_agent: [],
            bogus_entry: [{ provider_id: 'deepseek', model: 'deepseek-flash' }],
          },
        },
      },
    })];
    expect(settingsFromRows(rows)).toEqual({
      features: { note_feedback: ref('deepseek', 'deepseek-flash') },
      partnerModels: [ref('deepseek', 'deepseek-flash')],
      pickerModels: { workspace_agent: [ref('zhipu', 'glm-5.3-flash')] },
    });
  });
});

describe('applyAiModelSettingsPatch：只收这门课现在用得了的选择', () => {
  const empty: AiModelSettings = { features: {}, partnerModels: null };

  it('指定、改回自动', () => {
    const set = applyAiModelSettingsPatch(empty, { features: { support: ref('zhipu', 'glm-5.3-flash') } }, FULL);
    expect(set.features.support).toEqual(ref('zhipu', 'glm-5.3-flash'));
    const reset = applyAiModelSettingsPatch(set, { features: { support: null } }, FULL);
    expect(reset.features.support).toBeUndefined();
  });

  it('旧名字按现在的名字存', () => {
    const set = applyAiModelSettingsPatch(empty, { features: { note_partner: ref('deepseek', 'deepseek-v4-flash') } }, FULL);
    expect(set.features.note_partner).toEqual(ref('deepseek', 'deepseek-flash'));
  });

  it('没有 key 的厂商、没启用的模型、对话功能选生图模型：都拒绝', () => {
    expect(() => applyAiModelSettingsPatch(empty, { features: { doc_ai: ref('openai', 'gpt-5.5') } }, FULL)).toThrow(AiModelSettingsError);
    expect(() => applyAiModelSettingsPatch(empty, { features: { doc_ai: ref('zhipu', 'glm-4.7') } }, FULL)).toThrow(AiModelSettingsError);
    expect(() => applyAiModelSettingsPatch(empty, { features: { doc_ai: ref('minimax', 'image-01') } }, FULL)).toThrow(AiModelSettingsError);
  });

  it('不能选的功能、不认识的功能：拒绝', () => {
    expect(() => applyAiModelSettingsPatch(empty, { features: { embedding: ref('dmx', 'glm-5.3') } }, FULL)).toThrow(/不能在这里选模型/);
    expect(() => applyAiModelSettingsPatch(empty, { features: { nope: ref('dmx', 'glm-5.3') } as never }, FULL)).toThrow(/不认识的功能/);
  });

  it('学生可选模型：去重、至少留一个、null 表示不限', () => {
    const set = applyAiModelSettingsPatch(empty, {
      partnerModels: [ref('deepseek', 'deepseek-flash'), ref('deepseek', 'deepseek-v4-flash'), ref('zhipu', 'glm-5.3')],
    }, FULL);
    expect(set.partnerModels).toEqual([ref('deepseek', 'deepseek-flash'), ref('zhipu', 'glm-5.3')]);
    expect(() => applyAiModelSettingsPatch(empty, { partnerModels: [] }, FULL)).toThrow(/至少要留一个/);
    expect(applyAiModelSettingsPatch(set, { partnerModels: null }, FULL).partnerModels).toBeNull();
  });
});

describe('功能清单', () => {
  it('每个功能都有中英文名称和一句说明；不能选的写明原因', () => {
    for (const def of AI_FEATURES) {
      expect(def.label.zh && def.label.en && def.desc.zh && def.desc.en).toBeTruthy();
      if (!def.selectable) expect(def.fixedNote?.zh).toBeTruthy();
      // 界面文字约定：写「建构」不写「构建」
      expect(`${def.label.zh}${def.desc.zh}${def.fixedNote?.zh ?? ''}`).not.toContain('构建');
    }
  });

  it('id 不重复', () => {
    const ids = AI_FEATURES.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('各入口的模型菜单名单（知识空间助手、学生首页 AI 对话，和笔记 AI 助手同一套规则）', () => {
  const only = (surface: 'workspace_agent' | 'personal_agent', list: ReturnType<typeof ref>[]) =>
    withSettings(FULL, { features: {}, partnerModels: null, pickerModels: { [surface]: list } });

  it('限定了就只剩名单里的；别的入口不受影响', () => {
    const rows = only('workspace_agent', [ref('zhipu', 'glm-5.3-flash'), ref('moonshot', 'kimi-k2.6')]);
    expect(orderedPickerOptions('workspace_agent', rows)).toEqual([ref('zhipu', 'glm-5.3-flash'), ref('moonshot', 'kimi-k2.6')]);
    expect(orderedPickerOptions('note_partner', rows).length).toBeGreaterThan(2);
    expect(orderedPickerOptions('personal_agent', rows).length).toBeGreaterThan(2);
  });

  it('「默认」一定在名单里：默认规则挑的 DeepSeek Flash 没勾上，就用名单里排最前的', () => {
    const rows = only('workspace_agent', [ref('zhipu', 'glm-5.3-flash'), ref('moonshot', 'kimi-k2.6')]);
    expect(pickerPolicy('workspace_agent', rows)).toEqual({
      allowed: [ref('zhipu', 'glm-5.3-flash'), ref('moonshot', 'kimi-k2.6')],
      defaultModel: ref('zhipu', 'glm-5.3-flash'),
    });
    // 不限时照常是 DeepSeek Flash
    expect(pickerPolicy('workspace_agent', FULL)).toEqual({ allowed: null, defaultModel: ref('deepseek', 'deepseek-flash') });
  });

  it('请求：名单里的照发；名单外的和「自动」都落到名单里的默认', () => {
    const rows = only('personal_agent', [ref('moonshot', 'kimi-k2.6')]);
    expect(resolvePickerSelection('personal_agent', rows, ref('moonshot', 'kimi-k2.6'))).toEqual({ ...ref('moonshot', 'kimi-k2.6'), coerced: false });
    expect(resolvePickerSelection('personal_agent', rows, ref('dmx', 'gpt-5.5'))).toEqual({ ...ref('moonshot', 'kimi-k2.6'), coerced: true });
    expect(resolvePickerSelection('personal_agent', rows, ref('auto', 'auto'))).toEqual({ ...ref('moonshot', 'kimi-k2.6'), coerced: false });
  });

  it('发给前端的配置按名单裁：每家只留名单里的模型，一个不剩的厂商拿掉', () => {
    const rows = only('workspace_agent', [ref('zhipu', 'glm-5.3-flash'), ref('deepseek', 'deepseek-flash')]);
    const configs = [
      { providerId: 'dmx', enabledModels: ['glm-5.3', 'gpt-5.5'] },
      { providerId: 'deepseek', enabledModels: ['deepseek-flash', 'deepseek-v4-pro'] },
      { providerId: 'zhipu', enabledModels: ['glm-5.3', 'glm-5.3-flash'] },
    ];
    expect(applyPickerToConfigs('workspace_agent', rows, configs)).toEqual([
      { providerId: 'deepseek', enabledModels: ['deepseek-flash'] },
      { providerId: 'zhipu', enabledModels: ['glm-5.3-flash'] },
    ]);
    // 不限就原样
    expect(applyPickerToConfigs('workspace_agent', FULL, configs)).toEqual(configs);
  });

  it('保存：只收能用的、至少留一个、null 表示不限；不认识的入口报错', () => {
    const empty: AiModelSettings = { features: {}, partnerModels: null };
    const set = applyAiModelSettingsPatch(empty, { pickerModels: { workspace_agent: [ref('zhipu', 'glm-5.3-flash'), ref('zhipu', 'glm-5.3-flash')] } }, FULL);
    expect(set.pickerModels).toEqual({ workspace_agent: [ref('zhipu', 'glm-5.3-flash')] });
    expect(set.partnerModels).toBeNull();
    expect(applyAiModelSettingsPatch(set, { pickerModels: { workspace_agent: null } }, FULL).pickerModels).toEqual({});
    expect(() => applyAiModelSettingsPatch(empty, { pickerModels: { personal_agent: [] } }, FULL)).toThrow(/至少要留一个/);
    expect(() => applyAiModelSettingsPatch(empty, { pickerModels: { personal_agent: [ref('openai', 'gpt-5')] } }, FULL)).toThrow(AiModelSettingsError);
    expect(() => applyAiModelSettingsPatch(empty, { pickerModels: { note_image: [ref('minimax', 'image-01')] } as never }, FULL)).toThrow(/不认识的入口/);
  });
});
