-- 043 课程级支架偏好
--
-- 全局支架（五学期语料）是所有课程共用的。教师要能管理支架，但有两种不同的意图：
--   ①「这条支架我这门课不用」→ 只该影响自己的课
--   ②「这条支架写错了/不要了」→ 才是真的改动共用语料
-- 只给一个删除键会让 ① 变成 ②。这张表承载 ①，②走 scaffolds 表本身。

create table if not exists public.course_scaffold_prefs (
  course_id      uuid not null references public.courses(id) on delete cascade,
  scaffold_id    uuid not null references public.scaffolds(id) on delete cascade,
  hidden         boolean not null default false,
  is_recommended boolean,
  sort_order     integer,
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (course_id, scaffold_id)
);

comment on table public.course_scaffold_prefs is '教师在自己课程里对支架的取舍，不改动共用的全局支架';
comment on column public.course_scaffold_prefs.hidden is 'true = 这门课的学生看不到这条支架';

create index if not exists idx_course_scaffold_prefs_course on public.course_scaffold_prefs (course_id);

alter table public.course_scaffold_prefs enable row level security;

drop policy if exists course_scaffold_prefs_select on public.course_scaffold_prefs;
create policy course_scaffold_prefs_select on public.course_scaffold_prefs for select
  using (exists (select 1 from public.course_members m
                 where m.course_id = course_scaffold_prefs.course_id and m.user_id = (select auth.uid()))
         or public.is_course_instructor(course_id));

drop policy if exists course_scaffold_prefs_write on public.course_scaffold_prefs;
create policy course_scaffold_prefs_write on public.course_scaffold_prefs for all
  using (public.is_course_instructor(course_id))
  with check (public.is_course_instructor(course_id));
