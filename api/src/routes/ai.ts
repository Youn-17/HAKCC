/**
 * AI Routes — multi-provider chat proxy + teacher config management
 *
 * Supported chat providers:
 *   openai     → https://api.openai.com/v1/chat/completions
 *   anthropic  → https://api.anthropic.com/v1/messages
 *   google     → https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   deepseek   → https://api.deepseek.com/chat/completions  (OpenAI-compatible)
 *   dmx        → https://www.dmxapi.cn/v1/chat/completions  (OpenAI-compatible aggregator)
 *   moonshot   → https://api.moonshot.cn/v1/chat/completions   (OpenAI-compatible)
 *   doubao     → https://ark.cn-beijing.volces.com/api/v3/chat/completions
 *   xai        → https://api.x.ai/v1/chat/completions          (OpenAI-compatible)
 *   baidu      → https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/{model} (ERNIE/Wenxin)
 *   alibaba    → https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions (Qwen, OpenAI-compatible)
 *   zhipu      → https://open.bigmodel.cn/api/coding/paas/v4/chat/completions (GLM Coding Plan, OpenAI-compatible)
 *   openrouter → https://openrouter.ai/api/v1/chat/completions (OpenAI-compatible)
 *
 * Supported search providers:
 *   tavily    → https://api.tavily.com/search  (web search, teacher/admin configurable)
 *
 * Teacher API keys are stored encrypted in teacher_ai_configs.api_key_encrypted.
 * Existing legacy plain-text rows are still readable for backward compatibility.
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { callTavilySearch } from '../services/tavilySearch';
import { ensureCourseInstructor, ensureCourseMember, isCourseStaff } from '../services/accessControl';
import { invalidateConditionCache } from '../services/experimentCondition';
import { assertSafePublicUrl } from '../services/urlGuard';
import {
  decryptProviderApiKey,
  encryptProviderApiKey,
  normalizeEnabledModels,
  providerConfigToApi,
  withDeepSeekOptions,
} from '../services/aiProviderConfig';
import { aiFetch } from '../services/aiGateway';
import { catalogSnapshot } from '../services/modelCatalog';
import { probeProvider, loadTest } from '../services/modelProbe';
import { gatewayStats } from '../services/aiGateway';
import { isDmxProvider, isProviderCoolingDown, orderConfigsByHealth, pickModel, routerStats } from '../services/modelRouter';
import {
  AI_FEATURES,
  AI_MODELS_SETTINGS_KEY,
  AiModelSettingsError,
  applyAiModelSettingsPatch,
  chatModelOptions,
  choiceModelFor,
  defaultModelForRow,
  featureCandidateRows,
  getAiFeature,
  hasProviderKey,
  isAiFeatureId,
  loadCourseAiRows,
  modelOptionsFor,
  partnerModelPolicy,
  PICKER_SURFACES,
  pickerAllowlist,
  pickerPolicy,
  pickSettingsRow,
  planAllFeatures,
  serializeAiModelSettings,
  settingsFromRows,
  type AiFeatureId,
  type AiModelSettingsPatch,
  type CourseAiRow,
  type ModelRef,
} from '../services/aiFeatureModels';
import { extractChatContent } from '../services/modelCatalog';
import { CHAT_ENDPOINTS, MINIMAX_ENDPOINTS, MODELS_ENDPOINTS } from '../services/providerEndpoints';
import { synthesizeMinimaxSpeech } from '../services/minimaxMedia';
import { produceDrawing } from '../services/drawTurn';
import type { DrawTurn } from '../services/drawPlanner';
import { drawRouteSummary, parseDrawForm, parsePreviousDrawing, routeDrawRequest, sanitizeRouteSummary } from '../services/drawJudge';
import { loadStudentLearningContext } from '../services/studentLearningContext';

const router = Router();

/**
 * 默认回复长度上限。
 *
 * 400 是最初为画布上「一句话加一个追问」定的，中文两三百字就到顶 —— 但同一个
 * 端点也在被文档问答、笔记讨论复用，那些场景一律被腰斩。900 大约是中文六七百字：
 * 说清一个观点加一个追问绰绰有余，又不至于让 AI 长篇大论淹没学生自己的思考。
 * 需要更长的由调用方传 max_tokens 覆盖，上限 4000。
 */
const DEFAULT_MAX_TOKENS = 900;

/**
 * 流式回复的上限。流式是画布 AI 和笔记讨论走的路径，学生一边读一边等，
 * 可以放得比一次性返回更宽 —— 长不等于慢，第一个字出现的时间是一样的。
 */
const STREAM_MAX_TOKENS = 1600;

const DAILY_AI_LIMIT = 100;

async function assertDailyAiQuota(userId: string): Promise<void> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: todayUsage } = await supabase
    .from('ai_interventions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since24h);
  if ((todayUsage ?? 0) >= DAILY_AI_LIMIT) {
    throw new ApiError(429, `Daily AI usage limit reached (${DAILY_AI_LIMIT} interactions per 24h). Try again later.`);
  }
}

async function canReadProviderEndpointUrl(courseId: string, req: Request): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  if (req.user.role !== 'teacher') return false;
  try {
    await ensureCourseInstructor(courseId, req.user);
    return true;
  } catch {
    return false;
  }
}

// ── AI Provider Configs ───────────────────────────────────────

// GET /api/courses/:courseId/ai-configs — list enabled providers for a course (all enrolled users)
router.get('/courses/:courseId/ai-configs', verifyJWT, async (req: Request, res: Response) => {
  const { courseId } = req.params;
  await ensureCourseMember(String(courseId), req.user!);

  const { data, error } = await supabase
    .from('teacher_ai_configs')
    .select('id, course_id, provider_id, api_key_encrypted, endpoint_url, is_verified, enabled_models, configured_at, trigger_settings')
    .eq('course_id', courseId);

  if (error) throw new ApiError(500, error.message);

  const includeEndpointUrl = await canReadProviderEndpointUrl(String(courseId), req);
  const rows = (data ?? []) as CourseAiRow[];
  const configs = rows.map((config: any) => providerConfigToApi(config, { includeEndpointUrl }));

  // 笔记 AI 助手的下拉框：教师限定了学生能选哪些模型、以及「默认」是哪个
  res.json({ configs, partnerModels: partnerModelPolicy(rows) });
});

