-- 012_research_features.sql
-- Adds condition_assignments table and export_salt column for research features

-- ── Condition Assignments (student → experiment condition) ──────
CREATE TABLE IF NOT EXISTS condition_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id  UUID NOT NULL REFERENCES experiment_conditions(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by   UUID REFERENCES users(id),
  UNIQUE(condition_id, user_id)
);

CREATE INDEX idx_condition_assignments_condition ON condition_assignments(condition_id);
CREATE INDEX idx_condition_assignments_user ON condition_assignments(user_id);

-- ── RLS for condition_assignments ──────────────────────────────
ALTER TABLE condition_assignments ENABLE ROW LEVEL SECURITY;

-- Teachers/admins can read all assignments; students can see their own
CREATE POLICY condition_assignments_select ON condition_assignments FOR SELECT
  USING (
    user_id = auth.uid() OR is_teacher_or_admin()
  );

-- Only teachers/admins can manage assignments
CREATE POLICY condition_assignments_insert ON condition_assignments FOR INSERT
  WITH CHECK (is_teacher_or_admin());

CREATE POLICY condition_assignments_delete ON condition_assignments FOR DELETE
  USING (is_teacher_or_admin());

-- ── Export salt for anonymous data export ──────────────────────
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS export_salt VARCHAR(64);
