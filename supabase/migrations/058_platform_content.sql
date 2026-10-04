-- 管理员可以在后台直接改的文案。
--
-- 起因是「写给同学们的话」那封信：它是平台负责人对学生的表态，会反复改，
-- 每改一句就要改代码、跑一次部署，太重了。
--
-- 故意做成键值表而不是给那封信单开一张表：以后再有这类「界面上的一段话，
-- 应该由人而不是由发版来决定」的内容，加个 key 就行，不用再写迁移。
--
-- 没有对应行时前端用代码里的默认文案，所以这张表是空的也不会白屏；
-- 「恢复默认」就是把这一行删掉。
create table if not exists public.platform_content (
  key text primary key,

  -- 形如 { zh: { title, body, signature }, en: { ... } }。
  -- body 是整段纯文本，空行分段 —— 编辑的人面对的是一个文本框，
  -- 不是一个要手动维护的 JSON 数组。
  value jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.platform_content enable row level security;

-- 登录用户都读得到：这些就是显示在界面上的文字，不是秘密。
drop policy if exists platform_content_select_authenticated on public.platform_content;
create policy platform_content_select_authenticated on public.platform_content
  for select using ((select auth.uid()) is not null);

-- 只有平台管理员能改。教师也不行 —— 这是平台自己对学生说的话。
drop policy if exists platform_content_write_admin on public.platform_content;
create policy platform_content_write_admin on public.platform_content
  for all using (public.is_admin()) with check (public.is_admin());

comment on table public.platform_content is
  '管理员可在后台直接编辑的界面文案。无对应行时前端回落到代码里的默认文案。';
comment on column public.platform_content.value is
  '{ zh: { title, body, signature }, en: {...} }；body 为纯文本，空行分段。';
