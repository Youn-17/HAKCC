import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureSpaceAccess, isCourseStaff } from '../services/accessControl';

const router = Router();

/**
 * Welcome 是每个空间的主画布，但它**不是数据库里的行** —— 前端在列表前面前置一个
 * 虚拟视图，98 条历史笔记的 views 数组里存的就是这个字符串。它同样可以被放到别处
 * 当作「回到主画布」的入口，所以卡片的两端都得容得下它。
 */
const WELCOME_VIEW_ID = 'view-welcome';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_TITLE = 60;

function viewToApi(row: Record<string, unknown>) {
  return {
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    description: row.description,
    creatorId: row.creator_id,
    createdAt: row.created_at,
    lastModified: row.last_modified,
  };
}

function cardToApi(row: Record<string, unknown>) {
  return {
    id: row.id,
    spaceId: row.space_id,
    viewId: row.view_id,
    hostViewId: row.host_view_id,
    x: row.x ?? 0,
    y: row.y ?? 0,
    createdBy: row.created_by,
  };
}

/** Canvas coordinate guard: reject NaN/Infinity, clamp to a sane range. */
function coord(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100000, Math.max(-100000, n));
}

function cleanTitle(raw: unknown): string {
  const title = String(raw ?? '').trim();
  if (!title) throw new ApiError(400, 'title is required');
  return title.slice(0, MAX_TITLE);
}

/**
 * A card's endpoints are plain text, so without this any string would create a
 * card pointing nowhere — a dead end the student can click but never leave.
 */
async function assertViewInSpace(viewId: string, spaceId: string): Promise<void> {
  if (viewId === WELCOME_VIEW_ID) return;
  if (!UUID_RE.test(viewId)) throw new ApiError(400, `Unknown view: ${viewId}`);
  const { data } = await supabase
    .from('views')
    .select('id')
    .eq('id', viewId)
    .eq('space_id', spaceId)
    .maybeSingle();
  if (!data) throw new ApiError(404, `Unknown view: ${viewId}`);
}

async function loadCard(cardId: string) {
  const { data, error } = await supabase
    .from('view_cards')
    .select('id, space_id, created_by')
    .eq('id', cardId)
    .single();
  if (error || !data) throw new ApiError(404, 'View card not found');
  return data;
}

// GET /api/spaces/:spaceId/views — views and every card placed in this space
router.get('/spaces/:spaceId/views', verifyJWT, async (req: Request, res: Response) => {
  const { spaceId } = req.params;
  await ensureSpaceAccess(String(spaceId), req.user!);

  const [viewsResult, cardsResult] = await Promise.all([
    supabase.from('views').select('*').eq('space_id', spaceId).order('created_at', { ascending: true }),
    supabase.from('view_cards').select('*').eq('space_id', spaceId),
  ]);

  if (viewsResult.error) throw new ApiError(500, viewsResult.error.message);
  if (cardsResult.error) throw new ApiError(500, cardsResult.error.message);

  res.json({
    views: (viewsResult.data ?? []).map(viewToApi),
    cards: (cardsResult.data ?? []).map(cardToApi),
  });
});

// POST /api/spaces/:spaceId/views — create a view plus its first card
router.post('/spaces/:spaceId/views', verifyJWT, async (req: Request, res: Response) => {
  const { spaceId } = req.params;
  await ensureSpaceAccess(String(spaceId), req.user!);

  const title = cleanTitle(req.body.title);
  const hostViewId = String(req.body.host_view_id ?? WELCOME_VIEW_ID);
  await assertViewInSpace(hostViewId, String(spaceId));

  const { data, error } = await supabase
    .from('views')
    .insert({
      space_id: spaceId,
      title,
      description: req.body.description ?? null,
      creator_id: req.user!.id,
    })
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);

  // A view nobody can reach from the canvas is a view nobody uses, so the
  // creating canvas always gets a card back to it.
  const { data: card, error: cardError } = await supabase
    .from('view_cards')
    .insert({
      space_id: spaceId,
      view_id: data.id,
      host_view_id: hostViewId,
      x: coord(req.body.card_x),
      y: coord(req.body.card_y),
      created_by: req.user!.id,
    })
    .select()
    .single();

  if (cardError) throw new ApiError(500, cardError.message);

  res.status(201).json({ view: viewToApi(data), card: cardToApi(card) });
});

