-- Server-side records of feedback judgment outcomes and optional Jev checks.

create table if not exists public.feedback_trigger_checks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  course_id uuid references public.courses(id) on delete set null,
  space_id uuid references public.spaces(id) on delete set null,
  note_id uuid references public.notes(id) on delete set null,
  -- 谁的这次检查：编辑器里是写笔记的学生；教师批量是教师
  user_id uuid references public.profiles(id) on delete set null,
  group_id uuid,
  -- editor_inline：打字停顿时的自动检查；editor_request：学生点「要反馈」；teacher_batch：教师批量
  chain text not null check (chain in ('editor_inline', 'editor_request', 'teacher_batch')),
  draft_length integer not null default 0,

  -- 结果：triggered 出了反馈；silent 判断不要；type_disabled 要，但这一类教师关掉了；
  -- llm_declined gate 下 Jev 说要、大模型写正文时坚持不要；failed 都没判断出来
  outcome text not null check (outcome in ('triggered', 'silent', 'type_disabled', 'llm_declined', 'failed')),
  -- 谁做的决定：llm / jev / regex_fallback（大模型调用全失败时的关键词规则）/ none
  decided_by text not null check (decided_by in ('llm', 'jev', 'regex_fallback', 'none')),
  trigger_type text,
  feedback_id uuid references public.note_ai_feedbacks(id) on delete set null,

  -- 大模型：llm_need 为空 = 没调或调用失败
  llm_need boolean,
  llm_type text,
  llm_provider text,
  llm_model text,
  llm_latency_ms integer,

  -- Jev：jev_mode 为 off 时下面都为空
  jev_mode text not null default 'off' check (jev_mode in ('off', 'shadow', 'gate')),
  jev_need boolean,
  -- gap：有明显问题（T1–T4、T6）；promising：停在半路的好想法（T5）
  jev_reason text check (jev_reason in ('gap', 'promising')),
  jev_need_p real,
  jev_promising_p real,
  jev_type text,
  -- {"T1": 0.02, …}
  jev_type_p jsonb,
  -- 当时用的阈值 {"need": 0.5, "promising": 0.7}（教师的灵敏度设置会在基准上调）
  jev_thresholds jsonb,
  jev_model text,
  jev_latency_ms integer,
  jev_input_tokens integer,
  -- 同一段文字 10 分钟内重复检查，用的是缓存的答案
  jev_cached boolean,
  -- 出错的类型（timeout / rate_limit / auth …）；有值时 jev_need 为空
  jev_error text
);

create index if not exists feedback_trigger_checks_course_idx
  on public.feedback_trigger_checks (course_id, created_at desc);
create index if not exists feedback_trigger_checks_note_idx
  on public.feedback_trigger_checks (note_id, created_at desc);

alter table public.feedback_trigger_checks enable row level security;
revoke all on public.feedback_trigger_checks from anon, authenticated;

comment on table public.feedback_trigger_checks is
  'AI 自动反馈的每一次检查：大模型和 Jev 各自的判断、谁做的决定、结果。只有服务端读写。';
