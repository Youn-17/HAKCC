-- 030_agent_runs_effects.sql
-- Unified agent lifecycle: durable runs + fine-grained effect stream + checkpoints

-- Each agent invocation (lesson gen, chat turn, analytics load) = one run
CREATE TABLE IF NOT EXISTS agent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id       UUID REFERENCES courses(id) ON DELETE SET NULL,
  agent_type      TEXT NOT NULL
                    CHECK (agent_type IN ('chat', 'lesson_prep', 'analytics', 'assessment')),
  status          TEXT NOT NULL DEFAULT 'planning'
                    CHECK (status IN ('planning', 'gathering', 'executing', 'reviewing', 'applied', 'failed', 'cancelled')),
  title           TEXT,
  input           JSONB DEFAULT '{}',
  output          JSONB DEFAULT '{}',
  context_snapshot JSONB DEFAULT '{}',
  version         INT NOT NULL DEFAULT 1,
  parent_run_id   UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user
  ON agent_runs(user_id, course_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_type
  ON agent_runs(agent_type, status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent
  ON agent_runs(parent_run_id);

-- Every agent action = one effect (tool call, context load, LLM event, etc.)
CREATE TABLE IF NOT EXISTS agent_effects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq         INT NOT NULL,
  effect_type TEXT NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_effects_run
  ON agent_effects(run_id, seq);

-- Named savepoints within a run for rollback
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  seq_at      INT NOT NULL,
  snapshot    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, name)
);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY ar_select ON agent_runs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY ar_insert ON agent_runs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY ar_update ON agent_runs FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY ae_select ON agent_effects FOR SELECT
  USING (run_id IN (SELECT id FROM agent_runs WHERE user_id = auth.uid()));
CREATE POLICY ae_insert ON agent_effects FOR INSERT
  WITH CHECK (run_id IN (SELECT id FROM agent_runs WHERE user_id = auth.uid()));
CREATE POLICY ae_delete ON agent_effects FOR DELETE
  USING (run_id IN (SELECT id FROM agent_runs WHERE user_id = auth.uid()));

CREATE POLICY ac_select ON agent_checkpoints FOR SELECT
  USING (run_id IN (SELECT id FROM agent_runs WHERE user_id = auth.uid()));
CREATE POLICY ac_insert ON agent_checkpoints FOR INSERT
  WITH CHECK (run_id IN (SELECT id FROM agent_runs WHERE user_id = auth.uid()));
CREATE POLICY ac_delete ON agent_checkpoints FOR DELETE
  USING (run_id IN (SELECT id FROM agent_runs WHERE user_id = auth.uid()));
