/* Implementation notes are described in the public update guide. */
import { supabase } from '../config/supabase';
import {
  embedKbTexts, hedged, isInputError, kbEmbeddingConfigured, KB_VECTOR_MODEL, toHalfvecLiteral,
} from './kbEmbedding';

/* Implementation notes are described in the public update guide. */
const BATCH = 16;
/** 一轮最多算这么多片，剩下的下一轮接着算，别一口气占满 DMX 的并发 */
const PER_RUN = 160;
/* Implementation notes are described in the public update guide. */
const BATCH_TIMEOUT_MS = 25_000;
const BATCH_HEDGE_MS = 8_000;
const BATCH_ROUNDS = 3;
const INTERVAL_MS = 2 * 60_000;
/** 接口出错后暂停：1、2、4……分钟，最长 30 分钟 */
const MAX_PAUSE_MS = 30 * 60_000;
/** 单片内容被接口拒了：6 小时内不再试它 */
const REJECTED_RETRY_MS = 6 * 60 * 60_000;

type Todo = { chunk_id: string; course_id: string; heading_path: string | null; content: string };
export interface FillResult { embedded: number; rejected: number; paused: boolean }

let running: Promise<FillResult> | null = null;
let rerun = false;
let pausedUntil = 0;
let failureStreak = 0;
let warnedUnconfigured = false;
const rejectedUntil = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;

/** 和检索时一样：标题路径一起送去向量化，「教师」这一段脱离「角色与组织结构」就没有意义 */
const textOf = (c: Todo) => (c.heading_path ? `${c.heading_path}\n${c.content}` : c.content);

async function embedBatch(texts: string[]): Promise<number[][]> {
  let last: unknown = null;
  for (let round = 0; round < BATCH_ROUNDS; round++) {
    try {
      return await hedged(
        signal => embedKbTexts(texts, { timeoutMs: BATCH_TIMEOUT_MS, label: 'kb-vectors', signal }),
        { every: BATCH_HEDGE_MS, max: 2, budgetMs: BATCH_TIMEOUT_MS, stopOn: isInputError },
      );
    } catch (e) {
      if (isInputError(e)) throw e;
      last = e;
    }
  }
  throw last;
}

async function fetchTodo(limit: number): Promise<Todo[]> {
  const now = Date.now();
  for (const [id, until] of rejectedUntil) if (until <= now) rejectedUntil.delete(id);
  const { data, error } = await supabase.rpc('kb_chunks_missing_vectors', {
    p_model: KB_VECTOR_MODEL,
    p_limit: limit,
    p_exclude: [...rejectedUntil.keys()],
  });
  if (error) throw new Error(`kb_chunks_missing_vectors: ${error.message}`);
  return (data ?? []) as Todo[];
}

const rowOf = (c: Todo, vector: number[]) => ({
  chunk_id: c.chunk_id,
  course_id: c.course_id,
  model: KB_VECTOR_MODEL,
  embedding: toHalfvecLiteral(vector),
});

/** 算向量的这一会儿，文档可能重新入库了（旧片段删光）。外键挡下的就是这些，跳过它们，别连累同批的 */
async function store(todo: Todo[], vectors: number[][]): Promise<number> {
  const rows = todo.map((c, i) => rowOf(c, vectors[i]));
  const { error } = await supabase.from('kb_chunk_vectors').upsert(rows, { onConflict: 'chunk_id,model' });
  if (!error) return rows.length;
  if ((error as { code?: string }).code !== '23503') throw new Error(`kb_chunk_vectors: ${error.message}`);
  let stored = 0;
  for (const row of rows) {
    const { error: one } = await supabase.from('kb_chunk_vectors').upsert(row, { onConflict: 'chunk_id,model' });
    if (!one) stored += 1;
    else if ((one as { code?: string }).code !== '23503') throw new Error(`kb_chunk_vectors: ${one.message}`);
  }
  return stored;
}

function pause(reason: string): void {
  failureStreak += 1;
  const ms = Math.min(MAX_PAUSE_MS, 60_000 * 2 ** (failureStreak - 1));
  pausedUntil = Date.now() + ms;
  console.warn(`[KB vectors] 第 ${failureStreak} 次出错，${Math.round(ms / 60_000)} 分钟后再试：${reason}`);
}

