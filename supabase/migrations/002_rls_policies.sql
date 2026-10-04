-- ============================================================
-- HAKCC — Row Level Security Policies
-- 002_rls_policies.sql
-- ============================================================

-- Helper function: check if the current user is a member of a course
CREATE OR REPLACE FUNCTION is_course_member(p_course_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM course_members
    WHERE course_id = p_course_id AND user_id = auth.uid()
  );
$$;

-- Helper function: get course_id from a space_id
CREATE OR REPLACE FUNCTION get_space_course(p_space_id UUID)
RETURNS UUID LANGUAGE sql SECURITY DEFINER AS $$
  SELECT course_id FROM spaces WHERE id = p_space_id;
$$;

-- Helper function: check if current user is teacher or admin
CREATE OR REPLACE FUNCTION is_teacher_or_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('teacher', 'admin')
  );
$$;

-- ── users ─────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read user profiles
CREATE POLICY users_select ON users FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Users can update their own profile
CREATE POLICY users_update ON users FOR UPDATE
  USING (id = auth.uid());

-- Only service role can insert (done via admin API in auth.ts)
-- No INSERT policy needed for anon/authenticated

-- ── courses ───────────────────────────────────────────────────
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY courses_select ON courses FOR SELECT
  USING (is_course_member(id) OR is_teacher_or_admin());

CREATE POLICY courses_insert ON courses FOR INSERT
  WITH CHECK (is_teacher_or_admin());

CREATE POLICY courses_update ON courses FOR UPDATE
  USING (instructor_id = auth.uid() OR
         EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ── course_members ─────────────────────────────────────────────
ALTER TABLE course_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY course_members_select ON course_members FOR SELECT
  USING (user_id = auth.uid() OR is_teacher_or_admin());

CREATE POLICY course_members_insert ON course_members FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_teacher_or_admin());

-- ── spaces ────────────────────────────────────────────────────
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY spaces_select ON spaces FOR SELECT
  USING (is_course_member(course_id));

CREATE POLICY spaces_insert ON spaces FOR INSERT
  WITH CHECK (is_teacher_or_admin() AND is_course_member(course_id));

-- ── notes ─────────────────────────────────────────────────────
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- All space members can read non-deleted notes
CREATE POLICY notes_select ON notes FOR SELECT
  USING (
    deleted_at IS NULL AND
    is_course_member(get_space_course(space_id))
  );

-- Any authenticated space member can create a note
CREATE POLICY notes_insert ON notes FOR INSERT
  WITH CHECK (
    author_id = auth.uid() AND
    is_course_member(get_space_course(space_id))
  );

-- Authors, teachers, admins can update
CREATE POLICY notes_update ON notes FOR UPDATE
  USING (
    author_id = auth.uid() OR is_teacher_or_admin()
  );

-- ── note_revisions ────────────────────────────────────────────
ALTER TABLE note_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_revisions_select ON note_revisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM notes n
      WHERE n.id = note_id
        AND is_course_member(get_space_course(n.space_id))
    )
  );

-- ── note_metrics_realtime ─────────────────────────────────────
ALTER TABLE note_metrics_realtime ENABLE ROW LEVEL SECURITY;

-- All space members can read metrics (for node sizing/coloring)
CREATE POLICY metrics_select ON note_metrics_realtime FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM notes n
      WHERE n.id = note_id
        AND is_course_member(get_space_course(n.space_id))
    )
  );

-- Only service role can insert/update (done via backend)

-- ── relations ─────────────────────────────────────────────────
ALTER TABLE relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY relations_select ON relations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM notes n
      WHERE n.id = source_note_id
        AND is_course_member(get_space_course(n.space_id))
    )
  );

CREATE POLICY relations_insert ON relations FOR INSERT
  WITH CHECK (
    creator_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM notes n
      WHERE n.id = source_note_id
        AND is_course_member(get_space_course(n.space_id))
    )
  );

CREATE POLICY relations_delete ON relations FOR DELETE
  USING (creator_id = auth.uid() OR is_teacher_or_admin());

-- ── relation_aggregates ────────────────────────────────────────
ALTER TABLE relation_aggregates ENABLE ROW LEVEL SECURITY;

CREATE POLICY relation_aggregates_select ON relation_aggregates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM relations r
      JOIN notes n ON n.id = r.source_note_id
      WHERE r.id = relation_id
        AND is_course_member(get_space_course(n.space_id))
    )
  );

-- ── events ────────────────────────────────────────────────────
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Only teachers and admins can read events (via research/teacher dashboards)
CREATE POLICY events_select ON events FOR SELECT
  USING (is_teacher_or_admin());

-- INSERT is done exclusively by the backend service role (bypasses RLS)
-- No INSERT policy for anon/authenticated

-- ── ai_interventions ──────────────────────────────────────────
ALTER TABLE ai_interventions ENABLE ROW LEVEL SECURITY;

-- Users can see their own private interventions; teachers/admins see all
CREATE POLICY ai_interventions_select ON ai_interventions FOR SELECT
  USING (
    user_id = auth.uid() OR is_teacher_or_admin()
  );

-- ── notifications ─────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (user_id = auth.uid());

-- ── groups ────────────────────────────────────────────────────
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY groups_select ON groups FOR SELECT
  USING (is_course_member(course_id));

CREATE POLICY groups_insert ON groups FOR INSERT
  WITH CHECK (is_teacher_or_admin());

-- ── group_members ─────────────────────────────────────────────
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_members_select ON group_members FOR SELECT
  USING (
    user_id = auth.uid() OR is_teacher_or_admin()
  );

-- ── group_tasks ────────────────────────────────────────────────
ALTER TABLE group_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_tasks_select ON group_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_tasks.group_id AND gm.user_id = auth.uid()
    ) OR is_teacher_or_admin()
  );

CREATE POLICY group_tasks_insert ON group_tasks FOR INSERT
  WITH CHECK (
    created_by_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_tasks.group_id AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY group_tasks_update ON group_tasks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_tasks.group_id AND gm.user_id = auth.uid()
    ) OR is_teacher_or_admin()
  );

-- ── scaffolds ─────────────────────────────────────────────────
ALTER TABLE scaffolds ENABLE ROW LEVEL SECURITY;

CREATE POLICY scaffolds_select ON scaffolds FOR SELECT
  USING (
    course_id IS NULL OR  -- global scaffolds visible to all
    is_course_member(course_id)
  );

CREATE POLICY scaffolds_insert ON scaffolds FOR INSERT
  WITH CHECK (is_teacher_or_admin());

CREATE POLICY scaffolds_update ON scaffolds FOR UPDATE
  USING (created_by = auth.uid() OR
         EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ── views ─────────────────────────────────────────────────────
ALTER TABLE views ENABLE ROW LEVEL SECURITY;

CREATE POLICY views_select ON views FOR SELECT
  USING (
    type = 'system' OR
    creator_id = auth.uid() OR
    (type = 'shared' AND is_course_member(get_space_course(space_id)))
  );

CREATE POLICY views_insert ON views FOR INSERT
  WITH CHECK (
    creator_id = auth.uid() AND
    is_course_member(get_space_course(space_id))
  );

CREATE POLICY views_update ON views FOR UPDATE
  USING (
    creator_id = auth.uid() OR
    (is_teacher_or_admin() AND is_locked = true)
  );

-- ── analytics_snapshots ────────────────────────────────────────
ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY;

-- Only teachers/admins can read snapshots; service role writes
CREATE POLICY snapshots_select ON analytics_snapshots FOR SELECT
  USING (is_teacher_or_admin());
