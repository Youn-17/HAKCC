-- 038_security_rls_holes.sql
--
-- 2026-09-01 数据库安全复查。实测发现三个真实漏洞，全部已验证修复。
-- 复查动机：035–037 动过大量策略，需要确认没有留下敞口。
--
-- ══ 漏洞一：views / space_shapes 从未开启 RLS（顾问 ERROR）══
-- 两张表授予了 anon 全部 CRUD 且无 RLS。实测用前端包里那把 publishable key
-- 匿名插入，**通过了权限检查**，只在外键约束上失败（23503）——也就是说只要拿到
-- 一个真实 space_id（任何选课学生都有），就能往任意课程的画布写数据、读走所有 View。
-- 对照：notes 返回 42501 permission denied，那才是正确状态。
--
-- ══ 漏洞二：任何登录学生可直接读走所有课程的验证码与导出盐 ══
-- courses 的读策略是 `auth.uid() IS NOT NULL`（课程发现需要），但表级 SELECT
-- 授权把 verification_code 和 export_salt 一并给了出去。实测学生直连读到全部
-- 4 门课的验证码 —— 拿着它就能自助加入任意课程。这正是 migration 034 在 API 层
-- 堵住、数据库层却一直敞着的同一条路。export_salt 是研究化名的盐，泄露可反推身份。
-- 注意：列级 REVOKE 对已存在的表级 GRANT 无效，必须先撤表级再逐列授予。
--
-- ══ 漏洞三：18 条策略用裸 is_teacher_or_admin()，没有课程谓词 ══
-- 最严重的是 teacher_ai_configs（存加密 API 密钥）：实测一个只协同任教 1 门课的
-- 教师账号，读到了 3 门课全部 15 条配置。同类问题还有学生对话、反馈、分组、
-- 脚手架、空间、通知 —— 分组尤其要紧，它是整群随机实验的随机化单位。

