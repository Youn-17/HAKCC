import { Router, Request, Response } from 'express';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import {
  startRun,
  transitionRun,
  failRun,
  recordEffect,
  getRun,
  getRunWithTrace,
  listRuns,
  getVersionChain,
  createCheckpoint,
  rollbackToCheckpoint,
  type AgentType,
  type RunStatus,
} from '../services/agentLifecycle';

const router = Router();

const VALID_TYPES = new Set<AgentType>(['chat', 'lesson_prep', 'analytics', 'assessment']);
const VALID_STATUSES = new Set<RunStatus>([
  'planning', 'gathering', 'executing', 'reviewing', 'applied', 'failed', 'cancelled',
]);

// POST /agent-runs — start a new run
router.post('/agent-runs', verifyJWT, async (req: Request, res: Response) => {
  const { agent_type, course_id, title, input, parent_run_id, version } = req.body as {
    agent_type?: string;
    course_id?: string;
    title?: string;
    input?: Record<string, unknown>;
    parent_run_id?: string;
    version?: number;
  };

  if (!agent_type || !VALID_TYPES.has(agent_type as AgentType)) {
    throw new ApiError(400, 'Invalid agent_type');
  }

  // parent_run_id comes from the body and links this run into an existing
  // version chain. Left unchecked it lets a caller graft their run onto someone
  // else's, which the version-chain read then follows.
  if (parent_run_id) {
    const parent = await getRun(String(parent_run_id));
    if (!parent || parent.user_id !== req.user!.id) {
      throw new ApiError(404, 'Parent run not found');
    }
  }

  const run = await startRun({
    userId: req.user!.id,
    courseId: course_id,
    agentType: agent_type as AgentType,
    title,
    input,
    parentRunId: parent_run_id,
    version,
  });

  res.json({ run });
});

// GET /agent-runs — list runs
router.get('/agent-runs', verifyJWT, async (req: Request, res: Response) => {
  const courseId = req.query.course_id as string | undefined;
  const agentType = req.query.agent_type as AgentType | undefined;
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  const runs = await listRuns({
    userId: req.user!.id,
    courseId,
    agentType: agentType && VALID_TYPES.has(agentType) ? agentType : undefined,
    limit,
  });

  res.json({ runs });
});

// GET /agent-runs/:runId — get run with full trace
router.get('/agent-runs/:runId', verifyJWT, async (req: Request, res: Response) => {
  const result = await getRunWithTrace(String(req.params.runId));
  if (!result || result.run.user_id !== req.user!.id) {
    throw new ApiError(404, 'Run not found');
  }
  res.json(result);
});

// GET /agent-runs/:runId/versions — get version chain
router.get('/agent-runs/:runId/versions', verifyJWT, async (req: Request, res: Response) => {
  const run = await getRun(String(req.params.runId));
  if (!run || run.user_id !== req.user!.id) {
    throw new ApiError(404, 'Run not found');
  }
  const versions = await getVersionChain(run.id, req.user!.id);
  res.json({ versions });
});

// PATCH /agent-runs/:runId/status — transition lifecycle
router.patch('/agent-runs/:runId/status', verifyJWT, async (req: Request, res: Response) => {
  const { status, output, context_snapshot } = req.body as {
    status?: string;
    output?: Record<string, unknown>;
    context_snapshot?: Record<string, unknown>;
  };

  if (!status || !VALID_STATUSES.has(status as RunStatus)) {
    throw new ApiError(400, 'Invalid status');
  }

  const run = await getRun(String(req.params.runId));
  if (!run || run.user_id !== req.user!.id) {
    throw new ApiError(404, 'Run not found');
  }

  await transitionRun(run.id, status as RunStatus, {
    output,
    contextSnapshot: context_snapshot,
  });

  res.json({ message: 'Transitioned', status });
});

// POST /agent-runs/:runId/effects — record an effect
router.post('/agent-runs/:runId/effects', verifyJWT, async (req: Request, res: Response) => {
  const { effect_type, payload } = req.body as {
    effect_type?: string;
    payload?: Record<string, unknown>;
  };

  if (!effect_type) throw new ApiError(400, 'effect_type required');

  const run = await getRun(String(req.params.runId));
  if (!run || run.user_id !== req.user!.id) {
    throw new ApiError(404, 'Run not found');
  }

  await recordEffect({ runId: run.id, effectType: effect_type, payload });
  res.json({ message: 'Recorded' });
});

// POST /agent-runs/:runId/checkpoint — create checkpoint
router.post('/agent-runs/:runId/checkpoint', verifyJWT, async (req: Request, res: Response) => {
  const { name, snapshot } = req.body as {
    name?: string;
    snapshot?: Record<string, unknown>;
  };

  if (!name) throw new ApiError(400, 'name required');

  const run = await getRun(String(req.params.runId));
  if (!run || run.user_id !== req.user!.id) {
    throw new ApiError(404, 'Run not found');
  }

  const cp = await createCheckpoint({ runId: run.id, name, snapshot });
  res.json({ checkpoint: cp });
});

// POST /agent-runs/:runId/rollback — rollback to checkpoint
router.post('/agent-runs/:runId/rollback', verifyJWT, async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name) throw new ApiError(400, 'checkpoint name required');

  const run = await getRun(String(req.params.runId));
  if (!run || run.user_id !== req.user!.id) {
    throw new ApiError(404, 'Run not found');
  }

  const cp = await rollbackToCheckpoint(run.id, name);
  if (!cp) throw new ApiError(404, 'Checkpoint not found');

  res.json({ checkpoint: cp, message: 'Rolled back' });
});

export default router;
