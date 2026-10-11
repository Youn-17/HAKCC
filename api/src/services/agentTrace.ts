import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase';

/**
 * 智能体每一轮的运行记录（harness，2026-10-11）。存进早就有的 agent_runs / agent_effects（迁移 030，
 * 「一轮对话 = 一个 run，每一步 = 一条 effect，只追加」），不另开表，也不往平台外面发。
 *
 * 过程中只记在内存里，回答发完再写库：一行 run，effects 一次批量插入。一轮几十步，
 * 每步写一次库（库在外地，一次两三百毫秒）会让学生多等好几秒。
 * 写库失败只记日志，不影响这一轮回答。
 */

/** 提示词里的规则（说话、主体性、工具上限）改了就改这个号：运行记录里看得出是哪一版答的 */
export const HARNESS_PROMPT_VERSION = '2026-10-11.1';

/** 一轮最多记多少步：防止跑飞的循环写出几千行 */
const MAX_EFFECTS = 200;

export function promptHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/** 工具参数压成一小段（运行记录里只看个大概，长的网页说明截掉） */
export function summarizeArgs(args: Record<string, unknown>, max = 300): string {
  let text: string;
  try {
    text = JSON.stringify(args);
  } catch {
    text = '[unserializable]';
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface TraceBase {
  userId: string;
  courseId: string | null;
  surface: 'note' | 'workspace' | 'personal';
  conversationId: string | null;
  /** 这一轮的提问（截短），列表里一眼认出是哪一轮 */
  title?: string;
}

export interface TraceEffect {
  type: string;
  payload: Record<string, unknown>;
  at: number;
}

export class AgentTrace {
  readonly runId = randomUUID();
  readonly startedAt = Date.now();
  private readonly effects: TraceEffect[] = [];
  private persisted = false;

  constructor(private readonly base: TraceBase) {}

  record(type: string, payload: Record<string, unknown> = {}): void {
    if (this.persisted || this.effects.length >= MAX_EFFECTS) return;
    this.effects.push({ type, payload, at: Date.now() });
  }

  get events(): readonly TraceEffect[] {
    return this.effects;
  }

  /** 写库：只写一次；返回写没写成 */
  async persist(final: {
    status: 'applied' | 'failed';
    output?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    if (this.persisted) return false;
    this.persisted = true;
    try {
      const { error: runError } = await supabase.from('agent_runs').insert({
        id: this.runId,
        user_id: this.base.userId,
        course_id: this.base.courseId,
        agent_type: 'chat',
        status: final.status,
        title: this.base.title?.slice(0, 120) ?? null,
        input: { surface: this.base.surface, conversation_id: this.base.conversationId },
        output: final.output ?? {},
        metadata: {
          harness: HARNESS_PROMPT_VERSION,
          surface: this.base.surface,
          conversation_id: this.base.conversationId,
          ...(final.metadata ?? {}),
        },
        started_at: new Date(this.startedAt).toISOString(),
        completed_at: new Date().toISOString(),
      });
      if (runError) {
        console.error('[agentTrace] run insert failed:', runError.message);
        return false;
      }
      if (this.effects.length > 0) {
        const { error } = await supabase.from('agent_effects').insert(this.effects.map((e, i) => ({
          run_id: this.runId,
          seq: i + 1,
          effect_type: e.type,
          payload: e.payload,
          created_at: new Date(e.at).toISOString(),
        })));
        if (error) {
          console.error('[agentTrace] effects insert failed:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('[agentTrace] persist failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }
}
