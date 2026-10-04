-- 把「写一句话」降成「点一下」，同时保住可分析的判断痕迹。
--
-- 起因是生产数据：16 次插入里 6 次的理由在 4 字以内，出现过「没有」「没有理由」
-- 「这里」—— 学生为通过必填校验而输入无意义内容。选填的修改计划 16 次只填了 1 次。
-- 强制自由文本没有换来思考，只换来了约四成垃圾数据，还有学生的烦躁。
--
-- 改法不是取消理由，而是换表达形式：分类标签点一下即可，自由文本降为可选补充。
-- 标签比自由文本更好编码，数据质量反而上升。

alter table public.note_ai_feedbacks
  add column if not exists rejection_tag text;

comment on column public.note_ai_feedbacks.rejection_tag is
  '不采纳的归类：misread（误解了我的意思）/ already_considered（我已经考虑过）/ '
  'off_track（与我的探究无关）/ disagree（不认同这个判断）/ other。'
  'status=rejected 时必填；rejection_reason 降为可选补充。';

-- 插入时若课程配了 GenAI 支架，支架本身就说明了以什么方式采纳（它还会进入笔记正文）。
-- 没有支架可选时才用这个标签兜底，保证至少留下一个分类信号。
alter table public.note_ai_insertions
  add column if not exists reason_tag text;

comment on column public.note_ai_insertions.reason_tag is
  '采纳这段 AI 内容的归类：new_angle（提供了我没想到的角度）/ clearer（帮我说得更清楚）/ '
  'evidence（提供了证据或例子）/ to_verify（先放进来，待我查证）/ other。'
  '课程配了 GenAI 支架时以 scaffold_id 为准，此列留空。';
