-- 061：身份两张表 + 画布内容表只能经 API 写
--
-- 2026-09-28 14:39 已在生产执行（MCP apply_migration，名 identity_and_canvas_api_only_writes），
-- 执行后核对：8 张表对 anon/authenticated 只剩 SELECT，列级写授权清空，service_role 不受影响。
--
-- 2026-09-28 复查。以下按线上的表授权和 RLS 策略定义推断，没有在生产上实测利用。
--
-- 一、profiles：authenticated 有表级 UPDATE（含 role、status 列），策略「profiles: update」
--     只要求 auth.uid() = id，表上也没有触发器。任何登录用户用自己的 access token 加前端里
--     公开的 anon key，请求 PATCH /rest/v1/profiles?id=eq.<自己> {"role":"admin"} 就把自己
--     改成平台管理员；API 的 verifyJWT 每次从 profiles 读 role（缓存 60 秒），之后全站放行。
--
-- 二、course_members：authenticated 有 INSERT（含 role 列），策略 course_members_insert_self
--     只要求 user_id = auth.uid()。任何登录用户不要验证码就能加入任意课程，还能把 role 写成
--     'teacher'。数据库的 is_course_instructor() / can_access_space() 认这一行：跨组读全部
--     小组空间、建组改组、读全课对话。API 层 2026-09-28 起管理员判定另要求平台身份是教师，
--     但数据库这边没有这道。
--
-- 三、notes / relations / views / view_cards / space_shapes / doc_annotations 的改删策略用
--     is_teacher_or_admin()（平台身份），任何教师账号凭学生验证码入课后，能直连改删同学的
--     内容，绕过 API 在 2026-09-28 改成的课内身份判断。notes 另有 060_notes_api_only_writes
--     （另一会话的草稿，同样是收回写权限），两者可以都执行，REVOKE 重复执行无害。
--
-- 前端从不直连写这些表（全部走 API，API 用 service_role，不受这里影响；注册、入课、改资料、
-- 授予管理员、画布增删改都走 API）。前端只用 supabase-js 做登录、存储上传和 Realtime
-- 订阅（notes / relations / note_feedbacks，只要 SELECT）。所以收回客户端写权限不影响功能。
-- SELECT 保留。策略不删（course_members_insert_self 除外），没有写权限时它们不起作用。

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.course_members FROM anon, authenticated;
DROP POLICY IF EXISTS course_members_insert_self ON public.course_members;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.notes           FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.relations       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.views           FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.view_cards      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.space_shapes    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.doc_annotations FROM anon, authenticated;

-- 执行后核对：每张表对 anon / authenticated 应只剩 SELECT（anon 可能一项都没有）
-- SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
--   AND table_name IN ('profiles','course_members','notes','relations','views','view_cards','space_shapes','doc_annotations')
-- GROUP BY table_name, grantee ORDER BY 1, 2;
--
-- 执行后回归：学生登录、自助入课（带验证码）、发笔记、Build-on、改名头像，教师授予/撤销管理员，
-- 都应照常——它们全走 API。
--
-- 回滚（只在确认有功能依赖客户端直连写时用）：
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles, public.course_members,
--   public.notes, public.relations, public.views, public.view_cards, public.space_shapes, public.doc_annotations TO authenticated;
-- CREATE POLICY course_members_insert_self ON public.course_members FOR INSERT
--   WITH CHECK ((user_id = (SELECT auth.uid())) OR public.is_teacher_or_admin());
