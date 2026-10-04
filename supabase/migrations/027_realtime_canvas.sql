-- Migration 027: Enable realtime for collaborative canvas sync.
--
-- useSpaceData subscribes to postgres_changes on `notes` and `relations`, but
-- 003_realtime_enable.sql deliberately left them out of the publication, so the
-- subscription never fired (new notes / relations / AI build-ons did not reach
-- co-learners without a manual reload). Add them now. RLS still scopes which
-- rows each client receives. REPLICA IDENTITY FULL ensures DELETE events carry
-- space_id so the client-side `space_id=eq.<id>` filter matches on deletes too.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'relations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.relations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'note_feedbacks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.note_feedbacks;
  END IF;
END $$;

ALTER TABLE public.notes          REPLICA IDENTITY FULL;
ALTER TABLE public.relations      REPLICA IDENTITY FULL;
ALTER TABLE public.note_feedbacks REPLICA IDENTITY FULL;
