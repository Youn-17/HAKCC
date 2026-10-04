/**
 * 各厂商的接口地址，全站唯一一份。
 *
 * 这张表以前在 9 个文件里各写了一份，而且已经漂了：aiTriggerService 里的
 * zhipu 指向 `open.bigmodel.cn/api/paas/v4`，其余八处都是 `/api/coding/paas/v4`。
 * 课程配的是 GLM Coding Plan 的 key，走 paas/v4 会被拒——自动反馈那条链
 * 因此可能一直在静默失败。加个厂商要改 9 个地方，本身就是 bug 的土壤。
 */

/** 对话接口。教师在课程里填了 endpoint_url 就以那个为准。 */
export const CHAT_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  dmx: 'https://www.dmxapi.cn/v1/chat/completions',
  dmxapi: 'https://www.dmxapi.cn/v1/chat/completions',
  moonshot: 'https://api.moonshot.cn/v1/chat/completions',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  // Coding Plan 的 key 只认 /api/coding/paas/v4；普通 paas/v4 会 401。
  zhipu: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  minimax: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
  anthropic: 'https://api.anthropic.com/v1/messages',
};

/** 列模型清单的接口（探活、拉可用型号时用）。 */
export const MODELS_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/models',
  deepseek: 'https://api.deepseek.com/models',
  dmx: 'https://www.dmxapi.cn/v1/models',
  dmxapi: 'https://www.dmxapi.cn/v1/models',
  moonshot: 'https://api.moonshot.cn/v1/models',
  xai: 'https://api.x.ai/v1/models',
  alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
  zhipu: 'https://open.bigmodel.cn/api/coding/paas/v4/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
};

/** MiniMax 的非对话接口。生图和语音都不是 OpenAI 那套形状，得单独走。 */
export const MINIMAX_ENDPOINTS = {
  base: 'https://api.minimax.chat/v1',
  image: 'https://api.minimax.chat/v1/image_generation',
  t2a: 'https://api.minimax.chat/v1/t2a_v2',
  t2aAsync: 'https://api.minimax.chat/v1/t2a_async_v2',
  voiceDesign: 'https://api.minimax.chat/v1/voice_design',
  voiceClone: 'https://api.minimax.chat/v1/voice_clone',
} as const;

/**
 * MiniMax 的语音接口要在 query 上带 GroupId。它的 API key 本身是一个 JWT，
 * payload 里就有 GroupID，所以不必让教师再填一个字段——直接从 key 里取。
 * 取不到时返回 null，由调用方给出可读的错误，而不是发一个必然失败的请求。
 */
export function minimaxGroupIdFromKey(apiKey: string): string | null {
  const parts = apiKey.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const groupId = payload?.GroupID ?? payload?.GroupId ?? payload?.group_id;
    return groupId ? String(groupId) : null;
  } catch {
    return null;
  }
}

/**
 * 解析某厂商的对话接口。
 * override 是教师在课程配置里填的自定义地址（私有部署、代理等）。
 */
export function resolveChatEndpoint(providerId: string, override?: string | null): string | undefined {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  return CHAT_ENDPOINTS[providerId];
}
