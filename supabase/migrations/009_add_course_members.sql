-- Create course_members table (idempotent — 001_initial_schema.sql already creates it)
-- This migration is kept for reference but should be a no-op if 001 ran first.
CREATE TABLE IF NOT EXISTS course_members (
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);

-- Enable RLS (idempotent)
ALTER TABLE course_members ENABLE ROW LEVEL SECURITY;

-- RLS Policies (use IF NOT EXISTS pattern via DO block to avoid duplicate errors)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'course_members' AND policyname = 'Users can view course memberships'
  ) THEN
    CREATE POLICY "Users can view course memberships" ON course_members
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'course_members' AND policyname = 'Users can insert their own memberships'
  ) THEN
    CREATE POLICY "Users can insert their own memberships" ON course_members
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'course_members' AND policyname = 'Teachers can view memberships for their courses'
  ) THEN
    CREATE POLICY "Teachers can view memberships for their courses" ON course_members
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM courses
          WHERE courses.id = course_members.course_id
          AND courses.instructor_id = auth.uid()
        )
      );
  END IF;
END $$;
