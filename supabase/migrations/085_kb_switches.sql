
alter table public.course_materials
  add column if not exists kb_enabled boolean not null default true;

comment on column public.course_materials.kb_enabled is
  '这份资料进不进 AI 检索。关掉只是检索不到，文件、片段、向量都留着';

alter table public.courses
  add column if not exists kb_include_attachments boolean not null default true;

comment on column public.courses.kb_include_attachments is
  '知识空间里上传的附件进不进这门课的 AI 检索（整门课一个开关）';

alter table public.kb_retrieval_logs drop constraint if exists kb_retrieval_logs_source_chk;
alter table public.kb_retrieval_logs
  add constraint kb_retrieval_logs_source_chk check (source in ('note_ai', 'workspace_ai', 'agent_tool'));

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
  space_id uuid, material_id uuid, note_id uuid,
  page_start integer, page_end integer
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c.id, c.document_id, d.title, c.heading_path, c.content,
         1 - (v.embedding <=> p_query_embedding),
         d.space_id, d.material_id, d.note_id,
         c.page_start, c.page_end
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
    -- 085：关掉的课程资料、整门课关掉的画布附件不给
    and (d.material_id is null
         or exists (select 1 from public.course_materials m where m.id = d.material_id and m.kb_enabled))
    and (d.space_id is null
         or exists (select 1 from public.courses co where co.id = p_course_id and co.kb_include_attachments))
  order by v.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 50));
$$;

revoke execute on function public.match_kb_chunk_vectors(uuid, text, extensions.halfvec, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.match_kb_chunk_vectors(uuid, text, extensions.halfvec, integer, uuid[]) to service_role;

create or replace function public.match_kb_chunks_keyword(
  p_course_id uuid,
  p_terms text[],
  p_match_count int default 6,
  p_space_ids uuid[] default null
)
returns table (
  chunk_id uuid, document_id uuid, title text,
  heading_path text, content text, score float, matched_terms integer,
  space_id uuid, material_id uuid, note_id uuid,
  page_start integer, page_end integer
)
language sql stable security invoker
set search_path = public
as $$
  with scope as (
    select c.id, c.document_id, c.heading_path, c.content, c.search_text,
           greatest(coalesce(c.search_len, 0), 1) as len,
           d.title, d.space_id, d.material_id, d.note_id,
           c.page_start, c.page_end
    from public.kb_chunks c
    join public.kb_documents d on d.id = c.document_id
    where c.course_id = p_course_id
      and c.search_text is not null
      and ((d.space_id is null and d.material_id is not null)
           or d.space_id = any(p_space_ids))
      and (d.note_id is null
           or exists (select 1 from public.notes n where n.id = d.note_id and n.deleted_at is null))
      -- 085：关掉的课程资料、整门课关掉的画布附件不给
      and (d.material_id is null
           or exists (select 1 from public.course_materials m where m.id = d.material_id and m.kb_enabled))
      and (d.space_id is null
           or exists (select 1 from public.courses co where co.id = p_course_id and co.kb_include_attachments))
  ),
  stats as (
    select count(*)::float as n, greatest(avg(len), 1)::float as avgdl from scope
  ),
  hits as (
    select s.id, w.tok as term, count(*)::float as tf
    from scope s
    cross join lateral unnest(string_to_array(s.search_text, ' ')) as w(tok)
    where w.tok = any(p_terms)
    group by s.id, w.tok
  ),
  df as (
    select term, count(*)::float as df from hits group by term
  ),
  scored as (
    select h.id,
           sum(ln(1 + (st.n - df.df + 0.5) / (df.df + 0.5)) * h.tf * 2.2
               / (h.tf + 1.2 * (0.25 + 0.75 * s.len / st.avgdl))) as score,
           count(*)::integer as matched_terms
    from hits h
    join df on df.term = h.term
    join scope s on s.id = h.id
    cross join stats st
    group by h.id
  )
  select s.id, s.document_id, s.title, s.heading_path, s.content, sc.score, sc.matched_terms,
         s.space_id, s.material_id, s.note_id,
         s.page_start, s.page_end
  from scored sc
  join scope s on s.id = sc.id
  order by sc.score desc, s.id
  limit greatest(1, least(p_match_count, 50));
$$;

revoke execute on function public.match_kb_chunks_keyword(uuid, text[], integer, uuid[]) from public, anon, authenticated;
grant execute on function public.match_kb_chunks_keyword(uuid, text[], integer, uuid[]) to service_role;

-- 这门课现在有没有 AI 检索得到的片段：开着的课程资料，或者（附件开关开着时）没删的附件。不看提问的人进得去哪些空间
create or replace function public.kb_course_searchable(p_course_id uuid)
returns boolean
language sql stable security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.kb_chunks c
    join public.kb_documents d on d.id = c.document_id
    where c.course_id = p_course_id
      and (
        (d.material_id is not null
         and exists (select 1 from public.course_materials m where m.id = d.material_id and m.kb_enabled))
        or (d.note_id is not null
            and exists (select 1 from public.notes n where n.id = d.note_id and n.deleted_at is null)
            and exists (select 1 from public.courses co where co.id = p_course_id and co.kb_include_attachments))
      )
  );
$$;

revoke execute on function public.kb_course_searchable(uuid) from public, anon, authenticated;
grant execute on function public.kb_course_searchable(uuid) to service_role;

notify pgrst, 'reload schema';
