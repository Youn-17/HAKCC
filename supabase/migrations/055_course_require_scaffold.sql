-- 教师可要求本课程的笔记必须带支架。
-- 放在 courses 上而不是 course_scaffold_prefs：它是课程级的一个开关，不是某条支架的属性。
alter table public.courses
  add column if not exists require_scaffold boolean not null default false;

comment on column public.courses.require_scaffold is
  '为 true 时，学生保存普通笔记必须至少使用一条支架（正文含 data-scaffold-id）。前端拦截，后端不强制——教师端也要能写不带支架的示范笔记。';
