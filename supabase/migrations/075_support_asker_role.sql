-- Distinguish student and teacher help routing.

alter table public.support_questions
  add column if not exists asker_role text not null default 'student';

alter table public.support_questions
  drop constraint if exists support_questions_asker_role_check;
alter table public.support_questions
  add constraint support_questions_asker_role_check check (asker_role in ('student', 'teacher'));

-- 小球的收件箱按「谁问的 + 等回复」查
create index if not exists support_questions_asker_status_idx
  on public.support_questions (asker_role, status, escalated_at);

comment on column public.support_questions.asker_role is
  '谁问的：student 转课程老师；teacher（教师、管理员账号）转平台管理员。';
