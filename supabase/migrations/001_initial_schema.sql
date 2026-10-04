-- ============================================================
-- HAKCC — Initial Schema
-- 001_initial_schema.sql
-- ============================================================

-- ── ENUM Types ───────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'pending', 'inactive');

CREATE TYPE note_type AS ENUM (
  'note', 'drawing', 'attachment', 'video', 'link', 'view', 'riseabove'
);

CREATE TYPE relation_type AS ENUM (
  'extend', 'clarify', 'question', 'challenge', 'evidence', 'synthesize'
);

CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'done');
CREATE TYPE ssrl_phase AS ENUM ('planning', 'monitoring', 'evaluating');
CREATE TYPE notification_type AS ENUM ('system', 'task', 'buildon', 'mention', 'teacher');
CREATE TYPE view_layout AS ENUM ('free', 'grid', 'list', 'timeline', 'network');
CREATE TYPE view_type AS ENUM ('personal', 'shared', 'system');
CREATE TYPE ai_visibility AS ENUM ('private', 'group', 'public', 'teacher_only');
CREATE TYPE scope_type AS ENUM ('note', 'space', 'course', 'user');

-- ── Users ────────────────────────────────────────────────────

CREATE TABLE users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  role        user_role NOT NULL DEFAULT 'student',
  status      user_status NOT NULL DEFAULT 'active',
  avatar      TEXT,
  profile_json JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- ── Courses ──────────────────────────────────────────────────

CREATE TABLE courses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             VARCHAR(200) NOT NULL,
  instructor_id     UUID NOT NULL REFERENCES users(id),
  cover_image       TEXT,
  tags              TEXT[] DEFAULT '{}',
  verification_code VARCHAR(20),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE course_members (
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);

-- ── Inquiry Spaces ───────────────────────────────────────────

CREATE TABLE spaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(200) NOT NULL,
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES users(id),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Notes ────────────────────────────────────────────────────

CREATE TABLE notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id          UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  author_id         UUID NOT NULL REFERENCES users(id),
  type              note_type NOT NULL DEFAULT 'note',
  title             VARCHAR(300) NOT NULL,
  content           TEXT,
  summary           VARCHAR(500),
  modality_type     VARCHAR(50),
  epistemic_status  VARCHAR(50),
  scaffold_id       UUID,
  scaffold_responses JSONB,
  x                 FLOAT NOT NULL DEFAULT 0,
  y                 FLOAT NOT NULL DEFAULT 0,
  width             FLOAT,
  height            FLOAT,
  tags              TEXT[] DEFAULT '{}',
  views             UUID[] DEFAULT '{}',
  cited_note_ids    UUID[] DEFAULT '{}',
  rise_above_data   JSONB,
  file_url          TEXT,
  file_name         VARCHAR(255),
  mime_type         VARCHAR(100),
  drawing_data      JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE TABLE note_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id         UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  revision_number INT NOT NULL,
  title           VARCHAR(300),
  content         TEXT,
  editor_id       UUID NOT NULL REFERENCES users(id),
  change_summary  TEXT,
  edited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(note_id, revision_number)
);

-- ── Note Realtime Metrics ─────────────────────────────────────

CREATE TABLE note_metrics_realtime (
  note_id                  UUID PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  direct_in_degree         INT NOT NULL DEFAULT 0,
  direct_out_degree        INT NOT NULL DEFAULT 0,
  build_on_count           INT NOT NULL DEFAULT 0,
  unique_contributor_count INT NOT NULL DEFAULT 0,
  revision_count           INT NOT NULL DEFAULT 0,
  challenge_count          INT NOT NULL DEFAULT 0,
  evidence_count           INT NOT NULL DEFAULT 0,
  synthesis_count          INT NOT NULL DEFAULT 0,
  recent_activity_score    FLOAT NOT NULL DEFAULT 0,
  heat_score               FLOAT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Relations (Build-on) ─────────────────────────────────────

CREATE TABLE relations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_note_id  UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id  UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  relation_type   relation_type NOT NULL,
  creator_id      UUID NOT NULL REFERENCES users(id),
  ai_suggested    BOOLEAN NOT NULL DEFAULT false,
  ai_accepted     BOOLEAN,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_note_id <> target_note_id)
);

CREATE TABLE relation_aggregates (
  relation_id           UUID PRIMARY KEY REFERENCES relations(id) ON DELETE CASCADE,
  occurrence_count      INT NOT NULL DEFAULT 1,
  repeated_uptake_count INT NOT NULL DEFAULT 0,
  latest_activity_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cached_strength_score FLOAT NOT NULL DEFAULT 1.0
);

-- ── Events (append-only audit log) ───────────────────────────

CREATE TABLE events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role       VARCHAR(20),
  event_type       VARCHAR(50) NOT NULL,
  object_type      VARCHAR(50) NOT NULL,
  object_id        UUID NOT NULL,
  space_id         UUID REFERENCES spaces(id) ON DELETE SET NULL,
  target_note_id   UUID,
  related_note_id  UUID,
  metadata_json    JSONB DEFAULT '{}'::jsonb,
  condition_id     UUID,
  session_id       VARCHAR(50),
  client_version   VARCHAR(20),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── AI Interventions ─────────────────────────────────────────

