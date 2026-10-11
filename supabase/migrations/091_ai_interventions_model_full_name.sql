-- ai_interventions 的模型列改名对齐线上：model_name → model_full_name（2026-10-11）。
-- 001 建表时这一列叫 model_name，线上库一直是 model_full_name（同为 varchar(100)）。代码以前写 model_name，
-- PostgREST 整条拒收（PGRST204），智能体、/ai/chat 等的记录一条都没进库；后端 release 20261011_111626 起
-- 一律写 model_full_name（守卫见 api/src/routes/aiInterventionWrites.test.ts）。这条让按 repo 迁移建的库和线上一致：
--   只有 model_name → 改名，数据跟着走；已经是 model_full_name（线上）→ 什么都不做；
--   两列都在 → 停下来，不替人决定留哪一列的数据；两列都没有 → 补上 model_full_name。
do $$
declare
  has_old boolean := exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_interventions' and column_name = 'model_name');
  has_new boolean := exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_interventions' and column_name = 'model_full_name');
begin
  if has_old and has_new then
    raise exception '091: ai_interventions 同时有 model_name 和 model_full_name，先人工合并数据、删掉 model_name 再跑';
  elsif has_old then
    alter table public.ai_interventions rename column model_name to model_full_name;
  elsif not has_new then
    alter table public.ai_interventions add column model_full_name varchar(100);
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'ai_interventions' and column_name = 'model_full_name') then
    raise exception '091: 跑完还是没有 ai_interventions.model_full_name';
  end if;

  -- 改了列才让 PostgREST 重新读表结构；线上是空操作，不打扰它
  if has_old or not has_new then
    perform pg_notify('pgrst', 'reload schema');
  end if;
end
$$;

-- ── 执行后核对 ───────────────────────────────────────────────────────
-- select column_name, data_type, character_maximum_length from information_schema.columns
--  where table_schema = 'public' and table_name = 'ai_interventions' and column_name like 'model%';
-- 应只有一行：model_full_name | character varying | 100
-- 别往回改名：代码只认 model_full_name，改回去所有 AI 使用记录又会整条被拒。
