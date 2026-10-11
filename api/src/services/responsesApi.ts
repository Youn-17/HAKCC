import { NO_TOOLS_MODELS, RESPONSES_API_MODELS } from './modelCatalog';

/**
 * Chat Completions ↔ Responses 转换（2026-10-11 用户提议加 Responses 接口）。
 *
 * 平台十几条对话链路（笔记 AI、反馈、知识空间智能体、求助……）都按 Chat Completions 拼请求、解析返回。
 * 有的模型只认 Responses：APIKEY.FAN 的 grok-4.20-multi-agent-0309 走 Chat Completions 怎么发都是 400，
 * 走 /v1/responses 正常。与其每条链路各写一份，不如在网关（aiFetch）这一处转：请求转成 Responses 的形状
 * 发到 …/responses，返回再转回 Chat Completions 的形状（流式逐个事件转成 chat.completion.chunk），调用方不用改。
 *
 * 只对模型目录里标了 api: 'responses' 的模型生效，别的请求原样放过。标了 noTools 的模型不能调工具
 * （multi-agent 一带 tools 就 400）：发出前去掉 tools，历史里的工具结果改成普通文字，模型照常直接回答。
 * 事件格式按 OpenAI Responses 规范，对照过 APIKEY.FAN 实际返回的流（2026-10-11）。
 */

type Json = Record<string, any>;

export interface ResponsesRoute {
  url: string;
  body: string;
  stream: boolean;
  model: string;
}

/** 这个请求要不要改走 Responses：发往 …/chat/completions、model 在目录里标了 api: 'responses' */
export function routeToResponses(url: string, body: unknown): ResponsesRoute | null {
  if (RESPONSES_API_MODELS.size === 0 || typeof body !== 'string') return null;
  if (!/\/chat\/completions\/?(\?.*)?$/.test(url)) return null;
  // 先按字符串粗筛，绝大多数请求不用整段解析 JSON
  if (![...RESPONSES_API_MODELS].some(id => body.includes(`"${id}"`))) return null;
  let chat: Json;
  try { chat = JSON.parse(body); } catch { return null; }
  const model = typeof chat?.model === 'string' ? chat.model : '';
  if (!RESPONSES_API_MODELS.has(model)) return null;
  return {
    url: url.replace(/\/chat\/completions\/?(?=\?|$)/, '/responses'),
    body: JSON.stringify(toResponsesRequest(chat, { noTools: NO_TOOLS_MODELS.has(model) })),
    stream: chat.stream === true,
    model,
  };
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  return content
    .map(part => (typeof part === 'string' ? part : part?.type === 'text' || part?.type === 'input_text' ? part.text ?? '' : ''))
    .filter(Boolean)
    .join('\n');
}

function userContent(content: unknown): unknown {
  if (!Array.isArray(content)) return textOf(content);
  const parts = content.flatMap((part: Json): Json[] => {
    if (typeof part === 'string') return [{ type: 'input_text', text: part }];
    if (part?.type === 'text') return [{ type: 'input_text', text: part.text ?? '' }];
    if (part?.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      return url ? [{ type: 'input_image', image_url: url, detail: part.image_url?.detail ?? 'auto' }] : [];
    }
    return [];
  });
  return parts.length ? parts : '';
}

/** Chat Completions 请求体 → Responses 请求体 */
export function toResponsesRequest(chat: Json, opts: { noTools?: boolean } = {}): Json {
  const instructions: string[] = [];
  const input: Json[] = [];
  let leading = true;
  for (const m of Array.isArray(chat.messages) ? chat.messages : []) {
    const role = m?.role;
    if (role === 'system' || role === 'developer') {
      const text = textOf(m.content);
      if (!text) continue;
      // 开头的系统消息并成 instructions；对话中途插的系统消息保留原位
      if (leading) instructions.push(text);
      else input.push({ role: 'developer', content: text });
      continue;
    }
    leading = false;
    if (role === 'user') {
      input.push({ role: 'user', content: userContent(m.content) });
    } else if (role === 'assistant') {
      const text = textOf(m.content);
      if (text) input.push({ role: 'assistant', content: text });
      if (!opts.noTools) {
        for (const call of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
          input.push({ type: 'function_call', call_id: call.id, name: call.function?.name ?? '', arguments: call.function?.arguments ?? '' });
        }
      }
    } else if (role === 'tool') {
      const output = textOf(m.content);
      input.push(opts.noTools
        ? { role: 'user', content: `工具返回的结果：\n${output}` }
        : { type: 'function_call_output', call_id: m.tool_call_id, output });
    }
  }

  const out: Json = { model: chat.model, input, store: false };
  if (instructions.length) out.instructions = instructions.join('\n\n');
  const budget = Number(chat.max_tokens ?? chat.max_completion_tokens);
  if (Number.isFinite(budget) && budget > 0) out.max_output_tokens = Math.max(16, Math.round(budget));
  if (typeof chat.temperature === 'number') out.temperature = chat.temperature;
  if (typeof chat.top_p === 'number') out.top_p = chat.top_p;
  if (chat.stream === true) out.stream = true;
  if (!opts.noTools && Array.isArray(chat.tools) && chat.tools.length) {
    out.tools = chat.tools
      .filter((t: Json) => t?.type === 'function' && t.function?.name)
      .map((t: Json) => ({
        type: 'function',
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters ?? { type: 'object', properties: {} },
        ...(typeof t.function.strict === 'boolean' ? { strict: t.function.strict } : {}),
      }));
    const choice = chat.tool_choice;
    if (typeof choice === 'string') out.tool_choice = choice;
    else if (choice?.type === 'function' && choice.function?.name) out.tool_choice = { type: 'function', name: choice.function.name };
    if (typeof chat.parallel_tool_calls === 'boolean') out.parallel_tool_calls = chat.parallel_tool_calls;
  }
  const format = chat.response_format;
  if (format?.type === 'json_object') out.text = { format: { type: 'json_object' } };
  else if (format?.type === 'json_schema' && format.json_schema?.schema) {
    out.text = { format: { type: 'json_schema', name: format.json_schema.name ?? 'output', schema: format.json_schema.schema, ...(typeof format.json_schema.strict === 'boolean' ? { strict: format.json_schema.strict } : {}) } };
  }
  if (typeof chat.reasoning_effort === 'string') out.reasoning = { effort: chat.reasoning_effort };
  return out;
}

