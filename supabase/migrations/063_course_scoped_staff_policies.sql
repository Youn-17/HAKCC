-- 063：教师类 RLS 策略按课限定；这批表客户端只读
--
-- 2026-09-28 复查（接 061）。线上 36 条策略用裸 is_teacher_or_admin()，只看平台身份、不看哪门课。
-- 任何教师账号（包括凭学生验证码入课、课内只是普通成员的）用自己的 token 加前端公开的 anon key
-- 直连 PostgREST，就能读全平台的 ai_interventions（含对照组影子记录，等于揭盲）、events（含登录
-- 记录）、通知、选课名单、AI 反馈与采纳、分组与任务、笔记修订、对话参与者；还能改任意空间
-- （可挪到别的课、解绑小组）、往任意对话插消息（sender_kind 任填，可冒充 AI）、改学生的 AI 反馈
-- status / response_text（研究结果变量）、增删改全局支架库、以任意空间的名义写 events。
-- 其中 11 条在 061 已收回写权限的画布表上，已不起作用，也一并删掉，免得恢复写权限时洞跟着回来。
--
-- 前端从不直连读写这些表：supabase-js 只用于登录、存储上传和 notes / relations / note_feedbacks
-- 的 Realtime 订阅（这三张表的读策略这里不动）。所有读写走 API，API 用 service_role，不受这里影响。
--   1. 客户端写权限全部收回；用 is_teacher_or_admin() 的写策略删掉。已按课限定的写策略保留，
--      和 061 一样，没有写权限时不起作用。
--   2. 读策略里的 is_teacher_or_admin() 换成课内身份：is_course_instructor(course_id)
--      （平台管理员、课程创建者、course_members.role 为 teacher/admin 的课程管理员），或 can_access_space()。
--   3. 实验盲法与 API 同口径：学生读不到自己的影子记录（triggers /history 同样过滤 suppressed）、
--      小组和个人的 ai_feedback_condition（groups 接口只给教职）、对照组被抹掉的 suggested_scaffold
--      （hidesAiScaffold）。这三列按列收回，教职直连也读不到，界面上的条件与支架走 API，不受影响。
-- 本课的创建者 / 课程管理员照常能读本课数据；失去的是跨课读，以及对本课的直连写（前端从来不用）。

-- ── 零、辅助函数 ──────────────────────────────────────────────────────
-- 只读 spaces 却是 VOLATILE，用在策略里会逐行重算（035 修过同类问题）
ALTER FUNCTION public.get_space_course(uuid) STABLE;

