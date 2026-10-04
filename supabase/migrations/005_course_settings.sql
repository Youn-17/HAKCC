-- ============================================================
-- HAKCC — Course Settings (Goals, Materials, Tasks)
-- 005_course_settings.sql
-- ============================================================

-- ── ENUM Types ───────────────────────────────────────────────────

CREATE TYPE task_submission_status AS ENUM ('pending', 'submitted', 'graded', 'returned');
CREATE TYPE task_submission_type AS ENUM ('text', 'file', 'drawing', 'video', 'mixed');
CREATE TYPE course_task_status AS ENUM ('draft', 'published', 'closed');

-- ── Course Goals Table ───────────────────────────────────────────
-- Learning objectives for each course

CREATE TABLE course_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  priority    INT NOT NULL DEFAULT 0,  -- For ordering; higher = higher priority
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Index for ordering goals by priority
CREATE INDEX idx_course_goals_course_priority ON course_goals(course_id, priority DESC);

-- ── Course Materials Table ────────────────────────────────────────
-- Files, PDFs, videos uploaded by teachers

CREATE TABLE course_materials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title             VARCHAR(200) NOT NULL,
  description       TEXT,
  file_url          TEXT NOT NULL,
  file_name         VARCHAR(255) NOT NULL,
  file_size         INT,                    -- Size in bytes
  mime_type         VARCHAR(100),
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  allow_comments    BOOLEAN NOT NULL DEFAULT true,
  allow_annotations BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for course materials
CREATE INDEX idx_course_materials_course ON course_materials(course_id, created_at DESC);

-- ── Material Comments Table ───────────────────────────────────────
-- Comments and annotations on course materials

CREATE TABLE material_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id     UUID NOT NULL REFERENCES course_materials(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  annotation_data JSONB DEFAULT '{}'::jsonb,  -- Store annotation position, highlighted text, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for material comments
CREATE INDEX idx_material_comments_material ON material_comments(material_id, created_at ASC);

-- ── Course Tasks Table ────────────────────────────────────────────
-- Assignments and homework for students

CREATE TABLE course_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  due_date    TIMESTAMPTZ,
  points      INT NOT NULL DEFAULT 0,
  status      course_task_status NOT NULL DEFAULT 'published',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for course tasks
CREATE INDEX idx_course_tasks_course ON course_tasks(course_id, created_at DESC);
CREATE INDEX idx_course_tasks_due ON course_tasks(due_date);

-- ── Task Submissions Table ────────────────────────────────────────
-- Student submissions (supporting multiple formats)

CREATE TABLE task_submissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        UUID NOT NULL REFERENCES course_tasks(id) ON DELETE CASCADE,
  student_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content        TEXT,                      -- Text description
  file_url       TEXT,                      -- Attachment file
  file_name      VARCHAR(255),
  drawing_data   JSONB DEFAULT '{}'::jsonb,  -- Drawing/annotation data
  video_url      TEXT,                      -- Video link (e.g., YouTube, Loom)
  submission_type task_submission_type NOT NULL DEFAULT 'text',
  status         task_submission_status NOT NULL DEFAULT 'pending',
  submitted_at   TIMESTAMPTZ,
  graded_at      TIMESTAMPTZ,
  feedback       TEXT,
  points_awarded INT,
  UNIQUE(task_id, student_id)  -- One submission per student per task
);

-- Index for task submissions
CREATE INDEX idx_task_submissions_task ON task_submissions(task_id);
CREATE INDEX idx_task_submissions_student ON task_submissions(student_id);
CREATE INDEX idx_task_submissions_status ON task_submissions(status);

-- ── Row Level Security Policies ───────────────────────────────────

-- ── course_goals ─────────────────────────────────────────────────

ALTER TABLE course_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY course_goals_select ON course_goals FOR SELECT
  USING (is_course_member(course_id));

CREATE POLICY course_goals_insert ON course_goals FOR INSERT
  WITH CHECK (
    (created_by = auth.uid() OR created_by IS NULL) AND
    EXISTS (
      SELECT 1 FROM courses
      WHERE id = course_id AND instructor_id = auth.uid()
    )
  );

CREATE POLICY course_goals_update ON course_goals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM courses
      WHERE id = course_id AND instructor_id = auth.uid()
    )
  );

CREATE POLICY course_goals_delete ON course_goals FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM courses
      WHERE id = course_id AND instructor_id = auth.uid()
    )
  );

-- ── course_materials ─────────────────────────────────────────────

ALTER TABLE course_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY course_materials_select ON course_materials FOR SELECT
  USING (is_course_member(course_id));

CREATE POLICY course_materials_insert ON course_materials FOR INSERT
  WITH CHECK (
    (uploaded_by = auth.uid() OR uploaded_by IS NULL) AND
    EXISTS (
      SELECT 1 FROM courses
      WHERE id = course_id AND instructor_id = auth.uid()
    )
  );

CREATE POLICY course_materials_delete ON course_materials FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM courses
      WHERE id = course_id AND instructor_id = auth.uid()
    )
  );

-- ── material_comments ────────────────────────────────────────────

ALTER TABLE material_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY material_comments_select ON material_comments FOR SELECT
  USING (
    is_course_member(
      (SELECT course_id FROM course_materials WHERE id = material_id)
    )
  );

CREATE POLICY material_comments_insert ON material_comments FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    is_course_member(
      (SELECT course_id FROM course_materials WHERE id = material_id)
    )
  );

CREATE POLICY material_comments_update ON material_comments FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY material_comments_delete ON material_comments FOR DELETE
  USING (user_id = auth.uid() OR is_teacher_or_admin());

-- ── course_tasks ─────────────────────────────────────────────────

ALTER TABLE course_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY course_tasks_select ON course_tasks FOR SELECT
  USING (is_course_member(course_id));

CREATE POLICY course_tasks_insert ON course_tasks FOR INSERT
  WITH CHECK (
    (created_by = auth.uid() OR created_by IS NULL) AND
    EXISTS (
      SELECT 1 FROM courses
      WHERE id = course_id AND instructor_id = auth.uid()
    )
  );

CREATE POLICY course_tasks_update ON course_tasks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM courses
      WHERE id = course_id AND instructor_id = auth.uid()
    )
  );

CREATE POLICY course_tasks_delete ON course_tasks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM courses
      WHERE id = course_id AND instructor_id = auth.uid()
    )
  );

-- ── task_submissions ─────────────────────────────────────────────

ALTER TABLE task_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_submissions_select ON task_submissions FOR SELECT
  USING (
    student_id = auth.uid() OR
    is_teacher_or_admin()
  );

CREATE POLICY task_submissions_insert ON task_submissions FOR INSERT
  WITH CHECK (
    student_id = auth.uid() AND
    is_course_member(
      (SELECT course_id FROM course_tasks WHERE id = task_id)
    )
  );

CREATE POLICY task_submissions_update ON task_submissions FOR UPDATE
  USING (
    student_id = auth.uid() OR
    is_teacher_or_admin()
  );

CREATE POLICY task_submissions_delete ON task_submissions FOR DELETE
  USING (
    student_id = auth.uid() OR
    is_teacher_or_admin()
  );

-- ── Helper Functions ─────────────────────────────────────────────

-- Auto-update course_tasks.updated_at
CREATE OR REPLACE FUNCTION touch_course_task_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_course_tasks_updated_at
  BEFORE UPDATE ON course_tasks
  FOR EACH ROW EXECUTE FUNCTION touch_course_task_updated_at();
