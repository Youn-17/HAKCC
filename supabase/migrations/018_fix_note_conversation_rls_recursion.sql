-- ============================================================
-- HAKCC — Fix Note Conversation RLS recursion
-- 018_fix_note_conversation_rls_recursion.sql
-- ============================================================

CREATE OR REPLACE FUNCTION is_note_conversation_participant(
  p_thread_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM note_conversation_participants
    WHERE thread_id = p_thread_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION is_note_conversation_creator(
  p_thread_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM note_conversation_threads
    WHERE id = p_thread_id AND created_by = p_user_id
  );
$$;

DROP POLICY IF EXISTS note_conversation_threads_select ON note_conversation_threads;
CREATE POLICY note_conversation_threads_select ON note_conversation_threads FOR SELECT
  USING (
    is_teacher_or_admin() OR
    is_note_conversation_participant(id)
  );

DROP POLICY IF EXISTS note_conversation_participants_select ON note_conversation_participants;
CREATE POLICY note_conversation_participants_select ON note_conversation_participants FOR SELECT
  USING (
    is_teacher_or_admin() OR
    user_id = auth.uid() OR
    is_note_conversation_participant(thread_id)
  );

DROP POLICY IF EXISTS note_conversation_participants_insert ON note_conversation_participants;
CREATE POLICY note_conversation_participants_insert ON note_conversation_participants FOR INSERT
  WITH CHECK (
    is_teacher_or_admin() OR
    is_note_conversation_creator(thread_id)
  );

DROP POLICY IF EXISTS note_conversation_messages_select ON note_conversation_messages;
CREATE POLICY note_conversation_messages_select ON note_conversation_messages FOR SELECT
  USING (
    is_teacher_or_admin() OR
    is_note_conversation_participant(thread_id)
  );

DROP POLICY IF EXISTS note_conversation_messages_insert ON note_conversation_messages;
CREATE POLICY note_conversation_messages_insert ON note_conversation_messages FOR INSERT
  WITH CHECK (
    (sender_id = auth.uid() AND sender_kind = 'user' AND is_note_conversation_participant(thread_id)) OR
    is_teacher_or_admin()
  );
