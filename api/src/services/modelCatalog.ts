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
  /** 只认 Responses 接口：网关把 Chat Completions 请求转过去、再把回复转回来（responsesApi.ts） */
  api?: 'responses';
  /** 不能调工具：网关发请求前去掉 tools，模型照常直接回答 */
  noTools?: boolean;
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

/**
 * MiniMax 自有 key 的生图型号（minimaxMedia.ts）。2026-09-06 实测 image-01 35s、image-01-live 27s。
 * 2026-10-11 核对官方模型清单：MiniMax 的生图就这两个（其余是视频、语音、音乐）。
 */
export const MINIMAX_IMAGE_MODELS: ModelInfo[] = [
  { id: 'image-01',      label: 'MiniMax image-01',      note: '实测 35s' },
  { id: 'image-01-live', label: 'MiniMax image-01-live', note: '实测 27s' },
];

/**
 * 通义千问（阿里云百炼）自有 key 的生图型号（qwenImage.ts，走同步接口 multimodal-generation）。
 * 2026-10-11 按百炼文档接入（用户要加千问的 key），当天用课程 key 实测 2.0：1664×928 一张约 8 秒；2.0 Pro 没测。
 * 按张计费：2.0 约 0.2 元，2.0 Pro 约 0.5 元。
 */
export const QWEN_IMAGE_MODELS: ModelInfo[] = [
  { id: 'qwen-image-2.0',     label: '千问图像 2.0',     note: '加速版，实测约 8 秒，约 0.2 元/张', fast: true },
  { id: 'qwen-image-2.0-pro', label: '千问图像 2.0 Pro', note: '图里的文字、质感更好，约 0.5 元/张' },
];

/**
 * APIKEY.FAN 中转（2026-10-11 用户要配，先是 GPT 生图，接着要两个分组的全部模型）。一把 key 只能用它所在分组的模型，
 * 所以按分组拆成两家：「Codex Pro（外接版）」→ apikeyfan（GPT 对话 + GPT 生图）；「Grok 企业版」→ apikeyfan-grok
 * （Grok 对话 + Grok 生图）。对话走 /v1/chat/completions，生图走 /v1/images/generations（openAiImage.ts）。
 * 型号按 https://apikey.fan/pricing 两个分组的清单（2026-10-11）；文档 https://apikey.fan/docs。专线 slb 禁用生图。
 * 两个分组 2026-10-11 都用课程 key 实测过（用时写在各型号说明里）。
 * Grok 分组的 grok-4.20-multi-agent-0309 只能走 /v1/responses（Chat Completions 怎么发都是 400 upstream_error），
 * 一带 tools 也是 400：标了 api: 'responses' + noTools，由网关转换（responsesApi.ts）。
 * 另有两个视频模型（grok-imagine-video、-1.5），平台不生成视频，没接。
 * Grok 4.5 及以上每次多算 2000–3300 个输入 token（中转那边加的提示词），multi-agent 约 9000，4.3 和 4.20 没有。
 * 这个分组背后是一池 Grok 账号：实测中途出现过 429「Upstream rate limit exceeded」和 503「No healthy Grok OAuth account」。
 */
export const APIKEYFAN_IMAGE_MODELS: ModelInfo[] = [
  { id: 'gpt-image-2',            label: 'GPT Image 2',            note: '实测约 21 秒（1536×1024）' },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', note: '实测约 24 秒' },
  { id: 'gpt-image-2.5-flare',    label: 'GPT Image 2.5 Flare',    note: '实测约 21 秒' },
];
export const APIKEYFAN_GROK_IMAGE_MODELS: ModelInfo[] = [
  { id: 'grok-imagine-image',         label: 'Grok Imagine Image',         note: '实测约 6 秒，1280×720；1K 每张 ¥0.1', fast: true },
  { id: 'grok-imagine-image-quality', label: 'Grok Imagine Image（高质量）', note: '实测约 4 秒，1152×864；1K 每张 ¥0.15', fast: true },
];

/** APIKEY.FAN 的两个分组（对话 + 生图），接口地址按主机名拼（openAiImage.apikeyfanUrl） */
export const APIKEYFAN_PROVIDERS: ReadonlySet<string> = new Set(['apikeyfan', 'apikeyfan-grok']);

