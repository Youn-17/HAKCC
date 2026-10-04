-- ============================================================
-- HAKCC — Knowledge Building Agency Fields
-- 021_kb_agency_fields.sql
-- ============================================================

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS inquiry_question TEXT;

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS inquiry_question TEXT,
  ADD COLUMN IF NOT EXISTS promising_reason TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_lacks JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE relations
  ADD COLUMN IF NOT EXISTS space_id UUID REFERENCES spaces(id) ON DELETE CASCADE;

UPDATE relations AS r
SET space_id = n.space_id
FROM notes AS n
WHERE r.source_note_id = n.id
  AND r.space_id IS NULL;

ALTER TABLE note_ai_insertions
  ADD COLUMN IF NOT EXISTS acceptance_reason TEXT,
  ADD COLUMN IF NOT EXISTS student_revision_plan TEXT;

CREATE INDEX IF NOT EXISTS idx_relations_space ON relations(space_id);
CREATE INDEX IF NOT EXISTS idx_notes_knowledge_lacks_gin ON notes USING gin (knowledge_lacks);
