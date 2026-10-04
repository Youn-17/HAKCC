-- 040 支架库：接入五学期支架分类表
--
-- scaffolds 表建于 017，但一直是空的（0 行），所以笔记编辑器里「暂无可用支架」。
-- 现在把研究用的五学期支架语料（177 条）作为全局支架灌进去。
--
-- 每条支架就是学生在笔记里看到的那个标记本身（"我的理论[……]"），
-- 所以 title 存支架文本，不是分类名。三个理论框架的编码放 metadata，
-- 导出和分析都从那里取。

alter table public.scaffolds
  add column if not exists title_en   varchar(300),
  add column if not exists metadata   jsonb not null default '{}'::jsonb,
  add column if not exists sort_order integer not null default 0;

comment on column public.scaffolds.title_en   is '英文支架文本；界面按语言切换';
comment on column public.scaffolds.metadata   is 'l1/l2 分类码、Hannafin 功能分类、Saye&Brush 交付方式、Liu 元认知类型、gai 标记、出现过的学期、同义写法';
comment on column public.scaffolds.sort_order is '按分类表原始顺序，保证同一支架组内次序稳定';

create index if not exists idx_scaffolds_sort     on public.scaffolds (sort_order);
create index if not exists idx_scaffolds_category on public.scaffolds (category);
create index if not exists idx_scaffolds_l1       on public.scaffolds ((metadata->>'l1'));
create index if not exists idx_scaffolds_gai      on public.scaffolds ((metadata->>'gai')) where course_id is null;

-- 全局支架不允许同一分类下出现同名，重复导入时靠它兜住
create unique index if not exists uq_scaffolds_global_title
  on public.scaffolds (category, title) where course_id is null;
