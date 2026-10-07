-- Withdraw the canvas organization feature without changing Notes or relationships.
drop trigger if exists position_new_canvas_note on public.notes;
drop trigger if exists lock_canvas_relation_space on public.relations;
drop function if exists public.position_new_canvas_note();
drop function if exists public.lock_canvas_relation_space();
drop function if exists public.apply_canvas_layout(uuid,jsonb,jsonb,jsonb);
drop function if exists public.canvas_nearby_position(numeric,numeric,numeric,numeric,jsonb,boolean);
drop function if exists public.canvas_views_match(text[],text[],uuid);
drop function if exists public.canvas_note_size(text,numeric,numeric,jsonb);