// PUT /api/views/:id — rename
router.put('/views/:id', verifyJWT, async (req: Request, res: Response) => {
  const { data: existing, error: fetchError } = await supabase
    .from('views')
    .select('id, creator_id, space_id')
    .eq('id', req.params.id)
    .single();

  if (fetchError || !existing) throw new ApiError(404, 'View not found');
  const space = await ensureSpaceAccess(String(existing.space_id), req.user!);

  if (existing.creator_id !== req.user!.id && !isCourseStaff(space.standing)) {
    throw new ApiError(403, 'Only the person who created this view can rename it');
  }

  const updateData: Record<string, unknown> = { last_modified: new Date().toISOString() };
  if (req.body.title !== undefined) updateData.title = cleanTitle(req.body.title);
  if (req.body.description !== undefined) updateData.description = req.body.description;

  const { data, error } = await supabase
    .from('views')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);
  res.json({ view: viewToApi(data) });
});

// DELETE /api/views/:id
router.delete('/views/:id', verifyJWT, async (req: Request, res: Response) => {
  const { data: existing, error: fetchError } = await supabase
    .from('views')
    .select('id, creator_id, space_id')
    .eq('id', req.params.id)
    .single();

  if (fetchError || !existing) throw new ApiError(404, 'View not found');
  const space = await ensureSpaceAccess(String(existing.space_id), req.user!);

  if (existing.creator_id !== req.user!.id && !isCourseStaff(space.standing)) {
    throw new ApiError(403, 'Only the person who created this view can delete it');
  }

  // Cards are plain text on both ends, so nothing cascades. Clear both
  // directions or the canvas keeps a card that leads to a deleted view.
  for (const column of ['view_id', 'host_view_id'] as const) {
    const { error: cardError } = await supabase
      .from('view_cards')
      .delete()
      .eq('space_id', existing.space_id)
      .eq(column, existing.id);
    if (cardError) throw new ApiError(500, cardError.message);
  }

  const { error } = await supabase.from('views').delete().eq('id', req.params.id);
  if (error) throw new ApiError(500, error.message);
  res.json({ message: 'View deleted' });
});

// POST /api/spaces/:spaceId/view-cards — drop a card onto a canvas
router.post('/spaces/:spaceId/view-cards', verifyJWT, async (req: Request, res: Response) => {
  const { spaceId } = req.params;
  await ensureSpaceAccess(String(spaceId), req.user!);

  const viewId = String(req.body.view_id ?? '');
  const hostViewId = String(req.body.host_view_id ?? '');
  if (viewId === hostViewId) throw new ApiError(400, 'A view cannot link to itself');
  await assertViewInSpace(viewId, String(spaceId));
  await assertViewInSpace(hostViewId, String(spaceId));

  const { data, error } = await supabase
    .from('view_cards')
    .insert({
      space_id: spaceId,
      view_id: viewId,
      host_view_id: hostViewId,
      x: coord(req.body.x),
      y: coord(req.body.y),
      created_by: req.user!.id,
    })
    .select()
    .single();

  // Placing a card that is already there is what the student wanted anyway;
  // hand back the existing one instead of an error they cannot act on.
  if (error?.code === '23505') {
    const { data: existing } = await supabase
      .from('view_cards')
      .select('*')
      .eq('space_id', spaceId)
      .eq('host_view_id', hostViewId)
      .eq('view_id', viewId)
      .single();
    if (existing) return res.json({ card: cardToApi(existing) });
  }
  if (error) throw new ApiError(500, error.message);

  res.status(201).json({ card: cardToApi(data) });
});

// PATCH /api/view-cards/:id — move a card. Position is shared canvas layout,
// so any member of the space may tidy it, same as note positions.
router.patch('/view-cards/:id', verifyJWT, async (req: Request, res: Response) => {
  const card = await loadCard(String(req.params.id));
  await ensureSpaceAccess(String(card.space_id), req.user!);

  const updateData: Record<string, unknown> = {};
  if (req.body.x !== undefined) updateData.x = coord(req.body.x);
  if (req.body.y !== undefined) updateData.y = coord(req.body.y);
  if (Object.keys(updateData).length === 0) throw new ApiError(400, 'Nothing to update');

  const { data, error } = await supabase
    .from('view_cards')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);
  res.json({ card: cardToApi(data) });
});

// DELETE /api/view-cards/:id — remove the shortcut, never the view behind it
router.delete('/view-cards/:id', verifyJWT, async (req: Request, res: Response) => {
  const card = await loadCard(String(req.params.id));
  const space = await ensureSpaceAccess(String(card.space_id), req.user!);

  if (card.created_by !== req.user!.id && !isCourseStaff(space.standing)) {
    throw new ApiError(403, 'Only the person who placed this card can remove it');
  }

  const { error } = await supabase.from('view_cards').delete().eq('id', req.params.id);
  if (error) throw new ApiError(500, error.message);
  res.json({ message: 'View card removed' });
});

export default router;
