-- 036_group_idea_graphs.sql
--
-- 小组观点图谱（Idea graph）的快照存储。
--
-- 为什么存快照而不是每次实时算：
--  1) 概念抽取要扫全组笔记做 n-gram 统计，一个组几百条笔记时不该在请求里跑；
--  2) 「大概一周自动总结一次」本身就要求留存历史 —— 学生要看得出上周到这周
--     多了什么概念、哪条讨论线长起来了。没有上一期就算不出「新增」。
--
-- 覆盖窗口从上一期的 window_end 接续，第一期从建组日算起。
-- 命名用「观点图谱」不用「知识图谱」：图上是学生自己提出的观点，不是既有知识。

create table if not exists public.group_idea_graphs (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,
  generated_at  timestamptz not null default now(),
  window_start  timestamptz not null,
  window_end    timestamptz not null,
  note_count    integer not null default 0,
  -- 图谱与进展的完整结构，前端直接渲染，不再二次计算
  payload       jsonb not null,
  -- 'auto' = 满 7 天自动生成；'manual' = 教师手动触发
  trigger       varchar(10) not null default 'auto',
  -- 注意：profiles 是表、users 是视图 —— 与迁移 008 的注释正好相反。以线上为准。
  created_by    uuid references public.profiles(id) on delete set null
);

create index if not exists idx_group_idea_graphs_group_generated
  on public.group_idea_graphs (group_id, generated_at desc);
create index if not exists idx_group_idea_graphs_course_id
  on public.group_idea_graphs (course_id);
create index if not exists idx_group_idea_graphs_created_by
  on public.group_idea_graphs (created_by);

alter table public.group_idea_graphs enable row level security;

-- 本组成员看自己组；教师看本课程所有组。
-- 走 is_course_member / is_teacher_or_admin —— 两者在 035 里已改为 STABLE，
-- 不会每行重算。
create policy group_idea_graphs_select on public.group_idea_graphs
  for select
  using (
    public.is_teacher_or_admin()
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = group_idea_graphs.group_id
        and gm.user_id = (select auth.uid())
    )
  );

-- 写入只走服务端 service role，前端不直接插。
