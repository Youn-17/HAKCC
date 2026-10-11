/**
 * 跑智能体评测（第三步，2026-10-11）。在服务器上跑：用测试学生的身份（拿服务器上的 JWT 密钥签一个令牌）
 * 把 50 个任务发给指定的后端，收齐回答和运行记录，判分、和基线比，最后把这次产生的数据全删掉。
 *
 *   node --env-file=.env dist/eval/agentEvalRun.js \
 *     --base=http://127.0.0.1:4100/api --baseline=./evaluation/baseline.json \
 *     --out=./evaluation/runs/20261011_1300.json
 *
 * 发版前（deploy.sh backend-eval）对着还没切过去的新版本跑；退出码 0 通过，1 掉分，2 没跑起来。
 * 必须显式传入隔离测试课程、空间和学生参数；默认模型为 DeepSeek Flash：
 * 要比的是我们自己的代码和提示词，不是课程设置换了哪家模型。
 */
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { supabase } from '../config/supabase';
import { notePreviewText } from '../services/noteText';
import { AGENT_EVAL_TASKS, type EvalTask } from './agentEvalTasks';
import {
  compareWithBaseline,
  formatReport,
  gradeTask,
  summarizeRun,
  type EvalSpace,
  type RunSummary,
  type TaskResult,
  type TraceDigest,
  type TurnOutput,
} from './agentEvalGrade';

export interface EvalConfig {
  base: string;
  courseId: string;
  spaceId: string;
  userId: string;
  providerId: string;
  model: string;
  concurrency: number;
  only: string[] | null;
  out: string | null;
  baseline: string | null;
  updateBaseline: boolean;
  keepData: boolean;
  /** 和基线比没过时整套再跑一遍、按两遍平均判（模型每次回答不一样，一遍的偶然失误不该挡住发版） */
  confirm: boolean;
}

export const DEFAULTS = {
  base: 'http://127.0.0.1:4000/api',
  courseId: '',
  spaceId: '',
  userId: '',
  providerId: 'deepseek',
  model: 'deepseek-flash',
  concurrency: 4,
};

/** 跑之前测试学生 24 小时里已经用了多少次：太多的话跑到一半会撞每日上限，结果全是 429 */
const MAX_PRIOR_USAGE = 40;
const DEFAULT_TURN_TIMEOUT_MS = 150_000;

export function parseArgs(argv: string[]): EvalConfig {
  const get = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const has = (name: string) => argv.includes(`--${name}`);
  return {
    base: (get('base') ?? DEFAULTS.base).replace(/\/$/, ''),
    courseId: get('course') ?? DEFAULTS.courseId,
    spaceId: get('space') ?? DEFAULTS.spaceId,
    userId: get('user') ?? DEFAULTS.userId,
    providerId: get('provider') ?? DEFAULTS.providerId,
    model: get('model') ?? DEFAULTS.model,
    concurrency: Math.max(1, Math.min(8, Number(get('concurrency') ?? DEFAULTS.concurrency) || DEFAULTS.concurrency)),
    only: get('only') ? get('only')!.split(',').map(s => s.trim()).filter(Boolean) : null,
    out: get('out') ?? null,
    baseline: get('baseline') ?? null,
    updateBaseline: has('update-baseline'),
    keepData: has('keep-data'),
    confirm: !has('no-confirm'),
  };
}

/**
 * 要不要再跑一遍：和基线比没过时；或者要更新基线时（一遍的波动会把基线拉高拉低，10-11 有一次就把 cites_real
 * 基线从 100% 拉到了 90%）。只重跑没过的题会把时好时坏的退步藏起来，所以整套重跑、两遍合起来算平均。
 * 只跑了几题时不重跑；没有基线时只看完成率，也不重跑。
 */
