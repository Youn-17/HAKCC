-- 文档批注 + 转换结果缓存。
--
-- 批注锚定用「引文 + 所属标题」，不用位置序列化（CFI / XPath / 字符偏移）：
-- 文档是可以被编辑的，任何基于位置的锚点在下一次保存后都会静默指错地方，
-- 而指错比丢失更糟 —— 学生会以为同伴在批评另一段话。引文对不上时前端标注
-- 「原文已修改」并退回挂在标题上，把不确定性显式说出来。
--
-- PDF 第一版只锚到页码：行内锚定要 pdf.js 文本层配合，成本高出一个量级，
-- 而「批注挂在第 N 页」已经能用。anchor 是 jsonb，将来加行内锚定不必改表。
create table if not exists public.doc_annotations (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.notes(id) on delete cascade,
  space_id    uuid not null references public.spaces(id) on delete cascade,
  author_id   uuid not null,
  -- 一层回复。不做嵌套线程：批注是就地讨论，两层以上就该开一条笔记了。
  parent_id   uuid references public.doc_annotations(id) on delete cascade,
  anchor      jsonb not null default '{}'::jsonb,
  -- 引文快照。原文改了也要能显示学生当时批的是哪句话。
  quote       text,
  body        text not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_doc_annotations_note on public.doc_annotations (note_id, created_at);

comment on table public.doc_annotations is
  '文档批注。anchor: {kind:"text", headingId, quote} 或 {kind:"page", page}。parent_id 非空即为回复。';

alter table public.doc_annotations enable row level security;

drop policy if exists doc_annotations_select on public.doc_annotations;
create policy doc_annotations_select on public.doc_annotations
  for select using (can_access_space(space_id));

drop policy if exists doc_annotations_insert on public.doc_annotations;
create policy doc_annotations_insert on public.doc_annotations
  for insert with check (can_access_space(space_id) and author_id = (select auth.uid()));

-- 改自己的批注；教师可代为处理（合并重复、清理不当内容）
drop policy if exists doc_annotations_update on public.doc_annotations;
create policy doc_annotations_update on public.doc_annotations
  for update using (
    can_access_space(space_id) and (author_id = (select auth.uid()) or is_teacher_or_admin())
  ) with check (can_access_space(space_id));

drop policy if exists doc_annotations_delete on public.doc_annotations;
create policy doc_annotations_delete on public.doc_annotations
  for delete using (
    can_access_space(space_id) and (author_id = (select auth.uid()) or is_teacher_or_admin())
  );

-- Word 等二进制文档转成 HTML 的结果。按需转换后缓存 ——
-- 上传时就转会把延迟加在每一次上传上，而多数文档从没被打开过。
create table if not exists public.document_renders (
  note_id     uuid primary key references public.notes(id) on delete cascade,
  space_id    uuid not null references public.spaces(id) on delete cascade,
  html        text not null,
  source_mime text,
  -- 转换器版本。将来换实现或修 bug 时据此让旧缓存失效，不必手工清表。
  renderer    text not null default 'mammoth-1',
  rendered_at timestamptz not null default now()
);

comment on table public.document_renders is
  '.docx 等文档转 HTML 的缓存。原文件始终保留，这里只是可读、可批注的呈现层。';

alter table public.document_renders enable row level security;

drop policy if exists document_renders_select on public.document_renders;
create policy document_renders_select on public.document_renders
  for select using (can_access_space(space_id));
