-- Server-side topic summary cache with source Note references.

create table if not exists public.view_topic_summaries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  -- 视图 id；主画布是固定的 'view-welcome'，不是 uuid
  view_id text not null,
  -- 这个视图里笔记的签名（id + 更新时间），变了才重新生成
  signature text not null,
  -- [{ label, noteIds, count }]
  topics jsonb not null default '[]'::jsonb,
  note_count integer not null default 0,
  provider_id text,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists view_topic_summaries_lookup_idx
  on public.view_topic_summaries (space_id, view_id, created_at desc);

alter table public.view_topic_summaries enable row level security;
revoke all on public.view_topic_summaries from anon, authenticated;

comment on table public.view_topic_summaries is
  '画布问题栏后面滚动的讨论主题：每次生成一行（缓存 + 主题来源可追溯）。只有服务端读写。';
