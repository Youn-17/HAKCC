-- 2026-10-10 用户：小组在共享空间里各用一个视图讨论（「为每组建视图」），教师一键给各组发布任务，
-- 任务以面板显示在视图里（不是笔记，学生不能 Build-on），可以选发到哪个视图。

-- 视图归属哪个组：「为每组建视图」建的视图记上组，重复点不会重复建；发任务时可以选「各组自己的视图」
alter table public.views add column if not exists group_id uuid references public.groups(id) on delete set null;
create unique index if not exists views_space_group_unique on public.views (space_id, group_id) where group_id is not null;

-- 教师发布的任务。只经服务端 API 读写：课程教职发布、修改、撤回；组员只读本组收到的。客户端直连一律拒绝。
create table if not exists public.group_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  content text not null default '',
  requirements text not null default '',
  due_at timestamptz,
  -- 显示在哪：any = 所有视图；view = 某个空间的某个视图（主画布是 'view-welcome'，不是 views 表里的行，所以 view_id 是文本）；
  -- group_view = 某个空间里各组自己的视图（views.group_id）。空间删了退回 any。
  placement text not null default 'any',
  space_id uuid references public.spaces(id) on delete set null,
  view_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint group_assignments_title_len check (char_length(title) between 1 and 200),
  constraint group_assignments_content_len check (char_length(content) <= 8000),
  constraint group_assignments_requirements_len check (char_length(requirements) <= 8000),
  constraint group_assignments_view_len check (view_id is null or char_length(view_id) <= 64),
  constraint group_assignments_placement check (placement in ('any', 'view', 'group_view'))
);
create index if not exists group_assignments_course_created_idx
  on public.group_assignments (course_id, created_at desc) where deleted_at is null;

create table if not exists public.group_assignment_targets (
  assignment_id uuid not null references public.group_assignments(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  primary key (assignment_id, group_id)
);
create index if not exists group_assignment_targets_group_idx on public.group_assignment_targets (group_id);

alter table public.group_assignments enable row level security;
alter table public.group_assignment_targets enable row level security;
revoke all on public.group_assignments from anon, authenticated;
revoke all on public.group_assignment_targets from anon, authenticated;
grant select, insert, update, delete on public.group_assignments to service_role;
grant select, insert, update, delete on public.group_assignment_targets to service_role;
comment on table public.group_assignments is 'Tasks a course teacher publishes to groups; shown as a read-only panel in group spaces. Not notes. Access only through the staff-authorized API.';
comment on table public.group_assignment_targets is 'Which groups received a group assignment.';
