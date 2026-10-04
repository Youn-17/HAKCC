import { describe, expect, it } from 'vitest';
import {
  NOTE_AI_SPLIT_LAYOUT,
  clampNoteAiPanelWidth,
  resizeNoteAiPanelWidth,
} from './noteEditorSplitLayout';

describe('note editor split layout', () => {
  it('keeps the AI panel inside ergonomic desktop bounds', () => {
    expect(clampNoteAiPanelWidth(240, 1440)).toBe(NOTE_AI_SPLIT_LAYOUT.minAiWidth);
    expect(clampNoteAiPanelWidth(900, 1800)).toBe(NOTE_AI_SPLIT_LAYOUT.maxAiWidth);
  });

  it('reserves usable space for the main Note on narrower desktop viewports', () => {
    const width = clampNoteAiPanelWidth(760, 1120);

    expect(width).toBeLessThan(760);
    expect(width).toBeGreaterThanOrEqual(NOTE_AI_SPLIT_LAYOUT.minAiWidth);
  });

  it('links drag distance to the AI width while the Note receives the remaining space', () => {
    expect(resizeNoteAiPanelWidth({
      startWidth: 560,
      startX: 500,
      currentX: 620,
      viewportWidth: 1600,
    })).toBe(680);

    expect(resizeNoteAiPanelWidth({
      startWidth: 560,
      startX: 500,
      currentX: 320,
      viewportWidth: 1600,
    })).toBe(NOTE_AI_SPLIT_LAYOUT.minAiWidth);
  });
});
