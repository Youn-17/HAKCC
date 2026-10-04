-- 学生采纳 AI 反馈后，把反馈发布成画布上的一条笔记。
--
-- 记下发布出来的那条笔记，这条链路才是幂等的：采纳按钮点两下、或者请求重试，
-- 都不该在画布上多长出一张卡片。同时它也是研究数据里「反馈 → 公共话语」的直接连接
-- —— 此前采纳只改了 status，反馈本身停留在私有面板里，从未进入社区的公共讨论。
alter table public.note_ai_feedbacks
  add column if not exists published_note_id uuid references public.notes(id) on delete set null;

comment on column public.note_ai_feedbacks.published_note_id is
  '学生采纳该反馈后自动发布的笔记 id；为空表示尚未采纳或发布失败。';
