import { modelOptionLabel } from './aiModelLabels';

export type PartnerAiConfig = {
  providerId: string;
  enabledModels?: string[];
};

export type PartnerAiMessageLike = {
  senderKind?: string;
  aiMetadata?: Record<string, unknown>;
};

export type PartnerModelOption = {
  providerId: string;
  model: string;
  value: string;
  label: string;
};

export const AUTO_PARTNER_PROVIDER_ID = 'auto';
export const AUTO_PARTNER_MODEL_ID = 'auto';

export type PartnerAgentMode =
  | 'idea_coach'
  | 'gap_finder'
  | 'connection_scout'
  | 'evidence_broker'
  | 'rise_above_coach';
export type PartnerAgentModeSelection = PartnerAgentMode | '';

export type LegacyPartnerAgentMode = 'coach' | 'evidence' | 'community' | 'synthesis';

export type PartnerAgentModeDefinition = {
  id: PartnerAgentMode;
  label: string;
  description: string;
};

const LEGACY_AGENT_MODE_ALIASES: Record<LegacyPartnerAgentMode, PartnerAgentMode> = {
  coach: 'idea_coach',
  evidence: 'evidence_broker',
  community: 'connection_scout',
  synthesis: 'rise_above_coach',
};

const PARTNER_AGENT_MODES: Array<{
  id: PartnerAgentMode;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}> = [
  {
    id: 'idea_coach',
    labelZh: '观点澄清',
    labelEn: 'Idea clarification',
    descriptionZh: '帮助学生把当前想法说清楚，并提出一个可继续推进的问题。',
    descriptionEn: 'Clarify the current idea and pose one next question for improvement.',
  },
  {
    id: 'gap_finder',
    labelZh: '探究缺口',
    labelEn: 'Inquiry gaps',
    descriptionZh: '指出解释缺口、证据缺口或概念模糊处，保留学生判断权。',
    descriptionEn: 'Surface explanation gaps, evidence gaps, or vague concepts while preserving learner judgment.',
  },
  {
    id: 'connection_scout',
    labelZh: '观点关联',
    labelEn: 'Idea connections',
    descriptionZh: '寻找相关 Note、Build-on 入口和共同问题中的连接机会。',
    descriptionEn: 'Find related Notes, Build-on opportunities, and links to the shared inquiry.',
  },
  {
    id: 'evidence_broker',
    labelZh: '证据检验',
    labelEn: 'Evidence testing',
    descriptionZh: '检索或整理可核查证据，但不替学生下结论。',
    descriptionEn: 'Retrieve or organize checkable evidence without making the conclusion for the learner.',
  },
  {
    id: 'rise_above_coach',
    labelZh: '观点提升',
    labelEn: 'Idea rise-above',
    descriptionZh: '描述想法之间的模式与张力，但不替学生做综合——综合是你的工作。',
    descriptionEn: 'Describe patterns and tensions across ideas, but never synthesize for the student — that agency is yours.',
  },
];

export function normalizePartnerAgentMode(value: unknown): PartnerAgentMode {
  if (
    value === 'idea_coach' ||
    value === 'gap_finder' ||
    value === 'connection_scout' ||
    value === 'evidence_broker' ||
    value === 'rise_above_coach'
  ) {
    return value;
  }
  if (value === 'coach' || value === 'evidence' || value === 'community' || value === 'synthesis') {
    return LEGACY_AGENT_MODE_ALIASES[value];
  }
  return 'idea_coach';
}

export function getPartnerAgentModes(lang: 'zh' | 'en'): PartnerAgentModeDefinition[] {
  return PARTNER_AGENT_MODES.map(mode => ({
    id: mode.id,
    label: lang === 'zh' ? mode.labelZh : mode.labelEn,
    description: lang === 'zh' ? mode.descriptionZh : mode.descriptionEn,
  }));
}

export type PartnerModelRef = { providerId: string; model: string };

