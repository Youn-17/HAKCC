-- ============================================================
-- 修复缺失的表
-- 在 Supabase SQL Editor 中执行此脚本
-- https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new
-- ============================================================

-- 1. 创建 course_members 表（如不存在）
-- NOTE: profiles 是 users 表的 VIEW，FK 必须引用 users(id)
CREATE TABLE IF NOT EXISTS course_members (
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);

ALTER TABLE course_members ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "Users can view course memberships" ON course_members
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memberships" ON course_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage all" ON course_members
  FOR ALL USING (auth.role() = 'service_role');

-- 2. 创建 spaces 表（如不存在）
-- NOTE: FK 引用 users(id) 而非 profiles（profiles 是视图，不能作为 FK 目标）
CREATE TABLE IF NOT EXISTS spaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(200) NOT NULL,
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES users(id),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view spaces in their courses" ON spaces
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM course_members
      WHERE course_members.course_id = spaces.course_id
      AND course_members.user_id = auth.uid()
    )
  );

-- A deployment-specific instructor correction was omitted from this public snapshot.
