-- ============================================================
-- HAKCC — Note AI Feedback and AI Text Provenance
-- 020_note_ai_feedbacks.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS note_ai_feedbacks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id           UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  space_id          UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider_id       VARCHAR(50),
  model             VARCHAR(100),
  trigger_type      VARCHAR(50) NOT NULL CHECK (trigger_type IN ('evidence_gap', 'uncertainty', 'weak_synthesis', 'clarification_needed')),
  trigger_context   JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_excerpt     TEXT NOT NULL DEFAULT '',
  feedback_text     TEXT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'ignored', 'followed_up', 'inserted')),
  response_text     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS note_ai_insertions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id           UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  space_id          UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_message_id UUID REFERENCES note_conversation_messages(id) ON DELETE SET NULL,
  feedback_id       UUID REFERENCES note_ai_feedbacks(id) ON DELETE SET NULL,
  provider_id       VARCHAR(50),
  model             VARCHAR(100),
  selected_text     TEXT NOT NULL,
  inserted_html     TEXT NOT NULL,
  insertion_anchor  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_ai_feedbacks_note_user_time ON note_ai_feedbacks(note_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_ai_feedbacks_course_time ON note_ai_feedbacks(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_ai_insertions_note_user_time ON note_ai_insertions(note_id, user_id, created_at DESC);

ALTER TABLE note_ai_feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_ai_insertions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_ai_feedbacks_select ON note_ai_feedbacks;
CREATE POLICY note_ai_feedbacks_select ON note_ai_feedbacks FOR SELECT
  USING (
    user_id = auth.uid() OR
    is_teacher_or_admin()
  );

DROP POLICY IF EXISTS note_ai_feedbacks_insert ON note_ai_feedbacks;
CREATE POLICY note_ai_feedbacks_insert ON note_ai_feedbacks FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND is_course_member(course_id)
  );

DROP POLICY IF EXISTS note_ai_feedbacks_update ON note_ai_feedbacks;
CREATE POLICY note_ai_feedbacks_update ON note_ai_feedbacks FOR UPDATE
  USING (
    user_id = auth.uid() OR is_teacher_or_admin()
  )
  WITH CHECK (
    user_id = auth.uid() OR is_teacher_or_admin()
  );

DROP POLICY IF EXISTS note_ai_insertions_select ON note_ai_insertions;
CREATE POLICY note_ai_insertions_select ON note_ai_insertions FOR SELECT
  USING (
    user_id = auth.uid() OR is_teacher_or_admin()
  );

DROP POLICY IF EXISTS note_ai_insertions_insert ON note_ai_insertions;
CREATE POLICY note_ai_insertions_insert ON note_ai_insertions FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND is_course_member(course_id)
  );
