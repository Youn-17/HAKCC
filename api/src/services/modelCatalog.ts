/**
 * 模型目录 —— 全平台唯一一份「有哪些模型可用」的清单。
 *
 * 以前这份清单散在三处：前端教师设置页写死一份、aiProviderConfig 的默认启用列表一份、
 * modelRouter 的任务分档一份。三份各自漂移，结果是默认启用列表里躺着
 * `claude-sonnet-4-5` 这种 DMX 根本不提供的名字 —— 学生点一次就失败一次，
 * 表现出来就是「AI 时好时坏」。
 *
 * 这里的模型名全部对照 DMXAPI 官方价目表（2026-09 抓取）核对过。
 * 顺序即优先级：前面的先用，失败了 modelRouter 会自动往后走。
 */

export interface ModelInfo {
  id: string;
  label: string;
  /** 适合干什么，教师设置页显示 */
  note?: string;
  /** 能读图 */
  vision?: boolean;
  /** 便宜、快，适合高频小任务 */
  fast?: boolean;
}

// ── DMX 聚合网关（一个 key 打通所有厂商）────────────────────────

export const DMX_TEXT_MODELS: ModelInfo[] = [
  // 国产旗舰：中文课堂的主力，性价比和稳定性都好
  { id: 'glm-5.3',        label: 'GLM-5.3（智谱旗舰）',    note: '中文理解最稳，课堂主力' },
  { id: 'glm-5.3-flash',  label: 'GLM-5.3 Flash',          note: '快且便宜，适合自动反馈', fast: true },
  { id: 'glm-5.2',        label: 'GLM-5.2',                note: '上一代旗舰，作为兜底' },
  { id: 'glm-4.7',        label: 'GLM-4.7',                note: '成本更低的稳定档' },
  { id: 'kimi-k3',        label: 'Kimi K3（月之暗面旗舰）', note: '长文本综合、读材料' },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7',              note: '推理与结构化输出' },
  { id: 'kimi-k2.6',      label: 'Kimi K2.6',              note: '均衡档' },
  { id: 'kimi-k2.5-thinking', label: 'Kimi K2.5 Thinking', note: '需要显式推理时用' },
  { id: 'deepseek-v4-pro',   label: 'DeepSeek V4 Pro',     note: '深度推理' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash',   note: '快速档', fast: true },
  { id: 'MiniMax-M3',     label: 'MiniMax M3',             note: '超长上下文（512k）' },
  { id: 'qwen3.8-max',    label: 'Qwen 3.8 Max',           note: '通义旗舰' },
  { id: 'qwen3.6-plus',   label: 'Qwen 3.6 Plus',          note: '均衡档' },
  { id: 'qwen3.8-flash',  label: 'Qwen 3.8 Flash',         note: '轻量快速', fast: true },
  { id: 'qwen3-8b',       label: 'Qwen3 8B',               note: '最便宜，评分类小任务', fast: true },
  // 海外前沿：贵，留给需要质量的场景
  { id: 'gpt-5.5',        label: 'GPT-5.5',                note: '英文写作与复杂推理' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6',       note: '长文本与细致反馈' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', note: '快速档', fast: true },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash',     note: '多模态快速档', fast: true },
  { id: 'gpt-5-mini',     label: 'GPT-5 mini',             note: '低成本英文任务', fast: true },
];

export const DMX_VISION_MODELS: ModelInfo[] = [
  { id: 'glm-4.6v',      label: 'GLM-4.6V（智谱视觉）', note: '看图说话、图表理解', vision: true },
  { id: 'glm-4.5v',      label: 'GLM-4.5V',             note: '视觉备用档', vision: true },
  { id: 'qwen3-vl-plus', label: 'Qwen3-VL Plus',        note: '通义视觉', vision: true },
  { id: 'qwen3-vl-8b-thinking', label: 'Qwen3-VL 8B Thinking', note: '轻量视觉推理', vision: true },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash',  note: '多模态兜底', vision: true },
];

/**
 * 生图梯队。2026-09-06 逐个实打 /v1/images/generations 重排过——
 * 原来配的 z-image-turbo / qwen-image-2.0 / doubao-seedream-5.0-lite 三个
 * 虽然在 DMX 的模型目录里列着，实际调用全是 404，导致生图功能整个哑掉，
 * 学生只会看到「所有生图模型都在冷却中」。只留实测能出图的。
 */
/**
 * 2026-10-09 实测：DMX 已经没有 qwen-image-plus 的通道（503 No available channel），通义的新图像模型在
 * /images/generations 上一律 404。豆包 Seedream 4.5 约 20 秒一张，最贴着描述画，图里的中文写得对（要求至少 2048×2048）；
 * gpt-image-2 当天 90 秒超时，排第二。都不行时 noteImage 会换 MiniMax。
 */
export const DMX_IMAGE_MODELS: ModelInfo[] = [
  { id: 'doubao-seedream-4-5-251128', label: '豆包 Seedream 4.5', note: '实测 20s，最贴着描述画，中文字写得对', fast: true },
  { id: 'gpt-image-2',     label: 'GPT Image 2',  note: '实测 22.6s，偶尔超时' },
];

/** 有尺寸下限的生图模型：Seedream 4.5 至少 3,686,400 像素，给小了直接 400 */
export const DMX_IMAGE_MIN_SIZE: Readonly<Record<string, string>> = { 'doubao-seedream-4-5-251128': '2048x2048' };

/** MiniMax 自有 key 的生图型号（minimaxMedia.ts）。2026-09-06 实测 image-01 35s、image-01-live 27s。 */
export const MINIMAX_IMAGE_MODELS: ModelInfo[] = [
  { id: 'image-01',      label: 'MiniMax image-01',      note: '实测 35s' },
  { id: 'image-01-live', label: 'MiniMax image-01-live', note: '实测 27s' },
];

// ── 各厂商自有 key（教师直接填厂商的 key 时可选的模型）──────────

export const NATIVE_MODELS: Record<string, ModelInfo[]> = {
  // 全部 8 个实测通过（Coding Plan key，2026-09-05）
  zhipu: [
    { id: 'glm-5.3',       label: 'GLM-5.3',       note: '旗舰，实测 1.4s' },
    { id: 'glm-5.2',       label: 'GLM-5.2',       note: '实测 1.4s' },
    { id: 'glm-4.6v',      label: 'GLM-4.6V（视觉）', note: '看图，实测 0.6s 最快', vision: true },
    { id: 'glm-4.5v',      label: 'GLM-4.5V（视觉）', vision: true },
    { id: 'glm-4.7',       label: 'GLM-4.7' },
    { id: 'glm-4.6',       label: 'GLM-4.6' },
    { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash', note: '快速档', fast: true },
    { id: 'glm-4.5-air',   label: 'GLM-4.5 Air',   note: '低成本', fast: true },
  ],
  // 实测（2026-09-05）：这把 Kimi key 只开通了 kimi-k3，
  // kimi-k2.5 / moonshot-v1-* / kimi-latest 一律 404「Not found the model or Permission denied」。
  // 想用别的型号要先在月之暗面控制台给这把 key 开权限，开完用 /ai-probe 复测再往这里加。
  // 其余 Kimi 型号仍可通过 DMX 聚合 key 使用（见 DMX_TEXT_MODELS）。
  // 2026-09-06 直接问 Moonshot /v1/models 拿到的清单，四个都实测调通。
  // k3 最贵也最慢（4.3s），日常对话没必要用它——k2.6 同为通用型，1.8s。
  moonshot: [
    { id: 'kimi-k2.6', label: 'Kimi K2.6', note: '通用主力，实测 1.8s', fast: true },
    { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code 高速', note: '编程题最快，实测 1.3s', fast: true },
    { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', note: '编程/结构化输出，实测 1.8s' },
    { id: 'kimi-k3', label: 'Kimi K3', note: '旗舰，实测 4.3s，贵，留给难题' },
  ],
  // 2026-09-10 直接问 api.deepseek.com/models：现在只剩两个正式名字。
  // 当天上线的 V4.1 Flash 顶替了 deepseek-v4-flash，API 名就叫 deepseek-flash，
  // 能读图（vision-exp 的能力并进来了）。旧名 deepseek-v4-flash /
  // deepseek-v4-flash-vision-exp / deepseek-chat / deepseek-reasoner 目前仍能调通，
  // 但官方错误信息只认这两个，归一化见 normalizeDeepSeekModel。
  // 注意 DMX 那边没有 deepseek-flash，仍叫 deepseek-v4-flash（同日实测 503 model_not_found）。
  deepseek: [
    { id: 'deepseek-flash',  label: 'DeepSeek Flash（V4.1）', note: '主力，能读图，实测 0.4–0.9s', fast: true, vision: true },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro',        note: '深度推理，实测 2–10s' },
  ],
  // MiniMax 自有 key。走 DMX 转发太慢，所以单独配。
  // 生图 image-01 / image-01-live 按张计费（¥0.025/张），语音按字符计费。
  minimax: [
    { id: 'MiniMax-Text-01', label: 'MiniMax Text 01', note: '通用对话' },
    { id: 'MiniMax-M2.7',    label: 'MiniMax M2.7',    note: '较新一代' },
    { id: 'abab6.5s-chat',   label: 'abab6.5s',        note: '轻量快速', fast: true },
  ],
  alibaba: [
    { id: 'qwen3.8-max',   label: 'Qwen 3.8 Max' },
    { id: 'qwen3.6-plus',  label: 'Qwen 3.6 Plus' },
    { id: 'qwen3.8-flash', label: 'Qwen 3.8 Flash', fast: true },
    { id: 'qwen3-vl-plus', label: 'Qwen3-VL Plus（视觉）', vision: true },
  ],
};

// ── 任务分档：modelRouter 按这个顺序做故障转移 ──────────────────

export const TASK_TIERS = {
  /** Agent 循环：要会用工具、能长上下文 */
  agent: ['glm-5.3', 'kimi-k3', 'deepseek-v4-pro', 'gpt-5.5', 'claude-opus-4-6', 'qwen3.8-max', 'MiniMax-M3'],
  /** 对话与反馈：中文课堂的主力 */
  chat: ['glm-5.3', 'kimi-k2.7-code', 'deepseek-v4-pro', 'glm-5.2', 'qwen3.6-plus', 'gpt-5.5', 'claude-opus-4-6'],
  /** 高频小任务（自动反馈判定、JSON 抽取）：只要快和便宜 */
  fast: ['glm-5.3-flash', 'qwen3.8-flash', 'deepseek-v4-flash', 'qwen3-8b', 'claude-haiku-4-5-20251001', 'gemini-2.5-flash'],
  vision: DMX_VISION_MODELS.map(m => m.id),
  image_gen: DMX_IMAGE_MODELS.map(m => m.id),
  embedding: ['qwen3-embedding-8b', 'qwen3.7-text-embedding'],
  search: ['qwen-flash-search', 'qwen-plus-search', 'qwen3-max-search'],
} as const;

/** 教师没做选择时，DMX 默认启用哪些。挑的是稳定 + 覆盖不同价位。 */
export const DMX_DEFAULT_MODELS = [
  'glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.5', 'glm-4.6v',
];

export function modelsForProvider(providerId: string): ModelInfo[] {
  if (providerId === 'dmx' || providerId === 'dmxapi') {
    return [...DMX_TEXT_MODELS, ...DMX_VISION_MODELS];
  }
  return NATIVE_MODELS[providerId] ?? [];
}

/** 给前端的目录快照。 */
export function catalogSnapshot() {
  return {
    dmx: { text: DMX_TEXT_MODELS, vision: DMX_VISION_MODELS, image: DMX_IMAGE_MODELS, defaults: DMX_DEFAULT_MODELS },
    native: NATIVE_MODELS,
    tiers: TASK_TIERS,
  };
}

// ── DeepSeek 名字归一化 ──────────────────────────────────────
//
// 官方 2026-04-24 宣布 deepseek-chat / deepseek-reasoner 于 07-24 下线，
// 2026-09-10 又把 flash 系列换成 deepseek-flash（V4.1）。数据库和旧对话记录里
// 还躺着这些旧名字，调用前统一换成现在能用的。DMX 聚合网关有自己的一套名字，
// 那边没有 deepseek-flash，所以按 provider 分开映射。

const DEEPSEEK_NATIVE_ALIASES: Record<string, string> = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
};

const DEEPSEEK_DMX_ALIASES: Record<string, string> = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-flash': 'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
};

export function normalizeDeepSeekModel(model: string, providerId: string = 'deepseek'): string {
  const table = providerId === 'dmx' || providerId === 'dmxapi' ? DEEPSEEK_DMX_ALIASES : DEEPSEEK_NATIVE_ALIASES;
  return table[model] ?? model;
}

// ── 教师启用的模型 ────────────────────────────────────────────
// 这几个函数原来在 aiProviderConfig / modelRouter 里。挪到这里是因为它们只查目录、
// 不碰密钥也不碰健康度，课程 AI 功能的模型解析（aiFeatureModels）要用，而那边
// 不能依赖路由测试里常被整体替换掉的 aiProviderConfig / modelRouter。

export function usesDeepSeekModelAliases(providerId: string): boolean {
  return providerId === 'deepseek' || providerId === 'dmx' || providerId === 'dmxapi';
}

export function defaultEnabledModels(providerId: string): string[] {
  if (providerId === 'dmx' || providerId === 'dmxapi') return [...DMX_DEFAULT_MODELS];
  const native = NATIVE_MODELS[providerId];
  if (native?.length) return native.slice(0, 4).map(m => m.id);
  return [];
}

export function normalizeEnabledModels(providerId: string, models: unknown): string[] {
  const rawModels = Array.isArray(models) ? models.filter((model): model is string => typeof model === 'string') : [];
  if (!usesDeepSeekModelAliases(providerId)) return rawModels;
  const normalized = Array.from(new Set(rawModels.map(m => normalizeDeepSeekModel(m, providerId))));
  return normalized.length ? normalized : defaultEnabledModels(providerId);
}

/**
 * 教师用厂商自有 key、模型没指定时用哪一个：按目录顺序挑第一个他启用了的。
 * 勾选列表里可能还是旧名字（deepseek-v4-flash 等），先换成现在的名字再比对，
 * 否则旧名字一个都对不上，会跳过 flash 直接落到 pro。
 */
export function preferredNativeModel(providerId: string, enabledModels: readonly string[] | null | undefined): string | null {
  const enabled = (Array.isArray(enabledModels) ? enabledModels : [])
    .map(m => providerId === 'deepseek' ? normalizeDeepSeekModel(m, providerId) : m);
  const preferred = (NATIVE_MODELS[providerId] ?? []).map(m => m.id);
  for (const m of preferred) {
    if (enabled.includes(m)) return m;
  }
  return enabled[0] ?? preferred[0] ?? null;
}

// ── 各家模型的怪脾气 ──────────────────────────────────────────
//
// 同一个 OpenAI 兼容端点，不同厂商对请求体的要求并不一致。实测踩到的：
//   qwen 系非流式调用必须显式 enable_thinking:false，否则 400；
//   kimi 的推理型号会把正文放在 reasoning_content，choices[].message.content 为空。
// 这些只能靠真打一遍才发现，所以修在这里，所有调用路径共用。

export function applyModelQuirks(
  model: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...body };
  const streaming = next.stream === true;

  // 通义千问：非流式必须关掉思考开关
  if (/^qwen/i.test(model) && !streaming && next.enable_thinking === undefined) {
    next.enable_thinking = false;
  }
  return next;
}

/**
 * 从 OpenAI 兼容的返回体里取正文。
 * 推理型号（kimi-k3、部分 thinking 型号）会把答案放在 reasoning_content，
 * content 是空串——只读 content 会误判成「模型坏了」。
 */
/** 与 finalAnswer.ts 共用同一套 <think> 规则，避免两处各写一份后走偏。 */
export function stripThinkBlocks(text: string): string {
  return text
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(think|thinking|reasoning)>[\s\S]*$/i, '')
    .trim();
}

