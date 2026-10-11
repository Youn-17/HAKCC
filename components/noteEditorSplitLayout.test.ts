import { describe, expect, it } from 'vitest';
import {
  NOTE_AI_SPLIT_LAYOUT,
  clampNoteAiPanelWidth,
  defaultNoteAiPanelWidth,
  resizeNoteAiPanelWidth,
} from './noteEditorSplitLayout';

describe('note editor split layout', () => {
  it('opens with the AI partner and the Note sharing the width equally', () => {
    expect(defaultNoteAiPanelWidth(1600)).toBe(796);
    expect(defaultNoteAiPanelWidth(2000)).toBe(996);
    const note = 1600 - NOTE_AI_SPLIT_LAYOUT.dividerWidth - defaultNoteAiPanelWidth(1600);
    expect(note).toBe(796);
  });

  it('keeps a usable Note on narrow desktops and caps the AI width on very wide screens', () => {
    expect(defaultNoteAiPanelWidth(1100)).toBe(1100 - 16 - 560 - 8);
    expect(defaultNoteAiPanelWidth(3200)).toBe(NOTE_AI_SPLIT_LAYOUT.maxAiWidth);
  });

  it('keeps the AI panel inside ergonomic desktop bounds', () => {
    expect(clampNoteAiPanelWidth(240, 1440)).toBe(NOTE_AI_SPLIT_LAYOUT.minAiWidth);
    expect(clampNoteAiPanelWidth(1400, 3000)).toBe(NOTE_AI_SPLIT_LAYOUT.maxAiWidth);
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
    })).toBe(380);
  });
});
