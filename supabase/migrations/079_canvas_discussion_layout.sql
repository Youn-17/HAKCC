-- Keep students near the current discussion rather than extending a blocked vertical column.
-- No existing Note is moved. The space lock is retained by position_new_canvas_note.
create or replace function public.canvas_nearby_position(p_x numeric,p_y numeric,p_w numeric,p_h numeric,p_obstacles jsonb,p_right_only boolean)
returns table(x numeric,y numeric) language plpgsql immutable set search_path=public as $$
declare candidate record;
begin
  for candidate in
    select p_x+col*(p_w+96) as x,p_y+row_offset*(p_h+48) as y
      from generate_series(case when p_right_only then 0 else -8 end,8) col
      cross join generate_series(-3,3) row_offset
      order by (col*(p_w+96))^2+(row_offset*(p_h+48))^2,abs(row_offset),col desc,row_offset
  loop
    if not exists(select 1 from jsonb_array_elements(p_obstacles) o
      where candidate.x<(o->>'x')::numeric+(o->>'w')::numeric+48 and candidate.x+p_w+48>(o->>'x')::numeric
        and candidate.y<(o->>'y')::numeric+(o->>'h')::numeric+48 and candidate.y+p_h+48>(o->>'y')::numeric)
    then x:=candidate.x;y:=candidate.y;return next;return;end if;
  end loop;
  select greatest(p_x,coalesce(max((o->>'x')::numeric+(o->>'w')::numeric+96),p_x)) into x from jsonb_array_elements(p_obstacles) o;
  y:=p_y;return next;
end;
$$;

create or replace function public.position_new_canvas_note()
returns trigger language plpgsql security definer set search_path=public as $$
declare nx numeric:=64; ny numeric:=64; nw numeric; nh numeric; obstacle record; anchor record;
        hint text; scope_views text[]; parent_ids uuid[]; obstacles jsonb; right_only boolean:=false; candidate record;
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
  if anchor.ax is not null then nx:=anchor.ax;ny:=anchor.ay;right_only:=true;
  elsif coalesce(new.metadata->'canvas_layout'->>'topic','')<>'' then
    select n.x+s.w+96 as ax,n.y as ay into anchor
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
  -- Read geometry once, then compare nearby candidates on both axes.
  select coalesce(jsonb_agg(jsonb_build_object('x',n.x,'y',n.y,'w',s.w,'h',s.h)),'[]') into obstacles
    from public.notes n
    cross join lateral public.canvas_note_size(n.type::text,n.width,n.height,coalesce(n.metadata,'{}')||jsonb_build_object('display_mode',coalesce(n.metadata->>'display_mode',case when coalesce(n.mime_type,'') ~ '^(image|video)/' and n.file_url is not null then 'media' else 'card' end))) s
    where n.space_id=new.space_id and n.deleted_at is null and n.type<>'view'
      and public.canvas_views_match(n.views,scope_views,new.space_id);
  select p.x,p.y into candidate from public.canvas_nearby_position(nx,ny,nw,nh,obstacles,right_only) p;
  nx:=candidate.x;ny:=candidate.y;
  new.x:=nx;new.y:=ny;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)-'canvas_parent_id';
  return new;
end;
$$;
-- Rollback: restore position_new_canvas_note from 078_canvas_layout.sql,
-- then drop function public.canvas_nearby_position(numeric,numeric,numeric,numeric,jsonb,boolean).