/** 各厂商自有 key 能用的生图型号（教师配这家时看得到，「生成图片」里可选） */
export const NATIVE_IMAGE_MODELS: Record<string, ModelInfo[]> = {
  minimax: MINIMAX_IMAGE_MODELS,
  alibaba: QWEN_IMAGE_MODELS,
  apikeyfan: APIKEYFAN_IMAGE_MODELS,
  'apikeyfan-grok': APIKEYFAN_GROK_IMAGE_MODELS,
};

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
  // 生图 image-01 / image-01-live 按张计费（¥0.025/张，见 MINIMAX_IMAGE_MODELS），语音按字符计费。
  // 2026-10-11 按官方现行清单补齐，用课程里那把 key 逐个实测（一句中文问答）全部调通。
  // M2 以后都是推理模型，推理过程在 reasoning_content；Text-01、abab6.5s 是老型号，不推理，最快。
  minimax: [
    { id: 'MiniMax-M3',                 label: 'MiniMax M3',                 note: '旗舰，百万上下文，实测 1.3s' },
    { id: 'MiniMax-M2.7-highspeed',     label: 'MiniMax M2.7 极速版',        note: '实测 2.3s', fast: true },
    { id: 'MiniMax-M2.7',               label: 'MiniMax M2.7',               note: '实测 4.2s' },
    { id: 'MiniMax-M3.1-Flash-Preview', label: 'MiniMax M3.1 Flash（预览）', note: '预览版，实测 1.3s', fast: true },
    { id: 'MiniMax-M2.5-highspeed',     label: 'MiniMax M2.5 极速版',        note: '实测 2.3s', fast: true },
    { id: 'MiniMax-M2.5',               label: 'MiniMax M2.5',               note: '实测 2.8s' },
    { id: 'MiniMax-M2.1',               label: 'MiniMax M2.1',               note: '实测 1.4s' },
    { id: 'MiniMax-M2.1-highspeed',     label: 'MiniMax M2.1 极速版',        note: '实测 1.9s', fast: true },
    { id: 'MiniMax-M2',                 label: 'MiniMax M2',                 note: '实测 3.5s' },
    { id: 'MiniMax-Text-01',            label: 'MiniMax Text 01',            note: '老型号，不推理，实测 0.6s', fast: true },
    { id: 'abab6.5s-chat',              label: 'abab6.5s',                   note: '老型号，不推理，实测 0.6s', fast: true },
  ],
  // 通义千问（阿里云百炼）自有 key，走 compatible-mode 兼容接口。2026-10-11 按百炼模型列表更新（用户要加千问的 key），
  // 还没有 key 实测：加上后在服务器上逐个打一遍（或 /ai-probe），调不通的删掉。生图见 QWEN_IMAGE_MODELS。
  // APIKEY.FAN「Codex Pro（外接版）」分组的对话模型（价格是 0.8x 倍率下每百万 token 输入/输出）。
  // 2026-10-11 用课程 key 单次实测：6 个都能对话、能看图（data URL 图片数人数全对），平台常用请求体（max_tokens、
  // temperature、非流式）都收；gpt-6.1-sol 试过流式、调工具、json_object 都正常。gpt-5.5 不在 /v1/models 里但能调。
  apikeyfan: [
    { id: 'gpt-6.1-sol',   label: 'GPT-6.1 Sol',   note: '最新，能看图；实测约 2.9 秒；¥1.6 / ¥8', vision: true },
    { id: 'gpt-6-sol',     label: 'GPT-6 Sol',     note: '能看图；实测约 2.1 秒；¥1.6 / ¥8', vision: true },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', note: '能看图；实测约 2.7 秒；¥1.6 / ¥9.6', vision: true },
    { id: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol',   note: '能看图；实测约 2.1 秒；¥4 / ¥24', vision: true },
    { id: 'gpt-5.5',       label: 'GPT-5.5',       note: '能看图；实测约 1.7 秒；¥4 / ¥24', vision: true },
    { id: 'gpt-6-astra',   label: 'GPT-6 Astra',   note: '最贵，能看图；实测约 4.9 秒；¥8 / ¥40', vision: true },
  ],
  // APIKEY.FAN「Grok 企业版」分组的对话模型（1x 倍率）。2026-10-11 用课程 key 单次实测（一句中文问答）；
  // grok-4.6 试过调工具、出 JSON 都正常。分组介绍推荐 grok-4.6 写代码，但它一句话要 10 秒，课堂上默认用 4.7。
  'apikeyfan-grok': [
    { id: 'grok-4.7',                     label: 'Grok 4.7',                     note: '最新，实测约 4 秒；¥2 / ¥6' },
    { id: 'grok-4.20-0309-non-reasoning', label: 'Grok 4.20（不推理）',          note: '最快，实测约 0.9 秒；¥1.25 / ¥2.5', fast: true },
    { id: 'grok-4.5',                     label: 'Grok 4.5',                     note: '实测约 3.7 秒；¥2 / ¥6' },
    { id: 'grok-4.6',                     label: 'Grok 4.6',                     note: '分组推荐写代码，实测约 10 秒；¥2 / ¥6' },
    { id: 'grok-4.3',                     label: 'Grok 4.3',                     note: '实测约 2.7 秒；¥1.25 / ¥2.5' },
    { id: 'grok-4.20-0309-reasoning',     label: 'Grok 4.20（推理）',            note: '实测约 2.5 秒；¥1.25 / ¥2.5' },
    { id: 'grok-4.20-multi-agent-0309',   label: 'Grok 4.20 Multi-Agent',        note: '多智能体，不能调工具；实测约 3 秒；¥1.25 / ¥2.5', api: 'responses', noTools: true },
    { id: 'grok-4.7-build-fast',          label: 'Grok 4.7 Build Fast',          note: '实测约 1.8 秒；¥4 / ¥12', fast: true },
    { id: 'grok-build-0.1',               label: 'Grok Build 0.1',               note: '最便宜，实测约 4.3 秒；¥1 / ¥2' },
  ],
  // 2026-10-11 用课程 key 单次实测（一句中文问答，默认开思考）；都能调工具。思考默认开着，而且 max_tokens 限不住推理，
  // 预算小的调用由 aiProviderConfig 关掉思考（关掉后 1–2 秒）。
  alibaba: [
    { id: 'qwen3.8-max',        label: 'Qwen 3.8 Max',        note: '通义旗舰，能看图；实测约 3 秒', vision: true },
    { id: 'qwen3.7-plus',       label: 'Qwen 3.7 Plus',       note: '均衡档，能看图；想得久，实测约 7 秒', vision: true },
    { id: 'qwen3.8-flash',      label: 'Qwen 3.8 Flash',      note: '快且便宜，实测约 2 秒', fast: true },
    { id: 'qwen3.8-omni-flash', label: 'Qwen 3.8 Omni Flash', note: '能看图、听音频，实测约 1.5 秒', vision: true, fast: true },
    { id: 'qwen3-vl-plus',      label: 'Qwen3-VL Plus（视觉）', note: '看图，实测约 1 秒', vision: true },
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
const ALL_CHAT_MODELS = (): ModelInfo[] => [...DMX_TEXT_MODELS, ...DMX_VISION_MODELS, ...Object.values(NATIVE_MODELS).flat()];

/** 只认 Responses 接口的模型（网关按这个把请求转过去） */
export const RESPONSES_API_MODELS: ReadonlySet<string> = new Set(ALL_CHAT_MODELS().filter(m => m.api === 'responses').map(m => m.id));

/** 不能调工具的模型（网关发请求前去掉 tools） */
export const NO_TOOLS_MODELS: ReadonlySet<string> = new Set(ALL_CHAT_MODELS().filter(m => m.noTools).map(m => m.id));

export function catalogSnapshot() {
  return {
    dmx: { text: DMX_TEXT_MODELS, vision: DMX_VISION_MODELS, image: DMX_IMAGE_MODELS, defaults: DMX_DEFAULT_MODELS },
    native: NATIVE_MODELS,
    nativeImage: NATIVE_IMAGE_MODELS,
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
