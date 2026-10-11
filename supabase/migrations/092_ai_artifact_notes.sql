-- 智能体做的网页导入到笔记（2026-10-11 用户：生成的内容可以导入到指定的 Note；导入后看得到这条笔记的人都能打开这个网页）。
-- 一行 = 某个网页（按 group_id，所有版本）挂在某条笔记上。routes/artifacts.ts 判断能不能看网页时：
-- 本人、本课教职，或者能看到任一挂着它的笔记的人。只经后端接口读写。
create table if not exists public.ai_artifact_notes (
  group_id uuid not null,
  note_id uuid not null references public.notes(id) on delete cascade,
  artifact_id uuid not null references public.ai_artifacts(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, note_id)
);
create index if not exists ai_artifact_notes_note_idx on public.ai_artifact_notes (note_id);
alter table public.ai_artifact_notes enable row level security;
revoke all on public.ai_artifact_notes from anon, authenticated;
grant select, insert, update, delete on public.ai_artifact_notes to service_role;
comment on table public.ai_artifact_notes is 'Which notes an agent-built web page was imported into; anyone who can read one of those notes may open the page. Access only through the API.';
