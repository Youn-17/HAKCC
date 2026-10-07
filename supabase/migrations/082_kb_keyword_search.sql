
alter table public.kb_chunks
  add column if not exists search_text text,
  add column if not exists search_len integer;

-- 批量写回 search_text。PostgREST 的 upsert 会带上插入时的必填列检查，只更新这两列得按 id update
create or replace function public.kb_set_search_text(p_rows jsonb)
returns integer
language sql volatile security invoker
set search_path = public
as $$
  with r as (
    select * from jsonb_to_recordset(p_rows) as x(id uuid, search_text text, search_len integer)
  ), u as (
    update public.kb_chunks c
       set search_text = r.search_text, search_len = r.search_len
      from r
     where c.id = r.id
    returning 1
  )
  select count(*)::integer from u;
$$;

revoke execute on function public.kb_set_search_text(jsonb) from public, anon, authenticated;
grant execute on function public.kb_set_search_text(jsonb) to service_role;

create or replace function public.match_kb_chunks_keyword(
  p_course_id uuid,
  p_terms text[],
  p_match_count int default 6,
  p_space_ids uuid[] default null
)
returns table (
  chunk_id uuid, document_id uuid, title text,
  heading_path text, content text, score float, matched_terms integer,
  space_id uuid, material_id uuid
)
language sql stable security invoker
set search_path = public
as $$
  with scope as (
    select c.id, c.document_id, c.heading_path, c.content, c.search_text,
           greatest(coalesce(c.search_len, 0), 1) as len,
           d.title, d.space_id, d.material_id
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
         s.space_id, s.material_id
  from scored sc
  join scope s on s.id = sc.id
  order by sc.score desc, s.id
  limit greatest(1, least(p_match_count, 50));
$$;

revoke execute on function public.match_kb_chunks_keyword(uuid, text[], integer, uuid[]) from public, anon, authenticated;
grant execute on function public.match_kb_chunks_keyword(uuid, text[], integer, uuid[]) to service_role;

notify pgrst, 'reload schema';
