-- Explicit teacher-defined topics for the discussion-analysis page.
-- Server API authorizes course staff before reading or updating this table.
create table if not exists public.space_analytics_topics (
  space_id uuid primary key references public.spaces(id) on delete cascade,
  topics jsonb not null default '[]'::jsonb,
  revision uuid not null default gen_random_uuid(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint space_analytics_topics_array check (jsonb_typeof(topics) = 'array' and jsonb_array_length(topics) <= 12)
);
alter table public.space_analytics_topics enable row level security;
revoke all on public.space_analytics_topics from anon, authenticated;
grant select, insert, update, delete on public.space_analytics_topics to service_role;
comment on table public.space_analytics_topics is 'Teacher-defined discussion keywords; text mentions are not mastery scores. Access only through staff-authorized API.';
