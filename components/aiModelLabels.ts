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
  'gpt-5.5': 'GPT-5.5',
  'gpt-5-mini': 'GPT-5 mini',
  'gpt-image-2': 'GPT Image 2',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'qwen3.8-max': 'Qwen 3.8 Max',
  'qwen3.6-plus': 'Qwen 3.6 Plus',
  'qwen3.8-flash': 'Qwen 3.8 Flash',
  'qwen3-8b': 'Qwen3 8B',
  'qwen3-vl-plus': 'Qwen3-VL Plus',
  'qwen3-vl-8b-thinking': 'Qwen3-VL 8B Thinking',
  'qwen-image-plus': { zh: '通义万相 Plus', en: 'Qwen Image Plus' },
  'MiniMax-M3': 'MiniMax M3',
  'MiniMax-M2.7': 'MiniMax M2.7',
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
    if (model === 'gpt-image-2') {
      return hint('slow', ['约 23 秒一张', 'about 23 s per image'], ['2026-09-06 实测 22.6 秒', 'measured 22.6 s'], lang);
    }
    return hint('slow', ['最慢', 'slowest'],
      ['52 人压测中位 10–17 秒，偶有断连，适合作溢出', '52-student test median 10–17 s with occasional dropped connections; best as overflow'], lang);
  }
  if (providerId === 'minimax') {
    if (model === 'image-01') {
      return hint('slow', ['约 35 秒一张', 'about 35 s per image'], ['2026-09-06 实测 35 秒', 'measured 35 s'], lang);
    }
    if (model === 'image-01-live') {
      return hint('slow', ['约 27 秒一张', 'about 27 s per image'], ['2026-09-06 实测 27 秒', 'measured 27 s'], lang);
    }
  }
  return null;
}
