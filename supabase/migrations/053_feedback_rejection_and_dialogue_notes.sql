-- 学生对 AI 反馈的响应从「采纳/忽略」扩展到「采纳/不同意/追问」，并让采纳产出一条可继续对话的笔记。
--
-- 为什么「不同意」要独立于「忽略」：Nelson & Schunn (2009) 的中介模型里
-- 同意（agreement）与实施（implementation）是两个会脱钩的环节 —— 混成一个状态
-- 就再也分不出「看了不认同」和「没处理」，而前者恰恰是判断力的证据。
--
-- 为什么理由必填：Chi et al. (1994) 的自我解释效应 + Lerner & Tetlock (1999)
-- 的说明责任效应。后者有个前提条件直接约束了实现 —— 只有「决策前」要求说明
-- 才提升思维复杂度，事后补填会滑向辩护性推理。所以理由框必须在学生点下
-- 「不同意」的那一刻出现，且与该状态同一次写入，不能事后补。

alter table public.note_ai_feedbacks
  drop constraint if exists note_ai_feedbacks_status_check;
alter table public.note_ai_feedbacks
  add constraint note_ai_feedbacks_status_check
  check (status in ('new', 'accepted', 'ignored', 'followed_up', 'inserted', 'rejected'));

alter table public.note_ai_feedbacks
  add column if not exists rejection_reason text;

comment on column public.note_ai_feedbacks.rejection_reason is
  '学生说明为什么不采纳这条反馈。status=rejected 时必填，是「作出判断」的直接证据，进研究导出。';

-- 采纳产出的笔记：正文是一段人机对话，而不是一段 AI 独白。
-- 沿用 notes 表而不是新建表 —— 它要能被 build-on、被引用、进研究导出，
-- 这些能力都长在 notes 上，另起一张表等于把它排除在知识空间之外。
alter table public.notes
  drop constraint if exists notes_type_check;
alter table public.notes
  add constraint notes_type_check
  check (type in ('note', 'drawing', 'attachment', 'video', 'link', 'view', 'riseabove', 'ai_dialogue'));

comment on column public.notes.type is
  'ai_dialogue = 由学生采纳 AI 反馈生成的对话式笔记，正文承载一条 note_conversation_thread。';
