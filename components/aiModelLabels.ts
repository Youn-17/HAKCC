/**
 * 模型和厂商在界面上怎么叫，以及速度提示。
 *
 * 学生的模型下拉框以前直接显示「DeepSeek · deepseek-f…」这种原始 id，还被截断；
 * 教师的 AI 设置页要列出每个功能用哪个模型。两处都从这里取名字，叫法才一致。
 *
 * 速度提示只写实测过的（2026-09-05 四把 key 压测、2026-09-06 生图实测、2026-09-10
 * DeepSeek 单次实测），没测过的模型不给提示，不猜。
 */

export type Lang = 'zh' | 'en';

const PROVIDER_NAMES: Record<string, { zh: string; en: string }> = {
  deepseek: { zh: 'DeepSeek', en: 'DeepSeek' },
  zhipu: { zh: '智谱', en: 'Zhipu' },
  moonshot: { zh: 'Kimi', en: 'Kimi' },
  dmx: { zh: 'DMX 聚合', en: 'DMX' },
  dmxapi: { zh: 'DMX 聚合', en: 'DMX' },
  minimax: { zh: 'MiniMax', en: 'MiniMax' },
  alibaba: { zh: '通义千问', en: 'Qwen' },
  openai: { zh: 'OpenAI', en: 'OpenAI' },
  anthropic: { zh: 'Anthropic', en: 'Anthropic' },
  google: { zh: 'Google', en: 'Google' },
  doubao: { zh: '豆包', en: 'Doubao' },
  xai: { zh: 'xAI', en: 'xAI' },
  baidu: { zh: '文心一言', en: 'ERNIE' },
  openrouter: { zh: 'OpenRouter', en: 'OpenRouter' },
  tavily: { zh: 'Tavily', en: 'Tavily' },
  apikeyfan: { zh: 'APIKEY.FAN', en: 'APIKEY.FAN' },
  'apikeyfan-grok': { zh: 'APIKEY.FAN · Grok', en: 'APIKEY.FAN · Grok' },
  mineru: { zh: 'MinerU', en: 'MinerU' },
  local: { zh: '本平台服务器', en: 'This server' },
};

