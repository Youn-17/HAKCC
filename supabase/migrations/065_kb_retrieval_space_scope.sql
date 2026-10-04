-- ============================================================
-- 065 知识库检索按空间隔离
-- ============================================================
--
-- 附件进的是课程级知识库，match_kb_chunks 原先只按 course_id 过滤：绑定小组的空间里
-- 上传的附件，别组学生经笔记 AI 对话（系统提示里的课程材料段）和智能体工具
-- search_course_materials 都检索得到。整群随机实验靠组间隔离，这条路要在开组空间之前堵上。
--
-- 谁进得去哪个空间，规则在 API（accessControl.ensureSpaceAccess：组员、课内身份、
-- 课程管理员须是教师账号），比数据库的 can_access_space() 严。SQL 里不再写一份，
-- 由 API 算好调用者进得去的空间传进来：
--   · 课程资料（有 material_id、不属于任何空间）全课可检索；
--   · 其余文档只有它的空间在 p_space_ids 里才可检索。不传就只剩课程资料。
-- 过滤写在 WHERE 里、先于 ORDER BY … LIMIT：先取前 k 片再筛，别组材料一多，本组能看的就被挤掉了。
--
-- 直连也要堵：两张表的读策略原先是 is_course_member(course_id)，任何课程成员拿自己的
-- 登录令牌直连 PostgREST，就能读全课文档全文，包括别组空间的附件。前端从不直连这两张表
-- （API 用 service_role），改成零策略并收回客户端权限，只走 API；检索函数也只给 service_role。
--
-- 返回列和参数都变了，CREATE OR REPLACE 换不了，只能删掉旧签名再建。旧签名删掉后，
-- 还没更新的 API 仍按三个参数调用，落到新函数上 p_space_ids 取默认 NULL，只拿到课程资料。

drop policy if exists kb_documents_select on public.kb_documents;
drop policy if exists kb_chunks_select on public.kb_chunks;
revoke all on table public.kb_documents, public.kb_chunks from anon, authenticated;

drop function if exists public.match_kb_chunks(uuid, extensions.vector, integer);

-- search_path 必须带上 extensions：pgvector 装在那个 schema，<=> 运算符在那里
create or replace function public.match_kb_chunks(
  p_course_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count int default 6,
  p_space_ids uuid[] default null
)
returns table (
  chunk_id uuid, document_id uuid, title text,
  heading_path text, content text, similarity float,
  space_id uuid, material_id uuid
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c.id, c.document_id, d.title, c.heading_path, c.content,
         1 - (c.embedding <=> p_query_embedding),
         d.space_id, d.material_id
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where c.course_id = p_course_id
    and c.embedding is not null
    and ((d.space_id is null and d.material_id is not null)
         or d.space_id = any(p_space_ids))
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
$$;

revoke execute on function public.match_kb_chunks(uuid, extensions.vector, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.match_kb_chunks(uuid, extensions.vector, integer, uuid[]) to service_role;

notify pgrst, 'reload schema';
