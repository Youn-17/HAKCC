-- 031_turing_test.sql
-- Classroom Turing Test: inquiry activity where students interact with
-- mixed human/AI participants and judge who is who.

-- ── Activities ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turing_test_activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  space_id        UUID REFERENCES spaces(id) ON DELETE SET NULL,
  created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  topic           TEXT NOT NULL,
  description     TEXT,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- config shape: { rounds: number, ai_count: number, time_per_round_min: number,
  --                 kb_principles: string[], ai_personas: object[] }
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','lobby','discussion','voting','revealed','completed')),
  current_round   INT NOT NULL DEFAULT 0,
  join_code       TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tt_activities_course ON turing_test_activities(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tt_activities_join   ON turing_test_activities(join_code) WHERE join_code IS NOT NULL;

-- ── Participants (human students + AI bots, all anonymized) ─────────
CREATE TABLE IF NOT EXISTS turing_test_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id     UUID NOT NULL REFERENCES turing_test_activities(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alias           TEXT NOT NULL,
  is_ai           BOOLEAN NOT NULL DEFAULT false,
  ai_persona      JSONB,
  -- ai_persona shape: { style, knowledge_level, quirks, response_patterns }
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(activity_id, user_id),
  UNIQUE(activity_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_tt_participants_activity ON turing_test_participants(activity_id);

-- ── Messages (per-round discussion) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS turing_test_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id     UUID NOT NULL REFERENCES turing_test_activities(id) ON DELETE CASCADE,
  round_number    INT NOT NULL DEFAULT 1,
  participant_id  UUID NOT NULL REFERENCES turing_test_participants(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tt_messages_round ON turing_test_messages(activity_id, round_number, created_at);

-- ── Votes (student judgments) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS turing_test_votes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id     UUID NOT NULL REFERENCES turing_test_activities(id) ON DELETE CASCADE,
  voter_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES turing_test_participants(id) ON DELETE CASCADE,
  vote            TEXT NOT NULL CHECK (vote IN ('human','ai')),
  confidence      INT NOT NULL DEFAULT 3 CHECK (confidence BETWEEN 1 AND 5),
  reasoning       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(activity_id, voter_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_tt_votes_activity ON turing_test_votes(activity_id);

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE turing_test_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE turing_test_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE turing_test_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE turing_test_votes ENABLE ROW LEVEL SECURITY;

-- Activities: course members can read; creator can write
CREATE POLICY tt_activities_select ON turing_test_activities FOR SELECT
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM course_members cm
      WHERE cm.course_id = turing_test_activities.course_id
        AND cm.user_id = auth.uid()
    )
  );
CREATE POLICY tt_activities_insert ON turing_test_activities FOR INSERT
  WITH CHECK (created_by = auth.uid());
CREATE POLICY tt_activities_update ON turing_test_activities FOR UPDATE
  USING (created_by = auth.uid());

-- Participants: activity members can read; insert own
CREATE POLICY tt_participants_select ON turing_test_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM turing_test_activities a
      WHERE a.id = turing_test_participants.activity_id
        AND (a.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM course_members cm
            WHERE cm.course_id = a.course_id AND cm.user_id = auth.uid()
          ))
    )
  );
CREATE POLICY tt_participants_insert ON turing_test_participants FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Messages: activity members can read and insert own
CREATE POLICY tt_messages_select ON turing_test_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM turing_test_participants p
      WHERE p.id = turing_test_messages.participant_id
        AND p.activity_id = turing_test_messages.activity_id
        AND EXISTS (
          SELECT 1 FROM turing_test_activities a
          WHERE a.id = p.activity_id
            AND (a.created_by = auth.uid()
              OR EXISTS (
                SELECT 1 FROM course_members cm
                WHERE cm.course_id = a.course_id AND cm.user_id = auth.uid()
              ))
        )
    )
  );
CREATE POLICY tt_messages_insert ON turing_test_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM turing_test_participants p
      WHERE p.id = turing_test_messages.participant_id
        AND (p.user_id = auth.uid() OR p.is_ai = true)
    )
  );

-- Votes: voters can read/write own
CREATE POLICY tt_votes_select ON turing_test_votes FOR SELECT
  USING (voter_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM turing_test_activities a
      WHERE a.id = turing_test_votes.activity_id AND a.created_by = auth.uid()
    )
  );
CREATE POLICY tt_votes_insert ON turing_test_votes FOR INSERT
  WITH CHECK (voter_id = auth.uid());
