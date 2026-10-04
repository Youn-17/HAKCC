-- 039_riseabove_rooms.sql
--
-- Rise Above 讨论室。把旧的四步向导（选笔记 → 读 → **AI 生成综述** → 完成）
-- 换成一场讨论：来源笔记顶置常驻，同学在群聊里就这几条争，AI 同学按需被叫进来。
--
-- 边界（与观点图谱、讨论速览一致）：系统只把看到的说出来 —— 哪里出现了两套
-- 判准、谁的问题没人接 —— 那句更高一层的说法由学生自己写。
-- 落实在三处：撰写区没有任何 AI 按钮；那张系统卡只提问不给答案；
-- publish 接口完全不碰模型（实测发布的笔记 is_ai_generated=false）。
--
-- 实验：**只有那张卡分组开关**。@ AI 同学两组都保留，所以被操纵的变量单一 ——
-- 就是「该往哪儿想被不被指出来」。对照组照跑判定但写 suppressed 影子记录，
-- 留反事实分母。实测同样 6 条发言：实验组显示 1 张、对照组抑制 1 张。

create table if not exists public.riseabove_rooms (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references public.spaces(id) on delete cascade,
  course_id         uuid not null references public.courses(id) on delete cascade,
  group_id          uuid references public.groups(id) on delete set null,
  created_by        uuid not null references public.profiles(id) on delete cascade,
  -- 一次性选定，跟着 payload 一起读，不值得单开关联表
  source_note_ids   uuid[] not null default '{}',
  title             text,
  status            varchar(12) not null default 'open',   -- open | published
  published_note_id uuid references public.notes(id) on delete set null,
  card_x            numeric,
  card_y            numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.riseabove_messages (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.riseabove_rooms(id) on delete cascade,
  sender_id    uuid references public.profiles(id) on delete set null,
  sender_kind  varchar(8) not null,        -- user | ai | system
  agent_mode   varchar(32),                -- ai 时记哪个 AI 同学
  content      text not null,
  payload      jsonb,                      -- system 卡的结构化内容；对照组的 suppressed 记录
  created_at   timestamptz not null default now()
);

create index if not exists idx_riseabove_rooms_space   on public.riseabove_rooms (space_id);
create index if not exists idx_riseabove_rooms_course  on public.riseabove_rooms (course_id);
create index if not exists idx_riseabove_rooms_group   on public.riseabove_rooms (group_id);
create index if not exists idx_riseabove_rooms_creator on public.riseabove_rooms (created_by);
create index if not exists idx_riseabove_rooms_note    on public.riseabove_rooms (published_note_id);
create index if not exists idx_riseabove_msgs_room     on public.riseabove_messages (room_id, created_at);
create index if not exists idx_riseabove_msgs_sender   on public.riseabove_messages (sender_id);

alter table public.riseabove_rooms    enable row level security;
alter table public.riseabove_messages enable row level security;

-- 与画布同一把锁：能进这个空间就能看这间讨论室
create policy riseabove_rooms_select on public.riseabove_rooms for select
  using (public.can_access_space(space_id));
create policy riseabove_rooms_insert on public.riseabove_rooms for insert
  with check (public.can_access_space(space_id) and created_by = (select auth.uid()));
create policy riseabove_rooms_update on public.riseabove_rooms for update
  using (public.can_access_space(space_id)) with check (public.can_access_space(space_id));
create policy riseabove_rooms_delete on public.riseabove_rooms for delete
  using (created_by = (select auth.uid()) or public.is_course_instructor(course_id));

create policy riseabove_messages_select on public.riseabove_messages for select
  using (exists (select 1 from public.riseabove_rooms r
                 where r.id = riseabove_messages.room_id and public.can_access_space(r.space_id)));
create policy riseabove_messages_insert on public.riseabove_messages for insert
  with check (exists (select 1 from public.riseabove_rooms r
                      where r.id = riseabove_messages.room_id and public.can_access_space(r.space_id)));