/**
 * 整批被拒（400）时逐片重试，找出是哪几片。全都被拒多半不是内容的问题（模型名、参数、账号），
 * 当成接口出错暂停，不把整批片段都打进 6 小时的冷宫。
 */
async function embedOneByOne(todo: Todo[]): Promise<{ embedded: number; rejected: number; serviceError: string | null }> {
  const rejected: Todo[] = [];
  let embedded = 0;
  for (const c of todo) {
    try {
      const [vector] = await embedBatch([textOf(c)]);
      embedded += await store([c], [vector]);
    } catch (e) {
      if (isInputError(e)) { rejected.push(c); continue; }
      return { embedded, rejected: 0, serviceError: e instanceof Error ? e.message : String(e) };
    }
  }
  if (rejected.length === todo.length) {
    return { embedded, rejected: 0, serviceError: `这一批 ${todo.length} 片逐片重试也全被拒` };
  }
  const until = Date.now() + REJECTED_RETRY_MS;
  for (const c of rejected) {
    rejectedUntil.set(c.chunk_id, until);
    console.warn(`[KB vectors] 片段 ${c.chunk_id} 被接口拒绝，6 小时后再试`);
  }
  return { embedded, rejected: rejected.length, serviceError: null };
}

async function runOnce(): Promise<FillResult> {
  const result: FillResult = { embedded: 0, rejected: 0, paused: false };
  if (!kbEmbeddingConfigured()) {
    if (!warnedUnconfigured) console.warn('[KB vectors] 没有配置 KB_OPENROUTER_API_KEY，课程知识库算不了向量，AI 检索不到课程资料');
    warnedUnconfigured = true;
    return result;
  }
  if (Date.now() < pausedUntil) return { ...result, paused: true };

  // 按取到的片数计数，不按成功数：外键跳过的那些不算成功，按成功数计可能一直转下去
  for (let attempted = 0; attempted < PER_RUN;) {
    const todo = await fetchTodo(BATCH);
    if (todo.length === 0) break;
    attempted += todo.length;
    try {
      const vectors = await embedBatch(todo.map(textOf));
      result.embedded += await store(todo, vectors);
      failureStreak = 0;
    } catch (e) {
      if (isInputError(e)) {
        const one = await embedOneByOne(todo);
        result.embedded += one.embedded;
        result.rejected += one.rejected;
        if (!one.serviceError) continue;
        pause(one.serviceError);
      } else {
        pause(e instanceof Error ? e.message : String(e));
      }
      result.paused = true;
      break;
    }
  }
  if (result.embedded > 0) console.log(`[KB vectors] 补了 ${result.embedded} 片向量（${KB_VECTOR_MODEL}）`);
  return result;
}

/** 同一时刻只跑一轮；跑的途中又有人叫，跑完再补一轮，接住途中新入库的片段 */
export function fillMissingVectors(): Promise<FillResult> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      let total = await runOnce();
      while (rerun && !total.paused) {
        rerun = false;
        const more = await runOnce();
        total = { embedded: total.embedded + more.embedded, rejected: total.rejected + more.rejected, paused: more.paused };
      }
      return total;
    } finally {
      running = null;
      rerun = false;
    }
  })();
  return running;
}

/** 入库写完片段后调：马上补这批的向量，不用等下一轮定时 */
export function kickKbVectors(): void {
  void fillMissingVectors().catch(err => console.error('[KB vectors] 这一轮出错：', err?.message));
}

/** 进程启动时调一次：先补一轮，之后每 2 分钟扫一次 */
export function startKbVectorJob(): void {
  if (timer) return;
  timer = setInterval(kickKbVectors, INTERVAL_MS);
  timer.unref?.();
  kickKbVectors();
}

export function __resetKbVectorJob(): void {
  if (timer) clearInterval(timer);
  timer = null;
  running = null;
  rerun = false;
  pausedUntil = 0;
  failureStreak = 0;
  warnedUnconfigured = false;
  rejectedUntil.clear();
}