const MODEL_NAMES: Record<string, string | { zh: string; en: string }> = {
  'deepseek-flash': 'DeepSeek Flash',
  'deepseek-chat': 'DeepSeek Flash',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-flash-vision-exp': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-reasoner': 'DeepSeek V4 Pro',
  'glm-5.3': 'GLM-5.3',
  'glm-5.3-flash': 'GLM-5.3 Flash',
  'glm-5.2': 'GLM-5.2',
  'glm-4.7': 'GLM-4.7',
  'glm-4.6': 'GLM-4.6',
  'glm-4.6v': 'GLM-4.6V',
  'glm-4.5v': 'GLM-4.5V',
  'glm-4.5-air': 'GLM-4.5 Air',
  'kimi-k3': 'Kimi K3',
  'kimi-k2.6': 'Kimi K2.6',
  'kimi-k2.7-code': 'Kimi K2.7 Code',
  'kimi-k2.7-code-highspeed': { zh: 'Kimi K2.7 Code 高速', en: 'Kimi K2.7 Code Highspeed' },
  'kimi-k2.5-thinking': 'Kimi K2.5 Thinking',
  'gpt-6.1-sol': 'GPT-6.1 Sol',
  'gpt-6-sol': 'GPT-6 Sol',
  'gpt-6-astra': 'GPT-6 Astra',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5-mini': 'GPT-5 mini',
  'grok-4.7': 'Grok 4.7',
  'grok-4.7-build-fast': 'Grok 4.7 Build Fast',
  'grok-4.6': 'Grok 4.6',
  'grok-4.5': 'Grok 4.5',
  'grok-4.3': 'Grok 4.3',
  'grok-4.20-0309-reasoning': { zh: 'Grok 4.20（推理）', en: 'Grok 4.20 Reasoning' },
  'grok-4.20-0309-non-reasoning': { zh: 'Grok 4.20（不推理）', en: 'Grok 4.20 Non-reasoning' },
  'grok-4.20-multi-agent-0309': 'Grok 4.20 Multi-Agent',
  'grok-build-0.1': 'Grok Build 0.1',
  'gpt-image-2': 'GPT Image 2',
  'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst',
  'gpt-image-2.5-flare': 'GPT Image 2.5 Flare',
  'grok-imagine-image': 'Grok Imagine Image',
  'grok-imagine-image-quality': { zh: 'Grok Imagine Image（高质量）', en: 'Grok Imagine Image (quality)' },
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'qwen3.8-max': 'Qwen 3.8 Max',
  'qwen3.7-plus': 'Qwen 3.7 Plus',
  'qwen3.6-plus': 'Qwen 3.6 Plus',
  'qwen3.8-omni-flash': 'Qwen 3.8 Omni Flash',
  'qwen3.8-flash': 'Qwen 3.8 Flash',
  'qwen3-8b': 'Qwen3 8B',
  'qwen3-vl-plus': 'Qwen3-VL Plus',
  'qwen3-vl-8b-thinking': 'Qwen3-VL 8B Thinking',
  'qwen-image-plus': { zh: '通义万相 Plus', en: 'Qwen Image Plus' },
  'qwen-image-2.0': { zh: '千问图像 2.0', en: 'Qwen Image 2.0' },
  'qwen-image-2.0-pro': { zh: '千问图像 2.0 Pro', en: 'Qwen Image 2.0 Pro' },
  'doubao-seedream-4-5-251128': { zh: '豆包 Seedream 4.5', en: 'Seedream 4.5' },
  'MiniMax-M3': 'MiniMax M3',
  'MiniMax-M3.1-Flash-Preview': { zh: 'MiniMax M3.1 Flash（预览）', en: 'MiniMax M3.1 Flash (preview)' },
  'MiniMax-M2.7': 'MiniMax M2.7',
  'MiniMax-M2.7-highspeed': { zh: 'MiniMax M2.7 极速版', en: 'MiniMax M2.7 Highspeed' },
  'MiniMax-M2.5': 'MiniMax M2.5',
  'MiniMax-M2.5-highspeed': { zh: 'MiniMax M2.5 极速版', en: 'MiniMax M2.5 Highspeed' },
  'MiniMax-M2.1': 'MiniMax M2.1',
  'MiniMax-M2.1-highspeed': { zh: 'MiniMax M2.1 极速版', en: 'MiniMax M2.1 Highspeed' },
  'MiniMax-M2': 'MiniMax M2',
  'MiniMax-Text-01': 'MiniMax Text 01',
  'abab6.5s-chat': 'abab6.5s',
  'image-01': 'MiniMax image-01',
  'image-01-live': 'MiniMax image-01-live',
  'text-embedding-3-small': 'text-embedding-3-small',
  'tavily-search': { zh: 'Tavily 网页检索', en: 'Tavily web search' },
  mineru: { zh: 'MinerU 文档解析', en: 'MinerU parsing' },
  'pdf-parse': { zh: '在本平台服务器上提取文字', en: 'Text extraction on this server' },
};

const AGGREGATORS = new Set(['dmx', 'dmxapi', 'openrouter']);

export function providerDisplayName(providerId: string, lang: Lang = 'zh'): string {
  return PROVIDER_NAMES[providerId]?.[lang] ?? providerId;
}

/** 认得的模型给可读名字；认不得的（教师手填的自定义模型）原样显示 id，不瞎猜。 */
export function modelDisplayName(model: string, lang: Lang = 'zh'): string {
  const name = MODEL_NAMES[model];
  if (!name) return model;
  return typeof name === 'string' ? name : name[lang];
}

export function isKnownModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_NAMES, model);
}

/**
 * 下拉框里的一项：模型名本身带着品牌（DeepSeek Flash、GLM-5.3、Kimi K2.6），
 * 只在经聚合商转发（同一个 GLM-5.3 可能走智谱也可能走 DMX）或模型名认不得时补上厂商。
 */
export function modelOptionLabel(providerId: string, model: string, lang: Lang = 'zh'): string {
  const name = modelDisplayName(model, lang);
  if (!isKnownModel(model)) return `${providerDisplayName(providerId, lang)} · ${model}`;
  if (AGGREGATORS.has(providerId)) return lang === 'zh' ? `${name}（${providerDisplayName(providerId, lang)}）` : `${name} (${providerDisplayName(providerId, lang)})`;
  return name;
}

