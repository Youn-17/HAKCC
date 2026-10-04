-- ============================================================
-- HAKCC — Note Conversations
-- 017_note_conversations.sql
-- ============================================================

CREATE OR REPLACE FUNCTION is_course_member(p_course_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM course_members
    WHERE course_id = p_course_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION get_space_course(p_space_id UUID)
RETURNS UUID LANGUAGE sql SECURITY DEFINER AS $$
  SELECT course_id FROM spaces WHERE id = p_space_id;
$$;

CREATE OR REPLACE FUNCTION is_teacher_or_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin')
  ) OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin')
  );
$$;

CREATE TABLE IF NOT EXISTS groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  leader_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  color      VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title          VARCHAR(200) NOT NULL,
  description    TEXT,
  assigned_to_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by_id  UUID NOT NULL REFERENCES profiles(id),
  status         VARCHAR(20) NOT NULL DEFAULT 'todo',
  ssrl_phase     VARCHAR(20) NOT NULL DEFAULT 'planning',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scaffolds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          VARCHAR(200) NOT NULL,
  description    TEXT,
  category       VARCHAR(100) NOT NULL,
  icon           VARCHAR(50),
  color          VARCHAR(50),
  steps          JSONB NOT NULL DEFAULT '[]'::jsonb,
  usage_count    INT NOT NULL DEFAULT 0,
  is_mandatory   BOOLEAN NOT NULL DEFAULT false,
  is_recommended BOOLEAN NOT NULL DEFAULT false,
  course_id      UUID REFERENCES courses(id) ON DELETE CASCADE,
  created_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_conversation_threads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id        UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  space_id       UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  target_type    VARCHAR(20) NOT NULL CHECK (target_type IN ('group', 'member', 'ai')),
  group_id       UUID REFERENCES groups(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  provider_id    VARCHAR(50),
  model          VARCHAR(100),
  title          VARCHAR(200),
  created_by     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (target_type = 'group' AND group_id IS NOT NULL AND target_user_id IS NULL) OR
    (target_type = 'member' AND target_user_id IS NOT NULL AND group_id IS NULL) OR
    (target_type = 'ai' AND group_id IS NULL AND target_user_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS note_conversation_participants (
  thread_id    UUID NOT NULL REFERENCES note_conversation_threads(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member', 'observer')),
  last_read_at TIMESTAMPTZ,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS note_conversation_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        UUID NOT NULL REFERENCES note_conversation_threads(id) ON DELETE CASCADE,
  sender_id        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  sender_kind      VARCHAR(20) NOT NULL CHECK (sender_kind IN ('user', 'assistant', 'system')),
  content          TEXT NOT NULL DEFAULT '',
  scaffold_id      UUID REFERENCES scaffolds(id) ON DELETE SET NULL,
  scaffold_step_id VARCHAR(100),
  attachments      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_conversation_threads_note ON note_conversation_threads(note_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_conversation_threads_course ON note_conversation_threads(course_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_conversation_participants_user ON note_conversation_participants(user_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_note_conversation_messages_thread ON note_conversation_messages(thread_id, created_at ASC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('note-chat-attachments', 'note-chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE note_conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_note_conversation_participant(
  p_thread_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM note_conversation_participants
    WHERE thread_id = p_thread_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION is_note_conversation_creator(
  p_thread_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM note_conversation_threads
    WHERE id = p_thread_id AND created_by = p_user_id
  );
$$;

DROP POLICY IF EXISTS note_conversation_threads_select ON note_conversation_threads;
CREATE POLICY note_conversation_threads_select ON note_conversation_threads FOR SELECT
  USING (
    is_teacher_or_admin() OR
    is_note_conversation_participant(id)
  );

DROP POLICY IF EXISTS note_conversation_threads_insert ON note_conversation_threads;
CREATE POLICY note_conversation_threads_insert ON note_conversation_threads FOR INSERT
  WITH CHECK (
    created_by = auth.uid() AND
    (
      is_course_member(course_id) OR
      is_teacher_or_admin()
    )
  );

DROP POLICY IF EXISTS note_conversation_participants_select ON note_conversation_participants;
CREATE POLICY note_conversation_participants_select ON note_conversation_participants FOR SELECT
  USING (
    is_teacher_or_admin() OR user_id = auth.uid() OR
    is_note_conversation_participant(thread_id)
  );

DROP POLICY IF EXISTS note_conversation_participants_insert ON note_conversation_participants;
CREATE POLICY note_conversation_participants_insert ON note_conversation_participants FOR INSERT
  WITH CHECK (
    is_teacher_or_admin() OR
    is_note_conversation_creator(thread_id)
  );

DROP POLICY IF EXISTS note_conversation_messages_select ON note_conversation_messages;
CREATE POLICY note_conversation_messages_select ON note_conversation_messages FOR SELECT
  USING (
    is_teacher_or_admin() OR
    is_note_conversation_participant(thread_id)
  );

DROP POLICY IF EXISTS note_conversation_messages_insert ON note_conversation_messages;
CREATE POLICY note_conversation_messages_insert ON note_conversation_messages FOR INSERT
  WITH CHECK (
    (sender_id = auth.uid() AND sender_kind = 'user' AND is_note_conversation_participant(thread_id)) OR
    is_teacher_or_admin()
  );

CREATE OR REPLACE FUNCTION update_note_conversation_thread_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE note_conversation_threads
  SET updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_note_conversation_messages_updated_at ON note_conversation_messages;
CREATE TRIGGER trg_note_conversation_messages_updated_at
  AFTER INSERT ON note_conversation_messages
  FOR EACH ROW EXECUTE FUNCTION update_note_conversation_thread_timestamp();
