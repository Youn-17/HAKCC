-- ============================================================
-- 068 学习目标、学习任务、作业提交三张表
-- ============================================================
--
-- 起草时未执行，等用户审阅后再上生产。
--
-- 课程设置页「学习目标」「学习任务」两个页签的接口一直 500，原因是表不存在。005 定义过这三张表，
-- 但首尔新库从没跑成（外键写的是 users，新库里 public.users 是 profiles 上的视图，外键建不上），
-- 060 当时只补建了 course_materials。2026-09-29 查 pg_class，public 下和课程有关的表只有
-- course_enrollments、course_materials、course_members、course_scaffold_prefs、course_sessions、
-- courses、group_tasks。
--
-- 列按 api/src/routes/courseSettings.ts 实际读写的来，没有照抄 005：
--   · 用户列外键指 public.profiles。API 用 users!created_by(...)、users!student_id(...) 内联姓名和头像，
--     PostgREST 只沿外键解析关系，指 auth.users 或 users 视图都建不成，接口直接 400。
--   · 状态和提交类型用 text + check，不用 005 的三个枚举类型：create type 没有 if not exists，
--     库里要是留着 005 半跑时建的同名枚举，整个迁移会报错。
--   · priority 只有 0 低 / 1 中 / 2 高三档：界面只有这三档，接口也只收这三个值。
--   · 分值 0–1000，得分不能为负。得分不超过任务分值由接口判断，check 约束跨不了表。
--   · 每个学生每个任务只有一份提交（唯一约束），重交改的是同一行。
--   · updated_at 由触发器维护。接口读 course_tasks.updated_at，而改任务的路径不止一条，
--     靠每处手写迟早会漏；course_goals 同样处理。提交的时间看 submitted_at / graded_at，不另加。
--   · 外键都有覆盖索引（035 的约定）：course_id 是复合索引的第一列，task_id 在唯一约束里，
--     created_by、student_id 单独建。
--
-- 权限同 060、064、066：读写全走 API（service_role）。前端没有一处用 supabase-js 直连这三张表，
-- 也不订阅它们的 Realtime，所以 anon 和 authenticated 一项权限都不给。064 之后新表默认授
-- authenticated SELECT，这里显式收回。RLS 开着、零策略。谁能读、谁能改，由 API 按课内身份判断：
-- 课程成员能读本课的目标和已发布的任务，只能看、交自己的提交；创建者和课程管理员能改。
--
-- 表已经存在（结构和这里不同）时，create table if not exists 会跳过建表，末尾的自检会报错并整体回滚，
-- 这时需要先手工对齐。生产上三张表都不存在，不会走到这一步。

-- ── 一、三张表 ───────────────────────────────────────────────────────

create table if not exists public.course_goals (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  title       varchar(200) not null,
  description text,
  priority    smallint not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint course_goals_title_chk check (btrim(title) <> ''),
  constraint course_goals_priority_chk check (priority between 0 and 2)
);

create table if not exists public.course_tasks (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  title       varchar(200) not null,
  description text,
  due_date    timestamptz,
  points      integer not null default 0,
  status      text not null default 'published',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint course_tasks_title_chk check (btrim(title) <> ''),
  constraint course_tasks_points_chk check (points between 0 and 1000),
  constraint course_tasks_status_chk check (status in ('draft', 'published', 'closed'))
);

create table if not exists public.task_submissions (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.course_tasks(id) on delete cascade,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  content         text,
  file_url        text,
  file_name       varchar(255),
  drawing_data    jsonb,
  video_url       text,
  submission_type text not null default 'text',
  status          text not null default 'pending',
  submitted_at    timestamptz,
  graded_at       timestamptz,
  feedback        text,
  points_awarded  integer,
  constraint task_submissions_one_per_student unique (task_id, student_id),
  constraint task_submissions_type_chk check (submission_type in ('text', 'file', 'drawing', 'video', 'mixed')),
  constraint task_submissions_status_chk check (status in ('pending', 'submitted', 'graded', 'returned')),
  constraint task_submissions_points_chk check (points_awarded is null or points_awarded >= 0)
);

comment on table public.course_goals is
  '课程的学习目标。priority 0 低 / 1 中 / 2 高；备课助手生成教案时读排在前面的 5 条。只经 API 读写。';
comment on table public.course_tasks is
  '课程布置的学习任务。status: draft 只有课程教职看得到 / published 学生可见可交 / closed 学生可见、不再收。只经 API 读写。';
comment on table public.task_submissions is
  '学生对学习任务的提交，每人每个任务一行，重交改同一行。只经 API 读写。';

-- ── 二、索引 ─────────────────────────────────────────────────────────
-- 目标列表按 priority 降序、同档按建立先后；任务列表按建立时间倒序；提交按 task_id 取，走唯一约束的索引。

create index if not exists idx_course_goals_course_priority
  on public.course_goals (course_id, priority desc, created_at);
create index if not exists idx_course_goals_created_by on public.course_goals (created_by);

create index if not exists idx_course_tasks_course on public.course_tasks (course_id, created_at desc);
create index if not exists idx_course_tasks_created_by on public.course_tasks (created_by);

create index if not exists idx_task_submissions_student on public.task_submissions (student_id);

-- ── 三、updated_at 触发器 ─────────────────────────────────────────────

create or replace function public.touch_course_settings_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.touch_course_settings_updated_at() from public, anon, authenticated;

drop trigger if exists trg_course_goals_updated_at on public.course_goals;
create trigger trg_course_goals_updated_at
  before update on public.course_goals
  for each row execute function public.touch_course_settings_updated_at();

drop trigger if exists trg_course_tasks_updated_at on public.course_tasks;
create trigger trg_course_tasks_updated_at
  before update on public.course_tasks
  for each row execute function public.touch_course_settings_updated_at();

