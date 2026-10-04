-- The T1-T6 taxonomy (undigested_ai, no_reasoning, no_evidence, no_connection,
-- promising_seed, unclear) replaced the original 4-type taxonomy in code, but
-- the check constraint was never updated — every LLM-detected feedback insert
-- failed. Keep the legacy values for existing rows and the regex fallback.
-- (Applied to live DB 2026-07-14 as expand_note_ai_feedbacks_trigger_types.)
ALTER TABLE note_ai_feedbacks
  DROP CONSTRAINT note_ai_feedbacks_trigger_type_check;

ALTER TABLE note_ai_feedbacks
  ADD CONSTRAINT note_ai_feedbacks_trigger_type_check
  CHECK (trigger_type::text = ANY (ARRAY[
    'undigested_ai',
    'no_reasoning',
    'no_evidence',
    'no_connection',
    'promising_seed',
    'unclear',
    'evidence_gap',
    'uncertainty',
    'weak_synthesis',
    'clarification_needed'
  ]::text[]));
