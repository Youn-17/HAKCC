-- 学生求助：平台使用问题的问答记录。
--
-- 三个用途，决定了字段为什么这么细：
--   1. 当下解决问题——AI 先答，答不了转教师；
--   2. 教师看得见学生卡在哪，这是教学信号，不是客服工单；
--   3. 攒成语料库：给平台改进用，也给下一届学生当现成答案。
--
-- 第 3 条要求记下「问题发生在什么处境里」。只存一句「保存不了」，
-- 下一届看到也没法复用；得知道他当时在哪个页面、开着什么面板、
-- 屏幕多宽、有没有报错。所以有 context 这个 jsonb。

create table if not exists public.support_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  -- 指 profiles 而不是 auth.users：PostgREST 只沿暴露 schema 里的外键做内联，
  -- 指向 auth 的话教师端 select('*, profiles!user_id(...)') 会直接 400。
  user_id uuid not null references public.profiles(id) on delete cascade,

  question text not null,

  -- AI 先答那一轮
  ai_answer text,
  ai_provider text,
  ai_model text,
  ai_answered_at timestamptz,

  -- 学生的判断：AI 答完解决了没有。这一列是语料质量的关键，
  -- 没有它就分不清「AI 答对了」和「AI 答了但没用」。
  ai_resolved boolean,

  -- 转教师之后
  escalated_at timestamptz,
  escalation_note text,
  teacher_id uuid references public.profiles(id) on delete set null,
  teacher_answer text,
  teacher_answered_at timestamptz,

  status text not null default 'ai_answered'
    check (status in ('ai_answered', 'escalated', 'teacher_answered', 'resolved')),

  -- 提问时的处境。字段不固定，随平台演进加，所以用 jsonb。
  -- 目前收：路径、当前工具/面板、空间与笔记 id、视口、UA、语言、
  -- 前端版本、最近一次报错。
  context jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_questions_course_created_idx
  on public.support_questions (course_id, created_at desc);
create index if not exists support_questions_user_idx
  on public.support_questions (user_id, created_at desc);
create index if not exists support_questions_status_idx
  on public.support_questions (course_id, status);

alter table public.support_questions enable row level security;

-- 学生只看得到自己的求助。别人问了什么不该互相可见——
-- 「我不会用」这种话在同学面前是有成本的，看得见会让人不敢问。
drop policy if exists support_questions_select_own on public.support_questions;
create policy support_questions_select_own on public.support_questions
  for select using (user_id = (select auth.uid()));

drop policy if exists support_questions_insert_own on public.support_questions;
create policy support_questions_insert_own on public.support_questions
  for insert with check (
    user_id = (select auth.uid())
    and public.is_course_member(course_id)
  );

-- 学生只能改自己那条，而且只在「还没转给教师」时改
-- （标记已解决 / 补充说明 / 转教师）。
drop policy if exists support_questions_update_own on public.support_questions;
create policy support_questions_update_own on public.support_questions
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 授课教师看得到本课程全部求助，并可作答。
drop policy if exists support_questions_select_instructor on public.support_questions;
create policy support_questions_select_instructor on public.support_questions
  for select using (public.is_course_instructor(course_id));

drop policy if exists support_questions_update_instructor on public.support_questions;
create policy support_questions_update_instructor on public.support_questions
  for update using (public.is_course_instructor(course_id))
  with check (public.is_course_instructor(course_id));

comment on table public.support_questions is
  '学生的平台使用求助：AI 先答、可转教师。同时是平台改进与下一届学生的语料库。';
comment on column public.support_questions.context is
  '提问时的处境（路径、面板、视口、UA、报错等）。只存问题文本的话，下一届无法复用。';
comment on column public.support_questions.ai_resolved is
  '学生自己判断 AI 有没有解决。区分「答对了」与「答了但没用」，是语料质量的关键。';
