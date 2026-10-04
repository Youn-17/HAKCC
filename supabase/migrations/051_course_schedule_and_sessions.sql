-- 课程的教学安排，以及按安排预生成的课次表。
--
-- 为什么预生成整学期的课次，而不是"上了才记一条"：
-- 「计划 16 次、实际上了 14 次」这个数，只有在没上的那两次也存在时才算得出来。
-- 事后补记也依赖它 —— 教师隔几天登录，看到的是一份待确认清单，而不是空白。

alter table public.courses
  add column if not exists course_type   text,
  add column if not exists credit_hours  integer,
  add column if not exists total_weeks   integer,
  add column if not exists start_date    date,
  add column if not exists timezone      text not null default 'Asia/Shanghai',
  -- [{weekday:1..7, start:"14:00", minutes:90}]，支持一周多个时段
  add column if not exists schedule      jsonb not null default '[]'::jsonb;

alter table public.courses
  drop constraint if exists courses_course_type_chk;
alter table public.courses
  add constraint courses_course_type_chk
  check (course_type is null or course_type in ('general', 'major', 'required', 'elective'));

comment on column public.courses.course_type is '通识 general / 专业 major / 必修 required / 选修 elective';
comment on column public.courses.schedule is '每周上课时段：[{weekday:1-7, start:"HH:MM", minutes:int}]。周一=1。';
comment on column public.courses.timezone is '课程所在时区。跨时区课程（如英文课）不带时区会把上课时间算错。';

create table if not exists public.course_sessions (
  id                uuid primary key default gen_random_uuid(),
  course_id         uuid not null references public.courses(id) on delete cascade,
  session_no        integer not null,
  week_no           integer not null,
  planned_date      date not null,
  planned_start     time not null,
  planned_minutes   integer not null default 90,
  -- 按课程时区换算出的绝对时刻。判断"这次课是不是已经过了"要用它，
  -- 用本地日期加时间去比会在跨时区时错一整天。
  planned_at        timestamptz not null,

  -- planned=尚未确认 held=上了 cancelled=没上 rescheduled=调到别的时间
  -- 调课必须和缺课分开：合并成"没上"会让研究数据把正常调课记成缺勤。
  status            text not null default 'planned',
  actual_date       date,
  actual_start      time,
  actual_minutes    integer,
  moved_to_date     date,
  moved_to_start    time,
  cancel_reason     text,
  note              text,

  confirmed_by      uuid,
  confirmed_at      timestamptz,

  -- 确认时对当次课堂活动做的快照。系统统计，不经 AI。
  metrics           jsonb not null default '{}'::jsonb,
  -- AI 概述与事实分开存：审稿人问"参与人数怎么来的"，答案必须是"数据库统计"。
  ai_summary        text,
  ai_summary_at     timestamptz,
  ai_summary_edited boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint course_sessions_status_chk
    check (status in ('planned', 'held', 'cancelled', 'rescheduled')),
  constraint course_sessions_unique_no unique (course_id, session_no)
);

create index if not exists idx_course_sessions_course on public.course_sessions (course_id, planned_at);
create index if not exists idx_course_sessions_pending on public.course_sessions (course_id, status, planned_at);

comment on table public.course_sessions is
  '按课程安排预生成的课次。status=planned 表示时间到了但教师还没确认。';

alter table public.course_sessions enable row level security;

-- 学生也能看（知道这门课上到第几周），但只有教师能改
drop policy if exists course_sessions_select on public.course_sessions;
create policy course_sessions_select on public.course_sessions
  for select using (is_course_member(course_id));
