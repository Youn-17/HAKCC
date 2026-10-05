-- Suggested display titles for accepted AI feedback.

alter table public.note_ai_feedbacks
  add column if not exists suggested_title text;

comment on column public.note_ai_feedbacks.suggested_title is
  '采纳后发布成笔记时用的标题：生成反馈时模型给出，或采纳时现场生成。空 = 还没有（退回从正文截句）。';
