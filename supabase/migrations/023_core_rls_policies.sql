-- ============================================================
-- HAKCC — Core RLS Policies After Service-Role Policy Removal
-- 023_core_rls_policies.sql
-- ============================================================

-- Courses/spaces membership helpers are used by these policies. Backend
-- service-role operations still bypass RLS; these policies protect direct
-- Supabase access from the browser and keep realtime subscriptions scoped.

DROP POLICY IF EXISTS course_members_select ON public.course_members;
CREATE POLICY course_members_select ON public.course_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_teacher_or_admin());

DROP POLICY IF EXISTS course_members_insert_self ON public.course_members;
CREATE POLICY course_members_insert_self ON public.course_members FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_teacher_or_admin());

DROP POLICY IF EXISTS spaces_select ON public.spaces;
CREATE POLICY spaces_select ON public.spaces FOR SELECT
  USING (public.is_teacher_or_admin() OR public.is_course_member(course_id));

DROP POLICY IF EXISTS spaces_insert ON public.spaces;
CREATE POLICY spaces_insert ON public.spaces FOR INSERT
  WITH CHECK (public.is_teacher_or_admin());

DROP POLICY IF EXISTS spaces_update ON public.spaces;
CREATE POLICY spaces_update ON public.spaces FOR UPDATE
  USING (public.is_teacher_or_admin() OR created_by = auth.uid())
  WITH CHECK (public.is_teacher_or_admin() OR created_by = auth.uid());

-- Replace legacy course_id note policies with space_id-aware policies.
DROP POLICY IF EXISTS "notes: read if enrolled or teacher" ON public.notes;
DROP POLICY IF EXISTS "notes: insert if enrolled or teacher" ON public.notes;
DROP POLICY IF EXISTS "notes: update own or teacher" ON public.notes;
DROP POLICY IF EXISTS "notes: delete own or teacher" ON public.notes;

DROP POLICY IF EXISTS notes_select ON public.notes;
CREATE POLICY notes_select ON public.notes FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      public.is_teacher_or_admin()
      OR public.is_course_member(public.get_space_course(space_id))
    )
  );

DROP POLICY IF EXISTS notes_insert ON public.notes;
CREATE POLICY notes_insert ON public.notes FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND (
      public.is_teacher_or_admin()
      OR public.is_course_member(public.get_space_course(space_id))
    )
  );

DROP POLICY IF EXISTS notes_update ON public.notes;
CREATE POLICY notes_update ON public.notes FOR UPDATE
  USING (
    author_id = auth.uid()
    OR public.is_teacher_or_admin()
  )
  WITH CHECK (
    author_id = auth.uid()
    OR public.is_teacher_or_admin()
  );

DROP POLICY IF EXISTS notes_delete ON public.notes;
CREATE POLICY notes_delete ON public.notes FOR DELETE
  USING (author_id = auth.uid() OR public.is_teacher_or_admin());

DROP POLICY IF EXISTS relations_select ON public.relations;
CREATE POLICY relations_select ON public.relations FOR SELECT
  USING (
    public.is_teacher_or_admin()
    OR public.is_course_member(public.get_space_course(space_id))
  );

DROP POLICY IF EXISTS relations_insert ON public.relations;
CREATE POLICY relations_insert ON public.relations FOR INSERT
  WITH CHECK (
    creator_id = auth.uid()
    AND (
      public.is_teacher_or_admin()
      OR public.is_course_member(public.get_space_course(space_id))
    )
  );

DROP POLICY IF EXISTS relations_update ON public.relations;
CREATE POLICY relations_update ON public.relations FOR UPDATE
  USING (creator_id = auth.uid() OR public.is_teacher_or_admin())
  WITH CHECK (creator_id = auth.uid() OR public.is_teacher_or_admin());

DROP POLICY IF EXISTS relations_delete ON public.relations;
CREATE POLICY relations_delete ON public.relations FOR DELETE
  USING (creator_id = auth.uid() OR public.is_teacher_or_admin());

DROP POLICY IF EXISTS note_metrics_select ON public.note_metrics_realtime;
CREATE POLICY note_metrics_select ON public.note_metrics_realtime FOR SELECT
  USING (
    public.is_teacher_or_admin()
    OR EXISTS (
      SELECT 1
      FROM public.notes n
      WHERE n.id = note_metrics_realtime.note_id
        AND public.is_course_member(public.get_space_course(n.space_id))
    )
  );

DROP POLICY IF EXISTS note_revisions_select ON public.note_revisions;
CREATE POLICY note_revisions_select ON public.note_revisions FOR SELECT
  USING (
    public.is_teacher_or_admin()
    OR editor_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.notes n
      WHERE n.id = note_revisions.note_id
        AND (
          n.author_id = auth.uid()
          OR public.is_course_member(public.get_space_course(n.space_id))
        )
    )
  );

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT
  USING (user_id = auth.uid() OR public.is_teacher_or_admin());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE
  USING (user_id = auth.uid() OR public.is_teacher_or_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_teacher_or_admin());

DROP POLICY IF EXISTS notifications_insert_teacher ON public.notifications;
CREATE POLICY notifications_insert_teacher ON public.notifications FOR INSERT
  WITH CHECK (public.is_teacher_or_admin());

DROP POLICY IF EXISTS events_insert_self ON public.events;
CREATE POLICY events_insert_self ON public.events FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND (
      space_id IS NULL
      OR public.is_teacher_or_admin()
      OR public.is_course_member(public.get_space_course(space_id))
    )
  );

DROP POLICY IF EXISTS events_select_teacher ON public.events;
CREATE POLICY events_select_teacher ON public.events FOR SELECT
  USING (
    public.is_teacher_or_admin()
    AND (
      space_id IS NULL
      OR public.is_course_member(public.get_space_course(space_id))
      OR public.is_teacher_or_admin()
    )
  );

DROP POLICY IF EXISTS ai_interventions_select_scoped ON public.ai_interventions;
CREATE POLICY ai_interventions_select_scoped ON public.ai_interventions FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_teacher_or_admin()
    OR public.is_course_member(public.get_space_course(space_id))
  );

DROP POLICY IF EXISTS teacher_ai_configs_select_teacher ON public.teacher_ai_configs;
CREATE POLICY teacher_ai_configs_select_teacher ON public.teacher_ai_configs FOR SELECT
  USING (public.is_teacher_or_admin());

DROP POLICY IF EXISTS teacher_ai_configs_write_teacher ON public.teacher_ai_configs;
CREATE POLICY teacher_ai_configs_write_teacher ON public.teacher_ai_configs FOR ALL
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());
