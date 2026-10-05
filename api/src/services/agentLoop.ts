/**
 * Agent Loop Engine — ReAct pattern for multi-step tool-calling AI agents.
 *
 * Implements:  think -> tool_call -> observe -> think -> ... -> final answer
 *
 * Provider-agnostic: works with all 12+ AI providers via OpenAI-compatible
 * format, with explicit handling for Anthropic, Google, and Baidu edge cases.
 */

import { randomUUID } from 'node:crypto';
import {
  withDeepSeekOptions,
  withFastChatOptions,
  usesDeepSeekModelAliases,
  normalizeDeepSeekModel,
} from './aiProviderConfig';
import { assertSafePublicUrl } from './urlGuard';
import { aiFetch } from './aiGateway';
import { CHAT_ENDPOINTS, MODELS_ENDPOINTS } from './providerEndpoints';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * OpenAI 的多模态消息体：content 可以是纯字符串，也可以是「文本块 + 图片块」的数组。
 * 学生传图给 AI 看时走后者。
 */
export type AgentContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export type AgentLoopMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | AgentContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: AgentToolCall[];
  /** DeepSeek 思考模式下带工具调用的 assistant 消息必须把推理原样传回，否则下一轮 400。 */
  reasoning_content?: string;
};

/** 把可能是数组的 content 压成纯文本。给只认字符串的地方用（日志、Anthropic 的 tool_result）。 */
export function flattenContent(content: AgentLoopMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => (part.type === 'text' ? part.text : '[图片]'))
    .join('\n');
}

/** 这条消息里带没带图。带了就得挑一个看得懂图的模型。 */
export function hasImageParts(messages: AgentLoopMessage[]): boolean {
  return messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'));
}

export type AgentToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type AgentLoopParams = {
  providerId: string;
  model: string;
  apiKey: string;
  endpointUrl?: string | null;
  systemPrompt: string;
  messages: AgentLoopMessage[];
  tools: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  executeToolFn: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ success: boolean; data: unknown; error?: string }>;
  maxIterations?: number;
  maxTokens?: number;
  temperature?: number;
  onToolCall?: (toolCall: AgentToolCall) => void;
  onToolResult?: (toolCallId: string, toolName: string, result: unknown) => void;
  onThinking?: (content: string) => void;
};

export type AgentLoopResult = {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
  iterations: number;
  finishReason: 'completed' | 'max_iterations' | 'error';
  error?: string;
  /** 回答写到 max_tokens 被截住后，接着写了几段（2026-10-05 起） */
  continuations?: number;
  /** 接着写到上限次数仍没写完 */
  truncated?: boolean;
};

