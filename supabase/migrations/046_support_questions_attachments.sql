-- 求助截图。
--
-- AI 自己在回答里让学生「把现象截图发给老师」，但界面上没有地方传图 ——
-- 它在建议一件平台做不到的事。截图对这类问题往往比一段文字描述有用得多：
-- 学生说不清「哪个面板」，一张图就说清了。
--
-- 存成 jsonb 数组而不是单独一张表：一条求助最多几张图，
-- 为此多一张表和一次 join 不划算。
alter table public.support_questions
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.support_questions.attachments is
  '求助附带的截图：[{file_url, file_name, mime_type}]。教师端直接看图，也随研究数据一起导出。';
