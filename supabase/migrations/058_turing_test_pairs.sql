-- 图灵测试改版（2026-09-10）：由教师设置、学生两两配对，每人两个匿名窗口——
-- 一个对面是配对的同学，一个对面是教师选定的大语言模型。原来的群聊玩法不再保留，
-- 旧表（participants / messages / votes）留着不动，旧活动全部退回草稿。

ALTER TABLE public.turing_test_activities
  ADD COLUMN IF NOT EXISTS instructions TEXT,
  ADD COLUMN IF NOT EXISTS ai_provider TEXT,
  ADD COLUMN IF NOT EXISTS ai_model TEXT,
  ADD COLUMN IF NOT EXISTS chat_minutes INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ;

ALTER TABLE public.turing_test_activities DROP CONSTRAINT IF EXISTS turing_test_activities_status_check;
UPDATE public.turing_test_activities SET status = 'draft' WHERE status <> 'draft';
ALTER TABLE public.turing_test_activities ADD CONSTRAINT turing_test_activities_status_check
  CHECK (status IN ('draft','open','chatting','voting','revealed','completed'));

-- 配对：一个学生在一个活动里只出现一次（应用层保证），教师补位时也是一条普通记录
CREATE TABLE IF NOT EXISTS public.turing_test_pairs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id  UUID NOT NULL REFERENCES public.turing_test_activities(id) ON DELETE CASCADE,
  student_a    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_b    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, student_a),
  UNIQUE (activity_id, student_b)
);

-- 每个学生两个窗口：label 是学生看到的名字（A/B，随机），kind 是真相，揭晓前不下发
CREATE TABLE IF NOT EXISTS public.turing_test_windows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id  UUID NOT NULL REFERENCES public.turing_test_activities(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL CHECK (label IN ('A','B')),
  kind         TEXT NOT NULL CHECK (kind IN ('human','ai')),
  pair_id      UUID REFERENCES public.turing_test_pairs(id) ON DELETE CASCADE,
  ai_persona   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, owner_id, label),
  UNIQUE (activity_id, owner_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_tt_windows_owner ON public.turing_test_windows(activity_id, owner_id);

-- 消息按频道存：pair 频道两个人共用（channel_id = pair_id），ai 频道一人一条（channel_id = window_id）。
-- AI 的回复先生成、到 visible_at 才对学生可见——整段一次出现，像真人写好再发。
CREATE TABLE IF NOT EXISTS public.turing_test_chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   UUID NOT NULL REFERENCES public.turing_test_activities(id) ON DELETE CASCADE,
  channel_type  TEXT NOT NULL CHECK (channel_type IN ('pair','ai')),
  channel_id    UUID NOT NULL,
  sender_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  visible_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tt_chat_channel ON public.turing_test_chat_messages(activity_id, channel_type, channel_id, visible_at);

-- 判断：哪个窗口是 AI、信心、至少两条线索；揭晓时写 is_correct；发布成笔记后记 note id
CREATE TABLE IF NOT EXISTS public.turing_test_verdicts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id        UUID NOT NULL REFERENCES public.turing_test_activities(id) ON DELETE CASCADE,
  student_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_label           TEXT NOT NULL CHECK (ai_label IN ('A','B')),
  confidence         INT NOT NULL DEFAULT 3 CHECK (confidence BETWEEN 1 AND 5),
  clues              TEXT[] NOT NULL DEFAULT '{}',
  is_correct         BOOLEAN,
  published_note_id  UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, student_id)
);

-- 服务端用 service role 写；这里只开课程成员的只读策略，不给匿名任何权限
ALTER TABLE public.turing_test_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turing_test_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turing_test_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turing_test_verdicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tt_pairs_select ON public.turing_test_pairs FOR SELECT
  USING (student_a = auth.uid() OR student_b = auth.uid());
CREATE POLICY tt_windows_select ON public.turing_test_windows FOR SELECT
  USING (owner_id = auth.uid());
CREATE POLICY tt_chat_select ON public.turing_test_chat_messages FOR SELECT
  USING (
    (channel_type = 'pair' AND EXISTS (
      SELECT 1 FROM public.turing_test_pairs p WHERE p.id = channel_id AND (p.student_a = auth.uid() OR p.student_b = auth.uid())))
    OR (channel_type = 'ai' AND EXISTS (
      SELECT 1 FROM public.turing_test_windows w WHERE w.id = channel_id AND w.owner_id = auth.uid()))
  );
CREATE POLICY tt_verdicts_select ON public.turing_test_verdicts FOR SELECT
  USING (student_id = auth.uid());