export type AgentStreamEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; toolCall: AgentToolCall }
  | { type: 'tool_result'; toolCallId: string; toolName: string; result: unknown }
  | { type: 'token'; content: string }
  | { type: 'done'; result: AgentLoopResult }
  | { type: 'error'; error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_TOKENS = 8192;

/**
 * 回答写到 max_tokens 被截住时，接着写的那一句和最多接几段（2026-10-05 用户：输出要完整，不要硬截断）。
 * 回答长度只写在提示词里（answerLength.ts），max_tokens 只防跑飞；真撞上了就接着写。
 */
export const CONTINUE_PROMPT = 'Your previous reply was cut off by the length limit. Continue exactly where it stopped, without repeating anything, and finish the answer.';
export const MAX_CONTINUATIONS = 2;
const DEFAULT_TEMPERATURE = 0.7;
const TOOL_EXECUTION_TIMEOUT_MS = 15_000;

/**
 * 慢工具的单独上限。15 秒是给数据库读取那类工具定的，生成型的工具根本跑不完：
 * 生图实测 DMX qwen-image-plus 6–7s、MiniMax image-01 35s，后者在通用上限下
 * 100% 超时——「图片生成工具连续两次超时」就是这么来的。
 */
const SLOW_TOOL_TIMEOUT_MS: Record<string, number> = {
  generate_image: 150_000,
  generate_summary_doc: 60_000,
  export_notes: 60_000,
  build_embeddings: 120_000,
};

export function toolTimeoutMs(toolName: string): number {
  return SLOW_TOOL_TIMEOUT_MS[toolName] ?? TOOL_EXECUTION_TIMEOUT_MS;
}

// 整轮上限也要跟着抬：一次生图 35s 加上模型自己的两三轮，120s 会在最后一步被砍掉。
const TOTAL_LOOP_TIMEOUT_MS = 210_000;

/** Providers that speak plain OpenAI-compatible chat/completions. */
const OPENAI_COMPATIBLE_PROVIDERS = new Set([
  'openai',
  'deepseek',
  'dmx',
  'dmxapi',
  'moonshot',
  'doubao',
  'xai',
  'alibaba',
  'zhipu',
  'openrouter',
]);

/** Providers that do NOT support function calling natively. */
const NO_TOOL_PROVIDERS = new Set(['baidu']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely parse a JSON string into a Record; returns `{}` on failure. */
export function safeParseToolArgs(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Generate a unique tool-call ID. */
export function generateToolCallId(): string {
  return `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/**
 * Parse text-based tool calls from models that output XML-like tool call
 * syntax as content instead of using the API tool_calls field.
 * Handles formats like:
 *   <|DSML||tool_calls> ... <|DSML||invoke name="tool_name"> ...
 *   <tool_call> {"name": "tool_name", "arguments": {...}} </tool_call>
 *   ```tool_call\n{"name":"x","arguments":{...}}\n```
 */
export function parseTextToolCalls(
  text: string,
  availableToolNames: string[],
): { toolCalls: AgentToolCall[]; cleanedContent: string } {
  const toolCalls: AgentToolCall[] = [];
  let cleaned = text;

  // Pattern 1: DSML XML format. DeepSeek 原生的写法用的是全角竖线：
  //   <｜DSML｜calls> <｜DSML｜invoke name="x"> <｜DSML｜parameter name="p" string="true">v</｜DSML｜parameter> </｜DSML｜invoke> </｜DSML｜calls>
  // DMX 转发出来的又是半角 <|DSML||tool_calls>。2026-09-10 线上教学分析就把全角那种
  // 原样吐给了教师（此前只认半角 + tool_calls）。两种都收，缺尾标签也收。
  const dsmlPattern = /<\s*[|｜]{0,2}\s*DSML\s*[|｜]{0,2}\s*(?:tool_)?calls\s*>([\s\S]*?)(?:<\/\s*[|｜]{0,2}\s*DSML\s*[|｜]{0,2}\s*(?:tool_)?calls\s*>|$)/gi;
  let dsmlMatch;
  while ((dsmlMatch = dsmlPattern.exec(text)) !== null) {
    const block = dsmlMatch[1];
    const invokePattern = /invoke\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)(?=<\/\s*[|｜]{0,2}\s*DSML\s*[|｜]{0,2}\s*invoke|<\s*[|｜]{0,2}\s*DSML\s*[|｜]{0,2}\s*invoke|$)/gi;
    let invokeMatch;
    while ((invokeMatch = invokePattern.exec(block)) !== null) {
      const name = invokeMatch[1];
      if (!availableToolNames.includes(name)) continue;
      const paramsBlock = invokeMatch[2];
      const args: Record<string, unknown> = {};
      const paramPattern = /parameter\s+name\s*=\s*"([^"]+)"([^>]*)>([\s\S]*?)(?=<\/\s*[|｜]{0,2}\s*DSML\s*[|｜]{0,2}\s*parameter|<\s*[|｜]{0,2}\s*DSML\s*[|｜]{0,2}\s*parameter|$)/gi;
      let paramMatch;
      while ((paramMatch = paramPattern.exec(paramsBlock)) !== null) {
        const val = paramMatch[3].trim();
        const declaredString = /string\s*=\s*"true"/i.test(paramMatch[2]);
        args[paramMatch[1]] = declaredString ? val : val === 'true' ? true : val === 'false' ? false : val !== '' && !isNaN(Number(val)) ? Number(val) : val;
      }
      toolCalls.push({
        id: generateToolCallId(),
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      });
    }
    cleaned = cleaned.replace(dsmlMatch[0], '').trim();
    if (dsmlMatch[0].length === 0) break;
  }

  // Pattern 2: JSON tool_call blocks: <tool_call>{"name":"x","arguments":{...}}</tool_call>
  const jsonPattern = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi;
  let jsonMatch;
  while ((jsonMatch = jsonPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const name = parsed.name ?? parsed.function?.name;
      if (name && availableToolNames.includes(name)) {
        const args = parsed.arguments ?? parsed.parameters ?? parsed.function?.arguments ?? {};
        toolCalls.push({
          id: generateToolCallId(),
          type: 'function',
          function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
        });
      }
    } catch { /* skip malformed */ }
    cleaned = cleaned.replace(jsonMatch[0], '').trim();
  }

  // Pattern 3: ```tool_call\n{...}\n``` code blocks
  const codePattern = /```(?:tool_call|json)?\s*\n\s*(\{\s*"(?:name|function)"[\s\S]*?\})\s*\n\s*```/gi;
  let codeMatch;
  while ((codeMatch = codePattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(codeMatch[1]);
      const name = parsed.name ?? parsed.function?.name;
      if (name && availableToolNames.includes(name)) {
        const args = parsed.arguments ?? parsed.parameters ?? {};
        toolCalls.push({
          id: generateToolCallId(),
          type: 'function',
          function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
        });
      }
    } catch { /* skip */ }
    cleaned = cleaned.replace(codeMatch[0], '').trim();
  }

  return { toolCalls, cleanedContent: cleaned };
}

/** 正文一开头就是工具调用标记（模型把工具调用当文字吐了出来）。 */
export function looksLikeToolMarkupStart(lead: string): boolean {
  return /^<\s*[|｜]{0,2}\s*DSML/i.test(lead) || /^<tool_call>/i.test(lead) || /^```tool_call/i.test(lead);
}

/** 把没解析成功的工具调用标记从正文里剥掉，剩下的才能给人看。 */
export function stripToolMarkup(text: string): string {
  return text
    .replace(/<\/?\s*[|｜]{0,2}\s*DSML[^>]*>/gi, ' ')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, ' ')
    .replace(/```tool_call[\s\S]*?```/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Return the default API endpoint for a given provider. */
export function getProviderEndpoint(providerId: string): string {
  const endpoints: Record<string, string> = CHAT_ENDPOINTS;
  return endpoints[providerId] ?? endpoints.openai;
}

/** Whether `providerId` supports function-calling tools. */
function supportsTools(providerId: string): boolean {
  return !NO_TOOL_PROVIDERS.has(providerId);
}

/** Wrap a promise with a timeout. */
// ── 同一轮里重复的工具调用 ───────────────────────────────────────
//
// 2026-09-10 备课助手实测：search_notes 连打四次、学情分析 class_analytics 连打三次，
// 参数一模一样。每次都真执行一遍，慢的工具（检索、分析）就白白再等一次。
// 同名同参且上一次成功的调用，直接把上次的结果原样回给模型；失败的不缓存，允许它重试一次。

function toolCallKey(name: string, args: Record<string, unknown>): string {
  const sorted = Object.keys(args).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = args[k]; return acc; }, {});
  return `${name}:${JSON.stringify(sorted)}`;
}

type ToolOutcome = { success: boolean; data: unknown; error?: string };

async function executeToolOnce(
  cache: Map<string, ToolOutcome>,
  executeToolFn: AgentLoopParams['executeToolFn'],
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<ToolOutcome & { repeated?: boolean }> {
  const key = toolCallKey(toolName, toolArgs);
  const prior = cache.get(key);
  if (prior) return { ...prior, repeated: true };
  let outcome: ToolOutcome;
  try {
    outcome = await withTimeout(executeToolFn(toolName, toolArgs), toolTimeoutMs(toolName), `Tool "${toolName}"`);
  } catch (err) {
    outcome = { success: false, data: null, error: err instanceof Error ? err.message : 'Tool execution failed' };
  }
  if (outcome.success) cache.set(key, outcome);
  return outcome;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// Provider format converters
// ---------------------------------------------------------------------------

/** Convert OpenAI tool definitions to Anthropic format. */
function toolsToAnthropic(
  tools: AgentLoopParams['tools'],
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/** Convert OpenAI messages to Anthropic format (system extracted separately). */
function messagesToAnthropic(
  messages: AgentLoopMessage[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // system is sent separately
    if (msg.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: flattenContent(msg.content),
          },
        ],
      });
    } else if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const content: Array<Record<string, unknown>> = [];
      const assistantText = flattenContent(msg.content);
      if (assistantText) content.push({ type: 'text', text: assistantText });
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: safeParseToolArgs(tc.function.arguments),
        });
      }
      out.push({ role: 'assistant', content });
    } else if (Array.isArray(msg.content)) {
      // Anthropic 的图片块形状和 OpenAI 不同：data: URL 要拆成 base64 + media_type。
      out.push({
        role: msg.role,
        content: msg.content.map(part => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
          if (match) {
            return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
          }
          return { type: 'image', source: { type: 'url', url: part.image_url.url } };
        }),
      });
    } else {
      out.push({ role: msg.role, content: msg.content ?? '' });
    }
  }
  return out;
}

