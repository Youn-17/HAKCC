export const NOTE_AI_SPLIT_LAYOUT = {
  defaultAiWidth: 560,
  minAiWidth: 420,
  maxAiWidth: 760,
  minNoteWidth: 620,
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
