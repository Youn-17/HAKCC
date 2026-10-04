-- Cluster-randomized experiment support for AI auto-feedback.
-- Assignment unit is the GROUP: treatment groups receive proactive AI
-- feedback, control groups have proactive chains suppressed (shadow-logged).
-- NULL condition = group not in an experiment; course-level settings apply.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS ai_feedback_condition varchar(16)
  CHECK (ai_feedback_condition IN ('treatment', 'control'));

-- Group-bound spaces: when group_id is set, only that group's members
-- (plus teachers/admins) may access the space — contains cross-group
-- contamination of the treatment effect.
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_spaces_group_id ON spaces(group_id) WHERE group_id IS NOT NULL;

-- Shadow logging: interventions that WOULD have fired for control-group
-- students are recorded with suppressed = true (rule-based detection only,
-- nothing is delivered). group_id enables per-cluster analysis.
ALTER TABLE ai_interventions ADD COLUMN IF NOT EXISTS suppressed boolean NOT NULL DEFAULT false;
ALTER TABLE ai_interventions ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS idx_ai_interventions_group ON ai_interventions(group_id) WHERE group_id IS NOT NULL;
