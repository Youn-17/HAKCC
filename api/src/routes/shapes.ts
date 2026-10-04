/**
 * Canvas shape routes — rectangles, ellipses, diamonds, text labels and
 * connectors drawn directly on a knowledge space to group and label regions.
 *
 * Shapes are canvas furniture, not knowledge contributions: they live in their
 * own table so note counts and research exports stay clean.
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { ensureSpaceAccess, isCourseStaff } from '../services/accessControl';

const router = Router();

// 后六个是流程图常用件：终止符、数据/输入输出、准备、存储、三角、圆角框。
const SHAPE_TYPES = [
  'rect', 'ellipse', 'diamond', 'text', 'line', 'arrow',
  'stadium', 'parallelogram', 'hexagon', 'cylinder', 'triangle', 'roundRect',
];
const TEXT_ALIGNS = ['left', 'center', 'right'];
const TEXT_VALIGNS = ['top', 'middle', 'bottom'];
const MAX_SHAPES_PER_SPACE = 500;

/** 颜色只收 #rgb/#rrggbb 或空串 —— 这个值会直接进 SVG 的 fill/stroke。 */
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function color(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return '';                       // 空串 = 无填充，是合法取值
  return COLOR_RE.test(v) ? v.toLowerCase() : null;
}

function shapeToApi(row: Record<string, unknown>) {
  return {
    id: row.id,
    spaceId: row.space_id,
    viewId: row.view_id ?? null,
    shapeType: row.shape_type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    text: row.text ?? '',
    fill: row.fill ?? '',
    stroke: row.stroke ?? '',
    strokeWidth: row.stroke_width ?? 2,
    zIndex: row.z_index ?? 0,
    fontSize: row.font_size ?? 15,
    fontWeight: row.font_weight ?? 600,
    textAlign: row.text_align ?? 'center',
    textValign: row.text_valign ?? 'middle',
    textColor: row.text_color ?? '',
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

/**
 * 文字样式字段的读取，建和改共用一套。
 * `strict` 时（PATCH）非法值直接报错，让用户知道没存上；
 * 建的时候用默认值兜底，不因为一个字段挡住整次绘制。
 */
function readTextStyle(body: Record<string, unknown>, strict: boolean) {
  const out: Record<string, unknown> = {};

  if (body.font_size !== undefined) {
    out.font_size = Math.round(num(body.font_size, 15, 8, 96));
  }
  if (body.font_weight !== undefined) {
    out.font_weight = Math.round(num(body.font_weight, 600, 300, 900));
  }
  if (body.text_align !== undefined) {
    const v = String(body.text_align);
    if (TEXT_ALIGNS.includes(v)) out.text_align = v;
    else if (strict) throw new ApiError(400, `Invalid text_align: ${v}`);
  }
  if (body.text_valign !== undefined) {
    const v = String(body.text_valign);
    if (TEXT_VALIGNS.includes(v)) out.text_valign = v;
    else if (strict) throw new ApiError(400, `Invalid text_valign: ${v}`);
  }
  if (body.text_color !== undefined) {
    const c = color(body.text_color);
    if (c !== null) out.text_color = c || null;
    else if (strict) throw new ApiError(400, '文字颜色需为 #RGB 或 #RRGGBB');
  }
  return out;
}

/** Numeric guard: reject NaN/Infinity and clamp to a sane canvas range. */
function num(value: unknown, fallback: number, min = -100000, max = 100000): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// GET /api/spaces/:spaceId/shapes
router.get('/spaces/:spaceId/shapes', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  await ensureSpaceAccess(spaceId, req.user!);

  const { data, error } = await supabase
    .from('space_shapes')
    .select('*')
    .eq('space_id', spaceId)
    .order('z_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new ApiError(500, error.message);
  res.json({ shapes: (data ?? []).map(shapeToApi) });
});

// POST /api/spaces/:spaceId/shapes
router.post('/spaces/:spaceId/shapes', verifyJWT, async (req: Request, res: Response) => {
  const spaceId = String(req.params.spaceId);
  await ensureSpaceAccess(spaceId, req.user!);

  const body = req.body as Record<string, unknown>;
  const shapeType = String(body.shape_type ?? '');
  if (!SHAPE_TYPES.includes(shapeType)) {
    throw new ApiError(400, `Invalid shape_type: ${shapeType}`);
  }

  const { count } = await supabase
    .from('space_shapes')
    .select('id', { count: 'exact', head: true })
    .eq('space_id', spaceId);
  if ((count ?? 0) >= MAX_SHAPES_PER_SPACE) {
    throw new ApiError(400, `每个空间最多 ${MAX_SHAPES_PER_SPACE} 个图形`);
  }

  const { data, error } = await supabase
    .from('space_shapes')
    .insert({
      space_id: spaceId,
      view_id: typeof body.view_id === 'string' ? body.view_id : null,
      shape_type: shapeType,
      x: num(body.x, 0),
      y: num(body.y, 0),
      width: num(body.width, 200, 1, 8000),
      height: num(body.height, 120, 1, 8000),
      text: typeof body.text === 'string' ? body.text.slice(0, 500) : null,
      fill: color(body.fill) || null,
      stroke: color(body.stroke) || null,
      stroke_width: Math.min(12, Math.max(0, num(body.stroke_width, 2, 0, 12))),
      z_index: Math.round(num(body.z_index, 0, -1000, 1000)),
      ...readTextStyle(body, false),
      created_by: req.user!.id,
    })
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);
  res.status(201).json({ shape: shapeToApi(data) });
});

/** The creator and course staff may edit; everyone else is read-only. */
async function requireShapeWrite(shapeId: string, req: Request) {
  const { data: shape, error } = await supabase
    .from('space_shapes')
    .select('id, space_id, created_by')
    .eq('id', shapeId)
    .single();
  if (error || !shape) throw new ApiError(404, 'Shape not found');

  const space = await ensureSpaceAccess(shape.space_id as string, req.user!);
  if (shape.created_by !== req.user!.id && !isCourseStaff(space.standing)) {
    throw new ApiError(403, '只能修改自己创建的图形');
  }
  return shape;
}

// PATCH /api/shapes/:id
router.patch('/shapes/:id', verifyJWT, async (req: Request, res: Response) => {
  const shapeId = String(req.params.id);
  await requireShapeWrite(shapeId, req);

  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.x !== undefined) updates.x = num(body.x, 0);
  if (body.y !== undefined) updates.y = num(body.y, 0);
  if (body.width !== undefined) updates.width = num(body.width, 200, 1, 8000);
  if (body.height !== undefined) updates.height = num(body.height, 120, 1, 8000);
  if (typeof body.text === 'string') updates.text = body.text.slice(0, 500);
  if (body.fill !== undefined) {
    const c = color(body.fill);
    if (c === null) throw new ApiError(400, '填充颜色需为 #RGB 或 #RRGGBB');
    updates.fill = c || null;
  }
  if (body.stroke !== undefined) {
    const c = color(body.stroke);
    if (c === null) throw new ApiError(400, '边框颜色需为 #RGB 或 #RRGGBB');
    updates.stroke = c || null;
  }
  if (body.stroke_width !== undefined) updates.stroke_width = Math.min(12, Math.max(0, num(body.stroke_width, 2, 0, 12)));
  if (body.z_index !== undefined) updates.z_index = Math.round(num(body.z_index, 0, -1000, 1000));
  if (body.shape_type !== undefined) {
    const t = String(body.shape_type);
    if (!SHAPE_TYPES.includes(t)) throw new ApiError(400, `Invalid shape_type: ${t}`);
    updates.shape_type = t;   // 允许改形状而不必删了重画
  }
  Object.assign(updates, readTextStyle(body, true));

  const { data, error } = await supabase
    .from('space_shapes')
    .update(updates)
    .eq('id', shapeId)
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);
  res.json({ shape: shapeToApi(data) });
});

// DELETE /api/shapes/:id
router.delete('/shapes/:id', verifyJWT, async (req: Request, res: Response) => {
  const shapeId = String(req.params.id);
  await requireShapeWrite(shapeId, req);

  const { error } = await supabase.from('space_shapes').delete().eq('id', shapeId);
  if (error) throw new ApiError(500, error.message);
  res.json({ message: 'Shape deleted' });
});

export default router;