export function needsSecondPass(verdict: { ok: boolean }, o: { partial: boolean; hasBaseline: boolean; confirm: boolean; updateBaseline?: boolean }): boolean {
  if (o.partial) return false;
  if (o.updateBaseline) return true;
  return !verdict.ok && o.hasBaseline && o.confirm;
}

// ── 令牌：和 Supabase 签发的格式一样，只在服务器上签 ──────────

export function forgeToken(userId: string, secret: string, ttlSeconds = 3600): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: userId, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + ttlSeconds });
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ── SSE ───────────────────────────────────────────────────────

export type SseEvent = Record<string, unknown> | '[DONE]';

export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find(l => l.startsWith('data: '));
    if (!line) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') { events.push('[DONE]'); continue; }
    try { events.push(JSON.parse(data)); } catch { /* 不是 JSON 的行跳过 */ }
  }
  return events;
}

/** 一轮的事件 → 回答、过程步骤、计划、选项卡、网页、错误 */
export function collectTurn(events: SseEvent[]): TurnOutput {
  const out: TurnOutput = {
    reply: '', toolSteps: [], plan: null, questions: [], artifacts: [], errors: [], providerSwitches: 0, conversationId: null, runId: null,
  };
  for (const e of events) {
    if (e === '[DONE]') continue;
    if (typeof e.token === 'string') out.reply += e.token;
    if (e.toolStatus === 'used' && typeof e.toolName === 'string') out.toolSteps.push({ name: e.toolName, ...(typeof e.toolSummary === 'string' ? { summary: e.toolSummary } : {}) });
    if (e.agentPlan && typeof e.agentPlan === 'object') out.plan = e.agentPlan as TurnOutput['plan'];
    if (e.agentQuestion && typeof e.agentQuestion === 'object') out.questions.push(e.agentQuestion as TurnOutput['questions'][number]);
    if (e.artifact && typeof e.artifact === 'object') out.artifacts.push(e.artifact as TurnOutput['artifacts'][number]);
    if (typeof e.error === 'string') out.errors.push(e.error);
    if (e.providerSwitch) out.providerSwitches += 1;
    if (e.done === true && typeof e.conversationId === 'string') out.conversationId = e.conversationId;
    const assistant = e.assistantMessage as { aiMetadata?: Record<string, unknown>; ai_metadata?: Record<string, unknown> } | undefined;
    const runId = assistant?.aiMetadata?.run_id ?? assistant?.ai_metadata?.run_id;
    if (typeof runId === 'string') out.runId = runId;
  }
  return out;
}

async function postSse(cfg: EvalConfig, token: string, path: string, body: unknown, timeoutMs: number): Promise<{ status: number; events: SseEvent[]; raw: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(cfg.base + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      // 一分钟里问得太多（知识空间每人每分钟 20 次）：等一会儿再问
      if (res.status === 429 && /Too many requests/i.test(text) && attempt < 3) {
        await new Promise(r => setTimeout(r, 20_000));
        continue;
      }
      return { status: res.status, events: res.ok ? parseSse(text) : [], raw: res.ok ? '' : text.slice(0, 300) };
    } catch (err) {
      return { status: 0, events: [], raw: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 429, events: [], raw: 'rate limited' };
}

// ── 运行记录 ─────────────────────────────────────────────────

export function digestTrace(run: { metadata?: Record<string, unknown> | null } | null, effects: Array<{ effect_type: string; payload: Record<string, unknown> | null }>): TraceDigest {
  const pick = (type: string) => effects.find(e => e.effect_type === type)?.payload ?? null;
  const checked = pick('answer_checked') as TraceDigest['answerCheck'];
  const finished = pick('run_finished') as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    answerCheck: checked,
    toolCalls: num(finished?.tool_calls),
    toolDenied: effects.filter(e => e.effect_type === 'tool_denied').length,
    firstTokenMs: num(finished?.first_token_ms),
    totalMs: num(finished?.total_ms),
    usage: (finished?.usage as TraceDigest['usage']) ?? null,
    model: typeof finished?.model === 'string' ? finished.model : (typeof run?.metadata?.model === 'string' ? run.metadata.model : null),
    truncated: finished?.truncated === true,
    providerFinish: typeof finished?.provider_finish === 'string' ? finished.provider_finish : null,
  };
}