-- ── 四、权限：只给 API ───────────────────────────────────────────────

alter table public.course_goals     enable row level security;
alter table public.course_tasks     enable row level security;
alter table public.task_submissions enable row level security;

revoke all on public.course_goals, public.course_tasks, public.task_submissions from anon, authenticated;
grant select, insert, update, delete on public.course_goals, public.course_tasks, public.task_submissions to service_role;

-- ── 五、自检：不对就整个回滚 ──────────────────────────────────────────

do $$
declare
  v_bad   text;
  v_table text;
  v_priv  text;
begin
  -- 1) 客户端一项权限都没有（含列级授权）
  select string_agg(t, ', ') into v_bad
  from unnest(array['public.course_goals', 'public.course_tasks', 'public.task_submissions']) as t
  where has_any_column_privilege('anon', t, 'SELECT, INSERT, UPDATE, REFERENCES')
     or has_table_privilege('anon', t, 'DELETE, TRUNCATE, TRIGGER, MAINTAIN')
     or has_any_column_privilege('authenticated', t, 'SELECT, INSERT, UPDATE, REFERENCES')
     or has_table_privilege('authenticated', t, 'DELETE, TRUNCATE, TRIGGER, MAINTAIN');
  if v_bad is not null then
    raise exception '068: 客户端仍有权限：%', v_bad;
  end if;

  -- 2) API 用的 service_role 能读写
  foreach v_table in array array['public.course_goals', 'public.course_tasks', 'public.task_submissions'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', v_table, v_priv) then
        raise exception '068: service_role 缺 % 权限：%', v_priv, v_table;
      end if;
    end loop;
  end loop;

  -- 3) RLS 开着，一条策略都没有
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('course_goals', 'course_tasks', 'task_submissions')
    and not c.relrowsecurity;
  if v_bad is not null then
    raise exception '068: RLS 没开：%', v_bad;
  end if;

  select string_agg(tablename || '.' || policyname, ', ') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename in ('course_goals', 'course_tasks', 'task_submissions');
  if v_bad is not null then
    raise exception '068: 不该有策略：%', v_bad;
  end if;

  -- 4) 内联姓名要的外键：created_by / student_id 指 profiles，提交指任务
  if (select count(*) from pg_constraint
      where contype = 'f'
        and confrelid = 'public.profiles'::regclass
        and conrelid in ('public.course_goals'::regclass, 'public.course_tasks'::regclass,
                         'public.task_submissions'::regclass)) <> 3 then
    raise exception '068: created_by / student_id 的外键没有全部指向 profiles（表是不是早就存在、结构不同？）';
  end if;
  if not exists (select 1 from pg_constraint
                 where contype = 'f'
                   and conrelid = 'public.task_submissions'::regclass
                   and confrelid = 'public.course_tasks'::regclass) then
    raise exception '068: task_submissions.task_id 没有外键到 course_tasks，任务列表内联不了提交';
  end if;

  -- 5) 接口读写的列都在
  select string_agg(e.tbl || '.' || e.col, ', ') into v_bad
  from (values
    ('course_goals', 'id'), ('course_goals', 'course_id'), ('course_goals', 'title'),
    ('course_goals', 'description'), ('course_goals', 'priority'), ('course_goals', 'created_by'),
    ('course_goals', 'created_at'), ('course_goals', 'updated_at'),
    ('course_tasks', 'id'), ('course_tasks', 'course_id'), ('course_tasks', 'title'),
    ('course_tasks', 'description'), ('course_tasks', 'due_date'), ('course_tasks', 'points'),
    ('course_tasks', 'status'), ('course_tasks', 'created_by'), ('course_tasks', 'created_at'),
    ('course_tasks', 'updated_at'),
    ('task_submissions', 'id'), ('task_submissions', 'task_id'), ('task_submissions', 'student_id'),
    ('task_submissions', 'content'), ('task_submissions', 'file_url'), ('task_submissions', 'file_name'),
    ('task_submissions', 'drawing_data'), ('task_submissions', 'video_url'),
    ('task_submissions', 'submission_type'), ('task_submissions', 'status'),
    ('task_submissions', 'submitted_at'), ('task_submissions', 'graded_at'),
    ('task_submissions', 'feedback'), ('task_submissions', 'points_awarded')
  ) as e(tbl, col)
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = e.tbl and c.column_name = e.col);
  if v_bad is not null then
    raise exception '068: 缺列：%', v_bad;
  end if;
end
$$;

-- 让 PostgREST 立刻认得新表和外键关系，不等下一次自动重载
notify pgrst, 'reload schema';

-- ── 执行后核对 ───────────────────────────────────────────────────────
-- 1) 三张表都在，RLS 开着：
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace AND relname IN ('course_goals', 'course_tasks', 'task_submissions');
-- 2) 客户端没有任何授权（应为 0 行）：
-- SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
--   AND table_name IN ('course_goals', 'course_tasks', 'task_submissions');
-- 3) 回归（走 API）：课程创建者在「学习目标」加、改、删一条目标，改优先级后顺序跟着变；
--    「学习任务」发布一个带截止时间的任务，列表里显示的截止时间和填的一致（不差 8 小时）；
--    学生账号 GET /api/courses/<id>/goals、/tasks 能读，看不到草稿；另一门课的教师改不了。
--
-- ── 回滚（三张表都是新建的，回滚会连同已写入的目标、任务和提交一起删掉）──
-- DROP TABLE IF EXISTS public.task_submissions, public.course_tasks, public.course_goals;
-- DROP FUNCTION IF EXISTS public.touch_course_settings_updated_at();
-- NOTIFY pgrst, 'reload schema';
