import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptResponsesReply, responsesStreamToChat, routeToResponses, toChatCompletion, toResponsesRequest } from './responsesApi';
import { aiFetch } from './aiGateway';

/**
 * Chat Completions ↔ Responses 转换（2026-10-11）。流的样例照抄 APIKEY.FAN 对 grok-4.20-multi-agent-0309
 * 实际返回的事件（event: 行 + data: 行），调用方那边按平台现有的解析方式（data: 开头、[DONE] 结尾）读。
 */

const MA = 'grok-4.20-multi-agent-0309';
const enc = new TextEncoder();

const frame = (event: Record<string, unknown>) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

/** 把一段文本按固定字节数切开喂进去：故意把多字节的中文字切在两块之间 */
function chunked(text: string, size = 7): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

/** 和 noteConversations / ai.ts 解析上游流的写法一样 */
function parseChatStream(text: string): { chunks: any[]; done: boolean } {
  const chunks: any[] = [];
  let done = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    if (line === 'data: [DONE]') { done = true; continue; }
    chunks.push(JSON.parse(line.slice(6)));
  }
  return { chunks, done };
}

const TEXT_STREAM = [
  frame({ type: 'response.created', sequence_number: 0, response: { id: 'resp_1', model: MA, object: 'response', output: [], status: 'in_progress' } }),
  frame({ type: 'response.in_progress', sequence_number: 1, response: { id: 'resp_1', model: MA, object: 'response', output: [] } }),
  frame({ type: 'response.output_item.added', item: { content: [], id: 'msg_1', role: 'assistant', type: 'message', status: 'in_progress' }, output_index: 0 }),
  frame({ type: 'response.content_part.added', content_index: 0, item_id: 'msg_1', output_index: 0, part: { type: 'output_text', text: '' } }),
  frame({ type: 'response.output_text.delta', content_index: 0, delta: '天空呈蓝色', item_id: 'msg_1', output_index: 0 }),
  frame({ type: 'response.output_text.delta', content_index: 0, delta: '，是因为瑞利散射。', item_id: 'msg_1', output_index: 0 }),
  frame({ type: 'response.output_text.done', content_index: 0, item_id: 'msg_1', output_index: 0, text: '天空呈蓝色，是因为瑞利散射。' }),
  frame({ type: 'response.output_item.done', item: { type: 'message', id: 'msg_1', content: [{ type: 'output_text', text: '天空呈蓝色，是因为瑞利散射。' }] }, output_index: 0 }),
  frame({ type: 'response.completed', response: { id: 'resp_1', model: MA, status: 'completed', usage: { input_tokens: 9023, input_tokens_details: { cached_tokens: 7168 }, output_tokens: 20, total_tokens: 9043 } } }),
].join('');

describe('请求：Chat Completions → Responses', () => {
  it('开头的系统消息并成 instructions；图片、工具调用、工具结果、工具定义、JSON 输出、预算都换成 Responses 的写法', () => {
    const out = toResponsesRequest({
      model: 'gpt-6.1-sol',
      messages: [
        { role: 'system', content: '你是助教。' },
        { role: 'system', content: '回答简短。' },
        { role: 'user', content: [{ type: 'text', text: '这张图是什么？' }, { type: 'image_url', image_url: { url: 'https://x.test/a.png' } }] },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_notes', arguments: '{"query":"散射"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: '找到 1 条' },
        { role: 'system', content: '中途的提醒' },
        { role: 'assistant', content: '好的' },
      ],
      max_tokens: 8,
      temperature: 0.7,
      stream: true,
      tools: [{ type: 'function', function: { name: 'search_notes', description: '检索', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }],
      tool_choice: { type: 'function', function: { name: 'search_notes' } },
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
      thinking: { type: 'disabled' },
      enable_thinking: false,
    });
    expect(out).toEqual({
      model: 'gpt-6.1-sol',
      instructions: '你是助教。\n\n回答简短。',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: '这张图是什么？' }, { type: 'input_image', image_url: 'https://x.test/a.png', detail: 'auto' }] },
        { type: 'function_call', call_id: 'call_1', name: 'search_notes', arguments: '{"query":"散射"}' },
        { type: 'function_call_output', call_id: 'call_1', output: '找到 1 条' },
        { role: 'developer', content: '中途的提醒' },
        { role: 'assistant', content: '好的' },
      ],
      store: false,
      max_output_tokens: 16,
      temperature: 0.7,
      stream: true,
      tools: [{ type: 'function', name: 'search_notes', description: '检索', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
      tool_choice: { type: 'function', name: 'search_notes' },
      text: { format: { type: 'json_object' } },
      reasoning: { effort: 'low' },
    });
  });

  it('不能调工具的模型：去掉 tools / tool_choice，历史里的工具调用不发，工具结果改成普通文字', () => {
    const out = toResponsesRequest({
      model: MA,
      messages: [
        { role: 'user', content: '找笔记' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_notes', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: '小明写了瑞利散射' },
      ],
      tools: [{ type: 'function', function: { name: 'search_notes', parameters: {} } }],
      tool_choice: 'auto',
    }, { noTools: true });
    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
    expect(out.input).toEqual([
      { role: 'user', content: '找笔记' },
      { role: 'user', content: '工具返回的结果：\n小明写了瑞利散射' },
    ]);
  });
});

