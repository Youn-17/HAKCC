-- 041 全局支架的写权限
--
-- 038 把 scaffolds 的写策略写成 `course_id is null or is_course_instructor(course_id)`，
-- 前半句意味着任何登录用户都能增删改「全局支架」——全局支架对所有课程可见，
-- 学生可以往每个课堂的支架库里塞内容，也能删掉整套研究语料。
-- 收紧为：全局支架只有教师/管理员能写，课程支架仍要求是该课教师。

drop policy if exists scaffolds_insert on public.scaffolds;
drop policy if exists scaffolds_update on public.scaffolds;
drop policy if exists scaffolds_delete on public.scaffolds;

create policy scaffolds_insert on public.scaffolds for insert
  with check (case when course_id is null then public.is_teacher_or_admin()
                   else public.is_course_instructor(course_id) end);

create policy scaffolds_update on public.scaffolds for update
  using      (case when course_id is null then public.is_teacher_or_admin()
                   else public.is_course_instructor(course_id) end)
  with check (case when course_id is null then public.is_teacher_or_admin()
                   else public.is_course_instructor(course_id) end);

create policy scaffolds_delete on public.scaffolds for delete
  using (case when course_id is null then public.is_teacher_or_admin()
              else public.is_course_instructor(course_id) end);
