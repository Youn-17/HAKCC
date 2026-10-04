-- 029_teacher_agent_memory.sql
-- Unified cross-module memory layer for teacher AI agents
-- Enables lesson_prep, analytics, assessment, and chat to share context

CREATE TABLE IF NOT EXISTS teacher_agent_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source      TEXT NOT NULL
                CHECK (source IN ('lesson_prep', 'analytics', 'assessment', 'chat')),
  memory_type TEXT NOT NULL
                CHECK (memory_type IN ('insight', 'decision', 'observation', 'plan', 'action')),
  content     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tam_user_course
  ON teacher_agent_memory(user_id, course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tam_source
  ON teacher_agent_memory(source, created_at DESC);

ALTER TABLE teacher_agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY tam_select ON teacher_agent_memory FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY tam_insert ON teacher_agent_memory FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY tam_delete ON teacher_agent_memory FOR DELETE
  USING (user_id = auth.uid());
