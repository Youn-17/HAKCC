-- 课程知识库：解析后的材料按课程隔离地存放，供检索增强（RAG）使用。
--
-- 为什么是检索不是微调：一门课一个微调模型无法管理，加一份材料就得重训，
-- 跨课程的泄露也很难防。检索天然按课程隔离、加材料立刻生效、成本低一到两个数量级。
--
-- 检索单位是**片段**而不是整篇：整篇存下来对 AI 没有增量（现在就已经把上万字
-- 塞进上下文了），价值在于从几十份材料里捞出相关的三段。
--
-- source_type 从一开始就容得下 'note'：一门课的知识主要在笔记里，
-- 即使先只接文档这一路，表结构不该把那条路堵死。
create table if not exists public.kb_documents (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses(id) on delete cascade,
  space_id      uuid references public.spaces(id) on delete set null,
  note_id       uuid references public.notes(id) on delete cascade,
  source_type   text not null default 'attachment',
  title         text not null,
  file_name     text,
  mime_type     text,
  text_source   text,
  content       text not null default '',
  content_hash  text,
  char_count    integer not null default 0,
  status        text not null default 'pending',
  error         text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint kb_documents_source_chk check (source_type in ('attachment', 'note')),
  constraint kb_documents_status_chk check (status in ('pending', 'parsing', 'ready', 'failed')),
  constraint kb_documents_unique_note unique (course_id, note_id)
);

create index if not exists idx_kb_documents_course on public.kb_documents (course_id, status);

create table if not exists public.kb_chunks (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.kb_documents(id) on delete cascade,
  -- 冗余一份 course_id：检索时直接按课程过滤，不必每次 join 回去。
  -- 课程隔离是这张表最重要的性质 —— 别的课的材料混进来会直接污染整群随机实验的数据，
  -- 中间环节越少越不容易出错。
  course_id       uuid not null references public.courses(id) on delete cascade,
  ordinal         integer not null,
  heading_path    text,
  content         text not null,
  char_count      integer not null default 0,
  embedding       vector(1536),
  embedding_model text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_kb_chunks_doc on public.kb_chunks (document_id, ordinal);
create index if not exists idx_kb_chunks_course on public.kb_chunks (course_id);

alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;

drop policy if exists kb_documents_select on public.kb_documents;
create policy kb_documents_select on public.kb_documents
  for select using (is_course_member(course_id));

drop policy if exists kb_chunks_select on public.kb_chunks;
create policy kb_chunks_select on public.kb_chunks
  for select using (is_course_member(course_id));

-- search_path 必须带上 extensions —— Supabase 把 pgvector 装在那个 schema，
-- 只写 public 的话 <=> 运算符找不到（第一版就是这么失败的）。
create or replace function public.match_kb_chunks(
  p_course_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 6
)
returns table (
  chunk_id uuid, document_id uuid, title text,
  heading_path text, content text, similarity float
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c.id, c.document_id, d.title, c.heading_path, c.content,
         1 - (c.embedding <=> p_query_embedding)
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where c.course_id = p_course_id and c.embedding is not null
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
$$;