export type SpeedTone = 'fast' | 'medium' | 'slow';

export interface SpeedHint {
  tone: SpeedTone;
  /** 放在模型旁边的一句话 */
  text: string;
  /** 依据，放在 title 里 */
  detail: string;
}

const hint = (tone: SpeedTone, text: [string, string], detail: [string, string], lang: Lang): SpeedHint => ({
  tone,
  text: lang === 'zh' ? text[0] : text[1],
  detail: lang === 'zh' ? detail[0] : detail[1],
});

/** 不是对话/生图模型的（向量、检索、解析）：上面那些速度数字说的都不是它们 */
const NOT_GENERATION = new Set(['text-embedding-3-small', 'tavily-search', 'mineru', 'pdf-parse']);

/** 2026-10-11 用课程里的 key 单次实测（一句中文问答）的用时（秒）：APIKEY.FAN 的两个分组、千问（默认开思考时） */
const MEASURED_TEXT_SECONDS: Record<string, Record<string, number>> = {
  apikeyfan: { 'gpt-6.1-sol': 2.9, 'gpt-6-sol': 2.1, 'gpt-5.6-terra': 2.7, 'gpt-5.6-sol': 2.1, 'gpt-5.5': 1.7, 'gpt-6-astra': 4.9 },
  'apikeyfan-grok': {
    'grok-4.7': 3.8, 'grok-4.20-0309-non-reasoning': 0.9, 'grok-4.5': 3.7, 'grok-4.6': 10.1, 'grok-4.3': 2.7,
    'grok-4.20-0309-reasoning': 2.5, 'grok-4.20-multi-agent-0309': 3, 'grok-4.7-build-fast': 1.8, 'grok-build-0.1': 4.3,
  },
  alibaba: { 'qwen3.8-max': 3.1, 'qwen3.7-plus': 6.8, 'qwen3.8-flash': 2.2, 'qwen3.8-omni-flash': 1.5, 'qwen3-vl-plus': 0.9 },
};
const MEASURED_TEXT_DETAIL: Record<string, [string, string]> = {
  apikeyfan: ['2026-10-11 用课程里的 key 单次实测（一句中文问答），不是并发压测', 'single-call measurement on 2026-10-11 with the course key, not a concurrency test'],
  'apikeyfan-grok': ['2026-10-11 用课程里的 key 单次实测（一句中文问答），不是并发压测', 'single-call measurement on 2026-10-11 with the course key, not a concurrency test'],
  alibaba: ['2026-10-11 用课程里的 key 单次实测（一句中文问答，开着思考）；自动反馈这类快速任务会关思考，关掉后 1–2 秒', 'single-call measurement on 2026-10-11 with thinking on; quick tasks such as auto-feedback turn thinking off and take 1–2 s'],
};
/** 同一天实测一张图的用时（秒） */
const MEASURED_IMAGE_SECONDS: Record<string, Record<string, number>> = {
  apikeyfan: { 'gpt-image-2': 21, 'gpt-image-2.5-sunburst': 24, 'gpt-image-2.5-flare': 21 },
  'apikeyfan-grok': { 'grok-imagine-image': 6, 'grok-imagine-image-quality': 4 },
  alibaba: { 'qwen-image-2.0': 8 },
};

/** MiniMax 对话模型 2026-10-11 的单次实测用时（秒） */
const MINIMAX_TEXT_SECONDS: Record<string, number> = {
  'MiniMax-M3': 1.3, 'MiniMax-M3.1-Flash-Preview': 1.3, 'MiniMax-M2.7': 4.2, 'MiniMax-M2.7-highspeed': 2.3,
  'MiniMax-M2.5': 2.8, 'MiniMax-M2.5-highspeed': 2.3, 'MiniMax-M2.1': 1.4, 'MiniMax-M2.1-highspeed': 1.9,
  'MiniMax-M2': 3.5, 'MiniMax-Text-01': 0.6, 'abab6.5s-chat': 0.6,
};

