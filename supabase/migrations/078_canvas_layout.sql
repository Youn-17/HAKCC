-- Shared geometry only. No Note content, ownership or Build-on relationship is changed.
create or replace function public.canvas_note_size(p_type text, p_width numeric, p_height numeric, p_metadata jsonb)
returns table(w numeric,h numeric) language sql immutable set search_path=public as $$
  select case when p_type in ('attachment','video') and coalesce(p_metadata->>'display_mode','card') <> 'media' then 240 else greatest(140,coalesce(p_width,case when p_type in ('attachment','video') then 320 when p_type='riseabove' then 232 else 200 end)) end,
         case when p_type in ('attachment','video') and coalesce(p_metadata->>'display_mode','card') <> 'media' then 76 else greatest(102,coalesce(p_height,case when p_type in ('attachment','video') then 240 when p_type='drawing' then 200 when p_type='riseabove' then 132 else 140 end)) end;
$$;

create or replace function public.canvas_views_match(p_views text[],p_scope text[],p_space uuid)
returns boolean language sql stable set search_path=public as $$
  select coalesce(p_views,'{}') && coalesce(p_scope,'{}') or
    ((cardinality(coalesce(p_scope,'{}'))=0 or 'view-welcome'=any(p_scope)) and
     not exists(select 1 from public.views v where v.space_id=p_space and v.id::text=any(coalesce(p_views,'{}'))));
$$;

-- Every insert path (including AI publication and Rise-above) shares the same allocation lock.
create or replace function public.position_new_canvas_note()
returns trigger language plpgsql security definer set search_path=public as $$
declare nx numeric:=64; ny numeric:=64; nw numeric; nh numeric; obstacle record; anchor record;
        hint text; scope_views text[]; parent_ids uuid[];
begin
  if new.type='view' then return new; end if;
  perform 1 from public.spaces where id=new.space_id for update;
  select w,h into nw,nh from public.canvas_note_size(new.type::text,new.width,new.height,coalesce(new.metadata,'{}')||jsonb_build_object('display_mode',coalesce(new.metadata->>'display_mode',case when coalesce(new.mime_type,'') ~ '^(image|video)/' and new.file_url is not null then 'media' else 'card' end)));
  scope_views:=coalesce(new.views,'{}');
  hint:=new.metadata->>'canvas_parent_id';
  parent_ids:=coalesce(new.cited_note_ids,'{}');
  if hint ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then parent_ids:=array_append(parent_ids,hint::uuid); end if;
  select max(n.x+s.w)+96 as ax,avg(n.y) as ay into anchor
    from public.notes n cross join lateral public.canvas_note_size(n.type::text,n.width,n.height,coalesce(n.metadata,'{}')||jsonb_build_object('display_mode',coalesce(n.metadata->>'display_mode',case when coalesce(n.mime_type,'') ~ '^(image|video)/' and n.file_url is not null then 'media' else 'card' end))) s
    where n.space_id=new.space_id and n.deleted_at is null and n.id=any(parent_ids)
      and public.canvas_views_match(n.views,scope_views,new.space_id);
  if anchor.ax is not null then nx:=anchor.ax;ny:=anchor.ay;
  elsif coalesce(new.metadata->'canvas_layout'->>'topic','')<>'' then
    select n.x as ax,n.y+s.h+48 as ay into anchor
      from public.notes n cross join lateral public.canvas_note_size(n.type::text,n.width,n.height,coalesce(n.metadata,'{}')||jsonb_build_object('display_mode',coalesce(n.metadata->>'display_mode',case when coalesce(n.mime_type,'') ~ '^(image|video)/' and n.file_url is not null then 'media' else 'card' end))) s
      where n.space_id=new.space_id and n.deleted_at is null and n.type<>'view'
        and (n.metadata->'canvas_layout'->>'topic'=new.metadata->'canvas_layout'->>'topic' or n.id::text=new.metadata->'canvas_layout'->>'topic')
        and public.canvas_views_match(n.views,scope_views,new.space_id)
      order by n.created_at,n.id limit 1;
    if found then nx:=anchor.ax;ny:=anchor.ay; end if;
  end if;
  -- Preserve the requested region for independent roots when no semantic anchor is available.
  if anchor.ax is null then
    for obstacle in select n.id from public.notes n where n.space_id=new.space_id and n.deleted_at is null and n.type<>'view'
      and public.canvas_views_match(n.views,scope_views,new.space_id) limit 1 loop
      nx:=coalesce(new.x,64);ny:=coalesce(new.y,64);
    end loop;
  end if;
  -- Moving downward is stable, keeps successors on the right, and guarantees an empty slot.
  for obstacle in select n.x,n.y,s.w,s.h from public.notes n
    cross join lateral public.canvas_note_size(n.type::text,n.width,n.height,coalesce(n.metadata,'{}')||jsonb_build_object('display_mode',coalesce(n.metadata->>'display_mode',case when coalesce(n.mime_type,'') ~ '^(image|video)/' and n.file_url is not null then 'media' else 'card' end))) s
    where n.space_id=new.space_id and n.deleted_at is null and n.type<>'view'
      and public.canvas_views_match(n.views,scope_views,new.space_id)
    order by n.y,n.id
  loop
    if nx<obstacle.x+obstacle.w+48 and nx+nw+48>obstacle.x and ny<obstacle.y+obstacle.h+48 and ny+nh+48>obstacle.y then ny:=obstacle.y+obstacle.h+48; end if;
  end loop;
  new.x:=nx;new.y:=ny;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)-'canvas_parent_id';
  return new;
