-- ============================================================
-- 060 课程资料：真实存储 + 进课程知识库
-- ============================================================
--
-- 005 建过 course_materials，但首尔新库从没跑过它（外键写的是 users，而新库里
-- public.users 是 profiles 上的视图，外键建不上），课程设置页的资料接口一直 500。
-- 就算表在，前端存的也是浏览器的 blob: 地址，换个标签页就打不开，更进不了知识库。
--
-- 这里按现行约定重建：
--   · 外键指向 public.profiles —— PostgREST 才能内联 users!uploaded_by(...)；
--   · RLS 开着、零策略 —— 只走 API（服务端身份），客户端直连一律拒绝；
--   · 文件存在 note-chat-attachments 桶的 materials/<course_id>/ 下，storage_path 用来删除；
--   · 解析缓存用和 document_renders 同名的几列：document_renders 外键到 notes，
--     资料不是笔记，放不进去；同名是为了让解析流程只有一份代码。
-- 跑过 005 的库上这张表已经存在：只补列、换掉 005 的宽松策略，不动已有数据。

create table if not exists public.course_materials (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  title        varchar(200) not null,
  description  text,
  file_url     text not null,
  file_name    varchar(255) not null,
  file_size    bigint,
  mime_type    varchar(100),
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.course_materials
  add column if not exists storage_path    text,
  add column if not exists markdown        text,
  add column if not exists plain_text      text,
  add column if not exists text_source     text,
  add column if not exists mineru_task_id  text,
  add column if not exists mineru_state    text,
  add column if not exists mineru_error    text,
  add column if not exists text_updated_at timestamptz;

create index if not exists idx_course_materials_course
  on public.course_materials (course_id, created_at desc);

alter table public.course_materials enable row level security;
drop policy if exists course_materials_select on public.course_materials;
drop policy if exists course_materials_insert on public.course_materials;
drop policy if exists course_materials_delete on public.course_materials;

-- ── 知识库：资料是第三种来源 ────────────────────────────────────────

alter table public.kb_documents
  add column if not exists material_id uuid references public.course_materials(id) on delete cascade;

alter table public.kb_documents drop constraint if exists kb_documents_source_chk;
alter table public.kb_documents add constraint kb_documents_source_chk
  check (source_type in ('attachment', 'note', 'material'));

-- 附件那一路按 (course_id, note_id) 去重，资料这一路按 (course_id, material_id)。
-- 两边的另一列都是 NULL，唯一约束里 NULL 互不相等，所以互不干扰。
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kb_documents_unique_material') then
    alter table public.kb_documents
      add constraint kb_documents_unique_material unique (course_id, material_id);
  end if;
end $$;
