
alter table public.kb_chunks
  add column if not exists page_start integer,
  add column if not exists page_end integer;

alter table public.document_renders add column if not exists page_map jsonb;
alter table public.course_materials add column if not exists page_map jsonb;

drop function if exists public.match_kb_chunk_vectors(uuid, text, extensions.halfvec, integer, uuid[]);

create function public.match_kb_chunk_vectors(
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
  order by v.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 50));
$$;

revoke execute on function public.match_kb_chunk_vectors(uuid, text, extensions.halfvec, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.match_kb_chunk_vectors(uuid, text, extensions.halfvec, integer, uuid[]) to service_role;

drop function if exists public.match_kb_chunks_keyword(uuid, text[], integer, uuid[]);

create function public.match_kb_chunks_keyword(
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

notify pgrst, 'reload schema';
