
create table if not exists public.kb_retrieval_logs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  course_id      uuid not null references public.courses(id) on delete cascade,
  user_id        uuid,
  -- note_ai：笔记里问 AI；agent_tool：智能体调 search_course_materials
  source         text not null,
  query          text not null,
  -- 拿到查询向量没有（false 就是只按关键词查的）
  semantic       boolean not null,
  -- 重排跑成没有（false 时按向量的顺序给，没卡门槛）
  reranked       boolean not null,
  candidates     integer not null,
  returned       integer not null,
  -- 重排后的前 10 段和它们的相关度（没重排成时分数为空，id 按向量的顺序）
  ranked_ids     uuid[] not null default '{}',
  ranked_scores  real[] not null default '{}',
  embed_ms       integer,
  rerank_ms      integer,
  total_ms       integer,
  constraint kb_retrieval_logs_source_chk check (source in ('note_ai', 'agent_tool'))
);

create index if not exists idx_kb_retrieval_logs_course_time on public.kb_retrieval_logs (course_id, created_at desc);

alter table public.kb_retrieval_logs enable row level security;
revoke all on table public.kb_retrieval_logs from anon, authenticated;

notify pgrst, 'reload schema';
