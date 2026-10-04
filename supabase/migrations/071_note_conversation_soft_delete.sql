-- ============================================================
-- 071 笔记 AI 助手的历史对话可以删除（只是不再显示）
-- ============================================================
--
-- 用户 2026-09-29 要求：历史对话可以删除。
-- 这些对话是研究数据（学生怎么向 AI 提问、AI 怎么答），所以「删除」只做标记，行和消息都留着：
--   - 产品里的列表、读消息、往里发消息都当它不存在；
--   - 研究导出照旧包含，消息表里多一列「学生已删除该对话」，分析时可以按需排除。
-- 只有开这段对话的人能删自己的。标记由 API（service role）写，客户端不直连改。

alter table public.note_conversation_threads
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

comment on column public.note_conversation_threads.deleted_at is '学生在笔记 AI 助手里删除了这段对话的时间；行和消息保留给研究导出';
comment on column public.note_conversation_threads.deleted_by is '删除的人（只有开这段对话的人能删）';

notify pgrst, 'reload schema';

-- 回滚：alter table public.note_conversation_threads drop column deleted_at, drop column deleted_by;
-- 回滚后被删过的对话会重新出现在历史对话里。
