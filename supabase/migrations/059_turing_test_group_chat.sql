-- 图灵测试第三版（2026-09-14）：回到匿名群聊，按图灵测试的原则重做。
--
-- 058 的两两配对 + 双窗口太繁琐。改成：学生按人数分进若干个群，每群混入教师设定数量的
-- AI「同学」，所有人（真人和 AI）用同一个化名池随机起名，限时聊完判断群里谁是 AI。
-- 058 的配对/窗口/判断四张表没有数据，直接删；群聊沿用 031 的 participants / messages / votes。

DROP TABLE IF EXISTS public.turing_test_chat_messages;
DROP TABLE IF EXISTS public.turing_test_windows;
DROP TABLE IF EXISTS public.turing_test_pairs;
DROP TABLE IF EXISTS public.turing_test_verdicts;

-- 默认值对应图灵 1950 年的设定：提问 5 分钟后判断；默认模型 DeepSeek Flash（调用时关闭思考模式）
ALTER TABLE public.turing_test_activities
  ADD COLUMN IF NOT EXISTS room_size INT NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS ai_per_room INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS disclose_ai_count BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.turing_test_activities ALTER COLUMN chat_minutes SET DEFAULT 5;
ALTER TABLE public.turing_test_activities ALTER COLUMN ai_provider SET DEFAULT 'deepseek';
ALTER TABLE public.turing_test_activities ALTER COLUMN ai_model SET DEFAULT 'deepseek-flash';

CREATE TABLE IF NOT EXISTS public.turing_test_rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES public.turing_test_activities(id) ON DELETE CASCADE,
  room_no     INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, room_no)
);

ALTER TABLE public.turing_test_participants
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES public.turing_test_rooms(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tt_participants_room ON public.turing_test_participants(room_id);

-- AI 的消息生成后先压着，到 visible_at 才对群里可见——整段出现，像写好再发
ALTER TABLE public.turing_test_messages
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES public.turing_test_rooms(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS visible_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_tt_messages_room_visible ON public.turing_test_messages(room_id, visible_at);

-- 每个学生一条判断：逐个成员判人/AI 存在 turing_test_votes，这里存信心、线索、得分和发布的笔记
CREATE TABLE IF NOT EXISTS public.turing_test_judgments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id        UUID NOT NULL REFERENCES public.turing_test_activities(id) ON DELETE CASCADE,
  room_id            UUID REFERENCES public.turing_test_rooms(id) ON DELETE SET NULL,
  student_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submitted          BOOLEAN NOT NULL DEFAULT true,
  confidence         INT NOT NULL DEFAULT 3 CHECK (confidence BETWEEN 1 AND 5),
  clues              TEXT[] NOT NULL DEFAULT '{}',
  correct            INT,
  total              INT,
  found_all_ai       BOOLEAN,
  published_note_id  UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, student_id)
);

-- 所有读写只走 API（service role）。031 留下的策略允许学生直接用 PostgREST 读 is_ai（等于直接查答案）、
-- 以 AI 身份插消息、自己建活动。全部删掉；RLS 保持开启，没有策略即 anon / authenticated 一律无权访问。
DROP POLICY IF EXISTS tt_activities_select ON public.turing_test_activities;
DROP POLICY IF EXISTS tt_activities_insert ON public.turing_test_activities;
DROP POLICY IF EXISTS tt_activities_update ON public.turing_test_activities;
DROP POLICY IF EXISTS tt_participants_select ON public.turing_test_participants;
DROP POLICY IF EXISTS tt_participants_insert ON public.turing_test_participants;
DROP POLICY IF EXISTS tt_messages_select ON public.turing_test_messages;
DROP POLICY IF EXISTS tt_messages_insert ON public.turing_test_messages;
DROP POLICY IF EXISTS tt_votes_select ON public.turing_test_votes;
DROP POLICY IF EXISTS tt_votes_insert ON public.turing_test_votes;

ALTER TABLE public.turing_test_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turing_test_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turing_test_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turing_test_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turing_test_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turing_test_judgments ENABLE ROW LEVEL SECURITY;
