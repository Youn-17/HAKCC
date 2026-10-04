-- 035_rls_function_volatility_and_fk_indexes.sql
--
-- 性能加固（2026-08-31）。Supabase 顾问报了 217 条性能问题，这里处理其中
-- 影响最直接、风险最低的三类。
--
-- 1) 三个 SECURITY DEFINER 权限函数被建成 VOLATILE。Postgres 无法缓存 VOLATILE
--    函数的结果，必须**逐行**调用，而它们内部各自还要查一次库。
--    is_note_conversation_participant 挂在 note_conversation_messages 的读策略上，
--    读 N 条消息就多 N 次查询 —— 正是「小组讨论超过 30 条」会卡的那条路径。
--    三者都是纯 SELECT EXISTS，只读无副作用，STABLE 是正确标记。
--    （can_access_space 建的时候已经是 STABLE，不用动。）
--
-- 2) is_note_conversation_participant 设了 search_path='' 却引用未限定的
--    note_conversation_participants —— 每次调用必然抛
--    `relation "note_conversation_participants" does not exist`。
--    实测确认。当前后端全走 service role 绕过 RLS，所以这颗雷还没炸，但这张表上的
--    RLS 实际处于「一调用就报错」的状态（fail-closed，安全无虞、功能全废）。
--
-- 3) 12 个外键没有覆盖索引。级联删除与按外键的反查会退化成全表扫描。

-- ── 1 + 2：重建三个函数 ────────────────────────────────────────────────

create or replace function public.is_teacher_or_admin()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role in ('teacher', 'admin') and status = 'active'
  );
$$;

create or replace function public.is_course_member(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.course_members
    where course_id = p_course_id and user_id = auth.uid()
  );
$$;

-- public. 前缀是这次修复的关键；缺了它函数一调用就报错。
create or replace function public.is_note_conversation_participant(
  p_thread_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.note_conversation_participants
    where thread_id = p_thread_id and user_id = p_user_id
  );
$$;

-- ── 3：补齐外键索引 ───────────────────────────────────────────────────

create index if not exists idx_agent_reflections_course_id       on public.agent_reflections (course_id);
create index if not exists idx_agent_runs_course_id              on public.agent_runs (course_id);
create index if not exists idx_course_members_user_id            on public.course_members (user_id);
create index if not exists idx_edges_to_note                     on public.edges (to_note);
create index if not exists idx_group_members_user_id             on public.group_members (user_id);
create index if not exists idx_learner_profiles_course_id        on public.learner_profiles (course_id);
create index if not exists idx_note_ai_feedbacks_user_id         on public.note_ai_feedbacks (user_id);
create index if not exists idx_note_ai_insertions_user_id        on public.note_ai_insertions (user_id);
create index if not exists idx_teacher_agent_memory_course_id    on public.teacher_agent_memory (course_id);
create index if not exists idx_turing_test_participants_user_id  on public.turing_test_participants (user_id);
create index if not exists idx_turing_test_votes_participant_id  on public.turing_test_votes (participant_id);
create index if not exists idx_turing_test_votes_voter_id        on public.turing_test_votes (voter_id);
