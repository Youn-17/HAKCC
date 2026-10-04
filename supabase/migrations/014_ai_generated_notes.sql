-- Migration 014: AI-generated note flag
-- Marks notes that were automatically created by the AI trigger system

ALTER TABLE notes ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_trigger_type VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_notes_is_ai_generated ON notes(is_ai_generated) WHERE is_ai_generated = true;
