-- 042 AI 内容进笔记时挂的那条支架
--
-- 学生把 AI 产出写进笔记，除了写采纳理由，还要选一条 GenAI 支架
-- （"ChatGPT 提供的案例是"…）来说明这段东西在自己的思路里算什么。
-- 记下选了哪条，导出时才能分析：学生把 AI 当案例、当解释、还是当反例。

alter table public.note_ai_insertions
  add column if not exists scaffold_id uuid references public.scaffolds(id) on delete set null;

create index if not exists idx_note_ai_insertions_scaffold
  on public.note_ai_insertions (scaffold_id) where scaffold_id is not null;

alter table public.notes
  add column if not exists ai_adoption_scaffold_id uuid references public.scaffolds(id) on delete set null;

comment on column public.note_ai_insertions.scaffold_id     is '这段 AI 内容挂在哪条 GenAI 支架下';
comment on column public.notes.ai_adoption_scaffold_id      is 'AI 摘录发布成新笔记时选的 GenAI 支架';
