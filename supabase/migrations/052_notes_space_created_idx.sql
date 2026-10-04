-- 笔记列表按 (space_id, created_at) 取前 N 条。此前只有 space_id 单列索引，
-- 规划器对整个空间的笔记做顺序扫描并逐行跑 4 个 LATERAL 子查询之后才排序截断，
-- 3000 条笔记时单次 380ms；压测里列表吞吐被卡在 ~20 req/s。
-- 复合索引让它按序扫描、取够 200 条即停。
CREATE INDEX IF NOT EXISTS idx_notes_space_created
  ON public.notes (space_id, created_at)
  WHERE deleted_at IS NULL;
