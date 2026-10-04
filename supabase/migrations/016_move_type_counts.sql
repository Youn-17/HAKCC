-- Migration 016: Add per-move-type counters and unresolved_challenges to note_metrics_realtime
-- These enable the Note card Move Type dot visualization (Step 6)

ALTER TABLE note_metrics_realtime
  ADD COLUMN IF NOT EXISTS extend_count    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clarify_count   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS question_count  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unresolved_challenges INT NOT NULL DEFAULT 0;

-- Back-fill counts from existing relations
UPDATE note_metrics_realtime nmr
SET
  extend_count = COALESCE((
    SELECT COUNT(*) FROM relations r
    WHERE r.target_note_id = nmr.note_id AND r.relation_type = 'extend'
  ), 0),
  clarify_count = COALESCE((
    SELECT COUNT(*) FROM relations r
    WHERE r.target_note_id = nmr.note_id AND r.relation_type = 'clarify'
  ), 0),
  question_count = COALESCE((
    SELECT COUNT(*) FROM relations r
    WHERE r.target_note_id = nmr.note_id AND r.relation_type = 'question'
  ), 0),
  -- unresolved = challenge_count (no "evidence accepted" logic yet)
  unresolved_challenges = COALESCE((
    SELECT COUNT(*) FROM relations r
    WHERE r.target_note_id = nmr.note_id AND r.relation_type = 'challenge'
  ), 0),
  updated_at = now();
