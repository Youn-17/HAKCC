import type { NoteConversationMessage } from '../services/apiClient';

/**
 * 服务器回传了那条学生消息：换掉本地占位，位置不变。
 * 面板上已经有这一条就只删占位——同一个 id 放两次，就是两个气泡、两个同样的 key；
 * 占位已经不在，就补在末尾。
 */
export function settleOptimisticMessage(
  prev: NoteConversationMessage[],
  tempId: string,
  real: NoteConversationMessage,
): NoteConversationMessage[] {
  if (prev.some(message => message.id === real.id)) return prev.filter(message => message.id !== tempId);
  return prev.some(message => message.id === tempId)
    ? prev.map(message => (message.id === tempId ? real : message))
    : [...prev, real];
}
