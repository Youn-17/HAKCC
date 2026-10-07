
-- 外键要引用 (id, course_id)，先给 kb_chunks 加上这一对的唯一约束（id 本身是主键，不会冲突）
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kb_chunks_id_course_key') then
    alter table public.kb_chunks add constraint kb_chunks_id_course_key unique (id, course_id);
  end if;
end $$;

create table if not exists public.kb_chunk_vectors (
  chunk_id   uuid not null,
  course_id  uuid not null,
  -- 「模型名@维度」，例如 qwen3.7-text-embedding@2048
  model      text not null,
  embedding  extensions.halfvec not null,
  created_at timestamptz not null default now(),
  primary key (chunk_id, model),
  constraint kb_chunk_vectors_chunk_fk foreign key (chunk_id, course_id)
    references public.kb_chunks (id, course_id) on delete cascade
);

create index if not exists idx_kb_chunk_vectors_course_model on public.kb_chunk_vectors (course_id, model);

alter table public.kb_chunk_vectors enable row level security;
revoke all on table public.kb_chunk_vectors from anon, authenticated;

-- 检索。范围规则和 067 的 match_kb_chunks 一样，都写在 ORDER BY … LIMIT 之前：
-- 课程硬过滤；课程资料（不属于任何空间）全课可见，附件的空间要在 p_space_ids 里；来源笔记删了的不给。
-- 只在同一个模型的向量里比。
create or replace function public.match_kb_chunk_vectors(
  p_course_id uuid,
  p_model text,
  p_query_embedding extensions.halfvec,
  p_match_count int default 6,
  p_space_ids uuid[] default null
)
returns table (
  chunk_id uuid, document_id uuid, title text,
  heading_path text, content text, similarity float,
  space_id uuid, material_id uuid
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c.id, c.document_id, d.title, c.heading_path, c.content,
         1 - (v.embedding <=> p_query_embedding),
         d.space_id, d.material_id
  from public.kb_chunk_vectors v
  join public.kb_chunks c on c.id = v.chunk_id
  join public.kb_documents d on d.id = c.document_id
  where v.course_id = p_course_id
    and v.model = p_model
    and c.course_id = p_course_id
    and ((d.space_id is null and d.material_id is not null)
         or d.space_id = any(p_space_ids))
    and (d.note_id is null
         or exists (select 1 from public.notes n where n.id = d.note_id and n.deleted_at is null))
  order by v.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 50));
$$;

revoke execute on function public.match_kb_chunk_vectors(uuid, text, extensions.halfvec, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.match_kb_chunk_vectors(uuid, text, extensions.halfvec, integer, uuid[]) to service_role;

-- 后台补向量的待办：还没有这个模型向量的片段，按入库先后取。
-- p_exclude 是后端暂时跳过的片段（单片内容被接口拒了，隔几小时再试），免得它们一直占着队头。
-- 来源笔记删掉的不算：那份很快会被清掉，不值得花钱算。
create or replace function public.kb_chunks_missing_vectors(
  p_model text,
  p_limit int default 16,
  p_exclude uuid[] default null
)
returns table (chunk_id uuid, course_id uuid, heading_path text, content text)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c.id, c.course_id, c.heading_path, c.content
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where not exists (select 1 from public.kb_chunk_vectors v where v.chunk_id = c.id and v.model = p_model)
    and (p_exclude is null or c.id <> all(p_exclude))
    and (d.note_id is null
         or exists (select 1 from public.notes n where n.id = d.note_id and n.deleted_at is null))
  order by c.created_at, c.id
  limit greatest(1, least(p_limit, 64));
$$;

revoke execute on function public.kb_chunks_missing_vectors(text, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.kb_chunks_missing_vectors(text, integer, uuid[]) to service_role;

-- 每份文档切了多少片、其中多少片有这个模型的向量（资料列表和知识库概况用）。
-- 在库里数：把片段一行行拉回来再数，会受接口单次返回行数的上限影响。
create or replace function public.kb_document_vector_counts(p_course_id uuid, p_model text)
returns table (document_id uuid, chunks bigint, embedded bigint)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c.document_id, count(*), count(v.chunk_id)
  from public.kb_chunks c
  left join public.kb_chunk_vectors v on v.chunk_id = c.id and v.model = p_model
  where c.course_id = p_course_id
  group by c.document_id;
$$;

revoke execute on function public.kb_document_vector_counts(uuid, text) from public, anon, authenticated;
grant execute on function public.kb_document_vector_counts(uuid, text) to service_role;

notify pgrst, 'reload schema';