/** 速度与并发提示。没有实测依据的返回 null。 */
export function modelSpeedHint(providerId: string, model: string, lang: Lang = 'zh'): SpeedHint | null {
  if (NOT_GENERATION.has(model)) return null;
  if (providerId === 'deepseek') {
    if (model === 'deepseek-v4-pro' || model === 'deepseek-reasoner') {
      return hint('slow', ['较慢，会深度思考', 'slower, thinks deeply'],
        ['单次实测 2–10 秒', 'measured 2–10 s per call'], lang);
    }
    return hint('fast', ['快，并发高', 'fast, high concurrency'],
      ['52 人同时用的压测里全部成功，这把 key 中位 0.2–0.7 秒', 'all 52 concurrent students succeeded; median 0.2–0.7 s on this key'], lang);
  }
  if (providerId === 'zhipu') {
    return hint('medium', ['中等，同时最多 6 路', 'medium, 6 at a time'],
      ['52 人压测中位 3.7–4.6 秒；这把 Coding Plan key 同时超过 6 路就报错', '52-student test median 3.7–4.6 s; this Coding Plan key rejects more than 6 at once'], lang);
  }
  if (providerId === 'moonshot') {
    if (model === 'kimi-k3') {
      return hint('slow', ['较慢，最贵', 'slower, most expensive'],
        ['单次实测 4.3 秒，四个 Kimi 型号里最慢最贵', 'measured 4.3 s per call; slowest and priciest Kimi model'], lang);
    }
    return hint('medium', ['中等，每分钟最多 100 次', 'medium, 100 per minute'],
      ['52 人压测中位 5.5–6.5 秒；这把 key 每分钟最多 100 次', '52-student test median 5.5–6.5 s; this key allows 100 requests a minute'], lang);
  }
  if (providerId === 'dmx' || providerId === 'dmxapi') {
    if (model === 'qwen-image-plus') {
      return hint('fast', ['约 6–8 秒一张', 'about 6–8 s per image'], ['2026-09-06 实测 6.2–8.3 秒', 'measured 6.2–8.3 s'], lang);
    }
    if (model === 'doubao-seedream-4-5-251128') {
      return hint('medium', ['约 20 秒一张', 'about 20 s per image'], ['2026-10-09 实测 20 秒，最贴着描述画', 'measured 20 s; follows the description most closely'], lang);
    }
    if (model === 'gpt-image-2') {
      return hint('slow', ['约 23 秒一张', 'about 23 s per image'], ['2026-09-06 实测 22.6 秒', 'measured 22.6 s'], lang);
    }
    return hint('slow', ['最慢', 'slowest'],
      ['52 人压测中位 10–17 秒，偶有断连，适合作溢出', '52-student test median 10–17 s with occasional dropped connections; best as overflow'], lang);
  }
  if (providerId === 'minimax') {
    const seconds = MINIMAX_TEXT_SECONDS[model];
    if (seconds) {
      return hint(seconds <= 1.5 ? 'fast' : seconds <= 3 ? 'medium' : 'slow', [`单次约 ${seconds} 秒`, `about ${seconds} s per call`],
        ['2026-10-11 用课程里的 key 单次实测（一句中文问答），不是并发压测', 'single-call measurement on 2026-10-11 with the course key, not a concurrency test'], lang);
    }
    if (model === 'image-01') {
      return hint('slow', ['约 35 秒一张', 'about 35 s per image'], ['2026-09-06 实测 35 秒', 'measured 35 s'], lang);
    }
    if (model === 'image-01-live') {
      return hint('slow', ['约 27 秒一张', 'about 27 s per image'], ['2026-09-06 实测 27 秒', 'measured 27 s'], lang);
    }
  }
  const seconds = MEASURED_TEXT_SECONDS[providerId]?.[model];
  if (seconds) {
    return hint(seconds <= 1.5 ? 'fast' : seconds <= 3 ? 'medium' : 'slow', [`单次约 ${seconds} 秒`, `about ${seconds} s per call`],
      MEASURED_TEXT_DETAIL[providerId], lang);
  }
  const imageSeconds = MEASURED_IMAGE_SECONDS[providerId]?.[model];
  if (imageSeconds) {
    return hint(imageSeconds <= 10 ? 'fast' : imageSeconds <= 25 ? 'medium' : 'slow', [`约 ${imageSeconds} 秒一张`, `about ${imageSeconds} s per image`],
      ['2026-10-11 用课程里的 key 实测一张', 'one image measured on 2026-10-11 with the course key'], lang);
  }
  return null;
}
