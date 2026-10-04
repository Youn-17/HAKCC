-- ============================================================
-- Add INSERT policy for users table
-- 007_add_users_insert_policy.sql
-- ============================================================

-- Allow users to insert their own profile (during registration or auto-creation)
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (id = auth.uid());