/** 运行记录是回答发完之后才写库的：等一会儿再读 */
async function fetchTrace(runId: string): Promise<TraceDigest | null> {
  for (let i = 0; i < 12; i++) {
    const { data: effects } = await supabase.from('agent_effects').select('effect_type, payload').eq('run_id', runId).order('seq');
    if (effects && effects.some(e => e.effect_type === 'run_finished')) {
      const { data: run } = await supabase.from('agent_runs').select('metadata').eq('id', runId).maybeSingle();
      return digestTrace(run, effects as Array<{ effect_type: string; payload: Record<string, unknown> | null }>);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

async function workspaceRunId(conversationId: string): Promise<string | null> {
  const { data } = await supabase.from('agent_messages').select('ai_metadata, created_at')
    .eq('conversation_id', conversationId).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1);
  const runId = (data?.[0]?.ai_metadata as Record<string, unknown> | undefined)?.run_id;
  return typeof runId === 'string' ? runId : null;
}

// ── 跑一题 ───────────────────────────────────────────────────

export interface Created { conversations: Set<string>; threads: Set<string> }

async function runTask(task: EvalTask, cfg: EvalConfig, token: string, space: EvalSpace, created: Created): Promise<{ result: TaskResult; switches: number }> {
  const started = Date.now();
  const timeout = task.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const turns = [...(task.setup ?? []), task.question];
  let last: TurnOutput = collectTurn([]);
  let error: string | undefined;
  let switches = 0;
  try {
    if (task.surface === 'workspace') {
      let conversationId: string | null = null;
      for (const content of turns) {
        const r = await postSse(cfg, token, `/workspace-agent/${cfg.courseId}/stream`, {
          content, provider_id: cfg.providerId, model: cfg.model, space_id: cfg.spaceId,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }, timeout);
        last = collectTurn(r.events);
        switches += last.providerSwitches;
        if (last.conversationId) { conversationId = last.conversationId; created.conversations.add(conversationId); }
        if (r.status !== 200) { error = `HTTP ${r.status} ${r.raw}`; break; }
      }
      if (!error && conversationId) last.runId = await workspaceRunId(conversationId);
    } else {
      const res = await fetch(`${cfg.base}/notes/${task.noteId}/conversations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'ai', provider_id: cfg.providerId, model: cfg.model, force_new: true }),
      });
      const thread = (await res.json().catch(() => null) as { conversation?: { id?: string } } | null)?.conversation;
      if (!res.ok || !thread?.id) {
        error = `开不了对话 HTTP ${res.status}`;
      } else {
        created.threads.add(thread.id);
        for (const content of turns) {
          const r = await postSse(cfg, token, `/note-conversations/${thread.id}/ai/agent-stream`, {
            content, provider_id: cfg.providerId, model: cfg.model, agent_mode: task.agentMode ?? 'idea_coach',
          }, timeout);
          last = collectTurn(r.events);
          switches += last.providerSwitches;
          if (r.status !== 200) { error = `HTTP ${r.status} ${r.raw}`; break; }
        }
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const trace = last.runId ? await fetchTrace(last.runId) : null;
  return { result: gradeTask(task, last, space, { ms: Date.now() - started, trace, error }), switches };
}

// ── 准备、收尾 ───────────────────────────────────────────────

async function loadSpace(spaceId: string): Promise<EvalSpace> {
  const [{ data, error }, { data: spaceRow, error: spaceError }] = await Promise.all([
    supabase.from('notes').select('title, content').eq('space_id', spaceId).is('deleted_at', null),
    // spaces 表的名字列叫 title（没有 name 列；10-11 先写成 name，查询报错被吞，空间名一直没算进去）
    supabase.from('spaces').select('title').eq('id', spaceId).maybeSingle(),
  ]);
  if (error) throw new Error(`读不到评测空间的笔记：${error.message}`);
  if (spaceError) console.warn(`[eval] 读不到空间名：${spaceError.message}`);
  // 空间自己的名字也算真的：知识空间智能体拿到的「当前笔记」标题就是「Workspace: 空间名」
  const spaceName = typeof spaceRow?.title === 'string' ? spaceRow.title : '';
  return {
    titles: [
      ...(data ?? []).map(n => String(n.title ?? '')).filter(Boolean),
      ...(spaceName ? [spaceName, `Workspace: ${spaceName}`] : []),
    ],
    bodies: (data ?? []).map(n => notePreviewText(String(n.content ?? ''))),
  };
}

async function priorUsage(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase.from('ai_interventions').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since);
  return count ?? 0;
}

/** 这次评测产生的数据全删掉：对话、线程、运行记录（effects 跟着级联）、用量、事件、检索记录、做的网页 */
export async function cleanup(cfg: EvalConfig, since: string, created: Created): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  const run = async (label: string, q: PromiseLike<{ error: { message: string } | null; count: number | null }>) => {
    const { error, count } = await q;
    out[label] = error ? `ERR ${error.message}` : (count ?? 0);
  };
  const conversations = [...created.conversations];
  const threads = [...created.threads];
  if (conversations.length) {
    await run('agent_messages', supabase.from('agent_messages').delete({ count: 'exact' }).in('conversation_id', conversations));
    await run('agent_conversations', supabase.from('agent_conversations').delete({ count: 'exact' }).in('id', conversations).eq('user_id', cfg.userId));
  }
  if (threads.length) {
    await run('note_conversation_messages', supabase.from('note_conversation_messages').delete({ count: 'exact' }).in('thread_id', threads));
    await run('note_conversation_participants', supabase.from('note_conversation_participants').delete({ count: 'exact' }).in('thread_id', threads));
    await run('note_conversation_threads', supabase.from('note_conversation_threads').delete({ count: 'exact' }).in('id', threads));
  }
  await run('agent_runs', supabase.from('agent_runs').delete({ count: 'exact' }).eq('user_id', cfg.userId).gte('started_at', since));
  await run('ai_interventions', supabase.from('ai_interventions').delete({ count: 'exact' }).eq('user_id', cfg.userId).gte('created_at', since));
  await run('events', supabase.from('events').delete({ count: 'exact' }).eq('actor_id', cfg.userId).gte('created_at', since));
  await run('kb_retrieval_logs', supabase.from('kb_retrieval_logs').delete({ count: 'exact' }).eq('user_id', cfg.userId).gte('created_at', since));
  await run('ai_artifacts', supabase.from('ai_artifacts').delete({ count: 'exact' }).eq('owner_id', cfg.userId).gte('created_at', since));
  return out;
}

/**
 * 测试学生的记忆和学习者画像：跑之前拍一份，每一遍跑完还原（2026-10-11：之前没还原，智能体给测试学生存的
 * 「了解」一轮轮攒下来，后面的回答开始说「你那份记忆里……」，题和题、轮和轮互相串了）。
 */
export type MemorySnapshot = { reflections: Array<Record<string, unknown>>; profile: Record<string, unknown> | null };

export async function snapshotMemory(cfg: Pick<EvalConfig, 'userId' | 'courseId'>): Promise<MemorySnapshot> {
  const [{ data: reflections, error }, { data: profile }] = await Promise.all([
    supabase.from('agent_reflections').select('*').eq('user_id', cfg.userId).eq('course_id', cfg.courseId),
    supabase.from('learner_profiles').select('*').eq('user_id', cfg.userId).eq('course_id', cfg.courseId).maybeSingle(),
  ]);
  if (error) throw new Error(`读不到测试学生的记忆：${error.message}`);
  return { reflections: (reflections ?? []) as Array<Record<string, unknown>>, profile: (profile as Record<string, unknown> | null) ?? null };
}

export async function restoreMemory(cfg: Pick<EvalConfig, 'userId' | 'courseId'>, snap: MemorySnapshot): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  const { error, count } = await supabase.from('agent_reflections').delete({ count: 'exact' }).eq('user_id', cfg.userId).eq('course_id', cfg.courseId);
  out.agent_reflections = error ? `ERR ${error.message}` : (count ?? 0);
  if (snap.reflections.length > 0) {
    const { error: e } = await supabase.from('agent_reflections').insert(snap.reflections);
    if (e) out.agent_reflections_restore = `ERR ${e.message}`;
  }
  if (snap.profile) {
    const { id, user_id: _u, course_id: _c, ...fields } = snap.profile;
    const { error: e } = await supabase.from('learner_profiles').update(fields).eq('id', String(id));
    out.learner_profiles = e ? `ERR ${e.message}` : 'restored';
  } else {
    const { error: e, count: n } = await supabase.from('learner_profiles').delete({ count: 'exact' }).eq('user_id', cfg.userId).eq('course_id', cfg.courseId);
    out.learner_profiles = e ? `ERR ${e.message}` : (n ?? 0);
  }
  return out;
}

/** 同一条笔记上的题一个接一个跑：两题同时「新建对话」会拿到同一段空白对话 */
function noteLock() {
  const tails = new Map<string, Promise<void>>();
  return async <T>(key: string | undefined, fn: () => Promise<T>): Promise<T> => {
    if (!key) return fn();
    const prev = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>(r => { release = r; });
    tails.set(key, prev.then(() => mine));
    await prev;
    try { return await fn(); } finally { release(); }
  };
}

// ── 主流程 ───────────────────────────────────────────────────

export interface EvalRunOutput {
  meta: Record<string, unknown>;
  summary: RunSummary;
  verdict: ReturnType<typeof compareWithBaseline>;
  results: TaskResult[];
}

export async function runEval(cfg: EvalConfig): Promise<EvalRunOutput> {
  if (!cfg.courseId || !cfg.spaceId || !cfg.userId) {
    throw new Error('Pass --course, --space and --user for isolated evaluation fixtures.');
  }
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('缺 SUPABASE_JWT_SECRET（要在服务器上跑）');
  const tasks = cfg.only ? AGENT_EVAL_TASKS.filter(t => cfg.only!.includes(t.id)) : AGENT_EVAL_TASKS;
  if (tasks.length === 0) throw new Error('没有要跑的题');
  if (tasks.some(task => task.surface === 'note') &&
      ['EVAL_NOTE_PERSONALIZED_FOR_WHOM', 'EVAL_NOTE_ESSAY_PROXY', 'EVAL_NOTE_STRUGGLE'].some(key => !process.env[key])) {
    throw new Error('Set EVAL_NOTE_PERSONALIZED_FOR_WHOM, EVAL_NOTE_ESSAY_PROXY and EVAL_NOTE_STRUGGLE to isolated fixture Note IDs.');
  }
  const used = await priorUsage(cfg.userId);
  if (used > MAX_PRIOR_USAGE) throw new Error(`测试学生 24 小时里已经用了 ${used} 次，跑完会撞每日上限，先清理再跑`);

  const startedAt = new Date().toISOString();
  const memorySnapshot = cfg.keepData ? null : await snapshotMemory(cfg);
  const token = forgeToken(cfg.userId, secret);
  const space = await loadSpace(cfg.spaceId);
  const lock = noteLock();

  // 一遍：50 题 4 路并发，跑完删掉这一遍产生的数据（两遍合起来会超过测试学生每天 100 次的上限）
  const runPass = async (pass: number): Promise<{ results: TaskResult[]; switches: number }> => {
    const since = new Date(Date.now() - 2000).toISOString();
    const created: Created = { conversations: new Set(), threads: new Set() };
    const results: TaskResult[] = new Array(tasks.length);
    let switches = 0;
    let next = 0;
    try {
      const worker = async () => {
        while (next < tasks.length) {
          const i = next++;
          const task = tasks[i];
          const { result, switches: s } = await lock(task.surface === 'note' ? task.noteId : undefined, () => runTask(task, cfg, token, space, created));
          results[i] = pass > 1 ? { ...result, pass } : result;
          switches += s;
          console.log(`[eval]${pass > 1 ? ` (第 ${pass} 遍)` : ''} ${task.id} ${result.score.toFixed(2)}${result.notes.length ? `  ${result.notes.join('; ').slice(0, 160)}` : ''}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(cfg.concurrency, tasks.length) }, worker));
    } finally {
      if (!cfg.keepData) {
        // 运行记录在回答发完之后才写：多等两秒再删，免得漏删最后几条
        await new Promise(r => setTimeout(r, 2000));
        const removed = await cleanup(cfg, since, created);
        const restored = memorySnapshot ? await restoreMemory(cfg, memorySnapshot) : {};
        console.log(`[eval] cleanup ${JSON.stringify({ ...removed, ...restored })}`);
      }
    }
    return { results, switches };
  };

  const baseline = cfg.baseline && existsSync(cfg.baseline)
    ? (JSON.parse(readFileSync(cfg.baseline, 'utf-8')) as { summary: RunSummary }).summary
    : null;
  // 只跑了几题时不和基线比，也不写基线
  const partial = Boolean(cfg.only);
  const first = await runPass(1);
  let results = first.results;
  let switches = first.switches;
  let summary = summarizeRun(results, switches);
  let verdict = compareWithBaseline(summary, partial ? null : baseline);
  let passes = 1;
  if (needsSecondPass(verdict, { partial, hasBaseline: Boolean(baseline), confirm: cfg.confirm, updateBaseline: cfg.updateBaseline })) {
    console.log(verdict.ok
      ? '[eval] 要更新基线：整套再跑一遍，按两遍平均算'
      : `[eval] 第一遍没过（${verdict.reasons.join('；')}），整套再跑一遍，按两遍平均判`);
    const second = await runPass(2);
    results = [...results, ...second.results];
    switches += second.switches;
    passes = 2;
    summary = { ...summarizeRun(results, switches), passes };
    verdict = compareWithBaseline(summary, baseline);
  }
  const meta = {
    startedAt,
    finishedAt: new Date().toISOString(),
    base: cfg.base,
    providerId: cfg.providerId,
    model: cfg.model,
    tasks: tasks.length,
    passes,
    partial,
    baselineUsed: Boolean(baseline && !partial),
  };
  const output: EvalRunOutput = { meta, summary, verdict, results };
  if (cfg.out) {
    mkdirSync(dirname(cfg.out), { recursive: true });
    writeFileSync(cfg.out, JSON.stringify(output, null, 2));
  }
  // 第一次跑、或明说要更新：这次的结果当基线
  if (cfg.baseline && !partial && verdict.ok && (cfg.updateBaseline || !baseline)) {
    mkdirSync(dirname(cfg.baseline), { recursive: true });
    writeFileSync(cfg.baseline, JSON.stringify({ meta, summary }, null, 2));
    console.log(`[eval] baseline written: ${cfg.baseline}`);
  }
  console.log(`\n${formatReport(summary, verdict, results, partial ? null : baseline)}`);
  return output;
}

if (require.main === module) {
  runEval(parseArgs(process.argv.slice(2)))
    .then(out => process.exit(out.verdict.ok ? 0 : 1))
    .catch(err => {
      console.error(`[eval] 没跑起来：${err instanceof Error ? err.message : err}`);
      process.exit(2);
    });
}
