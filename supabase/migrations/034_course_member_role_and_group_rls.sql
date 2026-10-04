-- Security hardening (2026-08-27), applied live and recorded here.
--
-- 1) Privilege escalation: course_members carried no role, so an invited
--    co-teacher and a student who self-joined with a verification code were
--    indistinguishable. ensureCourseInstructor treated any teacher-role account
--    holding a membership row as the instructor, and /courses/available handed
--    every user every course's join code — so any teacher could enrol
--    themselves into another teacher's course and take it over.
ALTER TABLE course_members ADD COLUMN IF NOT EXISTS role varchar(16) NOT NULL DEFAULT 'student';

UPDATE course_members cm SET role = 'teacher'
FROM courses c, profiles p
WHERE cm.course_id = c.id AND p.id = cm.user_id
  AND (c.instructor_id = cm.user_id OR p.role IN ('teacher','admin'));

-- 2) Group isolation lived only in Express. The browser holds the student's own
--    Supabase token, so a control-arm student could read the treatment arm's
--    notes directly (or subscribe to its realtime channel) with no server log —
--    exactly the contamination the cluster-randomized design exists to prevent.
--    can_access_space() also replaces is_teacher_or_admin(), a global role test
--    with no course predicate.
CREATE OR REPLACE FUNCTION public.can_access_space(p_space_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM spaces s
    JOIN courses c ON c.id = s.course_id
    WHERE s.id = p_space_id
      AND (
        c.instructor_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM course_members cm
          WHERE cm.course_id = c.id AND cm.user_id = auth.uid()
            AND cm.role IN ('teacher','admin')
        )
        OR (
          EXISTS (SELECT 1 FROM course_members cm
                  WHERE cm.course_id = c.id AND cm.user_id = auth.uid())
          AND (
            s.group_id IS NULL
            OR EXISTS (SELECT 1 FROM group_members gm
                       WHERE gm.group_id = s.group_id AND gm.user_id = auth.uid())
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS notes_select ON public.notes;
CREATE POLICY notes_select ON public.notes FOR SELECT
  USING (deleted_at IS NULL AND public.can_access_space(space_id));

DROP POLICY IF EXISTS spaces_select ON public.spaces;
CREATE POLICY spaces_select ON public.spaces FOR SELECT
  USING (public.can_access_space(id));

DROP POLICY IF EXISTS relations_select ON public.relations;
CREATE POLICY relations_select ON public.relations FOR SELECT
  USING (public.can_access_space(space_id));

DROP POLICY IF EXISTS note_metrics_select ON public.note_metrics_realtime;
CREATE POLICY note_metrics_select ON public.note_metrics_realtime FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = note_metrics_realtime.note_id
      AND public.can_access_space(n.space_id)
  ));

DROP POLICY IF EXISTS notes_insert ON public.notes;
CREATE POLICY notes_insert ON public.notes FOR INSERT
  WITH CHECK (author_id = auth.uid() AND public.can_access_space(space_id));

DROP POLICY IF EXISTS relations_insert ON public.relations;
CREATE POLICY relations_insert ON public.relations FOR INSERT
  WITH CHECK (creator_id = auth.uid() AND public.can_access_space(space_id));
