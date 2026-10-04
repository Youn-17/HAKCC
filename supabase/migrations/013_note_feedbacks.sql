-- Migration 013: Note Feedbacks table
-- Stores AI-generated and teacher-published feedback on notes

CREATE TABLE IF NOT EXISTS note_feedbacks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id           UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  space_id          UUID REFERENCES spaces(id) ON DELETE CASCADE,
  ai_evaluation     TEXT,                      -- KB-theory evaluation (teacher-only)
  student_summary   TEXT NOT NULL,             -- student-facing feedback
  teacher_note      TEXT,                      -- optional teacher addition
  generated_by      UUID REFERENCES users(id),
  is_published      BOOLEAN NOT NULL DEFAULT FALSE,
  published_by      UUID REFERENCES users(id),
  published_by_name TEXT,
  published_at      TIMESTAMPTZ,
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by note
CREATE INDEX IF NOT EXISTS idx_note_feedbacks_note_id ON note_feedbacks(note_id);
CREATE INDEX IF NOT EXISTS idx_note_feedbacks_space_id ON note_feedbacks(space_id);

-- RLS: teachers/admins can manage feedbacks; students can read published ones for their own notes
ALTER TABLE note_feedbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage feedbacks"
  ON note_feedbacks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('teacher', 'admin')
    )
  );

CREATE POLICY "Students read published feedback on own notes"
  ON note_feedbacks
  FOR SELECT
  USING (
    is_published = TRUE
    AND EXISTS (
      SELECT 1 FROM notes WHERE id = note_feedbacks.note_id AND author_id = auth.uid()
    )
  );

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_note_feedbacks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_note_feedbacks_updated_at
  BEFORE UPDATE ON note_feedbacks
  FOR EACH ROW EXECUTE FUNCTION update_note_feedbacks_updated_at();