export function buildPartnerModelOptions(
  configs: PartnerAiConfig[],
  defaultModels: Record<string, string[]>,
  options: {
    includeAuto?: boolean;
    autoLabel?: string;
    /** 教师限定的学生可选模型；null / 不传 = 不限 */
    allowed?: PartnerModelRef[] | null;
    /** 「默认」对应的模型：排到真实选项的最前，'auto' 解析成它 */
    preferred?: PartnerModelRef | null;
    lang?: 'zh' | 'en';
  } = {},
): PartnerModelOption[] {
  const lang = options.lang ?? 'zh';
  let modelOptions = configs.flatMap(config => {
    if (!Object.prototype.hasOwnProperty.call(defaultModels, config.providerId)) return [];
    const models = config.enabledModels?.length
      ? config.enabledModels
      : defaultModels[config.providerId] ?? [];
    return models.map(model => ({
      providerId: config.providerId,
      model,
      value: encodePartnerModelValue(config.providerId, model),
      label: modelOptionLabel(config.providerId, model, lang),
    }));
  });
  const { allowed, preferred } = options;
  if (allowed) {
    modelOptions = modelOptions.filter(o => allowed.some(a => a.providerId === o.providerId && a.model === o.model));
  }
  if (preferred) {
    const index = modelOptions.findIndex(o => o.providerId === preferred.providerId && o.model === preferred.model);
    if (index > 0) modelOptions = [modelOptions[index], ...modelOptions.filter((_, i) => i !== index)];
  }
  if (!options.includeAuto || modelOptions.length === 0) return modelOptions;
  return [
    {
      providerId: AUTO_PARTNER_PROVIDER_ID,
      model: AUTO_PARTNER_MODEL_ID,
      value: encodePartnerModelValue(AUTO_PARTNER_PROVIDER_ID, AUTO_PARTNER_MODEL_ID),
      label: options.autoLabel ?? 'Auto · best available',
    },
    ...modelOptions,
  ];
}

export function inferPartnerConfigsFromMessages(
  messages: PartnerAiMessageLike[],
  defaultModels: Record<string, string[]>,
): PartnerAiConfig[] {
  const modelsByProvider = new Map<string, Set<string>>();

  for (const message of messages) {
    if (message.senderKind && message.senderKind !== 'assistant') continue;
    const metadata = message.aiMetadata ?? {};
    const providerId = typeof metadata.provider_id === 'string'
      ? metadata.provider_id
      : typeof metadata.providerId === 'string'
        ? metadata.providerId
        : '';
    if (!providerId || !Object.prototype.hasOwnProperty.call(defaultModels, providerId)) continue;

    const model = typeof metadata.model === 'string'
      ? metadata.model
      : typeof metadata.model_full_name === 'string'
        ? metadata.model_full_name
        : '';

    const models = modelsByProvider.get(providerId) ?? new Set<string>();
    if (model) {
      models.add(model);
    } else {
      for (const fallback of defaultModels[providerId] ?? []) models.add(fallback);
    }
    modelsByProvider.set(providerId, models);
  }

  return Array.from(modelsByProvider.entries()).map(([providerId, models]) => ({
    providerId,
    enabledModels: Array.from(models),
  }));
}

export function mergePartnerConfigs(
  configured: PartnerAiConfig[],
  inferred: PartnerAiConfig[],
): PartnerAiConfig[] {
  const merged = new Map<string, Set<string>>();

  for (const config of [...configured, ...inferred]) {
    const models = merged.get(config.providerId) ?? new Set<string>();
    for (const model of config.enabledModels ?? []) models.add(model);
    merged.set(config.providerId, models);
  }

  return Array.from(merged.entries()).map(([providerId, models]) => ({
    providerId,
    enabledModels: Array.from(models),
  }));
}

export function resolvePartnerModelSelection(
  options: PartnerModelOption[],
  providerId: string,
  model: string,
): { providerId: string; model: string } {
  const current = options.find(option => option.providerId === providerId && option.model === model);
  const next = current ?? options[0];
  return {
    providerId: next?.providerId ?? '',
    model: next?.model ?? '',
  };
}

export function resolveConcretePartnerModelSelection(
  options: PartnerModelOption[],
  providerId: string,
  model: string,
): { providerId: string; model: string } | null {
  const firstRealOption = options.find(option => option.providerId !== AUTO_PARTNER_PROVIDER_ID);
  if (!firstRealOption) return null;
  if (providerId === AUTO_PARTNER_PROVIDER_ID) {
    return { providerId: firstRealOption.providerId, model: firstRealOption.model };
  }

  const selectedRealOption = options.find(option =>
    option.providerId === providerId &&
    option.model === model &&
    option.providerId !== AUTO_PARTNER_PROVIDER_ID
  );
  return selectedRealOption
    ? { providerId: selectedRealOption.providerId, model: selectedRealOption.model }
    : { providerId: firstRealOption.providerId, model: firstRealOption.model };
}

export function encodePartnerModelValue(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

export function decodePartnerModelValue(value: string): { providerId: string; model: string } {
  const [providerId = '', ...modelParts] = value.split('::');
  return {
    providerId,
    model: modelParts.join('::'),
  };
}

export function shouldUseWebSearchForAgent(
  mode: PartnerAgentModeSelection,
  manualWebSearch: boolean,
  hasTavilyConfig: boolean,
): boolean {
  if (!hasTavilyConfig) return false;
  return manualWebSearch || normalizePartnerAgentMode(mode) === 'evidence_broker';
}
