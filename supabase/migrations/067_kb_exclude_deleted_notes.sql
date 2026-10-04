-- ============================================================
-- 067 删掉的附件笔记不再被知识库检索到
-- ============================================================
--
-- 附件笔记入库后，kb_documents.note_id 外键到 notes、on delete cascade。可笔记是软删除：
-- DELETE /notes/:id 只写 notes.deleted_at，级联从不触发，知识库里那份原样留着；match_kb_chunks
-- 也不看 deleted_at。学生删掉的附件，笔记 AI 对话和智能体工具 search_course_materials 照样念得出来。
--
-- 两头一起堵：
--   · API：删笔记时顺手删掉它的 kb_documents（片段随之级联）；后台解析、启动续跑跳过已删的笔记，
--     入库前后各核一次，删除撞在入库途中也不会被写回来；
--   · 这里：检索只认没删的笔记。API 清理失败、或者迁移之前留下的残留，也检索不到。
--     课程资料（material_id，没有 note_id）不受影响。
-- 过滤和 065 的范围一样写在 WHERE 里、先于 ORDER BY … LIMIT：先取前 k 片再筛，残留一多，能看的就被挤掉了。
--
-- 签名、返回列、security invoker、只给 service_role 都和 065 一样，CREATE OR REPLACE 就够：
-- 这一版先上还是 API 先上都行，旧 API 照常调用。
-- 平台目前没有恢复已删笔记的入口；以后要做，恢复时得把附件重新入库（scheduleKbIngest）。

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
    and (d.note_id is null
         or exists (select 1 from public.notes n where n.id = d.note_id and n.deleted_at is null))
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
$$;

revoke execute on function public.match_kb_chunks(uuid, extensions.vector, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.match_kb_chunks(uuid, extensions.vector, integer, uuid[]) to service_role;

-- 已经删掉的附件，知识库里的残留一并清掉（2026-09-28 线上是 0 行；兜住那之后、新 API 上线之前删的）
delete from public.kb_documents d
using public.notes n
where n.id = d.note_id
  and n.deleted_at is not null;

notify pgrst, 'reload schema';