-- 笔记所属课程，不经 notes 的 RLS。修订策略里教职要按课判断：notes_select 会藏掉已软删除的笔记，
-- 也不认平台管理员，经它判断的话，创建者读不到本课已删笔记的修订（线上有 1 条），管理员一条都读不到。
CREATE OR REPLACE FUNCTION public.get_note_course(p_note_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  select s.course_id from public.notes n join public.spaces s on s.id = n.space_id where n.id = p_note_id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_note_course(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_note_course(uuid) TO authenticated, service_role;

-- ── 一、收回客户端写权限 ─────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.ai_interventions, public.events, public.notifications,
  public.groups, public.group_members, public.group_tasks, public.group_idea_graphs,
  public.note_ai_feedbacks, public.note_ai_insertions, public.note_revisions,
  public.note_conversation_threads, public.note_conversation_messages, public.note_conversation_participants,
  public.scaffolds, public.spaces
FROM anon, authenticated;

-- 047 / 049 建表时按默认权限授给了 anon，061 之后还剩 SELECT。匿名本来读不到行，收掉。
REVOKE ALL ON public.doc_annotations, public.view_cards FROM anon;

-- ── 二、删掉用 is_teacher_or_admin() 的写策略 ───────────────────────────
DROP POLICY IF EXISTS events_insert_self                ON public.events;
DROP POLICY IF EXISTS notifications_update_own          ON public.notifications;
DROP POLICY IF EXISTS group_tasks_insert                ON public.group_tasks;
DROP POLICY IF EXISTS group_tasks_update                ON public.group_tasks;
DROP POLICY IF EXISTS group_tasks_delete                ON public.group_tasks;
DROP POLICY IF EXISTS note_ai_feedbacks_update          ON public.note_ai_feedbacks;
DROP POLICY IF EXISTS note_conversation_threads_insert  ON public.note_conversation_threads;
DROP POLICY IF EXISTS note_conversation_messages_insert ON public.note_conversation_messages;
DROP POLICY IF EXISTS scaffolds_insert                  ON public.scaffolds;
DROP POLICY IF EXISTS scaffolds_update                  ON public.scaffolds;
DROP POLICY IF EXISTS scaffolds_delete                  ON public.scaffolds;
DROP POLICY IF EXISTS spaces_update                     ON public.spaces;

-- 061 已收回写权限的画布表
DROP POLICY IF EXISTS notes_update           ON public.notes;
DROP POLICY IF EXISTS notes_delete           ON public.notes;
DROP POLICY IF EXISTS relations_update       ON public.relations;
DROP POLICY IF EXISTS relations_delete       ON public.relations;
DROP POLICY IF EXISTS views_update           ON public.views;
DROP POLICY IF EXISTS views_delete           ON public.views;
DROP POLICY IF EXISTS view_cards_delete      ON public.view_cards;
DROP POLICY IF EXISTS space_shapes_update    ON public.space_shapes;
DROP POLICY IF EXISTS space_shapes_delete    ON public.space_shapes;
DROP POLICY IF EXISTS doc_annotations_update ON public.doc_annotations;
DROP POLICY IF EXISTS doc_annotations_delete ON public.doc_annotations;

-- ── 三、读策略按课限定 ────────────────────────────────────────────────
-- 影子记录（suppressed）是对照组的反事实记录，学生看到自己的就知道自己在哪一组
ALTER POLICY ai_interventions_select_auth ON public.ai_interventions TO authenticated
  USING ((user_id = (select auth.uid()) AND NOT suppressed)
         OR (select public.is_admin())
         OR public.is_course_instructor(public.get_space_course(space_id)));

ALTER POLICY course_members_select ON public.course_members TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_course_instructor(course_id));

-- space_id 为空的是平台级事件（登录记录等），只给平台管理员
ALTER POLICY events_select_teacher ON public.events TO authenticated
  USING ((select public.is_admin()) OR public.is_course_instructor(public.get_space_course(space_id)));

ALTER POLICY group_idea_graphs_select ON public.group_idea_graphs TO authenticated
  USING (public.is_course_instructor(course_id)
         OR EXISTS (SELECT 1 FROM public.group_members gm
                    WHERE gm.group_id = group_idea_graphs.group_id AND gm.user_id = (select auth.uid())));

ALTER POLICY group_members_select ON public.group_members TO authenticated
  USING (EXISTS (SELECT 1 FROM public.groups g
                 WHERE g.id = group_members.group_id
                   AND (public.is_course_member(g.course_id) OR public.is_course_instructor(g.course_id))));

ALTER POLICY group_tasks_select ON public.group_tasks TO authenticated
  USING (EXISTS (SELECT 1 FROM public.groups g
                 WHERE g.id = group_tasks.group_id
                   AND (public.is_course_member(g.course_id) OR public.is_course_instructor(g.course_id))));

-- 创建者不一定有成员行（线上 5 门课里有 1 门），所以要带上 is_course_instructor
ALTER POLICY groups_select ON public.groups TO authenticated
  USING (public.is_course_member(course_id) OR public.is_course_instructor(course_id));

ALTER POLICY note_ai_feedbacks_select ON public.note_ai_feedbacks TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_course_instructor(course_id));

