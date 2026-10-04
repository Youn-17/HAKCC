-- 学生的平台使用反馈：他怎么看这个平台，写给开发团队。
--
-- 和 support_questions（学生求助）是两件事，所以分表：
--   求助是「我不会用，帮我解决」——AI 先答、答不了转教师，有工单流程；
--   反馈是「我怎么看这个平台」——没有流程，也不进课程。
--
-- 不进课程是关键。「这个平台对我的学习没什么帮助」这种话，
-- 当着任课教师的面是说不出口的，所以任课教师在这里没有任何权限，
-- 只有平台管理员读得到，界面上也向学生明说这一点。
create table if not exists public.platform_feedback (
  id uuid primary key default gen_random_uuid(),

  -- 指 profiles 而不是 auth.users：PostgREST 只沿暴露 schema 里的外键做内联，
  -- 指向 auth 的话管理端 select('*, profiles!user_id(...)') 会直接 400。
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- 写这条反馈时人在哪门课里。可为空 —— 反馈是对平台的，不是对课程的，
  -- 记下来只是为了知道他是在什么场景里产生这个想法的。
  course_id uuid references public.courses(id) on delete set null,

  -- 「不认同」单列一类，不是凑数：欢迎学生反对我们，就得给它一个明确的位置，
  -- 否则这类话会被塞进「建议」里说得很客气，我们也就看不到真实分歧。
  kind text not null default 'thought'
    check (kind in ('thought', 'suggestion', 'problem', 'disagree')),

  body text not null check (length(btrim(body)) > 0),

  -- 写反馈时的处境（路径、视口、前端版本等）。字段随平台演进加，所以用 jsonb。
  context jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_feedback_created_idx
  on public.platform_feedback (created_at desc);
create index if not exists platform_feedback_user_idx
  on public.platform_feedback (user_id, created_at desc);
create index if not exists platform_feedback_course_idx
  on public.platform_feedback (course_id, created_at desc);

alter table public.platform_feedback enable row level security;

-- 学生只看得到、只改得动自己写的那几条。
drop policy if exists platform_feedback_select_own on public.platform_feedback;
create policy platform_feedback_select_own on public.platform_feedback
  for select using (user_id = (select auth.uid()));

drop policy if exists platform_feedback_insert_own on public.platform_feedback;
create policy platform_feedback_insert_own on public.platform_feedback
  for insert with check (user_id = (select auth.uid()));

drop policy if exists platform_feedback_update_own on public.platform_feedback;
create policy platform_feedback_update_own on public.platform_feedback
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 写下的想法是学生自己的，他要撤回就该能撤回。
drop policy if exists platform_feedback_delete_own on public.platform_feedback;
create policy platform_feedback_delete_own on public.platform_feedback
  for delete using (user_id = (select auth.uid()));

-- 平台管理员读全部。故意只给 select：反馈是学生说的话，我们没有理由改它。
drop policy if exists platform_feedback_select_admin on public.platform_feedback;
create policy platform_feedback_select_admin on public.platform_feedback
  for select using (public.is_admin());

comment on table public.platform_feedback is
  '学生对平台本身的反馈与使用想法。任课教师无权限，只有平台管理员可读。';
comment on column public.platform_feedback.course_id is
  '写反馈时所在的课程，可为空。反馈针对平台而非课程，此列只用于还原场景。';
comment on column public.platform_feedback.kind is
  'thought 使用感受 / suggestion 改进建议 / problem 遇到的问题 / disagree 不认同的地方。';
