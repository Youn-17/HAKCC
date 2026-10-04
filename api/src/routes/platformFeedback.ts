import { Router, type Request, type Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { toCsv } from '../services/zipWriter';

/**
 * 学生对平台本身的反馈。
 *
 * 任课教师在这里没有任何入口 —— 学生要能说「这个平台对我没用」，
 * 就不能让他的老师看见。只有平台管理员读得到，界面上也是这么写的。
 */
const router = Router();

const KINDS = ['thought', 'suggestion', 'problem', 'disagree'] as const;
type Kind = (typeof KINDS)[number];

const MAX_BODY = 4000;
const SELECT = 'id, kind, body, course_id, created_at, updated_at';

function normalizeKind(raw: unknown): Kind {
  return KINDS.includes(raw as Kind) ? (raw as Kind) : 'thought';
}

function normalizeBody(raw: unknown): string {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) throw new ApiError(400, '写点什么再提交吧');
  if (body.length > MAX_BODY) throw new ApiError(400, `最多 ${MAX_BODY} 字`);
  return body;
}

/** 写反馈时的处境。只留能帮上忙的几项，别把整个 UA 串和无关字段都存进来。 */
function normalizeContext(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['path', 'viewport', 'appVersion', 'lang'] as const) {
    const value = src[key];
    if (typeof value === 'string' && value.length <= 200) out[key] = value;
  }
  return out;
}

const LETTER_KEY = 'feedback_letter';

type LetterSide = { title: string; body: string; signature: string };

/** 只收这三个字段，且都当纯文本存。渲染端不解析 HTML/Markdown，所以这里也不必转义。 */
function normalizeLetterSide(raw: unknown): LetterSide {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v : '').slice(0, max);
  return {
    title: str(src.title, 200).trim(),
    body: str(src.body, 20000),
    signature: str(src.signature, 200).trim(),
  };
}

// GET /api/platform-feedback/letter — 学生和管理员都要读
router.get('/platform-feedback/letter', verifyJWT, async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('platform_content')
    .select('value, updated_at')
    .eq('key', LETTER_KEY)
    .maybeSingle();

  if (error) throw new ApiError(500, error.message);
  // 没这一行是正常状态（从没改过），前端回落到代码里的默认文案。
  res.json({ letter: data?.value ?? null, updatedAt: data?.updated_at ?? null });
});

// PUT /api/admin/platform-feedback/letter — 管理员改文案，学生刷新即可看到
router.put('/admin/platform-feedback/letter', verifyJWT, requireRole('admin'), async (req: Request, res: Response) => {
  const value = {
    zh: normalizeLetterSide(req.body?.zh),
    en: normalizeLetterSide(req.body?.en),
  };
  if (!value.zh.body.trim() && !value.en.body.trim()) {
    throw new ApiError(400, '正文不能为空。要恢复成默认文案，请用「恢复默认」。');
  }

  const { data, error } = await supabase
    .from('platform_content')
    .upsert({ key: LETTER_KEY, value, updated_at: new Date().toISOString(), updated_by: req.user!.id }, { onConflict: 'key' })
    .select('value, updated_at')
    .single();

  if (error) throw new ApiError(500, error.message);
  res.json({ letter: data.value, updatedAt: data.updated_at });
});

// DELETE /api/admin/platform-feedback/letter — 恢复默认，就是把这行删掉
router.delete('/admin/platform-feedback/letter', verifyJWT, requireRole('admin'), async (_req: Request, res: Response) => {
  const { error } = await supabase.from('platform_content').delete().eq('key', LETTER_KEY);
  if (error) throw new ApiError(500, error.message);
  res.json({ letter: null });
});

// POST /api/platform-feedback — 写一条
router.post('/platform-feedback', verifyJWT, async (req: Request, res: Response) => {
  const body = normalizeBody(req.body?.body);
  const kind = normalizeKind(req.body?.kind);
  const courseId = typeof req.body?.course_id === 'string' && req.body.course_id ? req.body.course_id : null;

  const { data, error } = await supabase
    .from('platform_feedback')
    .insert({
      user_id: req.user!.id,
      course_id: courseId,
      kind,
      body,
      context: normalizeContext(req.body?.context),
    })
    .select(SELECT)
    .single();

  if (error) throw new ApiError(500, error.message);
  res.status(201).json({ feedback: data });
});

