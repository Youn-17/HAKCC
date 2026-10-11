-- 智能体从经验里变好（2026-10-11 第五步）。只做两类，不做在线强化学习，也不让模型改代码。
--
-- 做法卡：从学生和智能体的对话记录里统计「这样回答，学生更常接住」（导入笔记、挂网页、30 分钟内接着问、
--   回答选项卡），候选由系统生成、或老师自己写；老师在「讨论分析 → 智能体做法」里同意后才放进提示词。
--   采用后试用：用满 20 次，接住率没比采用前高就自动撤回（retired_reason 写明）。
-- 网页模板（技能库）：平台自带的几种在代码里；老师可以把做得好的网页存成本课模板，智能体做网页时按需加载。

CREATE TABLE IF NOT EXISTS public.agent_practice_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  task_kind text NOT NULL CHECK (task_kind IN ('ask', 'make', 'plan', 'ghostwrite', 'polish')),
  practice text NOT NULL,
  rationale text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin text NOT NULL DEFAULT 'induced' CHECK (origin IN ('induced', 'teacher')),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'rejected', 'retired')),
  baseline_rate real,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  retired_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_practice_cards_course_status_idx ON public.agent_practice_cards (course_id, status, task_kind);
ALTER TABLE public.agent_practice_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_practice_cards FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_practice_cards TO service_role;
COMMENT ON TABLE public.agent_practice_cards IS 'Practice cards for the student agents: induced from run outcomes or written by teachers; only status=active (teacher-approved) cards reach prompts. Server-only.';

CREATE TABLE IF NOT EXISTS public.agent_page_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  when_to_use text NOT NULL,
  guide text NOT NULL,
  source_artifact_id uuid REFERENCES public.ai_artifacts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, slug)
);
ALTER TABLE public.agent_page_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_page_templates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_page_templates TO service_role;
COMMENT ON TABLE public.agent_page_templates IS 'Course page templates saved by teachers from good artifacts (structure only). Built-in templates live in code. Server-only.';

-- 做网页时用了哪个模板（统计「用了几次、几次放进了笔记」）
ALTER TABLE public.ai_artifacts ADD COLUMN IF NOT EXISTS template_slug text;
