-- 学生记忆分三类（2026-10-11 第四步）：
--   这段对话：agent_conversations / note_conversation_threads 的 conversation_memory（086），删对话就没了；
--   关键时刻（episode）：学生在选项卡上选了什么、把 AI 的东西导入了哪条笔记，系统自动记，60 天后过期；
--   关于你的了解（profile）：智能体用 save_reflection 记下的兴趣、还没弄懂的、进步、长处等。
-- 都放在 agent_reflections 里，学生能在「AI 记得什么」里看、删，也能关掉。学生删的直接删行
-- （原始对话还在；研究只在 events 里记删了几条、什么类型，不留内容）。

ALTER TABLE public.agent_reflections
  ADD COLUMN IF NOT EXISTS memory_kind text NOT NULL DEFAULT 'profile',
  ADD COLUMN IF NOT EXISTS source jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.agent_reflections DROP CONSTRAINT IF EXISTS agent_reflections_memory_kind_check;
ALTER TABLE public.agent_reflections ADD CONSTRAINT agent_reflections_memory_kind_check
  CHECK (memory_kind IN ('profile', 'episode'));

ALTER TABLE public.agent_reflections DROP CONSTRAINT IF EXISTS agent_reflections_reflection_type_check;
ALTER TABLE public.agent_reflections ADD CONSTRAINT agent_reflections_reflection_type_check
  CHECK (reflection_type IN ('insight', 'knowledge_gap', 'misconception', 'progress', 'interest', 'strength', 'choice', 'imported'));

CREATE INDEX IF NOT EXISTS agent_reflections_user_course_kind_idx
  ON public.agent_reflections (user_id, course_id, memory_kind, updated_at DESC);

COMMENT ON COLUMN public.agent_reflections.memory_kind IS 'profile = what the AI knows about the student; episode = key moments (choices, imports). Students can view and delete both.';
COMMENT ON COLUMN public.agent_reflections.source IS 'Where it came from: {surface, conversation_id | thread_id, note_id, question_id}';

-- 学生可以关掉「让 AI 记住我」：关了以后不再记新的，也不把记忆放进提示词
ALTER TABLE public.learner_profiles
  ADD COLUMN IF NOT EXISTS memory_enabled boolean NOT NULL DEFAULT true;

-- 知识空间智能体的对话可以删了（之前没有删除）：软删除，和笔记 AI 助手的对话（071）一样，研究数据还在
ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
