-- 044 笔记正文的来源分层
--
-- 一条笔记里经常混着三种来源：学生写在支架方括号里的、学生自由写的、从 AI 搬进来的。
-- 只看 is_ai_generated 或整条字数分不出来。存稿时把正文切成段并记下每段的来源，
-- 研究导出直接读这两列，不用事后再解析 HTML。
--
-- content_segments: 每段的 kind / 字数 / 支架 id / provider·model
-- segment_stats:    这条笔记的汇总（学生字数、支架内字数、AI 字数、AI 占比…）

alter table public.notes
  add column if not exists content_segments jsonb not null default '[]'::jsonb,
  add column if not exists segment_stats    jsonb not null default '{}'::jsonb;

comment on column public.notes.content_segments is '正文按来源切分后的段落：scaffold / plain / ai_inserted / ai_published / media';
comment on column public.notes.segment_stats    is '来源汇总：studentChars / scaffoldChars / plainChars / aiChars / aiRatio 等';

-- 常用筛选：找用过支架的、含 AI 内容的
create index if not exists idx_notes_has_scaffold on public.notes ((segment_stats->>'hasScaffold'))
  where deleted_at is null;
create index if not exists idx_notes_has_ai on public.notes ((segment_stats->>'hasAi'))
  where deleted_at is null;