/** Parse Anthropic response into our standard format. */
function parseAnthropicResponse(data: any): {
  content: string | null;
  toolCalls: AgentToolCall[];
  truncated: boolean;
} {
  const contentBlocks: any[] = data.content ?? [];
  let text = '';
  const toolCalls: AgentToolCall[] = [];
  for (const block of contentBlocks) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id ?? generateToolCallId(),
        type: 'function',
        function: {
          name: block.name,
          arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
        },
      });
    }
  }
  return { content: text || null, toolCalls, truncated: data.stop_reason === 'max_tokens' };
}

/** Convert OpenAI tool definitions to Google functionDeclarations. */
function toolsToGoogle(
  tools: AgentLoopParams['tools'],
): Array<{ functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }> }> {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    },
  ];
}

/** Convert OpenAI messages to Google contents format. */
function messagesToGoogle(
  messages: AgentLoopMessage[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'tool') {
      out.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: msg.tool_call_id ?? 'unknown',
              response: { result: msg.content ?? '' },
            },
          },
        ],
      });
    } else if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: safeParseToolArgs(tc.function.arguments),
          },
        });
      }
      out.push({ role: 'model', parts });
    } else {
      out.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content ?? '' }],
      });
    }
  }
  return out;
}

/** Parse Google response into our standard format. */
function parseGoogleResponse(data: any): {
  content: string | null;
  toolCalls: AgentToolCall[];
  truncated: boolean;
} {
  const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
  let text = '';
  const toolCalls: AgentToolCall[] = [];
  for (const part of parts) {
    if (part.text) {
      text += part.text;
    } else if (part.functionCall) {
      toolCalls.push({
        id: generateToolCallId(),
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
    }
  }
  return { content: text || null, toolCalls, truncated: data.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
}

// ---------------------------------------------------------------------------
// Provider call — non-streaming (tool planning phase)
// ---------------------------------------------------------------------------

type ProviderCallParams = {
  providerId: string;
  model: string;
  apiKey: string;
  endpointUrl?: string | null;
  messages: AgentLoopMessage[];
  tools: AgentLoopParams['tools'];
  maxTokens: number;
  temperature: number;
  stream?: boolean;
};

type ProviderCallResult = {
  content: string | null;
  toolCalls: AgentToolCall[];
  reasoning?: string;
  /** 厂商说写到 max_tokens 停的（finish_reason=length 之类） */
  truncated?: boolean;
};

/**
 * Kimi 原厂 key 只接受 temperature=1，传别的直接 400「invalid temperature: only 1 is allowed」。
 * 起初只在 k2.7 上撞到，2026-09-08 的日志里 kimi-k2.6 也是同一条错误连续十几次，
 * 每次都要白白切一家再答。月之暗面全系都按 1 传。其余厂商照常。
 */
export function providerTemperature(providerId: string, model: string, temperature: number): number {
  if (providerId === 'moonshot' && /^kimi-/i.test(model)) return 1;
  return temperature;
}

async function callProviderWithTools(params: ProviderCallParams): Promise<ProviderCallResult> {
  const {
    providerId,
    model,
    apiKey,
    endpointUrl,
    messages,
    tools,
    maxTokens,
  } = params;
  const temperature = providerTemperature(providerId, model, params.temperature);

  // --- Anthropic ---
  if (providerId === 'anthropic') {
    return callAnthropicWithTools(model, apiKey, messages, tools, maxTokens, temperature);
  }

  // --- Google ---
  if (providerId === 'google') {
    return callGoogleWithTools(model, apiKey, messages, tools, maxTokens, temperature);
  }

  // --- Baidu (no tool support) ---
  if (NO_TOOL_PROVIDERS.has(providerId)) {
    return callOpenAICompatibleNoTools(providerId, model, apiKey, endpointUrl, messages, maxTokens, temperature);
  }

  // --- OpenAI-compatible (all others) ---
  return callOpenAICompatibleWithTools(providerId, model, apiKey, endpointUrl, messages, tools, maxTokens, temperature);
}

async function callAnthropicWithTools(
  model: string,
  apiKey: string,
  messages: AgentLoopMessage[],
  tools: AgentLoopParams['tools'],
  maxTokens: number,
  temperature: number,
): Promise<ProviderCallResult> {
  const systemContent = messages.find((m) => m.role === 'system')?.content ?? '';
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemContent,
    messages: messagesToAnthropic(nonSystemMessages),
  };
  if (tools.length > 0) {
    body.tools = toolsToAnthropic(tools);
  }

  const response = await aiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    console.error(`Anthropic API error (${response.status}):`, errText);
    throw new Error(`AI service error (${response.status})`);
  }

  const data = await response.json() as any;
  return { ...parseAnthropicResponse(data), reasoning: undefined };
}

async function callGoogleWithTools(
  model: string,
  apiKey: string,
  messages: AgentLoopMessage[],
  tools: AgentLoopParams['tools'],
  maxTokens: number,
  temperature: number,
): Promise<ProviderCallResult> {
  const systemContent = messages.find((m) => m.role === 'system')?.content ?? '';
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemContent }] },
    contents: messagesToGoogle(nonSystemMessages),
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (tools.length > 0) {
    body.tools = toolsToGoogle(tools);
  }

  const response = await aiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    console.error(`Google AI API error (${response.status}):`, errText);
    throw new Error(`AI service error (${response.status})`);
  }

  const data = await response.json() as any;
  return { ...parseGoogleResponse(data), reasoning: undefined };
}