describe('哪些请求改走 Responses', () => {
  it('发往 …/chat/completions 且模型标了 api: responses 才改，地址换成 …/responses', () => {
    const body = JSON.stringify({ model: MA, messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 't', parameters: {} } }] });
    const route = routeToResponses('https://api.apikey.fan/v1/chat/completions', body)!;
    expect(route.url).toBe('https://api.apikey.fan/v1/responses');
    expect(route.stream).toBe(false);
    expect(JSON.parse(route.body)).toMatchObject({ model: MA, input: [{ role: 'user', content: 'hi' }], store: false });
    // multi-agent 标了不能调工具
    expect(JSON.parse(route.body).tools).toBeUndefined();

    expect(routeToResponses('https://api.apikey.fan/v1/chat/completions', JSON.stringify({ model: 'grok-4.7', messages: [] }))).toBeNull();
    expect(routeToResponses('https://api.apikey.fan/v1/images/generations', body)).toBeNull();
    expect(routeToResponses('https://api.apikey.fan/v1/chat/completions', undefined)).toBeNull();
    expect(routeToResponses('https://api.apikey.fan/v1/chat/completions', `{"model":"${MA}",`)).toBeNull();
  });
});

describe('非流式回复：Responses → Chat Completions', () => {
  it('正文、推理摘要、用量', () => {
    const out = toChatCompletion({
      id: 'resp_1', model: MA, status: 'completed', created_at: 1791682864,
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: '先想想散射。' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '因为瑞利散射。' }] },
      ],
      usage: { input_tokens: 9023, input_tokens_details: { cached_tokens: 7168 }, output_tokens: 20, total_tokens: 9043, output_tokens_details: { reasoning_tokens: 5 } },
    });
    expect(out).toEqual({
      id: 'resp_1', object: 'chat.completion', created: 1791682864, model: MA,
      choices: [{ index: 0, message: { role: 'assistant', content: '因为瑞利散射。', reasoning_content: '先想想散射。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9023, completion_tokens: 20, total_tokens: 9043, prompt_tokens_details: { cached_tokens: 7168 }, completion_tokens_details: { reasoning_tokens: 5 } },
    });
  });

  it('函数调用 → tool_calls；写到上限停的 → length', () => {
    const calls = toChatCompletion({ output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_notes', arguments: '{"query":"光"}' }], status: 'completed' });
    expect(calls.choices[0]).toEqual({
      index: 0,
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_notes', arguments: '{"query":"光"}' } }] },
      finish_reason: 'tool_calls',
    });
    const cut = toChatCompletion({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'output_text', text: '半句' }] }] });
    expect(cut.choices[0].finish_reason).toBe('length');
    expect(cut.choices[0].message.content).toBe('半句');
  });
});

