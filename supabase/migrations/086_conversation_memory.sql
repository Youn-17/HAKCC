-- Derived, thread-scoped memory. Raw messages remain the authoritative transcript.
-- Existing ownership/participant RLS and server-side access checks still apply.
ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS conversation_memory jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.note_conversation_threads
  ADD COLUMN IF NOT EXISTS conversation_memory jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.agent_conversations.conversation_memory IS 'Rolling AI summary of earlier turns; scoped to this conversation, never counted as user-authored content';
COMMENT ON COLUMN public.note_conversation_threads.conversation_memory IS 'Rolling AI summary of earlier turns; scoped to this thread, never counted as user-authored content';
