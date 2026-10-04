-- ============================================================
-- HAKCC — AI Partner Note Publications
-- 024_ai_partner_note_publications.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_partner_note_publications (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id                  UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  source_note_id           UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  relation_id              UUID REFERENCES relations(id) ON DELETE SET NULL,
  space_id                 UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  course_id                UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  published_by_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_conversation_id   UUID REFERENCES note_conversation_threads(id) ON DELETE SET NULL,
  source_message_id        UUID REFERENCES note_conversation_messages(id) ON DELETE SET NULL,
  provider_id              VARCHAR(50),
  model                    VARCHAR(100),
  persona_id               VARCHAR(100),
  selected_text            TEXT NOT NULL,
  adoption_reason          TEXT NOT NULL,
  relation_type            relation_type NOT NULL DEFAULT 'extend',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_partner_publications_note
  ON ai_partner_note_publications(note_id);

CREATE INDEX IF NOT EXISTS idx_ai_partner_publications_source_note_time
  ON ai_partner_note_publications(source_note_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_partner_publications_course_time
  ON ai_partner_note_publications(course_id, created_at DESC);

ALTER TABLE ai_partner_note_publications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_partner_publications_select ON ai_partner_note_publications;
CREATE POLICY ai_partner_publications_select ON ai_partner_note_publications FOR SELECT
  USING (
    published_by_user_id = auth.uid()
    OR is_teacher_or_admin()
    OR is_course_member(course_id)
  );

DROP POLICY IF EXISTS ai_partner_publications_insert ON ai_partner_note_publications;
CREATE POLICY ai_partner_publications_insert ON ai_partner_note_publications FOR INSERT
  WITH CHECK (
    published_by_user_id = auth.uid()
    AND is_course_member(course_id)
  );