ALTER POLICY note_ai_insertions_select ON public.note_ai_insertions TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_course_instructor(course_id));

ALTER POLICY note_conversation_participants_select ON public.note_conversation_participants TO authenticated
  USING (user_id = (select auth.uid())
         OR public.is_note_conversation_participant(thread_id)
         OR EXISTS (SELECT 1 FROM public.note_conversation_threads t
                    WHERE t.id = note_conversation_participants.thread_id
                      AND public.is_course_instructor(t.course_id)));

-- 教职看本课全部修订（含已删笔记）；其他人跟着笔记走：能读这条笔记（同 notes_select，小组空间按组隔离）才能读
ALTER POLICY note_revisions_select ON public.note_revisions TO authenticated
  USING (editor_id = (select auth.uid())
         OR public.is_course_instructor(public.get_note_course(note_id))
         OR EXISTS (SELECT 1 FROM public.notes n
                    WHERE n.id = note_revisions.note_id AND public.can_access_space(n.space_id)));

-- 通知只给收件人，API 同口径（GET /notifications 按 user_id 取）
ALTER POLICY notifications_select_own ON public.notifications TO authenticated
  USING (user_id = (select auth.uid()));

ALTER POLICY scaffolds_select ON public.scaffolds TO authenticated
  USING (course_id IS NULL OR public.is_course_member(course_id) OR public.is_course_instructor(course_id));

-- ── 四、实验条件与被抹掉的支架按列收回 ─────────────────────────────────
-- 列级 REVOKE 对表级 GRANT 无效（038 的教训）：先撤表级 SELECT，再逐列授予。
REVOKE SELECT ON public.groups FROM authenticated;
GRANT SELECT (id, name, course_id, leader_id, color, created_at) ON public.groups TO authenticated;

REVOKE SELECT ON public.course_members FROM authenticated;
GRANT SELECT (course_id, user_id, joined_at, participant_number, role) ON public.course_members TO authenticated;

REVOKE SELECT ON public.note_ai_feedbacks FROM authenticated;
GRANT SELECT (id, note_id, space_id, course_id, user_id, provider_id, model, trigger_type, trigger_context,
              draft_excerpt, feedback_text, status, response_text, created_at, responded_at, published_note_id,
              rejection_reason, rejection_tag, suggested_scaffold_used_at)
  ON public.note_ai_feedbacks TO authenticated;

-- ── 五、给后来人的提醒 ────────────────────────────────────────────────
COMMENT ON FUNCTION public.is_teacher_or_admin() IS
  '只看平台身份（profiles.role），不含课程谓词。不要用在 RLS 策略里，任何教师账号都会通过。'
  '按课判断用 is_course_instructor(course_id) 或 can_access_space(space_id)。';

-- 执行后核对：
-- 1) 策略里不再有 is_teacher_or_admin（应为 0 行）
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND coalesce(qual, '') || coalesce(with_check, '') ILIKE '%is_teacher_or_admin%';
-- 2) 这批表对 anon / authenticated 只剩 SELECT；groups / course_members / note_ai_feedbacks 没有表级 SELECT
-- SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
--   AND table_name IN ('ai_interventions','events','notifications','groups','group_members','group_tasks',
--                      'group_idea_graphs','note_ai_feedbacks','note_ai_insertions','note_revisions',
--                      'note_conversation_threads','note_conversation_messages','note_conversation_participants',
--                      'scaffolds','spaces','course_members','doc_annotations','view_cards')
-- GROUP BY 1, 2 ORDER BY 1, 2;
-- 3) 三个盲法列客户端读不到（应全为 false）
-- SELECT has_column_privilege('authenticated', 'public.groups', 'ai_feedback_condition', 'SELECT'),
--        has_column_privilege('authenticated', 'public.course_members', 'ai_feedback_condition', 'SELECT'),
--        has_column_privilege('authenticated', 'public.note_ai_feedbacks', 'suggested_scaffold', 'SELECT');
