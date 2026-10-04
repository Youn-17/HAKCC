-- ============================================================
-- HAKCC — Enable Supabase Realtime
-- 003_realtime_enable.sql
-- ============================================================

-- Enable realtime on note_metrics_realtime so the frontend
-- can subscribe and update node sizes/heat scores live.
ALTER PUBLICATION supabase_realtime ADD TABLE note_metrics_realtime;

-- Enable realtime on notifications for live notification badge updates
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- NOTE: We intentionally do NOT add notes/relations to realtime in P0.
-- Collaborative canvas sync (multi-user concurrent editing) is a P1 feature.
-- Adding large tables to realtime has performance implications.