function chatUsage(u: Json | null | undefined): Json | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const prompt = Number(u.input_tokens ?? 0);
  const completion = Number(u.output_tokens ?? 0);
  const usage: Json = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: Number(u.total_tokens ?? prompt + completion) };
  if (u.input_tokens_details?.cached_tokens != null) usage.prompt_tokens_details = { cached_tokens: u.input_tokens_details.cached_tokens };
  if (u.output_tokens_details?.reasoning_tokens != null) usage.completion_tokens_details = { reasoning_tokens: u.output_tokens_details.reasoning_tokens };
  return usage;
}

function finishReason(response: Json, hasToolCalls: boolean, incomplete = response?.status === 'incomplete'): string {
  if (hasToolCalls) return 'tool_calls';
  if (incomplete) return response?.incomplete_details?.reason === 'content_filter' ? 'content_filter' : 'length';
  return 'stop';
}

/** Responses 的完整返回 → Chat Completions 的返回 */
export function toChatCompletion(response: Json): Json {
  let text = '';
  let reasoning = '';
  const toolCalls: Json[] = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type === 'message') {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if (part?.type === 'output_text' || part?.type === 'text') text += part.text ?? '';
        else if (part?.type === 'refusal') text += part.refusal ?? '';
      }
    } else if (item?.type === 'reasoning') {
      for (const s of Array.isArray(item.summary) ? item.summary : []) reasoning += s?.text ?? '';
      for (const c of Array.isArray(item.content) ? item.content : []) if (c?.type === 'reasoning_text') reasoning += c.text ?? '';
    } else if (item?.type === 'function_call') {
      toolCalls.push({ id: item.call_id ?? item.id, type: 'function', function: { name: item.name ?? '', arguments: item.arguments ?? '' } });
    }
  }
  if (!text && typeof response?.output_text === 'string') text = response.output_text;
  const message: Json = { role: 'assistant', content: text || (toolCalls.length ? null : '') };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (reasoning) message.reasoning_content = reasoning;
  const usage = chatUsage(response?.usage);
  return {
    id: response?.id ?? '',
    object: 'chat.completion',
    created: Number(response?.created_at) || Math.floor(Date.now() / 1000),
    model: response?.model ?? '',
    choices: [{ index: 0, message, finish_reason: finishReason(response, toolCalls.length > 0) }],
    ...(usage ? { usage } : {}),
  };
}

const sse = (data: unknown) => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;