-- ── 课程级教师判定：与 API 的 ensureCourseInstructor 同口径 ──────────
-- 「有一行成员记录」证明不了什么，学生自助 join 也会写一行，必须看 role
-- （migration 034 的教训）。
create or replace function public.is_course_instructor(p_course_id uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select p_course_id is not null and (
    public.is_admin()
    or exists (select 1 from public.courses c
               where c.id = p_course_id and c.instructor_id = (select auth.uid()))
    or exists (select 1 from public.course_members cm
               where cm.course_id = p_course_id and cm.user_id = (select auth.uid())
                 and cm.role in ('teacher','admin'))
  );
$$;

-- ── 漏洞一 ───────────────────────────────────────────────────────────
alter table public.views        enable row level security;
alter table public.space_shapes enable row level security;

create policy views_select on public.views for select using (public.can_access_space(space_id));
create policy views_insert on public.views for insert with check (public.can_access_space(space_id));
create policy views_update on public.views for update
  using (creator_id = (select auth.uid()) or public.is_teacher_or_admin())
  with check (public.can_access_space(space_id));
create policy views_delete on public.views for delete
  using (creator_id = (select auth.uid()) or public.is_teacher_or_admin());

create policy space_shapes_select on public.space_shapes for select using (public.can_access_space(space_id));
create policy space_shapes_insert on public.space_shapes for insert with check (public.can_access_space(space_id));
create policy space_shapes_update on public.space_shapes for update
  using (created_by = (select auth.uid()) or public.is_teacher_or_admin())
  with check (public.can_access_space(space_id));
create policy space_shapes_delete on public.space_shapes for delete
  using (created_by = (select auth.uid()) or public.is_teacher_or_admin());

-- can_access_space 是整个授权体系的核心（notes/relations/spaces/views/space_shapes
-- 的读策略全走它），却是 SECURITY DEFINER 且没锁 search_path。补上并限定 schema。
create or replace function public.can_access_space(p_space_id uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.spaces s
    join public.courses c on c.id = s.course_id
    where s.id = p_space_id and (
      c.instructor_id = (select auth.uid())
      or exists (select 1 from public.course_members cm
                 where cm.course_id = c.id and cm.user_id = (select auth.uid())
                   and cm.role in ('teacher','admin'))
      or (exists (select 1 from public.course_members cm
                  where cm.course_id = c.id and cm.user_id = (select auth.uid()))
          and (s.group_id is null
               or exists (select 1 from public.group_members gm
                          where gm.group_id = s.group_id and gm.user_id = (select auth.uid()))))
    )
  );
$$;

-- ── 漏洞二 ───────────────────────────────────────────────────────────
revoke select on public.courses from authenticated;
grant select (
  id, instructor_id, title, description, status, created_at, updated_at,
  approval_status, rejection_reason, cover_image, tags, english_name, code_abbr
) on public.courses to authenticated;
-- 刻意不授 verification_code 与 export_salt

-- ── 漏洞三 ───────────────────────────────────────────────────────────
drop policy if exists teacher_ai_configs_select_teacher on public.teacher_ai_configs;
drop policy if exists teacher_ai_configs_write_teacher  on public.teacher_ai_configs;
create policy teacher_ai_configs_select on public.teacher_ai_configs for select
  using (public.is_course_instructor(course_id));
create policy teacher_ai_configs_write on public.teacher_ai_configs for all
  using (public.is_course_instructor(course_id))
  with check (public.is_course_instructor(course_id));

drop policy if exists note_conversation_threads_select on public.note_conversation_threads;
create policy note_conversation_threads_select on public.note_conversation_threads for select
  using (public.is_course_instructor(course_id) or public.is_note_conversation_participant(id));

drop policy if exists note_conversation_messages_select on public.note_conversation_messages;
create policy note_conversation_messages_select on public.note_conversation_messages for select
  using (public.is_note_conversation_participant(thread_id)
         or exists (select 1 from public.note_conversation_threads t
                    where t.id = note_conversation_messages.thread_id
                      and public.is_course_instructor(t.course_id)));

drop policy if exists note_conversation_participants_insert on public.note_conversation_participants;
create policy note_conversation_participants_insert on public.note_conversation_participants for insert
  with check (public.is_note_conversation_creator(thread_id)
              or exists (select 1 from public.note_conversation_threads t
                         where t.id = note_conversation_participants.thread_id
                           and public.is_course_instructor(t.course_id)));

drop policy if exists note_feedbacks_manage on public.note_feedbacks;
create policy note_feedbacks_manage on public.note_feedbacks for all
  using (exists (select 1 from public.spaces s
                 where s.id = note_feedbacks.space_id and public.is_course_instructor(s.course_id)))
  with check (exists (select 1 from public.spaces s
                      where s.id = note_feedbacks.space_id and public.is_course_instructor(s.course_id)));

drop policy if exists groups_insert on public.groups;
drop policy if exists groups_update on public.groups;
drop policy if exists groups_delete on public.groups;
create policy groups_insert on public.groups for insert with check (public.is_course_instructor(course_id));
create policy groups_update on public.groups for update
  using (public.is_course_instructor(course_id)) with check (public.is_course_instructor(course_id));
create policy groups_delete on public.groups for delete using (public.is_course_instructor(course_id));

drop policy if exists group_members_insert on public.group_members;
drop policy if exists group_members_delete on public.group_members;
create policy group_members_insert on public.group_members for insert
  with check (exists (select 1 from public.groups g
                      where g.id = group_members.group_id and public.is_course_instructor(g.course_id)));
create policy group_members_delete on public.group_members for delete
  using (exists (select 1 from public.groups g
                 where g.id = group_members.group_id and public.is_course_instructor(g.course_id)));

drop policy if exists scaffolds_insert on public.scaffolds;
drop policy if exists scaffolds_update on public.scaffolds;
drop policy if exists scaffolds_delete on public.scaffolds;
create policy scaffolds_insert on public.scaffolds for insert
  with check (course_id is null or public.is_course_instructor(course_id));
create policy scaffolds_update on public.scaffolds for update
  using (course_id is null or public.is_course_instructor(course_id))
  with check (course_id is null or public.is_course_instructor(course_id));
create policy scaffolds_delete on public.scaffolds for delete
  using (course_id is null or public.is_course_instructor(course_id));

drop policy if exists spaces_insert on public.spaces;
create policy spaces_insert on public.spaces for insert with check (public.is_course_instructor(course_id));

-- 通知带 link_type/link_id，可被用来做钓鱼。限定为「与自己有共同课程、且自己
-- 在那门课是教师」的接收者。
drop policy if exists notifications_insert_teacher on public.notifications;
create policy notifications_insert_teacher on public.notifications for insert
  with check (
    exists (select 1 from public.course_members cm
            where cm.user_id = notifications.user_id and public.is_course_instructor(cm.course_id))
    or exists (select 1 from public.courses c
               where c.instructor_id = (select auth.uid())
                 and exists (select 1 from public.course_members cm2
                             where cm2.course_id = c.id and cm2.user_id = notifications.user_id))
  );

-- ct_problems 原本开了 RLS 却一条策略都没有 = 全拒。功能上没坏（应用走 service
-- role），但「靠没有策略来保证安全」是意外而非设计，补上明确策略。
create policy ct_problems_select on public.ct_problems for select
  using (course_id is null or public.is_course_member(course_id) or public.is_course_instructor(course_id));
create policy ct_problems_write on public.ct_problems for all
  using (public.is_course_instructor(course_id)) with check (public.is_course_instructor(course_id));

-- ── 纵深防御：收回 anon 的一切 ──────────────────────────────────────
-- 前端从不匿名查表 —— supabase 客户端只用于登录与 realtime 订阅，而订阅是登录后
-- 以 authenticated 身份进行的。anon 原本在 33 张表上有全部 CRUD，是纯风险敞口：
-- 将来任何一张表漏配策略，就直接暴露给整个互联网。
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','v','m','f','p')
  loop execute format('revoke all on public.%I from anon', r.relname); end loop;

  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and p.proname in ('can_access_space','is_course_member','is_course_instructor',
                               'is_teacher_or_admin','is_admin','is_teacher',
                               'is_note_conversation_participant','is_note_conversation_creator',
                               'get_space_course')
  loop execute format('revoke execute on function %s from anon', r.sig); end loop;
end $$;

revoke all on public.mv_agent_daily_stats from anon, authenticated;

-- ── 实测结论 ─────────────────────────────────────────────────────────
-- 匿名：views/space_shapes/courses/notes/profiles/group_idea_graphs 全部 42501。
-- 学生：读不到 verification_code 与 export_salt（42501），课程发现仍可用（4 门）；
--       笔记 21、连线 30、空间 1、组员 9 —— 该看的都在。
-- 教师：AI 配置 15 条跨 3 课 → 5 条仅本课；对话线程 14 个全部本课；
--       跨课建组返回 42501。
-- 应用：学生端 8 个端点、教师端 4 个端点全部 200。
-- 顾问：83 → 69 条，ERROR 2 → 0。