// GET /api/platform-feedback/mine — 自己写过的
router.get('/platform-feedback/mine', verifyJWT, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('platform_feedback')
    .select(SELECT)
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw new ApiError(500, error.message);
  res.json({ feedback: data ?? [] });
});

// PATCH /api/platform-feedback/:id — 改自己那条
router.patch('/platform-feedback/:id', verifyJWT, async (req: Request, res: Response) => {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (req.body?.body !== undefined) patch.body = normalizeBody(req.body.body);
  if (req.body?.kind !== undefined) patch.kind = normalizeKind(req.body.kind);

  const { data, error } = await supabase
    .from('platform_feedback')
    .update(patch)
    .eq('id', String(req.params.id))
    .eq('user_id', req.user!.id)
    .select(SELECT)
    .maybeSingle();

  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Feedback not found');
  res.json({ feedback: data });
});

// DELETE /api/platform-feedback/:id — 撤回自己那条
router.delete('/platform-feedback/:id', verifyJWT, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('platform_feedback')
    .delete()
    .eq('id', String(req.params.id))
    .eq('user_id', req.user!.id)
    .select('id')
    .maybeSingle();

  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Feedback not found');
  res.json({ ok: true });
});

// GET /api/admin/platform-feedback — 平台管理员读全部
router.get('/admin/platform-feedback', verifyJWT, requireRole('admin'), async (req: Request, res: Response) => {
  const kind = typeof req.query.kind === 'string' && KINDS.includes(req.query.kind as Kind)
    ? (req.query.kind as Kind)
    : null;

  let query = supabase
    .from('platform_feedback')
    .select('id, kind, body, course_id, created_at, updated_at, profiles!user_id(id, full_name, email, role)')
    .order('created_at', { ascending: false })
    .limit(500);
  if (kind) query = query.eq('kind', kind);

  const { data, error } = await query;
  if (error) throw new ApiError(500, error.message);

  const rows = (data ?? []) as Array<Record<string, any>>;
  const courseIds = [...new Set(rows.map(r => r.course_id).filter(Boolean))] as string[];
  const courseTitles = new Map<string, string>();
  if (courseIds.length > 0) {
    const { data: courses } = await supabase.from('courses').select('id, title').in('id', courseIds);
    for (const c of courses ?? []) courseTitles.set(c.id as string, c.title as string);
  }

  res.json({
    feedback: rows.map(r => ({
      id: r.id,
      kind: r.kind,
      body: r.body,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      courseTitle: r.course_id ? courseTitles.get(r.course_id) ?? null : null,
      author: r.profiles
        ? { id: r.profiles.id, name: r.profiles.full_name, email: r.profiles.email, role: r.profiles.role }
        : null,
    })),
  });
});

/**
 * GET /api/admin/platform-feedback.csv — 导出成表格。
 *
 * 反馈是攒起来看趋势的：这学期学生反复卡在同一个地方、对某个功能的评价从哪次更新开始变化，
 * 一条条在页面上翻看不出来，导出来排序筛选才看得出来。
 */
router.get('/admin/platform-feedback.csv', verifyJWT, requireRole('admin'), async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('platform_feedback')
    .select('id, kind, body, course_id, created_at, updated_at, context, profiles!user_id(full_name, email, role)')
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(500, error.message);

  const rows = (data ?? []) as Array<Record<string, any>>;
  const courseIds = [...new Set(rows.map(r => r.course_id).filter(Boolean))] as string[];
  const courseTitles = new Map<string, string>();
  if (courseIds.length > 0) {
    const { data: courses } = await supabase.from('courses').select('id, title').in('id', courseIds);
    for (const c of courses ?? []) courseTitles.set(c.id as string, c.title as string);
  }

  const columns = ['id', 'created_at', 'updated_at', 'kind', 'author_name', 'author_email', 'author_role', 'course', 'path', 'body'];
  const csv = toCsv(
    rows.map(r => ({
      id: r.id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      kind: r.kind,
      author_name: r.profiles?.full_name ?? '',
      author_email: r.profiles?.email ?? '',
      author_role: r.profiles?.role ?? '',
      course: r.course_id ? courseTitles.get(r.course_id) ?? r.course_id : '',
      path: typeof r.context?.path === 'string' ? r.context.path : '',
      body: r.body,
    })),
    columns,
  );

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="platform_feedback_${stamp}.csv"`);
  // UTF-8 BOM，否则 Excel 打开中文是乱码（和研究数据导出一致）。
  res.send('\ufeff' + csv);
});

export default router;
