import type { ToolCallInfo } from './AgentToolCallDisplay';

/**
 * AI 回答过程里的每一步（AgentProcess 用）。纯函数，单独测。
 *
 * 两个面板、三条后端路径发来的事件不太一样：
 *   - 智能体（笔记页 agent-stream、知识空间）：每次调工具一个 running（带 toolName），
 *     结束一个 used（带 toolName、toolSummary、toolDurationMs）；
 *   - 笔记页「自由提问」（ai/stream）：联网搜索是 running/used 带 toolNames；
 *     回答前找相关内容是一个不带名字的 running，结束时 used 带用上的 toolNames（可能是空的）。
 * 这里把它们都折成同一份步骤列表。
 */

export interface ToolEvent {
  toolStatus?: unknown;
  toolName?: unknown;
  toolNames?: unknown;
  toolSummary?: unknown;
  toolDurationMs?: unknown;
}

/** 回答前「找相关内容」那一步：服务端不说具体是哪个工具 */
export const PREPARE_STEP = 'prepare_context';

const names = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string' && n.length > 0) : []);

export function applyToolEvent(steps: readonly ToolCallInfo[], event: ToolEvent): ToolCallInfo[] {
  const status = event.toolStatus;
  const name = typeof event.toolName === 'string' && event.toolName ? event.toolName : null;
  const summary = typeof event.toolSummary === 'string' && event.toolSummary ? event.toolSummary : undefined;
  const duration = typeof event.toolDurationMs === 'number' && Number.isFinite(event.toolDurationMs) ? event.toolDurationMs : undefined;
  const next = [...steps];

  if (status === 'running') {
    if (name) return [...next, { name, status: 'running' }];
    const listed = names(event.toolNames);
    if (listed.length > 0) return [...next, ...listed.map(n => ({ name: n, status: 'running' as const }))];
    return [...next, { name: PREPARE_STEP, status: 'running' }];
  }

  if (status !== 'used') return next;

  if (name) {
    // 同一个工具可能调两次：结束的是最后一个还在跑的那次
    const index = next.map(s => s.name).lastIndexOf(name);
    const done: ToolCallInfo = { name, status: 'done', ...(summary ? { result: summary } : {}), ...(duration != null ? { duration } : {}) };
    if (index >= 0 && next[index].status === 'running') next[index] = { ...next[index], ...done };
    else next.push(done);
    return next;
  }

  // 只给了一串名字：还在跑的都算完了；名单里有、列表里没有的补上
  const listed = names(event.toolNames);
  const finished = next.map(s => (s.status === 'running' ? { ...s, status: 'done' as const, ...(summary ? { result: summary } : {}) } : s));
  // 「找相关内容」什么也没用上：这一步不留，免得学生以为它找到了什么
  const pruned = listed.length === 0 ? finished.filter(s => !(s.name === PREPARE_STEP && !s.result)) : finished;
  for (const n of listed) {
    if (!pruned.some(s => s.name === n)) pruned.push({ name: n, status: 'done' });
  }
  return pruned;
}

/**
 * 存下来的回答里的步骤：新的回答 ai_metadata.tool_steps 带结果和用时；
 * 以前的只有 tools_used 一串名字，还原成「完成」、不带结果。
 */
export function stepsFromMetadata(meta: Record<string, unknown> | null | undefined): ToolCallInfo[] {
  if (!meta) return [];
  const saved = meta.tool_steps ?? meta.toolSteps;
  if (Array.isArray(saved)) {
    return saved
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string')
      .map(s => ({
        name: String(s.name),
        status: s.status === 'error' ? 'error' as const : 'done' as const,
        ...(typeof s.summary === 'string' && s.summary ? { result: s.summary } : {}),
        ...(typeof s.ms === 'number' && Number.isFinite(s.ms) ? { duration: s.ms } : {}),
      }));
  }
  const used = names(meta.tools_used ?? meta.toolsUsed);
  return [...new Set(used)].map(name => ({ name, status: 'done' as const }));
}

/** 「用了 3 步 · 6 秒」里的秒数：一位小数到 10 秒，之后取整 */
export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? s.toFixed(1) : String(Math.round(s));
}
