import type { Response } from 'express';
import { supabase } from '../config/supabase';
import { generateNoteImage } from './noteImage';
import { persistGeneratedImage } from './generatedMedia';
import { normalizeDiagram, renderDiagramPng, type DiagramSpec } from './diagramRender';
import { planDrawing, type DrawContext, type DrawPlan, type DrawTurn, type PlanResult } from './drawPlanner';
import { checkDrawPlan, type DrawForm, type PlanCheck, type PreviousDrawing } from './drawJudge';

/**
 * 对话里的一次画图。所有入口（知识空间智能体、AI 对话、笔记 AI 助手、对话式笔记、文档 AI、智能体的画图工具）都走 produceDrawing。
 *
 * 2026-10-09 起分两步（用户：画出来词不达意，没结合记忆）：
 *   1. drawPlanner 先读这一问之前的对话、对话记忆、正在看的笔记或文档、学生的学习记录，弄清楚要画什么；
 *   2. 结构图（关系图、思维导图、时间线）由 diagramRender 画，字一个不错；画面交给生图模型（DMX 优先，见 noteImage）。
 * 规划不可用时（没配对话模型、超时、回答不能用）退回原来的做法：拿学生原话去画。
 * 画好的图下面附一句话说明画的是什么、依据是什么，理解错了学生一眼看得出来。
 *
 * 同一天晚些时候加上 Jev（drawJudge.ts）：入口先由 Jev 判断要不要画、是不是改上一张、画成哪种；
 * 规划好以后再核对一遍，种类不对或 Jev 说不合要求，就带着这份规划重新规划一次，取更合要求的那份。
 */

export type DrawingOutcome =
  | {
    ok: true;
    url: string;
    /** 存进对话的内容：图片 + 下面那句说明 */
    markdown: string;
    caption: string;
    kind: DrawPlan['kind'];
    provider: string;
    model: string;
    /** 有没有先规划过；false = 规划不可用，用的是学生原话 */
    planned: boolean;
    /** 改上一张还是新画 */
    mode: 'new' | 'edit';
    /** 入口判断要画的经过（drawRouteSummary），记进元数据 */
    route?: Record<string, unknown>;
    /** 规划核对的结果 */
    check?: Record<string, unknown>;
    /** 交给生图模型的描述（画面才有） */
    prompt?: string;
    diagram?: DiagramSpec;
    plannerModel?: string;
    plannerError?: string;
  }
  | { ok: false; error: string; caption?: string };

/** 结构图画不成（服务器缺字体之类）时，按结构写一段描述交给生图模型 */
function diagramAsPrompt(d: DiagramSpec): string {
  const shape = d.type === 'timeline' ? 'a simple horizontal timeline' : d.type === 'tree' ? 'a simple mind map' : 'a simple concept map with arrows';
  const labels = d.nodes.map(n => `"${n.label}"`).join(', ');
  return `${shape} on a white background${d.title ? `, titled "${d.title}"` : ''}, clean flat style, boxes labelled exactly: ${labels}.`;
}

/** 规划出来的是不是定下的那一种 */
export function planHasForm(plan: DrawPlan, form: DrawForm): boolean {
  return form === 'picture' ? plan.kind === 'picture' : plan.kind === 'diagram' && plan.diagram.type === form;
}

interface PlanVerdict { formMismatch: boolean; check: PlanCheck | null }

const verdictOk = (v: PlanVerdict) => !v.formMismatch && (v.check?.passed ?? true);
/** 两份规划比较：种类对的优先，再看 Jev 给的合要求概率 */
const verdictScore = (v: PlanVerdict) => (v.formMismatch ? 0 : 2) + (v.check?.matchProbability ?? 0.5);