// POST /api/courses/:courseId/ai-configs — save/update provider config (teacher/admin only)
router.post(
  '/courses/:courseId/ai-configs',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { courseId } = req.params;
    await ensureCourseInstructor(String(courseId), req.user!);
    const { provider_id, api_key, endpoint_url, enabled_models = [] } = req.body;

    if (typeof provider_id !== 'string' || typeof api_key !== 'string' || !provider_id.trim() || !api_key.trim()) {
      throw new ApiError(400, 'provider_id and api_key are required');
    }
    const providerId = provider_id.trim();
    const apiKey = api_key.trim();
    const endpointUrl = typeof endpoint_url === 'string' && endpoint_url.trim()
      ? endpoint_url.trim()
      : undefined;
    if (endpointUrl) await assertSafePublicUrl(endpointUrl);

    // Quick liveness check for known providers
    const verified = await verifyProviderKey(providerId, apiKey, endpointUrl);
    const normalizedModels = normalizeEnabledModels(providerId, enabled_models);
    const encryptedApiKey = encryptProviderApiKey(apiKey);

    const { data, error } = await supabase
      .from('teacher_ai_configs')
      .upsert(
        {
          course_id: courseId,
          provider_id: providerId,
          api_key_encrypted: encryptedApiKey,
          endpoint_url: endpointUrl ?? null,
          is_verified: verified,
          enabled_models: normalizedModels,
          configured_at: new Date().toISOString(),
        },
        { onConflict: 'course_id,provider_id' },
      )
      .select('id, course_id, provider_id, api_key_encrypted, endpoint_url, is_verified, enabled_models, configured_at')
      .single();

    if (error) throw new ApiError(500, error.message);
    res.status(201).json({
      config: providerConfigToApi(data, { includeEndpointUrl: true }),
      verified,
    });
  },
);

// DELETE /api/courses/:courseId/ai-configs/:providerId — remove config
router.delete(
  '/courses/:courseId/ai-configs/:providerId',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { courseId, providerId } = req.params;
    await ensureCourseInstructor(String(courseId), req.user!);

    // 触发设置和各功能的模型选择存在某一条服务商配置行上。删掉的恰好是那一行，
    // 设置会跟着没了——先搬到剩下最新的一行上（读取规则是「最新的非空设置行」，搬过去就还是它）。
    const { data: rows } = await supabase
      .from('teacher_ai_configs')
      .select('id, provider_id, trigger_settings, configured_at')
      .eq('course_id', courseId);
    const settingsRow = pickSettingsRow((rows ?? []) as CourseAiRow[]);
    const remaining = ((rows ?? []) as CourseAiRow[])
      .filter(r => r.provider_id !== providerId)
      .sort((a, b) => String(b.configured_at ?? '').localeCompare(String(a.configured_at ?? '')));
    if (settingsRow?.provider_id === providerId && remaining[0]?.id
      && settingsRow.trigger_settings && Object.keys(settingsRow.trigger_settings as object).length > 0) {
      const { error: moveError } = await supabase
        .from('teacher_ai_configs')
        .update({ trigger_settings: settingsRow.trigger_settings })
        .eq('id', remaining[0].id);
      if (moveError) throw new ApiError(500, moveError.message);
    }

    const { error } = await supabase
      .from('teacher_ai_configs')
      .delete()
      .eq('course_id', courseId)
      .eq('provider_id', providerId);

    if (error) throw new ApiError(500, error.message);
    res.json({ message: 'Config removed' });
  },
);

// ── Trigger Settings (teacher AI control panel) ──────────────

// 响应风格（response_style）和 AI 角色设定（ai_persona）曾经在这里，界面上也能改，
// 但反馈代码从没读过它们。反馈提示词有固定约定（EFA 三步、最多三句、一个引导问题、
// 知识建构引导者的角色），这两项要么与约定冲突、要么会替换掉那个角色，所以撤掉了，
// 不再接受写入。老数据里留着的这两个键不影响任何行为。
const DEFAULT_TRIGGER_SETTINGS = {
  enabled_triggers: ['undigested_ai', 'no_reasoning', 'no_evidence', 'no_connection', 'promising_seed', 'unclear'],
  cooldown_seconds: 120,
  auto_feedback_enabled: true,
  custom_context: '',
  sensitivity: 'balanced' as 'conservative' | 'balanced' | 'aggressive',
  response_language: 'auto' as 'auto' | 'zh' | 'en',
  max_feedback_length: 300,
  experiment_mode: false,
  // 画布问题栏后面滚动的讨论主题（2026-10-05 起，默认开）
  view_topics_enabled: true,
};

router.get(
  '/courses/:courseId/trigger-settings',
  verifyJWT,
  async (req: Request, res: Response) => {
    const { courseId } = req.params;
    await ensureCourseMember(String(courseId), req.user!);

    // Deterministic row selection: prefer the newest row that actually has
    // settings (courses may have one config row per provider)
    const { data } = await supabase
      .from('teacher_ai_configs')
      .select('trigger_settings, configured_at')
      .eq('course_id', courseId)
      .order('configured_at', { ascending: false });
    const row = (data ?? []).find(
      (r: any) => r.trigger_settings && Object.keys(r.trigger_settings).length > 0,
    );

    const settings = withoutModelSettings({ ...DEFAULT_TRIGGER_SETTINGS, ...(row?.trigger_settings as Record<string, unknown> ?? {}) });
    // 触发设置存在服务商配置行上：一行都没有时 PUT 会 404，前端据此提前说明
    res.json({ settings, providerConfigured: (data ?? []).length > 0 });
  },
);

/** 同一个 JSON 里还存着各功能的模型选择，那一份走自己的接口，不混进触发设置的返回里。 */
function withoutModelSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const { [AI_MODELS_SETTINGS_KEY]: _models, ...rest } = settings;
  return rest;
}

