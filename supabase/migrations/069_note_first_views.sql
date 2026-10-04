-- ============================================================
-- 069 画布卡片的「New」角标：别人发的笔记，作者以外还没人打开过就算新
-- ============================================================
--
-- 口径是全体的，不是按人：任何一个作者以外的人打开过（双击进笔记页，或在画布右侧
-- 详情栏里停留片刻），这条笔记对所有人都不再是新的。所以只记第一个打开的人，
-- 主键就是 note_id：列表接口嵌进来最多一行，不用把全部浏览记录拉回来。
--
-- 只经 API（service role）读写：POST /notes/:id/seen 写，GET /spaces/:id/notes 嵌读。
-- 客户端不需要直连，RLS 打开、不建策略；064 的默认权限只给 authenticated 留了 SELECT，
-- 这里一并收回，免得以后有人加了宽松策略就漏出「谁先看了谁的笔记」。

create table if not exists public.note_first_views (
  note_id    uuid primary key references public.notes(id) on delete cascade,
  -- 回填的旧笔记没有具体的人，留空
  viewer_id  uuid references public.profiles(id) on delete set null,
  viewed_at  timestamptz not null default now()
);

alter table public.note_first_views enable row level security;
revoke all on public.note_first_views from anon, authenticated;
grant select, insert, update, delete on public.note_first_views to service_role;

-- 回填一：研究日志里作者以外的人双击打开过的（note_opened 从 2026-06-07 开始有）
insert into public.note_first_views (note_id, viewer_id, viewed_at)
select distinct on (e.object_id) e.object_id, p.id, e.created_at
from public.events e
join public.notes n on n.id = e.object_id
left join public.profiles p on p.id = e.actor_id
where e.event_type = 'note_opened'
  and e.actor_id is distinct from n.author_id
order by e.object_id, e.created_at
on conflict (note_id) do nothing;

-- 回填二：两周前的旧笔记一律按已看过处理。以前在详情栏里读过的不留记录，
-- 不这样上线时旧空间整块画布都会标着 New。
insert into public.note_first_views (note_id, viewer_id, viewed_at)
select n.id, null, n.created_at
from public.notes n
where n.created_at < now() - interval '14 days'
on conflict (note_id) do nothing;

-- 让 PostgREST 立刻认得新表和它到 notes 的外键（列表接口按 notes!inner(space_id) 过滤）
notify pgrst, 'reload schema';

-- 回滚：drop table if exists public.note_first_views; notify pgrst, 'reload schema';
-- 表删掉后列表接口查不到记录，会一律当作「看过」，画布照常，只是不再有 New。
