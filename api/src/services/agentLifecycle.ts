import { supabase } from '../config/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentType = 'chat' | 'lesson_prep' | 'analytics' | 'assessment';

export type RunStatus =
  | 'planning'
  | 'gathering'
  | 'executing'
  | 'reviewing'
  | 'applied'
  | 'failed'
  | 'cancelled';

export const LIFECYCLE_ORDER: RunStatus[] = [
  'planning', 'gathering', 'executing', 'reviewing', 'applied',
];

export interface AgentRun {
  id: string;
  user_id: string;
  course_id: string | null;
  agent_type: AgentType;
  status: RunStatus;
  title: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  context_snapshot: Record<string, unknown>;
  version: number;
  parent_run_id: string | null;
  started_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface AgentEffect {
  id: string;
  run_id: string;
  seq: number;
  effect_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AgentCheckpoint {
  id: string;
  run_id: string;
  name: string;
  seq_at: number;
  snapshot: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export async function startRun(params: {
  userId: string;
  courseId?: string | null;
  agentType: AgentType;
  title?: string;
  input?: Record<string, unknown>;
  parentRunId?: string | null;
  version?: number;
}): Promise<AgentRun> {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      user_id: params.userId,
      course_id: params.courseId ?? null,
      agent_type: params.agentType,
      status: 'planning',
      title: params.title ?? null,
      input: params.input ?? {},
      parent_run_id: params.parentRunId ?? null,
      version: params.version ?? 1,
    })
    .select('*')
    .single();

  if (error) throw new Error(`startRun failed: ${error.message}`);

  await recordEffect({
    runId: data.id,
    effectType: 'run_started',
    payload: {
      agent_type: params.agentType,
      input_summary: params.title ?? Object.keys(params.input ?? {}).join(', '),
    },
  });

  return data as AgentRun;
}

export async function transitionRun(
  runId: string,
  newStatus: RunStatus,
  updates?: { output?: Record<string, unknown>; contextSnapshot?: Record<string, unknown> },
): Promise<void> {
  const patch: Record<string, unknown> = { status: newStatus };
  if (updates?.output) patch.output = updates.output;
  if (updates?.contextSnapshot) patch.context_snapshot = updates.contextSnapshot;
  if (newStatus === 'applied' || newStatus === 'failed' || newStatus === 'cancelled') {
    patch.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('agent_runs')
    .update(patch)
    .eq('id', runId);

  if (error) console.error(`transitionRun failed: ${error.message}`);

  await recordEffect({
    runId,
    effectType: `status_${newStatus}`,
    payload: updates?.output ? { has_output: true } : {},
  });
}

export async function failRun(runId: string, errorMsg: string): Promise<void> {
  await transitionRun(runId, 'failed');
  await recordEffect({ runId, effectType: 'error', payload: { error: errorMsg } });
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

let seqCounters = new Map<string, number>();

export async function recordEffect(params: {
  runId: string;
  effectType: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const seq = (seqCounters.get(params.runId) ?? 0) + 1;
  seqCounters.set(params.runId, seq);

  const { error } = await supabase
    .from('agent_effects')
    .insert({
      run_id: params.runId,
      seq,
      effect_type: params.effectType,
      payload: params.payload ?? {},
    });

  if (error) console.error(`recordEffect failed: ${error.message}`);
}

export async function getRunEffects(runId: string): Promise<AgentEffect[]> {
  const { data, error } = await supabase
    .from('agent_effects')
    .select('*')
    .eq('run_id', runId)
    .order('seq', { ascending: true });

  if (error) return [];
  return (data ?? []) as AgentEffect[];
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export async function createCheckpoint(params: {
  runId: string;
  name: string;
  snapshot?: Record<string, unknown>;
}): Promise<AgentCheckpoint> {
  const currentSeq = seqCounters.get(params.runId) ?? 0;

  const { data, error } = await supabase
    .from('agent_checkpoints')
    .upsert({
      run_id: params.runId,
      name: params.name,
      seq_at: currentSeq,
      snapshot: params.snapshot ?? {},
    }, { onConflict: 'run_id,name' })
    .select('*')
    .single();

  if (error) throw new Error(`createCheckpoint failed: ${error.message}`);

  await recordEffect({
    runId: params.runId,
    effectType: 'checkpoint_created',
    payload: { name: params.name, seq_at: currentSeq },
  });

  return data as AgentCheckpoint;
}

export async function rollbackToCheckpoint(runId: string, name: string): Promise<AgentCheckpoint | null> {
  const { data: cp, error } = await supabase
    .from('agent_checkpoints')
    .select('*')
    .eq('run_id', runId)
    .eq('name', name)
    .single();

  if (error || !cp) return null;

  // Delete effects after the checkpoint
  await supabase
    .from('agent_effects')
    .delete()
    .eq('run_id', runId)
    .gt('seq', cp.seq_at);

  seqCounters.set(runId, cp.seq_at);

  // Restore run output from checkpoint snapshot
  if (cp.snapshot && Object.keys(cp.snapshot).length > 0) {
    await supabase
      .from('agent_runs')
      .update({ output: cp.snapshot, status: 'reviewing' })
      .eq('id', runId);
  }

  await recordEffect({
    runId,
    effectType: 'rollback',
    payload: { checkpoint: name, rolled_back_to_seq: cp.seq_at },
  });

  return cp as AgentCheckpoint;
}

export async function listCheckpoints(runId: string): Promise<AgentCheckpoint[]> {
  const { data, error } = await supabase
    .from('agent_checkpoints')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data ?? []) as AgentCheckpoint[];
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export async function getRun(runId: string): Promise<AgentRun | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (error) return null;
  return data as AgentRun;
}

export async function getRunWithTrace(runId: string): Promise<{
  run: AgentRun;
  effects: AgentEffect[];
  checkpoints: AgentCheckpoint[];
} | null> {
  const run = await getRun(runId);
  if (!run) return null;

  const [effects, checkpoints] = await Promise.all([
    getRunEffects(runId),
    listCheckpoints(runId),
  ]);

  return { run, effects, checkpoints };
}

export async function listRuns(params: {
  userId: string;
  courseId?: string;
  agentType?: AgentType;
  limit?: number;
}): Promise<AgentRun[]> {
  let query = supabase
    .from('agent_runs')
    .select('*')
    .eq('user_id', params.userId)
    .order('started_at', { ascending: false })
    .limit(params.limit ?? 20);

  if (params.courseId) query = query.eq('course_id', params.courseId);
  if (params.agentType) query = query.eq('agent_type', params.agentType);

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as AgentRun[];
}

/**
 * List every version of a run.
 *
 * Scoped to `userId` on purpose: parent_run_id is caller-supplied at creation
 * time, so a chain can be made to climb into another user's run. Walking to
 * that root and returning its children would hand back their input, output and
 * context_snapshot — the ownership check on the calling route sees only the
 * starting run, not where the chain leads.
 */
export async function getVersionChain(runId: string, userId: string): Promise<AgentRun[]> {
  // Walk up to root, refusing to cross into runs owned by someone else.
  let rootId = runId;
  let current = await getRun(runId);
  if (!current || current.user_id !== userId) return [];
  while (current?.parent_run_id) {
    const parent = await getRun(current.parent_run_id);
    if (!parent || parent.user_id !== userId) break;
    rootId = parent.id;
    current = parent;
  }

  const { data } = await supabase
    .from('agent_runs')
    .select('*')
    .or(`id.eq.${rootId},parent_run_id.eq.${rootId}`)
    .eq('user_id', userId)
    .order('version', { ascending: true });

  return (data ?? []) as AgentRun[];
}

// ---------------------------------------------------------------------------
// Cleanup — prune old runs (keep last 50 per user+course+type)
// ---------------------------------------------------------------------------

export async function pruneRuns(userId: string, courseId: string, agentType: AgentType): Promise<void> {
  const { data } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .eq('agent_type', agentType)
    .order('started_at', { ascending: false })
    .range(50, 999);

  if (data && data.length > 0) {
    const ids = data.map((d: any) => d.id);
    await supabase.from('agent_runs').delete().in('id', ids);
  }
}