async function callOpenAICompatibleWithTools(
  providerId: string,
  model: string,
  apiKey: string,
  endpointUrl: string | null | undefined,
  messages: AgentLoopMessage[],
  tools: AgentLoopParams['tools'],
  maxTokens: number,
  temperature: number,
): Promise<ProviderCallResult> {
  if (endpointUrl) await assertSafePublicUrl(endpointUrl);
  const url = endpointUrl ?? getProviderEndpoint(providerId);

  const resolvedModel = usesDeepSeekModelAliases(providerId) ? normalizeDeepSeekModel(model, providerId) : model;

  const requestBody: Record<string, unknown> = {
    model: resolvedModel,
    messages: messages.map((m) => {
      const entry: Record<string, unknown> = { role: m.role, content: m.content ?? '' };
      if (m.tool_call_id) entry.tool_call_id = m.tool_call_id;
      if (m.tool_calls?.length) entry.tool_calls = m.tool_calls;
      if (providerId === 'deepseek' && m.role === 'assistant' && m.reasoning_content) entry.reasoning_content = m.reasoning_content;
      return entry;
    }),
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };

  if (tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = 'auto';
  }

  let body = withDeepSeekOptions(providerId, model, requestBody);
  // 工具规划轮（决定调哪些工具）不值得深想：2026-09-10 实测 deepseek-flash 在线上那份
  // 长系统提示词下每轮推理 6–9s，一次学情分析五轮就是 30s。这里压到 low，
  // 最终作答那一轮（streamOpenAICompatibleFinalAnswer）仍用默认档。
  if (providerId === 'deepseek' && tools.length > 0 && resolvedModel === 'deepseek-flash' && (body as any).thinking?.type !== 'disabled') {
    body = { ...body, reasoning_effort: 'low' };
  }

  const response = await aiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    console.error(`Provider ${providerId} API error (${response.status}):`, errText);
    throw new Error(`AI service error (${response.status})`);
  }

  const data = await response.json() as any;
  const choice = data.choices?.[0];
  const msg = choice?.message;

  const toolCalls: AgentToolCall[] = Array.isArray(msg?.tool_calls)
    ? msg.tool_calls
      .filter((tc: any) => tc?.id && tc?.function?.name)
      .map((tc: any) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments ?? '{}',
        },
      }))
    : [];

  // Extract reasoning_content for DeepSeek reasoning models
  const reasoning = msg?.reasoning_content ?? msg?.reasoning ?? undefined;

  return {
    content: msg?.content ?? null,
    toolCalls,
    reasoning,
    truncated: choice?.finish_reason === 'length',
  };
}