async function reviewPlan(request: string, plan: DrawPlan, form: DrawForm | null | undefined, previous: PreviousDrawing | null | undefined): Promise<PlanVerdict> {
  return {
    formMismatch: Boolean(form) && !planHasForm(plan, form!),
    check: await checkDrawPlan(request, plan, { previous }).catch(() => null),
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function drawingMarkdown(url: string, caption: string, request: string): string {
  const alt = (caption || request).slice(0, 60).replace(/[[\]]/g, '');
  return caption ? `![${alt}](${url})\n\n${caption}` : `![${alt}](${url})`;
}

export async function produceDrawing(opts: {
  courseId: string | null;
  request: string;
  context: DrawContext;
  /** 改上一轮那张（Jev 判断是改图时才给）：规划照着它改 */
  previous?: PreviousDrawing | null;
  /** Jev 有把握时定下的种类 */
  form?: DrawForm | null;
  /** 入口判断要画的经过，原样记进元数据 */
  route?: Record<string, unknown> | null;
  size?: string;
  model?: string;
  aspectRatio?: string;
  /** 规划好了、开始动笔时调用：推流的入口据此告诉前端「正在画：……」 */
  onPlanned?: (info: { kind: DrawPlan['kind']; caption: string }) => void;
}): Promise<DrawingOutcome> {
  const request = opts.request.trim();
  const previous = opts.previous ?? null;
  const zh = /[一-龥]/.test(request);
  const context: DrawContext = {
    ...opts.context,
    ...(previous ? { previous } : {}),
    ...(opts.form ? { form: opts.form } : {}),
  };
  let plan: DrawPlan | null = null;
  let plannerModel: string | undefined;
  let plannerError: string | undefined;
  let check: Record<string, unknown> | undefined;
  if (opts.courseId) {
    const courseId = opts.courseId;
    const plan1: PlanResult = await planDrawing(courseId, request, context)
      .catch((err: Error): PlanResult => ({ plan: null, error: err.message }));
    if (plan1.plan) {
      plan = plan1.plan;
      plannerModel = plan1.model;
      const first = await reviewPlan(request, plan, opts.form, previous);
      let chosen: 'first' | 'retry' = 'first';
      let retried: PlanVerdict | null = null;
      if (!verdictOk(first)) {
        const plan2: PlanResult = await planDrawing(courseId, request, { ...context, rejected: plan })
          .catch((err: Error): PlanResult => ({ plan: null, error: err.message }));
        if (plan2.plan) {
          retried = await reviewPlan(request, plan2.plan, opts.form, previous);
          if (verdictScore(retried) > verdictScore(first)) {
            plan = plan2.plan;
            plannerModel = plan2.model ?? plannerModel;
            chosen = 'retry';
          }
        }
      }
      if (first.check || first.formMismatch || retried) {
        check = {
          ...(first.check?.matchProbability != null ? { p: round3(first.check.matchProbability) } : {}),
          passed: verdictOk(first),
          ...(first.formMismatch ? { form_mismatch: true } : {}),
          ...(first.check?.jevError ? { jev_error: first.check.jevError } : {}),
          ...(first.check?.latencyMs != null ? { latency_ms: first.check.latencyMs } : {}),
          ...(retried ? {
            replanned: true,
            ...(retried.check?.matchProbability != null ? { p_retry: round3(retried.check.matchProbability) } : {}),
            ...(retried.formMismatch ? { retry_form_mismatch: true } : {}),
            chosen,
          } : {}),
        };
      }
    } else {
      plannerError = plan1.error;
    }
  } else {
    plannerError = 'no course';
  }
  if (!plan && previous?.kind === 'diagram') {
    // 不规划就不知道要怎么改这张结构图；拿原话去画只会画出不相干的东西
    return { ok: false, error: zh ? '这次没能读懂要怎么改这张图（理解要求的模型暂时不可用），请稍后再试。' : 'Could not work out how to change this diagram right now. Please try again later.' };
  }
  let current: DrawPlan = plan
    ?? (previous?.kind === 'picture' && previous.prompt
      ? { kind: 'picture', prompt: `${previous.prompt}. Change requested by the learner: ${request}`, caption: '' }
      : { kind: 'picture', prompt: request, caption: '' });
  const caption = current.caption;
  opts.onPlanned?.({ kind: current.kind, caption });

  const finish = (url: string, provider: string, model: string): DrawingOutcome => ({
    ok: true,
    url,
    markdown: drawingMarkdown(url, caption, request),
    caption,
    kind: current.kind,
    provider,
    model,
    planned: Boolean(plan),
    mode: previous ? 'edit' : 'new',
    ...(current.kind === 'picture' ? { prompt: current.prompt } : { diagram: current.diagram }),
    ...(plannerModel ? { plannerModel } : {}),
    ...(plannerError ? { plannerError } : {}),
    ...(opts.route ? { route: opts.route } : {}),
    ...(check ? { check } : {}),
  });

  if (current.kind === 'diagram') {
    const rendered = await renderDiagramPng(current.diagram);
    if (rendered.ok) {
      const stored = await persistGeneratedImage({ courseId: opts.courseId, model: 'diagram', b64: rendered.png.toString('base64') });
      if (!stored.ok) return { ok: false, error: stored.error, caption };
      return finish(stored.url, 'hakcc', 'diagram');
    }
    console.warn('[drawTurn] diagram not rendered, falling back to the image model:', rendered.error);
    current = { kind: 'picture', prompt: diagramAsPrompt(current.diagram), caption };
  }

  const image = await generateNoteImage(opts.courseId, current.prompt, { size: opts.size, model: opts.model, aspectRatio: opts.aspectRatio });
  if (!image.ok) return { ok: false, error: image.error, caption };
  return finish(image.url, image.provider, image.model);
}

/** 存进对话的元数据：研究数据里能看出这张图是怎么来的（规划成了什么、交给生图模型的是哪段话） */
export function drawingMetadata(outcome: Extract<DrawingOutcome, { ok: true }>): Record<string, unknown> {
  return {
    direct_image: true,
    provider_id: outcome.provider,
    model: outcome.model,
    image_url: outcome.url,
    drawing: {
      kind: outcome.kind,
      mode: outcome.mode,
      planned: outcome.planned,
      caption: outcome.caption,
      ...(outcome.prompt ? { prompt: outcome.prompt } : {}),
      ...(outcome.diagram ? { diagram: outcome.diagram } : {}),
      ...(outcome.plannerModel ? { planner_model: outcome.plannerModel } : {}),
      ...(outcome.plannerError ? { planner_error: outcome.plannerError } : {}),
      ...(outcome.route ? { route: outcome.route } : {}),
      ...(outcome.check ? { check: outcome.check } : {}),
    },
  };
}

// ── 画图要读的上下文 ───────────────────────────────────────────────────────

/**
 * 这段对话最近几轮，旧的在前，不含刚存进去的这一问。
 * agent：知识空间智能体和「AI 对话」（agent_messages）；note：笔记 AI 助手的线程（note_conversation_messages）。
 * 调用前必须已经确认过这段对话是调用者能看的。
 */
export async function loadRecentTurns(kind: 'agent' | 'note', id: string, currentRequest: string, limit = 12): Promise<DrawTurn[]> {
  const table = kind === 'note' ? 'note_conversation_messages' : 'agent_messages';
  const key = kind === 'note' ? 'thread_id' : 'conversation_id';
  const roleColumn = kind === 'note' ? 'sender_kind' : 'role';
  const { data, error } = await supabase
    .from(table)
    .select(`${roleColumn}, content, created_at`)
    .eq(key, id)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (error || !data) return [];
  const turns: DrawTurn[] = [...(data as unknown as Array<Record<string, unknown>>)]
    .reverse()
    .map(row => ({ role: row[roleColumn] === 'assistant' ? 'assistant' as const : 'user' as const, content: String(row.content ?? '') }))
    .filter(turn => turn.content.trim());
  const last = turns[turns.length - 1];
  if (last && last.role === 'user' && last.content.trim() === currentRequest.trim()) turns.pop();
  return turns.slice(-limit);
}

/**
 * 存在 ai_metadata 里的一张图换成「上一张」：drawing 字段是 10-09 起才有的；
 * 更早直接出图的只记了 direct_image，那就当一幅画面，描述用学生当时的原话。
 */
export function previousFromMetadata(meta: unknown, request: string): PreviousDrawing | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  if (m.failed) return null;
  const drawing = m.drawing as Record<string, unknown> | undefined;
  if (drawing && typeof drawing === 'object') {
    const caption = typeof drawing.caption === 'string' ? drawing.caption.slice(0, 300) : '';
    if (drawing.kind === 'diagram') {
      const diagram = normalizeDiagram(drawing.diagram);
      return diagram ? { request, caption, kind: 'diagram', diagram } : null;
    }
    if (drawing.kind === 'picture') {
      const prompt = typeof drawing.prompt === 'string' && drawing.prompt.trim() ? drawing.prompt.slice(0, 1800) : request;
      return { request, caption, kind: 'picture', prompt };
    }
    return null;
  }
  return m.direct_image === true && typeof m.image_url === 'string' && request.trim()
    ? { request, caption: '', kind: 'picture', prompt: request }
    : null;
}

/**
 * 上一轮做了什么：画了图就给出那张图（判断是不是要改它、规划照着改），是文字回答就给出回答（判断「把上面的画成图」）。
 * 不含刚存进去的这一问。调用前必须已经确认过这段对话是调用者能看的。
 */
export async function loadLastExchange(kind: 'agent' | 'note', id: string, currentRequest: string): Promise<{ previous: PreviousDrawing | null; lastReply: string | null }> {
  const table = kind === 'note' ? 'note_conversation_messages' : 'agent_messages';
  const key = kind === 'note' ? 'thread_id' : 'conversation_id';
  const roleColumn = kind === 'note' ? 'sender_kind' : 'role';
  const { data, error } = await supabase
    .from(table)
    .select(`${roleColumn}, content, ai_metadata, created_at`)
    .eq(key, id)
    .order('created_at', { ascending: false })
    .limit(4);
  const none = { previous: null, lastReply: null };
  if (error || !data) return none;
  // 复制一份再动：下面要 shift
  const rows = [...(data as unknown as Array<Record<string, unknown>>)];
  const isUser = (row?: Record<string, unknown>) => Boolean(row) && row![roleColumn] !== 'assistant';
  if (isUser(rows[0]) && String(rows[0].content ?? '').trim() === currentRequest.trim()) rows.shift();
  const reply = rows[0];
  if (!reply || isUser(reply)) return none;
  const asked = isUser(rows[1]) ? String(rows[1].content ?? '').slice(0, 600) : '';
  const previous = previousFromMetadata(reply.ai_metadata, asked);
  if (previous) return { previous, lastReply: null };
  const text = String(reply.content ?? '').trim();
  return { previous: null, lastReply: text ? text.slice(0, 1200) : null };
}

/** 新开的对话只有前端带来的几轮：上一轮是文字回答就给出来，画没画过图认不出 */
export function lastReplyFromTurns(turns: DrawTurn[]): string | null {
  const last = turns[turns.length - 1];
  return last?.role === 'assistant' && last.content.trim() ? last.content.trim().slice(0, 1200) : null;
}

/** 这段对话存着的记忆摘要（conversationMemory 写的）。画图只读，不触发重新总结 */
export async function loadStoredMemory(kind: 'agent' | 'note', id: string): Promise<string> {
  const table = kind === 'note' ? 'note_conversation_threads' : 'agent_conversations';
  const { data } = await supabase.from(table).select('conversation_memory').eq('id', id).maybeSingle();
  const memory = (data as { conversation_memory?: { version?: number; summary?: unknown } } | null)?.conversation_memory;
  return memory?.version === 1 && typeof memory.summary === 'string' ? memory.summary : '';
}

/**
 * 助手对话里的一轮画图（知识空间智能体、「AI 对话」）。推流格式和对话一样，旧前端也能显示：
 *   {drawing: {prompt, stage: 'planning', mode}}    → 前端放绘图动画（「读懂你的意思」；改图是「读懂你要怎么改」）；
 *   {drawing: {prompt, stage: 'drawing', kind, caption, mode}} → 规划好了，前端写「正在画：……」；
 *   {token: markdown}                               → 图片和说明以 markdown 推出去；
 *   {assistantMessage} {done} [DONE]。
 * 失败推 {error}，也存一条失败的助手消息：研究数据里这一轮不能凭空消失。
 */
export async function streamDrawTurn(res: Response, opts: {
  courseId: string;
  conversationId: string;
  /** 学生这一问的原话 */
  prompt: string;
  userId: string;
  spaceId: string | null;
  /** ai_interventions.trigger_type，区分是哪个助手里画的 */
  triggerType: string;
  context?: DrawContext;
  /** 改上一张时给 */
  previous?: PreviousDrawing | null;
  form?: DrawForm | null;
  route?: Record<string, unknown> | null;
}): Promise<void> {
  const zh = /[一-龥]/.test(opts.prompt);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: unknown) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* 连接已断 */ }
  };
  // 规划加画一张要十几秒，中间不发东西的话 nginx 和浏览器会以为连接死了
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { /* 连接已断 */ }
  }, 10_000);

  try {
    const mode = opts.previous ? 'edit' : 'new';
    send({ drawing: { prompt: opts.prompt, stage: 'planning', mode } });
    const result = await produceDrawing({
      courseId: opts.courseId,
      request: opts.prompt,
      context: opts.context ?? {},
      previous: opts.previous,
      form: opts.form,
      route: opts.route,
      onPlanned: ({ kind, caption }) => send({ drawing: { prompt: opts.prompt, stage: 'drawing', kind, caption, mode } }),
    });

    if (!result.ok) {
      const text = `${zh ? '这张图没有画成：' : 'The image could not be generated: '}${result.error}`;
      await supabase.from('agent_messages').insert({
        conversation_id: opts.conversationId,
        role: 'assistant',
        content: text,
        ai_metadata: { direct_image: true, failed: true },
      });
      send({ error: text });
    } else {
      send({ token: result.markdown });
      const { data: saved } = await supabase.from('agent_messages').insert({
        conversation_id: opts.conversationId,
        role: 'assistant',
        content: result.markdown,
        tools_used: ['generate_image'],
        ai_metadata: drawingMetadata(result),
      }).select('id').single();
      send({ assistantMessage: { id: saved?.id ?? null, content: result.markdown, tools_used: ['generate_image'] } });
      await supabase.from('ai_interventions').insert({
        space_id: opts.spaceId,
        user_id: opts.userId,
        trigger_type: opts.triggerType,
        provider_id: result.provider,
        model_name: result.model,
        input_context_summary: opts.prompt.slice(0, 200),
        response_text: result.url.slice(0, 500),
        visibility_scope: 'private',
      });
    }

    await supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', opts.conversationId);
    send({ done: true, conversationId: opts.conversationId, toolsUsed: result.ok ? ['generate_image'] : [], iterations: 0 });
    try { res.write('data: [DONE]\n\n'); } catch { /* 连接已断 */ }
  } catch (err) {
    send({ error: err instanceof Error ? err.message : 'Drawing failed' });
    try { res.write('data: [DONE]\n\n'); } catch { /* 连接已断 */ }
  } finally {
    clearInterval(keepalive);
    res.end();
  }
}
