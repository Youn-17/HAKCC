import {
  Atom, Binary, Bot, BrainCircuit, Globe, MessageSquareCode, MoonStar, Orbit, Search, Sparkles, Waves, Waypoints,
  type LucideIcon,
} from 'lucide-react';
import type { AiModelCatalog } from '../../../services/apiClient';

/**
 * 课程 AI 设置里可以配置的服务商（原来写在 Dashboard.tsx 里）。
 * 顺序就是「添加服务商」里的顺序：平台按任务自动挑模型时主要用前面几家，放在前面。
 */
export type ProviderMeta = {
  id: string;
  name: string;
  nameZh: string;
  icon: LucideIcon;
  /** 拿不到后端模型目录时的兜底清单 */
  models: string[];
  /** 这家自有 key 能画图的型号（兜底清单；以后端目录 nativeImage 为准） */
  imageModels?: string[];
  /** 配置时要注意的一句话（比如 Key 要建在哪个分组） */
  setupZh?: string;
  setupEn?: string;
  summaryEn: string;
  summaryZh: string;
};

export const ALL_PROVIDERS: ProviderMeta[] = [
  { id: 'dmx', name: 'DMXAPI', nameZh: 'DMXAPI 聚合', icon: Waypoints, models: ['glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.5', 'claude-opus-4-6', 'glm-4.6v'], summaryEn: 'One aggregator key; the course AI picks a model per task automatically.', summaryZh: '一个聚合 Key，课程 AI 会按任务自动挑模型。' },
  { id: 'deepseek', name: 'DeepSeek', nameZh: 'DeepSeek', icon: Waves, models: ['deepseek-flash', 'deepseek-v4-pro'], summaryEn: 'Fast, high-concurrency default for features students wait on.', summaryZh: '快、并发高，学生在等结果的功能默认先用它。' },
  { id: 'zhipu', name: 'ZhiPu', nameZh: '智谱清言', icon: Waypoints, models: ['glm-5.3', 'glm-5.2', 'glm-4.7', 'glm-4.6', 'glm-5.3-flash', 'glm-4.5-air', 'glm-4.6v', 'glm-4.5v'], summaryEn: 'GLM models with native tool calling.', summaryZh: '智谱 GLM 系列，原生支持工具调用。' },
  { id: 'minimax', name: 'MiniMax', nameZh: 'MiniMax 海螺', icon: Waves, models: ['MiniMax-M3', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.7', 'MiniMax-M3.1-Flash-Preview', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.1', 'MiniMax-M2.1-highspeed', 'MiniMax-M2', 'MiniMax-Text-01', 'abab6.5s-chat'], imageModels: ['image-01', 'image-01-live'], summaryEn: 'Chat models from M2 to M3, plus image generation (image-01) and speech, directly rather than through an aggregator.', summaryZh: '对话模型 M2 到 M3，另有生图（image-01）和语音合成，直连不经聚合商。' },
  { id: 'tavily', name: 'Tavily', nameZh: 'Tavily 网页搜索', icon: Search, models: [], summaryEn: 'Web evidence search for the course AI. The key stays on the server.', summaryZh: '给课程 AI 加上网页证据检索，Key 只存在后端。' },
  { id: 'apikeyfan', name: 'APIKEY.FAN · GPT', nameZh: 'APIKEY.FAN · GPT', icon: Sparkles,
    models: ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-6-astra'],
    imageModels: ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'],
    summaryEn: 'GPT chat models (GPT-6.1 Sol and others) and GPT image generation through the APIKEY.FAN relay.', summaryZh: '通过 APIKEY.FAN 中转用 GPT 对话模型（GPT-6.1 Sol 等）和 GPT 生图。',
    setupZh: '在 APIKEY.FAN 控制台建 Key 时分组选「Codex Pro（外接版）」。接口地址留空即可；专线 slb.apikey.fan 不能画图，填了专线的话，画图会自动改走 api.apikey.fan。',
    setupEn: 'Create the key in the "Codex Pro" group on APIKEY.FAN. Leave the endpoint empty; the slb.apikey.fan line cannot generate images, so images always go through api.apikey.fan.' },
  { id: 'apikeyfan-grok', name: 'APIKEY.FAN · Grok', nameZh: 'APIKEY.FAN · Grok', icon: Orbit,
    models: ['grok-4.7', 'grok-4.20-0309-non-reasoning', 'grok-4.5', 'grok-4.6', 'grok-4.3', 'grok-4.20-0309-reasoning', 'grok-4.20-multi-agent-0309', 'grok-4.7-build-fast', 'grok-build-0.1'],
    imageModels: ['grok-imagine-image', 'grok-imagine-image-quality'],
    summaryEn: 'Grok chat models (Grok 4.7 and others) and Grok image generation through the APIKEY.FAN relay.', summaryZh: '通过 APIKEY.FAN 中转用 Grok 对话模型（Grok 4.7 等）和 Grok 生图。',
    setupZh: '在 APIKEY.FAN 控制台建 Key 时分组选「Grok 企业版」，和 GPT 那把分开：一把 Key 只能用它所在分组的模型。',
    setupEn: 'Create the key in the "Grok enterprise" group on APIKEY.FAN, separate from the GPT key: a key only works with the models of its own group.' },
  { id: 'moonshot', name: 'Moonshot', nameZh: 'Kimi', icon: MoonStar, models: ['kimi-k3'], summaryEn: 'Long-context reading and synthesis.', summaryZh: '长上下文，适合阅读量大的课程。' },
  { id: 'alibaba', name: 'Alibaba', nameZh: '通义千问', icon: Atom, models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen3.8-omni-flash', 'qwen3-vl-plus'], imageModels: ['qwen-image-2.0', 'qwen-image-2.0-pro'], summaryEn: 'Qwen chat models (Alibaba Cloud Model Studio), plus Qwen Image generation.', summaryZh: '阿里云百炼的千问对话模型，另有千问图像生图。' },
  { id: 'openai', name: 'OpenAI', nameZh: 'ChatGPT', icon: Bot, models: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'], summaryEn: 'General-purpose reasoning.', summaryZh: '通用推理。' },
  { id: 'anthropic', name: 'Anthropic', nameZh: 'Claude', icon: BrainCircuit, models: ['claude-opus-4-6', 'claude-haiku-4-5-20251001'], summaryEn: 'Long-form explanation and careful feedback.', summaryZh: '长文解释和审慎的反馈。' },
  { id: 'google', name: 'Google', nameZh: 'Gemini', icon: Sparkles, models: ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro'], summaryEn: 'Fast multimodal support.', summaryZh: '快速的多模态支持。' },
  { id: 'doubao', name: 'Doubao', nameZh: '豆包', icon: MessageSquareCode, models: ['doubao-pro-4k', 'doubao-pro-32k'], summaryEn: 'Conversation-first, for light tasks.', summaryZh: '对话为主，适合轻量任务。' },
  { id: 'baidu', name: 'Baidu', nameZh: '文心一言', icon: Binary, models: ['ernie-4.0-8k', 'ernie-3.5-8k', 'ernie-speed-8k'], summaryEn: 'Chinese-first classrooms.', summaryZh: '中文优先的课堂。' },
  { id: 'xai', name: 'xAI', nameZh: 'Grok', icon: Orbit, models: ['grok-2', 'grok-beta'], summaryEn: 'Fast conversational ideation.', summaryZh: '快速的对话式发想。' },
  { id: 'openrouter', name: 'OpenRouter', nameZh: 'OpenRouter', icon: Globe, models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro'], summaryEn: 'One route to several model families.', summaryZh: '一个入口路由到多家模型。' },
];

export const providerById = (id: string) => ALL_PROVIDERS.find(p => p.id === id) ?? null;

export interface ProviderModelOption { id: string; label: string }

/** 这家能启用哪些模型：优先用后端模型目录（写死的清单和后端漂移过），拿不到才用兜底清单 */
export function providerModelOptions(provider: ProviderMeta, catalog: AiModelCatalog | null): ProviderModelOption[] {
  if (catalog) {
    if (provider.id === 'dmx' || provider.id === 'dmxapi') {
      const list = [...catalog.dmx.text, ...catalog.dmx.vision];
      if (list.length) return dedupe(list.map(m => ({ id: m.id, label: m.label || m.id })));
    }
    const native = catalog.native[provider.id];
    if (native?.length) return dedupe(native.map(m => ({ id: m.id, label: m.label || m.id })));
  }
  return provider.models.map(id => ({ id, label: id }));
}

/** 这家能画图的型号：配好 Key 就能用，在「各功能用哪个 AI」的「生成图片」里选 */
export function providerImageModels(provider: ProviderMeta, catalog: AiModelCatalog | null): ProviderModelOption[] {
  const fromCatalog = catalog?.nativeImage?.[provider.id];
  if (fromCatalog?.length) return dedupe(fromCatalog.map(m => ({ id: m.id, label: m.label || m.id })));
  return (provider.imageModels ?? []).map(id => ({ id, label: id }));
}

function dedupe(list: ProviderModelOption[]): ProviderModelOption[] {
  const seen = new Set<string>();
  return list.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}
