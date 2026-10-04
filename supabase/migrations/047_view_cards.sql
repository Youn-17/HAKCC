-- View 卡片：一张卡片就是一个传送门。
--
-- 原来的模型是树：views.parent_view_id 加一组 card_x/card_y，一个视图**只能**有一张
-- 卡片，且只能长在它的父画布上。用户要的是「Welcome 的卡片可以放进任何一个 View，
-- 点一下就回 Welcome」—— 那就不再是包含关系，而是导航。层级随之失去意义，
-- 一并弃用（线上 views 表 0 行，无需迁移任何数据）。
--
-- view_id / host_view_id 是 text 而不是 uuid 外键：Welcome 不是数据库里的行，
-- 它是前端前置的虚拟视图，id 就是字符串 'view-welcome'，而它恰恰是最需要被
-- 放到别处的那一个。没有外键就没有级联，删视图时由 views.ts 显式清理两个方向的卡片。
create table if not exists public.view_cards (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces(id) on delete cascade,
  view_id       text not null,
  host_view_id  text not null,
  x             double precision not null default 0,
  y             double precision not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  -- 同一块画布上同一个视图只放一张卡片：放第二张只会让学生以为是两个不同的地方。
  constraint view_cards_unique_per_canvas unique (space_id, host_view_id, view_id),
  -- 视图自己的卡片摆在自己的画布上，点了等于原地不动。
  constraint view_cards_no_self_link check (view_id <> host_view_id)
);

create index if not exists idx_view_cards_canvas on public.view_cards (space_id, host_view_id);
create index if not exists idx_view_cards_target on public.view_cards (space_id, view_id);

comment on table public.view_cards is
  '画布上通往某个 View 的卡片。view_id=去哪，host_view_id=摆在哪块画布上；两者都可能是虚拟的 ''view-welcome''。';

alter table public.view_cards enable row level security;

drop policy if exists view_cards_select on public.view_cards;
create policy view_cards_select on public.view_cards
  for select using (can_access_space(space_id));

drop policy if exists view_cards_insert on public.view_cards;
create policy view_cards_insert on public.view_cards
  for insert with check (can_access_space(space_id));

-- 位置是共享的画布版式，和笔记坐标同理：任何空间成员都可以整理，不限于放卡片的人。
drop policy if exists view_cards_update on public.view_cards;
create policy view_cards_update on public.view_cards
  for update using (can_access_space(space_id)) with check (can_access_space(space_id));

-- 移除别人放的导航入口会让人找不到路，收紧到放卡片的人和教师。
drop policy if exists view_cards_delete on public.view_cards;
create policy view_cards_delete on public.view_cards
  for delete using (
    can_access_space(space_id)
    and (created_by = (select auth.uid()) or is_teacher_or_admin())
  );
