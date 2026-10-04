-- 064：public 下所有表对客户端只读；anon 一概不授；以后新建的表默认同样处理
--
-- 2026-09-28 复查（接 061–063）。起草时未执行，等用户批准。
-- 065（知识库串组修复）已于 07:39 UTC 先执行，收回了 kb_documents / kb_chunks 的全部客户端权限，
-- 064 对这两张表是空操作；两个迁移都只收不授，执行顺序无关。
--
-- 线上现状（has_table_privilege 逐表查；起草时 kb 两张表也在内，括号里是 065 之后的数）：
--   · authenticated 对 43（41）张表仍有 INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN；
--   · anon 对 038 之后新建的 13（11）张表有全部权限（含 SELECT）：course_materials、course_scaffold_prefs、
--     course_sessions、document_renders、kb_chunks、kb_documents、platform_content、platform_feedback、
--     riseabove_messages、riseabove_rooms、support_questions、turing_test_judgments、turing_test_rooms；
--   · authenticated 对 public 下 67（65）个关系有 MAINTAIN——除了没授权的物化视图，每个表和视图都有
--     （PG17 新增的权限，061/063 的 REVOKE 没列它）。PostgREST 发不出 LOCK / VACUUM，目前够不着，一并收掉。
--   根源是 Supabase 给 postgres 在 public 设的默认权限：新建的表自动授 anon / authenticated 全部权限。
--
-- 按真实账号只读实测（DO 块里切 authenticated + request.jwt.claims，EXPLAIN INSERT/UPDATE/DELETE
-- 只做权限检查不执行，再按写策略条件数出可触达的行，最后 RAISE EXCEPTION 回滚），RLS 实际放行的直连写：
--   学生：往所在空间的 3 个讨论室插消息，sender_kind / sender_id / agent_mode 任填，能以 AI 同学或别的
--        同学的名义发言；改所在空间的全部讨论室（标题、状态、published_note_id、source_note_ids、created_by，
--        还能把讨论室挪到自己能进的另一个空间），建讨论室，删自己建的；改删自己和 AI 助手的对话记录，
--        也能插 role = 'assistant' 的假回复（agent_conversations / agent_messages，研究数据导出含这部分；
--        一名学生 11 个对话、22 条消息）；
--        改自己求助问题的任意列（含 teacher_answer、status）；写 platform_feedback、lesson_plans、
--        teacher_agent_memory、coding_*、thinking_sessions、ct_solutions、edges、agent_runs 等自己的行。
--   课程创建者：以上全部，另加直改自己课程的任意列（verification_code、export_salt、instructor_id、
--        require_scaffold）；直接增删改本课的 note_feedbacks（含 is_published、published_by_name）、
--        course_scaffold_prefs、ct_problems、support_questions 的回答、讨论室；教师身份可绕过 API 直接建课；
--        改 teacher_ai_configs 的 endpoint_url 而不重填密钥——API 保存配置时要求重新提交 api_key，直连 PATCH
--        不用，下一次 AI 调用就把本课已存的密钥（解密后）放在 Authorization 头里发到自己指定的地址；
--        trigger_settings（含 experiment_mode）也能绕过 API 的取值校验直接改。
--   课程管理员（course_members.role 为 teacher/admin）：同创建者，courses 除外。
--   平台管理员：platform_content，以及全部课程的 courses / AI 配置 / 支架偏好 / CT 题目 / 求助回答。
--   anon：13 张表有权限，但写策略都要 auth.uid() 或 anon 没有 EXECUTE 的函数，写不进任何行（UPDATE / DELETE
--        实测 0 行或报错，INSERT 按 WITH CHECK 推断），属卫生问题。
--   本来就写不进的：course_enrollments 插入在规划阶段报 42P17（插入检查查 profiles，profiles 的读策略又查
--   course_enrollments，策略递归）；learner_profiles、note_embeddings、agent_reflections 的策略只认 service_role；
--   course_materials、course_sessions、document_renders、note_metrics_realtime、thinking_skill_profiles、
--   turing_test_* 没有写策略（kb 两张表 065 之后连策略带权限都没了）。
--
-- 前端从不直连读写这些表：supabase-js 只用于登录、存储上传（uploadToSignedUrl 和带用户 JWT 的断点续传，
-- 存储策略只调 is_course_member()，SECURITY DEFINER，不需要表权限）和 notes / relations / note_feedbacks
-- 的 Realtime 订阅（realtime.subscription 里三条订阅的 claims_role 都是 authenticated）。API 用 service_role，
-- 不受这里影响。边缘日志 2026-09-27 10:33 至 09-28 07:21 UTC 共 2937 条 /rest/v1 请求：2936 条 service_role，
-- 1 条 anon key 的 curl 探测（401），没有一条带用户 token。更早的日志已过保留期，查不到。
--
-- 1. 现有的表：anon / authenticated 的写权限全部收回，anon 连 SELECT 一起收。
--    authenticated 的 SELECT 不动（表级和 063 的列级都保留），Realtime 照常。
--    策略不删：这批表的写策略在没有写权限时不起作用。哪天要恢复某张表的客户端写，先看它的写策略——
--    riseabove_rooms_update（空间成员可改任何讨论室）、riseabove_messages_insert（发言人任填）、
--    note_feedbacks_manage、teacher_ai_configs_write 都不能原样放回去。
-- 2. 以后新建的表（postgres 建的，迁移和 SQL 编辑器都是这个身份）：不再授给 anon，不再授写权限给
--    authenticated，SELECT 和 service_role 照旧。取舍见文末。
-- 3. 自检：执行完如果还有遗漏（包括列级授权），整个迁移回滚。

