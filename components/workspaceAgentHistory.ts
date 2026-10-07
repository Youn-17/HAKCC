import type { AgentConversation, AgentMessage, KbSourceCard } from '../services/apiClient';
import type { ToolCallInfo } from './AgentToolCallDisplay';
import { stepsFromMetadata } from './agentProcessSteps';
import { parseKbSources } from './KbSourceCards';

/**
 * 知识空间 AI 助手「历史对话」和面板宽度的纯逻辑：接着聊哪一段、列表怎么排、
 * 存下来的消息怎么还原成对话、面板默认多宽。抽出来是为了能单测——面板本身牵着一堆异步状态。
 *
 * 后端一直在存对话（agent_conversations / agent_messages），面板以前一条都没读回来：
 * 刷新页面、换个设备、隔天再开，都是一片空白，所以学生觉得「历史记录从来不保留」。
 */

export interface RestoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolCallInfo[];
  elapsedMs?: number;
  /** 课程资料的来源卡片（10-07 起存在 ai_metadata.kb_sources） */
  kbSources?: KbSourceCard[];
}

/** 新的在前，同一条只留一次 */
export function sortConversations(list: readonly AgentConversation[]): AgentConversation[] {
  const seen = new Set<string>();
  return [...list]
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/**
 * 刷新历史列表：服务器给的和本地已有的合并。刚聊完一轮就点开「历史」时，
 * 服务器那边的更新时间可能还没落下来，不能让它把本地刚放进去的这一段冲掉。
 */
export function mergeConversations(
  local: readonly AgentConversation[],
  remote: readonly AgentConversation[],
): AgentConversation[] {
  const byId = new Map<string, AgentConversation>();
  for (const c of remote) byId.set(c.id, c);
  for (const c of local) {
    const fromServer = byId.get(c.id);
    if (!fromServer) byId.set(c.id, c);
    else if (String(c.updated_at) > String(fromServer.updated_at)) byId.set(c.id, { ...fromServer, updated_at: c.updated_at });
  }
  return sortConversations([...byId.values()]);
}

/**
 * 打开面板时接着聊哪一段：这个空间里最近的一段。
 * 一门课里有共享空间和各组的空间，对话记着自己在哪个空间；别的空间的不接。
 * 没有空间 id（手机里整页打开）就不筛。
 */
export function pickConversationToRestore(
  list: readonly AgentConversation[],
  spaceId?: string | null,
): AgentConversation | null {
  const inSpace = spaceId ? list.filter(c => !c.space_id || c.space_id === spaceId) : [...list];
  return sortConversations(inSpace)[0] ?? null;
}

/**
 * 这一轮聊完了：把这段对话放到列表最前面。已经在列表里的保留它原来的标题
 * （标题是第一句话，后面的提问不改它）。
 */
export function upsertConversation(
  list: readonly AgentConversation[],
  conversation: Pick<AgentConversation, 'id' | 'title' | 'updated_at'> & Partial<AgentConversation>,
): AgentConversation[] {
  const existing = list.find(c => c.id === conversation.id);
  const merged: AgentConversation = { ...existing, ...conversation, title: existing?.title || conversation.title } as AgentConversation;
  return [merged, ...list.filter(c => c.id !== conversation.id)];
}

/** 列表里这一段叫什么：第一句话，压成一行 */
export function conversationLabel(conversation: Pick<AgentConversation, 'title'>, lang: 'zh' | 'en'): string {
  const text = (conversation.title ?? '').replace(/\s+/g, ' ').trim();
  if (text && text !== 'New conversation') return text;
  return lang === 'zh' ? '新对话' : 'New chat';
}

/**
 * 存下来的消息 → 面板里的对话。空回复（出错中断时可能留下）不显示。
 * 2026-10-05 起回答里存着每一步的结果和用时（tool_steps），还原成「用了 3 步 · 6 秒」；
 * 以前的只有 tools_used 一串名字，还原成「完成」、不带结果。
 */
export function messagesFromApi(list: readonly AgentMessage[]): RestoredMessage[] {
  return list
    .filter(m => (m.role === 'user' || m.role === 'assistant') && (m.content ?? '').trim() !== '')
    .map(m => {
      if (m.role !== 'assistant') return { id: m.id, role: m.role, content: m.content };
      const tools = stepsFromMetadata({ ...(m.ai_metadata ?? {}), tools_used: m.ai_metadata?.tool_steps ? undefined : m.tools_used });
      const elapsed = Number(m.ai_metadata?.elapsed_ms);
      const kbSources = parseKbSources(m.ai_metadata?.kb_sources);
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        ...(tools.length > 0 ? { tools } : {}),
        ...(Number.isFinite(elapsed) && elapsed > 0 ? { elapsedMs: elapsed } : {}),
        ...(kbSources.length > 0 ? { kbSources } : {}),
      };
    });
}

// ── 面板宽度 ─────────────────────────────────────────────────

export const PANEL_MIN_WIDTH = 360;
export const PANEL_DEFAULT_MIN = 440;
export const PANEL_DEFAULT_MAX = 1000;

/** 默认占屏幕的一半：对话和画布各一半，既看得清回答又不丢了画布 */
export function defaultPanelWidth(viewportWidth: number): number {
  return Math.min(PANEL_DEFAULT_MAX, Math.max(PANEL_DEFAULT_MIN, Math.round(viewportWidth / 2)));
}

/** 拖动时的范围：至少能放下对话，至多占屏幕的 85%，再宽也没意义 */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(PANEL_MIN_WIDTH, Math.min(1400, Math.round(viewportWidth * 0.85)));
  return Math.min(max, Math.max(PANEL_MIN_WIDTH, Math.round(width)));
}

/** 学生拖过宽度就记住（浏览器里的偏好）；没记过就用默认的一半屏 */
export function initialPanelWidth(viewportWidth: number, stored: string | null): number {
  const saved = stored == null ? NaN : Number(stored);
  return Number.isFinite(saved) && saved > 0 ? clampPanelWidth(saved, viewportWidth) : defaultPanelWidth(viewportWidth);
}
