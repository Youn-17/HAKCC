import { supabase } from '../config/supabase';
import { ApiError } from '../middleware/errorHandler';
import { decryptSecret, encryptSecret } from './secretCrypto';
import {
  defaultEnabledModels,
  normalizeDeepSeekModel,
  normalizeEnabledModels,
  usesDeepSeekModelAliases,
} from './modelCatalog';

export { defaultEnabledModels, normalizeDeepSeekModel, normalizeEnabledModels, usesDeepSeekModelAliases };

export type StoredProviderConfig = {
  id?: string;
  course_id?: string;
  provider_id: string;
  api_key_encrypted?: string | null;
  endpoint_url?: string | null;
  is_verified?: boolean | null;
  enabled_models?: unknown;
  configured_at?: string | null;
};

// 默认启用列表以前写死在这里，和 DMX 实际提供的模型漂移了：
// `claude-sonnet-4-5` 早就不在 DMX 目录里，教师用默认配置时那一档必然失败。
// 现在只从 modelCatalog 取（启用列表的几个函数也搬过去了，这里只转出）。

/** 低于这个预算的 DeepSeek 调用不开思考。1500 留得出 300 左右推理 + 1000 正文。 */
const SMALL_BUDGET_TOKENS = 1500;

export function withDeepSeekOptions(
  providerId: string,
  model: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (providerId !== 'deepseek') return body;
  const normalizedModel = normalizeDeepSeekModel(model, providerId);
  const nextBody = { ...body, model: normalizedModel };
  // V4 起两档默认都开思考（effort=high），而且 max_tokens 是连推理一起算的：
  // 2026-09-10 实测 max_tokens=120 时 120 个全给了推理，正文为空、finish_reason=length。
  // 所以预算小的调用（JSON 抽取、工具规划、改写）一律关掉思考，否则正文会被截空。
  const budget = Number((body as { max_tokens?: unknown }).max_tokens);
  if (Number.isFinite(budget) && budget > 0 && budget < SMALL_BUDGET_TOKENS) {
    return { ...nextBody, thinking: { type: 'disabled' } };
  }
  const messages = (body as { messages?: unknown }).messages;
  const withReasoning = Array.isArray(messages) ? { ...nextBody, messages: ensureReasoningOnToolCalls(messages) } : nextBody;
  if (normalizedModel === 'deepseek-v4-pro') {
    return { ...withReasoning, thinking: { type: 'enabled' }, reasoning_effort: 'high' };
  }
  return withReasoning;
}

/**
 * 思考模式下，历史里每条带 tool_calls 的 assistant 消息都必须有 reasoning_content 字段，
 * 哪怕是空串；缺了就 400「reasoning_content in the thinking mode must be passed back」。
 * 2026-09-10 逐种形状实测：带不带 tools、tool_choice 是什么都一样，只看这个字段在不在。
 * 工具规划轮常常是关着思考做的（没有推理可传），所以这里统一补空串。
 */
export function ensureReasoningOnToolCalls(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (!m || typeof m !== 'object') return m;
    const msg = m as Record<string, unknown>;
    if (msg.role !== 'assistant' || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) return m;
    if (typeof msg.reasoning_content === 'string') return m;
    return { ...msg, reasoning_content: '' };
  });
}

/**
 * Chat-body options for latency-sensitive tasks (auto feedback, gate checks):
 * keeps provider-specific model normalization but disables hybrid reasoning
 * ("thinking") where the API supports toggling it. Scaffolding feedback does
 * not need chain-of-thought, and the student is actively waiting.
 */
export function withFastChatOptions(
  providerId: string,
  model: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const base = withDeepSeekOptions(providerId, model, body);
  // DeepSeek V4 系列不传 thinking 就等于开着（实测 flash 多花约 0.8s 烧 120 个推理 token），
  // 快速档必须显式关掉，不能只在 pro 上关。
  if (providerId === 'deepseek') {
    const { reasoning_effort: _drop, ...rest } = base as Record<string, unknown>;
    return { ...rest, thinking: { type: 'disabled' } };
  }
  // GLM-4.5+ hybrid reasoning models accept thinking.type = disabled
  if (providerId === 'zhipu' && /^glm-(4\.[5-9]|[5-9])/.test(model)) {
    return { ...base, thinking: { type: 'disabled' } };
  }
  return base;
}

export function encryptProviderApiKey(apiKey: string): string {
  return encryptSecret(apiKey);
}

export function decryptProviderApiKey(storedApiKey: string): string {
  return decryptSecret(storedApiKey);
}

export function hasStoredProviderApiKey(config: Pick<StoredProviderConfig, 'api_key_encrypted'>): boolean {
  return Boolean(config.api_key_encrypted?.trim());
}

export function providerConfigToApi(
  config: StoredProviderConfig,
  options: { includeEndpointUrl?: boolean } = {},
) {
  return {
    id: config.id,
    courseId: config.course_id,
    providerId: config.provider_id,
    isVerified: hasStoredProviderApiKey(config) || Boolean(config.is_verified),
    enabledModels: normalizeEnabledModels(config.provider_id, config.enabled_models),
    configuredAt: config.configured_at,
    endpointUrl: options.includeEndpointUrl ? config.endpoint_url ?? null : null,
    apiKeyMasked: hasStoredProviderApiKey(config) ? '****' : '',
  };
}

export async function listCourseAiConfigs(
  courseId: string,
  options: { includeEndpointUrl?: boolean } = {},
) {
  const { data, error } = await supabase
    .from('teacher_ai_configs')
    .select('id, course_id, provider_id, api_key_encrypted, endpoint_url, is_verified, enabled_models, configured_at')
    .eq('course_id', courseId);

  if (error) throw new ApiError(500, error.message);

  return (data ?? []).map((config: StoredProviderConfig) => providerConfigToApi(config, options));
}
