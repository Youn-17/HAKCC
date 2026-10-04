/**
 * 提示词里已经限了字数，模型仍可能超。超了就在句子边界切，
 * 不留半句话 —— 学生看到的反馈断在句中，比短一点更糟。
 *
 * 原先住在 aiTriggerService 里，那条自动发布链路删除后搬到这里。
 */
export function trimAtSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastEnd = Math.max(
    slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'),
    slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'),
  );
  // 切点太靠前就宁可硬截：只保留前 40% 会丢掉大半内容
  return lastEnd > maxLen * 0.4 ? slice.slice(0, lastEnd + 1) : slice;
}
