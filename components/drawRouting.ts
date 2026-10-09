import { ai as aiApi, type DrawFormChoice, type PreviousDrawingPayload } from '../services/apiClient';
import { detectDrawIntent, mightRequestDrawing } from './drawIntent';

/**
 * 发出去之前先定：这一句是画图还是对话（2026-10-09 起由 Jev 判断，见 api/src/services/drawJudge.ts）。
 * 笔记 AI 助手、对话式笔记、文档 AI 由前端决定调画图还是对话的接口，所以在这里先问服务端；
 * 和图不沾边、上一轮也不是画图的句子不问，直接对话。服务端没回、出错，按「画一张……」这类说法认，和以前一样。
 * 两个智能体对话（知识空间智能体、AI 对话）在服务端自己判断，不走这里。
 */

export interface DrawChoice {
  draw: boolean;
  /** 改上一张还是新画 */
  mode: 'new' | 'edit';
  /** Jev 有把握时定下的种类；null = 由服务端的规划看上下文定 */
  form: DrawFormChoice | null;
  /** 画的时候原样带回去，记进这张图的元数据 */
  route?: Record<string, unknown>;
}

/** 卡在发送的路上：等不到就按说法认 */
const ROUTE_WAIT_MS = 2500;

export async function chooseDrawing(
  text: string,
  opts: {
    previous?: PreviousDrawingPayload | null;
    lastReply?: string | null;
    /** 学生按了「画图」：一定画，只问改图还是新画、画成哪种 */
    forced?: boolean;
    ask?: typeof aiApi.drawRoute;
    waitMs?: number;
  } = {},
): Promise<DrawChoice> {
  const forced = Boolean(opts.forced);
  const byWording: DrawChoice = { draw: forced || Boolean(detectDrawIntent(text)), mode: 'new', form: null };
  if (!forced && !mightRequestDrawing(text, { afterDrawing: Boolean(opts.previous) })) return byWording;
  const ask = opts.ask ?? aiApi.drawRoute;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      ask({ text, previous: opts.previous ?? null, last_reply: opts.lastReply ?? null, forced }),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), opts.waitMs ?? ROUTE_WAIT_MS); }),
    ]);
    // 没回、或回的不是判断结果（比如旧版后端没有这个接口）：按说法认
    if (!result || typeof result.draw !== 'boolean') return byWording;
    return {
      draw: forced || result.draw === true,
      mode: result.mode === 'edit' ? 'edit' : 'new',
      form: result.form ?? null,
      ...(result.route ? { route: result.route } : {}),
    };
  } catch {
    return byWording;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface ChatLike {
  senderKind?: string;
  role?: string;
  content?: string | null;
  aiMetadata?: Record<string, unknown> | null;
}

const isAssistant = (m: ChatLike) => m.senderKind === 'assistant' || m.role === 'assistant';

/** 对话里最后一条是 AI 刚画的图：带上当时的原话、说明、种类，判断「是不是要改它」用 */
export function previousDrawingFrom(messages: readonly ChatLike[]): PreviousDrawingPayload | null {
  const visible = messages.filter(m => (m.content ?? '').trim());
  const last = visible[visible.length - 1];
  if (!last || !isAssistant(last)) return null;
  const meta = last.aiMetadata ?? {};
  if (meta.failed) return null;
  const asked = [...visible.slice(0, -1)].reverse().find(m => !isAssistant(m))?.content?.trim() ?? '';
  const drawing = meta.drawing as { kind?: unknown; caption?: unknown; prompt?: unknown; diagram?: unknown } | undefined;
  if (drawing && (drawing.kind === 'picture' || drawing.kind === 'diagram')) {
    return {
      request: asked,
      caption: typeof drawing.caption === 'string' ? drawing.caption : '',
      kind: drawing.kind,
      ...(typeof drawing.prompt === 'string' ? { prompt: drawing.prompt } : {}),
      ...(drawing.diagram ? { diagram: drawing.diagram } : {}),
    };
  }
  return meta.direct_image === true && asked ? { request: asked, caption: '', kind: 'picture', prompt: asked } : null;
}

/** 上一条是文字回答时的回答：判断「把上面的画成图」用 */
export function lastReplyFrom(messages: readonly ChatLike[]): string | null {
  const visible = messages.filter(m => (m.content ?? '').trim());
  const last = visible[visible.length - 1];
  return last && isAssistant(last) && !last.aiMetadata?.direct_image ? (last.content ?? '').trim().slice(0, 1200) : null;
}