async function callOpenAICompatibleNoTools(
  providerId: string,
  model: string,
  apiKey: string,
  endpointUrl: string | null | undefined,
  messages: AgentLoopMessage[],
  maxTokens: number,
  temperature: number,
): Promise<ProviderCallResult> {
  if (endpointUrl) await assertSafePublicUrl(endpointUrl);
  const url = endpointUrl ?? getProviderEndpoint(providerId);

  const response = await aiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => {
        const entry: Record<string, unknown> = { role: m.role, content: m.content ?? '' };
        if (m.tool_call_id) entry.tool_call_id = m.tool_call_id;
        if (m.tool_calls?.length) entry.tool_calls = m.tool_calls;
        return entry;
      }),
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    console.error(`Provider ${providerId} API error (${response.status}):`, errText);
    throw new Error(`AI service error (${response.status})`);
  }

  const data = await response.json() as any;
  return {
    content: data.choices?.[0]?.message?.content ?? null,
    toolCalls: [],
    truncated: data.choices?.[0]?.finish_reason === 'length',
  };
}

// ---------------------------------------------------------------------------
// Provider call — streaming (final answer only)
// ---------------------------------------------------------------------------

async function* streamProviderFinalAnswer(params: {
  providerId: string;
  model: string;
  apiKey: string;
  endpointUrl?: string | null;
  messages: AgentLoopMessage[];
  maxTokens: number;
  temperature: number;
  /** 关掉混合推理模型的思考（DeepSeek / GLM）。长篇结构化输出用：立刻出字，预算全给正文。 */
  disableThinking?: boolean;
  /** 本轮可用的工具。最终作答时仍把它们带上并设 tool_choice=none，模型才不会把调用写成文字。 */
  tools?: AgentLoopParams['tools'];
}): AsyncGenerator<{ type: 'token' | 'reasoning'; content: string }> {
  const { providerId, model, apiKey, endpointUrl, messages, maxTokens, disableThinking, tools } = params;
  const temperature = providerTemperature(providerId, model, params.temperature);

  // --- Anthropic streaming ---
  if (providerId === 'anthropic') {
    yield* streamAnthropicFinalAnswer(model, apiKey, messages, maxTokens, temperature);
    return;
  }

  // --- Google streaming ---
  if (providerId === 'google') {
    yield* streamGoogleFinalAnswer(model, apiKey, messages, maxTokens, temperature);
    return;
  }

  // --- OpenAI-compatible streaming ---
  yield* streamOpenAICompatibleFinalAnswer(providerId, model, apiKey, endpointUrl, messages, maxTokens, temperature, disableThinking, tools);
}

async function* streamAnthropicFinalAnswer(
  model: string,
  apiKey: string,
  messages: AgentLoopMessage[],
  maxTokens: number,
  temperature: number,
): AsyncGenerator<{ type: 'token' | 'reasoning'; content: string }> {
  const systemContent = messages.find((m) => m.role === 'system')?.content ?? '';
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const response = await aiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      system: systemContent,
      messages: messagesToAnthropic(nonSystemMessages),
    }),
  });

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    console.error(`Anthropic streaming error (${response.status}):`, errText);
    throw new Error(`AI service streaming error (${response.status})`);
  }

  yield* parseSSEStream(response, (json: any) => {
    if (json.type === 'content_block_delta' && json.delta?.text) {
      return { type: 'token' as const, content: json.delta.text };
    }
    return null;
  });
}

async function* streamGoogleFinalAnswer(
  model: string,
  apiKey: string,
  messages: AgentLoopMessage[],
  maxTokens: number,
  temperature: number,
): AsyncGenerator<{ type: 'token' | 'reasoning'; content: string }> {
  const systemContent = messages.find((m) => m.role === 'system')?.content ?? '';
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const contents = messagesToGoogle(nonSystemMessages);
  const response = await aiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemContent }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      }),
    },
  );

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    console.error(`Google streaming error (${response.status}):`, errText);
    throw new Error(`AI service streaming error (${response.status})`);
  }

  yield* parseSSEStream(response, (json: any) => {
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return { type: 'token' as const, content: text };
    return null;
  });
}