router.put(
  '/courses/:courseId/trigger-settings',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { courseId } = req.params;
    await ensureCourseInstructor(String(courseId), req.user!);

    const VALID_TRIGGERS = ['undigested_ai', 'no_reasoning', 'no_evidence', 'no_connection', 'promising_seed', 'unclear'];
    const VALID_SENSITIVITIES = ['conservative', 'balanced', 'aggressive'];
    const body = req.body as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (Array.isArray(body.enabled_triggers)) {
      patch.enabled_triggers = (body.enabled_triggers as string[]).filter((t) => VALID_TRIGGERS.includes(t));
    }
    if (typeof body.cooldown_seconds === 'number') {
      patch.cooldown_seconds = Math.max(30, Math.min(600, body.cooldown_seconds));
    }
    if (typeof body.auto_feedback_enabled === 'boolean') {
      patch.auto_feedback_enabled = body.auto_feedback_enabled;
    }
    if (typeof body.custom_context === 'string') {
      patch.custom_context = body.custom_context.slice(0, 500);
    }
    if (typeof body.sensitivity === 'string' && VALID_SENSITIVITIES.includes(body.sensitivity)) {
      patch.sensitivity = body.sensitivity;
    }
    const VALID_LANGUAGES = ['auto', 'zh', 'en'];
    if (typeof body.response_language === 'string' && VALID_LANGUAGES.includes(body.response_language)) {
      patch.response_language = body.response_language;
    }
    if (typeof body.max_feedback_length === 'number') {
      patch.max_feedback_length = Math.max(50, Math.min(1000, body.max_feedback_length));
    }
    if (typeof body.experiment_mode === 'boolean') {
      patch.experiment_mode = body.experiment_mode;
    }
    if (typeof body.view_topics_enabled === 'boolean') {
      patch.view_topics_enabled = body.view_topics_enabled;
    }

    // Write to the same row that reads resolve to (first non-empty settings
    // row, else the newest row), so read/write stay consistent
    const { data: rows } = await supabase
      .from('teacher_ai_configs')
      .select('id, trigger_settings, configured_at')
      .eq('course_id', courseId)
      .order('configured_at', { ascending: false });

    const existing = (rows ?? []).find(
      (r: any) => r.trigger_settings && Object.keys(r.trigger_settings).length > 0,
    ) ?? (rows ?? [])[0];

    if (!existing) {
      throw new ApiError(404, 'No AI config found for this course — configure a provider first');
    }

    const merged = { ...DEFAULT_TRIGGER_SETTINGS, ...(existing.trigger_settings as Record<string, unknown> ?? {}), ...patch };

    const { error } = await supabase
      .from('teacher_ai_configs')
      .update({ trigger_settings: merged })
      .eq('id', existing.id);

    if (error) throw new ApiError(500, error.message);
    // Experiment mode / trigger changes must take effect promptly in the
    // condition-gating caches.
    invalidateConditionCache();
    res.json({ settings: withoutModelSettings(merged) });
  },
);

// ── 各功能用哪个模型（教师 AI 设置页）─────────────────────────

/**
 * 给设置页的全部信息：每个 AI 功能现在用哪个模型、教师保存的选择、可选的模型、
 * 学生在笔记 AI 助手里能选哪些。只有模型名和厂商名，不含任何密钥或接口地址。
 */
function aiFeatureModelsPayload(rows: CourseAiRow[]) {
  const settings = settingsFromRows(rows);
  const plans = new Map(planAllFeatures(rows).map(p => [p.id, p]));
  const configured = rows.filter(hasProviderKey).map(r => r.provider_id);
  const cooling = Array.from(new Set(configured)).filter(pid => isProviderCoolingDown(pid));
  return {
    features: AI_FEATURES.map(def => {
      const plan = plans.get(def.id)!;
      return {
        id: def.id,
        group: def.group,
        who: def.who,
        kind: def.kind,
        selectable: def.selectable,
        failover: def.failover,
        label: def.label,
        desc: def.desc,
        fixedNote: def.fixedNote ?? null,
        saved: plan.saved,
        savedUnavailable: plan.savedUnavailable,
        current: plan.current,
        fallbacks: plan.fallbacks,
        /** 这个功能能选的模型（调用处接不了的厂商不在里面） */
        options: modelOptionsFor(def.id, rows),
      };
    }),
    options: {
      chat: chatModelOptions(rows),
      image: modelOptionsFor('note_image', rows),
    },
    partnerModels: {
      ...partnerModelPolicy(rows),
      restricted: settings.partnerModels !== null,
    },
    /** 每个有模型菜单的入口：菜单里显示哪些（allowed 为 null = 不限）、「默认」是哪个、能勾的有哪些 */
    pickers: Object.fromEntries(PICKER_SURFACES.map(surface => [surface, {
      ...pickerPolicy(surface, rows, settings),
      restricted: pickerAllowlist(settings, surface) !== null,
      options: modelOptionsFor(surface, rows),
    }])),
    providers: Array.from(new Set(configured)),
    coolingProviders: cooling,
    providerConfigured: rows.length > 0,
  };
}

router.get(
  '/courses/:courseId/ai-feature-models',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const courseId = String(req.params.courseId);
    await ensureCourseInstructor(courseId, req.user!);
    const rows = await loadCourseAiRows(courseId).catch((err: Error) => { throw new ApiError(500, err.message); });
    res.json(aiFeatureModelsPayload(rows));
  },
);

function parseRefBody(value: unknown, field: string): ModelRef {
  if (!value || typeof value !== 'object') throw new ApiError(400, `${field} 要写成 { provider_id, model }`);
  const v = value as Record<string, unknown>;
  if (typeof v.provider_id !== 'string' || !v.provider_id.trim() || typeof v.model !== 'string' || !v.model.trim()) {
    throw new ApiError(400, `${field} 要写成 { provider_id, model }`);
  }
  return { providerId: v.provider_id.trim(), model: v.model.trim() };
}

router.put(
  '/courses/:courseId/ai-feature-models',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const courseId = String(req.params.courseId);
    await ensureCourseInstructor(courseId, req.user!);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const patch: AiModelSettingsPatch = {};
    if (body.features !== undefined) {
      if (!body.features || typeof body.features !== 'object' || Array.isArray(body.features)) {
        throw new ApiError(400, 'features 要写成 { 功能: { provider_id, model } | null }');
      }
      patch.features = {};
      for (const [id, value] of Object.entries(body.features as Record<string, unknown>)) {
        if (!isAiFeatureId(id)) throw new ApiError(400, `不认识的功能：${id}`);
        patch.features[id] = value === null || value === 'auto' ? null : parseRefBody(value, `features.${id}`);
      }
    }
    if (body.partner_models !== undefined) {
      if (body.partner_models === null) {
        patch.partnerModels = null;
      } else if (Array.isArray(body.partner_models)) {
        patch.partnerModels = body.partner_models.slice(0, 100).map((v, i) => parseRefBody(v, `partner_models[${i}]`));
      } else {
        throw new ApiError(400, 'partner_models 要写成数组，或 null（不限）');
      }
    }
    if (body.picker_models !== undefined) {
      if (!body.picker_models || typeof body.picker_models !== 'object' || Array.isArray(body.picker_models)) {
        throw new ApiError(400, 'picker_models 要写成 { 入口: [{ provider_id, model }] | null }');
      }
      patch.pickerModels = {};
      for (const [surface, value] of Object.entries(body.picker_models as Record<string, unknown>)) {
        if (surface !== 'workspace_agent' && surface !== 'personal_agent') {
          throw new ApiError(400, `不认识的入口：${surface}`);
        }
        if (value === null) {
          patch.pickerModels[surface] = null;
        } else if (Array.isArray(value)) {
          patch.pickerModels[surface] = value.slice(0, 100).map((v, i2) => parseRefBody(v, `picker_models.${surface}[${i2}]`));
        } else {
          throw new ApiError(400, `picker_models.${surface} 要写成数组，或 null（不限）`);
        }
      }
    }

    const rows = await loadCourseAiRows(courseId).catch((err: Error) => { throw new ApiError(500, err.message); });
    const target = pickSettingsRow(rows);
    if (!target?.id) {
      throw new ApiError(404, 'No AI config found for this course — configure a provider first');
    }

    let next;
    try {
      next = applyAiModelSettingsPatch(settingsFromRows(rows), patch, rows);
    } catch (err) {
      if (err instanceof AiModelSettingsError) throw new ApiError(400, err.message);
      throw err;
    }

    const triggerSettings = {
      ...((target.trigger_settings && typeof target.trigger_settings === 'object') ? target.trigger_settings as Record<string, unknown> : {}),
      [AI_MODELS_SETTINGS_KEY]: serializeAiModelSettings(next),
    };
    const { error } = await supabase
      .from('teacher_ai_configs')
      .update({ trigger_settings: triggerSettings })
      .eq('id', target.id);
    if (error) throw new ApiError(500, error.message);

    const updatedRows = rows.map(r => (r.id === target.id ? { ...r, trigger_settings: triggerSettings } : r));
    res.json(aiFeatureModelsPayload(updatedRows));
  },
);

