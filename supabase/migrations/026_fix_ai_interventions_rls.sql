-- Migration 026: Tighten ai_interventions SELECT policy.
--
-- 023_core_rls_policies.sql allowed any course member to read EVERY AI
-- intervention in the course (third arm: is_course_member(get_space_course(...))),
-- exposing peers' private AI conversation logs. Restrict reads to the owning
-- user and teachers/admins. Teacher analytics already query via the teacher arm.

DROP POLICY IF EXISTS ai_interventions_select_scoped ON public.ai_interventions;
CREATE POLICY ai_interventions_select_scoped ON public.ai_interventions FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_teacher_or_admin()
  );