async function* streamOpenAICompatibleFinalAnswer(
  providerId: string,
  model: string,
  apiKey: string,
  endpointUrl: string | null | undefined,
  messages: AgentLoopMessage[],
  maxTokens: number,
  temperature: number,
  disableThinking = false,
  tools: AgentLoopParams['tools'] = [],
): AsyncGenerator<{ type: 'token' | 'reasoning'; content: string }> {
  if (endpointUrl) await assertSafePublicUrl(endpointUrl);
  const url = endpointUrl ?? getProviderEndpoint(providerId);
  const resolvedModel = usesDeepSeekModelAliases(providerId) ? normalizeDeepSeekModel(model, providerId) : model;

  const applyOptions = disableThinking ? withFastChatOptions : withDeepSeekOptions;
  // DeepSeek 在对话里见过工具调用之后，请求里不带 tools 它就把调用写成 DSML 文字吐出来
  // （2026-09-10 六次里三次）。带上工具、明说这轮不许调，它才老实作答。
  const toolFields = providerId === 'deepseek' && tools.length > 0 ? { tools, tool_choice: 'none' } : {};
  const requestBody = applyOptions(providerId, model, {
    ...toolFields,
    model: resolvedModel,
    stream: true,
    messages: messages.map((m) => {
      const entry: Record<string, unknown> = { role: m.role, content: m.content ?? '' };
      if (m.tool_call_id) entry.tool_call_id = m.tool_call_id;
      if (m.tool_calls?.length) entry.tool_calls = m.tool_calls;
      if (providerId === 'deepseek' && m.role === 'assistant' && m.reasoning_content) entry.reasoning_content = m.reasoning_content;
      return entry;
    }),
    max_tokens: maxTokens,
    temperature,
  });

  const response = await aiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    console.error(`Provider ${providerId} streaming error (${response.status}):`, errText);
    throw new Error(`AI service streaming error (${response.status})`);
  }

  yield* parseSSEStream(response, (json: any) => {
    const delta = json.choices?.[0]?.delta;
    if (!delta) return null;

    // DeepSeek reasoning_content
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (reasoning) return { type: 'reasoning' as const, content: reasoning };

    const text = delta.content;
    if (text) return { type: 'token' as const, content: text };

    return null;
  });
}

/** Parse an SSE stream from a fetch Response, yielding extracted values. */
async function* parseSSEStream<T>(
  response: Response,
  extract: (json: any) => T | null,
): AsyncGenerator<T> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep last potentially-incomplete line in buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const json = JSON.parse(payload);
          const result = extract(json);
          if (result !== null) yield result;
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Core agent loop — non-streaming
// ---------------------------------------------------------------------------

export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const {
    providerId,
    model,
    apiKey,
    endpointUrl,
    systemPrompt,
    tools,
    executeToolFn,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    onToolCall,
    onToolResult,
    onThinking,
  } = params;

  const allToolCalls: AgentLoopResult['toolCalls'] = [];
  const toolResultCache = new Map<string, ToolOutcome>();
  let iterations = 0;

  // Build the conversation: system message + user-provided history
  const conversation: AgentLoopMessage[] = [
    { role: 'system', content: systemPrompt },
    ...params.messages,
  ];

  // Determine effective tools — empty if provider doesn't support them
  const effectiveTools = supportsTools(providerId) ? tools : [];

  const loopStart = Date.now();

  try {
    while (iterations < maxIterations) {
      // Guard total loop timeout
      if (Date.now() - loopStart > TOTAL_LOOP_TIMEOUT_MS) {
        // Force final answer without tools
        const finalResult = await callProviderWithTools({
          providerId, model, apiKey, endpointUrl,
          messages: conversation,
          tools: [],
          maxTokens, temperature,
        });
        return {
          content: finalResult.content ?? 'The agent reached its time limit.',
          toolCalls: allToolCalls,
          iterations,
          finishReason: 'max_iterations',
        };
      }

      // Call the LLM
      const result = await callProviderWithTools({
        providerId, model, apiKey, endpointUrl,
        messages: conversation,
        tools: effectiveTools,
        maxTokens, temperature,
      });

      // Emit reasoning if present (DeepSeek)
      if (result.reasoning && onThinking) {
        onThinking(result.reasoning);
      }

      // No tool calls — check if model output tool calls as text
      if (result.toolCalls.length === 0) {
        if (result.content) {
          const availableNames = effectiveTools.map(t => t.function.name);
          const parsed = parseTextToolCalls(result.content, availableNames);
          if (parsed.toolCalls.length > 0) {
            result.toolCalls = parsed.toolCalls;
            result.content = parsed.cleanedContent || null;
          }
        }
        if (result.toolCalls.length === 0) {
          return {
            content: stripToolMarkup(result.content ?? ''),
            toolCalls: allToolCalls,
            iterations,
            finishReason: 'completed',
          };
        }
      }

      // Process tool calls
      iterations++;

      // Append assistant message (with tool_calls) to conversation
      conversation.push({
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls,
        reasoning_content: result.reasoning,
      });

      // Execute each tool call and append results
      for (const toolCall of result.toolCalls) {
        if (onToolCall) onToolCall(toolCall);

        const toolName = toolCall.function.name;
        const toolArgs = safeParseToolArgs(toolCall.function.arguments);

        const toolResult = await executeToolOnce(toolResultCache, executeToolFn, toolName, toolArgs);

        // Record for the final result
        allToolCalls.push({
          id: toolCall.id,
          name: toolName,
          args: toolArgs,
          result: toolResult.success ? toolResult.data : { error: toolResult.error },
        });

        if (onToolResult) onToolResult(toolCall.id, toolName, toolResult);

        // Append tool result message
        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(
            toolResult.success
              ? (toolResult.repeated ? { note: 'Identical call already made in this turn; same result returned. Do not call it again.', result: toolResult.data } : toolResult.data)
              : { error: toolResult.error ?? 'Tool execution failed' },
          ),
        });
      }
    }

    // Reached maxIterations — force a final call WITHOUT tools to get a summary
    const summaryResult = await callProviderWithTools({
      providerId, model, apiKey, endpointUrl,
      messages: conversation,
      tools: [],
      maxTokens, temperature,
    });

    return {
      content: summaryResult.content ?? 'The agent reached its maximum number of iterations.',
      toolCalls: allToolCalls,
      iterations,
      finishReason: 'max_iterations',
    };
  } catch (err) {
    return {
      content: '',
      toolCalls: allToolCalls,
      iterations,
      finishReason: 'error',
      error: err instanceof Error ? err.message : 'Unknown agent loop error',
    };
  }
}

