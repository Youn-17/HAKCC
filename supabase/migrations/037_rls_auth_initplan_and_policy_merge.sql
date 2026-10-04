-- 037_rls_auth_initplan_and_policy_merge.sql
--
-- 承接 035。Supabase 性能顾问从 217 条降到 96 条，这里是剩下那两类的修复。
--
-- 1) auth_rls_initplan（94 条，跨 42 张表）
--    策略里直接写 auth.uid() 时，Postgres 把它当逐行表达式，**每一行调用一次**。
--    包成 (select auth.uid()) 之后成为 InitPlan，每条语句只算一次。
--    语义完全不变 —— 改写前后做过归一化比对：123 条策略的谓词、命令、角色零差异。
--
-- 2) multiple_permissive_policies（60 → 30）
--    同表同动作的多条宽松策略是 OR 关系，Postgres 要逐条求值再取并集。
--    合并成一条等价策略。
--
-- 3) 又两个 SECURITY DEFINER 函数漏标 STABLE（035 只改了三个），
--    以及 is_note_conversation_creator 的 search_path bug —— 与它的兄弟函数
--    is_note_conversation_participant 一模一样：设了 search_path='' 却引用未限定的表，
--    **每次调用必抛 42P01**。实测确认。

-- ── 1) 把策略里的 auth.*() 包进 select ────────────────────────────────
-- 逐条手写 100+ 语句容易出错，按 pg_policies 自动改写。
do $$
declare r record; stmt text;
begin
  for r in
    select policyname, tablename, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and ( (qual ~ 'auth\.(uid|role|jwt)\(\)' and qual !~ '\(\s*SELECT\s+auth\.')
         or (with_check ~ 'auth\.(uid|role|jwt)\(\)' and with_check !~ '\(\s*SELECT\s+auth\.') )
  loop
    stmt := format('alter policy %I on public.%I%s%s',
      r.policyname, r.tablename,
      case when r.qual is not null
           then ' using (' || regexp_replace(r.qual, 'auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g') || ')'
           else '' end,
      case when r.with_check is not null
           then ' with check (' || regexp_replace(r.with_check, 'auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g') || ')'
           else '' end);
    execute stmt;
  end loop;
end $$;

-- ── 3) 补标 STABLE + 修 search_path ───────────────────────────────────

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.profiles
                 where id = (select auth.uid()) and role = 'teacher' and status = 'active');
$$;

-- public. 前缀是这里的关键；缺了它函数一调用就报错。
create or replace function public.is_note_conversation_creator(
  p_thread_id uuid, p_user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.note_conversation_threads
                 where id = p_thread_id and created_by = p_user_id);
$$;

-- ── 2) 合并重复宽松策略 ───────────────────────────────────────────────
-- 合并前后可见性一致：谓词只是把原来的几条用 OR 接起来。

drop policy if exists "profiles: admin read all" on public.profiles;
drop policy if exists "profiles: own read" on public.profiles;
drop policy if exists "profiles: teacher see enrolled students" on public.profiles;
create policy "profiles: read" on public.profiles for select using (
  (select auth.uid()) = id
  or public.is_admin()
  or (public.is_teacher() and exists (
        select 1 from public.course_enrollments ce
        join public.courses c on c.id = ce.course_id
        where ce.student_id = profiles.id and c.instructor_id = (select auth.uid())))
);

drop policy if exists "profiles: admin update" on public.profiles;
drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: update" on public.profiles for update
  using ((select auth.uid()) = id or public.is_admin())
  with check ((select auth.uid()) = id or public.is_admin());

drop policy if exists "courses: admin update" on public.courses;
drop policy if exists "courses: teacher update own" on public.courses;
create policy "courses: update" on public.courses for update
  using ((select auth.uid()) = instructor_id or public.is_admin());

drop policy if exists "enrollments: student read own" on public.course_enrollments;
drop policy if exists "enrollments: teacher read own courses" on public.course_enrollments;
create policy "enrollments: read" on public.course_enrollments for select using (
  (select auth.uid()) = student_id
  or exists (select 1 from public.courses c
             where c.id = course_enrollments.course_id and c.instructor_id = (select auth.uid()))
);

drop policy if exists "enrollments: student self unenroll" on public.course_enrollments;
drop policy if exists "enrollments: teacher remove" on public.course_enrollments;
create policy "enrollments: delete" on public.course_enrollments for delete using (
  (select auth.uid()) = student_id
  or exists (select 1 from public.courses c
             where c.id = course_enrollments.course_id and c.instructor_id = (select auth.uid()))
);

-- ── 刻意没做 ──────────────────────────────────────────────────────────
-- 还剩 30 条 multiple_permissive_policies，都是同一个结构模式：
-- agent_reflections / learner_profiles / note_embeddings / note_feedbacks /
-- teacher_ai_configs 各有一条 FOR ALL 加一条 FOR SELECT，ALL 覆盖了 SELECT。
-- 消掉要把 FOR ALL 拆成 INSERT/UPDATE/DELETE 三条。没做，因为风险收益不成比例：
-- 这几张都是低频小表（learner_profiles 每人一行、teacher_ai_configs 几行），
-- 每行开销可忽略；而 teacher_ai_configs 存加密 API 密钥、note_feedbacks 管反馈发布，
-- 拆错就是开课前把 AI 或反馈搞挂。真正有量的表已经在上面处理完了。
