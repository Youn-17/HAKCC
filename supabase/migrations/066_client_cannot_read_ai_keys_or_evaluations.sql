-- 066：客户端读不到 AI 密钥，也读不到反馈的 AI 评估
--
-- 064 之后客户端对 public 下的表只剩 authenticated 的 SELECT，读由 RLS 管。复查读策略时，有两处放出了
-- API 刻意不给的内容：
--
--   · teacher_ai_configs：读策略 teacher_ai_configs_select 放行课程教职（is_course_instructor），
--     api_key_encrypted 整列可读。22 条里 12 条是明文（直接写库留下的，API 保存时一律加密成 enc:v1:），
--     课程管理员直连 PostgREST 就能拿到本课的密钥原文。API 返回给前端的是打码后的值，前端也从不直连读这张表，
--     所以整表收回客户端 SELECT。明文的 12 条另由服务器上的脚本补加密（密钥材料只在 API 的环境变量里）。
--
--   · note_feedbacks：笔记作者能读自己笔记上已发布的反馈（note_feedbacks_student_select），但表级 SELECT
--     把 ai_evaluation 一起给了。ai_evaluation 是 AI 对这条反馈的评估，API 只返回给课程教职
--     （api/src/routes/feedback.ts）。这张表有 Realtime 订阅（hooks/useSpaceData.ts 只拿它当刷新信号），
--     不能整表收回，改成列级授权、只去掉 ai_evaluation。Realtime 逐列判 has_column_privilege，
--     读不到的列从推送里去掉，主键可读就照常推送（realtime.apply_rls）。
--
-- 坑：note_feedbacks 以后新加的列，客户端默认读不到（列级授权不会覆盖新列），前端要直连读就得补 GRANT。
-- 063 改成列级授权的 groups、course_members、note_ai_feedbacks 也是这样。

REVOKE SELECT ON public.teacher_ai_configs FROM authenticated;

-- 表级 REVOKE 会连同列级授权一起收回，再按列授回
REVOKE SELECT ON public.note_feedbacks FROM authenticated;
GRANT SELECT (id, note_id, space_id, student_summary, teacher_note, generated_by, is_published,
              published_by, published_by_name, published_at, is_read, created_at, updated_at)
  ON public.note_feedbacks TO authenticated;

-- ── 自检：不对就整个回滚 ──────────────────────────────────────────────
DO $$
BEGIN
  IF has_any_column_privilege('authenticated', 'public.teacher_ai_configs', 'SELECT')
     OR has_any_column_privilege('anon', 'public.teacher_ai_configs', 'SELECT') THEN
    RAISE EXCEPTION '066: 客户端仍能读 teacher_ai_configs';
  END IF;
  IF has_column_privilege('authenticated', 'public.note_feedbacks', 'ai_evaluation', 'SELECT') THEN
    RAISE EXCEPTION '066: 客户端仍能读 note_feedbacks.ai_evaluation';
  END IF;
  -- Realtime 要主键和订阅过滤用的 space_id 可读；学生界面要的列也都还在
  IF NOT (has_column_privilege('authenticated', 'public.note_feedbacks', 'id', 'SELECT')
      AND has_column_privilege('authenticated', 'public.note_feedbacks', 'space_id', 'SELECT')
      AND has_column_privilege('authenticated', 'public.note_feedbacks', 'student_summary', 'SELECT')
      AND has_column_privilege('authenticated', 'public.note_feedbacks', 'teacher_note', 'SELECT')) THEN
    RAISE EXCEPTION '066: note_feedbacks 该留的列丢了';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'note_feedbacks'
               AND column_name <> 'ai_evaluation'
               AND NOT has_column_privilege('authenticated', 'public.note_feedbacks', column_name, 'SELECT')) THEN
    RAISE EXCEPTION '066: note_feedbacks 有列漏授（表结构和本迁移写的列不一致）';
  END IF;
END
$$;

-- ── 回滚 ────────────────────────────────────────────────────────────
-- GRANT SELECT ON public.note_feedbacks TO authenticated;
-- GRANT SELECT ON public.teacher_ai_configs TO authenticated;   -- 会把密钥列重新放给课程教职，别轻易放回