// ---------------------------------------------------------------------------
// Core agent loop — streaming variant
// ---------------------------------------------------------------------------

export async function* runAgentLoopStream(
  params: AgentLoopParams,
): AsyncGenerator<AgentStreamEvent> {
  const {
    providerId,
    model,
    apiKey,
    endpointUrl,
    systemPrompt,
    tools,
    executeToolFn,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
  } = params;

  const allToolCalls: AgentLoopResult['toolCalls'] = [];
  const toolResultCache = new Map<string, ToolOutcome>();
  let iterations = 0;

  const conversation: AgentLoopMessage[] = [
    { role: 'system', content: systemPrompt },
    ...params.messages,
  ];

  const effectiveTools = supportsTools(providerId) ? tools : [];
  const loopStart = Date.now();

  try {
    while (iterations < maxIterations) {
      // Guard total loop timeout
      if (Date.now() - loopStart > TOTAL_LOOP_TIMEOUT_MS) {
        yield* streamFinalAnswer(
          providerId, model, apiKey, endpointUrl, conversation, maxTokens, temperature, false, effectiveTools,
        );
        yield {
          type: 'done',
          result: {
            content: '',
            toolCalls: allToolCalls,
            iterations,
            finishReason: 'max_iterations' as const,
          },
        };
        return;
      }

      // Tool planning phase — non-streaming to get full tool_calls response
      const result = await callProviderWithTools({
        providerId, model, apiKey, endpointUrl,
        messages: conversation,
        tools: effectiveTools,
        maxTokens, temperature,
      });

      // Emit reasoning (DeepSeek thinking)
      if (result.reasoning) {
        yield { type: 'thinking', content: result.reasoning };
      }

      // No tool calls — check if model output tool calls as text
      if (result.toolCalls.length === 0) {
        if (result.content) {
          const availableNames = effectiveTools.map(t => t.function.name);
          const parsed = parseTextToolCalls(result.content, availableNames);
          if (parsed.toolCalls.length > 0) {
            result.toolCalls = parsed.toolCalls;
            result.content = parsed.cleanedContent || null;
          }
        }
        if (result.toolCalls.length === 0) {
          // 规划轮已经把答案写出来了就直接用它。原来这里会丢掉这份内容再发一次流式请求
          // 「重新生成一遍」，多等 5–11s，而且第二次生成常常和第一次不一样——
          // 2026-09-10 六次里三次第二次生成变成了工具调用文字。
          const direct = stripToolMarkup(flattenContent(result.content ?? ''));
          if (direct) {
            for (let i = 0; i < direct.length; i += 48) {
              yield { type: 'token', content: direct.slice(i, i + 48) };
            }
            // 写到 max_tokens 被截住：接着写，学生看到的是一段完整的回答
            let full = direct;
            let truncated = result.truncated === true;
            let continuations = 0;
            while (truncated && continuations < MAX_CONTINUATIONS) {
              continuations += 1;
              const more = await callProviderWithTools({
                providerId, model, apiKey, endpointUrl,
                messages: [...conversation, { role: 'assistant', content: full }, { role: 'user', content: CONTINUE_PROMPT }],
                tools: [],
                maxTokens, temperature,
              }).catch(() => null);
              const extra = more ? stripToolMarkup(flattenContent(more.content ?? '')) : '';
              if (!extra) break;
              for (let i = 0; i < extra.length; i += 48) {
                yield { type: 'token', content: extra.slice(i, i + 48) };
              }
              full += extra;
              truncated = more?.truncated === true;
            }
            yield {
              type: 'done',
              result: {
                content: full, toolCalls: allToolCalls, iterations, finishReason: 'completed',
                ...(continuations > 0 ? { continuations } : {}),
                ...(truncated ? { truncated: true } : {}),
              },
            };
            return;
          }

          // 规划轮没给正文（少数模型只回 tool_calls 或空串）才走流式补一次。
          // 开头先攒几个字：如果是工具调用标记（模型在最终作答里又想调工具，
          // 并把调用写成了文字），整段截下来自己解析执行，不给教师看标记。
          let finalContent = '';
          let pending = '';
          let capturedReasoning = '';
          let gate: 'undecided' | 'pass' | 'capture' = 'undecided';
          for await (const chunk of streamProviderFinalAnswer({
            providerId, model, apiKey, endpointUrl,
            messages: conversation,
            maxTokens, temperature,
            tools: effectiveTools,
          })) {
            if (chunk.type === 'reasoning') {
              capturedReasoning += chunk.content;
              yield { type: 'thinking', content: chunk.content };
              continue;
            }
            if (gate === 'pass') {
              yield { type: 'token', content: chunk.content };
              finalContent += chunk.content;
              continue;
            }
            pending += chunk.content;
            if (gate === 'capture') continue;
            const lead = pending.trimStart();
            if (!lead) continue;
            if (looksLikeToolMarkupStart(lead)) { gate = 'capture'; continue; }
            if (/^[<`]/.test(lead) && lead.length < 12) continue;
            gate = 'pass';
            yield { type: 'token', content: pending };
            finalContent = pending;
            pending = '';
          }

          if (gate === 'undecided' && pending) {
            yield { type: 'token', content: pending };
            finalContent = pending;
          }

          if (gate === 'capture') {
            const availableNames = effectiveTools.map(t => t.function.name);
            const parsed = parseTextToolCalls(pending, availableNames);
            if (parsed.toolCalls.length > 0 && iterations < maxIterations - 1) {
              console.warn(`[agentLoop] ${providerId}/${model} wrote ${parsed.toolCalls.length} tool call(s) as text in the final answer; executing them instead`);
              result.toolCalls = parsed.toolCalls;
              result.content = parsed.cleanedContent || null;
              result.reasoning = capturedReasoning || result.reasoning;
            } else {
              const cleaned = stripToolMarkup(pending);
              finalContent = cleaned || 'The assistant did not produce a readable answer. Please try again.';
              yield { type: 'token', content: finalContent };
            }
          }

          if (result.toolCalls.length === 0) {
            yield {
              type: 'done',
              result: {
                content: finalContent,
                toolCalls: allToolCalls,
                iterations,
                finishReason: 'completed',
              },
            };
            return;
          }
        }
      }

      // Process tool calls
      iterations++;

      conversation.push({
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls,
        reasoning_content: result.reasoning,
      });

      for (const toolCall of result.toolCalls) {
        yield { type: 'tool_call', toolCall };

        const toolName = toolCall.function.name;
        const toolArgs = safeParseToolArgs(toolCall.function.arguments);

        const toolResult = await executeToolOnce(toolResultCache, executeToolFn, toolName, toolArgs);

        allToolCalls.push({
          id: toolCall.id,
          name: toolName,
          args: toolArgs,
          result: toolResult.success ? toolResult.data : { error: toolResult.error },
        });

        yield {
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName,
          result: toolResult,
        };

        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(
            toolResult.success
              ? (toolResult.repeated ? { note: 'Identical call already made in this turn; same result returned. Do not call it again.', result: toolResult.data } : toolResult.data)
              : { error: toolResult.error ?? 'Tool execution failed' },
          ),
        });
      }
    }

    // Reached maxIterations — stream a final summary without tools
    yield* streamFinalAnswer(
      providerId, model, apiKey, endpointUrl, conversation, maxTokens, temperature, false, effectiveTools,
    );

    yield {
      type: 'done',
      result: {
        content: '',
        toolCalls: allToolCalls,
        iterations,
        finishReason: 'max_iterations',
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown agent loop error';
    yield { type: 'error', error: errorMsg };
    yield {
      type: 'done',
      result: {
        content: '',
        toolCalls: allToolCalls,
        iterations,
        finishReason: 'error',
        error: errorMsg,
      },
    };
  }
}

/** Helper to stream a final answer (no tools) and yield token events. */
async function* streamFinalAnswer(
  providerId: string,
  model: string,
  apiKey: string,
  endpointUrl: string | null | undefined,
  messages: AgentLoopMessage[],
  maxTokens: number,
  temperature: number,
  disableThinking = false,
  tools: AgentLoopParams['tools'] = [],
): AsyncGenerator<AgentStreamEvent> {
  for await (const chunk of streamProviderFinalAnswer({
    providerId, model, apiKey, endpointUrl, messages, maxTokens, temperature, disableThinking, tools,
  })) {
    if (chunk.type === 'reasoning') {
      yield { type: 'thinking', content: chunk.content };
    } else {
      yield { type: 'token', content: chunk.content };
    }
  }
}

// ---------------------------------------------------------------------------
// Pure streaming completion — no tool loop, used by lesson plan generation
// ---------------------------------------------------------------------------

export async function* streamCompletion(params: {
  providerId: string;
  model: string;
  apiKey: string;
  endpointUrl?: string | null;
  systemPrompt: string;
  messages: AgentLoopMessage[];
  maxTokens?: number;
  temperature?: number;
  disableThinking?: boolean;
}): AsyncGenerator<AgentStreamEvent> {
  const conversation: AgentLoopMessage[] = [
    { role: 'system', content: params.systemPrompt },
    ...params.messages,
  ];
  yield* streamFinalAnswer(
    params.providerId, params.model, params.apiKey,
    params.endpointUrl ?? null, conversation,
    params.maxTokens ?? DEFAULT_MAX_TOKENS, params.temperature ?? 0.7,
    params.disableThinking ?? false,
  );
}
