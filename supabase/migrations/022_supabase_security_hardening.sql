-- ============================================================
-- HAKCC — Supabase Security Hardening
-- 022_supabase_security_hardening.sql
-- ============================================================

-- Make the compatibility users view obey the querying user's RLS privileges.
ALTER VIEW IF EXISTS public.users SET (security_invoker = true);

-- Remove the legacy two-argument metric function. It was SECURITY DEFINER,
-- had a mutable search_path, and missed newer move-type counters.
DROP FUNCTION IF EXISTS public.increment_note_metric(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.increment_note_metric(
  p_note_id UUID,
  p_field TEXT,
  p_delta INT DEFAULT 1
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_field NOT IN (
    'direct_in_degree',
    'direct_out_degree',
    'build_on_count',
    'revision_count',
    'challenge_count',
    'evidence_count',
    'synthesis_count',
    'extend_count',
    'clarify_count',
    'question_count',
    'unresolved_challenges'
  ) THEN
    RAISE EXCEPTION 'Unsupported note metric field: %', p_field;
  END IF;

  EXECUTE format(
    'UPDATE public.note_metrics_realtime SET %I = GREATEST(0, %I + $1), updated_at = now() WHERE note_id = $2',
    p_field,
    p_field
  ) USING p_delta, p_note_id;
END;
$$;

-- Fix mutable search_path on helper and trigger functions.
CREATE OR REPLACE FUNCTION public.is_course_member(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.course_members
    WHERE course_id = p_course_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.get_space_course(p_space_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT course_id FROM public.spaces WHERE id = p_space_id;
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role IN ('teacher', 'admin') AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.update_note_conversation_thread_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.note_conversation_threads
  SET updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_note_feedbacks_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_teacher() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_note_conversation_creator(UUID, UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_note_conversation_participant(UUID, UUID) SET search_path = public, pg_temp;

-- Prevent public RPC execution of internal helper functions.
REVOKE EXECUTE ON FUNCTION public.get_space_course(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_note_metric(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_course_member(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_note_conversation_creator(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_note_conversation_participant(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_teacher() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_teacher_or_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_note_conversation_thread_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_note_feedbacks_updated_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_course_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_space_course(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_note_conversation_creator(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_note_conversation_participant(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_teacher() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_teacher_or_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_note_metric(UUID, TEXT, INT) TO service_role;

-- RLS for collaboration tables that were added after the initial policies.
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scaffolds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS groups_select ON public.groups;
CREATE POLICY groups_select ON public.groups FOR SELECT
  USING (public.is_teacher_or_admin() OR public.is_course_member(course_id));

DROP POLICY IF EXISTS groups_insert ON public.groups;
CREATE POLICY groups_insert ON public.groups FOR INSERT
  WITH CHECK (public.is_teacher_or_admin());

DROP POLICY IF EXISTS groups_update ON public.groups;
CREATE POLICY groups_update ON public.groups FOR UPDATE
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());

DROP POLICY IF EXISTS groups_delete ON public.groups;
CREATE POLICY groups_delete ON public.groups FOR DELETE
  USING (public.is_teacher_or_admin());

DROP POLICY IF EXISTS group_members_select ON public.group_members;
CREATE POLICY group_members_select ON public.group_members FOR SELECT
  USING (
    public.is_teacher_or_admin() OR EXISTS (
      SELECT 1
      FROM public.groups g
      WHERE g.id = group_members.group_id
        AND public.is_course_member(g.course_id)
    )
  );

DROP POLICY IF EXISTS group_members_insert ON public.group_members;
CREATE POLICY group_members_insert ON public.group_members FOR INSERT
  WITH CHECK (public.is_teacher_or_admin());

DROP POLICY IF EXISTS group_members_delete ON public.group_members;
CREATE POLICY group_members_delete ON public.group_members FOR DELETE
  USING (public.is_teacher_or_admin());

DROP POLICY IF EXISTS group_tasks_select ON public.group_tasks;
CREATE POLICY group_tasks_select ON public.group_tasks FOR SELECT
  USING (
    public.is_teacher_or_admin() OR EXISTS (
      SELECT 1
      FROM public.groups g
      WHERE g.id = group_tasks.group_id
        AND public.is_course_member(g.course_id)
    )
  );

DROP POLICY IF EXISTS group_tasks_insert ON public.group_tasks;
CREATE POLICY group_tasks_insert ON public.group_tasks FOR INSERT
  WITH CHECK (
    public.is_teacher_or_admin() OR (
      created_by_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.group_members gm
        WHERE gm.group_id = group_tasks.group_id
          AND gm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS group_tasks_update ON public.group_tasks;
CREATE POLICY group_tasks_update ON public.group_tasks FOR UPDATE
  USING (
    public.is_teacher_or_admin()
    OR created_by_id = auth.uid()
    OR assigned_to_id = auth.uid()
  )
  WITH CHECK (
    public.is_teacher_or_admin()
    OR created_by_id = auth.uid()
    OR assigned_to_id = auth.uid()
  );

DROP POLICY IF EXISTS group_tasks_delete ON public.group_tasks;
CREATE POLICY group_tasks_delete ON public.group_tasks FOR DELETE
  USING (public.is_teacher_or_admin() OR created_by_id = auth.uid());

DROP POLICY IF EXISTS scaffolds_select ON public.scaffolds;
CREATE POLICY scaffolds_select ON public.scaffolds FOR SELECT
  USING (
    course_id IS NULL
    OR public.is_teacher_or_admin()
    OR public.is_course_member(course_id)
  );

DROP POLICY IF EXISTS scaffolds_insert ON public.scaffolds;
CREATE POLICY scaffolds_insert ON public.scaffolds FOR INSERT
  WITH CHECK (public.is_teacher_or_admin());

DROP POLICY IF EXISTS scaffolds_update ON public.scaffolds;
CREATE POLICY scaffolds_update ON public.scaffolds FOR UPDATE
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());

DROP POLICY IF EXISTS scaffolds_delete ON public.scaffolds;
CREATE POLICY scaffolds_delete ON public.scaffolds FOR DELETE
  USING (public.is_teacher_or_admin());

DROP POLICY IF EXISTS "Teachers can manage feedbacks" ON public.note_feedbacks;
DROP POLICY IF EXISTS "Students read published feedback on own notes" ON public.note_feedbacks;
DROP POLICY IF EXISTS note_feedbacks_manage ON public.note_feedbacks;
CREATE POLICY note_feedbacks_manage ON public.note_feedbacks FOR ALL
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());

DROP POLICY IF EXISTS note_feedbacks_student_select ON public.note_feedbacks;
CREATE POLICY note_feedbacks_student_select ON public.note_feedbacks FOR SELECT
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1
      FROM public.notes n
      WHERE n.id = note_feedbacks.note_id
        AND n.author_id = auth.uid()
    )
  );

-- Remove over-broad policies that were granted to public. The service_role
-- already bypasses RLS; keeping public true policies weakens the model.
DROP POLICY IF EXISTS "Service role full access" ON public.ai_interventions;
DROP POLICY IF EXISTS "Service role full access" ON public.teacher_ai_configs;
DROP POLICY IF EXISTS course_members_service_role ON public.course_members;
DROP POLICY IF EXISTS events_service_role ON public.events;
DROP POLICY IF EXISTS metrics_service_role ON public.note_metrics_realtime;
DROP POLICY IF EXISTS revisions_service_role ON public.note_revisions;
DROP POLICY IF EXISTS notes_service_role ON public.notes;
DROP POLICY IF EXISTS notifications_service_role ON public.notifications;
DROP POLICY IF EXISTS relations_service_role ON public.relations;
DROP POLICY IF EXISTS spaces_service_role ON public.spaces;

-- Keep unauthenticated visitors away from direct table and RPC discovery.
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE USAGE ON ALL SEQUENCES IN SCHEMA public FROM anon;