end;
$$;
drop trigger if exists position_new_canvas_note on public.notes;
create trigger position_new_canvas_note before insert on public.notes for each row execute function public.position_new_canvas_note();

create or replace function public.lock_canvas_relation_space()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then perform 1 from public.spaces where id=old.space_id for update; return old; end if;
  perform 1 from public.spaces where id=new.space_id for update;
  return new;
end;
$$;
drop trigger if exists lock_canvas_relation_space on public.relations;
create trigger lock_canvas_relation_space before insert or delete on public.relations for each row execute function public.lock_canvas_relation_space();

-- Teacher preview/apply and undo are atomic. A stale snapshot aborts every move.
create or replace function public.apply_canvas_layout(p_space uuid,p_expected jsonb,p_relations jsonb,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_relations jsonb; changed jsonb; expected_count integer;
begin
  if jsonb_typeof(p_expected)<>'array' or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_expected)>2000 then raise exception 'Invalid layout' using errcode='22023'; end if;
  perform 1 from public.spaces where id=p_space for update;
  perform 1 from public.notes where space_id=p_space and deleted_at is null order by id for update;
  select count(*) into expected_count from public.notes where space_id=p_space and deleted_at is null;
  if expected_count<>jsonb_array_length(p_expected) or
    (select count(distinct value->>'id') from jsonb_array_elements(p_expected))<>expected_count or
    exists(select 1 from jsonb_array_elements(p_expected) e left join public.notes n on n.id=(e->>'id')::uuid and n.space_id=p_space and n.deleted_at is null
      where n.id is null or n.x is distinct from (e->>'x')::numeric or n.y is distinct from (e->>'y')::numeric
        or n.width is distinct from (e->>'width')::numeric or n.height is distinct from (e->>'height')::numeric
        or n.updated_at is distinct from (e->>'updatedAt')::timestamptz or to_jsonb(coalesce(n.views,'{}')) is distinct from e->'views'
        or coalesce(n.metadata->>'is_fixed','false') is distinct from e->>'fixed')
  then raise exception 'Canvas changed; refresh preview' using errcode='40001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source_note_id,'target',target_note_id) order by id),'[]') into current_relations from public.relations where space_id=p_space;
  if current_relations is distinct from p_relations then raise exception 'Relations changed; refresh preview' using errcode='40001'; end if;
  if exists(select 1 from jsonb_array_elements(p_changes) c left join public.notes n on n.id=(c->>'id')::uuid and n.space_id=p_space
    where n.id is null or n.deleted_at is not null or n.type='view' or n.metadata->>'is_fixed'='true'
      or c->>'x' is null or c->>'y' is null or abs((c->>'x')::numeric)>10000000 or abs((c->>'y')::numeric)>10000000)
  then raise exception 'Invalid layout change' using errcode='22023'; end if;
  with moved as (update public.notes n set x=(c->>'x')::numeric,y=(c->>'y')::numeric
    from jsonb_array_elements(p_changes) c where n.id=(c->>'id')::uuid and n.space_id=p_space
    returning n.id,n.x,n.y,n.updated_at)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'x',x,'y',y,'updatedAt',updated_at)),'[]') into changed from moved;
  return changed;
end;
$$;
revoke all on function public.apply_canvas_layout(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_canvas_layout(uuid,jsonb,jsonb,jsonb) to service_role;
-- Rollback: drop trigger position_new_canvas_note on public.notes;
-- drop trigger lock_canvas_relation_space on public.relations;
-- drop function public.position_new_canvas_note(); drop function public.lock_canvas_relation_space();
-- drop function public.apply_canvas_layout(uuid,jsonb,jsonb,jsonb);
-- drop function public.canvas_views_match(text[],text[],uuid);
-- drop function public.canvas_note_size(text,numeric,numeric,jsonb);
