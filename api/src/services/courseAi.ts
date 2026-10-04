/**
 * 用课程配置的供应商发一次对话请求。
 *
 * 供应商选择 + 失败切换的逻辑此前散在 aiTriggerService、noteAiFeedback、
 * 以及前端的 DocAiPanel 里各一份。这里是共用的那一份，新代码都走它。
 * （既有三处的迁移是单独的事，风险大，不在这次一起动。）
 */
import { supabase } from '../config/supabase';
import { decryptProviderApiKey } from './aiProviderConfig';
import { isDmxProvider, orderConfigsByHealth, reportProviderFailure, reportProviderSuccess } from './modelRouter';
import { CHAT_ENDPOINTS } from './providerEndpoints';
import { aiFetch } from './aiGateway';
import { extractChatContent } from './modelCatalog';
import {
  COURSE_AI_ROW_COLUMNS,
  choiceModelFor,
  defaultModelForRow,
  featureCandidateRows,
  getAiFeature,
  settingsFromRows,
  type AiFeatureId,
  type CourseAiRow,
} from './aiFeatureModels';

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 60_000;

interface Candidate {
  providerId: string;
  model: string;
  apiKey: string;
  endpointUrl: string | null;
}

/**
 * 候选链：课程 AI 设置里给这个功能选的模型排第一，其余按功能的厂商顺序
 * （AI 教学日志是「先原厂 key，再走 DMX 聚合」），冷却中、并发满的沉底。
 * 只用连通性验证过的 key（原来就这样）；设置从全部行里读，它可能存在没验证过的那一行上。
 */
async function resolveCandidates(courseId: string, featureId: AiFeatureId): Promise<Candidate[]> {
  const { data } = await supabase
    .from('teacher_ai_configs')
    .select(COURSE_AI_ROW_COLUMNS)
    .eq('course_id', courseId);
  const rows = (data ?? []) as CourseAiRow[];
  const verified = rows.filter(c => c.is_verified && Array.isArray(c.enabled_models) && c.enabled_models.length > 0);
  const { rows: ordered, choice } = featureCandidateRows(featureId, verified, settingsFromRows(rows));
  const def = getAiFeature(featureId);

  const candidates: Candidate[] = [];
  for (const config of orderConfigsByHealth(ordered)) {
    let apiKey: string;
    try {
      apiKey = decryptProviderApiKey(String(config.api_key_encrypted));
    } catch {
      continue;
    }
    const model = choiceModelFor(choice, config.provider_id) ?? defaultModelForRow(def, config);
    if (!model) continue;
    candidates.push({
      providerId: config.provider_id,
      model,
      apiKey,
      endpointUrl: config.endpoint_url ?? null,
    });
  }
  return candidates;
}

export interface CourseChatResult {
  text: string;
  providerId: string;
  model: string;
}

export async function callCourseChat(courseId: string, params: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  /** 哪个功能在调用，决定课程设置里用哪一项的选择（目前只有 AI 教学日志用这里） */
  feature?: AiFeatureId;
}): Promise<CourseChatResult | null> {
  const candidates = await resolveCandidates(courseId, params.feature ?? 'teaching_log');
  if (candidates.length === 0) return null;

  for (const candidate of candidates.slice(0, MAX_ATTEMPTS)) {
    const url = candidate.endpointUrl
      ?? CHAT_ENDPOINTS[candidate.providerId]
      ?? CHAT_ENDPOINTS.openai;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await aiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${candidate.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: candidate.model,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userMessage },
          ],
          max_tokens: params.maxTokens ?? 1200,
          temperature: 0.4,
        }),
      });
      if (!res.ok) {
        reportProviderFailure(candidate.providerId, res.status === 429 ? 'rate_limit' : 'server');
        continue;
      }
      const json = await res.json();
      // 传入系统提示词：模型把内部推演当答案返回时能被识别出来并拒掉
      const text = extractChatContent(json, params.systemPrompt);
      if (!text?.trim()) {
        reportProviderFailure(candidate.providerId, 'other');
        continue;
      }
      reportProviderSuccess(candidate.providerId);
      return { text, providerId: candidate.providerId, model: candidate.model };
    } catch {
      reportProviderFailure(candidate.providerId, 'timeout');
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export { isDmxProvider };
