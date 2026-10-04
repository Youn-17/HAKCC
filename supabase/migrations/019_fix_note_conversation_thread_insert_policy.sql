-- ============================================================
-- HAKCC — Fix Note Conversation thread insert policy
-- 019_fix_note_conversation_thread_insert_policy.sql
-- ============================================================

DROP POLICY IF EXISTS note_conversation_threads_insert ON note_conversation_threads;
CREATE POLICY note_conversation_threads_insert ON note_conversation_threads FOR INSERT
  WITH CHECK (
    created_by = auth.uid() AND
    (
      is_course_member(course_id) OR
      is_teacher_or_admin()
    )
  );
