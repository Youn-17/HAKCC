-- AI 自适应支架：随一条反馈一起生成的半句话头，学生点一下就插进正文接着写。
--
-- 存在反馈行上而不是支架库里：它只针对这一条笔记，放进支架库会成为别的学生的噪音。
-- 由于挂在反馈链上，自然受同一道实验门控 —— 对照组既收不到反馈，也收不到 AI 支架。
alter table public.note_ai_feedbacks
  add column if not exists suggested_scaffold text,
  add column if not exists suggested_scaffold_used_at timestamptz;

comment on column public.note_ai_feedbacks.suggested_scaffold is
  'AI 按笔记内容具体化的半句话头（≤20 字，不成句、不给答案），与 trigger_type 对应。';
comment on column public.note_ai_feedbacks.suggested_scaffold_used_at is
  '学生把这条 AI 支架插进笔记的时刻；为空表示未使用。';
