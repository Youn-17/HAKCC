-- 028_lesson_plans.sql
-- Structured lesson plan storage for the 备课助手 (Lesson Prep Agent)

CREATE TABLE IF NOT EXISTS lesson_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  space_id          UUID REFERENCES spaces(id) ON DELETE SET NULL,
  created_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  plan_type         TEXT NOT NULL DEFAULT 'full_plan'
                      CHECK (plan_type IN ('full_plan','resources','activities','analysis')),
  topic             TEXT,
  duration_minutes  INT DEFAULT 45,
  kb_principles     TEXT[] DEFAULT '{}',
  context_notes     TEXT,
  content           JSONB NOT NULL DEFAULT '{}',
  classroom_context JSONB DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','generating','completed','error')),
  version           INT NOT NULL DEFAULT 1,
  parent_id         UUID REFERENCES lesson_plans(id) ON DELETE SET NULL,
  provider_id       TEXT,
  model             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_plans_course ON lesson_plans(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_user   ON lesson_plans(created_by, created_at DESC);

ALTER TABLE lesson_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY lesson_plans_select ON lesson_plans FOR SELECT
  USING (created_by = auth.uid());
CREATE POLICY lesson_plans_insert ON lesson_plans FOR INSERT
  WITH CHECK (created_by = auth.uid());
CREATE POLICY lesson_plans_update ON lesson_plans FOR UPDATE
  USING (created_by = auth.uid());
CREATE POLICY lesson_plans_delete ON lesson_plans FOR DELETE
  USING (created_by = auth.uid());
