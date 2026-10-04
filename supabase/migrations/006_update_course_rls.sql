-- ============================================================
-- Update Course RLS Policies for Student Discovery
-- 006_update_course_rls.sql
-- ============================================================

-- Drop existing courses_select policy
DROP POLICY IF EXISTS courses_select ON courses;

-- Create new policy: All authenticated users can view all courses
-- This allows students to discover and join courses
CREATE POLICY courses_select ON courses FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Students can insert into course_members (join courses)
CREATE POLICY course_members_insert_student ON course_members FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── Optional: Add public course visibility ──────────────────────
-- If you want unauthenticated users to see courses (for public catalog),
-- uncomment the following:

-- CREATE POLICY courses_select_public ON courses FOR SELECT
--   USING (true);