// ── AI Chat Proxy ─────────────────────────────────────────────

// ── Tavily Web Search ─────────────────────────────────────────

/**
 * POST /api/ai/search
 * Body: { course_id, query, search_depth?, max_results?, include_answer? }
 * Returns: { results: [{title, url, content, score}], answer? }
 * Requires tavily provider to be configured for the course.
 */
/**
 * POST /api/ai/speak — 把一段文字读出来（MiniMax T2A）。
 *
 * 用途是课堂无障碍与朗读复听：学生可以听自己的 Note、听同学的观点。
 * 直接回音频字节而不是 JSON 里塞 base64——一段 500 字的音频 base64 化
 * 要多占三分之一体积，还得前端再解一次。
 *
 * 按字符计费（turbo ¥2 / hd ¥3.5 每万字符），所以这里硬性截断，
 * 免得一次误调把整篇长文读掉。
 */
router.post('/ai/speak', verifyJWT, async (req: Request, res: Response) => {
  const { course_id, text, model, voice_id, speed } = req.body as {
    course_id?: string; text?: string; model?: string; voice_id?: string; speed?: number;
  };
  if (!course_id || !text?.trim()) throw new ApiError(400, 'course_id 和 text 是必填的');
  await ensureCourseMember(String(course_id), req.user!);

  const MAX_CHARS = 2000;
  const clipped = text.trim().slice(0, MAX_CHARS);

  const { data: config } = await supabase
    .from('teacher_ai_configs')
    .select('api_key_encrypted')
    .eq('course_id', course_id)
    .eq('provider_id', 'minimax')
    .maybeSingle();
  if (!config?.api_key_encrypted) throw new ApiError(400, '本课程未配置 MiniMax，无法合成语音。');

  const result = await synthesizeMinimaxSpeech({
    apiKey: decryptProviderApiKey(config.api_key_encrypted),
    text: clipped,
    model,
    voiceId: voice_id,
    speed,
  });
  if (!result.ok) throw new ApiError(502, result.error);

  res.setHeader('Content-Type', result.format === 'mp3' ? 'audio/mpeg' : `audio/${result.format}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Speech-Model', result.model);
  res.setHeader('X-Speech-Chars', String(result.charCount));
  res.send(result.audio);
});

router.post('/ai/search', verifyJWT, async (req: Request, res: Response) => {
  const { course_id, query, search_depth = 'basic', max_results = 5, include_answer = true } = req.body;

  if (!course_id || !query?.trim()) {
    throw new ApiError(400, 'course_id and query are required');
  }

  await ensureCourseMember(String(course_id), req.user!);

  const { data: config, error: configError } = await supabase
    .from('teacher_ai_configs')
    .select('api_key_encrypted, is_verified')
    .eq('course_id', course_id)
    .eq('provider_id', 'tavily')
    .single();

  if (configError || !config) {
    throw new ApiError(404, 'Tavily search is not configured for this course');
  }
  if (!config.api_key_encrypted) throw new ApiError(404, 'Tavily search is not configured for this course');

  const tavilyApiKey = decryptProviderApiKey(config.api_key_encrypted);
  const result = await callTavilySearch(tavilyApiKey, query, search_depth, max_results, include_answer);
  const spaceId = await resolvePrimarySpaceId(course_id);

  // Log usage
  await supabase.from('ai_interventions').insert({
    space_id: spaceId,
    user_id: req.user!.id,
    trigger_type: 'web_search',
    provider_id: 'tavily',
    model_name: 'tavily-search',
    input_context_summary: query.slice(0, 200),
    response_text: result.answer?.slice(0, 500) ?? '',
    visibility_scope: 'private',
  });

  res.json(result);
});

/**
 * 文档 AI 侧栏带来的上下文：文档标题、正在读的那段正文、这段对话最近几轮。都是学生自己界面上的东西，
 * 只拿来弄清楚要画什么（drawPlanner），截短后用，不存。
 */
export function clientDrawContext(raw: unknown): { background: string; history: DrawTurn[] } {
  if (!raw || typeof raw !== 'object') return { background: '', history: [] };
  const ctx = raw as { title?: unknown; text?: unknown; history?: unknown };
  const title = typeof ctx.title === 'string' ? ctx.title.trim().slice(0, 200) : '';
  const text = typeof ctx.text === 'string' ? ctx.text.trim().slice(0, 6000) : '';
  const history = (Array.isArray(ctx.history) ? ctx.history : [])
    .filter((m): m is { role?: unknown; content: string } => Boolean(m) && typeof (m as { content?: unknown }).content === 'string')
    .slice(-10)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content.slice(0, 1500) }))
    .filter(m => m.content.trim());
  const background = title || text
    ? [`The learner is reading the document "${title || 'untitled'}".`, text].filter(Boolean).join('\n')
    : '';
  return { background, history };
}

/**
 * POST /api/ai/draw-route — 这一句要不要画、是改上一张还是新画、画成哪种（drawJudge.routeDrawRequest）。
 * 笔记 AI 助手、对话式笔记、文档 AI 由前端决定走画图还是走对话，发之前先问这里；
 * 两个智能体对话在服务端自己判断。只在句子和图沾边、或上一轮刚画了图时才会真去问 Jev。
 * Body: { text, previous?: { request, caption, kind }, last_reply?, forced? }
 *   → { draw, mode, form, decided_by, route }（route 在画的时候原样带回来，记进元数据）
 */
router.post('/ai/draw-route', verifyJWT, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { text?: unknown; previous?: unknown; last_reply?: unknown; forced?: unknown };
  const text = String(body.text ?? '').trim().slice(0, 1200);
  const route = await routeDrawRequest(text, {
    previous: parsePreviousDrawing(body.previous),
    lastReply: typeof body.last_reply === 'string' ? body.last_reply.slice(0, 1200) : null,
    forced: body.forced === true,
  });
  res.json({ draw: route.draw, mode: route.mode, form: route.form, decided_by: route.decidedBy, route: drawRouteSummary(route) });
});

/**
 * POST /api/ai/image — 对话里要画图时直接出图，不经对话模型（要不要画由前端先问 /ai/draw-route）。
 * 先读上下文弄清楚要画什么（drawTurn.produceDrawing）；出图顺序按课程 AI 设置里的「生成图片」（默认 DMX）。
 * 给没有自己会话线程的对话界面用，目前是文档 AI 侧栏；笔记 AI 助手走 /note-conversations/:id/image，
 * 两个智能体对话在推流里出图。
 * Body: { course_id, prompt, feature?, context?: { title, text, history, previous? }, mode?, form?, route? }
 *   → { url, markdown, provider_id, model, caption, kind, drawing }（drawing 留给前端：下一句要改这张时带回来）
 */
router.post('/ai/image', verifyJWT, async (req: Request, res: Response) => {
  const { course_id, prompt: rawPrompt, feature, context, mode, form, route } = req.body as {
    course_id?: string; prompt?: string; feature?: string; context?: unknown; mode?: unknown; form?: unknown; route?: unknown;
  };
  const prompt = String(rawPrompt ?? '').trim().slice(0, 600);
  if (!course_id || !prompt) throw new ApiError(400, 'course_id 和 prompt 是必填的');
  const standing = await ensureCourseMember(String(course_id), req.user!);
  await assertDailyAiQuota(req.user!.id);

  const fromClient = clientDrawContext(context);
  const learner = isCourseStaff(standing)
    ? ''
    : await loadStudentLearningContext({ userId: req.user!.id, courseId: String(course_id), question: prompt }).catch(() => '');
  const previous = mode === 'edit' && context && typeof context === 'object'
    ? parsePreviousDrawing((context as { previous?: unknown }).previous)
    : null;
  const result = await produceDrawing({
    courseId: String(course_id),
    request: prompt,
    context: { ...fromClient, learner },
    previous,
    form: parseDrawForm(form),
    route: sanitizeRouteSummary(route),
  });
  if (!result.ok) throw new ApiError(502, result.error);

  const markdown = result.markdown;
  await supabase.from('ai_interventions').insert({
    space_id: await resolvePrimarySpaceId(String(course_id)),
    user_id: req.user!.id,
    trigger_type: feature === 'doc_ai' ? 'doc_ai_direct_image' : 'chat_direct_image',
    provider_id: result.provider,
    model_name: result.model,
    input_context_summary: prompt.slice(0, 200),
    response_text: result.url.slice(0, 500),
    visibility_scope: 'private',
  });

  res.json({
    url: result.url, markdown, provider_id: result.provider, model: result.model, caption: result.caption, kind: result.kind,
    drawing: result.kind === 'picture' ? { kind: 'picture', prompt: result.prompt } : { kind: 'diagram', diagram: result.diagram },
  });
});

/**
 * POST /api/ai/chat
 * Body: { course_id, provider_id, model, messages, system_prompt?, note_context?, use_web_search? }
 * Returns: { reply, provider_id, model, search_results? }
 */
router.post('/ai/chat', verifyJWT, async (req: Request, res: Response) => {
  const { course_id, provider_id: requestedProvider, model: requestedModel, messages, system_prompt, note_context, use_web_search, feature } = req.body;

  if (!course_id || !requestedProvider || !requestedModel || !messages?.length) {
    throw new ApiError(400, 'course_id, provider_id, model, messages are required');
  }

  // 400 对画布上那种「一句话加一个追问」的脚手架回复够用，但对着一份文档解释
  // 核心主张、还要引一段原文，中文两三百字就到顶了 —— 线上就出现过回答断在半句上。
  // 默认不变，由调用方按场景要更多。
  const maxTokens = Math.min(4000, Math.max(120, Number(req.body.max_tokens) || DEFAULT_MAX_TOKENS));

  await ensureCourseMember(String(course_id), req.user!);

  // C4: Daily usage limit enforcement
  await assertDailyAiQuota(req.user!.id);

  // Fetch teacher's API key for this course + provider ('auto' → the course's choice for this feature)
  const target = await resolveChatProxyTarget(String(course_id), String(requestedProvider), String(requestedModel), feature);
  const provider_id = target.providerId;
  const model = target.model;
  const config = target.config;

  const apiKey: string = decryptProviderApiKey(config.api_key_encrypted);
  if (!apiKey) throw new ApiError(404, `Provider "${provider_id}" is not configured for this course`);
  const endpointUrl: string | null = config.endpoint_url;

  // Optionally run Tavily web search and inject results
  let searchResults: { title: string; url: string; content: string; score: number }[] = [];
  if (use_web_search) {
    const { data: tavilyConfig } = await supabase
      .from('teacher_ai_configs')
      .select('api_key_encrypted, is_verified')
      .eq('course_id', course_id)
      .eq('provider_id', 'tavily')
      .single();

    if (tavilyConfig?.is_verified) {
      try {
        const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user')?.content ?? '';
        const tavilyApiKey = decryptProviderApiKey(tavilyConfig.api_key_encrypted);
        const tavilyResult = await callTavilySearch(tavilyApiKey, lastUserMsg, 'basic', 3, false);
        searchResults = tavilyResult.results ?? [];
      } catch {
        // Non-fatal: proceed without search results
      }
    }
  }

  // Build system context with optional note context and search results
  const systemContent = buildSystemPrompt(system_prompt, note_context, searchResults);

  let reply: string;

  try {
    switch (provider_id) {
      case 'openai':
      case 'deepseek':
      case 'dmx':
      case 'dmxapi':
      case 'moonshot':
      case 'doubao':
      case 'xai':
      case 'alibaba':
      case 'zhipu':
      case 'openrouter':
      case 'minimax':
        reply = await callOpenAICompatible(provider_id, model, messages, systemContent, apiKey, endpointUrl, maxTokens);
        break;
      case 'anthropic':
        reply = await callAnthropic(model, messages, systemContent, apiKey, maxTokens);
        break;
      case 'google':
        reply = await callGoogleGenAI(model, messages, systemContent, apiKey);
        break;
      case 'baidu':
        reply = await callBaidu(model, messages, systemContent, apiKey);
        break;
      default:
        throw new ApiError(400, `Unsupported provider: ${provider_id}`);
    }
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    console.error('[ai/chat] upstream error:', err.message);
    throw new ApiError(502, 'AI provider returned an error. Please try again.');
  }

  const spaceId = await resolvePrimarySpaceId(course_id);

  // C1: Estimate token usage for cost tracking
  const inputText = (system_prompt ?? '') + messages.map((m: any) => m.content ?? '').join('');
  const estInputTokens = Math.ceil(inputText.length / 3.5);
  const estOutputTokens = Math.ceil(reply.length / 3.5);

  await supabase.from('ai_interventions').insert({
    space_id: spaceId,
    user_id: req.user!.id,
    trigger_type: 'user_chat',
    provider_id,
    model_name: model,
    input_context_summary: messages.at(-1)?.content?.slice(0, 200) ?? '',
    response_text: reply.slice(0, 500),
    visibility_scope: 'private',
    trigger_context: {
      est_input_tokens: estInputTokens,
      est_output_tokens: estOutputTokens,
      est_total_tokens: estInputTokens + estOutputTokens,
    },
  });

  res.json({ reply, provider_id, model, search_results: searchResults.length > 0 ? searchResults : undefined });
});

/**
 * 通用对话代理要打哪家、哪个模型。
 * 调用方写明了厂商和模型就照办（和以前一样）；传 'auto' 时按请求里说明的功能
 * （文档 AI 助手、优化提问）取课程 AI 设置里的选择，没指定就按该功能的默认规则挑，
 * 正在冷却或并发已满的厂商往后排。
 */
async function resolveChatProxyTarget(courseId: string, providerId: string, model: string, feature: unknown): Promise<{
  providerId: string;
  model: string;
  config: { api_key_encrypted: string; endpoint_url: string | null };
}> {
  if (providerId !== 'auto' && model !== 'auto') {
    const { data: config, error } = await supabase
      .from('teacher_ai_configs')
      .select('api_key_encrypted, endpoint_url')
      .eq('course_id', courseId)
      .eq('provider_id', providerId)
      .single();
    if (error || !config || !config.api_key_encrypted) {
      throw new ApiError(404, `Provider "${providerId}" is not configured for this course`);
    }
    return { providerId, model, config: { api_key_encrypted: config.api_key_encrypted, endpoint_url: config.endpoint_url ?? null } };
  }

  const featureId: AiFeatureId = isAiFeatureId(feature) && CHAT_PROXY_FEATURES.has(feature) ? feature : 'doc_ai';
  const def = getAiFeature(featureId);
  const rows = await loadCourseAiRows(courseId).catch((err: Error) => { throw new ApiError(500, err.message); });
  const { rows: candidates, choice } = featureCandidateRows(featureId, rows);
  const [first] = orderConfigsByHealth(candidates);
  if (!first) throw new ApiError(404, 'No AI provider configured for this course');
  const pickedModel = choiceModelFor(choice, first.provider_id)
    ?? (isDmxProvider(first.provider_id) ? pickModel(def.dmxTier ?? 'fast') : defaultModelForRow(def, first));
  if (!pickedModel) throw new ApiError(404, 'No AI provider configured for this course');
  return {
    providerId: first.provider_id,
    model: pickedModel,
    config: { api_key_encrypted: String(first.api_key_encrypted), endpoint_url: first.endpoint_url ?? null },
  };
}

/** 走通用对话代理、可以传 'auto' 的功能 */
const CHAT_PROXY_FEATURES = new Set<AiFeatureId>(['doc_ai', 'prompt_refine']);

async function resolvePrimarySpaceId(courseId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('spaces')
    .select('id')
    .eq('course_id', courseId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data?.id ?? null;
}

// ── Provider implementations ──────────────────────────────────

function buildSystemPrompt(
  custom?: string,
  noteContext?: string,
  searchResults?: { title: string; url: string; content: string }[],
): string {
  const base = custom ??
    'You are a pedagogical mentor for students in a Knowledge Building platform. ' +
    'Help them develop their ideas by asking probing questions and providing conceptual scaffolding. ' +
    'Keep responses concise (under 200 words) and encouraging.';

  let prompt = base;
  if (noteContext) {
    prompt += `\n\nCurrent note context:\n${noteContext}`;
  }
  if (searchResults && searchResults.length > 0) {
    const snippets = searchResults
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 400)}`)
      .join('\n\n');
    prompt += `\n\nWeb search results (cite sources by number when relevant):\n${snippets}`;
  }
  return prompt;
}

