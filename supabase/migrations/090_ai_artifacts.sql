-- 智能体做的网页（2026-10-11 用户：智能体要能规划、能问学生选哪个方案、能生成一个可以打开看的 HTML）。
-- 笔记 AI 助手和知识空间智能体共用（agentMaker.ts）。同一个网页每改一次存一行新版本：group_id 相同、version 递增。
-- 只经后端接口读写：本人和本课教职能看（routes/artifacts.ts），客户端不能直接读这张表。
create table if not exists public.ai_artifacts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  version integer not null default 1 check (version >= 1),
  course_id uuid not null references public.courses(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  surface text not null check (surface in ('note', 'workspace', 'personal')),
  conversation_id uuid,
  note_id uuid,
  kind text not null default 'html' check (kind in ('html')),
  title text not null check (char_length(title) between 1 and 120),
  brief text,
  html text not null check (char_length(html) <= 600000),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  provider_id text,
  model text,
  created_at timestamptz not null default now(),
  unique (group_id, version)
);
create index if not exists ai_artifacts_owner_idx on public.ai_artifacts (owner_id, created_at desc);
create index if not exists ai_artifacts_course_idx on public.ai_artifacts (course_id, created_at desc);
alter table public.ai_artifacts enable row level security;
revoke all on public.ai_artifacts from anon, authenticated;
grant select, insert, update, delete on public.ai_artifacts to service_role;
comment on table public.ai_artifacts is 'HTML pages built by the note AI partner and the knowledge space agent. One row per version. Access only through the owner/staff-authorized API.';
