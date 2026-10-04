-- 教师端四个入口各自一份对话历史。以前只按 agent_mode 区分，
-- 学情分析和教学评估同为 teaching_analyst，历史互相串；备课的对话也会出现在学情分析里。
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS module TEXT;
UPDATE public.agent_conversations
   SET module = CASE agent_mode
                  WHEN 'lesson_planner' THEN 'lesson'
                  WHEN 'teaching_analyst' THEN 'analytics'
                  ELSE 'chat'
                END
 WHERE module IS NULL AND agent_type = 'personal';
CREATE INDEX IF NOT EXISTS agent_conversations_user_module_idx
  ON public.agent_conversations (user_id, module, updated_at DESC);