describe('流式回复：Responses 事件 → chat.completion.chunk', () => {
  it('APIKEY.FAN 实际的事件序列（切成碎块喂）：正文拼得对，结尾带用量和 [DONE]', async () => {
    const text = await readAll(responsesStreamToChat(chunked(TEXT_STREAM), MA));
    const { chunks, done } = parseChatStream(text);
    expect(done).toBe(true);
    expect(chunks[0].choices[0].delta).toEqual({ role: 'assistant', content: '' });
    expect(chunks.map(c => c.choices[0].delta.content ?? '').join('')).toBe('天空呈蓝色，是因为瑞利散射。');
    const last = chunks[chunks.length - 1];
    expect(last.choices[0].finish_reason).toBe('stop');
    expect(last.usage).toMatchObject({ prompt_tokens: 9023, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 7168 } });
    expect(chunks.every(c => c.object === 'chat.completion.chunk' && c.model === MA && c.id === 'resp_1')).toBe(true);
  });

  it('函数调用：先给 id 和名字，参数按增量拼，结尾 finish_reason=tool_calls', async () => {
    const stream = [
      frame({ type: 'response.created', response: { id: 'resp_2' } }),
      frame({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_notes', arguments: '' } }),
      frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"query":' }),
      frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '"光的散射"}' }),
      frame({ type: 'response.function_call_arguments.done', item_id: 'fc_1', output_index: 0, arguments: '{"query":"光的散射"}' }),
      frame({ type: 'response.completed', response: { id: 'resp_2', status: 'completed' } }),
    ].join('');
    const { chunks, done } = parseChatStream(await readAll(responsesStreamToChat(chunked(stream, 11), 'gpt-6.1-sol')));
    expect(done).toBe(true);
    const deltas = chunks.flatMap(c => c.choices[0].delta.tool_calls ?? []);
    expect(deltas[0]).toEqual({ index: 0, id: 'call_1', type: 'function', function: { name: 'search_notes', arguments: '' } });
    expect(deltas.map(d => d.function.arguments).join('')).toBe('{"query":"光的散射"}');
    expect(deltas.every(d => d.index === 0)).toBe(true);
    expect(chunks[chunks.length - 1].choices[0].finish_reason).toBe('tool_calls');
  });

  it('上游报错：转成 {error} 一行再 [DONE]；上游没说完就断：照样补结尾', async () => {
    const failed = frame({ type: 'response.failed', response: { id: 'r', error: { code: 'server_error', message: 'No healthy Grok OAuth account' } } });
    const a = parseChatStream(await readAll(responsesStreamToChat(chunked(failed), MA)));
    expect(a.done).toBe(true);
    expect(a.chunks).toEqual([{ error: { message: 'No healthy Grok OAuth account', type: 'server_error' } }]);

    const cut = TEXT_STREAM.slice(0, TEXT_STREAM.indexOf('event: response.output_text.done'));
    const b = parseChatStream(await readAll(responsesStreamToChat(chunked(cut), MA)));
    expect(b.done).toBe(true);
    expect(b.chunks.map(c => c.choices[0].delta.content ?? '').join('')).toBe('天空呈蓝色，是因为瑞利散射。');
    expect(b.chunks[b.chunks.length - 1].choices[0].finish_reason).toBe('stop');
  });
});

describe('回复整体改写', () => {
  const route = (stream: boolean) => ({ url: 'https://api.apikey.fan/v1/responses', body: '{}', stream, model: MA });

  it('出错的回复原样返回；要流却回了整段 JSON 时改写成流', async () => {
    const error = new Response('{"error":{"message":"Upstream rate limit exceeded","type":"rate_limit_error"}}', { status: 429 });
    expect(await adaptResponsesReply(error, route(false))).toBe(error);

    const json = new Response(JSON.stringify({ id: 'r', model: MA, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '蓝色' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const streamed = await adaptResponsesReply(json, route(true));
    expect(streamed.headers.get('content-type')).toContain('text/event-stream');
    const { chunks, done } = parseChatStream(await streamed.text());
    expect(done).toBe(true);
    expect(chunks.map(c => c.choices[0].delta.content ?? '').join('')).toBe('蓝色');

    const failed = await adaptResponsesReply(new Response(JSON.stringify({ status: 'failed', error: { message: 'boom' } }), { status: 200 }), route(false));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: { message: 'boom', type: 'upstream_error' } });
  });
});

describe('经过网关（aiFetch）', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it('标了 responses 的模型：实际打 /v1/responses，调用方拿到 Chat Completions 的形状；别的模型原样放过', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, body: String(init.body) });
      if (url.endsWith('/responses')) {
        const body = JSON.parse(String(init.body));
        if (body.stream) return new Response(chunked(TEXT_STREAM), { status: 200, headers: { 'content-type': 'text/event-stream' } });
        return new Response(JSON.stringify({ id: 'resp_1', model: MA, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '因为瑞利散射。' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{"choices":[{"message":{"content":"原样"}}]}', { status: 200 });
    }) as unknown as typeof fetch;

    const chat = (model: string, stream = false) => aiFetch('https://api.apikey.fan/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: '回答简短。' }, { role: 'user', content: '天空为什么是蓝色的？' }], max_tokens: 400, temperature: 0.7, stream }),
    }, { userId: null });

    const plain = await (await chat(MA)).json();
    expect(seen[0].url).toBe('https://api.apikey.fan/v1/responses');
    expect(JSON.parse(seen[0].body)).toEqual({ model: MA, instructions: '回答简短。', input: [{ role: 'user', content: '天空为什么是蓝色的？' }], store: false, max_output_tokens: 400, temperature: 0.7 });
    expect(plain.choices[0].message.content).toBe('因为瑞利散射。');

    const streamed = parseChatStream(await (await chat(MA, true)).text());
    expect(streamed.done).toBe(true);
    expect(streamed.chunks.map(c => c.choices[0].delta.content ?? '').join('')).toBe('天空呈蓝色，是因为瑞利散射。');

    const other = await (await chat('grok-4.7')).json();
    expect(seen[2].url).toBe('https://api.apikey.fan/v1/chat/completions');
    expect(JSON.parse(seen[2].body).messages).toHaveLength(2);
    expect(other.choices[0].message.content).toBe('原样');
  });
});