/** Responses 的流（SSE 事件）→ Chat Completions 的流（chat.completion.chunk + [DONE]） */
export function responsesStreamToChat(upstream: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);
  let id = '';
  let buffer = '';
  let started = false;
  let finished = false;
  let closed = false;
  const pending: string[] = [];
  const toolIndex = new Map<string, number>();

  const chunk = (delta: Json, finish: string | null = null, usage?: Json) =>
    sse({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) });
  const start = () => {
    if (started) return;
    started = true;
    pending.push(chunk({ role: 'assistant', content: '' }));
  };
  const finish = (reason: string, usage?: Json) => {
    if (finished) return;
    start();
    finished = true;
    pending.push(chunk({}, reason, usage), sse('[DONE]'));
  };

  const handle = (event: Json) => {
    switch (event.type) {
      case 'response.created':
      case 'response.in_progress':
        id = event.response?.id ?? id;
        start();
        break;
      case 'response.output_text.delta':
        start();
        if (event.delta) pending.push(chunk({ content: event.delta }));
        break;
      case 'response.refusal.delta':
        start();
        if (event.delta) pending.push(chunk({ content: event.delta }));
        break;
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        start();
        if (event.delta) pending.push(chunk({ reasoning_content: event.delta }));
        break;
      case 'response.output_item.added':
        if (event.item?.type === 'function_call') {
          start();
          const index = toolIndex.size;
          toolIndex.set(String(event.item.id ?? event.output_index), index);
          toolIndex.set(`#${event.output_index}`, index);
          pending.push(chunk({ tool_calls: [{ index, id: event.item.call_id ?? event.item.id, type: 'function', function: { name: event.item.name ?? '', arguments: event.item.arguments ?? '' } }] }));
        }
        break;
      case 'response.function_call_arguments.delta': {
        const index = toolIndex.get(String(event.item_id)) ?? toolIndex.get(`#${event.output_index}`);
        if (index !== undefined && event.delta) pending.push(chunk({ tool_calls: [{ index, function: { arguments: event.delta } }] }));
        break;
      }
      case 'response.completed':
      case 'response.incomplete': {
        const response = event.response ?? {};
        finish(finishReason(response, toolIndex.size > 0, event.type === 'response.incomplete'), chatUsage(response.usage));
        break;
      }
      case 'response.failed':
      case 'error': {
        if (finished) break;
        finished = true;
        const message = event.response?.error?.message ?? event.error?.message ?? event.message ?? '上游返回了错误';
        pending.push(sse({ error: { message, type: event.response?.error?.code ?? event.code ?? 'upstream_error' } }), sse('[DONE]'));
        break;
      }
      default:
        break;
    }
  };

  const takeFrames = (final: boolean) => {
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = final ? '' : frames.pop() ?? '';
    for (const frame of frames) {
      if (!frame.trim()) continue;
      let name = '';
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      const payload = data.join('\n').trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const event = JSON.parse(payload);
        handle({ ...event, type: event?.type ?? name });
      } catch { /* 不是 JSON 的行跳过 */ }
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (pending.length === 0) {
        if (closed) { controller.close(); return; }
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          takeFrames(true);
          // 上游没说完就断了：照样给调用方一个结尾，别让它一直等
          finish('stop');
          closed = true;
          continue;
        }
        buffer += decoder.decode(value, { stream: true });
        takeFrames(false);
      }
      controller.enqueue(encoder.encode(pending.splice(0).join('')));
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** 把一份完整的 Chat Completions 返回改写成流（调用方要的是流、上游却回了整段 JSON 时用） */
function completionAsStream(completion: Json): string {
  const message = completion.choices?.[0]?.message ?? {};
  const base = { id: completion.id, object: 'chat.completion.chunk', created: completion.created, model: completion.model };
  const frames = [sse({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })];
  if (message.reasoning_content) frames.push(sse({ ...base, choices: [{ index: 0, delta: { reasoning_content: message.reasoning_content }, finish_reason: null }] }));
  if (message.content) frames.push(sse({ ...base, choices: [{ index: 0, delta: { content: message.content }, finish_reason: null }] }));
  (message.tool_calls ?? []).forEach((call: Json, index: number) => {
    frames.push(sse({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index, ...call }] }, finish_reason: null }] }));
  });
  frames.push(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: completion.choices?.[0]?.finish_reason ?? 'stop' }], ...(completion.usage ? { usage: completion.usage } : {}) }));
  frames.push(sse('[DONE]'));
  return frames.join('');
}

/** 上游（Responses）的回复 → 调用方等着的 Chat Completions 回复。出错的回复原样返回（两边的错误体是同一个形状） */
export async function adaptResponsesReply(resp: Response, route: ResponsesRoute): Promise<Response> {
  if (!resp.ok) return resp;
  const type = resp.headers.get('content-type') ?? '';
  if (route.stream && type.includes('text/event-stream') && resp.body) {
    return new Response(responsesStreamToChat(resp.body, route.model), {
      status: resp.status,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  }
  const text = await resp.text();
  let json: Json | null = null;
  try { json = JSON.parse(text); } catch { /* 下面按出错处理 */ }
  if (!json || json.status === 'failed' || json.error) {
    const message = json?.error?.message ?? (json ? 'Responses 接口返回失败' : `Responses 接口返回的不是 JSON：${text.slice(0, 120)}`);
    return new Response(JSON.stringify({ error: { message, type: 'upstream_error' } }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
  const completion = toChatCompletion(json);
  if (route.stream) {
    return new Response(completionAsStream(completion), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  }
  return new Response(JSON.stringify(completion), { status: 200, headers: { 'content-type': 'application/json' } });
}