/**
 * reasoning_content 是不是模型的内部推演（而不是答案）。
 *
 * 有的推理模型把**正文**放在 reasoning_content、content 留空，那种要用；
 * 但也有模型在推演里逐字复述系统提示词然后想「我该怎么回答」——那种直接呈给学生
 * 既看不懂，更糟的是**把我们的系统提示词泄露出去**（线上真实发生过：
 * 文档 AI 侧栏原样显示了 "Be concise. Prefer pointing the learner to..."）。
 *
 * 判据就用这一点：推演里出现了系统提示词的原文片段，它就是推演，不是答案。
 */
function looksLikeDeliberation(reasoning: string, systemPrompt?: string): boolean {
  if (!systemPrompt) return false;
  const flat = reasoning.replace(/\s+/g, ' ');
  // 逐句比对而不是按固定间隔采样：模型复述提示词时是整句照抄的，
  // 采样很容易正好错过被复述的那一句。
  const segments = systemPrompt
    .split(/\n+|(?<=[.。!！?？])\s+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 40)
    .slice(0, 24);
  return segments.some(line => flat.includes(line));
}

export function extractChatContent(json: unknown, systemPrompt?: string): string | null {
  const msg = (json as any)?.choices?.[0]?.message;
  if (!msg) return null;
  const raw = typeof msg.content === 'string' ? msg.content : '';
  // 有些厂商把思考过程包在 content 里的 <think> 标签中。那段从来不是答案，
  // 剥掉；剥完还有正文就用正文，剥成空的再走下面的兜底。
  const content = stripThinkBlocks(raw);
  if (content.trim()) return content;
  const reasoning = stripThinkBlocks(typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '');
  if (!reasoning.trim()) return null;
  // 是推演就当作「没有答案」，让调用方走失败路径 —— 呈现一段内部独白比报错更糟
  if (looksLikeDeliberation(reasoning, systemPrompt)) return null;
  return reasoning;
}
