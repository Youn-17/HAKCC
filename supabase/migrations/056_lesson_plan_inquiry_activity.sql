-- lessonPlanService 已支持 inquiry_activity（探究活动）课型，但表上的 CHECK 还是 028 那四种，
-- 2026-09-10 实测请求该课型直接 500「violates check constraint」。
ALTER TABLE public.lesson_plans DROP CONSTRAINT IF EXISTS lesson_plans_plan_type_check;
ALTER TABLE public.lesson_plans ADD CONSTRAINT lesson_plans_plan_type_check
  CHECK (plan_type IN ('full_plan','resources','activities','analysis','inquiry_activity'));
