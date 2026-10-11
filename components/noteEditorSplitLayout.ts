export const NOTE_AI_SPLIT_LAYOUT = {
  /** 打开笔记时 AI 助手和 Note 各占一半（2026-10-11 用户）；拖过以后照拖的来 */
  defaultAiShare: 0.5,
  minAiWidth: 320,
  maxAiWidth: 1100,
  minNoteWidth: 560,
  viewportPadding: 16,
  dividerWidth: 8,
} as const;

export function clampNoteAiPanelWidth(
  requestedWidth: number,
  viewportWidth: number,
): number {
  const availableWidth = Math.max(0, viewportWidth - NOTE_AI_SPLIT_LAYOUT.viewportPadding);
  const maxByViewport = availableWidth - NOTE_AI_SPLIT_LAYOUT.minNoteWidth - NOTE_AI_SPLIT_LAYOUT.dividerWidth;
  const maxWidth = Math.max(
    NOTE_AI_SPLIT_LAYOUT.minAiWidth,
    Math.min(NOTE_AI_SPLIT_LAYOUT.maxAiWidth, maxByViewport),
  );
  return Math.min(Math.max(requestedWidth, NOTE_AI_SPLIT_LAYOUT.minAiWidth), maxWidth);
}

/** 默认宽度：除去分隔条后正好一半，再放进上下限里（屏幕窄时 Note 至少留 560） */
export function defaultNoteAiPanelWidth(viewportWidth: number): number {
  const shared = Math.max(0, viewportWidth - NOTE_AI_SPLIT_LAYOUT.dividerWidth);
  return clampNoteAiPanelWidth(Math.round(shared * NOTE_AI_SPLIT_LAYOUT.defaultAiShare), viewportWidth);
}

export function resizeNoteAiPanelWidth(params: {
  startWidth: number;
  startX: number;
  currentX: number;
  viewportWidth: number;
}): number {
  return clampNoteAiPanelWidth(
    params.startWidth + params.currentX - params.startX,
    params.viewportWidth,
  );
}
