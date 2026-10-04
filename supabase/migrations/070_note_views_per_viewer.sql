-- ============================================================
-- 070 「New」改成按人算：每个人自己没打开过的笔记，只在他那里标 New
-- ============================================================
--
-- 069 的口径是全体的（作者以外有一个人打开过，所有人那里都不再是新的），只记第一个打开的人。
-- 用户 2026-09-29 改了口径：A 没看过就在 A 那里显示 New，B 没看过就在 B 那里显示，互不影响。
-- 所以改成每人一行：主键 (note_id, viewer_id)，记的是这个人第一次打开的时间。
--
-- 只经 API（service role）读写：POST /notes/:id/seen 写本人这一行；
-- GET /spaces/:id/notes 只查本人在这个空间里的行，给每条笔记 seen_by_me。
-- 客户端不直连：RLS 打开、不建策略，064 默认给 authenticated 的 SELECT 一并收回。
--
-- 2026-09-15 之前发的笔记一律不算新：那时详情栏里的浏览没有记录，没法知道谁看过。
-- 这个界线写在 API 里（NEW_BADGE_SINCE），不用给每个人、每条旧笔记各插一行。

create table if not exists public.note_views (
  note_id          uuid not null references public.notes(id) on delete cascade,
  viewer_id        uuid not null references public.profiles(id) on delete cascade,
  first_viewed_at  timestamptz not null default now(),
  primary key (note_id, viewer_id)
);

-- 列表接口按「这个人 + 这个空间」取；外键 viewer_id 也要有索引（035 的约定）
create index if not exists idx_note_views_viewer on public.note_views (viewer_id);

alter table public.note_views enable row level security;
revoke all on public.note_views from anon, authenticated;
grant select, insert, update, delete on public.note_views to service_role;

-- 回填一：研究日志里每个人双击打开过的（note_opened 从 2026-06-07 开始有），按人各一行
insert into public.note_views (note_id, viewer_id, first_viewed_at)
select e.object_id, e.actor_id, min(e.created_at)
from public.events e
join public.notes n on n.id = e.object_id
join public.profiles p on p.id = e.actor_id
where e.event_type = 'note_opened'
  and e.actor_id is distinct from n.author_id
group by e.object_id, e.actor_id
on conflict (note_id, viewer_id) do nothing;

-- 回填二：069 上线后记下的「第一个打开的人」（含在详情栏里停留的），也是这个人看过
insert into public.note_views (note_id, viewer_id, first_viewed_at)
select v.note_id, v.viewer_id, v.viewed_at
from public.note_first_views v
join public.profiles p on p.id = v.viewer_id
on conflict (note_id, viewer_id) do nothing;

-- 069 的全体口径表不再用：内容已经并进来，按人的表能算出「第一个打开的人」
drop table if exists public.note_first_views;

notify pgrst, 'reload schema';

-- 回滚：drop table if exists public.note_views; notify pgrst, 'reload schema';
-- 表删掉后列表接口查不到记录，会一律当作看过，画布照常，只是不再有 New。