async function callOpenAICompatible(
  providerId: string,
  model: string,
  messages: { role: string; content: string }[],
  systemContent: string,
  apiKey: string,
  endpointUrl: string | null,
  maxTokens: number = DEFAULT_MAX_TOKENS,
): Promise<string> {
  const endpoints: Record<string, string> = CHAT_ENDPOINTS;

  if (endpointUrl) await assertSafePublicUrl(endpointUrl);
  const url = endpointUrl ?? endpoints[providerId];

  const body = withDeepSeekOptions(providerId, model, {
    model,
    messages: [
      { role: 'system', content: systemContent },
      ...messages,
    ],
    max_tokens: maxTokens,
    temperature: 0.7,
  });

  const res = await aiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  // 推理模型（deepseek-v4-pro 等）把正文放在 reasoning_content，content 是空字符串
  // 而不是 null，?? 兜不住，直接读 content 会返回空回复。
  return extractChatContent(data, systemContent) ?? 'No response from AI.';
}

async function callBaidu(
  model: string,
  messages: { role: string; content: string }[],
  systemContent: string,
  apiKey: string,
): Promise<string> {
  // Baidu ERNIE uses access_token as query param; treat stored api_key as the access token
  const url = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${apiKey}`;

  const body = {
    messages: [
      { role: 'user', content: systemContent },
      { role: 'assistant', content: 'Understood. I will follow these instructions.' },
      ...messages,
    ],
  };

  const res = await aiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  if (data.error_code) {
    throw new Error(`Baidu API error ${data.error_code}: ${data.error_msg}`);
  }
  return data.result ?? 'No response from AI.';
}

async function callAnthropic(
  model: string,
  messages: { role: string; content: string }[],
  systemContent: string,
  apiKey: string,
  maxTokens: number = DEFAULT_MAX_TOKENS,
): Promise<string> {
  const body = {
    model,
    max_tokens: maxTokens,
    system: systemContent,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  const res = await aiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  return data.content?.[0]?.text ?? 'No response from AI.';
}

async function callGoogleGenAI(
  model: string,
  messages: { role: string; content: string }[],
  systemContent: string,
  apiKey: string,
): Promise<string> {
  // Convert to Google's format
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: { parts: [{ text: systemContent }] },
    contents,
    generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await aiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from AI.';
}

// ── Key Verification ──────────────────────────────────────────

async function verifyProviderKey(
  providerId: string,
  apiKey: string,
  endpointUrl?: string,
): Promise<boolean> {
  try {
    // Use a lightweight probe: list models or tiny completion
    switch (providerId) {
      case 'openai':
      case 'deepseek':
      case 'dmx':
      case 'dmxapi':
      case 'moonshot':
      case 'xai':
      case 'alibaba':
      case 'zhipu':
      case 'openrouter': {
        const endpoints: Record<string, string> = MODELS_ENDPOINTS;
        const url = endpointUrl
          ? endpointUrl.replace(/\/chat\/completions$/, '/models')
          : endpoints[providerId];
        const r = await aiFetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return r.ok;
      }
      case 'anthropic': {
        const r = await aiFetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        });
        return r.ok;
      }
      case 'google': {
        const r = await aiFetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        );
        return r.ok;
      }
      case 'minimax': {
        // MiniMax 没有 /v1/models，用一次最小对话探活。
        // 注意它即使 key 无效也可能回 HTTP 200，真正的状态在 base_resp.status_code 里。
        const r = await aiFetch(MINIMAX_ENDPOINTS.base + '/text/chatcompletion_v2', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'MiniMax-Text-01',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
        });
        if (!r.ok) return false;
        const body = await r.json().catch(() => null) as any;
        const code = body?.base_resp?.status_code;
        return code === undefined || code === 0;
      }
      case 'tavily': {
        const r = await aiFetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, query: 'test', max_results: 1 }),
        });
        return r.ok;
      }
      case 'baidu':
        // Baidu doesn't have a simple model listing endpoint; accept without verification
        return true;
      default:
        // For unknown/custom providers, accept without verification
        return true;
    }
  } catch {
    return false;
  }
}

// ── SSE Streaming Chat ────────────────────────────────────────

/**
 * POST /api/ai/chat/stream
 * Same body as /ai/chat, but returns an SSE stream of tokens.
 */
router.post('/ai/chat/stream', verifyJWT, async (req: Request, res: Response) => {
  const { course_id, provider_id: requestedProvider, model: requestedModel, messages, system_prompt, note_context, feature } = req.body;

  if (!course_id || !requestedProvider || !requestedModel || !messages?.length) {
    throw new ApiError(400, 'course_id, provider_id, model, messages are required');
  }

  await ensureCourseMember(String(course_id), req.user!);

  const target = await resolveChatProxyTarget(String(course_id), String(requestedProvider), String(requestedModel), feature);
  const provider_id = target.providerId;
  const model = target.model;
  const config = target.config;

  if (!config.api_key_encrypted) throw new ApiError(404, `Provider "${provider_id}" not configured`);

  const apiKey: string = decryptProviderApiKey(config.api_key_encrypted);
  const systemContent = buildSystemPrompt(system_prompt, note_context);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const { url, headers, body } = await buildStreamRequest(provider_id, model, messages, systemContent, apiKey, config.endpoint_url);

    const upstream = await aiFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.write(`data: ${JSON.stringify({ error: `HTTP ${upstream.status}: ${errText.slice(0, 200)}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (!upstream.body) {
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = (upstream.body as any).getReader();
    const decoder = new TextDecoder();
    let fullReply = '';
    let streamBuffer = '';

    const handleStreamLine = (line: string) => {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') return;
      try {
        const json = JSON.parse(line.slice(6));
        const token = extractStreamToken(provider_id, json);
        if (token) {
          fullReply += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      } catch {
        // Skip malformed lines
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split(/\r?\n/);
      streamBuffer = lines.pop() ?? '';
      for (const line of lines) {
        handleStreamLine(line);
      }
    }
    streamBuffer += decoder.decode();
    if (streamBuffer.trim()) {
      handleStreamLine(streamBuffer.trim());
    }

    res.write('data: [DONE]\n\n');
    res.end();

    const spaceId = await resolvePrimarySpaceId(course_id);
    void supabase.from('ai_interventions').insert({
      space_id: spaceId,
      user_id: req.user!.id,
      trigger_type: 'user_chat',
      provider_id,
      model_name: model,
      input_context_summary: messages.at(-1)?.content?.slice(0, 200) ?? '',
      response_text: fullReply.slice(0, 500),
      visibility_scope: 'private',
    });
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message ?? 'Stream error' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

async function buildStreamRequest(
  providerId: string,
  model: string,
  messages: { role: string; content: string }[],
  systemContent: string,
  apiKey: string,
  endpointUrl: string | null,
): Promise<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> {
  const openaiCompatEndpoints: Record<string, string> = CHAT_ENDPOINTS;

  if (providerId === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model,
        max_tokens: STREAM_MAX_TOKENS,
        stream: true,
        system: systemContent,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      },
    };
  }

  if (providerId === 'google') {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        system_instruction: { parts: [{ text: systemContent }] },
        contents,
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
      },
    };
  }

  // OpenAI-compatible (including baidu via compatible endpoint)
  if (endpointUrl) await assertSafePublicUrl(endpointUrl);
  const url = endpointUrl ?? openaiCompatEndpoints[providerId] ?? openaiCompatEndpoints.openai;
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: withDeepSeekOptions(providerId, model, {
      model,
      stream: true,
      messages: [{ role: 'system', content: systemContent }, ...messages],
      max_tokens: STREAM_MAX_TOKENS,
      temperature: 0.7,
    }),
  };
}

function extractStreamToken(providerId: string, json: any): string | null {
  if (providerId === 'anthropic') {
    if (json.type === 'content_block_delta') return json.delta?.text ?? null;
    return null;
  }
  if (providerId === 'google') {
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  }
  // OpenAI-compatible
  return json.choices?.[0]?.delta?.content ?? null;
}

// ── Chat History ─────────────────────────────────────────────

/**
 * GET /api/ai/history
 * Query: { space_id?, limit? }
 * Returns past AI chat interactions for the current user.
 */
// GET /api/ai/model-catalog — 前端教师设置页从这里取可选模型，不再各写一份
router.get('/ai/model-catalog', verifyJWT, async (_req: Request, res: Response) => {
  res.json(catalogSnapshot());
});

// GET /api/ai/gateway-stats — 并发闸门与模型健康度（排障用）
router.get('/ai/gateway-stats', verifyJWT, requireRole('teacher', 'admin'), async (_req: Request, res: Response) => {
  res.json({ gateway: gatewayStats(), router: routerStats() });
});

/**
 * POST /api/courses/:courseId/ai-probe — 真的打一遍，看哪些模型能用。
 *
 * 目录里写着的模型名，厂商可能已经下线、这个 key 也可能没开通。
 * 开课前跑一次，挂掉的当场进冷却，不会被排到学生头上。
 */
router.post('/courses/:courseId/ai-probe', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);

  const providerId = String(req.body?.provider_id ?? 'dmx');
  const models: string[] | undefined = Array.isArray(req.body?.models)
    ? req.body.models.map(String).slice(0, 60) : undefined;

  const { data: config } = await supabase
    .from('teacher_ai_configs')
    .select('api_key_encrypted, endpoint_url, enabled_models')
    .eq('course_id', courseId)
    .eq('provider_id', providerId)
    .maybeSingle();
  if (!config?.api_key_encrypted) throw new ApiError(400, `课程里没有配置 ${providerId} 的 key`);

  const endpoints: Record<string, string> = CHAT_ENDPOINTS;
  const endpoint = config.endpoint_url || endpoints[providerId];
  if (!endpoint) throw new ApiError(400, `不认识的厂商 ${providerId}`);

  const report = await probeProvider({
    providerId,
    endpoint,
    apiKey: decryptProviderApiKey(config.api_key_encrypted),
    models,
  });
  res.json(report);
});

/**
 * POST /api/courses/:courseId/ai-loadtest — 开课前压一遍。
 *
 * 用课程里**所有已配置**的 key（DMX / DeepSeek / GLM / Kimi …）轮流发 N 路并发，
 * 报告成功率、延迟分布和每把 key 分到多少。回答的是「一个班同时点会怎么样」。
 * 请求刻意做到最小，量的是链路容量，不是模型的生成速度。
 */
router.post('/courses/:courseId/ai-loadtest', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);
  await ensureCourseInstructor(courseId, req.user!);

  const concurrency = Math.min(Number(req.body?.concurrency) || 52, 200);
  const onlyProviders: string[] | null = Array.isArray(req.body?.providers)
    ? req.body.providers.map(String) : null;

  const { data: rows } = await supabase
    .from('teacher_ai_configs')
    .select('provider_id, api_key_encrypted, endpoint_url, enabled_models')
    .eq('course_id', courseId);

  const endpoints: Record<string, string> = CHAT_ENDPOINTS;
  // 压测用各家最快的那档：量链路，不量生成速度
  const fastModel: Record<string, string> = {
    dmx: 'glm-5.3-flash', dmxapi: 'glm-5.3-flash',
    zhipu: 'glm-5.3-flash', deepseek: 'deepseek-flash',
    moonshot: 'kimi-k3', alibaba: 'qwen3.8-flash',
  };

  const targets = (rows ?? [])
    .filter(r => r.api_key_encrypted && r.provider_id !== 'tavily')
    .filter(r => !onlyProviders || onlyProviders.includes(r.provider_id as string))
    .map(r => {
      const pid = r.provider_id as string;
      const enabled = Array.isArray(r.enabled_models) ? (r.enabled_models as string[]) : [];
      return {
        providerId: pid,
        endpoint: (r.endpoint_url as string) || endpoints[pid],
        apiKey: decryptProviderApiKey(r.api_key_encrypted as string),
        model: fastModel[pid] ?? enabled[0] ?? 'glm-5.3-flash',
      };
    })
    .filter(t => t.endpoint && t.apiKey);

  if (!targets.length) throw new ApiError(400, '这门课还没有配置任何可用的 AI key');

  const report = await loadTest({ targets, concurrency });
  res.json({ targets: targets.map(t => ({ provider: t.providerId, model: t.model })), ...report });
});

router.get('/ai/history', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const spaceId = req.query.space_id as string | undefined;

  let query = supabase
    .from('ai_interventions')
    .select('id, trigger_type, provider_id, model_name, input_context_summary, response_text, visibility_scope, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (spaceId) {
    query = query.eq('space_id', spaceId);
  }

  const { data, error } = await query;
  if (error) throw new ApiError(500, error.message);

  res.json({ history: data ?? [] });
});

// ── Usage Stats / Limits ─────────────────────────────────────

/**
 * GET /api/ai/usage
 * Query: { course_id }
 * Returns usage stats + remaining quota for the current user in a course.
 */
router.get('/ai/usage', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const courseId = req.query.course_id as string;

  if (!courseId) throw new ApiError(400, 'course_id is required');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [todayRes, totalRes, providerRes] = await Promise.all([
    supabase
      .from('ai_interventions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since),
    supabase
      .from('ai_interventions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase
      .from('ai_interventions')
      .select('provider_id, trigger_context')
      .eq('user_id', userId)
      .gte('created_at', since),
  ]);

  if (todayRes.error) throw new ApiError(500, todayRes.error.message);
  if (totalRes.error) throw new ApiError(500, totalRes.error.message);

  // C1: Aggregate estimated tokens from today's interactions
  let estTokensToday = 0;
  const providerCounts: Record<string, number> = {};
  for (const row of providerRes.data ?? []) {
    const ctx = row.trigger_context as Record<string, unknown> | null;
    if (ctx?.est_total_tokens) estTokensToday += Number(ctx.est_total_tokens);
    const pid = (row.provider_id as string) ?? 'unknown';
    providerCounts[pid] = (providerCounts[pid] ?? 0) + 1;
  }

  const dailyLimit = 100;
  res.json({
    usage: {
      today: todayRes.count ?? 0,
      total: totalRes.count ?? 0,
      daily_limit: dailyLimit,
      remaining: Math.max(0, dailyLimit - (todayRes.count ?? 0)),
      est_tokens_today: estTokensToday,
      provider_distribution: providerCounts,
    },
  });
});

// C3: Research data export — bulk export AI interactions + feedback lifecycle
router.get(
  '/courses/:courseId/research-export',
  verifyJWT,
  requireRole('teacher', 'admin'),
  async (req: Request, res: Response) => {
    const { courseId } = req.params;
    await ensureCourseInstructor(String(courseId), req.user!);

    const format = (req.query.format as string) || 'json';

    const { data: spaces } = await supabase
      .from('spaces')
      .select('id')
      .eq('course_id', courseId);
    const spaceIds = (spaces ?? []).map((s: any) => s.id);
    if (spaceIds.length === 0) return res.json({ interventions: [], feedbacks: [] });

    const [interventionsRes, feedbacksRes] = await Promise.all([
      supabase
        .from('ai_interventions')
        .select('*')
        .in('space_id', spaceIds)
        .order('created_at', { ascending: true })
        .limit(5000),
      supabase
        .from('note_ai_feedbacks')
        .select('*')
        .eq('course_id', courseId)
        .order('created_at', { ascending: true })
        .limit(5000),
    ]);

    const interventions = interventionsRes.data ?? [];
    const feedbacks = feedbacksRes.data ?? [];

    if (format === 'csv') {
      const csvRows = ['id,space_id,user_id,trigger_type,provider_id,model_name,created_at,response_text'];
      for (const row of interventions) {
        csvRows.push([
          row.id, row.space_id, row.user_id, row.trigger_type,
          row.provider_id, row.model_name, row.created_at,
          `"${(row.response_text ?? '').replace(/"/g, '""').slice(0, 200)}"`,
        ].join(','));
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=hakcc_research_export_${courseId.slice(0, 8)}.csv`);
      return res.send(csvRows.join('\n'));
    }

    res.json({ interventions, feedbacks });
  },
);

export default router;