CREATE TABLE ai_interventions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id                UUID REFERENCES spaces(id) ON DELETE SET NULL,
  note_id                 UUID REFERENCES notes(id) ON DELETE SET NULL,
  user_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
  trigger_type            VARCHAR(50) NOT NULL,
  trigger_context         JSONB DEFAULT '{}'::jsonb,
  prompt_template_version VARCHAR(20),
  provider_id             VARCHAR(50),
  model_name              VARCHAR(100),
  input_context_summary   TEXT,
  response_text           TEXT,
  visibility_scope        ai_visibility NOT NULL DEFAULT 'private',
  accepted_flag           BOOLEAN,
  followed_by_action      BOOLEAN,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Groups & SSRL ─────────────────────────────────────────────

CREATE TABLE groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  leader_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  color      VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE group_tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title          VARCHAR(200) NOT NULL,
  description    TEXT,
  assigned_to_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_id  UUID NOT NULL REFERENCES users(id),
  status         task_status NOT NULL DEFAULT 'todo',
  ssrl_phase     ssrl_phase NOT NULL DEFAULT 'planning',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Scaffolds ─────────────────────────────────────────────────

CREATE TABLE scaffolds (
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
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Notifications ─────────────────────────────────────────────

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  title      VARCHAR(200) NOT NULL,
  message    TEXT NOT NULL,
  read       BOOLEAN NOT NULL DEFAULT false,
  link_type  VARCHAR(20),
  link_id    UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Views (ViewDefinition) ────────────────────────────────────

CREATE TABLE views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  creator_id      UUID NOT NULL REFERENCES users(id),
  type            view_type NOT NULL DEFAULT 'personal',
  is_locked       BOOLEAN NOT NULL DEFAULT false,
  parent_view_id  UUID REFERENCES views(id) ON DELETE SET NULL,
  filter          JSONB DEFAULT '{}'::jsonb,
  layout          view_layout NOT NULL DEFAULT 'free',
  sort            VARCHAR(50) NOT NULL DEFAULT 'date_desc',
  display_options JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Teacher AI Configs ────────────────────────────────────────

CREATE TABLE teacher_ai_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  provider_id       VARCHAR(50) NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  endpoint_url      TEXT,
  is_verified       BOOLEAN NOT NULL DEFAULT false,
  enabled_models    TEXT[] DEFAULT '{}',
  configured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(course_id, provider_id)
);

-- ── Analytics Snapshots ───────────────────────────────────────

CREATE TABLE analytics_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type   scope_type NOT NULL,
  scope_id     UUID NOT NULL,
  metric_name  VARCHAR(100) NOT NULL,
  metric_value JSONB NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_type  VARCHAR(20) NOT NULL DEFAULT 'daily',
  model_version VARCHAR(20)
);

-- ── Experiment Conditions ─────────────────────────────────────

CREATE TABLE experiment_conditions (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id                     UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  condition_name               VARCHAR(100) NOT NULL,
  ai_enabled                   BOOLEAN NOT NULL DEFAULT true,
  visibility_mode              VARCHAR(50),
  threshold_profile            JSONB DEFAULT '{}'::jsonb,
  intervention_policy_version  VARCHAR(20),
  woz_enabled                  BOOLEAN NOT NULL DEFAULT false,
  woz_operator_id              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────

CREATE INDEX idx_notes_space ON notes(space_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_author ON notes(author_id);
CREATE INDEX idx_relations_source ON relations(source_note_id);
CREATE INDEX idx_relations_target ON relations(target_note_id);
CREATE INDEX idx_relations_type ON relations(relation_type);
CREATE INDEX idx_events_space_time ON events(space_id, created_at DESC);
CREATE INDEX idx_events_actor ON events(actor_id, created_at DESC);
CREATE INDEX idx_events_type ON events(event_type, created_at DESC);
CREATE INDEX idx_ai_interventions_space ON ai_interventions(space_id, created_at DESC);
CREATE INDEX idx_analytics_scope ON analytics_snapshots(scope_type, scope_id, computed_at DESC);
CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);
CREATE INDEX idx_group_tasks ON group_tasks(group_id, status);
CREATE INDEX idx_note_metrics_heat ON note_metrics_realtime(heat_score DESC);

-- ── Helper Functions ──────────────────────────────────────────

-- Safely increment a counter field on note_metrics_realtime
CREATE OR REPLACE FUNCTION increment_note_metric(
  p_note_id UUID,
  p_field   TEXT,
  p_delta   INT DEFAULT 1
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'UPDATE note_metrics_realtime SET %I = GREATEST(0, %I + $1), updated_at = now() WHERE note_id = $2',
    p_field, p_field
  ) USING p_delta, p_note_id;
END;
$$;

-- Increment both in/out degree atomically
CREATE OR REPLACE FUNCTION increment_direct_degrees(
  p_source_id UUID,
  p_target_id UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE note_metrics_realtime
  SET direct_out_degree = direct_out_degree + 1, updated_at = now()
  WHERE note_id = p_source_id;

  UPDATE note_metrics_realtime
  SET direct_in_degree = direct_in_degree + 1, updated_at = now()
  WHERE note_id = p_target_id;
END;
$$;

-- Auto-update notes.updated_at
CREATE OR REPLACE FUNCTION touch_note_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION touch_note_updated_at();