-- ── 一、现有的表 ─────────────────────────────────────────────────────
-- ALL TABLES IN SCHEMA 含视图、物化视图、外部表、分区表；表级 REVOKE 会连同同名的列级授权一起收回。
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- ── 二、以后新建的表 ─────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM authenticated;

-- ── 三、自检 ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_any_column_privilege('anon', c.oid, 'SELECT')
      OR has_any_column_privilege('anon', c.oid, 'INSERT')
      OR has_any_column_privilege('anon', c.oid, 'UPDATE')
      OR has_any_column_privilege('anon', c.oid, 'REFERENCES')
      OR has_table_privilege('anon', c.oid, 'DELETE, TRUNCATE, TRIGGER, MAINTAIN'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '064: anon 仍有权限：%', v_bad;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_any_column_privilege('authenticated', c.oid, 'INSERT')
      OR has_any_column_privilege('authenticated', c.oid, 'UPDATE')
      OR has_any_column_privilege('authenticated', c.oid, 'REFERENCES')
      OR has_table_privilege('authenticated', c.oid, 'DELETE, TRUNCATE, TRIGGER, MAINTAIN'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '064: authenticated 仍有写权限：%', v_bad;
  END IF;

  IF NOT (has_table_privilege('authenticated', 'public.notes', 'SELECT')
      AND has_table_privilege('authenticated', 'public.relations', 'SELECT')
      AND has_table_privilege('authenticated', 'public.note_feedbacks', 'SELECT')) THEN
    RAISE EXCEPTION '064: Realtime 需要的 SELECT 丢了';
  END IF;

  SELECT d.defaclacl::text INTO v_bad
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE d.defaclrole = 'postgres'::regrole AND n.nspname = 'public' AND d.defaclobjtype = 'r'
    AND EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a
                WHERE (a.grantee = 'anon'::regrole)
                   OR (a.grantee = 'authenticated'::regrole AND a.privilege_type <> 'SELECT'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '064: 默认权限没改干净：%', v_bad;
  END IF;
END
$$;

-- ── 执行后核对 ───────────────────────────────────────────────────────
-- 1) 客户端对 public 只剩 authenticated 的 SELECT（应只有 authenticated / SELECT 一种组合）
-- SELECT grantee, privilege_type, count(*) FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') GROUP BY 1, 2;
-- 2) 默认权限：{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}
-- SELECT defaclacl FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
-- WHERE n.nspname = 'public' AND d.defaclobjtype = 'r' AND d.defaclrole = 'postgres'::regrole;
-- 3) 按账号复测：执行前的只读实测（学生、课程创建者、课程管理员、以学生身份入课的教师账号、平台管理员、
--    anon），切换身份后逐表 EXPLAIN INSERT / UPDATE / DELETE，执行后应全部 42501（course_enrollments 的
--    INSERT 仍先报 42P17，规划早于权限检查）。Realtime 三张表的可见行数执行前为：学生 121/104/0 与 81/40/0、
--    创建者 128/104/10、管理员 88/40/4、以学生身份入课的教师 88/40/0、平台管理员 0/0/0（notes/relations/
--    note_feedbacks），执行后应不变（期间有人发笔记会自然增加）。
-- 4) 回归：学生发笔记、Build-on、讨论室发言、求助、使用反馈；教师改课程设置、AI 配置、支架偏好、
--    发布反馈、回答求助；上传附件和课程资料；画布实时刷新。全部走 API 或存储，应照常。
--
-- ── 默认权限的取舍 ───────────────────────────────────────────────────
-- 收掉 anon 的默认授权：以后新表不会因为漏写 ENABLE ROW LEVEL SECURITY 就被前端公开的 anon key 读写
-- （Supabase 最常见的泄露方式）；038 之后 13 张表各自漏收 anon，这一条从源头止住，不必每个迁移都记得补 REVOKE。
-- 代价：哪天真要让未登录页面直连读某张表，得在那张表的迁移里显式 GRANT SELECT ... TO anon；照 Supabase
-- 教程写会拿到 42501 permission denied，报错明确，不会静默失败。
-- 收掉 authenticated 的默认写权限：和“写只走 API”的架构一致，写策略写宽了（比如 riseabove_rooms_update
-- 那种）也够不着。代价：将来若有功能要 supabase-js 直写，得显式 GRANT，并先审那张表的写策略。
-- authenticated 的默认 SELECT 保留：新表若要做 Realtime 不用另外授权，读仍由 RLS 管。如果想更严（新表
-- 客户端什么都拿不到，Realtime 也要显式 GRANT SELECT），再加一句
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM authenticated;
-- 默认权限只管 postgres 建的对象；别的角色（比如扩展以 supabase_admin 身份建表）不受影响。
-- 序列（public 下现有 0 个）和函数（anon 默认有 EXECUTE）的默认权限这里不动。
--
-- ── 回滚（只在确认有功能依赖客户端直连写时用，按需逐表恢复，别整片放回）──
-- GRANT INSERT, UPDATE, DELETE ON public.<表> TO authenticated;   -- 先审这张表的写策略
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
